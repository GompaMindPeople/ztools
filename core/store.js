'use strict';
// 设置持久化(JSON,原子写入)
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  hotkey: 'Alt+Space',      // 全局唤醒快捷键
  engine: 'bing',           // 网页搜索引擎 bing | baidu | google
  hideOnBlur: true,         // 失焦自动隐藏
  notifyEnabled: false,     // 插件系统通知(默认关闭)
  searchDirs: [],           // 递归索引的自定义目录(默认用户目录始终包含)
  flatPaths: [],            // 右键菜单添加的路径:文件夹仅索引第一层,文件仅索引自身
  disabledPlugins: [],      // 已停用的插件 id(核心插件除外)
  pluginHotkeys: {}         // 插件直达热键 { pluginId: 'F1' }
};

class Store {
  constructor(file) {
    this.file = file;
    this.data = { ...DEFAULTS };
    try {
      this.data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch { /* 首次运行或文件损坏,使用默认值 */ }
  }

  get() { return this.data; }

  set(patch) {
    this.data = { ...this.data, ...patch };
    this.save();
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] 保存失败', e);
    }
  }
}

module.exports = Store;
