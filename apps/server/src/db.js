/**
 * 简卡铺 · 数据库（PostgreSQL）
 * ---------------------------------------------------------------------------
 * 三个设计要点：
 *
 * 1. **占位符自动转换**：业务层统一写 SQLite 风格的 `?`，这里转成 PG 的 `$1,$2`。
 *    好处是 SQL 可读性更好，且迁移时业务代码几乎不用动。SQL 里请勿出现字面量 `?`。
 *
 * 2. **事务用 AsyncLocalStorage 透传**：`tx(async () => { ... })` 里的所有
 *    `get/all/run` 会自动走同一个连接，业务层无需显式传递 client。
 *
 * 3. **类型解析器**：NUMERIC 与 BIGINT 默认会被 pg 返回成字符串，
 *    这里统一转成 Number，避免金额出现 `"12.80"` 这种字符串参与计算。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import config from "./config.js";
import { logger } from "./lib/logger.js";

/* ---------------------------------------------------------------- 加载 pg */

const require = createRequire(import.meta.url);
let pg;
try {
  pg = require("pg");
} catch (err) {
  throw new Error(
    "缺少 PostgreSQL 客户端依赖 `pg`。请在项目根目录执行安装：\n" +
      "    pnpm install      （或 npm install）\n" +
      `原始错误：${err.message}`
  );
}

/* ------------------------------------------------------------ 类型解析器 */

// OID 1700 = NUMERIC，OID 20 = BIGINT
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

/* ---------------------------------------------------------------- 连接池 */

export const pool = new pg.Pool(config.db);

pool.on("error", (err) => {
  logger.error("PostgreSQL 连接池发生错误", err);
});

/** 当前事务的连接（若不在事务中则为 undefined） */
const txStorage = new AsyncLocalStorage();

/** 把 `?` 依次转成 `$1, $2, …` */
function toPg(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/** 执行一条 SQL：事务中走事务连接，否则走连接池 */
export function query(sql, params = []) {
  const client = txStorage.getStore();
  return (client || pool).query(toPg(sql), params);
}

/* ------------------------------------------------------------ 查询助手 */

/** 查询单行，无结果返回 undefined */
export async function get(sql, ...params) {
  const result = await query(sql, params);
  return result.rows[0];
}

/** 查询多行 */
export async function all(sql, ...params) {
  const result = await query(sql, params);
  return result.rows;
}

/**
 * 执行写操作
 * @returns {Promise<{changes:number, lastInsertRowid:number}>}
 *   需要拿到自增 ID 时，请在 SQL 末尾加 `RETURNING id`
 */
export async function run(sql, ...params) {
  const result = await query(sql, params);
  return {
    changes: result.rowCount ?? 0,
    lastInsertRowid: result.rows[0]?.id ?? 0,
  };
}

/** 取单个标量值 */
export async function scalar(sql, ...params) {
  const row = await get(sql, ...params);
  if (!row) return undefined;
  return Object.values(row)[0];
}

/**
 * 事务包装：回调抛错自动回滚。
 * 回调内所有的 get/all/run 都会自动使用同一个连接。
 *
 *   await tx(async () => {
 *     const info = await run("INSERT INTO orders (...) VALUES (?, ?) RETURNING id", a, b);
 *     await run("UPDATE cards SET order_id = ? WHERE id = ?", info.lastInsertRowid, cardId);
 *   });
 */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await txStorage.run(client, () => fn());
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      logger.error("事务回滚失败", rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ 建表 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id             SERIAL PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  nickname       TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT '超级管理员',
  password_hash  TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  last_login_at  TEXT,
  last_login_ip  TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  admin_id    INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip           TEXT PRIMARY KEY,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS captchas (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  sort    INTEGER NOT NULL DEFAULT 99,
  status  INTEGER NOT NULL DEFAULT 1,
  remark  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS announcements (
  id      SERIAL PRIMARY KEY,
  text    TEXT NOT NULL,
  status  INTEGER NOT NULL DEFAULT 1,
  sort    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  category_id  TEXT NOT NULL,
  emoji        TEXT NOT NULL DEFAULT '📦',
  price        NUMERIC(12,2) NOT NULL DEFAULT 0,
  old_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock        INTEGER NOT NULL DEFAULT 0,
  sold         INTEGER NOT NULL DEFAULT 0,
  status       INTEGER NOT NULL DEFAULT 1,
  badge        TEXT NOT NULL DEFAULT '',
  badge_type   TEXT NOT NULL DEFAULT '',
  specs        TEXT NOT NULL DEFAULT '[]',
  unit         TEXT NOT NULL DEFAULT '件',
  description  TEXT NOT NULL DEFAULT '',
  detail       TEXT NOT NULL DEFAULT '',
  notice       TEXT NOT NULL DEFAULT '[]',
  tutorial     TEXT NOT NULL DEFAULT '[]',
  delivery     TEXT NOT NULL DEFAULT '自动发货',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id          SERIAL PRIMARY KEY,
  product_id  TEXT NOT NULL,
  spec        TEXT NOT NULL DEFAULT '',
  secret      TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT '未售',
  imported_at TEXT NOT NULL,
  sold_at     TEXT,
  order_id    INTEGER
);

CREATE TABLE IF NOT EXISTS orders (
  id            SERIAL PRIMARY KEY,
  order_no      TEXT NOT NULL UNIQUE,
  product_id    TEXT NOT NULL,
  product_name  TEXT NOT NULL,
  spec          TEXT NOT NULL DEFAULT '',
  qty           INTEGER NOT NULL,
  unit_price    NUMERIC(12,2) NOT NULL,
  amount        NUMERIC(12,2) NOT NULL,
  contact       TEXT NOT NULL DEFAULT '',
  pay_method    TEXT NOT NULL DEFAULT '微信支付',
  pay_channel   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT '待付款',
  pay_url       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  paid_at       TEXT,
  closed_at     TEXT,
  client_ip     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS order_cards (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  card_id  INTEGER NOT NULL,
  secret   TEXT NOT NULL,
  PRIMARY KEY (order_id, card_id)
);

CREATE TABLE IF NOT EXISTS users (
  id       SERIAL PRIMARY KEY,
  uid      TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  contact  TEXT NOT NULL DEFAULT '',
  status   INTEGER NOT NULL DEFAULT 1,
  last_ip  TEXT NOT NULL DEFAULT '',
  reg_at   TEXT NOT NULL,
  last_at  TEXT
);

CREATE TABLE IF NOT EXISTS logs (
  id      SERIAL PRIMARY KEY,
  time    TEXT NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  target  TEXT NOT NULL DEFAULT '',
  ip      TEXT NOT NULL DEFAULT '',
  result  TEXT NOT NULL DEFAULT '成功'
);

CREATE INDEX IF NOT EXISTS idx_cards_product_status ON cards(product_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_no            ON orders(order_no);
CREATE INDEX IF NOT EXISTS idx_orders_status        ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created       ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_product       ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_logs_time            ON logs(time);
CREATE INDEX IF NOT EXISTS idx_sessions_expires     ON sessions(expires_at);
`;

/**
 * 增量迁移
 * ---------------------------------------------------------------------------
 * `CREATE TABLE IF NOT EXISTS` 对已存在的表是空操作，**不会补列**。
 * 所以结构演进必须用幂等的 DDL 显式执行一次，老库才能平滑升级。
 *
 * ⚠️ 依赖新列的索引必须写在这里，不能写进 SCHEMA：
 * SCHEMA 先执行，那时老库还没有这一列，建索引会直接报
 * `column "spec" does not exist`。
 */
const MIGRATIONS = `
-- v1.1：卡密从「商品」维度细化到「商品 + 规格」维度
ALTER TABLE cards ADD COLUMN IF NOT EXISTS spec TEXT NOT NULL DEFAULT '';
-- 按「商品 + 规格 + 状态」取卡密，是下单锁卡的热路径
CREATE INDEX IF NOT EXISTS idx_cards_stock ON cards(product_id, spec, status);

-- v1.2：客户档案记录最近一次下单 IP，便于后台核对与排查
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ip TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_orders_contact ON orders(contact);

-- v1.3：支付渠道独立成列。
-- pay_method 保留给人看（「微信支付」），pay_channel 给程序判断（wechat/alipay/test），
-- 老订单按中文标签回填。
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_channel TEXT NOT NULL DEFAULT '';
UPDATE orders SET pay_channel = CASE pay_method
    WHEN '微信支付' THEN 'wechat'
    WHEN '支付宝'   THEN 'alipay'
    ELSE 'test'
  END
 WHERE pay_channel = '';
`;

/**
 * 建表 + 迁移 + 连通性自检
 * 启动时调用一次；表已存在则跳过建表，但仍会执行迁移。
 */
export async function initDatabase() {
  const started = Date.now();
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    throw new Error(
      `无法连接 PostgreSQL（${config.db.database} @ ${config.db.host}:${config.db.port}）：${err.message}\n` +
        "请确认数据库服务已启动，且 .env / 环境变量中的连接信息正确。"
    );
  }

  await pool.query(SCHEMA);
  await pool.query(MIGRATIONS);

  const version = await scalar("SELECT version()");
  logger.info(
    `PostgreSQL 已连接：${config.db.database}（${String(version).split(",")[0]}，建表 ${Date.now() - started}ms）`
  );
}

/** 关闭连接池（优雅退出时调用） */
export async function closePool() {
  await pool.end();
}

export default { pool, query, get, all, run, scalar, tx, initDatabase, closePool };
