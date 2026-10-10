/**
 * 简卡铺 · 后端接口类型定义
 * ---------------------------------------------------------------------------
 * 与 apps/server 的响应结构一一对应。改后端时先改这里，TypeScript 会指出所有需要同步的地方。
 */

/* ============================================================ 通用壳结构 */

/** 后端统一响应：成功 */
export interface ApiOk<T> {
  ok: true;
  data: T;
}

/** 后端统一响应：失败 */
export interface ApiFail {
  ok: false;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type ApiResponse<T> = ApiOk<T> | ApiFail;

/** 分页结果 */
export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  perPage: number;
}

/* ================================================================ 站点 */

export interface PublicSiteSettings {
  name: string;
  subtitle: string;
  logoMark: string;
  icp: string;
  serviceUrl: string;
  serviceTime: string;
  email: string;
  footerText: string;
}

export interface PublicTradeSettings {
  currency: string;
  minOrder: number;
  guestOrder: number;
  refundWindowHours: number;
  /** 联系方式是否必填（当前固定为必填） */
  contactRequired: number;
}

/** 支付渠道码 */
export type PayChannel = "wechat" | "alipay" | "test";

export interface PublicPaymentSettings {
  wxEnable: number;
  aliEnable: number;
  testEnable: number;
  /** 所有**已启用**的渠道（不看密钥是否填全），前台渲染这些 */
  channels: PayChannel[];
  /** 每个渠道是否已配置完整；false 的前台标成「暂不可用」 */
  channelReady: Partial<Record<PayChannel, boolean>>;
  qrExpireMinutes: number;
}

export interface PublicSeoSettings {
  title: string;
  keywords: string;
  description: string;
}

export interface PublicSettings {
  site: PublicSiteSettings;
  trade: PublicTradeSettings;
  payment: PublicPaymentSettings;
  seo: PublicSeoSettings;
}

export interface Announcement {
  id: number;
  text: string;
  status?: number;
}

export interface ServiceEndpoints {
  site: string;
  admin: string;
}

export interface BootstrapData {
  settings: PublicSettings;
  categories: Category[];
  products: Product[];
  announcements: Announcement[];
  serverTime: string;
  endpoints: ServiceEndpoints;
}

export interface SiteStats {
  totalOrders: number;
  shippedOrders: number;
  soldCards: number;
  products: number;
}

/* ================================================================ 商品 */

export interface Category {
  id: string;
  name: string;
  sort: number;
  status: number;
  remark: string;
  count: number;
}

export type BadgeType = "" | "accent" | "success" | "muted";

export interface Product {
  id: string;
  name: string;
  category: string;
  emoji: string;
  price: number;
  oldPrice: number;
  stock: number;
  /**
   * 各规格的可用库存，例如 { "月卡": 12, "季卡": 0 }。
   * 约定：`specs` 里声明的每个规格在这里都必定有一个数字（没有卡密就是 0）。
   * 商品没有规格时为空对象，库存看 `stock`。
   */
  specStock: Record<string, number>;
  sold: number;
  status: number;
  badge: string;
  badgeType: BadgeType;
  specs: string[];
  unit: string;
  desc: string;
  detail: string;
  notice: string[];
  tutorial: string[];
  delivery: string;
  createdAt: string;
  updatedAt: string;
}

/** 新增 / 编辑商品的提交体 */
export interface ProductInput {
  id?: string;
  name: string;
  category: string;
  emoji: string;
  price: number;
  oldPrice: number;
  badge: string;
  status: number;
  specs: string[];
  desc: string;
  detail: string;
  notice: string[];
  tutorial: string[];
}

/* ================================================================ 订单 */

export type OrderStatus = "待付款" | "已发货" | "处理中" | "已关闭" | "已退款" | "失败";
export type PayMethod = "微信支付" | "支付宝" | "测试支付";

/** 下单时后端返回的支付信息 */
export interface OrderPayment {
  channel: PayChannel;
  label: string;
  /** 付款码内容；测试渠道为空 */
  qrCode: string;
  /** qrcode = 需要扫码；test = 点一下就能过 */
  mode: "qrcode" | "test";
}

/** 前台视角的订单 */
export interface PublicOrder {
  no: string;
  status: OrderStatus;
  productId: string;
  product: string;
  spec: string;
  qty: number;
  unitPrice: number;
  amount: number;
  contact: string;
  payMethod: PayMethod;
  createdAt: string;
  expiresAt: string;
  paidAt: string;
  remainSeconds: number;
  deliverable: boolean;
  secrets: string[];
  /** 支付渠道码 */
  payChannel: PayChannel;
  /** 下单时一并返回的支付信息（仅创建订单与轮询时才有） */
  payment?: OrderPayment | null;
  /** 向支付渠道下单失败的原因；有值时前台要提示用户 */
  payError?: string;
  /** 以下两项由接口补充 */
  payUrl?: string;
  qrPayload?: string;
  qrSvg?: string;
  payWindowSeconds?: number;
}

/** 后台视角的订单 */
export interface AdminOrder {
  id: number;
  no: string;
  productId: string;
  product: string;
  spec: string;
  qty: number;
  unitPrice: number;
  amount: number;
  pay: PayMethod;
  status: OrderStatus;
  contact: string;
  time: string;
  expiresAt: string;
  paidAt: string;
  closedAt: string;
  ip: string;
  secrets: string[];
}

export interface OrderStats {
  total: number;
  shipped: number;
  revenue: number;
  pending: number;
}

export interface CreateOrderInput {
  productId: string;
  spec: string;
  qty: number;
  /** 必填，但不限格式 */
  contact: string;
  payChannel: PayChannel;
}

/** 后台订单视图里的支付渠道（老订单可能为空，用标签兜底） */
export interface AdminOrderPay {
  pay: PayMethod;
  payChannel?: PayChannel;
}

/* ================================================================ 卡密 */

export type CardStatus = "未售" | "已锁定" | "已售";

export interface Card {
  id: number;
  key: string;
  product: string;
  productName: string;
  /** 卡密所属规格；商品没有规格时为空字符串 */
  spec: string;
  status: CardStatus;
  importedAt: string;
  soldAt: string;
  order: string;
}

export interface CardStats {
  total: number;
  available: number;
  sold: number;
  locked: number;
}

export interface ImportCardsResult {
  imported: number;
  duplicated: number;
  /** 实际导入到的规格 */
  spec: string;
  /** 该规格导入后的可用数量 */
  stock: number;
}

/* ================================================================ 客户 */

/**
 * 本站的「客户」= 下单时填的那个联系方式。
 * 没有注册登录，所以**没有封禁功能**——封了也没意义，换个联系方式照样能买。
 */
export interface ShopUser {
  id: string;
  dbId: number;
  name: string;
  contact: string;
  orders: number;
  amount: number;
  /** 最近一次下单的 IP */
  lastIp: string;
  regAt: string;
  lastAt: string;
}

/** 客户详情里的一笔订单（含下单 IP） */
export interface CustomerOrder {
  no: string;
  productId: string;
  product: string;
  spec: string;
  qty: number;
  unitPrice: number;
  amount: number;
  pay: PayMethod;
  status: OrderStatus;
  ip: string;
  time: string;
  paidAt: string;
  closedAt: string;
}

export interface CustomerDetail {
  customer: ShopUser;
  summary: {
    totalOrders: number;
    paidOrders: number;
    totalAmount: number;
    firstOrderAt: string;
    lastOrderAt: string;
    ipCount: number;
  };
  /** 这个联系方式用过的所有 IP，按出现次数排序 */
  ips: Array<{ ip: string; count: number; lastAt: string }>;
  orders: CustomerOrder[];
}

export interface UserStats {
  total: number;
  active: number;
  /** 真正下过单的客户数 */
  converted: number;
  amount: number;
}

/* ============================================================ 后台提醒 */

export interface AlertEvent {
  id: string;
  type: "order" | "stock";
  level: "info" | "warn" | "danger";
  title: string;
  desc: string;
  extra: string;
  ip?: string;
  /** 订单号或商品 ID，点击可跳转 */
  target: string;
  time: string;
}

export interface AlertsFeed {
  serverTime: string;
  /** 当前的低库存预警阈值 */
  threshold: number;
  unseenOrders: number;
  unseenAmount: number;
  pendingOrders: number;
  lowStock: Array<{ id: string; name: string; emoji: string; stock: number; soldOut: boolean }>;
  soldOutCount: number;
  events: AlertEvent[];
}

/* ================================================================= 日志 */

export interface LogEntry {
  id: number;
  time: string;
  actor: string;
  action: string;
  target: string;
  ip: string;
  result: string;
}

/* ============================================================== 概览 */

export interface DashboardStat {
  label: string;
  value: number;
  unit: string;
  delta: string;
  up: boolean;
  icon: string;
  money?: boolean;
}

export interface SeriesPoint {
  date: string;
  orders: number;
  revenue: number;
}

export interface TopProduct {
  id: string;
  name: string;
  emoji: string;
  sold: number;
  revenue: number;
}

export interface RecentOrder {
  no: string;
  product: string;
  productId: string;
  spec: string;
  qty: number;
  amount: number;
  status: OrderStatus;
  contact: string;
  time: string;
}

export interface SystemInfo {
  version: string;
  runtime: string;
  nodeEnv: string;
  database: string;
  totalOrders: number;
  totalCards: number;
  admins: number;
  dbSizeKb: number;
  serverTime: string;
  uptimeSeconds: number;
}

export interface DashboardData {
  stats: DashboardStat[];
  series: SeriesPoint[];
  topProducts: TopProduct[];
  recentOrders: RecentOrder[];
  system: SystemInfo;
  orderStats: OrderStats;
}

/* ============================================================== 后台设置 */

export interface ChannelStatus {
  /** 后台开关是否打开 */
  enabled: boolean;
  /** 密钥是否填全 */
  configured: boolean;
  /** 前台是否能真的用它收款（enabled && configured） */
  ready: boolean;
  /** 还缺哪些配置项（中文名） */
  missing: string[];
}

export interface AdminSettings {
  site: PublicSiteSettings;
  trade: {
    currency: string;
    minOrder: number;
    autoCloseMinutes: number;
    lowStockWarn: number;
    guestOrder: number;
    orderPrefix: string;
    refundWindowHours: number;
  };
  payment: {
    // 微信支付（APIv3 Native 扫码）
    wxEnable: number;
    wxAppId: string;
    wxMchId: string;
    wxSerialNo: string;
    wxPrivateKey: string;
    wxPrivateKeySet: boolean;
    wxApiV3Key: string;
    wxApiV3KeySet: boolean;

    // 支付宝当面付
    aliEnable: number;
    aliAppId: string;
    aliPrivateKey: string;
    aliPrivateKeySet: boolean;
    aliPublicKey: string;
    aliPublicKeySet: boolean;
    aliGateway: string;

    // 本地测试支付
    testEnable: number;
    testAutoPay: number;

    qrExpireMinutes: number;

    /** 由后端计算，只读 */
    channelStatus?: Record<PayChannel, ChannelStatus>;
    /** 能真正收款的渠道 */
    availableChannels?: PayChannel[];
    /** 前台会渲染的渠道（只看启用开关） */
    enabledChannels?: PayChannel[];
  };
  seo: PublicSeoSettings;
  security: {
    adminPath: string;
    captcha: number;
    loginFailLock: number;
    lockThreshold: number;
    sessionTimeout: number;
  };
  /** 发货通知：按买家留的联系方式自动选短信或邮件 */
  notify: {
    enable: number;

    mailEnable: number;
    /** 邮件发送通道：smtp（传统 SMTP）或 resend（HTTP API，云平台可用） */
    mailProvider: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: number;
    smtpUser: string;
    smtpPass: string;
    smtpPassSet: boolean;
    smtpFrom: string;
    smtpFromName: string;
    resendKey: string;
    resendKeySet: boolean;

    smsEnable: number;
    smsUrl: string;
    smsMethod: string;
    smsBodyType: string;
    smsParams: string;
    smsKey: string;
    smsKeySet: boolean;
    smsSuccessText: string;

    mailSubject: string;
    mailBody: string;
    smsBody: string;
  };
  announcements: Announcement[];
}

export interface AdminInfo {
  id: number;
  username: string;
  nickname: string;
  role: string;
  lastLoginAt: string;
  lastLoginIp: string;
}

/**
 * 保存设置的提交体。
 * 注意 announcements 只需要 text / status —— id 由服务端生成，
 * 所以不能直接复用读取时的 Announcement 类型。
 */
export interface SettingsInput {
  site?: Partial<PublicSiteSettings>;
  trade?: Partial<AdminSettings["trade"]>;
  payment?: Partial<AdminSettings["payment"]>;
  seo?: Partial<PublicSeoSettings>;
  security?: Partial<AdminSettings["security"]>;
  notify?: Partial<AdminSettings["notify"]>;
  announcements?: Array<{ text: string; status: number }>;
}

export interface Captcha {
  id: string;
  svg: string;
  expiresInSeconds: number;
}

/* ========================================================== 浏览器注入项 */

/** 内存缓冲的系统运行日志条目（后端 logger 环形缓冲，进程重启即清空） */
export interface RuntimeLogEntry {
  time: string;
  level: "info" | "warn" | "error";
  message: string;
}

/** 服务端在 HTML <head> 里注入的运行时配置 */
export interface RuntimeConfig {
  role: "site" | "admin";
  siteBase: string;
  adminBase: string;
}

declare global {
  interface Window {
    JKP_RUNTIME?: RuntimeConfig;
  }
}
