'use strict';
// 文本差异对比:行级 LCS 动态规划 + 相邻删除/新增配对为"修改",并对修改行做字符级差异标注。
// 零依赖;UMD 风格,既能被主进程/测试 require,也能被插件页面以 <script> 引入。

function lcsOps(A, B, eq) {
  // 返回操作序列 [{t:'='|'-'|'+', ai, bi}](基于下标)
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = eq(A[i], B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(A[i], B[j])) { ops.push({ t: '=', ai: i, bi: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: '-', ai: i }); i++; }
    else { ops.push({ t: '+', bi: j }); j++; }
  }
  while (i < n) { ops.push({ t: '-', ai: i }); i++; }
  while (j < m) { ops.push({ t: '+', bi: j }); j++; }
  return ops;
}

// 行级对比:aText/bText → [{t:'='|'-'|'+'|'~', a?, b?, li?, rj?, ha?, hb?}]
// ~ 为修改行:ha/hb 为行内差异 span 列表 [{s, e}](需要高亮的字符区间)
function diffLines(aText, bText, opts = {}) {
  const MAX = (opts && opts.maxLines) || 5000;
  let A = String(aText == null ? '' : aText).split('\n');
  let B = String(bText == null ? '' : bText).split('\n');
  let truncated = false;
  if (A.length > MAX) { A = A.slice(0, MAX); truncated = true; }
  if (B.length > MAX) { B = B.slice(0, MAX); truncated = true; }

  const ops = lcsOps(A, B, (x, y) => x === y);
  const out = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].t === '-' && k + 1 < ops.length && ops[k + 1].t === '+') {
      const a = A[ops[k].ai];
      const b = B[ops[k + 1].bi];
      const pair = charDiff(a, b);
      out.push({ t: '~', a, b, li: ops[k].ai + 1, rj: ops[k + 1].bi + 1, ha: pair[0], hb: pair[1] });
      k++;
    } else if (ops[k].t === '-') {
      out.push({ t: '-', a: A[ops[k].ai], li: ops[k].ai + 1 });
    } else if (ops[k].t === '+') {
      out.push({ t: '+', b: B[ops[k].bi], rj: ops[k].bi + 1 });
    } else {
      out.push({ t: '=', a: A[ops[k].ai], b: B[ops[k].bi], li: ops[k].ai + 1, rj: ops[k].bi + 1 });
    }
  }
  out.truncated = truncated;
  return out;
}

// 字符级差异:返回两个 span 列表(a 中被删区间 / b 中新增区间);超长行退化为整行
function charDiff(a, b) {
  if (a === b) return [[], []];
  if (a.length > 2000 || b.length > 2000) return [[[0, a.length]], [[0, b.length]]];
  // 去掉公共前后缀,缩小 DP 规模
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const midA = a.slice(s, a.length - e);
  const midB = b.slice(s, b.length - e);
  const ops = lcsOps(midA, midB, (x, y) => x === y);
  const ha = [], hb = [];
  for (const op of ops) {
    if (op.t === '-') ha.push([op.ai + s, op.ai + s + 1]);
    else if (op.t === '+') hb.push([op.bi + s, op.bi + s + 1]);
  }
  // 合并相邻区间
  const merge = (spans) => {
    if (!spans.length) return spans;
    spans.sort((x, y) => x[0] - y[0]);
    const r = [spans[0]];
    for (let i = 1; i < spans.length; i++) {
      const last = r[r.length - 1];
      if (spans[i][0] <= last[1]) last[1] = Math.max(last[1], spans[i][1]);
      else r.push(spans[i]);
    }
    return r;
  };
  return [merge(ha), merge(hb)];
}

// 导出为 unified diff 文本(复制结果用)
function toUnifiedText(rows, nameA = 'A', nameB = 'B') {
  const lines = [`--- ${nameA}`, `+++ ${nameB}`];
  for (const r of rows) {
    if (r.t === '=') continue;
    if (r.t === '-' || r.t === '~') lines.push('- ' + r.a);
    if (r.t === '+' || r.t === '~') lines.push('+ ' + r.b);
  }
  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { diffLines, charDiff, toUnifiedText };
}
if (typeof window !== 'undefined') {
  window.zdiff = { diffLines, charDiff, toUnifiedText };
}
