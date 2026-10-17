// 실행: npm test  (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesWord, styledCode, legendItems, edgeGroups, DEFAULT_STYLE } from '../js/diagram/style.js';

const an = {
  kind: 'flowchart',
  nodes: [
    { id: 's', cat: 'terminal' }, { id: 'd', cat: 'decision' }, { id: 'io', cat: 'io' }, { id: 'db', cat: 'data' }, { id: 'a', cat: 'process' },
  ],
  edges: [
    { i: 0, text: '' }, { i: 1, text: '예' }, { i: 2, text: '아니오' }, { i: 3, text: '없음 (재시도)' }, { i: 4, text: 'No' }, { i: 5, text: '아니오다' },
  ],
};
const style = (over = {}) => ({ ...DEFAULT_STYLE, ...over });

test('부정 라벨 판정: 단어로 시작하면 해당, 이어진 단어는 제외', () => {
  assert.equal(matchesWord('아니오', DEFAULT_STYLE.negWords), true);
  assert.equal(matchesWord('없음 (재시도)', DEFAULT_STYLE.negWords), true);
  assert.equal(matchesWord('"아니요"', DEFAULT_STYLE.negWords), true);
  assert.equal(matchesWord('no', DEFAULT_STYLE.negWords), true);
  assert.equal(matchesWord('아니오다', DEFAULT_STYLE.negWords), false);
  assert.equal(matchesWord('Normal', DEFAULT_STYLE.negWords), false); // 'n'으로 시작하지만 단어가 아님
  assert.equal(matchesWord('', DEFAULT_STYLE.negWords), false);
});

test('아니오·없음 선은 빨간색 linkStyle, 예 선은 켰을 때만 초록', () => {
  const code = styledCode('flowchart TD\n  s --> d', an, style(), false);
  assert.match(code, /linkStyle 2,3,4 stroke:#D93025/);
  assert.doesNotMatch(code, /#1E8E3E/);
  const g = edgeGroups(an, style({ posGreen: true }));
  assert.deepEqual(g, { neg: [2, 3, 4], pos: [1] });
});

test('블록 종류별 classDef/class, 방향 덮어쓰기', () => {
  const code = styledCode('flowchart TD\n  s --> d', an, style({ direction: 'LR' }), false);
  assert.match(code, /^flowchart LR/);
  assert.match(code, /classDef wb_io fill:#E2F5EB/);
  assert.match(code, /class io wb_io/);
  assert.match(code, /class d wb_decision/);
  // 사용자가 직접 classDef를 쓴 코드는 색을 덮어쓰지 않음
  const own = styledCode('flowchart TD\n  s --> d\n  classDef x fill:#000', an, style(), false);
  assert.doesNotMatch(own, /wb_io/);
  // 색 없음 팔레트
  assert.doesNotMatch(styledCode('flowchart TD\n  s --> d', an, style({ palette: 'none' }), false), /classDef/);
});

test('범례: 쓰인 블록 종류만 정해진 순서로, 분기 선 항목 포함', () => {
  const items = legendItems(an, style({ posGreen: true }));
  assert.deepEqual(items.filter(i => i.kind === 'block').map(i => i.cat), ['terminal', 'process', 'decision', 'io', 'data']);
  assert.deepEqual(items.filter(i => i.kind === 'edge').map(i => i.label), ['아니오 · 없음 분기', '예 · 있음 분기']);
});
