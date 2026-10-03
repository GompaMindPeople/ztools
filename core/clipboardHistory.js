'use strict';
// 剪贴板历史:主进程轮询,支持文本与图片。
// 文本存 JSON;图片单独存为 PNG 文件(imageDir),JSON 只保留元数据+缩略图,避免历史文件膨胀。
// electron 依赖通过构造注入(readText/readImage 返回 electron 剪贴板对象),便于测试。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ClipboardHistory {
  constructor({ file, imageDir, readText, readImage, max = 200, maxImages = 50 }) {
    this.file = file;
    this.imageDir = imageDir;
    this.readText = readText;
    this.readImage = readImage || (() => null);
    this.max = max;
    this.maxImages = maxImages;
    this.items = [];      // [{id, at, type:'text', text} | {id, at, type:'image', file, thumb, w, h}]
    this._seq = 0;
    this.last = '';       // 上一条文本(去重指针)
    this._imgDigest = ''; // 上一张图片指纹(去重)
    this._timer = null;
    this._saveTimer = null;
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(data)) this.items = data;
    } catch { /* 忽略 */ }
    for (const i of this.items) {
      if (!i.type) i.type = 'text'; // 兼容旧版无 type 字段的文本条目
      if (typeof i.id === 'number' && i.id > this._seq) this._seq = i.id;
    }
    this.last = this.items[0] && this.items[0].type === 'text' ? this.items[0].text : '';
    this._cleanupOrphanImages();
  }

  // 删除没有元数据指向的图片文件
  _cleanupOrphanImages() {
    if (!this.imageDir) return;
    let names = [];
    try { names = fs.readdirSync(this.imageDir); } catch { return; }
    const used = new Set(this.items.filter((i) => i.type === 'image').map((i) => i.file));
    for (const n of names) {
      if (!used.has(n)) { try { fs.unlinkSync(path.join(this.imageDir, n)); } catch { /* 忽略 */ } }
    }
  }

  start(ms = 1000) {
    this.stop();
    this._timer = setInterval(() => this.poll(), ms);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  poll() {
    // 图片优先:截图等场景剪贴板是位图
    let img = null;
    try { img = this.readImage(); } catch { /* 忽略 */ }
    if (img && typeof img.isEmpty === 'function' && !img.isEmpty()) {
      const dataUrl = img.toDataURL();
      const digest = crypto.createHash('md5').update(dataUrl).digest('hex');
      if (digest !== this._imgDigest) {
        this._imgDigest = digest;
        this.last = '';
        const id = ++this._seq;
        const fileName = id + '.png';
        try {
          fs.mkdirSync(this.imageDir, { recursive: true });
          fs.writeFileSync(path.join(this.imageDir, fileName), img.toPNG());
        } catch (e) {
          console.error('[clipboardHistory] 图片保存失败', e);
          return;
        }
        const size = (img.getSize && img.getSize()) || {};
        const thumb = img.resize ? img.resize({ height: 96 }).toDataURL() : dataUrl;
        this.items = this.items.filter((i) => !(i.type === 'image' && i.file === fileName));
        this.items.unshift({ id, type: 'image', file: fileName, thumb, w: size.width || 0, h: size.height || 0, at: Date.now() });
        this._trimImages();
        if (this.items.length > this.max) this.items.length = this.max;
        this.saveSoon();
      }
      return;
    }
    // 文本
    this._imgDigest = '';
    let t;
    try { t = this.readText(); } catch { return; }
    if (!t || t === this.last) return;
    this.last = t;
    this.items = this.items.filter((i) => i.type !== 'text' || i.text !== t);
    this.items.unshift({ id: ++this._seq, type: 'text', text: t, at: Date.now() });
    if (this.items.length > this.max) this.items.length = this.max;
    this.saveSoon();
  }

  _trimImages() {
    const imgs = this.items.filter((i) => i.type === 'image');
    if (imgs.length <= this.maxImages) return;
    const dropFiles = imgs.slice(this.maxImages).map((i) => i.file);
    const drop = new Set(dropFiles);
    this.items = this.items.filter((i) => !(i.type === 'image' && drop.has(i.file)));
    for (const f of dropFiles) this._dropImageFile(f);
  }

  _dropImageFile(fileName) {
    try { fs.unlinkSync(path.join(this.imageDir, fileName)); } catch { /* 忽略 */ }
  }

  imagePath(item) {
    return path.join(this.imageDir, item.file);
  }

  list(n = 100) {
    return this.items.slice(0, n);
  }

  write(text) {
    this.last = text;
    this.items = this.items.filter((i) => i.type !== 'text' || i.text !== text);
    this.items.unshift({ id: ++this._seq, type: 'text', text, at: Date.now() });
    if (this.items.length > this.max) this.items.length = this.max;
    this.saveSoon();
  }

  // 图片条目重新写回剪贴板并置顶;返回条目(调用方负责写剪贴板)
  writeImage(id) {
    const it = this.items.find((i) => i.id === id && i.type === 'image');
    if (!it) return null;
    this.items = this.items.filter((i) => i.id !== id);
    it.at = Date.now();
    this.items.unshift(it);
    this.saveSoon();
    return it;
  }

  find(id) {
    return this.items.find((i) => i.id === id) || null;
  }

  remove(id) {
    const it = this.find(id);
    if (it && it.type === 'image') this._dropImageFile(it.file);
    this.items = this.items.filter((i) => i.id !== id);
    this.saveSoon();
  }

  clear() {
    for (const it of this.items) {
      if (it.type === 'image') this._dropImageFile(it.file);
    }
    this.items = [];
    this.saveSoon();
  }

  saveSoon() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 1500);
  }

  flush() {
    clearTimeout(this._saveTimer);
    this.save();
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.items));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[clipboardHistory] 保存失败', e);
    }
  }
}

module.exports = ClipboardHistory;
