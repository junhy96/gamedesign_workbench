// 실행: npm test  (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeZip, readZip, crc32 } from '../js/lib/zip.js';
import { toCode, compile } from '../js/battle/formula.js';
import { exportData, unityFiles, unrealFiles } from '../js/battle/export.js';
import { TEMPLATES } from '../js/battle/presets.js';
import { mulberry32 } from '../js/enhance/simulate.js';

test('ZIP: 저장한 파일을 그대로 읽고 CRC가 맞다 (한글 이름 포함)', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926); // 표준 검사값
  const files = [{ name: 'a.txt', data: 'hello' }, { name: '폴더/한글.json', data: '{"x":1}' }, { name: 'empty.txt', data: '' }];
  const z = makeZip(files);
  const back = readZip(z);
  assert.deepEqual(back.map(f => f.name), files.map(f => f.name));
  back.forEach((f, i) => { assert.equal(new TextDecoder().decode(f.data), files[i].data); assert.ok(f.crcOk); });
  assert.deepEqual(makeZip(files), z); // 같은 내용 = 같은 바이트
});

test('수식 → 코드: JS로 옮긴 식이 원래 파서 결과와 같다 (우선순위·조건·함수, 무작위 입력)', () => {
  const formulas = [
    'a.atk * 100 / (100 + b.def)', 'max(a.atk - b.def, a.atk * 0.1)', 'a.acc - b.eva', '100 * a.acc / (a.acc + b.eva)',
    'a.hp < 50 && b.def >= 10 ? 2 ^ 3 ^ 0.5 : -lv % 4', 'round(a.atk / 3) + floor(b.def) - ceil(lv / 2)', '!(a.atk == b.def) || 7',
    'clamp(a.atk * (1 + 0.02 * (lv - 3)), 1, 50)', 'a.atk * min(a.atk / max(b.def, 1), 3)', 'sqrt(abs(a.atk - b.def)) + pow(2, lv) + log(1 + a.atk) + exp(-b.def / 100)',
  ];
  const names = ['a.atk', 'b.def', 'a.acc', 'b.eva', 'a.hp', 'lv'];
  const rnd = mulberry32(5);
  for (const src of formulas) {
    const c = compile(src, names);
    assert.ok(c.ok, src);
    const js = toCode(src, 'js', (n) => `v[${JSON.stringify(n)}]`);
    assert.ok(js.ok);
    // 테스트 안에서만: 생성한 JS 식을 함수로 만들어 비교 (도우미는 생성 규칙과 같은 의미)
    const fn = new Function('v', 'B', 'T', 'And', 'Or', 'Round', 'clamp', `return ${js.code};`);
    const B = (x) => (x ? 1 : 0), T = (x) => x !== 0, And = (l, r) => (T(l) ? r : 0), Or = (l, r) => (T(l) ? l : r), Round = (x) => Math.floor(x + 0.5), clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
    for (let k = 0; k < 200; k++) {
      const v = Object.fromEntries(names.map(n => [n, Math.round(rnd() * 200 - 20)]));
      const want = c.eval(c.vars.map(n => v[n])), got = fn(v, B, T, And, Or, Round, clamp);
      assert.ok(Object.is(want, got) || Math.abs(want - got) <= 1e-9 * Math.max(1, Math.abs(want)), `${src} ${JSON.stringify(v)}: ${want} vs ${got}`);
    }
  }
  // C#·C++ 모양
  const v = (n) => `${n[0]}["${n.slice(2)}"]`;
  assert.equal(toCode('a.atk * 100 / (100 + b.def)', 'cs', v).code, '((a["atk"] * 100.0f) / (100.0f + b["def"]))');
  assert.equal(toCode('max(a.atk, b.def, 1)', 'cpp', v).code, 'FMath::Max(FMath::Max(a["atk"], b["def"]), 1.0f)');
  assert.equal(toCode('a.atk % 3', 'cpp', v).code, 'FMath::Fmod(a["atk"], 3.0f)');
  assert.equal(toCode('round(a.atk)', 'cs', v).code, 'Round(a["atk"])');
  assert.equal(toCode('1 +', 'cs', v).ok, false);
});

test('Unity 내보내기: ID는 문자열, 특성·효과 전부, 수식은 C#, JsonUtility용 표 형식', () => {
  const cfg = TEMPLATES.traits.make();
  cfg.entities[0].stats.hp = { table: [[1, 500], [20, 1300]] };
  const files = unityFiles(cfg);
  assert.deepEqual(files.map(f => f.name), ['BattleData.json', 'Scripts/BattleRules.cs', 'Scripts/BattleData.cs', 'Scripts/Editor/BattleDataImporter.cs', 'README.txt']);
  const data = JSON.parse(files[0].data);
  assert.ok(data.entities.every(e => typeof e.id === 'string'));
  assert.deepEqual(data.entities[0].stats.find(s => s.stat === 'hp').table, [{ lv: 1, value: 500 }, { lv: 20, value: 1300 }]);
  assert.equal(data.entities[2].traits[0].effects[0].type, 'buff');
  assert.equal(data.entities[2].traits[0].condBelow, 30);
  const rules = files[1].data;
  assert.match(rules, /public static float Damage\(Dictionary<string, float> a, Dictionary<string, float> b, int lv\) => \(\(a\["atk"\] \* 100\.0f\) \/ \(100\.0f \+ b\["def"\]\)\);/);
  assert.match(rules, /public static float Cp\(Dictionary<string, float> s, int lv\)/);
  assert.match(files[3].data, /MenuItem\("Tools\/Planning Workbench\/Import Battle Data"\)/);
  assert.ok(files[3].data.includes(String.raw`Replace('\\', '/')`)); // C# 문자 '\\' = 백슬래시 하나
  // 괄호 짝
  for (const f of files.slice(1, 4)) { const s = f.data.replace(/"[^"\n]*"/g, ''); assert.equal((s.match(/\{/g) || []).length, (s.match(/\}/g) || []).length, f.name); }
});

test('Unreal 내보내기: DataTable 행 배열(Name = ID), CSV 머리글 = 구조체 필드, 한글 스탯은 C++ 이름 바꿈', () => {
  const cfg = TEMPLATES.classes.make();
  cfg.stats.push({ id: '정신력', name: '', growth: 'linear' });
  for (const e of cfg.entities) e.stats['정신력'] = { b: 1, g: 0 };
  const files = unrealFiles(cfg);
  const rows = JSON.parse(files.find(f => f.name === 'DT_BattleEntities.json').data);
  assert.ok(Array.isArray(rows) && rows[0].Name === 'e1' && rows[0].DisplayName === '전사');
  const csvHead = files.find(f => f.name === 'DT_BattleEntities.csv').data.split('\r\n')[0].split(',');
  const header = files.find(f => f.name === 'Source/BattleRows.h').data;
  for (const col of csvHead.slice(1)) assert.match(header, new RegExp(String.raw`\b${col}\b`), col);
  assert.ok(csvHead.includes('Stat9_Base'));
  assert.match(files.find(f => f.name === 'README.txt').data, /정신력 → Stat9/);
  const items = JSON.parse(files.find(f => f.name === 'DT_BattleItems.json').data);
  assert.equal(items[0].Mods, 'atk:0:15:1;cric:5:0:1');
  assert.match(files.find(f => f.name === 'Source/BattleRules.h').data, /inline float Damage\(const TMap<FName, float>& a, const TMap<FName, float>& b, float lv\) \{ return \(\(S\(a, TEXT\("atk"\)\) \* 100\.0f\)/);
  assert.equal(exportData(cfg).items[0].targets[0], 'e2');
});
