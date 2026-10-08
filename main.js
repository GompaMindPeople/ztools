'use strict';
// ZTools 主进程:全局热键唤起、无边框主窗口、托盘、搜索聚合(应用/文件/插件/内联计算)、插件 API 网关
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const {
  app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain,
  shell, clipboard, dialog, nativeImage, screen, Notification
} = require('electron');
const Store = require('./core/store');
const mathExpr = require('./core/mathExpr');
const PluginHost = require('./core/pluginHost');
const Recents = require('./core/recents');
const FileIndex = require('./core/fileIndex');
const Apps = require('./core/apps');
const ClipboardHistory = require('./core/clipboardHistory');
const PluginDb = require('./core/pluginDb');

const IS_SMOKE = process.argv.includes('--smoke-test');
const ENGINE_NAMES = { bing: '必应', baidu: '百度', google: 'Google' };

// 压制 Chromium 层无害噪音日志(如窗口隐藏/销毁时 blink.mojom.WidgetHost rejected)
app.commandLine.appendSwitch('log-level', '3');

let win = null;
let tray = null;
let store, pluginHost, recents, fileIndex, apps, clipHist, pluginDb;
let activeHotkey = '';
let suppressBlur = false;
let indexBuildToken = 0;
const iconCache = new Map();

const userDataDir = () => app.getPath('userData');
const userPluginsDir = () => path.join(userDataDir(), 'plugins');

// 开机自启的启动参数:开发模式(electron .)需带应用路径,绿色版无参数;读写必须一致
function loginItemArgs() {
  return process.defaultApp ? [app.getAppPath()] : [];
}

// ---------------------------------------------------------------- 窗口

function positionWindow() {
  const cursor = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(cursor).workArea;
  const [w, h] = win.getSize();
  const x = Math.round(wa.x + (wa.width - w) / 2);
  const y = Math.round(wa.y + Math.max(12, wa.height * 0.16));
  win.setPosition(x, y, false);
}

function showWindow() {
  if (!win) return;
  positionWindow();
  if (!win.isVisible()) win.show();
  win.focus();
  win.webContents.send('window:shown');
}

function hideWindow() {
  if (!win) return;
  win.hide();
  win.webContents.send('window:hidden');
}

function toggleWindow() {
  if (win && win.isVisible() && win.isFocused()) hideWindow();
  else showWindow();
}

// ---------------------------------------------------------------- 置顶小窗(插件能力)

const pinnedWindows = new Map(); // id -> { win, file }
let pinSeq = 0;

// 创建一个置顶窗口展示插件提供的 HTML 内容(图片/文字便签等)
function createPinWindow({ title = '置顶', html = '', width = 440, height = 320 } = {}) {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  width = Math.min(Math.max(Math.round(Number(width)) || 440, 180), Math.floor(wa.width * 0.9));
  height = Math.min(Math.max(Math.round(Number(height)) || 320, 100), Math.floor(wa.height * 0.9));
  const safeTitle = String(title).replace(/[<>]/g, '');
  const file = path.join(userDataDir(), `pin-${++pinSeq}.html`);
  try {
    fs.writeFileSync(file,
      `<!doctype html><meta charset="utf-8"><title>${safeTitle}</title>` +
      `<body style="margin:0;background:#1d1d27;overflow:auto">${html}`);
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
  const w = new BrowserWindow({
    width, height,
    title: safeTitle,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#1d1d27',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  w.loadFile(file);
  const id = w.id;
  pinnedWindows.set(id, { win: w, file });
  w.on('closed', () => {
    pinnedWindows.delete(id);
    fs.unlink(file, () => { });
  });
  return { ok: true, id };
}

function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  win = new BrowserWindow({
    width: 800,
    height: 560,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#15151c',
    icon: fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.on('blur', () => {
    if (panelPinned) return; // 置顶期间保持可见,不随失焦隐藏
    if (suppressBlur || !store || store.get().hideOnBlur === false || win.isDevToolsOpened()) return;
    hideWindow();
  });
  win.on('closed', () => { win = null; });
  // 加固 webview:禁用页面内 node 集成
  win.webContents.on('will-attach-webview', (_e, webPreferences) => {
    delete webPreferences.nodeIntegration;
    webPreferences.contextIsolation = true;
  });
  win.webContents.on('did-finish-load', () => {
    sendIndexStatus();
    if (IS_SMOKE) runSmokeTest();
  });
  // 渲染进程日志/异常转发到主进程终端,便于排查
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.warn('[renderer]', message);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] 进程异常退出:', details.reason);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[renderer] 加载失败:', code, desc, url);
  });
}

function createTray() {
  const p = path.join(__dirname, 'assets', 'tray.png');
  if (!fs.existsSync(p)) return;
  tray = new Tray(nativeImage.createFromPath(p));
  tray.setToolTip(`ZTools · ${activeHotkey || 'Alt+Space'} 唤醒`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `显示 / 隐藏(${activeHotkey || 'Alt+Space'})`, click: toggleWindow },
    { label: '打开设置', click: () => { showWindow(); win.webContents.send('open-plugin-by-id', 'settings'); } },
    { label: '重建文件索引', click: () => startIndexBuild(true) },
    { label: '打开用户插件目录', click: () => shell.openPath(userPluginsDir()) },
    { type: 'separator' },
    { label: '退出', click: () => { if (tray) tray.destroy(); app.quit(); } }
  ]));
  tray.on('click', toggleWindow);
}

// ---------------------------------------------------------------- 快捷键

function registerHotkey(hk) {
  hk = String(hk || '').trim();
  if (!hk) return { ok: false, error: '快捷键为空' };
  if (hk === activeHotkey) return { ok: true };
  // 主键必须是 字母/数字/F1-F12/Space/方向键 等,拦截 "Ctrl+" 这类残缺组合
  const main = hk.split('+').pop();
  if (!/^(?:[a-zA-Z0-9]|F\d{1,2}|Space|Tab|CapsLock|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Plus|Minus|Esc)$/.test(main)) {
    return { ok: false, error: `快捷键格式无效: "${hk}"` };
  }
  try {
    // register 失败(非法格式/被其他程序占用)会抛异常,成功时无返回值
    globalShortcut.register(hk, toggleWindow);
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
  // 新键注册成功后再注销旧键,保证任何时刻都有可用快捷键
  if (activeHotkey) {
    try { globalShortcut.unregister(activeHotkey); } catch { /* 忽略 */ }
  }
  activeHotkey = hk;
  if (tray) tray.setToolTip(`ZTools · ${activeHotkey} 唤醒`);
  return { ok: true };
}

// ---------------------------------------------------------------- 插件级全局热键

const pluginHotkeyAccels = new Set(); // 已注册的插件热键

function registerPluginHotkeys() {
  for (const accel of pluginHotkeyAccels) {
    try { globalShortcut.unregister(accel); } catch { /* 忽略 */ }
  }
  pluginHotkeyAccels.clear();
  const errors = [];
  const map = store.get().pluginHotkeys || {};
  for (const [pluginId, accel] of Object.entries(map)) {
    if (!accel) continue;
    const p = pluginHost.byId(pluginId);
    if (!p) continue; // 插件不存在或已停用,跳过
    try {
      globalShortcut.register(accel, () => {
        showWindow();
        win.webContents.send('open-plugin-by-id', pluginId);
      });
      pluginHotkeyAccels.add(accel);
    } catch (e) {
      errors.push(`${p.displayName} 的 ${accel} 注册失败(${e.message})`);
    }
  }
  return errors;
}

// 校验插件热键格式:允许组合键;无修饰时仅 F1-F12/方向键(避免拦截正常打字)
function validPluginHotkey(accel) {
  if (!/^(?:(?:Ctrl|Alt|Shift)\+)*(?:[a-zA-Z0-9]|F\d{1,2}|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Plus|Minus|Esc)$/.test(accel)) {
    return '格式无效';
  }
  const parts = accel.split('+');
  if (parts.length === 1 && !/^(?:F\d{1,2}|Up|Down|Left|Right)$/.test(parts[0])) {
    return '无修饰键时仅支持 F1-F12 或方向键';
  }
  return '';
}

// ---------------------------------------------------------------- 搜索

function buildSearchUrl(engine, q) {
  const enc = encodeURIComponent(q);
  if (engine === 'baidu') return 'https://www.baidu.com/s?wd=' + enc;
  if (engine === 'google') return 'https://www.google.com/search?q=' + enc;
  return 'https://www.bing.com/search?q=' + enc;
}

async function buildSearchResults(raw) {
  const q = String(raw || '').trim();
  if (!q) {
    return {
      empty: true,
      recents: recents.list(8),
      plugins: pluginHost.commandItems(),
      apps: [], files: [], math: null, web: null
    };
  }
  const out = { empty: false, recents: [], apps: [], plugins: [], files: [], math: null, web: null };
  if (mathExpr.looksLikeMath(q)) {
    try {
      const v = mathExpr.evaluate(q);
      if (Number.isFinite(v)) {
        out.math = { kind: 'math', title: mathExpr.format(v), value: mathExpr.format(v), sub: `${q} =` };
      }
    } catch { /* 不是合法表达式,忽略 */ }
  }
  out.apps = apps.search(q, 6);
  out.plugins = pluginHost.searchCommands(q, 4);
  out.files = fileIndex.search(q, 8);
  if (q.length >= 2) {
    const engine = store.get().engine || 'bing';
    out.web = { kind: 'web', id: 'web:' + q, q, engine, title: `使用 ${ENGINE_NAMES[engine] || engine} 搜索 “${q}”`, sub: '在浏览器中打开', iconEmoji: '🔍' };
  }
  return out;
}

// ---------------------------------------------------------------- 文件索引

function resolveSearchDirs() {
  // 默认用户目录始终包含,自定义目录(设置页/右键菜单添加)追加,去重
  const home = os.homedir();
  const defaults = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music',
    'OneDrive\\Desktop', 'OneDrive\\Documents']
    .map((n) => path.join(home, n))
    .filter((d) => fs.existsSync(d));
  const custom = (store.get().searchDirs || []).filter((d) => fs.existsSync(d));
  const seen = new Set();
  return [...defaults, ...custom].filter((d) => {
    const k = d.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function sendIndexStatus() {
  if (!win) return;
  win.webContents.send('index:status', {
    building: fileIndex.building,
    count: fileIndex.entries.length
  });
}

function startIndexBuild(force) {
  if (!fileIndex) return;
  if (fileIndex.building) {
    indexBuildToken++;           // 取消正在进行的构建
    fileIndex.building = false;
  }
  if (!force && !fileIndex.needsBuild()) return;
  const token = ++indexBuildToken;
  fileIndex.rebuild(
    resolveSearchDirs(),
    () => sendIndexStatus(),
    () => token !== indexBuildToken
  ).then(() => sendIndexStatus()).catch((e) => console.error('[index] 构建失败', e));
}

// ---------------------------------------------------------------- 插件启停

function disabledIds() {
  return store.get().disabledPlugins || [];
}

function reloadPlugins() {
  for (const err of pluginHost.load(disabledIds())) console.warn('[plugin]', err);
  registerPluginHotkeys();
}

// ---------------------------------------------------------------- 面板置顶

let panelPinned = false;

function setPanelPinned(pinned, persist = true) {
  panelPinned = !!pinned;
  if (win) {
    // screen-saver 为最高置顶层;置顶期间禁用失焦隐藏,否则"置顶+消失"会互相打架
    win.setAlwaysOnTop(panelPinned, 'screen-saver');
    if (panelPinned) win.show();
  }
  if (persist) store.set({ panelPinned: panelPinned ? 1 : 0 });
  if (win) win.webContents.send('panel:pinned', panelPinned);
}

function showPanelContextMenu() {
  Menu.buildFromTemplate([
    { label: panelPinned ? '📌 取消置顶' : '📌 置顶面板(最高层级)', click: () => setPanelPinned(!panelPinned) },
    { type: 'separator' },
    { label: '隐藏面板', click: () => hideWindow() }
  ]).popup({ window: win });
}

// ---------------------------------------------------------------- 插件弹出窗口(插件多窗口支持)

const pluginWindows = new Set(); // 插件通过 openPluginWindow 打开的独立窗口
let pluginWinSeq = 0;

// 在插件自己的上下文中打开一个独立小窗口(便利贴等多窗口插件的基础)
function openPluginWindowFor(senderWc, opts = {}) {
  const p = pluginHost.findForPath(decodeURIComponent(new URL(senderWc.getURL()).pathname).replace(/^\//, ''));
  if (!p) return { ok: false, error: '无法识别调用方插件' };
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(Math.max(Math.round(Number(opts.width)) || 360, 200), Math.floor(wa.width * 0.9));
  const height = Math.min(Math.max(Math.round(Number(opts.height)) || 360, 140), Math.floor(wa.height * 0.9));
  const n = ++pluginWinSeq;
  const x = opts.x != null ? Number(opts.x) : Math.round(wa.width / 2 - width / 2 + ((n % 8) - 4) * 28);
  const y = opts.y != null ? Number(opts.y) : Math.round(wa.height / 2 - height / 2 + ((n % 8) - 4) * 24);
  const w = new BrowserWindow({
    width, height, x, y,
    frame: opts.frame === undefined ? false : !!opts.frame,
    alwaysOnTop: opts.alwaysOnTop !== false, // 便利贴类窗口默认置顶
    resizable: true,
    skipTaskbar: false,
    backgroundColor: '#fffbe0',
    webPreferences: {
      preload: path.join(__dirname, 'pluginPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const q = String(opts.query || '');
  w.loadURL(p.mainUrl + (p.mainUrl.includes('?') ? '&' : '?') + 'standalone=1&query=' + encodeURIComponent(q));
  pluginWindows.add(w);
  w.on('closed', () => pluginWindows.delete(w));
  return { ok: true, id: w.id };
}

// ---------------------------------------------------------------- 内置 Everything 引擎
// 首次使用自动下载官方便携版(~1.6MB)到 userData,预配置独立端口的 HTTP 服务,后台静默运行。

const EVERYTHING_URL = 'https://www.voidtools.com/Everything-1.4.1.1028.x64.zip';
const EVERYTHING_BUNDLED_PORT = 2146;
let bundledEverythingPid = 0;

function bundledEverythingDir() { return path.join(userDataDir(), 'everything'); }
function bundledEverythingExe() { return path.join(bundledEverythingDir(), 'Everything.exe'); }

async function probeEverything(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/?search=test&json=1&count=0`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch { return false; }
}

function writeBundledIni() {
  const dst = path.join(bundledEverythingDir(), 'Everything.ini');
  // 完整官方模板(已预置 http_server_enabled=1 / port=2146)替换缺失或迷你版 ini
  let need = true;
  try { need = fs.statSync(dst).size < 5000; } catch { /* 不存在 */ }
  if (need) {
    fs.copyFileSync(path.join(__dirname, 'assets', 'Everything.ini'), dst);
  }
  return dst;
}

async function setupBundledEverything() {
  if (fs.existsSync(bundledEverythingExe())) {
    writeBundledIni();
    return { ok: true, already: true };
  }
  const dir = bundledEverythingDir();
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'everything.zip');
  try {
    const res = await fetch(EVERYTHING_URL, { signal: AbortSignal.timeout(300000) });
    if (!res.ok) return { ok: false, error: '下载失败: HTTP ' + res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500000) return { ok: false, error: '下载不完整(' + buf.length + ' 字节)' };
    fs.writeFileSync(zip, buf);
    // Windows 10+ 自带 tar 可解压 zip
    await new Promise((resolve, reject) => {
      execFile('tar', ['-xf', zip, '-C', dir], (e) => (e ? reject(e) : resolve()));
    });
    fs.unlinkSync(zip);
    if (!fs.existsSync(bundledEverythingExe())) return { ok: false, error: '解压后未找到 Everything.exe' };
    // zip 自带的 ini 为默认模板(HTTP 关闭),强制替换为预置模板(http=1/2146)
    fs.copyFileSync(path.join(__dirname, 'assets', 'Everything.ini'), path.join(bundledEverythingDir(), 'Everything.ini'));
    return { ok: true };  } catch (e) {
    const msg = (e && e.message) || String(e);
    return { ok: false, error: '下载/安装失败: ' + msg + '(也可手动下载 ' + EVERYTHING_URL + ' 解压到 ' + dir + ')' };
  }
}

async function startBundledEverything() {
  if (await probeEverything(EVERYTHING_BUNDLED_PORT)) return { ok: true, running: true };
  const exe = bundledEverythingExe();
  if (!fs.existsSync(exe)) return { ok: false, error: '内置引擎未安装' };
  // 拉起 Everything 会弹出其主窗口并抢走焦点,期间禁止主面板因失焦隐藏
  suppressBlur = true;
  try {
    const ini = writeBundledIni();
    // 通过 WMI 创建进程,彻底脱离 Electron 的 job 对象(否则 ZTools 退出会牵连引擎);
    // 注意:-startup 才是合法的后台启动参数,错误参数(如 -hide)会弹"命令行选项"对话框卡死启动
    const q = (s) => String(s).replace(/'/g, "''");
    const ps = `([wmiclass]'Win32_Process').Create('"${q(exe)}" -config "${q(ini)}" -startup','${q(bundledEverythingDir())}')`;
    await new Promise((resolve) => {
      execFile('powershell', ['-NoProfile', '-Command', ps], () => resolve());
    });
    // 首次运行需建立全盘索引,可能超过 1 分钟;期间 HTTP 服务就绪即返回,超时不杀进程(索引继续)
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await probeEverything(EVERYTHING_BUNDLED_PORT)) return { ok: true };
    }
    return { ok: false, error: '引擎正在建立全盘索引,请稍候 1-2 分钟后重新搜索' };
  } catch (e) {
    return { ok: false, error: '启动失败: ' + ((e && e.message) || String(e)) };
  } finally {
    suppressBlur = false;
    // 主面板可能被引擎窗口抢走过焦点,唤回并保持在插件界面
    if (win) showWindow();
  }
}

// ---------------------------------------------------------------- 翻译(多源容错,主进程代理绕开 CORS)

async function translateText(text, to) {
  text = String(text || '').trim();
  if (!text) return { ok: false, error: '请输入要翻译的内容' };
  const hasCJK = /[\u4e00-\u9fff]/.test(text);
  const target = to || (hasCJK ? 'en' : 'zh-CN');
  const fromTo = hasCJK ? '中 → 英' : '英 → 中';

  // 源 1:有道(国内直连快)
  try {
    const url = 'https://fanyi.youdao.com/translate?&doctype=json&type=AUTO&i=' + encodeURIComponent(text);
    const r = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    const d = await r.json();
    if (d && d.errorCode === 0 && Array.isArray(d.translateResult)) {
      const out = d.translateResult.map((seg) => seg.map((x) => x.tgt).join('')).join('\n');
      if (out) return { ok: true, text: out, engine: '有道', direction: fromTo };
    }
  } catch { /* 尝试下一个源 */ }

  // 源 2:谷歌免费接口(需要能访问谷歌网络)
  try {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + encodeURIComponent(target) + '&dt=t&q=' + encodeURIComponent(text);
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    const out = (d && d[0] || []).map((x) => x && x[0]).filter(Boolean).join('');
    if (out) return { ok: true, text: out, engine: 'Google', direction: fromTo };
  } catch { /* 尝试下一个源 */ }

  // 源 3:MyMemory(国外备选)
  try {
    const pair = hasCJK ? 'zh-CN|en' : 'en|zh-CN';
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + pair;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    const out = d && d.responseData && d.responseData.translatedText;
    if (out) return { ok: true, text: out, engine: 'MyMemory', direction: fromTo };
  } catch { /* 全部失败 */ }

  return { ok: false, error: '翻译服务暂不可用(有道 / Google / MyMemory 均失败),请检查网络' };
}

// ---------------------------------------------------------------- 右键菜单"添加到 ZTools 索引"

const CTX_KEYS = [
  'HKCU\\Software\\Classes\\*\\shell\\ZToolsAddIndex',
  'HKCU\\Software\\Classes\\Directory\\shell\\ZToolsAddIndex'
];

function contextMenuCommand() {
  const exe = process.execPath;
  const appPrefix = process.defaultApp ? `"${app.getAppPath()}" ` : '';
  return `"${exe}" ${appPrefix}--add-index "%1"`;
}

function regExec(args) {
  return new Promise((resolve) => {
    execFile('reg', args, { windowsHide: true }, (err) => resolve(!err));
  });
}

async function contextMenuRegister() {
  const cmd = contextMenuCommand();
  for (const key of CTX_KEYS) {
    await regExec(['add', key, '/ve', '/d', '添加到 ZTools 索引', '/f']);
    await regExec(['add', key, '/v', 'Icon', '/d', process.execPath, '/f']);
    await regExec(['add', key + '\\command', '/ve', '/d', cmd, '/f']);
  }
  return { ok: true };
}

async function contextMenuRemove() {
  for (const key of CTX_KEYS) await regExec(['delete', key, '/f']);
  return { ok: true };
}

async function contextMenuStatus() {
  for (const key of CTX_KEYS) {
    const ok = await regExec(['query', key]);
    if (!ok) return false;
  }
  return true;
}

// 把一批路径追加到索引目录(右键菜单/命令行入口),返回新增列表
function addIndexDirs(paths) {
  const cur = store.get().searchDirs || [];
  const curSet = new Set(cur.map((c) => c.toLowerCase()));
  const added = [];
  for (const p of paths) {
    const s = String(p || '').replace(/^"|"$/g, '').trim();
    if (!/^[a-zA-Z]:[\\/]/.test(s)) continue;
    if (!fs.existsSync(s)) continue;
    if (curSet.has(s.toLowerCase())) continue;
    curSet.add(s.toLowerCase());
    added.push(s);
  }
  if (added.length) {
    store.set({ searchDirs: [...cur, ...added] });
    startIndexBuild(true);
  }
  return added;
}

// 从命令行参数提取 --add-index 后的路径列表(支持一次多个)
function parseAddIndexArgv(argv) {
  const i = argv.indexOf('--add-index');
  if (i === -1) return [];
  return argv.slice(i + 1).filter((a) => /^[a-zA-Z]:[\\/]/.test(a));
}

function handleAddIndex(argv) {
  const paths = parseAddIndexArgv(argv);
  if (!paths.length) return false;
  const added = addIndexDirs(paths);
  if (win) {
    showWindow();
    win.webContents.send('index:added', { added, total: paths.length });
  }
  console.log(`[add-index] 请求 ${paths.length} 个,新增 ${added.length} 个`);
  return true;
}

// ---------------------------------------------------------------- 插件身份与 API

function pluginIdFromSender(wc) {
  let u;
  try {
    u = decodeURIComponent(new URL(wc.getURL()).pathname);
  } catch {
    return 'unknown';
  }
  if (process.platform === 'win32') u = u.replace(/^\//, '');
  const p = pluginHost.findForPath(u);
  return p ? p.id : 'unknown';
}

async function pluginApi(event, payload) {
  const { method, args = [] } = payload || {};
  const id = pluginIdFromSender(event.sender);
  switch (method) {
    case 'evalMath': {
      try { return { ok: true, value: mathExpr.evaluate(String(args[0])) }; }
      catch (e) { return { ok: false, error: String(e.message || e) }; }
    }
    case 'copy': clipboard.writeText(String(args[0] ?? '')); return true;
    case 'notify': {
      if (store.get().notifyEnabled !== true) return true; // 默认关闭系统通知,可在设置中开启
      new Notification({ title: String(args[0] ?? 'ZTools'), body: String(args[1] ?? '') }).show();
      return true;
    }
    case 'openPath': return await shell.openPath(String(args[0]));
    case 'openExternal': await shell.openExternal(String(args[0])); return true;
    case 'showItemInFolder': shell.showItemInFolder(String(args[0])); return true;
    case 'hideMainWindow': hideWindow(); return true;
    case 'exitPlugin': if (win) win.webContents.send('plugin:exit'); return true;
    case 'setSubInput': if (win) win.webContents.send('plugin:subinput-opts', { placeholder: String(args[0] ?? '') }); return true;
    case 'dbGet': return pluginDb.get(id, String(args[0]));
    case 'dbSet': pluginDb.set(id, String(args[0]), args[1] ?? null); return true;
    case 'clipboardList': return clipHist.list(100);
    case 'clipboardWrite': {
      const t = String(args[0] ?? '');
      clipboard.writeText(t);       // 真正写系统剪贴板
      clipHist.write(t);            // 同步历史(write 已设置 last,轮询不会重复记录)
      return true;
    }
    case 'clipboardWriteImage': {
      const it = clipHist.writeImage(Number(args[0]));
      if (!it) return { ok: false, error: '图片条目不存在' };
      clipboard.writeImage(nativeImage.createFromPath(clipHist.imagePath(it)));
      return { ok: true };
    }
    case 'clipboardGetImage': {
      const it = clipHist.find(Number(args[0]));
      if (!it || it.type !== 'image') return null;
      const img = nativeImage.createFromPath(clipHist.imagePath(it));
      if (img.isEmpty()) return null;
      const size = img.getSize();
      return { dataUrl: img.toDataURL(), width: size.width, height: size.height };
    }
    case 'clipboardRemove': clipHist.remove(Number(args[0])); return true;
    case 'clipboardClear': clipHist.clear(); return true;
    case 'pluginsSetHotkey': {
      const id = String(args[0]);
      const accel = args[1] ? String(args[1]).trim() : '';
      const p = pluginHost.all.find((x) => x.id === id);
      if (!p) return { ok: false, error: '插件不存在' };
      const map = { ...(store.get().pluginHotkeys || {}) };
      if (!accel) {
        delete map[id];
        store.set({ pluginHotkeys: map });
        registerPluginHotkeys();
        return { ok: true, hotkeys: map };
      }
      const verr = validPluginHotkey(accel);
      if (verr) return { ok: false, error: verr + ': ' + accel };
      if (accel === activeHotkey) return { ok: false, error: `与主唤醒快捷键 ${activeHotkey} 冲突` };
      const owner = Object.entries(map).find(([pid, a]) => a === accel && pid !== id);
      if (owner) {
        const op = pluginHost.all.find((x) => x.id === owner[0]);
        return { ok: false, error: `与「${op ? op.displayName : owner[0]}」的热键冲突` };
      }
      map[id] = accel;
      store.set({ pluginHotkeys: map });
      const errs = registerPluginHotkeys();
      if (errs.length) {
        delete map[id];
        store.set({ pluginHotkeys: map });
        registerPluginHotkeys();
        return { ok: false, error: errs.join('; ') };
      }
      return { ok: true, hotkeys: map };
    }
    case 'openPluginWindow': return openPluginWindowFor(event.sender, args[0] || {});
    case 'closeSelf': {
      const w = BrowserWindow.fromWebContents(event.sender);
      if (w && pluginWindows.has(w)) w.close();
      return true;
    }
    case 'contextMenuRegister': return contextMenuRegister();
    case 'contextMenuRemove': return contextMenuRemove();
    case 'contextMenuStatus': return contextMenuStatus();
    case 'everythingSearch': {
      // 代理请求 Everything 的 HTTP 服务器(绕开 webview 的 CORS 限制)
      const q = String(args[0] || '').trim();
      const port = Number(args[1]) || 2145;
      const auth = args[2] ? String(args[2]) : '';
      if (!q) return { ok: false, error: '请输入搜索词' };
      const url = `http://127.0.0.1:${port}/?search=${encodeURIComponent(q)}&json=1&count=100&size=1&dm=1`;
      const headers = auth ? { Authorization: 'Basic ' + Buffer.from(auth).toString('base64') } : {};
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
        if (!res.ok) return { ok: false, error: 'HTTP ' + res.status + (res.status === 401 ? '(用户名/密码错误)' : '') };
        const data = await res.json();
        return {
          ok: true,
          total: data.totalResults || 0,
          results: (data.results || []).map((r) => ({ type: r.type, name: r.name, path: r.path, size: r.size, dm: r.dm }))
        };
      } catch (e) {
        const msg = String(e && e.message || e);
        return { ok: false, error: msg.includes('timeout') ? '连接超时' : '无法连接:请确认 Everything 正在运行,且已在 选项→HTTP 服务器 中启用(默认端口 ' + port + ')' };
      }
    }
    case 'everythingStatus': {
      return {
        official: await probeEverything(2145),
        bundled: await probeEverything(EVERYTHING_BUNDLED_PORT),
        bundledInstalled: fs.existsSync(bundledEverythingExe())
      };
    }
    case 'everythingSetup': {
      const r = await setupBundledEverything();
      return r;
    }
    case 'everythingStart': {
      const r = await startBundledEverything();
      return r;
    }
    case 'settingsGet': return store.get();
    case 'settingsSet': {
      const patch = args[0] || {};
      if (patch.hotkey && patch.hotkey !== activeHotkey) {
        const r = registerHotkey(patch.hotkey);
        if (!r.ok) {
          return { ok: false, error: `注册失败(${r.error || '快捷键可能被其他程序占用'}),当前仍为 ${activeHotkey}`, hotkey: activeHotkey };
        }
        store.set({ hotkey: activeHotkey });
        return { ok: true, hotkey: activeHotkey };
      }
      delete patch.hotkey;
      store.set(patch);
      if (patch.searchDirs) startIndexBuild(true);
      if (patch.disabledPlugins) reloadPlugins();
      return { ok: true };
    }
    case 'reindex': startIndexBuild(true); return true;
    case 'openPluginsFolder': fs.mkdirSync(userPluginsDir(), { recursive: true }); shell.openPath(userPluginsDir()); return true;
    case 'readClipboardImage': {
      const img = clipboard.readImage();
      if (img.isEmpty()) return null;
      return { dataUrl: img.toDataURL(), width: img.getSize().width, height: img.getSize().height };
    }
    case 'readClipboardText': return clipboard.readText();
    case 'translateText': return translateText(String(args[0] || ''), args[1] ? String(args[1]) : '');
    case 'pinToTop': return createPinWindow(args[0] || {});
    case 'closePin': {
      const p = pinnedWindows.get(Number(args[0]));
      if (p) p.win.close();
      return !!p;
    }
    case 'pluginsList': {
      const hkMap = store.get().pluginHotkeys || {};
      return pluginHost.all.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        version: p.version,
        description: p.description,
        icon: p.icon,
        commands: p.commands,
        dir: p.dir,
        builtin: !p.dir.toLowerCase().startsWith(userPluginsDir().toLowerCase()),
        enabled: pluginHost.isEnabled(p.id),
        hotkey: hkMap[p.id] || ''
      }));
    }
    case 'pluginsRescan': {
      reloadPlugins();
      return { ok: true, active: pluginHost.plugins.length, total: pluginHost.all.length, errors: pluginHost.errors };
    }
    case 'pluginsSetEnabled': {
      const id = String(args[0]);
      const enabled = !!args[1];
      const CORE = require('./core/pluginHost').CORE_PLUGINS;
      if (CORE.has(id)) return { ok: false, error: '核心插件不能停用' };
      const list = new Set(disabledIds());
      if (enabled) list.delete(id); else list.add(id);
      store.set({ disabledPlugins: [...list] });
      reloadPlugins();
      return { ok: true, enabled, active: pluginHost.plugins.length };
    }
    case 'pickFolder': {
      suppressBlur = true;
      try {
        const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
        return r.canceled ? null : r.filePaths[0];
      } finally {
        setTimeout(() => { suppressBlur = false; }, 500);
      }
    }
    case 'getIndexStatus': return { building: fileIndex.building, count: fileIndex.entries.length };
    case 'getHotkey': return activeHotkey;
    case 'getAutoLaunch': return app.getLoginItemSettings({ args: loginItemArgs() }).openAtLogin;
    case 'setAutoLaunch': {
      const on = !!args[0];
      app.setLoginItemSettings({ openAtLogin: on, args: loginItemArgs() });
      // 读取时必须带同样的 args,否则 Electron 按参数匹配注册表会误报 false
      return app.getLoginItemSettings({ args: loginItemArgs() }).openAtLogin;
    }
    default: return { error: 'unknown method: ' + method };
  }
}

// ---------------------------------------------------------------- IPC(主窗口渲染进程)

function registerIpc() {
  ipcMain.handle('search', (_e, q) => buildSearchResults(q));

  ipcMain.handle('execute', (_e, item, opts = {}) => {
    try {
      if (item.kind === 'app') {
        if (opts.reveal) shell.showItemInFolder(item.target);
        else if (item.system) spawn(item.target, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
        else shell.openPath(item.target);
      } else if (item.kind === 'file') {
        if (opts.reveal) shell.showItemInFolder(item.path);
        else shell.openPath(item.path);
      } else if (item.kind === 'web') {
        shell.openExternal(buildSearchUrl(item.engine, item.q));
      }
    } catch (e) {
      console.error('[execute] 执行失败', e);
    }
    hideWindow();
    return true;
  });

  // 展开 %SystemRoot% 之类的环境变量;icon 字段还可能带 ",序号" 后缀
  function expandShellPath(s) {
    return String(s || '').replace(/%([^%\\]+)%/g, (_, k) => process.env[k] || '').split(',')[0];
  }

  ipcMain.handle('get-icon', async (_e, p) => {
    if (!p || typeof p !== 'string') return null;
    if (iconCache.has(p)) return iconCache.get(p);
    // .lnk 直接取图标会得到灰白的通用快捷方式图标,
    // 先用 readShortcutLink 解析出目标(icon 路径优先,exe 兜底)再取真实图标
    const candidates = [p];
    if (p.toLowerCase().endsWith('.lnk')) {
      try {
        const link = shell.readShortcutLink(p);
        const iconPath = expandShellPath(link.icon);
        const target = expandShellPath(link.target);
        if (iconPath && fs.existsSync(iconPath)) candidates.unshift(iconPath);
        else if (target && fs.existsSync(target)) candidates.unshift(target);
      } catch { /* 解析失败(UWP 等)则直接用 .lnk */ }
    }
    for (const cand of candidates) {
      try {
        const img = await app.getFileIcon(cand, { size: 'normal' });
        if (!img.isEmpty()) {
          const url = img.toDataURL();
          iconCache.set(p, url);
          if (iconCache.size > 600) iconCache.delete(iconCache.keys().next().value);
          return url;
        }
      } catch { /* 尝试下一个候选路径 */ }
    }
    return null;
  });

  ipcMain.handle('record-recent', (_e, item) => { recents.record(item); return true; });
  ipcMain.handle('copy-text', (_e, v) => { clipboard.writeText(String(v)); return true; });
  ipcMain.handle('hide-window', () => { hideWindow(); return true; });
  ipcMain.handle('panel-pin', (_e, pinned) => { setPanelPinned(!!pinned); return panelPinned; });
  ipcMain.on('context-menu', () => { if (win) showPanelContextMenu(); });
  ipcMain.handle('find-plugin', (_e, id) => {
    const p = pluginHost.byId(id);
    return p ? pluginHost.buildItem(p, p.commands[0] || null, '') : null;
  });
  ipcMain.handle('devtools', () => { if (win) win.webContents.toggleDevTools(); return true; });

  // 插件(webview)通道
  ipcMain.handle('zplugin:api', (e, payload) => pluginApi(e, payload));
  ipcMain.on('zplugin:subinput', (_e, opts) => {
    if (win) win.webContents.send('plugin:subinput-opts', opts || {});
  });
  ipcMain.on('zplugin:esc', () => { if (win) win.webContents.send('plugin:exit'); });
}

// ---------------------------------------------------------------- 冒烟测试

function runSmokeTest() {
  setTimeout(async () => {
    const parts = [];
    try {
      parts.push(`math=${(() => { try { return mathExpr.evaluate('1+2*3') === 7; } catch { return false; } })()}`);
      parts.push(`plugins=${pluginHost.plugins.length}`);
      parts.push(`pluginErrors=${pluginHost.errors.length}`);
      parts.push(`apps=${apps.apps.length}`);
      const calcPy = pluginHost.byId('calculator');
      parts.push(`pinyin=${!!(calcPy && calcPy.py === 'jsq')}`);
      const res = await buildSearchResults('calc sqrt(2)');
      parts.push(`searchCalc=${res.plugins.length > 0 && !!res.math || res.plugins.length > 0}`);
      const empty = await buildSearchResults('');
      parts.push(`emptyChips=${empty.plugins.length >= 4}`);
      fs.writeFileSync(path.join(process.cwd(), 'smoke-result.txt'), 'SMOKE_OK ' + parts.join(' ') + '\n');
      app.exit(0);
    } catch (e) {
      try {
        fs.writeFileSync(path.join(process.cwd(), 'smoke-result.txt'), 'SMOKE_FAIL ' + (e && e.stack) + '\n');
      } catch { /* ignore */ }
      app.exit(1);
    }
  }, 1200);
}

// ---------------------------------------------------------------- 启动

function bootstrap() {
  // 已运行时再次启动(如资源管理器右键菜单调用),转发参数处理
  app.on('second-instance', (_e, argv) => {
    if (!handleAddIndex(argv)) showWindow();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.ztools.launcher');
    fs.mkdirSync(userPluginsDir(), { recursive: true });

    store = new Store(path.join(userDataDir(), 'settings.json'));
    pluginHost = new PluginHost([path.join(__dirname, 'plugins'), userPluginsDir()]);
    reloadPlugins();
    recents = new Recents(path.join(userDataDir(), 'recents.json'));
    recents.load();
    pluginDb = new PluginDb(path.join(userDataDir(), 'plugin-db.json'));
    fileIndex = new FileIndex(path.join(userDataDir(), 'file-index.json'));
    await fileIndex.load();
    apps = new Apps();
    await apps.scan();
    clipHist = new ClipboardHistory({
      file: path.join(userDataDir(), 'clipboard-history.json'),
      imageDir: path.join(userDataDir(), 'clipboard-images'),
      readText: () => clipboard.readText(),
      readImage: () => clipboard.readImage()
    });
    clipHist.load();
    clipHist.start();

    registerIpc();
    createWindow();
    if (!IS_SMOKE) createTray();
    if (process.argv.includes('--show')) showWindow();
    // 调试:--open-plugin=<id[:参数]> 启动后直接打开指定插件;--search=<q> 自动搜索
    const openArg = process.argv.find((a) => a.startsWith('--open-plugin='));
    const searchArg = process.argv.find((a) => a.startsWith('--search='));
    if ((openArg || searchArg) && win) {
      win.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          showWindow();
          if (openArg) {
            const arg = openArg.slice('--open-plugin='.length);
            const idx = arg.indexOf(':');
            const id = idx === -1 ? arg : arg.slice(0, idx);
            const rest = idx === -1 ? '' : arg.slice(idx + 1);
            const p = pluginHost.byId(id);
            win.webContents.send('open-plugin-by-id', p ? pluginHost.buildItem(p, p.commands[0] || null, rest) : id);
          }
          if (searchArg) win.webContents.send('debug:search', searchArg.slice('--search='.length));
        }, 300);
      });
    }

    let hk = store.get().hotkey || 'Alt+Space';
    if (!registerHotkey(hk).ok) {
      console.warn(`[hotkey] ${hk} 注册失败,回退到 Control+Alt+Space`);
      if (registerHotkey('Control+Alt+Space').ok) {
        store.set({ hotkey: 'Control+Alt+Space' });
      } else {
        console.error('[hotkey] 候选快捷键均注册失败,请到托盘菜单操作');
      }
    }
    for (const err of registerPluginHotkeys()) console.warn('[plugin-hotkey]', err);
    if (store.get().panelPinned) setPanelPinned(true, false); // 恢复上次的置顶状态
    handleAddIndex(process.argv); // 应用未运行时通过右键菜单/命令行启动
    startIndexBuild(false);
  });

  app.on('window-all-closed', () => { /* 常驻托盘 */ });
  app.on('before-quit', () => {
    recents && recents.save();
    clipHist && clipHist.flush();
    // 内置 Everything 引擎保持常驻:强杀会丢失索引数据库,导致下次全盘重建;退出时不清理
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}
