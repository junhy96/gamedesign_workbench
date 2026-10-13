// 실행: npm test  (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, buildTimeline, validate, reactionFrames } from '../js/frame/model.js';
import { TEMPLATES } from '../js/frame/presets.js';
import { mulberry32 } from '../js/enhance/simulate.js';

const tpl = (id) => TEMPLATES[id].make();
const atk = (name, startup, active, recovery, gap, extra = {}) => ({ name, startup, active, hits: 1, hitGap: 0, recovery, gap, recog: 0, ...extra });

test('모든 템플릿이 검증을 통과한다', () => {
  for (const id of Object.keys(TEMPLATES)) assert.deepEqual(validate(tpl(id)), [], id);
});

test('회피 윈도우 = 무적 − 판정 + 1 (모든 입력 프레임을 직접 대입해 확인)', () => {
  for (let dI = 1; dI <= 20; dI++) for (let A = 1; A <= 20; A++) for (const dS of [0, 3, 7]) {
    const cfg = tpl('blank');
    cfg.player = { ...cfg.player, dodgeStartup: dS, dodgeInv: dI };
    cfg.attacks = [atk('t', 40, A, 10, 10)];
    const h = analyze(cfg).hits[0];
    // 브루트포스: 무적 [p+dS, p+dS+dI−1]이 판정 [40, 40+A−1]을 덮는 p의 개수
    let count = 0;
    for (let p = -50; p <= 100; p++) if (p + dS <= 40 && p + dS + dI - 1 >= 40 + A - 1) count++;
    assert.equal(Math.max(0, h.window), count, `dI=${dI} A=${A} dS=${dS}`);
    assert.equal(h.kind, count > 0 ? 'dodge' : 'impossible');
  }
});

test('기본 템플릿: 손으로 계산한 값과 일치', () => {
  const r = analyze(tpl('basic'));
  const k = r.hits.map(h => `${h.kind}:${h.effWindow}`);
  assert.deepEqual(k, ['dodge:11', 'dodge:10', 'dodge:3', 'dodge:11', 'impossible:-1']);
  assert.equal(r.hits[3].reactMargin, -8);       // 지연 찌르기: 8f 늦음
  assert.equal(reactionFrames(tpl('basic')), 19); // 250ms@60fps = 15f + 지연 4f
  assert.deepEqual(r.counters.map(c => [c.window, c.count]), [[39, 1], [56, 2], [55, 2], [117, 4]]);
});

test('선입력 강제 감지: 늦게 피하면 실패, 일찍 피하면 성공', () => {
  const r = analyze(tpl('rush'));
  const h = r.hits[1];
  assert.equal(h.kind, 'chainFail');
  assert.equal(h.needsEarly, true);
  const early = analyze({ ...tpl('rush'), policy: 'optimal' });
  assert.equal(early.hits[1].kind, 'dodge');
});

/** 브루트포스: 모든 입력 조합을 탐색해 '구르기로 피할 수 있는 타격을 전부 피할 수 있는가' */
function bruteForceAllDodgeable(cfg) {
  const { dodgeStartup: dS, dodgeInv: dI, dodgeRecovery: dR } = cfg.player;
  const hits = buildTimeline(cfg).attacks.flatMap(a => a.hits).filter(h => dI - (h.h1 - h.h0 + 1) + 1 > 0);
  const search = (i, ready, cover) => {
    if (i === hits.length) return true;
    const h = hits[i];
    if (cover && cover[0] <= h.h0 && cover[1] >= h.h1) return search(i + 1, ready, cover);
    for (let p = Math.max(h.h1 - dI + 1 - dS, ready); p <= h.h0 - dS; p++) {
      if (search(i + 1, p + dS + dI + dR, [p + dS, p + dS + dI - 1])) return true;
    }
    return false;
  };
  return search(0, -Infinity, null);
}

test('최적 입력 계획(동적 계획법) = 브루트포스 탐색 (무작위 연계 1000개)', () => {
  const rnd = mulberry32(42);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  for (let n = 0; n < 1000; n++) {
    const cfg = tpl('blank');
    cfg.policy = 'optimal';
    cfg.player = { ...cfg.player, dodgeStartup: ri(0, 5), dodgeInv: ri(6, 16), dodgeRecovery: ri(4, 20) };
    cfg.attacks = Array.from({ length: ri(1, 3) }, (_, i) => atk(`a${i}`, ri(5, 30), ri(1, 10), ri(0, 20), ri(0, 15), { hits: ri(1, 3), hitGap: ri(0, 25) }));
    const r = analyze(cfg);
    const greedyOk = !r.hits.some(h => h.kind === 'chainFail');
    assert.equal(greedyOk, bruteForceAllDodgeable(cfg), JSON.stringify(cfg.attacks));
  }
});

test('한 번의 회피로 연속 타격을 함께 피하면 "covered"', () => {
  const cfg = tpl('blank');
  cfg.player = { ...cfg.player, dodgeInv: 20 };
  cfg.attacks = [atk('빠른 2타', 30, 2, 20, 10, { hits: 2, hitGap: 3 })]; // 판정 30~31, 35~36
  const r = analyze(cfg);
  assert.equal(r.hits[1].kind, 'covered');
});

test('반응: 식별 시점을 늦추면 암기 패턴이 된다', () => {
  const cfg = tpl('blank');
  cfg.attacks = [atk('찌르기', 40, 4, 30, 20)];
  assert.equal(analyze(cfg).hits[0].memorize, false);
  cfg.attacks[0].recog = 30;
  const h = analyze(cfg).hits[0];
  assert.equal(h.memorize, true);
  assert.equal(h.reactMargin, (40 - 3) - (30 + 19));
});

test('반격 횟수: (k−1)·공격 전체 + 회피 캔슬 ≤ 여유', () => {
  const cfg = tpl('blank'); // 공격 1개 반복: 여유 56f, 캔슬 20f, 전체 32f
  const c = analyze(cfg).counters[0];
  assert.equal(c.count, 1 + Math.floor((c.window - 20) / 32));
  cfg.loop = false;
  assert.equal(analyze(cfg).counters[0].last, true);
});

test('PPT 타임라인 사양: 모든 도형이 슬라이드 안, 긴 연계는 고르게 여러 장', async () => {
  const { timelineSlides } = await import('../js/frame/export.js');
  const { SLIDE } = await import('../js/lib/pptx.js');
  for (const id of Object.keys(TEMPLATES)) {
    const state = tpl(id), res = analyze(state);
    for (const maxFrames of [480, 120]) {
      const slides = timelineSlides(res, state, { maxFrames });
      assert.equal(slides.length, Math.ceil(res.timeline.length / maxFrames));
      for (const s of slides) for (const sp of s.specs) {
        assert.ok(sp.x >= 0 && sp.y >= 0 && sp.x + sp.w <= SLIDE.w + 0.01 && sp.y + sp.h <= SLIDE.h + 0.01, `${id} ${sp.name ?? sp.text}`);
      }
      // 모든 판정 타격이 어느 장엔가 그려진다
      const drawn = slides.flatMap(s => s.specs).filter(sp => /판정/.test(sp.name ?? '')).length;
      assert.ok(drawn >= res.hits.length);
    }
  }
});

test('입력 오류 감지', () => {
  const cfg = tpl('blank');
  cfg.attacks[0].active = 0;
  cfg.player.atkCancel = 99;
  const errs = validate(cfg).join();
  assert.match(errs, /판정은 1프레임/);
  assert.match(errs, /회피 캔슬/);
});
