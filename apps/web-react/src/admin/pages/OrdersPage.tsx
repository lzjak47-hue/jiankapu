/**
 * 简卡铺 · 订单管理
 */
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../shared/api";
import { cx, money, int, orderStatusClass, copyText, minutePart } from "../../shared/format";
import { useAsync, useDebouncedValue } from "../../shared/hooks";
import {
  Modal,
  Pagination,
  SecretList,
  SortableTh,
  StatCards,
  StatusTag,
  TableEmpty,
  TableSkeleton,
  Empty,
} from "../../shared/components";
import { useToast } from "../../shared/ToastProvider";
import { useConfirm } from "../../shared/ConfirmProvider";
import type { AdminOrder } from "../../shared/types";

const PER_PAGE = 8;

export function OrdersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [pay, setPay] = useState("");
  const [sort, setSort] = useState("default");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AdminOrder | null>(null);
  const debouncedKeyword = useDebouncedValue(keyword);

  /**
   * 从客户详情点订单跳过来时带着 ?no=订单号。
   *
   * 这里**不弹详情弹窗** —— 用户要的是「在原列表里看到它」，
   * 而不是被带走去看另一张弹窗。所以把列表筛成那一笔，并给它换个颜色。
   */
  const focusNo = searchParams.get("no") ?? "";

  useEffect(() => {
    if (!focusNo) return;
    /* 清掉其它筛选条件，否则目标订单可能被筛掉、压根不在列表里 */
    setKeyword(focusNo);
    setStatus("");
    setPay("");
    setPage(1);
  }, [focusNo]);

  const stats = useAsync((signal) => api.admin.orderStats(signal), []);
  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.admin.orders(
        { keyword: debouncedKeyword, status, pay, sort, page, perPage: PER_PAGE },
        signal
      ),
    [debouncedKeyword, status, pay, sort, page]
  );

  /* 目标行滚动到视野中央，省得用户自己找。
     要等列表数据回来才可能有那一行，所以放在请求之后。 */
  useEffect(() => {
    if (!focusNo || loading) return;
    const rows = document.querySelectorAll<HTMLElement>("tr[data-order-no]");
    for (const row of rows) {
      if (row.dataset.orderNo === focusNo) {
        /* jsdom 没实现 scrollIntoView，测试环境下会被跳过 */
        row.scrollIntoView?.({ block: "center", behavior: "smooth" });
        break;
      }
    }
  }, [focusNo, loading, data]);

  /** 取消定位，回到完整列表 */
  function clearFocus() {
    const next = new URLSearchParams(searchParams);
    next.delete("no");
    setSearchParams(next, { replace: true });
    setKeyword("");
  }

  function resetPage<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  async function openDetail(no: string) {
    try {
      setDetail(await api.admin.order(no));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "订单加载失败");
    }
  }

  async function resend(order: AdminOrder) {
    const ok = await confirm({
      title: "补发卡密",
      message: `将为订单 ${order.no} 额外发放一批卡密（数量与订单数量相同），确定继续吗？`,
      okText: "补发",
    });
    if (!ok) return;
    try {
      const updated = await api.admin.resendOrder(order.no);
      toast.success(`订单 ${order.no} 已补发，当前共 ${updated.secrets.length} 条卡密`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "补发失败");
    }
  }

  async function close(order: AdminOrder) {
    const ok = await confirm({
      title: "关闭订单",
      message: `确定要关闭订单 ${order.no} 吗？锁定的卡密会退回库存。`,
      okText: "关闭订单",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.admin.closeOrder(order.no);
      toast.success(`订单 ${order.no} 已关闭`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "关闭失败");
    }
  }

  async function refund(order: AdminOrder) {
    const ok = await confirm({
      title: "订单退款",
      message: `确认对订单 ${order.no} 退款？已发出的卡密将作废且无法回收。`,
      okText: "确认退款",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.admin.refundOrder(order.no);
      toast.success(`订单 ${order.no} 已退款`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "退款失败");
    }
  }

  return (
    <>
      <StatCards
        items={[
          { label: "订单总数", value: int(stats.data?.total ?? 0), unit: "笔", icon: "🧾" },
          { label: "已发货", value: int(stats.data?.shipped ?? 0), unit: "笔", icon: "✅" },
          { label: "成交金额", value: `¥${money(stats.data?.revenue ?? 0)}`, icon: "💰" },
          { label: "待处理", value: int(stats.data?.pending ?? 0), unit: "笔", icon: "⏳" },
        ]}
      />

      <div className="toolbar-2 mt-24">
        <div className="search-box grow">
          <span className="ico">🔍</span>
          <input
            className="input"
            placeholder="搜索订单号 / 商品 / 联系方式"
            value={keyword}
            onChange={(e) => resetPage(setKeyword)(e.target.value)}
          />
        </div>

        <select
          className="select select-sm"
          value={status}
          onChange={(e) => resetPage(setStatus)(e.target.value)}
        >
          <option value="">全部状态</option>
          <option value="已发货">已发货</option>
          <option value="处理中">处理中</option>
          <option value="待付款">待付款</option>
          <option value="已关闭">已关闭</option>
          <option value="已退款">已退款</option>
          <option value="失败">失败</option>
        </select>

        <select className="select select-sm" aria-label="按支付方式筛选" value={pay} onChange={(e) => resetPage(setPay)(e.target.value)}>
          <option value="">全部支付方式</option>
          <option value="wechat">微信支付</option>
          <option value="alipay">支付宝</option>
          <option value="test">测试支付</option>
        </select>
      </div>

      {/* 从客户详情跳过来时，说明清楚为什么列表只剩一笔 */}
      {focusNo && (
        <div className="batch-bar" style={{ background: "var(--warning-weak)", borderColor: "#ffe0b2" }}>
          <span className="count" style={{ color: "#b45309" }}>
            🎯 已定位到订单 <span className="mono">{focusNo}</span>
          </span>
          <span className="small dim">该行已用橙色标出</span>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={clearFocus}>
            显示全部订单
          </button>
        </div>
      )}

      <section className="block">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <SortableTh label="订单号" field="no" sort={sort} onSort={setSort} />
                <th>商品</th>
                <th>联系方式</th>
                <th>下单 IP</th>
                <SortableTh label="金额" field="amount" sort={sort} onSort={setSort} />
                <SortableTh label="数量" field="qty" sort={sort} onSort={setSort} />
                <th>支付方式</th>
                <SortableTh label="状态" field="status" sort={sort} onSort={setSort} />
                <SortableTh label="下单时间" field="created" sort={sort} onSort={setSort} />
                <SortableTh label="支付时间" field="paid" sort={sort} onSort={setSort} />
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={10} />}
              {!loading && error && <TableEmpty cols={10} icon="🔌" text={error} />}
              {!loading && !error && (data?.rows.length ?? 0) === 0 && (
                <TableEmpty cols={10} icon="🧾" text="没有符合条件的订单" />
              )}

              {!loading &&
                data?.rows.map((o) => (
                  <tr
                    key={o.no}
                    data-order-no={o.no}
                    className={cx(o.no === focusNo && "is-focus")}
                  >
                    <td className="mono nowrap">{o.no}</td>
                    <td>
                      <div className="cell-main">
                        <span className="cell-thumb">🧾</span>
                        <div>
                          <div className="t1">{o.product}</div>
                          <div className="t2">
                            {o.spec || "—"} × {o.qty}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="nowrap dim">{o.contact || "—"}</td>
                    <td className="mono nowrap">{o.ip || <span className="dim">—</span>}</td>
                    <td className="num nowrap">¥{money(o.amount)}</td>
                    <td className="nowrap">{o.pay}</td>
                    <td>
                      <StatusTag text={o.status} tone={orderStatusClass(o.status)} />
                    </td>
                    <td className="nowrap dim">{minutePart(o.time)}</td>
                    <td className="nowrap dim">{o.paidAt ? minutePart(o.paidAt) : "—"}</td>
                    <td>
                      <div className="row-actions">
                        <button onClick={() => void openDetail(o.no)}>详情</button>
                        <span className="sep" />
                        <button onClick={() => void resend(o)}>补发</button>
                        <span className="sep" />
                        {o.status === "待付款" ? (
                          <button className="danger" onClick={() => void close(o)}>
                            关闭
                          </button>
                        ) : (
                          <button className="danger" onClick={() => void refund(o)}>
                            退款
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {data && (
          <Pagination page={data.page} perPage={data.perPage} total={data.total} onChange={setPage} />
        )}
      </section>

      <p className="small dim mt-16">
        提示：卡密类订单由系统自动发货；「补发」会额外分配卡密给用户，适用于用户反馈卡密无效的场景。
      </p>

      {detail && (
        <Modal title="订单详情" width={480} onClose={() => setDetail(null)}>
          <div className="summary">
            <div className="summary-row">
              <span className="k">订单号</span>
              <span className="v mono">{detail.no}</span>
            </div>
            <div className="summary-row">
              <span className="k">下单时间</span>
              <span className="v">{detail.time}</span>
            </div>
            <div className="summary-row">
              <span className="k">下单 IP</span>
              <span className="v mono">{detail.ip || "未记录"}</span>
            </div>
            <div className="summary-row">
              <span className="k">联系方式</span>
              <span className="v">{detail.contact || "—"}</span>
            </div>
            <div className="summary-row">
              <span className="k">支付方式</span>
              <span className="v">{detail.pay}</span>
            </div>
            <div className="summary-row">
              <span className="k">支付时间</span>
              <span className="v">{detail.paidAt || "—"}</span>
            </div>
            <div className="summary-row">
              <span className="k">订单状态</span>
              <span className="v">
                <StatusTag text={detail.status} tone={orderStatusClass(detail.status)} />
              </span>
            </div>
          </div>

          <h4 className="h3 mt-24" style={{ marginBottom: 12 }}>
            商品明细
          </h4>
          <div className="summary">
            <div className="summary-row">
              <span className="k">
                {detail.product} · {detail.spec || "—"} × {detail.qty}
              </span>
              <span className="v">¥{money(detail.amount)}</span>
            </div>
          </div>

          <h4 className="h3 mt-24" style={{ marginBottom: 12 }}>
            卡密内容
          </h4>
          {detail.secrets.length > 0 ? (
            <SecretList
              secrets={detail.secrets}
              onCopy={(text) => {
                void copyText(text).then((ok) => {
                  if (ok) toast.success("卡密已复制");
                  else toast.warn("复制失败，请手动选择");
                });
              }}
            />
          ) : (
            <Empty icon="📭" text="该订单暂无卡密" />
          )}
        </Modal>
      )}
    </>
  );
}

export default OrdersPage;
