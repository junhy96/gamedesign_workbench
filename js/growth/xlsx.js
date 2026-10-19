// 성장 엑셀 표 템플릿 — 수식이 살아 있는 .xlsx 만들기 (외부 라이브러리 없이 OOXML을 직접 쓰고 lib/zip.js로 묶음, DOM 없음)
//
// 시트: ① 레벨 곡선 / ② 공급원 / ③ 세그먼트 / ④ 일차별 진행 / ⑤ 검증(+ 세그먼트별 레벨 도달 차트)
// 값이 아니라 수식으로 채운다 — 엑셀에서 ①의 base·증가율·점프나 ②의 행을 바꾸면 ④·⑤가 다시 계산된다.
// ② 공급원은 100행까지 미리 잡아 둬서, 빈 행에 콘텐츠를 적으면 ④의 하루 공급(SUMPRODUCT)과 ⑤의 비중에 바로 들어간다.
// 계산 규칙은 model.js와 같다(테스트가 LibreOffice로 다시 계산한 값과 model.js 값을 비교).
// 세그먼트 수·최대 레벨·기간은 내보낼 때 정해진다(④ 열 묶음·① 레벨 행·④ 일차 행 수).
import { makeZip } from '../lib/zip.js';
import { PERIODS, UNLOCKS, METHODS, WEEKDAYS, LIMITS } from './model.js';

export const SHEETS = { curve: '① 레벨 곡선', sources: '② 공급원', segs: '③ 세그먼트', days: '④ 일차별 진행', check: '⑤ 검증' };
const Q = (name) => `'${name}'!`;
const C1 = Q(SHEETS.curve), C2 = Q(SHEETS.sources), C3 = Q(SHEETS.segs), C4 = Q(SHEETS.days), C5 = Q(SHEETS.check);
export const LAYOUT = { levelRow0: 16, srcRow0: 4, srcRows: LIMITS.sources, segRow0: 4, dayRow0: 5, segCols: 9 };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function colName(c) { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }
const A = (c, r) => `${colName(c)}${r}`;
const AA = (c, r) => `$${colName(c)}$${r}`;

// 스타일 번호 (styles.xml의 cellXfs 순서)
const ST = { title: 1, head: 2, inText: 3, inNum: 4, calcInt: 5, calcDec: 6, note: 7, pct: 8, label: 9, calcText: 10, calcGen: 11 };

/** 시트 하나: cells[r][c] = { v | f | t(문자), s } */
function sheet() {
  const rows = new Map();
  const set = (r, c, cell) => { if (!rows.has(r)) rows.set(r, new Map()); rows.get(r).set(c, cell); };
  return {
    rows,
    text: (r, c, t, s = ST.calcText) => set(r, c, { t: String(t), s }),
    num: (r, c, v, s = ST.calcInt) => set(r, c, { v: +v, s }),
    f: (r, c, f, s = ST.calcInt) => set(r, c, { f, s }),
    blank: (r, c, s) => set(r, c, { s }),
    cols: [], merges: [], validations: [], freeze: null, drawing: null,
  };
}

function sheetXml(sh) {
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'];
  if (sh.freeze) {
    const { col, row } = sh.freeze;
    out.push(`<sheetViews><sheetView workbookViewId="0"><pane${col > 1 ? ` xSplit="${col - 1}"` : ''}${row > 1 ? ` ySplit="${row - 1}"` : ''} topLeftCell="${A(col, row)}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`);
  }
  if (sh.cols.length) out.push('<cols>' + sh.cols.map(([a, b, w]) => `<col min="${a}" max="${b}" width="${w}" customWidth="1"/>`).join('') + '</cols>');
  out.push('<sheetData>');
  for (const r of [...sh.rows.keys()].sort((a, b) => a - b)) {
    const cells = sh.rows.get(r);
    out.push(`<row r="${r}">`);
    for (const c of [...cells.keys()].sort((a, b) => a - b)) {
      const x = cells.get(c), ref = A(c, r), s = x.s ? ` s="${x.s}"` : '';
      if (x.f != null) out.push(`<c r="${ref}"${s}><f>${esc(x.f)}</f></c>`);
      else if (x.t != null) out.push(`<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(x.t)}</t></is></c>`);
      else if (x.v != null) out.push(`<c r="${ref}"${s}><v>${x.v}</v></c>`);
      else out.push(`<c r="${ref}"${s}/>`);
    }
    out.push('</row>');
  }
  out.push('</sheetData>');
  if (sh.merges.length) out.push(`<mergeCells count="${sh.merges.length}">` + sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('') + '</mergeCells>');
  if (sh.validations.length) out.push(`<dataValidations count="${sh.validations.length}">` + sh.validations.map(([ref, list]) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${ref}"><formula1>${esc(list)}</formula1></dataValidation>`).join('') + '</dataValidations>');
  out.push('<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>');
  if (sh.drawing) out.push('<drawing r:id="rId1"/>');
  out.push('</worksheet>');
  return out.join('');
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="165" formatCode="#,##0.0"/><numFmt numFmtId="166" formatCode="0.0%"/></numFmts>
<fonts count="4"><font><sz val="10"/><name val="맑은 고딕"/><family val="2"/></font><font><b/><sz val="14"/><name val="맑은 고딕"/><family val="2"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/><family val="2"/></font><font><i/><sz val="9"/><color rgb="FF6E7781"/><name val="맑은 고딕"/><family val="2"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF1"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2FD"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD0D7DE"/></left><right style="thin"><color rgb="FFD0D7DE"/></right><top style="thin"><color rgb="FFD0D7DE"/></top><bottom style="thin"><color rgb="FFD0D7DE"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ── 시트별 내용 ──────────────────────────────────────────
function curveSheet(cfg) {
  const sh = sheet(), M = cfg.maxLevel, r0 = LAYOUT.levelRow0;
  sh.text(1, 1, '① 레벨 곡선 — 레벨별 필요량 (파란 칸 = 입력, 나머지 = 수식)', ST.title);
  sh.text(2, 1, '필요량(L) = L → L+1에 필요한 양. 원래 값(L) = 원래 값(L−1) × (1 + 증가율(L)/100) × (점프 레벨이면 J). 누적(L) = L에 도달하는 데 필요한 총량', ST.note);
  const params = [['기준 필요량 (base, Lv1→2)', cfg.curve.base], ['점프 배율 J', cfg.curve.jumpMult], ['필요량 상한 (0 = 없음)', cfg.curve.cap || 0], ['최대 레벨 (행 수는 내보낼 때 고정)', M], ['표 기준 획득량 — Lv1 값', cfg.table.start], ['표 기준 획득량 — 증가율 %', cfg.table.rate]];
  params.forEach(([label, v], i) => { sh.text(3 + i, 1, label, ST.label); sh.num(3 + i, 2, v, i === 3 ? ST.calcInt : ST.inNum); });
  sh.text(3, 4, '구간 시작 레벨', ST.head); sh.text(3, 5, '증가율 %', ST.head);
  for (let i = 0; i < LIMITS.bands; i++) {
    const b = cfg.curve.bands[i];
    if (b) { sh.num(4 + i, 4, b.from, ST.inNum); sh.num(4 + i, 5, b.rate, ST.inNum); } else { sh.blank(4 + i, 4, ST.inNum); sh.blank(4 + i, 5, ST.inNum); }
  }
  sh.text(3, 7, '점프 레벨', ST.head);
  for (let i = 0; i < LIMITS.jumps; i++) { const j = cfg.curve.jumps[i]; if (j != null) sh.num(4 + i, 7, j, ST.inNum); else sh.blank(4 + i, 7, ST.inNum); }
  sh.text(14, 4, '증가율(L) = 시작 레벨이 L 이하인 마지막 구간 행. 점프 레벨 L에서 필요량이 J배', ST.note);
  ['레벨', '증가율 %', '점프', '원래 값', '필요량 (L→L+1)', '누적 (L 도달)', '표 기준 획득량'].forEach((t, i) => sh.text(r0 - 1, 1 + i, t, ST.head));
  const band = (r) => `SUMPRODUCT(MAX(($D$4:$D$13<>"")*($D$4:$D$13<=A${r})*ROW($D$4:$D$13)))`;
  for (let L = 1; L <= M; L++) {
    const r = r0 + L - 1;
    sh.num(r, 1, L, ST.calcInt);
    sh.f(r, 2, `IF(${band(r)}=0,0,INDEX($E$1:$E$13,${band(r)}))`, ST.calcGen);
    sh.f(r, 3, `IF(COUNTIF($G$4:$G$13,A${r})>0,"점프","")`, ST.calcText);
    sh.f(r, 4, L === 1 ? '$B$3' : `D${r - 1}*(1+B${r}/100)*IF(C${r}="점프",$B$4,1)`, ST.calcDec);
    sh.f(r, 5, `IF($B$5>0,MIN($B$5,ROUND(D${r},0)),ROUND(D${r},0))`, ST.calcInt);
    if (L === 1) sh.num(r, 6, 0, ST.calcInt); else sh.f(r, 6, `F${r - 1}+E${r - 1}`, ST.calcInt);
    sh.f(r, 7, `ROUND($B$7*(1+$B$8/100)^(A${r}-1),0)`, ST.calcInt);
  }
  sh.cols = [[1, 1, 30], [2, 2, 12], [3, 3, 8], [4, 4, 14], [5, 6, 16], [7, 7, 16]];
  sh.freeze = { col: 1, row: r0 };
  return sh;
}

function segmentsSheet(cfg) {
  const sh = sheet(), r0 = LAYOUT.segRow0, n = cfg.segments.length;
  sh.text(1, 1, '기준 세그먼트', ST.label);
  sh.text(1, 2, cfg.segments[Math.min(cfg.ref ?? 0, n - 1)].name, ST.inText);
  sh.text(1, 3, '⑤ 검증의 마일스톤 비교에 쓰는 세그먼트 (아래 이름 중 하나)', ST.note);
  sh.text(2, 1, '요일별 접속 1/0 (1일차 = 월요일, 무작위 없음 — 같은 표면 언제나 같은 결과). 세그먼트 수는 내보낼 때 고정(④의 열 묶음)', ST.note);
  ['이름', '하루 플레이 (분)', ...WEEKDAYS].forEach((t, i) => sh.text(r0 - 1, 1 + i, t, ST.head));
  cfg.segments.forEach((s, i) => {
    sh.text(r0 + i, 1, s.name, ST.inText);
    sh.num(r0 + i, 2, s.minutes, ST.inNum);
    s.days.forEach((d, k) => sh.num(r0 + i, 3 + k, d ? 1 : 0, ST.inNum));
  });
  sh.validations.push(['B1', `$A$${r0}:$A$${r0 + n - 1}`]);
  sh.cols = [[1, 1, 16], [2, 2, 16], [3, 9, 6]];
  return sh;
}

function sourcesSheet(cfg) {
  const sh = sheet(), r0 = LAYOUT.srcRow0, R = LAYOUT.srcRows, n = cfg.segments.length;
  sh.text(1, 1, '② 공급원 — 한 행 = 콘텐츠 하나. 빈 행에 적으면 ④·⑤에 바로 반영됩니다 (100행까지)', ST.title);
  sh.text(2, 1, '주기: 매일(접속한 날) · 매주(7의 배수 일차, 그 주에 한 번이라도 접속) · 1회(해금 일차 또는 그 레벨에 처음 닿은 날). 획득 방식: 고정 = 획득값 · 표 = 획득값 × ① 표 기준 획득량(현재 레벨) · % = 획득값% × ① 필요량(현재 레벨). 시간 비례 = 예면 × 하루 플레이 분 ÷ 60. 보정 배율·횟수는 비우면 1 (수식으로 바꿔도 됨)', ST.note);
  const heads = ['이름', '주기', '해금 기준', '해금 값', '획득 방식', '획득값', '시간 비례', '보정 배율'];
  heads.forEach((t, i) => sh.text(r0 - 1, 1 + i, t, ST.head));
  cfg.segments.forEach((s, k) => sh.f(r0 - 1, 9 + k, `${C3}A${LAYOUT.segRow0 + k}&" 횟수"`, ST.head));
  for (let i = 0; i < R; i++) {
    const r = r0 + i, src = cfg.sources[i];
    if (src) {
      sh.text(r, 1, src.name, ST.inText); sh.text(r, 2, PERIODS[src.period], ST.inText); sh.text(r, 3, UNLOCKS[src.unlock], ST.inText);
      sh.num(r, 4, src.unlockAt, ST.inNum); sh.text(r, 5, METHODS[src.method], ST.inText); sh.num(r, 6, src.value, ST.inNum);
      sh.text(r, 7, src.timed ? '예' : '아니오', ST.inText); sh.num(r, 8, src.mult ?? 1, ST.inNum);
      for (let k = 0; k < n; k++) sh.num(r, 9 + k, src.counts?.[k] ?? 1, ST.inNum);
    } else {
      for (let c = 1; c <= 8 + n; c++) sh.blank(r, c, c === 1 || c === 2 || c === 3 || c === 5 || c === 7 ? ST.inText : ST.inNum);
    }
  }
  const last = r0 + R - 1;
  sh.validations.push([`B${r0}:B${last}`, '"매일,매주,1회"'], [`C${r0}:C${last}`, '"일차,레벨"'], [`E${r0}:E${last}`, '"고정,표,%"'], [`G${r0}:G${last}`, '"예,아니오"']);
  sh.cols = [[1, 1, 22], [2, 3, 10], [4, 4, 9], [5, 5, 10], [6, 6, 11], [7, 8, 10], [9, 8 + n, 11]];
  sh.freeze = { col: 2, row: r0 };
  return sh;
}

/** ④ 세그먼트 s의 열 위치 */
export function segColumns(s) {
  const c = 2 + s * LAYOUT.segCols;
  return { start: c, att: c + 1, week: c + 2, supply: c + 3, extra: c + 4, cum: c + 5, end: c + 6, stall: c + 7 };
}

function daysSheet(cfg) {
  const sh = sheet(), N = cfg.days, M = cfg.maxLevel, r0 = LAYOUT.dayRow0, s0 = LAYOUT.srcRow0, s1 = LAYOUT.srcRow0 + LAYOUT.srcRows - 1;
  const lv0 = LAYOUT.levelRow0, lv1 = LAYOUT.levelRow0 + M - 1;
  sh.text(1, 1, '④ 일차별 진행 — 세그먼트마다 하루 한 행. 전날 행만 참조합니다 (순환 참조 없음)', ST.title);
  sh.text(2, 1, '시작 레벨 = 전날 끝 레벨 → 해금·획득량은 시작 레벨 기준 → 누적 → 끝 레벨 = 누적이 넘은 마지막 레벨(①의 누적 열 MATCH). 추가 공급 칸은 특이 규칙을 직접 수식으로 넣는 자리 (기본 0)', ST.note);
  sh.text(r0 - 1, 1, '일차', ST.head);
  const R = (col) => `${C2}$${col}$${s0}:$${col}$${s1}`; // ② 열 범위
  const [B, Cc, D, E, F, G, H] = ['B', 'C', 'D', 'E', 'F', 'G', 'H'].map(R);
  for (let d = 0; d <= N; d++) sh.num(r0 + d, 1, d, ST.calcInt);
  cfg.segments.forEach((seg, s) => {
    const k = segColumns(s), segRow = LAYOUT.segRow0 + s, cnt = R(colName(9 + s));
    sh.f(r0 - 2, k.start, `${C3}A${segRow}`, ST.label);
    ['시작 레벨', '접속', '이번 주 접속', '공급', '추가 공급 (수식 가능)', '누적', '끝 레벨', '무성장 연속'].forEach((t, i) => sh.text(r0 - 1, k.start + i, t, ST.head));
    // 0일차
    [[k.start, 1], [k.att, 0], [k.week, 0], [k.supply, 0], [k.extra, 0], [k.cum, 0], [k.end, 1], [k.stall, 0]].forEach(([c, v]) => sh.num(r0, c, v, c === k.extra ? ST.inNum : ST.calcInt));
    const L = colName(k.start), AT = colName(k.att), WK = colName(k.week), SP = colName(k.supply), EX = colName(k.extra), CU = colName(k.cum), EN = colName(k.end), STL = colName(k.stall);
    for (let d = 1; d <= N; d++) {
      const r = r0 + d, p = r - 1;
      sh.f(r, k.start, `${EN}${p}`);
      sh.f(r, k.att, `INDEX(${C3}$C$${segRow}:$I$${segRow},MOD($A${r}-1,7)+1)`);
      sh.f(r, k.week, `IF(MOD($A${r}-1,7)=0,${AT}${r},${WK}${p}+${AT}${r})`);
      const unl = `((${Cc}="일차")*($A${r}>=${D})+(${Cc}="레벨")*(${L}${r}>=${D}))`;
      const factor = `((${B}="매일")*${AT}${r}*${unl}+(${B}="매주")*(MOD($A${r},7)=0)*(${WK}${r}>0)*${unl}+(${B}="1회")*((${Cc}="일차")*($A${r}=${D})+(${Cc}="레벨")*(${L}${r}>=${D})*(${L}${p}<${D})))`;
      const amount = `((${E}="고정")*${F}+(${E}="표")*${F}*INDEX(${C1}$G$${lv0}:$G$${lv1},${L}${r})+(${E}="%")*${F}/100*INDEX(${C1}$E$${lv0}:$E$${lv1},${L}${r}))`;
      const time = `((${G}="예")*${C3}$B$${segRow}/60+(${G}<>"예"))`;
      sh.f(r, k.supply, `SUMPRODUCT(${factor}*${amount}*${time}*(${H}+(${H}=""))*(${cnt}+(${cnt}="")))`, ST.calcDec);
      sh.num(r, k.extra, 0, ST.inNum);
      sh.f(r, k.cum, `${CU}${p}+${SP}${r}+${EX}${r}`);
      sh.f(r, k.end, `MIN(${C1}$B$6,MATCH(${CU}${r},${C1}$F$${lv0}:$F$${lv1},1))`);
      sh.f(r, k.stall, `IF(OR(${EN}${r}>${L}${r},${L}${r}>=${C1}$B$6),0,${STL}${p}+1)`);
    }
  });
  sh.cols = [[1, 1, 6], [2, 1 + cfg.segments.length * LAYOUT.segCols, 10]];
  sh.freeze = { col: 2, row: r0 + 1 };
  return sh;
}

/** ⑤ 검증의 행 위치 */
export function checkLayout(cfg) {
  const n = cfg.segments.length;
  const sum0 = 4, ms0 = sum0 + n + 2, src0 = ms0 + 2 + (cfg.milestones?.length || 0) + 1, lvl0 = src0 + 2 + LAYOUT.srcRows + 1;
  return { sum0, ms0, src0, lvl0, chartCol: 3 + 2 * n + 1 };
}

function checkSheet(cfg) {
  const sh = sheet(), n = cfg.segments.length, N = cfg.days, M = cfg.maxLevel, lay = checkLayout(cfg);
  const d0 = LAYOUT.dayRow0, d1 = LAYOUT.dayRow0 + N, lv0 = LAYOUT.levelRow0, lv1 = LAYOUT.levelRow0 + M - 1;
  const endRange = (s) => { const c = colName(segColumns(s).end); return `${C4}$${c}$${d0 + 1}:$${c}$${d1}`; };
  const reach = (Lref, s, miss) => `IF(COUNTIF(${endRange(s)},"<"&${Lref})>=${N},${miss},COUNTIF(${endRange(s)},"<"&${Lref})+1)`;
  sh.text(1, 1, '⑤ 검증 — 도달일·레벨당 일수·최장 무성장 기간·공급 비중', ST.title);
  sh.text(2, 1, `레벨 L 도달일 = 끝 레벨이 L보다 낮았던 날 수 + 1 (${N}일 안에 못 닿으면 미도달). 최장 무성장 = 레벨이 오르지 않고 이어진 날의 최댓값`, ST.note);
  // 세그먼트 요약
  ['세그먼트', `${N}일차 끝 레벨`, '최장 무성장 (일)', `Lv${M} 도달일`, '총 공급'].forEach((t, i) => sh.text(lay.sum0 - 1, 1 + i, t, ST.head));
  cfg.segments.forEach((_, s) => {
    const r = lay.sum0 + s, k = segColumns(s);
    sh.f(r, 1, `${C3}A${LAYOUT.segRow0 + s}`, ST.calcText);
    sh.f(r, 2, `${C4}${colName(k.end)}${d1}`);
    sh.f(r, 3, `MAX(${C4}${colName(k.stall)}${d0 + 1}:${colName(k.stall)}${d1})`);
    sh.f(r, 4, reach(M, s, '"미도달"'));
    sh.f(r, 5, `${C4}${colName(k.cum)}${d1}`);
  });
  // 마일스톤
  sh.text(lay.ms0, 1, '마일스톤 — 기준 세그먼트(③ B1)의 실제 도달일', ST.label);
  ['레벨', '목표일', '실제 도달일', '차이 (일)'].forEach((t, i) => sh.text(lay.ms0 + 1, 1 + i, t, ST.head));
  (cfg.milestones || []).forEach((m, i) => {
    const r = lay.ms0 + 2 + i;
    sh.num(r, 1, m.level, ST.inNum); sh.num(r, 2, m.day, ST.inNum);
    sh.f(r, 3, `CHOOSE(MATCH(${C3}$B$1,${C3}$A$${LAYOUT.segRow0}:$A$${LAYOUT.segRow0 + n - 1},0),${cfg.segments.map((_, s) => reach(`A${r}`, s, '"미도달"')).join(',')})`);
    sh.f(r, 4, `IF(ISNUMBER(C${r}),C${r}-B${r},"")`);
  });
  // 공급원 비중 (세그먼트별 기간 총량)
  sh.text(lay.src0, 1, `공급원별 ${N}일 총량과 비중`, ST.label);
  sh.text(lay.src0 + 1, 1, '공급원', ST.head);
  cfg.segments.forEach((_, s) => { sh.f(lay.src0 + 1, 2 + s, `${C3}A${LAYOUT.segRow0 + s}&" 총량"`, ST.head); sh.f(lay.src0 + 1, 2 + n + s, `${C3}A${LAYOUT.segRow0 + s}&" 비중"`, ST.head); });
  const dayR = `${C4}$A$${d0 + 1}:$A$${d1}`;
  for (let i = 0; i < LAYOUT.srcRows; i++) {
    const r = lay.src0 + 2 + i, sr = LAYOUT.srcRow0 + i;
    const P = (col) => `${C2}$${col}$${sr}`;
    sh.f(r, 1, `IF(${P('A')}="","",${P('A')})`, ST.calcText);
    cfg.segments.forEach((seg, s) => {
      const k = segColumns(s), col = (c, a, b) => `${C4}$${colName(c)}$${a}:$${colName(c)}$${b}`;
      const S = col(k.start, d0 + 1, d1), Pv = col(k.start, d0, d1 - 1), AT = col(k.att, d0 + 1, d1), WK = col(k.week, d0 + 1, d1);
      const unl = `((${P('C')}="일차")*(${dayR}>=${P('D')})+(${P('C')}="레벨")*(${S}>=${P('D')}))`;
      const factor = `((${P('B')}="매일")*${AT}*${unl}+(${P('B')}="매주")*(MOD(${dayR},7)=0)*(${WK}>0)*${unl}+(${P('B')}="1회")*((${P('C')}="일차")*(${dayR}=${P('D')})+(${P('C')}="레벨")*(${S}>=${P('D')})*(${Pv}<${P('D')})))`;
      const lvA = `${C1}$A$${lv0}:$A$${lv1}`;
      const amount = `((${P('E')}="고정")*${P('F')}+(${P('E')}="표")*${P('F')}*SUMIF(${lvA},${S},${C1}$G$${lv0}:$G$${lv1})+(${P('E')}="%")*${P('F')}/100*SUMIF(${lvA},${S},${C1}$E$${lv0}:$E$${lv1}))`;
      const segRow = LAYOUT.segRow0 + s, cnt = `${C2}$${colName(9 + s)}$${sr}`;
      const scalar = `((${P('G')}="예")*${C3}$B$${segRow}/60+(${P('G')}<>"예"))*(${P('H')}+(${P('H')}=""))*(${cnt}+(${cnt}=""))`;
      sh.f(r, 2 + s, `IF(${P('A')}="","",SUMPRODUCT(${factor}*${amount})*${scalar})`, ST.calcDec);
      const tot = `SUM(${colName(2 + s)}$${lay.src0 + 2}:${colName(2 + s)}$${lay.src0 + 1 + LAYOUT.srcRows})`;
      sh.f(r, 2 + n + s, `IF(${colName(2 + s)}${r}="","",IF(${tot}=0,0,${colName(2 + s)}${r}/${tot}))`, ST.pct);
    });
  }
  // 레벨별 도달일 · 레벨당 일수 (차트 원본, 못 닿으면 #N/A — 차트에서 빈칸)
  sh.text(lay.lvl0, 1, '레벨별 도달일과 레벨당 일수 (#N/A = 기간 안에 못 닿음)', ST.label);
  sh.text(lay.lvl0 + 1, 1, '레벨', ST.head);
  cfg.segments.forEach((_, s) => { sh.f(lay.lvl0 + 1, 2 + s, `${C3}A${LAYOUT.segRow0 + s}&" 도달일"`, ST.head); sh.f(lay.lvl0 + 1, 2 + n + s, `${C3}A${LAYOUT.segRow0 + s}&" 레벨당 일수"`, ST.head); });
  for (let L = 1; L <= M; L++) {
    const r = lay.lvl0 + 1 + L;
    sh.num(r, 1, L, ST.calcInt);
    cfg.segments.forEach((_, s) => {
      if (L === 1) sh.num(r, 2 + s, 0); else sh.f(r, 2 + s, reach(`A${r}`, s, 'NA()'));
      const c = colName(2 + s);
      if (L >= 2) sh.f(r, 2 + n + s, `IF(AND(ISNUMBER(${c}${r}),ISNUMBER(${c}${r - 1})),${c}${r}-${c}${r - 1},"")`);
    });
  }
  sh.cols = [[1, 1, 22], [2, 1 + 2 * n, 13]];
  sh.drawing = true;
  return sh;
}

// ── 차트 (세그먼트별 레벨 도달일) ─────────────────────────
function chartXml(cfg) {
  const n = cfg.segments.length, M = cfg.maxLevel, lay = checkLayout(cfg);
  const r0 = lay.lvl0 + 2, r1 = lay.lvl0 + 1 + M;
  const colors = ['2A78D6', 'EB6834', '1BAF7A', 'C98500', '7C5CC4', 'E5484D'];
  const sheetRef = `'${SHEETS.check}'!`;
  const ser = cfg.segments.map((seg, s) => `<c:ser><c:idx val="${s}"/><c:order val="${s}"/><c:tx><c:v>${esc(seg.name)}</c:v></c:tx><c:spPr><a:ln w="22225"><a:solidFill><a:srgbClr val="${colors[s % colors.length]}"/></a:solidFill></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker><c:cat><c:numRef><c:f>${esc(`${sheetRef}$A$${r0}:$A$${r1}`)}</c:f></c:numRef></c:cat><c:val><c:numRef><c:f>${esc(`${sheetRef}$${colName(2 + s)}$${r0}:$${colName(2 + s)}$${r1}`)}</c:f></c:numRef></c:val><c:smooth val="0"/></c:ser>`).join('');
  const axTitle = (t) => `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>세그먼트별 레벨 도달일</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:marker val="1"/><c:axId val="5001"/><c:axId val="5002"/></c:lineChart><c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${axTitle('레벨')}<c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:tickLblSkip val="${Math.max(1, Math.round(M / 12))}"/></c:catAx><c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/>${axTitle('일차')}<c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

function drawingXml(cfg) {
  const lay = checkLayout(cfg), c0 = lay.chartCol - 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><xdr:twoCellAnchor><xdr:from><xdr:col>${c0}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${c0 + 9}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>24</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="도달일 차트"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
}

/** 설정 → .xlsx 바이트 (Uint8Array) */
export function buildXlsx(cfg) {
  const sheets = [curveSheet(cfg), sourcesSheet(cfg), segmentsSheet(cfg), daysSheet(cfg), checkSheet(cfg)];
  const names = [SHEETS.curve, SHEETS.sources, SHEETS.segs, SHEETS.days, SHEETS.check];
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>성장 표 템플릿</dc:title><dc:creator>기획 워크벤치</dc:creator></cp:coreProperties>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sh) })),
    { name: 'xl/worksheets/_rels/sheet5.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>` },
    { name: 'xl/drawings/drawing1.xml', data: drawingXml(cfg) },
    { name: 'xl/drawings/_rels/drawing1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>` },
    { name: 'xl/charts/chart1.xml', data: chartXml(cfg) },
  ];
  return makeZip(files);
}
