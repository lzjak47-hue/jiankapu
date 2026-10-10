/**
 * 简卡铺 · 商品详情页
 */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { cx, money } from "../../shared/format";
import { Empty } from "../../shared/components";
import { BuyModal } from "../components/BuyModal";
import { useSite } from "../SiteContext";

type TabKey = "detail" | "notice" | "tutorial";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "detail", label: "商品详情" },
  { key: "notice", label: "购买须知" },
  { key: "tutorial", label: "使用教程" },
];

export function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { findProduct, categoryName } = useSite();

  const product = id ? findProduct(id) : undefined;

  const [tab, setTab] = useState<TabKey>("detail");
  const [pickedSpec, setPickedSpec] = useState("");
  const [qty, setQty] = useState(1);
  const [buying, setBuying] = useState(false);

  if (!product) {
    return (
      <div className="container page" style={{ padding: "80px 20px" }}>
        <Empty
          icon="📦"
          text="商品不存在或已下架"
          hint="可以回到首页看看其它商品"
        />
        <div style={{ textAlign: "center" }}>
          <Link className="btn btn-primary" to="/">
            回到首页
          </Link>
        </div>
      </div>
    );
  }

  /* 用户还没选规格时，优先落到第一个「有货」的规格，而不是第一个规格 */
  const activeSpec =
    pickedSpec ||
    (product.specs.length > 0
      ? (product.specs.find((s) => (product.specStock[s] ?? 0) > 0) ?? product.specs[0] ?? "")
      : "");

  /* 库存按规格算：月卡的库存和年卡的库存是两回事 */
  const hasSpecs = product.specs.length > 0;
  const specAvailable = hasSpecs ? (product.specStock[activeSpec] ?? 0) : product.stock;
  const soldOut = specAvailable <= 0;
  const maxQty = Math.max(1, Math.min(50, specAvailable));

  const stockLine = soldOut ? (
    <span className="dim">已售罄</span>
  ) : specAvailable < 20 ? (
    <span style={{ color: "var(--warning)" }}>仅剩 {specAvailable} 件</span>
  ) : (
    <span style={{ color: "var(--success)" }}>库存充足</span>
  );

  return (
    <div className="container page">
      <div className="breadcrumb">
        <Link to="/">首页</Link>
        <span className="sep">/</span>
        <span>{categoryName(product.category)}</span>
        <span className="sep">/</span>
        <span>{product.name}</span>
      </div>

      <div className="detail">
        <div className="detail-media">{product.emoji}</div>

        <div>
          <h1 className="detail-title">{product.name}</h1>

          <div className="flex items-center gap-12 mt-12">
            <span className={`tag${product.badgeType ? ` tag-${product.badgeType}` : ""}`}>
              {product.badge || "自动发货"}
            </span>
            <span className="small dim">已售 {product.sold} 件</span>
            <span className="small dim">·</span>
            <span className="small">{stockLine}</span>
          </div>

          <p className="muted mt-16">{product.desc}</p>

          <div className="price-box">
            <div className="price">
              <span className="cur">¥</span>
              <span className="val">{money(product.price)}</span>
              {product.oldPrice > 0 && <span className="old">¥{money(product.oldPrice)}</span>}
            </div>
            {product.oldPrice > 0 && (
              <span className="save">立省 ¥{money(product.oldPrice - product.price)}</span>
            )}
          </div>

          {hasSpecs && (
            <div className="spec-block">
              <div className="label">选择规格</div>
              <div className="spec-list">
                {product.specs.map((s) => {
                  const left = product.specStock[s] ?? 0;
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={left === 0}
                      className={cx(
                        "spec",
                        s === activeSpec && "is-active",
                        left === 0 && "is-empty"
                      )}
                      onClick={() => {
                        setPickedSpec(s);
                        /* 切换规格后数量不能超过新规格的库存 */
                        setQty((q) => Math.min(q, Math.max(1, Math.min(50, left))));
                      }}
                    >
                      {s}
                      <span className="spec-left">{left === 0 ? "售罄" : `剩 ${left}`}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="spec-block">
            <div className="label">购买数量</div>
            <div className="qty">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))}>
                −
              </button>
              <input
                value={qty}
                inputMode="numeric"
                aria-label="购买数量"
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setQty(Number.isNaN(n) ? 1 : Math.min(Math.max(1, n), maxQty));
                }}
              />
              <button type="button" onClick={() => setQty((q) => Math.min(maxQty, q + 1))}>
                ＋
              </button>
            </div>
            {hasSpecs && !soldOut && (
              <div className="desc small dim" style={{ marginTop: 8 }}>
                「{activeSpec}」当前可购 {specAvailable} 件
              </div>
            )}
          </div>

          <div className="buy-row">
            <button
              className="btn btn-primary btn-lg"
              disabled={soldOut}
              onClick={() => setBuying(true)}
            >
              {soldOut ? "已售罄" : "立即购买"}
            </button>
            <button className="btn btn-ghost btn-lg" onClick={() => navigate("/query")}>
              查询订单
            </button>
          </div>

          <div className="notice">
            <span>⚡</span>
            <span>
              <strong>自动发货</strong>：支付成功后系统立即发放卡密，24 小时无人值守，无需等待人工。
            </span>
          </div>
        </div>
      </div>

      <div className="section-sm" style={{ marginTop: 40 }}>
        <div className="tabs-line">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={t.key === tab ? "is-active" : undefined}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="prose">
          {tab === "detail" && (
            <>
              <h4>商品说明</h4>
              <p>{product.detail || product.desc}</p>
            </>
          )}

          {tab === "notice" && (
            <>
              <h4>购买须知</h4>
              <ul>
                {product.notice.map((n) => (
                  <li key={n}>{n}</li>
                ))}
                <li>如遇任何问题，请通过右下角在线客服联系我们。</li>
              </ul>
            </>
          )}

          {tab === "tutorial" && (
            <>
              <h4>使用步骤</h4>
              <ol style={{ listStyle: "none" }}>
                {product.tutorial.map((t, i) => (
                  <li key={t} style={{ paddingLeft: 0 }}>
                    <strong>{i + 1}.</strong> {t}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>

      {buying && (
        <BuyModal
          product={product}
          initialSpec={activeSpec}
          initialQty={qty}
          onClose={() => setBuying(false)}
        />
      )}
    </div>
  );
}

export default ProductPage;
