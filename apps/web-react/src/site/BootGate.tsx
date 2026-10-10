/**
 * 简卡铺 · 首屏数据门
 * ---------------------------------------------------------------------------
 * 数据没到位前显示骨架，失败时给出可重试的错误页，
 * 避免各页面各自处理 loading / error。
 */
import type { ReactNode } from "react";
import { useSite } from "./SiteContext";

export function BootGate({ children }: { children: ReactNode }) {
  const { loading, error, reload } = useSite();

  if (loading) {
    return (
      <div className="container" style={{ padding: "80px 20px" }}>
        <div className="skeleton" style={{ height: 44, width: 220, marginBottom: 18 }} />
        <div className="skeleton" style={{ height: 18, width: 380, marginBottom: 40 }} />
        <div className="grid">
          {Array.from({ length: 8 }, (_, i) => (
            <div className="skeleton" key={i} style={{ height: 268 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="boot-error">
        <div className="boot-error-inner">
          <div className="ico">🔌</div>
          <h3>无法连接服务器</h3>
          <p>{error}</p>
          <p className="small">
            请确认后端服务已启动：<code>npm start</code>
          </p>
          <button className="btn btn-primary" onClick={reload}>
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default BootGate;
