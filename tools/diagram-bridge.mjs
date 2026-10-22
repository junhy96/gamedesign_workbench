#!/usr/bin/env node
// 다이어그램 브리지 — 기획 워크벤치의 '다이어그램' 페이지와 이 PC 의 Claude Code 를 잇는 작은 로컬 서버.
//
// 왜 필요한가: 브라우저 페이지는 PC 에 설치된 Claude Code 나 플러그인을 직접 부를 수 없다. 이 스크립트를 띄워 두면
// 페이지가 http://127.0.0.1:8787 을 호출하고, 여기서 `claude -p` 를 비대화형으로 실행해 diagram-design 스킬
// (https://github.com/cathrynlavery/diagram-design, MIT)로 HTML+SVG 다이어그램을 만들어 돌려준다.
//
// 실행:  node tools/diagram-bridge.mjs            (또는 npm run diagram-bridge)
// 준비:  Claude Code 설치·로그인, 플러그인 설치
//        /plugin marketplace add cathrynlavery/diagram-design
//        /plugin install diagram-design@diagram-design
// 보안:  127.0.0.1 에만 바인딩, 허용 출처(이 사이트·localhost)만 응답. 그리기는 빈 임시 폴더에서 실행된다.
//        비대화형이라 권한 프롬프트를 건너뛰므로(--dangerously-skip-permissions) 신뢰하는 PC 에서만 띄울 것.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, access } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.DIAGRAM_BRIDGE_PORT || 8787);
const VERSION = '1';
const TIMEOUT_MS = Number(process.env.DIAGRAM_BRIDGE_TIMEOUT || 300_000);   // claude 한 번에 최대 5분
const ALLOWED_ORIGINS = [/^https:\/\/junhy96\.github\.io$/, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const CLAUDE = process.platform === 'win32' ? 'claude.cmd' : 'claude';

const allowOrigin = (origin) => !!origin && ALLOWED_ORIGINS.some((re) => re.test(origin));

// 명령은 고정 문자열만 셸에 넘기고(Windows 의 claude.cmd 때문에 shell 필요), 사용자 글은 표준 입력으로 넣는다 — 인용·이스케이프 문제 없음
function run(cmd, args, { cwd, timeout = 20_000, input } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    let child;
    try { child = spawn([cmd, ...args].join(' '), { cwd, shell: true, windowsHide: true }); }
    catch (e) { resolve({ code: -1, out: '', err: String(e) }); return; }
    const timer = setTimeout(() => { if (!done) { done = true; child.kill(); resolve({ code: -2, out, err: err + '\n[timeout]' }); } }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -1, out, err: err + String(e) }); } });
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, out, err }); } });
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

// Claude Code 버전 (없으면 null)
async function claudeVersion() {
  const r = await run(CLAUDE, ['-v']);
  return r.code === 0 ? r.out.trim().split('\n')[0] : null;
}
// 플러그인/스킬 설치 여부: ~/.claude 아래에 diagram-design 폴더가 있는지 (플러그인 캐시·마켓플레이스·사용자 스킬 중 하나)
async function skillInstalled() {
  const roots = [join(homedir(), '.claude', 'plugins'), join(homedir(), '.claude', 'skills')];
  for (const root of roots) {
    try { if (await findDir(root, 'diagram-design', 4)) return true; } catch {}
  }
  return false;
}
async function findDir(dir, name, depth) {
  if (depth < 0) return false;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === name || e.name.startsWith(`${name}@`)) return true;
    if (await findDir(join(dir, e.name), name, depth - 1)) return true;
  }
  return false;
}

// 그리기 프롬프트: 스킬을 쓰고, 질문 없이, 지정 파일명으로 저장하게 한다
function buildPrompt({ prompt, variant, brand, fonts }) {
  const v = { light: 'light', dark: 'dark', editorial: 'full editorial' }[variant] || 'dark';
  return [
    'Use the diagram-design skill to draw one diagram as a single self-contained HTML file with inline SVG.',
    `What to draw: ${prompt.trim()}`,
    `Variant: ${v}.`,
    brand ? `Brand/style guide: ${brand}` : '',
    fonts === 'google' ? '' : 'Use system fonts only (no Google Fonts import, no network requests).',
    'Pick sensible defaults instead of asking questions. Write the file to ./diagram.html in the current working directory, nothing else.',
    'When the file is written, reply with exactly: DONE',
  ].filter(Boolean).join('\n');
}

async function draw(body) {
  const dir = await mkdtemp(join(tmpdir(), 'wb-diagram-'));
  try {
    // 프롬프트(사용자 설명 포함)는 표준 입력으로, 인자는 고정 플래그만
    const args = ['-p', '"Follow the instructions given on standard input."', '--output-format', 'text', '--dangerously-skip-permissions', '--permission-prompts', 'none', '--max-turns', '40', '--no-session-persistence'];
    if (body.model && /^[\w.-]+$/.test(String(body.model))) args.push('--model', String(body.model));
    const r = await run(CLAUDE, args, { cwd: dir, timeout: TIMEOUT_MS, input: buildPrompt(body) });
    // 결과 파일: diagram.html 우선, 없으면 가장 최근 .html
    let file = join(dir, 'diagram.html');
    try { await access(file); } catch {
      const htmls = (await readdir(dir)).filter((f) => /\.html?$/i.test(f));
      if (!htmls.length) return { ok: false, error: r.code === -2 ? '시간 초과(5분)' : 'Claude 가 HTML 파일을 만들지 않았습니다', log: (r.out + '\n' + r.err).slice(-4000) };
      const withTime = await Promise.all(htmls.map(async (f) => [f, (await stat(join(dir, f))).mtimeMs]));
      file = join(dir, withTime.sort((a, b) => b[1] - a[1])[0][0]);
    }
    const html = await readFile(file, 'utf8');
    return { ok: true, html, log: (r.out + '\n' + r.err).slice(-2000) };
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function send(res, status, obj, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (allowOrigin(origin)) { headers['Access-Control-Allow-Origin'] = origin; headers['Vary'] = 'Origin'; }
  res.writeHead(status, headers);
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'OPTIONS') {
    res.writeHead(allowOrigin(origin) ? 204 : 403, allowOrigin(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' } : {});
    res.end(); return;
  }
  if (origin && !allowOrigin(origin)) { send(res, 403, { ok: false, error: 'origin not allowed' }, origin); return; }
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      const [claude, skill] = await Promise.all([claudeVersion(), skillInstalled()]);
      send(res, 200, { ok: true, version: VERSION, claude, skill }, origin); return;
    }
    if (req.method === 'POST' && url.pathname === '/diagram') {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 200_000) { send(res, 413, { ok: false, error: 'too large' }, origin); return; } }
      const body = JSON.parse(raw || '{}');
      if (!body.prompt || !String(body.prompt).trim()) { send(res, 400, { ok: false, error: 'prompt 가 비었습니다' }, origin); return; }
      console.log(`[diagram] ${new Date().toLocaleTimeString()} ${String(body.prompt).slice(0, 60)}…`);
      if (!(await claudeVersion())) { send(res, 503, { ok: false, error: 'Claude Code(claude 명령)를 찾지 못했습니다 — 설치 후 브리지를 다시 켜세요' }, origin); return; }
      const result = await draw(body);
      console.log(`[diagram] ${result.ok ? 'ok' : 'fail: ' + result.error}`);
      send(res, result.ok ? 200 : 500, result, origin); return;
    }
    send(res, 404, { ok: false, error: 'not found' }, origin);
  } catch (e) {
    send(res, 500, { ok: false, error: String(e?.message || e) }, origin);
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  const v = await claudeVersion();
  console.log(`기획 워크벤치 다이어그램 브리지 v${VERSION} — http://127.0.0.1:${PORT}`);
  console.log(v ? `Claude Code: ${v}` : 'Claude Code 를 찾지 못했습니다 — PATH 에 claude 가 있어야 합니다');
  console.log((await skillInstalled()) ? 'diagram-design 플러그인: 설치됨' : 'diagram-design 플러그인: 못 찾음 — Claude Code 에서 /plugin install diagram-design@diagram-design');
  console.log('이 창을 켜 둔 채로 사이트의 다이어그램 페이지를 열면 자동으로 연결됩니다. 끝내려면 Ctrl+C');
});
