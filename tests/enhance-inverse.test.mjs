// 강화 역산 (확률·비용 가중치): 곱셈 분배, 범위 고정과 넘김, 페널티 구조의 이분 탐색, 반올림 오차, 실패 보정 반영
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWeighted, solveWeighted, expectedCost, roundCost, migrate } from '../js/enhance/model.js';
import { TEMPLATES } from '../js/enhance/presets.js';

const cfgOf = (id) => { const st = migrate({ v: 3, template: id, ...TEMPLATES[id].make() }); return { rows: st.rows, resources: st.resources, start: st.start, target: st.target, restore: st.restore, destroyCosts: st.destroyCosts, double: st.double, streak: st.streak, items: st.items, usage: st.usage, event: st.event }; };
const single = () => { const c = cfgOf('blank'); c.rows = [{ stage: 0, s: 50, s2: 0, k: 50, d: 0, b: 0, costs: c.rows[0].costs.map((x, i) => (i === 0 ? 1000 : 0)) }]; c.start = 0; c.target = 1; return c; };

test('한 단계(페널티 없음): E = 비용 ÷ 확률, F = E0 ÷ 목표, 확률 ×F^w · 비용 ÷F^(1−w)', () => {
  const c = single();
  const E0 = expectedCost(c).cost;
  const unit = E0 / 2000; // 재화 환산 단위
  for (const w of [0, 0.3, 0.5, 1]) {
    const r = solveWeighted(c, E0 / 2, { w });
    assert.ok(r.ok, r.error);
    assert.ok(Math.abs(r.s - 2) < 1e-5, `w=${w} s=${r.s}`); // 확률을 0.0001% 단위로 반올림하므로
    const st = r.stages[0];
    assert.ok(Math.abs(st.p1 - 50 * 2 ** w) < 1e-3, `w=${w} p=${st.p1}`);
    assert.ok(Math.abs(st.c1[0] - 1000 / 2 ** (1 - w)) < 1e-3, `w=${w} c=${st.c1[0]}`);
    assert.ok(Math.abs(r.E - E0 / 2) < 1e-6 * E0);
  }
  void unit;
});

test('확률이 100%를 넘으면 100%에 고정하고 남은 개선은 비용으로 넘김', () => {
  const c = single();
  const E0 = expectedCost(c).cost;
  const r = solveWeighted(c, E0 / 4, { w: 1 }); // 확률만 4배 → 200%는 불가
  assert.ok(r.ok);
  const st = r.stages[0];
  assert.ok(Math.abs(st.p1 - 100) < 1e-6);
  assert.ok(Math.abs(st.c1[0] - 500) < 1e-3); // 남은 2배를 비용으로
  assert.ok(st.clampP);
  const a = applyWeighted(c.rows[0], 4, 1, { pMax: 80 });
  assert.ok(Math.abs(a.row.s - 80) < 1e-6 && Math.abs(a.fc - 4 / 1.6) < 1e-9);
  // 비용 하한(원래의 0.5배)에 막히면 확률로
  const b = applyWeighted(c.rows[0], 4, 0, { cMin: 0.5 });
  assert.ok(Math.abs(b.row.costs[0] - 500) < 1e-6 && Math.abs(b.row.s - 100) < 1e-6 && b.clampC);
});

test('하락·파괴가 있는 여러 단계: 이분 탐색으로 목표 기대 비용에 맞춤 (가중치 0·0.5·1)', () => {
  const c = cfgOf('standard');
  const E0 = expectedCost(c).cost;
  for (const w of [0, 0.5, 1]) {
    const r = solveWeighted(c, E0 * 0.7, { w, from: c.start, to: c.target - 1 });
    assert.ok(r.ok, r.error);
    assert.ok(Math.abs(r.E - E0 * 0.7) / E0 < 1e-6, `w=${w}`);
    if (w === 0) assert.ok(r.stages.every(x => Math.abs(x.p1 - x.p0) < 1e-6)); // 비용만
    if (w === 1) assert.ok(r.stages.every(x => x.clampP || Math.abs(x.c1[0] - x.c0[0]) < 1e-6)); // 확률만 (100%에 막힌 단계만 비용으로 넘김)
  }
});

test('반올림 규칙: 단위·방식, 반올림 뒤 기대 비용과 목표의 오차', () => {
  assert.equal(roundCost(1234.5, 10, 'round'), 1230);
  assert.equal(roundCost(1231, 10, 'ceil'), 1240);
  assert.equal(roundCost(1239, 100, 'floor'), 1200);
  assert.equal(roundCost(12.34, 0), 12.34);
  const c = cfgOf('standard');
  const E0 = expectedCost(c).cost;
  const r = solveWeighted(c, E0 * 0.8, { w: 0.5, from: c.start, to: c.target - 1, unit: 100, mode: 'round' });
  assert.ok(r.stages.every(x => x.c1r.every(v => v % 100 === 0)));
  assert.ok(Math.abs(r.Er - r.E) > 0);
  assert.ok(Math.abs(r.error - (r.Er - E0 * 0.8)) < 1e-9);
});

test('실패 보정(누적 보너스·천장)을 켜면 같은 목표에 필요한 개선이 줄어듦 (역산에 반영)', () => {
  const base = cfgOf('standard');
  const withPity = { ...base, streak: { ...base.streak, kind: 'fail', bonus: 5, bonusMode: 'abs', cap: 100, pity: 10 } };
  const E0 = expectedCost(base).cost;
  const a = solveWeighted(base, E0 * 0.6, { w: 1, from: base.start, to: base.target - 1 });
  const b = solveWeighted(withPity, E0 * 0.6, { w: 1, from: base.start, to: base.target - 1 });
  assert.ok(a.ok && b.ok);
  assert.ok(b.s < a.s, `${b.s} < ${a.s}`);
});
