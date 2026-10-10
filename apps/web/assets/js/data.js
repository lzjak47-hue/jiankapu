/* ============================================================================
   简卡铺 · 前台数据层与 API 客户端
   ----------------------------------------------------------------------------
   页面加载后向 /api/public/bootstrap 拉取站点设置、分类、商品与公告，
   数据就绪后调用 window.JKPInit() 触发渲染（main.js 负责提供该函数）。

   同时导出 window.JKP_API，供 main.js 调用下单、支付、查单等接口。
   ========================================================================== */

window.JKP_DEFER_INIT = true; // 告诉 main.js：先别渲染，等数据

window.JKP_DATA = {
  ready: false,
  error: null,
  settings: null,
  categories: [],
  products: [],
  announcements: [],
  stats: null,
};

window.JKP_API = (function () {
  "use strict";

  /**
   * 统一的接口请求
   * 后端固定返回 { ok, data } 或 { ok:false, code, message }
   */
  async function request(path, { method = "GET", body } = {}) {
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

    if (!res.ok || payload.ok === false) {
      const err = new Error(payload.message || `请求失败（HTTP ${res.status}）`);
      err.code = payload.code;
      err.status = res.status;
      err.details = payload.details;
      throw err;
    }
    return payload.data;
  }

  return {
    request,
    bootstrap: () => request("/api/public/bootstrap"),
    stats: () => request("/api/public/stats"),
    product: (id) => request(`/api/public/products/${encodeURIComponent(id)}`),
    createOrder: (payload) => request("/api/public/orders", { method: "POST", body: payload }),
    getOrder: (no) => request(`/api/public/orders/${encodeURIComponent(no)}`),
    payOrder: (no) => request(`/api/public/orders/${encodeURIComponent(no)}/pay`, { method: "POST" }),
    cancelOrder: (no) => request(`/api/public/orders/${encodeURIComponent(no)}/cancel`, { method: "POST" }),
    queryOrders: (keyword) =>
      request(`/api/public/orders/query?keyword=${encodeURIComponent(keyword)}`),
  };
})();

(function () {
  "use strict";

  /* ---------------------------------------------------------- 设置回填到页面 */

  /**
   * 把后台配置的站点信息写进页面。
   * 页面元素只需加上对应属性，例如 <span data-site-name></span>
   */
  function applySettings(settings) {
    if (!settings) return;
    const site = settings.site || {};
    const seo = settings.seo || {};

    const text = (selector, value) => {
      if (value === undefined || value === null || value === "") return;
      document.querySelectorAll(selector).forEach((el) => {
        el.textContent = value;
      });
    };

    text("[data-site-name]", site.name);
    text("[data-site-logo]", site.logoMark);
    text("[data-site-subtitle]", site.subtitle);
    text("[data-footer-text]", site.footerText);
    text("[data-site-icp]", site.icp);
    text("[data-service-time]", site.serviceTime);
    text("[data-site-email]", site.email);

    if (site.name && seo.title) {
      document.title = seo.title;
    }
    if (seo.description) {
      const meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute("content", seo.description);
    }
    if (seo.keywords) {
      const meta = document.querySelector('meta[name="keywords"]');
      if (meta) meta.setAttribute("content", seo.keywords);
    }

    // 客服入口跳转
    const serviceUrl = site.serviceUrl;
    document.querySelectorAll("[data-service-link]").forEach((el) => {
      if (serviceUrl) {
        el.setAttribute("href", serviceUrl);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener");
      }
    });
  }

  /* -------------------------------------------------------------- 失败提示 */

  function showBootError(err) {
    window.JKP_DATA.error = err;
    const box = document.createElement("div");
    box.className = "boot-error";
    box.innerHTML =
      '<div class="boot-error-inner">' +
      '<div class="ico">🔌</div>' +
      "<h3>无法连接服务器</h3>" +
      "<p>" +
      String(err && err.message ? err.message : err) +
      "</p>" +
      '<p class="small">请确认后端服务已启动：<code>npm start</code></p>' +
      '<button class="btn btn-primary" onclick="location.reload()">重新加载</button>' +
      "</div>";
    document.body.appendChild(box);
    console.error("[简卡铺] 加载失败", err);
  }

  /* ------------------------------------------------------------------ 启动 */

  (async function boot() {
    try {
      const data = await window.JKP_API.bootstrap();

      window.JKP_DATA.settings = data.settings;
      window.JKP_DATA.categories = data.categories || [];
      window.JKP_DATA.products = data.products || [];
      window.JKP_DATA.announcements = (data.announcements || []).map((a) => a.text);
      window.JKP_DATA.ready = true;

      applySettings(data.settings);

      // 站点统计（失败不影响主流程）
      window.JKP_API.stats()
        .then((s) => {
          window.JKP_DATA.stats = s;
          document.querySelectorAll("[data-stat]").forEach((el) => {
            const key = el.getAttribute("data-stat");
            if (s[key] !== undefined) el.textContent = Number(s[key]).toLocaleString("zh-CN");
          });
        })
        .catch(() => {});

      if (typeof window.JKPInit === "function") {
        window.JKPInit();
      } else {
        document.addEventListener("DOMContentLoaded", () => {
          if (typeof window.JKPInit === "function") window.JKPInit();
        });
      }
    } catch (err) {
      showBootError(err);
    }
  })();
})();
