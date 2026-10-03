'use strict';
// 开机自启探针:验证 setLoginItemSettings 读写一致(带相同 args)
// 运行: node_modules/.bin/electron test/autolaunch-probe.js
const { app } = require('electron');
const { execSync } = require('child_process');

const args = [app.getAppPath()];

function regValue() {
  try {
    const out = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"').toString();
    return (out.split('\n').find((l) => /electron|ZTools/i.test(l)) || '').trim();
  } catch (e) {
    return '(读取失败: ' + e.message + ')';
  }
}

app.whenReady().then(() => {
  console.log('开发模式(defaultApp):', process.defaultApp, '| args:', args);

  app.setLoginItemSettings({ openAtLogin: true, args });
  console.log('写入 true → 读(带args):', app.getLoginItemSettings({ args }).openAtLogin, '| 读(不带args):', app.getLoginItemSettings().openAtLogin);
  console.log('注册表:', regValue());

  app.setLoginItemSettings({ openAtLogin: false, args });
  console.log('写入 false → 读(带args):', app.getLoginItemSettings({ args }).openAtLogin);

  // 还原为开启状态由用户在设置页操作,探针结束保持关闭(清理)
  console.log('注册表(清理后):', regValue());
  app.exit(0);
});
