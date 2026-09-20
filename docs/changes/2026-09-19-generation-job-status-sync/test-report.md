# Generation Job 状态同步优化：Test Report

- 变更编号：`CHG-2026-09-19-GENERATION-JOB-STATUS-SYNC`
- 记录时间：2026-09-20
- 当前结论：`PARTIAL / VERIFYING`

## 已通过

- `pnpm --filter @langreport/contracts test`：25 项通过；包含 status path、query、200/204 OpenAPI 响应。
- `pnpm --filter @langreport/api typecheck`：通过。
- `pnpm --filter @langreport/api test`：32 项通过；包含 OpenAPI status operation 检查。
- `pnpm --filter @langreport/web typecheck`：通过。
- `pnpm --filter @langreport/web test:typecheck`：通过。
- `pnpm --filter @langreport/web test`：3 项通过，覆盖单飞、迟到响应 abort、status route fallback、终态停止。
- `pnpm typecheck`：全 workspace typecheck 与 test:typecheck 通过。
- `pnpm test`：离线测试系统、各 package unit tests 和 Web watcher 测试通过。
- `pnpm docs:check`：通过。
- `pnpm --filter @langreport/db db:verify`：通过迁移 ledger 兼容性校验，包含 `0026_generation_job_status_version.sql`。
- `pnpm test:integration`：通过真实隔离 PostgreSQL/MinIO；API 4 项、Generation/Render Worker 1 项通过。
- `apps/api/test/integration/generation-job-status.integration.test.ts`：真实 `LISTEN/NOTIFY` 唤醒 100 个并发 waiter；heartbeat 不递增 `statusVersion`；租约状态推进递增版本并再次唤醒 waiter。

## 尚未完成

- 真实浏览器人工验收未执行：需要观察同一 Job 的 Network 请求是否无重叠，以及切换 Project/Conversation 时旧 request 的 `AbortError`。
- 100 waiter 的唤醒验证已通过；单监听连接数的数据库观测和 60 秒请求量/代理超时性能证据尚未执行。

## 变更范围外

- Worker Queue 每秒扫描优化未包含在本轮；仍按原有 `GENERATION_POLL_INTERVAL_MS` 工作。
- 跨标签页请求合并、SSE/WebSocket 未实现。
