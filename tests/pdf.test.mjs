// 실행: npm test  (node --test) — PDF 도구의 순수 함수
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRanges, placeText, pageLabel, hasNonLatin, formatBytes } from '../pdf/js/core.js';

test('쪽 범위 해석', () => {
  assert.deepEqual(parseRanges('', 4), [0, 1, 2, 3]);
  assert.deepEqual(parseRanges('전체', 3), [0, 1, 2]);
  assert.deepEqual(parseRanges('1-3, 5', 6), [0, 1, 2, 4]);
  assert.deepEqual(parseRanges('4-', 6), [3, 4, 5]);
  assert.deepEqual(parseRanges('-2', 6), [0, 1]);
  assert.deepEqual(parseRanges('3-1', 3), [2, 1, 0]); // 역순 허용
  assert.throws(() => parseRanges('0', 3), /벗어났습니다/);
  assert.throws(() => parseRanges('7', 3), /벗어났습니다/);
  assert.throws(() => parseRanges('a', 3), /해석할 수 없습니다/);
});

test('텍스트 배치 9방위', () => {
  const base = { pageW: 600, pageH: 800, textW: 100, textH: 20, margin: 36 };
  assert.deepEqual(placeText({ ...base, position: 'tl' }), { x: 36, y: 744 });
  assert.deepEqual(placeText({ ...base, position: 'cc' }), { x: 250, y: 390 });
  assert.deepEqual(placeText({ ...base, position: 'br' }), { x: 464, y: 36 });
});

test('쪽 번호·글꼴 판단·용량 표시', () => {
  assert.equal(pageLabel('{n} / {total}', 2, 9), '2 / 9');
  assert.equal(hasNonLatin('Page 1'), false);
  assert.equal(hasNonLatin('대외비'), true);
  assert.equal(formatBytes(1536), '1.5 KB');
});
