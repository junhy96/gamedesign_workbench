// 결과 분포 — 평균·중앙값·P10/P50/P90/P99와 히스토그램(백분위 위치를 세로선으로). 전투·강화·가챠가 같이 쓴다.
// 계산 부분(distStats, histogram)은 DOM 없이 테스트에서도 쓴다.
import { h, comma } from './util.js';
import { drawChart } from './chart.js';
import { quantile } from './quantiles.js';
import { label } from './tip.js';

export const DIST_PCTS = [0.1, 0.5, 0.9, 0.99];

/** 정렬된 표본 → { n, mean, median, p10, p50, p90, p99, min, max } */
export function distStats(sorted) {
  const n = sorted.length;
  if (!n) return { n: 0 };
  let s = 0; for (const x of sorted) s += x;
  const q = (p) => quantile(sorted, p);
  return { n, mean: s / n, median: q(0.5), p10: q(0.1), p50: q(0.5), p90: q(0.9), p99: q(0.99), min: sorted[0], max: sorted[n - 1] };
}

/**
 * 히스토그램 구간. 정수 값이고 종류가 적으면 값마다 한 칸, 아니면 bins칸 (위쪽 0.5% 꼬리는 마지막 칸에 모음).
 * 반환 { lo, w, counts, labels, integer }
 */
export function histogram(sorted, { bins = 24, integer } = {}) {
  const n = sorted.length;
  if (!n) return { lo: 0, w: 1, counts: [], labels: [] };
  const lo = sorted[0], hiFull = sorted[n - 1], hi = Math.max(lo, quantile(sorted, 0.995));
  integer ??= sorted.every(x => Number.isInteger(x));
  let w;
  if (integer && hi - lo + 1 <= 40) w = 1;
  else w = Math.max((hi - lo) / bins, integer ? 1 : 1e-9);
  if (integer) w = Math.ceil(w);
  const k = Math.max(1, Math.floor((hi - lo) / w) + 1);
  const counts = new Array(k).fill(0);
  for (const x of sorted) counts[Math.min(k - 1, Math.floor((x - lo) / w))]++;
  const fmt = (v) => (integer ? comma(v) : Number(v.toPrecision(3)).toLocaleString('ko-KR'));
  const labels = counts.map((_, i) => (w === 1 && integer ? fmt(lo + i) : `${fmt(lo + i * w)}~`));
  if (hiFull > hi) labels[k - 1] += '+';
  return { lo, w, counts, labels, integer };
}

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/**
 * 분포 카드 내용 그리기. el = 비어 있는 컨테이너(재사용 가능). key = 그래프 이름.
 * opts { unit: '턴', fmt: (v) => 문자열, title, hint, note }
 */
export function renderDist(el, key, sorted, { unit = '', fmt = (v) => comma(v), title = '결과 분포', hint = '', note = '' } = {}) {
  const st = distStats(sorted);
  if (!st.n) { el.replaceChildren(h('p.muted', {}, '표본이 없습니다.')); return st; }
  const cell = (lbl, v, tipKey) => h('div.dist-cell', {}, h('span', {}, ...(tipKey ? label(lbl, tipKey) : [lbl])), h('b', {}, `${fmt(v)}${unit}`));
  const canvas = h('canvas', { role: 'img', 'aria-label': `${title} 히스토그램` });
  el.replaceChildren(
    h('div.card-head', {}, h('h2', {}, ...label(title, 'dist.hist')), hint ? h('span.hint', {}, hint) : null),
    h('div.dist-row', {},
      cell('평균', st.mean, 'dist.mean'), cell('중앙값', st.median, 'dist.median'),
      cell('P10', st.p10, 'dist.pct'), cell('P50', st.p50), cell('P90', st.p90), cell('P99', st.p99)),
    h('div.chart-box', {}, canvas),
    note ? h('p.muted.small', {}, note) : '',
  );
  const hg = histogram(sorted);
  const marks = [['P10', st.p10], ['P50', st.p50], ['P90', st.p90], ['P99', st.p99]];
  const ink = cssVar('--text-2'), grid = cssVar('--grid'), tick = cssVar('--text-3'), bar = cssVar('--series-1') || '#2a78d6';
  const lines = {
    afterDatasetsDraw(c) {
      const xs = c.scales.x, area = c.chartArea, g = c.ctx;
      if (!xs || hg.counts.length < 1) return;
      const p0 = xs.getPixelForValue(0), per = hg.counts.length > 1 ? xs.getPixelForValue(1) - p0 : (area.right - area.left);
      g.save();
      g.font = '11px system-ui, sans-serif'; g.fillStyle = ink; g.strokeStyle = ink; g.setLineDash([4, 3]); g.lineWidth = 1;
      for (const [name, v] of marks) {
        const x = p0 + ((v - hg.lo) / hg.w - (hg.w === 1 && hg.integer ? 0 : 0.5)) * per;
        if (x < area.left - 1 || x > area.right + 1) continue;
        g.beginPath(); g.moveTo(x, area.top + 12); g.lineTo(x, area.bottom); g.stroke();
        g.fillText(name, Math.min(x + 3, area.right - 24), area.top + 10);
      }
      g.restore();
    },
  };
  drawChart(key, canvas, {
    type: 'bar',
    data: { labels: hg.labels, datasets: [{ data: hg.counts.map(c => c / st.n * 100), backgroundColor: bar, stipple: true, barPercentage: 1, categoryPercentage: 0.92 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { grid: { display: false }, ticks: { color: tick, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { grid: { color: grid }, ticks: { color: tick, callback: (v) => `${v}%` }, title: { display: true, text: '비율', color: tick } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (it) => `${it.raw.toFixed(1)}% (${comma(hg.counts[it.dataIndex])}회)` } } },
    },
    plugins: [lines],
  });
  return st;
}
