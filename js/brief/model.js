// 브리핑 — 모든 탭의 핵심 지표·검증 문장을 한 장으로: 기준(스냅샷) 대비 변화, 목표 통과/미달 (순수 계산 모듈, DOM 없음)
import { TOOLS, toolReport, compareKpis } from '../lib/snapshots.js';

export const goalKey = (toolId, label) => `${toolId}::${label}`;
const ORDER = { critical: 0, serious: 1, warn: 2, info: 3 };

/** 목표 판정: { op: '<=' | '>=', value } → 'pass' | 'fail' | null(목표 없음·값 없음) */
export function judge(v, goal) {
  if (!goal || !Number.isFinite(goal.value) || !Number.isFinite(v)) return null;
  return (goal.op === '>=' ? v >= goal.value - 1e-12 : v <= goal.value + 1e-12) ? 'pass' : 'fail';
}

/**
 * brief = { include: { toolId: bool }, goals: { 'tool::지표': { op, value(화면 단위: % 지표는 %) } } }
 * now·base = 저장 키 → 설정 (base 없으면 비교 없이)
 * 반환 { tools: [{ tool, changed, rows: [{ label, fmt, better, before, after, goal, verdict }], issues }], summary }
 */
export function buildReport(brief, now, base, { maxIssues = 4 } = {}) {
  const tools = [];
  const sum = { pass: 0, fail: 0, noGoal: 0, serious: 0, changed: 0, failed: [] };
  for (const tool of TOOLS) {
    if (brief.include?.[tool.id] === false) continue;
    const cur = toolReport(tool, now[tool.key]);
    const prev = base ? toolReport(tool, base[tool.key]) : null;
    const changed = base ? JSON.stringify(base[tool.key] ?? null) !== JSON.stringify(now[tool.key] ?? null) : false;
    const rows = compareKpis(prev?.kpis, cur?.kpis).map(r => {
      const goal = brief.goals?.[goalKey(tool.id, r.label)] ?? null;
      const g = goal && r.fmt === 'pct' ? { ...goal, value: goal.value / 100 } : goal; // % 지표 목표는 % 단위로 입력
      const verdict = judge(r.after, g);
      if (verdict === 'pass') sum.pass++; else if (verdict === 'fail') { sum.fail++; sum.failed.push(`${tool.label} · ${r.label}`); } else sum.noGoal++;
      return { ...r, goal, verdict };
    });
    const issues = (cur?.issues || []).slice().sort((a, b) => (ORDER[a.level] ?? 9) - (ORDER[b.level] ?? 9));
    sum.serious += issues.filter(x => x.level === 'serious' || x.level === 'critical').length;
    if (changed) sum.changed++;
    tools.push({ tool, ok: !!cur, changed, rows, issues: issues.slice(0, maxIssues), moreIssues: Math.max(0, issues.length - maxIssues) });
  }
  return { tools, summary: sum };
}
