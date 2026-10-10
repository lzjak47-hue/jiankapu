/* ============================================================================
   简卡铺 · 后台通用 UI 工具
   ----------------------------------------------------------------------------
   挂载在 window.JKPUI 下，供后台各页面的脚本复用。
   （前台 main.js 里有一份自用的同类实现，为不改动已验证的前台逻辑而保留独立）
   ========================================================================== */

window.JKPUI = (function () {
  "use strict";

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(n) {
    var v = Number(n) || 0;
    return v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function int(n) {
    return (Number(n) || 0).toLocaleString("zh-CN");
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(self, args);
      }, wait || 240);
    };
  }

  /* 轻提示 */
  var wrap = null;
  function toast(message, icon) {
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "toast-wrap";
      document.body.appendChild(wrap);
    }
    var el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = (icon ? "<span>" + icon + "</span>" : "") + "<span>" + escapeHtml(message) + "</span>";
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add("is-out");
      setTimeout(function () {
        el.remove();
      }, 260);
    }, 1900);
  }

  /* 复制 */
  function fallbackCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch (e) {
      toast("复制失败，请手动选择复制", "⚠️");
    }
    ta.remove();
  }

  function copyText(text, tip) {
    var done = function () {
      toast(tip || "已复制到剪贴板", "✅");
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () {
        fallbackCopy(text, done);
      });
    } else {
      fallbackCopy(text, done);
    }
  }

  /* 确认框：返回 Promise<boolean> */
  function confirmDialog(options) {
    var opts = options || {};
    return new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.className = "overlay";
      overlay.innerHTML =
        '<div class="modal" style="max-width:400px">' +
        '<div class="modal-head"><h3>' + escapeHtml(opts.title || "确认操作") + "</h3>" +
        '<button class="modal-close" data-act="cancel" aria-label="关闭">✕</button></div>' +
        '<div class="modal-body"><p class="muted" style="line-height:1.8">' + escapeHtml(opts.message || "") + "</p></div>" +
        '<div class="modal-foot">' +
        '<button class="btn btn-ghost btn-block" data-act="cancel">取消</button>' +
        '<button class="btn ' + (opts.danger ? "btn-accent" : "btn-primary") + ' btn-block" data-act="ok">' +
        escapeHtml(opts.okText || "确定") +
        "</button></div></div>";
      document.body.appendChild(overlay);
      document.body.classList.add("is-locked");
      requestAnimationFrame(function () {
        overlay.classList.add("is-open");
      });

      function close(val) {
        overlay.classList.remove("is-open");
        document.body.classList.remove("is-locked");
        setTimeout(function () {
          overlay.remove();
        }, 240);
        document.removeEventListener("keydown", onKey);
        resolve(val);
      }
      function onKey(e) {
        if (e.key === "Escape") close(false);
      }
      document.addEventListener("keydown", onKey);

      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) return close(false);
        var act = e.target.closest("[data-act]");
        if (!act) return;
        close(act.dataset.act === "ok");
      });
    });
  }

  /* 生成一个假的验证码 */
  function randomCaptcha(len) {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXY3456789";
    var s = "";
    for (var i = 0; i < (len || 4); i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  /* 简易分页计算 */
  function paginate(list, page, perPage) {
    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / perPage));
    var p = Math.min(Math.max(1, page), pages);
    var start = (p - 1) * perPage;
    return {
      items: list.slice(start, start + perPage),
      page: p,
      pages: pages,
      total: total,
      start: total ? start + 1 : 0,
      end: Math.min(start + perPage, total)
    };
  }

  /* 渲染分页条 */
  function paginationHtml(info) {
    if (!info || info.total === 0) return "";
    var html = '<div class="pagination"><span class="info">共 ' + info.total +
      " 条，当前 " + info.start + "-" + info.end + "</span>";
    html += '<button data-page="' + (info.page - 1) + '"' + (info.page <= 1 ? " disabled" : "") + ">上一页</button>";
    var from = Math.max(1, info.page - 2);
    var to = Math.min(info.pages, from + 4);
    from = Math.max(1, to - 4);
    for (var i = from; i <= to; i++) {
      html += '<button data-page="' + i + '"' + (i === info.page ? ' class="is-active"' : "") + ">" + i + "</button>";
    }
    html += '<button data-page="' + (info.page + 1) + '"' + (info.page >= info.pages ? " disabled" : "") + ">下一页</button>";
    return html + "</div>";
  }

  return {
    $: $,
    $$: $$,
    escapeHtml: escapeHtml,
    money: money,
    int: int,
    debounce: debounce,
    toast: toast,
    copyText: copyText,
    confirmDialog: confirmDialog,
    randomCaptcha: randomCaptcha,
    paginate: paginate,
    paginationHtml: paginationHtml
  };
})();
