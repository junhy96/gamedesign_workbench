// 재화 흐름 템플릿 — 구조 예시. 수치는 기획자가 바꾸는 것을 전제로 한다.

export const TEMPLATES = {
  rpg: {
    label: '기본 RPG 경제 (골드·강화석·다이아)',
    note: '일일 퀘스트·사냥 골드, 주간 보스 강화석, 출석 다이아. 10~16일 골드 2배 이벤트. 강화(소비 규칙)·수리(고정)·경매 수수료(비율)로 소모.',
    make: () => ({
      days: 30, warmup: 7, sinkRatioWarn: 70,
      variance: { on: true, runs: 200, userSigma: 0.35, daySigma: 0.15 },
      currencies: [
        { id: 'gold', name: '골드', start: 0 },
        { id: 'stone', name: '강화석', start: 0 },
        { id: 'dia', name: '다이아', start: 0 },
      ],
      faucets: [
        { id: 'quest', name: '일일 퀘스트', currency: 'gold', amount: 20000, period: 'day', activity: true, from: 0, to: 0 },
        { id: 'hunt', name: '사냥', currency: 'gold', amount: 30000, period: 'day', activity: true, from: 0, to: 0 },
        { id: 'event', name: '골드 2배 이벤트', currency: 'gold', amount: 50000, period: 'day', activity: true, from: 10, to: 16 },
        { id: 'boss', name: '주간 보스', currency: 'stone', amount: 30, period: 'week', activity: true, from: 0, to: 0 },
        { id: 'attend', name: '출석 보상', currency: 'dia', amount: 10, period: 'day', activity: false, from: 0, to: 0 },
      ],
      exchanges: [
        { id: 'shop', name: '상점 강화석 구매', from: 'gold', to: 'stone', amount: 20000, rate: 0.00005, threshold: 100000, maxPerDay: 3 },
        { id: 'diashop', name: '다이아 강화석 교환', from: 'dia', to: 'stone', amount: 10, rate: 0.5, threshold: 50, maxPerDay: 2 },
      ],
      sinks: [
        { id: 'enh', name: '강화 시도', currency: 'stone', type: 'rule', amount: 2, threshold: 2, maxPerDay: 4, ratio: 0, activity: true },
        { id: 'enhgold', name: '강화 골드 비용', currency: 'gold', type: 'rule', amount: 15000, threshold: 50000, maxPerDay: 3, ratio: 0, activity: true },
        { id: 'repair', name: '장비 수리', currency: 'gold', type: 'fixed', amount: 3000, threshold: 0, maxPerDay: 1, ratio: 0, activity: true },
        { id: 'fee', name: '경매장 수수료', currency: 'gold', type: 'ratio', amount: 0, threshold: 0, maxPerDay: 1, ratio: 1, activity: false },
      ],
      users: [
        { id: 'light', name: '라이트', share: 40, activity: 0.5 },
        { id: 'core', name: '코어', share: 45, activity: 1 },
        { id: 'heavy', name: '헤비', share: 15, activity: 2 },
      ],
    }),
  },
  blank: {
    label: '빈 경제 (직접 입력)',
    note: '재화 1개, 획득처 1개, 소모처 1개에서 시작합니다.',
    make: () => ({
      days: 30, warmup: 7, sinkRatioWarn: 70,
      variance: { on: false, runs: 200, userSigma: 0.3, daySigma: 0.1 },
      currencies: [{ id: 'gold', name: '골드', start: 0 }],
      faucets: [{ id: 'f1', name: '일일 보상', currency: 'gold', amount: 10000, period: 'day', activity: true, from: 0, to: 0 }],
      exchanges: [],
      sinks: [{ id: 's1', name: '소비', currency: 'gold', type: 'rule', amount: 5000, threshold: 5000, maxPerDay: 1, ratio: 0, activity: true }],
      users: [{ id: 'u1', name: '일반', share: 100, activity: 1 }],
    }),
  },
};
