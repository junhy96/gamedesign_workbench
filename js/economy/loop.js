// 성장 루프 다이어그램 — 열 배치(① 생산 → ② 재화 → ③ 성장 → ④ 전투력)를 직접 계산해 그린다 (순수 계산 + SVG 문자열, DOM 없음)
//
// Mermaid 자동 배치는 묶음(subgraph) 사이를 오가는 선이 상자를 가로지르고, 같은 열 안의 교환 선·되먹임 선이 겹쳐 읽기 어려웠다.
//   · 열마다 노드 순서를 이웃 열 위치의 평균(무게중심)으로 몇 번 번갈아 정렬 → 선 교차를 줄인다
//   · 상점 교환은 내는 재화와 받는 재화 사이에 끼워 넣어 짧은 세로 화살표로 잇는다 (가로 선과 겹치지 않음)
//   · 노드 한 변에 선이 여러 개면 상대 노드 높이 순으로 접점을 나눠, 노드 근처에서 선이 꼬이지 않게 한다
//   · 전투력 → 콘텐츠 되먹임은 맨 위 전용 통로로 돌린다
//   · 색: 노드는 종류(콘텐츠·과금·재화·상점·성장·전투력), 재화를 나르는 선은 그 재화의 색 → 한 재화의 흐름을 눈으로 따라갈 수 있다
// SVG는 기본 도형(rect·path·text·marker)만 써서 PPT 도형 변환(lib/pptx.js collectSvgShapes)이 그대로 읽는다.

const C = (fill, stroke) => ({ fill, stroke });
export const LOOP_COLORS = {
  light: {
    text: '#1B1B1A', sub: '#5F5E5A', head: '#3B3A36', band: 0.45, labelBg: '#FFFFFF',
    content: C('#E6F0FC', '#2A78D6'), paid: C('#FBE6F4', '#B4308A'), shop: C('#F1F1EF', '#77756E'),
    growth: C('#E2F5EB', '#1A9E5C'), power: C('#E9E6F8', '#615BAE'),
    currency: [C('#FFF3D3', '#C98A00'), C('#FDE8DF', '#D9631E'), C('#E2F4F7', '#138A9E'), C('#F2ECE3', '#8A6A3B'), C('#F6F1DC', '#9A8320'), C('#EDEFF3', '#5F6B7A')],
  },
  dark: {
    text: '#EDECEA', sub: '#A9A7A0', head: '#D6D4CF', band: 0.35, labelBg: '#232321',
    content: C('#17304F', '#5E9EEA'), paid: C('#3D1830', '#E070B8'), shop: C('#2A2E35', '#97A3B3'),
    growth: C('#123A27', '#4CC58A'), power: C('#2E2A55', '#9D97E6'),
    currency: [C('#3F3210', '#E0B23A'), C('#43261A', '#F08A4F'), C('#0F3640', '#3FB6C9'), C('#3A2F20', '#C29A60'), C('#38331A', '#C9B04A'), C('#2A2E35', '#97A3B3')],
  },
};

const COL_TITLES = ['① 생산 · 콘텐츠', '② 재화', '③ 소비 · 성장', '④ 전투력'];
const COL_KIND = ['content', 'currency', 'growth', 'power'];
const G = { nodeH: 46, gap: 14, colGap: 130, padX: 16, feedY: 20, bandTop: 40, nodesTop: 82, legendH: 34 };

const fmt = (n) => Number(n).toLocaleString('ko-KR');
/** 대략적인 글자 폭(px): 한글·전각 1em, 그 외 0.58em */
export const textWidth = (s, px) => [...String(s)].reduce((a, ch) => a + (/[ᄀ-ￜ]/.test(ch) ? px : px * 0.58), 0);

/** 노드·선 목록과 열 순서·좌표. 순서는 무게중심 정렬로 선 교차를 줄인 결과 */
export function buildLoop(cfg) {
  const nodes = [], edges = [];
  const add = (n) => { nodes.push(n); return n; };
  const curIdx = new Map(cfg.currencies.map((c, i) => [c.id, i]));
  const paidCur = cfg.paid?.currency && curIdx.has(cfg.paid.currency) ? cfg.paid.currency : null;

  // 노드
  for (const c of cfg.contents) {
    // 보상 +n% = 전투력 100당 보상 증가율 (범례에 설명)
    const sub = [c.unlock > 0 ? `해금 ${fmt(c.unlock)}` : null, c.powerBonus > 0 ? `보상 +${c.powerBonus}%` : null].filter(Boolean).join(' · ');
    add({ id: `C_${c.id}`, col: 0, kind: 'content', label: c.name, sub });
  }
  if (paidCur) add({ id: 'PAY', col: 0, kind: 'paid', label: '과금', sub: `${cfg.currencies[curIdx.get(paidCur)].name} 구매` });
  cfg.currencies.forEach((c, i) => add({ id: `R_${c.id}`, col: 1, kind: 'currency', label: c.name, sub: c.id === paidCur ? '유료 재화' : '', cur: c.id, ci: i }));
  cfg.exchanges.forEach(x => { if (curIdx.has(x.from) && curIdx.has(x.to) && x.from !== x.to) add({ id: `X_${x.id}`, col: 1, kind: 'shop', label: x.name, sub: '', from: x.from, to: x.to }); });
  for (const g of cfg.growth) add({ id: `G_${g.id}`, col: 2, kind: 'growth', label: g.name, sub: `최대 Lv${fmt(g.max)} · 전투력 ${fmt(g.power)}/Lv` });
  add({ id: 'POWER', col: 3, kind: 'power', label: '전투력', sub: cfg.basePower > 0 ? `초기 ${fmt(cfg.basePower)}` : '' });

  // 선
  const has = (id) => nodes.some(n => n.id === id);
  for (const c of cfg.contents) for (const [cur, v] of Object.entries(c.reward || {})) if (v > 0 && has(`R_${cur}`)) edges.push({ from: `C_${c.id}`, to: `R_${cur}`, cur, kind: 'flow' });
  if (paidCur) edges.push({ from: 'PAY', to: `R_${paidCur}`, cur: paidCur, kind: 'flow' });
  for (const g of cfg.growth) {
    const curs = new Set([...Object.entries(g.cost || {}).filter(([, v]) => v > 0).map(([k]) => k), ...Object.keys(g.table || {})]);
    for (const cur of curs) if (has(`R_${cur}`)) edges.push({ from: `R_${cur}`, to: `G_${g.id}`, cur, kind: 'flow' });
    edges.push({ from: `G_${g.id}`, to: 'POWER', cur: null, kind: 'power' });
  }
  for (const n of nodes.filter(n => n.kind === 'shop')) {
    edges.push({ from: `R_${n.from}`, to: n.id, cur: n.from, kind: 'exchange' });
    edges.push({ from: n.id, to: `R_${n.to}`, cur: n.to, kind: 'exchange' });
  }
  const feedback = cfg.contents.some(c => (c.powerBonus || 0) > 0 || (c.unlock || 0) > 0);

  // 열 순서: 무게중심 정렬. 재화 열은 교환으로 이어진 재화·상점을 한 덩어리로 움직인다
  const cols = [0, 1, 2, 3].map(k => nodes.filter(n => n.col === k));
  const blocks = currencyBlocks(cols[1], cfg.currencies);
  const pos = new Map();
  const place = () => cols.forEach(col => col.forEach((n, i) => pos.set(n.id, i - (col.length - 1) / 2)));
  const nbr = (id, side) => edges.filter(e => e.kind !== 'exchange' && (side === 'in' ? e.to === id : e.from === id)).map(e => pos.get(side === 'in' ? e.from : e.to));
  const bary = (ids) => { const v = ids.flatMap(id => [...nbr(id, 'in'), ...nbr(id, 'out')]); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const sortBy = (arr, key) => { const k = arr.map((x, i) => [key(x) ?? (i - (arr.length - 1) / 2), i, x]); k.sort((a, b) => a[0] - b[0] || a[1] - b[1]); return k.map(x => x[2]); };
  place();
  for (let it = 0; it < 6; it++) {
    const ordered = sortBy(blocks, b => bary(b.map(n => n.id)));
    cols[1] = ordered.flat(); place();
    cols[0] = sortBy(cols[0], n => bary([n.id])); place();
    cols[2] = sortBy(cols[2], n => bary([n.id])); place();
  }

  // 국소 탐색: 이웃한 두 노드(재화 열은 덩어리)를 바꿔 보고 교차가 줄면 유지
  let geo = geometry(nodes, edges, cols);
  for (let improved = true, guard = 0; improved && guard < 50; guard++) {
    improved = false;
    for (const k of [0, 1, 2]) {
      const units = k === 1 ? blockOrder(cols[1], blocks) : cols[k].map(n => [n]);
      for (let i = 0; i + 1 < units.length; i++) {
        const trial = units.slice(); [trial[i], trial[i + 1]] = [trial[i + 1], trial[i]];
        const saved = cols[k]; cols[k] = trial.flat();
        const g2 = geometry(nodes, edges, cols);
        if (g2.crossings < geo.crossings) { geo = g2; improved = true; break; }
        cols[k] = saved;
      }
    }
  }
  geo = geometry(nodes, edges, cols); // 최종 순서로 좌표 확정
  return { nodes, edges, cols, feedback, ...geo };
}

/** 현재 재화 열 순서대로 덩어리 나열 */
function blockOrder(col, blocks) {
  const first = (b) => col.indexOf(b[0]);
  return blocks.slice().sort((a, b) => first(a) - first(b));
}

/** 열 순서 → 좌표·접점, 교차 수 (노드·선 객체에 좌표를 써 넣는다) */
function geometry(nodes, edges, cols) {
  const colW = cols.map((col, k) => Math.max(k === 3 ? 96 : 132, ...col.map(n => Math.max(textWidth(n.label, 13.5), textWidth(n.sub, 11)) + 28)));
  const maxN = Math.max(...cols.map(c => c.length));
  const innerH = maxN * G.nodeH + (maxN - 1) * G.gap;
  let x = G.padX + 12;
  const colX = colW.map(w => { const x0 = x; x += w + G.colGap; return x0; });
  cols.forEach((col, k) => {
    const h = col.length * G.nodeH + (col.length - 1) * G.gap;
    const y0 = G.nodesTop + (innerH - h) / 2;
    col.forEach((n, i) => Object.assign(n, { x: colX[k], y: y0 + i * (G.nodeH + G.gap), w: colW[k], h: G.nodeH }));
  });
  const width = colX[3] + colW[3] + G.padX + 12 + 24; // 오른쪽 되먹임 통로
  const bandBottom = G.nodesTop + innerH + 16;
  const height = bandBottom + 12 + G.legendH;
  const byId = new Map(nodes.map(n => [n.id, n]));

  // 접점: 가로 선은 오른쪽 변(나감)·왼쪽 변(들어옴)에서 상대 노드 높이 순으로 나눈다
  const cy = (n) => n.y + n.h / 2;
  for (const n of nodes) {
    const outs = edges.filter(e => e.kind !== 'exchange' && e.from === n.id).sort((a, b) => cy(byId.get(a.to)) - cy(byId.get(b.to)));
    const ins = edges.filter(e => e.kind !== 'exchange' && e.to === n.id).sort((a, b) => cy(byId.get(a.from)) - cy(byId.get(b.from)));
    const spread = (list, set) => { const k = list.length, step = Math.min(8, (n.h - 12) / Math.max(1, k - 1)); list.forEach((e, i) => set(e, cy(n) + (i - (k - 1) / 2) * step)); };
    spread(outs, (e, y) => { e.y1 = y; e.x1 = n.x + n.w; });
    spread(ins, (e, y) => { e.y2 = y; e.x2 = n.x; });
  }
  for (const e of edges.filter(e => e.kind === 'exchange')) {
    const a = byId.get(e.from), b = byId.get(e.to);
    const down = b.y > a.y;
    e.x1 = e.x2 = a.x + a.w / 2;
    e.y1 = down ? a.y + a.h : a.y; e.y2 = down ? b.y : b.y + b.h;
  }
  return { colX, colW, width, height, bandBottom, crossings: countCrossings(edges) };
}

/** 교환으로 이어진 재화를 '재화, 상점, 재화, …' 덩어리로 묶는다 (교환이 없으면 재화 하나가 한 덩어리) */
function currencyBlocks(col, currencies) {
  const cur = new Map(col.filter(n => n.kind === 'currency').map(n => [n.cur, n]));
  const shops = col.filter(n => n.kind === 'shop');
  const used = new Set(), blocks = [];
  for (const c of currencies) {
    if (used.has(c.id)) continue;
    const block = [cur.get(c.id)]; used.add(c.id);
    // 이 재화에서 시작해 교환을 따라가며 아직 안 쓴 재화를 이어 붙인다
    let tail = c.id, grew = true;
    while (grew) {
      grew = false;
      for (const s of shops) {
        if (s.placed) continue;
        const other = s.from === tail ? s.to : s.to === tail ? s.from : null;
        if (other && !used.has(other)) { block.push(s, cur.get(other)); s.placed = true; used.add(other); tail = other; grew = true; break; }
      }
    }
    blocks.push(block);
  }
  // 두 재화가 이미 다른 덩어리에 있어 끼울 자리가 없는 상점은 내는 재화 바로 뒤에 둔다
  for (const s of shops) if (!s.placed) { const b = blocks.find(bl => bl.some(n => n.cur === s.from)); b.splice(b.findIndex(n => n.cur === s.from) + 1, 0, s); s.placed = true; }
  shops.forEach(s => delete s.placed);
  return blocks;
}

/** 같은 열 쌍 사이 가로 선의 교차 수 (접점 기준) */
export function countCrossings(edges) {
  const flow = edges.filter(e => e.kind !== 'exchange' && e.y1 != null && e.y2 != null);
  let n = 0;
  for (let i = 0; i < flow.length; i++) for (let j = i + 1; j < flow.length; j++) {
    const a = flow[i], b = flow[j];
    if (Math.abs(a.x1 - b.x1) > 1 || Math.abs(a.x2 - b.x2) > 1) continue;
    if ((a.y1 - b.y1) * (a.y2 - b.y2) < -1e-9) n++;
  }
  return n;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (v) => Math.round(v * 10) / 10;

/** SVG 문자열 */
export function loopSvg(cfg, { dark = false } = {}) {
  const P = dark ? LOOP_COLORS.dark : LOOP_COLORS.light;
  const L = buildLoop(cfg);
  const curColor = (id) => P.currency[(cfg.currencies.findIndex(c => c.id === id) + P.currency.length) % P.currency.length];
  const nodeColor = (n) => (n.kind === 'currency' ? curColor(n.cur) : P[n.kind]);
  const edgeColor = (e) => (e.cur ? curColor(e.cur).stroke : P.growth.stroke);
  const colors = new Set([...L.edges.map(edgeColor), P.power.stroke]);
  const mid = (c) => `a${c.slice(1)}`;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r1(L.width)} ${r1(L.height)}" width="${r1(L.width)}" height="${r1(L.height)}" font-family="'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif" role="img" aria-label="성장 루프: 생산에서 재화, 성장, 전투력으로 이어지는 흐름">`);
  out.push('<defs>', ...[...colors].map(c => `<marker id="${mid(c)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`), '</defs>');

  // 열 배경과 제목
  L.colX.forEach((x0, k) => {
    const c = k === 1 ? { fill: P.currency[0].fill, stroke: P.currency[0].stroke } : P[COL_KIND[k]];
    out.push(`<rect x="${r1(x0 - 12)}" y="${G.bandTop}" width="${r1(L.colW[k] + 24)}" height="${r1(L.bandBottom - G.bandTop)}" rx="14" fill="${c.fill}" fill-opacity="${P.band}" stroke="none"/>`);
    out.push(`<text x="${r1(x0)}" y="${G.bandTop + 24}" font-size="13" font-weight="700" fill="${P.head}">${esc(COL_TITLES[k])}</text>`);
  });

  // 되먹임: 전투력 오른쪽으로 나가 열 바깥에서 올라간 뒤, 맨 위 통로를 지나 콘텐츠 열로 (열 제목·노드를 가로지르지 않게)
  if (L.feedback) {
    const pw = L.nodes.find(n => n.id === 'POWER');
    const xr = pw.x + pw.w + 22, ym = pw.y + pw.h / 2, x2 = L.colX[0] + L.colW[0] / 2, y = G.feedY;
    const lx0 = (xr + x2) / 2;
    const col = P.power.stroke;
    out.push(`<path d="M${r1(pw.x + pw.w)},${r1(ym)} L${r1(xr)},${r1(ym)} L${r1(xr)},${y} L${r1(x2)},${y} L${r1(x2)},${G.bandTop - 2}" fill="none" stroke="${col}" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#${mid(col)})"/>`);
    const label = '전투력 → 보상 증가 · 콘텐츠 해금', lw = textWidth(label, 12) + 14, lx = lx0;
    out.push(`<rect x="${r1(lx - lw / 2)}" y="${y - 10}" width="${r1(lw)}" height="20" rx="10" fill="${P.labelBg}" stroke="${col}" stroke-width="1"/>`);
    out.push(`<text x="${r1(lx)}" y="${y + 4}" font-size="12" text-anchor="middle" fill="${col}">${esc(label)}</text>`);
  }

  // 선 (노드보다 먼저 그려 노드가 위에 오게)
  for (const e of L.edges) {
    const col = edgeColor(e);
    if (e.kind === 'exchange') {
      out.push(`<path d="M${r1(e.x1)},${r1(e.y1)} L${r1(e.x2)},${r1(e.y2)}" fill="none" stroke="${col}" stroke-width="1.6" stroke-dasharray="4 3" marker-end="url(#${mid(col)})"/>`);
      continue;
    }
    const dx = (e.x2 - e.x1) * 0.5;
    out.push(`<path d="M${r1(e.x1)},${r1(e.y1)} C${r1(e.x1 + dx)},${r1(e.y1)} ${r1(e.x2 - dx)},${r1(e.y2)} ${r1(e.x2 - 1)},${r1(e.y2)}" fill="none" stroke="${col}" stroke-width="${e.kind === 'power' ? 1.4 : 1.8}" stroke-opacity="0.9" marker-end="url(#${mid(col)})"/>`);
  }

  // 노드
  for (const n of L.nodes) {
    const c = nodeColor(n);
    const rx = n.kind === 'currency' ? n.h / 2 : n.kind === 'power' ? 10 : 8;
    out.push(`<rect x="${r1(n.x)}" y="${r1(n.y)}" width="${r1(n.w)}" height="${r1(n.h)}" rx="${rx}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${n.kind === 'power' || n.kind === 'currency' ? 2 : 1.4}"${n.kind === 'shop' ? ' stroke-dasharray="4 3"' : ''}/>`);
    const cx = n.x + n.w / 2;
    if (n.sub) {
      out.push(`<text x="${r1(cx)}" y="${r1(n.y + 20)}" font-size="13.5" font-weight="600" text-anchor="middle" fill="${P.text}">${esc(n.label)}</text>`);
      out.push(`<text x="${r1(cx)}" y="${r1(n.y + 36)}" font-size="11" text-anchor="middle" fill="${P.sub}">${esc(n.sub)}</text>`);
    } else {
      out.push(`<text x="${r1(cx)}" y="${r1(n.y + n.h / 2 + 5)}" font-size="13.5" font-weight="600" text-anchor="middle" fill="${P.text}">${esc(n.label)}</text>`);
    }
  }

  // 범례
  const items = [['콘텐츠 (해금 = 필요 전투력, 보상 +n% = 전투력 100당)', P.content], ['과금', P.paid], ['재화 (선 색 = 그 재화의 흐름)', P.currency[0]], ['상점 · 교환', P.shop], ['성장', P.growth], ['전투력', P.power]];
  let lx = G.padX;
  const ly = L.bandBottom + 14;
  for (const [label, c] of items) {
    out.push(`<rect x="${r1(lx)}" y="${ly}" width="14" height="14" rx="3" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.4"/>`);
    out.push(`<text x="${r1(lx + 20)}" y="${ly + 11.5}" font-size="12" fill="${P.sub}">${esc(label)}</text>`);
    lx += 20 + textWidth(label, 12) + 18;
  }
  out.push('</svg>');
  return out.join('');
}
