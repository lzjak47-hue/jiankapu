/**
 * 简卡铺 · 服务端入口
 * ---------------------------------------------------------------------------
 *   npm start                     同时启动前台(2001)与后台(2002)
 *   node src/index.js --only site 只启动前台
 *   node src/index.js --only admin 只启动后台
 *
 * 环境变量见 config.js（PORT 相关：SITE_PORT / ADMIN_PORT，数据库：PG* 或 DATABASE_URL）
 */
import config from "./config.js";
import { initDatabase, closePool } from "./db.js";
import { logger } from "./lib/logger.js";
import { createServer } from "./http/server.js";
import { seed, isInitialized } from "./seed.js";
import * as settingsService from "./services/settings.js";
import * as orderService from "./services/order.js";
import * as authService from "./services/auth.js";
import * as cardService from "./services/card.js";

const only = (() => {
  const idx = process.argv.indexOf("--only");
  if (idx < 0) return null;
  const value = process.argv[idx + 1];
  return value === "site" || value === "admin" ? value : null;
})();

function banner(servers) {
  const line = "─".repeat(62);
  console.log("");
  console.log(`  ${line}`);
  console.log("   简卡铺 · 服务已启动");
  console.log(`  ${line}`);
  for (const { role, server, port } of servers) {
    const label = role === "site" ? "前台商城" : "管理后台";
    /* 两个都是 SPA：前台首页是 /，后台登录页是 /login */
    const path = role === "site" ? "/" : "/login";
    console.log(`   ${label}    http://localhost:${port}${path}`);
  }
  console.log("");
  console.log("   管理员账号  admin / 123456");
  console.log(`   数据库      ${config.db.database} @ ${config.db.host}:${config.db.port} (PostgreSQL)`);
  console.log(`   运行环境    Node ${process.version} · ${config.env}`);
  console.log(`  ${line}`);
  console.log("");
}

async function startOne(role) {
  const conf = config.servers[role];
  const server = createServer(role);
  const port = conf.port;

  await new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`端口 ${port} 已被占用。换个端口：SITE_PORT=2011 ADMIN_PORT=2012 npm start`));
      } else if (err.code === "EACCES") {
        reject(new Error(`端口 ${port} 被系统拒绝（EACCES）。请换一个端口，或检查是否有权限限制。`));
      } else {
        reject(err);
      }
    });
    server.listen(port, conf.host, resolve);
  });

  return { role, server, port };
}

async function main() {
  /* 1. 建表 + 连通性自检 */
  await initDatabase();

  /* 2. 空库自动初始化 */
  if (!(await isInitialized())) {
    logger.info("检测到空数据库，正在写入初始化数据…");
    await seed({ quiet: true });
    logger.info("初始化完成");
  }

  /* 3. 设置载入内存缓存（业务层同步读取） */
  await settingsService.reload();

  /* 4. 启动服务 */
  const roles = only ? [only] : ["site", "admin"];
  const started = [];
  for (const role of roles) {
    try {
      started.push(await startOne(role));
    } catch (err) {
      logger.error(`${config.servers[role].name}启动失败：${err.message}`);
      for (const s of started) s.server.close();
      await closePool();
      process.exit(1);
    }
  }

  banner(started);

  /* 5. 定时清理：超时订单、过期会话、孤儿锁定 */
  const timer = setInterval(async () => {
    try {
      const closed = await orderService.sweepExpired();
      if (closed > 0) logger.info(`已自动关闭 ${closed} 笔超时订单并释放卡密`);
      await authService.purgeExpiredSessions();
      await cardService.releaseOrphanLocks();
    } catch (err) {
      logger.error("清理任务执行失败", err);
    }
  }, config.sweepIntervalSeconds * 1000);
  timer.unref?.();

  /* 6. 优雅退出 */
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    logger.info(`收到 ${signal}，正在关闭服务…`);
    clearInterval(timer);

    await Promise.all(
      started.map((s) => new Promise((resolve) => s.server.close(resolve)))
    );

    try {
      await closePool();
    } catch {
      /* 关闭连接池失败不影响退出 */
    }
    logger.info("已安全退出");
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch(async (err) => {
  logger.error("启动失败", err);
  try {
    await closePool();
  } catch {
    /* 忽略 */
  }
  process.exit(1);
});
