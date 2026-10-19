// 성장 엑셀 표 템플릿 생성기 — 계산 모듈 (DOM 없음, Node 테스트에서 그대로 import)
//
// 이 탭의 결과물은 수식이 살아 있는 .xlsx다(xlsx.js). 여기의 계산은 그 엑셀 수식과 똑같은 규칙으로 한 줄씩 돌린
// "참조 계산"이라, 화면 미리보기와 base 자동 풀이, 그리고 "내보낸 엑셀을 다시 계산한 값 = 이 값" 테스트에 쓴다.
// 규칙을 바꿀 때는 xlsx.js의 수식도 같이 바꿔야 한다.
//
// ■ 레벨 곡선 (① 시트)
//   need(L) = L → L+1 필요량. raw(1) = base, raw(L) = raw(L−1) × (1 + 증가율(L)/100) × (L이 점프 레벨이면 J)
//     증가율(L) = 구간 표에서 '시작 레벨 ≤ L'인 마지막 행의 증가율 (구간별 증가율 — 단일 등비의 후반 폭주 방지)
//   need(L) = round(raw(L)), 상한 > 0이면 min(상한, round(raw))
//   cum(L) = L에 도달하는 데 필요한 누적량 = Σ need(1..L−1), cum(1) = 0
//   표 기준 획득량(L) = round(시작값 × (1 + 증가율/100)^(L−1)) — '표' 방식 공급원이 곱해 쓰는 레벨별 값(예: 사냥 시간당 경험치)
//
// ■ 하루 (④ 시트, 세그먼트마다) — 전날 행만 참조하므로 순환 참조가 없다
//   시작 레벨 = 전날 끝 레벨, 접속 = 요일 패턴(1일차 = 월), 이번 주 접속 = 주 첫날이면 접속, 아니면 전날 + 접속
//   공급 = Σ 공급원 [주기·해금 조건] × [획득량] × [시간 비례면 플레이 분 ÷ 60] × 보정 배율 × 세그먼트 횟수
//     매일: 접속한 날 × 해금됨      매주: 7의 배수 일차 × 그 주 접속 ≥ 1 × 해금됨
//     1회: 해금 기준이 일차면 그 일차에, 레벨이면 시작 레벨이 처음 그 레벨 이상이 된 날에 (접속과 무관)
//     해금됨: 일차 ≥ 값 (일차 기준) / 시작 레벨 ≥ 값 (레벨 기준)
//     획득량: 고정 = 값 / 표 = 값 × 표 기준 획득량(시작 레벨) / % = 값% × need(시작 레벨)
//   누적 = 전날 누적 + 공급 (+ 엑셀의 '추가 공급' 칸, 기본 0)
//   끝 레벨 = min(최대 레벨, cum(L) ≤ 누적인 가장 큰 L)  (엑셀 MATCH 근사 일치)
//   무성장 연속 = 끝 레벨 > 시작 레벨이거나 이미 최대 레벨이면 0, 아니면 전날 + 1 → 최장 무성장 기간 = 최댓값
//
// ■ 검증 (⑤ 시트)
//   레벨 L 도달일 = 끝 레벨 < L인 날 수 + 1 (기간 안에 못 닿으면 null). 레벨당 일수 = 도달일(L) − 도달일(L−1)

export const PERIODS = { daily: '매일', weekly: '매주', once: '1회' };
export const UNLOCKS = { day: '일차', level: '레벨' };
export const METHODS = { fixed: '고정', table: '표', pct: '%' };
export const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
export const LIMITS = { sources: 100, segments: 6, bands: 10, jumps: 10, maxLevel: 500, days: 730 };

const num = (x, d = 0) => (Number.isFinite(+x) ? +x : d);

/** 설정 확인 → 오류 문장 배열 */
export function validate(cfg) {
  const e = [];
  if (!(cfg.maxLevel >= 2 && cfg.maxLevel <= LIMITS.maxLevel)) e.push(`최대 레벨은 2~${LIMITS.maxLevel}이어야 합니다.`);
  if (!(cfg.days >= 1 && cfg.days <= LIMITS.days)) e.push(`기간은 1~${LIMITS.days}일이어야 합니다.`);
  if (!(cfg.curve?.base > 0)) e.push('기준 필요량(base)은 0보다 커야 합니다.');
  if (!cfg.curve?.bands?.length) e.push('증가율 구간이 하나 이상 있어야 합니다 (시작 레벨 1).');
  else if (!cfg.curve.bands.some(b => num(b.from) <= 1)) e.push('첫 증가율 구간의 시작 레벨은 1이어야 합니다.');
  if ((cfg.curve?.bands?.length || 0) > LIMITS.bands) e.push(`증가율 구간은 ${LIMITS.bands}개까지입니다.`);
  if ((cfg.curve?.jumps?.length || 0) > LIMITS.jumps) e.push(`점프 레벨은 ${LIMITS.jumps}개까지입니다.`);
  if (!(cfg.curve?.jumpMult > 0)) e.push('점프 배율은 0보다 커야 합니다.');
  if (!cfg.segments?.length) e.push('세그먼트가 하나 이상 있어야 합니다.');
  if ((cfg.segments?.length || 0) > LIMITS.segments) e.push(`세그먼트는 ${LIMITS.segments}개까지입니다.`);
  if ((cfg.sources?.length || 0) > LIMITS.sources) e.push(`공급원은 ${LIMITS.sources}개까지입니다.`);
  for (const s of cfg.segments || []) if (!Array.isArray(s.days) || s.days.length !== 7) e.push(`'${s.name}': 요일 접속 패턴은 7칸이어야 합니다.`);
  return e;
}

/** ① 레벨 곡선: need[L], cum[L], table[L], rate[L], jump[L] (1부터, 0번 칸은 비움) */
export function levelCurve(cfg) {
  const { base, bands, jumps, jumpMult, cap } = cfg.curve, M = cfg.maxLevel;
  const need = [0], cum = [0, 0], table = [0], rate = [0], jump = [false], raw = [0];
  const jumpSet = new Set((jumps || []).map(Number));
  for (let L = 1; L <= M; L++) {
    let r = 0;
    for (const b of bands) if (num(b.from) <= L) r = num(b.rate); // 목록 순서상 마지막으로 맞는 행 (엑셀과 같은 규칙)
    rate[L] = r;
    jump[L] = jumpSet.has(L);
    raw[L] = L === 1 ? base : raw[L - 1] * (1 + r / 100) * (jump[L] ? jumpMult : 1);
    const rounded = Math.round(raw[L]);
    need[L] = cap > 0 ? Math.min(cap, rounded) : rounded;
    table[L] = Math.round(cfg.table.start * (1 + cfg.table.rate / 100) ** (L - 1));
  }
  for (let L = 2; L <= M; L++) cum[L] = cum[L - 1] + need[L - 1];
  return { need, cum, table, rate, jump, raw };
}

/** cum(L) ≤ x인 가장 큰 L (cum은 증가) */
function levelAt(cum, x, M) {
  let lo = 1, hi = M;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= x) lo = mid; else hi = mid - 1; }
  return lo;
}

/** 공급원 하나가 이 날 주는 양 */
function sourceAmount(src, segIdx, seg, ctx) {
  const { d, L, P, att, week, curve } = ctx;
  const v = num(src.unlockAt);
  const unlocked = src.unlock === 'level' ? L >= v : d >= v;
  let f = 0;
  if (src.period === 'daily') f = att * (unlocked ? 1 : 0);
  else if (src.period === 'weekly') f = (d % 7 === 0 ? 1 : 0) * (week > 0 ? 1 : 0) * (unlocked ? 1 : 0);
  else if (src.period === 'once') f = src.unlock === 'level' ? (L >= v && P < v ? 1 : 0) : (d === v ? 1 : 0);
  if (!f) return 0;
  const val = num(src.value);
  const amount = src.method === 'table' ? val * curve.table[L] : src.method === 'pct' ? (val / 100) * curve.need[L] : val;
  const time = src.timed ? num(seg.minutes) / 60 : 1;
  return f * amount * time * num(src.mult, 1) * num(src.counts?.[segIdx], 1); // 비운 배율·횟수 = 1 (엑셀과 같음)
}

/** 한 세그먼트의 일차별 진행. rows[d] = { d, start, att, week, supply, cum, end, stall }, rows[0] = 0일차 */
export function runSegment(cfg, curve, segIdx) {
  const seg = cfg.segments[segIdx], M = cfg.maxLevel;
  const rows = [{ d: 0, start: 1, att: 0, week: 0, supply: 0, cum: 0, end: 1, stall: 0 }];
  const bySource = cfg.sources.map(() => 0);
  for (let d = 1; d <= cfg.days; d++) {
    const prev = rows[d - 1];
    const start = prev.end, P = prev.start;
    const att = num(seg.days[(d - 1) % 7]) ? 1 : 0;
    const week = (d - 1) % 7 === 0 ? att : prev.week + att;
    const ctx = { d, L: start, P, att, week, curve };
    let supply = 0;
    cfg.sources.forEach((src, i) => { const a = sourceAmount(src, segIdx, seg, ctx); bySource[i] += a; supply += a; });
    const cum = prev.cum + supply;
    const end = Math.min(M, levelAt(curve.cum, cum, M));
    const stall = end > start || start >= M ? 0 : prev.stall + 1;
    rows.push({ d, start, att, week, supply, cum, end, stall });
  }
  // 레벨 L 도달일: 끝 레벨 < L인 날 수 + 1 (기간 안에 못 닿으면 null)
  const reach = [null, 0];
  for (let L = 2; L <= M; L++) {
    let below = 0;
    for (let d = 1; d <= cfg.days; d++) if (rows[d].end < L) below++;
    reach[L] = below >= cfg.days ? null : below + 1;
  }
  const maxStall = Math.max(0, ...rows.map(r => r.stall));
  return { seg, rows, reach, maxStall, endLevel: rows[cfg.days].end, bySource, total: rows[cfg.days].cum };
}

/** 전체 분석 */
export function analyze(cfg) {
  const errors = validate(cfg);
  if (errors.length) return { ok: false, errors };
  const curve = levelCurve(cfg);
  const segs = cfg.segments.map((_, i) => runSegment(cfg, curve, i));
  const ref = Math.min(Math.max(0, cfg.ref ?? 0), segs.length - 1);
  const milestones = (cfg.milestones || []).filter(m => m.level >= 2 && m.level <= cfg.maxLevel).map(m => {
    const actual = segs[ref].reach[m.level];
    return { ...m, actual, diff: actual == null ? null : actual - m.day };
  });
  const warnings = [];
  const R = segs[ref];
  for (const m of milestones) {
    if (m.actual == null) warnings.push({ level: 'serious', text: `기준 세그먼트(${R.seg.name})가 ${cfg.days}일 안에 Lv${m.level}에 닿지 못합니다 (목표 ${m.day}일차).` });
    else if (Math.abs(m.diff) >= Math.max(2, m.day * 0.1)) warnings.push({ level: 'warn', text: `기준 세그먼트(${R.seg.name})의 Lv${m.level} 도달이 목표 ${m.day}일차보다 ${Math.abs(m.diff)}일 ${m.diff > 0 ? '늦습니다' : '빠릅니다'} (${m.actual}일차). 'base 맞추기'로 다시 풀 수 있습니다.` });
  }
  for (const s of segs) {
    if (s.maxStall >= 5) warnings.push({ level: 'warn', text: `${s.seg.name}: 레벨이 오르지 않는 날이 최장 ${s.maxStall}일 이어집니다 — 이 구간에서 체감이 멈춥니다.` });
    if (s.endLevel < cfg.maxLevel) warnings.push({ level: 'info', text: `${s.seg.name}: ${cfg.days}일 안에 최대 레벨에 닿지 못합니다 (Lv${s.endLevel}/${cfg.maxLevel}).` });
  }
  // 후반 폭주: 기준 세그먼트가 닿은 마지막 10레벨의 평균 레벨당 일수가 그 앞 10레벨의 2배 이상 (초반은 원래 빠르므로 바로 앞 구간과 비교)
  const lpd = levelDays(R.reach, cfg.maxLevel).filter(x => x.days != null);
  if (lpd.length >= 20) {
    const avg = (xs) => xs.reduce((a, x) => a + x.days, 0) / xs.length;
    const prev = avg(lpd.slice(-20, -10)), late = avg(lpd.slice(-10));
    const lv = lpd.at(-1).level;
    if (prev > 0 && late >= prev * 2) warnings.push({ level: 'warn', text: `기준 세그먼트의 Lv${lv - 9}~${lv} 레벨당 일수(평균 ${late.toFixed(1)}일)가 바로 앞 10레벨(${prev.toFixed(1)}일)의 ${(late / prev).toFixed(1)}배로 늘어납니다 — 후반 폭주를 막으려면 증가율 구간을 나누거나 필요량 상한을 두세요.` });
  }
  return { ok: true, curve, segs, ref, milestones, warnings };
}

/** 도달일 → 레벨당 일수 [{ level, days }] (L = 2..M, 둘 다 있을 때만) */
export function levelDays(reach, M) {
  const out = [];
  for (let L = 2; L <= M; L++) out.push({ level: L, days: reach[L] != null && reach[L - 1] != null ? reach[L] - reach[L - 1] : null });
  return out;
}

// ── base·증가율 자동 풀이 ──────────────────────────────────
/** 기준 세그먼트의 레벨 M 도달일 (못 닿으면 Infinity) */
function reachDayOf(cfg, M) {
  const curve = levelCurve(cfg);
  const r = runSegment(cfg, curve, Math.min(cfg.ref ?? 0, cfg.segments.length - 1));
  return r.reach[M] ?? Infinity;
}

/**
 * 첫 마일스톤(레벨 M, 목표일 T)에 기준 세그먼트가 맞게 닿는 가장 큰 base를 찾는다 (정수, 이분 탐색).
 * base가 커질수록 필요량이 커져 도달일은 늦어지거나 같다(단조) — 공급이 전부 '%' 방식이면 base와 무관.
 * 반환 { base, actual, feasible, note }
 */
export function solveBase(cfg, ms = cfg.milestones?.[0]) {
  if (!ms) return { feasible: false, note: '마일스톤이 없습니다.' };
  const at = (b) => reachDayOf({ ...cfg, curve: { ...cfg.curve, base: b } }, ms.level);
  if (at(1) > ms.day) return { base: 1, actual: at(1), feasible: false, note: `base를 1로 낮춰도 Lv${ms.level}에 ${ms.day}일 안에 닿지 못합니다 — 공급을 늘리세요.` };
  let lo = 1, hi = 1e12;
  if (at(hi) <= ms.day) return { base: cfg.curve.base, actual: at(cfg.curve.base), feasible: false, note: '공급이 필요량에 비례해(% 방식) base와 무관하게 도달일이 정해집니다.' };
  while (hi - lo > 1) { const mid = Math.floor(Math.sqrt(lo * hi)) || lo + 1; if (mid <= lo || mid >= hi) break; if (at(mid) <= ms.day) lo = mid; else hi = mid; }
  // 로그 탐색 뒤 남은 정수 구간을 마저 좁힘
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (at(mid) <= ms.day) lo = mid; else hi = mid; }
  return { base: lo, actual: at(lo), feasible: true };
}

/**
 * 두 마일스톤으로 base와 증가율 배율 k를 함께 푼다: 모든 구간 증가율 × k, 각 k마다 첫 마일스톤에 base를 맞추고
 * 두 번째 마일스톤 도달일이 목표 이하인 가장 큰 k (k가 크면 후반 필요량이 커져 늦어짐). 반환 { k, base, actual2, feasible }
 */
export function solveRate(cfg) {
  const [m1, m2] = cfg.milestones || [];
  if (!m1 || !m2 || m2.level <= m1.level) return { feasible: false, note: '레벨이 더 높은 두 번째 마일스톤이 필요합니다.' };
  const withK = (k) => ({ ...cfg, curve: { ...cfg.curve, bands: cfg.curve.bands.map(b => ({ ...b, rate: num(b.rate) * k })) } });
  const fit = (k) => { const c = withK(k); const s = solveBase(c, m1); const c2 = { ...c, curve: { ...c.curve, base: s.base } }; return { s, day2: reachDayOf(c2, m2.level) }; };
  let lo = 0, hi = 20;
  if (fit(lo).day2 > m2.day) return { feasible: false, note: '증가율을 0으로 낮춰도 두 번째 마일스톤에 늦습니다 — 공급을 늘리세요.' };
  if (fit(hi).day2 <= m2.day) return { feasible: false, note: '증가율을 20배로 올려도 두 번째 마일스톤보다 빠릅니다.' };
  for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (fit(mid).day2 <= m2.day) lo = mid; else hi = mid; }
  const k = Math.floor(lo * 1000) / 1000; // 내림: 목표 이하 쪽(lo)을 넘지 않게
  const r = fit(k);
  return { k, base: r.s.base, actual2: r.day2, bands: withK(k).curve.bands.map(b => ({ ...b, rate: Math.round(b.rate * 1000) / 1000 })), feasible: r.day2 <= m2.day };
}
