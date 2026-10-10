/**
 * 简卡铺 · 前台 API（由前台服务 2001 端口提供）
 * ---------------------------------------------------------------------------
 * 前缀 /api/public，全部无需登录。
 *
 * 支付：
 *   · 真实渠道（微信支付 / 支付宝）由网关回调驱动，
 *     回调地址是 POST /api/public/pay/notify/{wechat|alipay}，**验签通过**才会发货。
 *   · 测试渠道不联外网，允许前台点一下确认成功。
 *   · POST /api/public/orders/:no/pay 只对测试渠道开放，
 *     真实渠道调用会直接拒绝 —— 否则拿个订单号就能免费领卡。
 */
import { ok, json } from "../http/respond.js";
import { notFound, badRequest } from "../lib/errors.js";
import { str } from "../lib/validate.js";
import { all } from "../db.js";
import { toSvg } from "../lib/qrcode.js";
import config from "../config.js";
import { logger } from "../lib/logger.js";
import * as settingsService from "../services/settings.js";
import * as categoryService from "../services/category.js";
import * as productService from "../services/product.js";
import * as orderService from "../services/order.js";
import * as paymentService from "../services/payment.js";
import * as wechatpay from "../lib/wechatpay.js";

/** 启用中的公告 */
async function activeAnnouncements() {
  return all("SELECT id, text FROM announcements WHERE status = 1 ORDER BY sort ASC, id ASC");
}

/**
 * 统一处理支付回调：校验 → 核对金额 → 发货 → 应答。
 *
 * 金额核对不能省：网关只会告诉我们「这笔单付了多少钱」，
 * 如果有人用改价工具付了 1 分钱，不核对就会照常发卡。
 *
 * @param {object} ctx
 * @param {string} channel
 * @param {{outTradeNo:string, paid:boolean, amount:number, tradeState:string}} parsed
 * @param {string} okBody 成功时应答给网关的内容
 * @param {string} failBody 失败时应答的内容（网关据此决定是否重试）
 */
async function handleNotify(ctx, channel, parsed, okBody, failBody) {
  const reply = (body, status = 200) => {
    ctx.res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    ctx.res.end(body);
  };

  try {
    if (!parsed.outTradeNo) throw new Error("回调里没有订单号");

    if (!parsed.paid) {
      /* 未支付状态的通知照常应答，否则网关会一直重推 */
      logger.info(`${channel} 回调：订单 ${parsed.outTradeNo} 状态 ${parsed.tradeState}，暂不发货`);
      reply(okBody);
      return;
    }

    const order = await orderService.findRowByNo(parsed.outTradeNo);
    if (!order) throw new Error(`回调对应的订单不存在：${parsed.outTradeNo}`);

    if (!paymentService.amountMatches(order.amount, parsed.amount)) {
      throw new Error(`金额不符：应付 ¥${order.amount}，实付 ¥${parsed.amount}`);
    }

    await orderService.markPaid(order.order_no, { ip: ctx.ip, actor: `${channel} 回调` });
    logger.info(`${channel} 回调已完成发货：${order.order_no}`);
    reply(okBody);
  } catch (err) {
    logger.error(`${channel} 回调处理失败：${err.message}`);
    reply(failBody, 500);
  }
}

/**
 * 给订单补上前台展示所需的字段。
 *
 * 二维码内容来自支付渠道（微信 code_url / 支付宝 qr_code），
 * 服务端只负责把它渲染成 SVG —— 真实渠道的二维码是**付款码**，
 * 不是本站的查单链接。
 */
function decorate(order, extra = {}) {
  const queryUrl = `${config.servers.site.baseUrl}/query?no=${encodeURIComponent(order.no)}`;
  const pending = order.status === "待付款";
  const qrCode = extra.qrCode || "";

  return {
    ...order,
    /* 查单页地址，用于「前往查询订单」按钮 */
    payUrl: queryUrl,
    /** 待付款且渠道给了付款码时才渲染二维码 */
    qrSvg: pending && qrCode ? toSvg(qrCode, { scale: 4, margin: 3 }) : "",
    qrPayload: qrCode,
    ...extra,
  };
}

export function registerPublicRoutes(router) {
  /* 首屏一次性拉取：设置 + 分类 + 商品 + 公告 */
  router.get("/api/public/bootstrap", async (ctx) => {
    const [categories, products, announcements] = await Promise.all([
      categoryService.list({ onlyEnabled: true }),
      productService.listPublic(),
      activeAnnouncements(),
    ]);

    ok(ctx.res, {
      settings: settingsService.toPublic(),
      categories,
      products,
      announcements,
      serverTime: new Date().toISOString(),
      // 告诉前端另一个服务的地址，便于「查看前台/后台」跳转
      endpoints: {
        site: config.servers.site.baseUrl,
        admin: config.servers.admin.baseUrl,
      },
    });
  });

  /* 单个商品 */
  router.get("/api/public/products/:id", async (ctx) => {
    const product = await productService.find(ctx.params.id);
    if (!product || !product.status) throw notFound("商品不存在或已下架");
    ok(ctx.res, product);
  });

  /* 订单查询：订单号精确匹配，或联系方式模糊匹配 */
  router.get("/api/public/orders/query", async (ctx) => {
    const keyword = str(ctx.query.get("keyword"), { field: "查询关键词", max: 100 });
    const list = await orderService.searchPublic(keyword);
    if (list.length === 0) throw notFound("没有查询到相关订单，请核对订单号");
    ok(ctx.res, { total: list.length, orders: list });
  });

  /* 创建订单（锁定卡密 + 向支付渠道要付款码） */
  router.post("/api/public/orders", async (ctx) => {
    const order = await orderService.create(ctx.body || {}, ctx.ip);
    ok(ctx.res, {
      ...decorate(order, {
        qrCode: order.payment?.qrCode ?? "",
        payment: order.payment ?? null,
        payError: order.payError ?? "",
        payWindowSeconds: order.remainSeconds,
      }),
    });
  });

  /**
   * 查询订单状态（前端轮询用）。
   *
   * 待付款且是真实渠道时，顺手向网关**主动查单**一次：
   * 本地开发网关回调不到 localhost，不这么做的话用户付了钱页面还是一直转圈。
   * 查单有节流，不会把网关打爆。
   */
  router.get("/api/public/orders/:no", async (ctx) => {
    const no = str(ctx.params.no, { field: "订单号", max: 40 });
    let order = await orderService.findPublic(no);
    if (!order) throw notFound("订单不存在");

    const channel = order.payChannel;
    if (order.status === "待付款" && (channel === "wechat" || channel === "alipay")) {
      const row = await orderService.findRowByNo(no);
      if (row && paymentService.shouldQuery(row)) {
        const result = await paymentService.queryPayment(row);
        if (result.paid) {
          /* 金额必须核对：网关说付了，但付的是不是这一单的钱、金额对不对 */
          if (paymentService.amountMatches(row.amount, result.paidAmount)) {
            const paid = await orderService.markPaid(no, { ip: ctx.ip, actor: "主动查单" });
            order = { ...paid, payChannel: channel };
          } else {
            logger.error(
              `订单 ${no} 金额不符：应付 ${row.amount}，实付 ${result.paidAmount}，已拒绝发货`
            );
          }
        } else if (result.closed) {
          await orderService.close(no, { actor: "支付渠道已关闭", ip: ctx.ip });
          order = await orderService.findPublic(no);
        }
      }
    }

    ok(ctx.res, decorate(order));
  });

  /**
   * 测试渠道的「模拟支付成功」入口。
   * 真实渠道会被 orderService.markPaid 拒绝（requireTestChannel）。
   */
  router.post("/api/public/orders/:no/pay", async (ctx) => {
    const no = str(ctx.params.no, { field: "订单号", max: 40 });
    const order = await orderService.markPaid(no, {
      ip: ctx.ip,
      actor: "测试支付",
      requireTestChannel: true,
    });
    ok(ctx.res, decorate(order));
  });

  /* 主动关闭未支付订单（用户点「取消订单」） */
  router.post("/api/public/orders/:no/cancel", async (ctx) => {
    const no = str(ctx.params.no, { field: "订单号", max: 40 });
    const order = await orderService.findRowByNo(no);
    if (!order) throw notFound("订单不存在");
    await orderService.close(no, { actor: "用户取消", ip: ctx.ip });
    ok(ctx.res, { no, status: "已关闭" });
  });

  /* ------------------------------------------------------------ 支付回调 */

  /**
   * 微信支付回调。
   *
   * 安全性来自 APIv3 密钥：通知体是 AES-256-GCM 加密的，
   * 认证标签校验通过就意味着「只有持有 APIv3 密钥的一方」能构造出来。
   * 解密后再核对金额与订单号，双保险。
   */
  router.post("/api/public/pay/notify/wechat", async (ctx) => {
    let parsed;
    try {
      parsed = paymentService.parseWechatNotify(ctx.body || {});
    } catch (err) {
      logger.error(`微信支付回调解密失败：${err.message}`);
      /* 回非 SUCCESS，微信会按策略重试 */
      json(ctx.res, 500, { code: "FAIL", message: err.message });
      return;
    }

    await handleNotify(ctx, "wechat", parsed, wechatpay.notifyOk(), "FAIL");
  });

  /**
   * 支付宝回调。
   * 通知参数带 sign，用支付宝公钥验签；验签不过一律不发货。
   */
  router.post("/api/public/pay/notify/alipay", async (ctx) => {
    const parsed = paymentService.parseAlipayNotify(ctx.body || {});

    if (!parsed.verified) {
      logger.error(`支付宝回调验签失败，订单 ${parsed.outTradeNo || "未知"}`);
      json(ctx.res, 400, "failure");
      return;
    }

    await handleNotify(ctx, "alipay", parsed, "success", "failure");
  });

  /* 站点统计（首页展示用，只暴露脱敏数字） */  router.get("/api/public/stats", async (ctx) => {
    const [orderStats, cardRow, products] = await Promise.all([
      orderService.stats(),
      all("SELECT COUNT(*) AS c FROM cards WHERE status = '已售'"),
      productService.listPublic(),
    ]);

    ok(ctx.res, {
      totalOrders: orderStats.total,
      shippedOrders: orderStats.shipped,
      soldCards: Number(cardRow[0]?.c || 0),
      products: products.length,
    });
  });
}

export default registerPublicRoutes;
