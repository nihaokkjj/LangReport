# 最小生成闭环设计：发送消息生成 Evidence Block

> 状态：第一期已实施；第二至第四期待实施
>
> 日期：2026-09-11
>
> 目标：在 deterministic 模式下，用户发送一条明确的分析消息后，系统自动完成一次 Generation Cycle，并得到一个可追溯的 Draft Evidence Block。

## 1. 设计范围

本设计只覆盖第一阶段最小垂直闭环：

```text
一个 Project
  → 一个可用 Data Snapshot
  → 一个已确认 Metric Definition
  → 一条用户消息
  → 一次 Generation Cycle
  → 一个 Chart Artifact / Chart Revision
  → 一个 Draft Evidence Block
```

本轮默认使用 `GENERATION_MODE=deterministic`。确定性模式只用于验证产品链路和结果追溯；不把它描述为真实大模型分析。

### 目标

1. 用户点击一次“发送”后，消息被保存且自动创建 Generation Job。
2. Generation Job 能由 Generation Worker 和 Render Worker 完成。
3. 生成成功后，用户能在当前 Conversation 中看到图表和 Evidence Block。
4. 结果基于当前 Project 的完整 Data Snapshot，而不是固定示例数据或截断预览。
5. 结果能回溯到 Snapshot、Metric Definition、Analysis Brief、TransformPlan、字段血缘、Flint Spec、Theme 版本、Validation 和 Revision。
6. 缺少必要前置条件、需要澄清或生成失败时，系统给出可执行的下一步，不伪造成功产物。

### 非目标

本轮不实现或不以此作为完成条件：

- 自动批准、自动发布和完整 Review 评论工作流；
- 完整多页报告、Dashboard、PPT 排版和 Excel 回写；
- 真实百炼账户验收和多供应商模型；
- 多指标同时生成和复杂指标语义层；
- 完整 Visual Template 编辑器；
- HTML 导出；
- 全部第一阶段 TransformPlan 语义操作；
- 实时协作、公开分享和用户代码执行。

## 2. 当前实现与差距

当前已经存在以下能力：

- Data Asset 解析并生成不可变 Data Snapshot；
- Conversation 消息持久化；
- Generation Job、Lease、Fencing Token 和失败记录；
- deterministic Generation Cycle；
- 受限 TransformPlan 执行和字段血缘；
- Flint Spec、SVG、PNG 和 Chart Revision；
- Evidence Block 持久化和 Web 轮询。

当前阻断最小闭环的主要差距：

1. Web 的 `sendMessage` 只保存消息，`generateEvidence` 才创建 Job，用户必须操作两次。
2. 消息接口和生成接口分别写入用户消息，合并时会产生重复消息风险。
3. 生成依赖 PostgreSQL、MinIO、API、Generation Worker 和 Render Worker 的共同运行，但真实联调尚未验收。
4. `needs_clarification` 已存在于后端合同，Web 没有完整展示和继续回答流程。
5. Analysis Brief 当前可能把缺少时间范围和粒度的内容直接写成 `confirmed`。
6. Evidence finding 使用前 500 行预览计算事实，可能与完整图表数据不一致。
7. 生成时默认取 Project 最新的 confirmed Metric Definition，多个指标时存在口径歧义。

## 3. 用户流程

### 3.1 生成前置条件

用户发送生成型消息前，当前 Conversation 所属 Project 必须满足：

- 存在状态为 `ready` 的 Data Asset；
- Data Asset 存在可用 Data Snapshot；
- Project 只有一个可用的 confirmed Metric Definition，或用户明确传入 `metricDefinitionId`；
- 用户拥有 Project 的 `Editor` 或更高权限。

前置条件不足时：

1. 仍然保存用户消息；
2. 不创建 Generation Job；
3. 返回 `nextAction`；
4. Web 显示下一步，例如“请先上传数据”或“请先确认指标口径”。

不得创建一个缺少输入的假 Job，也不得展示旧的成功图表作为本次结果。

### 3.2 正常生成流程

```text
用户发送消息
  → 保存一条 user message
  → 固化 Conversation projection
  → 固化 Snapshot / Metric / Theme / Model Route
  → 创建 queued Generation Job
  → Generation Worker 读取完整 Snapshot
  → deterministic Generation Cycle
  → 执行受限 TransformPlan
  → 计算完整 resultSummary
  → Compile / Validate
  → Render Worker 生成 Vega-Lite / SVG / PNG
  → 创建不可变 Chart Revision
  → 创建或更新 Draft Evidence Block
  → 追加一条 assistant 结果消息
  → Web 刷新 Evidence
```

一次用户发送只允许产生：

- 一条 user message；
- 一个 Generation Job；
- 成功时一个主 Chart Artifact 和一个 Chart Revision；
- 一个对应的 Evidence Block。

### 3.3 澄清流程

当时间范围、时间粒度、字段映射或数据含义不足以安全生成时：

```text
Generation Job
  → needs_clarification
  → 保存 clarification questions
  → Web 展示问题和可选项
  → 用户补充回答
  → 新建下一次 Generation Cycle
```

原 Job 保持不可变，不能把澄清后的输入直接覆盖到原 Job。澄清状态不得创建 Chart Revision 或 Evidence Block。

### 3.4 失败流程

失败时必须保存：

- `errorCode`；
- 面向用户的 `errorMessage`；
- 失败阶段；
- Plan Validation / Render Validation；
- Generation Audit；
- 可否重试。

Web 应显示失败原因和下一步。只有明确标记为可恢复的失败才显示“重试”；输入不完整、字段不存在和指标歧义应要求用户修正输入后重新发送。

## 4. API 设计

### 4.1 发送消息并请求生成

扩展现有接口：

```text
POST /api/v1/conversations/:conversationId/messages
```

请求：

```json
{
  "content": "按月份展示各区域销售额，并说明数据来源和数据质量提示",
  "generate": true,
  "dataAssetId": "<data-asset-id>",
  "metricDefinitionId": "<metric-definition-id>",
  "renderer": "vega-lite",
  "clientRequestId": "<stable-client-request-id>"
}
```

字段规则：

- `content` 必填；
- `generate` 默认为 `false`，兼容普通 Conversation 消息；
- `dataAssetId` 在 `generate=true` 时必填；
- `metricDefinitionId` 在 Project 只有一个 confirmed 指标时可省略；有多个时必须提供；
- `clientRequestId` 用于防止浏览器重复提交；
- `renderer` 第一轮固定为 `vega-lite`。

成功创建 Job 时返回 `202`：

```json
{
  "message": { "id": "...", "role": "user", "content": "..." },
  "job": { "id": "...", "status": "queued" },
  "nextAction": { "type": "poll_generation_job", "jobId": "..." }
}
```

消息保存成功但缺少前置条件时返回 `201`：

```json
{
  "message": { "id": "...", "role": "user", "content": "..." },
  "job": null,
  "nextAction": {
    "type": "prepare_generation",
    "code": "DATA_SNAPSHOT_REQUIRED",
    "message": "请先上传数据并生成可用 Data Snapshot"
  }
}
```

服务端必须在 `generate=true` 时禁止创建固定的 assistant 占位话术。成功、澄清或失败的 assistant 消息由 Generation/Render 流程在终态统一追加，避免一条消息出现两个互相矛盾的回答。

### 4.2 查询 Generation Job

继续使用：

```text
GET /api/v1/generation-jobs/:jobId
```

响应必须包含：

- Job 状态；
- `snapshotId`；
- `analysisBriefSnapshot`；
- `metricDefinitionSnapshot`；
- Intent；
- TransformPlan；
- 字段血缘；
- Flint Spec；
- `resultSummary`；
- Plan Validation；
- Render Validation；
- Revision 摘要；
- 输出对象地址；
- 错误和审计信息。

### 4.3 幂等规则

同一个 `clientRequestId` 只能对应一个消息和一个 Generation Job。重复请求返回已有结果，不得重复：

- 写入用户消息；
- 创建 Job；
- 追加 Chart Revision；
- 追加 Evidence Block。

如果同一个幂等键对应不同输入，返回 `409 IDEMPOTENCY_CONFLICT`。

## 5. Generation Job 和状态机

### 5.1 状态

```text
queued
  → profiling
  → planning
  → transforming
  → compiling
  → rendering
  → validating
  → succeeded
```

分支：

```text
planning / transforming / compiling
  → needs_clarification

任意执行阶段
  → failed
```

`needs_clarification` 和 `failed` 都是终态；用户补充或修改输入后创建新的 Generation Cycle。

### 5.2 不变量

1. 一个 Job 只使用一个 Data Snapshot。
2. 一个 Job 只创建一个主 Chart Revision。
3. Job 进入 `succeeded` 前必须已经存在有效 Revision、Evidence Block、输出对象和 Render Validation。
4. Job 进入 `needs_clarification` 时不得存在成功的 Chart Revision。
5. 过期 Worker 不能凭借旧 Lease 覆盖新的状态或提交结果。
6. Approved Revision 不被本流程修改。

## 6. 全量结果摘要与预览分离

### 6.1 原则

`previewData.rows` 只用于前端交互预览，最多保存 500 行；它不能参与业务事实、finding 或审核摘要计算。

TransformPlan 执行完成后，必须基于完整 `TransformResult` 计算 `resultSummary`。

### 6.2 最小结构

```json
{
  "version": "v1",
  "sourceRowCount": 1000,
  "transformedRowCount": 48,
  "previewRowCount": 48,
  "columns": ["月份", "区域", "销售额_sum"],
  "numericSummaries": [
    {
      "field": "销售额_sum",
      "count": 48,
      "sum": 6200000,
      "min": 76000,
      "max": 172000
    }
  ],
  "topGroups": [
    {
      "field": "销售额_sum",
      "value": 172000,
      "dimensions": { "月份": "2026-06", "区域": "华东" }
    }
  ],
  "qualityWarnings": [],
  "calculatedAt": "2026-09-11T00:00:00.000Z"
}
```

### 6.3 保存位置

`resultSummary` 至少保存到：

- `generation_jobs.result_summary`；
- `evidence_blocks.result_summary`；
- `chart_revisions.result_summary`。

这样 Job、Evidence Block 和不可变 Revision 都能使用同一份冻结事实。`finding` 只能引用 `resultSummary`，不得重新扫描 `previewData`。

## 7. Analysis Brief 和 Metric Definition 规则

### Analysis Brief

创建 Job 时可以从消息形成 Brief，但必须区分：

- `draft`：存在缺少的时间范围、时间粒度或受众等必要约束；
- `confirmed`：生成所需约束已经确认。

缺失约束不能因为系统自动填充默认值而标记为 `confirmed`。如果 deterministic 规则能够识别字段但不能确认业务含义，应保留为待确认并进入澄清流程。

### Metric Definition

本轮最小闭环只保证单指标：

- Project 必须有一个 confirmed Metric Definition；
- 有多个 confirmed 指标时，必须通过 `metricDefinitionId` 明确选择，否则返回 `METRIC_SELECTION_REQUIRED`；
- Job、Evidence Block 和 Revision 都保存选择时的 Metric Definition 快照；
- 模型推断不能自动写入 confirmed Metric Definition。

## 8. Web Workbench 设计

### 8.1 发送按钮

发送按钮执行单一的生成型动作：

1. 禁止重复点击；
2. 提交消息和生成请求；
3. 清空输入框前先确认服务端返回成功；
4. 收到 Job 后进入生成状态并开始轮询；
5. 没有 Job 时展示 `nextAction`，不显示旧结果为本次结果。

普通不生成消息仍可保存，但不能把固定 assistant 话术展示为模型回答。

### 8.2 状态展示

必须覆盖：

- 排队中；
- 读取快照；
- 理解意图；
- 执行变换；
- 生成规范；
- 渲染图表；
- 最后校验；
- 需要澄清；
- 生成失败；
- 已完成。

`needs_clarification` 页面至少展示：

- 问题文本；
- 原因；
- 可选项（如果有）；
- 提交回答按钮；
- “将创建新的 Generation Cycle”的说明。

### 8.3 成功结果

成功后当前 Conversation 同时展示：

- 图表预览；
- finding；
- 数据来源和 Snapshot；
- 指标口径；
- TransformPlan 摘要；
- 字段血缘；
- 数据质量警告；
- Theme 名称和版本；
- Revision 和 Validation 状态；
- PNG / SVG 下载入口。

前端预览可以限制为 500 行，但要显示“预览”标识，并显示完整结果行数来自 `resultSummary.transformedRowCount`。

## 9. 实施分期

### 第一期：打通发送到 Job

目标：一次发送只产生一条消息和一个 Job。

- 扩展 Conversation message request/response contract；
- 增加 `generate`、`dataAssetId`、`metricDefinitionId`、`clientRequestId`；
- 消除生成型消息的重复写入；
- 实现前置条件检查和 `nextAction`；
- 前端发送后自动进入轮询；
- 补齐 `needs_clarification` 状态展示。

完成标志：已实现并通过类型、合同、数据库迁移校验；发送明确销售分析问题后，数据库中只有一条对应用户消息和一个 queued Job。并发重复提交由数据库唯一键和 API 幂等冲突处理共同兜底。

### 第二期：修复 Evidence 事实

目标：图表、finding 和摘要事实一致。

- 在完整 TransformResult 上计算 `resultSummary`；
- 将摘要写入 Job、Evidence Block、Revision；
- `buildFinding` 改为只读取摘要；
- Web 明确区分完整统计与 500 行预览；
- 增加超过 500 行数据的测试。

完成标志：最高值、数据点数量和完整结果行数不受预览截断影响。

### 第三期：本地五服务联调

目标：形成可重复的本地验收路径。

- 启动 PostgreSQL 和 MinIO；
- 执行数据库 Schema 同步或迁移；
- 启动 API、Generation Worker、Render Worker；
- 使用销售 CSV 完成生成；
- 验证 PNG、SVG、Vega-Lite 对象存在并可下载；
- 验证刷新页面后 Project、Conversation、Evidence Block 和 Revision 仍存在；
- 将流程固化为脚本或自动化验收命令。

完成标志：不依赖手工修改数据库，连续两次运行可以得到可追溯 Draft Evidence Block。

### 第四期：契约和质量收口

- 修复 HTTP route contract 的 63/65 基线差异；
- 修正 Brief 的 `draft` / `confirmed` 边界；
- 完善单指标选择规则；
- 增加错误、重试、澄清和幂等测试；
- 运行 Web typecheck；
- 进行桌面和移动端基本浏览器验证。

## 10. 测试设计

### 单元测试

至少增加：

1. `generate=true` 时消息只写入一次；
2. 同一 `clientRequestId` 不重复创建消息或 Job；
3. 无 Snapshot 时返回 `DATA_SNAPSHOT_REQUIRED`；
4. 无 confirmed Metric Definition 时返回 `METRIC_DEFINITION_REQUIRED`；
5. 多指标且未选择时返回 `METRIC_SELECTION_REQUIRED`；
6. `needs_clarification` 不创建 Revision 或 Evidence Block；
7. `resultSummary` 基于完整结果而不是 500 行预览；
8. finding 使用完整摘要中的最高值和行数；
9. 失败状态保存错误码、错误阶段和可重试标志。

### 本地端到端验收

使用合成销售 CSV 执行：

```text
启动基础设施
  → 创建/读取 Project
  → 上传或粘贴 CSV
  → 确认“销售额” Metric Definition
  → 发送“按月份展示各区域销售额”
  → 自动创建 Job
  → Job succeeded
  → 生成 Chart Revision
  → 生成 Draft Evidence Block
  → 读取完整追溯信息
  → 下载 PNG / SVG
```

验收必须断言：

- 消息数量和角色正确；
- Job 数量为一个；
- Job 使用当前 Snapshot；
- Revision 状态为 `draft`；
- Evidence 状态为 `draft`；
- `resultSummary` 的完整行数和最高值正确；
- TransformPlan 和字段血缘存在；
- Flint Spec 数据来自当前 Snapshot 的变换结果；
- Theme 版本、Plan Validation 和 Render Validation 存在；
- PNG 和 SVG 可读取；
- 刷新页面后结果仍可读取。

## 11. 完成判定

以下是完整最小闭环的最终完成条件；当前只声明其中“第一期：打通发送到 Job”已完成：

1. 用户一次发送即可触发生成，不需要再次点击“生成证据”；
2. 消息、Job、Revision 和 Evidence Block 没有重复记录；
3. deterministic 模式处理的是 Project 当前 Data Snapshot；
4. Generation Worker 和 Render Worker 完成真实本地联调；
5. 成功结果包含完整来源、口径、变换、规范、主题和校验记录；
6. finding 和统计事实基于完整变换结果；
7. 缺少输入、需要澄清和失败时不显示成功图表；
8. 相关测试、TypeScript 检查和本地端到端验收通过；
9. Approved 不属于本轮自动结果，初始产物始终是 Draft。

## 12. 后续缺口登记

以下内容不影响本设计的最小闭环，但不能标记为第一阶段全部完成：

- 真实百炼模型和供应商账户验收；
- HTML 固定 Revision 导出；
- 完整 Visual Template 复制、编辑和对比度校验；
- 完整 Review 评论创建、查看和解决；
- 全部显式 TransformPlan 语义操作；
- 多指标选择和更通用的指标语义；
- 完整桌面/移动浏览器回归；
- 生产部署和权限链路验收。
