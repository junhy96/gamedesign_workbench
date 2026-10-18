// 실행: npm test  (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { convergence, checkpoints, halfWidth } from '../js/lib/mcviz.js';
import { wilson, compileRules, duelSim } from '../js/battle/model.js';
import { TEMPLATES as BT } from '../js/battle/presets.js';
import { simulate, PATH_RUNS } from '../js/enhance/simulate.js';
import { TEMPLATES as ET } from '../js/enhance/presets.js';
import { simulateGoal } from '../js/gacha/model.js';
import { TEMPLATES as GT } from '../js/gacha/presets.js';

test('수렴: 마지막 점 = 전체 평균, 승률은 Wilson 범위, 끝나지 않은 시행이 있으면 없음', () => {
  assert.deepEqual(checkpoints(1), [1]);
  const cp = checkpoints(20000);
  assert.equal(cp[0], 1); assert.equal(cp.at(-1), 20000);
  for (let i = 1; i < cp.length; i++) assert.ok(cp[i] > cp[i - 1]);
  const xs = Array.from({ length: 1000 }, (_, i) => (i * 37) % 101);
  const c = convergence(xs);
  assert.equal(c.at(-1).n, 1000);
  assert.ok(Math.abs(c.at(-1).mean - xs.reduce((a, b) => a + b, 0) / 1000) < 1e-9);
  assert.ok(c.every(p => p.lo <= p.mean && p.mean <= p.hi));
  const bin = Array.from({ length: 500 }, (_, i) => (i % 3 === 0 ? 1 : 0));
  const b = convergence(bin, { binary: true }).at(-1);
  const [lo, hi] = wilson(bin.filter(Boolean).length, 500);
  assert.ok(Math.abs(b.lo - lo) < 1e-12 && Math.abs(b.hi - hi) < 1e-12);
  assert.equal(convergence([1, Infinity, 2]), null);
  assert.ok(halfWidth(c) > 0);
});

test('전투 시뮬레이션의 시행 순서 기록 = 승률, 강화 경로는 시작에서 목표까지, 가챠 수렴의 끝 = 평균', () => {
  const cfg = BT.traits.make();
  const { f } = compileRules(cfg);
  const sm = duelSim(cfg, f, cfg.entities[0], cfg.entities[1], 10, 1500, 4);
  assert.equal(sm.outcome.length, 1500);
  assert.ok(Math.abs(sm.outcome.filter(w => w === 1).length / 1500 - sm.winA) < 1e-12);
  assert.ok(Math.abs(sm.convergence.at(-1).mean - sm.winA) < 1e-12);
  assert.equal(sm.rawDur.length, 1500);

  const ec = Object.values(ET)[0].make();
  const mc = simulate(ec, 3000, 9);
  assert.equal(mc.paths.length, PATH_RUNS);
  for (const p of mc.paths) {
    if (p.cut) continue;
    assert.equal(p.stages.length, p.attempts + 1);
    assert.equal(p.stages[0], ec.start);
    assert.equal(p.stages.at(-1), ec.target);
    for (const x of p.destroys) assert.ok(x >= 1 && x < p.stages.length);
  }
  assert.ok(Math.abs(mc.convergence.at(-1).mean - mc.mean.cost) < 1e-6 * mc.mean.cost);

  const gc = GT.idle.make();
  const sim = simulateGoal(gc, gc.goals[0], 800, 5);
  assert.ok(Math.abs(sim.convergence.at(-1).mean - sim.mean) < 1e-9 * sim.mean);
});
