# 제안 기능 더미 저장 파일

아직 만들지 않은 두 기능을 **"도구에서 JSON 저장을 누른 결과"라고 가정**한 샘플입니다.
입력 형식과 기대 결과를 먼저 고정해 두고, 기능을 구현할 때 이 파일을 불러와 `expected`와 같은 값이 나오는지로 확인합니다.
수치는 모두 가상의 설계 예시입니다.

| 파일 | 기능 | 핵심 기대 결과 |
|---|---|---|
| [enhance-quantity-items.json](enhance-quantity-items.json) | 강화 탭 + **수량형 보조 재료**(개당 +%p, 최대 n개) + **아이템 가격 곡선** | 아이템 없이 222,822원 → 최적 투입 98,306원. BM 매출은 상급 가호 220 다이아에서 최대이고, 상급 가격만으로는 절감률 15%에 닿지 않음 |
| [stage-idle-growth.json](stage-idle-growth.json) | **방치형 스테이지 성장** 탭 (구간 비용 공식·웨이브 보상·의도 체류 시간) | 200스테이지 총 78.4시간, 일부러 가파르게 둔 5천~2만 레벨 구간 때문에 16~17챕터 정체 |
| [stage-cost-intervals.csv](stage-cost-intervals.csv) | 스테이지 탭의 **CSV 가져오기** 샘플 (`LV_MIN,LV_MAX,INIT_COST,STEP`, 마지막 구간 LV_MAX 비움 = 끝 없음) | JSON의 `costIntervals`와 같은 표 |

- `proposedFields`(강화)·`model`(스테이지)에 새로 생기는 필드와 계산식을 적었습니다.
- `expected`는 [generate.mjs](generate.mjs)가 도구와 **독립적으로** 구한 정답입니다 (강화: 단계마다 투입량 조합 전수 탐색 / 스테이지: 구간 등차수열 합을 직접 합산과 대조).
- 스테이지 성장 탭은 구현되었습니다: [tests/stage.test.mjs](../../tests/stage.test.mjs)가 이 JSON·CSV를 불러와 `expected`와 비교하고, 화면의 '불러오기'로 JSON을 그대로 열 수 있습니다.
- 수치를 바꾸려면 `generate.mjs`를 고치고 `node docs/samples/generate.mjs`로 다시 만듭니다.
