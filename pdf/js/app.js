// PDF 도구 — 화면 (압축 · 합치기 · 수정). 초안.
import { compressPdf, mergePdfs, pageCount, applyEdits, renderThumbnails } from './ops.js';
import { readFile, formatBytes, downloadBytes, parseRanges } from './core.js';
import { h, toast, store } from '../../js/lib/util.js';

// ── 탭·테마 ─────────────────────────────────────────────
const TABS = { compress: mountCompress, merge: mountMerge, edit: mountEdit };
const mounted = new Set();
function show(id) {
  if (!(id in TABS)) id = 'compress';
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
  for (const k of Object.keys(TABS)) document.getElementById(`tab-${k}`).hidden = k !== id;
  if (!mounted.has(id)) { mounted.add(id); TABS[id](document.getElementById(`tab-${id}`)); }
}
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { history.replaceState(null, '', `#${b.dataset.tab}`); show(b.dataset.tab); }));
window.addEventListener('hashchange', () => show(location.hash.slice(1)));
show(location.hash.slice(1));
document.getElementById('theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  store.set('theme', root.dataset.theme);
});

// ── 공용 ────────────────────────────────────────────────
function head(title, desc) {
  return h('div.tool-head', {}, h('div', {}, h('h1', {}, title), h('p', {}, desc)));
}

/** 끌어다 놓기 + 클릭 선택. onFiles(File[]) */
function dropzone(label, { multiple = false, onFiles }) {
  const input = h('input', { type: 'file', accept: 'application/pdf,.pdf', multiple, hidden: true, onchange: () => { onFiles([...input.files]); input.value = ''; } });
  const zone = h('label.dropzone', {
    ondragover: (e) => { e.preventDefault(); zone.classList.add('over'); },
    ondragleave: () => zone.classList.remove('over'),
    ondrop: (e) => {
      e.preventDefault(); zone.classList.remove('over');
      const files = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
      if (!files.length) return toast('PDF 파일만 넣을 수 있습니다');
      onFiles(multiple ? files : files.slice(0, 1));
    },
  }, input, h('strong', {}, label), h('span.muted.small', {}, '여기로 끌어다 놓거나 클릭해서 선택 · 파일은 업로드되지 않습니다'));
  return zone;
}

function busyButton(btn, text, fn) {
  return async () => {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = text;
    try { await fn(); } catch (e) { toast(e.message || '처리하지 못했습니다'); console.error(e); }
    finally { btn.disabled = false; btn.textContent = label; }
  };
}
const baseName = (name) => name.replace(/\.pdf$/i, '');

// ── 압축 ────────────────────────────────────────────────
function mountCompress(root) {
  const opt = { level: 'images', maxPx: 1600, quality: 0.7, dpi: 110, stripMeta: true };
  let file = null, bytes = null;
  const els = {};
  const radio = (value, title, desc) => h('label.choice', {},
    h('input', { type: 'radio', name: 'level', value, checked: opt.level === value, onchange: () => { opt.level = value; sync(); } }),
    h('span', {}, h('b', {}, title), h('span.muted.small', {}, desc)));
  const sync = () => {
    els.imgOpts.hidden = opt.level !== 'images';
    els.rasterOpts.hidden = opt.level !== 'raster';
  };
  root.replaceChildren(
    head('PDF 압축', '내장 이미지를 다시 인코딩하거나 구조를 정리해 용량을 줄입니다. 텍스트를 유지하는 방식이 기본이고, 더 줄여야 하면 쪽을 이미지로 바꾸는 강한 압축을 쓸 수 있습니다.'),
    h('div.pdf-grid', {},
      h('div.card', {},
        dropzone('PDF 파일 1개', { onFiles: async ([f]) => { file = f; bytes = await readFile(f); els.fileInfo.textContent = `${f.name} · ${formatBytes(f.size)}`; els.out.replaceChildren(); } }),
        els.fileInfo = h('p.file-info', {}, '선택한 파일 없음'),
      ),
      h('div.card.settings-like', {},
        h('span.group-title', {}, '압축 방식'),
        radio('structure', '구조 최적화 (무손실)', '객체를 다시 묶고 메타데이터를 지웁니다. 화질 변화 없음, 감소 폭은 작음.'),
        radio('images', '이미지 재압축 (권장)', '사진·스캔 이미지를 줄이고 다시 인코딩합니다. 텍스트는 그대로 선택·검색 가능.'),
        radio('raster', '강한 압축 (쪽을 이미지로)', '모든 쪽을 이미지로 바꿉니다. 가장 작아지지만 텍스트 선택·검색이 안 됩니다.'),
        els.imgOpts = h('div.row2', {},
          h('label.field', {}, h('span', {}, '이미지 최대 크기 (px)'), h('select', { onchange: (e) => { opt.maxPx = +e.target.value; } }, ...[1000, 1600, 2400].map(v => h('option', { value: v, selected: v === opt.maxPx }, `${v}px`)))),
          h('label.field', {}, h('span', {}, '품질'), h('select', { onchange: (e) => { opt.quality = +e.target.value; } }, ...[[0.5, '낮음 (50)'], [0.7, '보통 (70)'], [0.85, '높음 (85)']].map(([v, l]) => h('option', { value: v, selected: v === opt.quality }, l)))),
        ),
        els.rasterOpts = h('div.row2', {},
          h('label.field', {}, h('span', {}, '해상도'), h('select', { onchange: (e) => { opt.dpi = +e.target.value; } }, ...[[72, '72 dpi (화면용)'], [110, '110 dpi (기본)'], [150, '150 dpi (인쇄 초안)']].map(([v, l]) => h('option', { value: v, selected: v === opt.dpi }, l)))),
          h('label.field', {}, h('span', {}, '품질'), h('select', { onchange: (e) => { opt.quality = +e.target.value; } }, ...[[0.5, '낮음'], [0.7, '보통'], [0.85, '높음']].map(([v, l]) => h('option', { value: v, selected: v === opt.quality }, l)))),
        ),
        h('label.switch.inline', {}, h('input', { type: 'checkbox', checked: opt.stripMeta, onchange: (e) => { opt.stripMeta = e.target.checked; } }), '메타데이터(작성자·제목 등) 지우기'),
        els.run = h('button.btn.primary.block', { type: 'button' }, '압축하기'),
        els.progress = h('p.muted.small', {}),
      ),
    ),
    els.out = h('div', {}),
  );
  sync();
  els.run.onclick = busyButton(els.run, '압축하는 중…', async () => {
    if (!bytes) throw new Error('먼저 PDF 파일을 선택하세요.');
    const t0 = performance.now();
    const { bytes: out, report } = await compressPdf(bytes, { ...opt, onProgress: (m) => { els.progress.textContent = m; } });
    els.progress.textContent = '';
    const ratio = out.length / bytes.length;
    const name = `${baseName(file.name)}_압축.pdf`;
    els.out.replaceChildren(h('div.card.result-card', {},
      h('div.result-sizes', {},
        h('div', {}, h('span.muted.small', {}, '원본'), h('b', {}, formatBytes(bytes.length))),
        h('div.arrow', {}, '→'),
        h('div', {}, h('span.muted.small', {}, '결과'), h('b', {}, formatBytes(out.length))),
        h(`div.delta-big${ratio < 1 ? '.good' : '.bad'}`, {}, ratio < 1 ? `−${((1 - ratio) * 100).toFixed(1)}%` : '줄지 않음'),
      ),
      h('p.muted.small', {}, report.rasterized ? `${report.pages}쪽을 이미지로 변환 · ` : report.images != null ? `이미지 ${report.images}개 중 ${report.recompressed}개 재압축, ${report.skipped}개 유지 · ` : '', `${((performance.now() - t0) / 1000).toFixed(1)}초`),
      ratio >= 1 ? h('p', { style: 'color:var(--warn)' }, '더 작아지지 않았습니다. 원본을 그대로 쓰거나 다른 방식을 시도해 보세요.') : null,
      h('button.btn.primary', { type: 'button', onclick: () => downloadBytes(out, name) }, `${name} 저장`),
    ));
  });
}

// ── 합치기 ──────────────────────────────────────────────
function mountMerge(root) {
  const items = []; // {file, bytes, pages, range}
  const els = {};
  const renderList = () => {
    els.list.replaceChildren(...items.map((it, i) => h('div.merge-row', {},
      h('span.merge-idx', {}, i + 1),
      h('div.merge-name', {}, h('b', {}, it.file.name), h('span.muted.small', {}, `${it.pages}쪽 · ${formatBytes(it.file.size)}`)),
      h('label.field.merge-range', {}, h('span', {}, '쪽 범위'), h('input', { type: 'text', value: it.range, placeholder: '전체 (예: 1-3, 5)', oninput: (e) => { it.range = e.target.value; validateRange(it, e.target); } })),
      h('div.row-actions', {},
        h('button.icon-x', { type: 'button', title: '위로', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; renderList(); } }, '↑'),
        h('button.icon-x', { type: 'button', title: '아래로', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; renderList(); } }, '↓'),
        h('button.icon-x', { type: 'button', title: '빼기', onclick: () => { items.splice(i, 1); renderList(); } }, '×'),
      ),
    )));
    if (!items.length) els.list.append(h('p.muted', {}, '파일을 추가하면 여기에 순서대로 나열됩니다.'));
    summary();
  };
  const validateRange = (it, input) => {
    try { parseRanges(it.range, it.pages); input.setCustomValidity(''); input.classList.remove('bad'); }
    catch (e) { input.setCustomValidity(e.message); input.classList.add('bad'); }
    summary();
  };
  const summary = () => {
    const total = items.reduce((a, it) => { try { return a + parseRanges(it.range, it.pages).length; } catch { return a; } }, 0);
    els.summary.textContent = items.length ? `${items.length}개 파일 · 합치면 ${total}쪽` : '';
  };
  root.replaceChildren(
    head('PDF 합치기', '여러 PDF를 원하는 순서로 하나로 합칩니다. 파일마다 필요한 쪽만 골라 넣을 수 있습니다 (예: 1-3, 5, 8-).'),
    h('div.card', {},
      dropzone('PDF 파일 여러 개', {
        multiple: true,
        onFiles: async (files) => {
          for (const f of files) {
            try { const bytes = await readFile(f); items.push({ file: f, bytes, pages: await pageCount(bytes), range: '' }); }
            catch { toast(`${f.name}: 열 수 없는 PDF입니다 (암호가 걸려 있을 수 있음)`); }
          }
          renderList();
        },
      }),
      els.list = h('div.merge-list', {}),
      h('div.table-foot', {},
        els.summary = h('span.muted.small', {}),
        h('div.tool-actions', {},
          els.name = h('input', { type: 'text', value: '합친 문서', 'aria-label': '저장할 파일 이름', style: 'width:180px' }),
          els.run = h('button.btn.primary', { type: 'button' }, '합치기'),
        ),
      ),
    ),
  );
  renderList();
  els.run.onclick = busyButton(els.run, '합치는 중…', async () => {
    if (items.length < 1) throw new Error('PDF 파일을 추가하세요.');
    const out = await mergePdfs(items.map(it => ({ bytes: it.bytes, range: it.range })), { title: els.name.value });
    downloadBytes(out, `${els.name.value || '합친 문서'}.pdf`);
    toast(`합쳤습니다 (${formatBytes(out.length)})`);
  });
}

// ── 수정 ────────────────────────────────────────────────
function mountEdit(root) {
  let file = null, bytes = null, thumbs = [];
  let pages = []; // {src, rotate}
  const texts = [];
  const pn = { on: false, format: '{n} / {total}', position: 'bc', size: 10 };
  const meta = { title: '', author: '' };
  let selected = -1;
  const els = {};

  const POS = [['tl', '왼쪽 위'], ['tc', '가운데 위'], ['tr', '오른쪽 위'], ['cl', '왼쪽 가운데'], ['cc', '정가운데'], ['cr', '오른쪽 가운데'], ['bl', '왼쪽 아래'], ['bc', '가운데 아래'], ['br', '오른쪽 아래']];
  const posSelect = (obj) => h('select', { onchange: (e) => { obj.position = e.target.value; } }, ...POS.map(([v, l]) => h('option', { value: v, selected: v === obj.position }, l)));

  const renderPages = () => {
    els.grid.replaceChildren(...pages.map((p, i) => {
      const t = p.src != null ? thumbs[p.src] : null;
      const thumb = t ? cloneCanvas(t.canvas) : h('div.blank-page', {}, '빈 쪽');
      thumb.style.transform = `rotate(${p.rotate}deg)`;
      return h(`div.page-card${i === selected ? '.sel' : ''}`, { onclick: () => { selected = i; renderPages(); } },
        h('div.page-thumb', {}, thumb),
        h('div.page-meta', {}, h('b', {}, `${i + 1}쪽`), p.src != null ? h('span.muted.small', {}, `원본 ${p.src + 1}`) : h('span.muted.small', {}, '추가됨')),
        h('div.page-actions', { onclick: (e) => e.stopPropagation() },
          h('button.icon-x', { type: 'button', title: '왼쪽으로 회전', onclick: () => { p.rotate = (p.rotate + 270) % 360; renderPages(); } }, '⟲'),
          h('button.icon-x', { type: 'button', title: '오른쪽으로 회전', onclick: () => { p.rotate = (p.rotate + 90) % 360; renderPages(); } }, '⟳'),
          h('button.icon-x', { type: 'button', title: '앞으로', disabled: i === 0, onclick: () => { [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; selected = i - 1; renderPages(); } }, '←'),
          h('button.icon-x', { type: 'button', title: '뒤로', disabled: i === pages.length - 1, onclick: () => { [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; selected = i + 1; renderPages(); } }, '→'),
          h('button.icon-x', { type: 'button', title: '삭제', disabled: pages.length <= 1, onclick: () => { pages.splice(i, 1); selected = -1; renderPages(); } }, '×'),
        ),
      );
    }));
    els.pageInfo.textContent = pages.length ? `${pages.length}쪽${selected >= 0 ? ` · ${selected + 1}쪽 선택됨` : ''}` : '';
  };

  const renderTexts = () => {
    els.texts.replaceChildren(...texts.map((t, i) => h('div.text-item', {},
      h('textarea', { rows: 2, value: t.text, placeholder: '넣을 문구 (한글 가능)', oninput: (e) => { t.text = e.target.value; } }),
      h('div.row3', {},
        h('label.field', {}, h('span', {}, '크기'), h('input', { type: 'number', value: t.size, min: 4, oninput: (e) => { t.size = +e.target.value || 12; } })),
        h('label.field', {}, h('span', {}, '색'), h('input', { type: 'color', value: t.color, oninput: (e) => { t.color = e.target.value; } })),
        h('label.field', {}, h('span', {}, '불투명도'), h('input', { type: 'number', value: t.opacity, min: 0.05, max: 1, step: 0.05, oninput: (e) => { t.opacity = +e.target.value || 1; } })),
      ),
      h('div.row2', {},
        h('label.field', {}, h('span', {}, '위치'), posSelect(t)),
        h('label.field', {}, h('span', {}, '대상 쪽'), h('input', { type: 'text', value: t.pages, placeholder: 'all 또는 1-3', oninput: (e) => { t.pages = e.target.value.trim() || 'all'; } })),
      ),
      h('button.btn.small', { type: 'button', onclick: () => { texts.splice(i, 1); renderTexts(); } }, '이 문구 삭제'),
    )));
  };

  root.replaceChildren(
    head('PDF 수정', '쪽을 회전·삭제·재배치하고 빈 쪽을 넣거나, 워터마크·문구·쪽 번호를 추가합니다. 한글 문구는 글꼴을 함께 넣어 어디서 열어도 깨지지 않습니다.'),
    h('div.layout.pdf-edit', {},
      h('aside.settings.card', {},
        dropzone('PDF 파일 1개', {
          onFiles: async ([f]) => {
            file = f; bytes = await readFile(f);
            els.grid.replaceChildren(h('p.muted', {}, '쪽 미리보기를 만드는 중…'));
            try {
              thumbs = await renderThumbnails(bytes, { width: 140 });
              pages = thumbs.map((_, i) => ({ src: i, rotate: 0 }));
              selected = -1; renderPages();
            } catch (e) { els.grid.replaceChildren(h('p', { style: 'color:var(--bad)' }, `열 수 없는 PDF입니다: ${e.message}`)); }
          },
        }),
        h('div.option', {},
          h('span.group-title', {}, '문구 · 워터마크'),
          els.texts = h('div.text-list', {}),
          h('button.btn.small', { type: 'button', onclick: () => { texts.push({ text: '', size: 36, color: '#c03a39', opacity: 0.3, position: 'cc', pages: 'all' }); renderTexts(); } }, '+ 문구 추가'),
        ),
        h('div.option', {},
          h('label.switch', {}, '쪽 번호', h('input', { type: 'checkbox', onchange: (e) => { pn.on = e.target.checked; } })),
          h('div.row2', {},
            h('label.field', {}, h('span', {}, '형식'), h('input', { type: 'text', value: pn.format, oninput: (e) => { pn.format = e.target.value || '{n}'; } })),
            h('label.field', {}, h('span', {}, '위치'), posSelect(pn)),
          ),
          h('p.desc', {}, '{n} = 쪽 번호, {total} = 전체 쪽 수'),
        ),
        h('div.option', {},
          h('span.group-title', {}, '문서 정보'),
          h('label.field', {}, h('span', {}, '제목'), h('input', { type: 'text', oninput: (e) => { meta.title = e.target.value; } })),
          h('label.field', {}, h('span', {}, '작성자'), h('input', { type: 'text', oninput: (e) => { meta.author = e.target.value; } })),
        ),
        els.save = h('button.btn.primary.block', { type: 'button' }, '수정한 PDF 저장'),
      ),
      h('div.results', {},
        h('div.card', {},
          h('div.card-head', {}, h('h2', {}, '쪽'), h('div.tool-actions', {},
            els.pageInfo = h('span.muted.small', {}),
            h('button.btn.small', { type: 'button', onclick: () => { if (!pages.length) return; const at = selected >= 0 ? selected + 1 : pages.length; pages.splice(at, 0, { src: null, rotate: 0 }); selected = at; renderPages(); } }, '+ 빈 쪽 (선택한 쪽 뒤)'),
          )),
          els.grid = h('div.page-grid', {}, h('p.muted', {}, 'PDF를 열면 쪽 미리보기가 나타납니다. 쪽을 눌러 선택하고 아래 버튼으로 회전·이동·삭제합니다.')),
        ),
      ),
    ),
  );
  renderTexts();
  els.save.onclick = busyButton(els.save, '저장하는 중…', async () => {
    if (!bytes) throw new Error('먼저 PDF 파일을 여세요.');
    const out = await applyEdits(bytes, { pages, texts, pageNumbers: pn, meta });
    downloadBytes(out, `${baseName(file.name)}_수정.pdf`);
    toast(`저장했습니다 (${formatBytes(out.length)})`);
  });
}

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}
