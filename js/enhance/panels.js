// 왼쪽 설정 메뉴: 템플릿·구간, 연속 보정, 이벤트, 재화와 비용, 보조 아이템
import { TEMPLATES } from './presets.js';
import { MAX_ITEMS, MAX_UNITS } from './model.js';
import { h, store, comma } from '../lib/util.js';
import { simFields } from '../lib/simconfig.js';
import { rateOf, setRate } from './currency.js';

const MAX_RESOURCES = 4;

/** 숫자 입력. obj[key]를 직접 갱신하고 ctx.schedule() 호출. */
export function numInput(ctx, obj, key, opts = {}) {
  return h('input', {
    type: 'number', value: obj[key], step: opts.step ?? 'any', min: opts.min, max: opts.max,
    inputmode: 'decimal', 'aria-label': opts.label, class: opts.cls,
    oninput: (e) => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      obj[key] = opts.int ? Math.round(v) : v;
      opts.after?.();
      ctx.schedule(opts.delay);
    },
  });
}

const field = (label, input, hint) => h('label.field', {}, h('span', {}, label), input, hint ? h('small', {}, hint) : null);

function toggle(ctx, label, obj, key, after, defaultOn = false) {
  return h('label.switch', {}, label, h('input', {
    type: 'checkbox', checked: obj[key] ?? defaultOn,
    onchange: (e) => { obj[key] = e.target.checked; after?.(); ctx.rebuild(); },
  }));
}

function select(options, value, onchange) {
  return h('select', { onchange: (e) => onchange(e.target.value) },
    ...options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
}

// ── 왼쪽 설정 메뉴 ─────────────────────────────────────
// 접을 수 있는 구역(템플릿·구간 / 연속 보정 / 이벤트 / 재화와 비용 / 보조 아이템). 펼침 상태는 이 브라우저에 기억.
const OPEN_KEY = 'enhance:sideOpen';
const openState = () => store.get(OPEN_KEY) || {};

function section(id, title, summary, ...body) {
  return h('details.side-sec', {
    open: openState()[id] ?? (id === 'base' || matchMedia('(min-width: 1101px)').matches), // 좁은 화면에서는 기본으로 접음
    ontoggle: (e) => store.set(OPEN_KEY, { ...openState(), [id]: e.target.open }),
  },
  h('summary', {}, h('span.side-title', {}, title), summary ? h('span.side-sum', {}, summary) : null),
  h('div.side-body', {}, ...body.filter(Boolean)));
}

export function renderSidebar(ctx, el) {
  const s = ctx.state;
  const t = TEMPLATES[s.template];
  const st = s.streak, ev = s.event;
  const STREAK = { none: '없음', fail: '연속 실패 기준', drop: '찬스타임' };

  const streakFields = st.kind === 'none' ? [h('p.desc', {}, '실패가 쌓일수록 성공률이 오르는 보너스, n회 실패 시 확정 성공(천장), 연속 하락 후 확정 성공(찬스타임)을 설정합니다.')] : [
    toggle(ctx, '실패 누적 보너스 (실패당 +n%)', st, 'bonusOn', null, true),
    h('div.row2', {},
      field('실패 1회당 보너스', numInput(ctx, st, 'bonus', { min: 0, label: '보너스' })),
      field('보너스 기준', select([['rel', '기본 성공률의 %'], ['abs', '%p (고정)']], st.bonusMode, (v) => { st.bonusMode = v; ctx.rebuild(); })),
    ),
    h('div.row2', {},
      field('최대 성공률 %', numInput(ctx, st, 'cap', { min: 0, max: 100, label: '최대 성공률' })),
      field('천장 (회, 0=없음)', numInput(ctx, st, 'pity', { min: 0, int: true, label: '천장' })),
    ),
    toggle(ctx, '천장 (n회 실패 시 확정 성공)', st, 'pityOn', null, true),
    h('p.desc', {}, st.kind === 'fail'
      ? '유지·하락할 때마다 카운터 +1, 성공·파괴 시 초기화. 천장에 도달하면 다음 시도는 확정 성공.'
      : '하락할 때만 카운터 +1(유지는 그대로), 성공·파괴 시 초기화. 천장 2 = 2연속 하락 후 확정 성공(찬스타임).'),
  ];

  el.replaceChildren(
    section('base', '템플릿 · 강화 구간', `+${s.start} → +${s.target}`,
      select(Object.entries(TEMPLATES).map(([id, x]) => [id, x.label]), s.template, (v) => ctx.loadTemplate(v)),
      h('p.desc', {}, t.note),
      h('div.row3', {},
        field('시작', numInput(ctx, s, 'start', { int: true, min: 0, label: '시작 단계' })),
        field('목표', numInput(ctx, s, 'target', { int: true, min: 1, label: '목표 단계', after: () => ctx.markTableDirty() })),
        field('파괴 시 복구', numInput(ctx, s, 'restore', { int: true, min: 0, label: '복구 단계' })),
      ),
      toggle(ctx, '이중 강화 (대성공 +2단계)', s, 'double', () => ctx.markTableDirty()),
    ),
    section('streak', '연속 보정', STREAK[st.kind],
      select([['none', '없음'], ['fail', '연속 실패 기준 (천장·실패 누적 보너스)'], ['drop', '연속 하락 기준 (찬스타임)']], st.kind, (v) => { st.kind = v; ctx.rebuild(); }),
      ...streakFields,
    ),
    section('event', '이벤트 배율', ev.on ? '켜짐' : '꺼짐',
      toggle(ctx, '이벤트 적용', ev, 'on'),
      ev.on ? h('div.row3', {},
        field('성공 ×', numInput(ctx, ev, 'successMult', { min: 0, step: 0.05, label: '성공 배율' })),
        field('파괴 ×', numInput(ctx, ev, 'destroyMult', { min: 0, step: 0.05, label: '파괴 배율' })),
        field('비용 ×', numInput(ctx, ev, 'costMult', { min: 0, step: 0.05, label: '비용 배율' })),
      ) : h('p.desc', {}, '성공·파괴 확률과 강화 비용에 일괄 배율을 적용해 이벤트 효과를 봅니다.'),
    ),
    section('currency', '재화와 비용', s.resources.map(r => r.name).join(' · '), ...currencyBody(ctx)),
    section('items', '보조 아이템 (BM)', s.items.length ? `${s.items.length}개` : '없음', ...itemsBody(ctx)),
    section('sim', '시뮬레이션', `${comma(s.sim?.trials ?? 20000)}회 · 시드 ${s.sim?.seed ?? 20261013}`,
      ...simFields(s.sim ||= { trials: 20000, seed: 20261013 }, { runsKey: 'trials', def: 20261013, min: 1000, max: 200000, onChange: () => ctx.schedule(300),
        runsHint: '기대 시도가 많은 설정은 계산량 상한(기대 시도 × 횟수 ≤ 4천만) 때문에 자동으로 줄어듭니다' })),
  );
}

// 재화: 이름 · 환율 · 파괴 시 추가 비용, 결과 표시 단위
function currencyBody(ctx) {
  const s = ctx.state;
  return [
    h('p.desc', {}, '재화마다 원화 환율을 정합니다 (예: 10,000 골드 = 10 원). 무료 재화도 획득 시간·기회비용으로 환산해 두세요.'),
    ...s.resources.map((res, ri) => {
      const rate = rateOf(res);
      const n = (key, label) => h('input', {
        type: 'number', value: rate[key], min: 0, step: 'any', 'aria-label': label,
        oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= 0) { rate[key] = v; setRate(res, rate.units, rate.won); ctx.schedule(); } },
      });
      return h('div.res-block', {},
        h('div.res-row', {},
          h('input', { type: 'text', value: res.name, 'aria-label': '재화 이름', oninput: (e) => { res.name = e.target.value || `재화${ri + 1}`; ctx.schedule(400, true); } }),
          h('button.icon-x', { type: 'button', title: '재화 삭제', disabled: s.resources.length <= 1, onclick: () => removeResource(ctx, ri) }, '×')),
        h('div.rate-row', {}, n('units', `${res.name} 수량`), h('span', {}, res.name), h('span.eq', {}, '='), n('won', '원화 금액'), h('span', {}, '원')),
        h('div.kv-row', { title: '파괴되면 복구 단계로 돌아가고 이 비용이 더해집니다 (복구 비용 또는 장비 재구매 비용)' },
          h('span', {}, '파괴 시 추가'), numInput(ctx, s.destroyCosts, ri, { min: 0, label: `파괴 시 ${res.name}` }), h('span', {}, res.name)),
      );
    }),
    s.resources.length < MAX_RESOURCES ? h('button.btn.small', { type: 'button', onclick: () => addResource(ctx) }, '+ 재화 추가') : null,
    field('결과 표시 단위', select([['won', '원'], ...s.resources.map((r, i) => [String(i), r.name])], String(s.display ?? 'won'),
      (v) => { s.display = v === 'won' ? 'won' : +v; ctx.rebuild(); }),
    '기대 비용·분포·예산을 이 단위로 보여줍니다'),
  ];
}

function addResource(ctx) {
  const s = ctx.state;
  s.resources.push({ name: `재화${s.resources.length + 1}`, value: 1, rate: { units: 1, won: 1 } });
  s.rows.forEach(r => r.costs.push(0));
  s.destroyCosts.push(0);
  s.items.forEach(it => it.costs.push(0));
  ctx.markTableDirty(); ctx.rebuild();
}

function removeResource(ctx, ri) {
  const s = ctx.state;
  s.resources.splice(ri, 1);
  if (s.display === ri) s.display = 'won'; else if (typeof s.display === 'number' && s.display > ri) s.display--;
  s.rows.forEach(r => r.costs.splice(ri, 1));
  s.destroyCosts.splice(ri, 1);
  s.items.forEach(it => it.costs.splice(ri, 1));
  ctx.markTableDirty(); ctx.rebuild();
}

// ── 보조 아이템 편집기 ──────────────────────────────────
const EFFECTS = [['protect', '파괴방지 (파괴→유지)'], ['nodrop', '하락방지 (하락→유지)'], ['boost', '성공률 증가 (%p)']];
// 수량형은 성공률 증가 전용 (파괴방지·하락방지는 1개면 효과가 다 나므로)
const MODES = [['toggle', '1개 사용 (켜기/끄기)'], ['quantity', '개수 단위 투입']];

function itemsBody(ctx) {
  const s = ctx.state;
  return [
    s.items.length ? null : h('p.desc', {}, '파괴방지권·하락방지권·성공률 증가 아이템을 추가해 BM 구조를 설계하세요.'),
    ...s.items.map((it) => h('div.res-block', {},
      h('div.res-row', {},
        h('input', { type: 'text', value: it.name, 'aria-label': '아이템 이름', oninput: (e) => { it.name = e.target.value || '아이템'; ctx.schedule(400, true); } }),
        h('button.icon-x', { type: 'button', title: '아이템 삭제', onclick: () => removeItem(ctx, it.id) }, '×')),
      h('div.effect-row', {},
        select(EFFECTS, it.effect, (v) => { it.effect = v; if (v !== 'boost') it.mode = 'toggle'; ctx.markTableDirty(); ctx.rebuild(); }),
        it.effect === 'boost' ? h('div.unit-input', {}, numInput(ctx, it, 'amount', { min: 0, max: 100, label: it.mode === 'quantity' ? '개당 증가량' : '증가량' }), h('span', {}, it.mode === 'quantity' ? '%p/개' : '%p')) : null),
      it.effect === 'boost' ? h('div.effect-row', {},
        select(MODES, it.mode ?? 'toggle', (v) => { it.mode = v; if (v === 'quantity') it.maxUnits ??= 10; ctx.markTableDirty(); ctx.rebuild(); }),
        it.mode === 'quantity' ? h('div.unit-input', { title: '한 번의 시도에 넣을 수 있는 최대 개수' }, h('span', {}, '최대'), numInput(ctx, it, 'maxUnits', { int: true, min: 1, max: MAX_UNITS, label: '최대 개수', after: () => ctx.markTableDirty() }), h('span', {}, '개')) : null) : null,
      h('div.cost-mini', {}, ...s.resources.map((res, ri) => h('label.mini-field', {}, h('span', {}, res.name), numInput(ctx, it.costs, ri, { min: 0, label: `${it.name} ${res.name}` })))),
      h('div.kv-row', { title: '이 단계 범위에서만 사용할 수 있습니다. 실제 사용 여부는 단계 표의 아이템 칸에서 켭니다' },
        h('span', {}, '적용 단계'),
        numInput(ctx, it, 'from', { int: true, min: 0, label: '적용 시작', after: () => ctx.markTableDirty() }), h('span', {}, '~'),
        numInput(ctx, it, 'to', { int: true, min: 0, label: '적용 끝', after: () => ctx.markTableDirty() })),
    )),
    s.items.length < MAX_ITEMS ? h('button.btn.small', { type: 'button', onclick: () => addItem(ctx) }, '+ 아이템 추가') : null,
    s.items.length ? h('p.desc', {}, '비용 = 1회 사용 비용 (수량형은 1개 가격). 단계별 사용은 오른쪽 단계 표의 아이템 칸에서 켜거나 개수를 넣습니다.') : null,
  ];
}

function addItem(ctx) {
  const s = ctx.state;
  const last = s.rows.at(-1)?.stage ?? 0;
  s.items.push({ id: 'it' + Date.now().toString(36), name: '새 아이템', effect: 'protect', mode: 'toggle', amount: 10, costs: s.resources.map(() => 0), from: 0, to: last });
  ctx.markTableDirty(); ctx.rebuild();
}

function removeItem(ctx, id) {
  const s = ctx.state;
  s.items = s.items.filter(it => it.id !== id);
  const drop = (spec) => {
    if (Array.isArray(spec)) return spec.filter(x => x !== id);
    const { [id]: _, ...rest } = spec.units ?? spec;
    return spec.units ? { units: rest } : rest;
  };
  for (const [stage, u] of Object.entries(s.usage)) s.usage[stage] = u.byCounter ? { byCounter: u.byCounter.map(drop) } : drop(u);
  ctx.markTableDirty(); ctx.rebuild();
}
