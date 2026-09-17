# Data Snapshot Preview：设计

- 变更编号：`CHG-2026-09-17-DATA-SNAPSHOT-PREVIEW`
- 状态：`APPROVED`
- 创建时间：2026-09-17
- 更新时间：2026-09-17

## 现状与约束

- `packages/data-engine` 将解析结果保存为 `columns`、`rows`、`profiles` 和 `preview`；当前 `preview` 是前 25 行，最大字段数为 200。
- `data_snapshots` 已保存 `schema`、`preview`、`rowCount`、`columnCount` 和 Snapshot 对象路径；T1 已增加每个版本独立的 nullable 来源文件元数据，历史记录不回填。
- 现有 Data Asset 读模型返回最新 Snapshot；Web 右侧 Inspector 目前只展示摘要和前 6 个字段画像，不渲染 `preview` 表格。
- 业务术语以 [CONTEXT.md](../../../CONTEXT.md) 为准；`Data Snapshot Preview` 是本变更新增的能力术语，不创建新的业务实体。
- 视觉系统以 [DESIGN.md](../../../DESIGN.md) 为准：Inter 正文、JetBrains Mono 元数据、8px spacing、克制边框、可见焦点和桌面/移动响应式。
- Data Snapshot 不可变；Generation Cycle 只使用一个 Snapshot；历史 Chart Revision 的 Snapshot 绑定不能被最新数据替换。

## 设计目标与非目标

### 目标

- 让用户在上传后可以核对真实解析数据，而不是只看文件元数据。
- 让同一 Data Asset 的历史 Snapshot 可读且只读。
- 将预览读取和生成输入分离，生成始终以最新 Snapshot 为准。
- 控制首屏响应和浏览器数据暴露：版本列表轻量，预览详情按需加载。
- 不泄露对象存储 key，不绕过 Project 权限，不改变生成/审核闭环。

### 非目标

- 不实现完整文件浏览、编辑、查询、导出或 Snapshot diff。
- 不让历史 Snapshot 成为 Generation Cycle 的输入。
- 不引入新的“Dataset”“Data Viewer”领域实体。
- 不改动 Generation Worker、Render Worker、TransformPlan 或 Chart Revision 状态机。

## 方案选型

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 直接展开右侧 Inspector | 交互路径短 | 320px 区域无法容纳多列，移动端也会拥挤 | 不采用 |
| 新增独立 Data 页面 | 表格空间充足 | 改变现有工作台信息架构，增加上下文切换成本 | 不采用 |
| 右侧摘要 + 宽 modal/移动 sheet | 保留现有信息架构，桌面和移动端都能承载表格 | 需要管理 modal 状态和按需读取 | 采用 |
| 一次返回所有 Snapshot preview | 前端实现简单 | 响应体和数据暴露随版本数增长 | 不采用 |
| Snapshot 元数据列表 + 详情按需加载 | 首屏轻、版本明确、权限边界清楚 | 增加两个读取接口 | 采用 |
| 历史 Snapshot 参与生成 | 分析能力更强 | 容易误用旧数据，改变 Generation 输入边界 | 不采用；记录于 [ADR 0022](../../adr/0022-data-snapshot-preview-latest-generation.md) |

## 模块边界

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| `apps/web/app/page.tsx` 或拆出的 Web 组件 | 入口、modal/sheet 状态、版本切换、详情加载、表格渲染、加载/错误/空态 | 权限判断、Snapshot 变更、生成输入选择 |
| `apps/web/app/globals.css` | 使用现有 token 实现表格、滚动、modal/sheet、sticky header/first column、响应式和焦点样式 | 新增产品色或改变信息架构 |
| `apps/api/src/routes.ts` | Snapshot 列表/详情 HTTP、Project view 权限、归属校验、错误映射 | 前端显示状态、表格格式化 |
| `apps/api/src/data-assets.ts` | Snapshot 读模型和公开投影，隐藏 object key | 页面状态、数据编辑 |
| `packages/contracts` | SnapshotSummary/Detail 的 HTTP schema | 直接操作数据库 |
| `packages/db` | Snapshot 来源元数据 nullable 字段和迁移 | 对象存储读取和 UI 回退 |
| `packages/data-engine` | 保持现有解析、字段画像和 25 行 preview 边界 | 预览权限和页面交互 |
| Generation Worker | 不修改；继续使用最新 Snapshot 的冻结生成输入 | 历史预览读取 |

## 数据模型与状态流转

### Snapshot 读模型

新增面向前端的只读模型：

```text
SnapshotSummary
  id
  assetId
  version
  rowCount
  columnCount
  sourceName?       // 新 Snapshot 写入；旧记录可为空
  sourceType?
  mimeType?
  sizeBytes?
  createdAt

SnapshotDetail = SnapshotSummary
  + schema
  + preview          // 最多 25 行
```

`sourceObjectKey` 和 `normalizedObjectKey` 永远不进入公开 DTO。现有 Data Asset 的当前 `name/sourceType/mimeType/sizeBytes` 仍表示当前 Asset 元数据，不用来冒充历史 Snapshot 的来源信息。

### Web 状态

```text
assetId
  → open preview
  → GET snapshot summaries
  → default latest snapshotId
  → GET snapshot detail
  → render readonly table
  → select another snapshotId
  → GET detail on demand
```

预览状态至少包含：

- `isPreviewOpen`；
- `previewAssetId`；
- `previewSnapshotId`；
- `snapshotSummaries`；
- `previewDetail`；
- `previewStatus: idle | loading-list | loading-detail | ready | error`；
- `previewError`。

预览选择只改变 `previewSnapshotId`，不改变生成状态。Composer 的生成依据始终显示并使用 `selectedAsset.latestSnapshot`；查看历史版本时不出现“使用此 Snapshot”或历史生成按钮。

### 表格行为

- 逻辑上保留 Snapshot 的全部字段顺序；最多 200 列。
- 预览展示前 25 行，并显示 `前 25 行 / 共 N 行`。
- 表格容器独立横向和纵向滚动；表头和第一列 sticky。
- 对不可见列执行懒渲染/列虚拟化，但保留固定列占位和完整横向滚动宽度，不能永久隐藏字段。
- `number` 使用既有 `formatValue` 规则，`null` 显示 `—`，boolean/date 按已解析值显示。
- 长文本单元格按列宽截断；通过 `title` 和可聚焦的完整值展示方式让键盘和辅助技术用户能读到完整内容。
- 不允许编辑、排序、筛选、复制为新 Snapshot 或直接改变原始数据。

## API / 外部契约

新增：

```text
GET /api/v1/data-assets/:assetId/snapshots
GET /api/v1/data-assets/:assetId/snapshots/:snapshotId
```

### Snapshot 列表

返回同一 Data Asset 的全部 SnapshotSummary，按 `version desc` 排序。列表不返回 `schema`、`preview` 或任何 object key。

### Snapshot 详情

返回一个 SnapshotDetail。API 必须确认：

1. `assetId` 存在且属于当前用户可见的 Project；
2. `snapshotId` 存在且属于该 `assetId`；
3. 当前用户对该 Project 至少拥有 `view` 权限。

不存在、跨 Asset 或跨 Project 的 Snapshot 统一返回稳定的不可见/不存在错误，不泄露资源存在性。

### 兼容策略

现有 `GET /api/v1/projects/:projectId/data-assets` 和 `GET /api/v1/data-assets/:assetId` 保持已有最新 Asset 读模型兼容。新预览器以 Snapshot 列表/详情接口为规范读取路径，不把历史 preview 塞入 Project 首屏列表；后续可在独立兼容变更中进一步缩减最新列表响应。

## 架构图

```text
User with Project view access
  → Web Data Snapshot summary / 查看数据
  → GET snapshot summaries
      ├─ 403/404 → modal error + retry/close
      └─ latest summary → GET latest detail
                          ├─ 403/404 → modal error, no fallback
                          ├─ success → readonly table
                          └─ network/5xx → retry in modal
  → select historical summary
  → GET historical detail
      ├─ success → replace preview only
      └─ failure → keep selected version + retry

Separate generation path:
  Composer generate
    → selected Data Asset latest Snapshot
    → Generation Job freezes latest snapshotId
    → Worker reads frozen Snapshot
```

## 数据流

1. Project 页面加载 Data Asset 摘要。
2. 用户点击“查看数据”，Web 请求 SnapshotSummary 列表。
3. Web 默认选择最高 `version` 的 Snapshot，并请求详情。
4. API 从 DB 读取 schema/preview，返回已脱敏于内部 key 的公开 DTO；本变更不做值脱敏，访问控制由 Project view 权限承担。
5. Web 将详情渲染为只读表格，不写入 Data Asset、Data Snapshot、Conversation 或 Revision。
6. 用户切换版本时只更新预览状态并按需请求详情；失败不自动回退。
7. 用户关闭预览后，Composer 和 Generation readiness 不发生变化。
8. 下一次生成仍由现有 API 根据 Data Asset 的最新 ready Snapshot 建立 Job；历史预览数据不进入生成请求。

## 权限、校验与异常处理

- 所有 Snapshot 列表/详情接口复用 Project 的 `view` 访问检查；前端按钮不是安全边界。
- `processing`、`failed`、`archived`、`deleted` Asset 不提供可用预览；界面显示当前状态和下一步，不渲染空的成功表格。
- Snapshot 列表为空时显示“暂无可用 Snapshot”；详情为空或 schema 无效时显示可解释错误。
- 详情网络失败时保留 modal、版本选择和错误原因，提供“重新加载”；不静默展示最新或其他版本。
- 旧 Snapshot 的来源元数据为空时分别显示“不可用”，不从当前 Asset 元数据回填到展示层。
- Modal 使用语义 `dialog`、可见标题、关闭按钮、键盘焦点顺序、表格 caption 和 `scope=col`；移动端保持 44px 触控目标，不允许页面级横向溢出。
- 长文件名、长字段名、长单元格值允许截断或换行，但完整值通过可访问的 title/详情方式保留。

## 迁移、兼容与回滚

### 数据库

在 `data_snapshots` 增加 nullable：

```text
source_name
source_type
mime_type
size_bytes
```

新 intake 成功写入 Snapshot 时同步保存这些来源元数据。既有 Snapshot 不做回填，不读取对象存储做迁移，不使用当前 Data Asset 元数据伪造历史来源；前端对 null 显示“不可用”。

### 兼容

- 不删除现有最新 Asset 读取字段。
- 不改变 source/normalized object key。
- 不改变 Generation Job、Chart Revision、Worker 或审核状态。
- 新 API 只读取已存在的 Snapshot 记录，并隐藏内部 object key。

### 回滚

- Web 回滚：移除“查看数据”入口、preview state/modal/table；不删除 Snapshot。
- API 回滚：停用新增 Snapshot 读取路由；保留现有 Asset latest read path。
- DB 回滚：只有在没有新代码依赖新增列且经过迁移安全评估后才允许反向迁移；默认保留 nullable 历史列，避免删除已写入的来源元数据。
- 不删除任何 Data Asset、Data Snapshot、原始对象或历史 Chart Revision。

## 日志、监控与可观测性

- 记录请求 ID、Project ID、Asset ID、Snapshot ID、响应状态和耗时；不记录 preview 内容、文件内容或 object key。
- 统计 Snapshot 列表/详情请求量、详情加载成功率、失败分类、平均响应体大小和前端重试次数。
- 前端错误状态包含可关联的请求错误 code，但不向用户暴露内部路径或数据库信息。
- 监控 200 列数据的详情响应和浏览器渲染耗时，发现超出首发目标时优先调整列懒渲染，不扩大数据读取范围。

## 测试策略

- 合同：SnapshotSummary/Detail 字段、nullable 来源元数据和 object key 不泄露。
- API：列表/详情 happy path、最新/历史、跨 Project、跨 Asset、无权限、无 Snapshot、失败状态。
- DB：nullable migration、已有数据不回填、新 intake 保存来源元数据。
- Web：入口、modal/sheet、默认最新、历史切换懒加载、加载/错误/空态、只读、无生成状态副作用。
- 响应式/可访问性：桌面、移动、键盘导航、sticky header/first column、长字段和 200 列不产生页面级横向溢出。
- 生成回归：查看历史预览后发起生成仍绑定最新 Snapshot，历史预览不会进入 Generation Job 输入。

## 需求追踪矩阵

| 需求 | 设计 | 任务 | 测试 | commit |
| --- | --- | --- | --- | --- |
| R1 上传后可手动打开最新数据预览 | Web 状态与表格行为 | T3/T4 | Web E2E | 待实现 |
| R2 同一 Asset 可切换历史 Snapshot | Snapshot 列表/详情 API、Web 状态 | T2/T3 | API + Web E2E | 待实现 |
| R3 历史预览只读且不影响生成 | ADR 0022、数据流 | T3/T5 | Generation regression + Web E2E | 待实现 |
| R4 25 行、全列、懒渲染可用 | 表格行为、响应式 | T4 | Web E2E + 人工视觉 | 待实现 |
| R5 权限和 object key 隔离 | API 权限/公开投影 | T1/T2 | API contract/integration | 待实现 |
| R6 来源元数据可追溯且旧数据不伪造 | 数据模型/迁移 | T1 | DB migration + API | 待实现 |
| R7 失败可解释并可重试 | 异常处理 | T3/T5 | Web E2E | 待实现 |
