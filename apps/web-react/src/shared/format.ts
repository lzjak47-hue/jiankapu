/**
 * 简卡铺 · 格式化与通用小工具
 */

/** 金额：整数不带小数，否则保留两位 */
export function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

/** 千分位整数 */
export function int(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("zh-CN");
}

/** 倒计时秒数 → mm:ss */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** 截取 "YYYY-MM-DD HH:mm:ss" 的日期部分 */
export function datePart(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

/** 截取到分钟 */
export function minutePart(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 16);
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 */
export function relativeTime(value: string | null | undefined): string {
  if (!value) return "—";
  const target = new Date(value.replace(" ", "T")).getTime();
  if (!Number.isFinite(target)) return value;

  const diff = Date.now() - target;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return datePart(value);
}

/** 秒 → 人类可读的运行时长 */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟`;
  if (s < 86_400) return `${Math.floor(s / 3600)} 小时`;
  return `${Math.floor(s / 86_400)} 天`;
}

/** 字节 → KB / MB */
export function fileSize(kb: number): string {
  const n = Number(kb) || 0;
  if (n < 1024) return `${Math.round(n)} KB`;
  return `${(n / 1024).toFixed(1)} MB`;
}

/** 订单状态 → 样式类名 */
export function orderStatusClass(status: string): string {
  switch (status) {
    case "已发货":
      return "on";
    case "处理中":
      return "info";
    case "待付款":
      return "warn";
    case "失败":
      return "danger";
    default:
      return "off";
  }
}

/** 卡密状态 → 样式类名 */
export function cardStatusClass(status: string): string {
  switch (status) {
    case "已售":
      return "on";
    case "已锁定":
      return "warn";
    default:
      return "off";
  }
}

/** 拼接 className，自动忽略假值 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** 从 URL query 里取参数（不依赖路由库，供简单场景使用） */
export function searchParam(name: string, search: string = window.location.search): string {
  return new URLSearchParams(search).get(name) ?? "";
}

/** 防抖 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait = 240) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** 复制到剪贴板，带降级方案；返回是否成功 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 落到降级方案 */
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * 客服配置可能是完整网址，也可能只是 QQ / 微信号这类账号。
 * 只有前者能安全地当成 href，否则点了会跳到站内 404。
 */
export function isHttpUrl(value: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

/** 粗略判断是不是邮箱（只用于决定是否渲染 mailto 链接） */
export function isEmailLike(value: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

/** 粗略判断是不是手机号（仅用于选择通知渠道，不做格式限制） */
export function looksLikePhone(value: string | null | undefined): boolean {
  return /^1[3-9]\d{9}$/.test(String(value ?? "").replace(/[\s-]/g, ""));
}
