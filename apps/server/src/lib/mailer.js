/**
 * 简卡铺 · 极简 SMTP 客户端
 * ---------------------------------------------------------------------------
 * 只用 node:net / node:tls，不引入任何第三方依赖（与项目「只有一个依赖」的取舍一致）。
 *
 * 支持：
 *   · 465 端口隐式 SSL（secure = true）
 *   · 587 / 25 端口明文 + STARTTLS 升级
 *   · AUTH LOGIN 认证
 *   · 无认证的本地中继（user 为空时跳过 AUTH）
 *
 * 不支持（也用不上）：附件、HTML 多部分、DKIM 签名。
 */
import net from "node:net";
import tls from "node:tls";

const CRLF = "\r\n";
const DEFAULT_TIMEOUT = 15000;

/** 把一行文本按 SMTP 规范做点填充（行首的点要翻倍） */
function dotStuff(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, CRLF)
    .split(CRLF)
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join(CRLF);
}

/**
 * SMTP 会话：负责收发命令与解析响应。
 *
 * 响应可能是多行：
 *   250-第一条
 *   250 最后一条
 * 必须收到「三位数字 + 空格」那一行才算结束。
 */
class Session {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    this.pending = null;
    this.closed = false;

    socket.setTimeout(DEFAULT_TIMEOUT);
    socket.on("data", (chunk) => this.#onData(chunk));
    socket.on("error", (err) => this.#fail(err));
    socket.on("timeout", () => this.#fail(new Error("SMTP 连接超时")));
    socket.on("close", () => this.#fail(new Error("SMTP 连接被对方关闭")));
  }

  #onData(chunk) {
    this.buffer += chunk.toString("utf8");
    if (!this.pending) return;

    /* 逐行找结束行 */
    const lines = this.buffer.split(CRLF);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!/^\d{3} /.test(line)) continue;

      const consumed = lines.slice(0, i + 1).join(CRLF) + CRLF;
      this.buffer = this.buffer.slice(consumed.length);

      const pending = this.pending;
      this.pending = null;
      pending.resolve({ code: Number(line.slice(0, 3)), message: line.slice(4) });
      return;
    }
  }

  #fail(err) {
    this.closed = true;
    const pending = this.pending;
    this.pending = null;
    if (pending) pending.reject(err);
  }

  /** 读一条响应 */
  read() {
    if (this.closed) return Promise.reject(new Error("SMTP 连接已关闭"));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      /* 连接建立前可能已经有数据在缓冲区里 */
      this.#onData("");
    });
  }

  /** 发一条命令并读响应；expect 为期望的状态码，不符则抛错 */
  async command(line, expect = 250) {
    this.socket.write(line + CRLF);
    const res = await this.read();
    if (expect !== null && res.code !== expect) {
      throw new Error(`SMTP 命令失败（期望 ${expect}，实际 ${res.code}）：${line.split(" ")[0]} → ${res.message}`);
    }
    return res;
  }

  /** 升级为 TLS，返回新的 socket */
  async upgrade(host) {
    return new Promise((resolve, reject) => {
      const secureSocket = tls.connect({ socket: this.socket, servername: host }, () => resolve(secureSocket));
      secureSocket.once("error", reject);
    });
  }

  quit() {
    try {
      this.socket.write("QUIT" + CRLF);
      this.socket.end();
    } catch {
      /* 已经断开就算了 */
    }
  }

  destroy() {
    try {
      this.socket.destroy();
    } catch {
      /* 忽略 */
    }
  }
}

/** 建立连接（按需选择隐式 TLS 或明文） */
function connect({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host }, () => resolve(socket))
      : net.connect({ host, port }, () => resolve(socket));
    socket.once("error", reject);
  });
}

/**
 * 发送一封纯文本邮件
 *
 * @param {object} opts
 * @param {string} opts.host SMTP 服务器
 * @param {number} opts.port 端口
 * @param {boolean} opts.secure true = 465 隐式 SSL；false = 明文（会自动尝试 STARTTLS）
 * @param {string} [opts.user] 账号；留空跳过认证
 * @param {string} [opts.pass] 密码 / 授权码
 * @param {string} opts.from 发件地址
 * @param {string} [opts.fromName] 发件人显示名
 * @param {string} opts.to 收件地址
 * @param {string} opts.subject 主题
 * @param {string} opts.text 正文（纯文本）
 * @returns {Promise<{accepted: boolean, response: string}>}
 */
export async function sendMail({
  host,
  port,
  secure = true,
  user = "",
  pass = "",
  from,
  fromName = "",
  to,
  subject,
  text,
}) {
  if (!host) throw new Error("未配置 SMTP 服务器地址");
  if (!from) throw new Error("未配置发件人地址");
  if (!to) throw new Error("收件地址为空");

  let socket;
  let session;

  try {
    socket = await connect({ host, port: Number(port) || 465, secure });
    session = new Session(socket);

    const greeting = await session.read();
    if (greeting.code !== 220) {
      throw new Error(`SMTP 服务未就绪：${greeting.code} ${greeting.message}`);
    }

    /* EHLO 拿到扩展能力；有些服务器只认 HELO，失败时降级 */
    const selfName = "jiankapu.local";
    let ehlo;
    try {
      ehlo = await session.command(`EHLO ${selfName}`, 250);
    } catch {
      ehlo = await session.command(`HELO ${selfName}`, 250);
    }

    /* 明文连接且服务器支持 STARTTLS 时升级，避免账号密码裸奔 */
    if (!secure && /STARTTLS/i.test(ehlo.message)) {
      await session.command("STARTTLS", 220);
      const upgraded = await session.upgrade(host);
      session.destroy?.();
      session = new Session(upgraded);
      await session.command(`EHLO ${selfName}`, 250);
    }

    /* AUTH LOGIN：分两步发 base64 的用户名与密码 */
    if (user) {
      await session.command("AUTH LOGIN", 334);
      await session.command(Buffer.from(user, "utf8").toString("base64"), 334);
      await session.command(Buffer.from(pass, "utf8").toString("base64"), 235);
    }

    await session.command(`MAIL FROM:<${from}>`, 250);
    await session.command(`RCPT TO:<${to}>`, 250);
    await session.command("DATA", 354);

    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
    const displayName = fromName
      ? `=?UTF-8?B?${Buffer.from(fromName, "utf8").toString("base64")}?= <${from}>`
      : `<${from}>`;

    const headers = [
      `From: ${displayName}`,
      `To: <${to}>`,
      `Subject: ${encodedSubject}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    ].join(CRLF);

    /* 正文用 base64，彻底绕开中文与长行的编码问题 */
    const body = Buffer.from(text, "utf8").toString("base64").replace(/(.{76})/g, `$1${CRLF}`);

    session.socket.write(`${headers}${CRLF}${CRLF}${dotStuff(body)}${CRLF}.${CRLF}`);
    const accepted = await session.read();
    if (accepted.code !== 250) {
      throw new Error(`邮件被拒绝：${accepted.code} ${accepted.message}`);
    }

    session.quit();
    return { accepted: true, response: accepted.message };
  } catch (err) {
    session?.destroy();
    throw err;
  }
}

export default { sendMail };
