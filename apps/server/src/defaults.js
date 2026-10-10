/**
 * 简卡铺 · 默认数据
 * ---------------------------------------------------------------------------
 * 首次初始化数据库时写入的种子内容，同时作为「设置项缺失时的兜底值」。
 */

/** 初始管理员账号 */
export const DEFAULT_ADMIN = {
  username: "admin",
  password: "123456",
  nickname: "超级管理员",
  role: "超级管理员",
};

/**
 * 默认设置项（扁平 key，便于数据库按 key/value 存取）
 * 注意：payment 下的密钥字段仅作占位，真实环境请用环境变量注入，不要落库。
 */
export const DEFAULT_SETTINGS = {
  "site.name": "简卡铺",
  "site.subtitle": "24 小时自动发货的卡密商城",
  "site.logoMark": "简",
  "site.icp": "沪ICP备2026000000号",
  "site.serviceUrl": "",
  "site.serviceTime": "9:00 - 24:00",
  "site.email": "support@jiankapu.com",
  "site.footerText": "虚拟商品一经售出不支持退换 · 请在合法合规范围内使用",

  "trade.currency": "CNY",
  "trade.minOrder": "1",
  "trade.autoCloseMinutes": "15",
  "trade.lowStockWarn": "20",
  "trade.guestOrder": "1",
  "trade.orderPrefix": "JKP",
  "trade.refundWindowHours": "24",

  /* ---- 支付渠道 ----
     三个渠道可以同时开启，前台让买家自己选。
     「已启用」和「已配置」是两回事：只勾了启用但密钥没填的渠道
     不会下发给前台，免得买家选了却下不了单。 */
  "payment.wxEnable": "0",
  "payment.wxAppId": "",
  "payment.wxMchId": "",
  "payment.wxSerialNo": "",
  "payment.wxPrivateKey": "",
  "payment.wxApiV3Key": "",

  "payment.aliEnable": "0",
  "payment.aliAppId": "",
  "payment.aliPrivateKey": "",
  "payment.aliPublicKey": "",
  "payment.aliGateway": "https://openapi.alipay.com/gateway.do",

  /* 本地测试支付：不联外网，点一下就成功，方便自己跑通全流程 */
  "payment.testEnable": "1",
  "payment.testAutoPay": "0",

  "payment.qrExpireMinutes": "15",

  "seo.title": "简卡铺 · 24 小时自动发货的卡密商城",
  "seo.keywords": "发卡网,卡密,自动发货,会员充值,游戏点卡",
  "seo.description":
    "简卡铺 —— 全场官方渠道直充，下单后系统秒发卡密，24 小时无人值守自动发货。",

  "security.adminPath": "/admin",
  "security.captcha": "1",
  "security.loginFailLock": "1",
  "security.lockThreshold": "5",
  "security.sessionTimeout": "120",

  /* ---- 发货通知：按买家填的联系方式自动选短信或邮件 ---- */
  "notify.enable": "0",

  /* 邮箱（SMTP） */
  "notify.mailEnable": "0",
  "notify.mailProvider": "smtp",
  "notify.resendKey": "",
  "notify.smtpHost": "",
  "notify.smtpPort": "465",
  "notify.smtpSecure": "1",
  "notify.smtpUser": "",
  "notify.smtpPass": "",
  "notify.smtpFromName": "简卡铺",
  "notify.smtpFrom": "",

  /* 短信（HTTP 网关，参数模板里用 {phone} {content} {key} 占位） */
  "notify.smsEnable": "0",
  "notify.smsUrl": "",
  "notify.smsMethod": "POST",
  "notify.smsBodyType": "form",
  "notify.smsParams":
    '{"account":"your-account","password":"{key}","mobile":"{phone}","content":"{content}"}',
  "notify.smsKey": "",
  /* 响应体包含这段文字才算发送成功；留空则只看 HTTP 状态码 */
  "notify.smsSuccessText": "",

  /* 通知内容模板，可用 {site} {orderNo} {product} {spec} {qty} {amount} {secrets} */
  "notify.mailSubject": "【{site}】订单 {orderNo} 发货通知",
  "notify.mailBody":
    "您好，您在 {site} 的订单已发货。\n\n订单号：{orderNo}\n商品：{product}\n规格：{spec}\n数量：{qty}\n金额：¥{amount}\n\n卡密内容：\n{secrets}\n\n请妥善保管，如有问题请联系客服。",
  "notify.smsBody": "【{site}】订单{orderNo}已发货，卡密：{secrets}",
};

/** 默认公告 */
export const DEFAULT_ANNOUNCEMENTS = [
  "全站卡密 24 小时自动发货，付款后秒到账，无需等待人工。",
  "新用户首单立减 3 元，下单自动抵扣，无需领券。",
  "遇到卡密无法使用？联系在线客服，24 小时内无条件补发。",
  "支持微信 / 支付宝付款，全程加密，信息安全有保障。",
];

/** 默认分类 */
export const DEFAULT_CATEGORIES = [
  { id: "video", name: "视频会员", sort: 1, status: 1, remark: "爱奇艺 / 腾讯 / 优酷 / 芒果" },
  { id: "music", name: "音乐会员", sort: 2, status: 1, remark: "QQ 音乐 / 网易云" },
  { id: "game", name: "游戏点卡", sort: 3, status: 1, remark: "王者荣耀 / 和平精英" },
  { id: "software", name: "软件工具", sort: 4, status: 1, remark: "Office / Adobe" },
  { id: "other", name: "其他卡密", sort: 5, status: 1, remark: "话费 / 网盘" },
];

/**
 * 默认商品
 * stock / sold 会由 seed 依据实际卡密数量重算，这里只是初始值。
 */
export const DEFAULT_PRODUCTS = [
  {
    id: "p001",
    name: "爱奇艺黄金 VIP 会员",
    category: "video",
    emoji: "🎬",
    price: 12.8,
    oldPrice: 25,
    sold: 12876,
    status: 1,
    badge: "热销",
    badgeType: "accent",
    specs: ["月卡", "季卡", "年卡"],
    unit: "张",
    desc: "支持手机 / 平板 / 电脑，下单后系统自动发货。",
    detail:
      "爱奇艺黄金 VIP 会员，可享受全站会员内容、1080P 高清画质与免广告特权。本店卡密为官方直充渠道，下单后由系统自动发货，无需人工等待。",
    notice: [
      "卡密为虚拟商品，一经发货不支持退换，请确认需求后再下单。",
      "请在 24 小时内完成激活，逾期可能失效。",
      "一个账号同时只能使用一张同类会员卡密。",
    ],
    tutorial: [
      "付款成功后，页面会自动展示卡密，也可在「查询订单」页凭订单号再次查看。",
      "打开爱奇艺 App → 我的 → 会员中心 → 兑换会员。",
      "粘贴卡密并确认，权益将立即到账。",
    ],
    seedStock: 60,
  },
  {
    id: "p002",
    name: "腾讯视频 VIP 会员",
    category: "video",
    emoji: "📺",
    price: 13.5,
    oldPrice: 30,
    sold: 9542,
    status: 1,
    badge: "秒发",
    badgeType: "success",
    specs: ["月卡", "季卡", "年卡"],
    unit: "张",
    desc: "官方渠道直充，支持多端同时使用。",
    detail:
      "腾讯视频 VIP 会员，海量影视剧综免广告观看，支持蓝光画质与多设备登录。本店为官方授权渠道，卡密真实有效。",
    notice: [
      "虚拟商品，发货后不支持退换。",
      "请勿将卡密泄露给他人，泄露风险自负。",
      "如遇激活异常，请在 24 小时内联系客服处理。",
    ],
    tutorial: [
      "付款后自动获取卡密，请及时复制保存。",
      "打开腾讯视频 App → 我的 → 我的VIP会员 → 兑换。",
      "输入卡密并提交，会员立即生效。",
    ],
    seedStock: 55,
  },
  {
    id: "p003",
    name: "优酷 VIP 会员",
    category: "video",
    emoji: "🎥",
    price: 11.9,
    oldPrice: 25,
    sold: 6218,
    status: 1,
    badge: "",
    badgeType: "",
    specs: ["月卡", "季卡"],
    unit: "张",
    desc: "自动发货，支持优酷全端通用。",
    detail:
      "优酷 VIP 会员，可观看全站会员内容，享受免广告、1080P 画质等权益，适用于手机、平板与电脑端。",
    notice: ["虚拟商品，一经售出不退不换。", "卡密仅限单个账号使用。"],
    tutorial: [
      "付款成功后自动获取卡密。",
      "登录优酷 → 我的 → 会员中心 → 兑换会员。",
      "粘贴卡密完成兑换。",
    ],
    seedStock: 32,
  },
  {
    id: "p004",
    name: "芒果 TV 会员",
    category: "video",
    emoji: "🥭",
    price: 9.9,
    oldPrice: 19,
    sold: 3182,
    status: 0,
    badge: "售罄",
    badgeType: "muted",
    specs: ["月卡", "季卡"],
    unit: "张",
    desc: "芒果独播内容，免广告观看。",
    detail: "芒果 TV 会员，畅享芒果独播综艺与剧集，免广告、支持缓存下载。",
    notice: ["虚拟商品，一经售出不退不换。"],
    tutorial: ["付款成功后自动获取卡密。", "打开芒果 TV App → 我的 → 会员中心 → 兑换。"],
    seedStock: 0,
  },
  {
    id: "p005",
    name: "QQ 音乐豪华绿钻",
    category: "music",
    emoji: "🎵",
    price: 8.8,
    oldPrice: 18,
    sold: 8421,
    status: 1,
    badge: "热销",
    badgeType: "accent",
    specs: ["月卡", "季卡", "年卡"],
    unit: "张",
    desc: "无损音质 + 付费歌曲，自动发货。",
    detail:
      "QQ 音乐豪华绿钻会员，解锁无损音质、付费歌曲试听下载与专属音效，支持手机与电脑端。",
    notice: ["虚拟商品，发货后不支持退换。", "请确认账号为 QQ 音乐绑定账号再兑换。"],
    tutorial: ["付款后自动获取卡密。", "打开 QQ 音乐 → 我的 → 会员中心 → 兑换。", "输入卡密完成兑换。"],
    seedStock: 48,
  },
  {
    id: "p006",
    name: "网易云音乐黑胶 VIP",
    category: "music",
    emoji: "🎧",
    price: 9.5,
    oldPrice: 20,
    sold: 5390,
    status: 1,
    badge: "",
    badgeType: "",
    specs: ["月卡", "季卡", "年卡"],
    unit: "张",
    desc: "黑胶会员，畅听付费歌曲。",
    detail: "网易云音乐黑胶 VIP 会员，解锁付费歌曲、无损音质与个性化推荐特权。",
    notice: ["虚拟商品，一经售出不退不换。"],
    tutorial: ["付款成功后自动获取卡密。", "打开网易云音乐 → 账号 → 会员中心 → 兑换。"],
    seedStock: 40,
  },
  {
    id: "p007",
    name: "王者荣耀点券充值",
    category: "game",
    emoji: "🎮",
    price: 45.0,
    oldPrice: 50,
    sold: 15230,
    status: 1,
    badge: "秒发",
    badgeType: "success",
    specs: ["500 点券", "1000 点券", "2000 点券"],
    unit: "份",
    desc: "官方直充，到账快，支持全部区服。",
    detail:
      "王者荣耀点券直充，下单后按填写的游戏账号自动充值，支持微信区与 QQ 区。请务必核对账号信息，充错不退。",
    notice: [
      "下单时请准确填写游戏账号与区服，信息错误导致的损失自负。",
      "充值过程通常 1-5 分钟到账，高峰期可能延迟。",
    ],
    tutorial: [
      "付款时填写游戏账号、区服与角色名。",
      "系统自动完成充值，通常 1-5 分钟到账。",
      "可在「查询订单」页查看充值状态。",
    ],
    seedStock: 36,
  },
  {
    id: "p008",
    name: "和平精英点券充值",
    category: "game",
    emoji: "🔫",
    price: 48.0,
    oldPrice: 55,
    sold: 4180,
    status: 1,
    badge: "",
    badgeType: "",
    specs: ["500 点券", "1000 点券"],
    unit: "份",
    desc: "官方渠道，自动到账。",
    detail: "和平精英点券充值，支持微信区与 QQ 区，下单后自动处理。",
    notice: ["请准确填写账号与区服信息，充错不退。"],
    tutorial: ["付款时填写账号信息。", "系统自动充值并到账。"],
    seedStock: 18,
  },
  {
    id: "p009",
    name: "Office 365 家庭版激活码",
    category: "software",
    emoji: "📊",
    price: 128.0,
    oldPrice: 398,
    sold: 1863,
    status: 1,
    badge: "省钱",
    badgeType: "accent",
    specs: ["1 年 / 1 设备", "1 年 / 5 设备"],
    unit: "个",
    desc: "正版授权，支持官方激活通道。",
    detail:
      "Microsoft Office 365 家庭版激活码，支持 Word / Excel / PowerPoint 等全套组件，正版授权，可在多设备使用。",
    notice: ["激活码一经使用不可退换。", "请在购买后 7 天内完成激活。"],
    tutorial: [
      "付款成功后获取激活码。",
      "访问 office.com/setup 并登录微软账号。",
      "输入激活码完成绑定。",
    ],
    seedStock: 14,
  },
  {
    id: "p010",
    name: "Adobe 全家桶月卡",
    category: "software",
    emoji: "🎨",
    price: 88.0,
    oldPrice: 168,
    sold: 942,
    status: 0,
    badge: "售罄",
    badgeType: "muted",
    specs: ["月卡", "季卡"],
    unit: "个",
    desc: "PS / PR / AE 全套，设计必备。",
    detail:
      "Adobe Creative Cloud 全家桶会员，包含 Photoshop、Premiere、After Effects 等全套设计软件。",
    notice: ["虚拟商品，一经售出不退不换。"],
    tutorial: ["付款后获取账号信息。", "按邮件说明登录使用。"],
    seedStock: 0,
  },
  {
    id: "p011",
    name: "话费充值 100 元",
    category: "other",
    emoji: "📱",
    price: 96.5,
    oldPrice: 100,
    sold: 22105,
    status: 1,
    badge: "热销",
    badgeType: "accent",
    specs: ["50 元", "100 元", "200 元"],
    unit: "笔",
    desc: "三网通用，自动充值到账。",
    detail:
      "中国移动 / 联通 / 电信话费自动充值，下单后系统自动提交，通常 1-10 分钟到账。",
    notice: ["请确认手机号无误，充错不退。", "空号、停机保号等异常号码无法充值。"],
    tutorial: [
      "付款时填写需要充值的手机号。",
      "系统自动提交充值，1-10 分钟到账。",
      "如超时未到账请联系客服。",
    ],
    seedStock: 26,
  },
  {
    id: "p012",
    name: "百度网盘超级会员",
    category: "other",
    emoji: "☁️",
    price: 18.0,
    oldPrice: 30,
    sold: 7035,
    status: 1,
    badge: "秒发",
    badgeType: "success",
    specs: ["月卡", "季卡"],
    unit: "张",
    desc: "极速下载，自动发货。",
    detail:
      "百度网盘超级会员，享受极速下载、超大空间与在线解压等特权，卡密自动发货。",
    notice: ["虚拟商品，一经售出不退不换。"],
    tutorial: ["付款成功后自动获取卡密。", "打开百度网盘 App → 我的 → 会员中心 → 兑换。"],
    seedStock: 30,
  },
];

/** 演示用户 */
export const DEFAULT_USERS = [
  { uid: "U100238", name: "夜航船", contact: "138****6621", status: 1 },
  { uid: "U100237", name: "小林同学", contact: "139****3382", status: 1 },
  { uid: "U100236", name: "阿哲", contact: "137****9014", status: 1 },
  { uid: "U100235", name: "Momo", contact: "186****2277", status: 1 },
  { uid: "U100234", name: "小满", contact: "159****4408", status: 1 },
  { uid: "U100233", name: "老张", contact: "135****7731", status: 1 },
  { uid: "U100232", name: "chen", contact: "188****5560", status: 1 },
  { uid: "U100231", name: "测试账号", contact: "133****0001", status: 0 },
  { uid: "U100230", name: "橘子汽水", contact: "177****8890", status: 1 },
  { uid: "U100229", name: "疑似刷单", contact: "131****6677", status: 0 },
];

/** 固定演示订单号（前台「查询订单」页会提示这两个，保证任何时候都能查到） */
export const DEMO_ORDER_NUMBERS = ["JKP20260101001", "JKP20260102007"];

export default {
  DEFAULT_ADMIN,
  DEFAULT_SETTINGS,
  DEFAULT_ANNOUNCEMENTS,
  DEFAULT_CATEGORIES,
  DEFAULT_PRODUCTS,
  DEFAULT_USERS,
  DEMO_ORDER_NUMBERS,
};
