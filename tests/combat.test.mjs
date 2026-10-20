// 전투 시뮬레이터 엔진: 공식, 계산 순서, 버프 합산, 턴 순서, 쿨타임·코스트, 스턴, 그로기, 페이즈, 시너지, 타겟팅, 부활, 실시간, 시드
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTables } from '../js/data/tables.js';
import { FORMULAS, DEFAULT_RULES, battle, simulate, effStat, hitDamage, takenMult, synergyMet, makeUnit } from '../js/combat/engine.js';

const R = { ...DEFAULT_RULES };
const always = () => 0; // rnd() = 0 → 항상 명중·치명타, 효과 항상 발동
const never = () => 0.999999; // 명중은 상한 100%일 때만, 치명타·효과 없음

/** 테스트용 테이블: 기본 데이터에 단순한 직업·캐릭터·스킬을 더함 */
function testTables() {
  const t = defaultTables();
  t.classes.push({ id: 'CL_T', name: '테스트', role: 'dealer', row: 'front', hp: 1000, atk: 100, def: 50, spd: 100, cric: 0, crid: 2, acc: 100, eva: 0, skills: [] });
  t.characters.push({ id: 'CH_T', name: '시험관', classId: 'CL_T', element: '무', modMode: 'add', skills: [] });
  t.characters.push({ id: 'CH_FAST', name: '빠름', classId: 'CL_T', element: '무', modMode: 'add', spd: 50, skills: [] });
  return t;
}
const unit = (t, ref, side = 0) => { const u = makeUnit(t, { unit: ref, level: 1 }, side, 0); u.statuses = []; u.groggyLeft = 0; u.groggyUntil = -1; return u; };

test('데미지 공식 4종이 정의대로', () => {
  const p = { K: 100, minPct: 10, defCap: 90 };
  assert.equal(FORMULAS.const.f(200, 100, p), 100);
  assert.equal(FORMULAS.sub.f(200, 150, p), 50);
  assert.equal(FORMULAS.sub.f(200, 300, p), 20); // 최소 10%
  assert.equal(FORMULAS.ratio.f(200, 200, p), 100);
  assert.equal(FORMULAS.mult.f(200, 30, p), 140);
  assert.ok(Math.abs(FORMULAS.mult.f(200, 99, p) - 20) < 1e-9); // 상한 90%
});

test('한 대의 계산 순서: 공식 × 스킬 배율 × 상성 × 치명타 × 받는 피해 × 그로기', () => {
  const t = testTables();
  const a = unit(t, 'char:CH_T'), b = unit(t, 'char:CH_T', 1);
  a.element = '수'; b.element = '화'; // 상성 1.3
  a.stats = { ...a.stats, cric: 100 };
  const r = hitDamage(t, { ...R, round: 'none' }, a, b, { mult: 1.5 }, always);
  // 공 100 × 100/(100+50) = 66.67 × 1.5 = 100 × 1.3 × 치명 2 = 260
  assert.ok(Math.abs(r.dmg - 260) < 1e-9, String(r.dmg));
  b.statuses.push({ kind: 'debuff', stat: 'dmgTaken', value: 20, mode: 'add' });
  b.groggyLeft = 1;
  const r2 = hitDamage(t, { ...R, round: 'none', groggyDmg: 1.5 }, a, b, { mult: 1.5 }, always);
  assert.ok(Math.abs(r2.dmg - 260 * 1.2 * 1.5) < 1e-9);
});

test('버프 합산: +20% 두 개 → 합연산 ×1.4, 곱연산 ×1.44, 고정값은 뒤에 더함', () => {
  const t = testTables();
  const u = unit(t, 'char:CH_T');
  u.statuses.push({ kind: 'buff', stat: 'atk', value: 20, mode: 'mul' }, { kind: 'buff', stat: 'atk', value: 20, mode: 'mul' }, { kind: 'debuff', stat: 'atk', value: 10, mode: 'add' });
  assert.ok(Math.abs(effStat(u, 'atk', { ...R, buffStack: 'add' }) - (100 * 1.4 - 10)) < 1e-9);
  assert.ok(Math.abs(effStat(u, 'atk', { ...R, buffStack: 'mul' }) - (100 * 1.44 - 10)) < 1e-9);
  u.statuses.push({ kind: 'debuff', stat: 'dmgTaken', value: 25, mode: 'add' });
  assert.equal(takenMult(u, R), 1.25);
});

test('같은 시드 = 같은 결과, 다른 시드 = 다른 결과', () => {
  const t = defaultTables();
  const setup = { allies: [{ unit: 'char:CH_AREN', level: 30 }, { unit: 'char:CH_ELLA', level: 30 }], enemies: [{ unit: 'monster:MO_ORC' }, { unit: 'monster:MO_GOBLIN' }] };
  const a = simulate(t, R, setup, { runs: 50, seed: 5 }), b = simulate(t, R, setup, { runs: 50, seed: 5 }), c = simulate(t, R, setup, { runs: 50, seed: 6 });
  assert.deepEqual([...a.durations], [...b.durations]);
  assert.deepEqual(a.units, b.units);
  assert.notDeepEqual([...a.durations], [...c.durations]);
});

test('턴제: 속도가 빠른 쪽이 먼저 행동, 쿨타임 2 = 두 턴 쉬고 다시 사용, 코스트가 모자라면 기본 공격', () => {
  const t = testTables();
  t.skills.push({ id: 'SK_T', name: '시험 스킬', target: 'enemy', area: 'single', mult: 1, cost: 10, cooldown: 2, effects: [] });
  t.characters.find(c => c.id === 'CH_FAST').skills = ['SK_T'];
  const r = battle(t, { ...R, startRes: 100, resRegen: 0, resMax: 100, hitMin: 100 }, { allies: [{ unit: 'char:CH_T' }], enemies: [{ unit: 'char:CH_FAST' }] }, { seed: 1, log: true });
  const acts = r.log.filter(l => l.ev === 'attack');
  assert.equal(acts[0].actor, '빠름');
  const fastSkills = acts.filter(l => l.actor === '빠름').slice(0, 7).map(l => l.skill);
  assert.deepEqual(fastSkills, ['시험 스킬', '기본 공격', '기본 공격', '시험 스킬', '기본 공격', '기본 공격', '시험 스킬']);
  const poor = battle(t, { ...R, startRes: 15, resRegen: 0, hitMin: 100 }, { allies: [{ unit: 'char:CH_T' }], enemies: [{ unit: 'char:CH_FAST' }] }, { seed: 1, log: true });
  const ps = poor.log.filter(l => l.ev === 'attack' && l.actor === '빠름').slice(0, 5).map(l => l.skill);
  assert.deepEqual(ps, ['시험 스킬', '기본 공격', '기본 공격', '기본 공격', '기본 공격']); // 자원 15 → 한 번만
});

test('스턴: 걸린 대상은 다음 자기 턴을 건너뜀', () => {
  const t = testTables();
  t.effects.push({ id: 'EF_T_STUN', name: '확정 기절', kind: 'stun', chance: 100, duration: 1, stack: false });
  t.skills.push({ id: 'SK_T_STUN', name: '기절 일격', target: 'enemy', area: 'single', mult: 0.1, cost: 0, cooldown: 3, effects: ['EF_T_STUN'] });
  t.characters.find(c => c.id === 'CH_FAST').skills = ['SK_T_STUN'];
  const r = battle(t, { ...R, hitMin: 100 }, { allies: [{ unit: 'char:CH_T' }], enemies: [{ unit: 'char:CH_FAST' }] }, { seed: 2, log: true });
  const first = r.log.findIndex(l => l.ev === 'status' && /기절/.test(l.text));
  assert.ok(first >= 0);
  const next = r.log.slice(first).find(l => l.actor === '시험관' && (l.ev === 'skip' || l.ev === 'attack' || l.ev === 'miss'));
  assert.equal(next.ev, 'skip');
});

test('그로기: 게이지가 차면 흐트러짐(행동 불가·받는 피해 증가), 끝나면 게이지 0 — 턴제·실시간', () => {
  const t = testTables();
  t.monsters.push({ id: 'MO_T', name: '허수아비', element: '무', row: 'front', hp: 100000, atk: 1, def: 0, spd: 100, cric: 0, crid: 1.5, acc: 100, eva: 0, skills: [], boss: true, groggyMax: 20 });
  for (const mode of ['turn', 'realtime']) {
    const r = battle(t, { ...R, mode, basicGroggy: 10, groggyDur: 2, maxTurns: 12, maxTime: 12, hitMin: 100 }, { allies: [{ unit: 'char:CH_T' }], enemies: [{ unit: 'monster:MO_T' }] }, { seed: 3, log: true });
    const g = r.log.filter(l => l.ev === 'groggy');
    const ends = r.log.filter(l => l.ev === 'expire' && /흐트러짐 해제/.test(l.text));
    assert.ok(g.length >= 2, `${mode} groggy ${g.length}`);
    assert.ok(ends.length >= g.length - 1, `${mode} reset`);
    assert.ok(r.log.some(l => l.ev === 'skip' && l.actor === '허수아비'), `${mode} skip`);
    // 흐트러짐과 해제가 번갈아 나옴 (해제 없이 다시 흐트러지지 않음)
    const seq = r.log.filter(l => l.ev === 'groggy' || (l.ev === 'expire' && /흐트러짐 해제/.test(l.text))).map(l => l.ev);
    for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], `${mode} ${seq.join(',')}`);
  }
});

test('보스 페이즈: 체력이 기준 아래로 내려가면 스킬 목록이 바뀜', () => {
  const t = defaultTables();
  const r = battle(t, R, { allies: ['CH_BRIGID', 'CH_AREN', 'CH_DAHLIA', 'CH_ELLA', 'CH_FINN'].map(id => ({ unit: `char:${id}`, level: 60 })), enemies: [{ unit: 'monster:MO_GOLEM' }] }, { seed: 4, log: true });
  const ph = r.log.filter(l => l.ev === 'phase').map(l => l.text);
  assert.ok(ph[0].startsWith('페이즈 2'), ph.join(' / '));
  assert.ok(ph.some(x => x.startsWith('페이즈 3')));
  const p3 = r.log.findIndex(l => l.ev === 'phase' && l.text.startsWith('페이즈 3'));
  assert.ok(!r.log.slice(p3).some(l => l.actor === '화염 골렘' && l.skill === '내려찍기'));
});

test('시너지 조건과 적용', () => {
  const t = defaultTables();
  const mk = (ids) => ids.map((id, i) => makeUnit(t, { unit: `char:${id}`, level: 1 }, 0, i));
  const fire = t.synergies.find(s => s.id === 'SY_FIRE'), trio = t.synergies.find(s => s.id === 'SY_TRINITY'), duo = t.synergies.find(s => s.id === 'SY_DUO');
  assert.equal(synergyMet(fire, mk(['CH_AREN', 'CH_DAHLIA'])), true);
  assert.equal(synergyMet(fire, mk(['CH_AREN', 'CH_ELLA'])), false);
  assert.equal(synergyMet(trio, mk(['CH_BRIGID', 'CH_ELLA', 'CH_AREN'])), true);
  assert.equal(synergyMet(trio, mk(['CH_BRIGID', 'CH_AREN'])), false);
  assert.equal(synergyMet(duo, mk(['CH_AREN', 'CH_ELLA'])), true);
  const on = battle(t, R, { allies: [{ unit: 'char:CH_AREN' }, { unit: 'char:CH_DAHLIA' }], enemies: [{ unit: 'monster:MO_SLIME' }] }, { seed: 1, log: true });
  assert.ok(on.log.some(l => l.ev === 'synergy' && /화염 공명/.test(l.text)));
  const off = battle(t, { ...R, synergy: false }, { allies: [{ unit: 'char:CH_AREN' }, { unit: 'char:CH_DAHLIA' }], enemies: [{ unit: 'monster:MO_SLIME' }] }, { seed: 1, log: true });
  assert.ok(!off.log.some(l => l.ev === 'synergy'));
});

test('타겟팅: 전열 우선이면 전열이 살아 있는 동안 후열을 단일 공격하지 않음', () => {
  const t = defaultTables();
  const r = battle(t, { ...R, enemyTargeting: 'front' }, { allies: [{ unit: 'char:CH_BRIGID', level: 30 }, { unit: 'char:CH_ELLA', level: 30, row: 'back' }], enemies: [{ unit: 'monster:MO_ORC' }] }, { seed: 9, log: true });
  const death = r.log.findIndex(l => l.ev === 'death' && l.actor === '브리지드');
  const until = death < 0 ? r.log : r.log.slice(0, death);
  assert.ok(!until.some(l => l.actor === '오크 전사' && l.skill === '기본 공격' && l.target === '엘라'));
});

test('부활: 쓰러진 아군을 일으키고, 끄면 부활하지 않음', () => {
  const t = testTables();
  t.skills.push({ id: 'SK_T_REV', name: '시험 부활', target: 'ally', area: 'single', mult: 0, cost: 0, cooldown: 0, effects: ['EF_REVIVE'] });
  t.classes.push({ id: 'CL_GLASS', name: '유리', role: 'dealer', row: 'front', hp: 50, atk: 10, def: 0, spd: 90, cric: 0, crid: 1.5, acc: 100, eva: 0, skills: [] });
  t.characters.push({ id: 'CH_GLASS', name: '유리몸', classId: 'CL_GLASS', element: '무', modMode: 'add', skills: [] });
  t.characters.push({ id: 'CH_REV', name: '부활사', classId: 'CL_T', element: '무', modMode: 'add', skills: ['SK_T_REV'] });
  t.monsters.push({ id: 'MO_HIT', name: '때리는 자', element: '무', row: 'front', hp: 3000, atk: 200, def: 0, spd: 95, cric: 0, crid: 1.5, acc: 100, eva: 0, skills: [] });
  const setup = { allies: [{ unit: 'char:CH_GLASS' }, { unit: 'char:CH_REV', row: 'back' }], enemies: [{ unit: 'monster:MO_HIT' }] };
  const on = battle(t, { ...R, revive: true, hitMin: 100, enemyTargeting: 'front' }, setup, { seed: 1, log: true });
  const rev = on.log.filter(l => l.ev === 'revive');
  assert.ok(rev.length > 0);
  assert.match(rev[0].text, /유리몸 부활/);
  const off = battle(t, { ...R, revive: false, hitMin: 100, enemyTargeting: 'front' }, setup, { seed: 1, log: true });
  assert.equal(off.log.filter(l => l.ev === 'revive').length, 0);
});

test('실시간: 속도가 빠르면 같은 시간에 더 자주 행동, 결과는 초 단위', () => {
  const t = testTables();
  t.monsters.push({ id: 'MO_BAG', name: '샌드백', element: '무', row: 'front', hp: 1e9, atk: 0, def: 0, spd: 1, cric: 0, crid: 1.5, acc: 0, eva: 0, skills: [] });
  const one = (id) => battle(t, { ...R, mode: 'realtime', maxTime: 30, hitMin: 100 }, { allies: [{ unit: `char:${id}` }], enemies: [{ unit: 'monster:MO_BAG' }] }, { seed: 1 }).units[0].actions;
  const slow = one('CH_T'), fast = one('CH_FAST'); // 속도 100 vs 150
  assert.ok(Math.abs(slow - 30) <= 1, String(slow));
  assert.ok(Math.abs(fast - 45) <= 1, String(fast));
});
