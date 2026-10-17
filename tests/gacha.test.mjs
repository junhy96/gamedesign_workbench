// 실행: npm test  (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, validate, simulateGoal, exactCollectMean, exactPickup, gammaP, noDupConfig, topProb } from '../js/gacha/model.js';
import { TEMPLATES } from '../js/gacha/presets.js';

const tpl = (id) => TEMPLATES[id].make();
const base = (over = {}) => ({
  pullCost: 100, wonPerGem: 1, levels: [0],
  grades: [{ id: 'a', name: '일반', kinds: 10, probs: [95], shard: 0, exchange: 0 }, { id: 'b', name: '희귀', kinds: 5, probs: [5], shard: 0, exchange: 0 }],
  pity: { enabled: false, hard: 100, softStart: 80, softStep: 0 },
  pickup: { enabled: false, share: 50, guarantee: false },
  mileage: { enabled: false, per: 1, cost: 200 },
  user: { freePerDay: 100, monthlyWon: 0 },
  goals: [{ id: 'g', name: '목표', type: 'collect', grade: 'b', kinds: 5, copies: 1 }],
  ...over,
});
const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg ?? ''} ${a} vs ${b} (허용 ${rel * 100}%)`);
const H = (n) => { let s = 0; for (let i = 1; i <= n; i++) s += 1 / i; return s; };

test('모든 템플릿이 검증을 통과하고 계산된다', () => {
  for (const id of Object.keys(TEMPLATES)) {
    assert.deepEqual(validate(tpl(id)), [], id);
    const r = analyze(tpl(id));
    assert.equal(r.ok, true, id);
    for (const g of r.goals) assert.ok(Number.isFinite(g.mean) && g.mean > 0, `${id} ${g.goal.name}`);
  }
});

test('정칙화 감마 P(1, x) = 1 − e^−x, P(a, ∞) → 1', () => {
  for (const x of [0.1, 1, 5, 30]) close(gammaP(1, x), 1 - Math.exp(-x), 1e-12);
  close(gammaP(50, 500), 1, 1e-12);
  close(gammaP(3, 2), 1 - Math.exp(-2) * (1 + 2 + 2), 1e-12); // 포아송(2) ≥ 3
});

test('정확해 ①: 쿠폰 수집 n종 1장씩 = n·Hₙ / p', () => {
  for (const n of [1, 5, 20]) {
    const cfg = base();
    cfg.grades[1].kinds = n; cfg.goals[0].kinds = n;
    close(exactCollectMean(cfg, cfg.goals[0]), n * H(n) / 0.05, 1e-6, `n=${n}`);
  }
});

test('정확해 ①: 1종 k장 = k ÷ (p/n) (음이항 평균)', () => {
  const cfg = base();
  cfg.goals[0] = { ...cfg.goals[0], kinds: 1, copies: 7 };
  close(exactCollectMean(cfg, cfg.goals[0]), 7 / (0.05 / 5), 1e-6);
});

test('정확해 ① = 시뮬레이션 (5종 × 3장)', () => {
  const cfg = base();
  cfg.goals[0].copies = 3;
  close(simulateGoal(cfg, cfg.goals[0], 20000).mean, exactCollectMean(cfg, cfg.goals[0]), 0.02);
});

test('정확해 ②: 천장·픽업 없음 → k ÷ (p × 픽업 비율)', () => {
  const cfg = base({ goals: [{ id: 'p', name: '픽업', type: 'pickup', copies: 3 }] });
  close(exactPickup(cfg, cfg.goals[0]).mean, 3 * 5 / 0.05, 1e-6, '픽업 꺼짐 = 특정 1종');
  cfg.pickup = { enabled: true, share: 40, guarantee: false };
  close(exactPickup(cfg, cfg.goals[0]).mean, 3 / (0.05 * 0.4), 1e-6, '픽업 40%');
});

test('정확해 ②(천장·확률 상승·보장·마일리지) = 시뮬레이션', () => {
  const cfg = tpl('pity');
  for (const goal of cfg.goals.filter(g => g.type === 'pickup')) {
    const ex = exactPickup(cfg, goal);
    const sim = simulateGoal(cfg, goal, 20000);
    close(sim.mean, ex.mean, 0.02, goal.name);
    close(sim.q(0.9), ex.q90, 0.05, `${goal.name} 90%`);
  }
});

test('천장: 픽업 100%면 아무리 운이 나빠도 천장 횟수 안에 1장', () => {
  const cfg = base({
    grades: [{ id: 'a', name: '일반', kinds: 10, probs: [99.5], shard: 0, exchange: 0 }, { id: 'b', name: '최상위', kinds: 5, probs: [0.5], shard: 0, exchange: 0 }],
    pity: { enabled: true, hard: 90, softStart: 90, softStep: 0 },
    pickup: { enabled: true, share: 100, guarantee: false },
    goals: [{ id: 'p', name: '픽업', type: 'pickup', copies: 1 }],
  });
  const ex = exactPickup(cfg, cfg.goals[0]);
  assert.equal(ex.reach(90), 1);
  assert.ok(ex.reach(89) < 1);
  close(ex.mean, (1 - Math.pow(0.995, 90)) / 0.005, 1e-9, '절단 기하분포 평균');
  assert.ok(simulateGoal(cfg, cfg.goals[0], 5000).sorted.at(-1) <= 90);
});

test('천장 확률 상승: 시작 전 기본, 시작부터 상승폭만큼, 천장에서 100%', () => {
  const cfg = { pity: { enabled: true, hard: 80, softStart: 66, softStep: 6 } };
  assert.equal(topProb(cfg, 0.008, 65), 0.008);
  close(topProb(cfg, 0.008, 66), 0.068, 1e-12);
  close(topProb(cfg, 0.008, 67), 0.128, 1e-12);
  assert.equal(topProb(cfg, 0.008, 80), 1);
});

test('마일리지: 확률이 거의 0이면 교환 주기 × 장수', () => {
  const cfg = base({
    grades: [{ id: 'a', name: '일반', kinds: 1, probs: [99.9999], shard: 0, exchange: 0 }, { id: 'b', name: '최상위', kinds: 2, probs: [0.0001], shard: 0, exchange: 0 }],
    mileage: { enabled: true, per: 1, cost: 50 },
    goals: [{ id: 'p', name: '픽업', type: 'pickup', copies: 4 }],
  });
  close(exactPickup(cfg, cfg.goals[0]).mean, 200, 0.001);
  close(simulateGoal(cfg, cfg.goals[0], 2000).mean, 200, 0.001);
});

test('분해 교환: 조각이 쌓이면 기대 뽑기 수가 줄어든다', () => {
  const cfg = base();
  cfg.goals[0].copies = 4;
  const without = simulateGoal(cfg, cfg.goals[0], 5000).mean;
  cfg.grades[0].shard = 1; cfg.grades[1].shard = 20; cfg.grades[1].exchange = 300;
  const r = simulateGoal(cfg, cfg.goals[0], 5000);
  assert.ok(r.mean < without * 0.95, `${r.mean} < ${without}`);
  assert.ok(r.sources.exchange > 0);
  assert.equal(exactCollectMean(cfg, cfg.goals[0]), null, '교환이 있으면 정확해 ①은 쓰지 않음');
});

test('중복 없는 경우 = 필요 장수 ÷ 등급 확률 (고정 확률)', () => {
  const cfg = base();
  const nd = noDupConfig(cfg, cfg.goals[0]);
  close(exactCollectMean(nd.cfg, nd.goal), 5 / 0.05, 1e-6);
});

test('소환 레벨: 누적 뽑기 수에 따라 확률표가 바뀐다 (확률 0 구간은 건너뜀)', () => {
  const cfg = base({
    levels: [0, 100],
    grades: [{ id: 'a', name: '일반', kinds: 1, probs: [100, 50], shard: 0, exchange: 0 }, { id: 'b', name: '희귀', kinds: 1, probs: [0, 50], shard: 0, exchange: 0 }],
    goals: [{ id: 'g', name: '희귀 1장', type: 'collect', grade: 'b', kinds: 1, copies: 1 }],
  });
  const r = simulateGoal(cfg, cfg.goals[0], 20000);
  assert.ok(r.sorted[0] >= 101, '100회까지는 나올 수 없음');
  close(r.mean, 102, 0.01);
  close(exactPickup({ ...cfg, goals: [] }, { type: 'pickup', copies: 1 }).mean, 102, 1e-6, '동적 계획법도 레벨 반영');
});

test('검증: 확률 합, 종 수 범위, 픽업 등급 종 수', () => {
  const cfg = base();
  cfg.grades[1].probs = [4];
  assert.ok(validate(cfg).some(e => e.includes('확률 합')));
  const c2 = base(); c2.goals[0].kinds = 9;
  assert.ok(validate(c2).some(e => e.includes('종 수')));
  const c3 = base({ pickup: { enabled: true, share: 50, guarantee: true } }); c3.grades[1].kinds = 1; c3.goals[0].kinds = 1;
  assert.ok(validate(c3).some(e => e.includes('픽업')));
});
