// 브리핑 — 화면: 제목·기준 스냅샷·포함할 탭 → 요약 → 메모(결론·근거·리스크·결정 요청) → 탭별 지표(목표 판정)·검증 문장 → PDF(인쇄)
import { buildReport, goalKey } from './model.js';
import { TOOLS, listSnapshots, currentStates } from '../lib/snapshots.js';
import { openSnapshots } from '../lib/snapshot-view.js';
import { h, store, debounce, fmtMoney, toast } from '../lib/util.js';

const STORE_KEY = 'brief:v1';
let state, root;
const els = {};
const save = debounce(() => store.set(STORE_KEY, state), 300);
const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter(x => x != null && x !== false));
const MEMOS = [['conclusion', '결론', '이번 수정으로 무엇이 좋아졌고 무엇을 결정해야 하는지 한두 문장'], ['basis', '근거·바뀐 것', '어떤 수치를 어떻게 바꿨는지 (예: 스테이지 체력 증가 4% → 3.97%)'], ['risk', '리스크', '아직 확인하지 못한 것, 다른 시스템에 미치는 영향'], ['ask', '결정 요청', '회의에서 정해야 할 것 (예: 궁수 공격 속도 +15% 적용 여부)']];

function defaults() {
  return { v: 1, title: '밸런스 브리핑', author: '', baseline: null, include: Object.fromEntries(TOOLS.map(t => [t.id, true])), goals: {}, memo: {} };
}

export function mount(el) {
  root = el;
  const saved = store.get(STORE_KEY);
  state = saved?.v === 1 ? { ...defaults(), ...saved } : defaults();
  build();
  render();
  // 다른 탭에서 바꾼 값을 보이게: 이 탭으로 돌아올 때마다 다시 계산
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#brief')) render(); });
  document.addEventListener('snapshotschange', () => render());
}

function fmt(v, f) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (f === 'money') return `${fmtMoney(v)}원`;
  if (f === 'pct') return `${(v * 100).toFixed(1)}%`;
  if (f === 'hours') return `${(+v.toFixed(2)).toLocaleString('ko-KR')}시간`;
  if (f === 'frames') return `${v}f`;
  return (+v.toPrecision(Math.abs(v) >= 1000 ? 12 : 4)).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
}
function changeText(r) {
  if (!Number.isFinite(r.before) || !Number.isFinite(r.after)) return ['', '—'];
  const d = r.after - r.before;
  if (Math.abs(d) < 1e-12 * Math.max(1, Math.abs(r.before))) return ['', '같음'];
  const good = r.better ? (r.better === 'lower' ? d < 0 : d > 0) : null;
  const t = r.fmt === 'pct' ? `${d > 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}%p` : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d), r.fmt)}${r.before ? ` (${d > 0 ? '+' : '−'}${Math.abs(d / r.before * 100).toFixed(1)}%)` : ''}`;
  return [good == null ? '' : good ? 'up' : 'down', t];
}

function build() {
  root.replaceChildren(
    h('div.tool-head', {},
      h('div', {},
        h('h1', {}, '브리핑'),
        h('p', {}, '모든 탭의 핵심 지표와 검증 문장을 한 장으로 모읍니다. 스냅샷을 기준으로 고르면 무엇이 얼마나 바뀌었는지, 지표마다 목표를 넣으면 통과·미달을 보여 주고, 결론·근거·리스크·결정 요청 메모와 함께 PDF로 저장합니다.'),
      ),
      h('div.tool-actions.no-print', {},
        h('button.btn', { type: 'button', onclick: openSnapshots }, '스냅샷'),
        h('button.btn.primary', { type: 'button', onclick: printPDF, title: '인쇄 창에서 "PDF로 저장"을 고르세요' }, 'PDF로 저장 (인쇄)'),
      ),
    ),
    els.setup = h('div.card.role-in.no-print'),
    els.headPrint = h('div.print-only.brief-print-head'),
    els.summary = h('div.kpis.econ-kpis'),
    els.memo = h('div.card.role-in'),
    els.tools = h('div.brief-tools'),
  );
}

function render() {
  const snaps = listSnapshots();
  if (state.baseline && !snaps.some(s => s.id === state.baseline)) state.baseline = null;
  const base = snaps.find(s => s.id === state.baseline) ?? null;
  renderSetup(snaps);
  const rep = buildReport(state, currentStates(), base?.states ?? null);
  renderSummary(rep, base);
  renderMemo();
  renderTools(rep, base);
  put(els.headPrint, h('h1', {}, state.title || '밸런스 브리핑'), h('p', {}, [state.author, new Date().toLocaleDateString('ko-KR'), base ? `기준: '${base.name}' (${new Date(base.date).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })})` : '기준 없음'].filter(Boolean).join(' · ')));
}

function renderSetup(snaps) {
  const text = (key, label, ph) => h('label.field', {}, h('span', {}, label), h('input', { type: 'text', value: state[key] ?? '', placeholder: ph, 'aria-label': label, oninput: (e) => { state[key] = e.target.value; save(); } }));
  put(els.setup,
    h('div.card-head', {}, h('h2', {}, '브리핑 설정'), h('span.hint', {}, '설정은 이 브라우저에 저장 · 목표는 아래 표의 "목표" 칸')),
    h('div.tool-pick', {},
      text('title', '제목', '밸런스 브리핑'),
      text('author', '작성자', '이름'),
      h('label.field', {}, h('span', {}, '기준 (비교 대상)'),
        h('select', { 'aria-label': '기준 스냅샷', onchange: (e) => { state.baseline = e.target.value || null; save(); render(); } },
          h('option', { value: '', selected: !state.baseline }, '없음 — 지금 값만'),
          ...snaps.map(s => h('option', { value: s.id, selected: s.id === state.baseline }, `${s.name} (${new Date(s.date).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })})`)))),
    ),
    snaps.length ? null : h('p.muted.small', {}, '스냅샷이 없습니다. 고치기 전에 헤더의 "스냅샷"에서 지금 설정을 저장해 두면, 여기서 기준으로 골라 변화를 보여 줄 수 있습니다.'),
    h('div.brief-include', {}, h('span.muted.small', {}, '포함할 탭:'),
      ...TOOLS.map(t => h('label.check', {}, h('input', { type: 'checkbox', checked: state.include[t.id] !== false, onchange: (e) => { state.include[t.id] = e.target.checked; save(); render(); } }), t.label))),
  );
}

function renderSummary(rep, base) {
  const s = rep.summary;
  const kpi = (label, value, sub, cls = '') => h(`div.card.kpi${cls}`, {}, h('div.kpi-label', {}, label), h('div.kpi-value', {}, value), ...[].concat(sub).map(t => h('div.kpi-sub', {}, t)));
  const goals = s.pass + s.fail;
  put(els.summary,
    kpi('목표 통과', goals ? `${s.pass} / ${goals}` : '—', [goals ? (s.fail ? `미달: ${s.failed.slice(0, 3).join(', ')}${s.failed.length > 3 ? ' …' : ''}` : '모든 목표 통과') : '지표 표의 "목표" 칸에 넣으면 판정'], s.fail ? '.bad' : '.hero'),
    kpi('심각한 검증 문장', `${s.serious}건`, ['각 탭의 "불가·정체" 등급 경고'], s.serious ? '.bad' : ''),
    kpi(base ? `'${base.name}' 대비 바뀐 탭` : '기준', base ? `${s.changed}개` : '없음', [base ? '설정이 다른 탭 수' : '스냅샷을 기준으로 고르면 변화 표시']),
  );
}

function renderMemo() {
  put(els.memo,
    h('div.card-head', {}, h('h2', {}, '메모'), h('span.hint.no-print', {}, '비워 둔 칸은 PDF에 나오지 않음')),
    h('div.brief-memo', {}, ...MEMOS.map(([key, label, ph]) => {
      const v = state.memo[key] ?? '';
      return h(`div.memo-item${v.trim() ? '' : '.empty'}`, {},
        h('b', {}, label),
        h('textarea.no-print', { rows: 2, placeholder: ph, value: v, 'aria-label': label, oninput: (e) => { state.memo[key] = e.target.value; e.target.closest('.memo-item').classList.toggle('empty', !e.target.value.trim()); e.target.nextSibling.textContent = e.target.value; save(); } }),
        h('div.print-only.memo-text', {}, v));
    })),
  );
}

function renderTools(rep, base) {
  const LV = { critical: '불가', serious: '심각', warn: '주의', info: '참고' };
  put(els.tools, ...rep.tools.map(({ tool, ok, changed, rows, issues, moreIssues }) => h('div.card.role-out.brief-tool', {},
    h('div.card-head', {}, h('h2', {}, tool.label), base ? (changed ? h('span.badge', {}, '바뀜') : h('span.hint', {}, '기준과 같음')) : null,
      h('a.hint.no-print', { href: `#${tool.id}` }, '탭 열기 →')),
    !ok ? h('p.bad-text', {}, '설정에 오류가 있어 계산하지 못했습니다. 탭을 열어 고치세요.') : h('div.table-wrap', {}, h('table.stages.brief-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '지표'), base ? h('th', {}, '기준') : null, h('th', {}, '지금'), base ? h('th', {}, '변화') : null, h('th', {}, '목표'), h('th', {}, '판정'))),
      h('tbody', {}, ...rows.map(r => {
        const [cls, txt] = changeText(r);
        const key = goalKey(tool.id, r.label), g = state.goals[key];
        const unit = r.fmt === 'pct' ? '%' : r.fmt === 'money' ? '원' : r.fmt === 'hours' ? '시간' : r.fmt === 'frames' ? 'f' : '';
        const setGoal = (patch) => { const cur = state.goals[key] ?? { op: r.better === 'higher' ? '>=' : '<=', value: NaN }; const next = { ...cur, ...patch }; if (!Number.isFinite(next.value)) delete state.goals[key]; else state.goals[key] = next; save(); render(); };
        return h('tr', {},
          h('td', {}, r.label),
          base ? h('td.muted', {}, fmt(r.before, r.fmt)) : null,
          h('td', {}, h('b', {}, fmt(r.after, r.fmt))),
          base ? h(`td${cls ? `.${cls}` : ''}`, {}, txt) : null,
          h('td.goal-cell', {},
            h('span.no-print', {},
              h('select', { 'aria-label': `${r.label} 목표 방향`, onchange: (e) => setGoal({ op: e.target.value }) }, h('option', { value: '<=', selected: (g?.op ?? (r.better === 'higher' ? '>=' : '<=')) === '<=' }, '≤'), h('option', { value: '>=', selected: (g?.op ?? (r.better === 'higher' ? '>=' : '<=')) === '>=' }, '≥')),
              h('input', { type: 'number', step: 'any', value: g ? g.value : '', placeholder: '없음', 'aria-label': `${r.label} 목표 값`, onchange: (e) => setGoal({ value: e.target.value.trim() === '' ? NaN : parseFloat(e.target.value) }) }),
              unit ? h('span.muted.small', {}, unit) : null),
            h('span.print-only', {}, g ? `${g.op === '>=' ? '≥' : '≤'} ${g.value.toLocaleString('ko-KR')}${unit}` : '—')),
          h(`td.verdict${r.verdict ? `.${r.verdict}` : ''}`, {}, r.verdict === 'pass' ? '✓ 통과' : r.verdict === 'fail' ? '✗ 미달' : '—'),
        );
      })),
    )),
    issues.length ? h('ul.findings', {}, ...issues.map(w => h(`li.${w.level === 'critical' ? 'critical' : w.level === 'serious' ? 'serious' : w.level === 'warn' ? 'warn' : 'info'}`, {}, h('span.lv', {}, LV[w.level] ?? '참고'), h('span', {}, w.text)))) : (ok ? h('p.muted.small', {}, '검증 문장 없음') : null),
    moreIssues ? h('p.muted.small', {}, `외 ${moreIssues}건 — 탭에서 확인`) : null,
  )));
}

function printPDF() {
  if (!location.hash.startsWith('#brief')) return;
  toast('인쇄 창에서 대상 "PDF로 저장"을 고르세요');
  setTimeout(() => window.print(), 300);
}
