// PDF 처리: 압축 · 합치기 · 수정 저장
import { loadPdfLib, loadPdfJs, loadFontkit, loadKoreanFont, parseRanges, placeText, pageLabel, hasNonLatin } from './core.js';

// pdf-lib 기본값은 50~100개 객체마다 setTimeout으로 양보한다. 백그라운드 탭에서는 타이머가 1초 단위로 늦춰져
// 객체가 수만 개인 PDF(예: PowerPoint 내보내기)는 몇 분씩 걸린다 → 양보 간격을 크게 잡는다.
const TICK = 2000;
const SAVE_OPTS = { useObjectStreams: true, objectsPerTick: TICK };

// ── 압축 ────────────────────────────────────────────────
/**
 * level 'structure' : 무손실 — 객체 스트림으로 다시 저장(+ 선택 시 메타데이터 제거)
 * level 'images'    : 텍스트 유지 — 내장 JPEG(DCTDecode) 이미지를 최대 크기·품질에 맞게 다시 인코딩
 * level 'raster'    : 강한 압축 — 각 쪽을 이미지로 렌더해 새 PDF 생성 (텍스트 선택·검색 불가)
 */
export async function compressPdf(bytes, { level = 'images', maxPx = 1600, quality = 0.7, dpi = 110, stripMeta = true, onProgress } = {}) {
  if (level === 'raster') return rasterize(bytes, { dpi, quality, onProgress });
  const { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFNumber } = await loadPdfLib();
  const doc = await PDFDocument.load(bytes, { parseSpeed: TICK, updateMetadata: false });
  const report = { images: 0, recompressed: 0, skipped: 0, savedImageBytes: 0 };

  if (level === 'images') {
    const N = (n) => PDFName.of(n);
    const objs = doc.context.enumerateIndirectObjects();
    let i = 0;
    for (const [ref, obj] of objs) {
      i++;
      if (!(obj instanceof PDFRawStream) || obj.dict.get(N('Subtype')) !== N('Image')) continue;
      report.images++;
      const dict = obj.dict;
      const filter = dict.get(N('Filter'));
      const isDct = filter === N('DCTDecode') || (filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === N('DCTDecode'));
      const cs = dict.get(N('ColorSpace'));
      // CMYK·디코드 배열·마스크 이미지는 색이 바뀔 수 있어 건드리지 않음
      if (!isDct || cs === N('DeviceCMYK') || dict.has(N('Decode')) || dict.get(N('ImageMask'))) { report.skipped++; continue; }
      const w = dict.get(N('Width'))?.asNumber?.() ?? 0, h = dict.get(N('Height'))?.asNumber?.() ?? 0;
      try {
        const bmp = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' }));
        const scale = Math.min(1, maxPx / Math.max(w || bmp.width, h || bmp.height));
        const nw = Math.max(1, Math.round(bmp.width * scale)), nh = Math.max(1, Math.round(bmp.height * scale));
        const canvas = new OffscreenCanvas(nw, nh);
        const g = canvas.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, nw, nh);
        g.drawImage(bmp, 0, 0, nw, nh);
        bmp.close();
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        const out = new Uint8Array(await blob.arrayBuffer());
        if (out.length >= obj.contents.length * 0.95) { report.skipped++; continue; } // 이득이 없으면 원본 유지
        const nd = dict.clone(doc.context);
        nd.set(N('Width'), PDFNumber.of(nw)); nd.set(N('Height'), PDFNumber.of(nh));
        nd.set(N('ColorSpace'), N('DeviceRGB')); nd.set(N('BitsPerComponent'), PDFNumber.of(8));
        nd.set(N('Filter'), N('DCTDecode')); nd.delete(N('DecodeParms'));
        nd.set(N('Length'), PDFNumber.of(out.length));
        doc.context.assign(ref, PDFRawStream.of(nd, out));
        report.recompressed++; report.savedImageBytes += obj.contents.length - out.length;
      } catch { report.skipped++; }
      onProgress?.(`이미지 ${report.images}개 확인 중…`);
      if (i % 50 === 0) await new Promise(r => setTimeout(r)); // 화면 멈춤 방지
    }
  }
  if (stripMeta) stripMetadata(doc, PDFName);
  const out = await doc.save(SAVE_OPTS);
  return { bytes: out, report };
}

function stripMetadata(doc, PDFName) {
  doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
  doc.catalog.delete(PDFName.of('Metadata')); // XMP 메타데이터
}

async function rasterize(bytes, { dpi, quality, onProgress }) {
  const pdfjs = await loadPdfJs();
  const { PDFDocument } = await loadPdfLib();
  const task = pdfjs.getDocument({ data: bytes.slice() }); // destroy()는 로딩 작업에 있음
  const src = await task.promise;
  const out = await PDFDocument.create();
  for (let p = 1; p <= src.numPages; p++) {
    onProgress?.(`${p} / ${src.numPages}쪽 렌더 중…`);
    const page = await src.getPage(p);
    const base = page.getViewport({ scale: 1 }); // pt 단위 (회전 반영)
    const vp = page.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement('canvas'); // pdf.js 렌더는 일반 canvas가 가장 호환성이 좋음
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport: vp, canvas }).promise;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    const jpg = new Uint8Array(await blob.arrayBuffer());
    const img = await out.embedJpg(jpg);
    const pg = out.addPage([base.width, base.height]);
    pg.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
    page.cleanup();
  }
  await task.destroy();
  return { bytes: await out.save(SAVE_OPTS), report: { pages: src.numPages, rasterized: true } };
}

// ── 합치기 ──────────────────────────────────────────────
/** items: [{bytes, range}] → 합친 PDF */
export async function mergePdfs(items, { title } = {}) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  for (const it of items) {
    const src = await PDFDocument.load(it.bytes, { parseSpeed: TICK, ignoreEncryption: true });
    const idx = parseRanges(it.range, src.getPageCount());
    const pages = await out.copyPages(src, idx);
    pages.forEach(p => out.addPage(p));
  }
  if (title) out.setTitle(title);
  return out.save(SAVE_OPTS);
}

export async function pageCount(bytes) {
  const { PDFDocument } = await loadPdfLib();
  return (await PDFDocument.load(bytes, { parseSpeed: TICK, ignoreEncryption: true })).getPageCount();
}

// ── 수정 저장 ───────────────────────────────────────────
/**
 * plan.pages: [{src: 원본 쪽 번호(0부터) | null(빈 쪽), rotate: 0|90|180|270}]
 * plan.texts: [{text, size, color:'#rrggbb', opacity, position:'tl'..'br', pages:'all'|'1,3'}]
 * plan.pageNumbers: {on, format:'{n} / {total}', position:'bc', size}
 * plan.meta: {title, author}
 */
export async function applyEdits(bytes, plan) {
  const { PDFDocument, degrees, rgb, StandardFonts } = await loadPdfLib();
  const src = await PDFDocument.load(bytes, { parseSpeed: TICK, ignoreEncryption: true });
  const out = await PDFDocument.create();
  const srcIdx = plan.pages.filter(p => p.src != null).map(p => p.src);
  const copied = await out.copyPages(src, srcIdx);
  let ci = 0, lastSize = src.getPageCount() ? src.getPage(0).getSize() : { width: 595.28, height: 841.89 };
  for (const p of plan.pages) {
    let page;
    if (p.src != null) { page = out.addPage(copied[ci++]); lastSize = page.getSize(); }
    else page = out.addPage([lastSize.width, lastSize.height]);
    if (p.rotate) page.setRotation(degrees((page.getRotation().angle + p.rotate) % 360));
  }

  // 글꼴: 라틴 문자만이면 내장 Helvetica, 한글 등이 있으면 Pretendard를 하위 집합으로 삽입
  const texts = plan.texts || [];
  const allText = [...texts.map(t => t.text), plan.pageNumbers?.on ? plan.pageNumbers.format : ''].join('');
  let font;
  if (hasNonLatin(allText)) {
    out.registerFontkit(await loadFontkit());
    font = await out.embedFont(await loadKoreanFont(), { subset: true });
  } else font = await out.embedFont(StandardFonts.Helvetica);

  const total = out.getPageCount();
  const hex = (c) => { const n = parseInt((c || '#000000').slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
  const draw = (page, text, size, color, opacity, position) => {
    const { width, height } = page.getSize();
    const lines = String(text).split('\n');
    const textW = Math.max(...lines.map(l => font.widthOfTextAtSize(l, size)));
    const lineH = size * 1.25, textH = lineH * lines.length;
    const { x, y } = placeText({ pageW: width, pageH: height, textW, textH, position });
    lines.forEach((l, i) => page.drawText(l, { x, y: y + textH - lineH * (i + 1) + size * 0.25, size, font, color: hex(color), opacity }));
  };
  out.getPages().forEach((page, i) => {
    for (const t of texts) {
      if (!t.text) continue;
      const targets = t.pages === 'all' || !t.pages ? null : new Set(parseRanges(t.pages, total));
      if (targets && !targets.has(i)) continue;
      draw(page, t.text, t.size || 24, t.color, t.opacity ?? 1, t.position || 'cc');
    }
    if (plan.pageNumbers?.on) draw(page, pageLabel(plan.pageNumbers.format, i + 1, total), plan.pageNumbers.size || 10, '#333333', 1, plan.pageNumbers.position || 'bc');
  });

  if (plan.meta?.title) out.setTitle(plan.meta.title);
  if (plan.meta?.author) out.setAuthor(plan.meta.author);
  return out.save(SAVE_OPTS);
}

/** 썸네일 렌더 (pdf.js) → [{canvas, width, height, rotation}] */
export async function renderThumbnails(bytes, { width = 150, onPage } = {}) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const thumbs = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / vp0.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
    thumbs.push({ canvas, width: vp0.width, height: vp0.height });
    onPage?.(p, doc.numPages, thumbs.at(-1));
    page.cleanup();
  }
  await task.destroy();
  return thumbs;
}

// ── 추가 도구 ───────────────────────────────────────────
/** 쪽 구성은 그대로 두고 문구·쪽 번호만 얹을 때 쓰는 계획 */
export async function keepAllPages(bytes) {
  return Array.from({ length: await pageCount(bytes) }, (_, i) => ({ src: i, rotate: 0 }));
}

/**
 * 분할. mode 'ranges': "1-3, 4-6"의 각 범위를 파일 하나로 / 'each': 쪽마다 파일 / 'every': n쪽씩
 * @returns {Promise<{name:string, bytes:Uint8Array}[]>}
 */
export async function splitPdf(bytes, { mode = 'each', ranges = '', every = 1, base = '문서' } = {}) {
  const { PDFDocument } = await loadPdfLib();
  const src = await PDFDocument.load(bytes, { parseSpeed: TICK, ignoreEncryption: true });
  const n = src.getPageCount();
  let groups;
  if (mode === 'ranges') groups = ranges.split(',').map(r => r.trim()).filter(Boolean).map(r => ({ label: r.replace(/\s+/g, ''), idx: parseRanges(r, n) }));
  else if (mode === 'every') {
    const k = Math.max(1, Math.floor(every));
    groups = Array.from({ length: Math.ceil(n / k) }, (_, g) => ({ label: `${g * k + 1}-${Math.min(n, (g + 1) * k)}`, idx: Array.from({ length: Math.min(k, n - g * k) }, (_, j) => g * k + j) }));
  } else groups = Array.from({ length: n }, (_, i) => ({ label: String(i + 1), idx: [i] }));
  if (!groups.length) throw new Error('나눌 쪽 범위를 입력하세요.');
  const out = [];
  for (const g of groups) {
    const doc = await PDFDocument.create();
    (await doc.copyPages(src, g.idx)).forEach(p => doc.addPage(p));
    // 파일 이름은 실제 쪽 번호로 ("4-"는 "4-7", 한 쪽이면 "7")
    const label = g.idx.length === 1 ? `${g.idx[0] + 1}` : `${g.idx[0] + 1}-${g.idx.at(-1) + 1}`;
    out.push({ name: `${base}_${label}쪽.pdf`, bytes: await doc.save(SAVE_OPTS) });
  }
  return out;
}

/** 회전: 대상 쪽에 각도 추가 */
export async function rotatePdf(bytes, { angle = 90, pages = 'all' } = {}) {
  const { PDFDocument, degrees } = await loadPdfLib();
  const doc = await PDFDocument.load(bytes, { parseSpeed: TICK, ignoreEncryption: true });
  const n = doc.getPageCount();
  const target = pages === 'all' || !pages ? null : new Set(parseRanges(pages, n));
  doc.getPages().forEach((p, i) => { if (!target || target.has(i)) p.setRotation(degrees((p.getRotation().angle + angle + 360) % 360)); });
  return doc.save(SAVE_OPTS);
}

/** 자르기: 여백(mm)만큼 CropBox를 줄인다. 원본 내용은 남아 있고 보이는 영역만 바뀐다. */
export async function cropPdf(bytes, { top = 0, right = 0, bottom = 0, left = 0, pages = 'all' } = {}) {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.load(bytes, { parseSpeed: TICK, ignoreEncryption: true });
  const mm = 72 / 25.4;
  const n = doc.getPageCount();
  const target = pages === 'all' || !pages ? null : new Set(parseRanges(pages, n));
  doc.getPages().forEach((p, i) => {
    if (target && !target.has(i)) return;
    const box = p.getCropBox();
    const w = box.width - (left + right) * mm, h = box.height - (top + bottom) * mm;
    if (w < 10 || h < 10) throw new Error(`${i + 1}쪽: 여백이 너무 커서 남는 영역이 없습니다.`);
    p.setCropBox(box.x + left * mm, box.y + bottom * mm, w, h);
  });
  return doc.save(SAVE_OPTS);
}

/** PDF → 이미지 (쪽마다 JPG/PNG) */
export async function pdfToImages(bytes, { dpi = 150, format = 'jpeg', quality = 0.85, base = '문서', onProgress } = {}) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const out = [];
  const ext = format === 'png' ? 'png' : 'jpg';
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(`${p} / ${doc.numPages}쪽 변환 중…`);
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport: vp, canvas }).promise;
    const blob = await new Promise(r => canvas.toBlob(r, format === 'png' ? 'image/png' : 'image/jpeg', quality));
    out.push({ name: `${base}_${String(p).padStart(String(doc.numPages).length, '0')}.${ext}`, bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type });
    page.cleanup();
  }
  await task.destroy();
  return out;
}

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

/** 이미지 → PDF. pageSize 'a4'|'letter'|'fit'(이미지 크기 그대로), orientation 'auto'|'portrait'|'landscape', margin(mm) */
export async function imagesToPdf(files, { pageSize = 'a4', orientation = 'auto', margin = 10 } = {}) {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const mm = 72 / 25.4;
  for (const f of files) {
    const buf = new Uint8Array(await f.arrayBuffer());
    let img;
    if (f.type === 'image/png') img = await doc.embedPng(buf);
    else if (f.type === 'image/jpeg') img = await doc.embedJpg(buf);
    else { // WebP·GIF·BMP 등은 캔버스로 JPEG 변환
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0);
      img = await doc.embedJpg(new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).arrayBuffer()));
    }
    let [pw, ph] = pageSize === 'fit' ? [img.width * 0.75, img.height * 0.75] : PAGE_SIZES[pageSize] ?? PAGE_SIZES.a4;
    const landscape = orientation === 'landscape' || (orientation === 'auto' && img.width > img.height);
    if (pageSize !== 'fit' && landscape !== pw > ph) [pw, ph] = [ph, pw];
    const m = pageSize === 'fit' ? 0 : margin * mm;
    const k = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
    const w = img.width * k, h = img.height * k;
    doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return doc.save(SAVE_OPTS);
}

/** 이미지(서명·도장·로고) 삽입: 대상 쪽의 위치에 너비 비율로 */
export async function stampImage(bytes, { image, pages = 'all', position = 'br', widthPct = 25, opacity = 1 } = {}) {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.load(bytes, { parseSpeed: TICK, ignoreEncryption: true });
  const buf = image instanceof Uint8Array ? image : new Uint8Array(await image.arrayBuffer());
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const img = isPng ? await doc.embedPng(buf) : await doc.embedJpg(buf);
  const n = doc.getPageCount();
  const target = pages === 'all' || !pages ? null : new Set(parseRanges(pages, n));
  doc.getPages().forEach((p, i) => {
    if (target && !target.has(i)) return;
    const { width, height } = p.getSize();
    const w = (width * widthPct) / 100, h = (w * img.height) / img.width;
    const { x, y } = placeText({ pageW: width, pageH: height, textW: w, textH: h, position });
    p.drawImage(img, { x, y, width: w, height: h, opacity });
  });
  return doc.save(SAVE_OPTS);
}

/** 문서 정보: strip이면 모두 지우고, 아니면 입력한 항목만 바꾼다 */
export async function editMetadata(bytes, { title, author, subject, keywords, strip = false } = {}) {
  const { PDFDocument, PDFName } = await loadPdfLib();
  const doc = await PDFDocument.load(bytes, { parseSpeed: TICK, ignoreEncryption: true, updateMetadata: false });
  if (strip) stripMetadata(doc, PDFName);
  else {
    if (title != null) doc.setTitle(title);
    if (author != null) doc.setAuthor(author);
    if (subject != null) doc.setSubject(subject);
    if (keywords != null) doc.setKeywords(keywords.split(',').map(k => k.trim()).filter(Boolean));
  }
  return doc.save(SAVE_OPTS);
}

export async function readMetadata(bytes) {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.load(bytes, { parseSpeed: TICK, ignoreEncryption: true, updateMetadata: false });
  return { title: doc.getTitle() ?? '', author: doc.getAuthor() ?? '', subject: doc.getSubject() ?? '', keywords: doc.getKeywords() ?? '', producer: doc.getProducer() ?? '', creator: doc.getCreator() ?? '', pages: doc.getPageCount() };
}
