/**
 * 简卡铺 · 时间工具
 * ---------------------------------------------------------------------------
 * 统一使用本地时间字符串 "YYYY-MM-DD HH:mm:ss"，与前端展示格式一致，
 * 直接用字符串比较即可判断先后（同格式定长字符串的字典序等于时间序）。
 */

export function nowStr(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}

/** 相对当前时间偏移若干分钟后的时间字符串 */
export function strAfterMinutes(minutes, from = new Date()) {
  return nowStr(new Date(from.getTime() + minutes * 60_000));
}

/** 判断某个时间字符串是否已过期 */
export function isExpired(value, from = new Date()) {
  if (!value) return true;
  return String(value) <= nowStr(from);
}

/** 距离过期还有多少秒（可能为负） */
export function secondsUntil(value, from = new Date()) {
  if (!value) return 0;
  const target = parseStr(value);
  if (!target) return 0;
  return Math.round((target.getTime() - from.getTime()) / 1000);
}

/** 把 "YYYY-MM-DD HH:mm:ss" 解析为 Date（本地时区） */
export function parseStr(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6])
  );
}

/** 今天零点的时间字符串 */
export function todayStartStr(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return nowStr(d);
}

/** 近 n 天的日期标签数组（含今天），升序 */
export function recentDayLabels(days = 7, from = new Date()) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - i);
    out.push({
      date: `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      start: nowStr(d),
      end: nowStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)),
    });
  }
  return out;
}

export default { nowStr, strAfterMinutes, isExpired, secondsUntil, parseStr, todayStartStr, recentDayLabels };
