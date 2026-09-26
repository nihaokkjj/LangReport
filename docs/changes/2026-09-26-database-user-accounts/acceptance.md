# 数据库账号管理：Acceptance

- 变更编号：CHG-2026-09-26-database-user-accounts
- 状态：ACCEPTED（生产部署验收项待环境验证）
- 创建时间：2026-09-26
- 更新时间：2026-09-26

## 验收结论

- 结论：代码与自动化验收通过；生产网络验收未执行
- 验收时间：2026-09-26
- 验证 commit：N/A

用户已批准完整 SDD。代码、隔离集成、API/Contracts/Web 自动化和独立快照复核均已完成。未提供生产部署环境，因此不把 Nginx/WAF 实际限速、外部 API 旁路和真实 HTTPS Cookie 行为记为通过。

## 验收证据

| 标准 | 证据 | 命令或文件 | 结果 |
| --- | --- | --- | --- |
| 账号需求和安全取舍有用户确认 | 本任务对话中的第 1–29 项选择及最终确认 | 会话记录 | 已确认 |
| Proposal、Design、Task、Test Plan 内容一致 | 本变更目录内 SDD 文档 | docs/changes/2026-09-26-database-user-accounts | 用户已批准 |
| 用户表、迁移和账号生命周期可用 | 独立 Postgres 集成；迁移、bootstrap、CLI 及账号用例 | `pnpm test:integration`；`db:verify` | PASS；API 5/5、Worker 1/1，迁移校验通过 |
| Cookie、旧身份映射、停用/重置/自助改密会话策略正确 | API Auth 单测和账号集成测试 | API unit 38/38；账号集成 1/1 | PASS |
| Workspace/Project 数据和授权保留 | 迁移夹具与 `/api/v1/projects` 隔离断言 | `database-user-accounts.integration.test.ts` | PASS；旧账号沿用旧 Workspace，第二用户获得空的独立 Workspace |
| Web 账号页和桌面/移动流程 | Web typecheck、unit 与 Playwright | Web typecheck/test:typecheck；unit 24/24；全量 E2E 48 passed、4 skipped；账号页 targeted E2E 通过 | PASS；跳过项为无 live baseURL 的真实认证测试 |
| API Console 凭据脱敏 | 定向 Playwright，覆盖实际请求、预览、cURL 和历史 | `api-console.spec.ts`（Chromium desktop） | PASS 2/2；旧持久历史 Authorization 值也会脱敏 |
| 入口限速配置和 API 内部暴露 | Nginx 语法与生产 Compose 静态配置 | `nginx -t`；Compose `config --quiet` | 配置检查通过；公网绕行和运行时限速未做部署实测 |
| 全部接口和文档同步 | Contracts/OpenAPI/API Console、文档检查 | Contracts unit 26/26；`pnpm docs:check` | PASS |
| 独立复核 | 隔离快照；类型、单测、迁移与集成 | 独立 `test-report.md` | PASS；快照 E2E 受 Junction/Turbopack 限制，主工作区 E2E 另有有效通过结果 |

## 失败项与遗留问题

- 生产 Nginx/WAF 实际限速与公网 API 旁路尚未在部署环境验证。
- 真实 HTTPS Secure Cookie Smoke 未执行；前一登录网关真实 HTTPS Smoke 已按用户要求跳过，旧任务仍保持 VERIFYING/PARTIAL。
- `pnpm format:check` 仍报告既有 `apps/web/app/login/page.tsx` 格式差异；本变更未改动该既有登录页内容。
- 自设密码最低 6 位、共享初始/重置密码，以及停用、管理员重置和自助改密后现存 JWT 保留至各自原 exp（最长 7 天）均为已确认取舍。
- 新变更的真实 HTTPS Cookie 行为仍需部署验收；前一登录网关真实 HTTPS Smoke 已由用户要求跳过，既有验收结论保持 PARTIAL。

## 文档同步确认

- 本变更 proposal、design、task、test-plan、acceptance 与 handoff 已获用户批准并完成实现。
- Contracts、OpenAPI、API Console、部署指南、环境示例与 ADR 已同步；agent-tasks/decisions.md 已登记 WDG-011。
