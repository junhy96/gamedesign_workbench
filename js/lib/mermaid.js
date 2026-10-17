// Mermaid 공통: 지연 로드, 파싱 검사, 테마별 렌더, 내보내기용 라이트 테마 오프스크린 렌더
const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js';

let loading, seq = 0;
export function loadMermaid() {
  if (globalThis.mermaid) return Promise.resolve(globalThis.mermaid);
  loading ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: MERMAID_URL, async: true });
    s.onload = () => resolve(globalThis.mermaid);
    s.onerror = () => { loading = null; reject(new Error('Mermaid를 불러오지 못했습니다.')); };
    document.head.append(s);
  });
  return loading;
}

export const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

const SPACING = { tight: [30, 35], normal: [50, 50], wide: [80, 80] };

/** opts: { curve: 'basis'|'linear'|'stepAfter', spacing: 'tight'|'normal'|'wide', fontSize: px } */
function configure(m, dark, opts = {}) {
  const [nodeSpacing, rankSpacing] = SPACING[opts.spacing] ?? SPACING.normal;
  m.initialize({
    startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default',
    fontFamily: '"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif',
    themeVariables: { fontSize: `${opts.fontSize ?? 14}px`, edgeLabelBackground: dark ? '#232321' : '#ffffff' },
    // 선 라벨 배경을 불투명하게 (기본은 반투명이라 지나가는 선이 글자와 겹쳐 보임) — 미리보기·PNG·SVG·PPT 모두 적용
    themeCSS: `.edgeLabel rect, .edgeLabel .background, .labelBkg { opacity: 1 !important; fill: ${dark ? '#232321' : '#ffffff'} !important; background-color: ${dark ? '#232321' : '#ffffff'} !important; }`,
    // HTML 라벨 대신 SVG 텍스트 → PNG 변환과 PPT 도형 변환이 정확해짐
    htmlLabels: false,
    flowchart: { htmlLabels: false, curve: opts.curve ?? 'basis', nodeSpacing, rankSpacing },
    sequence: { useMaxWidth: false }, state: { useMaxWidth: false, nodeSpacing, rankSpacing },
  });
}

/** 파싱 오류 메시지 또는 null */
export async function parseError(code) {
  const m = await loadMermaid();
  try { await m.parse(code); return null; } catch (e) { return String(e?.message || e).split('\n').slice(0, 4).join(' '); }
}

/** SVG 문자열. 렌더 번호를 함께 돌려줘 호출 측이 오래된 결과를 버릴 수 있게 한다. */
export async function renderSvg(code, dark = isDark(), opts = {}) {
  const m = await loadMermaid();
  configure(m, dark, opts);
  const id = ++seq;
  const { svg } = await m.render(`mmd-${id}`, code);
  return { svg, id, latest: () => id === seq };
}

/** 내보내기용: 라이트 테마로 화면 밖에 렌더한 SVG 요소 (사용 후 host.remove()) */
export async function renderOffscreen(code, opts = {}) {
  const err = await parseError(code);
  if (err) throw new Error('문법 오류를 먼저 고쳐 주세요.');
  const { svg: text } = await renderSvg(code, false, opts);
  const host = document.createElement('div');
  host.className = 'offscreen-render';
  host.innerHTML = text; // securityLevel: strict로 정화된 SVG
  document.body.append(host);
  const svg = host.querySelector('svg');
  const vb = svg.viewBox.baseVal;
  if (vb && vb.width) { svg.setAttribute('width', vb.width); svg.setAttribute('height', vb.height); svg.style.maxWidth = 'none'; }
  return { svg, host };
}
