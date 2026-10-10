/**
 * 简卡铺 · 客户服务
 * ---------------------------------------------------------------------------
 * 本站的「客户」不是注册账号，而是**下单时填的那个联系方式**。
 * 同一个人用同一个联系方式多次下单，在后台就是同一个客户。
 *
 * 也正因为没有登录，所以**没有封禁这一说**——封了也没意义，
 * 他换个联系方式照样能买。后台能做的是「查」：查他买过什么、从哪个 IP 买的。
 *
 * 累计消费只统计真正付过款的订单（已发货 / 处理中），
 * 待付款与已关闭的不计入，否则数字会虚高。
 */
import { all, get, run, scalar } from "../db.js";
import { notFound, badRequest } from "../lib/errors.js";
import { nowStr } from "../lib/time.js";
import { orderBy } from "../lib/validate.js";

const PAID = "('已发货','处理中')";

/** 客户列表的可选排序；键来自前端 query，只能从这里取 */
const USER_SORTS = {
  default: "u.id DESC",
  newest: "u.id DESC",
  oldest: "u.id ASC",
  created_desc: "u.id DESC",
  created_asc: "u.id ASC",
  amount_desc: "total_amount DESC, u.id DESC",
  amount_asc: "total_amount ASC, u.id DESC",
  orders_desc: "order_count DESC, u.id DESC",
  orders_asc: "order_count ASC, u.id DESC",
  recent: "u.last_at DESC NULLS LAST, u.id DESC",
  last_asc: "u.last_at ASC NULLS LAST, u.id DESC",
  last_desc: "u.last_at DESC NULLS LAST, u.id DESC",
  name_asc: "u.name ASC, u.id ASC",
  name_desc: "u.name DESC, u.id ASC",
};

function toApi(row) {
  return {
    id: row.uid,
    dbId: Number(row.id),
    name: row.name,
    contact: row.contact,
    orders: Number(row.order_count || 0),
    amount: Math.round(Number(row.total_amount || 0) * 100) / 100,
    /** 最近一次下单的 IP；没有订单时回落到底单时记录的 IP */
    lastIp: row.last_ip || "",
    regAt: row.reg_at,
    lastAt: row.last_at || "",
  };
}

/** 列表里要带上的聚合列，供列表与详情复用 */
const AGGREGATE = `
  (SELECT COUNT(*) FROM orders o WHERE o.contact = u.contact AND o.status IN ${PAID}) AS order_count,
  (SELECT COALESCE(SUM(o.amount), 0) FROM orders o WHERE o.contact = u.contact AND o.status IN ${PAID}) AS total_amount,
  COALESCE(
    (SELECT o.client_ip FROM orders o WHERE o.contact = u.contact AND o.client_ip <> '' ORDER BY o.id DESC LIMIT 1),
    u.last_ip
  ) AS last_ip
`;

export async function list({
  keyword = "",
  sort = "default",
  page = 1,
  perPage = 8,
} = {}) {
  const where = [];
  const params = [];

  if (keyword) {
    where.push("(u.name ILIKE ? OR u.contact ILIKE ? OR u.uid ILIKE ?)");
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await scalar(`SELECT COUNT(*) AS c FROM users u ${clause}`, ...params)) ?? 0);

  const safePage = Math.max(1, page);
  const order = orderBy(sort, USER_SORTS, "default");

  const rows = await all(
    `SELECT u.*, ${AGGREGATE}
       FROM users u
       ${clause}
      ORDER BY ${order}
      LIMIT ? OFFSET ?`,
    ...params,
    perPage,
    (safePage - 1) * perPage
  );

  return { rows: rows.map(toApi), total, page: safePage, perPage };
}

export async function stats() {
  const row = await get(`
    SELECT (SELECT COUNT(*) FROM users)                                         AS total,
           (SELECT COUNT(*) FROM users WHERE last_at IS NOT NULL)               AS active,
           (SELECT COALESCE(SUM(amount), 0) FROM orders WHERE status IN ${PAID}) AS amount
  `);

  const total = Number(row?.total || 0);
  const active = Number(row?.active || 0);

  return {
    total,
    active,
    /* 有多少客户下过单 —— 比「活跃」更有意义的数字 */
    converted: Number(
      (await scalar(
        `SELECT COUNT(DISTINCT contact) AS c FROM orders WHERE status IN ${PAID} AND contact <> ''`
      )) ?? 0
    ),
    amount: Math.round(Number(row?.amount || 0) * 100) / 100,
  };
}

/* ------------------------------------------------------------ 客户详情 */

/**
 * 单个客户的完整档案：基本信息 + 消费汇总 + 逐笔订单（含下单 IP）。
 *
 * 订单**不按 PAID 过滤**——后台需要看到待付款、已关闭的全貌，
 * 只是金额汇总仍然只算已付款的。
 */
export async function detail(uid) {
  const row = await get(`SELECT u.*, ${AGGREGATE} FROM users u WHERE u.uid = ?`, uid);
  if (!row) throw notFound("客户不存在");

  const orders = await all(
    `SELECT o.order_no, o.product_id, o.product_name, o.spec, o.qty, o.unit_price,
            o.amount, o.pay_method, o.status, o.contact, o.client_ip,
            o.created_at, o.paid_at, o.closed_at
       FROM orders o
      WHERE o.contact = ?
      ORDER BY o.id DESC
      LIMIT 200`,
    row.contact
  );

  /* 用过的所有 IP，去重后给出去重次数，便于判断是否共用联系方式 */
  const ipRows = await all(
    `SELECT client_ip, COUNT(*) AS c, MAX(created_at) AS last_at
       FROM orders
      WHERE contact = ? AND client_ip <> ''
      GROUP BY client_ip
      ORDER BY c DESC, last_at DESC`,
    row.contact
  );

  const paidOrders = orders.filter((o) => ["已发货", "处理中"].includes(o.status));

  return {
    customer: toApi(row),
    summary: {
      totalOrders: orders.length,
      paidOrders: paidOrders.length,
      totalAmount: Math.round(Number(row.total_amount || 0) * 100) / 100,
      firstOrderAt: orders.length > 0 ? orders[orders.length - 1].created_at : "",
      lastOrderAt: orders.length > 0 ? orders[0].created_at : "",
      ipCount: ipRows.length,
    },
    ips: ipRows.map((r) => ({
      ip: r.client_ip,
      count: Number(r.c),
      lastAt: r.last_at,
    })),
    orders: orders.map((o) => ({
      no: o.order_no,
      productId: o.product_id,
      product: o.product_name,
      spec: o.spec || "",
      qty: Number(o.qty),
      unitPrice: Number(o.unit_price),
      amount: Number(o.amount),
      pay: o.pay_method,
      status: o.status,
      ip: o.client_ip || "",
      time: o.created_at,
      paidAt: o.paid_at || "",
      closedAt: o.closed_at || "",
    })),
  };
}

export async function findByUid(uid) {
  const row = await get(`SELECT u.*, ${AGGREGATE} FROM users u WHERE u.uid = ?`, uid);
  if (!row) return null;
  return toApi(row);
}

/**
 * 下单时按联系方式自动建档 / 更新最近活跃时间与 IP。
 *
 * 联系方式为空（买家没填）就不建档 —— 否则所有不填联系方式的订单
 * 会挤在同一个「空联系方式的客户」下，毫无意义。
 */
export async function touchByContact(contact, ip = "") {
  const value = String(contact ?? "").trim();
  if (!value) return null;

  const clientIp = String(ip ?? "").trim().slice(0, 60);
  const existing = await get("SELECT * FROM users WHERE contact = ?", value);

  if (existing) {
    await run(
      "UPDATE users SET last_at = ?, last_ip = ? WHERE id = ?",
      nowStr(),
      clientIp || existing.last_ip || "",
      existing.id
    );
    return existing.uid;
  }

  const count = Number((await scalar("SELECT COUNT(*) AS c FROM users")) ?? 0);
  const uid = `U${100300 + count}`;
  /* 名字取联系方式的末尾，电话/邮箱都能看出点线索 */
  const label = value.length > 8 ? value.slice(-8) : value;

  await run(
    "INSERT INTO users (uid, name, contact, status, last_ip, reg_at, last_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
    uid, `客户 ${label}`, value, clientIp, nowStr(), nowStr()
  );
  return uid;
}

/**
 * 批量删除客户档案。
 * 订单表自存联系方式、不引用本表，删除档案不影响任何订单与追溯。
 * @param {string[]} uids
 * @returns {Promise<{affected: number}>}
 */
export async function batchRemove(uids) {
  const list = [...new Set((uids ?? []).map((v) => String(v ?? "").trim()).filter(Boolean))];
  if (list.length === 0) throw badRequest("请至少选择一个客户");
  if (list.length > 200) throw badRequest("一次最多删除 200 条客户档案");

  const result = await run("DELETE FROM users WHERE uid = ANY(?)", list);
  return { affected: result.changes };
}

export default { list, stats, detail, findByUid, touchByContact, batchRemove };
