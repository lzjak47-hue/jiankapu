/**
 * 简卡铺 · 共享 UI 组件
 * ---------------------------------------------------------------------------
 * 只放前台后台都要用的通用件；各自专属的组件放在 site/components 与 admin/components。
 */
import { useEffect } from "react";
import type { ReactNode } from "react";
import { cx } from "./format";
import { cycleSort, sortDirOf } from "./sort";

/* ================================================================ 弹窗 */

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 最大宽度，默认 460 */
  width?: number;
  /** 是否显示右上角关闭按钮 */
  closable?: boolean;
}

export function Modal({ title, onClose, children, footer, width = 460, closable = true }: ModalProps) {
  /* Esc 关闭 + 锁滚动 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("is-locked");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("is-locked");
    };
  }, [onClose]);

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          {closable && (
            <button className="modal-close" onClick={onClose} aria-label="关闭">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ================================================================ 分页 */

interface PaginationProps {
  page: number;
  perPage: number;
  total: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, perPage, total, onChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (total === 0) return null;

  const from = Math.max(1, Math.min(page - 2, pages - 4));
  const to = Math.min(pages, from + 4);
  const numbers: number[] = [];
  for (let i = Math.max(1, from); i <= to; i += 1) numbers.push(i);

  return (
    <div className="pagination">
      <span className="info">
        共 {total} 条 · 第 {page}/{pages} 页
      </span>
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>
        上一页
      </button>
      {numbers.map((n) => (
        <button key={n} className={n === page ? "is-active" : undefined} onClick={() => onChange(n)}>
          {n}
        </button>
      ))}
      <button disabled={page >= pages} onClick={() => onChange(page + 1)}>
        下一页
      </button>
    </div>
  );
}

/* ================================================================ 开关 */

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}

export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <span
      className={cx("switch", checked && "is-on")}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    />
  );
}

/* ================================================================ 状态 */

export function StatusTag({ text, tone }: { text: string; tone?: string }) {
  return <span className={cx("status", tone ?? "off")}>{text}</span>;
}

/* ============================================================ 空 / 骨架 */

export function Empty({ icon = "📭", text, hint }: { icon?: string; text: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="ico">{icon}</div>
      <p>{text}</p>
      {hint && <p className="small dim mt-8">{hint}</p>}
    </div>
  );
}

export function Skeleton({ height = 120 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} />;
}

export function TableSkeleton({ cols, height = 180 }: { cols: number; height?: number }) {
  return (
    <tr>
      <td colSpan={cols}>
        <Skeleton height={height} />
      </td>
    </tr>
  );
}

export function TableEmpty({ cols, icon = "🔍", text }: { cols: number; icon?: string; text: string }) {
  return (
    <tr>
      <td colSpan={cols}>
        <Empty icon={icon} text={text} />
      </td>
    </tr>
  );
}

/* ============================================================ 卡密列表 */

interface SecretListProps {
  secrets: string[];
  onCopy: (text: string) => void;
  /** 复制按钮文案 */
  copyLabel?: string;
}

export function SecretList({ secrets, onCopy, copyLabel = "复制" }: SecretListProps) {
  if (secrets.length === 0) {
    return <Empty icon="📭" text="暂无卡密" />;
  }
  return (
    <div className="secret-list">
      {secrets.map((secret, i) => (
        <div className="secret-item" key={`${secret}-${i}`}>
          <span className="idx">{i + 1}</span>
          <code>{secret}</code>
          <button className="btn btn-soft btn-sm" onClick={() => onCopy(secret)}>
            {copyLabel}
          </button>
        </div>
      ))}
    </div>
  );
}

/* ============================================================ 统计卡片 */

export interface StatCardItem {
  label: string;
  value: string | number;
  unit?: string;
  icon?: string;
  delta?: string;
  up?: boolean;
  /** 是否把 value 当金额展示（仅用于样式差异） */
  money?: boolean;
}

export function StatCards({ items, withDelta = false }: { items: StatCardItem[]; withDelta?: boolean }) {
  return (
    <div className="stat-grid">
      {items.map((item, i) => (
        <div className={cx("stat-card", `c${(i % 4) + 1}`)} key={item.label}>
          <div className="top">
            <span className="label">{item.label}</span>
            {item.icon && <span className="ico">{item.icon}</span>}
          </div>
          <div className="value">
            {item.value}
            {item.unit && <span className="unit">{item.unit}</span>}
          </div>
          {withDelta && item.delta !== undefined && (
            <div className={cx("delta", item.up ? "up" : "down")}>
              {item.up ? "▲" : "▼"} {item.delta}
              <span className="vs">对比昨日</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ============================================================ 区块标题 */

export function BlockHead({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="block-head">
      <div>
        <h3>{title}</h3>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right && <div className="right">{right}</div>}
    </div>
  );
}

/* ============================================================ 排序选择 */

export interface SortOption {
  value: string;
  label: string;
}

/**
 * 列表排序下拉。
 *
 * value 直接对应后端的白名单键，后端未命中时会安静回落到默认排序，
 * 所以就算这里传了旧值也不会把列表打挂。
 */
export function SortSelect({
  value,
  options,
  onChange,
  label = "排序方式",
}: {
  value: string;
  options: SortOption[];
  onChange: (next: string) => void;
  label?: string;
}) {
  return (
    <select
      className="select select-sm"
      style={{ minWidth: 132 }}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* ======================================================== 可排序表头 */

/**
 * 可点击排序的表头单元格。
 *
 * 点击循环：升序 → 降序 → 取消（回到默认排序）。
 * aria-sort 让屏幕阅读器也能知道当前排的是哪一列。
 */
export function SortableTh({
  label,
  field,
  sort,
  fallback = "default",
  onSort,
  align,
}: {
  label: string;
  /** 后端排序键的字段部分，例如 price / stock / created */
  field: string;
  sort: string;
  /** 取消排序时回落到什么 */
  fallback?: string;
  onSort: (next: string) => void;
  align?: "left" | "right";
}) {
  const dir = sortDirOf(sort, field);

  return (
    <th
      className={cx("th-sort", dir && "is-sorted")}
      style={align === "right" ? { textAlign: "right" } : undefined}
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
      onClick={() => onSort(cycleSort(sort, field, fallback))}
      title={dir === "asc" ? "点击切换为降序" : dir === "desc" ? "点击取消排序" : "点击按此列升序排序"}
    >
      <span className="th-inner">
        {label}
        {/* 箭头纯装饰，加 aria-hidden 免得被算进列名的可访问名称 */}
        <span className="th-arrow" aria-hidden="true">
          {dir === "asc" ? "▲" : dir === "desc" ? "▼" : "⇅"}
        </span>
      </span>
    </th>
  );
}
