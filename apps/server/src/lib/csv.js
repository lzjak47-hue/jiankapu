/**
 * 简卡铺 · CSV 生成
 * ---------------------------------------------------------------------------
 * 只做一件事：把二维数据转成 Excel 能正确打开的 CSV。
 *
 * 两个容易被忽略的细节：
 *   1. 公式注入：以 = + - @ 开头的单元格会被 Excel 当公式执行。
 *      卡密内容完全由用户提供，可能真的长这样，所以要主动加前缀阻断。
 *   2. 换行与逗号：必须用双引号包起来，否则一行会裂成两行。
 */

/** 单个字段的转义 */
function escapeCell(value) {
  let text = value === null || value === undefined ? "" : String(value);

  /* 公式注入防护：在前面加一个单引号，Excel 会当纯文本显示 */
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  /* 含逗号、引号、换行时用双引号包裹，内部引号翻倍 */
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * @param {object[]} rows 数据行
 * @param {{label: string, value: (row: any) => unknown}[]} columns 列定义
 * @returns {string} CSV 文本（不含 BOM，由调用方决定是否添加）
 */
export function toCsv(rows, columns) {
  const lines = [columns.map((c) => escapeCell(c.label)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(c.value(row))).join(","));
  }
  /* 用 CRLF，Excel 与 Windows 记事本都认 */
  return lines.join("\r\n");
}

export default { toCsv };
