# 제안 기능 더미 저장 파일

기능을 **"도구에서 JSON 저장을 누른 결과"라고 가정**한 샘플입니다.
입력 형식과 기대 결과를 먼저 고정해 두고, 기능을 구현할 때 이 파일을 불러와 `expected`와 같은 값이 나오는지로 확인합니다.
수치는 모두 가상의 설계 예시입니다.

| 파일 | 기능 | 핵심 기대 결과 |
|---|---|---|
| [enhance-quantity-items.json](enhance-quantity-items.json) | 강화 탭 + **수량형 보조 재료**(개당 +%p, 최대 n개) + **아이템 가격 곡선** | 아이템 없이 222,822원 → 최적 투입 98,306원. BM 매출은 상급 가호 220 다이아에서 최대이고, 상급 가격만으로는 절감률 15%에 닿지 않음 |

- `proposedFields`에 새로 생기는 필드와 계산식을 적었습니다.
- `expected`는 [generate.mjs](generate.mjs)가 도구와 **독립적으로** 구한 정답입니다 (단계마다 투입량 조합 전수 탐색).
- 수치를 바꾸려면 `generate.mjs`를 고치고 `node docs/samples/generate.mjs`로 다시 만듭니다.

방치형 스테이지 성장 탭과 그 샘플(stage-idle-growth.json, stage-cost-intervals.csv)은 2026-10-20에 탭을 없애면서 지웠습니다 (docs/PLAN.md 참고).
