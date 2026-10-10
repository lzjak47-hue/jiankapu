/**
 * 简卡铺 · 后台应用测试
 * ---------------------------------------------------------------------------
 * 重点覆盖「未登录时不再白屏，而是跳登录页」这个曾经的真实 bug。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminApp } from "./App";
import {
  demoAdmin,
  demoAdminSettings,
  demoProduct,
  demoProduct2,
  installFetchMock,
  type MockResult,
} from "../test/mockFetch";

/* 模拟双端口部署的运行时注入：adminBase 不带 /admin 前缀，
   后台路由 basename 为空；这样单端口模式下才能得到 /admin 前缀。 */
window.JKP_RUNTIME = {
  role: "admin",
  siteBase: "http://localhost:2001",
  adminBase: "http://localhost:2002",
};

const dashboardData = {
  stats: [
    { label: "今日订单", value: 16, unit: "笔", delta: "+12.4%", up: true, icon: "🧾" },
    { label: "今日收入", value: 926.3, unit: "元", delta: "+8.7%", up: true, icon: "💰", money: true },
    { label: "在售商品", value: 10, unit: "件", delta: "全部有货", up: true, icon: "📦" },
    { label: "可用卡密", value: 183, unit: "条", delta: "库存充足", up: true, icon: "🔑" },
  ],
  series: [
    { date: "01-04", orders: 20, revenue: 300 },
    { date: "01-05", orders: 16, revenue: 926.3 },
  ],
  topProducts: [{ id: "p001", name: "爱奇艺黄金 VIP 会员", emoji: "🎬", sold: 12876, revenue: 3532 }],
  recentOrders: [
    {
      no: "JKP20260105018",
      product: "爱奇艺黄金 VIP 会员",
      productId: "p001",
      spec: "月卡",
      qty: 1,
      amount: 12.8,
      status: "已发货",
      contact: "138****6621",
      time: "2026-01-05 09:41:22",
    },
  ],
  system: {
    version: "简卡铺 v1.0.0",
    runtime: "Node v24.21.0",
    nodeEnv: "development",
    database: "PostgreSQL",
    totalOrders: 124,
    totalCards: 359,
    admins: 1,
    dbSizeKb: 1024,
    serverTime: "2026-01-05 09:50:00",
    uptimeSeconds: 3600,
  },
  orderStats: { total: 124, shipped: 90, revenue: 12000, pending: 5 },
};

const pagedProducts = { rows: [demoProduct, demoProduct2], total: 2, page: 1, perPage: 8 };

const captchaData = {
  id: "cap-1",
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 104 46"><text x="15" y="32">AB3D</text></svg>',
  expiresInSeconds: 300,
};

const emptyCards = { rows: [], total: 0, page: 1, perPage: 10 };

describe("管理后台 · 卡密按规格管理", () => {
  let mock: MockResult | null = null;

  beforeEach(() => {
    window.history.pushState({}, "", "/cards");
    mock?.restore();
    mock = null;
  });

  function mount() {
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/products", data: pagedProducts },
      { match: "/api/admin/cards/stats", data: { total: 60, available: 60, sold: 0, locked: 0 } },
      { match: "/api/admin/cards", data: emptyCards },
    ]);
    return render(<AdminApp />);
  }

  it("卡密列表展示规格列", async () => {
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/products", data: pagedProducts },
      { match: "/api/admin/cards/stats", data: { total: 1, available: 1, sold: 0, locked: 0 } },
      {
        match: "/api/admin/cards",
        data: {
          rows: [
            {
              id: 1,
              key: "MONTHLY-KEY-1",
              product: "p001",
              productName: "爱奇艺黄金 VIP 会员",
              spec: "月卡",
              status: "未售",
              importedAt: "2026-01-05 09:00:00",
              soldAt: "",
              order: "",
            },
          ],
          total: 1,
          page: 1,
          perPage: 10,
        },
      },
    ]);

    render(<AdminApp />);

    expect(await screen.findByText("MONTHLY-KEY-1")).toBeInTheDocument();
    /* 规格单独成列，能一眼看出这条卡密属于哪个规格 */
    expect(screen.getByRole("columnheader", { name: "规格" })).toBeInTheDocument();
    expect(screen.getByText("月卡")).toBeInTheDocument();
  });

  it("选中商品后摊开各规格的当前库存", async () => {
    mount();
    const user = userEvent.setup();

    /* 等商品列表真正加载出来再选，否则下拉里还没有 p001 */
    await screen.findByRole("option", { name: "爱奇艺黄金 VIP 会员" });
    await user.selectOptions(screen.getByLabelText("按商品筛选"), "p001");

    /* 三个规格各自的库存都要露出来，售罄的要标出来 */
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /季卡.*已售罄/ })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /月卡.*55 条/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /年卡.*5 条/ })).toBeInTheDocument();
  });

  it("导入卡密必须先选规格，且下拉里显示各规格现有库存", async () => {
    mount();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /批量导入卡密/ }));

    /* 选择目标商品后，规格才会作为必选项出现 —— 这正是之前做不到的地方 */
    await user.selectOptions(await screen.findByLabelText(/导入到商品/), "p001");
    const specSelect = await screen.findByLabelText(/导入到规格/);
    expect(specSelect).toBeInTheDocument();

    expect(screen.getByRole("option", { name: /月卡（当前剩 55 条）/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /季卡（当前剩 0 条）/ })).toBeInTheDocument();
  });

  it("导入时提交的是所选规格", async () => {
    mount();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /批量导入卡密/ }));
    await user.selectOptions(await screen.findByLabelText(/导入到商品/), "p001");
    await user.selectOptions(await screen.findByLabelText(/导入到规格/), "季卡");
    await user.type(
      screen.getByLabelText(/卡密内容/),
      "QUARTERLY-KEY-1\nQUARTERLY-KEY-2"
    );

    /* 提交前先确认识别条数与目标规格 */
    expect(screen.getByText(/将导入到/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认导入" }));

    await waitFor(() => {
      const call = mock!.calls.find(
        (c) => c.url === "/api/admin/cards/import" && c.method === "POST"
      );
      expect(call).toBeTruthy();
      const body = call!.body as { productId: string; spec: string; text: string };
      expect(body.productId).toBe("p001");
      expect(body.spec).toBe("季卡");
      expect(body.text).toContain("QUARTERLY-KEY-1");
    });
  });
});

describe("管理后台 · 排序、导出与改密码", () => {
  let mock: MockResult | null = null;

  beforeEach(() => {
    mock?.restore();
    mock = null;
  });

  it("订单列表显示下单 IP，详情里也有", async () => {
    window.history.pushState({}, "", "/orders");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/orders/stats", data: { total: 1, shipped: 1, revenue: 12.8, pending: 0 } },
      { match: "/api/admin/orders", data: { rows: [demoOrderRow], total: 1, page: 1, perPage: 8 } },
      { match: "/api/admin/orders/JKP20260105018", data: demoOrderDetail },
      { match: "/api/admin/alerts", data: demoAlerts },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByText("JKP20260105018");

    /* 列表里就有 IP 列，不用点进去看 */
    expect(screen.getByRole("columnheader", { name: "下单 IP" })).toBeInTheDocument();
    expect(screen.getByText("112.65.12.34")).toBeInTheDocument();

    /* 详情弹窗里也有，并且带支付时间 */
    await user.click(screen.getByRole("button", { name: "详情" }));
    const dialog = await screen.findByRole("dialog", { name: "订单详情" });
    expect(within(dialog).getByText("下单 IP")).toBeInTheDocument();
    expect(within(dialog).getByText("112.65.12.34")).toBeInTheDocument();
    expect(within(dialog).getByText("2026-01-05 09:41:30")).toBeInTheDocument();
  });

  it("点击表头循环切换排序，并把 sort 参数带给后端", async () => {
    window.history.pushState({}, "", "/products");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/categories", data: { rows: demoBootstrapCategories } },
      { match: "/api/admin/products", data: pagedProducts },
      { match: "/api/admin/alerts", data: demoAlerts },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByText("爱奇艺黄金 VIP 会员");

    const priceHeader = screen.getByRole("columnheader", { name: "售价" });

    /* 第一次点：升序 */
    await user.click(priceHeader);
    await waitFor(() => {
      expect(mock!.calls.filter((c) => c.url.startsWith("/api/admin/products?")).pop()!.url).toContain(
        "sort=price_asc"
      );
    });
    expect(priceHeader).toHaveAttribute("aria-sort", "ascending");

    /* 再点一次：降序 */
    await user.click(priceHeader);
    await waitFor(() => {
      expect(mock!.calls.filter((c) => c.url.startsWith("/api/admin/products?")).pop()!.url).toContain(
        "sort=price_desc"
      );
    });
    expect(priceHeader).toHaveAttribute("aria-sort", "descending");

    /* 第三次点：取消排序，回到默认 */
    await user.click(priceHeader);
    await waitFor(() => {
      expect(mock!.calls.filter((c) => c.url.startsWith("/api/admin/products?")).pop()!.url).toContain(
        "sort=default"
      );
    });
    expect(priceHeader).toHaveAttribute("aria-sort", "none");
  });

  it("卡密管理的导出链接带着当前筛选条件", async () => {
    window.history.pushState({}, "", "/cards");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/products", data: pagedProducts },
      { match: "/api/admin/cards/stats", data: { total: 0, available: 0, sold: 0, locked: 0 } },
      { match: "/api/admin/cards", data: emptyCards },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByRole("option", { name: "爱奇艺黄金 VIP 会员" });

    /* 先选商品与规格 */
    await user.selectOptions(screen.getByLabelText("按商品筛选"), "p001");
    await waitFor(() => expect(screen.getByLabelText("按规格筛选")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("按规格筛选"), "月卡");

    /* 点表头排序 */
    await user.click(screen.getByRole("columnheader", { name: "规格" }));
    await waitFor(() => {
      expect(mock!.calls.filter((c) => c.url.startsWith("/api/admin/cards?")).pop()!.url).toContain(
        "sort=spec_asc"
      );
    });

    const link = screen.getByRole("link", { name: /导出 CSV/ });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("/api/admin/cards/export");
    expect(href).toContain("productId=p001");
    expect(href).toContain("sort=spec_asc");
    /* 规格是中文，会被编码 */
    expect(href).toContain(encodeURIComponent("月卡"));
  });

  it("侧边栏可以打开修改密码弹窗，并校验两次输入一致", async () => {
    window.history.pushState({}, "", "/");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/dashboard", data: dashboardData },
      { match: "/api/admin/password", method: "POST", data: { changed: true } },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByText("今日订单");

    await user.click(screen.getByRole("button", { name: /修改登录密码/ }));

    const dialog = await screen.findByRole("dialog", { name: "修改登录密码" });
    expect(within(dialog).getByLabelText("原密码")).toBeInTheDocument();

    /* 两次输入不一致时，提交按钮应保持禁用 */
    await user.type(within(dialog).getByLabelText("原密码"), "123456");
    await user.type(within(dialog).getByLabelText("新密码"), "newpass123");
    await user.type(within(dialog).getByLabelText("确认新密码"), "different");

    expect(within(dialog).getByText("两次输入的密码不一致")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "确认修改" })).toBeDisabled();

    /* 改成一致后即可提交 */
    await user.clear(within(dialog).getByLabelText("确认新密码"));
    await user.type(within(dialog).getByLabelText("确认新密码"), "newpass123");
    await user.click(within(dialog).getByRole("button", { name: "确认修改" }));

    await waitFor(() => {
      const call = mock!.calls.find((c) => c.url === "/api/admin/password");
      expect(call).toBeTruthy();
      expect(call!.body).toMatchObject({ oldPassword: "123456", newPassword: "newpass123" });
    });
  });

  it("新密码太短时不允许提交", async () => {
    window.history.pushState({}, "", "/");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/dashboard", data: dashboardData },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByText("今日订单");
    await user.click(screen.getByRole("button", { name: /修改登录密码/ }));

    const dialog = await screen.findByRole("dialog", { name: "修改登录密码" });
    await user.type(within(dialog).getByLabelText("原密码"), "123456");
    await user.type(within(dialog).getByLabelText("新密码"), "abc");

    expect(within(dialog).getByText(/密码至少 6 位/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "确认修改" })).toBeDisabled();
  });

  it("通知设置里密钥不回显，并能发出测试请求", async () => {
    window.history.pushState({}, "", "/settings");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/settings", data: demoAdminSettings },
      { match: "/api/admin/notify/test", method: "POST", data: { sent: true } },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);

    await user.click(await screen.findByRole("button", { name: /通知设置/ }));

    const pass = await screen.findByLabelText("密码 / 授权码");
    expect(pass).toHaveValue("");
    expect(screen.getByText(/已填写/)).toBeInTheDocument();
    expect(screen.getByText(/尚未填写/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("测试接收地址"), "buyer@example.com");
    await user.click(screen.getByRole("button", { name: "测试邮件" }));

    await waitFor(() => {
      const call = mock!.calls.find((c) => c.url === "/api/admin/notify/test");
      expect(call).toBeTruthy();
      expect(call!.body).toMatchObject({ channel: "email", target: "buyer@example.com" });
    });
  });
});

const demoCustomer = {
  id: "U100301",
  dbId: 1,
  name: "客户 0001111",
  contact: "13800001111",
  orders: 3,
  amount: 128.8,
  lastIp: "112.65.12.34",
  regAt: "2026-01-01 10:00:00",
  lastAt: "2026-01-05 09:41:22",
};

const demoCustomerDetail = {
  customer: demoCustomer,
  summary: {
    totalOrders: 3,
    paidOrders: 2,
    totalAmount: 128.8,
    firstOrderAt: "2026-01-01 10:00:00",
    lastOrderAt: "2026-01-05 09:41:22",
    ipCount: 2,
  },
  ips: [
    { ip: "112.65.12.34", count: 2, lastAt: "2026-01-05 09:41:22" },
    { ip: "58.246.99.10", count: 1, lastAt: "2026-01-02 11:20:00" },
  ],
  orders: [
    {
      no: "JKP20260105018",
      productId: "p001",
      product: "爱奇艺黄金 VIP 会员",
      spec: "月卡",
      qty: 1,
      unitPrice: 12.8,
      amount: 12.8,
      pay: "微信支付",
      status: "已发货",
      ip: "112.65.12.34",
      time: "2026-01-05 09:41:22",
      paidAt: "2026-01-05 09:41:30",
      closedAt: "",
    },
    {
      no: "JKP20260102007",
      productId: "p002",
      product: "腾讯视频 VIP 会员",
      spec: "季卡",
      qty: 2,
      unitPrice: 58,
      amount: 116,
      pay: "支付宝",
      status: "已发货",
      ip: "58.246.99.10",
      time: "2026-01-02 11:20:00",
      paidAt: "2026-01-02 11:20:08",
      closedAt: "",
    },
  ],
};

/** 订单列表里的一行 */
const demoOrderRow = {
  id: 1,
  no: "JKP20260105018",
  productId: "p001",
  product: "爱奇艺黄金 VIP 会员",
  spec: "月卡",
  qty: 1,
  unitPrice: 12.8,
  amount: 12.8,
  pay: "微信支付",
  payChannel: "wechat",
  status: "已发货",
  contact: "13800001111",
  time: "2026-01-05 09:41:22",
  expiresAt: "2026-01-05 09:56:22",
  paidAt: "2026-01-05 09:41:30",
  closedAt: "",
  ip: "112.65.12.34",
};

/** 订单详情接口返回的完整订单 */
const demoOrderDetail = {
  ...demoOrderRow,
  secrets: ["KEY-1"],
};

const demoAlerts = {
  serverTime: "2026-01-05 10:00:00",
  threshold: 20,
  unseenOrders: 2,
  unseenAmount: 45.6,
  pendingOrders: 1,
  lowStock: [
    { id: "p009", name: "WPS 会员", emoji: "📝", stock: 0, soldOut: true },
    { id: "p003", name: "QQ 音乐豪华绿钻", emoji: "🎵", stock: 3, soldOut: false },
  ],
  soldOutCount: 1,
  events: [
    {
      id: "order-JKP20260105018",
      type: "order",
      level: "info",
      title: "新订单",
      desc: "爱奇艺黄金 VIP 会员 · 月卡 × 1 · ¥12.80",
      extra: "13800001111",
      ip: "112.65.12.34",
      target: "JKP20260105018",
      time: "2026-01-05 09:41:22",
    },
    {
      id: "stock-p009",
      type: "stock",
      level: "danger",
      title: "商品已售罄",
      desc: "📝 WPS 会员",
      extra: "可用卡密为 0，请尽快补货",
      target: "p009",
      time: "",
    },
  ],
};

/**
 * alerts 的 mock 要真实反映 since 的语义：
 * 演示订单都发生在 09:41，所以 since 晚于它就没有「新订单」了。
 * 写死一个固定值会让「首次打开不该刷屏」这类测试完全失真。
 *
 * 注意必须用 URLSearchParams 解析：请求端会把时间里的空格编码成 `+`，
 * 而 decodeURIComponent 不会把 `+` 还原成空格，时间比较就会失真。
 */
function alertsFor(url: string) {
  const since = new URL(url, "http://localhost").searchParams.get("since") ?? "";
  const fresh = !since || since < "2026-01-05 09:41:22";

  return fresh
    ? demoAlerts
    : {
        ...demoAlerts,
        unseenOrders: 0,
        unseenAmount: 0,
        events: demoAlerts.events.filter((e) => e.type !== "order"),
      };
}

describe("管理后台 · 客户管理与提醒", () => {
  let mock: MockResult | null = null;

  beforeEach(() => {
    mock?.restore();
    mock = null;
  });

  it("客户列表显示最近下单 IP，且不再有封禁按钮", async () => {
    window.history.pushState({}, "", "/users");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/users/stats", data: { total: 12, active: 9, converted: 7, amount: 3560.5 } },
      { match: "/api/admin/users", data: { rows: [demoCustomer], total: 1, page: 1, perPage: 8 } },
      { match: "/api/admin/alerts", data: demoAlerts },
    ]);

    render(<AdminApp />);

    expect(await screen.findByText("13800001111")).toBeInTheDocument();
    /* IP 直接体现在列表里 */
    expect(screen.getByText("112.65.12.34")).toBeInTheDocument();
    /* 累计消费保留（金额统一保留两位小数） */
    expect(screen.getByText("¥128.80")).toBeInTheDocument();

    /* 没有登录就没有封禁的意义，按钮必须消失 */
    expect(screen.queryByRole("button", { name: /封禁/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /解封/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "状态" })).not.toBeInTheDocument();
  });

  it("客户详情展示购买记录与每一笔的下单 IP", async () => {
    window.history.pushState({}, "", "/users");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/users/stats", data: { total: 12, active: 9, converted: 7, amount: 3560.5 } },
      { match: "/api/admin/users", data: { rows: [demoCustomer], total: 1, page: 1, perPage: 8 } },
      { match: "/api/admin/users/U100301", data: demoCustomerDetail },
      { match: "/api/admin/alerts", data: demoAlerts },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByText("13800001111");

    await user.click(screen.getByRole("button", { name: "查看详情" }));

    const dialog = await screen.findByRole("dialog", { name: "客户详情" });

    /* 买过哪些东西 */
    expect(within(dialog).getByText("JKP20260105018")).toBeInTheDocument();
    expect(within(dialog).getByText("爱奇艺黄金 VIP 会员")).toBeInTheDocument();
    expect(within(dialog).getByText("腾讯视频 VIP 会员")).toBeInTheDocument();

    /* 每一笔订单的下单 IP 都在 */
    expect(within(dialog).getAllByText("112.65.12.34").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("58.246.99.10").length).toBeGreaterThan(0);

    /* 消费汇总 */
    expect(within(dialog).getAllByText(/累计消费/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("¥128.80").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("购买记录")).toBeInTheDocument();
  });

  it("下单 IP 用下拉框筛选，默认显示全部", async () => {
    window.history.pushState({}, "", "/users");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/users/stats", data: { total: 12, active: 9, converted: 7, amount: 0 } },
      { match: "/api/admin/users", data: { rows: [demoCustomer], total: 1, page: 1, perPage: 8 } },
      { match: "/api/admin/users/U100301", data: demoCustomerDetail },
      { match: "/api/admin/alerts", data: demoAlerts },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByText("13800001111");
    await user.click(screen.getByRole("button", { name: "查看详情" }));

    const dialog = await screen.findByRole("dialog", { name: "客户详情" });

    /* 是一个下拉框，不是铺满屏幕的标签墙 */
    const select = within(dialog).getByLabelText("按下单 IP 筛选");
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveValue("");
    /* 选项里带上每个 IP 的订单数 */
    expect(within(select).getByRole("option", { name: /全部 IP（2 笔）/ })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: /58\.246\.99\.10（1 笔/ })).toBeInTheDocument();

    /* 默认两笔都在 */
    expect(within(dialog).getByText("JKP20260105018")).toBeInTheDocument();
    expect(within(dialog).getByText("JKP20260102007")).toBeInTheDocument();

    /* 选某个 IP，只留下那个 IP 的订单 */
    await user.selectOptions(select, "58.246.99.10");
    await waitFor(() => {
      expect(within(dialog).queryByText("JKP20260105018")).not.toBeInTheDocument();
    });
    expect(within(dialog).getByText("JKP20260102007")).toBeInTheDocument();
    expect(within(dialog).getByText(/该 IP 下/)).toBeInTheDocument();

    /* 「清除」回到全部 */
    await user.click(within(dialog).getByRole("button", { name: "清除" }));
    await waitFor(() => {
      expect(within(dialog).getByText("JKP20260105018")).toBeInTheDocument();
    });
    expect(select).toHaveValue("");
  });

  it("点购买记录里的订单会跳到订单列表，并把那一行标出来（不弹详情）", async () => {
    window.history.pushState({}, "", "/users");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/users/stats", data: { total: 12, active: 9, converted: 7, amount: 0 } },
      { match: "/api/admin/users", data: { rows: [demoCustomer], total: 1, page: 1, perPage: 8 } },
      { match: "/api/admin/users/U100301", data: demoCustomerDetail },
      { match: "/api/admin/orders/stats", data: { total: 2, shipped: 1, revenue: 60.8, pending: 0 } },
      {
        match: "/api/admin/orders",
        data: {
          rows: [
            demoOrderRow,
            { ...demoOrderRow, no: "JKP20260102007", product: "腾讯视频 VIP 会员", ip: "58.246.99.10" },
          ],
          total: 2, page: 1, perPage: 8,
        },
      },
      { match: "/api/admin/alerts", data: demoAlerts },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByText("13800001111");
    await user.click(screen.getByRole("button", { name: "查看详情" }));

    const dialog = await screen.findByRole("dialog", { name: "客户详情" });
    await user.click(within(dialog).getByText("JKP20260105018"));

    /* 跳到订单管理并带上订单号 */
    await waitFor(() => {
      expect(window.location.pathname).toBe("/orders");
      expect(window.location.search).toContain("no=JKP20260105018");
    });

    /* 关键：**不**弹详情，而是留在列表里 —— 用户要看的是「它在列表里的位置」 */
    expect(screen.queryByRole("dialog", { name: "订单详情" })).not.toBeInTheDocument();

    /* 顶部说明为什么列表只剩这一笔 */
    expect(await screen.findByText(/已定位到订单/)).toBeInTheDocument();

    /* 目标行用不同的颜色标出来 */
    await waitFor(() => {
      const row = document.querySelector('tr[data-order-no="JKP20260105018"]');
      expect(row).toBeTruthy();
      expect(row).toHaveClass("is-focus");
    });

    /* 其它订单不该被标 */
    const other = document.querySelector('tr[data-order-no="JKP20260102007"]');
    expect(other).not.toHaveClass("is-focus");

    /* 点「显示全部订单」能取消定位 */
    await user.click(screen.getByRole("button", { name: "显示全部订单" }));
    await waitFor(() => {
      expect(window.location.search).not.toContain("no=");
    });
  });

  it("点「查看详情」才会请求该客户，不做多余请求", async () => {
    window.history.pushState({}, "", "/users");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/users/stats", data: { total: 12, active: 9, converted: 7, amount: 0 } },
      { match: "/api/admin/users", data: { rows: [demoCustomer], total: 1, page: 1, perPage: 8 } },
      { match: "/api/admin/users/U100301", data: demoCustomerDetail },
      { match: "/api/admin/alerts", data: demoAlerts },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByText("13800001111");

    expect(mock.calls.some((c) => c.url === "/api/admin/users/U100301")).toBe(false);

    await user.click(screen.getByRole("button", { name: "查看详情" }));
    await screen.findByRole("dialog", { name: "客户详情" });

    expect(mock.calls.some((c) => c.url === "/api/admin/users/U100301")).toBe(true);
  });

  it("顶栏铃铛显示新订单角标，并列出库存预警", async () => {
    window.history.pushState({}, "", "/");
    localStorage.setItem("jkp.admin.lastSeen", JSON.stringify("2026-01-05 09:00:00"));
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/dashboard", data: dashboardData },
      { match: "/api/admin/alerts", data: alertsFor },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByText("今日订单");

    /* 2 笔未读订单 → 角标（轮询是异步的，要等它回来） */
    const bell = await screen.findByRole("button", { name: /提醒/ });
    await waitFor(() => {
      expect(within(bell).getByText("2")).toBeInTheDocument();
    });

    await user.click(bell);

    /* 库存预警与新订单都要出现在下拉里 */
    expect(await screen.findByText(/1 个商品已售罄/)).toBeInTheDocument();
    expect(screen.getAllByText(/WPS 会员/).length).toBeGreaterThan(0);

    const panel = document.querySelector(".alerts-panel")!;
    expect(within(panel as HTMLElement).getByText("新订单")).toBeInTheDocument();
    expect(within(panel as HTMLElement).getAllByText(/112\.65\.12\.34/).length).toBeGreaterThan(0);
  });

  it("从未查看过时不会把历史订单当成新订单刷屏", async () => {
    window.history.pushState({}, "", "/");
    localStorage.removeItem("jkp.admin.lastSeen");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/dashboard", data: dashboardData },
      { match: "/api/admin/alerts", data: alertsFor },
    ]);

    render(<AdminApp />);
    await screen.findByText("今日订单");

    /* 第一次打开：把当前时刻记为基准，角标不显示 */
    const bell = await screen.findByRole("button", { name: /提醒/ });
    expect(within(bell).queryByText("2")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(localStorage.getItem("jkp.admin.lastSeen")).toContain("2026-01-05 10:00:00");
    });
  });
});

describe("管理后台 · 批量操作", () => {
  let mock: MockResult | null = null;

  beforeEach(() => {
    mock?.restore();
    mock = null;
  });

  it("勾选商品后出现批量操作条，并能批量下架", async () => {
    window.history.pushState({}, "", "/products");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/categories", data: { rows: demoBootstrapCategories } },
      { match: "/api/admin/products", data: pagedProducts },
      { match: "/api/admin/products/batch", method: "POST", data: { affected: 2, skipped: [] } },
      { match: "/api/admin/alerts", data: demoAlerts },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByText("爱奇艺黄金 VIP 会员");

    /* 没勾选时不该有批量条 */
    expect(screen.queryByText(/已选中/)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("选择 爱奇艺黄金 VIP 会员"));
    await user.click(screen.getByLabelText("选择 腾讯视频 VIP 会员"));

    expect(await screen.findByText("已选中 2 个商品")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "批量下架" }));

    await waitFor(() => {
      const call = mock!.calls.find((c) => c.url === "/api/admin/products/batch");
      expect(call).toBeTruthy();
      expect(call!.body).toMatchObject({
        ids: ["p001", "p002"],
        action: "off",
      });
    });
  });

  it("全选本页只覆盖当前页，翻页会清空选择", async () => {
    window.history.pushState({}, "", "/products");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/categories", data: { rows: demoBootstrapCategories } },
      { match: "/api/admin/products", data: pagedProducts },
      { match: "/api/admin/alerts", data: demoAlerts },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByText("爱奇艺黄金 VIP 会员");

    await user.click(screen.getByLabelText("全选本页商品"));
    expect(await screen.findByText("已选中 2 个商品")).toBeInTheDocument();

    /* 再点一次取消全选 */
    await user.click(screen.getByLabelText("全选本页商品"));
    await waitFor(() => {
      expect(screen.queryByText(/已选中/)).not.toBeInTheDocument();
    });
  });

  it("批量删除卡密时，已售的那条勾选框不可用", async () => {
    window.history.pushState({}, "", "/cards");
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/products", data: pagedProducts },
      { match: "/api/admin/cards/stats", data: { total: 2, available: 1, sold: 1, locked: 0 } },
      {
        match: "/api/admin/cards",
        data: {
          rows: [
            {
              id: 1, key: "FREE-KEY-1", product: "p001", productName: "爱奇艺黄金 VIP 会员",
              spec: "月卡", status: "未售", importedAt: "2026-01-05 09:00:00", soldAt: "", order: "",
            },
            {
              id: 2, key: "SOLD-KEY-1", product: "p001", productName: "爱奇艺黄金 VIP 会员",
              spec: "月卡", status: "已售", importedAt: "2026-01-04 09:00:00",
              soldAt: "2026-01-05 10:00:00", order: "JKP20260105018",
            },
          ],
          total: 2, page: 1, perPage: 10,
        },
      },
      { match: "/api/admin/cards/batch-delete", method: "POST", data: { affected: 1, skipped: 0 } },
      { match: "/api/admin/alerts", data: demoAlerts },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByText("FREE-KEY-1");

    /* 已售卡密要保留用于订单追溯，勾选框直接禁用 */
    expect(screen.getByLabelText("选择 SOLD-KEY-1")).toBeDisabled();
    expect(screen.getByLabelText("选择 FREE-KEY-1")).toBeEnabled();

    await user.click(screen.getByLabelText("选择 FREE-KEY-1"));
    expect(await screen.findByText("已选中 1 条卡密")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "批量删除" }));
    /* 会先弹确认框 */
    const dialog = await screen.findByRole("dialog", { name: /批量删除/ });
    await user.click(within(dialog).getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      const call = mock!.calls.find((c) => c.url === "/api/admin/cards/batch-delete");
      expect(call).toBeTruthy();
      expect(call!.body).toMatchObject({ ids: [1] });
    });
  });
});

describe("管理后台", () => {
  let mock: MockResult | null = null;

  beforeEach(() => {
    window.history.pushState({}, "", "/");
    mock?.restore();
    mock = null;
  });

  it("未登录访问后台会跳转到登录页（不再白屏）", async () => {
    mock = installFetchMock([
      { match: "/api/admin/me", fail: { status: 401, code: "UNAUTHORIZED", message: "请先登录" } },
      { match: "/api/admin/captcha", data: captchaData },
    ]);

    render(<AdminApp />);

    /* 关键断言：必须出现登录表单，而不是一片空白 */
    expect(await screen.findByText("简卡铺 · 管理后台")).toBeInTheDocument();
    expect(screen.getByLabelText("管理员账号")).toBeInTheDocument();
    expect(screen.getByLabelText("登录密码")).toBeInTheDocument();
    /* 验证码由服务端下发的 SVG 渲染成图片（异步加载，需等待） */
    expect(await screen.findByAltText("验证码")).toBeInTheDocument();
  });

  it("登录成功后进入数据概览", async () => {
    mock = installFetchMock([
      { match: "/api/admin/captcha", data: captchaData },
      {
        match: "/api/admin/login",
        method: "POST",
        data: { admin: demoAdmin },
      },
      { match: "/api/admin/dashboard", data: dashboardData },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);

    await screen.findByText("简卡铺 · 管理后台");

    await user.type(screen.getByLabelText("登录密码"), "123456");
    await user.type(screen.getByLabelText("验证码"), "AB3D");
    await user.click(screen.getByRole("button", { name: "登 录" }));

    /* 登录请求体应带上验证码 id 与内容 */
    await waitFor(() => {
      const call = mock!.calls.find((c) => c.url === "/api/admin/login");
      expect(call).toBeTruthy();
      expect(call!.body).toMatchObject({
        username: "admin",
        password: "123456",
        captchaId: "cap-1",
        captchaCode: "AB3D",
      });
    });

    /* 进入后台后应看到侧边栏与概览数据 */
    expect(await screen.findByText("今日订单")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /数据概览/ })).toBeInTheDocument();
    expect(screen.getByText("可用卡密")).toBeInTheDocument();
    /* 系统信息区展示数据库类型 */
    expect(screen.getByText("数据库")).toBeInTheDocument();
  });

  it("已登录时直接渲染后台壳层与侧边栏导航", async () => {
    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/dashboard", data: dashboardData },
    ]);

    render(<AdminApp />);

    expect(await screen.findByRole("link", { name: /数据概览/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /商品管理/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /订单管理/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /系统设置/ })).toBeInTheDocument();
    /* 顶栏显示当前管理员（昵称与角色同名，会出现两次） */
    expect(screen.getAllByText("超级管理员").length).toBeGreaterThan(0);
  });

  it("商品管理页渲染列表并可切换上下架", async () => {
    window.history.pushState({}, "", "/products");

    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/categories", data: { rows: demoBootstrapCategories } },
      { match: "/api/admin/products", data: pagedProducts },
      { match: `/api/admin/products/${demoProduct.id}/toggle`, method: "POST", data: { id: "p001", status: 0 } },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);

    expect(await screen.findByText("爱奇艺黄金 VIP 会员")).toBeInTheDocument();
    expect(screen.getByText("腾讯视频 VIP 会员")).toBeInTheDocument();
    expect(screen.getByText("共 2 件商品")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "下架" })[0]!);

    await waitFor(() => {
      const call = mock!.calls.find((c) => c.url.includes("/toggle"));
      expect(call).toBeTruthy();
      expect(call!.method).toBe("POST");
    });
  });

  it("商品编辑页载入已有数据并支持修改规格", async () => {
    window.history.pushState({}, "", "/products/p001");

    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/categories", data: { rows: demoBootstrapCategories } },
      { match: "/api/admin/products/p001", data: demoProduct },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);

    /* 表单被填充 */
    const nameInput = await screen.findByLabelText(/商品名称/);
    await waitFor(() => expect(nameInput).toHaveValue("爱奇艺黄金 VIP 会员"));

    /* 已有规格渲染成 chip */
    expect(screen.getByText("月卡")).toBeInTheDocument();
    expect(screen.getByText("季卡")).toBeInTheDocument();

    /* 回车添加新规格 */
    const specInput = screen.getByPlaceholderText(/输入规格后按回车添加/);
    await user.type(specInput, "年卡{Enter}");
    expect(await screen.findByText("年卡")).toBeInTheDocument();

    /* 删除一个规格 */
    await user.click(screen.getByLabelText("删除规格 月卡"));
    await waitFor(() => expect(screen.queryByText("月卡")).not.toBeInTheDocument());
  });

  it("系统设置的密钥字段不回显明文，并显示配置状态", async () => {
    window.history.pushState({}, "", "/settings");

    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/settings", data: demoAdminSettings },
      { match: "/api/admin/alerts", data: demoAlerts },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);

    /* 切到支付分区 */
    await user.click(await screen.findByRole("button", { name: /支付设置/ }));

    const apiV3 = await screen.findByLabelText("APIv3 密钥");
    expect(apiV3).toHaveValue("");
    expect(screen.getAllByText(/已填写/).length).toBeGreaterThan(0);

    /* 私钥用 textarea 粘贴，同样不回显 */
    expect(screen.getByLabelText("商户私钥（apiclient_key.pem）")).toHaveValue("");
    expect(screen.getByLabelText("应用私钥")).toHaveValue("");
  });

  it("支付设置会明确告诉管理员「启用了但没配置，前台不显示」", async () => {
    window.history.pushState({}, "", "/settings");

    /* 微信：启用了但缺密钥；支付宝：已配置完整；测试：可用 */
    const settingsWithGaps = {
      ...demoAdminSettings,
      payment: {
        ...demoAdminSettings.payment,
        wxEnable: 1,
        wxAppId: "",
        wxPrivateKeySet: false,
        wxApiV3KeySet: false,
        channelStatus: {
          wechat: { enabled: true, configured: false, ready: false, missing: ["AppID", "证书序列号", "商户私钥"] },
          alipay: { enabled: true, configured: true, ready: true, missing: [] },
          test: { enabled: true, configured: true, ready: true, missing: [] },
        },
        availableChannels: ["alipay", "test"],
        enabledChannels: ["wechat", "alipay", "test"],
      },
    };

    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/settings", data: settingsWithGaps },
      { match: "/api/admin/alerts", data: demoAlerts },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);
    await user.click(await screen.findByRole("button", { name: /支付设置/ }));

    /* 顶部一句话说明前台会显示什么 —— 这正是「我打开了为什么前台没有」的答案 */
    expect(await screen.findByText(/前台会显示这些支付方式/)).toBeInTheDocument();
    expect(screen.getByText("微信支付、支付宝、测试支付")).toBeInTheDocument();
    /* 并指出哪个点不了 */
    expect(screen.getByText(/还没配置完整/)).toBeInTheDocument();

    /* 微信那一节要标出「暂不可用」并列出缺什么 */
    expect(screen.getByText("⚠ 暂不可用")).toBeInTheDocument();
    expect(screen.getByText(/缺少配置：AppID、证书序列号、商户私钥/)).toBeInTheDocument();

    /* 支付宝与测试都可正常收款 */
    expect(screen.getAllByText("✓ 可正常收款").length).toBe(2);
  });

  it("保存设置会提交完整分区数据", async () => {
    window.history.pushState({}, "", "/settings");

    mock = installFetchMock([
      { match: "/api/admin/me", data: { admin: demoAdmin } },
      { match: "/api/admin/settings", data: demoAdminSettings },
    ]);

    const user = userEvent.setup();
    render(<AdminApp />);

    await user.click(await screen.findByRole("button", { name: /基础设置/ }));

    const nameInput = await screen.findByLabelText("站点名称");
    await user.clear(nameInput);
    await user.type(nameInput, "简卡铺-测试");

    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      const call = mock!.calls.find((c) => c.method === "PUT" && c.url === "/api/admin/settings");
      expect(call).toBeTruthy();
      const body = call!.body as { site: { name: string }; security: { lockThreshold: number } };
      expect(body.site.name).toBe("简卡铺-测试");
      /* 其它分区也要一并提交，避免被服务端当成清空 */
      expect(body.security.lockThreshold).toBe(5);
    });
  });
});

/* 分类下拉用的固定数据 */
const demoBootstrapCategories = [
  { id: "video", name: "视频会员", sort: 1, status: 1, remark: "", count: 2 },
  { id: "music", name: "音乐会员", sort: 2, status: 1, remark: "", count: 0 },
];
