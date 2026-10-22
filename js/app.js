// 앱 셸: 탭 전환(#해시), 테마 전환. 각 도구는 처음 열 때 한 번만 mount.
import { store, toast } from './lib/util.js';
import { installUndo, undo, redo, canUndo, canRedo } from './lib/undo.js';
import { mount as mountEnhance } from './enhance/view.js';
import { mount as mountFrame } from './frame/view.js';
import { mount as mountDiagram } from './diagram/view.js';
import { mount as mountGacha } from './gacha/view.js';
import { mount as mountGrowth } from './growth/view.js';
import { mount as mountBattle } from './battle/view.js';
import { mount as mountBrief } from './brief/view.js';
import { mount as mountData } from './data/view.js';
import { mount as mountCombat } from './combat/view.js';
import { openSnapshots } from './lib/snapshot-view.js';
import { refreshCharts } from './lib/chart.js';
import { autoTips } from './lib/tip.js';
import { installFieldChecks } from './lib/fieldcheck.js';
import { initHomeShader } from './home/shader-bg.js';

const TOOLS = {
  enhance: mountEnhance,
  gacha: mountGacha,
  growth: mountGrowth,
  battle: mountBattle,
  combat: mountCombat,
  frame: mountFrame,
  data: mountData,
  brief: mountBrief,
  diagram: mountDiagram,
};
// 되돌리기: 탭이 처음 저장하기 전에 감싸야 하므로 탭을 열기 전에 시작
const undoBtn = document.getElementById('undo-btn'), redoBtn = document.getElementById('redo-btn');
const refreshUndo = () => {
  const t = location.hash.slice(1).split('?')[0] || 'enhance';
  const u = canUndo(t), r = canRedo(t);
  if (undoBtn) { undoBtn.disabled = !u; undoBtn.title = u ? `되돌리기 (Ctrl+Z) — ${u}단계` : '되돌리기 (Ctrl+Z)'; }
  if (redoBtn) { redoBtn.disabled = !r; redoBtn.title = r ? `다시 하기 (Ctrl+Shift+Z) — ${r}단계` : '다시 하기 (Ctrl+Shift+Z)'; }
};
installUndo(refreshUndo);
const doUndo = (back) => { const t = location.hash.slice(1).split('?')[0] || 'enhance'; if (!(back ? undo(t) : redo(t))) toast(back ? '되돌릴 단계가 없습니다' : '다시 할 단계가 없습니다'); };
undoBtn?.addEventListener('click', () => doUndo(true));
redoBtn?.addEventListener('click', () => doUndo(false));
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k !== 'z' && k !== 'y') return;
  const el = document.activeElement;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return; // 입력칸 안에서는 브라우저 기본 되돌리기
  e.preventDefault();
  doUndo(k === 'z' && !e.shiftKey);
});
window.addEventListener('hashchange', refreshUndo);

const mounted = new Set();
const tabs = [...document.querySelectorAll('[data-tab]')];

// 분류 메뉴: 지금 도구가 든 분류를 강조하고, 분류 버튼에 지금 도구 이름을 함께 보인다
const groups = [...document.querySelectorAll('.nav-group')];
const closeMenus = (except) => { for (const g of groups) if (g !== except) { g.classList.remove('open'); g.querySelector('.nav-trigger').setAttribute('aria-expanded', 'false'); } };
for (const g of groups) {
  const trig = g.querySelector('.nav-trigger'), items = [...g.querySelectorAll('.nav-menu [data-tab]')];
  const open = (on) => { g.classList.toggle('open', on); trig.setAttribute('aria-expanded', String(on)); if (on) closeMenus(g); };
  trig.addEventListener('click', () => open(!g.classList.contains('open'))); // 터치: 눌러서 열고 닫기
  g.addEventListener('mouseenter', () => { g.classList.remove('picked'); trig.setAttribute('aria-expanded', 'true'); });
  g.addEventListener('mouseleave', () => { g.classList.remove('picked'); open(false); });
  g.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { open(false); trig.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); open(true);
      const d = e.key === 'ArrowDown' ? 1 : -1;
      items[i < 0 ? (d > 0 ? 0 : items.length - 1) : (i + d + items.length) % items.length].focus();
    }
  });
  // 고른 뒤에는 마우스가 아직 위에 있어도 닫기 (다시 올리면 열림)
  for (const it of items) it.addEventListener('click', () => { open(false); g.classList.add('picked'); it.blur(); });
}
document.addEventListener('click', (e) => { if (!e.target.closest('.nav-group')) closeMenus(); });

function show(id) {
  if (!(id in TOOLS)) id = 'enhance';
  for (const btn of tabs) btn.toggleAttribute('aria-current', btn.dataset.tab === id);
  for (const g of groups) {
    const cur = g.querySelector(`.nav-menu [data-tab="${id}"]`);
    g.classList.toggle('active', !!cur);
    g.querySelector('.nav-cur').textContent = cur ? cur.querySelector('b').textContent : '';
  }
  for (const key of Object.keys(TOOLS)) document.getElementById(`tab-${key}`).hidden = key !== id;
  const panel = document.getElementById(`tab-${id}`);
  if (TOOLS[id] && !mounted.has(id)) { mounted.add(id); TOOLS[id](panel); autoTips(panel, id); installFieldChecks(panel); }
  else requestAnimationFrame(() => refreshCharts(panel)); // 숨어 있는 동안 크기를 못 잡은 그래프를 다시 그림
}

const currentTab = () => location.hash.slice(1).split('?')[0];
// 첫 랜딩: 주소에 도구(#enhance 등)가 없으면 소개 화면. 도구 링크는 그대로 도구를 연다
const TOOL_IDS = new Set([...document.querySelectorAll('[data-tab]')].map(b => b.dataset.tab));
const isHome = () => { const t = currentTab(); return !t || t === 'home' || !TOOL_IDS.has(t); };
const setHome = () => {
  const home = isHome() && !currentTab().startsWith('hm-');
  document.body.classList.toggle('home', home || currentTab().startsWith('hm-'));
  document.documentElement.classList.remove('pre-home');
  if (home) for (const g of groups) { g.classList.remove('active'); g.querySelector('.nav-cur').textContent = ''; }
  return home || currentTab().startsWith('hm-');
};

for (const btn of tabs) {
  btn.addEventListener('click', () => {
    const wasHome = document.body.classList.contains('home');
    if (currentTab() !== btn.dataset.tab) history[wasHome ? 'pushState' : 'replaceState'](null, '', `#${btn.dataset.tab}`);
    setHome();
    show(btn.dataset.tab);
    if (wasHome) window.scrollTo({ top: 0 });
  });
}
window.addEventListener('hashchange', () => {
  if (currentTab().startsWith('hm-')) { document.getElementById(currentTab())?.scrollIntoView({ behavior: 'smooth' }); return; }
  if (setHome()) { window.scrollTo({ top: 0 }); return; }
  show(currentTab()); window.scrollTo({ top: 0 });
});
// 로고: 처음 화면(첫 도구, 맨 위)으로
document.getElementById('brand-home')?.addEventListener('click', (e) => {
  e.preventDefault();
  closeMenus();
  history.pushState(null, '', location.pathname);
  setHome();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
initHomeShader();   // 모든 화면 뒤 배경(WebGPU): 한가할 때 늦게 불러온다
if (!setHome()) show(currentTab());
else { show('enhance'); setHome(); for (const b of tabs) b.removeAttribute('aria-current'); }   // 도구는 뒤에서 미리 준비

// 테마: OS 설정을 따르되, 버튼으로 명시 선택 가능
document.getElementById('theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  const isDark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = isDark ? 'light' : 'dark';
  store.set('theme', root.dataset.theme);
  document.dispatchEvent(new Event('themechange'));
});

// 고정 헤더 높이 → CSS 변수 (도구 안의 고정 띠가 헤더 바로 아래에 붙도록)
const header = document.querySelector('.app-header');
if (header) new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`)).observe(header);

// 스냅샷: 모든 탭 설정 저장·비교·되돌리기
document.getElementById('snap-open')?.addEventListener('click', openSnapshots);
