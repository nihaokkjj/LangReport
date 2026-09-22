# 第一阶段核心产品可用化交接

- 变更编号：`CHG-2026-09-21-phase1-core-product`
- 状态：`VERIFYING`
- 负责人：LangReport owner agent
- 创建时间：2026-09-21
- 更新时间：2026-09-21

## 当前状态

已完成只读侦察、SDD 审核、业务实现、完整结果事实链修复和本地/隔离环境回归，当前处于 `VERIFYING`。产品闭环通过；真实百炼门禁在当前 deterministic 环境执行后被安全拒绝，仍需在真实 llm 发布环境重跑。

## 已完成

- 对照 `CONTEXT.md`、第一阶段产品规格、项目基线、架构和 Agent Loop 规范梳理目标。
- 确认当前基线已有 Project、Snapshot、Generation、Worker、Revision、Review 的主要实现。
- 已补齐 HTML 固定 Revision 输出和无 API mock 的真实 HTTP live smoke。
- 已新增版本化 `resultSummary`，由完整 TransformResult 计算并贯穿 Job、Revision、Evidence；finding 不再读取 500 行预览。
- 已修正最终 Render Validation 与 Generation Audit 不一致，审计现在包含合并后的静态 HTML 校验。
- 建立 proposal、design、task、test-plan、acceptance、test-report。

## 进行中

- T1-T7：已完成并通过 live smoke、集成测试、Web E2E 和全仓库回归。
- T8：代码/文档已完成；真实百炼发布门禁待在发布环境执行。

## 下一步

当前下一步：

1. 在发布环境将 `GENERATION_MODE` 设置为 `llm`，加载真实百炼路由和 Worker-only API Key。
2. 执行 `pnpm phase1:release-gate`，保存脱敏 JSON 结果；失败则阻止发布。
3. 由维护者完成最终人工验收后，将变更状态从 `VERIFYING` 推进到 `ACCEPTED` 或保留 `PARTIAL`。

## 当前 commit 与修改范围

- 基线 commit：`a29ed06`
- 当前修改：本变更目录文档、静态 HTML 输出、导出合同/API/Web、live smoke、发布门禁脚本和 Worker 测试。
- 禁止使用 destructive Git 命令覆盖工作树。

## 已运行验证

- 本轮已验证：`pnpm typecheck`、`pnpm test`、`pnpm test:integration`、`pnpm test:e2e`（12 项）、`pnpm build`、`pnpm --filter @langreport/db db:verify` 和 `pnpm phase1:smoke` 通过；E2E 使用 API fixture，真实 API/Worker 证据以 HTTP smoke 为准。`pnpm phase1:release-gate` 已执行，因当前 deterministic 配置失败，未发出百炼请求。

## 已确认决策

- 第一阶段仍是单 Project/单 Snapshot/单 Brief/单主图 Evidence Block。
- 复用现有模块化单体和 PostgreSQL-backed Worker，不建立第二套同步生成服务。
- HTML 首版为服务端生成的安全、自包含、固定 Revision 静态 SVG 包装页；不执行用户脚本。
- deterministic route 是离线/回归验收基线；发布环境必须通过真实百炼结构化调用门禁。

## 已知问题与未决问题

- 真实百炼 release gate 仍缺发布环境的 `GENERATION_MODE=llm` 和对应凭据；这是上线阻塞项，不是 deterministic 回归失败。

## 新会话启动必读

1. `D:\front\newProject\agent-tasks\AGENTS.md`
2. `D:\front\newProject\agent-tasks\current-task.md`
3. `D:\front\newProject\LangReport\AGENTS.md`
4. `D:\front\newProject\LangReport\CONTEXT.md`
5. `D:\front\newProject\LangReport\docs\product\phase1-consulting-report.md`
6. 本变更目录中的 `proposal.md`、`design.md`、`task.md`、`test-plan.md`
