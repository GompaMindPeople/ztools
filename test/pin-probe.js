'use strict';
// 置顶窗口探针:验证 alwaysOnTop 小窗 + HTML 文件加载(与 main.js createPinWindow 相同模式)
// 运行: node_modules/.bin/electron test/pin-probe.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(() => {
  const file = path.join(app.getPath('userData'), 'probe-pin.html');
  fs.writeFileSync(file,
    '<!doctype html><meta charset="utf-8"><title>文字置顶</title>' +
    '<body style="margin:0;background:#1d1d27;overflow:auto">' +
    '<div style="padding:16px 18px;color:#ececf4;background:#1d1d27;font:14px/1.7 \'Segoe UI\',\'Microsoft YaHei\',system-ui;white-space:pre-wrap;height:100vh;box-sizing:border-box">📌 置顶验证成功\n这是来自探针的置顶文字小窗,应在所有窗口最上层。</div>');
  const w = new BrowserWindow({
    width: 460, height: 200,
    title: '文字置顶',
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#1d1d27',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  w.loadFile(file);
  console.log('isAlwaysOnTop:', w.isAlwaysOnTop());
  setTimeout(() => { console.log('窗口存活,验证完成'); app.exit(0); }, 15000);
});
