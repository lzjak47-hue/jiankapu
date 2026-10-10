/**
 * 简卡铺 · 下单支付弹窗
 * ---------------------------------------------------------------------------
 * 四个步骤：确认订单 → 选择支付 → 扫码支付 → 获取卡密
 *
 * 支付方式由后台配置决定，前台只渲染「既启用又配置完整」的渠道：
 *   · 微信支付 / 支付宝 —— 服务端向网关下单拿到付款码，这里渲染成二维码
 *   · 测试支付        —— 不联外网，点一下「模拟支付成功」即可
 *
 * 联系方式**必填**（它是后台识别客户的依据），但不限制格式。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../shared/api";
import { copyText, countdown, cx, isEmailLike, looksLikePhone, money } from "../../shared/format";
import { Modal, SecretList } from "../../shared/components";
import { useCountdown, useInterval } from "../../shared/hooks";
import { useToast } from "../../shared/ToastProvider";
import { useSite } from "../SiteContext";
import type { PayChannel, Product, PublicOrder } from "../../shared/types";

const STEPS = ["确认订单", "选择支付", "扫码支付", "获取卡密"] as const;
const MAX_QTY = 50;

const CHANNEL_META: Record<PayChannel, { label: string; icon: string; cls: string; hint: string }> = {
  wechat: { label: "微信支付", icon: "💬", cls: "wx", hint: "打开微信扫一扫" },
  alipay: { label: "支付宝", icon: "🅰️", cls: "ali", hint: "打开支付宝扫一扫" },
  test: { label: "测试支付", icon: "🧪", cls: "test", hint: "测试渠道已下线" },
};

interface BuyModalProps {
  product: Product;
  onClose: () => void;
  initialSpec?: string;
  initialQty?: number;
}

function Stepper({ current }: { current: number }) {
  return (
    <div className="stepper">
      {STEPS.map((name, i) => (
        <span key={name} style={{ display: "contents" }}>
          <div className={`s${i < current ? " is-done" : i === current ? " is-on" : ""}`}>
            <span className="n">{i < current ? "✓" : i + 1}</span>
            {name}
          </div>
          {i < STEPS.length - 1 && <span className="line" />}
        </span>
      ))}
    </div>
  );
}

export function BuyModal({ product, onClose, initialSpec, initialQty = 1 }: BuyModalProps) {
  const toast = useToast();
  const { refreshProducts, settings } = useSite();

  /* 后台启用了几种就显示几种 —— 密钥没填全的也显示，只是标成「暂不可用」。
     「开了却看不到」比「看得到但暂时点不了」更让人困惑。 */
  const channels = settings?.payment.channels ?? [];
  const channelReady = settings?.payment.channelReady ?? {};
  const qrExpireMinutes = settings?.payment.qrExpireMinutes ?? 15;

  /** 该渠道现在能不能真的收款 */
  const isReady = (code: PayChannel) => channelReady[code] !== false;

  const [step, setStep] = useState(0);
  /* 默认选中第一个「有货」的规格，避免一进来就停在售罄的规格上 */
  const [spec, setSpec] = useState(() => {
    if (initialSpec) return initialSpec;
    if (product.specs.length === 0) return "";
    return product.specs.find((s) => (product.specStock[s] ?? 0) > 0) ?? product.specs[0] ?? "";
  });
  const [qty, setQty] = useState(Math.min(Math.max(1, initialQty), MAX_QTY));
  const [contact, setContact] = useState("");
  /* 默认选第一个可用的渠道，别一上来就停在「暂不可用」的那个上 */
  const [channel, setChannel] = useState<PayChannel>(
    () => channels.find((c) => channelReady[c] !== false) ?? channels[0] ?? "wechat"
  );
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [secrets, setSecrets] = useState<string[]>([]);
  const [contactError, setContactError] = useState("");

  const orderRef = useRef<PublicOrder | null>(null);
  orderRef.current = order;

  const total = product.price * qty;
  const meta = CHANNEL_META[channel];

  /* 库存按规格算：所选规格剩多少，就最多能买多少 */
  const hasSpecs = product.specs.length > 0;
  const specAvailable = hasSpecs ? (product.specStock[spec] ?? 0) : product.stock;
  const maxQty = Math.max(1, Math.min(MAX_QTY, specAvailable));

  /**
   * 联系方式填什么都行，但填手机号/邮箱的话发货后会把卡密发过去。
   * 这里实时告诉用户会发生什么，省得他以为「填错格式就不能买」。
   */
  const contactNotice = (() => {
    const value = contact.trim();
    if (!value) return "必填。手机号 / 邮箱 / 微信号都可以，发货后会自动通知。";
    if (looksLikePhone(value)) return "识别为手机号，发货后会把卡密发短信到这个号码。";
    if (isEmailLike(value)) return "识别为邮箱，发货后会把卡密发邮件到这个地址。";
    return "内容不限格式，可以直接下单；发货后不会自动通知，请记好订单号。";
  })();

  /* 关单提醒（倒计时归零） */
  const remain = useCountdown(step === 2 && order ? order.remainSeconds : 0, () => {
    if (step === 2) {
      toast.warn("支付超时，订单已关闭");
      onClose();
    }
  });

  /* 支付阶段轮询订单状态 */
  const pollOrder = useCallback(async () => {
    const current = orderRef.current;
    if (!current || busy) return;
    try {
      const fresh = await api.public.getOrder(current.no);
      if (fresh.status === "已发货") {
        setOrder(fresh);
        setSecrets(fresh.secrets);
        setStep(3);
        void refreshProducts();
      } else if (fresh.status === "已关闭") {
        toast.warn("订单已关闭，卡密已退回库存");
        onClose();
      }
    } catch {
      /* 轮询失败不打扰用户，下一轮再试 */
    }
  }, [busy, onClose, refreshProducts, toast]);

  useInterval(pollOrder, step === 2 ? 3000 : null);

  useEffect(() => {
    return () => {
      /* 组件卸载时无需额外处理：服务端会在超时后自动关单释放卡密 */
    };
  }, []);

  /** 校验联系方式：必填，但不限格式 */
  function validateContact(): boolean {
    if (!contact.trim()) {
      setContactError("请填写联系方式，用于接收卡密与售后联系");
      return false;
    }
    if (contact.trim().length > 120) {
      setContactError("联系方式不能超过 120 个字符");
      return false;
    }
    setContactError("");
    return true;
  }

  async function createOrder() {
    if (busy) return;
    setBusy(true);
    try {
      const created = await api.public.createOrder({
        productId: product.id,
        spec,
        qty,
        contact: contact.trim(),
        payChannel: channel,
      });
      setOrder(created);
      setStep(2);

      /* 向网关下单失败时也进到了这一步，但页面上会提示原因 */
      if (created.payError) {
        toast.warn("支付渠道暂时不可用，请看页面提示");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "下单失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder() {
    if (!order) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await api.public.cancelOrder(order.no);
      toast.toast("订单已取消，卡密已退回库存", "🚫");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "取消失败");
      setBusy(false);
    }
  }

  /* 服务端下发的是 SVG 字符串，转成 data URL 用 <img> 渲染，
     既避免 innerHTML 注入，也方便浏览器按图片缓存 */
  const qrSrc =
    order?.qrSvg != null && order.qrSvg !== ""
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(order.qrSvg)}`
      : "";

  return (
    <Modal title={STEPS[step] ?? ""} onClose={onClose} width={460}>
      <Stepper current={step} />

      {/* ------------------------------------------------ 第 1 步：确认订单 */}
      {step === 0 && (
        <>
          <div className="summary">
            <div className="summary-row">
              <span className="k">商品</span>
              <span className="v">{product.name}</span>
            </div>

            {hasSpecs && (
              <div className="spec-block" style={{ margin: "14px 0 0" }}>
                <div className="label" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)", marginBottom: 10 }}>
                  选择规格
                </div>
                <div className="spec-list">
                  {product.specs.map((s) => {
                    const left = product.specStock[s] ?? 0;
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={left === 0}
                        className={cx("spec", s === spec && "is-active", left === 0 && "is-empty")}
                        onClick={() => {
                          setSpec(s);
                          setQty((q) => Math.min(q, Math.max(1, Math.min(MAX_QTY, left))));
                        }}
                      >
                        {s}
                        <span className="spec-left">{left === 0 ? "售罄" : `剩 ${left}`}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mt-24">
              <span className="k">购买数量</span>
              <div className="qty">
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))}>
                  −
                </button>
                <input
                  value={qty}
                  inputMode="numeric"
                  aria-label="购买数量"
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setQty(Number.isNaN(n) ? 1 : Math.min(Math.max(1, n), maxQty));
                  }}
                />
                <button type="button" onClick={() => setQty((q) => Math.min(maxQty, q + 1))}>
                  ＋
                </button>
              </div>
            </div>

            {hasSpecs && spec && (
              <div className="desc small dim" style={{ marginTop: 8, textAlign: "right" }}>
                「{spec}」当前可购 {specAvailable} 件
              </div>
            )}

            <div className="field mt-24" style={{ marginBottom: 0 }}>
              <label htmlFor="buy-contact">
                联系方式 <span className="req">*</span>
              </label>
              <input
                id="buy-contact"
                className={cx("input", contactError && "is-error")}
                placeholder="手机号 / 邮箱 / 微信号，随便写"
                value={contact}
                onChange={(e) => {
                  setContact(e.target.value);
                  if (contactError) setContactError("");
                }}
              />
              <div className="hint" style={contactError ? { color: "var(--danger)" } : undefined}>
                {contactError || contactNotice}
              </div>
            </div>

            <div className="summary-row total">
              <span className="k">应付金额</span>
              <span className="v">¥{money(total)}</span>
            </div>
          </div>

          <button
            className="btn btn-primary btn-lg btn-block mt-24"
            disabled={specAvailable <= 0}
            onClick={() => {
              if (specAvailable <= 0) return;
              if (!validateContact()) return;
              setStep(1);
            }}
          >
            {specAvailable <= 0 ? "该规格已售罄" : "去支付"}
          </button>
        </>
      )}

      {/* ------------------------------------------------ 第 2 步：选择支付 */}
      {step === 1 && (
        <>
          <div className="summary">
            <div className="summary-row">
              <span className="k">
                {product.name}
                {spec ? ` · ${spec}` : ""}
              </span>
              <span className="v">×{qty}</span>
            </div>
            <div className="summary-row">
              <span className="k">联系方式</span>
              <span className="v" style={{ wordBreak: "break-all" }}>
                {contact}
              </span>
            </div>
            <div className="summary-row total">
              <span className="k">应付金额</span>
              <span className="v">¥{money(total)}</span>
            </div>
          </div>

          <div className="spec-block mt-24">
            <div className="label" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)", marginBottom: 10 }}>
              选择支付方式
            </div>

            {channels.length === 0 ? (
              <div className="notice">
                <span>⚠️</span>
                <span>站点还没有配置任何支付方式，请联系客服。</span>
              </div>
            ) : (
              <div className="pay-methods">
                {channels.map((code) => {
                  const m = CHANNEL_META[code];
                  const ready = isReady(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      className={cx(
                        "pay-method",
                        code === channel && ready && "is-active",
                        !ready && "is-off"
                      )}
                      disabled={!ready}
                      title={ready ? undefined : "该支付方式正在维护中，请选择其它方式"}
                      onClick={() => setChannel(code)}
                    >
                      <span className={cx("ico", m.cls)}>{m.icon}</span>
                      {m.label}
                      {!ready && <span className="pay-off-tag">暂不可用</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {meta && isReady(channel) && (
              <div className="desc" style={{ marginTop: 8 }}>{meta.hint}</div>
            )}
            {meta && !isReady(channel) && (
              <div className="notice mt-12">
                <span>⚠️</span>
                <span>{meta.label}暂时不可用，请选择其它支付方式。</span>
              </div>
            )}
          </div>

          <button
            className="btn btn-primary btn-lg btn-block mt-24"
            disabled={busy || channels.length === 0 || !isReady(channel)}
            onClick={() => void createOrder()}
          >
            {busy ? "正在创建订单…" : `确认支付 ¥${money(total)}`}
          </button>
          <button className="btn btn-ghost btn-block mt-12" disabled={busy} onClick={() => setStep(0)}>
            返回修改
          </button>
        </>
      )}

      {/* ------------------------------------------------ 第 3 步：支付 */}
      {step === 2 && order && (
        <>
          {/* 网关下单失败：给出原因并让用户重试 */}
          {order.payError ? (
            <>
              <div className="notice" style={{ marginBottom: 16 }}>
                <span>⚠️</span>
                <span>
                  支付渠道暂时不可用：{order.payError}
                  <br />
                  订单已创建（订单号 {order.no}），但暂时拿不到付款码。
                  请稍后重试，或取消订单后换个支付方式。
                </span>
              </div>
              <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => void createOrder()}>
                {busy ? "重试中…" : "重新获取付款码"}
              </button>
              <button className="btn btn-ghost btn-block mt-12" disabled={busy} onClick={cancelOrder}>
                取消订单
              </button>
            </>
          ) : (
            /* 真实渠道：展示付款码 */
            <>
              <div className="qr-box">
                <div className="qr-frame">
                  {qrSrc ? (
                    <img src={qrSrc} alt="支付二维码" />
                  ) : (
                    <div className="skeleton" style={{ width: "100%", height: "100%" }} />
                  )}
                </div>
                <p className="qr-note">
                  {meta?.hint ?? "请扫码支付"}，金额 <strong>¥{money(order.amount)}</strong>
                </p>
                <p className="small dim mt-8">
                  剩余支付时间 <span className="countdown num">{countdown(remain)}</span>
                </p>
              </div>

              <div className="summary mt-16">
                <div className="summary-row">
                  <span className="k">订单号</span>
                  <span className="v mono">{order.no}</span>
                </div>
                <div className="summary-row">
                  <span className="k">支付方式</span>
                  <span className="v">{order.payMethod}</span>
                </div>
                <div className="summary-row total">
                  <span className="k">应付金额</span>
                  <span className="v">¥{money(order.amount)}</span>
                </div>
              </div>

              <button className="btn btn-primary btn-lg btn-block mt-24" disabled={busy} onClick={() => void pollOrder()}>
                我已完成支付
              </button>
              <button className="btn btn-ghost btn-block mt-12" disabled={busy} onClick={cancelOrder}>
                取消订单
              </button>

              <div className="notice mt-16">
                <span>💡</span>
                <span>
                  付款后页面会自动刷新，无需手动操作；最长等待 {qrExpireMinutes} 分钟。
                  若长时间未到账，可凭订单号到「查询订单」页查看。
                </span>
              </div>
            </>
          )}
        </>
      )}

      {/* ------------------------------------------------ 第 4 步：卡密 */}
      {step === 3 && (
        <>
          <div className="success-box">
            <div className="success-ico">✓</div>
            <h3 className="h3">支付成功，卡密已发货</h3>
            <p className="small dim mt-8">订单号 {order?.no}</p>
          </div>

          <div className="mt-24">
            <SecretList
              secrets={secrets}
              onCopy={(text) => {
                void copyText(text).then((ok) => {
                  if (ok) toast.success("卡密已复制");
                  else toast.warn("复制失败，请手动选择");
                });
              }}
            />
          </div>

          <button
            className="btn btn-primary btn-lg btn-block mt-24"
            onClick={() => {
              void copyText(secrets.join("\n")).then((ok) => {
                if (ok) toast.success("已复制全部卡密");
                else toast.warn("复制失败，请手动选择");
              });
            }}
          >
            一键复制全部卡密
          </button>
          <a
            className="btn btn-ghost btn-block mt-12"
            href={`/query?no=${encodeURIComponent(order?.no ?? "")}`}
          >
            前往查询订单
          </a>

          <div className="notice mt-16">
            <span>⚠️</span>
            <span>卡密为虚拟商品，请妥善保管，泄露或已激活不支持退换。</span>
          </div>
        </>
      )}
    </Modal>
  );
}

export default BuyModal;
