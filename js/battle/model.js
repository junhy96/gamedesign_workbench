// 스탯·전투 밸런스 — 엔티티 × 스탯 × 규칙 수식 → 레벨 곡선, 1:1 승률(정확해), 승률 행렬 (순수 계산 모듈, DOM 없음)
//
// ■ 스탯 값 (레벨 L)
//   선형 b + (L−1)·g / 등비 b·(1 + g%)^(L−1) / 표: 레벨-값 점을 직선으로 잇고 양 끝은 그대로 (띄엄띄엄 넣으면 구간 성장)
//   아이템 수정자: (값 + Σ고정) × (1 + Σ% ÷ 100) × Π배율 — 아이템 순서와 무관. 그 뒤 스탯 최소·최대로 자름
//
// ■ 규칙 수식 (formula.js — 코드 실행 없는 파서)
//   자기 스탯만 쓰는 수식: 체력, 공격 속도(회/초), 전투력(CP) — 이름 그대로 (hp, atk …), lv
//   공격하는 쪽 a, 맞는 쪽 b: 데미지, 명중(%), 치명 확률(%), 치명 배율 — a.atk, b.def, lv
//   명중은 [하한, 상한]으로, 치명 확률은 [0, 100]으로 자르고, 데미지는 0 미만이면 0. 반올림(내림/반올림/없음)은 치명 배율까지 곱한 뒤
//
// ■ 한 번의 공격: 빗나감 1 − h / 일반 h·(1 − c), 데미지 d / 치명 h·c, 데미지 d·m  (변동이 0일 때)
//   쓰러뜨릴 때까지 공격 횟수 N의 분포 = (일반 적중 수, 치명 수) 상태를 공격마다 전진시키는 동적 계획법 — 정확해
//
// ■ 전투 진행 두 가지
//   시간 기반: n번째 공격 시각 = (n − 1) ÷ 공격 속도. 공격 속도가 2배면 같은 시간에 2배 공격한다.
//              A가 이기는 확률 = Σ_n P(N_A = n) · P(B가 그 시각 전에 못 쓰러뜨림). 두 결정타가 같은 시각이면 동전(반반) 또는 무승부
//   턴 교대 (Kalivra 방식): 공격 속도 비율로 선공을 정하고 한 번씩 번갈아 공격, 최대 턴 수. 공격 속도는 선공 확률에만 쓰인다
//   N_A와 N_B는 서로 독립(특성·버프 없음)이라 두 방식 모두 정확히 계산된다. 데미지 변동이나 특성이 있으면 시뮬레이션(battleOnce).

import { compile } from './formula.js';
import { mulberry32 } from '../enhance/simulate.js';

export const MODES = { time: '시간 기반 (공격 속도 = 초당 공격)', turn: '턴 교대 (Kalivra 방식)' };
export const TIES = { coin: '동전 (반반)', simul: '무승부' };
export const ROUNDS = { floor: '내림', round: '반올림', none: '없음' };
export const GROWTHS = { linear: '선형 (b + g·(Lv−1))', geo: '등비 (b·(1+g%)^(Lv−1))' };
export const FORMULA_KEYS = {
  damage: ['데미지', 'duel'], hit: ['명중 (%)', 'duel'], critChance: ['치명 확률 (%)', 'duel'], critMult: ['치명 배율', 'duel'],
  speed: ['공격 속도 (회/초)', 'self'], hp: ['체력', 'self'], cp: ['전투력 (CP)', 'self'],
};

// ── 검증 ────────────────────────────────────────────────
export function validate(cfg) {
  const errors = [];
  const ids = new Set();
  if (!cfg.stats?.length) errors.push('스탯을 1개 이상 정의하세요.');
  for (const s of cfg.stats || []) {
    if (!/^[A-Za-z_ㄱ-ㆎ가-힣][A-Za-z0-9_ㄱ-ㆎ가-힣]*$/.test(s.id || '')) errors.push(`스탯 '${s.id}': 이름은 글자로 시작하고 글자·숫자·_만 쓸 수 있습니다.`);
    else if (['a', 'b', 'lv'].includes(s.id)) errors.push(`스탯 이름 '${s.id}'는 수식에서 쓰는 이름이라 쓸 수 없습니다.`);
    if (ids.has(s.id)) errors.push(`스탯 '${s.id}'가 두 번 있습니다.`);
    ids.add(s.id);
  }
  if (!(cfg.entities?.length >= 1)) errors.push('엔티티를 1개 이상 추가하세요.');
  if (!(Number.isInteger(cfg.maxLevel) && cfg.maxLevel >= 1 && cfg.maxLevel <= 1000)) errors.push('최대 레벨은 1~1000이어야 합니다.');
  const r = cfg.rules || {};
  if (!(r.hitMin >= 0 && r.hitMax <= 100 && r.hitMin <= r.hitMax)) errors.push('명중 하한·상한은 0 ≤ 하한 ≤ 상한 ≤ 100이어야 합니다.');
  if (r.mode === 'time' && !(r.maxTime > 0)) errors.push('최대 전투 시간은 0보다 커야 합니다.');
  if (r.mode === 'turn' && !(Number.isInteger(r.maxTurns) && r.maxTurns >= 1 && r.maxTurns <= 100000)) errors.push('최대 턴 수는 1~100,000이어야 합니다.');
  for (const e of cfg.entities || []) if (!(e.variance >= 0 && e.variance < 1)) errors.push(`${e.name}: 데미지 변동은 0 이상 1 미만(±비율)이어야 합니다.`);
  return errors;
}

/** 규칙 수식 컴파일. 반환 { ok, f: { damage(a, b, lv) …, hp(s, lv) … }, errors: { key: 메시지 } } */
export function compileRules(cfg) {
  const statIds = cfg.stats.map(s => s.id);
  const self = [...statIds, 'lv'], duel = [...statIds.flatMap(s => [`a.${s}`, `b.${s}`]), 'lv'];
  const errors = {}, f = {};
  for (const [key, [, kind]] of Object.entries(FORMULA_KEYS)) {
    const allowed = kind === 'self' ? self : duel;
    const hint = (n) => {
      if (kind === 'duel' && statIds.includes(n)) return `공격하는 쪽은 a.${n}, 맞는 쪽은 b.${n}로 쓰세요.`;
      if (kind === 'self' && /^[ab]\./.test(n) && statIds.includes(n.slice(2))) return `이 수식은 자기 스탯만 씁니다 — ${n.slice(2)}로 쓰세요.`;
      return `쓸 수 있는 스탯: ${statIds.join(', ')}`;
    };
    const c = compile(cfg.rules[key] ?? '', allowed, hint);
    if (!c.ok) { errors[key] = c.error; continue; }
    const pick = c.vars.map(v => (v === 'lv' ? ['lv'] : kind === 'self' ? ['s', v] : [v[0], v.slice(2)]));
    f[key] = kind === 'self'
      ? (s, lv) => c.eval(pick.map(([w, n]) => (w === 'lv' ? lv : s[n])))
      : (a, b, lv) => c.eval(pick.map(([w, n]) => (w === 'lv' ? lv : w === 'a' ? a[n] : b[n])));
  }
  return { ok: !Object.keys(errors).length, f, errors };
}

// ── 스탯 ────────────────────────────────────────────────
/** 표 보간: 점 [[레벨, 값] …] 사이는 직선, 양 끝 밖은 끝값 */
export function tableAt(points, lv) {
  const p = [...points].sort((x, y) => x[0] - y[0]);
  if (!p.length) return 0;
  if (lv <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (lv <= p[i][0]) { const [l0, v0] = p[i - 1], [l1, v1] = p[i]; return v0 + (v1 - v0) * (lv - l0) / (l1 - l0); }
  }
  return p.at(-1)[1];
}

export function baseStat(def, sv, lv) {
  if (!sv) return 0;
  if (sv.table?.length) return tableAt(sv.table, lv);
  const b = sv.b ?? 0, g = sv.g ?? 0;
  return def.growth === 'geo' ? b * (1 + g / 100) ** (lv - 1) : b + g * (lv - 1);
}

const targets = (item, ent) => item.active !== false && (item.targets === 'all' || (Array.isArray(item.targets) && item.targets.includes(ent.id)));

/** 레벨 lv의 엔티티 스탯 (아이템 포함). 반환 { id: 값 } */
export function statsAt(cfg, ent, lv, items = cfg.items || []) {
  const out = {};
  for (const def of cfg.stats) {
    let flat = 0, pct = 0, mult = 1;
    for (const it of items) {
      if (!targets(it, ent)) continue;
      for (const m of it.mods || []) {
        if (m.stat !== def.id) continue;
        flat += m.flat || 0; pct += m.pct || 0; mult *= m.mult ?? 1;
      }
    }
    let v = (baseStat(def, ent.stats?.[def.id], lv) + flat) * (1 + pct / 100) * mult;
    if (Number.isFinite(def.min) && v < def.min) v = def.min;
    if (Number.isFinite(def.max) && v > def.max) v = def.max;
    out[def.id] = v;
  }
  return out;
}

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const rounder = (mode) => (mode === 'floor' ? Math.floor : mode === 'round' ? Math.round : (x) => x);

/** A가 B를 한 번 공격할 때의 결과 분포 */
export function attackProfile(cfg, f, sa, sb, lv) {
  const r = cfg.rules, rnd = rounder(r.round);
  const num = (x) => (Number.isFinite(x) ? x : 0);
  const hit = clamp(num(f.hit(sa, sb, lv)), r.hitMin, r.hitMax) / 100;
  const crit = clamp(num(f.critChance(sa, sb, lv)), 0, 100) / 100;
  const raw = Math.max(0, num(f.damage(sa, sb, lv)));
  const mult = Math.max(0, num(f.critMult(sa, sb, lv)));
  return { hit, crit, raw, mult, normal: Math.max(0, rnd(raw)), critical: Math.max(0, rnd(raw * mult)), speed: Math.max(0, num(f.speed(sa, lv))) };
}

/**
 * 쓰러뜨릴 때까지 공격 횟수 N의 분포 (정확해). maxN번까지만 — 남은 확률은 never(그 안에 못 쓰러뜨림).
 * 상태 = (일반 적중 수 j, 치명 수 k), 살아 있음 ⇔ j·d + k·dc < hp. 반환 { p: Float64Array(maxN + 1), never } 또는 계산량 초과면 null
 */
export function killDist(prof, hp, maxN, { maxWork = 4e7 } = {}) {
  const p = new Float64Array(maxN + 1);
  const d = prof.normal, dc = prof.critical;
  let qN = prof.hit * (1 - prof.crit), qC = prof.hit * prof.crit;
  if (!(hp > 0)) { p[1] = 1; return { p, never: 0 }; } // 체력 0 이하: 첫 공격에 쓰러짐
  // 데미지 0인 결과는 빗나감과 같다
  if (!(d > 0)) qN = 0;
  if (!(dc > 0)) qC = 0;
  const qM = 1 - qN - qC;
  if (qN + qC <= 0) return { p, never: 1 };
  const J = qN > 0 ? Math.ceil(hp / d) + 1 : 1, K = qC > 0 ? Math.ceil(hp / dc) + 1 : 1;
  if (J * K * maxN > maxWork) return null;
  const alive = (j, k) => (qN > 0 ? j * d : 0) + (qC > 0 ? k * dc : 0) < hp;
  // 행마다 살아 있는 k의 개수
  const kLen = new Int32Array(J);
  for (let j = 0; j < J; j++) { let k = 0; while (k < K && alive(j, k)) k++; kLen[j] = k; }
  let cur = new Float64Array(J * K), nxt = new Float64Array(J * K);
  cur[0] = 1;
  let mass = 1;
  for (let n = 1; n <= maxN; n++) {
    nxt.fill(0);
    let after = 0;
    for (let j = 0; j < J; j++) {
      const len = kLen[j];
      for (let k = 0; k < len; k++) {
        const v = cur[j * K + k];
        if (!v) continue;
        nxt[j * K + k] += v * qM;
        if (j + 1 < J && k < kLen[j + 1]) nxt[(j + 1) * K + k] += v * qN;
        if (k + 1 < len) nxt[j * K + k + 1] += v * qC;
      }
    }
    for (let j = 0; j < J; j++) for (let k = 0; k < kLen[j]; k++) after += nxt[j * K + k];
    p[n] = Math.max(0, mass - after);
    mass = after;
    [cur, nxt] = [nxt, cur];
    if (mass < 1e-14) { mass = 0; break; }
  }
  return { p, never: mass };
}

// 생존 함수 S(m) = P(N > m) (never 포함)
function survival(dist) {
  const S = new Float64Array(dist.p.length + 1);
  let acc = dist.never;
  for (let m = dist.p.length - 1; m >= 0; m--) { S[m] = acc + (m + 1 < dist.p.length ? dist.p[m + 1] : 0); acc = S[m]; }
  return (m) => (m < 0 ? 1 : m >= dist.p.length - 1 ? dist.never : S[m]);
}

/** 레벨 lv에서 두 엔티티의 전투 준비: 스탯, 공격 결과 분포, 체력 */
export function prepare(cfg, f, A, B, lv) {
  const sa = statsAt(cfg, A, lv), sb = statsAt(cfg, B, lv);
  return {
    sa, sb, lv,
    pa: attackProfile(cfg, f, sa, sb, lv), pb: attackProfile(cfg, f, sb, sa, lv),
    hpA: f.hp(sa, lv), hpB: f.hp(sb, lv),
  };
}

const maxAttacks = (cfg, speed) => (cfg.rules.mode === 'turn' ? cfg.rules.maxTurns : Math.floor(cfg.rules.maxTime * speed + 1e-9) + 1);

/**
 * 1:1 정확해. 데미지 변동·특성이 있거나 계산량이 너무 크면 null.
 * 반환 { winA, winB, draw, killA (A가 B를 쓰러뜨리는 공격 횟수 분포), killB, firstA (턴 방식의 A 선공 확률) }
 */
export function duelExact(cfg, f, A, B, lv, prep = prepare(cfg, f, A, B, lv)) {
  if ((A.variance || 0) > 0 || (B.variance || 0) > 0) return null;
  if (traitsOf(cfg, A).length || traitsOf(cfg, B).length) return null; // 특성이 있으면 공격 횟수가 서로 독립이 아님
  const { pa, pb } = prep;
  const r = cfg.rules;
  const mA = r.mode === 'turn' ? r.maxTurns : (pa.speed > 0 ? maxAttacks(cfg, pa.speed) : 0);
  const mB = r.mode === 'turn' ? r.maxTurns : (pb.speed > 0 ? maxAttacks(cfg, pb.speed) : 0);
  const dA = mA ? killDist(pa, prep.hpB, mA) : { p: new Float64Array(1), never: 1 };
  const dB = mB ? killDist(pb, prep.hpA, mB) : { p: new Float64Array(1), never: 1 };
  if (!dA || !dB) return null;
  const SA = survival(dA), SB = survival(dB);
  let winA = 0, winB = 0;
  if (r.mode === 'turn') {
    const tot = pa.speed + pb.speed, first = tot > 0 ? pa.speed / tot : 0.5;
    // A 선공: A의 n번째 공격이 B의 n번째보다 먼저 → N_B ≥ n이면 승. A 후공: N_B > n이어야 승
    for (let n = 1; n < dA.p.length; n++) if (dA.p[n]) winA += dA.p[n] * (first * SB(n - 1) + (1 - first) * SB(n));
    for (let n = 1; n < dB.p.length; n++) if (dB.p[n]) winB += dB.p[n] * ((1 - first) * SA(n - 1) + first * SA(n));
    return { winA, winB, draw: Math.max(0, 1 - winA - winB), killA: dA, killB: dB, firstA: first, prep };
  }
  // 시간 기반: A의 n번째 공격 시각 (n−1)/sA. 그 전에 B가 한 공격 수와 같은 시각 공격
  const side = (dX, sX, SY, sY) => {
    let win = 0, tie = 0;
    for (let n = 1; n < dX.p.length; n++) {
      const pn = dX.p[n];
      if (!pn) continue;
      if (!(sY > 0)) { win += pn; continue; }
      const x = (n - 1) * sY / sX, kInt = Math.round(x);
      if (Math.abs(x - kInt) < 1e-9 * Math.max(1, x)) { // 같은 시각에 상대의 (kInt+1)번째 공격
        win += pn * SY(kInt + 1);
        tie += pn * (SY(kInt) - SY(kInt + 1));
      } else win += pn * SY(Math.floor(x) + 1);
    }
    return { win, tie };
  };
  const a = side(dA, pa.speed, SB, pb.speed), b = side(dB, pb.speed, SA, pa.speed);
  // 같은 시각의 결정타는 양쪽에서 한 번씩 세었으므로 a.tie = b.tie
  const tie = a.tie;
  winA = a.win + (r.tie === 'coin' ? tie / 2 : 0);
  winB = b.win + (r.tie === 'coin' ? tie / 2 : 0);
  return { winA, winB, draw: Math.max(0, 1 - winA - winB), tie, killA: dA, killB: dB, prep };
}

/** 쓰러뜨리는 공격 횟수 분포 → 평균(쓰러뜨린 경우만), 평균 시간, 못 쓰러뜨릴 확률, 분위 함수 */
export function killStats(dist, speed, mode) {
  let m = 0, tot = 0;
  for (let n = 1; n < dist.p.length; n++) { m += n * dist.p[n]; tot += dist.p[n]; }
  const q = (pr) => { let c = 0; for (let n = 1; n < dist.p.length; n++) { c += dist.p[n]; if (c >= pr * tot - 1e-12) return n; } return Infinity; };
  const attacks = tot > 0 ? m / tot : Infinity;
  return { attacks, time: mode === 'turn' ? attacks : (speed > 0 ? (attacks - 1) / speed : Infinity), never: dist.never, q };
}

// ── 특성(트리거) ────────────────────────────────────────
// 특성 = { name, on: 발동 시점, chance: %, cond: null | { who: 'self'|'enemy', below: 체력 % }, max: 최대 발동(0 = 무제한),
//          effects: [{ type, who: 'self'|'enemy', value, base, stat, dur }] }
// 효과: 회복·추가 데미지(고정 / 이번 공격 데미지의 % / 대상 최대 체력의 %, 데미지 반올림 규칙을 그대로 적용 — Kalivra는 내림), 이번 공격 데미지 × 또는 +(공격 직전·피격 때만),
//       스탯 버프(고정 / 기본값의 %, 지속 = 시간 기반은 초, 턴 교대는 자기 공격 수, 0 = 끝까지)
// Kalivra와 다른 점: 효과는 발동 한 번에 한 번만 적용(Kalivra는 피격 스탯 버프를 두 번 적용), 확률은 발동마다 한 번만 굴림,
//                     쓰러뜨리는 공격 뒤에는 맞은 쪽 피격 효과가 나오지 않음(Kalivra는 피격 회복이 먼저 적용돼 버틸 수 있음)
export const TRIGGERS = {
  battleStart: '전투 시작', turn: '매 턴 (시간 기반은 매 1초)', beforeAttack: '공격 직전', attackHit: '공격 적중',
  critical: '치명타', miss: '공격 빗나감', evaded: '회피 성공', hitTaken: '피격',
};
export const EFFECTS = { heal: '회복', damage: '추가 데미지', dmgMult: '이번 공격 데미지 ×', dmgAdd: '이번 공격 데미지 +', buff: '스탯 버프' };
export const EFFECT_BASES = { fixed: '고정값', dmg: '이번 공격 데미지의 %', maxHp: '대상 최대 체력의 %', stat: '대상 기본 스탯의 %' };
const MOD_EFFECTS = new Set(['dmgMult', 'dmgAdd']);

/** 엔티티에 걸린 특성: 자기 특성 + 켜진 아이템 중 대상인 것의 특성 */
export function traitsOf(cfg, ent) {
  return [...(ent.traits || []), ...(cfg.items || []).filter(it => targets(it, ent)).flatMap(it => it.traits || [])].filter(t => t && t.on && t.effects?.length);
}

/** 특성 설정 확인 (경고 문장 배열) */
export function traitWarnings(cfg) {
  const out = [];
  const statIds = new Set(cfg.stats.map(s => s.id));
  const check = (owner, t) => {
    for (const e of t.effects || []) {
      if (MOD_EFFECTS.has(e.type) && t.on !== 'beforeAttack' && t.on !== 'hitTaken') out.push(`${owner} '${t.name}': '${EFFECTS[e.type]}'는 공격 직전·피격 때만 효과가 있습니다.`);
      if (e.type === 'buff' && !statIds.has(e.stat)) out.push(`${owner} '${t.name}': 버프할 스탯 '${e.stat ?? ''}'가 없습니다.`);
      if (e.base === 'dmg' && !['attackHit', 'critical', 'hitTaken'].includes(t.on)) out.push(`${owner} '${t.name}': '이번 공격 데미지의 %'는 공격 적중·치명타·피격 때만 값이 있습니다.`);
    }
  };
  for (const e of cfg.entities) for (const t of e.traits || []) check(e.name, t);
  for (const it of cfg.items || []) for (const t of it.traits || []) check(`아이템 ${it.name}`, t);
  return out;
}

// ── 전투 한 번 (특성·버프·데미지 변동 포함) ──────────────
function fighter(cfg, f, ent, lv) {
  const base = statsAt(cfg, ent, lv);
  const stats = { ...base };
  const hp = f.hp(stats, lv);
  return { ent, base, stats, hp, maxHp: hp, buffs: [], traits: traitsOf(cfg, ent), procs: new Map(), v: ent.variance || 0, n: 0, ver: 0, anchor: 0, k: 0, spd: null, next: 0, attacks: 0, hits: 0, crits: 0 };
}

/**
 * 전투 한 번. 반환 { w: 1 A 승 | 2 B 승 | 3 무승부, t: 길이(초 또는 턴), hpA, hpB(남은 비율), A, B(전투원), ev(로그) }
 * 같은 규칙으로 정확해와 맞춰 둔다: 특성·변동이 없으면 시간 기반 결정타 순서·동시 처리·턴 교대 순서가 duelExact와 같다.
 */
export function battleOnce(cfg, f, A0, B0, lv, rnd, log = false) {
  const r = cfg.rules, round = rounder(r.round), turn = r.mode === 'turn';
  const A = fighter(cfg, f, A0, lv), B = fighter(cfg, f, B0, lv);
  const other = (X) => (X === A ? B : A);
  const ev = log ? [] : null;
  let t = 0;
  const say = (type, X, text, val) => ev?.push({ t, who: X === A ? 'A' : X === B ? 'B' : '', type, text, val, hpA: Math.max(0, A.hp), hpB: Math.max(0, B.hp) });
  // 공격 결과 분포: 두 전투원의 스탯이 바뀌었을 때만 다시 계산
  const cache = new Map();
  const prof = (X, Y) => {
    const key = `${X === A ? 'A' : 'B'}${X.ver}:${Y.ver}`;
    let p = cache.get(key);
    if (!p) { p = attackProfile(cfg, f, X.stats, Y.stats, lv); cache.set(key, p); }
    return p;
  };
  const passes = (X, tr) => {
    const used = X.procs.get(tr) || 0;
    if (tr.max > 0 && used >= tr.max) return false;
    if (tr.cond?.below != null) { const T = tr.cond.who === 'enemy' ? other(X) : X; if (!(T.hp / T.maxHp * 100 <= tr.cond.below)) return false; }
    const ch = tr.chance ?? 100;
    if (ch < 100 && !(rnd() * 100 < ch)) return false;
    X.procs.set(tr, used + 1);
    return true;
  };
  const apply = (X, tr, e, ctx) => {
    const T = e.who === 'enemy' ? other(X) : X, v = Number(e.value) || 0;
    const amount = (target) => (e.base === 'dmg' ? (ctx?.dmg || 0) * v / 100 : e.base === 'maxHp' ? target.maxHp * v / 100 : v);
    switch (e.type) {
      case 'heal': { const a = Math.max(0, round(amount(T))); const before = T.hp; T.hp = Math.min(T.maxHp, T.hp + a); if (T.hp !== before) say('heal', T, `[${tr.name}] 체력 +${fmt(T.hp - before)}`, T.hp - before); break; }
      case 'damage': { const a = Math.max(0, round(amount(T))); if (a) { T.hp -= a; say('trait', X, `[${tr.name}] 추가 데미지 ${fmt(a)}`, a); } break; }
      case 'dmgMult': if (ctx?.mod) ctx.mult *= v; break;
      case 'dmgAdd': if (ctx?.mod) ctx.add += v; break;
      case 'buff': {
        if (!(e.stat in T.stats)) break;
        const delta = e.base === 'stat' ? T.base[e.stat] * v / 100 : v;
        T.stats[e.stat] += delta; T.ver++;
        const mh = f.hp(T.stats, lv); if (mh !== T.maxHp) { T.maxHp = mh; T.hp = Math.min(T.hp, mh); }
        if (e.dur > 0) T.buffs.push({ stat: e.stat, delta, until: turn ? T.n + e.dur : t + e.dur, name: tr.name });
        say('buff', T, `[${tr.name}] ${e.stat} ${delta >= 0 ? '+' : ''}${fmt(delta)}${e.dur > 0 ? ` (${e.dur}${turn ? '턴' : '초'})` : ''}`, delta);
        break;
      }
    }
  };
  const fire = (X, on, ctx, only) => {
    for (const tr of X.traits) {
      if (tr.on !== on || !passes(X, tr)) continue;
      for (const e of tr.effects) if (!only || only(e)) apply(X, tr, e, ctx);
    }
  };
  const expire = (X, now) => {
    if (!X.buffs.length) return;
    X.buffs = X.buffs.filter(b => {
      if (b.until > now + 1e-9) return true;
      X.stats[b.stat] -= b.delta; X.ver++;
      const mh = f.hp(X.stats, lv); if (mh !== X.maxHp) { X.maxHp = mh; X.hp = Math.min(X.hp, mh); }
      say('expire', X, `[${b.name}] 버프 끝 (${b.stat})`, 0);
      return false;
    });
  };
  const dead = () => A.hp <= 0 || B.hp <= 0;
  const attack = (X, Y) => {
    X.n++; X.attacks++;
    const ctx = { mult: 1, add: 0, dmg: 0, mod: true };
    fire(X, 'beforeAttack', ctx);
    const p = prof(X, Y);
    if (!(rnd() < p.hit)) { say('miss', X, '빗나감', 0); ctx.mod = false; fire(X, 'miss', ctx); fire(Y, 'evaded', ctx); return; }
    X.hits++;
    let raw = p.raw;
    if (X.v > 0) raw *= 1 + (rnd() * 2 - 1) * X.v;
    const crit = rnd() < p.crit;
    if (crit) X.crits++;
    // 피격 특성: 확률은 한 번만, 데미지 증감은 맞기 전에, 나머지는 맞은 뒤(살아 있으면)
    const taken = Y.traits.filter(tr => tr.on === 'hitTaken' && passes(Y, tr));
    for (const tr of taken) for (const e of tr.effects) if (MOD_EFFECTS.has(e.type)) apply(Y, tr, e, ctx);
    const dmg = Math.max(0, round(raw * (crit ? p.mult : 1) * ctx.mult + ctx.add));
    ctx.dmg = dmg; ctx.mod = false;
    Y.hp -= dmg;
    say(crit ? 'crit' : 'hit', X, crit ? `치명타 ${fmt(dmg)}` : `${fmt(dmg)}`, dmg);
    if (Y.hp <= 0) return;
    for (const tr of taken) for (const e of tr.effects) if (!MOD_EFFECTS.has(e.type)) apply(Y, tr, e, ctx);
    fire(X, 'attackHit', ctx);
    if (crit) fire(X, 'critical', ctx);
  };
  const result = (w) => ({ w, t, hpA: Math.max(0, A.hp) / A.maxHp, hpB: Math.max(0, B.hp) / B.maxHp, A, B, ev });
  const judge = () => {
    const da = A.hp <= 0, db = B.hp <= 0;
    if (da && db) { const w = r.tie === 'coin' || turn ? (rnd() < 0.5 ? 1 : 2) : 3; say('die', null, w === 3 ? '동시에 쓰러짐 — 무승부' : '동시에 쓰러짐 — 동전', 0); return result(w); }
    if (db) { say('die', B, '쓰러짐', 0); return result(1); }
    if (da) { say('die', A, '쓰러짐', 0); return result(2); }
    return null;
  };

  // 선공 확률(턴 교대)은 전투 시작 특성 전의 공격 속도로 (Kalivra와 같음)
  const sA0 = prof(A, B).speed, sB0 = prof(B, A).speed;
  fire(A, 'battleStart', null); fire(B, 'battleStart', null);
  if (dead()) return judge();
  const ticks = A.traits.some(x => x.on === 'turn') || B.traits.some(x => x.on === 'turn');

  if (turn) {
    const tot = sA0 + sB0;
    const aFirst = rnd() < (tot > 0 ? sA0 / tot : 0.5);
    const [P, Q] = aFirst ? [A, B] : [B, A];
    for (t = 1; t <= r.maxTurns; t++) {
      fire(P, 'turn', null); fire(Q, 'turn', null);
      if (dead()) return judge();
      attack(P, Q); expire(P, P.n);
      if (dead()) return judge();
      attack(Q, P); expire(Q, Q.n);
      if (dead()) return judge();
    }
    t = r.maxTurns;
    say('end', null, `${r.maxTurns}턴 — 무승부`, 0);
    return result(3);
  }

  // 시간 기반: X의 다음 공격 = 기준 시각 + k ÷ 공격 속도 (속도가 바뀌면 그 시각부터 다시 셈 — 일정하면 정확해와 같은 시각)
  const schedule = (X, Y) => {
    const s = prof(X, Y).speed;
    if (X.spd == null) { X.spd = s; X.anchor = 0; X.k = 0; }
    else if (s !== X.spd) { X.anchor = t; X.k = 1; X.spd = s; X.next = s > 0 ? t + 1 / s : Infinity; return; }
    else X.k++;
    X.next = X.spd > 0 ? X.anchor + X.k / X.spd : Infinity;
  };
  schedule(A, B); schedule(B, A);
  let nextTick = ticks ? 1 : Infinity;
  for (let guard = 0; guard < 1e6; guard++) {
    t = Math.min(A.next, B.next, nextTick);
    if (!(t <= r.maxTime + 1e-9)) break;
    expire(A, t); expire(B, t);
    if (Math.abs(t - nextTick) < 1e-9 * Math.max(1, t)) {
      fire(A, 'turn', null); fire(B, 'turn', null); nextTick += 1;
      if (dead()) return judge();
    }
    const ta = Math.abs(A.next - t) < 1e-9 * Math.max(1, t), tb = Math.abs(B.next - t) < 1e-9 * Math.max(1, t);
    // 같은 시각이면 둘 다 공격한 뒤 판정 (동시 결정타 = 동전 또는 무승부)
    if (ta) attack(A, B);
    if (tb) attack(B, A);
    if (ta) schedule(A, B);
    if (tb) schedule(B, A);
    if (dead()) return judge();
  }
  t = r.maxTime;
  say('end', null, `${r.maxTime}초 — 무승부`, 0);
  return result(3);
}
const fmt = (x) => (Number.isInteger(x) ? String(x) : (+x.toFixed(1)).toString());

// ── 시뮬레이션 (데미지 변동·특성 포함, 정확해 검증) ─────────
/** logs = 로그를 남길 전투 수 (앞에서부터) */
export function duelSim(cfg, f, A, B, lv, runs = 20000, seed = 20261018, prep = prepare(cfg, f, A, B, lv), { logs = 0 } = {}) {
  const rnd = mulberry32(seed);
  let wa = 0, wb = 0, dr = 0;
  const dur = new Float64Array(runs), hpLeft = [];
  const cnt = { attacks: 0, hits: 0, crits: 0 };
  const procs = { A: new Map(), B: new Map() };
  const logList = [];
  for (let i = 0; i < runs; i++) {
    const res = battleOnce(cfg, f, A, B, lv, rnd, i < logs);
    if (res.w === 1) { wa++; hpLeft.push(res.hpA); } else if (res.w === 2) wb++; else dr++;
    dur[i] = res.t;
    cnt.attacks += res.A.attacks; cnt.hits += res.A.hits; cnt.crits += res.A.crits;
    for (const [side, X] of [['A', res.A], ['B', res.B]]) for (const [tr, c] of X.procs) procs[side].set(tr.name, (procs[side].get(tr.name) || 0) + c);
    if (res.ev) logList.push({ w: res.w, t: res.t, ev: res.ev });
  }
  dur.sort();
  const per = (m) => [...m].map(([name, c]) => ({ name, perBattle: c / runs }));
  return {
    runs, winA: wa / runs, winB: wb / runs, draw: dr / runs,
    ciA: wilson(wa, runs), duration: dur, hpLeftA: Float64Array.from(hpLeft).sort(),
    realized: { hit: cnt.attacks ? cnt.hits / cnt.attacks : NaN, crit: cnt.hits ? cnt.crits / cnt.hits : NaN },
    procs: { A: per(procs.A), B: per(procs.B) }, logs: logList,
  };
}

/** 이항 비율의 Wilson 95% 신뢰 구간 */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n, z2 = z * z, den = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / den, half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / den;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

/** 1:1 결과: 정확해가 되면 정확해, 아니면 시뮬레이션 */
export function duel(cfg, f, A, B, lv, { runs = cfg.sim?.runs ?? 4000, seed } = {}) {
  const prep = prepare(cfg, f, A, B, lv);
  const ex = duelExact(cfg, f, A, B, lv, prep);
  if (ex) return { exact: true, winA: ex.winA, winB: ex.winB, draw: ex.draw, ci: null, ex, prep };
  const sm = duelSim(cfg, f, A, B, lv, runs, seed, prep);
  const reason = traitsOf(cfg, A).length || traitsOf(cfg, B).length ? '특성' : (A.variance || B.variance) ? '데미지 변동' : '계산량';
  return { exact: false, winA: sm.winA, winB: sm.winB, draw: sm.draw, ci: sm.ciA, sim: sm, prep, reason };
}

// ── 레벨 곡선 ───────────────────────────────────────────
export const METRICS = { cp: '전투력 (CP)', dps: '초당 기대 데미지', ttk: '처치 시간 (초)' };

/** 엔티티별 Lv1~maxLevel 값. dps·ttk는 기준 상대(같은 레벨)에 대한 값 — 변동 제외 기대값 */
export function curves(cfg, f, metric, refId) {
  const ref = cfg.entities.find(e => e.id === refId) ?? cfg.entities[0];
  const L = cfg.maxLevel;
  return cfg.entities.map(e => {
    const data = new Array(L);
    for (let lv = 1; lv <= L; lv++) {
      const s = statsAt(cfg, e, lv);
      if (metric === 'cp') { data[lv - 1] = f.cp(s, lv); continue; }
      const sr = statsAt(cfg, ref, lv);
      const pr = attackProfile(cfg, f, s, sr, lv);
      const perHit = pr.hit * ((1 - pr.crit) * pr.normal + pr.crit * pr.critical);
      if (metric === 'dps') { data[lv - 1] = perHit * pr.speed; continue; }
      const dist = killDist(pr, f.hp(sr, lv), Math.max(1, cfg.rules.mode === 'turn' ? cfg.rules.maxTurns : maxAttacks(cfg, pr.speed)));
      data[lv - 1] = dist && dist.never < 0.5 ? killStats(dist, pr.speed, cfg.rules.mode).time : (perHit > 0 && pr.speed > 0 ? f.hp(sr, lv) / (perHit * pr.speed) : Infinity);
    }
    return { id: e.id, name: e.name, data };
  });
}

/** 두 곡선이 교차하는 레벨 (Kalivra의 역전 감지와 같은 규칙: 차이의 부호가 바뀌는 곳) */
export function crossovers(series) {
  const out = [];
  for (let i = 0; i < series.length; i++) for (let j = i + 1; j < series.length; j++) {
    const a = series[i].data, b = series[j].data;
    let prev = a[0] - b[0];
    for (let k = 1; k < a.length; k++) {
      const d = a[k] - b[k];
      if (!Number.isFinite(d) || !Number.isFinite(prev)) { prev = d; continue; }
      if (prev * d < 0 || (prev === 0 && d !== 0 && k > 1)) {
        const up = d > 0 ? series[i] : series[j], down = d > 0 ? series[j] : series[i];
        out.push({ lv: k + 1, up: up.id, down: down.id, upName: up.name, downName: down.name });
      }
      prev = d;
    }
  }
  return out.sort((x, y) => x.lv - y.lv);
}

// ── 승률 행렬 ───────────────────────────────────────────
/** 레벨 lv의 모든 쌍. 한 쌍은 한 번만 계산 (B 대 A = A 대 B의 반대). cell[i][j] = { win, lose, draw, ci, exact } */
export function matrix(cfg, f, lv, opts = {}) {
  const E = cfg.entities, n = E.length;
  const cell = Array.from({ length: n }, () => new Array(n).fill(null));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = duel(cfg, f, E[i], E[j], lv, { ...opts, seed: (opts.seed ?? 20261018) + i * 7919 + j * 104729 });
    cell[i][j] = { win: d.winA, lose: d.winB, draw: d.draw, ci: d.ci, exact: d.exact, d };
    cell[j][i] = { win: d.winB, lose: d.winA, draw: d.draw, ci: d.ci && [1 - d.ci[1] - d.draw, 1 - d.ci[0] - d.draw], exact: d.exact, d, mirror: true };
  }
  // 엔티티별 점수 = 상대들에 대한 (승 + 무승부/2)의 평균
  const score = E.map((_, i) => { let s = 0, c = 0; for (let j = 0; j < n; j++) if (j !== i) { s += cell[i][j].win + cell[i][j].draw / 2; c++; } return c ? s / c : NaN; });
  return { lv, cell, score, allExact: cell.every((row, i) => row.every((c, j) => i === j || c.exact)) };
}

/** 순위 상관(스피어만, 동점은 평균 순위) */
export function spearman(x, y) {
  const rank = (v) => {
    const idx = v.map((val, i) => [val, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(v.length);
    for (let i = 0; i < idx.length;) {
      let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(x), ry = rank(y), n = x.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/**
 * CP와 실제 승률이 어긋나는 곳: CP가 높은데 진다(승 − 패가 기준 이상 음수). 정확해가 아니면 신뢰 구간이 50%를 걸치면 제외
 * 반환 { rho, pairs: [{ hi, lo, cpHi, cpLo, win, gap }] }
 */
export function cpVsWin(cfg, f, mx, margin = 0.05) {
  const E = cfg.entities, lv = mx.lv;
  const cp = E.map(e => f.cp(statsAt(cfg, e, lv), lv));
  const pairs = [];
  for (let i = 0; i < E.length; i++) for (let j = 0; j < E.length; j++) {
    if (i === j || !(cp[i] > cp[j])) continue;
    const c = mx.cell[i][j];
    const edge = c.win - c.lose;
    if (edge >= -margin * 2) continue;
    if (!c.exact && c.ci && c.ci[1] + c.draw / 2 >= 0.5) continue;
    pairs.push({ hi: E[i], lo: E[j], cpHi: cp[i], cpLo: cp[j], win: c.win, lose: c.lose, draw: c.draw, exact: c.exact });
  }
  pairs.sort((a, b) => (a.win - a.lose) - (b.win - b.lose));
  return { cp, rho: E.length >= 3 ? spearman(cp, mx.score) : NaN, pairs };
}

// 받침에 맞는 조사: 암살자가 / 전사가 / 궁수를 (한글이 아니면 '이(가)')
export function josa(w, withBatchim, without) {
  const c = String(w).trim().slice(-1).charCodeAt(0);
  if (!(c >= 0xac00 && c <= 0xd7a3)) return `${w}${withBatchim}(${without})`;
  return w + ((c - 0xac00) % 28 ? withBatchim : without);
}

/** 검증 문장 */
export function findings(cfg, f, mx, cv, cross) {
  const out = [];
  const E = cfg.entities, pct = (x) => `${(x * 100).toFixed(1)}%`;
  for (const p of cv.pairs) out.push({ level: 'serious', kind: 'cpInversion', text: `Lv${mx.lv}: ${p.hi.name}의 CP(${Math.round(p.cpHi).toLocaleString('ko-KR')})가 ${p.lo.name}(${Math.round(p.cpLo).toLocaleString('ko-KR')})보다 높지만 1:1 승률은 ${pct(p.win)}${p.draw > 0.005 ? ` (무승부 ${pct(p.draw)})` : ''} — CP 수식이 이 상성을 반영하지 못합니다.` });
  if (Number.isFinite(cv.rho) && cv.rho < 0.5) out.push({ level: 'warn', kind: 'rho', text: `Lv${mx.lv}: CP 순위와 실제 강함(평균 승률) 순위의 상관이 ${cv.rho.toFixed(2)}입니다. 1에 가까울수록 CP가 실제 전투력을 잘 나타냅니다.` });
  E.forEach((e, i) => {
    const row = mx.cell[i].filter((_, j) => j !== i);
    if (row.length >= 2 && row.every(c => c.win >= 0.55 && (c.exact || (c.ci && c.ci[0] > 0.5)))) out.push({ level: 'serious', kind: 'dominant', text: `Lv${mx.lv}: ${josa(e.name, '이', '가')} 모든 상대에게 55% 이상 이깁니다 (최저 ${pct(Math.min(...row.map(c => c.win)))}).` });
  });
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
    const c = mx.cell[i][j];
    if (c.draw >= 0.2) out.push({ level: 'warn', kind: 'draw', text: `Lv${mx.lv}: ${E[i].name} 대 ${E[j].name} — ${pct(c.draw)}가 ${cfg.rules.mode === 'turn' ? `${cfg.rules.maxTurns}턴` : `${cfg.rules.maxTime}초`} 안에 끝나지 않습니다 (무승부).` });
    const ex = c.d.ex;
    if (ex) for (const [x, y, dist] of [[E[i], E[j], ex.killA], [E[j], E[i], ex.killB]]) if (dist.p[1] >= 0.5) out.push({ level: 'warn', kind: 'oneShot', text: `Lv${mx.lv}: ${josa(x.name, '이', '가')} ${josa(y.name, '을', '를')} 첫 공격에 쓰러뜨릴 확률이 ${pct(dist.p[1])}입니다.` });
  }
  for (const c of cycles(cfg, mx).slice(0, 3)) out.push({ level: 'info', kind: 'cycle', text: `Lv${mx.lv}: 상성 순환 ${c.names.map((x, m) => `${x} > ${c.names[(m + 1) % 3]} ${(c.wins[m] * 100).toFixed(0)}%`).join(', ')} — 의도한 가위바위보 구조인지 확인하세요.` });
  if (cross.length) out.push({ level: 'info', kind: 'cross', text: `역전 레벨 ${cross.length}곳: ${cross.slice(0, 6).map(c => `Lv${c.lv} ${c.upName} > ${c.downName}`).join(', ')}${cross.length > 6 ? ' …' : ''}` });
  const order = { serious: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}


// ── 구간 리포트 (레벨 구간별 평균 승률) ────────────────────
/** 구간 경계 → [{ from, to }]. 경계를 안 정하면 최대 레벨의 1/3, 2/3 */
export function phaseRanges(cfg) {
  const L = cfg.maxLevel;
  const raw = cfg.phases?.length ? cfg.phases : [Math.round(L / 3), Math.round(2 * L / 3)];
  const cuts = [...new Set(raw.map(Math.round).filter(x => x >= 1 && x < L))].sort((a, b) => a - b);
  const out = [];
  let from = 1;
  for (const c of cuts) { out.push({ from, to: c }); from = c + 1; }
  out.push({ from, to: L });
  return out.filter(p => p.from <= p.to);
}

/** 레벨 훑기 계획: 시뮬레이션이 필요한 쌍은 예산(전투 수) 안에서 반복 수를 줄이고, 그래도 넘으면 레벨을 건너뛴다 */
export function sweepPlan(cfg, { budget = 6e4 } = {}) {
  const E = cfg.entities, n = E.length, L = cfg.maxLevel;
  const needsSim = (a, b) => (a.variance || 0) > 0 || (b.variance || 0) > 0 || traitsOf(cfg, a).length > 0 || traitsOf(cfg, b).length > 0;
  let simPairs = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (needsSim(E[i], E[j])) simPairs++;
  const maxRuns = cfg.sim?.runs ?? 4000;
  const runs = simPairs ? Math.min(maxRuns, Math.max(100, Math.floor(budget / (L * simPairs)))) : 0;
  const stride = simPairs ? Math.max(1, Math.ceil(L * simPairs * runs / budget)) : 1;
  const levels = [];
  for (let lv = 1; lv <= L; lv += stride) levels.push(lv);
  if (levels.at(-1) !== L) levels.push(L);
  return { levels, runs, stride, exact: simPairs === 0 };
}

/** 한 레벨의 승률·무승부 행렬과 엔티티 점수 */
export function sweepAt(cfg, f, lv, runs) {
  const E = cfg.entities, n = E.length;
  const W = Array.from({ length: n }, () => new Array(n).fill(null)), D = Array.from({ length: n }, () => new Array(n).fill(null));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = duel(cfg, f, E[i], E[j], lv, { runs, seed: 4242 + lv * 131 + i * 7 + j });
    W[i][j] = d.winA; W[j][i] = d.winB; D[i][j] = D[j][i] = d.draw;
  }
  const score = E.map((_, i) => { let s = 0, c = 0; for (let j = 0; j < n; j++) if (j !== i) { s += W[i][j] + D[i][j] / 2; c++; } return c ? s / c : NaN; });
  return { win: W, draw: D, score };
}

/** 레벨마다 승률 행렬 (한 번에). 화면은 sweepPlan + sweepAt을 레벨마다 나눠 돌린다 */
export function levelSweep(cfg, f, opts) {
  const plan = sweepPlan(cfg, opts);
  const win = [], draw = [], score = [];
  for (const lv of plan.levels) { const r = sweepAt(cfg, f, lv, plan.runs); win.push(r.win); draw.push(r.draw); score.push(r.score); }
  return { ...plan, win, draw, score };
}

/** 구간별 평균 점수·평균 승률, 1위, 지배(구간 평균으로 모든 상대에게 55% 이상) + 검증 문장 */
export function phaseReport(cfg, sweep) {
  const E = cfg.entities, n = E.length;
  const phases = phaseRanges(cfg).map(p => {
    const idx = sweep.levels.map((lv, k) => [lv, k]).filter(([lv]) => lv >= p.from && lv <= p.to).map(([, k]) => k);
    const avg = (get) => (idx.length ? idx.reduce((a, k) => a + get(k), 0) / idx.length : NaN);
    const score = E.map((_, i) => avg(k => sweep.score[k][i]));
    const win = E.map((_, i) => E.map((_, j) => (i === j ? null : avg(k => sweep.win[k][i][j]))));
    const best = score.reduce((b, s, i) => (s > score[b] ? i : b), 0);
    const dominant = n >= 2 ? E.map((_, i) => i).filter(i => win[i].every((w, j) => j === i || w >= 0.55)) : [];
    return { ...p, levels: idx.length, score, win, best, dominant };
  });
  const findings = [];
  for (const p of phases) for (const i of p.dominant) {
    const lows = p.win[i].filter((w, j) => j !== i);
    findings.push({ level: 'serious', kind: 'phaseDominant', text: `Lv${p.from}~${p.to}: ${josa(E[i].name, '이', '가')} 구간 평균으로 모든 상대에게 55% 이상 이깁니다 (최저 ${(Math.min(...lows) * 100).toFixed(1)}%).` });
  }
  // 1위가 2위보다 5%p 이상 앞설 때만 '같은 1위'로 본다 (동률이면 1위가 없음)
  const clearLead = (p) => { const s = [...p.score].sort((a, b) => b - a); return s[0] - (s[1] ?? -Infinity) >= 0.05; };
  if (phases.length >= 2 && n >= 2 && phases.every(p => p.best === phases[0].best && clearLead(p))) findings.push({ level: 'warn', kind: 'sameLeader', text: `모든 구간에서 ${josa(E[phases[0].best].name, '이', '가')} 1위입니다 — 레벨 구간에 따라 강자가 바뀌는 구조가 없습니다.` });
  E.forEach((e, i) => {
    const s = phases.map(p => p.score[i]);
    const span = Math.max(...s) - Math.min(...s);
    if (phases.length >= 2 && span >= 0.25) findings.push({ level: 'info', kind: 'swing', text: `${e.name}: 구간 평균 승률이 ${phases.map(p => `${(p.score[i] * 100).toFixed(0)}%`).join(' → ')}로 ${(span * 100).toFixed(0)}%p 바뀝니다 (의도한 초반형·후반형인지 확인).` });
  });
  const order = { serious: 0, warn: 1, info: 2 };
  return { phases, findings: findings.sort((a, b) => order[a.level] - order[b.level]) };
}

/** 상성 순환: A가 B를, B가 C를, C가 A를 55% 이상 이기는 세 엔티티 (시뮬레이션이면 구간이 50%를 넘을 때만) */
export function cycles(cfg, mx) {
  const E = cfg.entities, n = E.length, out = [];
  const beats = (i, j) => { const c = mx.cell[i][j]; return c && c.win >= 0.55 && (c.exact || c.ci[0] > 0.5); };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    if (i >= j || i >= k || j === k) continue; // i가 가장 작은 번호인 순환만 (중복 제거)
    if (beats(i, j) && beats(j, k) && beats(k, i)) out.push([i, j, k]);
  }
  return out.map(c => ({ ids: c, names: c.map(x => E[x].name), wins: c.map((x, m) => mx.cell[x][c[(m + 1) % 3]].win) }));
}


// ── 밸런스 도구: 목표 역산, 민감도, 최소 변경, 효과 분해 ─────────
// 결과 지표 '점수' = 승 + 무승부 ÷ 2 (한 상대 또는 모든 상대 평균). 정확해가 되는 쌍은 정확해, 아니면 같은 시드의 시뮬레이션
// (같은 시드 = 같은 난수열이라 설정을 조금 바꿔도 잡음 차이가 작다).
// 스탯 '배율'은 그 스탯 전체(기본값·성장값·표)를 k배 — 숨은 아이템 수정자 ×k로 계산하고, 적용할 때는 b·g·표 값을 k배.

const SCALE_ID = '__scale__';
/** 엔티티 entId의 스탯 stat을 k배 한 설정 (원본은 그대로) */
export function withScale(cfg, entId, stat, k) {
  return { ...cfg, items: [...(cfg.items || []), { id: `${SCALE_ID}${entId}.${stat}`, name: '', active: true, targets: [entId], mods: [{ stat, mult: k }] }] };
}
/** 엔티티의 스탯 값(기본·성장 또는 표) 하나를 바꾼 설정 */
export function withParam(cfg, entId, stat, part, v) {
  return { ...cfg, entities: cfg.entities.map(e => (e.id !== entId ? e : { ...e, stats: { ...e.stats, [stat]: { ...(e.stats[stat] || {}), [part]: v } } })) };
}

/** 점수: A의 (승 + 무/2). bId = 'all'이면 모든 상대 평균 */
export function scoreOf(cfg, f, aId, bId, lv, { runs = Math.max(500, Math.round((cfg.sim?.runs ?? 4000) / 2)) } = {}) {
  const A = cfg.entities.find(e => e.id === aId);
  const opp = bId === 'all' ? cfg.entities.filter(e => e.id !== aId) : cfg.entities.filter(e => e.id === bId);
  if (!A || !opp.length) return { score: NaN, exact: true };
  let s = 0, exact = true;
  for (const B of opp) {
    const d = duel(cfg, f, A, B, lv, { runs, seed: 9090 });
    s += d.winA + d.draw / 2; exact &&= d.exact;
  }
  return { score: s / opp.length, exact };
}

/** 단조 함수 g(x)가 target을 지나는 x (로그 축 이분 탐색, x > 0). 반환 { x, value, feasible, increasing } */
function solveLog(g, target, { lo = 1 / 64, hi = 64, iters = 40 } = {}) {
  const v1 = g(1), vlo = g(lo), vhi = g(hi);
  const increasing = vhi >= vlo;
  const reach = increasing ? (target >= vlo && target <= vhi) : (target <= vlo && target >= vhi);
  if (!reach) return { x: increasing === (target > v1) ? hi : lo, value: increasing === (target > v1) ? vhi : vlo, feasible: false, increasing };
  let a = Math.log(lo), b = Math.log(hi);
  // a 쪽은 target 아래(증가 함수 기준), b 쪽은 target 이상
  for (let k = 0; k < iters; k++) {
    const m = (a + b) / 2, v = g(Math.exp(m));
    if ((increasing && v >= target) || (!increasing && v <= target)) b = m; else a = m;
  }
  return { x: Math.exp(b), value: g(Math.exp(b)), below: g(Math.exp(a)), feasible: true, increasing };
}

/**
 * 스탯 하나를 k배 해서 점수를 target으로: 반환 { k, value(도달 점수), below(바로 아래 k의 점수), feasible }
 * 정확해도 데미지 반올림·공격 횟수가 정수라 점수는 계단 모양 — target을 처음 넘는 k와 그때의 점수를 돌려준다
 */
export function solveScale(cfg, f, { a, b, lv, stat, target, side = a, runs }) {
  const g = (k) => scoreOf(withScale(cfg, side, stat, k), f, a, b, lv, { runs }).score;
  const r = solveLog(g, target, { iters: runs ? 22 : 40 });
  return { stat, side, k: r.x, value: r.value, below: r.below, feasible: r.feasible, increasing: r.increasing };
}

/** 지표 값: 점수 / CP / 초당 데미지(상대 대비) */
function metricOf(cfg, f, { metric, entity, opponent, lv, runs }) {
  const E = cfg.entities.find(e => e.id === entity);
  if (metric === 'score') return scoreOf(cfg, f, entity, opponent, lv, { runs }).score;
  const s = statsAt(cfg, E, lv);
  if (metric === 'cp') return f.cp(s, lv);
  const B = cfg.entities.find(e => e.id === (opponent === 'all' ? cfg.entities.find(x => x.id !== entity)?.id : opponent)) ?? E;
  const pr = attackProfile(cfg, f, s, statsAt(cfg, B, lv), lv);
  return pr.speed * pr.hit * ((1 - pr.crit) * pr.normal + pr.crit * pr.critical);
}

/**
 * 목표 역산: 엔티티의 한 스탯 값(part = 'b' 기본값 / 'g' 성장값 / 'scale' 전체 배율)을 바꿔 지표를 target으로.
 * Kalivra의 "Lv20 CP = 1000 → 성장값"을 승률 목표("Lv20 A 대 B 점수 50%")까지 넓힌 것. 반환 { value, achieved, feasible, from }
 */
export function solveTarget(cfg, f, { metric = 'score', entity, opponent = 'all', lv, stat, part = 'g', target, runs }) {
  const ent = cfg.entities.find(e => e.id === entity);
  const sv = ent?.stats?.[stat] ?? {};
  const g = part === 'scale'
    ? (k) => metricOf(withScale(cfg, entity, stat, k), f, { metric, entity, opponent, lv, runs })
    : (v) => metricOf(withParam(cfg, entity, stat, part, v), f, { metric, entity, opponent, lv, runs });
  if (part === 'scale') {
    const r = solveLog(g, target, { iters: metric === 'score' && runs ? 22 : 50 });
    return { part, from: 1, value: r.x, achieved: r.value, feasible: r.feasible };
  }
  if (sv.table && part !== 'scale') return { part, feasible: false, reason: '표로 넣은 스탯은 배율로 역산하세요.' };
  // 선형 탐색 구간을 넓혀 target을 감싼 뒤 이분 탐색
  const x0 = sv[part] ?? 0;
  let step = Math.max(Math.abs(x0), part === 'g' ? 1 : 10), lo = x0, hi = x0;
  const v0 = g(x0);
  let up = g(x0 + step) >= v0; // 값을 올리면 지표가 오르나
  if (g(x0 + step) === v0 && g(x0 - step) === v0) up = true;
  const wantUp = target > v0;
  const dir = up === wantUp ? 1 : -1;
  let found = false;
  for (let k = 0; k < 40; k++) {
    const x = x0 + dir * step * 2 ** k;
    const v = g(x);
    if ((wantUp && v >= target) || (!wantUp && v <= target)) { lo = x0 + dir * step * (k ? 2 ** (k - 1) : 0); hi = x; found = true; break; }
  }
  if (!found) return { part, from: x0, feasible: false, reason: '이 스탯만으로는 목표에 닿지 않습니다.' };
  for (let k = 0; k < (metric === 'score' && runs ? 24 : 60); k++) {
    const m = (lo + hi) / 2, v = g(m);
    if ((wantUp && v >= target) || (!wantUp && v <= target)) hi = m; else lo = m;
  }
  return { part, from: x0, value: hi, achieved: g(hi), feasible: true };
}

/**
 * 민감도: A와 상대 B(한 명일 때)의 스탯마다 ±pct% → A 점수 변화 (%p). 레벨 lv의 스탯 값이 0인 것은 건너뜀
 * 반환 rows [{ side, stat, lo, hi, swing }] (swing = 두 쪽 중 큰 |변화|, 큰 순)
 */
export function battleSensitivity(cfg, f, { a, b, lv, pct = 10, runs }) {
  const base = scoreOf(cfg, f, a, b, lv, { runs }).score, p = pct / 100;
  const rows = [];
  const sides = b === 'all' ? [a] : [a, b];
  for (const side of sides) {
    const E = cfg.entities.find(e => e.id === side), s = statsAt(cfg, E, lv);
    for (const def of cfg.stats) {
      if (!(Math.abs(s[def.id]) > 0)) continue;
      const lo = scoreOf(withScale(cfg, side, def.id, 1 - p), f, a, b, lv, { runs }).score - base;
      const hi = scoreOf(withScale(cfg, side, def.id, 1 + p), f, a, b, lv, { runs }).score - base;
      const swing = Math.max(Math.abs(lo), Math.abs(hi));
      if (swing > 1e-9) rows.push({ side, stat: def.id, value: s[def.id], lo, hi, swing });
    }
  }
  rows.sort((x, y) => y.swing - x.swing);
  return { base, pct, rows };
}

/** 점수를 target으로 만드는 스탯별 최소 배율 (A의 스탯). 필요한 변화가 작은 순 */
export function minChanges(cfg, f, { a, b, lv, target = 0.5, runs }) {
  const E = cfg.entities.find(e => e.id === a), s = statsAt(cfg, E, lv);
  const rows = cfg.stats.filter(d => Math.abs(s[d.id]) > 0).map(d => ({ ...solveScale(cfg, f, { a, b, lv, stat: d.id, target, runs }), value0: s[d.id] }));
  rows.sort((x, y) => (x.feasible === y.feasible ? (x.feasible ? Math.abs(Math.log(x.k)) - Math.abs(Math.log(y.k)) : 0) : x.feasible ? -1 : 1));
  return rows;
}

/**
 * 효과 분해: A에게 걸린 아이템·A의 특성(그리고 상대 하나일 때 상대의 것)을 하나씩 끄면 A 점수가 얼마나 바뀌나.
 * 반환 [{ kind: 'item'|'trait', owner, name, delta (= 있을 때 − 없을 때, A 기준 %p) }]
 */
export function contributions(cfg, f, { a, b, lv, runs }) {
  const base = scoreOf(cfg, f, a, b, lv, { runs }).score;
  const out = [];
  const owners = b === 'all' ? [a] : [a, b];
  for (const oid of owners) {
    const E = cfg.entities.find(e => e.id === oid);
    for (const it of (cfg.items || []).filter(it => it.active !== false && (it.targets === 'all' || it.targets?.includes(oid)))) {
      const c2 = { ...cfg, items: cfg.items.map(x => (x === it ? (it.targets === 'all' ? { ...it, targets: cfg.entities.map(e => e.id).filter(id => id !== oid) } : { ...it, targets: it.targets.filter(t => t !== oid) }) : x)) };
      out.push({ kind: 'item', owner: oid, ownerName: E.name, name: it.name, delta: base - scoreOf(c2, f, a, b, lv, { runs }).score });
    }
    (E.traits || []).forEach((tr, ti) => {
      const c2 = { ...cfg, entities: cfg.entities.map(e => (e.id !== oid ? e : { ...e, traits: e.traits.filter((_, k) => k !== ti) })) };
      out.push({ kind: 'trait', owner: oid, ownerName: E.name, name: tr.name, delta: base - scoreOf(c2, f, a, b, lv, { runs }).score });
    });
  }
  out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return { base, rows: out };
}

/** 배율 k를 실제 설정에 적용: b·g(선형)·b(등비)·표 값을 k배 */
export function applyScale(ent, def, k) {
  const sv = ent.stats[def.id] ??= { b: 0, g: 0 };
  const r = (x) => +(x * k).toPrecision(6);
  if (sv.table) sv.table = sv.table.map(([l, v]) => [l, r(v)]);
  else { sv.b = r(sv.b ?? 0); if (def.growth !== 'geo') sv.g = r(sv.g ?? 0); }
}

/** 전체 분석 */
export function analyze(cfg) {
  const errors = validate(cfg);
  if (errors.length) return { ok: false, errors, formulaErrors: {} };
  const comp = compileRules(cfg);
  if (!comp.ok) return { ok: false, errors: Object.entries(comp.errors).map(([k, m]) => `${FORMULA_KEYS[k][0]} 수식: ${m}`), formulaErrors: comp.errors };
  const f = comp.f;
  const lv = Math.min(Math.max(1, cfg.level || 1), cfg.maxLevel);
  const series = curves(cfg, f, cfg.metric || 'cp', cfg.ref);
  const cross = crossovers(series);
  const mx = matrix(cfg, f, lv, { runs: cfg.sim?.runs });
  const cv = cpVsWin(cfg, f, mx);
  const tw = traitWarnings(cfg).map(text => ({ level: 'warn', kind: 'trait', text }));
  return { ok: true, f, lv, series, cross, mx, cv, findings: [...tw, ...findings(cfg, f, mx, cv, cross)], formulaErrors: {} };
}

// ── Kalivra 프로젝트(.kal / JSON) 가져오기 ──────────────────
// Kalivra 트리거 이름 → 발동 시점 (Kalivra의 normalizeString과 같은 규칙: 소문자·공백 제거 후 포함 여부)
function kalOn(type) {
  const s = String(type || '').toLowerCase().replace(/\s+/g, '');
  if (s.includes('onhittaken') || s.includes('ondamagetaken') || s.includes('피격')) return 'hitTaken';
  if (s.includes('onattackhit') || s.includes('적중')) return 'attackHit';
  if (s.includes('onbeforeattack') || s.includes('공격전')) return 'beforeAttack';
  if (s.includes('onmiss') || s.includes('빗나감')) return 'miss';
  if (s.includes('onevasion') || s.includes('회피')) return 'evaded';
  if (s.includes('oncritical') || s.includes('치명타')) return 'critical';
  if (s.includes('onturnstart') || s.includes('onturnend')) return 'turn';
  if (s.includes('onbattlestart')) return 'battleStart';
  return null;
}
/** Kalivra 특성 하나(트리거 여러 개) → 이 탭의 특성 배열 */
function kalTraits(t, notes) {
  const out = [];
  for (const trig of t?.triggers || []) {
    let on = kalOn(trig.type);
    if (!on) { notes.add(`'${t.name}'의 트리거 '${trig.type}'는 알 수 없어 뺐습니다.`); continue; }
    if (/onturnend/i.test(String(trig.type).replace(/\s+/g, ''))) notes.add(`'${t.name}': 턴 끝(OnTurnEnd)은 '매 턴'(턴 시작)으로 가져왔습니다.`);
    let chance = 100, cond = null;
    for (const c of trig.conditions || []) {
      const ty = String(c.type || '').toLowerCase().replace(/\s+/g, '');
      if (ty.includes('chance')) chance = chance * (Number(c.value) || 0) / 100;
      else if (ty.includes('hp') && ty.includes('less')) cond = { who: c.target === 'Self' ? 'self' : 'enemy', below: Number(c.value) || 0 };
      else if (ty.includes('iscritical')) { if (on === 'attackHit') on = 'critical'; else notes.add(`'${t.name}': 치명타 조건은 공격 적중 트리거에서만 가져옵니다.`); }
    }
    const effects = [];
    for (const e of trig.effects || []) {
      const ty = String(e.type || '').toLowerCase().replace(/\s+/g, '');
      const who = e.target === 'Self' ? 'self' : 'enemy';
      const pctDmg = /percent|%/i.test(String(e.valueType || ''));
      const v = Number(e.value) || 0;
      if (ty.includes('heal')) effects.push({ type: 'heal', who, value: v, base: pctDmg ? 'dmg' : 'fixed' });
      else if (ty.includes('dealdamage')) effects.push({ type: 'damage', who, value: v, base: pctDmg ? 'dmg' : 'fixed' });
      else if (ty.includes('modifydamage')) effects.push(e.op === 'add' ? { type: 'dmgAdd', who: 'self', value: v } : { type: 'dmgMult', who: 'self', value: v });
      else if (ty.includes('buff')) effects.push({ type: 'buff', who, stat: e.stat, value: v, base: 'fixed', dur: Number(e.duration) || 0 });
      else notes.add(`'${t.name}'의 효과 '${e.type}'는 알 수 없어 뺐습니다.`);
    }
    if (effects.some(e => e.type === 'buff' && e.dur > 0) && on !== 'beforeAttack' && on !== 'attackHit' && on !== 'critical') notes.add(`'${t.name}': 버프 지속은 자기 공격 수로 셉니다 — 상대 행동에서 걸린 버프는 Kalivra보다 1회 짧습니다.`);
    if (effects.length) out.push({ name: String(t.name || '특성'), on, chance: +chance.toFixed(6), cond, max: 0, effects });
  }
  return out;
}

const KAL_NAMES = { hp: '체력', atk: '공격력', def: '방어력', acc: '명중', eva: '회피', cric: '치명 확률(%)', crid: '치명 배율', aspd: '공격 속도' };

/**
 * Kalivra 프로젝트 → 이 탭의 설정. 반환 { cfg, notes: [가져오면서 바뀌거나 빠진 것] }
 * 형식: { current: { entities, items, gameRules } } (v1.0.1 이후) 또는 { entities, items, gameRules|rules } (이전)
 */
export function fromKalivra(doc, base) {
  const cur = doc?.current ?? doc;
  if (!cur || !Array.isArray(cur.entities)) throw new Error('Kalivra 프로젝트 형식이 아닙니다 (entities가 없음).');
  const rules = cur.gameRules ?? cur.rules ?? {};
  const statIds = Array.isArray(rules.stats) && rules.stats.length ? rules.stats : ['hp', 'atk', 'def', 'acc', 'eva', 'cric', 'crid', 'aspd'];
  const notes = [];
  const idMap = new Map();
  const entities = cur.entities.map((e, i) => {
    const id = `e${i + 1}`;
    idMap.set(e.id, id);
    const traits = (e.traits || []).flatMap(t => kalTraits(t, tnotes));
    return {
      id, name: String(e.name ?? `엔티티 ${i + 1}`), traits, color: typeof e.color === 'string' ? e.color : null,
      variance: Math.max(0, Math.min(0.99, Number(e.variance) || 0)),
      stats: Object.fromEntries(statIds.map(s => [s, { b: Number(e.stats?.[s]?.b) || 0, g: Number(e.stats?.[s]?.g) || 0 }])),
    };
  });
  const items = [];
  const tnotes = new Set();
  let orderDependent = new Set();
  (cur.items || []).forEach((it, i) => {
    const mods = (it.modifiers || []).filter(m => statIds.includes(m.stat)).map(m => (m.op === 'mult' ? { stat: m.stat, mult: Number(m.val) } : { stat: m.stat, flat: Number(m.val) || 0 }));
    const tg = (it.targets || []).map(t => idMap.get(t)).filter(Boolean);
    items.push({ id: `i${i + 1}`, name: String(it.name ?? `아이템 ${i + 1}`), active: it.active !== false, targets: tg, mods, traits: (it.traits || []).flatMap(t => kalTraits(t, tnotes)) });
  });
  // 같은 엔티티·스탯에 고정(add)과 배율(mult)이 함께 걸리면 Kalivra는 아이템 순서대로 계산 → 결과가 다를 수 있음
  for (const e of entities) for (const s of statIds) {
    const ms = items.filter(it => it.active && it.targets.includes(e.id)).flatMap(it => it.mods.filter(m => m.stat === s));
    if (ms.some(m => m.flat) && ms.some(m => m.mult != null)) orderDependent.add(`${e.name}.${s}`);
  }
  const nTraits = entities.reduce((a, e) => a + e.traits.length, 0) + items.reduce((a, it) => a + it.traits.length, 0);
  if (nTraits) notes.push(`특성 ${nTraits}개를 가져왔습니다. 효과는 발동 한 번에 한 번만 적용합니다 (Kalivra는 피격 스탯 버프를 두 번 적용).`);
  notes.push(...tnotes);
  if (orderDependent.size) notes.push(`고정+와 배율이 함께 걸린 스탯(${[...orderDependent].slice(0, 4).join(', ')}${orderDependent.size > 4 ? ' …' : ''})은 여기서는 (값 + 고정) × 배율로 계산합니다. Kalivra는 아이템 순서대로 계산해 값이 다를 수 있습니다.`);
  const has = (s) => statIds.includes(s);
  const dmg = String(rules.dmgFormula || 'a.atk');
  const cfg = {
    ...base,
    stats: statIds.map(id => ({ id, name: KAL_NAMES[id] ?? (rules.descriptions?.[id] || id), growth: 'linear', ...(id === 'cric' ? { min: 0, max: 100 } : {}) })),
    entities, items,
    rules: {
      ...base.rules,
      damage: dmg, hit: String(rules.hitFormula || '(a.acc - b.eva)'),
      critChance: has('cric') ? 'a.cric' : (has('cri') ? 'a.cri' : '0'), critMult: has('crid') ? 'a.crid' : '1.5',
      speed: has('aspd') ? 'aspd' : '1', hp: has('hp') ? 'hp' : '100', cp: String(rules.cpFormula || '0'),
      mode: 'turn', maxTurns: 200, hitMin: 5, hitMax: 100, round: 'floor', tie: 'coin',
    },
    ref: entities[0]?.id,
  };
  const comp = compileRules(cfg);
  if (comp.errors.damage && statIds.some(s => new RegExp(`(^|[^.\\w])${s}\\b`).test(dmg))) notes.push(`데미지 수식 '${dmg}'에 a./b. 접두어가 없습니다. Kalivra에서는 이 수식이 오류로 0이 되어 모든 전투가 무승부로 끝납니다 (Kalivra 기본 샘플이 이 경우). 여기서는 오류로 표시하니 a.atk, b.def처럼 고치세요.`);
  notes.push('가져온 설정은 Kalivra와 같은 턴 교대 방식(최대 200턴, 명중 5~100%, 데미지 내림)입니다. 공격 속도를 공격 횟수로 반영하려면 "시간 기반"으로 바꾸세요.');
  return { cfg, notes };
}
