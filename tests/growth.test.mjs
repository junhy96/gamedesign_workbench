// 실행: npm test  (node --test)
// 성장 엑셀 표 템플릿: 계산 규칙, 프리셋, base·증가율 풀이, .xlsx 구조, 그리고 "내보낸 엑셀을 LibreOffice로 다시 계산한 값 = JS 참조 계산"
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { levelCurve, runSegment, analyze, solveBase, solveRate, validate } from '../js/growth/model.js';
import { TEMPLATES } from '../js/growth/presets.js';
import { buildXlsx, SHEETS, LAYOUT, segColumns, checkLayout } from '../js/growth/xlsx.js';
import { readZip, makeZip } from '../js/lib/zip.js';

const base = (over = {}) => ({
  days: 21, maxLevel: 10, ref: 0,
  curve: { base: 100, bands: [{ from: 1, rate: 10 }], jumps: [], jumpMult: 1.3, cap: 0 },
  table: { start: 10, rate: 0 },
  sources: [], segments: [{ name: 'A', minutes: 60, days: [1, 1, 1, 1, 1, 1, 1] }], milestones: [],
  ...over,
});
const src = (o) => ({ name: 's', period: 'daily', unlock: 'day', unlockAt: 1, method: 'fixed', value: 100, timed: false, mult: 1, counts: [1], ...o });

test('레벨 곡선: 구간별 증가율·점프·상한, 누적', () => {
  const c = levelCurve(base({ curve: { base: 100, bands: [{ from: 1, rate: 10 }, { from: 4, rate: 0 }], jumps: [6], jumpMult: 2, cap: 0 } }));
  assert.deepEqual(c.need.slice(1, 8), [100, 110, 121, 121, 121, 242, 242]); // Lv4부터 0%, Lv6 점프 ×2
  assert.deepEqual(c.cum.slice(1, 5), [0, 100, 210, 331]);
  const capped = levelCurve(base({ curve: { base: 100, bands: [{ from: 1, rate: 50 }], jumps: [], jumpMult: 1, cap: 200 } }));
  assert.deepEqual(capped.need.slice(1, 5), [100, 150, 200, 200]);
  // 단일 구간·점프 = base × (1+r)^(L−1) × J^(L 이하 점프 수) (반올림 전)
  const one = levelCurve(base({ maxLevel: 40, curve: { base: 1000, bands: [{ from: 1, rate: 7 }], jumps: [10, 20], jumpMult: 1.3, cap: 0 } }));
  for (const L of [1, 9, 10, 19, 20, 40]) assert.ok(Math.abs(one.raw[L] - 1000 * 1.07 ** (L - 1) * 1.3 ** [10, 20].filter(j => j <= L).length) < 1e-6, `L${L}`);
});

test('공급 규칙: 매일은 접속한 날, 매주는 그 주에 접속했을 때 7의 배수 일차, 1회는 한 번', () => {
  const seg = { name: 'A', minutes: 60, days: [1, 0, 0, 0, 0, 0, 0] }; // 월요일만 접속
  const cfg = base({ segments: [seg], curve: { base: 1e9, bands: [{ from: 1, rate: 0 }], jumps: [], jumpMult: 1, cap: 0 },
    sources: [src({ name: '매일', value: 1 }), src({ name: '매주', period: 'weekly', value: 10 }), src({ name: '7일차 1회', period: 'once', unlockAt: 7, value: 1000 })] });
  const r = runSegment(cfg, levelCurve(cfg), 0);
  assert.deepEqual(r.bySource, [3, 30, 1000]); // 1·8·15일차 접속, 7·14·21일차 주간, 7일차 1회 (접속과 무관)
  assert.equal(r.rows[7].supply, 10 + 1000);
});

test('1회(레벨 기준)는 시작 레벨이 처음 그 레벨 이상이 된 날 한 번, 시간 비례·표·% 방식', () => {
  const cfg = base({ maxLevel: 20, days: 30, table: { start: 50, rate: 0 },
    sources: [src({ value: 150 }), src({ name: '레벨5', period: 'once', unlock: 'level', unlockAt: 5, value: 7 })] });
  const curve = levelCurve(cfg), r = runSegment(cfg, curve, 0);
  assert.equal(r.bySource[1], 7);
  const day = r.rows.findIndex(x => x.d > 0 && x.start >= 5);
  assert.equal(r.rows[day].supply, 150 + 7);
  const t = base({ table: { start: 50, rate: 0 }, segments: [{ name: 'A', minutes: 90, days: [1, 1, 1, 1, 1, 1, 1] }],
    sources: [src({ method: 'table', value: 2, timed: true }), src({ method: 'pct', value: 10 })] });
  const rt = runSegment(t, levelCurve(t), 0);
  assert.equal(rt.rows[1].supply, 2 * 50 * 1.5 + 0.1 * 100); // 표 × 90분/60 + Lv1 필요량의 10%
});

test('무성장 연속·도달일·최대 레벨 이후는 무성장으로 안 셈', () => {
  const cfg = base({ maxLevel: 4, days: 12, curve: { base: 100, bands: [{ from: 1, rate: 0 }], jumps: [], jumpMult: 1, cap: 0 }, sources: [src({ value: 40 })] });
  const r = runSegment(cfg, levelCurve(cfg), 0);
  assert.deepEqual(r.reach.slice(2, 5), [3, 5, 8]); // 누적 120·200·320 → Lv2 3일차, Lv3 5일차, Lv4 8일차
  assert.equal(r.maxStall, 2);
  assert.equal(r.rows.at(-1).stall, 0); // Lv4(최대) 뒤
});

test('프리셋: 두 마일스톤에 기준 세그먼트가 정확히 닿음, 검증 문장', () => {
  for (const [id, t] of Object.entries(TEMPLATES)) {
    const r = analyze(t.make());
    assert.ok(r.ok, id);
    for (const m of r.milestones) assert.equal(m.actual, m.day, `${id} Lv${m.level}`);
    assert.ok(r.warnings.every(w => w.text), id);
  }
  const mmo = analyze(TEMPLATES.mmo.make());
  assert.equal(mmo.segs[0].maxStall, 6); // 라이트(주 4일·40분)는 최장 6일 멈춤
  assert.equal(mmo.segs[0].endLevel, 45);
});

test('base 자동 풀이: 목표일 이하로 닿는 가장 큰 base (하나 크면 늦음), 증가율까지', () => {
  const cfg = TEMPLATES.mmo.make();
  cfg.curve.base = 9999;
  const s = solveBase(cfg);
  assert.ok(s.feasible);
  const reach = (b) => analyze({ ...cfg, curve: { ...cfg.curve, base: b } }).segs[cfg.ref].reach[cfg.milestones[0].level];
  assert.ok(reach(s.base) <= cfg.milestones[0].day && reach(s.base + 1) > cfg.milestones[0].day);
  const k = solveRate(TEMPLATES.idle.make());
  assert.ok(k.feasible && k.k > 0);
  assert.equal(solveBase(base({ milestones: [{ level: 9, day: 1 }], sources: [src({ value: 1 })] })).feasible, false); // 공급이 너무 적음
});

test('설정 확인', () => {
  assert.ok(validate(base({ maxLevel: 1 })).length);
  assert.ok(validate(base({ curve: { base: 100, bands: [{ from: 3, rate: 1 }], jumps: [], jumpMult: 1, cap: 0 } })).some(e => e.includes('시작 레벨은 1')));
  assert.equal(validate(base()).length, 0);
});

// ── .xlsx ───────────────────────────────────────────────
const unzip = (bytes) => Object.fromEntries(readZip(bytes).map(f => [f.name, new TextDecoder().decode(f.data)]));

test('.xlsx 구조: 5개 시트·차트·드롭다운, 계산 칸은 수식, 값 없는 수식', () => {
  const cfg = TEMPLATES.mmo.make();
  const files = unzip(buildXlsx(cfg));
  for (const n of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/charts/chart1.xml', 'xl/drawings/drawing1.xml']) assert.ok(files[n], n);
  for (const n of Object.values(SHEETS)) assert.ok(files['xl/workbook.xml'].includes(`name="${n}"`), n);
  const s4 = files['xl/worksheets/sheet4.xml'];
  const formulas = (s4.match(/<f>/g) || []).length;
  assert.equal(formulas, cfg.segments.length * (cfg.days * 7 + 1)); // 일차 행마다 7개 수식 + 머리 이름
  assert.ok(!/undefined|NaN/.test(Object.values(files).join('')));
  assert.ok(files['xl/worksheets/sheet2.xml'].includes('<formula1>&quot;매일,매주,1회&quot;</formula1>'));
  assert.ok(files['xl/workbook.xml'].includes('fullCalcOnLoad="1"'));
  // 공급 수식은 ② 전체 범위(100행)를 본다 → 행을 더하면 자동 반영
  assert.ok(s4.includes(`$B$${LAYOUT.srcRow0}:$B$${LAYOUT.srcRow0 + LAYOUT.srcRows - 1}`));
});

// LibreOffice로 다시 계산 (없으면 건너뜀)
function findSoffice() {
  const cands = [process.env.SOFFICE, 'C:/Program Files/LibreOffice/program/soffice.com', '/usr/bin/soffice', '/usr/local/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'];
  return cands.find(p => p && existsSync(p)) || null;
}
const SOFFICE = findSoffice();

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function recalc(xlsxByName) {
  const dir = mkdtempSync(join(tmpdir(), 'growth-'));
  for (const [n, b] of Object.entries(xlsxByName)) writeFileSync(join(dir, `${n}.xlsx`), b);
  const r = spawnSync(SOFFICE, [`-env:UserInstallation=file:///${join(dir, 'profile').replace(/\\/g, '/')}`, '--headless', '--convert-to', 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1', '--outdir', join(dir, 'csv'), ...Object.keys(xlsxByName).map(n => join(dir, `${n}.xlsx`))], { timeout: 240000, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('LibreOffice 실패: ' + (r.stderr || r.error));
  const out = {};
  for (const f of readdirSync(join(dir, 'csv'))) out[f.replace(/\.csv$/, '')] = parseCsv(readFileSync(join(dir, 'csv', f), 'utf8'));
  rmSync(dir, { recursive: true, force: true });
  return out;
}

/** 엑셀 재계산 결과(④·⑤)와 JS 참조 계산 비교 */
function compare(csv, name, cfg) {
  const r = analyze(cfg);
  const days = csv[`${name}-${SHEETS.days}`], check = csv[`${name}-${SHEETS.check}`];
  const all = Object.entries(csv).filter(([k]) => k.startsWith(name + '-')).map(([, v]) => v.flat().join(','));
  assert.ok(!all.some(t => /Err:|#VALUE|#REF|#NAME|#DIV/.test(t)), `${name}: 수식 오류`);
  r.segs.forEach((s, si) => {
    const k = segColumns(si);
    for (let d = 1; d <= cfg.days; d++) {
      const row = days[LAYOUT.dayRow0 + d - 1];
      const at = (c) => +row[c - 1];
      assert.equal(at(k.end), s.rows[d].end, `${name} ${s.seg.name} ${d}일차 끝 레벨`);
      assert.equal(at(k.start), s.rows[d].start, `${name} ${s.seg.name} ${d}일차 시작 레벨`);
      assert.equal(at(k.stall), s.rows[d].stall, `${name} ${s.seg.name} ${d}일차 무성장`);
      assert.ok(Math.abs(at(k.cum) - s.rows[d].cum) <= 1e-6 * Math.max(1, s.rows[d].cum), `${name} ${s.seg.name} ${d}일차 누적 ${at(k.cum)} vs ${s.rows[d].cum}`);
    }
    const lay = checkLayout(cfg);
    const sum = check[lay.sum0 - 1 + si];
    assert.equal(+sum[1], s.endLevel); assert.equal(+sum[2], s.maxStall);
    for (let L = 2; L <= cfg.maxLevel; L++) {
      const v = check[lay.lvl0 + L][1 + si];
      assert.equal(v === '#N/A' ? null : +v, s.reach[L], `${name} ${s.seg.name} Lv${L} 도달일`);
    }
    s.bySource.forEach((tot, i) => {
      const v = +check[lay.src0 + 1 + i][1 + si];
      assert.ok(Math.abs(v - tot) <= 1e-6 * Math.max(1, tot), `${name} ${s.seg.name} 공급원 ${i + 1} 총량 ${v} vs ${tot}`);
    });
  });
  (r.milestones).forEach((m, i) => assert.equal(+check[checkLayout(cfg).ms0 + 1 + i][2], m.actual, `${name} 마일스톤 Lv${m.level}`));
}

test('엑셀 재계산 = JS 참조 계산 (프리셋 전부 + 공급원 행을 엑셀에서 추가한 경우)', { skip: !SOFFICE && 'LibreOffice 없음', timeout: 300000 }, () => {
  const xs = {}, cfgs = {};
  for (const [id, t] of Object.entries(TEMPLATES)) { cfgs[id] = t.make(); xs[id] = buildXlsx(cfgs[id]); }
  // 사용자가 ② 빈 행에 콘텐츠를 적은 상황: 내보낸 파일의 sheet2를 직접 고쳐 한 행을 채운다
  const cfg = TEMPLATES.mmo.make();
  const added = { name: '이벤트 던전', period: 'daily', unlock: 'day', unlockAt: 10, method: 'pct', value: 5, timed: false, mult: 1, counts: [1, 1, 1] };
  const files = readZip(xs.mmo);
  const r = LAYOUT.srcRow0 + cfg.sources.length;
  const cell = (c, inner) => `<c r="${c}${r}" s="3" t="inlineStr"><is><t xml:space="preserve">${inner}</t></is></c>`;
  const num = (c, v) => `<c r="${c}${r}" s="4"><v>${v}</v></c>`;
  const rowXml = `<row r="${r}">${cell('A', added.name)}${cell('B', '매일')}${cell('C', '일차')}${num('D', 10)}${cell('E', '%')}${num('F', 5)}${cell('G', '아니오')}</row>`; // 배율·횟수는 비움(= 1)
  const patched = files.map(f => {
    if (f.name !== 'xl/worksheets/sheet2.xml') return { name: f.name, data: f.data };
    const xml = new TextDecoder().decode(f.data).replace(new RegExp(`<row r="${r}">.*?</row>`), rowXml);
    return { name: f.name, data: xml };
  });
  xs.added = makeZip(patched);
  cfgs.added = { ...cfg, sources: [...cfg.sources, added] };
  const csv = recalc(xs);
  for (const id of Object.keys(xs)) compare(csv, id, cfgs[id]);
  // 추가한 행이 실제로 결과를 바꿨는지
  assert.notEqual(analyze(cfgs.added).segs[1].reach[50], analyze(cfg).segs[1].reach[50]);
});
