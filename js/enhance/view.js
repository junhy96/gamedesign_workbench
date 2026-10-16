// 강화 확률·비용 설계 — 화면 진입점: 상태, 레이아웃, 재계산 흐름, 시뮬레이션 워커, 저장·공유
import { analyze, effectiveProbs } from './model.js';
import { simulate } from './simulate.js';
import { TEMPLATES } from './presets.js';
import { renderRules, renderCurrency } from './panels.js';
import { bindCurrency } from './currency.js';
import { renderTable, renderAnalysis } from './table.js';
import {
  buildKPIs, buildStrip, renderKPIs, buildDist, renderMC, renderMCSkipped, renderResources,
  renderItemsCard, renderOptCard, renderInverse, drawChart,
} from './results.js';
import { h, store, encodeState, decodeState, downloadJSON, downloadText, pickJSON, toast, debounce, comma } from '../lib/util.js';

const SCHEMA = 2;
const STORE_KEY = 'enhance:v2';
const VIEW_KEY = 'enhance:view'; // 마지막으로 본 화면 (이 브라우저에만 기억)
const VIEWS = [
  ['design', '설계 입력', '규칙 · 확률 · 비용 · 아이템'],
  ['analysis', '결과 분석', '분포 · 단계별 분석 · 검증'],
  ['tools', '밸런스 도구', '목표 비용 역산 · 최적 정책'],
];
const MC_STEP_BUDGET = 4e7;   // 시뮬레이션 계산량 상한 (기대 시도 × 반복 수)
const MC_MAX_TRIALS = 20000;
const MC_MIN_TRIALS = 1000;
const CONFIG_KEYS = ['rows', 'resources', 'start', 'target', 'restore', 'destroyCosts', 'double', 'streak', 'items', 'usage', 'event'];

const els = {};
let worker, mcSeq = 0, timer;

const ctx = {
  state: null, tableDirty: true, lastMC: null, lastRes: null, chart: null,
  toConfig: () => Object.fromEntries(CONFIG_KEYS.map(k => [k, ctx.state[k]])),
  schedule(ms = 150, tableDirty = false) { if (tableDirty) ctx.tableDirty = true; clearTimeout(timer); timer = setTimeout(recompute, ms); },
  markTableDirty() { ctx.tableDirty = true; },
  recompute: () => recompute(),
  rebuild: () => rebuild(),
  loadTemplate(id) { ctx.state = defaultState(id); rebuild(); },
  save: debounce(() => store.set(STORE_KEY, serialize(ctx.state)), 300),
  saveBaseline(label) {
    const r = ctx.lastRes;
    if (!r) return;
    ctx.state.baseline = { label, expCost: r.expCost, std: r.std, noDestroy: r.noDestroy, expDestroy: r.expDestroy, attempts: r.attempts };
    renderHead(); renderKPIs(ctx, els, r); ctx.save();
  },
};

// ── 상태 ────────────────────────────────────────────────
function defaultState(id) {
  return { v: SCHEMA, template: id, ...TEMPLATES[id].make(), showAll: false, baseline: null, budget: 0, inverse: null };
}
function serialize(st) { const { baseline, ...rest } = st; return rest; }
function hydrate(obj) {
  if (!obj || obj.v !== SCHEMA || !TEMPLATES[obj.template]) return null;
  return { ...defaultState(obj.template), ...obj };
}
function readHash() {
  const m = location.hash.match(/^#enhance\?s=([\w-]+)/);
  return m ? hydrate(decodeState(m[1])) : null;
}

// ── 진입점 ──────────────────────────────────────────────
export function mount(root) {
  ctx.state = readHash() || hydrate(store.get(STORE_KEY)) || defaultState('standard');
  if (location.hash.startsWith('#enhance?')) history.replaceState(null, '', '#enhance');
  build(root);
  rebuild();
  document.addEventListener('themechange', () => ctx.lastMC && drawChart(ctx, els, ctx.lastMC));
  window.addEventListener('hashchange', () => {
    const st = readHash();
    if (!st) return;
    ctx.state = st; history.replaceState(null, '', '#enhance'); rebuild();
  });
}

function build(root) {
  const card = (title, hint, ...body) => h('div.card', {}, h('div.card-head', {}, h('h2', {}, title), hint ? h('span.hint', {}, hint) : null), ...body);
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '강화 확률·비용 설계'),
        h('p', {}, '단계별 확률과 비용을 직접 설계하고, 목표까지의 기대 비용·편차·파괴 위험을 마르코프 체인으로 정확히 계산합니다. 보조 아이템(BM)의 최적 사용 정책과 목표 비용 역산으로 밸런스를 맞춥니다.'),
      ),
      els.head = h('div.tool-actions', {}),
    ),
    els.bar = h('div.enh-bar', {},
      h('div.enh-views', { role: 'tablist', 'aria-label': '강화 설계 화면' }, ...VIEWS.map(([id, label, sub], i) =>
        els['view_' + id] = h('button', { type: 'button', role: 'tab', onclick: () => setView(id) },
          h('span.step', {}, String(i + 1)), h('span.view-text', {}, h('b', {}, label), h('small', {}, sub))))),
      buildStrip(els),
    ),
    els.errors = h('ul.errors', { hidden: true }),

    // ① 설계 입력
    els.pane_design = h('div.enh-pane', {},
      els.rules = h('div.card.rules'),
      card('단계별 확률과 비용', '칸을 직접 수정 · 합계가 100이 아니면 빨간색',
        h('div.table-wrap', {}, els.table = h('table.stages', {})),
        h('div.table-foot', {},
          h('label.switch.inline', {},
            els.showAll = h('input', { type: 'checkbox', onchange: (e) => { ctx.state.showAll = e.target.checked; ctx.tableDirty = true; recompute(); } }),
            '경로 밖 단계도 표시'),
          els.rowBtns = h('div.tool-actions', {}),
        ),
      ),
      els.itemsCard = h('div.card'),
      els.currency = h('div.card'),
    ),

    // ② 결과 분석
    els.pane_analysis = h('div.enh-pane', {},
      buildKPIs(els),
      buildDist(ctx, els),
      card('단계별 분석', '실효 확률(아이템·이벤트 반영) 기준 · 머리글에 마우스를 올리면 설명',
        h('div.table-wrap', {}, els.analysis = h('table.stages.analysis', {}))),
      h('div.two-col', {}, els.resources = h('div.card'), els.verify = h('div.card')),
    ),

    // ③ 밸런스 도구
    els.pane_tools = h('div.enh-pane', {},
      h('div.two-col', {}, els.inverse = h('div.card.tool-card'), els.optCard = h('div.card.tool-card')),
    ),
  );
  setView(store.get(VIEW_KEY) || 'design', false);
}

function setView(id, remember = true) {
  if (!VIEWS.some(v => v[0] === id)) id = 'design';
  ctx.view = id;
  for (const [v] of VIEWS) {
    els['pane_' + v].hidden = v !== id;
    els['view_' + v].setAttribute('aria-selected', String(v === id));
  }
  els.bar.dataset.view = id; // 결과 분석 화면에서는 아래 큰 지표 카드가 있으므로 띠의 지표를 숨김
  if (remember) store.set(VIEW_KEY, id);
  if (id === 'analysis' && ctx.lastMC) drawChart(ctx, els, ctx.lastMC); // 숨겨진 동안 크기가 0이던 차트를 다시 그림
}

function renderHead() {
  const b = ctx.state.baseline;
  els.head.replaceChildren(...[
    b ? h('span.badge', { title: '저장한 기준안과 비교 중' }, `기준안: ${b.label}`) : null,
    h('button.btn', { type: 'button', onclick: () => { ctx.saveBaseline(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })); toast('현재 결과를 기준안으로 저장했습니다'); } }, '기준안 저장'),
    b ? h('button.btn', { type: 'button', onclick: () => { ctx.state.baseline = null; renderHead(); ctx.lastRes && renderKPIs(ctx, els, ctx.lastRes); ctx.save(); } }, '기준안 해제') : null,
    h('button.btn', { type: 'button', onclick: copyShareLink }, '공유 링크'),
    h('button.btn', { type: 'button', onclick: exportCSV, title: '실효 확률표(공시 검토용) CSV' }, '확률표 CSV'),
    h('button.btn', { type: 'button', onclick: exportJSON }, 'JSON 저장'),
    h('button.btn', { type: 'button', onclick: importJSON }, '불러오기'),
  ].filter(Boolean));
}

function rebuild() {
  bindCurrency(ctx.state);
  renderHead();
  renderRules(ctx, els.rules);
  renderCurrency(ctx, els.currency);
  renderItemsCard(ctx, els);
  renderOptCard(ctx, els);
  els.showAll.checked = ctx.state.showAll;
  els.inverse.replaceChildren();
  ctx.tableDirty = true;
  recompute();
}

// ── 계산 ────────────────────────────────────────────────
function recompute() {
  ctx.save();
  const cfg = ctx.toConfig();
  const res = analyze(cfg);
  if (!res.ok) {
    els.errors.replaceChildren(...res.errors.slice(0, 8).map(e => h('li', {}, e)));
    els.errors.hidden = false;
    ctx.lastRes = null;
    renderTable(ctx, els);
    renderAnalysis(ctx, els, null);
    return;
  }
  els.errors.hidden = true;
  ctx.lastRes = res;
  renderKPIs(ctx, els, res);
  renderTable(ctx, els);
  renderAnalysis(ctx, els, res);
  renderResources(els, res);
  if (!els.inverse.hasChildNodes()) renderInverse(ctx, els, res);
  runMC(cfg, res);
}

function runMC(cfg, res) {
  const id = ++mcSeq;
  const trials = Math.min(MC_MAX_TRIALS, Math.floor(MC_STEP_BUDGET / Math.max(res.attempts, 1)));
  if (trials < MC_MIN_TRIALS) { renderMCSkipped(ctx, els, res); return; }
  els.distHint.textContent = `시뮬레이션 ${comma(trials)}회 계산 중…`;
  const done = (mc) => { if (id === mcSeq) renderMC(ctx, els, mc, res); };
  try {
    worker ??= new Worker(new URL('./mc-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { if (e.data.id === mcSeq && e.data.ok) done(e.data.result); };
    worker.postMessage({ id, cfg, trials, seed: 20261013 });
  } catch {
    done(simulate(cfg, Math.min(trials, 5000))); // Worker 미지원 환경
  }
}

// ── 공유·저장 ───────────────────────────────────────────
async function copyShareLink() {
  const url = `${location.origin}${location.pathname}#enhance?s=${encodeState(serialize(ctx.state))}`;
  try { await navigator.clipboard.writeText(url); toast('공유 링크를 복사했습니다'); }
  catch { prompt('아래 링크를 복사하세요', url); }
}

function exportJSON() {
  downloadJSON(`enhance-${ctx.state.template}.json`, { schemaVersion: SCHEMA, tool: 'enhance', state: serialize(ctx.state) });
}

async function importJSON() {
  try {
    const data = await pickJSON();
    const st = data?.tool === 'enhance' ? hydrate(data.state) : null;
    if (!st) throw new Error();
    ctx.state = st; rebuild(); toast('설정을 불러왔습니다');
  } catch { toast('불러올 수 없는 파일입니다'); }
}

/** 실효 확률표: 이벤트 배율 반영, 연속 보정·아이템 미적용(카운터 0) 기준 */
function exportCSV() {
  const cfg = ctx.toConfig();
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const pct = (x) => (x * 100).toFixed(4);
  const head = ['단계', '성공(%)', ...(cfg.double ? ['대성공(%)'] : []), '유지(%)', '하락(%)', '파괴(%)', ...cfg.resources.map(r => `${r.name} 비용`)];
  const lines = [head.map(esc).join(',')];
  for (const r of cfg.rows) {
    if (r.stage >= cfg.target) continue;
    const p = effectiveProbs(cfg, r, 0, []);
    lines.push([`+${r.stage}→+${r.stage + 1}`, pct(p.s), ...(cfg.double ? [pct(p.s2)] : []), pct(p.k), pct(p.d), pct(p.b), ...r.costs].map(esc).join(','));
  }
  const notes = [];
  if (cfg.event.on) notes.push(`이벤트 배율 적용: 성공 ×${cfg.event.successMult}, 파괴 ×${cfg.event.destroyMult}, 비용 ×${cfg.event.costMult}`);
  if (cfg.streak.kind !== 'none') notes.push(`연속 보정(${cfg.streak.kind === 'fail' ? '연속 실패' : '연속 하락'}) 별도: 보너스 ${cfg.streak.bonus}${cfg.streak.bonusMode === 'rel' ? '% (기본 성공률 대비)' : '%p'}, 천장 ${cfg.streak.pity || '없음'}`);
  lines.push('', ...notes.map(esc));
  downloadText(`enhance-probabilities-${ctx.state.template}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}

