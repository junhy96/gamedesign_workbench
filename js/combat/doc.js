// 전투 시뮬레이터 기획서 영역 — 지금 고른 규칙(공식·모드·합산·그로기·타겟팅)과 테이블(상성·시너지)로 설명을 만든다.
// 규칙이나 모드를 바꾸면 설명도 함께 바뀐다.
import { FORMULAS, FORMULA_PARAMS, MODES, HIT_MODES, TARGETING, ALLY_RULES, ROUNDS } from './engine.js';
import { SYN_CONDS, ROLES } from '../data/schema.js';
import { h } from '../lib/util.js';
import { label } from '../lib/tip.js';

const sec = (title, ...body) => h('section.doc-sec', {}, h('h3', {}, title), ...body);
const p = (...c) => h('p', {}, ...c);
const code = (s) => h('code.doc-code', {}, s);
const ol = (items) => h('ol', {}, ...items.map(x => h('li', {}, ...[].concat(x))));
const ul = (items) => h('ul', {}, ...items.map(x => h('li', {}, ...[].concat(x))));

export function combatDoc(t, R, view) {
  const F = FORMULAS[R.formula];
  const RT = R.mode === 'realtime', U = RT ? '초' : '턴';
  const adv = [];
  for (const r of t.elements || []) for (const [k, v] of Object.entries(r)) if (k.startsWith('vs:') && typeof v === 'number' && v !== 1) adv.push(`${r.id}→${k.slice(3)} ×${v}`);
  const party = view !== 'duel';
  const out = [
    h('div.card-head', {}, h('h2', {}, ...label('기획서 — 전투 규칙', 'doc')), h('span.hint', {}, '지금 설정으로 만든 설명 · 규칙을 바꾸면 함께 바뀜')),
    sec('1. 최종 스탯 계산 순서',
      ol(['① 직업 기본 스탯 (직업 테이블, Lv1)', '② + 레벨 성장 × (레벨 − 1)', '③ 캐릭터 보정 — 합: + 보정값 / 곱: × (1 + 보정값%)', `④ 장비·버프 — 전투 중 효과는 ${R.buffStack === 'mul' ? '곱연산: 기본 × Π(1 + %)' : '합연산: 기본 × (1 + Σ%)'} 뒤 고정값을 더함`]),
      p('몬스터는 레벨 성장 없이 몬스터 테이블의 값을 그대로 씁니다.')),
    sec(`2. 데미지 공식 — ${F.label}`,
      code(`기본 데미지 = ${F.expr} × 스킬 배율`),
      ul([
        '공 = 공격하는 쪽의 공격력 (버프·디버프 반영)', '방 = 맞는 쪽의 방어력 (버프·디버프 반영)', '스킬 배율 = 스킬 테이블의 배율 (기본 공격 1)',
        ...F.params.map(k => `${FORMULA_PARAMS[k].label} = ${R[k]}`),
      ]),
      p(h('b', {}, '언제 쓰나: '), F.use),
      p(h('b', {}, '다른 공식: '), Object.entries(FORMULAS).filter(([k]) => k !== R.formula).map(([, f]) => `${f.label}(${f.expr})`).join(' · '))),
    sec('3. 한 대의 데미지 계산 순서',
      ol([
        `명중 판정 — 명중 확률 = ${HIT_MODES[R.hitMode]}, ${R.hitMin}%~${R.hitMax}%로 자름. 빗나가면 데미지·효과 없음`,
        `① 기본 공식 (${F.expr}) × 스킬 배율`,
        '② × 속성 상성 배율 (공격 속성 → 방어 속성)',
        R.crit ? '③ 치명타 — 치명타 확률로 굴려 나면 × 치명타 배율' : '③ 치명타 — 꺼짐',
        `④ × 받는 피해 증감 (취약·피해 감소 효과, ${R.buffStack === 'mul' ? '곱연산' : '합연산'})`,
        `⑤ × 그로기 배율 ${R.groggyDmg} (대상이 흐트러진 동안만)`,
        `반올림(${ROUNDS[R.round]}, 최소 1) → 보호막이 먼저 흡수 → 남은 만큼 체력 감소`,
      ])),
    sec('4. 속성 상성',
      p(adv.length ? `기본 1배, 다른 값: ${adv.join(', ')}` : '모든 조합이 1배입니다.'),
      p('상성 테이블은 이 화면 아래와 데이터 테이블에서 고칠 수 있습니다.')),
    sec(`5. 전투 방식 — ${MODES[R.mode]}`,
      RT
        ? ul([`초당 행동 = 속도 ÷ ${R.speedBase}. 행동 사이 간격이 짧을수록 자주 공격`, '쿨타임·지속은 초 단위, 지속 피해와 자원 회복은 1초마다', `제한 ${R.maxTime}초 — 넘으면 무승부`, '결과: 클리어 시간(초), DPS = 피해 ÷ 전투 시간'])
        : ul(['라운드마다 양 진영 전원을 속도 순으로 정렬해 한 번씩 행동 (같으면 아군 먼저)', '턴 시작: 지속 피해 → 자원 회복 → 쿨타임 1 감소 → 행동 (스턴·흐트러짐이면 건너뜀) → 내 상태 지속 1 감소', `제한 ${R.maxTurns}턴 — 넘으면 무승부`, '결과: 클리어 턴 수, 턴당 피해']),
      p(`스킬: 목록 앞쪽(고유 → 직업)부터 쿨타임이 끝났고 자원이 코스트 이상인 스킬을 씀. 자원은 ${R.startRes}에서 시작해 ${U}마다 +${R.resRegen} (최대 ${R.resMax}). 쓸 스킬이 없으면 기본 공격.`)),
    sec('6. 효과',
      ul([
        '발동 확률로 굴려 걸림. 지속은 대상의 ' + (RT ? '초' : '행동 횟수(턴)') + ', 0이면 전투 끝까지',
        '중첩: 같은 효과가 겹치면 수치를 더함 / 중첩 아님: 지속 시간만 처음으로',
        '스턴: 그 동안 행동 불가 · 방어력 감소: 수치(합) 또는 %(곱) · 지속 피해: 건 쪽 공격력의 %를 ' + (RT ? '1초' : '턴') + '마다',
        '회복·보호막: 건 쪽 공격력의 % · 부활: 쓰러진 아군을 최대 체력의 %로',
      ])),
    sec('7. 그로기 (흐트러짐)',
      ul([`스킬에 맞을 때 게이지 += 스킬의 그로기 증가 × ${R.groggyGain} (기본 공격 ${R.basicGroggy})`, '게이지가 몬스터 테이블의 그로기 최대치에 닿으면 흐트러짐',
        `흐트러짐 ${R.groggyDur}${U}: 행동 불가, 받는 피해 × ${R.groggyDmg}`, '끝나면 게이지 0으로 초기화'])),
  ];
  if (party) {
    const syn = (t.synergies || []).map(s => `${s.name} — ${SYN_CONDS[s.cond] ?? s.cond}: ${s.cond === 'role' ? String(s.key ?? '').split('|').map(r => ROLES[r] ?? r).join('+') : s.key}${s.cond === 'element' ? ` ${s.count}명` : ''}`);
    out.push(
      sec('8. 파티 — 타겟팅',
        ul([
          `아군의 공격 대상: ${TARGETING[R.targeting]} / 적의 공격 대상: ${TARGETING[R.enemyTargeting]}`,
          '전열 우선: 살아 있는 전열 중 무작위, 전열이 없으면 후열 · 체력 낮은 대상 우선: 남은 체력 비율이 가장 낮은 대상 · 도발 우선: 도발 효과가 걸린 대상, 없으면 전열 우선',
          `아군 대상 스킬: 회복·보호막은 체력 비율 최저 아군, 버프는 ${ALLY_RULES[R.allyRule]} · 회복은 체력 ${R.healBelow}% 미만 아군이 있을 때만`,
          `광역 스킬은 그 진영의 살아 있는 전원에게, 대상마다 명중·치명타를 따로 굴림`,
          `쓰러진 유닛은 행동에서 빠짐 · 부활 스킬 ${R.revive ? '사용' : '사용 안 함'}`,
          '보스: 체력이 페이즈 기준 % 이하로 내려가면 그 페이즈의 스킬 목록으로 바뀜',
        ])),
      sec('9. 파티 — 시너지',
        p(R.synergy ? '전투 시작 때 조건을 만족한 진영 전원에게 효과를 겁니다 (지속 0이면 전투 끝까지).' : '시너지가 꺼져 있습니다.'),
        syn.length ? ul(syn) : p('시너지 테이블이 비어 있습니다.')),
      sec('10. 파티 — 기여도 계산 방식',
        ul(['가한 피해·받은 피해·회복(보호막 포함)·생존 시간·치명타율은 판마다 센 값의 평균',
          '버프·디버프 기여(추정): 아군이 걸어 준 버프와, 우리 진영이 대상에게 건 디버프를 뺀 데미지를 다시 계산해 늘어난 만큼을 그 효과를 건 사람들에게 똑같이 나눔',
          '교체 비교: 같은 시드로 한 명을 빼거나 바꾼 파티를 다시 돌려 승률·클리어 변화를 봄 — 승률이 크게 떨어질수록 대체하기 어려운 역할'])),
    );
  }
  return out;
}
