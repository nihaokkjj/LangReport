# 登录网关与会话 Cookie：Task

- 变更编号：`CHG-2026-09-22-login-gateway`
- 状态：`VERIFYING`
- 创建时间：2026-09-22
- 更新时间：2026-09-22

## 执行前提

- 本变更为 L 级权限与跨模块流程变更；`proposal.md`、`design.md`、`task.md` 和 `test-plan.md` 获得用户批准后才能修改业务代码。
- 用户已确认单账号部署身份方案与默认 7 天会话有效期。
- 用户已确认开发模式同样必须登录，范围调整已获得直接批准。
- 实现继续复用现有 `AUTH_JWT_SECRET` 与 JWT 验证器，不创建账户数据库或 OAuth 集成。
- 修改 API 时必须同步 Contracts、OpenAPI 和 API Console；修改 Web 时必须遵循根 `DESIGN.md` 和 Web 本地规则。

## 任务清单

| ID | 任务 | 依赖 | 可并行 | 负责人 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T0 | 审核登录范围、身份源、TTL 与安全属性 | 无 | 否 | 用户 + 主 Agent | 已完成 | 文档评审 | 用户于 2026-09-22 确认单账号方案与 7 天默认 TTL |
| T1 | 实现 scrypt 配置校验、JWT 签发、Cookie 序列化和失败窗口 | T0 | 否 | 主 Agent | 已完成 | `pnpm --filter @langreport/api test` | 正确/错误/无配置/超限/TTL/Claim/脱敏测试通过 |
| T2 | 实现 login/session/logout 路由并接入现有 AuthProvider | T1 | 否 | 主 Agent | 已完成 | API test + test:typecheck | Cookie 可恢复同一 sub，登出幂等清除，Bearer 保持兼容 |
| T3 | 同步 Contracts、OpenAPI、API Console 和 Nginx 入口限速 | T2 | 可与 T4 后半并行 | 主 Agent | 已完成 | contract tests、`pnpm docs:check` | 路由契约完整、Console 可调试、登录入口有限速 |
| T4 | 新增 Web 登录页、401 跳转和登出入口 | T2 | 可与 T3 后半并行 | 主 Agent | 已完成 | web typecheck、E2E | 登录/刷新/登出可用，密码不持久化，桌面/390px 可操作 |
| T5 | 更新 Compose、env 示例、部署文档、哈希脚本和 Smoke | T3–T4 | 否 | 主 Agent | 已完成 | docs/check、smoke dry checks | 生产配置可复现，敏感值不进入输出 |
| T6 | 独立验证、修复、验收和交接 | T1–T5 | 否 | 验证角色 + 主 Agent | 本地已完成；部署待验收 | test-plan 全部命令 | 本地场景通过；真实 HTTPS smoke 与用户验收待部署环境 |
| T7 | 移除开发身份绕过并统一登录跳转、配置和测试 | 用户范围调整 | 否 | 主 Agent | 已完成 | API/Web/contracts tests | 开发 `x-user-id` 返回 401，登录后 Cookie 可恢复身份，Web 所有环境均跳转登录 |

## 执行顺序

```text
T0 → T1 → T2 → T3/T4 → T5 → T6 → T7 → T6 复测
```

## 并行工作流

- 该 L 级变更批准后，主 Agent 负责规格内实现和修复。
- 实现完成后使用独立验证角色从完整代码快照执行 `test-plan.md`；验证角色不修改业务代码。
- 当前用户没有要求并行子 Agent，审核前不启动验证角色。

## 阻塞条件

- 身份源或会话时长未获确认时，不修改业务代码。
- 若需求扩大为多账号、用户表、OAuth/OIDC、MFA 或共享 Session Store，返回 PROPOSED 并重新设计。
- 若现有工作树出现与认证文件重叠的用户修改，先停止并报告，不覆盖。
- 若真实 HTTPS/域名未提供，可以完成自动化和本地实现，但不能把生产 Cookie 验收标为通过。

## 回滚或替代方案

- 路由/Web 回滚后恢复现有外部 JWT Provider 部署方式；无数据库数据需要删除。
- 若进程内失败窗口不满足扩容要求，保持单实例或在后续变更替换为 Redis/上游 WAF，不在本次临时引入共享状态。
- 若 Web 登录页无法与跨域部署兼容，部署必须回到同源 Rewrite；不降低 Cookie 到 `SameSite=None` 或非 Secure。

## Definition of Done

- [x] 设计已人工批准，未决问题已关闭。
- [x] 登录签发的 JWT 和现有验证器使用同一 HS256/Claim 规则。
- [x] `langreport_session` 在生产具有 `HttpOnly; Secure; SameSite=Lax; Path=/` 和受限 TTL。
- [x] login/session/logout、错误凭据、限流、过期、篡改与 Bearer 兼容测试通过。
- [x] Web 登录、401 恢复、刷新和登出在桌面/移动端通过。
- [x] Contracts、OpenAPI、API Console、Compose、env、部署文档和 Smoke 同步。
- [x] `pnpm docs:check`、相关 typecheck/test、`git diff --check` 通过。
- [x] 开发环境不再接受 `x-user-id`/隐式用户，且登录 Cookie 可恢复身份、开发 Bootstrap 保持登录后入口。
- [ ] 独立验证证据、acceptance 与 handoff 已写入，用户完成最终验收。
