// 제안 기능용 더미 저장 파일 생성기 — `node docs/samples/generate.mjs`
//
// 아직 없는 두 기능을 "도구에서 JSON 저장을 누른 결과"라고 가정한 샘플을 만든다.
//   1) enhance-quantity-items.json : 강화 탭 + 수량형 보조 재료 + 아이템 가격 곡선
//   2) stage-idle-growth.json      : 방치형 스테이지 성장 탭 (+ stage-cost-intervals.csv 가져오기 샘플)
// 수치는 모두 가상의 설계 예시다. 각 파일의 expected는 아래의 독립 구현(전수 탐색·직접 합산)으로 구한
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

// ── 2) 방치형 스테이지 성장 ──────────────────────────────
// 모델(제안):
//   스테이지 s(1..N)의 몬스터 체력 hp(s) = hp0 × hpGrowth^(s−1), 웨이브 골드 g(s) = gold0 × goldGrowth^(s−1)
//   공격력 atk(L) = atk0 + atkPerLevel × L (골드 강화 레벨 L)
//   돌파 조건: 웨이브 제한 시간 안에 몬스터 m마리 처치 → atk × waveLimit ≥ m × hp(s)
//   레벨 L → L+1 비용: 구간 [lvMin, lvMax)에서 initCost + step × (L − lvMin)
//   s−1에서 s로 가려면 필요한 골드 = 누적비용(L_req(s)) − 누적비용(L_req(s−1)), s−1에서 웨이브당 g(s−1)씩 번다
//   실제 체류 시간(s−1) = 필요한 골드 ÷ (g(s−1) ÷ waveSeconds) 과 돌파 시간(wavesPerStage × waveSeconds) 중 큰 값
{
  const cfg = {
    chapters: 20, stagesPerChapter: 10,
    waveSeconds: 10, wavesPerStage: 3, monstersPerWave: 5, waveLimit: 10,
    hp0: 100, hpGrowth: 1.04, gold0: 40, goldGrowth: 1.06,
    atk0: 10, atkPerLevel: 2,
    intendedDwell: { baseSeconds: 30, perChapterMult: 1.3, note: '챕터 c의 의도 체류 시간 = 30초 × 1.3^(c−1)' },
    stagnationRatio: 2,
  };
  // 5,000~20,000 구간의 증가폭(30)을 일부러 가파르게 둔 설계 실수 → 챕터 후반 정체가 나와야 한다
  const bounds = [0, 200, 1000, 5000, 20000, 100000, null];
  const steps = [4.5, 9, 8, 30, 15, 15];
  const intervals = [];
  let init = 50;
  for (let i = 0; i < steps.length; i++) {
    intervals.push({ lvMin: bounds[i], lvMax: bounds[i + 1], initCost: init, step: steps[i] }); // lvMax null = 끝 없음
    if (bounds[i + 1] != null) init = init + steps[i] * (bounds[i + 1] - bounds[i]); // 다음 구간 시작 비용 = 이 구간 마지막 + step (끊김 없이)
  }
  const top = (iv) => iv.lvMax ?? Infinity;
  const stepCost = (L) => { const iv = intervals.find(x => L >= x.lvMin && L < top(x)); return iv.initCost + iv.step * (L - iv.lvMin); };
  // 누적 비용(0 → L): 구간마다 등차수열 합
  const cumCost = (L) => {
    let sum = 0;
    for (const iv of intervals) {
      if (L <= iv.lvMin) break;
      const n = Math.min(L, top(iv)) - iv.lvMin;
      sum += n * iv.initCost + iv.step * n * (n - 1) / 2;
    }
    return sum;
  };
  // 독립 검산: 직접 합산
  let brute = 0; for (let L = 0; L < 150000; L++) brute += stepCost(L);
  if (Math.abs(brute - cumCost(150000)) > 1e-9 * brute) throw new Error('누적 비용 공식 불일치');

  const N = cfg.chapters * cfg.stagesPerChapter;
  const hp = (s) => cfg.hp0 * cfg.hpGrowth ** (s - 1);
  const gold = (s) => cfg.gold0 * cfg.goldGrowth ** (s - 1);
  const levelReq = (s) => Math.max(0, Math.ceil((cfg.monstersPerWave * hp(s) / cfg.waveLimit - cfg.atk0) / cfg.atkPerLevel));
  const label = (s) => `${Math.floor((s - 1) / cfg.stagesPerChapter) + 1}-${((s - 1) % cfg.stagesPerChapter) + 1}`;
  const intended = (s) => cfg.intendedDwell.baseSeconds * cfg.intendedDwell.perChapterMult ** Math.floor((s - 1) / cfg.stagesPerChapter);

  const stages = [];
  let elapsed = 0;
  for (let s = 1; s <= N; s++) {
    const L = levelReq(s), Lprev = s > 1 ? levelReq(s - 1) : 0;
    const need = cumCost(L) - cumCost(Lprev);
    const farm = s > 1 ? need / (gold(s - 1) / cfg.waveSeconds) : 0;
    const dwell = Math.max(farm, cfg.wavesPerStage * cfg.waveSeconds);
    elapsed += dwell;
    stages.push({ stage: label(s), levelReq: L, goldNeeded: need, dwellSec: dwell, intendedSec: intended(s), elapsedSec: elapsed });
  }
  const pick = (lbl) => { const x = stages.find(y => y.stage === lbl); return { ...x, goldNeeded: r(x.goldNeeded, 0), dwellSec: r(x.dwellSec, 1), intendedSec: r(x.intendedSec, 1), elapsedHours: r(x.elapsedSec / 3600, 2) }; };
  const stagnant = stages.filter(x => x.dwellSec > cfg.stagnationRatio * x.intendedSec).map(x => x.stage);

  const file = {
    schemaVersion: 1,
    tool: 'stage',
    description: '[더미] 방치형 스테이지 성장 — 챕터 20 × 스테이지 10, 골드 강화 구간 비용, 의도 체류 시간. 수치는 가상의 예시.',
    model: [
      '몬스터 체력 hp(s) = hp0 × hpGrowth^(s−1), 웨이브 골드 g(s) = gold0 × goldGrowth^(s−1)',
      '공격력 atk(L) = atk0 + atkPerLevel × L,  돌파 조건 atk × waveLimit ≥ monstersPerWave × hp(s)',
      '레벨 L → L+1 비용 = 구간 initCost + step × (L − lvMin),  누적 비용은 구간별 등차수열 합',
      '실제 체류(s−1) = max((누적비용(L_req(s)) − 누적비용(L_req(s−1))) ÷ (g(s−1) ÷ waveSeconds), wavesPerStage × waveSeconds)',
      '정체 = 실제 체류 > stagnationRatio × 의도 체류',
    ],
    state: { v: 1, template: 'idle', ...cfg, costIntervals: intervals, csvSource: 'stage-cost-intervals.csv' },
    expected: {
      note: '같은 파일의 generate.mjs가 위 모델을 직접 합산해 구한 정답 (누적 비용 공식은 0~150,000레벨 직접 합산과 일치 확인)',
      cumCost: { L1000: cumCost(1000), L10000: cumCost(10000), L100000: cumCost(100000) },
      checkpoints: ['1-10', '5-10', '10-10', '15-10', '20-10'].map(pick),
      totalHours: r(elapsed / 3600, 2),
      stagnantStages: stagnant,
      stagnantCount: stagnant.length,
      finding: '5,000~20,000레벨 구간의 증가폭(30)이 앞뒤 구간(8, 15)보다 가팔라, 그 레벨대가 필요한 16~17챕터에서 실제 체류가 의도의 2배를 넘는다',
    },
  };
  save('stage-idle-growth.json', JSON.stringify(file, null, 2) + '\n');
  const csv = ['LV_MIN,LV_MAX,INIT_COST,STEP', ...intervals.map(iv => `${iv.lvMin},${iv.lvMax ?? ''},${iv.initCost},${iv.step}`)].join('\r\n') + '\r\n';
  save('stage-cost-intervals.csv', csv);
  console.log('stage: 총', file.expected.totalHours, '시간, 정체', stagnant.length, stagnant.slice(0, 8), file.expected.checkpoints.map(c => `${c.stage} Lv${c.levelReq} ${c.dwellSec}s/${c.intendedSec}s`).join(' | '));
}
