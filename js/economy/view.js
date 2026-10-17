// 재화 흐름 시뮬레이터 v2 — 화면: 성장 루프(콘텐츠 → 재화 → 성장 → 전투력 → 콘텐츠)
import { simulate, toMermaid, applyGrowthTable } from './model.js';
import { TEMPLATES } from './presets.js';
import { renderSvg, renderOffscreen, isDark } from '../lib/mermaid.js';
import { createDeck, renderSpecs, collectSvgShapes, fitShapes, FONT } from '../lib/pptx.js';
import { h, store, encodeState, decodeState, toast, debounce, fmtMoney, fmtNum } from '../lib/util.js';

const SCHEMA = 2;
const STORE_KEY = 'economy:v2';
const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4'];

let state, els = {}, charts = {}, last, timer;
const save = debounce(() => store.set(STORE_KEY, state), 300);
const schedule = (ms = 200) => { clearTimeout(timer); timer = setTimeout(recompute, ms); };
const newId = () => 'x' + Date.now().toString(36) + Math.floor(Math.random() * 1e3);

function defaultState(id) { return { v: SCHEMA, template: id, view: { currency: null, segment: 0 }, ...TEMPLATES[id].make() }; }
function hydrate(o) { return o && o.v === SCHEMA && TEMPLATES[o.template] ? { ...defaultState(o.template), ...o } : null; }
function readHash() { const m = location.hash.match(/^#economy\?s=([\w-]+)/); return m ? hydrate(decodeState(m[1])) : null; }
const curName = (id) => state.currencies.find(c => c.id === id)?.name ?? id;

/**
 * 성장 재화 수급 설계에서 보낸 필요량 표 적용. 이 탭이 열려 있으면 화면 상태에, 아니면 저장된 상태에 넣는다
 * (다음에 탭을 열 때 저장된 상태를 읽으므로 즉시 저장).
 */
export function importGrowthTable(payload) {
  const target = state ?? (hydrate(store.get(STORE_KEY)) || defaultState('mobile'));
  const r = applyGrowthTable(target, payload);
  store.set(STORE_KEY, target);
  if (state && els.tables) rebuild();
  return r;
}

export function mount(root) {
  state = readHash() || hydrate(store.get(STORE_KEY)) || defaultState('mobile');
  if (location.hash.startsWith('#economy?')) history.replaceState(null, '', '#economy');
  build(root);
  rebuild();
  document.addEventListener('themechange', () => { if (last) { drawCharts(last); drawFlow(); } });
  window.addEventListener('hashchange', () => { const st = readHash(); if (st) { state = st; history.replaceState(null, '', '#economy'); rebuild(); } });
}

// ── 골격 ────────────────────────────────────────────────
function build(root) {
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '재화 흐름 시뮬레이터'),
        h('p', {}, 'RPG의 성장 루프를 일 단위로 돌립니다. 콘텐츠가 재화를 만들고, 재화로 성장하면 전투력이 올라 보상이 늘고 상위 콘텐츠가 열립니다. 유저 세그먼트는 플레이 시간·접속 횟수·과금액 같은 측정 가능한 기준으로 정의합니다.'),
      ),
      h('div.tool-actions', {}, h('button.btn', { type: 'button', onclick: copyShareLink }, '공유 링크')),
    ),
    h('div.layout', {},
      els.settings = h('aside.settings.card', { 'aria-label': '설정' }),
      h('div.results', {},
        els.errors = h('ul.errors', { hidden: true }),
        els.kpis = h('div.kpis.econ-kpis'),
        h('div.card', {},
          h('div.card-head', {}, h('h2', {}, '성장 곡선 (전투력)'), h('span.hint', {}, '세그먼트별 · 루프가 얼마나 빨리 도는지')),
          h('div.chart-box.tall', {}, els.powerCanvas = h('canvas', { role: 'img', 'aria-label': '세그먼트별 전투력 추이' })),
        ),
        h('div.card', {},
          h('div.card-head', {}, h('h2', {}, '재화 보유량'), h('div.chart-ctrl', {}, h('span.muted.small', {}, '재화'), els.curSel = h('select', { onchange: (e) => { state.view.currency = e.target.value; save(); last && drawCharts(last); } }))),
          h('div.chart-box.tall', {}, els.holdCanvas = h('canvas', { role: 'img', 'aria-label': '세그먼트별 재화 보유량 추이' })),
        ),
        els.warnCard = h('div.card'),
        h('div.card', {},
          h('div.card-head', {}, h('h2', {}, '흐름 분해 (하루 평균)'), h('div.chart-ctrl', {}, h('span.muted.small', {}, '세그먼트'), els.segSel = h('select', { onchange: (e) => { state.view.segment = +e.target.value; save(); last && renderFlowTable(last); } }))),
          els.flowTable = h('div.flow-tables', {}),
        ),
        h('div.card', {},
          h('div.card-head', {}, h('h2', {}, '성장 루프'), h('div.tool-actions', {}, els.flowPpt = h('button.btn.small', { type: 'button', onclick: exportFlowPpt }, 'PPT 도형으로 저장'))),
          els.flow = h('div.diagram-preview', {}),
        ),
        els.tables = h('div.econ-tables'),
      ),
    ),
  );
}

const field = (label, input, hint) => h('label.field', {}, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
function numIn(obj, key, opts = {}) {
  return h('input', { type: 'number', value: obj[key], step: opts.step ?? 'any', min: opts.min, 'aria-label': opts.label,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { obj[key] = opts.int ? Math.round(v) : v; schedule(); } } });
}

function renderSettings() {
  const st = state.stamina, paid = state.paid;
  els.settings.replaceChildren(
    field('템플릿', h('select', { onchange: (e) => { state = defaultState(e.target.value); rebuild(); } },
      ...Object.entries(TEMPLATES).map(([id, t]) => h('option', { value: id, selected: id === state.template }, t.label)))),
    h('p.preset-note', {}, TEMPLATES[state.template].note),
    h('div.row2', {}, field('기간 (일)', numIn(state, 'days', { int: true, min: 1 })), field('초기 전투력', numIn(state, 'basePower', { min: 0 }))),
    h('div.option', {},
      h('span.group-title', {}, '과금'),
      h('div.row2', {},
        field('유료 재화', h('select', { onchange: (e) => { paid.currency = e.target.value; schedule(0); } },
          h('option', { value: '', selected: !paid.currency }, '없음'), ...state.currencies.map(c => h('option', { value: c.id, selected: c.id === paid.currency }, c.name)))),
        field('1개당 원', numIn(paid, 'priceWon', { min: 0 }))),
      h('p.desc', {}, '세그먼트의 월 과금액 ÷ 30 ÷ 단가만큼 매일 유료 재화를 얻습니다.'),
    ),
    h('div.option', {},
      h('label.switch', {}, '스태미나(행동력)', h('input', { type: 'checkbox', checked: st.enabled, onchange: (e) => { st.enabled = e.target.checked; rebuild(); } })),
      st.enabled ? h('div', { style: 'display:grid;gap:10px' },
        h('div.row2', {}, field('하루 회복량', numIn(st, 'regenPerDay', { min: 0 })), field('최대치', numIn(st, 'cap', { min: 1 }))),
        h('div.row2', {}, field('충전 비용 (유료 재화)', numIn(st, 'refillCost', { min: 0 })), field('충전량', numIn(st, 'refillAmount', { min: 0 }))),
        h('p.desc', {}, '실제 회복량 = min(하루 회복량, 최대치 × 접속 횟수). 접속이 드물면 최대치에 막혀 회복분을 버립니다.'),
      ) : h('p.desc', {}, '켜면 던전 같은 콘텐츠가 스태미나를 소모하고, 과금으로 충전할 수 있습니다.'),
    ),
    h('div.option', {},
      h('span.group-title', {}, '경고 기준'),
      h('div.row3', {}, field('웜업 (일)', numIn(state, 'warmup', { int: true, min: 0 })), field('소모율 < %', numIn(state, 'sinkRatioWarn', { min: 0 })), field('격차 ≥ 배', numIn(state, 'gapWarn', { min: 1, step: 0.5 }))),
    ),
  );
}

// ── 편집 표 (공용, 'reward.gold'처럼 중첩 키 지원) ──────
const getK = (o, k) => k.split('.').reduce((a, p) => a?.[p], o);
function setK(o, k, v) { const ps = k.split('.'); let t = o; ps.slice(0, -1).forEach(p => { t = t[p] ??= {}; }); t[ps.at(-1)] = v; }

function editTable(title, hint, rows, cols, makeRow) {
  const cell = (row, c) => {
    const v = getK(row, c.key);
    if (c.type === 'text') return h('input.name', { type: 'text', value: v ?? '', style: c.width ? `width:${c.width}px` : null, oninput: (e) => { setK(row, c.key, e.target.value); schedule(400); } });
    if (c.type === 'select') return h('select.cell-select', { onchange: (e) => { setK(row, c.key, e.target.value); schedule(0); } }, ...c.options.map(([ov, l]) => h('option', { value: ov, selected: ov === v }, l)));
    return h('input', { type: 'number', value: v ?? 0, step: 'any', style: c.width ? `width:${c.width}px` : null, oninput: (e) => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) { setK(row, c.key, n); schedule(); } } });
  };
  return h('div.card', {},
    h('div.card-head', {}, h('h2', {}, title), h('span.hint', {}, hint)),
    h('div.table-wrap', {}, h('table.stages.econ-table', {},
      h('thead', {}, h('tr', {}, ...cols.map((c, i) => h(i === 0 ? 'th.left' : 'th', { title: c.tip || null }, c.label)), h('th', {}, ''))),
      h('tbody', {}, ...rows.map((row, i) => h('tr', {},
        ...cols.map((c, j) => h(j === 0 ? 'td.left' : 'td', {}, cell(row, c))),
        h('td', {}, h('div.row-actions', {},
          h('button.icon-x', { type: 'button', title: '위로 (우선순위)', disabled: i === 0, onclick: () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; rebuildTables(); schedule(0); } }, '↑'),
          h('button.icon-x', { type: 'button', title: '삭제', onclick: () => { rows.splice(i, 1); rebuildTables(); schedule(0); } }, '×'))),
      ))),
    )),
    h('div.table-foot', {}, h('span'), h('button.btn.small', { type: 'button', onclick: () => { rows.push(makeRow()); rebuildTables(); schedule(0); } }, '+ 추가')),
  );
}

function rebuildTables() {
  const curCols = (prefix, label) => state.currencies.map(c => ({ key: `${prefix}.${c.id}`, label: `${label} ${c.name}`, type: 'num', width: 90 }));
  const firstCur = () => state.currencies[0]?.id ?? '';
  els.tables.replaceChildren(
    editTable('유저 세그먼트', '측정 가능한 행동 기준으로 정의 · 비율 합 100%', state.segments,
      [{ key: 'name', label: '이름', type: 'text', width: 90 }, { key: 'share', label: '비율 %', type: 'num', width: 60 },
        { key: 'minutes', label: '플레이 (분/일)', type: 'num', width: 70, tip: '하루 동안 콘텐츠에 쓰는 시간' },
        { key: 'logins', label: '접속 (회/일)', type: 'num', width: 60, tip: '스태미나 실제 회복량에 영향' },
        { key: 'spendWon', label: '월 과금 (원)', type: 'num', width: 90 },
        { key: 'refills', label: '충전 (회/일)', type: 'num', width: 60, tip: '유료 재화로 스태미나를 충전하는 횟수' }],
      () => ({ id: newId(), name: '새 세그먼트', share: 0, minutes: 60, logins: 3, spendWon: 0, refills: 0 })),
    editTable('생산 · 콘텐츠', '위에서부터 우선순위 · 횟수 0 = 무제한(남은 시간·스태미나로 반복) · 성장 보너스 = 전투력 100당 보상 증가 %', state.contents,
      [{ key: 'name', label: '이름', type: 'text', width: 120 }, { key: 'minutes', label: '분/회', type: 'num', width: 55 }, { key: 'stamina', label: '스태미나/회', type: 'num', width: 60 },
        { key: 'limit', label: '횟수', type: 'num', width: 50 }, { key: 'period', label: '주기', type: 'select', options: [['day', '매일'], ['week', '매주']] },
        { key: 'unlock', label: '해금 전투력', type: 'num', width: 70 }, { key: 'powerBonus', label: '성장 보너스 %', type: 'num', width: 60 },
        ...curCols('reward', '보상')],
      () => ({ id: newId(), name: '새 콘텐츠', minutes: 5, stamina: 0, limit: 1, period: 'day', unlock: 0, powerBonus: 0, reward: { [firstCur()]: 1000 } })),
    editTable('소비 · 성장', '위에서부터 우선순위 · 비용(레벨 L) = 기본 비용 × 증가율^L', state.growth,
      [{ key: 'name', label: '이름', type: 'text', width: 110 }, { key: 'max', label: '최대 Lv', type: 'num', width: 55 }, { key: 'rate', label: '증가율', type: 'num', width: 60 },
        { key: 'power', label: '전투력/Lv', type: 'num', width: 60 }, ...curCols('cost', '비용')],
      () => ({ id: newId(), name: '새 성장', max: 20, start: 0, rate: 1.1, power: 10, cost: { [firstCur()]: 1000 } })),
    ...[tableNote()].filter(Boolean),
    editTable('재화', '시작 보유량', state.currencies,
      [{ key: 'name', label: '이름', type: 'text', width: 110 }, { key: 'start', label: '시작 보유량', type: 'num', width: 110 }],
      () => ({ id: newId(), name: '새 재화', start: 0 })),
    editTable('상점 · 교환', '보유량 ≥ 기준이면 “양”만큼 내고 양 × 비율을 받음, 하루 최대 n회', state.exchanges,
      [{ key: 'name', label: '이름', type: 'text', width: 140 },
        { key: 'from', label: '내는 재화', type: 'select', options: state.currencies.map(c => [c.id, c.name]) },
        { key: 'to', label: '받는 재화', type: 'select', options: state.currencies.map(c => [c.id, c.name]) },
        { key: 'amount', label: '양', type: 'num', width: 80 }, { key: 'rate', label: '비율', type: 'num', width: 90 },
        { key: 'threshold', label: '기준 보유량', type: 'num', width: 100 }, { key: 'maxPerDay', label: '하루 최대', type: 'num', width: 55 }],
      () => ({ id: newId(), name: '새 교환', from: firstCur(), to: state.currencies[1]?.id ?? firstCur(), amount: 100, rate: 1, threshold: 100, maxPerDay: 1 })),
  );
}

function tableNote() {
  const items = state.growth.filter(g => g.table && Object.keys(g.table).length);
  if (!items.length) return null;
  return h('div.card.table-note', {},
    h('div.card-head', {}, h('h2', {}, '필요량 표를 쓰는 성장 항목'), h('span.hint', {}, '성장 재화 수급 설계에서 보낸 레벨별 표 — 이 재화는 위 표의 기본 비용·증가율 대신 레벨별 값을 씁니다')),
    h('ul.note-list', {}, ...items.flatMap(g => Object.entries(g.table).map(([cid, t]) => h('li', {},
      h('b', {}, g.name), ` · ${curName(cid)} ${t.length}레벨 (Lv1 ${t[0]?.toLocaleString('ko-KR')} → 마지막 ${t.at(-1)?.toLocaleString('ko-KR')})`,
      h('button.btn.small', { type: 'button', onclick: () => { delete g.table[cid]; if (!Object.keys(g.table).length) { delete g.table; delete g.tableStart; } rebuild(); } }, '표 해제'),
    )))),
  );
}

function rebuild() { renderSettings(); rebuildTables(); recompute(); }

// ── 계산·표시 ───────────────────────────────────────────
function recompute() {
  save();
  const res = simulate(state);
  if (!res.ok) { els.errors.replaceChildren(...res.errors.slice(0, 8).map(e => h('li', {}, e))); els.errors.hidden = false; return; }
  els.errors.hidden = true;
  last = res;
  if (!state.currencies.some(c => c.id === state.view.currency)) state.view.currency = state.currencies[0].id;
  if (!(state.view.segment < state.segments.length)) state.view.segment = 0;
  els.curSel.replaceChildren(...state.currencies.map(c => h('option', { value: c.id, selected: c.id === state.view.currency }, c.name)));
  els.segSel.replaceChildren(...state.segments.map((s, i) => h('option', { value: i, selected: i === state.view.segment }, s.name)));
  renderKPIs(res);
  drawCharts(res);
  renderWarnings(res);
  renderFlowTable(res);
  drawFlow();
}

function renderKPIs(res) {
  const D = res.days;
  els.kpis.replaceChildren(...res.bySeg.map((r, i) => {
    const seg = r.segment;
    const top = Object.entries(r.bottleneck).sort((a, b) => b[1] - a[1])[0];
    const lv = state.growth.map(g => `${g.name} ${r.finalLevels[g.id]}/${g.max}`).join(' · ');
    return h('div.card.kpi.seg-kpi', { style: `--seg:var(${SERIES[i % SERIES.length]})` },
      h('div.kpi-label', {}, h('i.seg-dot'), `${seg.name} (${seg.share}%) · ${D}일차 전투력`),
      h('div.kpi-value', {}, fmtNum(r.finalPower, 0)),
      h('div.kpi-sub', {}, `플레이 ${seg.minutes}분·접속 ${seg.logins}회·월 ${fmtMoney(seg.spendWon)}원`),
      h('div.kpi-sub', {}, lv),
      h('div.kpi-sub', {}, top ? h('span', {}, '병목 ', h('b', {}, curName(top[0])), ` (${top[1]}일)`) : '병목 없음',
        state.stamina.enabled ? ` · 스태미나 손실 ${fmtNum(r.staminaWastedPerDay, 0)}/일` : ''),
    );
  }));
}

function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

function lineChart(key, canvas, res, pick, yFmt) {
  if (typeof Chart === 'undefined') return;
  const grid = cssVar('--grid'), text = cssVar('--text-3');
  const labels = Array.from({ length: res.days + 1 }, (_, d) => d);
  charts[key]?.destroy();
  charts[key] = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: res.bySeg.map((r, i) => { const c = cssVar(SERIES[i % SERIES.length]); return { label: `${r.segment.name} (${r.segment.share}%)`, data: pick(r), borderColor: c, backgroundColor: c, borderWidth: 2, pointRadius: 0, tension: 0.15 }; }) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { color: text, maxTicksLimit: 10, callback: (v) => `${v}일` }, border: { color: grid } },
        y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: text, maxTicksLimit: 6, callback: yFmt } },
      },
      plugins: {
        legend: { labels: { color: text, usePointStyle: true, pointStyle: 'line' } },
        tooltip: { callbacks: { title: (items) => `${items[0].label}일차`, label: (item) => `${item.dataset.label}: ${yFmt(item.raw)}` } },
      },
    },
  });
}

function drawCharts(res) {
  lineChart('power', els.powerCanvas, res, (r) => r.series.power, (v) => fmtNum(v, 0));
  lineChart('hold', els.holdCanvas, res, (r) => r.series.hold[state.view.currency], (v) => fmtMoney(v));
}

function renderWarnings(res) {
  const LV = { serious: '정체', warn: '주의', info: '참고' };
  els.warnCard.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '검증 결과'), h('span.hint', {}, `웜업 ${state.warmup}일 이후 기준`)),
    res.warnings.length
      ? h('ul.findings', {}, ...res.warnings.map(w => h(`li.${w.level === 'serious' ? 'serious' : w.level}`, {}, h('span.lv', {}, LV[w.level]), h('span', {}, w.text))))
      : h('p.muted', {}, '경고 없음 — 모든 재화가 쓰이고 성장이 꾸준히 이어집니다.'),
  );
}

/** 선택한 세그먼트의 하루 평균 생산·소비: 어디서 들어와 어디로 나가는지 */
function renderFlowTable(res) {
  const r = res.bySeg[state.view.segment];
  const D = res.days;
  const label = (key) => {
    const [kind, id] = key.split(':');
    if (kind === 'content') return state.contents.find(c => c.id === id)?.name ?? id;
    if (kind === 'growth') return state.growth.find(g => g.id === id)?.name ?? id;
    if (kind === 'shop') return state.exchanges.find(x => x.id === id)?.name ?? id;
    return id; // paid:구매, refill:스태미나 충전
  };
  const table = (dir, title) => {
    const rows = Object.entries(r.flow[dir]).map(([k, v]) => { const [src, cur] = k.split('|'); return { src: label(src), cur, v: v / D }; })
      .sort((a, b) => a.cur.localeCompare(b.cur) || b.v - a.v);
    const total = Object.fromEntries(state.currencies.map(c => [c.id, rows.filter(x => x.cur === c.id).reduce((a, x) => a + x.v, 0)]));
    return h('div', {}, h('span.group-title', {}, title),
      h('table.mini', {},
        h('thead', {}, h('tr', {}, h('th.left', {}, dir === 'in' ? '생산처' : '소비처'), h('th.left', {}, '재화'), h('th', {}, '하루 평균'), h('th', {}, '비중'))),
        h('tbody', {}, ...rows.map(x => h('tr', {}, h('td.left', {}, x.src), h('td.left', {}, curName(x.cur)), h('td', {}, fmtMoney(x.v)), h('td', {}, total[x.cur] ? `${((x.v / total[x.cur]) * 100).toFixed(0)}%` : '—'))))));
  };
  const ratio = state.currencies.map(c => `${c.name} ${r.inflow[c.id] > 0 ? ((r.outflow[c.id] / r.inflow[c.id]) * 100).toFixed(0) : '—'}%`).join(' · ');
  const runs = state.contents.map(c => `${c.name} ${fmtNum((r.runs[c.id] || 0) / D, 1)}회`).join(' · ');
  els.flowTable.replaceChildren(
    h('p.muted.small', {}, `소모율(소비 ÷ 생산): ${ratio}`),
    h('p.muted.small', {}, `콘텐츠 하루 평균 횟수: ${runs}`),
    h('div.two-col', {}, table('in', '생산 (재화가 들어오는 곳)'), table('out', '소비 (재화가 나가는 곳)')),
  );
}

async function drawFlow() {
  try {
    const { svg, latest } = await renderSvg(toMermaid(state), isDark());
    if (latest()) els.flow.innerHTML = svg; // Mermaid(strict)가 정화한 SVG
  } catch (e) { els.flow.replaceChildren(h('p.muted', {}, `루프 다이어그램을 그리지 못했습니다: ${e.message}`)); }
}

async function exportFlowPpt() {
  const btn = els.flowPpt, label = btn.textContent;
  btn.disabled = true; btn.textContent = '만드는 중…';
  try {
    const { svg, host } = await renderOffscreen(toMermaid(state));
    const specs = fitShapes(collectSvgShapes(svg), { x: 0.45, y: 1.15, w: 12.4, h: 5.95 });
    host.remove();
    drawFlow();
    const pptx = await createDeck('성장 루프');
    const slide = pptx.addSlide();
    slide.addText(`성장 루프 — ${TEMPLATES[state.template].label}`, { x: 0.45, y: 0.3, w: 12.4, h: 0.6, fontFace: FONT, fontSize: 22, bold: true, color: '1B1B1A', margin: 0 });
    renderSpecs(pptx, slide, specs);
    await pptx.writeFile({ fileName: '성장 루프.pptx' });
    toast('PowerPoint 파일을 저장했습니다');
  } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = label; }
}

async function copyShareLink() {
  const url = `${location.origin}${location.pathname}#economy?s=${encodeState(state)}`;
  try { await navigator.clipboard.writeText(url); toast('공유 링크를 복사했습니다'); } catch { prompt('아래 링크를 복사하세요', url); }
}

