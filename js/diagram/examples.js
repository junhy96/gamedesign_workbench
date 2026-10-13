// 템플릿 겸 데모 예시. API 키가 없는 방문자(면접관 등)도 결과물과 내보내기를 바로 체험할 수 있다.

export const EXAMPLES = [
  {
    id: 'ui', label: 'UI 플로우', kind: 'flowchart',
    prompt: '타이틀 화면에서 계정이 있으면 로비로, 없으면 계정 생성 후 로비로 간다. 로비에서는 상점, 인벤토리, 전투 준비로 갈 수 있고 상점과 인벤토리는 로비로 돌아온다. 전투 준비 후 매칭 대기, 전투, 결과 화면을 거쳐 보상을 받고 로비로 돌아온다.',
    code: `flowchart LR
  title["타이틀 화면"] --> login{"계정 있음?"}
  login -- "예" --> lobby["로비"]
  login -- "아니오" --> signup["계정 생성"]
  signup --> lobby
  lobby --> shop["상점"]
  lobby --> inven["인벤토리"]
  lobby --> ready["전투 준비"]
  shop --> lobby
  inven --> lobby
  ready --> match["매칭 대기"]
  match --> battle["전투"]
  battle --> result["결과 화면"]
  result -- "보상 수령" --> lobby`,
  },
  {
    id: 'state', label: '상태 머신', kind: 'state',
    prompt: '보스 AI 상태: 대기 중 플레이어를 발견하면 추적한다. 사거리에 들어오면 공격하고, 공격이 끝나면 다시 추적한다. 공격 중 패링당하면 경직되고 1.5초 뒤 추적으로 돌아간다. 플레이어를 놓치면 대기로 돌아간다. 체력이 50% 이하가 되면 2페이즈(광폭화)로 바뀌고 체력이 0이 되면 끝난다.',
    code: `stateDiagram-v2
  state "대기" as Idle
  state "추적" as Chase
  state "공격" as Attack
  state "경직" as Stagger
  state "2페이즈 (광폭화)" as Phase2
  [*] --> Idle
  Idle --> Chase: 플레이어 발견
  Chase --> Attack: 사거리 진입
  Attack --> Chase: 공격 종료
  Attack --> Stagger: 패링당함
  Stagger --> Chase: 1.5초 경과
  Chase --> Idle: 플레이어 놓침
  Chase --> Phase2: 체력 50% 이하
  Phase2 --> [*]: 체력 0`,
  },
  {
    id: 'quest', label: '퀘스트 분기', kind: 'flowchart',
    prompt: '촌장의 의뢰를 받아 숲의 늑대를 조사한다. 늑대 무리의 정체를 알게 된 뒤 토벌하면 보스 늑대와 싸우고 엔딩 A(마을의 영웅). 대화를 시도하면 늑대 정령을 만나고, 정령의 부탁을 들어주면 엔딩 B(숲의 수호자), 거절하면 엔딩 C(쫓겨난 이방인).',
    code: `flowchart TD
  start["촌장의 의뢰 수락"] --> forest["숲의 늑대 조사"]
  forest --> choice{"늑대 무리의 정체"}
  choice -- "토벌한다" --> fight["보스 늑대 전투"]
  choice -- "대화를 시도한다" --> talk["늑대 정령과 대화"]
  fight --> endA["엔딩 A: 마을의 영웅"]
  talk --> deal{"정령의 부탁을 들어준다?"}
  deal -- "예" --> endB["엔딩 B: 숲의 수호자"]
  deal -- "아니오" --> endC["엔딩 C: 쫓겨난 이방인"]`,
  },
  {
    id: 'seq', label: '시퀀스', kind: 'sequence',
    prompt: '강화 요청 흐름: 클라이언트가 장비 ID와 보호권 사용 여부를 담아 서버에 강화를 요청한다. 서버는 DB에서 재화와 장비를 조회하고, 서버 난수로 확률을 판정한다. 성공이면 단계를 올리고 재화를 차감, 파괴면 장비를 파괴 처리하고 재화를 차감한다. 마지막으로 결과와 갱신된 재화를 클라이언트에 돌려준다.',
    code: `sequenceDiagram
  participant C as 클라이언트
  participant S as 게임 서버
  participant D as DB
  C->>S: 강화 요청 (장비 ID, 보호권 사용)
  S->>D: 재화·장비 조회
  D-->>S: 보유량, 현재 단계
  S->>S: 확률 판정 (서버 난수)
  alt 성공
    S->>D: 단계 +1, 재화 차감
  else 파괴
    S->>D: 장비 파괴 처리, 재화 차감
  end
  S-->>C: 결과와 갱신된 재화`,
  },
];
