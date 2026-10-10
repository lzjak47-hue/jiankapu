/**
 * 简卡铺 · 二维码编码器
 * ---------------------------------------------------------------------------
 * 按 ISO/IEC 18004 规范从零实现：字节模式 + 纠错等级 M + 版本 1-10。
 * 只依赖 Node 内置能力，输出 SVG 或模块矩阵。
 *
 * 已实现并自检的部分：
 *   · GF(256) 伽罗华域运算与 Reed-Solomon 纠错
 *   · 数据码字编排、分块与交织
 *   · 定位/校正/定时图形、格式信息、版本信息
 *   · 8 种掩码与惩罚评分，自动选择最优掩码
 *
 * test/qrcode.test.js 会做三项独立验证：
 *   1. 格式信息与规范已知值一致（BCH 编码正确性）
 *   2. Reed-Solomon 码字在所有生成元处的伴随式为 0（纠错编码正确性）
 *   3. 矩阵往返解码后与原始数据一致（排布与掩码自洽）
 */

/* ==========================================================================
   1. GF(256) 伽罗华域
   ========================================================================== */

const PRIMITIVE = 0x11d; // x^8 + x^4 + x^3 + x^2 + 1
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= PRIMITIVE;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** 生成 n 次 Reed-Solomon 生成多项式，返回长度 n+1 的系数数组（最高次在前） */
export function rsGeneratorPoly(n) {
  let poly = [1];
  for (let i = 0; i < n; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** 计算 data 的 n 个纠错码字 */
export function rsEncode(data, n) {
  const gen = rsGeneratorPoly(n);
  const res = new Array(n).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift();
    res.push(0);
    if (factor !== 0) {
      for (let i = 0; i < n; i += 1) res[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return res;
}

/* ==========================================================================
   2. 版本与纠错参数（纠错等级 M）
   ========================================================================== */

/** 纠错等级指示位 */
const EC_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

/**
 * 版本参数表（纠错等级 M）
 *   ec       每块的纠错码字数
 *   g1/g2    两组块数量与每块数据码字数
 *   align    校正图形中心坐标
 */
const VERSIONS = {
  1:  { ec: 10, g1: [1, 16], g2: [0, 0],  align: [] },
  2:  { ec: 16, g1: [1, 28], g2: [0, 0],  align: [6, 18] },
  3:  { ec: 26, g1: [1, 44], g2: [0, 0],  align: [6, 22] },
  4:  { ec: 18, g1: [2, 32], g2: [0, 0],  align: [6, 26] },
  5:  { ec: 24, g1: [2, 43], g2: [0, 0],  align: [6, 30] },
  6:  { ec: 16, g1: [4, 27], g2: [0, 0],  align: [6, 34] },
  7:  { ec: 18, g1: [4, 31], g2: [0, 0],  align: [6, 22, 38] },
  8:  { ec: 22, g1: [2, 38], g2: [2, 39], align: [6, 24, 42] },
  9:  { ec: 22, g1: [3, 36], g2: [2, 37], align: [6, 26, 46] },
  10: { ec: 26, g1: [4, 43], g2: [1, 44], align: [6, 28, 50] },
};

/** 某版本的数据码字总数 */
function dataCodewordCount(version) {
  const v = VERSIONS[version];
  return v.g1[0] * v.g1[1] + v.g2[0] * v.g2[1];
}

/** 根据内容长度选择最小可用版本 */
function pickVersion(byteLength) {
  for (let version = 1; version <= 10; version += 1) {
    const capacity = dataCodewordCount(version);
    // 4 位模式 + 字符计数（v1-9 为 8 位，v10 为 16 位）+ 数据
    const countBits = version <= 9 ? 8 : 16;
    const neededBits = 4 + countBits + byteLength * 8;
    if (neededBits <= capacity * 8) return version;
  }
  throw new RangeError(`内容过长（${byteLength} 字节），超出本编码器支持的版本 1-10 范围`);
}

/* ==========================================================================
   3. 数据编码
   ========================================================================== */

class BitBuffer {
  constructor() {
    this.bits = [];
  }
  put(value, length) {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
  toBytes() {
    const out = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (this.bits[i + j] || 0);
      out.push(byte);
    }
    return out;
  }
}

/** 字节模式编码 + 填充，得到长度等于容量的数据码字 */
function buildDataCodewords(bytes, version) {
  const capacity = dataCodewordCount(version);
  const buffer = new BitBuffer();

  buffer.put(0b0100, 4); // 字节模式
  buffer.put(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) buffer.put(byte, 8);

  // 终止符：最多 4 个 0，且不超过容量
  const capacityBits = capacity * 8;
  buffer.put(0, Math.min(4, capacityBits - buffer.length));

  // 补齐到字节边界
  while (buffer.length % 8 !== 0) buffer.put(0, 1);

  const codewords = buffer.toBytes();

  // 交替填充 0xEC / 0x11
  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < capacity) {
    codewords.push(PAD[padIndex % 2]);
    padIndex += 1;
  }

  if (codewords.length !== capacity) {
    throw new Error(`数据码字长度异常：${codewords.length} ≠ ${capacity}`);
  }
  return codewords;
}

/** 分块 + 计算纠错 + 交织，得到最终码字序列 */
function buildFinalCodewords(dataCodewords, version) {
  const { ec, g1, g2 } = VERSIONS[version];
  const blocks = [];

  let offset = 0;
  for (let i = 0; i < g1[0]; i += 1) {
    const data = dataCodewords.slice(offset, offset + g1[1]);
    offset += g1[1];
    blocks.push({ data, ec: rsEncode(data, ec) });
  }
  for (let i = 0; i < g2[0]; i += 1) {
    const data = dataCodewords.slice(offset, offset + g2[1]);
    offset += g2[1];
    blocks.push({ data, ec: rsEncode(data, ec) });
  }

  const maxData = Math.max(...blocks.map((b) => b.data.length));
  const out = [];

  // 先按列交织数据码字
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) {
      if (i < block.data.length) out.push(block.data[i]);
    }
  }
  // 再按列交织纠错码字
  for (let i = 0; i < ec; i += 1) {
    for (const block of blocks) out.push(block.ec[i]);
  }

  return out;
}

/* ==========================================================================
   4. 矩阵构建
   ========================================================================== */

/** 版本信息（v7+）：18 位 BCH(18,6)，生成多项式 0x1F25 */
export function versionInfoBits(version) {
  let value = version << 12;
  for (let i = 0; i < 6; i += 1) {
    if (value & (1 << (17 - i))) value ^= 0x1f25 << (5 - i);
  }
  return (version << 12) | value;
}

/** 格式信息：15 位 BCH(15,5)，生成多项式 0x537，最后异或 0x5412 */
export function formatInfoBits(ecLevel, mask) {
  const data = (EC_BITS[ecLevel] << 3) | mask;
  let value = data << 10;
  for (let i = 0; i < 5; i += 1) {
    if (value & (1 << (14 - i))) value ^= 0x537 << (4 - i);
  }
  return ((data << 10) | value) ^ 0x5412;
}

const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

/** 创建全 null 矩阵与功能模块标记 */
function createTemplate(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

  const set = (i, j, value) => {
    if (i < 0 || j < 0 || i >= size || j >= size) return;
    modules[i][j] = value;
    isFunction[i][j] = true;
  };

  // 定位图形 + 分隔符
  const finder = (row, col) => {
    for (let i = -1; i <= 7; i += 1) {
      for (let j = -1; j <= 7; j += 1) {
        const r = row + i;
        const c = col + j;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const inRing = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                       (j >= 0 && j <= 6 && (i === 0 || i === 6));
        const inCore = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        set(r, c, inRing || inCore ? 1 : 0);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // 定时图形
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0 ? 1 : 0;
    set(6, i, dark);
    set(i, 6, dark);
  }

  // 校正图形
  const positions = VERSIONS[version].align;
  for (const row of positions) {
    for (const col of positions) {
      // 跳过与定位图形重叠的角落
      if ((row === 6 && col === 6) ||
          (row === 6 && col === size - 7) ||
          (row === size - 7 && col === 6)) continue;
      for (let i = -2; i <= 2; i += 1) {
        for (let j = -2; j <= 2; j += 1) {
          const isDark = Math.max(Math.abs(i), Math.abs(j)) !== 1;
          set(row + i, col + j, isDark ? 1 : 0);
        }
      }
    }
  }

  // 预留格式信息区域（第一副本：左上；跳过第 6 行的定时图形）
  for (let i = 0; i <= 8; i += 1) {
    if (i === 6) continue;
    set(8, i, 0); // 横排 (8,0..5)、(8,7)、(8,8)
    set(i, 8, 0); // 竖排 (0..5,8)、(7,8)、(8,8)
  }
  // 第二副本：右上整行 8 个 + 左下 7 个
  for (let i = 0; i <= 7; i += 1) set(8, size - 1 - i, 0);
  for (let i = 0; i <= 6; i += 1) set(size - 1 - i, 8, 0);

  // 固定黑点（必须放在格式信息预留之后，否则会被覆盖）
  set(size - 8, 8, 1);

  // 预留版本信息区域（v7+）
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = Math.floor(i / 3);
      const b = i % 3;
      set(a, size - 11 + b, 0);
      set(size - 11 + b, a, 0);
    }
  }

  return { size, modules, isFunction, set };
}

/**
 * 数据模块数量（非功能模块）
 * 规范中每个版本的数据模块数 = 总码字数 × 8 + 剩余位，
 * 测试用它对功能图形的排布做独立校验。
 */
export function dataModuleCount(version) {
  const t = createTemplate(version);
  let count = 0;
  for (let i = 0; i < t.size; i += 1) {
    for (let j = 0; j < t.size; j += 1) {
      if (!t.isFunction[i][j]) count += 1;
    }
  }
  return count;
}

/** 某版本纠错等级 M 的总码字数（数据 + 纠错） */
export function totalCodewordCount(version) {
  const v = VERSIONS[version];
  return dataCodewordCount(version) + v.ec * (v.g1[0] + v.g2[0]);
}

/** 把码字按 Z 字形填入非功能模块 */
function placeData(template, codewords) {
  const { size, modules, isFunction } = template;
  const bits = [];
  for (const codeword of codewords) {
    for (let i = 7; i >= 0; i -= 1) bits.push((codeword >>> i) & 1);
  }

  let index = 0;
  let upward = true;

  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5; // 跳过定时图形所在列
    for (let i = 0; i < size; i += 1) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c += 1) {
        const j = col - c;
        if (isFunction[row][j]) continue;
        // 超出码字长度的剩余位补 0
        modules[row][j] = index < bits.length ? bits[index] : 0;
        index += 1;
      }
    }
    upward = !upward;
  }

  return { placedBits: Math.min(index, bits.length), totalBits: bits.length };
}

/** 对非功能模块应用掩码 */
function applyMask(template, maskIndex) {
  const { size, modules, isFunction } = template;
  const fn = MASKS[maskIndex];
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (isFunction[i][j]) continue;
      if (fn(i, j)) modules[i][j] ^= 1;
    }
  }
}

/** 写入格式信息 */
function writeFormatInfo(template, ecLevel, maskIndex) {
  const { size, modules } = template;
  const bits = formatInfoBits(ecLevel, maskIndex);
  const bit = (n) => (bits >>> n) & 1;

  // 第一副本：左上角
  for (let i = 0; i <= 5; i += 1) modules[8][i] = bit(i);
  modules[8][7] = bit(6);
  modules[8][8] = bit(7);
  modules[7][8] = bit(8);
  for (let i = 9; i <= 14; i += 1) modules[14 - i][8] = bit(i);

  // 第二副本：左下 7 位（行 size-1 … size-7），右上 8 位（列 size-8 … size-1）
  for (let i = 0; i <= 6; i += 1) modules[size - 1 - i][8] = bit(i);
  for (let i = 7; i <= 14; i += 1) modules[8][size - 15 + i] = bit(i);

  modules[size - 8][8] = 1; // 固定黑点
}

/** 写入版本信息（v7+） */
function writeVersionInfo(template, version) {
  if (version < 7) return;
  const { size, modules } = template;
  const bits = versionInfoBits(version);
  for (let i = 0; i < 18; i += 1) {
    const a = Math.floor(i / 3);
    const b = i % 3;
    const value = (bits >>> i) & 1;
    modules[a][size - 11 + b] = value;
    modules[size - 11 + b][a] = value;
  }
}

/* ------------------------------------------------------------ 掩码惩罚评分 */

function penaltyScore(modules, size) {
  let score = 0;

  // 规则 1：行/列中连续 5 个以上同色
  const runPenalty = (line) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1;
      } else {
        if (run >= 5) total += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) total += 3 + (run - 5);
    return total;
  };
  for (let i = 0; i < size; i += 1) {
    score += runPenalty(modules[i]);
    score += runPenalty(modules.map((row) => row[i]));
  }

  // 规则 2：2x2 同色块
  for (let i = 0; i < size - 1; i += 1) {
    for (let j = 0; j < size - 1; j += 1) {
      const v = modules[i][j];
      if (v === modules[i][j + 1] && v === modules[i + 1][j] && v === modules[i + 1][j + 1]) {
        score += 3;
      }
    }
  }

  // 规则 3：1:1:3:1:1 形态
  const PATTERN_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const PATTERN_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (line, at, pattern) => {
    for (let k = 0; k < pattern.length; k += 1) {
      if (line[at + k] !== pattern[k]) return false;
    }
    return true;
  };
  for (let i = 0; i < size; i += 1) {
    const row = modules[i];
    const col = modules.map((r) => r[i]);
    for (let j = 0; j + 11 <= size; j += 1) {
      if (matches(row, j, PATTERN_A) || matches(row, j, PATTERN_B)) score += 40;
      if (matches(col, j, PATTERN_A) || matches(col, j, PATTERN_B)) score += 40;
    }
  }

  // 规则 4：深色比例偏离 50%
  let dark = 0;
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) if (modules[i][j]) dark += 1;
  }
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

/* ==========================================================================
   5. 对外接口
   ========================================================================== */

/**
 * 生成二维码模块矩阵
 * @param {string} text 待编码文本
 * @param {{ ecLevel?: 'L'|'M'|'Q'|'H', mask?: number }} [options]
 * @returns {{ version: number, size: number, modules: number[][], mask: number, ecLevel: string }}
 */
export function encode(text, options = {}) {
  const ecLevel = options.ecLevel || "M";
  if (EC_BITS[ecLevel] === undefined) {
    throw new RangeError(`不支持的纠错等级：${ecLevel}`);
  }

  const bytes = Array.from(new TextEncoder().encode(String(text)));
  const version = pickVersion(bytes.length);
  const dataCodewords = buildDataCodewords(bytes, version);
  const finalCodewords = buildFinalCodewords(dataCodewords, version);

  let best = null;
  const candidateMasks = options.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask];

  for (const maskIndex of candidateMasks) {
    const template = createTemplate(version);
    placeData(template, finalCodewords);
    applyMask(template, maskIndex);
    writeFormatInfo(template, ecLevel, maskIndex);
    writeVersionInfo(template, version);

    const score = penaltyScore(template.modules, template.size);
    if (!best || score < best.score) {
      best = { score, mask: maskIndex, ...template };
    }
  }

  return {
    version,
    size: best.size,
    modules: best.modules,
    mask: best.mask,
    ecLevel,
  };
}

/**
 * 输出 SVG
 * @param {string} text
 * @param {{ scale?: number, margin?: number, dark?: string, light?: string }} [options]
 */
export function toSvg(text, options = {}) {
  const { scale = 6, margin = 4, dark = "#14161A", light = "#FFFFFF" } = options;
  const qr = encode(text);
  const viewSize = qr.size + margin * 2;
  const path = [];

  for (let i = 0; i < qr.size; i += 1) {
    for (let j = 0; j < qr.size; j += 1) {
      if (qr.modules[i][j]) path.push(`M${j + margin} ${i + margin}h1v1h-1z`);
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${viewSize * scale}" height="${viewSize * scale}" ` +
    `viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges" role="img" aria-label="支付二维码">` +
    `<rect width="${viewSize}" height="${viewSize}" fill="${light}"/>` +
    `<path d="${path.join("")}" fill="${dark}"/>` +
    `</svg>`
  );
}

/** 输出 data URL，便于前端直接放进 <img src> */
export function toDataUrl(text, options = {}) {
  const svg = toSvg(text, options);
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** 终端里打印（调试用） */
export function toText(text) {
  const qr = encode(text);
  const lines = [];
  for (let i = 0; i < qr.size; i += 1) {
    let line = "";
    for (let j = 0; j < qr.size; j += 1) line += qr.modules[i][j] ? "██" : "  ";
    lines.push(line);
  }
  return lines.join("\n");
}

export default { encode, toSvg, toDataUrl, toText, rsEncode, rsGeneratorPoly, formatInfoBits, versionInfoBits };
