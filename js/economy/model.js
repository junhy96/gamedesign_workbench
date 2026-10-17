// 재화 흐름 시뮬레이터 v2 — RPG 성장 루프 (순수 계산 모듈, DOM 없음)
//
// ■ 루프
//   콘텐츠(생산) ──보상──▶ 재화 ──비용──▶ 성장(소비) ──전투력──▶ 콘텐츠 보상 증가·해금 ──▶ …
//
// ■ 유저 세그먼트 = 측정 가능한 행동 기준
//   일일 플레이 시간(분) · 하루 접속 횟수 · 월 과금액(원) · 하루 스태미나 충전 횟수
//
// ■ 하루 처리 순서 (세그먼트마다)
//   1. 과금: 월 과금액 ÷ 30 만큼 유료 재화 획득 (유료 재화의 원화 단가로 환산)
//   2. 스태미나: 하루 예산 = 전날 남은 양(최대치까지) + 실제 회복량 + 충전
//                실제 회복량 = min(하루 회복량, 최대치 × 접속 횟수) — 자주 접속할수록 최대치에 막혀 버리는 양이 적다
//                충전: 정한 횟수만큼 유료 재화로 구매
//   3. 콘텐츠: 표 순서(우선순위)대로, 해금 전투력 이상이고 시간·스태미나·횟수 제한 안에서 반복
//              보상 = 기본 보상 × (1 + 성장 보너스% × 전투력 ÷ 100)
//              횟수 0 = 무제한(남은 시간을 채우는 사냥 같은 콘텐츠)
//   4. 상점(교환): 보유량이 기준 이상이면 정해진 양씩 하루 최대 n회
//   5. 성장: 표 순서대로, 비용을 낼 수 있으면 레벨업 반복. 못 내면 가장 부족한 재화를 '병목'으로 기록
//            비용(레벨 L) = 기본 비용 × 증가율^L, 전투력 = Σ 레벨 × 레벨당 전투력
//
// ■ 편차 (선택)
//   같은 세그먼트 안에서도 유저마다 플레이 시간이 다르다: 유저별 고정 배수(로그정규, 평균 1) × 일별 변동(로그정규, 평균 1).
//   세그먼트마다 N명을 돌려 날짜별 전투력의 하위 10%·상위 10%를 띠로 표시.
//   (매일 독립적으로만 흔들면 평균으로 수렴해 띠가 비현실적으로 좁아지므로 유저별 고정 배수가 핵심)
//
// ■ 이탈 (선택)
//   세그먼트마다 D1·D7·D30 잔존율. 앵커 사이는 log(일차)–log(잔존) 직선(구간별 멱법칙), D30 이후는 D7→D30 기울기로 연장.
//   잔존 곡선은 '평균 유저가 그날까지 남아 있을 확률'이라 성장 시뮬레이션 자체는 바꾸지 않고,
//   콘텐츠 해금 시점의 잔존율과 설치당 기대 매출(LTV = Σ 잔존(d) × 월 과금 ÷ 30)을 계산한다.

import { mulberry32 } from '../enhance/simulate.js';

export function validate(cfg) {
  const errors = [];
  const ids = new Set(cfg.currencies.map(c => c.id));
  if (!cfg.currencies.length) errors.push('재화를 1개 이상 추가하세요.');
  if (!(Number.isInteger(cfg.days) && cfg.days >= 1 && cfg.days <= 365)) errors.push('기간은 1~365일이어야 합니다.');
  if (!cfg.segments.length) errors.push('유저 세그먼트를 1개 이상 추가하세요.');
  else {
    const share = cfg.segments.reduce((a, s) => a + s.share, 0);
    if (Math.abs(share - 100) > 0.01) errors.push(`세그먼트 비율 합이 ${share}%입니다 (100%여야 함).`);
  }
  if (cfg.paid?.currency && !ids.has(cfg.paid.currency)) errors.push('유료 재화를 선택하세요.');
  cfg.contents.forEach((c, i) => {
    if (!(c.minutes >= 0) || !(c.stamina >= 0)) errors.push(`콘텐츠 ${i + 1}번 '${c.name}': 시간·스태미나는 0 이상이어야 합니다.`);
    if (c.limit === 0 && !(c.minutes > 0) && !(c.stamina > 0)) errors.push(`콘텐츠 ${i + 1}번 '${c.name}': 횟수 무제한이면 1회당 시간이나 스태미나가 필요합니다.`);
  });
  cfg.growth.forEach((g, i) => {
    if (!(g.max >= 1)) errors.push(`성장 ${i + 1}번 '${g.name}': 최대 레벨은 1 이상이어야 합니다.`);
    if (!Object.values(g.cost || {}).some(v => v > 0) && !Object.values(g.table || {}).some(t => t.some(v => v > 0))) errors.push(`성장 ${i + 1}번 '${g.name}': 비용이 하나 이상 있어야 합니다.`);
  });
  cfg.exchanges.forEach((x, i) => {
    if (!ids.has(x.from) || !ids.has(x.to) || x.from === x.to) errors.push(`상점 ${i + 1}번 '${x.name}': 내는 재화와 받는 재화를 다르게 선택하세요.`);
  });
  cfg.segments.forEach((sg, i) => {
    if ([sg.d1, sg.d7, sg.d30].some(v => typeof v === 'number' && !(v >= 0 && v <= 100))) errors.push(`세그먼트 ${i + 1}번 '${sg.name}': 잔존율은 0~100%여야 합니다.`);
    else if (hasRetention(sg) && !(sg.d1 >= sg.d7 && sg.d7 >= sg.d30)) errors.push(`세그먼트 ${i + 1}번 '${sg.name}': 잔존율은 D1 ≥ D7 ≥ D30이어야 합니다.`);
  });
  if (cfg.variance?.enabled && !(cfg.variance.users >= 10 && cfg.variance.users <= 2000)) errors.push('편차 계산 인원은 세그먼트당 10~2000명이어야 합니다.');
  const cycle = findCycle(cfg.exchanges);
  if (cycle) errors.push(`상점 교환이 순환합니다 (${cycle.map(id => cfg.currencies.find(c => c.id === id)?.name ?? id).join(' → ')}).`);
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

/** 레벨 level → level+1 비용. 필요량 표(성장 재화 수급 설계에서 보낸 것)가 있는 재화는 표를, 없으면 기본 비용 × 증가율^레벨 */
export const growthCost = (g, level, cur) => {
  const t = g.table?.[cur];
  if (t?.length) return Math.round(t[Math.min(level - (g.tableStart ?? 0), t.length - 1)] ?? 0);
  return Math.round((g.cost[cur] || 0) * Math.pow(g.rate ?? 1, level));
};

/**
 * 성장 재화 수급 설계의 레벨별 필요량 표를 성장 항목에 넣는다 (같은 이름이면 갱신, 없으면 추가).
 * 재화는 이름으로 찾고 없으면 추가. cfg를 직접 바꾸고 무엇을 만들었는지 돌려준다.
 */
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); // 한 번에 여러 재화를 넣어도 겹치지 않게

export function applyGrowthTable(cfg, { currency, name, max, start = 0, costs }) {
  let cur = cfg.currencies.find(c => c.name === currency);
  const currencyCreated = !cur;
  if (!cur) { cur = { id: uid('c'), name: currency, start: 0 }; cfg.currencies.push(cur); }
  let g = cfg.growth.find(x => x.name === name);
  const created = !g;
  if (!g) { g = { id: uid('g'), name, max, start, rate: 1, power: 10, cost: {} }; cfg.growth.push(g); }
  g.max = max;
  g.tableStart = start;
  g.table = { ...(g.table || {}), [cur.id]: costs.slice() };
  g.cost = { ...(g.cost || {}), [cur.id]: costs[0] ?? 0 }; // 다이어그램·검증용 대표값 (계산은 표 사용)
  return { created, currencyCreated, growthId: g.id, currencyId: cur.id };
}
export const effectiveRegen = (stamina, seg) => Math.min(stamina.regenPerDay, stamina.cap * Math.max(1, seg.logins));

/** D1·D7·D30이 모두 있으면 이탈을 계산한다 (비어 있으면 이탈 없음) */
export const hasRetention = (seg) => [seg.d1, seg.d7, seg.d30].every(v => typeof v === 'number' && Number.isFinite(v));

/** d일차 잔존율 (0~1). 0일 = 1, 앵커 사이는 log–log 직선, D30 이후는 D7→D30 기울기로 연장 */
export function retentionAt(seg, d) {
  if (!hasRetention(seg) || d <= 0) return 1;
  const pts = [[1, seg.d1 / 100], [7, seg.d7 / 100], [30, seg.d30 / 100]];
  if (d < 1) return 1 + (pts[0][1] - 1) * d;
  const seg2 = (a, b, x) => {
    if (a[1] <= 0 || b[1] <= 0) return Math.max(0, a[1] + (b[1] - a[1]) * (Math.log(x / a[0]) / Math.log(b[0] / a[0])));
    return a[1] * Math.pow(x / a[0], Math.log(b[1] / a[1]) / Math.log(b[0] / a[0]));
  };
  return Math.max(0, Math.min(1, d <= 7 ? seg2(pts[0], pts[1], d) : seg2(pts[1], pts[2], d)));
}

// 표준정규 (Box–Muller)
function gauss(rnd) { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }

/**
 * 세그먼트 1개 시뮬레이션. noise = { mult, dailySd, rnd } 이면 그 유저의 하루 플레이 시간 = 기본 × 유저 배수 × 일별 변동
 */
function simulateSegment(cfg, seg, noise = null) {
  const D = cfg.days, curIds = cfg.currencies.map(c => c.id);
  const hold = Object.fromEntries(cfg.currencies.map(c => [c.id, c.start || 0]));
  const levels = Object.fromEntries(cfg.growth.map(g => [g.id, g.start || 0]));
  const power = () => cfg.growth.reduce((a, g) => a + levels[g.id] * g.power, 0) + (cfg.basePower || 0);
  const st = cfg.stamina;
  let stamina = 0; // 하루 예산 = 전날 남은 양(최대치까지) + 실제 회복량 + 충전
  const series = { power: [power()], hold: Object.fromEntries(curIds.map(id => [id, [hold[id]]])), levels: Object.fromEntries(cfg.growth.map(g => [g.id, [levels[g.id]]])) };
  const flow = { in: {}, out: {} }; // 'content:id|cur' → 양, 'growth:id|cur' → 양
  const addFlow = (dir, key, cur, v) => { if (v) { const k = `${key}|${cur}`; flow[dir][k] = (flow[dir][k] || 0) + v; } };
  const bottleneck = {}; // 재화 → 막힌 일수
  const runs = {}; // 콘텐츠 → 누적 횟수
  const unlockDay = {}; // 콘텐츠 → 처음 해금된 날
  let weekRuns = {};
  const paidCur = cfg.paid?.currency, paidPrice = cfg.paid?.priceWon || 0;
  const daily = { minutesUsed: 0, staminaWasted: 0 };

  for (let day = 1; day <= D; day++) {
    if ((day - 1) % 7 === 0) weekRuns = {};
    // 1. 과금
    if (paidCur && paidPrice > 0 && seg.spendWon > 0) {
      const v = seg.spendWon / 30 / paidPrice;
      hold[paidCur] += v; addFlow('in', 'paid:구매', paidCur, v);
    }
    // 2. 스태미나
    if (st.enabled) {
      const regen = effectiveRegen(st, seg);
      daily.staminaWasted += st.regenPerDay - regen;
      stamina = Math.min(st.cap, stamina) + regen;
      for (let i = 0; i < (seg.refills || 0); i++) {
        if (!paidCur || hold[paidCur] < st.refillCost) break;
        hold[paidCur] -= st.refillCost; addFlow('out', 'refill:스태미나 충전', paidCur, st.refillCost);
        stamina += st.refillAmount;
      }
    }
    // 3. 콘텐츠
    const dayMinutes = noise ? seg.minutes * noise.mult * Math.exp(noise.dailySd * gauss(noise.rnd) - noise.dailySd ** 2 / 2) : seg.minutes;
    let time = dayMinutes;
    for (const c of cfg.contents) {
      if (power() < (c.unlock || 0)) continue;
      unlockDay[c.id] ??= day;
      const cap = c.limit === 0 ? Infinity : c.limit;
      const used = c.period === 'week' ? (weekRuns[c.id] || 0) : 0;
      // 콘텐츠 단계에서는 전투력이 변하지 않으므로(성장은 5단계) 횟수를 한 번에 계산: min(남은 횟수, 시간 ÷ 분, 스태미나 ÷ 소모)
      let n = 0;
      if (!(c.limit === 0 && !(c.minutes > 0) && !(c.stamina > 0))) {
        const mins = c.minutes || 0, stc = st.enabled ? (c.stamina || 0) : 0;
        n = cap - used;
        if (mins > 0) n = Math.min(n, Math.floor(time / mins + 1e-9));
        if (stc > 0) n = Math.min(n, Math.floor(stamina / stc + 1e-9));
        n = Math.max(0, Math.min(n, 100001));
        if (n > 0) {
          time -= n * mins;
          stamina -= n * stc;
          const mult = 1 + ((c.powerBonus || 0) / 100) * (power() / 100);
          for (const id of curIds) {
            const v = (c.reward?.[id] || 0) * mult * n;
            if (v) { hold[id] += v; addFlow('in', `content:${c.id}`, id, v); }
          }
        }
      }
      if (c.period === 'week') weekRuns[c.id] = used + n;
      runs[c.id] = (runs[c.id] || 0) + n;
    }
    daily.minutesUsed += dayMinutes - time;
    // 4. 상점
    for (const x of cfg.exchanges) {
      let n = 0;
      while (n < x.maxPerDay && hold[x.from] >= Math.max(x.threshold || 0, x.amount)) {
        hold[x.from] -= x.amount; addFlow('out', `shop:${x.id}`, x.from, x.amount);
        hold[x.to] += x.amount * x.rate; addFlow('in', `shop:${x.id}`, x.to, x.amount * x.rate);
        n++;
      }
    }
    // 5. 성장
    let blockedToday = null;
    for (const g of cfg.growth) {
      while (levels[g.id] < g.max) {
        const lv = levels[g.id];
        let short = null, worst = 0;
        for (const id of curIds) {
          const need = growthCost(g, lv, id);
          if (need > hold[id]) { const r = (need - hold[id]) / need; if (r > worst) { worst = r; short = id; } }
        }
        if (short) { blockedToday ??= short; break; }
        for (const id of curIds) { const need = growthCost(g, lv, id); if (need) { hold[id] -= need; addFlow('out', `growth:${g.id}`, id, need); } }
        levels[g.id]++;
      }
    }
    if (blockedToday) bottleneck[blockedToday] = (bottleneck[blockedToday] || 0) + 1;

    series.power.push(power());
    for (const id of curIds) series.hold[id].push(hold[id]);
    for (const g of cfg.growth) series.levels[g.id].push(levels[g.id]);
  }

  const totals = (dir) => {
    const byCur = Object.fromEntries(curIds.map(id => [id, 0]));
    for (const [k, v] of Object.entries(flow[dir])) byCur[k.split('|')[1]] += v;
    return byCur;
  };
  return {
    segment: seg, series, flow, runs, unlockDay, bottleneck,
    inflow: totals('in'), outflow: totals('out'),
    finalPower: power(), finalLevels: { ...levels },
    avgMinutes: daily.minutesUsed / D, staminaWastedPerDay: daily.staminaWasted / D,
  };
}

export function simulate(cfg) {
  const errors = validate(cfg);
  if (errors.length) return { ok: false, errors };
  const bySeg = cfg.segments.map(s => simulateSegment(cfg, s));
  bySeg.forEach((r, i) => {
    const seg = r.segment;
    r.retention = Array.from({ length: cfg.days + 1 }, (_, d) => retentionAt(seg, d));
    // 설치당 기대 매출: 그날 남아 있으면 월 과금 ÷ 30을 쓴다
    r.ltv = r.retention.slice(1).reduce((a, p) => a + p * (seg.spendWon || 0) / 30, 0);
    if (cfg.variance?.enabled) r.band = powerBand(cfg, seg, i);
  });
  const ltv = bySeg.reduce((a, r) => a + (r.segment.share / 100) * r.ltv, 0);
  return { ok: true, days: cfg.days, bySeg, ltv, warnings: warnings(cfg, bySeg) };
}

/** 같은 세그먼트 유저 N명의 날짜별 전투력 분위수 (하위 10%·중앙값·상위 10%)와 하위 10% 유저의 콘텐츠 해금일 */
function powerBand(cfg, seg, segIndex) {
  const v = cfg.variance, rnd = mulberry32(20261017 + segIndex * 101);
  const sd = (v.sd ?? 30) / 100, dailySd = (v.daily ?? 10) / 100, N = v.users ?? 100, D = cfg.days;
  const series = [], unlock = {};
  for (let u = 0; u < N; u++) {
    const mult = Math.exp(sd * gauss(rnd) - sd * sd / 2);
    const r = simulateSegment(cfg, seg, { mult, dailySd, rnd });
    series.push(r.series.power);
    for (const c of cfg.contents) (unlock[c.id] ??= []).push(r.unlockDay[c.id] ?? Infinity);
  }
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.ceil(p * arr.length) - 1))];
  const p10 = [], p50 = [], p90 = [];
  for (let d = 0; d <= D; d++) {
    const col = series.map(s => s[d]).sort((a, b) => a - b);
    p10.push(q(col, 0.1)); p50.push(q(col, 0.5)); p90.push(q(col, 0.9));
  }
  const unlockLate = Object.fromEntries(Object.entries(unlock).map(([id, a]) => [id, q(a.sort((x, y) => x - y), 0.9)]));
  return { users: N, p10, p50, p90, unlockLate };
}

/** 첫 도달일 (없으면 null) */
export const firstDay = (arr, pred) => { const i = arr.findIndex(pred); return i < 0 ? null : i; };

function warnings(cfg, bySeg) {
  const out = [];
  const name = (id) => cfg.currencies.find(c => c.id === id)?.name ?? id;
  const warm = Math.min(cfg.days - 1, cfg.warmup ?? 7);
  const th = (cfg.sinkRatioWarn ?? 70) / 100;
  for (const r of bySeg) {
    const seg = r.segment.name;
    // 적체: 웜업 이후 보유량이 늘고 소모율이 기준 미만
    for (const c of cfg.currencies) {
      const h = r.series.hold[c.id];
      const ratio = r.inflow[c.id] > 0 ? r.outflow[c.id] / r.inflow[c.id] : 1;
      if (r.inflow[c.id] > 0 && ratio < th && h[cfg.days] > h[warm]) {
        out.push({ level: 'warn', text: `${seg} · ${c.name}: 소모율 ${(ratio * 100).toFixed(0)}% — 쓸 곳이 부족해 쌓입니다 (${cfg.days}일차 보유 ${Math.round(h[cfg.days]).toLocaleString('ko-KR')}).` });
      }
    }
    // 성장 정체: 7일 이상 전투력 변화 없음 (모든 성장이 최대가 아닌데)
    const p = r.series.power;
    let run = 0, maxRun = 0, at = 0;
    for (let d = 1; d <= cfg.days; d++) { if (p[d] === p[d - 1]) { run++; if (run > maxRun) { maxRun = run; at = d; } } else run = 0; }
    const allMax = cfg.growth.every(g => r.finalLevels[g.id] >= g.max);
    if (maxRun >= 7 && !allMax) {
      const top = Object.entries(r.bottleneck).sort((a, b) => b[1] - a[1])[0];
      out.push({ level: 'serious', text: `${seg}: ${at - maxRun + 1}~${at}일차 ${maxRun}일 동안 성장 정체${top ? ` — 병목 재화는 ${name(top[0])}` : ''}.` });
    }
    if (allMax) {
      const d = firstDay(p, v => v >= r.finalPower);
      out.push({ level: 'info', text: `${seg}: ${d}일차에 모든 성장이 최대치 — 이후 재화는 쌓이기만 합니다 (콘텐츠 수명 확인).` });
    }
    // 해금 못 한 콘텐츠
    for (const c of cfg.contents) {
      if (r.runs[c.id]) continue;
      if (r.unlockDay[c.id] != null) out.push({ level: 'warn', text: `${seg}: '${c.name}'이(가) ${r.unlockDay[c.id]}일차에 열렸지만 시간·스태미나가 남지 않아 한 번도 못 했습니다 (플레이 ${r.segment.minutes}분 · 우선순위·소요 시간 확인).` });
      else out.push({ level: 'info', text: `${seg}: '${c.name}'을(를) 기간 내 해금하지 못했습니다 (필요 전투력 ${c.unlock}, 최종 ${Math.round(r.finalPower)}).` });
    }
  }
  // 이탈: 콘텐츠가 열리는 날 남아 있는 비율 / 편차: 플레이 시간이 적은 하위 10%가 늦게 여는 콘텐츠
  for (const r of bySeg) {
    const seg = r.segment;
    for (const c of cfg.contents) {
      const d = r.unlockDay[c.id];
      if (hasRetention(seg) && d != null && d > 1) {
        const ret = retentionAt(seg, d);
        if (ret < 0.3) out.push({ level: 'warn', text: `${seg.name}: '${c.name}'이(가) ${d}일차에 열리는데 그때 남은 ${seg.name} 유저는 ${(ret * 100).toFixed(0)}%입니다 — 대부분이 보지 못하고 떠납니다.` });
      }
      const late = r.band?.unlockLate[c.id];
      if (r.band && d != null && (late === Infinity || late - d >= 7)) {
        out.push({ level: 'info', text: `${seg.name}: 플레이 시간이 적은 하위 10%는 '${c.name}'을(를) ${late === Infinity ? '기간 안에 열지 못합니다' : `${late}일차에 엽니다`} (평균 유저 ${d}일차).` });
      }
    }
  }
  // 세그먼트 격차
  if (bySeg.length >= 2) {
    const sorted = [...bySeg].sort((a, b) => a.finalPower - b.finalPower);
    const lo = sorted[0], hi = sorted.at(-1);
    const gap = lo.finalPower > 0 ? hi.finalPower / lo.finalPower : Infinity;
    if (gap >= (cfg.gapWarn ?? 3)) out.push({ level: 'warn', text: `세그먼트 격차: ${hi.segment.name} 전투력이 ${lo.segment.name}의 ${gap.toFixed(1)}배 (${cfg.days}일차).` });
  }
  const order = { serious: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** Mermaid 루프 다이어그램: 콘텐츠 → 재화 → 성장 → 전투력 → (보너스·해금) → 콘텐츠 */
export function toMermaid(cfg) {
  const q = (s) => `"${String(s).replace(/"/g, "'")}"`;
  // 열 4개(생산 → 재화 → 성장 → 전투력)로 배치하고, 되먹임은 '전투력 → 생산' 화살표 하나로 묶어 교차를 줄인다
  const L = ['flowchart LR'];
  L.push('  subgraph P["① 생산 · 콘텐츠"]', '    direction TB');
  cfg.contents.forEach(c => L.push(`    C_${c.id}[${q(c.name)}]`));
  if (cfg.paid?.currency) L.push(`    PAY[${q('과금')}]`);
  L.push('  end');
  L.push('  subgraph R["② 재화"]', '    direction TB');
  cfg.currencies.forEach(c => L.push(`    R_${c.id}([${q(c.name)}])`));
  L.push('  end');
  L.push('  subgraph G["③ 소비 · 성장"]', '    direction TB');
  cfg.growth.forEach(g => L.push(`    G_${g.id}[${q(g.name)}]`));
  L.push('  end');
  L.push('  POWER{{"④ 전투력"}}');
  if (cfg.paid?.currency) L.push(`  PAY --> R_${cfg.paid.currency}`);
  cfg.contents.forEach(c => Object.entries(c.reward || {}).filter(([, v]) => v > 0).forEach(([cur]) => L.push(`  C_${c.id} --> R_${cur}`)));
  cfg.growth.forEach(g => Object.entries(g.cost || {}).filter(([, v]) => v > 0).forEach(([cur]) => L.push(`  R_${cur} --> G_${g.id}`)));
  cfg.growth.forEach(g => L.push(`  G_${g.id} --> POWER`));
  const fb = cfg.contents.filter(c => (c.powerBonus || 0) > 0 || (c.unlock || 0) > 0);
  if (fb.length) L.push(`  POWER -. ${q('보상 증가 · 콘텐츠 해금')} .-> P`);
  cfg.exchanges.forEach(x => L.push(`  R_${x.from} -. ${q(x.name)} .-> R_${x.to}`));
  return L.join('\n');
}
