// 단계 표: 왼쪽은 설계 입력(확률·비용·아이템 사용), 오른쪽은 같은 줄의 계산 결과(기대 시도·돌파 전 파괴·비용 비중·민감도)
import { h, fmtPct, fmtNum } from '../lib/util.js';
import { money } from './currency.js';

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
    '성공 %', ...(s.double ? ['대성공 %'] : []), '유지 %', '하락 %', '파괴 %', '합계',
    ...s.resources.map(r => `${r.name} 비용`), ...(s.items.length ? ['보조 아이템'] : []),
  ];
  const result = ['기대 시도', '돌파 전 파괴', '비용 비중', '민감도'];
  const th = (t, cls) => h('th', { title: HEAD_TIPS[t] || null, class: cls }, t);
  const probCell = (r, key) => h('td', {}, h('input', {
    type: 'number', value: r[key], step: 0.01, min: 0, max: 100, 'aria-label': `+${r.stage} ${key}`,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { r[key] = v; ctx.schedule(250); } },
  }));
  const costCell = (r, ri) => h('td', {}, h('input.cost', {
    type: 'number', value: r.costs[ri], step: 'any', min: 0, 'aria-label': `+${r.stage} ${s.resources[ri].name} 비용`,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { r.costs[ri] = v; ctx.schedule(250); } },
  }));

  els.table.replaceChildren(
    h('thead', {},
      h('tr.group', {}, h('th', {}), h('th.group-in', { colspan: input.length }, '설계 입력 — 칸을 직접 수정'), h('th.group-out', { colspan: result.length }, '계산 결과')),
      h('tr', {}, th('단계', 'left'), ...input.map(t => th(t)), ...result.map((t, i) => th(t, i ? 'res' : 'res first')))),
    h('tbody', {}, ...rows.map(r => h(`tr${onPath(r.stage) ? '' : '.off'}`, { dataset: { stage: r.stage } },
      h('td.stage', {}, `+${r.stage} → +${r.stage + 1}`),
      probCell(r, 's'), s.double ? probCell(r, 's2') : null, probCell(r, 'k'), probCell(r, 'd'), probCell(r, 'b'),
      h('td.sum', { dataset: { k: 'sum' } }),
      ...s.resources.map((_, ri) => costCell(r, ri)),
      s.items.length ? h('td.chips', {}, ...itemChips(ctx, r.stage)) : null,
      h('td.res.first', { dataset: { k: 'visits' } }),
      h('td.res', { dataset: { k: 'risk' } }),
      h('td.res', {}, h('div.share-cell', { dataset: { k: 'shareCell' } }, h('span', { dataset: { k: 'share' } }), h('div.share-bar', {}, h('i', { dataset: { k: 'bar' } })))),
      h('td.res', { dataset: { k: 'sens' } }),
    ))),
  );
  updateValues(ctx, els, res);

  els.rowBtns.replaceChildren(
    h('button.btn.small', { type: 'button', onclick: () => addRow(ctx) }, '+ 단계 추가'),
    h('button.btn.small', { type: 'button', onclick: () => removeRow(ctx), disabled: s.rows.length <= 1 }, '마지막 단계 삭제'),
  );
}

const HEAD_TIPS = {
  '합계': '성공·대성공·유지·하락·파괴의 합. 100이 아니면 빨간색으로 표시되고 계산하지 않습니다',
  '돌파 전 파괴': '이 단계에서 출발해 다음 단계에 닿기 전에 파괴될 확률. 하락해서 다시 올라오는 경로와 연속 보정까지 포함한 정확해',
  '기대 시도': '목표까지 가는 동안 이 단계에서 시도하는 평균 횟수',
  '비용 비중': '총 기대 비용 중 이 단계에서 쓰는 비율 (파괴 복구 비용 포함). 마우스를 올리면 기대 비용·1회 비용',
  '민감도': '이 단계 성공률을 1%p 올리면 총 기대 비용이 몇 % 바뀌는지 (수반 방법으로 정확히 계산한 1차 변화량)',
  '보조 아이템': '켠 아이템을 이 단계의 모든 시도에 사용. "상황별"은 최적화 결과로 연속 실패 횟수에 따라 사용 여부가 다름',
};

function itemChips(ctx, stage) {
  const s = ctx.state;
  const u = s.usage[stage];
  const flat = Array.isArray(u) ? u : null;
  return s.items.filter(it => stage >= it.from && stage <= it.to).map(it => {
    const on = flat ? flat.includes(it.id) : u?.byCounter.some(a => a.includes(it.id));
    const partial = !flat && on && !u.byCounter.every(a => a.includes(it.id));
    return h(`button.chip${on ? '.on' : ''}${partial ? '.partial' : ''}`, {
      type: 'button', title: partial ? `${it.name}: 상황별 사용 (클릭하면 항상 사용으로 바뀜)` : `${it.name} ${on ? '사용 중' : '사용 안 함'}`,
      'aria-pressed': String(!!on && !partial),
      onclick: () => {
        // 수동 편집하면 '상황별' 정책은 단계 공통 설정으로 바뀐다 (상황별 → 항상 사용, 사용 → 끔, 끔 → 사용)
        const all = flat ?? [...new Set(u?.byCounter.flat() ?? [])];
        s.usage[stage] = on && !partial ? all.filter(id => id !== it.id) : [...new Set([...all, it.id])];
        ctx.markTableDirty(); ctx.recompute();
      },
    }, it.name, partial ? ' (상황별)' : '');
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
    set('sum', bad ? fmtNum(sum, 2) : '100').classList.toggle('hi', bad);
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
