// 소개 페이지 생성기 — landing/index.html(랜딩)과 도구별 세부 페이지 8장을 만든다.
// 결과물은 각각 혼자 열리는 HTML(Tailwind CDN · Pretendard · Iconify Solar)이고, 이 스크립트는 문구·구조를 고칠 때만 다시 돌린다:
//   node landing/_build.mjs
// 수치는 모두 워크벤치 템플릿을 실제로 돌린 결과와 테스트 수다(docs/case-study.md, README). 가짜 후기·만든 지표는 넣지 않는다.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const APP = '../index.html';
const REPO = 'https://github.com/junhy96/gamedesign_workbench';
const TESTS = 155;

// ── 도구 데이터 ──────────────────────────────────────────
const TOOLS = [
  {
    id: 'enhance', name: '강화 확률·비용 설계', short: '강화', icon: 'solar:magic-stick-3-linear', cat: '강화 · BM',
    tagline: '하락·파괴·천장이 섞인 강화의 기대 비용을 정확하게',
    card: '+15까지 평균·운 나쁜 1%·예산별 도달 확률, 보조 아이템 가격까지',
    desc: '단계별 성공·대성공·유지·하락·파괴 확률과 재화 비용을 넣으면, 목표 단계까지의 기대 총비용과 편차, 파괴 위험, 예산별 도달 확률을 계산합니다. 보조 아이템을 가장 싸게 쓰는 정책과 아이템 가격 곡선으로 BM 가격을 검토합니다.',
    facts: [['27,967원', '+0 → +15 기대 총비용 (기본 템플릿)'], ['30.4%', '한 번도 파괴되지 않고 도달할 확률'], ['−52.8%', '보조 아이템을 최적으로 쓸 때 줄어드는 비용']],
    questions: ['+15까지 평균 얼마가 들고, 운 나쁜 1%는 얼마를 쓰나요?', '3만 원 안에 목표에 닿는 유저는 몇 %인가요?', '파괴방지권 가격이 적정한가요? 합리적인 유저는 어느 단계부터 쓰나요?', '목표 기대 비용에 맞추려면 성공률을 얼마나 바꿔야 하나요?'],
    features: [
      ['solar:calculator-minimalistic-linear', '정확한 기대값과 편차', '단계 × 연속 카운터를 상태로 둔 흡수 마르코프 체인을 띠 행렬 LU와 Sherman–Morrison 공식으로 풉니다. 천장 수십 회 × 단계 수십 개도 바로 계산되고, 표준편차·단계별 파괴 확률·민감도가 같은 분해 하나에서 나옵니다.', ['(I − P) E = r', '상태 = (단계, 연속 실패)', '표준편차 ← 2차 모멘트']],
      ['solar:target-linear', '보조 아이템 최적 사용 정책', '상태마다 파괴방지·하락방지·성공률 증가 아이템 조합을 골라 기대 총비용이 가장 낮은 정책을 정책 반복법으로 찾습니다. 아이템이 필수품이 될 만큼 싼지 바로 보입니다.', ['아이템 없이 27,967원', '최적 정책 13,196원', '정책 반복 3회로 수렴']],
      ['solar:chart-2-linear', '아이템 가격 곡선', '한 아이템의 가격을 범위로 바꾸며 최적 정책을 다시 풀고, 가격별 BM 기대 매출과 유저 절감률을 그립니다. 매출이 가장 큰 가격과 절감률이 목표 이하가 되는 가격을 찾아 버튼 하나로 적용합니다.', ['가격 → 최적 정책 → 매출', '절감률 목표 이하 가격', '찾은 가격 바로 적용']],
      ['solar:graph-up-linear', '분포·분위·강화 경로', '시드 고정 시뮬레이션 2만 회로 총비용 분포, 0.1%~99.9% 달성 분위, 예산별 도달 확률을 보여 주고, 앞 12번 시행의 단계 경로로 하락·파괴가 실제로 어떻게 일어나는지 그립니다.', ['시뮬레이션 2만 회', '0.1% ~ 99.9% 분위', '파괴 지점이 보이는 경로']],
    ],
    method: ['상태 = (단계, 연속 카운터). 상태별 기대 비용 E는 (I − P)E = r', '띠 행렬 + 파괴로 생기는 한 열 → 띠 LU + Sherman–Morrison', '아이템 최적화 = 마르코프 결정 과정의 정책 반복', '분포 = 시드 고정 몬테카를로 2만 회 (Web Worker)'],
    verify: ['체인과 따로 게임 규칙을 그대로 구현한 시뮬레이터와 모든 메커닉에서 일치', '띠 행렬 풀이 = 밀집 행렬 가우스 소거 (오차 1e-8)', '최적 정책 ≤ 수동 조합, 가격 곡선 30개 점 = 전수 탐색 정답'],
    tests: 23,
    case: ['최적 사용 정책이 보여 준 가격 오류', '아이템 없이 27,967원이던 기대 비용이 최적 정책으로 13,196원(−52.8%)이 됩니다. 합리적인 유저가 쓰면 비용이 절반이 되는 아이템은 선택이 아니라 필수품입니다. 절감 폭이 의도한 수준(예: 15% 이내)이 되고, 아이템을 쓰는 단계가 +12 이상으로 좁혀질 때까지 가격을 조정합니다.'],
    related: ['gacha', 'economy', 'brief'],
  },
  {
    id: 'gacha', name: '가챠·수집 설계', short: '가챠', icon: 'solar:gift-linear', cat: '가챠 · BM',
    tagline: '“필요 장수 ÷ 확률”이 놓치는 중복과 확률 구조까지',
    card: '단순 계산 → 확률 구조 → 중복으로 비용을 나누고, 확률 공시표까지',
    desc: '등급 확률, 소환 레벨, 천장(확률 상승), 픽업 보장, 마일리지, 중복 분해 교환을 넣고 “이 유닛을 이만큼 모으려면 얼마가 드나”를 계산합니다. 비용이 왜 이만큼 드는지 원인을 나누고, 공시용 확률표를 만듭니다.',
    facts: [['×1.71', '단순 계산 대비 실제 기대 뽑기 (레전드 전원 풀 초월)'], ['205,056회', '실제 기대 뽑기 — 단순 계산은 120,000회'], ['684일', '월 3만 원 과금 유저의 평균 도달']],
    questions: ['레전드 4종을 6장씩 모으려면 실제로 몇 번을 뽑나요?', '천장·마일리지·조각 교환 중 무엇이 운 나쁜 1%의 꼬리를 자르나요?', '무과금 유저와 과금 유저는 며칠이 걸리나요?', '공시할 캐릭터별 확률과 천장 변동표는 어떻게 되나요?'],
    features: [
      ['solar:layers-minimalistic-linear', '비용 원인 분해', '단순 계산(필요 장수 ÷ 확률) → 중복이 없다면(소환 레벨·천장·교환 효과) → 실제(중복 효과)로 나눠, 확률을 올릴지 교환을 넣을지 구분합니다.', ['① 단순 계산 120,000', '② 중복이 없다면 176,479 (×1.47)', '③ 실제 205,056 (×1.16)']],
      ['solar:calculator-minimalistic-linear', '공식 계산 + 시뮬레이션', '수집 목표는 포아송화 적분, 픽업·특정 캐릭터는 (모은 장수 × 천장 카운터 × 보장) 상태를 뽑기마다 전진시키는 동적 계획법으로 분포까지 구합니다. 나머지는 기하분포로 건너뛰는 시뮬레이션이라 0.005% 확률 목표도 바로 계산됩니다.', ['E[N] = (1/λ)∫ 1 − P(k,u)^K du', '상태 = (장수, 천장, 보장)', '확률이 바뀌는 지점에서만 끊기']],
      ['solar:list-check-linear', '확률 공시표', '소환 레벨별 등급 확률, 모든 캐릭터의 개별 확률, 천장 확률 변동표, 천장·보장을 포함한 실효 확률, 확률이 바뀌는 조건 문장을 만들고, 반올림하면 0%로 보이는 캐릭터와 합계 오차를 경고합니다.', ['캐릭터별 확률 합 100%', '천장 변동표·실효 확률', 'CSV (소수 6자리 이상)']],
      ['solar:graph-up-linear', '분위·수렴', '0.1%~99.9% 달성 분위(뽑기·비용·무과금 도달일·천장 구간 당첨)와 시뮬레이션 수렴 그래프로 운 나쁜 유저가 어디까지 가는지 보여 줍니다.', ['99% = 266,762회', '마일리지안 99% = 200,000회', '천장 구간 당첨 횟수 분위']],
    ],
    method: ['수집: E[N] = (1/λ)∫ 1 − P(k, u)^K du (포아송화, 심프슨 적분)', '픽업·특정 캐릭터: 상태 분포 동적 계획법 (분포 전체)', '실효 확률 = 최상위 1장당 평균 뽑기의 역수', '시뮬레이션: 확률이 바뀌는 지점에서만 끊는 기하분포 건너뛰기'],
    verify: ['쿠폰 수집 n·Hₙ/p, 음이항 평균과 오차 1e-6', '천장: 절단 기하분포 해석해와 일치', '공시표: 레벨마다 캐릭터 확률 합 100%, 천장 변동표 마지막 줄 100%'],
    tests: 22,
    case: ['마일리지 선택권이 꼬리를 정확히 자릅니다', '방치형 동료 소환에서 레전드 천장(8천 회)은 평균을 26% 줄이지만 레전드가 나오는 속도 자체를 바꿔 스테이지 밸런스까지 흔듭니다. 2만 회마다 레전드 선택권을 주는 마일리지는 평균을 20% 줄이면서 99% 꼬리를 266,762회에서 정확히 200,000회로 자릅니다. 공시 확률은 그대로 두고 “아무리 운이 나빠도 여기까지”를 보여 줄 수 있어 1차안으로 골랐습니다.'],
    related: ['enhance', 'economy', 'brief'],
  },
  {
    id: 'supply', name: '성장 재화 수급 설계', short: '수급', icon: 'solar:routing-2-linear', cat: '성장 · 재화',
    tagline: '공급량에서 레벨별 필요량을 거꾸로 계산합니다',
    card: '콘텐츠가 뿌리는 재화로 레벨별 필요량 표를 역산하고 세그먼트별 도달일 확인',
    desc: '콘텐츠와 상품이 뿌리는 재화(1회 획득량 × 세그먼트별 횟수 × 주기·해금일)와 성장 목표(기준 유저가 n일차에 Lv m)를 넣으면, 공급에 맞춘 레벨별 필요량 표를 만듭니다. 세그먼트마다 레벨 도달일을 확인하고, 표를 재화 흐름 시뮬레이터로 보냅니다.',
    facts: [['역산', '공급 → 레벨별 필요량 표'], ['단조 보정', '필요량이 레벨마다 줄지 않게, 총량은 그대로'], ['세그먼트별', '같은 표로 라이트·코어·헤비 도달일 확인']],
    questions: ['하루 공급이 이만큼일 때 30일차 Lv20이 되려면 레벨별 필요량은 얼마인가요?', '라이트 유저는 같은 레벨에 며칠 늦게 닿나요?', '필요량 표를 등비 수열로 근사하면 얼마나 맞나요?'],
    features: [
      ['solar:box-linear', '공급 모델', '공급원마다 1회 획득량과 세그먼트별 횟수, 주기(매일·매주·매월·1회), 해금 일차를 넣습니다. 누적 공급량이 일차별로 쌓입니다.', ['S(d) = 시작 보유 + 누적 획득', '주기: 매일·매주·매월·1회', '해금 일차부터 공급']],
      ['solar:ruler-pen-linear', '마일스톤 역산', '마일스톤(일차, 레벨) 사이를 직선이나 단조 3차 곡선으로 잇고, 누적 필요량 = 배분 비율 × 기준 세그먼트 누적 공급으로 레벨별 필요량을 구합니다.', ['C(L) = p × S_ref(d(L))', '필요량 = C(L) − C(L−1)', '직선 / 단조 3차 곡선']],
      ['solar:checklist-minimalistic-linear', '단조 보정과 반올림', '레벨이 오를수록 필요량이 줄지 않게 인접 위반 구간을 평균으로 묶고(총량 유지), 반올림 오차가 쌓이지 않도록 누적 기준으로 반올림합니다.', ['PAV 단조 보정', '누적 기준 반올림', '등비 근사 비율 표시']],
      ['solar:export-linear', '세그먼트 검증과 보내기', '세그먼트마다 레벨 도달일을 계산합니다. 기준 세그먼트는 정의상 마일스톤에 맞으므로, 실제 검증은 다른 세그먼트의 도달일로 봅니다. 표는 재화 흐름 시뮬레이터의 성장 항목으로 바로 보냅니다.', ['도달일 = p × S_seg(d) ≥ C(L)', '다른 세그먼트로 검증', '재화 흐름으로 보내기']],
    ],
    method: ['공급: S_seg(d) = 시작 보유량 + d일차까지 누적 획득량', '목표: 마일스톤 사이 직선 또는 단조 3차 곡선 → 레벨 L의 목표 일차 d(L)', '역산: 누적 필요량 C(L) = p × S_ref(d(L))', '보정: 인접 위반 구간을 평균으로 묶는 PAV (총량 유지)'],
    verify: ['하루 10 공급·10일 Lv10 → 레벨당 10, 매일 1레벨', '기준 세그먼트는 마일스톤 일차에 정확히 도달 (보정·반올림 전)', 'PAV 보정 후 합계 유지, 정확한 등비 수열은 그대로 복원'],
    tests: 10,
    case: ['강화·수급 → 재화 흐름으로 이어서 봅니다', '수급 탭에서 역산한 레벨별 필요량 표를 재화 흐름 시뮬레이터의 성장 항목 비용으로 보내면, 공급과 소모가 같은 루프 안에서 며칠 만에 맞물리는지 바로 확인할 수 있습니다. 강화 탭의 단계별 기대 소모도 같은 경로로 들어갑니다.'],
    related: ['economy', 'stage', 'enhance'],
  },
  {
    id: 'stage', name: '방치형 스테이지 성장', short: '스테이지', icon: 'solar:ranking-linear', cat: '방치형 · 성장',
    tagline: '어느 구간 때문에 정체되는지, 반대 가정으로 확인합니다',
    card: '실제 체류 vs 의도 체류, 정체 원인과 해소에 필요한 최소 변경',
    desc: '챕터-스테이지별 몬스터 체력·웨이브 골드와 골드 강화 구간 비용 공식(LV_MIN~LV_MAX, 시작 비용 + 증가폭)만으로 스테이지마다 실제로 얼마나 머무는지 계산하고, 의도 체류와 어긋나는 곳과 그 원인을 찾습니다. 레벨이 수십만이어도 레벨별 표 없이 바로 계산합니다.',
    facts: [['78.41시간', '샘플 200스테이지 총 소요'], ['8곳', '의도 체류의 2배를 넘는 정체 스테이지'], ['−0.85%', '체력 증가율만으로 정체를 푸는 최소 변경 (4% → 3.966%)']],
    questions: ['16~17챕터에서 갑자기 오래 머무는 원인은 어느 구간인가요?', '정체를 없애려면 체력 증가율·골드 증가율·구간 증가폭 중 무엇을 얼마나 바꿔야 하나요?', '엑셀 구간 표를 그대로 붙여 넣을 수 있나요?'],
    features: [
      ['solar:chart-2-linear', '실제 체류 vs 의도 체류', '스테이지마다 다음 스테이지를 열 레벨까지 강화하는 데 걸리는 시간을 계산해 의도 체류(1챕터 초 × 챕터마다 배수)와 비교합니다. 정체 기준을 넘는 곳을 빨간 점으로 표시합니다.', ['필요 레벨 = 공격력 × 제한 ≥ 수 × 체력', '체류 = 비용 ÷ 초당 골드', '정체 = 실제 > 기준 × 의도']],
      ['solar:branching-paths-up-linear', '반대 가정으로 찾는 원인', '정체 스테이지가 올리는 구간을 이웃처럼 바꿔(증가폭 = 이웃 중 낮은 쪽, 끊긴 시작 비용 = 이어 붙임) 다시 계산하고, 정체가 절반 이상 풀리면 원인으로 판정합니다. 구간 탓이 아니면 그렇다고 알려 줍니다.', ['구간을 이웃처럼 → 다시 계산', '절반 이상 풀리면 원인', '“적용” 버튼']],
      ['solar:target-linear', '최소 변경과 민감도', '변수 하나만 움직여 정체를 모두 푸는 값을 로그 이분 탐색으로 찾고, ±5/10/20% 토네이도로 무엇이 결과를 가장 크게 흔드는지 보여 줍니다.', ['체력 증가율 −0.85%', '구간 증가폭은 −13.4% 필요', '성장률 비율이 핵심']],
      ['solar:file-download-linear', 'CSV와 곡선 가져오기', '엑셀에서 복사한 구간 표(탭·한글 머리글·천 단위 쉼표)를 붙여 넣고, 스탯·전투 탭의 플레이어 공격력(직선)과 몬스터 체력(등비) 곡선을 맞춰 가져옵니다.', ['열 이름 자동 매핑', '빈 LV_MAX = 끝 없음', '스탯·전투 곡선 가져오기']],
    ],
    method: ['필요 레벨 L_req(s) = 공격력 × 제한 시간 ≥ 몬스터 수 × 체력인 최소 레벨', '누적 비용 = 구간마다 등차수열 합 n × INIT + STEP × n(n−1)/2', '실제 체류 = 두 필요 레벨 사이 비용 ÷ 앞 스테이지 초당 골드', '최소 변경 = 변수 하나씩 로그 이분 탐색 (최대 100배·1/100)'],
    verify: ['샘플 JSON의 기대값과 일치: 누적 비용, 체크포인트 5곳, 총 78.41시간, 정체 8곳', '누적 비용 공식 = 0~150,000레벨 직접 합산', '최소 변경을 적용하면 모두 풀리고, 변화량의 절반만 적용하면 남음'],
    tests: 20,
    case: ['원인은 구간보다 성장률 비율이었습니다', '샘플에서 경고는 5천~2만 레벨 구간의 증가폭(30)을 원인으로 짚습니다. 그런데 몬스터 체력 증가율을 4%에서 3.966%로만 낮춰도 정체가 모두 풀리고, 구간 증가폭으로 풀려면 13.4%를 줄여야 합니다. 체력 증가율을 0.1%만 올려도 총 소요가 43% 늘어납니다 — 숫자 한 칸의 정밀도가 결론을 바꿉니다.'],
    related: ['battle', 'supply', 'brief'],
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
      ['solar:code-square-linear', '밸런스 도구와 엔진 내보내기', '점수를 목표로 만드는 스탯별 최소 배율, 민감도, 아이템·특성 효과 분해, CP·점수 목표 역산을 하고, 규칙 수식을 C#·C++ 코드로 옮겨 Unity·Unreal 파일로 내보냅니다.', ['공격 속도 ×1.153 → 51.3%', 'Unity ScriptableObject', 'Unreal DataTable']],
    ],
    method: ['공격 한 번 = 빗나감 / 일반 / 치명. 쓰러뜨리는 공격 횟수 분포를 동적 계획법으로', 'P(A 승) = Σₙ P(N_A = n) · P(B가 그 시각 전에 못 쓰러뜨림)', '턴 교대: 공격 속도 비율로 선공, 번갈아 공격, 최대 턴', '수식은 자체 파서로 해석 — 코드 실행 없음'],
    verify: ['턴 교대 공식 계산 = Kalivra v1.0.1 엔진을 그대로 돌린 결과 (40만~140만 회, 3σ 안)', '특성(흡혈·공격 직전 배율)도 Kalivra 60만 회와 일치', '시간 기반 공식 계산 = 자체 시뮬레이션 (무작위 설정 12개 × 두 방식)'],
    tests: 36,
    case: ['전투 규칙 하나가 결론을 뒤집습니다', 'Kalivra 기본 샘플은 데미지 수식에 a./b. 접두어가 없어 1만 회 모두 무승부였습니다. 수식을 고쳐도 공격 속도를 선공 확률로만 쓰면 Chicken의 Lv10 승률은 2.6%입니다. 같은 설정에서 공격 속도를 같은 시간의 공격 횟수로 반영하면 75.1%가 됩니다.'],
    related: ['frame', 'stage', 'brief'],
  },
  {
    id: 'economy', name: '재화 흐름 시뮬레이터', short: '재화 흐름', icon: 'solar:wallet-money-linear', cat: '경제 · 라이브',
    tagline: '평균 유저 한 명이 아니라 편차와 이탈까지 봅니다',
    card: '성장 루프를 일 단위로 돌려 편차 띠, 해금일 잔존율, 설치당 매출',
    desc: 'RPG 성장 루프(콘텐츠 → 재화 → 성장 → 전투력 → 보상·해금)를 일 단위로 돌립니다. 세그먼트를 플레이 시간·접속 횟수·월 과금·스태미나 충전·D1/D7/D30 잔존율로 정의하고, 유저 편차 띠와 콘텐츠가 열리는 날의 잔존율, 설치당 매출, 병목 재화를 보여 줍니다.',
    facts: [['15일차', '라이트 유저의 주간 레이드 해금 (모바일 RPG 템플릿)'], ['7%', '그날 남아 있는 라이트 유저'], ['28일차', '같은 라이트 중 하위 10%의 해금']],
    questions: ['이 콘텐츠가 열리는 날 유저가 몇 % 남아 있나요?', '하위 10% 유저는 얼마나 늦게 여나요?', '어느 재화가 성장을 막고, 어느 재화가 쌓이기만 하나요?', '강화 기대 소모를 넣으면 골드가 며칠 만에 바닥나나요?'],
    features: [
      ['solar:history-linear', '하루 처리 순서가 보이는 시뮬레이션', '과금 → 스태미나 → 콘텐츠(우선순위·해금 전투력·시간·횟수) → 상점 교환 → 성장 순서로 하루를 처리하고, 성장을 막는 재화를 병목으로 기록합니다.', ['과금 → 스태미나 → 콘텐츠', '상점 → 성장', '병목 재화 기록']],
      ['solar:graph-up-linear', '유저 편차 띠', '같은 세그먼트 안에서도 플레이 시간이 다릅니다. 유저별 고정 배수(로그정규) × 일별 변동으로 N명을 돌려 하위·상위 10% 띠를 그립니다. 매일 독립으로만 흔들면 평균으로 수렴해 띠가 비현실적으로 좁아집니다.', ['유저별 고정 배수', '× 일별 변동', '하위 10% 해금 지연 경고']],
      ['solar:user-id-linear', '잔존율과 LTV', '세그먼트마다 D1·D7·D30 잔존율을 넣으면 앵커 사이를 구간별 멱법칙으로 잇고, 콘텐츠가 열리는 날의 잔존율과 설치당 기대 매출을 계산합니다.', ['log(일차) − log(잔존) 직선', '해금일 잔존율 30% 미만 경고', 'LTV = Σ 잔존 × 과금']],
      ['solar:diagram-up-linear', '성장 루프 다이어그램', '콘텐츠·과금·재화·상점·성장·전투력 노드를 선 교차가 적게 배치하고, 재화마다 선 색을 나눕니다. PowerPoint 도형으로 바로 내보냅니다.', ['무게중심 정렬 + 이웃 교환', '재화별 선 색', 'PPT 도형 내보내기']],
    ],
    method: ['하루: 과금 → 스태미나 → 콘텐츠 → 상점(교환) → 성장', '보상 = 기본 보상 × (1 + 성장 보너스% × 전투력 ÷ 100)', '편차: 유저별 고정 배수(로그정규, 평균 1) × 일별 변동', '잔존: D1·D7·D30 앵커 사이 구간별 멱법칙, 이후 D7→D30 추세'],
    verify: ['하루 처리 순서·스태미나 상한·교환 상한', '편차 띠: 유저별 고정 배수가 있어야 띠가 좁아지지 않음', '강화·수급 탭에서 보낸 성장 비용 표가 재화별 총 기대 소모와 일치'],
    tests: 16,
    case: ['“15일차 해금, 정상”이 정상이 아니었던 이유', '라이트(하루 30분, 무과금)는 주간 레이드를 15일차에 엽니다. 그날 남아 있는 라이트 유저는 7%이고, 하위 10%는 28일차에 엽니다. 열려도 시간·스태미나가 남지 않아 60일 동안 한 번도 하지 못합니다. 평균 유저 한 명만 돌렸다면 보이지 않았을 문제라, 해금 전투력과 소요 시간을 낮춰 7일차 안에 첫 레이드를 경험하게 조정합니다.'],
    related: ['supply', 'enhance', 'gacha'],
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
    related: ['battle', 'brief', 'stage'],
  },
  {
    id: 'brief', name: '브리핑', short: '브리핑', icon: 'solar:clipboard-check-linear', cat: '공유 · 회의',
    tagline: '모든 탭의 결론을 한 장으로 모아 회의에 가져갑니다',
    card: '기준 스냅샷 대비 변화, 지표별 목표 통과·미달, 메모와 PDF',
    desc: '강화·가챠·수급·스테이지·스탯 전투·재화 흐름·프레임 탭의 핵심 지표와 검증 문장을 한 장에 모읍니다. 스냅샷을 기준으로 고르면 무엇이 얼마나 바뀌었는지, 지표마다 목표를 넣으면 통과·미달을 보여 주고, 결론·근거·리스크·결정 요청 메모와 함께 PDF로 저장합니다.',
    facts: [['7개 탭', '핵심 지표와 검증 문장을 한 장에'], ['≤ · ≥', '지표마다 목표를 넣어 통과·미달 판정'], ['PDF', '입력칸 없이 값만 남는 인쇄 화면']],
    questions: ['지난 회의안 대비 무엇이 얼마나 바뀌었나요?', '목표를 통과하지 못한 지표는 무엇인가요?', '회의에서 무엇을 결정해야 하나요?'],
    features: [
      ['solar:camera-linear', '스냅샷', '헤더의 “스냅샷”에서 모든 탭 설정을 한 번에 저장하고, 나중에 지금 설정과 탭별 핵심 지표를 비교하거나 되돌립니다. 프로젝트 파일로 팀과 같은 설정을 나눕니다.', ['모든 탭 한 번에 저장', '지표 비교 · 되돌리기', '프로젝트 파일']],
      ['solar:target-linear', '목표 판정', '지표마다 ≤ 또는 ≥ 목표를 넣으면 통과·미달을 표시하고, 미달 목록을 요약에 모읍니다. 퍼센트 지표는 퍼센트 단위로 넣습니다.', ['≤ · ≥ 목표', '✓ 통과 / ✗ 미달', '미달 목록 요약']],
      ['solar:document-text-linear', '메모와 PDF', '결론·근거·리스크·결정 요청을 적고 “PDF로 저장(인쇄)”을 누르면, 입력칸과 헤더를 숨기고 값만 남긴 한 장짜리 문서가 됩니다. 비워 둔 메모는 나오지 않습니다.', ['결론 · 근거', '리스크 · 결정 요청', '인쇄용 화면']],
      ['solar:undo-left-round-linear', '되돌리기', '헤더의 ↶ ↷ 또는 Ctrl+Z · Ctrl+Shift+Z로 모든 탭에서 같은 방식으로 되돌립니다. 탭마다 최대 50단계입니다.', ['모든 탭 공통', '탭마다 50단계', 'Ctrl+Z · Ctrl+Shift+Z']],
    ],
    method: ['스냅샷 = 각 탭 저장 키의 묶음, 지표는 탭의 계산 모듈을 그대로 호출', '목표 판정: % 지표는 % 단위로 입력', '검증 문장: 심각한 것부터 탭마다 4개', 'PDF = 브라우저 인쇄 (인쇄용 CSS로 값만)'],
    verify: ['모든 탭의 기본 설정에서 핵심 지표가 계산됨', '스냅샷 저장 → 설정 변경 → 비교 → 되돌리기', '프로젝트 파일을 다른 브라우저로 옮겨도 같은 설정·스냅샷'],
    tests: 6,
    case: ['회의 직전 5분', '고치기 전에 스냅샷을 저장하고, 수치를 바꾼 뒤 브리핑 탭에서 그 스냅샷을 기준으로 고르면 바뀐 탭과 지표별 변화가 한 장에 모입니다. 목표를 넣고 결정 요청을 적어 PDF로 저장하면 회의 자료가 됩니다.'],
    related: ['enhance', 'battle', 'stage'],
  },
];
const byId = Object.fromEntries(TOOLS.map(t => [t.id, t]));

// ── 공통 조각 ────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const icon = (name, cls = '') => `<iconify-icon icon="${name}" class="${cls}" aria-hidden="true"></iconify-icon>`;
const LOGO = `<svg viewBox="0 0 32 32" class="h-7 w-7" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#10b981"/><path d="M9 22l5-12 4 8 2-4 3 8" stroke="#052e1f" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

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
  <meta name="theme-color" content="#09090b">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%2310b981'/><path d='M9 22l5-12 4 8 2-4 3 8' stroke='%23052e1f' stroke-width='2.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>">
  <script src="https://cdn.tailwindcss.com/3.4.16"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap">
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
          colors: { accent: { DEFAULT: '#34d399', soft: '#6ee7b7', deep: '#059669' }, ink: '#09090b' },
          transitionTimingFunction: { spring: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        },
      },
    }
  </script>
  <style>
    html { scroll-behavior: smooth; }
    body { background: #09090b; color: #e4e4e7; -webkit-font-smoothing: antialiased; }
    .ko { word-break: keep-all; overflow-wrap: break-word; }
    .t-spring { transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
    .grain { position: fixed; inset: 0; z-index: 60; pointer-events: none; opacity: 0.035; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
    .orb { position: absolute; border-radius: 9999px; filter: blur(80px); pointer-events: none; animation: float 9s cubic-bezier(0.45, 0, 0.55, 1) infinite; }
    @keyframes float { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-18px) } }
    .reveal { opacity: 0; transform: translateY(2rem); filter: blur(4px); transition: opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1), transform 0.9s cubic-bezier(0.16, 1, 0.3, 1), filter 0.9s cubic-bezier(0.16, 1, 0.3, 1); transition-delay: calc(var(--i, 0) * 80ms); }
    .reveal.in { opacity: 1; transform: none; filter: none; }
    .bezel { background: rgba(255, 255, 255, 0.03); box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08); padding: 6px; border-radius: 2rem; }
    .bezel > .core { border-radius: calc(2rem - 6px); background: linear-gradient(180deg, #131316 0%, #0e0e10 100%); box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.08); }
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
  ? `<a href="${href}" class="t-spring group inline-flex min-h-[52px] items-center gap-3 rounded-full bg-accent py-2 pl-7 pr-2 text-base font-semibold text-ink hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(52,211,153,0.2)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 md:text-lg">${label}<span class="t-spring flex h-9 w-9 items-center justify-center rounded-full bg-black/10 group-hover:translate-x-1">${icon('solar:arrow-right-linear', 'text-lg')}</span></a>`
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
  const bentoSpan = { enhance: 'lg:col-span-7 lg:row-span-2', gacha: 'lg:col-span-5', supply: 'lg:col-span-5', stage: 'lg:col-span-5', battle: 'lg:col-span-7 lg:row-span-2', economy: 'lg:col-span-5', frame: 'lg:col-span-6', brief: 'lg:col-span-6' };
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
    ['스테이지 · 16~17챕터 정체', '비용 구간 증가폭(30) 탓', '체력 증가율 −0.85%로도 해소 — 성장률 비율이 핵심', 'stage'],
    ['재화 흐름 · 주간 레이드 15일차 해금', '평균 유저 한 명: “정상”', '라이트 잔존 7%, 하위 10%는 28일차', 'economy'],
  ];
  const cases = [byId.gacha, byId.enhance, byId.economy];
  const roles = [
    ['solar:widget-5-linear', '시스템 기획자', '성장 재화가 며칠 만에 맞물리는지, 스테이지가 어디서 막히는지, 강화 확률을 바꾸면 골드가 언제 바닥나는지 봅니다.', ['supply', 'stage', 'economy', 'enhance']],
    ['solar:cart-large-2-linear', 'BM 기획자', '가챠 목표의 실제 비용과 운 나쁜 1%, 보조 아이템 가격과 기대 매출, 세그먼트별 설치당 매출을 확인합니다.', ['gacha', 'enhance', 'economy']],
    ['solar:gamepad-linear', '전투·레벨 기획자', 'CP가 실제 승률을 반영하는지, 보스 연계를 보고 피할 수 있는지, 반격할 틈이 몇 번인지 숫자로 판정합니다.', ['battle', 'frame']],
  ];
  const verify = [
    ['Kalivra 엔진과 대조', 'Kalivra v1.0.1 전투 엔진을 그대로 돌린 40만~140만 회 결과와, 같은 규칙의 공식 계산이 3σ 안에서 일치합니다.', 'battle'],
    ['독립 규칙 시뮬레이터', '강화 체인과 따로 게임 규칙을 그대로 구현한 시뮬레이터, 밀집 행렬 풀이(오차 1e-8)와 비교합니다.', 'enhance'],
    ['브루트포스 대조', '프레임 판정의 최적 입력 계획을 무작위 연계 1,000개의 모든 입력 조합과 비교합니다.', 'frame'],
    ['해석해 대조', '쿠폰 수집 n·Hₙ/p, 음이항 평균, 절단 기하분포 같은 알려진 답과 오차 1e-6 안에서 맞춥니다.', 'gacha'],
  ];
  return `${head('기획 워크벤치 — 게임 시스템·BM 밸런스 검증 도구', '강화 확률, 가챠 천장, 성장 재화, 스테이지 체류, 전투 승률까지. 기획서 숫자를 넣으면 기대값과 분포, 문제 구간을 바로 보여 주는 브라우저 도구 모음입니다.')}
<body class="font-sans">
${nav(null)}
<main>
  <!-- 히어로: 왼쪽 문장, 오른쪽 실제 도구 화면 -->
  <section class="relative min-h-[100dvh] overflow-hidden pt-32 md:pt-40">
    <div class="orb left-[-10%] top-[8%] h-[420px] w-[420px] bg-emerald-500/15" aria-hidden="true"></div>
    <div class="orb right-[-8%] top-[40%] h-[520px] w-[520px] bg-zinc-500/10" style="animation-delay:-4s" aria-hidden="true"></div>
    <div class="relative mx-auto grid max-w-7xl items-center gap-14 px-4 pb-24 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:px-8">
      <div class="reveal">
        ${eyebrow(`${icon('solar:cpu-bolt-linear', 'text-sm')}게임 시스템 · BM 기획`)}
        <h1 class="ko mt-7 text-4xl font-bold leading-tight tracking-tight text-zinc-50 md:text-6xl lg:text-[4.25rem] lg:leading-[1.12]">엑셀로 못 푸는<br>밸런스 계산을<br><span class="text-accent">링크 하나</span>로 확인합니다</h1>
        <p class="ko mt-7 max-w-[54ch] text-base leading-relaxed text-zinc-400 md:text-lg">강화 확률, 가챠 천장, 성장 재화, 스테이지 체류, 전투 승률까지. 기획서 숫자를 넣으면 기대값과 분포, 문제가 생기는 구간과 그 원인을 바로 보여 줍니다. 설치·로그인 없이 열리고, 넣은 숫자는 서버로 가지 않습니다.</p>
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
        <div class="absolute -bottom-6 -left-4 hidden rounded-2xl border border-white/10 bg-zinc-900/90 px-5 py-4 shadow-[0_20px_60px_-20px_rgba(16,185,129,0.25)] md:block" style="animation: float 7s cubic-bezier(0.45,0,0.55,1) infinite">
          <p class="text-xs text-zinc-500">CP 2위 궁수 → 전사</p>
          <p class="font-display text-2xl font-semibold text-zinc-50">승률 24.8%</p>
        </div>
      </div>
    </div>
  </section>

  <!-- 숫자 띠 -->
  <section class="border-y border-white/5 bg-zinc-950/60">
    <div class="mx-auto grid max-w-7xl grid-cols-2 gap-y-10 px-4 py-14 sm:px-6 md:grid-cols-4 lg:px-8">
      <div class="reveal"><p class="font-display text-4xl font-semibold tracking-tight text-zinc-50 md:text-5xl" data-count="8">8</p><p class="ko mt-2 text-sm text-zinc-500">기획 도구 (다이어그램·PDF 부가 도구 별도)</p></div>
      <div class="reveal" style="--i:1"><p class="font-display text-4xl font-semibold tracking-tight text-zinc-50 md:text-5xl" data-count="${tests}">${tests}</p><p class="ko mt-2 text-sm text-zinc-500">계산 모듈 자동 테스트</p></div>
      <div class="reveal" style="--i:2"><p class="font-display text-4xl font-semibold tracking-tight text-zinc-50 md:text-5xl" data-count="1400000">1,400,000</p><p class="ko mt-2 text-sm text-zinc-500">Kalivra 엔진 대조에 쓴 전투 횟수</p></div>
      <div class="reveal" style="--i:3"><p class="font-display text-4xl font-semibold tracking-tight text-zinc-50 md:text-5xl">0<span class="text-zinc-500">B</span></p><p class="ko mt-2 text-sm text-zinc-500">8개 도구가 서버로 보내는 데이터</p></div>
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
          <h2 class="ko mt-6 text-3xl font-bold leading-snug tracking-tight text-zinc-50 md:text-5xl">검증 도구 여덟 가지</h2>
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
            <div><p class="font-display text-3xl font-semibold text-zinc-50">0.72643</p><p class="mt-1 text-xs text-zinc-500">공식 계산</p></div>
            <div><p class="font-display text-3xl font-semibold text-zinc-400">0.72676</p><p class="mt-1 text-xs text-zinc-500">엔진 실행 결과</p></div>
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
      ${[0, 1].map(k => [['solar:camera-linear', '스냅샷으로 지금 설정 저장'], ['solar:ruler-pen-linear', '수치 한 칸 바꾸기'], ['solar:undo-left-round-linear', 'Ctrl+Z로 되돌리기'], ['solar:clipboard-check-linear', '브리핑에서 목표 통과·미달'], ['solar:document-text-linear', 'PDF로 회의 자료'], ['solar:code-square-linear', 'Unity·Unreal로 내보내기'], ['solar:link-round-linear', '공유 링크 한 줄']].map(([ic, l]) => `<span class="flex flex-none items-center gap-3 rounded-full border border-white/10 bg-white/[0.02] px-6 py-3 text-base text-zinc-300"${k ? ' aria-hidden="true"' : ''}>${icon(ic, 'text-xl text-accent')}${l}</span>`).join('')).join('')}
    </div>
  </section>

  <!-- 마무리 CTA -->
  <section class="relative overflow-hidden py-28 md:py-40">
    <div class="orb left-1/2 top-1/2 h-[480px] w-[720px] -translate-x-1/2 -translate-y-1/2 bg-emerald-500/10" aria-hidden="true"></div>
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
    <div class="orb right-[-10%] top-[10%] h-[460px] w-[460px] bg-emerald-500/12" aria-hidden="true"></div>
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
            ${t.facts.map(([v, l]) => `<div class="py-5 first:pt-0 last:pb-0"><dt class="font-display text-3xl font-semibold tracking-tight text-zinc-50 md:text-4xl">${v}</dt><dd class="ko mt-1.5 text-sm leading-relaxed text-zinc-400">${l}</dd></div>`).join('\n            ')}
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
        ${t.questions.map((q, i) => `<li class="reveal flex gap-6 py-7 first:pt-0" style="--i:${i}"><span class="font-display text-2xl font-semibold text-zinc-700 md:text-3xl">0${i + 1}</span><p class="ko text-lg font-medium leading-snug text-zinc-100 md:text-2xl">${q}</p></li>`).join('\n        ')}
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
            <div class="orb right-[-30%] top-[-40%] h-56 w-56 bg-emerald-500/10" aria-hidden="true"></div>
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
          <div class="mt-auto flex items-end gap-3 border-t border-white/5 pt-6"><span class="font-display text-5xl font-semibold tracking-tight text-zinc-50">${t.tests}</span><span class="ko pb-1.5 text-sm text-zinc-500">이 도구의 자동 테스트 (전체 ${TESTS}개)</span></div>
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
    <div class="orb left-[10%] top-[20%] h-[380px] w-[380px] bg-emerald-500/10" aria-hidden="true"></div>
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
