// 공통 유틸: 숫자 포맷, 저장소, 공유 링크, 파일 입출력, 토스트

const nf = new Intl.NumberFormat('ko-KR');
export const comma = (n) => nf.format(Math.round(n));

/** 한국식 큰 수: 1조 2,345억 / 713억 1,650만 / 7,132만 */
export function fmtMoney(n) {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  const units = [[1e12, '조'], [1e8, '억'], [1e4, '만'], [1, '']];
  for (let u = 0; u < units.length - 1; u++) {
    const [size, name] = units[u];
    if (n >= size) {
      let major = Math.floor(n / size);
      const [nextSize, nextName] = units[u + 1];
      let minor = Math.round((n - major * size) / nextSize);
      if (minor >= size / nextSize) { major += 1; minor = 0; } // 반올림 올림 처리 (예: 9,999.6 → 1만)
      return minor > 0 && major < 10000
        ? `${sign}${comma(major)}${name} ${comma(minor)}${nextName}`
        : `${sign}${comma(major)}${name}`;
    }
  }
  return sign + comma(n);
}

/** 짧은 표기 (한 단위만): 230억 / 1.2조 / 7,132만 — 좁은 칸용 */
export function fmtMoneyShort(n) {
  if (!Number.isFinite(n)) return '—';
  for (const [size, name] of [[1e12, '조'], [1e8, '억'], [1e4, '만']]) {
    if (Math.abs(n) >= size) {
      const v = n / size;
      return `${Math.abs(v) < 10 ? v.toFixed(1).replace(/\.0$/, '') : comma(v)}${name}`;
    }
  }
  return comma(n);
}

export const fmtPct = (p, d = 1) => (Number.isFinite(p) ? `${(p * 100).toFixed(d)}%` : '—');
export const fmtNum = (x, d = 1) => (Number.isFinite(x) ? (x >= 1000 ? comma(x) : x.toFixed(d)) : '—');

// localStorage: 같은 github.io 계정의 다른 페이지와 키가 겹치지 않게 접두어 사용.
// 사생활 보호 모드 등에서 예외가 날 수 있으므로 항상 try/catch.
const PREFIX = 'planwb:';
export const store = {
  get(key) { try { const v = localStorage.getItem(PREFIX + key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(key, val) { try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch { /* 저장 불가 환경 */ } },
  remove(key) { try { localStorage.removeItem(PREFIX + key); } catch { /* 무시 */ } },
};

// 공유 링크: 설정을 URL의 # 뒤에 담는다 (# 뒤는 서버로 전송되지 않음).
export function encodeState(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeState(str) {
  try {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
  } catch { return null; }
}

export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickJSON() {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    input.onchange = async () => {
      try { resolve(JSON.parse(await input.files[0].text())); } catch (e) { reject(e); }
    };
    input.click();
  });
}

let toastTimer;
export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' }); document.body.append(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

export function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** 작은 DOM 헬퍼: h('div.cls', {attrs}, ...children). 텍스트는 항상 textContent로. */
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v; // 코드 안에서 만든 고정 SVG 아이콘 전용 (외부 입력 금지)
    else if (k === 'value' || (k in el && typeof v !== 'string')) el[k] = v; // textarea는 value 속성이 아니라 프로퍼티로만 반영됨
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
