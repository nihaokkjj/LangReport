# 登录网关与会话 Cookie：Acceptance

- 变更编号：`CHG-2026-09-22-login-gateway`
- 状态：`VERIFYING`
- 创建时间：2026-09-22
- 更新时间：2026-09-22

## 验收结论

- 结论：`PARTIAL`
- 验收时间：2026-09-22
- 验证 commit：见包含 `CHG-2026-09-22-login-gateway` 的当前提交。

“开发模式也必须登录”的范围调整已实现并通过主回归与独立增量复测：API
33/33、Contracts 26/26、全量 E2E 16/16、phase1 真实登录闭环以及
typecheck/test/build/docs 均通过。当前没有未关闭的 P0/P1/P2。

## 验收证据

| 标准 | 证据 | 命令或文件 | 结果 |
| --- | --- | --- | --- |
| 默认会话为 7 天且不可超过 7 天 | JWT `exp-iat`、Cookie Max-Age 与配置上限单测 | `pnpm --filter @langreport/api test` | PASS（33/33） |
| Cookie 安全属性 | production 注入响应断言 | `apps/api/test/unit/auth.test.ts` | PASS |
| 登录、会话、登出与限流 | Fastify inject 路由测试 | `apps/api/test/unit/auth.test.ts` | PASS |
| 契约和 OpenAPI 同步 | 路由注册表与 OpenAPI 断言 | `pnpm --filter @langreport/contracts test` | PASS |
| Web 登录及凭据不持久化 | desktop 与 mobile Playwright | `pnpm test:e2e` | PASS（16/16） |
| 类型与构建 | workspace 检查 | `pnpm typecheck`、`pnpm build` | PASS |
| 文档与格式 | 文档链接、diff whitespace | `pnpm docs:check`、`git diff --check` | PASS |
| 独立验证 | 当前工作树只读复核与修复后复测 | `test-report.md` | TEST_PASSED |
| 开发环境强制登录 | `x-user-id` 拒绝、开发 Cookie、401 跳转与无身份头 | API unit + desktop/mobile E2E | 独立复测 PASS |
| 登录后开发 Bootstrap 与完整业务闭环 | 真实 API/Worker smoke | `pnpm phase1:smoke` | PASS |
| 真实生产代理后的 Cookie-only 会话 | HTTPS 部署 smoke | `pnpm phase5:smoke` | BLOCKED（缺部署目标与凭据） |

## 失败项与遗留问题

- 独立验证发现的 issuer/audience 首尾空格规范化问题已修复，API 32/32 与 typecheck 复测通过。
- 当前没有未关闭的 P0/P1/P2 代码缺陷。
- 独立复测发现 `phase1:smoke` 仍发送 `x-user-id`；现已改为生成隔离测试凭据、真实登录并使用 Cookie，复测通过。
- 无状态登出仅清除浏览器 Cookie，不提供 JWT 服务端撤销；这是已批准的明确非目标。
- 进程内失败窗口只适用于当前单 API 实例；多实例部署前需迁移到共享限流或上游身份系统。
- 真实 HTTPS Secure Cookie smoke 必须在部署后执行，未执行前结论保持 `PARTIAL`。

## 文档同步确认

- proposal、design、task、test-plan、acceptance 和 handoff 已同步到 `VERIFYING`。
- Contracts、API Console、生产 Compose、Nginx、环境变量示例、架构和部署文档已同步。
