// 가챠·수집 설계 — 뽑기 확률·소환 레벨·천장·픽업·마일리지·분해 교환으로 수집 목표의 비용 분포를 계산 (순수 계산 모듈, DOM 없음)
//
// ■ 뽑기
//   등급(낮은 → 높은, 마지막이 최상위)마다 확률·종 수. 같은 등급 안의 유닛은 균등.
//   소환 레벨: 누적 뽑기 수가 기준을 넘으면 다음 레벨의 확률표를 쓴다 (레벨 1개 = 고정 확률).
//   천장(최상위 등급만): 마지막 최상위 이후 j번째 뽑기의 확률
//       j < 확률 상승 시작       → 기본 확률
//       확률 상승 시작 ≤ j < 천장 → 기본 + 상승폭 × (j − 시작 + 1)
//       j = 천장                  → 100%
//   픽업(최상위 등급만): 최상위가 나오면 픽업 비율로 픽업 유닛, 아니면 나머지 중 균등. 보장 켜면 놓친 다음 최상위는 픽업 확정.
//   마일리지: 뽑기마다 쌓여 정해진 양으로 최상위 원하는 1장과 교환 (픽업 포함).
//   분해·교환: 필요 없는 중복은 등급별 조각으로 바뀌고, 등급별 교환 가격으로 그 등급 원하는 1장과 교환.
//
// ■ 목표
//   수집: 등급 g의 K종을 각 k장씩 (픽업 등급이면 픽업 유닛이 K종의 첫 번째)
//   픽업: 픽업 유닛 k장 (= 최상위 등급 1종 × k장)
//
// ■ 계산
//   시뮬레이션: 목표 등급의 다음 당첨까지를 기하분포로 한 번에 건너뛴다(확률이 바뀌는 지점 — 소환 레벨, 천장 확률 상승 구간,
//     마일리지·조각이 교환 가격에 닿는 시점 — 에서 끊음). 다른 등급의 중복 조각은 뽑기당 기대값으로 쌓는다.
//   정확해 ①(수집, 확률 고정·교환 없음): 포아송화. 시행 횟수의 기댓값 = 연속 시간 포아송 과정에서 완료 시각의 기댓값
//     E[N] = (1/λ) ∫₀^∞ 1 − P(k, u)^K du,  λ = 등급 확률 ÷ 종 수, P = 정칙화 하부 불완전 감마 (= 포아송 ≥ k 확률)
//   정확해 ②(픽업, 분해 교환 없음): 상태(모은 장수, 천장 카운터, 보장 여부)의 분포를 뽑기마다 전진하는 동적 계획법.
//     마일리지는 뽑기 수만으로 정해지는 시점에 1장을 더하므로 그대로 반영된다. 분포 전체(분위수·예산별 도달 확률)가 정확하다.

import { mulberry32 } from '../enhance/simulate.js';

export const GOAL_TYPES = { collect: '수집 (K종 × k장)', pickup: '픽업 유닛 k장' };
const MAX_PULLS = 1e9; // 한 번 시행의 상한 (확률 0 등으로 닿지 못하는 목표)

export function validate(cfg) {
  const errors = [];
  const G = cfg.grades.length;
  if (!G) errors.push('등급을 1개 이상 추가하세요.');
  if (!(cfg.pullCost > 0)) errors.push('1회 뽑기 비용은 0보다 커야 합니다.');
  if (!(cfg.wonPerGem >= 0)) errors.push('유료 재화 단가는 0 이상이어야 합니다.');
  const L = cfg.levels.length;
  if (!L || cfg.levels[0] !== 0) errors.push('첫 소환 레벨은 누적 0회부터 시작해야 합니다.');
  for (let i = 1; i < L; i++) if (!(cfg.levels[i] > cfg.levels[i - 1])) errors.push(`소환 레벨 ${i + 1}의 기준 뽑기 수는 레벨 ${i}보다 커야 합니다.`);
  for (let l = 0; l < L; l++) {
    const sum = cfg.grades.reduce((a, g) => a + (g.probs[l] ?? 0), 0);
    if (Math.abs(sum - 100) > 1e-6) errors.push(`소환 레벨 ${l + 1}의 등급 확률 합이 ${+sum.toFixed(6)}%입니다 (100%여야 함).`);
    cfg.grades.forEach(g => { if (!((g.probs[l] ?? 0) >= 0)) errors.push(`${g.name}: 확률은 0 이상이어야 합니다.`); });
  }
  cfg.grades.forEach(g => {
    if (!(Number.isInteger(g.kinds) && g.kinds >= 1)) errors.push(`${g.name}: 종 수는 1 이상 정수여야 합니다.`);
    if (!(g.shard >= 0) || !(g.exchange >= 0)) errors.push(`${g.name}: 조각·교환 가격은 0 이상이어야 합니다.`);
  });
  const top = cfg.grades.at(-1);
  if (cfg.pity?.enabled) {
    if (!(Number.isInteger(cfg.pity.hard) && cfg.pity.hard >= 1)) errors.push('천장은 1회 이상 정수여야 합니다.');
    if (!(cfg.pity.softStep >= 0)) errors.push('천장 확률 상승폭은 0 이상이어야 합니다.');
  }
  if (cfg.pickup?.enabled) {
    if (top && top.kinds < 2) errors.push(`픽업을 쓰려면 최상위 등급(${top.name})이 2종 이상이어야 합니다.`);
    if (!(cfg.pickup.share > 0 && cfg.pickup.share <= 100)) errors.push('픽업 비율은 0% 초과 100% 이하여야 합니다.');
  }
  if (cfg.mileage?.enabled && !(cfg.mileage.per > 0 && cfg.mileage.cost > 0)) errors.push('마일리지는 뽑기당 적립량과 교환 가격이 0보다 커야 합니다.');
  if (!cfg.goals.length) errors.push('목표를 1개 이상 추가하세요.');
  cfg.goals.forEach((goal, i) => {
    const label = `목표 ${i + 1}번 '${goal.name}'`;
    if (!(Number.isInteger(goal.copies) && goal.copies >= 1)) errors.push(`${label}: 장수는 1 이상 정수여야 합니다.`);
    if (goal.type === 'collect') {
      const g = cfg.grades.find(x => x.id === goal.grade);
      if (!g) errors.push(`${label}: 등급을 선택하세요.`);
      else if (!(Number.isInteger(goal.kinds) && goal.kinds >= 1 && goal.kinds <= g.kinds)) errors.push(`${label}: 종 수는 1~${g.kinds}(${g.name} 전체 종 수)여야 합니다.`);
    }
  });
  return errors;
}

// ── 공용 ─────────────────────────────────────────────────
export const levelAt = (levels, t) => { let l = 0; while (l + 1 < levels.length && levels[l + 1] <= t) l++; return l; };
const probTable = (cfg) => cfg.levels.map((_, l) => cfg.grades.map(g => (g.probs[l] ?? 0) / 100));

/** 마지막 최상위 이후 j번째 뽑기(1부터)의 최상위 확률 */
export function topProb(cfg, base, j) {
  const p = cfg.pity;
  if (!p?.enabled) return base;
  if (j >= p.hard) return 1;
  if (p.softStep > 0 && j >= p.softStart) return Math.min(1, base + (p.softStep / 100) * (j - p.softStart + 1));
  return base;
}

/** 목표 → 계산용 정의: 등급 인덱스, 종 수(K), 장수(k), 등급 전체 종 수(n) */
export function goalSpec(cfg, goal) {
  const top = cfg.grades.length - 1;
  const g = goal.type === 'pickup' ? top : cfg.grades.findIndex(x => x.id === goal.grade);
  return { g, isTop: g === top, K: goal.type === 'pickup' ? 1 : goal.kinds, k: goal.copies, n: cfg.grades[g].kinds };
}

/** 단순 계산: 필요한 총 장수 ÷ (목표 유닛이 나올 확률), 확률은 가장 높은 소환 레벨 기준 — 엑셀에서 흔히 쓰는 근사 */
export function naivePulls(cfg, goal) {
  const { g, K, k, n } = goalSpec(cfg, goal);
  const pMax = Math.max(...cfg.levels.map((_, l) => (cfg.grades[g].probs[l] ?? 0) / 100));
  if (goal.type === 'pickup') {
    const share = cfg.pickup?.enabled ? cfg.pickup.share / 100 : 1 / n;
    return k / (pMax * share);
  }
  return (K * k) / (pMax * K / n); // 목표 K종이 나올 확률 = 등급 확률 × K/n
}

/**
 * 중복 없는 경우(수집 목표만): 목표 등급의 어떤 유닛이 나와도 목표에 들어간다고 보고 같은 장수를 모으는 뽑기 수.
 * 소환 레벨·천장·교환은 그대로 → 단순 계산과의 차이 = 확률 구조 효과, 실제와의 차이 = 중복 효과
 */
export function noDupConfig(cfg, goal) {
  if (goal.type !== 'collect') return null;
  const { g, K, k } = goalSpec(cfg, goal);
  const c2 = { ...cfg, grades: cfg.grades.map((x, i) => (i === g ? { ...x, kinds: 1 } : x)), pickup: { ...cfg.pickup, enabled: false } };
  return { cfg: c2, goal: { ...goal, kinds: 1, copies: K * k } };
}

// ── 시뮬레이션 ───────────────────────────────────────────
function geometric(p, rnd) {
  if (p >= 1) return 1;
  if (!(p > 0)) return Infinity;
  return Math.max(1, Math.ceil(Math.log1p(-rnd()) / Math.log1p(-p)));
}

/**
 * 목표 하나를 runs번 시뮬레이션. 반환: 정렬된 뽑기 수 표본, 평균, 획득 경로별 평균 장수.
 * 표본에 Infinity가 있으면 그 시행은 상한 안에 목표를 못 채운 것.
 */
export function simulateGoal(cfg, goal, runs = 3000, seed = 20261017) {
  const rnd = mulberry32(seed);
  const P = probTable(cfg);
  const { g, isTop, K, k, n } = goalSpec(cfg, goal);
  const levels = cfg.levels;
  const pityOn = isTop && cfg.pity?.enabled;
  const softFrom = pityOn ? Math.min(cfg.pity.hard, cfg.pity.softStep > 0 ? cfg.pity.softStart : Infinity) : Infinity;
  const pick = isTop && cfg.pickup?.enabled ? { share: cfg.pickup.share / 100, guarantee: !!cfg.pickup.guarantee } : null;
  const mil = isTop && cfg.mileage?.enabled ? cfg.mileage : null;
  const exCost = cfg.grades[g].exchange || 0;
  const shardDup = cfg.grades[g].shard || 0;
  // 다른 등급 중복 조각: 뽑기당 기대값 (레벨별)
  const shardRate = P.map(row => row.reduce((a, p, h) => a + (h === g ? 0 : p * (cfg.grades[h].shard || 0)), 0));

  const out = new Float64Array(runs);
  const src = { pull: 0, pity: 0, mileage: 0, exchange: 0 };
  const need = new Int32Array(K);
  const takeBest = () => { let b = 0; for (let i = 1; i < K; i++) if (need[i] > need[b]) b = i; need[b]--; };

  for (let r = 0; r < runs; r++) {
    need.fill(k);
    let remaining = K * k, t = 0, c = 0, guar = false, miles = 0, shards = 0;
    while (remaining > 0) {
      // 교환 (가능하면 바로)
      while (mil && remaining > 0 && miles >= mil.cost) { miles -= mil.cost; if (need[0] > 0) need[0]--; else takeBest(); remaining--; src.mileage++; }
      while (exCost > 0 && remaining > 0 && shards >= exCost) { shards -= exCost; takeBest(); remaining--; src.exchange++; }
      if (remaining <= 0) break;
      if (t > MAX_PULLS) { t = Infinity; break; }

      const L = levelAt(levels, t);
      const rate = shardRate[L];
      let cap = L + 1 < levels.length ? levels[L + 1] - t : Infinity;
      if (pityOn) cap = Math.min(cap, softFrom - 1 - c);
      if (mil) cap = Math.min(cap, Math.ceil((mil.cost - miles) / mil.per));
      if (exCost > 0 && rate > 0) cap = Math.min(cap, Math.ceil((exCost - shards) / rate));

      let forced = false;
      if (cap <= 0) { // 천장 확률 상승 구간: 한 번씩
        const pj = topProb(cfg, P[L][g], c + 1);
        t++; miles += mil ? mil.per : 0; shards += rate;
        if (rnd() >= pj) { c++; continue; }
        forced = pj >= 1;
      } else {
        const gap = geometric(P[L][g], rnd);
        if (gap > cap) {
          if (!Number.isFinite(cap)) { t = Infinity; break; } // 이 등급이 더는 나오지 않음
          t += cap; miles += mil ? cap * mil.per : 0; shards += cap * rate; if (pityOn) c += cap;
          continue;
        }
        t += gap; miles += mil ? gap * mil.per : 0; shards += gap * rate;
      }
      // 당첨: 어떤 유닛인가
      c = 0;
      let kind;
      if (pick) {
        if (guar || rnd() < pick.share) { kind = 0; guar = false; }
        else { kind = 1 + Math.floor(rnd() * (n - 1)); guar = pick.guarantee; }
      } else kind = Math.floor(rnd() * n);
      if (kind < K && need[kind] > 0) { need[kind]--; remaining--; if (forced) src.pity++; else src.pull++; }
      else shards += shardDup;
    }
    out[r] = t;
  }
  out.sort();
  let sum = 0, finite = 0;
  for (const v of out) if (Number.isFinite(v)) { sum += v; finite++; }
  const per = (v) => v / runs;
  return {
    runs, sorted: out, unreachable: runs - finite,
    mean: finite === runs ? sum / runs : Infinity,
    q: (p) => quantile(out, p),
    sources: { pull: per(src.pull), pity: per(src.pity), mileage: per(src.mileage), exchange: per(src.exchange) },
  };
}

export function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/** 정렬된 표본에서 뽑기 n회 이내 달성 비율 */
export function reachShare(sorted, n) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= n) lo = mid + 1; else hi = mid; }
  return lo / sorted.length;
}

// ── 정확해 ① 수집: 포아송화 ───────────────────────────────
function lgamma(x) { // Lanczos (g=7)
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** 정칙화 하부 불완전 감마 P(a, x) = 포아송(x) ≥ a 확률 (a는 양의 정수) */
export function gammaP(a, x) {
  if (x <= 0) return 0;
  const gln = lgamma(a);
  if (x < a + 1) { // 급수
    let ap = a, sum = 1 / a, del = sum;
    for (let i = 0; i < 10000; i++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; }
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - gln));
  }
  // 연분수 (Lentz)
  let b = x + 1 - a, c = 1e300, d = 1 / b, hh = d;
  for (let i = 1; i < 10000; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; hh *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.max(0, 1 - Math.exp(-x + a * Math.log(x) - gln) * hh);
}

/** 수집 목표의 정확한 기대 뽑기 수 (조건이 안 맞으면 null) */
export function exactCollectMean(cfg, goal) {
  if (goal.type !== 'collect') return null;
  const { g, isTop, K, k, n } = goalSpec(cfg, goal);
  if (cfg.levels.length !== 1) return null;
  if ((cfg.grades[g].exchange || 0) > 0) return null;
  if (isTop && (cfg.pity?.enabled || cfg.pickup?.enabled || cfg.mileage?.enabled)) return null;
  const p = (cfg.grades[g].probs[0] ?? 0) / 100;
  if (!(p > 0)) return null;
  const lambda = p / n;
  const f = (u) => 1 - Math.pow(gammaP(k, u), K);
  // 적분 끝: 피적분 함수가 1e-14 아래로 떨어지는 지점
  let U = k + 10 * Math.sqrt(k) + 10;
  while (f(U) > 1e-14 && U < 1e7) U *= 1.5;
  const N = 4000, h = U / N; // 심프슨
  let s = f(0) + f(U);
  for (let i = 1; i < N; i++) s += (i % 2 ? 4 : 2) * f(i * h);
  return (s * h / 3) / lambda;
}

// ── 정확해 ② 픽업: 상태 분포 동적 계획법 ─────────────────
/**
 * 픽업 유닛 k장 (최상위 1종 × k장)의 뽑기 수 분포. 최상위 분해 교환이 있으면 null.
 * 반환: 평균, 분위수, 누적 분포(구간 축약 표), 예산별 도달 확률 함수.
 */
export function exactPickup(cfg, goal, { maxWork = 3e8, tol = 1e-10 } = {}) {
  const { g, isTop, K, k, n } = goalSpec(cfg, goal);
  if (!isTop || K !== 1) return null;
  if ((cfg.grades[g].exchange || 0) > 0) return null;
  const P = probTable(cfg);
  const pityOn = !!cfg.pity?.enabled;
  const C = pityOn ? cfg.pity.hard : 1;
  const pick = cfg.pickup?.enabled ? { share: cfg.pickup.share / 100, guarantee: !!cfg.pickup.guarantee } : null;
  const mil = cfg.mileage?.enabled ? cfg.mileage : null;
  const G = pick?.guarantee ? 2 : 1;
  const S = k * C * G;
  const idx = (m, c, gu) => (m * C + c) * G + gu;
  let cur = new Float64Array(S), next = new Float64Array(S);
  cur[idx(0, 0, 0)] = 1;
  let survive = 1, mean = 0, t = 0, work = 0;
  const qs = [0.5, 0.9, 0.99], qv = [null, null, null];
  const cdf = []; let stride = 1;
  const pushCdf = (tt, F) => {
    if (tt % stride) return;
    cdf.push([tt, F]);
    if (cdf.length > 4000) { stride *= 2; for (let i = cdf.length - 1; i >= 0; i--) if (cdf[i][0] % stride) cdf.splice(i, 1); }
  };
  cdf.push([0, 0]);
  while (survive > tol) {
    if ((work += S) > maxWork) return null;
    const L = levelAt(cfg.levels, t);
    const base = P[L][g];
    const win = pick ? null : 1 / n;
    next.fill(0);
    let absorbed = 0;
    for (let m = 0; m < k; m++) for (let c = 0; c < C; c++) for (let gu = 0; gu < G; gu++) {
      const mass = cur[idx(m, c, gu)];
      if (!mass) continue;
      const pj = pityOn ? topProb(cfg, base, c + 1) : base;
      if (pj < 1) next[idx(m, pityOn ? Math.min(c + 1, C - 1) : 0, gu)] += mass * (1 - pj);
      const w = pick ? (gu ? 1 : pick.share) : win;
      const hit = mass * pj;
      if (m + 1 >= k) absorbed += hit * w; else next[idx(m + 1, 0, 0)] += hit * w;
      if (w < 1) next[idx(m, 0, pick?.guarantee ? 1 : 0)] += hit * (1 - w);
    }
    t++;
    // 마일리지: 뽑기 수로 정해지는 시점에 1장 추가 (픽업 유닛 선택)
    if (mil && Math.floor(t * mil.per / mil.cost) > Math.floor((t - 1) * mil.per / mil.cost)) {
      const moved = new Float64Array(S);
      for (let m = 0; m < k; m++) for (let c = 0; c < C; c++) for (let gu = 0; gu < G; gu++) {
        const mass = next[idx(m, c, gu)];
        if (!mass) continue;
        if (m + 1 >= k) absorbed += mass; else moved[idx(m + 1, c, gu)] += mass;
      }
      next = moved;
    }
    mean += t * absorbed;
    survive -= absorbed;
    const F = 1 - survive;
    qs.forEach((q, i) => { if (qv[i] == null && F >= q - 1e-12) qv[i] = t; });
    pushCdf(t, F);
    [cur, next] = [next, cur];
    if (t > 5e7) return null;
  }
  cdf.push([t, 1]);
  const reach = (budgetPulls) => {
    if (budgetPulls < 1) return 0;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cdf[mid][0] <= budgetPulls) lo = mid; else hi = mid - 1; }
    return cdf[lo][1];
  };
  return { mean, q50: qv[0], q90: qv[1], q99: qv[2], cdf, reach };
}

// ── 전체 분석 ────────────────────────────────────────────
export function analyze(cfg, { runs = cfg.runs ?? 3000 } = {}) {
  const errors = validate(cfg);
  if (errors.length) return { ok: false, errors };
  const gemPerDayFree = cfg.user?.freePerDay || 0;
  const gemPerDayPaid = gemPerDayFree + (cfg.wonPerGem > 0 ? (cfg.user?.monthlyWon || 0) / 30 / cfg.wonPerGem : 0);
  const goals = cfg.goals.map((goal, i) => {
    const sim = simulateGoal(cfg, goal, runs, 20261017 + i * 7919);
    const exact = goal.type === 'pickup' ? exactPickup(cfg, goal) : null;
    const exactMean = exact ? exact.mean : exactCollectMean(cfg, goal);
    const mean = exactMean ?? sim.mean;
    const pct = exact ? { p50: exact.q50, p90: exact.q90, p99: exact.q99 } : { p50: sim.q(0.5), p90: sim.q(0.9), p99: sim.q(0.99) };
    const gems = mean * cfg.pullCost;
    const reach = exact ? exact.reach : (n) => reachShare(sim.sorted, n);
    const nd = noDupConfig(cfg, goal);
    const noDup = nd ? (exactCollectMean(nd.cfg, nd.goal) ?? simulateGoal(nd.cfg, nd.goal, runs, 20261017 + i * 7919).mean) : null;
    return {
      goal, spec: goalSpec(cfg, goal), sim, exact, exactMean, mean, pct, reach, noDup,
      naive: naivePulls(cfg, goal),
      gems, won: gems * cfg.wonPerGem,
      daysFree: gemPerDayFree > 0 ? gems / gemPerDayFree : Infinity,
      daysPaid: gemPerDayPaid > 0 ? gems / gemPerDayPaid : Infinity,
    };
  });
  return { ok: true, goals, gemPerDayFree, gemPerDayPaid, warnings: warnings(cfg, goals) };
}

/** 이 목표에 실제로 작동하는 보정 장치 이름 (없으면 빈 문자열) */
export function helpers(cfg, spec) {
  const out = [];
  if (spec.isTop && cfg.pity?.enabled) out.push('천장');
  if (spec.isTop && cfg.mileage?.enabled) out.push('마일리지');
  if ((cfg.grades[spec.g].exchange || 0) > 0) out.push('조각 교환');
  return out.join('·');
}

function warnings(cfg, goals) {
  const out = [];
  const fmt = (x) => Math.round(x).toLocaleString('ko-KR');
  for (const r of goals) {
    const name = r.goal.name;
    if (!Number.isFinite(r.mean)) { out.push({ level: 'serious', text: `${name}: 목표 등급이 나오지 않아 달성할 수 없습니다 (확률 0 확인).` }); continue; }
    // 단순 계산 → (확률 구조) → 중복 없는 경우 → (중복) → 실제
    const structural = r.noDup ?? r.mean;
    const sGap = structural / r.naive - 1;
    const multiLevel = cfg.levels.length > 1;
    if (sGap >= 0.2) out.push({ level: 'warn', text: `${name}: ${multiLevel ? '소환 레벨이 오르기 전 확률이 낮은 구간 때문에' : '확률 구조 때문에'} 단순 계산(필요 장수 ÷ 최고 확률 = ${fmt(r.naive)}회)보다 ${(sGap * 100).toFixed(0)}% 더 듭니다${r.noDup != null ? ` (중복이 없어도 ${fmt(r.noDup)}회)` : ''}.` });
    else if (sGap <= -0.2) out.push({ level: 'info', text: `${name}: ${helpers(cfg, r.spec) || '확률 구조'} 덕분에 단순 계산(${fmt(r.naive)}회)보다 ${(-sGap * 100).toFixed(0)}% 적게 듭니다${r.noDup != null ? ` (중복이 없을 때 ${fmt(r.noDup)}회)` : ` (기대 ${fmt(r.mean)}회)`}.` });
    if (r.noDup != null) {
      const dGap = r.mean / r.noDup - 1;
      if (dGap >= 0.15) out.push({ level: 'warn', text: `${name}: 이미 다 모은 유닛이 또 나오는 중복 때문에 ${(dGap * 100).toFixed(0)}% 더 듭니다 (중복 없을 때 ${fmt(r.noDup)}회 → 실제 ${fmt(r.mean)}회). 중복을 조각·교환으로 돌려주면 줄어듭니다.` });
    }
    const tail = r.pct.p99 / r.mean;
    if (tail >= 2.5) out.push({ level: 'warn', text: `${name}: 운 나쁜 1%는 평균의 ${tail.toFixed(1)}배(${fmt(r.pct.p99)}회)를 뽑아야 합니다. 천장·교환으로 꼬리를 자를지 검토하세요.` });
    if (r.daysPaid > 365) out.push({ level: 'warn', text: `${name}: 기준 과금 유저도 평균 ${fmt(r.daysPaid)}일 — 1년 넘게 걸립니다 (무과금 ${fmt(r.daysFree)}일). 장기 목표가 맞는지 확인하세요.` });
    else if (r.daysFree > 365) out.push({ level: 'info', text: `${name}: 무과금은 평균 ${fmt(r.daysFree)}일로 1년을 넘고, 기준 과금 유저는 ${fmt(r.daysPaid)}일입니다.` });
    const s = r.sim.sources, total = s.pull + s.pity + s.mileage + s.exchange;
    if (total > 0 && (s.mileage + s.exchange) / total >= 0.3) out.push({ level: 'info', text: `${name}: 획득의 ${(((s.mileage + s.exchange) / total) * 100).toFixed(0)}%가 마일리지·조각 교환입니다 — 확률보다 교환 가격이 체감 비용을 정합니다.` });
    if (total > 0 && s.pity / total >= 0.5) out.push({ level: 'info', text: `${name}: 최상위의 ${((s.pity / total) * 100).toFixed(0)}%를 천장으로 얻습니다 — 기본 확률보다 천장 횟수가 실제 비용을 정합니다.` });
  }
  const order = { serious: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
