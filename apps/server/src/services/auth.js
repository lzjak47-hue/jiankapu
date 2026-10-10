/**
 * 简卡铺 · 后台认证
 * ---------------------------------------------------------------------------
 *  - 口令：scrypt 散列，登录时用 timingSafeEqual 比对
 *  - 会话：服务端 sessions 表 + HttpOnly Cookie，令牌随机 32 字节
 *  - 验证码：服务端生成 SVG，一次性使用，默认 5 分钟过期
 *  - 登录保护：按 IP 统计失败次数，超阈值临时锁定
 */
import { all, get, run } from "../db.js";
import { unauthorized, forbidden, badRequest, tooMany, notFound } from "../lib/errors.js";
import { verifyPassword, hashPassword, randomToken, randomId, randomCaptchaCode } from "../lib/crypto.js";
import { nowStr, strAfterMinutes, isExpired } from "../lib/time.js";
import { str } from "../lib/validate.js";
import config from "../config.js";
import * as settingsService from "./settings.js";

/* ------------------------------------------------------------------ 验证码 */

const SVG_ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escSvg = (s) => String(s).replace(/[&<>"']/g, (c) => SVG_ESCAPE[c]);
const rnd = (min, max) => min + Math.random() * (max - min);

/** 生成验证码 SVG（不依赖任何图形库） */
function renderCaptchaSvg(code) {
  const W = 104;
  const H = 46;
  const palette = ["#2A5BE0", "#3B6EF6", "#1F49C4", "#5B3FE0"];
  const parts = [
    `<rect width="${W}" height="${H}" fill="#EEF4FF"/>`,
    `<rect width="${W}" height="${H}" fill="none" stroke="#DBE7FF"/>`,
  ];

  // 干扰线
  for (let i = 0; i < 5; i += 1) {
    parts.push(
      `<line x1="${rnd(0, W).toFixed(1)}" y1="${rnd(0, H).toFixed(1)}" ` +
        `x2="${rnd(0, W).toFixed(1)}" y2="${rnd(0, H).toFixed(1)}" ` +
        `stroke="#9DBBFF" stroke-width="1" opacity="0.7"/>`
    );
  }
  // 干扰点
  for (let i = 0; i < 26; i += 1) {
    parts.push(
      `<circle cx="${rnd(0, W).toFixed(1)}" cy="${rnd(0, H).toFixed(1)}" r="${rnd(0.6, 1.6).toFixed(1)}" fill="#8FB0FF" opacity="0.65"/>`
    );
  }
  // 字符
  code.split("").forEach((ch, i) => {
    const x = 15 + i * 23 + rnd(-2.5, 2.5);
    const y = 32 + rnd(-3.5, 3.5);
    const rotate = rnd(-17, 17).toFixed(1);
    const color = palette[Math.floor(Math.random() * palette.length)];
    parts.push(
      `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ` +
        `font-family="Georgia,'Times New Roman',serif" font-size="25" font-weight="700" ` +
        `fill="${color}" transform="rotate(${rotate} ${x.toFixed(1)} ${y.toFixed(1)})">${escSvg(ch)}</text>`
    );
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="验证码">${parts.join("")}</svg>`;
}

/** 新建一个验证码，返回 id 与 SVG 图 */
export async function createCaptcha() {
  const id = randomId(12);
  const code = randomCaptchaCode(4);
  const expiresAt = strAfterMinutes(config.login.captchaTtlMinutes);

  await run("DELETE FROM captchas WHERE expires_at <= ?", nowStr());
  await run("INSERT INTO captchas (id, code, expires_at) VALUES (?, ?, ?)", id, code, expiresAt);

  return { id, svg: renderCaptchaSvg(code), expiresInSeconds: config.login.captchaTtlMinutes * 60 };
}

/**
 * 校验验证码（一次性）
 * @returns {Promise<boolean>}
 */
export async function verifyCaptcha(id, input) {
  if (!settingsService.getBool("security.captcha", true)) return true;

  const captchaId = str(id, { field: "验证码标识", max: 40 });
  const code = str(input, { field: "验证码", max: 8 }).toUpperCase();

  const row = await get("SELECT * FROM captchas WHERE id = ?", captchaId);
  if (!row) return false;

  // 一次性：无论对错都消费掉，防止暴力枚举
  await run("DELETE FROM captchas WHERE id = ?", captchaId);

  if (isExpired(row.expires_at)) return false;
  if (row.used) return false;
  return row.code.toUpperCase() === code;
}

/* ---------------------------------------------------------------- 登录保护 */

function lockThreshold() {
  return Math.max(
    1,
    settingsService.getNumber("security.lockThreshold", config.login.defaultThreshold)
  );
}

function lockEnabled() {
  return settingsService.getBool("security.loginFailLock", true);
}

/** 是否处于锁定状态 */
export async function checkLock(ip) {
  if (!lockEnabled()) return { locked: false };
  const row = await get("SELECT * FROM login_attempts WHERE ip = ?", ip);
  if (!row) return { locked: false };
  if (row.locked_until && !isExpired(row.locked_until)) {
    return { locked: true, until: row.locked_until };
  }
  return { locked: false };
}

/** 记录一次失败 */
export async function recordFail(ip) {
  const row = await get("SELECT * FROM login_attempts WHERE ip = ?", ip);
  const threshold = lockThreshold();
  const now = nowStr();

  if (!row) {
    await run(
      "INSERT INTO login_attempts (ip, fail_count, locked_until, updated_at) VALUES (?, 1, NULL, ?)",
      ip, now
    );
    return { failCount: 1, locked: false };
  }

  const count = Number(row.fail_count) + 1;
  let lockedUntil = null;
  if (lockEnabled() && count >= threshold) {
    lockedUntil = strAfterMinutes(config.login.lockMinutes);
  }
  await run(
    "UPDATE login_attempts SET fail_count = ?, locked_until = ?, updated_at = ? WHERE ip = ?",
    count, lockedUntil, now, ip
  );
  return { failCount: count, locked: Boolean(lockedUntil), until: lockedUntil };
}

/** 登录成功清除失败计数 */
export async function clearFail(ip) {
  await run("DELETE FROM login_attempts WHERE ip = ?", ip);
}

/* -------------------------------------------------------------------- 会话 */

function sessionTtlMinutes() {
  return Math.max(
    5,
    settingsService.getNumber("security.sessionTimeout", config.session.ttlMinutes)
  );
}

/** 创建会话 */
export async function createSession(adminId, { ip = "", userAgent = "" } = {}) {
  const token = randomToken(32);
  const ttl = sessionTtlMinutes();
  await run(
    "INSERT INTO sessions (token, admin_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)",
    token, adminId, nowStr(), strAfterMinutes(ttl), String(ip).slice(0, 60), String(userAgent).slice(0, 200)
  );
  return { token, ttlSeconds: ttl * 60 };
}

/** 解析会话 */
export async function getSession(token) {
  if (!token) return null;

  const row = await get(
    `SELECT s.token, s.expires_at, a.id AS admin_id, a.username, a.nickname, a.role,
            a.last_login_at, a.last_login_ip
       FROM sessions s
       JOIN admins a ON a.id = s.admin_id
      WHERE s.token = ?`,
    token
  );
  if (!row) return null;

  if (isExpired(row.expires_at)) {
    await run("DELETE FROM sessions WHERE token = ?", token);
    return null;
  }

  return {
    token: row.token,
    admin: {
      id: Number(row.admin_id),
      username: row.username,
      nickname: row.nickname,
      role: row.role,
      lastLoginAt: row.last_login_at || "",
      lastLoginIp: row.last_login_ip || "",
    },
  };
}

/** 销毁会话 */
export async function destroySession(token) {
  if (!token) return false;
  const info = await run("DELETE FROM sessions WHERE token = ?", token);
  return info.changes > 0;
}

/** 清理过期会话 */
export async function purgeExpiredSessions() {
  const info = await run("DELETE FROM sessions WHERE expires_at <= ?", nowStr());
  return info.changes;
}

/* -------------------------------------------------------------------- 登录 */

/**
 * 管理员登录
 * @returns {Promise<{ token, ttlSeconds, admin }>}
 */
export async function login({
  username,
  password,
  captchaId,
  captchaCode,
  ip = "",
  userAgent = "",
}) {
  const name = str(username, { field: "管理员账号", max: 40 });
  const pass = str(password, { field: "登录密码", max: 100 });

  const lock = await checkLock(ip);
  if (lock.locked) {
    throw tooMany(`登录失败次数过多，已锁定至 ${lock.until}`, { until: lock.until });
  }

  if (!(await verifyCaptcha(captchaId, captchaCode))) {
    await recordFail(ip);
    throw badRequest("验证码错误或已过期");
  }

  const admin = await get("SELECT * FROM admins WHERE username = ?", name);
  // 账号不存在时也走一次假的散列比对，避免通过响应时间枚举账号
  const ok = admin
    ? await verifyPassword(pass, admin.password_hash)
    : await verifyPassword(pass, "scrypt$16384$8$1$00$00");

  if (!admin || !ok) {
    const result = await recordFail(ip);
    throw unauthorized(
      result.locked ? `密码错误次数过多，账号已锁定至 ${result.until}` : "账号或密码错误"
    );
  }

  await clearFail(ip);
  const session = await createSession(admin.id, { ip, userAgent });
  await run(
    "UPDATE admins SET last_login_at = ?, last_login_ip = ? WHERE id = ?",
    nowStr(), String(ip).slice(0, 60), admin.id
  );

  return {
    token: session.token,
    ttlSeconds: session.ttlSeconds,
    admin: {
      id: Number(admin.id),
      username: admin.username,
      nickname: admin.nickname,
      role: admin.role,
      lastLoginAt: nowStr(),
      lastLoginIp: ip,
    },
  };
}

/** 修改当前管理员密码 */
export async function changePassword(adminId, { oldPassword, newPassword }) {
  const admin = await get("SELECT * FROM admins WHERE id = ?", adminId);
  if (!admin) throw notFound("管理员不存在");

  const oldPass = str(oldPassword, { field: "当前密码", max: 100 });
  const newPass = str(newPassword, { field: "新密码", min: 6, max: 100 });

  const ok = await verifyPassword(oldPass, admin.password_hash);
  if (!ok) throw forbidden("当前密码不正确");

  const hash = await hashPassword(newPass);
  await run("UPDATE admins SET password_hash = ? WHERE id = ?", hash, adminId);

  // 修改密码后使其它会话失效
  await run("DELETE FROM sessions WHERE admin_id = ?", adminId);
  return true;
}

/** 列出所有管理员（不含口令散列） */
export async function listAdmins() {
  const rows = await all(
    "SELECT id, username, nickname, role, created_at, last_login_at, last_login_ip FROM admins"
  );
  return rows.map((r) => ({
    id: Number(r.id),
    username: r.username,
    nickname: r.nickname,
    role: r.role,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at || "",
    lastLoginIp: r.last_login_ip || "",
  }));
}

export default {
  createCaptcha, verifyCaptcha,
  checkLock, recordFail, clearFail,
  createSession, getSession, destroySession, purgeExpiredSessions,
  login, changePassword, listAdmins,
};
