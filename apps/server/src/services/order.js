/**
 * 简卡铺 · 订单服务
 * ---------------------------------------------------------------------------
 * 完整下单链路：
 *   创建订单（事务内锁定卡密）→ 支付（卡密切为已售、销量累加）→ 发货
 *   未支付超时 → 自动关单并把卡密退回库存池
 *
 * 所有涉及库存的写操作都在 tx() 内完成，失败自动回滚。
 */
import { all, get, run, scalar, tx } from "../db.js";
import { conflict, notFound, badRequest } from "../lib/errors.js";
import { randomOrderNo } from "../lib/crypto.js";
import { nowStr, strAfterMinutes, isExpired, secondsUntil } from "../lib/time.js";
import { str, int, contact as validateContact, orderBy } from "../lib/validate.js";
import config from "../config.js";
import * as settingsService from "./settings.js";
import * as productService from "./product.js";
import * as cardService from "./card.js";
import * as logService from "./log.js";
import * as notifyService from "./notify.js";
import * as userService from "./user.js";
import * as paymentService from "./payment.js";
import { logger } from "../lib/logger.js";

export const ORDER_STATUS = ["待付款", "已发货", "处理中", "已关闭", "已退款", "失败"];
export const PAID_STATUSES = ["已发货", "处理中"];

/** 支付渠道的中文标签（存 pay_method 给人看） */
export const PAY_LABELS = { wechat: "微信支付", alipay: "支付宝", test: "测试支付" };

/** 订单列表的可选排序；键来自前端 query，只能从这里取 */
const ORDER_SORTS = {
  default: "id DESC",
  newest: "created_at DESC, id DESC",
  oldest: "created_at ASC, id ASC",
  created_asc: "created_at ASC, id ASC",
  created_desc: "created_at DESC, id DESC",
  amount_desc: "amount DESC, id DESC",
  amount_asc: "amount ASC, id DESC",
  qty_desc: "qty DESC, id DESC",
  qty_asc: "qty ASC, id DESC",
  status_asc: "status ASC, id DESC",
  status_desc: "status DESC, id DESC",
  paid_asc: "paid_at ASC NULLS LAST, id DESC",
  paid_desc: "paid_at DESC NULLS LAST, id DESC",
  no_asc: "order_no ASC",
  no_desc: "order_no DESC",
};

/* ---------------------------------------------------------------- 视图转换 */

/** 前台视图 */
export function toPublic(order, { secrets = null } = {}) {
  return {
    no: order.order_no,
    status: order.status,
    productId: order.product_id,
    product: order.product_name,
    spec: order.spec,
    qty: Number(order.qty),
    unitPrice: Number(order.unit_price),
    amount: Number(order.amount),
    contact: order.contact,
    payMethod: order.pay_method,
    /** 渠道码，前台据此决定渲染二维码还是「模拟支付」按钮 */
    payChannel: order.pay_channel || paymentService.channelFromLabel(order.pay_method),
    createdAt: order.created_at,
    expiresAt: order.expires_at,
    paidAt: order.paid_at || "",
    remainSeconds: order.status === "待付款" ? Math.max(0, secondsUntil(order.expires_at)) : 0,
    deliverable: order.status === "已发货",
    secrets: secrets ?? [],
  };
}

/**
 * 后台视图
 * @param {object} order
 * @param {string[]} [preloadedSecrets] 列表页批量预取时传入，避免 N+1
 */
export async function toAdmin(order, preloadedSecrets) {
  const secrets =
    preloadedSecrets !== undefined
      ? preloadedSecrets
      : await cardService.secretsForOrder(order.id);

  return {
    id: Number(order.id),
    no: order.order_no,
    productId: order.product_id,
    product: order.product_name,
    spec: order.spec,
    qty: Number(order.qty),
    unitPrice: Number(order.unit_price),
    amount: Number(order.amount),
    pay: order.pay_method,
    status: order.status,
    contact: order.contact,
    time: order.created_at,
    expiresAt: order.expires_at,
    paidAt: order.paid_at || "",
    closedAt: order.closed_at || "",
    ip: order.client_ip,
    secrets,
  };
}

/* -------------------------------------------------------------------- 查询 */

export async function findRowByNo(orderNo) {
  return get("SELECT * FROM orders WHERE order_no = ?", orderNo);
}

/** 前台按订单号查询（已发货才带卡密） */
export async function findPublic(orderNo) {
  const order = await findRowByNo(orderNo);
  if (!order) return null;
  const secrets = order.status === "已发货" ? await cardService.secretsForOrder(order.id) : [];
  return toPublic(order, { secrets });
}

/** 按订单号或联系方式模糊查询 */
export async function searchPublic(keyword) {
  const order = await findRowByNo(keyword);
  if (order) return [await findPublic(order.order_no)];

  const rows = await all(
    "SELECT order_no FROM orders WHERE contact = ? ORDER BY id DESC LIMIT 20",
    keyword
  );
  const out = [];
  for (const row of rows) out.push(await findPublic(row.order_no));
  return out;
}

/** 后台列表 */
export async function list({
  keyword = "",
  status = "",
  pay = "",
  sort = "default",
  page = 1,
  perPage = 8,
} = {}) {
  const where = [];
  const params = [];

  if (status) {
    where.push("status = ?");
    params.push(oneOf(status, ORDER_STATUS, { field: "订单状态" }));
  }
  if (pay) {
    /* 按渠道码筛选；兼容老的按中文标签筛选 */
    where.push("(pay_channel = ? OR pay_method = ?)");
    const channel = paymentService.channelFromLabel(pay);
    params.push(channel, pay);
  }
  if (keyword) {
    where.push("(order_no ILIKE ? OR product_name ILIKE ? OR contact ILIKE ?)");
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await scalar(`SELECT COUNT(*) AS c FROM orders ${clause}`, ...params)) ?? 0);

  const safePage = Math.max(1, page);
  const order = orderBy(sort, ORDER_SORTS, "default");
  const rows = await all(
    `SELECT * FROM orders ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params,
    perPage,
    (safePage - 1) * perPage
  );

  /* 批量取卡密，避免每行一次查询 */
  const secretMap = await cardService.secretsForOrders(rows.map((r) => Number(r.id)));
  const mapped = await Promise.all(rows.map((r) => toAdmin(r, secretMap.get(Number(r.id)) || [])));

  return { rows: mapped, total, page: safePage, perPage };
}

/** 后台订单统计卡 */
export async function stats() {
  const row = await get(`
    SELECT COUNT(*)                                                    AS total,
           COUNT(*) FILTER (WHERE status = '已发货')                    AS shipped,
           COALESCE(SUM(amount) FILTER (WHERE status IN ('已发货','处理中')), 0) AS revenue,
           COUNT(*) FILTER (WHERE status IN ('待付款','处理中'))         AS pending
      FROM orders
  `);
  return {
    total: Number(row?.total || 0),
    shipped: Number(row?.shipped || 0),
    revenue: Math.round(Number(row?.revenue || 0) * 100) / 100,
    pending: Number(row?.pending || 0),
  };
}

/* -------------------------------------------------------------------- 下单 */

/**
 * 创建订单
 * @param {object} payload { productId, spec, qty, contact, payChannel }
 * @param {string} ip
 */
export async function create(payload, ip = "") {
  const productId = str(payload.productId, { field: "商品", max: 40 });

  /* ---- 先做纯参数校验（400），再谈业务状态（409）----
     顺序很重要：请求本身就不合法时应该报 400，
     而不是因为「恰好库存不足」返回 409，那会让人以为是库存问题。 */
  const qty = int(payload.qty, {
    field: "购买数量",
    min: 1,
    max: config.order.maxQtyPerOrder,
  });

  /* 联系方式必填，但**不限制格式**：手机号、邮箱、QQ 号、随便一句话都行。
     它同时是后台「客户」的身份，所以不能空着。 */
  const buyer = validateContact(payload.contact, { field: "联系方式", required: true });

  /* 支付渠道。兼容老的 payMethod（中文标签）传参，避免旧调用直接报错。 */
  const rawChannel = payload.payChannel ?? paymentService.channelFromLabel(payload.payMethod);
  if (!paymentService.isValidChannel(rawChannel)) {
    throw badRequest("不支持的支付方式", { field: "支付方式" });
  }
  const payChannel = rawChannel;
  const payMethod = PAY_LABELS[payChannel];

  /* ---- 以下才是业务校验 ---- */
  const product = await productService.requirePurchasable(productId);

  const specs = JSON.parse(product.specs || "[]");
  let spec = String(payload.spec ?? "").trim();
  if (specs.length > 0) {
    if (!spec) spec = specs[0];
    if (!specs.includes(spec)) throw conflict("所选规格不存在，请重新选择");
  } else {
    spec = "";
  }

  /* 规格确定后再校验一次库存：该规格的卡密池可能是空的 */
  await productService.requirePurchasable(productId, spec);

  /* 渠道必须真的能收款，否则调网关必然失败、还白占一张卡。
     前台会把没配好的渠道标成「暂不可用」，但客户端判断不能当防线，这里再拦一次。 */
  if (!settingsService.availableChannels()[payChannel]) {
    /* 给买家的话别列出内部缺哪些密钥 —— 那是后台该看的信息 */
    const missing = settingsService.channelMissingKeys(payChannel);
    logger.warn(
      `下单被拒：${payMethod}（channel=${payChannel}）尚不可用，缺少 ${missing.join("、") || "启用开关"}`
    );
    throw conflict(
      settingsService.isChannelEnabled(payChannel)
        ? `${payMethod}正在维护中，请选择其它支付方式`
        : `${payMethod}暂未开通，请选择其它支付方式`
    );
  }

  const amount = Math.round(Number(product.price) * qty * 100) / 100;
  const minOrder = settingsService.getNumber("trade.minOrder", 0);
  if (amount < minOrder) {
    throw conflict(`单笔订单金额不能低于 ¥${minOrder}`);
  }

  const prefix = settingsService.getRaw("trade.orderPrefix", config.order.defaultPrefix) || "JKP";
  const payWindow = settingsService.getNumber(
    "trade.autoCloseMinutes",
    config.order.defaultPayWindowMinutes
  );

  let orderNo = randomOrderNo(prefix);
  let guard = 0;
  while (await findRowByNo(orderNo)) {
    orderNo = randomOrderNo(prefix);
    if ((guard += 1) > 10) throw conflict("订单号生成失败，请重试");
  }

  const created = nowStr();
  const expires = strAfterMinutes(payWindow);

  const orderId = await tx(async () => {
    const info = await run(
      `INSERT INTO orders
        (order_no, product_id, product_name, spec, qty, unit_price, amount, contact,
         pay_method, pay_channel, status, created_at, expires_at, client_ip)
       VALUES (?,?,?,?,?,?,?,?,?,?,'待付款',?,?,?)
       RETURNING id`,
      orderNo, product.id, product.name, spec, qty, Number(product.price), amount, buyer,
      payMethod, payChannel, created, expires, String(ip || "")
    );

    const locked = await cardService.lockForOrder(info.lastInsertRowid, product.id, spec, qty);
    if (!locked) {
      // 库存不足：抛错触发回滚，订单不会落库
      throw conflict("库存不足，请减少数量或稍后再试");
    }

    /* 按联系方式自动建档 / 刷新最近活跃与 IP。
       放在事务里：订单失败就不该留下客户记录。 */
    await userService.touchByContact(buyer, ip);

    return info.lastInsertRowid;
  });

  const order = await get("SELECT * FROM orders WHERE id = ?", orderId);
  await logService.write({ actor: "system", action: "创建订单", target: orderNo, ip, result: "成功" });

  /* 向支付渠道要二维码。这一步要走外网，所以放在事务之外 ——
     网关抖动不该把已经锁好卡的订单回滚掉。
     失败时把原因带给前台，用户可以选择重试或换个支付方式。 */
  let payment = null;
  let payError = "";
  try {
    payment = await paymentService.createPayment(order, payChannel);
  } catch (err) {
    payError = err.message;
    logger.error(`订单 ${orderNo} 创建支付失败：${err.message}`);
  }

  return { ...toPublic(order), payment, payError };
}

/* -------------------------------------------------------------------- 支付 */

/**
 * 标记订单已支付并发货（幂等：已发货的订单直接返回原卡密）
 */
export async function markPaid(orderNo, { ip = "", actor = "system", requireTestChannel = false } = {}) {
  const order = await findRowByNo(orderNo);
  if (!order) throw notFound("订单不存在");

  /* 非测试渠道必须由「验签通过的回调」或「主动查单确认已支付」来驱动，
     绝不能让前台凭一个订单号就把订单标记成已付 —— 那等于免费发卡。 */
  if (requireTestChannel) {
    const channel = order.pay_channel || paymentService.channelFromLabel(order.pay_method);
    if (channel !== "test") {
      throw conflict(
        `${paymentService.labelOf(channel)}订单需要完成真实支付，不能手动确认`
      );
    }
  }

  if (PAID_STATUSES.includes(order.status)) {
    return toPublic(order, { secrets: await cardService.secretsForOrder(order.id) });
  }
  if (order.status !== "待付款") {
    throw conflict(`订单当前状态为「${order.status}」，无法支付`);
  }
  if (isExpired(order.expires_at)) {
    await tx(async () => {
      await run("UPDATE orders SET status = '已关闭', closed_at = ? WHERE id = ?", nowStr(), order.id);
      await cardService.releaseForOrder(order.id, order.product_id);
    });
    throw conflict("订单已超时关闭，请重新下单");
  }

  await tx(async () => {
    await cardService.commitForOrder(order.id, order.product_id);
    await run("UPDATE orders SET status = '已发货', paid_at = ? WHERE id = ?", nowStr(), order.id);
    await run(
      "UPDATE products SET sold = sold + ?, updated_at = ? WHERE id = ?",
      order.qty, nowStr(), order.product_id
    );
  });

  await logService.write({ actor, action: "订单支付并发货", target: orderNo, ip, result: "成功" });

  const fresh = await findRowByNo(orderNo);
  const secrets = await cardService.secretsForOrder(fresh.id);

  /* 按买家留的联系方式发通知（手机号→短信，邮箱→邮件）。
     故意不 await：发送要走外网，慢或失败都不该拖住支付响应；
     notifyOrderPaid 内部已经吞掉所有异常。 */
  void notifyService
    .notifyOrderPaid(fresh, secrets)
    .then((result) => {
      if (result.sent) {
        void logService.write({
          actor: "system",
          action: result.channel === "sms" ? "发送发货短信" : "发送发货邮件",
          target: orderNo,
          ip,
          result: "成功",
        });
      } else if (result.reason) {
        logger.info(`订单 ${orderNo} 未发送通知：${result.reason}`);
      }
    })
    .catch((err) => logger.error(`发货通知异常：${err.message}`));

  return toPublic(fresh, { secrets });
}

/* ---------------------------------------------------------------- 关闭/补发 */

/** 关闭订单（仅待付款可关闭） */
export async function close(orderNo, { actor = "system", ip = "" } = {}) {
  const order = await findRowByNo(orderNo);
  if (!order) throw notFound("订单不存在");
  if (order.status !== "待付款") {
    throw conflict(`订单当前状态为「${order.status}」，无法关闭`);
  }

  await tx(async () => {
    await run("UPDATE orders SET status = '已关闭', closed_at = ? WHERE id = ?", nowStr(), order.id);
    await cardService.releaseForOrder(order.id, order.product_id);
  });

  await logService.write({ actor, action: "关闭订单", target: orderNo, ip, result: "成功" });
  return toAdmin(await findRowByNo(orderNo));
}

/** 补发卡密：为已发货订单额外发放 qty 条新卡密 */
export async function resend(orderNo, { actor = "system", ip = "" } = {}) {
  const order = await findRowByNo(orderNo);
  if (!order) throw notFound("订单不存在");
  if (!PAID_STATUSES.includes(order.status)) {
    throw conflict(`订单当前状态为「${order.status}」，无法补发`);
  }

  await tx(async () => {
    /* 补发要沿用订单原本的规格，否则月卡订单会被补成年卡 */
    const locked = await cardService.lockForOrder(
      order.id,
      order.product_id,
      order.spec,
      Number(order.qty)
    );
    if (!locked) {
      throw conflict(
        order.spec
          ? `「${order.spec}」可用库存不足，无法补发，请先导入该规格的卡密`
          : "可用库存不足，无法补发，请先导入卡密"
      );
    }
    await cardService.commitForOrder(order.id, order.product_id);
    await run("UPDATE orders SET status = '已发货' WHERE id = ?", order.id);
    await run(
      "UPDATE products SET sold = sold + ?, updated_at = ? WHERE id = ?",
      order.qty, nowStr(), order.product_id
    );
  });

  await logService.write({ actor, action: "补发卡密", target: orderNo, ip, result: "成功" });
  return toAdmin(await findRowByNo(orderNo));
}

/** 退款（仅已发货/处理中可退；已发出的卡密作废不回库） */
export async function refund(orderNo, { actor = "system", ip = "" } = {}) {
  const order = await findRowByNo(orderNo);
  if (!order) throw notFound("订单不存在");
  if (!PAID_STATUSES.includes(order.status)) {
    throw conflict(`订单当前状态为「${order.status}」，无法退款`);
  }

  await tx(async () => {
    // 已发出的卡密无法回收，直接作废
    await run("DELETE FROM cards WHERE order_id = ? AND status = '已售'", order.id);
    await run("DELETE FROM order_cards WHERE order_id = ?", order.id);
    await run("UPDATE orders SET status = '已退款', closed_at = ? WHERE id = ?", nowStr(), order.id);
    await run(
      "UPDATE products SET sold = GREATEST(sold - ?, 0), updated_at = ? WHERE id = ?",
      order.qty, nowStr(), order.product_id
    );
    await productService.recomputeStock(order.product_id);
  });

  await logService.write({ actor, action: "订单退款", target: orderNo, ip, result: "成功" });
  return toAdmin(await findRowByNo(orderNo));
}

/**
 * 批量处理订单。
 * 每个订单独立处理，单个失败不连累其它，原因一并返回（与商品批量同一语义）。
 * @param {string[]} orderNos
 * @param {"close"|"resend"} action
 * @param {{actor?: string, ip?: string}} [meta]
 * @returns {Promise<{affected: number, skipped: string[]}>}
 */
export async function batch(orderNos, action, { actor = "system", ip = "" } = {}) {
  const list = [...new Set((orderNos ?? []).map((v) => String(v ?? "").trim()).filter(Boolean))];
  if (list.length === 0) throw badRequest("请至少选择一个订单");
  if (list.length > 200) throw badRequest("一次最多处理 200 个订单");

  const skipped = [];
  let affected = 0;
  for (const no of list) {
    try {
      if (action === "close") await close(no, { actor, ip });
      else await resend(no, { actor, ip });
      affected += 1;
    } catch (err) {
      skipped.push(`${no}：${err.message}`);
    }
  }
  return { affected, skipped };
}

/* -------------------------------------------------------------------- 清理 */

/** 关闭所有已超时的未支付订单，释放卡密 */
export async function sweepExpired() {
  const now = nowStr();
  const rows = await all(
    "SELECT id, order_no, product_id FROM orders WHERE status = '待付款' AND expires_at <= ?",
    now
  );
  if (rows.length === 0) return 0;

  await tx(async () => {
    for (const row of rows) {
      await run("UPDATE orders SET status = '已关闭', closed_at = ? WHERE id = ?", now, row.id);
      await cardService.releaseForOrder(row.id, row.product_id);
    }
  });

  for (const row of rows) {
    await logService.write({
      actor: "system",
      action: "超时自动关单",
      target: row.order_no,
      result: "成功",
    });
  }
  return rows.length;
}

export default {
  ORDER_STATUS, PAID_STATUSES, PAY_LABELS,
  toPublic, toAdmin, findRowByNo, findPublic, searchPublic, list, stats,
  create, markPaid, close, resend, refund, batch, sweepExpired,
};
