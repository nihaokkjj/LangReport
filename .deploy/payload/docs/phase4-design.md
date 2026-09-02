# Phase 4：三层记忆设计与实施方案

## 1. 阶段目标

README 定义的产品闭环是“数据输入 → 数据画像 → TransformPlan → Flint Spec → 可编辑图表 → Revision → 协作”。MVP 路线的 Phase 4 不改变这条主链路，而是为生成过程增加可控的长期上下文：

```text
Conversation Message
        ↓
Conversation Memory（当前对话临时上下文）
        ↓ 提取
Memory Candidate（等待确认）
        ↓ 用户明确接受并选择作用域
Project Memory / Workspace Memory（已确认长期事实）
        ↓ 检索
Generation Job / Chart Revision
```

阶段 4 的核心原则来自 `docs/architecture.md`、`docs/domain-model.md` 和 ADR 0004：

- 未确认的候选不能参与长期记忆检索。
- Project Memory 优先于 Workspace Memory，但冲突必须展示来源，不能静默覆盖。
- Project Memory 永远不会因为模型建议或项目成员操作自动升级为 Workspace Memory。
- 每条长期记忆都要保留来源、创建人、更新时间、置信度和删除状态。
- 生成时实际使用的记忆版本要进入 Generation Job 和 Chart Revision 的追溯信息。

## 2. 当前代码基线与范围

当前仓库已经具备：

- `conversations`、`conversation_messages`，可保存对话及消息；
- `audit_events`，可复用为记忆确认、拒绝、删除等操作的追加式审计日志；
- `getProjectAccess()`、`assertChartAction()` 和 Workspace/Project 角色隔离；
- Generation Worker、Render Worker 和不可变 Chart Revision；
- `packages/contracts`、`packages/domain`、`packages/db`、`packages/chart` 的分层基础。

当前尚未具备：

- Conversation Memory 快照；
- Memory Candidate、Project/Workspace Memory 表；
- 记忆候选提取任务；
- 记忆检索和冲突解析；
- 生成任务与 Chart Revision 的记忆快照；
- 面向候选确认和记忆管理的 API/Web 界面。

Phase 4 不做向量数据库、自动学习用户画像、跨 Workspace 共享记忆、自动记忆升级、任意模型供应商直连或基于记忆的自动写库。MVP 先使用确定性的 key/category/关键词匹配，后续再增加语义检索。

## 3. 领域模型

### 3.1 Conversation Memory

Conversation Memory 是一个 Conversation 级的可更新上下文快照，不是长期事实。建议新增 `conversation_memory_snapshots`：

- `conversation_id`：唯一，一对一绑定 Conversation；
- `project_id`、`workspace_id`：冗余保存，便于作用域查询和审计；
- `summary`：当前对话摘要；
- `facts`：当前对话中已确认或正在讨论的约束、术语、未决问题，使用受限 JSON Schema；
- `source_through_message_id`：摘要覆盖到的最后一条消息；
- `version`、`updated_at`：用于并发控制和生成追溯。

对话原文仍以 `conversation_messages` 为准。摘要失效时，系统回退到最近若干条消息。删除 Conversation 时级联删除该快照。快照可以进入当前对话的模型上下文，但不得进入 Project/Workspace 长期记忆检索结果。

### 3.2 Memory Candidate

Memory Candidate 是模型从 Conversation 中提取的候选事实，用户确认前始终是临时对象。建议字段：

- `id`、`workspace_id`、`project_id`、`conversation_id`；
- `source_message_ids`：产生候选的消息 ID 列表；
- `statement`：用户可读的事实描述，例如“收入按不含税金额计算”；
- `memory_key`：稳定的规范化键，例如 `metric.revenue.calculation`；
- `memory_type`：指标定义、数据口径、业务规则、术语、图表偏好等；
- `value`：结构化值，用于确定性比较；
- `scope_hint`：模型建议的 `project` 或 `workspace`，只是提示，不代表最终作用域；
- `confidence`、`extractor_version`；
- `status`：`proposed`、`accepted`、`rejected`；
- `reviewed_by`、`reviewed_at`、`rejection_reason`、`target_memory_id`；
- `created_at`、`updated_at`。

候选应使用 `conversation_id + source_message_ids + candidate_fingerprint` 做幂等去重。候选被接受后，事务中创建或更新一个长期 Memory，并把 `target_memory_id` 写回候选；候选本身不直接参与生成检索。

### 3.3 长期 Memory

Project Memory 和 Workspace Memory 可以共用一张 `memories` 表，通过 `scope` 区分，减少两套生命周期代码：

- `scope`：`project` 或 `workspace`；
- `workspace_id`：必填；
- `project_id`：Project 作用域必填，Workspace 作用域必须为空；
- `memory_key`、`memory_type`、`statement`、`value`；
- `status`：`active`、`superseded`、`deleted`；
- `version`：同一作用域和 key 的版本号；
- `source_candidate_id`、`source_conversation_id`、`source_message_ids`；
- `created_by`、`updated_by`、`created_at`、`updated_at`；
- `confidence`；
- `deleted_by`、`deleted_at`、`superseded_by`。

不要对 `scope + memory_key` 建立“只能有一条 active 记录”的硬唯一约束，因为冲突记忆必须能被保存、展示和审计。通过服务层检测同 key 的不同规范化值，并在需要时显式执行 supersede。数据库仍应增加作用域、状态、key 和时间索引。

### 3.4 记忆提取任务

候选提取不要阻塞图表生成请求。建议增加 `memory_extraction_jobs`：

- 绑定 `conversation_id` 和触发消息范围；
- 状态为 `queued`、`processing`、`succeeded`、`failed`；
- 保存 `idempotency_key`、`attempt_count`、`extractor_version` 和错误信息；
- 以 `conversation_id + source_through_message_id + extractor_version` 保证重复投递不会重复产生候选。

提取器通过 Model Gateway 调用模型，只发送必要的对话文本、Conversation Memory 和已确认的相关记忆，不发送完整原始数据。若 Model Gateway 暂不可用，任务失败应可重试，不应把候选标记为已生成。

## 4. 作用域、权限和冲突语义

### 4.1 作用域优先级

一次生成的上下文按以下顺序组装：

1. 当前 Conversation 的最近消息和 Conversation Memory；
2. 当前 Project 的 active Project Memory；
3. 所属 Workspace 的 active Workspace Memory。

长期记忆的优先级是 `Project > Workspace`。同 key 且 value 相同的记录可以合并展示；同 key 且 value 不同的记录必须返回冲突对象，包含每条记忆的来源 Conversation、创建人、更新时间、版本和置信度。Project 优先只代表默认解析顺序，不代表可以隐藏 Workspace 来源。

建议检索服务返回明确结构：

```ts
type MemoryContext = {
  conversation: { summary: string; facts: unknown; version: number } | null;
  project: MemoryReference[];
  workspace: MemoryReference[];
  conflicts: Array<{
    memoryKey: string;
    records: MemoryReference[];
    requiresDecision: boolean;
  }>;
};
```

MVP 不让模型自行选择冲突值。生成上下文应把冲突标记为“需要用户确认”的结构化信息；如果冲突直接影响当前指标口径，可以在生成前返回可解释的冲突提示，要求用户选择。无关冲突可以继续生成，但必须保留冲突信息，不能静默丢弃其中一条。

### 4.2 权限

- Project Memory：Project Editor、Workspace Owner/Admin 可以确认、删除和管理；Reviewer/Viewer 只能按项目读取有效记忆（若产品需要可进一步隐藏内容）。
- Workspace Memory：只有 Workspace Owner/Admin 可以确认、删除和管理；普通 Project Editor 可以提出候选，但不能把候选写入 Workspace Memory。
- 候选的 `scope_hint` 不会授予权限，也不会决定最终作用域；接受接口必须由用户明确提交 `targetScope`。
- 所有 Memory、Candidate、Conversation 和来源消息查询都必须同时校验 Workspace/Project 归属。跨 Workspace 的 ID 查询统一返回 404 或明确的无权限错误，不能泄露存在性。

领域层新增 `view_memory`、`manage_project_memory`、`manage_workspace_memory`、`review_memory_candidate` 等动作，路由和 Worker 不直接复制角色判断。

## 5. 生成链路接入

### 5.1 对话写入

现有创建 Conversation 和追加 `conversation_messages` 的路径需要统一进入 `ConversationMemoryService`：

1. 先写入原始消息；
2. 更新 Conversation 的 `updated_at`；
3. 创建或更新 Conversation Memory 快照；
4. 投递一次幂等的 Memory Extraction Job；
5. 返回对话或 Generation Job，不等待候选提取完成。

### 5.2 Generation Worker

Generation Worker 在 `profiling/planning` 前调用 `MemoryRetrievalService`：

1. 根据 `workspace_id`、`project_id`、`conversation_id` 和用户 prompt 查找相关已确认记忆；
2. 限制条数、字符数和单条内容长度，避免记忆无限增长；
3. 检测同 key 冲突并生成 `MemoryContext`；
4. 将 Conversation Memory、Project Memory、Workspace Memory 分区传给 Model Gateway/生成器；
5. 把实际使用的记忆 ID、scope、version、content hash 和冲突信息写入 `generation_jobs.memory_context`；
6. 将同一份不可变 `memory_snapshot` 写入 Chart Revision。

`generation_jobs.input_fingerprint` 必须包含已解析的记忆版本或内容 hash。记忆发生变化后，相同 prompt、Snapshot 和 Theme 不得错误复用旧 Job。Chart Revision 的 `memory_snapshot` 至少应包含：

```json
[
  { "id": "...", "scope": "project", "key": "metric.revenue.calculation", "version": 2, "contentHash": "..." }
]
```

删除长期记忆时不修改历史 Chart Revision；历史 Revision 仍显示它当时使用过的记忆 ID/版本，若原记忆已删除则显示“记忆已删除”。是否保存完整 statement 应根据后续隐私要求决定，MVP 默认保存引用、版本和 hash，避免不必要地复制敏感文本。

## 6. 推荐实现步骤

### Step 1：冻结契约和领域不变量

在 `packages/contracts` 定义：

- Memory scope、type、candidate status、memory status；
- Candidate、Memory、MemoryContext 的 Zod Schema；
- 接受、拒绝、删除请求及 `targetScope`、`expectedVersion`、幂等键；
- 冲突响应结构。

在 `packages/domain` 定义：

- Candidate 和 Memory 状态转换；
- 角色到记忆动作的能力矩阵；
- memory key/value 规范化和 fingerprint；
- 作用域校验、冲突分组和 Project 优先解析；
- 已删除或 superseded 记录不得进入检索。

完成标准：所有路由、Worker 和服务都引用同一套 schema；关键不变量有纯单元测试。

### Step 2：增加 Drizzle Schema 和迁移

在 `packages/db/src/schema.ts` 增加枚举、四类表和必要索引；在 `generation_jobs` 增加 `memory_context`，在 `chart_revisions` 增加 `memory_snapshot`。当前迁移序列到 `0004`，本阶段生成下一份可审查迁移（预计为 `0005`），不要直接依赖 `db:push`。

迁移必须覆盖：

- 外键和级联策略；
- Project/Workspace scope 的 check 约束；
- Candidate fingerprint 唯一索引；
- Memory 的 scope/status/key 查询索引；
- 同一 Candidate 的接受结果和版本更新所需字段；
- Generation Job/Revision 的 JSON Schema 兼容默认值，确保历史阶段 2/3 数据仍可读取。

### Step 3：实现 Memory Repository 和服务层

新增 `packages/memory`，至少包含：

- `ConversationMemoryService`：快照读写和消息游标；
- `MemoryCandidateService`：提取结果落库、列表、接受、拒绝；
- `MemoryService`：按作用域读取、删除、supersede 和版本控制；
- `MemoryRetrievalService`：确定性检索、限额、去重和冲突返回；
- `MemoryAuditService`：复用 `audit_events` 写追加式事件。

所有 Repository 方法都接收 `workspaceId`，Project 方法还必须接收 `projectId`，避免把只接收 `memoryId` 的无作用域查询暴露给 API。接受/删除操作使用事务和行锁或 `expectedVersion`，防止两个用户同时确认、覆盖或删除不同版本。

接受 Candidate 的事务顺序建议是：

1. 锁定 Candidate 并确认仍为 `proposed`；
2. 校验用户对 `targetScope` 的权限；
3. 查询同 scope、同 key 的 active 记录并计算冲突；
4. 无冲突时创建新 Memory；
5. 有冲突时要求显式 resolution，例如保留旧值、采用候选并 supersede 旧值，不能静默覆盖；
6. 更新 Candidate 为 `accepted`，写入 `target_memory_id`；
7. 写入 `memory_candidate.accepted`、`memory.created` 或 `memory.superseded` 审计事件。

重复接受应返回已有结果；已 rejected/accepted 的 Candidate 不允许被另一个请求改写。

### Step 4：实现提取 Worker

在 Generation Worker 之外增加独立的记忆提取轮询，或在现有 Worker 中增加明确的提取处理函数，但不能把提取状态混入图表 Generation Job。流程为：

```text
新消息
  ↓
Memory Extraction Job
  ↓
读取 Conversation Memory + 消息
  ↓
Model Gateway 提取结构化 Candidate
  ↓
Schema 校验 / fingerprint 去重
  ↓
写入 proposed Candidate
```

模型输出只能写入 `proposed` 候选，不能直接写入长期 Memory。解析失败、未知 memory type、超过长度限制或来源消息不存在时，任务失败并保留错误信息。

### Step 5：接入 Generation Job 和 Chart Revision

在 API 创建 Generation Job 时记录 Conversation；在 Worker 生成前检索 Memory Context，并把其 fingerprint 纳入幂等输入。Render Worker 创建 Revision 时把 Job 的 memory context 转成不可变 `memory_snapshot`。

需要保证：

- 记忆检索只返回 `active` 的已确认 Memory；
- Candidate、deleted、superseded 记录不会进入模型上下文；
- 历史 Revision 的 memory snapshot 不会随着当前 Memory 修改而改变；
- 生成失败不会创建带有“成功”状态的 Revision；
- 记忆服务失败时生成任务要有明确错误分类，不能悄悄退化成无记忆生成。

### Step 6：增加 API

建议的最小 API：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/conversations/:conversationId/memory` | 查看当前 Conversation Memory |
| `GET` | `/api/v1/projects/:projectId/memory-candidates` | 查看待确认候选 |
| `POST` | `/api/v1/memory-candidates/:candidateId/accept` | 明确接受并选择 Project/Workspace 作用域 |
| `POST` | `/api/v1/memory-candidates/:candidateId/reject` | 拒绝候选并保存原因 |
| `GET` | `/api/v1/projects/:projectId/memories` | 查看项目有效记忆和冲突 |
| `GET` | `/api/v1/workspaces/:workspaceId/memories` | 管理员查看工作区记忆 |
| `DELETE` | `/api/v1/memories/:memoryId` | 软删除长期记忆 |
| `GET` | `/api/v1/chart-revisions/:revisionId/memory-context` | 查看该 Revision 使用的记忆快照 |

接受请求不能只传 `candidateId`，至少需要 `targetScope`、`idempotencyKey`，发生冲突时还需要 `resolution` 和 `expectedVersion`。资源详情返回来源链接、创建人、更新时间、置信度、当前状态和冲突记录。

### Step 7：实现 Web 体验

在现有 Project 工作区中增加“项目记忆”面板，并提供：

- 待确认候选列表：事实描述、来源对话/消息、置信度、建议作用域；
- 接受操作：明确选择“仅本项目”或“整个工作区”，Workspace 选项对无权限用户禁用；
- 拒绝操作：可填写原因；
- 有效记忆列表：scope、key、内容、来源、创建人、更新时间和状态；
- 冲突视图：并排展示 Project/Workspace 的来源和版本，并要求用户选择；
- 删除确认和“已删除/已被新版本替代”的历史状态；
- 图表 Revision 追溯卡片中的“本次生成使用的记忆”。

前端只负责展示和发起动作，作用域、权限、冲突和版本校验必须由服务端再次执行。候选、空列表、提取失败、冲突待处理和加载状态都要有可解释提示。

## 7. 测试与路线图验收

### 7.1 必须覆盖的测试

- Proposed Candidate 不会出现在 Generation Worker 的长期检索结果中。
- Candidate 被接受后才产生 active Project/Workspace Memory。
- Project Editor 可以管理 Project Memory，但不能写 Workspace Memory。
- Project Memory 不会因 `scope_hint = workspace` 或模型输出自动升级。
- Workspace Memory 只能被 Owner/Admin 接受、删除或 supersede。
- 跨 Project/Workspace 的 Candidate、Memory、Conversation 和 Revision 查询不会泄露资源。
- 同一提取任务重试不会产生重复 Candidate。
- 同一 Candidate 并发接受不会创建两条长期 Memory。
- 冲突记忆返回所有来源、版本、创建人和更新时间，不能静默覆盖。
- 删除或 supersede 后的 Memory 不参与后续检索，但审计记录仍存在。
- 记忆版本变化会改变 Generation Job fingerprint，避免错误复用旧结果。
- Chart Revision 保存本次使用的 memory snapshot，当前记忆变化不影响历史 Revision。
- 记忆提取失败可重试，且不会误写长期 Memory。

### 7.2 对应路线图验收

| 路线图要求 | 可观察验收 |
| --- | --- |
| 未确认候选不会参与长期记忆检索 | Candidate 为 `proposed` 时，生成上下文只包含 Conversation Memory 和已确认 Memory |
| Project Memory 不会自动升级为 Workspace Memory | 接受接口必须显式传 `targetScope`，普通 Project Editor 无法选择 workspace |
| 冲突记忆展示来源，不静默覆盖 | 同 key 不同 value 时返回冲突及双方来源，接受操作要求显式 resolution |
| 用户确认、拒绝、删除和审计 | 每个动作都有状态变化、操作者、时间、原因和 `audit_events` 记录 |
| 来源、创建人、更新时间、置信度 | Memory/Candidate 详情和 Revision 追溯接口都返回这些字段 |

## 8. 建议交付顺序

按以下 PR 顺序实施，降低迁移和生成链路风险：

1. `contracts`、`domain`、单元测试，先冻结状态、权限、scope 和冲突规则。
2. `db` schema 与下一份 Drizzle migration，补齐历史数据默认值。
3. Memory Repository、服务层、审计和集成测试。
4. Conversation Memory 快照和候选提取任务。
5. 候选/长期记忆 API 与权限测试。
6. Generation Worker 检索接入、Job fingerprint 和 Chart Revision memory snapshot。
7. Web 候选确认、记忆管理、冲突和追溯界面。
8. 跨 Workspace、并发、幂等、删除、失败重试和端到端验收。

阶段 4 完成的判定标准是：用户可以在一个 Project 对话中产生候选，明确确认或拒绝；确认后记忆按用户选择进入 Project 或 Workspace 作用域；后续生成只读取已确认内容；所有冲突、来源、权限和审计信息可见；生成出的历史 Chart Revision 能解释当时使用了哪些记忆版本。
