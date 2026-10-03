'use strict';
// 拼音首字母:利用 GB2312 一级汉字区(GBK 0xB0A1–0xD7F9)按拼音 a→z 排序的特性,
// 首次使用时用 TextDecoder('gbk') 一次性反查建立「汉字 → 首字母」映射表。
// 零数据文件、零依赖、约 3700 常用字覆盖。
// 局限:多音字取 GBK 排序归属的读音(如"行"→x);GBK 拼音区外的生僻字跳过。

// 拼音字母区起始 GBK 码位(没有 i/u/v)。
// 各分界已用相邻读音锚点字逐一校准:如 祸BBF6(h)|击BBF7(j)、唾CDD9(t)|挖CDDA(w)、
// 误CEF3(w)|昔CEF4(x)、迅D1B8(x)|压D1B9(y)、孕D4D0(y)|匝D4D1(z)。
const LETTER_STARTS = [
  ['a', 0xb0a1], ['b', 0xb0c5], ['c', 0xb2c1], ['d', 0xb4ee], ['e', 0xb6ea],
  ['f', 0xb7a2], ['g', 0xb8c1], ['h', 0xb9fe], ['j', 0xbbf7], ['k', 0xbfa6],
  ['l', 0xc0ac], ['m', 0xc2e8], ['n', 0xc4c3], ['o', 0xc5b6], ['p', 0xc5be],
  ['q', 0xc6da], ['r', 0xc8bb], ['s', 0xc8f6], ['t', 0xcbfa], ['w', 0xcdda],
  ['x', 0xcef4], ['y', 0xd1b9], ['z', 0xd4d1]
];

let table = null; // Map: unicode 码点 -> 首字母;false 表示环境不支持 gbk

function buildTable() {
  const bytes = [];
  for (let lead = 0xb0; lead <= 0xd7; lead++) {
    for (let trail = 0xa1; trail <= 0xfe; trail++) {
      if (lead === 0xd7 && trail > 0xf9) break;
      bytes.push(lead, trail);
    }
  }
  const text = new TextDecoder('gbk').decode(Uint8Array.from(bytes));
  // 区内线性序号 idx = (lead-0xB0)*94 + (trail-0xA1),字母边界换算成 idx 后逐段划分
  const starts = LETTER_STARTS.map(([l, code]) => [l, ((code >> 8) - 0xb0) * 94 + ((code & 0xff) - 0xa1)]);
  const map = new Map();
  let li = 0;
  for (let i = 0; i < text.length; i++) {
    while (li + 1 < starts.length && i >= starts[li + 1][1]) li++;
    const cp = text.charCodeAt(i);
    if (cp >= 0x4e00 && cp <= 0x9fff) map.set(cp, starts[li][0]);
  }
  if (map.size < 3000) throw new Error('gbk 反查表异常: ' + map.size);
  return map;
}

// 返回字符串的拼音首字母串:中文→首字母,英文/数字保留(小写),符号丢弃。
// 不含汉字时返回 ''(此时与原名匹配重复,无需额外通道)。
function pyInitials(str) {
  if (table === null) {
    try {
      table = buildTable();
    } catch (e) {
      table = false;
      console.warn('[pinyin] 初始化失败,已禁用拼音匹配:', e.message);
    }
  }
  if (!table) return '';
  let out = '';
  let hasHan = false;
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x4e00 && cp <= 0x9fff) {
      const l = table.get(cp);
      if (l) { out += l; hasHan = true; }
    } else {
      const low = ch.toLowerCase();
      if ((low >= 'a' && low <= 'z') || (low >= '0' && low <= '9')) out += low;
    }
  }
  return hasHan ? out : '';
}

module.exports = { pyInitials };
