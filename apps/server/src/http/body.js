/**
 * 简卡铺 · 请求体解析
 * ---------------------------------------------------------------------------
 * 支持 JSON 与表单（application/x-www-form-urlencoded）。
 * 强制大小上限，防止超大请求体打满内存。
 */
import { badRequest } from "../lib/errors.js";

const DEFAULT_LIMIT = 512 * 1024; // 512KB

/**
 * 读取原始请求体
 * @param {import("node:http").IncomingMessage} req
 * @param {number} limit 字节上限
 * @returns {Promise<Buffer>}
 */
export function readRaw(req, limit = DEFAULT_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(badRequest(`请求体超过 ${Math.round(limit / 1024)}KB 限制`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** 把表单串解析成对象 */
function parseForm(text) {
  const params = new URLSearchParams(text);
  const out = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

/**
 * 解析请求体为对象。
 * - application/json → JSON.parse
 * - 表单 → URLSearchParams
 * - 空体 → {}
 * @returns {Promise<object>}
 */
export async function readBody(req, { limit = DEFAULT_LIMIT } = {}) {
  const raw = await readRaw(req, limit);
  if (raw.length === 0) return {};

  const text = raw.toString("utf8");
  const type = String(req.headers["content-type"] || "").toLowerCase();

  if (type.includes("application/json")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object") {
        throw badRequest("请求体必须是 JSON 对象");
      }
      return parsed;
    } catch (err) {
      if (err.code === "BAD_REQUEST") throw err;
      throw badRequest("请求体不是合法的 JSON");
    }
  }

  if (type.includes("application/x-www-form-urlencoded")) {
    return parseForm(text);
  }

  // 未声明类型时，尝试按 JSON 解析，失败则当表单处理
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    /* 忽略，走表单分支 */
  }
  return parseForm(text);
}

export default { readRaw, readBody };
