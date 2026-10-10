/**
 * 简卡铺 · 支付宝当面付（alipay.trade.precreate）
 * ---------------------------------------------------------------------------
 * 只用 node:crypto 与全局 fetch，不引入 SDK。
 *
 * 签名规则（RSA2）：
 *   1. 取除 sign 以外的所有请求参数，按 key 升序排列
 *   2. 拼成 `k1=v1&k2=v2`，**用原始值**（不做 URL 编码）
 *   3. 用应用私钥做 SHA256withRSA 签名，结果 base64
 *   4. 作为 sign 参数一起提交
 *
 * 回调验签则反过来：用**支付宝公钥**验证它发来的 sign。
 */
import crypto from "node:crypto";

const GATEWAY = "https://openapi.alipay.com/gateway.do";

/** 把用户粘贴的密钥正文补成标准 PEM */
function toPem(raw, label) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (text.includes("-----BEGIN")) return text;

  const body = text.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

function privateKeyFrom(raw) {
  const pem = toPem(raw, "RSA PRIVATE KEY");
  if (!pem) throw new Error("未配置支付宝应用私钥");
  try {
    return crypto.createPrivateKey(pem);
  } catch {
    /* 新版工具生成的多是 PKCS#8，换个标签再试一次 */
    try {
      return crypto.createPrivateKey(toPem(raw, "PRIVATE KEY"));
    } catch (err) {
      throw new Error(`支付宝应用私钥格式无法识别：${err.message}`);
    }
  }
}

function publicKeyFrom(raw) {
  const pem = toPem(raw, "PUBLIC KEY");
  if (!pem) throw new Error("未配置支付宝公钥");
  try {
    return crypto.createPublicKey(pem);
  } catch (err) {
    throw new Error(`支付宝公钥格式无法识别：${err.message}`);
  }
}

/** 待签名字符串：key 升序拼接原始值 */
function buildSignSource(params) {
  return Object.keys(params)
    .filter((k) => k !== "sign" && params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

function sign(params, privateKeyRaw) {
  return crypto
    .createSign("RSA-SHA256")
    .update(buildSignSource(params), "utf8")
    .sign(privateKeyFrom(privateKeyRaw), "base64");
}

function verify(params, publicKeyRaw) {
  const signature = params.sign;
  if (!signature) return false;
  const rest = { ...params };
  delete rest.sign;
  delete rest.sign_type;

  try {
    return crypto
      .createVerify("RSA-SHA256")
      .update(buildSignSource(rest), "utf8")
      .verify(publicKeyFrom(publicKeyRaw), signature, "base64");
  } catch {
    return false;
  }
}

/** 支付宝要求的时间格式：yyyy-MM-dd HH:mm:ss（东八区） */
function alipayTimestamp(date = new Date()) {
  const beijing = new Date(date.getTime() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${beijing.getUTCFullYear()}-${p(beijing.getUTCMonth() + 1)}-${p(beijing.getUTCDate())} ` +
    `${p(beijing.getUTCHours())}:${p(beijing.getUTCMinutes())}:${p(beijing.getUTCSeconds())}`
  );
}

/** 发起一次网关调用，返回解析后的业务响应节点 */
async function call({
  appId,
  privateKey,
  gateway = GATEWAY,
  method,
  bizContent,
  notifyUrl = "",
  timeoutMs = 10000,
}) {
  if (!appId) throw new Error("未配置支付宝 AppID");

  const params = {
    app_id: appId,
    method,
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: alipayTimestamp(),
    version: "1.0",
    biz_content: JSON.stringify(bizContent),
  };
  if (notifyUrl) params.notify_url = notifyUrl;

  params.sign = sign(params, privateKey);

  const res = await fetch(gateway, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`支付宝返回了非 JSON 内容（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }

  /* 响应节点的键名由方法名转下划线而来，例如 alipay_trade_precreate_response */
  const nodeKey = `${method.replace(/\./g, "_")}_response`;
  const node = payload[nodeKey];
  if (!node) {
    throw new Error(`支付宝响应缺少 ${nodeKey}：${text.slice(0, 200)}`);
  }
  if (node.code !== "10000") {
    throw new Error(`支付宝调用失败（${method}）：${node.sub_msg || node.msg || node.code}`);
  }
  return node;
}

/**
 * 当面付预下单
 * @returns {Promise<{qrCode: string, raw: object}>} qrCode 即二维码内容
 */
export async function precreate({
  appId,
  privateKey,
  gateway,
  outTradeNo,
  totalAmount,
  subject,
  notifyUrl,
  /** 例如 "15m"；与本地关单时间保持一致，避免关单后仍能付款 */
  timeoutExpress = "",
}) {
  const bizContent = {
    out_trade_no: outTradeNo,
    /* 支付宝要求金额是字符串，两位小数 */
    total_amount: Number(totalAmount).toFixed(2),
    subject: String(subject).slice(0, 256),
  };
  if (timeoutExpress) bizContent.timeout_express = timeoutExpress;

  const node = await call({
    appId,
    privateKey,
    gateway,
    method: "alipay.trade.precreate",
    notifyUrl,
    bizContent,
  });

  if (!node.qr_code) throw new Error("支付宝没有返回二维码内容");
  return { qrCode: node.qr_code, raw: node };
}

/**
 * 主动查单。
 *
 * 本地开发时支付宝无法回调到 localhost，所以前台轮询时用它兜底。
 * @returns {Promise<{paid: boolean, closed: boolean, tradeStatus: string}>}
 */
export async function queryOrder({ appId, privateKey, gateway, outTradeNo }) {
  const node = await call({
    appId,
    privateKey,
    gateway,
    method: "alipay.trade.query",
    bizContent: { out_trade_no: outTradeNo },
  });

  const status = String(node.trade_status || "");
  return {
    paid: status === "TRADE_SUCCESS" || status === "TRADE_FINISHED",
    closed: status === "TRADE_CLOSED",
    tradeStatus: status,
    /** 实付金额 */
    paidAmount: Number(node.total_amount ?? 0),
  };
}

/**
 * 校验异步通知
 *
 * 注意必须用**原始请求参数**参与验签，不能先做类型转换或丢弃空值，
 * 否则签名字符串就对不上了。
 *
 * @param {Record<string,string>} params 表单解析出来的原始参数
 * @returns {boolean}
 */
export function verifyNotify(params, alipayPublicKey) {
  return verify(params, alipayPublicKey);
}

export default { precreate, queryOrder, verifyNotify };
