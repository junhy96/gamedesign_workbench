// PDF 처리: 압축 · 합치기 · 수정 저장
import { loadPdfLib, loadPdfJs, loadFontkit, loadKoreanFont, parseRanges, placeText, pageLabel, hasNonLatin } from './core.js';

// ── 압축 ────────────────────────────────────────────────
/**
 * level 'structure' : 무손실 — 객체 스트림으로 다시 저장(+ 선택 시 메타데이터 제거)
 * level 'images'    : 텍스트 유지 — 내장 JPEG(DCTDecode) 이미지를 최대 크기·품질에 맞게 다시 인코딩
 * level 'raster'    : 강한 압축 — 각 쪽을 이미지로 렌더해 새 PDF 생성 (텍스트 선택·검색 불가)
 */
export async function compressPdf(bytes, { level = 'images', maxPx = 1600, quality = 0.7, dpi = 110, stripMeta = true, onProgress } = {}) {
  if (level === 'raster') return rasterize(bytes, { dpi, quality, onProgress });
  const { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFNumber } = await loadPdfLib();
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
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
  const out = await doc.save({ useObjectStreams: true });
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
  return { bytes: await out.save({ useObjectStreams: true }), report: { pages: src.numPages, rasterized: true } };
}

// ── 합치기 ──────────────────────────────────────────────
/** items: [{bytes, range}] → 합친 PDF */
export async function mergePdfs(items, { title } = {}) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  for (const it of items) {
    const src = await PDFDocument.load(it.bytes, { ignoreEncryption: true });
    const idx = parseRanges(it.range, src.getPageCount());
    const pages = await out.copyPages(src, idx);
    pages.forEach(p => out.addPage(p));
  }
  if (title) out.setTitle(title);
  return out.save({ useObjectStreams: true });
}

export async function pageCount(bytes) {
  const { PDFDocument } = await loadPdfLib();
  return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
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
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
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
  const allText = [...plan.texts.map(t => t.text), plan.pageNumbers?.on ? plan.pageNumbers.format : ''].join('');
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
    for (const t of plan.texts) {
      if (!t.text) continue;
      const targets = t.pages === 'all' || !t.pages ? null : new Set(parseRanges(t.pages, total));
      if (targets && !targets.has(i)) continue;
      draw(page, t.text, t.size || 24, t.color, t.opacity ?? 1, t.position || 'cc');
    }
    if (plan.pageNumbers?.on) draw(page, pageLabel(plan.pageNumbers.format, i + 1, total), plan.pageNumbers.size || 10, '#333333', 1, plan.pageNumbers.position || 'bc');
  });

  if (plan.meta?.title) out.setTitle(plan.meta.title);
  if (plan.meta?.author) out.setAuthor(plan.meta.author);
  return out.save({ useObjectStreams: true });
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
