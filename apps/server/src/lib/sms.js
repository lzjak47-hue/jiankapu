/**
 * 简卡铺 · 短信网关适配
 * ---------------------------------------------------------------------------
 * 国内短信服务商的 HTTP 接口形态各异，但绝大多数都是
 * 「请求一个地址，带上账号、手机号、内容」这一种模式。
 *
 * 所以这里不硬编码任何厂商，而是让管理员在后台填一个**参数模板**：
 *
 *   {"account":"your-account","password":"{key}","mobile":"{phone}","content":"{content}"}
 *
 * 三个占位符会被替换成真实值：
 *   {phone}   收信手机号
 *   {content} 短信正文
 *   {key}     后台配置的接口密钥
 *
 * 这样互亿无线、短信宝、云片这类「账号+密码+手机号+内容」的网关都能直接用，
 * 需要签名的厂商则可以通过在模板里预置签名参数来适配。
 */
import { logger } from "./logger.js";

const DEFAULT_TIMEOUT = 10000;

/** 把模板里的占位符替换掉 */
function renderValue(template, vars) {
  return String(template).replace(/\{(phone|content|key)\}/g, (_, name) => vars[name] ?? "");
}

/**
 * 解析参数模板。允许非 JSON 的宽松写法（键=值，&分隔），
 * 因为管理员从服务商文档复制过来时常常不是标准 JSON。
 */
function parseTemplate(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("未配置短信参数模板");

  if (text.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`短信参数模板不是合法 JSON：${err.message}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("短信参数模板必须是一个 JSON 对象");
    }
    return parsed;
  }

  /* 宽松格式：account=xxx&mobile={phone}&content={content} */
  const out = {};
  for (const pair of text.split("&")) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  if (Object.keys(out).length === 0) throw new Error("短信参数模板无法解析");
  return out;
}

/**
 * 发送短信
 *
 * @param {object} opts
 * @param {string} opts.url 网关地址
 * @param {"GET"|"POST"} [opts.method]
 * @param {"form"|"json"} [opts.bodyType] POST 时的编码方式
 * @param {string} opts.paramsTemplate 参数模板
 * @param {string} [opts.key] 接口密钥
 * @param {string} opts.phone 手机号
 * @param {string} opts.content 短信内容
 * @param {string} [opts.successText] 响应体需包含这段文字才算成功；留空只看状态码
 * @returns {Promise<{accepted: boolean, response: string}>}
 */
export async function sendSms({
  url,
  method = "POST",
  bodyType = "form",
  paramsTemplate,
  key = "",
  phone,
  content,
  successText = "",
}) {
  if (!url) throw new Error("未配置短信网关地址");
  if (!phone) throw new Error("手机号为空");

  const vars = { phone, content, key };
  const params = {};
  for (const [name, value] of Object.entries(parseTemplate(paramsTemplate))) {
    params[name] = renderValue(value, vars);
  }

  const verb = String(method).toUpperCase() === "GET" ? "GET" : "POST";
  let target = url;
  const init = {
    method: verb,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  };

  if (verb === "GET") {
    const qs = new URLSearchParams(params).toString();
    target = url + (url.includes("?") ? "&" : "?") + qs;
  } else if (String(bodyType) === "json") {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(params);
  } else {
    init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
    init.body = new URLSearchParams(params).toString();
  }

  const res = await fetch(target, init);
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`短信网关返回 HTTP ${res.status}：${body.slice(0, 200)}`);
  }
  if (successText && !body.includes(successText)) {
    throw new Error(`短信网关返回内容不符合预期：${body.slice(0, 200)}`);
  }

  logger.info(`短信已提交网关：${phone} → ${body.slice(0, 80)}`);
  return { accepted: true, response: body };
}

export default { sendSms };
