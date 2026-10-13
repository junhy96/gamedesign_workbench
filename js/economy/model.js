// 재화 흐름 시뮬레이터 — 순수 계산 모듈 (DOM 없음)
//
// 일 단위 이산 시뮬레이션. 하루 처리 순서(고정):
//   1. 획득(faucet)   일일/주간, 이벤트 기간, 활동량 배수 적용 여부
//   2. 교환(exchange) 보유량이 기준 이상이면 정해진 양씩 하루 최대 n회 변환 (순환 교환은 입력 단계에서 거부)
//   3. 고정 소모      매일 정해진 양 (활동량 배수 적용 가능)
//   4. 비율 소모      보유량의 일정 비율
//   5. 소비 규칙      보유량이 기준 이상이면 1회분씩 하루 최대 n회 소비 (강화·뽑기·구매 같은 유저 행동)
// 편차: 유저별 고정 배수(로그정규) × 일별 소폭 변동. 매일 독립적으로만 흔들면 평균으로 수렴해 띠가 비현실적으로 좁아진다.

import { mulberry32 } from '../enhance/simulate.js';

export function validate(cfg) {
  const errors = [];
  const ids = new Set(cfg.currencies.map(c => c.id));
  if (!cfg.currencies.length) errors.push('재화를 1개 이상 추가하세요.');
  if (!(Number.isInteger(cfg.days) && cfg.days >= 1 && cfg.days <= 730)) errors.push('기간은 1~730일이어야 합니다.');
  const chk = (list, label, keys) => list.forEach((x, i) => {
    for (const k of keys) if (!ids.has(x[k])) errors.push(`${label} ${i + 1}번 '${x.name}': 재화를 선택하세요.`);
  });
  chk(cfg.faucets, '획득처', ['currency']);
  chk(cfg.sinks, '소모처', ['currency']);
  chk(cfg.exchanges, '교환', ['from', 'to']);
  cfg.exchanges.forEach((x, i) => { if (x.from === x.to) errors.push(`교환 ${i + 1}번 '${x.name}': 같은 재화끼리는 교환할 수 없습니다.`); });
  const share = cfg.users.reduce((a, u) => a + u.share, 0);
  if (!cfg.users.length) errors.push('유저 유형을 1개 이상 추가하세요.');
  else if (Math.abs(share - 100) > 0.01) errors.push(`유저 유형 비율 합이 ${share}%입니다 (100%여야 함).`);
  const cycle = findCycle(cfg.exchanges);
  if (cycle) errors.push(`교환 규칙이 순환합니다 (${cycle.map(id => cfg.currencies.find(c => c.id === id)?.name ?? id).join(' → ')}). 재화가 무한히 불어날 수 있어 허용하지 않습니다.`);
  return errors;
}

/** 교환 그래프의 순환 경로 (없으면 null) */
export function findCycle(exchanges) {
  const adj = new Map();
  for (const x of exchanges) { if (!adj.has(x.from)) adj.set(x.from, []); adj.get(x.from).push(x.to); }
  const state = new Map(), stack = [];
  const dfs = (v) => {
    state.set(v, 1); stack.push(v);
    for (const w of adj.get(v) || []) {
      if (state.get(w) === 1) return [...stack.slice(stack.indexOf(w)), w];
      if (!state.get(w)) { const c = dfs(w); if (c) return c; }
    }
    state.set(v, 2); stack.pop();
    return null;
  };
  for (const v of adj.keys()) if (!state.get(v)) { const c = dfs(v); if (c) return c; }
  return null;
}

function gaussian(rnd) { // Box–Muller
  const u = Math.max(1e-12, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 유저 1명 × 기간 시뮬레이션. 보유량 일별 기록과 누적 획득/소모를 돌려준다. */
function simulateUser(cfg, user, userMult, rnd, daySigma) {
  const C = cfg.currencies.length;
  const idx = new Map(cfg.currencies.map((c, i) => [c.id, i]));
  const hold = cfg.currencies.map(c => c.start || 0);
  const inflow = new Float64Array(C), outflow = new Float64Array(C);
  const bySource = new Map(); // 획득처·소모처별 누적
  const add = (key, v) => bySource.set(key, (bySource.get(key) || 0) + v);
  const series = Array.from({ length: C }, () => new Float64Array(cfg.days + 1));
  for (let c = 0; c < C; c++) series[c][0] = hold[c];

  for (let day = 1; day <= cfg.days; day++) {
    const noise = daySigma > 0 ? Math.max(0, 1 + daySigma * gaussian(rnd)) : 1;
    const act = user.activity * userMult * noise;
    // 1. 획득
    for (const f of cfg.faucets) {
      if (f.from && day < f.from) continue;
      if (f.to && day > f.to) continue;
      if (f.period === 'week' && day % 7 !== 0) continue;
      const v = f.amount * (f.activity ? act : 1);
      const c = idx.get(f.currency);
      hold[c] += v; inflow[c] += v; add(`f:${f.id}`, v);
    }
    // 2. 교환
    for (const x of cfg.exchanges) {
      const a = idx.get(x.from), b = idx.get(x.to);
      let n = 0;
      while (n < x.maxPerDay && hold[a] >= Math.max(x.threshold, x.amount)) {
        hold[a] -= x.amount; outflow[a] += x.amount;
        const got = x.amount * x.rate;
        hold[b] += got; inflow[b] += got;
        add(`x:${x.id}`, x.amount);
        n++;
      }
    }
    // 3~5. 소모
    for (const type of ['fixed', 'ratio', 'rule']) {
      for (const s of cfg.sinks) {
        if (s.type !== type) continue;
        const c = idx.get(s.currency);
        let v = 0;
        if (type === 'fixed') v = Math.min(hold[c], s.amount * (s.activity ? act : 1));
        else if (type === 'ratio') v = hold[c] * (s.ratio / 100);
        else {
          const times = Math.round((s.maxPerDay || 1) * (s.activity ? act : 1)); // 활동량이 많으면 더 자주 소비
          const need = Math.max(s.threshold || 0, s.amount);
          for (let n = 0; n < times && hold[c] - v >= need; n++) v += s.amount;
        }
        hold[c] -= v; outflow[c] += v; add(`s:${s.id}`, v);
      }
    }
    for (let c = 0; c < C; c++) series[c][day] = hold[c];
  }
  return { series, inflow, outflow, bySource };
}

/**
 * 전체 시뮬레이션.
 * variance.on이면 유저 유형마다 runs번 반복해 분위수 띠(p10~p90)를 만든다.
 */
export function simulate(cfg) {
  const errors = validate(cfg);
  if (errors.length) return { ok: false, errors };
  const v = cfg.variance || {};
  const runs = v.on ? Math.max(10, Math.min(1000, v.runs || 200)) : 1;
  const rnd = mulberry32(cfg.seed ?? 20261013);
  const C = cfg.currencies.length, D = cfg.days;

  const byUser = cfg.users.map(user => {
    const samples = Array.from({ length: C }, () => Array.from({ length: D + 1 }, () => new Float64Array(runs)));
    const inflow = new Float64Array(C), outflow = new Float64Array(C);
    const sources = new Map();
    for (let r = 0; r < runs; r++) {
      // 로그정규 유저 배수: 평균이 1이 되도록 −σ²/2 보정
      const s = v.on ? (v.userSigma || 0) : 0;
      const mult = s > 0 ? Math.exp(s * gaussian(rnd) - (s * s) / 2) : 1;
      const out = simulateUser(cfg, user, mult, rnd, v.on ? (v.daySigma || 0) : 0);
      for (let c = 0; c < C; c++) {
        inflow[c] += out.inflow[c] / runs; outflow[c] += out.outflow[c] / runs;
        for (let d = 0; d <= D; d++) samples[c][d][r] = out.series[c][d];
      }
      for (const [k, val] of out.bySource) sources.set(k, (sources.get(k) || 0) + val / runs);
    }
    const stats = samples.map(perDay => perDay.map(arr => {
      const sorted = Float64Array.from(arr).sort();
      const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
      let mean = 0; for (const x of arr) mean += x; mean /= arr.length;
      return { mean, p10: q(0.1), p90: q(0.9) };
    }));
    return { user, stats, inflow, outflow, sources };
  });

  // 전체 평균 (유저 비율 가중)
  const total = cfg.currencies.map((cur, c) => {
    const mean = Array.from({ length: D + 1 }, (_, d) => byUser.reduce((a, u) => a + u.stats[c][d].mean * u.user.share / 100, 0));
    const inflow = byUser.reduce((a, u) => a + u.inflow[c] * u.user.share / 100, 0);
    const outflow = byUser.reduce((a, u) => a + u.outflow[c] * u.user.share / 100, 0);
    return { currency: cur, mean, inflow, outflow };
  });

  return { ok: true, byUser, total, runs, warnings: warnings(cfg, byUser), days: D };
}

/**
 * 경고: 웜업 기간 이후의 소모율(소모 ÷ 획득)이 기준 미만이면 '적체'.
 * 보유량 0에서 시작하는 초반에는 증가율이 항상 크므로 웜업 이후 구간만 본다.
 */
function warnings(cfg, byUser) {
  const out = [];
  const warm = Math.min(cfg.days - 1, cfg.warmup ?? 7);
  const th = (cfg.sinkRatioWarn ?? 70) / 100;
  cfg.currencies.forEach((cur, c) => {
    for (const u of byUser) {
      const s = u.stats[c];
      const start = s[warm].mean, end = s[cfg.days].mean;
      const days = cfg.days - warm;
      const ratio = u.inflow[c] > 0 ? u.outflow[c] / u.inflow[c] : 1;
      const growthPerWeek = days > 0 ? ((end - start) / days) * 7 : 0;
      if (u.inflow[c] > 0 && ratio < th && end > start) {
        out.push({ level: 'warn', currency: cur.name, user: u.user.name, text: `${u.user.name} · ${cur.name}: 소모율 ${(ratio * 100).toFixed(0)}% (기준 ${(th * 100).toFixed(0)}%) — 주당 ${Math.round(growthPerWeek).toLocaleString('ko-KR')}씩 쌓입니다.` });
      } else if (u.inflow[c] > 0 && end < start * 0.5 && start > 0) {
        out.push({ level: 'info', currency: cur.name, user: u.user.name, text: `${u.user.name} · ${cur.name}: 보유량이 ${warm}일차 대비 절반 이하로 줄었습니다 (부족 가능).` });
      }
    }
  });
  return out;
}

/** Mermaid 흐름도: 획득처 → 재화 → 소모처, 재화 사이 교환 */
export function toMermaid(cfg) {
  const q = (s) => `"${String(s).replace(/"/g, "'")}"`;
  const lines = ['flowchart LR'];
  cfg.currencies.forEach(c => lines.push(`  C_${c.id}([${q(c.name)}])`));
  cfg.faucets.forEach(f => {
    const tag = [f.period === 'week' ? '주간' : '일일', f.from || f.to ? `${f.from || 1}~${f.to || cfg.days}일` : ''].filter(Boolean).join(' · ');
    lines.push(`  F_${f.id}[${q(f.name)}] -- ${q(`${f.amount.toLocaleString('ko-KR')} ${tag}`)} --> C_${f.currency}`);
  });
  cfg.sinks.forEach(s => {
    const tag = s.type === 'fixed' ? `매일 ${s.amount.toLocaleString('ko-KR')}` : s.type === 'ratio' ? `보유량의 ${s.ratio}%` : `${s.amount.toLocaleString('ko-KR')}씩 최대 ${s.maxPerDay}회`;
    lines.push(`  C_${s.currency} -- ${q(tag)} --> S_${s.id}[${q(s.name)}]`);
  });
  cfg.exchanges.forEach(x => lines.push(`  C_${x.from} -. ${q(`${x.name}: ${x.amount.toLocaleString('ko-KR')} → ${(x.amount * x.rate).toLocaleString('ko-KR')}`)} .-> C_${x.to}`));
  return lines.join('\n');
}
