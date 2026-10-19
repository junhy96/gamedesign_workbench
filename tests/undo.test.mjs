// 실행: npm test  (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
const { store } = await import('../js/lib/util.js');
const { installUndo, undo, redo, canUndo, canRedo } = await import('../js/lib/undo.js');

test('되돌리기·다시 하기: 저장마다 한 단계, 되돌린 상태를 탭이 다시 저장해도 단계가 늘지 않음', () => {
  let changes = 0;
  installUndo(() => changes++);
  const applied = [];
  const apply = (tab, st) => { applied.push(st); store.set('frame:v1', st); }; // 탭이 불러온 뒤 다시 저장하는 것 흉내
  store.set('frame:v1', { a: 1 }); // 처음 저장(탭 열 때) — 되돌릴 대상 없음
  assert.equal(canUndo('frame'), 0);
  store.set('frame:v1', { a: 2 });
  store.set('frame:v1', { a: 2 }); // 같은 내용은 단계 아님
  store.set('frame:v1', { a: 3 });
  assert.equal(canUndo('frame'), 2);
  assert.ok(undo('frame', apply));
  assert.deepEqual(applied.at(-1), { a: 2 });
  assert.equal(canUndo('frame'), 1); assert.equal(canRedo('frame'), 1);
  assert.ok(undo('frame', apply));
  assert.deepEqual(applied.at(-1), { a: 1 });
  assert.equal(undo('frame', apply), false);
  assert.ok(redo('frame', apply));
  assert.deepEqual(applied.at(-1), { a: 2 });
  // 새로 고치면 다시 하기 목록은 사라짐
  store.set('frame:v1', { a: 9 });
  assert.equal(canRedo('frame'), 0);
  assert.equal(canUndo('frame'), 2);
  // 탭마다 따로, 탭 키가 아닌 저장은 기록 안 함
  store.set('battle:v1', { b: 1 }); store.set('battle:v1', { b: 2 });
  store.set('frame:sideOpen', { x: 1 }); store.set('frame:sideOpen', { x: 2 });
  assert.equal(canUndo('battle'), 1);
  assert.equal(canUndo('frame'), 2);
  assert.ok(changes > 0);
});
