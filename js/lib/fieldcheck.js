// 입력 검증 — 숫자 칸에 범위 밖 값(확률 0% 미만·100% 초과, 음수 등)이나 숫자가 아닌 값을 넣으면
// 그 칸을 빨갛게 표시하고 이유를 말풍선(title)으로 보여 준다. 화면 코드가 이미 달아 둔 min·max를 쓰고,
// 확률 칸(라벨에 '확률' 또는 '%')은 max가 없어도 100을 상한으로 본다. 탭이 다시 그려져도 자동으로 붙는다.
// 확률 합계·ID 참조처럼 여러 칸에 걸친 검사는 각 도구의 오류 목록과 데이터 테이블 검증이 맡는다.

const SEL = 'input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]';

/** 값 하나 검사 → 오류 문구 (문제 없으면 '') */
export function checkValue(raw, { min, max, prob = false, label = '' } = {}) {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  if (s === '' || s === '-') return '';
  const v = Number(s);
  if (!Number.isFinite(v)) return `${label ? label + ': ' : ''}숫자가 아닙니다`;
  const hi = max ?? (prob ? 100 : null);
  if (min != null && v < min) return `${label ? label + ': ' : ''}${min} 이상이어야 합니다${min === 0 ? ' (음수 불가)' : ''}`;
  if (hi != null && v > hi) return `${label ? label + ': ' : ''}${hi} 이하여야 합니다${prob && max == null ? ' (확률은 100% 이하)' : ''}`;
  return '';
}

const num = (x) => (x === '' || x == null ? null : Number(x));
const isProb = (el) => /확률|%/.test(el.getAttribute('aria-label') || '') && !/증가|감소|배율|보너스/.test(el.getAttribute('aria-label') || '');

function check(el) {
  const label = el.getAttribute('aria-label') || '';
  const msg = checkValue(el.value, { min: num(el.getAttribute('min')), max: num(el.getAttribute('max')), prob: isProb(el), label });
  el.classList.toggle('field-bad', !!msg);
  if (msg) { el.setAttribute('aria-invalid', 'true'); el.title = msg; }
  else if (el.getAttribute('aria-invalid')) { el.removeAttribute('aria-invalid'); el.removeAttribute('title'); }
}

export function installFieldChecks(root) {
  root.addEventListener('input', (e) => { if (e.target.matches?.(SEL)) check(e.target); });
  let pending = false;
  const scan = () => { pending = false; root.querySelectorAll(SEL).forEach(check); };
  new MutationObserver(() => { if (!pending) { pending = true; setTimeout(scan, 0); } }).observe(root, { childList: true, subtree: true });
  scan();
}
