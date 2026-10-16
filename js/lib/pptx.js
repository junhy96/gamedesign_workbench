// PowerPoint 내보내기 공통: PptxGenJS 지연 로드 + 도형 사양(spec) 렌더 + SVG → 편집 가능한 도형 변환
// 모든 좌표는 인치. 와이드 슬라이드(13.333 × 7.5in).

const PPTX_URL = 'https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js';
export const SLIDE = { w: 13.333, h: 7.5 };
export const FONT = 'Malgun Gothic';

let loading;
export function loadPptx() {
  if (globalThis.PptxGenJS) return Promise.resolve(globalThis.PptxGenJS);
  loading ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: PPTX_URL, async: true });
    s.onload = () => resolve(globalThis.PptxGenJS);
    s.onerror = () => { loading = null; reject(new Error('PowerPoint 라이브러리를 불러오지 못했습니다.')); };
    document.head.append(s);
  });
  return loading;
}

/** 새 프레젠테이션. build(pptx)로 슬라이드를 채우고 반환. */
export async function createDeck(title) {
  const P = await loadPptx();
  const pptx = new P();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = title;
  pptx.company = '기획 워크벤치';
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  return pptx;
}

const hex = (c) => (c || '000000').replace('#', '').toUpperCase();

/**
 * 도형 사양 배열을 슬라이드에 그린다.
 * spec: { type:'rect'|'roundRect'|'ellipse'|'diamond'|'text'|'path'|'line'|'table', x,y,w,h, fill?, line?, lineWidth?, dash?, text?, fontSize?, fontFace?, color?, bold?, align?, valign?, charSpacing?, points?, arrowEnd?, arrowStart?, name? }
 *   dash: true(파선) 또는 PowerPoint 선 종류 이름('sysDot' 등)
 *   text: 문자열('
'은 줄바꿈) 또는 [{ text, options }] 런 배열
 *   line: 직선 연결선(x,y → x+w,y+h)
 *   table: { colW:[], rowH:[], rows:[[{ text, fill?, color?, fontFace?, fontSize?, bold?, align?, colspan? }]], border?, borderWidth? }
 */
export function renderSpecs(pptx, slide, specs) {
  const lineOf = (s) => (s.line ? {
    color: hex(s.line), width: s.lineWidth ?? 0.75, dashType: typeof s.dash === 'string' ? s.dash : s.dash ? 'dash' : 'solid',
    endArrowType: s.arrowEnd ? 'triangle' : undefined, beginArrowType: s.arrowStart ? 'triangle' : undefined,
  } : { type: 'none' });
  const textOpts = (s, color) => ({
    fontFace: s.fontFace ?? FONT, fontSize: s.fontSize ?? 10, color: hex(s.color ?? color), bold: !!s.bold,
    ...(s.charSpacing != null && { charSpacing: s.charSpacing }),
  });
  for (const s of specs) {
    const line = lineOf(s);
    const fill = s.fill ? { color: hex(s.fill), transparency: s.transparency ?? 0 } : { type: 'none' };
    const common = { x: s.x, y: s.y, w: Math.max(s.w, 0.001), h: Math.max(s.h, 0.001), objectName: s.name };
    if (s.type === 'text') {
      slide.addText(s.text, {
        ...common, ...textOpts(s, '#222222'), isTextBox: true,
        align: s.align ?? 'left', valign: s.valign ?? 'middle', margin: s.margin ?? 0, fit: 'none', wrap: s.wrap ?? false,
        fill: s.fill ? fill : undefined, line: s.line ? line : undefined,
      });
    } else if (s.type === 'line') {
      slide.addShape(pptx.ShapeType.line, { x: s.x, y: s.y, w: s.w, h: s.h, objectName: s.name, line });
    } else if (s.type === 'table') {
      const border = { type: 'solid', pt: s.borderWidth ?? 1, color: hex(s.border ?? '#000000') };
      const rows = s.rows.map(r => r.map(c => ({
        text: c.text ?? '',
        options: {
          ...textOpts(c, '#000000'), fill: { color: hex(c.fill ?? '#FFFFFF') }, align: c.align ?? 'center', valign: 'middle',
          ...(c.colspan > 1 && { colspan: c.colspan }), border: [border, border, border, border],
        },
      })));
      slide.addTable(rows, { x: s.x, y: s.y, w: s.w, colW: s.colW, rowH: s.rowH, margin: s.cellMargin ?? [0.015, 0.07, 0.015, 0.08], objectName: s.name });
    } else if (s.type === 'path') {
      slide.addShape(pptx.ShapeType.custGeom, { ...common, points: s.points, fill, line });
    } else {
      const shape = { rect: pptx.ShapeType.rect, roundRect: pptx.ShapeType.roundRect, ellipse: pptx.ShapeType.ellipse, diamond: pptx.ShapeType.diamond }[s.type] ?? pptx.ShapeType.rect;
      const opts = { ...common, fill, line };
      if (s.type === 'roundRect') opts.rectRadius = s.radius ?? 0.06;
      if (s.text != null) Object.assign(opts, textOpts(s, '#FFFFFF'), { align: s.align ?? 'center', valign: 'middle', margin: s.margin ?? 0 });
      if (s.text != null) slide.addText(s.text, { ...opts, shape });
      else slide.addShape(shape, opts);
    }
  }
}

// ── SVG → 도형 ──────────────────────────────────────────
// 화면에 그려진 SVG(문서에 붙어 있어야 함)의 요소를 하나씩 읽어 PowerPoint 기본 도형으로 바꾼다.
//   rect → 사각형/둥근 사각형, circle·ellipse → 타원, path·polygon·polyline·line → 사용자 지정 도형(점 샘플링)
//   marker-end가 있는 선 → 화살표 끝, text·foreignObject → 텍스트 상자
// box: 슬라이드에서 그릴 영역 {x,y,w,h} (인치). 비율을 유지해 맞춘다.

const SKIP_PARENTS = 'defs, marker, clipPath, mask, pattern, symbol, style, title';

function parseColor(v) {
  if (!v || v === 'none' || v === 'transparent') return null;
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (a === 0) return null;
    return { hex: [r, g, b].map(n => Math.round(n).toString(16).padStart(2, '0')).join(''), alpha: a };
  }
  if (v.startsWith('#')) return { hex: v.length === 4 ? v.slice(1).split('').map(c => c + c).join('') : v.slice(1, 7), alpha: 1 };
  return null;
}

function visible(el) {
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity !== 0;
}

/** 요소 → 루트 SVG 좌표 변환 행렬 */
function toRoot(svg, el) {
  const a = svg.getScreenCTM(), b = el.getScreenCTM();
  return a && b ? a.inverse().multiply(b) : el.getCTM();
}
const apply = (m, x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });

function samplePath(el, m) {
  const len = el.getTotalLength();
  if (!(len > 0)) return [];
  // 직선 위주의 경로(화살표·테두리)는 꼭짓점만, 곡선은 길이에 비례해 샘플링
  const d = el.getAttribute('d') || '';
  const curvy = /[CcSsQqTtAa]/.test(d);
  const n = curvy ? Math.min(64, Math.max(8, Math.round(len / 6))) : 0;
  if (!curvy) {
    const pts = [];
    const cmds = d.match(/[MLHVZmlhvz][^MLHVZmlhvz]*/g) || [];
    let cx = 0, cy = 0, sx = 0, sy = 0;
    for (const c of cmds) {
      const t = c[0], nums = (c.slice(1).match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
      const rel = t === t.toLowerCase();
      if (t === 'Z' || t === 'z') { cx = sx; cy = sy; pts.push({ x: cx, y: cy, close: true }); continue; }
      if (/[Hh]/.test(t)) { for (const v of nums) { cx = rel ? cx + v : v; pts.push({ x: cx, y: cy }); } continue; }
      if (/[Vv]/.test(t)) { for (const v of nums) { cy = rel ? cy + v : v; pts.push({ x: cx, y: cy }); } continue; }
      for (let i = 0; i + 1 < nums.length; i += 2) {
        cx = rel ? cx + nums[i] : nums[i]; cy = rel ? cy + nums[i + 1] : nums[i + 1];
        const move = (t === 'M' || t === 'm') && i === 0;
        if (move) { sx = cx; sy = cy; }
        pts.push({ x: cx, y: cy, move });
      }
    }
    return pts.map(p => ({ ...apply(m, p.x, p.y), move: p.move, close: p.close }));
  }
  const out = [];
  for (let i = 0; i <= n; i++) { const p = el.getPointAtLength((len * i) / n); out.push(apply(m, p.x, p.y)); }
  if (/[Zz]\s*$/.test(d)) out.push({ ...out[0], close: true });
  return out;
}

function textLines(el) {
  const outer = el.querySelectorAll(':scope > tspan');
  if (outer.length > 1) {
    // 같은 줄(y가 같은) tspan은 이어 붙이고, 줄이 바뀌면 개행
    const lines = []; let lastY = null;
    for (const t of outer) {
      const y = t.getAttribute('y') ?? t.getAttribute('dy');
      const s = t.textContent;
      if (lines.length && (y == null || y === lastY)) lines[lines.length - 1] += s; else lines.push(s);
      lastY = y;
    }
    return lines.filter(l => l.trim()).join('\n');
  }
  return el.textContent.trim();
}

/** SVG를 분석해 루트 좌표의 도형 목록을 만든다 (렌더 전 단계, 크기 맞춤 전). */
export function collectSvgShapes(svg) {
  const shapes = [];
  for (const el of svg.querySelectorAll('rect, circle, ellipse, path, polygon, polyline, line, text, foreignObject')) {
    const tagName = el.tagName.toLowerCase();
    if (el.closest(SKIP_PARENTS) || (tagName !== 'text' && el.closest('text')) || (tagName !== 'foreignobject' && el.closest('foreignObject'))) continue;
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const m = toRoot(svg, el);
    const fill = parseColor(cs.fill), stroke = parseColor(cs.stroke);
    const strokeW = parseFloat(cs.strokeWidth) || 0;
    const fillOpacity = (+cs.fillOpacity || 1) * (fill?.alpha ?? 1);
    const base = { fill: fill && fillOpacity > 0.01 ? fill.hex : null, fillAlpha: fillOpacity, stroke: stroke && strokeW > 0 ? stroke.hex : null, strokeW, dash: (cs.strokeDasharray.match(/[\d.]+/g) || []).some(v => +v > 0) }; // "none"이나 "0"은 실선
    const tag = el.tagName.toLowerCase();

    if (tag === 'text' || tag === 'foreignobject') {
      const txt = tag === 'text' ? textLines(el) : el.textContent.trim();
      if (!txt) continue;
      const bb = el.getBBox();
      const p1 = apply(m, bb.x, bb.y), p2 = apply(m, bb.x + bb.width, bb.y + bb.height);
      const inner = tag === 'foreignobject' ? (el.querySelector('span, div, p') || el) : el;
      const ics = getComputedStyle(inner);
      const anchor = tag === 'text' ? cs.textAnchor : 'middle';
      shapes.push({
        kind: 'text', text: txt, x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y),
        fontPx: (parseFloat(ics.fontSize) || 14) * Math.hypot(m.a, m.b), color: (parseColor(tag === 'text' ? cs.fill : ics.color) || { hex: '333333' }).hex,
        bold: (+ics.fontWeight || 400) >= 600, align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
      });
      continue;
    }
    if (!base.fill && !base.stroke) continue;

    if (tag === 'rect') {
      const w = +el.getAttribute('width') || el.getBBox().width, h = +el.getAttribute('height') || el.getBBox().height;
      if (!(w > 0 && h > 0)) continue;
      const x = +el.getAttribute('x') || 0, y = +el.getAttribute('y') || 0;
      const corners = [apply(m, x, y), apply(m, x + w, y), apply(m, x + w, y + h), apply(m, x, y + h)];
      const axis = Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6;
      if (axis) {
        const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
        const rx = +el.getAttribute('rx') || 0;
        shapes.push({ ...base, kind: rx > 0 ? 'roundRect' : 'rect', x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), rx: rx * Math.hypot(m.a, m.b) });
      } else {
        shapes.push({ ...base, kind: 'path', pts: [...corners, { ...corners[0], close: true }] });
      }
    } else if (tag === 'circle' || tag === 'ellipse') {
      const bb = el.getBBox();
      const p1 = apply(m, bb.x, bb.y), p2 = apply(m, bb.x + bb.width, bb.y + bb.height);
      shapes.push({ ...base, kind: 'ellipse', x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) });
    } else {
      let pts;
      if (tag === 'line') pts = [apply(m, +el.getAttribute('x1'), +el.getAttribute('y1')), apply(m, +el.getAttribute('x2'), +el.getAttribute('y2'))];
      else if (tag === 'polygon' || tag === 'polyline') {
        pts = [...el.points].map(p => apply(m, p.x, p.y));
        if (tag === 'polygon' && pts.length) pts.push({ ...pts[0], close: true });
      } else pts = samplePath(el, m);
      if (pts.length < 2) continue;
      const markerEnd = (el.getAttribute('marker-end') || cs.markerEnd || 'none') !== 'none';
      const markerStart = (el.getAttribute('marker-start') || cs.markerStart || 'none') !== 'none';
      shapes.push({ ...base, kind: 'path', pts, arrowEnd: markerEnd, arrowStart: markerStart, fill: pts.some(p => p.close) ? base.fill : null });
    }
  }
  return shapes;
}

/** 수집한 도형을 box 영역에 비율 유지로 맞춰 렌더용 사양으로 변환 */
export function fitShapes(shapes, box) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const s of shapes) {
    if (s.kind === 'path') s.pts.forEach(p => grow(p.x, p.y));
    else { grow(s.x, s.y); grow(s.x + s.w, s.y + s.h); }
  }
  if (!Number.isFinite(x0)) return [];
  const k = Math.min(box.w / Math.max(1e-6, x1 - x0), box.h / Math.max(1e-6, y1 - y0)); // 인치 / SVG 단위
  const ox = box.x + (box.w - (x1 - x0) * k) / 2, oy = box.y + (box.h - (y1 - y0) * k) / 2;
  const X = (x) => ox + (x - x0) * k, Y = (y) => oy + (y - y0) * k;
  const lw = (w) => Math.max(0.25, w * k * 72); // pt
  return shapes.map(s => {
    const line = s.stroke ? `#${s.stroke}` : null, fill = s.fill ? `#${s.fill}` : null;
    const transparency = s.fill ? Math.round((1 - Math.min(1, s.fillAlpha)) * 100) : 0;
    if (s.kind === 'text') {
      const pad = 0.04;
      return { type: 'text', text: s.text, x: X(s.x) - pad, y: Y(s.y) - pad / 2, w: s.w * k + pad * 2, h: s.h * k + pad, fontSize: Math.max(5, +(s.fontPx * k * 72).toFixed(1)), color: `#${s.color}`, bold: s.bold, align: s.align };
    }
    if (s.kind === 'path') {
      let px0 = Infinity, py0 = Infinity, px1 = -Infinity, py1 = -Infinity;
      s.pts.forEach(p => { px0 = Math.min(px0, p.x); py0 = Math.min(py0, p.y); px1 = Math.max(px1, p.x); py1 = Math.max(py1, p.y); });
      const points = s.pts.map((p, i) => (p.close ? { close: true } : { x: (p.x - px0) * k, y: (p.y - py0) * k, moveTo: i === 0 || p.move }));
      return { type: 'path', x: X(px0), y: Y(py0), w: (px1 - px0) * k, h: (py1 - py0) * k, points, fill, transparency, line, lineWidth: lw(s.strokeW), dash: s.dash, arrowEnd: s.arrowEnd, arrowStart: s.arrowStart };
    }
    return { type: s.kind, x: X(s.x), y: Y(s.y), w: s.w * k, h: s.h * k, fill, transparency, line, lineWidth: lw(s.strokeW), dash: s.dash, radius: s.kind === 'roundRect' ? Math.min(s.rx * k, (Math.min(s.w, s.h) * k) / 2) : undefined }; // rectRadius는 인치
  });
}
