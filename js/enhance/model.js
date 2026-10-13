// 강화 기대값 엔진 — 순수 계산 모듈 (DOM 없음, Node 테스트에서 그대로 import)
//
// ■ 모델: 흡수 마르코프 체인
//   상태 = (단계 i, 연속 카운터 c). 카운터는 천장·실패 누적 보너스·찬스타임을 하나로 표현한다.
//     kind 'fail' : 유지·하락 시 +1, 성공·파괴 시 0  (천장, 장인의 기운식 보너스)
//     kind 'drop' : 하락 시 +1, 유지 시 그대로, 성공·파괴 시 0  (찬스타임)
//   1회 시도 결과: 성공(+1) / 대성공(+2, 이중 강화) / 유지 / 하락(−1) / 파괴(→ 복구 단계, 복구 비용)
//
// ■ 풀이
//   기대값 벡터 E는 (I − P)E = r 을 만족한다 (r = 상태별 1회 기대 비용).
//   상태를 단계 순으로 정렬하면 I − P는 '띠 행렬 + 파괴 열(rank-1)'이다.
//     M = I − P(파괴 제외)  → 띠 LU 분해 (피벗 없음: 행 대각 우세라 안정)
//     I − P = M + u e_Rᵀ,  u = −(상태별 파괴 확률)  → Sherman–Morrison 으로 보정
//   같은 분해 하나로 기대 비용, 2차 모멘트(→ 정확한 표준편차), 재화별 소모량, 방문 횟수를 모두 구한다.

/** @typedef {{stage:number, s:number, s2:number, k:number, d:number, b:number, costs:number[]}} Row  확률은 % */
/** @typedef {{id:string, name:string, effect:'protect'|'nodrop'|'boost', amount:number, costs:number[], from:number, to:number}} Item */

const EPS = 1e-12;
export const MAX_COUNTER = 300;
export const MAX_ITEMS = 5;

// ── 검증 ────────────────────────────────────────────────
export function validate(cfg) {
  const errors = [];
  const { rows, start, target, restore } = cfg;
  const byStage = new Map(rows.map(r => [r.stage, r]));
  if (!(target > start)) errors.push('목표 단계는 시작 단계보다 커야 합니다.');
  if (!cfg.resources?.length) errors.push('재화를 1개 이상 등록하세요.');
  const floor = rows.length ? Math.min(...rows.map(r => r.stage)) : 0;
  for (let i = floor; i < target; i++) if (!byStage.has(i)) errors.push(`+${i} 단계 행이 없습니다.`);
  if (start < floor) errors.push('시작 단계가 표의 첫 단계보다 작습니다.');
  if (restore < floor || restore >= target) errors.push(`파괴 시 복구 단계는 +${floor} ~ +${target - 1} 사이여야 합니다.`);
  for (const r of rows) {
    if (r.stage >= target) continue;
    const vals = [r.s, cfg.double ? r.s2 : 0, r.k, r.d, r.b];
    if (vals.some(v => !(v >= 0))) { errors.push(`+${r.stage}: 확률은 0 이상이어야 합니다.`); continue; }
    const sum = vals.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 0.01) errors.push(`+${r.stage}: 확률 합이 ${round(sum, 4)}%입니다 (100%여야 함${cfg.double ? '' : ', 대성공 칸은 이중 강화가 꺼져 있으면 무시'}).`);
    if (r.costs.some(v => !(v >= 0))) errors.push(`+${r.stage}: 비용은 0 이상이어야 합니다.`);
  }
  const st = cfg.streak || {};
  if (st.kind && st.kind !== 'none') {
    if (st.pity && !(Number.isInteger(st.pity) && st.pity >= 1)) errors.push('천장 횟수는 1 이상의 정수여야 합니다.');
    if (!st.pity && !(st.bonus > 0)) errors.push('연속 보정을 켰다면 천장 또는 보너스 중 하나는 설정해야 합니다.');
  }
  if ((cfg.items || []).length > MAX_ITEMS) errors.push(`보조 아이템은 최대 ${MAX_ITEMS}개까지 지원합니다.`);
  if (!errors.length) {
    const C = counterSize(cfg);
    if (C > MAX_COUNTER) errors.push(`연속 보정 상태가 너무 많습니다(${C}). 천장을 설정하거나 보너스를 키우세요.`);
  }
  return errors;
}

// ── 확률 조작 헬퍼 ──────────────────────────────────────
/** 성공(+1)에 delta를 더하고 실패(유지·하락·파괴)에서 비율대로 뺀다. both=true면 성공·대성공에 비율대로 분배. */
function shiftToSuccess(p, delta, both = false) {
  const f = p.k + p.d + p.b;
  delta = Math.min(delta, f);
  if (delta <= 0) return;
  const keep = 1 - delta / f;
  p.k *= keep; p.d *= keep; p.b *= keep;
  const sTot = p.s + p.s2;
  if (both && sTot > 0) { p.s += delta * p.s / sTot; p.s2 += delta * p.s2 / sTot; }
  else p.s += delta;
}

/** 성공·대성공을 줄이고(실패에 비율대로 더함). */
function shiftFromSuccess(p, delta) {
  const sTot = p.s + p.s2;
  delta = Math.min(delta, sTot);
  if (delta <= 0) return;
  const keep = 1 - delta / sTot;
  p.s *= keep; p.s2 *= keep;
  const f = p.k + p.d + p.b;
  if (f > 0) { const g = 1 + delta / f; p.k *= g; p.d *= g; p.b *= g; } else p.k += delta;
}

/** 단계 기본 성공 확률(성공+대성공, 0~1) 기준 카운터 1당 보너스. */
function bonusPerCount(cfg, row) {
  const st = cfg.streak;
  const base = (row.s + (cfg.double ? row.s2 : 0)) / 100;
  return st.bonusMode === 'rel' ? base * st.bonus / 100 : st.bonus / 100;
}

/** 카운터 상태 수(0..C). */
export function counterSize(cfg) {
  const st = cfg.streak || {};
  if (!st.kind || st.kind === 'none') return 0;
  if (st.pity) return st.pity;
  if (!(st.bonus > 0)) return 0;
  const cap = (st.cap ?? 100) / 100;
  let C = 0;
  for (const r of cfg.rows) {
    if (r.stage >= cfg.target) continue; // 하락으로 시작 단계 아래도 방문하므로 표 전체 대상
    const per = bonusPerCount(cfg, r);
    const room = cap - (r.s + (cfg.double ? r.s2 : 0)) / 100;
    if (per > 0 && room > 0) C = Math.max(C, Math.ceil(room / per - 1e-9));
  }
  return C;
}

/**
 * (단계, 카운터, 사용 아이템)에서의 실효 확률 (0~1).
 * 적용 순서: 천장(확정 성공) → 이벤트 배율 → 연속 보너스 → 성공률 아이템 → 파괴방지·하락방지
 */
export function effectiveProbs(cfg, row, c, items) {
  const st = cfg.streak || {};
  if (st.kind && st.kind !== 'none' && st.pity && c >= st.pity) {
    return { s: 1, s2: 0, k: 0, d: 0, b: 0, forced: true };
  }
  const p = { s: row.s / 100, s2: cfg.double ? row.s2 / 100 : 0, k: row.k / 100, d: row.d / 100, b: row.b / 100, forced: false };
  const ev = cfg.event;
  if (ev?.on) {
    const m = ev.successMult ?? 1, sTot = p.s + p.s2;
    if (m > 1) shiftToSuccess(p, sTot * (m - 1), true);
    else if (m < 1) shiftFromSuccess(p, sTot * (1 - m));
    const dm = ev.destroyMult ?? 1;
    if (dm !== 1) {
      const diff = p.b * (dm - 1);
      if (diff < 0) { p.b += diff; p.k -= diff; }
      else { const take = Math.min(diff, p.k); p.b += take; p.k -= take; }
    }
  }
  if (st.kind && st.kind !== 'none' && st.bonus > 0 && c > 0) {
    const cap = (st.cap ?? 100) / 100;
    const add = Math.min(c * bonusPerCount(cfg, row), Math.max(0, cap - (p.s + p.s2)));
    shiftToSuccess(p, add);
  }
  if (items?.length) {
    const boost = items.filter(it => it.effect === 'boost').reduce((a, it) => a + it.amount / 100, 0);
    if (boost > 0) shiftToSuccess(p, boost);
    if (items.some(it => it.effect === 'protect')) { p.k += p.b; p.b = 0; }
    if (items.some(it => it.effect === 'nodrop')) { p.k += p.d; p.d = 0; }
  }
  return p;
}

// ── 사용 아이템 조회 ────────────────────────────────────
/** usage[stage] = 아이템 id 배열 (모든 카운터 공통) 또는 {byCounter: id배열[]} (최적화 결과) */
export function usageAt(cfg, stage, c) {
  const u = cfg.usage?.[stage];
  if (!u) return [];
  const ids = Array.isArray(u) ? u : u.byCounter[Math.min(c, u.byCounter.length - 1)] || [];
  return ids.map(id => cfg.items.find(it => it.id === id)).filter(it => it && stage >= it.from && stage <= it.to);
}

// ── 체인 생성 ───────────────────────────────────────────
/**
 * 상태·전이 생성. actionFor(stage, c) → 사용 아이템 배열 (기본: cfg.usage)
 * 각 상태: { stage, c, p, cost(가치), units(재화별), edges:[[to, prob, kind]] } — to = −1 은 목표 도달
 */
export function buildChain(cfg, actionFor = (i, c) => usageAt(cfg, i, c)) {
  const floor = Math.min(...cfg.rows.map(r => r.stage));
  const C = counterSize(cfg);
  const m = C + 1;
  const kind = cfg.streak?.kind || 'none';
  const byStage = new Map(cfg.rows.map(r => [r.stage, r]));
  const nRes = cfg.resources.length;
  const values = cfg.resources.map(r => r.value);
  const costMult = cfg.event?.on ? (cfg.event.costMult ?? 1) : 1;
  const idx = (i, c) => (i >= cfg.target ? -1 : (i - floor) * m + c);
  const states = [];
  for (let i = floor; i < cfg.target; i++) {
    const row = byStage.get(i);
    for (let c = 0; c < m; c++) {
      const items = actionFor(i, c);
      const p = effectiveProbs(cfg, row, c, items);
      const used = p.forced ? [] : items;
      const units = new Float64Array(nRes);
      for (let r = 0; r < nRes; r++) units[r] = (row.costs[r] || 0) * costMult;
      for (const it of used) for (let r = 0; r < nRes; r++) units[r] += it.costs[r] || 0;
      let cost = 0; for (let r = 0; r < nRes; r++) cost += units[r] * values[r];
      let itemCost = 0; for (const it of used) for (let r = 0; r < nRes; r++) itemCost += (it.costs[r] || 0) * values[r];
      const up = (x) => Math.min(x, C);
      const edges = [];
      if (p.s > 0) edges.push([idx(i + 1, 0), p.s, 's']);
      if (p.s2 > 0) edges.push([idx(i + 2, 0), p.s2, 's2']);
      if (p.k > 0) edges.push([idx(i, kind === 'fail' ? up(c + 1) : c), p.k, 'k']);
      if (p.d > 0) edges.push([idx(Math.max(i - 1, floor), kind === 'none' ? 0 : up(c + 1)), p.d, 'd']);
      if (p.b > 0) edges.push([idx(cfg.restore, 0), p.b, 'b']);
      states.push({ stage: i, c, p, items: used, units, cost, itemCost, edges });
    }
  }
  const destroyUnits = cfg.resources.map((_, r) => cfg.destroyCosts?.[r] || 0);
  const destroyCost = destroyUnits.reduce((a, u, r) => a + u * values[r], 0);
  return {
    states, n: states.length, m, C, floor,
    S: idx(cfg.start, 0), R: idx(cfg.restore, 0),
    kl: 2 * m - 1, ku: 2 * m, destroyUnits, destroyCost,
  };
}

// ── 띠 행렬 LU (피벗 없음) ──────────────────────────────
class BandLU {
  constructor(n, kl, ku) {
    this.n = n; this.kl = Math.min(kl, n - 1); this.ku = Math.min(ku, n - 1);
    this.w = this.kl + this.ku + 1;
    this.a = new Float64Array(n * this.w);
  }
  at(i, j) { return i * this.w + (j - i + this.kl); }
  add(i, j, v) { this.a[this.at(i, j)] += v; }
  factor() {
    const { n, kl, ku, a } = this;
    for (let k = 0; k < n; k++) {
      const piv = a[this.at(k, k)];
      if (Math.abs(piv) < EPS) return false;
      const iMax = Math.min(n - 1, k + kl), jMax = Math.min(n - 1, k + ku);
      for (let i = k + 1; i <= iMax; i++) {
        const ik = this.at(i, k);
        if (a[ik] === 0) continue;
        const l = (a[ik] /= piv);
        const rowI = this.at(i, 0), rowK = this.at(k, 0);
        for (let j = k + 1; j <= jMax; j++) a[rowI + j] -= l * a[rowK + j];
      }
    }
    return true;
  }
  solve(b) { // M x = b
    const { n, kl, ku, a } = this; const x = Float64Array.from(b);
    for (let i = 0; i < n; i++) { const o = this.at(i, 0); let s = x[i]; for (let j = Math.max(0, i - kl); j < i; j++) s -= a[o + j] * x[j]; x[i] = s; }
    for (let i = n - 1; i >= 0; i--) { const o = this.at(i, 0); let s = x[i]; for (let j = i + 1; j <= Math.min(n - 1, i + ku); j++) s -= a[o + j] * x[j]; x[i] = s / a[o + i]; }
    return x;
  }
  /** 앞쪽 K개 상태만의 부분 행렬로 풀기. 피벗 없는 LU에서 선행 주부분행렬의 LU = LU의 선행 블록. */
  solvePrefix(b, K) {
    const { kl, ku, a } = this; const x = Float64Array.from(b.subarray(0, K));
    for (let i = 0; i < K; i++) { const o = this.at(i, 0); let s = x[i]; for (let j = Math.max(0, i - kl); j < i; j++) s -= a[o + j] * x[j]; x[i] = s; }
    for (let i = K - 1; i >= 0; i--) { const o = this.at(i, 0); let s = x[i]; for (let j = i + 1; j <= Math.min(K - 1, i + ku); j++) s -= a[o + j] * x[j]; x[i] = s / a[o + i]; }
    return x;
  }
  solveT(b) { // Mᵀ x = b  (Uᵀ 전진 → Lᵀ 후진)
    const { n, kl, ku, a } = this; const x = Float64Array.from(b);
    for (let i = 0; i < n; i++) { let s = x[i]; for (let j = Math.max(0, i - ku); j < i; j++) s -= a[this.at(j, i)] * x[j]; x[i] = s / a[this.at(i, i)]; }
    for (let i = n - 1; i >= 0; i--) { let s = x[i]; for (let j = i + 1; j <= Math.min(n - 1, i + kl); j++) s -= a[this.at(j, i)] * x[j]; x[i] = s; }
    return x;
  }
}

/** I − P 풀이기. 파괴 열은 Sherman–Morrison으로 처리. */
function makeSolver(chain) {
  const { states, n, R } = chain;
  const M = new BandLU(n, chain.kl, chain.ku);
  const u = new Float64Array(n);
  states.forEach((st, r) => {
    M.add(r, r, 1);
    for (const [to, p, kind] of st.edges) {
      if (to === -1) continue;
      if (kind === 'b') u[r] -= p; else M.add(r, to, -p);
    }
  });
  if (!M.factor()) return null;
  const y = M.solve(u);                 // M⁻¹u
  const denom = 1 + y[R];
  const eR = new Float64Array(n); eR[R] = 1;
  const z = M.solveT(eR);               // M⁻ᵀ e_R
  let denomT = 1; for (let i = 0; i < n; i++) denomT += u[i] * z[i];
  if (Math.abs(denom) < 1e-10 || Math.abs(denomT) < 1e-10) return null; // 목표 도달 불가
  return {
    /** (I − P) x = b */
    solve(b) { const x = M.solve(b); const f = x[R] / denom; for (let i = 0; i < n; i++) x[i] -= y[i] * f; return x; },
    /** (I − P)ᵀ x = b */
    solveT(b) { const x = M.solveT(b); let w = 0; for (let i = 0; i < n; i++) w += u[i] * x[i]; const f = w / denomT; for (let i = 0; i < n; i++) x[i] -= z[i] * f; return x; },
    /** 파괴를 '실패로 종료'로 볼 때: M x = b */
    solveNoDestroy(b) { return M.solve(b); },
    /** 단계 순 정렬 덕분에, 'K번째 상태 이전 블록을 벗어나기 전 파괴' 문제는 M의 선행 블록으로 풀린다 */
    solvePrefix(b, K) { return M.solvePrefix(b, K); },
  };
}

// ── 분석 ────────────────────────────────────────────────
export function analyze(cfg) {
  const errors = validate(cfg);
  if (errors.length) return { ok: false, errors };
  const chain = buildChain(cfg);
  const sol = makeSolver(chain);
  if (!sol) return { ok: false, errors: ['목표에 도달할 수 없는 설정입니다 (경로에 성공 확률 0인 단계가 있음).'] };
  const { states, n, S, R, destroyCost, destroyUnits } = chain;
  const vec = (f) => { const v = new Float64Array(n); states.forEach((st, r) => { v[r] = f(st, r); }); return v; };
  const pB = vec(st => st.p.b);
  const pT = vec(st => st.edges.reduce((a, [to, p]) => a + (to === -1 ? p : 0), 0));

  // 1차: 기대 비용·시도·파괴
  const E = sol.solve(vec((st, r) => st.cost + pB[r] * destroyCost));
  const T = sol.solve(vec(() => 1));
  const D = sol.solve(pB);
  if (!(E[S] >= 0) || !Number.isFinite(E[S])) return { ok: false, errors: ['계산이 수렴하지 않았습니다. 확률을 확인하세요.'] };

  // 2차 모멘트: S2_s = Σ_t P_st [w_st² + 2 w_st E_t] + Σ_t P_st S2_t  → 정확한 분산
  const g = vec((st) => {
    let acc = 0;
    for (const [to, p, kind] of st.edges) {
      const w = st.cost + (kind === 'b' ? destroyCost : 0);
      acc += p * (w * w + 2 * w * (to === -1 ? 0 : E[to]));
    }
    return acc;
  });
  const S2 = sol.solve(g);
  const variance = Math.max(0, S2[S] - E[S] * E[S]);

  // 재화별 기대 소모량
  const resources = cfg.resources.map((res, ri) => {
    const U = sol.solve(vec((st, r) => st.units[ri] + pB[r] * destroyUnits[ri]));
    return { name: res.name, value: res.value, units: U[S], worth: U[S] * res.value };
  });

  // 파괴 없이 도달 확률 (파괴 = 종료)
  const q = sol.solveNoDestroy(pT);

  // 방문 횟수 N = (I−P)⁻ᵀ e_S  → 단계별 분해와 민감도
  const eS = new Float64Array(n); eS[S] = 1;
  const N = sol.solveT(eS);
  const delta = 0.01; // 성공률 +1%p
  const stageMap = new Map();
  let itemSpend = 0;
  states.forEach((st, r) => {
    const v = Math.max(0, N[r]);
    itemSpend += v * st.itemCost;
    const o = stageMap.get(st.stage) || { stage: st.stage, visits: 0, cost: 0, destroys: 0, sens: 0 };
    o.visits += v;
    o.cost += v * (st.cost + st.p.b * destroyCost);
    o.destroys += v * st.p.b;
    // 민감도(수반 방법): dE_S ≈ Σ_s N_s · δ · [E_succ − (k·E_keep + d·E_drop + b·(복구비 + E_R)) / f]
    const { k, d, b } = st.p, f = k + d + b;
    if (!st.p.forced && f > 1e-12 && v > 0) {
      let eSucc = 0, eFail = 0;
      for (const [to, p, kind] of st.edges) {
        const Et = to === -1 ? 0 : E[to];
        if (kind === 's') eSucc = Et;
        else if (kind === 'k' || kind === 'd') eFail += p * Et;
        else if (kind === 'b') eFail += p * (destroyCost + Et);
      }
      if (!st.edges.some(e => e[2] === 's')) eSucc = st.stage + 1 >= cfg.target ? 0 : E[(st.stage + 1 - chain.floor) * chain.m];
      o.sens += v * delta * (eSucc - eFail / f);
    }
    stageMap.set(st.stage, o);
  });

  const qS = q[S], qR = q[R];
  const stages = [...stageMap.values()].map(o => {
    const first = (o.stage - chain.floor) * chain.m;
    const st0 = states[first];
    // '+i에서 출발해 +i+1 이상에 닿기 전에 파괴될 확률' (하락·카운터 포함 정확해)
    //   상태 0..K−1(= +i 이하)만의 체인에서, 블록 밖으로 나가는(파괴 제외) 확률을 우변으로 푼다.
    const K = first + chain.m;
    const exit = new Float64Array(K);
    for (let r = 0; r < K; r++) for (const [to, p, kind] of states[r].edges) if (kind !== 'b' && (to === -1 || to >= K)) exit[r] += p;
    const pass = sol.solvePrefix(exit, K)[first];
    return {
      ...o,
      p: st0.p, items: st0.items.map(it => it.id), attemptCost: st0.cost,
      destroyBeforePass: Math.min(1, Math.max(0, 1 - pass)),
      sensPct: E[S] > 0 ? o.sens / E[S] : 0,
    };
  });

  return {
    ok: true,
    expCost: E[S], std: Math.sqrt(variance), attempts: T[S], expDestroy: D[S], noDestroy: qS,
    resources, stages,
    destroyCostTotal: D[S] * destroyCost,
    itemSpend, // 보조 아이템에 쓰는 기대 금액 (BM 기대 매출)
    destroyDist: (j) => (j === 0 ? qS : (1 - qS) * Math.pow(1 - qR, j - 1) * qR),
    destroyQuantile: (pr) => destroyQuantile(qS, qR, pr),
    meta: { states: n, counter: chain.C },
  };
}

function destroyQuantile(q0, qR, p) {
  if (p <= q0) return 0;
  if (qR >= 1) return 1;
  return Math.max(1, Math.ceil(Math.log((1 - p) / (1 - q0)) / Math.log(1 - qR) - 1e-12));
}

/** 기대 비용만 (내부 반복 계산용) */
export function expectedCost(cfg, actionFor) {
  const chain = buildChain(cfg, actionFor);
  const sol = makeSolver(chain);
  if (!sol) return { cost: Infinity };
  const E = sol.solve(Float64Array.from(chain.states, st => st.cost + st.p.b * chain.destroyCost));
  return { cost: E[chain.S], E, chain };
}

// ── 보조 아이템 최적 사용: 마르코프 결정 과정, 정책 반복 ──
/**
 * 상태(단계, 카운터)마다 '어떤 아이템 조합을 쓸지'를 골라 목표까지의 기대 총비용(가치 기준)을 최소화한다.
 * 정책 평가(연립방정식) ↔ 정책 개선(Q값 최소 행동 선택)을 바뀌는 것이 없을 때까지 반복.
 */
export function optimizeItems(cfg) {
  const errors = validate(cfg);
  if (errors.length) return { ok: false, errors };
  const items = cfg.items || [];
  if (!items.length) return { ok: false, errors: ['보조 아이템이 없습니다.'] };
  const subsets = (stage) => {
    const avail = items.filter(it => stage >= it.from && stage <= it.to);
    const out = [];
    for (let mask = 0; mask < 1 << avail.length; mask++) out.push(avail.filter((_, i) => mask & (1 << i)));
    return out;
  };
  const floor = Math.min(...cfg.rows.map(r => r.stage));
  const m = counterSize(cfg) + 1;
  const actionSets = new Map();
  for (let i = floor; i < cfg.target; i++) actionSets.set(i, subsets(i));
  // 시작 정책: 현재 수동 설정
  const policy = new Map();
  for (let i = floor; i < cfg.target; i++) for (let c = 0; c < m; c++) {
    const cur = usageAt(cfg, i, c).map(it => it.id).sort().join();
    const opts = actionSets.get(i);
    policy.set(i * 1000 + c, Math.max(0, opts.findIndex(a => a.map(it => it.id).sort().join() === cur)));
  }
  const actionFor = (i, c) => actionSets.get(i)[policy.get(i * 1000 + c)] || [];
  const before = expectedCost(cfg).cost;
  const byStage = new Map(cfg.rows.map(r => [r.stage, r]));
  const kind = cfg.streak?.kind || 'none';
  const values = cfg.resources.map(r => r.value);
  const costMult = cfg.event?.on ? (cfg.event.costMult ?? 1) : 1;
  let iterations = 0, res;
  for (; iterations < 50; iterations++) {
    res = expectedCost(cfg, actionFor);
    if (!Number.isFinite(res.cost)) return { ok: false, errors: ['현재 정책으로는 목표에 도달할 수 없습니다.'] };
    const { E, chain } = res;
    const idx = (i, c) => (i >= cfg.target ? -1 : (i - floor) * m + c);
    let changed = false;
    for (let i = floor; i < cfg.target; i++) {
      const row = byStage.get(i);
      const base = row.costs.reduce((a, v, r) => a + (v || 0) * costMult * values[r], 0);
      for (let c = 0; c < m; c++) {
        const key = i * 1000 + c;
        const q = actionSets.get(i).map(act => {
          const p = effectiveProbs(cfg, row, c, act);
          const itemCost = p.forced ? 0 : act.reduce((a, it) => a + it.costs.reduce((s, v, r) => s + (v || 0) * values[r], 0), 0);
          const up = (x) => Math.min(x, m - 1);
          const Ev = (to) => (to === -1 ? 0 : E[to]);
          return base + itemCost
            + p.s * Ev(idx(i + 1, 0)) + p.s2 * Ev(idx(i + 2, 0))
            + p.k * Ev(idx(i, kind === 'fail' ? up(c + 1) : c))
            + p.d * Ev(idx(Math.max(i - 1, floor), kind === 'none' ? 0 : up(c + 1)))
            + p.b * (chain.destroyCost + Ev(idx(cfg.restore, 0)));
        });
        const cur = policy.get(key);
        let best = cur;
        for (let a = 0; a < q.length; a++) if (q[a] < q[best] - 1e-9 * Math.max(1, Math.abs(q[best]))) best = a;
        if (best !== cur) { policy.set(key, best); changed = true; }
      }
    }
    if (!changed) break;
  }
  // 결과를 usage 형식으로: 단계 내 모든 카운터가 같으면 배열, 다르면 byCounter
  const usage = {};
  for (let i = floor; i < cfg.target; i++) {
    const per = [];
    for (let c = 0; c < m; c++) per.push(actionFor(i, c).map(it => it.id));
    const same = per.every(a => a.join() === per[0].join());
    if (same ? per[0].length : true) usage[i] = same ? per[0] : { byCounter: per };
  }
  return { ok: true, usage, before, after: res.cost, iterations: iterations + 1 };
}

// ── 역산: 목표 기대 비용에 맞는 성공률 배율 ───────────────
/** 단계 [from, to]의 성공·대성공 확률에 배율 α를 곱한 표 (실패 결과는 비율 유지, 합 100 보정) */
export function scaleSuccess(rows, alpha, from, to, double) {
  return rows.map(r => {
    if (r.stage < from || r.stage > to) return r;
    const p = { s: r.s / 100, s2: double ? r.s2 / 100 : 0, k: r.k / 100, d: r.d / 100, b: r.b / 100 };
    const sTot = p.s + p.s2;
    if (alpha > 1) shiftToSuccess(p, Math.min(1, sTot * alpha) - sTot, true);
    else shiftFromSuccess(p, sTot * (1 - alpha));
    const out = { ...r, s: round(p.s * 100, 4), s2: double ? round(p.s2 * 100, 4) : r.s2, d: round(p.d * 100, 4), b: round(p.b * 100, 4) };
    out.k = round(100 - out.s - (double ? out.s2 : 0) - out.d - out.b, 4); // 반올림 오차는 유지에 흡수
    return out;
  });
}

export function solveForCost(cfg, targetCost, from, to) {
  const costAt = (a) => {
    const c = { ...cfg, rows: scaleSuccess(cfg.rows, a, from, to, cfg.double) };
    return validate(c).length ? NaN : expectedCost(c).cost;
  };
  // 단계별로 100%에서 잘리므로(scaleSuccess), 상한은 '가장 낮은 성공률이 100%가 되는 배율'
  let maxA = -Infinity;
  for (const r of cfg.rows) if (r.stage >= from && r.stage <= to) {
    const sTot = (r.s + (cfg.double ? r.s2 : 0)) / 100;
    if (sTot > 0) maxA = Math.max(maxA, 1 / sTot);
  }
  if (!Number.isFinite(maxA)) return { ok: false, error: '해당 구간에 성공 확률이 있는 단계가 없습니다.' };
  let lo = 0.02, hi = maxA;
  const cLo = costAt(lo), cHi = costAt(hi);
  if (!(targetCost <= cLo) || !(targetCost >= cHi)) {
    return { ok: false, error: `조정 가능한 범위는 ${Math.round(cHi).toLocaleString('ko-KR')} ~ ${Number.isFinite(cLo) ? Math.round(cLo).toLocaleString('ko-KR') : '∞'} 입니다.`, min: cHi, max: cLo };
  }
  for (let it = 0; it < 60; it++) { // 기대 비용은 α에 대해 감소 → 이분 탐색(로그 스케일)
    const mid = Math.sqrt(lo * hi);
    if (costAt(mid) > targetCost) lo = mid; else hi = mid;
    if (hi / lo < 1 + 1e-7) break;
  }
  const alpha = Math.sqrt(lo * hi);
  return { ok: true, alpha, rows: scaleSuccess(cfg.rows, alpha, from, to, cfg.double), cost: costAt(alpha) };
}

export function round(x, d = 2) { const f = 10 ** d; return Math.round(x * f) / f; }
