/**
 * 简卡铺 · 商品服务
 * ---------------------------------------------------------------------------
 * stock 是「可用卡密数量」的**总计**冗余计数（所有规格加在一起），
 * 由 card / order 服务在库存变动后调用 recomputeStock() 保持一致，
 * 避免每次列表查询都去 COUNT 卡密表。
 *
 * 各规格的可用数量单独通过 specStock 返回，随商品对象一起下发，
 * 这样前台能禁用已售罄的规格、后台能看出哪个规格该补货。
 */
import { all, get, run, scalar, tx } from "../db.js";
import { conflict, notFound, badRequest } from "../lib/errors.js";
import { nowStr } from "../lib/time.js";
import {
  str,
  text,
  money,
  bool01,
  oneOf,
  orderBy,
  parseJsonArray,
  toJsonArray,
  ID_PATTERN,
} from "../lib/validate.js";
import * as categoryService from "./category.js";

/**
 * 商品列表的可选排序。
 * 键来自前端 query，值会直接拼进 ORDER BY，所以**只能**从这里取。
 *
 * 每一列都提供 asc/desc 两种，表头点击才能在同名键上循环切换。
 * newest/oldest 是给排序下拉用的别名。
 *
 * default 的语义是「在架在前、有货在前、热销在前」：
 * 有货商品按销量排，售罄商品沉底（其中新品靠前），
 * 避免首页第一张卡就是售罄商品、新商品消失在列表尾部。
 */
const PRODUCT_SORTS = {
  default: "status DESC, (stock > 0) DESC, sold DESC, created_at DESC, id ASC",
  newest: "created_at DESC, id DESC",
  oldest: "created_at ASC, id ASC",
  updated: "updated_at DESC, id DESC",
  created_asc: "created_at ASC, id ASC",
  created_desc: "created_at DESC, id DESC",
  updated_asc: "updated_at ASC, id ASC",
  updated_desc: "updated_at DESC, id DESC",
  price_asc: "price ASC, id ASC",
  price_desc: "price DESC, id ASC",
  stock_asc: "stock ASC, id ASC",
  stock_desc: "stock DESC, id ASC",
  sold_asc: "sold ASC, id ASC",
  sold_desc: "sold DESC, id ASC",
  name_asc: "name ASC, id ASC",
  name_desc: "name DESC, id ASC",
};

/**
 * 数据库行 → API 对象（字段名与前端保持一致）
 * @param {object} row
 * @param {Record<string, number>} [specStock] 规格 → 可用库存
 */
export function toApi(row, specStock = {}) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category_id,
    emoji: row.emoji,
    price: Number(row.price),
    oldPrice: Number(row.old_price),
    stock: Number(row.stock),
    /** 各规格的可用库存，例如 { "月卡": 12, "季卡": 0 } */
    specStock,
    sold: Number(row.sold),
    status: Number(row.status),
    badge: row.badge,
    badgeType: row.badge_type,
    specs: parseJsonArray(row.specs),
    unit: row.unit,
    desc: row.description,
    detail: row.detail,
    notice: parseJsonArray(row.notice),
    tutorial: parseJsonArray(row.tutorial),
    delivery: row.delivery,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 补齐规格库存：一条卡密都没有的规格要补 0，不能让它从结果里消失。
 *
 * SQL 的 GROUP BY 只会返回「有卡密」的规格，缺键会让前端拿到 undefined，
 * 既显示不出「已售罄」，也无法禁用该规格的购买按钮。
 * 约定：`specs` 里声明的每个规格，`specStock` 里都必定有一个数字。
 */
function fillSpecStock(row, stock) {
  const specs = parseJsonArray(row.specs);
  if (specs.length === 0) return stock;

  const out = {};
  for (const spec of specs) out[spec] = Number(stock[spec] ?? 0);
  return out;
}

/**
 * 批量查询若干商品的「规格 → 可用库存」，避免列表页 N+1
 * @param {string[]} productIds
 * @returns {Promise<Map<string, Record<string, number>>>}
 */
async function specStockMap(productIds) {
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

/**
 * 商品列表
 * @param {object} opts
 * @param {boolean} [opts.publicOnly] 只返回已上架商品（前台用）
 */
export async function list({
  keyword = "",
  category = "",
  status = "",
  sort = "default",
  page = 1,
  perPage = 0,
  publicOnly = false,
} = {}) {
  const where = [];
  const params = [];

  if (publicOnly) {
    where.push("status = 1");
  } else if (status !== "" && status !== undefined && status !== null) {
    where.push("status = ?");
    params.push(Number(status) ? 1 : 0);
  }
  if (category) {
    where.push("category_id = ?");
    params.push(category);
  }
  if (keyword) {
    where.push("(name ILIKE ? OR id ILIKE ? OR description ILIKE ?)");
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await scalar(`SELECT COUNT(*) AS c FROM products ${clause}`, ...params)) ?? 0);

  const order = orderBy(sort, PRODUCT_SORTS, "default");
  const sql = `SELECT * FROM products ${clause} ORDER BY ${order}`;
  let rows;
  if (perPage > 0) {
    const safePage = Math.max(1, page);
    rows = await all(sql + " LIMIT ? OFFSET ?", ...params, perPage, (safePage - 1) * perPage);
  } else {
    rows = await all(sql, ...params);
  }

  const stockMap = await specStockMap(rows.map((r) => r.id));
  return {
    rows: rows.map((r) => toApi(r, fillSpecStock(r, stockMap.get(r.id) ?? {}))),
    total,
  };
}

/** 全部上架商品（前台首页一次取完） */
export async function listPublic() {
  return (await list({ publicOnly: true })).rows;
}

export async function find(id) {
  const row = await get("SELECT * FROM products WHERE id = ?", id);
  if (!row) return null;
  const stockMap = await specStockMap([id]);
  return toApi(row, fillSpecStock(row, stockMap.get(id) ?? {}));
}

/** 取原始行（内部用，含数据库字段名） */
export async function findRow(id) {
  return get("SELECT * FROM products WHERE id = ?", id);
}

/**
 * 校验商品存在且可售（前台下单前调用）
 *
 * @param {string} id
 * @param {string|null} [spec] 已确定的规格名。传了就**按该规格**校验库存——
 *   总库存够不代表这个规格够，年卡有货不能拿来卖月卡。
 */
export async function requirePurchasable(id, spec = null) {
  const row = await findRow(id);
  if (!row) throw notFound("商品不存在");
  if (!row.status) throw conflict("该商品已下架");

  const category = await get("SELECT status FROM categories WHERE id = ?", row.category_id);
  if (category && !category.status) throw conflict("该商品所属分类已停用");

  if (Number(row.stock) <= 0) throw conflict("该商品已售罄");

  if (spec !== null) {
    const target = String(spec ?? "").trim();
    const available = Number(
      (await scalar(
        "SELECT COUNT(*) AS c FROM cards WHERE product_id = ? AND spec = ? AND status = '未售'",
        id,
        target
      )) ?? 0
    );
    if (available <= 0) {
      throw conflict(target ? `「${target}」已售罄，请选择其它规格` : "该商品已售罄");
    }
  }

  return row;
}

/** 重算某商品的可用库存（未售卡密数） */
export async function recomputeStock(id) {
  await run(
    `UPDATE products
        SET stock = (SELECT COUNT(*) FROM cards WHERE product_id = ? AND status = '未售')
      WHERE id = ?`,
    id, id
  );
}

/** 重算全部商品库存 */
export async function recomputeAllStock() {
  await run(`
    UPDATE products
       SET stock = (SELECT COUNT(*) FROM cards WHERE product_id = products.id AND cards.status = '未售')
  `);
}

/* -------------------------------------------------------------------- 写入 */

/** 从请求体构造字段集合（新增与更新共用） */
async function normalize(payload, existing) {
  const isNew = !existing;

  const id = isNew
    ? str(payload.id, { field: "商品 ID", max: 40, pattern: ID_PATTERN })
    : existing.id;

  const name = payload.name === undefined
    ? (existing?.name ?? "")
    : str(payload.name, { field: "商品名称", max: 60 });
  if (!name) throw conflict("商品名称不能为空");

  const categoryId = payload.category === undefined
    ? (existing?.category_id ?? "")
    : str(payload.category, { field: "所属分类", max: 40, pattern: ID_PATTERN });
  await categoryService.requireEnabled(categoryId);

  const price = payload.price === undefined
    ? Number(existing?.price ?? 0)
    : money(payload.price, { field: "售价", min: 0.01 });
  const oldPrice = payload.oldPrice === undefined
    ? Number(existing?.old_price ?? 0)
    : money(payload.oldPrice, { field: "划线价", required: false, min: 0 });
  if (oldPrice > 0 && oldPrice < price) {
    throw conflict("划线价不应低于售价");
  }

  const emoji = payload.emoji === undefined
    ? (existing?.emoji ?? "📦")
    : str(payload.emoji, { field: "封面符号", required: false, max: 8 }) || "📦";

  const badge = payload.badge === undefined
    ? (existing?.badge ?? "")
    : str(payload.badge, { field: "角标文案", required: false, max: 8 });

  const badgeType = payload.badgeType === undefined
    ? (existing?.badge_type ?? "")
    : oneOf(payload.badgeType, ["", "accent", "success", "muted"], { field: "角标样式", required: false });

  const unit = payload.unit === undefined
    ? (existing?.unit ?? "件")
    : str(payload.unit, { field: "单位", required: false, max: 6 }) || "件";

  const status = payload.status === undefined
    ? Number(existing?.status ?? 1)
    : bool01(payload.status, { fallback: 1 });

  const specs = payload.specs === undefined
    ? (existing?.specs ?? "[]")
    : toJsonArray(payload.specs, 20);

  const description = payload.desc === undefined
    ? (existing?.description ?? "")
    : text(payload.desc, { field: "一句话卖点", required: false, max: 200 });

  const detail = payload.detail === undefined
    ? (existing?.detail ?? "")
    : text(payload.detail, { field: "商品详情", required: false, max: 5000 });

  const notice = payload.notice === undefined
    ? (existing?.notice ?? "[]")
    : toJsonArray(payload.notice, 30);

  const tutorial = payload.tutorial === undefined
    ? (existing?.tutorial ?? "[]")
    : toJsonArray(payload.tutorial, 30);

  const delivery = payload.delivery === undefined
    ? (existing?.delivery ?? "自动发货")
    : str(payload.delivery, { field: "发货方式", required: false, max: 20 }) || "自动发货";

  return {
    id, name, categoryId, price, oldPrice, emoji, badge, badgeType, unit, status,
    specs, description, detail, notice, tutorial, delivery,
  };
}

export async function create(payload) {
  const f = await normalize(payload, null);
  if (await findRow(f.id)) throw conflict(`商品 ID「${f.id}」已存在`);

  const ts = nowStr();
  await run(
    `INSERT INTO products
      (id, name, category_id, emoji, price, old_price, stock, sold, status, badge, badge_type,
       specs, unit, description, detail, notice, tutorial, delivery, created_at, updated_at)
     VALUES (?,?,?,?,?,?,0,0,?,?,?,?,?,?,?,?,?,?,?,?)`,
    f.id, f.name, f.categoryId, f.emoji, f.price, f.oldPrice, f.status, f.badge, f.badgeType,
    f.specs, f.unit, f.description, f.detail, f.notice, f.tutorial, f.delivery, ts, ts
  );
  return find(f.id);
}

export async function update(id, payload) {
  const existing = await findRow(id);
  if (!existing) throw notFound("商品不存在");

  const f = await normalize(payload, existing);

  /* 规格是卡密的归属维度：把某个规格改名或删掉，挂在它下面的卡密
     就会变成永远发不出去的孤儿数据。这里直接拦下来，让用户先去处理卡密。 */
  const oldSpecs = parseJsonArray(existing.specs);
  const newSpecs = parseJsonArray(f.specs);
  const removed = oldSpecs.filter((s) => !newSpecs.includes(s));

  if (removed.length > 0) {
    const rows = await all(
      `SELECT spec, COUNT(*) AS c
         FROM cards
        WHERE product_id = ? AND status <> '已售' AND spec = ANY(?)
        GROUP BY spec`,
      id,
      removed
    );
    const blocking = rows.filter((r) => Number(r.c) > 0);
    if (blocking.length > 0) {
      const detail = blocking.map((r) => `「${r.spec}」还有 ${r.c} 条卡密`).join("，");
      throw conflict(
        `无法删除或改名这些规格：${detail}。` +
          "请先在「卡密库存」里清空或转移这些规格的卡密，再修改规格列表。"
      );
    }
  }

  await run(
    `UPDATE products SET
       name = ?, category_id = ?, emoji = ?, price = ?, old_price = ?, status = ?,
       badge = ?, badge_type = ?, specs = ?, unit = ?, description = ?, detail = ?,
       notice = ?, tutorial = ?, delivery = ?, updated_at = ?
     WHERE id = ?`,
    f.name, f.categoryId, f.emoji, f.price, f.oldPrice, f.status,
    f.badge, f.badgeType, f.specs, f.unit, f.description, f.detail,
    f.notice, f.tutorial, f.delivery, nowStr(), id
  );
  return find(id);
}

/**
 * 删除商品
 * @param {boolean} withCards 是否连带删除未售卡密（已售卡密始终保留，用于订单追溯）
 */
export async function remove(id, { withCards = true } = {}) {
  const existing = await findRow(id);
  if (!existing) throw notFound("商品不存在");

  const pendingOrders = Number(
    (await scalar("SELECT COUNT(*) AS c FROM orders WHERE product_id = ? AND status = '待付款'", id)) ?? 0
  );
  if (pendingOrders > 0) throw conflict(`该商品还有 ${pendingOrders} 笔待付款订单，请先处理`);

  await tx(async () => {
    if (withCards) {
      await run("DELETE FROM cards WHERE product_id = ? AND status = '未售'", id);
    }
    await run("DELETE FROM products WHERE id = ?", id);
  });
  return true;
}

/** 切换上下架 */
export async function toggleStatus(id) {
  const existing = await findRow(id);
  if (!existing) throw notFound("商品不存在");
  const next = existing.status ? 0 : 1;
  await run("UPDATE products SET status = ?, updated_at = ? WHERE id = ?", next, nowStr(), id);
  return next;
}

/**
 * 批量操作商品
 *
 * 刻意**不用一个大事务**：一个商品删不掉（还有待付款订单）不该连累其它 199 个。
 * 每个商品独立处理，失败的原因收集起来一并返回，管理员知道哪些没成功、为什么。
 *
 * @param {string[]} ids
 * @param {"on"|"off"|"delete"} action
 * @returns {Promise<{affected: number, skipped: string[]}>}
 */
export async function batch(ids, action) {
  const list = [...new Set((ids ?? []).map((v) => String(v ?? "").trim()).filter(Boolean))];
  if (list.length === 0) throw badRequest("请至少选择一个商品");
  if (list.length > 200) throw badRequest("一次最多处理 200 个商品");

  const skipped = [];
  let affected = 0;

  for (const id of list) {
    try {
      if (action === "delete") {
        await remove(id);
      } else {
        /* 直接置为目标状态，而不是「切换」——
           批量场景下「切换」会让选中项状态变得参差不齐 */
        const existing = await findRow(id);
        if (!existing) throw notFound("商品不存在");
        const next = action === "on" ? 1 : 0;
        if (Number(existing.status) !== next) {
          await run("UPDATE products SET status = ?, updated_at = ? WHERE id = ?", next, nowStr(), id);
        }
      }
      affected += 1;
    } catch (err) {
      skipped.push(`${id}：${err.message}`);
    }
  }

  return { affected, skipped };
}

/** 库存偏低的商品 */
export async function lowStockProducts(threshold = 20) {  const rows = await all(
    "SELECT id, name, stock FROM products WHERE stock <= ? ORDER BY stock ASC",
    threshold
  );
  return rows.map((r) => ({ id: r.id, name: r.name, stock: Number(r.stock) }));
}

export default {
  toApi, list, listPublic, find, findRow, requirePurchasable,
  create, update, remove, batch, toggleStatus, recomputeStock, recomputeAllStock, lowStockProducts,
};
