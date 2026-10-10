/**
 * 简卡铺 · 初始化种子数据（PostgreSQL）
 * ---------------------------------------------------------------------------
 * 既可作为 CLI 使用，也可被服务端在首次启动时调用：
 *   node apps/server/src/seed.js          已有数据时跳过
 *   node apps/server/src/seed.js --force  清空并重建
 *   import { seed } from "./seed.js"; await seed();
 */
import { all, get, run, scalar, tx, initDatabase } from "./db.js";
import config from "./config.js";
import { hashPassword } from "./lib/crypto.js";
import { nowStr, strAfterMinutes } from "./lib/time.js";
import { logger } from "./lib/logger.js";
import {
  DEFAULT_ADMIN,
  DEFAULT_SETTINGS,
  DEFAULT_ANNOUNCEMENTS,
  DEFAULT_CATEGORIES,
  DEFAULT_PRODUCTS,
  DEFAULT_USERS,
  DEMO_ORDER_NUMBERS,
} from "./defaults.js";

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pad = (n) => String(n).padStart(2, "0");

/** 生成卡密：前缀-4组4位 */
function genSecret(prefix) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const groups = [];
  for (let g = 0; g < 4; g += 1) {
    let s = "";
    for (let i = 0; i < 4; i += 1) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    groups.push(s);
  }
  return [prefix, ...groups].join("-");
}

/**
 * 批量插入卡密：拼成一条多值 INSERT，避免逐条往返。
 * 每 200 行一批，防止参数过多。
 * @param {{productId:string, spec:string, secret:string, importedAt:string}[]} rows
 */
async function insertCardsBatch(rows) {
  const CHUNK = 200;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const values = chunk.map(() => "(?, ?, ?, '未售', ?)").join(",");
    const params = [];
    for (const r of chunk) params.push(r.productId, r.spec ?? "", r.secret, r.importedAt);
    await run(
      `INSERT INTO cards (product_id, spec, secret, status, imported_at) VALUES ${values}
       ON CONFLICT (secret) DO NOTHING`,
      ...params
    );
  }
}

/** 数据库是否已有管理员（判断是否需要初始化） */
export async function isInitialized() {
  const count = Number((await scalar("SELECT COUNT(*) AS c FROM admins")) ?? 0);
  return count > 0;
}

/** 清空全部业务数据并重置自增序列 */
async function truncateAll() {
  await run(`
    TRUNCATE TABLE
      order_cards, orders, cards, products, categories,
      announcements, users, logs, sessions, captchas,
      login_attempts, admins, settings
    RESTART IDENTITY CASCADE
  `);
}

/**
 * 写入种子数据
 * @param {{ force?: boolean, quiet?: boolean }} opts
 */
export async function seed({ force = false, quiet = false } = {}) {
  const say = quiet ? () => {} : (...args) => logger.info(...args);

  await initDatabase();

  if ((await isInitialized()) && !force) {
    say("数据库已有数据，跳过初始化");
    return { skipped: true };
  }

  if (force) {
    say("--force：清空现有数据…");
    await truncateAll();
  }

  const started = Date.now();

  /* 1. 管理员 */
  const passwordHash = await hashPassword(DEFAULT_ADMIN.password);
  await run(
    `INSERT INTO admins (username, nickname, role, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    DEFAULT_ADMIN.username, DEFAULT_ADMIN.nickname, DEFAULT_ADMIN.role, passwordHash, nowStr()
  );
  say(`管理员：${DEFAULT_ADMIN.username} / ${DEFAULT_ADMIN.password}`);

  /* 2. 设置 */
  await tx(async () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await run("INSERT INTO settings (key, value) VALUES (?, ?)", key, String(value));
    }
  });

  /* 3. 公告 */
  await tx(async () => {
    for (let i = 0; i < DEFAULT_ANNOUNCEMENTS.length; i += 1) {
      await run("INSERT INTO announcements (text, status, sort) VALUES (?, 1, ?)", DEFAULT_ANNOUNCEMENTS[i], i);
    }
  });

  /* 4. 分类 */
  await tx(async () => {
    for (const c of DEFAULT_CATEGORIES) {
      await run(
        "INSERT INTO categories (id, name, sort, status, remark) VALUES (?, ?, ?, ?, ?)",
        c.id, c.name, c.sort, c.status, c.remark
      );
    }
  });

  /* 5. 商品 + 可用卡密 */
  const importedAt = nowStr();
  await tx(async () => {
    for (const p of DEFAULT_PRODUCTS) {
      await run(
        `INSERT INTO products
          (id, name, category_id, emoji, price, old_price, stock, sold, status, badge, badge_type,
           specs, unit, description, detail, notice, tutorial, delivery, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        p.id, p.name, p.category, p.emoji, p.price, p.oldPrice, 0, p.sold, p.status,
        p.badge, p.badgeType,
        JSON.stringify(p.specs), p.unit, p.desc, p.detail,
        JSON.stringify(p.notice), JSON.stringify(p.tutorial), "自动发货",
        importedAt, importedAt
      );
    }
  });

  // 卡密单独批量写入（商品已存在，满足外键）
  // 每个商品把库存按规格均分，这样前台每个规格都有货可卖，
  // 也能直观看出「月卡的卡密」和「年卡的卡密」是两批不同的数据。
  const cardRows = [];
  for (const p of DEFAULT_PRODUCTS) {
    /* seedStock 为 0 的商品是故意做成「已售罄」的演示品，不能给它发卡密 */
    if (p.seedStock <= 0) continue;

    const prefix = p.id.toUpperCase();
    const specs = p.specs && p.specs.length > 0 ? p.specs : [""];
    const perSpec = Math.max(1, Math.floor(p.seedStock / specs.length));

    for (const spec of specs) {
      const tag = spec ? `-${spec.replace(/\W+/g, "").slice(0, 4)}` : "";
      for (let i = 0; i < perSpec; i += 1) {
        cardRows.push({
          productId: p.id,
          spec,
          secret: genSecret(`${prefix}${tag}`),
          importedAt,
        });
      }
    }
  }
  await insertCardsBatch(cardRows);
  say(`商品 ${DEFAULT_PRODUCTS.length} 件 · 初始卡密 ${cardRows.length} 条（已按规格分配）`);

  /* 6. 用户 */
  await tx(async () => {
    const regBase = new Date(Date.now() - 200 * 86400_000);
    for (let i = 0; i < DEFAULT_USERS.length; i += 1) {
      const u = DEFAULT_USERS[i];
      const reg = new Date(regBase.getTime() + i * 7 * 86400_000);
      await run(
        "INSERT INTO users (uid, name, contact, status, reg_at, last_at) VALUES (?,?,?,?,?,?)",
        u.uid, u.name, u.contact, u.status, nowStr(reg), nowStr()
      );
    }
  });

  /* 7. 订单 */
  const payWindow = Number(DEFAULT_SETTINGS["trade.autoCloseMinutes"]);

  /** 从库存池给订单分配卡密；只取该订单所选规格的卡，库存不足返回 null */
  async function allocate(orderId, productId, spec, qty, when) {
    const rows = await all(
      `SELECT id, secret FROM cards
        WHERE product_id = ? AND spec = ? AND status = '未售'
        ORDER BY id LIMIT ?`,
      productId, spec ?? "", qty
    );
    if (rows.length < qty) return null;
    for (const r of rows) {
      await run(
        "UPDATE cards SET status = '已售', sold_at = ?, order_id = ? WHERE id = ?",
        when, orderId, r.id
      );
      await run(
        "INSERT INTO order_cards (order_id, card_id, secret) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        orderId, r.id, r.secret
      );
    }
    return rows.map((r) => r.secret);
  }

  let skipped = 0;

  async function insertOrder(opts) {
    // 事务内一旦出错会整体回滚，所以先查重再插入
    if (await get("SELECT id FROM orders WHERE order_no = ?", opts.orderNo)) {
      skipped += 1;
      return;
    }

    const p = DEFAULT_PRODUCTS.find((x) => x.id === opts.productId);
    const qty = opts.qty;
    /* 规格可能为空（商品没有规格），统一成空字符串，避免 NOT NULL 报错 */
    const spec = opts.spec ?? "";
    const amount = Math.round(p.price * qty * 100) / 100;
    const created = opts.createdAt;
    const expires = strAfterMinutes(payWindow, new Date(created.replace(" ", "T")));

    const info = await run(
      `INSERT INTO orders
        (order_no, product_id, product_name, spec, qty, unit_price, amount, contact,
         pay_method, status, created_at, expires_at, paid_at, closed_at, client_ip)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       RETURNING id`,
      opts.orderNo, p.id, p.name, spec, qty, p.price, amount, opts.contact,
      opts.payMethod || "微信支付", opts.status, created, expires,
      opts.paidAt || null, opts.closedAt || null, opts.ip || "127.0.0.1"
    );

    if (opts.deliver) {
      const secrets = await allocate(info.lastInsertRowid, p.id, spec, qty, opts.paidAt || created);
      if (!secrets) {
        await run("UPDATE orders SET status = '处理中' WHERE id = ?", info.lastInsertRowid);
      }
    }
  }

  const CONTACTS = [
    "138****6621", "139****3382", "137****9014", "186****2277", "159****4408",
    "135****7731", "188****5560", "177****8890", "131****6677", "150****3345",
    "133****1129", "189****2200", "159****9021", "136****4410",
  ];
  const payable = DEFAULT_PRODUCTS.filter((p) => p.seedStock > 0);

  await tx(async () => {
    /* 7.1 两笔固定演示订单：保证「查询订单」页任何时候都有数据 */
    await insertOrder({
      orderNo: DEMO_ORDER_NUMBERS[0], productId: "p001", spec: "月卡", qty: 2,
      contact: "138****6621", payMethod: "微信支付", status: "已发货", deliver: true,
      createdAt: "2026-01-01 12:08:33", paidAt: "2026-01-01 12:08:41",
    });
    await insertOrder({
      orderNo: DEMO_ORDER_NUMBERS[1], productId: "p007", spec: "1000 点券", qty: 1,
      contact: "138****6621", payMethod: "支付宝", status: "已发货", deliver: true,
      createdAt: "2026-01-02 09:41:12", paidAt: "2026-01-02 09:41:20",
    });

    /* 7.2 近 7 天随机订单：让数据概览与列表有内容 */
    const now = new Date();
    for (let d = 6; d >= 0; d -= 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
      const count = d === 0 ? randInt(8, 16) : randInt(10, 26);

      for (let i = 0; i < count; i += 1) {
        const p = pick(payable);
        const qty = randInt(1, 3);
        const maxHour = d === 0 ? now.getHours() : 23;
        const created =
          `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())} ` +
          `${pad(randInt(0, Math.max(0, maxHour)))}:${pad(randInt(0, 59))}:${pad(randInt(0, 59))}`;

        const roll = Math.random();
        let status = "已关闭";
        let deliver = false;
        if (roll < 0.74) { status = "已发货"; deliver = true; }
        else if (roll < 0.86) { status = "处理中"; deliver = true; }
        else if (roll < 0.94) { status = "已关闭"; }
        else { status = "已退款"; deliver = true; }

        await insertOrder({
          orderNo: `JKP${day.getFullYear()}${pad(day.getMonth() + 1)}${pad(day.getDate())}${String(i + 1).padStart(3, "0")}`,
          productId: p.id,
          spec: pick(p.specs),
          qty,
          contact: pick(CONTACTS),
          payMethod: Math.random() < 0.55 ? "微信支付" : "支付宝",
          status,
          deliver,
          createdAt: created,
          paidAt: deliver ? created : null,
          closedAt: status === "已关闭" ? strAfterMinutes(payWindow, new Date(created.replace(" ", "T"))) : null,
          ip: `112.65.${randInt(1, 254)}.${randInt(1, 254)}`,
        });
      }
    }

    /* 7.3 两笔未过期的「待付款」订单：后台能看到待处理状态 */
    for (let i = 0; i < 2; i += 1) {
      const p = pick(payable);
      await insertOrder({
        orderNo: `JKP${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}9${pad(i)}`,
        productId: p.id,
        spec: pick(p.specs),
        qty: 1,
        contact: pick(CONTACTS),
        payMethod: Math.random() < 0.5 ? "微信支付" : "支付宝",
        status: "待付款",
        deliver: false,
        createdAt: strAfterMinutes(-randInt(1, 4)),
      });
    }
  });

  /* 8. 演示订单会随机消耗卡密，个别规格可能被买空或只剩一两张。
        这里把「有货商品里库存不足的规格」补到 MIN_PER_SPEC，
        保证前台每个规格都能顺畅地买上几件，方便直接演示。

        注意是「补到 5 张」而不是「卖空了才补 5 张」——
        只剩 1 张的规格同样是没法用的（买 2 件就报库存不足）。 */
  const MIN_PER_SPEC = 5;
  const shortSpecs = await all(
    `SELECT p.id AS product_id, s.spec, COALESCE(cnt.free, 0)::int AS free
       FROM products p
       CROSS JOIN LATERAL jsonb_array_elements_text(p.specs::jsonb) AS s(spec)
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS free
           FROM cards c
          WHERE c.product_id = p.id AND c.spec = s.spec AND c.status = '未售'
       ) cnt ON true
      WHERE COALESCE(cnt.free, 0) < ?`,
    MIN_PER_SPEC
  );

  /* 只补「本来就配了库存」的商品；seedStock 为 0 的售罄演示品保持售罄 */
  const restockRows = [];
  for (const row of shortSpecs) {
    const p = DEFAULT_PRODUCTS.find((x) => x.id === row.product_id);
    if (!p || p.seedStock <= 0) continue;

    const need = MIN_PER_SPEC - Number(row.free);
    const prefix = p.id.toUpperCase();
    const tag = row.spec ? `-${row.spec.replace(/\W+/g, "").slice(0, 4)}` : "";
    for (let i = 0; i < need; i += 1) {
      restockRows.push({
        productId: p.id,
        spec: row.spec,
        secret: genSecret(`${prefix}${tag}-R`),
        importedAt,
      });
    }
  }
  if (restockRows.length > 0) {
    await insertCardsBatch(restockRows);
    say(`已为 ${restockRows.length / MIN_PER_SPEC} 个被买空的规格补货 ${restockRows.length} 条`);
  }

  /* 9. 依据实际卡密重算商品库存 */
  await run(`
    UPDATE products
       SET stock = (SELECT COUNT(*) FROM cards WHERE cards.product_id = products.id AND cards.status = '未售')
  `);

  /* 10. 操作日志 */
  const logRows = [
    ["admin", "登录后台", "—", "112.65.***.***", "成功"],
    ["admin", "修改系统设置", "交易设置", "112.65.***.***", "成功"],
    ["system", "批量导入卡密", "QQ 音乐豪华绿钻", "—", "成功"],
    ["system", "自动发货", DEMO_ORDER_NUMBERS[1], "—", "成功"],
    ["admin", "订单退款", "JKP-R-0001", "112.65.***.***", "成功"],
    ["admin", "下架商品", "Adobe 全家桶月卡", "112.65.***.***", "成功"],
    ["system", "充值失败回调", "JKP-R-0002", "—", "失败"],
    ["admin", "封禁用户", "U100229 疑似刷单", "112.65.***.***", "成功"],
    ["admin", "新增商品", "百度网盘超级会员", "112.65.***.***", "成功"],
    ["system", "清理超时订单", "2 笔", "—", "成功"],
  ];
  await tx(async () => {
    const base = Date.now() - logRows.length * 3600_000;
    for (let i = 0; i < logRows.length; i += 1) {
      const r = logRows[i];
      await run(
        "INSERT INTO logs (time, actor, action, target, ip, result) VALUES (?,?,?,?,?,?)",
        nowStr(new Date(base + i * 3600_000)), r[0], r[1], r[2], r[3], r[4]
      );
    }
  });

  const [orderCount, cardCount] = await Promise.all([
    scalar("SELECT COUNT(*) AS c FROM orders"),
    scalar("SELECT COUNT(*) AS c FROM cards"),
  ]);

  const summary = {
    skipped: false,
    products: DEFAULT_PRODUCTS.length,
    cards: Number(cardCount || 0),
    orders: Number(orderCount || 0),
    duplicateOrdersSkipped: skipped,
    elapsedMs: Date.now() - started,
  };
  say(
    `订单 ${summary.orders} 笔 · 卡密 ${summary.cards} 条 · 用时 ${summary.elapsedMs}ms` +
      (skipped ? `（跳过重复订单 ${skipped} 笔）` : "")
  );

  return summary;
}

/* ------------------------------------------------------------- CLI 入口判断 */

const invokedDirectly =
  process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("seed.js");

if (invokedDirectly) {
  const { closePool } = await import("./db.js");
  try {
    const result = await seed({ force: process.argv.includes("--force") });
    console.log("");
    if (result.skipped) {
      console.log("  数据库已有数据，未做改动。需要重建请加 --force");
    } else {
      console.log(`  前台商城  ${config.servers.site.baseUrl}/`);
      console.log(`  管理后台  ${config.servers.admin.baseUrl}/login   账号 admin / 123456`);
      console.log(`  演示订单  ${DEMO_ORDER_NUMBERS.join("  ")}`);
    }
  } catch (err) {
    logger.error("初始化失败", err);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
  process.exit(process.exitCode || 0);
}

export default seed;
