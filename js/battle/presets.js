// 스탯·전투 밸런스 템플릿 — 수치는 가상의 설계 예시

const STATS = () => [
  { id: 'hp', name: '체력', growth: 'linear', min: 1 },
  { id: 'atk', name: '공격력', growth: 'linear', min: 0 },
  { id: 'def', name: '방어력', growth: 'linear', min: 0 },
  { id: 'acc', name: '명중', growth: 'linear' },
  { id: 'eva', name: '회피', growth: 'linear' },
  { id: 'cric', name: '치명 확률(%)', growth: 'linear', min: 0, max: 100 },
  { id: 'crid', name: '치명 배율', growth: 'linear', min: 1 },
  { id: 'aspd', name: '공격 속도', growth: 'linear', min: 0 },
];
const RULES = (o = {}) => ({
  damage: 'a.atk * 100 / (100 + b.def)', hit: 'a.acc - b.eva', critChance: 'a.cric', critMult: 'a.crid',
  speed: 'aspd', hp: 'hp', cp: 'atk * aspd * 10 + hp * 0.5 + def * 1.5 + acc + eva * 2',
  mode: 'time', tie: 'coin', maxTime: 120, maxTurns: 200, hitMin: 5, hitMax: 100, round: 'floor', ...o,
});
const st = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? { b: v[0], g: v[1] } : { b: v, g: 0 }]));

/** 수식 프리셋: 고르면 해당 칸에 들어간다 */
export const FORMULA_PRESETS = {
  damage: [
    ['방어 감쇠형 (100 ÷ (100 + 방어))', 'a.atk * 100 / (100 + b.def)'],
    ['차감형 (최소 10%)', 'max(a.atk - b.def, a.atk * 0.1)'],
    ['비율형 (공 ÷ 방, 상한 3배)', 'a.atk * min(a.atk / max(b.def, 1), 3)'],
    ['레벨 차 보정', 'a.atk * 100 / (100 + b.def) * (1 + 0.02 * (a.lv - b.lv))'],
  ],
  hit: [['명중 − 회피', 'a.acc - b.eva'], ['비율 (명중 ÷ (명중 + 회피))', '100 * a.acc / (a.acc + b.eva)'], ['항상 명중', '100']],
  cp: [
    ['가중 합 (Kalivra 기본)', 'atk * aspd * 10 + hp * 0.5 + def * 1.5 + acc + eva * 2'],
    ['기대 DPS × 체력 제곱근', 'atk * aspd * (1 + cric / 100 * (crid - 1)) * sqrt(hp)'],
  ],
};

export const TEMPLATES = {
  classes: {
    label: '4직업 — 전사·궁수·암살자·탱커 (시간 기반)',
    note: '레벨 30까지 선형 성장. 기본 CP 수식(가중 합)이 공격 속도를 크게 쳐서 궁수의 CP가 2위인데, Lv10 실제 승률은 전사에게 25%, 탱커에게 45%입니다 — CP와 실제 승률이 어긋나는 예시.',
    make: () => ({
      maxLevel: 30, level: 10, metric: 'cp', ref: 'e1', sim: { runs: 4000 },
      stats: STATS(),
      entities: [
        { id: 'e1', name: '전사', variance: 0, stats: st({ hp: [600, 40], atk: [45, 5], def: [30, 2], acc: 90, eva: 5, cric: 10, crid: 1.5, aspd: [1, 0.01] }) },
        { id: 'e2', name: '궁수', variance: 0, stats: st({ hp: [380, 22], atk: [32, 3.5], def: [10, 0.8], acc: 100, eva: [15, 0.3], cric: 20, crid: 1.7, aspd: [1.5, 0.02] }) },
        { id: 'e3', name: '암살자', variance: 0, stats: st({ hp: [340, 20], atk: [55, 5.5], def: [8, 0.5], acc: 95, eva: [30, 0.5], cric: 35, crid: 2, aspd: [1.2, 0.01] }) },
        { id: 'e4', name: '탱커', variance: 0, stats: st({ hp: [900, 70], atk: [30, 2.5], def: [80, 5], acc: 85, eva: 0, cric: 5, crid: 1.5, aspd: 0.8 }) },
      ],
      items: [
        { id: 'i1', name: '전설 활', active: true, targets: ['e2'], mods: [{ stat: 'atk', pct: 15 }, { stat: 'cric', flat: 5 }] },
      ],
      rules: RULES(),
    }),
  },
  kalivra: {
    label: 'Kalivra 기본 샘플 — Chicken 대 Godzilla (턴 교대)',
    note: 'Kalivra가 처음 열 때 만드는 프로젝트. 원본 데미지 수식(atk * (100 / (100 + def)))은 a./b. 접두어가 없어 Kalivra에서 데미지 0 → 1만 회 모두 200턴 무승부가 됩니다(실행해서 확인). 여기서는 a.atk, b.def로 고쳤고, Bawky 아이템의 특성(Golden Egg)은 아직 지원하지 않아 뺐습니다. 데미지 변동(±10%, ±20%)이 있어 시뮬레이션으로 계산합니다. 규칙에서 "시간 기반"으로 바꾸면 공격 속도가 공격 횟수에 반영됩니다.',
    make: () => ({
      maxLevel: 20, level: 10, metric: 'cp', ref: 'e1', sim: { runs: 4000 },
      stats: STATS(),
      entities: [
        { id: 'e1', name: 'Chicken', variance: 0.1, stats: st({ hp: [150, 15], atk: [25, 5], def: [2, 0.5], acc: 100, eva: [30, 2], cric: 20, crid: 2, aspd: [1.5, 0.1] }) },
        { id: 'e2', name: 'Godzilla', variance: 0.2, stats: st({ hp: [500, 100], atk: [50, 10], def: [20, 5], acc: 80, eva: 5, cric: 10, crid: 1.5, aspd: [0.5, 0.02] }) },
      ],
      items: [{ id: 'i1', name: 'Bawky', active: true, targets: ['e1'], mods: [{ stat: 'atk', mult: 1.5 }, { stat: 'aspd', flat: 0.5 }] }],
      rules: RULES({ mode: 'turn', cp: 'hp * 0.5 + atk * 2 + def + acc + eva + aspd * 5' }),
    }),
  },
  blank: {
    label: '빈 설계 (직접 입력)',
    note: '엔티티 2개, 기본 스탯 8개. 스탯·엔티티·아이템을 추가하고 규칙 수식을 바꿔 보세요.',
    make: () => ({
      maxLevel: 20, level: 1, metric: 'cp', ref: 'e1', sim: { runs: 4000 },
      stats: STATS(),
      entities: [
        { id: 'e1', name: '엔티티 1', variance: 0, stats: st({ hp: [200, 20], atk: [20, 2], def: [5, 0], acc: 95, eva: [20, 1], cric: 15, crid: 1.5, aspd: 1 }) },
        { id: 'e2', name: '엔티티 2', variance: 0, stats: st({ hp: [200, 20], atk: [20, 2], def: [5, 0], acc: 95, eva: [20, 1], cric: 15, crid: 1.5, aspd: 1 }) },
      ],
      items: [],
      rules: RULES(),
    }),
  },
};
