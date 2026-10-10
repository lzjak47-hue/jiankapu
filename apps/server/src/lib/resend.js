/**
 * 简卡铺 · Resend HTTP 邮件通道
 * ---------------------------------------------------------------------------
 * 部分云平台（如 Render 免费层）到传统 SMTP 端口的出站连接不稳定或不可达，
 * 而 443 端口的 HTTPS 永远畅通。Resend 免费档每天可发 100 封，注册即用，
 * 无需域名与 SMTP 协议，发件人显示为 `显示名 <onboarding@resend.dev>`。
 *
 * 参考：https://resend.com/docs/api-reference/emails/send-email
 */

/**
 * 通过 Resend HTTP API 发送纯文本邮件
 * @param {object} opts
 * @param {string} opts.apiKey Resend API Key（re_ 开头）
 * @param {string} opts.fromName 发件人显示名
 * @param {string} opts.to 收件邮箱
 * @param {string} opts.subject 主题
 * @param {string} opts.text 纯文本正文
 * @returns {Promise<{accepted: boolean, response: string}>}
 */
export async function sendEmail({ apiKey, fromName = "", to, subject, text }) {
  if (!apiKey) throw new Error("未配置 Resend API Key");

  const name = fromName.trim();
  const from = name ? `${name} <onboarding@resend.dev>` : "onboarding@resend.dev";

  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
  } catch (err) {
    throw new Error(`Resend 请求失败：${err.message}`);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.message || JSON.stringify(body);
    } catch {
      /* 忽略解析失败 */
    }
    throw new Error(`Resend API ${res.status}：${detail || res.statusText}`);
  }

  const data = await res.json().catch(() => ({}));
  return { accepted: true, response: data.id || "queued" };
}

export default { sendEmail };