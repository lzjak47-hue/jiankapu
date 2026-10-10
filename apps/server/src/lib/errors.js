/**
 * 简卡铺 · 统一错误类型
 * ---------------------------------------------------------------------------
 * 路由层抛出 ApiError，由 HTTP 层统一转换成 JSON 响应。
 */

export class ApiError extends Error {
  /**
   * @param {number} status HTTP 状态码
   * @param {string} code   机器可读的错误码，前端据此做分支
   * @param {string} message 给用户看的中文提示
   * @param {object} [details] 附加信息
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "请先登录") => new ApiError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "没有权限执行该操作") => new ApiError(403, "FORBIDDEN", message);
export const notFound = (message = "资源不存在") => new ApiError(404, "NOT_FOUND", message);
export const conflict = (message, details) => new ApiError(409, "CONFLICT", message, details);
export const tooMany = (message, details) => new ApiError(429, "TOO_MANY_REQUESTS", message, details);

/**
 * 上游服务失败（SMTP 连不上、短信网关报错等）。
 *
 * 用 502 而不是 500：这类错误的原因在外部服务或配置，
 * 而且消息里会带上真实原因 —— 否则管理员只看到「服务器内部错误」，
 * 根本无从判断是端口填错了还是授权码过期了。
 */
export const upstream = (message, details) => new ApiError(502, "UPSTREAM_ERROR", message, details);

export default { ApiError, badRequest, unauthorized, forbidden, notFound, conflict, tooMany, upstream };
