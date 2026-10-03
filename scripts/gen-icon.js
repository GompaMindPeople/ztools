'use strict';
// 生成应用图标(渐变圆角 + Z),零外部资源依赖。运行: node scripts/gen-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff | 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function makePng(size, withLetter) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const r = Math.round(size * 0.24);
  const top = [91, 140, 255], bot = [59, 91, 253];
  const put = (x, y, px) => {
    const o = y * (size * 4 + 1) + 1 + x * 4;
    raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2]; raw[o + 3] = px[3];
  };
  const insideRounded = (px, py) => {
    const dx = Math.max(r - px, px - (size - r), 0);
    const dy = Math.max(r - py, py - (size - r), 0);
    return dx * dx + dy * dy <= r * r;
  };
  const isZ = (px, py) => {
    if (!withLetter) return false;
    const m = size * 0.26, w = size - 2 * m, t = Math.max(1.5, size * 0.1);
    if (px < m || px > size - m || py < m || py > size - m) return false;
    const nx = (px - m) / w, ny = (py - m) / w;
    if (ny <= t / w) return true;
    if (ny >= 1 - t / w) return true;
    return Math.abs(nx - (1 - ny)) <= (t / w) / 1.414;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideRounded(x + 0.5, y + 0.5)) { put(x, y, [0, 0, 0, 0]); continue; }
      if (isZ(x, y)) { put(x, y, [255, 255, 255, 255]); continue; }
      const k = y / size;
      put(x, y, [
        Math.round(top[0] + (bot[0] - top[0]) * k),
        Math.round(top[1] + (bot[1] - top[1]) * k),
        Math.round(top[2] + (bot[2] - top[2]) * k),
        255
      ]);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), makePng(64, true));
fs.writeFileSync(path.join(outDir, 'tray.png'), makePng(16, false));
console.log('assets/icon.png (64) 与 assets/tray.png (16) 已生成');
