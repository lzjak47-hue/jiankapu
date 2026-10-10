# 简卡铺 Code Wiki

> 24 小时自动发货的虚拟卡密商城 · Node 后端 + PostgreSQL + React 前台商城 + React 管理后台
>
> 本 Wiki 面向接手本项目的开发者，按「总览 → 后端 → 前端 → 依赖与数据 → 运行与测试」组织，
> 与根目录 [README.md](../../README.md) 互补：README 讲「功能与用法」，本 Wiki 讲「代码结构与实现」。
> 文中源码路径均相对 `docs/wiki/`，点击可直接跳转。

## 目录

| 编号 | 文档 | 内容 |
| --- | --- | --- |
| 01 | [项目总览与架构](./01-项目总览与架构.md) | 双服务拓扑、请求生命周期、代码分层、数据流 |
| 02 | [后端：启动、配置与数据层](./02-后端-启动-配置与数据层.md) | index.js / config.js / db.js / defaults.js / seed.js、13 张表 |
| 03 | [后端：HTTP 与静态服务](./03-后端-HTTP与静态服务.md) | server.js / router.js / body.js / respond.js / static.js |
| 04 | [后端：工具库 lib](./04-后端-工具库.md) | crypto / qrcode / wechatpay / alipay / mailer / sms / csv / validate / errors / time / logger |
| 05 | [后端：业务服务层](./05-后端-业务服务层.md) | auth / settings / payment / notify / alerts / category / product / card / order / user / stats / log |
| 06 | [后端：API 参考](./06-后端-API参考.md) | /api/public 与 /api/admin 全部端点、统一响应与错误、排序白名单 |
| 07 | [前端：架构与共享层](./07-前端-架构与共享层.md) | 单工程双 SPA、构建配置、shared 类型/API 客户端/hooks/组件 |
| 08 | [前端：前台商城 site](./08-前端-前台商城.md) | 路由、页面、BuyModal 四步下单状态机 |
| 09 | [前端：管理后台 admin](./09-前端-管理后台.md) | 路由、AuthContext、各页面、AlertsBell |
| 10 | [依赖关系与数据模型](./10-依赖关系与数据模型.md) | 外部依赖清单、内部模块依赖图、13 张表结构与设计要点 |
| 11 | [运行、部署与测试](./11-运行部署与测试.md) | 环境要求、全部命令、环境变量、上线检查清单、测试体系 |

## 30 秒速览

- **仓库形态**：pnpm workspace monorepo，`apps/server`（后端）+ `apps/web-react`（前端）+ `apps/web`（废弃旧前端，可删）。
- **后端**：Node ≥ 20 纯 ESM，**唯一运行时依赖 `pg`**；路由、静态服务、验证码、会话、scrypt、二维码、
  微信支付宝签名、SMTP、CSV 全部用 Node 内置能力实现。
- **前端**：React 19 + TypeScript strict + Vite 7，**一个工程产出两个 SPA**（前台 2001 / 后台 2002）。
- **数据**：PostgreSQL，启动自动建表（13 张）+ 幂等迁移 + 空库自动灌入演示数据。
- **核心链路**：下单（事务锁卡 `FOR UPDATE SKIP LOCKED`）→ 支付（微信/支付宝/测试三渠道）→ 回调或轮询查单 →
  自动发卡（短信/邮件通知）→ 查单/管理。