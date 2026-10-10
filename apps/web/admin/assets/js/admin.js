/* ============================================================================
   简卡铺 · 后台脚本
   ----------------------------------------------------------------------------
   1. 壳层注入：侧边栏 / 顶栏统一渲染，页面只需在 <body> 声明
      data-page（当前菜单 key）、data-title（标题）、data-sub（副标题）
   2. 各页面逻辑：按 data-page 初始化，数据全部来自 /api/admin/*
   ========================================================================== */

(function () {
  "use strict";

  const UI = window.JKPUI;
  const API = window.JKP_ADMIN_API;
  const NAV = window.JKP_ADMIN_NAV || [];
  const $ = UI.$;
  const $$ = UI.$$;
  const esc = UI.escapeHtml;

  /**
   * 前台站点地址。后台与前台分端口部署，跨端口跳转必须用绝对地址。
   * 服务端会往每个 HTML 的 <head> 注入 window.JKP_RUNTIME，这里优先取它。
   */
  const SITE_BASE =
    (window.JKP_RUNTIME && window.JKP_RUNTIME.siteBase) ||
    `http://${location.hostname}:2001`;

  /** 当前登录管理员 */
  let currentAdmin = null;

  /** 统一的异步错误提示 */
  async function run(fn, errTip) {
    try {
      return await fn();
    } catch (err) {
      UI.toast(err.message || errTip || "操作失败", "⚠️");
      return null;
    }
  }

  const skeletonRow = (cols, height) =>
    '<tr><td colspan="' + cols + '"><div class="skeleton" style="height:' + (height || 180) + 'px"></div></td></tr>';

  const emptyRow = (cols, icon, text) =>
    '<tr><td colspan="' + cols + '"><div class="empty" style="padding:40px 0"><div class="ico">' + icon +
    "</div><p>" + esc(text) + "</p></div></td></tr>";

  /* ==========================================================================
     一、壳层
     ========================================================================== */
  function sidebarHtml(active) {
    const groups = NAV.map((g) => {
      const items = g.items
        .map(
          (it) =>
            '<a class="nav-item' + (it.key === active ? " is-active" : "") + '" href="' + it.href + '">' +
            '<span class="ico">' + it.icon + "</span><span>" + esc(it.name) + "</span></a>"
        )
        .join("");
      return '<div class="nav-group-title">' + esc(g.group) + "</div>" + items;
    }).join("");

    return (
      '<a class="sidebar-brand" href="index.html">' +
      '<span class="logo-mark">简</span><span>简卡铺</span><span class="env">管理后台</span></a>' +
      '<nav class="sidebar-nav">' + groups + "</nav>" +
      '<div class="sidebar-foot">' +
      '<a href="' + SITE_BASE + '" target="_blank">🌐 查看前台站点</a>' +
      '<a href="#" id="logoutLink">🚪 退出登录</a>' +
      "</div>"
    );
  }

  function topbarHtml(title, sub) {
    const acc = currentAdmin || { nickname: "管理员", role: "" };
    return (
      '<button class="sidebar-toggle" id="sidebarToggle" aria-label="展开菜单">☰</button>' +
      '<div><div class="topbar-title">' + esc(title) + "</div>" +
      (sub ? '<div class="topbar-sub">' + esc(sub) + "</div>" : "") + "</div>" +
      '<div class="topbar-actions">' +
      '<button class="btn btn-ghost btn-sm" id="topbarNotice">🔔 通知</button>' +
      '<a class="btn btn-soft btn-sm" href="' + SITE_BASE + '" target="_blank">查看前台</a>' +
      '<div class="admin-user" id="adminUser">' +
      '<span class="admin-avatar">' + esc(String(acc.nickname).slice(0, 1)) + "</span>" +
      '<span class="meta"><span class="name">' + esc(acc.nickname) + "</span>" +
      (acc.role ? '<span class="role"> · ' + esc(acc.role) + "</span>" : "") +
      "</span></div></div>"
    );
  }

  async function mountShell() {
    const page = document.body.dataset.page || "";
    const title = document.body.dataset.title || "管理后台";
    const sub = document.body.dataset.sub || "";

    /* 先确认登录态；未登录会被 API 层跳转到登录页 */
    const me = await API.me().catch(() => null);
    if (!me) return false;
    currentAdmin = me.admin;

    const sidebar = $("#adminSidebar");
    if (sidebar) sidebar.innerHTML = sidebarHtml(page);

    const topbar = $("#adminTopbar");
    if (topbar) topbar.innerHTML = topbarHtml(title, sub);

    const backdrop = document.createElement("div");
    backdrop.className = "sidebar-backdrop";
    backdrop.id = "sidebarBackdrop";
    document.body.appendChild(backdrop);

    document.addEventListener("click", async (e) => {
      const sw = e.target.closest(".switch");
      if (sw && !sw.hasAttribute("data-no-toggle")) {
        sw.classList.toggle("is-on");
        return;
      }
      if (e.target.closest("#sidebarToggle")) {
        if (sidebar) sidebar.classList.toggle("is-open");
        backdrop.classList.toggle("is-open", !!(sidebar && sidebar.classList.contains("is-open")));
        return;
      }
      if (e.target.closest("#sidebarBackdrop")) {
        if (sidebar) sidebar.classList.remove("is-open");
        backdrop.classList.remove("is-open");
        return;
      }
      if (e.target.closest("#logoutLink")) {
        e.preventDefault();
        await run(async () => {
          await API.logout();
          location.href = "login.html";
        });
        return;
      }
      if (e.target.closest("#topbarNotice")) {
        UI.toast("可在订单与卡密页面查看待处理与库存预警", "🔔");
        return;
      }
      if (e.target.closest("#adminUser")) {
        UI.toast("当前登录：" + currentAdmin.nickname + "（" + currentAdmin.username + "）", "👤");
      }
    });

    return true;
  }

  /* ==========================================================================
     二、公共片段
     ========================================================================== */
  const ORDER_STATUS_CLASS = {
    已发货: "on",
    处理中: "info",
    待付款: "warn",
    已关闭: "off",
    已退款: "off",
    失败: "danger",
  };

  const statusHtml = (text, cls) =>
    '<span class="status ' + (cls || "off") + '">' + esc(text) + "</span>";

  /** 分页条（服务端分页：page / perPage / total） */
  function renderPager(host, info, onPage) {
    if (!host) return;
    const pages = Math.max(1, Math.ceil(info.total / info.perPage));
    if (info.total === 0) {
      host.innerHTML = "";
      return;
    }
    let html =
      '<div class="pagination"><span class="info">共 ' + info.total + " 条 · 第 " + info.page + "/" + pages + " 页</span>";
    html += '<button data-page="' + (info.page - 1) + '"' + (info.page <= 1 ? " disabled" : "") + ">上一页</button>";
    let from = Math.max(1, info.page - 2);
    const to = Math.min(pages, from + 4);
    from = Math.max(1, to - 4);
    for (let i = from; i <= to; i += 1) {
      html += '<button data-page="' + i + '"' + (i === info.page ? ' class="is-active"' : "") + ">" + i + "</button>";
    }
    html +=
      '<button data-page="' + (info.page + 1) + '"' + (info.page >= pages ? " disabled" : "") + ">下一页</button></div>";
    host.innerHTML = html;

    if (host.dataset.pagerBound !== "1") {
      host.dataset.pagerBound = "1";
      host.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-page]");
        if (!btn || btn.disabled) return;
        onPage(Number(btn.dataset.page));
      });
    }
  }

  /** 四个统计卡片 */
  function statCards(items, icons) {
    return items
      .map(
        (x, i) =>
          '<div class="stat-card c' + (i + 1) + '"><div class="top"><span class="label">' + esc(x.l) +
          '</span><span class="ico">' + icons[i] + '</span></div><div class="value">' + x.v +
          (x.u ? '<span class="unit">' + esc(x.u) + "</span>" : "") + "</div></div>"
      )
      .join("");
  }

  /* ==========================================================================
     三、数据概览
     ========================================================================== */
  async function initDashboard() {
    const data = await run(() => API.dashboard(), "概览加载失败");
    if (!data) return;

    const stats = $("#statGrid");
    if (stats) {
      stats.innerHTML = data.stats
        .map((s, i) => {
          const val = s.money ? UI.money(s.value) : UI.int(s.value);
          return (
            '<div class="stat-card c' + (i + 1) + '">' +
            '<div class="top"><span class="label">' + esc(s.label) + '</span><span class="ico">' + s.icon + "</span></div>" +
            '<div class="value">' + val + '<span class="unit">' + esc(s.unit) + "</span></div>" +
            '<div class="delta ' + (s.up ? "up" : "down") + '">' + (s.up ? "▲" : "▼") + " " + esc(s.delta) +
            '<span class="vs">对比昨日</span></div></div>'
          );
        })
        .join("");
    }

    const chart = $("#chart");
    if (chart) {
      const series = data.series.slice();
      const max = Math.max(1, ...series.map((x) => x.orders));
      chart.innerHTML = series
        .map((x) => {
          const h = Math.max(6, Math.round((x.orders / max) * 100));
          return (
            '<div class="chart-col"><div class="chart-bar-wrap">' +
            '<div class="chart-bar" style="height:' + h + '%">' +
            '<span class="tip">' + x.date + " · " + x.orders + " 单 · ¥" + UI.money(x.revenue) + "</span></div></div>" +
            '<span class="chart-label">' + x.date + "</span></div>"
          );
        })
        .join("");
    }

    const top = $("#topProducts");
    if (top) {
      const maxSold = data.topProducts.length ? data.topProducts[0].sold : 1;
      top.innerHTML = data.topProducts
        .map(
          (p, i) =>
            '<li><span class="rank-no">' + (i + 1) + "</span>" +
            '<span class="rank-name" title="' + esc(p.name) + '">' + p.emoji + " " + esc(p.name) +
            '<span class="bar-mini"><i style="width:' + Math.max(4, Math.round((p.sold / maxSold) * 100)) + '%"></i></span></span>' +
            '<span class="rank-val">' + UI.int(p.sold) + " 件</span></li>"
        )
        .join("");
    }

    const body = $("#recentOrdersBody");
    if (body) {
      body.innerHTML = data.recentOrders.length
        ? data.recentOrders
            .map(
              (o) =>
                '<tr><td class="mono nowrap">' + esc(o.no) + "</td>" +
                '<td><div class="cell-main"><span class="cell-thumb">🧾</span><div><div class="t1">' + esc(o.product) +
                '</div><div class="t2">' + esc(o.spec || "—") + " × " + o.qty + "</div></div></div></td>" +
                '<td class="num nowrap">¥' + UI.money(o.amount) + "</td>" +
                "<td>" + statusHtml(o.status, ORDER_STATUS_CLASS[o.status] || "off") + "</td>" +
                '<td class="nowrap dim">' + esc(String(o.time).slice(5, 16)) + "</td></tr>"
            )
            .join("")
        : emptyRow(5, "🧾", "还没有订单");
    }

    const sys = $("#sysInfo");
    if (sys) {
      const s = data.system;
      const rows = [
        ["系统版本", s.version],
        ["运行环境", s.runtime + " · " + s.nodeEnv],
        ["数据库大小", s.dbSizeKb + " KB"],
        ["订单 / 卡密", UI.int(s.totalOrders) + " 笔 / " + UI.int(s.totalCards) + " 条"],
        ["服务运行时长", Math.floor(s.uptimeSeconds / 60) + " 分钟"],
        ["服务器时间", s.serverTime],
      ];
      sys.innerHTML = rows
        .map(
          (r) =>
            '<div class="summary-row"><span class="k">' + esc(r[0]) + '</span><span class="v">' + esc(r[1]) + "</span></div>"
        )
        .join("");
    }
  }

  /* ==========================================================================
     四、商品管理
     ========================================================================== */
  const productState = { keyword: "", category: "", status: "", page: 1, perPage: 8 };

  async function initProducts() {
    const body = $("#productsBody");
    if (!body) return;

    const cats = await run(() => API.categories(), "分类加载失败");
    const sel = $("#productCategory");
    if (sel && cats) {
      sel.innerHTML =
        '<option value="">全部分类</option>' +
        cats.rows.map((c) => '<option value="' + c.id + '">' + esc(c.name) + "</option>").join("");
    }

    const search = $("#productSearch");
    if (search) {
      search.addEventListener(
        "input",
        UI.debounce(() => {
          productState.keyword = search.value.trim();
          productState.page = 1;
          renderProducts();
        })
      );
    }
    if (sel) {
      sel.addEventListener("change", () => {
        productState.category = sel.value;
        productState.page = 1;
        renderProducts();
      });
    }
    const st = $("#productStatus");
    if (st) {
      st.addEventListener("change", () => {
        productState.status = st.value;
        productState.page = 1;
        renderProducts();
      });
    }

    body.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const { act, id, name } = btn.dataset;

      if (act === "edit") {
        location.href = "product-edit.html?id=" + encodeURIComponent(id);
        return;
      }
      if (act === "toggle") {
        const res = await run(() => API.toggleProduct(id), "操作失败");
        if (res) {
          UI.toast(res.status ? "已上架：" + name : "已下架：" + name, res.status ? "✅" : "⚠️");
          renderProducts();
        }
        return;
      }
      if (act === "delete") {
        const ok = await UI.confirmDialog({
          title: "删除商品",
          message: "确定要删除「" + name + "」吗？未售卡密会一并删除，已售卡密保留用于订单追溯。",
          okText: "删除",
          danger: true,
        });
        if (!ok) return;
        const res = await run(() => API.deleteProduct(id), "删除失败");
        if (res) {
          UI.toast("已删除：" + name, "🗑️");
          renderProducts();
        }
      }
    });

    renderProducts();
  }

  async function renderProducts() {
    const body = $("#productsBody");
    if (!body) return;

    body.innerHTML = skeletonRow(8);
    const data = await run(() => API.products(productState), "商品加载失败");
    if (!data) return;
    productState.page = data.page;

    const total = $("#productTotal");
    if (total) total.textContent = "共 " + data.total + " 件商品";

    if (!data.rows.length) {
      body.innerHTML = emptyRow(8, "🔍", "没有符合条件的商品");
    } else {
      body.innerHTML = data.rows
        .map((p) => {
          const low = p.stock > 0 && p.stock < 20;
          return (
            "<tr>" +
            '<td><div class="cell-main"><span class="cell-thumb">' + p.emoji + "</span>" +
            '<div><div class="t1">' + esc(p.name) + '</div><div class="t2">' + esc(p.id) + " · " + esc(p.category) + "</div></div></div></td>" +
            '<td class="num nowrap">¥' + UI.money(p.price) +
            (p.oldPrice ? '<div class="t2 dim" style="text-decoration:line-through">¥' + UI.money(p.oldPrice) + "</div>" : "") + "</td>" +
            '<td class="num nowrap">' + (p.stock > 0 ? UI.int(p.stock) : statusHtml("售罄", "off")) +
            (low ? '<div class="t2" style="color:var(--warning)">库存偏低</div>' : "") + "</td>" +
            '<td class="num nowrap">' + UI.int(p.sold) + "</td>" +
            "<td>" + (p.badge ? '<span class="tag tag-accent">' + esc(p.badge) + "</span>" : '<span class="dim">—</span>') + "</td>" +
            "<td>" + statusHtml(p.status ? "已上架" : "已下架", p.status ? "on" : "off") + "</td>" +
            '<td class="nowrap dim">' + esc(p.createdAt) + "</td>" +
            '<td><div class="row-actions">' +
            '<button data-act="edit" data-id="' + p.id + '">编辑</button><span class="sep"></span>' +
            '<button data-act="toggle" data-id="' + p.id + '" data-name="' + esc(p.name) + '">' + (p.status ? "下架" : "上架") + "</button><span class=\"sep\"></span>" +
            '<button class="danger" data-act="delete" data-id="' + p.id + '" data-name="' + esc(p.name) + '">删除</button>' +
            "</div></td></tr>"
          );
        })
        .join("");
    }

    renderPager($("#productsPager"), data, (page) => {
      productState.page = page;
      renderProducts();
    });
  }

  /* ==========================================================================
     五、商品编辑
     ========================================================================== */
  async function initProductEdit() {
    const form = $("#productForm");
    if (!form) return;

    const id = new URLSearchParams(location.search).get("id") || "";
    let editing = null;

    if (id) {
      editing = await run(() => API.product(id), "商品加载失败");
      if (!editing) {
        location.href = "products.html";
        return;
      }
    }
    const isNew = !editing;

    const titleEl = $("#editTitle");
    if (titleEl) titleEl.textContent = isNew ? "新增商品" : "编辑商品 · " + editing.name;
    document.title = (isNew ? "新增商品" : "编辑商品") + " · 简卡铺管理后台";

    const catSel = $("#fCategory");
    const cats = await run(() => API.categories(), "分类加载失败");
    if (catSel && cats) {
      catSel.innerHTML = cats.rows
        .filter((c) => c.status)
        .map((c) => '<option value="' + c.id + '">' + esc(c.name) + "</option>")
        .join("");
    }

    /* 规格 chip 输入 */
    const specs = editing && editing.specs ? editing.specs.slice() : [];
    const chipsEl = $("#specChips");
    const specInput = $("#specInput");

    function renderChips() {
      if (!chipsEl) return;
      chipsEl.innerHTML = specs
        .map((s, i) => '<span class="chip">' + esc(s) + '<button type="button" data-chip="' + i + '" aria-label="删除">✕</button></span>')
        .join("");
      /* 输入框与 chip 同容器，重绘后必须放回去，否则会被 innerHTML 抹掉 */
      if (specInput) chipsEl.appendChild(specInput);
    }
    function addSpec() {
      if (!specInput) return;
      const v = specInput.value.trim();
      if (!v) return;
      if (specs.includes(v)) {
        UI.toast("规格「" + v + "」已存在", "⚠️");
        specInput.value = "";
        return;
      }
      specs.push(v);
      specInput.value = "";
      renderChips();
    }

    if (chipsEl) {
      chipsEl.addEventListener("click", (e) => {
        const b = e.target.closest("[data-chip]");
        if (!b) return;
        specs.splice(Number(b.dataset.chip), 1);
        renderChips();
      });
    }
    if (specInput) {
      specInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addSpec();
        } else if (e.key === "Backspace" && !specInput.value && specs.length) {
          specs.pop();
          renderChips();
        }
      });
      specInput.addEventListener("blur", addSpec);
    }

    if (editing) {
      $("#fName").value = editing.name;
      $("#fId").value = editing.id;
      $("#fPrice").value = editing.price;
      $("#fOldPrice").value = editing.oldPrice || "";
      $("#fEmoji").value = editing.emoji;
      $("#fBadge").value = editing.badge || "";
      $("#fDesc").value = editing.desc || "";
      $("#fDetail").value = editing.detail || "";
      $("#fNotice").value = (editing.notice || []).join("\n");
      $("#fTutorial").value = (editing.tutorial || []).join("\n");
      if (catSel) catSel.value = editing.category;
      setSwitch($("#fStatus"), !!editing.status);
    } else {
      $("#fId").value = "p" + String(Date.now()).slice(-6);
      setSwitch($("#fStatus"), true);
    }
    renderChips();
    renderPreview();

    ["fName", "fPrice", "fOldPrice", "fEmoji", "fBadge", "fDesc"].forEach((fid) => {
      const el = $("#" + fid);
      if (el) el.addEventListener("input", renderPreview);
    });

    function renderPreview() {
      const host = $("#previewCard");
      if (!host) return;
      const name = $("#fName").value.trim() || "商品名称";
      const price = Number($("#fPrice").value) || 0;
      const old = Number($("#fOldPrice").value) || 0;
      const emoji = $("#fEmoji").value.trim() || "📦";
      const badge = $("#fBadge").value.trim();
      const descText = $("#fDesc").value.trim() || "一句话卖点会显示在这里";
      host.innerHTML =
        '<div class="card" style="pointer-events:none">' +
        '<div class="card-media"><span class="thumb-emoji">' + esc(emoji) + "</span>" +
        (badge ? '<span class="tag tag-accent badge">' + esc(badge) + "</span>" : "") + "</div>" +
        '<div class="card-body"><div class="card-title">' + esc(name) + "</div>" +
        '<div class="card-meta">' + esc(descText) + "</div>" +
        '<div class="card-foot"><div class="price"><span class="cur">¥</span><span class="val">' +
        (price ? UI.money(price) : "0.00") + "</span>" +
        (old ? '<span class="old">¥' + UI.money(old) + "</span>" : "") +
        '</div><span class="btn btn-primary btn-sm">立即购买</span></div></div></div>';
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("#fName").value.trim();
      const price = Number($("#fPrice").value);
      if (!name) {
        UI.toast("请填写商品名称", "⚠️");
        $("#fName").focus();
        return;
      }
      if (!(price > 0)) {
        UI.toast("请填写正确的售价", "⚠️");
        $("#fPrice").focus();
        return;
      }

      const payload = {
        name,
        category: catSel ? catSel.value : "other",
        emoji: $("#fEmoji").value.trim() || "📦",
        price,
        oldPrice: Number($("#fOldPrice").value) || 0,
        badge: $("#fBadge").value.trim(),
        status: $("#fStatus").classList.contains("is-on") ? 1 : 0,
        specs: specs.slice(),
        desc: $("#fDesc").value.trim(),
        detail: $("#fDetail").value.trim(),
        notice: $("#fNotice").value.split("\n").map((s) => s.trim()).filter(Boolean),
        tutorial: $("#fTutorial").value.split("\n").map((s) => s.trim()).filter(Boolean),
      };

      const submitBtn = $("#saveBtn");
      if (submitBtn) submitBtn.disabled = true;

      const result = isNew
        ? await run(() => API.createProduct({ ...payload, id: $("#fId").value.trim() }), "创建失败")
        : await run(() => API.updateProduct(editing.id, payload), "保存失败");

      if (submitBtn) submitBtn.disabled = false;
      if (!result) return;

      UI.toast(isNew ? "商品已创建：" + result.name : "已保存：" + result.name, "✅");
      setTimeout(() => {
        location.href = "products.html";
      }, 600);
    });

    const resetBtn = $("#resetBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", async () => {
        const ok = await UI.confirmDialog({
          title: "放弃修改",
          message: "当前页面的改动尚未保存，确定要返回商品列表吗？",
          okText: "放弃并返回",
        });
        if (ok) location.href = "products.html";
      });
    }
  }

  function setSwitch(el, on) {
    if (el) el.classList.toggle("is-on", !!on);
  }

  /* ==========================================================================
     六、分类管理
     ========================================================================== */
  async function initCategories() {
    const body = $("#categoriesBody");
    if (!body) return;
    const modal = $("#catModal");

    function openModal(cat) {
      const isNew = !cat;
      $("#catModalTitle").textContent = isNew ? "新增分类" : "编辑分类";
      $("#catName").value = cat ? cat.name : "";
      $("#catId").value = cat ? cat.id : "";
      $("#catId").disabled = !isNew;
      $("#catSort").value = cat ? cat.sort : 99;
      $("#catRemark").value = cat ? cat.remark : "";
      setSwitch($("#categoryStatusSwitch"), cat ? !!cat.status : true);
      modal.dataset.editId = cat ? cat.id : "";
      modal.classList.add("is-open");
      document.body.classList.add("is-locked");
      setTimeout(() => $("#catName").focus(), 200);
    }
    function closeModal() {
      modal.classList.remove("is-open");
      document.body.classList.remove("is-locked");
    }

    const addBtn = $("#categoryAdd");
    if (addBtn) addBtn.addEventListener("click", () => openModal(null));

    modal.addEventListener("click", async (e) => {
      if (e.target === modal || e.target.closest("[data-close]")) return closeModal();
      if (!e.target.closest("#catSave")) return;

      const payload = {
        name: $("#catName").value.trim(),
        id: $("#catId").value.trim(),
        sort: Number($("#catSort").value) || 99,
        remark: $("#catRemark").value.trim(),
        status: $("#categoryStatusSwitch").classList.contains("is-on") ? 1 : 0,
      };
      if (!payload.name) return UI.toast("请填写分类名称", "⚠️");
      if (!payload.id) return UI.toast("请填写分类标识", "⚠️");

      const editId = modal.dataset.editId;
      const result = editId
        ? await run(() => API.updateCategory(editId, payload), "保存失败")
        : await run(() => API.createCategory(payload), "新增失败");

      if (result) {
        UI.toast(editId ? "已保存分类：" + result.name : "已新增分类：" + result.name, "✅");
        closeModal();
        render();
      }
    });

    body.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const { act, id, name, count } = btn.dataset;

      if (act === "edit" || act === "toggle") {
        const cats = await run(() => API.categories(), "分类加载失败");
        const cat = cats && cats.rows.find((c) => c.id === id);
        if (!cat) return;
        if (act === "edit") return openModal(cat);

        const res = await run(() => API.updateCategory(id, { status: cat.status ? 0 : 1 }), "操作失败");
        if (res) {
          UI.toast(res.status ? "已启用：" + res.name : "已停用：" + res.name, res.status ? "✅" : "⚠️");
          render();
        }
        return;
      }

      if (act === "delete") {
        if (Number(count) > 0) {
          return UI.toast("该分类下还有 " + count + " 个商品，无法删除", "🚫");
        }
        const ok = await UI.confirmDialog({
          title: "删除分类",
          message: "确定要删除分类「" + name + "」吗？",
          okText: "删除",
          danger: true,
        });
        if (!ok) return;
        const res = await run(() => API.deleteCategory(id), "删除失败");
        if (res) {
          UI.toast("已删除：" + name, "🗑️");
          render();
        }
      }
    });

    async function render() {
      body.innerHTML = skeletonRow(6, 160);
      const data = await run(() => API.categories(), "分类加载失败");
      if (!data) return;

      body.innerHTML = data.rows
        .map(
          (c) =>
            "<tr>" +
            '<td class="num nowrap">' + c.sort + "</td>" +
            '<td><div class="cell-main"><span class="cell-thumb">🗂️</span><div><div class="t1">' + esc(c.name) +
            '</div><div class="t2">' + esc(c.remark || "—") + "</div></div></div></td>" +
            '<td class="mono">' + esc(c.id) + "</td>" +
            '<td class="num nowrap">' + c.count + " 件</td>" +
            "<td>" + statusHtml(c.status ? "启用" : "停用", c.status ? "on" : "off") + "</td>" +
            '<td><div class="row-actions">' +
            '<button data-act="edit" data-id="' + c.id + '">编辑</button><span class="sep"></span>' +
            '<button data-act="toggle" data-id="' + c.id + '">' + (c.status ? "停用" : "启用") + "</button><span class=\"sep\"></span>" +
            '<button class="danger" data-act="delete" data-id="' + c.id + '" data-name="' + esc(c.name) +
            '" data-count="' + c.count + '">删除</button>' +
            "</div></td></tr>"
        )
        .join("");
    }

    render();
  }

  /* ==========================================================================
     七、订单管理
     ========================================================================== */
  const orderState = { keyword: "", status: "", pay: "", page: 1, perPage: 8 };

  async function initOrders() {
    const body = $("#ordersBody");
    if (!body) return;
    const modal = $("#orderModal");

    const search = $("#orderSearch");
    if (search) {
      search.addEventListener(
        "input",
        UI.debounce(() => {
          orderState.keyword = search.value.trim();
          orderState.page = 1;
          renderOrders();
        })
      );
    }
    const st = $("#orderStatus");
    if (st) {
      st.addEventListener("change", () => {
        orderState.status = st.value;
        orderState.page = 1;
        renderOrders();
      });
    }
    const pay = $("#orderPay");
    if (pay) {
      pay.addEventListener("change", () => {
        orderState.pay = pay.value;
        orderState.page = 1;
        renderOrders();
      });
    }

    body.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const { act, no } = btn.dataset;

      if (act === "detail") {
        const order = await run(() => API.order(no), "订单加载失败");
        if (!order) return;
        $("#orderDetail").innerHTML =
          '<div class="summary">' +
          row("订单号", order.no) +
          row("下单时间", order.time) +
          row("联系方式", order.contact || "—") +
          row("支付方式", order.pay) +
          row("订单状态", order.status) +
          "</div>" +
          '<h4 class="h3 mt-24" style="margin-bottom:12px">商品明细</h4>' +
          '<div class="summary"><div class="summary-row"><span class="k">' + esc(order.product) +
          " · " + esc(order.spec || "—") + " × " + order.qty + '</span><span class="v">¥' + UI.money(order.amount) + "</span></div></div>" +
          '<h4 class="h3 mt-24" style="margin-bottom:12px">卡密内容</h4>' +
          (order.secrets.length
            ? '<div class="secret-list">' +
              order.secrets
                .map(
                  (s, i) =>
                    '<div class="secret-item"><span class="idx">' + (i + 1) + "</span><code>" + esc(s) +
                    '</code><button class="btn btn-soft btn-sm" data-copy="' + esc(s) + '">复制</button></div>'
                )
                .join("") +
              "</div>"
            : '<div class="empty" style="padding:26px 0"><div class="ico">📭</div><p>该订单暂无卡密</p></div>');
        modal.classList.add("is-open");
        document.body.classList.add("is-locked");
        return;
      }

      if (act === "resend") {
        const ok = await UI.confirmDialog({
          title: "补发卡密",
          message: "将为订单 " + no + " 额外发放一批卡密（数量与订单数量相同），确定继续吗？",
          okText: "补发",
        });
        if (!ok) return;
        const res = await run(() => API.resendOrder(no), "补发失败");
        if (res) {
          UI.toast("订单 " + no + " 已补发，当前共 " + res.secrets.length + " 条卡密", "✅");
          renderOrders();
        }
        return;
      }

      if (act === "close") {
        const ok = await UI.confirmDialog({
          title: "关闭订单",
          message: "确定要关闭订单 " + no + " 吗？锁定的卡密会退回库存。",
          okText: "关闭订单",
          danger: true,
        });
        if (!ok) return;
        const res = await run(() => API.closeOrder(no), "关闭失败");
        if (res) {
          UI.toast("订单 " + no + " 已关闭", "🚫");
          renderOrders();
        }
        return;
      }

      if (act === "refund") {
        const ok = await UI.confirmDialog({
          title: "订单退款",
          message: "确认对订单 " + no + " 退款？已发出的卡密将作废且无法回收。",
          okText: "确认退款",
          danger: true,
        });
        if (!ok) return;
        const res = await run(() => API.refundOrder(no), "退款失败");
        if (res) {
          UI.toast("订单 " + no + " 已退款", "↩️");
          renderOrders();
        }
      }
    });

    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal || e.target.closest("[data-close]")) {
          modal.classList.remove("is-open");
          document.body.classList.remove("is-locked");
          return;
        }
        const cp = e.target.closest("[data-copy]");
        if (cp) UI.copyText(cp.dataset.copy, "卡密已复制");
      });
    }

    renderOrderStats();
    renderOrders();
  }

  const row = (k, v) =>
    '<div class="summary-row"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + "</span></div>";

  async function renderOrderStats() {
    const host = $("#orderStats");
    if (!host) return;
    const s = await run(() => API.orderStats(), "统计加载失败");
    if (!s) return;
    host.innerHTML = statCards(
      [
        { l: "订单总数", v: UI.int(s.total), u: "笔" },
        { l: "已发货", v: UI.int(s.shipped), u: "笔" },
        { l: "成交金额", v: "¥" + UI.money(s.revenue) },
        { l: "待处理", v: UI.int(s.pending), u: "笔" },
      ],
      ["🧾", "✅", "💰", "⏳"]
    );
  }

  async function renderOrders() {
    const body = $("#ordersBody");
    if (!body) return;
    body.innerHTML = skeletonRow(8);

    const data = await run(() => API.orders(orderState), "订单加载失败");
    if (!data) return;
    orderState.page = data.page;

    if (!data.rows.length) {
      body.innerHTML = emptyRow(8, "🧾", "没有符合条件的订单");
    } else {
      body.innerHTML = data.rows
        .map(
          (o) =>
            "<tr>" +
            '<td class="mono nowrap">' + esc(o.no) + "</td>" +
            '<td><div class="cell-main"><span class="cell-thumb">🧾</span><div><div class="t1">' + esc(o.product) +
            '</div><div class="t2">' + esc(o.spec || "—") + " × " + o.qty + "</div></div></div></td>" +
            '<td class="nowrap dim">' + esc(o.contact || "—") + "</td>" +
            '<td class="num nowrap">¥' + UI.money(o.amount) + "</td>" +
            '<td class="nowrap">' + esc(o.pay) + "</td>" +
            "<td>" + statusHtml(o.status, ORDER_STATUS_CLASS[o.status] || "off") + "</td>" +
            '<td class="nowrap dim">' + esc(o.time) + "</td>" +
            '<td><div class="row-actions">' +
            '<button data-act="detail" data-no="' + o.no + '">详情</button><span class="sep"></span>' +
            '<button data-act="resend" data-no="' + o.no + '">补发</button><span class="sep"></span>' +
            (o.status === "待付款"
              ? '<button class="danger" data-act="close" data-no="' + o.no + '">关闭</button>'
              : '<button class="danger" data-act="refund" data-no="' + o.no + '">退款</button>') +
            "</div></td></tr>"
        )
        .join("");
    }

    renderPager($("#ordersPager"), data, (page) => {
      orderState.page = page;
      renderOrders();
    });
  }

  /* ==========================================================================
     八、卡密库存
     ========================================================================== */
  const cardState = { product: "", keyword: "", status: "", page: 1, perPage: 10 };
  let productOptions = [];

  async function initCards() {
    const body = $("#cardsBody");
    if (!body) return;

    const products = await run(() => API.products({ perPage: 100 }), "商品加载失败");
    productOptions = products ? products.rows : [];

    const sel = $("#cardProduct");
    sel.innerHTML =
      '<option value="">全部商品</option>' +
      productOptions.map((p) => '<option value="' + p.id + '">' + esc(p.name) + "</option>").join("");
    sel.addEventListener("change", () => {
      cardState.product = sel.value;
      cardState.page = 1;
      renderCards();
    });

    const search = $("#cardSearch");
    search.addEventListener(
      "input",
      UI.debounce(() => {
        cardState.keyword = search.value.trim();
        cardState.page = 1;
        renderCards();
      })
    );
    const st = $("#cardStatus");
    st.addEventListener("change", () => {
      cardState.status = st.value;
      cardState.page = 1;
      renderCards();
    });

    /* 导入弹窗 */
    const modal = $("#importModal");
    $("#cardImport").addEventListener("click", () => {
      $("#importProduct").innerHTML = productOptions
        .map((p) => '<option value="' + p.id + '">' + esc(p.name) + "</option>")
        .join("");
      if (cardState.product) $("#importProduct").value = cardState.product;
      $("#importText").value = "";
      updateImportPreview();
      modal.classList.add("is-open");
      document.body.classList.add("is-locked");
    });

    const parseImport = () =>
      $("#importText").value.split("\n").map((s) => s.trim()).filter(Boolean);

    function updateImportPreview() {
      const n = parseImport().length;
      const el = $("#importCount");
      el.innerHTML = n ? "✅ 识别到 <strong>" + n + "</strong> 条卡密" : "等待粘贴卡密…";
      el.className = n ? "import-count" : "import-hint";
    }

    $("#importText").addEventListener("input", updateImportPreview);

    modal.addEventListener("click", async (e) => {
      if (e.target === modal || e.target.closest("[data-close]")) {
        modal.classList.remove("is-open");
        document.body.classList.remove("is-locked");
        return;
      }
      if (!e.target.closest("#importConfirm")) return;

      const list = parseImport();
      if (!list.length) return UI.toast("请先粘贴卡密内容", "⚠️");

      const result = await run(
        () => API.importCards({ productId: $("#importProduct").value, secrets: list }),
        "导入失败"
      );
      if (!result) return;

      modal.classList.remove("is-open");
      document.body.classList.remove("is-locked");
      UI.toast(
        "成功导入 " + result.imported + " 条" + (result.duplicated ? "，跳过重复 " + result.duplicated + " 条" : ""),
        "✅"
      );
      renderCards();
    });

    body.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      if (btn.dataset.act === "copy") {
        UI.copyText(btn.dataset.key, "卡密已复制");
        return;
      }
      if (btn.dataset.act === "delete") {
        const ok = await UI.confirmDialog({
          title: "删除卡密",
          message: "确定要删除这条卡密吗？\n" + btn.dataset.key,
          okText: "删除",
          danger: true,
        });
        if (!ok) return;
        const res = await run(() => API.deleteCard(btn.dataset.id), "删除失败");
        if (res) {
          UI.toast("已删除该条卡密", "🗑️");
          renderCards();
        }
      }
    });

    renderCards();
  }

  async function renderCards() {
    const body = $("#cardsBody");
    if (!body) return;

    const statsEl = $("#cardStats");
    if (statsEl) {
      const s = await run(() => API.cardStats(), "统计加载失败");
      if (s) {
        statsEl.innerHTML = statCards(
          [
            { l: "卡密总数", v: UI.int(s.total) },
            { l: "可用库存", v: UI.int(s.available) },
            { l: "已售出", v: UI.int(s.sold) },
            { l: "临时锁定", v: UI.int(s.locked) },
          ],
          ["🔑", "✅", "📤", "⏳"]
        );
      }
    }

    body.innerHTML = skeletonRow(7);
    const data = await run(
      () =>
        API.cards({
          productId: cardState.product,
          keyword: cardState.keyword,
          status: cardState.status,
          page: cardState.page,
          perPage: cardState.perPage,
        }),
      "卡密加载失败"
    );
    if (!data) return;
    cardState.page = data.page;

    const cls = { 未售: "off", 已售: "on", 已锁定: "warn" };

    if (!data.rows.length) {
      body.innerHTML = emptyRow(7, "🔑", "没有符合条件的卡密");
    } else {
      body.innerHTML = data.rows
        .map(
          (c) =>
            "<tr>" +
            '<td class="mono nowrap">' + esc(c.key) + "</td>" +
            '<td class="nowrap">' + esc(c.productName || c.product) + "</td>" +
            "<td>" + statusHtml(c.status, cls[c.status] || "off") + "</td>" +
            '<td class="nowrap dim">' + esc(c.importedAt) + "</td>" +
            '<td class="nowrap dim">' + (c.soldAt ? esc(c.soldAt) : "—") + "</td>" +
            '<td class="nowrap">' + (c.order ? '<span class="mono">' + esc(c.order) + "</span>" : '<span class="dim">—</span>') + "</td>" +
            '<td><div class="row-actions">' +
            '<button data-act="copy" data-key="' + esc(c.key) + '">复制</button><span class="sep"></span>' +
            '<button class="danger" data-act="delete" data-id="' + c.id + '" data-key="' + esc(c.key) + '"' +
            (c.status === "已售" ? " disabled" : "") + ">删除</button>" +
            "</div></td></tr>"
        )
        .join("");
    }

    renderPager($("#cardsPager"), data, (page) => {
      cardState.page = page;
      renderCards();
    });
  }

  /* ==========================================================================
     九、用户管理
     ========================================================================== */
  const userState = { keyword: "", status: "", page: 1, perPage: 8 };

  async function initUsers() {
    const body = $("#usersBody");
    if (!body) return;

    const search = $("#userSearch");
    search.addEventListener(
      "input",
      UI.debounce(() => {
        userState.keyword = search.value.trim();
        userState.page = 1;
        renderUsers();
      })
    );
    const st = $("#userStatus");
    st.addEventListener("change", () => {
      userState.status = st.value;
      userState.page = 1;
      renderUsers();
    });

    body.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const { act, id, name, status } = btn.dataset;

      if (act === "detail") {
        const list = await run(() => API.users({ keyword: id, perPage: 1 }), "加载失败");
        const u = list && list.rows[0];
        if (u) UI.toast(u.name + " 共 " + u.orders + " 笔订单，累计 ¥" + UI.money(u.amount), "👤");
        return;
      }

      if (act === "toggle") {
        const banning = status === "1";
        const ok = await UI.confirmDialog({
          title: banning ? "封禁用户" : "解除封禁",
          message: banning
            ? "封禁后用户「" + name + "」将无法下单，确定继续吗？"
            : "确定要解除对用户「" + name + "」的封禁吗？",
          okText: banning ? "封禁" : "解封",
          danger: banning,
        });
        if (!ok) return;
        const res = await run(() => API.toggleUser(id), "操作失败");
        if (res) {
          UI.toast(res.status ? "已解除封禁：" + res.name : "已封禁：" + res.name, res.status ? "✅" : "🚫");
          renderUsers();
        }
      }
    });

    renderUsers();
  }

  async function renderUsers() {
    const body = $("#usersBody");
    if (!body) return;

    const statsEl = $("#userStats");
    if (statsEl) {
      const s = await run(() => API.userStats(), "统计加载失败");
      if (s) {
        statsEl.innerHTML = statCards(
          [
            { l: "注册用户", v: UI.int(s.total) },
            { l: "正常账号", v: UI.int(s.active) },
            { l: "已封禁", v: UI.int(s.banned) },
            { l: "累计消费", v: "¥" + UI.money(s.amount) },
          ],
          ["👥", "✅", "🚫", "💰"]
        );
      }
    }

    body.innerHTML = skeletonRow(8);
    const data = await run(() => API.users(userState), "用户加载失败");
    if (!data) return;
    userState.page = data.page;

    if (!data.rows.length) {
      body.innerHTML = emptyRow(8, "👥", "没有符合条件的用户");
    } else {
      body.innerHTML = data.rows
        .map(
          (u) =>
            "<tr>" +
            '<td class="mono nowrap">' + esc(u.id) + "</td>" +
            '<td><div class="cell-main"><span class="cell-thumb">' + esc(u.name.slice(0, 1)) +
            '</span><div><div class="t1">' + esc(u.name) + '</div><div class="t2">' + esc(u.contact || "—") + "</div></div></div></td>" +
            '<td class="num nowrap">' + UI.int(u.orders) + " 笔</td>" +
            '<td class="num nowrap">¥' + UI.money(u.amount) + "</td>" +
            '<td class="nowrap dim">' + esc(u.regAt) + "</td>" +
            '<td class="nowrap dim">' + esc(u.lastAt || "—") + "</td>" +
            "<td>" + statusHtml(u.status ? "正常" : "已封禁", u.status ? "on" : "danger") + "</td>" +
            '<td><div class="row-actions">' +
            '<button data-act="detail" data-id="' + u.id + '">详情</button><span class="sep"></span>' +
            '<button class="' + (u.status ? "danger" : "") + '" data-act="toggle" data-id="' + u.id +
            '" data-name="' + esc(u.name) + '" data-status="' + u.status + '">' + (u.status ? "封禁" : "解封") + "</button>" +
            "</div></td></tr>"
        )
        .join("");
    }

    renderPager($("#usersPager"), data, (page) => {
      userState.page = page;
      renderUsers();
    });
  }

  /* ==========================================================================
     十、系统设置
     ========================================================================== */
  async function initSettings() {
    const nav = $("#settingsNav");
    if (!nav) return;

    nav.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-pane]");
      if (!btn) return;
      $$("[data-pane]", nav).forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      $$(".settings-pane").forEach((p) => p.classList.remove("is-active"));
      const pane = $("#pane-" + btn.dataset.pane);
      if (pane) pane.classList.add("is-active");
    });

    let settings = await run(() => API.settings(), "设置加载失败");
    if (!settings) return;
    let announcements = (settings.announcements || []).map((a) => ({ ...a }));

    function fill(obj) {
      Object.entries(obj).forEach(([key, value]) => {
        const el = document.querySelector(`[name="${key}"]`);
        if (!el) return;
        if (el.classList.contains("switch")) el.classList.toggle("is-on", !!value);
        else el.value = value;
      });
    }
    function fillAll() {
      fill(settings.site);
      fill(settings.trade);
      fill(settings.payment);
      fill(settings.seo);
      fill(settings.security);

      const wxHint = $("#wxKeyHint");
      if (wxHint) wxHint.textContent = settings.payment.wxKeySet ? "已配置，留空表示不修改" : "尚未配置";
      const aliHint = $("#aliKeyHint");
      if (aliHint) aliHint.textContent = settings.payment.aliKeySet ? "已配置，留空表示不修改" : "尚未配置";
    }
    fillAll();

    /* 公告管理 */
    const listEl = $("#announceList");
    function renderAnnounce() {
      listEl.innerHTML = announcements
        .map(
          (a, i) =>
            '<div class="switch-row" data-index="' + i + '">' +
            '<span class="ico" style="font-size:18px">📢</span>' +
            '<div class="txt"><input class="input input-sm" data-ann-text value="' + esc(a.text) + '" /></div>' +
            '<span class="switch' + (a.status ? " is-on" : "") + '" data-ann-status data-no-toggle></span>' +
            '<button class="btn btn-ghost btn-sm" data-ann-del>删除</button>' +
            "</div>"
        )
        .join("");
    }
    renderAnnounce();

    listEl.addEventListener("click", (e) => {
      const rowEl = e.target.closest("[data-index]");
      if (!rowEl) return;
      const idx = Number(rowEl.dataset.index);
      if (e.target.closest("[data-ann-status]")) {
        announcements[idx].status = announcements[idx].status ? 0 : 1;
        renderAnnounce();
        return;
      }
      if (e.target.closest("[data-ann-del]")) {
        announcements.splice(idx, 1);
        UI.toast("已删除公告，记得保存", "🗑️");
        renderAnnounce();
      }
    });
    listEl.addEventListener("input", (e) => {
      const rowEl = e.target.closest("[data-index]");
      if (!rowEl || !e.target.hasAttribute("data-ann-text")) return;
      announcements[Number(rowEl.dataset.index)].text = e.target.value;
    });

    const addBtn = $("#announceAdd");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        announcements.push({ id: 0, text: "请输入新的公告内容", status: 1 });
        renderAnnounce();
        UI.toast("已新增一条公告，记得保存", "➕");
      });
    }

    function collect(keys) {
      const out = {};
      keys.forEach((k) => {
        const el = document.querySelector(`[name="${k}"]`);
        if (!el) return;
        if (el.classList.contains("switch")) out[k] = el.classList.contains("is-on") ? 1 : 0;
        else out[k] = el.value;
      });
      return out;
    }

    $("#saveSettings").addEventListener("click", async () => {
      const payload = {
        site: collect(["name", "subtitle", "logoMark", "icp", "serviceUrl", "serviceTime", "email", "footerText"]),
        trade: collect(["currency", "minOrder", "autoCloseMinutes", "lowStockWarn", "guestOrder", "orderPrefix", "refundWindowHours"]),
        payment: collect(["wxEnable", "wxMchId", "wxKey", "aliEnable", "aliAppId", "aliKey", "qrExpireMinutes"]),
        seo: collect(["title", "keywords", "description"]),
        security: collect(["adminPath", "captcha", "loginFailLock", "lockThreshold", "sessionTimeout"]),
        announcements: announcements.map((a) => ({ text: a.text, status: a.status ? 1 : 0 })),
      };

      const btn = $("#saveSettings");
      btn.disabled = true;
      const res = await run(() => API.saveSettings(payload), "保存失败");
      btn.disabled = false;
      if (!res) return;

      UI.toast("设置已保存并立即生效", "✅");
      settings = (await run(() => API.settings(), "重新加载失败")) || settings;
      fillAll();
    });

    const resetBtn = $("#resetSettings");
    if (resetBtn) {
      resetBtn.addEventListener("click", async () => {
        const ok = await UI.confirmDialog({
          title: "放弃修改",
          message: "将把当前页面的改动还原为服务器上已保存的值，确定继续吗？",
          okText: "放弃修改",
        });
        if (!ok) return;
        settings = await run(() => API.settings(), "重新加载失败");
        if (!settings) return;
        announcements = (settings.announcements || []).map((a) => ({ ...a }));
        fillAll();
        renderAnnounce();
        UI.toast("已还原为服务器上的设置", "↩️");
      });
    }
  }

  /* ==========================================================================
     十一、操作日志
     ========================================================================== */
  const logState = { keyword: "", result: "", page: 1, perPage: 10 };

  async function initLogs() {
    const body = $("#logsBody");
    if (!body) return;

    const search = $("#logSearch");
    search.addEventListener(
      "input",
      UI.debounce(() => {
        logState.keyword = search.value.trim();
        logState.page = 1;
        renderLogs();
      })
    );
    const res = $("#logResult");
    res.addEventListener("change", () => {
      logState.result = res.value;
      logState.page = 1;
      renderLogs();
    });

    renderLogs();
  }

  async function renderLogs() {
    const body = $("#logsBody");
    if (!body) return;
    body.innerHTML = skeletonRow(6, 200);

    const data = await run(() => API.logs(logState), "日志加载失败");
    if (!data) return;
    logState.page = data.page;

    if (!data.rows.length) {
      body.innerHTML = emptyRow(6, "📜", "没有符合条件的日志");
    } else {
      body.innerHTML = data.rows
        .map(
          (l) =>
            "<tr>" +
            '<td class="nowrap dim">' + esc(l.time) + "</td>" +
            '<td class="nowrap">' + esc(l.actor) + "</td>" +
            '<td class="nowrap">' + esc(l.action) + "</td>" +
            '<td class="mono nowrap">' + esc(l.target || "—") + "</td>" +
            '<td class="nowrap dim">' + esc(l.ip || "—") + "</td>" +
            "<td>" + statusHtml(l.result, l.result === "成功" ? "on" : "danger") + "</td></tr>"
        )
        .join("");
    }

    renderPager($("#logsPager"), data, (page) => {
      logState.page = page;
      renderLogs();
    });
  }

  /* ==========================================================================
     十二、登录页
     ========================================================================== */
  async function initLogin() {
    const form = $("#loginForm");
    if (!form) return;

    const box = $("#captchaBox");
    let captchaId = "";

    async function refreshCaptcha() {
      const data = await run(() => API.captcha(), "验证码加载失败");
      if (!data) return;
      captchaId = data.id;
      box.innerHTML = data.svg;
    }
    await refreshCaptcha();
    box.addEventListener("click", refreshCaptcha);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = $("#loginUser").value.trim();
      const password = $("#loginPass").value;
      const captchaCode = $("#loginCaptcha").value.trim();

      if (!username || !password) return UI.toast("请输入账号和密码", "⚠️");
      if (!captchaCode) return UI.toast("请输入验证码", "⚠️");

      const btn = $("#loginBtn");
      btn.disabled = true;
      btn.textContent = "登录中…";

      try {
        await API.login({ username, password, captchaId, captchaCode });
        btn.textContent = "登录成功，正在进入…";
        location.href = "index.html";
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "登 录";
        UI.toast(err.message || "登录失败", "🚫");
        $("#loginCaptcha").value = "";
        refreshCaptcha();
      }
    });
  }

  /* ==========================================================================
     启动
     ========================================================================== */
  const PAGES = {
    dashboard: initDashboard,
    products: initProducts,
    "product-edit": initProductEdit,
    categories: initCategories,
    orders: initOrders,
    cards: initCards,
    users: initUsers,
    settings: initSettings,
    logs: initLogs,
    login: initLogin,
  };

  document.addEventListener("DOMContentLoaded", async () => {
    const page = document.body.dataset.page || "";

    if (page === "login") {
      await initLogin();
      return;
    }

    const ok = await mountShell();
    if (!ok) return; // 未登录，API 层已跳转

    const fn = PAGES[page];
    if (fn) await fn();
  });
})();
