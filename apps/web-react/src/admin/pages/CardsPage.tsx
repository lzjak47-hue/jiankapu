/**
 * 简卡铺 · 卡密库存
 * ---------------------------------------------------------------------------
 * 卡密是按「商品 + 规格」管理的：同一个商品的不同规格各自持有独立的卡密池。
 * 所以导入时必须先选商品、再选规格，否则月卡和年卡的卡密会混在一起发错货。
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../../shared/api";
import { cardStatusClass, copyText, int, minutePart } from "../../shared/format";
import { useAsync, useDebouncedValue } from "../../shared/hooks";
import {
  Modal,
  Pagination,
  SortableTh,
  StatCards,
  StatusTag,
  TableEmpty,
  TableSkeleton,
} from "../../shared/components";
import { useToast } from "../../shared/ToastProvider";
import { useConfirm } from "../../shared/ConfirmProvider";
import type { Product } from "../../shared/types";

const PER_PAGE = 10;

export function CardsPage() {
  const toast = useToast();
  const confirm = useConfirm();

  const [productId, setProductId] = useState("");
  const [spec, setSpec] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("default");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const debouncedKeyword = useDebouncedValue(keyword);

  const [importOpen, setImportOpen] = useState(false);
  const [importProduct, setImportProduct] = useState("");
  const [importSpec, setImportSpec] = useState("");
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  /* 商品下拉用创建时间倒序，新建的商品排最前，方便导入时一眼选中 */
  const products = useAsync(
    (signal) => api.admin.products({ perPage: 200, sort: "created_desc" }, signal),
    []
  );

  /* 统计跟着商品筛选走，看单个商品时数字才有意义 */
  const stats = useAsync(
    (signal) => api.admin.cardStats(productId ? { productId } : {}, signal),
    [productId]
  );

  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.admin.cards(
        { productId, spec, keyword: debouncedKeyword, status, sort, page, perPage: PER_PAGE },
        signal
      ),
    [productId, spec, debouncedKeyword, status, sort, page]
  );

  /* 导出地址与当前筛选完全一致，所见即所得 */
  const exportUrl = api.admin.cardsExportUrl({
    productId,
    spec,
    keyword: debouncedKeyword,
    status,
    sort,
  });

  /* -------------------------------------------------------- 批量选择 */

  const rows = data?.rows ?? [];
  const selectableOnPage = rows.filter((c) => c.status !== "已售").map((c) => c.id);
  const selectedOnPage = selectableOnPage.filter((id) => selected.has(id));
  const allSelected =
    selectableOnPage.length > 0 && selectedOnPage.length === selectableOnPage.length;

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 全选只覆盖「未售 / 已锁定」——已售的本来就不允许删 */
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) selectableOnPage.forEach((id) => next.delete(id));
      else selectableOnPage.forEach((id) => next.add(id));
      return next;
    });
  }

  async function batchDelete() {
    if (selected.size === 0) return;
    const ok = await confirm({
      title: `批量删除 ${selected.size} 条卡密`,
      message:
        `将删除选中的 ${selected.size} 条卡密。\n` +
        "**已售出的会自动跳过**（要留作订单追溯）。\n\n此操作不可撤销，确定继续吗？",
      okText: "确认删除",
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const result = await api.admin.batchDeleteCards({ ids: [...selected] });
      toast.success(
        `已删除 ${result.affected} 条` + (result.skipped > 0 ? `，跳过已售 ${result.skipped} 条` : "")
      );
      setSelected(new Set());
      stats.reload();
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量删除失败");
    } finally {
      setBusy(false);
    }
  }

  const productOptions: Product[] = products.data?.rows ?? [];

  const selectedProduct = useMemo(
    () => productOptions.find((p) => p.id === productId),
    [productOptions, productId]
  );

  /* 导入弹窗里选中的商品 */
  const importTarget = useMemo(
    () => productOptions.find((p) => p.id === importProduct),
    [productOptions, importProduct]
  );
  const importSpecs = importTarget?.specs ?? [];
  const importNeedsSpec = importSpecs.length > 0;

  /* 切换商品时清掉规格筛选，避免残留上一个商品的规格 */
  useEffect(() => {
    setSpec("");
    setPage(1);
  }, [productId]);

  const importLines = useMemo(
    () => importText.split("\n").map((s) => s.trim()).filter(Boolean),
    [importText]
  );

  function openImport() {
    /* 只有当前已在「按商品筛选」时才沿用该商品；
       否则不替用户做选择——否则容易把卡密导进列表里第一个商品（此前的问题） */
    const first = productId || "";
    setImportProduct(first);
    setImportText("");
    /* 商品有规格时默认选第一个，减少一次点击 */
    const target = productOptions.find((p) => p.id === first);
    setImportSpec(target?.specs?.[0] ?? "");
    setImportOpen(true);
  }

  function onImportProductChange(nextId: string) {
    setImportProduct(nextId);
    const target = productOptions.find((p) => p.id === nextId);
    setImportSpec(target?.specs?.[0] ?? "");
  }

  async function submitImport() {
    if (importLines.length === 0) {
      toast.warn("请先粘贴卡密内容");
      return;
    }
    if (!importProduct) {
      toast.warn("请选择要导入的商品");
      return;
    }
    if (importNeedsSpec && !importSpec) {
      toast.warn("该商品有多个规格，请先选择要导入到哪个规格");
      return;
    }

    setImporting(true);
    try {
      const result = await api.admin.importCards({
        productId: importProduct,
        spec: importSpec,
        text: importText,
      });
      toast.success(
        `已导入 ${result.imported} 条到「${result.spec || "默认规格"}」` +
          (result.duplicated > 0 ? `，跳过重复 ${result.duplicated} 条` : "") +
          `，该规格现有 ${result.stock} 条`
      );
      setImportOpen(false);
      stats.reload();
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  async function removeCard(card: { id: number; key: string; spec: string }) {
    const ok = await confirm({
      title: "删除卡密",
      message: `确定要删除这条卡密吗？\n规格：${card.spec || "（无规格）"}\n${card.key}`,
      okText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.admin.deleteCard(card.id);
      toast.success("已删除该条卡密");
      stats.reload();
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <>
      <StatCards
        items={[
          {
            label: productId ? "该商品卡密总数" : "卡密总数",
            value: int(stats.data?.total ?? 0),
            icon: "🔑",
          },
          { label: "可用库存", value: int(stats.data?.available ?? 0), icon: "✅" },
          { label: "已售出", value: int(stats.data?.sold ?? 0), icon: "📤" },
          { label: "临时锁定", value: int(stats.data?.locked ?? 0), icon: "⏳" },
        ]}
      />

      <div className="toolbar-2 mt-24">
        <select
          className="select select-sm"
          style={{ minWidth: 190 }}
          aria-label="按商品筛选"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
        >
          <option value="">全部商品</option>
          {productOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {/* 规格筛选只在选中了「有规格的商品」时出现 */}
        {selectedProduct && selectedProduct.specs.length > 0 && (
          <select
            className="select select-sm"
            style={{ minWidth: 150 }}
            aria-label="按规格筛选"
            value={spec}
            onChange={(e) => {
              setSpec(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部规格</option>
            {selectedProduct.specs.map((s) => (
              <option key={s} value={s}>
                {s}（剩 {selectedProduct.specStock[s] ?? 0}）
              </option>
            ))}
          </select>
        )}

        <div className="search-box grow">
          <span className="ico">🔍</span>
          <input
            className="input"
            placeholder="搜索卡密内容"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <select
          className="select select-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部状态</option>
          <option value="未售">未售</option>
          <option value="已售">已售</option>
          <option value="已锁定">已锁定</option>
        </select>

        <div className="spacer" />

        {/* 用 <a> 直接下载，让浏览器处理文件名与保存位置 */}
        <a className="btn btn-ghost" href={exportUrl} download>
          ⬇ 导出 CSV
        </a>
        <button className="btn btn-primary" onClick={openImport}>
          ⬆ 批量导入卡密
        </button>
      </div>

      {selected.size > 0 && (
        <div className="batch-bar">
          <span className="count">已选中 {selected.size} 条卡密</span>
          <div className="spacer" />
          <button className="btn btn-accent btn-sm" disabled={busy} onClick={() => void batchDelete()}>
            批量删除
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setSelected(new Set())}>
            取消选择
          </button>
        </div>
      )}

      {/* 选中商品后，把各规格的库存摊开显示，一眼看出该补哪个规格 */}
      {selectedProduct && selectedProduct.specs.length > 0 && (
        <div className="spec-stock-bar">
          {selectedProduct.specs.map((s) => {
            const count = selectedProduct.specStock[s] ?? 0;
            return (
              <button
                key={s}
                type="button"
                className={`spec-stock${s === spec ? " is-active" : ""}${count === 0 ? " is-empty" : ""}`}
                onClick={() => {
                  setSpec(s === spec ? "" : s);
                  setPage(1);
                }}
              >
                <span className="name">{s}</span>
                <span className="count">
                  {count === 0 ? "已售罄" : `${count} 条`}
                </span>
              </button>
            );
          })}
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
                    aria-label="全选本页卡密"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </th>
                <SortableTh label="卡密" field="secret" sort={sort} onSort={setSort} />
                <th>所属商品</th>
                <SortableTh label="规格" field="spec" sort={sort} onSort={setSort} />
                <SortableTh label="状态" field="status" sort={sort} onSort={setSort} />
                <SortableTh label="导入时间" field="imported" sort={sort} onSort={setSort} />
                <SortableTh label="售出时间" field="sold" sort={sort} onSort={setSort} />
                <th>关联订单</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={9} height={200} />}
              {!loading && error && <TableEmpty cols={9} icon="🔌" text={error} />}
              {!loading && !error && rows.length === 0 && (
                <TableEmpty cols={9} icon="🔑" text="没有符合条件的卡密" />
              )}

              {!loading &&
                rows.map((c) => {
                  const sold = c.status === "已售";
                  const checked = selected.has(c.id);
                  return (
                    <tr key={c.id} className={checked ? "is-selected" : undefined}>
                      <td className="check-cell">
                        <input
                          type="checkbox"
                          aria-label={`选择 ${c.key}`}
                          checked={checked}
                          /* 已售卡密不允许删除，勾选框直接禁用，比点了再报错友好 */
                          disabled={sold}
                          title={sold ? "已售卡密需保留用于订单追溯" : undefined}
                          onChange={() => toggleOne(c.id)}
                        />
                      </td>
                      <td className="mono nowrap">{c.key}</td>
                      <td className="nowrap">{c.productName || c.product}</td>
                      <td className="nowrap">
                        {c.spec ? <span className="tag">{c.spec}</span> : <span className="dim">—</span>}
                      </td>
                      <td>
                        <StatusTag text={c.status} tone={cardStatusClass(c.status)} />
                      </td>
                      <td className="nowrap dim">{minutePart(c.importedAt)}</td>
                      <td className="nowrap dim">{c.soldAt ? minutePart(c.soldAt) : "—"}</td>
                      <td className="nowrap">
                        {c.order ? <span className="mono">{c.order}</span> : <span className="dim">—</span>}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            onClick={() => {
                              void copyText(c.key).then((ok) => {
                                if (ok) toast.success("卡密已复制");
                                else toast.warn("复制失败，请手动选择");
                              });
                            }}
                          >
                            复制
                          </button>
                          <span className="sep" />
                          <button className="danger" disabled={sold} onClick={() => void removeCard(c)}>
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
          <Pagination page={data.page} perPage={data.perPage} total={data.total} onChange={setPage} />
        )}
      </section>

      <p className="small dim mt-16">
        「已锁定」表示用户已下单但尚未完成支付，系统会临时占用该卡密，超时未支付将自动释放。
        <br />
        卡密按<strong>商品 + 规格</strong>隔离存放：买月卡只会在月卡的池子里取卡，不会发成年卡。
      </p>

      {importOpen && (
        <Modal
          title="批量导入卡密"
          width={540}
          onClose={() => setImportOpen(false)}
          footer={
            <>
              <button className="btn btn-ghost btn-block" onClick={() => setImportOpen(false)}>
                取消
              </button>
              <button
                className="btn btn-primary btn-block"
                disabled={importing || !importProduct || (importNeedsSpec && !importSpec)}
                onClick={() => void submitImport()}
              >
                {importing ? "导入中…" : "确认导入"}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="import-product">
              导入到商品 <span className="req">*</span>
            </label>
            <select
              id="import-product"
              className="select"
              value={importProduct}
              onChange={(e) => onImportProductChange(e.target.value)}
            >
              <option value="">请选择商品</option>
              {productOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* 商品有规格时，规格是必选项 */}
          {importNeedsSpec && (
            <div className="field">
              <label htmlFor="import-spec">
                导入到规格 <span className="req">*</span>
              </label>
              <select
                id="import-spec"
                className="select"
                value={importSpec}
                onChange={(e) => setImportSpec(e.target.value)}
              >
                {importSpecs.map((s) => (
                  <option key={s} value={s}>
                    {s}（当前剩 {importTarget?.specStock[s] ?? 0} 条）
                  </option>
                ))}
              </select>
              <div className="desc">
                该商品有 {importSpecs.length} 个规格，卡密必须明确归属其中一个。
                不同规格的卡密是分开存放的，买哪个规格就发哪个规格的卡。
              </div>
            </div>
          )}

          {importTarget && importTarget.specs.length === 0 && (
            <div className="notice">
              <span>ℹ️</span>
              <span>该商品没有配置规格，导入的卡密会作为「无规格」库存。</span>
            </div>
          )}

          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="import-text">
              卡密内容 <span className="req">*</span>
            </label>
            <textarea
              id="import-text"
              className="textarea"
              rows={9}
              placeholder={"一行一条卡密，例如：\nAIQY-8F3K-2M9D-77QX\nAIQY-5T1P-6B4N-20LZ"}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="import-hint">
              支持直接粘贴 Excel / 文本列，空行会自动忽略，重复卡密会在导入时自动跳过。
            </div>

            <div className={importLines.length > 0 ? "import-count" : "import-hint"}>
              {importLines.length > 0 ? (
                <>
                  ✅ 识别到 <strong>{importLines.length}</strong> 条卡密
                  {importNeedsSpec && importSpec && (
                    <>
                      ，将导入到「<strong>{importSpec}</strong>」
                    </>
                  )}
                </>
              ) : (
                "等待粘贴卡密…"
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export default CardsPage;
