// 방치형 스테이지 성장 템플릿 — 수치는 가상의 설계 예시 (docs/samples/stage-idle-growth.json과 같은 값)

const iv = (lvMin, lvMax, initCost, step) => ({ lvMin, lvMax, initCost, step });

export const TEMPLATES = {
  idle: {
    label: '방치형 — 챕터 20 × 스테이지 10',
    note: '골드 강화 6구간(마지막은 끝 없음), 의도 체류는 챕터마다 1.3배. 5,000~20,000레벨 구간의 증가폭(30)을 일부러 앞뒤(8, 15)보다 가파르게 둔 예시라 16~17챕터에서 정체가 나야 정상입니다.',
    make: () => ({
      chapters: 20, stagesPerChapter: 10,
      waveSeconds: 10, wavesPerStage: 3, monstersPerWave: 5, waveLimit: 10,
      hp0: 100, hpGrowth: 1.04, gold0: 40, goldGrowth: 1.06,
      atk0: 10, atkPerLevel: 2,
      intendedDwell: { baseSeconds: 30, perChapterMult: 1.3 },
      stagnationRatio: 2,
      costIntervals: [
        iv(0, 200, 50, 4.5),
        iv(200, 1000, 950, 9),
        iv(1000, 5000, 8150, 8),
        iv(5000, 20000, 40150, 30),
        iv(20000, 100000, 490150, 15),
        iv(100000, null, 1690150, 15),
      ],
    }),
  },
  blank: {
    label: '빈 설계 (직접 입력)',
    note: '챕터 5 × 스테이지 10, 끝 없는 비용 구간 1개에서 시작합니다. 구간 표는 CSV로 붙여 넣을 수 있습니다.',
    make: () => ({
      chapters: 5, stagesPerChapter: 10,
      waveSeconds: 10, wavesPerStage: 3, monstersPerWave: 5, waveLimit: 10,
      hp0: 100, hpGrowth: 1.05, gold0: 40, goldGrowth: 1.05,
      atk0: 10, atkPerLevel: 2,
      intendedDwell: { baseSeconds: 30, perChapterMult: 1.2 },
      stagnationRatio: 2,
      costIntervals: [iv(0, null, 50, 5)],
    }),
  },
};
