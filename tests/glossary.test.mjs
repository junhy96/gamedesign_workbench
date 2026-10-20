// 용어 툴팁: 화면 코드·테이블 열이 가리키는 용어 키가 모두 용어 데이터에 있는지, 항목명 매칭이 맞는지
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { glossary, matchersFor, matchLabel } from '../js/lib/tip.js';
import { TABLES } from '../js/data/schema.js';

test('용어마다 제목·뜻이 있고, 테이블 열이 가리키는 용어가 모두 있다', () => {
  for (const [k, g] of Object.entries(glossary)) {
    assert.ok(g.t && g.d, `${k}: 제목·뜻`);
    if (g.m) assert.ok(Array.isArray(g.m) && g.m.length, `${k}: m`);
  }
  for (const [key, t] of Object.entries(TABLES)) {
    assert.ok(glossary[t.tip], `${key} 테이블 ${t.tip}`);
    for (const c of t.cols) if (c.tip) assert.ok(glossary[c.tip], `${key}.${c.key} → ${c.tip}`);
  }
});

test('화면 코드의 tip("…")·label(…, "…") 키가 모두 용어 데이터에 있다', () => {
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk('js');
  const missing = [];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\btip\('([\w.]+)'\)|\blabel\([^()]*?,\s*'([\w.]+)'\)/g)) {
      const k = m[1] || m[2];
      if (!glossary[k]) missing.push(`${f}: ${k}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('항목명 매칭: 정확히 일치 / 앞부분 일치(*) / 긴 항목명 우선 / 탭 범위', () => {
  const b = matchersFor('battle'), e = matchersFor('enhance');
  assert.equal(matchLabel(e, '민감도'), 'enh.sens');
  assert.equal(matchLabel(b, '민감도 변동폭'), 'b.sensrange');
  assert.equal(matchLabel(b, '민감도 — 스탯을 ±10% 바꾸면'), 'b.sens');
  assert.equal(matchLabel(e, '연속 보정없음'), 'enh.streak');
  assert.equal(matchLabel(e, '표준편차 (계산값)'), 'enh.kpi.sd');
  assert.equal(matchLabel(e, 'CP'), null); // 스탯·전투 용어는 강화 탭에 붙지 않음
  assert.equal(matchLabel(b, 'CP'), 'b.cp');
});
