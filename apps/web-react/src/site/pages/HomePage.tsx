/**
 * 简卡铺 · 首页
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ProductCard } from "../components/ProductCard";
import { BuyModal } from "../components/BuyModal";
import { useSite } from "../SiteContext";
import type { Product } from "../../shared/types";

/** 统一线性图标集（feather 风格，stroke=currentColor） */
const ICON_PATHS = {
  zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  "shield-check": (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </>
  ),
  chat: (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  "badge-check": (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 11 14 15 10" />
    </>
  ),
  coins: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v12M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </>
  ),
  "credit-card": (
    <>
      <rect x="1" y="4" width="22" height="16" rx="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </>
  ),
  refresh: (
    <>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </>
  ),
} as const;

function Icon({ name, size = 18 }: { name: keyof typeof ICON_PATHS; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

const SORTS = [
  { value: "default", label: "默认排序" },
  { value: "sold", label: "按销量" },
  { value: "price-asc", label: "价格从低到高" },
  { value: "price-desc", label: "价格从高到低" },
  { value: "stock", label: "库存优先" },
];

const TRUST = [
  { icon: "zap", strong: "秒发卡密", rest: "· 付款即到账" },
  { icon: "clock", strong: "24 小时", rest: "· 无人值守自动发货" },
  { icon: "shield", strong: "正品保障", rest: "· 官方渠道直充" },
  { icon: "chat", strong: "售后无忧", rest: "· 问题 24h 内处理" },
  { icon: "lock", strong: "安全支付", rest: "· 微信 / 支付宝" },
] as const;

const FEATURES = [
  { icon: "zap", title: "真正的自动发货", desc: "付款成功即刻出卡，7×24 小时不间断，无需等待人工审核。" },
  { icon: "badge-check", title: "卡密全部实测", desc: "上架前逐批验证可用性，不可用的卡密绝不发给用户。" },
  { icon: "coins", title: "价格公开透明", desc: "明码标价，没有隐藏费用，常年比官方渠道更划算。" },
  { icon: "shield-check", title: "售后有保障", desc: "卡密异常可申请补发，客服 24 小时内响应处理。" },
] as const;

const FAQS = [
  { icon: "zap", q: "付款后多久发货？", a: "系统全自动处理，正常 3 秒内出卡密，高峰期也不会超过 1 分钟。若长时间未发货，订单页会显示状态，可直接联系客服。" },
  { icon: "file", q: "卡密弄丢了怎么办？", a: "不用怕。凭订单号随时可在「查询订单」页重新查看卡密内容，建议下单后顺手保存订单号。" },
  { icon: "credit-card", q: "支持哪些支付方式？", a: "目前支持微信支付与支付宝，扫码即可完成付款，全程加密，不保存你的支付信息。" },
  { icon: "refresh", q: "可以退款吗？", a: "虚拟商品一经发货无法撤回，原则上不支持退款。但若卡密本身存在问题，我们承诺免费补发或全额退款。" },
] as const;

const STEPS = [
  { no: 1, title: "挑选商品", desc: "按分类找到需要的卡密" },
  { no: 2, title: "扫码付款", desc: "支持微信 / 支付宝" },
  { no: 3, title: "自动发货", desc: "系统 3 秒内发放卡密" },
  { no: 4, title: "复制使用", desc: "一键复制，随时可查单" },
];

export function HomePage() {
  const { products, categories } = useSite();
  const [searchParams] = useSearchParams();

  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("default");
  const [keyword, setKeyword] = useState(searchParams.get("q") ?? "");
  const [buying, setBuying] = useState<Product | null>(null);
  /** 当前展开的常见问题；null 表示全部收起 */
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  /* 顶栏搜索会改 URL，这里同步回输入框 */
  useEffect(() => {
    setKeyword(searchParams.get("q") ?? "");
  }, [searchParams]);

  /* 支持从页脚用 /?category=video#catalog 直接定位到某个分类 */
  useEffect(() => {
    const fromUrl = searchParams.get("category");
    if (fromUrl) setCategory(fromUrl);
  }, [searchParams]);

  const list = useMemo(() => {
    let out = products.slice();
    if (category !== "all") out = out.filter((p) => p.category === category);
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      out = out.filter((p) => `${p.name}${p.desc}`.toLowerCase().includes(kw));
    }
    switch (sort) {
      case "price-asc":
        out.sort((a, b) => a.price - b.price);
        break;
      case "price-desc":
        out.sort((a, b) => b.price - a.price);
        break;
      case "sold":
        out.sort((a, b) => b.sold - a.sold);
        break;
      case "stock":
        out.sort((a, b) => b.stock - a.stock);
        break;
      default:
        break;
    }
    return out;
  }, [products, category, sort, keyword]);

  /**
   * 入场动画观察器。
   *
   * 注意 ref 必须挂在**整个页面**的容器上，不能只挂在商品网格上：
   * 「为什么选择简卡铺」「常见问题」这些区块也在用 .reveal，
   * 观察不到它们就会一直停在 opacity:0 —— 页面上看起来就是一片空白。
   */
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;

    const nodes = Array.from(root.querySelectorAll<HTMLElement>(".reveal:not(.is-in)"));
    if (nodes.length === 0) return;

    /* 不支持 IntersectionObserver 时直接显示，不能把内容藏起来 */
    if (!("IntersectionObserver" in window)) {
      nodes.forEach((n) => n.classList.add("is-in"));
      return;
    }

    let fired = false;

    const io = new IntersectionObserver(
      (entries) => {
        fired = true;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -40px 0px", threshold: 0.05 }
    );
    nodes.forEach((n) => io.observe(n));

    /**
     * 兜底：IntersectionObserver 在初始化时一定会为每个被观察元素回调一次
     * （不可见的也会回调，只是 isIntersecting 为 false）。
     * 所以「一次都没回调」说明观察器根本没工作 —— 那就直接全部显示，
     * 绝不能让内容永远停在 opacity:0 变成一片空白。
     */
    const timer = setTimeout(() => {
      if (!fired) nodes.forEach((n) => n.classList.add("is-in"));
    }, 1200);

    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, [list]);

  return (
    <div ref={pageRef}>
      {/* ===== 首屏 ===== */}
      <section className="hero">
        <div className="container hero-inner">
          <div>
            <span className="hero-eyebrow">
              <span className="dot" /> 全站 24 小时无人值守 · 付款后自动发货
            </span>

            <h1 className="hero-title">
              买卡密，<span className="grad">就是这么简单</span>
            </h1>

            <p className="hero-desc">
              视频会员、游戏点卡、软件授权、话费充值 —— 全场官方渠道直充，下单后系统秒发卡密，
              不用等人工、不用加群、不用催单。
            </p>

            <div className="hero-cta">
              <a className="btn btn-primary btn-lg" href="#catalog">
                立即选购 →
              </a>
              <a className="btn btn-ghost btn-lg" href="#flow">
                看看怎么买
              </a>
            </div>

            <div className="hero-stats">
              <div className="hero-stat">
                <div className="stat-num num">{products.length}</div>
                <div className="stat-label">在售商品</div>
              </div>
              <div className="hero-stat">
                <div className="stat-num num">3<span className="unit">秒</span></div>
                <div className="stat-label">平均发货速度</div>
              </div>
              <div className="hero-stat">
                <div className="stat-num num">
                  {products.reduce((sum, p) => sum + p.sold, 0).toLocaleString("zh-CN")}
                </div>
                <div className="stat-label">累计已售</div>
              </div>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="mock-card c3">
              <div className="mock-thumb" />
              <div className="mock-line w60" />
              <div className="mock-line w40" />
              <div className="mock-foot">
                <span className="mock-price">¥9.9</span>
                <span className="mock-btn" />
              </div>
            </div>
            <div className="mock-card c2">
              <div className="mock-thumb" />
              <div className="mock-line w60" />
              <div className="mock-line w40" />
              <div className="mock-foot">
                <span className="mock-price">¥13.5</span>
                <span className="mock-btn" />
              </div>
            </div>
            <div className="mock-card c1">
              <div className="mock-thumb" />
              <div className="mock-line w60" />
              <div className="mock-line w40" />
              <div className="mock-foot">
                <span className="mock-price">¥12.8</span>
                <span className="mock-btn" />
              </div>
            </div>
            <div className="hero-float f1">
              <span className="ico"><Icon name="zap" size={15} /></span> 下单后 3 秒发货
            </div>
            <div className="hero-float f2">
              <span className="ico"><Icon name="shield" size={15} /></span> 24h 售后保障
            </div>
          </div>
        </div>
      </section>

      {/* ===== 信任徽章 ===== */}
      <section className="section-sm">
        <div className="container">
          <div className="trust-bar">
            {TRUST.map((t) => (
              <span className="pill" key={t.strong}>
                <span className="ico"><Icon name={t.icon} size={15} /></span>
                <strong>{t.strong}</strong> {t.rest}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 商品列表 ===== */}
      <section className="section" id="catalog" style={{ paddingTop: 20 }}>
        <div className="container">
          <div className="section-head">
            <div>
              <h2 className="h2">全部商品</h2>
              <p className="sub">挑好商品 → 付款 → 秒出卡密，全程不超过一分钟</p>
            </div>
            <span className="result-count">{list.length > 0 ? `共 ${list.length} 件商品` : ""}</span>
          </div>

          <div className="toolbar">
            <div className="tabs">
              <button
                className={`tab${category === "all" ? " is-active" : ""}`}
                onClick={() => setCategory("all")}
              >
                全部商品
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  className={`tab${category === c.id ? " is-active" : ""}`}
                  onClick={() => setCategory(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>

            <div className="toolbar-right">
              <input
                className="input"
                style={{ height: 38, width: 170 }}
                placeholder="搜索商品"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                aria-label="筛选商品"
              />
              <select
                className="select"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="排序方式"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid">
            {list.length === 0 ? (
              <div className="empty" style={{ gridColumn: "1/-1" }}>
                <div className="ico">🔍</div>
                <p>没有找到相关商品，换个关键词试试</p>
              </div>
            ) : (
              list.map((p) => <ProductCard key={p.id} product={p} onBuy={setBuying} />)
            )}
          </div>
        </div>
      </section>

      {/* ===== 购买流程 ===== */}
      <section className="section" id="flow">
        <div className="container">
          <div className="section-head">
            <div>
              <h2 className="h2">四步拿到卡密</h2>
              <p className="sub">全流程自动化，没有人工介入，深夜下单也一样秒发</p>
            </div>
          </div>

          <div className="steps">
            {STEPS.map((s) => (
              <div className="step" key={s.no}>
                <div className="step-no">{s.no}</div>
                <h4>{s.title}</h4>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 优势 ===== */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section-head">
            <div>
              <h2 className="h2">为什么选择简卡铺</h2>
              <p className="sub">把「简单」做到极致，让买卡密这件事不再折腾</p>
            </div>
          </div>

          <div className="features">
            {FEATURES.map((f) => (
              <div className="feature reveal" key={f.title}>
                <div className="ico"><Icon name={f.icon} size={21} /></div>
                <h4>{f.title}</h4>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 常见问题 ===== */}
      <section className="section" id="faq" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section-head">
            <div>
              <h2 className="h2">常见问题</h2>
              <p className="sub">下单前先看一眼，能省掉 90% 的疑问</p>
            </div>
          </div>

          <div className="faq-list">
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <div className={`faq-item${open ? " is-open" : ""}`} key={f.q}>
                  <button
                    type="button"
                    className="faq-q"
                    aria-expanded={open}
                    onClick={() => setOpenFaq(open ? null : i)}
                  >
                    <span className="ico"><Icon name={f.icon} size={18} /></span>
                    <span className="text">{f.q}</span>
                    <span className="arrow">▾</span>
                  </button>
                  {/* 用 max-height 过渡做展开动画，收起时高度为 0 */}
                  <div className="faq-a">
                    <p>{f.a}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== 下单弹窗 ===== */}
      {buying && <BuyModal product={buying} onClose={() => setBuying(null)} />}
    </div>
  );
}

export default HomePage;
