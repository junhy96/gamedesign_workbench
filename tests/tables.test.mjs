// 데이터 테이블: 기본 데이터 검증, CSV·JSON 왕복, 잘못된 값 표시, 최종 스탯 계산 순서
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTables, validateTables, tableToCSV, tableFromCSV, tablesFromJSON, parseCSV, parsePhases, unitFrom, unitOptions, elementMult, nextId } from '../js/data/tables.js';
import { TABLE_KEYS } from '../js/data/schema.js';

test('기본 데이터는 오류·경고 없이 통과', () => {
  const r = validateTables(defaultTables());
  assert.deepEqual(r.issues, []);
});

test('CSV 내보내기 → 가져오기 왕복이 같다 (7개 테이블 전부)', () => {
  const t = defaultTables();
  for (const k of TABLE_KEYS) {
    const back = tableFromCSV(t, k, tableToCSV(t, k));
    assert.deepEqual(back.rows, t[k], k);
    assert.deepEqual(back.unknown, []);
    assert.deepEqual(back.missing, []);
  }
});

test('엑셀 CSV: BOM·세미콜론·따옴표 안 쉼표/줄바꿈·한글 머리글·한글 선택지', () => {
  const rows = parseCSV('﻿a;b\r\n"x;y";"1,5"\r\n"줄\n바꿈";2\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x;y', '1,5'], ['줄\n바꿈', '2']]);
  const t = defaultTables();
  const csv = 'SkillID,스킬명,대상,범위,배율,코스트,쿨타임,효과\r\nSK_NEW,새 스킬,적,광역,"1,2",30,2,EF_STUN|EF_BURN\r\n';
  const r = tableFromCSV(t, 'skills', csv);
  assert.deepEqual(r.rows[0], { id: 'SK_NEW', name: '새 스킬', target: 'enemy', area: 'all', mult: 12, cost: 30, cooldown: 2, effects: ['EF_STUN', 'EF_BURN'] });
});

test('검증: 없는 ID 참조·중복 ID·빈 필수값·숫자 범위·선택지 밖 값을 행 단위로 표시', () => {
  const t = defaultTables();
  t.characters[0].classId = 'CL_NONE';
  t.skills[1].id = 'SK_SLASH';
  t.effects[0].chance = 140;
  t.classes[2].name = '';
  t.skills[3].effects = ['EF_NONE'];
  t.classes[0].role = '마법사';
  const { issues, count } = validateTables(t);
  const has = (table, row, col) => issues.some(i => i.table === table && i.row === row && i.col === col && i.level === 'error');
  assert.ok(has('characters', 0, 'classId'));
  assert.ok(has('skills', 1, 'id'));
  assert.ok(has('effects', 0, 'chance'));
  assert.ok(has('classes', 2, 'name'));
  assert.ok(has('skills', 3, 'effects'));
  assert.ok(has('classes', 0, 'role'));
  assert.ok(has('classes', 1, 'skills')); // ID를 바꿔 SK_SHIELDBASH를 참조하던 기사 스킬도 깨짐
  assert.equal(count.error, 7);
});

test('보스 페이즈 형식과 스킬 참조', () => {
  assert.deepEqual(parsePhases('30=SK_A; 70 = SK_B|SK_C').phases, [{ hp: 70, skills: ['SK_B', 'SK_C'] }, { hp: 30, skills: ['SK_A'] }]);
  assert.equal(parsePhases('반=SK_A').errors.length, 1);
  const t = defaultTables();
  t.monsters[3].phases = '70=SK_FLAME|SK_NONE';
  assert.ok(validateTables(t).issues.some(i => i.col === 'phases' && /SK_NONE/.test(i.msg)));
});

test('JSON 가져오기: 전체 / 테이블 하나', () => {
  const t = defaultTables();
  const one = tablesFromJSON({ table: 'effects', rows: [{ id: 'E1', name: '테스트', kind: '스턴', chance: '50', duration: 1 }] }, t);
  assert.deepEqual(one.touched, ['effects']);
  assert.deepEqual(one.tables.effects, [{ id: 'E1', name: '테스트', kind: 'stun', chance: 50, duration: 1 }]);
  assert.equal(one.tables.skills.length, t.skills.length);
  const all = tablesFromJSON({ tables: t }, defaultTables());
  assert.deepEqual(all.tables, t);
});

test('최종 스탯 = 직업 기본 + 레벨 성장 + 캐릭터 보정(합/곱) + 장비', () => {
  const t = defaultTables();
  const a = unitFrom(t, 'char', 'CH_AREN', 30); // 전사, 합 보정 hp+100 atk+10
  assert.equal(a.stats.hp, 900 + 60 * 29 + 100);
  assert.equal(a.stats.atk, 95 + 6 * 29 + 10);
  assert.deepEqual(a.skills, ['SK_BREAK', 'SK_SLASH']); // 고유 스킬 먼저
  assert.equal(a.steps.length, 3);
  const d = unitFrom(t, 'char', 'CH_DAHLIA', 1, { atk: { add: 10, mul: 50 } }); // 마법사, 곱 보정 atk +10%
  assert.ok(Math.abs(d.stats.atk - (125 * 1.1 + 10) * 1.5) < 1e-9);
  assert.equal(d.steps.at(-1).label, '④ 장비·버프');
  const g = unitFrom(t, 'monster', 'MO_GOLEM', 1);
  assert.equal(g.boss, true);
  assert.deepEqual(g.phases.map(p => p.hp), [70, 30]);
});

test('테이블에 캐릭터를 더하면 선택 목록에 자동으로 나타남, 상성 배율', () => {
  const t = defaultTables();
  const n = unitOptions(t).length;
  t.characters.push({ id: nextId(t.characters, 'CH'), name: '신규', classId: 'CL_MAGE', element: '광', modMode: 'add', skills: [] });
  assert.equal(unitOptions(t).length, n + 1);
  assert.equal(elementMult(t, '수', '화'), 1.3);
  assert.equal(elementMult(t, '화', '수'), 0.8);
  assert.equal(elementMult(t, '없음', '화'), 1);
});
