/**
 * 简卡铺 · 支付编排
 * ---------------------------------------------------------------------------
 * 三个渠道：
 *   wechat  微信支付 Native 扫码（APIv3）
 *   alipay  支付宝当面付（alipay.trade.precreate）
 *   test    本地测试支付，不联外网，点一下就成功
 *
 * 设计上把「渠道能力」和「订单状态」分开：
 * 本模块只负责跟网关打交道，订单怎么流转仍然由 order 服务说了算。
 */
import * as alipay from "../lib/alipay.js";
import * as wechatpay from "../lib/wechatpay.js";
import { logger } from "../lib/logger.js";
import config from "../config.js";
import * as settingsService from "./settings.js";

/** 渠道定义：code 存库，label 给前台显示 */
export const CHANNELS = {
  wechat: { code: "wechat", label: "微信支付", icon: "wx" },
  alipay: { code: "alipay", label: "支付宝", icon: "ali" },
};

export const CHANNEL_CODES = Object.keys(CHANNELS);

export const isValidChannel = (code) => CHANNEL_CODES.includes(code);

export const labelOf = (code) => CHANNELS[code]?.label ?? code;

/**
 * 把历史数据里的中文标签映射回渠道码。
 * 老订单存的 pay_method 是「微信支付」「支付宝」这类中文，迁移时要用。
 * 历史「测试支付」订单不再有对应渠道，回落为空串（不当作合法渠道）。
 */
export function channelFromLabel(label) {
  const text = String(label ?? "").trim();
  if (text === "微信支付") return "wechat";
  if (text === "支付宝") return "alipay";
  return CHANNEL_CODES.includes(text) ? text : "";
}

/* ------------------------------------------------------------ 通知地址 */

function notifyUrlFor(channel) {
  const base = config.servers.site.baseUrl.replace(/\/$/, "");
  return `${base}/api/public/pay/notify/${channel}`;
}

/* ------------------------------------------------------------ 下单 */

/**
 * 为订单创建支付，返回二维码内容
 *
 * @param {object} order 订单行（含 order_no / amount / product_name / expires_at）
 * @param {string} channel wechat | alipay | test
 * @returns {Promise<{channel: string, label: string, qrCode: string, mode: string}>}
 */
export async function createPayment(order, channel) {
  if (!isValidChannel(channel)) {
    throw new Error(`不支持的支付渠道：${channel}`);
  }

  const available = settingsService.availableChannels();
  if (!available[channel]) {
    const missing = settingsService.channelMissingKeys(channel);
    throw new Error(
      missing.length > 0
        ? `${labelOf(channel)}尚未配置完整，缺少：${missing.join("、")}`
        : `${labelOf(channel)}未启用`
    );
  }

  const subject = `${order.product_name}${order.spec ? ` ${order.spec}` : ""} × ${order.qty}`;

  /* 二维码有效期与本地关单时间保持一致，
     否则用户在本地订单关闭后仍能付款，变成「收了钱没有订单」。 */
  const minutes = Math.max(1, settingsService.getNumber("payment.qrExpireMinutes", 15));

  if (channel === "wechat") {
    const codeUrl = await wechatNative(order, subject, minutes);
    return { channel, label: labelOf(channel), qrCode: codeUrl, mode: "qrcode" };
  }

  const qrCode = await alipayPrecreate(order, subject, minutes);
  return { channel, label: labelOf(channel), qrCode, mode: "qrcode" };
}

/** 把订单到期时间转成 RFC3339（微信要的格式），本地时区带偏移 */
function rfc3339(localTime) {
  const text = String(localTime ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!match) return "";

  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const p = (n) => String(n).padStart(2, "0");

  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

async function wechatNative(order, subject, minutes) {
  const apiV3Key = settingsService.getRaw("payment.wxApiV3Key", "").trim();
  if (apiV3Key.length !== 32) {
    throw new Error(`微信支付 APIv3 密钥必须是 32 位，当前 ${apiV3Key.length} 位`);
  }

  const { codeUrl } = await wechatpay.nativeOrder({
    appId: settingsService.getRaw("payment.wxAppId", "").trim(),
    mchId: settingsService.getRaw("payment.wxMchId", "").trim(),
    serialNo: settingsService.getRaw("payment.wxSerialNo", "").trim(),
    privateKey: settingsService.getRaw("payment.wxPrivateKey", ""),
    outTradeNo: order.order_no,
    totalAmount: Number(order.amount),
    description: subject,
    notifyUrl: notifyUrlFor("wechat"),
    timeExpire: rfc3339(order.expires_at),
  });

  return codeUrl;
}

async function alipayPrecreate(order, subject, minutes) {
  const { qrCode } = await alipay.precreate({
    appId: settingsService.getRaw("payment.aliAppId", "").trim(),
    privateKey: settingsService.getRaw("payment.aliPrivateKey", ""),
    gateway: settingsService.getRaw("payment.aliGateway", "").trim() || undefined,
    outTradeNo: order.order_no,
    totalAmount: Number(order.amount),
    subject,
    notifyUrl: notifyUrlFor("alipay"),
    timeoutExpress: `${minutes}m`,
  });

  return qrCode;
}

/* ------------------------------------------------------------ 主动查单 */

/**
 * 查单节流：同一订单最多每 5 秒查一次。
 * 前台每 3 秒轮询一次，不节流的话等于拿网关当压力测试机。
 */
const lastQueryAt = new Map();
const QUERY_INTERVAL_MS = 5000;

export function shouldQuery(order) {
  const key = order.order_no;
  const now = Date.now();
  if (now - (lastQueryAt.get(key) ?? 0) < QUERY_INTERVAL_MS) return false;

  lastQueryAt.set(key, now);

  /* 顺手清理，避免这个 Map 随订单数无限增长 */
  if (lastQueryAt.size > 500) {
    for (const [k, t] of lastQueryAt) {
      if (now - t > 10 * 60 * 1000) lastQueryAt.delete(k);
    }
  }
  return true;
}

/**
 * 主动向网关查单。
 *
 * 本地开发时网关无法回调到 localhost，所以前台轮询订单状态时用它兜底 ——
 * 用户明明付了钱，页面却一直显示未支付，体验很差。
 *
 * @returns {Promise<{paid: boolean, closed: boolean, paidAmount: number, detail: string}>}
 */
export async function queryPayment(order) {
  const channel = order.pay_channel || channelFromLabel(order.pay_method);
  const miss = { paid: false, closed: false, paidAmount: 0, detail: "" };

  if (!settingsService.availableChannels()[channel]) {
    return { ...miss, detail: "渠道未启用或未配置" };
  }

  try {
    if (channel === "wechat") {
      const result = await wechatpay.queryOrder({
        mchId: settingsService.getRaw("payment.wxMchId", "").trim(),
        serialNo: settingsService.getRaw("payment.wxSerialNo", "").trim(),
        privateKey: settingsService.getRaw("payment.wxPrivateKey", ""),
        outTradeNo: order.order_no,
      });
      return { ...result, paidAmount: result.paidAmount, detail: result.tradeState };
    }

    const result = await alipay.queryOrder({
      appId: settingsService.getRaw("payment.aliAppId", "").trim(),
      privateKey: settingsService.getRaw("payment.aliPrivateKey", ""),
      gateway: settingsService.getRaw("payment.aliGateway", "").trim() || undefined,
      outTradeNo: order.order_no,
    });
    return { ...result, paidAmount: result.paidAmount, detail: result.tradeStatus };
  } catch (err) {
    /* 查单失败不能影响页面：可能只是网络抖动，下一轮再试 */
    logger.info(`主动查单失败（${order.order_no}）：${err.message}`);
    return { ...miss, detail: err.message };
  }
}

/* ------------------------------------------------------------ 回调 */

/**
 * 解析微信回调
 * @param {object} body 回调 JSON
 * @returns {{outTradeNo: string, paid: boolean, amount: number, transactionId: string}}
 */
export function parseWechatNotify(body) {
  const apiV3Key = settingsService.getRaw("payment.wxApiV3Key", "").trim();
  const data = wechatpay.decryptResource(body.resource, apiV3Key);

  return {
    outTradeNo: String(data.out_trade_no ?? ""),
    paid: data.trade_state === "SUCCESS",
    /* 微信金额单位是分，转回元 */
    amount: Math.round(Number(data.amount?.payer_total ?? data.amount?.total ?? 0)) / 100,
    transactionId: String(data.transaction_id ?? ""),
    tradeState: String(data.trade_state ?? ""),
  };
}

/**
 * 解析支付宝回调
 * @param {Record<string,string>} params 表单原始参数
 * @returns {{outTradeNo: string, paid: boolean, amount: number, transactionId: string}}
 */
export function parseAlipayNotify(params) {
  const publicKey = settingsService.getRaw("payment.aliPublicKey", "").trim();
  const verified = alipay.verifyNotify(params, publicKey);

  return {
    verified,
    outTradeNo: String(params.out_trade_no ?? ""),
    paid: params.trade_status === "TRADE_SUCCESS" || params.trade_status === "TRADE_FINISHED",
    amount: Number(params.total_amount ?? 0),
    transactionId: String(params.trade_no ?? ""),
    tradeState: String(params.trade_status ?? ""),
  };
}

/** 校验金额是否与订单一致（防止「付 1 分钱买 100 块」） */
export function amountMatches(orderAmount, paidAmount) {
  return Math.abs(Number(orderAmount) - Number(paidAmount)) < 0.01;
}

export default {
  CHANNELS,
  CHANNEL_CODES,
  isValidChannel,
  labelOf,
  channelFromLabel,
  createPayment,
  queryPayment,
  parseWechatNotify,
  parseAlipayNotify,
  amountMatches,
};
