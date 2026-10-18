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
