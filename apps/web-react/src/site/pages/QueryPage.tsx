/**
 * 简卡铺 · 查询订单
 * ---------------------------------------------------------------------------
 * 支持两种查询：订单号精确匹配、下单时填写的联系方式模糊匹配。
 * 也支持 /query?no=xxx 直接带参进入（下单成功页会这么跳）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../shared/api";
import { copyText, money } from "../../shared/format";
import { Empty, SecretList, Skeleton } from "../../shared/components";
import { useToast } from "../../shared/ToastProvider";
import type { PublicOrder } from "../../shared/types";

type Phase = "idle" | "loading" | "done" | "error";

const STATUS_TAG: Record<string, string> = {
  已发货: "tag-success",
  待付款: "tag-accent",
  已关闭: "tag-muted",
  已退款: "tag-muted",
  处理中: "tag",
};

function OrderCard({ order }: { order: PublicOrder }) {
  const toast = useToast();
  const paid = order.status === "已发货" && order.secrets.length > 0;

  const copy = useCallback(
    async (text: string, tip: string) => {
      const ok = await copyText(text);
      if (ok) toast.success(tip);
      else toast.warn("复制失败，请手动选择");
    },
    [toast]
  );

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <span className={`tag ${STATUS_TAG[order.status] ?? "tag-muted"}`}>
          <span className="dot" />
          {order.status}
        </span>
        <strong style={{ fontSize: 14 }}>订单号 {order.no}</strong>
        <span className="small dim" style={{ marginLeft: "auto" }}>
          {order.createdAt}
        </span>
      </div>

      <div className="panel-body">
        <div className="kv">
          <div>
            <div className="k">商品</div>
            <div className="v">{order.product}</div>
          </div>
          <div>
            <div className="k">规格</div>
            <div className="v">{order.spec || "—"}</div>
          </div>
          <div>
            <div className="k">数量</div>
            <div className="v">{order.qty}</div>
          </div>
          <div>
            <div className="k">支付方式</div>
            <div className="v">{order.payMethod}</div>
          </div>
          <div>
            <div className="k">订单金额</div>
            <div className="v">¥{money(order.amount)}</div>
          </div>
        </div>

        <h4 className="h3 mt-24" style={{ marginBottom: 12 }}>
          卡密内容
        </h4>

        {paid ? (
          <>
            <SecretList secrets={order.secrets} onCopy={(s) => void copy(s, "卡密已复制")} />
            <button
              className="btn btn-primary btn-block mt-24"
              onClick={() => void copy(order.secrets.join("\n"), "已复制全部卡密")}
            >
              一键复制全部
            </button>
          </>
        ) : (
          <Empty
            icon={order.status === "待付款" ? "⏳" : "📭"}
            text={
              order.status === "待付款"
                ? "订单尚未支付，完成后即可查看卡密"
                : order.status === "已关闭"
                  ? "订单已关闭，卡密已退回库存"
                  : "该订单暂无卡密"
            }
          />
        )}
      </div>
    </div>
  );
}

export function QueryPage() {
  const [searchParams] = useSearchParams();
  const [keyword, setKeyword] = useState(searchParams.get("no") ?? "");
  const [orders, setOrders] = useState<PublicOrder[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const runQuery = useCallback(async (value: string) => {
    const kw = value.trim();
    if (!kw) {
      setPhase("error");
      setMessage("请输入订单号或联系方式");
      inputRef.current?.focus();
      return;
    }
    setPhase("loading");
    try {
      const data = await api.public.queryOrders(kw);
      setOrders(data.orders);
      setPhase("done");
    } catch (err) {
      setOrders([]);
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "没有查询到该订单");
    }
  }, []);

  /* 带 ?no= 进来时自动查询一次 */
  useEffect(() => {
    const preset = searchParams.get("no");
    if (preset) void runQuery(preset);
  }, [searchParams, runQuery]);

  return (
    <div className="container page">
      <div className="breadcrumb">
        <Link to="/">首页</Link>
        <span className="sep">/</span>
        <span>查询订单</span>
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h1 className="h2">找回你的卡密</h1>
          <p className="muted mt-8">
            输入下单时获得的<strong>订单号</strong>，即可查看订单状态与卡密内容。
          </p>
        </div>

        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void runQuery(keyword);
          }}
        >
          <div className="panel-body">
            <div className="field" style={{ marginBottom: 16 }}>
              <label htmlFor="query-input">订单号 / 联系方式</label>
              <div className="input-group">
                <input
                  id="query-input"
                  ref={inputRef}
                  className="input"
                  placeholder="例如 JKP20260101001"
                  autoComplete="off"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
                <button className="btn btn-primary" type="submit" disabled={phase === "loading"}>
                  {phase === "loading" ? "查询中…" : "立即查询"}
                </button>
              </div>
              <p className="hint">
                订单号在下单成功页面与支付结果中都会显示，请留意保存。
              </p>
            </div>
          </div>
        </form>

        <div className="mt-24">
          {phase === "idle" && (
            <div className="panel">
              <Empty icon="🧾" text="还没有查询记录" hint="输入上方订单号后点击「立即查询」" />
            </div>
          )}

          {phase === "loading" && (
            <div className="panel">
              <div className="panel-body">
                <Skeleton height={120} />
              </div>
            </div>
          )}

          {phase === "error" && (
            <div className="panel">
              <Empty
                icon="📭"
                text={message}
                hint="订单号在下单成功页面可以复制；也可用下单时填写的联系方式查询。"
              />
            </div>
          )}

          {phase === "done" && orders.map((o) => <OrderCard key={o.no} order={o} />)}
        </div>

        <section className="section-sm" id="faq" style={{ paddingBottom: 0 }}>
          <h2 className="h2" style={{ fontSize: 20, marginBottom: 18 }}>
            常见问题
          </h2>
          <div className="panel">
            <div className="panel-body">
              <div className="prose">
                <h4>查不到订单怎么办？</h4>
                <p>
                  请确认订单号是否完整复制（通常以 JKP 开头）。若仍查询不到，请通过右下角在线客服提供下单时间与支付截图，我们会人工协助查找。
                </p>
                <h4>卡密显示无效 / 已被使用？</h4>
                <p>
                  请在发货后 24 小时内联系客服，并提供订单号与卡密截图。核实为卡密本身问题后，我们会免费补发或退款。
                </p>
                <h4>买错了规格可以换吗？</h4>
                <p>
                  虚拟商品一经发货无法撤回，因此不支持更换规格。下单前请仔细核对商品名称与规格。
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default QueryPage;
