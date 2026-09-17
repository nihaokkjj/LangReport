# Data Asset Snapshot re-ingest：设计

- 变更编号：`CHG-2026-09-16-DATA-ASSET-SNAPSHOT-REINGEST`
- 状态：`ACCEPTED`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 现状与约束

当前 `POST /api/v1/projects/:projectId/data-assets/upload` 和 paste route 都调用 Data Asset intake。intake 每次生成新的 `assetId`、`snapshotId`，并将原始文件 Key 写入 `data_assets.object_key`；normalized Snapshot Key 已包含 Snapshot ID。`Generation Job` 在创建时冻结 `dataAssetId + snapshotId`，Worker 通过 Snapshot access module 读取具体 Snapshot。

本变更必须保持：

1. Data Asset 仍归 Project 所有；
2. Data Snapshot 和 Chart Revision 不可覆盖；
3. Generation Job 仍只读取已冻结的 Snapshot；
4. S3/MinIO 失败仍通过补偿处理；
5. 新上传和更新已有 Asset 都必须验证来源 Conversation 属于当前 Project；
6. 不按文件名或内容自动匹配目标 Asset。

## 设计目标与非目标

### 目标

- 用显式目标区分“创建新 Asset”和“更新已有 Asset”；
- 让同一 Asset 的 Snapshot 版本分配安全、可追溯、可并发；
- 为每个 Snapshot 保存独立 source object Key；
- 更新失败时不影响旧的 ready Snapshot；
- 保持生成侧的 normalized object Key 和读取合同稳定。

### 非目标

- 不实现 Snapshot diff、删除、异步队列或大文件流式上传；
- 不修改模型、TransformPlan 或 Chart Revision 输入合同；
- 不自动去重或自动合并 Asset；
- 不恢复历史旧路径的读取 fallback。

## 方案选型

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 所有上传继续创建新 Asset | 实现最简单，天然隔离 | 没有版本链，Asset 重复，无法表达数据更新 | 不采用 |
| 按文件名/Hash 自动复用 Asset | 用户操作少 | 误合并风险高，文件名不是业务身份，Hash 无法表达“同数据集新版本” | 不采用 |
| 显式新建/更新两种操作 | 语义清楚，兼顾独立数据和版本更新，便于审计 | 需要 API、UI、迁移和并发处理 | 采用 |

## API / 外部契约

保留新建入口：

```text
POST /api/v1/projects/:projectId/data-assets/upload
POST /api/v1/projects/:projectId/data-assets/paste
```

新增显式更新入口：

```text
POST /api/v1/projects/:projectId/data-assets/:assetId/snapshots/upload
POST /api/v1/projects/:projectId/data-assets/:assetId/snapshots/paste
```

更新 upload 的 multipart 字段仍为 `file`、`conversationId`；更新 paste 的 JSON 字段仍为 `name`、`content`、`conversationId`。两个更新接口均返回相同的 `PublicDataAsset`，其中 `latestSnapshot` 是刚创建的版本。

intake 内部 command 使用显式 target：

```ts
type DataAssetIntakeCommand = {
  projectId: string;
  sourceConversationId: string;
  createdBy: string;
  requestId?: string;
  target?: { assetId: string };
  source: {
    name: string;
    sourceType: DataSourceType;
    mimeType: string;
    bytes: Buffer;
  };
};
```

`target` 为空表示新建 Asset；有 `assetId` 表示在既有 Asset 下追加 Snapshot。后续如需更多操作类型，再把 target 升级为 discriminated union。

## 数据模型

### Data Asset

- 移除 `data_assets.object_key`，因为一个 Asset 可以有多个原始文件；
- `name`、`sourceType`、`mimeType`、`sizeBytes` 作为当前 Asset 展示元数据，在成功更新时同步为最新输入；
- `sourceConversationId` 保持不可变，不因更新请求来自其他 Project Conversation 而改变。

### Data Snapshot

在 `data_snapshots` 增加不可变、非空的 `source_object_key`：

```text
Data Snapshot
  ├── sourceObjectKey       原始输入文件
  └── normalizedObjectKey   标准化 JSON 数据
```

已有 Snapshot 的 `source_object_key` 从旧的 `data_assets.object_key` 回填；回填完成后删除 Data Asset 上的旧字段。历史旧 source Key 可以继续作为历史记录引用，新上传统一使用 Snapshot-scoped Key。

## Object Key

新增 source helper 生成：

```text
workspaces/{workspaceId}/projects/{projectId}/conversations/{asset.sourceConversationId}/user-data/uploads/{assetId}/snapshots/{snapshotId}/source/{filename}
```

normalized Key 保持当前格式，避免改变 Snapshot access module 的 canonical contract：

```text
workspaces/{workspaceId}/projects/{projectId}/conversations/{asset.sourceConversationId}/user-data/uploads/{assetId}/snapshots/{snapshotId}.json
```

source 和 normalized 都使用同一 `assetId + snapshotId`，同一 Asset 的任何版本都不会覆盖另一版本。

## 状态与事务

### 新建 Asset

沿用当前流程：

```text
insert Data Asset(processing)
  → parse
  → put source + normalized
  → transaction: insert Snapshot(v1) + update Asset(ready)
  → failure: cleanup + Asset(failed)
```

### 更新已有 Asset

更新不把旧的 ready Asset 置为 failed：

```text
validate target Asset and Conversation
  → parse
  → put new source + normalized objects
  → transaction:
       lock target Asset
       allocate max(snapshot.version) + 1
       insert Snapshot
       update Asset current metadata and clear errors
  → failure: cleanup new objects; keep previous Asset/Snapshot unchanged
```

对象写入前不锁住数据库；最终事务使用目标 Asset 行锁，并依赖 `(asset_id, version)` 唯一索引防止重复版本。两个并发更新可以分别写入不同的 Snapshot ID，提交时顺序决定 v2/v3，但不会覆盖对象。

更新目标只允许当前 Project 中仍可管理的 Asset；`archived`、`deleted` 或不存在的 Asset 返回稳定错误。更新期间旧 Snapshot 仍可被已冻结的 Job 读取。

## 模块边界

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| HTTP route | 权限、multipart/JSON 传输、target assetId 提取、command 组装、错误响应 | Snapshot 版本分配、对象补偿 |
| Data Asset intake | target 校验、解析、Key、对象写入、补偿、Snapshot 事务 | Generation Job、图表和模型 |
| Data engine | bytes → rows/profiles/preview | DB、对象存储 |
| Storage adapter | put/get/delete object | Asset/Snapshot 业务语义 |
| Snapshot access | 校验关系、重建 normalized Key、读取冻结 Snapshot | re-ingest 和原始文件写入 |

## 失败与补偿

- parse 失败：更新目标保留旧 Asset；新建目标保持现有 failed 记录语义；
- source 写入失败：删除本次已写对象；
- normalized 写入失败：按 normalized → source 顺序补偿；
- Snapshot DB 事务失败：删除本次两个对象；
- 补偿删除失败：写入现有 cleanup audit，不替换原始业务错误；
- 更新成功提交前，任何旧 Snapshot 都不修改，旧 Job 不受影响。

## 权限与安全

更新 route 先检查 Project 的 `manage_data`。intake 再次确认 target Asset 属于 Project，并确认请求 Conversation 属于 Project。HTTP 响应不包含 `sourceObjectKey` 或 `normalizedObjectKey`；完整原始文件只由受控对象存储和既有 Worker 凭据读取。

## 前端交互

数据区提供两个明确动作：

- `导入文件`：创建新的 Data Asset；
- `更新当前数据`：对当前选中的 Asset 创建新 Snapshot。

没有选中 Asset 时只显示新建动作。两者共享同一个文件选择控件和加载/错误状态，成功提示分别显示“创建 Snapshot v1”和“更新为 Snapshot vN”。不改变现有证据和图表信息架构。

## 迁移、兼容与回滚

迁移步骤：

1. `data_snapshots` 增加 nullable `source_object_key`；
2. 从每个历史 `data_assets.object_key` 回填对应 Snapshot；
3. 检查所有历史 Snapshot 已有 source key；
4. 将新列改为 `NOT NULL`；
5. 删除 `data_assets.object_key`；
6. 更新 migration verifier 和历史 fixture。

数据库迁移不移动 S3 对象；历史 source key 继续引用原对象，新上传使用新路径。若迁移前检查发现无法唯一回填的 Snapshot，应终止迁移，不静默删除历史记录。代码回滚需要先恢复兼容读取字段或回滚整个发布，不使用破坏性数据清理。

## 日志、监控与可观测性

记录现有 `requestId`、Asset ID、Snapshot ID、target 类型和错误类别；不记录文件内容、API Key 或完整对象 Key。至少观测：新建/更新数量、每个 Snapshot 版本分布、更新失败分类、对象补偿失败和并发版本冲突。

## 测试策略

- intake unit：new v1、existing v2、旧 Snapshot 保留、source Key 不碰撞、更新失败不污染旧 Asset；
- API：新建/更新 upload/paste、权限、跨 Project target、错误响应；
- DB integration：回填迁移、NOT NULL、删除旧字段、并发版本唯一性；
- Snapshot access：v1/v2 normalized Key 均可读，关系和 canonical path 校验不回归；
- Web E2E：导入新 Asset 后更新当前 Asset，界面显示 Snapshot 版本变化。

## 需求追踪矩阵

| 需求 | 设计 | 任务 | 测试 | commit |
| --- | --- | --- | --- | --- |
| R1 新建与更新显式区分 | API / 前端交互 | T1/T5 | API/Web E2E | 已验收；未提交 |
| R2 同一 Asset 追加 Snapshot | 数据模型 / 状态事务 | T2/T3 | intake/DB integration | 已验收；未提交 |
| R3 source Key 按 Snapshot 隔离 | Object Key / 迁移 | T2/T4 | storage/intake/migration | 已验收；未提交 |
| R4 历史 Job/Revision 不受影响 | 状态与 Snapshot access | T3/T4 | generation regression | 已验收；未提交 |
| R5 失败可解释且不污染旧数据 | 失败与补偿 | T3 | intake/API | 已验收；未提交 |
