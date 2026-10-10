/**
 * 简卡铺 · 类型化 API 客户端
 * ---------------------------------------------------------------------------
 * 所有请求都经过 request()，它负责：
 *   · 解析后端统一的 { ok, data } / { ok:false, code, message } 结构
 *   · 把失败统一抛成 ApiError（带 code 与 status）
 *   · 401 时触发全局处理（后台跳登录页），可用 silent401 跳过
 */
import type {
  AdminInfo,
  AdminOrder,
  AdminSettings,
  AlertsFeed,
  Announcement,
  BootstrapData,
  Captcha,
  Card,
  CardStats,
  Category,
  CreateOrderInput,
  CustomerDetail,
  DashboardData,
  ImportCardsResult,
  LogEntry,
  OrderStats,
  Paged,
  Product,
  ProductInput,
  PublicOrder,
  RuntimeLogEntry,
  SettingsInput,
  ShopUser,
  SiteStats,
  UserStats,
} from "./types";

/* ================================================================ 错误 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/* ========================================================== 未授权处理 */

let unauthorizedHandler: (() => void) | null = null;

/** 注册全局 401 处理器（后台 App 用它跳登录页） */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

/* ============================================================== 请求 */

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  /** 401 时不触发全局跳转（登录页/验证码接口用） */
  silent401?: boolean;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, silent401 = false, signal } = options;

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "NETWORK_ERROR", "无法连接服务器，请检查网络或后端是否已启动");
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new ApiError(res.status, "BAD_RESPONSE", `服务器返回了非 JSON 内容（HTTP ${res.status}）`);
  }

  const data = payload as { ok?: boolean; data?: T; code?: string; message?: string; details?: Record<string, unknown> };

  if (res.status === 401 && !silent401 && unauthorizedHandler) {
    unauthorizedHandler();
  }

  if (!res.ok || data.ok === false) {
    throw new ApiError(
      res.status,
      data.code ?? "UNKNOWN",
      data.message ?? `请求失败（HTTP ${res.status}）`,
      data.details
    );
  }

  return data.data as T;
}

/** 组装查询串，自动忽略空值 */
function qs(params?: Record<string, string | number | undefined | null>): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/* ============================================================ 接口定义 */

export const api = {
  /* ------------------------------------------------------------ 前台 */

  public: {
    /** 首屏一次性拉取：设置 + 分类 + 商品 + 公告 */
    bootstrap: (signal?: AbortSignal) =>
      request<BootstrapData>("/api/public/bootstrap", { signal }),

    stats: (signal?: AbortSignal) => request<SiteStats>("/api/public/stats", { signal }),

    product: (id: string, signal?: AbortSignal) =>
      request<Product>(`/api/public/products/${encodeURIComponent(id)}`, { signal }),

    /** 创建订单（服务端会事务锁定卡密） */
    createOrder: (input: CreateOrderInput) =>
      request<PublicOrder>("/api/public/orders", { method: "POST", body: input }),

    /** 查询单个订单状态（支付页轮询用） */
    getOrder: (no: string, signal?: AbortSignal) =>
      request<PublicOrder>(`/api/public/orders/${encodeURIComponent(no)}`, { signal }),

    cancelOrder: (no: string) =>
      request<{ no: string; status: string }>(
        `/api/public/orders/${encodeURIComponent(no)}/cancel`,
        { method: "POST" }
      ),

    queryOrders: (keyword: string, signal?: AbortSignal) =>
      request<{ total: number; orders: PublicOrder[] }>(
        `/api/public/orders/query${qs({ keyword })}`,
        { signal }
      ),
  },

  /* ------------------------------------------------------------ 后台 */

  admin: {
    captcha: () => request<Captcha>("/api/admin/captcha", { silent401: true }),

    login: (input: { username: string; password: string; captchaId: string; captchaCode: string }) =>
      request<{ admin: AdminInfo }>("/api/admin/login", {
        method: "POST",
        body: input,
        silent401: true,
      }),

    logout: () => request<{ loggedOut: boolean }>("/api/admin/logout", { method: "POST", silent401: true }),

    /**
     * 探测登录态。**不能** silent401：
     * 未登录时必须走全局处理器跳登录页，否则页面会白屏。
     */
    me: (signal?: AbortSignal) => request<{ admin: AdminInfo }>("/api/admin/me", { signal }),

    changePassword: (input: { oldPassword: string; newPassword: string }) =>
      request<{ changed: boolean }>("/api/admin/password", { method: "POST", body: input }),
    dashboard: (signal?: AbortSignal) => request<DashboardData>("/api/admin/dashboard", { signal }),

    /* 商品 */
    products: (
      params?: {
        keyword?: string;
        category?: string;
        status?: string;
        sort?: string;
        page?: number;
        perPage?: number;
      },
      signal?: AbortSignal
    ) => request<Paged<Product>>(`/api/admin/products${qs(params)}`, { signal }),

    product: (id: string, signal?: AbortSignal) =>
      request<Product>(`/api/admin/products/${encodeURIComponent(id)}`, { signal }),

    createProduct: (input: ProductInput & { id: string }) =>
      request<Product>("/api/admin/products", { method: "POST", body: input }),

    updateProduct: (id: string, input: ProductInput) =>
      request<Product>(`/api/admin/products/${encodeURIComponent(id)}`, { method: "PUT", body: input }),

    toggleProduct: (id: string) =>
      request<{ id: string; status: number }>(
        `/api/admin/products/${encodeURIComponent(id)}/toggle`,
        { method: "POST" }
      ),

    deleteProduct: (id: string) =>
      request<{ id: string; deleted: boolean }>(`/api/admin/products/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),

    /**
     * 批量操作商品。
     * action: on 上架 / off 下架 / delete 删除（会连带删除未售卡密）
     */
    batchProducts: (input: { ids: string[]; action: "on" | "off" | "delete" }) =>
      request<{ affected: number; skipped: string[] }>("/api/admin/products/batch", {
        method: "POST",
        body: input,
      }),

    /* 分类 */
    categories: (signal?: AbortSignal) =>
      request<{ rows: Category[] }>("/api/admin/categories", { signal }),

    createCategory: (input: { id: string; name: string; sort: number; status: number; remark: string }) =>
      request<Category>("/api/admin/categories", { method: "POST", body: input }),

    updateCategory: (
      id: string,
      input: Partial<{ name: string; sort: number; status: number; remark: string }>
    ) =>
      request<Category>(`/api/admin/categories/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: input,
      }),

    deleteCategory: (id: string) =>
      request<{ id: string; deleted: boolean }>(`/api/admin/categories/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),

    /* 订单 */
    orders: (
      params?: {
        keyword?: string;
        status?: string;
        pay?: string;
        sort?: string;
        page?: number;
        perPage?: number;
      },
      signal?: AbortSignal
    ) => request<Paged<AdminOrder>>(`/api/admin/orders${qs(params)}`, { signal }),

    orderStats: (signal?: AbortSignal) => request<OrderStats>("/api/admin/orders/stats", { signal }),

    order: (no: string, signal?: AbortSignal) =>
      request<AdminOrder>(`/api/admin/orders/${encodeURIComponent(no)}`, { signal }),

    resendOrder: (no: string) =>
      request<AdminOrder>(`/api/admin/orders/${encodeURIComponent(no)}/resend`, { method: "POST" }),

    closeOrder: (no: string) =>
      request<AdminOrder>(`/api/admin/orders/${encodeURIComponent(no)}/close`, { method: "POST" }),

    refundOrder: (no: string) =>
      request<AdminOrder>(`/api/admin/orders/${encodeURIComponent(no)}/refund`, { method: "POST" }),

    /** 批量关闭 / 补发订单；单个失败不连累其它，skipped 返回原因 */
    batchOrders: (input: { ids: string[]; action: "close" | "resend" }) =>
      request<{ affected: number; skipped: string[] }>("/api/admin/orders/batch", {
        method: "POST",
        body: input,
      }),

    /* 卡密 */
    cards: (
      params?: {
        productId?: string;
        spec?: string;
        keyword?: string;
        status?: string;
        sort?: string;
        page?: number;
        perPage?: number;
      },
      signal?: AbortSignal
    ) => request<Paged<Card>>(`/api/admin/cards${qs(params)}`, { signal }),

    cardStats: (params?: { productId?: string }, signal?: AbortSignal) =>
      request<CardStats>(`/api/admin/cards/stats${qs(params)}`, { signal }),

    /**
     * 导出卡密 CSV 的下载地址。
     * 直接用 <a href> 触发，让浏览器处理下载与文件名（走 fetch 反而要自己造 Blob）。
     */
    cardsExportUrl: (params?: {
      productId?: string;
      spec?: string;
      keyword?: string;
      status?: string;
      sort?: string;
    }) => `/api/admin/cards/export${qs(params)}`,

    /** 批量导入卡密。spec 必填（商品无规格时传空字符串） */
    importCards: (input: { productId: string; spec: string; text: string }) =>
      request<ImportCardsResult>("/api/admin/cards/import", { method: "POST", body: input }),

    deleteCard: (id: number) =>
      request<{ id: number; deleted: boolean }>(`/api/admin/cards/${id}`, { method: "DELETE" }),

    /** 批量删除卡密；已售的会被跳过（要保留订单追溯） */
    batchDeleteCards: (input: { ids: number[] }) =>
      request<{ affected: number; skipped: number }>("/api/admin/cards/batch-delete", {
        method: "POST",
        body: input,
      }),

    /* 客户（= 下单时填的联系方式，没有注册登录） */
    users: (
      params?: { keyword?: string; sort?: string; page?: number; perPage?: number },
      signal?: AbortSignal
    ) => request<Paged<ShopUser>>(`/api/admin/users${qs(params)}`, { signal }),

    userStats: (signal?: AbortSignal) => request<UserStats>("/api/admin/users/stats", { signal }),

    /** 客户详情：消费汇总 + 逐笔订单（含下单 IP） */
    userDetail: (uid: string, signal?: AbortSignal) =>
      request<CustomerDetail>(`/api/admin/users/${encodeURIComponent(uid)}`, { signal }),

    /** 批量删除客户档案（不影响订单与追溯） */
    batchDeleteUsers: (input: { ids: string[] }) =>
      request<{ affected: number }>("/api/admin/users/batch-delete", { method: "POST", body: input }),

    /* 后台提醒（顶栏铃铛） */
    alerts: (params?: { since?: string }, signal?: AbortSignal) =>
      request<AlertsFeed>(`/api/admin/alerts${qs(params)}`, { signal }),

    /* 设置与日志 */
    settings: (signal?: AbortSignal) => request<AdminSettings>("/api/admin/settings", { signal }),

    saveSettings: (input: SettingsInput) =>
      request<{ changed: string[] }>("/api/admin/settings", { method: "PUT", body: input }),

    /** 发送一封测试邮件 / 一条测试短信，验证通知配置是否可用 */
    testNotify: (input: { channel: "email" | "sms"; target: string }) =>
      request<{ sent: boolean; channel: string; target: string; response: string }>(
        "/api/admin/notify/test",
        { method: "POST", body: input }
      ),

    logs: (
      params?: { keyword?: string; result?: string; page?: number; perPage?: number },
      signal?: AbortSignal
    ) => request<Paged<LogEntry>>(`/api/admin/logs${qs(params)}`, { signal }),

    /** 内存缓冲的系统运行日志（启动任务 / 定时清理 / 通知发送 / 接口异常） */
    systemLogs: (params?: { limit?: number }, signal?: AbortSignal) =>
      request<{ logs: RuntimeLogEntry[] }>(`/api/admin/syslogs${qs(params)}`, { signal }),
  },
};

/** 公告类型别名，避免与类型文件循环引用 */
export type { Announcement };

export default api;
