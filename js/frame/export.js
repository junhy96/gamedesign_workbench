// 프레임 타임라인 → PowerPoint (편집 가능한 기본 도형·표)
// 디자인: 전투 기획서 '기술 일람' 슬라이드 양식 — 보라 헤더 바, 정보 표, 행 라벨 표 위에 초 단위 축과 둥근 막대.
// 슬라이드 사양 함수는 순수 함수(도형 사양만 계산) → Node 테스트 가능. exportFramePptx()가 실제 파일 생성.
import { toMs } from './model.js';
import { createDeck, renderSpecs, SLIDE } from '../lib/pptx.js';

export const STYLE = {
  primary: '#615BAE', title: '#3E3973', ink: '#2A2740', sub: '#A6A3D1', subText: '#5B3D7B', strip: '#757575',
  hit: '#3FA66A', telegraph: '#E2B13A', window: '#6FA8DC', accent: '#EE696B', axis: '#555560', marker: '#B0B0B8', dot: '#808080',
};
export const FONTS = { bold: '프리젠테이션 7 Bold', regular: '프리젠테이션 4 Regular', light: '프리젠테이션 2 ExtraLight' };
const GRADE_LABEL = { good: '여유', warn: '빠듯', serious: '가혹', critical: '불가' };
const SECTION = { timeline: ['01', '패턴 타임라인'], attack: ['02', '공격 일람'], table: ['03', '패턴별 판정'], findings: ['04', '검증 결과'] };

// 배치 (인치, 와이드 13.333 × 7.5)
const TABLE_X = 0.65, TABLE_W = 12.2;
const INFO = { y: 1.3, colW: [2.02, 3.43, 1.67, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85], rowH: [0.3, 0.32, 0.5, 0.32] };
const LABEL_W = 0.98;
const TL = { y: 2.84, animH: 1.99, stripH: 1.3, rowH: 0.49, barH: 0.21 };
const ROWS = [
  ['위험 신호', 'Telegraph'], ['공격 판정', 'Hit'], ['후딜', 'Recovery'], ['반응 타이밍', 'Window'], ['반격', 'Counter'],
];
const AXIS = { x0: 1.74, x1: 12.63 };
const rowTop = (i) => TL.y + TL.animH + i * TL.rowH;
const TL_BOTTOM = rowTop(ROWS.length);
const LINE_TOP = TL.y + TL.stripH + 0.38;

const sec = (f, fps) => `${+(f / fps).toFixed(2)}s`;
/** 8pt 굵은 글꼴 기준 대략적인 글자 폭 (막대 안에 글자가 들어가는지 판단) */
const textW = (t, pt = 8) => [...t].reduce((w, c) => w + (/[가-힣]/.test(c) ? 0.105 : 0.058), 0.08) * (pt / 8);

const text = (t, x, y, w, h, o = {}) => ({ type: 'text', text: t, x, y, w, h, fontFace: FONTS.regular, ...o });
const cell = (t, o = {}) => ({ text: Array.isArray(t) ? t : String(t), fontFace: FONTS.regular, fontSize: 11, color: STYLE.ink, ...o });
const headCell = (t, o = {}) => cell(t, { fill: STYLE.primary, color: '#FFFFFF', fontFace: FONTS.bold, fontSize: 10.5, ...o });
const subCell = (t) => headCell(t, { fill: STYLE.sub, color: STYLE.subText });
const table = (name, y, colW, rowH, rows) => ({ type: 'table', name, x: TABLE_X, y, w: TABLE_W, h: rowH.reduce((a, b) => a + b, 0), colW, rowH, rows });

/** 헤더 바 "01 | 패턴 타임라인" + 제목 (모든 슬라이드 공통) */
function frameSpecs(section, title) {
  const [no, label] = SECTION[section];
  return [
    { type: 'rect', name: '헤더 바', x: 0, y: 0, w: SLIDE.w, h: 0.47, fill: STYLE.primary },
    { type: 'line', name: '헤더 구분선', x: 0.545, y: 0, w: 0, h: 0.47, line: '#FFFFFF', lineWidth: 1 },
    text(no, 0.66, 0.07, 0.32, 0.33, { name: '섹션 번호', fontFace: FONTS.bold, fontSize: 16, color: '#FFFFFF', align: 'center', charSpacing: -0.7 }),
    text(label, 1.21, 0.07, 6, 0.33, { name: '섹션 이름', fontFace: FONTS.bold, fontSize: 14, color: '#FFFFFF' }),
    { type: 'rect', name: '제목 표식', x: 0.5, y: 0.8, w: 0.07, h: 0.28, fill: STYLE.primary },
    text(title, 0.75, 0.77, 12.1, 0.34, { name: '제목', fontFace: FONTS.bold, fontSize: 20, color: STYLE.title }),
  ];
}

/** 행 라벨 표(애니메이션 + 막대 행) — 막대·축은 이 표 위에 도형으로 얹는다 */
function labelTable() {
  const run = (t, o) => ({ text: t, options: { fontFace: FONTS.bold, color: 'FFFFFF', ...o } });
  const label = (ko, en) => headCell(en ? [run(ko, { fontSize: 10.5, breakLine: true }), run(en, { fontSize: 9 })] : ko);
  return table('타임라인 행 라벨', TL.y, [LABEL_W, TABLE_W - LABEL_W], [TL.animH, ...ROWS.map(() => TL.rowH)], [
    [label('애니메이션'), cell('')],
    ...ROWS.map(([ko, en]) => [label(ko, en), cell('')]),
  ]);
}

/**
 * 프레임 구간 [f0, f1)의 타임라인 도형.
 * segs: 애니메이션 띠에 표시할 구간 [{ f, label }], t0: 0초로 볼 프레임
 */
function timelineSpecs(res, state, { f0, f1, t0, segs, perAttack }) {
  const fps = state.fps, p = state.player, tl = res.timeline;
  const k = (AXIS.x1 - AXIS.x0) / Math.max(1, f1 - f0);
  const X = (f) => AXIS.x0 + (f - f0) * k;
  const specs = [labelTable()];

  // 애니메이션 띠 — 캡처를 붙여 넣을 자리. 구간 경계와 이름만 표시
  const stripX = TABLE_X + LABEL_W;
  specs.push({ type: 'rect', name: '애니메이션 띠', x: stripX, y: TL.y, w: TABLE_W - LABEL_W, h: TL.stripH, fill: STYLE.strip });
  const inSegs = segs.filter(s => s.f < f1).map(s => ({ ...s, f: Math.max(s.f, f0) }));
  inSegs.forEach((s, i) => {
    const xa = i === 0 ? stripX : X(s.f), xb = i + 1 < inSegs.length ? X(inSegs[i + 1].f) : stripX + TABLE_W - LABEL_W;
    if (i > 0) specs.push({ type: 'line', name: `구간 경계 ${s.label}`, x: xa, y: TL.y, w: 0, h: TL.stripH, line: '#FFFFFF', lineWidth: 0.75 });
    if (xb - xa > 0.3) specs.push(text(s.label, xa + 0.08, TL.y + 0.08, Math.min(xb - xa - 0.12, 4), 0.28, { name: `구간 이름 ${s.label}`, fontFace: FONTS.bold, fontSize: 11, color: '#FFFFFF' }));
  });

  // 시간 축 — 점선(시작·끝)과 이벤트 연결선, 위에 "초 / 프레임" 라벨
  const lineH = TL_BOTTOM - 0.03 - LINE_TOP;
  const labelY = TL.y + TL.stripH + 0.04;
  let lastLabel = -Infinity;
  const timeLabel = (f, big) => {
    const x = X(f);
    if (x - lastLabel < 0.62) return;
    lastLabel = x;
    const run = (t, o) => ({ text: t, options: { fontFace: FONTS.light, fontSize: 9, color: STYLE.axis.slice(1), ...o } });
    const t = big ? [run(sec(f - t0, fps), { fontFace: FONTS.regular, fontSize: 12, color: '000000', breakLine: true }), run(`${f - t0}f`)] : `${sec(f - t0, fps)}\n${f - t0}f`;
    specs.push(text(t, x - 0.3, labelY, 0.6, 0.36, { name: `시각 ${f - t0}f`, fontFace: FONTS.light, fontSize: 9, color: STYLE.axis, align: 'center' }));
  };
  specs.push({ type: 'line', name: '시작 점선', x: X(f0), y: LINE_TOP, w: 0, h: lineH, line: STYLE.dot, lineWidth: 0.75, dash: 'sysDot' });
  specs.push({ type: 'line', name: '끝 점선', x: X(f1), y: LINE_TOP, w: 0, h: lineH, line: STYLE.dot, lineWidth: 0.75, dash: 'sysDot' });
  timeLabel(f0, f0 === t0);
  const events = [...new Set(tl.attacks.flatMap(a => [a.start, ...a.hits.map(h => h.h0)]))].filter(f => f > f0 && f < f1).sort((a, b) => a - b);
  for (const f of events) {
    specs.push({ type: 'line', name: `이벤트 ${f - t0}f`, x: X(f), y: LINE_TOP, w: 0, h: lineH, line: STYLE.marker, lineWidth: 0.75 });
    if (X(f1) - X(f) >= 0.62) timeLabel(f);
  }
  lastLabel = -Infinity;
  timeLabel(f1);

  // 막대
  const bar = (row, a, b, fill, name, label, color = '#FFFFFF') => {
    const s = Math.max(a, f0), e = Math.min(b, f1 - 1);
    if (e < s) return;
    const w = (e - s + 1) * k;
    const t = [label].flat().find(l => l && textW(l) <= w);
    specs.push({ type: 'roundRect', name, x: X(s), y: rowTop(row) + (TL.rowH - TL.barH) / 2, w, h: TL.barH, radius: 0.035, fill, text: t, fontFace: FONTS.bold, fontSize: 8, color });
  };
  for (const a of tl.attacks) {
    const atk = state.attacks[a.ai];
    const nm = `${a.ai + 1}. ${a.name}`;
    if (atk.startup > 0) bar(0, a.start, a.hits[0].h0 - 1, STYLE.telegraph, `${nm} 선딜`, perAttack ? [`선딜 ${atk.startup}f`, `${atk.startup}f`] : [`${a.name} ${atk.startup}f`, `${atk.startup}f`]);
    a.hits.forEach((hit, i) => {
      if (i > 0 && hit.h0 - a.hits[i - 1].h1 > 1) bar(0, a.hits[i - 1].h1 + 1, hit.h0 - 1, STYLE.telegraph, `${nm} 타격 간격`, `${atk.hitGap}f`);
      bar(1, hit.h0, hit.h1, STYLE.hit, `${nm} 판정${a.hits.length > 1 ? ` ${i + 1}타` : ''}`, a.hits.length > 1 ? [`${i + 1}타 ${atk.active}f`, `${atk.active}f`] : [`판정 ${atk.active}f`, `${atk.active}f`]);
    });
    if (atk.recovery > 0) bar(2, a.hits.at(-1).h1 + 1, a.recoveryEnd, STYLE.sub, `${nm} 후딜`, [`후딜 ${atk.recovery}f`, `${atk.recovery}f`], STYLE.subText);
  }
  for (const hit of [...res.hits].sort((a, b) => a.memorize - b.memorize)) { // 암기 표시가 위로
    const atk = state.attacks[hit.ai];
    const nm = `${hit.ai + 1}. ${atk.name}${atk.hits > 1 ? ` ${hit.k + 1}타` : ''}`;
    if (hit.kind === 'dodge') {
      const label = hit.memorize ? [`암기 ${hit.effWindow}f`, `${hit.effWindow}f`] : [`${hit.effWindow}f ${GRADE_LABEL[hit.grade]}`, `${hit.effWindow}f`];
      bar(3, hit.effLo, hit.hi, hit.memorize ? STYLE.title : STYLE.window, `${nm} 회피 윈도우 ${hit.effWindow}f`, label);
      if ((hit.k === 0 || hit.memorize) && hit.reactNeed >= f0 && hit.reactNeed < f1) { // 같은 공격의 뒤 타격은 반응 시점이 같음
        specs.push({ type: 'line', name: `${nm} 반응 가능 시점`, x: X(hit.reactNeed), y: rowTop(3) + 0.08, w: 0, h: TL.rowH - 0.16, line: hit.memorize ? STYLE.accent : STYLE.ink, lineWidth: 1.25, dash: hit.memorize ? 'sysDash' : undefined });
      }
    } else if (hit.kind === 'impossible' || hit.kind === 'chainFail') {
      bar(3, hit.h0, hit.h1, STYLE.accent, `${nm} 회피 불가`, hit.kind === 'impossible' ? ['회피 불가', '불가'] : ['연계 불가', '불가']);
    }
  }
  for (const c of res.counters) {
    if (!Number.isFinite(c.window) || c.window <= 0) continue;
    bar(4, c.freeAt, Math.min(c.deadline - 1, tl.length - 1), c.count > 0 ? STYLE.primary : STYLE.marker, `${c.ai + 1}번 이후 반격 ${c.count}회`,
      c.count > 0 ? [`반격 ${c.count}회 · ${c.window}f`, `반격 ${c.count}회`, `${c.count}회`] : ['반격 불가', '불가']);
  }

  // 범례 (제목 줄 오른쪽)
  const legend = [['반응 가능 윈도우', STYLE.window], ['암기 필요', STYLE.title], ['회피 불가', STYLE.accent], ['반격 구간', STYLE.primary], ['반응 가능 시점', null]];
  let lx = TABLE_X + TABLE_W - legend.reduce((w, [l]) => w + 0.3 + textW(l), 0);
  for (const [l, fill] of legend) {
    if (fill) specs.push({ type: 'roundRect', name: `범례 ${l}`, x: lx, y: 0.88, w: 0.24, h: 0.13, radius: 0.03, fill });
    else specs.push({ type: 'line', name: `범례 ${l}`, x: lx + 0.12, y: 0.86, w: 0, h: 0.17, line: STYLE.ink, lineWidth: 1.25 });
    specs.push(text(l, lx + 0.28, 0.84, textW(l), 0.2, { name: `범례 ${l} 글자`, fontFace: FONTS.light, fontSize: 8, color: STYLE.axis }));
    lx += 0.3 + textW(l);
  }

  // 오른쪽 끝을 넘는 글자 상자는 폭을 줄임
  for (const sp of specs) if (sp.type === 'text' && sp.x + sp.w > SLIDE.w - 0.1) sp.w = Math.max(0.2, SLIDE.w - 0.1 - sp.x);
  for (const sp of specs) if (sp.type === 'text' && sp.x < 0.05) { sp.w -= 0.05 - sp.x; sp.x = 0.05; }
  return specs;
}

const policyLabel = (state) => (state.policy === 'optimal' ? '최적 입력 (선입력 포함)' : '반응형 (가장 늦게 입력)');
const dodgeLabel = (p) => `선딜 ${p.dodgeStartup} · 무적 ${p.dodgeInv} · 후딜 ${p.dodgeRecovery}f`;

/**
 * 패턴 타임라인 슬라이드. 긴 연계는 maxFrames 단위로 여러 장으로 나눈다(모든 장의 축척 동일).
 * @returns {{title:string, specs:object[]}[]}
 */
export function timelineSlides(res, state, { title = '패턴 프레임 검증', maxFrames = 480 } = {}) {
  const tl = res.timeline, p = state.player, fps = state.fps, s = res.summary;
  const pages = Math.max(1, Math.ceil(tl.length / maxFrames));
  const span = Math.ceil(tl.length / pages); // 장마다 고르게 나눔
  const reactable = res.hits.filter(h => h.kind === 'dodge' && !h.memorize).length;
  const info = table('패턴 정보', INFO.y, INFO.colW, INFO.rowH, [
    [headCell('패턴 명'), cell(title), headCell('연계 길이'), cell(`${s.length}f · ${sec(s.length, fps)} (${fps}fps)`, { colspan: 6 })],
    [headCell('판정 기준'), cell(policyLabel(state)), headCell('회피 성능'), cell(dodgeLabel(p), { colspan: 6 })],
    [headCell('반응 기준'), cell(`${p.reactionMs}ms + 지연 ${p.latency}f = ${res.reactFrames}f`), headCell('검증 요약'),
      cell(s.tightest ? `가장 빡빡한 회피 ${s.minWindow}f (${Math.round(toMs(s.minWindow, fps))}ms) · 암기 ${s.memorize}/${s.hits}타 · 반격 기회 ${s.counterChances}구간` : `회피 가능한 타격 없음`, { colspan: 6 })],
    [headCell('구성'), cell(`공격 ${tl.attacks.length}개 · ${s.hits}타`), headCell('판정 분포'),
      subCell('반응'), cell(reactable), subCell('암기'), cell(s.memorize), subCell('불가'), cell(s.impossible + s.chainFail)],
  ]);
  const slides = [];
  for (let page = 0; page < pages; page++) {
    const f0 = page * span, f1 = Math.min(tl.length, f0 + span);
    const t = pages > 1 ? `${title} (${page + 1}/${pages})` : title;
    const segs = tl.attacks.map(a => ({ f: a.start, label: `${a.ai + 1}. ${a.name}` }));
    slides.push({ title: t, specs: [...frameSpecs('timeline', t), info, ...timelineSpecs(res, state, { f0, f1, t0: 0, segs })] });
  }
  return slides;
}

/** 공격마다 한 장: 그 공격 구간만 확대한 타임라인 + 공격 정보 표 (0초 = 공격 시작) */
export function attackSlides(res, state) {
  const tl = res.timeline, fps = state.fps;
  return tl.attacks.map((a) => {
    const atk = state.attacks[a.ai];
    const hits = res.hits.filter(h => h.ai === a.ai);
    const c = res.counters[a.ai];
    const t = `${a.ai + 1}. ${a.name}`;
    const verdict = hits.map((h, i) => {
      const n = hits.length > 1 ? `${i + 1}타 ` : '';
      if (h.kind === 'covered') return `${n}함께 회피`;
      if (h.kind === 'impossible') return `${n}회피 불가 (판정 > 무적)`;
      if (h.kind === 'chainFail') return `${n}연계 불가${h.needsEarly ? ' (선입력 시 가능)' : ''}`;
      return `${n}${h.memorize ? `암기 (${-h.reactMargin}f 늦음)` : '반응'} · 윈도우 ${h.effWindow}f ${GRADE_LABEL[h.grade]}`;
    }).join(' / ');
    const ox = (ok) => (ok ? 'O' : 'X');
    const dodgeOk = hits.every(h => h.kind === 'dodge' || h.kind === 'covered');
    const reactOk = dodgeOk && !hits.some(h => h.memorize);
    const info = table('공격 정보', INFO.y, INFO.colW, INFO.rowH, [
      [headCell('공격 명'), cell(atk.name), headCell('연계 순서'), cell(`${a.ai + 1} / ${tl.attacks.length} · 시작 ${a.start}f (${sec(a.start, fps)})`, { colspan: 6 })],
      [headCell('프레임'), cell(`선딜 ${atk.startup} · 판정 ${atk.active} · 후딜 ${atk.recovery}f`), headCell('타수 · 간격'),
        cell(atk.hits > 1 ? `${atk.hits}타 · 간격 ${atk.hitGap}f` : '1타', { colspan: 6 })],
      [headCell('식별 시점 · 다음까지'), cell(`${atk.recog > 0 ? `선딜 ${atk.recog}f째` : '선딜 시작 즉시'} · 다음 공격까지 ${atk.gap}f`), headCell('회피 판정'), cell(verdict, { colspan: 6 })],
      [headCell('반격'), cell(c.last ? '마지막 공격 (반복 안 함)' : c.count > 0 ? `${c.count}회 (여유 ${c.window}f)` : `불가 (여유 ${c.window}f)`), headCell('가능한 반응'),
        subCell('회피'), cell(ox(dodgeOk)), subCell('반응'), cell(ox(reactOk)), subCell('반격'), cell(ox(c.last || c.count > 0))],
    ]);
    const f0 = a.start, f1 = a.next;
    const segs = [{ f: a.start, label: '선딜' }, ...a.hits.map((h, i) => ({ f: h.h0, label: a.hits.length > 1 ? `${i + 1}타` : '판정' })), { f: a.hits.at(-1).h1 + 1, label: '후딜' }]
      .filter((s, i, arr) => s.f < f1 && (i + 1 === arr.length || arr[i + 1].f > s.f)); // 길이 0 구간(선딜 0 등)은 생략
    return { title: t, specs: [...frameSpecs('attack', t), info, ...timelineSpecs(res, state, { f0, f1, t0: a.start, segs, perAttack: true })] };
  });
}

/** 판정 표 행 */
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

/** 판정 표 + 검증 결과 슬라이드 */
export function summarySlides(res, state) {
  const slides = [];
  const rows = detailRows(res, state);
  const PER = 16;
  for (let i = 0; i < Math.max(1, Math.ceil(rows.length / PER)); i++) {
    const t = i ? `패턴별 판정 (계속 ${i + 1})` : '패턴별 판정';
    const part = rows.slice(i * PER, i * PER + PER);
    const colW = [0.45, 1.9, 0.75, 0.75, 0.65, 0.75, 0.95, 0.75, 3.75, 1.5];
    slides.push({ title: t, specs: [...frameSpecs('table', t),
      table('판정 표', INFO.y, colW, [0.34, ...part.map(() => 0.32)], [
        ['#', '이름', '선딜', '판정', '타수', '후딜', '다음까지', '식별', '회피 판정', '반격'].map(h => headCell(h)),
        ...part.map(r => r.map((v, j) => cell(v, { align: j === 1 || j === 8 ? 'left' : 'center', fontSize: 10.5 }))),
      ]),
      text('단위: 프레임 · 회피 판정 = 타격별 회피 윈도우와 보고 반응할 수 있는지 (암기 = 반응으로는 늦음)', TABLE_X, 7.0, TABLE_W, 0.26, { name: '표 설명', fontFace: FONTS.light, fontSize: 9, color: STYLE.axis }),
    ] });
  }

  const LEVEL = { critical: ['불가', STYLE.accent, '#FFFFFF'], serious: ['가혹', STYLE.telegraph, '#FFFFFF'], warn: ['주의', STYLE.sub, STYLE.subText], info: ['참고', STYLE.marker, '#FFFFFF'], good: ['여유', STYLE.hit, '#FFFFFF'] };
  const F = 11, findings = res.findings;
  for (let i = 0; i < Math.max(1, Math.ceil(findings.length / F)); i++) {
    const t = i ? `검증 결과 (계속 ${i + 1})` : '검증 결과';
    const items = findings.slice(i * F, i * F + F);
    const body = items.length
      ? items.map(f => { const [lv, fill, color] = LEVEL[f.level]; return [headCell(lv, { fill, color }), cell(f.text, { align: 'left', fontSize: 10.5 })]; })
      : [[headCell('여유', { fill: STYLE.hit }), cell('문제 없음', { align: 'left' })]];
    slides.push({ title: t, specs: [...frameSpecs('findings', t), table('검증 결과 표', INFO.y, [0.9, TABLE_W - 0.9], body.map(() => 0.5), body)] });
  }
  return slides;
}

export async function exportFramePptx(res, state, name) {
  const title = `패턴 프레임 검증 - ${name}`;
  const pptx = await createDeck(title);
  for (const s of [...timelineSlides(res, state, { title: name }), ...attackSlides(res, state), ...summarySlides(res, state)]) {
    renderSpecs(pptx, pptx.addSlide(), s.specs);
  }
  await pptx.writeFile({ fileName: `${title.replace(/[\\/:*?"<>|]/g, '_')}.pptx` });
}
