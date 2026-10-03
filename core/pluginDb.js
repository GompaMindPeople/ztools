'use strict';
// 插件键值存储:按插件 id 命名空间隔离,统一持久化到一个 JSON 文件
const fs = require('fs');
const path = require('path');

class PluginDb {
  constructor(file) {
    this.file = file;
    this.data = {};
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch { /* 首次运行 */ }
  }

  get(pluginId, key) {
    const ns = this.data[pluginId] || {};
    return ns[key];
  }

  set(pluginId, key, value) {
    if (!this.data[pluginId]) this.data[pluginId] = {};
    this.data[pluginId][key] = value;
    this.save();
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[pluginDb] 保存失败', e);
    }
  }
}

module.exports = PluginDb;
