// 아치형 게이지: 270° 호(왼쪽 아래 → 위 → 오른쪽 아래) 위에 값만큼 키 그라데이션을 채우고 끝에 글로우 점을 찍는다.
// 가운데에 큰 가는 숫자, 아래에 작은 라벨. 승률 행렬 칸(작게)과 1:1 상세(크게)가 쓴다.
// value = 0~1, tone = 'key'(이김·좋음) | 'steel'(짐·나쁨) | 'muted'
const NS = 'http://www.w3.org/2000/svg';
let seq = 0;
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};
const START = 135, SWEEP = 270;
const pt = (cx, cy, r, deg) => { const a = (deg * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
function arcPath(cx, cy, r, from, to) {
  const [x0, y0] = pt(cx, cy, r, from), [x1, y1] = pt(cx, cy, r, to);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * @param {number} value 0~1
 * @param {{ size?: number, stroke?: number, text?: string, label?: string, sub?: string, tone?: 'key'|'steel'|'muted', title?: string }} o
 */
export function arcGauge(value, o = {}) {
  const size = o.size ?? 120, sw = o.stroke ?? Math.max(3, Math.round(size / 14)), tone = o.tone ?? 'key';
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const c = size / 2, r = c - sw / 2 - (size >= 80 ? 4 : 1.5);
  const id = `gg${++seq}`;
  const end = START + SWEEP * v;
  const big = size >= 80;
  const stops = tone === 'key'
    ? [['0', 'var(--key-1)'], ['.55', 'var(--key-2)'], ['1', 'var(--key-3)']]
    : tone === 'steel' ? [['0', 'color-mix(in srgb, var(--tor-down) 60%, white)'], ['1', 'var(--tor-down)']] : [['0', 'var(--text-3)'], ['1', 'var(--text-3)']];
  const svg = el('svg', { class: `gauge gauge-${tone}${big ? ' big' : ' mini'}`, viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': o.title ?? `${o.label ?? ''} ${o.text ?? ''}`.trim() },
    el('defs', {}, el('linearGradient', { id, x1: '0', y1: '0', x2: '1', y2: '1' }, ...stops.map(([off, col]) => el('stop', { offset: off, 'stop-color': col })))),
    el('path', { class: 'gauge-track', d: arcPath(c, c, r, START, START + SWEEP), fill: 'none', 'stroke-width': sw, 'stroke-linecap': 'round' }),
    v > 0.001 ? el('path', { class: 'gauge-fill', d: arcPath(c, c, r, START, end), fill: 'none', stroke: `url(#${id})`, 'stroke-width': sw, 'stroke-linecap': 'round' }) : null,
  );
  if (v > 0.001 && tone === 'key') {
    const [ex, ey] = pt(c, c, r, end);
    svg.append(el('circle', { class: 'gauge-dot', cx: ex.toFixed(2), cy: ey.toFixed(2), r: big ? 3.5 : 2 }));
  }
  const text = o.text ?? `${(v * 100).toFixed(big ? 1 : 0)}%`;
  svg.append(el('text', { class: 'gauge-num', x: c, y: big ? c + size * 0.06 : c + size * 0.1, 'text-anchor': 'middle', 'font-size': big ? Math.round(size * 0.23) : Math.round(size * 0.27) }, text));
  if (o.label) svg.append(el('text', { class: 'gauge-label', x: c, y: big ? c + size * 0.22 : c + size * 0.36, 'text-anchor': 'middle', 'font-size': big ? Math.round(size * 0.085) : Math.round(size * 0.2) }, o.label));
  if (big && o.sub) svg.append(el('text', { class: 'gauge-sub', x: c, y: size - sw - 2, 'text-anchor': 'middle', 'font-size': Math.round(size * 0.075) }, o.sub));
  if (o.title) svg.prepend(el('title', {}, o.title));
  return svg;
}
