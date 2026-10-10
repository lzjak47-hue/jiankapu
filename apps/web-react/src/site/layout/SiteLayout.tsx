/**
 * 简卡铺 · 前台整体布局
 */
import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AnnouncementBar } from "./AnnouncementBar";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { Empty, Modal } from "../../shared/components";
import { copyText, isHttpUrl } from "../../shared/format";
import { useSite } from "../SiteContext";
import { useToast } from "../../shared/ToastProvider";

/**
 * 右下角悬浮按钮：客服 + 回到顶部
 *
 * 客服配置可能是完整网址，也可能只是 QQ / 微信号。
 * 后者不能当 href 用（会跳到站内 404），改成弹窗里可复制的形式。
 */
function FloatingButtons() {
  const { settings } = useSite();
  const toast = useToast();
  const [contactOpen, setContactOpen] = useState(false);

  const service = (settings?.site?.serviceUrl ?? "").trim();
  const serviceTime = settings?.site?.serviceTime || "9:00 - 24:00";
  const isUrl = isHttpUrl(service);

  return (
    <>
      <div className="fab">
        {service && isUrl ? (
          <a
            className="fab-btn primary"
            href={service}
            target="_blank"
            rel="noopener"
            title="在线客服"
            aria-label="在线客服"
          >
            💬
          </a>
        ) : (
          <button
            className="fab-btn primary"
            title="在线客服"
            aria-label="在线客服"
            onClick={() => setContactOpen(true)}
          >
            💬
          </button>
        )}
        <button
          className="fab-btn"
          title="回到顶部"
          aria-label="回到顶部"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          ↑
        </button>
      </div>

      {contactOpen && (
        <Modal title="联系客服" width={380} onClose={() => setContactOpen(false)}>
          {service ? (
            <>
              <p className="muted" style={{ marginBottom: 14 }}>
                添加下方账号联系客服，服务时间 {serviceTime}。
              </p>
              <div className="secret-item" style={{ marginBottom: 14 }}>
                <code>{service}</code>
                <button
                  className="btn btn-soft btn-sm"
                  onClick={() => {
                    void copyText(service).then((ok) => {
                      if (ok) toast.success("客服账号已复制");
                      else toast.warn("复制失败，请手动选择");
                    });
                  }}
                >
                  复制
                </button>
              </div>
              {settings?.site?.email && (
                <p className="small dim">客服邮箱：{settings.site.email}</p>
              )}
            </>
          ) : (
            <Empty
              icon="💬"
              text="还没有配置客服信息"
              hint="请在后台「系统设置 → 基础设置」里填写客服链接或客服账号。"
            />
          )}
        </Modal>
      )}
    </>
  );
}

export function SiteLayout() {
  return (
    <>
      <AnnouncementBar />
      <Header />
      <main>
        <Outlet />
      </main>
      <Footer />
      <FloatingButtons />
    </>
  );
}

export default SiteLayout;
