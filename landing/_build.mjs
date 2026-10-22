// 소개 페이지 생성기 — landing/index.html(랜딩)과 도구별 세부 페이지 8장을 만든다.
// 공통 기능(용어 툴팁·시드·입력 검증·결과 분포·프리셋 A/B 비교·기획서 영역)은 각 도구의 기능 칸과 랜딩의 작업 흐름 띠에 들어 있다.
// 결과물은 각각 혼자 열리는 HTML(Tailwind CDN · Pretendard · Iconify Solar)이고, 이 스크립트는 문구·구조를 고칠 때만 다시 돌린다:
//   node landing/_build.mjs
// 수치는 모두 워크벤치 템플릿을 실제로 돌린 결과와 테스트 수다(docs/case-study.md, README). 가짜 후기·만든 지표는 넣지 않는다.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const APP = '../index.html';
const REPO = 'https://github.com/junhy96/gamedesign_workbench';
const TESTS = 158;

// ── 도구 데이터 ──────────────────────────────────────────
const TOOLS = [
  {
    id: 'enhance', name: '강화 확률·비용 설계', short: '강화', icon: 'solar:magic-stick-3-linear', cat: '강화 · BM',
    tagline: '하락·파괴·천장이 섞인 강화의 기대 비용을 정확하게',
    card: '+15까지 평균·운 나쁜 1%·예산별 도달 확률, 보조 아이템 가격까지',
    desc: '단계별 성공·대성공·유지·하락·파괴 확률과 재화 비용을 넣으면, 목표 단계까지의 기대 총비용과 편차, 파괴 위험, 예산별 도달 확률을 계산합니다. 보조 아이템을 가장 싸게 쓰는 정책과 아이템 가격 곡선으로 BM 가격을 검토합니다.',
    facts: [['27,967원', '+0 → +15 기대 총비용 (기본 템플릿)'], ['30.4%', '한 번도 파괴되지 않고 도달할 확률'], ['−52.8%', '보조 아이템을 최적으로 쓸 때 줄어드는 비용']],
    questions: ['+15까지 평균 얼마가 들고, 운 나쁜 1%는 얼마를 쓰나요?', '3만 원 안에 목표에 닿는 유저는 몇 %인가요?', '파괴방지권 가격이 적정한가요? 합리적인 유저는 어느 단계부터 쓰나요?', '목표 기대 비용에 맞추려면 성공률과 비용을 각각 얼마나 바꿔야 하나요?'],
    features: [
      ['solar:calculator-minimalistic-linear', '정확한 기대값과 편차', '단계 × 연속 카운터를 상태로 둔 흡수 마르코프 체인을 띠 행렬 LU와 Sherman–Morrison 공식으로 풉니다. 천장 수십 회 × 단계 수십 개도 바로 계산되고, 표준편차·단계별 파괴 확률·민감도가 같은 분해 하나에서 나옵니다.', ['(I − P) E = r', '상태 = (단계, 연속 실패)', '표준편차 ← 2차 모멘트']],
      ['solar:target-linear', '보조 아이템 최적 사용 정책', '상태마다 파괴방지·하락방지·성공률 증가 아이템 조합을 골라 기대 총비용이 가장 낮은 정책을 정책 반복법으로 찾습니다. 아이템이 필수품이 될 만큼 싼지 바로 보입니다.', ['아이템 없이 27,967원', '최적 정책 13,196원', '정책 반복 3회로 수렴']],
      ['solar:chart-2-linear', '아이템 가격 곡선', '한 아이템의 가격을 범위로 바꾸며 최적 정책을 다시 풀고, 가격별 BM 기대 매출과 유저 절감률을 그립니다. 매출이 가장 큰 가격과 절감률이 목표 이하가 되는 가격을 찾아 버튼 하나로 적용합니다.', ['가격 → 최적 정책 → 매출', '절감률 목표 이하 가격', '찾은 가격 바로 적용']],
      ['solar:graph-up-linear', '분포·분위·강화 경로', '시뮬레이션 2만 회(횟수·시드는 바꿀 수 있음)로 총비용·시도 횟수 분포(P10·P50·P90·P99), 0.1%~99.9% 달성 분위, 예산별 도달 확률을 보여 주고, 앞 12번 시행의 단계 경로로 하락·파괴가 실제로 어떻게 일어나는지 그립니다.', ['P10 7,560원 · P50 2만 912원', 'P90 5만 7,490원 · P99 10만 9,980원', '파괴 지점이 보이는 경로']],
      ['solar:scale-linear', '목표 비용 역산 — 확률·비용 가중치', '필요한 개선 배율 F = 지금 ÷ 목표를 슬라이더 비율대로 확률(× F^w)과 비용(÷ F^(1−w))에 나눕니다. 범위를 벗어나는 단계는 끝에 고정하고 반대쪽으로 넘기며, 하락·파괴가 있으면 마르코프 체인으로 다시 계산해 정확히 맞춥니다. 비용 반올림 뒤 오차도 보여 줍니다.', ['27,967원 → 22,373원: F = 1.25', '가중치 50% → 확률 ×1.0611 · 비용 ÷1.0611', '1 단위 반올림 오차 +4.97%']],
    ],
    method: ['상태 = (단계, 연속 카운터). 상태별 기대 비용 E는 (I − P)E = r', '띠 행렬 + 파괴로 생기는 한 열 → 띠 LU + Sherman–Morrison', '아이템 최적화 = 마르코프 결정 과정의 정책 반복', '목표 비용 역산 = 곱셈 분배(확률 × s^w, 비용 ÷ s^(1−w)) + 로그 이분 탐색', '분포 = 몬테카를로 2만 회 (Web Worker, 시드 고정)'],
    verify: ['체인과 따로 게임 규칙을 그대로 구현한 시뮬레이터와 모든 메커닉에서 일치', '띠 행렬 풀이 = 밀집 행렬 가우스 소거 (오차 1e-8)', '최적 정책 ≤ 수동 조합, 가격 곡선 30개 점 = 전수 탐색 정답', '역산: 한 단계면 s = F 정확히, 하락·파괴 구조도 목표 기대 비용에 맞음 (가중치 0·0.5·1), 100% 고정·넘김, 반올림 오차'],
    tests: 29,
    case: ['최적 사용 정책이 보여 준 가격 오류', '아이템 없이 27,967원이던 기대 비용이 최적 정책으로 13,196원(−52.8%)이 됩니다. 합리적인 유저가 쓰면 비용이 절반이 되는 아이템은 선택이 아니라 필수품입니다. 절감 폭이 의도한 수준(예: 15% 이내)이 되고, 아이템을 쓰는 단계가 +12 이상으로 좁혀질 때까지 가격을 조정합니다.'],
    related: ['gacha', 'battle', 'brief'],
  },
  {
    id: 'gacha', name: '가챠·수집 설계', short: '가챠', icon: 'solar:gift-linear', cat: '가챠 · BM',
    tagline: '“필요 장수 ÷ 확률”이 놓치는 중복과 확률 구조까지',
    card: '단순 계산 → 확률 구조 → 중복으로 비용을 나누고, 확률 공시표까지',
    desc: '등급 확률, 소환 레벨(ON/OFF), 천장(확률 상승), 픽업 보장, 마일리지, 10연 보장, 중복 분해 교환을 넣고 “이 유닛을 이만큼 모으려면 얼마가 드나”를 계산합니다. 비용이 왜 이만큼 드는지 원인을 나누고, 공시용 확률표를 만듭니다.',
    facts: [['×1.71', '단순 계산 대비 실제 기대 뽑기 (레전드 전원 풀 초월)'], ['205,056회', '실제 기대 뽑기 — 단순 계산은 120,000회'], ['684일', '월 3만 원 과금 유저의 평균 도달']],
    questions: ['레전드 4종을 6장씩 모으려면 실제로 몇 번을 뽑나요?', '천장·마일리지·조각 교환 중 무엇이 운 나쁜 1%의 꼬리를 자르나요?', '무과금 유저와 과금 유저는 며칠이 걸리나요?', '공시할 캐릭터별 확률과 천장 변동표는 어떻게 되나요?'],
    features: [
      ['solar:layers-minimalistic-linear', '비용 원인 분해', '단순 계산(필요 장수 ÷ 확률) → 중복이 없다면(소환 레벨·천장·교환 효과) → 실제(중복 효과)로 나눠, 확률을 올릴지 교환을 넣을지 구분합니다.', ['① 단순 계산 120,000', '② 중복이 없다면 176,479 (×1.47)', '③ 실제 205,056 (×1.16)']],
      ['solar:calculator-minimalistic-linear', '공식 계산 + 시뮬레이션', '수집 목표는 포아송화 적분, 픽업·특정 캐릭터는 (모은 장수 × 천장 카운터 × 보장) 상태를 뽑기마다 전진시키는 동적 계획법으로 분포까지 구합니다. 나머지는 기하분포로 건너뛰는 시뮬레이션이라 0.005% 확률 목표도 바로 계산됩니다.', ['E[N] = (1/λ)∫ 1 − P(k,u)^K du', '상태 = (장수, 천장, 보장)', '확률이 바뀌는 지점에서만 끊기']],
      ['solar:list-check-linear', '확률 공시표', '소환 레벨별 등급 확률, 모든 캐릭터의 개별 확률, 천장 확률 변동표, 천장·보장을 포함한 실효 확률, 확률이 바뀌는 조건 문장을 만들고, 반올림하면 0%로 보이는 캐릭터와 합계 오차를 경고합니다.', ['캐릭터별 확률 합 100%', '천장 변동표·실효 확률', 'CSV (소수 6자리 이상)']],
      ['solar:graph-up-linear', '분위·수렴', '0.1%~99.9% 달성 분위(뽑기·비용·무과금 도달일·천장 구간 당첨)와 시뮬레이션 수렴 그래프로 운 나쁜 유저가 어디까지 가는지 보여 줍니다.', ['99% = 266,762회', '마일리지안 99% = 200,000회', '천장 구간 당첨 횟수 분위']],
      ['solar:tuning-2-linear', '소환 레벨 ON/OFF · 10연 보장', '스위치 하나로 고정 확률형(서브컬처)과 소환 레벨형(방치형)을 오가고, 모드마다 넣은 확률표를 따로 보관합니다. 레벨업은 횟수·경험치 방식과 레벨업 비용·보상을, 10연 보장은 등급별 실제 비율을 계산합니다.', ['SR 이상 10연 보장: SR 8% → 11.62%', 'SR 도감 899회 → 620회', '경험치 2배: 205,056회 → 172,305회']],
    ],
    method: ['수집: E[N] = (1/λ)∫ 1 − P(k, u)^K du (포아송화, 심프슨 적분)', '픽업·특정 캐릭터: 상태 분포 동적 계획법 (분포 전체)', '실효 확률 = 최상위 1장당 평균 뽑기의 역수', '10연 보장 비율 = (9p + (1 − a)p + a·p/q) ÷ 10, a = (1 − q)⁹', '시뮬레이션: 확률이 바뀌는 지점에서만 끊는 기하분포 건너뛰기 (10연 보장은 한 번씩 뽑기)'],
    verify: ['쿠폰 수집 n·Hₙ/p, 음이항 평균과 오차 1e-6', '천장: 절단 기하분포 해석해와 일치', '공시표: 레벨마다 캐릭터 확률 합 100%, 천장 변동표 마지막 줄 100%', '10연 보장 비율 공식 합 100%, 한 번씩 뽑기 = 건너뛰기 시뮬레이션 (보장이 효과 없을 때)'],
    tests: 26,
    case: ['마일리지 선택권이 꼬리를 정확히 자릅니다', '방치형 동료 소환에서 레전드 천장(8천 회)은 평균을 26% 줄이지만 레전드가 나오는 속도 자체를 바꿔 스테이지 밸런스까지 흔듭니다. 2만 회마다 레전드 선택권을 주는 마일리지는 평균을 20% 줄이면서 99% 꼬리를 266,762회에서 정확히 200,000회로 자릅니다. 공시 확률은 그대로 두고 “아무리 운이 나빠도 여기까지”를 보여 줄 수 있어 1차안으로 골랐습니다.'],
    related: ['enhance', 'growth', 'brief'],
  },
  {
    id: 'growth', name: '성장 표 템플릿 (엑셀)', short: '성장 표', icon: 'solar:graph-up-linear', cat: '성장 · 엑셀',
    tagline: '툴은 뼈대만, 콘텐츠 규칙은 엑셀에서 행을 더해 늘립니다',
    card: '레벨 곡선·공급원·세그먼트로 일차별 진행을 미리 보고, 수식이 살아 있는 .xlsx로',
    desc: '레벨 곡선(base·구간별 증가율·점프·상한)과 콘텐츠 공급원, 유저 세그먼트를 정하면 세그먼트마다 일차별 레벨 진행과 최장 무성장 기간을 보여 주고, 마일스톤에 맞는 base를 자동으로 풉니다. 결과는 수식이 살아 있는 엑셀로 내보내, 게임마다 다른 콘텐츠 규칙은 엑셀에서 행을 더해 늘립니다.',
    facts: [['14 · 60일차', 'MMO 프리셋 코어 유저의 Lv30·Lv50 도달 (두 마일스톤에 맞춰 푼 값)'], ['6일', '같은 표에서 라이트 유저(주 4일·40분)의 최장 무성장 기간'], ['100행', '② 공급원 빈 행에 적으면 ④·⑤에 바로 반영']],
    questions: ['코어 유저가 7일에 Lv20, 30일에 Lv40이 되려면 레벨 곡선의 base와 증가율은 얼마인가요?', '같은 표에서 라이트 유저는 며칠 동안 레벨이 멈추나요?', '콘텐츠 경계의 30% 점프가 라이트와 헤비에게 각각 얼마나 체감되나요?', '새 콘텐츠를 넣으면 엑셀에서 어디만 고치면 되나요?'],
    features: [
      ['solar:chart-2-linear', '레벨 곡선 — 경사와 점프', '필요량(L) = 필요량(L−1) × (1 + 구간 증가율) × (점프 레벨이면 J). 단일 등비는 후반에 폭주하기 쉬워 구간을 나누고 상한을 둘 수 있습니다. 콘텐츠 경계에서 한 번 크게 오르는 "완만한 경사 + 점프"를 그대로 표현합니다.', ['구간별 증가율', '점프 레벨 × J', '필요량 상한']],
      ['solar:box-linear', '공급원과 세그먼트', '공급원마다 주기(매일·매주·1회), 해금(일차·레벨), 획득 방식(고정·레벨별 표·현재 필요량 %), 시간 비례를 고릅니다. 세그먼트는 하루 플레이 분과 요일별 접속 패턴(무작위 없음)으로 정의합니다.', ['매일 · 매주 · 1회', '고정 · 표 · %', '요일별 접속 1/0']],
      ['solar:target-linear', 'base·증가율 자동 풀이', '기준 세그먼트가 첫 마일스톤에 목표 일차 안에 닿는 가장 큰 base를 이분 탐색으로 찾고, 원하면 증가율 배율까지 두 번째 마일스톤에 맞춥니다.', ['도달일은 base에 대해 단조', '중첩 이분 탐색', '버튼 하나로 적용']],
      ['solar:file-download-linear', '수식이 살아 있는 .xlsx', '① 레벨 곡선 · ② 공급원 · ③ 세그먼트 · ④ 일차별 진행 · ⑤ 검증(차트 포함)을 값이 아니라 수식으로 채웁니다. 하루 공급은 ② 100행 전체를 한 SUMPRODUCT로 더해서, 빈 행에 콘텐츠를 적으면 바로 반영됩니다.', ['전날 행만 참조 (순환 참조 없음)', '드롭다운 · 입력 칸 색', '서버 전송 없음']],
    ],
    method: ['레벨 곡선: raw(L) = raw(L−1) × (1 + r(L)/100) × J^[L이 점프], 필요량 = round(raw), 상한', '하루: 시작 레벨 = 전날 끝 레벨 → 공급 = Σ 공급원 [주기·해금] × [획득량] × [시간] × 배율 × 횟수 → 누적 → 끝 레벨 = 누적 MATCH', '도달일(L) = 끝 레벨이 L보다 낮았던 날 수 + 1, 최장 무성장 = 레벨이 멈춘 날 연속의 최댓값', 'base = 도달일 ≤ 목표인 가장 큰 값 (이분 탐색)'],
    verify: ['내보낸 .xlsx를 LibreOffice로 다시 계산한 값 = JS 참조 계산 (프리셋 3종 × 일차별 값·도달일·공급원 총량)', '② 빈 행에 공급원을 적은 파일도 같은 방식으로 일치', 'Microsoft Excel에서 같은 값, 수식 오류 0'],
    tests: 9,
    case: ['같은 표, 다른 체감', 'MMO 프리셋은 코어 유저가 Lv30에 14일차, Lv50에 60일차에 닿도록 base와 증가율을 풀어 둔 표입니다. 같은 표에서 주 4일·40분 플레이하는 라이트 유저는 120일에 Lv45에 머물고, 레벨이 오르지 않는 날이 최장 6일 이어집니다. 일일 퀘스트처럼 현재 필요량에 비례하는 공급을 늘릴지, 고정 보상을 늘릴지를 이 차이로 정합니다.'],
    related: ['enhance', 'gacha', 'brief'],
  },
  {
    id: 'combat', name: '전투 시뮬레이터', short: '전투 시뮬', icon: 'solar:users-group-rounded-linear', cat: '전투 · 파티',
    tagline: '테이블 그대로 1:1과 파티 전투를 수백 번 돌려 봅니다',
    card: '턴제·실시간, 데미지 공식 4종, 그로기·페이즈·시너지, 기여도와 조합 순위까지',
    desc: '데이터 테이블의 캐릭터·몬스터·스킬·효과·상성·시너지를 읽어 1:1 전투와 파티 전투(N:N, N:보스)를 같은 규칙으로 돌립니다. 턴제와 실시간, 데미지 공식·명중·치명타·버프 합산·그로기 규칙을 바꿔 승률과 클리어 시간 분포, 캐릭터별 기여도를 보고, 교체 비교와 조합 자동 생성으로 누가 승패를 가르는지 찾습니다.',
    facts: [['31.7% → 88.3%', '같은 파티 대 화염 골렘 — 턴제와 실시간의 승률'], ['1 / 35', '7명 중 4명 조합 가운데 보스를 잡는 조합 수'], ['59 · 87턴', '이긴 판의 클리어 P50 · P99']],
    questions: ['5인 파티가 이 보스를 몇 %로, 보통 몇 턴에 잡나요? 운 나쁜 1%는?', '같은 데이터인데 턴제와 실시간 중 무엇을 고르느냐로 승률이 얼마나 달라지나요?', '파티에서 누가 빠지면 클리어가 안 되나요? 버퍼의 몫은 얼마인가요?', '캐릭터 7명 중 4명을 고르는 35가지 조합 중 어느 조합이 가장 강한가요?'],
    features: [
      ['solar:shuffle-linear', '턴제와 실시간을 같은 데이터로', '턴제는 라운드마다 속도 순으로 한 번씩, 실시간은 초당 행동 = 속도 ÷ 100으로 행동합니다. 쿨타임·지속·자원 회복도 방식에 맞춰 턴 또는 초로 셉니다. 같은 파티가 턴제 31.7%, 실시간 88.3% — 우리 게임이 어느 쪽인지 먼저 정하게 합니다.', ['턴제 61.0턴 · 실시간 44.9초', '실시간 한 판 행동: 핀 57.6회, 골렘 36.4회', '제한 턴·시간 넘으면 무승부']],
      ['solar:calculator-minimalistic-linear', '데미지 공식 4종과 계산 순서', '상수 감소형·단순 차감형·비율 감소형·곱연산형 중 고르면 인자 설명과 함께 바로 다시 계산합니다. 한 대의 데미지는 기본 공식 × 스킬 배율 → 상성 → 치명타 → 받는 피해 증감 → 그로기 순서이고, 예시 카드가 단계별 값을 보여 줍니다.', ['공 × K ÷ (K + 방) = 174.4', '+20% 버프 두 개: 합 ×1.40 · 곱 ×1.44', '평균 클리어 23.4 / 19.0 / 18.2 / 34.3턴']],
      ['solar:bolt-linear', '그로기 · 페이즈 · 시너지 · 효과', '스킬마다 쌓이는 그로기 게이지가 차면 보스가 흐트러지고(행동 불가, 받는 피해 ×1.5), 체력 70%·30%에서 페이즈가 바뀝니다. 스턴·지속 피해·방어 감소·회복·보호막·도발·부활과 시너지(같은 속성·역할군·특정 캐릭터)를 테이블 그대로 적용합니다.', ['흐트러짐 9 · 19 · 29 · 39턴', '받는 피해 ×2.0 → 승률 48.7%', '시너지 끄면 0승']],
      ['solar:chart-square-linear', '기여도·교체 비교·조합 순위', '가한 피해·회복·보호막·버프 기여·생존율을 판 평균으로, 한 명씩 빼 본 파티의 승률 변화를 같은 시드로 보여 줍니다. 풀에서 조합을 자동으로 만들어 승률 순위를 매기고, 전투 로그는 필터와 CSV·JSON으로 내보냅니다.', ['핀 빼기 −8.0%p, 다른 넷은 0%', '버프 기여 판당 약 2,000', '조합 35개 × 80판, 같은 시드']],
      ['solar:scale-linear', '분포 · 프리셋 A/B · 기획서', '이긴 판의 클리어 시간을 P10·P50·P90·P99와 히스토그램으로 보여 주고, 설정을 프리셋으로 저장해 두 설정을 같은 시드로 비교합니다. 기획서 영역은 지금 고른 공식·계산 순서·규칙을 문장으로 정리합니다.', ['P10 53 · P50 59 · P90 70 · P99 87턴', '프리셋 비교 CSV · JSON', '규칙을 바꾸면 문장도 함께']],
    ],
    method: ['전투 = 이산 사건 시뮬레이션: 턴제는 라운드별 속도 순, 실시간은 다음 행동 시각과 1초 틱 중 이른 쪽부터', '데미지 = 기본 공식(공, 방) × 스킬 배율 × 상성 × 치명 × 받는 피해 × 그로기 → 반올림 → 보호막 → 체력', '버프 기여 = 실제 데미지 − 남이 건 버프·디버프를 뺀 데미지 (건 사람에게 똑같이)', '조합·교체·프리셋 비교는 모든 경우에 같은 시드 (공통 난수)'],
    verify: ['데미지 공식 4종, 한 대의 계산 순서, 버프 합·곱연산이 정의대로', '턴제 행동 순서·쿨타임·코스트, 실시간 행동 빈도, 스턴·그로기·페이즈·시너지·타겟팅·부활', '같은 시드 = 같은 결과, 다른 시드 = 다른 결과'],
    tests: 12,
    case: ['정답 파티가 하나뿐인 보스', '캐릭터 7명 중 4명을 고르는 조합 35개를 같은 시드로 돌리면, 화염 골렘을 잡는 조합은 아렌·브리지드·달리아·엘라(승률 28.7%) 하나뿐입니다. 5인 파티에서 탱커·딜러·힐러 중 누구를 빼도 승률이 0%가 됩니다. 4인 콘텐츠로 쓰려면 보스 수치를 낮추거나, 다른 역할 조합에도 길을 열어 줄지 정해야 한다는 근거가 됩니다.'],
    related: ['data', 'battle', 'frame'],
  },
  {
    id: 'battle', name: '스탯·전투 밸런스', short: '스탯·전투', icon: 'solar:gamepad-linear', cat: '전투 · 스탯',
    tagline: 'CP는 높은데 실제로는 지는 캐릭터를 찾아냅니다',
    card: '엔티티 × 스탯 × 수식으로 레벨별 CP와 1:1 승률, 특성까지',
    desc: '엔티티 × 스탯 × 규칙 수식으로 레벨별 전투력(CP)과 1:1 승률을 계산합니다. 데미지 변동이 없으면 승률을 시뮬레이션 없이 공식으로 바로 구하고, 공격 속도는 같은 시간 동안의 공격 횟수로 반영합니다. 특성, 구간 리포트, 밸런스 도구, Unity·Unreal 내보내기까지 이어집니다.',
    facts: [['24.8%', 'CP 2위 궁수의 전사 상대 승률 (4직업 템플릿)'], ['2.6% → 75.1%', '공격 속도를 공격 횟수로 반영하면 바뀌는 승률'], ['0.72643', 'Kalivra 엔진 140만 회 결과(0.72676)와 맞는 공식 계산']],
    questions: ['CP가 높은데 실제로는 지는 캐릭터가 있나요?', '레벨 구간마다 누가 메타를 지배하나요?', '이 상성을 50%로 맞추려면 어느 스탯을 얼마나 바꿔야 하나요?', '흡혈·가시 같은 특성은 승률을 몇 %p 바꾸나요?'],
    features: [
      ['solar:calculator-minimalistic-linear', '1:1 승률 — 시간 기반과 턴 교대', '쓰러뜨릴 때까지의 공격 횟수 분포를 (일반 적중 수, 치명 수) 상태로 구하고, 두 엔티티의 횟수가 독립이라는 점으로 승·무·패를 바로 계산합니다. 시간 기반은 공격 속도가 공격 횟수가 되고, 턴 교대는 Kalivra와 같은 방식입니다.', ['n번째 공격 = (n − 1) ÷ 공격 속도', '무승부를 따로 셈', '변동·특성 = 시뮬레이션 + 95% 범위']],
      ['solar:ranking-linear', 'CP와 실제 승률, 승률 행렬', '레벨별 CP·초당 데미지·처치 시간 곡선과 역전 레벨, 모든 쌍의 승률 행렬, CP 순위와 실제 순위의 상관, CP가 높은데 지는 쌍, 상성 순환과 구간 지배를 보여 줍니다.', ['CP 순위 상관 0.80', 'CP 역전 2쌍', '구간 리포트']],
      ['solar:bolt-linear', '특성과 전투 로그', '발동 시점 8가지 × 확률 × 체력 조건 × 효과 5가지(회복·추가 데미지·데미지 배율·스탯 버프)의 특성을 붙이고, 전투 로그 20전투와 체력 타임라인, 전투 길이 분포로 확인합니다.', ['효과는 발동 한 번에 한 번', '쓰러뜨린 뒤 피격 효과 없음', '체력 타임라인']],
      ['solar:play-circle-linear', '배틀 시뮬레이터 — FIGHT · M.C', 'Kalivra의 FIGHT와 M.C를 같은 지표로: 한 엔티티 대 상대(또는 전체)를 횟수만큼 돌려 승률·평균 길이·전투 로그 100개·구간별 승률을 보고, 한 쌍을 1만 번 돌려 선공일 때 승률·승리 시 남은 체력·오버킬·DPT까지 봅니다. 시드가 고정이라 다시 눌러도 같은 숫자입니다.', ['Chicken 대 Godzilla Lv20: 30.2%', '선공 81.7% · 선공일 때 30.5%', '오버킬 54.6 · DPT 94.1']],
      ['solar:code-square-linear', '밸런스 도구와 엔진 내보내기', '점수를 목표로 만드는 스탯별 최소 배율, 민감도, 아이템·특성 효과 분해, CP·점수 목표 역산을 하고, 규칙 수식을 C#·C++ 코드로 옮겨 Unity·Unreal 파일로 내보냅니다.', ['공격 속도 ×1.153 → 51.3%', 'Unity ScriptableObject', 'Unreal DataTable']],
    ],
    method: ['공격 한 번 = 빗나감 / 일반 / 치명. 쓰러뜨리는 공격 횟수 분포를 동적 계획법으로', 'P(A 승) = Σₙ P(N_A = n) · P(B가 그 시각 전에 못 쓰러뜨림)', '턴 교대: 공격 속도 비율로 선공, 번갈아 공격, 최대 턴', '수식은 자체 파서로 해석 — 코드 실행 없음'],
    verify: ['턴 교대 공식 계산 = Kalivra v1.0.1 엔진을 그대로 돌린 결과 (40만~140만 회, 3σ 안)', '특성(흡혈·공격 직전 배율)도 Kalivra 60만 회와 일치', '시간 기반 공식 계산 = 자체 시뮬레이션 (무작위 설정 12개 × 두 방식)'],
    tests: 39,
    case: ['전투 규칙 하나가 결론을 뒤집습니다', 'Kalivra 기본 샘플은 데미지 수식에 a./b. 접두어가 없어 1만 회 모두 무승부였습니다. 수식을 고쳐도 공격 속도를 선공 확률로만 쓰면 Chicken의 Lv10 승률은 2.6%입니다. 같은 설정에서 공격 속도를 같은 시간의 공격 횟수로 반영하면 75.1%가 됩니다.'],
    related: ['combat', 'frame', 'brief'],
  },
  {
    id: 'data', name: '데이터 테이블', short: '데이터', icon: 'solar:database-linear', cat: '전투 · 데이터',
    tagline: '엑셀 전투 시트를 그대로 옮겨 와 깨진 참조를 찾습니다',
    card: '직업·캐릭터·몬스터·스킬·효과·상성·시너지, CSV 왕복과 ID 참조 검증',
    desc: '전투 시뮬레이터가 읽는 직업·캐릭터·몬스터·스킬·효과·속성 상성·시너지 일곱 개 테이블을 편집합니다. 테이블끼리는 ID로 참조하고, 엑셀이 저장한 CSV를 그대로 불러오며, 없는 ID 참조·중복 ID·빈 필수값·범위 밖 숫자를 행과 칸에 표시합니다. 행을 더하면 시뮬레이터의 선택 목록에 바로 나타납니다.',
    facts: [['7개', '테이블 (직업 7 · 캐릭터 8 · 몬스터 4 · 스킬 19 · 효과 15 · 상성 6 · 시너지 3)'], ['0건', '기본 데이터의 오류·경고 — 오타 하나도 행·칸으로 표시'], ['2,740 · 279', '아렌 Lv30의 체력·공격력 (직업 기본 → 레벨 성장 → 보정)']],
    questions: ['엑셀에서 고친 스킬 시트에 없는 효과 ID를 참조하는 행은 없나요?', '캐릭터를 하나 추가하면 최종 스탯은 얼마가 되나요?', '스킬 ID 이름을 바꾸면 그 스킬을 쓰던 몬스터와 보스 페이즈는 어떻게 되나요?', '속성 상성과 시너지 조건을 한곳에서 관리할 수 있나요?'],
    features: [
      ['solar:checklist-minimalistic-linear', '검증 — 빨간 칸과 노란 칸', '모든 ID를 먼저 모은 뒤 참조 칸(ClassID, 속성, 스킬·효과 목록, 페이즈 안의 스킬, 시너지 조건 값)을 하나씩 대조합니다. 빈 필수값·중복 ID·숫자 범위·선택지 밖 값은 오류, 효과가 걸리지 않는 설정은 경고로 표시하고, 오류를 누르면 그 칸으로 이동합니다.', ['CL_WARIOR → 직업 테이블에 없음', 'EF_STUNN → 효과 테이블에 없음', '발동 확률 130 → 100 이하']],
      ['solar:file-download-linear', 'CSV 왕복 — 엑셀 저장본 그대로', 'BOM, 따옴표 안 쉼표·줄바꿈, 쉼표·세미콜론·탭 구분자, 한글 머리글(체력)과 한글 선택지(탱커)를 그대로 읽습니다. 내보낼 때는 열 키와 한글 선택지로 써서 엑셀에서 바로 열립니다. 전체 또는 테이블 하나를 JSON으로도 주고받습니다.', ['머리글: hp 또는 체력', '여러 ID: SK_A|SK_B', '7개 테이블 왕복 일치']],
      ['solar:link-round-linear', 'ID 바꾸기와 참조', 'ID를 고치면 그 ID를 가리키던 다른 테이블의 칸도 함께 바뀝니다. 보스 페이즈 문자열("70=SK_FLAME|SK_SLAM; 30=…") 안의 스킬, 상성 표의 열, 같은 속성 시너지의 조건 값까지 따라갑니다.', ['SK_SLAM → SK_SMASH', '몬스터 스킬·페이즈 함께', '이미 있는 ID면 중복 오류']],
      ['solar:layers-minimalistic-linear', '최종 스탯 계산 순서', '① 직업 기본(Lv1) → ② 레벨 성장(성장 × (Lv − 1)) → ③ 캐릭터 보정(합: + 값 / 곱: × (1 + 값%)) → ④ 장비·버프. 전투 시뮬레이터의 대결 구성 표가 단계별 값을 그대로 보여 줍니다.', ['아렌: 900 → 2,640 → 2,740', '달리아 공격력: 371.5 × 1.1 = 408.7', '몬스터는 표의 값 그대로']],
    ],
    method: ['테이블 정의(열 종류: ID·문자·숫자·선택지·참·거짓·참조·여러 참조·페이즈) 하나로 편집기·검증·CSV를 함께 만듦', '검증: ID 목록을 만든 뒤 모든 참조 칸을 대조 (참조 무결성)', 'CSV: RFC 4180, 구분자는 첫 줄에서 가장 많은 쪽', '최종 스탯 = (직업 기본 + 성장 × (Lv − 1)) 보정 합/곱 → 장비·버프'],
    verify: ['기본 데이터는 오류·경고 없이 통과', '7개 테이블 CSV 내보내기 → 가져오기 왕복이 같음, 엑셀 CSV(BOM·세미콜론·따옴표·한글 머리글)', '없는 ID·중복 ID·빈 필수값·숫자 범위·선택지 밖 값을 행 단위로 표시, 페이즈 형식'],
    tests: 8,
    case: ['오타 하나가 보스를 바꿉니다', '스킬 시트에서 SK_SLAM을 지우면, 그 스킬을 쓰던 오크 전사와 화염 골렘 페이즈가 조용히 깨지고 전투에서는 "보스가 스킬을 안 쓴다"는 엉뚱한 증상으로 나타납니다. 데이터 테이블은 이런 깨진 참조를 전투를 돌리기 전에 칸 단위로 보여 주고, ID를 바꾸면 참조를 함께 고칩니다.'],
    related: ['combat', 'battle', 'growth'],
  },
  {
    id: 'frame', name: '패턴 프레임 검증기', short: '프레임', icon: 'solar:stopwatch-linear', cat: '전투 · 액션',
    tagline: '“이 연계는 회피 윈도우가 3프레임”을 숫자로 판정합니다',
    card: '선딜·판정·후딜과 회피 무적으로 반응·암기·반격 여유 판정',
    desc: '보스 연계의 선딜·판정·후딜과 플레이어의 회피 무적 프레임을 넣으면, 타격마다 보고 피할 수 있는지, 외워야 하는지, 반격할 틈이 있는지 판정합니다. 전투 기획서의 기술 일람 양식 그대로 PowerPoint로 내보냅니다.',
    facts: [['3f', '기본 템플릿에서 가장 빡빡한 회피 윈도우'], ['1개', '반응이 늦어 외워야 하는 타격'], ['4번', '연계 안에서 반격할 수 있는 기회']],
    questions: ['이 타격은 보고 반응해서 피할 수 있나요, 외워야 하나요?', '연계 중 회피 후딜 때문에 다음 타격을 못 피하는 곳은 어디인가요?', '반격은 몇 번 넣을 수 있나요?', '선딜을 몇 프레임 늘리면 반응 가능한 패턴이 되나요?'],
    features: [
      ['solar:ruler-pen-linear', '회피 윈도우', '타격 [h0, h1]을 무적으로 덮는 입력 구간의 길이 = 무적 − 판정 + 1. 0 이하면 구르기로 피할 수 없다고 판정하고, 연계 중 직전 회피 후딜로 줄어든 윈도우도 계산합니다.', ['윈도우 = 무적 − 판정 + 1', '연계 중 실제 윈도우', '30 / 60 / 120fps']],
      ['solar:danger-triangle-linear', '반응·암기 판정과 수정 제안', '식별 시점 + 반응 시간 + 입력·화면 지연이 마지막 유효 입력보다 늦으면 암기 패턴입니다. 몇 프레임 늦는지, 선딜을 얼마나 늘리면 되는지까지 문장으로 알려 줍니다.', ['식별 + 반응 + 지연', '≤ 마지막 유효 입력', '선딜 수정 제안']],
      ['solar:routing-2-linear', '최적 입력 계획', '타격을 무리로 나눠 회피 한 번이 무리 전체를 덮게 하고, 다시 행동 가능한 가장 이른 프레임을 상태로 둔 동적 계획법으로 최적 입력을 찾습니다. 반응형으로는 못 피하지만 최적 입력으로는 피하는 타격을 “선입력 강제”로 표시합니다.', ['동적 계획법', '선입력 강제 감지', '반격 가능 횟수']],
      ['solar:document-text-linear', '기술 일람 양식 PowerPoint', '패턴 타임라인 → 공격별 1장(공격 구간 확대) → 패턴별 판정 표 → 검증 결과를 편집 가능한 도형으로 저장합니다. 애니메이션 띠는 캡처를 붙여 넣는 자리로 비워 둡니다.', ['보라 헤더 바 · 정보 표', '초 단위 축과 둥근 막대', '편집 가능한 도형']],
    ],
    method: ['회피 입력 구간 = [판정 끝 − 선딜 − 무적 + 1, 판정 시작 − 선딜]', '반응 가능 = 식별 시점 + 반응 시간 + 입력 지연 ≤ 마지막 유효 입력', '최적 입력 계획 = 타격 무리별 회피 1회, 다시 행동 가능한 가장 이른 프레임을 상태로', '반격 여유 = 회피 끝 ~ 다음 타격을 피하기 위한 마지막 입력'],
    verify: ['회피 윈도우 공식 = 모든 입력 프레임 직접 대입 (조합 1,200가지)', '최적 입력 계획 = 모든 입력 조합 브루트포스 (무작위 연계 1,000개)', '기본 템플릿 손계산 값, 선입력 강제 감지, 한 번에 여러 타격 회피'],
    tests: 11,
    case: ['브루트포스 테스트가 찾아낸 계산 실수', '처음에는 가장 이른 입력만 고르는 탐욕법을 썼습니다. 무작위 연계 1,000개를 모든 입력 조합과 비교하는 테스트가, 한 번의 회피로 두 타격을 덮는 경우를 탐욕법이 놓친다는 것을 찾아냈고, 동적 계획법으로 바꿨습니다.'],
    related: ['battle', 'brief', 'enhance'],
  },
  {
    id: 'brief', name: '브리핑', short: '브리핑', icon: 'solar:clipboard-check-linear', cat: '공유 · 회의',
    tagline: '모든 탭의 결론을 한 장으로 모아 회의에 가져갑니다',
    card: '기준 스냅샷 대비 변화, 지표별 목표 통과·미달, 메모와 PDF',
    desc: '강화·가챠·성장 표·스탯 전투·프레임 탭의 핵심 지표와 검증 문장을 한 장에 모읍니다. 스냅샷을 기준으로 고르면 무엇이 얼마나 바뀌었는지, 지표마다 목표를 넣으면 통과·미달을 보여 주고, 결론·근거·리스크·결정 요청 메모와 함께 PDF로 저장합니다.',
    facts: [['5개 탭', '핵심 지표와 검증 문장을 한 장에'], ['≤ · ≥', '지표마다 목표를 넣어 통과·미달 판정'], ['PDF', '입력칸 없이 값만 남는 인쇄 화면']],
    questions: ['지난 회의안 대비 무엇이 얼마나 바뀌었나요?', '목표를 통과하지 못한 지표는 무엇인가요?', '회의에서 무엇을 결정해야 하나요?'],
    features: [
      ['solar:camera-linear', '스냅샷', '헤더의 “스냅샷”에서 모든 탭 설정을 한 번에 저장하고, 나중에 지금 설정과 탭별 핵심 지표를 비교하거나 되돌립니다. 프로젝트 파일로 팀과 같은 설정을 나눕니다.', ['모든 탭 한 번에 저장', '지표 비교 · 되돌리기', '프로젝트 파일']],
      ['solar:target-linear', '목표 판정', '지표마다 ≤ 또는 ≥ 목표를 넣으면 통과·미달을 표시하고, 미달 목록을 요약에 모읍니다. 퍼센트 지표는 퍼센트 단위로 넣습니다.', ['≤ · ≥ 목표', '✓ 통과 / ✗ 미달', '미달 목록 요약']],
      ['solar:document-text-linear', '메모와 PDF', '결론·근거·리스크·결정 요청을 적고 “PDF로 저장(인쇄)”을 누르면, 입력칸과 헤더를 숨기고 값만 남긴 한 장짜리 문서가 됩니다. 비워 둔 메모는 나오지 않습니다.', ['결론 · 근거', '리스크 · 결정 요청', '인쇄용 화면']],
      ['solar:undo-left-round-linear', '되돌리기', '헤더의 ↶ ↷ 또는 Ctrl+Z · Ctrl+Shift+Z로 모든 탭에서 같은 방식으로 되돌립니다. 탭마다 최대 50단계입니다.', ['모든 탭 공통', '탭마다 50단계', 'Ctrl+Z · Ctrl+Shift+Z']],
    ],
    method: ['스냅샷 = 각 탭 저장 키의 묶음, 지표는 탭의 계산 모듈을 그대로 호출', '목표 판정: % 지표는 % 단위로 입력', '검증 문장: 심각한 것부터 탭마다 4개', 'PDF = 브라우저 인쇄 (인쇄용 CSS로 값만)'],
    verify: ['모든 탭의 기본 설정에서 핵심 지표가 계산됨', '스냅샷 저장 → 설정 변경 → 비교 → 되돌리기', '프로젝트 파일을 다른 브라우저로 옮겨도 같은 설정·스냅샷'],
    tests: 7,
    case: ['회의 직전 5분', '고치기 전에 스냅샷을 저장하고, 수치를 바꾼 뒤 브리핑 탭에서 그 스냅샷을 기준으로 고르면 바뀐 탭과 지표별 변화가 한 장에 모입니다. 목표를 넣고 결정 요청을 적어 PDF로 저장하면 회의 자료가 됩니다.'],
    related: ['enhance', 'battle', 'frame'],
  },
];
const byId = Object.fromEntries(TOOLS.map(t => [t.id, t]));

// ── 공통 조각 ────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const icon = (name, cls = '') => `<iconify-icon icon="${name}" class="${cls}" aria-hidden="true"></iconify-icon>`;
const LOGO = `<svg viewBox="0 0 32 32" class="h-7 w-7" aria-hidden="true"><defs><linearGradient id="wb-key" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2d3a8"/><stop offset=".5" stop-color="#d8a272"/><stop offset="1" stop-color="#9c5d2d"/></linearGradient></defs><rect width="32" height="32" rx="6" fill="url(#wb-key)"/><path d="M9 22l5-12 4 8 2-4 3 8" stroke="#1c130a" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function head(title, desc) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:type" content="website">
  <meta name="theme-color" content="#0b0b0a">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23d8a272'/><path d='M9 22l5-12 4 8 2-4 3 8' stroke='%231c130a' stroke-width='2.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>">
  <script src="https://cdn.tailwindcss.com/3.4.16"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
  <script src="https://code.iconify.design/iconify-icon/2.3.0/iconify-icon.min.js"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Pretendard', 'Geist', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
            display: ['Geist', 'Pretendard', 'system-ui', 'sans-serif'],
            mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
          },
          // 키 컬러 = 샌드 → 탄 → 브론즈 그라데이션(.bg-accent 채움은 아래 style에서 그라데이션으로). 무채색은 따뜻한 검정 계열로
          colors: {
            accent: { DEFAULT: '#d8a272', soft: '#f2d3a8', deep: '#9c5d2d' }, ink: '#1c130a', glow: '#f4e24a',
            zinc: { 50: '#f6f5f2', 100: '#edebe6', 200: '#dcd9d2', 300: '#c2beb5', 400: '#9c988f', 500: '#7a766e', 600: '#5a5751', 700: '#3f3d39', 800: '#292825', 900: '#1a1917', 950: '#0e0e0d' },
          },
          transitionTimingFunction: { spring: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        },
      },
    }
  </script>
  <style>
    html { scroll-behavior: smooth; }
    body { background: radial-gradient(1100px 600px at 100% -10%, rgba(216, 162, 114, 0.10), transparent 62%), radial-gradient(900px 520px at -10% 105%, rgba(181, 185, 140, 0.05), transparent 60%), #0b0b0a; background-attachment: fixed; color: #e9e7e1; -webkit-font-smoothing: antialiased; }
    /* 키 컬러 채움은 단색이 아니라 그라데이션 */
    .bg-accent, .group:hover .group-hover\:bg-accent { background-image: linear-gradient(90deg, #f2d3a8 0%, #d8a272 45%, #9c5d2d 100%); }
    .key-text { background: linear-gradient(90deg, #f2d3a8 0%, #d8a272 45%, #b06f39 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
    /* 레퍼런스의 진행 막대: 그라데이션 + 끝의 노란 글로우 점 */
    .key-meter { position: relative; height: 4px; border-radius: 2px; background: linear-gradient(90deg, #f2d3a8 0%, #d8a272 45%, #9c5d2d 100%); }
    .key-meter::after { content: ""; position: absolute; right: -5px; top: 50%; width: 11px; height: 11px; margin-top: -5.5px; border-radius: 50%; background: #fffbe0; box-shadow: 0 0 0 1px rgba(244, 226, 74, 0.6), 0 0 14px 3px rgba(244, 226, 74, 0.55); }
    .ko { word-break: keep-all; overflow-wrap: break-word; }
    /* 레퍼런스 구조: 알약·둥근 상자 대신 각진 모서리, 가는 숫자. 흐림 덩어리(.orb)는 그대로 둥글게 */
    [class*="rounded-"]:not(.orb) { border-radius: 2px !important; }
    .bezel { border-radius: 6px !important; } .bezel > .core { border-radius: 4px !important; } .frame-view { border-radius: 0 0 4px 4px !important; }
    .font-display { font-weight: 300; }
    /* 유리 패널: 카드·틀·내비 띠는 뒤를 흐린다 */
    .bezel, .bg-white\/\[0\.02\], .bg-white\/5, .bg-zinc-900\/60, .bg-zinc-900\/90, .bg-zinc-950\/60 { -webkit-backdrop-filter: blur(22px) saturate(1.3); backdrop-filter: blur(22px) saturate(1.3); box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }
    .bezel { background: rgba(255, 255, 255, 0.045); }
    .t-spring { transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
    .grain { position: fixed; inset: 0; z-index: 60; pointer-events: none; opacity: 0.035; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
    .orb { position: absolute; border-radius: 9999px; filter: blur(80px); pointer-events: none; animation: float 9s cubic-bezier(0.45, 0, 0.55, 1) infinite; }
    @keyframes float { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-18px) } }
    .reveal { opacity: 0; transform: translateY(2rem); filter: blur(4px); transition: opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1), transform 0.9s cubic-bezier(0.16, 1, 0.3, 1), filter 0.9s cubic-bezier(0.16, 1, 0.3, 1); transition-delay: calc(var(--i, 0) * 80ms); }
    .reveal.in { opacity: 1; transform: none; filter: none; }
    .bezel { background: rgba(255, 255, 255, 0.03); box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08); padding: 6px; border-radius: 2rem; }
    .bezel > .core { border-radius: calc(2rem - 6px); background: linear-gradient(180deg, #151413 0%, #0e0e0d 100%); box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.08); }
    .frame-view { position: relative; overflow: hidden; border-radius: 0 0 calc(2rem - 6px) calc(2rem - 6px); background: #121211; }
    .frame-view iframe { position: absolute; left: 0; top: 0; width: 1280px; height: 820px; border: 0; transform-origin: 0 0; }
    .marquee { display: flex; width: max-content; animation: marquee 38s linear infinite; }
    .marquee:hover { animation-play-state: paused; }
    @keyframes marquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }
    .nav-panel { opacity: 0; pointer-events: none; transition: opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
    .nav-panel.open { opacity: 1; pointer-events: auto; }
    .nav-panel a { opacity: 0; transform: translateY(2rem); transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1); transition-delay: calc(var(--i, 0) * 60ms); }
    .nav-panel.open a { opacity: 1; transform: none; }
    @media (prefers-reduced-motion: reduce) { .reveal, .reveal.in { opacity: 1; transform: none; filter: none; transition: none; } .orb, .marquee { animation: none; } }
  </style>
</head>`;
}

function nav(current) {
  const links = [['도구', 'index.html#tools'], ['비교', 'index.html#compare'], ['검증', 'index.html#proof'], ['사례', 'index.html#cases']];
  return `<div class="grain" aria-hidden="true"></div>
<header class="fixed inset-x-0 top-0 z-40 px-4">
  <nav class="mx-auto mt-4 flex w-full max-w-5xl items-center justify-between gap-3 rounded-full border border-white/10 bg-zinc-900/60 py-2 pl-4 pr-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl" aria-label="주요 메뉴">
    <a href="index.html" class="flex items-center gap-2.5 text-sm font-semibold text-zinc-100">${LOGO}<span>기획 워크벤치</span></a>
    <div class="hidden items-center gap-1 md:flex">
      ${links.map(([l, h]) => `<a href="${h}" class="t-spring rounded-full px-4 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-100">${l}</a>`).join('\n      ')}
    </div>
    <div class="flex items-center gap-2">
      <a href="${APP}${current ? `#${current}` : '#enhance'}" class="t-spring group hidden items-center gap-2 rounded-full bg-accent py-2 pl-4 pr-2 text-sm font-semibold text-ink hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 sm:flex">${current ? '이 도구 열기' : '워크벤치 열기'}<span class="t-spring flex h-7 w-7 items-center justify-center rounded-full bg-black/10 group-hover:translate-x-0.5">${icon('solar:arrow-right-linear', 'text-base')}</span></a>
      <button type="button" class="nav-toggle flex h-10 w-10 items-center justify-center rounded-full text-zinc-300 hover:bg-white/5 md:hidden" aria-label="메뉴 열기" aria-expanded="false">${icon('solar:hamburger-menu-linear', 'text-2xl')}</button>
    </div>
  </nav>
</header>
<div class="nav-panel fixed inset-0 z-50 flex flex-col bg-zinc-950/80 px-6 pt-24 backdrop-blur-3xl md:hidden" role="dialog" aria-label="메뉴">
  <button type="button" class="nav-close absolute right-5 top-6 flex h-11 w-11 items-center justify-center rounded-full text-zinc-300 hover:bg-white/5" aria-label="메뉴 닫기">${icon('solar:close-circle-linear', 'text-3xl')}</button>
  ${[...links, ['워크벤치 열기', `${APP}${current ? `#${current}` : '#enhance'}`]].map(([l, h], i) => `<a href="${h}" style="--i:${i}" class="border-b border-white/5 py-5 text-2xl font-semibold text-zinc-100">${l}</a>`).join('\n  ')}
</div>`;
}

// 오픈소스 고지(Kalivra): 모든 랜딩 페이지 푸터 맨 아래. 본문 index.html 푸터와 같은 문구
const OSS_NOTICE = `  <div class="mx-auto max-w-7xl border-t border-white/5 px-4 py-8 sm:px-6 lg:px-8">
    <p class="text-sm font-semibold text-zinc-300">📌 오픈소스 고지</p>
    <div class="ko mt-3 space-y-2 text-xs leading-relaxed text-zinc-500">
      <p>이 프로그램의 턴제 전투 시뮬레이션 기능은 Bawky님의 오픈소스 게임 밸런스 툴 「Kalivra」의 코드를 기반으로 수정·개발되었습니다.<br>그 외 기능은 직접 제작했습니다.</p>
      <p>원본: <a href="https://github.com/DevBawky/Kalivra" class="underline underline-offset-2 hover:text-zinc-300" target="_blank" rel="noopener">https://github.com/DevBawky/Kalivra</a><br>Copyright (c) 2025 Bawky<br>라이선스: Kalivra License (MIT 기반, 소프트웨어 판매 금지 조건 포함)</p>
      <p>원본 코드의 저작권은 원작자에게 있으며, 본 프로그램은 원작자와 공식적인 관련이 없습니다.<br>본 프로그램은 무료로 배포되며 판매하지 않습니다.</p>
    </div>
  </div>`;

function footer() {
  return `<footer class="border-t border-white/5">
  <div class="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-14 sm:px-6 md:flex-row md:items-end md:justify-between lg:px-8">
    <div class="max-w-md">
      <a href="index.html" class="flex items-center gap-2.5 text-sm font-semibold text-zinc-100">${LOGO}<span>기획 워크벤치</span></a>
      <p class="ko mt-4 text-sm leading-relaxed text-zinc-500">게임 시스템·BM 기획자가 엑셀로 풀기 어려운 검증을 브라우저에서 바로 돌려 보는 도구 모음입니다. 8개 도구의 계산은 브라우저 안에서만 실행됩니다(다이어그램 부가 도구만 직접 넣은 API 키로 Claude API를 부릅니다). 템플릿 수치는 설계 예시이며 특정 게임의 실제 수치가 아닙니다.</p>
    </div>
    <div class="flex flex-wrap gap-x-6 gap-y-3 text-sm text-zinc-400">
      <a href="${APP}#enhance" class="t-spring hover:text-zinc-100">워크벤치 열기</a>
      <a href="index.html#tools" class="t-spring hover:text-zinc-100">도구 목록</a>
      <a href="${REPO}" class="t-spring hover:text-zinc-100" rel="noopener">GitHub 저장소</a>
      <a href="${REPO}/blob/main/docs/case-study.md" class="t-spring hover:text-zinc-100" rel="noopener">기획 판단 사례</a>
    </div>
  </div>
${OSS_NOTICE}
</footer>`;
}

const SCRIPT = `<script>
  // 화면에 들어올 때 나타나기 (스크롤 이벤트 대신 IntersectionObserver)
  const io = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  // 숫자 올라가기
  const fmt = new Intl.NumberFormat('ko-KR');
  const co = new IntersectionObserver((es) => es.forEach(e => {
    if (!e.isIntersecting) return;
    const el = e.target, to = +el.dataset.count, t0 = performance.now();
    const step = (t) => { const p = Math.min(1, (t - t0) / 1200), k = 1 - Math.pow(1 - p, 3); el.textContent = fmt.format(Math.round(to * k)); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step); co.unobserve(el);
  }), { threshold: 0.6 });
  document.querySelectorAll('[data-count]').forEach(el => co.observe(el));
  // 실제 도구 미리보기: 1280px 화면을 칸 너비에 맞춰 줄임
  document.querySelectorAll('.frame-view').forEach(box => {
    const f = box.querySelector('iframe');
    new ResizeObserver(() => { const s = box.clientWidth / 1280; f.style.transform = 'scale(' + s + ')'; box.style.height = Math.round(820 * s) + 'px'; }).observe(box);
  });
  // 모바일 메뉴
  const panel = document.querySelector('.nav-panel'), tog = document.querySelector('.nav-toggle');
  const setMenu = (open) => { panel.classList.toggle('open', open); tog.setAttribute('aria-expanded', String(open)); document.body.style.overflow = open ? 'hidden' : ''; };
  tog.addEventListener('click', () => setMenu(true));
  panel.querySelector('.nav-close').addEventListener('click', () => setMenu(false));
  panel.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
</script>`;

const eyebrow = (text) => `<span class="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.15em] text-accent">${text}</span>`;
const cta = (href, label, primary = true) => primary
  ? `<a href="${href}" class="t-spring group inline-flex min-h-[52px] items-center gap-3 rounded-full bg-accent py-2 pl-7 pr-2 text-base font-semibold text-ink hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(216,162,114,0.28)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 md:text-lg">${label}<span class="t-spring flex h-9 w-9 items-center justify-center rounded-full bg-black/10 group-hover:translate-x-1">${icon('solar:arrow-right-linear', 'text-lg')}</span></a>`
  : `<a href="${href}" class="t-spring group inline-flex min-h-[52px] items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] py-2 pl-7 pr-2 text-base font-medium text-zinc-200 hover:scale-[1.02] hover:bg-white/[0.06] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 md:text-lg">${label}<span class="t-spring flex h-9 w-9 items-center justify-center rounded-full bg-white/5 group-hover:translate-x-1">${icon('solar:arrow-right-linear', 'text-lg')}</span></a>`;

function preview(hash, { interactive, label }) {
  return `<div class="bezel">
    <div class="core overflow-hidden">
      <div class="flex items-center gap-3 border-b border-white/5 px-5 py-3">
        <span class="flex gap-1.5" aria-hidden="true"><i class="h-2.5 w-2.5 rounded-full bg-zinc-700"></i><i class="h-2.5 w-2.5 rounded-full bg-zinc-700"></i><i class="h-2.5 w-2.5 rounded-full bg-zinc-700"></i></span>
        <span class="truncate font-mono text-xs text-zinc-500">기획 워크벤치 / #${hash}</span>
        <span class="ml-auto hidden items-center gap-1.5 text-xs text-zinc-500 sm:flex">${icon('solar:play-circle-linear', 'text-sm text-accent')}${interactive ? '직접 조작할 수 있는 실제 도구' : '실제 도구 화면'}</span>
      </div>
      <div class="frame-view" style="height:420px">
        <iframe src="${APP}#${hash}" title="${esc(label)}" loading="lazy" ${interactive ? '' : 'tabindex="-1" style="pointer-events:none"'}></iframe>
      </div>
    </div>
  </div>`;
}

// ── 랜딩 ─────────────────────────────────────────────────
function landing() {
  const tests = TESTS;
  const bentoSpan = { enhance: 'lg:col-span-7 lg:row-span-2', gacha: 'lg:col-span-5', growth: 'lg:col-span-5', combat: 'lg:col-span-7 lg:row-span-2', battle: 'lg:col-span-5', data: 'lg:col-span-5', frame: 'lg:col-span-6', brief: 'lg:col-span-6' };
  const toolCard = (t, i) => {
    const big = bentoSpan[t.id].includes('row-span-2');
    return `<a href="${t.id}.html" style="--i:${i % 4}" class="reveal t-spring bezel group block ${bentoSpan[t.id]} hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
        <div class="core flex h-full flex-col p-7 md:p-8">
          <div class="flex items-start justify-between gap-4">
            <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent ring-1 ring-accent/20">${icon(t.icon, 'text-2xl')}</span>
            <span class="text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-500">${t.cat}</span>
          </div>
          <h3 class="ko mt-6 text-xl font-semibold leading-snug text-zinc-50 md:text-2xl">${t.name}</h3>
          <p class="ko mt-3 max-w-[48ch] text-sm leading-relaxed text-zinc-400 md:text-base">${t.card}</p>
          ${big ? `<ul class="mt-8 hidden gap-2.5 md:grid">${t.questions.slice(0, 3).map(q => `<li class="ko flex items-start gap-3 text-sm leading-relaxed text-zinc-300">${icon('solar:arrow-right-linear', 'mt-1 flex-none text-accent')}${q}</li>`).join('')}</ul>` : ''}
          <div class="mt-auto pt-8">
            <div class="flex items-end justify-between gap-4 border-t border-white/5 pt-5">
              <div>
                <p class="font-display text-${big ? '4xl md:text-5xl' : '3xl'} font-semibold tracking-tight text-zinc-50">${t.facts[0][0]}</p>
                <p class="ko mt-1 text-xs leading-relaxed text-zinc-500 md:text-sm">${t.facts[0][1]}</p>
              </div>
              <span class="t-spring flex h-10 w-10 flex-none items-center justify-center rounded-full bg-white/5 text-zinc-300 group-hover:translate-x-1 group-hover:bg-accent group-hover:text-ink">${icon('solar:arrow-right-linear', 'text-lg')}</span>
            </div>
            ${big ? `<ul class="mt-5 grid gap-2 text-sm text-zinc-400 sm:grid-cols-2">${t.facts.slice(1).map(([v, l]) => `<li class="ko rounded-2xl bg-white/[0.03] p-4"><span class="block font-display text-lg font-semibold text-zinc-200">${v}</span>${l}</li>`).join('')}</ul>` : ''}
          </div>
        </div>
      </a>`;
  };
  const compare = [
    ['가챠 · 레전드 4종 풀 초월', '필요 장수 ÷ 확률 = 120,000회', '205,056회 — 소환 레벨 ×1.47, 중복 ×1.16', 'gacha'],
    ['강화 · 보조 아이템 가격', '아이템 효과만 곱해 “조금 싸진다”', '최적 정책이면 −52.8% — 아이템이 너무 쌈', 'enhance'],
    ['전투 · 공격 속도 4배 캐릭터', '턴 교대: 승률 80% (선공 확률뿐)', '시간 기반: 100% — 같은 시간에 4배 공격', 'battle'],
    ['파티 · 5인 파티 대 화염 골렘', '턴제로만 계산: 승률 31.7%', '실시간: 88.3% — 속도가 곧 행동 횟수', 'combat'],
  ];
  const cases = [byId.gacha, byId.enhance, byId.battle];
  const roles = [
    ['solar:widget-5-linear', '시스템 기획자', '레벨 곡선과 콘텐츠 공급으로 세그먼트마다 언제 몇 레벨인지, 강화 확률을 바꾸면 기대 비용과 파괴 위험이 어떻게 달라지는지 보고, 결과를 엑셀·회의 자료로 가져갑니다.', ['growth', 'enhance', 'brief']],
    ['solar:cart-large-2-linear', 'BM 기획자', '가챠 목표의 실제 비용과 운 나쁜 1%, 천장·마일리지 효과, 보조 아이템 가격과 기대 매출, 확률 공시표를 확인합니다.', ['gacha', 'enhance']],
    ['solar:gamepad-linear', '전투·레벨 기획자', 'CP가 실제 승률을 반영하는지, 전투 데이터 시트의 참조가 깨지지 않았는지, 파티가 보스를 몇 %로 잡고 누가 빠지면 못 잡는지, 보스 연계를 보고 피할 수 있는지를 숫자로 판정합니다.', ['combat', 'battle', 'data', 'frame']],
  ];
  const verify = [
    ['Kalivra 엔진과 대조', 'Kalivra v1.0.1 전투 엔진을 그대로 돌린 40만~140만 회 결과와, 같은 규칙의 공식 계산이 3σ 안에서 일치합니다.', 'battle'],
    ['독립 규칙 시뮬레이터', '강화 체인과 따로 게임 규칙을 그대로 구현한 시뮬레이터, 밀집 행렬 풀이(오차 1e-8)와 비교합니다.', 'enhance'],
    ['브루트포스 대조', '프레임 판정의 최적 입력 계획을 무작위 연계 1,000개의 모든 입력 조합과 비교합니다.', 'frame'],
    ['해석해 대조', '쿠폰 수집 n·Hₙ/p, 음이항 평균, 절단 기하분포 같은 알려진 답과 오차 1e-6 안에서 맞춥니다.', 'gacha'],
  ];
  return `${head('기획 워크벤치 — 게임 시스템·BM 밸런스 검증 도구', '강화 확률, 가챠 천장, 성장 표, 전투 승률, 파티 전투 시뮬레이션, 보스 패턴 프레임까지. 기획서 숫자를 넣으면 기대값과 분포, 문제 구간을 바로 보여 주는 브라우저 도구 모음입니다.')}
<body class="font-sans">
${nav(null)}
<main>
  <!-- 히어로: 왼쪽 문장, 오른쪽 실제 도구 화면 -->
  <section class="relative min-h-[100dvh] overflow-hidden pt-32 md:pt-40">
    <div class="orb left-[-10%] top-[8%] h-[420px] w-[420px] bg-accent/15" aria-hidden="true"></div>
    <div class="orb right-[-8%] top-[40%] h-[520px] w-[520px] bg-zinc-500/10" style="animation-delay:-4s" aria-hidden="true"></div>
    <div class="relative mx-auto grid max-w-7xl items-center gap-14 px-4 pb-24 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:px-8">
      <div class="reveal">
        ${eyebrow(`${icon('solar:cpu-bolt-linear', 'text-sm')}게임 시스템 · BM 기획`)}
        <h1 class="ko mt-7 text-4xl font-bold leading-tight tracking-tight text-zinc-50 md:text-6xl lg:text-[4.25rem] lg:leading-[1.12]">엑셀로 못 푸는<br>밸런스 계산을<br><span class="key-text">링크 하나</span>로 확인합니다</h1>
        <p class="ko mt-7 max-w-[54ch] text-base leading-relaxed text-zinc-400 md:text-lg">강화 확률, 가챠 천장, 성장 표, 전투 승률, 파티 전투 시뮬레이션, 보스 패턴 프레임까지. 기획서 숫자를 넣으면 기대값과 분포, 문제가 생기는 구간과 그 원인을 바로 보여 줍니다. 설치·로그인 없이 열리고, 넣은 숫자는 서버로 가지 않습니다.</p>
        <div class="key-meter mt-9 max-w-md" aria-hidden="true"></div>
        <div class="mt-10 flex flex-wrap gap-3">
          ${cta(`${APP}#enhance`, '워크벤치 열기')}
          ${cta('#tools', '도구 둘러보기', false)}
        </div>
        <ul class="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-500">
          <li class="flex items-center gap-2">${icon('solar:check-circle-linear', 'text-accent')}브라우저 안에서만 계산</li>
          <li class="flex items-center gap-2">${icon('solar:check-circle-linear', 'text-accent')}공식 계산 + 시뮬레이션 비교</li>
          <li class="flex items-center gap-2">${icon('solar:check-circle-linear', 'text-accent')}자동 테스트 ${tests}개</li>
        </ul>
      </div>
      <div class="reveal relative" style="--i:2">
        <div class="hidden md:block">${preview('battle', { interactive: false, label: '스탯·전투 밸런스 도구 화면' })}</div>
        <div class="bezel md:hidden"><div class="core overflow-hidden"><img src="../docs/screenshot.png" alt="강화 확률·비용 설계 도구 화면: 기대 총비용, 단계별 확률 표, 비용 분포" class="w-full" decoding="async"></div></div>
        <div class="absolute -bottom-6 -left-4 hidden rounded-2xl border border-white/10 bg-zinc-900/90 px-5 py-4 shadow-[0_20px_60px_-20px_rgba(216,162,114,0.3)] md:block" style="animation: float 7s cubic-bezier(0.45,0,0.55,1) infinite">
          <p class="text-xs text-zinc-500">CP 2위 궁수 → 전사</p>
          <p class="font-display text-2xl font-light text-zinc-50">승률 24.8%</p>
        </div>
      </div>
    </div>
  </section>

  <!-- 숫자 띠 -->
  <section class="border-y border-white/5 bg-zinc-950/60">
    <div class="mx-auto grid max-w-7xl grid-cols-2 gap-y-10 px-4 py-14 sm:px-6 md:grid-cols-4 lg:px-8">
      <div class="reveal"><p class="font-display text-4xl font-light tracking-tight text-zinc-50 md:text-5xl" data-count="8">8</p><p class="ko mt-2 text-sm text-zinc-500">기획 도구 (다이어그램·PDF 부가 도구 별도)</p></div>
      <div class="reveal" style="--i:1"><p class="font-display text-4xl font-light tracking-tight text-zinc-50 md:text-5xl" data-count="${tests}">${tests}</p><p class="ko mt-2 text-sm text-zinc-500">계산 모듈 자동 테스트</p></div>
      <div class="reveal" style="--i:2"><p class="font-display text-4xl font-light tracking-tight text-zinc-50 md:text-5xl" data-count="1400000">1,400,000</p><p class="ko mt-2 text-sm text-zinc-500">Kalivra 엔진 대조에 쓴 전투 횟수</p></div>
      <div class="reveal" style="--i:3"><p class="font-display text-4xl font-light tracking-tight text-zinc-50 md:text-5xl">0<span class="text-zinc-500">B</span></p><p class="ko mt-2 text-sm text-zinc-500">8개 도구가 서버로 보내는 데이터</p></div>
    </div>
  </section>

  <!-- 누가 쓰나: 세 장이 살짝 겹친 카드 -->
  <section class="py-24 md:py-32 lg:py-40">
    <div class="mx-auto grid max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
      <div class="reveal lg:sticky lg:top-32 lg:self-start">
        ${eyebrow('누가 쓰나요')}
        <h2 class="ko mt-6 text-3xl font-bold leading-snug tracking-tight text-zinc-50 md:text-5xl">기획서의 숫자가<br>맞는지 확인해야 하는 사람</h2>
        <p class="ko mt-6 max-w-[46ch] text-base leading-relaxed text-zinc-400 md:text-lg">“필요 장수 ÷ 확률”, “평균 유저 한 명”, “CP 합계”처럼 엑셀에서 흔히 쓰는 계산이 어디서 빗나가는지, 같은 화면에서 원인까지 보여 줍니다.</p>
      </div>
      <div class="grid gap-5">
        ${roles.map(([ic, title, body, ids], i) => `<div class="reveal bezel ${['md:-rotate-1', 'md:translate-x-8 md:rotate-[0.6deg]', 'md:-rotate-[0.4deg]'][i]}" style="--i:${i}">
          <div class="core p-7 md:p-9">
            <div class="flex items-center gap-4"><span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-zinc-200 ring-1 ring-white/10">${icon(ic, 'text-2xl')}</span><h3 class="text-xl font-semibold text-zinc-50 md:text-2xl">${title}</h3></div>
            <p class="ko mt-5 max-w-[56ch] text-base leading-relaxed text-zinc-400">${body}</p>
            <div class="mt-6 flex flex-wrap gap-2">${ids.map(id => `<a href="${id}.html" class="t-spring inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-1.5 text-sm text-zinc-300 hover:border-accent/40 hover:text-accent">${icon(byId[id].icon, 'text-base')}${byId[id].short}</a>`).join('')}</div>
          </div>
        </div>`).join('\n        ')}
      </div>
    </div>
  </section>

  <!-- 도구: 비대칭 벤토 -->
  <section id="tools" class="scroll-mt-28 py-24 md:py-32 lg:py-40">
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="reveal flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          ${eyebrow('도구')}
          <h2 class="ko mt-6 text-3xl font-bold leading-snug tracking-tight text-zinc-50 md:text-5xl">기획 도구 여덟 가지</h2>
        </div>
        <p class="ko max-w-[44ch] text-base leading-relaxed text-zinc-400">카드의 숫자는 각 도구의 템플릿을 실제로 돌린 결과입니다. 누르면 계산 방법과 검증, 실제 화면을 볼 수 있습니다.</p>
      </div>
      <div class="mt-14 grid grid-flow-dense grid-cols-1 gap-4 lg:grid-cols-12">
        ${TOOLS.map(toolCard).join('\n        ')}
      </div>
    </div>
  </section>

  <!-- 단순 계산 vs 워크벤치 -->
  <section id="compare" class="scroll-mt-28 border-y border-white/5 bg-zinc-950/70 py-24 md:py-32 lg:py-40">
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="reveal max-w-3xl">
        ${eyebrow('비교')}
        <h2 class="ko mt-6 text-3xl font-bold leading-snug tracking-tight text-zinc-50 md:text-5xl">같은 숫자, 다른 결론</h2>
        <p class="ko mt-6 max-w-[60ch] text-base leading-relaxed text-zinc-400 md:text-lg">왼쪽은 기획서에서 흔히 쓰는 계산, 오른쪽은 같은 템플릿을 워크벤치로 돌린 결과입니다.</p>
      </div>
      <div class="mt-14 overflow-hidden rounded-[2rem] ring-1 ring-white/10">
        <div class="hidden grid-cols-[1.1fr_1fr_1.3fr] gap-px bg-white/5 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-500 md:grid">
          <div class="bg-zinc-950 px-7 py-4">상황</div><div class="bg-zinc-950 px-7 py-4">흔한 계산</div><div class="bg-zinc-950 px-7 py-4 text-accent">워크벤치</div>
        </div>
        ${compare.map(([what, naive, wb, id], i) => `<a href="${id}.html" class="reveal t-spring group grid grid-cols-1 gap-px border-t border-white/5 bg-white/5 md:grid-cols-[1.1fr_1fr_1.3fr]" style="--i:${i}">
          <div class="ko flex items-center gap-3 bg-zinc-950 px-7 py-6 text-base font-semibold text-zinc-100 group-hover:bg-zinc-900">${icon(byId[id].icon, 'text-xl text-zinc-500')}${what}</div>
          <div class="ko bg-zinc-950 px-7 py-6 text-base text-zinc-500 group-hover:bg-zinc-900"><span class="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-600 no-underline md:hidden">흔한 계산</span><span class="line-through decoration-zinc-700">${naive}</span></div>
          <div class="ko flex items-center justify-between gap-4 bg-zinc-950 px-7 py-6 text-base font-medium text-zinc-100 group-hover:bg-zinc-900"><span><span class="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.15em] text-accent md:hidden">워크벤치</span>${wb}</span>${icon('solar:arrow-right-up-linear', 't-spring text-xl text-zinc-600 group-hover:text-accent')}</div>
        </a>`).join('\n        ')}
      </div>
    </div>
  </section>

  <!-- 검증: 왼쪽 큰 문장, 오른쪽 목록 -->
  <section id="proof" class="scroll-mt-28 py-24 md:py-32 lg:py-40">
    <div class="mx-auto grid max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
      <div class="reveal">
        ${eyebrow('검증')}
        <h2 class="ko mt-6 text-3xl font-bold leading-snug tracking-tight text-zinc-50 md:text-5xl">계산이 맞다는 근거를<br>함께 둡니다</h2>
        <p class="ko mt-6 max-w-[48ch] text-base leading-relaxed text-zinc-400 md:text-lg">공식으로 풀 수 있는 곳은 공식으로 풀고, 같은 규칙의 시뮬레이션과 화면에서 바로 비교합니다. 계산 모듈은 화면과 분리해 자동 테스트 ${tests}개로 확인합니다.</p>
        <div class="mt-10 bezel max-w-md"><div class="core p-7">
          <p class="text-sm text-zinc-500">턴 교대 공식 계산 vs Kalivra 엔진 140만 회</p>
          <div class="mt-4 grid grid-cols-2 gap-4">
            <div><p class="font-display text-3xl font-light text-zinc-50">0.72643</p><p class="mt-1 text-xs text-zinc-500">공식 계산</p></div>
            <div><p class="font-display text-3xl font-light text-zinc-400">0.72676</p><p class="mt-1 text-xs text-zinc-500">엔진 실행 결과</p></div>
          </div>
          <p class="ko mt-5 flex items-center gap-2 text-sm text-accent">${icon('solar:shield-check-linear')}차이가 표준오차 안 (z ≈ −0.9)</p>
        </div></div>
      </div>
      <ol class="grid gap-4">
        ${verify.map(([t, b, id], i) => `<li class="reveal" style="--i:${i}"><a href="${id}.html" class="t-spring group flex gap-5 rounded-[1.75rem] border border-white/5 bg-white/[0.02] p-6 hover:border-white/10 hover:bg-white/[0.04] md:p-7">
          <span class="font-mono text-sm text-zinc-600">0${i + 1}</span>
          <div><h3 class="text-lg font-semibold text-zinc-100">${t}</h3><p class="ko mt-2 text-sm leading-relaxed text-zinc-400 md:text-base">${b}</p><span class="mt-3 inline-flex items-center gap-1.5 text-sm text-zinc-500 group-hover:text-accent">${byId[id].name}${icon('solar:arrow-right-linear', 't-spring group-hover:translate-x-1')}</span></div>
        </a></li>`).join('\n        ')}
      </ol>
    </div>
  </section>

  <!-- 사례: 높이가 다른 카드 -->
  <section id="cases" class="scroll-mt-28 border-t border-white/5 py-24 md:py-32 lg:py-40">
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="reveal flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>${eyebrow('기획 판단 사례')}<h2 class="ko mt-6 text-3xl font-bold leading-snug tracking-tight text-zinc-50 md:text-5xl">계산 결과로 무엇을 정했나</h2></div>
        <a href="${REPO}/blob/main/docs/case-study.md" class="t-spring inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-accent" rel="noopener">사례 전문 보기${icon('solar:arrow-right-up-linear')}</a>
      </div>
      <div class="mt-14 columns-1 gap-4 md:columns-2 lg:columns-3">
        ${cases.map((t, i) => `<article class="reveal bezel mb-4 break-inside-avoid" style="--i:${i}"><div class="core p-7 md:p-8">
          <span class="flex items-center gap-2 text-xs text-zinc-500">${icon(t.icon, 'text-base text-accent')}${t.name}</span>
          <h3 class="ko mt-5 text-xl font-semibold leading-snug text-zinc-50">${t.case[0]}</h3>
          <p class="ko mt-4 text-base leading-relaxed text-zinc-400">${t.case[1]}</p>
          <a href="${t.id}.html" class="t-spring mt-6 inline-flex items-center gap-1.5 text-sm text-zinc-300 hover:text-accent">도구 자세히 보기${icon('solar:arrow-right-linear')}</a>
        </div></article>`).join('\n        ')}
      </div>
    </div>
  </section>

  <!-- 작업 흐름: 가로 띠 -->
  <section class="overflow-hidden border-y border-white/5 bg-zinc-950/70 py-16">
    <div class="marquee gap-4" aria-label="작업 흐름">
      ${[0, 1].map(k => [['solar:camera-linear', '스냅샷으로 지금 설정 저장'], ['solar:ruler-pen-linear', '수치 한 칸 바꾸기'], ['solar:undo-left-round-linear', 'Ctrl+Z로 되돌리기'], ['solar:clipboard-check-linear', '브리핑에서 목표 통과·미달'], ['solar:document-text-linear', 'PDF로 회의 자료'], ['solar:scale-linear', '프리셋 A/B를 같은 시드로 비교'], ['solar:database-linear', '엑셀 CSV를 데이터 테이블로'], ['solar:code-square-linear', 'Unity·Unreal로 내보내기'], ['solar:link-round-linear', '공유 링크 한 줄']].map(([ic, l]) => `<span class="flex flex-none items-center gap-3 rounded-full border border-white/10 bg-white/[0.02] px-6 py-3 text-base text-zinc-300"${k ? ' aria-hidden="true"' : ''}>${icon(ic, 'text-xl text-accent')}${l}</span>`).join('')).join('')}
    </div>
  </section>

  <!-- 마무리 CTA -->
  <section class="relative overflow-hidden py-28 md:py-40">
    <div class="orb left-1/2 top-1/2 h-[480px] w-[720px] -translate-x-1/2 -translate-y-1/2 bg-accent/10" aria-hidden="true"></div>
    <div class="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="reveal max-w-4xl">
        <h2 class="ko text-4xl font-bold leading-tight tracking-tight text-zinc-50 md:text-6xl">기획서 숫자 하나를<br>넣어 보세요</h2>
        <p class="ko mt-6 max-w-[52ch] text-base leading-relaxed text-zinc-400 md:text-lg">템플릿으로 바로 시작하고, 내 수치로 바꾼 뒤 공유 링크나 PDF로 팀에 보낼 수 있습니다.</p>
        <div class="mt-10 flex flex-wrap gap-3">${cta(`${APP}#enhance`, '지금 바로 열기')}${cta(REPO, 'GitHub에서 코드 보기', false)}</div>
      </div>
    </div>
  </section>
</main>
${footer()}
${SCRIPT}
</body>
</html>
`;
}

// ── 세부 페이지 ──────────────────────────────────────────
function detail(t) {
  const idx = TOOLS.indexOf(t);
  const prev = TOOLS[(idx + TOOLS.length - 1) % TOOLS.length], next = TOOLS[(idx + 1) % TOOLS.length];
  return `${head(`${t.name} — 기획 워크벤치`, `${t.tagline}. ${t.desc}`)}
<body class="font-sans">
${nav(t.id)}
<main>
  <!-- 히어로: 왼쪽 설명, 오른쪽 템플릿 결과 -->
  <section class="relative overflow-hidden pb-20 pt-32 md:pb-28 md:pt-40">
    <div class="orb right-[-10%] top-[10%] h-[460px] w-[460px] bg-accent/12" aria-hidden="true"></div>
    <div class="relative mx-auto grid max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-[1.25fr_1fr] lg:items-end lg:px-8">
      <div class="reveal">
        <a href="index.html#tools" class="t-spring inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200">${icon('solar:arrow-left-linear')}도구 목록</a>
        <div class="mt-6">${eyebrow(`${icon(t.icon, 'text-sm')}${t.cat}`)}</div>
        <p class="mt-6 text-lg font-semibold text-zinc-300">${t.name}</p>
        <h1 class="ko mt-3 text-4xl font-bold leading-tight tracking-tight text-zinc-50 md:text-5xl lg:text-6xl">${t.tagline}</h1>
        <p class="ko mt-7 max-w-[62ch] text-base leading-relaxed text-zinc-400 md:text-lg">${t.desc}</p>
        <div class="mt-10 flex flex-wrap gap-3">${cta(`${APP}#${t.id}`, '이 도구 열기')}${cta('#preview', '화면 먼저 보기', false)}</div>
      </div>
      <div class="reveal bezel" style="--i:2">
        <div class="core p-7 md:p-8">
          <p class="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.15em] text-zinc-500">${icon('solar:play-circle-linear', 'text-sm text-accent')}템플릿을 돌린 결과</p>
          <dl class="mt-6 divide-y divide-white/5">
            ${t.facts.map(([v, l]) => `<div class="py-5 first:pt-0 last:pb-0"><dt class="font-display text-3xl font-light tracking-tight text-zinc-50 md:text-4xl">${v}</dt><dd class="ko mt-1.5 text-sm leading-relaxed text-zinc-400">${l}</dd></div>`).join('\n            ')}
          </dl>
        </div>
      </div>
    </div>
  </section>

  <!-- 이런 질문에 답합니다: 번호 목록 -->
  <section class="border-y border-white/5 bg-zinc-950/70 py-24 md:py-32">
    <div class="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:px-8">
      <div class="reveal">${eyebrow('질문')}<h2 class="ko mt-6 text-3xl font-bold leading-snug tracking-tight text-zinc-50 md:text-4xl">이런 질문에<br>답합니다</h2></div>
      <ol class="divide-y divide-white/5">
        ${t.questions.map((q, i) => `<li class="reveal flex gap-6 py-7 first:pt-0" style="--i:${i}"><span class="font-display text-2xl font-light text-zinc-700 md:text-3xl">0${i + 1}</span><p class="ko text-lg font-medium leading-snug text-zinc-100 md:text-2xl">${q}</p></li>`).join('\n        ')}
      </ol>
    </div>
  </section>

  <!-- 실제 도구 -->
  <section id="preview" class="scroll-mt-28 py-24 md:py-32">
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="reveal flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>${eyebrow('실제 화면')}<h2 class="ko mt-6 text-3xl font-bold leading-snug tracking-tight text-zinc-50 md:text-4xl">설명 대신 직접 만져 보세요</h2></div>
        <p class="ko max-w-[46ch] text-sm leading-relaxed text-zinc-500">아래는 캡처가 아니라 실제 도구입니다. 여기서 바꾼 값은 이 브라우저에 저장되고, 앱의 ↶ 버튼으로 되돌릴 수 있습니다.</p>
      </div>
      <div class="reveal mt-12 hidden md:block">${preview(t.id, { interactive: true, label: `${t.name} 도구` })}</div>
      <div class="reveal mt-10 md:hidden"><div class="bezel"><div class="core p-7">
        <p class="ko text-base leading-relaxed text-zinc-300">작은 화면에서는 도구를 바로 여는 편이 보기 좋습니다.</p>
        <div class="mt-6">${cta(`${APP}#${t.id}`, '도구 열기')}</div>
      </div></div></div>
    </div>
  </section>

  <!-- 기능: 좌우가 번갈아 -->
  <section class="py-12 md:py-20">
    <div class="mx-auto grid max-w-7xl gap-20 px-4 sm:px-6 md:gap-28 lg:px-8">
      ${t.features.map(([ic, title, body, lines], i) => `<div class="grid items-center gap-10 md:grid-cols-2 md:gap-16">
        <div class="reveal ${i % 2 ? 'md:order-2' : ''}">
          <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent ring-1 ring-accent/20">${icon(ic, 'text-2xl')}</span>
          <h3 class="ko mt-6 text-2xl font-bold leading-snug tracking-tight text-zinc-50 md:text-3xl">${title}</h3>
          <p class="ko mt-5 max-w-[56ch] text-base leading-relaxed text-zinc-400 md:text-lg">${body}</p>
        </div>
        <div class="reveal ${i % 2 ? 'md:order-1' : ''}" style="--i:1">
          <div class="bezel ${i % 2 ? 'md:rotate-[0.6deg]' : 'md:-rotate-[0.6deg]'}"><div class="core relative overflow-hidden p-7 md:p-9">
            <div class="orb right-[-30%] top-[-40%] h-56 w-56 bg-accent/10" aria-hidden="true"></div>
            <ul class="relative grid gap-3">
              ${lines.map((l, k) => `<li class="flex items-center gap-4 rounded-2xl border border-white/5 bg-black/20 px-5 py-4"><span class="font-mono text-xs text-zinc-600">${String(k + 1).padStart(2, '0')}</span><span class="ko text-sm font-medium tabular-nums text-zinc-200 md:text-base">${l}</span></li>`).join('\n              ')}
            </ul>
          </div></div>
        </div>
      </div>`).join('\n      ')}
    </div>
  </section>

  <!-- 계산 방법 · 검증: 크기가 다른 두 칸 -->
  <section class="py-24 md:py-32">
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="reveal">${eyebrow('계산과 검증')}<h2 class="ko mt-6 text-3xl font-bold leading-snug tracking-tight text-zinc-50 md:text-4xl">어떻게 계산하고, 어떻게 확인했나</h2></div>
      <div class="mt-12 grid gap-4 lg:grid-cols-12">
        <div class="reveal bezel lg:col-span-7"><div class="core h-full p-7 md:p-9">
          <p class="flex items-center gap-2 text-sm font-semibold text-zinc-200">${icon('solar:calculator-minimalistic-linear', 'text-lg text-accent')}계산 방법</p>
          <ul class="mt-6 grid gap-4">${t.method.map(m => `<li class="ko flex gap-3 text-base leading-relaxed text-zinc-400"><span class="mt-2.5 h-1.5 w-1.5 flex-none rounded-full bg-zinc-600"></span>${m}</li>`).join('')}</ul>
        </div></div>
        <div class="reveal bezel lg:col-span-5" style="--i:1"><div class="core flex h-full flex-col p-7 md:p-9">
          <p class="flex items-center gap-2 text-sm font-semibold text-zinc-200">${icon('solar:test-tube-linear', 'text-lg text-accent')}검증</p>
          <ul class="mt-6 grid gap-4">${t.verify.map(v => `<li class="ko flex gap-3 text-base leading-relaxed text-zinc-400">${icon('solar:check-circle-linear', 'mt-1 flex-none text-accent')}${v}</li>`).join('')}</ul>
          <div class="mt-auto flex items-end gap-3 border-t border-white/5 pt-6"><span class="font-display text-5xl font-light tracking-tight text-zinc-50">${t.tests}</span><span class="ko pb-1.5 text-sm text-zinc-500">이 도구의 자동 테스트 (전체 ${TESTS}개)</span></div>
        </div></div>
      </div>
    </div>
  </section>

  <!-- 사례 -->
  <section class="relative overflow-hidden border-y border-white/5 bg-zinc-950/70 py-24 md:py-32">
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="reveal grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
        <div>${eyebrow('판단 사례')}</div>
        <div>
          <h2 class="ko text-3xl font-bold leading-snug tracking-tight text-zinc-50 md:text-4xl">${t.case[0]}</h2>
          <p class="ko mt-6 max-w-[64ch] text-lg leading-relaxed text-zinc-300 md:text-xl">${t.case[1]}</p>
          <p class="ko mt-6 text-sm text-zinc-500">템플릿 수치는 설계 예시이며 특정 게임의 실제 수치가 아닙니다.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- 함께 쓰는 도구 -->
  <section class="py-24 md:py-32">
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="reveal flex items-end justify-between gap-6">
        <h2 class="ko text-2xl font-bold tracking-tight text-zinc-50 md:text-3xl">함께 쓰는 도구</h2>
        <a href="index.html#tools" class="t-spring hidden items-center gap-1.5 text-sm text-zinc-400 hover:text-accent sm:inline-flex">전체 도구${icon('solar:arrow-right-linear')}</a>
      </div>
      <div class="mt-10 grid gap-4 md:grid-cols-[1.2fr_1fr_1fr]">
        ${t.related.map((id, i) => { const r = byId[id]; return `<a href="${id}.html" class="reveal t-spring bezel group block hover:-translate-y-1" style="--i:${i}"><div class="core h-full p-7">
          <span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/5 text-zinc-200 ring-1 ring-white/10">${icon(r.icon, 'text-xl')}</span>
          <h3 class="ko mt-5 text-lg font-semibold text-zinc-50">${r.name}</h3>
          <p class="ko mt-2 text-sm leading-relaxed text-zinc-400">${r.tagline}</p>
          <span class="mt-5 inline-flex items-center gap-1.5 text-sm text-zinc-500 group-hover:text-accent">자세히${icon('solar:arrow-right-linear', 't-spring group-hover:translate-x-1')}</span>
        </div></a>`; }).join('\n        ')}
      </div>
    </div>
  </section>

  <!-- 마무리 CTA -->
  <section class="relative overflow-hidden border-t border-white/5 py-24 md:py-32">
    <div class="orb left-[10%] top-[20%] h-[380px] w-[380px] bg-accent/10" aria-hidden="true"></div>
    <div class="relative mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:items-end lg:px-8">
      <div class="reveal">
        <h2 class="ko text-3xl font-bold leading-tight tracking-tight text-zinc-50 md:text-5xl">템플릿으로 시작해<br>내 수치로 바꿔 보세요</h2>
        <div class="mt-10 flex flex-wrap gap-3">${cta(`${APP}#${t.id}`, `${t.short} 도구 열기`)}</div>
      </div>
      <nav class="reveal grid grid-cols-2 gap-3" style="--i:1" aria-label="다른 도구">
        <a href="${prev.id}.html" class="t-spring rounded-[1.5rem] border border-white/5 bg-white/[0.02] p-5 hover:border-white/10 hover:bg-white/[0.04]"><span class="flex items-center gap-1.5 text-xs text-zinc-500">${icon('solar:arrow-left-linear')}이전 도구</span><span class="ko mt-2 block text-base font-semibold text-zinc-100">${prev.name}</span></a>
        <a href="${next.id}.html" class="t-spring rounded-[1.5rem] border border-white/5 bg-white/[0.02] p-5 text-right hover:border-white/10 hover:bg-white/[0.04]"><span class="flex items-center justify-end gap-1.5 text-xs text-zinc-500">다음 도구${icon('solar:arrow-right-linear')}</span><span class="ko mt-2 block text-base font-semibold text-zinc-100">${next.name}</span></a>
      </nav>
    </div>
  </section>
</main>
${footer()}
${SCRIPT}
</body>
</html>
`;
}

writeFileSync(join(OUT, 'index.html'), landing());
for (const t of TOOLS) writeFileSync(join(OUT, `${t.id}.html`), detail(t));
console.log(`landing/index.html + ${TOOLS.length}개 세부 페이지`);
