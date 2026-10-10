/**
 * 简卡铺 · 前台应用测试
 * ---------------------------------------------------------------------------
 * 覆盖：数据渲染 / 筛选搜索 / 下单支付发货全流程 / 查单
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteApp } from "./App";
import {
  demoBootstrap,
  demoOrder,
  demoPaidOrder,
  installFetchMock,
  type MockResult,
} from "../test/mockFetch";

function mountSite() {
  render(<SiteApp />);
}

describe("前台商城", () => {
  let mock: MockResult | null = null;

  beforeEach(() => {
    window.history.pushState({}, "", "/");
    mock?.restore();
    mock = null;
  });

  it("从接口加载并渲染站点信息与商品列表", async () => {
    mock = installFetchMock([
      { match: "/api/public/bootstrap", data: demoBootstrap },
      { match: "/api/public/stats", data: { totalOrders: 1, shippedOrders: 1, soldCards: 2, products: 2 } },
    ]);

    mountSite();

    /* 站点名来自接口设置，而不是写死在模板里 */
    expect(await screen.findByText("爱奇艺黄金 VIP 会员")).toBeInTheDocument();
    expect(screen.getByText("腾讯视频 VIP 会员")).toBeInTheDocument();
    expect(screen.getByText("¥12.8")).toBeInTheDocument();
    expect(screen.getByText("热销")).toBeInTheDocument();
  });

  it("搜索关键词会过滤商品", async () => {
    mock = installFetchMock([
      { match: "/api/public/bootstrap", data: demoBootstrap },
      { match: "/api/public/stats", data: { totalOrders: 0, shippedOrders: 0, soldCards: 0, products: 2 } },
    ]);

    const user = userEvent.setup();
    mountSite();
    await screen.findByText("爱奇艺黄金 VIP 会员");

    await user.type(screen.getByLabelText("筛选商品"), "腾讯");

    await waitFor(() => {
      expect(screen.queryByText("爱奇艺黄金 VIP 会员")).not.toBeInTheDocument();
    });
    expect(screen.getByText("腾讯视频 VIP 会员")).toBeInTheDocument();
  });

  it("分类标签会过滤商品", async () => {
    mock = installFetchMock([
      { match: "/api/public/bootstrap", data: demoBootstrap },
      { match: "/api/public/stats", data: { totalOrders: 0, shippedOrders: 0, soldCards: 0, products: 2 } },
    ]);

    const user = userEvent.setup();
    mountSite();
    await screen.findByText("爱奇艺黄金 VIP 会员");

    /* 切到「音乐会员」——没有商品，应显示空状态 */
    await user.click(screen.getByRole("button", { name: "音乐会员" }));

    await waitFor(() => {
      expect(screen.getByText("没有找到相关商品，换个关键词试试")).toBeInTheDocument();
    });
  });

  it("下单 → 支付 → 发货全流程", async () => {
    mock = installFetchMock([
      { match: "/api/public/bootstrap", data: demoBootstrap },
      { match: "/api/public/stats", data: { totalOrders: 0, shippedOrders: 0, soldCards: 0, products: 2 } },
      { match: "/api/public/orders", method: "POST", data: demoOrder },
      { match: `/api/public/orders/${demoOrder.no}/pay`, method: "POST", data: demoPaidOrder },
    ]);

    const user = userEvent.setup();
    mountSite();
    await screen.findByText("爱奇艺黄金 VIP 会员");

    /* 打开下单弹窗 */
    await user.click(screen.getAllByRole("button", { name: "立即购买" })[0]!);

    /* 弹窗以 dialog 角色出现，标题即「确认订单」 */
    expect(await screen.findByRole("dialog", { name: "确认订单" })).toBeInTheDocument();

    /* 联系方式现在是必填的，先填上 */
    await user.type(screen.getByLabelText(/联系方式/), "13800001111");

    /* 步进到支付方式 */
    await user.click(screen.getByRole("button", { name: "去支付" }));
    expect(await screen.findByText("选择支付方式")).toBeInTheDocument();

    /* 创建订单 —— 断言提交体正确 */
    await user.click(screen.getByRole("button", { name: /确认支付/ }));

    const createCall = mock.calls.find(
      (c) => c.url === "/api/public/orders" && c.method === "POST"
    );
    expect(createCall).toBeTruthy();
    expect(createCall!.body).toMatchObject({
      productId: "p001",
      spec: "月卡",
      qty: 1,
      contact: "13800001111",
      payChannel: "test",
    });

    /* 测试渠道：不扫码，点「模拟支付成功」 */
    expect(await screen.findByText("测试支付")).toBeInTheDocument();
    expect(screen.getByText(demoOrder.no)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "模拟支付成功" }));

    expect(await screen.findByText("支付成功，卡密已发货")).toBeInTheDocument();
    expect(screen.getByText("AIQY-8F3K-2M9D-77QX")).toBeInTheDocument();
    expect(screen.getByText("AIQY-5T1P-6B4N-20LZ")).toBeInTheDocument();
  });

  it("售罄商品禁用购买按钮", async () => {
    const soldOut = { ...demoBootstrap, products: [{ ...demoBootstrap.products[0]!, stock: 0 }] };
    mock = installFetchMock([
      { match: "/api/public/bootstrap", data: soldOut },
      { match: "/api/public/stats", data: { totalOrders: 0, shippedOrders: 0, soldCards: 0, products: 1 } },
    ]);

    mountSite();
    await screen.findByText("爱奇艺黄金 VIP 会员");

    expect(screen.getByRole("button", { name: "已售罄" })).toBeDisabled();
    expect(screen.getByText("已 售 罄")).toBeInTheDocument();
  });

  it("规格按各自的库存展示，售罄的规格不可选", async () => {
    mock = installFetchMock([
      { match: "/api/public/bootstrap", data: demoBootstrap },
      { match: "/api/public/stats", data: { totalOrders: 0, shippedOrders: 0, soldCards: 0, products: 2 } },
    ]);

    const user = userEvent.setup();
    mountSite();
    await screen.findByText("爱奇艺黄金 VIP 会员");

    await user.click(screen.getAllByRole("button", { name: "立即购买" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "确认订单" });

    /* 月卡有 55 条，可正常选择 */
    const monthly = within(dialog).getByRole("button", { name: /月卡/ });
    expect(monthly).toBeEnabled();
    expect(within(dialog).getByText("剩 55")).toBeInTheDocument();

    /* 季卡库存为 0，必须禁用并标出售罄 */
    const quarterly = within(dialog).getByRole("button", { name: /季卡/ });
    expect(quarterly).toBeDisabled();
    expect(within(dialog).getByText("售罄")).toBeInTheDocument();

    /* 年卡只剩 5 条，数量上限应被它约束住 */
    expect(within(dialog).getByText("剩 5")).toBeInTheDocument();
  });

  it("下单时提交的是所选规格", async () => {
    mock = installFetchMock([
      { match: "/api/public/bootstrap", data: demoBootstrap },
      { match: "/api/public/stats", data: { totalOrders: 0, shippedOrders: 0, soldCards: 0, products: 2 } },
      { match: "/api/public/orders", method: "POST", data: demoOrder },
      { match: `/api/public/orders/${demoOrder.no}/pay`, method: "POST", data: demoPaidOrder },
    ]);

    const user = userEvent.setup();
    mountSite();
    await screen.findByText("爱奇艺黄金 VIP 会员");
    await user.click(screen.getAllByRole("button", { name: "立即购买" })[0]!);

    const dialog = await screen.findByRole("dialog", { name: "确认订单" });
    /* 改选「年卡」 */
    await user.click(within(dialog).getByRole("button", { name: /年卡/ }));
    await user.type(within(dialog).getByLabelText(/联系方式/), "buyer@example.com");
    await user.click(within(dialog).getByRole("button", { name: "去支付" }));
    await user.click(await screen.findByRole("button", { name: /确认支付/ }));

    const createCall = mock.calls.find((c) => c.url === "/api/public/orders" && c.method === "POST");
    expect(createCall).toBeTruthy();
    expect((createCall!.body as { spec: string }).spec).toBe("年卡");
  });

  it("后台启用的支付方式前台都会显示，没配好的标成「暂不可用」", async () => {
    const bootstrapWithChannels = {
      ...demoBootstrap,
      settings: {
        ...demoBootstrap.settings,
        payment: {
          wxEnable: 1,
          aliEnable: 1,
          testEnable: 1,
          channels: ["wechat", "alipay", "test"] as const,
          /* 微信还没填密钥 */
          channelReady: { wechat: false, alipay: true, test: true },
          qrExpireMinutes: 15,
        },
      },
    };

    mock = installFetchMock([
      { match: "/api/public/bootstrap", data: bootstrapWithChannels },
      { match: "/api/public/stats", data: { totalOrders: 0, shippedOrders: 0, soldCards: 0, products: 2 } },
    ]);

    const user = userEvent.setup();
    mountSite();
    await screen.findByText("爱奇艺黄金 VIP 会员");
    await user.click(screen.getAllByRole("button", { name: "立即购买" })[0]!);

    const dialog = await screen.findByRole("dialog", { name: "确认订单" });
    await user.type(within(dialog).getByLabelText(/联系方式/), "13800001111");
    await user.click(within(dialog).getByRole("button", { name: "去支付" }));

    /* 三种都显示出来 —— 「后台开了前台却看不到」才是最难排查的问题 */
    const wechat = await within(dialog).findByRole("button", { name: /微信支付/ });
    const alipay = within(dialog).getByRole("button", { name: /支付宝/ });
    const test = within(dialog).getByRole("button", { name: /测试支付/ });

    /* 没配好的那个：显示但点不了，并标出来 */
    expect(wechat).toBeDisabled();
    expect(within(wechat).getByText("暂不可用")).toBeInTheDocument();

    /* 配好的两个可以正常选 */
    expect(alipay).toBeEnabled();
    expect(test).toBeEnabled();

    /* 默认不该停在不可用的那个上 —— 默认选第一个可用的（支付宝） */
    expect(alipay).toHaveClass("is-active");
    expect(wechat).not.toHaveClass("is-active");
  });

  it("联系方式为空时不能进入支付步骤", async () => {
    mock = installFetchMock([
      { match: "/api/public/bootstrap", data: demoBootstrap },
      { match: "/api/public/stats", data: { totalOrders: 0, shippedOrders: 0, soldCards: 0, products: 2 } },
    ]);

    const user = userEvent.setup();
    mountSite();
    await screen.findByText("爱奇艺黄金 VIP 会员");
    await user.click(screen.getAllByRole("button", { name: "立即购买" })[0]!);

    const dialog = await screen.findByRole("dialog", { name: "确认订单" });
    /* 什么都不填直接点 */
    await user.click(within(dialog).getByRole("button", { name: "去支付" }));

    /* 必须停在原地并给出提示，而且不该发出下单请求 */
    expect(within(dialog).getByText(/请填写联系方式/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "去支付" })).toBeInTheDocument();
    expect(mock.calls.some((c) => c.url === "/api/public/orders")).toBe(false);
  });

  it("下单失败时给出后端返回的错误提示", async () => {
    mock = installFetchMock([
      { match: "/api/public/bootstrap", data: demoBootstrap },
      { match: "/api/public/stats", data: { totalOrders: 0, shippedOrders: 0, soldCards: 0, products: 2 } },
      {
        match: "/api/public/orders",
        method: "POST",
        fail: { status: 409, code: "CONFLICT", message: "库存不足，请减少数量或稍后再试" },
      },
    ]);

    const user = userEvent.setup();
    mountSite();
    await screen.findByText("爱奇艺黄金 VIP 会员");

    await user.click(screen.getAllByRole("button", { name: "立即购买" })[0]!);
    await user.type(await screen.findByLabelText(/联系方式/), "13800001111");
    await user.click(await screen.findByRole("button", { name: "去支付" }));
    await user.click(await screen.findByRole("button", { name: /确认支付/ }));

    expect(await screen.findByText("库存不足，请减少数量或稍后再试")).toBeInTheDocument();
  });
});

describe("首页区块与页脚", () => {
  let mock: MockResult | null = null;

  beforeEach(() => {
    window.history.pushState({}, "", "/");
    mock?.restore();
    mock = null;
  });

  function mountWith(overrides: Partial<typeof demoBootstrap> = {}) {
    mock = installFetchMock([
      { match: "/api/public/bootstrap", data: { ...demoBootstrap, ...overrides } },
      { match: "/api/public/stats", data: { totalOrders: 0, shippedOrders: 0, soldCards: 0, products: 2 } },
    ]);
    render(<SiteApp />);
  }

  it("「为什么选择简卡铺」与「常见问题」的内容是可见的", async () => {
    mountWith();
    await screen.findByText("爱奇艺黄金 VIP 会员");

    /* 这两块曾经因为没被 IntersectionObserver 覆盖而停在 opacity:0，
       整段文字在页面上完全看不见。断言它们拿到了 is-in 才算是真的显示出来。 */
    const feature = screen.getByText("真正的自动发货").closest(".reveal");
    expect(feature).not.toBeNull();
    expect(feature).toHaveClass("is-in");

    const faqTitle = screen.getByRole("button", { name: /付款后多久发货/ });
    expect(faqTitle).toBeInTheDocument();
  });

  it("常见问题可以点击展开与收起", async () => {
    mountWith();
    await screen.findByText("爱奇艺黄金 VIP 会员");

    const user = userEvent.setup();
    const first = screen.getByRole("button", { name: /付款后多久发货/ });
    const second = screen.getByRole("button", { name: /卡密弄丢了怎么办/ });

    /* 默认展开第一条 */
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveAttribute("aria-expanded", "false");

    /* 点第二条：它展开，第一条收起 —— 手风琴行为 */
    await user.click(second);
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(first).toHaveAttribute("aria-expanded", "false");

    /* 再点自己：收起 */
    await user.click(second);
    expect(second).toHaveAttribute("aria-expanded", "false");
  });

  it("页脚精简：只保留版权、ICP 与管理后台", async () => {
    mountWith();
    await screen.findByText("爱奇艺黄金 VIP 会员");

    const footer = document.querySelector("footer.footer-slim");
    expect(footer).not.toBeNull();

    /* 保留的部分 */
    expect(screen.getByRole("link", { name: /沪ICP备2026000000号/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "管理后台" })).toBeInTheDocument();

    /* 去掉的部分：品牌简介、分类、帮助中心、联系我们四列 */
    expect(footer!.querySelector(".footer-top")).toBeNull();
    expect(screen.queryByRole("heading", { name: "商品分类" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "帮助中心" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "联系我们" })).not.toBeInTheDocument();
  });

  it("客服配置成完整网址时，悬浮按钮是外链", async () => {
    mountWith({
      settings: {
        ...demoBootstrap.settings,
        site: { ...demoBootstrap.settings.site, serviceUrl: "https://work.weixin.qq.com/kf/abc" },
      },
    });
    await screen.findByText("爱奇艺黄金 VIP 会员");

    const link = screen.getByRole("link", { name: "在线客服" });
    expect(link).toHaveAttribute("href", "https://work.weixin.qq.com/kf/abc");
  });

  it("客服配置成 QQ / 微信号时不当链接，改为弹窗里可复制的账号", async () => {
    mountWith({
      settings: {
        ...demoBootstrap.settings,
        site: { ...demoBootstrap.settings.site, serviceUrl: "kefu_qq_12345" },
      },
    });
    await screen.findByText("爱奇艺黄金 VIP 会员");

    /* 关键：不能渲染成 <a href="kefu_qq_12345">，那会跳到站内 404 */
    expect(screen.queryByRole("link", { name: "在线客服" })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "在线客服" }));

    const dialog = await screen.findByRole("dialog", { name: "联系客服" });
    expect(within(dialog).getByText("kefu_qq_12345")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "复制" })).toBeInTheDocument();
  });

  it("从页脚分类链接进入时自动选中该分类", async () => {
    window.history.pushState({}, "", "/?category=music#catalog");
    mountWith();
    await screen.findByText("爱奇艺黄金 VIP 会员");

    /* music 分类下没有商品，应显示空状态而不是全部商品 */
    await waitFor(() => {
      expect(screen.getByText("没有找到相关商品，换个关键词试试")).toBeInTheDocument();
    });
  });
});

describe("查询订单页", () => {  let mock: MockResult | null = null;

  beforeEach(() => {
    mock?.restore();
    mock = null;
  });

  it("带 ?no= 参数进入时自动查询并展示卡密", async () => {
    window.history.pushState({}, "", `/query?no=${demoPaidOrder.no}`);
    mock = installFetchMock([
      { match: "/api/public/bootstrap", data: demoBootstrap },
      { match: "/api/public/stats", data: { totalOrders: 1, shippedOrders: 1, soldCards: 2, products: 2 } },
      { match: "/api/public/orders/query", data: { total: 1, orders: [demoPaidOrder] } },
    ]);

    mountSite();

    expect(await screen.findByText(`订单号 ${demoPaidOrder.no}`)).toBeInTheDocument();
    expect(screen.getByText("AIQY-8F3K-2M9D-77QX")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "一键复制全部" })).toBeInTheDocument();
  });

  it("查不到订单时展示提示", async () => {
    window.history.pushState({}, "", "/query");
    mock = installFetchMock([
      { match: "/api/public/bootstrap", data: demoBootstrap },
      { match: "/api/public/stats", data: { totalOrders: 0, shippedOrders: 0, soldCards: 0, products: 2 } },
      {
        match: "/api/public/orders/query",
        fail: { status: 404, code: "NOT_FOUND", message: "没有查询到相关订单，请核对订单号" },
      },
    ]);

    const user = userEvent.setup();
    mountSite();

    await screen.findByText("找回你的卡密");
    await user.type(screen.getByLabelText("订单号 / 联系方式"), "JKP00000000000");
    await user.click(screen.getByRole("button", { name: "立即查询" }));

    expect(await screen.findByText("没有查询到相关订单，请核对订单号")).toBeInTheDocument();
  });
});
