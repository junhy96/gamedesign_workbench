// 성장 엑셀 표 템플릿 — 장르 프리셋. 공급원·세그먼트 초안이고, 실제 규칙은 내보낸 엑셀에서 행을 추가해 늘린다.
// 증가율과 base는 두 마일스톤에 기준 세그먼트가 맞게 닿도록 solveRate·solveBase로 미리 풀어 둔 값이다 (tests/growth.test.mjs에서 확인).
const src = (name, period, unlock, unlockAt, method, value, counts, extra = {}) => ({ name, period, unlock, unlockAt, method, value, timed: false, mult: 1, counts, ...extra });

export const TEMPLATES = {
  mmo: {
    label: 'MMO형 — 사냥 + 일일·주간 콘텐츠',
    note: '사냥은 플레이 시간에 비례하고 레벨이 오를수록 시간당 효율이 오릅니다(표 방식). 일일 퀘스트는 현재 레벨 필요량의 일정 비율, 일일 던전·주간 보스는 고정량. 레벨 곡선은 두 구간 증가율(Lv1~40 약 15%, Lv41~ 약 8.6%)에 콘텐츠 경계(Lv30·Lv50)에서 30% 점프를 두고, 두 마일스톤(코어 Lv30 14일차·Lv50 60일차)에 맞춰 풀어 둔 값입니다.',
    make: () => ({
      days: 120, maxLevel: 60, ref: 1,
      curve: { base: 140, bands: [{ from: 1, rate: 14.96 }, { from: 41, rate: 8.55 }], jumps: [30, 50], jumpMult: 1.3, cap: 0 },
      table: { start: 300, rate: 6 },
      sources: [
        src('사냥 (시간당)', 'daily', 'day', 1, 'table', 1, [1, 1, 1], { timed: true }),
        src('일일 퀘스트', 'daily', 'level', 5, 'pct', 8, [1, 1, 1]),
        src('일일 던전', 'daily', 'level', 15, 'fixed', 2000, [1, 2, 3]),
        src('주간 보스', 'weekly', 'level', 30, 'fixed', 20000, [1, 1, 1]),
        src('Lv30 달성 보상', 'once', 'level', 30, 'fixed', 30000, [1, 1, 1]),
      ],
      segments: [
        { name: '라이트', minutes: 40, days: [1, 0, 1, 0, 1, 1, 0] },
        { name: '코어', minutes: 120, days: [1, 1, 1, 1, 1, 1, 1] },
        { name: '헤비', minutes: 300, days: [1, 1, 1, 1, 1, 1, 1] },
      ],
      milestones: [{ level: 30, day: 14 }, { level: 50, day: 60 }],
    }),
  },
  idle: {
    label: '방치형 — 시간당 누적 + 주간 보상',
    note: '방치 보상은 접속한 날 24시간치(레벨별 시간당 획득 × 24)를 받는다고 보고, 빠른 사냥은 세그먼트마다 횟수가 다릅니다. 주간 보상은 현재 레벨 필요량의 50%. 25레벨마다 50% 점프.',
    make: () => ({
      days: 90, maxLevel: 100, ref: 1,
      curve: { base: 332, bands: [{ from: 1, rate: 6.97 }], jumps: [25, 50, 75], jumpMult: 1.5, cap: 0 },
      table: { start: 100, rate: 4 },
      sources: [
        src('방치 보상 (24시간치)', 'daily', 'day', 1, 'table', 24, [1, 1, 1]),
        src('빠른 사냥 (2시간치)', 'daily', 'day', 1, 'table', 2, [1, 3, 6]),
        src('주간 보상', 'weekly', 'day', 1, 'pct', 50, [1, 1, 1]),
        src('7일 출석 보상', 'once', 'day', 7, 'fixed', 20000, [1, 1, 1]),
      ],
      segments: [
        { name: '라이트', minutes: 10, days: [1, 0, 1, 0, 1, 0, 1] },
        { name: '코어', minutes: 30, days: [1, 1, 1, 1, 1, 1, 1] },
        { name: '헤비', minutes: 90, days: [1, 1, 1, 1, 1, 1, 1] },
      ],
      milestones: [{ level: 50, day: 14 }, { level: 80, day: 60 }],
    }),
  },
  blank: {
    label: '빈 설계 (직접 입력)',
    note: '공급원 한 줄과 세그먼트 하나로 시작합니다. 엑셀로 내보낸 뒤 ② 공급원 시트에 행을 더해 콘텐츠를 늘리세요.',
    make: () => ({
      days: 60, maxLevel: 30, ref: 0,
      curve: { base: 47, bands: [{ from: 1, rate: 12.05 }], jumps: [], jumpMult: 1.3, cap: 0 },
      table: { start: 100, rate: 5 },
      sources: [src('일일 콘텐츠', 'daily', 'day', 1, 'fixed', 100, [1])],
      segments: [{ name: '기준 유저', minutes: 60, days: [1, 1, 1, 1, 1, 1, 1] }],
      milestones: [{ level: 10, day: 7 }, { level: 20, day: 30 }],
    }),
  },
};
