# ZTools

一个类 [uTools](https://u.tools) 的桌面效率启动器:全局热键快速唤醒、应用/文件快速检索、内联计算、剪贴板历史,以及一个可扩展的本地插件平台。

基于 **Electron** 构建,零运行时依赖(除 Electron 本身),所有数据保存在本地 `%APPDATA%/ztools-launcher/`。

## 功能

| 功能 | 说明 |
| --- | --- |
| 快速唤醒 | `Alt+Space` 全局热键显示/隐藏主窗口(被占用时自动回退 `Ctrl+Alt+Space`,可在设置中改);支持开机自启 |
| 快速启动 | 扫描开始菜单快捷方式 + 内置系统命令(CMD、PowerShell、任务管理器等),模糊匹配、回车即启 |
| 文件检索 | 后台索引用户目录(桌面/文档/下载/图片等,可在设置中自定义),文件名模糊搜索 |
| 拼音首字母 | 输入 `wx` 搜到「微信」、`jsq` 进入计算器;应用/文件/插件三通道都支持 |
| 内联计算 | 输入 `(1+2)*3`、`sqrt(2)`、`2^10` 直接显示结果,回车复制 |
| 插件平台 | 本地文件夹式插件,HTML 页面 + 受控 API,支持命令码触发与子输入交互;可在插件管理页启停 |
| 置顶能力 | **右键面板空白处 → 置顶面板**(最高层级,置顶期间不随失焦隐藏,Z 菜单亦可切换);插件可调用 `pinToTop`/`openPluginWindow` 创建置顶内容窗 |
| 剪贴板历史 | 后台轮询记录,`cb` 命令搜索、一键复用;**支持图片**(缩略图预览、置顶查看、复制回剪贴板) |
| 网页搜索 | `s 关键词` 用默认引擎(必应/百度/Google)打开浏览器 |
| 时间戳转换 | `ts` 查看当前时间,输入时间戳/日期互转 |
| 最近使用 | 记录执行过的条目,空态时展示 |

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Alt+Space` | 全局唤起 / 隐藏 |
| `↑` `↓` | 选择结果 |
| `Enter` | 执行(打开应用/文件/进入插件/复制结果) |
| `Ctrl+Enter` 或右键 | 打开文件所在位置 |
| `Tab` | 用首选结果补全输入 |
| `Esc` | 清空输入;再按隐藏窗口;插件内退出插件 |
| `F12` | 打开 DevTools(调试) |

## 运行

```bash
npm install
npm start        # 启动应用
npm test         # 纯 Node 单元测试(核心模块)
npm run smoke    # Electron 冒烟测试,写入 smoke-result.txt 后自动退出
```

### 免安装绿色版

不依赖 node/npm 的独立版本,可拷贝到任意目录(或 U 盘)双击运行:

```bash
node scripts/build-green.js
```

产物在 `dist/`(`ZTools.exe` + 运行时 + `resources/app`),与开发版共享同一份用户数据(设置/索引/插件)。

首次启动会在后台建立文件索引(默认用户目录,约几秒到几十秒),期间右下角会显示进度。

## 内置插件命令

| 命令 | 插件 | 示例 |
| --- | --- | --- |
| `calc` | 计算器 | `calc (1+2)*3`、`calc max(1,5,3)` |
| `cb` | 剪贴板历史 | `cb` 后在子输入框搜索 |
| `ts` | 时间戳转换 | `ts 1730000000`、`ts 2026-10-03 12:00` |
| `s` | 网页搜索 | `s electron 教程` |
| `re` | 正则测试 | JS / PHP(PCRE)双引擎实时匹配高亮、分组捕获、常用模板;无 php.exe 时自动 JS 兼容 |
| `diff` | 文本对比 | 双栏输入,行级 + 字符级差异高亮;交换 A/B、剪贴板填充、复制 unified diff |
| `hosts` | Hosts 管理 | 多份 hosts 方案,一键切换写入系统 hosts(自动刷新 DNS,无权限时 UAC 提权) |
| `json` | JSON 工具 | 格式化/压缩/校验(错误行列定位)/转义;自动读取剪贴板 |
| `fy` | 翻译 | 中英互译自动检测方向;有道 → Google → MyMemory 三源容错 |
| `es` | Everything | `es 关键词` 全盘秒搜;**自带便携版引擎**(首次使用自动下载 ~1.9MB 并后台运行,也可用已装的官方版);点击打开,📂 打开所在位置 |
| `note` | 便利贴 | `note new` 新建;每张便签为独立置顶小窗,可贴满桌面,自动保存 |
| `plugins` | 插件管理 | 查看/启停插件、**设置插件直达热键**(如 F1 直达剪贴板)、打开插件目录 |
| `set` | 设置 | 快捷键/索引目录/搜索引擎等 |

点击左上角 **Z 图标**可打开管理菜单(设置 / 插件管理)。在插件管理中可为任意插件设置**直达热键**(如 F1):按下即唤起主窗口并直接打开该插件;单键仅允许 F1-F12/方向键,组合键需含 Ctrl 或 Alt,自动检测冲突。

直接输入中文插件名(如"计算器"、"剪贴板")或其拼音首字母(如 `jsq` 进计算器、`jtb` 进剪贴板历史)也能匹配到插件。

> 拼音匹配原理:GB2312 一级汉字区按拼音 a→z 排序,启动时用 `TextDecoder('gbk')` 反查建立映射表(`core/pinyin.js`),零数据文件。多音字取主读音(如"行"→x),生僻字自动跳过。

## 插件开发

插件就是一个包含 `plugin.json` 的文件夹,放入 **用户插件目录**(托盘菜单 → 打开用户插件目录,即 `%APPDATA%/ztools-launcher/plugins/`)后重启生效。内置插件在安装目录 `plugins/` 下,可直接作为参考。

### plugin.json

```json
{
  "id": "hello",
  "displayName": "Hello",
  "version": "1.0.0",
  "description": "示例插件",
  "main": "index.html",
  "icon": "👋",
  "commands": [{ "word": "hi", "description": "打个招呼" }]
}
```

- `main` 是插件的入口 HTML 页面,在主窗口的 `<webview>` 中打开;
- 用户输入 `hi xxx` 回车时,`xxx` 会作为 `ztools.query` 传给插件;
- 同 `id` 的用户插件会覆盖内置插件。

### 插件 API(`window.ztools`)

```js
// 打开插件时携带的参数("hi xxx" 中的 "xxx")
ztools.query

// 子输入框(出现在主搜索框下方,类似 uTools)
await ztools.api.setSubInput('请输入…');
ztools.onSubInput((value) => { /* 响应输入 */ });
ztools.onSubEnter(() => { /* 响应回车 */ });

// 常用能力(全部经由主进程执行)
await ztools.api.evalMath('1+2*3');      // { ok, value | error } 安全求值
await ztools.api.copy('text');           // 写剪贴板
await ztools.api.notify('标题', '内容'); // 系统通知
await ztools.api.openExternal('https://…'); // 打开浏览器
await ztools.api.openPath('C:/dir');     // 打开文件/目录
await ztools.api.hideMainWindow();       // 隐藏主窗口
await ztools.api.exitPlugin();           // 退出插件回到搜索
await ztools.api.dbGet('key');           // 插件私有存储(按插件 id 隔离)
await ztools.api.dbSet('key', value);

// 置顶与多窗口能力
await ztools.api.pinToTop({ title, width, height, html }); // → { ok, id } 把 HTML 内容钉在最上层
await ztools.api.closePin(id);
await ztools.api.openPluginWindow({ query, width, height, alwaysOnTop, frame, x, y }); // 插件独立弹窗(便利贴等)
await ztools.api.closeSelf();                              // 弹窗内关闭自己
await ztools.api.readClipboardImage();  // 读取剪贴板图片 → { dataUrl, width, height } | null

// 插件管理
await ztools.api.pluginsList();         // 全部插件及启停状态
await ztools.api.pluginsSetEnabled(id, enabled);
await ztools.api.pluginsRescan();       // 重新扫描插件目录
```

完整 API 见 [`pluginPreload.js`](pluginPreload.js)。

### 安全模型

- 插件页面运行在 `<webview>` 中,禁用 Node 集成、强制 contextIsolation、禁止跳转远程页面;
- 插件只能通过上述白名单 API 与系统交互,键值存储按插件 id 命名空间隔离;
- **插件拥有 copy/notify/openExternal 等能力,只安装可信来源的插件**(与 uTools 早期模型一致)。

## 架构

```
main.js                 主进程:窗口/热键/托盘/IPC/插件 API 网关
preload.js              主窗口桥(白名单 IPC)
pluginPreload.js        插件桥(受控 ztools API)
core/
  fuzzy.js              模糊匹配打分(前缀 > 词首字母 > 子序列)
  mathExpr.js           词法+调度场安全表达式求值(不使用 eval)
  fileIndex.js          文件索引:异步遍历 + 持久化 + 模糊搜索
  apps.js               开始菜单 .lnk 扫描 + 系统命令
  pluginHost.js         插件发现/校验/命令匹配
  clipboardHistory.js   剪贴板轮询记录
  store.js / recents.js / pluginDb.js   持久化
src/                    渲染进程 UI(搜索、结果列表、插件视图)
plugins/                5 个内置插件(计算器/剪贴板历史/时间戳/网页搜索/设置)
scripts/gen-icon.js     纯 Node 生成 PNG 图标(无外部资源)
test/core.test.js       核心模块单元测试
```

## 路线图(未实现)

- 全拼检索(输入 `weixin` 搜微信,需嵌入完整拼音字典或引入 pinyin-pro)
- 剪贴板图片支持、文件内容全文搜索
- 插件市场 / 从 zip 安装
- 文件系统监听增量更新索引(当前为启动时全量重建,7 天过期)
- 打包安装程序(electron-builder)
