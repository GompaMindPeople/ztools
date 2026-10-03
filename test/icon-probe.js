'use strict';
// 图标探测:node_modules/.bin/electron test/icon-probe.js
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const lnkRoots = [process.env['ProgramData'], process.env['APPDATA']]
    .filter(Boolean)
    .map((b) => path.join(b, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  const lnks = [];
  const walk = (d, depth) => {
    let ds;
    try { ds = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ds) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && depth < 4) walk(full, depth + 1);
      else if (e.name.toLowerCase().endsWith('.lnk')) lnks.push(full);
    }
  };
  lnkRoots.forEach((r) => { if (fs.existsSync(r)) walk(r, 0); });
  console.log('lnk count:', lnks.length);

  const targets = [
    ['lnk#1', lnks[0]],
    ['lnk#2', lnks[1]],
    ['lnk#3', lnks[2]],
    ['exe', path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')],
    ['txt', path.join(process.env.USERPROFILE, 'desktop.ini') || 'C:\\Windows\\win.ini']
  ];
  for (const [name, p] of targets) {
    if (!p) continue;
    try {
      const img = await app.getFileIcon(p, { size: 'normal' });
      console.log(name, '->', JSON.stringify(p),
        'empty:', img.isEmpty(),
        'size:', img.getSize().width + 'x' + img.getSize().height,
        'dataURL len:', img.isEmpty() ? 0 : img.toDataURL().length);
    } catch (e) {
      console.log(name, 'ERROR:', e.message);
    }
  }
  app.exit(0);
});
