# 生成前提决策门：Handoff

- 变更编号：`CHG-2026-09-17-generation-readiness-gate`
- 状态：`ACCEPTED`
- 创建时间：2026-09-17
- 更新时间：2026-09-17

## 当前状态

已完成方案确认、领域词汇记录、SDD 文档、实现和回归验证。本变更已达到 `ACCEPTED`，尚未创建专用 Git commit。

## 已完成

- 用户确认通用决策门的业务边界；
- 用户确认确定性候选、当前 Cycle 决策、不自动写长期规范和用户停止不算失败；
- `CONTEXT.md` 已加入三个领域词汇；
- 已核对当前 Generation Graph、DB Job 状态、API 路由和 Web 澄清界面。
- 已实现 `Generation Readiness Gate`、结构化 `Generation Decision`、父 Job 链、`cancelled` 状态、API 保护和 Web 澄清/停止交互。
- 已加入 `0024_generation_readiness_gate.sql`，并将迁移文件与 Drizzle journal 保持同步。

## 下一步

后续若继续推进，应为 Profile、Transform、Validate 的具体业务规则建立独立变更；质量 warning 的“继续并接受风险”和运行中 Job 取消也应单独设计，不要在本变更中隐式扩大状态机。

## 当前 commit 与修改范围

当前无本变更专用 commit；工作树包含本轮 `CONTEXT.md` 和本变更文档。

## 已运行验证

- `pnpm --filter @langreport/contracts test`：25/25；
- `pnpm --filter @langreport/generation test`：22/22；
- `pnpm --filter @langreport/api test`：29/29；
- `pnpm --filter @langreport/generation-worker test`：9/9；
- `pnpm --filter @langreport/web test:e2e`：10/10，覆盖 desktop/mobile；
- `pnpm typecheck`、`pnpm test`、`pnpm --filter @langreport/db db:verify`、`pnpm docs:check`：通过。

## 已确认决策

- MVP 限制在第一阶段图表/Evidence Block；
- 用户决策不写入长期规范；
- 候选来自确定性字段证据；
- 用户选择/补充创建新 Cycle；
- 用户停止使用独立终态；
- 本轮只取消 `needs_clarification` Job。

## 已知问题与未决问题

- Quality warning 的“继续并接受风险”留给后续变更；
- 运行中 Job 取消协议留给后续变更；
- 当前 Gate 已提供五阶段统一接口，但本 MVP 只接入 Compile 缺失横轴和 Planning 缺少数值指标两类确定性规则。

## 新会话启动必读

- `AGENTS.md`、`CONTEXT.md`、`docs/product/phase1-consulting-report.md`；
- `docs/agent/agent-loop-spec.md`、`docs/architecture/architecture.md`；
- 本目录下的 `proposal.md`、`design.md`、`task.md`、`test-plan.md` 和最新 `handoff.md`。
