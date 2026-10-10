/**
 * 简卡铺 · 发货通知
 * ---------------------------------------------------------------------------
 * 买家下单时可以填**任意内容**作为联系方式，这里只做一件事：
 * 判断它看起来像手机号还是邮箱，然后选对应的渠道把卡密发过去。
 *
 * 关键约定：
 *   · 识别不出来（填的是 QQ 号、微信号、随便一句话）→ 不发通知，但**绝不影响下单**
 *   · 发送失败一律吞掉并记日志，不能让已经完成的支付被一个短信网关拖挂
 */
import { sendMail } from "../lib/mailer.js";
import { sendSms } from "../lib/sms.js";
import { logger } from "../lib/logger.js";
import * as settingsService from "./settings.js";

/** 大陆手机号：可带 +86 / 86 前缀，允许空格与短横线 */
const PHONE_RE = /^(?:\+?86)?1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * 判断联系方式该走哪个渠道
 * @returns {"sms" | "email" | null} null 表示识别不出来（正常情况，不算错误）
 */
export function detectChannel(contact) {
  const value = String(contact ?? "").trim();
  if (!value) return null;

  /* 手机号常被写成 138 0000 0000 或 138-0000-0000 */
  const compact = value.replace(/[\s-]/g, "");
  if (PHONE_RE.test(compact)) return "sms";
  if (EMAIL_RE.test(value)) return "email";
  return null;
}

/** 把 {site} {orderNo} 这类占位符替换成真实值 */
function render(template, vars) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  );
}

/** 组装模板变量 */
function buildVars(order, secrets) {
  return {
    site: settingsService.getRaw("site.name", "简卡铺"),
    orderNo: order.order_no ?? order.no ?? "",
    product: order.product_name ?? order.product ?? "",
    spec: order.spec || "无",
    qty: order.qty ?? "",
    amount: Number(order.amount ?? 0).toFixed(2),
    contact: order.contact ?? "",
    secrets: (secrets ?? []).join("\n"),
    /* 短信里换行会被运营商吃掉，单独给一个用「、」分隔的版本 */
    secretsInline: (secrets ?? []).join("、"),
  };
}

/* ------------------------------------------------------------ 真实发送 */

/** 发邮件。配置不全时抛出可读的错误。 */
export async function sendMailNow(to, subject, text) {
  const host = settingsService.getRaw("notify.smtpHost", "").trim();
  const from = settingsService.getRaw("notify.smtpFrom", "").trim() ||
    settingsService.getRaw("notify.smtpUser", "").trim();

  return sendMail({
    host,
    port: settingsService.getNumber("notify.smtpPort", 465),
    secure: settingsService.getBool("notify.smtpSecure", true),
    user: settingsService.getRaw("notify.smtpUser", "").trim(),
    pass: settingsService.getRaw("notify.smtpPass", ""),
    from,
    fromName: settingsService.getRaw("notify.smtpFromName", ""),
    to,
    subject,
    text,
  });
}

/** 发短信。配置不全时抛出可读的错误。 */
export async function sendSmsNow(phone, content) {
  return sendSms({
    url: settingsService.getRaw("notify.smsUrl", "").trim(),
    method: settingsService.getRaw("notify.smsMethod", "POST"),
    bodyType: settingsService.getRaw("notify.smsBodyType", "form"),
    paramsTemplate: settingsService.getRaw("notify.smsParams", ""),
    key: settingsService.getRaw("notify.smsKey", ""),
    phone,
    content,
    successText: settingsService.getRaw("notify.smsSuccessText", "").trim(),
  });
}

/* ------------------------------------------------------------ 下单通知 */

/**
 * 支付成功后按联系方式发送卡密。
 *
 * **不会抛错**：通知只是锦上添花，支付与发卡才是主流程。
 *
 * @param {object} order 订单行（数据库原始字段）
 * @param {string[]} secrets 发出的卡密
 * @returns {Promise<{channel: string|null, sent: boolean, reason?: string}>}
 */
export async function notifyOrderPaid(order, secrets) {
  const contact = String(order?.contact ?? "").trim();
  const channel = detectChannel(contact);

  if (!channel) {
    return {
      channel: null,
      sent: false,
      reason: contact ? "联系方式识别不出手机号或邮箱，已跳过通知" : "买家没有留联系方式",
    };
  }

  if (!settingsService.getBool("notify.enable", false)) {
    return { channel, sent: false, reason: "发货通知总开关未开启" };
  }

  const vars = buildVars(order, secrets);

  try {
    if (channel === "sms") {
      if (!settingsService.getBool("notify.smsEnable", false)) {
        return { channel, sent: false, reason: "短信通知未开启" };
      }
      const content = render(settingsService.getRaw("notify.smsBody", ""), vars);
      await sendSmsNow(contact.replace(/[\s-]/g, ""), content);
      logger.info(`发货短信已发送：${order.order_no} → ${contact}`);
      return { channel, sent: true };
    }

    if (!settingsService.getBool("notify.mailEnable", false)) {
      return { channel, sent: false, reason: "邮件通知未开启" };
    }
    const subject = render(settingsService.getRaw("notify.mailSubject", ""), vars);
    const text = render(settingsService.getRaw("notify.mailBody", ""), vars);
    await sendMailNow(contact, subject, text);
    logger.info(`发货邮件已发送：${order.order_no} → ${contact}`);
    return { channel, sent: true };
  } catch (err) {
    /* 发送失败不能让支付流程失败，记日志即可 */
    logger.error(`发货通知发送失败（${channel} → ${contact}）：${err.message}`);
    return { channel, sent: false, reason: err.message };
  }
}

/**
 * 后台「发送测试」用：会真实抛错，方便管理员看到失败原因。
 * @param {"email" | "sms"} channel
 * @param {string} target 邮箱或手机号
 */
export async function sendTest(channel, target) {
  const vars = {
    site: settingsService.getRaw("site.name", "简卡铺"),
    orderNo: "JKP-TEST-0001",
    product: "测试商品（仅用于验证通知配置）",
    spec: "月卡",
    qty: 1,
    amount: "0.01",
    contact: target,
    secrets: "TEST-KEY-0001",
    secretsInline: "TEST-KEY-0001",
  };

  if (channel === "email") {
    const subject = render(settingsService.getRaw("notify.mailSubject", ""), vars);
    const text = render(settingsService.getRaw("notify.mailBody", ""), vars);
    return sendMailNow(target, subject, text);
  }

  const content = render(settingsService.getRaw("notify.smsBody", ""), vars);
  return sendSmsNow(target, content);
}

export default { detectChannel, notifyOrderPaid, sendTest, sendMailNow, sendSmsNow };
