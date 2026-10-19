// 성장 엑셀 표 템플릿 생성기 — 화면
// 장르 프리셋으로 공급원·세그먼트 초안을 채우고, base(와 증가율)를 마일스톤에 맞게 풀고, 결과를 미리 본 뒤
// 수식이 살아 있는 .xlsx로 내보낸다. 콘텐츠 규칙은 내보낸 엑셀의 ② 공급원에 행을 더해 늘린다.
import { analyze, solveBase, solveRate, levelDays, PERIODS, UNLOCKS, METHODS, WEEKDAYS, LIMITS } from './model.js';
import { buildXlsx } from './xlsx.js';
import { TEMPLATES } from './presets.js';
import { drawChart as liveChart } from '../lib/chart.js';
import { h, store, encodeState, decodeState, downloadJSON, downloadText, pickJSON, toast, debounce, comma } from '../lib/util.js';

const SCHEMA = 1;
const STORE_KEY = 'growth:v1';
const LEVEL = { serious: '심각', warn: '주의', info: '참고' };
const COLORS = ['--series-1', '--series-2', '--series-3', '--series-4', '--role-tool', '--bad'];

let state, els = {}, timer, tablesDirty = true, last = null;
const save = debounce(() => store.set(STORE_KEY, state), 300);
const schedule = (ms = 150) => { clearTimeout(timer); timer = setTimeout(recompute, ms); };
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const colorOf = (i) => cssVar(COLORS[i % COLORS.length]) || '#2a78d6';

function defaultState(id) { return { v: SCHEMA, template: id, ...TEMPLATES[id].make() }; }
function hydrate(o) { return o && o.v === SCHEMA && TEMPLATES[o.template] ? { ...defaultState(o.template), ...o } : null; }
function readHash() { const m = location.hash.match(/^#growth\?s=([\w-]+)/); return m ? hydrate(decodeState(m[1])) : null; }
const toConfig = () => ({ days: state.days, maxLevel: state.maxLevel, ref: state.ref, curve: state.curve, table: state.table, sources: state.sources, segments: state.segments, milestones: state.milestones });

export function mount(root) {
  state = readHash() || hydrate(store.get(STORE_KEY)) || defaultState('mmo');
  if (location.hash.startsWith('#growth?')) history.replaceState(null, '', '#growth');
  build(root);
  rebuild();
  document.addEventListener('themechange', () => last && drawCharts(last));
  window.addEventListener('hashchange', () => { const st = readHash(); if (st) { state = st; history.replaceState(null, '', '#growth'); rebuild(); } });
}

// ── 골격 ────────────────────────────────────────────────
function build(root) {
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '성장 표 템플릿 (엑셀)'),
        h('p', {}, '레벨 곡선과 콘텐츠 공급원, 유저 세그먼트를 정하면 일차별 레벨 진행을 미리 보여 주고, 수식이 살아 있는 엑셀(.xlsx)로 내보냅니다. 툴은 시트 구조·수식·초기값만 만들고, 게임마다 다른 콘텐츠 규칙은 엑셀의 ② 공급원 시트에 행을 더해 늘립니다.'),
      ),
      h('div.tool-actions', {},
        els.xlsxBtn = h('button.btn.primary', { type: 'button', onclick: exportXlsx, title: '① 레벨 곡선 · ② 공급원 · ③ 세그먼트 · ④ 일차별 진행 · ⑤ 검증 시트를 수식으로 채운 엑셀 파일' }, '엑셀(.xlsx) 내보내기'),
        h('button.btn', { type: 'button', onclick: copyShareLink }, '공유 링크'),
        h('button.btn', { type: 'button', onclick: () => downloadJSON(`growth-${state.template}.json`, { schemaVersion: SCHEMA, tool: 'growth', state }) }, 'JSON 저장'),
        h('button.btn', { type: 'button', onclick: importJSON }, '불러오기'),
      ),
    ),
    h('div.layout', {},
      els.settings = h('aside.settings.card', { 'aria-label': '설정' }),
      h('div.results', {},
        els.errors = h('ul.errors', { hidden: true }),
        els.kpis = h('div.kpis.econ-kpis'),
        h('div.card.role-out', {},
          h('div.card-head', {}, h('h2', {}, '레벨 진행 미리보기'), h('span.hint', {}, '세그먼트별 일차 → 끝 레벨 · 점 = 마일스톤 (기준 세그먼트)')),
          h('div.chart-box.tall', {}, els.progressCanvas = h('canvas', { role: 'img', 'aria-label': '세그먼트별 레벨 진행' })),
        ),
        h('div.card.role-out', {},
          h('div.card-head', {}, h('h2', {}, '레벨당 일수'), h('span.hint', {}, '레벨 L에 닿는 데 걸린 날 (도달일(L) − 도달일(L−1)) · 0 = 하루에 여러 레벨')),
          h('div.chart-box', {}, els.lpdCanvas = h('canvas', { role: 'img', 'aria-label': '레벨당 일수' })),
        ),
        h('div.card.role-in', {},
          h('div.card-head', {}, h('h2', {}, '② 공급원'), h('span.hint', {}, '한 행 = 콘텐츠 하나 · 엑셀에서는 빈 행에 적으면 바로 반영 (100행까지)')),
          h('div.table-wrap', {}, els.srcTable = h('table.stages.edit-table.growth-src', {})),
          h('div.table-foot', {}, h('span.muted.small', {}, '비중 = 기준 세그먼트의 기간 총공급 중 이 공급원의 몫'), h('button.btn.small', { type: 'button', onclick: addSource }, '+ 공급원 추가')),
          h('p.desc', {}, '주기 — 매일: 접속한 날 · 매주: 7·14·21…일차에, 그 주에 한 번이라도 접속했으면 · 1회: 해금 일차, 또는 시작 레벨이 처음 해금 레벨 이상이 된 날. 획득 방식 — 고정: 값 그대로 · 표: 값 × 레벨별 기준 획득량(왼쪽 설정) · %: 값% × 현재 레벨 필요량. 시간 비례면 × 하루 플레이 분 ÷ 60.'),
        ),
        h('div.card.role-in', {},
          h('div.card-head', {}, h('h2', {}, '③ 세그먼트'), h('span.hint', {}, '요일별 접속 (1일차 = 월요일) · 무작위 없음')),
          h('div.table-wrap', {}, els.segTable = h('table.stages.edit-table.growth-seg', {})),
          h('div.table-foot', {}, h('span.muted.small', {}, `최대 ${LIMITS.segments}개 · 엑셀의 ④ 시트 열 묶음은 내보낼 때의 세그먼트 수로 정해짐`), h('button.btn.small', { type: 'button', onclick: addSegment }, '+ 세그먼트 추가')),
        ),
        els.findings = h('div.card.role-check'),
        h('details.card.role-out', {},
          h('summary', {}, h('h2', {}, '① 레벨별 필요량 표'), h('span.hint', {}, '엑셀 ① 시트와 같은 값')),
          h('div.table-wrap', {}, els.curveTable = h('table.stages', {})),
        ),
        h('div.card.role-tool', {},
          h('div.card-head', {}, h('h2', {}, '내보낸 엑셀의 구성')),
          h('ul.disc-notes', {},
            h('li', {}, h('b', {}, '① 레벨 곡선'), ' — base·점프 배율·상한·증가율 구간·점프 레벨(파란 칸)과 레벨별 원래 값·필요량·누적·표 기준 획득량(수식).'),
            h('li', {}, h('b', {}, '② 공급원'), ' — 한 행 = 콘텐츠 하나. 주기·해금·획득 방식은 드롭다운. 보정 배율·세그먼트 횟수는 비우면 1이고, 특이 규칙은 그 칸에 수식을 넣으면 됩니다.'),
            h('li', {}, h('b', {}, '③ 세그먼트'), ' — 하루 플레이 분과 요일별 접속(1/0). 기준 세그먼트는 B1.'),
            h('li', {}, h('b', {}, '④ 일차별 진행'), ' — 세그먼트마다 시작 레벨·접속·이번 주 접속·공급·추가 공급(직접 수식)·누적·끝 레벨·무성장 연속. 전날 행만 참조합니다.'),
            h('li', {}, h('b', {}, '⑤ 검증'), ' — 세그먼트 요약(끝 레벨·최장 무성장), 마일스톤 목표일 대비 실제, 공급원별 총량·비중, 레벨별 도달일·레벨당 일수와 차트.'),
          ),
          h('p.desc', {}, '이 화면의 숫자는 엑셀 수식과 같은 규칙으로 계산한 값입니다 — 자동 테스트가 내보낸 파일을 다시 계산해 이 값과 같은지 확인합니다.'),
        ),
      ),
    ),
  );
}

// ── 설정 ────────────────────────────────────────────────
function num(obj, key, label, opts = {}) {
  return h('label.field', {}, h('span', {}, label), h('input', {
    type: 'number', value: obj[key], min: opts.min ?? 0, step: opts.step ?? 'any', 'aria-label': label,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { obj[key] = opts.int ? Math.round(v) : v; if (opts.structural) tablesDirty = true; schedule(); } },
  }));
}
const sel = (options, value, onchange, label) => h('select', { 'aria-label': label, onchange: (e) => onchange(e.target.value) }, ...options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));

function renderSettings() {
  const c = state.curve;
  const bandRows = c.bands.map((b, i) => h('div.band-row', {},
    num(b, 'from', i ? '시작 레벨' : '시작 레벨 (첫 구간 = 1)', { min: 1, int: true }),
    num(b, 'rate', '증가율 %', { min: -50 }),
    c.bands.length > 1 ? h('button.icon-x', { type: 'button', title: '구간 삭제', onclick: () => { c.bands.splice(i, 1); renderSettings(); schedule(0); } }, '×') : h('span'),
  ));
  els.settings.replaceChildren(
    h('label.field', {}, h('span', {}, '템플릿'), sel(Object.entries(TEMPLATES).map(([id, t]) => [id, t.label]), state.template, (v) => { state = defaultState(v); rebuild(); }, '템플릿')),
    h('p.preset-note', {}, TEMPLATES[state.template].note),
    h('div.row2', {}, num(state, 'days', '기간 (일)', { min: 1, int: true }), num(state, 'maxLevel', '최대 레벨', { min: 2, int: true, structural: true })),
    h('div.option', {},
      h('span.group-title', {}, '① 레벨 곡선'),
      h('div.row3', {}, num(c, 'base', 'base (Lv1→2)', { min: 1 }), num(c, 'jumpMult', '점프 배율', { min: 0.01 }), num(c, 'cap', '상한 (0=없음)')),
      ...bandRows,
      c.bands.length < LIMITS.bands ? h('button.btn.small', { type: 'button', onclick: () => { const lastB = c.bands.at(-1); c.bands.push({ from: Math.min(state.maxLevel, (lastB?.from ?? 1) + 10), rate: lastB?.rate ?? 5 }); renderSettings(); schedule(0); } }, '+ 증가율 구간') : null,
      h('label.field', {}, h('span', {}, '점프 레벨 (쉼표로 구분)'), h('input', {
        type: 'text', value: c.jumps.join(', '), 'aria-label': '점프 레벨',
        oninput: (e) => { c.jumps = e.target.value.split(/[,\s]+/).map(Number).filter(x => Number.isInteger(x) && x >= 2).slice(0, LIMITS.jumps); schedule(); },
      })),
      h('p.desc', {}, '필요량(L) = 필요량(L−1) × (1 + 증가율) × (점프 레벨이면 점프 배율). 단일 증가율은 후반에 폭주하기 쉬우니 구간을 나누거나 상한을 두세요. 콘텐츠 경계에서 한 번 크게 오르는 "완만한 경사 + 점프"가 MMO에 잘 맞습니다.'),
    ),
    h('div.option', {},
      h('span.group-title', {}, '레벨별 기준 획득량 (표 방식)'),
      h('div.row2', {}, num(state.table, 'start', 'Lv1 값'), num(state.table, 'rate', '레벨당 증가율 %', { min: -50 })),
      h('p.desc', {}, '"표" 방식 공급원이 곱해 쓰는 레벨별 값입니다. 예: 사냥 시간당 경험치 — 레벨이 오를수록 사냥 효율이 오르는 구조.'),
    ),
    h('div.option', {},
      h('span.group-title', {}, '마일스톤 (기준 세그먼트)'),
      h('label.field', {}, h('span', {}, '기준 세그먼트'), sel(state.segments.map((s, i) => [i, s.name]), state.ref, (v) => { state.ref = +v; schedule(0); }, '기준 세그먼트')),
      ...state.milestones.map((m, i) => h('div.row2', {}, num(m, 'level', `${i + 1}. 레벨`, { min: 2, int: true }), num(m, 'day', '목표 일차', { min: 1, int: true }))),
      h('div.tool-actions', {},
        h('button.btn.small.primary', { type: 'button', onclick: fitBase, title: '증가율은 그대로, 첫 마일스톤에 맞는 base를 이분 탐색으로' }, 'base 맞추기'),
        h('button.btn.small', { type: 'button', onclick: fitRate, title: '모든 구간 증가율에 같은 배율을 곱해 두 번째 마일스톤까지 맞춤 (base도 다시)' }, '증가율까지 맞추기'),
      ),
      h('p.desc', {}, 'base 맞추기 = 기준 세그먼트가 첫 마일스톤 레벨에 목표 일차 안에 닿는 가장 큰 base (도달일은 base에 대해 단조라 이분 탐색). 증가율까지 맞추기 = 그 위에서 두 번째 마일스톤도 맞도록 증가율 배율을 다시 이분 탐색.'),
    ),
  );
}

function rebuild() { renderSettings(); tablesDirty = true; recompute(); }

// ── 계산 ────────────────────────────────────────────────
function recompute() {
  save();
  const res = analyze(toConfig());
  if (!res.ok) {
    els.errors.replaceChildren(...res.errors.map(e => h('li', {}, e)));
    els.errors.hidden = false;
    return;
  }
  els.errors.hidden = true;
  last = res;
  if (tablesDirty || !els.srcTable.contains(document.activeElement) && !els.segTable.contains(document.activeElement)) { renderTables(); tablesDirty = false; }
  updateResults(res);
  renderKPIs(res);
  drawCharts(res);
  renderFindings(res);
  renderCurveTable(res);
}

function renderKPIs(r) {
  const R = r.segs[r.ref];
  const tile = (label, value, sub, hero) => h(`div.card.kpi${hero ? '.hero' : ''}`, {}, h('div.kpi-label', {}, label), h('div.kpi-value', {}, value), h('div.kpi-sub', {}, sub));
  const ms = r.milestones.map(m => tile(`Lv${m.level} 도달 (${R.seg.name})`, m.actual == null ? '미도달' : `${m.actual}일차`, m.actual == null ? `목표 ${m.day}일차 · 기간 안에 못 닿음` : m.diff === 0 ? `목표 ${m.day}일차와 같음` : `목표 ${m.day}일차보다 ${Math.abs(m.diff)}일 ${m.diff > 0 ? '늦음' : '빠름'}`, true));
  els.kpis.replaceChildren(...ms,
    tile('최장 무성장 기간', r.segs.map(s => `${s.maxStall}일`).join(' · '), r.segs.map(s => s.seg.name).join(' · ') + ' — 레벨이 오르지 않고 이어진 날'),
    tile(`${state.days}일차 끝 레벨`, r.segs.map(s => `Lv${s.endLevel}`).join(' · '), r.segs.map(s => s.seg.name).join(' · ') + ` · 최대 Lv${state.maxLevel}`),
  );
}

function drawCharts(r) {
  if (typeof Chart === 'undefined') return;
  const grid = cssVar('--grid'), tick = cssVar('--text-3'), ink = cssVar('--text-2');
  const ds = r.segs.map((s, i) => ({ label: s.seg.name, data: s.rows.map(x => ({ x: x.d, y: x.end })), borderColor: colorOf(i), backgroundColor: colorOf(i), borderWidth: 2, pointRadius: 0, stepped: 'after' }));
  ds.push({ type: 'scatter', label: '마일스톤', data: r.milestones.map(m => ({ x: m.day, y: m.level })), pointStyle: 'rectRot', pointRadius: 7, borderColor: ink, backgroundColor: ink });
  liveChart('growth:progress', els.progressCanvas, {
    type: 'line', data: { datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false, interaction: { mode: 'nearest', intersect: false },
      scales: { x: { type: 'linear', min: 0, max: state.days, grid: { color: grid }, ticks: { color: tick }, title: { display: true, text: '일차', color: tick } }, y: { min: 1, max: state.maxLevel, grid: { color: grid }, ticks: { color: tick }, title: { display: true, text: '레벨', color: tick } } },
      plugins: { legend: { labels: { color: ink, boxWidth: 14, boxHeight: 2 } }, tooltip: { callbacks: { label: (it) => (it.dataset.type === 'scatter' ? `마일스톤 Lv${it.raw.y} · ${it.raw.x}일차` : `${it.dataset.label}: ${it.raw.x}일차 Lv${it.raw.y}`) } } },
    },
  });
  const lds = r.segs.map((s, i) => ({ label: s.seg.name, data: levelDays(s.reach, state.maxLevel).map(x => ({ x: x.level, y: x.days })), borderColor: colorOf(i), backgroundColor: colorOf(i), borderWidth: 2, pointRadius: 0, spanGaps: false }));
  liveChart('growth:lpd', els.lpdCanvas, {
    type: 'line', data: { datasets: lds },
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false, interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      scales: { x: { type: 'linear', min: 2, max: state.maxLevel, grid: { color: grid }, ticks: { color: tick }, title: { display: true, text: '레벨', color: tick } }, y: { beginAtZero: true, grid: { color: grid }, ticks: { color: tick }, title: { display: true, text: '레벨당 일수', color: tick } } },
      plugins: { legend: { labels: { color: ink, boxWidth: 14, boxHeight: 2 } }, tooltip: { callbacks: { title: (it) => `Lv${it[0].raw.x}`, label: (it) => `${it.dataset.label}: ${it.raw.y}일` } } },
    },
  });
}

function renderFindings(r) {
  const counts = r.warnings.reduce((m, f) => ((m[f.level] = (m[f.level] || 0) + 1), m), {});
  els.findings.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '검증 결과'), h('span.hint', {}, ['serious', 'warn', 'info'].filter(l => counts[l]).map(l => `${LEVEL[l]} ${counts[l]}`).join(' · ') || '문제 없음')),
    r.warnings.length ? h('ul.findings', {}, ...r.warnings.map(f => h(`li.${f.level}`, {}, h('span.lv', {}, LEVEL[f.level]), h('span', {}, f.text)))) : h('p.muted', {}, '마일스톤과 맞고, 멈추는 구간·후반 폭주가 없습니다.'),
  );
}

function renderCurveTable(r) {
  const c = r.curve, rows = [];
  for (let L = 1; L <= state.maxLevel; L++) rows.push(h(`tr${c.jump[L] ? '.ms-row' : ''}`, {}, h('td', {}, `Lv${L}`), h('td', {}, `${c.rate[L]}%`), h('td', {}, c.jump[L] ? '점프' : ''), h('td', {}, comma(c.need[L])), h('td', {}, comma(c.cum[L])), h('td', {}, comma(c.table[L]))));
  els.curveTable.replaceChildren(
    h('thead', {}, h('tr', {}, ...['레벨', '증가율', '점프', '필요량 (L→L+1)', '누적 (L 도달)', '표 기준 획득량'].map(t => h('th', {}, t)))),
    h('tbody', {}, ...rows),
  );
}

// ── 표 편집 ─────────────────────────────────────────────
function cellNum(obj, key, label, opts = {}) {
  return h('td', {}, h('input', { type: 'number', value: obj[key] ?? '', step: 'any', min: opts.min ?? 0, 'aria-label': label, class: opts.cls || null,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { obj[key] = v; schedule(); } } }));
}
function cellSel(obj, key, map, label) {
  return h('td', {}, sel(Object.entries(map), obj[key], (v) => { obj[key] = v; schedule(0); }, label));
}

function renderTables() {
  const segs = state.segments;
  els.srcTable.replaceChildren(
    h('thead', {}, h('tr', {}, ...['이름', '주기', '해금 기준', '해금 값', '획득 방식', '획득값', '시간 비례', '보정 배율', ...segs.map(s => `${s.name} 횟수`), '비중', ''].map((t, i) => h(`th${i === 0 ? '.left' : ''}`, {}, t)))),
    h('tbody', {}, ...state.sources.map((src, i) => h('tr', { dataset: { i } },
      h('td', {}, h('input.name', { type: 'text', value: src.name, 'aria-label': '공급원 이름', oninput: (e) => { src.name = e.target.value; schedule(300); } })),
      cellSel(src, 'period', PERIODS, '주기'),
      cellSel(src, 'unlock', UNLOCKS, '해금 기준'),
      cellNum(src, 'unlockAt', '해금 값', { cls: 'short' }),
      cellSel(src, 'method', METHODS, '획득 방식'),
      cellNum(src, 'value', '획득값'),
      h('td', {}, h('input', { type: 'checkbox', checked: !!src.timed, 'aria-label': '시간 비례', onchange: (e) => { src.timed = e.target.checked; schedule(0); } })),
      cellNum(src, 'mult', '보정 배율', { cls: 'short' }),
      ...segs.map((_, k) => h('td', {}, h('input.short', { type: 'number', value: src.counts?.[k] ?? 1, step: 'any', min: 0, 'aria-label': `${segs[k].name} 횟수`,
        oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { (src.counts ||= [])[k] = v; schedule(); } } }))),
      h('td.res', { dataset: { k: 'share' } }),
      h('td.x', {}, h('button.icon-x', { type: 'button', title: '공급원 삭제', onclick: () => { state.sources.splice(i, 1); tablesDirty = true; schedule(0); } }, '×')),
    ))),
  );
  els.segTable.replaceChildren(
    h('thead', {}, h('tr', {}, ...['이름', '하루 플레이 (분)', ...WEEKDAYS, `${state.days}일차 끝 레벨`, '최장 무성장', ''].map((t, i) => h(`th${i === 0 ? '.left' : ''}`, {}, t)))),
    h('tbody', {}, ...segs.map((seg, i) => h('tr', { dataset: { i } },
      h('td', {}, h('input.name', { type: 'text', value: seg.name, 'aria-label': '세그먼트 이름', oninput: (e) => { seg.name = e.target.value; schedule(300); } })),
      cellNum(seg, 'minutes', '하루 플레이 분'),
      ...seg.days.map((d, k) => h('td', {}, h('input', { type: 'checkbox', checked: !!d, 'aria-label': `${seg.name} ${WEEKDAYS[k]} 접속`, onchange: (e) => { seg.days[k] = e.target.checked ? 1 : 0; schedule(0); } }))),
      h('td.res', { dataset: { k: 'end' } }), h('td.res', { dataset: { k: 'stall' } }),
      h('td.x', {}, segs.length > 1 ? h('button.icon-x', { type: 'button', title: '세그먼트 삭제', onclick: () => removeSegment(i) }, '×') : null),
    ))),
  );
}

function updateResults(r) {
  const R = r.segs[r.ref], total = R.total || 1;
  els.srcTable.querySelectorAll('tbody tr').forEach(tr => {
    const i = +tr.dataset.i, cell = tr.querySelector('[data-k="share"]');
    if (cell) cell.textContent = R.bySource[i] != null ? `${((R.bySource[i] / total) * 100).toFixed(1)}%` : '—';
  });
  els.segTable.querySelectorAll('tbody tr').forEach(tr => {
    const s = r.segs[+tr.dataset.i]; if (!s) return;
    tr.querySelector('[data-k="end"]').textContent = `Lv${s.endLevel}`;
    tr.querySelector('[data-k="stall"]').textContent = `${s.maxStall}일`;
  });
}

function addSource() {
  if (state.sources.length >= LIMITS.sources) { toast(`공급원은 ${LIMITS.sources}개까지입니다`); return; }
  state.sources.push({ name: `공급원 ${state.sources.length + 1}`, period: 'daily', unlock: 'day', unlockAt: 1, method: 'fixed', value: 100, timed: false, mult: 1, counts: state.segments.map(() => 1) });
  tablesDirty = true; schedule(0);
}
function addSegment() {
  if (state.segments.length >= LIMITS.segments) { toast(`세그먼트는 ${LIMITS.segments}개까지입니다`); return; }
  state.segments.push({ name: `세그먼트 ${state.segments.length + 1}`, minutes: 60, days: [1, 1, 1, 1, 1, 1, 1] });
  for (const s of state.sources) (s.counts ||= []).push(1);
  tablesDirty = true; renderSettings(); schedule(0);
}
function removeSegment(i) {
  state.segments.splice(i, 1);
  for (const s of state.sources) s.counts?.splice(i, 1);
  if (state.ref >= state.segments.length) state.ref = state.segments.length - 1;
  else if (state.ref > i) state.ref--;
  tablesDirty = true; renderSettings(); schedule(0);
}

// ── base·증가율 풀이 ─────────────────────────────────────
function fitBase() {
  const r = solveBase(toConfig());
  if (!r.feasible) { toast(r.note || '맞는 base를 찾지 못했습니다'); return; }
  state.curve.base = r.base;
  renderSettings(); schedule(0);
  toast(`base = ${comma(r.base)} — Lv${state.milestones[0].level}에 ${r.actual}일차 도달`);
}
function fitRate() {
  const r = solveRate(toConfig());
  if (!r.feasible && !r.bands) { toast(r.note || '맞는 증가율을 찾지 못했습니다'); return; }
  state.curve.bands = r.bands;
  const b = solveBase(toConfig());
  if (b.feasible) state.curve.base = b.base;
  renderSettings(); schedule(0);
  const res = analyze(toConfig());
  const m2 = res.ok ? res.milestones[1] : null;
  toast(`증가율 ×${r.k} · base ${comma(state.curve.base)}${m2 ? ` — Lv${m2.level}에 ${m2.actual ?? '미도달'}${m2.actual != null ? '일차' : ''} 도달 (목표 ${m2.day}일차)` : ''}`);
}

// ── 내보내기·공유 ───────────────────────────────────────
function exportXlsx() {
  const res = analyze(toConfig());
  if (!res.ok) { toast('먼저 오류를 고쳐 주세요'); return; }
  const bytes = buildXlsx(toConfig());
  downloadText(`성장표-${TEMPLATES[state.template].label.split(' ')[0]}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  toast('엑셀 파일을 저장했습니다 — 열면 모든 시트가 수식으로 다시 계산됩니다');
}
function copyShareLink() {
  const url = `${location.origin}${location.pathname}#growth?s=${encodeState(state)}`;
  navigator.clipboard?.writeText(url).then(() => toast('공유 링크를 복사했습니다'), () => prompt('공유 링크', url));
}
async function importJSON() {
  try {
    const data = await pickJSON();
    const st = data?.tool === 'growth' ? hydrate(data.state) : null;
    if (!st) throw new Error();
    state = st; rebuild(); toast('설정을 불러왔습니다');
  } catch { toast('불러올 수 없는 파일입니다'); }
}
