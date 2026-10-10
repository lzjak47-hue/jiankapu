/* ============================================================================
   简卡铺 · 全站交互脚本
   ----------------------------------------------------------------------------
   数据与接口全部来自后端（见 data.js 与 /api/public/*）：
     · 商品/分类/公告      → GET  /api/public/bootstrap
     · 下单（锁定卡密）    → POST /api/public/orders
     · 支付并发货          → POST /api/public/orders/:no/pay
     · 轮询订单状态        → GET  /api/public/orders/:no
     · 查单                → GET  /api/public/orders/query

   data.js 拿到数据后会调用 window.JKPInit()，本文件在末尾提供该函数。
   ========================================================================== */

(function () {
  "use strict";

  /* 数据要等 data.js 跑完 bootstrap 才可用，用函数取而不是缓存引用 */
  const DATA = () => window.JKP_DATA;
  const API = () => window.JKP_API;

  /* ==========================================================================
     1. 通用工具
     ========================================================================== */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function money(n) {
    const v = Number(n) || 0;
    return v % 1 === 0 ? String(v) : v.toFixed(2);
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function param(name) {
    const m = new RegExp("[?&]" + name + "=([^&#]*)").exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }

  /* 轻提示 */
  let toastWrap = null;
  function toast(message, icon) {
    if (!toastWrap) {
      toastWrap = document.createElement("div");
      toastWrap.className = "toast-wrap";
      document.body.appendChild(toastWrap);
    }
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML =
      (icon ? "<span>" + icon + "</span>" : "") + "<span>" + escapeHtml(message) + "</span>";
    toastWrap.appendChild(el);
    setTimeout(() => {
      el.classList.add("is-out");
      setTimeout(() => el.remove(), 260);
    }, 1900);
  }

  /* 复制到剪贴板（带降级方案） */
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch {
      toast("复制失败，请手动选择复制", "⚠️");
    }
    ta.remove();
  }
  function copyText(text, tip) {
    const done = () => toast(tip || "已复制到剪贴板", "✅");
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  const findProduct = (id) => DATA().products.find((p) => p.id === id) || null;

  function catName(id) {
    const c = DATA().categories.find((x) => x.id === id);
    return c ? c.name : "商品";
  }

  function stockText(p) {
    if (p.stock <= 0) return '<span class="dim">已售罄</span>';
    if (p.stock < 20) return '<span style="color:var(--warning)">仅剩 ' + p.stock + " 件</span>";
    return '<span style="color:var(--success)">库存充足</span>';
  }

  /* ==========================================================================
     2. 公告轮播
     ========================================================================== */
  function initAnnounce() {
    const track = $("#announceTrack");
    const list = DATA().announcements || [];
    if (!track || list.length === 0) return;

    track.innerHTML = list
      .map(
        (t, i) =>
          '<div class="announce-item' + (i === 0 ? " is-on" : "") + '">🔔<span>' + escapeHtml(t) + "</span></div>"
      )
      .join("");

    const items = $$(".announce-item", track);
    if (items.length < 2) return;
    let idx = 0;
    setInterval(() => {
      items[idx].classList.remove("is-on");
      idx = (idx + 1) % items.length;
      items[idx].classList.add("is-on");
    }, 4200);
  }

  /* ==========================================================================
     3. 商品卡片渲染
     ========================================================================== */
  function cardHtml(p) {
    const soldOut = p.stock <= 0;
    const badge = p.badge
      ? '<span class="tag ' + (p.badgeType ? "tag-" + p.badgeType : "") + ' badge">' + escapeHtml(p.badge) + "</span>"
      : "";
    const href = "product.html?id=" + encodeURIComponent(p.id);
    return (
      '<article class="card reveal" data-id="' + p.id + '">' +
      '<a class="card-media" href="' + href + '">' + badge +
      '<span class="thumb-emoji">' + p.emoji + "</span>" +
      (soldOut ? '<span class="sold-out">已 售 罄</span>' : "") +
      "</a>" +
      '<div class="card-body">' +
      '<a class="card-title" href="' + href + '">' + escapeHtml(p.name) + "</a>" +
      '<div class="card-meta"><span>已售 ' + p.sold + '</span><span class="dim">·</span><span>' +
      stockText(p) + "</span></div>" +
      '<div class="card-foot">' +
      '<div class="price"><span class="cur">¥</span><span class="val">' + money(p.price) + "</span>" +
      (p.oldPrice ? '<span class="old">¥' + money(p.oldPrice) + "</span>" : "") +
      "</div>" +
      '<button class="btn btn-primary btn-sm buy-btn" data-id="' + p.id + '"' +
      (soldOut ? " disabled" : "") + ">" + (soldOut ? "已售罄" : "立即购买") + "</button>" +
      "</div></div></article>"
    );
  }

  function renderGrid(list) {
    const grid = $("#productGrid");
    if (!grid) return;
    const count = $("#resultCount");
    if (!list.length) {
      grid.innerHTML =
        '<div class="empty" style="grid-column:1/-1"><div class="ico">🔍</div><p>没有找到相关商品，换个关键词试试</p></div>';
      if (count) count.textContent = "";
      return;
    }
    grid.innerHTML = list.map(cardHtml).join("");
    if (count) count.textContent = "共 " + list.length + " 件商品";
    observeReveal(grid);
  }

  /* ==========================================================================
     4. 分类筛选 / 排序 / 搜索
     ========================================================================== */
  function initCatalog() {
    const tabsEl = $("#categoryTabs");
    if (!tabsEl) return;

    const sortEl = $("#sortSelect");
    const searchEl = $("#searchInput");
    const headerSearch = $("#headerSearch");
    const state = { cat: "all", sort: "default", keyword: param("q") || "" };

    const cats = [{ id: "all", name: "全部商品" }].concat(DATA().categories);
    tabsEl.innerHTML = cats
      .map(
        (c) =>
          '<button class="tab' + (c.id === "all" ? " is-active" : "") + '" data-cat="' + c.id + '">' +
          escapeHtml(c.name) + "</button>"
      )
      .join("");

    function apply() {
      let list = DATA().products.slice();
      if (state.cat !== "all") list = list.filter((p) => p.category === state.cat);
      if (state.keyword) {
        const kw = state.keyword.toLowerCase();
        list = list.filter((p) => (p.name + (p.desc || "")).toLowerCase().includes(kw));
      }
      if (state.sort === "price-asc") list.sort((a, b) => a.price - b.price);
      else if (state.sort === "price-desc") list.sort((a, b) => b.price - a.price);
      else if (state.sort === "sold") list.sort((a, b) => b.sold - a.sold);
      else if (state.sort === "stock") list.sort((a, b) => b.stock - a.stock);
      renderGrid(list);
    }

    tabsEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      $$(".tab", tabsEl).forEach((t) => t.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.cat = btn.dataset.cat;
      apply();
    });

    if (sortEl) sortEl.addEventListener("change", () => { state.sort = sortEl.value; apply(); });
    if (searchEl) {
      searchEl.addEventListener("input", () => { state.keyword = searchEl.value.trim(); apply(); });
    }
    if (headerSearch) {
      headerSearch.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const kw = headerSearch.value.trim();
        if (kw) location.href = "index.html?q=" + encodeURIComponent(kw) + "#catalog";
      });
    }

    if (searchEl && state.keyword) searchEl.value = state.keyword;
    apply();
  }

  /* ==========================================================================
     5. 下单 → 支付 → 发货（真实接口）
     ========================================================================== */
  const STEPS = ["确认订单", "选择支付", "扫码支付", "获取卡密"];
  let buyState = null;

  function ensureModal() {
    if ($("#buyOverlay")) return;
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="overlay" id="buyOverlay">' +
        '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h3 id="buyTitle">确认订单</h3>' +
        '<button class="modal-close" id="buyClose" aria-label="关闭">✕</button></div>' +
        '<div class="stepper" id="buyStepper"></div>' +
        '<div class="modal-body" id="buyBody"></div>' +
        "</div></div>"
    );

    $("#buyClose").addEventListener("click", closeBuy);
    $("#buyOverlay").addEventListener("click", (e) => {
      if (e.target === $("#buyOverlay")) closeBuy();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeBuy();
    });
    /* 事件委托只绑一次：弹窗内容会反复重绘 */
    $("#buyBody").addEventListener("click", handleBuyClick);
  }

  function stepperHtml(current) {
    return STEPS.map((name, i) => {
      const cls = i < current ? "is-done" : i === current ? "is-on" : "";
      return (
        '<div class="s ' + cls + '"><span class="n">' + (i < current ? "✓" : i + 1) + "</span>" + name + "</div>" +
        (i < STEPS.length - 1 ? '<span class="line"></span>' : "")
      );
    }).join("");
  }

  function openBuy(product) {
    if (!product || product.stock <= 0) return;
    ensureModal();
    buyState = {
      product,
      spec: product.specs && product.specs.length ? product.specs[0] : "",
      qty: 1,
      pay: "wx",
      contact: "",
      step: 0,
      order: null,
      secrets: [],
      busy: false,
      remain: 0,
      timer: null,
      poll: null,
    };
    renderBuy();
    $("#buyOverlay").classList.add("is-open");
    document.body.classList.add("is-locked");
  }

  function stopTimers() {
    if (!buyState) return;
    if (buyState.timer) { clearInterval(buyState.timer); buyState.timer = null; }
    if (buyState.poll) { clearInterval(buyState.poll); buyState.poll = null; }
  }

  function closeBuy() {
    const ov = $("#buyOverlay");
    if (ov) ov.classList.remove("is-open");
    document.body.classList.remove("is-locked");
    stopTimers();
  }

  const totalPrice = () => buyState.product.price * buyState.qty;
  const payMethodLabel = (key) => (key === "ali" ? "支付宝" : "微信支付");

  function renderBuy() {
    const s = buyState;
    const p = s.product;
    $("#buyTitle").textContent = STEPS[s.step];
    $("#buyStepper").innerHTML = stepperHtml(s.step);
    const body = $("#buyBody");

    if (s.step === 0) {
      body.innerHTML =
        '<div class="summary">' +
        '<div class="summary-row"><span class="k">商品</span><span class="v">' + escapeHtml(p.name) + "</span></div>" +
        (p.specs && p.specs.length
          ? '<div class="spec-block" style="margin:14px 0 0"><div class="label">选择规格</div><div class="spec-list">' +
            p.specs
              .map((sp) => '<button class="spec' + (sp === s.spec ? " is-active" : "") + '" data-spec="' + escapeHtml(sp) + '">' + escapeHtml(sp) + "</button>")
              .join("") +
            "</div></div>"
          : "") +
        '<div class="flex items-center justify-between mt-24"><span class="k">购买数量</span>' +
        '<div class="qty"><button type="button" data-qty="-1">−</button>' +
        '<input id="buyQty" type="text" inputmode="numeric" value="' + s.qty + '" />' +
        '<button type="button" data-qty="1">＋</button></div></div>' +
        '<div class="field mt-24" style="margin-bottom:0"><label for="buyContact">联系方式（选填）</label>' +
        '<input class="input" id="buyContact" type="text" placeholder="手机号或邮箱，便于售后与找回订单" value="' + escapeHtml(s.contact) + '" />' +
        '<div class="hint">留空也可以，凭订单号随时可查询卡密。</div></div>' +
        '<div class="summary-row total"><span class="k">应付金额</span><span class="v" id="buyTotal">¥' + money(totalPrice()) + "</span></div>" +
        "</div>" +
        '<button class="btn btn-primary btn-lg btn-block mt-24" id="buyNext"' + (s.busy ? " disabled" : "") + ">去支付</button>" +
        '<p class="small dim mt-12" style="text-align:center">🔒 下单后卡密将被锁定 ' +
        ((DATA().settings && DATA().settings.trade && DATA().settings.trade.autoCloseMinutes) || 15) +
        " 分钟</p>";
    } else if (s.step === 1) {
      body.innerHTML =
        '<div class="summary">' +
        '<div class="summary-row"><span class="k">' + escapeHtml(p.name) + (s.spec ? " · " + escapeHtml(s.spec) : "") + '</span><span class="v">×' + s.qty + "</span></div>" +
        '<div class="summary-row total"><span class="k">应付金额</span><span class="v">¥' + money(totalPrice()) + "</span></div>" +
        "</div>" +
        '<div class="spec-block mt-24"><div class="label">选择支付方式</div>' +
        '<div class="pay-methods">' +
        '<button class="pay-method' + (s.pay === "wx" ? " is-active" : "") + '" data-pay="wx"><span class="ico wx">💬</span>微信支付</button>' +
        '<button class="pay-method' + (s.pay === "ali" ? " is-active" : "") + '" data-pay="ali"><span class="ico ali">🅰️</span>支付宝</button>' +
        "</div></div>" +
        '<button class="btn btn-primary btn-lg btn-block mt-24" id="buyNext"' + (s.busy ? " disabled" : "") + ">" +
        (s.busy ? "正在创建订单…" : "确认支付 ¥" + money(totalPrice())) + "</button>" +
        '<button class="btn btn-ghost btn-block mt-12" id="buyBack"' + (s.busy ? " disabled" : "") + ">返回修改</button>";
    } else if (s.step === 2) {
      const o = s.order || {};
      body.innerHTML =
        '<div class="qr-box">' +
        '<div class="qr-frame" id="qrFrame">' + (o.qrSvg || "") + "</div>" +
        '<p class="qr-note">请使用<strong>' + payMethodLabel(s.pay) + "</strong>扫描二维码完成支付</p>" +
        '<p class="small dim mt-8">剩余支付时间 <span class="countdown" id="payCountdown">--:--</span></p>' +
        "</div>" +
        '<div class="summary mt-16">' +
        '<div class="summary-row"><span class="k">订单号</span><span class="v mono" style="font-size:12.5px">' + escapeHtml(o.no || "") + "</span></div>" +
        '<div class="summary-row total"><span class="k">应付金额</span><span class="v">¥' + money(o.amount || totalPrice()) + "</span></div>" +
        "</div>" +
        '<button class="btn btn-primary btn-lg btn-block mt-24" id="payDone"' + (s.busy ? " disabled" : "") + ">" +
        (s.busy ? "正在确认…" : "我已完成支付") + "</button>" +
        '<button class="btn btn-ghost btn-block mt-12" id="buyCancel"' + (s.busy ? " disabled" : "") + ">取消订单</button>" +
        '<div class="notice mt-16"><span>💡</span><span>当前为演示支付环节：点「我已完成支付」即模拟支付成功。接入真实支付网关后，本页会通过轮询订单状态自动跳转。</span></div>';
    } else {
      body.innerHTML =
        '<div class="success-box">' +
        '<div class="success-ico">✓</div>' +
        '<h3 class="h3">支付成功，卡密已发货</h3>' +
        '<p class="small dim mt-8">订单号 ' + escapeHtml(s.order ? s.order.no : "") + "</p>" +
        "</div>" +
        '<div class="secret-list mt-24">' +
        s.secrets
          .map(
            (sec, i) =>
              '<div class="secret-item"><span class="idx">' + (i + 1) + "</span><code>" + escapeHtml(sec) + "</code>" +
              '<button class="btn btn-soft btn-sm" data-copy="' + escapeHtml(sec) + '">复制</button></div>'
          )
          .join("") +
        "</div>" +
        '<button class="btn btn-primary btn-lg btn-block mt-24" id="copyAll">一键复制全部卡密</button>' +
        '<a class="btn btn-ghost btn-block mt-12" href="query.html?no=' + encodeURIComponent(s.order ? s.order.no : "") + '">前往查询订单</a>' +
        '<div class="notice mt-16"><span>⚠️</span><span>卡密为虚拟商品，请妥善保管，泄露或已激活不支持退换。</span></div>';
    }
    bindBuyInputs();
  }

  function bindBuyInputs() {
    const contact = $("#buyContact");
    if (contact) contact.addEventListener("input", () => { buyState.contact = contact.value; });

    const qty = $("#buyQty");
    if (qty) {
      qty.addEventListener("change", () => {
        const v = parseInt(qty.value, 10);
        buyState.qty = Number.isNaN(v) ? 1 : Math.max(1, Math.min(50, v));
        renderBuy();
      });
    }
  }

  async function handleBuyClick(e) {
    const s = buyState;
    if (!s) return;
    const t = e.target;

    const specBtn = t.closest(".spec");
    if (specBtn) {
      $$(".spec", $("#buyBody")).forEach((b) => b.classList.remove("is-active"));
      specBtn.classList.add("is-active");
      s.spec = specBtn.dataset.spec;
      return;
    }

    const qtyBtn = t.closest("[data-qty]");
    if (qtyBtn) {
      s.qty = Math.max(1, Math.min(50, s.qty + Number(qtyBtn.dataset.qty)));
      const input = $("#buyQty");
      if (input) input.value = s.qty;
      const total = $("#buyTotal");
      if (total) total.textContent = "¥" + money(totalPrice());
      return;
    }

    const payBtn = t.closest(".pay-method");
    if (payBtn) {
      $$(".pay-method", $("#buyBody")).forEach((b) => b.classList.remove("is-active"));
      payBtn.classList.add("is-active");
      s.pay = payBtn.dataset.pay;
      return;
    }

    if (t.closest("#buyNext")) {
      if (s.busy) return;

      if (s.step === 0) {
        s.step = 1;
        renderBuy();
        return;
      }
      if (s.step === 1) {
        s.busy = true;
        renderBuy();
        try {
          const order = await API().createOrder({
            productId: s.product.id,
            spec: s.spec,
            qty: s.qty,
            contact: s.contact,
            payMethod: payMethodLabel(s.pay),
          });
          s.order = order;
          s.remain = order.remainSeconds || order.payWindowSeconds || 900;
          s.step = 2;
          s.busy = false;
          renderBuy();
          startPayStage();
        } catch (err) {
          s.busy = false;
          renderBuy();
          toast(err.message || "下单失败，请重试", "⚠️");
        }
      }
      return;
    }

    if (t.closest("#buyBack")) {
      s.step = 0;
      renderBuy();
      return;
    }

    if (t.closest("#payDone")) {
      if (s.busy || !s.order) return;
      s.busy = true;
      renderBuy();
      try {
        const order = await API().payOrder(s.order.no);
        finishPaid(order);
      } catch (err) {
        s.busy = false;
        renderBuy();
        restartTimers();
        toast(err.message || "支付确认失败", "⚠️");
      }
      return;
    }

    if (t.closest("#buyCancel")) {
      if (s.busy || !s.order) return closeBuy();
      s.busy = true;
      try {
        await API().cancelOrder(s.order.no);
        toast("订单已取消，卡密已退回库存", "🚫");
        closeBuy();
      } catch (err) {
        s.busy = false;
        renderBuy();
        restartTimers();
        toast(err.message || "取消失败", "⚠️");
      }
      return;
    }

    const copyBtn = t.closest("[data-copy]");
    if (copyBtn) {
      copyText(copyBtn.dataset.copy, "卡密已复制");
      return;
    }
    if (t.closest("#copyAll")) {
      copyText($$("#buyBody code").map((c) => c.textContent).join("\n"), "已复制全部卡密");
    }
  }

  /* --------------------------------------------------------------- 支付阶段 */

  function startPayStage() {
    stopTimers();
    tickCountdown();
    buyState.timer = setInterval(tickCountdown, 1000);
    /* 轮询订单状态：接入真实支付网关后，这里就是「支付完成自动跳转」的关键 */
    buyState.poll = setInterval(pollOrder, 3000);
  }

  function restartTimers() {
    if (buyState && buyState.step === 2 && buyState.order) startPayStage();
  }

  function tickCountdown() {
    const s = buyState;
    if (!s || s.step !== 2) return;
    const el = $("#payCountdown");
    s.remain = Math.max(0, s.remain - 1);
    if (el) {
      const m = Math.floor(s.remain / 60);
      const sec = s.remain % 60;
      el.textContent = String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
    }
    if (s.remain <= 0) {
      stopTimers();
      toast("支付超时，订单已关闭", "⏰");
      closeBuy();
    }
  }

  async function pollOrder() {
    const s = buyState;
    if (!s || s.step !== 2 || s.busy || !s.order) return;
    try {
      const order = await API().getOrder(s.order.no);
      if (order.status === "已发货") finishPaid(order);
      else if (order.status === "已关闭") {
        stopTimers();
        toast("订单已关闭，卡密已退回库存", "⏰");
        closeBuy();
      }
    } catch {
      /* 轮询失败不打扰用户，下一轮再试 */
    }
  }

  function finishPaid(order) {
    stopTimers();
    buyState.order = order;
    buyState.secrets = order.secrets || [];
    buyState.step = 3;
    buyState.busy = false;
    renderBuy();
    refreshCatalog(); // 库存已变化，刷新列表数字
  }

  /** 支付成功后重新拉一次数据，保证库存与销量显示准确 */
  async function refreshCatalog() {
    if (!$("#productGrid")) return;
    try {
      const data = await API().bootstrap();
      DATA().products = data.products;
      DATA().categories = data.categories;

      const activeTab = $("#categoryTabs") && $("#categoryTabs").querySelector(".tab.is-active");
      const cat = activeTab ? activeTab.dataset.cat : "all";
      const kw = ($("#searchInput") && $("#searchInput").value.trim().toLowerCase()) || "";
      let list = DATA().products.slice();
      if (cat && cat !== "all") list = list.filter((p) => p.category === cat);
      if (kw) list = list.filter((p) => (p.name + (p.desc || "")).toLowerCase().includes(kw));
      renderGrid(list);
    } catch {
      /* 刷新失败不影响主流程 */
    }
  }

  /* ==========================================================================
     6. 商品详情页
     ========================================================================== */
  function initDetail() {
    const host = $("#detailRoot");
    if (!host) return;

    const p = findProduct(param("id")) || DATA().products[0];
    if (!p) {
      host.innerHTML =
        '<div class="empty" style="padding:80px 0"><div class="ico">📦</div><p>商品不存在或已下架</p>' +
        '<p class="mt-12"><a class="btn btn-primary" href="index.html">回到首页</a></p></div>';
      return;
    }
    document.title = p.name + " · " + ((DATA().settings && DATA().settings.site && DATA().settings.site.name) || "简卡铺");

    const soldOut = p.stock <= 0;
    let chosenSpec = p.specs && p.specs.length ? p.specs[0] : "";
    let qtyVal = 1;

    host.innerHTML =
      '<div class="breadcrumb"><a href="index.html">首页</a><span class="sep">/</span>' +
      "<span>" + escapeHtml(catName(p.category)) + '</span><span class="sep">/</span><span>' + escapeHtml(p.name) + "</span></div>" +
      '<div class="detail">' +
      '<div class="detail-media">' + p.emoji + "</div>" +
      "<div>" +
      '<h1 class="detail-title">' + escapeHtml(p.name) + "</h1>" +
      '<div class="flex items-center gap-12 mt-12">' +
      '<span class="tag ' + (p.badgeType ? "tag-" + p.badgeType : "") + '">' + escapeHtml(p.badge || "自动发货") + "</span>" +
      '<span class="small dim">已售 ' + p.sold + ' 件</span><span class="small dim">·</span>' +
      '<span class="small">' + stockText(p) + "</span></div>" +
      '<p class="muted mt-16">' + escapeHtml(p.desc || "") + "</p>" +
      '<div class="price-box"><div class="price"><span class="cur">¥</span><span class="val">' + money(p.price) + "</span>" +
      (p.oldPrice ? '<span class="old">¥' + money(p.oldPrice) + "</span>" : "") +
      "</div>" + (p.oldPrice ? '<span class="save">立省 ¥' + money(p.oldPrice - p.price) + "</span>" : "") + "</div>" +
      (p.specs && p.specs.length
        ? '<div class="spec-block"><div class="label">选择规格</div><div class="spec-list" id="detailSpecs">' +
          p.specs
            .map((sp, i) => '<button class="spec' + (i === 0 ? " is-active" : "") + '" data-spec="' + escapeHtml(sp) + '">' + escapeHtml(sp) + "</button>")
            .join("") +
          "</div></div>"
        : "") +
      '<div class="spec-block"><div class="label">购买数量</div>' +
      '<div class="qty" id="detailQty"><button type="button" data-qty="-1">−</button>' +
      '<input type="text" inputmode="numeric" value="1" />' +
      '<button type="button" data-qty="1">＋</button></div></div>' +
      '<div class="buy-row"><button class="btn btn-primary btn-lg" id="detailBuy"' + (soldOut ? " disabled" : "") + ">" +
      (soldOut ? "已售罄" : "立即购买") + "</button>" +
      '<button class="btn btn-ghost btn-lg" id="detailQuery">查询订单</button></div>' +
      '<div class="notice"><span>⚡</span><span><strong>自动发货</strong>：支付成功后系统立即发放卡密，24 小时无人值守，无需等待人工。</span></div>' +
      "</div></div>" +
      '<div class="section-sm" style="margin-top:40px">' +
      '<div class="tabs-line" id="detailTabs">' +
      '<button class="is-active" data-tab="detail">商品详情</button>' +
      '<button data-tab="notice">购买须知</button>' +
      '<button data-tab="tutorial">使用教程</button>' +
      "</div>" +
      '<div class="prose" id="detailPane"></div>' +
      "</div>";

    const panes = {
      detail: "<h4>商品说明</h4><p>" + escapeHtml(p.detail || p.desc || "") + "</p>",
      notice:
        "<h4>购买须知</h4><ul>" +
        (p.notice || []).map((t) => "<li>" + escapeHtml(t) + "</li>").join("") +
        "<li>如遇任何问题，请通过右下角在线客服联系我们。</li></ul>",
      tutorial:
        "<h4>使用步骤</h4><ol style='list-style:none'>" +
        (p.tutorial || [])
          .map((t, i) => "<li style='padding-left:0'><strong>" + (i + 1) + ".</strong> " + escapeHtml(t) + "</li>")
          .join("") +
        "</ol>",
    };

    const paint = (key) => { $("#detailPane").innerHTML = panes[key]; };
    paint("detail");

    $("#detailTabs").addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      $$("button", $("#detailTabs")).forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      paint(btn.dataset.tab);
    });

    const qtyBox = $("#detailQty");
    qtyBox.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-qty]");
      if (!btn) return;
      qtyVal = Math.max(1, Math.min(50, qtyVal + Number(btn.dataset.qty)));
      $("input", qtyBox).value = qtyVal;
    });

    const specsEl = $("#detailSpecs");
    if (specsEl) {
      specsEl.addEventListener("click", (e) => {
        const btn = e.target.closest(".spec");
        if (!btn) return;
        $$(".spec", specsEl).forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        chosenSpec = btn.dataset.spec;
      });
    }

    $("#detailBuy").addEventListener("click", () => {
      openBuy(p);
      if (!buyState) return;
      if (chosenSpec) buyState.spec = chosenSpec;
      buyState.qty = qtyVal;
      renderBuy();
    });
    $("#detailQuery").addEventListener("click", () => { location.href = "query.html"; });

    observeReveal(host);
  }

  /* ==========================================================================
     7. 订单查询
     ========================================================================== */
  function initQuery() {
    const form = $("#queryForm");
    if (!form) return;

    const input = $("#queryInput");
    const result = $("#queryResult");

    function renderOrder(order) {
      const cls =
        { 已发货: "tag-success", 待付款: "tag-accent", 已关闭: "tag-muted", 已退款: "tag-muted" }[order.status] ||
        "tag-muted";

      return (
        '<div class="panel" style="margin-bottom:16px">' +
        '<div class="panel-head"><span class="tag ' + cls + '"><span class="dot"></span>' + escapeHtml(order.status) + "</span>" +
        '<strong style="font-size:14px">订单号 ' + escapeHtml(order.no) + "</strong>" +
        '<span class="small dim" style="margin-left:auto">' + escapeHtml(order.createdAt) + "</span></div>" +
        '<div class="panel-body">' +
        '<div class="kv">' +
        kv("商品", order.product) +
        kv("规格", order.spec || "—") +
        kv("数量", order.qty) +
        kv("支付方式", order.payMethod) +
        kv("订单金额", "¥" + money(order.amount)) +
        "</div>" +
        '<h4 class="h3 mt-24" style="margin-bottom:12px">卡密内容</h4>' +
        (order.status === "已发货" && order.secrets.length
          ? '<div class="secret-list">' +
            order.secrets
              .map(
                (sec, i) =>
                  '<div class="secret-item"><span class="idx">' + (i + 1) + "</span><code>" + escapeHtml(sec) + "</code>" +
                  '<button class="btn btn-soft btn-sm" data-copy="' + escapeHtml(sec) + '">复制</button></div>'
              )
              .join("") +
            "</div>" +
            '<button class="btn btn-primary btn-block mt-24" id="queryCopyAll">一键复制全部</button>'
          : '<div class="empty" style="padding:26px 0"><div class="ico">' +
            (order.status === "待付款" ? "⏳" : "📭") +
            "</div><p>" +
            (order.status === "待付款"
              ? "订单尚未支付，完成后即可查看卡密"
              : order.status === "已关闭"
                ? "订单已关闭，卡密已退回库存"
                : "该订单暂无卡密") +
            "</p></div>") +
        "</div></div>"
      );
    }

    async function doQuery(keyword) {
      if (!keyword) {
        toast("请输入订单号或联系方式", "⚠️");
        input.focus();
        return;
      }
      result.innerHTML = '<div class="panel"><div class="panel-body"><div class="skeleton" style="height:120px"></div></div></div>';
      try {
        const data = await API().queryOrders(keyword);
        result.innerHTML = data.orders.map(renderOrder).join("");
      } catch (err) {
        result.innerHTML =
          '<div class="panel"><div class="empty"><div class="ico">📭</div><p>' +
          escapeHtml(err.message || "没有查询到该订单") +
          '</p><p class="small dim mt-8">订单号在下单成功页面可以复制；也可用下单时填写的联系方式查询。</p></div></div>';
      }
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      doQuery((input.value || "").trim());
    });

    result.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-copy]");
      if (btn) return copyText(btn.dataset.copy, "卡密已复制");
      if (e.target.closest("#queryCopyAll")) {
        copyText($$("code", result).map((c) => c.textContent).join("\n"), "已复制全部卡密");
      }
    });

    /* 支持 query.html?no=xxx 直接查询 */
    const preset = param("no");
    if (preset) {
      input.value = preset;
      doQuery(preset);
    }
  }

  function kv(k, v) {
    return '<div><div class="k">' + escapeHtml(k) + '</div><div class="v">' + escapeHtml(v) + "</div></div>";
  }

  /* ==========================================================================
     8. 全局交互
     ========================================================================== */
  let io = null;
  function observeReveal(root) {
    const nodes = $$(".reveal", root || document);
    if (!("IntersectionObserver" in window)) {
      nodes.forEach((n) => n.classList.add("is-in"));
      return;
    }
    if (!io) {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) {
              en.target.classList.add("is-in");
              io.unobserve(en.target);
            }
          });
        },
        { rootMargin: "0px 0px -40px 0px", threshold: 0.05 }
      );
    }
    nodes.forEach((n) => {
      if (!n.classList.contains("is-in")) io.observe(n);
    });
  }

  function initGlobal() {
    document.addEventListener("click", (e) => {
      const buy = e.target.closest(".buy-btn");
      if (buy) {
        e.preventDefault();
        openBuy(findProduct(buy.dataset.id));
        return;
      }
      if (e.target.closest("#navToggle")) {
        const nav = $("#mainNav");
        if (nav) nav.classList.toggle("is-open");
      }
    });

    $$("[data-year]").forEach((el) => { el.textContent = new Date().getFullYear(); });
  }

  /* ==========================================================================
     启动（由 data.js 在数据就绪后调用）
     ========================================================================== */
  function boot() {
    if (!DATA().ready) return;
    initGlobal();
    initAnnounce();
    initCatalog();
    initDetail();
    initQuery();
    observeReveal(document);
  }

  window.JKPInit = boot;
})();
