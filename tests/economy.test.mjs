// 실행: npm test  (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, validate, findCycle, toMermaid } from '../js/economy/model.js';
import { TEMPLATES } from '../js/economy/presets.js';

const base = () => ({
  days: 10, warmup: 0, sinkRatioWarn: 70, variance: { on: false },
  currencies: [{ id: 'g', name: '골드', start: 0 }, { id: 's', name: '강화석', start: 0 }],
  faucets: [{ id: 'f', name: '보상', currency: 'g', amount: 100, period: 'day', activity: true, from: 0, to: 0 }],
  exchanges: [],
  sinks: [],
  users: [{ id: 'u', name: '일반', share: 100, activity: 1 }],
});

test('템플릿이 검증을 통과한다', () => {
  for (const id of Object.keys(TEMPLATES)) assert.deepEqual(validate(TEMPLATES[id].make()), [], id);
});

test('획득만 있으면 보유량 = 일수 × 양, 활동량 배수 적용', () => {
  const cfg = base();
  cfg.users = [{ id: 'u', name: '헤비', share: 100, activity: 2 }];
  const r = simulate(cfg);
  assert.equal(r.total[0].mean[10], 10 * 100 * 2);
});

test('하루 처리 순서: 획득 → 교환 → 소모, 주간 획득은 7일마다', () => {
  const cfg = base();
  cfg.faucets.push({ id: 'w', name: '주간', currency: 's', amount: 5, period: 'week', activity: false, from: 0, to: 0 });
  cfg.exchanges = [{ id: 'x', name: '교환', from: 'g', to: 's', amount: 300, rate: 0.01, threshold: 300, maxPerDay: 1 }];
  cfg.sinks = [{ id: 'k', name: '소비', currency: 's', type: 'rule', amount: 2, threshold: 2, maxPerDay: 10, ratio: 0, activity: false }];
  const r = simulate(cfg);
  // 골드: 3일마다 300 모이면 교환(3,6,9일) → 10일차 100. 강화석: 교환 3×3 + 주간 5(7일) = 14 → 2씩 전부 소비, 홀수 잔량 없음
  assert.equal(r.total[0].mean[10], 100);
  assert.equal(r.total[1].inflow, 14);
  assert.equal(r.total[1].mean[10], 0);
});

test('비율 소모와 고정 소모', () => {
  const cfg = base();
  cfg.sinks = [
    { id: 'a', name: '고정', currency: 'g', type: 'fixed', amount: 30, threshold: 0, maxPerDay: 1, ratio: 0, activity: false },
    { id: 'b', name: '비율', currency: 'g', type: 'ratio', amount: 0, threshold: 0, maxPerDay: 1, ratio: 10, activity: false },
  ];
  const r = simulate({ ...cfg, days: 1 });
  assert.equal(r.total[0].mean[1], (100 - 30) * 0.9);
});

test('순환 교환 거부', () => {
  const ex = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }];
  assert.deepEqual(findCycle(ex), ['a', 'b', 'c', 'a']);
  assert.equal(findCycle(ex.slice(0, 2)), null);
  const cfg = base();
  cfg.exchanges = [{ id: '1', name: 'a', from: 'g', to: 's', amount: 1, rate: 1, threshold: 1, maxPerDay: 1 }, { id: '2', name: 'b', from: 's', to: 'g', amount: 1, rate: 1, threshold: 1, maxPerDay: 1 }];
  assert.match(validate(cfg).join(), /순환/);
});

test('편차: 유저 배수 평균이 1 근처 → 평균 보유량이 편차 없는 값과 비슷', () => {
  const cfg = base();
  const flat = simulate(cfg).total[0].mean[10];
  const noisy = simulate({ ...cfg, variance: { on: true, runs: 1000, userSigma: 0.4, daySigma: 0.2 } });
  assert.ok(Math.abs(noisy.total[0].mean[10] / flat - 1) < 0.05);
  const st = noisy.byUser[0].stats[0][10];
  assert.ok(st.p10 < st.mean && st.mean < st.p90);
});

test('적체 경고: 소모율이 기준 미만이면 경고', () => {
  const cfg = base();
  cfg.sinks = [{ id: 'k', name: '소비', currency: 'g', type: 'rule', amount: 50, threshold: 50, maxPerDay: 1, ratio: 0, activity: false }];
  assert.equal(simulate(cfg).warnings.length, 1); // 50% < 70%
  cfg.sinks[0].amount = 90;
  assert.equal(simulate(cfg).warnings.length, 0);
});

test('흐름도 Mermaid 코드에 모든 재화·획득처·소모처가 들어간다', () => {
  const cfg = TEMPLATES.rpg.make();
  const code = toMermaid(cfg);
  for (const x of [...cfg.currencies, ...cfg.faucets, ...cfg.sinks]) assert.ok(code.includes(x.name), x.name);
});
