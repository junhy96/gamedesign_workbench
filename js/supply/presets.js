// 성장 재화 수급 템플릿 — 수치는 설계 예시. 세그먼트는 재화 흐름 시뮬레이터와 같은 행동 기준(라이트·코어·헤비)을 가정.

const seg = (id, name) => ({ id, name });
const SEGS = [seg('light', '라이트'), seg('core', '코어'), seg('heavy', '헤비')];
const runs = (light, core, heavy) => ({ light, core, heavy });

export const TEMPLATES = {
  stone: {
    label: '강화석 — 장비·장신구 강화',
    note: '일일 퀘스트·던전·주간 레이드·월정액이 강화석을 뿌리고, 장비 강화(70%)와 장신구 강화(30%)가 나눠 씁니다. 코어 유저가 장비 +20을 7일, +40을 30일, +60을 90일에 찍도록 필요량을 역산합니다.',
    make: () => ({
      days: 120, start: 50, ref: 1, round: 5, smooth: true, curve: 'smooth', gapWarn: 3,
      currency: '강화석',
      segments: SEGS.map(s => ({ ...s })),
      sources: [
        { id: 's1', name: '일일 퀘스트', amount: 10, period: 'day', unlock: 1, runs: runs(1, 1, 1) },
        { id: 's2', name: '일반 던전 (1회)', amount: 2, period: 'day', unlock: 1, runs: runs(6, 20, 40) },
        { id: 's3', name: '주간 레이드', amount: 80, period: 'week', unlock: 8, runs: runs(0, 1, 1) },
        { id: 's4', name: '출석 보상 (월)', amount: 150, period: 'month', unlock: 1, runs: runs(1, 1, 1) },
        { id: 's5', name: '월정액 (일)', amount: 15, period: 'day', unlock: 1, runs: runs(0, 1, 1) },
        { id: 's6', name: '30일 이벤트', amount: 500, period: 'once', unlock: 30, runs: runs(1, 1, 1) },
      ],
      sinks: [
        { id: 'g1', name: '장비 강화', share: 70, max: 60, start: 0, milestones: [{ day: 7, level: 20 }, { day: 30, level: 40 }, { day: 90, level: 60 }] },
        { id: 'g2', name: '장신구 강화', share: 30, max: 30, start: 0, milestones: [{ day: 14, level: 5 }, { day: 60, level: 20 }, { day: 110, level: 30 }] },
      ],
    }),
  },
  blank: {
    label: '빈 설계 (직접 입력)',
    note: '공급원 1개, 성장 항목 1개에서 시작합니다.',
    make: () => ({
      days: 60, start: 0, ref: 0, round: 1, smooth: true, curve: 'linear', gapWarn: 3,
      currency: '재화',
      segments: [seg('u1', '기준 유저')],
      sources: [{ id: 's1', name: '일일 보상', amount: 10, period: 'day', unlock: 1, runs: { u1: 1 } }],
      sinks: [{ id: 'g1', name: '성장', share: 100, max: 30, start: 0, milestones: [{ day: 30, level: 20 }, { day: 60, level: 30 }] }],
    }),
  },
};
