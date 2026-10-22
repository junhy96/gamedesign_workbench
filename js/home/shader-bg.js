// 전체 화면 배경(홈·도구 공통): Shaders(WebGPU) 라이브러리로 뷰포트 뒤에 레이어를 깐다. 유리 패널이 덮는 부분만 blur 로 번진다.
//   1 MeshGradient     차콜(회색) 메시 그라데이션이 시간에 따라 흐른다(speed·drift). swirl 은 커서 X에 연결해 마우스를 따라 살짝 비틀린다
//   2 WaveDistortion   앞 레이어(메시)를 잔잔한 사인파로 일렁이게 한다. 세기는 천천히 숨 쉬듯 오르내림(auto-animate)
//   3 Chrome ×2 + Blob 어둡고 반투명한 광택 입체: 검은 유광 정12면체(천천히 회전), 크롬 구, 출렁이는 어두운 구.
//                    뿌옇게 번지는 건 셰이더가 아니라 유리 창(.hm-glass 등)의 backdrop-filter 가 덮는 부분에서만 일어난다
//   4 CursorTrail      커서를 따라오는 부드러운 잔광 (screen 블렌드, 다크) / 어두운 탄색 (multiply, 라이트)
// - npm 설치·번들러 없이 CDN ESM 번들을 홈이 보일 때만 늦게 불러온다 (약 2.6MB, 도구 화면에는 영향 없음)
// - 텔레메트리는 끈다 (사이트 약속: 서버 전송 없음). 마우스 추적은 라이브러리가 window 에서 하므로 캔버스가 뒤에 있어도 된다
// - 색은 CSS 토큰(--bg, --key-1..3, --glow)에서 읽어, 테마 전환 때 레이어별로 다시 넣는다
// - WebGPU 없는 브라우저·움직임 줄이기 설정이면 켜지 않고, 실패하면 캔버스를 숨겨 기존 CSS 배경만 남긴다
// 라이브러리: https://github.com/shader-effects-inc/shaders (MIT) · 가이드: https://shaders.com/docs/guide
const CDN = 'https://cdn.jsdelivr.net/npm/shaders@4.0.5/dist/js/bundle.js';
const ID = { mesh: 'hm-mesh', wave: 'hm-wave', glow1: 'hm-glow1', glow2: 'hm-glow2', glow3: 'hm-glow3', ring: 'hm-ring', trail: 'hm-trail' };

// 레이어 켜고 끄기·세기 조절은 여기서 (visible:false 면 비용 0)
const FX = {
  mesh:  { visible: true,  speed: 1.0, drift: 0.7, swirlReach: 0.3 },   // speed: 그라데이션이 흐르는 빠르기, swirlReach: 커서 좌우 끝에서 swirl ±값
  wave:  { visible: true,  strengthMin: 0.05, strengthMax: 0.14, frequency: 1.6, speed: 0.25 },   // 물결: 세기 범위(숨 쉬듯 오르내림)·파수·빠르기
  // 정12면체(검은 유광)는 오른쪽(폰 목업 뒤). spinSpeed: 초당 회전수(0.06 ≈ 17초에 한 바퀴)
  ring:  { visible: true,  center: { x: 0.74, y: 0.42 }, scale: 0.85, spinSpeed: 0.06, opacity: 0.62 },
  // 빛 덩어리: 유리 뒤에서 부드럽게 번지는 보라·파랑 글로우 (레퍼런스 사진 색 그대로). 왼쪽 아래·오른쪽 아래·위
  glow:  { visible: true,  size: 0.6, opacity: 0.5 },
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
  const f1 = cssVar('--flow-1') || (dark ? '#1c1b1a' : '#e6e4df'), f2 = cssVar('--flow-2') || (dark ? '#2e2d2a' : '#d3d0c9'), f3 = cssVar('--flow-3') || (dark ? '#45423c' : '#b9b5ad');
  return {
    // 레퍼런스처럼 검정~차콜 그라데이션이 흐르도록: 바탕색 → 회색(--flow-1..3). 키 컬러(골드)는 커서 잔광에만 쓴다
    [ID.mesh]: { stops: [
      { color: bg, position: 0 },
      { color: f1, position: 0.3 },
      { color: f2, position: 0.62 },
      { color: f3, position: 0.86 },
      { color: mix(f3, k3, 0.18), position: 1 },
    ] },
    // 정12면체: 다크는 어두운 몸체에 밝은 반사, 라이트는 더 어두운 크롬 (흰색은 밝은 바탕에서 안 보임)
    [ID.ring]: dark ? { tint: '#4a4a52', warmColor: k1, coolColor: '#a9bccb' } : { tint: '#3a3a3e', warmColor: k3, coolColor: '#577489' },
    // 빛 덩어리: 레퍼런스 사진에서 샘플한 보라(#630d97)·짙은 보라(#390a5d)·라벤더(#6f53a5)·남색(#10144b). 다크는 screen 으로 더해 빛나게, 라이트는 파스텔로 옅게
    [ID.glow1]: dark ? { colorA: '#7a22c4', colorB: '#390a5d', blendMode: 'screen', opacity: FX.glow.opacity } : { colorA: '#b48ee0', colorB: '#e2d6f3', blendMode: 'normal', opacity: 0.3 },
    [ID.glow2]: dark ? { colorA: '#2b3fd0', colorB: '#10144b', blendMode: 'screen', opacity: FX.glow.opacity } : { colorA: '#8f9fe0', colorB: '#d8ddf3', blendMode: 'normal', opacity: 0.3 },
    [ID.glow3]: dark ? { colorA: '#9b63d8', colorB: '#4a2a80', blendMode: 'screen', opacity: FX.glow.opacity * 0.85 } : { colorA: '#c4a9e8', colorB: '#eadff6', blendMode: 'normal', opacity: 0.24 },
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
    // 빛 덩어리: Blob 을 아주 부드럽게(softness 1) 두면 사진처럼 번지는 색 구름이 된다. speed 로 천천히 출렁인다
    ...[[ID.glow1, { x: 0.2, y: 0.78 }, 1], [ID.glow2, { x: 0.9, y: 0.86 }, 2], [ID.glow3, { x: 0.56, y: 0.16 }, 3]].map(([id, center, seed]) => ({
      type: 'Blob', id, props: {
        ...t[id], visible: FX.glow.visible, center, size: FX.glow.size, deformation: 0.45, softness: 1, highlightIntensity: 0,
        speed: 0.25, seed, colorSpace: 'oklab',
      },
    })),
    // 검은 유광 정12면체. 회전은 라이브러리의 auto-animate 로(화면 평면). 위치는 고정값(mouse-position 은 마우스가 움직이기 전엔 값이 없어 안 그려짐)
    { type: 'Chrome', id: ID.ring, props: {
      ...t[ID.ring], visible: FX.ring.visible, opacity: FX.ring.opacity, scale: FX.ring.scale, center: FX.ring.center,
      environment: 1.25, envRotation: 20, softness: 0.25, spectral: 0.4, dispersion: 0.1, shadows: 0.75, curvature: 0.3, waviness: 0.04, speed: 0.3, edgeSoftness: 0.05,
      rotation: { type: 'auto-animate', mode: 'loop', outputMin: 0, outputMax: 360, speed: FX.ring.spinSpeed },
      shape: { type: 'dodecahedron3D', radius: 0.3, rotX: 24, rotY: 32, rotZ: 0 },
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
  const wrap = document.querySelector('.hm-bg');   // body 맨 앞의 고정 배경. 크기·투명도는 감싼 div, 그리기는 안의 canvas
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
      try { if (localStorage.getItem('planwb:debug') === '1') window.__bg = { shader, ID, FX }; } catch {}   // 디버그: 콘솔에서 레이어 속성을 바로 바꿔 볼 때
      document.addEventListener('themechange', () => {
        const t = themeProps();
        for (const id of Object.keys(t)) shader?.update(id, t[id]);
      });
    })
    .catch(() => { wrap.classList.remove('on'); });
}
