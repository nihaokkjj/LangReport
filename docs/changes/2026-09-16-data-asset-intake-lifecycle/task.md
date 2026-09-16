# 收拢 Conversation-bound Data Asset intake：任务

- 变更编号：`CHG-2026-09-16-DATA-ASSET-INTAKE`
- 状态：`REVIEWING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 执行前提

- `proposal.md`、`design.md`、`test-plan.md` 已完成并通过项目维护者审核；
- T0 的 Snapshot re-ingest 语义和 Conversation 删除策略已由需求方确认，并记录在 `design.md` 与 ADR-0020；
- 已读取根 `AGENTS.md`、`CONTEXT.md`、第一阶段产品规格、项目基线和 `docs/changes/README.md`；
- 已确认当前工作树存在 Web、DB、contracts 等用户修改；实现只触碰本变更批准的文件；
- 在状态进入 `APPROVED` 前，不开始业务代码实现。

## 任务清单

| ID | 任务 | 依赖 | 可并行 | 负责人 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T0 | 记录已确认的 Snapshot re-ingest 语义与 Conversation 删除策略 | 无 | 否 | Project maintainer | DONE | `design.md` + ADR-0020 审阅 | 同一 Data Asset 最终追加 Snapshot；`sourceConversationId` 不可变非空、允许 Conversation 删除并显示已删除状态 |
| T1 | 收窄 HTTP route adapter，统一 upload/paste command | T0 | 否 | Agent | TODO | `pnpm --filter @langreport/api typecheck` | route 只负责权限、传输解析、command 组装和错误响应；无重复生命周期逻辑 |
| T2 | 深化 Data Asset intake module 并建立 module-private storage seam | T1 | 否 | Agent | TODO | `pnpm --filter @langreport/api typecheck` | 关系校验、key 生成、解析编排和状态流集中在一个 module；生产仍使用现有 S3 adapter |
| T3 | 实现 source/normalized object 补偿和 DB transaction | T2 | 是（可与 T4/T5 设计并行） | Agent | TODO | API unit/integration tests | 任一后续阶段失败会清理已写对象；Snapshot 插入与 `ready` 更新同一 DB transaction |
| T4 | 建立 typed error code、HTTP 映射和安全错误投影 | T2 | 是 | Agent | TODO | API tests + HTTP contract tests | parse、storage、DB、关系错误具有稳定 code；provider 细节不进入响应 |
| T5 | 完成 `sourceConversationId` Schema/数据清理迁移和来源删除状态读模型 | T0/T3 | 是（迁移设计可并行） | Agent | TODO | `pnpm db:verify` + migration/read-model tests | 清理允许丢弃的历史记录/对象；字段非空且不再 `SET NULL`；来源 Conversation 删除后 DTO/审计显示已删除；不恢复旧路径 |
| T6 | 增加 module、route、DB、storage 和合同测试 | T2/T3/T4 | 否 | Agent | TODO | `pnpm --filter @langreport/api test`; `pnpm test` | 覆盖成功、关系错误、解析错误、每个写入失败点、补偿失败和 DTO key 隔离 |
| T7 | 同步架构/产品/变更文档、ADR 与追踪矩阵 | T0/T5/T6 | 是 | Agent | TODO | `pnpm docs:check` | `architecture.md`、必要产品文档、ADR-0020、design/task/acceptance 与实际实现一致 |
| T8 | 运行全量验证并收集验收证据 | T6/T7 | 否 | Agent | TODO | `pnpm typecheck`; `pnpm test`; `pnpm docs:check`; `git diff --check` | 所有必需命令通过，失败项和环境记录到 `acceptance.md` |
| T9 | 维护者验收并决定提交 | T8 | 否 | Project maintainer | TODO | 人工验收 | `acceptance.md` 记录结论，状态推进到 `ACCEPTED` 或保留遗留项 |

## 执行顺序

```text
T0
  → T1
  → T2
  → T3 + T4 + T5（设计完成后可并行实现，但 Schema 迁移必须等待 T0）
  → T6
  → T7
  → T8
  → T9
```

T3、T4、T5 的实现必须遵循 T0 的选择。re-ingest HTTP 操作不属于本次 T1-T8；若实现过程中发现需要改变 Data Snapshot 数据模型，先另立后续变更或回到 `design.md` 更新范围，再继续实现。

## 并行工作流

- T3 可在 T2 的 module seam 稳定后设计补偿和 transaction；
- T4 可独立设计错误 code、HTTP 状态和安全投影；
- T5 可在 T0 已决定后准备迁移检查与历史清理脚本；
- T7 只能在实现行为稳定后落地最终架构描述；
- T6 必须等待 T3/T4，避免测试锁定过时的错误语义。

## 阻塞条件

- 维护者未批准 `proposal.md`、`design.md` 和 `task.md`；
- 无法在迁移中安全移除 `ON DELETE SET NULL` 并保留不可变来源 UUID；
- 历史清理范围无法安全限定在旧项目级对象和无效记录；
- S3/DB 的补偿结果无法被测试或观测；
- 发现需要改变 Data Asset ownership、Generation Job 输入或 LLM 读取契约。

## 回滚或替代方案

- 如果补偿实现风险过高，保留 `failed` 状态并增加清理任务，但不能将对象写入失败伪装为成功；
- 如果 Schema 迁移暂时不能执行，可先拒绝旧/无来源记录并停止生成读取，不能恢复旧项目级路径 fallback；
- 如果 re-ingest 设计未获批准，本次只实现一次 intake 的一致性修复，并将 re-ingest 保留为独立变更；
- 代码回滚只恢复本次 module 实现，不使用破坏性 Git 清理，不触碰用户已有修改。

## Definition of Done

- [ ] proposal/design/task/test-plan 通过人工审核，状态为 `APPROVED`；
- [ ] upload 和 paste 共享同一个 Data Asset intake command；
- [ ] Project/Conversation 关系和 canonical key 在写入前校验；
- [ ] source object、normalized object 和 Snapshot DB 写入具有明确补偿/transaction 语义；
- [ ] typed error code、HTTP 映射和安全错误投影通过测试；
- [ ] `sourceConversationId` Schema 和删除策略与 Snapshot access module 一致；
- [ ] 来源 Conversation 删除后，读模型和审计显示 `sourceConversationDeleted` 或等价状态；
- [ ] 本次没有通过新建 Data Asset 模拟 re-ingest，后续 re-ingest 变更已明确记录；
- [ ] 不生成、不兼容读取旧项目级路径；
- [ ] module、route、DB/storage 和合同测试通过；
- [ ] `pnpm typecheck`、`pnpm test`、`pnpm docs:check`、`git diff --check` 通过；
- [ ] `acceptance.md`、`handoff.md` 和追踪矩阵已更新；
- [ ] 维护者完成验收和 Git 提交决定。
