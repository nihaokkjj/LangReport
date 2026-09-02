# Phase 3：Chart Artifact 和异步协作设计

> 状态：工程设计参考；第一阶段仅启用其中满足 `phase1-consulting-report.md` 的能力
>
> 依据：`README.md`、`docs/mvp-roadmap.md`、`docs/architecture.md`、`docs/domain-model.md`、ADR 0002/0003，以及当前工作树中的实现。

> 实施说明：本文记录 Chart Artifact、Revision 和异步协作的工程方案。它不扩大第一阶段的产品范围；完整的第一阶段验收以 `phase1-consulting-report.md` 为准。生产化上线前仍需补充数据库行锁/更强的并发控制、正式身份认证、对象存储生命周期策略和更完整的集成测试。

## 1. 目标和边界

阶段 3 的目标，是把阶段 2 生成的一次性结果变成可以长期管理的图表产物：

```text
Generation Job 成功
        ↓
Chart Artifact（稳定身份）
        ↓
Chart Revision（不可变内容版本）
        ↓
评论 / 审核 / 审计 / 只读分享
```

阶段 3 必须完成：

- 一个 `Chart Artifact` 可以持续拥有多个 `Chart Revision`；
- 每次生成、编辑、回滚、复制都留下新的 Revision，不覆盖历史内容；
- Revision 支持 `Draft → In Review → Approved` 和 `Changes Requested` 流程；
- Project Editor、Reviewer、Viewer 的能力由服务端统一执行；
- 评论、审核动作、导出和分享都能追溯到操作者与 Revision；
- Project Theme 在生成时解析，并以主题快照写入 Revision；
- Workspace 内可以分享固定 Revision 的只读视图。

阶段 3 暂不做：

- 实时多人编辑、光标同步或 WebSocket 协同协议；
- 面向 Workspace 外部的公开链接；
- Dashboard、多图报告和跨图表联动；
- 浏览器直接提交任意 Vega-Lite/JavaScript 作为服务器端执行内容；
- 通过修改“当前数据”让历史图表自动变化。

## 2. 当前实现检查和主要缺口

以下表格记录阶段 3 开始前的基线和需要补齐的方向；对应能力已在后续章节落地：

| 现有能力 | 当前状态 | 阶段 3 需要补齐 |
| --- | --- | --- |
| `chartArtifacts`、`chartRevisions` 表 | 已在 `packages/db/src/schema.ts` 中出现 | 增加生命周期、父子关系、head/published 指针和复制/回滚所需字段 |
| Render Worker 创建 Artifact 和首个 Revision | 生成成功后会写入 Revision | 改为幂等写入，并把状态、主题快照、审计和输出对象纳入统一事务 |
| `generationJobs` | 已保存 Snapshot、TransformPlan、Flint Spec、校验和输出 | 增加“编辑/回滚/复制”任务上下文，继续复用 PostgreSQL-backed Job |
| Project Role 枚举 | 已有 `editor/reviewer/viewer` | 权限查询必须返回角色，并由所有 Chart/Comment/Share 路由统一校验 |
| Theme | 当前主要存在于 Generation Job 的 `theme/themeVersion` 字段 | 增加 Project Theme 持久化、版本冲突控制和完整主题快照 |
| 导出 | 通过 Generation Job 输出地址下载 | 改为按 Revision 授权读取，不能绕过 Project 权限 |
| 前端 | 已展示阶段 2 生成结果，图表导航仍禁用 | 增加 Artifact 列表、Revision 时间线、审核、评论、对比和分享入口 |

还需要优先处理一个工程前置问题：当前 `packages/db/drizzle/` 中的迁移文件没有完全覆盖工作树里已经出现的 Conversation、Generation Job 和 Chart 表。阶段 3 开始前，应先用当前 schema 生成并检查迁移差异，再在本地和共享环境按迁移执行；不要把 schema drift 带入新的协作功能。

当前 `render-worker` 使用 Job ID 组织输出对象并直接创建首个 Revision，这可以作为阶段 2 的实现，但不能直接承担阶段 3 的编辑和回滚：现有 Revision 没有状态、父版本、创建人，也没有评论、审核和审计记录。阶段 3 应抽出 Chart 领域服务，而不是继续在 Worker 中堆叠业务判断。

## 3. 核心设计原则

### 3.1 Artifact 是身份，Revision 是内容

- `Chart Artifact` 是图表的稳定身份，负责名称、Project 归属和当前工作头。
- `Chart Revision` 保存某次生成或编辑时的完整内容：`Data Snapshot`、`TransformPlan`、字段血缘、`Flint Spec`、主题快照、Vega-Lite 规范、校验结果和输出对象。
- Revision 的内容列只允许插入，不允许覆盖。
- Revision 的工作流状态可以按合法状态机变化；状态变化必须产生审核记录和审计事件。
- Viewer 读取已发布 Revision，Editor 可以看到工作头和草稿。

这里的“不可变”指 Revision 的内容和来源不可变，不要求把审核状态也复制成一行新记录。若需要严格的全量 append-only 审核历史，使用 `chart_reviews` 和 `audit_events` 保存每次状态变化。

### 3.2 任何修改都走新 Revision

编辑器不能直接更新 `flintSpec`、`themeSnapshot` 或 `outputObjects`。所有修改都转换成一个新操作：

```text
原 Revision R3（Approved）
        │ 编辑标题 / 图表类型 / Theme
        ▼
新 Revision R4（Draft，parentRevisionId = R3）
        │ 异步重新校验和渲染
        ▼
R4 → In Review → Approved
```

回滚也不是把 Artifact 指针指回旧版本，而是复制目标 Revision 的完整内容，生成一个新的 Draft。这样回滚动作本身可审核，且不会改变旧版本的历史含义。

### 3.3 协作是异步的，不是实时编辑

评论、提交审核和审核决策是快速的数据库操作；渲染和编辑后的产物生成继续通过现有 Generation/Render Worker 异步执行。MVP 使用前端轮询 Job 状态即可，不新增实时协同基础设施。

### 3.4 权限和 Workspace 边界先于业务读取

每个 Chart、Revision、Comment、Share 和 Theme 查询都必须通过同一个授权上下文：

```text
userId → Workspace Member → Project → Project Role → 资源
```

不能只根据资源 ID 查询后再补权限；查询本身要带 Project/Workspace 条件，避免跨 Workspace 的 ID 猜测和越权读取。

## 4. 领域模型和数据库设计

### 4.1 关系

```text
Workspace
└── Project
    ├── Project Theme
    └── Chart Artifact
        ├── head Revision（最新工作头）
        ├── published Revision（Viewer 可见）
        └── Revision *
            ├── Data Snapshot
            ├── TransformPlan / Field Lineage
            ├── Flint Spec / Vega-Lite / Outputs
            ├── Review actions
            ├── Comments
            └── Shares
```

### 4.2 `chart_artifacts`

保留现有字段，并补充：

| 字段 | 说明 |
| --- | --- |
| `id` | 稳定 Artifact ID |
| `project_id` | Project 外键，所有访问必须带 Project 作用域 |
| `name` | 图表名称，可由首个 Flint Spec 标题初始化 |
| `head_revision_id` | 当前编辑工作头，允许指向 Draft 或 In Review |
| `published_revision_id` | 当前已批准版本，Viewer 只能读取此版本 |
| `status` | `active` / `archived` |
| `created_by`、`created_at`、`updated_at` | 创建和最近变更信息 |
| `archived_at` | 归档时间，可为空 |

`head_revision_id` 和 `published_revision_id` 都必须在同一 Artifact、同一 Project 内。若 ORM 对循环外键处理不便，可以先使用普通 UUID 字段，在领域服务中校验归属，并在后续迁移增加约束。

### 4.3 `chart_revisions`

保留当前已经存在的追溯字段，并补充：

| 字段 | 说明 |
| --- | --- |
| `id` | Revision ID |
| `artifact_id` | 所属 Artifact |
| `generation_job_id` | 来源 Job；手工复制时可为空，非空时保持唯一 |
| `snapshot_id` | 明确的数据输入，不允许指向“当前数据” |
| `revision` | Artifact 内单调递增的编号，唯一约束为 `(artifact_id, revision)` |
| `status` | `draft` / `in_review` / `approved` / `changes_requested` / `archived` |
| `parent_revision_id` | 编辑、回滚或复制的来源 Revision，可为空 |
| `created_by` | 创建该 Revision 的用户 |
| `change_reason` | 编辑、回滚或复制原因，可为空 |
| `transform_plan`、`field_lineage`、`flint_spec` | 不可变生成内容 |
| `theme_snapshot` | 解析后的完整主题，不只保存 Theme ID |
| `vega_lite_spec`、`validation`、`output_objects` | 不可变输出和校验结果 |
| `created_at` | 创建时间 |

现有 `generationJobId` 不可继续保持“必须非空”的设计，否则回滚和手工复制无法表达。若业务希望所有 Revision 都有 Job，可以为复制/回滚创建一个专用的轻量 Job；MVP 更推荐允许它为空，并在 `change_reason` 和审计事件中记录来源。

#### 内容不变量

1. `snapshot_id`、TransformPlan、字段血缘、Flint Spec、主题快照和输出对象在插入后不可更新。
2. `approved` Revision 不允许变更任何内容字段；修改只能创建新的 Draft。
3. Revision 的 Snapshot 必须属于 Artifact 所在 Project。
4. Revision 的输出对象必须来自通过校验的 Flint Spec，并保存 Flint/Renderer 版本。
5. `parent_revision_id` 必须指向同一 Artifact 的旧版本；跨 Artifact 复制使用新 Artifact 的首个 Revision，并在审计元数据中记录来源。

### 4.4 审核、评论、分享和审计表

#### `chart_reviews`

把审核动作做成 append-only 记录，而不是只覆盖 Revision 上的几个用户字段：

- `id`、`revision_id`、`action`（`submitted` / `approved` / `changes_requested`）；
- `actor_id`、`note`、`created_at`；
- 可选 `review_cycle`，用于区分同一 Revision 的多轮审核。

Revision 的 `status` 是当前状态，`chart_reviews` 是审核历史。每次状态改变必须在同一个事务中写入两者。

#### `chart_comments`

- `id`、`revision_id`、`author_id`、`body`、`created_at`；
- `anchor` 可选，保存图表元素、字段或数据点等稳定锚点，不绑定 DOM 坐标；
- `resolved_at`、`resolved_by` 可为空，用于标记已解决；
- 评论正文创建后不直接覆盖；需要修正时新增评论或记录编辑事件。

阶段 3 的评论绑定 Revision，而不是绑定“当前图表”。新 Revision 不自动修改旧评论；UI 可以提供“复制未解决评论到新 Revision”的显式操作，复制时记录来源评论 ID。

#### `chart_shares`

分享对象必须绑定固定 Revision，而不是绑定可变的 Artifact head：

- `id`、`workspace_id`、`project_id`、`revision_id`；
- `token_hash`，只保存分享 token 的哈希；
- `created_by`、`created_at`、`expires_at`、`revoked_at`。

分享读取仍要求用户是该 Workspace Member。MVP 不允许未登录的 Workspace 外部访问；撤销或过期后立即失效。

#### `project_themes`

建议一条 Project 一条当前 Theme 记录：

- `project_id`；
- `theme_id` / `preset`；
- `version`，每次保存递增；
- `config`，解析后的颜色、字体、布局和标签规则；
- `updated_by`、`updated_at`。

生成时先解析 Theme，再把结果写入 Revision 的 `theme_snapshot`，例如：

```json
{
  "id": "project-theme",
  "preset": "economist",
  "version": 3,
  "config": { "...": "resolved theme config" },
  "source": "project"
}
```

因此，之后修改 Project Theme 或删除 Theme，都不会改变历史 Revision 的视觉含义。

#### `audit_events`

建议字段：`id`、`workspace_id`、`project_id`、`actor_id`、`action`、`entity_type`、`entity_id`、`metadata`、`request_id`、`created_at`。

至少记录：Artifact 创建、Revision 创建、编辑、回滚、复制、提交审核、批准、要求修改、归档、评论创建/解决、导出、分享创建/撤销、Theme 更新和权限拒绝。审计表只追加，不作为业务当前状态的唯一来源。

### 4.5 迁移顺序

按以下顺序完成数据库变化：

1. 先对齐当前 schema 与已有 migration，生成一份可审查的基线迁移。
2. 增加 Revision 状态枚举、Artifact 状态枚举和 Project Theme 表。
3. 为 Artifact/Revision 增加 head、published、parent、createdBy、status 等字段。
4. 增加 Review、Comment、Share、Audit 表及索引。
5. 将已有成功生成的 Revision 回填为 `draft`，并把它们设置为 Artifact head；没有明确审核依据时不要伪造 `approved`。
6. 将历史 Generation Job 的输出继续保留，新的输出对象必须记录精确的 Revision 归属。
7. 增加唯一索引、外键和必要的部分唯一索引，例如非空 `generation_job_id` 的唯一约束。
8. 用本地数据验证迁移，再提交 migration 文件；共享环境使用 `db:generate` 后生成的迁移执行，不依赖 `db:push`。

## 5. Revision 状态机和权限

### 5.1 状态机

```text
Draft ───────────────→ In Review ─────────→ Approved
  │                         │                  │
  │                         └──────────────→ Changes Requested
  │                                               │
  └───────────────────────────────────────────────┘

Draft / Changes Requested / In Review / Approved ─→ Archived
```

具体规则：

- `Draft → In Review`：Editor、Reviewer、Workspace Owner/Admin；
- `In Review → Approved`：Reviewer、Workspace Owner/Admin；
- `In Review → Changes Requested`：Reviewer、Workspace Owner/Admin；
- `Changes Requested → Draft`：Editor、Reviewer、Workspace Owner/Admin；
- 归档：Project Editor 或 Workspace Owner/Admin，具体以产品权限策略为准；
- `Approved` 的内容永远不回写；新修改创建新的 Draft；
- `Archived` Revision 只读，不能重新进入审核；需要继续使用时复制为新 Revision。

状态转换必须由 `transitionRevision()` 领域服务执行，不能让路由直接 `UPDATE status`。服务需要校验当前状态、角色、资源归属、幂等键和并发版本，并在同一事务写入 `chart_reviews` 与 `audit_events`。

### 5.2 角色能力

| 能力 | Owner/Admin | Editor | Reviewer | Viewer |
| --- | --- | --- | --- | --- |
| 查看 Project 内已授权 Artifact/Revision | 是 | 是 | 是 | 是 |
| 创建图表或编辑并创建新 Revision | 是 | 是 | 否 | 否 |
| 提交审核 | 是 | 是 | 是 | 否 |
| 评论 | 是 | 是 | 是 | 只读或按产品策略关闭 |
| 批准 / 要求修改 | 是 | 否 | 是 | 否 |
| 回滚 / 复制 | 是 | 是 | 否 | 否 |
| 创建或撤销只读分享 | 是 | 是 | 可选 | 否 |
| 修改 Project Theme | 是 | 是 | 否 | 否 |
| 上传数据、删除数据 | 是 | 是 | 否 | 否 |

Owner/Admin 的 Workspace 权限不能绕过 Workspace 归属检查；它们是跨 Project 的管理权限，不是跨 Workspace 权限。

## 6. 推荐的实现步骤

### Step 1：冻结契约和不变量

在代码中先定义 `ChartRevisionStatus`、`ChartArtifactStatus`、审核动作、评论、分享和 Theme 的 Zod Schema/TypeScript 类型，并写出状态转换表。把以下规则变成可复用的领域断言：

- 资源必须属于当前 Project/Workspace；
- Approved/Archived 内容不可修改；
- 新版本的 `revision` 编号由数据库事务分配；
- 所有生成输入都包含明确 Snapshot 和 Theme 快照；
- Viewer 只有读取权限。

完成标准：没有路由或 Worker 自己定义一套状态字符串；所有后续 API 都引用同一份 contracts；关键不变量有单元测试覆盖。

### Step 2：完成数据库迁移和 Chart Repository

为 Chart、Review、Comment、Share、Theme、Audit 增加 Drizzle schema、索引和迁移。抽出 Repository/Query 层，统一提供带作用域的方法，例如：

```text
getArtifactForMember(workspaceId, projectId, artifactId, userId)
listRevisionsForMember(workspaceId, projectId, artifactId, userId)
getRevisionForMember(workspaceId, projectId, revisionId, userId)
```

不要提供只接收 `artifactId` 或 `revisionId` 的无作用域查询给 API 层。Artifact head/published 指针、Revision 编号和状态更新需要使用事务及行锁/乐观并发控制，避免两个编辑者生成相同编号或覆盖 head。

完成标准：迁移能从干净数据库执行；已有阶段 2 结果可以读取；跨 Project/Workspace 的查询在集成测试中返回 404/403，而不是泄露资源。

### Step 3：把生成结果变成幂等的初始 Revision

把当前 Render Worker 中“创建 Artifact + 创建 Revision”的逻辑移动到 `ChartArtifactService.createFromGenerationResult()`：

1. 校验 Job 是成功状态，且 Flint Spec、渲染输出和 validation report 都有效。
2. 根据 `generationJobId` 查找是否已经创建 Revision；存在时直接复用，防止 Worker 重试产生重复 Artifact。
3. 在事务中创建 Artifact、Revision、head 指针和审计事件。
4. 初始 Revision 状态设为 `draft`，除非有明确的审核命令。
5. `theme_snapshot` 保存实际解析后的 Theme，不能只保存当前 Theme ID。
6. `output_objects` 保存准确的输出对象地址、Flint 版本和 Renderer 版本；对象必须是私有存储。

输出对象可以继续使用当前 Job ID 作为稳定对象名，只要 Revision 保存完整地址且对象不可覆盖。若改为 Revision-scoped key，应在创建任务时预分配目标 Revision ID，避免渲染完成后再猜测路径。

完成标准：同一个成功 Job 重试 10 次仍只有一个 Artifact 和一个首 Revision；失败 Job 不创建“成功图表”；Revision 可以完整回溯到 Snapshot、Job 和生成版本。

### Step 4：实现编辑、回滚和复制

阶段 3 的首版编辑范围应限制在平台可校验的结构化操作：标题、图表类型、字段编码、排序/显示选项和 Theme。浏览器提交的是受限 patch，不是任意服务器端代码。

#### 编辑

1. API 校验 Editor 权限、基础 Revision 归属和基础 Revision 状态。
2. 创建一个带 `operation = edit`、`baseRevisionId` 和 patch 的异步 Job。
3. Worker 读取基础 Revision 的 Snapshot、TransformPlan、字段血缘和 Flint Spec。
4. 应用受限 patch；如果修改触及数据字段或 TransformPlan，则创建全新的自然语言 Generation Job，不允许只改展示规范伪装成数据变更。
5. 重新运行 Schema/语义/数据字段/视觉校验和 Render Worker。
6. 成功后插入新的 Draft Revision，写入 `parent_revision_id`，再原子更新 Artifact head。

#### 回滚

1. 校验目标 Revision 与 Artifact/Project 一致，且目标内容仍可读取。
2. 复制目标 Revision 的完整不可变字段，生成新的 Revision 编号。
3. 新 Revision 状态为 `draft`，`parent_revision_id` 指向被回滚的目标版本，`change_reason` 写明回滚来源。
4. 输出对象可复用源 Revision 的不可变对象地址；若存储生命周期要求独立管理，再复制对象并更新地址。
5. 写入审计事件，不能直接移动 `published_revision_id`。

#### 复制

复制默认创建一个新的 Chart Artifact，并以源 Revision 的内容作为新 Artifact 的第一个 Draft Revision。新 Artifact 必须重新绑定当前 Project 的权限，不得继承源 Artifact 的分享 token 或评论。

完成标准：编辑、回滚、复制都不改变源 Revision；每个新版本可通过 parent/source 信息追溯；相同操作重试不会产生重复版本；Viewer 无法调用这些写接口。

### Step 5：实现审核、评论和审计

先实现同步的数据库命令，再接入通知：

- `submitRevisionForReview()`；
- `approveRevision()`；
- `requestChanges()`；
- `addComment()` / `resolveComment()`；
- `writeAuditEvent()`。

批准事务需要同时完成：

1. 锁定并重新读取 Revision；
2. 确认当前状态为 `in_review`；
3. 确认 validation report 仍为有效；
4. 将状态改为 `approved`；
5. 更新 Artifact 的 `published_revision_id` 和 `head_revision_id`；
6. 写入审核记录和审计事件。

如果期间 head 已改变，命令应返回并发冲突，由用户重新选择 Revision，不要静默批准错误版本。

完成标准：每一次审核动作都能展示操作者、时间、备注和前后状态；批准后源 Revision 内容无法通过 API 改写；评论始终显示其绑定的 Revision。

### Step 6：实现 Project Theme 和历史快照

新增 `ThemeService`，统一处理：

- 读取 Project 当前 Theme；
- 校验 Theme preset/config；
- 递增 Theme version；
- 生成时解析 Theme；
- 将解析结果固化到 Revision。

继续遵守架构中的解析顺序：图表临时设置 → Project Theme → Workspace Theme → 系统默认 Theme。阶段 3 至少落地 Project Theme 和系统默认 Theme；Workspace Theme 可以暂时作为只读 fallback。

生成 Job 的 fingerprint 必须包含 Project Theme 的版本/配置。否则 Theme 更新后重新生成可能错误复用旧 Job。历史 Revision 的预览和导出必须只读自己的 `theme_snapshot` 和输出对象。

完成标准：更新 Project Theme 后旧 Revision 的主题快照、Vega-Lite 和 PNG/SVG 均不变；同一 Snapshot、TransformPlan、Theme version 和 Renderer version 可以重建相同结果。

### Step 7：实现只读分享和按角色的 Web 体验

API 层建议提供以下资源：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/chart-artifacts` | Artifact 列表及 head/published 摘要 |
| `GET` | `/api/v1/chart-artifacts/:artifactId` | Artifact 详情和当前可见版本 |
| `GET` | `/api/v1/chart-artifacts/:artifactId/revisions` | Revision 时间线 |
| `GET` | `/api/v1/chart-revisions/:revisionId` | 单个 Revision 及追溯信息 |
| `GET` | `/api/v1/chart-revisions/:revisionId/compare/:otherRevisionId` | 结构化差异 |
| `POST` | `/api/v1/chart-artifacts/:artifactId/revisions` | 创建编辑/复制/回滚 Job，返回 `202` |
| `POST` | `/api/v1/chart-revisions/:revisionId/submit` | 提交审核 |
| `POST` | `/api/v1/chart-revisions/:revisionId/approve` | 批准 |
| `POST` | `/api/v1/chart-revisions/:revisionId/request-changes` | 要求修改 |
| `GET/POST` | `/api/v1/chart-revisions/:revisionId/comments` | 查看/创建评论 |
| `POST` | `/api/v1/comments/:commentId/resolve` | 解决评论 |
| `POST` | `/api/v1/chart-revisions/:revisionId/shares` | 创建 Workspace 内分享 |
| `GET` | `/api/v1/chart-shares/:shareId` | 读取固定 Revision 的只读视图 |
| `POST` | `/api/v1/chart-shares/:shareId/revoke` | 撤销分享 |
| `GET/PUT` | `/api/v1/projects/:projectId/theme` | 读取/更新 Project Theme |

接口实现要求：

- 所有请求使用统一 `authorizeProject()`，返回 Workspace、Project 和 Project Role；
- 资源不存在和无权限可以统一返回 404，减少 ID 枚举；审核/编辑冲突返回明确的 409 错误码；
- 状态命令支持幂等键或请求 ID；重复批准不能追加第二次有效批准；
- 对 Artifact head 和 Revision 状态使用 `If-Match` 或显式 `expectedRevision`，避免并发覆盖；
- 输出下载必须以 Revision 为授权对象，不能只根据 Generation Job ID 读取。

前端先完成一个可用的图表工作区：

1. 图表产物列表：名称、当前状态、最新版本、已发布版本、最后修改人和时间。
2. 详情页：图表预览、追溯卡片、Revision 时间线和状态操作。
3. Revision 对比：显示 Snapshot、TransformPlan、字段血缘、Flint Spec、Theme 和输出的新增/删除/变更。
4. 评论/审核面板：评论绑定选中的 Revision，显示审核历史和 Changes Requested 原因。
5. 权限体验：Viewer 只看到已发布的只读内容；Editor/Reviewer 看到的按钮由角色控制，但服务端仍是最终授权点。
6. 分享入口：只生成固定 Revision 的 Workspace 分享，并展示过期/撤销状态。

对比实现应使用确定性的 JSON diff，不调用模型。对于大数据字段，只比较 Snapshot ID、schema 摘要和行数，不把完整原始数据发送到浏览器。

## 7. API 和异步流程示意

### 编辑流程

```text
Editor
  │ POST revisions { baseRevisionId, patch }
  ▼
API
  ├─ authorize Project Role
  ├─ validate patch and base Revision
  └─ create Generation Job(operation=edit)
           │ 202
           ▼
Generation Worker
  ├─ load immutable Snapshot / Plan / Flint Spec
  ├─ apply constrained patch
  └─ hand off rendering
           ▼
Render Worker
  ├─ render and validate
  └─ ChartArtifactService.createRevision()
       ├─ insert new Draft Revision
       ├─ update Artifact head
       └─ write Audit Event
```

### 审核流程

```text
Draft → submit → In Review
                     ├─ approve → Approved + publishedRevisionId 更新
                     └─ request changes → Changes Requested → Draft
```

Viewer 的读取路径只允许使用 `publishedRevisionId`；当 Artifact 只有 Draft、没有 Approved Revision 时，Viewer 看到“尚未发布”，不能看到草稿输出。

## 8. 对比、回滚和可复现性细节

### 8.1 Revision 对比

对比返回固定结构，方便 Web 渲染：

```json
{
  "leftRevisionId": "...",
  "rightRevisionId": "...",
  "sections": {
    "source": { "changed": true, "snapshotId": { "from": "...", "to": "..." } },
    "transformPlan": { "added": [], "removed": [], "changed": [] },
    "fieldLineage": { "added": [], "removed": [], "changed": [] },
    "flintSpec": { "added": [], "removed": [], "changed": [] },
    "theme": { "changed": true },
    "outputs": { "changed": true }
  }
}
```

输出二进制不在 API 中做字节 diff，只比较对象地址、hash、格式和 Renderer version。

### 8.2 回滚语义

回滚是“以旧版本内容创建新 Draft”，不是“恢复数据库指针”。因此：

- 审核者可以看到回滚动作；
- 旧的 Approved Revision 仍然可追溯；
- 新 Draft 仍需经过审核才能成为发布版本；
- 当前数据、当前 Theme 或插件变化不会改变被复制的历史内容。

### 8.3 历史数据与对象保留

Data Snapshot、Revision JSON 和输出对象至少在其被历史 Revision 引用期间保持可读。删除 Data Asset 时，应检查是否仍有 Revision 引用；有引用时采用归档/软删除，不要物理删除导致历史图表无法复现。

## 9. 测试和验收清单

### 9.1 必须覆盖的测试

- 初始 Generation Job 成功后只创建一个 Artifact 和一个 Draft Revision；Job 重试不重复创建。
- 同一 Artifact 的 Revision 编号严格递增且唯一。
- `Approved` Revision 的内容更新被拒绝，并返回明确错误码。
- 编辑、回滚、复制均生成新的 Revision，源 Revision 的全部内容保持不变。
- 状态转换矩阵的允许和拒绝路径都覆盖，Reviewer/Editor 权限不能互换。
- Viewer 不能上传数据、创建编辑 Job、修改 Theme、提交审核、批准或要求修改。
- 跨 Workspace 的 Artifact、Revision、Comment、Share 和输出下载均被拒绝。
- 评论只属于创建时绑定的 Revision；解决评论会留下操作者和时间。
- 分享只返回固定 Revision；撤销、过期、非 Workspace Member 都不能读取。
- Project Theme 更新不影响历史 `theme_snapshot`、Vega-Lite、PNG/SVG。
- 当前 Data Asset 新建 Snapshot 不影响旧 Revision 的 `snapshot_id`。
- 两个并发编辑/审核请求不会覆盖 head 或错误批准另一个 Revision。
- 所有关键写操作都有 Audit Event，审计记录不能被普通业务 API 删除。

### 9.2 对应路线图验收

| 路线图要求 | 可观察验收 |
| --- | --- |
| Approved Revision 不可修改 | 直接修改内容字段失败；只能创建新 Revision |
| 每次修改产生新 Revision | 编辑、回滚、复制后 Revision 数量增加且有 parent/source 关系 |
| Viewer 不能上传、修改或审核 | API 权限矩阵测试全部失败并不泄露资源 |
| 历史 Revision 不受当前 Theme/数据影响 | 更新 Theme 或上传新 Snapshot 后历史预览和导出 hash 不变 |

### 9.3 工程检查

每个实现切片完成后至少运行：

```powershell
pnpm db:generate
pnpm typecheck
```

如果增加 Web 页面，再运行项目约定的 `pnpm --filter @langreport/web typecheck`，并检查桌面与移动宽度下的只读、空状态、加载、错误和权限状态。

## 10. 本次实施落地

本阶段已按上述步骤完成 MVP 实现：

- `packages/contracts`：统一 Revision 状态、编辑 Patch、审核、评论、Theme 和分享契约；
- `packages/domain`：状态机、角色能力矩阵、不可变 Patch 和确定性 Revision 对比，并提供领域单元测试；
- `packages/chart`：带 Project/Workspace 作用域的 Artifact/Revision 服务，初始 Revision 幂等创建，编辑/回滚/复制、审核、评论、Theme、分享、导出审计；
- `packages/db`：Artifact/Revision 生命周期字段，以及 Review、Comment、Share、Project Theme、Audit Event 表和迁移 `0002`～`0004`；
- `apps/generation-worker` / `apps/render-worker`：编辑 Job 的受限 Patch、重新校验、渲染和新 Revision 落库；
- `apps/api`：图表资源、审核、评论、对比、分享、Theme 和 Revision 导出接口，并收紧旧 Generation Job 入口的 Viewer 读取范围；
- `apps/web`：Chart Artifacts 列表、Revision 时间线、追溯信息、状态操作、评论、对比、分享和响应式工作区。

已验证：`pnpm typecheck`、`pnpm build`、`@langreport/domain` 单元测试，以及本地 API/Worker 的生成、Theme 快照、编辑、审核、Viewer 隔离、分享、回滚和复制幂等链路。正式上线前仍建议补齐真实身份认证、数据库并发压测、跨 Workspace 集成测试和完整浏览器自动化测试。

## 11. 建议的交付顺序

按以下顺序切分 PR，降低一次性改动的风险：

1. Schema、contracts、迁移和 Repository，先解决 migration drift。
2. `ChartArtifactService`：初始 Revision 的幂等创建、head/published 指针。
3. Revision 编辑/回滚/复制 Job，以及 Worker 的异步渲染闭环。
4. 状态机、角色授权、审核记录和审计事件。
5. 评论和 Revision 对比。
6. Project Theme、fingerprint 和历史主题快照。
7. Workspace 内只读分享、导出授权和 Web 图表产物工作区。
8. 跨 Workspace、并发、幂等、历史可复现和 Viewer 权限验收。

阶段 3 的完成条件是：从一个阶段 2 生成结果开始，Editor 可以创建新版本，Reviewer 可以审核，Viewer 只能读取已批准版本；任意历史 Revision 都能通过自身的 Snapshot、规范、主题和输出对象独立解释、下载和复现。
