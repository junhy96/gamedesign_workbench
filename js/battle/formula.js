// 안전한 수식 파서 — eval·new Function 없이 직접 해석한다 (순수 계산 모듈, DOM 없음).
// 남이 준 설정 파일의 수식 칸에 코드가 들어 있어도 실행되지 않는다. (Kalivra v1.0.1은 new Function으로 수식을 실행했다)
//
// 문법: 숫자(1, 2.5, 1e3), 이름(atk, a.atk, b.def, lv), 괄호
//       + − * / %  ^ 또는 **(거듭제곱, 오른쪽 결합), 단항 − !
//       비교 < <= > >= == != (=== !== 도 받음), && ||, 삼항 조건 ? 참 : 거짓
//       함수 min max clamp(x, lo, hi) floor ceil round abs sqrt pow log exp — Math.min 처럼 Math. 를 붙여도 됨
// 참·거짓은 1·0. 이름은 허용 목록에 있어야 하고, 아니면 위치와 함께 오류.

export class FormulaError extends Error {
  constructor(message, pos) { super(message); this.name = 'FormulaError'; this.pos = pos; }
}

const FUNCS = {
  min: [1, Infinity, (...a) => Math.min(...a)],
  max: [1, Infinity, (...a) => Math.max(...a)],
  clamp: [3, 3, (x, lo, hi) => Math.min(Math.max(x, lo), hi)],
  floor: [1, 1, Math.floor], ceil: [1, 1, Math.ceil], round: [1, 1, Math.round],
  abs: [1, 1, Math.abs], sqrt: [1, 1, Math.sqrt], pow: [2, 2, Math.pow],
  log: [1, 1, Math.log], exp: [1, 1, Math.exp],
};
export const FUNCTION_NAMES = Object.keys(FUNCS);

const OPS = ['===', '!==', '**', '>=', '<=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '^', '>', '<', '!', '?', ':', '(', ')', ','];
const ID_START = /[A-Za-z_ㄱ-ㆎ가-힣]/;
const ID_PART = /[A-Za-z0-9_ㄱ-ㆎ가-힣]/;

function tokenize(src) {
  if (typeof src !== 'string' || !src.trim()) throw new FormulaError('수식이 비어 있습니다.', 0);
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { out.push({ t: 'num', v: Number(num[0]), pos: i }); i += num[0].length; continue; }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < src.length && (ID_PART.test(src[j]) || (src[j] === '.' && ID_START.test(src[j + 1] ?? '')))) j++;
      out.push({ t: 'id', v: src.slice(i, j), pos: i }); i = j; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (op) { out.push({ t: 'op', v: op, pos: i }); i += op.length; continue; }
    throw new FormulaError(`${i + 1}번째 글자 '${c}'는 쓸 수 없습니다.`, i);
  }
  out.push({ t: 'end', v: '', pos: src.length });
  return out;
}

// ── 파서: 재귀 하강. 우선순위 낮은 것부터 ? : → || → && → 같음 → 비교 → +− → */% → 단항 → 거듭제곱 → 기본 ──
function parseTokens(tokens) {
  let k = 0;
  const peek = () => tokens[k];
  const isOp = (...v) => peek().t === 'op' && v.includes(peek().v);
  const take = () => tokens[k++];
  const expect = (v) => {
    if (!isOp(v)) throw new FormulaError(`${peek().pos + 1}번째 글자에 '${v}'가 필요합니다.`, peek().pos);
    return take();
  };
  const bin = (next, ops) => () => {
    let left = next();
    while (isOp(...ops)) { const o = take(); left = { k: 'bin', op: o.v, l: left, r: next(), pos: o.pos }; }
    return left;
  };
  const primary = () => {
    const tk = peek();
    if (tk.t === 'num') { take(); return { k: 'num', v: tk.v, pos: tk.pos }; }
    if (tk.t === 'id') {
      take();
      const name = tk.v.startsWith('Math.') ? tk.v.slice(5) : tk.v;
      if (isOp('(')) {
        if (!FUNCS[name]) throw new FormulaError(`'${tk.v}' 함수는 없습니다. 쓸 수 있는 함수: ${FUNCTION_NAMES.join(', ')}`, tk.pos);
        take();
        const args = [];
        if (!isOp(')')) { args.push(ternary()); while (isOp(',')) { take(); args.push(ternary()); } }
        expect(')');
        const [lo, hi] = FUNCS[name];
        if (args.length < lo || args.length > hi) throw new FormulaError(`${name}()에는 값이 ${lo === hi ? lo : `${lo}개 이상`}개 필요합니다.`, tk.pos);
        return { k: 'call', f: name, args, pos: tk.pos };
      }
      return { k: 'var', name: tk.v, pos: tk.pos };
    }
    if (isOp('(')) { take(); const e = ternary(); expect(')'); return e; }
    if (tk.t === 'end') throw new FormulaError('수식이 중간에 끝났습니다.', tk.pos);
    throw new FormulaError(`${tk.pos + 1}번째 글자 '${tk.v}'가 이 자리에 올 수 없습니다.`, tk.pos);
  };
  const power = () => {
    const base = primary();
    if (isOp('^', '**')) { const o = take(); return { k: 'bin', op: '^', l: base, r: unary(), pos: o.pos }; }
    return base;
  };
  const unary = () => {
    if (isOp('-', '+', '!')) { const o = take(); return { k: 'un', op: o.v, e: unary(), pos: o.pos }; }
    return power();
  };
  const mul = bin(unary, ['*', '/', '%']);
  const add = bin(mul, ['+', '-']);
  const cmp = bin(add, ['<', '<=', '>', '>=']);
  const eq = bin(cmp, ['==', '!=', '===', '!==']);
  const and = bin(eq, ['&&']);
  const or = bin(and, ['||']);
  function ternary() {
    const c = or();
    if (!isOp('?')) return c;
    take();
    const a = ternary(); expect(':');
    return { k: 'cond', c, a, b: ternary(), pos: c.pos };
  }
  const ast = ternary();
  if (peek().t !== 'end') throw new FormulaError(`${peek().pos + 1}번째 글자 '${peek().v}'부터 해석할 수 없습니다.`, peek().pos);
  return ast;
}

export function parse(src) { return parseTokens(tokenize(src)); }

/** 수식에 나오는 이름 목록 (중복 없이) */
export function names(ast, out = new Set()) {
  if (ast.k === 'var') out.add(ast.name);
  for (const c of [ast.l, ast.r, ast.e, ast.c, ast.a, ast.b, ...(ast.args || [])]) if (c) names(c, out);
  return out;
}

// AST → 클로저. env(name)이 값을 돌려준다.
function build(ast, slot) {
  switch (ast.k) {
    case 'num': { const v = ast.v; return () => v; }
    case 'var': { const i = slot(ast.name); return (env) => env[i]; }
    case 'un': {
      const e = build(ast.e, slot);
      return ast.op === '-' ? (env) => -e(env) : ast.op === '!' ? (env) => (e(env) ? 0 : 1) : e;
    }
    case 'call': { const fs = ast.args.map(a => build(a, slot)); const f = FUNCS[ast.f][2]; return (env) => f(...fs.map(g => g(env))); }
    case 'cond': { const c = build(ast.c, slot), a = build(ast.a, slot), b = build(ast.b, slot); return (env) => (c(env) ? a(env) : b(env)); }
    case 'bin': {
      const l = build(ast.l, slot), r = build(ast.r, slot);
      switch (ast.op) {
        case '+': return (e) => l(e) + r(e);
        case '-': return (e) => l(e) - r(e);
        case '*': return (e) => l(e) * r(e);
        case '/': return (e) => l(e) / r(e);
        case '%': return (e) => l(e) % r(e);
        case '^': return (e) => l(e) ** r(e);
        case '<': return (e) => +(l(e) < r(e));
        case '<=': return (e) => +(l(e) <= r(e));
        case '>': return (e) => +(l(e) > r(e));
        case '>=': return (e) => +(l(e) >= r(e));
        case '==': case '===': return (e) => +(l(e) === r(e));
        case '!=': case '!==': return (e) => +(l(e) !== r(e));
        case '&&': return (e) => (l(e) ? r(e) : 0);
        case '||': return (e) => l(e) || r(e);
      }
    }
  }
  throw new FormulaError('알 수 없는 식입니다.', ast.pos ?? 0);
}

/**
 * 수식 컴파일. allowed = 쓸 수 있는 이름 목록(배열). hint(name) = 이름이 틀렸을 때 덧붙일 안내.
 * 반환 { ok: true, vars: [이름…], eval(values 배열 — vars 순서) } 또는 { ok: false, error, pos }
 */
export function compile(src, allowed, hint) {
  try {
    const ast = parse(src);
    const allow = new Set(allowed);
    for (const n of names(ast)) {
      if (!allow.has(n)) {
        const tip = hint?.(n);
        const pos = findPos(ast, n);
        throw new FormulaError(`${pos + 1}번째 글자: '${n}'은(는) 이 수식에서 쓸 수 없습니다.${tip ? ` ${tip}` : ''}`, pos);
      }
    }
    const vars = [];
    const slot = (name) => { let i = vars.indexOf(name); if (i < 0) { i = vars.length; vars.push(name); } return i; };
    const fn = build(ast, slot);
    return { ok: true, vars, eval: (values) => +fn(values) };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message, pos: e.pos };
    throw e;
  }
}

function findPos(ast, n) {
  if (ast.k === 'var' && ast.name === n) return ast.pos;
  for (const c of [ast.l, ast.r, ast.e, ast.c, ast.a, ast.b, ...(ast.args || [])]) {
    if (c) { const p = findPos(c, n); if (p >= 0) return p; }
  }
  return -1;
}

// ── 코드로 옮기기 (엔진 내보내기) ─────────────────────────
// 같은 AST를 C#(Unity)·C++(Unreal)·JS(테스트 검증용) 식으로. 참·거짓은 이 파서처럼 1·0이 되도록 도우미 함수를 쓴다:
//   B(bool) → 1/0, T(x) → x ≠ 0, And(l, r) = T(l) ? r : 0, Or(l, r) = T(l) ? l : r, Round(x) = floor(x + 0.5) (JS Math.round와 같게 — C#의 Mathf.Round는 짝수 반올림)
const LANGS = {
  cs: { num: (v) => `${fmtNum(v)}f`, fn: { min: 'Mathf.Min', max: 'Mathf.Max', clamp: 'Mathf.Clamp', floor: 'Mathf.Floor', ceil: 'Mathf.Ceil', round: 'Round', abs: 'Mathf.Abs', sqrt: 'Mathf.Sqrt', pow: 'Mathf.Pow', log: 'Mathf.Log', exp: 'Mathf.Exp' }, mod: (l, r) => `(${l} % ${r})`, variadic: true },
  cpp: { num: (v) => `${fmtNum(v)}f`, fn: { min: 'FMath::Min', max: 'FMath::Max', clamp: 'FMath::Clamp', floor: 'FMath::FloorToFloat', ceil: 'FMath::CeilToFloat', round: 'Round', abs: 'FMath::Abs', sqrt: 'FMath::Sqrt', pow: 'FMath::Pow', log: 'FMath::Loge', exp: 'FMath::Exp' }, mod: (l, r) => `FMath::Fmod(${l}, ${r})`, variadic: false },
  js: { num: (v) => fmtNum(v), fn: { min: 'Math.min', max: 'Math.max', clamp: 'clamp', floor: 'Math.floor', ceil: 'Math.ceil', round: 'Round', abs: 'Math.abs', sqrt: 'Math.sqrt', pow: 'Math.pow', log: 'Math.log', exp: 'Math.exp' }, mod: (l, r) => `(${l} % ${r})`, variadic: true },
};
function fmtNum(v) { const s = String(v); return /[.eE]/.test(s) ? s : `${s}.0`; }

/**
 * 수식 → 코드 문자열. varName(name) = 이름을 그 언어의 식으로 (예: 'a.atk' → 'a["atk"]').
 * 반환 { ok, code } 또는 { ok: false, error }
 */
export function toCode(src, lang, varName) {
  const L = LANGS[lang];
  try {
    const ast = parse(src);
    const go = (n) => {
      switch (n.k) {
        case 'num': return L.num(n.v);
        case 'var': return varName(n.name);
        case 'un': return n.op === '-' ? `(-${go(n.e)})` : n.op === '!' ? `B(!T(${go(n.e)}))` : go(n.e);
        case 'call': {
          const f = L.fn[n.f], args = n.args.map(go);
          if ((n.f === 'min' || n.f === 'max') && !L.variadic) return args.reduce((a, b) => `${f}(${a}, ${b})`);
          if ((n.f === 'min' || n.f === 'max') && args.length === 1) return args[0];
          return `${f}(${args.join(', ')})`;
        }
        case 'cond': return `(T(${go(n.c)}) ? ${go(n.a)} : ${go(n.b)})`;
        case 'bin': {
          const l = go(n.l), r = go(n.r);
          switch (n.op) {
            case '^': return `${L.fn.pow}(${l}, ${r})`;
            case '%': return L.mod(l, r);
            case '&&': return `And(${l}, ${r})`;
            case '||': return `Or(${l}, ${r})`;
            case '==': case '===': return `B(${l} == ${r})`;
            case '!=': case '!==': return `B(${l} != ${r})`;
            case '<': case '<=': case '>': case '>=': return `B(${l} ${n.op} ${r})`;
            default: return `(${l} ${n.op} ${r})`;
          }
        }
      }
      throw new FormulaError('알 수 없는 식입니다.', n.pos ?? 0);
    };
    return { ok: true, code: go(ast) };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message };
    throw e;
  }
}
