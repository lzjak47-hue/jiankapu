/**
 * 简卡铺 · 系统设置
 * ---------------------------------------------------------------------------
 * 六个分区：基础 / 交易 / 支付 / 公告 / SEO / 安全
 * 支付的密钥字段永不回传明文，只返回「是否已配置」；提交空值表示不修改。
 */
import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { useAsync } from "../../shared/hooks";
import { Skeleton, Switch } from "../../shared/components";
import { useToast } from "../../shared/ToastProvider";
import { useConfirm } from "../../shared/ConfirmProvider";
import type { AdminSettings, Announcement, ChannelStatus, PayChannel } from "../../shared/types";

type PaneKey = "site" | "trade" | "payment" | "notice" | "notify" | "seo" | "security";

const PANES: Array<{ key: PaneKey; label: string }> = [
  { key: "site", label: "🏠 基础设置" },
  { key: "trade", label: "🛒 交易设置" },
  { key: "payment", label: "💳 支付设置" },
  { key: "notice", label: "📢 公告管理" },
  { key: "notify", label: "🔔 通知设置" },
  { key: "seo", label: "🔍 SEO 设置" },
  { key: "security", label: "🔒 安全设置" },
];

/** 文本输入行，减少重复 */
function TextField({
  id,
  label,
  desc,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
}: {
  id: string;
  label: string;
  desc?: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {desc && <div className="desc">{desc}</div>}
    </div>
  );
}

function SwitchRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="switch-row">
      <div className="txt">
        <div className="t1">{title}</div>
        <div className="t2">{desc}</div>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

/** 支付渠道的就绪状态徽章 —— 直接回答「我启用了，为什么前台没有」 */
function ChannelBadge({ status }: { status?: ChannelStatus }) {
  if (!status) return null;

  if (!status.enabled) return <span className="tag tag-muted">未启用</span>;
  if (status.ready) return <span className="tag tag-success">✓ 可正常收款</span>;
  return <span className="tag tag-accent">⚠ 暂不可用</span>;
}

/** 渠道缺少配置时的说明条 */
function ChannelMissingHint({ status, label }: { status?: ChannelStatus; label: string }) {
  if (!status || !status.enabled || status.ready) return null;

  return (
    <div className="notice mt-12" style={{ background: "var(--accent-weak)", borderColor: "#ffd9cb" }}>
      <span>⚠️</span>
      <span>
        <strong>
          {label}已启用，但还缺少配置：{status.missing.join("、")}
        </strong>
        <br />
        填完之前它会在前台显示、但标成「暂不可用」—— 买家看得到却点不了。
      </span>
    </div>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const confirm = useConfirm();

  const { data, loading, error, reload } = useAsync((signal) => api.admin.settings(signal), []);
  const [form, setForm] = useState<AdminSettings | null>(null);
  const [pane, setPane] = useState<PaneKey>("site");
  const [saving, setSaving] = useState(false);
  const [testTarget, setTestTarget] = useState("");
  const [testing, setTesting] = useState<"email" | "sms" | null>(null);

  useEffect(() => {
    if (data) setForm(structuredClone(data));
  }, [data]);

  if (loading || (!form && !error)) {
    return <Skeleton height={520} />;
  }
  if (error || !form) {
    return (
      <div className="block">
        <div className="block-body">
          <p className="muted">{error ?? "设置加载失败"}</p>
          <button className="btn btn-primary mt-16" onClick={reload}>
            重新加载
          </button>
        </div>
      </div>
    );
  }

  const patchSite = (key: keyof AdminSettings["site"], value: string) =>
    setForm((f) => (f ? { ...f, site: { ...f.site, [key]: value } } : f));

  const patchTrade = <K extends keyof AdminSettings["trade"]>(
    key: K,
    value: AdminSettings["trade"][K]
  ) => setForm((f) => (f ? { ...f, trade: { ...f.trade, [key]: value } } : f));

  const patchPayment = <K extends keyof AdminSettings["payment"]>(
    key: K,
    value: AdminSettings["payment"][K]
  ) => setForm((f) => (f ? { ...f, payment: { ...f.payment, [key]: value } } : f));

  const patchSeo = (key: keyof AdminSettings["seo"], value: string) =>
    setForm((f) => (f ? { ...f, seo: { ...f.seo, [key]: value } } : f));

  const patchSecurity = <K extends keyof AdminSettings["security"]>(
    key: K,
    value: AdminSettings["security"][K]
  ) => setForm((f) => (f ? { ...f, security: { ...f.security, [key]: value } } : f));

  const setAnnouncements = (next: Announcement[]) =>
    setForm((f) => (f ? { ...f, announcements: next } : f));

  const patchNotify = <K extends keyof AdminSettings["notify"]>(
    key: K,
    value: AdminSettings["notify"][K]
  ) => setForm((f) => (f ? { ...f, notify: { ...f.notify, [key]: value } } : f));

  /**
   * 发送测试通知。
   * 这里让后端的错误原样冒出来 —— 「连不上 SMTP」「网关返回余额不足」
   * 这类信息才是排查配置问题时真正有用的部分。
   */
  async function runTest(channel: "email" | "sms") {
    const target = testTarget.trim();
    if (!target) {
      toast.warn(channel === "email" ? "请先填写接收测试的邮箱" : "请先填写接收测试的手机号");
      return;
    }
    setTesting(channel);
    try {
      await api.admin.testNotify({ channel, target });
      toast.success(channel === "email" ? "测试邮件已发出，请查收" : "测试短信已提交，请查收");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发送失败");
    } finally {
      setTesting(null);
    }
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      await api.admin.saveSettings({
        site: form.site,
        trade: form.trade,
        payment: form.payment,
        seo: form.seo,
        security: form.security,
        notify: form.notify,
        announcements: form.announcements.map((a) => ({ text: a.text, status: a.status ? 1 : 0 })),
      });
      toast.success("设置已保存并立即生效");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    const ok = await confirm({
      title: "放弃修改",
      message: "将把当前页面的改动还原为服务器上已保存的值，确定继续吗？",
      okText: "放弃修改",
    });
    if (!ok) return;
    setForm(structuredClone(data!));
    toast.toast("已还原为服务器上的设置", "↩️");
  }

  return (
    <>
      <div className="settings-layout">
        <nav className="settings-nav">
          {PANES.map((p) => (
            <button
              key={p.key}
              className={p.key === pane ? "is-active" : undefined}
              onClick={() => setPane(p.key)}
            >
              {p.label}
            </button>
          ))}
        </nav>

        <div>
          {/* ===== 基础设置 ===== */}
          {pane === "site" && (
            <section className="block">
              <div className="block-head">
                <div>
                  <h3>基础设置</h3>
                  <div className="sub">站点名称、Logo 与联系方式</div>
                </div>
              </div>
              <div className="block-body">
                <div className="form-grid">
                  <TextField
                    id="s-name"
                    label="站点名称"
                    value={form.site.name}
                    onChange={(v) => patchSite("name", v)}
                  />
                  <TextField
                    id="s-subtitle"
                    label="站点副标题"
                    value={form.site.subtitle}
                    onChange={(v) => patchSite("subtitle", v)}
                  />
                  <TextField
                    id="s-logo"
                    label="Logo 字符"
                    value={form.site.logoMark}
                    onChange={(v) => patchSite("logoMark", v)}
                    desc="显示在左上角方块里的单个汉字或字母。"
                  />
                  <TextField
                    id="s-icp"
                    label="ICP 备案号"
                    value={form.site.icp}
                    onChange={(v) => patchSite("icp", v)}
                    placeholder="沪ICP备2026000000号"
                  />
                  <TextField
                    id="s-service-url"
                    label="客服链接"
                    value={form.site.serviceUrl}
                    onChange={(v) => patchSite("serviceUrl", v)}
                    placeholder="https:// 或 微信 / QQ 号"
                    desc="前台右下角悬浮客服按钮会跳转到此地址。"
                  />
                  <TextField
                    id="s-service-time"
                    label="客服在线时间"
                    value={form.site.serviceTime}
                    onChange={(v) => patchSite("serviceTime", v)}
                    placeholder="9:00 - 24:00"
                  />
                  <TextField
                    id="s-email"
                    label="客服邮箱"
                    type="email"
                    value={form.site.email}
                    onChange={(v) => patchSite("email", v)}
                  />
                  <TextField
                    id="s-footer"
                    label="页脚声明"
                    value={form.site.footerText}
                    onChange={(v) => patchSite("footerText", v)}
                  />
                </div>
              </div>
            </section>
          )}

          {/* ===== 交易设置 ===== */}
          {pane === "trade" && (
            <section className="block">
              <div className="block-head">
                <h3>交易设置</h3>
              </div>
              <div className="block-body">
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="s-currency">结算货币</label>
                    <select
                      id="s-currency"
                      className="select"
                      value={form.trade.currency}
                      onChange={(e) => patchTrade("currency", e.target.value)}
                    >
                      <option value="CNY">人民币 CNY ¥</option>
                      <option value="USD">美元 USD $</option>
                    </select>
                  </div>
                  <TextField
                    id="s-prefix"
                    label="订单号前缀"
                    value={form.trade.orderPrefix}
                    onChange={(v) => patchTrade("orderPrefix", v)}
                    desc="例如 JKP，生成的订单号形如 JKP20260105018。"
                  />
                  <TextField
                    id="s-min-order"
                    label="最低下单金额（元）"
                    type="number"
                    value={form.trade.minOrder}
                    onChange={(v) => patchTrade("minOrder", Number(v))}
                  />
                  <TextField
                    id="s-autoclose"
                    label="未支付自动关单（分钟）"
                    type="number"
                    value={form.trade.autoCloseMinutes}
                    onChange={(v) => patchTrade("autoCloseMinutes", Number(v))}
                    desc="超时未支付的订单会自动关闭并释放占用的卡密。"
                  />
                  <TextField
                    id="s-lowstock"
                    label="库存预警阈值"
                    type="number"
                    value={form.trade.lowStockWarn}
                    onChange={(v) => patchTrade("lowStockWarn", Number(v))}
                    desc="商品可用卡密低于该数值时，后台会标红提醒。"
                  />
                  <TextField
                    id="s-refund-window"
                    label="售后受理时限（小时）"
                    type="number"
                    value={form.trade.refundWindowHours}
                    onChange={(v) => patchTrade("refundWindowHours", Number(v))}
                    desc="超过该时限的订单不再受理补发申请。"
                  />
                </div>

                <div className="mt-16">
                  <SwitchRow
                    title="允许游客下单"
                    desc="关闭后用户必须先注册登录才能购买商品。"
                    checked={form.trade.guestOrder === 1}
                    onChange={(next) => patchTrade("guestOrder", next ? 1 : 0)}
                  />
                </div>
              </div>
            </section>
          )}

          {/* ===== 支付设置 ===== */}
          {pane === "payment" && (
            <section className="block">
              <div className="block-head">
                <div>
                  <h3>支付设置</h3>
                  <div className="sub">
                    三个渠道可同时开启。只有「已启用 <strong>且</strong> 密钥填全」的渠道才会出现在前台
                  </div>
                </div>
              </div>
              <div className="block-body">
                {/* 最直观的一句话：前台现在到底会显示哪些支付方式 */}
                {(() => {
                  const shown = form.payment.enabledChannels ?? [];
                  const label = (c: PayChannel) =>
                    ({ wechat: "微信支付", alipay: "支付宝", test: "测试支付" })[c];
                  const broken = shown.filter((c) => form.payment.channelStatus?.[c]?.ready === false);

                  return (
                    <div
                      className="notice"
                      style={
                        shown.length > 0 && broken.length === 0
                          ? { background: "var(--success-weak)", borderColor: "#c7ecd5", color: "#166534" }
                          : undefined
                      }
                    >
                      <span>{shown.length === 0 ? "⚠️" : broken.length > 0 ? "⚠️" : "✅"}</span>
                      <span>
                        前台会显示这些支付方式：
                        <strong>{shown.map(label).join("、") || "（无，买家将无法下单）"}</strong>
                        <br />
                        {broken.length > 0 ? (
                          <span className="small">
                            其中 <strong>{broken.map(label).join("、")}</strong>{" "}
                            还没配置完整，前台会显示但标成「暂不可用」，买家点不了。
                          </span>
                        ) : (
                          <span className="small">全部都已配置完整，买家可以直接付款。</span>
                        )}
                      </span>
                    </div>
                  );
                })()}

                {/* ---------------- 微信支付 ---------------- */}
                <div className="form-section-title" style={{ marginTop: 22 }}>
                  <span className="idx">1</span> 微信支付（APIv3 Native 扫码）
                  <ChannelBadge status={form.payment.channelStatus?.wechat} />
                </div>

                <SwitchRow
                  title="启用微信支付"
                  desc="买家扫码付款，支付成功后由微信回调本站发货。"
                  checked={form.payment.wxEnable === 1}
                  onChange={(next) => patchPayment("wxEnable", next ? 1 : 0)}
                />

                <ChannelMissingHint status={form.payment.channelStatus?.wechat} label="微信支付" />

                <div className="form-grid mt-16">
                  <TextField
                    id="s-wx-appid"
                    label="AppID"
                    value={form.payment.wxAppId}
                    onChange={(v) => patchPayment("wxAppId", v)}
                    placeholder="wx****************"
                    desc="已认证服务号或小程序的 AppID（需与商户号绑定）。"
                  />
                  <TextField
                    id="s-wx-mch"
                    label="商户号 mchid"
                    value={form.payment.wxMchId}
                    onChange={(v) => patchPayment("wxMchId", v)}
                    placeholder="1600000000"
                  />
                  <TextField
                    id="s-wx-serial"
                    label="证书序列号"
                    value={form.payment.wxSerialNo}
                    onChange={(v) => patchPayment("wxSerialNo", v)}
                    placeholder="45F5**********"
                    desc="商户 API 证书的序列号，在商户平台「API 安全」里查看。"
                  />
                  <TextField
                    id="s-wx-apiv3"
                    label="APIv3 密钥"
                    type="password"
                    value={form.payment.wxApiV3Key}
                    onChange={(v) => patchPayment("wxApiV3Key", v)}
                    placeholder="留空表示不修改"
                    desc={`必须正好 32 位。当前状态：${
                      form.payment.wxApiV3KeySet ? "已配置，留空表示不修改" : "尚未配置"
                    }`}
                  />
                  <div className="field col-span-2">
                    <label htmlFor="s-wx-key">商户私钥（apiclient_key.pem）</label>
                    <textarea
                      id="s-wx-key"
                      className="textarea"
                      style={{ minHeight: 96 }}
                      value={form.payment.wxPrivateKey}
                      placeholder="留空表示不修改"
                      onChange={(e) => patchPayment("wxPrivateKey", e.target.value)}
                    />
                    <div className="desc">
                      把 apiclient_key.pem 的<strong>完整内容</strong>（含 BEGIN/END 行）粘贴到这里。
                      仅保存在服务端，永不回传浏览器。当前状态：
                      {form.payment.wxPrivateKeySet ? "已配置，留空表示不修改" : "尚未配置"}
                    </div>
                  </div>
                </div>

                {/* ---------------- 支付宝 ---------------- */}
                <div className="form-section-title" style={{ marginTop: 32 }}>
                  <span className="idx">2</span> 支付宝（当面付）
                  <ChannelBadge status={form.payment.channelStatus?.alipay} />
                </div>

                <SwitchRow
                  title="启用支付宝"
                  desc="买家扫码付款，支付成功后由支付宝回调本站发货。"
                  checked={form.payment.aliEnable === 1}
                  onChange={(next) => patchPayment("aliEnable", next ? 1 : 0)}
                />

                <ChannelMissingHint status={form.payment.channelStatus?.alipay} label="支付宝" />

                <div className="form-grid mt-16">
                  <TextField
                    id="s-ali-app"
                    label="AppID"
                    value={form.payment.aliAppId}
                    onChange={(v) => patchPayment("aliAppId", v)}
                    placeholder="2021**********"
                    desc="开放平台应用的 AppID，需已签约「当面付」。"
                  />
                  <TextField
                    id="s-ali-gateway"
                    label="网关地址"
                    value={form.payment.aliGateway}
                    onChange={(v) => patchPayment("aliGateway", v)}
                    placeholder="https://openapi.alipay.com/gateway.do"
                    desc="一般不用改；沙箱环境填沙箱网关。"
                  />
                  <div className="field col-span-2">
                    <label htmlFor="s-ali-private">应用私钥</label>
                    <textarea
                      id="s-ali-private"
                      className="textarea"
                      style={{ minHeight: 96 }}
                      value={form.payment.aliPrivateKey}
                      placeholder="留空表示不修改"
                      onChange={(e) => patchPayment("aliPrivateKey", e.target.value)}
                    />
                    <div className="desc">
                      用支付宝密钥工具生成的<strong>应用私钥</strong>（RSA2）。
                      只保存在服务端。当前状态：
                      {form.payment.aliPrivateKeySet ? "已配置，留空表示不修改" : "尚未配置"}
                    </div>
                  </div>
                  <div className="field col-span-2">
                    <label htmlFor="s-ali-public">支付宝公钥</label>
                    <textarea
                      id="s-ali-public"
                      className="textarea"
                      style={{ minHeight: 96 }}
                      value={form.payment.aliPublicKey}
                      placeholder="用于校验支付宝回调的签名"
                      onChange={(e) => patchPayment("aliPublicKey", e.target.value)}
                    />
                    <div className="desc">
                      注意是<strong>支付宝公钥</strong>而不是应用公钥 —— 回调验签用它，
                      填错了会导致付款成功却不发货。
                    </div>
                  </div>
                </div>

                {/* ---------------- 测试支付 ---------------- */}
                <div className="form-section-title" style={{ marginTop: 32 }}>
                  <span className="idx">3</span> 本地测试支付
                  <ChannelBadge status={form.payment.channelStatus?.test} />
                </div>

                <SwitchRow
                  title="启用测试支付"
                  desc="不联外网、不产生真实交易，点一下即视为支付成功。适合本地跑通全流程。"
                  checked={form.payment.testEnable === 1}
                  onChange={(next) => patchPayment("testEnable", next ? 1 : 0)}
                />

                <div className="notice mt-16" style={{ background: "var(--warning-weak)" }}>
                  <span>⚠️</span>
                  <span>
                    <strong>正式上线前请关闭测试支付</strong>，否则任何人都能免费领卡。
                    三个渠道全部关闭时设置无法保存。
                  </span>
                </div>

                {/* ---------------- 通用 ---------------- */}
                <div className="form-section-title" style={{ marginTop: 32 }}>
                  <span className="idx">4</span> 通用
                </div>

                <div className="form-grid">
                  <TextField
                    id="s-qr-expire"
                    label="二维码有效期（分钟）"
                    type="number"
                    value={form.payment.qrExpireMinutes}
                    onChange={(v) => patchPayment("qrExpireMinutes", Number(v))}
                    desc="会同时告诉支付网关，避免本地关单后还能付款。"
                  />
                </div>

                <div className="notice mt-16">
                  <span>🔒</span>
                  <span>
                    所有密钥只保存在服务端数据库，接口永不回传明文。
                    回调地址会自动设置为 <code>{"{前台站点}"}/api/public/pay/notify/微信或支付宝</code>，
                    所以<strong>前台必须能从公网访问</strong>，否则收不到回调
                    （本地开发可用内网穿透，或依赖页面轮询时的主动查单）。
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* ===== 公告管理 ===== */}
          {pane === "notice" && (
            <section className="block">
              <div className="block-head">
                <div>
                  <h3>公告管理</h3>
                  <div className="sub">前台顶部公告条会轮播已启用的公告</div>
                </div>
                <div className="right">
                  <button
                    className="btn btn-soft btn-sm"
                    onClick={() =>
                      setAnnouncements([
                        ...form.announcements,
                        { id: Date.now(), text: "请输入新的公告内容", status: 1 },
                      ])
                    }
                  >
                    ＋ 新增公告
                  </button>
                </div>
              </div>
              <div className="block-body">
                {form.announcements.length === 0 ? (
                  <p className="muted">还没有公告，点右上角「＋ 新增公告」添加一条。</p>
                ) : (
                  form.announcements.map((a, index) => (
                    <div className="switch-row" key={a.id ?? index}>
                      <span className="ico" style={{ fontSize: 18 }}>
                        📢
                      </span>
                      <div className="txt">
                        <input
                          className="input input-sm"
                          value={a.text}
                          onChange={(e) => {
                            const next = [...form.announcements];
                            next[index] = { ...a, text: e.target.value };
                            setAnnouncements(next);
                          }}
                        />
                      </div>
                      <Switch
                        checked={a.status === 1}
                        onChange={(checked) => {
                          const next = [...form.announcements];
                          next[index] = { ...a, status: checked ? 1 : 0 };
                          setAnnouncements(next);
                        }}
                        label="启用该公告"
                      />
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setAnnouncements(form.announcements.filter((_, i) => i !== index));
                          toast.toast("已删除公告，记得保存", "🗑️");
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {/* ===== 通知设置 ===== */}
          {pane === "notify" && (
            <section className="block">
              <div className="block-head">
                <div>
                  <h3>发货通知</h3>
                  <div className="sub">
                    买家留手机号就发短信、留邮箱就发邮件；留的是其它内容则不发送，但**不影响下单**
                  </div>
                </div>
              </div>
              <div className="block-body">
                <SwitchRow
                  title="开启发货通知"
                  desc="总开关。关闭后即使配好了邮件和短信也不会发送。"
                  checked={form.notify.enable === 1}
                  onChange={(next) => patchNotify("enable", next ? 1 : 0)}
                />

                {/* ---------------- 邮件 ---------------- */}
                <div className="form-section-title" style={{ marginTop: 24 }}>
                  <span className="idx">1</span> 邮箱通知（SMTP）
                </div>

                <SwitchRow
                  title="启用邮件通知"
                  desc="买家联系方式识别为邮箱时，自动把卡密发到这个邮箱。"
                  checked={form.notify.mailEnable === 1}
                  onChange={(next) => patchNotify("mailEnable", next ? 1 : 0)}
                />

                <div className="form-grid mt-16">
                  <TextField
                    id="n-smtp-host"
                    label="SMTP 服务器"
                    value={form.notify.smtpHost}
                    onChange={(v) => patchNotify("smtpHost", v)}
                    placeholder="smtp.qq.com"
                  />
                  <TextField
                    id="n-smtp-port"
                    label="端口"
                    type="number"
                    value={form.notify.smtpPort}
                    onChange={(v) => patchNotify("smtpPort", Number(v))}
                    desc="465 = SSL；587 = STARTTLS；25 = 明文"
                  />
                  <TextField
                    id="n-smtp-user"
                    label="邮箱账号"
                    value={form.notify.smtpUser}
                    onChange={(v) => patchNotify("smtpUser", v)}
                    placeholder="noreply@example.com"
                  />
                  <TextField
                    id="n-smtp-pass"
                    label="密码 / 授权码"
                    type="password"
                    value={form.notify.smtpPass}
                    onChange={(v) => patchNotify("smtpPass", v)}
                    placeholder="留空表示不修改"
                    desc={`当前状态：${form.notify.smtpPassSet ? "已配置，留空表示不修改" : "尚未配置"}`}
                  />
                  <TextField
                    id="n-smtp-from"
                    label="发件地址"
                    value={form.notify.smtpFrom}
                    onChange={(v) => patchNotify("smtpFrom", v)}
                    placeholder="留空则使用上面的邮箱账号"
                  />
                  <TextField
                    id="n-smtp-name"
                    label="发件人显示名"
                    value={form.notify.smtpFromName}
                    onChange={(v) => patchNotify("smtpFromName", v)}
                    placeholder="简卡铺"
                  />
                </div>

                <SwitchRow
                  title="使用 SSL 直连"
                  desc="465 端口请开启；587 / 25 端口请关闭（会自动尝试 STARTTLS）。"
                  checked={form.notify.smtpSecure === 1}
                  onChange={(next) => patchNotify("smtpSecure", next ? 1 : 0)}
                />

                {/* ---------------- 短信 ---------------- */}
                <div className="form-section-title" style={{ marginTop: 32 }}>
                  <span className="idx">2</span> 短信通知
                </div>

                <SwitchRow
                  title="启用短信通知"
                  desc="买家联系方式识别为手机号时，自动把卡密发到这个号码。"
                  checked={form.notify.smsEnable === 1}
                  onChange={(next) => patchNotify("smsEnable", next ? 1 : 0)}
                />

                <div className="form-grid mt-16">
                  <TextField
                    id="n-sms-url"
                    label="短信网关地址"
                    value={form.notify.smsUrl}
                    onChange={(v) => patchNotify("smsUrl", v)}
                    placeholder="https://网关域名/send"
                  />
                  <div className="field">
                    <label htmlFor="n-sms-method">请求方式</label>
                    <select
                      id="n-sms-method"
                      className="select"
                      value={form.notify.smsMethod}
                      onChange={(e) => patchNotify("smsMethod", e.target.value)}
                    >
                      <option value="POST">POST</option>
                      <option value="GET">GET</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="n-sms-body">POST 编码方式</label>
                    <select
                      id="n-sms-body"
                      className="select"
                      value={form.notify.smsBodyType}
                      onChange={(e) => patchNotify("smsBodyType", e.target.value)}
                    >
                      <option value="form">表单 form-urlencoded</option>
                      <option value="json">JSON</option>
                    </select>
                    <div className="desc">GET 方式下此项无效。</div>
                  </div>
                  <TextField
                    id="n-sms-key"
                    label="接口密钥"
                    type="password"
                    value={form.notify.smsKey}
                    onChange={(v) => patchNotify("smsKey", v)}
                    placeholder="留空表示不修改"
                    desc={`当前状态：${form.notify.smsKeySet ? "已配置，留空表示不修改" : "尚未配置"}`}
                  />
                  <div className="field col-span-2">
                    <label htmlFor="n-sms-params">参数模板</label>
                    <textarea
                      id="n-sms-params"
                      className="textarea"
                      style={{ minHeight: 84 }}
                      value={form.notify.smsParams}
                      onChange={(e) => patchNotify("smsParams", e.target.value)}
                    />
                    <div className="desc">
                      必须是 JSON 对象（也兼容 <code>a=1&amp;b=2</code> 写法）。三个占位符会被替换：
                      <code>{"{phone}"}</code> 手机号、<code>{"{content}"}</code> 短信内容、
                      <code>{"{key}"}</code> 接口密钥。
                      国内多数网关（账号 + 密码 + 手机号 + 内容）都能直接套用。
                    </div>
                  </div>
                  <TextField
                    id="n-sms-success"
                    label="成功标记（选填）"
                    value={form.notify.smsSuccessText}
                    onChange={(v) => patchNotify("smsSuccessText", v)}
                    placeholder="例如 success"
                    desc="响应体中包含这段文字才算发送成功；留空则只看 HTTP 状态码。"
                  />
                </div>

                {/* ---------------- 内容模板 ---------------- */}
                <div className="form-section-title" style={{ marginTop: 32 }}>
                  <span className="idx">3</span> 通知内容模板
                </div>

                <div className="notice" style={{ marginBottom: 16 }}>
                  <span>✏️</span>
                  <span>
                    可用变量：<code>{"{site}"}</code> <code>{"{orderNo}"}</code> <code>{"{product}"}</code>{" "}
                    <code>{"{spec}"}</code> <code>{"{qty}"}</code> <code>{"{amount}"}</code>{" "}
                    <code>{"{secrets}"}</code> <code>{"{contact}"}</code>
                  </span>
                </div>

                <TextField
                  id="n-mail-subject"
                  label="邮件主题"
                  value={form.notify.mailSubject}
                  onChange={(v) => patchNotify("mailSubject", v)}
                />
                <div className="field">
                  <label htmlFor="n-mail-body">邮件正文</label>
                  <textarea
                    id="n-mail-body"
                    className="textarea"
                    rows={8}
                    value={form.notify.mailBody}
                    onChange={(e) => patchNotify("mailBody", e.target.value)}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="n-sms-body">短信内容</label>
                  <textarea
                    id="n-sms-body"
                    className="textarea"
                    rows={3}
                    value={form.notify.smsBody}
                    onChange={(e) => patchNotify("smsBody", e.target.value)}
                  />
                  <div className="desc">
                    短信按条计费，建议控制在 70 字以内；多条卡密会被「、」连接，注意可能超出单条长度。
                  </div>
                </div>

                {/* ---------------- 测试 ---------------- */}
                <div className="form-section-title" style={{ marginTop: 32 }}>
                  <span className="idx">4</span> 发送测试
                </div>

                <p className="muted" style={{ marginBottom: 14 }}>
                  先保存设置，再点下面的按钮真实发一条，确认配置可用。
                </p>

                <div className="input-group" style={{ maxWidth: 520 }}>
                  <input
                    className="input"
                    placeholder="填一个邮箱或手机号"
                    aria-label="测试接收地址"
                    value={testTarget}
                    onChange={(e) => setTestTarget(e.target.value)}
                  />
                  <button
                    className="btn btn-ghost"
                    disabled={testing !== null}
                    onClick={() => void runTest("email")}
                  >
                    {testing === "email" ? "发送中…" : "测试邮件"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={testing !== null}
                    onClick={() => void runTest("sms")}
                  >
                    {testing === "sms" ? "发送中…" : "测试短信"}
                  </button>
                </div>

                <div className="notice mt-16">
                  <span>ℹ️</span>
                  <span>
                    通知是「尽力而为」的：发送失败只记日志，不会影响用户下单与发货。
                    买家联系方式识别不出手机号或邮箱时自动跳过，不报错。
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* ===== SEO ===== */}
          {pane === "seo" && (
            <section className="block">
              <div className="block-head">
                <h3>SEO 设置</h3>
              </div>
              <div className="block-body">
                <TextField
                  id="s-seo-title"
                  label="网站标题"
                  value={form.seo.title}
                  onChange={(v) => patchSeo("title", v)}
                  desc="显示在浏览器标签页，也是搜索引擎结果的主标题。"
                />
                <TextField
                  id="s-seo-keywords"
                  label="关键词"
                  value={form.seo.keywords}
                  onChange={(v) => patchSeo("keywords", v)}
                  desc="用英文逗号分隔。"
                />
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="s-seo-desc">网站描述</label>
                  <textarea
                    id="s-seo-desc"
                    className="textarea"
                    value={form.seo.description}
                    onChange={(e) => patchSeo("description", e.target.value)}
                  />
                  <div className="desc">建议 80-120 字，会显示在搜索结果摘要中。</div>
                </div>
              </div>
            </section>
          )}

          {/* ===== 安全设置 ===== */}
          {pane === "security" && (
            <section className="block">
              <div className="block-head">
                <div>
                  <h3>安全设置</h3>
                  <div className="sub">后台访问控制与登录保护</div>
                </div>
              </div>
              <div className="block-body">
                <div className="form-grid">
                  <TextField
                    id="s-admin-path"
                    label="后台访问路径"
                    value={form.security.adminPath}
                    onChange={(v) => patchSecurity("adminPath", v)}
                    placeholder="/admin"
                    desc="改成不易猜到的路径可降低被扫描风险。"
                  />
                  <TextField
                    id="s-session"
                    label="登录状态有效期（分钟）"
                    type="number"
                    value={form.security.sessionTimeout}
                    onChange={(v) => patchSecurity("sessionTimeout", Number(v))}
                  />
                  <TextField
                    id="s-lock-threshold"
                    label="登录失败锁定阈值（次）"
                    type="number"
                    value={form.security.lockThreshold}
                    onChange={(v) => patchSecurity("lockThreshold", Number(v))}
                    desc="连续失败达到该次数后临时锁定该 IP。"
                  />
                </div>

                <div className="mt-16">
                  <SwitchRow
                    title="开启登录验证码"
                    desc="强烈建议开启，可有效阻挡暴力破解与自动化脚本。"
                    checked={form.security.captcha === 1}
                    onChange={(next) => patchSecurity("captcha", next ? 1 : 0)}
                  />
                  <SwitchRow
                    title="开启登录失败锁定"
                    desc="达到阈值后锁定来源 IP 一段时间。"
                    checked={form.security.loginFailLock === 1}
                    onChange={(next) => patchSecurity("loginFailLock", next ? 1 : 0)}
                  />
                </div>

                <div className="notice mt-16">
                  <span>🔐</span>
                  <span>首次部署请立即修改默认管理员密码（当前演示账号 admin / 123456）。</span>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      <div className="save-bar">
        <span className="hint">改动会在点击保存后立即生效</span>
        <div className="right">
          <button className="btn btn-ghost" onClick={() => void reset()}>
            放弃修改
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? "保存中…" : "保存设置"}
          </button>
        </div>
      </div>
    </>
  );
}

export default SettingsPage;
