'use strict';
// 插件宿主:从内置目录与用户目录加载插件(每个插件是含 plugin.json 的文件夹)。
// plugin.json: { displayName, version, description, main, icon(emoji), commands: [{word, description}] }
const fs = require('fs');
const path = require('path');
const { fuzzyScore } = require('./fuzzy');
const { pyInitials } = require('./pinyin');

// 核心插件不允许停用(否则会失去管理入口)
const CORE_PLUGINS = new Set(['settings', 'plugin-manager']);

class PluginHost {
  constructor(dirs) {
    this.dirs = dirs;       // 插件根目录数组(前者优先)
    this.all = [];          // 全部加载成功的插件
    this.plugins = [];      // 未被停用的插件(参与搜索)
    this.disabled = new Set();
    this.errors = [];
  }

  // disabledIds: 需要停用的插件 id 列表(核心插件除外)
  load(disabledIds) {
    this.disabled = new Set(disabledIds || []);
    this.all = [];
    this.errors = [];
    const seenIds = new Set();
    for (const base of this.dirs) {
      let subs = [];
      try { subs = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
      for (const sub of subs) {
        if (!sub.isDirectory()) continue;
        const dir = path.join(base, sub.name);
        const mf = path.join(dir, 'plugin.json');
        if (!fs.existsSync(mf)) continue;
        try {
          const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
          if (!m.displayName || !m.main) throw new Error('plugin.json 缺少 displayName 或 main');
          const mainPath = path.join(dir, m.main);
          if (!fs.existsSync(mainPath)) throw new Error('main 文件不存在: ' + m.main);
          const id = m.id || sub.name;
          if (seenIds.has(id)) continue; // 用户目录可覆盖同 id 内置插件
          seenIds.add(id);
          const commands = (Array.isArray(m.commands) ? m.commands : [])
            .filter((c) => c && typeof c.word === 'string' && c.word.trim())
            .map((c) => ({ word: c.word.trim().toLowerCase(), description: c.description || '' }));
          this.all.push({
            id,
            dir,
            displayName: m.displayName,
            py: pyInitials(m.displayName),
            version: m.version || '0.0.0',
            description: m.description || '',
            icon: m.icon || '🧩',
            commands,
            mainPath,
            mainUrl: encodeURI('file:///' + mainPath.replace(/\\/g, '/'))
          });
        } catch (e) {
          this.errors.push(`${dir}: ${e.message}`);
        }
      }
    }
    this.plugins = this.all.filter((p) => CORE_PLUGINS.has(p.id) || !this.disabled.has(p.id));
    return this.errors;
  }

  byId(id) {
    return this.plugins.find((p) => p.id === String(id));
  }

  isEnabled(id) {
    return CORE_PLUGINS.has(id) || !this.disabled.has(id);
  }

  // 根据 webview/弹窗页面路径反查插件(用于 API 隔离命名);归一化斜杠后前缀匹配
  findForPath(p) {
    const norm = (s) => String(s).replace(/\//g, '\\').toLowerCase();
    const lp = norm(p);
    return this.plugins.find((pl) => lp.startsWith(norm(pl.dir)));
  }

  buildItem(p, cmd, rest) {
    const sub = rest
      ? `在 ${p.displayName} 中处理 “${rest}”`
      : (cmd ? cmd.description || p.description : p.description);
    return {
      kind: 'plugin',
      id: 'plugin:' + p.id,
      title: cmd ? `${p.displayName} · ${cmd.word}` : p.displayName,
      word: cmd ? cmd.word : '',
      sub: sub || '',
      iconEmoji: p.icon,
      plugin: { id: p.id, rest, mainUrl: p.mainUrl, word: cmd ? cmd.word : '' }
    };
  }

  // 空状态展示的全部命令
  commandItems() {
    const items = [];
    for (const p of this.plugins) {
      if (p.commands.length) for (const c of p.commands) items.push(this.buildItem(p, c, ''));
      else items.push(this.buildItem(p, null, ''));
    }
    return items;
  }

  // 按查询匹配插件命令:精确命令 > "命令 + 参数" > 模糊匹配命令/插件名
  searchCommands(q, limit = 4) {
    const ql = String(q).toLowerCase();
    const res = [];
    for (const p of this.plugins) {
      let best = null;
      for (const c of p.commands) {
        const w = c.word;
        if (ql === w) best = { s: 2000, c, rest: '' };
        else if (ql.startsWith(w + ' ')) best = { s: 1900, c, rest: String(q).slice(w.length + 1) };
        else {
          const s = fuzzyScore(ql, w);
          if (s > 0 && (!best || s > best.s)) best = { s, c, rest: String(q) };
        }
      }
      // 插件中文名双通道:原名(如"计算器")/ 拼音首字母(如 jsq)
      const ds = Math.max(fuzzyScore(ql, p.displayName), p.py ? fuzzyScore(ql, p.py) : -1);
      if (ds > 0 && (!best || ds > best.s)) best = { s: ds, c: null, rest: String(q) };
      if (best) res.push({ p, best });
    }
    res.sort((a, b) => b.best.s - a.best.s);
    return res.slice(0, limit).map((x) => this.buildItem(x.p, x.best.c, x.best.rest));
  }
}

module.exports = PluginHost;
module.exports.CORE_PLUGINS = CORE_PLUGINS;
