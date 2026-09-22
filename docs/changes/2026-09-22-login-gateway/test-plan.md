# 登录网关与会话 Cookie：Test Plan

- 变更编号：`CHG-2026-09-22-login-gateway`
- 状态：`VERIFYING`
- 创建时间：2026-09-22
- 更新时间：2026-09-22

## 测试范围

验证部署侧单账号从密码哈希校验到 HS256 JWT、HttpOnly Cookie、既有业务 API 身份恢复、登出和失败防护的完整闭环；同时验证契约、Web 体验和生产配置没有泄露敏感值或保留生产开发身份回退。

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| JWT 签发规则与验证器漂移 | unit + HTTP | login 后把 Cookie 回送 session/业务 API | 同一 `sub` 通过；alg/iss/aud/exp 不匹配被拒绝 |
| Cookie 属性不安全 | HTTP + production smoke | production/development 两种环境登录 | 生产固定 HttpOnly/Secure/Lax/Path/Max-Age；正文无 Token |
| 密码或哈希泄露 | unit + log audit | 错误凭据、无效配置、异常 | 响应/日志/OpenAPI/Smoke 不含提交密码、哈希、Secret、Token |
| 账号枚举和暴力尝试 | unit + HTTP | 错误账号与错误密码、连续失败 | 相同 401；达到阈值后 429 + Retry-After，窗口可恢复 |
| 限流状态无界增长 | unit | 大量不同来源并推进时钟 | 过期项清理，条目数受上限约束 |
| 登出未清 Cookie | HTTP + browser | 有效/无效 Cookie 调用 logout | 均 204，Set-Cookie 同路径立即过期，后续请求 401 |
| 开发身份绕过登录 | HTTP + browser | development 带 `x-user-id`、无 Cookie 访问业务 API | 401 并进入 `/login`；登录后才可访问 Bootstrap/业务 API |
| Web 密码被持久化 | browser | 登录成功/失败、刷新、返回 | URL、localStorage、sessionStorage 和历史无密码/JWT |
| 401 形成跳转循环 | browser | 未登录访问 `/`、登录页错误凭据、会话过期 | 只进入 `/login`；成功后回原页面，失败留在登录页 |
| 契约和 Console 漂移 | contract + web | 生成 OpenAPI 并调试 Auth 路由 | 三条路由、状态码和 request body 可见，敏感头不持久化 |

## 测试数据与环境

- 固定测试用户：`AUTH_LOGIN_USERNAME=operator`、`AUTH_LOGIN_USER_ID=login-test-user`；密码只在测试进程内生成对应 scrypt 哈希。
- 固定测试时钟和随机源用于断言 `iat`、`exp`、`jti` 与 Cookie TTL；生产代码默认使用真实时钟和安全随机源。
- HTTP 测试用 Fastify inject 捕获原始 `Set-Cookie`，不把 Token 输出到测试报告。
- 浏览器 E2E 通过同源 `/api` 路径运行；桌面和 390px viewport 各验证一次。
- production smoke 只在有 HTTPS 目标域名和安全注入配置时标记通过。

## 自动化测试

```text
pnpm --filter @langreport/api test
pnpm --filter @langreport/api test:typecheck
pnpm --filter @langreport/api typecheck
pnpm --filter @langreport/contracts test
pnpm --filter @langreport/web typecheck
pnpm --filter @langreport/web test:typecheck
pnpm test:e2e
pnpm docs:check
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

新增或扩展场景：

- `auth.test.ts`：scrypt hash、HS256 sign/verify、canonical signature、TTL/Claim、Cookie serialize/clear、错误配置和 limiter。
- TTL 用例必须断言未配置时 JWT 与 Cookie 默认有效期均为 `604800` 秒，并拒绝大于 7 天的配置。
- API route test：login→session→受保护 API→logout，以及 400/401/429/503。
- Development auth test：`x-user-id`/空身份均拒绝；非 Secure 的 HttpOnly Cookie 登录后可调用 `/api/v1/dev/bootstrap`。
- contracts/openapi test：Auth 标签、三条 route contract、响应头说明、敏感字段扫描。
- Web E2E：未登录跳转、正确/错误登录、刷新恢复、登出和响应式布局。
- deployment smoke：真实 HTTPS `Set-Cookie` 安全属性和 Cookie-only 业务访问。

## 人工验收步骤

1. 用离线脚本为强密码生成 scrypt 哈希，写入安全的生产环境配置；不把明文写入 `.env.production`。
2. 分别启动本地开发环境和同源 HTTPS 环境，未登录访问工作台，确认都进入 `/login`。
3. 输入错误账号和错误密码，确认统一提示，不暴露账号状态；连续失败确认出现限流提示。
4. 输入正确凭据，确认返回工作台并能读取当前用户私有 Project。
5. 在 DevTools 确认 Cookie 名为 `langreport_session`，具有 HttpOnly、Secure、SameSite=Lax、Path=/，且 Local/Session Storage 无 Token。
6. 刷新和重新打开同源页面，确认会话恢复；等待或构造过期 Token 后确认回到登录页。
7. 点击登出，确认 Cookie 立即过期，再访问业务接口得到 401。
8. 使用 Bearer Smoke 验证既有非浏览器客户端仍可工作；开发与生产的 `x-user-id` 均被拒绝。

## 不测试的内容及原因

- 多用户并发、注册、密码找回、MFA、OAuth/OIDC：不在本次范围。
- Redis/数据库共享限流和多实例 Session：第一阶段单 API 实例不引入共享状态。
- 第三方跨站 Cookie：部署标准是同源 Rewrite；不把浏览器第三方 Cookie 策略作为兼容目标。
- JWT 双密钥平滑轮换和主动撤销：当前短期无状态会话通过过期或更换 Secret 失效，后续另建变更。
