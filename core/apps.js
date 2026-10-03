'use strict';
// 已安装应用扫描:开始菜单快捷方式(.lnk)+ 内置系统命令
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { fuzzyScore } = require('./fuzzy');
const { pyInitials } = require('./pinyin');

function systemApps() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return [
    { name: '命令提示符 CMD', target: path.join(root, 'System32', 'cmd.exe') },
    { name: 'PowerShell', target: path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') },
    { name: '任务管理器', target: path.join(root, 'System32', 'taskmgr.exe') },
    { name: '文件资源管理器', target: path.join(root, 'explorer.exe') },
    { name: '控制面板', target: path.join(root, 'System32', 'control.exe') },
    { name: '注册表编辑器', target: path.join(root, 'regedit.exe') }
  ];
}

class Apps {
  constructor() {
    this.apps = [];
  }

  async scan() {
    const found = [];
    const roots = [process.env['ProgramData'], process.env['APPDATA']]
      .filter(Boolean)
      .map((b) => path.join(b, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
      .filter((r) => fs.existsSync(r));
    const stack = roots.map((r) => ({ r, depth: 0 }));
    while (stack.length) {
      const { r, depth } = stack.pop();
      let ds;
      try { ds = await fsp.readdir(r, { withFileTypes: true }); } catch { continue; }
      for (const d of ds) {
        if (d.isDirectory()) {
          if (depth < 5) stack.push({ r: path.join(r, d.name), depth: depth + 1 });
        } else if (d.name.toLowerCase().endsWith('.lnk')) {
          found.push({ name: d.name.replace(/\.lnk$/i, ''), target: path.join(r, d.name) });
        }
      }
    }
    const seen = new Set();
    this.apps = found
      .filter((a) => {
        const k = a.name.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((a) => ({
        kind: 'app',
        id: 'app:' + a.target,
        title: a.name,
        sub: '应用',
        iconPath: a.target,
        target: a.target,
        py: pyInitials(a.name)
      }));
    for (const s of systemApps()) {
      this.apps.push({
        kind: 'app',
        id: 'sys:' + s.target,
        title: s.name,
        sub: '系统命令',
        iconPath: s.target,
        target: s.target,
        system: true,
        py: pyInitials(s.name)
      });
    }
    return this.apps.length;
  }

  search(q, limit = 6) {
    const ql = String(q).toLowerCase();
    const scored = [];
    for (const a of this.apps) {
      // 双通道:原名 / 拼音首字母(如 wx → 微信),取最高分
      let s = fuzzyScore(ql, a.title);
      if (a.py) {
        const sp = fuzzyScore(ql, a.py);
        if (sp > s) s = sp;
      }
      if (s > 0) scored.push({ a, s: s + (a.system ? -50 : 0) });
    }
    scored.sort((x, y) => y.s - x.s || x.a.title.length - y.a.title.length);
    return scored.slice(0, limit).map((x) => x.a);
  }
}

module.exports = Apps;
