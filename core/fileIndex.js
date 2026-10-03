'use strict';
// 文件索引:后台遍历目录建立文件名索引,支持模糊搜索;索引持久化到磁盘。
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { fuzzyScore } = require('./fuzzy');
const { pyInitials } = require('./pinyin');

const INDEX_VERSION = 2; // 2: 条目增加拼音首字母 y 字段

const MAX_ENTRIES = 200000;
const MAX_DEPTH = 10;
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '$recycle.bin', 'system volume information',
  'appdata', 'windows', 'program files', 'program files (x86)', 'programdata',
  '.cache', '.vscode', '.nuget', '__pycache__', 'site-packages',
  'dist', 'build', '.next', 'target', '.gradle', '.idea'
]);

function mkEntry(name, full, isDir) {
  const y = pyInitials(name);
  return y ? { n: name, p: full, d: isDir, y } : { n: name, p: full, d: isDir };
}

class FileIndex {
  constructor(file) {
    this.file = file;
    this.entries = [];       // { n:文件名, p:完整路径, d:是否目录 }
    this.builtAt = 0;
    this.building = false;
  }

  async load() {
    try {
      const data = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      if (Array.isArray(data.entries)) this.entries = data.entries;
      this.builtAt = data.builtAt || 0;
      this.legacy = data.v !== INDEX_VERSION; // 旧版索引缺拼音字段,需重建
    } catch { /* 首次运行 */ }
  }

  needsBuild() {
    return this.legacy
      || this.entries.length === 0
      || Date.now() - this.builtAt > 7 * 24 * 3600e3;
  }

  async rebuild(dirs, onProgress, isCancelled) {
    this.building = true;
    const entries = [];
    const stack = dirs.map((d) => ({ d, depth: 0 }));
    let cancelled = false;
    while (stack.length) {
      if (isCancelled && isCancelled()) { cancelled = true; break; }
      const { d, depth } = stack.pop();
      let dirents;
      try { dirents = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
      for (const de of dirents) {
        if (de.name.startsWith('.') || de.name.startsWith('$')) continue;
        if (entries.length >= MAX_ENTRIES) break;
        const full = path.join(d, de.name);
        if (de.isDirectory()) {
          if (depth >= MAX_DEPTH || IGNORE_DIRS.has(de.name.toLowerCase())) continue;
          entries.push(mkEntry(de.name, full, 1));
          stack.push({ d: full, depth: depth + 1 });
        } else if (de.isFile()) {
          entries.push(mkEntry(de.name, full, 0));
        }
      }
      if (onProgress && entries.length % 5000 < 100) onProgress(entries.length);
    }
    if (!cancelled) {
      this.entries = entries;
      this.builtAt = Date.now();
      await this.save();
    }
    this.building = false;
    return cancelled ? -1 : entries.length;
  }

  async save() {
    try {
      const tmp = this.file + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify({ v: INDEX_VERSION, entries: this.entries, builtAt: this.builtAt }));
      await fsp.rename(tmp, this.file);
    } catch (e) {
      console.error('[fileIndex] 保存失败', e);
    }
  }

  search(q, limit = 8) {
    const ql = String(q).toLowerCase();
    const scored = [];
    for (const e of this.entries) {
      // 双通道:文件名 / 拼音首字母(如 wxbf → 微信备份.txt),取最高分
      let s = fuzzyScore(ql, e.n);
      if (e.y) {
        const sy = fuzzyScore(ql, e.y);
        if (sy > s) s = sy;
      }
      if (s > 0) scored.push({ e, s: s + (e.d ? 5 : 0) - Math.min(30, e.n.length * 0.3) });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, limit).map((x) => ({
      kind: 'file',
      id: 'file:' + x.e.p,
      title: x.e.n,
      sub: x.e.p,
      path: x.e.p,
      isDir: !!x.e.d,
      iconPath: x.e.p
    }));
  }
}

module.exports = FileIndex;
