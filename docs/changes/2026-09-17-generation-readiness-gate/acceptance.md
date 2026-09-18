# 生成前提决策门：Acceptance

- 变更编号：`CHG-2026-09-17-generation-readiness-gate`
- 状态：`ACCEPTED`
- 创建时间：2026-09-17
- 更新时间：2026-09-17

## 验收结论

- 结论：`ACCEPTED`
- 验收时间：2026-09-17
- 验证 commit：`N/A`

## 验收证据

| 标准 | 证据 | 命令或文件 | 结果 |
| --- | --- | --- | --- |
| 固定横轴缺失返回澄清 | Compile 异常经 Readiness Gate 转为 `MISSING_X_FIELD`，不再归为编译失败 | `pnpm --filter @langreport/generation test`；`packages/generation/test/unit/index.test.ts` | `PASS`（22/22） |
| 澄清问题包含推荐项和证据 | 合同包含阶段、严重性、推荐项、候选和确定性证据；一个候选仍需澄清 | `pnpm --filter @langreport/contracts test`；`packages/contracts/test/unit/model.test.ts` | `PASS`（25/25） |
| 新 Cycle 保存父 Job 和决策 | API 校验父 Job、候选值、Conversation、Data Asset、Snapshot 和指标口径；新 Job 保存 parent/decision | `apps/api/src/routes.ts`；`packages/generation/test/unit/index.test.ts`；`pnpm --filter @langreport/api test` | `PASS`（29/29，含路由注册/OpenAPI 合同） |
| 用户停止为 cancelled | cancel 只接受 `needs_clarification`，已取消幂等返回，其他终态冲突且不进入 retry | `apps/api/src/routes.ts`；`packages/contracts/src/http.ts`；`pnpm --filter @langreport/db db:verify` | `PASS` |
| UI 显示建议并可停止 | 澄清依据面板展示推荐不是正确答案、证据和停止动作；桌面/移动现有工作台回归通过 | `pnpm --filter @langreport/web test:e2e`；`pnpm --filter @langreport/web typecheck` | `PASS`（10/10 E2E，desktop/mobile） |

## 失败项与遗留问题

本轮未接入真实百炼调用；模型供应商鉴权和端点配置不在本变更范围。Quality warning 的“继续并接受风险”、运行中 Job 取消和其他非 Compile 规则仍属于后续变更。

## 文档同步确认

- `CONTEXT.md` 已记录 Generation Readiness Gate、Clarification Proposal、Generation Decision 领域词汇。
- 产品范围不扩大到通用 BI 或 Agent 工作流。
- 迁移 `0024_generation_readiness_gate.sql` 已纳入 Drizzle journal，并通过从空 Schema 回放的兼容性验证。
- `pnpm typecheck`、`pnpm test`、`pnpm docs:check` 均通过。
