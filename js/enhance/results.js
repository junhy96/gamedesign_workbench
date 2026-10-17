// 결과 영역: KPI(기준안 대비)·고정 띠, 분포·예산, 재화별 소모, 검증, 아이템 최적화(MDP), 아이템 가격 곡선, 목표 비용 역산
import { optimizeItems, solveForCost, priceSweep, specUnits, isQty, MAX_SWEEP_POINTS } from './model.js';
import { reachProbability } from './simulate.js';
import { h, fmtMoney, fmtMoneyShort, fmtPct, fmtNum, comma, toast } from '../lib/util.js';
import { money as won, moneyShort as wonShort, currency, toDisplay, fromDisplay } from './currency.js';
export { won };

// ── KPI ────────────────────────────────────────────────
const KPI_DEFS = [
  { key: 'expCost', label: '기대 총비용', hero: true, fmt: won, better: 'lower' },
  { key: 'std', label: '표준편차 (정확해)', fmt: wonShort, better: 'lower' },
  { key: 'noDestroy', label: '파괴 없이 도달할 확률', fmt: (v) => fmtPct(v, v < 0.01 ? 2 : 1), better: 'higher' },
  { key: 'expDestroy', label: '기대 파괴 횟수', fmt: (v) => `${fmtNum(v, 2)}회`, better: 'lower' },
  { key: 'attempts', label: '기대 시도 횟수', fmt: (v) => `${fmtNum(v, 1)}회`, better: 'lower' },
];

export function buildKPIs(els) {
  return h('div.kpis', {}, ...KPI_DEFS.map(d => h(`div.card.kpi${d.hero ? '.hero' : ''}`, {},
    h('div.kpi-label', {}, d.label),
    els[d.key] = h('div.kpi-value', {}, '—'),
    els[d.key + 'Sub'] = h('div.kpi-sub', {}),
    els[d.key + 'Delta'] = h('div.kpi-delta', {}),
  )));
}

/** 상단 고정 띠의 간단한 지표 (설계 입력·밸런스 도구 화면에서 입력을 바꾸며 바로 확인) */
export function buildStrip(els) {
  return h('div.kpi-strip', {}, ...KPI_DEFS.map(d => h(`div.mini-kpi${d.hero ? '.hero' : ''}`, {},
    h('span.mini-label', {}, d.label.replace(' (정확해)', '')),
    els[d.key + 'Mini'] = h('b.mini-value', {}, '—'),
    els[d.key + 'MiniDelta'] = h('span.mini-delta', {}),
  )));
}

export function renderKPIs(ctx, els, res) {
  const base = ctx.state.baseline;
  for (const d of KPI_DEFS) {
    els[d.key].textContent = els[d.key + 'Mini'].textContent = d.fmt(res[d.key]);
    const el = els[d.key + 'Delta'], mini = els[d.key + 'MiniDelta'];
    if (!base) { el.replaceChildren(); mini.replaceChildren(); continue; }
    const b = base[d.key];
    const diff = d.key === 'noDestroy' ? res[d.key] - b : (b ? res[d.key] / b - 1 : 0);
    const same = Math.abs(diff) < 5e-4;
    const good = same ? null : (diff < 0) === (d.better === 'lower');
    const txt = same ? '기준안과 같음' : d.key === 'noDestroy'
      ? `기준안 대비 ${diff > 0 ? '+' : ''}${(diff * 100).toFixed(1)}%p`
      : `기준안 대비 ${diff > 0 ? '+' : ''}${(diff * 100).toFixed(1)}%`;
    el.replaceChildren(h(`span.delta${same ? '' : good ? '.good' : '.bad'}`, {}, txt));
    mini.replaceChildren(same ? '' : h(`span.delta${good ? '.good' : '.bad'}`, { title: txt }, txt.replace('기준안 대비 ', '')));
  }
  const cv = res.expCost > 0 ? res.std / res.expCost : 0;
  els.stdSub.replaceChildren('변동계수 ', h('b', {}, cv.toFixed(2)), cv > 1 ? ' · 유저 간 편차가 평균보다 큼' : ' · σ ÷ 평균');
  els.noDestroySub.textContent = '목표까지 한 번도 파괴되지 않을 확률';
  els.expDestroySub.replaceChildren('운 나쁜 10%는 ', h('b', {}, `${comma(res.destroyQuantile(0.9))}회+`), ' · 1%는 ', h('b', {}, `${comma(res.destroyQuantile(0.99))}회+`));
}

// ── 분포 + 예산 ─────────────────────────────────────────
export function buildDist(ctx, els) {
  els.budgetInput = h('input', {
    type: 'number', min: 0, step: 'any', inputmode: 'decimal', 'aria-label': '예산',
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { ctx.state.budget = fromDisplay(v); ctx.save(); renderBudget(ctx, els); } },
  });
  return h('div.card', {},
    h('div.card-head', {}, h('h2', {}, '총비용 분포와 예산'), els.distHint = h('span.hint', {})),
    h('div.dist', {},
      h('div.chart-box', {}, els.canvas = h('canvas', { role: 'img', 'aria-label': '총비용 분포 히스토그램' })),
      h('div.budget', {},
        h('label.field', {}, els.budgetLabel = h('span', {}, '예산 (원)'), els.budgetInput),
        els.budgetOut = h('div.budget-out', {}),
        els.pct = h('dl.pct-list', {}),
      ),
    ),
  );
}

export function renderBudget(ctx, els) {
  const mc = ctx.lastMC;
  if (!mc) { els.budgetOut.replaceChildren(h('span.muted', {}, '시뮬레이션 대기 중')); return; }
  const b = ctx.state.budget;
  els.budgetLabel.textContent = `예산 (${currency().name})`;
  if (document.activeElement !== els.budgetInput) els.budgetInput.value = Math.round(toDisplay(b));
  const p = reachProbability(mc.sortedCost, b);
  els.budgetOut.replaceChildren(
    h('div.big', {}, fmtPct(p, 1)),
    h('div.muted', {}, `이 예산 안에 목표에 도달하는 비율 (${wonShort(b)})`),
  );
}

export function renderMC(ctx, els, mc, res) {
  ctx.lastMC = mc;
  if (!(ctx.state.budget > 0)) ctx.state.budget = Math.round(res.expCost);
  const c = mc.pct.cost, a = mc.pct.attempts;
  els.expCostSub.replaceChildren('중앙값 ', h('b', {}, wonShort(c.p50)), ' · 상위 10% ', h('b', {}, wonShort(c.p90)), ' · 1% ', h('b', {}, wonShort(c.p99)));
  els.attemptsSub.replaceChildren('중앙값 ', h('b', {}, `${comma(a.p50)}회`), ' · 상위 10% ', h('b', {}, `${comma(a.p90)}회`));
  els.distHint.textContent = `시뮬레이션 ${comma(mc.trials)}회 · 상위 1%를 넘는 꼬리는 그래프에서 생략`;
  const row = (dt, dd) => h('div', {}, h('dt', {}, dt), h('dd', {}, dd));
  els.pct.replaceChildren(
    row('50% 도달 예산', wonShort(c.p50)),
    row('90% 도달 예산', wonShort(c.p90)),
    row('99% 도달 예산', wonShort(c.p99)),
  );
  renderBudget(ctx, els);
  drawChart(ctx, els, mc);
  renderVerify(els, res, mc);
}

export function renderMCSkipped(ctx, els, res) {
  ctx.lastMC = null;
  els.distHint.textContent = '기대 시도 횟수가 너무 커서 시뮬레이션을 생략했습니다 (정확해만 표시)';
  els.expCostSub.textContent = '분포는 시뮬레이션 생략으로 표시하지 않습니다';
  els.attemptsSub.textContent = '';
  els.pct.replaceChildren();
  els.budgetOut.replaceChildren(h('span.muted', {}, '시뮬레이션 생략'));
  ctx.chart?.destroy(); ctx.chart = null;
  renderVerify(els, res, null);
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

export function drawChart(ctx, els, mc) {
  if (typeof Chart === 'undefined') { els.distHint.textContent = '차트 라이브러리를 불러오지 못했습니다'; return; }
  const { edges, counts, n } = mc.histogram;
  const data = counts.map((cnt, i) => ({ x: (edges[i] + edges[i + 1]) / 2, y: (cnt / n) * 100, lo: edges[i], hi: edges[i + 1], cnt }));
  const series = cssVar('--series-1'), grid = cssVar('--grid'), text = cssVar('--text-3'), ink = cssVar('--text-2');
  const marks = [['50%', mc.pct.cost.p50], ['90%', mc.pct.cost.p90], ['99%', mc.pct.cost.p99]];
  const budget = ctx.state.budget;
  const binW = edges[1] - edges[0];
  const markers = {
    id: 'pctMarkers',
    afterDatasetsDraw(c) {
      const { ctx: g, chartArea: area, scales: { x } } = c;
      g.save();
      g.font = '600 11px Pretendard Variable, system-ui, sans-serif';
      g.textAlign = 'center';
      for (const [label, v] of marks) {
        const px = x.getPixelForValue(v);
        if (px < area.left || px > area.right) continue;
        g.strokeStyle = ink; g.setLineDash([3, 3]); g.lineWidth = 1;
        g.beginPath(); g.moveTo(px, area.top + 14); g.lineTo(px, area.bottom); g.stroke();
        g.fillStyle = ink; g.fillText(label, px, area.top + 10);
      }
      const bx = x.getPixelForValue(budget);
      if (budget > 0 && bx >= area.left && bx <= area.right) {
        g.strokeStyle = series; g.setLineDash([]); g.lineWidth = 2;
        g.beginPath(); g.moveTo(bx, area.top + 14); g.lineTo(bx, area.bottom); g.stroke();
        g.fillStyle = series; g.fillText('예산', bx, area.top + 10);
      }
      g.restore();
    },
  };
  ctx.chart?.destroy();
  ctx.chart = new Chart(els.canvas, {
    type: 'bar',
    data: { datasets: [{ data, backgroundColor: series, hoverBackgroundColor: series + 'cc', borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'start', barPercentage: 0.9, categoryPercentage: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { top: 6 } },
      scales: {
        x: { type: 'linear', offset: false, min: edges[0], max: edges.at(-1) + binW * 0.01, grid: { display: false }, border: { color: grid }, ticks: { color: text, maxTicksLimit: 6, callback: (v) => fmtMoneyShort(toDisplay(v)) } },
        y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: text, maxTicksLimit: 5, callback: (v) => `${v}%` } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: (items) => `${won(items[0].raw.lo)} ~ ${won(items[0].raw.hi)}`,
            label: (item) => `${item.raw.y.toFixed(1)}% (${comma(item.raw.cnt)}회)`,
          },
        },
      },
    },
    plugins: [markers],
  });
}

// ── 재화별 기대 소모 ────────────────────────────────────
export function renderResources(els, res) {
  const total = res.expCost || 1;
  els.resources.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '재화별 기대 소모'), h('span.hint', {}, '파괴 복구 비용·보조 아이템 포함')),
    h('table.mini', {},
      h('thead', {}, h('tr', {}, h('th.left', {}, '재화'), h('th', {}, '기대 소모량'), h('th', {}, `환산 (${currency().name})`), h('th', {}, '비중'))),
      h('tbody', {}, ...res.resources.map(r => h('tr', {},
        h('td.left', {}, r.name), h('td', {}, fmtMoney(r.units)), h('td', {}, won(r.worth)), h('td', {}, fmtPct(r.worth / total)),
      ))),
    ),
    h('div.bm-line', {},
      h('span', {}, '보조 아이템 기대 지출'), h('b', {}, won(res.itemSpend)),
      h('span.muted', {}, `총비용의 ${fmtPct(res.itemSpend / total)} · 목표 도달 1회당 BM 기대 매출`),
    ),
    res.destroyCostTotal > 0 ? h('div.bm-line', {},
      h('span', {}, '파괴 복구 기대 비용'), h('b', {}, won(res.destroyCostTotal)),
      h('span.muted', {}, `총비용의 ${fmtPct(res.destroyCostTotal / total)}`),
    ) : null,
  );
}

// ── 검증 ────────────────────────────────────────────────
export function renderVerify(els, res, mc) {
  const rel = (a, b) => (b ? Math.abs(a - b) / Math.abs(b) : 0);
  const rows = [
    ['기대 총비용', won(res.expCost), mc && won(mc.mean.cost), mc && rel(mc.mean.cost, res.expCost)],
    ['기대 시도', fmtNum(res.attempts, 2), mc && fmtNum(mc.mean.attempts, 2), mc && rel(mc.mean.attempts, res.attempts)],
    ['기대 파괴', fmtNum(res.expDestroy, 3), mc && fmtNum(mc.mean.destroys, 3), null],
    ['무파괴 확률', fmtPct(res.noDestroy, 2), mc && fmtPct(mc.noDestroy, 2), null],
  ];
  const maxDiff = mc ? Math.max(...rows.map(r => r[3] ?? 0)) : null;
  const ok = maxDiff != null && maxDiff < 0.03;
  els.verify.replaceChildren(...[
    h('div.card-head', {}, h('h2', {}, '계산 검증'),
      mc ? h(`span.status.${ok ? 'good' : 'warn'}`, {}, ok ? `✓ 일치 (오차 ${(maxDiff * 100).toFixed(1)}%)` : `! 오차 ${(maxDiff * 100).toFixed(1)}% — 표본 부족 가능`) : null),
    h('p.muted.small', {}, `상태 ${comma(res.meta.states)}개(연속 카운터 ${res.meta.counter + 1}단계)의 흡수 마르코프 체인을 띠 행렬 LU + Sherman–Morrison으로 정확히 풀고, 시드 고정 시뮬레이션과 비교합니다.`),
    h('div.verify-grid', {},
      h('span.h', {}, ''), h('span.h', {}, '정확해'), h('span.h', {}, mc ? `시뮬레이션 ${comma(mc.trials)}회` : '시뮬레이션 생략'),
      ...rows.flatMap(([k, a, b]) => [h('span', {}, k), h('b', {}, a), h('span', {}, b ?? '—')]),
    ),
  ].filter(Boolean));
}

// ── 보조 아이템 최적 사용 정책 ──────────────
export function renderOptCard(ctx, els) {
  els.optCard.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '보조 아이템 최적 사용 정책'), h('span.hint', {}, '마르코프 결정 과정 · 정책 반복법')),
    h('p.muted.small', {}, '상태(단계 × 연속 카운터)마다 어떤 아이템 조합을(수량형은 몇 개) 쓸지 골라 기대 총비용을 최소화합니다. 아이템 가격이 적정한지, 유저가 합리적으로 쓰면 어디서 얼마나 팔리는지 확인하는 용도입니다.'),
    h('div', {}, ctx.state.items.length
      ? h('button.btn.primary', { type: 'button', onclick: () => runOptimizer(ctx, els) }, '최적 정책 계산')
      : h('p.muted.small', {}, '설계 입력에서 보조 아이템을 먼저 추가하세요.')),
    els.optOut = h('div', {}),
  );
}

function runOptimizer(ctx, els) {
  const res = optimizeItems(ctx.toConfig());
  if (!res.ok) { els.optOut.replaceChildren(h('ul.errors', {}, ...res.errors.map(e => h('li', {}, e)))); return; }
  const items = ctx.state.items;
  const entries = Object.entries(res.usage).sort((a, b) => a[0] - b[0]);
  const saving = res.before > 0 ? 1 - res.after / res.before : 0;
  els.optOut.replaceChildren(h('div.opt-result', {},
    h('p', {}, '기대 총비용 ', h('b', {}, won(res.before)), ' → ', h('b', {}, won(res.after)),
      saving > 1e-4 ? h('span.saving', {}, ` (${(saving * 100).toFixed(1)}% 절감)`) : ' (현재 설정이 최적)',
      h('span.muted', {}, ` · 정책 반복 ${res.iterations}회`)),
    h('p', {}, '이 정책에서 BM 기대 매출(아이템 기대 지출) ', h('b', {}, won(res.itemSpend)), h('span.muted', {}, ` · 총비용의 ${fmtPct(res.itemSpend / (res.after || 1))}`)),
    entries.length ? h('ul.policy', {}, ...entries.map(([stage, u]) => h('li', {},
      h('b', {}, `+${stage}`),
      u.byCounter ? describeByCounter(u, items) : describeUnits(specUnits(u), items),
    ))) : h('p.muted', {}, '아이템을 쓰지 않는 것이 최적입니다 (가격 대비 효과가 낮음).'),
    h('button.btn', { type: 'button', onclick: () => { ctx.state.usage = res.usage; ctx.markTableDirty(); ctx.recompute(); toast('최적 정책을 적용했습니다'); } }, '이 정책 적용'),
  ));
}

/** 투입 요약: '상급 ×8 + 중급 ×15' (토글형은 이름만) */
function describeUnits(units, items) {
  return items.filter(it => units[it.id] > 0).map(it => (isQty(it) ? `${it.name} ×${units[it.id]}` : it.name)).join(' + ') || '사용 안 함';
}

function describeByCounter(u, items) {
  // 카운터별 사용 목록을 '연속 n회 이상부터 X' 형태로 요약
  const per = u.byCounter.map(specUnits);
  return items.filter(it => per.some(m => m[it.id] > 0)).map(it => {
    const ns = per.map(m => m[it.id] ?? 0);
    const label = (n) => (isQty(it) ? `${it.name} ×${n}` : it.name);
    if (ns.every(n => n === ns[0])) return label(ns[0]);
    const first = ns.findIndex(n => n > 0);
    if (ns.slice(first).every(n => n === ns[first])) return `${label(ns[first])} (연속 ${first}회부터)`;
    return `${it.name} ×${Math.min(...ns)}~${Math.max(...ns)} (연속 횟수에 따라)`;
  }).join(' + ') || '사용 안 함';
}

// ── 아이템 가격 곡선 ────────────────────────────────────
// 대상 아이템 가격을 바꿔 가며 최적 정책을 다시 풀어, 가격별 BM 기대 매출과 유저 절감률을 본다.
// 두 지표는 단위가 달라 한 그래프에 축 둘로 겹치지 않고, 같은 가격 축의 그래프 두 개로 나란히 둔다.
const niceStep = (x) => { const e = 10 ** Math.floor(Math.log10(x)); return [1, 2, 5, 10].map(k => k * e).find(v => v >= x); };

function defaultSweep(items) {
  const it = items.find(isQty) ?? items[0];
  const ri = Math.max(0, it.costs.findIndex(v => v > 0));
  const step = niceStep(Math.max(it.costs[ri] || 1, 1e-6) / 5);
  return { item: it.id, resource: ri, from: step, to: step * 30, step, targetSaving: 0.15 };
}

export function renderSweepCard(ctx, els) {
  const s = ctx.state;
  ctx.lastSweep = null; drawSweep(ctx, els);
  if (!s.items.length) {
    els.sweepCard.replaceChildren(h('div.card-head', {}, h('h2', {}, '아이템 가격 곡선')), h('p.muted.small', {}, '설계 입력에서 보조 아이템을 먼저 추가하세요.'));
    return;
  }
  if (!s.priceSweep || !s.items.some(it => it.id === s.priceSweep.item)) s.priceSweep = defaultSweep(s.items);
  const sw = s.priceSweep;
  const num = (key, label, opts = {}) => h('label.field', {}, h('span', {}, label), h('input', {
    type: 'number', value: opts.pct ? +(sw[key] * 100).toFixed(4) : sw[key], min: 0, step: 'any', inputmode: 'decimal', 'aria-label': label,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { sw[key] = opts.pct ? v / 100 : v; ctx.save(); } },
  }));
  const sel = (label, options, value, onchange) => h('label.field', {}, h('span', {}, label),
    h('select', { onchange: (e) => { onchange(e.target.value); ctx.save(); } }, ...options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t))));
  els.sweepCard.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '아이템 가격 곡선'), h('span.hint', {}, '가격마다 최적 정책을 다시 풂')),
    h('p.muted.small', {}, '유저가 최적 정책대로 산다고 보고, 한 아이템의 가격만 바꿔 가며 BM 기대 매출(목표 도달 1회당 아이템 지출)과 유저 절감률(아이템 없이 강화할 때 대비 기대 비용 절감)을 봅니다. 가격을 올리면 개당 매출은 늘지만 투입량이 계단식으로 줄어 어딘가에서 매출이 꺾입니다.'),
    h('div.sweep-form', {},
      sel('대상 아이템', s.items.map(it => [it.id, it.name]), sw.item, (v) => { sw.item = v; }),
      sel('가격 재화', s.resources.map((r, i) => [i, r.name]), sw.resource, (v) => { sw.resource = +v; }),
      num('from', '가격 시작'), num('to', '가격 끝'), num('step', '간격'),
      num('targetSaving', '목표 절감률 %', { pct: true }),
    ),
    h('div', {}, h('button.btn.primary', { type: 'button', onclick: () => runSweep(ctx, els) }, '가격 곡선 계산'),
      h('span.muted.small', {}, ` 가격 점 최대 ${MAX_SWEEP_POINTS}개`)),
    els.sweepOut = h('div', {}),
  );
}

function runSweep(ctx, els) {
  const s = ctx.state, sw = s.priceSweep;
  const res = priceSweep(ctx.toConfig(), sw);
  if (!res.ok) { ctx.lastSweep = null; drawSweep(ctx, els); els.sweepOut.replaceChildren(h('ul.errors', {}, ...res.errors.map(e => h('li', {}, e)))); return; }
  const unit = s.resources[res.resource].name;
  const price = (v) => `${fmtNum(v, v % 1 ? 2 : 0)} ${unit}`;
  const cur = res.item.costs[res.resource] || 0;
  const pct = (v) => fmtPct(v, 1);
  const goal = pct(res.goal);
  const { bmMax, reach, unusedFrom } = res;
  const last = res.points.at(-1);
  const apply = (v, label) => h('button.btn', {
    type: 'button',
    onclick: () => {
      const it = s.items.find(x => x.id === res.item.id);
      if (!it) return;
      if (!s.baseline) ctx.saveBaseline('가격 변경 전');
      it.costs[res.resource] = v; ctx.rebuild();
      toast(`${it.name} 가격을 ${price(v)}로 바꿨습니다 (변경 전 결과는 기준안으로 저장)`);
    },
  }, label);
  ctx.lastSweep = res;
  els.sweepOut.replaceChildren(h('div.opt-result', {},
    h('ul.sweep-facts', {},
      h('li', {}, 'BM 기대 매출 최대: ', h('b', {}, price(bmMax.price)), ` → 매출 ${won(bmMax.bmSpend)}, 유저 절감률 ${pct(bmMax.saving)}`,
        h('span.muted', {}, ` (현재 가격 ${price(cur)})`)),
      reach
        ? h('li', {}, `절감률이 목표 ${goal} 이하가 되는 가격: `, h('b', {}, `${price(reach.price)}부터`), ` (절감률 ${pct(reach.saving)}, 매출 ${won(reach.bmSpend)})`)
        : h('li', {}, `절감률이 목표 ${goal} 이하가 되는 가격: `, h('b', {}, '없음'), ' — ', unusedFrom
          ? `${price(unusedFrom.price)}부터 ${res.item.name}은(는) 아예 쓰이지 않고, 나머지 아이템만으로 ${pct(unusedFrom.saving)} 절감합니다. 이 아이템 가격만 올려서는 닿지 않으니 다른 아이템 가격(%p당 비용)도 함께 올려야 합니다.`
          : `범위 끝(${price(last.price)})에서도 절감률 ${pct(last.saving)}이고 이 아이템이 아직 쓰입니다. 가격 범위를 넓혀 보세요.`),
    ),
    h('div.sweep-charts', {},
      h('div', {}, h('h3', {}, `BM 기대 매출 (${currency().name})`), h('div.chart-box', {}, els.sweepRev = h('canvas', { role: 'img', 'aria-label': '가격별 BM 기대 매출 그래프' }))),
      h('div', {}, h('h3', {}, '유저 절감률 (%)'), h('div.chart-box', {}, els.sweepSave = h('canvas', { role: 'img', 'aria-label': '가격별 유저 절감률 그래프' }))),
    ),
    h('details', {}, h('summary', {}, `가격별 표 (${res.points.length}개 점)`),
      h('div.table-wrap', {}, h('table.mini', {},
        h('thead', {}, h('tr', {}, h('th.left', {}, `가격 (${unit})`), h('th', {}, 'BM 기대 매출'), h('th', {}, '유저 절감률'), h('th', {}, '기대 총비용'),
          h('th', { title: '최적 정책에서 단계별 1회 투입 개수의 합' }, '정책 투입 개수'), h('th', { title: '목표 도달 1회당 기대 구매 개수 (재시도 포함)' }, '기대 구매 개수'))),
        h('tbody', {}, ...res.points.map(p => h('tr', {},
          h('td.left', {}, p === bmMax ? h('b', {}, `${fmtNum(p.price, p.price % 1 ? 2 : 0)} (매출 최대)`) : fmtNum(p.price, p.price % 1 ? 2 : 0)),
          h('td', {}, won(p.bmSpend)), h('td', {}, pct(p.saving)), h('td', {}, won(p.expCost)),
          h('td', {}, comma(p.policyUnits)), h('td', {}, fmtNum(p.units, 1)),
        ))),
      ))),
    h('div.tool-actions', {}, apply(bmMax.price, '매출 최대 가격 적용'), reach && reach !== bmMax ? apply(reach.price, '목표 절감률 가격 적용') : null),
  ));
  drawSweep(ctx, els);
}

export function drawSweep(ctx, els) {
  ctx.sweepCharts?.forEach(c => c.destroy());
  ctx.sweepCharts = [];
  const r = ctx.lastSweep;
  if (!r || typeof Chart === 'undefined' || !els.sweepRev?.isConnected) return;
  const grid = cssVar('--grid'), text = cssVar('--text-3'), ink = cssVar('--text-2');
  const unit = ctx.state.resources[r.resource]?.name ?? '';
  const xs = r.points.map(p => p.price);
  const cur = r.item.costs[r.resource] || 0;
  // 세로 표시선(매출 최대 = 실선, 현재 가격 = 점선)과 목표 절감률 가로선
  const marks = (hLine) => ({
    id: 'sweepMarks',
    afterDatasetsDraw(c) {
      const { ctx: g, chartArea: area, scales: { x, y } } = c;
      g.save();
      g.font = '600 11px Pretendard Variable, system-ui, sans-serif';
      g.textAlign = 'center';
      for (const [label, v, solid] of [['매출 최대', r.bmMax.price, true], ['현재', cur, false]]) {
        const px = x.getPixelForValue(v);
        if (px < area.left - 0.5 || px > area.right + 0.5) continue;
        g.strokeStyle = ink; g.setLineDash(solid ? [] : [3, 3]); g.lineWidth = 1;
        g.beginPath(); g.moveTo(px, area.top + 14); g.lineTo(px, area.bottom); g.stroke();
        g.fillStyle = ink; g.fillText(label, px, area.top + 10);
      }
      if (hLine != null) {
        const py = y.getPixelForValue(hLine);
        if (py >= area.top && py <= area.bottom) {
          g.strokeStyle = ink; g.setLineDash([4, 4]); g.lineWidth = 1;
          g.beginPath(); g.moveTo(area.left, py); g.lineTo(area.right, py); g.stroke();
          g.textAlign = 'right'; g.fillStyle = ink; g.fillText(`목표 ${fmtPct(r.goal, 1)}`, area.right - 4, py - 4);
        }
      }
      g.restore();
    },
  });
  const chart = (canvas, color, y, tick, hLine, extra = {}) => new Chart(canvas, {
    type: 'line',
    data: { datasets: [{ data: r.points.map(p => ({ x: p.price, y: y(p), p })), borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 12 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 6 } },
      scales: {
        x: { type: 'linear', min: xs[0], max: xs.at(-1), grid: { display: false }, border: { color: grid }, ticks: { color: text, maxTicksLimit: 7, callback: (v) => comma(v) }, title: { display: true, text: `가격 (${unit})`, color: text } },
        y: { grid: { color: grid }, border: { display: false }, ticks: { color: text, maxTicksLimit: 5, callback: tick }, ...extra },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: (items) => `${comma(items[0].raw.x)} ${unit}`,
            label: (item) => {
              const p = item.raw.p;
              return [`BM 기대 매출 ${won(p.bmSpend)}`, `유저 절감률 ${fmtPct(p.saving, 1)}`, `정책 투입 ${comma(p.policyUnits)}개 · 기대 구매 ${fmtNum(p.units, 1)}개`];
            },
          },
        },
      },
    },
    plugins: [marks(hLine)],
  });
  const savings = r.points.map(p => p.saving * 100);
  ctx.sweepCharts.push(
    chart(els.sweepRev, cssVar('--series-1'), (p) => toDisplay(p.bmSpend), (v) => fmtMoneyShort(v), null, { beginAtZero: true }),
    chart(els.sweepSave, cssVar('--series-2'), (p) => p.saving * 100, (v) => `${v}%`, r.goal * 100,
      { suggestedMin: Math.min(r.goal * 100, ...savings) - 2, suggestedMax: Math.max(r.goal * 100, ...savings) + 2 }),
  );
}

// ── 목표 비용 역산 ──────────────────────────────────────
export function renderInverse(ctx, els, res) {
  const s = ctx.state;
  const inv = s.inverse ??= { target: Math.round(res.expCost * 0.8), from: s.start, to: s.target - 1 };
  // 목표 비용은 표시 단위로 입력받고 원으로 저장
  const money = (key) => key === 'target';
  const num = (key, label) => h('label.field', {}, h('span', {}, label), h('input', {
    type: 'number', value: money(key) ? Math.round(toDisplay(inv[key])) : inv[key], step: 'any', 'aria-label': label,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { inv[key] = money(key) ? fromDisplay(v) : v; ctx.save(); } },
  }));
  els.inverse.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '목표 비용 역산'), h('span.hint', {}, '확률 자동 조정')),
    h('p.muted.small', {}, '원하는 기대 총비용을 넣으면, 지정한 구간의 성공·대성공 확률에 같은 배율을 곱해 그 비용이 되는 값을 찾습니다(이분 탐색). 실패 결과의 비율은 유지됩니다.'),
    h('div.row3', {}, num('target', `목표 기대 비용 (${currency().name})`), num('from', '구간 시작'), num('to', '구간 끝')),
    h('div', {}, h('button.btn.primary', { type: 'button', onclick: () => runInverse(ctx, els) }, '역산')),
    els.invOut = h('div', {}),
  );
}

function runInverse(ctx, els) {
  const s = ctx.state, inv = s.inverse;
  const res = solveForCost(ctx.toConfig(), inv.target, inv.from, inv.to);
  if (!res.ok) { els.invOut.replaceChildren(h('p', { style: 'color:var(--bad)' }, res.error)); return; }
  els.invOut.replaceChildren(h('div.opt-result', {},
    h('p', {}, `+${inv.from}~+${inv.to} 성공률 `, h('b', {}, `×${res.alpha.toFixed(4)}`), ' → 기대 총비용 ', h('b', {}, won(res.cost))),
    h('button.btn', {
      type: 'button',
      onclick: () => {
        if (!s.baseline) ctx.saveBaseline('역산 전');
        s.rows = res.rows; ctx.markTableDirty(); ctx.recompute();
        toast('조정된 확률을 표에 적용했습니다 (적용 전 상태는 기준안으로 저장)');
      },
    }, '표에 적용'),
  ));
}
