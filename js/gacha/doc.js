// 가챠 기획서 영역 — 소환 레벨 OFF(고정 확률 + 천장) / ON(소환 레벨) 모드에 맞춰 구조와 공식을 설명한다
import { h } from '../lib/util.js';
import { label } from '../lib/tip.js';
import { gradeRates } from './model.js';

const sec = (title, ...body) => h('section.doc-sec', {}, h('h3', {}, title), ...body);
const p = (...c) => h('p', {}, ...c);
const code = (s) => h('code.doc-code', {}, s);
const ul = (items) => h('ul', {}, ...items.filter(Boolean).map(x => h('li', {}, ...[].concat(x))));
const pct = (x) => `${(+x.toFixed(4)).toString()}%`;

/** state = 화면 상태, cfg = 계산 설정 (cfgOf 결과) */
export function gachaDoc(state, cfg) {
  const on = state.summonOn && cfg.levels.length > 1;
  const top = cfg.grades.at(-1), L = cfg.levels.length;
  const pity = cfg.pity?.enabled ? cfg.pity : null, pick = cfg.pickup?.enabled ? cfg.pickup : null, mil = cfg.mileage?.enabled ? cfg.mileage : null;
  const tenG = cfg.ten?.enabled ? cfg.grades.find(g => g.id === cfg.ten.grade) : null;
  const out = [
    h('div.card-head', {}, h('h2', {}, ...label('기획서 — 뽑기 구조와 공식', 'doc')), h('span.hint', {}, on ? '소환 레벨 시스템 켜짐 (방치형·성장형)' : '소환 레벨 꺼짐 (고정 확률형)')),
  ];
  if (!on) {
    out.push(sec('1. 고정 확률 구조',
      p(`등급별 확률: ${cfg.grades.map(g => `${g.name} ${pct(g.probs[0])}`).join(' · ')}. 같은 등급 안의 캐릭터는 균등(픽업 등급은 픽업 비율로 나눔).`),
      code(`한 장 기대 뽑기 = 1 ÷ (등급 확률 ÷ 종 수)      ${top.name} 1장 ≈ ${(100 / (top.probs[0] || 1e-9)).toFixed(1)}회 (천장·픽업 전)`),
      p('여러 종을 모으면 이미 가진 캐릭터가 또 나오는 중복 때문에 단순 곱(종 수 × 1장 기대)보다 훨씬 많이 듭니다 (쿠폰 수집 문제: n종이면 n·Hₙ배).')));
  } else {
    const per = state.summon.expPerPull || 1;
    out.push(sec('1. 소환 레벨 구조',
      ul([
        state.summon.mode === 'exp' ? `레벨업 방식: 경험치 — 소환 1회당 ${per} 경험치, 필요 누적 경험치에 닿으면 레벨업 (뽑기 수 = 경험치 ÷ ${per}, 올림)` : '레벨업 방식: 횟수 — 누적 소환 수가 기준에 닿으면 레벨업',
        `최대 레벨 Lv${L}: ${cfg.levels.map((f, l) => `Lv${l + 1} ${f.toLocaleString('ko-KR')}회~`).join(' · ')}`,
        '레벨이 오르면 그 시점부터 해당 레벨의 확률표를 씀 (시뮬레이션·공식 모두 뽑기 수로 레벨을 판정)',
        state.summon.upCost || state.summon.upReward ? `레벨업 비용 ${state.summon.upCost || 0} / 보상 ${state.summon.upReward || 0} (${state.gemName}) — 목표를 이루기 전에 지나간 레벨마다 기대값으로 더함` : '레벨업 비용·보상 없음',
        `천장과 병행: ${state.summon.withPity ? '함께 씀' : '소환 레벨이 켜진 동안 천장 없음'}`,
      ])),
    sec('2. 레벨별 확률 변동',
      h('div.table-wrap', {}, h('table.mini', {}, h('thead', {}, h('tr', {}, h('th.left', {}, '등급'), ...cfg.levels.map((_, l) => h('th', {}, `Lv${l + 1}`)))),
        h('tbody', {}, ...cfg.grades.map(g => h('tr', {}, h('td.left', {}, g.name), ...cfg.levels.map((_, l) => h('td', {}, pct(g.probs[l] ?? 0)))))))),
      p('각 열의 합은 100%여야 합니다 (등급 표의 합계 칸이 자동으로 검사). 낮은 레벨에서 상위 등급이 거의 0이면 초반 체감이 길어지니 "레벨 구간별 등급 획득 분포"로 확인하세요.')));
  }
  out.push(sec(`${on ? 3 : 2}. 천장 · 픽업 · 보장`,
    ul([
      pity ? `천장 (${top.name}): 마지막 ${top.name} 이후 ${pity.softStep > 0 ? `${pity.softStart}회째부터 회당 +${pity.softStep}%p, ` : ''}${pity.hard}회째 확정` : '천장 없음',
      pick ? `픽업: ${top.name}이 나오면 ${pick.share}% 확률로 픽업 캐릭터${pick.guarantee ? ', 놓치면 다음 ' + top.name + '은 픽업 확정(반천장)' : ''}` : '픽업 없음',
      mil ? `마일리지: 뽑기마다 ${mil.per} 적립, ${mil.cost} 모이면 원하는 ${top.name} 1장 교환 (${Math.ceil(mil.cost / mil.per)}회마다 1장 보장)` : '마일리지 없음',
      tenG ? `10연 보장: 10번째까지 ${tenG.name} 이상이 없으면 10번째는 ${tenG.name} 이상 — 실제 비율 = (9p + (1 − a)p + a·p/q) ÷ 10 (q = ${tenG.name} 이상 확률 합, a = (1 − q)⁹)` : '10연 보장 없음',
    ]),
    tenG ? p(`10연 보장 반영 실제 비율(Lv1): ${cfg.grades.map((g, i) => `${g.name} ${(gradeRates(cfg, 0)[i] * 100).toFixed(3)}%`).join(' · ')}`) : null));
  out.push(sec(`${on ? 4 : 3}. 계산 방법`,
    ul([
      '수집 목표(확률 고정·교환 없음): 포아송화 적분으로 기대 뽑기 수를 정확히',
      '픽업·특정 캐릭터 목표(분해 교환 없음): (모은 장수, 천장 카운터, 보장 여부)의 분포를 뽑기마다 전진하는 동적 계획법으로 분포 전체를 정확히',
      `그 밖(교환·10연 보장 등): 시드 고정 시뮬레이션 ${(state.runs ?? 3000).toLocaleString('ko-KR')}회 — 같은 시드면 같은 결과`,
      '결과 분포 카드: 평균·중앙값·P10/P50/P90/P99와 히스토그램',
    ])));
  return out;
}
