// 방치형 스테이지 성장 — 화면: 왼쪽 설정(구조·몬스터·골드·의도 체류), 오른쪽 체류 그래프 → 강화 비용 구간 표 → 챕터 표·검증
import { analyze, fmtBig, fmtBigShort, fmtDur, continuedInit, parseIntervalsCSV, intervalsToCSV, CSV_FIELDS, sensitivity, solveLevers } from './model.js';
import { TEMPLATES } from './presets.js';
import { h, store, encodeState, decodeState, downloadJSON, downloadText, pickJSON, toast, debounce, comma } from '../lib/util.js';

const SCHEMA = 1;
const STORE_KEY = 'stage:v1';
const MODEL = [
  '몬스터 체력 hp(s) = hp0 × hpGrowth^(s−1), 웨이브 골드 g(s) = gold0 × goldGrowth^(s−1)',
  '공격력 atk(L) = atk0 + atkPerLevel × L,  돌파 조건 atk × waveLimit ≥ monstersPerWave × hp(s)',
  '레벨 L → L+1 비용 = 구간 initCost + step × (L − lvMin),  누적 비용은 구간별 등차수열 합',
  '실제 체류(s−1) = max((누적비용(L_req(s)) − 누적비용(L_req(s−1))) ÷ (g(s−1) ÷ waveSeconds), wavesPerStage × waveSeconds)',
  '정체 = 실제 체류 > stagnationRatio × 의도 체류',
];
const VIEWS = { dwell: '스테이지별 체류', elapsed: '누적 시간', level: '필요 레벨·비용 구간' };

let state, last, timer, chart;
const els = {};
const opened = new Set(); // 펼친 챕터
const save = debounce(() => store.set(STORE_KEY, state), 300);
const schedule = (ms = 150) => { clearTimeout(timer); timer = setTimeout(recompute, ms); };

function defaultState(id) { return { v: SCHEMA, template: id, view: 'dwell', numFmt: 'kr', sensPct: 10, ...TEMPLATES[id].make() }; }
function hydrate(o) {
  if (o?.tool === 'stage' && o.state) o = o.state; // 'JSON 저장' 파일(머리 정보 + state)도 그대로 받음
  return o && o.v === SCHEMA && TEMPLATES[o.template] ? { ...defaultState(o.template), ...o } : null;
}
function readHash() { const m = location.hash.match(/^#stage\?s=([\w-]+)/); return m ? hydrate(decodeState(m[1])) : null; }
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const big = (n) => fmtBig(n, state.numFmt);
const lv = (n) => `Lv${comma(n)}`;
const range = (iv) => `${comma(iv.lvMin)} ~ ${iv.lvMax == null ? '끝 없음' : comma(iv.lvMax)}`;

export function mount(root) {
  state = readHash() || hydrate(store.get(STORE_KEY)) || defaultState('idle');
  if (location.hash.startsWith('#stage?')) history.replaceState(null, '', '#stage');
  build(root);
  rebuild();
  document.addEventListener('themechange', () => last && drawChart(last));
  window.addEventListener('hashchange', () => { const st = readHash(); if (st) { state = st; opened.clear(); history.replaceState(null, '', '#stage'); rebuild(); } });
}

// ── 골격 ────────────────────────────────────────────────
function build(root) {
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '방치형 스테이지 성장'),
        h('p', {}, '챕터-스테이지별 몬스터 체력·웨이브 골드와 골드 강화 구간 비용 공식으로, 스테이지마다 실제로 얼마나 머무는지 계산해 의도한 체류 시간과 비교합니다. 레벨이 수십만까지 가므로 레벨별 표 대신 구간(LV_MIN~LV_MAX, 시작 비용 + 증가폭) 단위로 다룹니다.'),
      ),
      h('div.tool-actions', {},
        h('button.btn', { type: 'button', onclick: copyShareLink }, '공유 링크'),
        h('button.btn', { type: 'button', onclick: exportStagesCSV }, '스테이지 CSV'),
        h('button.btn', { type: 'button', onclick: saveJSON }, 'JSON 저장'),
        h('button.btn', { type: 'button', onclick: importJSON }, '불러오기'),
      ),
    ),
    h('div.enh-layout', {},
      els.side = h('aside.enh-side', { 'aria-label': '설정' }),
      h('div.enh-main', {},
        els.errors = h('ul.errors', { hidden: true }),
        els.kpis = h('div.kpis.econ-kpis'),
        h('div.card.role-out', {},
          h('div.card-head', {}, h('h2', {}, '실제 체류 vs 의도 체류'), els.chartHint = h('span.hint', {})),
          els.viewTabs = h('div.seg-tabs', {}),
          h('div.chart-box.tall', {}, els.canvas = h('canvas', { role: 'img', 'aria-label': '스테이지별 실제 체류 시간과 의도 체류 시간' })),
        ),
        els.warnCard = h('div.card.role-check'),
        els.diagCard = h('div.card.role-tool'),
        els.ivCard = h('div.card.role-in'),
        els.chapterCard = h('div.card.role-out'),
      ),
    ),
  );
}

// ── 공용 입력 ───────────────────────────────────────────
const field = (label, input, hint) => h('label.field', {}, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
function num(obj, key, opts = {}) {
  return h('input', {
    type: 'number', value: obj[key], step: opts.step ?? 'any', min: opts.min, 'aria-label': opts.label, class: opts.cls,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { obj[key] = opts.int ? Math.round(v) : v; opts.after?.(); schedule(); } },
  });
}
const select = (options, value, onchange) => h('select', { onchange: (e) => onchange(e.target.value) }, ...options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));

// 증가율(배/스테이지)은 %로 입력: 1.04 ↔ 4. 0.1%만 바뀌어도 총 소요가 수십 % 흔들리므로 0.01%p 단위
const pctOf = (g) => +((g - 1) * 100).toPrecision(10);
function pctNum(obj, key, label) {
  return h('input', {
    type: 'number', value: pctOf(obj[key]), step: 0.01, 'aria-label': label,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v > -100) { obj[key] = +(1 + v / 100).toPrecision(12); refreshLive(); schedule(); } },
  });
}

// 입력에 따라 바뀌는 요약·안내 글자 (메뉴를 다시 그리면 입력 중인 칸이 포커스를 잃으므로 글자만 갱신)
let live = [];
const liveText = (tag, fn) => { const el = h(tag, {}, fn()); live.push([el, fn]); return el; };
function refreshLive() { for (const [el, fn] of live) el.textContent = fn(); }

const OPEN_KEY = 'stage:sideOpen';
function section(id, title, summary, ...body) {
  const open = (store.get(OPEN_KEY) || {})[id] ?? (id === 'base' || matchMedia('(min-width: 1101px)').matches);
  return h('details.side-sec', { open, ontoggle: (e) => store.set(OPEN_KEY, { ...(store.get(OPEN_KEY) || {}), [id]: e.target.open }) },
    h('summary', {}, h('span.side-title', {}, title), typeof summary === 'function' ? liveText('span.side-sum', summary) : summary ? h('span.side-sum', {}, summary) : null),
    h('div.side-body', {}, ...body.filter(Boolean)));
}

// ── 왼쪽 메뉴 ───────────────────────────────────────────
function renderSide() {
  const s = state, d = s.intendedDwell;
  const resum = refreshLive;
  const growthHint = (key) => () => `×${s[key]} / 스테이지 · 챕터당 ×${(s[key] ** s.stagesPerChapter).toFixed(2)}`;
  live = [];
  els.side.replaceChildren(
    section('base', '템플릿 · 구조', () => `${s.chapters}챕터 × ${s.stagesPerChapter}`,
      select(Object.entries(TEMPLATES).map(([id, t]) => [id, t.label]), s.template, (v) => { state = defaultState(v); opened.clear(); rebuild(); }),
      h('p.desc', {}, TEMPLATES[s.template].note),
      h('div.row2', {},
        field('챕터 수', num(s, 'chapters', { int: true, min: 1, label: '챕터 수', after: resum })),
        field('챕터당 스테이지', num(s, 'stagesPerChapter', { int: true, min: 1, label: '챕터당 스테이지', after: resum }))),
      field('큰 수 표시', select([['kr', '만·억·조·경 (25억 7,633만)'], ['exp', '지수 (2.58e9)']], s.numFmt, (v) => { s.numFmt = v; save(); renderIntervals(); recompute(); }),
        '1해(10²⁰) 이상은 한국식에서도 지수로 표시합니다'),
    ),
    section('monster', '몬스터 · 웨이브', () => `체력 +${pctOf(s.hpGrowth)}%/스테이지`,
      h('div.row2', {},
        field('첫 몬스터 체력', num(s, 'hp0', { min: 0, label: '첫 몬스터 체력' })),
        h('label.field', {}, h('span', {}, '체력 증가 (%/스테이지)'), pctNum(s, 'hpGrowth', '체력 증가율 (%)'), liveText('small', growthHint('hpGrowth')))),
      h('div.row2', {},
        field('웨이브당 몬스터', num(s, 'monstersPerWave', { min: 1, label: '웨이브당 몬스터' })),
        field('웨이브 제한 (초)', num(s, 'waveLimit', { min: 0, label: '웨이브 제한 시간' }))),
      h('div.row2', {},
        field('웨이브 시간 (초)', num(s, 'waveSeconds', { min: 0, label: '웨이브 시간' })),
        field('돌파 웨이브 수', num(s, 'wavesPerStage', { int: true, min: 0, label: '돌파 웨이브 수' }))),
      h('p.desc', {}, '돌파 조건: 공격력 × 제한 시간 ≥ 몬스터 수 × 체력. 레벨이 이미 충분하면 돌파 웨이브 수 × 웨이브 시간만 머뭅니다.'),
    ),
    section('gold', '골드 · 공격력', () => `골드 +${pctOf(s.goldGrowth)}%/스테이지`,
      h('div.row2', {},
        field('첫 웨이브 골드', num(s, 'gold0', { min: 0, label: '첫 웨이브 골드' })),
        h('label.field', {}, h('span', {}, '골드 증가 (%/스테이지)'), pctNum(s, 'goldGrowth', '골드 증가율 (%)'), liveText('small', growthHint('goldGrowth')))),
      h('div.row2', {},
        field('기본 공격력', num(s, 'atk0', { label: '기본 공격력' })),
        field('레벨당 공격력', num(s, 'atkPerLevel', { min: 0, label: '레벨당 공격력' }))),
      h('p.desc', {}, '다음 스테이지를 열 레벨까지 지금 스테이지 웨이브 골드로 강화한다고 봅니다 (방치 파밍).'),
    ),
    section('intent', '의도 체류 · 정체 기준', () => `${d.baseSeconds}초 × ${d.perChapterMult}ⁿ · ${s.stagnationRatio}배`,
      h('div.row2', {},
        field('1챕터 의도 (초/스테이지)', num(d, 'baseSeconds', { min: 0, label: '1챕터 의도 체류', after: resum })),
        field('챕터마다 배수', num(d, 'perChapterMult', { min: 0, step: 0.05, label: '챕터당 배수', after: resum }))),
      h('label.field', {}, h('span', {}, '정체 기준 (의도의 n배 초과)'), num(s, 'stagnationRatio', { min: 1, step: 0.5, label: '정체 기준', after: resum }),
        liveText('small', () => `챕터 c의 의도 체류 = ${d.baseSeconds}초 × ${d.perChapterMult}^(c−1). 실제가 그 ${s.stagnationRatio}배를 넘으면 정체, 1/${s.stagnationRatio} 미만이면 너무 빠름`)),
    ),
  );
}

// ── 강화 비용 구간 표 ───────────────────────────────────
function renderIntervals() {
  const ivs = state.costIntervals;
  els.ivOut = [];
  els.ivCard.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '골드 강화 비용 구간'), h('span.hint', {}, '레벨 L → L+1 비용 = 시작 비용 + 증가폭 × (L − LV_MIN) · 마지막 구간 LV_MAX 비움 = 끝 없음')),
    h('div.table-wrap', {}, h('table.edit-table.iv-table', {},
      h('thead', {}, h('tr', {},
        h('th.left', {}, '#'), h('th', {}, 'LV_MIN'), h('th', {}, 'LV_MAX'), h('th', {}, '시작 비용'), h('th', {}, '증가폭'),
        h('th', { title: '구간 마지막 레벨을 올리는 1회 비용' }, '끝 1레벨 비용'), h('th', { title: '구간 전체를 올리는 골드' }, '구간 합계'),
        h('th', { title: '앞 구간 끝 비용 + 증가폭에서 이어지는지' }, '경계'),
        h('th.left', { title: '이 구간 레벨을 요구하는 스테이지와 그중 정체 수' }, '요구 스테이지'), h('th', {}, ''))),
      h('tbody', {}, ...ivs.map((iv, i) => {
        const o = els.ivOut[i] = { min: h('span.iv-min', {}), end: h('td.res', {}), total: h('td.res', {}), jump: h('td.res', {}), stages: h('td.res.left', {}) };
        const isLast = i === ivs.length - 1;
        return h('tr', {},
          h('td.left.muted', {}, String(i + 1)),
          h('td', {}, i === 0 ? num(iv, 'lvMin', { int: true, min: 0, label: '첫 구간 LV_MIN' }) : o.min),
          h('td', {}, h('input', {
            type: 'number', value: iv.lvMax ?? '', min: 0, step: 1, placeholder: isLast ? '끝 없음' : '', 'aria-label': `구간 ${i + 1} LV_MAX`,
            oninput: (e) => {
              const raw = e.target.value.trim();
              if (raw === '' && isLast) iv.lvMax = null;
              else { const v = parseFloat(raw); if (!Number.isFinite(v)) return; iv.lvMax = Math.round(v); }
              if (ivs[i + 1] && iv.lvMax != null) ivs[i + 1].lvMin = iv.lvMax; // 다음 구간 시작을 함께 옮겨 끊기지 않게
              schedule();
            },
          })),
          h('td', {}, num(iv, 'initCost', { min: 0, label: `구간 ${i + 1} 시작 비용`, cls: 'cost' })),
          h('td', {}, num(iv, 'step', { min: 0, label: `구간 ${i + 1} 증가폭`, cls: 'short' })),
          o.end, o.total, o.jump, o.stages,
          h('td.x', {}, h('button.icon-x', { type: 'button', title: '구간 삭제 (앞 구간이 이 구간 끝까지 늘어남)', disabled: ivs.length <= 1, onclick: () => removeInterval(i) }, '×')),
        );
      })),
    )),
    h('div.table-foot', {},
      h('div.tool-actions', {},
        h('button.btn.small', { type: 'button', onclick: addInterval }, '+ 구간 추가'),
        h('button.btn.small', { type: 'button', title: '2번째 구간부터 시작 비용을 앞 구간 끝 비용 + 증가폭으로 맞춤', onclick: chainInits }, '시작 비용 이어 붙이기'),
      ),
      h('div.tool-actions', {},
        h('button.btn.small', { type: 'button', onclick: () => toggleImport() }, 'CSV 가져오기'),
        h('button.btn.small', { type: 'button', onclick: () => downloadText(`stage-cost-intervals-${state.template}.csv`, intervalsToCSV(state.costIntervals), 'text/csv') }, 'CSV 내보내기'),
      ),
    ),
    els.importBox = h('div.csv-import', { hidden: !els.importOpen }),
  );
  if (els.importOpen) renderImport();
}

function addInterval() {
  const ivs = state.costIntervals, lastIv = ivs.at(-1);
  if (lastIv.lvMax == null) lastIv.lvMax = Math.max(lastIv.lvMin + 1, lastIv.lvMin * 2 || 1000);
  ivs.push({ lvMin: lastIv.lvMax, lvMax: null, initCost: continuedInit(lastIv), step: lastIv.step });
  rebuild();
}
function removeInterval(i) {
  const ivs = state.costIntervals;
  const [gone] = ivs.splice(i, 1);
  if (i > 0) ivs[i - 1].lvMax = gone.lvMax; // 앞 구간이 지운 구간 끝까지 (마지막을 지우면 끝 없음 이어받음)
  else ivs[0].lvMin = gone.lvMin;
  rebuild();
}
function chainInits() {
  const ivs = state.costIntervals;
  for (let i = 1; i < ivs.length; i++) if (ivs[i - 1].lvMax != null) ivs[i].initCost = continuedInit(ivs[i - 1]);
  rebuild();
  toast('시작 비용을 앞 구간에 이어 붙였습니다');
}

// ── CSV 가져오기 (붙여넣기·파일, 열 이름 매핑) ──────────
const imp = { text: '', mapping: null, parsed: null };
function toggleImport() {
  els.importOpen = !els.importOpen;
  els.importBox.hidden = !els.importOpen;
  if (els.importOpen) renderImport();
}
function parseImport() { imp.parsed = imp.text.trim() ? parseIntervalsCSV(imp.text, imp.mapping) : null; renderImportResult(); }
function renderImport() {
  els.importBox.replaceChildren(
    h('div.csv-head', {},
      h('b', {}, 'CSV 가져오기'),
      h('span.muted.small', {}, `열: ${Object.values(CSV_FIELDS).join(', ')} · 엑셀에서 복사한 표(탭 구분)도 됩니다 · LV_MAX 빈 칸 = 끝 없음, 열이 없으면 다음 줄 LV_MIN`),
    ),
    h('textarea.csv-text', {
      rows: 6, spellcheck: false, value: imp.text, placeholder: 'LV_MIN,LV_MAX,INIT_COST,STEP\n0,200,50,4.5\n200,1000,950,9\n…\n100000,,1690150,15',
      'aria-label': 'CSV 붙여넣기', oninput: debounce((e) => { imp.text = e.target.value; imp.mapping = null; parseImport(); }, 250),
    }),
    h('div.tool-actions', {},
      h('button.btn.small', { type: 'button', onclick: pickCSV }, '파일 선택'),
      h('button.btn.small', { type: 'button', onclick: () => { els.importOpen = false; els.importBox.hidden = true; } }, '닫기'),
    ),
    els.importResult = h('div.csv-result', {}),
  );
  parseImport();
}
function pickCSV() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.csv,.tsv,.txt,text/csv' });
  input.onchange = async () => {
    try { imp.text = await input.files[0].text(); imp.mapping = null; renderImport(); }
    catch { toast('파일을 읽지 못했습니다'); }
  };
  input.click();
}
function renderImportResult() {
  const p = imp.parsed;
  if (!p) { els.importResult.replaceChildren(); return; }
  const cols = [[-1, '(없음)'], ...p.header.map((c, i) => [i, c || `열 ${i + 1}`])];
  const setMap = (key, v) => { imp.mapping = { hasHeader: p.hasHeader, map: { ...p.map, [key]: Number(v) } }; parseImport(); };
  els.importResult.replaceChildren(
    h('div.csv-map', {},
      ...Object.entries(CSV_FIELDS).map(([key, name]) => h('label.mini-field', {}, h('span', { title: key === 'lvMax' ? '열이 없으면 다음 줄 LV_MIN으로 채움' : null }, name), select(cols, p.map?.[key] ?? -1, (v) => setMap(key, v)))),
      h('label.check', {}, h('input', { type: 'checkbox', checked: !!p.hasHeader, onchange: (e) => { imp.mapping = { hasHeader: e.target.checked, map: p.map }; parseImport(); } }), '첫 줄 = 열 이름'),
    ),
    p.errors.length
      ? h('ul.errors', {}, ...p.errors.slice(0, 6).map(e => h('li', {}, e)))
      : h('div.csv-ok', {},
        h('span', {}, `${p.intervals.length}개 구간 · Lv${comma(p.intervals[0].lvMin)} ~ ${p.intervals.at(-1).lvMax == null ? '끝 없음' : `Lv${comma(p.intervals.at(-1).lvMax)}`}`),
        h('button.btn.small.primary', { type: 'button', onclick: () => { state.costIntervals = p.intervals.map(iv => ({ ...iv })); els.importOpen = false; rebuild(); toast(`비용 구간 ${p.intervals.length}개를 가져왔습니다`); } }, '구간 표 바꾸기'),
      ),
  );
}

function rebuild() { renderSide(); renderIntervals(); recompute(); }

// ── 계산·표시 ───────────────────────────────────────────
function recompute() {
  save();
  const res = analyze(state);
  if (!res.ok) {
    els.errors.replaceChildren(...res.errors.slice(0, 8).map(e => h('li', {}, e)));
    els.errors.hidden = false;
    return;
  }
  els.errors.hidden = true;
  last = res;
  renderKPIs(res);
  fillIntervals(res);
  renderViewTabs();
  drawChart(res);
  renderChapters(res);
  renderWarnings(res);
  renderDiag(res);
}

function renderKPIs(res) {
  const longest = res.stages.reduce((a, b) => (b.dwellSec > a.dwellSec ? b : a));
  const lastSt = res.stages.at(-1);
  const stagCh = [...new Set(res.stagnant.map(x => x.chapter))];
  const kpi = (label, value, sub, cls = '') => h(`div.card.kpi${cls}`, {}, h('div.kpi-label', {}, label), h('div.kpi-value', { title: value }, value), ...[].concat(sub).map(t => h('div.kpi-sub', {}, t)));
  els.kpis.replaceChildren(
    kpi(`${lastSt.label}까지 총 소요`, fmtDur(res.totalSec), [`${res.totalHours.toFixed(1)}시간 · 의도 ${fmtDur(res.intendedTotalSec)}의 ${(res.totalSec / res.intendedTotalSec).toFixed(2)}배`], '.hero'),
    kpi('정체 스테이지', `${res.stagnant.length}곳`, res.stagnant.length ? [`${stagCh.join('·')}챕터`, `의도의 ${state.stagnationRatio}배 초과`] : [`의도의 ${state.stagnationRatio}배를 넘는 곳 없음`], res.stagnant.length ? '.bad' : ''),
    kpi('최종 필요 레벨', lv(res.finalLevel), [`누적 강화 골드 ${big(res.finalCumCost)}`]),
    kpi('가장 오래 머무는 곳', `${longest.label} · ${fmtDur(longest.dwellSec)}`, [`의도 ${fmtDur(longest.intendedSec)}의 ${longest.ratio.toFixed(1)}배`]),
  );
}

function fillIntervals(res) {
  const ivs = state.costIntervals;
  res.intervals.forEach((it, i) => {
    const o = els.ivOut[i];
    if (!o) return;
    if (i > 0) o.min.textContent = comma(ivs[i].lvMin);
    o.end.textContent = it.endCost == null ? '—' : big(it.endCost);
    o.total.textContent = it.total == null ? '끝 없음' : big(it.total);
    o.total.title = it.total == null ? '' : comma(it.total);
    o.jump.textContent = i === 0 ? '' : Math.abs(it.jump) < 1e-9 ? '이어짐' : `${it.jump > 0 ? '+' : ''}${big(it.jump)}`;
    o.jump.classList.toggle('bad-text', Math.abs(it.jump) >= 1e-9);
    const xs = it.stages;
    o.stages.replaceChildren(...(xs.length
      ? [`${xs[0].label}${xs.length > 1 ? ` ~ ${xs.at(-1).label}` : ''} (${xs.length}곳, ${fmtDur(it.dwellSec)})`, ...(it.stagnant.length ? [h('span.iv-stag', {}, ` 정체 ${it.stagnant.length}`)] : [])]
      : [h('span.muted', {}, '—')]));
    o.stages.closest('tr').classList.toggle('stag-row', it.stagnant.length > 0);
  });
}

function renderViewTabs() {
  els.viewTabs.replaceChildren(...Object.entries(VIEWS).map(([id, label]) => h('button', {
    type: 'button', 'aria-pressed': String(state.view === id),
    onclick: () => { state.view = id; save(); renderViewTabs(); drawChart(last); },
  }, label)));
}

// 로그 축 눈금을 읽기 쉬운 값으로 (기본 눈금은 100초·200초처럼 시간 단위와 안 맞음)
const DUR_TICKS = [10, 30, 60, 120, 300, 600, 1800, 3600, 7200, 18000, 43200, 86400, 259200, 604800];
const LV_TICKS = [1, 3, 10, 30, 100, 300, 1000, 3000, 1e4, 3e4, 1e5, 3e5, 1e6, 3e6, 1e7];
const niceTicks = (vals) => (axis) => { axis.ticks = vals.filter(v => v >= axis.min && v <= axis.max).map(value => ({ value })); };

function drawChart(res) {
  if (typeof Chart === 'undefined') return;
  const spc = state.stagesPerChapter;
  const grid = cssVar('--grid'), tick = cssVar('--text-3'), ink = cssVar('--text-2'), main = cssVar('--series-1'), bad = cssVar('--bad'), alt = cssVar('--series-2');
  const xOf = (s) => 1 + (s - 1) / spc; // 챕터 단위 x: 챕터 c는 x = c에서 시작
  const pt = (x, y) => ({ x: xOf(x.s), y, s: x.s });
  const st = res.stages;
  const stagStyle = { pointRadius: st.map(x => (x.stagnant ? 4 : 0)), pointBackgroundColor: bad, pointBorderColor: bad, pointHoverRadius: 5 };
  let datasets, yScale, hint, yLabel;
  if (state.view === 'elapsed') {
    datasets = [
      { label: '실제 누적', data: st.map(x => pt(x, x.elapsedSec / 3600)), borderColor: main, backgroundColor: main, borderWidth: 2.25, ...stagStyle },
      { label: '의도 누적', data: st.map(x => pt(x, x.intendedElapsedSec / 3600)), borderColor: ink, backgroundColor: ink, borderDash: [5, 4], borderWidth: 1.25, pointRadius: 0 },
    ];
    yScale = { type: 'linear', min: 0, ticks: { color: tick, callback: (v) => `${comma(v)}h` } };
    yLabel = (it) => `${it.dataset.label}: ${fmtDur(it.raw.y * 3600)}`;
    hint = `실제 ${fmtDur(res.totalSec)} · 의도 ${fmtDur(res.intendedTotalSec)} · 빨간 점 = 정체`;
  } else if (state.view === 'level') {
    const top = res.finalLevel;
    datasets = [{ label: '돌파 필요 레벨', data: st.map(x => pt(x, Math.max(1, x.levelReq))), borderColor: main, backgroundColor: main, borderWidth: 2.25, ...stagStyle }];
    // 구간 경계 = 가로 점선
    state.costIntervals.forEach((iv, i) => {
      if (i === 0 || iv.lvMin > top * 1.5) return;
      datasets.push({ label: `경계 Lv${comma(iv.lvMin)}`, boundary: true, data: [{ x: 1, y: iv.lvMin }, { x: state.chapters + 1, y: iv.lvMin }], borderColor: alt, borderDash: [3, 4], borderWidth: 1, pointRadius: 0 });
    });
    yScale = { type: 'logarithmic', min: 1, afterBuildTicks: niceTicks(LV_TICKS), ticks: { color: tick, callback: (v) => fmtBigShort(v, state.numFmt) } };
    yLabel = (it) => {
      if (it.dataset.boundary) return it.dataset.label;
      const x = st[it.raw.s - 1];
      return `${lv(x.levelReq)} · 구간 ${range(state.costIntervals[x.interval])} (증가폭 ${state.costIntervals[x.interval].step})`;
    };
    hint = '로그 축 · 점선 = 비용 구간 경계 · 빨간 점 = 정체';
  } else {
    datasets = [
      { label: '실제 체류', data: st.map(x => pt(x, x.dwellSec)), borderColor: main, backgroundColor: main, borderWidth: 2.25, ...stagStyle },
      { label: '의도 체류', data: st.map(x => pt(x, x.intendedSec)), borderColor: ink, backgroundColor: ink, borderDash: [5, 4], borderWidth: 1.25, pointRadius: 0, stepped: 'before' },
      { label: `정체 기준 (×${state.stagnationRatio})`, data: st.map(x => pt(x, x.intendedSec * state.stagnationRatio)), borderColor: bad, backgroundColor: bad, borderDash: [2, 3], borderWidth: 1, pointRadius: 0, stepped: 'before' },
    ];
    yScale = { type: 'logarithmic', afterBuildTicks: niceTicks(DUR_TICKS), ticks: { color: tick, callback: (v) => fmtDur(v) } };
    yLabel = (it) => `${it.dataset.label}: ${fmtDur(it.raw.y)}`;
    hint = '로그 축 · 실제 = 이 스테이지를 열기까지 앞 스테이지에서 파밍한 시간 · 빨간 점 = 정체';
  }
  els.chartHint.textContent = hint;
  chart?.destroy();
  chart = new Chart(els.canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      scales: {
        x: { type: 'linear', min: 1, max: state.chapters + 1, title: { display: true, text: '챕터', color: tick }, grid: { color: grid }, ticks: { color: tick, stepSize: 1, callback: (v) => (Number.isInteger(v) && v <= state.chapters ? v : '') } },
        y: { ...yScale, grid: { color: grid }, title: { display: true, text: state.view === 'level' ? '레벨' : state.view === 'elapsed' ? '누적 시간' : '체류 시간', color: tick } },
      },
      plugins: {
        legend: { labels: { color: ink, boxWidth: 14, boxHeight: 2, filter: (item, data) => !data.datasets[item.datasetIndex].boundary } },
        tooltip: {
          filter: (it) => !it.dataset.boundary,
          callbacks: {
            title: (items) => { const s = items[0]?.raw?.s; return s ? `${st[s - 1].label}${st[s - 1].stagnant ? ' · 정체' : ''}` : ''; },
            label: yLabel,
          },
        },
      },
    },
  });
}

function renderChapters(res) {
  const toggle = (c) => { if (opened.has(c)) opened.delete(c); else opened.add(c); renderChapters(last); };
  const ratioCell = (r, stag) => h(`td${stag ? '.res.hi' : ''}`, {}, `${r.toFixed(2)}배`);
  const rows = [];
  for (const ch of res.chapters) {
    const open = opened.has(ch.chapter);
    rows.push(h(`tr.ch-row${ch.stagnant.length ? '.stag-row' : ''}`, { onclick: () => toggle(ch.chapter), title: '눌러서 스테이지 펼치기' },
      h('td.stage', {}, h('span.ch-caret', { 'aria-hidden': 'true' }, open ? '▾' : '▸'), `${ch.chapter}챕터`),
      h('td', {}, `${comma(ch.levelFrom)} → ${comma(ch.levelTo)}`),
      h('td', {}, big(ch.goldNeeded)),
      h('td', {}, fmtDur(ch.dwellSec)),
      h('td.muted', {}, fmtDur(ch.intendedSec)),
      ratioCell(ch.ratio, ch.maxRatio > state.stagnationRatio),
      h('td', {}, ch.stagnant.length ? h('span.iv-stag', {}, `${ch.stagnant.length}곳`) : h('span.muted', {}, '—')),
      h('td.muted', {}, `${(ch.elapsedSec / 3600).toFixed(2)}h`),
    ));
    if (open) for (const x of ch.stages) rows.push(h(`tr.st-row${x.stagnant ? '.bad' : ''}`, {},
      h('td', {}, x.label),
      h('td', {}, comma(x.levelReq)),
      h('td', {}, big(x.goldNeeded)),
      h('td', {}, fmtDur(x.dwellSec)),
      h('td.muted', {}, fmtDur(x.intendedSec)),
      ratioCell(x.ratio, x.stagnant),
      h('td.muted', { title: `웨이브 골드(앞 스테이지) · 몬스터 체력 ${big(x.hp)}` }, x.s > 1 ? `${big(res.stages[x.s - 2].gold)}/웨이브` : '—'),
      h('td.muted', {}, `${(x.elapsedSec / 3600).toFixed(2)}h`),
    ));
  }
  els.chapterCard.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '챕터별 체류'), h('span.hint', {}, '챕터를 누르면 스테이지별로 펼침 · 빨강 = 정체')),
    h('div.table-wrap.level-wrap', {}, h('table.stages.level-table.chapter-table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, '챕터 / 스테이지'), h('th', {}, '필요 레벨'), h('th', {}, '필요 골드'), h('th', {}, '실제 체류'), h('th', {}, '의도 체류'),
        h('th', {}, '실제 ÷ 의도'), h('th', {}, '정체 · 골드'), h('th', {}, '누적'))),
      h('tbody', {}, ...rows),
    )),
  );
}

function renderWarnings(res) {
  const LV = { serious: '불가', warn: '주의', info: '참고' };
  els.warnCard.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '검증 결과'), h('span.hint', {}, res.warnings.length ? `${res.warnings.length}건` : '문제 없음')),
    res.warnings.length
      ? h('ul.findings', {}, ...res.warnings.map(w => h(`li.${w.level === 'info' ? 'info' : w.level}`, {}, h('span.lv', {}, w.level === 'serious' ? '정체' : LV[w.level]), h('span', {}, w.text),
        w.fix && w.kind === 'cause' ? h('button.btn.small', { type: 'button', title: '이 반대 가정을 구간 표에 적용', onclick: () => applyLever(w.fix.lever, w.fix.value) }, '적용') : null,
        w.chapter ? h('button.btn.small', { type: 'button', onclick: () => { opened.add(w.chapter); renderChapters(last); els.chapterCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, '보기') : null)))
      : h('p.muted', {}, `모든 스테이지가 의도 체류의 ${state.stagnationRatio}배 안에서 지나갑니다.`),
    h('div.supply-howto', {},
      h('b', {}, '계산 방법'),
      h('p.muted.small', {}, '필요 레벨 = 공격력 × 제한 시간이 몬스터 수 × 체력 이상이 되는 최소 레벨. 다음 스테이지를 열려면 두 필요 레벨 사이의 강화 비용(구간별 등차수열 합)을 지금 스테이지의 웨이브 골드로 벌어야 하고, 그 시간과 돌파 웨이브 시간 중 큰 값이 실제 체류입니다.'),
    ),
  );
}

// ── 정체 원인 · 민감도 ──────────────────────────────────
const trim = (x, d = 4) => (+x.toPrecision(d)).toLocaleString('ko-KR', { maximumFractionDigits: 8 });
/** 레버 값 표시: 증가율 = %, 의도 배수 = ×, 나머지 = 숫자(큰 수는 만·억) */
function levVal(l, v) {
  if (l.unit === 'rate') return l.group === 'intent' ? `×${trim(1 + v)}` : `${trim(v * 100)}%`;
  return v >= 1e4 ? big(v) : trim(v);
}
const signPct = (r, d = 1) => `${r >= 0 ? '+' : '−'}${Math.abs(r * 100).toFixed(d)}%`;
/** 레버 변화: 증가율은 %p도 같이 (4% → 3.966% = −0.034%p, 증가분의 −0.85%) */
function levChange(l, v, t) {
  const rel = signPct(t / v - 1, Math.abs(t / v - 1) < 0.1 ? 2 : 1);
  if (l.unit !== 'rate') return rel;
  const dp = (t - v) * 100;
  return `${dp >= 0 ? '+' : '−'}${trim(Math.abs(dp), 3)}%p (${rel})`;
}

function applyLever(l, v) {
  const raw = l.unit === 'rate' ? +(1 + v).toPrecision(12) : v;
  if (l.group === 'interval') state.costIntervals[l.iv][l.key] = raw;
  else if (l.group === 'intent') state.intendedDwell.perChapterMult = raw;
  else state[l.key] = raw;
  rebuild();
  toast(`${l.label}을(를) ${levVal(l, v)}(으)로 바꿨습니다`);
}

function renderDiag(res) {
  const sens = sensitivity(state, state.sensPct);
  const sol = solveLevers(state, res);
  const pct = sens.pct;

  // ① 해소에 필요한 최소 변경 (정체가 있을 때만)
  let solveBlock;
  if (sol.problem.length) {
    const ok = sol.rows.filter(r => r.feasible), no = sol.rows.filter(r => !r.feasible);
    const labelOf = (s) => res.stages[s - 1].label;
    solveBlock = [
      h('div.diag-sub', {}, h('h3', {}, '해소에 필요한 최소 변경'),
        h('span.hint', {}, `대상: 정체 ${sol.problem.length}곳 (${labelOf(sol.problem[0])}${sol.problem.length > 1 ? ` ~ ${labelOf(sol.problem.at(-1))}` : ''}) · 변수 하나만 바꿔 모두 풀리는 값 · 필요한 변화가 작을수록 정체를 좌우하는 변수`)),
      h('div.table-wrap', {}, h('table.stages.solve-table', {},
        h('thead', {}, h('tr', {}, h('th', {}, '변수'), h('th', {}, '지금'), h('th', {}, '필요 값'), h('th', {}, '변화'), h('th', {}, '총 소요'), h('th', { title: '대상 밖에 남는 정체(단발 정체 등)와 새로 생긴 정체' }, '남는 정체'), h('th', {}, ''))),
        h('tbody', {},
          ...ok.map((r, i) => h(`tr${i < 3 ? '.top' : ''}`, {},
            h('td.lever', {}, r.lever.label, r.lever.group === 'intent' ? h('small', {}, '의도 수정 — 실제 소요는 그대로') : null),
            h('td', {}, levVal(r.lever, r.value)),
            h('td', {}, levVal(r.lever, r.target)),
            h('td', {}, levChange(r.lever, r.value, r.target)),
            h('td', { title: `지금 ${fmtDur(res.totalSec)}` }, `${fmtDur(r.total)} (${signPct(r.total / res.totalSec - 1)})`),
            h('td', {}, r.stagnant ? `${r.stagnant}곳${r.added ? ` · 새로 ${r.added}` : ''}` : '0곳'),
            h('td', {}, h('button.btn.small', { type: 'button', onclick: () => applyLever(r.lever, r.target) }, '적용')),
          )),
          ...no.map(r => h('tr.off', {},
            h('td.lever', {}, r.lever.label),
            h('td', {}, levVal(r.lever, r.value)),
            h('td', { colspan: 5, style: 'text-align:left' }, `이 변수만으로는 해소 불가 — ${r.lever.dir < 0 ? '1/100' : '100배'}로 바꿔도 ${r.left}곳 남음`),
          )),
        ),
      )),
    ];
  } else {
    solveBlock = [h('div.diag-sub', {}, h('h3', {}, '해소에 필요한 최소 변경'), h('span.hint', {}, '정체 스테이지가 없습니다'))];
  }

  // ② 민감도 토네이도: 값 ±pct% → 총 소요 변화 (로그 배율 길이)
  const TOP = 10;
  const rows = sens.rows;
  const maxSwing = Math.max(...rows.slice(0, TOP).map(r => (Number.isFinite(r.swing) ? r.swing : 0)), 1e-9);
  const W = 44; // 한쪽 최대 길이(%) — 끝 글자가 들어갈 자리를 남김
  const bar = (side, r) => {
    const lr = Math.log(r.ratio), w = Number.isFinite(lr) ? Math.min(Math.abs(lr) / maxSwing, 1) * W : W;
    const dirCls = lr < 0 ? 'l' : 'r';
    const text = Number.isFinite(r.ratio) ? signPct(r.ratio - 1, Math.abs(r.ratio - 1) < 0.1 ? 1 : 0) : '∞';
    const pos = lr < 0 ? { right: `calc(50% + ${w}% + 4px)` } : { left: `calc(50% + ${w}% + 4px)` };
    return [
      h(`span.tor-bar.${side}.${dirCls}`, { style: `width:${Math.max(w, 0.4)}%` }),
      h(`span.tor-val.${side}`, { style: Object.entries(pos).map(([k, v]) => `${k}:${v}`).join(';') }, text),
    ];
  };
  const torRow = (r) => {
    const l = r.lever;
    const tip = `${l.label}\n값 −${pct}%: ${levVal(l, r.lo.value)} → 총 소요 ${fmtDur(r.lo.total)} (${signPct(r.lo.ratio - 1)}), 정체 ${r.lo.stagnant}곳\n값 +${pct}%: ${levVal(l, r.hi.value)} → 총 소요 ${fmtDur(r.hi.total)} (${signPct(r.hi.ratio - 1)}), 정체 ${r.hi.stagnant}곳`;
    return h('div.tor-row', { title: tip },
      h('div.tor-label', {}, l.label, h('small', {}, `${levVal(l, r.lo.value)} ~ ${levVal(l, r.hi.value)} (지금 ${levVal(l, r.value)})`)),
      h('div.tor-track', { role: 'img', 'aria-label': tip.replace(/\n/g, ', ') }, ...bar('lo', r.lo), ...bar('hi', r.hi)),
      h('div.tor-stag', {}, '정체 ', h(r.lo.stagnant > sens.baseStagnant ? 'b' : 'span', {}, String(r.lo.stagnant)), ' / ', h(r.hi.stagnant > sens.baseStagnant ? 'b' : 'span', {}, String(r.hi.stagnant)), '곳'),
    );
  };
  const tableView = h('details', {}, h('summary', {}, `표로 보기 (${rows.length}개 변수${sens.flat ? ` · 영향 없는 ${sens.flat}개 제외` : ''})`),
    h('div.table-wrap', {}, h('table.stages.solve-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '변수'), h('th', {}, '지금'), h('th', {}, `−${pct}% 값`), h('th', {}, '총 소요'), h('th', {}, '정체'), h('th', {}, `+${pct}% 값`), h('th', {}, '총 소요'), h('th', {}, '정체'))),
      h('tbody', {}, ...rows.map(r => h('tr', {},
        h('td.lever', {}, r.lever.label), h('td', {}, levVal(r.lever, r.value)),
        h('td', {}, levVal(r.lever, r.lo.value)), h('td', {}, signPct(r.lo.ratio - 1)), h('td', {}, `${r.lo.stagnant}곳`),
        h('td', {}, levVal(r.lever, r.hi.value)), h('td', {}, signPct(r.hi.ratio - 1)), h('td', {}, `${r.hi.stagnant}곳`),
      ))),
    )));

  els.diagCard.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '정체 원인 · 민감도'), h('span.hint', {}, '설정을 하나씩 바꿔 다시 계산한 결과 (반대 가정)')),
    ...solveBlock,
    h('div.diag-sub', {}, h('h3', {}, `민감도 — 값을 ±${pct}% 바꾸면 총 소요가 얼마나 바뀌나`),
      h('div.tool-actions', {}, h('span.muted.small', {}, '변동폭'), select([[5, '±5%'], [10, '±10%'], [20, '±20%']], pct, (v) => { state.sensPct = Number(v); save(); renderDiag(last); }))),
    h('div.tor-legend', {},
      h('span', {}, h('i', { style: 'background:var(--tor-down)' }), `값을 ${pct}% 내림`),
      h('span', {}, h('i', { style: 'background:var(--tor-up)' }), `값을 ${pct}% 올림`),
      h('span.muted', {}, `증가율은 증가분 기준 (4% → ${trim(4 * (1 + pct / 100))}%) · 막대 길이는 로그 배율 (×2와 ×½이 같은 길이) · 지금 정체 ${sens.baseStagnant}곳`),
    ),
    h('div.tor-axis', { 'aria-hidden': 'true' }, h('span', {}, ''), h('span', {}, h('span', {}, '← 총 소요 짧아짐'), h('span', {}, '길어짐 →')), h('span', { style: 'text-align:right' }, '정체 (내림 / 올림)')),
    h('div.tornado', {}, ...rows.slice(0, TOP).map(torRow)),
    tableView,
  );
}

// ── 공유·저장 ───────────────────────────────────────────
async function copyShareLink() {
  const url = `${location.origin}${location.pathname}#stage?s=${encodeState(state)}`;
  try { await navigator.clipboard.writeText(url); toast('공유 링크를 복사했습니다'); }
  catch { prompt('아래 링크를 복사하세요', url); }
}

function saveJSON() {
  downloadJSON(`stage-${state.template}.json`, {
    schemaVersion: SCHEMA, tool: 'stage',
    description: `방치형 스테이지 성장 — 챕터 ${state.chapters} × 스테이지 ${state.stagesPerChapter}, 골드 강화 ${state.costIntervals.length}구간`,
    model: MODEL, state,
  });
}

async function importJSON() {
  try {
    const st = hydrate(await pickJSON());
    if (!st) { toast('스테이지 성장 파일이 아닙니다'); return; }
    state = st; opened.clear(); rebuild(); toast('불러왔습니다');
  } catch { toast('파일을 읽지 못했습니다'); }
}

function exportStagesCSV() {
  if (!last) { toast('먼저 오류를 고쳐 주세요'); return; }
  const lines = [['스테이지', '챕터', '몬스터 체력', '웨이브 골드', '필요 레벨', '필요 골드', '누적 강화 골드', '실제 체류(초)', '의도 체류(초)', '실제÷의도', '누적 시간(시간)', '정체'].join(',')];
  for (const x of last.stages) {
    lines.push([x.label, x.chapter, Math.round(x.hp), +x.gold.toFixed(2), x.levelReq, Math.round(x.goldNeeded), Math.round(x.cumCost), x.dwellSec.toFixed(1), x.intendedSec.toFixed(1), x.ratio.toFixed(3), (x.elapsedSec / 3600).toFixed(3), x.stagnant ? 'Y' : ''].join(','));
  }
  downloadText(`stage-${state.template}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}
