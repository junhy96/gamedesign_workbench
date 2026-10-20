// 전투 시뮬레이터 엔진 — 데이터 테이블을 읽어 1:1과 파티(N:N, N:보스)를 같은 규칙으로 돌린다 (DOM 없음).
// 데미지 계산 순서: ① 기본 공식(스탯 버프·디버프가 반영된 공격력·방어력) × 스킬 배율 → ② 속성 상성 → ③ 치명타
//                   → ④ 받는 피해 증감(취약 등, 합/곱) → ⑤ 그로기(흐트러짐) 배율 → 보호막 → 체력
// 전투 방식: 턴제 = 라운드마다 양 진영 전원을 속도 순으로 한 번씩, 실시간 = 초 단위 사건(행동·지속 피해·만료) 순서.
import { unitFrom, elementMult, parseUnitRef } from '../data/tables.js';
import { mulberry32 } from '../enhance/simulate.js';
import { seedMix } from '../lib/simconfig.js';

// ── 규칙 선택지 ─────────────────────────────────────────
/** 데미지 공식: f(공격력, 방어력, 규칙) → 스킬 배율을 곱하기 전 기본 데미지 */
export const FORMULAS = {
  const: { label: '방어력 상수 감소형', expr: '공 × K ÷ (K + 방)', f: (a, d, R) => a * R.K / (R.K + Math.max(0, d)), params: ['K'],
    use: '방어가 올라도 데미지가 0이 되지 않고 완만하게 줄어듦. 방어 = K일 때 절반. 대부분의 RPG 기본형.' },
  sub: { label: '단순 차감형', expr: 'max(공 − 방, 공 × 최소%)', f: (a, d, R) => Math.max(a - Math.max(0, d), a * R.minPct / 100), params: ['minPct'],
    use: '수치가 직관적이지만 방어가 공격에 가까워지면 데미지가 급격히 줄어 최소 데미지 하한이 필요. 고전 JRPG형.' },
  ratio: { label: '비율 감소형', expr: '공 × 공 ÷ (공 + 방)', f: (a, d) => (a + Math.max(0, d) > 0 ? a * a / (a + Math.max(0, d)) : 0), params: [],
    use: '공격과 방어의 비율만 중요 — 둘이 같은 배율로 성장하면 데미지 비율이 유지됨. 인플레이션이 큰 성장형 게임에 맞음.' },
  mult: { label: '곱연산형 (방어율)', expr: '공 × (1 − min(방, 상한) ÷ 100)', f: (a, d, R) => a * (1 - Math.min(Math.max(0, d), R.defCap) / 100), params: ['defCap'],
    use: '방어력을 "받는 피해 감소 %"로 직접 쓰는 형태. 수치가 곧 감소율이라 읽기 쉽고 상한으로 무적을 막음.' },
};
export const FORMULA_PARAMS = {
  K: { label: '방어 상수 K', min: 1, tip: 'f.K' },
  minPct: { label: '최소 데미지 (공격력의 %)', min: 0, max: 100, tip: 'f.minPct' },
  defCap: { label: '방어율 상한 (%)', min: 0, max: 100, tip: 'f.defCap' },
};
export const MODES = { turn: '턴제', realtime: '실시간' };
export const BUFF_STACK = { add: '합연산', mul: '곱연산' };
export const HIT_MODES = { diff: '명중 − 회피', ratio: '명중 ÷ (명중 + 회피) × 100', always: '항상 명중' };
export const TARGETING = { front: '전열 우선', random: '랜덤', lowhp: '체력 낮은 대상 우선', taunt: '도발(어그로) 우선' };
export const ALLY_RULES = { lowhp: '체력 비율 최저 아군', random: '랜덤 아군', atk: '공격력 최고 아군' };
export const ROUNDS = { floor: '내림', round: '반올림', none: '없음' };

export const DEFAULT_RULES = {
  mode: 'turn', formula: 'const', K: 100, minPct: 10, defCap: 90,
  hitMode: 'diff', hitMin: 5, hitMax: 100, crit: true, buffStack: 'add', round: 'floor',
  startRes: 40, resRegen: 20, resMax: 100,
  groggyGain: 1, groggyDur: 2, groggyDmg: 1.5, basicGroggy: 5,
  maxTurns: 100, maxTime: 180, speedBase: 100, healBelow: 70,
  targeting: 'front', enemyTargeting: 'front', allyRule: 'lowhp', synergy: true, revive: true,
};

const BASIC = Object.freeze({ id: 'BASIC', name: '기본 공격', target: 'enemy', area: 'single', mult: 1, cost: 0, cooldown: 0, effects: [] });

// ── 유닛 ────────────────────────────────────────────────
/** 슬롯 { unit: 'char:CH_x' | 'monster:MO_x', level, row? } → 전투용 유닛 (없으면 null) */
export function makeUnit(t, slot, side, idx) {
  const { kind, id } = parseUnitRef(slot.unit);
  const u = unitFrom(t, kind === 'monster' ? 'monster' : 'char', id, slot.level ?? 1);
  if (!u) return null;
  return {
    side, idx, uid: `${side ? 'E' : 'A'}${idx + 1}`, name: u.name, def: u, element: u.element, row: slot.row || u.row,
    role: u.role, kind: u.kind, id: u.id, stats: u.stats, maxHp: Math.max(1, u.stats.hp), boss: u.boss, groggyMax: u.groggyMax, phases: u.phases,
    baseSkills: u.skills,
  };
}

function freshState(u, R) {
  Object.assign(u, {
    hp: u.maxHp, alive: true, res: R.startRes, cds: {}, ready: {}, statuses: [], shields: [], groggy: 0, groggyLeft: 0, groggyUntil: -1,
    phase: -1, skills: [...u.baseSkills], next: 0, lastT: 0, deadAt: null,
    m: { dmg: 0, taken: 0, heal: 0, shield: 0, buff: 0, actions: 0, crits: 0, hits: 0, misses: 0, kills: 0, groggy: 0, life: 0 },
  });
}

// ── 스탯 (버프·디버프 반영) ─────────────────────────────
/** 실제 스탯: 기본 × (1 + Σ%) + Σ고정 (합연산) 또는 기본 × Π(1 + %) + Σ고정 (곱연산). skip(status)이면 그 상태 무시 */
export function effStat(u, k, R, skip) {
  const base = u.stats[k] ?? 0;
  let add = 0, pctSum = 0, pctProd = 1;
  for (const s of u.statuses) {
    if (s.stat !== k || (s.kind !== 'buff' && s.kind !== 'debuff') || (skip && skip(s))) continue;
    const sign = s.kind === 'debuff' ? -1 : 1;
    if (s.mode === 'mul') { const p = sign * s.value / 100; pctSum += p; pctProd *= 1 + p; } else add += sign * s.value;
  }
  let v = (R.buffStack === 'mul' ? base * pctProd : base * (1 + pctSum)) + add;
  if (k === 'cric') v = Math.min(100, v);
  if (k === 'crid') v = Math.max(1, v);
  return Math.max(0, v);
}
/** 받는 피해 배율: 디버프(취약) = +%, 버프(피해 감소) = −% */
export function takenMult(u, R, skip) {
  let sum = 0, prod = 1;
  for (const s of u.statuses) {
    if (s.stat !== 'dmgTaken' || (s.kind !== 'buff' && s.kind !== 'debuff') || (skip && skip(s))) continue;
    const p = (s.kind === 'debuff' ? 1 : -1) * s.value / 100;
    sum += p; prod *= 1 + p;
  }
  return Math.max(0, R.buffStack === 'mul' ? prod : 1 + sum);
}

export function hitChance(acc, eva, R) {
  const raw = R.hitMode === 'always' ? 100 : R.hitMode === 'ratio' ? (acc + eva > 0 ? 100 * acc / (acc + eva) : 100) : acc - eva;
  return Math.min(R.hitMax, Math.max(R.hitMin, raw)) / 100;
}
const roundDmg = (x, R) => (R.round === 'floor' ? Math.floor(x) : R.round === 'round' ? Math.round(x) : x);

/**
 * 한 대의 데미지 계산 (명중·치명은 rnd로 굴림). 반환 { miss, dmg, crit, parts }
 * parts = 단계별 값 (기획서 영역의 계산 예시용): base, element, critMult, taken, groggy
 */
export function hitDamage(t, R, att, tgt, skill, rnd, skip) {
  const acc = effStat(att, 'acc', R, skip), eva = effStat(tgt, 'eva', R, skip);
  const p = hitChance(acc, eva, R);
  if (rnd() >= p) return { miss: true, dmg: 0, crit: false, hit: p };
  const atk = effStat(att, 'atk', R, skip), def = effStat(tgt, 'def', R, skip);
  const base = FORMULAS[R.formula].f(atk, def, R) * (skill.mult ?? 1);
  const el = elementMult(t, att.element, tgt.element);
  const crit = R.crit && rnd() < effStat(att, 'cric', R, skip) / 100;
  const critMult = crit ? effStat(att, 'crid', R, skip) : 1;
  const taken = takenMult(tgt, R, skip);
  const grog = tgt.groggyLeft > 0 || tgt.groggyUntil > (tgt._now ?? -1) ? R.groggyDmg : 1;
  const raw = base * el * critMult * taken * grog;
  const dmg = raw > 0 ? Math.max(1, roundDmg(raw, R)) : 0;
  return { miss: false, dmg, crit, hit: p, parts: { atk, def, base, el, critMult, taken, grog, raw } };
}

// ── 한 판 ───────────────────────────────────────────────
/**
 * setup = { allies: [slot], enemies: [slot] }, R = 규칙, t = 테이블. opts { log, seed }
 * 반환 { winner: 0|1|null, dur (턴 또는 초), survivors, units: [{ uid, name, side, …m }], log }
 */
export function battle(t, R0, setup, { seed = 1, log = false } = {}) {
  const R = { ...DEFAULT_RULES, ...R0 };
  const rnd = mulberry32(seed);
  const sk = Object.fromEntries((t.skills || []).map(s => [s.id, s]));
  const ef = Object.fromEntries((t.effects || []).map(e => [e.id, e]));
  const units = [];
  for (const [side, list] of [[0, setup.allies || []], [1, setup.enemies || []]]) list.forEach((slot, i) => { const u = makeUnit(t, slot, side, i); if (u) units.push(u); });
  units.forEach(u => freshState(u, R));
  const RT = R.mode === 'realtime';
  let now = 0, round = 0;
  const L = [];
  const say = (o) => { if (log) L.push({ t: RT ? +now.toFixed(2) : round, ...o }); };
  const side = (s) => units.filter(u => u.side === s);
  const alive = (s) => units.filter(u => u.side === s && u.alive);
  const over = () => !alive(0).length || !alive(1).length;

  // 시너지: 조건을 만족한 진영 전원에게 전투 시작 때 효과
  if (R.synergy) for (const s of [0, 1]) {
    const mem = side(s);
    for (const sy of t.synergies || []) {
      if (!synergyMet(sy, mem)) continue;
      say({ ev: 'synergy', actor: s ? '적 진영' : '아군 진영', text: `시너지 「${sy.name}」 발동` });
      for (const u of mem) for (const eid of sy.effects || []) if (ef[eid]) applyEffect(mem[0], u, ef[eid], { synergy: true, srcId: 'SYN' });
    }
  }

  function addStatus(src, tgt, e, extra = {}) {
    const dur = e.duration ?? 0;
    const st = { eid: e.id, name: e.name, kind: e.kind, stat: e.stat, value: e.value ?? 0, mode: e.mode || 'add', src: src.uid, srcSide: src.side,
      rem: dur > 0 ? dur : Infinity, until: dur > 0 ? now + dur : Infinity, ...extra };
    const same = tgt.statuses.find(x => x.eid === e.id && !e.stack);
    if (same) { Object.assign(same, { rem: st.rem, until: st.until, src: st.src, srcSide: st.srcSide, dot: st.dot ?? same.dot }); return same; }
    tgt.statuses.push(st);
    return st;
  }
  function applyEffect(src, tgt, e, { synergy = false, srcId } = {}) {
    if (!synergy && rnd() * 100 >= (e.chance ?? 100)) return false;
    const atk = effStat(src, 'atk', R);
    switch (e.kind) {
      case 'heal': { const amt = atk * (e.value ?? 0) / 100, got = Math.min(tgt.maxHp - tgt.hp, amt); tgt.hp += got; src.m.heal += got; say({ ev: 'heal', actor: src.name, target: tgt.name, value: Math.round(got), text: `${e.name} +${Math.round(got)}` }); return true; }
      case 'shield': { const amt = atk * (e.value ?? 0) / 100; const dur = e.duration ?? 0; tgt.shields.push({ amt, rem: dur > 0 ? dur : Infinity, until: dur > 0 ? now + dur : Infinity }); src.m.shield += amt; say({ ev: 'status', actor: src.name, target: tgt.name, value: Math.round(amt), text: `${e.name} ${Math.round(amt)} 획득` }); return true; }
      case 'revive': return false; // 부활은 대상 선택 단계에서 처리
      case 'dot': addStatus(src, tgt, e, { dot: atk * (e.value ?? 0) / 100 }); break;
      default: addStatus(src, tgt, e, srcId ? { src: srcId } : {});
    }
    if (!synergy) say({ ev: 'status', actor: src.name, target: tgt.name, text: `${tgt.name}: ${e.name}${e.kind === 'stun' ? ' (행동 불가)' : ''} 적용${e.duration ? ` · ${e.duration}${RT ? '초' : '턴'}` : ''}` });
    return true;
  }

  function damage(src, tgt, amt, { dot = false } = {}) {
    let left = amt;
    for (const sh of tgt.shields) { const use = Math.min(sh.amt, left); sh.amt -= use; left -= use; if (!left) break; }
    tgt.shields = tgt.shields.filter(s => s.amt > 1e-9);
    const real = Math.min(tgt.hp, left);
    tgt.hp -= real;
    if (src) src.m.dmg += amt;
    tgt.m.taken += amt;
    if (tgt.hp <= 1e-9 && tgt.alive) {
      tgt.alive = false; tgt.hp = 0; tgt.deadAt = RT ? now : round;
      if (src) src.m.kills++;
      say({ ev: 'death', actor: tgt.name, text: `${tgt.name} 쓰러짐${dot ? ' (지속 피해)' : ''}` });
    } else checkPhase(tgt);
  }
  function checkPhase(u) {
    if (!u.phases?.length) return;
    const pct = u.hp / u.maxHp * 100;
    let k = -1; u.phases.forEach((p, i) => { if (pct <= p.hp) k = i; });
    if (k > u.phase) {
      u.phase = k; u.skills = [...u.phases[k].skills]; u.cds = {}; u.ready = {};
      say({ ev: 'phase', actor: u.name, text: `페이즈 ${k + 2} 진입 (체력 ${u.phases[k].hp}% 이하) → ${u.skills.map(id => sk[id]?.name ?? id).join(', ')}` });
    }
  }
  function addGroggy(src, tgt, amount) {
    if (!(tgt.groggyMax > 0) || !tgt.alive || amount <= 0 || tgt.groggyLeft > 0 || tgt.groggyUntil > now) return;
    tgt.groggy += amount * R.groggyGain;
    if (tgt.groggy >= tgt.groggyMax) {
      tgt.groggy = tgt.groggyMax;
      if (RT) tgt.groggyUntil = now + R.groggyDur; else tgt.groggyLeft = R.groggyDur;
      src.m.groggy++;
      say({ ev: 'groggy', actor: tgt.name, text: `${tgt.name} 흐트러짐! ${R.groggyDur}${RT ? '초' : '턴'} 행동 불가 · 받는 피해 ×${R.groggyDmg}` });
    }
  }

  // ── 대상 고르기 ──
  const isTaunting = (u) => u.statuses.some(s => s.kind === 'taunt');
  function pickEnemy(u) {
    const foes = alive(1 - u.side);
    if (!foes.length) return null;
    const rule = u.side === 0 ? R.targeting : R.enemyTargeting;
    const rand = (arr) => arr[Math.floor(rnd() * arr.length)];
    if (rule === 'taunt') { const tt = foes.filter(isTaunting); if (tt.length) return rand(tt); }
    if (rule === 'random') return rand(foes);
    if (rule === 'lowhp') return foes.reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a));
    const front = foes.filter(f => f.row === 'front');
    return rand(front.length ? front : foes);
  }
  function pickAlly(u, rule = R.allyRule) {
    const al = alive(u.side);
    if (rule === 'random') return al[Math.floor(rnd() * al.length)];
    if (rule === 'atk') return al.reduce((a, b) => (effStat(b, 'atk', R) > effStat(a, 'atk', R) ? b : a));
    return al.reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a));
  }
  const effectsOf = (s) => (s.effects || []).map(id => ef[id]).filter(Boolean);
  const dead = (u) => units.filter(x => x.side === u.side && !x.alive);

  /** 쓸 스킬: 목록 앞쪽부터, 쿨타임·코스트·상황(회복할 아군, 부활할 아군, 이미 걸린 영구 효과)을 보고 */
  function choose(u) {
    for (const id of u.skills) {
      const s = sk[id];
      if (!s) continue;
      const cdOk = RT ? (u.ready[id] ?? 0) <= now + 1e-9 : !(u.cds[id] > 0);
      if (!cdOk || u.res < (s.cost ?? 0)) continue;
      const es = effectsOf(s);
      if (es.some(e => e.kind === 'revive')) { if (R.revive && dead(u).length) return s; continue; }
      if (s.target === 'ally' && es.some(e => e.kind === 'heal')) { if (alive(u.side).some(a => a.hp / a.maxHp * 100 < R.healBelow)) return s; continue; }
      if (s.target === 'self' || s.target === 'ally') {
        const pool = s.target === 'self' ? [u] : s.area === 'all' ? alive(u.side) : [pickAlly(u)];
        const useless = es.length && es.every(e => (e.duration ?? 0) === 0 && !e.stack && pool.every(p => p.statuses.some(x => x.eid === e.id)))
          || (es.length && es.every(e => e.kind === 'taunt') && isTaunting(u));
        if (useless) continue;
      }
      return s;
    }
    return BASIC;
  }

  function act(u) {
    const s = choose(u);
    u.m.actions++;
    if (s !== BASIC) { u.res -= s.cost ?? 0; if (RT) u.ready[s.id] = now + (s.cooldown ?? 0); else u.cds[s.id] = (s.cooldown ?? 0) + 1; }
    const es = effectsOf(s);
    let targets;
    if (es.some(e => e.kind === 'revive')) {
      const d = dead(u)[0];
      const e = es.find(x => x.kind === 'revive');
      if (d && rnd() * 100 < (e.chance ?? 100)) {
        freshState(d, R); d.hp = d.maxHp * (e.value ?? 30) / 100; d.res = 0;
        if (RT) d.next = now + 1 / aps(d);
        u.m.heal += d.hp;
        say({ ev: 'revive', actor: u.name, skill: s.name, target: d.name, text: `${s.name}: ${d.name} 부활 (체력 ${Math.round(d.hp)})` });
      }
      return;
    }
    if (s.target === 'self') targets = [u];
    else if (s.target === 'ally') targets = s.area === 'all' ? alive(u.side) : [pickAlly(u, es.some(e => e.kind === 'heal' || e.kind === 'shield') ? 'lowhp' : R.allyRule)];
    else targets = s.area === 'all' ? alive(1 - u.side) : [pickEnemy(u)].filter(Boolean);
    for (const tg of targets) {
      if (s.target === 'enemy') {
        tg._now = now;
        const r = hitDamage(t, R, u, tg, s, rnd);
        if (r.miss) { u.m.misses++; say({ ev: 'miss', actor: u.name, skill: s.name, target: tg.name, text: `${s.name} → ${tg.name} 빗나감` }); continue; }
        u.m.hits++; if (r.crit) u.m.crits++;
        // 버프·디버프 기여 추정: 다른 아군이 건 버프와, 대상에게 우리 진영이 건 디버프를 빼고 다시 계산한 데미지와의 차이
        const ext = (st) => st.src !== u.uid && st.srcSide === u.side;
        if (u.statuses.some(ext) || tg.statuses.some(ext)) {
          const frozen = { ...r.parts };
          const atk0 = effStat(u, 'atk', R, ext), def0 = effStat(tg, 'def', R, ext);
          const base0 = FORMULAS[R.formula].f(atk0, def0, R) * (s.mult ?? 1);
          const raw0 = base0 * frozen.el * frozen.critMult * takenMult(tg, R, ext) * frozen.grog;
          const extra = Math.max(0, r.dmg - (raw0 > 0 ? Math.max(1, roundDmg(raw0, R)) : 0));
          if (extra > 0) {
            const srcs = [...new Set([...u.statuses, ...tg.statuses].filter(ext).map(x => x.src))];
            for (const id of srcs) { const b = units.find(x => x.uid === id); if (b) b.m.buff += extra / srcs.length; }
          }
        }
        say({ ev: 'attack', actor: u.name, skill: s.name, target: tg.name, value: r.dmg, crit: r.crit, text: `${s.name} → ${tg.name} ${r.dmg}${r.crit ? ' (치명타)' : ''}` });
        damage(u, tg, r.dmg);
        addGroggy(u, tg, s === BASIC ? R.basicGroggy : (s.groggy ?? 0));
        if (tg.alive) for (const e of es) applyEffect(u, tg, e);
      } else {
        if (es.length === 0) continue;
        say({ ev: 'skill', actor: u.name, skill: s.name, target: tg.name, text: `${s.name} → ${tg.name}` });
        for (const e of es) applyEffect(u, tg, e);
      }
    }
  }

  /** 실시간: 만료된 상태·보호막을 지금 시각 기준으로 정리 (1초 틱 사이에 끝난 효과가 다음 행동에 남지 않게) */
  function purge() {
    for (const u of units) {
      const gone = u.statuses.filter(s => s.until <= now + 1e-9);
      if (gone.length) { u.statuses = u.statuses.filter(s => s.until > now + 1e-9); for (const g of gone) say({ ev: 'expire', actor: u.name, text: `${u.name}: ${g.name} 해제` }); }
      u.shields = u.shields.filter(s => s.until > now + 1e-9 && s.amt > 0);
      if (u.groggyUntil > 0 && u.groggyUntil <= now + 1e-9) { u.groggyUntil = -1; u.groggy = 0; say({ ev: 'expire', actor: u.name, text: `${u.name} 흐트러짐 해제 · 게이지 초기화` }); }
    }
  }
  const aps = (u) => Math.max(0.05, effStat(u, 'spd', R) / R.speedBase);
  const cannotAct = (u) => u.groggyLeft > 0 || u.groggyUntil > now + 1e-9 || u.statuses.some(s => s.kind === 'stun' && (RT ? s.until > now + 1e-9 : s.rem > 0));

  // ── 턴제 ──
  function tickTurnStart(u) {
    for (const s of u.statuses) if (s.dot > 0 && u.alive) { const d = Math.max(1, roundDmg(s.dot * takenMult(u, R), R)); const src = units.find(x => x.uid === s.src); say({ ev: 'dot', actor: s.name, target: u.name, value: d, text: `${s.name}: ${u.name} ${d}` }); damage(src, u, d, { dot: true }); }
    u.res = Math.min(R.resMax, u.res + R.resRegen);
    for (const k of Object.keys(u.cds)) u.cds[k]--;
  }
  function tickTurnEnd(u) {
    const before = u.statuses.length;
    u.statuses.forEach(s => { s.rem--; });
    const gone = u.statuses.filter(s => s.rem <= 0);
    u.statuses = u.statuses.filter(s => s.rem > 0);
    for (const g of gone) say({ ev: 'expire', actor: u.name, text: `${u.name}: ${g.name} 해제` });
    u.shields.forEach(s => { s.rem--; }); u.shields = u.shields.filter(s => s.rem > 0 && s.amt > 0);
    void before;
  }

  if (!RT) {
    while (!over() && round < R.maxTurns) {
      round++;
      const order = units.filter(u => u.alive).sort((a, b) => effStat(b, 'spd', R) - effStat(a, 'spd', R) || a.side - b.side || a.idx - b.idx);
      for (const u of order) {
        if (!u.alive) continue;
        tickTurnStart(u);
        if (!u.alive || over()) break;
        if (u.groggyLeft > 0) {
          u.groggyLeft--; say({ ev: 'skip', actor: u.name, text: `${u.name} 흐트러짐 — 행동 불가` });
          if (u.groggyLeft === 0) { u.groggy = 0; say({ ev: 'expire', actor: u.name, text: `${u.name} 흐트러짐 해제 · 게이지 초기화` }); }
        } else if (cannotAct(u)) say({ ev: 'skip', actor: u.name, text: `${u.name} 기절 — 행동 불가` });
        else act(u);
        tickTurnEnd(u);
        if (over()) break;
      }
      for (const u of units) if (u.alive) u.m.life++;
    }
  } else {
    // ── 실시간: 사건 = 유닛 행동(1 ÷ 초당 행동), 1초마다 지속 피해·자원 회복 ──
    for (const u of units) { u.next = 1 / aps(u) * (0.9 + 0.2 * rnd()); u.lastT = 0; }
    let nextTick = 1;
    while (!over() && now < R.maxTime) {
      const actors = units.filter(u => u.alive);
      const nu = actors.reduce((a, b) => (b.next < a.next ? b : a));
      if (nextTick <= nu.next) {
        now = nextTick; nextTick += 1;
        purge();
        for (const u of units) {
          if (!u.alive) continue;
          u.res = Math.min(R.resMax, u.res + R.resRegen);
          for (const s of u.statuses) if (s.dot > 0 && s.until >= now - 1e-9 && u.alive) { const d = Math.max(1, roundDmg(s.dot * takenMult(u, R), R)); const src = units.find(x => x.uid === s.src); say({ ev: 'dot', actor: s.name, target: u.name, value: d, text: `${s.name}: ${u.name} ${d}` }); damage(src, u, d, { dot: true }); }
          const gone = u.statuses.filter(s => s.until <= now + 1e-9);
          u.statuses = u.statuses.filter(s => s.until > now + 1e-9);
          for (const g of gone) say({ ev: 'expire', actor: u.name, text: `${u.name}: ${g.name} 해제` });
          u.shields = u.shields.filter(s => s.until > now + 1e-9 && s.amt > 0);
          if (u.groggyUntil > 0 && u.groggyUntil <= now + 1e-9) { u.groggyUntil = -1; u.groggy = 0; say({ ev: 'expire', actor: u.name, text: `${u.name} 흐트러짐 해제 · 게이지 초기화` }); }
          if (u.alive) u.m.life++;
        }
        continue;
      }
      now = nu.next;
      purge();
      if (cannotAct(nu)) {
        const stunEnd = Math.max(nu.groggyUntil, ...nu.statuses.filter(s => s.kind === 'stun').map(s => s.until));
        say({ ev: 'skip', actor: nu.name, text: `${nu.name} ${nu.groggyUntil > now ? '흐트러짐' : '기절'} — 행동 불가` });
        nu.next = Math.max(now + 0.1, Math.min(stunEnd, now + R.maxTime));
        continue;
      }
      act(nu);
      nu.next = now + 1 / aps(nu);
    }
  }

  const winner = !alive(1).length && alive(0).length ? 0 : !alive(0).length && alive(1).length ? 1 : null;
  return {
    winner, dur: RT ? now : round, survivors: alive(0).length,
    units: units.map(u => ({ uid: u.uid, name: u.name, side: u.side, role: u.role, alive: u.alive, hp: u.hp, maxHp: u.maxHp, ...u.m })),
    log: L,
  };
}

/** 시너지 조건: 같은 속성 N명 / 역할군 조합 / 특정 캐릭터 */
export function synergyMet(sy, mem) {
  const keys = String(sy.key ?? '').split(/[|;,]/).map(s => s.trim()).filter(Boolean);
  if (sy.cond === 'element') return mem.filter(u => u.element === String(sy.key).trim()).length >= (sy.count ?? 1);
  if (sy.cond === 'role') return keys.length > 0 && keys.every(r => mem.some(u => u.role === r));
  if (sy.cond === 'chars') return keys.length > 0 && keys.every(id => mem.some(u => u.kind === 'char' && u.id === id));
  return false;
}

// ── 여러 판 ─────────────────────────────────────────────
/**
 * runs번 돌려 요약. 반환 { runs, win, lose, draw, clear: [승리한 판의 턴/초], mean, survivors, dps, taken, units: [평균 기여], log }
 * 같은 seed면 같은 결과 (조합 비교는 같은 seed를 넘겨 공정하게).
 */
export function simulate(t, R, setup, { runs = 300, seed, logFirst = true } = {}) {
  let win = 0, lose = 0, draw = 0, surv = 0, dps = 0, taken = 0;
  const clear = [], durs = [];
  const sums = new Map();
  let log = [];
  for (let i = 0; i < runs; i++) {
    const r = battle(t, R, setup, { seed: seedMix(seed, 1009 + i * 7919), log: logFirst && i === 0 });
    if (i === 0) log = r.log;
    if (r.winner === 0) { win++; clear.push(r.dur); } else if (r.winner === 1) lose++; else draw++;
    durs.push(r.dur);
    surv += r.survivors;
    const allyDmg = r.units.filter(u => u.side === 0).reduce((a, u) => a + u.dmg, 0);
    dps += r.dur > 0 ? allyDmg / r.dur : 0;
    taken += r.units.filter(u => u.side === 0).reduce((a, u) => a + u.taken, 0);
    for (const u of r.units) {
      const s = sums.get(u.uid) || { uid: u.uid, name: u.name, side: u.side, role: u.role, dmg: 0, taken: 0, heal: 0, shield: 0, buff: 0, life: 0, actions: 0, crits: 0, hits: 0, misses: 0, kills: 0, groggy: 0, survived: 0, durSum: 0 };
      for (const k of ['dmg', 'taken', 'heal', 'shield', 'buff', 'life', 'actions', 'crits', 'hits', 'misses', 'kills', 'groggy']) s[k] += u[k];
      s.survived += u.alive ? 1 : 0; s.durSum += r.dur;
      sums.set(u.uid, s);
    }
  }
  const units = [...sums.values()].map(s => {
    const o = { ...s };
    for (const k of ['dmg', 'taken', 'heal', 'shield', 'buff', 'life', 'actions', 'crits', 'hits', 'misses', 'kills', 'groggy', 'survived']) o[k] = s[k] / runs;
    o.dps = s.durSum > 0 ? s.dmg / s.durSum : 0;
    o.critRate = s.hits ? s.crits / s.hits : 0;
    delete o.durSum;
    return o;
  });
  const sorted = Float64Array.from(clear).sort();
  return {
    runs, win: win / runs, lose: lose / runs, draw: draw / runs, winCount: win,
    clear: sorted, durations: Float64Array.from(durs).sort(),
    meanClear: clear.length ? clear.reduce((a, b) => a + b, 0) / clear.length : NaN,
    survivors: surv / runs, dps: dps / runs, taken: taken / runs, units, log,
  };
}

/** 슬롯 목록에서 유효한 유닛 수 (없는 ID 등은 빠짐) */
export const validSlots = (t, list) => (list || []).filter(s => makeUnit(t, s, 0, 0));
