# 收拢 Conversation-bound Data Asset intake：交接

- 变更编号：`CHG-2026-09-16-DATA-ASSET-INTAKE`
- 状态：`VERIFYING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 当前状态

已完成 Data Asset intake 改造的 T1-T8 实现与验证，当前停留在 `VERIFYING`，等待 T9 维护者最终验收。现有 Web 工作树修改已保留，未纳入本次变更。

## 已完成

- [proposal.md](./proposal.md)：定义跨 PostgreSQL/S3 补偿、来源关系、错误分类和明确不做范围；
- [design.md](./design.md)：定义 module 边界、command seam、状态流、数据流、迁移和测试策略；
- [task.md](./task.md)：拆解 T0-T9 任务、依赖、并行关系和 Definition of Done；
- [test-plan.md](./test-plan.md)：覆盖成功、失败、补偿、权限、迁移和合同测试；
- [acceptance.md](./acceptance.md)：记录当前实现、验证证据、PARTIAL 结论和 T9 遗留项；
- 本文件：记录 T8 验证入口、工作树范围和后续 re-ingest 边界。

## 进行中

- T0：已完成，需求方确认 Snapshot re-ingest 方向和不可变来源策略；
- T1：已完成 route adapter 收窄和 upload/paste command 归一化；
- T2-T4：已完成 intake module、module-private storage callbacks、对象补偿、Snapshot transaction、typed error 和安全 HTTP 投影；
- T5：已完成 `sourceConversationId` 非空/移除 live FK 的迁移、历史无效元数据清理和来源删除读模型；
- T6：已完成 module、HTTP error、合同、迁移和既有 integration fixture 回归测试；
- T7：已同步架构、领域模型、ADR、追踪矩阵和验收文档；
- T8：已完成根级 typecheck、offline test、docs check、diff check 和隔离 PostgreSQL/MinIO integration test；T9 仍由 Project maintainer 执行；
- 后续 re-ingest HTTP 变更需要另立 SDD 记录。

## 下一步

1. 由 Project maintainer 执行 T9 人工验收，决定是否进入 `ACCEPTED` 以及是否提交；
2. 后续另立 re-ingest 变更，实现同一 Data Asset 追加 Data Snapshot，不在本变更中补做 HTTP endpoint；
3. 部署时按迁移前对象清单处理历史 S3 孤儿对象，并另行决定是否增加补偿失败后台清理队列。

## 当前 commit 与修改范围

- 当前基线：以工作树现有 HEAD 为准，未创建本变更 commit；
- 本次实现范围：API Data Asset intake、contracts DTO、DB Schema/迁移验证、API/合同/既有 integration fixture 测试，以及架构/ADR/变更文档；
- 工作树中原有的 Web 修改已保留，未被本次变更覆盖；本次必要的 DB/contracts 文件修改属于变更实现范围；
- 不应使用破坏性 Git 命令清理或回退这些用户修改。

## 已运行验证

- 已通过：`pnpm --filter @langreport/api typecheck`、`pnpm --filter @langreport/api test:typecheck`、`pnpm --filter @langreport/api test`；
- 已通过：`pnpm --filter @langreport/db typecheck`、`pnpm --filter @langreport/db db:verify`；
- 已通过：`pnpm --filter @langreport/contracts test`、`pnpm --filter @langreport/contracts test:typecheck`、`git diff --check`；
- 已通过：根级 `pnpm typecheck`、`pnpm test`、`pnpm docs:check`、`git diff --check` 和 `pnpm test:integration`；首次集成运行发现并修复迁移 statement-boundary 问题，详见 `acceptance.md`。

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
- 补偿失败目前写入审计事件并保留 failed 记录；是否增加后台清理队列尚未决定；
- 迁移不直接调用 S3，历史对象清理需要部署步骤按迁移前对象清单执行；
- 这些决策如果改变数据模型，必须先回到 `design.md` 和追踪矩阵重新规划。

## 新会话启动必读

1. [AGENTS.md](../../../AGENTS.md)
2. [CONTEXT.md](../../../CONTEXT.md)
3. [docs/project-spec.md](../../../docs/project-spec.md)
4. [docs/product/phase1-consulting-report.md](../../../docs/product/phase1-consulting-report.md)
5. [docs/changes/README.md](../../README.md)
6. 本目录的 `proposal.md`、`design.md`、`task.md`、`test-plan.md`、`acceptance.md`
