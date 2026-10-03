'use strict';
// 剪贴板写入探针:验证 writeText 后立即 readText 可读回(Windows 同步性)
// 运行: node_modules/.bin/electron test/clipboard-probe.js
const { app, clipboard } = require('electron');

app.whenReady().then(() => {
  clipboard.writeText('PROBE-300');
  const back = clipboard.readText();
  console.log('readback:', JSON.stringify(back), back === 'PROBE-300' ? 'OK' : 'MISMATCH');
  clipboard.writeText('PROBE-旧数据');
  clipboard.writeText('PROBE-300');
  const back2 = clipboard.readText();
  console.log('overwrite:', back2 === 'PROBE-300' ? 'OK' : 'MISMATCH');
  app.exit(0);
});
