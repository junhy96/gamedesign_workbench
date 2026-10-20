// 프리셋 저장·불러오기와 A/B 비교 — 강화·가챠·전투 시뮬레이터가 같이 쓴다.
// 프리셋 = 그 도구의 설정 한 벌(이름 붙여 이 브라우저에 저장). 두 프리셋(또는 지금 설정)을 같은 시드로 계산해 지표를 나란히 놓는다.
import { h, store, toast, downloadJSON, downloadText, comma } from './util.js';
import { label } from './tip.js';
import { toCSV } from '../data/tables.js';

const KEY = (tool) => `presets:${tool}`;
export const listPresets = (tool) => store.get(KEY(tool)) || [];
export function savePreset(tool, name, state) {
  const list = listPresets(tool).filter(p => p.name !== name);
  list.unshift({ name, date: new Date().toISOString(), state: structuredClone(state) });
  store.set(KEY(tool), list.slice(0, 30));
}
export const deletePreset = (tool, name) => store.set(KEY(tool), listPresets(tool).filter(p => p.name !== name));

/** 지표 두 벌 → 비교 행 [{ label, a, b, diff, pct, better, fmt }] */
export function compareMetrics(A, B) {
  return A.map((m, i) => {
    const n = B[i];
    const diff = n.value - m.value;
    const pct = m.value ? diff / Math.abs(m.value) : NaN;
    const good = m.better === 'lower' ? diff < 0 : m.better === 'higher' ? diff > 0 : null;
    return { label: m.label, a: m.value, b: n.value, diff, pct, good: diff === 0 ? null : good, fmt: m.fmt || ((v) => comma(v)) };
  });
}

/**
 * 비교 카드. opts { tool, title, current: () => 지금 설정, apply: (state) => 지금 설정으로 적용, metrics: async (state) => [{ label, value, fmt, better }], note }
 */
export function renderABCard(el, opts) {
  const { tool } = opts;
  const pick = { a: '__current__', b: listPresets(tool)[0]?.name ?? '__current__' };
  const nameIn = h('input', { type: 'text', placeholder: '프리셋 이름 (예: 1차 확률안)', 'aria-label': '프리셋 이름' });
  const out = h('div.ab-out');
  const options = () => [['__current__', '지금 설정'], ...listPresets(tool).map(p => [p.name, `${p.name} · ${new Date(p.date).toLocaleDateString('ko-KR')}`])];
  const sel = (k) => h('select', { 'aria-label': `프리셋 ${k.toUpperCase()}`, onchange: (e) => { pick[k] = e.target.value; } }, ...options().map(([v, l]) => h('option', { value: v, selected: v === pick[k] }, l)));
  const stateOf = (name) => (name === '__current__' ? opts.current() : listPresets(tool).find(p => p.name === name)?.state);
  const nameOf = (name) => (name === '__current__' ? '지금 설정' : name);
  let lastRows = null;
  const draw = () => {
    const list = listPresets(tool);
    el.replaceChildren(
      h('div.card-head', {}, h('h2', {}, ...label(opts.title || '프리셋 비교 (A/B)', 'ab.compare')), h('span.hint', {}, '같은 시드로 계산해 차이가 운이 아니라 설정 때문이 되게')),
      h('div.ab-grid', {},
        h('div', {},
          h('h3.sub', {}, '프리셋 저장 · 불러오기'),
          h('div.ab-save', {}, nameIn, h('button.btn.small.primary', { type: 'button', onclick: () => { const n = nameIn.value.trim(); if (!n) { toast('이름을 넣으세요'); return; } savePreset(tool, n, opts.current()); nameIn.value = ''; toast(`프리셋 「${n}」 저장`); draw(); } }, '지금 설정 저장')),
          list.length ? h('ul.preset-list', {}, ...list.map(p => h('li', {},
            h('span', {}, h('b', {}, p.name), h('small.muted', {}, ` ${new Date(p.date).toLocaleString('ko-KR')}`)),
            h('button.mini-btn', { type: 'button', onclick: () => { opts.apply(structuredClone(p.state)); toast(`「${p.name}」을 불러왔습니다 (되돌리기 Ctrl+Z)`); } }, '불러오기'),
            h('button.mini-btn', { type: 'button', onclick: () => downloadJSON(`${tool}-preset-${p.name}.json`, { schemaVersion: 1, tool, preset: p }) }, 'JSON'),
            h('button.icon-x', { type: 'button', title: '삭제', onclick: () => { if (confirm(`프리셋 「${p.name}」을 지울까요?`)) { deletePreset(tool, p.name); draw(); } } }, '×')))) : h('p.muted.small', {}, '저장한 프리셋이 없습니다. 지금 설정을 이름 붙여 저장해 두고 나중에 비교·불러오기 하세요.')),
        h('div', {},
          h('h3.sub', {}, 'A/B 비교'),
          h('div.row2', {}, h('label.field', {}, h('span', {}, 'A'), sel('a')), h('label.field', {}, h('span', {}, 'B'), sel('b'))),
          h('div.tool-actions', {},
            h('button.btn.small.primary', { type: 'button', onclick: run }, '비교'),
            h('button.btn.small', { type: 'button', onclick: () => lastRows && downloadText(`${tool}-ab.csv`, toCSV([['지표', 'A', 'B', 'B − A', '변화율'], ...lastRows.map(r => [r.label, r.a, r.b, r.diff, Number.isFinite(r.pct) ? r.pct : ''])]), 'text/csv;charset=utf-8') }, '결과 CSV'),
            h('button.btn.small', { type: 'button', onclick: () => lastRows && downloadJSON(`${tool}-ab.json`, { a: nameOf(pick.a), b: nameOf(pick.b), rows: lastRows.map(({ fmt, ...r }) => r) }) }, '결과 JSON')),
          out)),
      opts.note ? h('p.muted.small', {}, opts.note) : null,
    );
  };
  async function run() {
    const A = stateOf(pick.a), B = stateOf(pick.b);
    if (!A || !B) { toast('프리셋을 찾을 수 없습니다'); return; }
    out.replaceChildren(h('p.muted.small', {}, '계산 중…'));
    await new Promise(r => setTimeout(r, 0));
    let ma, mb;
    try { [ma, mb] = [await opts.metrics(A), await opts.metrics(B)]; } catch (e) { out.replaceChildren(h('p.bad-text', {}, `계산할 수 없습니다: ${e.message || e}`)); return; }
    const rows = compareMetrics(ma, mb);
    lastRows = rows;
    out.replaceChildren(h('table.mini.ab-table', {},
      h('thead', {}, h('tr', {}, h('th.left', {}, '지표'), h('th', {}, `A · ${nameOf(pick.a)}`), h('th', {}, `B · ${nameOf(pick.b)}`), h('th', {}, 'B − A'), h('th', {}, '변화'))),
      h('tbody', {}, ...rows.map(r => h('tr', {},
        h('td.left', {}, r.label), h('td', {}, r.fmt(r.a)), h('td', {}, r.fmt(r.b)),
        h(`td${r.good === true ? '.pos' : r.good === false ? '.neg' : ''}`, {}, `${r.diff > 0 ? '+' : r.diff < 0 ? '−' : ''}${r.fmt(Math.abs(r.diff))}`),
        h(`td${r.good === true ? '.pos' : r.good === false ? '.neg' : ''}`, {}, Number.isFinite(r.pct) ? `${r.pct > 0 ? '+' : ''}${(r.pct * 100).toFixed(1)}%` : '—'))))));
  }
  draw();
}
