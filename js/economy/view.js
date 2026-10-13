// 재화 흐름 시뮬레이터 — 화면 (초안)
import { simulate, toMermaid } from './model.js';
import { TEMPLATES } from './presets.js';
import { renderSvg, renderOffscreen, isDark } from '../lib/mermaid.js';
import { createDeck, renderSpecs, collectSvgShapes, fitShapes, FONT } from '../lib/pptx.js';
import { h, store, encodeState, decodeState, toast, debounce, fmtMoney } from '../lib/util.js';

const SCHEMA = 1;
const STORE_KEY = 'economy:v1';
const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4'];

let state, els = {}, chart, last, timer;
const save = debounce(() => store.set(STORE_KEY, state), 300);
const schedule = (ms = 200) => { clearTimeout(timer); timer = setTimeout(recompute, ms); };
const newId = () => 'x' + Date.now().toString(36) + Math.floor(Math.random() * 1e3);

function defaultState(id) { return { v: SCHEMA, template: id, view: { currency: null }, ...TEMPLATES[id].make() }; }
function hydrate(o) { return o && o.v === SCHEMA && TEMPLATES[o.template] ? { ...defaultState(o.template), ...o } : null; }
function readHash() { const m = location.hash.match(/^#economy\?s=([\w-]+)/); return m ? hydrate(decodeState(m[1])) : null; }
const cfg = () => state;
const num = (n) => fmtMoney(n);

export function mount(root) {
  state = readHash() || hydrate(store.get(STORE_KEY)) || defaultState('rpg');
  if (location.hash.startsWith('#economy?')) history.replaceState(null, '', '#economy');
  build(root);
  rebuild();
  document.addEventListener('themechange', () => { if (last) { drawChart(last); drawFlow(); } });
  window.addEventListener('hashchange', () => { const st = readHash(); if (st) { state = st; history.replaceState(null, '', '#economy'); rebuild(); } });
}

// ── 골격 ────────────────────────────────────────────────
function build(root) {
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '재화 흐름 시뮬레이터'),
        h('p', {}, '재화의 획득처·소모처·교환 규칙과 유저 유형을 넣으면 일 단위로 보유량을 누적해, 이벤트나 소모처 변경이 N일 뒤 재화 적체에 어떤 영향을 주는지 보여줍니다. 유저의 소비 행동은 “보유량이 X 이상이면 Y씩 최대 n회”처럼 규칙으로 정합니다.'),
      ),
      h('div.tool-actions', {},
        h('button.btn', { type: 'button', onclick: copyShareLink }, '공유 링크'),
      ),
    ),
    h('div.layout', {},
      els.settings = h('aside.settings.card', { 'aria-label': '설정' }),
      h('div.results', {},
        els.errors = h('ul.errors', { hidden: true }),
        els.kpis = h('div.kpis.econ-kpis'),
        h('div.card', {},
          h('div.card-head', {}, h('h2', {}, '보유량 추이'), h('div.chart-ctrl', {}, h('span.muted.small', {}, '재화'), els.curSel = h('select', { onchange: (e) => { state.view.currency = e.target.value; save(); last && drawChart(last); } }))),
          h('div.chart-box.tall', {}, els.canvas = h('canvas', { role: 'img', 'aria-label': '유저 유형별 보유량 추이' })),
          els.chartNote = h('p.muted.small', {}),
        ),
        els.warnCard = h('div.card'),
        h('div.card', {},
          h('div.card-head', {}, h('h2', {}, '재화 흐름도'), h('div.tool-actions', {},
            els.flowPpt = h('button.btn.small', { type: 'button', onclick: exportFlowPpt }, 'PPT 도형으로 저장'))),
          els.flow = h('div.diagram-preview', {}),
        ),
        els.tables = h('div', { style: 'display:grid;gap:20px' }),
      ),
    ),
  );
}

function field(label, input) { return h('label.field', {}, h('span', {}, label), input); }
function numIn(obj, key, opts = {}) {
  return h('input', { type: 'number', value: obj[key], step: opts.step ?? 'any', min: opts.min, 'aria-label': opts.label,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { obj[key] = opts.int ? Math.round(v) : v; schedule(); } } });
}

function renderSettings() {
  const v = state.variance;
  els.settings.replaceChildren(
    field('템플릿', h('select', { onchange: (e) => { state = defaultState(e.target.value); rebuild(); } },
      ...Object.entries(TEMPLATES).map(([id, t]) => h('option', { value: id, selected: id === state.template }, t.label)))),
    h('p.preset-note', {}, TEMPLATES[state.template].note),
    h('div.row2', {}, field('기간 (일)', numIn(state, 'days', { int: true, min: 1 })), field('웜업 (일)', numIn(state, 'warmup', { int: true, min: 0 }))),
    field('적체 경고: 소모율 < (%)', numIn(state, 'sinkRatioWarn', { min: 0 })),
    h('p.desc', {}, '소모율 = 누적 소모 ÷ 누적 획득. 보유량이 0에서 시작하는 초반 웜업 기간은 경고 판단에서 뺍니다.'),
    h('div.option', {},
      h('label.switch', {}, '편차 반영 (반복 시뮬레이션)', h('input', { type: 'checkbox', checked: v.on, onchange: (e) => { v.on = e.target.checked; rebuild(); } })),
      v.on ? h('div.row3', {}, field('반복 수', numIn(v, 'runs', { int: true, min: 10 })), field('유저 편차 σ', numIn(v, 'userSigma', { step: 0.05, min: 0 })), field('일별 편차 σ', numIn(v, 'daySigma', { step: 0.05, min: 0 }))) : null,
      h('p.desc', {}, '유저마다 고정된 활동량 배수(로그정규, 평균 1)와 날마다 작은 변동을 함께 줍니다. 그래프의 띠는 상하위 10% 범위입니다.'),
    ),
  );
}

// ── 편집 표 (공용) ──────────────────────────────────────
/**
 * cols: [{key, label, type:'text'|'num'|'select'|'check', options?:()=>[[v,l]], width?}]
 */
function editTable(title, hint, rows, cols, makeRow) {
  const curOpts = () => state.currencies.map(c => [c.id, c.name]);
  const cell = (row, c) => {
    if (c.type === 'text') return h('input.name', { type: 'text', value: row[c.key], style: c.width ? `width:${c.width}px` : null, oninput: (e) => { row[c.key] = e.target.value; schedule(400); } });
    if (c.type === 'check') return h('input', { type: 'checkbox', checked: !!row[c.key], onchange: (e) => { row[c.key] = e.target.checked; schedule(0); } });
    if (c.type === 'select' || c.type === 'currency') {
      const opts = c.type === 'currency' ? curOpts() : c.options;
      return h('select.cell-select', { onchange: (e) => { row[c.key] = e.target.value; schedule(0); } }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === row[c.key] }, l)));
    }
    return h('input', { type: 'number', value: row[c.key], step: 'any', style: c.width ? `width:${c.width}px` : null, oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { row[c.key] = v; schedule(); } } });
  };
  return h('div.card', {},
    h('div.card-head', {}, h('h2', {}, title), h('span.hint', {}, hint)),
    h('div.table-wrap', {}, h('table.stages.econ-table', {},
      h('thead', {}, h('tr', {}, ...cols.map((c, i) => h(i === 0 ? 'th.left' : 'th', {}, c.label)), h('th', {}, ''))),
      h('tbody', {}, ...rows.map((row, i) => h('tr', {},
        ...cols.map((c, j) => h(j === 0 ? 'td.left' : 'td', {}, cell(row, c))),
        h('td', {}, h('button.icon-x', { type: 'button', title: '삭제', onclick: () => { rows.splice(i, 1); rebuildTables(); schedule(0); } }, '×')),
      ))),
    )),
    h('div.table-foot', {}, h('span'), h('button.btn.small', { type: 'button', onclick: () => { rows.push(makeRow()); rebuildTables(); schedule(0); } }, '+ 추가')),
  );
}

function rebuildTables() {
  const firstCur = () => state.currencies[0]?.id ?? '';
  els.tables.replaceChildren(
    editTable('재화', '시작 보유량', state.currencies,
      [{ key: 'name', label: '이름', type: 'text', width: 120 }, { key: 'start', label: '시작 보유량', type: 'num', width: 110 }],
      () => ({ id: newId(), name: '새 재화', start: 0 })),
    editTable('획득처', '시작·종료일 0 = 상시 · 활동량 = 유저 유형 배수 적용', state.faucets,
      [{ key: 'name', label: '이름', type: 'text', width: 130 }, { key: 'currency', label: '재화', type: 'currency' }, { key: 'amount', label: '양', type: 'num', width: 100 },
        { key: 'period', label: '주기', type: 'select', options: [['day', '매일'], ['week', '매주']] }, { key: 'activity', label: '활동량', type: 'check' },
        { key: 'from', label: '시작일', type: 'num', width: 60 }, { key: 'to', label: '종료일', type: 'num', width: 60 }],
      () => ({ id: newId(), name: '새 획득처', currency: firstCur(), amount: 1000, period: 'day', activity: true, from: 0, to: 0 })),
    editTable('교환', '보유량 ≥ 기준이면 “양”만큼 내고 양 × 비율을 받음, 하루 최대 n회', state.exchanges,
      [{ key: 'name', label: '이름', type: 'text', width: 130 }, { key: 'from', label: '내는 재화', type: 'currency' }, { key: 'to', label: '받는 재화', type: 'currency' },
        { key: 'amount', label: '양', type: 'num', width: 90 }, { key: 'rate', label: '비율', type: 'num', width: 90 }, { key: 'threshold', label: '기준 보유량', type: 'num', width: 100 }, { key: 'maxPerDay', label: '하루 최대', type: 'num', width: 60 }],
      () => ({ id: newId(), name: '새 교환', from: firstCur(), to: state.currencies[1]?.id ?? firstCur(), amount: 100, rate: 1, threshold: 100, maxPerDay: 1 })),
    editTable('소모처', '고정 = 매일 양 · 비율 = 보유량의 % · 소비 규칙 = 보유량 ≥ 기준이면 양씩 하루 최대 n회', state.sinks,
      [{ key: 'name', label: '이름', type: 'text', width: 130 }, { key: 'currency', label: '재화', type: 'currency' },
        { key: 'type', label: '종류', type: 'select', options: [['rule', '소비 규칙'], ['fixed', '고정'], ['ratio', '비율']] },
        { key: 'amount', label: '양', type: 'num', width: 90 }, { key: 'ratio', label: '비율 %', type: 'num', width: 60 }, { key: 'threshold', label: '기준 보유량', type: 'num', width: 100 },
        { key: 'maxPerDay', label: '하루 최대', type: 'num', width: 60 }, { key: 'activity', label: '활동량', type: 'check' }],
      () => ({ id: newId(), name: '새 소모처', currency: firstCur(), type: 'rule', amount: 1000, ratio: 0, threshold: 1000, maxPerDay: 1, activity: true })),
    editTable('유저 유형', '비율 합 100% · 활동량 배수는 “활동량” 표시된 획득·소모에 곱해짐', state.users,
      [{ key: 'name', label: '이름', type: 'text', width: 120 }, { key: 'share', label: '비율 %', type: 'num', width: 70 }, { key: 'activity', label: '활동량 배수', type: 'num', width: 80 }],
      () => ({ id: newId(), name: '새 유형', share: 0, activity: 1 })),
  );
}

function rebuild() { renderSettings(); rebuildTables(); recompute(); }

// ── 계산·표시 ───────────────────────────────────────────
function recompute() {
  save();
  const res = simulate(cfg());
  if (!res.ok) {
    els.errors.replaceChildren(...res.errors.slice(0, 8).map(e => h('li', {}, e))); els.errors.hidden = false;
    return;
  }
  els.errors.hidden = true;
  last = res;
  if (!state.currencies.some(c => c.id === state.view.currency)) state.view.currency = state.currencies[0].id;
  els.curSel.replaceChildren(...state.currencies.map(c => h('option', { value: c.id, selected: c.id === state.view.currency }, c.name)));
  renderKPIs(res);
  drawChart(res);
  renderWarnings(res);
  drawFlow();
}

function renderKPIs(res) {
  const D = res.days;
  els.kpis.replaceChildren(...res.total.map(t => {
    const ratio = t.inflow > 0 ? t.outflow / t.inflow : 1;
    const bad = ratio < state.sinkRatioWarn / 100;
    return h('div.card.kpi', {},
      h('div.kpi-label', {}, `${t.currency.name} · ${D}일차 평균 보유량`),
      h('div.kpi-value', {}, num(t.mean[D])),
      h('div.kpi-sub', {}, '소모율 ', h('b', { style: bad ? 'color:var(--bad)' : null }, `${(ratio * 100).toFixed(0)}%`),
        ` · 하루 획득 ${num(t.inflow / D)} / 소모 ${num(t.outflow / D)}`),
    );
  }));
}

function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

function drawChart(res) {
  if (typeof Chart === 'undefined') return;
  const c = state.currencies.findIndex(x => x.id === state.view.currency);
  const labels = Array.from({ length: res.days + 1 }, (_, d) => d);
  const grid = cssVar('--grid'), text = cssVar('--text-3');
  const datasets = [];
  res.byUser.forEach((u, i) => {
    const color = cssVar(SERIES[i % SERIES.length]);
    if (res.runs > 1) {
      datasets.push({ label: `${u.user.name} 하위 10%`, data: u.stats[c].map(s => s.p10), borderWidth: 0, pointRadius: 0, fill: false, _band: true });
      datasets.push({ label: `${u.user.name} 상위 10%`, data: u.stats[c].map(s => s.p90), borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: color + '22', _band: true });
    }
    datasets.push({ label: `${u.user.name} (${u.user.share}%)`, data: u.stats[c].map(s => s.mean), borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, tension: 0.2 });
  });
  datasets.push({ label: '전체 평균', data: res.total[c].mean, borderColor: cssVar('--text-2'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 });
  chart?.destroy();
  chart = new Chart(els.canvas, {
    type: 'line', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { color: text, maxTicksLimit: 10, callback: (v) => `${v}일` }, border: { color: grid } },
        y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: text, maxTicksLimit: 6, callback: (v) => fmtMoney(v) } },
      },
      plugins: {
        legend: { labels: { color: text, filter: (item, data) => !data.datasets[item.datasetIndex]._band, usePointStyle: true, pointStyle: 'line' } },
        tooltip: { filter: (item) => !item.dataset._band, callbacks: { title: (items) => `${items[0].label}일차`, label: (item) => `${item.dataset.label}: ${fmtMoney(item.raw)}` } },
      },
    },
  });
  els.chartNote.textContent = res.runs > 1 ? `유저 유형마다 ${res.runs}회 반복 · 선 = 평균, 띠 = 상하위 10%` : '편차 없이 1회 계산 (설정에서 편차를 켜면 범위 띠 표시)';
}

function renderWarnings(res) {
  els.warnCard.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '검증 결과'), h('span.hint', {}, `웜업 ${state.warmup}일 이후 기준`)),
    res.warnings.length
      ? h('ul.findings', {}, ...res.warnings.map(w => h(`li.${w.level}`, {}, h('span.lv', {}, w.level === 'warn' ? '적체' : '참고'), h('span', {}, w.text))))
      : h('p.muted', {}, `모든 재화의 소모율이 기준(${state.sinkRatioWarn}%) 이상입니다.`),
  );
}

async function drawFlow() {
  try {
    const { svg, latest } = await renderSvg(toMermaid(cfg()), isDark());
    if (latest()) els.flow.innerHTML = svg; // Mermaid(strict)가 정화한 SVG
  } catch (e) { els.flow.replaceChildren(h('p.muted', {}, `흐름도를 그리지 못했습니다: ${e.message}`)); }
}

async function exportFlowPpt() {
  const btn = els.flowPpt, label = btn.textContent;
  btn.disabled = true; btn.textContent = '만드는 중…';
  try {
    const { svg, host } = await renderOffscreen(toMermaid(cfg()));
    const specs = fitShapes(collectSvgShapes(svg), { x: 0.45, y: 1.15, w: 12.4, h: 5.95 });
    host.remove();
    drawFlow();
    const pptx = await createDeck('재화 흐름도');
    const slide = pptx.addSlide();
    slide.addText(`재화 흐름도 — ${TEMPLATES[state.template].label}`, { x: 0.45, y: 0.3, w: 12.4, h: 0.6, fontFace: FONT, fontSize: 22, bold: true, color: '1B1B1A', margin: 0 });
    renderSpecs(pptx, slide, specs);
    await pptx.writeFile({ fileName: '재화 흐름도.pptx' });
    toast('PowerPoint 파일을 저장했습니다');
  } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = label; }
}

async function copyShareLink() {
  const url = `${location.origin}${location.pathname}#economy?s=${encodeState(state)}`;
  try { await navigator.clipboard.writeText(url); toast('공유 링크를 복사했습니다'); } catch { prompt('아래 링크를 복사하세요', url); }
}
