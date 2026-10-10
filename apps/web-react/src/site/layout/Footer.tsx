/**
 * 简卡铺 · 前台页脚
 * ---------------------------------------------------------------------------
 * 只保留最下面一行：版权声明、ICP 备案号、管理后台入口。
 * 客服入口在右下角的悬浮按钮里，不在这里重复。
 */
import { useSite } from "../SiteContext";

export function Footer() {
  const { settings, endpoints } = useSite();

  const site = settings?.site;
  const adminUrl = endpoints?.admin ? `${endpoints.admin}/login` : "/admin";
  const year = new Date().getFullYear();
  const icp = (site?.icp ?? "").trim();

  return (
    <footer className="footer footer-slim">
      <div className="container footer-bottom">
        <span>
          © {year} {site?.name || "简卡铺"} ·{" "}
          {site?.footerText || "虚拟商品一经售出不支持退换"}
        </span>

        <span className="footer-meta">
          {icp && (
            <a
              className="icp"
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {icp}
            </a>
          )}
          <a href={adminUrl}>管理后台</a>
        </span>
      </div>
    </footer>
  );
}

export default Footer;
