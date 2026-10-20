// 강화 확률·비용 설계 — 화면 진입점: 상태, 레이아웃, 재계산 흐름, 시뮬레이션 워커, 저장·공유
import { analyze, effectiveProbs, migrate, SCHEMA } from './model.js';
import { simulate } from './simulate.js';
import { TEMPLATES } from './presets.js';
import { renderSidebar } from './panels.js';
import { bindCurrency } from './currency.js';
import { renderTable } from './table.js';
import {
  buildKPIs, buildStrip, renderKPIs, buildDist, renderMC, renderMCSkipped, renderResources,
  renderOptCard, renderInverse, refreshInverse, drawChart, renderSweepCard, drawSweep, renderQuantiles,
} from './results.js';
import { h, store, encodeState, decodeState, downloadJSON, downloadText, pickJSON, toast, debounce, comma, fmtPct } from '../lib/util.js';
import { renderDist } from '../lib/distview.js';
import { renderABCard } from '../lib/abcompare.js';
import { enhanceDoc } from './doc.js';
import { money as wonFmt } from './currency.js';

const STORE_KEY = 'enhance:v2'; // 저장 키는 그대로 두고 내용을 migrate()로 v3까지 올려 읽는다
const SECTIONS = [['enh-stages', '단계 표'], ['enh-analysis', '결과 분석'], ['enh-tools', '밸런스 도구']];
const MC_STEP_BUDGET = 4e7;   // 시뮬레이션 계산량 상한 (기대 시도 × 반복 수)
const MC_MAX_TRIALS = 20000;
const MC_MIN_TRIALS = 1000;
const MC_SEED = 20261013;     // 기본 시드 (왼쪽 '시뮬레이션'에서 바꿀 수 있음)
const CONFIG_KEYS = ['rows', 'resources', 'start', 'target', 'restore', 'destroyCosts', 'double', 'streak', 'items', 'usage', 'event'];

const els = {};
let worker, mcSeq = 0, timer;

const ctx = {
  state: null, tableDirty: true, lastMC: null, lastRes: null, chart: null,
  toConfig: () => configOf(ctx.state),
  schedule(ms = 150, tableDirty = false) { if (tableDirty) ctx.tableDirty = true; clearTimeout(timer); timer = setTimeout(recompute, ms); },
  markTableDirty() { ctx.tableDirty = true; },
  recompute: () => recompute(),
  onMC: (mc) => renderDistCard(mc),
  renderDoc: () => { if (els.docCard) els.docCard.replaceChildren(...enhanceDoc(ctx.state, ctx.toConfig(), ctx.lastRes)); },
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

/** 화면 상태 → 계산 설정 (실패 보정 ON/OFF: 꺼진 쪽은 0, 둘 다 꺼지면 보정 없음) — 프리셋 비교에도 씀 */
function configOf(state) {
  const cfg = Object.fromEntries(CONFIG_KEYS.map(k => [k, state[k]]));
  const st = cfg.streak;
  if (st && st.kind !== 'none' && (st.bonusOn === false || st.pityOn === false)) {
    const e = { ...st, bonus: st.bonusOn === false ? 0 : st.bonus, pity: st.pityOn === false ? 0 : st.pity };
    cfg.streak = !(e.bonus > 0) && !e.pity ? { ...e, kind: 'none' } : e;
  }
  return cfg;
}

// ── 상태 ────────────────────────────────────────────────
function defaultState(id) {
  return migrate({ v: SCHEMA, template: id, ...TEMPLATES[id].make(), showAll: false, baseline: null, budget: 0, inverse: null, priceSweep: null, sim: { trials: MC_MAX_TRIALS, seed: MC_SEED } });
}
function serialize(st) { const { baseline, ...rest } = st; return rest; }
function hydrate(obj) {
  const st = migrate(obj); // v2 저장본: 아이템을 기존 on/off 방식(toggle)으로
  if (!st || !TEMPLATES[st.template]) return null;
  return { ...defaultState(st.template), ...st };
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
  document.addEventListener('themechange', () => { if (ctx.lastMC) { renderMC(ctx, els, ctx.lastMC, ctx.lastRes); } drawSweep(ctx, els); });
  window.addEventListener('hashchange', () => {
    const st = readHash();
    if (!st) return;
    ctx.state = st; history.replaceState(null, '', '#enhance'); rebuild();
  });
}

// 화면 구성: 왼쪽 = 설정 메뉴(고정, 따로 스크롤), 오른쪽 = 핵심 지표 → 단계 표(입력 + 같은 줄 결과) → 결과 분석 → 밸런스 도구
// 지표 카드가 위로 사라지면 오른쪽 위 고정 띠에 같은 지표가 나타나 입력하면서도 결과를 본다.
function build(root) {
  const card = (role, title, hint, ...body) => h(`div.card.role-${role}`, {}, h('div.card-head', {}, h('h2', {}, title), hint ? h('span.hint', {}, hint) : null), ...body);
  // h()는 태그 문자열의 '.'만 해석하므로 id는 속성으로 넘긴다 (예전 'div.x#id' 표기는 id가 붙지 않아 바로가기가 동작하지 않았음)
  const section = (id, title, sub, role) => h(`div.enh-section${role ? `.role-${role}` : ''}`, { id }, h('h2', {}, title), h('span', {}, sub));
  const kpis = buildKPIs(els);
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '강화 확률·비용 설계'),
        h('p', {}, '단계별 확률과 비용을 직접 설계하고, 목표까지의 기대 비용·편차·파괴 위험을 마르코프 체인으로 정확히 계산합니다. 보조 아이템(BM)의 최적 사용 정책과 목표 비용 역산으로 밸런스를 맞춥니다.'),
      ),
      els.head = h('div.tool-actions', {}),
    ),
    h('div.enh-layout', {},
      els.side = h('aside.enh-side', { 'aria-label': '설정' }),
      h('div.enh-main', {},
        els.bar = h('div.enh-bar', {},
          buildStrip(els),
          h('nav.enh-jump', {}, ...SECTIONS.map(([id, label]) => h('a', { href: `#${id}`, onclick: (e) => { e.preventDefault(); document.getElementById(id).scrollIntoView({ behavior: 'smooth' }); } }, label))),
        ),
        els.errors = h('ul.errors', { hidden: true }),
        kpis,
        h('div.anchor', { id: 'enh-stages' }),
        card('in', '단계별 확률과 비용', '왼쪽 칸을 고치면 같은 줄 오른쪽 결과가 바로 바뀝니다 · 머리글에 마우스를 올리면 설명',
          h('div.table-wrap', {}, els.table = h('table.stages', {})),
          h('div.table-foot', {},
            h('label.switch.inline', {},
              els.showAll = h('input', { type: 'checkbox', onchange: (e) => { ctx.state.showAll = e.target.checked; ctx.tableDirty = true; recompute(); } }),
              '경로 밖 단계도 표시'),
            els.legend = h('span.chip-legend', {}),
            els.rowBtns = h('div.tool-actions', {}),
          ),
        ),

        section('enh-analysis', '결과 분석', '총비용 분포 · 달성 분위 · 재화별 소모 · 계산 검증', 'out'),
        buildDist(ctx, els),
        els.pathCard = h('div.card.role-out'),
        els.distCard = h('div.card.role-out'),
        els.quantCard = h('div.card.role-out'),
        h('div.two-col', {}, els.resources = h('div.card.role-out'), els.verify = h('div.card.role-check')),

        section('enh-tools', '밸런스 도구', '목표 비용 역산 · 보조 아이템 최적 사용 정책 · 아이템 가격 곡선', 'tool'),
        h('div.two-col', {}, els.inverse = h('div.card.tool-card.role-tool'), els.optCard = h('div.card.tool-card.role-tool')),
        els.sweepCard = h('div.card.tool-card.role-tool'),
        els.abCard = h('div.card.role-tool'),
        els.docCard = h('div.card.role-doc'),
      ),
    ),
  );
  // 지표 카드가 위로 스크롤되어 사라졌을 때만 띠를 보여줌
  new IntersectionObserver(([e]) => els.bar.classList.toggle('show', !e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: '-120px 0px 0px 0px' }).observe(kpis);
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
  renderSidebar(ctx, els.side);
  renderOptCard(ctx, els);
  renderSweepCard(ctx, els);
  els.showAll.checked = ctx.state.showAll;
  els.inverse.replaceChildren();
  renderAB();
  ctx.tableDirty = true;
  recompute();
}

// ── 결과 분포 (비용·시도) ───────────────────────────────
let distKind = 'cost';
export function renderDistCard(mc) {
  if (!mc) { els.distCard.replaceChildren(); return; }
  const tabs = h('div.seg-tabs', {}, ...[['cost', '총비용'], ['attempts', '시도 횟수']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(distKind === k), onclick: () => { distKind = k; renderDistCard(mc); } }, l)));
  const body = h('div');
  els.distCard.replaceChildren(tabs, body);
  if (distKind === 'cost') renderDist(body, 'enh:dist', mc.sortedCost, { fmt: (v) => wonFmt(v), title: '총비용 분포', hint: `시뮬레이션 ${comma(mc.trials)}회 · 세로선 = P10·P50·P90·P99`, note: `평균 ${wonFmt(mc.mean.cost)} · 파괴 없이 도달 ${fmtPct(mc.noDestroy)}. 꼬리가 긴 분포라 평균이 중앙값보다 큽니다 — 보통 유저는 P50, 민원 수준은 P90·P99로 보세요.` });
  else renderDist(body, 'enh:dist', Float64Array.from(mc.sortedAttempts || []), { unit: '회', fmt: (v) => comma(v), title: '시도 횟수 분포', hint: `시뮬레이션 ${comma(mc.trials)}회` });
}

// ── 프리셋 저장 · A/B 비교 ──────────────────────────────
function renderAB() {
  renderABCard(els.abCard, {
    tool: 'enhance',
    current: () => serialize(ctx.state),
    apply: (st) => { const h2 = hydrate(st); if (h2) { ctx.state = h2; rebuild(); } },
    metrics: (st) => {
      const s2 = hydrate(st) || st, cfg = configOf(s2), r = analyze(cfg);
      if (!r.ok) throw new Error(r.errors[0]);
      const sim = s2.sim || {};
      const mc = simulate(cfg, Math.min(sim.trials ?? 20000, 10000), sim.seed ?? MC_SEED);
      const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
      const W = (v) => wonFmt(v);
      return [
        { label: '기대 총비용', value: r.expCost, fmt: W, better: 'lower' },
        { label: '총비용 P10', value: q(mc.sortedCost, 0.1), fmt: W, better: 'lower' },
        { label: '총비용 중앙값 (P50)', value: q(mc.sortedCost, 0.5), fmt: W, better: 'lower' },
        { label: '총비용 P90', value: q(mc.sortedCost, 0.9), fmt: W, better: 'lower' },
        { label: '총비용 P99', value: q(mc.sortedCost, 0.99), fmt: W, better: 'lower' },
        { label: '표준편차', value: r.std, fmt: W, better: 'lower' },
        { label: '기대 시도 횟수', value: r.attempts, fmt: (v) => `${(+v.toFixed(1)).toLocaleString('ko-KR')}회`, better: 'lower' },
        { label: '기대 파괴 횟수', value: r.expDestroy, fmt: (v) => `${v.toFixed(2)}회`, better: 'lower' },
        { label: '파괴 없이 도달할 확률', value: r.noDestroy, fmt: (v) => fmtPct(v), better: 'higher' },
      ];
    },
    note: '비교는 두 설정을 같은 시드로 시뮬레이션합니다(각 1만 회). 기대 총비용·표준편차·파괴 확률은 공식 계산값입니다.',
  });
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
    renderTable(ctx, els, null);
    return;
  }
  els.errors.hidden = true;
  ctx.lastRes = res;
  renderKPIs(ctx, els, res);
  renderTable(ctx, els, res);
  renderResources(els, res);
  if (!els.inverse.hasChildNodes()) renderInverse(ctx, els, res); else refreshInverse(ctx, els);
  ctx.renderDoc();
  runMC(cfg, res);
}

function runMC(cfg, res) {
  const id = ++mcSeq;
  const sim = ctx.state.sim || {};
  const trials = Math.min(sim.trials ?? MC_MAX_TRIALS, Math.floor(MC_STEP_BUDGET / Math.max(res.attempts, 1)));
  if (trials < MC_MIN_TRIALS) { renderMCSkipped(ctx, els, res); return; }
  els.distHint.textContent = `시뮬레이션 ${comma(trials)}회 계산 중…`;
  const done = (mc) => { if (id === mcSeq) renderMC(ctx, els, mc, res); };
  try {
    worker ??= new Worker(new URL('./mc-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { if (e.data.id === mcSeq && e.data.ok) done(e.data.result); };
    worker.postMessage({ id, cfg, trials, seed: sim.seed ?? MC_SEED });
  } catch {
    done(simulate(cfg, Math.min(trials, 5000), sim.seed ?? MC_SEED)); // Worker 미지원 환경
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

