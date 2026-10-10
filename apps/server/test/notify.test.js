/**
 * 简卡铺 · 邮件与短信发送测试
 * ---------------------------------------------------------------------------
 * 不连真实服务器，而是在本机起一个**假 SMTP 服务器**和**假短信网关**，
 * 真刀真枪跑一遍协议交互，验证：
 *   · SMTP 客户端能否正确完成握手、认证、投递
 *   · 中文主题与正文的编码能否还原
 *   · 短信参数模板的占位符替换与编码方式
 *   · 联系方式识别（手机号 / 邮箱 / 其它）
 *
 *   node apps/server/test/notify.test.js
 */
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";

import { sendMail } from "../src/lib/mailer.js";
import { sendSms } from "../src/lib/sms.js";
import { detectChannel } from "../src/services/notify.js";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  \u001b[32m✓\u001b[0m ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  \u001b[31m✗\u001b[0m ${name}`);
    console.log(`      ${err.message}`);
  }
}

console.log("\n\u001b[1m简卡铺 · 通知发送测试\u001b[0m\n");

/* ==================================================== 假 SMTP 服务器 */

/**
 * 一个刚好够用的 SMTP 服务器：支持 EHLO / AUTH LOGIN / DATA。
 * 它把收到的 DATA 内容存进 session，供断言检查。
 */
function createFakeSmtp({ requireAuth = true, authUser = "noreply@test.com", authPass = "secret" } = {}) {
  const received = [];
  let authSeen = null;

  const server = net.createServer((socket) => {
    let buffer = "";
    let inData = false;
    let dataLines = [];
    let stage = "command";
    let pendingUser = "";
    const session = { auth: null, from: "", to: [], data: "" };
    received.push(session);

    socket.write("220 fake.local ESMTP ready\r\n");

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      let idx;
      while ((idx = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            session.data = dataLines.join("\r\n");
            dataLines = [];
            socket.write("250 2.0.0 Ok: queued\r\n");
          } else {
            /* 还原点填充 */
            dataLines.push(line.startsWith("..") ? line.slice(1) : line);
          }
          continue;
        }

        const upper = line.toUpperCase();

        if (stage === "auth-user") {
          pendingUser = Buffer.from(line, "base64").toString("utf8");
          stage = "auth-pass";
          socket.write("334 UGFzc3dvcmQ6\r\n");
          continue;
        }
        if (stage === "auth-pass") {
          const pass = Buffer.from(line, "base64").toString("utf8");
          session.auth = { user: pendingUser, pass };
          authSeen = session.auth;
          stage = "command";
          if (requireAuth && (pendingUser !== authUser || pass !== authPass)) {
            socket.write("535 5.7.8 认证失败\r\n");
          } else {
            socket.write("235 2.7.0 Authentication successful\r\n");
          }
          continue;
        }

        if (upper.startsWith("EHLO")) {
          socket.write("250-fake.local\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 10485760\r\n");
        } else if (upper.startsWith("HELO")) {
          socket.write("250 fake.local\r\n");
        } else if (upper.startsWith("AUTH LOGIN")) {
          stage = "auth-user";
          socket.write("334 VXNlcm5hbWU6\r\n");
        } else if (upper.startsWith("MAIL FROM")) {
          session.from = line.slice(line.indexOf("<") + 1, line.lastIndexOf(">"));
          socket.write("250 2.1.0 Ok\r\n");
        } else if (upper.startsWith("RCPT TO")) {
          session.to.push(line.slice(line.indexOf("<") + 1, line.lastIndexOf(">")));
          socket.write("250 2.1.5 Ok\r\n");
        } else if (upper.startsWith("DATA")) {
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (upper.startsWith("QUIT")) {
          socket.write("221 2.0.0 Bye\r\n");
          socket.end();
        } else {
          socket.write("250 Ok\r\n");
        }
      }
    });

    socket.on("error", () => {});
  });

  return {
    server,
    received,
    get lastAuth() {
      return authSeen;
    },
    listen: () =>
      new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve(server.address().port));
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/* ============================================================ 邮件测试 */

await test("SMTP：完成握手、认证并投递一封中文邮件", async () => {
  const fake = createFakeSmtp();
  const port = await fake.listen();

  try {
    const result = await sendMail({
      host: "127.0.0.1",
      port,
      secure: false,
      user: "noreply@test.com",
      pass: "secret",
      from: "noreply@test.com",
      fromName: "简卡铺",
      to: "buyer@example.com",
      subject: "订单 JKP20260101001 发货通知",
      text: "您的卡密是：AIQY-8F3K-2M9D-77QX",
    });

    assert.equal(result.accepted, true);

    const session = fake.received[0];
    assert.ok(session, "服务器应收到一个会话");
    assert.equal(session.auth.user, "noreply@test.com", "应使用配置的账号认证");
    assert.equal(session.auth.pass, "secret", "应使用配置的密码认证");
    assert.equal(session.from, "noreply@test.com");
    assert.deepEqual(session.to, ["buyer@example.com"]);

    /* 正文是 base64 编码的，解出来应该能还原中文与卡密 */
    const bodyStart = session.data.indexOf("\r\n\r\n");
    assert.ok(bodyStart > 0, "DATA 里应有头部与正文的分隔");
    const encodedBody = session.data.slice(bodyStart + 4).replace(/\r\n/g, "");
    const decoded = Buffer.from(encodedBody, "base64").toString("utf8");
    assert.ok(decoded.includes("AIQY-8F3K-2M9D-77QX"), `正文应含卡密，实际：${decoded}`);
    assert.ok(decoded.includes("您的卡密是"), `正文应保留中文，实际：${decoded}`);

    /* 主题用 RFC 2047 编码 */
    assert.ok(session.data.includes("Subject: =?UTF-8?B?"), "中文主题应按 RFC 2047 编码");
    const subjectB64 = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(session.data)?.[1] ?? "";
    const subject = Buffer.from(subjectB64, "base64").toString("utf8");
    assert.equal(subject, "订单 JKP20260101001 发货通知", "主题解码后应与原文一致");
  } finally {
    await fake.close();
  }
});

await test("SMTP：密码错误时明确报错，不静默失败", async () => {
  const fake = createFakeSmtp();
  const port = await fake.listen();

  try {
    await assert.rejects(
      () =>
        sendMail({
          host: "127.0.0.1",
          port,
          secure: false,
          user: "noreply@test.com",
          pass: "wrong",
          from: "noreply@test.com",
          to: "buyer@example.com",
          subject: "test",
          text: "test",
        }),
      /SMTP 命令失败|认证/,
      "认证失败应抛出可读的错误"
    );
  } finally {
    await fake.close();
  }
});

await test("SMTP：行首的点会被正确还原（点填充）", async () => {
  const fake = createFakeSmtp();
  const port = await fake.listen();

  try {
    await sendMail({
      host: "127.0.0.1",
      port,
      secure: false,
      user: "noreply@test.com",
      pass: "secret",
      from: "noreply@test.com",
      to: "buyer@example.com",
      subject: "dot stuffing",
      text: ".hidden line\nnormal line",
    });

    const bodyStart = fake.received[0].data.indexOf("\r\n\r\n");
    const decoded = Buffer.from(
      fake.received[0].data.slice(bodyStart + 4).replace(/\r\n/g, ""),
      "base64"
    ).toString("utf8");
    assert.ok(decoded.includes(".hidden line"), `点填充应被还原，实际：${decoded}`);
  } finally {
    await fake.close();
  }
});

await test("SMTP：缺少服务器地址时立即报错，不去连空地址", async () => {
  await assert.rejects(
    () => sendMail({ host: "", from: "a@b.com", to: "c@d.com", subject: "x", text: "y" }),
    /未配置 SMTP 服务器地址/
  );
});

/* ============================================================ 短信测试 */

/** 起一个假短信网关，记录收到的请求 */
function createFakeGateway({ respond = "ok", status = 200 } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({
        method: req.method,
        url: req.url,
        contentType: req.headers["content-type"] ?? "",
        body,
      });
      res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(respond);
    });
  });
  return {
    calls,
    listen: () =>
      new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

await test("短信：POST 表单方式，占位符被正确替换", async () => {
  const gw = createFakeGateway({ respond: "success" });
  const port = await gw.listen();

  try {
    const result = await sendSms({
      url: `http://127.0.0.1:${port}/sms`,
      method: "POST",
      bodyType: "form",
      paramsTemplate: '{"account":"jkapu","password":"{key}","mobile":"{phone}","content":"{content}"}',
      key: "SECRET-KEY",
      phone: "13800001111",
      content: "【简卡铺】订单已发货，卡密：TEST-0001",
      successText: "success",
    });

    assert.equal(result.accepted, true);
    assert.equal(gw.calls.length, 1);

    const call = gw.calls[0];
    assert.equal(call.method, "POST");
    assert.ok(call.contentType.includes("x-www-form-urlencoded"), `实际类型：${call.contentType}`);

    const params = new URLSearchParams(call.body);
    assert.equal(params.get("account"), "jkapu");
    assert.equal(params.get("password"), "SECRET-KEY", "密钥占位符应被替换");
    assert.equal(params.get("mobile"), "13800001111", "手机号占位符应被替换");
    assert.equal(params.get("content"), "【简卡铺】订单已发货，卡密：TEST-0001");
  } finally {
    await gw.close();
  }
});

await test("短信：GET 方式把参数放进查询串", async () => {
  const gw = createFakeGateway({ respond: "1" });
  const port = await gw.listen();

  try {
    await sendSms({
      url: `http://127.0.0.1:${port}/send`,
      method: "GET",
      paramsTemplate: "account=jkapu&password={key}&mobile={phone}&content={content}",
      key: "K1",
      phone: "13900002222",
      content: "测试",
    });

    const call = gw.calls[0];
    assert.equal(call.method, "GET");
    const url = new URL(call.url, `http://127.0.0.1:${port}`);
    assert.equal(url.searchParams.get("account"), "jkapu");
    assert.equal(url.searchParams.get("mobile"), "13900002222");
    assert.equal(url.searchParams.get("content"), "测试");
  } finally {
    await gw.close();
  }
});

await test("短信：JSON 方式提交", async () => {
  const gw = createFakeGateway({ respond: "ok" });
  const port = await gw.listen();

  try {
    await sendSms({
      url: `http://127.0.0.1:${port}/api`,
      method: "POST",
      bodyType: "json",
      paramsTemplate: '{"phone":"{phone}","text":"{content}"}',
      phone: "13700003333",
      content: "JSON 测试",
    });

    const call = gw.calls[0];
    assert.ok(call.contentType.includes("application/json"));
    const parsed = JSON.parse(call.body);
    assert.equal(parsed.phone, "13700003333");
    assert.equal(parsed.text, "JSON 测试");
  } finally {
    await gw.close();
  }
});

await test("短信：响应体不含约定的成功标记时视为失败", async () => {
  const gw = createFakeGateway({ respond: "错误：余额不足" });
  const port = await gw.listen();

  try {
    await assert.rejects(
      () =>
        sendSms({
          url: `http://127.0.0.1:${port}/sms`,
          paramsTemplate: '{"mobile":"{phone}","content":"{content}"}',
          phone: "13800001111",
          content: "测试",
          successText: "success",
        }),
      /不符合预期/,
      "应把业务失败识别出来"
    );
  } finally {
    await gw.close();
  }
});

await test("短信：网关返回 5xx 时抛出带响应体的错误", async () => {
  const gw = createFakeGateway({ respond: "server error", status: 500 });
  const port = await gw.listen();

  try {
    await assert.rejects(
      () =>
        sendSms({
          url: `http://127.0.0.1:${port}/sms`,
          paramsTemplate: '{"mobile":"{phone}"}',
          phone: "13800001111",
          content: "x",
        }),
      /HTTP 500/
    );
  } finally {
    await gw.close();
  }
});

/* ====================================================== 联系方式识别 */

await test("联系方式识别：手机号走短信", () => {
  for (const value of ["13800001111", "138 0000 1111", "138-0000-1111", "+8613800001111", "8613800001111"]) {
    assert.equal(detectChannel(value), "sms", `${value} 应识别为手机号`);
  }
});

await test("联系方式识别：邮箱走邮件", () => {
  for (const value of ["a@b.com", "buyer.name+tag@example.co.uk", "  x@y.cn  "]) {
    assert.equal(detectChannel(value), "email", `${value} 应识别为邮箱`);
  }
});

await test("联系方式识别：其它内容一律识别不出（不算错误）", () => {
  for (const value of ["", "  ", "QQ12345678", "微信：abc", "随便写的", "12345", "12345678901"]) {
    assert.equal(detectChannel(value), null, `「${value}」不该被强行归类`);
  }
});

await test("联系方式识别：固定电话与超短号不会被误判成手机号", () => {
  assert.equal(detectChannel("021-12345678"), null);
  assert.equal(detectChannel("110"), null);
  assert.equal(detectChannel("1234567890"), null, "10 位数字不是手机号");
});

/* ------------------------------------------------------------------ */

console.log("");
if (failed === 0) {
  console.log(`\u001b[32m全部通过\u001b[0m  ${passed} 项`);
} else {
  console.log(`\u001b[31m失败 ${failed} 项\u001b[0m / 通过 ${passed} 项`);
}
process.exit(failed === 0 ? 0 : 1);
