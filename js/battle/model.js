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
//   N_A와 N_B는 서로 독립(트리거·버프 없음)이라 두 방식 모두 정확히 계산된다. 데미지 변동이 있으면 시뮬레이션.

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
 * 1:1 정확해. 데미지 변동이 있거나 계산량이 너무 크면 null.
 * 반환 { winA, winB, draw, killA (A가 B를 쓰러뜨리는 공격 횟수 분포), killB, firstA (턴 방식의 A 선공 확률) }
 */
export function duelExact(cfg, f, A, B, lv, prep = prepare(cfg, f, A, B, lv)) {
  if ((A.variance || 0) > 0 || (B.variance || 0) > 0) return null;
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

// ── 시뮬레이션 (데미지 변동 포함, 정확해 검증) ─────────────
export function duelSim(cfg, f, A, B, lv, runs = 20000, seed = 20261018, prep = prepare(cfg, f, A, B, lv)) {
  const rnd = mulberry32(seed);
  const r = cfg.rules, round = rounder(r.round);
  const { pa, pb } = prep;
  const strike = (pr, v) => { // 한 번 공격의 데미지 (빗나감 0)
    if (!(rnd() < pr.hit)) return { dmg: 0, hit: false, crit: false };
    let raw = pr.raw;
    if (v > 0) raw *= 1 + (rnd() * 2 - 1) * v;
    const crit = rnd() < pr.crit;
    return { dmg: Math.max(0, round(crit ? raw * pr.mult : raw)), hit: true, crit };
  };
  let wa = 0, wb = 0, dr = 0;
  const dur = new Float64Array(runs), hpLeft = [];
  const cnt = { attacks: 0, hits: 0, crits: 0 };
  const va = A.variance || 0, vb = B.variance || 0;
  for (let i = 0; i < runs; i++) {
    let ha = prep.hpA, hb = prep.hpB, w = 0, t = 0;
    if (r.mode === 'turn') {
      const tot = pa.speed + pb.speed;
      const aFirst = rnd() < (tot > 0 ? pa.speed / tot : 0.5);
      for (t = 1; t <= r.maxTurns; t++) {
        const order = aFirst ? ['a', 'b'] : ['b', 'a'];
        for (const who of order) {
          const s = who === 'a' ? strike(pa, va) : strike(pb, vb);
          if (who === 'a') { cnt.attacks++; if (s.hit) cnt.hits++; if (s.crit) cnt.crits++; hb -= s.dmg; if (hb <= 0) { w = 1; break; } }
          else { ha -= s.dmg; if (ha <= 0) { w = 2; break; } }
        }
        if (w) break;
      }
      dur[i] = Math.min(t, r.maxTurns);
    } else {
      let na = 0, nb = 0; // 지금까지 한 공격 수
      const ta = () => (pa.speed > 0 ? na / pa.speed : Infinity), tb = () => (pb.speed > 0 ? nb / pb.speed : Infinity);
      while (true) {
        const tA = ta(), tB = tb();
        t = Math.min(tA, tB);
        if (!(t <= r.maxTime + 1e-9)) break;
        const both = Math.abs(tA - tB) < 1e-9 * Math.max(1, t);
        let ka = false, kb = false;
        if (tA <= tB || both) { const s = strike(pa, va); na++; cnt.attacks++; if (s.hit) cnt.hits++; if (s.crit) cnt.crits++; if (hb - s.dmg <= 0) kb = true; hb -= s.dmg; }
        if (tB < tA || both) { const s = strike(pb, vb); nb++; if (ha - s.dmg <= 0) ka = true; ha -= s.dmg; }
        if (kb && ka) { w = r.tie === 'coin' ? (rnd() < 0.5 ? 1 : 2) : 3; break; }
        if (kb) { w = 1; break; }
        if (ka) { w = 2; break; }
      }
      dur[i] = Math.min(t, r.maxTime);
    }
    if (w === 1) { wa++; hpLeft.push(Math.max(0, ha) / prep.hpA); }
    else if (w === 2) wb++;
    else dr++;
  }
  dur.sort();
  return {
    runs, winA: wa / runs, winB: wb / runs, draw: dr / runs,
    ciA: wilson(wa, runs), duration: dur, hpLeftA: Float64Array.from(hpLeft).sort(),
    realized: { hit: cnt.attacks ? cnt.hits / cnt.attacks : NaN, crit: cnt.hits ? cnt.crits / cnt.hits : NaN },
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
  return { exact: false, winA: sm.winA, winB: sm.winB, draw: sm.draw, ci: sm.ciA, sim: sm, prep, reason: (A.variance || B.variance) ? '데미지 변동' : '계산량' };
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
  if (cross.length) out.push({ level: 'info', kind: 'cross', text: `역전 레벨 ${cross.length}곳: ${cross.slice(0, 6).map(c => `Lv${c.lv} ${c.upName} > ${c.downName}`).join(', ')}${cross.length > 6 ? ' …' : ''}` });
  const order = { serious: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
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
  return { ok: true, f, lv, series, cross, mx, cv, findings: findings(cfg, f, mx, cv, cross), formulaErrors: {} };
}

// ── Kalivra 프로젝트(.kal / JSON) 가져오기 ──────────────────
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
    return {
      id, name: String(e.name ?? `엔티티 ${i + 1}`), color: typeof e.color === 'string' ? e.color : null,
      variance: Math.max(0, Math.min(0.99, Number(e.variance) || 0)),
      stats: Object.fromEntries(statIds.map(s => [s, { b: Number(e.stats?.[s]?.b) || 0, g: Number(e.stats?.[s]?.g) || 0 }])),
    };
  });
  const items = [];
  let traits = 0, orderDependent = new Set();
  (cur.items || []).forEach((it, i) => {
    traits += (it.traits || []).length;
    const mods = (it.modifiers || []).filter(m => statIds.includes(m.stat)).map(m => (m.op === 'mult' ? { stat: m.stat, mult: Number(m.val) } : { stat: m.stat, flat: Number(m.val) || 0 }));
    const tg = (it.targets || []).map(t => idMap.get(t)).filter(Boolean);
    items.push({ id: `i${i + 1}`, name: String(it.name ?? `아이템 ${i + 1}`), active: it.active !== false, targets: tg, mods });
  });
  // 같은 엔티티·스탯에 고정(add)과 배율(mult)이 함께 걸리면 Kalivra는 아이템 순서대로 계산 → 결과가 다를 수 있음
  for (const e of entities) for (const s of statIds) {
    const ms = items.filter(it => it.active && it.targets.includes(e.id)).flatMap(it => it.mods.filter(m => m.stat === s));
    if (ms.some(m => m.flat) && ms.some(m => m.mult != null)) orderDependent.add(`${e.name}.${s}`);
  }
  if (traits) notes.push(`특성(트리거) ${traits}개는 아직 지원하지 않아 뺐습니다 (3단계 예정). 결과는 특성 없는 전투입니다.`);
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
