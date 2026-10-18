// 단계 표: 왼쪽은 설계 입력(확률·비용·아이템 사용), 오른쪽은 같은 줄의 계산 결과(기대 시도·돌파 전 파괴·비용 비중·민감도)
import { h, fmtPct, fmtNum } from '../lib/util.js';
import { money } from './currency.js';
import { stageUnits, specUnits, unitsToSpec, isQty } from './model.js';

/**
 * 표 구조를 다시 그린다. 입력 중(포커스가 표 안)이면 구조는 유지하고 값만 갱신해 포커스를 지킨다.
 */
export function renderTable(ctx, els, res) {
  if (!ctx.tableDirty && els.table.contains(document.activeElement)) return updateValues(ctx, els, res);
  ctx.tableDirty = false;
  const s = ctx.state;
  const lo = Math.min(s.start, s.restore), hi = s.target - 1;
  const onPath = (i) => i >= lo && i <= hi;
  const rows = s.rows.filter(r => s.showAll || onPath(r.stage));

  const input = [
    '성공 %', ...(s.double ? ['대성공 %'] : []), '유지 %', '하락 %', '파괴 %',
    ...s.resources.map(r => `${r.name} 비용`), ...(s.items.length ? ['보조 아이템'] : []),
  ];
  const result = ['기대 시도', '돌파 전 파괴', '비용 비중', '민감도'];
  const th = (t, cls) => h('th', { title: HEAD_TIPS[t] || null, class: cls }, t);
  // 성공·대성공을 고치면 파괴는 그대로 두고 실패(유지·하락)를 합 100%에 맞춘다. 유지:하락 비율은 입력을 시작할 때의 값을 따른다
  const probCell = (r, key) => h('td', {}, h('input', {
    type: 'number', value: r[key], step: 0.01, min: 0, max: 100, 'aria-label': `+${r.stage} ${key}`, dataset: { p: key },
    onfocus: (e) => { e.target._fail = { k: r.k, d: r.d }; },
    oninput: (e) => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      r[key] = v;
      if (key === 's' || key === 's2') {
        const fail = fillFailure(r, s.double, e.target._fail);
        const tr = e.target.closest('tr');
        for (const k of ['k', 'd']) { const el = tr.querySelector(`input[data-p="${k}"]`); if (el) el.value = String(fail[k]); }
      }
      ctx.schedule(250);
    },
  }));
  const costCell = (r, ri) => h('td', {}, h('input.cost', {
    type: 'number', value: r.costs[ri], step: 'any', min: 0, 'aria-label': `+${r.stage} ${s.resources[ri].name} 비용`,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { r.costs[ri] = v; ctx.schedule(250); } },
  }));

  els.table.replaceChildren(
    h('thead', {},
      h('tr.group', {}, h('th', {}), h('th.group-in', { colspan: input.length }, '설계 입력 — 칸을 직접 수정 · 성공을 고치면 유지·하락이 합 100%로 맞춰짐'), h('th.group-out', { colspan: result.length }, '계산 결과')),
      h('tr', {}, th('단계', 'left'), ...input.map(t => th(t)), ...result.map((t, i) => th(t, i ? 'res' : 'res first')))),
    h('tbody', {}, ...rows.map(r => h(`tr${onPath(r.stage) ? '' : '.off'}`, { dataset: { stage: r.stage } },
      h('td.stage', {}, `+${r.stage} → +${r.stage + 1}`, h('span.sum-bad', { dataset: { k: 'sum' } })),
      probCell(r, 's'), s.double ? probCell(r, 's2') : null, probCell(r, 'k'), probCell(r, 'd'), probCell(r, 'b'),
      ...s.resources.map((_, ri) => costCell(r, ri)),
      s.items.length ? h('td.chips', {}, ...itemChips(ctx, r.stage)) : null,
      h('td.res.first', { dataset: { k: 'visits' } }),
      h('td.res', { dataset: { k: 'risk' } }),
      h('td.res', {}, h('div.share-cell', { dataset: { k: 'shareCell' } }, h('span', { dataset: { k: 'share' } }), h('div.share-bar', {}, h('i', { dataset: { k: 'bar' } })))),
      h('td.res', { dataset: { k: 'sens' } }),
    ))),
  );
  updateValues(ctx, els, res);

  els.legend.replaceChildren(...(s.items.length ? [
    h('span.muted', {}, '아이템 칸: '),
    ...s.items.map(it => h('span.legend-item', {}, h('b', {}, abbr(s.items, it)), ` ${it.name}`)),
    s.items.some(isQty) ? h('span.muted', {}, ' · 숫자 칸 = 1회 투입 개수') : null,
    h('span.muted', {}, ' · * 상황별 사용'),
  ].filter(Boolean) : []));

  els.rowBtns.replaceChildren(
    h('button.btn.small', { type: 'button', onclick: () => addRow(ctx) }, '+ 단계 추가'),
    h('button.btn.small', { type: 'button', onclick: () => removeRow(ctx), disabled: s.rows.length <= 1 }, '마지막 단계 삭제'),
  );
}

/**
 * 성공 + 대성공 + 파괴를 뺀 나머지를 유지·하락에 나눠 합을 100%로. base = 비율 기준(없으면 지금 값), 둘 다 0이면 모두 유지.
 * 나머지가 음수면 0 (합이 100%를 넘으면 표가 경고). r을 바꾸고 { k, d }를 돌려준다
 */
export function fillFailure(r, double, base = r) {
  const round = (x) => Math.round(x * 1e4) / 1e4;
  const fail = Math.max(0, round(100 - r.s - (double ? r.s2 || 0 : 0) - r.b));
  const bk = Math.max(0, base.k || 0), bd = Math.max(0, base.d || 0);
  const k = bk + bd > 0 ? round(fail * bk / (bk + bd)) : fail;
  r.k = k; r.d = round(fail - k);
  return { k: r.k, d: r.d };
}

const HEAD_TIPS = {
  '성공 %': '고치면 파괴는 그대로 두고 유지·하락(실패)이 합 100%에 맞게 자동으로 바뀝니다. 유지와 하락은 원래 비율대로 나눕니다',
  '대성공 %': '고치면 파괴는 그대로 두고 유지·하락(실패)이 합 100%에 맞게 자동으로 바뀝니다',
  '돌파 전 파괴': '이 단계에서 출발해 다음 단계에 닿기 전에 파괴될 확률. 하락해서 다시 올라오는 경로와 연속 보정까지 포함해 계산한 값',
  '기대 시도': '목표까지 가는 동안 이 단계에서 시도하는 평균 횟수',
  '비용 비중': '총 기대 비용 중 이 단계에서 쓰는 비율 (파괴 복구 비용 포함). 마우스를 올리면 기대 비용·1회 비용',
  '민감도': '이 단계 성공률을 1%p 올리면 총 기대 비용이 몇 % 바뀌는지 (수반 방법으로 정확히 계산한 1차 변화량)',
  '보조 아이템': '켠 아이템(수량형은 넣은 개수)을 이 단계의 모든 시도에 사용. "상황별"은 최적화 결과로 연속 실패 횟수에 따라 사용 여부·개수가 다름',
};

/** 아이템 약자: 이름 첫 글자, 겹치면 두 글자, 그래도 겹치면(예: 별빛 가호 (상급)/(중급)) 처음 갈라지는 글자 */
function abbr(items, it) {
  const chars = (x) => [...x.name.trim()];
  const me = chars(it), others = items.filter(o => o !== it).map(chars);
  if (!others.some(o => o[0] === me[0])) return me[0] ?? '?';
  const rivals = others.filter(o => o[0] === me[0] && o[1] === me[1]);
  if (!rivals.length) return me.slice(0, 2).join('');
  const k = me.findIndex((ch, i) => /[^\s()[\]]/.test(ch) && rivals.every(o => o[i] !== ch));
  return k >= 0 ? me[k] : me.slice(0, 2).join('');
}

function itemChips(ctx, stage) {
  const s = ctx.state;
  const u = s.usage[stage];
  const units = stageUnits(u); // 카운터마다 다르면 그중 최대
  // 카운터마다 개수가 다른 아이템 = 상황별
  const partialOf = (id) => !!u?.byCounter && !u.byCounter.every(spec => (specUnits(spec)[id] ?? 0) === (units[id] ?? 0));
  // 수동 편집하면 '상황별' 정책은 단계 공통 설정으로 바뀐다
  const write = (next) => { s.usage[stage] = unitsToSpec(s.items, next); };
  return s.items.map(it => {
    if (stage < it.from || stage > it.to) return h('span.chip-slot', { title: `${it.name}: 적용 단계 밖` }); // 칸 정렬 유지
    const n = units[it.id] ?? 0, on = n > 0, partial = partialOf(it.id);
    if (isQty(it)) {
      return h(`label.qty-chip${on ? '.on' : ''}${partial ? '.partial' : ''}`, { title: `${it.name}: 1회 투입 개수 (0~${it.maxUnits}개, 개당 +${it.amount}%p)${partial ? ' · 상황별 — 고치면 모든 시도에 같은 개수' : ''}` },
        h('span', {}, abbr(s.items, it), partial ? '*' : ''),
        h('input', {
          type: 'number', value: Math.min(n, it.maxUnits), min: 0, max: it.maxUnits, step: 1, inputmode: 'numeric', 'aria-label': `+${stage} ${it.name} 개수`,
          oninput: (e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isFinite(v)) return;
            const k = Math.max(0, Math.min(it.maxUnits, Math.round(v)));
            write({ ...units, [it.id]: k });
            e.target.closest('label').classList.toggle('on', k > 0);
            ctx.schedule(250);
          },
        }));
    }
    return h(`button.chip${on ? '.on' : ''}${partial ? '.partial' : ''}`, {
      type: 'button', title: partial ? `${it.name}: 상황별 사용 (클릭하면 항상 사용으로 바뀜)` : `${it.name} ${on ? '사용 중' : '사용 안 함'}`,
      'aria-pressed': String(on && !partial),
      onclick: () => { // 상황별 → 항상 사용, 사용 → 끔, 끔 → 사용
        write({ ...units, [it.id]: on && !partial ? 0 : 1 });
        ctx.markTableDirty(); ctx.recompute();
      },
    }, abbr(s.items, it), partial ? '*' : '');
  });
}

function updateValues(ctx, els, res) {
  const byStage = new Map((res?.stages || []).map(st => [st.stage, st]));
  const total = res ? res.expCost || 1 : 1;
  const maxCost = Math.max(1e-12, ...(res?.stages || []).map(st => st.cost));
  // 민감도 상위 3개 단계 강조
  const top = new Set([...(res?.stages || [])].filter(st => st.sens < 0).sort((a, b) => a.sens - b.sens).slice(0, 3).map(st => st.stage));
  for (const tr of els.table.querySelectorAll('tbody tr')) {
    const stage = +tr.dataset.stage;
    const r = ctx.state.rows.find(x => x.stage === stage);
    const sum = r.s + (ctx.state.double ? r.s2 : 0) + r.k + r.d + r.b;
    const bad = Math.abs(sum - 100) > 0.01;
    tr.classList.toggle('bad', bad);
    const set = (k, v) => { const el = tr.querySelector(`[data-k="${k}"]`); if (el) el.textContent = v; return el; };
    set('sum', bad ? `합 ${fmtNum(sum, 2)}` : '');
    const st = byStage.get(stage);
    if (!st) { ['risk', 'visits', 'share', 'sens'].forEach(k => set(k, '')); tr.querySelector('[data-k="bar"]').style.width = '0'; continue; }
    const risk = st.destroyBeforePass;
    set('risk', risk > 1e-9 ? fmtPct(risk) : '—').classList.toggle('hi', risk >= 0.3);
    set('visits', st.visits > 0.0005 ? fmtNum(st.visits, 1) : '—');
    set('share', st.cost > 0 ? fmtPct(st.cost / total) : '—');
    tr.querySelector('[data-k="shareCell"]').title = `기대 비용 ${money(st.cost)} · 1회 비용 ${money(st.attemptCost)}${st.items.length ? ' (보조 아이템 포함)' : ''}`;
    tr.querySelector('[data-k="bar"]').style.width = `${(st.cost / maxCost) * 100}%`;
    set('sens', st.visits > 0.0005 && Math.abs(st.sensPct) >= 0.0005 ? `${(st.sensPct * 100).toFixed(1)}%` : '—').classList.toggle('top', top.has(stage));
  }
}

function addRow(ctx) {
  const s = ctx.state;
  const last = s.rows.at(-1);
  s.rows.push({ ...structuredClone(last), stage: last.stage + 1 });
  if (s.target === last.stage + 1) s.target++;
  ctx.markTableDirty(); ctx.rebuild();
}

function removeRow(ctx) {
  const s = ctx.state;
  s.rows.pop();
  const lastStage = s.rows.at(-1).stage;
  s.target = Math.min(s.target, lastStage + 1);
  s.start = Math.min(s.start, s.target - 1);
  s.restore = Math.min(s.restore, s.target - 1);
  ctx.markTableDirty(); ctx.rebuild();
}
