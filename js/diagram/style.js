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
};

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
    return { kind: 'state', nodes, edges: [] };
  }
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
  const items = seen.map(cat => ({ kind: 'block', cat, label: CATS[cat].label, ...pal[cat] }));
  const { neg, pos } = edgeGroups(an, style);
  if (neg.length) items.push({ kind: 'edge', label: '아니오 · 없음 분기', stroke: EDGE.neg });
  if (pos.length) items.push({ kind: 'edge', label: '예 · 있음 분기', stroke: EDGE.pos });
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
  }[cat] ?? `<rect x="3" y="3" width="26" height="14" ${a}/>`;
  return `<svg viewBox="0 0 32 20" width="32" height="20" aria-hidden="true">${s}</svg>`;
}
