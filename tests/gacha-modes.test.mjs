// 가챠: 10연 보장(등급별 실제 비율, 한 번씩 뽑는 시뮬레이션), 소환 레벨 레벨업 비용·보상
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, gradeRates, simulateGoal, tenRelevant } from '../js/gacha/model.js';
import { TEMPLATES } from '../js/gacha/presets.js';

test('등급별 실제 비율: 보장 없으면 표기 확률, 10연 보장이면 공식대로 (합 100%)', () => {
  const cfg = TEMPLATES.pity.make();
  const base = cfg.grades.map(g => g.probs[0] / 100);
  assert.deepEqual(gradeRates(cfg), base);
  const G = cfg.grades.length - 2;
  const c2 = { ...cfg, ten: { enabled: true, grade: cfg.grades[G].id } };
  const r = gradeRates(c2);
  assert.ok(Math.abs(r.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  const q = base.slice(G).reduce((a, b) => a + b, 0), a = (1 - q) ** 9;
  assert.ok(Math.abs(r[G] - (9 * base[G] + (1 - a) * base[G] + a * base[G] / q) / 10) < 1e-12);
  assert.ok(r[G] > base[G] && r[0] < base[0]);
});

test('한 번씩 뽑는 시뮬레이션 = 건너뛰는 시뮬레이션 (보장이 아무 효과 없을 때)', () => {
  const cfg = TEMPLATES.pity.make();
  const goal = cfg.goals[0];
  const fast = simulateGoal(cfg, goal, 3000, 11);
  const per = simulateGoal({ ...cfg, ten: { enabled: true, grade: cfg.grades[0].id } }, goal, 3000, 11); // 최하위 이상 = 항상 만족
  assert.ok(tenRelevant({ ...cfg, ten: { enabled: true, grade: cfg.grades[0].id } }, goal));
  const se = Math.max(fast.mean, per.mean) * 0.05;
  assert.ok(Math.abs(fast.mean - per.mean) < se, `${fast.mean} vs ${per.mean}`);
});

test('10연 보장은 보장 등급 목표의 기대 뽑기를 줄이고, 그보다 낮은 등급 목표에는 공식 계산을 그대로 씀', () => {
  const cfg = TEMPLATES.pity.make();
  const G = cfg.grades.length - 2;
  const goal = { id: 'x', name: 'SR 하나', type: 'unit', grade: cfg.grades[G].id, kinds: 1, copies: 1 };
  const low = { id: 'y', name: '하위', type: 'unit', grade: cfg.grades[0].id, kinds: 1, copies: 1 };
  const off = analyze({ ...cfg, goals: [goal, low], runs: 2000 });
  const on = analyze({ ...cfg, goals: [goal, low], runs: 2000, ten: { enabled: true, grade: cfg.grades[G].id } });
  assert.ok(on.goals[0].mean < off.goals[0].mean, `${on.goals[0].mean} < ${off.goals[0].mean}`);
  assert.equal(on.goals[0].tenSim, true);
  assert.equal(on.goals[1].tenSim, false);
});

test('소환 레벨 레벨업 비용·보상: 지나간 레벨마다 (비용 − 보상) × P(뽑기 수 ≥ 레벨 기준)', () => {
  const cfg = TEMPLATES.idle.make();
  const r0 = analyze({ ...cfg, runs: 800 });
  const r1 = analyze({ ...cfg, runs: 800, levelUp: { cost: 30, reward: 10 } });
  const g = r1.goals[0];
  const manual = cfg.levels.slice(1).reduce((a, from) => a + 20 * (1 - g.reach(from - 1)), 0);
  assert.ok(Math.abs(g.levelAdj - manual) < 1e-9);
  assert.ok(g.levelAdj > 0);
  assert.equal(r0.goals[0].levelAdj, 0);
});
