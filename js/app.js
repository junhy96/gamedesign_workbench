// 앱 셸: 탭 전환(#해시), 테마 전환. 각 도구는 처음 열 때 한 번만 mount.
import { store, toast } from './lib/util.js';
import { installUndo, undo, redo, canUndo, canRedo } from './lib/undo.js';
import { mount as mountEnhance } from './enhance/view.js';
import { mount as mountFrame } from './frame/view.js';
import { mount as mountDiagram } from './diagram/view.js';
import { mount as mountEconomy } from './economy/view.js';
import { mount as mountSupply } from './supply/view.js';
import { mount as mountGacha } from './gacha/view.js';
import { mount as mountStage } from './stage/view.js';
import { mount as mountBattle } from './battle/view.js';
import { mount as mountBrief } from './brief/view.js';
import { openSnapshots } from './lib/snapshot-view.js';

const TOOLS = {
  enhance: mountEnhance,
  gacha: mountGacha,
  supply: mountSupply,
  stage: mountStage,
  battle: mountBattle,
  economy: mountEconomy,
  frame: mountFrame,
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

function show(id) {
  if (!(id in TOOLS)) id = 'enhance';
  for (const btn of tabs) btn.setAttribute('aria-selected', String(btn.dataset.tab === id));
  for (const key of Object.keys(TOOLS)) document.getElementById(`tab-${key}`).hidden = key !== id;
  if (TOOLS[id] && !mounted.has(id)) { mounted.add(id); TOOLS[id](document.getElementById(`tab-${id}`)); }
}

const currentTab = () => location.hash.slice(1).split('?')[0];

for (const btn of tabs) {
  btn.addEventListener('click', () => {
    if (currentTab() !== btn.dataset.tab) history.replaceState(null, '', `#${btn.dataset.tab}`);
    show(btn.dataset.tab);
  });
}
window.addEventListener('hashchange', () => show(currentTab()));
show(currentTab());

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
