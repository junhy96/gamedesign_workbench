// 실행: npm test  (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compile } from '../js/battle/formula.js';
import {
  analyze, validate, compileRules, statsAt, tableAt, killDist, duelExact, duelSim, prepare, matrix, wilson, spearman,
  crossovers, cpVsWin, fromKalivra, josa, battleOnce, duel, traitWarnings, phaseRanges, levelSweep, sweepPlan, phaseReport, cycles, solveTarget, solveScale, minChanges, battleSensitivity, contributions, scoreOf, withScale, withParam, applyScale,
} from '../js/battle/model.js';
import { TEMPLATES } from '../js/battle/presets.js';
import { mulberry32 } from '../js/enhance/simulate.js';

const ref = JSON.parse(readFileSync(new URL('../docs/samples/kalivra-reference.json', import.meta.url), 'utf8'));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);
const ev = (src, vars = {}) => { const c = compile(src, Object.keys(vars)); assert.ok(c.ok, c.error); return c.eval(c.vars.map(v => vars[v])); };

// 스탯 8개 기본 설정 위에 엔티티 두 개
const STAT_IDS = ['hp', 'atk', 'def', 'acc', 'eva', 'cric', 'crid', 'aspd'];
function cfgOf(entities, rules = {}, extra = {}) {
  return {
    maxLevel: 20, level: 1, stats: STAT_IDS.map(id => ({ id, name: id, growth: 'linear' })), items: [], entities,
    rules: { damage: 'a.atk * 100 / (100 + b.def)', hit: 'a.acc - b.eva', critChance: 'a.cric', critMult: 'a.crid', speed: 'aspd', hp: 'hp', cp: 'atk + hp', mode: 'time', tie: 'coin', maxTime: 120, maxTurns: 200, hitMin: 5, hitMax: 100, round: 'floor', ...rules },
    ...extra,
  };
}
const ent = (id, o, variance = 0) => ({ id, name: id, variance, stats: Object.fromEntries(STAT_IDS.map(s => [s, o[s] && typeof o[s] === 'object' ? o[s] : { b: o[s] ?? 0, g: 0 }])) });

// ── 수식 파서 ───────────────────────────────────────────
test('수식: 우선순위·거듭제곱(오른쪽 결합)·단항·함수·비교·삼항', () => {
  assert.equal(ev('1 + 2 * 3'), 7);
  assert.equal(ev('(1 + 2) * 3'), 9);
  assert.equal(ev('2 ^ 3 ^ 2'), 512);
  assert.equal(ev('2 ** 3'), 8);
  assert.equal(ev('-2 ^ 2'), -4);
  assert.equal(ev('10 % 4'), 2);
  assert.equal(ev('min(3, 1, 2) + max(4, 5) + clamp(15, 0, 10)'), 16);
  assert.equal(ev('Math.floor(2.7) + round(2.5) + abs(-3) + sqrt(16) + pow(2, 3)'), 2 + 3 + 3 + 4 + 8);
  assert.equal(ev('a.hp < 50 ? 2 : 1', { 'a.hp': 30 }), 2);
  assert.equal(ev('a.hp < 50 && b.def >= 10', { 'a.hp': 30, 'b.def': 10 }), 1);
  assert.equal(ev('!(1 == 2) || 0'), 1);
  assert.equal(ev('1e3 + .5'), 1000.5);
  assert.equal(ev('a.atk * 100 / (100 + b.def)', { 'a.atk': 50, 'b.def': 25 }), 40);
  assert.equal(ev('체력 * 2', { 체력: 10 }), 20);
});

test('수식: 코드는 실행되지 않고, 쓸 수 없는 이름은 위치와 함께 오류', () => {
  for (const src of ['process.exit()', 'alert(1)', 'constructor', '__proto__', 'this', 'a.atk; 1', '`x`', 'atk = 1', 'globalThis.x']) {
    const c = compile(src, ['a.atk']);
    assert.equal(c.ok, false, src);
    assert.equal(typeof c.error, 'string');
  }
  const c = compile('a.atk + atk', ['a.atk', 'b.atk', 'lv'], (n) => `a.${n}로 쓰세요.`);
  assert.equal(c.ok, false);
  assert.equal(c.pos, 8);
  assert.match(c.error, /9번째 글자: 'atk'.*a\.atk로/);
  assert.equal(compile('', []).ok, false);
  assert.equal(compile('min()', []).ok, false);
  assert.equal(compile('clamp(1, 2)', []).ok, false);
  assert.equal(compile('(1 + 2', []).ok, false);
  assert.ok(parse('1 + 2'));
});

test('규칙 수식: 대결 수식에 접두어 없는 스탯은 오류 + 안내 (Kalivra 샘플이 0이 된 경우)', () => {
  const cfg = cfgOf([ent('A', {}), ent('B', {})], { damage: 'atk * (100 / (100 + def))' });
  const r = compileRules(cfg);
  assert.equal(r.ok, false);
  assert.match(r.errors.damage, /a\.atk/);
  const r2 = compileRules(cfgOf([ent('A', {})], { hp: 'a.hp' }));
  assert.match(r2.errors.hp, /자기 스탯만/);
});

// ── 스탯·성장·수정자 ─────────────────────────────────────
test('성장: 선형·등비·표(사이 직선 보간, 양 끝 고정)', () => {
  const cfg = cfgOf([ent('A', { hp: { b: 100, g: 10 }, atk: { b: 50, g: 10 }, def: { table: [[1, 5], [10, 50], [20, 60]] } })]);
  cfg.stats.find(s => s.id === 'atk').growth = 'geo';
  const A = cfg.entities[0];
  assert.equal(statsAt(cfg, A, 1).hp, 100);
  assert.equal(statsAt(cfg, A, 11).hp, 200);
  close(statsAt(cfg, A, 3).atk, 50 * 1.1 ** 2, 1e-12);
  assert.equal(statsAt(cfg, A, 1).def, 5);
  assert.equal(statsAt(cfg, A, 5).def, 25);
  assert.equal(statsAt(cfg, A, 15).def, 55);
  assert.equal(statsAt(cfg, A, 30).def, 60);
  assert.equal(tableAt([[10, 1], [1, 0]], 5.5), 0.5); // 순서가 섞여도 정렬
});

test('수정자: (값 + Σ고정) × (1 + Σ%) × Π배율 — 아이템 순서와 무관, 스탯 최소·최대로 자름', () => {
  const cfg = cfgOf([ent('A', { atk: 100, cric: 90 }), ent('B', { atk: 100 })]);
  cfg.stats.find(s => s.id === 'cric').max = 100;
  const items = [
    { id: 'i1', active: true, targets: ['A'], mods: [{ stat: 'atk', flat: 10 }, { stat: 'cric', flat: 20 }] },
    { id: 'i2', active: true, targets: 'all', mods: [{ stat: 'atk', mult: 2 }] },
    { id: 'i3', active: true, targets: ['A'], mods: [{ stat: 'atk', pct: 50 }] },
    { id: 'i4', active: false, targets: 'all', mods: [{ stat: 'atk', flat: 1000 }] },
  ];
  const want = (100 + 10) * 1.5 * 2;
  for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [1, 3, 0, 2]]) {
    const s = statsAt(cfg, cfg.entities[0], 1, order.map(i => items[i]));
    assert.equal(s.atk, want);
    assert.equal(s.cric, 100);
  }
  assert.equal(statsAt(cfg, cfg.entities[1], 1, items).atk, 200);
});

// ── 쓰러뜨리는 공격 횟수 분포 ───────────────────────────
test('공격 횟수 분포: 항상 명중이면 ⌈체력 ÷ 데미지⌉ 고정, 명중률 p면 음이항 분포', () => {
  const det = killDist({ hit: 1, crit: 0, normal: 30, critical: 45 }, 100, 50);
  assert.equal(det.p[4], 1);
  const p = 0.6, k = 4; // 체력 100, 데미지 30 → 4번 적중
  const d = killDist({ hit: p, crit: 0, normal: 30, critical: 45 }, 100, 400);
  const C = (n, r) => { let x = 1; for (let i = 0; i < r; i++) x = x * (n - i) / (i + 1); return x; };
  for (let n = k; n < 20; n++) close(d.p[n], C(n - 1, k - 1) * p ** k * (1 - p) ** (n - k), 1e-12, `n=${n}`);
  close(d.p.reduce((a, b) => a + b, 0) + d.never, 1, 1e-12);
  // 공격 수 상한 안에 못 끝낸 몫은 never
  const short = killDist({ hit: 0.1, crit: 0, normal: 30, critical: 45 }, 100, 10);
  assert.ok(short.never > 0.9);
  assert.equal(killDist({ hit: 0, crit: 0, normal: 30, critical: 30 }, 100, 10).never, 1);
  assert.equal(killDist({ hit: 1, crit: 0, normal: 0, critical: 0 }, 100, 10).never, 1);
});

test('공격 횟수 분포: 치명 포함 = 직접 시뮬레이션', () => {
  const prof = { hit: 0.8, crit: 0.3, normal: 17, critical: 34 };
  const d = killDist(prof, 200, 400);
  const rnd = mulberry32(7);
  const N = 200000, cnt = new Map();
  for (let i = 0; i < N; i++) { let hp = 200, n = 0; while (hp > 0) { n++; if (rnd() < prof.hit) hp -= rnd() < prof.crit ? 34 : 17; } cnt.set(n, (cnt.get(n) || 0) + 1); }
  let mean = 0; for (let n = 1; n < d.p.length; n++) mean += n * d.p[n];
  let sm = 0; for (const [n, c] of cnt) sm += n * c / N;
  close(mean, sm, 0.03);
  for (const n of [8, 10, 12]) close(d.p[n], (cnt.get(n) || 0) / N, 0.004, `n=${n}`);
});

// ── 1:1 정확해 ──────────────────────────────────────────
const fromRef = (c, mode) => {
  const toEnt = (e, id) => ({ id, name: e.name, variance: 0, stats: e.stats });
  return cfgOf([toEnt(c.A, 'A'), toEnt(c.B, 'B')], { damage: ref.rules.dmgFormula, hit: ref.rules.hitFormula, cp: ref.rules.cpFormula, mode });
};

test('턴 교대 정확해 = Kalivra v1.0.1 엔진을 실제로 돌린 결과 (docs/samples/kalivra-reference.json, 3σ 안)', () => {
  for (const c of ref.cases) {
    const cfg = fromRef(c, 'turn');
    const { f } = compileRules(cfg);
    const ex = duelExact(cfg, f, cfg.entities[0], cfg.entities[1], c.lv);
    const k = c.kalivra, se = Math.sqrt(k.winA * (1 - k.winA) / k.runs);
    assert.ok(Math.abs(ex.winA - k.winA) <= 3 * se + 1e-9, `${c.id}: ${ex.winA} vs ${k.winA} (σ ${se})`);
    close(ex.winA + ex.winB + ex.draw, 1, 1e-9);
  }
  // K1: 같은 스탯, 공격 속도 4 대 1 → Kalivra에서는 선공 확률 4/5가 그대로 승률
  const cfg = fromRef(ref.cases[0], 'turn');
  const { f } = compileRules(cfg);
  close(duelExact(cfg, f, cfg.entities[0], cfg.entities[1], 1).winA, 0.8, 1e-12);
});

test('시간 기반: 공격 속도가 2배면 같은 시간에 공격도 2배 — K1은 100% 승, K3(Chicken 대 Godzilla)는 2.6% → 75%', () => {
  const k1 = fromRef(ref.cases[0], 'time'), k3 = fromRef(ref.cases[2], 'time');
  const f1 = compileRules(k1).f, f3 = compileRules(k3).f;
  const e1 = duelExact(k1, f1, k1.entities[0], k1.entities[1], 1);
  close(e1.winA, 1, 1e-12);
  assert.equal(e1.killA.p[20], 1); // 20번 공격으로 쓰러뜨림: 4회/초 → 4.75초, 상대는 그동안 5번
  const e3 = duelExact(k3, f3, k3.entities[0], k3.entities[1], 10);
  assert.ok(e3.winA > 0.7 && e3.winA < 0.8, String(e3.winA));
});

test('시간 기반 동시 결정타: 동전이면 반반, 무승부 규칙이면 무승부', () => {
  const same = { hp: 100, atk: 25, acc: 100, crid: 1.5, aspd: 1 };
  for (const [tie, want] of [['coin', [0.5, 0.5, 0]], ['simul', [0, 0, 1]]]) {
    const cfg = cfgOf([ent('A', same), ent('B', same)], { tie });
    const { f } = compileRules(cfg);
    const ex = duelExact(cfg, f, cfg.entities[0], cfg.entities[1], 1);
    close(ex.winA, want[0], 1e-12); close(ex.winB, want[1], 1e-12); close(ex.draw, want[2], 1e-12);
  }
});

test('시간 초과는 무승부로 따로 센다 (Kalivra는 무승부를 양쪽 모두의 패배로 셈)', () => {
  const tank = { hp: 100000, atk: 1, acc: 100, crid: 1.5, aspd: 1 };
  for (const mode of ['time', 'turn']) {
    const cfg = cfgOf([ent('A', tank), ent('B', tank)], { mode });
    const { f } = compileRules(cfg);
    const ex = duelExact(cfg, f, cfg.entities[0], cfg.entities[1], 1);
    close(ex.draw, 1, 1e-12, mode);
  }
});

test('정확해 = 이 탭의 시뮬레이션 (무작위 설정 12개, 두 방식, 4σ 안)', () => {
  let seed = 11; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 12; i++) {
    const mk = (id) => ent(id, { hp: 150 + r() * 400, atk: 20 + r() * 40, def: r() * 40, acc: 70 + r() * 30, eva: r() * 30, cric: r() * 40, crid: 1.3 + r(), aspd: 0.5 + r() * 1.5 });
    for (const mode of ['time', 'turn']) {
      const cfg = cfgOf([mk('A'), mk('B')], { mode, tie: i % 2 ? 'coin' : 'simul' });
      const { f } = compileRules(cfg);
      const [A, B] = cfg.entities;
      const ex = duelExact(cfg, f, A, B, 1), sm = duelSim(cfg, f, A, B, 1, 20000, 100 + i);
      const se = Math.sqrt(Math.max(ex.winA * (1 - ex.winA), 1e-4) / 20000);
      assert.ok(Math.abs(ex.winA - sm.winA) <= 4 * se, `${i} ${mode}: ${ex.winA} vs ${sm.winA}`);
      assert.ok(Math.abs(ex.draw - sm.draw) <= 4 * Math.sqrt(Math.max(ex.draw * (1 - ex.draw), 1e-4) / 20000), `${i} ${mode} 무승부`);
    }
  }
});

test('데미지 변동이 있으면 정확해 대신 시뮬레이션 + 신뢰 구간', () => {
  const cfg = cfgOf([ent('A', { hp: 300, atk: 40, acc: 100, crid: 1.5, aspd: 1 }, 0.2), ent('B', { hp: 300, atk: 40, acc: 100, crid: 1.5, aspd: 1 })]);
  const { f } = compileRules(cfg);
  assert.equal(duelExact(cfg, f, cfg.entities[0], cfg.entities[1], 1), null);
  const mx = matrix(cfg, f, 1, { runs: 2000 });
  const c = mx.cell[0][1];
  assert.equal(c.exact, false);
  assert.ok(c.ci[0] <= c.win && c.win <= c.ci[1]);
});

test('승률 행렬: 한 쌍은 한 번만 계산 — A 대 B 승 = B 대 A 패, 승 + 패 + 무 = 1', () => {
  const cfg = TEMPLATES.classes.make();
  const { f } = compileRules(cfg);
  const mx = matrix(cfg, f, 10);
  const n = cfg.entities.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) { assert.equal(mx.cell[i][j], null); continue; }
    close(mx.cell[i][j].win, mx.cell[j][i].lose, 1e-15);
    close(mx.cell[i][j].win + mx.cell[i][j].lose + mx.cell[i][j].draw, 1, 1e-9);
  }
  assert.equal(mx.allExact, true);
});

test('Wilson 신뢰 구간·순위 상관', () => {
  const [lo, hi] = wilson(50, 100);
  close(lo, 0.4038, 1e-3); close(hi, 0.5962, 1e-3);
  const [l0] = wilson(0, 100);
  assert.equal(l0, 0);
  close(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1, 1e-12);
  close(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1, 1e-12);
});

test('역전 레벨: 두 곡선의 차이 부호가 바뀌는 레벨', () => {
  const s = [{ id: 'a', name: 'A', data: [1, 2, 3, 4, 5] }, { id: 'b', name: 'B', data: [3, 3, 3, 3, 3] }];
  assert.deepEqual(crossovers(s).map(c => [c.lv, c.up]), [[4, 'a']]);
});

test('템플릿: 모두 계산되고, 4직업은 CP와 실제 승률이 어긋나는 쌍을 잡는다', () => {
  for (const [id, t] of Object.entries(TEMPLATES)) {
    const cfg = t.make();
    assert.deepEqual(validate(cfg), [], id);
    const res = analyze(cfg);
    assert.equal(res.ok, true, `${id} ${res.errors}`);
  }
  const res = analyze(TEMPLATES.classes.make());
  const inv = res.cv.pairs.map(p => `${p.hi.name}>${p.lo.name}`);
  assert.ok(inv.includes('궁수>전사'), inv.join(','));
  assert.ok(res.findings.some(f => f.kind === 'cpInversion'));
  assert.ok(res.cross.length > 0);
  // Kalivra 샘플은 변동이 있어 시뮬레이션
  assert.equal(analyze(TEMPLATES.kalivra.make()).mx.allExact, false);
});

test('Kalivra 프로젝트 가져오기: 기본 샘플(접두어 없는 데미지 수식)·아이템·특성', () => {
  const doc = {
    schemaVersion: 1, meta: { projectName: 'Sample' }, snapshots: [], itemSets: [],
    current: {
      entities: [
        { id: 1767762044000, name: 'Chicken', color: '#ffcc00', variance: 0.1, stats: { hp: { b: 150, g: 15 }, atk: { b: 25, g: 5 }, def: { b: 2, g: 0.5 }, acc: { b: 100, g: 0 }, eva: { b: 30, g: 2 }, cric: { b: 20, g: 0 }, crid: { b: 2, g: 0 }, aspd: { b: 1.5, g: 0.1 } } },
        { id: 1767762044001, name: 'Godzilla', color: '#4ecca3', variance: 0.2, stats: { hp: { b: 500, g: 100 }, atk: { b: 50, g: 10 } } },
      ],
      items: [{ id: 1767762044002, name: 'Bawky', active: true, targets: [1767762044000], modifiers: [{ stat: 'atk', op: 'mult', val: 1.5 }, { stat: 'atk', op: 'add', val: 5 }], traits: [{ name: 'Golden Egg', triggers: [{ type: 'OnHitTaken', conditions: [{ type: 'Chance', value: 30 }], effects: [{ type: 'Heal', target: 'Self', value: 20 }] }] }] }],
      gameRules: { stats: STAT_IDS, dmgFormula: 'atk * (100 / (100 + def))', hitFormula: '(a.acc - b.eva)', cpFormula: 'hp * 0.5 + atk * 2' },
    },
  };
  const { cfg, notes } = fromKalivra(doc, TEMPLATES.blank.make());
  assert.equal(cfg.entities.length, 2);
  assert.equal(cfg.entities[0].id, 'e1');
  assert.deepEqual(cfg.items[0].targets, ['e1']);
  assert.deepEqual(cfg.items[0].mods, [{ stat: 'atk', mult: 1.5 }, { stat: 'atk', flat: 5 }]);
  assert.equal(cfg.entities[1].stats.def.b, 0);
  assert.equal(cfg.rules.mode, 'turn');
  assert.ok(notes.some(n => /특성 1개를 가져왔습니다/.test(n)));
  assert.deepEqual(cfg.items[0].traits, [{ name: 'Golden Egg', on: 'hitTaken', chance: 30, cond: null, max: 0, effects: [{ type: 'heal', who: 'self', value: 20, base: 'fixed' }] }]);
  assert.ok(notes.some(n => /a\.\/b\. 접두어가 없습니다/.test(n)));
  assert.ok(notes.some(n => /Chicken\.atk/.test(n)));
  const res = analyze(cfg);
  assert.equal(res.ok, false);
  assert.ok(res.formulaErrors.damage);
  // 옛 형식(current 없음)도 받음
  assert.equal(fromKalivra({ entities: doc.current.entities, items: [], rules: doc.current.gameRules }, TEMPLATES.blank.make()).cfg.entities.length, 2);
  assert.throws(() => fromKalivra({ foo: 1 }, TEMPLATES.blank.make()));
});

test('조사: 받침에 따라 이/가, 을/를', () => {
  assert.equal(josa('암살자', '이', '가'), '암살자가');
  assert.equal(josa('전사', '이', '가'), '전사가');
  assert.equal(josa('궁수병', '을', '를'), '궁수병을');
  assert.equal(josa('Chicken', '이', '가'), 'Chicken이(가)');
});

test('prepare: 레벨·아이템이 반영된 스탯과 체력', () => {
  const cfg = TEMPLATES.classes.make();
  const { f } = compileRules(cfg);
  const p = prepare(cfg, f, cfg.entities[1], cfg.entities[0], 10);
  close(p.sa.atk, (32 + 3.5 * 9) * 1.15, 1e-9); // 전설 활 +15%
  assert.equal(p.hpA, 380 + 22 * 9);
});

// ── 특성(트리거) ────────────────────────────────────────
const conv = {
  T1: [{ name: 'Lifesteal', on: 'attackHit', chance: 50, cond: null, max: 0, effects: [{ type: 'heal', who: 'self', base: 'dmg', value: 60 }] }],
  T2: [{ name: 'Fury', on: 'beforeAttack', chance: 25, cond: null, max: 0, effects: [{ type: 'dmgMult', who: 'self', value: 1.8 }] }],
};
test('특성 시뮬레이션 = Kalivra v1.0.1 엔진 (흡혈·공격 직전 배율, 4σ 안)', () => {
  for (const c of ref.traitCases) {
    const cfg = fromRef(c, 'turn');
    cfg.entities[1].traits = conv[c.id];
    const { f } = compileRules(cfg);
    const [A, B] = cfg.entities;
    assert.equal(duelExact(cfg, f, A, B, 1), null, '특성이 있으면 정확해 없음');
    const sm = duelSim(cfg, f, A, B, 1, 100000, 31);
    const k = c.kalivra, se = Math.sqrt(k.winA * (1 - k.winA) / k.runs + sm.winA * (1 - sm.winA) / sm.runs);
    assert.ok(Math.abs(sm.winA - k.winA) <= 4 * se, `${c.id}: ${sm.winA} vs ${k.winA}`);
  }
});

const traitCfg = (traitsB, extraB = {}, rules = {}) => cfgOf([
  ent('A', { hp: 1000, atk: 30, acc: 100, crid: 1.5, aspd: 1 }),
  { ...ent('B', { hp: 1000, atk: 30, acc: 100, crid: 1.5, aspd: 1, ...extraB }), traits: traitsB },
], rules);
const logOf = (cfg, seed = 1) => { const { f } = compileRules(cfg); return battleOnce(cfg, f, cfg.entities[0], cfg.entities[1], 1, mulberry32(seed), true); };

test('피격 스탯 버프는 적중 한 번에 한 번 (Kalivra는 두 번)', () => {
  const cfg = traitCfg([{ name: '단단해짐', on: 'hitTaken', chance: 100, max: 0, effects: [{ type: 'buff', who: 'self', stat: 'def', value: 10, base: 'fixed', dur: 0 }] }]);
  const r = logOf(cfg);
  const hitsOnB = r.ev.filter(e => e.who === 'A' && (e.type === 'hit' || e.type === 'crit')).length;
  const buffs = r.ev.filter(e => e.type === 'buff' && e.who === 'B').length;
  const lethal = r.w === 1 ? 1 : 0; // 쓰러뜨린 공격 뒤에는 피격 효과 없음
  assert.equal(buffs, hitsOnB - lethal);
  assert.equal(r.B.stats.def, 10 * buffs);
});

test('최대 발동·체력 조건·쓰러뜨린 뒤 피격 효과 없음', () => {
  // 광폭화: 체력 30% 이하로 맞으면 한 번만
  const cfg = traitCfg([{ name: '광폭화', on: 'hitTaken', chance: 100, cond: { who: 'self', below: 30 }, max: 1, effects: [{ type: 'buff', who: 'self', stat: 'atk', value: 50, base: 'stat', dur: 0 }] }]);
  for (let s = 1; s <= 20; s++) {
    const r = logOf(cfg, s);
    const procs = r.ev.filter(e => e.type === 'buff');
    assert.ok(procs.length <= 1);
    if (procs.length) assert.ok(procs[0].hpB / 1000 <= 0.3 + 1e-12, `${procs[0].hpB}`);
  }
  // 한 방에 쓰러지면 피격 회복이 나오지 않음
  const one = cfgOf([ent('A', { hp: 100, atk: 1000, acc: 100, crid: 1.5, aspd: 2 }), { ...ent('B', { hp: 100, atk: 1, acc: 100, crid: 1.5, aspd: 1 }), traits: [{ name: '불사', on: 'hitTaken', chance: 100, max: 0, effects: [{ type: 'heal', who: 'self', value: 10000, base: 'fixed' }] }] }], { tie: 'simul' });
  const { f } = compileRules(one);
  const sm = duelSim(one, f, one.entities[0], one.entities[1], 1, 500, 3);
  assert.equal(sm.winA + sm.draw, 1); // 0초에 둘 다 공격 — A는 B를 한 방, B는 A를 못 쓰러뜨림
  assert.equal(sm.winA, 1);
});

test('시간 기반 버프 지속·공격 속도 버프는 다음 공격부터, 매 1초 트리거', () => {
  const cfg = traitCfg([
    { name: '가속', on: 'battleStart', chance: 100, max: 0, effects: [{ type: 'buff', who: 'self', stat: 'aspd', value: 1, base: 'fixed', dur: 3 }] },
    { name: '재생', on: 'turn', chance: 100, max: 0, effects: [{ type: 'heal', who: 'self', value: 1, base: 'maxHp' }] },
  ]);
  const r = logOf(cfg);
  const bAttacks = r.ev.filter(e => e.who === 'B' && ['hit', 'crit', 'miss'].includes(e.type)).map(e => +e.t.toFixed(6));
  // 0초부터 2회/초 → 0, 0.5, … 3초에 버프 끝 → 이후 1회/초
  assert.deepEqual(bAttacks.slice(0, 7), [0, 0.5, 1, 1.5, 2, 2.5, 3]);
  assert.ok(r.ev.some(e => e.type === 'expire' && Math.abs(e.t - 3) < 1e-9));
  assert.ok(r.ev.filter(e => e.type === 'heal').length >= 1);
  assert.equal(r.ev.find(e => e.type === 'heal').t, 1);
});

test('특성 경고·특성이 있으면 이유 = 특성', () => {
  const cfg = traitCfg([{ name: '엉뚱', on: 'miss', chance: 100, max: 0, effects: [{ type: 'dmgMult', who: 'self', value: 2 }, { type: 'buff', who: 'self', stat: 'nope', value: 1 }] }]);
  const w = traitWarnings(cfg);
  assert.equal(w.length, 2);
  const { f } = compileRules(cfg);
  assert.equal(duel(cfg, f, cfg.entities[0], cfg.entities[1], 1, { runs: 200 }).reason, '특성');
});

// ── 구간 리포트·상성 순환 ─────────────────────────────────
test('구간: 기본은 1/3·2/3, 직접 정한 경계, 정확해 템플릿은 모든 레벨', () => {
  assert.deepEqual(phaseRanges({ maxLevel: 30 }), [{ from: 1, to: 10 }, { from: 11, to: 20 }, { from: 21, to: 30 }]);
  assert.deepEqual(phaseRanges({ maxLevel: 30, phases: [25, 5, 5, 40] }), [{ from: 1, to: 5 }, { from: 6, to: 25 }, { from: 26, to: 30 }]);
  const cfg = TEMPLATES.classes.make();
  const { f } = compileRules(cfg);
  const sw = levelSweep(cfg, f);
  assert.equal(sw.exact, true);
  assert.equal(sw.levels.length, 30);
  const mx10 = matrix(cfg, f, 10);
  close(sw.win[9][2][0], mx10.cell[2][0].win, 1e-12);
  const pr = phaseReport(cfg, sw);
  assert.equal(pr.phases.length, 3);
  assert.ok(pr.findings.some(x => x.kind === 'phaseDominant' && /암살자/.test(x.text)));
  // 시뮬레이션이 필요하면 예산 안에서 반복 수를 줄임
  const plan = sweepPlan(TEMPLATES.traits.make(), { budget: 6e4 });
  assert.ok(plan.runs >= 100 && plan.runs * 6 * plan.levels.length <= 6e4 * 1.2);
});

test('상성 순환: A > B > C > A', () => {
  const E = ['A', 'B', 'C'].map(id => ({ id, name: id }));
  const c = (w) => ({ win: w, lose: 1 - w, draw: 0, exact: true });
  const mx = { lv: 1, cell: [[null, c(0.7), c(0.3)], [c(0.3), null, c(0.8)], [c(0.7), c(0.2), null]] };
  const cy = cycles({ entities: E }, mx);
  assert.equal(cy.length, 1);
  assert.deepEqual(cy[0].names, ['A', 'B', 'C']);
  mx.cell[2][0] = c(0.5); mx.cell[0][2] = c(0.5);
  assert.equal(cycles({ entities: E }, mx).length, 0);
});

test('특성 템플릿·Kalivra 샘플(Golden Egg 포함) 계산', () => {
  for (const id of ['traits', 'kalivra']) {
    const res = analyze(TEMPLATES[id].make());
    assert.equal(res.ok, true, id);
    assert.equal(res.mx.allExact, false);
  }
});

// ── 밸런스 도구 (4단계) ─────────────────────────────────
test('목표 역산: CP는 성장값을 정확히, 승률은 목표를 처음 넘는 값(계단 모양)', () => {
  const cfg = TEMPLATES.classes.make();
  const { f } = compileRules(cfg);
  const r = solveTarget(cfg, f, { metric: 'cp', entity: 'e2', lv: 20, stat: 'atk', part: 'g', target: 4000 });
  assert.equal(r.feasible, true);
  const after = withParam(cfg, 'e2', 'atk', 'g', r.value);
  close(f.cp(statsAt(after, after.entities[1], 20), 20), 4000, 1e-6);
  // 점수 목표: 도달 점수 ≥ 목표, 조금 덜 바꾸면 목표 미만
  const s = solveTarget(cfg, f, { metric: 'score', entity: 'e2', opponent: 'e1', lv: 10, stat: 'atk', part: 'b', target: 0.5 });
  assert.equal(s.feasible, true);
  assert.ok(s.achieved >= 0.5);
  const less = scoreOf(withParam(cfg, 'e2', 'atk', 'b', s.from + (s.value - s.from) * 0.98), f, 'e2', 'e1', 10).score;
  assert.ok(less < 0.5, String(less));
});

test('최소 변경(스탯 배율): 적용하면 목표 이상, 바로 아래 배율은 미만, 닿지 않는 스탯은 표시', () => {
  const cfg = TEMPLATES.classes.make();
  const { f } = compileRules(cfg);
  const rows = minChanges(cfg, f, { a: 'e2', b: 'e1', lv: 10, target: 0.5 });
  const ok = rows.filter(r => r.feasible);
  assert.ok(ok.length >= 3);
  for (const r of ok) {
    assert.ok(r.value >= 0.5 && r.below < 0.5 + 1e-12, `${r.stat} ${r.value} ${r.below}`);
    close(scoreOf(withScale(cfg, 'e2', r.stat, r.k), f, 'e2', 'e1', 10).score, r.value, 1e-12);
  }
  // 궁수의 명중은 이미 상한(95%)에 막혀 배율로는 못 닿음
  assert.equal(rows.find(r => r.stat === 'acc').feasible, false);
  // 정렬: 필요한 변화가 작은 순
  for (let i = 1; i < ok.length; i++) assert.ok(Math.abs(Math.log(ok[i].k)) >= Math.abs(Math.log(ok[i - 1].k)));
  // 적용(배율을 b·g에 곱함) = 수정자 ×k 결과
  const c2 = structuredClone(cfg);
  applyScale(c2.entities[1], c2.stats.find(s => s.id === ok[0].stat), ok[0].k);
  close(scoreOf(c2, f, 'e2', 'e1', 10).score, ok[0].value, 0.02);
});

test('민감도·효과 분해: 공격력 +10%면 오르고, 아이템을 빼면 그만큼 내려간다', () => {
  const cfg = TEMPLATES.classes.make();
  const { f } = compileRules(cfg);
  const se = battleSensitivity(cfg, f, { a: 'e2', b: 'e1', lv: 10, pct: 10 });
  const atk = se.rows.find(r => r.side === 'e2' && r.stat === 'atk');
  assert.ok(atk.hi > 0 && atk.lo < 0);
  const oppAtk = se.rows.find(r => r.side === 'e1' && r.stat === 'atk');
  assert.ok(oppAtk.hi < 0);
  for (let i = 1; i < se.rows.length; i++) assert.ok(se.rows[i].swing <= se.rows[i - 1].swing);
  const co = contributions(cfg, f, { a: 'e2', b: 'e1', lv: 10 });
  const bow = co.rows.find(r => r.name === '전설 활');
  const off = { ...cfg, items: [] };
  close(bow.delta, co.base - scoreOf(off, f, 'e2', 'e1', 10).score, 1e-12);
  assert.ok(bow.delta > 0);
  // 모든 상대 평균
  const all = scoreOf(cfg, f, 'e3', 'all', 10).score;
  const mx = matrix(cfg, f, 10);
  close(all, mx.score[2], 1e-12);
});
