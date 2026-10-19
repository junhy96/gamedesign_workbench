// 스냅샷 창: 지금 설정 저장 → 목록 → 지금과 비교(탭별 핵심 지표) · 되돌리기 · 프로젝트 파일
import { h, toast, downloadJSON, fmtMoney } from './util.js';
import { TOOLS, toolKpis, compareKpis, listSnapshots, saveSnapshot, deleteSnapshot, restoreSnapshot, currentStates, projectFile, loadProject } from './snapshots.js';

let dlg, els = {}, comparing = null;
const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter(x => x != null && x !== false));
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function fmt(v, f) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (f === 'money') return `${fmtMoney(v)}원`;
  if (f === 'pct') return `${(v * 100).toFixed(1)}%`;
  if (f === 'hours') return `${(+v.toFixed(2)).toLocaleString('ko-KR')}시간`;
  if (f === 'frames') return `${v}f`;
  return (+v.toPrecision(Math.abs(v) >= 1000 ? 12 : 4)).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
}
function change(r) {
  if (!Number.isFinite(r.before) || !Number.isFinite(r.after)) return h('td.muted', {}, r.before == null ? '새 지표' : '—');
  const d = r.after - r.before;
  if (Math.abs(d) < 1e-12 * Math.max(1, Math.abs(r.before))) return h('td.muted', {}, '같음');
  const good = r.better ? (r.better === 'lower' ? d < 0 : d > 0) : null;
  const txt = r.fmt === 'pct' ? `${d > 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}%p` : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d), r.fmt)}${r.before ? ` (${d > 0 ? '+' : '−'}${Math.abs(d / r.before * 100).toFixed(1)}%)` : ''}`;
  return h(`td${good == null ? '' : good ? '.up' : '.down'}`, {}, txt);
}

export function openSnapshots() {
  if (!dlg) build();
  render();
  dlg.showModal();
}

function build() {
  dlg = h('dialog.snap-dialog', { 'aria-label': '스냅샷' });
  els.name = h('input', { type: 'text', placeholder: '이름 (예: 1차 밸런스안)', 'aria-label': '스냅샷 이름' });
  dlg.append(
    h('div.snap-head', {}, h('h2', {}, '스냅샷 — 모든 탭 설정'), h('button.icon-x', { type: 'button', title: '닫기', onclick: () => dlg.close() }, '×')),
    h('p.muted.small', {}, '강화·가챠·스탯 전투·프레임 탭의 지금 설정을 한 번에 저장하고, 나중에 지금 설정과 핵심 지표를 비교하거나 되돌립니다. 이 브라우저에만 저장되므로 팀과 나누려면 프로젝트 파일로 저장하세요.'),
    h('div.snap-save', {}, els.name, h('button.btn.primary', { type: 'button', onclick: doSave }, '지금 설정 저장')),
    els.list = h('div.snap-list', {}),
    els.cmp = h('div.snap-cmp', {}),
    h('div.snap-foot', {},
      h('button.btn.small', { type: 'button', onclick: () => downloadJSON(`planning-workbench-${new Date().toISOString().slice(0, 10)}.json`, projectFile()) }, '프로젝트 파일 저장'),
      h('button.btn.small', { type: 'button', onclick: doLoad }, '프로젝트 파일 불러오기')),
  );
  document.body.append(dlg);
}

function render() {
  document.dispatchEvent(new Event('snapshotschange'));
  const list = listSnapshots();
  put(els.list, list.length
    ? h('table.stages.snap-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '이름'), h('th', {}, '저장 시각'), h('th', {}, ''))),
      h('tbody', {}, ...list.map(s => h(`tr${comparing === s.id ? '.on' : ''}`, {},
        h('td', {}, s.name), h('td.muted', {}, new Date(s.date).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
        h('td', {},
          h('button.btn.small', { type: 'button', onclick: () => compare(s) }, '지금과 비교'),
          h('button.btn.small', { type: 'button', onclick: () => doRestore(s) }, '되돌리기'),
          h('button.icon-x', { type: 'button', title: '삭제', onclick: () => { if (confirm(`'${s.name}' 스냅샷을 삭제할까요?`)) { deleteSnapshot(s.id); if (comparing === s.id) { comparing = null; put(els.cmp); } render(); } } }, '×'))))))
    : h('p.muted', {}, '저장한 스냅샷이 없습니다.'));
}

async function doSave() {
  await wait(350); // 각 탭이 입력 0.3초 뒤에 저장하므로 마지막 입력까지 기다림
  const s = saveSnapshot(els.name.value.trim());
  els.name.value = '';
  render();
  toast(`'${s.name}'을(를) 저장했습니다`);
}

async function compare(snap) {
  comparing = snap.id;
  render();
  put(els.cmp, h('p.muted', {}, '지표 계산 중…'));
  await wait(350);
  const now = currentStates();
  const blocks = [];
  for (const t of TOOLS) {
    await wait(0);
    const before = toolKpis(t, snap.states?.[t.key]), after = toolKpis(t, now[t.key]);
    const same = JSON.stringify(snap.states?.[t.key] ?? null) === JSON.stringify(now[t.key] ?? null);
    const rows = compareKpis(before, after);
    blocks.push(h('div.snap-tool', {},
      h('h3', {}, t.label, same ? h('span.muted.small', {}, ' · 설정 같음') : h('span.badge', {}, '바뀜')),
      rows.length ? h('table.stages.snap-kpi', {},
        h('thead', {}, h('tr', {}, h('th', {}, '지표'), h('th', {}, `'${snap.name}'`), h('th', {}, '지금'), h('th', {}, '변화'))),
        h('tbody', {}, ...rows.map(r => h('tr', {}, h('td', {}, r.label), h('td', {}, fmt(r.before, r.fmt)), h('td', {}, fmt(r.after, r.fmt)), change(r))))) : h('p.muted.small', {}, '계산할 수 없는 설정입니다 (오류).')));
  }
  if (comparing !== snap.id) return;
  put(els.cmp, h('h3.snap-cmp-title', {}, `'${snap.name}' → 지금`), ...blocks);
}

async function doRestore(snap) {
  if (!confirm(`'${snap.name}'로 모든 탭 설정을 되돌릴까요? 지금 설정은 사라지니, 필요하면 먼저 "지금 설정 저장"을 하세요.`)) return;
  restoreSnapshot(snap);
  await wait(400); // 탭이 늦게 저장해 덮어쓰는 것을 막으려고 한 번 더
  restoreSnapshot(snap);
  location.hash = location.hash.split('?')[0];
  location.reload();
}

function doLoad() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  input.onchange = async () => {
    try {
      const doc = JSON.parse(await input.files[0].text());
      if (!confirm('프로젝트 파일의 설정으로 모든 탭을 바꾸고 스냅샷을 합칠까요?')) return;
      loadProject(doc);
      await wait(400); loadProject(doc);
      location.reload();
    } catch (e) { toast(e.message || '파일을 읽지 못했습니다'); }
  };
  input.click();
}
