/**
 * 简卡铺 · 测试入口
 * ---------------------------------------------------------------------------
 * 1. 自动创建独立测试数据库（默认 jiankapu_test），**不会碰开发库**
 * 2. 为子测试进程注入独立的端口与库名
 * 3. 依次运行二维码测试与接口冒烟测试
 *
 *   node apps/server/test/run.js
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import config from "../src/config.js";

const require = createRequire(import.meta.url);
const pg = require("pg");

const TEST_DB = process.env.PGTESTDATABASE || "jiankapu_test";
const SITE_PORT = Number(process.env.TEST_SITE_PORT || 3456);
const ADMIN_PORT = Number(process.env.TEST_ADMIN_PORT || 3457);

/* -------------------------------------------------- 1. 准备测试数据库 */

const admin = new pg.Client({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  // 连到维护库，才能在目标库不存在时创建它
  database: "postgres",
});

try {
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${TEST_DB}" WITH ENCODING 'UTF8' TEMPLATE template0`);
    console.log(`已创建测试数据库：${TEST_DB}`);
  }
} catch (err) {
  console.error(`\n无法准备测试数据库 ${TEST_DB}：${err.message}`);
  console.error("请确认 PostgreSQL 已启动，且连接配置正确。\n");
  process.exit(1);
} finally {
  await admin.end().catch(() => {});
}

/* ---------------------------------------------------- 2. 运行测试文件 */

const env = {
  ...process.env,
  PGDATABASE: TEST_DB,
  SITE_PORT: String(SITE_PORT),
  ADMIN_PORT: String(ADMIN_PORT),
  SITE_BASE_URL: `http://127.0.0.1:${SITE_PORT}`,
  ADMIN_BASE_URL: `http://127.0.0.1:${ADMIN_PORT}`,
};

const here = import.meta.dirname;
const files = ["qrcode.test.js", "notify.test.js", "smoke.js"];

console.log("");
console.log(`简卡铺 · 测试数据库：${TEST_DB} @ ${config.db.host}:${config.db.port}`);
console.log(`            前台端口：${SITE_PORT}   后台端口：${ADMIN_PORT}`);
console.log("");

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(here, file)], {
    stdio: "inherit",
    env,
  });
  if (result.status !== 0) failed += 1;
}

console.log("");
if (failed === 0) {
  console.log("\u001b[32m✅ 全部测试通过\u001b[0m");
} else {
  console.log(`\u001b[31m❌ 有 ${failed} 个测试文件失败\u001b[0m`);
}
process.exit(failed === 0 ? 0 : 1);
