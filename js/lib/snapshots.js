// 전 탭 공통 스냅샷 — 모든 도구의 설정을 한 번에 저장하고, 지금 설정과 핵심 지표를 비교하고, 되돌린다 (계산 부분은 DOM 없음)
// 각 탭은 자기 설정을 localStorage(planwb:키)에 저장하므로 스냅샷 = 그 키들의 값 묶음. 한 번도 열지 않은 탭은 기본 템플릿으로 계산한다.
import { store } from './util.js';
import { analyze as enhanceAnalyze, migrate as enhanceMigrate, SCHEMA as ENH_SCHEMA } from '../enhance/model.js';
import { TEMPLATES as ENH_T } from '../enhance/presets.js';
import { analyze as gachaAnalyze } from '../gacha/model.js';
import { TEMPLATES as GACHA_T } from '../gacha/presets.js';
import { design as supplyDesign } from '../supply/model.js';
import { TEMPLATES as SUPPLY_T } from '../supply/presets.js';
import { analyze as stageAnalyze } from '../stage/model.js';
import { TEMPLATES as STAGE_T } from '../stage/presets.js';
import { analyze as battleAnalyze } from '../battle/model.js';
import { TEMPLATES as BATTLE_T } from '../battle/presets.js';
import { simulate as econSimulate } from '../economy/model.js';
import { TEMPLATES as ECON_T } from '../economy/presets.js';
import { analyze as frameAnalyze } from '../frame/model.js';
import { TEMPLATES as FRAME_T } from '../frame/presets.js';

export const SNAP_KEY = 'snapshots:v1';
const ENH_KEYS = ['rows', 'resources', 'start', 'target', 'restore', 'destroyCosts', 'double', 'streak', 'items', 'usage', 'event'];

// fmt: money(원) / pct(0~1) / num / hours / frames, better: 'lower' | 'higher' | null (변화 색)
const k = (label, value, fmt = 'num', better = null) => ({ label, value, fmt, better });

/** 도구 목록: 저장 키, 기본 설정, run(설정) → { kpis: 핵심 지표, issues: 검증 문장 } */
const iss = (xs) => (xs || []).map(w => ({ level: w.level, text: w.text }));
export const TOOLS = [
  {
    id: 'enhance', label: '강화 확률 설계', key: 'enhance:v2',
    base: () => ({ v: ENH_SCHEMA, template: 'standard', ...ENH_T.standard.make() }),
    run: (st) => {
      const s = enhanceMigrate(st) ?? st;
      const r = enhanceAnalyze(Object.fromEntries(ENH_KEYS.map(x => [x, s[x]])));
      if (!r.ok) return null;
      return { kpis: [k('기대 총비용', r.expCost, 'money', 'lower'), k('기대 시도', r.attempts, 'num', 'lower'), k('기대 파괴', r.expDestroy, 'num', 'lower'), k('파괴 없이 도달', r.noDestroy, 'pct', 'higher')], issues: [] };
    },
  },
  {
    id: 'gacha', label: '가챠·수집 설계', key: 'gacha:v1',
    base: () => ({ v: 1, template: 'idle', ...GACHA_T.idle.make() }),
    run: (st) => {
      const r = gachaAnalyze(st, { runs: 800 });
      if (!r.ok) return null;
      return { kpis: r.goals.slice(0, 4).map(g => (g.won > 0 ? k(`${g.goal.name} 기대 비용`, g.won, 'money', 'lower') : k(`${g.goal.name} 기대 뽑기`, g.mean, 'num', 'lower'))), issues: iss(r.warnings) };
    },
  },
  {
    id: 'supply', label: '성장 재화 수급', key: 'supply:v1',
    base: () => ({ v: 1, template: 'stone', ...SUPPLY_T.stone.make() }),
    run: (st) => {
      const r = supplyDesign(st);
      if (!r.ok) return null;
      return { kpis: [...r.sinks.slice(0, 3).map(x => k(`${x.sink.name} 총 필요량`, x.total)), k('경고', r.warnings.length, 'num', 'lower')], issues: iss(r.warnings) };
    },
  },
  {
    id: 'stage', label: '스테이지 성장', key: 'stage:v1',
    base: () => ({ v: 1, template: 'idle', ...STAGE_T.idle.make() }),
    run: (st) => {
      const r = stageAnalyze(st);
      if (!r.ok) return null;
      return { kpis: [k('총 소요', r.totalSec / 3600, 'hours'), k('정체 스테이지', r.stagnant.length, 'num', 'lower'), k('최종 필요 레벨', r.finalLevel)], issues: iss(r.warnings) };
    },
  },
  {
    id: 'battle', label: '스탯·전투', key: 'battle:v1',
    base: () => ({ v: 1, template: 'classes', ...BATTLE_T.classes.make() }),
    run: (st) => {
      const r = battleAnalyze(st);
      if (!r.ok) return null;
      return {
        kpis: [...st.entities.slice(0, 6).map((e, i) => k(`Lv${r.lv} ${e.name} 평균 승률`, r.mx.score[i], 'pct')), k('CP와 실제 순위 상관', r.cv.rho, 'num', 'higher'), k('CP가 높은데 지는 쌍', r.cv.pairs.length, 'num', 'lower')],
        issues: iss(r.findings),
      };
    },
  },
  {
    id: 'economy', label: '재화 흐름', key: 'economy:v2',
    base: () => ({ v: 2, template: 'mobile', ...ECON_T.mobile.make() }),
    run: (st) => {
      const r = econSimulate({ ...st, variance: { ...(st.variance || {}), enabled: false } }); // 편차 띠는 빼고 평균 유저만 (빠르게)
      if (!r.ok) return null;
      return { kpis: [...r.bySeg.slice(0, 4).map(b => k(`${b.segment?.name ?? '세그먼트'} ${r.days}일 전투력`, b.finalPower, 'num', 'higher')), k('경고', r.warnings.length, 'num', 'lower')], issues: iss(r.warnings) };
    },
  },
  {
    id: 'frame', label: '패턴 프레임 검증', key: 'frame:v1',
    base: () => ({ v: 1, template: 'basic', ...FRAME_T.basic.make() }),
    run: (st) => {
      const r = frameAnalyze({ fps: st.fps, policy: st.policy, loop: st.loop, player: st.player, thresholds: st.thresholds, attacks: st.attacks });
      if (!r.ok) return null;
      const x = r.summary;
      return { kpis: [k('가장 빡빡한 회피 윈도우', x.minWindow ?? NaN, 'frames', 'higher'), k('암기 필요 타격', x.memorize, 'num', 'lower'), k('회피 불가', x.impossible, 'num', 'lower'), k('반격 기회', x.counterChances, 'num', 'higher')], issues: iss(r.findings) };
    },
  },
];

/** 지금 저장된 모든 탭 설정 (없으면 null) */
export function currentStates() {
  return Object.fromEntries(TOOLS.map(t => [t.key, store.get(t.key)]));
}

/** 한 도구의 지표 (설정이 없으면 기본 템플릿, 계산 실패면 null) */
export function toolReport(tool, raw) {
  try { return tool.run(raw ?? tool.base()); } catch { return null; }
}
export const toolKpis = (tool, raw) => toolReport(tool, raw)?.kpis ?? null;

/** 두 지표 목록을 이름으로 맞춰 비교 행 */
export function compareKpis(a, b) {
  const rows = [], seen = new Set();
  for (const x of b || []) {
    const y = (a || []).find(z => z.label === x.label);
    rows.push({ label: x.label, fmt: x.fmt, better: x.better, before: y?.value, after: x.value });
    seen.add(x.label);
  }
  for (const y of a || []) if (!seen.has(y.label)) rows.push({ label: y.label, fmt: y.fmt, better: y.better, before: y.value, after: undefined });
  return rows;
}

// ── 저장소 ──────────────────────────────────────────────
export const listSnapshots = () => store.get(SNAP_KEY) || [];
export function saveSnapshot(name) {
  const list = listSnapshots();
  const snap = { id: `s${Date.now().toString(36)}`, name: name || `스냅샷 ${list.length + 1}`, date: new Date().toISOString(), states: currentStates() };
  store.set(SNAP_KEY, [snap, ...list]);
  return snap;
}
export function deleteSnapshot(id) { store.set(SNAP_KEY, listSnapshots().filter(s => s.id !== id)); }
/** 스냅샷의 설정을 각 탭 저장 키에 되돌림 (화면은 새로고침해야 반영) */
export function restoreSnapshot(snap) {
  for (const t of TOOLS) {
    const v = snap.states?.[t.key];
    if (v == null) store.remove(t.key); else store.set(t.key, v);
  }
}

/** 프로젝트 파일: 지금 설정 + 스냅샷 전부 */
export function projectFile() {
  return { schemaVersion: 1, tool: 'planning-workbench', description: '기획 워크벤치 프로젝트 — 모든 탭 설정과 스냅샷', date: new Date().toISOString(), current: currentStates(), snapshots: listSnapshots() };
}
export function loadProject(doc) {
  if (doc?.tool !== 'planning-workbench' || !doc.current) throw new Error('기획 워크벤치 프로젝트 파일이 아닙니다.');
  restoreSnapshot({ states: doc.current });
  const ids = new Set(listSnapshots().map(s => s.id));
  store.set(SNAP_KEY, [...(doc.snapshots || []).filter(s => !ids.has(s.id)), ...listSnapshots()]);
}
