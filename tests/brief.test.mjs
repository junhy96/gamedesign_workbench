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
  const stage = TOOLS.find(t => t.id === 'stage'), battle = TOOLS.find(t => t.id === 'battle');
  const base = { [stage.key]: stage.base() };
  const now = { [stage.key]: { ...stage.base(), hpGrowth: 1.045 } };
  const brief = {
    include: { gacha: false, economy: false },
    goals: { [goalKey('stage', '총 소요')]: { op: '<=', value: 100 }, [goalKey('battle', 'Lv10 암살자 평균 승률')]: { op: '<=', value: 60 } },
  };
  const rep = buildReport(brief, now, base);
  assert.ok(!rep.tools.some(t => t.tool.id === 'gacha' || t.tool.id === 'economy'));
  const st = rep.tools.find(t => t.tool.id === 'stage');
  assert.equal(st.changed, true);
  const total = st.rows.find(r => r.label === '총 소요');
  assert.ok(total.after > total.before);
  assert.equal(total.verdict, total.after <= 100 ? 'pass' : 'fail');
  const bt = rep.tools.find(t => t.tool.id === 'battle');
  assert.equal(bt.changed, false);
  assert.equal(bt.rows.find(r => r.label === 'Lv10 암살자 평균 승률').verdict, 'fail'); // 77% > 60%
  assert.ok(rep.summary.failed.includes('스탯·전투 · Lv10 암살자 평균 승률'));
  assert.ok(st.issues.length <= 4 && st.issues.every(x => x.text));
  assert.ok(rep.summary.serious >= 1);
});
