/**
 * 简卡铺 · 日志输出
 * ---------------------------------------------------------------------------
 * 带时间戳与控制台颜色，避免额外依赖。
 *
 * 同时维护一个**内存环形缓冲**（最多 500 条），后台「系统日志」页据此展示
 * 运行情况与错误，避免为日志单独建表；进程重启后缓冲清空（部署类平台日志
 * 仍可从容器输出中查）。
 */
const LEVEL_COLOR = {
  info: "\u001b[36m",   // 青
  warn: "\u001b[33m",   // 黄
  error: "\u001b[31m",  // 红
  debug: "\u001b[90m",  // 灰
};
const RESET = "\u001b[0m";

const MAX_BUFFER = 500;

/* 环形缓冲：新的推入尾部，超出上限丢弃最旧的 */
const ring = [];

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 把任意参数压平成可读文本（Error 取堆栈，对象转 JSON） */
function flatten(args) {
  return args.map((a) => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === "string") return a;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  });
}

function emit(level, args) {
  const color = LEVEL_COLOR[level] || "";
  const tag = `[${stamp()}] ${level.toUpperCase().padEnd(5)}`;
  // eslint-disable-next-line no-console
  console.log(`${color}${tag}${RESET}`, ...args);
}

/** 写入内存缓冲（debug 太吵，不记录） */
function record(level, args) {
  if (level === "debug") return;
  ring.push({ time: new Date().toISOString(), level, message: flatten(args).join(" ") });
  if (ring.length > MAX_BUFFER) ring.shift();
}

/**
 * 取缓冲中的日志（新在前）。后台系统日志页调用。
 * @param {number} [limit] 最多返回条数
 */
export function getRuntimeLogs(limit = 200) {
  const n = Math.min(Math.max(Number(limit) || 200, 1), 500);
  return ring.slice(-n).reverse();
}

export const logger = {
  info: (...args) => {
    record("info", args);
    emit("info", args);
  },
  warn: (...args) => {
    record("warn", args);
    emit("warn", args);
  },
  error: (...args) => {
    record("error", args);
    emit("error", flatten(args));
  },
  debug: (...args) => {
    if (process.env.DEBUG) emit("debug", args);
  },
};

export default logger;