// 가챠·수집 설계 — 화면: 왼쪽 설정(템플릿·비용·천장·픽업·마일리지·기준 유저), 오른쪽 등급·확률 → 목표 → 달성 곡선·예산 → 검증
import { analyze, helpers, GOAL_TYPES, disclosure, unitExpectations } from './model.js';
import { TEMPLATES } from './presets.js';
import { h, store, encodeState, decodeState, downloadJSON, downloadText, pickJSON, toast, debounce, comma, fmtMoney, fmtPct } from '../lib/util.js';

const SCHEMA = 1;
const STORE_KEY = 'gacha:v1';

let state, last, timer, chart;
const els = {};
const save = debounce(() => store.set(STORE_KEY, state), 300);
const schedule = (ms = 200) => { clearTimeout(timer); timer = setTimeout(recompute, ms); };
const newId = (p) => p + Date.now().toString(36) + Math.floor(Math.random() * 1e3);

function defaultState(id) { return { v: SCHEMA, template: id, view: 0, budgetWon: 0, discLevel: 0, discDigits: 4, ...TEMPLATES[id].make() }; }
function hydrate(o) { return o && o.v === SCHEMA && TEMPLATES[o.template] ? { ...defaultState(o.template), ...o } : null; }
function readHash() { const m = location.hash.match(/^#gacha\?s=([\w-]+)/); return m ? hydrate(decodeState(m[1])) : null; }
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// 금액 표시: 원화 단가가 있으면 원, 없으면 유료 재화
const hasWon = () => state.wonPerGem > 0;
const pullsToMoney = (n) => n * state.pullCost * (hasWon() ? state.wonPerGem : 1);
const money = (n) => (Number.isFinite(n) ? `${fmtMoney(n)}${hasWon() ? '원' : ` ${state.gemName}`}` : '—');
const pullsMoney = (n) => money(pullsToMoney(n));
const days = (d) => (Number.isFinite(d) ? `${comma(Math.max(1, Math.ceil(d)))}일` : '—');

export function mount(root) {
  state = readHash() || hydrate(store.get(STORE_KEY)) || defaultState('idle');
  if (location.hash.startsWith('#gacha?')) history.replaceState(null, '', '#gacha');
  build(root);
  rebuild();
  document.addEventListener('themechange', () => last && drawChart(last));
  window.addEventListener('hashchange', () => { const st = readHash(); if (st) { state = st; history.replaceState(null, '', '#gacha'); rebuild(); } });
}

// ── 골격 ────────────────────────────────────────────────
function build(root) {
  els.budgetInput = h('input', {
    type: 'number', min: 0, step: 'any', 'aria-label': '예산',
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { state.budgetWon = v; save(); renderBudget(last); } },
  });
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '가챠·수집 설계'),
        h('p', {}, '등급 확률, 소환 레벨, 천장, 픽업, 마일리지, 중복 분해 교환을 넣고 “이 유닛을 이만큼 모으려면 얼마가 드나”를 계산합니다. 필요 장수 ÷ 확률로 하는 단순 계산이 중복과 확률 구조 때문에 얼마나 빗나가는지 나눠서 보여줍니다.'),
      ),
      h('div.tool-actions', {},
        h('button.btn', { type: 'button', onclick: copyShareLink }, '공유 링크'),
        h('button.btn', { type: 'button', onclick: exportCSV }, '결과 CSV'),
        h('button.btn', { type: 'button', onclick: () => downloadJSON(`gacha-${state.template}.json`, state) }, 'JSON 저장'),
        h('button.btn', { type: 'button', onclick: importJSON }, '불러오기'),
      ),
    ),
    h('div.enh-layout', {},
      els.side = h('aside.enh-side', { 'aria-label': '설정' }),
      h('div.enh-main', {},
        els.errors = h('ul.errors', { hidden: true }),
        els.kpis = h('div.kpis.econ-kpis'),
        els.grades = h('div.card.role-in'),
        els.goals = h('div.card.role-in'),
        h('div.card.role-out', {},
          h('div.card-head', {}, els.distTitle = h('h2', {}, '달성 확률과 예산'), els.distHint = h('span.hint', {})),
          h('div.dist', {},
            h('div.chart-box', {}, els.canvas = h('canvas', { role: 'img', 'aria-label': '뽑기 수별 목표 달성 확률' })),
            h('div.budget', {},
              h('label.field', {}, els.budgetLabel = h('span', {}, '예산'), els.budgetInput),
              els.budgetOut = h('div.budget-out', {}),
              els.pct = h('dl.pct-list', {}),
            ),
          ),
        ),
        h('div.two-col', {},
          els.why = h('div.card.role-out'),
          els.verify = h('div.card.role-check'),
        ),
        els.disc = h('div.card.role-out.disc-card'),
        els.warnCard = h('div.card.role-check'),
      ),
    ),
  );
}

// ── 공용 입력 ───────────────────────────────────────────
const field = (label, input, hint) => h('label.field', {}, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
function num(obj, key, opts = {}) {
  return h('input', {
    type: 'number', value: obj[key], step: opts.step ?? 'any', min: opts.min, 'aria-label': opts.label, class: opts.cls,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { obj[key] = opts.int ? Math.round(v) : v; opts.after?.(); schedule(); } },
  });
}
const text = (obj, key, label, after) => h('input.name', { type: 'text', value: obj[key], 'aria-label': label, oninput: (e) => { obj[key] = e.target.value; after?.(); schedule(400); } });
const select = (options, value, onchange, attrs = {}) => h('select', { onchange: (e) => onchange(e.target.value), ...attrs }, ...options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
const toggle = (label, obj, key) => h('label.switch', {}, label, h('input', { type: 'checkbox', checked: !!obj[key], onchange: (e) => { obj[key] = e.target.checked; renderSide(); schedule(0); } }));

const OPEN_KEY = 'gacha:sideOpen';
function section(id, title, summary, ...body) {
  const open = (store.get(OPEN_KEY) || {})[id] ?? (id === 'base' || matchMedia('(min-width: 1101px)').matches);
  return h('details.side-sec', { open, ontoggle: (e) => store.set(OPEN_KEY, { ...(store.get(OPEN_KEY) || {}), [id]: e.target.open }) },
    h('summary', {}, h('span.side-title', {}, title), summary ? h('span.side-sum', {}, summary) : null),
    h('div.side-body', {}, ...body.filter(Boolean)));
}

// ── 왼쪽 메뉴 ───────────────────────────────────────────
function renderSide() {
  const s = state, top = s.grades.at(-1)?.name ?? '최상위';
  const onePull = s.pullCost * (s.wonPerGem || 0);
  els.side.replaceChildren(
    section('base', '템플릿', TEMPLATES[s.template].label.split(' —')[0],
      select(Object.entries(TEMPLATES).map(([id, t]) => [id, t.label]), s.template, (v) => { state = defaultState(v); rebuild(); }),
      h('p.desc', {}, TEMPLATES[s.template].note),
    ),
    section('cost', '뽑기 비용', hasWon() ? `1회 ${fmtMoney(onePull)}원` : `1회 ${comma(s.pullCost)} ${s.gemName}`,
      h('div.row2', {},
        field('유료 재화 이름', text(s, 'gemName', '유료 재화 이름', () => refreshTables())),
        field('1회 비용', num(s, 'pullCost', { min: 0, label: '1회 뽑기 비용', after: () => renderSide() }))),
      field(`${s.gemName} 1개당 원`, num(s, 'wonPerGem', { min: 0, label: '원화 단가', after: () => renderSide() }), '패키지 기준 단가. 0이면 결과를 유료 재화로 표시합니다'),
    ),
    section('pity', `천장 (${top})`, s.pity.enabled ? `${s.pity.hard}회${s.pity.softStep > 0 ? ` · ${s.pity.softStart}회부터 상승` : ''}` : '없음',
      toggle('천장 사용', s.pity, 'enabled'),
      s.pity.enabled ? h('div.row3', {},
        field('천장 (회)', num(s.pity, 'hard', { int: true, min: 1, label: '천장' })),
        field('상승 시작', num(s.pity, 'softStart', { int: true, min: 1, label: '확률 상승 시작' })),
        field('상승폭 %p', num(s.pity, 'softStep', { min: 0, label: '회당 확률 상승폭' }))) : null,
      h('p.desc', {}, `마지막 ${top} 이후 횟수를 셉니다. 상승 시작부터 한 번마다 상승폭만큼 확률이 오르고, 천장 횟수째에는 확정입니다. 상승폭 0 = 확정 천장만.`),
    ),
    section('pickup', `픽업 (${top})`, s.pickup.enabled ? `${s.pickup.share}%${s.pickup.guarantee ? ' · 보장' : ''}` : '없음',
      toggle('픽업 사용', s.pickup, 'enabled'),
      s.pickup.enabled ? field('픽업 비율 (%)', num(s.pickup, 'share', { min: 0, label: '픽업 비율' }), `${top}이(가) 나왔을 때 픽업 유닛일 확률`) : null,
      s.pickup.enabled ? toggle('놓치면 다음은 픽업 확정', s.pickup, 'guarantee') : null,
    ),
    section('mileage', '마일리지 (선택 교환)', s.mileage.enabled ? `${comma(s.mileage.cost / s.mileage.per)}회마다 1장` : '없음',
      toggle('마일리지 사용', s.mileage, 'enabled'),
      s.mileage.enabled ? h('div.row2', {},
        field('뽑기당 적립', num(s.mileage, 'per', { min: 0, label: '뽑기당 마일리지', after: () => renderSide() })),
        field('교환 가격', num(s.mileage, 'cost', { min: 0, label: '마일리지 교환 가격', after: () => renderSide() }))) : null,
      h('p.desc', {}, `모이면 ${top} 중 원하는 1장(픽업 포함)과 바로 교환한다고 봅니다.`),
    ),
    section('user', '기준 유저', `무과금 ${comma(s.user.freePerDay)}/일`,
      field(`무과금 하루 ${s.gemName} 획득`, num(s.user, 'freePerDay', { min: 0, label: '무과금 하루 획득' }), '퀘스트·출석·광고 등 무료로 버는 양 (뽑기권은 환산)'),
      field('기준 과금 유저 월 과금 (원)', num(s.user, 'monthlyWon', { min: 0, label: '월 과금' }), '무과금 획득 + 월 과금 ÷ 30 ÷ 단가 만큼 매일 생긴다고 봅니다'),
    ),
    section('calc', '계산', `시뮬레이션 ${comma(s.runs)}회`,
      field('목표당 시뮬레이션 횟수', num(s, 'runs', { int: true, min: 200, label: '시뮬레이션 횟수' }), '정확해가 있는 목표는 분포도 정확해를 씁니다. 나머지는 시드 고정 시뮬레이션'),
    ),
  );
}

// ── 등급·확률 표 ────────────────────────────────────────
const refreshTables = debounce(() => { renderGrades(); renderGoals(); recompute(); }, 400);

function renderGrades() {
  const s = state, L = s.levels.length;
  els.levelSum = [];
  const lvHead = s.levels.map((from, l) => h('th', { title: `누적 ${comma(from)}회부터` }, L > 1 ? `Lv${l + 1} %` : '확률 %'));
  const lvFrom = s.levels.map((from, l) => h('th', {}, l === 0 ? '0회~' : num(s.levels, l, { int: true, min: 1, label: `소환 레벨 ${l + 1} 기준 뽑기 수`, cls: 'short' })));
  els.grades.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '① 등급과 확률'), h('span.hint', {}, L > 1 ? '아래가 상위 등급 · 둘째 줄 = 그 소환 레벨이 시작되는 누적 뽑기 수' : '아래가 상위 등급 · 같은 등급 안의 유닛은 균등')),
    h('div.table-wrap', {}, h('table.edit-table.gacha-table', {},
      h('thead', {},
        h('tr', {}, h('th.left', {}, '등급'), h('th', {}, '종 수'), h('th', { title: `필요 없는 중복 1장이 바뀌는 ${s.shardName} 수` }, `중복 ${s.shardName}`), h('th', { title: `이 등급 원하는 1장의 ${s.shardName} 가격 (0 = 교환 없음)` }, '교환 가격'), ...lvHead, h('th', {}, '')),
        L > 1 ? h('tr.lv-from', {}, h('th.left', { colspan: 4 }, '소환 레벨 시작 (누적 뽑기)'), ...lvFrom, h('th', {}, '')) : null,
      ),
      h('tbody', {}, ...s.grades.map((g, i) => h(`tr${i === s.grades.length - 1 ? '.top-grade' : ''}`, {},
        h('td', {}, text(g, 'name', '등급 이름', () => refreshTables())),
        h('td', {}, num(g, 'kinds', { int: true, min: 1, label: `${g.name} 종 수`, cls: 'short' })),
        h('td', {}, num(g, 'shard', { min: 0, label: `${g.name} 중복 조각`, cls: 'short' })),
        h('td', {}, num(g, 'exchange', { min: 0, label: `${g.name} 교환 가격` })),
        ...s.levels.map((_, l) => h('td', {}, num(g.probs, l, { min: 0, label: `${g.name} 레벨 ${l + 1} 확률`, cls: 'short', after: updateSums }))),
        h('td.x', {}, h('button.icon-x', { type: 'button', title: '삭제', disabled: s.grades.length <= 1, onclick: () => removeGrade(i) }, '×')),
      ))),
      h('tfoot', {}, h('tr', {}, h('td.left.muted', { colspan: 4 }, '합계 (100%여야 함)'), ...s.levels.map((_, l) => (els.levelSum[l] = h('td.res', {}))), h('td', {}))),
    )),
    h('div.table-foot', {},
      h('button.btn.small', { type: 'button', onclick: addGrade }, '+ 최상위 등급 추가'),
      h('button.btn.small', { type: 'button', onclick: addLevel }, '+ 소환 레벨 추가'),
      h('button.btn.small', { type: 'button', disabled: L <= 1, onclick: () => { s.levels.pop(); s.grades.forEach(g => g.probs.pop()); rebuild(); } }, '마지막 레벨 삭제'),
    ),
  );
  updateSums();
}

function updateSums() {
  state.levels.forEach((_, l) => {
    const sum = state.grades.reduce((a, g) => a + (g.probs[l] || 0), 0);
    const el = els.levelSum[l];
    if (!el) return;
    el.textContent = `${+sum.toFixed(4)}%`;
    el.classList.toggle('bad-text', Math.abs(sum - 100) > 1e-6);
  });
}
function addGrade() {
  state.grades.push({ id: newId('gr'), name: '새 등급', kinds: 1, probs: state.levels.map(() => 0), shard: 0, exchange: 0 });
  rebuild();
}
function removeGrade(i) {
  const [g] = state.grades.splice(i, 1);
  const top = state.grades.at(-1).id;
  state.goals.forEach(goal => { if (goal.grade === g.id) { goal.grade = top; goal.kinds = Math.min(goal.kinds, state.grades.at(-1).kinds); } });
  rebuild();
}
function addLevel() {
  const lastFrom = state.levels.at(-1);
  state.levels.push(lastFrom > 0 ? Math.round(lastFrom * 2) : 100);
  state.grades.forEach(g => g.probs.push(g.probs.at(-1) ?? 0));
  rebuild();
}

// ── 목표 표 ─────────────────────────────────────────────
function renderGoals() {
  const s = state;
  els.goalOut = {};
  const gradeOpts = s.grades.map(g => [g.id, g.name]);
  els.goals.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '② 목표 — 무엇을 몇 장 모으나'), h('span.hint', {}, '왼쪽 동그라미 = 아래 그래프·분석에 표시할 목표 · 수집 = 등급 안 K종을 각 k장')),
    h('div.table-wrap', {}, h('table.edit-table.goal-table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, ''), h('th.left', {}, '목표'), h('th', {}, '종류'), h('th', {}, '등급'), h('th', { title: '모을 종 수 (K)' }, '종 수'), h('th', { title: '종마다 필요한 장수 (k)' }, '장수'),
        h('th', { title: '평균 뽑기 수' }, '기대 뽑기'), h('th', {}, '기대 비용'), h('th', { title: '이 비용이면 90%가 달성' }, '90% 비용'),
        h('th', { title: '필요 장수 ÷ 최고 확률로 한 단순 계산 대비 실제 배수' }, '단순 계산 대비'),
        h('th', {}, '무과금'), h('th', {}, '과금 유저'), h('th', {}, '계산'), h('th', {}, ''))),
      h('tbody', {}, ...s.goals.map((goal, i) => {
        const o = els.goalOut[goal.id] = { mean: h('td.res', {}), cost: h('td.res', {}), p90: h('td.res', {}), ratio: h('td.res', {}), free: h('td.res', {}), paid: h('td.res', {}), how: h('td.res', {}) };
        const isPickup = goal.type === 'pickup', isCollect = goal.type === 'collect';
        return h(`tr${i === s.view ? '.sel' : ''}`, {},
          h('td', {}, h('label.radio', { title: '분석에 표시' }, h('input', { type: 'radio', name: 'gacha-view', checked: i === s.view, onchange: () => { s.view = i; save(); renderGoals(); if (last) showSelected(last); } }))),
          h('td', {}, text(goal, 'name', '목표 이름')),
          h('td', {}, select(Object.entries(GOAL_TYPES), goal.type, (v) => { goal.type = v; if (v !== 'pickup' && !s.grades.some(g => g.id === goal.grade)) goal.grade = s.grades.at(-1).id; goal.kinds = Math.max(1, goal.kinds || 1); rebuild(); })),
          h('td', {}, isPickup ? h('span.muted', {}, s.grades.at(-1).name) : select(gradeOpts, goal.grade, (v) => { goal.grade = v; const g = s.grades.find(x => x.id === v); goal.kinds = Math.min(goal.kinds || 1, g.kinds); rebuild(); })),
          h('td', {}, isCollect ? num(goal, 'kinds', { int: true, min: 1, label: `${goal.name} 종 수`, cls: 'short' }) : h('span.muted', { title: isPickup ? '픽업 캐릭터 1종' : (s.pickup.enabled && goal.grade === s.grades.at(-1).id ? '픽업이 아닌 캐릭터 1종' : '정해진 캐릭터 1종') }, '1')),
          h('td', {}, num(goal, 'copies', { int: true, min: 1, label: `${goal.name} 장수`, cls: 'short' })),
          o.mean, o.cost, o.p90, o.ratio, o.free, o.paid, o.how,
          h('td.x', {}, h('button.icon-x', { type: 'button', title: '삭제', disabled: s.goals.length <= 1, onclick: () => { s.goals.splice(i, 1); s.view = 0; rebuild(); } }, '×')),
        );
      })),
    )),
    h('div.table-foot', {},
      h('button.btn.small', { type: 'button', onclick: () => { s.goals.push({ id: newId('g'), name: '새 목표', type: 'collect', grade: s.grades.at(-1).id, kinds: 1, copies: 1 }); rebuild(); } }, '+ 목표 추가'),
      h('span.muted.small', {}, '목표마다 처음부터 따로 뽑는다고 계산합니다 (천장 카운터·마일리지는 0에서 시작)'),
    ),
  );
}

function rebuild() { renderSide(); renderGrades(); renderGoals(); recompute(); }

// ── 계산·표시 ───────────────────────────────────────────
function recompute() {
  save();
  const res = analyze(state);
  if (!res.ok) {
    els.errors.replaceChildren(...res.errors.slice(0, 8).map(e => h('li', {}, e)));
    els.errors.hidden = false;
    return;
  }
  els.errors.hidden = true;
  last = res;
  if (!(state.view < res.goals.length)) state.view = 0;
  for (const r of res.goals) {
    const o = els.goalOut[r.goal.id];
    if (!o) continue;
    o.mean.textContent = Number.isFinite(r.mean) ? `${comma(r.mean)}회` : '불가';
    o.cost.textContent = pullsMoney(r.mean);
    o.p90.textContent = pullsMoney(r.pct.p90);
    const ratio = r.mean / r.naive;
    o.ratio.textContent = Number.isFinite(ratio) ? `×${ratio.toFixed(2)}` : '—';
    o.ratio.classList.toggle('bad-text', ratio >= 1.2);
    o.ratio.title = `단순 계산 ${comma(r.naive)}회`;
    o.free.textContent = days(r.daysFree);
    o.paid.textContent = days(r.daysPaid);
    o.how.textContent = r.exactMean != null ? '정확해' : '시뮬레이션';
  }
  renderKPIs(res);
  showSelected(res);
  renderVerify(res);
  renderWarnings(res);
  renderDisclosure();
}

function showSelected(res) {
  const r = res.goals[state.view];
  renderKPIs(res);
  els.distTitle.textContent = `달성 확률과 예산 — ${r.goal.name}`;
  els.distHint.textContent = r.exact ? '정확한 분포 (동적 계획법)' : `시뮬레이션 ${comma(r.sim.runs)}회${r.exactMean != null ? ' · 평균은 정확해' : ''}`;
  if (!(state.budgetWon > 0)) state.budgetWon = Math.round(pullsToMoney(r.mean));
  const row = (dt, dd) => h('div', {}, h('dt', {}, dt), h('dd', {}, dd));
  els.pct.replaceChildren(
    row('50% 달성', pullsMoney(r.pct.p50)),
    row('90% 달성', pullsMoney(r.pct.p90)),
    row('99% 달성', pullsMoney(r.pct.p99)),
  );
  renderBudget(res);
  drawChart(res);
  renderWhy(r);
}

function renderKPIs(res) {
  const r = res.goals[state.view];
  const ratio = r.mean / r.naive;
  els.kpis.replaceChildren(
    h('div.card.kpi.hero', {},
      h('div.kpi-label', {}, `기대 비용 · ${r.goal.name}`),
      h('div.kpi-value', {}, pullsMoney(r.mean)),
      h('div.kpi-sub', {}, '중앙값 ', h('b', {}, pullsMoney(r.pct.p50)), ' · 운 나쁜 10% ', h('b', {}, pullsMoney(r.pct.p90)), ' · 1% ', h('b', {}, pullsMoney(r.pct.p99)))),
    h('div.card.kpi', {},
      h('div.kpi-label', {}, '기대 뽑기 수'),
      h('div.kpi-value', {}, Number.isFinite(r.mean) ? `${comma(r.mean)}회` : '불가'),
      h('div.kpi-sub', {}, `${comma(r.mean * state.pullCost)} ${state.gemName} · ${r.exactMean != null ? '정확해' : '시뮬레이션'}`)),
    h('div.card.kpi', {},
      h('div.kpi-label', {}, '단순 계산 대비'),
      h(`div.kpi-value${ratio >= 1.2 ? '.bad-text' : ''}`, {}, Number.isFinite(ratio) ? `×${ratio.toFixed(2)}` : '—'),
      h('div.kpi-sub', {}, `필요 장수 ÷ 확률 = ${comma(r.naive)}회`)),
    h('div.card.kpi', {},
      h('div.kpi-label', {}, '도달 기간 (평균)'),
      h('div.kpi-value', {}, days(r.daysFree)),
      h('div.kpi-sub', {}, `무과금 · 월 ${fmtMoney(state.user.monthlyWon)}원 과금 시 `, h('b', {}, days(r.daysPaid)))),
  );
}

function renderBudget(res) {
  if (!res) return;
  const r = res.goals[state.view];
  els.budgetLabel.textContent = `예산 (${hasWon() ? '원' : state.gemName})`;
  if (document.activeElement !== els.budgetInput) els.budgetInput.value = Math.round(state.budgetWon);
  const pulls = Math.floor(state.budgetWon / (state.pullCost * (hasWon() ? state.wonPerGem : 1)));
  const p = r.reach(pulls);
  els.budgetOut.replaceChildren(
    h('div.big', {}, fmtPct(p, 1)),
    h('div.muted', {}, `이 예산(뽑기 ${comma(pulls)}회)으로 목표를 달성하는 비율`),
  );
}

function drawChart(res) {
  if (typeof Chart === 'undefined') return;
  const r = res.goals[state.view];
  const grid = cssVar('--grid'), tick = cssVar('--text-3'), ink = cssVar('--text-2'), accent = cssVar('--series-1');
  let pts;
  if (r.exact) pts = r.exact.cdf.map(([x, y]) => ({ x, y: y * 100 }));
  else {
    const s = r.sim.sorted, n = s.length, step = Math.max(1, Math.floor(n / 400));
    pts = [{ x: 0, y: 0 }];
    for (let i = 0; i < n; i += step) if (Number.isFinite(s[i])) pts.push({ x: s[i], y: ((i + 1) / n) * 100 });
    if (Number.isFinite(s[n - 1])) pts.push({ x: s[n - 1], y: 100 });
  }
  const xMax = Math.max(r.pct.p99 * 1.1, r.naive * 1.05);
  pts = pts.filter(p => p.x <= xMax);
  const vline = (x, label, color, dash) => ({ label, data: [{ x, y: 0 }, { x, y: 100 }], borderColor: color, borderDash: dash, borderWidth: 1.25, pointRadius: 0 });
  chart?.destroy();
  chart = new Chart(els.canvas, {
    type: 'line',
    data: { datasets: [
      { label: '달성 확률', data: pts, borderColor: accent, backgroundColor: accent, borderWidth: 2.25, pointRadius: 0, stepped: !!r.exact },
      vline(r.mean, '평균', ink, [5, 4]),
      vline(r.naive, '단순 계산', cssVar('--st-warn'), [2, 3]),
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      scales: {
        x: { type: 'linear', min: 0, max: xMax, title: { display: true, text: '뽑기 수', color: tick }, grid: { color: grid }, ticks: { color: tick, callback: (v) => comma(v) } },
        y: { min: 0, max: 100, title: { display: true, text: '달성 %', color: tick }, grid: { color: grid }, ticks: { color: tick } },
      },
      plugins: {
        legend: { labels: { color: ink, boxWidth: 12 } },
        tooltip: { callbacks: { label: (it) => (it.datasetIndex === 0 ? `${comma(it.raw.x)}회 (${pullsMoney(it.raw.x)}) → ${it.raw.y.toFixed(1)}%` : `${it.dataset.label}: ${comma(it.raw.x)}회`) } },
      },
    },
  });
}

/** 단순 계산 → 중복 없을 때 → 실제, 획득 경로 */
function renderWhy(r) {
  const row = (dt, dd, sub) => h('div', {}, h('dt', {}, dt), h('dd', {}, dd, sub ? h('span.muted.small', {}, ` ${sub}`) : null));
  const s = r.sim.sources, total = s.pull + s.pity + s.mileage + s.exchange || 1;
  const share = (v) => `${((v / total) * 100).toFixed(0)}%`;
  els.why.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '왜 이만큼 드나'), h('span.hint', {}, r.goal.name)),
    h('dl.pct-list', {},
      row('① 단순 계산', `${comma(r.naive)}회`, '필요 장수 ÷ 최고 확률'),
      r.noDup != null ? row('② 중복이 없다면', `${comma(r.noDup)}회`, `×${(r.noDup / r.naive).toFixed(2)} — ${[state.levels.length > 1 ? '소환 레벨 구간' : '확률 구조', helpers(state, r.spec)].filter(Boolean).join('·')}`) : null,
      row(r.noDup != null ? '③ 실제 (중복 포함)' : '② 실제', `${comma(r.mean)}회`, r.noDup != null ? `×${(r.mean / r.noDup).toFixed(2)} — 이미 모은 유닛의 중복` : `×${(r.mean / r.naive).toFixed(2)}`),
    ),
    h('p.muted.small', {}, '획득 경로 (시뮬레이션 평균 장수)'),
    h('dl.pct-list', {},
      row('뽑기에서 직접', `${s.pull.toFixed(2)}장`, share(s.pull)),
      s.pity > 0.005 ? row('천장 확정', `${s.pity.toFixed(2)}장`, share(s.pity)) : null,
      s.mileage > 0.005 ? row('마일리지 교환', `${s.mileage.toFixed(2)}장`, share(s.mileage)) : null,
      s.exchange > 0.005 ? row(`${state.shardName} 교환`, `${s.exchange.toFixed(2)}장`, share(s.exchange)) : null,
    ),
  );
}

function renderVerify(res) {
  const rows = res.goals.filter(r => r.exactMean != null);
  const rel = (a, b) => Math.abs(a - b) / b;
  const maxDiff = rows.length ? Math.max(...rows.map(r => rel(r.sim.mean, r.exactMean))) : null;
  const ok = maxDiff != null && maxDiff < 0.03;
  els.verify.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '계산 검증'),
      rows.length ? h(`span.status.${ok ? 'good' : 'warn'}`, {}, ok ? `✓ 일치 (오차 ${(maxDiff * 100).toFixed(1)}%)` : `! 오차 ${(maxDiff * 100).toFixed(1)}% — 표본 부족 가능`) : null),
    h('p.muted.small', {}, '수집 목표는 포아송화 적분(확률 고정·교환 없음일 때), 픽업 목표는 (모은 장수 × 천장 카운터 × 보장) 상태 분포를 뽑기마다 전진시키는 동적 계획법으로 정확히 풀고, 시드 고정 시뮬레이션과 비교합니다.'),
    rows.length ? h('div.verify-grid', {},
      h('span.h', {}, ''), h('span.h', {}, '정확해'), h('span.h', {}, `시뮬레이션 ${comma(rows[0].sim.runs)}회`),
      ...rows.flatMap(r => [h('span', {}, r.goal.name), h('b', {}, `${(r.exactMean).toFixed(1)}회`), h('span', {}, `${r.sim.mean.toFixed(1)}회`)]),
    ) : h('p.muted', {}, '이 설정에는 정확해를 쓸 수 있는 목표가 없습니다 (소환 레벨이 여러 개거나 교환이 있는 수집 목표). 시뮬레이션 결과만 표시합니다.'),
  );
}

function renderWarnings(res) {
  const LV = { serious: '불가', warn: '주의', info: '참고' };
  els.warnCard.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '검증 결과'), h('span.hint', {}, res.warnings.length ? `${res.warnings.length}건` : '문제 없음')),
    res.warnings.length
      ? h('ul.findings', {}, ...res.warnings.map(w => h(`li.${w.level === 'info' ? 'info' : w.level}`, {}, h('span.lv', {}, LV[w.level]), h('span', {}, w.text))))
      : h('p.muted', {}, '단순 계산과 크게 다르지 않고, 기준 유저가 1년 안에 모든 목표에 닿습니다.'),
  );
}

// ── 확률 공시표 ─────────────────────────────────────────
// 모든 캐릭터의 확률(소환 레벨별), 확률이 바뀌는 조건(천장·픽업 보장·마일리지·교환), 천장을 포함한 실효 확률.
// 표시 자릿수로 반올림했을 때 0으로 보이는 확률과 합계 오차를 함께 검사한다.
function renderDisclosure() {
  const d = disclosure(state);
  const L = d.levels.length;
  if (!(state.discLevel < L)) state.discLevel = 0;
  const lv = d.levels[state.discLevel];
  const digits = state.discDigits ?? 4;
  const pct = (p) => `${(p * 100).toFixed(digits)}%`;
  const exp = unitExpectations(state);
  const expOf = (gi, featured) => exp.find(x => x.gi === gi && x.featured === featured) ?? exp.find(x => x.gi === gi);
  const top = state.grades.length - 1;

  // 반올림 검사: 0보다 큰데 0으로 보이는 캐릭터, 표시값 합계
  const hidden = [], shownSum = d.levels.map(l => l.grades.reduce((a, g) => a + g.units.reduce((b, u) => b + +(u.prob * 100).toFixed(digits), 0), 0));
  d.levels.forEach(l => l.grades.forEach(g => g.units.forEach(u => { if (u.prob > 0 && +(u.prob * 100).toFixed(digits) === 0) hidden.push(`Lv${l.level} ${u.name}`); })));
  const sumOff = shownSum.map((v, i) => [i, v]).filter(([, v]) => Math.abs(v - 100) > 10 ** -(digits + 2));

  const lvLabel = (l) => `Lv${l.level} (${comma(l.from)}회~${l.to != null ? `${comma(l.to)}회` : ''})`;
  const gradeTable = h('table.mini.disc-table', {},
    h('thead', {}, h('tr', {}, h('th.left', {}, '등급'), h('th', {}, '종 수'), ...d.levels.map(l => h('th', {}, L > 1 ? lvLabel(l) : '확률')))),
    h('tbody', {}, ...state.grades.map((g, gi) => h('tr', {}, h('td.left', {}, g.name), h('td', {}, comma(g.kinds)), ...d.levels.map(l => h('td', {}, pct(l.grades[gi].prob)))))),
    h('tfoot', {}, h('tr', {}, h('td.left', { colspan: 2 }, '합계'), ...d.levels.map(l => h('td', {}, pct(l.sum))))),
  );

  const unitRows = lv.grades.flatMap(g => g.units.map((u, i) => {
    const e = expOf(g.gi, u.featured);
    return h(`tr${i === 0 ? '.grade-first' : ''}${u.featured ? '.featured' : ''}`, {},
      h('td.left', {}, i === 0 ? g.name : ''),
      h('td.left', {}, u.name, u.featured ? h('span.disc-tag', {}, '픽업') : null),
      h('td', {}, pct(u.prob)),
      h('td', { title: e?.exact ? '정확해' : '시뮬레이션' }, e && Number.isFinite(e.mean) ? `${comma(e.mean)}회` : '—'),
      h('td', {}, e && Number.isFinite(e.mean) ? pullsMoney(e.mean) : '—'),
    );
  }));
  const unitTable = h('table.mini.disc-table', {},
    h('thead', {}, h('tr', {}, h('th.left', {}, '등급'), h('th.left', {}, '캐릭터'), h('th', {}, `확률${L > 1 ? ` · Lv${lv.level}` : ''}`),
      h('th', { title: '처음(누적 0회)부터 이 캐릭터 1장을 얻을 때까지 — 소환 레벨·천장·보장 포함' }, '1장 기대 뽑기'), h('th', {}, '1장 기대 비용'))),
    h('tbody', {}, ...unitRows),
  );

  const pity = d.pity?.[state.discLevel];
  const eff = d.effective[state.discLevel];
  const topName = state.grades[top].name;
  const nameInputs = state.grades.map((g, gi) => h('label.field', {}, h('span', {}, `${g.name} (${g.kinds}종)`),
    h('input', { type: 'text', value: (g.names || []).join(', '), placeholder: `비우면 ${gi === top && state.pickup.enabled ? `${g.name} 픽업, ${g.name} 1, …` : `${g.name} 1, ${g.name} 2, …`}`,
      oninput: (e) => { g.names = e.target.value.split(',').map(t => t.trim()); save(); clearTimeout(timer); timer = setTimeout(renderDisclosure, 300); } })));

  els.disc.replaceChildren(...[
    h('div.card-head', {}, h('h2', {}, '확률 공시표'),
      h('div.tool-actions', {},
        L > 1 ? select(d.levels.map((l, i) => [i, `소환 ${lvLabel(l)}`]), state.discLevel, (v) => { state.discLevel = +v; save(); renderDisclosure(); }) : null,
        select([2, 3, 4, 5, 6].map(n => [n, `소수 ${n}자리`]), digits, (v) => { state.discDigits = +v; save(); renderDisclosure(); }),
        h('button.btn.small', { type: 'button', onclick: () => exportDisclosureCSV(d) }, '공시표 CSV'),
      )),
    h('p.muted.small', {}, '확률형 아이템 공시용: 모든 캐릭터의 개별 확률과, 확률이 바뀌는 조건(소환 레벨·천장·픽업 보장)을 함께 냅니다. 같은 등급 안에서는 균등, 픽업 등급은 픽업 비율로 나눕니다.'),
    hidden.length || sumOff.length ? h('ul.findings', {},
      ...hidden.slice(0, 3).map(t => h('li.warn', {}, h('span.lv', {}, '주의'), h('span', {}, `${t}: 0보다 크지만 소수 ${digits}자리로는 0%로 보입니다 — 자릿수를 늘리세요.`))),
      sumOff.length ? h('li.info', {}, h('span.lv', {}, '참고'), h('span', {}, `${L > 1 ? `${sumOff.map(([i]) => `Lv${i + 1}`).join('·')}: ` : ''}표시값 합계가 반올림 때문에 100%에서 최대 ±${Math.max(...sumOff.map(([, v]) => Math.abs(v - 100))).toFixed(digits)}%p 어긋납니다 (실제 합은 100%).`)) : null) : null,
    h('h3.disc-h', {}, '① 등급별 확률'),
    h('div.table-wrap', {}, gradeTable),
    h('h3.disc-h', {}, `② 캐릭터별 확률${L > 1 ? ` — 소환 Lv${lv.level}` : ''}`),
    h('div.table-wrap.disc-units', {}, unitTable),
    h('details.disc-names', {}, h('summary', {}, '캐릭터 이름 입력 (쉼표로 구분)'), h('div.row2', {}, ...nameInputs)),
    pity ? h('h3.disc-h', {}, `③ ${topName} 확률 변동 (천장)`) : null,
    pity ? h('div.table-wrap', {}, h('table.mini.disc-table', {},
      h('thead', {}, h('tr', {}, h('th.left', {}, `마지막 ${topName} 이후`), h('th', {}, `그 뽑기의 ${topName} 확률`), h('th', {}, '그때까지 1번 이상 나올 확률'))),
      h('tbody', {}, ...pity.map(r => h('tr', {}, h('td.left', {}, r.from === r.to ? `${r.from}번째` : `${r.from}~${r.to}번째`), h('td', {}, pct(r.prob)), h('td', {}, pct(r.cum))))),
    )) : null,
    h('h3.disc-h', {}, `${pity ? '④' : '③'} 실효 확률 (천장·보장 포함, 소환 Lv${state.discLevel + 1} 기준)`),
    h('dl.pct-list.disc-eff', {},
      h('div', {}, h('dt', {}, `${topName} 기본 확률`), h('dd', {}, pct(eff.base))),
      h('div', {}, h('dt', {}, `${topName} 실효 확률`), h('dd', {}, Number.isFinite(eff.meanPerTop) ? `${pct(eff.topRate)} (평균 ${eff.meanPerTop.toFixed(1)}회에 1장)` : '—')),
      eff.featuredRate != null ? h('div', {}, h('dt', {}, '픽업 캐릭터 실효 확률'), h('dd', {}, pct(eff.featuredRate))) : null,
      h('div', {}, h('dt', {}, `${eff.featuredRate != null ? '픽업이 아닌 ' : ''}${topName} 1종 실효 확률`), h('dd', {}, pct(eff.otherRate))),
    ),
    h('h3.disc-h', {}, '확률이 바뀌는 조건'),
    d.notes.length ? h('ul.disc-notes', {}, ...d.notes.map(t => h('li', {}, t))) : h('p.muted.small', {}, '확률이 바뀌는 조건이 없습니다 (고정 확률).'),
  ].filter(Boolean));
}

function exportDisclosureCSV(d) {
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const digits = Math.max(state.discDigits ?? 4, 6); // CSV는 최소 소수 6자리
  const pct = (p) => (p * 100).toFixed(digits);
  const lines = [['구분', '소환 레벨', '시작 누적 뽑기', '등급', '캐릭터', '픽업', '확률(%)'].map(esc).join(',')];
  for (const l of d.levels) for (const g of l.grades) {
    lines.push([esc('등급'), l.level, l.from, esc(g.name), '', '', pct(g.prob)].join(','));
    for (const u of g.units) lines.push([esc('캐릭터'), l.level, l.from, esc(g.name), esc(u.name), u.featured ? 'Y' : '', pct(u.prob)].join(','));
  }
  if (d.pity) {
    lines.push('', ['천장 확률 변동', '소환 레벨', '뽑기(이후 n번째)', '', '', '', '확률(%)', '누적(%)'].map(esc).join(','));
    d.pity.forEach((rows, li) => rows.forEach(r => lines.push([esc('천장'), li + 1, esc(r.from === r.to ? r.from : `${r.from}~${r.to}`), '', '', '', pct(r.prob), pct(r.cum)].join(','))));
  }
  lines.push('', esc('확률이 바뀌는 조건'), ...d.notes.map(esc));
  downloadText(`확률공시-${state.template}.csv`, '\ufeff' + lines.join('\r\n'), 'text/csv');
  toast('공시표 CSV를 저장했습니다');
}

// ── 공유·내보내기 ───────────────────────────────────────
async function copyShareLink() {
  const url = `${location.origin}${location.pathname}#gacha?s=${encodeState(state)}`;
  try { await navigator.clipboard.writeText(url); toast('공유 링크를 복사했습니다'); }
  catch { prompt('아래 링크를 복사하세요', url); }
}

async function importJSON() {
  try {
    const st = hydrate(await pickJSON());
    if (!st) { toast('가챠·수집 설계 파일이 아닙니다'); return; }
    state = st; rebuild(); toast('불러왔습니다');
  } catch { toast('파일을 읽지 못했습니다'); }
}

function exportCSV() {
  if (!last) { toast('먼저 오류를 고쳐 주세요'); return; }
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const unit = hasWon() ? '원' : state.gemName;
  const lines = [['목표', '종류', '등급', '종 수', '장수', '기대 뽑기', '단순 계산', '중복 없을 때', `기대 비용(${unit})`, `50%(${unit})`, `90%(${unit})`, `99%(${unit})`, '무과금 일', '과금 유저 일', '계산'].map(esc).join(',')];
  for (const r of last.goals) {
    lines.push([esc(r.goal.name), esc(GOAL_TYPES[r.goal.type]), esc(state.grades[r.spec.g].name), r.spec.K, r.spec.k,
      r.mean.toFixed(1), r.naive.toFixed(1), r.noDup != null ? r.noDup.toFixed(1) : '',
      Math.round(pullsToMoney(r.mean)), Math.round(pullsToMoney(r.pct.p50)), Math.round(pullsToMoney(r.pct.p90)), Math.round(pullsToMoney(r.pct.p99)),
      Math.ceil(r.daysFree), Math.ceil(r.daysPaid), esc(r.exactMean != null ? '정확해' : '시뮬레이션')].join(','));
  }
  downloadText(`gacha-${state.template}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}
