/**
 * 简卡铺 · 后台 API（由后台服务 2002 端口提供）
 * ---------------------------------------------------------------------------
 * 前缀 /api/admin。除登录与验证码外，全部要求有效会话。
 * 所有写操作都会写入操作日志。
 */
import { ok, json, buildCookie } from "../http/respond.js";
import { unauthorized, notFound, badRequest, upstream } from "../lib/errors.js";
import { str, int, lines, oneOf } from "../lib/validate.js";
import { toCsv } from "../lib/csv.js";
import { nowStr } from "../lib/time.js";
import { logger, getRuntimeLogs } from "../lib/logger.js";
import { all, run, tx } from "../db.js";
import config from "../config.js";
import * as authService from "../services/auth.js";
import * as settingsService from "../services/settings.js";
import * as categoryService from "../services/category.js";
import * as productService from "../services/product.js";
import * as orderService from "../services/order.js";
import * as cardService from "../services/card.js";
import * as userService from "../services/user.js";
import * as logService from "../services/log.js";
import * as statsService from "../services/stats.js";
import * as notifyService from "../services/notify.js";
import * as alertsService from "../services/alerts.js";

/** 取会话；失败抛 401 */
async function requireAuth(ctx) {
  if (ctx.session) return ctx.session;
  const session = await authService.getSession(ctx.token);
  if (!session) throw unauthorized("登录状态已失效，请重新登录");
  ctx.session = session;
  return session;
}

/** 记一条操作日志 */
async function audit(ctx, session, action, target, result = "成功") {
  await logService.write({
    actor: session?.admin?.username || "system",
    action,
    target,
    ip: ctx.ip,
    result,
  });
}

/** 设置会话 Cookie 的响应头 */
function sessionCookie(token, maxAgeSeconds) {
  return {
    "Set-Cookie": buildCookie(config.session.cookieName, token, {
      maxAge: maxAgeSeconds,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    }),
  };
}

function clearCookieHeader() {
  return {
    "Set-Cookie": buildCookie(config.session.cookieName, "", {
      maxAge: 0,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    }),
  };
}

/** 解析分页参数 */
function paging(ctx, defaultPerPage = 10) {
  const page = Math.max(1, Number(ctx.query.get("page") || 1) || 1);
  const perPageRaw = Number(ctx.query.get("perPage") || defaultPerPage) || defaultPerPage;
  const perPage = Math.min(100, Math.max(1, perPageRaw));
  return { page, perPage };
}

export function registerAdminRoutes(router) {
  /* ------------------------------------------------------------ 登录相关 */

  router.get("/api/admin/captcha", async (ctx) => {
    ok(ctx.res, await authService.createCaptcha());
  });

  router.post("/api/admin/login", async (ctx) => {
    const result = await authService.login({
      username: ctx.body?.username,
      password: ctx.body?.password,
      captchaId: ctx.body?.captchaId,
      captchaCode: ctx.body?.captchaCode,
      ip: ctx.ip,
      userAgent: ctx.req.headers["user-agent"] || "",
    });

    await logService.write({
      actor: result.admin.username,
      action: "登录后台",
      target: "—",
      ip: ctx.ip,
      result: "成功",
    });

    json(
      ctx.res,
      200,
      { ok: true, data: { admin: result.admin } },
      sessionCookie(result.token, result.ttlSeconds)
    );
  });

  router.post("/api/admin/logout", async (ctx) => {
    const session = await authService.getSession(ctx.token);
    await authService.destroySession(ctx.token);
    if (session) {
      await logService.write({
        actor: session.admin.username,
        action: "退出登录",
        target: "—",
        ip: ctx.ip,
        result: "成功",
      });
    }
    json(ctx.res, 200, { ok: true, data: { loggedOut: true } }, clearCookieHeader());
  });

  router.get("/api/admin/me", async (ctx) => {
    const session = await requireAuth(ctx);
    ok(ctx.res, { admin: session.admin });
  });

  router.post("/api/admin/password", async (ctx) => {
    const session = await requireAuth(ctx);
    await authService.changePassword(session.admin.id, {
      oldPassword: ctx.body?.oldPassword,
      newPassword: ctx.body?.newPassword,
    });
    await audit(ctx, session, "修改管理员密码", session.admin.username);
    json(ctx.res, 200, { ok: true, data: { changed: true } }, clearCookieHeader());
  });

  router.get("/api/admin/admins", async (ctx) => {
    await requireAuth(ctx);
    ok(ctx.res, { rows: await authService.listAdmins() });
  });

  /* -------------------------------------------------------------- 概览 */

  router.get("/api/admin/dashboard", async (ctx) => {
    await requireAuth(ctx);
    ok(ctx.res, await statsService.overview());
  });

  /* -------------------------------------------------------------- 商品 */

  router.get("/api/admin/products", async (ctx) => {
    await requireAuth(ctx);
    const { page, perPage } = paging(ctx, 8);
    ok(
      ctx.res,
      await productService.list({
        keyword: ctx.query.get("keyword") || "",
        category: ctx.query.get("category") || "",
        status: ctx.query.get("status") ?? "",
        sort: ctx.query.get("sort") || "default",
        page,
        perPage,
      })
    );
  });

  router.get("/api/admin/products/:id", async (ctx) => {
    await requireAuth(ctx);
    const product = await productService.find(ctx.params.id);
    if (!product) throw notFound("商品不存在");
    ok(ctx.res, product);
  });

  router.post("/api/admin/products", async (ctx) => {
    const session = await requireAuth(ctx);
    const product = await productService.create(ctx.body || {});
    await audit(ctx, session, "新增商品", product.name);
    ok(ctx.res, product, 201);
  });

  router.put("/api/admin/products/:id", async (ctx) => {
    const session = await requireAuth(ctx);
    const product = await productService.update(ctx.params.id, ctx.body || {});
    await audit(ctx, session, "编辑商品", product.name);
    ok(ctx.res, product);
  });

  router.post("/api/admin/products/:id/toggle", async (ctx) => {
    const session = await requireAuth(ctx);
    const product = await productService.find(ctx.params.id);
    if (!product) throw notFound("商品不存在");
    const next = await productService.toggleStatus(ctx.params.id);
    await audit(ctx, session, next ? "上架商品" : "下架商品", product.name);
    ok(ctx.res, { id: ctx.params.id, status: next });
  });

  /**
   * 批量操作商品。
   * 单个商品失败不影响其它，失败原因一并返回。
   */
  router.post("/api/admin/products/batch", async (ctx) => {
    const session = await requireAuth(ctx);
    const ids = Array.isArray(ctx.body?.ids) ? ctx.body.ids : [];
    const action = oneOf(ctx.body?.action, ["on", "off", "delete"], { field: "批量操作" });

    const result = await productService.batch(ids, action);

    const label = { on: "批量上架商品", off: "批量下架商品", delete: "批量删除商品" }[action];
    await audit(
      ctx, session, label,
      `${result.affected} 个${result.skipped.length ? `（${result.skipped.length} 个失败）` : ""}`
    );
    ok(ctx.res, result);
  });

  router.delete("/api/admin/products/:id", async (ctx) => {
    const session = await requireAuth(ctx);
    const product = await productService.find(ctx.params.id);
    if (!product) throw notFound("商品不存在");
    await productService.remove(ctx.params.id);
    await audit(ctx, session, "删除商品", product.name);
    ok(ctx.res, { id: ctx.params.id, deleted: true });
  });

  /* -------------------------------------------------------------- 分类 */

  router.get("/api/admin/categories", async (ctx) => {
    await requireAuth(ctx);
    ok(ctx.res, { rows: await categoryService.list() });
  });

  router.post("/api/admin/categories", async (ctx) => {
    const session = await requireAuth(ctx);
    const category = await categoryService.create(ctx.body || {});
    await audit(ctx, session, "新增分类", category.name);
    ok(ctx.res, category, 201);
  });

  router.put("/api/admin/categories/:id", async (ctx) => {
    const session = await requireAuth(ctx);
    const category = await categoryService.update(ctx.params.id, ctx.body || {});
    await audit(ctx, session, "编辑分类", category.name);
    ok(ctx.res, category);
  });

  router.delete("/api/admin/categories/:id", async (ctx) => {
    const session = await requireAuth(ctx);
    const category = await categoryService.find(ctx.params.id);
    if (!category) throw notFound("分类不存在");
    await categoryService.remove(ctx.params.id);
    await audit(ctx, session, "删除分类", category.name);
    ok(ctx.res, { id: ctx.params.id, deleted: true });
  });

  /* -------------------------------------------------------------- 订单 */

  router.get("/api/admin/orders/stats", async (ctx) => {
    await requireAuth(ctx);
    ok(ctx.res, await orderService.stats());
  });

  router.get("/api/admin/orders", async (ctx) => {
    await requireAuth(ctx);
    const { page, perPage } = paging(ctx, 8);
    ok(
      ctx.res,
      await orderService.list({
        keyword: ctx.query.get("keyword") || "",
        status: ctx.query.get("status") || "",
        pay: ctx.query.get("pay") || "",
        sort: ctx.query.get("sort") || "default",
        page,
        perPage,
      })
    );
  });

  router.get("/api/admin/orders/:no", async (ctx) => {
    await requireAuth(ctx);
    const order = await orderService.findRowByNo(ctx.params.no);
    if (!order) throw notFound("订单不存在");
    ok(ctx.res, await orderService.toAdmin(order));
  });

  router.post("/api/admin/orders/:no/resend", async (ctx) => {
    const session = await requireAuth(ctx);
    const order = await orderService.resend(ctx.params.no, {
      actor: session.admin.username,
      ip: ctx.ip,
    });
    await audit(ctx, session, "补发卡密", ctx.params.no);
    ok(ctx.res, order);
  });

  router.post("/api/admin/orders/:no/close", async (ctx) => {
    const session = await requireAuth(ctx);
    const order = await orderService.close(ctx.params.no, {
      actor: session.admin.username,
      ip: ctx.ip,
    });
    await audit(ctx, session, "关闭订单", ctx.params.no);
    ok(ctx.res, order);
  });

  router.post("/api/admin/orders/:no/refund", async (ctx) => {
    const session = await requireAuth(ctx);
    const order = await orderService.refund(ctx.params.no, {
      actor: session.admin.username,
      ip: ctx.ip,
    });
    await audit(ctx, session, "订单退款", ctx.params.no);
    ok(ctx.res, order);
  });

  router.post("/api/admin/orders/batch", async (ctx) => {
    const session = await requireAuth(ctx);
    const action = oneOf(ctx.body?.action, ["close", "resend"], { field: "批量操作类型" });
    const result = await orderService.batch(ctx.body?.ids ?? [], action, {
      actor: session.admin.username,
      ip: ctx.ip,
    });
    await audit(
      ctx,
      session,
      action === "close" ? "批量关闭订单" : "批量补发订单",
      `${result.affected} 成功${result.skipped.length ? ` / ${result.skipped.length} 失败` : ""}`
    );
    ok(ctx.res, result);
  });

  /* -------------------------------------------------------------- 卡密 */

  router.get("/api/admin/cards/stats", async (ctx) => {
    await requireAuth(ctx);
    ok(
      ctx.res,
      await cardService.stats({
        productId: ctx.query.get("productId") || ctx.query.get("product") || "",
      })
    );
  });

  router.get("/api/admin/cards", async (ctx) => {
    await requireAuth(ctx);
    const { page, perPage } = paging(ctx, 10);
    ok(
      ctx.res,
      await cardService.list({
        productId: ctx.query.get("productId") || ctx.query.get("product") || "",
        spec: ctx.query.get("spec") || "",
        keyword: ctx.query.get("keyword") || "",
        status: ctx.query.get("status") || "",
        sort: ctx.query.get("sort") || "default",
        page,
        perPage,
      })
    );
  });

  router.post("/api/admin/cards/import", async (ctx) => {
    const session = await requireAuth(ctx);
    const productId = str(ctx.body?.productId, { field: "商品", max: 40 });
    /* 卡密必须指明归属规格；商品无规格时留空即可 */
    const spec = String(ctx.body?.spec ?? "").trim();

    /* 支持两种提交：文本域多行（text）或数组（secrets） */
    const raw = ctx.body?.secrets ?? ctx.body?.text ?? "";
    const list = lines(raw, 5000);
    if (list.length === 0) throw badRequest("请粘贴至少一条卡密");

    const result = await cardService.importCards(productId, list, spec);
    const product = await productService.find(productId);
    await audit(
      ctx,
      session,
      "批量导入卡密",
      `${product?.name || productId}${result.spec ? ` · ${result.spec}` : ""} +${result.imported}` +
        (result.duplicated ? `（重复 ${result.duplicated}）` : "")
    );
    ok(ctx.res, { ...result, spec: result.spec, stock: result.stock });
  });

  /**
   * 卡密导出 CSV。
   * 复用列表页的筛选条件，导出的是「当前看到的这一批」，不是全库。
   */
  router.get("/api/admin/cards/export", async (ctx) => {
    const session = await requireAuth(ctx);

    const result = await cardService.exportRows({
      productId: ctx.query.get("productId") || ctx.query.get("product") || "",
      spec: ctx.query.get("spec") || "",
      keyword: ctx.query.get("keyword") || "",
      status: ctx.query.get("status") || "",
      sort: ctx.query.get("sort") || "default",
    });

    const csv = toCsv(result.rows, [
      { label: "卡密", value: (r) => r.key },
      { label: "商品ID", value: (r) => r.product },
      { label: "商品名称", value: (r) => r.productName },
      { label: "规格", value: (r) => r.spec },
      { label: "状态", value: (r) => r.status },
      { label: "导入时间", value: (r) => r.importedAt },
      { label: "售出时间", value: (r) => r.soldAt },
      { label: "关联订单", value: (r) => r.order },
    ]);

    const stamp = nowStr().replace(/[: ]/g, "-");
    const filename = `卡密导出-${stamp}.csv`;

    await audit(
      ctx,
      session,
      "导出卡密",
      `${result.rows.length} 条${result.truncated ? "（已截断）" : ""}`
    );

    ctx.res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      /* filename* 用 RFC 5987 编码，中文文件名才不会乱码 */
      "Content-Disposition":
        `attachment; filename="cards-${stamp}.csv"; ` +
        `filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    });
    /* 前置 BOM：不加的话 Excel 打开中文会乱码 */
    ctx.res.end(`\uFEFF${csv}`);
  });

  /** 批量删除卡密；已售的会被跳过，保留订单追溯 */
  router.post("/api/admin/cards/batch-delete", async (ctx) => {
    const session = await requireAuth(ctx);
    const ids = Array.isArray(ctx.body?.ids) ? ctx.body.ids : [];

    const result = await cardService.batchRemove(ids);
    await audit(
      ctx, session, "批量删除卡密",
      `删除 ${result.affected} 条${result.skipped ? `，跳过已售 ${result.skipped} 条` : ""}`
    );
    ok(ctx.res, result);
  });

  router.delete("/api/admin/cards/:id", async (ctx) => {
    const session = await requireAuth(ctx);
    const cardId = int(ctx.params.id, { field: "卡密 ID", min: 1 });
    await cardService.remove(cardId);
    await audit(ctx, session, "删除卡密", `#${cardId}`);
    ok(ctx.res, { id: cardId, deleted: true });
  });

  /* ------------------------------------------------------------ 客户 */

  /*
   * 本站客户 = 下单时填的联系方式，没有注册登录，
   * 所以**不提供封禁功能**——封了也没意义，换个联系方式照样能买。
   * 后台要做的只有「查」：查他买过什么、从哪个 IP 买的。
   */

  router.get("/api/admin/users/stats", async (ctx) => {
    await requireAuth(ctx);
    ok(ctx.res, await userService.stats());
  });

  router.get("/api/admin/users", async (ctx) => {
    await requireAuth(ctx);
    const { page, perPage } = paging(ctx, 8);
    ok(
      ctx.res,
      await userService.list({
        keyword: ctx.query.get("keyword") || "",
        sort: ctx.query.get("sort") || "default",
        page,
        perPage,
      })
    );
  });

  /** 客户详情：基本信息 + 消费汇总 + 逐笔订单（含下单 IP） */
  router.get("/api/admin/users/:uid", async (ctx) => {
    await requireAuth(ctx);
    const uid = str(ctx.params.uid, { field: "客户 ID", max: 40 });
    ok(ctx.res, await userService.detail(uid));
  });

  router.post("/api/admin/users/batch-delete", async (ctx) => {
    const session = await requireAuth(ctx);
    const result = await userService.batchRemove(ctx.body?.ids ?? []);
    await audit(ctx, session, "批量删除客户档案", `${result.affected} 条`);
    ok(ctx.res, result);
  });

  /* ------------------------------------------------------------ 提醒 */

  /**
   * 后台顶栏铃铛的事件流。
   * since 由浏览器保存，实现「上次看到哪里」而不必建已读表。
   */
  router.get("/api/admin/alerts", async (ctx) => {
    await requireAuth(ctx);
    ok(
      ctx.res,
      await alertsService.feed({
        since: ctx.query.get("since") || "",
      })
    );
  });

  /* -------------------------------------------------------------- 设置 */

  router.get("/api/admin/settings", async (ctx) => {
    await requireAuth(ctx);
    const announcements = await all(
      "SELECT id, text, status FROM announcements ORDER BY sort ASC, id ASC"
    );
    ok(ctx.res, { ...settingsService.toApi(), announcements });
  });

  router.put("/api/admin/settings", async (ctx) => {
    const session = await requireAuth(ctx);
    const body = ctx.body || {};

    const changed = await settingsService.save({
      site: body.site,
      trade: body.trade,
      payment: body.payment,
      seo: body.seo,
      security: body.security,
      notify: body.notify,
    });

    /* 公告：整体覆盖式保存 */
    if (Array.isArray(body.announcements)) {
      await tx(async () => {
        await run("DELETE FROM announcements");
        let sort = 0;
        for (const item of body.announcements) {
          const text = String(item?.text ?? "").trim();
          if (!text) continue;
          await run(
            "INSERT INTO announcements (text, status, sort) VALUES (?, ?, ?)",
            text.slice(0, 200),
            item?.status ? 1 : 0,
            sort
          );
          sort += 1;
        }
      });
      changed.push("announcements");
    }

    await audit(
      ctx,
      session,
      "修改系统设置",
      changed.length > 6 ? `${changed.length} 项` : changed.join(", ")
    );
    ok(ctx.res, { changed });
  });

  /* -------------------------------------------------------------- 日志 */

  /**
   * 发送测试通知。
   * 这里**故意把错误抛给前端**，管理员才能看到真实的失败原因
   * （连不上 SMTP、网关返回错误等），而不是一个笼统的「发送失败」。
   */
  router.post("/api/admin/notify/test", async (ctx) => {
    const session = await requireAuth(ctx);
    const channel = oneOf(ctx.body?.channel, ["email", "sms"], { field: "通知渠道" });
    const target = str(ctx.body?.target, { field: "接收地址", max: 120 });

    let result;
    try {
      result = await notifyService.sendTest(channel, target);
    } catch (err) {
      /* 把真实原因回给管理员：是端口不对、授权码过期还是网关欠费，
         只有原样透出错误信息才排查得了。默认的 500 会把原因吞掉。
         同时写入系统日志缓冲，后台「系统日志」页可查。 */
      logger.error(`通知测试失败（${channel} → ${target}）`, err);
      throw upstream(
        `${channel === "email" ? "邮件" : "短信"}发送失败：${err.message}`
      );
    }

    await audit(ctx, session, "发送通知测试", `${channel} → ${target}`);
    ok(ctx.res, { sent: true, channel, target, response: result?.response ?? "" });
  });

  router.get("/api/admin/logs", async (ctx) => {
    await requireAuth(ctx);
    const { page, perPage } = paging(ctx, 10);
    ok(
      ctx.res,
      await logService.list({
        keyword: ctx.query.get("keyword") || "",
        result: ctx.query.get("result") || "",
        page,
        perPage,
      })
    );
  });

  /* ------------------------------------------------------------ 系统日志 */

  /* 内存缓冲的运行时日志：启动任务、定时清理、通知发送、接口异常等。
     与上面的「操作日志」（管理员写操作审计）互补。 */
  router.get("/api/admin/syslogs", async (ctx) => {
    await requireAuth(ctx);
    const limit = Math.min(500, Math.max(1, Number(ctx.query.get("limit") || 200) || 200));
    ok(ctx.res, { logs: getRuntimeLogs(limit) });
  });
}

export default registerAdminRoutes;
