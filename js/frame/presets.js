// 패턴 템플릿 — 특정 게임 수치가 아니라 판정 유형별 예시. 값은 모두 프레임(60fps 기준).

const atk = (name, startup, active, recovery, gap, extra = {}) => ({ name, startup, active, hits: 1, hitGap: 0, recovery, gap, recog: 0, ...extra });

const player = {
  dodgeStartup: 3, dodgeInv: 14, dodgeRecovery: 12,   // 회피: 선딜 3 · 무적 14 · 후딜 12 (총 29f)
  reactionMs: 250, latency: 4,                        // 반응 250ms + 화면·입력 지연 4f
  atkStartup: 10, atkTotal: 32, atkCancel: 20,        // 내 공격: 발생 10 · 전체 32 · 20f부터 회피 캔슬
};
const thresholds = { comfy: 10, tight: 6 };

export const TEMPLATES = {
  basic: {
    label: '기본 보스 4연계',
    note: '판정 유형을 한 번에 보여주는 예시: 여유 있는 공격, 빠른 2연타, 식별이 늦은 지연 공격, 무적보다 긴 돌진.',
    make: () => ({
      fps: 60, policy: 'late', loop: true, player: { ...player }, thresholds: { ...thresholds },
      attacks: [
        atk('내려찍기', 40, 4, 30, 12),
        atk('횡베기 2연타', 22, 5, 26, 6, { hits: 2, hitGap: 26 }),
        atk('지연 찌르기', 48, 4, 40, 20, { recog: 34 }),
        atk('돌진', 20, 16, 50, 30),
      ],
    }),
  },
  rush: {
    label: '빠른 연계 (선입력 강제)',
    note: '타격 간격이 회피 전체 길이(29f)보다 짧은 3연타. 늦게 피하면 다음 타격에 맞고, 선입력해야만 모두 피할 수 있는 구간을 보여줍니다.',
    make: () => ({
      fps: 60, policy: 'late', loop: true, player: { ...player }, thresholds: { ...thresholds },
      attacks: [
        atk('3연 베기', 18, 4, 36, 10, { hits: 3, hitGap: 22 }),
        atk('회전 베기', 26, 8, 44, 24),
        atk('도약 강타', 52, 6, 60, 40),
      ],
    }),
  },
  generous: {
    label: '입문 보스 (여유)',
    note: '선딜이 길고 판정이 짧은 입문용 패턴. 모든 공격이 반응 가능하고 반격 기회가 충분한 기준점으로 씁니다.',
    make: () => ({
      fps: 60, policy: 'late', loop: true, player: { ...player }, thresholds: { ...thresholds },
      attacks: [
        atk('휘두르기', 36, 4, 40, 30),
        atk('발 구르기', 44, 3, 50, 36),
        atk('돌 던지기', 40, 5, 34, 40),
      ],
    }),
  },
  blank: {
    label: '빈 패턴 (직접 입력)',
    note: '공격 하나에서 시작합니다. 행을 추가하며 연계를 설계하세요.',
    make: () => ({
      fps: 60, policy: 'late', loop: true, player: { ...player }, thresholds: { ...thresholds },
      attacks: [atk('공격 1', 30, 5, 30, 20)],
    }),
  },
};
