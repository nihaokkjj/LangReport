# 生成前提决策门：Task

- 变更编号：`CHG-2026-09-17-generation-readiness-gate`
- 状态：`ACCEPTED`
- 创建时间：2026-09-17
- 更新时间：2026-09-17

## 执行前提

- 用户已明确要求按照已讨论方案执行；
- 第一阶段边界、Generation Cycle 不变量和 UI 规范已读取；
- 不修改模型凭据、供应商端点或现有用户数据；
- 当前“停止”范围限定为 `needs_clarification` Job。

## 任务清单

| ID | 任务 | 依赖 | 可并行 | 负责人 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | 扩展 contracts：澄清证据、推荐项、Generation Decision、cancelled | — | 否 | Codex | 完成 | `pnpm --filter @langreport/contracts test` | 25/25 通过 |
| T2 | 实现 Generation Readiness Gate 和缺失横轴候选算法 | T1 | 否 | Codex | 完成 | `pnpm --filter @langreport/generation test` | 22/22 通过；候选只来自 profiles/Transform 输出 |
| T3 | 接入 GenerationCycle/Worker，保存决策并处理新 Cycle | T1/T2 | 否 | Codex | 完成 | `pnpm --filter @langreport/generation-worker typecheck` `pnpm --filter @langreport/generation-worker test` | needs_clarification、审计和决策链路可编译、回归通过 |
| T4 | 增加 DB 迁移、Job 字段和 API cancel/parent 校验 | T1 | 可与 T2 并行 | Codex | 完成 | `pnpm --filter @langreport/api test` `pnpm --filter @langreport/db db:verify` | 29/29 API 测试通过；迁移回放通过 |
| T5 | 更新 Web 澄清/停止/决策交互 | T1/T4 | 否 | Codex | 完成 | `pnpm --filter @langreport/web typecheck` `pnpm --filter @langreport/web test:e2e` | 类型通过；desktop/mobile 10/10 E2E 通过 |
| T6 | 回归验证、验收证据和交接 | T1-T5 | 否 | Codex | 完成 | `pnpm docs:check` `pnpm typecheck` `pnpm test` | 文档和验证证据已回写 |

## 执行顺序

T1 → T2 → T3/T4 → T5 → T6。

## 并行工作流

T2 的纯 Generation 实现与 T4 的迁移/API 可以在 T1 完成后并行设计，但同一工作树中仍按依赖顺序落地和验证。

## 阻塞条件

- 发现已有数据库迁移未记录或不可前滚；
- 当前 API 权限模型无法安全区分同 Project 的父 Job；
- Gate 候选无法证明来自 Snapshot 或 TransformResult；
- Web 交互需要改变第一阶段信息架构。

## 回滚或替代方案

- 代码回滚前停止发送 Generation Decision；新增数据库字段保留；
- 若迁移无法安全部署，先只启用 Generation Gate 的离线合同和 Worker 澄清，不启用 cancel 状态；
- 若 Web 类型检查暴露既有问题，只修改本变更新增的类型和交互，不掩盖原有错误。

## Definition of Done

- T1-T6 完成或明确记录阻塞；
- 固定横轴缺失回归通过；
- cancelled 不进入 retry；
- 旧 Job、Snapshot、Revision 和 Project Memory 不被覆盖；
- acceptance、handoff、git diff 和验证命令同步更新。
