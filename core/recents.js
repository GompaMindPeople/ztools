'use strict';
// 最近使用记录(用于空状态展示),原子写入
const fs = require('fs');
const path = require('path');

const KINDS = new Set(['app', 'file', 'plugin', 'web']);

class Recents {
  constructor(file) {
    this.file = file;
    this.items = [];
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(data)) this.items = data;
    } catch { /* 忽略 */ }
  }

  record(item) {
    if (!item || !KINDS.has(item.kind)) return;
    const id = item.id || (item.kind + ':' + (item.target || item.path || item.title));
    this.items = this.items.filter((r) => r.id !== id);
    this.items.unshift({
      id,
      kind: item.kind,
      title: item.title || '',
      sub: item.sub || '',
      iconPath: item.iconPath || null,
      iconEmoji: item.iconEmoji || null,
      target: item.target || null,
      path: item.path || null,
      word: item.word || null,
      plugin: item.plugin || null,
      count: 1,
      lastAt: Date.now()
    });
    if (this.items.length > 50) this.items.length = 50;
    this.save();
  }

  // 返回可直接执行的结果条目(去掉统计字段)
  list(n = 8) {
    return this.items.slice(0, n).map(({ count, lastAt, ...payload }) => payload);
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.items));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[recents] 保存失败', e);
    }
  }
}

module.exports = Recents;
