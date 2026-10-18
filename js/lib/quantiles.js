// 분위수 표·그래프 — 강화·가챠가 같이 쓴다. "100명 중 몇 명이 이 안에 달성하나"를 0.1% ~ 99.9%로 펼쳐 보여준다.
// 계산 부분(PCTS, quantile, pctDesc)은 DOM 없이 테스트에서도 쓴다.
import { h } from './util.js';
import { drawChart } from './chart.js';

/** 보여줄 분위: 누적 비율 p = 이 값 안에 달성하는 유저 비율 */
export const PCTS = [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 0.999];

/** 정렬된 표본의 p 분위 (표본의 ⌈p·n⌉번째 값 — 이 값 이하가 p 이상) */
export function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}
export const quantiles = (sorted) => PCTS.map(p => quantile(sorted, p));

const num = (x) => +x.toPrecision(6);
export const pctLabel = (p) => `${num(p * 100)}%`;

/** 분위의 뜻: 0.1% → 1,000명 중 가장 운 좋은 1명, 90% → 운 나쁜 10% 경계, 99.9% → 1,000명 중 가장 운 나쁜 1명 */
export function pctDesc(p) {
  const n = (x) => Math.round(x).toLocaleString('ko-KR');
  if (p === 0.5) return '중앙값 — 절반이 이 안에 달성';
  if (p <= 0.01) return `${n(1 / p)}명 중 가장 운 좋은 1명`;
  if (p < 0.5) return `운 좋은 ${num(p * 100)}%`;
  if (p >= 0.99) return `${n(1 / (1 - p))}명 중 가장 운 나쁜 1명 (상위 ${num((1 - p) * 100)}%)`;
  return `운 나쁜 ${num((1 - p) * 100)}% 경계 (상위 ${num((1 - p) * 100)}%)`;
}

/** 시뮬레이션 꼬리 신뢰도: 가장 바깥 분위가 표본 몇 개로 정해지나 */
export const tailSamples = (n) => Math.floor(n * Math.min(PCTS[0], 1 - PCTS.at(-1)));

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/**
 * 분위수 카드를 host 안에 그린다.
 * metrics: [{ id, label, values (PCTS 순서), mean, fmt(v) — 표·툴팁, short(v) — 축 눈금 }]
 * selected: 그래프에 그릴 지표 id, onSelect(id): 탭 전환
 * 표는 모든 지표를 한 번에 — 각 열은 그 지표만의 분위라서 같은 줄이 같은 유저는 아니다.
 */
export function renderQuantileCard(host, { title = '달성 분위별 수치', hint = '', metrics, selected, onSelect, note }) {
  const cur = metrics.find(m => m.id === selected) ?? metrics[0];
  const canvas = h('canvas', { role: 'img', 'aria-label': `${cur.label} 분위별 값 막대 그래프 (표로도 제공)` });
  host.replaceChildren(
    h('div.card-head', {}, h('h2', {}, title), h('span.hint', {}, hint)),
    metrics.length > 1 ? h('div.seg-tabs', {}, ...metrics.map(m => h('button', { type: 'button', 'aria-pressed': String(m.id === cur.id), onclick: () => onSelect(m.id) }, m.label))) : null,
    h('div.chart-box', {}, canvas),
    h('div.table-wrap', {}, h('table.stages.q-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '분위'), h('th.left', {}, '뜻'), ...metrics.map(m => h('th', {}, m.label)))),
      h('tbody', {},
        ...PCTS.map((p, i) => h(`tr${p === 0.5 ? '.q-mid' : ''}`, {},
          h('td', {}, pctLabel(p)), h('td.left.muted', {}, pctDesc(p)),
          ...metrics.map(m => h(`td${m.id === cur.id ? '.q-sel' : ''}`, {}, m.fmt(m.values[i]))))),
        h('tr.q-mean', {}, h('td', {}, '평균'), h('td.left.muted', {}, '기대값 — 꼬리 때문에 보통 중앙값보다 큼'), ...metrics.map(m => h(`td${m.id === cur.id ? '.q-sel' : ''}`, {}, m.fmt(m.mean)))),
      ),
    )),
    h('p.muted.small.q-note', {}, '각 열은 그 지표만의 분위입니다 (같은 줄이 같은 유저는 아님).', note ? ` ${note}` : ''),
  );
  drawQuantileChart(host, canvas, cur);
}

function drawQuantileChart(host, canvas, m) {
  const bar = cssVar('--series-1'), grid = cssVar('--grid'), tick = cssVar('--text-3'), ink = cssVar('--text-2');
  const meanLine = {
    id: 'qMean',
    afterDatasetsDraw(c) {
      if (!Number.isFinite(m.mean)) return;
      const { ctx: g, chartArea: a, scales: { y } } = c;
      const py = y.getPixelForValue(m.mean);
      if (py < a.top || py > a.bottom) return;
      g.save();
      g.strokeStyle = ink; g.setLineDash([4, 4]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(a.left, py); g.lineTo(a.right, py); g.stroke();
      g.fillStyle = ink; g.font = '600 11px Pretendard Variable, system-ui, sans-serif'; g.textAlign = 'left';
      g.fillText(`평균 ${m.fmt(m.mean)}`, a.left + 6, py - 5);
      g.restore();
    },
  };
  drawChart(`quant:${host.closest('[role=tabpanel]')?.id ?? host.id}`, canvas, {
    type: 'bar',
    data: { labels: PCTS.map(pctLabel), datasets: [{ label: m.label, data: m.values.map(v => (Number.isFinite(v) ? v : null)), backgroundColor: bar, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 44 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { color: tick }, title: { display: true, text: '누적 유저 비율 (이 안에 달성)', color: tick } },
        y: { beginAtZero: true, grid: { color: grid }, ticks: { color: tick, callback: (v) => (m.short ?? m.fmt)(v) } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: (it) => `${it[0].label} · ${pctDesc(PCTS[it[0].dataIndex])}`, label: (it) => `${m.label}: ${m.fmt(it.raw)}` } },
      },
    },
    plugins: [meanLine],
  });
}
