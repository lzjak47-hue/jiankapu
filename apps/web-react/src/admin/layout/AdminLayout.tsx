/**
 * 简卡铺 · 后台壳层
 * ---------------------------------------------------------------------------
 * 侧边栏 + 顶栏在这里统一渲染，各页面只负责内容。
 * 前台地址从 window.JKP_RUNTIME 读取（服务端注入），用于跨端口跳转。
 */
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useConfirm } from "../../shared/ConfirmProvider";
import { useAuth } from "../AuthContext";
import { AlertsBell } from "../components/AlertsBell";
import { ChangePasswordModal } from "../components/ChangePasswordModal";
import { cx } from "../../shared/format";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  /** 页面标题与副标题 */
  title: string;
  sub: string;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    group: "概览",
    items: [{ to: "/", label: "数据概览", icon: "📊", end: true, title: "数据概览", sub: "今天也辛苦了，先看看店里的情况" }],
  },
  {
    group: "商品",
    items: [
      { to: "/products", label: "商品管理", icon: "📦", title: "商品管理", sub: "上架、改价、补库存都在这里" },
      { to: "/categories", label: "分类管理", icon: "🗂️", title: "分类管理", sub: "分类决定前台商品列表的筛选标签" },
      { to: "/cards", label: "卡密库存", icon: "🔑", title: "卡密库存", sub: "批量导入卡密，实时掌握可用库存" },
    ],
  },
  {
    group: "交易",
    items: [
      { to: "/orders", label: "订单管理", icon: "🧾", title: "订单管理", sub: "查订单、补发卡密、处理退款" },
      { to: "/users", label: "客户管理", icon: "👥", title: "客户管理", sub: "客户 = 下单时填的联系方式；可查购买记录与下单 IP" },
    ],
  },
  {
    group: "系统",
    items: [
      { to: "/settings", label: "系统设置", icon: "⚙️", title: "系统设置", sub: "站点信息、交易规则、支付接口与安全策略" },
      { to: "/logs", label: "操作日志", icon: "📜", title: "操作日志", sub: "谁在什么时间做了什么，全部留痕" },
      { to: "/syslogs", label: "系统日志", icon: "🖥️", title: "系统日志", sub: "运行情况与错误实时记录，排查问题的第一现场" },
    ],
  },
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);

/** 前台站点地址（服务端注入，回落到 2001） */
const SITE_BASE =
  (typeof window !== "undefined" && window.JKP_RUNTIME?.siteBase) ||
  `http://${window.location.hostname}:2001`;

export function AdminLayout() {
  const { admin, logout } = useAuth();
  const confirm = useConfirm();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  /* 路由变化时收起移动端抽屉 */
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const current =
    ALL_ITEMS.find((item) =>
      item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
    ) ?? ALL_ITEMS[0]!;

  async function handleLogout() {
    const ok = await confirm({
      title: "退出登录",
      message: "确定要退出管理后台吗？",
      okText: "退出",
    });
    if (ok) await logout();
  }

  return (
    <>
      <aside className={cx("sidebar", drawerOpen && "is-open")}>
        <Link className="sidebar-brand" to="/">
          <span className="logo-mark">简</span>
          <span>简卡铺</span>
          <span className="env">管理后台</span>
        </Link>

        <nav className="sidebar-nav">
          {NAV.map((group) => (
            <div key={group.group}>
              <div className="nav-group-title">{group.group}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cx("nav-item", isActive && "is-active")}
                >
                  <span className="ico">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <a href={SITE_BASE} target="_blank" rel="noopener">
            🌐 查看前台站点
          </a>
          <button type="button" onClick={() => setPasswordOpen(true)} style={{ textAlign: "left" }}>
            🔑 修改登录密码
          </button>
          <button type="button" onClick={handleLogout} style={{ textAlign: "left" }}>
            🚪 退出登录
          </button>
        </div>
      </aside>

      {drawerOpen && <div className="sidebar-backdrop is-open" onClick={() => setDrawerOpen(false)} />}

      <div className="admin-main">
        <header className="topbar">
          <button
            className="sidebar-toggle"
            aria-label="展开菜单"
            onClick={() => setDrawerOpen((v) => !v)}
          >
            ☰
          </button>

          <div>
            <div className="topbar-title">{current?.title ?? "管理后台"}</div>
            {current?.sub && <div className="topbar-sub">{current.sub}</div>}
          </div>

          <div className="topbar-actions">
            <AlertsBell />
            <a className="btn btn-soft btn-sm" href={SITE_BASE} target="_blank" rel="noopener">
              查看前台
            </a>
            <button
              className="admin-user"
              type="button"
              title="点击修改登录密码"
              onClick={() => setPasswordOpen(true)}
            >
              <span className="admin-avatar">{(admin?.nickname ?? "管").slice(0, 1)}</span>
              <span className="meta">
                <span className="name">{admin?.nickname ?? "管理员"}</span>
                {admin?.role && <span className="role"> · {admin.role}</span>}
              </span>
            </button>
          </div>
        </header>

        <main className="admin-content">
          <Outlet />
        </main>
      </div>

      {passwordOpen && <ChangePasswordModal onClose={() => setPasswordOpen(false)} />}
    </>
  );
}

export default AdminLayout;
