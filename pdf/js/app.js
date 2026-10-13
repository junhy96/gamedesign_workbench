// PDF 도구 — 도구 모음 화면과 도구별 흐름(업로드 → 옵션 → 처리 → 결과). 모든 처리는 브라우저 안에서.
import {
  compressPdf, mergePdfs, pageCount, applyEdits, renderThumbnails, keepAllPages,
  splitPdf, rotatePdf, cropPdf, pdfToImages, imagesToPdf, stampImage, editMetadata, readMetadata,
} from './ops.js';
import { readFile, formatBytes, downloadBytes, parseRanges, zipFiles } from './core.js';
import { h, toast, store } from '../../js/lib/util.js';

const POS = [['tl', '왼쪽 위'], ['tc', '가운데 위'], ['tr', '오른쪽 위'], ['cl', '왼쪽 가운데'], ['cc', '정가운데'], ['cr', '오른쪽 가운데'], ['bl', '왼쪽 아래'], ['bc', '가운데 아래'], ['br', '오른쪽 아래']];
const baseName = (name) => name.replace(/\.(pdf|jpe?g|png|webp|gif|bmp)$/i, '');

// ── 옵션 입력 헬퍼 ──────────────────────────────────────
const field = (label, input, hint) => h('label.field', {}, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
const select = (o, key, options) => h('select', { onchange: (e) => { o[key] = isNaN(+e.target.value) ? e.target.value : +e.target.value; } },
  ...options.map(([v, l]) => h('option', { value: v, selected: v === o[key] }, l)));
const number = (o, key, attrs = {}) => h('input', { type: 'number', value: o[key], ...attrs, oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) o[key] = v; } });
const text = (o, key, attrs = {}) => h('input', { type: 'text', value: o[key] ?? '', ...attrs, oninput: (e) => { o[key] = e.target.value; } });
const choice = (o, key, value, title, desc, onchange) => h('label.choice', {},
  h('input', { type: 'radio', name: key, value, checked: o[key] === value, onchange: () => { o[key] = value; onchange?.(); } }),
  h('span', {}, h('b', {}, title), desc ? h('span.muted.small', {}, desc) : null));

// ── 도구 정의 ───────────────────────────────────────────
// run(files, opts, progress) → [{name, bytes, type?}]
const TOOLS = [
  {
    id: 'merge', group: '구성', short: '합', title: 'PDF 합치기', desc: '여러 PDF를 원하는 순서로 하나로 합칩니다. 파일마다 필요한 쪽만 고를 수 있습니다.',
    multiple: true, perFileRange: true,
    run: async (files) => [{ name: '합친 문서.pdf', bytes: await mergePdfs(files.map(f => ({ bytes: f.bytes, range: f.range }))) }],
  },
  {
    id: 'split', group: '구성', short: '분', title: 'PDF 분할', desc: '쪽 범위별로 나누거나, 모든 쪽을 각각의 PDF로 만들거나, n쪽씩 자릅니다.',
    defaults: { mode: 'each', ranges: '1-3, 4-', every: 2 },
    options: (o) => {
      const r = h('div', {}); const sync = () => { r.replaceChildren(o.mode === 'ranges' ? field('쪽 범위 (쉼표로 파일 구분)', text(o, 'ranges'), '예: 1-3, 4-6, 7- → 파일 3개') : o.mode === 'every' ? field('몇 쪽씩', number(o, 'every', { min: 1 })) : ''); };
      sync();
      return [choice(o, 'mode', 'each', '모든 쪽을 따로', '쪽마다 PDF 하나', sync), choice(o, 'mode', 'ranges', '범위별로', '지정한 범위마다 PDF 하나', sync), choice(o, 'mode', 'every', '일정 쪽씩', 'n쪽 단위로 자르기', sync), r];
    },
    run: async ([f], o) => splitPdf(f.bytes, { ...o, base: baseName(f.name) }),
  },
  { id: 'organize', group: '구성', short: '구', title: 'PDF 구성', desc: '쪽 미리보기를 보면서 순서를 바꾸고, 지우고, 회전하고, 빈 쪽을 넣습니다.', custom: 'organize' },
  {
    id: 'rotate', group: '구성', short: '회', title: 'PDF 회전', desc: '모든 쪽 또는 원하는 쪽을 회전합니다. 여러 파일을 한꺼번에 처리할 수 있습니다.',
    multiple: true, defaults: { angle: 90, pages: 'all' },
    options: (o) => [field('방향', select(o, 'angle', [[90, '오른쪽으로 90°'], [180, '180°'], [270, '왼쪽으로 90°']])), field('대상 쪽', text(o, 'pages', { placeholder: 'all 또는 1-3, 5' }))],
    run: async (files, o) => Promise.all(files.map(async f => ({ name: `${baseName(f.name)}_회전.pdf`, bytes: await rotatePdf(f.bytes, o) }))),
  },
  {
    id: 'compress', group: '최적화', short: '압', title: 'PDF 압축', desc: '텍스트는 그대로 두고 내장 이미지를 다시 인코딩해 용량을 줄입니다. 더 줄여야 하면 쪽을 이미지로 바꿉니다.',
    defaults: { level: 'images', maxPx: 1600, quality: 0.7, dpi: 110, stripMeta: true },
    options: (o) => {
      const extra = h('div', {});
      const sync = () => extra.replaceChildren(...(o.level === 'images' ? [h('div.row2', {}, field('이미지 최대 크기', select(o, 'maxPx', [[1000, '1000px'], [1600, '1600px'], [2400, '2400px']])), field('품질', select(o, 'quality', [[0.5, '낮음'], [0.7, '보통'], [0.85, '높음']])))]
        : o.level === 'raster' ? [h('div.row2', {}, field('해상도', select(o, 'dpi', [[72, '72 dpi'], [110, '110 dpi'], [150, '150 dpi']])), field('품질', select(o, 'quality', [[0.5, '낮음'], [0.7, '보통'], [0.85, '높음']])))] : []));
      sync();
      return [
        choice(o, 'level', 'structure', '가벼운 압축 (무손실)', '구조 정리·메타데이터 제거. 화질 그대로', sync),
        choice(o, 'level', 'images', '권장 압축', '이미지 재압축. 텍스트 선택·검색 유지', sync),
        choice(o, 'level', 'raster', '강한 압축', '쪽을 이미지로 변환. 가장 작지만 텍스트 선택 불가', sync),
        extra,
        h('label.switch.inline', {}, h('input', { type: 'checkbox', checked: o.stripMeta, onchange: (e) => { o.stripMeta = e.target.checked; } }), '메타데이터 지우기'),
      ];
    },
    run: async ([f], o, progress) => { const r = await compressPdf(f.bytes, { ...o, onProgress: progress }); return [{ name: `${baseName(f.name)}_압축.pdf`, bytes: r.bytes, compare: f.bytes.length }]; },
  },
  {
    id: 'pdf2jpg', group: '변환', short: 'JPG', title: 'PDF → JPG', desc: '모든 쪽을 JPG(또는 PNG) 이미지로 바꿉니다. 여러 장이면 ZIP으로 받습니다.',
    defaults: { dpi: 150, format: 'jpeg', quality: 0.85 },
    options: (o) => [h('div.row2', {}, field('해상도', select(o, 'dpi', [[72, '72 dpi (화면)'], [150, '150 dpi (기본)'], [300, '300 dpi (인쇄)']])), field('형식', select(o, 'format', [['jpeg', 'JPG'], ['png', 'PNG']])))],
    run: async ([f], o, progress) => pdfToImages(f.bytes, { ...o, base: baseName(f.name), onProgress: progress }),
  },
  {
    id: 'jpg2pdf', group: '변환', short: 'PDF', title: 'JPG → PDF', desc: '이미지(JPG·PNG·WebP 등)를 순서대로 PDF로 만듭니다. 용지·방향·여백을 고를 수 있습니다.',
    accept: 'image', multiple: true, defaults: { pageSize: 'a4', orientation: 'auto', margin: 10 },
    options: (o) => [field('용지', select(o, 'pageSize', [['a4', 'A4'], ['letter', 'Letter'], ['fit', '이미지 크기 그대로']])), h('div.row2', {}, field('방향', select(o, 'orientation', [['auto', '자동'], ['portrait', '세로'], ['landscape', '가로']])), field('여백 (mm)', number(o, 'margin', { min: 0 })))],
    run: async (files, o) => [{ name: `${baseName(files[0].name)}${files.length > 1 ? ` 외 ${files.length - 1}개` : ''}.pdf`, bytes: await imagesToPdf(files.map(f => f.file), o) }],
  },
  { id: 'edit', group: '편집', short: '편', title: 'PDF 편집', desc: '문구와 이미지를 원하는 쪽·위치에 넣습니다. 한글 문구도 글꼴을 함께 넣어 깨지지 않습니다.', custom: 'edit' },
  {
    id: 'watermark', group: '편집', short: '워', title: '워터마크', desc: '모든 쪽에 문구를 반투명하게 넣습니다. 글자 크기·색·투명도·위치를 고릅니다.',
    defaults: { text: '대외비', size: 60, color: '#c03a39', opacity: 0.25, position: 'cc', pages: 'all' },
    options: (o) => [field('문구', text(o, 'text')), h('div.row3', {}, field('크기', number(o, 'size', { min: 6 })), field('색', h('input', { type: 'color', value: o.color, oninput: (e) => { o.color = e.target.value; } })), field('불투명도', number(o, 'opacity', { min: 0.05, max: 1, step: 0.05 }))), h('div.row2', {}, field('위치', select(o, 'position', POS)), field('대상 쪽', text(o, 'pages')))],
    run: async ([f], o) => [{ name: `${baseName(f.name)}_워터마크.pdf`, bytes: await applyEdits(f.bytes, { pages: await keepAllPages(f.bytes), texts: [o] }) }],
  },
  {
    id: 'pagenum', group: '편집', short: '번', title: '페이지 번호', desc: '쪽 번호를 원하는 위치와 형식으로 넣습니다. 예: 1 / 10, - 1 -',
    defaults: { format: '{n} / {total}', position: 'bc', size: 10 },
    options: (o) => [field('형식', text(o, 'format'), '{n} = 쪽 번호, {total} = 전체 쪽 수'), h('div.row2', {}, field('위치', select(o, 'position', POS)), field('크기', number(o, 'size', { min: 6 })))],
    run: async ([f], o) => [{ name: `${baseName(f.name)}_쪽번호.pdf`, bytes: await applyEdits(f.bytes, { pages: await keepAllPages(f.bytes), pageNumbers: { on: true, ...o } }) }],
  },
  { id: 'sign', group: '편집', short: '서', title: 'PDF 서명', desc: '직접 그린 서명이나 서명 이미지를 원하는 쪽과 위치에 넣습니다.', custom: 'sign' },
  {
    id: 'crop', group: '편집', short: '자', title: 'PDF 자르기', desc: '쪽의 여백을 잘라 보이는 영역을 줄입니다. 위·오른쪽·아래·왼쪽을 mm 단위로 지정합니다.',
    defaults: { top: 10, right: 10, bottom: 10, left: 10, pages: 'all' },
    options: (o) => [h('div.row2', {}, field('위 (mm)', number(o, 'top', { min: 0 })), field('아래 (mm)', number(o, 'bottom', { min: 0 }))), h('div.row2', {}, field('왼쪽 (mm)', number(o, 'left', { min: 0 })), field('오른쪽 (mm)', number(o, 'right', { min: 0 }))), field('대상 쪽', text(o, 'pages')), h('p.desc', {}, '보이는 영역(CropBox)만 바꾸므로 잘린 부분의 내용은 파일 안에 남아 있습니다. 민감한 내용을 지우는 용도로는 쓰지 마세요.')],
    run: async ([f], o) => [{ name: `${baseName(f.name)}_자르기.pdf`, bytes: await cropPdf(f.bytes, o) }],
  },
  {
    id: 'meta', group: '정보', short: '정', title: '문서 정보', desc: 'PDF의 제목·작성자·주제·키워드를 보고 바꾸거나 모두 지웁니다.',
    defaults: { strip: false, title: '', author: '', subject: '', keywords: '' },
    onLoad: async (f, o) => { const m = await readMetadata(f.bytes); Object.assign(o, { title: m.title, author: m.author, subject: m.subject, keywords: m.keywords }); return `${m.pages}쪽 · 만든 프로그램 ${m.creator || m.producer || '알 수 없음'}`; },
    options: (o) => [field('제목', text(o, 'title')), field('작성자', text(o, 'author')), field('주제', text(o, 'subject')), field('키워드 (쉼표 구분)', text(o, 'keywords')), h('label.switch.inline', {}, h('input', { type: 'checkbox', checked: o.strip, onchange: (e) => { o.strip = e.target.checked; } }), '모든 정보 지우기 (위 입력 무시)')],
    run: async ([f], o) => [{ name: `${baseName(f.name)}_정보.pdf`, bytes: await editMetadata(f.bytes, o) }],
  },
];
const GROUPS = ['구성', '최적화', '변환', '편집', '정보'];
const UNSUPPORTED = 'Word·Excel·PowerPoint 변환, OCR, 암호 걸기·풀기는 서버 처리나 별도 엔진이 필요해, 파일을 올리지 않는 이 도구에서는 제공하지 않습니다.';

// ── 라우팅 ──────────────────────────────────────────────
const main = document.getElementById('app');
let carry = null; // "이어서 다른 도구로" 넘길 결과 파일

function route() {
  const id = location.hash.slice(1);
  const tool = TOOLS.find(t => t.id === id);
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === (tool ? 'tool' : 'home')));
  window.scrollTo(0, 0);
  if (tool) mountTool(tool); else mountHome();
}
window.addEventListener('hashchange', route);
route();

document.getElementById('theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  store.set('theme', root.dataset.theme);
});

// ── 도구 모음 ───────────────────────────────────────────
function card(t) {
  return h(`a.tool-card.g-${GROUPS.indexOf(t.group)}`, { href: `#${t.id}` },
    h('span.tool-icon', { 'aria-hidden': 'true' }, t.short),
    h('b', {}, t.title),
    h('span.muted.small', {}, t.desc));
}
function mountHome() {
  main.replaceChildren(
    h('div.home-hero', {},
      h('h1', {}, 'PDF를 올리지 않고 다루는 도구'),
      h('p', {}, '합치기, 나누기, 압축, 변환, 편집까지. 모든 처리가 이 브라우저 안에서 끝나서 파일이 어떤 서버로도 전송되지 않습니다.'),
    ),
    ...GROUPS.map(g => h('section.tool-group', {}, h('h2', {}, g), h('div.tool-grid', {}, ...TOOLS.filter(t => t.group === g).map(card)))),
    h('p.unsupported', {}, UNSUPPORTED),
  );
}

// ── 도구 화면 (공통 흐름) ───────────────────────────────
function shell(t, body) {
  main.replaceChildren(
    h('div.tool-top', {},
      h('a.back', { href: '#' }, '← 모든 도구'),
      h('h1', {}, t.title), h('p', {}, t.desc)),
    body,
  );
}

function dropzone(t, onFiles, compact = false) {
  const image = t.accept === 'image';
  const accept = image ? 'image/*' : 'application/pdf,.pdf';
  const ok = (f) => image ? f.type.startsWith('image/') : (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  const input = h('input', { type: 'file', accept, multiple: !!t.multiple, hidden: true, onchange: () => { onFiles([...input.files]); input.value = ''; } });
  const zone = h(`label.dropzone${compact ? '.compact' : '.big'}`, {
    ondragover: (e) => { e.preventDefault(); zone.classList.add('over'); },
    ondragleave: () => zone.classList.remove('over'),
    ondrop: (e) => {
      e.preventDefault(); zone.classList.remove('over');
      const files = [...e.dataTransfer.files].filter(ok);
      if (!files.length) return toast(image ? '이미지 파일만 넣을 수 있습니다' : 'PDF 파일만 넣을 수 있습니다');
      onFiles(t.multiple ? files : files.slice(0, 1));
    },
  }, input,
  compact ? h('span', {}, '+ 파일 추가') : h('span.drop-btn', {}, image ? '이미지 선택' : (t.multiple ? 'PDF 파일 선택' : 'PDF 파일 선택')),
  compact ? null : h('span.muted', {}, '또는 여기로 끌어다 놓으세요 · 파일은 업로드되지 않습니다'));
  return zone;
}

async function toEntry(file) {
  const bytes = await readFile(file);
  const entry = { file, name: file.name, size: file.size, bytes, range: '' };
  if (!file.type.startsWith('image/')) {
    try { entry.pages = await pageCount(bytes); } catch { throw new Error(`${file.name}: 열 수 없는 PDF입니다 (손상됐거나 암호가 걸려 있을 수 있음)`); }
  }
  return entry;
}

function mountTool(t) {
  if (t.custom) return CUSTOM[t.custom](t);
  const opts = structuredClone(t.defaults || {});
  let files = [];
  const add = async (list) => {
    for (const f of list) { try { files.push(await toEntry(f)); } catch (e) { toast(e.message); } }
    if (!t.multiple) files = files.slice(-1);
    if (files.length) work();
  };
  const upload = () => shell(t, h('div.upload-stage', {}, dropzone(t, add)));

  const work = async () => {
    let info = '';
    if (t.onLoad && files[0]) info = await t.onLoad(files[0], opts);
    const list = h('div.file-list', {});
    const renderList = () => list.replaceChildren(...files.map((f, i) => h('div.file-row', {},
      h('span.file-badge', {}, t.accept === 'image' ? 'IMG' : 'PDF'),
      h('div.file-name', {}, h('b', {}, f.name), h('span.muted.small', {}, [f.pages ? `${f.pages}쪽` : null, formatBytes(f.size)].filter(Boolean).join(' · '))),
      t.perFileRange ? h('input.range-in', { type: 'text', value: f.range, placeholder: '전체 (예: 1-3, 5)', 'aria-label': '쪽 범위', oninput: (e) => { f.range = e.target.value; try { parseRanges(f.range, f.pages); e.target.classList.remove('bad'); } catch { e.target.classList.add('bad'); } } }) : null,
      t.multiple ? h('div.row-actions', {},
        h('button.icon-x', { type: 'button', title: '위로', disabled: i === 0, onclick: () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; renderList(); } }, '↑'),
        h('button.icon-x', { type: 'button', title: '아래로', disabled: i === files.length - 1, onclick: () => { [files[i + 1], files[i]] = [files[i], files[i + 1]]; renderList(); } }, '↓'),
        h('button.icon-x', { type: 'button', title: '빼기', onclick: () => { files.splice(i, 1); files.length ? renderList() : upload(); } }, '×')) : null,
    )));
    renderList();
    const progress = h('p.muted.small', {});
    const runBtn = h('button.btn.primary.block.big-action', { type: 'button' }, `${t.title} 실행`);
    runBtn.onclick = async () => {
      if (t.multiple && t.id === 'merge' && files.length < 2) { toast('합칠 파일을 2개 이상 넣으세요'); return; }
      runBtn.disabled = true; runBtn.textContent = '처리하는 중…';
      try {
        const t0 = performance.now();
        const outputs = await t.run(files, opts, (m) => { progress.textContent = m; });
        done(t, outputs, files, performance.now() - t0);
      } catch (e) { toast(e.message || '처리하지 못했습니다'); console.error(e); runBtn.disabled = false; runBtn.textContent = `${t.title} 실행`; }
    };
    shell(t, h('div.work-stage', {},
      h('div.card', {}, list, info ? h('p.muted.small', { style: 'margin-top:10px' }, info) : null, t.multiple ? dropzone(t, add, true) : null),
      h('aside.card.options', {}, h('span.group-title', {}, '옵션'), ...(t.options ? t.options(opts) : [h('p.muted.small', {}, '설정할 옵션이 없습니다.')]), runBtn, progress),
    ));
  };

  if (carry && t.accept !== 'image') { const c = carry; carry = null; add([c]); } else upload();
}

/** 결과 화면: 저장, ZIP, 이어서 다른 도구로 */
function done(t, outputs, inputs, ms) {
  const total = outputs.reduce((a, o) => a + o.bytes.length, 0);
  const inSize = inputs.reduce((a, f) => a + f.size, 0);
  const pdfOut = outputs.length === 1 && outputs[0].name.endsWith('.pdf') ? outputs[0] : null;
  const compare = outputs[0].compare;
  const next = pdfOut ? TOOLS.filter(x => x.id !== t.id && x.accept !== 'image').slice(0, 6) : [];
  shell(t, h('div.done-stage', {},
    h('div.card.done-card', {},
      h('div.done-mark', { 'aria-hidden': 'true' }, '✓'),
      h('h2', {}, outputs.length === 1 ? '파일이 준비됐습니다' : `파일 ${outputs.length}개가 준비됐습니다`),
      compare ? h('p.done-compare', {}, `${formatBytes(compare)} → `, h('b', {}, formatBytes(total)),
        h(`span${total < compare ? '.saving' : '.warn'}`, {}, total < compare ? ` (−${((1 - total / compare) * 100).toFixed(1)}%)` : ' (줄지 않음 — 원본을 쓰세요)'))
        : h('p.muted', {}, `입력 ${formatBytes(inSize)} → 결과 ${formatBytes(total)} · ${(ms / 1000).toFixed(1)}초`),
      h('div.done-actions', {},
        outputs.length === 1
          ? h('button.btn.primary.big-action', { type: 'button', onclick: () => downloadBytes(outputs[0].bytes, outputs[0].name, outputs[0].type) }, `${outputs[0].name} 저장`)
          : h('button.btn.primary.big-action', { type: 'button', onclick: async () => downloadBytes(await zipFiles(outputs), `${baseName(inputs[0].name)}_${t.title}.zip`, 'application/zip') }, 'ZIP으로 모두 저장'),
        h('a.btn', { href: `#${t.id}`, onclick: (e) => { e.preventDefault(); mountTool(t); } }, '다시 하기'),
      ),
      outputs.length > 1 ? h('details.out-list', {}, h('summary', {}, '파일 하나씩 저장'), ...outputs.map(o => h('button.btn.small', { type: 'button', onclick: () => downloadBytes(o.bytes, o.name, o.type) }, o.name))) : null,
    ),
    next.length ? h('div.card', {}, h('span.group-title', {}, '이 결과로 이어서'), h('div.next-grid', {}, ...next.map(x => h('button.next-btn', {
      type: 'button',
      onclick: () => { carry = new File([pdfOut.bytes], pdfOut.name, { type: 'application/pdf' }); location.hash = x.id; },
    }, h('span.tool-icon.small', {}, x.short), x.title)))) : null,
  ));
}

// ── 직접 다루는 도구: 구성 · 편집 · 서명 ────────────────
function singleFileTool(t, onReady) {
  shell(t, h('div.upload-stage', {}, dropzone(t, async ([f]) => {
    try { onReady(await toEntry(f)); } catch (e) { toast(e.message); }
  })));
  if (carry) { const c = carry; carry = null; toEntry(c).then(onReady).catch(e => toast(e.message)); }
}

function cloneCanvas(src) {
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0); return c;
}

const CUSTOM = {
  organize(t) {
    singleFileTool(t, async (f) => {
      let pages = [], selected = -1;
      const grid = h('div.page-grid', {}, h('p.muted', {}, '쪽 미리보기를 만드는 중…'));
      const info = h('span.muted.small', {});
      const thumbs = await renderThumbnails(f.bytes, { width: 140 });
      pages = thumbs.map((_, i) => ({ src: i, rotate: 0 }));
      const render = () => {
        grid.replaceChildren(...pages.map((p, i) => {
          const thumb = p.src != null ? cloneCanvas(thumbs[p.src].canvas) : h('div.blank-page', {}, '빈 쪽');
          thumb.style.transform = `rotate(${p.rotate}deg)`;
          return h(`div.page-card${i === selected ? '.sel' : ''}`, { onclick: () => { selected = i; render(); } },
            h('div.page-thumb', {}, thumb),
            h('div.page-meta', {}, h('b', {}, `${i + 1}`), h('span.muted.small', {}, p.src != null ? `원본 ${p.src + 1}쪽` : '추가')),
            h('div.page-actions', { onclick: (e) => e.stopPropagation() },
              h('button.icon-x', { type: 'button', title: '왼쪽 회전', onclick: () => { p.rotate = (p.rotate + 270) % 360; render(); } }, '⟲'),
              h('button.icon-x', { type: 'button', title: '오른쪽 회전', onclick: () => { p.rotate = (p.rotate + 90) % 360; render(); } }, '⟳'),
              h('button.icon-x', { type: 'button', title: '앞으로', disabled: i === 0, onclick: () => { [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; selected = i - 1; render(); } }, '←'),
              h('button.icon-x', { type: 'button', title: '뒤로', disabled: i === pages.length - 1, onclick: () => { [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; selected = i + 1; render(); } }, '→'),
              h('button.icon-x', { type: 'button', title: '삭제', disabled: pages.length <= 1, onclick: () => { pages.splice(i, 1); selected = -1; render(); } }, '×')));
        }));
        info.textContent = `${pages.length}쪽${selected >= 0 ? ` · ${selected + 1}번 선택` : ''}`;
      };
      render();
      const save = h('button.btn.primary.big-action', { type: 'button' }, '구성한 PDF 만들기');
      save.onclick = async () => { save.disabled = true; try { done(t, [{ name: `${baseName(f.name)}_구성.pdf`, bytes: await applyEdits(f.bytes, { pages }) }], [f], 0); } catch (e) { toast(e.message); save.disabled = false; } };
      shell(t, h('div', { style: 'display:grid;gap:16px' },
        h('div.card', {}, h('div.card-head', {}, h('h2', {}, f.name), h('div.tool-actions', {}, info,
          h('button.btn.small', { type: 'button', onclick: () => { const at = selected >= 0 ? selected + 1 : pages.length; pages.splice(at, 0, { src: null, rotate: 0 }); selected = at; render(); } }, '+ 빈 쪽 (선택한 쪽 뒤)'),
          h('button.btn.small', { type: 'button', onclick: () => { pages.forEach(p => { p.rotate = (p.rotate + 90) % 360; }); render(); } }, '모두 오른쪽 회전'))),
          h('p.muted.small', { style: 'margin-bottom:10px' }, '쪽을 눌러 선택하고 아래 버튼으로 회전·이동·삭제합니다.'), grid),
        h('div', { style: 'display:flex;justify-content:flex-end' }, save),
      ));
    });
  },

  edit(t) {
    singleFileTool(t, async (f) => {
      const texts = [{ text: '', size: 18, color: '#1b1b1a', opacity: 1, position: 'tl', pages: '1' }];
      const img = { file: null, pages: '1', position: 'br', widthPct: 25, opacity: 1 };
      const thumbs = await renderThumbnails(f.bytes, { width: 220 });
      const preview = h('div.edit-preview', {}, ...thumbs.slice(0, 6).map((th, i) => h('figure', {}, cloneCanvas(th.canvas), h('figcaption', {}, `${i + 1}쪽`))));
      const list = h('div.text-list', {});
      const renderTexts = () => list.replaceChildren(...texts.map((tx, i) => h('div.text-item', {},
        h('textarea', { rows: 2, value: tx.text, placeholder: '넣을 문구 (한글 가능, 줄바꿈 가능)', oninput: (e) => { tx.text = e.target.value; } }),
        h('div.row3', {}, field('크기', number(tx, 'size', { min: 4 })), field('색', h('input', { type: 'color', value: tx.color, oninput: (e) => { tx.color = e.target.value; } })), field('불투명도', number(tx, 'opacity', { min: 0.05, max: 1, step: 0.05 }))),
        h('div.row2', {}, field('위치', select(tx, 'position', POS)), field('대상 쪽', text(tx, 'pages', { placeholder: 'all 또는 1-3' }))),
        h('button.btn.small', { type: 'button', onclick: () => { texts.splice(i, 1); renderTexts(); } }, '이 문구 삭제'))));
      renderTexts();
      const save = h('button.btn.primary.block.big-action', { type: 'button' }, '편집한 PDF 만들기');
      save.onclick = async () => {
        save.disabled = true; save.textContent = '만드는 중…';
        try {
          let bytes = await applyEdits(f.bytes, { pages: await keepAllPages(f.bytes), texts: texts.filter(x => x.text.trim()) });
          if (img.file) bytes = await stampImage(bytes, { ...img, image: img.file });
          done(t, [{ name: `${baseName(f.name)}_편집.pdf`, bytes }], [f], 0);
        } catch (e) { toast(e.message); save.disabled = false; save.textContent = '편집한 PDF 만들기'; }
      };
      shell(t, h('div.work-stage', {},
        h('div.card', {}, h('div.card-head', {}, h('h2', {}, f.name), h('span.hint', {}, `${f.pages}쪽 · 처음 6쪽 미리보기`)), preview),
        h('aside.card.options', {},
          h('span.group-title', {}, '문구'), list,
          h('button.btn.small', { type: 'button', onclick: () => { texts.push({ text: '', size: 18, color: '#1b1b1a', opacity: 1, position: 'cc', pages: 'all' }); renderTexts(); } }, '+ 문구 추가'),
          h('div.option', {}, h('span.group-title', {}, '이미지 (로고·도장)'),
            h('input', { type: 'file', accept: 'image/png,image/jpeg', onchange: (e) => { img.file = e.target.files[0] || null; } }),
            h('div.row2', {}, field('위치', select(img, 'position', POS)), field('대상 쪽', text(img, 'pages'))),
            h('div.row2', {}, field('너비 (쪽 대비 %)', number(img, 'widthPct', { min: 1, max: 100 })), field('불투명도', number(img, 'opacity', { min: 0.05, max: 1, step: 0.05 })))),
          save),
      ));
    });
  },

  sign(t) {
    singleFileTool(t, async (f) => {
      const o = { pages: String(f.pages), position: 'br', widthPct: 22, opacity: 1 };
      let uploaded = null;
      const pad = h('canvas.sign-pad', { width: 600, height: 220, 'aria-label': '서명 그리기 영역' });
      const g = pad.getContext('2d');
      let drawing = false, drawn = false;
      const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * (pad.width / r.width), (e.clientY - r.top) * (pad.height / r.height)]; };
      g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#14213d';
      pad.addEventListener('pointerdown', (e) => { drawing = true; drawn = true; pad.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pos(e)); });
      pad.addEventListener('pointermove', (e) => { if (drawing) { g.lineTo(...pos(e)); g.stroke(); } });
      pad.addEventListener('pointerup', () => { drawing = false; });
      const save = h('button.btn.primary.block.big-action', { type: 'button' }, '서명한 PDF 만들기');
      save.onclick = async () => {
        let image = uploaded;
        if (!image) {
          if (!drawn) { toast('서명을 그리거나 이미지를 선택하세요'); return; }
          image = new Uint8Array(await (await new Promise(r => pad.toBlob(r, 'image/png'))).arrayBuffer()); // 배경 투명 PNG
        }
        save.disabled = true;
        try { done(t, [{ name: `${baseName(f.name)}_서명.pdf`, bytes: await stampImage(f.bytes, { ...o, image }) }], [f], 0); }
        catch (e) { toast(e.message); save.disabled = false; }
      };
      shell(t, h('div.work-stage', {},
        h('div.card', {}, h('div.card-head', {}, h('h2', {}, '서명 그리기'), h('button.btn.small', { type: 'button', onclick: () => { g.clearRect(0, 0, pad.width, pad.height); drawn = false; } }, '지우기')),
          pad, h('p.muted.small', {}, '마우스나 터치로 서명하세요. 배경은 투명하게 들어갑니다.'),
          h('div.option', {}, field('또는 서명 이미지 (PNG 권장)', h('input', { type: 'file', accept: 'image/png,image/jpeg', onchange: async (e) => { const file = e.target.files[0]; uploaded = file ? new Uint8Array(await file.arrayBuffer()) : null; } })))),
        h('aside.card.options', {},
          h('span.group-title', {}, `${f.name} · ${f.pages}쪽`),
          field('넣을 쪽', text(o, 'pages'), '기본은 마지막 쪽. all 또는 1-3'),
          h('div.row2', {}, field('위치', select(o, 'position', POS)), field('너비 (쪽 대비 %)', number(o, 'widthPct', { min: 5, max: 80 }))),
          save),
      ));
    });
  },
};
