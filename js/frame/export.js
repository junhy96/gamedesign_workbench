// 프레임 타임라인 → PowerPoint (편집 가능한 기본 도형)
// timelineSlides()는 순수 함수(도형 사양만 계산) → Node 테스트 가능. exportFramePptx()가 실제 파일 생성.
import { toMs } from './model.js';
import { createDeck, renderSpecs, SLIDE, FONT } from '../lib/pptx.js';

// 흰 슬라이드용 색 (화면의 라이트 테마와 동일)
export const COLORS = {
  startup: '#DDDBD4', recovery: '#B3B1A9', active: '#4A3AA7', inv: '#2A78D6', dodge: '#B7D2F3', counter: '#1BAF7A',
  good: '#1A7F4B', warn: '#D49A00', serious: '#D9631E', critical: '#C03A39',
  text: '#1B1B1A', muted: '#6B6A65', grid: '#E3E2DD',
};
const GRADE_LABEL = { good: '여유', warn: '빠듯', serious: '가혹', critical: '불가' };

const AREA = { x: 1.55, w: 11.25 };
const ROW = { ruler: 1.95, boss: 2.45, win: 3.35, player: 4.2, counter: 4.72 };
const BAR = 0.42;

/**
 * 타임라인 슬라이드 사양. 긴 연계는 maxFrames 단위로 여러 장으로 나눈다(모든 장의 축척 동일).
 * @returns {{title:string, subtitle:string, specs:object[]}[]}
 */
export function timelineSlides(res, state, { title = '패턴 프레임 검증', maxFrames = 480 } = {}) {
  const tl = res.timeline, p = state.player, fps = state.fps;
  const pages = Math.max(1, Math.ceil(tl.length / maxFrames));
  const span = Math.ceil(tl.length / pages); // 장마다 고르게 나눔
  const k = AREA.w / span; // 인치 / 프레임
  const slides = [];
  const policy = state.policy === 'optimal' ? '최적 입력 가정' : '반응형(가장 늦게) 가정';
  const head = `${fps}fps · 회피 선딜 ${p.dodgeStartup} / 무적 ${p.dodgeInv} / 후딜 ${p.dodgeRecovery}f · 반응 ${p.reactionMs}ms + 지연 ${p.latency}f (${res.reactFrames}f) · ${policy}`;

  for (let page = 0; page < pages; page++) {
    const f0 = page * span, f1 = Math.min(tl.length, f0 + span); // [f0, f1)
    const X = (f) => AREA.x + (f - f0) * k;
    const specs = [];
    const bar = (a, b, y, h, fill, name, text, color) => {
      const s = Math.max(a, f0), e = Math.min(b, f1 - 1);
      if (e < s) return;
      specs.push({ type: 'rect', x: X(s), y, w: (e - s + 1) * k, h, fill, name, text: text && (e - s + 1) * k > 0.32 ? text : undefined, fontSize: 9, bold: true, color });
    };
    const vline = (f, y, h, color, dash, name) => {
      if (f < f0 || f >= f1) return;
      specs.push({ type: 'path', x: X(f), y, w: 0.001, h, points: [{ x: 0, y: 0, moveTo: true }, { x: 0, y: h }], line: color, lineWidth: 1.25, dash, name });
    };

    // 행 라벨
    for (const [key, label] of [['boss', '보스'], ['win', '회피 윈도우'], ['player', '플레이어']]) {
      specs.push({ type: 'text', text: label, x: 0.45, y: ROW[key], w: 1.05, h: BAR, fontSize: 11, bold: true, color: COLORS.muted });
    }
    // 눈금
    const step = [5, 10, 15, 30, 60, 120, 300].find(st => st * k >= 0.55) || 600;
    for (let f = Math.ceil(f0 / step) * step; f < f1; f += step) {
      vline(f, ROW.ruler + 0.22, ROW.counter + 0.2 - ROW.ruler - 0.22, COLORS.grid, false, `눈금 ${f}f`);
      specs.push({ type: 'text', text: `${f}f`, x: X(f) + 0.03, y: ROW.ruler, w: 0.6, h: 0.2, fontSize: 8, color: COLORS.muted });
    }

    // 보스 공격
    for (const a of tl.attacks) {
      const atk = state.attacks[a.ai];
      const nm = `${a.ai + 1}. ${a.name}`;
      if (atk.startup > 0) bar(a.start, a.hits[0].h0 - 1, ROW.boss, BAR, COLORS.startup, `${nm} 선딜`);
      a.hits.forEach((hit, i) => {
        if (i > 0 && hit.h0 - a.hits[i - 1].h1 > 1) bar(a.hits[i - 1].h1 + 1, hit.h0 - 1, ROW.boss, BAR, COLORS.startup, `${nm} 타격 간격`);
        bar(hit.h0, hit.h1, ROW.boss, BAR, COLORS.active, `${nm} 판정${a.hits.length > 1 ? ` ${i + 1}타` : ''}`, `${atk.active}f`, '#FFFFFF');
      });
      if (atk.recovery > 0) bar(a.hits.at(-1).h1 + 1, a.recoveryEnd, ROW.boss, BAR, COLORS.recovery, `${nm} 후딜`);
      if (a.start >= f0 && a.start < f1) specs.push({ type: 'text', text: nm, x: X(a.start), y: ROW.boss - 0.27, w: 2.4, h: 0.24, fontSize: 9.5, bold: true, color: COLORS.text, name: `${nm} 이름` });
      if (atk.recog > 0) vline(a.recog, ROW.boss - 0.04, BAR + 0.08, COLORS.text, true, `${nm} 식별 시점`);
    }

    // 회피 윈도우 + 반응 시점
    for (const hit of res.hits) {
      const nm = `${hit.ai + 1}. ${state.attacks[hit.ai].name}${state.attacks[hit.ai].hits > 1 ? ` ${hit.k + 1}타` : ''}`;
      if (hit.kind === 'dodge') {
        bar(hit.effLo, hit.hi, ROW.win, BAR, COLORS[hit.grade], `${nm} 회피 윈도우 ${hit.effWindow}f`, `${hit.effWindow}f`, hit.grade === 'warn' ? '#1B1300' : '#FFFFFF');
        vline(hit.reactNeed, ROW.win - 0.06, BAR + 0.12, hit.memorize ? COLORS.critical : COLORS.text, hit.memorize, `${nm} 반응 가능 시점`);
      } else if (hit.kind === 'impossible' || hit.kind === 'chainFail') {
        bar(hit.h0, hit.h1, ROW.win, BAR, COLORS.critical, `${nm} 회피 불가`, hit.kind === 'impossible' ? '불가' : '연계 불가', '#FFFFFF');
      }
    }

    // 플레이어 회피 + 반격 구간
    for (const hit of res.hits.filter(h => h.kind === 'dodge')) {
      if (p.dodgeStartup) bar(hit.press, hit.press + p.dodgeStartup - 1, ROW.player, BAR, COLORS.dodge, '회피 선딜');
      bar(hit.cover[0], hit.cover[1], ROW.player, BAR, COLORS.inv, '회피 무적', `무적`, '#FFFFFF');
      if (p.dodgeRecovery) bar(hit.cover[1] + 1, hit.ready - 1, ROW.player, BAR, COLORS.dodge, '회피 후딜');
    }
    for (const c of res.counters) {
      if (!Number.isFinite(c.window) || c.window <= 0) continue;
      bar(c.freeAt, Math.min(c.deadline - 1, tl.length - 1), ROW.counter, 0.13, c.count > 0 ? COLORS.counter : COLORS.recovery, `${c.ai + 1}번 이후 반격 ${c.count}회`);
      if (c.count > 0 && c.freeAt >= f0 && c.freeAt < f1) specs.push({ type: 'text', text: `반격 ${c.count}회 (${c.window}f)`, x: X(c.freeAt), y: ROW.counter + 0.14, w: 1.6, h: 0.22, fontSize: 8.5, color: COLORS.good });
    }

    // 범례
    const legend = [['선딜', COLORS.startup], ['판정', COLORS.active], ['후딜', COLORS.recovery], ['회피 무적', COLORS.inv], ['회피 선·후딜', COLORS.dodge], ['반격 구간', COLORS.counter],
      ['여유', COLORS.good], ['빠듯', COLORS.warn], ['가혹', COLORS.serious], ['불가', COLORS.critical]];
    let lx = 0.5;
    for (const [label, color] of legend) {
      specs.push({ type: 'rect', x: lx, y: 5.45, w: 0.22, h: 0.14, fill: color, name: `범례 ${label}` });
      specs.push({ type: 'text', text: label, x: lx + 0.27, y: 5.39, w: 0.95, h: 0.26, fontSize: 9, color: COLORS.muted });
      lx += 0.3 + label.length * 0.13 + 0.25;
    }
    specs.push({ type: 'text', text: '회피 윈도우 막대 = 그 타격을 피하려면 회피를 눌러야 하는 프레임 구간 · 세로선 = 보고 누를 수 있는 시점(식별 + 반응), 빨간 점선이면 늦음 → 암기 패턴', x: 0.5, y: 5.75, w: 12.3, h: 0.3, fontSize: 9, color: COLORS.muted });

    const s = res.summary;
    const kpi = s.tightest
      ? `가장 빡빡한 회피 윈도우 ${s.minWindow}f (${Math.round(toMs(s.minWindow, fps))}ms) · 암기 필요 ${s.memorize}/${s.hits}타 · 회피 불가 ${s.impossible + s.chainFail}타 · 반격 기회 ${s.counterChances}구간 · 연계 ${s.length}f (${(s.length / fps).toFixed(2)}초)`
      : `연계 ${s.length}f`;
    specs.push({ type: 'text', text: kpi, x: 0.5, y: 6.35, w: 12.3, h: 0.4, fontSize: 12, bold: true, color: COLORS.text, fill: '#F2F1EC', margin: 0.1 });

    // 페이지 오른쪽 끝 근처에서 시작하는 라벨은 슬라이드 밖으로 나가지 않게 폭을 줄임
    for (const sp of specs) if (sp.x + sp.w > SLIDE.w - 0.2) sp.w = Math.max(0.2, SLIDE.w - 0.2 - sp.x);

    slides.push({
      title: pages > 1 ? `${title} (${page + 1}/${pages})` : title,
      subtitle: `${head} · 구간 ${f0}~${f1 - 1}f`,
      specs,
    });
  }
  return slides;
}

/** 판정 표 + 검증 결과 슬라이드 데이터 */
export function detailRows(res, state) {
  return state.attacks.map((a, i) => {
    const hits = res.hits.filter(h => h.ai === i).map(h => {
      if (h.kind === 'covered') return '함께 회피';
      if (h.kind === 'impossible') return '불가(판정>무적)';
      if (h.kind === 'chainFail') return h.needsEarly ? '연계 불가(선입력 시 가능)' : '연계 불가';
      return `${h.memorize ? '암기' : '반응'} ${h.effWindow}f ${GRADE_LABEL[h.grade]}`;
    }).join(', ');
    const c = res.counters[i];
    return [String(i + 1), a.name, a.startup, a.active, a.hits, a.recovery, a.gap, a.recog, hits, c.last ? '—' : c.count > 0 ? `${c.count}회 (${c.window}f)` : `불가 (${c.window}f)`];
  });
}

export async function exportFramePptx(res, state, title) {
  const pptx = await createDeck(title);
  const header = (slide, t, sub) => {
    slide.addText(t, { x: 0.45, y: 0.3, w: 12.4, h: 0.55, fontFace: FONT, fontSize: 22, bold: true, color: '1B1B1A', margin: 0 });
    if (sub) slide.addText(sub, { x: 0.45, y: 0.88, w: 12.4, h: 0.32, fontFace: FONT, fontSize: 10.5, color: '6B6A65', margin: 0 });
  };
  for (const s of timelineSlides(res, state, { title })) {
    const slide = pptx.addSlide();
    header(slide, s.title, s.subtitle);
    renderSpecs(pptx, slide, s.specs);
  }

  // 판정 표
  const slide = pptx.addSlide();
  header(slide, '패턴별 판정', '단위: 프레임 · 회피 판정은 타격별 회피 윈도우와 반응 가능 여부');
  const headRow = ['#', '이름', '선딜', '판정', '타수', '후딜', '다음까지', '식별', '회피 판정', '반격']
    .map(t => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: '2A78D6' }, align: 'center' } }));
  slide.addTable([headRow, ...detailRows(res, state).map(r => r.map((v, j) => ({ text: String(v), options: { align: j === 1 || j === 8 ? 'left' : 'center' } })))], {
    x: 0.45, y: 1.35, w: 12.4, colW: [0.4, 1.7, 0.7, 0.7, 0.6, 0.7, 0.9, 0.7, 4.2, 1.8],
    fontFace: FONT, fontSize: 10.5, color: '1B1B1A', border: { type: 'solid', pt: 0.5, color: 'D8D7D2' }, rowH: 0.34, valign: 'middle',
  });

  // 검증 결과 (한 장에 14줄씩)
  const LEVEL = { critical: '불가', serious: '가혹', warn: '주의', info: '참고', good: '여유' };
  const findings = res.findings;
  for (let i = 0; i < Math.max(1, Math.ceil(findings.length / 14)); i++) {
    const sl = pptx.addSlide();
    header(sl, '검증 결과', i ? `(계속 ${i + 1})` : '심각한 항목부터');
    const items = findings.slice(i * 14, i * 14 + 14);
    sl.addText(items.length ? items.map(f => ({ text: `[${LEVEL[f.level]}] ${f.text}`, options: { bullet: true, color: { critical: 'C03A39', serious: 'D9631E', warn: '8A6300', info: '6B6A65', good: '1A7F4B' }[f.level], breakLine: true } })) : '문제 없음', {
      x: 0.45, y: 1.35, w: 12.4, h: 5.8, fontFace: FONT, fontSize: 12.5, valign: 'top', paraSpaceAfter: 6,
    });
  }
  await pptx.writeFile({ fileName: `${title.replace(/[\\/:*?"<>|]/g, '_')}.pptx` });
}
