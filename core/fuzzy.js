'use strict';
// 轻量模糊匹配打分:前缀命中 > 单词首字母 > 子序列。分数越高越靠前,不匹配返回 -1。

function initialsOf(t) {
  let s = '';
  for (let i = 0; i < t.length; i++) {
    if (i === 0 || /[\s\-_./\\]/.test(t[i - 1])) s += t[i];
  }
  return s;
}

function fuzzyScore(query, target) {
  if (!query) return 0;
  const q = String(query).toLowerCase();
  const t = String(target).toLowerCase();
  const idx = t.indexOf(q);
  if (idx === 0) return 1000 - Math.min(200, t.length * 0.5);
  if (idx > 0) {
    const boundary = /[\s\-_./\\]/.test(t[idx - 1]) ? 850 : 700;
    return boundary - idx * 2;
  }
  const initials = initialsOf(t);
  const ii = initials.indexOf(q);
  if (ii === 0) return 650 - Math.min(150, t.length * 0.5);
  if (ii > 0) return 500 - ii * 3;
  // 子序列匹配(允许跳跃)
  let ti = 0, prev = -1, score = 400;
  for (let i = 0; i < q.length; i++) {
    ti = t.indexOf(q[i], ti);
    if (ti === -1) return -1;
    if (prev >= 0 && ti === prev + 1) score += 8;
    else score -= Math.min(10, ti - prev - 1);
    prev = ti;
    ti += 1;
  }
  return score - t.length * 0.2;
}

module.exports = { fuzzyScore, initialsOf };
