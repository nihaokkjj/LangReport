# 登录网关与会话 Cookie：Handoff

- 变更编号：`CHG-2026-09-22-login-gateway`
- 状态：`VERIFYING`
- 创建时间：2026-09-22
- 更新时间：2026-09-22

## 当前状态

部署配置的单账号登录网关已实现：正确凭据签发 HS256 JWT，并通过 HttpOnly
`langreport_session` Cookie 建立最长 7 天的浏览器会话。主 Agent 的本地自动化
已通过原范围验证。用户随后要求开发模式也必须登录；开发环境的 `x-user-id`/
隐式用户回退现已移除，主回归和独立增量复测均通过。

## 已完成

- scrypt 密码哈希生成与恒定时间凭据校验。
- login/session/logout 路由、失败窗口和 Nginx 登录入口限速。
- HS256 JWT 的 `sub`、`iat`、`exp`、`jti` 与可选 `iss`/`aud` 签发。
- 生产 `HttpOnly; Secure; SameSite=Lax; Path=/` Cookie 与默认/最大 604800 秒 TTL。
- Web 登录页、401 返回登录、登出入口和 API Console 敏感字段保护。
- Contracts/OpenAPI、Compose、env 示例、部署指南、架构说明和 production smoke 同步。
- API、Contracts、Web 类型检查、desktop/mobile E2E、全量构建和文档检查。
- 修复独立验证发现的 issuer/audience 首尾空格规范化差异，并由同一验证角色复测通过。
- 开发与生产统一登录边界；Web 不再发送开发身份头，所有环境的 401 都返回登录页。
- 本地配置与开发文档已要求 scrypt 登录账号，开发 Cookie 仅不设置 HTTPS `Secure`。

## 进行中

- 真实同源 HTTPS 环境的 Secure Cookie、刷新恢复、登出后拒绝访问 smoke。

## 下一步

1. 在真实同源 HTTPS 环境注入登录配置，运行 phase5 production smoke。
2. 用户完成业务验收后，将变更状态更新为 `ACCEPTED`；是否提交 Git 由用户另行确认。

## 当前 commit 与修改范围

- 本变更由包含 `CHG-2026-09-22-login-gateway` 的提交保存；真实 HTTPS 验收仍待部署。
- 修改范围限定于 API 认证、Auth HTTP 契约、Web 登录入口、生产代理/配置、测试和本变更文档。
- 未新增数据库表、用户领域模型、OAuth/OIDC、Refresh Token 或撤销列表。

## 已运行验证

- `pnpm --filter @langreport/api test`：PASS（33/33）。
- `pnpm --filter @langreport/contracts test`：PASS。
- `pnpm --filter @langreport/web typecheck` 与 `test:typecheck`：PASS。
- `pnpm test:e2e`：PASS（desktop/mobile 16/16；登录聚焦用例 4/4）。
- `pnpm typecheck`、`pnpm build`、`pnpm docs:check`：PASS。
- `git diff --check`：PASS。
- `pnpm phase1:smoke`：PASS（真实 login Cookie → session → dev/bootstrap → 完整业务闭环）。
- 开发强制登录独立增量复测：TEST_PASSED；无未关闭 P0/P1/P2。

## 已确认决策

- 第一阶段采用部署配置单账号和 scrypt 哈希，不建立用户表或接入 OAuth。
- 会话默认 7 天，可缩短到最低 5 分钟，不允许超过 7 天。
- 现有 Bearer JWT 保持兼容；浏览器登录响应正文不返回 Token。
- 登出是客户端 Cookie 清除，不提供无状态 JWT 的服务端主动撤销。

## 已知问题与未决问题

- 真实 HTTPS Secure Cookie 与 Cookie-only 业务访问尚需部署环境验证。
- 多实例场景必须替换进程内登录失败窗口。
- JWT Secret 轮换会立即使现有会话失效，当前不支持双密钥平滑轮换。

## 新会话启动必读

1. 根 `AGENTS.md`、`CONTEXT.md` 与 `.agents/manifest.json`。
2. 本目录的 proposal、design、task、test-plan、test-report、acceptance 和 handoff。
3. `apps/api/src/auth.ts`、`apps/api/src/auth-routes.ts` 与 `apps/web/app/login/`。
4. 最新 `git status`，避免覆盖用户或其他 Agent 的在途修改。
