# Generation Job 状态同步优化：Handoff

- 变更编号：`CHG-2026-09-19-GENERATION-JOB-STATUS-SYNC`
- 状态：`VERIFYING`
- 创建时间：2026-09-19
- 更新时间：2026-09-20

## 当前状态

变更已完成计划审核，当前处于 `VERIFYING`。用户已确认将以下两项作为需要修复的现状缺陷：

1. 同一标签页、同一 Generation Job 可以存在多个在途状态请求；
2. 切换 Project/Conversation 后，旧请求没有被真正取消。

用户已给出“执行计划”指令；实现已完成，当前进入 `VERIFYING`，保留数据库集成和人工浏览器验收门槛。

## 已完成

- 核对当前 Web、API、Generation/Render Worker 和 Lease heartbeat 实现。
- 确认现有完整 GET 被高频调用，且 `updatedAt` 不适合作为用户状态版本。
- 确定 HTTP 长轮询 + PostgreSQL `LISTEN/NOTIFY` 为主方案。
- 确定保留完整 GET，新增轻量 status 接口。
- 确定 MVP 只保证单标签页 single-flight，不做跨标签页协调。
- 完成 proposal、design、task、test-plan、acceptance、test-report 和 handoff 同步。
- 新增 status projection、版本字段/通知迁移、共享 Observer、Web watcher、Abort/session guard、API Console Loop 4 状态等待和长轮询关闭开关。

## 验证中

- 已按 T1-T9 实施；API 合同、`statusVersion` 规则、25 秒等待上限和本轮不包含 Worker Queue 优化的范围保持冻结。

## 下一步

1. 执行真实浏览器人工验收：同一 Job Network 无重叠、切换 Project/Conversation 旧请求显示 aborted。
2. 补做监听连接数、长时请求量和代理空闲超时性能证据。
3. 补写 `acceptance.md` 的剩余证据后，将状态推进到 `ACCEPTED`。

## 当前 commit 与修改范围

- 当前分支：`main`
- 当前 commit：未在本轮创建 commit。
- 本轮新增范围：`docs/changes/2026-09-19-generation-job-status-sync/`、status route/observer、DB 迁移、Web watcher 和 API Console 场景同步。
- 工作树在本轮开始前已有 API route、contracts、API Console 和架构文档修改；这些修改不属于本变更，本轮未覆盖。

## 已运行验证

- `pnpm typecheck`：通过。
- `pnpm test`：通过（离线系统检查、各 package unit tests、Web watcher 3 项）。
- `pnpm --filter @langreport/contracts test`：通过 25 项。
- `pnpm --filter @langreport/api test`：通过 32 项。
- `pnpm --filter @langreport/web test`：通过 3 项；`test:typecheck`：通过。
- `pnpm docs:check`：通过。
- `pnpm --filter @langreport/db db:verify`：迁移 ledger 校验通过。
- `pnpm test:integration`：真实隔离 PostgreSQL/MinIO 集成通过；API 4 项、Generation/Render Worker 1 项通过，包含 100 waiter 状态通知验证。

## 已确认决策

- 采用有界 HTTP 长轮询，不采用 SSE/WebSocket。
- 新增轻量 `/status` 接口，保留现有完整 GET。
- 使用独立 `statusVersion/statusChangedAt`，不复用 heartbeat 会修改的 `updatedAt`。
- 单标签页内同一 Job single-flight；跨标签页去重留待后续。
- 切换 Project、Conversation、Job 或卸载时必须 abort 旧 fetch，并使用 session token 防止迟到写入。
- Worker Queue 轮询优化另开变更。

## 已知问题与未决问题

- 当前未提交的 API route registration 变更与未来实施文件重叠，需要先稳定或明确合并策略。
- 实施前需要确认生产代理的请求空闲超时。
- PostgreSQL 监听连接的具体重连 Adapter 需要在实现阶段按现有数据库导出能力落地，但不能改变每 API 进程单监听连接的设计约束。

## 新会话启动必读

- `AGENTS.md`
- `CONTEXT.md`
- `docs/product/phase1-consulting-report.md`
- `docs/agent/agent-loop-spec.md`
- `docs/architecture/architecture.md`
- `docs/architecture/domain-model.md`
- `docs/project-spec.md`
- 本变更目录下全部六份文档
