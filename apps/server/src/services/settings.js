/**
 * 简卡铺 · 设置服务
 * ---------------------------------------------------------------------------
 * 数据库用扁平的 key/value 存设置（site.name、trade.minOrder …）。
 *
 * 性能与复杂度取舍：设置是典型的「读多写少」，因此在进程启动时一次性载入
 * 内存缓存，读取接口保持**同步**（不返回 Promise），写入后自动刷新缓存。
 * 这样下单、发货等热路径不必为了读一个配置项而层层 await。
 *
 * 安全约定：支付密钥（wxKey / aliKey）**永不回传前端**，
 * 只返回 xxxKeySet 布尔值表示是否已配置；提交空字符串表示「不修改」。
 */
import { all, run, tx } from "../db.js";
import { DEFAULT_SETTINGS } from "../defaults.js";
import { badRequest } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** 数值型设置项 */
const NUMERIC_KEYS = new Set([
  "trade.minOrder",
  "trade.autoCloseMinutes",
  "trade.lowStockWarn",
  "trade.refundWindowHours",
  "payment.qrExpireMinutes",
  "security.lockThreshold",
  "security.sessionTimeout",
  "notify.smtpPort",
]);

/** 开关型设置项（存 0/1） */
const SWITCH_KEYS = new Set([
  "trade.guestOrder",
  "payment.wxEnable",
  "payment.aliEnable",
  "payment.testEnable",
  "payment.testAutoPay",
  "security.captcha",
  "security.loginFailLock",
  "notify.enable",
  "notify.mailEnable",
  "notify.smtpSecure",
  "notify.smsEnable",
]);

/** 敏感项：不回传，提交空值表示不修改 */
const SECRET_KEYS = new Set([
  "payment.wxPrivateKey",
  "payment.wxApiV3Key",
  "payment.aliPrivateKey",
  "notify.smtpPass",
  "notify.smsKey",
]);

/** 密钥字段 → 对应的「是否已配置」标记字段 */
const SECRET_FLAGS = {
  "payment.wxPrivateKey": "wxPrivateKeySet",
  "payment.wxApiV3Key": "wxApiV3KeySet",
  "payment.aliPrivateKey": "aliPrivateKeySet",
  "notify.smtpPass": "smtpPassSet",
  "notify.smsKey": "smsKeySet",
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

/**
 * 内存缓存。初始值直接取默认设置，
 * 这样在 reload() 完成之前读取也不会拿到空值。
 */
let cache = { ...DEFAULT_SETTINGS };

/**
 * 从数据库加载设置到内存缓存。
 * 应用启动时调用一次；保存设置后内部自动调用。
 */
export async function reload() {
  const rows = await all("SELECT key, value FROM settings");
  const next = Object.create(null);
  for (const key of SETTING_KEYS) next[key] = DEFAULT_SETTINGS[key];
  for (const row of rows) {
    if (!SETTING_KEYS.includes(row.key)) continue;
    next[row.key] = row.value;
  }
  cache = next;
  return cache;
}

/** 仅测试用：重置回默认值 */
export function invalidate() {
  cache = { ...DEFAULT_SETTINGS };
}

/* ------------------------------------------------------------ 同步读取 */

/** 取原始字符串值 */
export function getRaw(key, fallback = "") {
  const value = cache[key];
  return value === undefined || value === null ? fallback : String(value);
}

/**
 * 取数值。
 * 注意：空字符串必须回落到 fallback —— `Number("")` 是 0 且通过 isFinite，
 * 直接返回会让「未配置」被误当成「配置为 0」（例如自动关单时间变成 0）。
 */
export function getNumber(key, fallback = 0) {
  const raw = getRaw(key, "");
  if (raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** 取布尔（0/1） */
export function getBool(key, fallback = false) {
  const v = getRaw(key, "");
  if (v === "") return fallback;
  return v === "1" || v === "true";
}

/* ------------------------------------------------------------ 对外输出 */

/** 组装成后台设置页需要的结构 */
export function toApi() {
  const shape = {
    site: ["name", "subtitle", "logoMark", "icp", "serviceUrl", "serviceTime", "email", "footerText"],
    trade: ["currency", "minOrder", "autoCloseMinutes", "lowStockWarn", "guestOrder", "orderPrefix", "refundWindowHours"],
    payment: [
      "wxEnable", "wxAppId", "wxMchId", "wxSerialNo",
      "aliEnable", "aliAppId", "aliPublicKey", "aliGateway",
      "testEnable", "testAutoPay",
      "qrExpireMinutes",
    ],
    seo: ["title", "keywords", "description"],
    security: ["adminPath", "captcha", "loginFailLock", "lockThreshold", "sessionTimeout"],
    notify: [
      "enable",
      "mailEnable", "smtpHost", "smtpPort", "smtpSecure", "smtpUser", "smtpFrom", "smtpFromName",
      "smsEnable", "smsUrl", "smsMethod", "smsBodyType", "smsParams", "smsSuccessText",
      "mailSubject", "mailBody", "smsBody",
    ],
  };

  const out = {};
  for (const [section, fields] of Object.entries(shape)) {
    out[section] = {};
    for (const field of fields) {
      const fullKey = `${section}.${field}`;
      const raw = getRaw(fullKey, "");
      if (SWITCH_KEYS.has(fullKey)) out[section][field] = raw === "1" ? 1 : 0;
      else if (NUMERIC_KEYS.has(fullKey)) out[section][field] = Number(raw) || 0;
      else out[section][field] = raw;
    }
  }

  /* 所有密钥统一处理：只暴露「是否已配置」，明文永不回传 */
  for (const [key, flagField] of Object.entries(SECRET_FLAGS)) {
    const [section, field] = key.split(".");
    out[section][flagField] = getRaw(key, "") !== "";
    out[section][field] = "";
  }

  /**
   * 每个支付渠道的就绪状态。
   *
   * 后台必须能一眼看出「我明明启用了，为什么前台没有」——
   * 只看开关是看不出来的，得把缺哪几项直接列出来。
   */
  out.payment.channelStatus = Object.fromEntries(
    ["wechat", "alipay", "test"].map((code) => {
      const enabled = getBool(`payment.${code === "wechat" ? "wxEnable" : code === "alipay" ? "aliEnable" : "testEnable"}`, false);
      const configured = isChannelConfigured(code);
      const missing = channelMissingKeys(code);
      return [
        code,
        {
          enabled,
          configured,
          /** 前台是否真的会显示这个渠道 */
          ready: enabled && configured,
          missing,
        },
      ];
    })
  );
  /**
   * 前台会**渲染**的渠道（只看启用开关，与 toPublic() 同源）
   * 和能真正**收款**的渠道（还要求密钥齐全）是两个概念，都告诉管理员。
   */
  out.payment.availableChannels = Object.entries(availableChannels())
    .filter(([, on]) => on)
    .map(([code]) => code);
  out.payment.enabledChannels = Object.entries(enabledChannels())
    .filter(([, on]) => on)
    .map(([code]) => code);

  return out;
}

/**
 * 前台需要的公开设置（不含任何管理信息）
 *
 * 支付方式只按「是否启用」下发 —— 密钥没填全的也会出现在前台，
 * 但会带一个 channelReady=false，前台据此标成「暂不可用」。
 * 「后台开了前台却没有」比「显示了但暂时点不了」更让人困惑。
 */
export function toPublic() {
  const channels = enabledChannels();

  return {
    site: {
      name: getRaw("site.name"),
      subtitle: getRaw("site.subtitle"),
      logoMark: getRaw("site.logoMark"),
      icp: getRaw("site.icp"),
      serviceUrl: getRaw("site.serviceUrl"),
      serviceTime: getRaw("site.serviceTime"),
      email: getRaw("site.email"),
      footerText: getRaw("site.footerText"),
    },
    trade: {
      currency: getRaw("trade.currency", "CNY"),
      minOrder: getNumber("trade.minOrder", 1),
      guestOrder: getBool("trade.guestOrder", true) ? 1 : 0,
      refundWindowHours: getNumber("trade.refundWindowHours", 24),
      /** 联系方式是否必填（当前固定为必填，放在这里方便前台统一取值） */
      contactRequired: 1,
    },
    payment: {
      wxEnable: channels.wechat ? 1 : 0,
      aliEnable: channels.alipay ? 1 : 0,
      testEnable: channels.test ? 1 : 0,
      /**
       * 前台要渲染的支付方式 —— **只要启用了就下发**，不看密钥是否填全。
       * 「启用了前台却看不到」比「显示了但暂时用不了」更让人困惑。
       */
      channels: Object.entries(channels)
        .filter(([, on]) => on)
        .map(([key]) => key),
      /**
       * 每个渠道是否已配置完整。前台据此把没配好的标成「暂不可用」，
       * 只给一个布尔值 —— 缺哪些密钥是后台的事，没必要告诉买家。
       */
      channelReady: Object.fromEntries(
        Object.keys(channels).map((code) => [code, isChannelConfigured(code)])
      ),
      qrExpireMinutes: getNumber("payment.qrExpireMinutes", 15),
    },
    seo: {
      title: getRaw("seo.title"),
      keywords: getRaw("seo.keywords"),
      description: getRaw("seo.description"),
    },
  };
}

/* ---------------------------------------------------------- 支付渠道 */

/** 渠道是否「已配置完整」（密钥齐全） */
export function isChannelConfigured(channel) {
  if (channel === "wechat") {
    return Boolean(
      getRaw("payment.wxAppId", "").trim() &&
        getRaw("payment.wxMchId", "").trim() &&
        getRaw("payment.wxSerialNo", "").trim() &&
        getRaw("payment.wxPrivateKey", "").trim() &&
        getRaw("payment.wxApiV3Key", "").trim()
    );
  }
  if (channel === "alipay") {
    return Boolean(
      getRaw("payment.aliAppId", "").trim() &&
        getRaw("payment.aliPrivateKey", "").trim() &&
        getRaw("payment.aliPublicKey", "").trim()
    );
  }
  if (channel === "test") return true;
  return false;
}

/**
 * 已启用的渠道（**不看**密钥是否填全）。
 *
 * 这是下发给前台渲染的列表 —— 后台把开关打开了，前台就要看得到，
 * 否则管理员会一直纳闷「我明明开了怎么没有」。
 * 没配好的渠道前台会标成「暂不可用」，但至少它在列表里。
 * @returns {{wechat: boolean, alipay: boolean, test: boolean}}
 */
export function enabledChannels() {
  return {
    wechat: getBool("payment.wxEnable", false),
    alipay: getBool("payment.aliEnable", false),
    test: getBool("payment.testEnable", false),
  };
}

/** 单个渠道是否已启用 */
export function isChannelEnabled(channel) {
  return Boolean(enabledChannels()[channel]);
}

/**
 * 真正能收款的渠道：既启用了、也配置完整了。
 *
 * 下单时用这个把关 —— 前台可以显示未配置的渠道，
 * 但真到付款那一步必须拦住，不然网关调用必然失败。
 */
export function availableChannels() {
  const enabled = enabledChannels();
  return {
    wechat: enabled.wechat && isChannelConfigured("wechat"),
    alipay: enabled.alipay && isChannelConfigured("alipay"),
    test: enabled.test,
  };
}

/** 渠道配置缺失时给出具体缺了什么，而不是笼统的「未配置」 */
export function channelMissingKeys(channel) {
  const required = {
    wechat: [
      ["payment.wxAppId", "AppID"],
      ["payment.wxMchId", "商户号"],
      ["payment.wxSerialNo", "证书序列号"],
      ["payment.wxPrivateKey", "商户私钥"],
      ["payment.wxApiV3Key", "APIv3 密钥"],
    ],
    alipay: [
      ["payment.aliAppId", "AppID"],
      ["payment.aliPrivateKey", "应用私钥"],
      ["payment.aliPublicKey", "支付宝公钥"],
    ],
  }[channel];

  if (!required) return [];
  return required.filter(([key]) => !getRaw(key, "").trim()).map(([, label]) => label);
}

/* ---------------------------------------------------------------- 写入 */

/**
 * 批量保存设置
 * @param {object} payload 形如 { site: {...}, trade: {...}, payment: {...} }
 * @returns {Promise<string[]>} 被修改的 key 列表
 */
export async function save(payload) {
  if (!payload || typeof payload !== "object") throw badRequest("设置内容不能为空");

  const updates = [];

  for (const [section, fields] of Object.entries(payload)) {
    if (!fields || typeof fields !== "object") continue;
    for (const [field, value] of Object.entries(fields)) {
      const key = `${section}.${field}`;
      if (!SETTING_KEYS.includes(key)) continue; // 白名单：未知字段直接忽略

      if (SECRET_KEYS.has(key)) {
        const v = value === undefined || value === null ? "" : String(value).trim();
        if (v === "") continue; // 空值表示不修改
        updates.push([key, v]);
        continue;
      }

      if (SWITCH_KEYS.has(key)) {
        const on = value === 1 || value === "1" || value === true || value === "true";
        updates.push([key, on ? "1" : "0"]);
        continue;
      }

      if (NUMERIC_KEYS.has(key)) {
        const n = Number(value);
        if (!Number.isFinite(n)) throw badRequest(`${key} 必须是数字`);
        if (n < 0) throw badRequest(`${key} 不能为负数`);
        updates.push([key, String(n)]);
        continue;
      }

      updates.push([key, String(value ?? "").slice(0, 500)]);
    }
  }

  /* 业务校验：合并「本次提交值」与「当前内存值」后再判断 */
  const draft = Object.fromEntries(updates);
  const effective = (key, fallback) => (draft[key] !== undefined ? draft[key] : fallback);

  if (Number(effective("trade.autoCloseMinutes", getRaw("trade.autoCloseMinutes", "15"))) < 1) {
    throw badRequest("未支付自动关单时间至少为 1 分钟");
  }
  if (Number(effective("security.sessionTimeout", getRaw("security.sessionTimeout", "120"))) < 5) {
    throw badRequest("登录状态有效期至少为 5 分钟");
  }
  if (Number(effective("security.lockThreshold", getRaw("security.lockThreshold", "5"))) < 1) {
    throw badRequest("登录失败锁定阈值至少为 1 次");
  }
  /* 至少要留下一种可用的支付方式，否则前台根本下不了单。
     注意三个渠道都要算上：测试渠道默认开启，所以全新部署也能保存设置。 */
  const channelOn = (key, effective) => {
    const raw = effective(key, getRaw(key, "0"));
    return raw === "1" || raw === "true";
  };
  const anyChannel =
    channelOn("payment.wxEnable", effective) ||
    channelOn("payment.aliEnable", effective) ||
    channelOn("payment.testEnable", effective);

  if (!anyChannel) {
    throw badRequest("至少要启用一种支付方式，否则前台无法下单");
  }

  await tx(async () => {
    for (const [key, value] of updates) {
      await run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        key,
        value
      );
    }
  });

  await reload();
  logger.debug(`设置已保存，共 ${updates.length} 项`);
  return updates.map(([k]) => k);
}

export default {
  reload,
  invalidate,
  getRaw,
  getNumber,
  getBool,
  toApi,
  toPublic,
  save,
  isChannelConfigured,
  isChannelEnabled,
  enabledChannels,
  availableChannels,
  channelMissingKeys,
  SETTING_KEYS,
};
