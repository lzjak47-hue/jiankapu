# 06 · 后端：API 参考

> 路由源码：[src/routes/public.js](../../apps/server/src/routes/public.js)（前缀 `/api/public`）、
> [src/routes/admin.js](../../apps/server/src/routes/admin.js)（前缀 `/api/admin`）。
> 路由层是薄壳：解析参数 → 调 service → `ok()/fail()` 统一响应；参数校验交给 `lib/validate.js`。

## 1. 统一响应与错误

```json
{ "ok": true,  "data": { } }
{ "ok": false, "code": "CONFLICT", "message": "库存不足，请减少数量或稍后再试", "details": { } }
```

- API 响应 `Cache-Control: no-store`；未捕获 `ApiError` 由 `failFromError` 转 500。
- 后台写操作全部调用 `audit()` 记 `logs` 表。
- 列表接口统一 `paging()`：`page ≥ 1`、`perPage 1-100`。
- 排序参数走服务端白名单，非法值**安静回落默认**（详见各表 sort 键，README 有完整键名表）。

## 2. 前台 `/api/public/*`（无需登录）

| 方法 | 路径 | 处理 |
| --- | --- | --- |
| GET | `/bootstrap` | 站点设置 + 分类 + 商品 + 公告 + 两端地址 + 可用支付渠道（并行取数） |
| GET | `/products/:id` | `product.find`；不存在/下架 404 |
| GET | `/stats` | 脱敏站点统计（订单数 + 卡密计数） |
| POST | `/orders` | `order.create`（附 `clientIp`）；成功后渲染支付二维码 SVG 一并返回 |
| GET | `/orders/:no` | `order.findPublic`；待付款 + 真实渠道时**顺带主动查单**（支付节流 5s/单、金额核对后 markPaid） |
| POST | `/orders/:no/pay` | 仅测试渠道「模拟支付成功」；真实渠道 409（防凭单号免费领卡） |
| POST | `/orders/:no/cancel` | `order.close` |
| GET | `/orders/query?keyword=` | `order.searchPublic`：按订单号或联系方式模糊查 |
| POST | `/pay/notify/wechat` | 微信回调：`parseWechatNotify` 解密 → `amountMatches` → `markPaid`（统一 `handleNotify`） |
| POST | `/pay/notify/alipay` | 支付宝回调：验签 → 核对金额 → 发货 |

## 3. 后台 `/api/admin/*`（captcha/login/logout 外全部 `requireAuth`）

### 认证与账号

| 方法 | 路径 | 处理 |
| --- | --- | --- |
| GET | `/captcha` | `auth.createCaptcha()` → `{id, svg}` |
| POST | `/login` | `auth.login`，Set-Cookie 会话（HttpOnly/SameSite=Lax） |
| POST | `/logout` | `auth.destroySession` + 清 Cookie |
| GET | `/me` | 当前管理员 |
| POST | `/password` | `auth.changePassword`（踢其它会话） |
| GET | `/admins` | `auth.listAdmins` |

### 商品 / 分类

| 方法 | 路径 | 处理 |
| --- | --- | --- |
| GET / POST | `/products` | `product.list` / `product.create` |
| GET / PUT / DELETE | `/products/:id` | `find` 详情 / `update` / `remove` |
| POST | `/products/:id/toggle` | 上下架 |
| POST | `/products/batch` | 批量 `oneOf(on/off/delete)`；置为目标状态 |
| GET / POST | `/categories` | `category.list` / `create` |
| PUT / DELETE | `/categories/:id` | `update` / `remove`（有商品 409） |

### 订单

| 方法 | 路径 | 处理 |
| --- | --- | --- |
| GET | `/orders` / `/orders/stats` | `order.list`（筛选/排序/分页）/ `order.stats` |
| GET | `/orders/:no` | 详情（含下单 IP、支付时间） |
| POST | `/orders/:no/resend` | 补发 |
| POST | `/orders/:no/close` | 关闭（释放卡密） |
| POST | `/orders/:no/refund` | 退款（作废卡密、回写销量） |

### 卡密

| 方法 | 路径 | 处理 |
| --- | --- | --- |
| GET | `/cards` / `/cards/stats` | `card.list` / `card.stats` |
| POST | `/cards/import` | `card.importCards`（必须带 spec；`str/lines` 校验） |
| GET | `/cards/export` | `csv.toCsv` + UTF-8 BOM + RFC 5987 文件名；沿用列表筛选 |
| POST | `/cards/batch-delete` | 跳过已售，回写库存 |
| DELETE | `/cards/:id` | 删除单条 |

### 客户 / 提醒 / 设置 / 日志

| 方法 | 路径 | 处理 |
| --- | --- | --- |
| GET | `/users` / `/users/stats` | `user.list` / `user.stats` |
| GET | `/users/:uid` | `user.detail`（购买记录 + 每笔订单 IP + IP 汇总） |
| GET | `/alerts` | `alerts.feed({since, …})` |
| GET / PUT | `/settings` | `settings.toApi` / `settings.save`（公告覆盖式事务保存） |
| POST | `/notify/test` | `notify.sendTest`；失败抛 `upstream(502)` 透出真实原因 |
| GET | `/logs` | `log.list`（keyword 模糊 / result 精确） |

### 鉴权与审计模式

`requireAuth(ctx)`：取 Cookie 会话 → `auth.getSession` → 失败抛 401（前端自动跳登录页）。
写操作统一 `audit(ctx, action, target, status, detail)` 记日志；异常由统一错误中间件兜底。