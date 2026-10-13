// 자연어 다이어그램 — 화면: 설명 → Mermaid 코드 → 미리보기 → SVG/PNG/PPT 도형 내보내기
import { MODELS, createDiagram, editDiagram, fixDiagram, requestText } from './llm.js';
import { EXAMPLES } from './examples.js';
import { createDeck, renderSpecs, collectSvgShapes, fitShapes, FONT } from '../lib/pptx.js';
import { isDark, parseError, renderSvg, renderOffscreen as offscreen } from '../lib/mermaid.js';
import { h, store, encodeState, decodeState, downloadText, toast, debounce } from '../lib/util.js';

const SCHEMA = 1;
const STORE_KEY = 'diagram:v1';

let state, els = {}, apiKey = '', busy = false;
const save = debounce(() => store.set(STORE_KEY, state), 300);

function defaultState() { const ex = EXAMPLES[0]; return { v: SCHEMA, prompt: ex.prompt, kind: ex.kind, code: ex.code, model: MODELS[0][0], title: ex.label }; }
function hydrate(o) { return o && o.v === SCHEMA && typeof o.code === 'string' ? { ...defaultState(), ...o } : null; }
function readHash() { const m = location.hash.match(/^#diagram\?s=([\w-]+)/); return m ? hydrate(decodeState(m[1])) : null; }

// ── 진입점 ──────────────────────────────────────────────
export function mount(root) {
  state = readHash() || hydrate(store.get(STORE_KEY)) || defaultState();
  if (location.hash.startsWith('#diagram?')) history.replaceState(null, '', '#diagram');
  build(root);
  renderPreview();
  document.addEventListener('themechange', renderPreview);
  window.addEventListener('hashchange', () => { const st = readHash(); if (st) { state = st; history.replaceState(null, '', '#diagram'); syncInputs(); renderPreview(); } });
}

function build(root) {
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '자연어 다이어그램'),
        h('p', {}, 'UI 흐름, 상태 머신, 퀘스트 분기, 서버 시퀀스를 문장으로 설명하면 Mermaid 다이어그램으로 만듭니다. 코드를 직접 고치면 바로 미리보기에 반영되고, PowerPoint에서 편집할 수 있는 도형으로 내보낼 수 있습니다.'),
      ),
      h('div.tool-actions', {},
        els.pptBtn = h('button.btn.primary', { type: 'button', onclick: exportPptx, title: '편집 가능한 PowerPoint 도형(사각형·마름모·선·화살표·텍스트)으로 저장' }, 'PPT 도형으로 저장'),
        h('button.btn', { type: 'button', onclick: exportSvg }, 'SVG 저장'),
        h('button.btn', { type: 'button', onclick: exportPng }, 'PNG 저장'),
        h('button.btn', { type: 'button', onclick: copyShareLink }, '공유 링크'),
      ),
    ),
    h('div.layout', {},
      h('aside.settings.card', { 'aria-label': '설정' },
        h('div.field', {}, h('span', {}, '템플릿 (예시 불러오기)'),
          h('div.tpl-grid', {}, ...EXAMPLES.map(ex => h('button.btn.small', { type: 'button', onclick: () => loadExample(ex) }, ex.label)))),
        h('label.field', {}, h('span', {}, '설명'),
          els.prompt = h('textarea.prompt', { rows: 7, value: state.prompt, oninput: (e) => { state.prompt = e.target.value; save(); } })),
        h('label.field', {}, h('span', {}, '다이어그램 형식'),
          els.kind = h('select', { onchange: (e) => { state.kind = e.target.value; save(); } },
            ...[['auto', '자동 선택'], ['flowchart', '흐름도 (flowchart)'], ['state', '상태 머신 (stateDiagram)'], ['sequence', '시퀀스 (sequenceDiagram)']]
              .map(([v, l]) => h('option', { value: v, selected: v === state.kind }, l)))),
        h('div.option', {},
          h('span.group-title', {}, 'Claude API'),
          h('label.field', {}, h('span', {}, 'API 키'),
            h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-…', 'aria-label': 'Anthropic API 키', oninput: (e) => { apiKey = e.target.value.trim(); updateMode(); } })),
          h('label.field', {}, h('span', {}, '모델'),
            h('select', { onchange: (e) => { state.model = e.target.value; save(); } }, ...MODELS.map(([v, l]) => h('option', { value: v, selected: v === state.model }, l)))),
          els.modeNote = h('p.desc', {}),
        ),
        els.genBtn = h('button.btn.primary.block', { type: 'button', onclick: () => run('create') }, '다이어그램 만들기'),
        h('div.option', {},
          h('label.field', {}, h('span', {}, '수정 지시'),
            els.instr = h('input', { type: 'text', placeholder: '예: 경직 상태에 "피격 시 다시 경직" 전이 추가', onkeydown: (e) => { if (e.key === 'Enter') run('edit'); } })),
          els.editBtn = h('button.btn.block', { type: 'button', onclick: () => run('edit') }, '현재 다이어그램 수정'),
        ),
        els.status = h('p.gen-status', { role: 'status' }),
      ),
      h('div.results', {},
        h('div.card', {},
          h('div.card-head', {}, h('h2', {}, '미리보기'), els.previewHint = h('span.hint', {})),
          els.preview = h('div.diagram-preview', {}),
          els.previewErr = h('div.errors', { hidden: true }),
        ),
        h('div.card', {},
          h('div.card-head', {}, h('h2', {}, 'Mermaid 코드'), h('a.hint', { href: 'https://mermaid.js.org/intro/', target: '_blank', rel: 'noopener' }, 'Mermaid 문법 안내')),
          els.code = h('textarea.code', { spellcheck: 'false', value: state.code, rows: 16, 'aria-label': 'Mermaid 코드',
            oninput: (e) => { state.code = e.target.value; save(); schedulePreview(); } }),
        ),
      ),
    ),
  );
  updateMode();
}

function syncInputs() {
  els.prompt.value = state.prompt; els.code.value = state.code; els.kind.value = state.kind;
}

function updateMode() {
  els.modeNote.textContent = apiKey
    ? '키는 저장되지 않으며, 이 브라우저에서 Anthropic API로 직접 전송됩니다. 요금은 이 키의 계정에 청구됩니다.'
    : '키가 없으면 예시 모드로 동작합니다. 템플릿을 눌러 결과와 PPT 내보내기를 체험해 보세요. 키는 저장되지 않습니다.';
  els.genBtn.textContent = apiKey ? '다이어그램 만들기' : '다이어그램 만들기 (키 필요)';
}

function loadExample(ex) {
  Object.assign(state, { prompt: ex.prompt, kind: ex.kind, code: ex.code, title: ex.label });
  syncInputs(); save(); renderPreview();
  setStatus(`예시 "${ex.label}"을(를) 불러왔습니다.`);
}

function setStatus(msg, kind = '') { els.status.textContent = msg; els.status.className = `gen-status ${kind}`; }

// ── 생성·수정 ───────────────────────────────────────────
async function run(mode) {
  if (busy) return;
  if (!apiKey) { setStatus('API 키를 입력하면 직접 만들 수 있습니다. 지금은 템플릿 예시만 볼 수 있습니다.', 'warn'); return; }
  const instruction = els.instr.value.trim();
  if (mode === 'create' && !state.prompt.trim()) { setStatus('설명을 입력하세요.', 'warn'); return; }
  if (mode === 'edit' && !instruction) { setStatus('수정 지시를 입력하세요.', 'warn'); return; }
  busy = true; els.genBtn.disabled = els.editBtn.disabled = true;
  setStatus(mode === 'create' ? '만드는 중…' : '수정하는 중…');
  try {
    const request = mode === 'create' ? requestText(state.kind, state.prompt) : `현재 Mermaid 코드:\n${state.code}\n\n수정 요청: ${instruction}`;
    let out = mode === 'create'
      ? await createDiagram({ apiKey, model: state.model, prompt: state.prompt, kind: state.kind })
      : await editDiagram({ apiKey, model: state.model, code: state.code, instruction });
    let usage = { ...out.usage }, fixed = false;
    let err = await parseError(out.code);
    if (err) { // 문법 오류면 오류 메시지를 붙여 1회 자동 수정
      setStatus('문법 오류를 고치는 중…');
      const again = await fixDiagram({ apiKey, model: state.model, request, badCode: out.code, error: err });
      usage.input += again.usage.input; usage.output += again.usage.output;
      out = again; fixed = true;
      err = await parseError(out.code);
    }
    state.code = out.code;
    if (mode === 'create') state.title = state.prompt.split(/[.\n。]/)[0].slice(0, 40);
    if (mode === 'edit') els.instr.value = '';
    els.code.value = state.code; save();
    await renderPreview();
    const tokens = `입력 ${usage.input.toLocaleString()} · 출력 ${usage.output.toLocaleString()} 토큰`;
    setStatus(err ? `문법 오류가 남아 있습니다. 코드를 직접 고쳐 주세요. (${tokens})` : `${mode === 'create' ? '완성' : '수정 완료'}${fixed ? ' (문법 오류 1회 자동 수정)' : ''}${out.fellBack ? ' · 대체 모델 응답' : ''} · ${tokens}`, err ? 'warn' : 'ok');
  } catch (e) {
    setStatus(e.message, 'err');
  } finally {
    busy = false; els.genBtn.disabled = els.editBtn.disabled = false;
  }
}

// ── 미리보기 ────────────────────────────────────────────
const schedulePreview = debounce(() => renderPreview(), 300);
async function renderPreview() {
  const code = state.code.trim();
  if (!code) { els.preview.replaceChildren(h('p.muted', {}, '코드가 비어 있습니다.')); return; }
  els.previewHint.textContent = '그리는 중…';
  const err = await parseError(code).catch(e => e.message);
  if (err) {
    els.previewErr.replaceChildren(h('li', {}, `문법 오류: ${err}`)); els.previewErr.hidden = false;
    els.previewHint.textContent = '이전 결과 표시 중';
    return;
  }
  try {
    const { svg, latest } = await renderSvg(code, isDark());
    if (!latest()) return; // 더 최신 렌더가 있음
    els.preview.innerHTML = svg; // Mermaid(securityLevel: strict)가 정화한 SVG
    els.previewErr.hidden = true;
    els.previewHint.textContent = '코드를 고치면 바로 반영됩니다';
  } catch (e) {
    els.previewErr.replaceChildren(h('li', {}, `렌더 오류: ${e.message}`)); els.previewErr.hidden = false;
  }
}

// ── 내보내기 ────────────────────────────────────────────
async function renderOffscreen() {
  const r = await offscreen(state.code);
  renderPreview(); // 미리보기는 현재 테마로 되돌림
  return r;
}
const fileBase = () => (state.title || '다이어그램').replace(/[\\/:*?"<>|]/g, '_');

async function exportSvg() {
  try {
    const { svg, host } = await renderOffscreen();
    downloadText(`${fileBase()}.svg`, new XMLSerializer().serializeToString(svg), 'image/svg+xml');
    host.remove();
  } catch (e) { toast(e.message); }
}

async function exportPng() {
  try {
    const { svg, host } = await renderOffscreen();
    const w = +svg.getAttribute('width'), hgt = +svg.getAttribute('height');
    const scale = 2;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('이미지 변환에 실패했습니다.')); img.src = url; });
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.ceil(w * scale), height: Math.ceil(hgt * scale) });
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url); host.remove();
    canvas.toBlob((blob) => {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${fileBase()}.png` });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  } catch (e) { toast(e.message); }
}

async function exportPptx() {
  const btn = els.pptBtn, label = btn.textContent;
  btn.disabled = true; btn.textContent = '만드는 중…';
  try {
    const { svg, host } = await renderOffscreen();
    const specs = fitShapes(collectSvgShapes(svg), { x: 0.45, y: 1.15, w: 12.4, h: 5.95 });
    host.remove();
    if (!specs.length) throw new Error('변환할 도형이 없습니다.');
    const pptx = await createDeck(state.title || '다이어그램');
    const slide = pptx.addSlide();
    slide.addText(state.title || '다이어그램', { x: 0.45, y: 0.3, w: 12.4, h: 0.6, fontFace: FONT, fontSize: 22, bold: true, color: '1B1B1A', margin: 0 });
    renderSpecs(pptx, slide, specs);
    slide.addNotes(`Mermaid 원본 코드\n\n${state.code}`);
    await pptx.writeFile({ fileName: `${fileBase()}.pptx` });
    toast(`PowerPoint 파일을 저장했습니다 (도형 ${specs.length}개, 슬라이드 노트에 원본 코드)`);
  } catch (e) {
    toast(e.message || 'PowerPoint 파일을 만들지 못했습니다');
  } finally { btn.disabled = false; btn.textContent = label; }
}

async function copyShareLink() {
  const url = `${location.origin}${location.pathname}#diagram?s=${encodeState(state)}`;
  try { await navigator.clipboard.writeText(url); toast('공유 링크를 복사했습니다'); } catch { prompt('아래 링크를 복사하세요', url); }
}
