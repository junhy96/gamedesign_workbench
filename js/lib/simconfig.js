// 시뮬레이션 설정 — 시행 횟수와 랜덤 시드. 같은 시드면 같은 결과가 나온다.
// 강화·가챠·스탯 전투·전투 시뮬레이터가 같이 쓴다. 비교(조합·프리셋)는 같은 시드로 돌려 운 차이를 지운다.
import { h } from './util.js';
import { label } from './tip.js';

export const DEFAULT_SEED = 20261018;

/**
 * 시드 섞기: 사용자가 시드를 기본값으로 두면 예전과 같은 고정 시드(legacy)를 그대로 써서 결과가 바뀌지 않고,
 * 다른 시드를 넣으면 legacy와 섞어 다른(그러나 재현되는) 난수열을 만든다.
 */
export function seedMix(userSeed, legacy, def = DEFAULT_SEED) {
  if (userSeed == null || !Number.isFinite(userSeed) || userSeed === def) return legacy >>> 0;
  return (legacy ^ Math.imul((userSeed >>> 0) || 1, 2654435761)) >>> 0;
}

/**
 * 시행 횟수·시드 입력칸. obj[runsKey], obj[seedKey]를 고치고 onChange() 호출.
 * opts: { runsKey, seedKey, min, max, def, onChange, runsHint }
 */
export function simFields(obj, { runsKey = 'runs', seedKey = 'seed', min = 100, max = 200000, def = DEFAULT_SEED, onChange = () => {}, runsHint } = {}) {
  obj[seedKey] ??= def;
  const runsIn = h('input', {
    type: 'number', value: obj[runsKey], min, max, step: 100, inputmode: 'numeric', 'aria-label': '시행 횟수',
    oninput: (e) => { const v = Math.round(Number(e.target.value)); if (v >= min && v <= max) { obj[runsKey] = v; onChange(); } },
  });
  const seedIn = h('input', {
    type: 'number', value: obj[seedKey], min: 0, max: 4294967295, step: 1, inputmode: 'numeric', 'aria-label': '랜덤 시드',
    oninput: (e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v) && v >= 0) { obj[seedKey] = v; onChange(); } },
  });
  return [
    h('div.row2', {},
      h('label.field', {}, h('span', {}, ...label('시행 횟수', 'sim.runs')), runsIn, runsHint ? h('small', {}, runsHint) : null),
      h('label.field', {}, h('span', {}, ...label('랜덤 시드', 'sim.seed')), seedIn)),
    h('div.tool-actions', {},
      h('button.btn.small', { type: 'button', onclick: () => { obj[seedKey] = Math.floor(Math.random() * 1e9); seedIn.value = obj[seedKey]; onChange(); } }, '새 시드'),
      h('button.btn.small', { type: 'button', onclick: () => { obj[seedKey] = def; seedIn.value = def; onChange(); } }, '기본 시드')),
  ];
}
