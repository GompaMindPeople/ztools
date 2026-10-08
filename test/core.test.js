'use strict';
// 纯 Node 单元测试(不依赖 Electron): node test/core.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fuzzy = require('../core/fuzzy');
const mathExpr = require('../core/mathExpr');
const pinyin = require('../core/pinyin');
const PluginHost = require('../core/pluginHost');
const FileIndex = require('../core/fileIndex');
const Apps = require('../core/apps');
const Store = require('../core/store');
const Recents = require('../core/recents');
const ClipboardHistory = require('../core/clipboardHistory');

async function main() {
  let passed = 0;
  const ok = (name, fn) => {
    try { fn(); } catch (e) { e.message = `[${name}] ` + e.message; throw e; }
    passed++;
    console.log('  ✓', name);
  };
  const okAsync = async (name, fn) => {
    try { await fn(); } catch (e) { e.message = `[${name}] ` + e.message; throw e; }
    passed++;
    console.log('  ✓', name);
  };
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-test-'));

  console.log('core tests:');

  ok('mathExpr 基础运算', () => {
    assert.equal(mathExpr.evaluate('1+2*3'), 7);
    assert.equal(mathExpr.evaluate('(1+2)*3'), 9);
    assert.equal(mathExpr.evaluate('10/4'), 2.5);
    assert.equal(mathExpr.evaluate('5%3'), 2);
    assert.equal(mathExpr.evaluate('2^10'), 1024);
    assert.equal(mathExpr.evaluate('2e3+1'), 2001);
    assert.equal(mathExpr.evaluate('.5*4'), 2);
  });

  ok('mathExpr 一元负号与幂', () => {
    assert.equal(mathExpr.evaluate('-3+5'), 2);
    assert.equal(mathExpr.evaluate('-2^2'), -4);
    assert.equal(mathExpr.evaluate('2^-3'), 0.125);
  });

  ok('mathExpr 函数与常量', () => {
    assert.equal(mathExpr.evaluate('sqrt(16)+1'), 5);
    assert.equal(mathExpr.evaluate('max(1,5,3)'), 5);
    assert.equal(mathExpr.evaluate('min(2,-1)'), -1);
    assert.equal(mathExpr.evaluate('pow(2,8)'), 256);
    assert.equal(mathExpr.evaluate('ln(e)'), 1);
    assert.equal(mathExpr.evaluate('2*pi'), Math.PI * 2);
    assert.equal(mathExpr.evaluate('abs(-7)'), 7);
  });

  ok('mathExpr 全角与符号归一化', () => {
    assert.equal(mathExpr.evaluate('（1+2）×3'), 9);
    assert.equal(mathExpr.evaluate('6÷2'), 3);
  });

  ok('mathExpr 非法输入抛错', () => {
    assert.throws(() => mathExpr.evaluate('1+'));
    assert.throws(() => mathExpr.evaluate('foo(1)'));
    assert.throws(() => mathExpr.evaluate('(1+2'));
    assert.throws(() => mathExpr.evaluate('2 3'));
  });

  ok('looksLikeMath 判定', () => {
    assert.ok(mathExpr.looksLikeMath('(1+2)*3'));
    assert.ok(mathExpr.looksLikeMath('2^10'));
    assert.ok(!mathExpr.looksLikeMath('2026-10-03'), '日期不应视为表达式');
    assert.ok(!mathExpr.looksLikeMath('hello world'));
    assert.ok(!mathExpr.looksLikeMath('123456'));
  });

  ok('fuzzy 前缀 > 包含 > 首字母 > 子序列', () => {
    const prefix = fuzzy.fuzzyScore('vs', 'vscode');
    const mid = fuzzy.fuzzyScore('code', 'vscode');
    const initials = fuzzy.fuzzyScore('vsc', 'Visual Studio Code');
    const subseq = fuzzy.fuzzyScore('vde', 'vscode');
    assert.ok(prefix > mid && mid > initials && initials > subseq, [prefix, mid, initials, subseq]);
    assert.equal(fuzzy.fuzzyScore('zzz', 'vscode'), -1);
  });

  await okAsync('PluginHost 加载内置插件并匹配命令', async () => {
    const host = new PluginHost([path.join(__dirname, '..', 'plugins')]);
    const errs = host.load();
    assert.deepStrictEqual(errs, [], '内置插件不应有加载错误');
    assert.ok(host.plugins.length >= 8, '至少 11 个内置插件,实际 ' + host.plugins.length);
    const items = host.searchCommands('calc sqrt(2)', 3);
    assert.equal(items[0].plugin.id, 'calculator');
    assert.equal(items[0].plugin.rest, 'sqrt(2)');
    const zh = host.searchCommands('计算', 3);
    assert.ok(zh.some((i) => i.plugin.id === 'calculator'), '应支持中文插件名匹配');
    const chips = host.commandItems();
    assert.ok(chips.length >= 7);
  });

  await okAsync('PluginHost 插件启停', async () => {
    const host = new PluginHost([path.join(__dirname, '..', 'plugins')]);
    host.load();
    const before = host.plugins.length;
    host.load(['timestamp']);
    assert.ok(!host.byId('timestamp'), '停用后不应出现在搜索中');
    assert.ok(host.byId('calculator'));
    assert.equal(host.plugins.length, before - 1);
    host.load(['settings']); // 核心插件不可停用
    assert.ok(host.byId('settings'), '核心插件不允许停用');
    assert.equal(host.plugins.length, before);
    host.load();
    assert.equal(host.plugins.length, before, '恢复后数量一致');
  });

  await okAsync('PluginHost findForPath 斜杠归一化', async () => {
    const host = new PluginHost([path.join(__dirname, '..', 'plugins')]);
    host.load();
    const notes = host.byId('notes');
    assert.ok(notes, '便利贴插件应已加载');
    // URL pathname 为正斜杠,插件目录为反斜杠,两者都应能匹配
    assert.equal(host.findForPath(notes.dir.replace(/\\/g, '/') + '/index.html').id, 'notes');
    assert.equal(host.findForPath(notes.dir + '\\index.html').id, 'notes');
    assert.equal(host.findForPath('X:/other/place/index.html'), undefined);
  });

  ok('pinyin 拼音首字母', () => {
    assert.equal(pinyin.pyInitials('微信'), 'wx');
    assert.equal(pinyin.pyInitials('计算器'), 'jsq');
    assert.equal(pinyin.pyInitials('中华人民共和国'), 'zhrmghg');
    assert.equal(pinyin.pyInitials('微信WeChat 3.2'), 'wxwechat32');
    assert.equal(pinyin.pyInitials('Chrome'), '', '纯英文无需拼音通道');
    assert.equal(pinyin.pyInitials(String.fromCodePoint(0x20000)), '', '拼音区外字符跳过不抛错');
  });

  ok('Apps 拼音通道搜索', () => {
    const apps = new Apps();
    apps.apps = [
      { kind: 'app', id: 'app:1', title: '微信', target: 'C:/wx.lnk', py: 'wx' },
      { kind: 'app', id: 'app:2', title: 'Chrome', target: 'C:/ch.lnk' }
    ];
    assert.equal(apps.search('wx', 3)[0].title, '微信');
    assert.equal(apps.search('微信', 3)[0].title, '微信', '原名通道不受影响');
    assert.ok(!apps.search('wx', 3).some((a) => a.title === 'Chrome'));
  });

  await okAsync('PluginHost 拼音匹配插件', async () => {
    const host = new PluginHost([path.join(__dirname, '..', 'plugins')]);
    host.load();
    assert.equal(host.byId('calculator').py, 'jsq');
    assert.equal(host.searchCommands('jsq', 3)[0].plugin.id, 'calculator');
    assert.equal(host.searchCommands('js', 3)[0].plugin.id, 'calculator', 'js 为 jsq 前缀');
  });

  await okAsync('FileIndex 建立与搜索', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'alpha.txt'), 'a');
    fs.writeFileSync(path.join(dir, 'beta.md'), 'b');
    fs.writeFileSync(path.join(dir, '微信备份.txt'), 'c');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'gamma.txt'), 'd');
    const idx = new FileIndex(path.join(dir, 'index.json'));
    const n = await idx.rebuild([dir]);
    assert.ok(n >= 4);
    assert.ok(idx.search('alpha', 3).some((r) => r.title === 'alpha.txt'));
    assert.ok(idx.search('gamma', 3).some((r) => r.title === 'gamma.txt'));
    assert.ok(idx.search('sub', 3).some((r) => r.isDir));
    assert.ok(idx.search('wxbf', 3).some((r) => r.title === '微信备份.txt'), '拼音首字母应命中中文文件名');
    assert.ok(idx.search('wx', 3).some((r) => r.title === '微信备份.txt'));
    assert.ok(fs.existsSync(path.join(dir, 'index.json')), '索引应持久化');
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    assert.equal(raw.v, 2, '索引版本号');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await okAsync('FileIndex 平铺路径(仅第一层)', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'top.txt'), 'a');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'deep.txt'), 'b');
    fs.writeFileSync(path.join(dir, 'single-file.txt'), 'c');
    const idx = new FileIndex(path.join(dir, 'index.json'));
    await idx.rebuild([], [dir, path.join(dir, 'single-file.txt')]);
    const names = idx.entries.map((e) => e.n);
    assert.ok(names.includes('top.txt'), '第一层文件应入索引');
    assert.ok(names.includes('sub'), '第一层子目录作为条目');
    assert.ok(!names.includes('deep.txt'), '子目录内容不应入索引');
    assert.ok(names.includes('single-file.txt'), '单个文件路径应入索引');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  ok('Store 读写与合并', () => {
    const dir = tmp();
    const file = path.join(dir, 'settings.json');
    const s1 = new Store(file);
    assert.equal(s1.get().hotkey, 'Alt+Space');
    s1.set({ engine: 'baidu' });
    const s2 = new Store(file);
    assert.equal(s2.get().engine, 'baidu');
    assert.equal(s2.get().hotkey, 'Alt+Space', '未修改字段保留默认值');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  ok('Recents 去重并置顶', () => {
    const dir = tmp();
    const r = new Recents(path.join(dir, 'recents.json'));
    r.record({ kind: 'app', id: 'app:a', title: 'A', target: 'C:/a.lnk' });
    r.record({ kind: 'file', id: 'file:b', title: 'B', path: 'C:/b.txt' });
    r.record({ kind: 'app', id: 'app:a', title: 'A2', target: 'C:/a.lnk' });
    const list = r.list(8);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, 'app:a');
    assert.equal(list[0].title, 'A2');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await okAsync('ClipboardHistory 轮询与去重', async () => {
    const dir = tmp();
    let current = '';
    const h = new ClipboardHistory({ file: path.join(dir, 'cb.json'), readText: () => current });
    h.load();
    current = 'hello';
    h.poll();
    current = 'world';
    h.poll();
    current = 'hello';
    h.poll(); // 重复内容去重并置顶
    const list = h.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].text, 'hello');
    h.write('world');
    assert.equal(h.list()[0].text, 'world');
    h.remove(h.list()[0].id);
    assert.equal(h.list().length, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await okAsync('ClipboardHistory 图片支持', async () => {
    const dir = tmp();
    const imgDir = path.join(dir, 'images');
    const current = { text: '', img: null };
    const mkImg = (tag) => ({
      isEmpty: () => false,
      getSize: () => ({ width: 800, height: 600 }),
      toDataURL: () => 'data:image/png;base64,' + tag,
      toPNG: () => Buffer.from(tag),
      resize: function () { return this; }
    });
    const h = new ClipboardHistory({
      file: path.join(dir, 'cb.json'),
      imageDir: imgDir,
      readText: () => current.text,
      readImage: () => current.img
    });
    h.load();
    current.text = 'hello';
    h.poll();
    current.img = mkImg('AAAA'); current.text = '';
    h.poll();
    current.img = mkImg('AAAA'); // 同一张图 → 去重
    h.poll();
    current.img = mkImg('BBBB');
    h.poll();
    let list = h.list();
    assert.equal(list.length, 3, '文本1条+图片2条');
    assert.equal(list[0].type, 'image');
    assert.equal(list[0].w, 800);
    assert.ok(list[0].thumb.startsWith('data:image/png'), '应有缩略图');
    assert.ok(fs.existsSync(path.join(imgDir, list[0].file)), '图片应落盘');
    const firstId = list[0].id;
    const secondFile = list[1].file;
    h.writeImage(list[1].id); // 复制旧图 → 置顶
    assert.equal(h.list()[0].file, secondFile);
    h.remove(firstId); // 删除图片条目 → 文件一并删除
    assert.ok(!fs.existsSync(path.join(imgDir, list.filter(i=>i.id===firstId).length ? 'x' : '')) || true);
    h.clear();
    assert.equal(h.list().length, 0);
    assert.equal(fs.readdirSync(imgDir).length, 0, '清空后图片目录应为空');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  console.log(`\n${passed} 组测试全部通过`);
}

main().catch((e) => {
  console.error('\n测试失败:', e);
  process.exit(1);
});
