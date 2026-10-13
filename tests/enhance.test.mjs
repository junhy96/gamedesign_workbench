// 실행: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, validate, bestProtection, mapleStarforceCost } from '../js/enhance/model.js';
import { simulate } from '../js/enhance/simulate.js';
import { PRESETS } from '../js/enhance/presets.js';

const preset = (id, over = {}) => {
  const p = PRESETS[id];
  const cfg = { ...p.defaults, ...over };
  return { ...cfg, rows: p.rows(cfg) };
};
const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b}`);

test('메이플 비용 공식: 200제 15→16성 = 1000 + 200³·16^2.7/200 → 71,316,500', () => {
  assert.equal(mapleStarforceCost(200, 15), 71_316_500);
  assert.equal(mapleStarforceCost(200, 0), 223_200);
});

test('정확해 = 몬테카를로 (메이플 15→22, 파괴 복구비 포함)', () => {
  const cfg = preset('maple', { destroyCost: 1e9 });
  const ex = analyze(cfg), mc = simulate(cfg, 60000, 7);
  assert.ok(ex.ok);
  close(mc.mean.attempts, ex.attempts, 0.03, '기대 시도');
  close(mc.mean.destroys, ex.expDestroy, 0.04, '기대 파괴');
  close(mc.mean.cost, ex.expCost, 0.04, '기대 비용');
  assert.ok(Math.abs(mc.noDestroy - ex.noDestroy) < 0.01);
});

test('이전 검증 스크립트와 같은 값 (15→22: 무파괴 11.78%, 기대 파괴 7.489)', () => {
  const ex = analyze(preset('maple'));
  close(ex.noDestroy, 0.1178, 0.002, '무파괴');
  close(ex.expDestroy, 7.489, 0.001, '기대 파괴');
});

test('찬스타임: 정확해 = 몬테카를로, 켜면 기대 시도·파괴 감소', () => {
  const on = preset('demo', { chanceN: 2 }), off = preset('demo', { chanceN: 0 });
  const a = analyze(on), b = analyze(off), mc = simulate(on, 60000, 3);
  close(mc.mean.attempts, a.attempts, 0.03, '찬스타임 기대 시도');
  close(mc.mean.cost, a.expCost, 0.04, '찬스타임 기대 비용');
  assert.ok(a.attempts < b.attempts && a.expDestroy < b.expDestroy);
});

test('파괴방지·이벤트는 파괴를 줄인다', () => {
  const base = analyze(preset('maple'));
  const prot = analyze(preset('maple', { protect: [15, 16, 17] }));
  const ev = analyze(preset('maple', { eventDestroyMult: 0.7 }));
  assert.ok(prot.expDestroy < base.expDestroy && ev.expDestroy < base.expDestroy);
  close(prot.noDestroy, 0.1909, 0.003, '파괴방지 무파괴');
});

test('파괴 횟수 분포 합 = 1, 분위수는 분포와 일치', () => {
  const ex = analyze(preset('maple'));
  let s = 0; for (let j = 0; j < 2000; j++) s += ex.destroyDist(j);
  close(s, 1, 1e-9, '분포 합');
  const j90 = ex.destroyQuantile(0.9);
  let cdf = 0; for (let j = 0; j <= j90; j++) cdf += ex.destroyDist(j);
  assert.ok(cdf >= 0.9 && cdf - ex.destroyDist(j90) < 0.9);
});

test('최적 보호 조합은 무작위 조합보다 기대 비용이 낮거나 같다', () => {
  const cfg = preset('maple', { destroyCost: 5e9 });
  const best = bestProtection(cfg);
  for (const protect of [[], [15], [17], [15, 16, 17]]) {
    assert.ok(best.cost <= analyze({ ...cfg, protect }).expCost + 1);
  }
});

test('입력 오류 감지: 확률 합, 도달 불가', () => {
  const cfg = preset('custom');
  cfg.rows[1] = { ...cfg.rows[1], s: 50 };
  assert.match(validate(cfg).join(), /확률 합/);
  const dead = preset('custom');
  dead.rows[2] = { ...dead.rows[2], s: 0, k: 50 };
  assert.equal(analyze(dead).ok, false);
});
