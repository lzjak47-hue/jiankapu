/**
 * 简卡铺 · 微信支付 APIv3（Native 扫码支付）
 * ---------------------------------------------------------------------------
 * 只用 node:crypto 与全局 fetch，不引入 SDK。
 *
 * 请求签名规则：
 *   待签名串 = HTTP方法 + "\n" + URL路径(含查询串) + "\n" + 时间戳 + "\n"
 *              + 随机串 + "\n" + 请求体 + "\n"
 *   用商户私钥做 SHA256withRSA 签名，base64 后放进 Authorization 头。
 *
 * 回调通知里的金额等敏感字段是 AES-256-GCM 加密的，
 * 要用 APIv3 密钥解密后才能读。
 */
import crypto from "node:crypto";

const HOST = "https://api.mch.weixin.qq.com";
const BASE = "/v3/pay/transactions";

function toPem(raw, label) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (text.includes("-----BEGIN")) return text;

  const body = text.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

function privateKeyFrom(raw) {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("未配置微信支付商户私钥（apiclient_key.pem）");

  for (const label of ["PRIVATE KEY", "RSA PRIVATE KEY"]) {
    try {
      return crypto.createPrivateKey(
        text.includes("-----BEGIN") ? text : toPem(text, label)
      );
    } catch {
      /* 换下一个标签再试 */
    }
  }
  throw new Error("微信支付商户私钥格式无法识别，请粘贴 apiclient_key.pem 的完整内容");
}

/** 生成随机串（微信要求不超过 32 位） */
const nonce = () => crypto.randomBytes(16).toString("hex");

/** 构造 Authorization 头 */
function buildAuth({ mchId, serialNo, privateKey, method, urlPath, body }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const random = nonce();

  const message = `${method}\n${urlPath}\n${timestamp}\n${random}\n${body}\n`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(message, "utf8")
    .sign(privateKeyFrom(privateKey), "base64");

  return (
    `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",` +
    `nonce_str="${random}",signature="${signature}",` +
    `timestamp="${timestamp}",serial_no="${serialNo}"`
  );
}

/** 发起一次 APIv3 请求 */
async function request({
  mchId,
  serialNo,
  privateKey,
  method,
  urlPath,
  body = "",
  timeoutMs = 10000,
}) {
  if (!mchId) throw new Error("未配置微信支付商户号");
  if (!serialNo) throw new Error("未配置微信支付证书序列号");

  const auth = buildAuth({ mchId, serialNo, privateKey, method, urlPath, body });

  const res = await fetch(HOST + urlPath, {
    method,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
      /* 微信要求带 User-Agent，缺失会被拒 */
      "User-Agent": "jiankapu/1.0 (node)",
    },
    body: body === "" ? undefined : body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();

  if (!res.ok) {
    /* 失败响应是 {code, message, detail}，把 message 透出来才好排查 */
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      detail = parsed.message || parsed.code || detail;
    } catch {
      /* 保留原始文本 */
    }
    throw new Error(`微信支付接口返回 HTTP ${res.status}：${detail}`);
  }

  return text ? JSON.parse(text) : {};
}

/**
 * Native 下单，返回二维码内容
 * @returns {Promise<{codeUrl: string, raw: object}>}
 */
export async function nativeOrder({
  mchId,
  appId,
  serialNo,
  privateKey,
  outTradeNo,
  totalAmount,
  description,
  notifyUrl,
  /** RFC3339 时间串；不传则用微信默认的 2 小时 */
  timeExpire = "",
}) {
  if (!appId) throw new Error("未配置微信支付 AppID");

  const urlPath = `${BASE}/native`;
  const payload = {
    appid: appId,
    mchid: mchId,
    description: String(description).slice(0, 127),
    out_trade_no: outTradeNo,
    notify_url: notifyUrl,
    amount: {
      /* 微信以「分」为单位，必须整数 */
      total: Math.round(Number(totalAmount) * 100),
      currency: "CNY",
    },
  };

  /* 必须和本地关单时间保持一致：
     否则用户在本地订单关闭后仍能付款，就变成「收了钱没有订单」 */
  if (timeExpire) payload.time_expire = timeExpire;

  const json = JSON.stringify(payload);
  const result = await request({
    mchId, serialNo, privateKey,
    method: "POST",
    urlPath,
    body: json,
  });

  if (!result.code_url) throw new Error("微信支付没有返回 code_url");
  return { codeUrl: result.code_url, raw: result };
}

/**
 * 主动查单（本地开发收不到回调时的兜底）
 * @returns {Promise<{paid: boolean, closed: boolean, tradeState: string}>}
 */
export async function queryOrder({ mchId, serialNo, privateKey, outTradeNo }) {
  const urlPath = `${BASE}/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(mchId)}`;
  const result = await request({ mchId, serialNo, privateKey, method: "GET", urlPath });

  const state = String(result.trade_state || "");
  return {
    paid: state === "SUCCESS",
    closed: state === "CLOSED" || state === "REVOKED" || state === "PAYERROR",
    tradeState: state,
    /* 实付金额：微信单位是分 */
    paidAmount: Math.round(Number(result.amount?.payer_total ?? result.amount?.total ?? 0)) / 100,
  };
}

/**
 * 解密回调通知里的 resource
 *
 * 算法是 AES-256-GCM，密文 base64 解码后**最后 16 字节是认证标签**，
 * 必须单独取出来做校验，否则解密会失败。
 *
 * @param {object} resource 通知里的 resource 节点
 * @param {string} apiV3Key 32 位 APIv3 密钥
 * @returns {object} 解密后的业务数据
 */
export function decryptResource(resource, apiV3Key) {
  const key = String(apiV3Key ?? "");
  if (key.length !== 32) {
    throw new Error(`APIv3 密钥必须是 32 位，当前 ${key.length} 位`);
  }

  const ciphertext = Buffer.from(resource.ciphertext, "base64");
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "utf8"),
    Buffer.from(resource.nonce, "utf8")
  );
  decipher.setAuthTag(authTag);
  if (resource.associated_data) {
    decipher.setAAD(Buffer.from(resource.associated_data, "utf8"));
  }

  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return JSON.parse(plain);
}

/** 回调应答体 */
export const notifyOk = () => JSON.stringify({ code: "SUCCESS", message: "成功" });

export default { nativeOrder, queryOrder, decryptResource, notifyOk };
