// 결과 영역: KPI(기준안 대비)·고정 띠, 분포·예산, 재화별 소모, 검증, 아이템 최적화(MDP), 목표 비용 역산
import { optimizeItems, solveForCost } from './model.js';
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
    h('p.muted.small', {}, '상태(단계 × 연속 카운터)마다 어떤 아이템 조합을 쓸지 골라 기대 총비용을 최소화합니다. 아이템 가격이 적정한지, 유저가 합리적으로 쓰면 어디서 얼마나 팔리는지 확인하는 용도입니다.'),
    h('div', {}, ctx.state.items.length
      ? h('button.btn.primary', { type: 'button', onclick: () => runOptimizer(ctx, els) }, '최적 정책 계산')
      : h('p.muted.small', {}, '설계 입력에서 보조 아이템을 먼저 추가하세요.')),
    els.optOut = h('div', {}),
  );
}

function runOptimizer(ctx, els) {
  const res = optimizeItems(ctx.toConfig());
  if (!res.ok) { els.optOut.replaceChildren(h('ul.errors', {}, ...res.errors.map(e => h('li', {}, e)))); return; }
  const names = new Map(ctx.state.items.map(it => [it.id, it.name]));
  const entries = Object.entries(res.usage).sort((a, b) => a[0] - b[0]);
  const saving = res.before > 0 ? 1 - res.after / res.before : 0;
  els.optOut.replaceChildren(h('div.opt-result', {},
    h('p', {}, '기대 총비용 ', h('b', {}, won(res.before)), ' → ', h('b', {}, won(res.after)),
      saving > 1e-4 ? h('span.saving', {}, ` (${(saving * 100).toFixed(1)}% 절감)`) : ' (현재 설정이 최적)',
      h('span.muted', {}, ` · 정책 반복 ${res.iterations}회`)),
    entries.length ? h('ul.policy', {}, ...entries.map(([stage, u]) => h('li', {},
      h('b', {}, `+${stage}`),
      Array.isArray(u) ? u.map(id => names.get(id)).join(' + ') : describeByCounter(u, names),
    ))) : h('p.muted', {}, '아이템을 쓰지 않는 것이 최적입니다 (가격 대비 효과가 낮음).'),
    h('button.btn', { type: 'button', onclick: () => { ctx.state.usage = res.usage; ctx.markTableDirty(); ctx.recompute(); toast('최적 정책을 적용했습니다'); } }, '이 정책 적용'),
  ));
}

function describeByCounter(u, names) {
  // 카운터별 사용 목록을 '연속 n회 이상부터 X' 형태로 요약
  const ids = [...new Set(u.byCounter.flat())];
  return ids.map(id => {
    const first = u.byCounter.findIndex(a => a.includes(id));
    const always = u.byCounter.every(a => a.includes(id));
    return always ? names.get(id) : `${names.get(id)} (연속 ${first}회부터)`;
  }).join(' + ') || '사용 안 함';
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
