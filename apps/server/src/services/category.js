/**
 * 简卡铺 · 分类服务
 */
import { all, get, run, scalar } from "../db.js";
import { conflict, notFound } from "../lib/errors.js";
import { str, int, bool01, ID_PATTERN } from "../lib/validate.js";

/** 数据库行 → API 对象 */
function toApi(row, count = 0) {
  return {
    id: row.id,
    name: row.name,
    sort: Number(row.sort),
    status: Number(row.status),
    remark: row.remark,
    count,
  };
}

/** 全部分类（带商品数），默认按 sort 排序 */
export async function list({ onlyEnabled = false } = {}) {
  const rows = await all(`
    SELECT c.id, c.name, c.sort, c.status, c.remark,
           (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
      FROM categories c
     ${onlyEnabled ? "WHERE c.status = 1" : ""}
     ORDER BY c.sort ASC, c.id ASC
  `);
  return rows.map((r) => toApi(r, Number(r.product_count || 0)));
}

/** 单个分类 */
export async function find(id) {
  const row = await get("SELECT * FROM categories WHERE id = ?", id);
  if (!row) return null;
  const count = Number(
    (await scalar("SELECT COUNT(*) AS c FROM products WHERE category_id = ?", id)) ?? 0
  );
  return toApi(row, count);
}

/** 校验分类存在且启用 */
export async function requireEnabled(id) {
  const row = await get("SELECT * FROM categories WHERE id = ?", id);
  if (!row) throw notFound("分类不存在");
  if (!row.status) throw conflict("该分类已停用");
  return row;
}

/** 新增 */
export async function create(payload) {
  const id = str(payload.id, { field: "分类标识", max: 40, pattern: ID_PATTERN });
  const name = str(payload.name, { field: "分类名称", max: 30 });
  const sort = int(payload.sort, { field: "排序值", required: false, min: 0, max: 9999, fallback: 99 });
  const status = bool01(payload.status, { fallback: 1 });
  const remark = str(payload.remark, { field: "备注", required: false, max: 100 });

  if (await get("SELECT id FROM categories WHERE id = ?", id)) {
    throw conflict(`分类标识「${id}」已存在`);
  }
  await run(
    "INSERT INTO categories (id, name, sort, status, remark) VALUES (?, ?, ?, ?, ?)",
    id, name, sort, status, remark
  );
  return find(id);
}

/** 更新（分类标识不可改） */
export async function update(id, payload) {
  const existing = await get("SELECT * FROM categories WHERE id = ?", id);
  if (!existing) throw notFound("分类不存在");

  const name = payload.name === undefined
    ? existing.name
    : str(payload.name, { field: "分类名称", max: 30 });
  const sort = payload.sort === undefined
    ? Number(existing.sort)
    : int(payload.sort, { field: "排序值", min: 0, max: 9999 });
  const status = payload.status === undefined
    ? Number(existing.status)
    : bool01(payload.status, { fallback: Number(existing.status) });
  const remark = payload.remark === undefined
    ? existing.remark
    : str(payload.remark, { field: "备注", required: false, max: 100 });

  await run(
    "UPDATE categories SET name = ?, sort = ?, status = ?, remark = ? WHERE id = ?",
    name, sort, status, remark, id
  );
  return find(id);
}

/** 删除；分类下仍有商品时拒绝 */
export async function remove(id) {
  const existing = await get("SELECT * FROM categories WHERE id = ?", id);
  if (!existing) throw notFound("分类不存在");

  const count = Number(
    (await scalar("SELECT COUNT(*) AS c FROM products WHERE category_id = ?", id)) ?? 0
  );
  if (count > 0) throw conflict(`该分类下还有 ${count} 个商品，请先移除或改分类`);

  await run("DELETE FROM categories WHERE id = ?", id);
  return true;
}

export default { list, find, create, update, remove, requireEnabled };
