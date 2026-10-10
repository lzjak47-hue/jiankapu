/**
 * 简卡铺 · 响应助手
 * ---------------------------------------------------------------------------
 * 统一 JSON 结构：{ ok: true, data } / { ok: false, code, message, details }
 * 前端只需判断 res.ok 字段即可，不必同时看 HTTP 状态码。
 */
import { ApiError } from "../lib/errors.js";

const JSON_TYPE = "application/json; charset=utf-8";

/** 发送 JSON */
export function json(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "Content-Type": JSON_TYPE,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

/** 成功响应 */
export function ok(res, data = null, status = 200) {
  json(res, status, { ok: true, data });
}

/** 失败响应 */
export function fail(res, status, code, message, details) {
  json(res, status, { ok: false, code, message, ...(details ? { details } : {}) });
}

/** 把任意异常转成响应；ApiError 按自身状态码，其余按 500 处理。
 *  两类异常都写进系统日志缓冲：否则「通知测试失败」这类业务错误
 *  在容器日志与后台都无迹可寻，管理员根本无从排查。 */
export function failFromError(res, err, logger) {
  if (err instanceof ApiError) {
    if (logger) logger.warn(`${err.status} ${err.code}：${err.message}`);
    fail(res, err.status, err.code, err.message, err.details);
    return;
  }
  if (logger) logger.error("未处理的服务端异常", err);
  fail(res, 500, "INTERNAL_ERROR", "服务器内部错误，请稍后重试");
}

/* ------------------------------------------------------------------- Cookie */

/** 解析请求 Cookie 头 */
export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function getCookie(req, name) {
  return parseCookies(req)[name];
}

/** 生成 Set-Cookie 头（不直接写入 response，便于一次设置多个） */
export function buildCookie(name, value, opts = {}) {
  const {
    maxAge,
    path = "/",
    httpOnly = true,
    sameSite = "Lax",
    secure = false,
  } = opts;
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (typeof maxAge === "number") parts.push(`Max-Age=${Math.floor(maxAge)}`);
  if (httpOnly) parts.push("HttpOnly");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** 在 json() 的 headers 里带上 Set-Cookie */
export function withCookie(cookieValue) {
  return { "Set-Cookie": cookieValue };
}

/** 空响应 */
export function noContent(res) {
  res.writeHead(204);
  res.end();
}

export default { json, ok, fail, failFromError, parseCookies, getCookie, buildCookie, withCookie, noContent };
