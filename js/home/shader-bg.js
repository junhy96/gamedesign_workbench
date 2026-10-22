// 첫 화면(홈) 배경: Shaders(WebGPU) 라이브러리의 MeshGradient 한 장을 히어로 뒤에 깐다.
// - npm 설치·번들러 없이 CDN ESM 번들을 홈이 보일 때만 늦게 불러온다 (약 2.6MB, 도구 화면에는 영향 없음)
// - 텔레메트리는 끈다 (사이트 약속: 서버 전송 없음)
// - 색은 CSS 토큰(--bg, --key-1..3)에서 읽어, 테마 전환 때 색만 다시 넣는다
// - WebGPU 없는 브라우저·움직임 줄이기 설정이면 켜지 않고, 실패하면 캔버스를 숨겨 기존 CSS 배경만 남긴다
// 라이브러리: https://github.com/shader-effects-inc/shaders (MIT)
const CDN = 'https://cdn.jsdelivr.net/npm/shaders@4.0.5/dist/js/bundle.js';
const ID = 'hm-mesh';

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

// 바탕색이 대부분을 차지하고 키 색(탄색 그라데이션)이 군데군데 흐르도록: 앞쪽 절반은 바탕에 가깝게
function themeProps() {
  const bg = cssVar('--bg') || '#0b0b0a';
  const k1 = cssVar('--key-1') || '#f2d3a8', k2 = cssVar('--key-2') || '#d8a272', k3 = cssVar('--key-3') || '#9c5d2d';
  return {
    stops: [
      { color: bg, position: 0 },
      { color: mix(bg, k3, 0.35), position: 0.38 },
      { color: k3, position: 0.66 },
      { color: k2, position: 0.86 },
      { color: k1, position: 1 },
    ],
  };
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
      shader = await createShader(canvas, {
        components: [{
          type: 'MeshGradient', id: ID,
          props: { ...themeProps(), colorSpace: 'oklab', count: 5, smoothness: 3, variation: 0.25, swirl: 0.2, drift: 0.55, speed: 0.35, seed: 7 },
        }],
      }, {
        disableTelemetry: true,
        onReady: () => wrap.classList.add('on'),
        onError: (reason) => { wrap.classList.remove('on'); console.warn('[home shader]', reason); },   // 종료 오류(기기 손실 등): 캔버스를 다시 투명하게
      });
      document.addEventListener('themechange', () => shader?.update(ID, themeProps()));
      // 도구 화면으로 가면(#home 이 display:none) 렌더를 멈추고, 돌아오면 재개
      new MutationObserver(() => (document.body.classList.contains('home') ? shader?.resume() : shader?.pause()))
        .observe(document.body, { attributes: true, attributeFilter: ['class'] });
    })
    .catch(() => { wrap.classList.remove('on'); });
}
