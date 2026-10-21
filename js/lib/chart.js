// 그래프 그리기 공용: 같은 그래프를 다시 그릴 때 새로 만들지 않고 값만 바꿔, 이전 값에서 새 값으로 움직이게 한다.
// key = 그래프 이름(화면이 다시 그려져 캔버스가 바뀌어도 같은 그래프로 이어 받기 위함).
// 캔버스가 바뀌었으면 새 캔버스에 이전 값으로 먼저 그린 뒤 새 값으로 움직인다.
const live = new Map();       // key → Chart
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const MOTION = { duration: 520, easing: 'easeOutQuart' };

// 그래프별 플러그인(점선·띠 등)은 바꿔 끼울 수 있게 한 플러그인으로 대신 부른다.
// 목록은 그래프를 만들기 전에 넣어 둔다 — 움직임이 꺼져 있으면 new Chart() 안에서 바로 첫 그림을 그리기 때문
const HOOKS = ['beforeDraw', 'afterDraw', 'beforeDatasetsDraw', 'afterDatasetsDraw'];
const relayFor = (holder) => Object.fromEntries([['id', 'liveRelay'], ...HOOKS.map(h => [h, (c, args, o) => { for (const p of holder.list) p[h]?.(c, args, o); }])]);
function create(canvas, type, data, options, plugins) {
  const holder = { list: plugins };
  const chart = new Chart(canvas, { type, data, options, plugins: [relayFor(holder)] });
  chart.$plugins = holder;
  return chart;
}

// 키 컬러 그라데이션: 대표 계열(--series-1)로 칠한 막대·선을 샌드 → 탄 → 브론즈(--key-1~3) 그라데이션으로 바꾼다.
// 막대는 아래(브론즈)에서 위(샌드)로, 선은 왼쪽(브론즈)에서 오른쪽(샌드)으로. 선 끝에는 노란 글로우 점(--glow).
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const norm = (c) => (typeof c === 'string' ? c.trim().toLowerCase() : '');
function keyGradient(stops, dir, fallback) {
  const cache = new WeakMap();
  return (ctx) => {
    const { chart } = ctx, a = chart.chartArea;
    if (!a) return fallback;
    const k = `${a.left},${a.top},${a.right},${a.bottom}`;
    const hit = cache.get(chart);
    if (hit?.k === k) return hit.g;
    const g = dir === 'x' ? chart.ctx.createLinearGradient(a.left, 0, a.right, 0) : chart.ctx.createLinearGradient(0, a.bottom, 0, a.top);
    g.addColorStop(0, stops[2]); g.addColorStop(0.55, stops[1]); g.addColorStop(1, stops[0]);
    cache.set(chart, { k, g });
    return g;
  };
}
function paintKey(config) {
  const key = norm(cssVar('--series-1'));
  const stops = ['--key-1', '--key-2', '--key-3'].map(cssVar);
  if (!key || stops.some(s => !s)) return;
  const across = config.options?.indexAxis === 'y' ? 'x' : 'y';
  for (const d of config.data?.datasets || []) {
    const type = d.type || config.type;
    if (type === 'bar' && norm(d.backgroundColor) === key) d.backgroundColor = keyGradient(stops, across, d.backgroundColor);
    else if (type === 'line' && norm(d.borderColor) === key) { d.borderColor = keyGradient(stops, 'x', d.borderColor); d.keyGlow = true; }
  }
}
// 점묘(stipple): 시뮬레이션 표본으로 만든 막대 분포는 막대 대신 점을 뿌린다 — 점 수 ∝ 막대 넓이(= 그 칸의 표본 비율),
// 점마다 밝기가 달라 레퍼런스의 "입구 분포"처럼 보인다. 데이터셋에 stipple: true 를 주면 막대 채움은 투명으로 두고 이 플러그인이 그린다.
// 같은 칸은 같은 난수열(칸 번호 시드)로 뿌려서 값이 바뀌어도 점이 튀지 않는다.
const hexRgb = (c) => { const m = /^#([0-9a-f]{6})$/i.exec((c || '').trim()); return m ? [1, 3, 5].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null; };
const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function dotPalette(color) {
  const key = norm(cssVar('--series-1'));
  if (norm(color) === key) {
    const k = ['--key-3', '--key-2', '--key-1'].map(n => hexRgb(cssVar(n)) || [200, 150, 100]);
    return [[0.33, rgba(k[0], 0.9)], [0.72, rgba(k[1], 0.95)], [0.92, rgba(k[2], 1)], [1, 'rgba(255,250,228,1)']];
  }
  const rgb = hexRgb(color);
  if (!rgb) return [[1, color]];
  return [[0.35, rgba(mix(rgb, [0, 0, 0], 0.3), 0.9)], [0.75, rgba(rgb, 0.95)], [0.93, rgba(mix(rgb, [255, 255, 255], 0.4), 1)], [1, 'rgba(255,250,228,1)']];
}
function prepStipple(config) {
  for (const d of config.data?.datasets || []) {
    if (!d.stipple || d.stippleColor) continue;
    d.stippleColor = d.backgroundColor;
    d.backgroundColor = 'rgba(0,0,0,0)'; d.hoverBackgroundColor = 'rgba(0,0,0,0)'; d.borderWidth = 0;
  }
}
const mulberry = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const stipple = {
  id: 'stipple',
  afterDatasetsDraw(chart) {
    const g = chart.ctx;
    chart.data.datasets.forEach((d, di) => {
      if (!d.stippleColor || !chart.isDatasetVisible(di)) return;
      const pal = dotPalette(typeof d.stippleColor === 'string' ? d.stippleColor : cssVar('--series-1'));
      const meta = chart.getDatasetMeta(di);
      const horiz = meta.data[0]?.horizontal;
      g.save();
      g.beginPath(); g.rect(chart.chartArea.left, chart.chartArea.top, chart.chartArea.right - chart.chartArea.left, chart.chartArea.bottom - chart.chartArea.top); g.clip();
      meta.data.forEach((bar, bi) => {
        const p = bar.getProps(['x', 'y', 'base', 'width', 'height'], true);
        const w = horiz ? Math.abs(p.base - p.x) : p.width, hgt = horiz ? p.height : Math.abs(p.base - p.y);
        if (!(w > 1) || !(hgt > 0.5)) return;
        const left = horiz ? Math.min(p.x, p.base) : p.x - p.width / 2, top = horiz ? p.y - p.height / 2 : Math.min(p.y, p.base);
        const n = Math.min(500, Math.max(1, Math.round((w * hgt) / 21)));
        const rnd = mulberry(di * 7919 + bi * 104729 + 1);
        for (let k = 0; k < n; k++) {
          const x = left + 1.2 + rnd() * Math.max(0, w - 2.4), y = top + 1.2 + rnd() * Math.max(0, hgt - 2.4), t = rnd();
          g.fillStyle = pal.find(([lim]) => t <= lim)[1];
          g.beginPath(); g.arc(x, y, 1.25, 0, Math.PI * 2); g.fill();
        }
      });
      g.restore();
    });
  },
};
const glowTip = {
  id: 'keyGlowTip',
  afterDatasetsDraw(chart) {
    const glow = cssVar('--glow');
    if (!glow) return;
    chart.data.datasets.forEach((d, i) => {
      if (!d.keyGlow || !chart.isDatasetVisible(i)) return;
      const pts = chart.getDatasetMeta(i).data.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && !p.skip);
      const p = pts.at(-1);
      if (!p) return;
      const g = chart.ctx;
      g.save();
      g.shadowColor = glow; g.shadowBlur = 12;
      g.fillStyle = glow; g.beginPath(); g.arc(p.x, p.y, 3.5, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0; g.fillStyle = '#fffbe0'; g.beginPath(); g.arc(p.x, p.y, 1.8, 0, Math.PI * 2); g.fill();
      g.restore();
    });
  },
};
let themed = false;
function theme() {
  if (!themed) { Chart.register(glowTip, stipple); themed = true; }
  const d = Chart.defaults;
  d.font.family = '"Pretendard Variable", Pretendard, system-ui, sans-serif';
  d.font.size = 11; d.font.weight = '400';
  d.color = cssVar('--text-3') || d.color;
  d.elements.bar.borderRadius = 1;
  d.plugins.legend.labels.boxWidth = 10; d.plugins.legend.labels.boxHeight = 6;
  d.borderColor = cssVar('--grid') || d.borderColor;
  const tip = d.plugins.tooltip;
  tip.backgroundColor = cssVar('--surface-2'); tip.titleColor = cssVar('--text'); tip.bodyColor = cssVar('--text-2');
  tip.borderColor = cssVar('--line-strong'); tip.borderWidth = 1; tip.cornerRadius = 4; tip.padding = 10;
}

const shapeOf = (cfg) => `${cfg.type}|${(cfg.data?.datasets || []).map(d => d.type || '').join(',')}`;

function setData(chart, data) {
  chart.data.labels = data.labels;
  const old = chart.data.datasets, next = data.datasets || [];
  // 같은 순번의 데이터셋 객체를 유지해야 막대·점이 제자리에서 움직인다
  chart.data.datasets = next.map((d, i) => {
    const o = old[i];
    if (!o) return d;
    for (const k of Object.keys(o)) if (!(k in d)) delete o[k];
    return Object.assign(o, d);
  });
}

/** 그리기 또는 갱신. 반환 Chart (Chart.js가 없으면 null) */
export function drawChart(key, canvas, config) {
  if (typeof Chart === 'undefined') return null;
  theme();
  prepStipple(config);
  paintKey(config);
  const motion = reduced() ? false : (config.options?.animation ?? MOTION);
  const options = { ...config.options, animation: motion };
  const plugins = config.plugins || [];
  const prev = key ? live.get(key) : null;
  // 캔버스가 문서에서 빠졌다 들어오면 Chart.js가 크기를 0으로 줄여 둘 수 있다 — 그런 그래프는 이어 쓰지 않고 새로 그린다
  const healthy = prev && prev.attached !== false && canvas.isConnected && prev.width > 0;
  if (prev && healthy && prev.canvas === canvas && shapeOf(prev.config) === shapeOf(config)) {
    prev.options = options;
    prev.$plugins.list = plugins;
    setData(prev, config.data);
    prev.update();
    return prev;
  }
  let from = null;
  if (prev) {
    if (shapeOf(prev.config) === shapeOf(config) && prev.data.datasets.length === config.data.datasets.length && motion) {
      from = { labels: prev.data.labels, datasets: prev.data.datasets.map(d => d.data) };
    }
    prev.destroy();
    live.delete(key);
  }
  Chart.getChart(canvas)?.destroy();
  let chart;
  if (from) {
    // 새 캔버스에 이전 값으로 먼저(움직임 없이) 그린 뒤 새 값으로 움직임
    const startData = { labels: from.labels, datasets: config.data.datasets.map((d, i) => ({ ...d, data: from.datasets[i] })) };
    chart = create(canvas, config.type, startData, { ...options, animation: false }, plugins);
    chart.options = options;
    setData(chart, config.data);
    chart.update();
  } else {
    chart = create(canvas, config.type, config.data, options, plugins);
  }
  if (key) live.set(key, chart);
  return chart;
}

/** 숨어 있던 탭이 보일 때: 그 안의 그래프 크기를 다시 맞추고 다시 그린다 */
export function refreshCharts(root) {
  if (typeof Chart === 'undefined') return;
  for (const cv of root.querySelectorAll('canvas')) {
    const c = Chart.getChart(cv);
    if (c) { c.resize(); c.update('none'); }
  }
}

/** 그래프 지우기 (오류 화면 등) */
export function dropChart(key) {
  live.get(key)?.destroy();
  live.delete(key);
}
