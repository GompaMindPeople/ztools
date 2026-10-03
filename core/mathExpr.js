'use strict';
// 安全的数学表达式求值:词法分析 + 调度场(Shunting-yard)算法,不使用 eval。
// 支持: + - * / % ^ ( ) ,一元负号,常量 pi/e/tau,
// 函数: sin cos tan asin acos atan sqrt cbrt ln log log2 abs ceil floor round exp sign min max pow hypot

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, cbrt: Math.cbrt, ln: Math.log, log: Math.log10, log2: Math.log2,
  abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
  exp: Math.exp, sign: Math.sign,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
  pow: (a, b) => Math.pow(a, b), hypot: (...a) => Math.hypot(...a)
};

const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

const OPS = {
  '+': { p: 1, f: (a, b) => a + b },
  '-': { p: 1, f: (a, b) => a - b },
  '*': { p: 2, f: (a, b) => a * b },
  '/': { p: 2, f: (a, b) => a / b },
  '%': { p: 2, f: (a, b) => a % b },
  '^': { p: 4, right: true, f: (a, b) => Math.pow(a, b) }
};
const UNARY_P = 3;

function normalize(src) {
  return String(src)
    .replace(/[×]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/，/g, ',');
}

function tokenize(src) {
  const s = normalize(src);
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
      if (!m) throw new Error('非法数字: ' + s.slice(i, i + 8));
      tokens.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z_0-9]*/.exec(s.slice(i));
      const name = m[0].toLowerCase();
      i += m[0].length;
      if (!(name in FUNCS) && !(name in CONSTS)) throw new Error('未知标识符: ' + name);
      tokens.push({ t: 'id', v: name });
      continue;
    }
    if ('+-*/%^(),'.includes(c)) { tokens.push({ t: c }); i++; continue; }
    throw new Error('非法字符: ' + c);
  }
  return tokens;
}

function toRPN(tokens) {
  const out = [];
  const stack = []; // {type:'op'|'func'|'paren', ...}
  let last = null;
  const emit = (entry) => {
    if (entry.type === 'op') out.push({ t: 'op', v: entry.sym });
    else if (entry.type === 'func') out.push({ t: 'fn', v: entry.name, args: entry.args || 1 });
    else throw new Error('内部错误');
  };
  const popTop = () => emit(stack.pop());

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'num') {
      out.push(tk);
    } else if (tk.t === 'id') {
      const next = tokens[i + 1];
      if (next && next.t === '(') {
        if (!(tk.v in FUNCS)) throw new Error('不是函数: ' + tk.v);
        stack.push({ type: 'func', name: tk.v, args: 1 });
      } else {
        if (!(tk.v in CONSTS)) throw new Error('函数缺少括号: ' + tk.v);
        out.push({ t: 'num', v: CONSTS[tk.v] });
      }
    } else if (tk.t === '(') {
      stack.push({ type: 'paren' });
    } else if (tk.t === ')') {
      while (stack.length && stack[stack.length - 1].type !== 'paren') popTop();
      if (!stack.length) throw new Error('括号不匹配');
      stack.pop();
      if (stack.length && stack[stack.length - 1].type === 'func') popTop();
    } else if (tk.t === ',') {
      while (stack.length && stack[stack.length - 1].type !== 'paren') popTop();
      const below = stack[stack.length - 2];
      if (!below || stack[stack.length - 1].type !== 'paren' || below.type !== 'func') {
        throw new Error('逗号位置错误');
      }
      below.args++;
    } else {
      // 运算符,处理一元 +/-
      const valueEnded = last && (last.t === 'num' || last.t === 'id' || last.t === ')');
      let sym = tk.t;
      if (sym === '-' && !valueEnded) sym = 'u-';
      else if (sym === '+' && !valueEnded) { last = tk; continue; }
      if (sym !== 'u-') {
        const cur = OPS[sym];
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.type === 'paren') break;
          const topP = top.type === 'func' ? 4 : top.p;
          if (topP > cur.p || (topP === cur.p && !cur.right)) popTop();
          else break;
        }
        stack.push({ type: 'op', sym, p: cur.p });
      } else {
        stack.push({ type: 'op', sym: 'u-', p: UNARY_P });
      }
    }
    last = tk;
  }
  while (stack.length) {
    const top = stack.pop();
    if (top.type === 'paren') throw new Error('括号不匹配');
    emit(top);
  }
  return out;
}

function evalRPN(rpn) {
  const st = [];
  for (const tk of rpn) {
    if (tk.t === 'num') st.push(tk.v);
    else if (tk.t === 'op') {
      if (tk.v === 'u-') {
        if (st.length < 1) throw new Error('表达式不完整');
        st.push(-st.pop());
      } else {
        if (st.length < 2) throw new Error('表达式不完整');
        const b = st.pop(), a = st.pop();
        st.push(OPS[tk.v].f(a, b));
      }
    } else if (tk.t === 'fn') {
      const n = tk.args || 1;
      if (st.length < n) throw new Error('参数不足: ' + tk.v);
      const args = st.splice(st.length - n, n);
      st.push(FUNCS[tk.v](...args));
    }
  }
  if (st.length !== 1) throw new Error('表达式不完整');
  return st[0];
}

function evaluate(expr) {
  const v = evalRPN(toRPN(tokenize(expr)));
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error('结果无效');
  return v;
}

// 判断一段输入是否"长得像"数学表达式(用于搜索框内联计算)
function looksLikeMath(s) {
  const t = String(s).trim();
  if (!/^[-+0-9\s*/().,%^×÷]+$/.test(t)) return false;
  if (!/\d/.test(t)) return false;
  if (!/[-+*/%^×÷]/.test(t)) return false;
  // 排除日期形式 2026-10-03(交给时间戳插件)
  if (/^\d{4}-\d{1,2}(-\d{1,2})?$/.test(t)) return false;
  return true;
}

function format(v) {
  if (!Number.isFinite(v)) return String(v);
  return String(parseFloat(v.toPrecision(12)));
}

module.exports = { evaluate, looksLikeMath, format };
