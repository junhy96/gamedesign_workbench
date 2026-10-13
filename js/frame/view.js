// 패턴 프레임 검증기 — 화면
import { analyze, toMs } from './model.js';
import { exportFramePptx } from './export.js';
import { TEMPLATES } from './presets.js';
import { h, store, encodeState, decodeState, downloadJSON, pickJSON, toast, debounce } from '../lib/util.js';

const SCHEMA = 1;
const STORE_KEY = 'frame:v1';
const GRADE = {
  good: { label: '여유', cls: 'good' }, warn: { label: '빠듯', cls: 'warn' },
  serious: { label: '가혹', cls: 'serious' }, critical: { label: '불가', cls: 'critical' },
};
const LEVEL = { critical: '불가', serious: '가혹', warn: '주의', info: '참고', good: '여유' };

let state, els = {}, timer, tableDirty = true, last = null;
const save = debounce(() => store.set(STORE_KEY, state), 300);
const schedule = (ms = 120) => { clearTimeout(timer); timer = setTimeout(recompute, ms); };

function defaultState(id) { return { v: SCHEMA, template: id, zoom: 1, ...TEMPLATES[id].make() }; }
function hydrate(o) { return o && o.v === SCHEMA && TEMPLATES[o.template] ? { ...defaultState(o.template), ...o } : null; }
function readHash() { const m = location.hash.match(/^#frame\?s=([\w-]+)/); return m ? hydrate(decodeState(m[1])) : null; }
const toConfig = () => ({ fps: state.fps, policy: state.policy, loop: state.loop, player: state.player, thresholds: state.thresholds, attacks: state.attacks });
const fmtMs = (f) => `${Math.round(toMs(f, state.fps))}ms`;

export function mount(root) {
  state = readHash() || hydrate(store.get(STORE_KEY)) || defaultState('basic');
  if (location.hash.startsWith('#frame?')) history.replaceState(null, '', '#frame');
  build(root);
  rebuild();
  window.addEventListener('resize', debounce(() => last && drawTimeline(last), 150));
  document.addEventListener('themechange', () => last && drawTimeline(last));
  window.addEventListener('hashchange', () => { const st = readHash(); if (st) { state = st; history.replaceState(null, '', '#frame'); rebuild(); } });
}

// ── 골격 ────────────────────────────────────────────────
function build(root) {
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '패턴 프레임 검증기'),
        h('p', {}, '보스 공격의 선딜·판정·후딜과 플레이어의 회피 무적 프레임을 넣으면, 타격마다 회피 윈도우가 몇 프레임인지, 보고 반응할 수 있는지, 반격할 틈이 있는지를 판정합니다. 연계 중 직전 회피의 후딜 때문에 줄어드는 윈도우까지 계산합니다.'),
      ),
      h('div.tool-actions', {},
        els.pptBtn = h('button.btn.primary', { type: 'button', onclick: exportPptx, title: '타임라인·판정 표·검증 결과를 편집 가능한 PowerPoint 도형으로 저장' }, 'PPT 도형으로 저장'),
        h('button.btn', { type: 'button', onclick: copyShareLink }, '공유 링크'),
        h('button.btn', { type: 'button', onclick: () => downloadJSON(`frame-${state.template}.json`, { schemaVersion: SCHEMA, tool: 'frame', state }) }, 'JSON 저장'),
        h('button.btn', { type: 'button', onclick: importJSON }, '불러오기'),
      ),
    ),
    h('div.layout', {},
      els.settings = h('aside.settings.card', { 'aria-label': '설정' }),
      h('div.results', {},
        els.errors = h('ul.errors', { hidden: true }),
        els.kpis = h('div.kpis'),
        h('div.card.tl-card', {},
          h('div.card-head', {},
            h('h2', {}, '프레임 타임라인'),
            h('label.zoom', {}, '확대',
              els.zoom = h('input', { type: 'range', min: 1, max: 8, step: 0.5, oninput: (e) => { state.zoom = +e.target.value; save(); last && drawTimeline(last); } })),
          ),
          buildLegend(),
          els.tlWrap = h('div.tl-wrap', {}),
          els.tip = h('div.tl-tip', { hidden: true, role: 'tooltip' }),
        ),
        h('div.card', {},
          h('div.card-head', {}, h('h2', {}, '보스 연계'), h('span.hint', {}, '단위: 프레임 · 순서대로 이어지는 공격 · 식별 시점 = 공격 시작부터 알아볼 수 있는 프레임')),
          h('div.table-wrap', {}, els.table = h('table.stages.frame-table', {})),
          h('div.table-foot', {}, h('span.muted.small', {}, '판정 칸: 타격별 회피 윈도우와 반응 가능 여부'), h('button.btn.small', { type: 'button', onclick: addAttack }, '+ 공격 추가')),
        ),
        els.findings = h('div.card'),
      ),
    ),
  );
}

function buildLegend() {
  const item = (cls, label) => h('span.lg', {}, h(`i.${cls}`), label);
  return h('div.tl-legend', {},
    item('sw-startup', '선딜'), item('sw-active', '판정'), item('sw-recovery', '후딜'),
    item('sw-inv', '회피 무적'), item('sw-dodge', '회피 선·후딜'), item('sw-counter', '반격 가능 구간'),
    h('span.lg', {}, h('i.sw-win'), '회피 입력 윈도우(색 = 등급)'), h('span.lg', {}, h('i.sw-react'), '반응 가능 시점'),
  );
}

// ── 설정 ────────────────────────────────────────────────
function num(obj, key, label, opts = {}) {
  return h('label.field', {}, h('span', {}, label), h('input', {
    type: 'number', value: obj[key], min: opts.min ?? 0, step: opts.step ?? 1, inputmode: 'numeric', 'aria-label': label,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { obj[key] = opts.float ? v : Math.round(v); schedule(); } },
  }));
}
function sel(options, value, onchange, label) {
  return h('select', { 'aria-label': label, onchange: (e) => onchange(e.target.value) }, ...options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
}

function renderSettings() {
  const p = state.player, th = state.thresholds;
  els.settings.replaceChildren(
    h('label.field', {}, h('span', {}, '템플릿'), sel(Object.entries(TEMPLATES).map(([id, t]) => [id, t.label]), state.template, (v) => { state = defaultState(v); rebuild(); }, '템플릿')),
    h('p.preset-note', {}, TEMPLATES[state.template].note),
    h('div.row2', {},
      h('label.field', {}, h('span', {}, '프레임레이트'), sel([[30, '30 fps'], [60, '60 fps'], [120, '120 fps']], state.fps, (v) => { state.fps = +v; schedule(0); }, '프레임레이트')),
      h('label.field', {}, h('span', {}, '회피 타이밍 가정'), sel([['late', '반응형 (늦게)'], ['optimal', '최적 (선입력)']], state.policy, (v) => { state.policy = v; schedule(0); }, '회피 타이밍')),
    ),
    h('label.switch.inline', {}, h('input', { type: 'checkbox', checked: state.loop, onchange: (e) => { state.loop = e.target.checked; schedule(0); } }), '연계 반복 (마지막 공격 뒤 처음으로)'),
    h('div.option', {},
      h('span.group-title', {}, '플레이어 회피'),
      h('div.row3', {}, num(p, 'dodgeStartup', '선딜'), num(p, 'dodgeInv', '무적', { min: 1 }), num(p, 'dodgeRecovery', '후딜')),
      h('div.row2', {}, num(p, 'reactionMs', '반응 시간 (ms)', { step: 10 }), num(p, 'latency', '입력·화면 지연 (f)')),
      h('p.desc', {}, '반응 시간은 프레임으로 올림 환산되고, 화면 출력·입력 처리 지연이 더해집니다. 일반적으로 반응 200~300ms, 지연 3~6프레임.'),
    ),
    h('div.option', {},
      h('span.group-title', {}, '플레이어 공격 (반격용)'),
      h('div.row3', {}, num(p, 'atkStartup', '발생', { min: 1 }), num(p, 'atkTotal', '전체', { min: 1 }), num(p, 'atkCancel', '회피 캔슬', { min: 1 })),
      h('p.desc', {}, '회피 캔슬 = 공격을 시작한 뒤 회피로 끊을 수 있는 가장 이른 프레임. 반격하고도 다음 공격을 피할 수 있는지 판정에 씁니다.'),
    ),
    h('div.option', {},
      h('span.group-title', {}, '판정 기준 (회피 윈도우)'),
      h('div.row2', {}, num(th, 'comfy', '여유 ≥ (f)', { min: 1 }), num(th, 'tight', '빠듯 ≥ (f)', { min: 1 })),
      h('p.desc', {}, '이보다 작으면 가혹, 0 이하면 불가로 표시합니다.'),
    ),
  );
}

function rebuild() {
  renderSettings();
  els.zoom.value = state.zoom;
  tableDirty = true;
  recompute();
}

// ── 계산 ────────────────────────────────────────────────
function recompute() {
  save();
  const res = analyze(toConfig());
  if (!res.ok) {
    els.errors.replaceChildren(...res.errors.slice(0, 8).map(e => h('li', {}, e)));
    els.errors.hidden = false;
    renderTable(null);
    return;
  }
  els.errors.hidden = true;
  last = res;
  renderKPIs(res);
  drawTimeline(res);
  renderTable(res);
  renderFindings(res);
}

function renderKPIs(r) {
  const s = r.summary, t = s.tightest;
  const name = (ai) => `${ai + 1}. ${state.attacks[ai].name}`;
  const tile = (label, value, sub, hero) => h(`div.card.kpi${hero ? '.hero' : ''}`, {}, h('div.kpi-label', {}, label), h('div.kpi-value', {}, value), h('div.kpi-sub', {}, sub));
  const fails = s.impossible + s.chainFail;
  els.kpis.replaceChildren(
    tile('가장 빡빡한 회피 윈도우', t ? `${t.effWindow}f · ${fmtMs(t.effWindow)}` : '—',
      t ? `${name(t.ai)}${state.attacks[t.ai].hits > 1 ? ` ${t.k + 1}타` : ''} · ${GRADE[t.grade].label}` : '구르기로 피하는 타격 없음', true),
    tile('암기 필요', `${s.memorize} / ${s.hits}타`, `보고 반응하면 늦는 타격 (반응 ${r.reactFrames}f)`),
    tile('회피 불가', `${fails}타`, `판정이 무적보다 김 ${s.impossible} · 연계 불가 ${s.chainFail}${s.needsEarly ? ` (선입력 시 가능 ${s.needsEarly})` : ''}`),
    tile('반격 기회', `${s.counterChances}구간`, `한 구간 최대 ${s.maxCounter}회`),
    tile('연계 길이', `${s.length}f`, `${(s.length / state.fps).toFixed(2)}초 @${state.fps}fps`),
  );
}

// ── 타임라인 (SVG) ──────────────────────────────────────
const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

function drawTimeline(r) {
  const tl = r.timeline;
  const left = 78, pad = 12;
  const avail = Math.max(320, els.tlWrap.clientWidth - left - pad);
  const pxf = Math.max(0.5, (avail / tl.length) * state.zoom);
  const W = left + tl.length * pxf + pad;
  const rows = { ruler: 22, boss: 50, win: 96, player: 142 };
  const H = 176, bar = 22;
  const x = (f) => left + f * pxf;
  const g = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'tl', role: 'img', 'aria-label': '보스 공격과 플레이어 회피의 프레임 타임라인' });
  const tipAttrs = (text) => ({ 'data-tip': text, tabindex: 0 });

  // 행 라벨 + 눈금
  for (const [key, label] of [['boss', '보스'], ['win', '회피 윈도우'], ['player', '플레이어']]) {
    g.append(s('text', { x: 8, y: rows[key] + bar / 2 + 4, class: 'tl-row' }, label));
  }
  const step = [5, 10, 15, 30, 60, 120, 300].find(st => st * pxf >= 46) || 600;
  for (let f = 0; f <= tl.length; f += step) {
    g.append(s('line', { x1: x(f), x2: x(f), y1: rows.ruler + 4, y2: H - 6, class: 'tl-grid' }));
    g.append(s('text', { x: x(f) + 3, y: rows.ruler, class: 'tl-tick' }, `${f}f`));
  }

  // 보스
  const rect = (f0, f1, y, cls, tip, extra = {}) => s('rect', { x: x(f0), y, width: Math.max(1, (f1 - f0 + 1) * pxf), height: extra.h ?? bar, rx: 3, class: cls, ...tipAttrs(tip), ...extra.attrs });
  tl.attacks.forEach((a) => {
    const atk = state.attacks[a.ai];
    const y = rows.boss;
    if (atk.startup > 0) g.append(rect(a.start, a.hits[0].h0 - 1, y, 'b-startup', `${a.ai + 1}. ${a.name} · 선딜 ${atk.startup}f (${a.start}~${a.hits[0].h0 - 1})`));
    a.hits.forEach((hit, k) => {
      if (k > 0 && hit.h0 - a.hits[k - 1].h1 > 1) g.append(rect(a.hits[k - 1].h1 + 1, hit.h0 - 1, y, 'b-startup', `${a.name} · 타격 간격 ${atk.hitGap}f`));
      g.append(rect(hit.h0, hit.h1, y, 'b-active', `${a.name}${a.hits.length > 1 ? ` ${k + 1}타` : ''} · 판정 ${atk.active}f (${hit.h0}~${hit.h1})`));
    });
    if (atk.recovery > 0) g.append(rect(a.hits.at(-1).h1 + 1, a.recoveryEnd, y, 'b-recovery', `${a.name} · 후딜 ${atk.recovery}f`));
    g.append(s('text', { x: x(a.start) + 2, y: y - 5, class: 'tl-name' }, `${a.ai + 1}. ${a.name}`));
    if (atk.recog > 0) g.append(s('line', { x1: x(a.recog), x2: x(a.recog), y1: y - 2, y2: y + bar + 2, class: 'tl-recog', ...tipAttrs(`${a.name} · 식별 가능 시점 ${a.recog}f`) }));
  });

  // 회피 윈도우 + 반응 시점
  r.hits.forEach((hit) => {
    const label = `${hit.ai + 1}. ${hit.name ?? state.attacks[hit.ai].name}${state.attacks[hit.ai].hits > 1 ? ` ${hit.k + 1}타` : ''}`;
    const y = rows.win;
    if (hit.kind === 'dodge') {
      g.append(rect(hit.effLo, hit.hi, y, `w-${hit.grade}`, `${label} · 회피 입력 ${hit.effLo}~${hit.hi}f → 윈도우 ${hit.effWindow}f (${fmtMs(hit.effWindow)}) · ${GRADE[hit.grade].label}${hit.effWindow < hit.window ? ` (단독 ${hit.window}f)` : ''}`));
      if (pxf * hit.effWindow > 18) g.append(s('text', { x: x(hit.effLo) + 3, y: y + bar / 2 + 4, class: `tl-wlabel ${hit.grade}` }, `${hit.effWindow}f`));
      const rx = x(hit.reactNeed);
      g.append(s('line', { x1: rx, x2: rx, y1: y - 3, y2: y + bar + 3, class: `tl-react${hit.memorize ? ' late' : ''}`, ...tipAttrs(`${label} · 보고 누를 수 있는 시점 ${hit.reactNeed}f (식별 + 반응 ${r.reactFrames}f) → ${hit.memorize ? `${-hit.reactMargin}f 늦음, 암기 필요` : `여유 ${hit.reactMargin}f`}`) }));
    } else if (hit.kind === 'impossible' || hit.kind === 'chainFail') {
      g.append(rect(hit.h0, hit.h1, y, 'w-critical', `${label} · ${hit.kind === 'impossible' ? '판정이 무적보다 길어 구르기로 회피 불가' : `직전 회피 후딜(${hit.blockedBy}f까지) 때문에 연속 회피 불가`}${hit.needsEarly ? ' · 선입력하면 가능' : ''}`));
      g.append(s('text', { x: x(hit.h0) + 3, y: y + bar / 2 + 4, class: 'tl-wlabel' }, hit.kind === 'impossible' ? '불가' : '연계 불가'));
    }
  });

  // 플레이어: 회피 + 반격
  const p = state.player;
  r.hits.filter(hit => hit.kind === 'dodge').forEach((hit) => {
    const y = rows.player, p0 = hit.press;
    if (p.dodgeStartup) g.append(rect(p0, p0 + p.dodgeStartup - 1, y, 'p-dodge', `회피 선딜 ${p.dodgeStartup}f (입력 ${p0}f)`));
    g.append(rect(hit.cover[0], hit.cover[1], y, 'p-inv', `회피 무적 ${p.dodgeInv}f (${hit.cover[0]}~${hit.cover[1]})`));
    if (p.dodgeRecovery) g.append(rect(hit.cover[1] + 1, hit.ready - 1, y, 'p-dodge', `회피 후딜 ${p.dodgeRecovery}f · ${hit.ready}f부터 행동 가능`));
  });
  r.counters.forEach((c) => {
    if (!Number.isFinite(c.window) || c.window <= 0) return;
    const end = Math.min(c.deadline - 1, tl.length - 1); // 반복 연계의 마지막 구간은 타임라인 끝에서 자름
    if (end < c.freeAt) return;
    g.append(rect(c.freeAt, end, rows.player + bar + 4, c.count > 0 ? 'p-counter' : 'p-counter none', `${c.ai + 1}. ${state.attacks[c.ai].name} 이후 반격 여유 ${c.window}f (${fmtMs(c.window)}) → ${c.count > 0 ? `${c.count}회 가능` : '반격 불가'}`, { h: 8 }));
  });

  els.tlWrap.replaceChildren(g);
  wireTooltip(g);
}

function wireTooltip(svg) {
  const show = (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) return hide();
    els.tip.textContent = t.getAttribute('data-tip');
    els.tip.hidden = false;
    const box = els.tip.parentElement.getBoundingClientRect();
    const r = t.getBoundingClientRect();
    const px = (e.clientX ?? r.left + r.width / 2) - box.left;
    els.tip.style.left = `${Math.min(Math.max(8, px + 12), box.width - els.tip.offsetWidth - 8)}px`;
    els.tip.style.top = `${r.top - box.top - els.tip.offsetHeight - 6}px`;
  };
  const hide = () => { els.tip.hidden = true; };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focusin', show);
  svg.addEventListener('focusout', hide);
}

// ── 표 ──────────────────────────────────────────────────
const COLS = [['name', '이름'], ['startup', '선딜'], ['active', '판정'], ['hits', '타수'], ['hitGap', '타격 간격'], ['recovery', '후딜'], ['gap', '다음까지'], ['recog', '식별 시점']];

function renderTable(res) {
  if (!tableDirty && els.table.contains(document.activeElement)) return updateResults(res);
  tableDirty = false;
  els.table.replaceChildren(
    h('thead', {}, h('tr', {}, h('th.left', {}, '#'), ...COLS.map(([, l], i) => h(i === 0 ? 'th.left' : 'th', {}, l)), h('th.left', {}, '회피 판정'), h('th', {}, '반격'), h('th', {}, ''))),
    h('tbody', {}, ...state.attacks.map((a, i) => h('tr', { dataset: { i } },
      h('td.stage', {}, i + 1),
      ...COLS.map(([key]) => h('td', {}, key === 'name'
        ? h('input.name', { type: 'text', value: a.name, 'aria-label': `${i + 1}번 이름`, oninput: (e) => { a.name = e.target.value || `공격 ${i + 1}`; schedule(300); } })
        : h('input', {
          type: 'number', value: a[key], min: key === 'active' || key === 'hits' ? 1 : 0, step: 1, 'aria-label': `${i + 1}번 ${COLS.find(c => c[0] === key)[1]}`,
          oninput: (e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v)) { a[key] = v; schedule(); } },
        }))),
      h('td.verdicts', { dataset: { k: 'verdict' } }),
      h('td', { dataset: { k: 'counter' } }),
      h('td.row-actions', {},
        h('button.icon-x', { type: 'button', title: '위로', disabled: i === 0, onclick: () => moveAttack(i, -1) }, '↑'),
        h('button.icon-x', { type: 'button', title: '아래로', disabled: i === state.attacks.length - 1, onclick: () => moveAttack(i, 1) }, '↓'),
        h('button.icon-x', { type: 'button', title: '삭제', disabled: state.attacks.length <= 1, onclick: () => removeAttack(i) }, '×'),
      ),
    ))),
  );
  updateResults(res);
}

function verdictChip(hit) {
  const g = GRADE[hit.grade];
  let text;
  if (hit.kind === 'covered') text = '함께 회피';
  else if (hit.kind === 'impossible') text = '불가 · 판정>무적';
  else if (hit.kind === 'chainFail') text = hit.needsEarly ? '연계 불가 · 선입력 시 가능' : '연계 불가';
  else text = `${hit.memorize ? '암기' : '반응'} · ${hit.effWindow}f`;
  return h(`span.verdict.${hit.kind === 'covered' ? 'good' : g.cls}`, { title: hit.kind === 'dodge' ? `회피 윈도우 ${hit.effWindow}f(${fmtMs(hit.effWindow)}) · ${g.label} · 반응 ${hit.memorize ? `${-hit.reactMargin}f 늦음` : `여유 ${hit.reactMargin}f`}` : '' }, text);
}

function updateResults(res) {
  for (const tr of els.table.querySelectorAll('tbody tr')) {
    const i = +tr.dataset.i;
    const vCell = tr.querySelector('[data-k="verdict"]'), cCell = tr.querySelector('[data-k="counter"]');
    if (!res) { vCell.replaceChildren(); cCell.textContent = ''; continue; }
    vCell.replaceChildren(...res.hits.filter(hh => hh.ai === i).map(verdictChip));
    const c = res.counters[i];
    cCell.textContent = c.last ? '—' : c.count > 0 ? `${c.count}회 (${c.window}f)` : `불가 (${c.window}f)`;
    cCell.className = c.count > 0 && !c.last ? 'ok' : '';
  }
}

function addAttack() {
  const prev = state.attacks.at(-1);
  state.attacks.push({ ...structuredClone(prev), name: `공격 ${state.attacks.length + 1}` });
  tableDirty = true; recompute();
}
function removeAttack(i) { state.attacks.splice(i, 1); tableDirty = true; recompute(); }
function moveAttack(i, d) {
  const a = state.attacks; [a[i], a[i + d]] = [a[i + d], a[i]];
  tableDirty = true; recompute();
}

// ── 검증 결과 ───────────────────────────────────────────
function renderFindings(r) {
  const counts = r.findings.reduce((m, f) => ((m[f.level] = (m[f.level] || 0) + 1), m), {});
  els.findings.replaceChildren(
    h('div.card-head', {}, h('h2', {}, '검증 결과'),
      h('span.hint', {}, ['critical', 'serious', 'warn'].filter(l => counts[l]).map(l => `${LEVEL[l]} ${counts[l]}`).join(' · ') || '문제 없음')),
    h('ul.findings', {}, ...r.findings.map(f => h(`li.${f.level}`, {}, h('span.lv', {}, LEVEL[f.level]), h('span', {}, f.text)))),
  );
}

// ── PowerPoint ──────────────────────────────────────────
async function exportPptx() {
  if (!last) { toast('먼저 오류를 고쳐 주세요'); return; }
  const btn = els.pptBtn, label = btn.textContent;
  btn.disabled = true; btn.textContent = '만드는 중…';
  try {
    await exportFramePptx(last, state, `패턴 프레임 검증 - ${TEMPLATES[state.template].label}`);
    toast('PowerPoint 파일을 저장했습니다 (모든 요소가 편집 가능한 도형)');
  } catch (e) {
    toast(e.message || 'PowerPoint 파일을 만들지 못했습니다');
  } finally { btn.disabled = false; btn.textContent = label; }
}

// ── 공유·불러오기 ───────────────────────────────────────
async function copyShareLink() {
  const url = `${location.origin}${location.pathname}#frame?s=${encodeState(state)}`;
  try { await navigator.clipboard.writeText(url); toast('공유 링크를 복사했습니다'); } catch { prompt('아래 링크를 복사하세요', url); }
}
async function importJSON() {
  try {
    const data = await pickJSON();
    const st = data?.tool === 'frame' ? hydrate(data.state) : null;
    if (!st) throw new Error();
    state = st; rebuild(); toast('설정을 불러왔습니다');
  } catch { toast('불러올 수 없는 파일입니다'); }
}
