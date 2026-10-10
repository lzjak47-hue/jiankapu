/**
 * 简卡铺 · 统计服务（后台数据概览）
 * ---------------------------------------------------------------------------
 * 所有数字都从订单表实时聚合，不使用缓存。
 * PostgreSQL 的 `COUNT(*) FILTER (WHERE ...)` 让多个口径可以在一次查询里拿到。
 */
import { all, get, scalar } from "../db.js";
import { nowStr, todayStartStr, recentDayLabels } from "../lib/time.js";
import * as orderService from "./order.js";
import * as settingsService from "./settings.js";

const PAID = "('已发货','处理中')";

/** 顶部四个指标卡 */
async function buildStats() {
  const today = todayStartStr();
  const yesterdayStart = recentDayLabels(2)[0].start;

  const row = await get(
    `SELECT COUNT(*) FILTER (WHERE created_at >= ?)                                  AS today_orders,
            COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ?)               AS yday_orders,
            COALESCE(SUM(amount) FILTER (WHERE status IN ${PAID} AND created_at >= ?), 0)              AS today_revenue,
            COALESCE(SUM(amount) FILTER (WHERE status IN ${PAID} AND created_at >= ? AND created_at < ?), 0) AS yday_revenue
       FROM orders`,
    today, yesterdayStart, today, today, yesterdayStart, today
  );

  const todayOrders = Number(row?.today_orders || 0);
  const ydayOrders = Number(row?.yday_orders || 0);
  const todayRevenue = Number(row?.today_revenue || 0);
  const ydayRevenue = Number(row?.yday_revenue || 0);

  const lowStockWarn = settingsService.getNumber("trade.lowStockWarn", 20);

  const prod = await get(
    `SELECT COUNT(*) FILTER (WHERE status = 1)                                AS on_sale,
            COUNT(*) FILTER (WHERE stock = 0)                                 AS sold_out,
            COUNT(*) FILTER (WHERE status = 1 AND stock > 0 AND stock <= ?)   AS low_stock
       FROM products`,
    lowStockWarn
  );

  const stock = Number((await scalar("SELECT COUNT(*) AS c FROM cards WHERE status = '未售'")) ?? 0);

  const pct = (now, prev) => {
    if (prev <= 0) return now > 0 ? "+100%" : "0%";
    const diff = ((now - prev) / prev) * 100;
    return `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`;
  };

  const onSale = Number(prod?.on_sale || 0);
  const soldOut = Number(prod?.sold_out || 0);
  const lowStock = Number(prod?.low_stock || 0);

  return [
    {
      label: "今日订单",
      value: todayOrders,
      unit: "笔",
      delta: pct(todayOrders, ydayOrders),
      up: todayOrders >= ydayOrders,
      icon: "🧾",
    },
    {
      label: "今日收入",
      value: Math.round(todayRevenue * 100) / 100,
      unit: "元",
      delta: pct(todayRevenue, ydayRevenue),
      up: todayRevenue >= ydayRevenue,
      icon: "💰",
      money: true,
    },
    {
      label: "在售商品",
      value: onSale,
      unit: "件",
      delta: soldOut > 0 ? `${soldOut} 件已售罄` : "全部有货",
      up: soldOut === 0,
      icon: "📦",
    },
    {
      label: "可用卡密",
      value: stock,
      unit: "条",
      delta: lowStock > 0 ? `${lowStock} 个商品库存偏低` : "库存充足",
      up: lowStock === 0,
      icon: "🔑",
    },
  ];
}

/** 近 7 天走势 */
async function buildSeries() {
  const days = recentDayLabels(7).reverse();
  const out = [];
  for (const day of days) {
    const row = await get(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(amount) FILTER (WHERE status IN ${PAID}), 0) AS revenue
         FROM orders
        WHERE created_at >= ? AND created_at < ?`,
      day.start,
      day.end
    );
    out.push({
      date: day.date,
      orders: Number(row?.orders || 0),
      revenue: Math.round(Number(row?.revenue || 0) * 100) / 100,
    });
  }
  return out;
}

/** 热销 TOP N */
async function buildTopProducts(limit = 5) {
  const rows = await all(
    `SELECT p.id, p.name, p.emoji, p.sold,
            (SELECT COALESCE(SUM(o.amount), 0) FROM orders o
              WHERE o.product_id = p.id AND o.status IN ${PAID}) AS revenue
       FROM products p
      ORDER BY p.sold DESC
      LIMIT ?`,
    limit
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    sold: Number(r.sold),
    revenue: Math.round(Number(r.revenue) * 100) / 100,
  }));
}

/** 最近订单 */
async function buildRecentOrders(limit = 6) {
  const page = await orderService.list({ page: 1, perPage: limit });
  return page.rows.map((o) => ({
    no: o.no,
    product: o.product,
    productId: o.productId,
    spec: o.spec,
    qty: o.qty,
    amount: o.amount,
    status: o.status,
    contact: o.contact,
    time: o.time,
  }));
}

/** 系统信息 */
async function buildSystemInfo() {
  const counts = await get(`
    SELECT (SELECT COUNT(*) FROM orders) AS total_orders,
           (SELECT COUNT(*) FROM cards)  AS total_cards,
           (SELECT COUNT(*) FROM admins) AS admins,
           pg_database_size(current_database()) AS db_bytes
  `);

  return {
    version: "简卡铺 v1.0.0",
    runtime: `Node ${process.version}`,
    nodeEnv: process.env.NODE_ENV || "development",
    database: "PostgreSQL",
    totalOrders: Number(counts?.total_orders || 0),
    totalCards: Number(counts?.total_cards || 0),
    admins: Number(counts?.admins || 0),
    dbSizeKb: Math.round(Number(counts?.db_bytes || 0) / 1024),
    serverTime: nowStr(),
    uptimeSeconds: Math.round(process.uptime()),
  };
}

/** 汇总概览 */
export async function overview() {
  const [stats, series, topProducts, recentOrders, system, orderStats] = await Promise.all([
    buildStats(),
    buildSeries(),
    buildTopProducts(),
    buildRecentOrders(),
    buildSystemInfo(),
    orderService.stats(),
  ]);

  return { stats, series, topProducts, recentOrders, system, orderStats };
}

export default { overview };
