// 설정 패널(범위·재화·파괴·이중 강화·연속 보정·이벤트)과 보조 아이템 편집기
import { TEMPLATES } from './presets.js';
import { MAX_ITEMS } from './model.js';
import { h } from '../lib/util.js';
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

function toggle(ctx, label, obj, key, after) {
  return h('label.switch', {}, label, h('input', {
    type: 'checkbox', checked: !!obj[key],
    onchange: (e) => { obj[key] = e.target.checked; after?.(); ctx.rebuild(); },
  }));
}

function select(options, value, onchange) {
  return h('select', { onchange: (e) => onchange(e.target.value) },
    ...options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
}

// ── 설정 패널 ───────────────────────────────────────────
export function renderSettings(ctx, el) {
  const s = ctx.state;
  const t = TEMPLATES[s.template];
  const st = s.streak, ev = s.event;

  const streakFields = st.kind === 'none' ? [] : [
    h('div.row2', {},
      field('실패 1회당 보너스', numInput(ctx, st, 'bonus', { min: 0, label: '보너스' })),
      field('보너스 기준', select([['rel', '기본 성공률의 %'], ['abs', '%p (고정)']], st.bonusMode, (v) => { st.bonusMode = v; ctx.rebuild(); })),
    ),
    h('div.row2', {},
      field('최대 성공률 %', numInput(ctx, st, 'cap', { min: 0, max: 100, label: '최대 성공률' })),
      field('천장 (회, 0=없음)', numInput(ctx, st, 'pity', { min: 0, int: true, label: '천장' })),
    ),
    h('p.desc', {}, st.kind === 'fail'
      ? '유지·하락할 때마다 카운터 +1, 성공·파괴 시 초기화. 천장에 도달하면 다음 시도는 확정 성공.'
      : '하락할 때만 카운터 +1(유지는 그대로), 성공·파괴 시 초기화. 천장 2 = 2연속 하락 후 확정 성공(찬스타임).'),
  ];

  el.replaceChildren(...[
    field('템플릿', select(Object.entries(TEMPLATES).map(([id, x]) => [id, x.label]), s.template, (v) => ctx.loadTemplate(v))),
    h('p.preset-note', {}, t.note),

    h('div.row3', {},
      field('시작', numInput(ctx, s, 'start', { int: true, min: 0, label: '시작 단계' })),
      field('목표', numInput(ctx, s, 'target', { int: true, min: 1, label: '목표 단계', after: () => ctx.markTableDirty() })),
      field('파괴 시 복구', numInput(ctx, s, 'restore', { int: true, min: 0, label: '복구 단계' })),
    ),

    h('div.option', {},
      h('span.group-title', {}, '재화와 환율'),
      h('p.desc', {}, '재화마다 원화 환율을 정합니다 (예: 10,000 골드 = 10 원). 무료 재화도 획득 시간·기회비용으로 환산해 두면 모든 비용을 한 기준으로 비교할 수 있습니다.'),
      ...s.resources.map((res, ri) => {
        const rate = rateOf(res);
        const apply = () => { setRate(res, rate.units, rate.won); ctx.schedule(); };
        const n = (key, label) => h('input', { type: 'number', value: rate[key], min: 0, step: 'any', 'aria-label': label,
          oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= 0) { rate[key] = v; apply(); } } });
        return h('div.res-block', {},
          h('div.res-row', {},
            h('input', { type: 'text', value: res.name, 'aria-label': '재화 이름', oninput: (e) => { res.name = e.target.value || `재화${ri + 1}`; ctx.schedule(400, true); } }),
            h('button.icon-x', { type: 'button', title: '재화 삭제', disabled: s.resources.length <= 1, onclick: () => removeResource(ctx, ri) }, '×')),
          h('div.rate-row', {}, n('units', `${res.name} 수량`), h('span', {}, res.name), h('span.eq', {}, '='), n('won', '원화 금액'), h('span', {}, '원')),
        );
      }),
      s.resources.length < MAX_RESOURCES ? h('button.btn.small', { type: 'button', onclick: () => addResource(ctx) }, '+ 재화 추가') : null,
      field('결과 표시 단위', select([['won', '원'], ...s.resources.map((r, i) => [String(i), r.name])], String(s.display ?? 'won'),
        (v) => { s.display = v === 'won' ? 'won' : +v; ctx.rebuild(); }),
      '기대 비용·분포·예산을 이 단위로 보여줍니다. 골드를 고르면 “기대 총비용 2,796만 골드”처럼 표시'),
    ),

    h('div.option', {},
      h('span.group-title', {}, '파괴 시 추가 비용'),
      h('p.desc', {}, '복구 비용 또는 장비 재구매 비용. 파괴되면 복구 단계로 돌아가고 이 비용이 더해집니다.'),
      h('div.cost-grid', {}, ...s.resources.map((res, ri) => field(res.name, numInput(ctx, s.destroyCosts, ri, { min: 0, label: `파괴 시 ${res.name}` })))),
    ),

    h('div.option', {},
      toggle(ctx, '이중 강화 (대성공 +2단계)', s, 'double', () => ctx.markTableDirty()),
      h('p.desc', {}, '성공 중 일부가 2단계를 한 번에 올리는 대성공이 됩니다. 켜면 표에 대성공 칸이 생깁니다.'),
    ),

    h('div.option', {},
      h('span.group-title', {}, '연속 보정 (천장·보너스·찬스타임)'),
      select([['none', '없음'], ['fail', '연속 실패 기준 (천장·실패 누적 보너스)'], ['drop', '연속 하락 기준 (찬스타임)']], st.kind, (v) => { st.kind = v; ctx.rebuild(); }),
      ...streakFields,
    ),

    h('div.option', {},
      toggle(ctx, '이벤트 배율', ev, 'on'),
      ev.on ? h('div.row3', {},
        field('성공 ×', numInput(ctx, ev, 'successMult', { min: 0, step: 0.05, label: '성공 배율' })),
        field('파괴 ×', numInput(ctx, ev, 'destroyMult', { min: 0, step: 0.05, label: '파괴 배율' })),
        field('비용 ×', numInput(ctx, ev, 'costMult', { min: 0, step: 0.05, label: '비용 배율' })),
      ) : h('p.desc', {}, '성공·파괴 확률과 강화 비용에 일괄 배율을 적용해 이벤트 효과를 봅니다.'),
    ),
  ].filter(Boolean));
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
const EFFECTS = [['protect', '파괴방지 (파괴 → 유지)'], ['nodrop', '하락방지 (하락 → 유지)'], ['boost', '성공률 증가 (%p)']];

export function renderItems(ctx, el) {
  const s = ctx.state;
  el.replaceChildren(
    s.items.length ? h('div.item-list', {}, ...s.items.map((it) => h('div.item-row', {},
      h('div.item-main', {},
        h('input.item-name', { type: 'text', value: it.name, 'aria-label': '아이템 이름', oninput: (e) => { it.name = e.target.value || '아이템'; ctx.schedule(400, true); } }),
        select(EFFECTS, it.effect, (v) => { it.effect = v; ctx.rebuild(); }),
        it.effect === 'boost' ? h('div.unit-input', {}, numInput(ctx, it, 'amount', { min: 0, max: 100, label: '증가량' }), h('span', {}, '%p')) : null,
        h('button.icon-x', { type: 'button', title: '아이템 삭제', onclick: () => removeItem(ctx, it.id) }, '×'),
      ),
      h('div.item-sub', {},
        h('span.muted', {}, '1회 비용'),
        ...s.resources.map((res, ri) => h('div.unit-input', {}, numInput(ctx, it.costs, ri, { min: 0, label: `${it.name} ${res.name}` }), h('span', {}, res.name))),
        h('span.muted', {}, '적용 단계'),
        h('div.unit-input', {}, numInput(ctx, it, 'from', { int: true, min: 0, label: '적용 시작', after: () => ctx.markTableDirty() }), h('span', {}, '~')),
        h('div.unit-input', {}, numInput(ctx, it, 'to', { int: true, min: 0, label: '적용 끝', after: () => ctx.markTableDirty() })),
      ),
    ))) : h('p.muted', {}, '보조 아이템이 없습니다. 파괴방지권·하락방지권·성공률 증가 아이템을 추가해 BM 구조를 설계하세요.'),
    s.items.length < MAX_ITEMS ? h('button.btn.small', { type: 'button', onclick: () => addItem(ctx) }, '+ 아이템 추가') : null,
  );
}

function addItem(ctx) {
  const s = ctx.state;
  const last = s.rows.at(-1)?.stage ?? 0;
  s.items.push({ id: 'it' + Date.now().toString(36), name: '새 아이템', effect: 'protect', amount: 10, costs: s.resources.map(() => 0), from: 0, to: last });
  ctx.markTableDirty(); ctx.rebuild();
}

function removeItem(ctx, id) {
  const s = ctx.state;
  s.items = s.items.filter(it => it.id !== id);
  for (const [stage, u] of Object.entries(s.usage)) {
    if (Array.isArray(u)) s.usage[stage] = u.filter(x => x !== id);
    else s.usage[stage] = { byCounter: u.byCounter.map(a => a.filter(x => x !== id)) };
  }
  ctx.markTableDirty(); ctx.rebuild();
}
