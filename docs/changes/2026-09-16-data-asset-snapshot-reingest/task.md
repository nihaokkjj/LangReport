# Data Asset Snapshot re-ingest：任务

- 变更编号：`CHG-2026-09-16-DATA-ASSET-SNAPSHOT-REINGEST`
- 状态：`ACCEPTED`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 执行前提

- `proposal.md`、`design.md`、`task.md`、`test-plan.md` 已完成并通过维护者设计审核；
- 允许修改 API、contracts、DB schema/迁移、storage key helper、intake、Snapshot access、Web 数据入口和相关测试；
- 保留现有 `apps/web/app/globals.css` 用户修改；
- 不删除或覆盖历史 Snapshot、Chart Revision 或 Approved Revision；
- 本变更不自动匹配同名文件，不引入异步 Data Worker。

## 任务清单

| ID | 任务 | 依赖 | 可并行 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 扩展 contracts 和 API route，增加显式 Snapshot upload/paste 更新入口 | 设计审核 | 否 | DONE | API typecheck/test | 新建与更新接口合同一致，权限和错误映射完整 |
| T2 | 调整 storage helper、DB schema 和迁移，将 source key 移到 Snapshot | 设计审核 | 是 | DONE | db:verify | source object Key 按 Snapshot 隔离，历史元数据可回填，旧 Asset 字段移除 |
| T3 | 重构 intake 支持 new/existing target、版本锁定、更新失败保留旧状态 | T1/T2 | 否 | DONE | API unit/integration | v1→v2，旧 Snapshot/对象保留，补偿和并发安全 |
| T4 | 回归 Snapshot access 和 Generation Job 固定输入读取 | T2/T3 | 是 | DONE | worker tests/integration | v1 Job 不因 v2 上传改变，v1/v2 normalized object 均可读 |
| T5 | 更新 Web 数据入口，提供“导入文件/更新当前数据”显式动作 | T1/T3 | 是 | DONE | web typecheck/e2e | UI 不自动猜测 Asset，成功/失败/加载状态可用 |
| T6 | 补充单元、HTTP、迁移、集成和 E2E 测试 | T1-T5 | 否 | DONE | 根级测试集合 | 覆盖验收矩阵和并发/补偿风险 |
| T7 | 同步领域/架构/产品引用、ADR 和验收文档 | T2/T3 | 是 | DONE | docs:check | 文档不再描述“re-ingest 后续实现”或旧 source key |
| T8 | 全量验证、人工验收和交接 | T6/T7 | 否 | DONE | typecheck/test/db/docs/diff | 证据记录完整，未引入无关文件 |

## 执行顺序

```text
设计审核
  → T1 + T2
  → T3
  → T4 + T5
  → T6
  → T7
  → T8
```

## 阻塞条件

- 维护者未批准设计文档；
- 历史 Snapshot 无法安全回填 source key；
- 无法在不覆盖旧对象的前提下实现 source Key；
- 并发更新无法保证 `(assetId, version)` 唯一；
- 发现需要改变 Generation Job 或 Chart Revision 的 Snapshot 固定输入合同。

## 回滚或替代方案

- 若 UI 更新入口延期，API 和 intake 可先完成，但不能把新上传静默归并到 Asset；
- 若无法删除 `data_assets.object_key`，可暂时保留兼容列，但新 Snapshot 必须写入自己的 `sourceObjectKey`，并在文档中标明过渡状态；
- 若迁移验证失败，停止发布，不使用旧字段覆盖新字段或删除历史 Snapshot。

## Definition of Done

- [x] 新建入口仍创建新的 Data Asset + Snapshot v1；
- [x] 更新入口在同一 Asset 下创建 Snapshot v2/vN；
- [x] source object 使用 Snapshot-scoped Key；
- [x] normalized object 和 Snapshot access 读取合同保持可验证；
- [x] 更新失败保留旧 Asset、旧 Snapshot 和旧 Job 可用；
- [x] 并发更新不产生重复版本或对象覆盖；
- [x] 前端显式区分新建与更新；
- [x] API、DB、Worker、Web 测试通过；
- [x] 迁移、架构、验收和 handoff 文档同步；
- [x] `git diff` 仅包含本变更和原有 CSS 修改。
