// 데이터 테이블 편집 화면 — 직업·캐릭터·몬스터·스킬·효과·속성 상성·시너지 7개 테이블.
// 행 추가·수정·삭제·복제, CSV(테이블 하나)·JSON(전체/하나) 가져오기·내보내기, 검증 결과를 행·칸에 표시.
// 전투 시뮬레이터(1:1·파티)는 이 테이블을 그대로 읽는다 (store.js).
import { TABLES, TABLE_KEYS, ROLES, columnsOf } from './schema.js';
import { validateTables, tableToCSV, tableFromCSV, tablesFromJSON, defaultTables, nextId, renameId } from './tables.js';
import { getTables, setTables } from './store.js';
import { h, toast, debounce, downloadJSON, downloadText, pickText, pickJSON, decodeState } from '../lib/util.js';
import { tip, label } from '../lib/tip.js';

let t, els = {}, cur = 'classes', result = { issues: [], count: { error: 0, warn: 0 } };
const save = debounce(() => setTables(t), 300);

export function mount(root) {
  t = structuredClone(getTables());
  readHash();
  build(root);
  render();
  window.addEventListener('hashchange', () => { if (readHash()) render(); });
}

/** 되돌리기·공유 링크: #data?s=… = { v: 1, tables } */
function readHash() {
  const m = location.hash.match(/^#data\?s=([\w-]+)/);
  if (!m) return false;
  const st = decodeState(m[1]);
  history.replaceState(null, '', '#data');
  if (!(st?.v === 1 && st.tables)) return false;
  t = st.tables;
  for (const k of TABLE_KEYS) t[k] ||= [];
  setTables(t);
  return true;
}

function build(root) {
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '데이터 테이블'),
        h('p', {}, '전투 시뮬레이터(1:1·파티)가 읽는 직업 · 캐릭터 · 몬스터 · 스킬 · 효과 · 속성 상성 · 시너지 테이블입니다. 테이블끼리는 ID로 참조하고, 여기서 행을 추가하면 시뮬레이터의 선택 목록에 바로 나타납니다. 엑셀에서 고친 CSV를 그대로 불러올 수 있습니다.'),
      ),
      h('div.tool-actions', {},
        h('button.btn', { type: 'button', onclick: () => downloadJSON('data-tables.json', { schemaVersion: 1, tool: 'tables', tables: t }), title: '7개 테이블 전체를 JSON 파일 하나로' }, 'JSON 저장 (전체)'),
        h('button.btn', { type: 'button', onclick: importJSON, title: '전체 또는 테이블 하나를 담은 JSON을 불러옵니다' }, 'JSON 불러오기'),
        h('button.btn', { type: 'button', onclick: resetAll }, '기본 데이터로'),
      ),
    ),
    els.summary = h('div.card.role-check'),
    h('div.card.role-in', {},
      els.tabs = h('div.seg-tabs.data-tabs', { role: 'tablist', 'aria-label': '테이블' }),
      h('div.data-bar', {},
        els.desc = h('p.desc'),
        h('div.tool-actions', {},
          h('button.btn.small.primary', { type: 'button', onclick: addRow }, '+ 행 추가'),
          h('button.btn.small', { type: 'button', onclick: exportCSV }, 'CSV 내보내기'),
          h('button.btn.small', { type: 'button', onclick: importCSV }, 'CSV 가져오기'),
          tip('csv'),
          h('button.btn.small', { type: 'button', onclick: () => downloadJSON(`table-${cur}.json`, { schemaVersion: 1, table: cur, rows: t[cur] }) }, 'JSON (이 테이블)'),
        ),
      ),
      h('div.table-wrap.data-wrap', {}, els.grid = h('table.edit-table.data-grid')),
    ),
    h('div.card.role-tool', {},
      h('div.card-head', {}, h('h2', {}, '테이블 사용법')),
      h('ul.disc-notes', {},
        h('li', {}, h('b', {}, '최종 스탯 계산 순서'), ' — ① 직업 기본(Lv1) → ② 레벨 성장(성장 × (Lv−1)) → ③ 캐릭터 보정(합: +값 / 곱: ×(1+값%)) → ④ 장비·버프(전투 중 효과 포함). 몬스터는 표의 값을 그대로 씁니다.'),
        h('li', {}, h('b', {}, '참조'), ' — 캐릭터 → 직업(ClassID), 직업·캐릭터·몬스터 → 스킬(SkillID), 스킬·시너지 → 효과(EffectID), 캐릭터·몬스터 → 속성(상성 테이블의 행). 여러 ID는 | 로 잇습니다. ID를 바꾸면 참조도 함께 바뀝니다.'),
        h('li', {}, h('b', {}, '검증'), ' — 없는 ID 참조 · 중복 ID · 빈 필수값 · 숫자 범위 · 선택지 밖 값은 빨간 칸으로, 효과가 걸리지 않는 설정 등은 노란 칸으로 표시합니다. 칸에 마우스를 올리면 이유가 나옵니다.'),
        h('li', {}, h('b', {}, 'CSV'), ' — 머리글은 열 키(hp) 또는 열 이름(체력) 모두 됩니다. 선택지는 코드(tank)나 이름(탱커) 모두 됩니다. 엑셀이 저장한 BOM·세미콜론·따옴표를 그대로 읽습니다.'),
      ),
    ),
  );
}

function render() {
  result = validateTables(t);
  renderSummary();
  renderTabs();
  renderGrid();
}

function renderSummary() {
  const { issues, count } = result;
  els.summary.replaceChildren(
    h('div.card-head', {}, h('h2', {}, label('검증 결과', 'validation')), h('span.hint', {}, count.error || count.warn ? `오류 ${count.error} · 경고 ${count.warn}` : '문제 없음')),
    issues.length
      ? h('ul.findings', {}, ...issues.slice(0, 12).map(x => h(`li.${x.level === 'error' ? 'serious' : 'warn'}`, {},
        h('span.lv', {}, x.level === 'error' ? '오류' : '경고'),
        h('span', {}, h('button.link-btn', { type: 'button', onclick: () => { cur = x.table; renderTabs(); renderGrid(); focusCell(x.row, x.col); } }, `${TABLES[x.table].label} ${x.row + 1}행${x.id ? ` (${x.id})` : ''}`), ` — ${x.msg}`))),
        issues.length > 12 ? h('li.info', {}, h('span.lv', {}, '…'), h('span', {}, `외 ${issues.length - 12}건 — 각 테이블의 빨간 칸을 확인하세요`)) : null)
      : h('p.muted', {}, '모든 ID 참조가 맞고, 필수값·숫자 범위 오류가 없습니다.'),
  );
}

function renderTabs() {
  const n = (k) => result.issues.filter(x => x.table === k && x.level === 'error').length;
  els.tabs.replaceChildren(...TABLE_KEYS.map(k => h('button', {
    type: 'button', role: 'tab', 'aria-pressed': String(k === cur), 'aria-selected': String(k === cur),
    onclick: () => { cur = k; renderTabs(); renderGrid(); },
  }, `${TABLES[k].label} ${t[k].length}`, n(k) ? h('span.badge.bad', {}, String(n(k))) : null)));
  els.desc.replaceChildren(...label(TABLES[cur].label + ' 테이블', TABLES[cur].tip), ' — ', descOf(cur));
}
const descOf = (k) => ({
  classes: '직업마다 역할군·배치·Lv1 스탯·레벨당 성장·기본 스킬.',
  characters: '직업을 가리키고(ClassID) 개인 보정과 고유 스킬을 더합니다.',
  monsters: '레벨 없이 표의 스탯 그대로. 보스는 그로기 최대치와 페이즈.',
  skills: '대상·범위·배율·코스트·쿨타임·그로기 증가·효과.',
  effects: '버프·디버프·스턴·회복·보호막·지속 피해·도발·부활의 수치와 확률·지속·중첩.',
  elements: '행 = 공격 속성, 열 = 방어 속성. 행을 더하면 열도 생깁니다.',
  synergies: '조건을 만족하는 파티 전원에게 전투 시작 때 효과.',
}[k]);

// ── 표 ──────────────────────────────────────────────────
function renderGrid() {
  const cols = columnsOf(t, cur), rows = t[cur];
  els.grid.replaceChildren(
    h('thead', {}, h('tr', {},
      h('th.left.rownum', {}, '#'),
      ...cols.map(c => h(`th${c.type === 'id' || c.type === 'text' ? '.left' : ''}`, { title: c.key }, c.label, c.tip ? tip(c.tip) : null, c.required ? h('span.req', { title: '필수' }, '*') : null)),
      h('th', {}, ''),
    )),
    h('tbody', {}, ...rows.map((r, i) => h('tr', { dataset: { row: i } },
      h('td.rownum', {}, String(i + 1)),
      ...cols.map(c => h('td', { dataset: { col: c.key } }, editor(c, r, i))),
      h('td.row-actions', {},
        h('button.mini-btn', { type: 'button', title: '이 행 복제', onclick: () => dupRow(i) }, '복제'),
        h('button.icon-x', { type: 'button', title: '행 삭제', 'aria-label': `${i + 1}행 삭제`, onclick: () => delRow(i) }, '×')),
    ))),
  );
  markIssues();
}

function editor(c, r, i) {
  const v = r[c.key];
  const commit = (nv, { structural = false } = {}) => {
    if (nv === '' || nv == null || (Array.isArray(nv) && !nv.length && c.type !== 'refs')) delete r[c.key]; else r[c.key] = nv;
    changed(structural);
  };
  const aria = `${TABLES[cur].label} ${i + 1}행 ${c.label}`;
  switch (c.type) {
    case 'id': return h('input.id-in', {
      type: 'text', value: v ?? '', 'aria-label': aria, spellcheck: false,
      onchange: (e) => {
        const nv = e.target.value.trim(), old = r.id;
        if (nv && old && nv !== old && !t[cur].some((x, k) => k !== i && x.id === nv)) { renameId(t, cur, old, nv); r.id = nv; changed(true); toast(`ID ${old} → ${nv} (참조도 함께 바꿈)`); return; }
        r.id = nv; changed(cur === 'elements');
      },
    });
    case 'num': return h('input', { type: 'text', inputmode: 'decimal', value: v ?? '', 'aria-label': aria, class: 'num-in',
      oninput: (e) => { const s = e.target.value.trim().replace(/,/g, ''); commit(s === '' ? null : Number.isFinite(Number(s)) ? Number(s) : e.target.value); } });
    case 'bool': return h('input', { type: 'checkbox', checked: v === true, 'aria-label': aria, onchange: (e) => commit(e.target.checked) });
    case 'enum': {
      const opts = Object.entries(c.options);
      return h('select', { 'aria-label': aria, onchange: (e) => commit(e.target.value || null) },
        h('option', { value: '' }, '—'),
        ...(v && !(v in c.options) ? [h('option', { value: v, selected: true }, `${v} (?)`)] : []),
        ...opts.map(([k, l]) => h('option', { value: k, selected: k === v }, l)));
    }
    case 'ref': {
      const ids = t[c.ref].map(x => x.id).filter(Boolean);
      return h('select', { 'aria-label': aria, onchange: (e) => commit(e.target.value || null) },
        h('option', { value: '' }, '—'),
        ...(v && !ids.includes(v) ? [h('option', { value: v, selected: true }, `${v} (없음)`)] : []),
        ...ids.map(id => h('option', { value: id, selected: id === v }, refLabel(c.ref, id))));
    }
    case 'refs': return h('input.refs-in', { type: 'text', value: (v || []).join('|'), 'aria-label': aria, spellcheck: false, list: `dl-${c.ref}`,
      placeholder: c.ref === 'effects' ? 'EF_…|EF_…' : 'SK_…|SK_…',
      oninput: (e) => commit(e.target.value.split(/[|;,]/).map(s => s.trim()).filter(Boolean)) });
    case 'phases': return h('input.refs-in.wide', { type: 'text', value: v ?? '', 'aria-label': aria, spellcheck: false, placeholder: '70=SK_A|SK_B; 30=SK_C', oninput: (e) => commit(e.target.value.trim()) });
    default: return h('input', { type: 'text', value: v ?? '', 'aria-label': aria, class: c.key === 'key' ? 'refs-in' : null,
      placeholder: c.key === 'key' ? synPlaceholder(r) : null, oninput: (e) => commit(e.target.value) });
  }
}
const refLabel = (table, id) => { const r = t[table].find(x => x.id === id); return r?.name ? `${id} · ${r.name}` : id; };
const synPlaceholder = (r) => ({ element: '화', role: Object.keys(ROLES).slice(0, 2).join('|'), chars: 'CH_…|CH_…' }[r.cond] || '');

/** 값만 바뀌면 입력칸은 그대로 두고 검증 표시만 다시, 구조가 바뀌면 표를 다시 그림 */
function changed(structural) {
  save();
  result = validateTables(t);
  renderSummary();
  renderTabs();
  if (structural) renderGrid(); else markIssues();
}

function markIssues() {
  els.grid.querySelectorAll('.cell-bad, .cell-warn').forEach(td => { td.classList.remove('cell-bad', 'cell-warn'); td.removeAttribute('title'); });
  els.grid.querySelectorAll('tr.bad, tr.warn').forEach(tr => tr.classList.remove('bad', 'warn'));
  for (const x of result.issues.filter(x => x.table === cur)) {
    const tr = els.grid.querySelector(`tbody tr[data-row="${x.row}"]`);
    if (!tr) continue;
    tr.classList.add(x.level === 'error' ? 'bad' : 'warn');
    const td = tr.querySelector(`td[data-col="${CSS.escape(x.col)}"]`) || tr.querySelector('td[data-col="id"]');
    if (!td) continue;
    td.classList.add(x.level === 'error' ? 'cell-bad' : 'cell-warn');
    td.title = [td.title, x.msg].filter(Boolean).join('\n');
  }
  // ID 자동 완성 목록 (refs 칸)
  for (const k of ['skills', 'effects', 'characters']) {
    let dl = document.getElementById(`dl-${k}`);
    if (!dl) { dl = h('datalist', { id: `dl-${k}` }); document.body.append(dl); }
    dl.replaceChildren(...t[k].filter(r => r.id).map(r => h('option', { value: r.id }, r.name || '')));
  }
}

function focusCell(row, col) {
  const td = els.grid.querySelector(`tbody tr[data-row="${row}"] td[data-col="${CSS.escape(col)}"]`);
  td?.scrollIntoView({ block: 'center', inline: 'center' });
  td?.querySelector('input, select')?.focus();
}

// ── 행 조작 ─────────────────────────────────────────────
function addRow() {
  const T = TABLES[cur], rows = t[cur];
  const r = { id: nextId(rows, T.idPrefix) };
  if (cur === 'elements') {
    r.id = `속성${rows.length + 1}`;
    for (const x of rows) r[`vs:${x.id}`] = 1;
    r[`vs:${r.id}`] = 1;
    for (const x of rows) x[`vs:${r.id}`] = 1;
  } else {
    for (const c of T.cols) if (c.type === 'refs') r[c.key] = [];
    const defaults = { classes: { role: 'dealer', row: 'front' }, characters: { modMode: 'add', classId: t.classes[0]?.id, element: t.elements[0]?.id }, monsters: { row: 'front', element: t.elements[0]?.id }, skills: { target: 'enemy', area: 'single', mult: 1, cost: 0, cooldown: 0 }, effects: { kind: 'buff', chance: 100, duration: 2 }, synergies: { cond: 'element', count: 2 } }[cur];
    Object.assign(r, defaults, { name: `새 ${T.label} ${rows.length + 1}` });
  }
  rows.push(r);
  changed(true);
  focusCell(rows.length - 1, 'id');
}
function dupRow(i) {
  const rows = t[cur], copy = structuredClone(rows[i]);
  copy.id = cur === 'elements' ? `${copy.id}2` : nextId(rows, TABLES[cur].idPrefix);
  if (copy.name) copy.name += ' (복제)';
  if (cur === 'elements') { for (const x of rows) x[`vs:${copy.id}`] = x[`vs:${rows[i].id}`] ?? 1; copy[`vs:${copy.id}`] = rows[i][`vs:${rows[i].id}`] ?? 1; }
  rows.splice(i + 1, 0, copy);
  changed(true);
}
function delRow(i) {
  const r = t[cur][i];
  t[cur].splice(i, 1);
  if (cur === 'elements') for (const x of t.elements) delete x[`vs:${r.id}`];
  changed(true);
  toast(`${r.id || `${i + 1}행`} 삭제 — 이 ID를 참조하던 곳은 오류로 표시됩니다 (되돌리기 Ctrl+Z)`);
}

// ── 가져오기·내보내기 ───────────────────────────────────
function exportCSV() { downloadText(`table-${cur}.csv`, tableToCSV(t, cur), 'text/csv;charset=utf-8'); }

async function importCSV() {
  let f;
  try { f = await pickText('.csv,text/csv,.txt'); } catch { toast('파일을 읽지 못했습니다'); return; }
  const r = tableFromCSV(t, cur, f.text);
  if (!r.rows.length) { toast('불러올 행이 없습니다'); return; }
  t[cur] = r.rows;
  changed(true);
  const e = result.issues.filter(x => x.table === cur).length;
  toast(`${f.name}: ${r.rows.length}행 불러옴${r.unknown.length ? ` · 모르는 열 무시: ${r.unknown.join(', ')}` : ''}${r.missing.length ? ` · 없는 필수 열: ${r.missing.join(', ')}` : ''}${e ? ` · 문제 ${e}건 표시` : ''}`);
}

async function importJSON() {
  try {
    const data = await pickJSON();
    const r = tablesFromJSON(data, t);
    if (!r.touched.length) throw new Error();
    t = r.tables;
    if (r.touched.length === 1) cur = r.touched[0];
    changed(true);
    toast(`${r.touched.map(k => TABLES[k].label).join('·')} 테이블을 불러왔습니다${result.count.error ? ` — 오류 ${result.count.error}건 표시` : ''}`);
  } catch { toast('불러올 수 없는 파일입니다'); }
}

function resetAll() {
  if (!confirm('모든 테이블을 기본 데이터로 되돌릴까요? (되돌리기 Ctrl+Z로 다시 돌아올 수 있습니다)')) return;
  t = defaultTables();
  changed(true);
}
