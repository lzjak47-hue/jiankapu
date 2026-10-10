/**
 * 简卡铺 · 日志输出
 * ---------------------------------------------------------------------------
 * 带时间戳与控制台颜色，避免额外依赖。
 */
const LEVEL_COLOR = {
  info: "\u001b[36m",   // 青
  warn: "\u001b[33m",   // 黄
  error: "\u001b[31m",  // 红
  debug: "\u001b[90m",  // 灰
};
const RESET = "\u001b[0m";

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function emit(level, args) {
  const color = LEVEL_COLOR[level] || "";
  const tag = `[${stamp()}] ${level.toUpperCase().padEnd(5)}`;
  // eslint-disable-next-line no-console
  console.log(`${color}${tag}${RESET}`, ...args);
}

export const logger = {
  info: (...args) => emit("info", args),
  warn: (...args) => emit("warn", args),
  error: (...args) => {
    // 错误对象单独打印堆栈，便于定位
    const flat = args.map((a) => (a instanceof Error ? a.stack || a.message : a));
    emit("error", flat);
  },
  debug: (...args) => {
    if (process.env.DEBUG) emit("debug", args);
  },
};

export default logger;
