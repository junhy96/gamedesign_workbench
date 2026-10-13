// 기획 템플릿 — 특정 게임 수치가 아니라 구조별 출발점. 모든 값은 기획자가 바꾸는 것을 전제로 한다.
// 재화 가치(value)는 '1단위당 원화 환산 가치'. 무료 재화도 시간·기회비용으로 환산해 넣는다.

const r2 = (x) => Math.round(x * 100) / 100;
const r100 = (x) => Math.round(x / 100) * 100;

function row(stage, s, s2, d, b, costs) {
  return { stage, s: r2(s), s2: r2(s2), k: r2(100 - s - s2 - d - b), d: r2(d), b: r2(b), costs };
}

const baseStreak = { kind: 'none', bonus: 10, bonusMode: 'rel', cap: 100, pity: 0 };
const baseEvent = { on: false, successMult: 1.2, destroyMult: 0.7, costMult: 0.8 };

export const TEMPLATES = {
  standard: {
    label: '기본 성장형 (하락·파괴)',
    note: '+6부터 하락, +9부터 파괴가 생기는 일반적인 구조. 보조 아이템 3종(파괴방지·하락방지·성공률 증가)이 유료 재화로 판매된다고 가정.',
    make: () => {
      const stone = [1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 6, 7, 8];
      const s = [95, 90, 85, 80, 75, 70, 60, 55, 50, 45, 40, 35, 30, 25, 20];
      const d = [0, 0, 0, 0, 0, 0, 10, 12, 15, 15, 18, 20, 20, 22, 25];
      const b = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 7];
      return {
        start: 0, target: 15, restore: 7, double: false,
        resources: [{ name: '골드', value: 0.001 }, { name: '강화석', value: 50 }, { name: '다이아', value: 10 }],
        rows: s.map((sv, i) => row(i, sv, 0, d[i], b[i], [r100(2000 * 1.35 ** i), stone[i], 0])),
        destroyCosts: [100000, 0, 0],
        items: [
          { id: 'protect', name: '파괴방지권', effect: 'protect', amount: 0, costs: [0, 0, 30], from: 9, to: 14 },
          { id: 'nodrop', name: '하락방지권', effect: 'nodrop', amount: 0, costs: [0, 0, 10], from: 6, to: 14 },
          { id: 'bless', name: '축복 주문서', effect: 'boost', amount: 10, costs: [0, 0, 20], from: 0, to: 14 },
        ],
        usage: {}, streak: { ...baseStreak }, event: { ...baseEvent },
      };
    },
  },
  artisan: {
    label: '실패 누적형 (보너스·천장)',
    note: '하락·파괴 없이 실패할수록 성공률이 오르고(기본 성공률의 10%씩), 30회 연속 실패하면 확정 성공. 보조 재료로 성공률을 올릴 수 있다.',
    make: () => {
      const s = [80, 60, 45, 30, 20, 15, 10, 7, 5, 3];
      const mats = [2, 2, 3, 3, 4, 5, 6, 8, 10, 12];
      return {
        start: 0, target: 10, restore: 0, double: false,
        resources: [{ name: '골드', value: 0.001 }, { name: '재료', value: 30 }, { name: '크리스탈', value: 30 }],
        rows: s.map((sv, i) => row(i, sv, 0, 0, 0, [r100(5000 * 1.5 ** i), mats[i], 0])),
        destroyCosts: [0, 0, 0],
        items: [{ id: 'breath', name: '숨결', effect: 'boost', amount: 5, costs: [0, 0, 10], from: 0, to: 9 }],
        usage: {}, streak: { kind: 'fail', bonus: 10, bonusMode: 'rel', cap: 100, pity: 30 }, event: { ...baseEvent },
      };
    },
  },
  gamble: {
    label: '고위험 고보상 (이중 강화·찬스타임)',
    note: '+5부터 대성공(+2단계) 5%와 하락, +10부터 파괴. 2회 연속 하락하면 다음 시도 확정 성공(찬스타임).',
    make: () => ({
      start: 0, target: 20, restore: 10, double: true,
      resources: [{ name: '골드', value: 0.001 }, { name: '강화석', value: 50 }, { name: '다이아', value: 10 }],
      rows: Array.from({ length: 20 }, (_, i) => row(
        i, 90 - i * 3.5, i >= 5 ? 5 : 0, i >= 5 ? 18 + (i - 5) * 1.5 : 0, i >= 10 ? 1 + (i - 10) : 0,
        [r100(3000 * 1.3 ** i), 1 + Math.floor(i / 2), 0],
      )),
      destroyCosts: [500000, 0, 0],
      items: [{ id: 'protect', name: '파괴방지권', effect: 'protect', amount: 0, costs: [0, 0, 50], from: 10, to: 19 }],
      usage: {}, streak: { kind: 'drop', bonus: 0, bonusMode: 'abs', cap: 100, pity: 2 }, event: { ...baseEvent },
    }),
  },
  blank: {
    label: '빈 표 (직접 입력)',
    note: '5단계 빈 표에서 시작합니다. 단계·재화·아이템을 추가하며 설계하세요.',
    make: () => ({
      start: 0, target: 5, restore: 0, double: false,
      resources: [{ name: '골드', value: 1 }],
      rows: Array.from({ length: 5 }, (_, i) => row(i, 50, 0, 0, 0, [1000])),
      destroyCosts: [0],
      items: [], usage: {}, streak: { ...baseStreak }, event: { ...baseEvent },
    }),
  },
};
