// 시뮬레이션 설정(시행 횟수·시드)과 입력 검증
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedMix, DEFAULT_SEED } from '../js/lib/simconfig.js';
import { checkValue } from '../js/lib/fieldcheck.js';
import { analyze as gacha } from '../js/gacha/model.js';
import { TEMPLATES as GT } from '../js/gacha/presets.js';
import { simulate } from '../js/enhance/simulate.js';
import { TEMPLATES as ET } from '../js/enhance/presets.js';
import { migrate } from '../js/enhance/model.js';

test('시드: 기본값이면 예전 고정 시드 그대로, 다른 값이면 다른 난수열', () => {
  assert.equal(seedMix(DEFAULT_SEED, 777), 777);
  assert.equal(seedMix(undefined, 777), 777);
  assert.notEqual(seedMix(1, 777), 777);
  assert.equal(seedMix(1, 777), seedMix(1, 777));
  assert.notEqual(seedMix(1, 777), seedMix(2, 777));
});

test('같은 시드 = 같은 결과, 다른 시드 = 다른 표본 (가챠·강화)', () => {
  const cfg = GT.pity.make();
  const a = gacha({ ...cfg, runs: 500, seed: 5 }), b = gacha({ ...cfg, runs: 500, seed: 5 }), c = gacha({ ...cfg, runs: 500, seed: 6 });
  const simGoal = a.goals.findIndex(g => !g.exact);
  if (simGoal >= 0) {
    assert.deepEqual([...a.goals[simGoal].sim.sorted], [...b.goals[simGoal].sim.sorted]);
    assert.notDeepEqual([...a.goals[simGoal].sim.sorted], [...c.goals[simGoal].sim.sorted]);
  }
  const ecfg = migrate({ v: 3, template: 'standard', ...ET.standard.make() });
  assert.deepEqual([...simulate(ecfg, 300, 11).costs ?? []], [...simulate(ecfg, 300, 11).costs ?? []]);
  assert.notEqual(simulate(ecfg, 300, 11).mean.cost, simulate(ecfg, 300, 12).mean.cost);
});

test('입력 검증: 확률 0% 미만·100% 초과, 음수, 숫자 아님', () => {
  assert.match(checkValue('120', { prob: true }), /100 이하/);
  assert.match(checkValue('-1', { min: 0 }), /음수 불가/);
  assert.match(checkValue('abc', {}), /숫자가 아닙니다/);
  assert.equal(checkValue('50', { prob: true }), '');
  assert.equal(checkValue('', { min: 0 }), '');
  assert.equal(checkValue('1,500', { min: 0 }), '');
  assert.match(checkValue('150', { min: 0, max: 100, label: '명중 상한' }), /명중 상한: 100 이하/);
});
