# 收拢 Conversation-bound Data Asset intake：验收记录

- 变更编号：`CHG-2026-09-16-DATA-ASSET-INTAKE`
- 状态：`REVIEWING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 验收结论

- 结论：`PARTIAL`
- 验收时间：2026-09-16
- 验证 commit：`未提交（计划阶段）`

本次只生成 SDD 修改计划，尚未进入 `APPROVED`、`IMPLEMENTING` 或业务代码验证阶段。因此不能把运行时行为描述为已完成。

## 验收证据

| 标准 | 证据 | 命令或文件 | 结果 |
| --- | --- | --- | --- |
| A1 变更目录和六份 SDD 文档齐全 | proposal/design/task/test-plan/acceptance/handoff 已建立 | `docs/changes/2026-09-16-data-asset-intake-lifecycle/` | 通过 |
| A2 目标、非目标和已确认决策明确 | proposal 中记录 re-ingest 后续变更和不可变来源策略 | `proposal.md` | 通过文档审阅 |
| A3 数据流、失败路径和模块 seam 可执行 | design 覆盖 route、intake、parser、storage、DB、Snapshot access | `design.md` | 通过文档审阅 |
| A4 任务依赖和完成标准可判断 | task 包含 T0-T9、依赖、命令和 Definition of Done | `task.md` | 通过文档审阅 |
| A5 测试能覆盖跨 PostgreSQL/S3 失败 | test-plan 包含补偿、错误、迁移和合同场景 | `test-plan.md` | 通过计划审阅 |
| A6 文档链接和目录约束通过 | docs 根规则与相对链接检查 | `pnpm docs:check` | 通过 |
| A7 业务实现和回归测试通过 | 需要 T0 审核后执行 T1-T8 | `pnpm typecheck`; `pnpm test`; API/DB/集成测试 | 未开始 |
| A8 需求方决策已记录 | 同一 Asset 追加 Snapshot；来源 UUID 不因 Conversation 删除而置空 | `design.md` + ADR-0020 | 通过 |
| A9 维护者批准计划 | 需要确认 SDD 设计、迁移和实现范围 | 人工审核 | 未完成 |

## 失败项与遗留问题

- 遗留：需要维护者审核 `proposal.md`、`design.md` 和 `task.md`；
- 遗留：需要另立 re-ingest HTTP 变更，实现同一 Data Asset 追加 Snapshot；
- 遗留：需要决定补偿失败是否引入后台清理队列；
- 遗留：未运行业务代码、数据库或对象存储测试，因为本次没有实现代码变更；
- 遗留：本次没有 commit，提交方式由维护者在验收后决定。

## 文档同步确认

- [x] proposal、design、task、test-plan、acceptance、handoff 共六份文档已建立；
- [x] 文档使用 `Data Asset`、`Data Snapshot`、`Project`、`Conversation` 等项目术语；
- [x] 计划明确不恢复旧项目级路径，不改变 Project ownership；
- [x] 计划记录对象存储补偿、typed error、Schema 迁移和测试范围；
- [x] 已记录不可变 `sourceConversationId`、允许 Conversation 删除及来源已删除投影；
- [x] 已明确本次不实现 re-ingest HTTP，也不通过新 Data Asset 模拟版本管理；
- [x] `pnpm docs:check` 通过（2026-09-16）；
- [ ] 维护者审核后同步状态为 `APPROVED`，实现/验证结束后再推进后续状态。
