'use strict';
// hosts 写入权限探针:读出当前内容→原样写回(不改变任何内容),验证写入链路与 DNS 刷新
// 运行: node_modules/.bin/electron test/hosts-probe.js
const { app } = require('electron');
const fs = require('fs');
const { execFile } = require('child_process');

const HOSTS = 'C:\\Windows\\System32\\drivers\\etc\\hosts';

app.whenReady().then(async () => {
  const before = fs.readFileSync(HOSTS, 'utf8');
  try {
    fs.writeFileSync(HOSTS, before.replace(/\r?\n/g, '\r\n'));
    execFile('ipconfig', ['/flushdns'], () => { });
    const after = fs.readFileSync(HOSTS, 'utf8');
    const same = after.replace(/\r\n/g, '\n') === before.replace(/\r\n/g, '\n');
    console.log('直接写入:', same ? 'OK(内容一致,DNS已刷新)' : '异常:内容不一致!');
  } catch (e) {
    console.log('直接写入失败(需提权):', e.code || e.message);
  }
  app.exit(0);
});
