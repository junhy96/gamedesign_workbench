// 자연어 다이어그램 — 화면: 설명 → Mermaid 코드 → 미리보기 → SVG/PNG/PPT 도형 내보내기
import { MODELS, createDiagram, editDiagram, fixDiagram, requestText } from './llm.js';
import { EXAMPLES } from './examples.js';
import { createDeck, renderSpecs, collectSvgShapes, fitShapes, FONT } from '../lib/pptx.js';
import { isDark, parseError, renderSvg, renderOffscreen as offscreen, loadMermaid } from '../lib/mermaid.js';
import { CATS, PALETTES, DEFAULT_STYLE, analyze, styledCode, legendItems, shapeIcon } from './style.js';
import { h, store, encodeState, decodeState, downloadText, toast, debounce } from '../lib/util.js';

const SCHEMA = 1;
const STORE_KEY = 'diagram:v1';

let state, els = {}, apiKey = '', busy = false;
const save = debounce(() => store.set(STORE_KEY, state), 300);

function defaultState() { const ex = EXAMPLES[0]; return { v: SCHEMA, prompt: ex.prompt, kind: ex.kind, code: ex.code, model: MODELS[0][0], title: ex.label, style: { ...DEFAULT_STYLE } }; }
function hydrate(o) { return o && o.v === SCHEMA && typeof o.code === 'string' ? { ...defaultState(), ...o, style: { ...DEFAULT_STYLE, ...(o.style || {}) } } : null; }
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
        els.styleBox = h('div.option.style-box', {}),
      ),
      h('div.results', {},
        h('div.card', {},
          h('div.card-head', {}, h('h2', {}, '미리보기'), els.previewHint = h('span.hint', {})),
          els.legend = h('div.dg-legend', { hidden: true }),
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
  renderStyleBox();
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

// ── 스타일 설정 ─────────────────────────────────────────
function renderStyleBox() {
  const st = state.style;
  const set = (k, v, rerender = false) => { st[k] = v; save(); if (rerender) renderStyleBox(); schedulePreview(); };
  const sel = (label, key, options, hint) => h('label.field', {}, h('span', {}, label),
    h('select', { onchange: (e) => set(key, isNaN(+e.target.value) || e.target.value === '' ? e.target.value : +e.target.value) },
      ...options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(st[key]) }, l))), hint ? h('small', {}, hint) : null);
  const sw = (label, key) => h('label.switch', {}, label, h('input', { type: 'checkbox', checked: !!st[key], onchange: (e) => set(key, e.target.checked, true) }));
  els.styleBox.replaceChildren(...[
    h('span.group-title', {}, '스타일 설정'),
    sel('색상', 'palette', Object.entries(PALETTES).map(([k, p]) => [k, p.label])),
    h('div.row2', {},
      sel('방향', 'direction', [['auto', '코드대로'], ['TD', '위 → 아래'], ['LR', '왼쪽 → 오른쪽'], ['BT', '아래 → 위'], ['RL', '오른쪽 → 왼쪽']]),
      sel('선 모양', 'curve', [['basis', '곡선'], ['linear', '직선'], ['stepAfter', '계단 (직각)']])),
    h('div.row2', {},
      sel('간격', 'spacing', [['tight', '좁게'], ['normal', '보통'], ['wide', '넓게']]),
      sel('글자 크기', 'fontSize', [[12, '12'], [14, '14 (기본)'], [16, '16'], [18, '18']])),
    sw('아니오 · 없음 분기를 빨간 선으로', 'negRed'),
    st.negRed ? h('label.field', {}, h('span', {}, '빨간 선으로 칠할 라벨'), h('input', { type: 'text', value: st.negWords, oninput: (e) => set('negWords', e.target.value) }), h('small', {}, '쉼표로 구분 · 라벨이 이 단어로 시작하면 적용 (예: "아니오 (재시도)")')) : null,
    sw('예 · 있음 분기를 초록 선으로', 'posGreen'),
    st.posGreen ? h('label.field', {}, h('span', {}, '초록 선으로 칠할 라벨'), h('input', { type: 'text', value: st.posWords, oninput: (e) => set('posWords', e.target.value) })) : null,
    sw('범례(INDEX) 표시 · PPT 상단에 포함', 'legend'),
    h('details.syntax-help', {},
      h('summary', {}, '블록 종류와 Mermaid 모양'),
      h('ul', {}, ...Object.entries(CATS).filter(([k]) => k !== 'state').map(([k, c]) => {
        const col = (PALETTES.type.light)[k];
        return h('li', {}, h('span.icon', { html: shapeIcon(k, col.fill, col.stroke) }), h('b', {}, c.label), h('code', {}, c.syntax));
      })),
      h('p.desc', {}, '블록 모양으로 종류를 나눕니다. AI에게 만들게 하면 이 규칙대로 모양을 고르고, 코드를 직접 고칠 때도 모양만 바꾸면 색과 범례가 따라 바뀝니다.'),
    ),
  ].filter(Boolean));
}

const renderOpts = () => ({ curve: state.style.curve, spacing: state.style.spacing, fontSize: state.style.fontSize });

/** 원본 코드 → 분석 결과와 그릴 코드 */
async function prepare(code, dark) {
  const m = await loadMermaid();
  const an = await analyze(m, code).catch(() => ({ kind: 'unknown', nodes: [], edges: [] }));
  return { an, code: styledCode(code, an, state.style, dark) };
}

function renderLegend(an, dark) {
  const items = state.style.legend ? legendItems(an, state.style, dark) : [];
  els.legend.hidden = !items.length;
  els.legend.replaceChildren(...(items.length ? [h('span.dg-legend-title', {}, 'INDEX'), ...items.map(it => h('span.dg-legend-item', {},
    it.kind === 'block'
      ? h('span.icon', { html: shapeIcon(it.cat, it.fill, it.stroke) })
      : h('span.icon', { html: `<svg viewBox="0 0 32 20" width="32" height="20" aria-hidden="true"><path d="M2 10h24" stroke="${it.stroke}" stroke-width="2.4"/><path d="M24 6l6 4-6 4z" fill="${it.stroke}"/></svg>` }),
    it.label))] : []));
}

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
    const dark = isDark();
    const prep = await prepare(code, dark);
    const { svg, latest } = await renderSvg(prep.code, dark, renderOpts());
    if (!latest()) return; // 더 최신 렌더가 있음
    els.preview.innerHTML = svg; // Mermaid(securityLevel: strict)가 정화한 SVG
    renderLegend(prep.an, dark);
    els.previewErr.hidden = true;
    els.previewHint.textContent = '코드를 고치면 바로 반영됩니다';
  } catch (e) {
    els.previewErr.replaceChildren(h('li', {}, `렌더 오류: ${e.message}`)); els.previewErr.hidden = false;
  }
}

// ── 내보내기 ────────────────────────────────────────────
async function renderOffscreen() {
  const err = await parseError(state.code);
  if (err) throw new Error('문법 오류를 먼저 고쳐 주세요.');
  const prep = await prepare(state.code, false);
  const r = await offscreen(prep.code, renderOpts());
  renderPreview(); // 미리보기는 현재 테마로 되돌림
  return { ...r, an: prep.an };
}
const fileBase = () => (state.title || '다이어그램').replace(/[\\/:*?"<>|]/g, '_');

/**
 * 내보내기용 SVG 문자열: 위에 범례(INDEX), 아래에 다이어그램. 범례가 꺼져 있거나 항목이 없으면 다이어그램만.
 * 다이어그램 SVG는 중첩 <svg>로 넣어 Mermaid가 만든 스타일(#id 범위)을 그대로 유지한다.
 */
function composeExport(svg, an) {
  const W0 = +svg.getAttribute('width'), H0 = +svg.getAttribute('height');
  const items = state.style.legend ? legendItems(an, state.style, false) : [];
  const xml = new XMLSerializer();
  if (!items.length) {
    return { text: `<svg xmlns="http://www.w3.org/2000/svg" width="${W0}" height="${H0}" viewBox="0 0 ${W0} ${H0}"><rect width="100%" height="100%" fill="#ffffff"/>${xml.serializeToString(svg)}</svg>`, w: W0, h: H0 };
  }
  const FONT_CSS = '"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif';
  const g = document.createElement('canvas').getContext('2d');
  g.font = `13px ${FONT_CSS}`;
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const PAD = 16, ROW = 28, ICON = 32, BADGE = 54;
  const W = Math.max(W0 + PAD * 2, 420);
  const parts = [];
  let x = PAD + BADGE + 14, row = 0;
  for (const it of items) {
    const w = ICON + 6 + Math.ceil(g.measureText(it.label).width) + 18;
    if (x + w > W - PAD && x > PAD + BADGE + 14) { row++; x = PAD + BADGE + 14; }
    const y = PAD + row * ROW;
    const icon = it.kind === 'block'
      ? shapeIcon(it.cat, it.fill, it.stroke)
      : `<svg viewBox="0 0 32 20" width="32" height="20"><path d="M2 10h24" stroke="${it.stroke}" stroke-width="2.4"/><path d="M24 6l6 4-6 4z" fill="${it.stroke}"/></svg>`;
    parts.push(icon.replace('<svg ', `<svg x="${x}" y="${y}" `).replace(' aria-hidden="true"', ''));
    parts.push(`<text x="${x + ICON + 6}" y="${y + 14.5}" font-size="13" fill="#3A3A38">${esc(it.label)}</text>`);
    x += w;
  }
  const legendH = PAD + (row + 1) * ROW + 6;
  const ox = Math.round((W - W0) / 2), oy = legendH + 12;
  svg.setAttribute('x', ox); svg.setAttribute('y', oy);
  const H = oy + H0 + PAD;
  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${FONT_CSS}'>`
    + `<rect width="100%" height="100%" fill="#ffffff"/>`
    + `<g><rect x="${PAD}" y="${PAD}" width="${BADGE}" height="20" rx="5" fill="#1B1B1A"/><text x="${PAD + BADGE / 2}" y="${PAD + 14.5}" font-size="11" font-weight="800" fill="#ffffff" text-anchor="middle" letter-spacing="0.6">INDEX</text>${parts.join('')}</g>`
    + `<line x1="${PAD}" y1="${legendH}" x2="${W - PAD}" y2="${legendH}" stroke="#D8D7D2"/>`
    + xml.serializeToString(svg) + '</svg>';
  return { text, w: W, h: H };
}

async function exportSvg() {
  try {
    const { svg, host, an } = await renderOffscreen();
    const out = composeExport(svg, an);
    host.remove();
    downloadText(`${fileBase()}.svg`, out.text, 'image/svg+xml');
  } catch (e) { toast(e.message); }
}

async function exportPng() {
  try {
    const { svg, host, an } = await renderOffscreen();
    const out = composeExport(svg, an);
    host.remove();
    const scale = 2;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([out.text], { type: 'image/svg+xml' }));
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('이미지 변환에 실패했습니다.')); img.src = url; });
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.ceil(out.w * scale), height: Math.ceil(out.h * scale) });
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      const el = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${fileBase()}.png` });
      document.body.append(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(el.href), 1000);
    }, 'image/png');
  } catch (e) { toast(e.message); }
}

async function exportPptx() {
  const btn = els.pptBtn, label = btn.textContent;
  btn.disabled = true; btn.textContent = '만드는 중…';
  try {
    const { svg, host, an } = await renderOffscreen();
    const legend = state.style.legend ? legendSpecs(legendItems(an, state.style, false), 0.98) : { specs: [], h: 0 };
    const top = 1.15 + (legend.h ? legend.h + 0.2 : 0);
    const specs = fitShapes(collectSvgShapes(svg), { x: 0.45, y: top, w: 12.4, h: 7.1 - top });
    host.remove();
    if (!specs.length) throw new Error('변환할 도형이 없습니다.');
    const pptx = await createDeck(state.title || '다이어그램');
    const slide = pptx.addSlide();
    slide.addText(state.title || '다이어그램', { x: 0.45, y: 0.3, w: 12.4, h: 0.6, fontFace: FONT, fontSize: 22, bold: true, color: '1B1B1A', margin: 0 });
    renderSpecs(pptx, slide, legend.specs);
    renderSpecs(pptx, slide, specs);
    slide.addNotes(`Mermaid 원본 코드\n\n${state.code}`);
    await pptx.writeFile({ fileName: `${fileBase()}.pptx` });
    toast(`PowerPoint 파일을 저장했습니다 (도형 ${specs.length}개, 슬라이드 노트에 원본 코드)`);
  } catch (e) {
    toast(e.message || 'PowerPoint 파일을 만들지 못했습니다');
  } finally { btn.disabled = false; btn.textContent = label; }
}

/** PPT 상단 범례(INDEX): 블록 종류는 PowerPoint 순서도 기본 도형, 분기 선은 화살표. 폭이 넘치면 다음 줄로 */
export { composeExport };

export function legendSpecs(items, y) {
  if (!items.length) return { specs: [], h: 0 };
  const specs = [];
  const X0 = 0.45, X1 = 12.85, ROW = 0.36, ICON_W = 0.46, ICON_H = 0.26;
  const textW = (t) => [...t].reduce((w, c) => w + (/[가-힣]/.test(c) ? 0.122 : 0.068), 0.08);
  specs.push({ type: 'roundRect', name: '범례 제목', x: X0, y, w: 0.72, h: 0.26, radius: 0.05, fill: '#1B1B1A', text: 'INDEX', fontSize: 9, bold: true, color: '#FFFFFF' });
  let x = X0 + 0.9, row = 0;
  for (const it of items) {
    const w = ICON_W + 0.1 + textW(it.label) + 0.24;
    if (x + w > X1) { row++; x = X0 + 0.9; }
    const yy = y + row * ROW;
    if (it.kind === 'block') specs.push({ type: 'preset', preset: CATS[it.cat].preset, name: `범례 ${it.label}`, x, y: yy, w: ICON_W, h: ICON_H, fill: it.fill, line: it.stroke, lineWidth: 1 });
    else specs.push({ type: 'line', name: `범례 ${it.label}`, x, y: yy + ICON_H / 2, w: ICON_W, h: 0, line: it.stroke, lineWidth: 2, arrowEnd: true });
    specs.push({ type: 'text', name: `범례 ${it.label} 글자`, text: it.label, x: x + ICON_W + 0.1, y: yy - 0.02, w: textW(it.label), h: 0.3, fontSize: 10.5, color: '#3A3A38' });
    x += w;
  }
  const h = (row + 1) * ROW;
  specs.push({ type: 'line', name: '범례 구분선', x: X0, y: y + h + 0.04, w: X1 - X0, h: 0, line: '#D8D7D2', lineWidth: 0.75 });
  return { specs, h: h + 0.05 };
}

async function copyShareLink() {
  const url = `${location.origin}${location.pathname}#diagram?s=${encodeState(state)}`;
  try { await navigator.clipboard.writeText(url); toast('공유 링크를 복사했습니다'); } catch { prompt('아래 링크를 복사하세요', url); }
}
