/* ============================================================================
   简卡铺 · 后台 API 客户端
   ----------------------------------------------------------------------------
   后台页面不再使用本地模拟数据，全部经由本文件访问 /api/admin/*。
   会话通过 HttpOnly Cookie 维持；任何接口返回 401 会自动跳回登录页。
   ========================================================================== */

window.JKP_ADMIN_NAV = [
  {
    group: "概览",
    items: [{ key: "dashboard", name: "数据概览", icon: "📊", href: "index.html" }],
  },
  {
    group: "商品",
    items: [
      { key: "products", name: "商品管理", icon: "📦", href: "products.html" },
      { key: "categories", name: "分类管理", icon: "🗂️", href: "categories.html" },
      { key: "cards", name: "卡密库存", icon: "🔑", href: "cards.html" },
    ],
  },
  {
    group: "交易",
    items: [
      { key: "orders", name: "订单管理", icon: "🧾", href: "orders.html" },
      { key: "users", name: "用户管理", icon: "👥", href: "users.html" },
    ],
  },
  {
    group: "系统",
    items: [
      { key: "settings", name: "系统设置", icon: "⚙️", href: "settings.html" },
      { key: "logs", name: "操作日志", icon: "📜", href: "logs.html" },
    ],
  },
];

window.JKP_ADMIN_API = (function () {
  "use strict";

  /** 构造查询串，自动忽略空值 */
  function qs(params) {
    if (!params) return "";
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      sp.set(k, String(v));
    });
    const s = sp.toString();
    return s ? `?${s}` : "";
  }

  /** 会话失效时统一跳回登录页 */
  function handleUnauthorized() {
    if (location.pathname.endsWith("login.html")) return;
    location.href = "login.html";
  }

  /**
   * 统一请求
   * @param {string} path
   * @param {{method?:string, body?:object, silent401?:boolean}} opts
   */
  async function request(path, opts = {}) {
    const { method = "GET", body, silent401 = false } = opts;

    const res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      throw new Error(`服务器返回了非 JSON 内容（HTTP ${res.status}）`);
    }

    if (res.status === 401 && !silent401) {
      handleUnauthorized();
      throw new Error("登录状态已失效");
    }
    if (!res.ok || payload.ok === false) {
      const err = new Error(payload.message || `请求失败（HTTP ${res.status}）`);
      err.code = payload.code;
      err.status = res.status;
      throw err;
    }
    return payload.data;
  }

  return {
    request,

    /* 认证 */
    captcha: () => request("/api/admin/captcha", { silent401: true }),
    login: (body) => request("/api/admin/login", { method: "POST", body, silent401: true }),
    logout: () => request("/api/admin/logout", { method: "POST", silent401: true }),
    /**
     * 探测登录态。这里**不能**用 silent401：
     * 未登录时的 401 必须走 handleUnauthorized 跳到登录页，
     * 否则 mountShell() 会直接 return false —— 页面白屏，且不跳转。
     */
    me: () => request("/api/admin/me"),
    changePassword: (body) => request("/api/admin/password", { method: "POST", body }),

    /* 概览 */
    dashboard: () => request("/api/admin/dashboard"),

    /* 商品 */
    products: (p) => request(`/api/admin/products${qs(p)}`),
    product: (id) => request(`/api/admin/products/${encodeURIComponent(id)}`),
    createProduct: (body) => request("/api/admin/products", { method: "POST", body }),
    updateProduct: (id, body) =>
      request(`/api/admin/products/${encodeURIComponent(id)}`, { method: "PUT", body }),
    toggleProduct: (id) =>
      request(`/api/admin/products/${encodeURIComponent(id)}/toggle`, { method: "POST" }),
    deleteProduct: (id) =>
      request(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" }),

    /* 分类 */
    categories: () => request("/api/admin/categories"),
    createCategory: (body) => request("/api/admin/categories", { method: "POST", body }),
    updateCategory: (id, body) =>
      request(`/api/admin/categories/${encodeURIComponent(id)}`, { method: "PUT", body }),
    deleteCategory: (id) =>
      request(`/api/admin/categories/${encodeURIComponent(id)}`, { method: "DELETE" }),

    /* 订单 */
    orders: (p) => request(`/api/admin/orders${qs(p)}`),
    orderStats: () => request("/api/admin/orders/stats"),
    order: (no) => request(`/api/admin/orders/${encodeURIComponent(no)}`),
    resendOrder: (no) =>
      request(`/api/admin/orders/${encodeURIComponent(no)}/resend`, { method: "POST" }),
    closeOrder: (no) =>
      request(`/api/admin/orders/${encodeURIComponent(no)}/close`, { method: "POST" }),
    refundOrder: (no) =>
      request(`/api/admin/orders/${encodeURIComponent(no)}/refund`, { method: "POST" }),

    /* 卡密 */
    cards: (p) => request(`/api/admin/cards${qs(p)}`),
    cardStats: () => request("/api/admin/cards/stats"),
    importCards: (body) => request("/api/admin/cards/import", { method: "POST", body }),
    deleteCard: (id) => request(`/api/admin/cards/${id}`, { method: "DELETE" }),

    /* 用户 */
    users: (p) => request(`/api/admin/users${qs(p)}`),
    userStats: () => request("/api/admin/users/stats"),
    toggleUser: (uid) =>
      request(`/api/admin/users/${encodeURIComponent(uid)}/toggle`, { method: "POST" }),

    /* 设置与日志 */
    settings: () => request("/api/admin/settings"),
    saveSettings: (body) => request("/api/admin/settings", { method: "PUT", body }),
    logs: (p) => request(`/api/admin/logs${qs(p)}`),
  };
})();
