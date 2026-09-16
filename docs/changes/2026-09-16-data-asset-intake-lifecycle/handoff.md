# 收拢 Conversation-bound Data Asset intake：交接

- 变更编号：`CHG-2026-09-16-DATA-ASSET-INTAKE`
- 状态：`REVIEWING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 当前状态

已完成 Data Asset intake 改造的 SDD 计划文档，当前停留在 `REVIEWING`。本次没有修改业务代码、数据库 Schema、HTTP 合同或对象存储对象。

## 已完成

- [proposal.md](./proposal.md)：定义跨 PostgreSQL/S3 补偿、来源关系、错误分类和明确不做范围；
- [design.md](./design.md)：定义 module 边界、command seam、状态流、数据流、迁移和测试策略；
- [task.md](./task.md)：拆解 T0-T9 任务、依赖、并行关系和 Definition of Done；
- [test-plan.md](./test-plan.md)：覆盖成功、失败、补偿、权限、迁移和合同测试；
- [acceptance.md](./acceptance.md)：保留计划阶段的 PARTIAL 验收记录；
- 本文件：记录审核前的下一步和工作树范围。

## 进行中

- T0：已完成，需求方确认 Snapshot re-ingest 方向和不可变来源策略；
- T1-T9：等待 SDD 人工审核，未授权业务代码实现；
- 后续 re-ingest HTTP 变更需要另立 SDD 记录。

## 下一步

1. 审阅 [proposal.md](./proposal.md)、[design.md](./design.md) 和 [ADR-0020](../../../docs/adr/0020-immutable-conversation-provenance.md) 的方案与迁移影响；
2. 将审核结论和遗留问题写入 `acceptance.md`；
3. 若批准，将六份文档状态推进到 `APPROVED`；
4. 按 [task.md](./task.md) 先执行 T1/T2，再实现补偿、错误映射、迁移和测试；
5. 每完成一组任务更新本文件、`acceptance.md` 和需求追踪矩阵。

## 当前 commit 与修改范围

- 当前基线：以工作树现有 HEAD 为准，未创建本变更 commit；
- 本次新增范围：仅限 `docs/changes/2026-09-16-data-asset-intake-lifecycle/` 六份 SDD 文档；
- 工作树中原有的 Web、DB、contracts、domain 等未提交修改已保留，未被本次计划覆盖；
- 不应使用破坏性 Git 命令清理或回退这些用户修改。

## 已运行验证

- `pnpm docs:check`：通过（2026-09-16）；
- `git diff --check`：通过（2026-09-16）；
- 未运行 `pnpm typecheck`、`pnpm test`、数据库或集成测试，因为本次尚未进入实现阶段。

## 已确认决策

- Data Asset 继续 Project-owned；`sourceConversationId` 只表示来源、目录隔离和审计；
- 不生成、不兼容读取旧项目级 object key，历史数据可以清理；
- 保留现有唯一 S3 adapter；测试使用 module-private memory callbacks；
- Snapshot access module 继续是生成侧唯一的冻结快照读取 seam；
- 不在本次计划中引入 LLM 文件工具、向量化或通用 StoragePort。
- 同一 Data Asset 的重新上传最终追加 Snapshot，但实际 re-ingest HTTP 操作另立变更；本次不创建新 Data Asset 模拟版本；
- `sourceConversationId` 为不可变、非空来源标识，不使用 `ON DELETE SET NULL`；Conversation 删除后读模型/审计显示来源已删除，Data Asset 仍归 Project 所有。

## 已知问题与未决问题

- 后续 re-ingest 需要设计每个 Snapshot 的 source object 历史保留和并发版本分配；
- 去除 live FK 后需要在迁移和读模型中防止错误 Project 关系与来源 UUID 污染；
- 补偿失败是否需要后台清理队列尚未决定；
- 这些决策如果改变数据模型，必须先回到 `design.md` 和追踪矩阵重新规划。

## 新会话启动必读

1. [AGENTS.md](../../../AGENTS.md)
2. [CONTEXT.md](../../../CONTEXT.md)
3. [docs/project-spec.md](../../../docs/project-spec.md)
4. [docs/product/phase1-consulting-report.md](../../../docs/product/phase1-consulting-report.md)
5. [docs/changes/README.md](../../README.md)
6. 本目录的 `proposal.md`、`design.md`、`task.md`、`test-plan.md`、`acceptance.md`
