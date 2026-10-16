// 앱 셸: 탭 전환(#해시), 테마 전환. 각 도구는 처음 열 때 한 번만 mount.
import { store } from './lib/util.js';
import { mount as mountEnhance } from './enhance/view.js';
import { mount as mountFrame } from './frame/view.js';
import { mount as mountDiagram } from './diagram/view.js';
import { mount as mountEconomy } from './economy/view.js';

const TOOLS = {
  enhance: mountEnhance,
  economy: mountEconomy,
  frame: mountFrame,
  diagram: mountDiagram,
};
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
