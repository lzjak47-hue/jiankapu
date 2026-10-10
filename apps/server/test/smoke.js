/**
 * 简卡铺 · 接口冒烟测试（PostgreSQL + 双端口）
 * ---------------------------------------------------------------------------
 * 覆盖：双服务静态资源 / 前台下单支付发货全链路 / 库存扣减与释放 /
 *       后台认证（验证码 + 会话） / 后台核心 CRUD / 目录穿越防护
 *
 * 运行：node apps/server/test/smoke.js
 * （建议通过 run.js 运行，它会准备好独立的测试数据库与端口）
 */
import assert from "node:assert/strict";
import config from "../src/config.js";
import { createServer } from "../src/http/server.js";
import { seed } from "../src/seed.js";
import { get, all, run, scalar, closePool } from "../src/db.js";
import { toSvg } from "../src/lib/qrcode.js";
import * as settingsService from "../src/services/settings.js";

const SITE_PORT = config.servers.site.port;
const ADMIN_PORT = config.servers.admin.port;
const BASE = `http://127.0.0.1:${SITE_PORT}`;
const ADMIN_BASE = `http://127.0.0.1:${ADMIN_PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  \u001b[32m✓\u001b[0m ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, err });
    console.log(`  \u001b[31m✗\u001b[0m ${name}`);
    console.log(`      ${err.message}`);
  }
}

const section = (title) => console.log(`\n\u001b[36m${title}\u001b[0m`);

/* ------------------------------------------------------------------ 请求助手 */

let cookie = "";

async function api(path, { method = "GET", body, auth = false, raw = false, host } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && cookie) headers.Cookie = cookie;

  const base = host === "admin" ? ADMIN_BASE : BASE;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });

  if (raw) return res;

  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  return { status: res.status, json: payload, res, text };
}

/** 验证码是以 SVG 图形下发的，测试直接从库里取答案（仅测试可用） */
async function captchaAnswer(id) {
  const row = await get("SELECT code FROM captchas WHERE id = ?", id);
  return row?.code;
}

/* -------------------------------------------------------------------- 主流程 */

console.log("\n\u001b[1m简卡铺 · 接口冒烟测试\u001b[0m");
console.log(`数据库: ${config.db.database} @ ${config.db.host}:${config.db.port}`);
console.log(`前台: ${BASE}   后台: ${ADMIN_BASE}\n`);

section("准备：重建测试数据");
const seedResult = await seed({ force: true, quiet: true });
await settingsService.reload(); // 与 index.js 启动流程保持一致
console.log(`  已初始化：商品 ${seedResult.products} 件 · 卡密 ${seedResult.cards} 条 · 订单 ${seedResult.orders} 笔`);

const siteServer = createServer("site");
const adminServer = createServer("admin");
await new Promise((r) => siteServer.listen(SITE_PORT, "127.0.0.1", r));
await new Promise((r) => adminServer.listen(ADMIN_PORT, "127.0.0.1", r));
console.log(`  两个服务已启动`);

try {
  /* ---------------------------------------------------------- 双端口服务 */
  section("双端口服务");

  await test("前台服务返回商城首页", async () => {
    const res = await api("/", { raw: true });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('id="root"'), "应返回 React 挂载点");
    assert.ok(text.includes("window.JKP_RUNTIME"), "应注入运行时配置");
  });

  await test("前台 SPA 路由回退到入口页", async () => {
    for (const page of ["/", "/query", "/product/p001"]) {
      const res = await api(page, { raw: true });
      assert.equal(res.status, 200, `${page} 返回 ${res.status}`);
      const text = await res.text();
      assert.ok(text.includes('id="root"'), `${page} 应返回 SPA 入口`);
    }
  });

  await test("前台服务把旧版 /admin/* 链接映射到后台 SPA 路由", async () => {
    const cases = [
      ["/admin", ""],
      ["/admin/", ""],
      ["/admin/index.html", ""],
      ["/admin/login.html", "/login"],
      ["/admin/orders.html", "/orders"],
      ["/admin/settings.html", "/settings"],
    ];

    for (const [from, suffix] of cases) {
      const res = await api(from, { raw: true });
      assert.equal(res.status, 302, `${from} 期望 302，实际 ${res.status}`);
      const location = res.headers.get("location") || "";
      assert.ok(location.includes(`:${ADMIN_PORT}`), `${from} 应跳到后台端口，实际 ${location}`);
      assert.ok(
        location.endsWith(suffix),
        `${from} 应跳到 ${suffix || "/"}，实际 ${location}`
      );
    }
  });

  await test("后台服务根路径返回后台入口", async () => {
    const res = await api("/", { raw: true, host: "admin" });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('id="root"'), "应返回 React 挂载点");
    assert.ok(text.includes("window.JKP_RUNTIME"), "应注入运行时配置");
  });

  await test("后台 SPA 路由全部回退到入口页", async () => {
    for (const page of ["/login", "/products", "/orders", "/cards", "/users", "/settings", "/logs"]) {
      const res = await api(page, { raw: true, host: "admin" });
      assert.equal(res.status, 200, `${page} 返回 ${res.status}`);
    }
  });

  await test("后台能跨目录回落到 Vite 打包资源", async () => {
    // 后台入口在 dist/admin 下，而 JS/CSS 在 dist/assets，需要回落才能取到
    const html = await (await api("/", { raw: true, host: "admin" })).text();
    const match = /src="([^"]+\.js)"/.exec(html);
    assert.ok(match, "后台 HTML 应引用打包后的 JS");

    const res = await api(match[1], { raw: true, host: "admin" });
    assert.equal(res.status, 200, `${match[1]} 返回 ${res.status}`);
    assert.ok(
      String(res.headers.get("content-type")).includes("javascript"),
      "应返回 JavaScript"
    );
  });

  await test("缺少的静态资源返回 404 而不是入口页", async () => {
    // 有扩展名的路径不应触发 SPA 回退，否则会把 HTML 当成 js 返回
    const res = await api("/assets/not-exist.js", { raw: true, host: "admin" });
    assert.equal(res.status, 404, `期望 404，实际 ${res.status}`);
  });

  await test("两个服务都注入了跨端口运行时配置", async () => {
    const site = await (await api("/", { raw: true })).text();
    assert.ok(site.includes("window.JKP_RUNTIME"), "前台应注入运行时配置");
    assert.ok(site.includes("adminBase"), "应包含后台地址");

    const adm = await (await api("/", { raw: true, host: "admin" })).text();
    assert.ok(adm.includes("window.JKP_RUNTIME"), "后台应注入运行时配置");
    assert.ok(adm.includes("siteBase"), "应包含前台地址");
  });

  await test("健康检查返回角色", async () => {
    const a = await api("/healthz");
    assert.equal(a.json.data.role, "site");
    const b = await api("/healthz", { host: "admin" });
    assert.equal(b.json.data.role, "admin");
  });

  await test("目录穿越被阻断", async () => {
    const res = await api("/../package.json", { raw: true });
    assert.ok(res.status === 404 || res.status === 400, `期望 404/400，实际 ${res.status}`);
  });

  await test("未知接口返回 404 JSON", async () => {
    const { status, json } = await api("/api/nope");
    assert.equal(status, 404);
    assert.equal(json.ok, false);
  });

  /* ---------------------------------------------------------- 前台数据 */
  section("前台数据接口");

  let bootstrap;
  await test("bootstrap 返回设置/分类/商品/公告", async () => {
    const { status, json } = await api("/api/public/bootstrap");
    assert.equal(status, 200);
    bootstrap = json.data;
    assert.ok(bootstrap.products.length >= 10, "商品数量应 >= 10");
    assert.ok(bootstrap.categories.length >= 5, "分类数量应 >= 5");
    assert.ok(bootstrap.announcements.length >= 1, "公告不应为空");
    assert.equal(bootstrap.settings.site.name, "简卡铺");
    assert.ok(bootstrap.endpoints.site.includes(String(SITE_PORT)), "应回传前台地址");
  });

  await test("bootstrap 不泄露支付密钥字段", async () => {
    const blob = JSON.stringify(bootstrap.settings);
    assert.ok(!blob.includes("wxPrivateKey"), "不应出现微信商户私钥");
    assert.ok(!blob.includes("wxApiV3Key"), "不应出现 APIv3 密钥");
    assert.ok(!blob.includes("aliPrivateKey"), "不应出现支付宝应用私钥");
  });

  await test("前台只返回已上架商品", async () => {
    assert.equal(bootstrap.products.filter((p) => p.status !== 1).length, 0);
  });

  await test("中文与 emoji 正确往返（数据库编码）", async () => {
    const p = bootstrap.products.find((x) => x.id === "p001");
    assert.equal(p.name, "爱奇艺黄金 VIP 会员");
    assert.equal(p.emoji, "🎬");
    assert.equal(p.desc.includes("自动发货"), true);
  });

  /* -------------------------------------------------------------- 下单 */
  section("下单 → 支付 → 发货");

  const stockBefore = Number(await scalar("SELECT stock FROM products WHERE id = 'p001'"));
  let orderNo = "";

  await test("创建订单成功并锁定卡密", async () => {
    const { status, json } = await api("/api/public/orders", {
      method: "POST",
      body: { productId: "p001", spec: "月卡", qty: 2, contact: "tester@example.com", payChannel: "test" },
    });
    assert.equal(status, 200, JSON.stringify(json));
    orderNo = json.data.no;
    assert.ok(/^JKP\d{13}$/.test(orderNo), `订单号格式异常: ${orderNo}`);
    assert.equal(json.data.status, "待付款");
    assert.equal(json.data.amount, 25.6);
    assert.ok(json.data.remainSeconds > 0, "应有支付倒计时");
    assert.ok(json.data.payUrl.includes(orderNo), "应返回支付链接");
  });

  await test("下单后可用库存减少 2", async () => {
    const after = Number(await scalar("SELECT stock FROM products WHERE id = 'p001'"));
    assert.equal(after, stockBefore - 2, `库存 ${stockBefore} → ${after}`);
  });

  await test("锁定中的卡密状态为「已锁定」", async () => {
    assert.equal(Number(await scalar("SELECT COUNT(*) AS c FROM cards WHERE status = '已锁定'")), 2);
  });

  await test("未支付时订单不返回卡密", async () => {
    const { json } = await api(`/api/public/orders/${orderNo}`);
    assert.equal(json.data.status, "待付款");
    assert.equal(json.data.secrets.length, 0);
  });

  await test("测试渠道不下发二维码（本来就不需要扫码）", async () => {
    const data = (await api(`/api/public/orders/${orderNo}`)).json.data;
    assert.equal(data.payChannel, "test");
    assert.equal(data.qrSvg, "", "测试渠道不该有付款码");
    assert.equal(data.qrPayload, "");
  });

  await test("付款码能渲染成合规的 SVG 二维码", () => {
    /* 真实渠道的付款码由网关下发，本地跑不了，
       所以这里直接验证渲染层：任意付款码字符串都要能出合规 SVG。
       编码器本身另有 25 项规范一致性测试。 */
    const fakePayUrl = "weixin://wxpay/bizpayurl?pr=AbCdEfG";
    const svg = toSvg(fakePayUrl, { scale: 4, margin: 3 });

    assert.ok(svg.startsWith("<svg"), "应输出 SVG");
    assert.ok(svg.includes("viewBox"), "应带 viewBox");
    assert.ok(svg.includes("<path"), "应包含模块路径");
    assert.ok(svg.includes('fill="#FFFFFF"'), "底色应为白色");
  });

  await test("payUrl 指向的查单页真实可访问（不能是 404）", async () => {
    const data = (await api(`/api/public/orders/${orderNo}`)).json.data;
    assert.ok(data.payUrl, "应返回 payUrl");

    const path = new URL(data.payUrl).pathname + new URL(data.payUrl).search;
    assert.equal(path.split("?")[0], "/query", `查单链接路径应为 /query，实际 ${path}`);

    /* 关键：真的去请求一次。这是 SPA 迁移最容易漏掉的一环——
       链接指向 /query.html 时带扩展名不会触发 SPA 回退，点开就是 404。 */
    const res = await api(path, { raw: true });
    assert.equal(res.status, 200, `查单地址应可访问，实际 ${res.status}：${path}`);
    const html = await res.text();
    assert.ok(html.includes('id="root"'), "查单地址应返回前台 SPA 入口");
  });

  let secrets = [];
  await test("支付成功后订单变为已发货并给出卡密", async () => {
    const { status, json } = await api(`/api/public/orders/${orderNo}/pay`, { method: "POST" });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.data.status, "已发货");
    secrets = json.data.secrets;
    assert.equal(secrets.length, 2, "应发放 2 条卡密");
    assert.ok(secrets[0].length > 10, "卡密内容不应为空");
  });

  await test("重复支付是幂等的，返回同一批卡密", async () => {
    const { json } = await api(`/api/public/orders/${orderNo}/pay`, { method: "POST" });
    assert.deepEqual(json.data.secrets, secrets, "重复支付不应换发卡密");
  });

  await test("已发货订单不再下发二维码", async () => {
    const { json } = await api(`/api/public/orders/${orderNo}`);
    assert.equal(json.data.qrSvg, "");
  });

  await test("卡密已标记为已售", async () => {
    const sold = Number(await scalar("SELECT COUNT(*) AS c FROM cards WHERE status = '已售' AND product_id = 'p001'"));
    assert.ok(sold >= 2, `p001 已售卡密应 >= 2，实际 ${sold}`);
  });

  await test("商品销量累加 2", async () => {
    const sold = Number(await scalar("SELECT sold FROM products WHERE id = 'p001'"));
    const base = bootstrap.products.find((p) => p.id === "p001").sold;
    assert.equal(sold, base + 2, `销量应为 ${base + 2}，实际 ${sold}`);
  });

  await test("凭订单号可查到卡密", async () => {
    const { json } = await api(`/api/public/orders/query?keyword=${orderNo}`);
    assert.equal(json.data.total, 1);
    assert.deepEqual(json.data.orders[0].secrets, secrets);
  });

  await test("固定演示订单可查到", async () => {
    const { json } = await api("/api/public/orders/query?keyword=JKP20260101001");
    assert.equal(json.data.total, 1);
    assert.equal(json.data.orders[0].status, "已发货");
  });

  await test("非法商品下单被拒绝", async () => {
    const { status } = await api("/api/public/orders", {
      method: "POST",
      body: {
        productId: "not-exist", qty: 1,
        contact: "tester@example.com", payChannel: "test",
      },
    });
    assert.equal(status, 404);
  });

  await test("数量非法被拒绝", async () => {
    const { status } = await api("/api/public/orders", {
      method: "POST",
      body: { productId: "p001", qty: 99999, contact: "tester@example.com", payChannel: "test" },
    });
    assert.equal(status, 400);
  });

  await test("不存在的规格被拒绝", async () => {
    const { status } = await api("/api/public/orders", {
      method: "POST",
      body: {
        productId: "p001", spec: "十年卡", qty: 1,
        contact: "tester@example.com", payChannel: "test",
      },
    });
    assert.equal(status, 409);
  });

  await test("售罄商品无法下单", async () => {
    const { status } = await api("/api/public/orders", {
      method: "POST",
      body: { productId: "p004", qty: 1, contact: "tester@example.com", payChannel: "test" },
    });
    assert.equal(status, 409);
  });

  await test("取消未支付订单会释放卡密", async () => {
    const created = await api("/api/public/orders", {
      method: "POST",
      body: { productId: "p002", spec: "月卡", qty: 1, contact: "cancel@example.com", payChannel: "test" },
    });
    assert.equal(created.status, 200, `下单失败：${JSON.stringify(created.json)}`);
    const no = created.json.data.no;
    const locked = Number(await scalar("SELECT stock FROM products WHERE id = 'p002'"));

    const cancel = await api(`/api/public/orders/${no}/cancel`, { method: "POST" });
    assert.equal(cancel.status, 200);

    const after = Number(await scalar("SELECT stock FROM products WHERE id = 'p002'"));
    assert.equal(after, locked + 1, "取消后卡密应回到库存池");
    assert.equal(Number(await scalar("SELECT COUNT(*) AS c FROM cards WHERE status = '已锁定'")), 0);
  });

  /* -------------------------------------------------------- 后台认证 */
  section("后台认证");

  await test("未登录访问后台接口返回 401", async () => {
    const { status, json } = await api("/api/admin/dashboard");
    assert.equal(status, 401);
    assert.equal(json.code, "UNAUTHORIZED");
  });

  await test("后台接口在两个端口上都可用", async () => {
    const a = await api("/api/admin/dashboard", { host: "admin" });
    const b = await api("/api/admin/dashboard");
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
  });

  let captchaId = "";
  await test("获取验证码返回 SVG 且不含答案", async () => {
    const { status, json } = await api("/api/admin/captcha");
    assert.equal(status, 200);
    captchaId = json.data.id;
    assert.ok(json.data.svg.startsWith("<svg"), "应返回 SVG");
  });

  await test("验证码错误时登录失败", async () => {
    const { status, json } = await api("/api/admin/login", {
      method: "POST",
      body: { username: "admin", password: "123456", captchaId, captchaCode: "ZZZZ" },
    });
    assert.equal(status, 400);
    assert.match(json.message, /验证码/);
  });

  await test("验证码是一次性的", async () => {
    const answer = (await captchaAnswer(captchaId)) || "AAAA";
    const { status } = await api("/api/admin/login", {
      method: "POST",
      body: { username: "admin", password: "123456", captchaId, captchaCode: answer },
    });
    assert.equal(status, 400, "同一个验证码不应能重复使用");
  });

  await test("密码错误时登录失败", async () => {
    const cap = await api("/api/admin/captcha");
    const id = cap.json.data.id;
    const { status, json } = await api("/api/admin/login", {
      method: "POST",
      body: { username: "admin", password: "wrong-password", captchaId: id, captchaCode: await captchaAnswer(id) },
    });
    assert.equal(status, 401);
    assert.match(json.message, /账号或密码错误/);
  });

  await test("账号密码 + 验证码正确时登录成功", async () => {
    const cap = await api("/api/admin/captcha");
    const id = cap.json.data.id;
    const res = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "admin",
        password: "123456",
        captchaId: id,
        captchaCode: await captchaAnswer(id),
      }),
    });
    assert.equal(res.status, 200);
    const raw = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith("jkp_session="));
    assert.ok(raw, "应下发会话 Cookie");
    assert.match(raw, /HttpOnly/, "会话 Cookie 必须是 HttpOnly");
    cookie = raw.split(";")[0];
  });

  await test("登录后可读取自己的信息", async () => {
    const { status, json } = await api("/api/admin/me", { auth: true });
    assert.equal(status, 200);
    assert.equal(json.data.admin.username, "admin");
  });

  /* -------------------------------------------------------- 后台业务 */
  section("后台业务");

  await test("数据概览结构完整", async () => {
    const { status, json } = await api("/api/admin/dashboard", { auth: true });
    assert.equal(status, 200);
    const d = json.data;
    assert.equal(d.stats.length, 4);
    assert.equal(d.series.length, 7);
    assert.ok(d.topProducts.length > 0);
    assert.ok(d.recentOrders.length > 0);
    assert.equal(d.system.database, "PostgreSQL");
  });

  await test("商品列表分页正常", async () => {
    const { json } = await api("/api/admin/products?page=1&perPage=5", { auth: true });
    assert.equal(json.data.rows.length, 5);
    assert.ok(json.data.total >= 12);
  });

  await test("新增 → 编辑 → 下架 → 删除商品", async () => {
    const created = await api("/api/admin/products", {
      method: "POST",
      auth: true,
      body: { id: "p999", name: "冒烟测试商品", category: "other", price: 1.5, emoji: "🧪", specs: ["A", "B"], desc: "测试用" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.deepEqual(created.json.data.specs, ["A", "B"]);

    const updated = await api("/api/admin/products/p999", {
      method: "PUT", auth: true, body: { price: 9.9, name: "冒烟测试商品(改)" },
    });
    assert.equal(updated.json.data.price, 9.9);
    assert.equal(updated.json.data.name, "冒烟测试商品(改)");

    const toggled = await api("/api/admin/products/p999/toggle", { method: "POST", auth: true });
    assert.equal(toggled.json.data.status, 0);

    const removed = await api("/api/admin/products/p999", { method: "DELETE", auth: true });
    assert.equal(removed.status, 200);
    assert.equal(await get("SELECT id FROM products WHERE id = 'p999'"), undefined);
  });

  await test("商品参数校验：划线价低于售价被拒绝", async () => {
    const { status } = await api("/api/admin/products", {
      method: "POST", auth: true,
      body: { id: "p998", name: "校验测试", category: "other", price: 100, oldPrice: 10 },
    });
    assert.equal(status, 409);
  });

  await test("分类下有商品时不允许删除", async () => {
    const { status, json } = await api("/api/admin/categories/video", { method: "DELETE", auth: true });
    assert.equal(status, 409);
    assert.match(json.message, /还有/);
  });

  await test("新增 → 删除空分类", async () => {
    const created = await api("/api/admin/categories", {
      method: "POST", auth: true, body: { id: "smoke", name: "冒烟分类", sort: 90 },
    });
    assert.equal(created.status, 201);
    const dup = await api("/api/admin/categories", {
      method: "POST", auth: true, body: { id: "smoke", name: "重复" },
    });
    assert.equal(dup.status, 409, "重复标识应被拒绝");
    const removed = await api("/api/admin/categories/smoke", { method: "DELETE", auth: true });
    assert.equal(removed.status, 200);
  });

  /* ------------------------------------------------- 卡密按规格管理（v1.1） */

  await test("导入卡密必须指明规格（商品有规格时）", async () => {
    const specs = JSON.parse(String(await scalar("SELECT specs FROM products WHERE id = 'p008'")));
    assert.ok(specs.length > 0, "p008 应配置了多个规格，否则本测试没有意义");

    const { status, json } = await api("/api/admin/cards/import", {
      method: "POST", auth: true,
      body: { productId: "p008", text: "SMOKE-NOSPEC-0001" },
    });
    assert.equal(status, 409, "未选规格应被拒绝");
    assert.match(json.message, /规格/, `错误信息应提示选规格，实际：${json.message}`);
  });

  await test("导入到不存在的规格会被拒绝", async () => {
    const { status, json } = await api("/api/admin/cards/import", {
      method: "POST", auth: true,
      body: { productId: "p008", spec: "不存在的规格", text: "SMOKE-BADSPEC-0001" },
    });
    assert.equal(status, 409);
    assert.match(json.message, /不在该商品的规格列表/);
  });

  await test("批量导入卡密并回写库存（按规格）", async () => {
    const specs = JSON.parse(String(await scalar("SELECT specs FROM products WHERE id = 'p008'")));
    const spec = specs[0];

    const before = Number(await scalar("SELECT stock FROM products WHERE id = 'p008'"));
    const beforeSpec = Number(
      await scalar("SELECT COUNT(*) AS c FROM cards WHERE product_id='p008' AND spec=? AND status='未售'", spec)
    );

    const { status, json } = await api("/api/admin/cards/import", {
      method: "POST", auth: true,
      body: {
        productId: "p008",
        spec,
        text: "SMOKE-A-0001\nSMOKE-A-0002\nSMOKE-A-0003\nSMOKE-A-0001",
      },
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.data.imported, 3, "重复项应被跳过");
    assert.equal(json.data.duplicated, 1);
    assert.equal(json.data.spec, spec, "应回显导入到的规格");
    assert.equal(json.data.stock, beforeSpec + 3, "该规格的可用数应 +3");
    assert.equal(Number(await scalar("SELECT stock FROM products WHERE id='p008'")), before + 3);
  });

  await test("导入的卡密确实带上了规格", async () => {
    const specs = JSON.parse(String(await scalar("SELECT specs FROM products WHERE id = 'p008'")));
    const spec = specs[0];
    const { json } = await api(
      `/api/admin/cards?productId=p008&spec=${encodeURIComponent(spec)}&keyword=SMOKE-A-0001`,
      { auth: true }
    );
    assert.equal(json.data.rows.length, 1);
    assert.equal(json.data.rows[0].spec, spec);
  });

  await test("卡密列表可按规格筛选", async () => {
    const specs = JSON.parse(String(await scalar("SELECT specs FROM products WHERE id = 'p008'")));
    if (specs.length < 2) return;
    const { json } = await api(
      `/api/admin/cards?productId=p008&spec=${encodeURIComponent(specs[1])}`,
      { auth: true }
    );
    assert.ok(
      json.data.rows.every((r) => r.spec === specs[1]),
      "筛选结果里不应混入其它规格的卡密"
    );
  });

  await test("规格下还有卡密时，不允许删除或改名该规格", async () => {
    const { json: got } = await api("/api/admin/products/p008", { auth: true });
    const p = got.data;
    assert.ok(p.specs.length >= 2, "p008 应有多个规格，否则本测试没有意义");

    /* 上一个测试刚往 specs[0] 导了 3 条卡密，此时想删掉这个规格应被拦下 */
    const { status, json } = await api("/api/admin/products/p008", {
      method: "PUT",
      auth: true,
      body: {
        name: p.name,
        category: p.category,
        emoji: p.emoji,
        price: p.price,
        oldPrice: p.oldPrice,
        badge: p.badge,
        status: p.status,
        specs: [p.specs[1]],
        desc: p.desc,
        detail: p.detail,
        notice: p.notice,
        tutorial: p.tutorial,
      },
    });

    assert.equal(status, 409, `删除还有卡密的规格应被拒绝，实际 ${status}：${JSON.stringify(json)}`);
    assert.match(json.message, /卡密/, `错误信息应说明原因，实际：${json.message}`);

    /* 规格列表没有被改动 */
    const { json: after } = await api("/api/admin/products/p008", { auth: true });
    assert.deepEqual(after.data.specs, p.specs, "被拒绝后规格列表不应发生变化");
  });

  await test("规格下没有卡密时，允许改名或删除", async () => {
    const { json: got } = await api("/api/admin/products/p008", { auth: true });
    const p = got.data;

    /* 追加一个空规格后再删掉它 —— 空规格没有卡密，应该放行 */
    const { status, json } = await api("/api/admin/products/p008", {
      method: "PUT",
      auth: true,
      body: {
        name: p.name,
        category: p.category,
        emoji: p.emoji,
        price: p.price,
        oldPrice: p.oldPrice,
        badge: p.badge,
        status: p.status,
        specs: [...p.specs, "临时规格"],
        desc: p.desc,
        detail: p.detail,
        notice: p.notice,
        tutorial: p.tutorial,
      },
    });
    assert.equal(status, 200, `追加空规格应成功：${JSON.stringify(json)}`);
    assert.ok(json.data.specs.includes("临时规格"));
    assert.equal(json.data.specStock["临时规格"], 0, "新规格库存应为 0");
  });

  await test("商品接口返回各规格的独立库存", async () => {    const { json } = await api("/api/public/products/p008");
    assert.ok(json.data.specStock, "商品详情应带 specStock");
    const specs = json.data.specs;
    assert.ok(specs.length >= 2, "p008 应有多个规格");

    /* 每个规格都要有独立的库存数字，而不是共用总量 */
    for (const s of specs) {
      assert.equal(typeof json.data.specStock[s], "number", `规格「${s}」应有独立库存`);
    }
    const sum = specs.reduce((acc, s) => acc + (json.data.specStock[s] || 0), 0);
    assert.equal(sum, json.data.stock, "各规格库存之和应等于商品总库存");
  });

  await test("【关键】买月卡只会发月卡的卡密，不会串成其它规格", async () => {
    /* 造一个干净的商品：两个规格，各导入可识别的卡密 */
    const pid = "smoke-spec";
    const specs = ["月卡", "年卡"];

    await api("/api/admin/products", {
      method: "POST", auth: true,
      body: {
        id: pid, name: "规格隔离测试商品", category: "video", emoji: "🧪",
        price: 10, oldPrice: 0, badge: "", status: 1, specs,
        desc: "", detail: "", notice: [], tutorial: [],
      },
    });

    for (const spec of specs) {
      const { status } = await api("/api/admin/cards/import", {
        method: "POST", auth: true,
        body: {
          productId: pid,
          spec,
          text: `${spec === "月卡" ? "MONTHLY" : "YEARLY"}-KEY-1\n${spec === "月卡" ? "MONTHLY" : "YEARLY"}-KEY-2`,
        },
      });
      assert.equal(status, 200);
    }

    /* 买月卡 */
    const created = await api("/api/public/orders", {
      method: "POST",
      body: { productId: pid, spec: "月卡", qty: 1, contact: "13800000000", payChannel: "test" },
    });
    assert.equal(created.status, 200, JSON.stringify(created.json));

    const paid = await api(`/api/public/orders/${created.json.data.no}/pay`, { method: "POST" });
    assert.equal(paid.status, 200, JSON.stringify(paid.json));

    const secret = paid.json.data.secrets[0];
    assert.ok(
      String(secret).startsWith("MONTHLY"),
      `买月卡应发月卡卡密，实际发的是：${secret}`
    );

    /* 数据库层再确认一次：这张卡密确实挂在「月卡」规格下 */
    const row = await get("SELECT spec FROM cards WHERE secret = ?", secret);
    assert.equal(row.spec, "月卡");

    /* 年卡的库存不能被月卡的订单动到 */
    const yearlyLeft = Number(
      await scalar("SELECT COUNT(*) AS c FROM cards WHERE product_id=? AND spec='年卡' AND status='未售'", pid)
    );
    assert.equal(yearlyLeft, 2, "买月卡不应消耗年卡的库存");

    /* 月卡只剩 1 条，买 2 条必须失败（不能去动年卡的库存） */
    const rest = await api("/api/public/orders", {
      method: "POST",
      body: { productId: pid, spec: "月卡", qty: 2, contact: "13800000000", payChannel: "test" },
    });
    assert.equal(rest.status, 409, "月卡只剩 1 条，买 2 条应失败");
  });

  await test("某个规格售罄时只拒绝该规格，其它规格照常可买", async () => {
    const pid = "smoke-spec";
    /* 把月卡清空 */
    await run("UPDATE cards SET status='已售' WHERE product_id=? AND spec='月卡'", pid);

    const { status, json } = await api("/api/public/orders", {
      method: "POST",
      body: { productId: pid, spec: "月卡", qty: 1, contact: "spec-test@example.com", payChannel: "test" },
    });
    assert.equal(status, 409, "月卡已售罄应被拒绝");
    assert.match(json.message, /月卡/, `应指出是哪个规格售罄，实际：${json.message}`);

    /* 年卡还有货，应该能正常下单 */
    const ok = await api("/api/public/orders", {
      method: "POST",
      body: { productId: pid, spec: "年卡", qty: 1, contact: "spec-test@example.com", payChannel: "test" },
    });
    assert.equal(ok.status, 200, `年卡有货却下不了单：${JSON.stringify(ok.json)}`);
  });

  await test("已售卡密不允许删除", async () => {
    const soldCard = await get("SELECT id FROM cards WHERE status = '已售' LIMIT 1");
    assert.ok(soldCard, "需要一个已售卡密用于测试");
    const { status, json } = await api(`/api/admin/cards/${soldCard.id}`, { method: "DELETE", auth: true });
    assert.equal(status, 409);
    assert.match(json.message, /已售/);
  });

  await test("订单统计口径正确", async () => {
    const { json } = await api("/api/admin/orders/stats", { auth: true });
    const d = json.data;

    /* 刻意不写死绝对值：种子订单数是随机的，写死会时好时坏。
       这里直接和数据库对账 —— 「口径对不对」才是这个测试要保证的东西。 */
    const row = await get(`
      SELECT COUNT(*)                                                          AS total,
             COUNT(*) FILTER (WHERE status = '已发货')                          AS shipped,
             COALESCE(SUM(amount) FILTER (WHERE status IN ('已发货','处理中')), 0) AS revenue,
             COUNT(*) FILTER (WHERE status IN ('待付款','处理中'))               AS pending
        FROM orders
    `);

    assert.ok(d.total > 0, "至少应有种子订单");
    assert.equal(d.total, Number(row.total), "订单总数口径不对");
    assert.equal(d.shipped, Number(row.shipped), "已发货数口径不对");
    assert.equal(d.pending, Number(row.pending), "待处理数口径不对");
    assert.ok(Math.abs(d.revenue - Number(row.revenue)) < 0.01, "成交金额口径不对");
  });

  await test("补发卡密会增加卡密数量", async () => {
    const order = await get("SELECT id, qty, product_id, spec FROM orders WHERE order_no = ?", orderNo);
    const before = Number(await scalar("SELECT COUNT(*) AS c FROM order_cards WHERE order_id = ?", order.id));

    /* 补发要沿用订单原本的规格；前面的用例可能把该规格买空了，先补一批再测 */
    const stocked = await api("/api/admin/cards/import", {
      method: "POST", auth: true,
      body: {
        productId: order.product_id,
        spec: order.spec,
        text: "RESEND-A-1\nRESEND-A-2\nRESEND-A-3\nRESEND-A-4",
      },
    });
    assert.equal(stocked.status, 200, `补库存失败：${JSON.stringify(stocked.json)}`);

    const { status, json } = await api(`/api/admin/orders/${orderNo}/resend`, { method: "POST", auth: true });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.data.secrets.length, before + Number(order.qty), "补发后卡密数应增加");
  });

  await test("已发货订单不可关闭，只可退款", async () => {
    const close = await api(`/api/admin/orders/${orderNo}/close`, { method: "POST", auth: true });
    assert.equal(close.status, 409);
  });

  /* ------------------------------------------------------ 客户管理 */

  await test("下单会自动建立客户档案并记录 IP", async () => {
    const contact = `auto-${Date.now()}@example.com`;
    const created = await api("/api/public/orders", {
      method: "POST",
      body: { productId: "p008", spec: "500 点券", qty: 1, contact },
    });
    assert.equal(created.status, 200, JSON.stringify(created.json));

    const found = await get("SELECT uid, contact, last_ip FROM users WHERE contact = ?", contact);
    assert.ok(found, "下单后应自动建档 —— 否则后台「客户管理」永远是空的");
    assert.ok(found.last_ip, `应记录下单 IP，实际 "${found.last_ip}"`);

    await api(`/api/public/orders/${created.json.data.no}/cancel`, { method: "POST" });
  });

  await test("联系方式现在是必填的", async () => {
    for (const contact of [undefined, "", "   "]) {
      const { status, json } = await api("/api/public/orders", {
        method: "POST",
        body: { productId: "p008", spec: "500 点券", qty: 1, contact, payChannel: "test" },
      });
      assert.equal(status, 400, `联系方式为「${contact}」时应被拒绝，实际 ${status}`);
      assert.match(json.message, /联系方式/, `错误信息应点名联系方式：${json.message}`);
    }

    /* 必填但不限格式：中文、QQ 号都行 */
    const ok = await api("/api/public/orders", {
      method: "POST",
      body: { productId: "p008", spec: "500 点券", qty: 1, contact: "随便写一个字", payChannel: "test" },
    });
    assert.equal(ok.status, 200, `非空即可，不该限制格式：${JSON.stringify(ok.json)}`);
    await api(`/api/public/orders/${ok.json.data.no}/cancel`, { method: "POST" });
  });

  await test("客户列表带最近下单 IP，且不再暴露封禁状态", async () => {
    const list = await api("/api/admin/users?page=1&perPage=5", { auth: true });
    assert.equal(list.status, 200);
    assert.ok(list.json.data.rows.length > 0, "前台下过单后应能查到客户");

    const row = list.json.data.rows[0];
    assert.ok(row.contact, "客户应有联系方式");
    assert.ok("lastIp" in row, "列表要带最近下单 IP");
    assert.ok("amount" in row, "累计消费要保留");
    assert.ok(!("status" in row), "没有登录就没有封禁，不该再暴露状态字段");
  });

  await test("封禁接口已经下线", async () => {
    const list = await api("/api/admin/users?page=1&perPage=1", { auth: true });
    const uid = list.json.data.rows[0].id;
    const gone = await api(`/api/admin/users/${uid}/toggle`, { method: "POST", auth: true });
    assert.equal(gone.status, 404, "封禁接口应已移除");
  });

  await test("客户详情返回购买清单与每一笔的下单 IP", async () => {
    const list = await api("/api/admin/users?page=1&perPage=20", { auth: true });
    const row = list.json.data.rows.find((u) => u.orders > 0);
    assert.ok(row, "应有一个下过单的客户");

    const { status, json } = await api(`/api/admin/users/${row.id}`, { auth: true });
    assert.equal(status, 200, JSON.stringify(json));

    assert.ok(json.data.customer.contact, "应返回客户信息");
    assert.ok(json.data.orders.length > 0, "应返回购买记录");
    assert.ok(json.data.ips.length > 0, "应返回用过的 IP 汇总");
    assert.equal(json.data.summary.totalOrders, json.data.orders.length);
    assert.ok(json.data.summary.totalAmount >= 0);

    for (const o of json.data.orders) {
      assert.ok(o.no && o.product, "订单要有编号与商品名");
      assert.ok("ip" in o, "每笔订单都要带下单 IP");
      assert.ok("amount" in o && "status" in o && "time" in o);
    }
  });

  await test("客户列表支持排序", async () => {
    const desc = (await api("/api/admin/users?sort=amount_desc&perPage=20", { auth: true })).json.data.rows;
    for (let i = 1; i < desc.length; i += 1) {
      assert.ok(desc[i - 1].amount >= desc[i].amount, "消费降序被破坏");
    }

    const byOrders = (await api("/api/admin/users?sort=orders_desc&perPage=20", { auth: true })).json.data.rows;
    for (let i = 1; i < byOrders.length; i += 1) {
      assert.ok(byOrders[i - 1].orders >= byOrders[i].orders, "订单数降序被破坏");
    }
  });

  /* ---------------------------------------------------------- 提醒 */

  await test("后台提醒返回新订单与库存预警", async () => {
    const { status, json } = await api("/api/admin/alerts", { auth: true });
    assert.equal(status, 200, JSON.stringify(json));

    assert.ok(json.data.serverTime, "要返回服务器时间，前端据此记住已读位置");
    assert.equal(typeof json.data.unseenOrders, "number");
    assert.ok(Array.isArray(json.data.events));
    assert.ok(Array.isArray(json.data.lowStock));
    assert.ok(typeof json.data.threshold === "number");

    for (const e of json.data.events) {
      assert.ok(["order", "stock"].includes(e.type), `未知事件类型 ${e.type}`);
      assert.ok(e.title && e.target, "事件要有标题与跳转目标");
      assert.ok(["info", "warn", "danger"].includes(e.level));
    }
  });

  await test("后台提醒：since 之前的老订单不会被算作新订单", async () => {
    const all = (await api("/api/admin/alerts", { auth: true })).json.data;

    /* 用一个很久以前的时间当基准，应该能看到全部已付款订单 */
    const past = encodeURIComponent("2020-01-01 00:00:00");
    const fromPast = (await api(`/api/admin/alerts?since=${past}`, { auth: true })).json.data;
    assert.ok(fromPast.unseenOrders > 0, "以很久以前为基准应能看到订单");
    assert.ok(fromPast.unseenAmount > 0, "应统计到金额");

    /* 用一个未来时间当基准，必然没有新订单。
       不用「当前服务器时间」是因为订单时间只精确到秒，
       同一秒内创建的订单会落在基准线上，断言会随执行速度时好时坏。 */
    const future = encodeURIComponent("2099-12-31 23:59:59");
    const fromFuture = (await api(`/api/admin/alerts?since=${future}`, { auth: true })).json.data;
    assert.equal(fromFuture.unseenOrders, 0, "未来基准不该有新订单");
    assert.equal(fromFuture.unseenAmount, 0);
    assert.equal(
      fromFuture.events.filter((e) => e.type === "order").length,
      0,
      "不该再有订单事件"
    );

    /* 库存预警与 since 无关，任何时候都该照常返回 */
    assert.deepEqual(fromFuture.lowStock, all.lowStock, "库存预警不该受已读位置影响");
  });

  await test("库存预警只包含「在架且低于阈值」的商品", async () => {
    const { json } = await api("/api/admin/alerts", { auth: true });
    const list = json.data.lowStock;

    for (const p of list) {
      assert.ok(
        p.stock <= json.data.threshold,
        `${p.id} 库存 ${p.stock} 超过了阈值 ${json.data.threshold}`
      );
      const row = await get("SELECT status, stock FROM products WHERE id = ?", p.id);
      assert.equal(Number(row.status), 1, `${p.id} 已下架，不该出现在预警里`);
      assert.equal(Number(row.stock), p.stock, "预警里的库存数应与数据库一致");
    }

    /* 下架商品即使售罄也不提醒 —— 都不卖了还提醒补货没有意义 */
    const off = await get("SELECT id FROM products WHERE status = 0 AND stock = 0 LIMIT 1");
    if (off) {
      assert.ok(
        !list.some((p) => p.id === off.id),
        `下架且售罄的商品 ${off.id} 不该出现在预警里`
      );
    }
  });

  await test("在架商品售罄时会以最高优先级提醒", async () => {
    const pid = "smoke-empty";
    await api("/api/admin/products", {
      method: "POST", auth: true,
      body: {
        id: pid, name: "预警测试商品（在架无库存）", category: "video", emoji: "🧪",
        price: 1, oldPrice: 0, badge: "", status: 1, specs: ["月卡"],
        desc: "", detail: "", notice: [], tutorial: [],
      },
    });

    const { json } = await api("/api/admin/alerts", { auth: true });
    const found = json.data.lowStock.find((p) => p.id === pid);
    assert.ok(found, "在架且没有可用卡密的商品必须出现在预警里");
    assert.equal(found.soldOut, true);
    assert.equal(found.stock, 0);

    /* 售罄也要在事件流里有一条 danger */
    const event = json.data.events.find((e) => e.target === pid);
    assert.ok(event, "售罄商品应产生一条事件");
    assert.equal(event.level, "danger");
  });

  await test("读取设置不返回密钥明文", async () => {
    const { json } = await api("/api/admin/settings", { auth: true });
    const p = json.data.payment;

    for (const field of ["wxPrivateKey", "wxApiV3Key", "aliPrivateKey"]) {
      assert.equal(p[field], "", `${field} 不应回传明文`);
    }
    assert.equal(typeof p.wxPrivateKeySet, "boolean");
    assert.equal(typeof p.aliPrivateKeySet, "boolean");
    assert.ok(Array.isArray(json.data.announcements));
  });

  await test("支付渠道按「启用」下发，未配置的也在列表里", async () => {
    /* 只打开开关、不填密钥 —— 这正是「后台开了前台却没有」的场景 */
    await api("/api/admin/settings", {
      method: "PUT", auth: true, body: { payment: { wxEnable: 1 } },
    });

    const boot = (await api("/api/public/bootstrap")).json.data;
    const p = boot.settings.payment;

    assert.ok(p.channels.includes("wechat"), `启用了就该下发给前台，实际 ${JSON.stringify(p.channels)}`);
    assert.equal(p.channelReady.wechat, false, "没配好的渠道要带 channelReady=false，前台才好标「暂不可用」");
    assert.ok(p.channels.includes("test"), "测试渠道一直可用");

    /* 真下单还是要被拦住 —— 客户端判断不能当防线 */
    const { status, json } = await api("/api/public/orders", {
      method: "POST",
      body: {
        productId: "p008", spec: "500 点券", qty: 1,
        contact: "ch@example.com", payChannel: "wechat",
      },
    });
    assert.equal(status, 409, "没配好的渠道不能真的下单");

    /* 给买家的话不该把内部缺哪些密钥抖出来 */
    assert.ok(
      !/AppID|私钥|密钥|序列号|配置/.test(json.message),
      `不该向买家泄露配置细节：${json.message}`
    );
    assert.match(json.message, /维护中|暂未开通/, `应是买家看得懂的话：${json.message}`);

    /* 还原，免得影响后面的用例 */
    await api("/api/admin/settings", {
      method: "PUT", auth: true, body: { payment: { wxEnable: 0 } },
    });
  });

  await test("选择未开通的支付渠道会被拒绝", async () => {
    /* 测试环境里微信既没启用也没配置 */
    const { status, json } = await api("/api/public/orders", {
      method: "POST",
      body: {
        productId: "p008", spec: "500 点券", qty: 1,
        contact: "pay@example.com", payChannel: "wechat",
      },
    });
    assert.equal(status, 409);
    assert.match(json.message, /微信支付/, `应点名渠道：${json.message}`);
  });

  await test("【安全】真实渠道的订单不能靠订单号手动标记已付", async () => {
    /* 造一个微信渠道的订单：直接改库模拟「已下单但未支付」 */
    const created = await api("/api/public/orders", {
      method: "POST",
      body: {
        productId: "p008", spec: "500 点券", qty: 1,
        contact: "hack@example.com", payChannel: "test",
      },
    });
    assert.equal(created.status, 200);
    const no = created.json.data.no;

    await run("UPDATE orders SET pay_channel = 'wechat' WHERE order_no = ?", no);

    const { status, json } = await api(`/api/public/orders/${no}/pay`, { method: "POST" });
    assert.equal(status, 409, "真实渠道订单不该允许手动确认支付");
    assert.match(json.message, /真实支付/, `错误信息应说明原因：${json.message}`);

    /* 订单仍是待付款，没有白送卡 */
    const row = await get("SELECT status FROM orders WHERE order_no = ?", no);
    assert.equal(row.status, "待付款", "被拒绝后订单状态不该改变");

    /* 改回测试渠道就能正常确认，确认限制是渠道而非订单本身的问题 */
    await run("UPDATE orders SET pay_channel = 'test' WHERE order_no = ?", no);
    const paid = await api(`/api/public/orders/${no}/pay`, { method: "POST" });
    assert.equal(paid.status, 200, "测试渠道应可正常确认");
  });

  await test("保存设置立即生效", async () => {
    const { status } = await api("/api/admin/settings", {
      method: "PUT", auth: true,
      body: { site: { name: "简卡铺-冒烟" }, trade: { minOrder: 2 } },
    });
    assert.equal(status, 200);

    // 内存缓存应已刷新
    const after = await api("/api/admin/settings", { auth: true });
    assert.equal(after.json.data.site.name, "简卡铺-冒烟");
    assert.equal(after.json.data.trade.minOrder, 2);

    // 前台也应立刻看到新站点名
    const pub = await api("/api/public/bootstrap");
    assert.equal(pub.json.data.settings.site.name, "简卡铺-冒烟");

    await api("/api/admin/settings", {
      method: "PUT", auth: true,
      body: { site: { name: "简卡铺" }, trade: { minOrder: 1 } },
    });
  });

  await test("非法设置值被拒绝", async () => {
    const { status, json } = await api("/api/admin/settings", {
      method: "PUT", auth: true,
      body: { payment: { wxEnable: 0, aliEnable: 0, testEnable: 0 } },
    });
    assert.equal(status, 400, "三种支付方式同时关闭应被拒绝");
    assert.match(json.message, /支付/, `错误信息应说明原因：${json.message}`);

    /* 只关掉微信、留着测试渠道是允许的 */
    const partial = await api("/api/admin/settings", {
      method: "PUT", auth: true,
      body: { payment: { wxEnable: 0, aliEnable: 0, testEnable: 1 } },
    });
    assert.equal(partial.status, 200, "保留测试渠道时应能保存");
  });

  await test("公告保存后前台可见", async () => {
    const before = (await api("/api/public/bootstrap")).json.data.announcements.length;
    assert.ok(before >= 1);

    const settings = (await api("/api/admin/settings", { auth: true })).json.data;
    const list = settings.announcements.map((a) => ({ text: a.text, status: a.status }));
    list.push({ text: "冒烟测试公告", status: 1 });

    const saved = await api("/api/admin/settings", {
      method: "PUT", auth: true, body: { announcements: list },
    });
    assert.equal(saved.status, 200);

    const after = (await api("/api/public/bootstrap")).json.data.announcements;
    assert.equal(after.length, before + 1);
    assert.equal(after[after.length - 1].text, "冒烟测试公告");
  });

  /* ------------------------------------------------------------ 排序 */
  section("列表排序");

  await test("商品按价格升序 / 降序", async () => {
    const asc = (await api("/api/admin/products?sort=price_asc&perPage=50", { auth: true })).json.data.rows;
    const desc = (await api("/api/admin/products?sort=price_desc&perPage=50", { auth: true })).json.data.rows;

    assert.ok(asc.length >= 3, "需要至少 3 个商品才能验证排序");
    for (let i = 1; i < asc.length; i += 1) {
      assert.ok(asc[i - 1].price <= asc[i].price, `升序被破坏：${asc[i - 1].price} > ${asc[i].price}`);
    }
    for (let i = 1; i < desc.length; i += 1) {
      assert.ok(desc[i - 1].price >= desc[i].price, `降序被破坏：${desc[i - 1].price} < ${desc[i].price}`);
    }
    assert.equal(asc[0].id, desc[desc.length - 1].id, "首尾应对称");
  });

  await test("商品按库存与销量排序", async () => {
    const byStock = (await api("/api/admin/products?sort=stock_desc&perPage=50", { auth: true })).json.data.rows;
    for (let i = 1; i < byStock.length; i += 1) {
      assert.ok(byStock[i - 1].stock >= byStock[i].stock, "库存降序被破坏");
    }

    const bySold = (await api("/api/admin/products?sort=sold_desc&perPage=50", { auth: true })).json.data.rows;
    for (let i = 1; i < bySold.length; i += 1) {
      assert.ok(bySold[i - 1].sold >= bySold[i].sold, "销量降序被破坏");
    }
  });

  await test("订单按金额排序", async () => {
    const asc = (await api("/api/admin/orders?sort=amount_asc&perPage=30", { auth: true })).json.data.rows;
    for (let i = 1; i < asc.length; i += 1) {
      assert.ok(asc[i - 1].amount <= asc[i].amount, `金额升序被破坏：${asc[i - 1].amount} > ${asc[i].amount}`);
    }

    const desc = (await api("/api/admin/orders?sort=amount_desc&perPage=30", { auth: true })).json.data.rows;
    for (let i = 1; i < desc.length; i += 1) {
      assert.ok(desc[i - 1].amount >= desc[i].amount, "金额降序被破坏");
    }
  });

  await test("卡密按导入时间与规格排序", async () => {
    const rows = (await api("/api/admin/cards?sort=spec_asc&perPage=30", { auth: true })).json.data.rows;
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(rows[i - 1].spec <= rows[i].spec, `规格升序被破坏：${rows[i - 1].spec} > ${rows[i].spec}`);
    }
  });

  await test("【安全】非法排序参数被安全忽略，不会报错也不会注入", async () => {
    const probes = [
      "id; DROP TABLE cards--",
      "price DESC; DELETE FROM orders",
      "__proto__",
      "constructor",
      "toString",
      "不存在的排序",
      "",
    ];

    const before = Number(await scalar("SELECT COUNT(*) AS c FROM cards"));

    for (const probe of probes) {
      const { status, json } = await api(
        `/api/admin/products?sort=${encodeURIComponent(probe)}&perPage=5`,
        { auth: true }
      );
      assert.equal(status, 200, `排序值「${probe}」不该让接口报错，实际 ${status}`);
      assert.ok(Array.isArray(json.data.rows), "应正常返回列表");
    }

    /* 表还在，数据没被删 */
    const after = Number(await scalar("SELECT COUNT(*) AS c FROM cards"));
    assert.equal(after, before, "卡密表不应被影响");
  });

  /* ------------------------------------------------------------ 导出 */
  section("卡密导出");

  await test("导出 CSV：带 BOM、内容类型正确、含表头", async () => {
    const res = await api("/api/admin/cards/export?productId=p008", { auth: true, raw: true });
    assert.equal(res.status, 200);
    assert.match(
      String(res.headers.get("content-type")),
      /text\/csv/,
      `内容类型应为 CSV，实际 ${res.headers.get("content-type")}`
    );
    assert.match(
      String(res.headers.get("content-disposition")),
      /attachment/,
      "应作为附件下载"
    );

    /* BOM 必须从原始字节看：fetch 的 .text() 会按规范自动剥掉 BOM，
       用它来判断永远看不到，会误报成「没加 BOM」。 */
    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(
      [buf[0], buf[1], buf[2]],
      [0xef, 0xbb, 0xbf],
      "应带 UTF-8 BOM，否则 Excel 打开中文会乱码"
    );

    const text = buf.toString("utf8").replace(/^\uFEFF/, "");
    assert.ok(text.includes("卡密,商品ID,商品名称,规格,状态"), `表头不对：${text.slice(0, 80)}`);
  });

  await test("导出 CSV：内容与当前筛选条件一致", async () => {
    const specs = JSON.parse(String(await scalar("SELECT specs FROM products WHERE id = 'p008'")));
    const spec = specs[0];

    const res = await api(
      `/api/admin/cards/export?productId=p008&spec=${encodeURIComponent(spec)}&status=未售`,
      { auth: true, raw: true }
    );
    const text = await res.text();
    const lines = text.replace("\uFEFF", "").trim().split("\r\n");
    const body = lines.slice(1);

    assert.ok(body.length > 0, "应导出至少一行数据");

    /* 每一行都必须是该商品、该规格、未售 */
    for (const line of body) {
      assert.ok(line.includes("p008"), `导出了别的商品：${line}`);
      assert.ok(line.includes(spec), `导出了别的规格：${line}`);
      assert.ok(line.includes("未售"), `导出了非未售卡密：${line}`);
    }

    /* 数量应与列表接口的总数一致 */
    const list = (await api(
      `/api/admin/cards?productId=p008&spec=${encodeURIComponent(spec)}&status=未售&perPage=1`,
      { auth: true }
    )).json.data;
    assert.equal(body.length, list.total, "导出条数应与列表总数一致");
  });

  await test("导出 CSV：以 = 开头的卡密会被加前缀阻断公式注入", async () => {
    /* 造一条形如公式的卡密 */
    const specs = JSON.parse(String(await scalar("SELECT specs FROM products WHERE id = 'p008'")));
    await api("/api/admin/cards/import", {
      method: "POST", auth: true,
      body: { productId: "p008", spec: specs[0], text: "=1+1" },
    });

    const res = await api(
      `/api/admin/cards/export?productId=p008&keyword=${encodeURIComponent("=1+1")}`,
      { auth: true, raw: true }
    );
    const text = await res.text();
    assert.ok(text.includes("'=1+1"), `公式型卡密应被加上单引号前缀，实际：${text}`);
  });

  /* ------------------------------------------- 联系方式自由填写 */
  section("联系方式不限制格式");

  await test("任意内容都能作为联系方式下单", async () => {
    const samples = [
      "13800001111",
      "buyer@example.com",
      "QQ12345678",
      "微信：kafu-001",
      "随便写点什么",
      "12345",
      "a",
    ];

    for (const contact of samples) {
      const { status, json } = await api("/api/public/orders", {
        method: "POST",
        body: { productId: "p008", spec: "500 点券", qty: 1, contact, payChannel: "test" },
      });
      assert.equal(status, 200, `「${contact}」应能下单，实际 ${status}：${JSON.stringify(json)}`);
      assert.equal(json.data.contact, contact, "联系方式应原样保存");
      /* 清理：取消掉，避免占用库存 */
      await api(`/api/public/orders/${json.data.no}/cancel`, { method: "POST" });
    }
  });

  await test("超长联系方式会被拒绝（防止撑爆列宽）", async () => {
    const { status } = await api("/api/public/orders", {
      method: "POST",
      body: { productId: "p008", spec: "500 点券", qty: 1, contact: "x".repeat(200) },
    });
    assert.equal(status, 400, "超长联系方式应被拒绝");
  });

  await test("支付时不校验联系方式，只认订单号", async () => {
    const created = await api("/api/public/orders", {
      method: "POST",
      body: {
        productId: "p008", spec: "500 点券", qty: 1,
        contact: "随便写的联系方式", payChannel: "test",
      },
    });
    assert.equal(created.status, 200, `下单失败：${JSON.stringify(created.json)}`);

    /* 支付请求体里什么都不带，照样应该成功 */
    const paid = await api(`/api/public/orders/${created.json.data.no}/pay`, { method: "POST" });
    assert.equal(paid.status, 200, `支付不该要求联系方式：${JSON.stringify(paid.json)}`);
    assert.equal(paid.json.data.status, "已发货");
  });

  await test("测试渠道订单返回的支付信息可直接使用", async () => {
    const created = await api("/api/public/orders", {
      method: "POST",
      body: {
        productId: "p008", spec: "500 点券", qty: 1,
        contact: "test-pay@example.com", payChannel: "test",
      },
    });
    assert.equal(created.status, 200);

    const data = created.json.data;
    assert.equal(data.payChannel, "test", "应回传渠道码");
    assert.equal(data.payMethod, "测试支付", "应回传中文标签");
    assert.equal(data.payment.mode, "test", "测试渠道不需要扫码");
    assert.equal(data.payment.qrCode, "", "测试渠道不该有付款码");
    assert.equal(data.payError, "", "测试渠道不该有错误");
    /* 真实渠道才有二维码；测试渠道 qrSvg 应为空 */
    assert.equal(data.qrSvg, "");

    await api(`/api/public/orders/${data.no}/cancel`, { method: "POST" });
  });

  await test("设置接口返回通知分区，且密钥不回传明文", async () => {
    const { json } = await api("/api/admin/settings", { auth: true });
    const n = json.data.notify;
    assert.ok(n, "应返回 notify 分区");
    for (const key of ["smtpHost", "smtpPort", "smtpSecure", "smtpUser", "smtpFrom", "smtpFromName"]) {
      assert.ok(key in n, `缺少邮箱配置项 ${key}`);
    }
    for (const key of ["smsUrl", "smsMethod", "smsBodyType", "smsParams", "smsSuccessText"]) {
      assert.ok(key in n, `缺少短信配置项 ${key}`);
    }
    for (const key of ["mailSubject", "mailBody", "smsBody"]) {
      assert.ok(key in n, `缺少模板 ${key}`);
    }
    assert.equal(n.smtpPass, "", "SMTP 密码不应回传明文");
    assert.equal(n.smsKey, "", "短信密钥不应回传明文");
    assert.equal(typeof n.smtpPassSet, "boolean");
    assert.equal(typeof n.smsKeySet, "boolean");
  });

  await test("通知测试接口未配置时给出可读错误，而不是笼统的 500", async () => {
    /* 原因必须能看出来：「服务器内部错误」会让管理员无从排查是端口错还是授权码过期 */
    for (const [channel, target, keyword] of [
      ["email", "buyer@example.com", /配置|SMTP/],
      ["sms", "13800001111", /配置|短信/],
    ]) {
      const { status, json } = await api("/api/admin/notify/test", {
        method: "POST", auth: true, body: { channel, target },
      });
      assert.ok(status >= 400, `${channel} 未配置时应报错`);
      assert.notEqual(status, 500, `${channel} 不该返回笼统的 500`);
      assert.match(json.message, keyword, `${channel} 的错误信息不可读：${json.message}`);
    }

    const bad = await api("/api/admin/notify/test", {
      method: "POST", auth: true, body: { channel: "wechat", target: "x" },
    });
    assert.equal(bad.status, 400, "非法渠道应被拒绝");
  });

  await test("修改密码：原密码错误被拒 / 新密码过短被拒", async () => {
    const wrong = await api("/api/admin/password", {
      method: "POST", auth: true,
      body: { oldPassword: "definitely-wrong", newPassword: "newpass123" },
    });
    assert.ok(wrong.status >= 400, "原密码错误应被拒绝");

    const short = await api("/api/admin/password", {
      method: "POST", auth: true,
      body: { oldPassword: "123456", newPassword: "123" },
    });
    assert.equal(short.status, 400, "过短的新密码应被拒绝");

    /* 两次失败都不该影响当前会话 */
    const me = await api("/api/admin/me", { auth: true });
    assert.equal(me.status, 200, "失败的改密不应踢掉当前会话");
  });

  /* ---------------------------------------------------------- 批量操作 */
  section("批量操作");

  await test("批量上下架商品", async () => {
    /* 造三个商品，此时都是上架状态 */
    const ids = ["batch-a", "batch-b", "batch-c"];
    for (const id of ids) {
      await api("/api/admin/products", {
        method: "POST", auth: true,
        body: {
          id, name: `批量测试 ${id}`, category: "video", emoji: "🧪",
          price: 1, oldPrice: 0, badge: "", status: 1, specs: ["月卡"],
          desc: "", detail: "", notice: [], tutorial: [],
        },
      });
    }

    const off = await api("/api/admin/products/batch", {
      method: "POST", auth: true, body: { ids, action: "off" },
    });
    assert.equal(off.status, 200, JSON.stringify(off.json));
    assert.equal(off.json.data.affected, 3);
    assert.deepEqual(off.json.data.skipped, []);

    for (const id of ids) {
      const row = await get("SELECT status FROM products WHERE id = ?", id);
      assert.equal(Number(row.status), 0, `${id} 应已下架`);
    }

    /* 全部下架后再全部上架 */
    const on = await api("/api/admin/products/batch", {
      method: "POST", auth: true, body: { ids, action: "on" },
    });
    assert.equal(on.json.data.affected, 3);
    for (const id of ids) {
      const row = await get("SELECT status FROM products WHERE id = ?", id);
      assert.equal(Number(row.status), 1, `${id} 应已上架`);
    }

    /* 清理 */
    const del = await api("/api/admin/products/batch", {
      method: "POST", auth: true, body: { ids, action: "delete" },
    });
    assert.equal(del.json.data.affected, 3);
    for (const id of ids) {
      assert.equal(await get("SELECT id FROM products WHERE id = ?", id), undefined);
    }
  });

  await test("批量上架是「置为目标状态」而不是逐个切换", async () => {
    /* 这是批量操作最容易踩的坑：用户勾了三个、其中两个已上架一个已下架，
       如果按「切换」处理，结果会变成两个下架一个上架，跟预期完全相反。 */
    const ids = ["batch-x", "batch-y"];
    for (const [i, id] of ids.entries()) {
      await api("/api/admin/products", {
        method: "POST", auth: true,
        body: {
          id, name: `状态测试 ${id}`, category: "video", emoji: "🧪",
          price: 1, oldPrice: 0, badge: "", status: i === 0 ? 1 : 0, specs: ["月卡"],
          desc: "", detail: "", notice: [], tutorial: [],
        },
      });
    }

    await api("/api/admin/products/batch", {
      method: "POST", auth: true, body: { ids, action: "on" },
    });

    for (const id of ids) {
      const row = await get("SELECT status FROM products WHERE id = ?", id);
      assert.equal(Number(row.status), 1, `${id} 不管原来什么状态，都该变成上架`);
    }

    await api("/api/admin/products/batch", {
      method: "POST", auth: true, body: { ids, action: "delete" },
    });
  });

  await test("批量操作里单个失败不影响其它", async () => {
    /* 造一个「还有待付款订单」的商品 —— 它会删不掉，但不该连累别人 */
    const stuck = "batch-stuck";
    const okOne = "batch-ok";
    for (const id of [stuck, okOne]) {
      await api("/api/admin/products", {
        method: "POST", auth: true,
        body: {
          id, name: `批量失败测试 ${id}`, category: "video", emoji: "🧪",
          price: 1, oldPrice: 0, badge: "", status: 1, specs: ["月卡"],
          desc: "", detail: "", notice: [], tutorial: [],
        },
      });
      await api("/api/admin/cards/import", {
        method: "POST", auth: true,
        body: { productId: id, spec: "月卡", text: `STUCK-${id}-1` },
      });
    }

    /* 给 stuck 挂一笔待付款订单 */
    const order = await api("/api/public/orders", {
      method: "POST",
      body: {
        productId: stuck, spec: "月卡", qty: 1,
        contact: "batch@example.com", payChannel: "test",
      },
    });
    assert.equal(order.status, 200);

    const result = await api("/api/admin/products/batch", {
      method: "POST", auth: true, body: { ids: [stuck, okOne], action: "delete" },
    });
    assert.equal(result.status, 200);
    assert.equal(result.json.data.affected, 1, "能删的那个应该删掉了");
    assert.equal(result.json.data.skipped.length, 1, "删不掉的那个应被记录");
    assert.match(result.json.data.skipped[0], /batch-stuck/, "失败项要指明是哪个商品");

    /* 清理 */
    await api(`/api/public/orders/${order.json.data.no}/cancel`, { method: "POST" });
    await api("/api/admin/products/batch", {
      method: "POST", auth: true, body: { ids: [stuck], action: "delete" },
    });
  });

  await test("批量操作参数校验", async () => {
    const empty = await api("/api/admin/products/batch", {
      method: "POST", auth: true, body: { ids: [], action: "off" },
    });
    assert.equal(empty.status, 400, "空列表应被拒绝");

    const badAction = await api("/api/admin/products/batch", {
      method: "POST", auth: true, body: { ids: ["p001"], action: "explode" },
    });
    assert.equal(badAction.status, 400, "非法 action 应被拒绝");
  });

  await test("批量删除卡密会跳过已售的", async () => {
    const pid = "batch-cards";
    await api("/api/admin/products", {
      method: "POST", auth: true,
      body: {
        id: pid, name: "批量删卡测试", category: "video", emoji: "🧪",
        price: 1, oldPrice: 0, badge: "", status: 1, specs: ["月卡"],
        desc: "", detail: "", notice: [], tutorial: [],
      },
    });
    await api("/api/admin/cards/import", {
      method: "POST", auth: true,
      body: { productId: pid, spec: "月卡", text: "BC-1\nBC-2\nBC-3\nBC-4" },
    });

    /* 卖掉一张，制造一条「已售」 */
    const order = await api("/api/public/orders", {
      method: "POST",
      body: { productId: pid, spec: "月卡", qty: 1, contact: "bc@example.com", payChannel: "test" },
    });
    await api(`/api/public/orders/${order.json.data.no}/pay`, { method: "POST" });

    const cardRows = await all("SELECT id, status FROM cards WHERE product_id = ?", pid);
    assert.equal(cardRows.length, 4);
    const soldId = cardRows.find((c) => c.status === "已售").id;

    const result = await api("/api/admin/cards/batch-delete", {
      method: "POST", auth: true, body: { ids: cardRows.map((c) => Number(c.id)) },
    });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.data.affected, 3, "三条未售应被删除");
    assert.equal(result.json.data.skipped, 1, "已售的那条应被跳过");

    /* 已售卡密必须还在 —— 删了就查不到当初发的是什么了 */
    const survivor = await get("SELECT id, status FROM cards WHERE id = ?", soldId);
    assert.ok(survivor, "已售卡密不能被删除");
    assert.equal(survivor.status, "已售");

    /* 库存计数要跟着回写 */
    const product = await get("SELECT stock FROM products WHERE id = ?", pid);
    assert.equal(Number(product.stock), 0, "删完后该商品可用库存应为 0");

    await api("/api/admin/products/batch", {
      method: "POST", auth: true, body: { ids: [pid], action: "delete" },
    });
  });

  await test("批量删除卡密的参数校验", async () => {
    const empty = await api("/api/admin/cards/batch-delete", {
      method: "POST", auth: true, body: { ids: [] },
    });
    assert.equal(empty.status, 400);

    const garbage = await api("/api/admin/cards/batch-delete", {
      method: "POST", auth: true, body: { ids: ["abc", null, -1, 0] },
    });
    assert.equal(garbage.status, 400, "全是无效 ID 时应被拒绝");
  });

  await test("设置接口返回每个支付渠道的就绪状态", async () => {
    const { json } = await api("/api/admin/settings", { auth: true });
    const p = json.data.payment;

    assert.ok(p.channelStatus, "应返回 channelStatus —— 后台靠它解释「为什么前台没有」");
    assert.ok(Array.isArray(p.availableChannels), "应返回前台实际可用的渠道列表");

    for (const code of ["wechat", "alipay", "test"]) {
      const s = p.channelStatus[code];
      assert.ok(s, `缺少 ${code} 的状态`);
      assert.equal(typeof s.enabled, "boolean", `${code}.enabled 类型不对`);
      assert.equal(typeof s.configured, "boolean", `${code}.configured 类型不对`);
      assert.equal(typeof s.ready, "boolean", `${code}.ready 类型不对`);
      assert.ok(Array.isArray(s.missing), `${code}.missing 应是数组`);

      /* ready 必须严格等于 enabled && configured —— 前台就是照这个判断的 */
      assert.equal(s.ready, s.enabled && s.configured, `${code} 的 ready 与 enabled/configured 不一致`);
      /* 已就绪的渠道不该报「缺什么」 */
      if (s.ready) assert.equal(s.missing.length, 0, `${code} 已就绪却仍报告缺失项`);
    }

    /* availableChannels 必须与 channelStatus 里 ready 的渠道完全一致 */
    const readyCodes = Object.entries(p.channelStatus)
      .filter(([, s]) => s.ready)
      .map(([code]) => code)
      .sort();
    assert.deepEqual(
      [...p.availableChannels].sort(),
      readyCodes,
      "availableChannels 与 channelStatus 不一致，后台显示会骗人"
    );
  });

  await test("未配置完整时，状态里会列出具体缺哪些项", async () => {
    const { json } = await api("/api/admin/settings", { auth: true });
    const wx = json.data.payment.channelStatus.wechat;

    /* 这个环境里微信没配密钥，应该明确列出缺什么而不是笼统的「未配置」 */
    if (!wx.configured) {
      assert.ok(wx.missing.length > 0, "应列出缺失的配置项");
      assert.ok(
        wx.missing.some((m) => /AppID|私钥|密钥|序列号/.test(m)),
        `缺失项应是人能看懂的名称，实际：${JSON.stringify(wx.missing)}`
      );
    }
  });

  await test("操作日志已记录后台动作", async () => {
    const { json } = await api("/api/admin/logs?page=1&perPage=20", { auth: true });
    assert.ok(json.data.rows.length > 0, "应能读到日志列表");

    /* 不依赖分页位置：直接查库确认登录日志已写入，
       否则一旦前面新增了别的操作，登录记录就会被挤出第一页导致误报 */
    const loginLog = await get(
      "SELECT action, actor FROM logs WHERE action = '登录后台' ORDER BY id DESC LIMIT 1"
    );
    assert.ok(loginLog, "应记录登录日志");
    assert.equal(loginLog.actor, "admin");
  });

  await test("退出登录后会话失效", async () => {
    const out = await api("/api/admin/logout", { method: "POST", auth: true });
    assert.equal(out.status, 200);
    const after = await api("/api/admin/dashboard", { auth: true });
    assert.equal(after.status, 401, "退出后不应能继续访问");
  });
} finally {
  await new Promise((r) => siteServer.close(r));
  await new Promise((r) => adminServer.close(r));
  await closePool();
}

/* -------------------------------------------------------------------- 汇总 */

console.log("");
console.log("─".repeat(46));
if (failed === 0) {
  console.log(`\u001b[32m全部通过\u001b[0m  ${passed} 项`);
} else {
  console.log(`\u001b[31m失败 ${failed} 项\u001b[0m / 通过 ${passed} 项`);
  for (const f of failures) {
    console.log(`\n· ${f.name}\n  ${f.err.stack?.split("\n").slice(0, 3).join("\n  ")}`);
  }
}
console.log("─".repeat(46));
process.exit(failed === 0 ? 0 : 1);
