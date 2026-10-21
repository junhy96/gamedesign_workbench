// 전투 시뮬레이터 — 데이터 테이블(직업·캐릭터·몬스터·스킬·효과·상성·시너지)을 읽어 1:1 / 파티 / 조합 비교.
// 계산은 engine.js (DOM 없음). 여기는 화면: 규칙 설정, 구성, 결과(지표·분포·기여도·교체 비교·로그), 상성 편집, 기획서.
import {
  FORMULAS, FORMULA_PARAMS, MODES, BUFF_STACK, HIT_MODES, TARGETING, ALLY_RULES, ROUNDS, DEFAULT_RULES,
  simulate, battle, makeUnit, effStat, synergyMet, hitChance,
} from './engine.js';
import { combatDoc } from './doc.js';
import { getTables, setTables, onTablesChange } from '../data/store.js';
import { unitOptions, unitFrom, parseUnitRef, elementMult } from '../data/tables.js';
import { STATS, ROWS, ROLES, statLabel } from '../data/schema.js';
import { h, store, encodeState, decodeState, downloadJSON, downloadText, pickJSON, toast, debounce, comma, fmtPct } from '../lib/util.js';
import { tip, label } from '../lib/tip.js';
import { simFields } from '../lib/simconfig.js';
import { renderDist, distStats } from '../lib/distview.js';
import { renderABCard } from '../lib/abcompare.js';
import { toCSV } from '../data/tables.js';

const SCHEMA = 1;
const STORE_KEY = 'combat:v1';
const VIEWS = { duel: '1:1 전투', party: '파티 전투', compare: '조합 비교' };
const EV_LABEL = { attack: '공격', miss: '빗나감', heal: '회복', skill: '스킬', status: '상태 이상', expire: '해제', death: '쓰러짐', dot: '지속 피해', phase: '페이즈', groggy: '흐트러짐', revive: '부활', skip: '행동 불가', synergy: '시너지' };

let state, els = {}, timer, last = null, busy = 0;
const save = debounce(() => store.set(STORE_KEY, state), 300);
const schedule = (ms = 200) => { clearTimeout(timer); timer = setTimeout(recompute, ms); };
const T = () => getTables();
const isRT = () => state.rules.mode === 'realtime';
const durUnit = () => (isRT() ? '초' : '턴');

function defaultState() {
  return {
    v: SCHEMA, view: 'duel', rules: { ...DEFAULT_RULES },
    duel: { a: { unit: 'char:CH_AREN', level: 30 }, b: { unit: 'monster:MO_ORC', level: 1 } },
    party: {
      allies: [{ unit: 'char:CH_BRIGID', level: 30 }, { unit: 'char:CH_AREN', level: 30 }, { unit: 'char:CH_DAHLIA', level: 30 }, { unit: 'char:CH_ELLA', level: 30 }, { unit: 'char:CH_FINN', level: 30 }],
      enemies: [{ unit: 'monster:MO_GOLEM', level: 1 }],
    },
    compare: { combos: [], pool: ['CH_AREN', 'CH_BRIGID', 'CH_CAEL', 'CH_DAHLIA', 'CH_ELLA', 'CH_FINN', 'CH_GRETA'], size: 4, cap: 60, top: 10, level: 30, runs: 80 },
    swap: { slot: 0, with: '' },
    sim: { runs: 300, seed: 20261018 },
    logFilter: { actor: '', ev: '' },
  };
}
function hydrate(o) {
  if (!o || o.v !== SCHEMA) return null;
  const d = defaultState();
  return { ...d, ...o, rules: { ...d.rules, ...o.rules }, duel: { ...d.duel, ...o.duel }, party: { ...d.party, ...o.party }, compare: { ...d.compare, ...o.compare }, sim: { ...d.sim, ...o.sim }, logFilter: { ...d.logFilter, ...o.logFilter } };
}
function readHash() { const m = location.hash.match(/^#combat\?s=([\w-]+)/); return m ? hydrate(decodeState(m[1])) : null; }

export function mount(root) {
  state = readHash() || hydrate(store.get(STORE_KEY)) || defaultState();
  if (location.hash.startsWith('#combat?')) history.replaceState(null, '', '#combat');
  build(root);
  rebuild();
  onTablesChange(() => { renderSetup(); renderElements(); schedule(100); });
  window.addEventListener('hashchange', () => { const st = readHash(); if (st) { state = st; history.replaceState(null, '', '#combat'); rebuild(); } });
}

// ── 공용 입력 ───────────────────────────────────────────
const field = (lbl, input, hint, tipKey) => h('label.field', {}, h('span', {}, lbl, tipKey ? tip(tipKey) : null), input, hint ? h('small', {}, hint) : null);
function numIn(obj, key, opts = {}) {
  return h('input', {
    type: 'number', value: obj[key] ?? '', step: opts.step ?? 'any', min: opts.min, max: opts.max, 'aria-label': opts.label, class: opts.cls,
    oninput: (e) => { const v = parseFloat(e.target.value); if (!Number.isFinite(v)) return; if (opts.min != null && v < opts.min) return; if (opts.max != null && v > opts.max) return; obj[key] = opts.int ? Math.round(v) : v; opts.after?.(); schedule(opts.delay ?? 250); },
  });
}
const select = (options, value, onchange, lbl) => h('select', { 'aria-label': lbl, onchange: (e) => onchange(e.target.value) }, ...options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
function unitSelect(slot, lbl, onchange) {
  const opts = unitOptions(T());
  const groups = ['캐릭터', '몬스터'].map(g => h('optgroup', { label: g }, ...opts.filter(o => o.group === g).map(o => h('option', { value: o.value, selected: o.value === slot.unit }, o.label))));
  const missing = slot.unit && !opts.some(o => o.value === slot.unit) ? [h('option', { value: slot.unit, selected: true }, `${slot.unit} (테이블에 없음)`)] : [];
  return h('select', { 'aria-label': lbl, class: missing.length ? 'field-bad' : null, onchange: (e) => { slot.unit = e.target.value; delete slot.row; onchange(); } }, h('option', { value: '' }, '— 비움 —'), ...missing, ...groups);
}
const OPEN_KEY = 'combat:sideOpen';
function section(id, title, summary, ...body) {
  const open = (store.get(OPEN_KEY) || {})[id] ?? (['mode', 'formula'].includes(id) || matchMedia('(min-width: 1101px)').matches);
  return h('details.side-sec', { open, ontoggle: (e) => store.set(OPEN_KEY, { ...(store.get(OPEN_KEY) || {}), [id]: e.target.open }) },
    h('summary', {}, h('span.side-title', {}, title), summary ? h('span.side-sum', {}, summary) : null),
    h('div.side-body', {}, ...body.filter(Boolean)));
}
const kpi = (lbl, value, sub, tipKey, hero) => h(`div.card.kpi${hero ? '.hero' : ''}`, {}, h('div.kpi-label', {}, lbl, tipKey ? tip(tipKey) : null), h('div.kpi-value', {}, value), h('div.kpi-sub', {}, sub || ''));
const fmtDur = (x) => (Number.isFinite(x) ? (isRT() ? `${x.toFixed(1)}초` : `${x.toFixed(1)}턴`) : '—');
const n0 = (x) => (Number.isFinite(x) ? comma(x) : '—');

// ── 골격 ────────────────────────────────────────────────
function build(root) {
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '전투 시뮬레이터'),
        h('p', {}, '데이터 테이블의 캐릭터·몬스터·스킬·효과·상성·시너지를 읽어 1:1과 파티 전투를 같은 규칙으로 돌립니다. 턴제와 실시간을 고르고, 데미지 공식·명중·치명타·버프 합산·그로기를 바꿔 승률과 클리어 시간, 캐릭터별 기여도를 봅니다.'),
      ),
      h('div.tool-actions', {},
        h('a.btn', { href: '#data', title: '직업·캐릭터·몬스터·스킬·효과·상성·시너지 테이블' }, '데이터 테이블 편집'),
        h('button.btn', { type: 'button', onclick: copyShareLink }, '공유 링크'),
        h('button.btn', { type: 'button', onclick: () => downloadJSON('combat-settings.json', { schemaVersion: SCHEMA, tool: 'combat', state }) }, 'JSON 저장'),
        h('button.btn', { type: 'button', onclick: importJSON }, '불러오기'),
      ),
    ),
    els.viewTabs = h('div.seg-tabs.combat-views', { role: 'tablist', 'aria-label': '전투 종류' }),
    h('div.enh-layout', {},
      els.side = h('aside.enh-side', { 'aria-label': '전투 규칙' }),
      h('div.enh-main', {},
        els.errors = h('ul.errors', { hidden: true }),
        els.setup = h('div.card.role-in'),
        els.kpis = h('div.kpis.combat-kpis'),
        els.dist = h('div.card.role-out'),
        els.extra = h('div.combat-extra'),
        els.log = h('div.card.role-out'),
        els.elements = h('div.card.role-in'),
        els.abCard = h('div.card.role-tool'),
        els.doc = h('div.card.role-doc'),
      ),
    ),
  );
}

function rebuild() { renderViews(); renderSide(); renderSetup(); renderElements(); renderAB(); recompute(); }

function renderViews() {
  els.viewTabs.replaceChildren(...Object.entries(VIEWS).map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-pressed': String(state.view === k), onclick: () => { state.view = k; rebuild(); } }, l)));
}

// ── 왼쪽: 규칙 ──────────────────────────────────────────
function renderSide() {
  const r = state.rules, F = FORMULAS[r.formula];
  const party = state.view !== 'duel';
  els.side.replaceChildren(
    section('mode', '전투 방식', MODES[r.mode],
      field('전투 방식', select(Object.entries(MODES).map(([k, v]) => [k, v]), r.mode, (v) => { r.mode = v; renderSide(); schedule(0); }, '전투 방식'), null, 'c.mode'),
      h('p.desc', {}, r.mode === 'turn'
        ? '라운드마다 살아 있는 전원을 속도가 빠른 순으로 한 번씩 행동시킵니다. 지속·쿨타임은 행동 횟수(턴), 결과는 턴 수.'
        : '초 단위로 진행합니다. 초당 행동 = 속도 ÷ 기준 속도. 쿨타임·지속은 초, 지속 피해·자원 회복은 1초마다. 결과는 초·DPS.'),
      r.mode === 'realtime' ? field('기준 속도 (속도 ÷ 이 값 = 초당 행동)', numIn(r, 'speedBase', { min: 1, label: '기준 속도' }), null, 'c.speedBase') : null,
      h('div.row2', {},
        r.mode === 'turn' ? field('최대 턴', numIn(r, 'maxTurns', { int: true, min: 1, max: 1000, label: '최대 턴' }), null, 'c.limit') : field('최대 시간 (초)', numIn(r, 'maxTime', { min: 1, max: 3600, label: '최대 시간' }), null, 'c.limit'),
        field('데미지 반올림', select(Object.entries(ROUNDS), r.round, (v) => { r.round = v; schedule(0); }, '데미지 반올림'))),
    ),
    section('formula', '데미지 공식', F.label,
      field('공식', select(Object.entries(FORMULAS).map(([k, f]) => [k, `${f.label} — ${f.expr}`]), r.formula, (v) => { r.formula = v; renderSide(); schedule(0); }, '데미지 공식'), null, 'c.formula'),
      h('div.formula-box', {},
        h('code', {}, `기본 데미지 = ${F.expr} × 스킬 배율`),
        h('ul.factor-list', {},
          h('li', {}, h('b', {}, '공'), ' 공격하는 쪽의 공격력 (버프·디버프 반영)', tip('f.atk')),
          h('li', {}, h('b', {}, '방'), ' 맞는 쪽의 방어력 (버프·디버프 반영)', tip('f.def')),
          h('li', {}, h('b', {}, '스킬 배율'), ' 스킬 테이블의 배율 (기본 공격 1)', tip('skill.mult')),
          ...F.params.map(p => h('li', {}, h('b', {}, FORMULA_PARAMS[p].label), tip(FORMULA_PARAMS[p].tip)))),
        h('p.desc', {}, F.use)),
      ...F.params.map(p => field(FORMULA_PARAMS[p].label, numIn(r, p, { min: FORMULA_PARAMS[p].min, max: FORMULA_PARAMS[p].max, label: FORMULA_PARAMS[p].label }))),
    ),
    section('hit', '명중 · 치명타', `${HIT_MODES[r.hitMode]}${r.crit ? ' · 치명타 켬' : ''}`,
      field('명중 공식', select(Object.entries(HIT_MODES), r.hitMode, (v) => { r.hitMode = v; schedule(0); }, '명중 공식'), null, 'c.hit'),
      h('div.row2', {}, field('명중 하한 (%)', numIn(r, 'hitMin', { min: 0, max: 100, label: '명중 하한' })), field('명중 상한 (%)', numIn(r, 'hitMax', { min: 0, max: 100, label: '명중 상한' }))),
      h('label.switch', {}, h('span', {}, '치명타 계산', tip('c.crit')), h('input', { type: 'checkbox', checked: r.crit, onchange: (e) => { r.crit = e.target.checked; schedule(0); } })),
    ),
    section('buff', '버프 · 디버프 합산', BUFF_STACK[r.buffStack],
      field('같은 스탯 % 효과가 여러 개일 때', select(Object.entries({ add: '합연산 — 기본 × (1 + Σ%)', mul: '곱연산 — 기본 × Π(1 + %)' }), r.buffStack, (v) => { r.buffStack = v; schedule(0); }, '버프 합산 방식'), null, 'c.buffStack'),
      h('p.desc', {}, '예: 공격력 +20% 버프 두 개 → 합연산 ×1.40, 곱연산 ×1.44. 고정값(+10) 효과는 % 계산 뒤에 더합니다.'),
    ),
    section('res', '자원 (코스트)', `시작 ${r.startRes} · +${r.resRegen}/${r.mode === 'turn' ? '턴' : '초'}`,
      h('div.row3', {}, field('시작', numIn(r, 'startRes', { min: 0, label: '시작 자원' })), field(`회복/${r.mode === 'turn' ? '턴' : '초'}`, numIn(r, 'resRegen', { min: 0, label: '자원 회복' })), field('최대', numIn(r, 'resMax', { min: 1, label: '최대 자원' }))),
      h('p.desc', {}, '스킬은 코스트만큼 자원을 씁니다. 자원이 모자라거나 쿨타임이면 다음 스킬, 모두 못 쓰면 기본 공격.'), tip('skill.cost'),
    ),
    section('groggy', '그로기 (흐트러짐)', `×${r.groggyDmg} · ${r.groggyDur}${durUnit()}`,
      h('div.row2', {},
        field('게이지 증가 배율', numIn(r, 'groggyGain', { min: 0, label: '그로기 증가 배율' }), null, 'c.groggyGain'),
        field('기본 공격 그로기', numIn(r, 'basicGroggy', { min: 0, label: '기본 공격 그로기' }))),
      h('div.row2', {},
        field(`지속 (${durUnit()})`, numIn(r, 'groggyDur', { min: 0, label: '흐트러짐 지속' }), null, 'c.groggyDur'),
        field('받는 피해 배율', numIn(r, 'groggyDmg', { min: 0, label: '흐트러짐 받는 피해 배율' }), null, 'c.groggyDmg')),
      h('p.desc', {}, '게이지 최대치는 몬스터 테이블의 "그로기 최대치". 가득 차면 행동 불가 + 받는 피해 증가, 끝나면 게이지 0.'),
    ),
    party ? section('party', '파티 규칙', TARGETING[r.targeting],
      field('아군의 공격 대상', select(Object.entries(TARGETING), r.targeting, (v) => { r.targeting = v; schedule(0); }, '아군 타겟팅'), null, 'c.targeting'),
      field('적의 공격 대상', select(Object.entries(TARGETING), r.enemyTargeting, (v) => { r.enemyTargeting = v; schedule(0); }, '적 타겟팅'), null, 'c.targeting'),
      field('아군 대상 스킬 (버프)', select(Object.entries(ALLY_RULES), r.allyRule, (v) => { r.allyRule = v; schedule(0); }, '아군 대상 규칙'), '회복·보호막은 항상 체력 비율이 가장 낮은 아군', 'c.allyRule'),
      field('회복 스킬 사용 기준 (체력 % 미만)', numIn(r, 'healBelow', { min: 0, max: 100, label: '회복 기준' })),
      h('label.switch', {}, h('span', {}, '시너지 적용', tip('table.synergies')), h('input', { type: 'checkbox', checked: r.synergy, onchange: (e) => { r.synergy = e.target.checked; schedule(0); } })),
      h('label.switch', {}, h('span', {}, '부활 스킬 사용', tip('c.revive')), h('input', { type: 'checkbox', checked: r.revive, onchange: (e) => { r.revive = e.target.checked; schedule(0); } })),
    ) : section('party', '타겟팅', '1:1은 대상이 한 명', h('p.desc', {}, '파티 전투에서 아군·적의 공격 대상 규칙, 시너지, 부활을 정합니다.')),
    section('sim', '시뮬레이션', `${comma(state.sim.runs)}회 · 시드 ${state.sim.seed}`,
      ...simFields(state.sim, { min: 20, max: 20000, onChange: () => schedule(300), runsHint: '조합 비교는 조합마다 아래 "조합당 횟수"를 쓰고, 모든 조합에 같은 시드를 씁니다' })),
  );
}

// ── 구성 ────────────────────────────────────────────────
function renderSetup() {
  if (state.view === 'duel') return renderDuelSetup();
  if (state.view === 'party') return renderPartySetup();
  return renderCompareSetup();
}

function statTable(slot) {
  const { kind, id } = parseUnitRef(slot.unit);
  const u = unitFrom(T(), kind === 'monster' ? 'monster' : 'char', id, slot.level ?? 1);
  if (!u) return h('p.muted', {}, '테이블에 없는 유닛입니다.');
  const sk = Object.fromEntries(T().skills.map(s => [s.id, s]));
  return h('div', {},
    h('div.table-wrap', {}, h('table.mini.stat-steps', {},
      h('thead', {}, h('tr', {}, h('th.left', {}, ...label('계산 단계', 'c.finalStat')), ...STATS.map(s => h('th', {}, s.label.replace('치명타 ', '치명 '))))),
      h('tbody', {}, ...u.steps.map((st, i) => h(`tr${i === u.steps.length - 1 ? '.final' : ''}`, {}, h('td.left', {}, st.label), ...STATS.map(s => h('td', {}, fmtStat(st.stats[s.key]))))),
        u.kind === 'char' ? h('tr.final', {}, h('td.left', {}, h('b', {}, '최종 (전투 시작)')), ...STATS.map(s => h('td', {}, h('b', {}, fmtStat(u.stats[s.key]))))) : null))),
    h('p.small.muted', {}, `${u.kind === 'char' ? `${u.className} · ${ROLES[u.role] ?? ''} · ` : u.boss ? '보스 · ' : ''}속성 ${u.element} · ${ROWS[slot.row || u.row]} · 스킬: ${u.skills.map(id => sk[id]?.name ?? `${id}?`).join(', ') || '기본 공격만'}${u.phases?.length ? ` · 페이즈 ${u.phases.map(p => `${p.hp}%`).join('/')}` : ''}${u.groggyMax ? ` · 그로기 ${u.groggyMax}` : ''}`),
  );
}
const fmtStat = (v) => (Number.isFinite(v) ? (Math.abs(v) >= 100 || Number.isInteger(v) ? comma(v) : (+v.toFixed(2)).toString()) : '—');

function renderDuelSetup() {
  const d = state.duel;
  const side = (slot, name) => h('div.duel-side', {},
    h('div.row2', {}, field(name, unitSelect(slot, name, () => { renderSetup(); schedule(0); })), field('레벨', numIn(slot, 'level', { int: true, min: 1, max: 999, label: `${name} 레벨`, after: () => renderSetup() }), '캐릭터만 (몬스터는 표의 값)')),
    statTable(slot));
  els.setup.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '대결 구성'), h('span.hint', {}, '테이블에 캐릭터·몬스터를 추가하면 목록에 바로 나타납니다')),
    h('div.duel-grid', {}, side(d.a, 'A (왼쪽)'), side(d.b, 'B (오른쪽)')),
  );
}

function slotRows(list, sideName, n) {
  return list.slice(0, n).map((slot, i) => h('tr', {},
    h('td.left', {}, `${sideName} ${i + 1}`),
    h('td.left', {}, unitSelect(slot, `${sideName} ${i + 1}`, () => { renderSetup(); schedule(0); })),
    h('td', {}, numIn(slot, 'level', { int: true, min: 1, max: 999, label: `${sideName} ${i + 1} 레벨`, cls: 'short' })),
    h('td', {}, select([['', '기본'], ...Object.entries(ROWS)], slot.row || '', (v) => { if (v) slot.row = v; else delete slot.row; schedule(0); }, `${sideName} ${i + 1} 배치`)),
  ));
}
function sizeSel(list, lbl) {
  return select([1, 2, 3, 4, 5].map(k => [k, `${k}명`]), list.length, (v) => {
    const k = +v;
    while (list.length < k) list.push({ unit: '', level: 30 });
    list.length = k;
    renderSetup(); schedule(0);
  }, lbl);
}
function renderPartySetup() {
  const p = state.party, t = T();
  const syn = (list) => { const units = list.map((s, i) => makeUnit(t, s, 0, i)).filter(Boolean); return (t.synergies || []).filter(sy => synergyMet(sy, units)).map(sy => sy.name); };
  const synA = syn(p.allies), synE = syn(p.enemies);
  els.setup.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '파티 구성'), h('span.hint', {}, 'N:N 또는 N:보스 1 · 배치(전열/후열)는 "전열 우선" 타겟팅에 쓰임')),
    h('div.party-grid', {},
      h('div', {}, h('div.party-head', {}, h('b', {}, '아군'), sizeSel(p.allies, '아군 인원')),
        h('table.mini.slot-table', {}, h('thead', {}, h('tr', {}, h('th.left', {}, '슬롯'), h('th.left', {}, '캐릭터/몬스터'), h('th', {}, '레벨'), h('th', {}, ...label('배치', 'row')))), h('tbody', {}, ...slotRows(p.allies, '아군', p.allies.length))),
        h('p.small.muted', {}, ...label(`시너지: ${synA.length ? synA.join(', ') : '없음'}`, 'table.synergies'))),
      h('div', {}, h('div.party-head', {}, h('b', {}, '적'), sizeSel(p.enemies, '적 인원')),
        h('table.mini.slot-table', {}, h('thead', {}, h('tr', {}, h('th.left', {}, '슬롯'), h('th.left', {}, '캐릭터/몬스터'), h('th', {}, '레벨'), h('th', {}, '배치'))), h('tbody', {}, ...slotRows(p.enemies, '적', p.enemies.length))),
        h('p.small.muted', {}, `시너지: ${synE.length ? synE.join(', ') : '없음'}`)),
    ),
  );
}

function renderCompareSetup() {
  const c = state.compare, t = T();
  const chars = t.characters.filter(r => r.id);
  const total = binom(c.pool.filter(id => chars.some(x => x.id === id)).length, c.size);
  els.setup.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '조합 비교'), h('span.hint', {}, `적: 파티 전투의 적 구성 (${state.party.enemies.map(s => nameOf(s)).join(', ')}) · 모든 조합에 같은 시드`)),
    h('div.compare-grid', {},
      h('div', {},
        h('h3', {}, '등록한 조합'),
        c.combos.length ? h('ul.combo-list', {}, ...c.combos.map((cb, i) => h('li', {},
          h('input', { type: 'text', value: cb.name, 'aria-label': '조합 이름', oninput: (e) => { cb.name = e.target.value; save(); } }),
          h('span.small', {}, cb.slots.map(nameOf).join(' · ')),
          h('button.icon-x', { type: 'button', title: '삭제', onclick: () => { c.combos.splice(i, 1); renderSetup(); save(); } }, '×')))) : h('p.muted.small', {}, '아직 없습니다. 파티 전투 탭의 지금 파티를 등록하거나 아래에서 자동 생성하세요.'),
        h('div.tool-actions', {},
          h('button.btn.small', { type: 'button', onclick: () => { c.combos.push({ name: `조합 ${c.combos.length + 1}`, slots: structuredClone(state.party.allies) }); renderSetup(); save(); } }, '+ 지금 파티 등록'),
          h('button.btn.small.primary', { type: 'button', onclick: () => runCompare('combos') }, '등록한 조합 비교')),
      ),
      h('div', {},
        h('h3', {}, ...label('자동 조합 생성', 'c.autoCombo')),
        h('div.pool', {}, ...chars.map(ch => h('label.chk', {}, h('input', { type: 'checkbox', checked: c.pool.includes(ch.id), onchange: (e) => { if (e.target.checked) c.pool.push(ch.id); else c.pool = c.pool.filter(x => x !== ch.id); renderSetup(); save(); } }), ` ${ch.name}`))),
        h('div.row3', {},
          field('슬롯 수', numIn(c, 'size', { int: true, min: 1, max: 5, label: '슬롯 수', after: () => renderSetup() })),
          field('레벨', numIn(c, 'level', { int: true, min: 1, max: 999, label: '조합 레벨' })),
          field('상위 N', numIn(c, 'top', { int: true, min: 1, max: 100, label: '상위 N' }))),
        h('div.row2', {},
          field('조합 수 상한', numIn(c, 'cap', { int: true, min: 1, max: 5000, label: '조합 수 상한', after: () => renderSetup() })),
          field('조합당 횟수', numIn(c, 'runs', { int: true, min: 10, max: 5000, label: '조합당 시뮬레이션 횟수' }))),
        h(`p.small${total > c.cap ? '.warn-text' : '.muted'}`, {}, total > c.cap
          ? `가능한 조합 ${comma(total)}개 — 상한 ${comma(c.cap)}개를 넘어 앞에서부터 ${comma(c.cap)}개만 계산합니다 (상한을 올리거나 풀을 줄이세요).`
          : `가능한 조합 ${comma(total)}개 × ${comma(c.runs)}회 = 전투 ${comma(total * c.runs)}판`),
        h('button.btn.small.primary', { type: 'button', onclick: () => runCompare('auto') }, '자동 생성해서 순위 보기'),
      ),
    ),
  );
}
const binom = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); };
function nameOf(slot) { const { kind, id } = parseUnitRef(slot.unit); const r = (kind === 'monster' ? T().monsters : T().characters).find(x => x.id === id); return r ? r.name : (slot.unit ? `${id}?` : '비움'); }

// ── 계산 ────────────────────────────────────────────────
function setupNow() {
  if (state.view === 'duel') return { allies: [state.duel.a].filter(s => s.unit), enemies: [state.duel.b].filter(s => s.unit) };
  return { allies: state.party.allies.filter(s => s.unit), enemies: state.party.enemies.filter(s => s.unit) };
}
function recompute() {
  save();
  if (state.view === 'compare') { renderDoc(); if (!last?.compare) { els.kpis.replaceChildren(); els.dist.hidden = true; els.log.hidden = true; els.extra.replaceChildren(h('div.card.role-out', {}, h('p.muted', {}, '조합을 등록하거나 자동 생성 버튼을 누르면 같은 적·같은 시드로 일괄 시뮬레이션한 비교 표가 나옵니다.'))); } return; }
  els.dist.hidden = false; els.log.hidden = false;
  const t = T(), setup = setupNow();
  const errs = [];
  const valid = (list) => list.filter(s => makeUnit(t, s, 0, 0));
  if (!valid(setup.allies).length) errs.push(state.view === 'duel' ? 'A를 고르세요.' : '아군을 한 명 이상 배치하세요.');
  if (!valid(setup.enemies).length) errs.push(state.view === 'duel' ? 'B를 고르세요.' : '적을 한 명 이상 배치하세요.');
  [...setup.allies, ...setup.enemies].filter(s => !makeUnit(t, s, 0, 0)).forEach(s => errs.push(`${s.unit} — 테이블에 없는 ID입니다 (데이터 테이블에서 확인).`));
  els.errors.replaceChildren(...errs.map(e => h('li', {}, e)));
  els.errors.hidden = !errs.length;
  if (!valid(setup.allies).length || !valid(setup.enemies).length) { els.kpis.replaceChildren(); return; }
  const res = simulate(t, state.rules, { allies: valid(setup.allies), enemies: valid(setup.enemies) }, { runs: state.sim.runs, seed: state.sim.seed });
  last = { res, setup };
  renderKPIs(res);
  renderDistCard(res);
  renderExtra(res);
  renderLog(res.log);
  renderDoc();
}

function renderKPIs(r) {
  const duel = state.view === 'duel';
  const A = r.units.filter(u => u.side === 0), E = r.units.filter(u => u.side === 1);
  els.kpis.replaceChildren(
    kpi(duel ? `${A[0]?.name ?? 'A'} 승률` : '승률 (아군)', fmtPct(r.win), `패배 ${fmtPct(r.lose)} · 무승부(시간 초과) ${fmtPct(r.draw)} · ${comma(r.runs)}회`, 'c.win', true),
    kpi(`평균 클리어 ${isRT() ? '시간' : '턴'}`, fmtDur(r.meanClear), r.clear.length ? `이긴 판 기준 · 중앙값 ${fmtDur(r.clear[Math.floor(r.clear.length / 2)])}` : '이긴 판이 없음', 'c.clear'),
    kpi(duel ? `${A[0]?.name ?? 'A'} ${isRT() ? 'DPS' : '턴당 피해'}` : '생존 인원', duel ? n0(A[0]?.dps) : `${r.survivors.toFixed(2)}명`, duel ? `준 피해 ÷ 전투 길이 · 치명타율 ${fmtPct(A[0]?.critRate)}` : `전투가 끝났을 때 아군 평균 · ${A.length}명 중`, duel ? 'c.dps' : 'c.survivors'),
    kpi(duel ? `${E[0]?.name ?? 'B'} ${isRT() ? 'DPS' : '턴당 피해'}` : `파티 총 ${isRT() ? 'DPS' : '턴당 피해'}`, duel ? n0(E[0]?.dps) : n0(r.dps), duel ? `준 피해 ÷ 전투 길이 · 치명타율 ${fmtPct(E[0]?.critRate)}` : `파티 전원 피해 ÷ 전투 길이 (판 평균)`, 'c.dps'),
    kpi('받은 피해 총량', n0(r.taken), `아군이 한 판에 받은 피해 평균${duel ? '' : ` · 회복 ${n0(A.reduce((a, u) => a + u.heal, 0))}`}`, 'c.taken'),
  );
}

function renderDistCard(r) {
  const unit = durUnit();
  if (!r.clear.length) { els.dist.replaceChildren(h('div.card-head', {}, h('h2', {}, '클리어 시간 분포')), h('p.muted', {}, `${comma(r.runs)}판 중 이긴 판이 없습니다 — 아래 전투 로그와 기여도에서 원인을 보세요.`)); return; }
  renderDist(els.dist, 'combat:dist', r.clear, {
    unit, fmt: (v) => (isRT() ? v.toFixed(1) : comma(v)), title: `클리어 ${isRT() ? '시간' : '턴'} 분포`,
    hint: `이긴 ${comma(r.clear.length)}판 · 세로선 = P10·P50·P90·P99`,
    note: '평균은 운 좋은 빠른 클리어와 운 나쁜 긴 전투가 섞인 값입니다. 보통 유저의 체감은 P50, 컨텐츠 시간 제한은 P90·P99로 정하세요.',
  });
}

// ── 결과: 기여도·교체 비교·계산 예시 ────────────────────
function renderExtra(r) {
  const cards = [];
  cards.push(contributionCard(r));
  if (state.view === 'party') cards.push(swapCard());
  cards.push(exampleCard());
  els.extra.replaceChildren(...cards);
}

function contributionCard(r) {
  const rows = r.units;
  const maxDmg = Math.max(1, ...rows.map(u => u.dmg));
  const sideName = (s) => (s ? '적' : '아군');
  return h('div.card.role-out', {},
    h('div.card-head', {}, h('h2', {}, ...label('기여도 분석', 'c.contrib')), h('span.hint', {}, `${comma(r.runs)}판 평균 · 버프·디버프 기여 = 그 효과가 없었다면 줄었을 데미지(추정)`)),
    h('div.table-wrap', {}, h('table.stages.contrib', {},
      h('thead', {}, h('tr', {}, ...['진영', '이름', '역할', '가한 피해', '', '받은 피해', '회복·보호막', '버프·디버프 기여', `생존 ${durUnit()}`, '생존율', '치명타율', '처치'].map((x, i) => h(`th${i < 3 ? '.left' : ''}`, {}, x)))),
      h('tbody', {}, ...rows.map(u => h('tr', {},
        h('td.left', {}, sideName(u.side)), h('td.left', {}, h('b', {}, u.name)), h('td.left', {}, ROLES[u.role] ?? (u.side ? '몬스터' : '')),
        h('td', {}, n0(u.dmg)), h('td', {}, h('div.share-bar', {}, h('i', { style: `width:${(u.dmg / maxDmg * 100).toFixed(1)}%` }))),
        h('td', {}, n0(u.taken)), h('td', {}, n0(u.heal + u.shield)), h('td', {}, n0(u.buff)),
        h('td', {}, u.life.toFixed(1)), h('td', {}, fmtPct(u.survived)), h('td', {}, fmtPct(u.critRate)), h('td', {}, u.kills.toFixed(2)),
      ))))),
  );
}

function swapCard() {
  const p = state.party, sw = state.swap;
  const chars = T().characters.filter(r => r.id);
  const out = h('div.swap-out');
  return h('div.card.role-tool', {},
    h('div.card-head', {}, h('h2', {}, ...label('교체 비교', 'c.swap')), h('span.hint', {}, '한 명을 빼거나 바꿨을 때 승률·클리어 시간 변화 — 같은 시드')),
    h('div.row3', {},
      field('바꿀 슬롯', select(p.allies.map((s, i) => [i, `아군 ${i + 1} · ${nameOf(s)}`]), sw.slot, (v) => { sw.slot = +v; save(); }, '바꿀 슬롯')),
      field('대신', select([['', '빼기 (빈 슬롯)'], ...chars.map(c => [`char:${c.id}`, c.name])], sw.with, (v) => { sw.with = v; save(); }, '대신 넣을 캐릭터')),
      h('div.field', {}, h('span', {}, ' '), h('div.tool-actions', {},
        h('button.btn.small.primary', { type: 'button', onclick: () => runSwap(out, [sw.slot], sw.with) }, '비교'),
        h('button.btn.small', { type: 'button', onclick: () => runSwap(out, p.allies.map((_, i) => i), '') }, '한 명씩 모두 빼 보기')))),
    out,
  );
}

async function runSwap(out, slots, withUnit) {
  const t = T(), base = last?.res;
  if (!base) return;
  const runs = Math.max(50, Math.round(state.sim.runs / 2));
  const baseRes = simulate(t, state.rules, { allies: state.party.allies.filter(s => makeUnit(t, s, 0, 0)), enemies: state.party.enemies.filter(s => makeUnit(t, s, 0, 0)) }, { runs, seed: state.sim.seed, logFirst: false });
  const rows = [];
  out.replaceChildren(h('p.muted.small', {}, '계산 중…'));
  for (const i of slots) {
    await new Promise(r => setTimeout(r, 0));
    const allies = state.party.allies.map((s, k) => (k === i ? (withUnit ? { unit: withUnit, level: s.level ?? 30 } : null) : s)).filter(s => s && makeUnit(t, s, 0, 0));
    if (!allies.length) continue;
    const r = simulate(t, state.rules, { allies, enemies: state.party.enemies.filter(s => makeUnit(t, s, 0, 0)) }, { runs, seed: state.sim.seed, logFirst: false });
    const who = nameOf(state.party.allies[i]);
    const role = (() => { const u = makeUnit(t, state.party.allies[i], 0, 0); return u ? ROLES[u.role] ?? '' : ''; })();
    rows.push({ label: withUnit ? `${who} → ${nameOf({ unit: withUnit })}` : `${who} 빼기`, role, win: r.win, dWin: r.win - baseRes.win, clear: r.meanClear, dClear: r.meanClear - baseRes.meanClear });
  }
  const sign = (x, f) => (Number.isFinite(x) ? `${x > 0 ? '+' : ''}${f(x)}` : '—');
  out.replaceChildren(
    h('table.mini', {},
      h('thead', {}, h('tr', {}, ...['변경', '역할', '승률', '승률 변화', `평균 클리어`, '클리어 변화'].map((x, i) => h(`th${i < 2 ? '.left' : ''}`, {}, x)))),
      h('tbody', {},
        h('tr.base', {}, h('td.left', {}, '지금 파티'), h('td.left', {}, ''), h('td', {}, fmtPct(baseRes.win)), h('td', {}, ''), h('td', {}, fmtDur(baseRes.meanClear)), h('td', {}, '')),
        ...rows.sort((a, b) => a.dWin - b.dWin).map(x => h('tr', {}, h('td.left', {}, x.label), h('td.left', {}, x.role), h('td', {}, fmtPct(x.win)),
          h(`td${x.dWin < -0.05 ? '.neg' : x.dWin > 0.05 ? '.pos' : ''}`, {}, sign(x.dWin * 100, v => `${v.toFixed(1)}%p`)), h('td', {}, fmtDur(x.clear)), h('td', {}, sign(x.dClear, v => v.toFixed(1))))))),
    h('p.muted.small', {}, `조합마다 ${comma(runs)}회 · 승률이 가장 많이 떨어지는 사람이 이 파티에서 가장 대체하기 어려운 역할입니다.`),
  );
}

/** 데미지 계산 예시: 아군 첫 유닛 → 적 첫 유닛 기본 공격, 단계별 (치명타 없음 / 있음) */
function exampleCard() {
  const t = T(), R = { ...DEFAULT_RULES, ...state.rules };
  const setup = setupNow();
  const a = setup.allies[0] && makeUnit(t, setup.allies[0], 0, 0), b = setup.enemies[0] && makeUnit(t, setup.enemies[0], 1, 0);
  if (!a || !b) return h('div');
  for (const u of [a, b]) { u.statuses = []; u.groggyLeft = 0; u.groggyUntil = -1; }
  const atk = effStat(a, 'atk', R), def = effStat(b, 'def', R);
  const base = FORMULAS[R.formula].f(atk, def, R);
  const el = elementMult(t, a.element, b.element);
  const crid = effStat(a, 'crid', R), p = hitChance(effStat(a, 'acc', R), effStat(b, 'eva', R), R);
  const rows = [
    ['① 기본 공식', `${FORMULAS[R.formula].expr} = ${fmtStat(base)}`, `공 ${fmtStat(atk)}, 방 ${fmtStat(def)}${FORMULAS[R.formula].params.map(k => `, ${FORMULA_PARAMS[k].label} ${R[k]}`).join('')} · × 스킬 배율 1 (기본 공격)`],
    ['② 속성 상성', `× ${el}`, `${a.element} → ${b.element} (상성 테이블)`],
    ['③ 치명타', R.crit ? `× ${fmtStat(crid)} (확률 ${fmtStat(effStat(a, 'cric', R))}%)` : '꺼짐', '치명타가 나면 배율을 곱함'],
    ['④ 버프 · 디버프', '× 1', `받는 피해 증감(취약 등) — 전투 중 걸린 효과를 ${R.buffStack === 'mul' ? '곱연산' : '합연산'}으로`],
    ['⑤ 그로기', `× ${R.groggyDmg} (흐트러짐일 때만)`, '흐트러진 대상은 받는 피해가 늘어남'],
  ];
  const fin = (crit) => Math.max(1, Math.floor(base * el * (crit ? crid : 1)));
  return h('div.card.role-doc', {},
    h('div.card-head', {}, h('h2', {}, ...label('데미지 계산 순서 — 예시', 'c.order')), h('span.hint', {}, `${a.name} → ${b.name} 기본 공격 · 명중 확률 ${fmtPct(p)}`)),
    h('table.mini.calc-order', {}, h('tbody', {}, ...rows.map(([k, v, d]) => h('tr', {}, h('td.left', {}, h('b', {}, k)), h('td.left', {}, v), h('td.left.muted', {}, d))))),
    h('p.small', {}, `결과: 치명타 없음 ${comma(fin(false))} / 치명타 ${comma(fin(true))} (그로기·버프 없음, ${ROUNDS[R.round]}) → 보호막이 있으면 먼저 깎고 남은 만큼 체력에서.`),
  );
}

// ── 조합 비교 ───────────────────────────────────────────
async function runCompare(kind) {
  const t = T(), c = state.compare, my = ++busy;
  const enemies = state.party.enemies.filter(s => makeUnit(t, s, 0, 0));
  if (!enemies.length) { toast('파티 전투 탭에서 적을 먼저 배치하세요'); return; }
  let list;
  if (kind === 'combos') {
    list = c.combos.map(cb => ({ name: cb.name, slots: cb.slots.filter(s => makeUnit(t, s, 0, 0)) })).filter(x => x.slots.length);
    if (!list.length) { toast('등록한 조합이 없습니다'); return; }
  } else {
    const pool = c.pool.filter(id => t.characters.some(x => x.id === id));
    list = [];
    for (const combo of combos(pool, c.size)) { if (list.length >= c.cap) break; list.push({ name: combo.map(id => t.characters.find(x => x.id === id).name).join(' · '), slots: combo.map(id => ({ unit: `char:${id}`, level: c.level })) }); }
    if (!list.length) { toast('풀이 슬롯 수보다 적습니다'); return; }
  }
  const runs = kind === 'combos' ? state.sim.runs : c.runs;
  const results = [];
  const prog = h('p.muted.small', {}, '');
  const table = h('div');
  els.extra.replaceChildren(h('div.card.role-out', {}, h('div.card-head', {}, h('h2', {}, kind === 'combos' ? '등록한 조합 비교' : `자동 생성 조합 순위 (상위 ${c.top})`), h('span.hint', {}, `같은 적 · 같은 시드 ${state.sim.seed} · 조합마다 ${comma(runs)}회`)), prog, table));
  for (let i = 0; i < list.length; i++) {
    if (my !== busy) return;
    if (i % 2 === 0) { prog.textContent = `계산 중… ${i}/${list.length}`; await new Promise(r => setTimeout(r, 0)); }
    const r = simulate(t, state.rules, { allies: list[i].slots, enemies }, { runs, seed: state.sim.seed, logFirst: false });
    results.push({ ...list[i], r });
  }
  prog.textContent = `${comma(list.length)}개 조합 × ${comma(runs)}회 완료`;
  results.sort((a, b) => b.r.win - a.r.win || (a.r.meanClear || 1e9) - (b.r.meanClear || 1e9));
  const shown = kind === 'combos' ? results : results.slice(0, c.top);
  last = { compare: results };
  table.replaceChildren(h('div.table-wrap', {}, h('table.stages', {},
    h('thead', {}, h('tr', {}, ...['순위', '조합', '승률', `평균 클리어`, '생존 인원', `파티 ${isRT() ? 'DPS' : '턴당 피해'}`, '받은 피해', ''].map((x, i) => h(`th${i < 2 ? '.left' : ''}`, {}, x)))),
    h('tbody', {}, ...shown.map((x, i) => h('tr', {},
      h('td.left', {}, String(i + 1)), h('td.left', {}, h('b', {}, x.name)), h('td', {}, fmtPct(x.r.win)), h('td', {}, fmtDur(x.r.meanClear)), h('td', {}, x.r.survivors.toFixed(2)), h('td', {}, n0(x.r.dps)), h('td', {}, n0(x.r.taken)),
      h('td', {}, h('button.mini-btn', { type: 'button', title: '이 조합을 파티 전투로 열기', onclick: () => { state.party.allies = structuredClone(x.slots); state.view = 'party'; rebuild(); } }, '열기'))))))),
    h('div.tool-actions', {}, h('button.btn.small', { type: 'button', onclick: () => downloadText('combat-compare.csv', toCSV([['순위', '조합', '승률', '평균 클리어', '생존 인원', '파티 DPS', '받은 피해'], ...results.map((x, i) => [i + 1, x.name, x.r.win, x.r.meanClear, x.r.survivors, x.r.dps, x.r.taken])]), 'text/csv;charset=utf-8') }, '결과 CSV')));
}
function* combos(arr, k, start = 0, cur = []) {
  if (cur.length === k) { yield [...cur]; return; }
  for (let i = start; i <= arr.length - (k - cur.length); i++) { cur.push(arr[i]); yield* combos(arr, k, i + 1, cur); cur.pop(); }
}

// ── 전투 로그 ───────────────────────────────────────────
function renderLog(log) {
  const f = state.logFilter;
  const actors = [...new Set(log.flatMap(l => [l.actor, l.target]).filter(Boolean))];
  const evs = [...new Set(log.map(l => l.ev))];
  const rows = log.filter(l => (!f.actor || l.actor === f.actor || l.target === f.actor) && (!f.ev || l.ev === f.ev));
  const shown = rows.slice(0, 600);
  els.log.replaceChildren(
    h('div.card-head', {}, h('h2', {}, ...label('전투 로그', 'c.log')), h('span.hint', {}, `첫 번째 판 · ${comma(log.length)}건 중 ${comma(rows.length)}건`)),
    h('div.log-bar', {},
      select([['', '모든 캐릭터'], ...actors.map(a => [a, a])], f.actor, (v) => { f.actor = v; save(); renderLog(log); }, '로그 캐릭터 필터'),
      select([['', '모든 이벤트'], ...evs.map(e => [e, EV_LABEL[e] ?? e])], f.ev, (v) => { f.ev = v; save(); renderLog(log); }, '로그 이벤트 필터'),
      h('button.btn.small', { type: 'button', onclick: () => downloadText('combat-log.csv', toCSV([[isRT() ? '초' : '턴', '이벤트', '행동 주체', '스킬', '대상', '수치', '치명타', '내용'], ...rows.map(l => [l.t, EV_LABEL[l.ev] ?? l.ev, l.actor ?? '', l.skill ?? '', l.target ?? '', l.value ?? '', l.crit ? 'Y' : '', l.text])]), 'text/csv;charset=utf-8') }, 'CSV 내보내기'),
      h('button.btn.small', { type: 'button', onclick: () => downloadJSON('combat-log.json', { mode: state.rules.mode, log: rows }) }, 'JSON 내보내기')),
    h('div.table-wrap.log-wrap', {}, h('table.mini.log-table', {},
      h('thead', {}, h('tr', {}, ...[isRT() ? '초' : '턴', '이벤트', '행동 주체', '스킬', '대상', '수치', '내용'].map((x, i) => h(`th${i > 0 && i !== 5 ? '.left' : ''}`, {}, x)))),
      h('tbody', {}, ...shown.map(l => h(`tr.ev-${l.ev}`, {}, h('td', {}, String(l.t)), h('td.left', {}, EV_LABEL[l.ev] ?? l.ev), h('td.left', {}, l.actor ?? ''), h('td.left', {}, l.skill ?? ''), h('td.left', {}, l.target ?? ''),
        h('td', {}, l.value != null ? `${comma(l.value)}${l.crit ? ' ★' : ''}` : ''), h('td.left', {}, l.text)))))),
    rows.length > shown.length ? h('p.muted.small', {}, `앞 ${comma(shown.length)}건만 표시 — 전체는 CSV/JSON으로 내보내세요.`) : '',
  );
}

// ── 속성 상성 편집 ──────────────────────────────────────
function renderElements() {
  const t = T(), els_ = t.elements;
  els.elements.replaceChildren(
    h('div.card-head', {}, h('h2', {}, ...label('속성 상성', 'table.elements')), h('span.hint', {}, '행 = 공격 속성, 열 = 방어 속성 · 고치면 데이터 테이블에 바로 저장')),
    h('div.table-wrap', {}, h('table.mini.elem-table', {},
      h('thead', {}, h('tr', {}, h('th.left', {}, '공격 ＼ 방어'), ...els_.map(r => h('th', {}, r.id)))),
      h('tbody', {}, ...els_.map(r => h('tr', {}, h('th.left', {}, r.id), ...els_.map(c => {
        const v = r[`vs:${c.id}`] ?? 1;
        return h(`td.${v > 1 ? 'adv' : v < 1 ? 'dis' : 'eq'}`, {}, h('input', { type: 'number', step: 0.05, min: 0, value: v, 'aria-label': `${r.id} → ${c.id} 배율`,
          onchange: (e) => { const x = parseFloat(e.target.value); if (!(x >= 0)) return; r[`vs:${c.id}`] = x; setTables(t); } }));
      })))))),
  );
}

// ── 프리셋 저장 · A/B 비교 ──────────────────────────────
function renderAB() {
  renderABCard(els.abCard, {
    tool: 'combat',
    current: () => state,
    apply: (st) => { const h2 = hydrate(st); if (h2) { state = h2; rebuild(); } },
    metrics: (st) => {
      const s2 = hydrate(st) || st, t = T();
      const setup = s2.view === 'duel' ? { allies: [s2.duel.a], enemies: [s2.duel.b] } : { allies: s2.party.allies, enemies: s2.party.enemies };
      const ok = (l) => l.filter(x => x.unit && makeUnit(t, x, 0, 0));
      if (!ok(setup.allies).length || !ok(setup.enemies).length) throw new Error('비어 있는 구성');
      const r = simulate(t, s2.rules, { allies: ok(setup.allies), enemies: ok(setup.enemies) }, { runs: Math.min(s2.sim?.runs ?? 300, 1000), seed: state.sim.seed, logFirst: false });
      const d = distStats(r.clear);
      const U = s2.rules.mode === 'realtime' ? '초' : '턴';
      const D = (v) => (Number.isFinite(v) ? `${v.toFixed(1)}${U}` : '—');
      return [
        { label: '승률', value: r.win, fmt: (v) => fmtPct(v), better: 'higher' },
        { label: '평균 클리어', value: r.meanClear, fmt: D, better: 'lower' },
        { label: '클리어 P10', value: d.p10, fmt: D, better: 'lower' },
        { label: '클리어 P50 (중앙값)', value: d.p50, fmt: D, better: 'lower' },
        { label: '클리어 P90', value: d.p90, fmt: D, better: 'lower' },
        { label: '클리어 P99', value: d.p99, fmt: D, better: 'lower' },
        { label: '생존 인원', value: r.survivors, fmt: (v) => `${v.toFixed(2)}명`, better: 'higher' },
        { label: `파티 ${U === '초' ? 'DPS' : '턴당 피해'}`, value: r.dps, fmt: (v) => comma(v), better: 'higher' },
        { label: '받은 피해', value: r.taken, fmt: (v) => comma(v), better: 'lower' },
      ];
    },
    note: '두 설정을 지금 시드로 같은 횟수(최대 1,000회) 돌립니다. 데이터 테이블은 프리셋에 들어가지 않고 지금 테이블을 씁니다.',
  });
}

// ── 기획서 ──────────────────────────────────────────────
function renderDoc() { els.doc.replaceChildren(...combatDoc(T(), { ...DEFAULT_RULES, ...state.rules }, state.view)); }

// ── 공유·저장 ───────────────────────────────────────────
function copyShareLink() {
  const url = `${location.origin}${location.pathname}#combat?s=${encodeState(state)}`;
  navigator.clipboard?.writeText(url).then(() => toast('공유 링크를 복사했습니다 (데이터 테이블은 따로 JSON으로 공유)'), () => prompt('공유 링크', url));
}
async function importJSON() {
  try {
    const data = await pickJSON();
    const st = data?.tool === 'combat' ? hydrate(data.state) : null;
    if (!st) throw new Error();
    state = st; rebuild(); toast('설정을 불러왔습니다');
  } catch { toast('불러올 수 없는 파일입니다'); }
}
export { battle };
