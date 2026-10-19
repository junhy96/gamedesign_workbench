// 실행: npm test  (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';

// 브라우저 저장소 대신 메모리
globalThis.localStorage = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
const { TOOLS, toolKpis, compareKpis, saveSnapshot, listSnapshots, restoreSnapshot, deleteSnapshot, projectFile, loadProject, currentStates } = await import('../js/lib/snapshots.js');
const { store } = await import('../js/lib/util.js');

test('모든 탭의 기본 설정에서 핵심 지표가 계산된다', () => {
  for (const t of TOOLS) {
    const k = toolKpis(t, null);
    assert.ok(Array.isArray(k) && k.length >= 2, t.id);
    assert.ok(k.every(x => typeof x.label === 'string' && typeof x.value === 'number'), t.id);
  }
});

test('스냅샷 저장 → 설정 바꿈 → 비교 → 되돌리기', () => {
  const frame = TOOLS.find(t => t.id === 'frame');
  const base = frame.base();
  store.set(frame.key, base);
  const s = saveSnapshot('기준');
  assert.equal(listSnapshots()[0].name, '기준');
  const changed = { ...base, player: { ...base.player, dodgeInv: base.player.dodgeInv + 4 } };
  store.set(frame.key, changed);
  const rows = compareKpis(toolKpis(frame, s.states[frame.key]), toolKpis(frame, currentStates()[frame.key]));
  const tight = rows.find(r => r.label === '회피 불가');
  assert.ok(tight.after < tight.before, '무적을 늘리면 구르기로 못 피하던 돌진을 피함');
  restoreSnapshot(s);
  assert.equal(store.get(frame.key).player.dodgeInv, base.player.dodgeInv);
  // 저장 안 했던 탭은 되돌리면 지워짐(기본 템플릿)
  assert.equal(store.get('gacha:v1'), null);
  deleteSnapshot(s.id);
  assert.equal(listSnapshots().length, 0);
});

test('없앤 탭(수급·스테이지·재화 흐름)의 예전 데이터는 오류 없이 무시', () => {
  localStorage.m.clear();
  const old = { [TOOLS[0].key]: TOOLS[0].base(), 'supply:v1': { v: 1, x: 1 }, 'stage:v1': { v: 1, x: 2 }, 'economy:v2': { v: 2, x: 3 } };
  restoreSnapshot({ states: old });
  assert.equal(store.get('stage:v1'), null);
  assert.ok(!Object.keys(currentStates()).some(k => /^(supply|stage|economy):/.test(k)));
  loadProject({ tool: 'planning-workbench', current: old, snapshots: [{ id: 'old1', name: '예전', date: '2026-10-01', states: old }] });
  assert.equal(store.get('economy:v2'), null);
  assert.equal(listSnapshots()[0].name, '예전');
  assert.ok(TOOLS.every(t => toolKpis(t, listSnapshots()[0].states[t.key])));
  localStorage.m.clear();
});

test('프로젝트 파일: 지금 설정 + 스냅샷을 다른 브라우저로', () => {
  const battle = TOOLS.find(t => t.id === 'battle');
  store.set(battle.key, { ...battle.base(), level: 7 });
  saveSnapshot('A');
  const file = JSON.parse(JSON.stringify(projectFile()));
  localStorage.m.clear();
  loadProject(file);
  assert.equal(store.get(battle.key).level, 7);
  assert.equal(listSnapshots()[0].name, 'A');
  loadProject(file); // 같은 스냅샷은 두 번 들어가지 않음
  assert.equal(listSnapshots().length, 1);
  assert.throws(() => loadProject({ foo: 1 }));
});
