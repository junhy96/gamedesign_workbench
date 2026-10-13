// 강화 기대 비용 계산 — 순수 계산 모듈 (DOM 없음, Node 테스트에서 그대로 import)
//
// 모델: 흡수 마르코프 체인. 상태 = (단계 i, 연속 하락 수 k).
//   - 찬스타임 옵션이 켜져 있으면 k가 chanceN에 도달한 상태에서 다음 시도는 100% 성공.
//   - 파괴되면 복구 단계(restore)로 이동하고 "파괴 1회 비용"이 더해진다.
// 핵심 출력은 상태별 기대 시도 횟수 N 하나. 기대 비용·기대 파괴는 모두 N의 선형 결합이다.

/**
 * @typedef {{stage:number, s:number, k:number, d:number, b:number, cost:number, protectable?:boolean}} StageRow
 *   확률은 % 단위(합 100), cost는 1회 기본 비용.
 * @typedef {{
 *   rows: StageRow[], start:number, target:number, restore:number,
 *   destroyCost?:number, chanceN?:number, protect?:number[],
 *   protectExtra?:number, costMult?:number, eventDestroyMult?:number, eventMaxStage?:number
 * }} Config
 */

const EPS = 1e-9;

/** 입력 검증. 문제가 있으면 사람이 읽을 수 있는 메시지 배열을 돌려준다. */
export function validate(cfg) {
  const errors = [];
  const byStage = new Map(cfg.rows.map(r => [r.stage, r]));
  const { start, target, restore } = cfg;
  if (!(target > start)) errors.push('목표 단계는 시작 단계보다 커야 합니다.');
  for (let i = start; i < target; i++) if (!byStage.has(i)) errors.push(`${i}단계 확률이 표에 없습니다.`);
  if (restore >= target) errors.push('파괴 시 복구 단계는 목표 단계보다 작아야 합니다.');
  if (!byStage.has(restore) && restore < target) errors.push(`복구 단계(${restore})가 표에 없습니다.`);
  for (const r of cfg.rows) {
    const sum = r.s + r.k + r.d + r.b;
    if ([r.s, r.k, r.d, r.b].some(v => !(v >= 0))) errors.push(`${r.stage}단계: 확률은 0 이상이어야 합니다.`);
    else if (Math.abs(sum - 100) > 0.01) errors.push(`${r.stage}단계: 확률 합이 ${round(sum, 4)}%입니다 (100%여야 함).`);
  }
  if (cfg.chanceN != null && cfg.chanceN !== 0 && !(Number.isInteger(cfg.chanceN) && cfg.chanceN >= 1)) {
    errors.push('찬스타임 연속 하락 횟수는 1 이상의 정수여야 합니다.');
  }
  return errors;
}

/** 옵션(이벤트 파괴 감소, 파괴방지)을 적용한 단계별 실효 확률(0~1)과 1회 비용. */
export function effectiveStages(cfg) {
  const {
    protect = [], protectExtra = 2, costMult = 1,
    eventDestroyMult = 1, eventMaxStage = Infinity,
  } = cfg;
  const prot = new Set(protect);
  const out = new Map();
  for (const r of cfg.rows) {
    let s = r.s / 100, k = r.k / 100, d = r.d / 100, b = r.b / 100;
    if (eventDestroyMult !== 1 && r.stage <= eventMaxStage) {
      const cut = b * (1 - eventDestroyMult); // 줄어든 파괴 확률은 유지로 이동
      b -= cut; k += cut;
    }
    const protectedHere = prot.has(r.stage) && b > 0;
    if (protectedHere) { k += b; b = 0; }
    // 파괴방지 추가 비용은 할인(costMult) 미적용 — 메이플 규칙과 동일
    const baseCost = r.cost * costMult;
    const cost = baseCost + (protectedHere ? r.cost * protectExtra : 0);
    out.set(r.stage, { stage: r.stage, s, k, d, b, cost, baseCost, protected: protectedHere });
  }
  return out;
}

/** 상태 공간과 전이 목록 생성. 전이 대상 -1은 목표 도달(흡수). */
function buildChain(cfg, eff) {
  const { start, target, restore } = cfg;
  const chanceN = cfg.chanceN || 0;
  const floor = Math.min(...cfg.rows.map(r => r.stage));
  const K = chanceN ? chanceN + 1 : 1;
  const states = [];
  const idx = new Map();
  const key = (i, k) => i * 1000 + k;
  for (let i = floor; i < target; i++) {
    if (!eff.has(i)) continue;
    for (let k = 0; k < K; k++) { idx.set(key(i, k), states.length); states.push({ stage: i, k }); }
  }
  const go = (i, k) => (i >= target ? -1 : idx.get(key(i, k)));
  const R = go(restore, 0);
  const trans = states.map(({ stage: i, k }) => {
    const p = eff.get(i);
    if (chanceN && k === chanceN) {
      // 찬스타임: 확정 성공. 파괴 위험이 없으므로 파괴방지 비용도 붙이지 않는다.
      return { to: [[go(i + 1, 0), 1, false]], b: 0, cost: p.baseCost, forced: true };
    }
    const to = [];
    if (p.s > 0) to.push([go(i + 1, 0), p.s, false]);
    if (p.k > 0) to.push([go(i, k), p.k, false]);
    if (p.d > 0) {
      const ni = Math.max(i - 1, floor);
      to.push([go(ni, chanceN ? Math.min(k + 1, chanceN) : 0), p.d, false]);
    }
    if (p.b > 0) to.push([R, p.b, true]);
    return { to, b: p.b, cost: p.cost, forced: false };
  });
  return { states, trans, S: go(start, 0), R };
}

/** 가우스 소거(부분 피벗). 해가 없으면 null. */
export function solveLinear(A, y) {
  const n = y.length;
  const M = A.map((row, i) => [...row, y[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    if (piv !== c) [M[c], M[piv]] = [M[piv], M[c]];
    const inv = 1 / M[c][c];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] * inv;
      if (f === 0) continue;
      const rowR = M[r], rowC = M[c];
      for (let j = c; j <= n; j++) rowR[j] -= f * rowC[j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function identity(n) {
  return Array.from({ length: n }, (_, i) => { const r = new Array(n).fill(0); r[i] = 1; return r; });
}

/** 상태별 기대 방문(시도) 횟수: (I − Qᵀ) N = e_start. 파괴는 복구 단계로 가는 전이로 포함. */
function expectedVisits(chain) {
  const n = chain.states.length;
  const B = identity(n);
  chain.trans.forEach(({ to }, r) => { for (const [j, p] of to) if (j !== -1) B[j][r] -= p; });
  const e = new Array(n).fill(0); e[chain.S] = 1;
  return solveLinear(B, e);
}

/** 파괴 없이 목표에 도달할 확률 q(state): 파괴를 '실패로 종료'로 취급. */
function noDestroyProb(chain) {
  const n = chain.states.length;
  const A = identity(n);
  const y = new Array(n).fill(0);
  chain.trans.forEach(({ to }, r) => {
    for (const [j, p, destroy] of to) {
      if (j === -1) y[r] += p;
      else if (!destroy) A[r][j] -= p;
    }
  });
  return solveLinear(A, y);
}

/** 정확해 분석. */
export function analyze(cfg) {
  const errors = validate(cfg);
  if (errors.length) return { ok: false, errors };
  const eff = effectiveStages(cfg);
  const chain = buildChain(cfg, eff);
  const N = expectedVisits(chain);
  const q = noDestroyProb(chain);
  if (!N || !q || N.some(v => !Number.isFinite(v) || v < -EPS)) {
    return { ok: false, errors: ['목표에 도달할 수 없는 설정입니다 (성공 확률 0인 단계가 경로에 있음).'] };
  }
  const destroyCost = cfg.destroyCost || 0;
  let attempts = 0, expDestroy = 0, attemptCost = 0;
  const perStage = new Map();
  chain.states.forEach(({ stage }, r) => {
    const v = Math.max(N[r], 0), t = chain.trans[r];
    attempts += v;
    expDestroy += v * t.b;
    attemptCost += v * t.cost;
    const ps = perStage.get(stage) || { stage, visits: 0, cost: 0, destroys: 0 };
    ps.visits += v; ps.cost += v * t.cost; ps.destroys += v * t.b;
    perStage.set(stage, ps);
  });
  const expCost = attemptCost + expDestroy * destroyCost;
  const q0 = q[chain.S];
  const qR = chain.R != null ? q[chain.R] : 1;
  // 단계별 표시용: 하락이 없을 때의 "이 단계를 넘기기 전 파괴 확률" b/(s+b)
  const stages = [...eff.values()].sort((a, b) => a.stage - b.stage).map(p => ({
    ...p,
    destroyBeforePass: p.s + p.b > 0 && p.d === 0 ? p.b / (p.s + p.b) : null,
    visits: perStage.get(p.stage)?.visits ?? 0,
    costTotal: perStage.get(p.stage)?.cost ?? 0,
  }));
  return {
    ok: true,
    attempts, expDestroy, expCost, attemptCost,
    destroyCostTotal: expDestroy * destroyCost,
    noDestroy: q0,
    // 파괴 횟수 분포: P(D=0)=q0, P(D=j)=(1−q0)(1−qR)^(j−1)qR (j≥1) — 기하분포
    destroyDist: (j) => (j === 0 ? q0 : (1 - q0) * Math.pow(1 - qR, j - 1) * qR),
    destroyQuantile: (p) => destroyQuantile(q0, qR, p),
    stages,
  };
}

function destroyQuantile(q0, qR, p) {
  if (p <= q0) return 0;
  if (qR >= 1) return 1;
  // P(D ≤ j) = 1 − (1−q0)(1−qR)^j  ≥ p
  return Math.max(1, Math.ceil(Math.log((1 - p) / (1 - q0)) / Math.log(1 - qR) - 1e-12));
}

/** 기대 비용만 빠르게 (보호 조합 탐색용). */
function expectedCostOnly(cfg) {
  const eff = effectiveStages(cfg);
  const chain = buildChain(cfg, eff);
  const N = expectedVisits(chain);
  if (!N) return Infinity;
  let c = 0;
  chain.states.forEach((_, r) => { c += Math.max(N[r], 0) * (chain.trans[r].cost + chain.trans[r].b * (cfg.destroyCost || 0)); });
  return c;
}

/**
 * 파괴방지 최적 조합: 보호 가능한 단계(파괴 확률>0, protectable)의 모든 조합을 비교.
 * 단계별 정책 중 기대 비용 최소를 찾는다. 후보가 많으면(>10) null.
 */
export function bestProtection(cfg) {
  const cand = cfg.rows
    .filter(r => r.b > 0 && r.protectable !== false && r.stage < cfg.target)
    .map(r => r.stage);
  if (!cand.length || cand.length > 10) return null;
  let best = { cost: Infinity, protect: [] };
  for (let mask = 0; mask < 1 << cand.length; mask++) {
    const protect = cand.filter((_, i) => mask & (1 << i));
    const cost = expectedCostOnly({ ...cfg, protect });
    if (cost < best.cost - 1e-6) best = { cost, protect };
  }
  return { ...best, candidates: cand };
}

/** 메이플스토리 KMS 스타포스 1회 비용 (2025.03 개편 이후, 일반 장비, 할인 전). 십의 자리에서 반올림. */
export function mapleStarforceCost(level, s) {
  const L3 = level ** 3;
  const div = { 10: 571, 11: 314, 12: 214, 13: 157, 14: 107, 17: 150, 18: 70, 19: 45, 21: 125 };
  const raw = s < 10 ? 1000 + (L3 * (s + 1)) / 36 : 1000 + (L3 * (s + 1) ** 2.7) / (div[s] ?? 200);
  return Math.round(raw / 100) * 100;
}

export function round(x, d = 2) { const f = 10 ** d; return Math.round(x * f) / f; }
