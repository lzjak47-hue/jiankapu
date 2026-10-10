/**
 * 简卡铺 · 参数校验
 * ---------------------------------------------------------------------------
 * 每个函数要么返回清洗后的值，要么抛出 ApiError(400)。
 * 绝不信任来自客户端的数据。
 */
import { badRequest } from "./errors.js";

/** 单行字符串 */
export function str(value, opts = {}) {
  const { field = "参数", required = true, min = 0, max = 200, trim = true, pattern } = opts;
  let v = value;
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string") v = String(v);
  if (trim) v = v.trim();

  if (!v) {
    if (required) throw badRequest(`${field}不能为空`, { field });
    return "";
  }
  if (v.length < min) throw badRequest(`${field}至少 ${min} 个字符`, { field });
  if (v.length > max) throw badRequest(`${field}不能超过 ${max} 个字符`, { field });
  if (pattern && !pattern.test(v)) throw badRequest(`${field}格式不正确`, { field });
  return v;
}

/** 多行文本 */
export function text(value, opts = {}) {
  const { field = "内容", required = false, max = 5000 } = opts;
  let v = value === undefined || value === null ? "" : String(value);
  v = v.replace(/\r\n/g, "\n").trim();
  if (!v) {
    if (required) throw badRequest(`${field}不能为空`, { field });
    return "";
  }
  if (v.length > max) throw badRequest(`${field}不能超过 ${max} 个字符`, { field });
  return v;
}

/** 整数 */
export function int(value, opts = {}) {
  const { field = "数值", required = true, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, fallback } = opts;
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    if (required) throw badRequest(`${field}不能为空`, { field });
    return min;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw badRequest(`${field}必须是整数`, { field });
  if (n < min) throw badRequest(`${field}不能小于 ${min}`, { field });
  if (n > max) throw badRequest(`${field}不能大于 ${max}`, { field });
  return n;
}

/** 金额：最多两位小数，非负 */
export function money(value, opts = {}) {
  const { field = "金额", required = true, min = 0, max = 9_999_999 } = opts;
  if (value === undefined || value === null || value === "") {
    if (required) throw badRequest(`${field}不能为空`, { field });
    return 0;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${field}必须是数字`, { field });
  if (n < min) throw badRequest(`${field}不能小于 ${min}`, { field });
  if (n > max) throw badRequest(`${field}不能大于 ${max}`, { field });
  return Math.round(n * 100) / 100;
}

/** 枚举 */
export function oneOf(value, allowed, opts = {}) {
  const { field = "选项", required = true } = opts;
  const v = value === undefined || value === null ? "" : String(value);
  if (!v) {
    if (required) throw badRequest(`请选择${field}`, { field });
    return "";
  }
  if (!allowed.includes(v)) throw badRequest(`${field}取值不合法`, { field, allowed });
  return v;
}

/** 0/1 开关，兼容 true/false、"1"/"0"、1/0 */
export function bool01(value, opts = {}) {
  const { field = "开关", fallback = 0 } = opts;
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === 1 || value === "1" || value === "true" || value === "on") return 1;
  if (value === false || value === 0 || value === "0" || value === "false" || value === "off") return 0;
  throw badRequest(`${field}取值不合法`, { field });
}

/**
 * 联系方式：手机号、邮箱、QQ、微信号……什么都行。
 *
 * 刻意**不做格式校验**：用户想留什么就留什么。
 * 只限制长度，避免超长文本撑爆列宽或日志。
 * 「是不是手机号 / 邮箱」只用来决定发短信还是发邮件，不影响能否下单。
 */
export function contact(value, opts = {}) {
  const { field = "联系方式", required = false } = opts;
  const v = value === undefined || value === null ? "" : String(value).trim();
  if (!v) {
    if (required) throw badRequest(`${field}不能为空`, { field });
    return "";
  }
  if (v.length > 120) throw badRequest(`${field}不能超过 120 个字符`, { field });
  return v;
}

/** 商品 ID / 分类 ID：小写字母数字与 - _ */
export const ID_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;

/** 把多行文本切成非空行数组 */
export function lines(value, max = 60) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim()).filter(Boolean).slice(0, max);
  }
  return String(value)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

/** 解析 JSON 数组字段（数据库里以 TEXT 存储） */
export function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 把数组序列化成数据库用的 JSON 字符串 */
export function toJsonArray(value, max = 60) {
  return JSON.stringify(lines(value, max));
}

/**
 * 把前端传来的排序标识映射成安全的 ORDER BY 片段。
 *
 * **必须走白名单**：排序字段直接来自用户输入，拼进 SQL 就是注入漏洞。
 * 未命中白名单时安静地回落到默认排序，而不是报错 ——
 * 一个旧链接或手改的 URL 不该把列表页打挂。
 *
 * 用 hasOwnProperty 判断而不是 `allowed[key]`，避免
 * `?sort=constructor` 这类原型链上的键被误当成合法值。
 *
 * @param {string} sort 前端传来的排序键
 * @param {Record<string, string>} allowed 排序键 → ORDER BY 片段
 * @param {string} fallbackKey 默认排序键（必须存在于 allowed 中）
 * @returns {string} 可直接拼进 SQL 的 ORDER BY 片段
 */
export function orderBy(sort, allowed, fallbackKey) {
  const key = String(sort ?? "").trim();
  const picked = Object.prototype.hasOwnProperty.call(allowed, key) ? key : fallbackKey;
  const clause = Object.prototype.hasOwnProperty.call(allowed, picked) ? allowed[picked] : "";
  return String(clause ?? "");
}

export default {
  str,
  text,
  int,
  money,
  oneOf,
  bool01,
  contact,
  lines,
  parseJsonArray,
  toJsonArray,
  orderBy,
  ID_PATTERN,
};
