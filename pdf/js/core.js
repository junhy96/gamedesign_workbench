// PDF 도구 공통 — 라이브러리 지연 로드와 순수 함수(쪽 범위 해석, 배치 계산 등)
// 모든 처리는 브라우저 안에서만 한다. 파일은 어디에도 업로드되지 않는다.

const PDFLIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
const FONTKIT_URL = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';
const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs';
const KR_FONT_URL = 'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/public/static/alternative/Pretendard-Regular.ttf';

const scripts = new Map();
function loadScript(url, globalName) {
  if (globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  if (!scripts.has(url)) {
    scripts.set(url, new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement('script'), { src: url, async: true });
      s.onload = () => resolve(globalThis[globalName]);
      s.onerror = () => { scripts.delete(url); reject(new Error(`${globalName}를 불러오지 못했습니다.`)); };
      document.head.append(s);
    }));
  }
  return scripts.get(url);
}

const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
export const loadPdfLib = () => loadScript(PDFLIB_URL, 'PDFLib');
export const loadJsZip = () => loadScript(JSZIP_URL, 'JSZip');

/** 여러 결과 파일을 ZIP 하나로 */
export async function zipFiles(files) {
  const JSZip = await loadJsZip();
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  return zip.generateAsync({ type: 'uint8array' });
}
export const loadFontkit = () => loadScript(FONTKIT_URL, 'fontkit');

let pdfjsP;
export function loadPdfJs() {
  pdfjsP ??= import(PDFJS_URL).then((m) => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m; });
  return pdfjsP;
}

let krFontP;
export function loadKoreanFont() {
  krFontP ??= fetch(KR_FONT_URL).then(r => { if (!r.ok) throw new Error('한글 글꼴을 불러오지 못했습니다.'); return r.arrayBuffer(); });
  return krFontP;
}

/**
 * 쪽 범위 해석. "1-3, 5, 8-" → [0,1,2,4,7,8,...] (0부터 시작하는 번호, 입력 순서 유지, 중복 허용)
 * 빈 문자열이나 "전체"는 모든 쪽. 잘못된 입력은 Error.
 */
export function parseRanges(text, pageCount) {
  const t = String(text ?? '').trim();
  if (!t || t === '전체' || t.toLowerCase() === 'all') return Array.from({ length: pageCount }, (_, i) => i);
  const out = [];
  for (const part of t.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)?(-)?(\d+)?$/);
    if (!m || (!m[1] && !m[3])) throw new Error(`쪽 범위를 해석할 수 없습니다: "${part}"`);
    const a = m[1] ? +m[1] : 1;
    const b = m[2] ? (m[3] ? +m[3] : pageCount) : a;
    if (a < 1 || b < 1 || a > pageCount || b > pageCount) throw new Error(`"${part}": 1~${pageCount}쪽 범위를 벗어났습니다.`);
    const step = a <= b ? 1 : -1;
    for (let p = a; step > 0 ? p <= b : p >= b; p += step) out.push(p - 1);
  }
  return out;
}

/** 텍스트 상자 배치: 9방위 위치 → 왼쪽 아래 기준 좌표 (PDF 좌표계, 단위 pt) */
export function placeText({ pageW, pageH, textW, textH, position = 'bc', margin = 36 }) {
  const [v, hz] = position.split('');
  const x = hz === 'l' ? margin : hz === 'r' ? pageW - margin - textW : (pageW - textW) / 2;
  const y = v === 't' ? pageH - margin - textH : v === 'b' ? margin : (pageH - textH) / 2;
  return { x, y };
}

/** 페이지 번호 문구 */
export function pageLabel(format, n, total) {
  return format.replace('{n}', n).replace('{total}', total);
}

export const hasNonLatin = (s) => /[^\u0000-ÿ]/.test(s);

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

export function downloadBytes(bytes, name, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 파일 → Uint8Array */
export async function readFile(file) { return new Uint8Array(await file.arrayBuffer()); }
