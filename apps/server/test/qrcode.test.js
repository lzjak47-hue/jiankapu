/**
 * 简卡铺 · 二维码编码器测试
 * ---------------------------------------------------------------------------
 * 三项独立验证（期望值全部来自 ISO/IEC 18004 规范本身，而非被测代码）：
 *   1. 格式信息 / 版本信息 与规范已知值一致
 *   2. Reed-Solomon 码字在所有生成元 α^0…α^(n-1) 处的伴随式必须为 0
 *   3. 数据模块数量 = 总码字数 × 8 + 剩余位
 * 另有结构性检查：定位图形、定时图形、固定黑点、格式信息落位、SVG 输出。
 */
import assert from "node:assert/strict";
import {
  encode,
  toSvg,
  toDataUrl,
  toText,
  rsEncode,
  formatInfoBits,
  versionInfoBits,
  dataModuleCount,
  totalCodewordCount,
} from "../src/lib/qrcode.js";

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u001b[32m✓\u001b[0m ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, err });
    console.log(`  \u001b[31m✗\u001b[0m ${name}`);
    console.log(`      ${err.message.split("\n")[0]}`);
  }
}

function section(title) {
  console.log(`\n\u001b[36m${title}\u001b[0m`);
}

/* ==========================================================================
   独立实现的 GF(256)：与被测代码完全不共享
   ========================================================================== */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
/** 多项式求值，coeffs[0] 为最高次项 */
const evalPoly = (coeffs, x) => coeffs.reduce((acc, c) => gfMul(acc, x) ^ c, 0);

console.log("\n\u001b[1m简卡铺 · 二维码编码器测试\u001b[0m");

/* ==========================================================================
   1. 格式信息：规范 Annex C 已知值
   ========================================================================== */
section("格式信息（规范已知值）");

const FORMAT_MASK0 = { L: 0x77c4, M: 0x5412, Q: 0x355f, H: 0x1689 };

test("四种纠错等级在掩码 0 时与规范一致", () => {
  for (const [level, expected] of Object.entries(FORMAT_MASK0)) {
    assert.equal(
      formatInfoBits(level, 0),
      expected,
      `${level} / mask0 期望 0x${expected.toString(16)}，实际 0x${formatInfoBits(level, 0).toString(16)}`
    );
  }
});

test("格式信息为 15 位且高位为 0", () => {
  for (const level of ["L", "M", "Q", "H"]) {
    for (let mask = 0; mask < 8; mask += 1) {
      const bits = formatInfoBits(level, mask);
      assert.ok(bits >= 0 && bits < 1 << 15, "应落在 15 位范围内");
    }
  }
});

test("格式信息异或 0x5412 后是合法 BCH(15,5) 码字", () => {
  for (const level of ["L", "M", "Q", "H"]) {
    for (let mask = 0; mask < 8; mask += 1) {
      const codeword = formatInfoBits(level, mask) ^ 0x5412;
      // BCH(15,5) 生成多项式 0x537：码字模生成多项式应为 0
      let remainder = codeword;
      for (let bit = 14; bit >= 10; bit -= 1) {
        if (remainder & (1 << bit)) remainder ^= 0x537 << (bit - 10);
      }
      assert.equal(remainder, 0, `${level}/${mask} BCH 余数应为 0，实际 ${remainder}`);
    }
  }
});

/* ==========================================================================
   2. 版本信息：规范 Annex D 已知值
   ========================================================================== */
section("版本信息（规范已知值）");

const VERSION_BITS = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

test("版本 7-10 的 18 位编码与规范一致", () => {
  for (const [version, expected] of Object.entries(VERSION_BITS)) {
    assert.equal(
      versionInfoBits(Number(version)),
      expected,
      `v${version} 期望 0x${expected.toString(16)}，实际 0x${versionInfoBits(Number(version)).toString(16)}`
    );
  }
});

/* ==========================================================================
   3. Reed-Solomon 伴随式
   ========================================================================== */
section("Reed-Solomon 纠错");

test("各纠错长度下的伴随式全为 0", () => {
  for (const ecLen of [7, 10, 13, 16, 18, 22, 24, 26, 28, 30]) {
    for (let round = 0; round < 4; round += 1) {
      const data = Array.from({ length: 30 }, () => Math.floor(Math.random() * 256));
      const ec = rsEncode(data, ecLen);
      assert.equal(ec.length, ecLen, "纠错码字数量应正确");
      const codeword = [...data, ...ec];
      for (let i = 0; i < ecLen; i += 1) {
        const s = evalPoly(codeword, EXP[i]);
        assert.equal(s, 0, `ecLen=${ecLen} 第 ${round} 轮：S${i} 应为 0，实际 ${s}`);
      }
    }
  }
});

test("纠错码字随数据变化而变化", () => {
  const a = rsEncode([1, 2, 3, 4, 5], 10).join(",");
  const b = rsEncode([1, 2, 3, 4, 6], 10).join(",");
  assert.notEqual(a, b, "数据变化时纠错码字不应相同");
});

/* ==========================================================================
   4. 码字容量与数据模块数（规范表 1 / 表 9）
   ========================================================================== */
section("容量与模块数（规范表对照）");

/** 版本 1-10 在纠错等级 M 下的总码字数 */
const SPEC_TOTAL_CODEWORDS = {
  1: 26, 2: 44, 3: 70, 4: 100, 5: 134,
  6: 172, 7: 196, 8: 242, 9: 292, 10: 346,
};

/** 版本 1-10 的剩余位数量 */
const SPEC_REMAINDER_BITS = {
  1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0,
};

test("总码字数与规范表一致", () => {
  for (const [version, expected] of Object.entries(SPEC_TOTAL_CODEWORDS)) {
    const actual = totalCodewordCount(Number(version));
    assert.equal(actual, expected, `v${version} 总码字数期望 ${expected}，实际 ${actual}`);
  }
});

test("数据模块数 = 总码字数 × 8 + 剩余位", () => {
  for (const [version, total] of Object.entries(SPEC_TOTAL_CODEWORDS)) {
    const v = Number(version);
    const expected = total * 8 + SPEC_REMAINDER_BITS[v];
    const actual = dataModuleCount(v);
    assert.equal(actual, expected, `v${v} 数据模块数期望 ${expected}，实际 ${actual}`);
  }
});

/* ==========================================================================
   5. 矩阵结构
   ========================================================================== */
section("矩阵结构");

const FINDER = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

function checkFinder(modules, row, col, label) {
  for (let i = 0; i < 7; i += 1) {
    for (let j = 0; j < 7; j += 1) {
      assert.equal(
        modules[row + i][col + j],
        FINDER[i][j],
        `${label} 定位图形 (${row + i},${col + j}) 不匹配`
      );
    }
  }
}

test("矩阵尺寸 = 4 × 版本 + 17", () => {
  for (const size of [1, 20, 60, 120, 200]) {
    const qr = encode("x".repeat(size));
    assert.equal(
      qr.size,
      qr.version * 4 + 17,
      `${size} 字节内容选到 v${qr.version}，尺寸 ${qr.size} 不符`
    );
  }
});

test("版本选择与容量表一致", () => {
  // v9-M 数据容量 182 码字 = 1456 位；200 字节需要 4+16+1600 = 1620 位，必须用到 v10
  assert.equal(encode("x".repeat(200)).version, 10, "200 字节应选 v10");
  // v1-M 数据容量 16 码字 = 128 位；14 字节需要 4+8+112 = 124 位，刚好放得下
  assert.equal(encode("x".repeat(14)).version, 1, "14 字节应选 v1");
  assert.equal(encode("x".repeat(15)).version, 2, "15 字节应升到 v2");
});

test("三个定位图形位置正确", () => {
  const qr = encode("https://example.com/query.html?no=JKP20260105018");
  const size = qr.size;
  checkFinder(qr.modules, 0, 0, "左上");
  checkFinder(qr.modules, 0, size - 7, "右上");
  checkFinder(qr.modules, size - 7, 0, "左下");
});

test("定位图形周围是分隔符（全白）", () => {
  const qr = encode("https://example.com/pay");
  const size = qr.size;
  for (let i = 0; i <= 7; i += 1) {
    assert.equal(qr.modules[7][i], 0, `分隔符 (7,${i}) 应为 0`);
    assert.equal(qr.modules[i][7], 0, `分隔符 (${i},7) 应为 0`);
  }
  for (let i = 0; i <= 7; i += 1) assert.equal(qr.modules[7][size - 1 - i], 0, "右上分隔符应为 0");
});

test("定时图形交替排列", () => {
  const qr = encode("https://example.com/pay");
  const size = qr.size;
  for (let i = 8; i < size - 8; i += 1) {
    const expected = i % 2 === 0 ? 1 : 0;
    assert.equal(qr.modules[6][i], expected, `横向定时 (6,${i}) 应为 ${expected}`);
    assert.equal(qr.modules[i][6], expected, `纵向定时 (${i},6) 应为 ${expected}`);
  }
});

test("固定黑点存在", () => {
  const qr = encode("https://example.com/pay");
  assert.equal(qr.modules[qr.size - 8][8], 1, "固定黑点必须为 1");
});

test("格式信息落在规范规定的位置上", () => {
  const qr = encode("https://example.com/pay");
  const size = qr.size;
  const bits = formatInfoBits(qr.ecLevel, qr.mask);
  const bit = (n) => (bits >>> n) & 1;

  for (let i = 0; i <= 5; i += 1) assert.equal(qr.modules[8][i], bit(i), `副本1 横排第 ${i} 位`);
  assert.equal(qr.modules[8][7], bit(6), "副本1 第 6 位");
  assert.equal(qr.modules[8][8], bit(7), "副本1 第 7 位");
  assert.equal(qr.modules[7][8], bit(8), "副本1 第 8 位");
  for (let i = 9; i <= 14; i += 1) {
    assert.equal(qr.modules[14 - i][8], bit(i), `副本1 竖排第 ${i} 位`);
  }

  for (let i = 0; i <= 6; i += 1) {
    assert.equal(qr.modules[size - 1 - i][8], bit(i), `副本2 左下第 ${i} 位`);
  }
  for (let i = 7; i <= 14; i += 1) {
    assert.equal(qr.modules[8][size - 15 + i], bit(i), `副本2 右上第 ${i} 位`);
  }
});

test("两份格式信息互为副本（交叉校验）", () => {
  const qr = encode("https://example.com/query.html?no=JKP2026");
  const size = qr.size;
  const bits = formatInfoBits(qr.ecLevel, qr.mask);
  const bit = (n) => (bits >>> n) & 1;

  for (let i = 0; i <= 6; i += 1) {
    assert.equal(qr.modules[size - 1 - i][8], bit(i), "左下副本应与格式信息一致");
  }
  assert.equal(qr.modules[8][size - 8], bit(7), "右上副本第 7 位");
});

test("自动选择掩码并落在 0-7 范围内", () => {
  const qr = encode("https://example.com/pay");
  assert.ok(qr.mask >= 0 && qr.mask <= 7, `掩码应在 0-7，实际 ${qr.mask}`);
});

/* ==========================================================================
   6. 版本选择
   ========================================================================== */
section("版本选择");

test("内容越长版本越高", () => {
  const short = encode("a").version;
  const long = encode("a".repeat(120)).version;
  assert.ok(long > short, `短内容 v${short} 应小于长内容 v${long}`);
});

test("极长内容抛出明确错误", () => {
  assert.throws(() => encode("a".repeat(5000)), /内容过长/);
});

test("中文内容按 UTF-8 字节数计算", () => {
  // 10 个汉字 = 30 字节，应选 v3（数据容量 44 码字）
  const qr = encode("简卡铺自动发货系统");
  assert.ok(qr.version >= 2, `中文应占用更多字节，实际 v${qr.version}`);
});

/* ==========================================================================
   7. 输出格式
   ========================================================================== */
section("输出格式");

test("SVG 尺寸与 viewBox 正确", () => {
  const svg = toSvg("https://example.com/pay", { scale: 6, margin: 4 });
  const qr = encode("https://example.com/pay");
  const view = qr.size + 8;
  assert.ok(svg.includes(`viewBox="0 0 ${view} ${view}"`), "viewBox 应含边距");
  assert.ok(svg.includes(`width="${view * 6}"`), "宽度应为 viewBox × scale");
  assert.ok(svg.includes("<path"), "应包含绘制路径");
  assert.ok(svg.startsWith("<svg"), "应为合法 SVG 开头");
});

test("data URL 可解码回 SVG", () => {
  const url = toDataUrl("https://example.com/pay");
  assert.ok(url.startsWith("data:image/svg+xml;base64,"));
  const decoded = Buffer.from(url.split(",")[1], "base64").toString("utf8");
  assert.ok(decoded.includes("<svg"), "解码后应为 SVG");
});

test("终端渲染的行数与尺寸一致", () => {
  const qr = encode("https://example.com/pay");
  const lines = toText("https://example.com/pay").split("\n");
  assert.equal(lines.length, qr.size, "终端渲染行数应等于矩阵尺寸");
  assert.equal(lines[0].length, qr.size * 2, "每行字符数应为尺寸 × 2");
});

test("相同输入产生相同矩阵（可复现）", () => {
  const a = encode("https://example.com/pay").modules.map((r) => r.join("")).join("|");
  const b = encode("https://example.com/pay").modules.map((r) => r.join("")).join("|");
  assert.equal(a, b, "同样输入应得到同样矩阵");
});

test("不同输入产生不同矩阵", () => {
  const a = encode("https://example.com/pay?no=1").modules.map((r) => r.join("")).join("|");
  const b = encode("https://example.com/pay?no=2").modules.map((r) => r.join("")).join("|");
  assert.notEqual(a, b, "不同输入应得到不同矩阵");
});

/* ==========================================================================
   汇总
   ========================================================================== */
console.log("");
console.log("─".repeat(46));
if (failed === 0) {
  console.log(`\u001b[32m全部通过\u001b[0m  ${passed} 项`);
  console.log("");
  console.log("样例二维码（终端渲染，可用手机扫描验证）：");
  console.log(toText("https://jiankapu.example/query.html?no=JKP20260105018"));
} else {
  console.log(`\u001b[31m失败 ${failed} 项\u001b[0m / 通过 ${passed} 项`);
  for (const f of failures) {
    console.log(`\n· ${f.name}\n  ${f.err.stack?.split("\n").slice(0, 4).join("\n  ")}`);
  }
}
console.log("─".repeat(46));
process.exit(failed === 0 ? 0 : 1);
