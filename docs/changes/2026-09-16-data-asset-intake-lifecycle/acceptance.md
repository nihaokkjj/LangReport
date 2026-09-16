# 收拢 Conversation-bound Data Asset intake：验收记录

- 变更编号：`CHG-2026-09-16-DATA-ASSET-INTAKE`
- 状态：`VERIFYING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 验收结论

- 结论：`PARTIAL`
- 验收时间：2026-09-16
- 验证 commit：`未提交；当前 HEAD 保持不变`

本次已按维护者“从 T1 开始”的明确指令进入实现，T1-T8 已完成并进入 `VERIFYING`。当前仍保留 `PARTIAL`，因为 T9 维护者最终验收/提交决定尚未完成；另有后续 re-ingest 和历史对象运维清理边界，不属于本次实现。

## 验收证据

| 标准 | 证据 | 命令或文件 | 结果 |
| --- | --- | --- | --- |
| A1 变更目录和六份 SDD 文档齐全 | proposal/design/task/test-plan/acceptance/handoff 已建立 | `docs/changes/2026-09-16-data-asset-intake-lifecycle/` | 通过 |
| A2 目标、非目标和已确认决策明确 | proposal 中记录 re-ingest 后续变更和不可变来源策略 | `proposal.md` | 通过文档审阅 |
| A3 数据流、失败路径和模块 seam 可执行 | design 覆盖 route、intake、parser、storage、DB、Snapshot access | `design.md` | 通过文档审阅 |
| A4 任务依赖和完成标准可判断 | task 包含 T0-T9、依赖、命令和 Definition of Done | `task.md` | 通过文档审阅 |
| A5 测试能覆盖跨 PostgreSQL/S3 失败 | test-plan 包含补偿、错误、迁移和合同场景 | `test-plan.md` | 通过计划审阅 |
| A6 文档链接和目录约束通过 | docs 根规则与相对链接检查 | `pnpm docs:check` | 通过 |
| A7 业务实现和回归测试通过 | intake module、route、Schema、合同、补偿和既有 worker fixture 回归测试 | `pnpm typecheck`; `pnpm test`; `pnpm test:integration` | 通过 |
| A8 需求方决策已记录 | 同一 Asset 追加 Snapshot；来源 UUID 不因 Conversation 删除而置空 | `design.md` + ADR-0020 | 通过 |
| A9 维护者批准计划 | 本次会话明确要求从 T1 开始并确认关键决策 | 用户指令 + `task.md` 执行前提 | 已批准进入实现；最终验收仍待 T9 |

## 失败项与遗留问题

- 遗留：需要另立 re-ingest HTTP 变更，实现同一 Data Asset 追加 Snapshot；
- 遗留：需要决定补偿失败是否引入后台清理队列；
- 遗留：数据库迁移不直接调用 S3；部署时需要依据迁移前对象清单清理历史孤儿对象；
- 遗留：T9 仍需维护者执行最终人工验收并决定是否提交；
- 遗留：本次没有 commit，提交方式由维护者在验收后决定。

## 文档同步确认

- [x] proposal、design、task、test-plan、acceptance、handoff 共六份文档已建立；
- [x] 文档使用 `Data Asset`、`Data Snapshot`、`Project`、`Conversation` 等项目术语；
- [x] 计划明确不恢复旧项目级路径，不改变 Project ownership；
- [x] 计划记录对象存储补偿、typed error、Schema 迁移和测试范围；
- [x] 已记录不可变 `sourceConversationId`、允许 Conversation 删除及来源已删除投影；
- [x] 已明确本次不实现 re-ingest HTTP，也不通过新 Data Asset 模拟版本管理；
- [x] `pnpm docs:check` 通过（2026-09-16）；
- [x] 维护者已通过本次会话指令授权从 T1 开始；文档状态已推进到 `VERIFYING`。
- [x] T8 全量验证已完成；隔离 PostgreSQL/MinIO 集成测试通过并已清理专用容器/卷。
- [ ] T9 最终维护者验收完成后，再推进到 `ACCEPTED` 或保留遗留项。

## 验证修复记录

- 首次 `pnpm test:integration` 暴露 `0021_data_asset_intake_lifecycle.sql` 的临时清理表在 statement boundary 后不存在（PostgreSQL `42P01`）；已将清理段收拢为单个 `DO` block。
- 修复后 `pnpm --filter @langreport/db db:verify` 和 `pnpm test:integration` 均通过，说明事务回放与隔离 schema 的逐段迁移执行都可用。
