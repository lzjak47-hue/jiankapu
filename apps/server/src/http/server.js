/**
 * 简卡铺 · HTTP 服务
 * ---------------------------------------------------------------------------
 * 同一份代码按「角色」启动两个服务：
 *
 *   前台商城 (SITE_PORT,  默认 2001)  静态根目录 apps/web        → /admin/* 会 302 到后台服务
 *   管理后台 (ADMIN_PORT, 默认 2002)  静态根目录 apps/web/admin  → 缺失资源回落到共享 assets
 *
 * 两组 API（/api/public/* 与 /api/admin/*）在两个端口上都注册，
 * 这样任意一端都能自洽工作，也方便用 curl 调试。
 * 生产环境建议把后台端口限制在内网或加白名单。
 */
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import config from "../config.js";
import { logger } from "../lib/logger.js";
import { createRouter } from "./router.js";
import { readBody } from "./body.js";
import { serveStatic } from "./static.js";
import { fail, failFromError, json, getCookie } from "./respond.js";
import { registerPublicRoutes } from "../routes/public.js";
import { registerAdminRoutes } from "../routes/admin.js";

/** 取客户端 IP，优先使用反向代理传递的头 */
export function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  const raw = req.socket?.remoteAddress || "";
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

/** 注册全部 API 路由 */
export function buildRouter() {
  const router = createRouter();
  registerPublicRoutes(router);
  registerAdminRoutes(router);
  return router;
}

/**
 * 各角色的静态目录配置
 *
 * Vite 产物结构：
 *   dist/index.html          前台 SPA
 *   dist/admin/index.html    后台 SPA
 *   dist/assets/*            两者共享的 JS / CSS
 *
 * 后台服务以 dist/admin 为根，遇到 /assets/* 回落到 dist；
 * 单端口模式（single）按路径前缀分流：/admin/* 走后台，其余走前台。
 */
function staticOptionsFor(role, pathname = "") {
  if (role === "admin") {
    return {
      root: path.join(config.paths.webDist, "admin"),
      fallbackRoot: config.paths.webDist,
      spaIndex: "/index.html",
      role,
    };
  }
  if (role === "single") {
    const adminPath = pathname === "/admin" || pathname.startsWith("/admin/");
    if (adminPath) {
      return {
        root: path.join(config.paths.webDist, "admin"),
        fallbackRoot: config.paths.webDist,
        spaIndex: "/index.html",
        role: "admin",
      };
    }
    return {
      root: config.paths.webDist,
      spaIndex: "/index.html",
      role: "site",
    };
  }
  return {
    root: config.paths.webDist,
    spaIndex: "/index.html",
    role,
  };
}

async function handleRequest(req, res, router, role) {
  const startedAt = Date.now();
  const host = `${config.servers[role].host}:${config.servers[role].port}`;

  let url;
  try {
    url = new URL(req.url || "/", `http://${req.headers.host || host}`);
  } catch {
    fail(res, 400, "BAD_REQUEST", "非法的请求地址");
    return;
  }

  const pathname = url.pathname; // 保持编码状态，参数解码由路由与静态服务各自处理
  const ip = clientIp(req);

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");

  /* 健康检查 */
  if (pathname === "/healthz") {
    json(res, 200, { ok: true, data: { role, uptime: Math.round(process.uptime()) } });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, { Allow: "GET,POST,PUT,PATCH,DELETE" });
    res.end();
    return;
  }

  /* ------- 前台服务：旧的 /admin 链接统一跳后台；单端口模式只跳旧式地址 ------ */
  if ((role === "site" || role === "single") && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    /* 把旧版静态页地址映射到 SPA 路由：
       /admin/            → /
       /admin/login.html  → /login
       /admin/orders.html → /orders          */
    let rest = pathname.slice("/admin".length);
    const legacy = rest === "" || rest === "/" || rest.endsWith(".html");

    /* 单端口模式：/admin/login 这类 SPA 路由交给下面的静态服务（回退到后台入口），
       只有旧式 .html 链接与裸 /admin 才跳转，避免无限重定向。 */
    if (role === "site" || legacy) {
      if (rest === "" || rest === "/" || rest === "/index.html") {
        rest = "/";
      } else {
        rest = rest.replace(/\.html$/, "");
      }
      res.writeHead(302, { Location: `${config.servers.admin.baseUrl}${rest}` });
      res.end();
      return;
    }
  }

  /* ------------------------------ API ------------------------------ */
  const matched = router.match(req.method, pathname);

  if (matched && matched.handler) {
    const ctx = {
      req,
      res,
      params: matched.params,
      query: url.searchParams,
      body: null,
      ip,
      role,
      token: getCookie(req, config.session.cookieName),
      session: null,
    };
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        ctx.body = await readBody(req);
      }
      await matched.handler(ctx);
    } catch (err) {
      if (!res.headersSent) failFromError(res, err, logger);
      else res.destroy();
    }
    logger.debug(`${role} ${req.method} ${pathname} → ${res.statusCode} (${Date.now() - startedAt}ms)`);
    return;
  }

  if (matched && matched.allow) {
    fail(res, 405, "METHOD_NOT_ALLOWED", `该接口不支持 ${req.method} 方法`, { allow: matched.allow });
    return;
  }

  if (pathname.startsWith("/api/")) {
    fail(res, 404, "NOT_FOUND", "接口不存在");
    return;
  }

  /* ---------------------------- 静态文件 ---------------------------- */
  const served = await serveStatic(req, res, pathname, staticOptionsFor(role, pathname));
  if (served) return;

  notFound(res, role);
}

/** 友好的 404 页，给出两端入口 */
function notFound(res, role) {
  const isAdmin = role === "admin";

  /* 前端还没构建时给出明确指引，而不是一个干巴巴的 404 */
  if (!fs.existsSync(config.paths.webDist)) {
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>前端尚未构建 · 简卡铺</title>
<style>
  body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
       display:grid;place-items:center;min-height:100vh;margin:0;background:#F6F7F9;color:#1F2329}
  .box{max-width:520px;padding:32px;text-align:center;background:#fff;border:1px solid #E9ECEF;
       border-radius:20px;box-shadow:0 18px 44px rgb(16 24 40 / 14%)}
  h1{font-size:20px;margin:0 0 12px}
  p{color:#5F6672;line-height:1.9;margin:0 0 10px}
  code{background:#F1F3F6;padding:2px 7px;border-radius:5px;font-family:ui-monospace,monospace;font-size:13px}
  pre{background:#14161A;color:#E6E8EB;padding:14px;border-radius:10px;text-align:left;
      font-size:13px;line-height:1.7;overflow:auto}
</style></head><body><div class="box">
<h1>前端还没有构建</h1>
<p>后端已经启动，但找不到 Vite 构建产物：</p>
<p><code>${config.paths.webDist}</code></p>
<p>在项目里执行一次构建即可：</p>
<pre>cd apps/web-react
pnpm install
pnpm build</pre>
<p>开发时也可以用 <code>pnpm dev</code> 起 Vite 开发服务器。</p>
</div></body></html>`;
    res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>404 · 简卡铺</title>
<style>
  body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
       display:grid;place-items:center;min-height:100vh;margin:0;background:#F6F7F9;color:#1F2329}
  .box{text-align:center;padding:24px}
  h1{font-size:72px;margin:0;letter-spacing:-.04em;color:#3B6EF6}
  p{color:#5F6672;line-height:1.9}
  a{color:#3B6EF6;text-decoration:none}
  .links{display:flex;gap:16px;justify-content:center;margin-top:18px;flex-wrap:wrap}
</style></head><body><div class="box"><h1>404</h1>
<p>${isAdmin ? "后台页面走丢了" : "页面走丢了"}</p>
<div class="links">
  <a href="/">${isAdmin ? "后台首页" : "回到商城首页"}</a>
  <a href="${config.servers.site.baseUrl}">前台商城 :${config.servers.site.port}</a>
  <a href="${config.servers.admin.baseUrl}">管理后台 :${config.servers.admin.port}</a>
</div></div></body></html>`;

  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/**
 * 创建服务实例
 * @param {'site'|'admin'} role
 */
export function createServer(role = "site") {
  const router = buildRouter();

  const server = http.createServer((req, res) => {
    handleRequest(req, res, router, role).catch((err) => {
      logger.error("请求处理异常", err);
      if (!res.headersSent) failFromError(res, err, logger);
      else res.destroy();
    });
  });

  server.appRole = role;
  server.appRouter = router;
  return server;
}

export default createServer;
