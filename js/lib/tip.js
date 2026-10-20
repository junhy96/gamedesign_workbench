// 용어 툴팁 — 항목명 옆의 작은 (i) 아이콘. 마우스를 올리거나 키보드로 초점을 주면 어두운 설명 상자가 뜬다.
// 설명 문구는 js/data/glossary.json 한곳에서 관리한다 (키 → { t: 제목, d: 뜻, u: 쓰는 법 }).
import GLOSSARY from '../data/glossary.json' with { type: 'json' };

export const glossary = GLOSSARY;
export const term = (key) => GLOSSARY[key] || null;

/** (i) 아이콘. key가 용어 데이터에 없으면 아무것도 그리지 않는다 (테스트가 빠진 키를 잡는다) */
export function tip(key) {
  const g = GLOSSARY[key];
  if (!g || typeof document === 'undefined') return null;
  const el = document.createElement('span');
  el.className = 'tip-i';
  el.tabIndex = 0;
  el.dataset.tip = key;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${g.t} 설명: ${g.d}${g.u ? ' ' + g.u : ''}`);
  el.textContent = 'i';
  installTips();
  return el;
}

/** 항목명 + (i): label(text, key) → [text, 아이콘] — h(...)의 자식으로 바로 넣는다 */
export const label = (text, key) => [text, tip(key)];

// ── 기존 화면에 자동으로 붙이기 ─────────────────────────
// 용어 데이터의 m(붙일 항목명, 끝이 *면 앞부분 일치)과 s(탭)를 보고, 탭이 다시 그려질 때마다 항목명 옆에 (i)를 단다.
// 화면 코드마다 tip()을 넣지 않아도 용어 데이터 한곳만 고치면 된다.
const LABEL_SEL = 'th, h2, h3, .kpi-label, .group-title, summary, legend, .field > span, label > span, label.switch';
const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** 탭 하나의 [키, 항목명] 목록 (긴 항목명부터 — "민감도 변동폭"이 "민감도"보다 먼저) */
export function matchersFor(tab) {
  const out = [];
  for (const [key, g] of Object.entries(GLOSSARY)) {
    if (!g.m || (g.s && !g.s.includes(tab))) continue;
    for (const m of g.m) out.push({ key, prefix: m.endsWith('*'), text: m.endsWith('*') ? m.slice(0, -1) : m });
  }
  return out.sort((a, b) => b.text.length - a.text.length || Number(a.prefix) - Number(b.prefix));
}
/** 항목명 문자열 → 용어 키 (없으면 null) */
export function matchLabel(matchers, text) {
  const t = norm(text);
  const hit = matchers.find(m => (m.prefix ? t.startsWith(m.text) : t === m.text));
  return hit ? hit.key : null;
}

export function autoTips(root, tab) {
  const matchers = matchersFor(tab);
  if (!matchers.length) return;
  let pending = false;
  const scan = () => {
    pending = false;
    for (const el of root.querySelectorAll(LABEL_SEL)) {
      if (el.querySelector('.tip-i') || el.closest('.tip-i')) continue;
      const key = matchLabel(matchers, el.textContent);
      if (!key) continue;
      // summary > h3 처럼 항목명을 담은 안쪽 요소에 붙인다
      let target = el;
      const head = matchers.find(m => m.key === key && norm(el.textContent).startsWith(m.text)).text;
      while (target.firstElementChild && !target.firstElementChild.classList.contains('tip-i') && norm(target.firstElementChild.textContent).startsWith(head)) target = target.firstElementChild;
      const icon = tip(key);
      if (icon) target.append(icon);
    }
  };
  const schedule = () => { if (!pending) { pending = true; setTimeout(scan, 0); } };
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
  schedule();
}

let box = null, cur = null;
function installTips() {
  if (box) return;
  box = document.createElement('div');
  box.className = 'tip-box';
  box.setAttribute('role', 'tooltip');
  box.hidden = true;
  document.body.append(box);
  const show = (el) => {
    const g = GLOSSARY[el.dataset.tip];
    if (!g) return;
    cur = el;
    box.replaceChildren();
    const t = document.createElement('b'); t.textContent = g.t;
    const d = document.createElement('p'); d.textContent = g.d;
    box.append(t, d);
    if (g.u) { const u = document.createElement('p'); u.className = 'use'; u.textContent = g.u; box.append(u); }
    box.hidden = false;
    const r = el.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
    let x = r.left + r.width / 2 - bw / 2, y = r.top - bh - 8;
    if (y < 8) y = r.bottom + 8;
    x = Math.max(8, Math.min(x, innerWidth - bw - 8));
    box.style.left = `${x}px`; box.style.top = `${y}px`;
  };
  const hide = (el) => { if (!el || el === cur) { box.hidden = true; cur = null; } };
  document.addEventListener('mouseover', (e) => { const el = e.target.closest?.('.tip-i'); if (el) show(el); });
  document.addEventListener('mouseout', (e) => { const el = e.target.closest?.('.tip-i'); if (el && !el.contains(e.relatedTarget)) hide(el); });
  document.addEventListener('focusin', (e) => { if (e.target.classList?.contains('tip-i')) show(e.target); });
  document.addEventListener('focusout', (e) => { if (e.target.classList?.contains('tip-i')) hide(e.target); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  // 접이식 제목(summary)·라벨 안의 (i)를 눌러도 펼침·선택이 바뀌지 않게
  document.addEventListener('click', (e) => { if (e.target.closest?.('.tip-i')) { e.preventDefault(); e.stopPropagation(); } }, true);
  addEventListener('scroll', () => hide(), true);
}
