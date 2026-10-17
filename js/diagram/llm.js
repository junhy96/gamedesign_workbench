// 자연어 → Mermaid: Claude API 호출 (공식 SDK, 브라우저 모드)
// 키는 메모리에만 두고 저장하지 않는다. 요청은 이 브라우저에서 api.anthropic.com으로 직접 간다.

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.129.0/+esm';

export const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (기본)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5'],
];

const SYSTEM = `당신은 게임 기획 문서에 들어갈 Mermaid 다이어그램을 작성합니다. 사용자의 한국어 설명을 Mermaid 코드로 바꿉니다.

출력 규칙
- Mermaid 코드만 출력합니다. 설명 문장이나 마크다운 코드 펜스(\`\`\`)는 넣지 않습니다.
- 형식은 flowchart(TD 또는 LR), stateDiagram-v2, sequenceDiagram 중 설명에 맞는 것을 고릅니다. 화면 이동·분기·절차는 flowchart, 상태와 전이는 stateDiagram-v2, 주체 사이에 주고받는 메시지는 sequenceDiagram이 적합합니다.
- 노드와 상태의 ID는 영문·숫자로 짓고, 화면에 보이는 이름은 한국어로 씁니다. flowchart는 A1["메인 화면"]처럼 큰따옴표로 감싸고, stateDiagram-v2는 state "대기" as Idle 로 선언합니다. 괄호나 특수문자가 들어간 이름과 연결선 라벨도 큰따옴표로 감쌉니다.
- flowchart의 블록은 의미에 맞는 모양으로 씁니다. 색과 범례(INDEX)는 모양을 보고 자동으로 붙습니다.
  - 시작·종료: id(["게임 실행"])
  - 처리(로직·계산·행동): id["보상 지급 계산"]
  - 판단(분기 조건): id{"계정 있음?"} — 나가는 선 라벨은 "예"/"아니오" 또는 "있음"/"없음"처럼 짧게
  - 입출력(I/O: 유저 입력, 서버 요청·응답, 결과 출력): id[/"닉네임 입력"/]
  - 화면(UI 화면·팝업): id("로비 화면")
  - 데이터(DB·저장소·테이블): id[("계정 DB")]
  - 서브 프로세스(다른 문서에서 정의한 절차): id[["전투 진행"]]
  - 준비·설정(초기화·설정값): id{{"매칭 조건 설정"}}
  - 이벤트·신호(푸시, 알림, 트리거): id>"푸시 알림"]
- style, classDef, linkStyle, click, HTML 태그, %%{init}%% 지시문은 쓰지 않습니다. 색은 자동으로 입혀집니다.
- 수정 요청을 받으면 기존 코드를 바탕으로 요청한 부분만 바꾸고 나머지 구조와 이름은 그대로 둡니다.`;

let AnthropicCtor;
async function client(apiKey) {
  AnthropicCtor ??= (await import(SDK_URL)).default;
  return { Anthropic: AnthropicCtor, api: new AnthropicCtor({ apiKey, dangerouslyAllowBrowser: true }) };
}

/** 응답 텍스트에서 Mermaid 코드만 꺼낸다 (펜스가 섞여 와도 처리) */
export function extractMermaid(text) {
  const fenced = text.match(/```(?:mermaid)?\s*\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * @param {{apiKey:string, model:string, messages: Array<{role:'user'|'assistant', content:string}>}} p
 * @returns {Promise<{code:string, usage:{input:number, output:number}, fellBack:boolean}>}
 */
async function call({ apiKey, model, messages }) {
  const { Anthropic, api } = await client(apiKey);
  const params = { model, max_tokens: 16000, system: SYSTEM, messages, output_config: { effort: 'low' } };
  let res;
  try {
    // Haiku 5.5에는 서버 측 대체 모델이 없으므로 일반 호출, 나머지는 거절 시 자동 대체(fallbacks: "default")
    res = model === 'claude-haiku-5-5'
      ? await api.messages.create(params)
      : await api.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (e) {
    throw new Error(describeError(Anthropic, e));
  }
  if (res.stop_reason === 'refusal') throw new Error('모델이 이 요청을 처리하지 않았습니다. 설명을 바꿔 다시 시도해 주세요.');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  if (!text.trim()) throw new Error(res.stop_reason === 'max_tokens' ? '응답이 너무 길어 잘렸습니다. 설명을 나눠서 요청해 주세요.' : '빈 응답을 받았습니다.');
  return {
    code: extractMermaid(text),
    usage: { input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0 },
    fellBack: res.content.some(b => b.type === 'fallback'),
  };
}

function describeError(Anthropic, e) {
  if (e instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않습니다.';
  if (e instanceof Anthropic.PermissionDeniedError) return '이 키로는 선택한 모델을 사용할 수 없습니다.';
  if (e instanceof Anthropic.RateLimitError) return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  if (e instanceof Anthropic.BadRequestError) return `요청 오류: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return '네트워크 연결에 실패했습니다.';
  if (e instanceof Anthropic.APIError) return `API 오류 (${e.status ?? '알 수 없음'}): ${e.message}`;
  return e?.message || String(e);
}

const KIND_HINT = {
  auto: '',
  flowchart: '형식: flowchart\n\n',
  state: '형식: stateDiagram-v2\n\n',
  sequence: '형식: sequenceDiagram\n\n',
};

/** 새로 만들기 */
export function createDiagram({ apiKey, model, prompt, kind }) {
  return call({ apiKey, model, messages: [{ role: 'user', content: `${KIND_HINT[kind] || ''}${prompt}` }] });
}

/** 현재 코드 + 지시로 부분 수정 */
export function editDiagram({ apiKey, model, code, instruction }) {
  return call({ apiKey, model, messages: [{ role: 'user', content: `현재 Mermaid 코드:\n${code}\n\n수정 요청: ${instruction}` }] });
}

/** 파서 오류를 붙여 1회 자동 수정 (이전 요청 + 잘못된 응답 + 오류 메시지를 이어서 보냄) */
export function fixDiagram({ apiKey, model, request, badCode, error }) {
  return call({
    apiKey, model,
    messages: [
      { role: 'user', content: request },
      { role: 'assistant', content: badCode },
      { role: 'user', content: `이 코드를 Mermaid가 해석하지 못했습니다.\n오류: ${error}\n오류를 고친 전체 코드를 다시 출력하세요.` },
    ],
  });
}

export function requestText(kind, prompt) { return `${KIND_HINT[kind] || ''}${prompt}`; }
