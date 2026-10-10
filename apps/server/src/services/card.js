/**
 * 简卡铺 · 卡密库存服务
 * ---------------------------------------------------------------------------
 * 卡密挂在 **「商品 + 规格」** 上：同一个商品的不同规格（月卡 / 季卡 / 年卡）
 * 各自持有独立的卡密池，下单时只会在所选规格的池子里取卡，
 * 绝不会把年卡的卡密发给买月卡的用户。
 *
 * 没有规格的商品统一用空字符串 `''` 作为规格值。
 *
 * 卡密状态流转：
 *   未售 --锁定--> 已锁定 --支付--> 已售
 *                    |
 *                    +--订单关闭／超时--> 未售
 *
 * 并发安全：`lockForOrder` 用 `FOR UPDATE SKIP LOCKED` 选取未售卡密，
 * 多个下单请求同时到达时不会抢到同一条卡密。
 * 注意：必须在事务内调用（外层用 tx() 包裹）。
 */
import { all, get, run, scalar, tx } from "../db.js";
import { conflict, notFound, badRequest } from "../lib/errors.js";
import { nowStr } from "../lib/time.js";
import { oneOf, orderBy } from "../lib/validate.js";
import * as productService from "./product.js";

const CARD_STATUS = ["未售", "已锁定", "已售"];

/** 卡密列表的可选排序；键来自前端 query，只能从这里取 */
const CARD_SORTS = {
  default: "c.id DESC",
  newest: "c.id DESC",
  oldest: "c.id ASC",
  id_asc: "c.id ASC",
  id_desc: "c.id DESC",
  imported_desc: "c.imported_at DESC, c.id DESC",
  imported_asc: "c.imported_at ASC, c.id ASC",
  sold_desc: "c.sold_at DESC NULLS LAST, c.id DESC",
  sold_asc: "c.sold_at ASC NULLS LAST, c.id DESC",
  status_asc: "c.status ASC, c.id DESC",
  status_desc: "c.status DESC, c.id DESC",
  spec_asc: "c.spec ASC, c.id DESC",
  spec_desc: "c.spec DESC, c.id DESC",
  secret_asc: "c.secret ASC",
  secret_desc: "c.secret DESC",
};

/** 规格值归一化：null / undefined / 空白 都视作「无规格」 */
const normSpec = (spec) => String(spec ?? "").trim();

function toApi(row, productName) {
  return {
    id: Number(row.id),
    key: row.secret,
    product: row.product_id,
    productName: productName ?? "",
    spec: row.spec ?? "",
    status: row.status,
    importedAt: row.imported_at,
    soldAt: row.sold_at || "",
    order: row.order_id ? String(row.order_id) : "",
  };
}

/* -------------------------------------------------------------------- 查询 */

/**
 * 拼出卡密查询的 WHERE 子句。
 * 列表与导出共用，避免两处条件写得不一样、导出内容跟页面筛选对不上。
 */
function buildFilter({ productId = "", spec = "", keyword = "", status = "" } = {}) {
  const where = [];
  const params = [];

  if (productId) {
    where.push("c.product_id = ?");
    params.push(productId);
  }
  if (spec) {
    where.push("c.spec = ?");
    params.push(normSpec(spec));
  }
  if (status) {
    where.push("c.status = ?");
    params.push(oneOf(status, CARD_STATUS, { field: "卡密状态" }));
  }
  if (keyword) {
    where.push("c.secret ILIKE ?");
    params.push(`%${keyword}%`);
  }

  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export async function list({
  productId = "",
  spec = "",
  keyword = "",
  status = "",
  sort = "default",
  page = 1,
  perPage = 10,
} = {}) {
  const { clause, params } = buildFilter({ productId, spec, keyword, status });

  const total = Number((await scalar(`SELECT COUNT(*) AS c FROM cards c ${clause}`, ...params)) ?? 0);

  const safePage = Math.max(1, page);
  const order = orderBy(sort, CARD_SORTS, "default");

  /* 已售卡密通过订单号反查，方便客服核对 */
  const rows = await all(
    `SELECT c.*, o.order_no
       FROM cards c
       LEFT JOIN orders o ON o.id = c.order_id
       ${clause}
      ORDER BY ${order}
      LIMIT ? OFFSET ?`,
    ...params,
    perPage,
    (safePage - 1) * perPage
  );

  const products = (await productService.list()).rows;
  const nameMap = new Map(products.map((p) => [p.id, p.name]));

  return {
    rows: rows.map((r) => {
      const item = toApi(r, nameMap.get(r.product_id));
      if (r.order_no) item.order = r.order_no;
      return item;
    }),
    total,
    page: safePage,
    perPage,
  };
}

/**
 * 导出用：按同样的筛选条件取出全部卡密（不分页）。
 *
 * 与 list() 共用 buildFilter，保证「页面看到的」和「导出的」是同一批数据。
 * 上限 5 万条，避免一次导出把内存撑爆。
 *
 * @returns {Promise<{rows: object[], total: number, truncated: boolean}>}
 */
export async function exportRows({
  productId = "",
  spec = "",
  keyword = "",
  status = "",
  sort = "default",
  limit = 50000,
} = {}) {
  const { clause, params } = buildFilter({ productId, spec, keyword, status });
  const total = Number((await scalar(`SELECT COUNT(*) AS c FROM cards c ${clause}`, ...params)) ?? 0);
  const order = orderBy(sort, CARD_SORTS, "default");

  const rows = await all(
    `SELECT c.*, o.order_no, p.name AS product_name
       FROM cards c
       LEFT JOIN orders o   ON o.id = c.order_id
       LEFT JOIN products p ON p.id = c.product_id
       ${clause}
      ORDER BY ${order}
      LIMIT ?`,
    ...params,
    limit
  );

  return {
    total,
    truncated: total > rows.length,
    rows: rows.map((r) => ({
      key: r.secret,
      product: r.product_id,
      productName: r.product_name || "",
      spec: r.spec ?? "",
      status: r.status,
      importedAt: r.imported_at,
      soldAt: r.sold_at || "",
      order: r.order_no || "",
    })),
  };
}

/** 库存总览（后台卡片用）；传 productId 则只看该商品 */
export async function stats({ productId = "" } = {}) {
  const clause = productId ? "WHERE product_id = ?" : "";
  const params = productId ? [productId] : [];

  const row = await get(
    `SELECT COUNT(*)                                                 AS total,
            COUNT(*) FILTER (WHERE status = '未售')                   AS available,
            COUNT(*) FILTER (WHERE status = '已售')                   AS sold,
            COUNT(*) FILTER (WHERE status = '已锁定')                 AS locked
       FROM cards ${clause}`,
    ...params
  );

  return {
    total: Number(row?.total || 0),
    available: Number(row?.available || 0),
    sold: Number(row?.sold || 0),
    locked: Number(row?.locked || 0),
  };
}

/**
 * 某商品的可用数量
 * @param {string} productId
 * @param {string|null} spec 传 null 表示不限规格（返回该商品总量）
 */
export async function availableCount(productId, spec = null) {
  if (spec === null) {
    return Number(
      (await scalar(
        "SELECT COUNT(*) AS c FROM cards WHERE product_id = ? AND status = '未售'",
        productId
      )) ?? 0
    );
  }
  return Number(
    (await scalar(
      "SELECT COUNT(*) AS c FROM cards WHERE product_id = ? AND spec = ? AND status = '未售'",
      productId,
      normSpec(spec)
    )) ?? 0
  );
}

/**
 * 某商品各规格的可用库存
 * @returns {Promise<Record<string, number>>} 例如 { "月卡": 12, "季卡": 0 }
 */
export async function specStock(productId) {
  const rows = await all(
    `SELECT spec, COUNT(*) AS c
       FROM cards
      WHERE product_id = ? AND status = '未售'
      GROUP BY spec`,
    productId
  );

  const out = {};
  for (const row of rows) out[row.spec ?? ""] = Number(row.c);
  return out;
}

/**
 * 批量取多个商品的规格库存，避免列表页 N+1 查询
 * @param {string[]} productIds
 * @returns {Promise<Map<string, Record<string, number>>>}
 */
export async function specStockFor(productIds) {
  const map = new Map();
  if (!productIds || productIds.length === 0) return map;

  const rows = await all(
    `SELECT product_id, spec, COUNT(*) AS c
       FROM cards
      WHERE product_id = ANY(?) AND status = '未售'
      GROUP BY product_id, spec`,
    productIds
  );

  for (const row of rows) {
    if (!map.has(row.product_id)) map.set(row.product_id, {});
    map.get(row.product_id)[row.spec ?? ""] = Number(row.c);
  }
  return map;
}

/* -------------------------------------------------------------------- 写入 */

/**
 * 批量导入卡密
 *
 * 卡密必须明确归属到某个规格：商品的规格列表里有几个规格，
 * 就要分别导入几批卡密。没选规格时只允许导入到「无规格」商品。
 *
 * @param {string} productId
 * @param {string[]} secrets
 * @param {string} spec 规格名；商品无规格时传空字符串
 * @returns {Promise<{imported:number, duplicated:number, spec:string, stock:number}>}
 */
export async function importCards(productId, secrets, spec = "") {
  const product = await productService.findRow(productId);
  if (!product) throw notFound("商品不存在");

  const specs = JSON.parse(product.specs || "[]");
  const target = normSpec(spec);

  /* 规格必须真实存在于该商品上，否则卡密会变成永远发不出去的孤儿数据 */
  if (specs.length > 0) {
    if (!target) {
      throw conflict(`该商品有 ${specs.length} 个规格，请先选择要导入到哪个规格`);
    }
    if (!specs.includes(target)) {
      throw conflict(`规格「${target}」不在该商品的规格列表里`);
    }
  } else if (target) {
    throw conflict("该商品没有配置规格，请先在商品编辑页添加规格");
  }

  const raw = secrets.map((s) => String(s).trim()).filter(Boolean);
  if (raw.length === 0) throw conflict("没有可导入的卡密内容");

  let imported = 0;
  let duplicated = 0;
  const ts = nowStr();
  const seen = new Set();

  await tx(async () => {
    for (const secret of raw) {
      // 请求内部重复
      if (seen.has(secret)) {
        duplicated += 1;
        continue;
      }
      seen.add(secret);

      if (secret.length > 120) throw conflict(`卡密内容过长：${secret.slice(0, 20)}…`);

      // 与库中已有卡密重复
      if (await get("SELECT id FROM cards WHERE secret = ?", secret)) {
        duplicated += 1;
        continue;
      }

      await run(
        "INSERT INTO cards (product_id, spec, secret, status, imported_at) VALUES (?, ?, ?, '未售', ?)",
        productId,
        target,
        secret,
        ts
      );
      imported += 1;
    }
    await productService.recomputeStock(productId);
  });

  const stock = await availableCount(productId, target);
  return { imported, duplicated, spec: target, stock };
}

/**
 * 批量删除卡密。
 *
 * **已售的一律跳过**：它们要留着跟订单对账，删了就查不到当初发的是什么了。
 * 一次 SQL 搞定，不逐条 delete —— 卡密动辄几千条，逐条往返太慢。
 *
 * @param {number[]} ids
 * @returns {Promise<{affected: number, skipped: number}>}
 */
export async function batchRemove(ids) {
  const list = [...new Set((ids ?? []).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))];
  if (list.length === 0) throw badRequest("请至少选择一条卡密");
  if (list.length > 2000) throw badRequest("一次最多删除 2000 条卡密");

  const rows = await all(
    "SELECT DISTINCT product_id FROM cards WHERE id = ANY(?) AND status <> '已售'",
    list
  );

  const info = await run("DELETE FROM cards WHERE id = ANY(?) AND status <> '已售'", list);
  /* run() 返回的是 changes（见 db.js），不是 pg 原生的 rowCount */
  const affected = Number(info.changes ?? 0);

  /* 库存计数要跟着回写，否则列表上的「可用」会虚高 */
  for (const row of rows) await productService.recomputeStock(row.product_id);

  return { affected, skipped: list.length - affected };
}

/** 删除单条卡密（已售出的不允许删除，需保留追溯） */
export async function remove(cardId) {  const row = await get("SELECT * FROM cards WHERE id = ?", cardId);
  if (!row) throw notFound("卡密不存在");
  if (row.status === "已售") throw conflict("已售出的卡密不能删除，请保留用于订单追溯");

  await tx(async () => {
    await run("DELETE FROM cards WHERE id = ?", cardId);
    await productService.recomputeStock(row.product_id);
  });
  return true;
}

/** 批量删除某商品下所有未售卡密 */
export async function clearAvailable(productId) {
  const product = await productService.findRow(productId);
  if (!product) throw notFound("商品不存在");
  const info = await run("DELETE FROM cards WHERE product_id = ? AND status = '未售'", productId);
  await productService.recomputeStock(productId);
  return info.changes;
}

/* -------------------------------------------------- 订单流转（须在事务内调用） */

/**
 * 为订单锁定卡密。必须在事务内调用。
 *
 * **只在该订单所选规格的卡密池里取**，这是「买月卡不会发成年卡」的关键。
 *
 * `FOR UPDATE SKIP LOCKED` 保证并发下单不会选中同一批卡密：
 * 已被其它事务锁住的行会被跳过，而不是排队等待。
 *
 * @param {string} spec 规格名；商品无规格时传空字符串
 * @returns {Promise<{id:number, secret:string}[]|null>} 该规格库存不足返回 null
 */
export async function lockForOrder(orderId, productId, spec, qty) {
  const rows = await all(
    `SELECT id, secret FROM cards
      WHERE product_id = ? AND spec = ? AND status = '未售'
      ORDER BY id ASC
      LIMIT ?
      FOR UPDATE SKIP LOCKED`,
    productId,
    normSpec(spec),
    qty
  );
  if (rows.length < qty) return null;

  for (const row of rows) {
    await run("UPDATE cards SET status = '已锁定', order_id = ? WHERE id = ?", orderId, row.id);
  }
  await productService.recomputeStock(productId);
  return rows.map((r) => ({ id: Number(r.id), secret: r.secret }));
}

/** 订单支付成功：把锁定的卡密标记为已售，并写入订单卡密明细 */
export async function commitForOrder(orderId, productId) {
  const rows = await all(
    "SELECT id, secret FROM cards WHERE order_id = ? AND status = '已锁定'",
    orderId
  );
  const ts = nowStr();
  for (const row of rows) {
    await run("UPDATE cards SET status = '已售', sold_at = ? WHERE id = ?", ts, row.id);
    await run(
      `INSERT INTO order_cards (order_id, card_id, secret) VALUES (?, ?, ?)
       ON CONFLICT (order_id, card_id) DO UPDATE SET secret = EXCLUDED.secret`,
      orderId, row.id, row.secret
    );
  }
  await productService.recomputeStock(productId);
  return rows.map((r) => r.secret);
}

/** 订单关闭／超时：释放锁定的卡密回库存池 */
export async function releaseForOrder(orderId, productId) {
  const rows = await all("SELECT id FROM cards WHERE order_id = ? AND status = '已锁定'", orderId);
  for (const row of rows) {
    await run("UPDATE cards SET status = '未售', order_id = NULL WHERE id = ?", row.id);
  }
  if (productId) await productService.recomputeStock(productId);
  return rows.length;
}

/** 订单已发出的卡密内容 */
export async function secretsForOrder(orderId) {
  const rows = await all(
    "SELECT card_id, secret FROM order_cards WHERE order_id = ? ORDER BY card_id ASC",
    orderId
  );
  return rows.map((r) => r.secret);
}

/**
 * 批量取多个订单的卡密，避免列表页 N+1 查询
 * @param {number[]} orderIds
 * @returns {Promise<Map<number, string[]>>}
 */
export async function secretsForOrders(orderIds) {
  const map = new Map();
  if (!orderIds || orderIds.length === 0) return map;

  const rows = await all(
    "SELECT order_id, secret FROM order_cards WHERE order_id = ANY(?) ORDER BY order_id, card_id",
    orderIds
  );
  for (const row of rows) {
    const id = Number(row.order_id);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row.secret);
  }
  return map;
}

/** 清理：把指向不存在或已关闭订单的锁定卡密释放掉（防御性维护） */
export async function releaseOrphanLocks() {
  const rows = await all(`
    SELECT c.id, c.product_id FROM cards c
     WHERE c.status = '已锁定'
       AND (c.order_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = c.order_id AND o.status = '待付款'))
  `);
  if (rows.length === 0) return 0;

  const touched = new Set();
  await tx(async () => {
    for (const row of rows) {
      await run("UPDATE cards SET status = '未售', order_id = NULL WHERE id = ?", row.id);
      touched.add(row.product_id);
    }
  });
  for (const pid of touched) await productService.recomputeStock(pid);
  return rows.length;
}

export { toApi, CARD_STATUS };
export default {
  list, stats, availableCount, specStock, specStockFor, importCards, remove, batchRemove, clearAvailable,
  lockForOrder, commitForOrder, releaseForOrder, secretsForOrder, secretsForOrders, releaseOrphanLocks,
};
