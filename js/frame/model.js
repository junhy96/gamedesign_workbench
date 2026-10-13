// 패턴 프레임 검증 — 순수 계산 모듈 (DOM 없음, Node 테스트에서 그대로 import)
//
// ■ 프레임 규칙 (모든 값은 정수 프레임)
//   보스 공격이 프레임 t에 시작: 선딜 N프레임 → 판정 t+N … t+N+A−1 → 후딜 R프레임 → 간격 G → 다음 공격
//   다단 공격: 판정 A프레임짜리 타격을 '타격 간격'만큼 띄워 반복
//   회피를 프레임 p에 입력: 선딜 p … p+dS−1, 무적 p+dS … p+dS+dI−1, 이후 후딜. p+dTotal부터 다시 행동 가능
//
// ■ 판정
//   회피 윈도우: 타격 [h0, h1]을 무적으로 완전히 덮는 입력 p ∈ [h1 − dI + 1 − dS, h0 − dS]
//               → 길이 = dI − A + 1. 0 이하면 구르기로 회피 불가(이동 회피 필요)
//   연계 윈도우: 직전 회피의 후딜이 끝나야(ready) 입력 가능 → [max(lo, ready), hi]
//   반응 가능:   식별 시점 + 반응 시간 + 입력 지연 ≤ 마지막 유효 입력 hi
//   반격 여유:   회피가 끝난 뒤 ~ 다음 타격을 피하려면 입력해야 하는 마지막 프레임까지, 내 공격(회피 캔슬 시점)이 들어가는지

/**
 * @typedef {{name:string, startup:number, active:number, hits:number, hitGap:number, recovery:number, gap:number, recog:number}} Attack
 *   recog = 공격 시작부터 '이 공격임을 알아볼 수 있는' 프레임 (지연·페이크 공격용, 기본 0)
 * @typedef {{dodgeStartup:number, dodgeInv:number, dodgeRecovery:number, reactionMs:number, latency:number,
 *            atkStartup:number, atkTotal:number, atkCancel:number}} Player
 */

export function validate(cfg) {
  const errors = [];
  const p = cfg.player;
  const nonNeg = (v) => Number.isInteger(v) && v >= 0;
  if (![30, 60, 120].includes(cfg.fps)) errors.push('프레임레이트는 30, 60, 120 중 하나여야 합니다.');
  if (!nonNeg(p.dodgeStartup) || !(Number.isInteger(p.dodgeInv) && p.dodgeInv >= 1) || !nonNeg(p.dodgeRecovery)) errors.push('회피 선딜·후딜은 0 이상, 무적은 1 이상의 정수여야 합니다.');
  if (!(p.reactionMs >= 0) || !nonNeg(p.latency)) errors.push('반응 시간과 입력 지연은 0 이상이어야 합니다.');
  if (!(Number.isInteger(p.atkStartup) && p.atkStartup >= 1) || !(p.atkTotal >= p.atkStartup) || !(p.atkCancel >= 1 && p.atkCancel <= p.atkTotal)) {
    errors.push('내 공격: 발생 ≥ 1, 전체 길이 ≥ 발생, 1 ≤ 회피 캔슬 시점 ≤ 전체 길이여야 합니다.');
  }
  if (!cfg.attacks.length) errors.push('보스 공격을 1개 이상 추가하세요.');
  cfg.attacks.forEach((a, i) => {
    const label = `${i + 1}번 '${a.name}'`;
    if (!(Number.isInteger(a.active) && a.active >= 1)) errors.push(`${label}: 판정은 1프레임 이상이어야 합니다.`);
    if (!(Number.isInteger(a.hits) && a.hits >= 1)) errors.push(`${label}: 타수는 1 이상이어야 합니다.`);
    for (const k of ['startup', 'hitGap', 'recovery', 'gap', 'recog']) if (!nonNeg(a[k])) errors.push(`${label}: ${LABELS[k]}은(는) 0 이상의 정수여야 합니다.`);
  });
  return errors;
}

const LABELS = { startup: '선딜', hitGap: '타격 간격', recovery: '후딜', gap: '다음까지 간격', recog: '식별 시점' };

export const reactionFrames = (cfg) => Math.ceil((cfg.player.reactionMs * cfg.fps) / 1000 - 1e-9) + cfg.player.latency;
export const toMs = (frames, fps) => (frames * 1000) / fps;

/** 연계 전체를 절대 프레임 타임라인으로 펼친다. */
export function buildTimeline(cfg) {
  let t = 0;
  const attacks = cfg.attacks.map((a, ai) => {
    const hits = [];
    let h = t + a.startup;
    for (let k = 0; k < a.hits; k++) { hits.push({ ai, k, h0: h, h1: h + a.active - 1 }); h += a.active + a.hitGap; }
    const lastActive = hits.at(-1).h1;
    const recoveryEnd = lastActive + a.recovery; // 후딜 마지막 프레임
    const next = recoveryEnd + 1 + a.gap;
    const out = { ai, name: a.name, start: t, recog: t + a.recog, hits, recoveryEnd, next };
    t = next;
    return out;
  });
  return { attacks, length: t };
}

/**
 * 'optimal': 모든 입력 조합 중 가장 많이 피하는 계획 (선입력·한 번에 여러 타격 회피 포함)
 *   동적 계획법 — 타격을 무리 [i..j]로 나눠 회피 1번이 무리 전체를 덮는다.
 *   f[i] = 타격 0..i−1을 모두 피한 뒤 다시 행동 가능한 가장 이른 프레임 (작을수록 이후에 유리 → 이것만 기억하면 됨)
 *   무리 [i..j]를 덮는 입력 p는 max(f[i], lo_j) ≤ p ≤ hi_i, 가장 이른 p를 고르면 f[j+1] = p + 회피 전체
 *   전부 피할 수 없으면 도달 가능한 마지막 타격에서 '연계 회피 불가'로 표시하고 그 다음부터 다시 계획한다.
 */
function runOptimal(cfg, tl) {
  const { dodgeStartup: dS, dodgeInv: dI, dodgeRecovery: dR } = cfg.player;
  const dTotal = dS + dI + dR;
  const react = reactionFrames(cfg);
  const all = tl.attacks.flatMap(atk => atk.hits.map(hit => {
    const lo = hit.h1 - dI + 1 - dS, hi = hit.h0 - dS;
    return { ...hit, lo, hi, window: hi - lo + 1, recog: atk.recog };
  }));
  const req = all.filter(h => h.window > 0); // 구르기로 피할 수 있는 타격만 계획 대상
  const result = new Map(); // 타격 → 결과
  let startIdx = 0, startReady = -Infinity;
  while (startIdx < req.length) {
    const m = req.length;
    const f = new Array(m + 1).fill(Infinity), back = new Array(m + 1);
    f[startIdx] = startReady;
    for (let i = startIdx; i < m; i++) {
      if (f[i] === Infinity) continue;
      for (let j = i; j < m; j++) {
        const p = Math.max(f[i], req[j].lo);
        if (p > req[i].hi) break; // j가 커질수록 lo_j도 커지므로 이후도 불가
        if (p + dTotal < f[j + 1]) { f[j + 1] = p + dTotal; back[j + 1] = { i, p, ready: f[i] }; }
      }
    }
    let end = m; while (end > startIdx && f[end] === Infinity) end--;
    // startIdx..end−1 구간 복원
    for (let k = end; k > startIdx;) {
      const { i, p, ready } = back[k];
      const first = req[i];
      const need = Math.max(first.recog + react, p);
      result.set(first, {
        ...first, kind: 'dodge', effLo: p, effWindow: first.hi - p + 1, press: p,
        cover: [p + dS, p + dS + dI - 1], ready: p + dTotal, readyBefore: ready,
        reactNeed: first.recog + react, reactMargin: first.hi - need,
      });
      for (let t = i + 1; t < k; t++) result.set(req[t], { ...req[t], kind: 'covered', effWindow: req[t].window });
      k = i;
    }
    if (end === m) break;
    const failed = req[end];
    result.set(failed, { ...failed, kind: 'chainFail', effLo: f[end], effWindow: failed.hi - f[end] + 1, blockedBy: f[end] });
    startIdx = end + 1; startReady = f[end];
  }
  const hits = all.map(h => result.get(h) ?? { ...h, kind: 'impossible', effWindow: h.window });
  return { hits, readyAfterAttack: readyPerAttack(tl, hits) };
}

/** 공격별로, 그 공격의 마지막 타격까지 처리한 뒤 다시 행동 가능한 프레임 */
function readyPerAttack(tl, hits) {
  let ready = -Infinity, idx = 0;
  return tl.attacks.map(atk => {
    for (let k = 0; k < atk.hits.length; k++, idx++) if (hits[idx].kind === 'dodge') ready = hits[idx].ready;
    return ready;
  });
}

/**
 * 'late': 가능한 가장 늦은 프레임에 회피 (보고 반응하는 플레이를 그대로 따라감, 반격 여유는 보수적)
 */
function runLate(cfg, tl) {
  const { dodgeStartup: dS, dodgeInv: dI, dodgeRecovery: dR } = cfg.player;
  const dTotal = dS + dI + dR;
  const react = reactionFrames(cfg);
  let ready = -Infinity;
  let cover = null;
  const hits = [];
  const readyAfterAttack = [];
  for (const atk of tl.attacks) {
    for (const hit of atk.hits) {
      const lo = hit.h1 - dI + 1 - dS, hi = hit.h0 - dS;
      const window = hi - lo + 1;
      const base = { ...hit, lo, hi, window, recog: atk.recog };
      if (cover && cover[0] <= hit.h0 && cover[1] >= hit.h1) { hits.push({ ...base, kind: 'covered', effWindow: window }); continue; }
      if (window <= 0) { hits.push({ ...base, kind: 'impossible', effWindow: window }); continue; }
      const effLo = Math.max(lo, ready);
      if (effLo > hi) { hits.push({ ...base, kind: 'chainFail', effLo, effWindow: hi - effLo + 1, blockedBy: ready }); continue; }
      const press = hi;
      cover = [press + dS, press + dS + dI - 1];
      ready = press + dTotal;
      // 반응: 알아본 뒤(식별+반응+지연) 눌러도 hi 안에 들어오는가. 연계 중이면 ready 이후여야 함
      const need = Math.max(atk.recog + react, effLo);
      hits.push({ ...base, kind: 'dodge', effLo, effWindow: hi - effLo + 1, press, cover, ready, reactNeed: atk.recog + react, reactMargin: hi - need });
    }
    readyAfterAttack.push(ready);
  }
  return { hits, readyAfterAttack };
}

/** 등급: 여유 / 빠듯 / 가혹 / 불가 */
export function grade(effWindow, kind, th) {
  if (kind === 'covered') return 'good';
  if (kind === 'impossible' || kind === 'chainFail' || effWindow <= 0) return 'critical';
  if (effWindow >= th.comfy) return 'good';
  if (effWindow >= th.tight) return 'warn';
  return 'serious';
}

export function analyze(cfg) {
  const errors = validate(cfg);
  if (errors.length) return { ok: false, errors };
  const tl = buildTimeline(cfg);
  const policy = cfg.policy === 'optimal' ? 'optimal' : 'late';
  const late = runLate(cfg, tl);
  const optimal = runOptimal(cfg, tl);
  const main = policy === 'late' ? late : optimal;
  const alt = policy === 'late' ? optimal : late;
  const th = cfg.thresholds;
  const { atkStartup, atkTotal, atkCancel } = cfg.player;

  const hits = main.hits.map((hit, i) => {
    const other = alt.hits[i];
    return {
      ...hit,
      grade: grade(hit.effWindow, hit.kind, th),
      memorize: hit.kind === 'dodge' && hit.reactMargin < 0,
      // 늦게(반응형으로) 피하면 못 피하지만, 입력 타이밍을 계획하면 피할 수 있는 타격
      needsEarly: policy === 'late' && hit.kind === 'chainFail' && (other.kind === 'dodge' || other.kind === 'covered'),
    };
  });

  // 반격: 공격 i의 마지막 타격 이후 ~ 다음 공격 첫 타격을 피해야 하는 마지막 입력 프레임
  const firstHi = (atk) => atk.hits[0].h0 - cfg.player.dodgeStartup;
  const counters = tl.attacks.map((atk, ai) => {
    const nextAtk = tl.attacks[ai + 1] ?? (cfg.loop ? { ...tl.attacks[0], shift: tl.length } : null);
    const freeAt = Math.max(main.readyAfterAttack[ai], atk.hits.at(-1).h1 + 1);
    if (!nextAtk) return { ai, freeAt, window: Infinity, margin: Infinity, count: Infinity, last: true };
    const deadline = firstHi(nextAtk) + (nextAtk.shift || 0);
    const window = deadline - freeAt;
    const count = window >= atkCancel ? 1 + Math.floor((window - atkCancel) / atkTotal) : 0;
    return { ai, freeAt, deadline, window, margin: window - atkCancel, count, firstHitAt: freeAt + atkStartup };
  });

  // 요약
  const dodgeable = hits.filter(h => h.kind === 'dodge');
  const tightest = dodgeable.length ? dodgeable.reduce((a, b) => (b.effWindow < a.effWindow ? b : a)) : null;
  const summary = {
    length: tl.length,
    minWindow: tightest ? tightest.effWindow : null,
    tightest,
    memorize: hits.filter(h => h.memorize).length,
    impossible: hits.filter(h => h.kind === 'impossible').length,
    chainFail: hits.filter(h => h.kind === 'chainFail').length,
    needsEarly: hits.filter(h => h.needsEarly).length,
    counterChances: counters.filter(c => c.count > 0 && Number.isFinite(c.count)).length,
    maxCounter: Math.max(0, ...counters.filter(c => Number.isFinite(c.count)).map(c => c.count)),
    hits: hits.length,
  };
  return { ok: true, timeline: tl, hits, counters, summary, reactFrames: reactionFrames(cfg), findings: findings(cfg, tl, hits, counters) };
}

/** 사람이 읽는 검증 결과 문장. 심각한 것부터. */
function findings(cfg, tl, hits, counters) {
  const fps = cfg.fps, ms = (f) => `${Math.round(toMs(f, fps))}ms`;
  const out = [];
  const name = (ai) => `${ai + 1}. ${tl.attacks[ai].name}`;
  const hitLabel = (h) => (tl.attacks[h.ai].hits.length > 1 ? `${name(h.ai)} ${h.k + 1}타` : name(h.ai));
  for (const h of hits) {
    const a = cfg.attacks[h.ai];
    if (h.kind === 'impossible') {
      out.push({ level: 'critical', text: `${hitLabel(h)}: 판정 ${a.active}f가 무적 ${cfg.player.dodgeInv}f보다 길어 구르기로 회피할 수 없습니다. 이동 회피·방어가 전제인지 확인하세요.` });
    } else if (h.kind === 'chainFail') {
      out.push({
        level: 'critical',
        text: `${hitLabel(h)}: 직전 회피의 후딜이 끝나기 전에 타격이 들어옵니다.` + (h.needsEarly ? ' 늦게 피하면 맞고, 선입력해야만 피할 수 있습니다.' : ' 어떤 타이밍으로도 연속 회피가 불가능합니다.'),
      });
    } else if (h.kind === 'dodge') {
      if (h.grade === 'serious') out.push({ level: 'serious', text: `${hitLabel(h)}: 회피 윈도우 ${h.effWindow}f(${ms(h.effWindow)})로 가혹합니다${h.effWindow < h.window ? ` (단독이면 ${h.window}f, 연계로 줄어듦)` : ''}.` });
      else if (h.grade === 'warn') out.push({ level: 'warn', text: `${hitLabel(h)}: 회피 윈도우 ${h.effWindow}f(${ms(h.effWindow)})로 빠듯합니다.` });
      if (h.memorize) {
        const late = -h.reactMargin;
        out.push({ level: h.grade === 'good' ? 'warn' : 'serious', text: `${hitLabel(h)}: 보고 반응하면 ${late}f(${ms(late)}) 늦습니다 → 암기 패턴. ${a.recog > 0 ? `식별 시점(${a.recog}f)을 앞당기거나 ` : ''}선딜을 ${late}f 이상 늘리면 반응 가능.` });
      }
    }
  }
  for (const c of counters) {
    if (c.last || !Number.isFinite(c.window)) continue;
    if (c.count === 0) out.push({ level: 'info', text: `${name(c.ai)} 이후: 반격 불가 (여유 ${c.window}f, 공격 후 회피 가능까지 ${cfg.player.atkCancel}f 필요).` });
    else out.push({ level: 'good', text: `${name(c.ai)} 이후: 반격 ${c.count}회 가능 (여유 ${c.window}f = ${ms(c.window)}).` });
  }
  const order = { critical: 0, serious: 1, warn: 2, info: 3, good: 4 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
