// 가챠·수집 템플릿 — 수치는 설계 예시 (특정 게임의 실제 수치가 아님).

const grade = (id, name, kinds, probs, shard = 0, exchange = 0) => ({ id, name, kinds, probs, shard, exchange });

export const TEMPLATES = {
  idle: {
    label: '방치형 — 동료 소환 (소환 레벨)',
    note: '방치형 키우기에서 흔한 구조. 많이 뽑을수록 소환 레벨이 올라 상위 등급 확률이 열리고, 천장 대신 중복을 조각으로 바꿔 유니크·레전드를 교환합니다. 동료 초월에 같은 동료가 여러 장 필요해서, “필요 장수 ÷ 확률”로 계산하면 실제보다 크게 낮게 나옵니다.',
    make: () => ({
      pullCost: 100, gemName: '보석', wonPerGem: 0.1, shardName: '조각',
      levels: [0, 50, 150, 400, 1000, 2500, 6000, 15000, 40000, 100000],
      grades: [
        grade('n', '노멀', 8, [85, 79, 73, 67, 60, 52, 44, 36, 28, 20], 1),
        grade('c', '커먼', 8, [12, 16, 20, 23, 26, 29, 32, 35, 38, 41], 3),
        grade('m', '매직', 8, [3, 4.8, 6.5, 9, 12, 16, 20, 24, 28, 32], 10),
        grade('r', '레어', 6, [0, 0.2, 0.5, 1, 1.99, 2.98, 3.95, 4.9, 5.8, 6.7], 40),
        grade('u', '유니크', 5, [0, 0, 0, 0, 0.01, 0.02, 0.05, 0.1, 0.19, 0.28], 300, 60000),
        grade('l', '레전드', 4, [0, 0, 0, 0, 0, 0, 0, 0, 0.01, 0.02], 2000, 400000),
      ],
      pity: { enabled: false, hard: 1000, softStart: 900, softStep: 0 },
      pickup: { enabled: false, share: 50, guarantee: false },
      mileage: { enabled: false, per: 1, cost: 1000 },
      user: { freePerDay: 20000, monthlyWon: 30000 },
      goals: [
        { id: 'g1', name: '레어 도감 완성', type: 'collect', grade: 'r', kinds: 6, copies: 1 },
        { id: 'g2', name: '유니크 전원 4초월', type: 'collect', grade: 'u', kinds: 5, copies: 5 },
        { id: 'g3', name: '레전드 1종 풀 초월', type: 'collect', grade: 'l', kinds: 1, copies: 6 },
        { id: 'g4', name: '레전드 전원 풀 초월', type: 'collect', grade: 'l', kinds: 4, copies: 6 },
      ],
      view: 3, runs: 3000,
    }),
  },
  pity: {
    label: '수집형 RPG — 천장·픽업·마일리지',
    note: '최상위 0.8%, 66회부터 확률 상승, 80회 천장. 픽업 50%에 놓치면 다음은 픽업 확정, 200회마다 마일리지로 원하는 1장. 천장과 마일리지가 비용 분포의 꼬리를 어디서 자르는지 봅니다.',
    make: () => ({
      pullCost: 250, gemName: '다이아', wonPerGem: 10, shardName: '조각',
      levels: [0],
      grades: [
        grade('r', 'R', 30, [91.2], 1),
        grade('sr', 'SR', 20, [8], 10),
        grade('ssr', 'SSR', 12, [0.8], 50),
      ],
      pity: { enabled: true, hard: 80, softStart: 66, softStep: 6 },
      pickup: { enabled: true, share: 50, guarantee: true },
      mileage: { enabled: true, per: 1, cost: 200 },
      user: { freePerDay: 600, monthlyWon: 50000 },
      goals: [
        { id: 'g1', name: '픽업 SSR 1장', type: 'pickup', copies: 1 },
        { id: 'g2', name: '픽업 SSR 풀돌 (7장)', type: 'pickup', copies: 7 },
        { id: 'g3', name: 'SR 도감 (20종)', type: 'collect', grade: 'sr', kinds: 20, copies: 1 },
        { id: 'g4', name: 'SSR 도감 (12종)', type: 'collect', grade: 'ssr', kinds: 12, copies: 1 },
      ],
      view: 1, runs: 3000,
    }),
  },
  blank: {
    label: '빈 설계 (직접 입력)',
    note: '등급 2개, 고정 확률, 목표 1개에서 시작합니다.',
    make: () => ({
      pullCost: 100, gemName: '보석', wonPerGem: 10, shardName: '조각',
      levels: [0],
      grades: [grade('a', '일반', 10, [95]), grade('b', '희귀', 5, [5])],
      pity: { enabled: false, hard: 100, softStart: 80, softStep: 0 },
      pickup: { enabled: false, share: 50, guarantee: false },
      mileage: { enabled: false, per: 1, cost: 200 },
      user: { freePerDay: 300, monthlyWon: 30000 },
      goals: [{ id: 'g1', name: '희귀 전종 1장', type: 'collect', grade: 'b', kinds: 5, copies: 1 }],
      runs: 3000,
    }),
  },
};
