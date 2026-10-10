/**
 * 简卡铺 · 静态文件服务
 * ---------------------------------------------------------------------------
 * 关键防护：解析后的绝对路径必须落在站点根目录内，阻断 ../ 目录穿越。
 *
 * 针对「前后台分端口」的两个补充能力：
 *   · fallbackRoot —— 后台服务找不到文件时回落到共享资源目录
 *     （后台页面引用 `../assets/css/style.css`，即共享的设计系统）
 *   · HTML 注入 —— 往 <head> 里注入 window.JKP_RUNTIME，
 *     让前端知道另一个服务的地址，无需在每个 HTML 里手写配置
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import config from "../config.js";
import { logger } from "../lib/logger.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

const contentType = (filePath) =>
  MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";

/**
 * 把 URL 路径解析为站点内的绝对文件路径
 * @returns {string|null} 越界时返回 null
 */
export function resolveWithinRoot(urlPath, root) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;

  const resolved = path.resolve(root, "." + path.posix.normalize(decoded));
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

/* ------------------------------------------------------------ HTML 注入 */

/** 注入内容的缓存：key = 文件路径，value = { mtimeMs, body } */
const htmlCache = new Map();

/**
 * 往 HTML 的 </head> 前注入运行时配置。
 * 注入内容随角色变化：前台服务告诉页面后台地址，反之亦然。
 */
function injectRuntime(html, role) {
  const runtime = {
    role,
    siteBase: config.servers.site.baseUrl,
    adminBase: config.servers.admin.baseUrl,
  };
  const snippet = `<script>window.JKP_RUNTIME=${JSON.stringify(runtime)};</script>`;
  return html.includes("</head>")
    ? html.replace("</head>", `${snippet}\n</head>`)
    : snippet + html;
}

/* ---------------------------------------------------------------- 服务 */

/** 按顺序尝试若干候选路径，返回第一个存在的文件信息 */
async function statFirst(candidates) {
  for (const filePath of candidates) {
    if (!filePath) continue;
    try {
      const stat = await fsp.stat(filePath);
      if (stat.isDirectory()) {
        const indexFile = path.join(filePath, "index.html");
        try {
          const indexStat = await fsp.stat(indexFile);
          if (indexStat.isFile()) return { filePath: indexFile, stat: indexStat };
        } catch {
          /* 目录里没有 index.html，继续尝试下一个候选 */
        }
        continue;
      }
      if (stat.isFile()) return { filePath, stat };
    } catch {
      /* 不存在则继续 */
    }
  }
  return null;
}

/**
 * 尝试以静态文件响应请求
 * @param {object} opts
 * @param {string} opts.root          站点根目录
 * @param {string} [opts.fallbackRoot] 找不到时回落的共享目录（仅对 /assets/ 生效）
 * @param {string} [opts.spaIndex]    SPA 入口的 URL 路径（如 "/index.html"）；
 *                                    找不到页面时回退到它，供前端路由使用
 * @param {string} opts.role          'site' | 'admin'，用于注入运行时配置
 * @returns {Promise<boolean>} 是否已处理
 */
export async function serveStatic(req, res, urlPath, opts = {}) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const root = opts.root || config.paths.webDist;
  const fallbackRoot = opts.fallbackRoot;
  const spaIndex = opts.spaIndex;
  const role = opts.role || "site";

  const primary = resolveWithinRoot(urlPath, root);
  if (!primary) return false;

  const candidates = [primary];
  /* 后台服务的共享资源回落：只对 /assets/ 生效，避免误把前台页面吐出来 */
  if (fallbackRoot && urlPath.startsWith("/assets/")) {
    candidates.push(resolveWithinRoot(urlPath, fallbackRoot));
  }

  let found = await statFirst(candidates);

  /* SPA 回退：看起来不像静态资源（没有扩展名）且不是接口请求时，
     交给前端路由处理 —— 例如 /product/p001、/orders 这类地址。 */
  if (!found && spaIndex && !path.extname(urlPath)) {
    found = await statFirst([resolveWithinRoot(spaIndex, root)]);
  }

  if (!found) return false;

  const { filePath, stat } = found;
  const isHtml = path.extname(filePath).toLowerCase() === ".html";
  const baseHeaders = {
    "Content-Type": contentType(filePath),
    "Last-Modified": stat.mtime.toUTCString(),
    "Cache-Control":
      config.staticCacheSeconds > 0 ? `public, max-age=${config.staticCacheSeconds}` : "no-cache",
    "X-Content-Type-Options": "nosniff",
  };

  /* HTML：注入运行时配置后发送 */
  if (isHtml) {
    const cached = htmlCache.get(filePath);
    let body;
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.role === role) {
      body = cached.body;
    } else {
      const raw = await fsp.readFile(filePath, "utf8");
      body = Buffer.from(injectRuntime(raw, role), "utf8");
      htmlCache.set(filePath, { mtimeMs: stat.mtimeMs, role, body });
    }

    res.writeHead(200, { ...baseHeaders, "Content-Length": body.length });
    if (req.method === "HEAD") res.end();
    else res.end(body);
    return true;
  }

  /* 其它资源：流式发送 */
  res.writeHead(200, { ...baseHeaders, "Content-Length": stat.size });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  await new Promise((resolve) => {
    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => {
      logger.error(`静态文件读取失败：${filePath}`, err);
      res.destroy();
      resolve();
    });
    stream.on("end", resolve);
    stream.pipe(res);
  });
  return true;
}

export default { serveStatic, resolveWithinRoot };
