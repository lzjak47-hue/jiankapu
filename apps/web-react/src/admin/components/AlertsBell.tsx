/**
 * 简卡铺 · 后台提醒铃铛
 * ---------------------------------------------------------------------------
 * 轮询 /api/admin/alerts：
 *   · 有新订单 → 角标数字 + 弹一条 toast
 *   · 有商品售罄 → 铃铛上一个红点
 *
 * 「上次看到哪里」存在浏览器 localStorage 里，请求时带上 since，
 * 所以不用为已读状态建表，多个管理员各看各的互不干扰。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../shared/api";
import { money, minutePart } from "../../shared/format";
import { useInterval, useLocalStorage } from "../../shared/hooks";
import { useToast } from "../../shared/ToastProvider";
import type { AlertEvent, AlertsFeed } from "../../shared/types";

const POLL_MS = 20000;

export function AlertsBell() {
  const toast = useToast();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<AlertsFeed | null>(null);
  const [lastSeen, setLastSeen] = useLocalStorage<string>("jkp.admin.lastSeen", "");
  const [unseen, setUnseen] = useState(0);

  /**
   * 打开面板那一刻的事件快照。
   *
   * 打开面板会把当前时刻记为「已读」，随后的轮询就会返回「没有新订单」——
   * 如果直接渲染最新数据，用户想看的那几条通知会在点开的瞬间消失。
   * 所以打开时冻结一份，关闭时再恢复成实时数据。
   */
  const [snapshot, setSnapshot] = useState<AlertEvent[] | null>(null);

  /* 上一次已经提示过的订单数，用来判断「是不是又来了新的」 */
  const notifiedRef = useRef<number | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await api.admin.alerts({ since: lastSeen });
      setFeed(data);

      /* 第一次打开（浏览器里没有记录）不算「新订单」，
         否则刚登录就会看到一堆历史订单的提示。直接以当前时刻为基准。 */
      if (!lastSeen) {
        setLastSeen(data.serverTime);
        notifiedRef.current = 0;
        setUnseen(0);
        return;
      }

      setUnseen(data.unseenOrders);

      const previous = notifiedRef.current;
      notifiedRef.current = data.unseenOrders;

      /* 只在「数量变多」时提示，避免每轮轮询都弹一次 */
      if (previous !== null && data.unseenOrders > previous) {
        const fresh = data.unseenOrders - previous;
        toast.toast(
          `有 ${fresh} 笔新订单，合计 ¥${money(data.unseenAmount)}`,
          "🔔"
        );
      }
    } catch {
      /* 轮询失败不打扰管理员，下一轮再试 */
    }
  }, [lastSeen, setLastSeen, toast]);

  useEffect(() => {
    void poll();
  }, [poll]);

  useInterval(() => void poll(), POLL_MS);

  /** 打开下拉就视为「已读」，同时冻结当前列表 */
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && feed) {
      setSnapshot(feed.events);
      setLastSeen(feed.serverTime);
      setUnseen(0);
      notifiedRef.current = 0;
    } else {
      setSnapshot(null);
    }
  }

  /* 点到页面别处就收起 */
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest(".alerts-wrap")) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  const soldOut = feed?.soldOutCount ?? 0;
  const lowStock = feed?.lowStock ?? [];
  /* 面板打开时用快照，关闭后用实时数据 */
  const events = snapshot ?? feed?.events ?? [];

  return (
    <div className="alerts-wrap">
      <button
        className={`alerts-btn${soldOut > 0 ? " has-danger" : ""}`}
        onClick={toggle}
        aria-label={`提醒${unseen > 0 ? `（${unseen} 笔新订单）` : ""}`}
      >
        🔔
        {unseen > 0 && <span className="badge">{unseen > 99 ? "99+" : unseen}</span>}
        {unseen === 0 && soldOut > 0 && <span className="dot-danger" />}
      </button>

      {open && (
        <div className="alerts-panel">
          <div className="alerts-head">
            <strong>提醒</strong>
            {feed && (
              <span className="sub">
                库存阈值 {feed.threshold} · 待付款 {feed.pendingOrders} 笔
              </span>
            )}
          </div>

          {/* 库存预警汇总 */}
          {lowStock.length > 0 && (
            <div className="alerts-stock">
              <div className="title">
                {soldOut > 0 ? `⚠️ ${soldOut} 个商品已售罄` : "⚠️ 库存预警"}
              </div>
              {lowStock.slice(0, 5).map((p) => (
                <button
                  key={p.id}
                  className="stock-row"
                  onClick={() => {
                    setOpen(false);
                    navigate("/cards");
                  }}
                >
                  <span className="name">
                    {p.emoji} {p.name}
                  </span>
                  <span className={p.soldOut ? "count danger" : "count"}>
                    {p.soldOut ? "售罄" : `剩 ${p.stock}`}
                  </span>
                </button>
              ))}
              {lowStock.length > 5 && (
                <div className="more">还有 {lowStock.length - 5} 个商品库存偏低…</div>
              )}
            </div>
          )}

          {/* 事件流 */}
          <div className="alerts-list">
            {events.length === 0 ? (
              <div className="alerts-empty">暂时没有新动静</div>
            ) : (
              events.slice(0, 12).map((e) => (
                <button
                  key={e.id}
                  className={`alert-item level-${e.level}`}
                  onClick={() => {
                    setOpen(false);
                    navigate(e.type === "order" ? "/orders" : "/products");
                  }}
                >
                  <span className="ico">{e.type === "order" ? "🧾" : "📦"}</span>
                  <span className="body">
                    <span className="t1">
                      {e.title}
                      {e.time && <span className="time">{minutePart(e.time)}</span>}
                    </span>
                    <span className="t2">{e.desc}</span>
                    <span className="t3">
                      {e.extra}
                      {e.ip ? ` · ${e.ip}` : ""}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="alerts-foot">
            <button
              onClick={() => {
                setOpen(false);
                navigate("/orders");
              }}
            >
              查看全部订单
            </button>
            <button
              onClick={() => {
                setOpen(false);
                navigate("/cards");
              }}
            >
              去补卡密
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AlertsBell;
