// 몬테카를로 시뮬레이션 — 분포(중앙값·상위 10%·1%)와 정확해 검산용.
// 시드 고정 난수(mulberry32)라 같은 설정이면 항상 같은 결과가 나온다.
import { effectiveStages } from './model.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_ATTEMPTS_PER_RUN = 5_000_000; // 성공 확률이 극히 낮은 설정에서 무한 루프 방지

export function simulate(cfg, trials = 20000, seed = 20261013) {
  const eff = effectiveStages(cfg);
  const { start, target, restore } = cfg;
  const chanceN = cfg.chanceN || 0;
  const destroyCost = cfg.destroyCost || 0;
  const floor = Math.min(...cfg.rows.map(r => r.stage));
  const rnd = mulberry32(seed);

  // 단계별 누적 확률 테이블 (반복 조회 비용 절감)
  const tbl = [];
  for (const p of eff.values()) tbl[p.stage] = p;

  const costs = new Float64Array(trials);
  const destroys = new Uint32Array(trials);
  const attempts = new Uint32Array(trials);
  let truncated = 0;

  for (let n = 0; n < trials; n++) {
    let i = start, k = 0, a = 0, d = 0, c = 0;
    while (i < target) {
      if (++a > MAX_ATTEMPTS_PER_RUN) { truncated++; break; }
      const p = tbl[i];
      if (chanceN && k === chanceN) { c += p.baseCost; i++; k = 0; continue; }
      c += p.cost;
      const u = rnd();
      if (u < p.s) { i++; k = 0; }
      else if (u < p.s + p.k) { /* 유지 */ }
      else if (u < p.s + p.k + p.d) { i = Math.max(i - 1, floor); if (chanceN) k = Math.min(k + 1, chanceN); }
      else { d++; c += destroyCost; i = restore; k = 0; }
    }
    costs[n] = c; destroys[n] = d; attempts[n] = a;
  }

  const mean = (arr) => { let s = 0; for (const v of arr) s += v; return s / arr.length; };
  const sortedCost = Float64Array.from(costs).sort();
  const sortedAtt = Uint32Array.from(attempts).sort();
  const sortedDes = Uint32Array.from(destroys).sort();
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  let zero = 0; for (const v of destroys) if (v === 0) zero++;

  return {
    trials, truncated,
    mean: { cost: mean(costs), attempts: mean(attempts), destroys: mean(destroys) },
    noDestroy: zero / trials,
    pct: {
      cost: { p50: q(sortedCost, 0.5), p90: q(sortedCost, 0.9), p99: q(sortedCost, 0.99) },
      attempts: { p50: q(sortedAtt, 0.5), p90: q(sortedAtt, 0.9), p99: q(sortedAtt, 0.99) },
      destroys: { p50: q(sortedDes, 0.5), p90: q(sortedDes, 0.9), p99: q(sortedDes, 0.99) },
    },
    histogram: histogram(sortedCost, 36),
  };
}

/** 0 ~ p99 구간을 균등 분할, p99 초과는 마지막 '꼬리' 칸에 모은다. */
function histogram(sorted, bins) {
  const n = sorted.length;
  const lo = sorted[0];
  const hi = sorted[Math.min(n - 1, Math.floor(0.99 * n))];
  if (hi <= lo) return { edges: [lo, lo], counts: [n], tail: 0, n };
  const width = (hi - lo) / bins;
  const counts = new Array(bins).fill(0);
  let tail = 0;
  for (const v of sorted) {
    if (v > hi) { tail++; continue; }
    counts[Math.min(bins - 1, Math.floor((v - lo) / width))]++;
  }
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * width);
  return { edges, counts, tail, n };
}
