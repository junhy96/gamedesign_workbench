// 데이터 테이블 저장소 — 모든 시뮬레이터가 같은 테이블을 읽는다 (1:1·파티 단일화).
// 바뀌면 document에 'tableschange'를 보내, 시뮬레이터의 선택 목록이 바로 다시 그려진다.
import { store } from '../lib/util.js';
import { defaultTables } from './tables.js';
import { TABLE_KEYS } from './schema.js';

export const TABLES_KEY = 'tables:v1';
let cur = null;

/** 저장본이 있으면 저장본, 없으면 기본 데이터 */
export function getTables() {
  if (!cur) {
    const s = store.get(TABLES_KEY);
    cur = s && s.v === 1 && s.tables ? { ...defaultTables(), ...s.tables } : defaultTables();
    for (const k of TABLE_KEYS) cur[k] ||= [];
  }
  return cur;
}

export function setTables(t) {
  cur = t;
  store.set(TABLES_KEY, { v: 1, tables: t });
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('tableschange'));
}

/** 테이블이 바뀔 때마다 cb (다른 탭의 선택 목록 갱신용) */
export function onTablesChange(cb) { document.addEventListener('tableschange', cb); }
