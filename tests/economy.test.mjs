// 실행: npm test  (node --test) — 재화 흐름 v2 (성장 루프)
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, validate, findCycle, toMermaid, growthCost, effectiveRegen } from '../js/economy/model.js';
import { TEMPLATES } from '../js/economy/presets.js';

const base = () => ({
  days: 10, warmup: 0, sinkRatioWarn: 60, gapWarn: 3, basePower: 0,
  currencies: [{ id: 'g', name: '골드', start: 0 }, { id: 'd', name: '다이아', start: 0 }],
  paid: { currency: 'd', priceWon: 10 },
  stamina: { enabled: false, regenPerDay: 288, cap: 120, refillCost: 50, refillAmount: 60 },
  segments: [{ id: 's', name: '일반', share: 100, minutes: 10, logins: 3, spendWon: 0, refills: 0 }],
  contents: [{ id: 'c', name: '사냥', minutes: 1, stamina: 0, limit: 0, period: 'day', unlock: 0, powerBonus: 0, reward: { g: 100 } }],
  growth: [],
  exchanges: [],
});

test('템플릿이 검증을 통과한다', () => {
  for (const id of Object.keys(TEMPLATES)) assert.deepEqual(validate(TEMPLATES[id].make()), [], id);
});

test('시간 예산: 분당 콘텐츠는 플레이 시간만큼 반복', () => {
  const r = simulate(base());
  assert.equal(r.bySeg[0].series.hold.g[10], 10 * 10 * 100);
  assert.equal(r.bySeg[0].runs.c, 100);
});

test('횟수 제한·주간 콘텐츠·해금 전투력', () => {
  const cfg = base();
  cfg.segments[0].minutes = 1000;
  cfg.contents = [
    { id: 'daily', name: '일일', minutes: 1, stamina: 0, limit: 2, period: 'day', unlock: 0, powerBonus: 0, reward: { g: 1 } },
    { id: 'weekly', name: '주간', minutes: 1, stamina: 0, limit: 1, period: 'week', unlock: 0, powerBonus: 0, reward: { g: 1 } },
    { id: 'locked', name: '잠김', minutes: 1, stamina: 0, limit: 1, period: 'day', unlock: 99999, powerBonus: 0, reward: { g: 1 } },
  ];
  const r = simulate({ ...cfg, days: 14 }).bySeg[0];
  assert.equal(r.runs.daily, 28);
  assert.equal(r.runs.weekly, 2);
  assert.equal(r.runs.locked || 0, 0);
});

test('성장 비용 = 기본 × 증가율^L, 전투력이 보상을 늘린다 (루프)', () => {
  assert.equal(growthCost({ cost: { g: 100 }, rate: 1.5 }, 2, 'g'), 225);
  const cfg = base();
  cfg.growth = [{ id: 'eq', name: '장비', max: 100, start: 0, rate: 1, power: 100, cost: { g: 500 } }];
  const noBonus = simulate(cfg).bySeg[0];
  cfg.contents[0].powerBonus = 50;
  const withBonus = simulate(cfg).bySeg[0];
  assert.ok(withBonus.finalPower > noBonus.finalPower, '보상 보너스가 있으면 성장이 빨라야 함');
});

test('스태미나: 실제 회복량은 최대치 × 접속 횟수로 막힌다, 충전은 유료 재화 소모', () => {
  assert.equal(effectiveRegen({ regenPerDay: 288, cap: 120 }, { logins: 2 }), 240);
  assert.equal(effectiveRegen({ regenPerDay: 288, cap: 120 }, { logins: 4 }), 288);
  const cfg = base();
  cfg.stamina.enabled = true;
  cfg.segments[0] = { ...cfg.segments[0], minutes: 10000, logins: 1, spendWon: 30000, refills: 1 };
  cfg.contents = [{ id: 'dg', name: '던전', minutes: 0, stamina: 10, limit: 0, period: 'day', unlock: 0, powerBonus: 0, reward: { g: 1 } }];
  const r = simulate({ ...cfg, days: 1 }).bySeg[0];
  // 남은 양 0 + 회복 min(288, 120×1) = 120 + 충전 60 → 180 → 18회
  assert.equal(r.runs.dg, 18);
  assert.equal(r.outflow.d, 50); // 충전 1회
});

test('병목 재화와 성장 정체 경고', () => {
  const cfg = base();
  cfg.currencies.push({ id: 's', name: '강화석', start: 0 });
  cfg.growth = [{ id: 'eq', name: '장비', max: 50, start: 0, rate: 1, power: 10, cost: { g: 100, s: 1 } }];
  const r = simulate({ ...cfg, days: 20 });
  assert.equal(r.bySeg[0].bottleneck.s, 20);
  assert.ok(r.warnings.some(w => w.level === 'serious' && w.text.includes('강화석')));
});

test('해금됐지만 시간이 없어 못 한 콘텐츠를 구분한다', () => {
  const cfg = base();
  cfg.contents = [
    { id: 'a', name: '긴 일일', minutes: 10, stamina: 0, limit: 1, period: 'day', unlock: 0, powerBonus: 0, reward: { g: 1 } },
    { id: 'b', name: '레이드', minutes: 20, stamina: 0, limit: 1, period: 'week', unlock: 0, powerBonus: 0, reward: { g: 1 } },
  ];
  const r = simulate(cfg);
  assert.ok(r.warnings.some(w => w.text.includes('레이드') && w.text.includes('열렸지만')));
});

test('과금: 월 과금액 ÷ 30 ÷ 단가만큼 매일 유료 재화', () => {
  const cfg = base();
  cfg.segments[0].spendWon = 30000;
  assert.equal(Math.round(simulate(cfg).bySeg[0].series.hold.d[10]), 1000); // 30000/30/10 = 100/일
});

test('순환 교환 거부, 루프 다이어그램 구성', () => {
  assert.deepEqual(findCycle([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]), ['a', 'b', 'a']);
  const code = toMermaid(TEMPLATES.mobile.make());
  for (const s of ['전투력', '일반 던전', '장비 강화', '과금']) assert.ok(code.includes(s), s);
});

test('수급 설계 필요량 표: 표가 있는 재화는 레벨별 값, 같은 이름이면 갱신', async () => {
  const { applyGrowthTable, growthCost, simulate } = await import('../js/economy/model.js');
  const { TEMPLATES } = await import('../js/economy/presets.js');
  const cfg = TEMPLATES.mobile.make();
  const costs = Array.from({ length: 60 }, (_, i) => 10 + i);
  const r = applyGrowthTable(cfg, { currency: '강화석', name: '장비 강화', max: 60, costs });
  assert.equal(r.created, false); assert.equal(r.currencyCreated, false);
  const g = cfg.growth.find(x => x.name === '장비 강화');
  const stone = cfg.currencies.find(c => c.name === '강화석').id;
  assert.equal(growthCost(g, 0, stone), 10);
  assert.equal(growthCost(g, 59, stone), 69);
  assert.equal(growthCost(g, 5, 'gold'), Math.round(g.cost.gold * g.rate ** 5)); // 다른 재화는 기존 식
  const r2 = applyGrowthTable(cfg, { currency: '룬', name: '룬 각인', max: 3, costs: [5, 6, 7] });
  assert.equal(r2.created, true); assert.equal(r2.currencyCreated, true);
  assert.equal(simulate(cfg).ok, true);
});
