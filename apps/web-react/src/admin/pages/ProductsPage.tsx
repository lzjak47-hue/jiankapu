/**
 * 简卡铺 · 商品管理
 * ---------------------------------------------------------------------------
 * 排序改成点表头：点一下升序、再点降序、第三次取消回到默认。
 * 勾选后可批量上架 / 下架 / 删除。
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../shared/api";
import { money, int, minutePart } from "../../shared/format";
import { useAsync, useDebouncedValue } from "../../shared/hooks";
import {
  Pagination,
  SortableTh,
  StatusTag,
  TableEmpty,
  TableSkeleton,
} from "../../shared/components";
import { useToast } from "../../shared/ToastProvider";
import { useConfirm } from "../../shared/ConfirmProvider";
import type { Product } from "../../shared/types";

const PER_PAGE = 8;

export function ProductsPage() {
  const toast = useToast();
  const confirm = useConfirm();

  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  /* 后台默认按创建时间倒序：新建的商品立刻出现在第一页，而不是沉到销量榜末尾 */
  const [sort, setSort] = useState("created_desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const debouncedKeyword = useDebouncedValue(keyword);

  const categories = useAsync((signal) => api.admin.categories(signal), []);

  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.admin.products(
        { keyword: debouncedKeyword, category, status, sort, page, perPage: PER_PAGE },
        signal
      ),
    [debouncedKeyword, category, status, sort, page]
  );

  const rows = data?.rows ?? [];
  const pageIds = useMemo(() => rows.map((p) => p.id), [rows]);

  /* 换页/换筛选后旧的选择就没意义了，直接清空，避免「删了看不见的东西」 */
  const selectedOnPage = pageIds.filter((id) => selected.has(id));
  const allOnPageSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  /** 切筛选条件时清空选择 */
  function resetSelection<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
      setSelected(new Set());
    };
  }

  const selectedIds = [...selected];

  async function runBatch(action: "on" | "off" | "delete") {
    if (selectedIds.length === 0) {
      toast.warn("请先勾选商品");
      return;
    }

    if (action === "delete") {
      const ok = await confirm({
        title: `批量删除 ${selectedIds.length} 个商品`,
        message:
          `将删除选中的 ${selectedIds.length} 个商品，以及它们名下**未售出**的卡密。\n` +
          "已售卡密会保留用于订单追溯。\n\n此操作不可撤销，确定继续吗？",
        okText: "确认删除",
        danger: true,
      });
      if (!ok) return;
    }

    setBusy(true);
    try {
      const result = await api.admin.batchProducts({ ids: selectedIds, action });
      const label = { on: "上架", off: "下架", delete: "删除" }[action];

      if (result.skipped.length > 0) {
        /* 部分失败要说清楚是哪些、为什么，不能只报一个数字 */
        toast.warn(
          `已${label} ${result.affected} 个，${result.skipped.length} 个失败：${result.skipped[0]}` +
            (result.skipped.length > 1 ? ` 等` : "")
        );
      } else {
        toast.success(`已${label} ${result.affected} 个商品`);
      }

      setSelected(new Set());
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeOne(product: Product) {
    const ok = await confirm({
      title: "删除商品",
      message: `确定要删除「${product.name}」吗？未售卡密会一并删除，已售卡密保留用于订单追溯。`,
      okText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.admin.deleteProduct(product.id);
      toast.success(`已删除：${product.name}`);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function toggleOneStatus(product: Product) {
    try {
      const res = await api.admin.toggleProduct(product.id);
      toast.success(res.status ? `已上架：${product.name}` : `已下架：${product.name}`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  }

  return (
    <>
      <div className="toolbar-2">
        <div className="search-box grow">
          <span className="ico">🔍</span>
          <input
            className="input"
            placeholder="搜索商品名称或 ID"
            value={keyword}
            onChange={(e) => resetSelection(setKeyword)(e.target.value)}
          />
        </div>

        <select
          className="select select-sm"
          aria-label="按分类筛选"
          value={category}
          onChange={(e) => resetSelection(setCategory)(e.target.value)}
        >
          <option value="">全部分类</option>
          {(categories.data?.rows ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          className="select select-sm"
          aria-label="按状态筛选"
          value={status}
          onChange={(e) => resetSelection(setStatus)(e.target.value)}
        >
          <option value="">全部状态</option>
          <option value="1">已上架</option>
          <option value="0">已下架</option>
        </select>

        <span className="result-count">{data ? `共 ${data.total} 件商品` : ""}</span>
        <div className="spacer" />
        <Link className="btn btn-primary" to="/products/new">
          ＋ 新增商品
        </Link>
      </div>

      {/* 选中后才出现的批量操作条 */}
      {selectedIds.length > 0 && (
        <div className="batch-bar">
          <span className="count">已选中 {selectedIds.length} 个商品</span>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void runBatch("on")}>
            批量上架
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void runBatch("off")}>
            批量下架
          </button>
          <button className="btn btn-accent btn-sm" disabled={busy} onClick={() => void runBatch("delete")}>
            批量删除
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setSelected(new Set())}>
            取消选择
          </button>
        </div>
      )}

      <section className="block">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th className="check-cell">
                  <input
                    type="checkbox"
                    aria-label="全选本页商品"
                    checked={allOnPageSelected}
                    onChange={toggleAllOnPage}
                  />
                </th>
                <SortableTh label="商品" field="name" sort={sort} onSort={setSort} />
                <SortableTh label="售价" field="price" sort={sort} onSort={setSort} />
                <SortableTh label="库存" field="stock" sort={sort} onSort={setSort} />
                <SortableTh label="已售" field="sold" sort={sort} onSort={setSort} />
                <th>角标</th>
                <th>状态</th>
                <SortableTh label="创建时间" field="created" sort={sort} onSort={setSort} />
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={9} />}
              {!loading && error && <TableEmpty cols={9} icon="🔌" text={error} />}
              {!loading && !error && rows.length === 0 && (
                <TableEmpty cols={9} text="没有符合条件的商品" />
              )}

              {!loading &&
                rows.map((p) => {
                  const checked = selected.has(p.id);
                  const low = p.stock > 0 && p.stock < 20;
                  return (
                    <tr key={p.id} className={checked ? "is-selected" : undefined}>
                      <td className="check-cell">
                        <input
                          type="checkbox"
                          aria-label={`选择 ${p.name}`}
                          checked={checked}
                          onChange={() => toggleOne(p.id)}
                        />
                      </td>
                      <td>
                        <div className="cell-main">
                          <span className="cell-thumb">{p.emoji}</span>
                          <div>
                            <div className="t1">{p.name}</div>
                            <div className="t2">
                              {p.id} · {p.category}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="num nowrap">
                        ¥{money(p.price)}
                        {p.oldPrice > 0 && (
                          <div className="t2 dim" style={{ textDecoration: "line-through" }}>
                            ¥{money(p.oldPrice)}
                          </div>
                        )}
                      </td>
                      <td className="num nowrap">
                        {p.stock > 0 ? int(p.stock) : <StatusTag text="售罄" />}
                        {low && (
                          <div className="t2" style={{ color: "var(--warning)" }}>
                            库存偏低
                          </div>
                        )}
                      </td>
                      <td className="num nowrap">{int(p.sold)}</td>
                      <td>
                        {p.badge ? (
                          <span className="tag tag-accent">{p.badge}</span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td>
                        <StatusTag text={p.status ? "已上架" : "已下架"} tone={p.status ? "on" : "off"} />
                      </td>
                      <td className="nowrap dim">{minutePart(p.createdAt)}</td>
                      <td>
                        <div className="row-actions">
                          <Link to={`/products/${p.id}`}>编辑</Link>
                          <span className="sep" />
                          <button onClick={() => void toggleOneStatus(p)}>
                            {p.status ? "下架" : "上架"}
                          </button>
                          <span className="sep" />
                          <button className="danger" onClick={() => void removeOne(p)}>
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {data && (
          <Pagination
            page={data.page}
            perPage={data.perPage}
            total={data.total}
            onChange={(next) => {
              setPage(next);
              setSelected(new Set());
            }}
          />
        )}
      </section>

      <p className="small dim mt-16">
        点击表头可以排序：一下升序、再一下降序、第三下取消。
        <br />
        库存为 0 的商品在前台会自动显示「已售罄」并禁用购买按钮。补充库存请到{" "}
        <Link to="/cards">卡密库存</Link> 页面导入卡密。
      </p>
    </>
  );
}

export default ProductsPage;
