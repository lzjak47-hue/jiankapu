/**
 * 简卡铺 · 客户管理
 * ---------------------------------------------------------------------------
 * 本页的「客户」不是注册账号，而是**下单时填的那个联系方式**。
 * 同一个人用同一个联系方式多次下单，在这里就是同一个客户。
 *
 * 因为前台没有登录，**所以不提供封禁**——封了也没意义，
 * 换个联系方式照样能买。后台能做的是「查」：查他买过什么、从哪个 IP 买的。
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../shared/api";
import {
  int,
  minutePart,
  money,
  orderStatusClass,
  relativeTime,
} from "../../shared/format";
import { useAsync, useDebouncedValue } from "../../shared/hooks";
import {
  Empty,
  Modal,
  Pagination,
  Skeleton,
  SortableTh,
  StatCards,
  StatusTag,
  TableEmpty,
  TableSkeleton,
} from "../../shared/components";
import { useToast } from "../../shared/ToastProvider";
import { useConfirm } from "../../shared/ConfirmProvider";
import type { CustomerDetail, ShopUser } from "../../shared/types";

const PER_PAGE = 8;

/* ------------------------------------------------------------ 详情弹窗 */

/** 顶部的一个小指标 */
function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="cust-metric">
      <div className="label">{label}</div>
      <div className="value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  );
}

function CustomerDetailBody({ detail, onClose }: { detail: CustomerDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const { customer, summary, ips, orders } = detail;

  /** 当前选中的 IP；空字符串 = 全部 */
  const [ipFilter, setIpFilter] = useState("");

  const visible = ipFilter ? orders.filter((o) => o.ip === ipFilter) : orders;

  function openOrder(no: string) {
    onClose();
    /* 带上订单号跳到订单管理，那边会自动展开这笔订单的详情 */
    navigate(`/orders?no=${encodeURIComponent(no)}`);
  }

  return (
    <>
      {/* 身份卡：一眼看清「这个人是谁、值多少钱」 */}
      <div className="cust-hero">
        <div className="avatar">{(customer.contact || customer.name).slice(0, 1)}</div>
        <div className="who">
          <div className="contact">{customer.contact || "未填写联系方式"}</div>
          <div className="meta">
            <span className="mono">{customer.id}</span>
            <span className="dot-sep">·</span>
            <span>{customer.name}</span>
          </div>
          <div className="times">
            <span>首次下单 {minutePart(summary.firstOrderAt)}</span>
            <span className="dot-sep">·</span>
            <span>最近下单 {minutePart(summary.lastOrderAt)}</span>
          </div>
        </div>
        <div className="amount">
          <div className="label">累计消费</div>
          <div className="value">¥{money(summary.totalAmount)}</div>
        </div>
      </div>

      <div className="cust-metrics">
        <Metric label="订单总数" value={int(summary.totalOrders)} unit="笔" />
        <Metric label="已付款" value={int(summary.paidOrders)} unit="笔" />
        <Metric label="使用过的 IP" value={int(summary.ipCount)} unit="个" />
      </div>

      {/* 购买清单：用卡片而不是表格，窄弹窗里可读性好得多。
          IP 筛选用下拉框 —— 十几个 IP 铺成一排要占掉大半屏。 */}
      <div className="cust-section">
        <div className="cust-section-title">
          购买记录
          <span className="hint">
            {visible.length > 0 && "点击可查看订单详情"}
          </span>
        </div>

        <div className="order-filter">
          <select
            className="select select-sm"
            aria-label="按下单 IP 筛选"
            value={ipFilter}
            onChange={(e) => setIpFilter(e.target.value)}
          >
            <option value="">全部 IP（{orders.length} 笔）</option>
            {ips.map((item) => (
              <option key={item.ip} value={item.ip}>
                {item.ip}（{item.count} 笔 · {relativeTime(item.lastAt)}）
              </option>
            ))}
          </select>

          <span className="order-filter-result">
            {ipFilter ? (
              <>
                该 IP 下 <strong>{visible.length}</strong> 笔
                <button type="button" className="link-btn" onClick={() => setIpFilter("")}>
                  清除
                </button>
              </>
            ) : (
              <>共 <strong>{orders.length}</strong> 笔（含未付款与已关闭）</>
            )}
          </span>
        </div>

        {visible.length === 0 ? (
          <Empty
            icon="🧾"
            text={ipFilter ? "这个 IP 下没有订单" : "这位客户还没有下过单"}
          />
        ) : (
          <div className="order-cards">
            {visible.map((o) => (
              <button
                type="button"
                className="order-card"
                key={o.no}
                onClick={() => openOrder(o.no)}
                title="查看这笔订单的完整信息"
              >
                <div className="line-1">
                  <span className="no mono">{o.no}</span>
                  <StatusTag text={o.status} tone={orderStatusClass(o.status)} />
                  <span className="amount">¥{money(o.amount)}</span>
                  <span className="go">→</span>
                </div>
                <div className="line-2">
                  {o.product}
                  {o.spec && <span className="tag">{o.spec}</span>}
                  <span className="qty">× {o.qty}</span>
                </div>
                <div className="line-3">
                  <span className="ip mono">{o.ip || "未记录 IP"}</span>
                  <span className="dot-sep">·</span>
                  <span>{minutePart(o.time)}</span>
                  <span className="dot-sep">·</span>
                  <span>{o.pay}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function CustomerDetailModal({ uid, onClose }: { uid: string; onClose: () => void }) {
  const { data, loading, error } = useAsync((signal) => api.admin.userDetail(uid, signal), [uid]);

  return (
    <Modal title="客户详情" width={720} onClose={onClose}>
      {loading && <Skeleton height={320} />}
      {!loading && error && <Empty icon="🔌" text={error} />}
      {!loading && data && <CustomerDetailBody detail={data} onClose={onClose} />}
    </Modal>
  );
}

/* ------------------------------------------------------------------ 页面 */

export function UsersPage() {
  const toast = useToast();
  const confirm = useConfirm();

  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState("default");
  const [page, setPage] = useState(1);
  const [detailUid, setDetailUid] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const debouncedKeyword = useDebouncedValue(keyword);

  const stats = useAsync((signal) => api.admin.userStats(signal), []);
  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.admin.users({ keyword: debouncedKeyword, sort, page, perPage: PER_PAGE }, signal),
    [debouncedKeyword, sort, page]
  );

  const rows = data?.rows ?? [];
  const selectedIds = [...selected];
  const pageIds = rows.map((u) => u.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

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

  async function runBatchDelete() {
    if (selectedIds.length === 0) {
      toast.warn("请先勾选客户");
      return;
    }
    const ok = await confirm({
      title: `批量删除 ${selectedIds.length} 条客户档案`,
      message:
        "删除的是「客户档案」记录，订单数据与追溯不受影响。\n\n此操作不可撤销，确定继续吗？",
      okText: "确认删除",
      danger: true,
    });
    if (!ok) return;

    setBatchBusy(true);
    try {
      const result = await api.admin.batchDeleteUsers({ ids: selectedIds });
      toast.success(`已删除 ${result.affected} 条客户档案`);
      setSelected(new Set());
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量删除失败");
    } finally {
      setBatchBusy(false);
    }
  }

  /** 没有联系方式的客户（理论上不该出现）点开也没东西可看，先提示一下 */
  function openDetail(user: ShopUser) {
    if (!user.contact) {
      toast.warn("这位客户没有留联系方式，无法关联订单");
      return;
    }
    setDetailUid(user.id);
  }

  return (
    <>
      <StatCards
        items={[
          { label: "客户总数", value: int(stats.data?.total ?? 0), icon: "👥" },
          { label: "下过单的", value: int(stats.data?.converted ?? 0), icon: "🧾" },
          { label: "活跃客户", value: int(stats.data?.active ?? 0), icon: "✅" },
          { label: "累计消费", value: `¥${money(stats.data?.amount ?? 0)}`, icon: "💰" },
        ]}
      />

      <div className="toolbar-2 mt-24">
        <div className="search-box grow">
          <span className="ico">🔍</span>
          <input
            className="input"
            placeholder="搜索联系方式 / 客户 ID"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
              setSelected(new Set());
            }}
          />
        </div>
      </div>

      {/* 选中后才出现的批量操作条 */}
      {selectedIds.length > 0 && (
        <div className="batch-bar">
          <span className="count">已选中 {selectedIds.length} 条客户档案</span>
          <span className="small dim">删除档案不影响订单与追溯</span>
          <div className="spacer" />
          <button
            className="btn btn-accent btn-sm"
            disabled={batchBusy}
            onClick={() => void runBatchDelete()}
          >
            批量删除
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={batchBusy}
            onClick={() => setSelected(new Set())}
          >
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
                    aria-label="全选本页客户"
                    checked={allOnPageSelected}
                    onChange={toggleAllOnPage}
                  />
                </th>
                <th>客户 ID</th>
                <SortableTh label="联系方式" field="name" sort={sort} onSort={setSort} />
                <SortableTh label="订单数" field="orders" sort={sort} onSort={setSort} />
                <SortableTh label="累计消费" field="amount" sort={sort} onSort={setSort} />
                <th>最近下单 IP</th>
                <SortableTh label="首次建档" field="created" sort={sort} onSort={setSort} />
                <SortableTh label="最近活跃" field="last" sort={sort} onSort={setSort} />
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={9} />}
              {!loading && error && <TableEmpty cols={9} icon="🔌" text={error} />}
              {!loading && !error && (data?.rows.length ?? 0) === 0 && (
                <TableEmpty cols={9} icon="👥" text="还没有客户，前台有人下单后会自动建档" />
              )}

              {!loading &&
                data?.rows.map((u) => {
                  const checked = selected.has(u.id);
                  return (
                    <tr key={u.id} className={checked ? "is-selected" : undefined}>
                      <td className="check-cell">
                        <input
                          type="checkbox"
                          aria-label={`选择客户 ${u.contact || u.id}`}
                          checked={checked}
                          onChange={() => toggleOne(u.id)}
                        />
                      </td>
                      <td className="mono nowrap">{u.id}</td>
                    <td>
                      <div className="cell-main">
                        <span className="cell-thumb">{(u.contact || u.name).slice(0, 1)}</span>
                        <div>
                          <div className="t1">{u.contact || "未填写联系方式"}</div>
                          <div className="t2">{u.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num nowrap">{int(u.orders)} 笔</td>
                    <td className="num nowrap">¥{money(u.amount)}</td>
                    <td className="mono nowrap">{u.lastIp || <span className="dim">—</span>}</td>
                    <td className="nowrap dim">{minutePart(u.regAt)}</td>
                    <td className="nowrap dim">{u.lastAt ? relativeTime(u.lastAt) : "—"}</td>
                    <td>
                      <div className="row-actions">
                        <button onClick={() => openDetail(u)}>查看详情</button>
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
        客户 = 下单时填写的<strong>联系方式</strong>。前台没有注册登录，所以这里不提供封禁；
        点「查看详情」可以看到他买过哪些商品、每笔订单的下单 IP。
        <br />
        同一个联系方式被多个 IP 使用过时，详情里会把所有 IP 都列出来。
      </p>

      {detailUid && <CustomerDetailModal uid={detailUid} onClose={() => setDetailUid("")} />}
    </>
  );
}

export default UsersPage;
