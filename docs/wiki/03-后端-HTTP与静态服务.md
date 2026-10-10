# 03 · 后端：HTTP 与静态服务

> 源码目录 [src/http/](../../apps/server/src/http/)：server.js / router.js / body.js / respond.js / static.js。
> 全部基于 `node:http`，无框架。

## 1. server.js — 按角色创建服务

导出：

| 符号 | 签名 | 说明 |
| --- | --- | --- |
| `clientIp` | `(req) → string` | 优先 `x-forwarded-for` 首个，回落 `socket.remoteAddress` |
| `buildRouter` | `()` | 注册 `/api/public/*`（public.js）与 `/api/admin/*`（admin.js） |
| `createServer` | `(role='site') → http.Server` | 完整请求分发 |

`createServer` 内建的请求处理顺序：

1. `OPTIONS` → 204；`GET /healthz` → 健康检查。
2. 安全响应头固定注入：`X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`。
3. 匹配 API 路由 → 未命中走静态服务。
4. 前台角色的 `/admin/*` → 302 跳后台对应 SPA 路由（`/admin/login.html` 等旧地址映射为 `/login`）。
5. 静态也未命中 → 友好 404 页；若前端产物目录不存在，提示「前端还没有构建」（503 语义）。

## 2. router.js — 极简零依赖路由

导出 `createRouter()`，返回对象：

```js
{ get(path, handler), post, put, patch, delete,   // 注册
  match(method, pathname) → { handler, params } | { allow } | null,
  list() }
```

- 路径编译：`:id` → `([^/]+)`，`*` → `(.*)`，其余正则元字符转义；参数 `decodeURIComponent` 解码。
- 方法不匹配返回 `{ allow }`（供 405 处理），未命中返回 `null`。

## 3. body.js — 请求体解析

导出：

| 符号 | 签名 | 说明 |
| --- | --- | --- |
| `readRaw` | `(req, limit=512KB) → Buffer` | 超限直接 `req.destroy()` |
| `readBody` | `(req, {limit}) → object` | 按 Content-Type 解析 |

- JSON（`application/json`）→ `JSON.parse`，非对象返回 400。
- 表单（`application/x-www-form-urlencoded`）→ `URLSearchParams` 展开。
- 未声明 Content-Type 先试 JSON 再落表单；空体返回 `{}`。

## 4. respond.js — 统一响应

导出：`json` / `ok` / `fail` / `failFromError` / `parseCookies` / `getCookie` / `buildCookie` / `withCookie` / `noContent`。

统一结构（前端 `api.ts` 据此解析）：

```json
{ "ok": true,  "data": { } }
{ "ok": false, "code": "CONFLICT", "message": "库存不足，请减少数量或稍后再试", "details": {} }
```

- API 响应一律 `Cache-Control: no-store`。
- `failFromError`：`ApiError` 用自身 status/code，其余记日志后返回 500。
- Cookie：`buildCookie(name, value, { httpOnly, sameSite:'Lax', secure, maxAge })`；
  会话 Cookie 默认 `HttpOnly; SameSite=Lax`；登录/登出通过 `withCookie()` 附带 `Set-Cookie`。

## 5. static.js — 静态服务与 SPA 回退

导出：

| 符号 | 签名 | 说明 |
| --- | --- | --- |
| `resolveWithinRoot` | `(urlPath, root) → string \| null` | 目录穿越防护：decode → `path.resolve` → `relative` 检查不得以 `..` 或绝对路径逃出站点根 |
| `serveStatic` | `(req, res, urlPath, opts) → boolean` | 是否已处理；失败返回 false 继续走 404 |

要点：

- **HTML 注入**：读到 `<head>` 末尾时注入
  `<script>window.JKP_RUNTIME = {"role":…,"siteBase":…,"adminBase":…}</script>`，
  拼接 URL 由前端自行完成；按 mtime + role 缓存注入结果。
- **跨目录回落**：后台请求 `/assets/*` 若 `dist/admin/assets` 没有，回落到 `dist/assets`（两应用共享同一打包产物目录）。
- **SPA 回退**：无扩展名的路径（`/product/p001`、`/orders`）找不到文件时返回对应应用 `index.html`；
  带扩展名不回退。
- 非 HTML 文件流式发送；`NODE_ENV=production` 时静态资源缓存 3600s。
- 依赖：`node:fs` / `node:fs/promises` / `node:path`、config、lib/logger。