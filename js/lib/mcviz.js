// 몬테카를로 시각화 공용 — 수렴 그래프(시뮬레이션 횟수에 따른 누적 평균과 95% 범위). 계산 부분은 DOM 없음.
import { drawChart, dropChart } from './chart.js';

/** 로그 간격 체크포인트 (1 … n, 대략 points개) */
export function checkpoints(n, points = 48) {
  const out = new Set();
  for (let k = 0; k < points; k++) out.add(Math.max(1, Math.round(Math.exp(Math.log(n) * k / (points - 1)))));
  out.add(n);
  return [...out].sort((a, b) => a - b);
}

/**
 * 시행 순서대로의 값 → 누적 평균과 95% 범위. binary면 0/1 값(승률)이라 Wilson 범위, 아니면 평균 ± 1.96 × 표준오차.
 * 반환 [{ n, mean, lo, hi }]
 */
export function convergence(values, { binary = false, points = 48 } = {}) {
  const n = values.length;
  if (!n) return [];
  const cps = checkpoints(n, points);
  const out = [];
  let s = 0, s2 = 0, k = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) return null; // 끝나지 않은 시행이 있으면 평균이 없음
    s += v; s2 += v * v;
    if (i + 1 === cps[k]) {
      const m = i + 1, mean = s / m;
      if (binary) {
        const z = 1.96, z2 = z * z, den = 1 + z2 / m, mid = (mean + z2 / (2 * m)) / den, half = z * Math.sqrt(mean * (1 - mean) / m + z2 / (4 * m * m)) / den;
        out.push({ n: m, mean, lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) });
      } else {
        const sd = m > 1 ? Math.sqrt(Math.max(0, (s2 - m * mean * mean) / (m - 1))) : 0, se = sd / Math.sqrt(m);
        out.push({ n: m, mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se });
      }
      k++;
    }
  }
  return out;
}

// ── 그리기 ──────────────────────────────────────────────
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const rgba = (hex, a) => { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim()); return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})` : hex; };

/**
 * 수렴 그래프. series = convergence() 결과, exact = 공식 계산값(없으면 null), fmt = 값 표시, label = 지표 이름
 * 가로축은 시뮬레이션 횟수(로그), 띠 = 그 횟수까지의 95% 범위, 점선 = 공식 계산값
 */
export function drawConvergence(canvas, { series, exact = null, fmt = (v) => String(v), label = '누적 평균', color, key = `conv:${canvas.closest('[role=tabpanel]')?.id}` } = {}) {
  if (!series?.length) { dropChart(key); return; }
  const main = color || cssVar('--series-1'), grid = cssVar('--grid'), tick = cssVar('--text-3'), ink = cssVar('--text-2');
  const pts = (key) => series.map(p => ({ x: p.n, y: p[key] }));
  const datasets = [
    { label: '95% 범위', data: pts('hi'), borderWidth: 0, pointRadius: 0, fill: false, band: true },
    { label: '95% 범위', data: pts('lo'), borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: rgba(main, 0.16), band: true },
    { label, data: pts('mean'), borderColor: main, backgroundColor: main, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 },
  ];
  if (Number.isFinite(exact)) datasets.push({ label: '공식 계산값', data: [{ x: series[0].n, y: exact }, { x: series.at(-1).n, y: exact }], borderColor: ink, borderDash: [5, 4], borderWidth: 1.25, pointRadius: 0 });
  drawChart(key, canvas, {
    type: 'line', data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false,
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      scales: {
        x: { type: 'logarithmic', min: series[0].n, max: series.at(-1).n, grid: { color: grid }, ticks: { color: tick, callback: (v) => ([1, 10, 100, 1000, 10000, 100000].includes(v) ? v.toLocaleString('ko-KR') : '') }, title: { display: true, text: '시뮬레이션 횟수 (로그 축)', color: tick } },
        y: { grid: { color: grid }, ticks: { color: tick, callback: (v) => fmt(v) } },
      },
      plugins: {
        legend: { labels: { color: ink, boxWidth: 14, boxHeight: 2, filter: (it, data) => !data.datasets[it.datasetIndex].band || it.datasetIndex === 1 } },
        tooltip: { filter: (it) => !it.dataset.band, callbacks: { title: (it) => `${it[0].raw.x.toLocaleString('ko-KR')}회까지`, label: (it) => `${it.dataset.label}: ${fmt(it.raw.y)}` } },
      },
    },
  });
}

/** 마지막 체크포인트의 95% 범위 폭 → "± 값" 문장용 */
export const halfWidth = (series) => (series?.length ? (series.at(-1).hi - series.at(-1).lo) / 2 : NaN);
