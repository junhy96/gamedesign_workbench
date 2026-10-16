// 재화 흐름 템플릿 — 성장 루프 구조 예시. 수치는 기획자가 바꾸는 것을 전제로 한다.

export const TEMPLATES = {
  mobile: {
    label: '모바일 RPG 기본 루프',
    note: '스태미나로 던전을 돌고, 시간 남으면 자동 사냥. 골드·강화석으로 장비·스킬·장신구를 올리면 전투력이 올라 보상이 늘고 상위 콘텐츠가 열립니다. 과금은 다이아 → 스태미나 충전.',
    make: () => ({
      days: 60, warmup: 7, sinkRatioWarn: 60, gapWarn: 3, basePower: 0,
      currencies: [
        { id: 'gold', name: '골드', start: 50000 },
        { id: 'stone', name: '강화석', start: 0 },
        { id: 'dia', name: '다이아', start: 0 },
      ],
      paid: { currency: 'dia', priceWon: 10 }, // 다이아 1개 = 10원
      stamina: { enabled: true, regenPerDay: 288, cap: 120, refillCost: 50, refillAmount: 60 }, // 5분에 1 회복
      // 세그먼트 = 측정 가능한 행동 기준
      segments: [
        { id: 'light', name: '라이트', share: 50, minutes: 30, logins: 2, spendWon: 0, refills: 0 },
        { id: 'core', name: '코어', share: 35, minutes: 90, logins: 4, spendWon: 10000, refills: 1 },
        { id: 'heavy', name: '헤비', share: 15, minutes: 180, logins: 8, spendWon: 100000, refills: 3 },
      ],
      // 생산: 표 순서 = 플레이 우선순위. limit 0 = 무제한(남은 시간·스태미나로 반복)
      contents: [
        { id: 'daily', name: '일일 퀘스트', minutes: 15, stamina: 0, limit: 1, period: 'day', unlock: 0, powerBonus: 0, reward: { gold: 30000, stone: 5, dia: 10 } },
        { id: 'golddg', name: '골드 던전', minutes: 4, stamina: 0, limit: 2, period: 'day', unlock: 150, powerBonus: 30, reward: { gold: 25000 } },
        { id: 'raid', name: '주간 레이드', minutes: 20, stamina: 0, limit: 1, period: 'week', unlock: 400, powerBonus: 0, reward: { stone: 60, dia: 50 } },
        { id: 'dungeon', name: '일반 던전', minutes: 3, stamina: 10, limit: 0, period: 'day', unlock: 0, powerBonus: 20, reward: { gold: 4000, stone: 1 } },
        { id: 'auto', name: '자동 사냥 (분당)', minutes: 1, stamina: 0, limit: 0, period: 'day', unlock: 0, powerBonus: 15, reward: { gold: 600 } },
      ],
      // 소비: 비용(레벨 L) = 기본 비용 × 증가율^L
      growth: [
        { id: 'equip', name: '장비 강화', max: 60, start: 0, rate: 1.1, power: 15, cost: { gold: 10000, stone: 3 } },
        { id: 'skill', name: '스킬 레벨', max: 40, start: 0, rate: 1.12, power: 10, cost: { gold: 30000 } },
        { id: 'acc', name: '장신구 강화', max: 30, start: 0, rate: 1.15, power: 25, cost: { stone: 15, dia: 20 } },
      ],
      exchanges: [
        { id: 'shop', name: '상점: 골드 → 강화석', from: 'gold', to: 'stone', amount: 30000, rate: 1 / 30000, threshold: 300000, maxPerDay: 5 },
      ],
    }),
  },
  blank: {
    label: '빈 루프 (직접 입력)',
    note: '재화 1개, 콘텐츠 1개, 성장 1개에서 시작합니다.',
    make: () => ({
      days: 30, warmup: 7, sinkRatioWarn: 60, gapWarn: 3, basePower: 0,
      currencies: [{ id: 'gold', name: '골드', start: 0 }],
      paid: { currency: '', priceWon: 0 },
      stamina: { enabled: false, regenPerDay: 288, cap: 120, refillCost: 50, refillAmount: 60 },
      segments: [{ id: 'u1', name: '일반', share: 100, minutes: 60, logins: 3, spendWon: 0, refills: 0 }],
      contents: [{ id: 'c1', name: '사냥 (분당)', minutes: 1, stamina: 0, limit: 0, period: 'day', unlock: 0, powerBonus: 10, reward: { gold: 500 } }],
      growth: [{ id: 'g1', name: '장비 강화', max: 30, start: 0, rate: 1.15, power: 10, cost: { gold: 5000 } }],
      exchanges: [],
    }),
  },
};
