// 단계 표 두 개: 설계 입력용(확률·비용·아이템 사용 편집)과 결과 분석용(실효 확률·기대 시도·돌파 전 파괴·비용 비중·민감도)
import { h, fmtPct, fmtNum } from '../lib/util.js';
import { money } from './currency.js';

/**
 * 표 구조를 다시 그린다. 입력 중(포커스가 표 안)이면 구조는 유지하고 값만 갱신해 포커스를 지킨다.
 */
export function renderTable(ctx, els) {
  if (!ctx.tableDirty && els.table.contains(document.activeElement)) return updateValues(ctx, els);
  ctx.tableDirty = false;
  const s = ctx.state;
  const lo = Math.min(s.start, s.restore), hi = s.target - 1;
  const onPath = (i) => i >= lo && i <= hi;
  const rows = s.rows.filter(r => s.showAll || onPath(r.stage));

  const head = [
    '단계', '성공 %', ...(s.double ? ['대성공 %'] : []), '유지 %', '하락 %', '파괴 %', '합계',
    ...s.resources.map(r => `${r.name} 비용`), ...(s.items.length ? ['보조 아이템'] : []),
  ];
  const probCell = (r, key) => h('td', {}, h('input', {
    type: 'number', value: r[key], step: 0.01, min: 0, max: 100, 'aria-label': `+${r.stage} ${key}`,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { r[key] = v; ctx.schedule(250); } },
  }));
  const costCell = (r, ri) => h('td', {}, h('input.cost', {
    type: 'number', value: r.costs[ri], step: 'any', min: 0, 'aria-label': `+${r.stage} ${s.resources[ri].name} 비용`,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { r.costs[ri] = v; ctx.schedule(250); } },
  }));

  els.table.replaceChildren(
    h('thead', {}, h('tr', {}, ...head.map((t, i) => h('th', { title: HEAD_TIPS[t] || null, class: i === 0 ? 'left' : null }, t)))),
    h('tbody', {}, ...rows.map(r => h(`tr${onPath(r.stage) ? '' : '.off'}`, { dataset: { stage: r.stage } },
      h('td.stage', {}, `+${r.stage} → +${r.stage + 1}`),
      probCell(r, 's'), s.double ? probCell(r, 's2') : null, probCell(r, 'k'), probCell(r, 'd'), probCell(r, 'b'),
      h('td.sum', { dataset: { k: 'sum' } }),
      ...s.resources.map((_, ri) => costCell(r, ri)),
      s.items.length ? h('td.chips', {}, ...itemChips(ctx, r.stage)) : null,
    ))),
  );
  updateValues(ctx, els);

  els.rowBtns.replaceChildren(
    h('button.btn.small', { type: 'button', onclick: () => addRow(ctx) }, '+ 단계 추가'),
    h('button.btn.small', { type: 'button', onclick: () => removeRow(ctx), disabled: s.rows.length <= 1 }, '마지막 단계 삭제'),
  );
}

const HEAD_TIPS = {
  '합계': '성공·대성공·유지·하락·파괴의 합. 100이 아니면 빨간색으로 표시되고 계산하지 않습니다',
  '성공 %': '아이템·이벤트를 반영한 실효 확률 (연속 카운터 0 기준)',
  '파괴 %': '아이템·이벤트를 반영한 실효 확률 (연속 카운터 0 기준)',
  '1회 비용': '이 단계 1회 시도 비용 (보조 아이템 포함, 표시 단위)',
  '기대 비용': '목표까지 가는 동안 이 단계에서 쓰는 평균 비용 (파괴 복구 비용 포함)',
  '돌파 전 파괴': '이 단계에서 출발해 다음 단계에 닿기 전에 파괴될 확률. 하락해서 다시 올라오는 경로와 연속 보정까지 포함한 정확해',
  '기대 시도': '목표까지 가는 동안 이 단계에서 시도하는 평균 횟수',
  '비용 비중': '총 기대 비용 중 이 단계에서 쓰는 비율 (파괴 복구 비용 포함)',
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

function updateValues(ctx, els) {
  for (const tr of els.table.querySelectorAll('tbody tr')) {
    const r = ctx.state.rows.find(x => x.stage === +tr.dataset.stage);
    const sum = r.s + (ctx.state.double ? r.s2 : 0) + r.k + r.d + r.b;
    const bad = Math.abs(sum - 100) > 0.01;
    tr.classList.toggle('bad', bad);
    const el = tr.querySelector('[data-k="sum"]');
    el.textContent = bad ? fmtNum(sum, 2) : '100';
    el.classList.toggle('hi', bad);
  }
}

// ── 결과 분석 표 (읽기 전용) ─────────────────────────────
export function renderAnalysis(ctx, els, res) {
  if (!res) { els.analysis.replaceChildren(); return; }
  const s = ctx.state;
  const stages = res.stages.filter(st => st.visits > 0.0005).sort((a, b) => a.stage - b.stage);
  const total = res.expCost || 1;
  const maxCost = Math.max(1e-12, ...stages.map(st => st.cost));
  const top = new Set(stages.filter(st => st.sens < 0).sort((a, b) => a.sens - b.sens).slice(0, 3).map(st => st.stage));
  const head = ['단계', '성공 %', ...(s.double ? ['대성공 %'] : []), '파괴 %', '1회 비용', '기대 시도', '돌파 전 파괴', '기대 비용', '비용 비중', '민감도'];
  const pct = (x) => String(+(x * 100).toFixed(2));
  els.analysis.replaceChildren(
    h('thead', {}, h('tr', {}, ...head.map((t, i) => h('th', { title: HEAD_TIPS[t] || null, class: i === 0 ? 'left' : null }, t)))),
    h('tbody', {}, ...stages.map(st => {
      const risk = st.destroyBeforePass;
      return h('tr', {},
        h('td.stage', {}, `+${st.stage} → +${st.stage + 1}`, st.items.length ? h('span.item-tag', { title: '이 단계에서 사용하는 보조 아이템' }, st.items.map(id => s.items.find(it => it.id === id)?.name).filter(Boolean).join(' + ')) : null),
        h('td', {}, pct(st.p.s)), s.double ? h('td', {}, pct(st.p.s2)) : null, h('td', {}, pct(st.p.b)),
        h('td', {}, money(st.attemptCost)),
        h('td', {}, fmtNum(st.visits, 1)),
        h(`td${risk >= 0.3 ? '.hi' : ''}`, {}, risk > 1e-9 ? fmtPct(risk) : '—'),
        h('td', {}, money(st.cost)),
        h('td', {}, h('div.share-cell', {}, h('span', {}, fmtPct(st.cost / total)), h('div.share-bar', {}, h('i', { style: `width:${(st.cost / maxCost) * 100}%` })))),
        h(`td${top.has(st.stage) ? '.top' : ''}`, {}, Math.abs(st.sensPct) >= 0.0005 ? `${(st.sensPct * 100).toFixed(1)}%` : '—'),
      );
    })),
  );
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
