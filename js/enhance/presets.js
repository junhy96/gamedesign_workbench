// 프리셋. 메이플 수치는 비공식 참고값(나무위키 정리, 2026-10 확인) — 공식 확률 공지로 재확인할 것.
import { mapleStarforceCost } from './model.js';

// [성공, 실패(유지), 실패(하락), 파괴] %. 2026-03-19 스타캐치 폐지 이후(성공 보너스 기본 적용) 일반 장비.
const KMS_TABLE = [
  [99.75, 0.25, 0, 0], [94.5, 5.5, 0, 0], [89.25, 10.75, 0, 0], [89.25, 10.75, 0, 0],
  [84, 16, 0, 0], [78.75, 21.25, 0, 0], [73.5, 26.5, 0, 0], [68.25, 31.75, 0, 0],
  [63, 37, 0, 0], [57.75, 42.25, 0, 0], [52.5, 47.5, 0, 0], [47.25, 52.75, 0, 0],
  [42, 58, 0, 0], [36.75, 63.25, 0, 0], [31.5, 68.5, 0, 0],
  [31.5, 66.445, 0, 2.055], [31.5, 66.445, 0, 2.055],
  [15.75, 77.51, 0, 6.74], [15.75, 77.51, 0, 6.74], [15.75, 75.825, 0, 8.425],
  [31.5, 58.225, 0, 10.275], [15.75, 71.6125, 0, 12.6375], [15.75, 67.4, 0, 16.85],
  [10.5, 71.6, 0, 17.9], [10.5, 71.6, 0, 17.9], [10.5, 71.6, 0, 17.9],
  // 26성: 출처 표기는 유지 74.16%(합 100.04%) — 합 100%가 되도록 74.12%로 보정
  [7.35, 74.12, 0, 18.53], [5.25, 75.8, 0, 18.95], [3.15, 77.48, 0, 19.37], [1.05, 79.16, 0, 19.79],
];

export function mapleRows(level) {
  return KMS_TABLE.map(([s, k, d, b], stage) => ({
    stage, s, k, d, b,
    cost: mapleStarforceCost(level, stage),
    protectable: stage >= 15 && stage <= 17, // KMS 파괴방지 적용 구간
  }));
}

// 하락 + 찬스타임 시연용 가상 테이블 (실제 게임 수치 아님)
function demoRows() {
  const rows = [];
  for (let stage = 0; stage < 15; stage++) {
    const s = stage < 5 ? 90 - stage * 5 : stage < 10 ? 60 - (stage - 5) * 4 : 40 - (stage - 10) * 3;
    const b = stage < 8 ? 0 : stage < 12 ? 2 + (stage - 8) : 6 + (stage - 12) * 2;
    const d = stage < 5 ? 0 : 100 - s - b;
    rows.push({ stage, s, k: 100 - s - d - b, d, b, cost: Math.round(1000 * 1.35 ** stage), protectable: true });
  }
  return rows;
}

export const PRESETS = {
  maple: {
    label: '메이플스토리 스타포스 (KMS 일반 장비)',
    note: '2026-03 스타캐치 폐지 이후 기준 · 비공식 참고값 · 15성 이상 실패 시 하락 없음',
    defaults: {
      level: 200, start: 15, target: 22, restore: 12, destroyCost: 0,
      chanceN: 0, protect: [], protectExtra: 2, costMult: 1,
      eventDestroyMult: 1, eventMaxStage: 21,
    },
    rows: (cfg) => mapleRows(cfg.level),
    events: { label: '샤이닝 스타포스', destroyMult: 0.7, maxStage: 21, costMult: 0.7 },
  },
  demo: {
    label: '하락 + 찬스타임 예시 (가상)',
    note: '실패 시 하락하는 구조를 보여주는 가상 수치 · 찬스타임을 켜고 꺼서 비교해 보세요',
    defaults: {
      start: 5, target: 14, restore: 8, destroyCost: 20000,
      chanceN: 2, protect: [], protectExtra: 1, costMult: 1,
      eventDestroyMult: 1, eventMaxStage: 99,
    },
    rows: () => demoRows(),
    events: { label: '파괴 감소 이벤트', destroyMult: 0.5, maxStage: 99, costMult: 1 },
  },
  custom: {
    label: '직접 입력',
    note: '표의 확률과 비용을 직접 편집하세요 (행 추가·삭제 가능)',
    defaults: {
      start: 0, target: 5, restore: 0, destroyCost: 0,
      chanceN: 0, protect: [], protectExtra: 1, costMult: 1,
      eventDestroyMult: 1, eventMaxStage: 99,
    },
    rows: () => [
      { stage: 0, s: 80, k: 20, d: 0, b: 0, cost: 100 },
      { stage: 1, s: 60, k: 40, d: 0, b: 0, cost: 150 },
      { stage: 2, s: 45, k: 30, d: 20, b: 5, cost: 200 },
      { stage: 3, s: 30, k: 30, d: 30, b: 10, cost: 300 },
      { stage: 4, s: 20, k: 30, d: 35, b: 15, cost: 500 },
    ],
    events: { label: '파괴 감소 이벤트', destroyMult: 0.5, maxStage: 99, costMult: 1 },
  },
};
