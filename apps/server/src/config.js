/**
 * 简卡铺 · 服务端配置
 * ---------------------------------------------------------------------------
 * 所有可调参数集中在这里，生产环境请通过环境变量覆盖。
 */
import path from "node:path";

/** jiankapu/ 项目根目录 */
const ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * 运行期数据目录（上传文件等）
 * 数据库已迁移到 PostgreSQL，这里只留文件类数据。
 */
const DATA_DIR = process.env.JKP_DATA_DIR
  ? path.resolve(process.env.JKP_DATA_DIR)
  : path.join(ROOT, "apps/server/data");

/* ------------------------------------------------------------------ 端口 */

const sitePort = Number(process.env.SITE_PORT || 2001);
const adminPort = Number(process.env.ADMIN_PORT || 2002);
const host = process.env.HOST || "127.0.0.1";

/* -------------------------------------------------------------- 数据库 */

/**
 * PostgreSQL 连接配置
 * 优先使用 DATABASE_URL，否则用 PG* 系列变量，最后回落到本地开发默认值。
 *
 * ⚠️ 生产环境请务必通过环境变量注入，不要把密码写进代码仓库。
 */
const dbConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST || "127.0.0.1",
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "123456",
      database: process.env.PGDATABASE || "jiankapu_dev",
    };

export const config = {
  env: process.env.NODE_ENV || "development",

  /** 两个对外服务：前台商城与后台管理 */
  servers: {
    site: {
      role: "site",
      name: "前台商城",
      host,
      port: sitePort,
      baseUrl: process.env.SITE_BASE_URL || `http://localhost:${sitePort}`,
    },
    admin: {
      role: "admin",
      name: "管理后台",
      host,
      port: adminPort,
      baseUrl: process.env.ADMIN_BASE_URL || `http://localhost:${adminPort}`,
    },
    /** 单端口模式：前台走 /，后台走 /admin 前缀（免费云平台通常只暴露一个端口） */
    single: {
      role: "single",
      name: "单端口（前台 + 后台）",
      host,
      port: Number(process.env.PORT || process.env.SINGLE_PORT || sitePort),
      baseUrl: process.env.SITE_BASE_URL || `http://localhost:${sitePort}`,
    },
  },

  db: {
    ...dbConfig,
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  },

  paths: {
    root: ROOT,
    /** React + Vite 前端工程 */
    webApp: path.join(ROOT, "apps/web-react"),
    /**
     * Vite 构建产物（服务端实际对外提供的静态目录）。
     * 可以用 WEB_DIST_DIR 覆盖，便于把前端产物独立部署到别处。
     */
    webDist: process.env.WEB_DIST_DIR
      ? path.resolve(process.env.WEB_DIST_DIR)
      : path.join(ROOT, "apps/web-react/dist"),
    /** 旧版静态前端，仅作参考，可删除 */
    legacyWeb: path.join(ROOT, "apps/web"),
    server: path.join(ROOT, "apps/server"),
    data: DATA_DIR,
  },

  /** 会话 */
  session: {
    cookieName: "jkp_session",
    ttlMinutes: Number(process.env.SESSION_TTL_MINUTES || 120),
    /** 生产环境必须用环境变量覆盖 */
    secret: process.env.SESSION_SECRET || "jiankapu-dev-secret-please-change",
  },

  /** 口令散列 */
  scrypt: {
    N: 16384,
    r: 8,
    p: 1,
    keylen: 64,
  },

  /** 订单 */
  order: {
    defaultPrefix: "JKP",
    defaultPayWindowMinutes: 15,
    /** 单笔最大数量，防止恶意刷单占满库存 */
    maxQtyPerOrder: 50,
  },

  /** 登录保护 */
  login: {
    defaultThreshold: 5,
    lockMinutes: 15,
    captchaTtlMinutes: 5,
  },

  /** 静态资源缓存（秒），开发环境给 0 方便调试 */
  staticCacheSeconds: process.env.NODE_ENV === "production" ? 3600 : 0,

  /** 清理任务间隔（秒）：关闭超时订单、清理过期会话与验证码 */
  sweepIntervalSeconds: Number(process.env.SWEEP_INTERVAL_SECONDS || 30),
};

export default config;
