/**
 * 简卡铺 · 口令散列与会话令牌
 * ---------------------------------------------------------------------------
 * 只使用 Node 内置的 node:crypto：
 *   - 口令用 scrypt + 随机盐，格式 scrypt$N$r$p$salt$hash
 *   - 会话令牌、验证码用 crypto.randomBytes / randomInt
 *   - 校验用 timingSafeEqual，避免计时侧信道
 */
import {
  randomBytes,
  randomInt,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import config from "../config.js";

const scrypt = promisify(scryptCb);

/**
 * 生成口令散列
 * @param {string} password 明文口令
 * @returns {Promise<string>} 形如 scrypt$16384$8$1$<saltHex>$<hashHex>
 */
export async function hashPassword(password) {
  const { N, r, p, keylen } = config.scrypt;
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * 校验口令
 * @param {string} password 明文口令
 * @param {string} stored   数据库中保存的散列
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");

  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let derived;
  try {
    derived = await scrypt(password, salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** 生成 URL 安全的随机令牌（用于会话） */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

/**
 * 生成验证码文本
 * 去掉了容易看错的 0/O/1/I/L
 */
export function randomCaptchaCode(length = 4) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXY23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** 生成卡密（演示用的自动补货） */
export function randomCardSecret(prefix = "JKP", groups = 4, size = 4) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const parts = [];
  if (prefix) parts.push(prefix);
  for (let g = 0; g < groups; g += 1) {
    let s = "";
    for (let i = 0; i < size; i += 1) s += alphabet[randomInt(alphabet.length)];
    parts.push(s);
  }
  return parts.join("-");
}

/** 生成订单号：前缀 + 年月日 + 5 位随机 */
export function randomOrderNo(prefix = "JKP", date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  let suffix = "";
  for (let i = 0; i < 5; i += 1) suffix += randomInt(10);
  return `${prefix}${y}${m}${d}${suffix}`;
}

/** 生成 API 用的短 id */
export function randomId(bytes = 12) {
  return randomBytes(bytes).toString("base64url");
}

export default {
  hashPassword,
  verifyPassword,
  randomToken,
  randomCaptchaCode,
  randomCardSecret,
  randomOrderNo,
  randomId,
};
