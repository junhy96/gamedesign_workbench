// 성장 재화 수급 설계 — 화면: 왼쪽 설정 메뉴, 오른쪽 공급원 → 성장 항목(마일스톤) → 도달 곡선 → 레벨별 필요량
import { design, PERIODS, targetLevel } from './model.js';
import { importGrowthTable } from '../economy/view.js';
import { TEMPLATES } from './presets.js';
import { h, store, encodeState, decodeState, downloadText, toast, debounce, comma, fmtNum } from '../lib/util.js';
import { drawChart as liveChart } from '../lib/chart.js';

const SCHEMA = 1;
const STORE_KEY = 'supply:v1';
const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4'];

let state, last, timer, chart;
const els = {};
const save = debounce(() => store.set(STORE_KEY, state), 300);
const schedule = (ms = 150) => { clearTimeout(timer); timer = setTimeout(recompute, ms); };
const newId = (p) => p + Date.now().toString(36) + Math.floor(Math.random() * 1e3);

function defaultState(id) { return { v: SCHEMA, template: id, view: 0, ...TEMPLATES[id].make() }; }
function hydrate(o) { return o && o.v === SCHEMA && TEMPLATES[o.template] ? { ...defaultState(o.template), ...o } : null; }
function readHash() { const m = location.hash.match(/^#supply\?s=([\w-]+)/); return m ? hydrate(decodeState(m[1])) : null; }
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export function mount(root) {
  state = readHash() || hydrate(store.get(STORE_KEY)) || defaultState('stone');
  if (location.hash.startsWith('#supply?')) history.replaceState(null, '', '#supply');
  build(root);
  rebuild();
  document.addEventListener('themechange', () => last && drawChart(last));
  window.addEventListener('hashchange', () => { const st = readHash(); if (st) { state = st; history.replaceState(null, '', '#supply'); rebuild(); } });
}

// ── 골격 ────────────────────────────────────────────────
function build(root) {
  const card = (role, title, hint, ...body) => h(`div.card.role-${role}`, {}, h('div.card-head', {}, h('h2', {}, title), hint ? h('span.hint', {}, hint) : null), ...body);
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '성장 재화 수급 설계'),
        h('p', {}, '어떤 콘텐츠가 성장 재화를 얼마나 뿌리는지(공급)와 언제 몇 레벨에 닿아야 하는지(마일스톤)를 넣으면, 그 공급에 딱 맞는 레벨별 필요량을 역산합니다. 다른 세그먼트가 같은 표로 언제 도달하는지도 함께 확인합니다.'),
      ),
      h('div.tool-actions', {},
        h('button.btn', { type: 'button', onclick: copyShareLink }, '공유 링크'),
        h('button.btn', { type: 'button', onclick: exportCSV }, '필요량 CSV'),
      ),
    ),
    h('div.enh-layout', {},
      els.side = h('aside.enh-side', { 'aria-label': '설정' }),
      h('div.enh-main', {},
        els.errors = h('ul.errors', { hidden: true }),
        els.kpis = h('div.kpis.econ-kpis'),
        els.sources = h('div.card.role-in'),
        els.sinks = h('div.card.role-in'),
        card('out', '레벨 도달 곡선', '같은 필요량 표로 세그먼트마다 언제 몇 레벨인지 · 점 = 마일스톤',
          els.sinkTabs = h('div.seg-tabs', {}),
          h('div.chart-box.tall', {}, els.canvas = h('canvas', { role: 'img', 'aria-label': '세그먼트별 레벨 도달 곡선' })),
        ),
        h('div.two-col.supply-out', {},
          els.levelCard = h('div.card.role-out'),
          els.warnCard = h('div.card.role-check'),
        ),
      ),
    ),
  );
}

// ── 공용 입력 ───────────────────────────────────────────
const field = (label, input, hint) => h('label.field', {}, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
function num(obj, key, opts = {}) {
  return h('input', {
    type: 'number', value: obj[key], step: opts.step ?? 'any', min: opts.min, 'aria-label': opts.label, class: opts.cls,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { obj[key] = opts.int ? Math.round(v) : v; schedule(); } },
  });
}
const text = (obj, key, label, after) => h('input.name', { type: 'text', value: obj[key], 'aria-label': label, oninput: (e) => { obj[key] = e.target.value; after?.(); schedule(300); } });
const select = (options, value, onchange) => h('select', { onchange: (e) => onchange(e.target.value) }, ...options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));

const OPEN_KEY = 'supply:sideOpen';
function section(id, title, summary, ...body) {
  const open = (store.get(OPEN_KEY) || {})[id] ?? (id === 'base' || matchMedia('(min-width: 1101px)').matches);
  return h('details.side-sec', { open, ontoggle: (e) => store.set(OPEN_KEY, { ...(store.get(OPEN_KEY) || {}), [id]: e.target.open }) },
    h('summary', {}, h('span.side-title', {}, title), summary ? h('span.side-sum', {}, summary) : null),
    h('div.side-body', {}, ...body.filter(Boolean)));
}

// ── 왼쪽 메뉴 ───────────────────────────────────────────
function renderSide() {
  const s = state;
  els.side.replaceChildren(
    section('base', '템플릿 · 기간', `${s.days}일`,
      select(Object.entries(TEMPLATES).map(([id, t]) => [id, t.label]), s.template, (v) => { state = defaultState(v); rebuild(); }),
      h('p.desc', {}, TEMPLATES[s.template].note),
      h('div.row2', {},
        field('성장 재화 이름', text(s, 'currency', '재화 이름', () => refreshTables())),
        field('시작 보유량', num(s, 'start', { min: 0, label: '시작 보유량' }))),
      field('검증 기간 (일)', num(s, 'days', { int: true, min: 1, label: '기간' }), '이 기간 안의 공급·도달 여부를 봅니다. 마일스톤이 기간 밖이어도 역산은 됩니다'),
    ),
    section('segments', '유저 세그먼트', `기준: ${s.segments[s.ref]?.name ?? '-'}`,
      h('p.desc', {}, '세그먼트마다 공급원을 하루(주·월) 몇 번 도는지가 다릅니다. 필요량은 기준 세그먼트가 마일스톤에 정확히 닿도록 역산합니다.'),
      ...s.segments.map((sg, i) => h('div.res-row.seg-row', {},
        h('label.radio', { title: '기준 세그먼트' }, h('input', { type: 'radio', name: 'supply-ref', checked: i === s.ref, onchange: () => { s.ref = i; rebuild(); } })),
        text(sg, 'name', '세그먼트 이름', () => refreshTables()),
        h('button.icon-x', { type: 'button', title: '삭제', disabled: s.segments.length <= 1, onclick: () => removeSegment(i) }, '×'))),
      s.segments.length < 4 ? h('button.btn.small', { type: 'button', onclick: addSegment }, '+ 세그먼트 추가') : null,
    ),
    section('shape', '필요량 다듬기', `${s.curve === 'smooth' ? '곡선' : '직선'} · ${s.smooth ? '단조 보정' : '공급 그대로'} · ${s.round}단위`,
      field('마일스톤 사이 연결', select([['linear', '직선 (구간마다 일정한 속도)'], ['smooth', '곡선 (초반 빠르고 점점 완만)']], s.curve ?? 'linear', (v) => { s.curve = v; renderSide(); schedule(0); }),
        '곡선은 마일스톤을 그대로 지나는 단조 3차 곡선입니다. 레벨이 되돌아가지 않고, 구간 경계에서 속도가 갑자기 꺾이지 않습니다'),
      h('label.switch', {}, '레벨이 오를수록 줄지 않게 보정', h('input', { type: 'checkbox', checked: s.smooth, onchange: (e) => { s.smooth = e.target.checked; renderSide(); schedule(0); } })),
      h('p.desc', {}, '끄면 공급량 그대로라 해금일·주간 보상 때문에 필요량이 들쭉날쭉할 수 있습니다. 켜면 인접 구간을 평균으로 묶어(총량 유지) 단조 증가로 만들고, 대신 도달일이 조금 어긋납니다.'),
      field('반올림 단위', num(s, 'round', { min: 1, label: '반올림 단위' }), '누적량을 반올림한 뒤 차이를 필요량으로 써서 총량 오차가 쌓이지 않습니다'),
      field('세그먼트 격차 경고 (배)', num(s, 'gapWarn', { min: 1, step: 0.5, label: '격차 경고' })),
    ),
  );
}

function addSegment() {
  const id = newId('g');
  state.segments.push({ id, name: `세그먼트${state.segments.length + 1}` });
  state.sources.forEach(src => { src.runs[id] = 0; });
  rebuild();
}
function removeSegment(i) {
  const [sg] = state.segments.splice(i, 1);
  state.sources.forEach(src => delete src.runs[sg.id]);
  if (state.ref >= state.segments.length) state.ref = 0;
  rebuild();
}

// ── 공급원 표 ───────────────────────────────────────────
// 메뉴에서 재화·세그먼트 이름을 바꾸면 표 머리글만 다시 그림 (메뉴 입력칸 포커스는 유지)
const refreshTables = debounce(() => { renderSources(); renderSinks(); recompute(); }, 400);

function renderSources() {
  const s = state;
  els.srcShare = {};
  const segHead = s.segments.map((sg, i) => h(`th${i === s.ref ? '.ref' : ''}`, { title: `${sg.name}: 주기마다 도는 횟수` }, `${sg.name} 횟수`));
  els.sources.replaceChildren(
    h('div.card-head', {}, h('h2', {}, `① 공급 — 어디서 ${s.currency}을(를) 뿌리나`), h('span.hint', {}, '획득량 × 횟수가 주기마다 들어옴 · 1회 = 해금일에 한 번')),
    h('div.table-wrap', {}, h('table.edit-table.supply-table', {},
      h('thead', {}, h('tr', {},
        h('th.left', {}, '공급원'), h('th', {}, '1회 획득량'), h('th', {}, '주기'), h('th', { title: '이 일차부터 공급' }, '해금 일차'),
        ...segHead, h('th', { title: `기준 세그먼트(${s.segments[s.ref].name})의 기간 내 공급 중 이 공급원 비중` }, '기준 비중'), h('th', {}, ''))),
      h('tbody', {}, ...s.sources.map((src, i) => h('tr', {},
        h('td', {}, text(src, 'name', '공급원 이름')),
        h('td', {}, num(src, 'amount', { min: 0, label: `${src.name} 획득량` })),
        h('td', {}, select(Object.entries(PERIODS), src.period, (v) => { src.period = v; schedule(0); })),
        h('td', {}, num(src, 'unlock', { int: true, min: 1, label: `${src.name} 해금 일차`, cls: 'short' })),
        ...s.segments.map(sg => h('td', {}, num(src.runs, sg.id, { min: 0, label: `${src.name} ${sg.name} 횟수`, cls: 'short' }))),
        els.srcShare[src.id] = h('td.res', {}),
        h('td.x', {}, h('button.icon-x', { type: 'button', title: '삭제', onclick: () => { s.sources.splice(i, 1); rebuild(); } }, '×')),
      ))),
    )),
    h('div.table-foot', {},
      h('button.btn.small', { type: 'button', onclick: () => { s.sources.push({ id: newId('s'), name: '새 공급원', amount: 10, period: 'day', unlock: 1, runs: Object.fromEntries(s.segments.map(sg => [sg.id, 1])) }); rebuild(); } }, '+ 공급원 추가'),
      h('span.muted.small', {}, '과금 상품(월정액·패키지)도 공급원으로 넣고 무과금 세그먼트 횟수를 0으로 두세요'),
    ),
  );
}

// ── 성장 항목 표 ────────────────────────────────────────
function renderSinks() {
  const s = state;
  els.sinkOut = {};
  els.sinks.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '② 소비 — 무엇에, 어떤 속도로 쓰게 할까'), h('span.hint', {}, `배분 = 공급 중 이 항목에 쓰는 비율 · 마일스톤 = 기준 세그먼트(${s.segments[s.ref].name})가 그 일차에 닿을 레벨`)),
    h('div.table-wrap', {}, h('table.edit-table.sink-table', {},
      h('thead', {}, h('tr', {},
        h('th.left', {}, '성장 항목'), h('th', {}, '배분 %'), h('th', {}, '최대 Lv'), h('th.left', {}, '마일스톤 (일차 → 레벨)'),
        h('th', {}, '총 필요량'), h('th', { title: '필요량(L) ≈ 기본 × 증가율^(L−1). 재화 흐름 시뮬레이터의 성장 비용에 그대로 넣을 수 있음' }, '등비 근사'), h('th', {}, ''))),
      h('tbody', {}, ...s.sinks.map((g, i) => { const out = els.sinkOut[g.id] = { total: h('td.res', {}), fit: h('td.res.fit', {}) }; return h('tr', {},
        h('td', {}, text(g, 'name', '성장 이름')),
        h('td', {}, num(g, 'share', { min: 0, label: `${g.name} 배분`, cls: 'short' })),
        h('td', {}, num(g, 'max', { int: true, min: 1, label: `${g.name} 최대 레벨`, cls: 'short' })),
        h('td.left', {}, h('div.milestones', {},
          ...g.milestones.map((m, j) => h('span.ms', {},
            num(m, 'day', { min: 1, label: '일차', cls: 'tiny' }), h('span', {}, '일 →'),
            h('span', {}, 'Lv'), num(m, 'level', { min: 1, label: '레벨', cls: 'tiny' }),
            h('button.ms-x', { type: 'button', title: '마일스톤 삭제', disabled: g.milestones.length <= 1, onclick: () => { g.milestones.splice(j, 1); rebuild(); } }, '×'))),
          h('button.ms-add', { type: 'button', title: '마일스톤 추가', onclick: () => { const lastM = g.milestones.at(-1); g.milestones.push({ day: Math.round((lastM?.day ?? 0) * 1.5 + 10), level: Math.min(g.max, (lastM?.level ?? 0) + 10) }); rebuild(); } }, '+'),
        )),
        out.total, out.fit,
        h('td.x', {}, h('button.icon-x', { type: 'button', title: '삭제', disabled: s.sinks.length <= 1, onclick: () => { s.sinks.splice(i, 1); state.view = 0; rebuild(); } }, '×')),
      ); })),
    )),
    h('div.table-foot', {},
      h('button.btn.small', { type: 'button', onclick: () => { s.sinks.push({ id: newId('k'), name: '새 성장', share: 0, max: 20, start: 0, milestones: [{ day: 30, level: 10 }, { day: 60, level: 20 }] }); rebuild(); } }, '+ 성장 항목 추가'),
      els.shareSum = h('span.muted.small', {}),
    ),
  );
}

function rebuild() { renderSide(); renderSources(); renderSinks(); recompute(); }

// ── 계산·표시 ───────────────────────────────────────────
function recompute() {
  save();
  const res = design(state);
  if (!res.ok) {
    els.errors.replaceChildren(...res.errors.slice(0, 8).map(e => h('li', {}, e)));
    els.errors.hidden = false;
    return;
  }
  els.errors.hidden = true;
  last = res;
  if (!(state.view < res.sinks.length)) state.view = 0;
  renderKPIs(res);
  // 표 안의 계산 칸
  const ref = res.supply[state.ref];
  for (const src of state.sources) {
    const el = els.srcShare[src.id];
    if (el) el.textContent = ref.total > 0 ? `${((ref.bySource[src.id] || 0) / ref.total * 100).toFixed(1)}%` : '—';
  }
  for (const k of res.sinks) {
    const o = els.sinkOut[k.sink.id];
    if (!o) continue;
    o.total.textContent = `${comma(k.total)}`;
    o.fit.replaceChildren(...(k.fit ? [`${comma(k.fit.base)} × ${k.fit.rate.toFixed(3)}^(L−1)`, h('span.fit-err', {}, `최대 오차 ${(k.fit.maxErr * 100).toFixed(0)}%`)] : ['—']));
    o.fit.title = k.fit ? `최대 오차 ${(k.fit.maxErr * 100).toFixed(0)}% — 마일스톤 구간마다 속도가 다르면 오차가 큽니다` : '';
  }
  const sum = state.sinks.reduce((a, g) => a + g.share, 0);
  els.shareSum.textContent = `배분 합 ${+sum.toFixed(2)}%`;
  els.shareSum.classList.toggle('bad-text', sum > 100.0001);
  renderSinkTabs(res);
  drawChart(res);
  renderLevels(res);
  renderWarnings(res);
}

function renderKPIs(res) {
  const cur = state.currency;
  els.kpis.replaceChildren(...res.supply.map((sp, i) => h(`div.card.kpi.seg-kpi${i === state.ref ? '.hero' : ''}`, { style: `--seg:var(${SERIES[i % SERIES.length]})` },
    h('div.kpi-label', {}, h('i.seg-dot'), `${sp.seg.name}${i === state.ref ? ' (기준)' : ''} · 하루 평균 공급`),
    h('div.kpi-value', {}, `${fmtNum(sp.perDay, 1)} ${cur}`),
    h('div.kpi-sub', {}, `${state.days}일 총 ${comma(sp.total)}`),
    h('div.kpi-sub', {}, res.sinks.map(k => {
      const d = k.reach[i].at(-1);
      return `${k.sink.name} Lv${k.sink.max} ${d == null || d > state.days ? '기간 내 미도달' : `${d}일`}`;
    }).join(' · ')),
  )));
}

function renderSinkTabs(res) {
  els.sinkTabs.replaceChildren(...(res.sinks.length > 1 ? res.sinks.map((k, i) => h('button', {
    type: 'button', 'aria-pressed': String(i === state.view),
    onclick: () => { state.view = i; save(); renderSinkTabs(last); drawChart(last); renderLevels(last); },
  }, k.sink.name)) : []));
}

function drawChart(res) {
  if (typeof Chart === 'undefined') return;
  const k = res.sinks[state.view];
  const g = k.sink;
  const grid = cssVar('--grid'), tick = cssVar('--text-3'), ink = cssVar('--text-2');
  const maxDay = Math.max(state.days, ...g.milestones.map(m => m.day));
  // 세그먼트별 계단: (도달일, 레벨)
  const datasets = res.supply.map((sp, si) => {
    const pts = [{ x: 0, y: g.start ?? 0 }];
    k.reach[si].forEach((d, i) => { if (d != null && d <= maxDay) pts.push({ x: d, y: k.levels[i] }); });
    const lastPt = pts.at(-1);
    if (lastPt.x < maxDay) pts.push({ x: maxDay, y: lastPt.y });
    const color = cssVar(SERIES[si % SERIES.length]);
    return { label: sp.seg.name + (si === state.ref ? ' (기준)' : ''), data: pts, borderColor: color, backgroundColor: color, stepped: 'before', pointRadius: 0, borderWidth: si === state.ref ? 2.5 : 1.75 };
  });
  const pts = [];
  for (let d = 0; d <= maxDay; d += Math.max(0.5, maxDay / 200)) pts.push({ x: d, y: Math.min(g.max, targetLevel(g, d, state.curve)) });
  datasets.push({ label: '목표 곡선', data: pts, borderColor: ink, borderDash: [5, 4], borderWidth: 1.25, pointRadius: 0, stepped: false });
  datasets.push({
    label: '마일스톤', type: 'scatter', data: g.milestones.map(m => ({ x: m.day, y: m.level })),
    pointRadius: 6, pointHoverRadius: 7, pointStyle: 'rectRot', backgroundColor: ink, borderColor: cssVar('--surface'), borderWidth: 2,
  });
  chart = liveChart('supply:chart', els.canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false,
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      scales: {
        x: { type: 'linear', min: 0, max: maxDay, title: { display: true, text: '일차', color: tick }, grid: { color: grid }, ticks: { color: tick } },
        y: { min: 0, max: g.max, title: { display: true, text: 'Lv', color: tick }, grid: { color: grid }, ticks: { color: tick, precision: 0 } },
      },
      plugins: {
        legend: { labels: { color: ink, boxWidth: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: (it) => `${it.dataset.label}: ${Math.round(it.raw.x)}일 · Lv${it.raw.y}` } },
      },
    },
  });
}

function renderLevels(res) {
  const k = res.sinks[state.view];
  const segs = res.supply.map(s => s.seg);
  const dayCell = (d, target) => {
    if (d == null) return h('td.muted', {}, '—');
    const late = d > state.days;
    return h(`td${late ? '.muted' : ''}`, { title: target != null ? `목표 ${target.toFixed(1)}일` : null }, `${d}일`);
  };
  const ms = new Set(k.sink.milestones.map(m => m.level));
  els.levelCard.replaceChildren(
    h('div.card-head', {}, h('h2', {}, `③ 레벨별 필요량 — ${k.sink.name}`),
      h('div.tool-actions', {}, h('span.hint', {}, `단위 ${state.currency} · 굵은 줄 = 마일스톤 레벨`),
        h('button.btn.small.primary', { type: 'button', title: '이 표를 재화 흐름 시뮬레이터의 같은 이름 성장 항목 비용으로 넣고 이동', onclick: () => sendToEconomy(k) }, '재화 흐름으로 보내기'))),
    h('div.table-wrap.level-wrap', {}, h('table.stages.level-table', {},
      h('thead', {}, h('tr', {},
        h('th.left', {}, 'Lv'), h('th', {}, '필요량'), h('th', {}, '누적'), h('th', { title: '마일스톤을 선형으로 이은 목표 일차' }, '목표일'),
        ...segs.map((sg, i) => h(`th${i === state.ref ? '.ref' : ''}`, {}, `${sg.name} 도달`)))),
      h('tbody', {}, ...k.levels.map((L, i) => h(`tr${ms.has(L) ? '.ms-row' : ''}`, {},
        h('td.stage', {}, `${L - 1} → ${L}`),
        h('td', {}, comma(k.cost[i])),
        h('td.muted', {}, comma(k.cum[i])),
        h('td.muted', {}, `${k.targetDays[i].toFixed(1)}일`),
        ...segs.map((_, si) => dayCell(k.reach[si][i], si === state.ref ? k.targetDays[i] : null)),
      ))),
    )),
  );
}

function renderWarnings(res) {
  const LV = { serious: '불가', warn: '주의', info: '참고' };
  els.warnCard.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '검증 결과'), h('span.hint', {}, res.warnings.length ? `${res.warnings.length}건` : '문제 없음')),
    res.warnings.length
      ? h('ul.findings', {}, ...res.warnings.map(w => h(`li.${w.level === 'info' ? 'info' : w.level}`, {}, h('span.lv', {}, LV[w.level]), h('span', {}, w.text))))
      : h('p.muted', {}, '모든 세그먼트가 기간 안에 최대 레벨에 닿고, 필요량이 0인 레벨이 없습니다.'),
    h('div.supply-howto', {},
      h('b', {}, '계산 방법'),
      h('p.muted.small', {}, `레벨 L 누적 필요량 = 배분 % × 기준 세그먼트의 누적 공급(목표일). 기준 세그먼트는 마일스톤에 정확히 닿고(보정·반올림 전), 다른 세그먼트는 같은 표로 자기 공급이 누적 필요량을 넘는 첫 날에 도달합니다.`),
    ),
  );
}

// ── 재화 흐름 시뮬레이터로 보내기 ───────────────────────
function sendToEconomy(k) {
  const r = importGrowthTable({ currency: state.currency.trim() || '재화', name: k.sink.name.trim() || '성장', max: k.sink.max, start: k.sink.start ?? 0, costs: k.cost });
  location.hash = '#economy';
  toast(`재화 흐름에 '${k.sink.name}' 필요량 표를 ${r.created ? '새 성장 항목으로 추가' : '적용'}했습니다${r.currencyCreated ? ` (재화 '${state.currency}' 추가)` : ''}`);
}

// ── 공유·내보내기 ───────────────────────────────────────
async function copyShareLink() {
  const url = `${location.origin}${location.pathname}#supply?s=${encodeState(state)}`;
  try { await navigator.clipboard.writeText(url); toast('공유 링크를 복사했습니다'); }
  catch { prompt('아래 링크를 복사하세요', url); }
}

function exportCSV() {
  if (!last) { toast('먼저 오류를 고쳐 주세요'); return; }
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [];
  for (const k of last.sinks) {
    lines.push([esc(k.sink.name), esc(`배분 ${k.sink.share}%`), esc(`단위 ${state.currency}`)].join(','));
    lines.push(['레벨', '필요량', '누적', '목표일', ...last.supply.map(s => `${s.seg.name} 도달일`)].map(esc).join(','));
    k.levels.forEach((L, i) => lines.push([L, k.cost[i], k.cum[i], k.targetDays[i].toFixed(1), ...k.reach.map(r => r[i] ?? '')].join(',')));
    lines.push('');
  }
  downloadText(`growth-requirements-${state.template}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}
