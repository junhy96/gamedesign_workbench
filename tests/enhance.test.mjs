// 실행: npm test  (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  analyze, validate, effectiveProbs, usageAt, buildChain, optimizeItems, solveForCost, expectedCost,
  priceSweep, migrate, stageUnits, unitsOf,
} from '../js/enhance/model.js';
import { simulate, mulberry32, reachProbability } from '../js/enhance/simulate.js';
import { TEMPLATES } from '../js/enhance/presets.js';

const tpl = (id, over = {}) => ({ ...TEMPLATES[id].make(), ...over });
const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b) + 1e-12, `${msg}: ${a} vs ${b}`);

/**
 * 체인 빌더와 독립적으로 '게임 규칙'을 그대로 따라가는 시뮬레이터.
 * 카운터 규칙·단계 이동·비용 합산을 체인과 별도로 구현해 buildChain을 검증한다.
 */
function ruleSim(cfg, trials, seed) {
  const rnd = mulberry32(seed);
  const rows = new Map(cfg.rows.map(r => [r.stage, r]));
  const floor = Math.min(...cfg.rows.map(r => r.stage));
  const st = cfg.streak, kind = st.kind;
  const cap = st.pity || 1e9;
  const costMult = cfg.event?.on ? cfg.event.costMult : 1;
  const val = (costs) => costs.reduce((a, v, i) => a + (v || 0) * cfg.resources[i].value, 0);
  let sumC = 0, sumC2 = 0, sumA = 0, sumD = 0, zero = 0;
  for (let t = 0; t < trials; t++) {
    let stage = cfg.start, c = 0, cost = 0, att = 0, des = 0;
    while (stage < cfg.target) {
      att++;
      const row = rows.get(stage);
      const items = usageAt(cfg, stage, c);
      const p = effectiveProbs(cfg, row, c, items);
      cost += val(row.costs) * costMult + (p.forced ? 0 : items.reduce((a, it) => a + val(it.costs) * unitsOf(it), 0));
      const u = rnd();
      if (u < p.s) { stage += 1; c = 0; }
      else if (u < p.s + p.s2) { stage += 2; c = 0; }
      else if (u < p.s + p.s2 + p.k) { if (kind === 'fail') c = Math.min(c + 1, cap); }
      else if (u < p.s + p.s2 + p.k + p.d) { stage = Math.max(stage - 1, floor); if (kind !== 'none') c = Math.min(c + 1, cap); }
      else { des++; cost += val(cfg.destroyCosts); stage = cfg.restore; c = 0; }
    }
    sumC += cost; sumC2 += cost * cost; sumA += att; sumD += des; if (!des) zero++;
  }
  const mean = sumC / trials;
  return { cost: mean, std: Math.sqrt(sumC2 / trials - mean * mean), attempts: sumA / trials, destroys: sumD / trials, noDestroy: zero / trials };
}

function checkAgainstRuleSim(cfg, label, trials = 40000) {
  const ex = analyze(cfg);
  assert.ok(ex.ok, `${label}: ${ex.errors}`);
  const mc = ruleSim(cfg, trials, 11);
  close(mc.cost, ex.expCost, 0.04, `${label} 기대 비용`);
  close(mc.attempts, ex.attempts, 0.04, `${label} 기대 시도`);
  close(mc.std, ex.std, 0.06, `${label} 표준편차`);
  if (ex.expDestroy > 0.05) close(mc.destroys, ex.expDestroy, 0.06, `${label} 기대 파괴`);
  assert.ok(Math.abs(mc.noDestroy - ex.noDestroy) < 0.015, `${label} 무파괴 ${mc.noDestroy} vs ${ex.noDestroy}`);
  return ex;
}

test('모든 템플릿이 검증을 통과한다', () => {
  for (const id of Object.keys(TEMPLATES)) assert.deepEqual(validate(tpl(id)), [], id);
});

test('기본 성장형(하락·파괴): 정확해 = 규칙 시뮬레이터', () => checkAgainstRuleSim(tpl('standard'), '기본'));

test('보조 아이템 사용 중: 정확해 = 규칙 시뮬레이터', () => {
  checkAgainstRuleSim(tpl('standard', { usage: { 9: ['protect'], 10: ['protect', 'nodrop'], 12: ['bless'], 13: ['bless', 'protect'] } }), '아이템');
});

test('실패 누적 보너스 + 천장: 정확해 = 규칙 시뮬레이터', () => checkAgainstRuleSim(tpl('artisan'), '실패 누적'));

test('이중 강화 + 찬스타임: 정확해 = 규칙 시뮬레이터', () => checkAgainstRuleSim(tpl('gamble'), '이중 강화'));

test('이벤트 배율: 정확해 = 규칙 시뮬레이터', () => {
  const cfg = tpl('standard');
  cfg.event = { on: true, successMult: 1.3, destroyMult: 0.5, costMult: 0.7 };
  checkAgainstRuleSim(cfg, '이벤트');
});

test('해석해와 일치: 1단계 성공 p → 시도 기하분포 (평균 1/p, 분산 (1−p)/p²)', () => {
  const p = 0.2;
  const cfg = tpl('blank', { target: 1, rows: [{ stage: 0, s: 20, s2: 0, k: 80, d: 0, b: 0, costs: [1] }] });
  const ex = analyze(cfg);
  close(ex.expCost, 1 / p, 1e-9, '평균');
  close(ex.std, Math.sqrt((1 - p) / (p * p)), 1e-9, '표준편차');
});

test('띠 행렬 + Sherman–Morrison 풀이 = 밀집 행렬 가우스 소거', () => {
  for (const cfg of [tpl('standard'), tpl('gamble'), tpl('artisan', { streak: { kind: 'fail', bonus: 2, bonusMode: 'abs', cap: 60, pity: 8 } })]) {
    const chain = buildChain(cfg);
    const n = chain.n;
    const A = Array.from({ length: n }, (_, i) => { const r = new Array(n + 1).fill(0); r[i] = 1; return r; });
    chain.states.forEach((st, r) => {
      for (const [to, p, kind] of st.edges) if (to !== -1) A[r][to] -= p;
      A[r][n] = st.cost + st.p.b * chain.destroyCost;
    });
    for (let c = 0; c < n; c++) { // 부분 피벗 가우스-조르단
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j]; }
    }
    close(analyze(cfg).expCost, A[chain.S][n] / A[chain.S][chain.S], 1e-8, '밀집 vs 띠');
  }
});

test('민감도(수반 방법) ≈ 유한 차분', () => {
  const cfg = tpl('standard');
  const ex = analyze(cfg);
  for (const j of [3, 9, 13]) {
    const rows = cfg.rows.map(r => {
      if (r.stage !== j) return r;
      const f = r.k + r.d + r.b, g = 1 - 1 / f;
      return { ...r, s: r.s + 1, k: r.k * g, d: r.d * g, b: r.b * g };
    });
    const fd = expectedCost({ ...cfg, rows }).cost - ex.expCost;
    const est = ex.stages.find(s => s.stage === j).sens;
    close(est, fd, 0.12, `+${j} 민감도`);
    assert.ok(est < 0, '성공률을 올리면 기대 비용은 줄어야 함');
  }
});

test('돌파 전 파괴 확률: 하락 없으면 b/(s+b), 하락 있으면 규칙 시뮬레이션과 일치', () => {
  const noDrop = tpl('blank', { target: 2, rows: [{ stage: 0, s: 50, s2: 0, k: 50, d: 0, b: 0, costs: [1] }, { stage: 1, s: 30, s2: 0, k: 60, d: 0, b: 10, costs: [1] }] });
  close(analyze(noDrop).stages.find(s => s.stage === 1).destroyBeforePass, 10 / 40, 1e-9, '하락 없음');

  const cfg = tpl('gamble');
  const ex = analyze(cfg);
  const rows = new Map(cfg.rows.map(r => [r.stage, r]));
  const rnd = mulberry32(5);
  for (const i of [11, 15]) {
    let destroyed = 0; const trials = 40000;
    for (let t = 0; t < trials; t++) {
      let stage = i, c = 0;
      while (stage <= i) {
        const p = effectiveProbs(cfg, rows.get(stage), c, []);
        const u = rnd();
        if (u < p.s) { stage += 1; c = 0; } else if (u < p.s + p.s2) { stage += 2; c = 0; }
        else if (u < p.s + p.s2 + p.k) { /* 찬스타임(하락 기준): 유지는 카운터 유지 */ }
        else if (u < p.s + p.s2 + p.k + p.d) { stage = Math.max(stage - 1, 0); c = Math.min(c + 1, 2); }
        else { destroyed++; break; }
      }
    }
    const got = ex.stages.find(s => s.stage === i).destroyBeforePass;
    assert.ok(Math.abs(destroyed / trials - got) < 0.01, `+${i}: ${destroyed / trials} vs ${got}`);
  }
});

test('실효 확률: 파괴방지·하락방지·성공률 증가·천장', () => {
  const cfg = tpl('standard');
  const row = cfg.rows[12];
  const prot = effectiveProbs(cfg, row, 0, [{ effect: 'protect' }, { effect: 'nodrop' }]);
  assert.equal(prot.b, 0); assert.equal(prot.d, 0); close(prot.s, row.s / 100, 1e-12, '성공 유지');
  const boost = effectiveProbs(cfg, row, 0, [{ effect: 'boost', amount: 10 }]);
  close(boost.s, row.s / 100 + 0.1, 1e-12, '+10%p'); close(boost.s + boost.k + boost.d + boost.b, 1, 1e-12, '합 1');
  const pity = effectiveProbs(tpl('artisan'), tpl('artisan').rows[9], 30, []);
  assert.equal(pity.forced, true); assert.equal(pity.s, 1);
});

test('아이템 최적 정책(MDP): 수동 조합들보다 기대 비용이 낮거나 같다', () => {
  const cfg = tpl('standard');
  const opt = optimizeItems(cfg);
  assert.ok(opt.ok && opt.after <= opt.before + 1e-6);
  const tries = [{}, { 9: ['protect'], 10: ['protect'], 11: ['protect'] }, { 12: ['bless'], 13: ['bless'], 14: ['bless', 'protect'] }];
  for (const usage of tries) assert.ok(opt.after <= expectedCost({ ...cfg, usage }).cost + 1e-6);
  close(expectedCost({ ...cfg, usage: opt.usage }).cost, opt.after, 1e-9, '정책 적용 후 재계산');
});

test('역산: 목표 기대 비용에 맞는 성공률 배율', () => {
  const cfg = tpl('standard');
  const base = analyze(cfg).expCost;
  const res = solveForCost(cfg, base * 0.6, 0, 14);
  assert.ok(res.ok && res.alpha > 1);
  close(res.cost, base * 0.6, 1e-4, '역산 결과');
  assert.deepEqual(validate({ ...cfg, rows: res.rows }), []);
});

test('몬테카를로: 예산별 도달 확률', () => {
  const mc = simulate(tpl('standard'), 5000, 1);
  assert.equal(reachProbability(mc.sortedCost, Infinity), 1);
  assert.equal(reachProbability(mc.sortedCost, -1), 0);
  close(reachProbability(mc.sortedCost, mc.pct.cost.p50), 0.5, 0.02, '중앙값');
});

test('입력 오류 감지', () => {
  const bad = tpl('blank');
  bad.rows[1] = { ...bad.rows[1], s: 70 };
  assert.match(validate(bad).join(), /확률 합/);
  const dead = tpl('blank');
  dead.rows[2] = { ...dead.rows[2], s: 0, k: 100 };
  assert.equal(analyze(dead).ok, false);
  const noPity = tpl('artisan', { streak: { kind: 'fail', bonus: 1, bonusMode: 'rel', cap: 100, pity: 0 } });
  assert.match(validate(noPity).join(), /너무 많습니다/);
});

test('단계별 재화 기대 소모의 합 = 재화별 총 기대 소모 (재화 흐름으로 보내는 표)', () => {
  for (const id of Object.keys(TEMPLATES)) {
    const r = analyze(tpl(id));
    if (!r.ok) continue;
    r.resources.forEach((res, ri) => {
      const sum = r.stages.reduce((a, o) => a + o.units[ri], 0);
      close(sum, res.units, 1e-9, `${id} ${res.name}`);
    });
  }
});

// ── 수량형 보조 재료 · 아이템 가격 곡선 ─────────────────
// docs/samples/enhance-quantity-items.json: 저장 파일 형식 + generate.mjs가 단계별 전수 탐색으로 구한 정답(expected)
const sample = JSON.parse(readFileSync(new URL('../docs/samples/enhance-quantity-items.json', import.meta.url), 'utf8'));
const sampleCfg = () => structuredClone(migrate(sample.state));
/** expected는 소수 d자리로 반올림된 값 → 반올림 반 칸 + 1e-6 안이면 일치 */
const near = (a, b, d, msg) => assert.ok(Math.abs(a - b) <= 0.5 * 10 ** -d + 1e-6, `${msg}: ${a} vs ${b}`);

test('수량형 샘플: 아이템 없이 기대 비용 = 전수 탐색 정답', () => {
  const cfg = sampleCfg();
  assert.deepEqual(validate(cfg), []);
  near(expectedCost({ ...cfg, usage: {} }).cost, sample.expected.noItemsExpCost, 2, '아이템 없이');
  assert.ok(analyze(cfg).ok, '저장된 수동 투입량으로도 계산됨');
});

test('수량형 샘플: 최적 정책(MDP)의 기대 비용·BM 지출·투입 개수 = 전수 탐색 정답', () => {
  const cfg = sampleCfg(), ex = sample.expected;
  const opt = optimizeItems(cfg);
  assert.ok(opt.ok, opt.errors?.join());
  near(opt.after, ex.optimal.expCost, 2, '최적 기대 비용');
  near(opt.itemSpend, ex.optimal.bmSpend, 2, 'BM 기대 지출');
  near(1 - opt.after / ex.noItemsExpCost, ex.optimal.saving, 4, '절감률');
  const policy = Object.fromEntries(Object.entries(opt.usage).map(([stage, u]) => [stage, stageUnits(u)]));
  assert.deepEqual(policy, ex.optimal.policy);
  close(analyze({ ...cfg, usage: opt.usage }).itemSpend, opt.itemSpend, 1e-9, '정책 적용 후 analyze 지출');
});

test('수량형 샘플: 가격 곡선 각 점과 매출 최대 가격 = 전수 탐색 정답', () => {
  const cfg = sampleCfg(), ex = sample.expected;
  const sw = priceSweep(cfg, cfg.priceSweep);
  assert.ok(sw.ok, sw.errors?.join());
  assert.equal(sw.points.length, ex.priceSweep.length);
  sw.points.forEach((p, k) => {
    const e = ex.priceSweep[k];
    assert.equal(p.price, e.price);
    near(p.expCost, e.expCost, 2, `${e.price} 기대 비용`);
    near(p.bmSpend, e.bmSpend, 2, `${e.price} BM 지출`);
    near(p.saving, e.saving, 4, `${e.price} 절감률`);
    assert.equal(p.policyUnits, e.highUnits, `${e.price} 상급 투입 개수`);
  });
  assert.equal(sw.bmMax.price, ex.bmRevenueMaxAt.price);
  near(sw.bmMax.bmSpend, ex.bmRevenueMaxAt.bmSpend, 2, '최대 매출');
  assert.equal(sw.reach?.price ?? null, ex.savingAtOrBelowTargetFrom);
  assert.equal(sw.unusedFrom.price, 240, '240 다이아부터 상급은 안 쓰임');
});

test('수량형 n개 = 효과·가격이 n배인 토글형 1개', () => {
  const cfg = sampleCfg();
  const it = cfg.items[0];
  const qty = { ...cfg, usage: { 4: { units: { [it.id]: 5 } } } };
  const tog = { ...cfg, items: [{ ...it, mode: 'toggle', amount: it.amount * 5, costs: it.costs.map(v => v * 5) }], usage: { 4: [it.id] } };
  close(analyze(qty).expCost, analyze(tog).expCost, 1e-12, '기대 비용');
  close(analyze(qty).itemSpend, analyze(tog).itemSpend, 1e-12, 'BM 지출');
  // 최대 개수를 넘는 값은 maxUnits로 자른다
  assert.equal(unitsOf(usageAt({ ...cfg, usage: { 4: { units: { [it.id]: 99 } } } }, 4, 0)[0]), it.maxUnits);
});

test('수량형 + 하락·파괴·천장: 정확해 = 규칙 시뮬레이터, 최적 정책 ≤ 수동 투입', () => {
  const cfg = tpl('standard');
  cfg.items.push({ id: 'dust', name: '축복 가루', effect: 'boost', mode: 'quantity', amount: 0.5, maxUnits: 6, costs: cfg.resources.map((_, r) => (r === cfg.resources.length - 1 ? 1 : 0)), from: 8, to: 14 });
  cfg.usage = { 9: { units: { protect: 1, dust: 4 } }, 12: { units: { dust: 6 } }, 13: ['protect'] };
  checkAgainstRuleSim(cfg, '수량형');
  const opt = optimizeItems(cfg);
  assert.ok(opt.ok && opt.after <= opt.before + 1e-6);
  close(expectedCost({ ...cfg, usage: opt.usage }).cost, opt.after, 1e-9, '정책 적용 후 재계산');
  const art = tpl('artisan');
  art.items = [{ ...art.items[0], mode: 'quantity', amount: 1, maxUnits: 5 }];
  const o2 = optimizeItems(art);
  assert.ok(o2.ok);
  close(expectedCost({ ...art, usage: o2.usage }).cost, o2.after, 1e-9, '카운터별 정책 재계산');
});

test('저장 형식 v2 → v3: 기존 on/off 아이템은 토글형으로 읽힘', () => {
  const v2 = { v: 2, ...tpl('standard'), usage: { 9: ['protect'] } };
  for (const it of v2.items) delete it.mode;
  const st = migrate(v2);
  assert.equal(st.v, 3);
  assert.ok(st.items.every(it => it.mode === 'toggle'));
  close(analyze(st).expCost, analyze(v2).expCost, 1e-12, '마이그레이션 전후 같은 결과');
  assert.equal(migrate({ v: 1 }), null);
});

test('분위수 표: 시뮬레이션 분위 = 정렬 표본의 분위, 파괴는 정수, 단조 증가', async () => {
  const { PCTS, quantile } = await import('../js/lib/quantiles.js');
  const { simulate } = await import('../js/enhance/simulate.js');
  const cfg = TEMPLATES[Object.keys(TEMPLATES)[0]].make();
  const mc = simulate(cfg, 4000, 7);
  for (const key of ['cost', 'attempts', 'destroys']) {
    const q = mc.quantiles[key];
    assert.equal(q.length, PCTS.length);
    for (let i = 1; i < q.length; i++) assert.ok(q[i] >= q[i - 1], key);
  }
  PCTS.forEach((p, i) => assert.equal(mc.quantiles.cost[i], quantile(mc.sortedCost, p)));
  assert.ok(mc.quantiles.destroys.every(Number.isInteger));
  assert.equal(mc.quantiles.cost[PCTS.indexOf(0.5)] <= mc.quantiles.cost[PCTS.indexOf(0.9)], true);
});
