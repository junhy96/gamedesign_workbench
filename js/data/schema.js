// 데이터 테이블 구조 — 전투 시뮬레이터(1:1·파티)가 읽는 7개 테이블의 열 정의.
// 수치는 여기 두지 않는다(기본 데이터는 tables.json). 테이블끼리는 ID로 참조한다.
// 열 type: id | text | num | enum | bool | ref(한 개) | refs(여러 개, "a|b") | phases(보스 페이즈 "70=s1|s2; 30=s3")

/** 전투 스탯 — 직업 기본·레벨 성장·캐릭터 보정·몬스터가 같은 키를 쓴다 */
export const STATS = [
  { key: 'hp', label: '체력', min: 1 },
  { key: 'atk', label: '공격력', min: 0 },
  { key: 'def', label: '방어력', min: 0 },
  { key: 'spd', label: '속도', min: 0 },
  { key: 'cric', label: '치명타 확률(%)', min: 0, max: 100 },
  { key: 'crid', label: '치명타 배율', min: 1 },
  { key: 'acc', label: '명중', min: 0 },
  { key: 'eva', label: '회피', min: 0 },
];
export const STAT_KEYS = STATS.map(s => s.key);
export const statLabel = (k) => STATS.find(s => s.key === k)?.label ?? k;

export const ROLES = { tank: '탱커', dealer: '딜러', healer: '힐러', buffer: '버퍼', debuffer: '디버퍼' };
export const ROWS = { front: '전열', back: '후열' };
export const MOD_MODES = { add: '합 (+값)', mul: '곱 (+값%)' };
export const TARGETS = { enemy: '적', ally: '아군', self: '자신' };
export const AREAS = { single: '단일', all: '광역' };
export const EFFECT_KINDS = {
  buff: '버프 (스탯 증가)', debuff: '디버프 (스탯 감소)', stun: '스턴 (행동 불가)', heal: '회복', shield: '보호막',
  dot: '지속 피해', taunt: '도발', revive: '부활',
};
export const VALUE_MODES = { add: '합연산 (고정값)', mul: '곱연산 (%)' };
export const SYN_CONDS = { element: '같은 속성 N명 이상', role: '역할군 조합 포함', chars: '특정 캐릭터 모두 포함' };
/** 버프·디버프가 바꿀 수 있는 스탯 (+ 받는 피해) */
export const EFFECT_STATS = { ...Object.fromEntries(STATS.filter(s => s.key !== 'hp').map(s => [s.key, s.label])), dmgTaken: '받는 피해(%)' };

const statCols = (suffix = '', o = {}) => STATS.map(s => ({ key: s.key + suffix, label: s.label + (o.labelSuffix || ''), type: 'num', min: o.min ?? s.min, max: o.max ?? s.max, required: !!o.required, tip: o.tip }));

/** 테이블 정의: key = 저장 키, idPrefix = 새 행 ID 접두어 */
export const TABLES = {
  classes: {
    label: '직업', idLabel: 'ClassID', idPrefix: 'CL', tip: 'table.classes',
    cols: [
      { key: 'id', label: 'ClassID', type: 'id', required: true },
      { key: 'name', label: '직업명', type: 'text', required: true },
      { key: 'role', label: '역할군', type: 'enum', options: ROLES, required: true, tip: 'role' },
      { key: 'row', label: '기본 배치', type: 'enum', options: ROWS, required: true, tip: 'row' },
      ...statCols('', { required: true, tip: 'stat.base' }),
      ...STATS.map(s => ({ key: s.key + 'G', label: `${s.label} 성장`, type: 'num', tip: 'stat.growth' })),
      { key: 'skills', label: '기본 스킬', type: 'refs', ref: 'skills', tip: 'skills.base' },
    ],
  },
  characters: {
    label: '캐릭터', idLabel: 'CharID', idPrefix: 'CH', tip: 'table.characters',
    cols: [
      { key: 'id', label: 'CharID', type: 'id', required: true },
      { key: 'name', label: '캐릭터명', type: 'text', required: true },
      { key: 'classId', label: 'ClassID', type: 'ref', ref: 'classes', required: true },
      { key: 'element', label: '속성', type: 'ref', ref: 'elements', required: true, tip: 'element' },
      { key: 'grade', label: '등급', type: 'text' },
      { key: 'modMode', label: '보정 방식', type: 'enum', options: MOD_MODES, required: true, tip: 'modMode' },
      ...STATS.map(s => ({ key: s.key, label: `${s.label} 보정`, type: 'num', tip: 'stat.mod' })),
      { key: 'skills', label: '고유 스킬', type: 'refs', ref: 'skills', tip: 'skills.unique' },
    ],
  },
  monsters: {
    label: '몬스터', idLabel: 'MonsterID', idPrefix: 'MO', tip: 'table.monsters',
    cols: [
      { key: 'id', label: 'MonsterID', type: 'id', required: true },
      { key: 'name', label: '이름', type: 'text', required: true },
      { key: 'element', label: '속성', type: 'ref', ref: 'elements', required: true, tip: 'element' },
      { key: 'row', label: '배치', type: 'enum', options: ROWS, required: true, tip: 'row' },
      ...statCols('', { required: true, tip: 'stat.monster' }),
      { key: 'skills', label: '스킬', type: 'refs', ref: 'skills' },
      { key: 'boss', label: '보스', type: 'bool', tip: 'boss' },
      { key: 'groggyMax', label: '그로기 최대치', type: 'num', min: 0, tip: 'groggy' },
      { key: 'phases', label: '페이즈 (체력%=스킬)', type: 'phases', ref: 'skills', tip: 'phases' },
    ],
  },
  skills: {
    label: '스킬', idLabel: 'SkillID', idPrefix: 'SK', tip: 'table.skills',
    cols: [
      { key: 'id', label: 'SkillID', type: 'id', required: true },
      { key: 'name', label: '스킬명', type: 'text', required: true },
      { key: 'target', label: '대상', type: 'enum', options: TARGETS, required: true, tip: 'skill.target' },
      { key: 'area', label: '범위', type: 'enum', options: AREAS, required: true, tip: 'skill.area' },
      { key: 'mult', label: '배율', type: 'num', min: 0, required: true, tip: 'skill.mult' },
      { key: 'cost', label: '코스트', type: 'num', min: 0, tip: 'skill.cost' },
      { key: 'cooldown', label: '쿨타임', type: 'num', min: 0, tip: 'skill.cooldown' },
      { key: 'groggy', label: '그로기 증가', type: 'num', min: 0, tip: 'skill.groggy' },
      { key: 'effects', label: '효과', type: 'refs', ref: 'effects', tip: 'skill.effects' },
    ],
  },
  effects: {
    label: '효과', idLabel: 'EffectID', idPrefix: 'EF', tip: 'table.effects',
    cols: [
      { key: 'id', label: 'EffectID', type: 'id', required: true },
      { key: 'name', label: '이름', type: 'text', required: true },
      { key: 'kind', label: '종류', type: 'enum', options: EFFECT_KINDS, required: true, tip: 'effect.kind' },
      { key: 'stat', label: '대상 스탯', type: 'enum', options: EFFECT_STATS, tip: 'effect.stat' },
      { key: 'value', label: '수치', type: 'num', tip: 'effect.value' },
      { key: 'mode', label: '연산', type: 'enum', options: VALUE_MODES, tip: 'effect.mode' },
      { key: 'chance', label: '발동 확률(%)', type: 'num', min: 0, max: 100, required: true, tip: 'effect.chance' },
      { key: 'duration', label: '지속', type: 'num', min: 0, tip: 'effect.duration' },
      { key: 'stack', label: '중첩', type: 'bool', tip: 'effect.stack' },
    ],
  },
  elements: {
    label: '속성 상성', idLabel: '공격 속성', idPrefix: 'EL', tip: 'table.elements', matrix: true,
    // 열은 속성 목록(행 ID)에서 만들어진다: 각 행 = 공격 속성, 각 열 = 방어 속성
    cols: [{ key: 'id', label: '공격 속성', type: 'id', required: true }],
  },
  synergies: {
    label: '시너지', idLabel: 'SynergyID', idPrefix: 'SY', tip: 'table.synergies',
    cols: [
      { key: 'id', label: 'SynergyID', type: 'id', required: true },
      { key: 'name', label: '이름', type: 'text', required: true },
      { key: 'cond', label: '조건', type: 'enum', options: SYN_CONDS, required: true, tip: 'synergy.cond' },
      { key: 'key', label: '조건 값', type: 'text', tip: 'synergy.key' },
      { key: 'count', label: '인원 N', type: 'num', min: 1, tip: 'synergy.count' },
      { key: 'effects', label: '효과', type: 'refs', ref: 'effects', required: true },
    ],
  },
};
export const TABLE_KEYS = Object.keys(TABLES);

/** 상성 테이블의 실제 열 (속성 목록에서 생성) */
export function columnsOf(tables, key) {
  const t = TABLES[key];
  if (!t.matrix) return t.cols;
  return [...t.cols, ...(tables.elements || []).map(r => ({ key: `vs:${r.id}`, label: `→ ${r.id}`, type: 'num', min: 0, required: true, tip: 'element.mult' }))];
}
