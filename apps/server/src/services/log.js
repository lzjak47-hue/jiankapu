/**
 * 简卡铺 · 操作日志
 * ---------------------------------------------------------------------------
 * 每一次写操作都应留痕：谁、在什么时间、做了什么、对谁、结果如何。
 * 注意 `logs.time` 列是 TEXT，写入的是本地时间字符串 "YYYY-MM-DD HH:mm:ss"。
 */
import { all, run, scalar } from "../db.js";
import { nowStr } from "../lib/time.js";

/**
 * 写入一条日志
 * @param {object} entry
 * @param {string} entry.actor  操作人（管理员用户名，或 system）
 * @param {string} entry.action 操作描述
 * @param {string} [entry.target] 操作对象
 * @param {string} [entry.ip]
 * @param {string} [entry.result] 成功 / 失败
 */
export async function write({
  actor = "system",
  action,
  target = "",
  ip = "",
  result = "成功",
}) {
  await run(
    "INSERT INTO logs (time, actor, action, target, ip, result) VALUES (?, ?, ?, ?, ?, ?)",
    nowStr(),
    String(actor).slice(0, 40),
    String(action || "").slice(0, 80),
    String(target || "").slice(0, 120),
    String(ip || "").slice(0, 60),
    String(result).slice(0, 20)
  );
}

/** 分页查询日志 */
export async function list({ keyword = "", result = "", page = 1, perPage = 10 } = {}) {
  const where = [];
  const params = [];

  if (keyword) {
    where.push("(action ILIKE ? OR target ILIKE ? OR actor ILIKE ?)");
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  if (result) {
    where.push("result = ?");
    params.push(result);
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await scalar(`SELECT COUNT(*) AS c FROM logs ${clause}`, ...params)) ?? 0);

  const safePage = Math.max(1, page);
  const rows = await all(
    `SELECT id, time, actor, action, target, ip, result FROM logs ${clause}
     ORDER BY id DESC LIMIT ? OFFSET ?`,
    ...params,
    perPage,
    (safePage - 1) * perPage
  );

  return { rows, total, page: safePage, perPage };
}

/** 最近的操作记录（用于概览或安全审计） */
export async function recent(limit = 5) {
  return all(
    "SELECT time, actor, action, target, ip, result FROM logs ORDER BY id DESC LIMIT ?",
    limit
  );
}

export default { write, list, recent };
