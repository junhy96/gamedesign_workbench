// 다이어그램 스타일 층: 블록 종류 분류 → 종류별 색, 예/아니오 분기 선 색, 방향·선 모양 덮어쓰기, 범례(INDEX)
// 사용자가 보는 코드는 그대로 두고, 그릴 때만 classDef·class·linkStyle 줄을 덧붙인다.
// 분류는 Mermaid 파서가 읽은 노드 모양(vertex.type)으로 한다 → 정규식 파싱보다 정확.

/** 블록 종류: Mermaid에서 쓰는 모양, PowerPoint 기본 도형 */
export const CATS = {
  terminal: { label: '시작 · 종료', syntax: 'id(["이름"])', preset: 'flowChartTerminator' },
  process: { label: '처리', syntax: 'id["이름"]', preset: 'flowChartProcess' },
  decision: { label: '판단 (분기)', syntax: 'id{"이름"}', preset: 'flowChartDecision' },
  io: { label: '입출력 (I/O)', syntax: 'id[/"이름"/]', preset: 'flowChartInputOutput' },
  screen: { label: '화면 (UI)', syntax: 'id("이름")', preset: 'flowChartAlternateProcess' },
  data: { label: '데이터 (DB)', syntax: 'id[("이름")]', preset: 'flowChartMagneticDisk' },
  sub: { label: '서브 프로세스', syntax: 'id[["이름"]]', preset: 'flowChartPredefinedProcess' },
  prep: { label: '준비 · 설정', syntax: 'id{{"이름"}}', preset: 'flowChartPreparation' },
  event: { label: '이벤트 (신호)', syntax: 'id>"이름"]', preset: 'homePlate' },
  doc: { label: '문서', syntax: 'id@{ shape: doc, label: "이름" }', preset: 'flowChartDocument' },
  connector: { label: '연결점', syntax: 'id(("이름"))', preset: 'flowChartConnector' },
  state: { label: '상태', syntax: 'state "이름" as Id', preset: 'roundRect' },
  // 시퀀스 참여자
  // 상태도 [*] 점
  stateStart: { label: '시작', syntax: '[*] --> 상태', preset: 'flowChartConnector' },
  stateEnd: { label: '종료', syntax: '상태 --> [*]', preset: 'donut' },
  seqUser: { label: '사용자 (액터)', syntax: 'actor U as 유저', preset: 'ellipse', seq: true },
  seqClient: { label: '클라이언트 (UI)', syntax: 'participant C as 클라이언트', preset: 'roundRect', seq: true },
  seqSystem: { label: '서버 · 시스템', syntax: 'participant S as 게임 서버', preset: 'rect', seq: true },
  seqData: { label: '데이터 (DB)', syntax: 'participant D@{ "type": "database" } as DB', preset: 'flowChartMagneticDisk', seq: true },
  seqQueue: { label: '큐 · 메시지', syntax: 'participant Q@{ "type": "queue" } as 큐', preset: 'can', seq: true },
};

// 시퀀스 참여자는 흐름도 색을 빌려 씀
const COLOR_ALIAS = { seqUser: 'terminal', seqClient: 'screen', seqSystem: 'process', seqData: 'data', seqQueue: 'event' };
export const colorOf = (pal, cat) => pal[cat] ?? pal[COLOR_ALIAS[cat]] ?? pal.process;

// Mermaid 노드 모양 → 블록 종류 (괄호 문법과 v11 @{ shape } 문법 이름 모두)
const TYPE_TO_CAT = {
  stadium: 'terminal', terminal: 'terminal', pill: 'terminal',
  square: 'process', rect: 'process', proc: 'process', process: 'process', rectangle: 'process', trapezoid: 'process', inv_trapezoid: 'process',
  diamond: 'decision', diam: 'decision', decision: 'decision', question: 'decision',
  lean_right: 'io', lean_left: 'io', 'lean-r': 'io', 'lean-l': 'io', 'in-out': 'io', 'out-in': 'io',
  round: 'screen', rounded: 'screen', event: 'screen',
  cylinder: 'data', cyl: 'data', db: 'data', database: 'data',
  subroutine: 'sub', subproc: 'sub', subprocess: 'sub', 'fr-rect': 'sub', framed: 'sub',
  hexagon: 'prep', hex: 'prep', prepare: 'prep',
  odd: 'event', flag: 'event', 'paper-tape': 'event',
  doc: 'doc', docs: 'doc', document: 'doc', 'lin-doc': 'doc', documents: 'doc',
  circle: 'connector', doublecircle: 'connector', circ: 'connector', 'sm-circ': 'connector', 'dbl-circ': 'connector',
};

const C = (fill, stroke, text = '#1B1B1A') => ({ fill, stroke, text });
export const PALETTES = {
  type: {
    label: '블록 종류별 색 (기본)',
    light: {
      terminal: C('#E9E6F8', '#615BAE'), process: C('#E6F0FC', '#2A78D6'), decision: C('#FFF3D3', '#C98A00'), io: C('#E2F5EB', '#1A9E5C'),
      screen: C('#E2F4F7', '#138A9E'), data: C('#F2ECE3', '#8A6A3B'), sub: C('#EDEFF3', '#5F6B7A'), prep: C('#FDE8DF', '#D9631E'),
      event: C('#FBE6EF', '#C2417C'), doc: C('#F6F1DC', '#9A8320'), connector: C('#F1F1EF', '#77756E'), state: C('#E6F0FC', '#2A78D6'),
    },
    dark: {
      terminal: C('#2E2A55', '#9D97E6', '#EDEBFF'), process: C('#17304F', '#5E9EEA', '#E3EEFC'), decision: C('#3F3210', '#E0B23A', '#FFF3D3'), io: C('#123A27', '#4CC58A', '#DFF7EA'),
      screen: C('#0F3640', '#3FB6C9', '#DDF4F7'), data: C('#3A2F20', '#C29A60', '#F2ECE3'), sub: C('#2A2E35', '#97A3B3', '#EDEFF3'), prep: C('#43261A', '#F08A4F', '#FDE8DF'),
      event: C('#43202F', '#E77BAA', '#FBE6EF'), doc: C('#38321A', '#CDB65A', '#F6F1DC'), connector: C('#2C2C2A', '#A8A69F', '#F1F1EF'), state: C('#17304F', '#5E9EEA', '#E3EEFC'),
    },
  },
  vivid: {
    label: '선명한 채움 (흰 글자)',
    light: {
      terminal: C('#615BAE', '#4A4592', '#FFFFFF'), process: C('#2A78D6', '#1F5FAD', '#FFFFFF'), decision: C('#E2A400', '#B98500', '#1B1300'), io: C('#1A9E5C', '#147C48', '#FFFFFF'),
      screen: C('#138A9E', '#0E6C7C', '#FFFFFF'), data: C('#8A6A3B', '#6C522C', '#FFFFFF'), sub: C('#5F6B7A', '#495260', '#FFFFFF'), prep: C('#D9631E', '#B04E15', '#FFFFFF'),
      event: C('#C2417C', '#9C3163', '#FFFFFF'), doc: C('#9A8320', '#7A6718', '#FFFFFF'), connector: C('#77756E', '#5B5A54', '#FFFFFF'), state: C('#2A78D6', '#1F5FAD', '#FFFFFF'),
    },
  },
  mono: {
    label: '흑백 (인쇄용)',
    light: Object.fromEntries(Object.keys(CATS).map(k => [k, k === 'decision' ? C('#EDEDED', '#333333', '#111111') : C('#FFFFFF', '#333333', '#111111')])),
  },
  none: { label: 'Mermaid 기본 색 (색 없음)' },
};

export const EDGE = { neg: '#D93025', pos: '#1E8E3E' };

export const DEFAULT_STYLE = {
  palette: 'type', direction: 'auto', curve: 'basis', spacing: 'normal', fontSize: 14,
  negRed: true, posGreen: false, legend: true,
  negWords: '아니오, 아니요, 없음, 아님, 미보유, 실패, 거절, 불가, No, N, False',
  posWords: '예, 네, 있음, 보유, 성공, 수락, 가능, Yes, Y, True',
};

export const palette = (style, dark) => {
  const p = PALETTES[style.palette];
  if (!p?.light) return null;
  return (dark && p.dark) || p.light;
};

const words = (s) => String(s || '').split(/[,\n]/).map(w => w.trim().toLowerCase()).filter(Boolean);
/** 라벨이 단어 목록 중 하나로 시작하면 true ("아니오 (재시도)"·"없음!" 포함, "아니오다" 같은 이어진 단어는 제외) */
export function matchesWord(label, list) {
  const t = String(label || '').trim().toLowerCase().replace(/^["'“”‘’(\[]+/, '');
  if (!t) return false;
  return words(list).some(w => t === w || (t.startsWith(w) && /[\s()[\]:·,./!?~"'“”‘’-]/.test(t[w.length] ?? '')));
}

/** Mermaid로 코드를 분석: 형식, 노드(id·종류·이름), 연결선(순서·라벨) */
export async function analyze(mermaid, code) {
  const diag = await mermaid.mermaidAPI.getDiagramFromText(code);
  const type = diag.type;
  if (type.startsWith('flowchart')) {
    const v = diag.db.getVertices();
    const nodes = [...(v instanceof Map ? v.values() : Object.values(v))].map(x => ({ id: x.id, text: x.text, cat: TYPE_TO_CAT[x.type] ?? 'process' }));
    const edges = diag.db.getEdges().map((e, i) => ({ i, from: e.start, to: e.end, text: e.text ?? '' }));
    return { kind: 'flowchart', nodes, edges };
  }
  if (type.startsWith('state')) {
    const st = diag.db.getStates?.() ?? new Map();
    const nodes = [...st.entries()]
      .filter(([id, s]) => !/^root_|_start$|_end$/.test(id) && s.type !== 'fork' && s.type !== 'join' && s.type !== 'divider' && !(s.doc && s.doc.length))
      .map(([id, s]) => ({ id, text: s.descriptions?.[0] ?? id, cat: s.type === 'choice' ? 'decision' : 'state' }));
    // [*] 시작·종료 점: 색을 입힐 수 없으므로 범례에만 표시
    const ids = [...st.entries()];
    const marks = {
      start: ids.some(([id, s]) => s.type === 'start' || /(^|_)start$/.test(id)),
      end: ids.some(([id, s]) => s.type === 'end' || /(^|_)end$/.test(id)),
    };
    return { kind: 'state', nodes, edges: [], marks };
  }
  if (type === 'sequence') return analyzeSequence(diag.db);
  return { kind: type, nodes: [], edges: [] };
}

/** 분기 선 분류 */
export function edgeGroups(an, style) {
  const neg = style.negRed ? an.edges.filter(e => matchesWord(e.text, style.negWords)).map(e => e.i) : [];
  const pos = style.posGreen ? an.edges.filter(e => !neg.includes(e.i) && matchesWord(e.text, style.posWords)).map(e => e.i) : [];
  return { neg, pos };
}

const DIRS = ['TD', 'TB', 'BT', 'LR', 'RL'];

/** 그릴 때 쓸 코드: 방향 덮어쓰기 + 종류별 classDef/class + 분기 linkStyle */
export function styledCode(code, an, style, dark) {
  let out = code.replace(/\s+$/, '');
  const pal = palette(style, dark);
  const userStyled = /^\s*(classDef|class|style)\s/m.test(code);
  const lines = [];

  if (an.kind === 'flowchart') {
    if (DIRS.includes(style.direction)) {
      out = /^\s*(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/m.test(out)
        ? out.replace(/^(\s*(?:flowchart|graph))\s+(TD|TB|BT|LR|RL)\b/m, `$1 ${style.direction}`)
        : out.replace(/^(\s*(?:flowchart|graph))\b/m, `$1 ${style.direction}`);
    }
    if (pal && !userStyled) {
      for (const cat of new Set(an.nodes.map(n => n.cat))) {
        const c = pal[cat];
        lines.push(`classDef wb_${cat} fill:${c.fill},stroke:${c.stroke},color:${c.text},stroke-width:1.5px`);
        lines.push(`class ${an.nodes.filter(n => n.cat === cat).map(n => n.id).join(',')} wb_${cat}`);
      }
    }
    if (!/^\s*linkStyle\s/m.test(code)) {
      const { neg, pos } = edgeGroups(an, style);
      if (neg.length) lines.push(`linkStyle ${neg.join(',')} stroke:${EDGE.neg},stroke-width:2.4px,color:${EDGE.neg}`);
      if (pos.length) lines.push(`linkStyle ${pos.join(',')} stroke:${EDGE.pos},stroke-width:2.4px,color:${EDGE.pos}`);
    }
  } else if (an.kind === 'state') {
    if (DIRS.includes(style.direction) && !/^\s*direction\s/m.test(out)) {
      out = out.replace(/^(\s*stateDiagram(?:-v2)?)\s*$/m, `$1\n  direction ${style.direction === 'TD' || style.direction === 'TB' ? 'TB' : style.direction}`);
    }
    if (pal && !userStyled) {
      for (const cat of new Set(an.nodes.map(n => n.cat))) {
        const c = pal[cat];
        lines.push(`classDef wb_${cat} fill:${c.fill},stroke:${c.stroke},color:${c.text},stroke-width:1.5px`);
        lines.push(`class ${an.nodes.filter(n => n.cat === cat).map(n => n.id).join(', ')} wb_${cat}`);
      }
    }
  }
  return lines.length ? `${out}\n  %% 기획 워크벤치 스타일 (자동)\n  ${lines.join('\n  ')}` : out;
}

/** 범례 항목: 쓰인 블록 종류(등장 순) + 분기 선 */
export function legendItems(an, style, dark = false) {
  const pal = palette(style, dark) || PALETTES.mono.light;
  const seen = [];
  for (const n of an.nodes) if (!seen.includes(n.cat)) seen.push(n.cat);
  const order = Object.keys(CATS);
  seen.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const items = seen.map(cat => ({ kind: 'block', cat, label: CATS[cat].label, ...colorOf(pal, cat) }));
  if (an.marks) { // 상태도 시작·종료 점은 맨 앞에
    const ink = dark ? '#E8E6E1' : '#1B1B1A';
    const marks = [];
    if (an.marks.start) marks.push({ kind: 'block', cat: 'stateStart', label: CATS.stateStart.label, fill: ink, stroke: ink, text: ink });
    if (an.marks.end) marks.push({ kind: 'block', cat: 'stateEnd', label: CATS.stateEnd.label, fill: ink, stroke: ink, text: ink });
    items.unshift(...marks);
  }
  if (an.kind === 'sequence' && an.edges.length) {
    const ink = dark ? '#C9C8C2' : '#333333';
    if (an.edges.some(e => !e.dotted)) items.push({ kind: 'edge', label: '요청 · 호출 (실선)', stroke: ink });
    if (an.edges.some(e => e.dotted)) items.push({ kind: 'edge', label: '응답 · 반환 (점선)', stroke: ink, dash: true });
  }
  const { neg, pos } = edgeGroups(an, style);
  const seq = an.kind === 'sequence';
  if (neg.length) items.push({ kind: 'edge', label: seq ? '실패 · 아니오 메시지' : '아니오 · 없음 분기', stroke: EDGE.neg });
  if (pos.length) items.push({ kind: 'edge', label: seq ? '성공 · 예 메시지' : '예 · 있음 분기', stroke: EDGE.pos });
  return items;
}

/** 범례용 작은 도형 (SVG 문자열, 32×20) */
export function shapeIcon(cat, fill, stroke) {
  const a = `fill="${fill}" stroke="${stroke}" stroke-width="1.5"`;
  const s = {
    terminal: `<rect x="2" y="3" width="28" height="14" rx="7" ${a}/>`,
    process: `<rect x="3" y="3" width="26" height="14" ${a}/>`,
    decision: `<polygon points="16,1 30,10 16,19 2,10" ${a}/>`,
    io: `<polygon points="8,3 30,3 24,17 2,17" ${a}/>`,
    screen: `<rect x="3" y="3" width="26" height="14" rx="4" ${a}/>`,
    data: `<path d="M5 6 a11 3 0 0 0 22 0 a11 3 0 0 0 -22 0 v9 a11 3 0 0 0 22 0 v-9" ${a}/>`,
    sub: `<rect x="3" y="3" width="26" height="14" ${a}/><path d="M7 3v14M25 3v14" stroke="${stroke}" stroke-width="1.5"/>`,
    prep: `<polygon points="8,3 24,3 30,10 24,17 8,17 2,10" ${a}/>`,
    event: `<polygon points="2,3 30,3 30,17 2,17 8,10" ${a}/>`,
    doc: `<path d="M3 3h26v12c-6-4-10 4-16 1s-8 -1-10 1z" ${a}/>`,
    connector: `<circle cx="16" cy="10" r="7" ${a}/>`,
    state: `<rect x="3" y="3" width="26" height="14" rx="5" ${a}/>`,
    stateStart: `<circle cx="16" cy="10" r="6.5" fill="${fill}" stroke="${stroke}"/>`,
    stateEnd: `<circle cx="16" cy="10" r="7.5" fill="none" stroke="${stroke}" stroke-width="1.5"/><circle cx="16" cy="10" r="4.5" fill="${fill}"/>`,
    seqUser: `<circle cx="16" cy="5" r="3.5" ${a}/><path d="M16 9v5M10 11h12M16 14l-5 5M16 14l5 5" stroke="${stroke}" stroke-width="1.5" fill="none"/>`,
    seqClient: `<rect x="3" y="3" width="26" height="14" rx="4" ${a}/>`,
    seqSystem: `<rect x="3" y="3" width="26" height="14" ${a}/>`,
    seqData: `<path d="M5 6 a11 3 0 0 0 22 0 a11 3 0 0 0 -22 0 v9 a11 3 0 0 0 22 0 v-9" ${a}/>`,
    seqQueue: `<path d="M7 3 h18 a3 7 0 0 1 0 14 h-18 a3 7 0 0 1 0 -14 z M25 3 a3 7 0 0 0 0 14" ${a}/>`,
  }[cat] ?? `<rect x="3" y="3" width="26" height="14" ${a}/>`;
  return `<svg viewBox="0 0 32 20" width="32" height="20" aria-hidden="true">${s}</svg>`;
}

// ── 시퀀스 다이어그램 ────────────────────────────────────
// 시퀀스는 classDef가 없으므로, 그린 뒤 SVG에서 참여자 도형을 생명선 x 위치로 찾아 색을 입힌다
// (아래쪽 복제 도형에는 id가 없어서 위치로 맞춤). 메시지 선은 data-et="message" 순서 = 파서 메시지 순서.

const DOTTED = new Set([1, 4, 6, 25, 34]);
const CONTROL_FROM = 2; // 2 = 노트, 10 이상(24·25·33·34 제외)은 loop/alt 같은 제어 블록
const isMessage = (m) => m.from && m.to && m.type !== CONTROL_FROM && (m.type < 10 || [24, 25, 33, 34].includes(m.type));

const SEQ_NAME = [
  [/(^|\s)(db|rdb|redis|mysql|postgres|mongo)|데이터베이스|저장소|database|캐시|cache|DB/i, 'seqData'],
  [/유저|사용자|플레이어|player|user|고객|운영자/i, 'seqUser'],
  [/클라이언트|client|앱|app|화면|브라우저|browser|ui\b/i, 'seqClient'],
  [/큐|queue|kafka|메시지 브로커|broker|pub\/?sub/i, 'seqQueue'],
];
function seqCat(a) {
  if (a.type === 'actor') return 'seqUser';
  if (a.type === 'database' || a.type === 'collections') return 'seqData';
  if (a.type === 'queue') return 'seqQueue';
  if (a.type === 'boundary') return 'seqClient';
  if (a.type === 'control' || a.type === 'entity') return 'seqSystem';
  const name = `${a.description ?? ''} ${a.name ?? ''}`;
  return SEQ_NAME.find(([re]) => re.test(name))?.[1] ?? 'seqSystem';
}

export function analyzeSequence(db) {
  const nodes = [...db.getActors().entries()].map(([id, a]) => ({ id, text: a.description ?? id, cat: seqCat(a) }));
  const edges = db.getMessages().filter(isMessage).map((m, i) => ({ i, from: m.from, to: m.to, text: m.message ?? '', dotted: DOTTED.has(m.type) }));
  return { kind: 'sequence', nodes, edges };
}

/** 렌더된 시퀀스 SVG(문서에 붙어 있어야 함)에 참여자 색과 부정 메시지 빨간 선 적용 */
export function decorateSequence(svg, an, style, dark) {
  if (an.kind !== 'sequence') return;
  const pal = palette(style, dark);
  const lifelines = [...svg.querySelectorAll('line.actor-line, line[data-et="life-line"]')].map(l => ({ id: l.getAttribute('name') || l.dataset.id, x: +l.getAttribute('x1'), el: l }));
  const byId = new Map(an.nodes.map(n => [n.id, n]));
  const nearest = (x) => lifelines.reduce((b, l) => (Math.abs(l.x - x) < Math.abs(b.x - x) ? l : b), lifelines[0]);
  if (pal && lifelines.length) {
    // 참여자 도형 (위·아래). 같은 도형을 두 번 칠하지 않게 가장 바깥 묶음만
    const groups = [...svg.querySelectorAll('rect.actor, g.actor, g.actor-man, g[data-et="participant"]')].filter(el => !el.parentElement.closest('g.actor, g.actor-man, g[data-et="participant"]'));
    for (const el of groups) {
      const bb = el.getBBox();
      const n = byId.get(nearest(bb.x + bb.width / 2).id);
      if (!n) continue;
      const c = colorOf(pal, n.cat);
      const shapes = el.matches('rect, path, circle, ellipse, polygon') ? [el] : el.querySelectorAll('rect, path, circle, ellipse, polygon, line');
      for (const s of shapes) { if (s.tagName !== 'line') s.style.fill = c.fill; s.style.stroke = c.stroke; s.style.strokeWidth = '1.5px'; }
      if (el.matches('g')) el.style.stroke = c.stroke;
    }
    for (const t of svg.querySelectorAll('text.actor, text.actor-box')) {
      const n = byId.get(nearest(+t.getAttribute('x')).id);
      if (n) { t.style.fill = colorOf(pal, n.cat).text; for (const sp of t.querySelectorAll('tspan')) sp.style.fill = colorOf(pal, n.cat).text; }
    }
    for (const l of lifelines) { const n = byId.get(l.id); if (n) { l.el.style.stroke = colorOf(pal, n.cat).stroke; l.el.style.strokeWidth = '1px'; l.el.style.strokeDasharray = '5 4'; } } // Mermaid CSS가 속성을 덮으므로 style로
  }
  // 부정 메시지(실패·아니오 …) 빨간 선 + 빨간 화살촉
  const { neg, pos } = edgeGroups(an, style);
  if (!neg.length && !pos.length) return;
  const lines = [...svg.querySelectorAll('[data-et="message"]')];
  const texts = [...svg.querySelectorAll('text.messageText')];
  const paint = (idx, color, tag) => {
    for (const i of idx) {
      const line = lines[i], text = texts[i];
      if (line) {
        line.style.stroke = color; line.setAttribute('stroke', color); line.setAttribute('stroke-width', '2.4');
        const ref = (line.getAttribute('marker-end') || '').match(/url\(#([^)]+)\)/)?.[1];
        const marker = ref && svg.querySelector(`marker[id="${ref}"]`);
        if (marker) {
          const id = `${ref}-${tag}`;
          if (!svg.querySelector(`marker[id="${id}"]`)) {
            const m2 = marker.cloneNode(true); m2.id = id;
            for (const p of m2.querySelectorAll('path, polygon')) { p.style.fill = color; p.style.stroke = color; }
            marker.after(m2);
          }
          line.setAttribute('marker-end', `url(#${id})`);
        }
      }
      if (text) text.style.fill = color;
    }
  };
  paint(neg, EDGE.neg, 'neg');
  paint(pos, EDGE.pos, 'pos');
}

/** 범례용 선 아이콘 (SVG 문자열, 32×20) — 점선이면 응답 */
export function edgeIcon(stroke, dash) {
  return `<svg viewBox="0 0 32 20" width="32" height="20" aria-hidden="true"><path d="M2 10h24" stroke="${stroke}" stroke-width="2.2"${dash ? ' stroke-dasharray="4 3"' : ''}/><path d="M24 6l6 4-6 4z" fill="${stroke}"/></svg>`;
}
