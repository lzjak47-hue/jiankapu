/**
 * 简卡铺 · 后台提醒
 * ---------------------------------------------------------------------------
 * 给后台顶栏的铃铛提供事件流：
 *   · 新订单   —— 前台有人下单就冒出来
 *   · 库存预警 —— 可用库存低于阈值
 *   · 已售罄   —— 可用库存为 0，商品还在架上，等于白白流失订单
 *
 * 刻意**不建已读状态表**：客户端的「上次查看时间」存在浏览器里，
 * 请求时带上 since 即可。这样多管理员各看各的，也不用为一张小表做迁移。
 */
import { all, get, scalar } from "../db.js";
import { nowStr } from "../lib/time.js";
import * as settingsService from "./settings.js";

export async function feed({ since = "", orderLimit = 20, stockLimit = 20 } = {}) {
  const serverTime = nowStr();
  const threshold = settingsService.getNumber("trade.lowStockWarn", 20);

  /* ---------------------------------------------------------- 新订单 */

  const sinceClause = since ? "AND created_at > ?" : "";
  const sinceParams = since ? [since] : [];

  const unseenRow = await get(
    `SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS amount
       FROM orders
      WHERE status IN ('已发货', '处理中') ${sinceClause}`,
    ...sinceParams
  );

  const recentOrders = await all(
    `SELECT order_no, product_name, spec, qty, amount, contact, client_ip, status, created_at
       FROM orders
      WHERE status IN ('已发货', '处理中') ${sinceClause}
      ORDER BY id DESC
      LIMIT ?`,
    ...sinceParams,
    orderLimit
  );

  /* -------------------------------------------------------- 库存预警 */

  /* 只关心在架商品：下架商品库存再低也不用提醒 */
  const lowStockRows = await all(
    `SELECT id, name, emoji, stock, status
       FROM products
      WHERE status = 1 AND stock <= ?
      ORDER BY stock ASC, id ASC
      LIMIT ?`,
    threshold,
    stockLimit
  );

  const lowStock = lowStockRows.map((p) => ({
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    stock: Number(p.stock),
    soldOut: Number(p.stock) <= 0,
  }));

  /* ------------------------------------------------------ 待处理订单 */

  /* 卡了很久还没付款的订单，可能是支付环节出了问题 */
  const pendingCount = Number(
    (await scalar("SELECT COUNT(*) AS c FROM orders WHERE status = '待付款'")) ?? 0
  );

  /* ---------------------------------------------------------- 事件流 */

  const events = [];

  for (const o of recentOrders) {
    events.push({
      id: `order-${o.order_no}`,
      type: "order",
      level: "info",
      title: "新订单",
      desc: `${o.product_name}${o.spec ? ` · ${o.spec}` : ""} × ${o.qty} · ¥${Number(o.amount).toFixed(2)}`,
      extra: o.contact || "未留联系方式",
      ip: o.client_ip || "",
      target: o.order_no,
      time: o.created_at,
    });
  }

  for (const p of lowStock) {
    events.push({
      id: `stock-${p.id}`,
      type: "stock",
      level: p.soldOut ? "danger" : "warn",
      title: p.soldOut ? "商品已售罄" : "库存不足",
      desc: `${p.emoji} ${p.name}`,
      extra: p.soldOut ? "可用卡密为 0，请尽快补货" : `仅剩 ${p.stock} 条，低于预警值 ${threshold}`,
      target: p.id,
      time: "",
    });
  }

  /* 库存类没有时间，排在订单后面；订单本身已按时间倒序 */
  events.sort((a, b) => {
    if (a.type !== b.type) return a.type === "order" ? -1 : 1;
    return String(b.time).localeCompare(String(a.time));
  });

  return {
    serverTime,
    threshold,
    unseenOrders: Number(unseenRow?.c || 0),
    unseenAmount: Math.round(Number(unseenRow?.amount || 0) * 100) / 100,
    pendingOrders: pendingCount,
    lowStock,
    soldOutCount: lowStock.filter((p) => p.soldOut).length,
    events,
  };
}

export default { feed };
