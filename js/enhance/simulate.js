// 몬테카를로 시뮬레이션 — 분포(분위수·예산별 도달 확률)와 정확해 검산용.
// 시드 고정 난수(mulberry32)라 같은 설정이면 항상 같은 결과가 나온다.
import { buildChain } from './model.js';
import { quantiles } from '../lib/quantiles.js';
import { convergence } from '../lib/mcviz.js';

export const PATH_RUNS = 12;   // 단계 경로를 남길 시행 수 (그래프용)
const PATH_MAX = 3000;         // 경로 하나에 남길 최대 시도 수

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
  const chain = buildChain(cfg);
  const rnd = mulberry32(seed);
  // 상태별 누적 확률표로 변환
  const table = chain.states.map(st => {
    let acc = 0;
    return {
      cost: st.cost,
      edges: st.edges.map(([to, p, kind]) => ({ to, cum: (acc += p), destroy: kind === 'b' })),
    };
  });
  const costs = new Float64Array(trials);
  const destroys = new Uint32Array(trials);
  const attempts = new Uint32Array(trials);
  let truncated = 0;

  const stageOf = chain.states.map(st => st.stage);
  const paths = [];
  for (let n = 0; n < trials; n++) {
    let s = chain.S, a = 0, d = 0, c = 0;
    const path = n < PATH_RUNS ? { stages: [stageOf[s]], destroys: [] } : null;
    while (s !== -1) {
      if (++a > MAX_ATTEMPTS_PER_RUN) { truncated++; break; }
      const st = table[s];
      c += st.cost;
      const u = rnd() * st.edges[st.edges.length - 1].cum; // 부동소수 합 오차 보정
      let i = 0;
      while (i < st.edges.length - 1 && u >= st.edges[i].cum) i++;
      const e = st.edges[i];
      if (e.destroy) { d++; c += chain.destroyCost; if (path && path.stages.length <= PATH_MAX) path.destroys.push(path.stages.length); }
      s = e.to;
      if (path && path.stages.length <= PATH_MAX) path.stages.push(s === -1 ? cfg.target : stageOf[s]);
    }
    if (path) paths.push({ ...path, attempts: a, cut: a > PATH_MAX });
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
    },
    // 분위수 표 (PCTS 순서): 총비용·시도·파괴 각각의 분위
    quantiles: { cost: quantiles(sortedCost), attempts: quantiles(sortedAtt), destroys: quantiles(sortedDes) },
    convergence: convergence(costs), // 시행 순서대로의 누적 평균 총비용과 95% 범위
    paths,                           // 앞 12번 시행의 시도별 단계 (파괴 위치 포함)
    sortedCost, // 예산별 도달 확률 계산용
    histogram: histogram(sortedCost, 36),
  };
}

/** 정렬된 비용 표본에서 '예산 이하로 목표 도달' 비율 */
export function reachProbability(sortedCost, budget) {
  let lo = 0, hi = sortedCost.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedCost[mid] <= budget) lo = mid + 1; else hi = mid; }
  return lo / sortedCost.length;
}

/** 최소값 ~ p99 구간을 균등 분할, p99 초과는 꼬리로 따로 센다. */
function histogram(sorted, bins) {
  const n = sorted.length;
  const lo = sorted[0];
  const hi = sorted[Math.min(n - 1, Math.floor(0.99 * n))];
  if (hi <= lo) return { edges: [lo, lo + 1], counts: [n], tail: 0, n };
  const width = (hi - lo) / bins;
  const counts = new Array(bins).fill(0);
  let tail = 0;
  for (const v of sorted) {
    if (v > hi) { tail++; continue; }
    counts[Math.min(bins - 1, Math.floor((v - lo) / width))]++;
  }
  return { edges: Array.from({ length: bins + 1 }, (_, i) => lo + i * width), counts, tail, n };
}
