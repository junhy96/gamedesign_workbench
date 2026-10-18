// 스탯·전투 밸런스 — 화면: 왼쪽 규칙(템플릿·전투 방식·수식), 오른쪽 엔티티·아이템 표 → 레벨 곡선 → 승률 행렬 → 1:1 상세 → 검증
import {
  analyze, compileRules, curves, matrix, duel, duelSim, prepare, killStats, statsAt, fromKalivra,
  MODES, TIES, ROUNDS, GROWTHS, FORMULA_KEYS, METRICS, josa, TRIGGERS, EFFECTS, EFFECT_BASES, phaseRanges, phaseReport, sweepPlan, sweepAt, traitsOf, scoreOf, compareBuilds, minChanges, battleSensitivity, contributions, solveTarget, applyScale,
} from './model.js';
import { TEMPLATES, FORMULA_PRESETS, TRAIT_PRESETS } from './presets.js';
import { unityFiles, unrealFiles } from './export.js';
import { makeZip } from '../lib/zip.js';
import { h, store, encodeState, decodeState, downloadJSON, downloadText, toast, debounce, comma } from '../lib/util.js';

const SCHEMA = 1;
const STORE_KEY = 'battle:v1';
const PALETTE = 8; // --cat-1 … --cat-8 (고정 순서, 9번째부터는 회색)

let state, last, timer, chartCurve, chartPair;
const els = {};
const save = debounce(() => store.set(STORE_KEY, state), 300);
const schedule = (ms = 200) => { clearTimeout(timer); timer = setTimeout(recompute, ms); };

function defaultState(id) { return { v: SCHEMA, template: id, pairA: 0, pairB: 1, selected: [], ...TEMPLATES[id].make() }; }
function hydrate(o) {
  if (o?.tool === 'battle' && o.state) o = o.state;
  return o && o.v === SCHEMA && TEMPLATES[o.template] ? { ...defaultState(o.template), ...o } : null;
}
function readHash() { const m = location.hash.match(/^#battle\?s=([\w-]+)/); return m ? hydrate(decodeState(m[1])) : null; }
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const colorOf = (i) => (i < PALETTE ? cssVar(`--cat-${i + 1}`) : cssVar('--text-3'));
const pct = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : '—');
const num = (x, d = 1) => (Number.isFinite(x) ? (Math.abs(x) >= 1000 ? comma(x) : (+x.toFixed(d)).toLocaleString('ko-KR')) : '—');
const sec = (x) => (Number.isFinite(x) ? `${(+x.toFixed(2)).toLocaleString('ko-KR')}초` : '—');
// replaceChildren은 null을 'null' 글자로 넣으므로 빈 값을 걸러서 넣는다
const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
const uid = (p, xs) => { let i = xs.length + 1; while (xs.some(x => x.id === `${p}${i}`)) i++; return `${p}${i}`; };

export function mount(root) {
  state = readHash() || hydrate(store.get(STORE_KEY)) || defaultState('classes');
  if (location.hash.startsWith('#battle?')) history.replaceState(null, '', '#battle');
  build(root);
  rebuild();
  document.addEventListener('themechange', () => last && (drawCurves(last), renderPair(last), startPhase(last)));
  window.addEventListener('hashchange', () => { const st = readHash(); if (st) { state = st; history.replaceState(null, '', '#battle'); rebuild(); } });
}

// ── 골격 ────────────────────────────────────────────────
function build(root) {
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '스탯·전투 밸런스'),
        h('p', {}, '엔티티 × 스탯 × 규칙 수식으로 레벨별 전투력과 1:1 승률을 계산합니다. 데미지 변동이 없으면 승률을 시뮬레이션 없이 공식으로 바로 계산하고, 공격 속도는 같은 시간 동안의 공격 횟수로 반영합니다. Kalivra 프로젝트(.kal)를 그대로 불러올 수 있습니다.'),
      ),
      els.head = h('div.tool-actions', {}),
    ),
    els.notes = h('div.import-notes', { hidden: true }),
    h('div.enh-layout', {},
      els.side = h('aside.enh-side', { 'aria-label': '규칙 설정' }),
      h('div.enh-main', {},
        els.errors = h('ul.errors', { hidden: true }),
        els.kpis = h('div.kpis.econ-kpis'),
        els.entCard = h('div.card.role-in'),
        els.itemCard = h('div.card.role-in'),
        h('div.card.role-out', {},
          h('div.card-head', {}, h('h2', {}, '레벨 곡선'), els.curveHint = h('span.hint', {})),
          els.curveTabs = h('div.seg-tabs', {}),
          h('div.chart-box.tall', {}, els.curveCanvas = h('canvas', { role: 'img', 'aria-label': '엔티티별 레벨 곡선' })),
          els.cross = h('div.cross-list', {}),
        ),
        els.mxCard = h('div.card.role-out'),
        els.pairCard = h('div.card.role-out'),
        els.phaseCard = h('div.card.role-out'),
        els.checkCard = h('div.card.role-check'),
        els.toolCard = h('div.card.role-tool'),
      ),
    ),
  );
}

function renderHead() {
  const b = state.baseline;
  put(els.head, ...[
    b ? h('span.badge', { title: '저장한 기준안과 비교 중 (곡선 점선, 행렬 변화)' }, `기준안: ${b.label}`) : null,
    h('button.btn', { type: 'button', onclick: saveBaseline }, '기준안 저장'),
    b ? h('button.btn', { type: 'button', onclick: () => { state.baseline = null; rebuild(); } }, '기준안 해제') : null,
    h('button.btn', { type: 'button', onclick: copyShareLink }, '공유 링크'),
    h('button.btn', { type: 'button', onclick: importKalivra, title: 'Kalivra 프로젝트 파일(.kal 또는 JSON)을 불러옵니다' }, 'Kalivra 가져오기'),
    h('button.btn', { type: 'button', onclick: exportStatsCSV }, '레벨별 스탯 CSV'),
    h('button.btn', { type: 'button', onclick: exportMatrixCSV }, '승률 행렬 CSV'),
    h('button.btn', { type: 'button', onclick: () => exportEngine('unity'), title: 'BattleData.json + ScriptableObject·가져오기 메뉴·규칙 수식 C# (zip)' }, 'Unity 내보내기'),
    h('button.btn', { type: 'button', onclick: () => exportEngine('unreal'), title: 'DataTable CSV·JSON + 행 구조체·규칙 수식 C++ (zip)' }, 'Unreal 내보내기'),
    h('button.btn', { type: 'button', onclick: saveJSON }, 'JSON 저장'),
    h('button.btn', { type: 'button', onclick: importJSON }, '불러오기'),
  ].filter(Boolean));
}

// ── 공용 입력 ───────────────────────────────────────────
const field = (label, input, hint) => h('label.field', {}, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
function numIn(obj, key, opts = {}) {
  return h('input', {
    type: 'number', value: obj[key] ?? '', step: opts.step ?? 'any', min: opts.min, max: opts.max, 'aria-label': opts.label, class: opts.cls, placeholder: opts.placeholder,
    oninput: (e) => {
      const raw = e.target.value.trim();
      if (raw === '' && opts.allowEmpty) { delete obj[key]; schedule(); return; }
      const v = parseFloat(raw); if (!Number.isFinite(v)) return;
      obj[key] = opts.int ? Math.round(v) : v; opts.after?.(); schedule();
    },
  });
}
const select = (options, value, onchange, label) => h('select', { 'aria-label': label, onchange: (e) => onchange(e.target.value) }, ...options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));

const OPEN_KEY = 'battle:sideOpen';
function section(id, title, summary, ...body) {
  const open = (store.get(OPEN_KEY) || {})[id] ?? (id === 'base' || matchMedia('(min-width: 1101px)').matches);
  return h('details.side-sec', { open, ontoggle: (e) => store.set(OPEN_KEY, { ...(store.get(OPEN_KEY) || {}), [id]: e.target.open }) },
    h('summary', {}, h('span.side-title', {}, title), summary ? h('span.side-sum', {}, summary) : null),
    h('div.side-body', {}, ...body.filter(Boolean)));
}

// ── 왼쪽: 규칙 ──────────────────────────────────────────
function renderSide() {
  const s = state, r = s.rules;
  els.fErr = {};
  const formula = (key) => {
    const [label, kind] = FORMULA_KEYS[key];
    const presets = FORMULA_PRESETS[key];
    const input = h('input.formula', {
      type: 'text', value: r[key], spellcheck: false, 'aria-label': `${label} 수식`,
      oninput: (e) => { r[key] = e.target.value; schedule(250); },
    });
    els.fErr[key] = h('small.formula-err', {});
    return h('label.field', {},
      h('span', {}, label, h('span.muted.small', {}, kind === 'self' ? ' · 자기 스탯' : ' · a 공격 / b 방어')),
      input,
      presets ? select([['', '프리셋 고르기…'], ...presets.map(([l, v]) => [v, l])], '', (v) => { if (v) { r[key] = v; input.value = v; schedule(0); } }, `${label} 프리셋`) : null,
      els.fErr[key]);
  };
  put(els.side, 
    section('base', '템플릿 · 레벨', `Lv1~${s.maxLevel} · 기준 Lv${s.level}`,
      select(Object.entries(TEMPLATES).map(([id, t]) => [id, t.label]), s.template, (v) => { state = defaultState(v); els.notes.hidden = true; rebuild(); }, '템플릿'),
      h('p.desc', {}, TEMPLATES[s.template].note),
      h('div.row2', {},
        field('최대 레벨', numIn(s, 'maxLevel', { int: true, min: 1, max: 1000, label: '최대 레벨' })),
        field('기준 레벨 (행렬)', numIn(s, 'level', { int: true, min: 1, label: '기준 레벨' }))),
      field('구간 경계 (레벨, 쉼표)', h('input', {
        type: 'text', value: (s.phases || []).join(', '), placeholder: `비우면 ${Math.round(s.maxLevel / 3)}, ${Math.round(2 * s.maxLevel / 3)}`, 'aria-label': '구간 경계',
        oninput: (e) => { const xs = e.target.value.split(/[\s,]+/).filter(Boolean).map(Number); if (xs.every(Number.isFinite)) { s.phases = xs; schedule(300); } },
      }), '예: 10, 20 → Lv1~10 · 11~20 · 21~끝 (구간 리포트)'),
    ),
    section('mode', '전투 방식', MODES[r.mode].split(' (')[0],
      field('진행', select(Object.entries(MODES), r.mode, (v) => { r.mode = v; renderSide(); schedule(0); }, '전투 진행 방식'),
        r.mode === 'time' ? 'n번째 공격 시각 = (n − 1) ÷ 공격 속도. 공격 속도 2배 = 같은 시간에 공격 2배' : 'Kalivra와 같음: 공격 속도 비율로 선공을 정한 뒤 한 번씩 번갈아 공격. 공격 속도는 선공 확률에만 쓰입니다'),
      r.mode === 'time'
        ? h('div.row2', {},
          field('최대 전투 시간 (초)', numIn(r, 'maxTime', { min: 1, label: '최대 전투 시간' })),
          field('동시 결정타', select(Object.entries(TIES), r.tie, (v) => { r.tie = v; schedule(0); }, '동시 결정타 처리')))
        : field('최대 턴', numIn(r, 'maxTurns', { int: true, min: 1, label: '최대 턴' }), 'Kalivra는 200턴'),
      h('div.row2', {},
        field('명중 하한 (%)', numIn(r, 'hitMin', { min: 0, max: 100, label: '명중 하한' })),
        field('명중 상한 (%)', numIn(r, 'hitMax', { min: 0, max: 100, label: '명중 상한' }))),
      h('div.row2', {},
        field('데미지 반올림', select(Object.entries(ROUNDS), r.round, (v) => { r.round = v; schedule(0); }, '데미지 반올림')),
        field('시뮬레이션 횟수', numIn(s.sim, 'runs', { int: true, min: 200, label: '시뮬레이션 횟수' }), '데미지 변동이 있을 때·검증용')),
      h('p.desc', {}, '시간·턴 안에 못 끝나면 무승부로 따로 셉니다 (Kalivra는 양쪽 모두 패배로 셈).'),
    ),
    section('formula', '규칙 수식', '코드 실행 없는 파서',
      ...Object.keys(FORMULA_KEYS).map(formula),
      h('p.desc', {}, '함수: min max clamp floor ceil round abs sqrt pow log exp · 조건: a.hp < 100 ? 2 : 1 · 레벨: lv · 명중은 하한~상한, 치명 확률은 0~100으로 자릅니다.'),
    ),
  );
}

// ── 엔티티 × 스탯 표 ────────────────────────────────────
function renderEntities() {
  const S = state.stats, E = state.entities;
  const sel = new Set(state.selected || []);
  const statHead = (s, i) => h('th.stat-col', {},
    h('div.stat-head', {},
      h('input.stat-id', { type: 'text', value: s.id, 'aria-label': '스탯 이름(수식용)', title: '수식에서 쓰는 이름', onchange: (e) => renameStat(i, e.target.value.trim()) }),
      h('input.stat-name', { type: 'text', value: s.name ?? '', 'aria-label': '스탯 설명', placeholder: '설명', oninput: (e) => { s.name = e.target.value; save(); } }),
      select(Object.entries(GROWTHS).map(([k, v]) => [k, k === 'linear' ? '선형' : '등비 (g%)']), s.growth, (v) => { s.growth = v; schedule(0); }, `${s.id} 성장 방식`),
      h('div.stat-range', {},
        numIn(s, 'min', { allowEmpty: true, placeholder: '최소', label: `${s.id} 최소` }),
        numIn(s, 'max', { allowEmpty: true, placeholder: '최대', label: `${s.id} 최대` })),
      h('button.icon-x', { type: 'button', title: '스탯 삭제', disabled: S.length <= 1, onclick: () => removeStat(i) }, '×'),
    ));
  const cell = (e, s) => {
    const sv = e.stats[s.id] ??= { b: 0, g: 0 };
    if (sv.table) {
      return h('td.stat-cell', {},
        h('input.table-in', {
          type: 'text', value: sv.table.map(([l, v]) => `${l}:${v}`).join(' '), spellcheck: false, 'aria-label': `${e.name} ${s.id} 표`, title: '레벨:값 을 띄어 씀 (사이는 직선 보간)',
          oninput: (ev) => { const pts = parseTable(ev.target.value); if (pts) { sv.table = pts; ev.target.classList.remove('bad-input'); schedule(); } else ev.target.classList.add('bad-input'); },
        }),
        h('button.mini-btn', { type: 'button', title: '공식(기본 + 성장)으로 되돌리기', onclick: () => { delete sv.table; renderEntities(); schedule(0); } }, '공식'));
    }
    return h('td.stat-cell', {},
      h('div.bg', {},
        numIn(sv, 'b', { label: `${e.name} ${s.id} 기본값` }),
        numIn(sv, 'g', { label: `${e.name} ${s.id} 레벨당 ${s.growth === 'geo' ? '%' : '증가'}`, cls: 'g' })),
      h('button.mini-btn', { type: 'button', title: '레벨별 표로 입력 (레벨:값)', onclick: () => { sv.table = [[1, sv.b ?? 0], [state.maxLevel, (sv.b ?? 0) + (sv.g ?? 0) * (state.maxLevel - 1)]]; renderEntities(); schedule(0); } }, '표'));
  };
  els.bulk = { stat: S[0]?.id, part: 'b', op: 'mult', value: 1.1 };
  put(els.entCard, 
    h('div.card-head', {}, h('h2', {}, '엔티티와 스탯'), h('span.hint', {}, '칸마다 위 = 기본값(Lv1), 아래 = 레벨당 증가(등비면 %) · "표"로 레벨별 값을 직접 넣을 수 있음 (사이는 직선)')),
    h('div.table-wrap', {}, h('table.stages.ent-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th.left', {}, '엔티티'), h('th', { title: '데미지 ±비율 (0.1 = ±10%). 0이 아니면 시뮬레이션' }, '변동'), h('th', { title: '발동 시점 × 조건 × 효과. 있으면 시뮬레이션' }, '특성'), ...S.map(statHead), h('th', {}, ''))),
      h('tbody', {}, ...E.flatMap((e, i) => [h('tr', {},
        h('td', {}, h('input', { type: 'checkbox', checked: sel.has(e.id), 'aria-label': `${e.name} 선택 (일괄 편집)`, onchange: (ev) => { if (ev.target.checked) sel.add(e.id); else sel.delete(e.id); state.selected = [...sel]; save(); } })),
        h('td.left', {}, h('span.swatch', { style: `background:${colorOf(i)}` }), h('input.ent-name', { type: 'text', value: e.name, 'aria-label': '엔티티 이름', oninput: (ev) => { e.name = ev.target.value; schedule(300); } })),
        h('td', {}, numIn(e, 'variance', { min: 0, max: 0.99, step: 0.05, label: `${e.name} 데미지 변동`, cls: 'short' })),
        h('td', {}, traitButton(`e:${e.id}`, e)),
        ...S.map(s => cell(e, s)),
        h('td.x', {}, h('button.icon-x', { type: 'button', title: '엔티티 삭제', disabled: E.length <= 1, onclick: () => { E.splice(i, 1); state.pairA = 0; state.pairB = Math.min(1, E.length - 1); rebuild(); } }, '×')),
      )])),
    )),
    ...E.filter(e => openTraits.has(`e:${e.id}`)).map(e => h('div.trait-panel', {}, traitEditor(e, `${e.name}의 특성`, renderEntities))),
    h('div.table-foot', {},
      h('div.tool-actions', {},
        h('button.btn.small', { type: 'button', onclick: addEntity }, '+ 엔티티'),
        h('button.btn.small', { type: 'button', onclick: addStat }, '+ 스탯'),
        h('button.btn.small', { type: 'button', onclick: toggleCSV }, '표 붙여넣기 (CSV)'),
      ),
      h('div.tool-actions.bulk', {},
        h('span.muted.small', {}, '일괄:'),
        select(S.map(s => [s.id, s.id]), els.bulk.stat, (v) => { els.bulk.stat = v; }, '일괄 편집 스탯'),
        select([['b', '기본값'], ['g', '성장값']], 'b', (v) => { els.bulk.part = v; }, '일괄 편집 대상'),
        select([['mult', '× 곱하기'], ['add', '+ 더하기'], ['set', '= 바꾸기']], 'mult', (v) => { els.bulk.op = v; }, '일괄 연산'),
        h('input.short', { type: 'number', value: 1.1, step: 'any', 'aria-label': '일괄 값', oninput: (e) => { els.bulk.value = parseFloat(e.target.value); } }),
        h('button.btn.small', { type: 'button', onclick: applyBulk }, '선택(없으면 전체)에 적용'),
      ),
    ),
    els.csvBox = h('div.csv-import', { hidden: !els.csvOpen }),
  );
  if (els.csvOpen) renderCSV();
}

function parseTable(text) {
  const pts = [];
  for (const tok of text.trim().split(/[\s,;]+/).filter(Boolean)) {
    const m = tok.match(/^(\d+)[:=](-?[\d.]+(?:e[+-]?\d+)?)$/i);
    if (!m) return null;
    pts.push([+m[1], +m[2]]);
  }
  return pts.length ? pts.sort((a, b) => a[0] - b[0]) : null;
}

function addEntity() {
  const E = state.entities, src = E.at(-1);
  E.push({ id: uid('e', E), name: `엔티티 ${E.length + 1}`, variance: 0, stats: structuredClone(src?.stats ?? {}) });
  rebuild();
}
function addStat() {
  let i = state.stats.length + 1; while (state.stats.some(s => s.id === `stat${i}`)) i++;
  state.stats.push({ id: `stat${i}`, name: '', growth: 'linear' });
  for (const e of state.entities) e.stats[`stat${i}`] = { b: 0, g: 0 };
  rebuild();
  toast(`스탯 stat${i}를 추가했습니다 — 수식에서 쓰려면 이름을 바꾸세요`);
}
function removeStat(i) {
  const [s] = state.stats.splice(i, 1);
  for (const e of state.entities) delete e.stats[s.id];
  for (const it of state.items) it.mods = it.mods.filter(m => m.stat !== s.id);
  rebuild();
}
function renameStat(i, id) {
  const old = state.stats[i].id;
  if (!id || id === old) return;
  if (state.stats.some(s => s.id === id)) { toast('같은 이름의 스탯이 있습니다'); renderEntities(); return; }
  state.stats[i].id = id;
  for (const e of state.entities) { e.stats[id] = e.stats[old]; delete e.stats[old]; }
  for (const it of state.items) for (const m of it.mods) if (m.stat === old) m.stat = id;
  // 수식 안의 이름도 함께 (단어 경계)
  const re = new RegExp(`(^|[^\\w.])((?:a\\.|b\\.)?)${old}(?![\\w])`, 'g');
  for (const k of Object.keys(FORMULA_KEYS)) state.rules[k] = state.rules[k].replace(re, `$1$2${id}`);
  rebuild();
  toast(`스탯 이름을 ${old} → ${id}로 바꾸고 수식도 고쳤습니다`);
}
function applyBulk() {
  const { stat, part, op, value } = els.bulk;
  if (!stat || !Number.isFinite(value)) { toast('값을 넣으세요'); return; }
  const ids = state.selected?.length ? new Set(state.selected) : null;
  let n = 0;
  for (const e of state.entities) {
    if (ids && !ids.has(e.id)) continue;
    const sv = e.stats[stat] ??= { b: 0, g: 0 };
    if (sv.table) continue;
    const cur = sv[part] ?? 0;
    sv[part] = +(op === 'mult' ? cur * value : op === 'add' ? cur + value : value).toPrecision(12);
    n++;
  }
  rebuild();
  toast(`${n}개 엔티티의 ${stat} ${part === 'b' ? '기본값' : '성장값'}을 바꿨습니다`);
}

// CSV: 이름, 변동, 스탯_b, 스탯_g … (내보내기와 같은 열)
function toggleCSV() { els.csvOpen = !els.csvOpen; els.csvBox.hidden = !els.csvOpen; if (els.csvOpen) renderCSV(); }
function entitiesCSV() {
  const head = ['name', 'variance', ...state.stats.flatMap(s => [`${s.id}_b`, `${s.id}_g`])];
  return [head.join(','), ...state.entities.map(e => [JSON.stringify(e.name), e.variance || 0, ...state.stats.flatMap(s => [e.stats[s.id]?.b ?? 0, e.stats[s.id]?.g ?? 0])].join(','))].join('\n');
}
function renderCSV() {
  const ta = h('textarea.csv-text', { rows: 6, spellcheck: false, value: entitiesCSV(), 'aria-label': '엔티티 CSV' });
  const out = h('div.csv-result', {});
  put(els.csvBox, 
    h('div.csv-head', {}, h('b', {}, '엔티티 표 CSV'), h('span.muted.small', {}, '열: name, variance, 스탯_b, 스탯_g … · 엑셀에서 복사한 표(탭)도 됨 · 없는 스탯 열은 0')),
    ta,
    h('div.tool-actions', {},
      h('button.btn.small.primary', { type: 'button', onclick: () => applyCSV(ta.value, out) }, '이 표로 바꾸기'),
      h('button.btn.small', { type: 'button', onclick: () => downloadText('battle-entities.csv', '﻿' + entitiesCSV(), 'text/csv') }, '파일로 저장'),
      h('button.btn.small', { type: 'button', onclick: toggleCSV }, '닫기')),
    out,
  );
}
function applyCSV(text, out) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { out.replaceChildren(h('p.bad-text', {}, '머리글과 한 줄 이상이 필요합니다.')); return; }
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const split = (l) => l.split(delim).map(c => c.trim().replace(/^"(.*)"$/, '$1'));
  const head = split(lines[0]).map(x => x.toLowerCase());
  const ni = head.indexOf('name');
  if (ni < 0) { out.replaceChildren(h('p.bad-text', {}, "'name' 열이 필요합니다.")); return; }
  const ents = lines.slice(1).map((l, i) => {
    const c = split(l), get = (k) => { const j = head.indexOf(k.toLowerCase()); return j >= 0 ? parseFloat(String(c[j]).replace(/,/g, '')) || 0 : 0; };
    return { id: `e${i + 1}`, name: c[ni] || `엔티티 ${i + 1}`, variance: Math.min(0.99, Math.max(0, get('variance'))), stats: Object.fromEntries(state.stats.map(s => [s.id, { b: get(`${s.id}_b`), g: get(`${s.id}_g`) }])) };
  });
  const oldIds = new Set(state.entities.map(e => e.id));
  state.entities = ents;
  for (const it of state.items) if (Array.isArray(it.targets)) it.targets = it.targets.filter(t => ents.some(e => e.id === t) && oldIds.has(t));
  state.pairA = 0; state.pairB = Math.min(1, ents.length - 1);
  els.csvOpen = false;
  rebuild();
  toast(`엔티티 ${ents.length}개를 불러왔습니다`);
}

// ── 특성 편집 (엔티티·아이템 공용) ──────────────────────
const openTraits = new Set(); // 펼친 특성 편집 ('e:엔티티id' / 'i:아이템id')
function traitButton(key, owner, rerender = renderEntities) {
  const n = owner.traits?.length || 0;
  return h(`button.mini-btn${n ? '.on' : ''}`, { type: 'button', 'aria-expanded': String(openTraits.has(key)), title: '특성 편집', onclick: () => { if (openTraits.has(key)) openTraits.delete(key); else openTraits.add(key); rerender(); } }, n ? `특성 ${n}` : '+ 특성');
}
function traitEditor(owner, title, rerender) {
  owner.traits ??= [];
  const T = owner.traits, S = state.stats;
  const turnUnit = state.rules.mode === 'turn' ? '턴(자기 공격)' : '초';
  const changed = (re = false) => { if (re) rerender(); schedule(); };
  const effectRow = (tr, e, ei) => {
    const bases = e.type === 'heal' || e.type === 'damage' ? ['fixed', 'dmg', 'maxHp'] : e.type === 'buff' ? ['fixed', 'stat'] : [];
    if (bases.length && !bases.includes(e.base)) e.base = bases[0];
    return h('div.effect-row', {},
      select(Object.entries(EFFECTS), e.type, (v) => { e.type = v; if (v === 'buff') { e.stat ??= S[0]?.id; e.dur ??= 0; } changed(true); }, '효과'),
      e.type === 'dmgMult' || e.type === 'dmgAdd' ? h('span.muted.small', {}, e.type === 'dmgMult' ? '× (공격 직전 = 주는 데미지, 피격 = 받는 데미지)' : '+ (음수면 감소)')
        : select([['self', '자신'], ['enemy', '상대']], e.who ?? 'self', (v) => { e.who = v; changed(); }, '대상'),
      e.type === 'buff' ? select(S.map(s => [s.id, s.id]), e.stat, (v) => { e.stat = v; changed(); }, '버프 스탯') : null,
      numIn(e, 'value', { label: '효과 값', cls: 'short' }),
      bases.length ? select(bases.map(b => [b, EFFECT_BASES[b]]), e.base, (v) => { e.base = v; changed(); }, '값 기준') : null,
      e.type === 'buff' ? h('label.inline-sel', {}, h('span.muted.small', {}, `지속(${turnUnit}, 0 = 끝까지)`), numIn(e, 'dur', { min: 0, label: '버프 지속', cls: 'short' })) : null,
      h('button.icon-x', { type: 'button', title: '효과 삭제', disabled: tr.effects.length <= 1, onclick: () => { tr.effects.splice(ei, 1); changed(true); } }, '×'),
    );
  };
  const traitBox = (tr, ti) => {
    const condV = tr.cond ? tr.cond.who : 'none';
    return h('div.trait-box', {},
      h('div.trait-head', {},
        h('input.ent-name', { type: 'text', value: tr.name, 'aria-label': '특성 이름', oninput: (e) => { tr.name = e.target.value; save(); } }),
        select(Object.entries(TRIGGERS), tr.on, (v) => { tr.on = v; changed(true); }, '발동 시점'),
        h('label.inline-sel', {}, h('span.muted.small', {}, '확률 %'), numIn(tr, 'chance', { min: 0, max: 100, label: '발동 확률', cls: 'short' })),
        select([['none', '조건 없음'], ['self', '내 체력 ≤'], ['enemy', '상대 체력 ≤']], condV, (v) => { tr.cond = v === 'none' ? null : { who: v, below: tr.cond?.below ?? 30 }; changed(true); }, '체력 조건'),
        tr.cond ? h('label.inline-sel', {}, numIn(tr.cond, 'below', { min: 0, max: 100, label: '체력 조건 %', cls: 'short' }), h('span.muted.small', {}, '%')) : null,
        h('label.inline-sel', {}, h('span.muted.small', {}, '최대 발동 (0 = 무제한)'), numIn(tr, 'max', { int: true, min: 0, label: '최대 발동', cls: 'short' })),
        h('button.mini-btn', { type: 'button', title: '특성 삭제', onclick: () => { T.splice(ti, 1); changed(true); } }, '삭제'),
      ),
      ...tr.effects.map((e, ei) => effectRow(tr, e, ei)),
      h('button.mini-btn', { type: 'button', onclick: () => { tr.effects.push({ type: 'heal', who: 'self', value: 10, base: 'fixed' }); changed(true); } }, '+ 효과'),
    );
  };
  return h('div.trait-editor', {},
    h('div.trait-title', {}, h('b', {}, title), h('span.muted.small', {}, ' · 효과는 발동 한 번에 한 번, 확률은 한 번만 판정 · 쓰러뜨린 공격 뒤에는 피격 효과 없음')),
    ...T.map(traitBox),
    h('div.tool-actions', {},
      select([['', '프리셋으로 추가…'], ...Object.entries(TRAIT_PRESETS).map(([k, p]) => [k, p.label])], '', (v) => { if (v) { T.push(TRAIT_PRESETS[v].make()); changed(true); } }, '특성 프리셋'),
      h('button.btn.small', { type: 'button', onclick: () => { T.push({ name: `특성 ${T.length + 1}`, on: 'attackHit', chance: 100, cond: null, max: 0, effects: [{ type: 'heal', who: 'self', value: 10, base: 'fixed' }] }); changed(true); } }, '+ 빈 특성'),
    ),
  );
}

// ── 아이템 ──────────────────────────────────────────────
function renderItems() {
  const I = state.items, E = state.entities, S = state.stats;
  const targetSel = (it) => {
    const v = it.targets === 'all' ? 'all' : (Array.isArray(it.targets) && it.targets.length === 1 ? it.targets[0] : (it.targets?.length ? 'multi' : 'none'));
    const opts = [['all', '전체'], ...E.map(e => [e.id, e.name]), ...(v === 'multi' ? [['multi', `${it.targets.length}명 (가져온 값)`]] : []), ['none', '없음']];
    return select(opts, v, (x) => { if (x === 'multi') return; it.targets = x === 'all' ? 'all' : x === 'none' ? [] : [x]; schedule(0); }, `${it.name} 대상`);
  };
  put(els.itemCard, 
    h('div.card-head', {}, h('h2', {}, '아이템 (스탯 수정자)'), h('span.hint', {}, '스탯 = (값 + Σ고정) × (1 + Σ% ÷ 100) × Π배율 — 아이템 순서와 무관')),
    I.length ? h('div.table-wrap', {}, h('table.stages.item-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '켜기'), h('th.left', {}, '아이템'), h('th.left', {}, '대상'), h('th', {}, '특성'), h('th.left', {}, '스탯'), h('th', {}, '고정 +'), h('th', {}, '% +'), h('th', {}, '× 배율'), h('th', {}, ''))),
      h('tbody', {}, ...I.flatMap((it, ii) => {
        const mods = it.mods.length ? it.mods : [null];
        const rows = mods.map((m, mi) => h(`tr${mi ? '.sub' : ''}`, {},
          h('td', {}, mi ? '' : h('input', { type: 'checkbox', checked: it.active !== false, 'aria-label': `${it.name} 켜기`, onchange: (e) => { it.active = e.target.checked; schedule(0); } })),
          h('td.left', {}, mi ? '' : h('input.ent-name', { type: 'text', value: it.name, 'aria-label': '아이템 이름', oninput: (e) => { it.name = e.target.value; save(); } })),
          h('td.left', {}, mi ? '' : targetSel(it)),
          h('td', {}, mi ? '' : traitButton(`i:${it.id}`, it, renderItems)),
          h('td.left', {}, m ? select(S.map(s => [s.id, s.id]), m.stat, (v) => { m.stat = v; schedule(0); }, '수정할 스탯') : h('span.muted', {}, '—')),
          h('td', {}, m ? numIn(m, 'flat', { allowEmpty: true, placeholder: '0', label: '고정 증가' }) : ''),
          h('td', {}, m ? numIn(m, 'pct', { allowEmpty: true, placeholder: '0', label: '% 증가' }) : ''),
          h('td', {}, m ? numIn(m, 'mult', { allowEmpty: true, placeholder: '1', label: '배율' }) : ''),
          h('td.x', {},
            mi === mods.length - 1 ? h('button.mini-btn', { type: 'button', title: '수정자 추가', onclick: () => { it.mods.push({ stat: S[0].id, flat: 0 }); renderItems(); } }, '+') : null,
            m ? h('button.icon-x', { type: 'button', title: '수정자 삭제', onclick: () => { it.mods.splice(mi, 1); renderItems(); schedule(0); } }, '×') : null,
            mi === 0 ? h('button.mini-btn', { type: 'button', title: '아이템 삭제', onclick: () => { I.splice(ii, 1); renderItems(); schedule(0); } }, '삭제') : null),
        ));
        return rows;
      })),
    )) : h('p.muted', {}, '아이템이 없습니다.'),
    ...I.filter(it => openTraits.has(`i:${it.id}`)).map(it => h('div.trait-panel', {}, traitEditor(it, `아이템 ${it.name}의 특성 (대상 엔티티에 붙음)`, renderItems))),
    h('div.table-foot', {}, h('button.btn.small', { type: 'button', onclick: () => { I.push({ id: uid('i', I), name: `아이템 ${I.length + 1}`, active: true, targets: 'all', mods: [{ stat: S[0].id, flat: 0 }] }); renderItems(); } }, '+ 아이템')),
    buildsBlock(),
  );
}

// ── 아이템 세트 (빌드): 지금 아이템 목록을 이름 붙여 저장 → 적용·비교 ──
function buildsBlock() {
  const B = state.itemSets ??= [];
  const name = h('input', { type: 'text', placeholder: `빌드 ${B.length + 1}`, 'aria-label': '빌드 이름' });
  els.buildOut = h('div', {});
  return h('div.builds', {},
    h('div.diag-sub', {}, h('h3', {}, '아이템 세트 (빌드)'), h('span.hint', {}, '지금 아이템 목록(켜기·대상·수정자·특성)을 이름 붙여 저장하고, 빌드마다 엔티티 평균 승률을 비교')),
    h('div.build-save', {}, name, h('button.btn.small', { type: 'button', onclick: () => { B.push({ id: uid('b', B), name: name.value.trim() || `빌드 ${B.length + 1}`, items: structuredClone(state.items) }); save(); renderItems(); toast('빌드를 저장했습니다'); } }, '지금 아이템을 빌드로 저장')),
    B.length ? h('div.table-wrap', {}, h('table.stages.solve-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '빌드'), h('th', {}, '아이템'), h('th', {}, ''))),
      h('tbody', {}, ...B.map((b, i) => h('tr', {},
        h('td.lever', {}, b.name), h('td', {}, b.items.filter(it => it.active !== false).map(it => it.name).join(', ') || '없음'),
        h('td', {},
          h('button.btn.small', { type: 'button', onclick: () => { state.items = structuredClone(b.items); rebuild(); toast(`'${b.name}' 빌드를 적용했습니다`); } }, '적용'),
          h('button.icon-x', { type: 'button', title: '빌드 삭제', onclick: () => { B.splice(i, 1); save(); renderItems(); } }, '×'))))),
    )) : null,
    B.length ? h('div.tool-actions', {}, h('button.btn.small.primary', { type: 'button', onclick: runBuilds }, `빌드 비교 (Lv${Math.min(state.level, state.maxLevel)})`)) : null,
    els.buildOut,
  );
}
function runBuilds() {
  if (!last) { toast('먼저 오류를 고쳐 주세요'); return; }
  put(els.buildOut, h('p.muted', {}, '계산 중…'));
  setTimeout(() => {
    const rows = compareBuilds(state, last.f, state.itemSets, last.lv);
    const E = state.entities, base = rows[0];
    put(els.buildOut, h('div.table-wrap', {}, h('table.stages.solve-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, `Lv${last.lv} 평균 승률`), ...E.map((e, i) => h('th', {}, h('span.swatch', { style: `background:${colorOf(i)}` }), e.name)))),
      h('tbody', {}, ...rows.map((r, ri) => h(`tr${ri === 0 ? '.top' : ''}`, {},
        h('td.lever', {}, r.name, r.exact ? null : h('small', {}, '일부 시뮬레이션')),
        ...r.score.map((v, i) => { const d = v - base.score[i]; return h(`td${ri && Math.abs(d) >= 0.0005 ? (d > 0 ? '.up' : '.down') : ''}`, {}, pct(v), ri && Math.abs(d) >= 0.0005 ? h('small', {}, ` ${d > 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}%p`) : null); }))),
    ))), h('p.muted.small', {}, '각 칸 = 그 엔티티가 다른 모든 엔티티와 1:1로 붙었을 때의 평균 점수(승 + 무/2) · 작은 숫자 = 지금 대비'));
  }, 20);
}

// ── 계산·표시 ───────────────────────────────────────────
function rebuild() { renderHead(); renderSide(); renderEntities(); renderItems(); recompute(); }

function recompute() {
  save();
  for (const k of Object.keys(els.fErr || {})) els.fErr[k].textContent = '';
  const res = analyze(state);
  if (!res.ok) {
    for (const [k, m] of Object.entries(res.formulaErrors || {})) if (els.fErr[k]) els.fErr[k].textContent = m;
    put(els.errors, ...res.errors.slice(0, 8).map(e => h('li', {}, e)));
    els.errors.hidden = false;
    return;
  }
  els.errors.hidden = true;
  res.base = baselineResult(res);
  last = res;
  renderKPIs(res);
  renderCurveTabs();
  drawCurves(res);
  renderMatrix(res);
  renderPair(res);
  renderCheck(res);
  startPhase(res);
  renderTools(res);
}

// 기준안: 저장한 설정으로 같은 지표 곡선·같은 레벨 행렬을 다시 계산
function baselineResult(res) {
  const b = state.baseline;
  if (!b) return null;
  const cfg = { ...b.cfg, metric: state.metric, ref: state.ref, level: res.lv, maxLevel: state.maxLevel, sim: state.sim };
  const comp = compileRules(cfg);
  if (!comp.ok) return { error: true };
  const refName = state.entities.find(x => x.id === state.ref)?.name;
  return { series: curves(cfg, comp.f, state.metric || 'cp', cfg.entities.find(e => e.name === refName)?.id), mx: matrix(cfg, comp.f, res.lv, { runs: Math.min(state.sim.runs, 2000) }), cfg };
}
function saveBaseline() {
  const { baseline, ...rest } = state;
  state.baseline = { label: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }), cfg: structuredClone(rest) };
  renderHead(); recompute();
  toast('현재 설정을 기준안으로 저장했습니다 — 바꾸면 곡선 점선과 행렬 변화로 비교됩니다');
}

function renderKPIs(res) {
  const E = state.entities, mx = res.mx;
  const best = mx.score.reduce((bi, s, i) => (s > mx.score[bi] ? i : bi), 0);
  const kpi = (label, value, sub, cls = '') => h(`div.card.kpi${cls}`, {}, h('div.kpi-label', {}, label), h('div.kpi-value', { title: value }, value), ...[].concat(sub).map(t => h('div.kpi-sub', {}, t)));
  const inv = res.cv.pairs.length;
  put(els.kpis, 
    kpi(`Lv${res.lv} 가장 강한 엔티티`, E.length > 1 ? E[best].name : '—', E.length > 1 ? [`상대 평균 승률 ${pct(mx.score[best])} (무승부 절반)`] : ['엔티티를 2개 이상 넣으세요'], '.hero'),
    kpi('CP와 실제 강함의 순위 상관', Number.isFinite(res.cv.rho) ? res.cv.rho.toFixed(2) : '—', [E.length >= 3 ? '1 = CP 순서와 승률 순서가 같음' : '엔티티 3개 이상일 때'], Number.isFinite(res.cv.rho) && res.cv.rho < 0.5 ? '.bad' : ''),
    kpi('CP가 높은데 지는 쌍', `${inv}쌍`, inv ? [`${res.cv.pairs[0].hi.name} → ${res.cv.pairs[0].lo.name} 승률 ${pct(res.cv.pairs[0].win)}`] : ['없음'], inv ? '.bad' : ''),
    kpi('계산 방식', mx.allExact ? '공식 계산' : '일부 시뮬레이션', [mx.allExact ? '모든 대결을 공식으로 계산해 매번 같은 값이 나옵니다' : `변동·특성이 있는 대결은 ${comma(state.sim.runs)}번 시뮬레이션 (95% 범위 표시)`, MODES[state.rules.mode].split(' (')[0]]),
  );
}

function renderCurveTabs() {
  const m = state.metric || 'cp';
  put(els.curveTabs, 
    ...Object.entries(METRICS).map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(m === id), onclick: () => { state.metric = id; renderCurveTabs(); schedule(0); } }, label)),
    m !== 'cp' ? h('label.inline-sel', {}, h('span.muted.small', {}, '기준 상대'), select(state.entities.map(e => [e.id, e.name]), state.ref, (v) => { state.ref = v; schedule(0); }, '기준 상대')) : null,
  );
}

function drawCurves(res) {
  if (typeof Chart === 'undefined') return;
  const m = state.metric || 'cp', L = state.maxLevel;
  const grid = cssVar('--grid'), tick = cssVar('--text-3'), ink = cssVar('--text-2');
  const fmt = m === 'ttk' ? sec : (v) => num(v, 1);
  const ds = res.series.map((s, i) => ({ label: s.name, data: s.data.map((y, k) => ({ x: k + 1, y: Number.isFinite(y) ? y : null })), borderColor: colorOf(i), backgroundColor: colorOf(i), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 }));
  if (res.base && !res.base.error) res.base.series.forEach((s) => {
    const i = state.entities.findIndex(e => e.name === s.name);
    if (i < 0) return;
    ds.push({ label: `${s.name} (기준안)`, base: true, data: s.data.map((y, k) => ({ x: k + 1, y: Number.isFinite(y) ? y : null })), borderColor: colorOf(i), borderDash: [5, 4], borderWidth: 1.25, pointRadius: 0 });
  });
  // 역전 레벨 표시: 세로 점선
  const cross = res.cross;
  const marks = { id: 'cross', afterDatasetsDraw(c) {
    const { ctx: g, chartArea: a, scales: { x } } = c;
    g.save(); g.strokeStyle = tick; g.setLineDash([2, 3]); g.lineWidth = 1;
    for (const lv of new Set(cross.map(cc => cc.lv))) { const px = x.getPixelForValue(lv); if (px >= a.left && px <= a.right) { g.beginPath(); g.moveTo(px, a.top); g.lineTo(px, a.bottom); g.stroke(); } }
    g.restore();
  } };
  els.curveHint.textContent = m === 'cp' ? `CP 수식: ${state.rules.cp}` : `${state.entities.find(e => e.id === state.ref)?.name ?? ''}(같은 레벨) 상대 · 변동 제외 기대값${cross.length ? ' · 세로 점선 = 역전 레벨' : ''}`;
  chartCurve?.destroy();
  chartCurve = new Chart(els.curveCanvas, {
    type: 'line', data: { datasets: ds }, plugins: [marks],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      scales: {
        x: { type: 'linear', min: 1, max: L, title: { display: true, text: '레벨', color: tick }, grid: { color: grid }, ticks: { color: tick, stepSize: Math.max(1, Math.round(L / 10)) } },
        y: { grid: { color: grid }, ticks: { color: tick, callback: (v) => fmt(v) }, title: { display: true, text: METRICS[m], color: tick } },
      },
      plugins: {
        legend: { labels: { color: ink, boxWidth: 14, boxHeight: 2 } },
        tooltip: { callbacks: { title: (it) => `Lv${it[0].raw.x}`, label: (it) => `${it.dataset.label}: ${fmt(it.raw.y)}` } },
      },
    },
  });
  put(els.cross, ...(cross.length
    ? [h('span.muted.small', {}, '역전 레벨: '), ...cross.slice(0, 12).map(c => h('span.chip', {}, `Lv${c.lv} ${c.upName} > ${c.downName}`)), cross.length > 12 ? h('span.muted.small', {}, ` 외 ${cross.length - 12}곳`) : null].filter(Boolean)
    : [h('span.muted.small', {}, '역전 레벨 없음 — 순위가 레벨 내내 같습니다')]));
}

function renderMatrix(res) {
  const E = state.entities, mx = res.mx, bm = res.base && !res.base.error ? res.base : null;
  const deltaOf = (i, j) => {
    if (!bm) return null;
    const bi = bm.cfg.entities.findIndex(e => e.name === E[i].name), bj = bm.cfg.entities.findIndex(e => e.name === E[j].name);
    if (bi < 0 || bj < 0 || bi === bj) return null;
    return mx.cell[i][j].win - bm.mx.cell[bi][bj].win;
  };
  const cellView = (i, j) => {
    if (i === j) return h('td.mx-self', {}, '—');
    const c = mx.cell[i][j];
    const t = Math.min(1, Math.abs(c.win - 0.5) * 2); // 0 = 반반, 1 = 한쪽 완승
    const tone = c.win >= 0.5 ? '--tor-up' : '--tor-down';
    const d = deltaOf(i, j);
    const sig = c.exact ? Math.abs(c.win - c.lose) > 1e-9 : (c.ci[0] > 0.5 || c.ci[1] < 0.5 - c.draw); // 시뮬레이션이 50%를 걸치면 흐리게
    return h(`td.mx-cell${sig ? '' : '.mx-unsure'}`, {
      style: `background: color-mix(in srgb, var(${tone}) ${Math.round(8 + t * 42)}%, transparent)`,
      title: `${E[i].name} 대 ${E[j].name}: 승 ${pct(c.win)} · 패 ${pct(c.lose)} · 무 ${pct(c.draw)}${c.exact ? ' (공식 계산)' : ` · 95% 구간 ${pct(c.ci[0])}~${pct(c.ci[1])}`}`,
      onclick: () => { state.pairA = i; state.pairB = j; renderPair(last); els.pairCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    },
    h('b', {}, pct(c.win)),
    !c.exact ? h('small', {}, `±${((c.ci[1] - c.ci[0]) * 50).toFixed(1)}`) : null,
    c.draw > 0.005 ? h('small', {}, `무 ${pct(c.draw, 0)}`) : null,
    d != null && Math.abs(d) >= 0.0005 ? h(`small.${d > 0 ? 'up' : 'down'}`, {}, `${d > 0 ? '▲' : '▼'}${(Math.abs(d) * 100).toFixed(1)}`) : null);
  };
  put(els.mxCard, 
    h('div.card-head', {}, h('h2', {}, `승률 행렬 — Lv${res.lv}`), h('span.hint', {}, `왼쪽 엔티티가 위 엔티티를 이길 확률 · ${mx.allExact ? '모든 칸을 공식으로 계산' : `시뮬레이션 칸은 ±95% 구간, 50%를 걸치면 흐리게`} · 칸을 누르면 아래 상세${bm ? ' · ▲▼ = 기준안 대비 %p' : ''}`)),
    h('div.table-wrap', {}, h('table.mx-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, ''), ...E.map((e, j) => h('th', {}, h('span.swatch', { style: `background:${colorOf(j)}` }), e.name)), h('th', { title: '상대들에 대한 (승 + 무/2)의 평균' }, '평균'))),
      h('tbody', {}, ...E.map((e, i) => h('tr', {},
        h('th.left', {}, h('span.swatch', { style: `background:${colorOf(i)}` }), e.name),
        ...E.map((_, j) => cellView(i, j)),
        h('td.mx-score', {}, pct(mx.score[i])),
      ))),
    )),
  );
}

// ── 1:1 상세 ────────────────────────────────────────────
function renderPair(res) {
  const E = state.entities;
  if (E.length < 2) { put(els.pairCard, h('div.card-head', {}, h('h2', {}, '1:1 상세')), h('p.muted', {}, '엔티티를 2개 이상 넣으세요.')); return; }
  let ia = Math.min(state.pairA ?? 0, E.length - 1), ib = Math.min(state.pairB ?? 1, E.length - 1);
  if (ia === ib) ib = (ia + 1) % E.length;
  const A = E[ia], B = E[ib], lv = res.lv, f = res.f;
  const d = duel(state, f, A, B, lv, { runs: state.sim.runs });
  const prep = d.prep;
  const mode = state.rules.mode;
  // 검증: 정확해면 시뮬레이션과 비교, 아니면 시뮬레이션 결과 그대로
  const sim = d.exact ? duelSim(state, f, A, B, lv, state.sim.runs, 777, prep) : d.sim;
  const logRun = duelSim(state, f, A, B, lv, LOG_BATTLES, 555, prep, { logs: LOG_BATTLES });
  const prof = (p, hpT) => [
    ['명중', pct(p.hit)], ['치명 (적중 중)', pct(p.crit)], ['1회 데미지', `${num(p.normal, 1)} / 치명 ${num(p.critical, 1)}`],
    ['공격 속도', mode === 'time' ? `${num(p.speed, 2)}회/초` : `${num(p.speed, 2)} (선공 확률에만)`], ['상대 체력', num(hpT, 0)],
  ];
  const ks = (dist, sp) => (dist ? killStats(dist, sp, mode) : null);
  const kA = d.exact ? ks(d.ex.killA, prep.pa.speed) : null, kB = d.exact ? ks(d.ex.killB, prep.pb.speed) : null;
  const killLine = (k, who, other) => (k ? `${josa(who, '이', '가')} ${josa(other, '을', '를')} 쓰러뜨리는 공격: 평균 ${num(k.attacks, 1)}회${mode === 'time' ? ` (${sec(k.time)})` : ''} · 중앙값 ${k.q(0.5)}회 · 운 나쁜 1% ${k.q(0.99)}회${k.never > 1e-6 ? ` · ${mode === 'time' ? `${state.rules.maxTime}초` : `${state.rules.maxTurns}턴`} 안에 못 쓰러뜨림 ${pct(k.never)}` : ''}` : null);
  put(els.pairCard, 
    h('div.card-head', {}, h('h2', {}, '1:1 상세'), h('span.hint', {}, d.exact ? '동적 계획법으로 계산하고 시뮬레이션으로 확인' : `시뮬레이션 ${comma(sim.runs)}회 (${d.reason})`)),
    h('div.pair-pick', {},
      select(E.map((e, i) => [i, e.name]), ia, (v) => { state.pairA = +v; save(); renderPair(last); }, '공격 쪽'),
      h('span.muted', {}, '대'),
      select(E.map((e, i) => [i, e.name]), ib, (v) => { state.pairB = +v; save(); renderPair(last); }, '상대'),
      h('span.muted.small', {}, `Lv${lv}`)),
    h('div.pair-kpis', {},
      ...[['승', d.winA], ['무승부', d.draw], ['패', d.winB]].map(([l, v]) => h('div.pair-kpi', {}, h('span', {}, l), h('b', {}, pct(v, 2)), !d.exact && l === '승' ? h('small', {}, `95% ${pct(d.ci[0])}~${pct(d.ci[1])}`) : null)),
      mode === 'turn' && d.exact ? h('div.pair-kpi', {}, h('span', {}, `${A.name} 선공 확률`), h('b', {}, pct(d.ex.firstA, 1))) : null),
    h('div.two-col', {},
      h('div', {}, h('h3.sub', {}, `${A.name} → ${B.name}`), h('dl.pct-list', {}, ...prof(prep.pa, prep.hpB).map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))))),
      h('div', {}, h('h3.sub', {}, `${B.name} → ${A.name}`), h('dl.pct-list', {}, ...prof(prep.pb, prep.hpA).map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))))),
    ...[killLine(kA, A.name, B.name), killLine(kB, B.name, A.name)].filter(Boolean).map(t => h('p.muted.small', {}, t)),
    h('div.verify-grid', {},
      h('span.h', {}, ''), h('span.h', {}, d.exact ? '공식 계산' : '—'), h('span.h', {}, `시뮬레이션 ${comma(sim.runs)}회`),
      h('span', {}, `${A.name} 승`), h('span', {}, d.exact ? pct(d.winA, 2) : '—'), h('span', {}, `${pct(sim.winA, 2)} (95% ${pct(sim.ciA[0])}~${pct(sim.ciA[1])})`),
      h('span', {}, '무승부'), h('span', {}, d.exact ? pct(d.draw, 2) : '—'), h('span', {}, pct(sim.draw, 2)),
      h('span', {}, `${A.name} 실현 명중·치명`), h('span', {}, `${pct(prep.pa.hit)} · ${pct(prep.pa.crit)}`), h('span', {}, `${pct(sim.realized.hit)} · ${pct(sim.realized.crit)}`),
      h('span', {}, '평균 전투 길이'), h('span', {}, '—'), h('span', {}, mode === 'time' ? sec(mean(sim.duration)) : `${num(mean(sim.duration), 1)}턴`)),
    d.exact ? h('p', {}, h('span', { class: `status ${(sim.ciA[0] - 1e-9 <= d.winA && d.winA <= sim.ciA[1] + 1e-9) ? 'good' : 'warn'}` }, (sim.ciA[0] - 1e-9 <= d.winA && d.winA <= sim.ciA[1] + 1e-9) ? '계산값이 시뮬레이션 95% 범위 안에 있습니다' : '계산값이 시뮬레이션 95% 범위를 벗어났습니다. 반복 횟수를 늘려 다시 확인하세요')) : null,
    procBlock(sim, A, B),
    logBlock(logRun, A, B),
    h('h3.sub', {}, '레벨별 승률'),
    h('div.chart-box', {}, els.pairCanvas = h('canvas', { role: 'img', 'aria-label': `${A.name} 대 ${B.name} 레벨별 승률` })),
  );
  drawPairCurve(res, A, B);
}
const mean = (arr) => { let s = 0; for (const v of arr) s += v; return arr.length ? s / arr.length : NaN; };

function drawPairCurve(res, A, B) {
  if (typeof Chart === 'undefined') return;
  const L = state.maxLevel, f = res.f;
  const runs = Math.max(200, Math.round(state.sim.runs / 8));
  const pts = [], lo = [], hi = [];
  let exactAll = true;
  for (let lv = 1; lv <= L; lv++) {
    const d = duel(state, f, A, B, lv, { runs, seed: 999 + lv });
    exactAll &&= d.exact;
    pts.push({ x: lv, y: d.winA * 100, draw: d.draw });
    if (!d.exact) { lo.push({ x: lv, y: d.ci[0] * 100 }); hi.push({ x: lv, y: d.ci[1] * 100 }); }
  }
  const grid = cssVar('--grid'), tick = cssVar('--text-3'), ink = cssVar('--text-2');
  const ia = state.entities.indexOf(A);
  const ds = [{ label: `${A.name} 승률`, data: pts, borderColor: colorOf(ia), backgroundColor: colorOf(ia), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 }];
  if (!exactAll) ds.push({ label: '95% 구간', data: hi, borderWidth: 0, pointRadius: 0, backgroundColor: 'transparent', fill: false, band: true }, { label: '95% 구간 하한', data: lo, borderWidth: 0, pointRadius: 0, backgroundColor: color(colorOf(ia), 0.15), fill: '-1', band: true });
  const half = { id: 'half', afterDatasetsDraw(c) { const { ctx: g, chartArea: a, scales: { y } } = c; const py = y.getPixelForValue(50); g.save(); g.strokeStyle = ink; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(a.left, py); g.lineTo(a.right, py); g.stroke(); g.restore(); } };
  chartPair?.destroy();
  chartPair = new Chart(els.pairCanvas, {
    type: 'line', data: { datasets: ds }, plugins: [half],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      scales: {
        x: { type: 'linear', min: 1, max: L, grid: { color: grid }, ticks: { color: tick }, title: { display: true, text: '레벨 (두 엔티티 같은 레벨)', color: tick } },
        y: { min: 0, max: 100, grid: { color: grid }, ticks: { color: tick, callback: (v) => `${v}%` } },
      },
      plugins: {
        legend: { labels: { color: ink, boxWidth: 14, boxHeight: 2, filter: (it, data) => !data.datasets[it.datasetIndex].band } },
        tooltip: { filter: (it) => !it.dataset.band, callbacks: { title: (it) => `Lv${it[0].raw.x}`, label: (it) => `승 ${it.raw.y.toFixed(1)}%${it.raw.draw > 0.0005 ? ` · 무 ${(it.raw.draw * 100).toFixed(1)}%` : ''}` } },
      },
    },
  });
}
function color(hex, a) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})` : hex;
}

// ── 검증 ────────────────────────────────────────────────
const LOG_BATTLES = 20;
let logPick = 0;
function procBlock(sim, A, B) {
  const rows = [...sim.procs.A.map(p => [A.name, p]), ...sim.procs.B.map(p => [B.name, p])];
  if (!rows.length) return null;
  return h('div', {},
    h('h3.sub', {}, '특성 발동 (전투 한 번 평균)'),
    h('dl.pct-list.proc-list', {}, ...rows.map(([who, p]) => h('div', {}, h('dt', {}, `${who} · ${p.name}`), h('dd', {}, `${num(p.perBattle, 2)}회`)))));
}
function logBlock(run, A, B) {
  const mode = state.rules.mode;
  const box = h('div.battle-log', {});
  const show = () => {
    const L = run.logs[logPick] ?? run.logs[0];
    if (!L) { put(box); return; }
    const name = (w) => (w === 'A' ? A.name : w === 'B' ? B.name : '');
    const tFmt = (t) => (mode === 'turn' ? `${t}턴` : `${(+t.toFixed(2)).toLocaleString('ko-KR')}초`);
    const lines = L.ev.slice(0, 400).map(e => h(`div.log-line.${e.type}`, {},
      h('span.log-t', {}, tFmt(e.t)),
      h('span.log-who', {}, name(e.who)),
      h('span.log-text', {}, e.type === 'hit' ? `→ ${e.text}` : e.text),
      h('span.log-hp', {}, `${A.name} ${num(e.hpA, 0)} · ${B.name} ${num(e.hpB, 0)}`)));
    put(box, ...lines, L.ev.length > 400 ? h('p.muted.small', {}, `… ${L.ev.length - 400}줄 더`) : null);
  };
  const res = (w) => (w === 1 ? `${A.name} 승` : w === 2 ? `${B.name} 승` : '무승부');
  const pick = select(run.logs.map((L, i) => [i, `전투 ${i + 1} — ${res(L.w)} (${mode === 'turn' ? `${L.t}턴` : `${(+L.t.toFixed(1))}초`})`]), logPick, (v) => { logPick = +v; show(); }, '전투 로그 고르기');
  show();
  return h('div', {}, h('div.log-head', {}, h('h3.sub', {}, '전투 로그'), pick, h('span.muted.small', {}, `같은 규칙의 시뮬레이션 ${run.logs.length}전투`)), box);
}

// ── 구간 리포트 (레벨마다 행렬 → 구간 평균) — 레벨을 나눠 비동기로 계산 ─────
let phaseToken = 0, chartPhase;
function startPhase(res) {
  const token = ++phaseToken;
  const plan = sweepPlan(state);
  const ranges = phaseRanges(state);
  const acc = { ...plan, win: [], draw: [], score: [] };
  put(els.phaseCard, h('div.card-head', {}, h('h2', {}, '구간 리포트'), h('span.hint', {}, '계산 중…')));
  let k = 0;
  const step = () => {
    if (token !== phaseToken) return; // 설정이 바뀌어 새 계산이 시작됨
    const t0 = performance.now();
    while (k < plan.levels.length && performance.now() - t0 < 30) {
      const r = sweepAt(state, res.f, plan.levels[k], plan.runs);
      acc.win.push(r.win); acc.draw.push(r.draw); acc.score.push(r.score); k++;
    }
    if (k < plan.levels.length) { els.phaseCard.querySelector('.hint').textContent = `계산 중… ${k}/${plan.levels.length} 레벨`; setTimeout(step, 0); return; }
    renderPhase(acc, phaseReport(state, acc), ranges);
  };
  setTimeout(step, 0);
}
function renderPhase(sw, rep, ranges) {
  const E = state.entities, LV = { serious: '불가', warn: '주의', info: '참고' };
  put(els.phaseCard,
    h('div.card-head', {}, h('h2', {}, '구간 리포트'), h('span.hint', {}, `${ranges.map(r => `Lv${r.from}~${r.to}`).join(' · ')} · ${sw.exact ? '공식 계산' : `시뮬레이션 쌍마다 ${comma(sw.runs)}회${sw.stride > 1 ? ` · ${sw.stride}레벨마다` : ''}`} · 경계는 왼쪽 '템플릿 · 레벨'에서`)),
    h('div.chart-box', {}, els.phaseCanvas = h('canvas', { role: 'img', 'aria-label': '레벨별 엔티티 평균 승률' })),
    h('div.table-wrap', {}, h('table.stages.phase-table', {},
      h('thead', {}, h('tr', {}, h('th.left', {}, '엔티티'), ...rep.phases.map(p => h('th', {}, `Lv${p.from}~${p.to}`)))),
      h('tbody', {}, ...E.map((e, i) => h('tr', {},
        h('td.left', {}, h('span.swatch', { style: `background:${colorOf(i)}` }), e.name),
        ...rep.phases.map(p => h(`td${p.best === i ? '.phase-best' : ''}${p.dominant.includes(i) ? '.phase-dom' : ''}`, { title: p.dominant.includes(i) ? '이 구간에서 모든 상대에게 평균 55% 이상' : '' }, pct(p.score[i]))))),
      ))),
    rep.findings.length ? h('ul.findings', {}, ...rep.findings.map(w => h(`li.${w.level === 'info' ? 'info' : w.level}`, {}, h('span.lv', {}, LV[w.level]), h('span', {}, w.text)))) : h('p.muted', {}, '구간마다 지배하는 엔티티가 없습니다.'),
  );
  if (typeof Chart === 'undefined') return;
  const grid = cssVar('--grid'), tick = cssVar('--text-3'), ink = cssVar('--text-2');
  const bands = { id: 'bands', beforeDatasetsDraw(c) {
    const { ctx: g, chartArea: a, scales: { x } } = c;
    g.save(); g.fillStyle = cssVar('--surface-2');
    ranges.forEach((r, m) => { if (m % 2) { const x0 = x.getPixelForValue(r.from - 0.5), x1 = x.getPixelForValue(r.to + 0.5); g.fillRect(Math.max(a.left, x0), a.top, Math.min(a.right, x1) - Math.max(a.left, x0), a.bottom - a.top); } });
    g.restore();
  } };
  chartPhase?.destroy();
  chartPhase = new Chart(els.phaseCanvas, {
    type: 'line', plugins: [bands],
    data: { datasets: E.map((e, i) => ({ label: e.name, data: sw.levels.map((lv, k) => ({ x: lv, y: sw.score[k][i] * 100 })), borderColor: colorOf(i), backgroundColor: colorOf(i), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 })) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      scales: {
        x: { type: 'linear', min: 1, max: state.maxLevel, grid: { color: grid }, ticks: { color: tick }, title: { display: true, text: '레벨 (회색 띠 = 구간)', color: tick } },
        y: { min: 0, max: 100, grid: { color: grid }, ticks: { color: tick, callback: (v) => `${v}%` }, title: { display: true, text: '상대 평균 승률', color: tick } },
      },
      plugins: { legend: { labels: { color: ink, boxWidth: 14, boxHeight: 2 } }, tooltip: { callbacks: { title: (it) => `Lv${it[0].raw.x}`, label: (it) => `${it.dataset.label}: ${it.raw.y.toFixed(1)}%` } } },
    },
  });
}

function renderCheck(res) {
  const LV = { serious: '불가', warn: '주의', info: '참고' };
  const cv = res.cv, E = state.entities;
  const order = E.map((e, i) => i).sort((a, b) => res.mx.score[b] - res.mx.score[a]);
  put(els.checkCard, 
    h('div.card-head', {}, h('h2', {}, 'CP와 실제 승률 · 검증 결과'), h('span.hint', {}, `Lv${res.lv}`)),
    E.length >= 2 ? h('div.table-wrap', {}, h('table.stages.rank-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '실제 순위'), h('th.left', {}, '엔티티'), h('th', {}, '평균 승률'), h('th', {}, 'CP'), h('th', {}, 'CP 순위'))),
      h('tbody', {}, ...order.map((i, r) => {
        const cpRank = [...cv.cp].sort((a, b) => b - a).indexOf(cv.cp[i]) + 1;
        return h(`tr${cpRank !== r + 1 ? '.bad' : ''}`, {}, h('td', {}, String(r + 1)), h('td.left', {}, h('span.swatch', { style: `background:${colorOf(i)}` }), E[i].name), h('td', {}, pct(res.mx.score[i])), h('td', {}, num(cv.cp[i], 0)), h('td', {}, String(cpRank)));
      })),
    )) : null,
    res.findings.length
      ? h('ul.findings', {}, ...res.findings.map(w => h(`li.${w.level}`, {}, h('span.lv', {}, LV[w.level]), h('span', {}, w.text))))
      : h('p.muted', {}, 'CP 순위와 실제 승률이 맞고, 지배·무승부·한 방 문제가 없습니다.'),
    h('div.supply-howto', {},
      h('b', {}, '계산 방법'),
      h('p.muted.small', {}, '한 번의 공격은 빗나감·일반·치명 세 결과. 상대를 쓰러뜨리는 공격 횟수의 분포를 (일반 적중 수, 치명 수) 상태로 정확히 구하고, 두 엔티티의 횟수가 서로 독립이라는 점을 이용해 승·무·패를 바로 계산합니다. 시간 기반은 n번째 공격 시각 (n − 1) ÷ 공격 속도로 결정타 순서를, 턴 교대는 선공 확률과 번갈아 공격 순서를 씁니다. 데미지 변동이 있으면 같은 규칙의 시뮬레이션(Wilson 95% 구간)으로 계산합니다.'),
    ),
  );
}


// ── 밸런스 도구: 최소 변경 · 민감도 · 효과 분해 · 목표 역산 ──────
let toolToken = 0;
function toolState() {
  const E = state.entities;
  const t = state.tool ??= {};
  if (!E.some(e => e.id === t.a)) t.a = E[Math.min(state.pairA ?? 0, E.length - 1)]?.id;
  if (t.b !== 'all' && (!E.some(e => e.id === t.b) || t.b === t.a)) t.b = E.find(e => e.id !== t.a)?.id ?? 'all';
  t.lv = Math.min(Math.max(1, t.lv ?? state.level ?? 1), state.maxLevel);
  t.target ??= 50; t.pct ??= 10;
  t.goal ??= { metric: 'cp', stat: state.stats[0]?.id, part: 'g', value: 1000 };
  return t;
}
const statName = (id) => { const d = state.stats.find(s => s.id === id); return d?.name ? `${d.name} (${id})` : id; };

function renderTools(res) {
  const E = state.entities;
  if (E.length < 2) { put(els.toolCard, h('div.card-head', {}, h('h2', {}, '밸런스 도구')), h('p.muted', {}, '엔티티를 2개 이상 넣으세요.')); return; }
  const t = toolState();
  const A = E.find(e => e.id === t.a);
  const needsSim = (x) => (x.variance || 0) > 0 || traitsOf(state, x).length > 0;
  const opp = t.b === 'all' ? E.filter(e => e.id !== t.a) : E.filter(e => e.id === t.b);
  const sim = needsSim(A) || opp.some(needsSim);
  const rerun = () => { save(); renderTools(last); };
  els.toolOut = { min: h('div', {}), sens: h('div', {}), contrib: h('div', {}), goal: h('div', {}) };
  put(els.toolCard,
    h('div.card-head', {}, h('h2', {}, '밸런스 도구'), h('span.hint', {}, `점수 = 승 + 무승부 ÷ 2 · ${sim ? `시뮬레이션 쌍은 같은 시드 ${comma(Math.max(500, Math.round(state.sim.runs / 2)))}회` : '공식 계산'}`)),
    h('div.tool-pick', {},
      field('대상', select(E.map(e => [e.id, e.name]), t.a, (v) => { t.a = v; rerun(); }, '대상 엔티티')),
      field('상대', select([['all', '모든 상대 평균'], ...E.filter(e => e.id !== t.a).map(e => [e.id, e.name])], t.b, (v) => { t.b = v; rerun(); }, '상대')),
      field('레벨', numIn(t, 'lv', { int: true, min: 1, max: state.maxLevel, label: '도구 레벨', after: () => {} })),
      field('목표 점수 (%)', numIn(t, 'target', { min: 0, max: 100, label: '목표 점수' })),
      field('민감도 변동폭', select([[5, '±5%'], [10, '±10%'], [20, '±20%']], t.pct, (v) => { t.pct = +v; rerun(); }, '민감도 변동폭')),
      h('button.btn.primary', { type: 'button', onclick: () => runTools(res, true) }, sim ? '계산 (시뮬레이션)' : '다시 계산'),
    ),
    h('div.diag-sub', {}, h('h3', {}, `점수를 ${t.target}%로 만드는 최소 변경`), h('span.hint', {}, `${A.name}의 스탯 하나만 ×k (기본값·성장값·표 모두) · 필요한 배율이 작은 순 · 점수는 정수 공격 횟수 때문에 계단 모양이라 목표를 처음 넘는 값`)),
    els.toolOut.min,
    h('div.diag-sub', {}, h('h3', {}, `민감도 — 스탯을 ±${t.pct}% 바꾸면 ${A.name}의 점수가 얼마나 바뀌나`)),
    h('div.tor-legend', {},
      h('span', {}, h('i', { style: 'background:var(--tor-down)' }), `값을 ${t.pct}% 내림`),
      h('span', {}, h('i', { style: 'background:var(--tor-up)' }), `값을 ${t.pct}% 올림`),
      h('span.muted', {}, `오른쪽 = ${A.name}에게 유리 · 막대 길이 = 점수 변화(%p)${t.b === 'all' ? '' : ' · 상대 스탯도 함께'}`)),
    els.toolOut.sens,
    h('div.diag-sub', {}, h('h3', {}, '아이템·특성 효과 분해'), h('span.hint', {}, '하나씩 끄면 점수가 얼마나 바뀌나 (있을 때 − 없을 때)')),
    els.toolOut.contrib,
    h('div.diag-sub', {}, h('h3', {}, '목표 역산'), h('span.hint', {}, 'Kalivra의 "Lv20 CP = 1000 → 성장값"을 점수 목표까지')),
    goalForm(t, A),
    els.toolOut.goal,
  );
  runTools(res, !sim);
}

function goalForm(t, A) {
  const g = t.goal;
  return h('div.tool-pick', {},
    field('지표', select([['cp', '전투력 (CP)'], ['dps', '초당 기대 데미지 (상대 대비)'], ['score', '점수 (상대 대비)']], g.metric, (v) => { g.metric = v; save(); }, '역산 지표')),
    field('바꿀 스탯', select(state.stats.map(s => [s.id, statName(s.id)]), g.stat, (v) => { g.stat = v; save(); }, '역산 스탯')),
    field('바꿀 값', select([['g', '성장값 (레벨당)'], ['b', '기본값 (Lv1)'], ['scale', '전체 배율']], g.part, (v) => { g.part = v; save(); }, '역산 대상')),
    field('목표 (점수는 %)', numIn(g, 'value', { label: '역산 목표' })),
    h('button.btn', { type: 'button', onclick: () => runGoal(t, A) }, '역산'),
  );
}

function runGoal(t, A) {
  const g = t.goal, f = last.f;
  const target = g.metric === 'score' ? g.value / 100 : g.value;
  const runs = Math.max(500, Math.round(state.sim.runs / 2));
  put(els.toolOut.goal, h('p.muted', {}, '계산 중…'));
  setTimeout(() => {
    const r = solveTarget(state, f, { metric: g.metric, entity: A.id, opponent: t.b, lv: t.lv, stat: g.stat, part: g.part, target, runs });
    const fmtV = (x) => (g.metric === 'score' ? pct(x) : num(x, 2));
    if (!r.feasible) { put(els.toolOut.goal, h('p.bad-text', {}, r.reason || `이 스탯만으로는 목표에 닿지 않습니다 (가장 가까이 ${fmtV(r.achieved)}).`)); return; }
    const label = g.part === 'scale' ? `${statName(g.stat)} 전체 ×${num(r.value, 4)}` : `${statName(g.stat)} ${g.part === 'g' ? '성장값' : '기본값'} ${num(r.from, 3)} → ${num(r.value, 4)}`;
    put(els.toolOut.goal, h('div.goal-out', {},
      h('span', {}, `${A.name}: ${label} → Lv${t.lv} ${g.metric === 'cp' ? 'CP' : g.metric === 'dps' ? '초당 데미지' : '점수'} ${fmtV(r.achieved)}`),
      h('button.btn.small', { type: 'button', onclick: () => {
        const e = state.entities.find(x => x.id === A.id), def = state.stats.find(s => s.id === g.stat);
        if (g.part === 'scale') applyScale(e, def, r.value); else { e.stats[g.stat] ??= { b: 0, g: 0 }; e.stats[g.stat][g.part] = +r.value.toPrecision(6); }
        rebuild(); toast(`${A.name}의 ${g.stat}을(를) 바꿨습니다`);
      } }, '적용')));
  }, 20);
}

/** 계산을 단계로 나눠 화면이 멈추지 않게 (설정이 바뀌면 이전 계산은 버림) */
function runTools(res, go) {
  const token = ++toolToken;
  const t = toolState(), f = res.f, E = state.entities;
  const A = E.find(e => e.id === t.a);
  if (!go) { for (const k of ['min', 'sens', 'contrib']) put(els.toolOut[k], h('p.muted', {}, '시뮬레이션이 필요한 쌍이 있어 "계산"을 누르면 시작합니다.')); return; }
  const runs = Math.max(500, Math.round(state.sim.runs / 2));
  const opts = { a: t.a, b: t.b, lv: t.lv };
  const steps = [
    () => { put(els.toolOut.min, h('p.muted', {}, '계산 중…')); },
    () => renderMinChanges(minChanges(state, f, { ...opts, target: t.target / 100, runs }), A, t, scoreOf(state, f, t.a, t.b, t.lv, { runs }).score),
    () => renderSens(battleSensitivity(state, f, { ...opts, pct: t.pct, runs }), A, t),
    () => renderContrib(contributions(state, f, { ...opts, runs }), A),
  ];
  let k = 0;
  const step = () => { if (token !== toolToken || k >= steps.length) return; steps[k++](); setTimeout(step, 0); };
  for (const x of ['sens', 'contrib']) put(els.toolOut[x], h('p.muted', {}, '계산 대기…'));
  setTimeout(step, 0);
}

function renderMinChanges(rows, A, t, base) {
  const ok = rows.filter(r => r.feasible), no = rows.filter(r => !r.feasible);
  put(els.toolOut.min, h('p.muted.small', {}, `지금 점수 ${pct(base)} — ${base >= t.target / 100 ? '목표보다 높아서 아래 배율은 목표까지 내리는 값(여유)입니다' : '목표에 닿게 올리는 배율입니다'}`), h('div.table-wrap', {}, h('table.stages.solve-table', {},
    h('thead', {}, h('tr', {}, h('th', {}, '스탯'), h('th', {}, `Lv${t.lv} 값`), h('th', {}, '필요 배율'), h('th', {}, '바뀐 값'), h('th', {}, '도달 점수'), h('th', {}, ''))),
    h('tbody', {},
      ...ok.map((r, i) => h(`tr${i < 3 ? '.top' : ''}`, {},
        h('td.lever', {}, statName(r.stat)), h('td', {}, num(r.value0, 2)),
        h('td', {}, `×${num(r.k, 4)} (${r.k >= 1 ? '+' : '−'}${Math.abs((r.k - 1) * 100).toFixed(1)}%)`),
        h('td', {}, num(r.value0 * r.k, 2)), h('td', {}, pct(r.value)),
        h('td', {}, h('button.btn.small', { type: 'button', onclick: () => { const e = state.entities.find(x => x.id === A.id); applyScale(e, state.stats.find(s => s.id === r.stat), r.k); rebuild(); toast(`${A.name}의 ${r.stat}을(를) ×${num(r.k, 4)} 했습니다`); } }, '적용')))),
      ...no.map(r => h('tr.off', {}, h('td.lever', {}, statName(r.stat)), h('td', {}, num(r.value0, 2)), h('td', { colspan: 4, style: 'text-align:left' }, `이 스탯만으로는 닿지 않음 (×${r.k < 1 ? '1/64' : '64'}에서 ${pct(r.value)})`))),
    ))));
}

function renderSens(se, A, t) {
  const E = state.entities;
  const rows = se.rows.slice(0, 12);
  if (!rows.length) { put(els.toolOut.sens, h('p.muted', {}, '점수를 바꾸는 스탯이 없습니다.')); return; }
  const max = Math.max(...rows.map(r => r.swing), 1e-9), W = 44;
  const bar = (side, v) => {
    const w = Math.min(Math.abs(v) / max, 1) * W, dir = v < 0 ? 'l' : 'r';
    const pos = v < 0 ? `right:calc(50% + ${w}% + 4px)` : `left:calc(50% + ${w}% + 4px)`;
    return [h(`span.tor-bar.${side}.${dir}`, { style: `width:${Math.max(w, 0.4)}%` }), h(`span.tor-val.${side}`, { style: pos }, `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%p`)];
  };
  put(els.toolOut.sens,
    h('div.tor-axis', { 'aria-hidden': 'true' }, h('span', {}, ''), h('span', {}, h('span', {}, `← ${A.name}에게 불리`), h('span', {}, '유리 →')), h('span', { style: 'text-align:right' }, '')),
    h('div.tornado', {}, ...rows.map(r => {
      const who = E.find(e => e.id === r.side)?.name;
      const tip = `${who} ${r.stat}: −${t.pct}% → ${(r.lo * 100).toFixed(1)}%p, +${t.pct}% → ${(r.hi * 100).toFixed(1)}%p (지금 점수 ${pct(se.base)})`;
      return h('div.tor-row', { title: tip },
        h('div.tor-label', {}, `${who} · ${statName(r.stat)}`, h('small', {}, `Lv${t.lv} 값 ${num(r.value, 2)}${r.side === A.id ? '' : ' (상대)'}`)),
        h('div.tor-track', { role: 'img', 'aria-label': tip }, ...bar('lo', r.lo), ...bar('hi', r.hi)),
        h('div.tor-stag', {}, ''));
    })));
}

function renderContrib(co, A) {
  if (!co.rows.length) { put(els.toolOut.contrib, h('p.muted', {}, '대상(과 상대)에게 걸린 아이템·특성이 없습니다.')); return; }
  put(els.toolOut.contrib, h('div.table-wrap', {}, h('table.stages.solve-table', {},
    h('thead', {}, h('tr', {}, h('th', {}, '종류'), h('th', {}, '누구'), h('th', {}, '이름'), h('th', {}, `${A.name} 점수 기여`))),
    h('tbody', {}, ...co.rows.map(r => h('tr', {},
      h('td.lever', {}, r.kind === 'item' ? '아이템' : '특성'), h('td', {}, r.ownerName), h('td', {}, r.name),
      h(`td.${r.delta >= 0 ? 'up' : 'down'}`, {}, `${r.delta >= 0 ? '+' : '−'}${Math.abs(r.delta * 100).toFixed(1)}%p`)))),
  )), h('p.muted.small', {}, `지금 점수 ${pct(co.base)} · 상대 쪽 아이템·특성은 음수면 ${A.name}에게 불리하게 작용한다는 뜻`));
}

// ── 저장·공유·가져오기 ──────────────────────────────────
async function copyShareLink() {
  const { baseline, ...rest } = state;
  const url = `${location.origin}${location.pathname}#battle?s=${encodeState(rest)}`;
  try { await navigator.clipboard.writeText(url); toast('공유 링크를 복사했습니다'); }
  catch { prompt('아래 링크를 복사하세요', url); }
}
function saveJSON() {
  downloadJSON(`battle-${state.template}.json`, { schemaVersion: SCHEMA, tool: 'battle', description: `스탯·전투 밸런스 — 엔티티 ${state.entities.length}, 스탯 ${state.stats.length}, 아이템 ${state.items.length}`, state });
}
function pickFile(accept) {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.onchange = async () => { try { resolve(JSON.parse(await input.files[0].text())); } catch (e) { reject(e); } };
    input.click();
  });
}
async function importJSON() {
  try {
    const st = hydrate(await pickFile('.json,application/json'));
    if (!st) { toast('스탯·전투 밸런스 파일이 아닙니다'); return; }
    state = st; els.notes.hidden = true; rebuild(); toast('불러왔습니다');
  } catch { toast('파일을 읽지 못했습니다'); }
}
async function importKalivra() {
  let doc;
  try { doc = await pickFile('.kal,.json,application/json'); } catch { toast('파일을 읽지 못했습니다 (JSON 형식이 아님)'); return; }
  try {
    const base = defaultState('blank');
    const { cfg, notes } = fromKalivra(doc, base);
    state = { ...cfg, template: 'blank', v: SCHEMA, pairA: 0, pairB: Math.min(1, cfg.entities.length - 1), selected: [], baseline: null };
    rebuild();
    showNotes(`Kalivra 프로젝트${doc?.meta?.projectName ? ` '${doc.meta.projectName}'` : ''}를 가져왔습니다`, notes);
  } catch (e) { toast(e.message || '가져오지 못했습니다'); }
}
function showNotes(title, notes) {
  put(els.notes, 
    h('div.import-head', {}, h('b', {}, title), h('button.icon-x', { type: 'button', title: '닫기', onclick: () => { els.notes.hidden = true; } }, '×')),
    h('ul', {}, ...notes.map(n => h('li', {}, n))));
  els.notes.hidden = false;
}
function exportStatsCSV() {
  if (!last) { toast('먼저 오류를 고쳐 주세요'); return; }
  const S = state.stats;
  const lines = [['엔티티', '레벨', ...S.map(s => s.id), 'CP'].join(',')];
  for (const e of state.entities) for (let lv = 1; lv <= state.maxLevel; lv++) {
    const s = statsAt(state, e, lv);
    lines.push([JSON.stringify(e.name), lv, ...S.map(d => +s[d.id].toFixed(4)), +last.f.cp(s, lv).toFixed(4)].join(','));
  }
  downloadText(`battle-stats-${state.template}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}
function exportEngine(kind) {
  const files = kind === 'unity' ? unityFiles(state) : unrealFiles(state);
  downloadText(`battle-${kind}-${state.template}.zip`, makeZip(files), 'application/zip');
  toast(last ? `${kind === 'unity' ? 'Unity' : 'Unreal'} 파일 ${files.length}개를 zip으로 저장했습니다 — README.txt에 넣는 방법` : '수식 오류가 있는 칸은 코드에 주석으로 남겼습니다');
}
function exportMatrixCSV() {
  if (!last) { toast('먼저 오류를 고쳐 주세요'); return; }
  const E = state.entities, mx = last.mx;
  const lines = [[`Lv${mx.lv} 왼쪽(줄)이 위(열)를 이길 확률`, ...E.map(e => JSON.stringify(e.name)), '평균'].join(',')];
  E.forEach((e, i) => lines.push([JSON.stringify(e.name), ...E.map((_, j) => (i === j ? '' : mx.cell[i][j].win.toFixed(6))), mx.score[i].toFixed(6)].join(',')));
  lines.push('', '무승부', ...E.map((e, i) => [JSON.stringify(e.name), ...E.map((_, j) => (i === j ? '' : mx.cell[i][j].draw.toFixed(6)))].join(',')));
  downloadText(`battle-matrix-lv${mx.lv}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}
