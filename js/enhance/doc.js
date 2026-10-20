// 강화 기획서 영역 — 지금 템플릿·구조·실패 보정·역산 설정으로 공식과 규칙을 설명한다 (설정을 바꾸면 함께 바뀜)
import { h } from '../lib/util.js';
import { label } from '../lib/tip.js';
import { TEMPLATES } from './presets.js';
import { ROUND_MODES } from './model.js';

const sec = (title, ...body) => h('section.doc-sec', {}, h('h3', {}, title), ...body);
const p = (...c) => h('p', {}, ...c);
const code = (s) => h('code.doc-code', {}, s);
const ul = (items) => h('ul', {}, ...items.filter(Boolean).map(x => h('li', {}, ...[].concat(x))));

/** cfg = 계산 설정(실패 보정 ON/OFF 반영), state = 화면 상태, res = analyze 결과 */
export function enhanceDoc(state, cfg, res) {
  const st = cfg.streak, inv = state.inverse || {};
  const hasDown = cfg.rows.some(r => r.d > 0), hasBreak = cfg.rows.some(r => r.b > 0);
  const w = (inv.w ?? 50) / 100;
  const streakOn = st && st.kind !== 'none';
  const bonusTxt = st?.bonusMode === 'abs' ? `+${st.bonus}%p` : `기본 성공률의 ${st?.bonus}%`;
  return [
    h('div.card-head', {}, h('h2', {}, ...label('기획서 — 강화 규칙과 공식', 'doc')), h('span.hint', {}, `템플릿: ${TEMPLATES[state.template]?.label ?? ''} · 설정을 바꾸면 함께 바뀜`)),
    sec('1. 기대 비용 공식',
      p(`한 번 시도의 결과: 성공(+1)${cfg.double ? ' · 대성공(+2)' : ''} · 유지${hasDown ? ' · 하락(−1)' : ''}${hasBreak ? ` · 파괴(→ +${cfg.restore}로 복구)` : ''}.`),
      hasDown || hasBreak || streakOn
        ? [p('상태(단계, 연속 카운터)마다 "목표까지 남은 기대 비용 E"를 두면, 한 번 시도한 뒤의 상태로 이어지는 연립방정식이 됩니다 (흡수 마르코프 체인).'),
          code('E(상태) = 1회 비용 + Σ 다음 상태 확률 × E(다음 상태)      →  (I − P) E = r'),
          p('하락·파괴가 서로를 참조해서 위에서부터 차례로 더할 수 없고, 한 번에 풉니다. 시작 단계의 E가 기대 총비용입니다.')]
        : [code('단계 i 기대 비용 = 1회 비용ᵢ ÷ 성공 확률ᵢ      기대 총비용 = Σ 단계별 기대 비용'),
          p('실패해도 단계가 그대로이므로 단계마다 기하분포(성공까지 평균 1/p번)입니다.')],
      p(h('b', {}, '언제 쓰나: '), '평균 비용(매출·재화 소모 총량) 판단. 보통 유저의 체감은 중앙값(P50), 민원 수준은 P90·P99를 결과 분포 카드에서 함께 봅니다.'),
      res?.ok ? p(`지금 설정: 기대 총비용 ${Math.round(res.expCost).toLocaleString('ko-KR')}원, 기대 시도 ${res.attempts.toFixed(1)}회${hasBreak ? `, 파괴 없이 도달 ${(res.noDestroy * 100).toFixed(1)}%` : ''}.`) : null),
    sec('2. 실패 보정 규칙',
      streakOn
        ? ul([
          st.kind === 'fail' ? '카운터: 유지·하락할 때마다 +1, 성공·파괴 시 0' : '카운터: 하락할 때만 +1 (유지는 그대로), 성공·파괴 시 0 — 찬스타임',
          st.bonus > 0 ? `실패 누적 보너스 (켜짐): 카운터 1마다 ${bonusTxt}, 최대 성공률 ${st.cap ?? 100}%` : `실패 누적 보너스: ${state.streak?.bonusOn === false ? '꺼짐' : '없음'}`,
          st.pity ? `천장 (켜짐): 카운터가 ${st.pity}에 닿으면 다음 시도는 확정 성공` : `천장: ${state.streak?.pityOn === false ? '꺼짐' : '없음'}`,
          '보정은 카운터를 상태에 넣은 같은 마르코프 체인으로 정확히 계산하고, 역산·시뮬레이션에도 그대로 반영됩니다.',
        ])
        : p('실패 보정 없음 (연속 보정: 없음). 왼쪽 "연속 보정"에서 실패 누적 보너스와 천장을 각각 켜고 끌 수 있습니다.')),
    sec('3. 목표 기대 비용 역산 — 가중치',
      code('F = 지금 기대 비용 E₀ ÷ 목표 E*      확률 배율 Fp = F^w      비용 배율 Fc = F^(1−w)      새 확률 = 확률 × Fp,  새 비용 = 비용 ÷ Fc'),
      ul([
        `가중치 w = ${w.toFixed(2)} (확률 ${Math.round(w * 100)}% · 비용 ${Math.round((1 - w) * 100)}%) — 0이면 비용만, 1이면 확률만`,
        `확률이 ${inv.pMin ?? 0.01}% ~ ${inv.pMax ?? 100}%를, 비용이 원래의 ${inv.cMin ?? 0.1} ~ ${inv.cMax ?? 10}배를 벗어나는 단계는 범위 끝에 고정하고, 모자란 개선을 반대쪽으로 넘김 (Fp × Fc = s 유지)`,
        hasDown || hasBreak || streakOn ? '하락·파괴·보정이 있으므로 같은 배율 s를 모든 단계에 적용하고, 마르코프 체인 기대 비용이 목표가 되는 s를 이분 탐색으로 찾음 (s ≠ F일 수 있음)' : '페널티가 없는 구조라 s = F로 바로 맞음',
        inv.unit ? `비용 반올림: ${Number(inv.unit).toLocaleString('ko-KR')} 단위 ${ROUND_MODES[inv.mode ?? 'round']} → 반올림한 표로 기대 비용을 다시 계산해 목표와의 오차를 표시` : '비용 반올림 없음 (설정하면 반올림 오차를 함께 표시)',
      ]),
      p(h('b', {}, '언제 쓰나: '), '"평균 비용을 20% 낮추자"처럼 목표 숫자가 먼저 정해졌을 때, 확률을 올릴지 재료를 줄일지(또는 둘 다 얼마나) 정합니다. 확률 위주는 체감 운이, 비용 위주는 재화 소모량이 바뀝니다.')),
    sec('4. 시뮬레이션과 분포',
      ul([`시드 고정 난수로 ${(state.sim?.trials ?? 20000).toLocaleString('ko-KR')}회(계산량 상한 안에서) 돌려 분포·분위를 구함 — 같은 시드면 같은 결과`,
        '공식 기대값과 시뮬레이션 평균의 95% 범위를 계산 검증 카드에서 대조',
        '프리셋 A/B 비교는 두 설정을 같은 시드로 돌려 차이가 운이 아니라 설정 때문이 되게 함'])),
  ];
}
