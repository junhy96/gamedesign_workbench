// 방치형 스테이지 성장 — 챕터-스테이지 드랍과 골드 강화 구간 비용으로 실제 체류 시간을 계산하고 의도 체류와 비교 (순수 계산 모듈, DOM 없음)
//
// ■ 스테이지 s (1..N, N = 챕터 × 챕터당 스테이지)
//   몬스터 체력 hp(s) = hp0 × hpGrowth^(s−1),  웨이브 골드 g(s) = gold0 × goldGrowth^(s−1)
//   공격력 atk(L) = atk0 + atkPerLevel × L  (골드 강화 레벨 L)
//   돌파 조건: 웨이브 제한 시간 안에 몬스터 m마리 처치 → atk × waveLimit ≥ m × hp(s)  →  필요 레벨 L_req(s)
//
// ■ 골드 강화 비용 — 레벨이 수십만이라 레벨별 표 대신 구간 공식만 다룬다
//   구간 [lvMin, lvMax)에서 레벨 L → L+1 비용 = initCost + step × (L − lvMin),  lvMax 비움(null) = 끝 없음
//   누적 비용(0 → L)은 구간마다 등차수열 합 n × initCost + step × n(n−1)/2
//
// ■ 체류 시간
//   s−1에서 웨이브당 g(s−1)를 벌어 L_req(s−1) → L_req(s)까지 강화
//   실제 체류(s) = max(필요 골드 ÷ (g(s−1) ÷ waveSeconds), wavesPerStage × waveSeconds)
//   의도 체류(챕터 c) = baseSeconds × perChapterMult^(c−1),  정체 = 실제 > stagnationRatio × 의도

export function validate(cfg) {
  const errors = [];
  const pos = (v) => Number.isFinite(v) && v > 0;
  if (!(Number.isInteger(cfg.chapters) && cfg.chapters >= 1 && cfg.chapters <= 500)) errors.push('챕터 수는 1~500이어야 합니다.');
  if (!(Number.isInteger(cfg.stagesPerChapter) && cfg.stagesPerChapter >= 1 && cfg.stagesPerChapter <= 100)) errors.push('챕터당 스테이지는 1~100이어야 합니다.');
  if (cfg.chapters * cfg.stagesPerChapter > 10000) errors.push('전체 스테이지는 10,000개 이하로 두세요.');
  for (const [k, name] of [['waveSeconds', '웨이브 시간'], ['waveLimit', '웨이브 제한 시간'], ['monstersPerWave', '웨이브당 몬스터'], ['hp0', '첫 몬스터 체력'], ['hpGrowth', '체력 증가율'], ['gold0', '첫 웨이브 골드'], ['goldGrowth', '골드 증가율'], ['atkPerLevel', '레벨당 공격력']]) {
    if (!pos(cfg[k])) errors.push(`${name}은(는) 0보다 커야 합니다.`);
  }
  if (!(Number.isFinite(cfg.wavesPerStage) && cfg.wavesPerStage >= 0)) errors.push('돌파 웨이브 수는 0 이상이어야 합니다.');
  if (!Number.isFinite(cfg.atk0)) errors.push('기본 공격력을 넣으세요.');
  if (!pos(cfg.intendedDwell?.baseSeconds) || !pos(cfg.intendedDwell?.perChapterMult)) errors.push('의도 체류 시간(1챕터 초·챕터당 배수)은 0보다 커야 합니다.');
  if (!(cfg.stagnationRatio >= 1)) errors.push('정체 기준은 1배 이상이어야 합니다.');
  errors.push(...validateIntervals(cfg.costIntervals));
  return errors;
}

/** 구간 표 검증: 이어지는 순서, 마지막만 끝 없음 가능 */
export function validateIntervals(ivs) {
  const errors = [];
  if (!ivs?.length) return ['비용 구간을 1개 이상 넣으세요.'];
  ivs.forEach((iv, i) => {
    const n = `구간 ${i + 1}번`;
    const last = i === ivs.length - 1;
    if (!(Number.isInteger(iv.lvMin) && iv.lvMin >= 0)) errors.push(`${n}: LV_MIN은 0 이상의 정수여야 합니다.`);
    if (iv.lvMax == null) { if (!last) errors.push(`${n}: 끝 없음(LV_MAX 비움)은 마지막 구간에만 쓸 수 있습니다.`); }
    else if (!(Number.isInteger(iv.lvMax) && iv.lvMax > iv.lvMin)) errors.push(`${n}: LV_MAX는 LV_MIN보다 큰 정수여야 합니다.`);
    if (!(Number.isFinite(iv.initCost) && iv.initCost >= 0)) errors.push(`${n}: 시작 비용은 0 이상이어야 합니다.`);
    if (!(Number.isFinite(iv.step) && iv.step >= 0)) errors.push(`${n}: 증가폭은 0 이상이어야 합니다.`);
    if (i && ivs[i - 1].lvMax != null && iv.lvMin !== ivs[i - 1].lvMax) errors.push(`${n}: LV_MIN(${iv.lvMin})이 앞 구간 LV_MAX(${ivs[i - 1].lvMax})와 이어지지 않습니다.`);
  });
  return errors;
}

const top = (iv) => iv.lvMax ?? Infinity;

/** 레벨 L → L+1 비용. 마지막 구간에 끝이 있으면 그 공식을 그대로 연장 */
export function stepCost(ivs, L) {
  let iv = ivs.find(x => L >= x.lvMin && L < top(x));
  if (!iv) { if (L < ivs[0].lvMin) return 0; iv = ivs.at(-1); }
  return iv.initCost + iv.step * (L - iv.lvMin);
}

/** 누적 비용 0 → L (첫 구간 LV_MIN 아래 레벨은 비용 0) */
export function cumCost(ivs, L) {
  let sum = 0;
  for (let i = 0; i < ivs.length; i++) {
    const iv = ivs[i];
    if (L <= iv.lvMin) break;
    const end = i === ivs.length - 1 ? L : Math.min(L, top(iv));
    const n = end - iv.lvMin;
    sum += n * iv.initCost + iv.step * n * (n - 1) / 2;
  }
  return sum;
}

/** 구간 L이 속한 구간 번호 (끝을 넘으면 마지막 구간) */
export function intervalIndex(ivs, L) {
  const i = ivs.findIndex(x => L >= x.lvMin && L < top(x));
  return i >= 0 ? i : (L < ivs[0].lvMin ? 0 : ivs.length - 1);
}

/** 앞 구간이 끝난 비용에서 끊김 없이 이어지는 다음 구간 시작 비용 */
export const continuedInit = (iv) => iv.initCost + iv.step * (iv.lvMax - iv.lvMin);

export const stageLabel = (s, spc) => `${Math.floor((s - 1) / spc) + 1}-${((s - 1) % spc) + 1}`;

export function analyze(cfg) {
  const errors = validate(cfg);
  if (errors.length) return { ok: false, errors };
  const ivs = cfg.costIntervals;
  const spc = cfg.stagesPerChapter;
  const N = cfg.chapters * spc;
  const hp = (s) => cfg.hp0 * cfg.hpGrowth ** (s - 1);
  const gold = (s) => cfg.gold0 * cfg.goldGrowth ** (s - 1);
  const levelReq = (s) => Math.max(0, Math.ceil((cfg.monstersPerWave * hp(s) / cfg.waveLimit - cfg.atk0) / cfg.atkPerLevel));
  const intended = (s) => cfg.intendedDwell.baseSeconds * cfg.intendedDwell.perChapterMult ** Math.floor((s - 1) / spc);
  const clearSec = cfg.wavesPerStage * cfg.waveSeconds;

  const stages = [];
  let elapsed = 0, intendedElapsed = 0;
  let prevL = 0, prevCum = 0;
  for (let s = 1; s <= N; s++) {
    const L = levelReq(s), Lprev = s > 1 ? prevL : 0;
    const cum = cumCost(ivs, L);
    const need = cum - (s > 1 ? prevCum : 0);
    const farm = s > 1 ? need / (gold(s - 1) / cfg.waveSeconds) : 0;
    const dwell = Math.max(farm, clearSec);
    const want = intended(s);
    elapsed += dwell; intendedElapsed += want;
    stages.push({
      s, label: stageLabel(s, spc), chapter: Math.floor((s - 1) / spc) + 1,
      hp: hp(s), gold: gold(s), levelReq: L, levelFrom: Lprev, cumCost: cum, goldNeeded: need,
      farmSec: farm, dwellSec: dwell, intendedSec: want, ratio: dwell / want,
      elapsedSec: elapsed, intendedElapsedSec: intendedElapsed,
      stagnant: dwell > cfg.stagnationRatio * want, fast: dwell < want / cfg.stagnationRatio,
      interval: intervalIndex(ivs, Math.max(L - 1, 0)),
    });
    prevL = L; prevCum = cum;
  }

  // 챕터 요약
  const chapters = [];
  for (let c = 1; c <= cfg.chapters; c++) {
    const xs = stages.slice((c - 1) * spc, c * spc);
    const dwell = xs.reduce((a, x) => a + x.dwellSec, 0), want = xs.reduce((a, x) => a + x.intendedSec, 0);
    chapters.push({
      chapter: c, stages: xs, levelFrom: xs[0].levelFrom, levelTo: xs.at(-1).levelReq,
      goldNeeded: xs.reduce((a, x) => a + x.goldNeeded, 0), dwellSec: dwell, intendedSec: want, ratio: dwell / want,
      stagnant: xs.filter(x => x.stagnant), maxRatio: Math.max(...xs.map(x => x.ratio)), elapsedSec: xs.at(-1).elapsedSec,
    });
  }

  // 구간별: 그 구간 레벨을 요구하는 스테이지(L_req−1이 구간 안), 정체 수
  const intervals = ivs.map((iv, i) => {
    const xs = stages.filter(x => x.s > 1 && x.levelReq > x.levelFrom && overlaps(x, iv, i === ivs.length - 1));
    const n = iv.lvMax == null ? null : iv.lvMax - iv.lvMin;
    return {
      iv, index: i,
      endCost: n == null ? null : iv.initCost + iv.step * (n - 1),
      total: n == null ? null : n * iv.initCost + iv.step * n * (n - 1) / 2,
      jump: i ? iv.initCost - (ivs[i - 1].lvMax == null ? iv.initCost : continuedInit(ivs[i - 1])) : 0,
      stages: xs, stagnant: xs.filter(x => x.stagnant),
      dwellSec: xs.reduce((a, x) => a + x.dwellSec, 0),
    };
  });

  const stagnant = stages.filter(x => x.stagnant);
  const finalLevel = stages.at(-1).levelReq;
  return {
    ok: true, N, stages, chapters, intervals,
    totalSec: elapsed, intendedTotalSec: intendedElapsed,
    totalHours: Math.round(elapsed / 3600 * 100) / 100,
    finalLevel, finalCumCost: cumCost(ivs, finalLevel),
    stagnant, stagnantStages: stagnant.map(x => x.label),
    warnings: buildWarnings(cfg, stages, chapters, intervals, finalLevel),
  };
}

// 스테이지가 올리는 레벨 범위 [levelFrom, levelReq)가 구간과 겹치나 (마지막 구간은 끝 이후도 포함)
function overlaps(x, iv, last) {
  const hi = last ? Infinity : top(iv);
  return x.levelFrom < hi && x.levelReq > iv.lvMin;
}

const fmtRange = (iv) => (iv.lvMax == null ? `Lv${iv.lvMin.toLocaleString('ko-KR')} 이상` : `Lv${iv.lvMin.toLocaleString('ko-KR')}~${iv.lvMax.toLocaleString('ko-KR')}`);

function buildWarnings(cfg, stages, chapters, intervals, finalLevel) {
  const warnings = [];
  const ivs = cfg.costIntervals;
  const ratio = cfg.stagnationRatio;
  const spanText = (xs) => {
    // 연속 구간 묶기: 16-9~16-10, 17-6~17-10
    const runs = [];
    for (const x of xs) { const r = runs.at(-1); if (r && r.at(-1).s === x.s - 1) r.push(x); else runs.push([x]); }
    return runs.map(r => (r.length > 1 ? `${r[0].label}~${r.at(-1).label}` : r[0].label)).join(', ');
  };

  // 정체: 챕터별로 묶어서
  for (const ch of chapters) {
    if (!ch.stagnant.length) continue;
    const worst = ch.stagnant.reduce((a, b) => (b.ratio > a.ratio ? b : a));
    const lv = [Math.min(...ch.stagnant.map(x => x.levelFrom)), Math.max(...ch.stagnant.map(x => x.levelReq))];
    const ivIdx = [...new Set(ch.stagnant.map(x => x.interval))];
    warnings.push({
      level: ch.stagnant.length >= 2 ? 'serious' : 'warn', kind: 'stagnant', chapter: ch.chapter,
      text: `${ch.chapter}챕터 정체 ${ch.stagnant.length}곳 (${spanText(ch.stagnant)}): 실제 체류가 의도의 ${ratio}배를 넘습니다 — 최대 ${worst.label} ${worst.ratio.toFixed(1)}배. 필요 레벨 Lv${lv[0].toLocaleString('ko-KR')}~${lv[1].toLocaleString('ko-KR')} → 비용 구간 ${ivIdx.map(i => fmtRange(ivs[i])).join(', ')}`,
    });
  }

  // 원인 구간: 정체 스테이지가 몰린 구간의 증가폭이 앞뒤 구간보다 가파른가
  const totalStag = stages.filter(x => x.stagnant).length;
  for (const it of intervals) {
    const i = it.index;
    const prev = ivs[i - 1], next = ivs[i + 1];
    const spike = !!(prev && next) && it.iv.step > prev.step && it.iv.step > next.step;
    if (it.stagnant.length && spike) {
      warnings.push({
        level: 'serious', kind: 'cause', interval: i,
        text: `원인 후보: ${fmtRange(it.iv)} 구간의 증가폭(${it.iv.step})이 앞뒤 구간(${prev.step}, ${next.step})보다 가파릅니다. 정체 ${totalStag}곳 중 ${it.stagnant.length}곳이 이 구간 레벨을 요구합니다.`,
      });
    } else if (it.stagnant.length >= 2) {
      warnings.push({
        level: 'warn', kind: 'cause', interval: i,
        text: `정체 ${totalStag}곳 중 ${it.stagnant.length}곳이 ${fmtRange(it.iv)} 구간(증가폭 ${it.iv.step})에 몰려 있습니다. 이 구간의 시작 비용·증가폭이나 웨이브 골드 증가율을 확인하세요.`,
      });
    } else if (spike && it.stages.length) {
      warnings.push({ level: 'info', kind: 'spike', interval: i, text: `${fmtRange(it.iv)} 구간의 증가폭(${it.iv.step})이 앞뒤 구간(${prev.step}, ${next.step})보다 크지만, 정체 기준을 넘는 스테이지는 ${it.stagnant.length ? `${it.stagnant.length}곳뿐입니다` : '없습니다'}.` });
    }
  }

  // 구간 경계 비용 점프
  for (const it of intervals) {
    if (!it.index || Math.abs(it.jump) < 1e-9) continue;
    const prevEnd = continuedInit(ivs[it.index - 1]);
    warnings.push({ level: 'info', kind: 'jump', interval: it.index, text: `Lv${it.iv.lvMin.toLocaleString('ko-KR')} 경계에서 1레벨 비용이 끊깁니다: 이어지면 ${prevEnd.toLocaleString('ko-KR')}, 실제 시작 비용 ${it.iv.initCost.toLocaleString('ko-KR')} (${it.jump > 0 ? '+' : ''}${((it.jump / prevEnd) * 100).toFixed(0)}%).` });
  }

  // 마지막 구간에 끝이 있는데 그 이상 레벨이 필요
  const last = ivs.at(-1);
  if (last.lvMax != null && finalLevel > last.lvMax) {
    warnings.push({ level: 'warn', kind: 'beyond', text: `마지막 구간 끝(Lv${last.lvMax.toLocaleString('ko-KR')})보다 높은 Lv${finalLevel.toLocaleString('ko-KR')}까지 필요합니다. 끝 이후는 마지막 구간 공식을 그대로 연장해 계산했습니다 (LV_MAX를 비우면 끝 없음).` });
  }

  // 너무 빨리 지나가는 스테이지 (돌파만으로 넘어가는 초반 제외 없이 요약 한 줄)
  const fast = stages.filter(x => x.fast);
  if (fast.length) {
    const chs = [...new Set(fast.map(x => x.chapter))];
    warnings.push({ level: 'info', kind: 'fast', text: `의도의 1/${ratio}보다 빨리 지나가는 스테이지 ${fast.length}곳 (${chs.length > 6 ? `${chs.slice(0, 6).join('·')}챕터 등` : `${chs.join('·')}챕터`}) — 성장 구간이 비어 있거나 골드가 남습니다.` });
  }

  const order = { serious: 0, warn: 1, info: 2 };
  return warnings.sort((a, b) => order[a.level] - order[b.level]);
}

// ── 큰 수·시간 표시 ──────────────────────────────────────
const KR_UNITS = [[1e16, '경'], [1e12, '조'], [1e8, '억'], [1e4, '만']];
const comma = (n) => Math.round(n).toLocaleString('ko-KR');

/**
 * 큰 수 표시. mode 'kr': 만·억·조·경 두 단위(25억 7,633만), 1해(1e20) 이상은 지수 /
 * mode 'exp': 1만 미만은 그대로, 이상은 2.58e9
 */
export function fmtBig(n, mode = 'kr') {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a < 1e4) return sign + (a < 10 && !Number.isInteger(a) ? a.toFixed(1) : comma(a));
  if (mode === 'exp' || a >= 1e20) return sign + fmtExp(a);
  for (let u = 0; u < KR_UNITS.length; u++) {
    const [size, name] = KR_UNITS[u];
    if (a < size) continue;
    let major = Math.floor(a / size);
    const next = KR_UNITS[u + 1] ?? [1, ''];
    let minor = Math.round((a - major * size) / next[0]);
    if (minor >= size / next[0]) { major += 1; minor = 0; }
    return `${sign}${comma(major)}${name}${minor > 0 ? ` ${comma(minor)}${next[1]}` : ''}`;
  }
  return sign + comma(a);
}

/** 한 단위 짧은 표기: 25.8억 / 1,690만 — 그래프 눈금·좁은 칸 */
export function fmtBigShort(n, mode = 'kr') {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a < 1e4) return sign + comma(a);
  if (mode === 'exp' || a >= 1e20) return sign + fmtExp(a, 2);
  const [size, name] = KR_UNITS.find(([s]) => a >= s);
  const v = a / size;
  return `${sign}${v < 10 ? v.toFixed(2).replace(/\.?0+$/, '') : v < 100 ? v.toFixed(1).replace(/\.0$/, '') : comma(v)}${name}`;
}

function fmtExp(a, d = 3) {
  const e = Math.floor(Math.log10(a));
  let m = a / 10 ** e;
  if (+m.toFixed(d - 1) >= 10) return `1e${e + 1}`;
  return `${m.toFixed(d - 1).replace(/\.?0+$/, '')}e${e}`;
}

/** 시간: 45초 / 12분 30초 / 3시간 36분 / 3일 6시간 */
export function fmtDur(sec) {
  if (!Number.isFinite(sec)) return '—';
  sec = Math.round(sec);
  if (sec < 60) return `${sec}초`;
  if (sec < 3600) { const m = Math.floor(sec / 60), s = sec % 60; return s ? `${m}분 ${s}초` : `${m}분`; }
  if (sec < 86400) { const hh = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return m === 60 ? `${hh + 1}시간` : m ? `${hh}시간 ${m}분` : `${hh}시간`; }
  const d = Math.floor(sec / 86400), hh = Math.round((sec % 86400) / 3600);
  return hh === 24 ? `${d + 1}일` : hh ? `${d}일 ${hh}시간` : `${d}일`;
}

// ── CSV 가져오기 ─────────────────────────────────────────
export const CSV_FIELDS = { lvMin: 'LV_MIN', lvMax: 'LV_MAX', initCost: 'INIT_COST', step: 'STEP' };
// 열 이름 별칭 (소문자, 공백·_·- 제거 후 비교)
const ALIASES = {
  lvMin: ['lvmin', 'levelmin', 'minlv', 'minlevel', 'min', 'from', 'start', '시작레벨', '레벨시작', '최소레벨', '시작'],
  lvMax: ['lvmax', 'levelmax', 'maxlv', 'maxlevel', 'max', 'to', 'end', '끝레벨', '종료레벨', '레벨끝', '최대레벨', '끝'],
  initCost: ['initcost', 'init', 'cost', 'basecost', 'base', 'startcost', '시작비용', '초기비용', '기본비용', '비용'],
  step: ['step', 'inc', 'increment', 'delta', 'stepcost', '증가폭', '증가량', '증가', '증분'],
};
const norm = (s) => s.toLowerCase().replace(/[\s_\-()]/g, '');

/** CSV/TSV 텍스트 → 행 배열. 구분자는 첫 줄로 추정(탭 > 세미콜론 > 쉼표), 따옴표 칸 지원 */
export function parseCSV(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return { delim: ',', rows: [] };
  const first = lines[0];
  const delim = first.includes('\t') ? '\t' : (first.includes(';') && !first.includes(',')) ? ';' : ',';
  const rows = lines.map(line => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  });
  return { delim, rows };
}

/** 머리글 → 열 매핑 추정. 머리글이 숫자뿐이면 머리글 없음으로 보고 LV_MIN, LV_MAX, INIT_COST, STEP 순서 */
export function guessMapping(header) {
  const numeric = header.every(c => c === '' || Number.isFinite(toNum(c)));
  if (numeric) return { hasHeader: false, map: header.length >= 4 ? { lvMin: 0, lvMax: 1, initCost: 2, step: 3 } : { lvMin: 0, lvMax: -1, initCost: 1, step: 2 } };
  const names = header.map(norm);
  const map = {};
  const used = new Set();
  for (const key of Object.keys(ALIASES)) {
    // 정확히 같은 이름 우선, 다음은 별칭 순서
    let idx = -1;
    for (const a of ALIASES[key]) { idx = names.findIndex((n, i) => !used.has(i) && n === a); if (idx >= 0) break; }
    map[key] = idx;
    if (idx >= 0) used.add(idx);
  }
  return { hasHeader: true, map };
}

const toNum = (s) => (s == null || String(s).trim() === '' ? NaN : Number(String(s).replace(/[,\s]/g, '')));

/**
 * 구간 CSV → costIntervals. mapping을 주지 않으면 머리글로 추정.
 * LV_MAX 칸이 비면 끝 없음(마지막 구간), LV_MAX 열이 아예 없으면 다음 줄 LV_MIN으로 채움.
 */
export function parseIntervalsCSV(text, mapping) {
  const { rows, delim } = parseCSV(text);
  if (!rows.length) return { intervals: [], errors: ['내용이 비어 있습니다.'], header: [], map: null, delim };
  const guess = guessMapping(rows[0]);
  const hasHeader = mapping?.hasHeader ?? guess.hasHeader;
  const map = mapping?.map ?? guess.map;
  const header = hasHeader ? rows[0] : rows[0].map((_, i) => `열 ${i + 1}`);
  const body = hasHeader ? rows.slice(1) : rows;
  const errors = [];
  for (const k of ['lvMin', 'initCost', 'step']) if (!(map[k] >= 0)) errors.push(`${CSV_FIELDS[k]} 열을 찾지 못했습니다. 열을 직접 지정하세요.`);
  if (errors.length) return { intervals: [], errors, header, map, hasHeader, delim };

  const intervals = [];
  body.forEach((r, i) => {
    const line = i + 1 + (hasHeader ? 1 : 0);
    const lvMin = toNum(r[map.lvMin]), initCost = toNum(r[map.initCost]), step = toNum(r[map.step]);
    const rawMax = map.lvMax >= 0 ? r[map.lvMax] : undefined;
    const lvMax = rawMax == null || String(rawMax).trim() === '' ? null : toNum(rawMax);
    if ([lvMin, initCost, step].some(v => !Number.isFinite(v)) || (lvMax !== null && !Number.isFinite(lvMax))) { errors.push(`${line}번째 줄: 숫자가 아닌 값이 있습니다 (${r.join(', ')}).`); return; }
    intervals.push({ lvMin, lvMax, initCost, step });
  });
  intervals.sort((a, b) => a.lvMin - b.lvMin);
  if (!(map.lvMax >= 0)) intervals.forEach((iv, i) => { iv.lvMax = intervals[i + 1]?.lvMin ?? null; });
  if (!errors.length) errors.push(...validateIntervals(intervals));
  return { intervals, errors, header, map, hasHeader, delim };
}

/** costIntervals → CSV (가져오기 샘플과 같은 형식) */
export function intervalsToCSV(ivs) {
  return ['LV_MIN,LV_MAX,INIT_COST,STEP', ...ivs.map(iv => `${iv.lvMin},${iv.lvMax ?? ''},${iv.initCost},${iv.step}`)].join('\r\n') + '\r\n';
}
