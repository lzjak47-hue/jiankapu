/**
 * 简卡铺 · 商品卡片
 */
import { Link } from "react-router-dom";
import { money } from "../../shared/format";
import type { Product } from "../../shared/types";

interface ProductCardProps {
  product: Product;
  onBuy: (product: Product) => void;
}

function stockText(product: Product) {
  if (product.stock <= 0) return <span className="dim">已售罄</span>;
  if (product.stock < 20) return <span style={{ color: "var(--warning)" }}>仅剩 {product.stock} 件</span>;
  return <span style={{ color: "var(--success)" }}>库存充足</span>;
}

export function ProductCard({ product, onBuy }: ProductCardProps) {
  const soldOut = product.stock <= 0;
  const href = `/product/${product.id}`;

  return (
    <article className="card reveal">
      <Link className="card-media" to={href}>
        {product.badge && (
          <span className={`tag${product.badgeType ? ` tag-${product.badgeType}` : ""} badge`}>
            {product.badge}
          </span>
        )}
        <span className="thumb-emoji">{product.emoji}</span>
        {soldOut && <span className="sold-out">已 售 罄</span>}
      </Link>

      <div className="card-body">
        <Link className="card-title" to={href}>
          {product.name}
        </Link>
        <div className="card-meta">
          <span>已售 {product.sold}</span>
          <span className="dim">·</span>
          <span>{stockText(product)}</span>
        </div>

        <div className="card-foot">
          <div className="price">
            <span className="cur">¥</span>
            <span className="val">{money(product.price)}</span>
            {product.oldPrice > 0 && <span className="old">¥{money(product.oldPrice)}</span>}
          </div>
          <button
            className="btn btn-primary btn-sm"
            disabled={soldOut}
            onClick={() => onBuy(product)}
          >
            {soldOut ? "已售罄" : "立即购买"}
          </button>
        </div>
      </div>
    </article>
  );
}

export default ProductCard;
