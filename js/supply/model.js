// 성장 재화 수급 설계 — 공급(콘텐츠가 뿌리는 양)에서 성장 필요량을 역산 (순수 계산 모듈, DOM 없음)
//
// ■ 공급
//   공급원(콘텐츠·상품)마다 1회 획득량 × 세그먼트별 횟수, 주기(매일·매주·매월·1회), 해금 일차
//   S_seg(d) = 시작 보유량 + d일차까지 누적 획득량   (d일차가 끝났을 때, 일차 사이는 선형 보간)
//
// ■ 목표 성장 속도
//   성장 항목마다 공급 배분 비율 p와 마일스톤 (일차, 레벨). 마일스톤 사이는 레벨을 선형 보간 →
//   기준 세그먼트가 레벨 L에 닿아야 하는 일차 d(L)
//
// ■ 역산
//   누적 필요량 C(L) = p × S_ref(d(L)),  레벨 L 필요량 = C(L) − C(L−1)
//   → 기준 세그먼트는 마일스톤에 정확히 도달 (보정·반올림 전)
//   보정: 필요량이 레벨이 오를수록 줄지 않게(단조 증가) 인접 위반 구간을 평균으로 묶음(PAV, 총량 유지)
//   반올림: 보정 시 레벨마다(구간 값이 깔끔), 보정 없으면 누적량을 반올림한 뒤 차분(총량 오차가 쌓이지 않음)
//
// ■ 검증
//   세그먼트별 레벨 도달일 = p × S_seg(d) ≥ C(L)인 첫 날

export const PERIODS = { day: '매일', week: '매주', month: '매월', once: '1회' };

export function validate(cfg) {
  const errors = [];
  if (!(Number.isInteger(cfg.days) && cfg.days >= 1 && cfg.days <= 730)) errors.push('기간은 1~730일이어야 합니다.');
  if (!cfg.segments.length) errors.push('세그먼트를 1개 이상 추가하세요.');
  if (!(cfg.ref >= 0 && cfg.ref < cfg.segments.length)) errors.push('기준 세그먼트를 선택하세요.');
  if (!cfg.sources.length) errors.push('공급원을 1개 이상 추가하세요.');
  cfg.sources.forEach((s, i) => {
    if (!(s.amount >= 0)) errors.push(`공급원 ${i + 1}번 '${s.name}': 획득량은 0 이상이어야 합니다.`);
    if (!(s.unlock >= 1)) errors.push(`공급원 ${i + 1}번 '${s.name}': 해금 일차는 1 이상이어야 합니다.`);
  });
  if (!cfg.sinks.length) errors.push('성장 항목을 1개 이상 추가하세요.');
  cfg.sinks.forEach((g, i) => {
    const n = `성장 ${i + 1}번 '${g.name}'`;
    if (!(Number.isInteger(g.max) && g.max >= 1 && g.max <= 1000)) errors.push(`${n}: 최대 레벨은 1~1000이어야 합니다.`);
    if (!(g.share > 0)) errors.push(`${n}: 공급 배분은 0%보다 커야 합니다.`);
    const ms = g.milestones;
    if (!ms.length) errors.push(`${n}: 마일스톤을 1개 이상 넣으세요.`);
    ms.forEach((m, j) => {
      if (!(m.day > 0) || !(m.level > 0)) errors.push(`${n}: 마일스톤 ${j + 1}번의 일차·레벨은 0보다 커야 합니다.`);
      if (j && !(m.day > ms[j - 1].day && m.level > ms[j - 1].level)) errors.push(`${n}: 마일스톤은 일차와 레벨이 모두 커지는 순서여야 합니다 (${j + 1}번).`);
    });
    if (ms.length && ms.at(-1).level > g.max) errors.push(`${n}: 마지막 마일스톤 레벨(${ms.at(-1).level})이 최대 레벨(${g.max})보다 큽니다.`);
  });
  return errors;
}

/** 세그먼트별 일일 획득량 [d] (d = 1..H), 공급원별 누적 기여 */
export function dailySupply(cfg, seg, H) {
  const daily = new Float64Array(H + 1);
  const bySource = {};
  for (const s of cfg.sources) {
    const runs = s.runs?.[seg.id] ?? 0;
    let total = 0;
    for (let d = s.unlock; d <= H; d++) {
      const k = d - s.unlock;
      const hit = s.period === 'day' || (s.period === 'week' && k % 7 === 0) || (s.period === 'month' && k % 30 === 0) || (s.period === 'once' && k === 0);
      if (!hit) continue;
      const v = s.amount * runs;
      daily[d] += v;
      if (d <= cfg.days) total += v;
    }
    bySource[s.id] = total;
  }
  return { daily, bySource };
}

/** 누적 공급 S[d] (S[0] = 시작 보유량) */
function cumulative(start, daily) {
  const S = new Float64Array(daily.length);
  S[0] = start;
  for (let d = 1; d < daily.length; d++) S[d] = S[d - 1] + daily[d];
  return S;
}
const at = (S, x) => { // 일차 사이 선형 보간 (공급이 하루 동안 고르게 들어온다고 가정)
  if (x <= 0) return S[0];
  const i = Math.floor(x);
  if (i >= S.length - 1) return S[S.length - 1];
  return S[i] + (S[i + 1] - S[i]) * (x - i);
};

/** 레벨 L에 닿아야 하는 일차 (마일스톤 선형 보간, 마지막 마일스톤 이후는 마지막 구간 기울기로 연장) */
export function targetDay(g, L) {
  const pts = [{ day: 0, level: g.start ?? 0 }, ...g.milestones];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (L <= b.level) return a.day + ((L - a.level) / (b.level - a.level)) * (b.day - a.day);
  }
  const a = pts.at(-2), b = pts.at(-1);
  return b.day + ((L - b.level) / (b.level - a.level)) * (b.day - a.day);
}

/** PAV: 단조 증가가 되도록 위반 구간을 평균으로 합침 (합계 유지) */
export function monotone(xs) {
  const blocks = [];
  for (const x of xs) {
    blocks.push({ sum: x, n: 1 });
    while (blocks.length > 1 && blocks.at(-2).sum / blocks.at(-2).n > blocks.at(-1).sum / blocks.at(-1).n) {
      const b = blocks.pop(); blocks.at(-1).sum += b.sum; blocks.at(-1).n += b.n;
    }
  }
  return blocks.flatMap(b => Array(b.n).fill(b.sum / b.n));
}

/** 등비 근사: 필요량(L) ≈ base × rate^(L−1) (로그 최소제곱) */
export function fitGeometric(costs) {
  const pts = costs.map((c, i) => [i, c]).filter(([, c]) => c > 0);
  if (pts.length < 2) return null;
  const n = pts.length, mx = pts.reduce((a, [x]) => a + x, 0) / n, my = pts.reduce((a, [, c]) => a + Math.log(c), 0) / n;
  let sxy = 0, sxx = 0;
  for (const [x, c] of pts) { sxy += (x - mx) * (Math.log(c) - my); sxx += (x - mx) ** 2; }
  const b = sxx ? sxy / sxx : 0, a = my - b * mx;
  const base = Math.exp(a), rate = Math.exp(b);
  const err = pts.reduce((m, [x, c]) => Math.max(m, Math.abs(base * rate ** x - c) / c), 0);
  return { base, rate, maxErr: err };
}

export function design(cfg) {
  const errors = validate(cfg);
  if (errors.length) return { ok: false, errors };
  const warnings = [];
  const ref = cfg.segments[cfg.ref];

  // 계산 구간: 표시 기간과 모든 목표일 중 큰 쪽 (목표가 기간 밖이어도 공급은 이어진다고 보고 역산)
  const lastDay = Math.max(...cfg.sinks.map(g => targetDay(g, g.max)));
  const H = Math.max(cfg.days, Math.ceil(lastDay) + 1);
  const supply = cfg.segments.map(seg => {
    const { daily, bySource } = dailySupply(cfg, seg, H);
    return { seg, daily, S: cumulative(cfg.start ?? 0, daily), bySource };
  });
  const refS = supply[cfg.ref].S;

  const shareSum = cfg.sinks.reduce((a, g) => a + g.share, 0);
  if (shareSum > 100.0001) warnings.push({ level: 'serious', text: `성장 항목 배분 합이 ${shareSum}%입니다. 공급보다 많이 쓰도록 설계되어 목표에 도달할 수 없습니다.` });
  else if (shareSum < 99.9999) warnings.push({ level: 'info', text: `배분하지 않은 ${+(100 - shareSum).toFixed(2)}%는 쓰이지 않고 쌓입니다 (다른 소모처가 필요).` });

  const sinks = cfg.sinks.map(g => {
    const p = g.share / 100;
    const start = g.start ?? 0;
    const levels = [];
    for (let L = start + 1; L <= g.max; L++) levels.push(L);
    const days = levels.map(L => targetDay(g, L));
    const cumRaw = days.map(d => p * at(refS, d));
    let raw = cumRaw.map((c, i) => c - (i ? cumRaw[i - 1] : 0));
    const exact = raw.slice();
    if (cfg.smooth) raw = monotone(raw);
    // 반올림: 보정을 켰으면 레벨마다 반올림(같은 구간은 같은 값으로 깔끔하게), 껐으면 누적량을 반올림한 뒤 차분(총량 오차가 쌓이지 않음)
    const unit = cfg.round > 0 ? cfg.round : 1;
    const cost = [], cum = [];
    if (cfg.smooth) {
      raw.forEach((r) => { const c = r > 0 ? Math.max(unit, Math.round(r / unit) * unit) : 0; cost.push(c); cum.push((cum.at(-1) ?? 0) + c); });
    } else {
      let acc = 0;
      raw.forEach((r) => { acc += r; const c = Math.round(acc / unit) * unit; cost.push(c - (cum.at(-1) ?? 0)); cum.push(c); });
    }

    // 세그먼트별 도달일
    const reach = supply.map(({ S }) => {
      let d = 0;
      return cum.map(c => {
        while (d <= H && p * S[Math.min(d, H)] < c - 1e-9) d++;
        return d > H ? null : d;
      });
    });

    if (cost.some(c => c <= 0)) {
      const zero = levels.filter((_, i) => cost[i] <= 0);
      warnings.push({ level: 'warn', text: `${g.name}: Lv${zero.slice(0, 5).join(', ')}${zero.length > 5 ? ' 등' : ''}의 필요량이 0입니다. 그 구간에 공급이 없거나(해금 전) 목표 속도가 공급보다 빠릅니다.` });
    }
    if (cfg.smooth) {
      const shift = reach[cfg.ref].map((d, i) => (d == null ? 0 : Math.abs(d - days[i])));
      const worst = Math.max(0, ...shift);
      if (worst >= 3) warnings.push({ level: 'info', text: `${g.name}: 단조 증가 보정으로 기준 세그먼트(${ref.name}) 도달일이 최대 ${Math.round(worst)}일 어긋납니다. 마일스톤을 정확히 맞추려면 보정을 끄세요.` });
    }
    supply.forEach(({ seg }, si) => {
      const r = reach[si];
      const maxDay = r.at(-1);
      if (maxDay == null || maxDay > cfg.days) {
        const lv = r.filter(d => d != null && d <= cfg.days).length + start;
        warnings.push({ level: si === cfg.ref ? 'warn' : 'info', text: `${seg.name} · ${g.name}: ${cfg.days}일 안에 최대 레벨에 못 닿습니다 (Lv${lv}/${g.max}).` });
      }
    });
    if (supply.length >= 2) {
      const ends = reach.map(r => r.at(-1));
      const finite = ends.filter(d => d != null);
      if (finite.length >= 2 && Math.max(...finite) / Math.max(1, Math.min(...finite)) >= (cfg.gapWarn ?? 3)) {
        const fast = supply[ends.indexOf(Math.min(...finite))].seg.name, slow = supply[ends.indexOf(Math.max(...finite))].seg.name;
        warnings.push({ level: 'info', text: `${g.name}: 최대 레벨 도달이 ${fast} ${Math.min(...finite)}일, ${slow} ${Math.max(...finite)}일로 ${(Math.max(...finite) / Math.max(1, Math.min(...finite))).toFixed(1)}배 차이입니다.` });
      }
    }
    return { sink: g, levels, targetDays: days, exact, cost, cum, reach, total: cum.at(-1) ?? 0, fit: fitGeometric(cost) };
  });

  const order = { serious: 0, warn: 1, info: 2 };
  return {
    ok: true, horizon: H,
    supply: supply.map(({ seg, daily, S, bySource }) => ({
      seg, S, bySource,
      perDay: (S[cfg.days] - S[0]) / cfg.days,
      total: S[cfg.days] - S[0],
      dailyAt: Array.from(daily.slice(0, cfg.days + 1)),
    })),
    sinks,
    warnings: warnings.sort((a, b) => order[a.level] - order[b.level]),
  };
}
