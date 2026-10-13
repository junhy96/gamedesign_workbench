// 강화 기대 비용 계산기 — 화면
import { analyze, bestProtection, mapleStarforceCost } from './model.js';
import { simulate } from './simulate.js';
import { PRESETS } from './presets.js';
import {
  h, fmtMoney, fmtMoneyShort, fmtPct, fmtNum, comma, store, encodeState, decodeState,
  downloadJSON, pickJSON, toast, debounce,
} from '../lib/util.js';

const SCHEMA = 1;
const STORE_KEY = 'enhance:v1';
const MC_STEP_BUDGET = 4e7;   // 시뮬레이션 1회 계산량 상한 (시도 횟수 × 반복 수)
const MC_MAX_TRIALS = 20000;
const MC_MIN_TRIALS = 1000;

let state, root, els = {}, chart, worker, mcSeq = 0;

// ── 상태 ────────────────────────────────────────────────
function defaultState(presetId) {
  const p = PRESETS[presetId];
  const st = {
    v: SCHEMA, preset: presetId, ...structuredClone(p.defaults),
    chanceOn: !!p.defaults.chanceN, chanceN: p.defaults.chanceN || 2,
    eventOn: false,
    eventDestroyMult: p.events.destroyMult, eventCostMult: p.events.costMult, eventMaxStage: p.events.maxStage,
    edited: false, showAll: false,
  };
  st.rows = p.rows(st);
  return st;
}

function toConfig(st) {
  return {
    rows: st.rows, start: st.start, target: st.target, restore: st.restore,
    destroyCost: st.destroyCost, chanceN: st.chanceOn ? st.chanceN : 0,
    protect: st.protect, protectExtra: st.protectExtra,
    costMult: st.eventOn ? st.eventCostMult : 1,
    eventDestroyMult: st.eventOn ? st.eventDestroyMult : 1,
    eventMaxStage: st.eventMaxStage,
  };
}

/** 저장·공유용: 표를 수정하지 않았으면 행 데이터는 빼서 링크를 짧게. */
function serialize(st) {
  const { rows, ...rest } = st;
  return st.edited ? st : rest;
}

function hydrate(obj) {
  if (!obj || obj.v !== SCHEMA || !PRESETS[obj.preset]) return null;
  const st = { ...defaultState(obj.preset), ...obj };
  if (!Array.isArray(obj.rows)) st.rows = PRESETS[obj.preset].rows(st);
  return st;
}

function readHash() {
  const m = location.hash.match(/^#enhance\?s=([\w-]+)/);
  return m ? hydrate(decodeState(m[1])) : null;
}

const save = debounce(() => store.set(STORE_KEY, serialize(state)), 300);

// ── 진입점 ──────────────────────────────────────────────
export function mount(el) {
  root = el;
  state = readHash() || hydrate(store.get(STORE_KEY)) || defaultState('maple');
  if (location.hash.startsWith('#enhance?')) history.replaceState(null, '', '#enhance');
  build();
  recompute();
  document.addEventListener('themechange', () => lastMC && drawChart(lastMC));
  // 이미 열린 페이지에 공유 링크를 붙여넣은 경우
  window.addEventListener('hashchange', () => {
    const st = readHash();
    if (!st) return;
    state = st;
    history.replaceState(null, '', '#enhance');
    renderSettings(); els.showAll.checked = state.showAll; recompute();
  });
}

// ── 골격 ────────────────────────────────────────────────
function build() {
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '강화 기대 비용 계산기'),
        h('p', {}, '성공·유지·하락·파괴 확률과 보호 규칙을 넣으면 목표 단계까지의 기대 비용, 파괴 확률, 운이 나쁠 때의 비용 분포를 계산합니다. 실패 시 단계가 내려가는 구조도 마르코프 체인으로 정확히 풉니다.'),
      ),
      h('div.tool-actions', {},
        h('button.btn', { type: 'button', onclick: copyShareLink }, '공유 링크 복사'),
        h('button.btn', { type: 'button', onclick: exportJSON }, 'JSON 내보내기'),
        h('button.btn', { type: 'button', onclick: importJSON }, '불러오기'),
        h('button.btn', { type: 'button', onclick: reset }, '초기화'),
      ),
    ),
    h('div.layout', {},
      els.settings = h('aside.settings.card', { 'aria-label': '설정' }),
      h('div.results', {},
        els.errors = h('ul.errors', { hidden: true }),
        buildKPIs(),
        buildDist(),
        h('div.two-col', {}, els.rec = h('div.card.callout'), els.verify = h('div.card')),
        buildTableCard(),
      ),
    ),
  );
  renderSettings();
}

function buildKPIs() {
  const tile = (key, label, hero) => {
    const t = h(`div.card.kpi${hero ? '.hero' : ''}`, {},
      h('div.kpi-label', {}, label),
      els[key] = h('div.kpi-value', {}, '—'),
      els[key + 'Sub'] = h('div.kpi-sub', {}, ''),
    );
    return t;
  };
  return h('div.kpis', {},
    tile('kCost', '기대 비용', true),
    tile('kSafe', '파괴 없이 도달할 확률'),
    tile('kDestroy', '기대 파괴 횟수'),
    tile('kAttempts', '기대 시도 횟수'),
  );
}

function buildDist() {
  return h('div.card', {},
    h('div.card-head', {},
      h('h2', {}, '총 비용 분포'),
      els.distHint = h('span.hint', {}, ''),
    ),
    h('div.dist', {},
      h('div.chart-box', {}, els.canvas = h('canvas', { role: 'img', 'aria-label': '총 비용 분포 히스토그램' })),
      els.pct = h('dl.pct-list', {}),
    ),
  );
}

function buildTableCard() {
  return h('div.card', {},
    h('div.card-head', {},
      h('h2', {}, '단계별 확률과 결과'),
      h('span.hint', {}, '확률·비용 칸은 직접 수정할 수 있습니다 · 돌파 전 파괴 = 그 단계를 넘기기 전에 파괴될 확률'),
    ),
    h('div.table-wrap', {}, els.table = h('table.stages', {})),
    h('div.table-foot', {},
      h('label.switch', { style: 'font-weight:500;font-size:13.5px;gap:8px;justify-content:flex-start' },
        els.showAll = h('input', { type: 'checkbox', checked: state.showAll, onchange: (e) => { state.showAll = e.target.checked; renderTable(lastRes); save(); } }),
        '경로 밖 단계도 표시'),
      els.rowBtns = h('div.tool-actions', {}),
    ),
  );
}

// ── 설정 패널 ───────────────────────────────────────────
function numField(label, key, opts = {}) {
  const scale = opts.scale ?? 1; // 표시값 = 상태값 × scale (예: 배수 2 → 200%)
  const input = h('input', {
    type: 'number', value: state[key] * scale, step: opts.step ?? 1, min: opts.min, max: opts.max,
    inputmode: 'decimal',
    oninput: (e) => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      state[key] = opts.int ? Math.round(v) : v / scale;
      opts.after?.();
      schedule();
    },
  });
  return h('label.field', {}, h('span', {}, label), input, opts.hint ? h('small', {}, opts.hint) : null);
}

function renderSettings() {
  const p = PRESETS[state.preset];
  const preset = h('select', {
    onchange: (e) => { state = defaultState(e.target.value); renderSettings(); recompute(); },
  }, ...Object.entries(PRESETS).map(([id, x]) => h('option', { value: id, selected: id === state.preset }, x.label)));

  const chanceN = numField('연속 하락 횟수', 'chanceN', { min: 1, int: true });
  const eventFields = h('div.row2', {},
    numField('파괴 확률 배율', 'eventDestroyMult', { step: 0.05, min: 0, max: 1 }),
    numField('적용 상한 단계', 'eventMaxStage', { int: true }),
    numField('비용 배율', 'eventCostMult', { step: 0.05, min: 0 }),
  );

  els.settings.replaceChildren(...[
    h('label.field', {}, h('span', {}, '프리셋'), preset),
    h('p.preset-note', {}, p.note + (state.edited ? ' · 표 수정됨' : '')),
    state.preset === 'maple'
      ? numField('장비 레벨', 'level', {
        min: 1, int: true, hint: '강화 비용 공식에 사용 (할인 전, 십의 자리 반올림)',
        after: () => { state.rows.forEach(r => { r.cost = mapleStarforceCost(state.level, r.stage); }); },
      })
      : null,
    h('div.row3', {},
      numField('시작', 'start', { int: true, min: 0 }),
      numField('목표', 'target', { int: true, min: 1 }),
      numField('파괴 시 복구', 'restore', { int: true, min: 0 }),
    ),
    numField('파괴 1회 비용', 'destroyCost', {
      min: 0, step: 1000000,
      hint: '복구 비용이나 장비 가격. 0이면 파괴로 인한 재강화 비용만 반영됩니다.',
    }),
    h('div.option', {},
      switchRow('찬스타임', 'chanceOn', () => { chanceN.hidden = !state.chanceOn; }),
      h('p.desc', {}, '연속으로 N번 하락하면 다음 시도가 100% 성공합니다. 하락이 없는 테이블에서는 효과가 없습니다.'),
      chanceN,
    ),
    h('div.option', {},
      switchRow(p.events.label, 'eventOn', () => { eventFields.hidden = !state.eventOn; }),
      h('p.desc', {}, '상한 단계 이하에서 파괴 확률에 배율을 곱하고(줄어든 만큼은 유지로), 강화 비용에 배율을 곱합니다.'),
      eventFields,
    ),
    h('div.option', {},
      h('span.group-title', {}, '파괴방지'),
      h('p.desc', {}, '단계별 적용은 아래 표의 “보호” 칸에서 켭니다. 보호 시 파괴 확률은 유지로 바뀌고 추가 비용이 붙습니다(할인 미적용).'),
      numField('추가 비용 (기본 비용 대비 %)', 'protectExtra', { min: 0, step: 50, scale: 100 }),
    ),
  ].filter(Boolean));
  chanceN.hidden = !state.chanceOn;
  eventFields.hidden = !state.eventOn;
}

function switchRow(label, key, after) {
  return h('label.switch', {}, label, h('input', {
    type: 'checkbox', checked: !!state[key],
    onchange: (e) => { state[key] = e.target.checked; after?.(); schedule(0); },
  }));
}

// ── 계산 ────────────────────────────────────────────────
let lastRes, lastMC, timer;
function schedule(ms = 150) { clearTimeout(timer); timer = setTimeout(recompute, ms); }

function recompute() {
  save();
  const cfg = toConfig(state);
  const res = analyze(cfg);
  if (!res.ok) {
    els.errors.replaceChildren(...res.errors.slice(0, 6).map(e => h('li', {}, e)));
    els.errors.hidden = false;
    lastRes = null;
    renderTable(null);
    return;
  }
  els.errors.hidden = true;
  lastRes = res;
  renderKPIs(res);
  renderTable(res);
  renderRecommendation(cfg, res);
  runMC(cfg, res);
}

function renderKPIs(r) {
  els.kCost.textContent = fmtMoney(r.expCost);
  els.kCostSub.replaceChildren(
    r.destroyCostTotal > 0
      ? h('span', {}, '강화 ', h('b', {}, fmtMoneyShort(r.attemptCost)), ' + 파괴 ', h('b', {}, fmtMoneyShort(r.destroyCostTotal)))
      : h('span', {}, '시뮬레이션 계산 중…'),
  );
  els.kSafe.textContent = fmtPct(r.noDestroy, r.noDestroy < 0.01 ? 2 : 1);
  els.kSafeSub.textContent = '목표까지 한 번도 파괴되지 않을 확률';
  els.kDestroy.textContent = `${fmtNum(r.expDestroy, 2)}회`;
  els.kDestroySub.replaceChildren(
    '운 나쁜 10%는 ', h('b', {}, `${comma(r.destroyQuantile(0.9))}회+`),
    ' · 1%는 ', h('b', {}, `${comma(r.destroyQuantile(0.99))}회+`),
  );
  els.kAttempts.textContent = `${fmtNum(r.attempts, 1)}회`;
  els.kAttemptsSub.textContent = '';
}

// ── 몬테카를로 (Web Worker) ─────────────────────────────
function runMC(cfg, res) {
  const id = ++mcSeq;
  const trials = Math.min(MC_MAX_TRIALS, Math.floor(MC_STEP_BUDGET / Math.max(res.attempts, 1)));
  if (trials < MC_MIN_TRIALS) {
    lastMC = null;
    showMCSkipped(res);
    return;
  }
  els.distHint.textContent = `시뮬레이션 ${comma(trials)}회 계산 중…`;
  const done = (result) => { if (id === mcSeq) { lastMC = result; renderMC(result, res); } };
  try {
    worker ??= new Worker(new URL('./mc-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { if (e.data.id === mcSeq && e.data.ok) done(e.data.result); };
    worker.postMessage({ id, cfg, trials, seed: 20261013 });
  } catch {
    done(simulate(cfg, Math.min(trials, 5000))); // Worker 미지원 환경
  }
}

function showMCSkipped(res) {
  els.distHint.textContent = '기대 시도 횟수가 너무 커서 시뮬레이션을 생략했습니다 (정확해만 표시)';
  els.kCostSub.textContent = '분포는 시뮬레이션 생략으로 표시하지 않습니다';
  els.pct.replaceChildren();
  chart?.destroy(); chart = null;
  renderVerify(res, null);
}

function renderMC(mc, res) {
  const c = mc.pct.cost;
  els.kCostSub.replaceChildren(
    '중앙값 ', h('b', {}, fmtMoneyShort(c.p50)), ' · 상위 10% ', h('b', {}, fmtMoneyShort(c.p90)),
    ' · 1% ', h('b', {}, fmtMoneyShort(c.p99)),
  );
  const a = mc.pct.attempts;
  els.kAttemptsSub.replaceChildren('중앙값 ', h('b', {}, `${comma(a.p50)}회`), ' · 상위 10% ', h('b', {}, `${comma(a.p90)}회`));
  els.distHint.textContent = `시뮬레이션 ${comma(mc.trials)}회 · 상위 1%를 넘는 꼬리 구간은 그래프에서 생략`;
  const row = (dt, dd) => h('div', {}, h('dt', {}, dt), h('dd', {}, dd));
  els.pct.replaceChildren(
    row('중앙값 (50%)', fmtMoney(c.p50)),
    row('상위 10% (90%)', fmtMoney(c.p90)),
    row('상위 1% (99%)', fmtMoney(c.p99)),
    row('평균', fmtMoney(mc.mean.cost)),
  );
  drawChart(mc);
  renderVerify(res, mc);
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function drawChart(mc) {
  if (typeof Chart === 'undefined') { els.distHint.textContent = '차트 라이브러리를 불러오지 못했습니다'; return; }
  const { edges, counts, n } = mc.histogram;
  const data = counts.map((cnt, i) => ({ x: (edges[i] + edges[i + 1]) / 2, y: (cnt / n) * 100, lo: edges[i], hi: edges[i + 1], cnt }));
  const series = cssVar('--series-1'), grid = cssVar('--grid'), text = cssVar('--text-3'), ink = cssVar('--text-2');
  const marks = [['50%', mc.pct.cost.p50], ['90%', mc.pct.cost.p90], ['99%', mc.pct.cost.p99]];
  const binW = edges[1] - edges[0];

  const markers = {
    id: 'pctMarkers',
    afterDatasetsDraw(c) {
      const { ctx, chartArea: a, scales: { x } } = c;
      ctx.save();
      ctx.font = '600 11px Pretendard Variable, system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const [label, v] of marks) {
        const px = x.getPixelForValue(v);
        if (px < a.left || px > a.right) continue;
        ctx.strokeStyle = ink; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, a.top + 14); ctx.lineTo(px, a.bottom); ctx.stroke();
        ctx.fillStyle = ink; ctx.fillText(label, px, a.top + 10);
      }
      ctx.restore();
    },
  };

  chart?.destroy();
  chart = new Chart(els.canvas, {
    type: 'bar',
    data: { datasets: [{ data, backgroundColor: series, hoverBackgroundColor: series + 'cc', borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'start', barPercentage: 0.9, categoryPercentage: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { top: 6 } },
      scales: {
        x: {
          type: 'linear', offset: false, min: edges[0], max: edges.at(-1) + binW * 0.01,
          grid: { display: false }, border: { color: grid },
          ticks: { color: text, maxTicksLimit: 6, callback: (v) => fmtMoneyShort(v) },
        },
        y: {
          beginAtZero: true, grid: { color: grid }, border: { display: false },
          ticks: { color: text, maxTicksLimit: 5, callback: (v) => `${v}%` },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: (items) => `${fmtMoney(items[0].raw.lo)} ~ ${fmtMoney(items[0].raw.hi)}`,
            label: (item) => `${item.raw.y.toFixed(1)}% (${comma(item.raw.cnt)}회)`,
          },
        },
      },
    },
    plugins: [markers],
  });
}

function renderVerify(res, mc) {
  const rows = [
    ['기대 비용', fmtMoney(res.expCost), mc && fmtMoney(mc.mean.cost), mc && rel(mc.mean.cost, res.expCost)],
    ['기대 시도', fmtNum(res.attempts, 1), mc && fmtNum(mc.mean.attempts, 1), mc && rel(mc.mean.attempts, res.attempts)],
    ['기대 파괴', fmtNum(res.expDestroy, 3), mc && fmtNum(mc.mean.destroys, 3), null],
    ['무파괴 확률', fmtPct(res.noDestroy, 2), mc && fmtPct(mc.noDestroy, 2), null],
  ];
  const maxDiff = mc ? Math.max(...rows.map(r => r[3] ?? 0)) : null;
  const ok = maxDiff != null && maxDiff < 0.03;
  els.verify.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '계산 검증'),
      mc ? h(`span.status.${ok ? 'good' : 'warn'}`, {}, ok ? `✓ 일치 (오차 ${(maxDiff * 100).toFixed(1)}%)` : `! 오차 ${(maxDiff * 100).toFixed(1)}% — 표본 부족 가능`) : null),
    h('p.muted', { style: 'font-size:13px' }, '정확해는 상태별 기대 시도 횟수를 연립방정식(가우스 소거)으로 풀고, 시뮬레이션은 시드를 고정해 실제로 강화를 반복합니다. 두 값이 맞으면 모델 구현이 올바르다는 근거가 됩니다.'),
    h('div.verify-grid', {},
      h('span.h', {}, ''), h('span.h', {}, '정확해'), h('span.h', {}, mc ? `시뮬레이션 ${comma(mc.trials)}회` : '시뮬레이션 생략'),
      ...rows.flatMap(([k, a, b]) => [h('span', {}, k), h('b', {}, a), h('span', {}, b ?? '—')]),
    ),
  );
}
const rel = (a, b) => (b ? Math.abs(a - b) / Math.abs(b) : 0);

// ── 보호 추천 ───────────────────────────────────────────
function renderRecommendation(cfg, res) {
  const best = bestProtection(cfg);
  const label = (list) => (list.length ? list.map(s => `${s}성`).join(' · ') : '보호 안 함');
  const children = [h('div.card-head', {}, h('h2', {}, '파괴방지 최적 조합'), h('span.hint', {}, '기대 비용 기준'))];
  if (!best) {
    children.push(h('p', {}, '경로에 보호를 적용할 수 있는 단계가 없습니다.'));
  } else {
    const cur = [...state.protect].sort((a, b) => a - b).join();
    const isBest = best.protect.join() === cur || res.expCost <= best.cost * (1 + 1e-9);
    const saving = 1 - best.cost / res.expCost;
    children.push(
      h('div.big', {}, label(best.protect)),
      h('p', {}, '기대 비용 ', h('b', {}, fmtMoney(best.cost)),
        isBest ? ' — 현재 설정이 최적입니다.' : h('span', {}, ' · 현재보다 ', h('b.saving', {}, `${(saving * 100).toFixed(1)}% 절감`))),
      h('p', {}, `후보 ${best.candidates.map(s => `${s}성`).join(', ')}의 모든 조합(${2 ** best.candidates.length}가지)을 정확해로 비교했습니다.`),
      !state.destroyCost ? h('p', { style: 'color:var(--warn)' }, '파괴 1회 비용이 0이라 복구 비용이 반영되지 않았습니다. 입력하면 추천이 달라질 수 있습니다.') : null,
      !isBest ? h('div', {}, h('button.btn.primary', { type: 'button', onclick: () => { state.protect = [...best.protect]; recompute(); toast('추천 조합을 적용했습니다'); } }, '이 조합 적용')) : null,
    );
  }
  els.rec.replaceChildren(...children.filter(Boolean));
}

// ── 단계 표 ─────────────────────────────────────────────
function renderTable(res) {
  // 표 안에서 입력 중이면 구조를 다시 만들지 않고 값만 갱신 (포커스 유지)
  if (res && els.table.contains(document.activeElement)) return updateTableValues(res);
  const lo = Math.min(state.start, state.restore), hi = state.target - 1;
  const onPath = (s) => s >= lo && s <= hi;
  const rows = state.rows.filter(r => state.showAll || onPath(r.stage));
  const byStage = new Map((res?.stages || []).map(s => [s.stage, s]));
  const maxCost = Math.max(...(res?.stages || []).map(s => s.costTotal), 1);
  const head = ['단계', '성공 %', '유지 %', '하락 %', '파괴 %', '1회 비용', '보호', '돌파 전 파괴', '기대 시도', '비용 비중'];

  const cell = (r, key, cls) => h('td', {}, h(`input${cls ? '.' + cls : ''}`, {
    type: 'number', value: r[key], step: key === 'cost' ? 'any' : 0.01, min: 0,
    'aria-label': `${r.stage}단계 ${key}`,
    oninput: (e) => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      r[key] = v; state.edited = true; schedule(250);
    },
  }));

  els.table.replaceChildren(
    h('thead', {}, h('tr', {}, ...head.map(t => h('th', {}, t)))),
    h('tbody', {}, ...rows.map(r => {
      const e = byStage.get(r.stage);
      const sum = r.s + r.k + r.d + r.b;
      const canProtect = r.b > 0 && r.protectable !== false;
      return h(`tr${onPath(r.stage) ? '' : '.off'}${Math.abs(sum - 100) > 0.01 ? '.bad' : ''}`, { dataset: { stage: r.stage } },
        h('td.stage', {}, `${r.stage} → ${r.stage + 1}`),
        cell(r, 's'), cell(r, 'k'), cell(r, 'd'), cell(r, 'b'), cell(r, 'cost', 'cost'),
        h('td', {}, h('input', {
          type: 'checkbox', checked: state.protect.includes(r.stage), disabled: !canProtect,
          title: canProtect ? '파괴방지 적용' : '이 단계는 보호를 적용할 수 없습니다',
          'aria-label': `${r.stage}단계 파괴방지`,
          onchange: (ev) => {
            state.protect = ev.target.checked ? [...state.protect, r.stage] : state.protect.filter(s => s !== r.stage);
            recompute();
          },
        })),
        h('td.risk', { dataset: { k: 'risk' } }),
        h('td', { dataset: { k: 'visits' } }),
        h('td', {}, h('div.share-cell', {}, h('span', { dataset: { k: 'share' } }), h('div.share-bar', {}, h('i', { dataset: { k: 'bar' } })))),
      );
    })),
  );
  if (res) updateTableValues(res, maxCost);

  els.rowBtns.replaceChildren(...(state.preset === 'custom' ? [
    h('button.btn', { type: 'button', onclick: addRow }, '+ 단계 추가'),
    h('button.btn', { type: 'button', onclick: removeRow, disabled: state.rows.length <= 1 }, '마지막 단계 삭제'),
  ] : []));
}

function updateTableValues(res, maxCost) {
  maxCost ??= Math.max(...res.stages.map(s => s.costTotal), 1);
  const total = res.attemptCost || 1;
  const byStage = new Map(res.stages.map(s => [s.stage, s]));
  for (const tr of els.table.querySelectorAll('tbody tr')) {
    const s = byStage.get(+tr.dataset.stage);
    const r = state.rows.find(x => x.stage === +tr.dataset.stage);
    const bad = r && Math.abs(r.s + r.k + r.d + r.b - 100) > 0.01;
    tr.classList.toggle('bad', !!bad);
    const set = (k, v) => { const el = tr.querySelector(`[data-k="${k}"]`); if (el) el.textContent = v; };
    if (!s) { set('risk', ''); set('visits', ''); set('share', ''); continue; }
    const risk = s.destroyBeforePass;
    set('risk', risk == null ? (s.b > 0 ? '하락 있음' : '—') : risk === 0 ? '—' : fmtPct(risk));
    tr.querySelector('[data-k="risk"]').classList.toggle('hi', risk != null && risk >= 0.3);
    set('visits', s.visits > 0.0005 ? fmtNum(s.visits, 1) : '—');
    set('share', s.costTotal > 0 ? fmtPct(s.costTotal / total) : '—');
    const bar = tr.querySelector('[data-k="bar"]');
    if (bar) bar.style.width = `${(s.costTotal / maxCost) * 100}%`;
  }
}

function addRow() {
  const last = state.rows.at(-1);
  state.rows.push({ stage: last.stage + 1, s: 50, k: 50, d: 0, b: 0, cost: last.cost });
  state.edited = true; recompute();
}
function removeRow() {
  state.rows.pop();
  state.target = Math.min(state.target, state.rows.at(-1).stage + 1);
  state.edited = true; renderSettings(); recompute();
}

// ── 공유·저장 ───────────────────────────────────────────
async function copyShareLink() {
  const url = `${location.origin}${location.pathname}#enhance?s=${encodeState(serialize(state))}`;
  try { await navigator.clipboard.writeText(url); toast('공유 링크를 복사했습니다'); }
  catch { prompt('아래 링크를 복사하세요', url); }
}
function exportJSON() {
  downloadJSON(`enhance-${state.preset}-${state.start}-${state.target}.json`, { schemaVersion: SCHEMA, tool: 'enhance', state: { ...state, edited: true } });
}
async function importJSON() {
  try {
    const data = await pickJSON();
    const st = data?.tool === 'enhance' ? hydrate(data.state) : null;
    if (!st) throw new Error();
    state = st; renderSettings(); els.showAll.checked = state.showAll; recompute(); toast('설정을 불러왔습니다');
  } catch { toast('불러올 수 없는 파일입니다'); }
}
function reset() {
  state = defaultState(state.preset); renderSettings(); recompute(); toast('프리셋 기본값으로 되돌렸습니다');
}
