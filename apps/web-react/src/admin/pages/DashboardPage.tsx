/**
 * 简卡铺 · 数据概览
 */
import { api } from "../../shared/api";
import { money, orderStatusClass, int, duration, fileSize } from "../../shared/format";
import { useAsync } from "../../shared/hooks";
import { BlockHead, Empty, Skeleton, StatCards, StatusTag, TableEmpty } from "../../shared/components";

export function DashboardPage() {
  const { data, loading, error } = useAsync((signal) => api.admin.dashboard(signal), []);

  if (loading) {
    return (
      <>
        <div className="stat-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div className="stat-card" key={i}>
              <Skeleton height={92} />
            </div>
          ))}
        </div>
        <div className="grid-2 mt-24">
          <div className="block">
            <div className="block-body">
              <Skeleton height={230} />
            </div>
          </div>
          <div className="block">
            <div className="block-body">
              <Skeleton height={230} />
            </div>
          </div>
        </div>
      </>
    );
  }

  if (error || !data) {
    return (
      <div className="block">
        <Empty icon="🔌" text={error ?? "概览加载失败"} hint="稍后刷新页面重试" />
      </div>
    );
  }

  const maxOrders = Math.max(1, ...data.series.map((s) => s.orders));
  const maxSold = data.topProducts.length > 0 ? data.topProducts[0]!.sold : 1;

  return (
    <>
      <StatCards
        withDelta
        items={data.stats.map((s) => ({
          label: s.label,
          value: s.money ? money(s.value) : int(s.value),
          unit: s.unit,
          icon: s.icon,
          delta: s.delta,
          up: s.up,
        }))}
      />

      <div className="grid-2 mt-24">
        <section className="block">
          <BlockHead
            title="近 7 天订单走势"
            sub="把鼠标移到柱子上可查看当日订单数与成交金额"
            right={<span className="tag">按订单数</span>}
          />
          <div className="block-body">
            <div className="chart">
              {data.series.map((point) => (
                <div className="chart-col" key={point.date}>
                  <div className="chart-bar-wrap">
                    <div
                      className="chart-bar"
                      style={{ height: `${Math.max(6, Math.round((point.orders / maxOrders) * 100))}%` }}
                    >
                      <span className="tip">
                        {point.date} · {point.orders} 单 · ¥{money(point.revenue)}
                      </span>
                    </div>
                  </div>
                  <span className="chart-label">{point.date}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="block">
          <BlockHead title="热销商品 TOP 5" sub="按累计销量排序" />
          <div className="block-body">
            {data.topProducts.length === 0 ? (
              <Empty icon="📦" text="还没有销售数据" />
            ) : (
              <ul className="rank-list">
                {data.topProducts.map((p, i) => (
                  <li key={p.id}>
                    <span className="rank-no">{i + 1}</span>
                    <span className="rank-name" title={p.name}>
                      {p.emoji} {p.name}
                      <span className="bar-mini">
                        <i style={{ width: `${Math.max(4, Math.round((p.sold / maxSold) * 100))}%` }} />
                      </span>
                    </span>
                    <span className="rank-val">{int(p.sold)} 件</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <div className="grid-2 mt-24">
        <section className="block">
          <BlockHead
            title="最近订单"
            sub="最新 6 笔成交记录"
            right={
              <a className="btn btn-soft btn-sm" href="/orders">
                查看全部
              </a>
            }
          />
          <div className="block-body tight">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>订单号</th>
                    <th>商品</th>
                    <th>金额</th>
                    <th>状态</th>
                    <th>下单时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentOrders.length === 0 ? (
                    <TableEmpty cols={5} icon="🧾" text="还没有订单" />
                  ) : (
                    data.recentOrders.map((o) => (
                      <tr key={o.no}>
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
                        <td className="num nowrap">¥{money(o.amount)}</td>
                        <td>
                          <StatusTag text={o.status} tone={orderStatusClass(o.status)} />
                        </td>
                        <td className="nowrap dim">{o.time.slice(5, 16)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="block">
          <BlockHead
            title="系统信息"
            sub="当前运行状态"
            right={<StatusTag text="运行中" tone="on" />}
          />
          <div className="block-body">
            <div className="summary-row">
              <span className="k">系统版本</span>
              <span className="v">{data.system.version}</span>
            </div>
            <div className="summary-row">
              <span className="k">运行环境</span>
              <span className="v">
                {data.system.runtime} · {data.system.nodeEnv}
              </span>
            </div>
            <div className="summary-row">
              <span className="k">数据库</span>
              <span className="v">
                {data.system.database} · {fileSize(data.system.dbSizeKb)}
              </span>
            </div>
            <div className="summary-row">
              <span className="k">订单 / 卡密</span>
              <span className="v">
                {int(data.system.totalOrders)} 笔 / {int(data.system.totalCards)} 条
              </span>
            </div>
            <div className="summary-row">
              <span className="k">服务运行时长</span>
              <span className="v">{duration(data.system.uptimeSeconds)}</span>
            </div>
            <div className="summary-row">
              <span className="k">服务器时间</span>
              <span className="v">{data.system.serverTime}</span>
            </div>

            <div className="notice" style={{ marginTop: 18 }}>
              <span>💡</span>
              <span>
                数据全部来自 PostgreSQL，实时聚合。定时任务每 30 秒关闭超时订单并释放占用的卡密。
              </span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

export default DashboardPage;
