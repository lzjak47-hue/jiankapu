/**
 * 测试用：fetch 打桩 + 示例数据
 * ---------------------------------------------------------------------------
 * 不启动真实后端，直接按 URL 前缀返回构造好的响应，
 * 这样组件测试可以完全离线、确定性地运行。
 */
import { vi } from "vitest";
import type { AdminInfo, AdminSettings, BootstrapData, Product, PublicOrder } from "../shared/types";

/* ------------------------------------------------------------------ 示例数据 */

export const demoProduct: Product = {
  id: "p001",
  name: "爱奇艺黄金 VIP 会员",
  category: "video",
  emoji: "🎬",
  price: 12.8,
  oldPrice: 25,
  stock: 60,
  /** 月卡有货、季卡售罄、年卡库存偏低，覆盖三种展示状态 */
  specStock: { 月卡: 55, 季卡: 0, 年卡: 5 },
  sold: 12876,
  status: 1,
  badge: "热销",
  badgeType: "accent",
  specs: ["月卡", "季卡", "年卡"],
  unit: "张",
  desc: "支持手机 / 平板 / 电脑，下单后系统自动发货。",
  detail: "官方渠道直充，下单后由系统自动发货。",
  notice: ["虚拟商品一经发货不支持退换。"],
  tutorial: ["付款后自动展示卡密。"],
  delivery: "自动发货",
  createdAt: "2025-11-02 10:22",
  updatedAt: "2025-11-02 10:22",
};

export const demoProduct2: Product = {
  ...demoProduct,
  id: "p002",
  name: "腾讯视频 VIP 会员",
  emoji: "📺",
  price: 13.5,
  sold: 9542,
  badge: "秒发",
  badgeType: "success",
  specStock: { 月卡: 40, 季卡: 12, 年卡: 3 },
};

export const demoBootstrap: BootstrapData = {
  settings: {
    site: {
      name: "简卡铺",
      subtitle: "自动发货 · 秒发卡密",
      logoMark: "简",
      icp: "沪ICP备2026000000号",
      serviceUrl: "",
      serviceTime: "9:00 - 24:00",
      email: "support@jiankapu.com",
      footerText: "虚拟商品一经售出不支持退换",
    },
    trade: { currency: "CNY", minOrder: 1, guestOrder: 1, refundWindowHours: 24, contactRequired: 1 },
    payment: {
      wxEnable: 0,
      aliEnable: 0,
      testEnable: 1,
      channels: ["test"],
      channelReady: { wechat: false, alipay: false, test: true },
      qrExpireMinutes: 15,
    },
    seo: { title: "简卡铺 · 24 小时自动发货的卡密商城", keywords: "发卡,卡密", description: "测试用描述" },
  },
  categories: [
    { id: "video", name: "视频会员", sort: 1, status: 1, remark: "视频", count: 2 },
    { id: "music", name: "音乐会员", sort: 2, status: 1, remark: "音乐", count: 0 },
  ],
  products: [demoProduct, demoProduct2],
  announcements: [
    { id: 1, text: "全站卡密 24 小时自动发货。" },
    { id: 2, text: "新用户首单立减 3 元。" },
  ],
  serverTime: "2026-01-01T00:00:00.000Z",
  endpoints: { site: "http://localhost:2001", admin: "http://localhost:2002" },
};

export const demoOrder: PublicOrder = {
  no: "JKP20260105018",
  status: "待付款",
  productId: "p001",
  product: "爱奇艺黄金 VIP 会员",
  spec: "月卡",
  qty: 2,
  unitPrice: 12.8,
  amount: 25.6,
  contact: "13800001111",
  payMethod: "测试支付",
  payChannel: "test",
  createdAt: "2026-01-05 09:41:22",
  expiresAt: "2026-01-05 09:56:22",
  paidAt: "",
  remainSeconds: 900,
  deliverable: false,
  secrets: [],
  payment: { channel: "test", label: "测试支付", qrCode: "", mode: "test" },
  payError: "",
  payUrl: "http://localhost:2001/query?no=JKP20260105018",
  qrPayload: "",
  qrSvg: "",
};

export const demoPaidOrder: PublicOrder = {
  ...demoOrder,
  status: "已发货",
  deliverable: true,
  remainSeconds: 0,
  secrets: ["AIQY-8F3K-2M9D-77QX", "AIQY-5T1P-6B4N-20LZ"],
  qrSvg: "",
};

export const demoAdmin: AdminInfo = {
  id: 1,
  username: "admin",
  nickname: "超级管理员",
  role: "超级管理员",
  lastLoginAt: "2026-01-05 09:12:41",
  lastLoginIp: "127.0.0.1",
};

export const demoAdminSettings: AdminSettings = {
  site: demoBootstrap.settings.site,
  trade: {
    currency: "CNY",
    minOrder: 1,
    autoCloseMinutes: 15,
    lowStockWarn: 20,
    guestOrder: 1,
    orderPrefix: "JKP",
    refundWindowHours: 24,
  },
  payment: {
    wxEnable: 1,
    wxAppId: "wx1234567890abcdef",
    wxMchId: "1600000000",
    wxSerialNo: "45F5ABCDEF123456",
    wxPrivateKey: "",
    wxPrivateKeySet: true,
    wxApiV3Key: "",
    wxApiV3KeySet: true,
    aliEnable: 1,
    aliAppId: "2021000000000000",
    aliPrivateKey: "",
    aliPrivateKeySet: true,
    aliPublicKey: "MIIBIjANBgkq...",
    aliGateway: "https://openapi.alipay.com/gateway.do",
    testEnable: 1,
    testAutoPay: 0,
    qrExpireMinutes: 15,
  },
  seo: demoBootstrap.settings.seo,
  security: {
    adminPath: "/admin",
    captcha: 1,
    loginFailLock: 1,
    lockThreshold: 5,
    sessionTimeout: 120,
  },
  notify: {
    enable: 1,
    mailEnable: 1,
    mailProvider: "smtp",
    smtpHost: "smtp.example.com",
    smtpPort: 465,
    smtpSecure: 1,
    smtpUser: "noreply@example.com",
    smtpPass: "",
    smtpPassSet: true,
    smtpFrom: "",
    smtpFromName: "简卡铺",
    resendKey: "",
    resendKeySet: false,
    smsEnable: 0,
    smsUrl: "",
    smsMethod: "POST",
    smsBodyType: "form",
    smsParams: '{"mobile":"{phone}","content":"{content}"}',
    smsKey: "",
    smsKeySet: false,
    smsSuccessText: "",
    mailSubject: "【{site}】订单 {orderNo} 发货通知",
    mailBody: "订单号：{orderNo}\n卡密：\n{secrets}",
    smsBody: "【{site}】订单{orderNo}已发货，卡密：{secrets}",
  },
  announcements: [{ id: 1, text: "全站卡密 24 小时自动发货。", status: 1 }],
};

/* ------------------------------------------------------------------ 打桩 */

export interface MockRoute {
  /**
   * 路径匹配。默认**精确匹配**（忽略查询串）；
   * 以 `*` 结尾表示前缀匹配，例如 "/api/admin/products*"。
   *
   * 注意必须精确匹配：早期版本用无条件 startsWith，
   * 结果 "/api/public/orders" 会抢先匹配掉 "/api/public/orders/xxx/pay"。
   */
  match: string;
  /** HTTP 方法，默认 GET */
  method?: string;
  /**
   * 返回数据（会被包成 { ok:true, data }）。
   *
   * 传函数则按请求 URL 动态计算 —— 有些接口的返回依赖查询参数
   * （例如 /alerts?since=… 的未读数量），写死一个值会让测试失真。
   */
  data?: unknown | ((url: string) => unknown);
  /** 直接返回失败响应 */
  fail?: { status: number; code: string; message: string };
}

export interface MockResult {
  /** 请求记录，便于断言调用参数 */
  calls: Array<{ url: string; method: string; body: unknown }>;
  restore: () => void;
}

/**
 * 安装 fetch 打桩。未匹配到的请求抛错，避免测试静默通过。
 */
export function installFetchMock(routes: MockRoute[]): MockResult {
  const calls: MockResult["calls"] = [];

  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });

      const pathOnly = url.split("?")[0] ?? url;

      const route = routes.find((r) => {
        if ((r.method ?? "GET").toUpperCase() !== method) return false;
        if (r.match.endsWith("*")) return pathOnly.startsWith(r.match.slice(0, -1));
        return pathOnly === r.match;
      });

      if (!route) {
        return new Response(JSON.stringify({ ok: false, code: "NO_MOCK", message: `未打桩的请求：${method} ${url}` }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (route.fail) {
        return new Response(
          JSON.stringify({ ok: false, code: route.fail.code, message: route.fail.message }),
          { status: route.fail.status, headers: { "Content-Type": "application/json" } }
        );
      }

      const payload = typeof route.data === "function" ? route.data(url) : (route.data ?? null);

      return new Response(JSON.stringify({ ok: true, data: payload }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  );

  return {
    calls,
    restore: () => spy.mockRestore(),
  };
}

/** 构造一条成功响应（供自定义 mockImplementation 使用） */
export function okResponse(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
