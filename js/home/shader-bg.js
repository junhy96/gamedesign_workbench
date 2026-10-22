// 첫 화면(홈) 배경: Shaders(WebGPU) 라이브러리로 히어로 뒤에 레이어 세 장을 깐다.
//   1 MeshGradient     탄색 메시 그라데이션이 시간에 따라 흐른다(speed·drift). swirl 은 커서 X에 연결해 마우스를 따라 살짝 비틀린다
//   2 WaveDistortion   앞 레이어(메시)를 잔잔한 사인파로 일렁이게 한다. 세기는 천천히 숨 쉬듯 오르내림(auto-animate)
//   3 CursorTrail      커서를 따라오는 부드러운 잔광 (screen 블렌드, 다크) / 어두운 탄색 (multiply, 라이트). 물결 위에 그려져 흔들리지 않는다
// - npm 설치·번들러 없이 CDN ESM 번들을 홈이 보일 때만 늦게 불러온다 (약 2.6MB, 도구 화면에는 영향 없음)
// - 텔레메트리는 끈다 (사이트 약속: 서버 전송 없음). 마우스 추적은 라이브러리가 window 에서 하므로 캔버스가 뒤에 있어도 된다
// - 색은 CSS 토큰(--bg, --key-1..3, --glow)에서 읽어, 테마 전환 때 레이어별로 다시 넣는다
// - WebGPU 없는 브라우저·움직임 줄이기 설정이면 켜지 않고, 실패하면 캔버스를 숨겨 기존 CSS 배경만 남긴다
// 라이브러리: https://github.com/shader-effects-inc/shaders (MIT) · 가이드: https://shaders.com/docs/guide
const CDN = 'https://cdn.jsdelivr.net/npm/shaders@4.0.5/dist/js/bundle.js';
const ID = { mesh: 'hm-mesh', wave: 'hm-wave', trail: 'hm-trail' };

// 레이어 켜고 끄기·세기 조절은 여기서 (visible:false 면 비용 0)
const FX = {
  mesh:  { visible: true,  speed: 1.0, drift: 0.7, swirlReach: 0.3 },   // speed: 그라데이션이 흐르는 빠르기, swirlReach: 커서 좌우 끝에서 swirl ±값
  wave:  { visible: true,  strengthMin: 0.05, strengthMax: 0.14, frequency: 1.6, speed: 0.25 },   // 물결: 세기 범위(숨 쉬듯 오르내림)·파수·빠르기
  trail: { visible: true,  radius: 0.9, length: 0.6 },
};

let shader = null;
let started = false;

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const hex6 = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c.slice(1) : null);
// 두 hex 색을 t 비율로 섞는다 (sRGB 단순 보간). 토큰이 hex가 아니면 첫 색을 그대로
function mix(a, b, t) {
  const A = hex6(a), B = hex6(b);
  if (!A || !B) return a;
  const ch = (i) => Math.round(parseInt(A.slice(i, i + 2), 16) * (1 - t) + parseInt(B.slice(i, i + 2), 16) * t);
  return '#' + [0, 2, 4].map((i) => ch(i).toString(16).padStart(2, '0')).join('');
}

// 테마(토큰)에 따라 달라지는 속성만 모아 레이어별로 돌려준다. 처음 만들 때와 테마 전환 때 같은 함수를 쓴다
function themeProps() {
  const dark = document.documentElement.dataset.theme !== 'light';
  const bg = cssVar('--bg') || (dark ? '#0b0b0a' : '#f1f0ec');
  const k1 = cssVar('--key-1') || '#f2d3a8', k2 = cssVar('--key-2') || '#d8a272', k3 = cssVar('--key-3') || '#9c5d2d';
  const glow = cssVar('--glow') || '#f4e24a';
  return {
    // 바탕색이 대부분을 차지하고 키 색이 군데군데 흐르도록: 앞쪽 절반은 바탕에 가깝게
    [ID.mesh]: { stops: [
      { color: bg, position: 0 },
      { color: mix(bg, k3, 0.35), position: 0.38 },
      { color: k3, position: 0.66 },
      { color: k2, position: 0.86 },
      { color: k1, position: 1 },
    ] },
    [ID.trail]: dark
      ? { colorA: k2, colorB: mix(k1, glow, 0.5), blendMode: 'screen', opacity: 0.3 }
      : { colorA: k3, colorB: k2, blendMode: 'multiply', opacity: 0.2 },
  };
}

function components() {
  const t = themeProps();
  return [
    { type: 'MeshGradient', id: ID.mesh, props: {
      ...t[ID.mesh], visible: FX.mesh.visible,
      colorSpace: 'oklab', count: 5, smoothness: 3, variation: 0.25, drift: FX.mesh.drift, speed: FX.mesh.speed, seed: 7,
      // 커서 X → swirl: 왼쪽이면 한쪽으로, 오른쪽이면 반대로 천천히 따라 비틀린다
      swirl: { type: 'mouse', axis: 'x', outputMin: -FX.mesh.swirlReach, outputMax: FX.mesh.swirlReach, smoothing: 0.08 },
    } },
    // 효과 레이어: 형제로 두면 앞서 그린 레이어(메시)에만 걸린다. 뒤에 오는 잔광은 그대로
    { type: 'WaveDistortion', id: ID.wave, props: {
      visible: FX.wave.visible,
      waveType: 'sine', frequency: FX.wave.frequency, speed: FX.wave.speed, angle: 20, edges: 'mirror',
      strength: { type: 'auto-animate', mode: 'ping-pong', outputMin: FX.wave.strengthMin, outputMax: FX.wave.strengthMax, speed: 0.06, easing: 'sine' },
    } },
    { type: 'CursorTrail', id: ID.trail, props: {
      ...t[ID.trail], visible: FX.trail.visible,
      radius: FX.trail.radius, length: FX.trail.length, shrink: 1, softness: 0.85, colorSpace: 'oklab',
    } },
  ];
}

const idle = () => new Promise((r) => ('requestIdleCallback' in window ? requestIdleCallback(r, { timeout: 1500 }) : setTimeout(r, 300)));

export function initHomeShader() {
  if (started) return;
  const wrap = document.querySelector('#home .hm-bg');   // 크기·투명도는 감싼 div, 그리기는 안의 canvas
  const canvas = wrap?.querySelector('canvas');
  if (!canvas) return;
  if (!('gpu' in navigator)) return;                                   // WebGPU 없음: 번들도 받지 않음
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;  // 움직임 줄이기: 정적 배경 유지
  started = true;

  idle()
    .then(() => import(CDN))
    .then(async ({ createShader }) => {
      shader = await createShader(canvas, { components: components() }, {
        disableTelemetry: true,
        onReady: () => wrap.classList.add('on'),
        onError: (reason) => { wrap.classList.remove('on'); console.warn('[home shader]', reason); },   // 종료 오류(기기 손실 등): 캔버스를 다시 투명하게
      });
      document.addEventListener('themechange', () => {
        const t = themeProps();
        for (const id of Object.keys(t)) shader?.update(id, t[id]);
      });
      // 도구 화면으로 가면(#home 이 display:none) 렌더를 멈추고, 돌아오면 재개
      new MutationObserver(() => (document.body.classList.contains('home') ? shader?.resume() : shader?.pause()))
        .observe(document.body, { attributes: true, attributeFilter: ['class'] });
    })
    .catch(() => { wrap.classList.remove('on'); });
}
