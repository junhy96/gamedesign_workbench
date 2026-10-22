// 다이어그램 — Claude Code 의 diagram-design 플러그인(cathrynlavery/diagram-design, MIT)으로 그리고 내보내는 도구.
// 브라우저는 PC 의 플러그인을 직접 못 부르므로, PC 에서 띄운 로컬 브리지(tools/diagram-bridge.mjs)를 통해 `claude -p` 를 실행한다.
// 브리지가 없으면 도구는 잠기고 설치 안내만 보인다(3초마다 다시 찾는다). 전에 쓰던 Mermaid·브라우저 API 호출은 제거했다.
import { h, store, downloadText, toast } from '../lib/util.js';

const REPO = 'https://github.com/cathrynlavery/diagram-design';
const BRIDGE_FILE = 'tools/diagram-bridge.mjs';
const STORE_KEY = 'diagram:v2';
const DEFAULT_BRIDGE = 'http://127.0.0.1:8787';

const EXAMPLES = [
  ['강화 상태 머신', '강화 시스템 상태 머신: 대기 → 강화 시도 → 성공(+1)/유지/하락(-1)/파괴. 파괴되면 +7 로 복구 후 대기로. 보조 아이템(파괴 방지·하락 방지)이 있으면 해당 전이를 막는 조건 표시.'],
  ['가챠 천장 흐름도', '가챠 1회 뽑기 흐름도: 뽑기 → 픽업 보장 카운터 확인 → 천장(90회) 도달이면 확정 → 아니면 확률 굴림 → 최고 등급이면 픽업 50/50 → 실패 시 다음 최고 등급 픽업 확정 플래그. 마일리지 적립 분기 포함.'],
  ['전투 턴 시퀀스', '턴제 전투 한 턴의 시퀀스: 플레이어 클라이언트 → 전투 서버 → 몬스터 AI. 공격 선언, 명중·치명 판정, 데미지 계산, 특성 발동(피격 시 회복), 결과 브로드캐스트 순서.'],
  ['성장 아키텍처', '레벨·경험치 성장 시스템 아키텍처: 경험치 공급원(퀘스트·전투·일일 보상) → 경험치 테이블 → 레벨업 → 보상 지급 → 스탯 재계산. 서버 권위 검증 지점 표시.'],
];
// 이 사이트 팔레트 — 체크하면 프롬프트에 브랜드 가이드로 붙는다
const BRAND = '브랜드 색: 골드 #d8a272, 샌드 #f2d3a8, 브론즈 #9c5d2d, 올리브 #aab070, 브라운 #b27a52, 스틸 #8ea3b4, 바탕 #0b0b0c, 패널 #1c1c1f. 글자는 밝은 회백색 #f2f2f1. 다크 바탕 위의 편집 디자인 느낌.';

let state, els = {}, health = null, pollTimer = null, result = null, busy = false;

function defaultState() { return { bridge: DEFAULT_BRIDGE, prompt: EXAMPLES[0][1], variant: 'dark', brand: true, fonts: 'system' }; }

export function mount(root) {
  state = { ...defaultState(), ...(store.get(STORE_KEY) || {}) };
  build(root);
  checkBridge();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkBridge(); });
}
const save = () => store.set(STORE_KEY, state);

function build(root) {
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '다이어그램'),
        h('p', {}, 'UI 흐름, 상태 머신, 퀘스트 분기, 서버 시퀀스를 문장으로 적으면 Claude Code 의 diagram-design 플러그인이 편집 디자인 품질의 다이어그램(HTML+SVG)으로 그립니다. 이 PC 에서 브리지를 켜 두면 여기서 바로 그리고 HTML·SVG·PNG 로 내보냅니다.'),
        h('p.muted.small', {}, h('a', { href: REPO, target: '_blank', rel: 'noopener' }, 'cathrynlavery/diagram-design'), ' (MIT) · 그리기는 이 PC 의 Claude Code 가 수행하며 요금은 Claude 구독으로 나갑니다 · 설명 문장과 결과는 브라우저와 이 PC 사이에서만 오갑니다'),
      ),
      h('div.tool-actions', {},
        els.exportHtml = h('button.btn.primary', { type: 'button', disabled: true, onclick: () => exportFile('html') }, 'HTML 저장'),
        els.exportSvg = h('button.btn', { type: 'button', disabled: true, onclick: () => exportFile('svg') }, 'SVG 저장'),
        els.exportPng = h('button.btn', { type: 'button', disabled: true, onclick: () => exportFile('png') }, 'PNG 저장'),
      ),
    ),
    els.status = h('div.dg-status', {}),
    els.guide = h('div', { hidden: true }, guide()),
    els.tool = h('div.layout', { hidden: true },
      h('aside.settings.card', { 'aria-label': '설정' },
        h('div.field', {}, h('span', {}, '예시'),
          h('div.tpl-grid', {}, ...EXAMPLES.map(([label, text]) => h('button.btn.small', { type: 'button', onclick: () => { state.prompt = text; els.prompt.value = text; save(); } }, label)))),
        h('label.field', {}, h('span', {}, '무엇을 그릴까요'),
          els.prompt = h('textarea.prompt', { rows: 8, value: state.prompt, placeholder: '예: 강화 시스템 상태 머신, 가챠 천장 흐름도, 전투 턴 시퀀스…', oninput: (e) => { state.prompt = e.target.value; save(); } })),
        h('div.row2', {},
          h('label.field', {}, h('span', {}, '변형'),
            h('select', { onchange: (e) => { state.variant = e.target.value; save(); } },
              ...[['dark', '다크'], ['light', '라이트'], ['editorial', '편집 디자인(풀)']].map(([v, l]) => h('option', { value: v, selected: v === state.variant }, l)))),
          h('label.field', {}, h('span', {}, '서체'),
            h('select', { onchange: (e) => { state.fonts = e.target.value; save(); } },
              ...[['system', '시스템 서체 (오프라인)'], ['google', 'Google Fonts']].map(([v, l]) => h('option', { value: v, selected: v === state.fonts }, l))))),
        h('label.switch', {}, h('span', {}, '이 사이트 팔레트로'), h('input', { type: 'checkbox', checked: state.brand, onchange: (e) => { state.brand = e.target.checked; save(); } })),
        h('p.desc', {}, '골드·올리브·브라운·차콜 팔레트를 브랜드 가이드로 함께 보냅니다.'),
        els.drawBtn = h('button.btn.primary.block', { type: 'button', onclick: drawDiagram }, '그리기'),
        els.progress = h('p.gen-status', {}),
        h('div.option', {},
          h('span.group-title', {}, '브리지'),
          h('label.field', {}, h('span', {}, '주소'),
            h('input', { type: 'text', value: state.bridge, spellcheck: 'false', onchange: (e) => { state.bridge = e.target.value.trim() || DEFAULT_BRIDGE; save(); checkBridge(); } })),
          els.bridgeInfo = h('p.desc', {})),
      ),
      h('div.results', {},
        h('div.card.role-out', {},
          h('div.card-head', {}, h('h2', {}, '미리보기'), els.previewHint = h('span.hint', {}, '그리면 여기에 나옵니다 · 플러그인이 만든 .html 파일을 끌어다 놓아도 열립니다')),
          h('div.dg-stage', { ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }, ondragleave: (e) => e.currentTarget.classList.remove('over'),
            ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); const f = e.dataTransfer.files?.[0]; if (f) openFile(f); } },
            els.empty = h('div.dg-empty', {}, h('p', {}, '아직 그린 다이어그램이 없습니다.'), h('label.btn.small', {}, '파일 열기', h('input', { type: 'file', accept: '.html,.htm', hidden: true, onchange: (e) => { const f = e.target.files?.[0]; if (f) openFile(f); } }))),
            // sandbox: 스크립트 없이 보기만. 플러그인 결과는 정적 SVG 라 충분
            els.frame = h('iframe.dg-frame', { sandbox: '', title: '다이어그램 미리보기', hidden: true })),
        ),
      ),
    ),
  );
}

// ── 브리지 감지 ─────────────────────────────────────────
async function checkBridge() {
  const url = state.bridge.replace(/\/$/, '');
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`${url}/health`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    health = r.ok ? await r.json() : null;
  } catch { health = null; }
  render();
  // 브리지가 없으면 3초마다 다시 찾고(켜는 순간 도구가 열리도록), 있으면 15초마다 살아 있는지 본다
  clearTimeout(pollTimer);
  pollTimer = setTimeout(checkBridge, health ? 15000 : 3000);
}

function render() {
  const on = !!health?.ok;
  els.guide.hidden = on;
  els.tool.hidden = !on;
  if (!on) {
    els.status.replaceChildren(h('div.dg-banner.off', {}, h('b', {}, '브리지가 꺼져 있습니다'), h('span', {}, ` — 이 PC 에서 ${BRIDGE_FILE} 를 실행하면 자동으로 연결됩니다 (주소 ${state.bridge})`)));
    return;
  }
  const missing = [!health.claude && 'Claude Code', health.skill === false && 'diagram-design 플러그인'].filter(Boolean);
  els.status.replaceChildren(missing.length
    ? h('div.dg-banner.warn', {}, h('b', {}, '브리지 연결됨, 준비 안 됨'), h('span', {}, ` — ${missing.join('·')} 를 찾지 못했습니다. 아래 안내대로 설치한 뒤 브리지를 다시 켜세요.`))
    : h('div.dg-banner.on', {}, h('b', {}, '브리지 연결됨'), h('span', {}, ` — Claude Code ${health.claude} · diagram-design 설치됨`)));
  els.bridgeInfo.textContent = `v${health.version} · Claude Code ${health.claude || '없음'} · 플러그인 ${health.skill ? '있음' : health.skill === false ? '없음' : '확인 불가'}`;
  els.drawBtn.disabled = !!missing.length || busy;
  if (missing.length) { els.guide.hidden = false; }
}

// ── 그리기 ──────────────────────────────────────────────
async function drawDiagram() {
  if (busy) return;
  const prompt = state.prompt.trim();
  if (!prompt) { toast('무엇을 그릴지 적어 주세요'); return; }
  busy = true; els.drawBtn.disabled = true; els.drawBtn.textContent = '그리는 중…';
  const t0 = Date.now();
  const tick = setInterval(() => { els.progress.textContent = `Claude Code 가 그리는 중 · ${Math.round((Date.now() - t0) / 1000)}초 (보통 30초~2분)`; }, 500);
  els.progress.className = 'gen-status';
  try {
    const r = await fetch(`${state.bridge.replace(/\/$/, '')}/diagram`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, variant: state.variant, brand: state.brand ? BRAND : '', fonts: state.fonts }),
    });
    const data = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    if (!data.ok) throw new Error(data.error || `HTTP ${r.status}`);
    showResult(data.html, `diagram-${new Date().toISOString().slice(0, 10)}.html`);
    els.progress.className = 'gen-status ok'; els.progress.textContent = `완료 · ${Math.round((Date.now() - t0) / 1000)}초`;
  } catch (e) {
    els.progress.className = 'gen-status err'; els.progress.textContent = `실패: ${e.message}`;
    if (/Failed to fetch|NetworkError/.test(e.message)) checkBridge();
  } finally {
    clearInterval(tick); busy = false; els.drawBtn.disabled = false; els.drawBtn.textContent = '그리기';
  }
}

function showResult(html, name) {
  result = { html, name };
  els.frame.srcdoc = html;
  els.frame.hidden = false; els.empty.hidden = true;
  els.previewHint.textContent = name;
  for (const b of [els.exportHtml, els.exportSvg, els.exportPng]) b.disabled = false;
}

function openFile(file) {
  if (!/\.html?$/i.test(file.name)) { toast('.html 파일만 열 수 있습니다'); return; }
  const reader = new FileReader();
  reader.onload = () => showResult(String(reader.result), file.name);
  reader.readAsText(file);
}

// ── 내보내기: HTML 그대로 / SVG(페이지 <style> 을 안에 넣어 단독 파일로) / PNG(2배) ──────
function standaloneSvg() {
  const doc = new DOMParser().parseFromString(result.html, 'text/html');
  const svg = doc.querySelector('svg');
  if (!svg) return null;
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!clone.getAttribute('width') && clone.viewBox?.baseVal?.width) { clone.setAttribute('width', clone.viewBox.baseVal.width); clone.setAttribute('height', clone.viewBox.baseVal.height); }
  if (css) { const st = doc.createElementNS('http://www.w3.org/2000/svg', 'style'); st.textContent = css; clone.prepend(st); }   // :root 는 SVG 에서 <svg> 와 같으므로 CSS 변수도 산다
  // 바탕색: 페이지 body 배경을 사각형으로 깔아 투명 PNG 가 되지 않게
  const bg = doc.body?.style?.background || doc.body?.getAttribute('style') || '';
  return { text: new XMLSerializer().serializeToString(clone), w: clone.viewBox?.baseVal?.width || +clone.getAttribute('width') || 1600, h: clone.viewBox?.baseVal?.height || +clone.getAttribute('height') || 900, bg };
}

async function exportFile(kind) {
  if (!result) return;
  const base = result.name.replace(/\.html?$/i, '');
  if (kind === 'html') { downloadText(`${base}.html`, result.html, 'text/html'); return; }
  const svg = standaloneSvg();
  if (!svg) { toast('결과 안에서 SVG 를 찾지 못했습니다 — HTML 저장을 쓰세요'); return; }
  if (kind === 'svg') { downloadText(`${base}.svg`, svg.text, 'image/svg+xml'); return; }
  try {
    const url = URL.createObjectURL(new Blob([svg.text], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('SVG 를 그릴 수 없습니다 (외부 서체·이미지 참조)')); img.src = url; });
    const scale = 2, canvas = document.createElement('canvas');
    canvas.width = Math.round(svg.w * scale); canvas.height = Math.round(svg.h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b0b0c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const a = document.createElement('a'); a.download = `${base}@2x.png`; a.href = canvas.toDataURL('image/png'); a.click();
  } catch (e) { toast(e.message); }
}

// ── 설치 안내 (브리지가 없거나 준비가 안 됐을 때) ────────────────
const CMDS = {
  claude: ['claude --version'],
  plugin: ['/plugin marketplace add cathrynlavery/diagram-design', '/plugin install diagram-design@diagram-design'],
  bridge: [`node ${BRIDGE_FILE}`],
};
function guide() {
  const step = (n, title, desc, cmds) => h('li.dg-step', {},
    h('div.dg-step-head', {}, h('span.dg-num', {}, String(n)), h('b', {}, title)),
    h('p', {}, desc),
    h('div.dg-cmds', {}, ...cmds.map((c) => h('div.dg-cmd', {}, h('code', {}, c), h('button.mini-btn', { type: 'button', onclick: () => copy(c) }, '복사')))));
  return h('div.card.role-tool', {},
    h('div.card-head', {}, h('h2', {}, '이 PC 에서 쓰려면 (한 번만)'), h('span.hint', {}, '세 단계가 끝나고 브리지 창이 켜져 있으면 이 페이지가 자동으로 도구로 바뀝니다')),
    h('ol.dg-steps', {},
      step(1, 'Claude Code 설치·로그인', '터미널에서 아래 명령이 버전을 출력하면 준비된 것입니다. 없으면 claude.com/claude-code 에서 설치하고 claude 를 한 번 실행해 로그인합니다.', CMDS.claude),
      step(2, 'diagram-design 플러그인 설치', 'Claude Code 안에서 두 줄을 차례로 입력합니다. 45종 다이어그램을 라이트·다크·편집 디자인으로 그리는 스킬이 설치됩니다.', CMDS.plugin),
      step(3, '브리지 실행', h('span', {}, '이 저장소를 받은 폴더(또는 ', h('a', { href: BRIDGE_FILE, download: 'diagram-bridge.mjs' }, '이 파일 하나'), '를 내려받은 폴더)에서 실행합니다. 127.0.0.1 에서만 듣고 이 사이트의 요청만 받습니다. 창을 켜 둔 채 이 페이지로 돌아오면 됩니다.'), CMDS.bridge),
    ),
    h('p.muted.small', {}, '브리지는 그릴 때마다 빈 임시 폴더에서 claude -p 를 권한 확인 없이 실행합니다. 신뢰하는 PC 에서만 켜고, 다 쓰면 Ctrl+C 로 끄세요.'),
  );
}
function copy(text) { navigator.clipboard?.writeText(text).then(() => toast('복사했습니다'), () => toast('복사하지 못했습니다')); }
