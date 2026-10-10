/**
 * 简卡铺 · 极简路由
 * ---------------------------------------------------------------------------
 * 支持 /api/admin/products/:id 形式的路径参数，匹配到的参数会传给处理函数。
 * 不引入任何第三方路由库，保持零依赖。
 */

/** 把 "/a/:id/b" 编译成正则 + 参数名列表 */
function compile(pattern) {
  const keys = [];
  const source = pattern
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        keys.push(seg.slice(1));
        return "([^/]+)";
      }
      if (seg === "*") {
        keys.push("wildcard");
        return "(.*)";
      }
      // 转义正则元字符
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${source}/?$`), keys };
}

export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const { regex, keys } = compile(pattern);
    routes.push({ method, pattern, regex, keys, handler });
  }

  return {
    get: (p, h) => add("GET", p, h),
    post: (p, h) => add("POST", p, h),
    put: (p, h) => add("PUT", p, h),
    patch: (p, h) => add("PATCH", p, h),
    delete: (p, h) => add("DELETE", p, h),

    /**
     * 匹配路由
     * @returns {{handler: Function, params: object}|{allow: string[]}|null}
     *   命中返回 handler 与参数；路径命中但方法不符返回 allow 列表；完全不命中返回 null。
     */
    match(method, pathname) {
      const allow = [];
      for (const route of routes) {
        const m = route.regex.exec(pathname);
        if (!m) continue;
        if (route.method !== method) {
          allow.push(route.method);
          continue;
        }
        const params = {};
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(m[i + 1] ?? "");
        });
        return { handler: route.handler, params };
      }
      return allow.length ? { allow } : null;
    },

    /** 调试用：列出已注册路由 */
    list() {
      return routes.map((r) => `${r.method} ${r.pattern}`);
    },
  };
}

export default createRouter;
