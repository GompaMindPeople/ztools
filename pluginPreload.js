'use strict';
// 插件(webview)preload:向插件页面暴露受控的 ztools API
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (method, args) => ipcRenderer.invoke('zplugin:api', { method, args });

const subInputCbs = new Set();
const subEnterCbs = new Set();

ipcRenderer.on('ztools:subinput', (_e, v) => subInputCbs.forEach((f) => f(v)));
ipcRenderer.on('ztools:subenter', () => subEnterCbs.forEach((f) => f()));

// 插件内按 Esc 退出插件(转发到宿主窗口)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.defaultPrevented) ipcRenderer.send('zplugin:esc');
});

contextBridge.exposeInMainWorld('ztools', {
  // 打开插件时携带的查询词,如 "calc 1+2" 中的 "1+2"
  query: new URLSearchParams(location.search).get('query') || '',

  onSubInput(cb) { subInputCbs.add(cb); },
  onSubEnter(cb) { subEnterCbs.add(cb); },

  api: {
    evalMath: (expr) => invoke('evalMath', [expr]),
    copy: (text) => invoke('copy', [text]),
    notify: (title, body) => invoke('notify', [title, body]),
    openPath: (p) => invoke('openPath', [p]),
    openExternal: (u) => invoke('openExternal', [u]),
    showItemInFolder: (p) => invoke('showItemInFolder', [p]),
    hideMainWindow: () => invoke('hideMainWindow', []),
    exitPlugin: () => invoke('exitPlugin', []),
    setSubInput: (placeholder) => invoke('setSubInput', [placeholder]),
    dbGet: (k) => invoke('dbGet', [k]),
    dbSet: (k, v) => invoke('dbSet', [k, v]),
    clipboardList: () => invoke('clipboardList', []),
    clipboardWrite: (t) => invoke('clipboardWrite', [t]),
    clipboardWriteImage: (id) => invoke('clipboardWriteImage', [id]),
    clipboardGetImage: (id) => invoke('clipboardGetImage', [id]),
    clipboardRemove: (at) => invoke('clipboardRemove', [at]),
    clipboardClear: () => invoke('clipboardClear', []),
    settingsGet: () => invoke('settingsGet', []),
    settingsSet: (patch) => invoke('settingsSet', [patch]),
    reindex: () => invoke('reindex', []),
    openPluginsFolder: () => invoke('openPluginsFolder', []),
    pickFolder: () => invoke('pickFolder', []),
    getIndexStatus: () => invoke('getIndexStatus', []),
    getHotkey: () => invoke('getHotkey', []),
    getAutoLaunch: () => invoke('getAutoLaunch', []),
    setAutoLaunch: (on) => invoke('setAutoLaunch', [on]),
    readClipboardImage: () => invoke('readClipboardImage', []),
    readClipboardText: () => invoke('readClipboardText', []),
    translateText: (text, to) => invoke('translateText', [text, to]),
    openPluginWindow: (opts) => invoke('openPluginWindow', [opts]),
    closeSelf: () => invoke('closeSelf', []),
    everythingSearch: (q, port, auth) => invoke('everythingSearch', [q, port, auth]),
    everythingStatus: () => invoke('everythingStatus', []),
    everythingSetup: () => invoke('everythingSetup', []),
    everythingStart: () => invoke('everythingStart', []),
    pinToTop: (opts) => invoke('pinToTop', [opts]),
    closePin: (id) => invoke('closePin', [id]),
    pluginsList: () => invoke('pluginsList', []),
    pluginsRescan: () => invoke('pluginsRescan', []),
    pluginsSetEnabled: (id, enabled) => invoke('pluginsSetEnabled', [id, enabled]),
    pluginsSetHotkey: (id, accel) => invoke('pluginsSetHotkey', [id, accel || ''])
  }
});
