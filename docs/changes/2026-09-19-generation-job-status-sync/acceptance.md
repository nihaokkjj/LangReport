# Generation Job 状态同步优化：Acceptance

- 变更编号：`CHG-2026-09-19-GENERATION-JOB-STATUS-SYNC`
- 状态：`VERIFYING`
- 创建时间：2026-09-19
- 更新时间：2026-09-19

## 验收结论

- 结论：`PARTIAL`
- 验收时间：2026-09-20（自动化验收）
- 验证 commit：`N/A`

核心实现、离线自动化验证和 PostgreSQL 连接型验证已完成；真实浏览器人工验收及专项性能证据仍待补齐，因此保留 `PARTIAL`，不宣称本变更已完全验收。

## 验收证据

| 标准 | 证据 | 命令或文件 | 结果 |
| --- | --- | --- | --- |
| 同一 Job 不再重叠发起 status 请求 | Web watcher 单飞 + 可控 fetch 测试 | `apps/web/app/generation-job-status-watcher.ts`、`apps/web/test/unit/generation-job-status-watcher.test.ts` | 通过 |
| 切换 Project/Conversation/Job 会 abort 且拒绝迟到写入 | AbortController + session token + 页面会话 guard | `apps/web/app/page.tsx` | 通过类型检查与单元测试 |
| 轻量 status/长轮询和完整 GET 分层 | status projection、200/204、版本 Header、终态完整刷新 | `apps/api/src/routes.ts`、`packages/contracts/src/http.ts` | 通过 API/OpenAPI 测试 |
| 状态版本不被 heartbeat 消耗 | Lease helper 递增规则与 heartbeat 排除 | `packages/db/src/generation-job-lease.ts`、`apps/api/test/integration/generation-job-status.integration.test.ts` | 真实 PostgreSQL 集成通过 |
| API Console 与新接口同步 | OpenAPI 展示、query 参数和 Loop 4 | `apps/web/app/api-console/page.tsx` | 通过 Web 类型检查 |
| 回退和部署关闭开关 | `GENERATION_STATUS_LONG_POLL=false` + 串行 fallback | `.env.example`、`.env.production.example`、watcher/API route | 已实现 |

## 失败项与遗留问题

- `pnpm --filter @langreport/db db:verify` 与 `pnpm test:integration` 已通过；真实 PostgreSQL 已完成迁移回放、LISTEN/NOTIFY、100 waiter 和 heartbeat 版本验证。
- 尚未进行真实浏览器 Network 面板人工验收，也未完成监听连接数、长时请求量和代理空闲超时性能证据。
- 工作树仍包含用户在本轮之前已有的 API route、认证和 API Console 修改，验收只覆盖本变更新增的状态同步范围。

## 文档同步确认

- 本轮没有修改 `CONTEXT.md`：没有新增领域术语。
- 本轮没有修改产品范围：仍服务咨询项目报告的 Generation Job 状态可观察性。
- 设计获批并实现后，需要同步 `docs/architecture/architecture.md`、`docs/project-spec.md`、contracts/OpenAPI 和 API Console。
