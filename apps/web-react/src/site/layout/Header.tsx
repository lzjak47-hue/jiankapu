/**
 * 简卡铺 · 前台顶栏
 */
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useSite } from "../SiteContext";

export function Header() {
  const { settings } = useSite();
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const site = settings?.site;

  function submitSearch() {
    const kw = keyword.trim();
    navigate(kw ? `/?q=${encodeURIComponent(kw)}` : "/");
    setMenuOpen(false);
  }

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="header">
      <div className="container header-inner">
        <Link className="logo" to="/" onClick={closeMenu}>
          <span className="logo-mark">{site?.logoMark || "简"}</span>
          <span>{site?.name || "简卡铺"}</span>
          <span className="logo-sub">{site?.subtitle || "自动发货 · 秒发卡密"}</span>
        </Link>

        <nav className={`nav${menuOpen ? " is-open" : ""}`} id="mainNav">
          <NavLink to="/" end onClick={closeMenu}>
            首页
          </NavLink>
          <a href="/#catalog" onClick={closeMenu}>
            全部商品
          </a>
          <a href="/#flow" onClick={closeMenu}>
            购买流程
          </a>
          <NavLink to="/query" onClick={closeMenu}>
            查询订单
          </NavLink>
        </nav>

        <div className="header-actions">
          <div className="header-search">
            <span className="ico">🔍</span>
            <input
              type="search"
              placeholder="搜索商品，如「会员」"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitSearch();
              }}
              aria-label="站内搜索"
            />
          </div>
          <Link className="btn btn-soft" to="/query">
            查订单
          </Link>
          <button
            className="nav-toggle"
            aria-label="展开菜单"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ☰
          </button>
        </div>
      </div>
    </header>
  );
}

export default Header;
