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
  const stage = TOOLS.find(t => t.id === 'stage');
  store.set(stage.key, stage.base());
  const s = saveSnapshot('기준');
  assert.equal(listSnapshots()[0].name, '기준');
  const changed = { ...stage.base(), hpGrowth: 1.045 };
  store.set(stage.key, changed);
  const rows = compareKpis(toolKpis(stage, s.states[stage.key]), toolKpis(stage, currentStates()[stage.key]));
  const total = rows.find(r => r.label === '총 소요');
  assert.ok(total.after > total.before, '체력 증가율을 올리면 총 소요가 늘어남');
  restoreSnapshot(s);
  assert.equal(store.get(stage.key).hpGrowth, 1.04);
  // 저장 안 했던 탭은 되돌리면 지워짐(기본 템플릿)
  assert.equal(store.get('gacha:v1'), null);
  deleteSnapshot(s.id);
  assert.equal(listSnapshots().length, 0);
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
