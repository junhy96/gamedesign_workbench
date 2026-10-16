// 실행: npm test  (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { design, validate, monotone, targetDay, fitGeometric, dailySupply } from '../js/supply/model.js';
import { TEMPLATES } from '../js/supply/presets.js';

const tpl = (id) => TEMPLATES[id].make();
const one = (over = {}) => ({
  days: 30, start: 0, ref: 0, round: 1, smooth: false, gapWarn: 3, currency: '재화',
  segments: [{ id: 'a', name: 'A' }],
  sources: [{ id: 's', name: '일일', amount: 10, period: 'day', unlock: 1, runs: { a: 1 } }],
  sinks: [{ id: 'g', name: '성장', share: 100, max: 10, start: 0, milestones: [{ day: 10, level: 10 }] }],
  ...over,
});

test('모든 템플릿이 검증을 통과하고 계산된다', () => {
  for (const id of Object.keys(TEMPLATES)) {
    assert.deepEqual(validate(tpl(id)), [], id);
    assert.equal(design(tpl(id)).ok, true, id);
  }
});

test('하루 10 공급, 10일에 Lv10 → 레벨당 10, 매일 1레벨', () => {
  const r = design(one());
  const k = r.sinks[0];
  assert.deepEqual(k.cost, Array(10).fill(10));
  assert.deepEqual(k.reach[0], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('기준 세그먼트는 마일스톤 일차에 정확히 도달 (보정·반올림 없음)', () => {
  const cfg = tpl('stone');
  cfg.smooth = false; cfg.round = 1;
  const r = design(cfg);
  for (const k of r.sinks) {
    for (const m of k.sink.milestones) {
      const i = k.levels.indexOf(m.level);
      const d = k.reach[cfg.ref][i];
      assert.ok(d != null && Math.abs(d - m.day) <= 1, `${k.sink.name} Lv${m.level}: ${d}일 (목표 ${m.day})`);
    }
  }
});

test('반올림해도 총량은 누적 기준으로 유지, 필요량은 단위의 배수', () => {
  const cfg = tpl('stone');
  const r = design(cfg);
  for (const k of r.sinks) {
    assert.equal(k.cost.reduce((a, b) => a + b, 0), k.total);
    assert.ok(k.cost.every(c => c % cfg.round === 0));
  }
});

test('단조 보정(PAV): 줄지 않고 합계 유지', () => {
  const xs = [5, 3, 8, 2, 2, 9, 1];
  const y = monotone(xs);
  for (let i = 1; i < y.length; i++) assert.ok(y[i] >= y[i - 1] - 1e-12);
  assert.ok(Math.abs(y.reduce((a, b) => a + b) - xs.reduce((a, b) => a + b)) < 1e-9);
  const cfg = tpl('stone'); cfg.round = 1;
  for (const k of design(cfg).sinks) for (let i = 1; i < k.cost.length; i++) assert.ok(k.cost[i] >= k.cost[i - 1] - 1, `${k.sink.name} Lv${k.levels[i]}`);
});

test('주기: 매주는 해금일부터 7일마다, 1회는 해금일만', () => {
  const cfg = one({ sources: [
    { id: 'w', name: '주간', amount: 100, period: 'week', unlock: 3, runs: { a: 1 } },
    { id: 'o', name: '1회', amount: 50, period: 'once', unlock: 5, runs: { a: 2 } },
  ] });
  const { daily } = dailySupply(cfg, cfg.segments[0], 20);
  assert.equal(daily[3], 100); assert.equal(daily[10], 100); assert.equal(daily[17], 100); assert.equal(daily[4], 0);
  assert.equal(daily[5], 100);
});

test('목표일 보간과 연장', () => {
  const g = { start: 0, milestones: [{ day: 10, level: 20 }, { day: 30, level: 30 }] };
  assert.equal(targetDay(g, 10), 5);
  assert.equal(targetDay(g, 25), 20);
  assert.equal(targetDay(g, 35), 40); // 마지막 구간 기울기로 연장
});

test('등비 근사: 정확한 등비 수열은 그대로 복원', () => {
  const costs = Array.from({ length: 20 }, (_, i) => 100 * 1.1 ** i);
  const f = fitGeometric(costs);
  assert.ok(Math.abs(f.base - 100) < 1e-6 && Math.abs(f.rate - 1.1) < 1e-9 && f.maxErr < 1e-9);
});

test('배분 합 100% 초과·마일스톤 역순은 경고·오류', () => {
  const cfg = one({ sinks: [
    { id: 'g', name: 'A', share: 80, max: 10, start: 0, milestones: [{ day: 10, level: 10 }] },
    { id: 'h', name: 'B', share: 40, max: 10, start: 0, milestones: [{ day: 10, level: 10 }] },
  ] });
  assert.match(design(cfg).warnings.map(w => w.text).join(), /배분 합이 120%/);
  const bad = one({ sinks: [{ id: 'g', name: 'A', share: 100, max: 10, start: 0, milestones: [{ day: 10, level: 5 }, { day: 5, level: 8 }] }] });
  assert.match(validate(bad).join(), /커지는 순서/);
});

test('곡선 연결: 마일스톤을 지나고, 항상 증가하며, 직선과 역함수가 일치', async () => {
  const { targetLevel } = await import('../js/supply/model.js');
  const g = { start: 0, milestones: [{ day: 7, level: 20 }, { day: 30, level: 40 }, { day: 90, level: 60 }] };
  for (const m of g.milestones) assert.ok(Math.abs(targetLevel(g, m.day, 'smooth') - m.level) < 1e-9);
  let prev = -1;
  for (let d = 0; d <= 120; d += 0.5) { const v = targetLevel(g, d, 'smooth'); assert.ok(v >= prev - 1e-9, `d=${d}`); prev = v; }
  for (const L of [5, 20, 33, 59]) assert.ok(Math.abs(targetLevel(g, targetDay(g, L, 'smooth'), 'smooth') - L) < 1e-6);
  // 감속하는 마일스톤이면 곡선은 첫 구간 중간에서 직선보다 앞선다(초반 빠름)
  assert.ok(targetLevel(g, 3.5, 'smooth') > targetLevel(g, 3.5, 'linear'));
  const cfg = tpl('stone'); cfg.curve = 'smooth'; cfg.smooth = false; cfg.round = 1;
  const r = design(cfg);
  for (const k of r.sinks) for (const m of k.sink.milestones) {
    const d = k.reach[cfg.ref][k.levels.indexOf(m.level)];
    assert.ok(Math.abs(d - m.day) <= 1, `${k.sink.name} Lv${m.level}: ${d}`);
  }
});
