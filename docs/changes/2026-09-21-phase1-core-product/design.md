# 第一阶段核心产品可用化设计

- 变更编号：`CHG-2026-09-21-phase1-core-product`
- 状态：`APPROVED`
- 负责人：LangReport owner agent
- 创建时间：2026-09-21
- 更新时间：2026-09-21

## 现状与约束

当前仓库已经有以下实现事实：

| 区域 | 当前事实 | 本变更处理方式 |
| --- | --- | --- |
| Web | `apps/web/app/page.tsx` 已串联 Project、数据、Brief、Metric、生成、编辑和审核的主要交互；Web E2E 目前 mock `/api/**` | 保留信息架构，补真实状态/导出/失败恢复，并增加无 mock live smoke |
| API | `apps/api/src/routes.ts`、`chart-routes.ts` 已提供 Project、Conversation、数据快照、Generation Job、Revision、评论和审核接口 | 只补齐实际缺口和稳定错误合同；同步 `api-console` |
| Generation | `packages/generation` 已有受限 TransformPlan、Readiness Gate、两轮修复和 deterministic route | 不扩大操作集合，确保确认的 Brief/Metric 和单 Snapshot 输入真正进入 Job，并由 Data Engine 对完整 TransformResult 计算版本化 `resultSummary` |
| Worker | Generation Worker 消费 `queued`，Render Worker 消费 `rendering`，两者有 PostgreSQL Lease/Fencing Token | 增加可观测的 live 运行证明和幂等/失败恢复检查 |
| Chart/Storage | 已生成 Vega-Lite、SVG、PNG，并在 Revision 中固化来源和校验 | 增加安全的固定 Revision HTML 输出，补齐输出合同 |
| DB | Snapshot、Brief、Metric、Job、Revision、Evidence、Review 相关表已存在 | 优先使用现有 JSON 输出列；若实际合同需要迁移，只增加向后兼容字段并单独验证 |

约束来自 `AGENTS.md`、`CONTEXT.md`、第一阶段产品规格和 Agent Loop 规范：Data Snapshot 不可变，TransformPlan 由受限执行者运行，Approved Revision 只读，成功必须同时有 Plan/Render Validation，长期记忆和模板变更不能被模型自动写入。

## 设计目标与非目标

### 目标

1. 让新用户可从一个清晰的 Consulting Project 流程完成首个 Evidence Block。
2. 让真实 API、两个常驻 Worker、数据库和对象存储共同完成异步闭环。
3. 让所有成功、失败、澄清、重试和审核状态都有用户可理解的下一步。
4. 让固定 Revision 成为唯一的预览、审核和导出边界。
5. 用一个稳定的 live smoke 将产品主路径锁定，避免只依赖包内单测和 API mock。

### 非目标

不实现多文件 Join、Dashboard、完整报告排版、实时协作、外部公开分享、任意代码执行、插件市场或跨用户 Workspace 管理。真实百炼调用不作为产品内的质量承诺，但作为发布环境的强制连通性和结构化输出门禁。

## 方案选型

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 继续补现有模块，增加一条真实 live smoke | 复用已有领域模型、租约、API 和 Web；改动面最小 | 需要清理现有状态边界和 fixture 假象 | 采用 |
| 另建一个同步“第一阶段服务” | 流程容易演示 | 会绕过 Job/Worker/Revision 不变量，形成第二套产品 | 拒绝 |
| HTML 导出只返回 Vega-Lite JSON | 实现简单 | 不满足用户可下载的 HTML 产物 | 拒绝 |
| HTML 导出为服务端验证 SVG 的自包含 HTML | 不执行用户代码，离线可打开，能携带 Revision/来源元数据 | 首版交互能力低于浏览器实时预览 | 采用；交互预览仍由 Web 页面提供 |

## 模块边界

- `apps/web`：四个固定入口、Job 状态、Evidence/Trace、编辑器、审核和固定 Revision 下载；不计算业务指标、不直接读对象存储。
- `apps/api`：Project/Conversation 作用域、输入前置条件、Job 创建/重试/取消、Revision 审核转换、评论、固定 Revision 输出；所有新/改接口同步 `api-console`。
- `packages/contracts`：HTTP、Job、Validation、Output Format 和 HTML 导出响应合同；禁止用隐式 `any` 扩展输出。
- `packages/data-engine`：只读取冻结 Snapshot，执行白名单 TransformPlan 并产生字段血缘和质量记录。
- `packages/generation`：Profile/Plan/Transform/Compile/Validate 和有限 Repair；不持久化 Job，不决定审核。
- `apps/generation-worker`：领取 `queued` Job，装配冻结输入，推进到 `rendering` 或可解释终态。
- `apps/render-worker`：领取 `rendering` Job，执行 Flint/Vega-Lite，生成 Vega-Lite/SVG/PNG/HTML，幂等写入 Revision/Evidence。
- `packages/chart`：Revision append-only、状态转换和固定版本关系；Approved 内容不可变。
- `packages/storage`：按 Workspace/Project/Asset/Snapshot/Revision 作用域存取对象，不暴露内部 object key。
- `apps/web/app/api-console`：展示所有变更后的 OpenAPI、请求示例和 live 场景步骤。

## 数据模型与状态流转

不新增业务实体。一次成功路径的对象关系固定为：

```text
Workspace
  └─ Project
      ├─ Conversation
      │   ├─ Data Asset ── Data Snapshot (immutable)
      │   └─ Analysis Brief + Metric Definition
      └─ Generation Job (one Snapshot + one Brief + one Template version)
          └─ Chart Artifact
              └─ Chart Revision (append-only)
                  └─ Evidence Block + Review + fixed outputs
```

Job 状态：

```text
queued → profiling → planning → transforming → compiling → rendering → succeeded
   ├──────────────────────────────→ needs_clarification
   └──────────────────────────────→ failed → retry → queued
```

Revision 状态：

```text
draft → in_review → approved
  └──────────────→ changes_requested → draft (new edit creates new Revision)
approved → archived
```

状态约束：

- 一个 Generation Cycle 只引用一个 Snapshot、一个 Brief、一个 Visual Template 版本，并最多落一个主 Revision/Evidence Block。
- 逻辑编辑必须重新执行 TransformPlan；纯视觉编辑也必须追加 Revision。
- `approved` Revision 不能编辑、覆盖或重新进入可编辑状态；回滚/复制只能创建新 Draft。
- Render Validation 必须确认 Vega-Lite、SVG、PNG 和 HTML 四种输出存在且可读取，才能把 Job 置为 `succeeded`。
- Evidence Block 的 `chartRevisionId`、`snapshotId`、`generationJobId` 和来源快照保持一致；重复 Worker 提交只能复用既有 Revision/Evidence。
- `previewData` 只用于最多 500 行的交互预览；业务事实和 finding 只能读取由完整 TransformResult 计算并在 Job、Revision、Evidence 三处固化的同一份 `resultSummary`。
- Job 成功时 `generationAudit.renderValidation` 必须等于最终合并后的 Render Validation，包含静态 HTML 校验，不能停留在基础渲染校验。

## API / 外部契约

### 保留并校验的核心接口

`/api/v1/projects`、`/conversations`、`/data-assets`、`/analysis-brief`、`/metric-definitions`、`/generation-jobs`、`/chart-artifacts/:artifactId/revisions`、`/chart-revisions/:revisionId/*` 继续作为唯一产品入口。

### 本变更的契约调整

1. `GET /api/v1/chart-revisions/:revisionId/outputs/:format` 的 `format` 增加 `html`，并在合同中明确只接受 `vega-lite | svg | png | html`。
2. 输出响应带固定 `revisionId`、格式、Content-Type、Content-Disposition 和不可变对象读取结果；请求不能使用 Artifact head 代替 Revision ID。
3. Job/Revision 的失败响应统一返回稳定 `code/message/details/requestId`，并在 Web 显示下一步；不向客户端暴露密钥、Provider 原始错误或内部 object key。
4. 审核转换继续使用 `expectedStatus`，防止迟到请求覆盖状态；批准和要求修改必须保存可读 Review note/Comment。
5. 任何新增或变更的 HTTP 合同在 `apps/web/app/api-console` 中同步 OpenAPI 展示、请求体示例和场景编排。

## 架构图

```text
┌──────────────┐   HTTP + scope   ┌──────────────┐
│ Web Workbench│ ────────────────▶ │ Fastify API  │
└──────┬───────┘                  └──────┬───────┘
       │ status / evidence / export       │ transaction + idempotency
       │                                  ▼
       │                         ┌──────────────────┐
       │                         │ PostgreSQL       │
       │                         │ Project/Brief/   │
       │                         │ Snapshot/Job/   │
       │                         │ Revision/Review │
       │                         └──────┬───────────┘
       │                                │ queued/rendering + lease
       │                                ▼
       │                         ┌──────────────────┐
       │                         │ Generation Worker│
       │                         │ Profile→Validate│
       │                         └──────┬───────────┘
       │                                │ rendering
       │                                ▼
       │                         ┌──────────────────┐
       │                         │ Render Worker    │
       │                         │ SVG/PNG/HTML     │
       │                         └──────┬───────────┘
       │                                │ Revision/Evidence + objects
       │                                ▼
       │                         ┌──────────────────┐
       └─────────────────────────│ MinIO / Storage  │
                                 └──────────────────┘
```

失败路径：输入前置条件不满足时 API 返回澄清或可操作的 4xx，不创建伪成功 Job；解析/变换/模型/渲染失败在 Job 中留下稳定错误和审计；Lease 失效的 Worker 不得提交结果，过期 Job 回到合法队列状态；任何输出缺失时不创建 Draft Revision。

权限边界：所有 Project、Conversation、Asset、Snapshot、Job、Revision、Comment 和输出读取先通过认证用户的 Workspace/Project 作用域检查；Model Credential 只在 Worker 运行时解密；浏览器不接触密钥和对象存储凭据。

## 数据流

1. 用户创建或选择 Project，API 返回其私有 Workspace 作用域和固定 Visual Template。
2. 用户上传/粘贴数据，API 解析并将原始对象、规范化对象和 Snapshot 元数据以一次可补偿流程写入；历史 Snapshot 只读。
3. 用户确认 Metric Definition 和 Analysis Brief；其快照与来源 Conversation 写入后作为生成前置条件。
4. 用户提交 Generation Cycle；API 在幂等键和输入指纹约束下创建一个 Job，并冻结 Snapshot/Brief/Metric/Theme/Model Route/Conversation projection。发布环境的真实百炼门禁在部署前单独执行，不把临时供应商配置注入已排队 Job。
5. Generation Worker 读取冻结对象，执行受限变换和校验，并对完整 TransformResult 单次扫描生成 `resultSummary`；最多 500 行的 `previewData` 与摘要分开保存，需要澄清或失败时释放 Lease 并保存原因，成功则转 `rendering`。
6. Render Worker 领取 `rendering` Job，只用 `resultSummary` 生成候选 finding，在同一 Lease 下生成四种固定输出，写入对象存储，再把同一摘要固化到 Chart Revision 和 Evidence Block；静态 HTML 校验合并进入最终 Render Validation 与 Generation Audit 后，Job 才能置为 `succeeded`。
7. Web 只通过 Job status/projection 和 Evidence API 更新 UI；收到终态后重新读取完整 Evidence 和 Review，旧请求由会话令牌/AbortController 丢弃。
8. Editor/Reviewer 以 Revision ID 操作；编辑追加新 Job/Revision，审核追加 Review/Comment，导出按固定 Revision 读取。

## 权限、校验与异常处理

- 数据格式、大小、列名、行数和时间字段在 intake 层校验；不静默去重、不把缺失月份补成零。
- 生成前必须有 Project、Conversation、Ready Snapshot、确认/显式待确认 Metric、确认 Brief 和有效 Template；缺失项给出明确补齐动作。
- TransformPlan 只接受合同内操作，禁止 SQL、Python、JavaScript 和任意模型生成代码。
- Plan Validation 和 Render Validation 分开保存；验证失败最多自动修复两轮，预算用尽后 Job 为 `failed` 或 `needs_clarification`。
- 审核转换采用期望状态并发条件；Approved Revision 的编辑、导出非固定头和重复批准返回可解释错误。
- HTML 生成只接受服务端已经验证的 SVG/Revision 元数据，HTML 文本中的用户内容统一转义；不加载外部脚本，不执行用户提供代码。
- 发布门禁必须使用隔离的真实百炼请求验证认证、端点、模型 ID、结构化输出合同和错误归一化；日志只保存 request ID、耗时和完成原因等脱敏摘要，不保存 API Key 或供应商原始正文。

## 迁移、兼容与回滚

- HTML object key 继续复用 `generation_jobs.outputs` 和 `chart_revisions.outputObjects`；迁移 `0027_generation_result_summary.sql` 向 Job、Revision、Evidence 增加 nullable JSONB `result_summary`，兼容历史记录。
- 旧 Revision 缺少 HTML 时标记为历史兼容状态，不能伪造 `html`；可对旧 Revision 执行显式“重新渲染固定版本”任务，仍不覆盖原 Revision。
- 新输出格式在 API/Worker/Storage/Contracts/Web/API Console 同步发布；旧 `svg/png/vega-lite` 下载路径保持兼容。
- 回滚优先回滚 Web/API 对新格式的暴露并保留已写入对象；不删除历史 Snapshot、Revision 或审核记录。

## 日志、监控与可观测性

- API 记录 requestId、Project/Job/Revision 作用域和稳定错误码，不记录密钥和原始模型正文。
- Worker 记录 Job ID、状态转换、attempt、fencing token、repairCount、validation 状态和耗时；Provider 只记录受限 Model Invocation 摘要。
- live smoke 必须收集 API 响应、Job 状态序列、Revision/Evidence ID、输出格式和清理结果，敏感值全部脱敏。
- 发布前可按数据、口径、变换、渲染、权限和模型配置错误分类统计失败。

## 测试策略

- Contract/unit：Output Format、HTML 转义、状态转换、固定 Revision、TransformPlan 和错误合同。
- API integration：Project/Conversation/Asset/Snapshot/Brief/Metric/Job/Review/Comment/Export 的成功、幂等、越权和失败路径。
- Worker integration：真实测试 PostgreSQL/MinIO 下的 Generation→Render→Revision/Evidence、租约接管、重复提交和四种输出。
- Web E2E：保留快速 mock 测试覆盖响应式 UI，同时新增一个无 mock live smoke 覆盖用户主路径；发布门禁另执行真实百炼结构化调用。
- Build/ops：迁移校验、文档检查、类型检查、离线测试、构建和隔离资源清理。

## 需求追踪矩阵

| 需求 | 设计 | 任务 | 测试 | commit |
| --- | --- | --- | --- | --- |
| R1 Project/Conversation 可创建、切换、重开 | 模块边界、数据流 1/7 | T1、T4 | API integration、live smoke、Web E2E | 已验证 |
| R2 Snapshot/画像/质量/历史预览 | 数据流 2、权限校验 | T2 | data-assets integration、live smoke、Web E2E | 已验证 |
| R3 Brief/Metric/澄清门禁 | 数据流 3、异常处理 | T3 | readiness/generation、API integration、live smoke | 已验证 |
| R4 真实异步 Generation→Render | 架构图、数据流 4-6 | T4、T5 | worker integration、live smoke | 已验证 |
| R5 可追溯 Chart Revision/Evidence | 状态流转、数据流 5-8 | T5、T8 | >500 行单测、worker/API integration、live smoke | 已验证；完整摘要三处一致且 finding 不读预览 |
| R6 编辑追加新 Revision | 状态流转、异常处理 | T6 | chart/generation/API integration、Web E2E | 已验证 |
| R7 Review/Comment/Approved 只读 | 状态流转、权限校验 | T7 | API integration、Web E2E、live smoke | 已验证 |
| R8 PNG/SVG/HTML/Vega-Lite 固定导出 | API 契约、迁移兼容 | T5、T8 | contract/render/API/live smoke | 已验证；发布门禁待执行 |
| R9 刷新/重登可恢复 | 数据流 7、权限校验 | T4、T7 | live smoke、Web E2E | 已验证 |
| R10 无 mock 发布证明 | 架构图、可观测性 | T8 | phase1 live smoke | 已验证；真实百炼待执行 |
