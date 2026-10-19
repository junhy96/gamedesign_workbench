// 실행: npm test  (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
const { judge, buildReport, goalKey } = await import('../js/brief/model.js');
const { TOOLS } = await import('../js/lib/snapshots.js');

test('목표 판정: ≤·≥, 목표 없음', () => {
  assert.equal(judge(5, { op: '<=', value: 5 }), 'pass');
  assert.equal(judge(5.1, { op: '<=', value: 5 }), 'fail');
  assert.equal(judge(5, { op: '>=', value: 6 }), 'fail');
  assert.equal(judge(5, null), null);
  assert.equal(judge(NaN, { op: '<=', value: 5 }), null);
});

test('브리핑: 기준 대비 바뀐 탭·변화, % 지표 목표는 % 단위, 미달 목록, 제외한 탭', () => {
  const frame = TOOLS.find(t => t.id === 'frame'), battle = TOOLS.find(t => t.id === 'battle');
  const fb = frame.base();
  const base = { [frame.key]: fb };
  const now = { [frame.key]: { ...fb, player: { ...fb.player, dodgeInv: fb.player.dodgeInv + 4 } } };
  const brief = {
    include: { gacha: false, economy: false }, // 없앤 탭 id가 남아 있어도 무시
    goals: { [goalKey('frame', '회피 불가')]: { op: '<=', value: 0 }, [goalKey('battle', 'Lv10 암살자 평균 승률')]: { op: '<=', value: 60 } },
  };
  const rep = buildReport(brief, now, base);
  assert.ok(!rep.tools.some(t => t.tool.id === 'gacha'));
  assert.deepEqual(rep.tools.map(t => t.tool.id), ['enhance', 'growth', 'battle', 'frame']);
  const fr = rep.tools.find(t => t.tool.id === 'frame');
  assert.equal(fr.changed, true);
  const tight = fr.rows.find(r => r.label === '회피 불가');
  assert.ok(tight.after < tight.before);
  assert.equal(tight.verdict, tight.after <= 0 ? 'pass' : 'fail');
  const bt = rep.tools.find(t => t.tool.id === 'battle');
  assert.equal(bt.changed, false);
  assert.equal(bt.rows.find(r => r.label === 'Lv10 암살자 평균 승률').verdict, 'fail'); // 77% > 60%
  assert.ok(rep.summary.failed.includes('스탯·전투 · Lv10 암살자 평균 승률'));
  assert.ok(fr.issues.length <= 4 && fr.issues.every(x => x.text));
  assert.ok(rep.summary.serious >= 1);
});
