// 데이터 테이블 — 검증, CSV/JSON 변환, 최종 스탯 계산 (DOM 없음 → 테스트에서도 씀)
// 시뮬레이터는 이 테이블만 읽는다. 테이블끼리는 ID로 참조한다.
import DEFAULT from './tables.json' with { type: 'json' };
import { TABLES, TABLE_KEYS, STATS, STAT_KEYS, ROLES, columnsOf } from './schema.js';

export const defaultTables = () => structuredClone(DEFAULT);

// ── 값 변환 ─────────────────────────────────────────────
const TRUE = new Set(['true', '1', 'y', 'yes', 'o', '예', '참', 'on']);
const FALSE = new Set(['false', '0', 'n', 'no', 'x', '아니오', '거짓', 'off']);
/** "a|b", "a; b", 배열 → ID 배열 */
export const splitList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[|;,\n]/)).map(s => String(s).trim()).filter(Boolean);

/** 한 칸을 열 type에 맞게 바꾼다. 못 바꾸면 원래 문자열을 남겨 검증에서 표시되게 한다 */
export function coerce(col, v) {
  if (v === undefined) return undefined;
  switch (col.type) {
    case 'num': {
      if (v === null || v === '') return null;
      if (typeof v === 'number') return v;
      const s = String(v).trim().replace(/,/g, '').replace(/%$/, '');
      if (s === '') return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : String(v);
    }
    case 'bool': {
      if (typeof v === 'boolean') return v;
      const s = String(v ?? '').trim().toLowerCase();
      if (!s) return null;
      return TRUE.has(s) ? true : FALSE.has(s) ? false : String(v);
    }
    case 'enum': {
      const s = String(v ?? '').trim();
      if (!s) return null;
      if (s in col.options) return s;
      // 한글 라벨(앞부분)로도 받는다: "탱커", "합연산" → 코드
      const hit = Object.entries(col.options).find(([, l]) => l === s || l.split(' ')[0] === s || l.startsWith(s + ' '));
      return hit ? hit[0] : s;
    }
    case 'refs': return splitList(v);
    case 'phases': return String(v ?? '').trim();
    default: return v == null ? '' : String(v).trim();
  }
}

/** 행 하나를 열 정의에 맞게 정리 (모르는 열은 버림) */
export function normalizeRow(cols, raw) {
  const out = {};
  for (const c of cols) {
    const v = coerce(c, raw[c.key]);
    if (v !== undefined && v !== null && v !== '') out[c.key] = v;
    else if (c.type === 'refs') out[c.key] = [];
  }
  return out;
}

// ── 보스 페이즈 ─────────────────────────────────────────
/** "70=SK_A|SK_B; 30=SK_C" → [{ hp: 70, skills: [...] }, …] (체력% 큰 순). 형식 오류는 errors에 */
export function parsePhases(str) {
  const phases = [], errors = [];
  for (const part of String(str ?? '').split(/[;\n]/).map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+(?:\.\d+)?)\s*%?\s*[=:]\s*(.*)$/);
    if (!m) { errors.push(`"${part}" — "체력%=스킬|스킬" 형식이 아닙니다`); continue; }
    const hp = Number(m[1]);
    if (!(hp > 0 && hp < 100)) errors.push(`페이즈 체력 ${m[1]}% — 0~100 사이여야 합니다`);
    phases.push({ hp, skills: splitList(m[2]) });
  }
  return { phases: phases.sort((a, b) => b.hp - a.hp), errors };
}

// ── 검증 ────────────────────────────────────────────────
/**
 * 모든 테이블 검증. 반환 { issues: [{ table, row, id, col, level, msg }], count: { error, warn } }
 * 검사: 빈 필수값, 중복 ID, 없는 ID 참조, 숫자·범위, 선택지 밖 값, 페이즈 형식, 시너지 조건, 상성 표 빈칸
 */
export function validateTables(t) {
  const issues = [];
  const add = (table, row, col, level, msg) => issues.push({ table, row, id: t[table]?.[row]?.id ?? '', col, level, msg });
  const ids = Object.fromEntries(TABLE_KEYS.map(k => [k, new Set((t[k] || []).map(r => r.id).filter(Boolean))]));
  for (const key of TABLE_KEYS) {
    const rows = t[key] || [], cols = columnsOf(t, key), seen = new Map();
    rows.forEach((r, i) => {
      if (r.id) { if (seen.has(r.id)) add(key, i, 'id', 'error', `ID "${r.id}"가 ${seen.get(r.id) + 1}행과 겹칩니다`); else seen.set(r.id, i); }
      for (const c of cols) {
        const v = r[c.key];
        const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
        if (empty) { if (c.required) add(key, i, c.key, 'error', `${c.label} — 필수값이 비었습니다`); continue; }
        if (c.type === 'num') {
          if (typeof v !== 'number') { add(key, i, c.key, 'error', `${c.label} — 숫자가 아닙니다 ("${v}")`); continue; }
          if (c.min != null && v < c.min) add(key, i, c.key, 'error', `${c.label} ${v} — ${c.min} 이상이어야 합니다`);
          if (c.max != null && v > c.max) add(key, i, c.key, 'error', `${c.label} ${v} — ${c.max} 이하여야 합니다`);
        } else if (c.type === 'enum' && !(v in c.options)) add(key, i, c.key, 'error', `${c.label} — "${v}"는 선택지에 없습니다 (${Object.values(c.options).map(l => l.split(' ')[0]).join('·')})`);
        else if (c.type === 'bool' && typeof v !== 'boolean') add(key, i, c.key, 'error', `${c.label} — 참/거짓이 아닙니다 ("${v}")`);
        else if (c.type === 'ref' && !ids[c.ref].has(v)) add(key, i, c.key, 'error', `${c.label} — "${v}"는 ${TABLES[c.ref].label} 테이블에 없습니다`);
        else if (c.type === 'refs') {
          for (const x of v) if (!ids[c.ref].has(x)) add(key, i, c.key, 'error', `${c.label} — "${x}"는 ${TABLES[c.ref].label} 테이블에 없습니다`);
        } else if (c.type === 'phases') {
          const p = parsePhases(v);
          p.errors.forEach(m => add(key, i, c.key, 'error', `페이즈 ${m}`));
          for (const ph of p.phases) for (const x of ph.skills) if (!ids.skills.has(x)) add(key, i, c.key, 'error', `페이즈 ${ph.hp}% — 스킬 "${x}"가 없습니다`);
        }
      }
      // 테이블별 추가 규칙
      if (key === 'effects') {
        if ((r.kind === 'buff' || r.kind === 'debuff') && (!r.stat || r.value == null)) add(key, i, r.stat ? 'value' : 'stat', 'error', '버프·디버프는 대상 스탯과 수치가 필요합니다');
        if (['heal', 'shield', 'dot', 'revive'].includes(r.kind) && r.value == null) add(key, i, 'value', 'error', '회복·보호막·지속 피해·부활은 수치가 필요합니다');
        if ((r.kind === 'stun' || r.kind === 'taunt' || r.kind === 'dot') && !(r.duration > 0)) add(key, i, 'duration', 'warn', '지속이 0이면 효과가 바로 끝납니다');
      }
      if (key === 'monsters' && r.boss && !(r.groggyMax > 0)) add(key, i, 'groggyMax', 'warn', '보스인데 그로기 최대치가 없어 흐트러짐이 일어나지 않습니다');
      if (key === 'synergies') {
        const ks = splitList(r.key);
        if (r.cond === 'element') { if (!ids.elements.has(String(r.key ?? '').trim())) add(key, i, 'key', 'error', `조건 값 — 속성 "${r.key ?? ''}"가 상성 테이블에 없습니다`); if (!(r.count >= 1)) add(key, i, 'count', 'error', '같은 속성 조건은 인원 N(1 이상)이 필요합니다'); }
        if (r.cond === 'role') { if (!ks.length) add(key, i, 'key', 'error', '역할군 조합이 비었습니다 (예: tank|healer)'); ks.filter(x => !(x in ROLES) && !Object.values(ROLES).includes(x)).forEach(x => add(key, i, 'key', 'error', `조건 값 — 역할군 "${x}"가 없습니다`)); }
        if (r.cond === 'chars') { if (!ks.length) add(key, i, 'key', 'error', '캐릭터 조합이 비었습니다'); ks.filter(x => !ids.characters.has(x)).forEach(x => add(key, i, 'key', 'error', `조건 값 — 캐릭터 "${x}"가 없습니다`)); }
      }
    });
  }
  return { issues, count: { error: issues.filter(x => x.level === 'error').length, warn: issues.filter(x => x.level === 'warn').length } };
}

// ── CSV ─────────────────────────────────────────────────
/** RFC 4180 CSV (엑셀 저장본): BOM, 따옴표 안 쉼표·줄바꿈, CRLF. 구분자는 첫 줄에서 쉼표·세미콜론·탭 중 많은 것 */
export function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const sep = [',', ';', '\t'].map(c => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCSV = (rows) => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** 테이블 → CSV (머리글 = 열 키, 선택지는 한글 라벨 첫 단어로 — 엑셀에서 읽기 쉽게) */
export function tableToCSV(t, key) {
  const cols = columnsOf(t, key);
  const out = (c, v) => {
    if (v == null) return '';
    if (c.type === 'refs') return v.join('|');
    if (c.type === 'enum') return c.options[v] ? c.options[v].split(' ')[0] : v;
    if (c.type === 'bool') return v ? 'TRUE' : 'FALSE';
    return v;
  };
  return toCSV([cols.map(c => c.key), ...(t[key] || []).map(r => cols.map(c => out(c, r[c.key])))]);
}

/**
 * CSV → 테이블 행. 머리글은 열 키(hp) 또는 라벨(체력)로 맞춘다. 상성 테이블은 "vs:화" 또는 "→ 화"·"화".
 * 반환 { rows, unknown: [모르는 머리글], missing: [없는 필수 열] }
 */
export function tableFromCSV(t, key, text) {
  const [head = [], ...body] = parseCSV(text);
  const T = TABLES[key];
  let cols = columnsOf(t, key);
  if (T.matrix) {
    // 상성: 머리글의 속성들로 열을 다시 만든다 (불러오는 파일이 속성 목록을 정함)
    const els = head.slice(1).map(h => h.trim().replace(/^vs:/, '').replace(/^→\s*/, '')).filter(Boolean);
    cols = [T.cols[0], ...els.map(e => ({ key: `vs:${e}`, label: `→ ${e}`, type: 'num', min: 0, required: true }))];
    const rows = body.map(r => normalizeRow(cols, Object.fromEntries(cols.map((c, i) => [c.key, r[i]]))));
    return { rows, unknown: [], missing: [] };
  }
  const norm = (s) => String(s).trim().toLowerCase();
  const map = head.map(h => cols.find(c => norm(c.key) === norm(h) || norm(c.label) === norm(h)) || null);
  const unknown = head.filter((h, i) => !map[i] && h.trim());
  const missing = cols.filter(c => c.required && !map.includes(c)).map(c => c.label);
  const rows = body.map(r => normalizeRow(cols, Object.fromEntries(map.map((c, i) => [c?.key ?? `_${i}`, r[i]]).filter(([k]) => !k.startsWith('_')))));
  return { rows, unknown, missing };
}

/** JSON 가져오기: { classes: [...], … } 전체, { tables: {...} }, 또는 { table: 'skills', rows: [...] } 한 개 */
export function tablesFromJSON(obj, current) {
  const src = obj?.tables ?? obj;
  const out = structuredClone(current);
  const touched = [];
  const take = (key, rows) => {
    if (!Array.isArray(rows)) return;
    const cols = TABLES[key].matrix
      ? [TABLES[key].cols[0], ...[...new Set(rows.flatMap(r => Object.keys(r).filter(k => k.startsWith('vs:'))))].map(k => ({ key: k, type: 'num' }))]
      : columnsOf(out, key);
    out[key] = rows.map(r => normalizeRow(cols, r));
    touched.push(key);
  };
  if (src && typeof src.table === 'string' && src.table in TABLES) take(src.table, src.rows);
  else for (const key of TABLE_KEYS) if (src && key in src) take(key, src[key]);
  return { tables: out, touched };
}

// ── 최종 스탯 ───────────────────────────────────────────
/**
 * 최종 스탯 = ① 직업 기본 + ② 레벨 성장(성장 × (Lv−1)) + ③ 캐릭터 보정(합 또는 곱) + ④ 장비·버프(gear)
 * kind = 'char' | 'monster'. 반환 { name, kind, id, element, row, role, stats, skills, steps, boss, groggyMax, phases }
 * steps는 기획서 영역에 단계별 값을 보여 주기 위한 것.
 */
export function unitFrom(t, kind, id, level = 1, gear = null) {
  const lv = Math.max(1, Math.round(level));
  if (kind === 'monster') {
    const m = (t.monsters || []).find(r => r.id === id);
    if (!m) return null;
    const stats = Object.fromEntries(STAT_KEYS.map(k => [k, num(m[k])]));
    const gearred = applyGear(stats, gear);
    return {
      kind, id, name: m.name, element: m.element || '무', row: m.row || 'front', role: null, level: lv,
      stats: gearred, skills: [...(m.skills || [])], boss: !!m.boss, groggyMax: num(m.groggyMax), phases: parsePhases(m.phases).phases,
      steps: [{ label: '몬스터 테이블', stats }, ...(gear ? [{ label: '④ 장비·버프', stats: gearred }] : [])],
    };
  }
  const ch = (t.characters || []).find(r => r.id === id);
  const cl = ch && (t.classes || []).find(r => r.id === ch.classId);
  if (!ch || !cl) return null;
  const base = Object.fromEntries(STAT_KEYS.map(k => [k, num(cl[k])]));
  const grown = Object.fromEntries(STAT_KEYS.map(k => [k, base[k] + num(cl[k + 'G']) * (lv - 1)]));
  const mod = Object.fromEntries(STAT_KEYS.map(k => {
    const v = num(ch[k]);
    return [k, ch.modMode === 'mul' ? grown[k] * (1 + v / 100) : grown[k] + v];
  }));
  const fin = applyGear(mod, gear);
  for (const s of STATS) { if (s.min != null) fin[s.key] = Math.max(s.min, fin[s.key]); if (s.max != null) fin[s.key] = Math.min(s.max, fin[s.key]); }
  return {
    kind: 'char', id, name: ch.name, element: ch.element || '무', row: cl.row || 'front', role: cl.role, level: lv, classId: cl.id, className: cl.name,
    stats: fin, skills: [...new Set([...(ch.skills || []), ...(cl.skills || [])])] /* 고유 스킬 먼저 → 직업 스킬 (AI는 앞쪽부터 씀) */, boss: false, groggyMax: 0, phases: [],
    steps: [
      { label: '① 직업 기본', stats: base },
      { label: `② 레벨 성장 (Lv${lv})`, stats: grown },
      { label: `③ 캐릭터 보정 (${ch.modMode === 'mul' ? '곱' : '합'})`, stats: mod },
      ...(gear ? [{ label: '④ 장비·버프', stats: fin }] : []),
    ],
  };
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** gear: { atk: { add, mul } … } — 합을 먼저 더하고 곱(%)을 나중에 */
function applyGear(stats, gear) {
  if (!gear) return { ...stats };
  return Object.fromEntries(Object.entries(stats).map(([k, v]) => { const g = gear[k] || {}; return [k, (v + num(g.add)) * (1 + num(g.mul) / 100)]; }));
}

/** 상성 배율: 공격 속성 → 방어 속성 (없으면 1) */
export function elementMult(t, atk, def) {
  const row = (t.elements || []).find(r => r.id === atk);
  const v = row?.[`vs:${def}`];
  return typeof v === 'number' ? v : 1;
}

/** 선택 목록: 캐릭터·몬스터 [{ value: 'char:CH_x', label }] — 테이블에 행을 더하면 자동으로 늘어난다 */
export function unitOptions(t) {
  return [
    ...(t.characters || []).filter(r => r.id).map(r => ({ value: `char:${r.id}`, label: `${r.name || r.id} (${(t.classes || []).find(c => c.id === r.classId)?.name ?? '직업?'}·${r.element ?? ''})`, group: '캐릭터' })),
    ...(t.monsters || []).filter(r => r.id).map(r => ({ value: `monster:${r.id}`, label: `${r.boss ? '[보스] ' : ''}${r.name || r.id} (${r.element ?? ''})`, group: '몬스터' })),
  ];
}
export const parseUnitRef = (v) => { const [kind, ...rest] = String(v || '').split(':'); return { kind, id: rest.join(':') }; };

/** 새 ID: 접두어_번호 (겹치지 않게) */
export function nextId(rows, prefix) {
  const used = new Set(rows.map(r => r.id));
  for (let n = rows.length + 1; ; n++) { const id = `${prefix}_${String(n).padStart(2, '0')}`; if (!used.has(id)) return id; }
}

/** ID 바꾸기: 다른 테이블의 참조(ref·refs·페이즈·시너지 조건 값·상성 열)도 함께 바꾼다 */
export function renameId(t, table, from, to) {
  if (!from || from === to) return t;
  for (const key of Object.keys(TABLES)) {
    for (const c of columnsOf(t, key)) {
      if (c.ref !== table) continue;
      for (const r of t[key] || []) {
        if (c.type === 'ref' && r[c.key] === from) r[c.key] = to;
        else if (c.type === 'refs' && Array.isArray(r[c.key])) r[c.key] = r[c.key].map(x => (x === from ? to : x));
        else if (c.type === 'phases' && r[c.key]) r[c.key] = String(r[c.key]).split(/([=|;\s]+)/).map(x => (x === from ? to : x)).join('');
      }
    }
  }
  if (table === 'elements') for (const r of t.elements || []) if (`vs:${from}` in r) { r[`vs:${to}`] = r[`vs:${from}`]; delete r[`vs:${from}`]; }
  for (const r of t.synergies || []) {
    if ((table === 'elements' && r.cond === 'element' && r.key === from) || (table === 'characters' && r.cond === 'chars')) r.key = r.cond === 'element' ? to : splitList(r.key).map(x => (x === from ? to : x)).join('|');
  }
  return t;
}
