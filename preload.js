'use strict';
// 主窗口 preload:向渲染进程暴露白名单 IPC 桥
// 注意:沙箱模式下 preload 只能 require('electron'),没有 __dirname/path,
// 通过页面 URL(src/index.html)相对解析 pluginPreload.js 的 file:// 地址
const { contextBridge, ipcRenderer } = require('electron');
const pluginPreloadUrl = new URL('../pluginPreload.js', location.href).href;

const INVOKE_ALLOW = ['search', 'execute', 'get-icon', 'record-recent', 'hide-window', 'copy-text', 'find-plugin', 'devtools', 'panel-pin'];
const SEND_ALLOW = ['context-menu'];
const ON_ALLOW = ['window:shown', 'window:hidden', 'plugin:subinput-opts', 'plugin:exit', 'index:status', 'open-plugin-by-id', 'debug:search', 'panel:pinned', 'index:added', 'ctx-menu-status'];

contextBridge.exposeInMainWorld('ztoolsHost', {
  pluginPreloadUrl,
  platform: process.platform,
  invoke(channel, ...args) {
    if (!INVOKE_ALLOW.includes(channel)) throw new Error('channel not allowed: ' + channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  send(channel, ...args) {
    if (!SEND_ALLOW.includes(channel)) throw new Error('channel not allowed: ' + channel);
    ipcRenderer.send(channel, ...args);
  },
  on(channel, cb) {
    if (!ON_ALLOW.includes(channel)) throw new Error('channel not allowed: ' + channel);
    const listener = (_e, ...args) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
