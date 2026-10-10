/**
 * 简卡铺 · 表头点击排序
 * ---------------------------------------------------------------------------
 * 后端的排序键是 `<字段>_<方向>` 形式（price_asc / price_desc）。
 * 这里负责把它拆开、以及在点击时循环切换：
 *
 *   第一次点 → 升序
 *   再点一次 → 降序
 *   第三次   → 取消排序，回到默认
 *
 * 保留「取消」这一步是有必要的：不然点过一轮之后就再也回不到默认排序了。
 */

export type SortDir = "asc" | "desc" | "";

export interface ParsedSort {
  field: string;
  dir: SortDir;
}

/** 把 "price_desc" 拆成 { field: "price", dir: "desc" } */
export function parseSort(sort: string): ParsedSort {
  const matched = /^(.+)_(asc|desc)$/.exec(String(sort ?? ""));
  if (!matched) return { field: "", dir: "" };
  return { field: matched[1]!, dir: matched[2] as SortDir };
}

/**
 * 点击表头后的新排序值
 * @param current 当前排序值
 * @param field 被点击的字段
 * @param fallback 取消排序时回落到什么（各列表的默认排序不同）
 */
export function cycleSort(current: string, field: string, fallback: string): string {
  const parsed = parseSort(current);
  if (parsed.field !== field) return `${field}_asc`;
  if (parsed.dir === "asc") return `${field}_desc`;
  return fallback;
}

/** 该字段当前的排序方向，供表头显示箭头 */
export function sortDirOf(current: string, field: string): SortDir {
  const parsed = parseSort(current);
  return parsed.field === field ? parsed.dir : "";
}
