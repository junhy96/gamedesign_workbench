// 전 탭 공통 되돌리기·다시 하기 — 각 탭이 설정을 저장(store.set)할 때마다 직전 저장본을 기록하고,
// 되돌릴 때는 그 탭이 이미 가진 "공유 링크로 불러오기"(#탭?s=…) 경로로 넣는다. 탭 코드를 고치지 않아도 모든 탭에서 동작.
// 기록은 이 창이 열려 있는 동안만(메모리), 탭마다 최대 50단계. 탭은 입력 0.3초 뒤에 저장하므로 한 단계 ≈ 입력 한 덩어리.
import { store, encodeState } from './util.js';

export const TAB_KEYS = {
  enhance: 'enhance:v2', gacha: 'gacha:v1', battle: 'battle:v1', frame: 'frame:v1', diagram: 'diagram:v1',
};
const KEY_TAB = Object.fromEntries(Object.entries(TAB_KEYS).map(([t, k]) => [k, t]));
const LIMIT = 50;
const hist = {}; // 저장 키 → { undo: [json], redo: [json], last: json }
let applying = null, applyTimer, listener = () => {};

const H = (key) => (hist[key] ??= { undo: [], redo: [], last: undefined });

/** store.set을 감싸 기록을 시작한다. onChange = 되돌릴 수 있는 단계 수가 바뀔 때 */
export function installUndo(onChange = () => {}) {
  listener = onChange;
  const orig = store.set.bind(store);
  store.set = (key, val) => {
    if (KEY_TAB[key]) record(key, JSON.stringify(val ?? null));
    orig(key, val);
  };
}

/** 저장 한 번 기록 (테스트에서도 직접 부름) */
export function record(key, json) {
  const h = H(key);
  if (h.last === undefined) { const prev = store.get(key); h.last = prev == null ? null : JSON.stringify(prev); }
  if (json === h.last) { if (applying === key) { applying = null; clearTimeout(applyTimer); } return; }
  if (applying === key) { applying = null; clearTimeout(applyTimer); } // 되돌리기로 들어간 상태를 그 탭이 다시 저장한 것
  else if (h.last != null) { h.undo.push(h.last); if (h.undo.length > LIMIT) h.undo.shift(); h.redo = []; }
  h.last = json;
  listener();
}

export const canUndo = (tab) => (hist[TAB_KEYS[tab]]?.undo.length ?? 0);
export const canRedo = (tab) => (hist[TAB_KEYS[tab]]?.redo.length ?? 0);

/** 되돌린 상태 json을 돌려주고, apply(tab, state)로 화면에 넣는다 (기본: 공유 링크 경로) */
function step(tab, from, to, apply) {
  const key = TAB_KEYS[tab], h = hist[key];
  if (!h || !h[from].length) return false;
  const json = h[from].pop();
  h[to].push(h.last);
  h.last = json;
  applying = key;
  clearTimeout(applyTimer);
  applyTimer = setTimeout(() => { if (applying === key) applying = null; }, 1500);
  apply(tab, JSON.parse(json));
  listener();
  return true;
}
const viaHash = (tab, st) => { location.hash = `#${tab}?s=${encodeState(st)}`; };
export const undo = (tab, apply = viaHash) => step(tab, 'undo', 'redo', apply);
export const redo = (tab, apply = viaHash) => step(tab, 'redo', 'undo', apply);
