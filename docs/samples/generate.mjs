// 제안 기능용 더미 저장 파일 생성기 — `node docs/samples/generate.mjs`
//
// 기능을 "도구에서 JSON 저장을 누른 결과"라고 가정한 샘플을 만든다.
//   enhance-quantity-items.json : 강화 탭 + 수량형 보조 재료 + 아이템 가격 곡선
// (방치형 스테이지 성장 샘플은 탭을 없애면서 지움)
// 수치는 모두 가상의 설계 예시다. 파일의 expected는 아래의 독립 구현(전수 탐색)으로 구한
// 정답이라, 기능을 구현할 때 테스트 기대값으로 그대로 쓴다.
import { writeFileSync } from 'node:fs';

const out = new URL('./', import.meta.url);
const save = (name, text) => writeFileSync(new URL(name, out), text);
const r = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

// ── 1) 강화 + 수량형 보조 재료 ───────────────────────────
// 별자리 초월처럼 실패해도 단계는 유지되고 재료만 사라지는 구조 → 단계마다 독립, 단계 i 기대 비용 = (시도 비용 + 재료 비용) ÷ 성공 확률
{
  const resources = [
    { name: '별가루', value: 0.1 },
    { name: '같은 세부 별', value: 3000, note: '가챠·수집 탭에서 구한 1장 기대 비용(원)을 가치로 사용' },
    { name: '다이아', value: 10 },
  ];
  const success = [100, 60, 45, 30, 20, 12];
  const dust = [1000, 2000, 4000, 8000, 15000, 30000];
  const dupes = [1, 1, 2, 2, 3, 4];
  const rows = success.map((s, i) => ({ stage: i, s, s2: 0, k: 100 - s, d: 0, b: 0, costs: [dust[i], dupes[i], 0] }));
  const items = [
    { id: 'g_high', name: '별빛 가호 (상급)', effect: 'boost', mode: 'quantity', amount: 4, maxUnits: 8, costs: [0, 0, 50], from: 1, to: 5 },
    { id: 'g_mid', name: '별빛 가호 (중급)', effect: 'boost', mode: 'quantity', amount: 1, maxUnits: 15, costs: [0, 0, 15], from: 1, to: 5 },
    { id: 'g_low', name: '별빛 가호 (하급)', effect: 'boost', mode: 'quantity', amount: 0.1, maxUnits: 50, costs: [0, 0, 2], from: 1, to: 5 },
  ];
  const won = (costs) => costs.reduce((a, c, k) => a + c * resources[k].value, 0);

  /** 단계별 최적 투입량 전수 탐색 (가격 덮어쓰기 가능) */
  function solve(priceOverride = {}) {
    const price = items.map(it => won(it.costs) * (priceOverride[it.id] ?? 1));
    let total = 0, spend = 0;
    const policy = {};
    rows.forEach((row, i) => {
      const attempt = won(row.costs);
      const usable = items.map(it => (i >= it.from && i <= it.to ? it.maxUnits : 0));
      let best = { cost: attempt / (row.s / 100), q: [0, 0, 0], itemCost: 0 };
      for (let a = 0; a <= usable[0]; a++) for (let b = 0; b <= usable[1]; b++) for (let c = 0; c <= usable[2]; c++) {
        const p = Math.min(1, (row.s + a * items[0].amount + b * items[1].amount + c * items[2].amount) / 100);
        const itemCost = a * price[0] + b * price[1] + c * price[2];
        const cost = (attempt + itemCost) / p;
        if (cost < best.cost - 1e-9) best = { cost, q: [a, b, c], itemCost: itemCost / p };
      }
      total += best.cost; spend += best.itemCost;
      if (best.q.some(Boolean)) policy[i] = Object.fromEntries(items.map((it, k) => [it.id, best.q[k]]).filter(([, v]) => v > 0));
    });
    return { total, spend, policy };
  }
  const noItems = rows.reduce((a, row) => a + won(row.costs) / (row.s / 100), 0);
  const opt = solve();

  // 가격 곡선: 상급 가호 가격을 20~600 다이아로 바꿔 가며 최적 정책을 다시 푼다
  const sweep = [];
  for (let dia = 20; dia <= 600; dia += 20) {
    const s = solve({ g_high: dia / 50 });
    sweep.push({ price: dia, expCost: r(s.total), bmSpend: r(s.spend), saving: r(1 - s.total / noItems, 4), highUnits: Object.values(s.policy).reduce((a, p) => a + (p.g_high || 0), 0) });
  }
  const bmMax = sweep.reduce((a, b) => (b.bmSpend > a.bmSpend ? b : a));
  const firstUnder = sweep.find(x => x.saving <= 0.15);

  const file = {
    schemaVersion: 3,
    tool: 'enhance',
    description: '[더미] 별자리 초월형 강화 — 실패 시 재료만 소진(단계 유지). 보조 재료 3종을 개수 단위로 투입. 수치는 가상의 예시.',
    proposedFields: {
      'items[].mode': "'toggle'(기존: 1개 쓰거나 안 씀) | 'quantity'(개당 amount %p, 최대 maxUnits개)",
      'items[].maxUnits': '한 번의 시도에 넣을 수 있는 최대 개수',
      'usage[stage]': "수량형은 { units: { 아이템 id: 개수 } } (기존 on/off는 id 배열 그대로)",
      priceSweep: '가격 곡선 카드 설정: 대상 아이템, 가격 범위(해당 재화 단위), 단계 수, 목표 절감률',
    },
    state: {
      v: 3, template: 'blank',
      start: 0, target: 6, restore: 0, double: false,
      resources, rows, destroyCosts: [0, 0, 0], items,
      usage: { 3: { units: { g_high: 2 } }, 4: { units: { g_high: 4, g_mid: 3 } }, 5: { units: { g_high: 8 } } },
      streak: { kind: 'none', bonus: 10, bonusMode: 'rel', cap: 100, pity: 0 },
      event: { on: false, successMult: 1.2, destroyMult: 0.7, costMult: 0.8 },
      priceSweep: { item: 'g_high', resource: 2, from: 20, to: 600, step: 20, targetSaving: 0.15 },
    },
    expected: {
      note: '단계 독립 구조라 단계마다 투입량 조합 전수 탐색(상급 0~8 × 중급 0~15 × 하급 0~50)으로 구한 정답. 원 단위.',
      noItemsExpCost: r(noItems),
      optimal: { expCost: r(opt.total), saving: r(1 - opt.total / noItems, 4), bmSpend: r(opt.spend), policy: opt.policy },
      priceSweep: sweep,
      bmRevenueMaxAt: { price: bmMax.price, bmSpend: bmMax.bmSpend },
      savingAtOrBelowTargetFrom: firstUnder ? firstUnder.price : null,
      finding: firstUnder
        ? `상급 가호가 ${firstUnder.price} 다이아 이상이면 절감률이 목표(15%) 이하`
        : `상급 가호 가격만 올려서는 목표 절감률 15%에 닿지 않음 — ${sweep.find(x => x.highUnits === 0)?.price ?? '-'} 다이아부터 상급은 안 쓰이고, 중급·하급만으로 ${(sweep.at(-1).saving * 100).toFixed(1)}% 절감. 중급·하급 가격(%p당 비용)도 함께 올려야 함`,
    },
  };
  save('enhance-quantity-items.json', JSON.stringify(file, null, 2) + '\n');
  console.log('enhance:', file.expected.noItemsExpCost, '→', file.expected.optimal.expCost, file.expected.optimal.policy, 'BM 최대', bmMax.price, '15% 이하', firstUnder?.price);
}
