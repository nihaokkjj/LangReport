# 收拢 Conversation-bound Data Asset intake：提案

- 变更编号：`CHG-2026-09-16-DATA-ASSET-INTAKE`
- 状态：`VERIFYING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 背景

第一阶段的用户会在一个 Project 中上传文件或粘贴表格，系统需要生成可追溯的 Data Asset 和不可变 Data Snapshot，供后续 Generation Job 使用。当前 upload 和 paste route 已经汇聚到 `ingestDataAsset`，但 PostgreSQL、对象存储和解析流程的失败语义还没有形成完整的 intake module。

当前流程由 [apps/api/src/routes.ts](../../../apps/api/src/routes.ts) 和 [apps/api/src/data-assets.ts](../../../apps/api/src/data-assets.ts) 共同完成：先写入 `processing` Data Asset，再解析数据、写入两个对象、写入 Snapshot 元数据，最后标记 `ready`。

## 要解决的问题

1. S3 写入与 PostgreSQL 写入不是一个事务；后续步骤失败时可能留下孤儿对象，且失败状态没有记录补偿结果。
2. `sourceConversationId` 在 intake 中被要求存在，但数据库允许 `NULL` 并使用 `ON DELETE SET NULL`，与 Conversation-scoped object key 和 Snapshot access module 的读取前提冲突。
3. 存储故障、数据库故障和用户输入错误都可能被映射为 `400 INVALID_INPUT`，不利于用户处理和审计。
4. `ingestDataAsset` 的 interface 看似单一，但 DB、解析器、对象存储和 key 生成器都被直接绑定，缺少可测试的显式 seam。
5. 当前一次 intake 仍生成一个新的 Data Asset；产品方向要求同一 Data Asset 的重新上传追加 Snapshot，但该 HTTP 操作不属于本次 intake 补偿改造。

## 目标用户与使用场景

目标用户是 Project 成员和负责生成流程的系统。主要场景是：

1. 成员从当前 Conversation 上传 CSV、XLSX 或 JSON 文件；
2. 成员在当前 Conversation 粘贴表格内容；
3. 系统验证 Project 和来源 Conversation 关系，生成 Data Asset 与 Data Snapshot；
4. 后续 Generation Worker 按已固化的 Snapshot 标识读取结构化 rows 和 profiles。

## 需求范围

### MVP

1. 保留一个 Data Asset intake module，统一 upload 和 paste 的领域输入。
2. 将 Project/Conversation 关系校验、canonical object key 生成、解析、DB 状态流转和对象补偿集中在该 module。
3. 在 module 内设置最小的对象存储 callback seam；生产环境继续使用唯一的 S3 adapter，单元测试使用内存 callback。
4. 为 source object、normalized snapshot object、Snapshot DB 写入和 `ready` 状态更新定义成功、失败和补偿语义。
5. 引入可审计的 typed error code，并区分用户输入错误、对象存储故障和数据库故障。
6. 将 `sourceConversationId` 作为不可变、非空的来源标识保存；不使用 `ON DELETE SET NULL`，允许来源 Conversation 删除，并在读模型和审计中显示“来源 Conversation 已删除”。迁移清理可丢弃的旧项目级元数据及其对象引用，不保留旧路径兼容读取；部署运维仍需按对象存储清单清理历史孤儿对象。
7. 增加 intake module 的成功、关系校验、解析失败、各阶段写入失败和补偿测试。

### 后续范围

1. 另立 Snapshot re-ingest 变更，实现“同一 Data Asset 重新上传产生新 Snapshot”，包含 source object 的历史保留方式和数据模型迁移。本次不通过创建新的 Data Asset 来模拟该能力。
2. 为用户重试增加 Data Asset intake 的 idempotency key。
3. 采用流式上传以降低大文件的内存峰值。
4. 当出现第二个真实对象存储 adapter 时，再将 callback 提升为正式的跨包 interface。

## 明确不做

- 不改变 Data Asset 的 Project ownership；`sourceConversationId` 只表示来源、目录隔离和审计。
- 不把 Generation Job 的 Conversation 强制绑定为 Data Asset 的来源 Conversation。
- 不修改 Snapshot access module 已建立的“只返回 rows、profiles 和标识”的读取契约。
- 不引入向量化、LLM 文件工具、跨文件 Join、Dashboard 或通用 BI 能力。
- 不保留旧的项目级对象路径，也不增加旧路径 fallback。
- 不在本次变更中引入通用 StoragePort、第二个 S3 adapter 或新的部署单元。
- 不在本次变更中实现已有 Data Asset 的 re-ingest HTTP 操作，也不通过新建 Data Asset 模拟版本管理。
- 不顺手重构无关的 Web、Generation Worker、Render Worker 或用户已有工作树修改。

## 成功指标

1. 任一对象写入或 Snapshot DB 写入失败后，已成功写入的对象会被补偿删除；补偿失败可被审计。
2. 只有 Project 内合法来源 Conversation 的 intake 才能进入 `processing`；`ready` Data Asset 必须具有可重建的 Conversation-scoped key。
3. 用户输入错误、存储故障和持久化故障具有稳定错误码与正确的 HTTP 状态映射。
4. intake module 的单元测试不依赖真实 S3，并覆盖主要失败路径。
5. PublicDataAsset 和 HTTP 响应不暴露原始 object key 或底层 provider 错误。
6. Snapshot 生命周期语义在实现前得到明确选择，并与第一阶段产品规格、数据库 Schema 和 HTTP 合同一致。

## 假设、依赖与风险

- 假设：当前只有一个真实 S3 adapter；`packages/storage` 的 `putObject`、`getObject`、`deleteObject` 继续作为生产 adapter。
- 依赖：`CONTEXT.md`、第一阶段产品规格、Data Asset 数据库 Schema、Snapshot access module 和 `pnpm` 验证脚本。
- 风险：S3 与 PostgreSQL 无法参与同一个原子事务，必须采用补偿和可观测性，而不是假设跨系统 commit。
- 风险：去除 Conversation FK 后，数据库不再保证来源 Conversation 当前存在；必须在 intake 时完成 Project 关系校验，并在读模型和审计中处理“来源 Conversation 已删除”。
- 风险：重新处理同一 Data Asset 需要决定原始文件对象是否按 Snapshot 保留，可能触发额外 Schema 迁移。

## 已确认决策与剩余问题

1. 同一 Data Asset 的重新上传最终追加新的 Data Snapshot；实际 re-ingest HTTP 操作另立变更，本次不实现。
2. `sourceConversationId` 为不可变、非空来源标识；不使用 `ON DELETE SET NULL`，允许 Conversation 删除，并显示来源已删除状态。
3. 剩余问题：补偿失败是否只写审计事件，还是需要额外的清理队列和后台重试？

## 验收标准概要

1. upload 和 paste 都通过同一 intake module 完成 Project/Conversation 校验、解析和持久化。
2. source object、normalized object、Snapshot 元数据和 Data Asset 状态之间的成功/失败/补偿路径有自动化测试。
3. 失败响应不会把 S3 key 或 provider 错误当作 `400 INVALID_INPUT` 返回。
4. `sourceConversationId` 的 Schema、HTTP DTO、canonical key 和 Snapshot access 前提一致。
5. 已确认的生命周期决策、变更范围和回滚方案记录在对应 SDD/ADR 文档中，未经过审核不得开始业务代码实现。
