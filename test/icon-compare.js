'use strict';
// 验证修复后的图标解析逻辑:对真实 .lnk 解析目标并取图标,导出到桌面
// 运行: node_modules/.bin/electron test/icon-compare.js
const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');

function expandShellPath(s) {
  return String(s || '').replace(/%([^%\\]+)%/g, (_, k) => process.env[k] || '').split(',')[0];
}

app.whenReady().then(async () => {
  const lnks = [
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\微信\\微信.lnk',
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Accessories\\Remote Desktop Connection.lnk'
  ];
  const out = [];
  for (const lnk of lnks) {
    if (!fs.existsSync(lnk)) { console.log('missing:', lnk); continue; }
    const name = path.basename(lnk, '.lnk');
    const candidates = [lnk];
    try {
      const link = shell.readShortcutLink(lnk);
      const iconPath = expandShellPath(link.icon);
      const target = expandShellPath(link.target);
      console.log(name, '| icon:', link.icon, '| target:', link.target);
      if (iconPath && fs.existsSync(iconPath)) candidates.unshift(iconPath);
      else if (target && fs.existsSync(target)) candidates.unshift(target);
    } catch (e) {
      console.log(name, '| readShortcutLink 失败:', e.message);
    }
    const chosen = candidates[0];
    console.log(name, '| 实际取图标路径:', chosen);
    const img = await app.getFileIcon(chosen, { size: 'normal' });
    if (!img.isEmpty()) {
      const url = img.toDataURL();
      console.log(name, '| dataURL 长度:', url.length);
      out.push(['zt2-' + name + '.png', url]);
    }
  }
  for (const [file, url] of out) {
    fs.writeFileSync(path.join('C:\\Users\\Administrator\\Desktop', file), Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log('导出', out.length, '个图标到桌面 zt2-*.png');
  app.exit(0);
});
