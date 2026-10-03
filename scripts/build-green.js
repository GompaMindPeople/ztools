'use strict';
// 绿色版打包:复制 Electron 运行时 + 应用代码到 dist/,双击 ZTools.exe 即可运行,无需 node/npm。
// 运行: node scripts/build-green.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const out = path.join(root, 'dist');

if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  console.error('未找到 Electron 运行时,请先完成 npm install');
  process.exit(1);
}

// 清理旧产物
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'resources', 'app'), { recursive: true });

// 1. 复制 Electron 运行时,主程序重命名为 ZTools.exe
console.log('复制 Electron 运行时…');
fs.cpSync(electronDist, out, { recursive: true });
fs.renameSync(path.join(out, 'electron.exe'), path.join(out, 'ZTools.exe'));

// 2. 复制应用代码到 resources/app(应用零运行时依赖,不含 node_modules)
console.log('复制应用代码…');
const appDir = path.join(out, 'resources', 'app');
for (const item of ['main.js', 'preload.js', 'pluginPreload.js', 'core', 'src', 'plugins', 'assets']) {
  fs.cpSync(path.join(root, item), path.join(appDir, item), { recursive: true });
}
// package.json 仅保留必要字段;name 必须与开发时一致,保证 userData(设置/索引)延续
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
  name: 'ztools-launcher',
  version: require(path.join(root, 'package.json')).version,
  main: 'main.js',
  description: 'ZTools 快速启动器(绿色版)'
}, null, 2));

console.log('打包完成:', out);
console.log('双击 ZTools.exe 即可运行;调试参数同样可用,如 ZTools.exe --smoke-test');
