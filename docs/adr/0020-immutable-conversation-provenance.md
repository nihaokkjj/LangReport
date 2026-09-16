# ADR-0020：保留 Data Asset 的不可变来源 Conversation 标识

- 状态：Accepted
- 日期：2026-09-16
- 关联变更：`CHG-2026-09-16-DATA-ASSET-INTAKE`

## 背景

LangReport 的 Data Asset 属于 Project，但当前对象路径使用来源 Conversation 作为目录命名空间：

```text
workspaces/{workspaceId}/projects/{projectId}/conversations/{conversationId}/user-data/uploads/...
```

现有数据库字段 `data_assets.sourceConversationId` 使用可空 FK 和 `ON DELETE SET NULL`。如果来源 Conversation 被删除，数据库字段会变成 `NULL`，而对象仍然位于旧 Conversation ID 下。Snapshot access module 无法再重建 canonical object key，导致 Project-owned Data Asset 失去可读性。

需求方同时确认：

- Data Asset 的所有权必须继续归 Project；
- 来源 Conversation 可以被删除；
- 删除后仍需要保留来源标识，并在界面和审计中显示“来源 Conversation 已删除”；
- 不恢复旧的项目级 object key，也不把 source Conversation 变成 Data Asset owner。

## 决策

将 `sourceConversationId` 定义为不可变、非空的来源/路径标识，而不是依赖 live Conversation 行存在的所有权关系：

1. 新建 Data Asset 时，intake module 必须验证 `sourceConversationId` 属于当前 Project；
2. 持久化后不允许将该字段置空或改写；
3. 移除 `ON DELETE SET NULL`，允许来源 Conversation 删除时保留 UUID；实现上不保留会阻止删除 Conversation 的 live FK；
4. Data Asset 和 Snapshot 的 canonical key 继续使用这个不可变 UUID；
5. Data Asset 查询和审计通过 left join 或存在性查询派生 `sourceConversationDeleted`（或等价字段）；
6. Snapshot access module 校验 Project、Asset、Snapshot、来源 UUID 和 canonical key，不要求 Conversation 行仍然存在。

该决策不改变 Data Asset ownership。Conversation ID 只是来源、目录隔离和审计信息。

## 选择理由

- 保持 Project-owned Data Asset 在来源 Conversation 删除后仍可读取；
- 不需要把对象迁移到新的项目级路径；
- 不需要实现旧路径 fallback；
- 允许 Conversation 的生命周期独立于 Project 数据资产；
- 与已经确定的 Snapshot access module seam 一致。

## 后果

### 正面后果

- 删除 Conversation 不会让 Snapshot object key 失效；
- 历史 Generation Job、Chart Revision 和 Data Snapshot 可以继续按固定标识读取；
- 用户能明确看到来源 Conversation 已删除，而不是看到一个被静默清空的来源字段；
- Data Asset 仍可被 Project 内其他 Conversation 使用。

### 负面后果

- 数据库不再保证 `sourceConversationId` 对应的 live Conversation 当前存在；
- 需要在读模型和审计中处理“来源已删除”状态；
- intake 必须成为来源关系校验的唯一写入 seam，不能允许任意写入 Data Asset；
- 需要额外的迁移清理 `NULL` 来源、旧项目级 key 和无法重建的历史记录；
- 如果未来需要强引用完整性，应另立变更设计来源快照/审计表，而不能恢复 `SET NULL`。

## 未选择的方案

### `ON DELETE RESTRICT`

它能保持最强 FK 完整性，但会阻止删除仍被 Data Asset 引用的 Conversation，与需求方允许来源 Conversation 删除的决定冲突。它不代表更正确的 ownership，只是把 Conversation 生命周期强制绑定到 Project 数据资产。

### `ON DELETE CASCADE`

它会在删除 Conversation 时删除 Project-owned Data Asset 和 Snapshot，可能破坏其他 Conversation 或历史报告的输入，不符合默认的可追溯要求。

### 将对象路径迁移到 Project/Asset 路径

这会消除 Conversation 删除耦合，但改变当前 Conversation-scoped storage 设计，属于另一个架构变更，不在本次 intake 补偿改造范围内。

## 与 Snapshot re-ingest 的关系

同一 Data Asset 重新上传最终应追加新的 Data Snapshot，但实际 re-ingest HTTP 操作、source object 历史保留和并发版本分配另立变更。本 ADR 不授权通过创建新的 Data Asset 来模拟 Snapshot version。

## 回滚与迁移注意

- 不回滚到 `ON DELETE SET NULL`，否则会重新引入不可读资产；
- 迁移前清理可丢弃的无来源记录和旧项目级对象；
- 迁移失败时保留数据库和对象存储的原状态，不执行破坏性回退；
- 若未来否决本决策，应先设计独立的来源审计记录或对象路径迁移，再修改 Schema。

## 实现记录

`CHG-2026-09-16-DATA-ASSET-INTAKE` 已按本 ADR 落地：Data Asset intake 在写入前校验 Project/Conversation 关系，`data_assets.source_conversation_id` 已改为非空且不再保留 live Conversation FK；PublicDataAsset 通过 `sourceConversationDeleted` 投影来源行是否仍存在。Snapshot access module 继续仅按不可变 UUID 重建 Conversation-scoped canonical key，不要求 Conversation 行仍存在。
