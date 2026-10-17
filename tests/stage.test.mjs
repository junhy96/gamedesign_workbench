// 실행: npm test  (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze, validate, cumCost, stepCost, parseIntervalsCSV, parseCSV, intervalsToCSV, fmtBig, fmtBigShort, fmtDur, quick, levers, leverValue, withLever, sensitivity, solveLevers } from '../js/stage/model.js';
import { TEMPLATES } from '../js/stage/presets.js';

const sample = JSON.parse(readFileSync(new URL('../docs/samples/stage-idle-growth.json', import.meta.url), 'utf8'));
const csvText = readFileSync(new URL('../docs/samples/stage-cost-intervals.csv', import.meta.url), 'utf8');
const exp = sample.expected;
const r = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg ?? ''} ${a} vs ${b}`);

test('모든 템플릿이 검증을 통과하고 계산된다', () => {
  for (const id of Object.keys(TEMPLATES)) {
    const cfg = TEMPLATES[id].make();
    assert.deepEqual(validate(cfg), [], id);
    const res = analyze(cfg);
    assert.equal(res.ok, true, id);
    assert.ok(res.totalSec > 0 && Number.isFinite(res.totalSec), id);
  }
});

test('idle 템플릿 = 샘플 JSON의 state (구간 표·수치 동일)', () => {
  const tpl = TEMPLATES.idle.make();
  for (const [k, v] of Object.entries(tpl)) {
    if (k === 'intendedDwell') { assert.equal(v.baseSeconds, sample.state.intendedDwell.baseSeconds); assert.equal(v.perChapterMult, sample.state.intendedDwell.perChapterMult); }
    else assert.deepEqual(v, sample.state[k], k);
  }
});

test('샘플: 누적 비용 = expected.cumCost', () => {
  const ivs = sample.state.costIntervals;
  for (const [key, want] of Object.entries(exp.cumCost)) close(cumCost(ivs, Number(key.slice(1))), want, 1e-12, key);
});

test('누적 비용 공식 = 레벨별 직접 합산 (끝 없는 구간 포함 0~150,000)', () => {
  const ivs = sample.state.costIntervals;
  let brute = 0;
  for (let L = 0; L < 150000; L++) {
    brute += stepCost(ivs, L);
    if ([1, 200, 999, 5000, 19999, 100000, 149999].includes(L + 1)) close(cumCost(ivs, L + 1), brute, 1e-12, `L=${L + 1}`);
  }
});

test('샘플: 체크포인트·총 시간·정체 스테이지 = expected', () => {
  const res = analyze(sample.state);
  assert.equal(res.ok, true);
  for (const cp of exp.checkpoints) {
    const st = res.stages.find(x => x.label === cp.stage);
    assert.equal(st.levelReq, cp.levelReq, `${cp.stage} 필요 레벨`);
    assert.equal(r(st.goldNeeded, 0), cp.goldNeeded, `${cp.stage} 필요 골드`);
    assert.equal(r(st.dwellSec, 1), cp.dwellSec, `${cp.stage} 실제 체류`);
    assert.equal(r(st.intendedSec, 1), cp.intendedSec, `${cp.stage} 의도 체류`);
    close(st.elapsedSec, cp.elapsedSec, 1e-12, `${cp.stage} 누적 시간`);
    assert.equal(r(st.elapsedSec / 3600), cp.elapsedHours);
  }
  assert.equal(res.totalHours, exp.totalHours);
  assert.deepEqual(res.stagnantStages, exp.stagnantStages);
  assert.equal(res.stagnant.length, exp.stagnantCount);
});

test('샘플: 경고가 16~17챕터 정체와 5,000~20,000 구간을 원인으로 잡는다', () => {
  const res = analyze(sample.state);
  const chs = res.warnings.filter(w => w.kind === 'stagnant' && w.level === 'serious').map(w => w.chapter);
  assert.deepEqual(chs, [16, 17]);
  const cause = res.warnings.find(w => w.kind === 'cause');
  assert.ok(cause, '원인 구간 경고');
  assert.equal(cause.interval, 3);
  assert.match(cause.text, /5,000~20,000/);
  assert.equal(res.intervals[3].stagnant.length, 7);
  // 1-3은 정수 레벨 올림으로 생긴 단발 정체 → 주의 단계
  assert.equal(res.warnings.find(w => w.kind === 'stagnant' && w.chapter === 1).level, 'warn');
});

test('증가폭을 앞 구간 수준으로 낮추면 16~17챕터 정체가 사라진다', () => {
  const cfg = structuredClone(sample.state);
  const ivs = cfg.costIntervals;
  ivs[3].step = 8;
  for (let i = 4; i < ivs.length; i++) ivs[i].initCost = ivs[i - 1].initCost + ivs[i - 1].step * (ivs[i - 1].lvMax - ivs[i - 1].lvMin);
  const res = analyze(cfg);
  assert.ok(!res.stagnantStages.some(s => /^1[67]-/.test(s)), res.stagnantStages.join(','));
  assert.ok(!res.warnings.some(w => w.kind === 'cause' && w.interval === 3));
});

test('quick = analyze (총 소요·정체 스테이지)', () => {
  for (const cfg of [sample.state, ...Object.values(TEMPLATES).map(t => t.make())]) {
    const a = analyze(cfg), q = quick(cfg);
    close(q.total, a.totalSec, 1e-12);
    assert.deepEqual(a.stagnant.map(x => x.s), [...q.stagnant.keys()].filter(s => q.stagnant[s]));
  }
});

test('반대 가정 원인: 경고가 말한 만큼 실제로 풀린다 (다시 계산해 확인)', () => {
  const res = analyze(sample.state);
  const cause = res.warnings.find(w => w.kind === 'cause');
  assert.equal(res.problem.length, 7); // 1-3 단발 정체는 대상 밖
  const after = analyze(withLever(sample.state, cause.fix.lever, cause.fix.value));
  assert.ok(res.problem.every(s => !after.stages[s - 1].stagnant));
  assert.match(cause.text, /7곳 중 7곳/);
  assert.deepEqual(sample.state.costIntervals[3].step, 30, '원본은 그대로');
});

test('구간 탓이 아닌 정체는 전체 변수 경고 (빈 템플릿)', () => {
  const res = analyze(TEMPLATES.blank.make());
  assert.ok(res.stagnant.length > 0);
  assert.ok(!res.warnings.some(w => w.kind === 'cause' && w.level === 'serious'));
  assert.ok(res.warnings.some(w => w.kind === 'global'));
});

test('민감도: 증가율은 증가분 기준으로 움직이고, 샘플에서 체력 증가율이 가장 크게 흔든다', () => {
  const sens = sensitivity(sample.state, 10);
  const top = sens.rows[0];
  assert.equal(top.lever.id, 'hpGrowth');
  close(top.lo.value, 0.036, 1e-9); close(top.hi.value, 0.044, 1e-9);
  const hi = analyze({ ...sample.state, hpGrowth: 1.044 });
  close(top.hi.total, hi.totalSec, 1e-12);
  // 비용 구간 증가폭보다 성장률 쪽이 훨씬 크다
  const step = sens.rows.find(r => r.lever.id === 'iv3.step');
  assert.ok(top.swing > 10 * step.swing);
  // 아직 도달하지 않는 구간(끝 없는 마지막 구간 등)은 영향 없음으로 빠짐
  assert.ok(sens.flat >= 1);
  assert.ok(sens.rows.every(r => r.lever.group !== 'intent'));
});

test('해소에 필요한 최소 변경: 적용하면 모두 풀리고, 절반만 바꾸면 남는다', () => {
  const res = analyze(sample.state);
  const sol = solveLevers(sample.state, res);
  assert.equal(sol.rows[0].lever.id, 'hpGrowth');
  for (const r of sol.rows.filter(x => x.feasible)) {
    const after = analyze(withLever(sample.state, r.lever, r.target));
    assert.ok(res.problem.every(s => !after.stages[s - 1].stagnant), r.lever.id);
    const half = r.value + (r.target - r.value) / 2;
    const mid = analyze(withLever(sample.state, r.lever, half));
    assert.ok(res.problem.some(s => mid.stages[s - 1].stagnant), `${r.lever.id} 최소성`);
  }
  // 체력 증가율 4%를 1%도 안 줄여도 풀린다 (구간 증가폭은 13% 넘게 줄여야)
  assert.ok(Math.abs(sol.rows[0].change) < 0.01);
  assert.ok(Math.abs(sol.rows.find(r => r.lever.id === 'iv3.step').change) > 0.1);
  assert.equal(sol.rows.find(r => r.lever.id === 'waveSeconds'), undefined, '방향이 정해지지 않는 변수는 제외');
});

test('레버 값 왕복: 증가율 1.04 ↔ 0.04, 의도 배수, 구간', () => {
  const ls = levers(sample.state);
  const hp = ls.find(l => l.id === 'hpGrowth');
  assert.equal(leverValue(sample.state, hp), 0.04);
  assert.equal(withLever(sample.state, hp, 0.05).hpGrowth, 1.05);
  const intent = ls.find(l => l.id === 'intent');
  assert.equal(withLever(sample.state, intent, 0.5).intendedDwell.perChapterMult, 1.5);
  const iv = ls.find(l => l.id === 'iv2.initCost');
  assert.equal(withLever(sample.state, iv, 1).costIntervals[2].initCost, 1);
  assert.equal(sample.state.costIntervals[2].initCost, 8150);
});

test('CSV 샘플 = JSON의 costIntervals (빈 LV_MAX = 끝 없음)', () => {
  const p = parseIntervalsCSV(csvText);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.intervals, sample.state.costIntervals);
  assert.equal(p.intervals.at(-1).lvMax, null);
  assert.equal(intervalsToCSV(p.intervals), csvText.replace(/^﻿/, ''));
});

test('CSV: 엑셀 붙여넣기(탭·천 단위 쉼표)·한글 머리글·열 순서 바뀜', () => {
  const tsv = '증가폭\t시작레벨\t끝레벨\t시작비용\n4.5\t0\t200\t50\n9\t200\t\t"950"\n';
  const p = parseIntervalsCSV(tsv);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.intervals, [{ lvMin: 0, lvMax: 200, initCost: 50, step: 4.5 }, { lvMin: 200, lvMax: null, initCost: 950, step: 9 }]);
  const big = parseIntervalsCSV('LV_MIN\tLV_MAX\tINIT_COST\tSTEP\n0\t100000\t50\t15\n100000\t\t1,690,150\t15');
  assert.equal(big.intervals[1].initCost, 1690150);
});

test('CSV: 머리글 없음 → 순서대로, LV_MAX 열 없음 → 다음 줄 LV_MIN, 열 직접 지정', () => {
  assert.deepEqual(parseIntervalsCSV('0,200,50,4.5\n200,,950,9').intervals, [{ lvMin: 0, lvMax: 200, initCost: 50, step: 4.5 }, { lvMin: 200, lvMax: null, initCost: 950, step: 9 }]);
  assert.deepEqual(parseIntervalsCSV('from,cost,inc\n200,950,9\n0,50,4.5').intervals, [{ lvMin: 0, lvMax: 200, initCost: 50, step: 4.5 }, { lvMin: 200, lvMax: null, initCost: 950, step: 9 }]);
  const odd = 'a;b;c;d\n0;200;50;4,5'.replace('4,5', '4.5');
  const p = parseIntervalsCSV(odd, { hasHeader: true, map: { lvMin: 0, lvMax: 1, initCost: 2, step: 3 } });
  assert.deepEqual(p.intervals, [{ lvMin: 0, lvMax: 200, initCost: 50, step: 4.5 }]);
  assert.match(parseIntervalsCSV('a;b;c;d\n0;200;50;4').errors[0], /LV_MIN 열/);
  assert.deepEqual(parseCSV('"x, y",2\n').rows, [['x, y', '2']]);
});

test('CSV: 끊긴 구간·중간 끝 없음은 오류', () => {
  assert.ok(parseIntervalsCSV('LV_MIN,LV_MAX,INIT_COST,STEP\n0,200,50,4.5\n300,,950,9').errors.some(e => /이어지지/.test(e)));
  assert.ok(parseIntervalsCSV('LV_MIN,LV_MAX,INIT_COST,STEP\n0,,50,4.5\n200,,950,9').errors.some(e => /마지막 구간에만/.test(e)));
  assert.ok(parseIntervalsCSV('LV_MIN,LV_MAX,INIT_COST,STEP\n0,200,abc,4.5').errors.some(e => /숫자가 아닌/.test(e)));
});

test('끝이 있는 마지막 구간을 넘는 레벨은 공식 연장 + 경고', () => {
  const cfg = structuredClone(sample.state);
  cfg.costIntervals.at(-1).lvMax = 50000; // 100000 → 끝 50000 (앞 구간과 이어지지 않으니 앞 구간을 줄임)
  cfg.costIntervals.splice(5, 1);
  cfg.costIntervals[4].lvMax = 50000;
  const res = analyze(cfg);
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some(w => w.kind === 'beyond'));
  close(cumCost(cfg.costIntervals, 60000), cumCost(sample.state.costIntervals, 60000), 1e-12); // 같은 공식(증가폭 15)이라 값 동일
});

test('큰 수·시간 표시', () => {
  assert.equal(fmtBig(9999), '9,999');
  assert.equal(fmtBig(3643.5), '3,644');
  assert.equal(fmtBig(24123), '2만 4,123');
  assert.equal(fmtBig(99999.7), '10만');
  assert.equal(fmtBig(2576334670), '25억 7,633만');
  assert.equal(fmtBig(91288744950), '912억 8,874만');
  assert.equal(fmtBig(3.2e17), '32경');
  assert.equal(fmtBig(1.234e13), '12조 3,400억');
  assert.equal(fmtBig(1.2e21), '1.2e21');
  assert.equal(fmtBig(2576334670, 'exp'), '2.58e9');
  assert.equal(fmtBigShort(2576334670), '25.8억');
  assert.equal(fmtBigShort(16900000), '1,690만');
  assert.equal(fmtDur(30), '30초');
  assert.equal(fmtDur(71.5), '1분 12초');
  assert.equal(fmtDur(12990), '3시간 37분');
  assert.equal(fmtDur(282273), '3일 6시간');
});
