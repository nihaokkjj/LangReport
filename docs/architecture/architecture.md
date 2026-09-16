# LangReport 系统架构

## 1. 目标

LangReport 第一阶段的核心目标，是把咨询顾问的客户数据和 Analysis Brief，可靠地转化成可审核的图表证据模块。完整产品边界见 [phase1-consulting-report.md](../product/phase1-consulting-report.md)。系统必须同时满足以下要求：

- 数据来源和转换过程可追溯
- 图表规范和渲染结果可复现
- 内部 Workspace 与 Project 的权限隔离；用户直接管理自己的 Project
- 长短期记忆可控且可审计
- 插件扩展不引入任意服务器端代码执行
- 生成过程可异步执行、可重试、可观察

## 2. MVP 边界

第一阶段目标支持咨询 Project、Project 内 Conversation、CSV/XLSX/JSON/粘贴表格、Analysis Brief、已确认 Metric Definition、有限 TransformPlan、Line/Bar/Area 主图表、Evidence Block、Visual Template、Chart Revision、Review，以及浏览器交互预览和固定 Revision 导出。当前渲染/下载合同已实现 Vega-Lite JSON、PNG 和 SVG；HTML 尚未实现，是第一阶段未完成项。

第一阶段不支持数据库、外部 API、实时数据源、跨文件 Join、Dashboard、实时多人编辑、Workspace 外部公开分享、用户自定义服务器端代码、插件市场、完整 PPT 排版或强监管行业合规承诺。单次 Generation Cycle 只绑定一个 Data Snapshot 和一个 Visual Template 版本，并创建一个主 Evidence Block。

## 3. 系统形态

```text
                         ┌─────────────────────┐
                         │   Web App            │
                         │  对话 / 数据 / 图表   │
                         └──────────┬──────────┘
                                    │ HTTPS
                         ┌──────────▼──────────┐
                         │ API 模块化单体        │
                         │ 鉴权 / 项目 / 数据    │
                         │ 记忆 / 图表 / 协作    │
                         └──────┬─────────┬─────┘
                                │         │
                      ┌─────────▼───┐ ┌──▼────────────┐
                      │ PostgreSQL  │ │ 私有对象存储   │
                      │ 元数据/权限 │ │ 原始文件/产物  │
                      └─────────────┘ └───────────────┘
                                │
                         ┌──────▼────────┐
                         │ Generation Job │
                         │ 生成→渲染状态   │
                         └───┬────────┬───┘
                             │        │
                  ┌──────────▼──┐ ┌──▼─────────────┐
                  │ Generation  │ │ Render Worker   │
                  │ Worker/Cycle│ │ flint-chart     │
                  │ 调度/生成/校验│ │ Vega-Lite/导出  │
                  └─────────────┘ └────────────────┘
```

初期采用模块化单体 API 加独立 Worker，而不是一开始拆分成大量微服务。模块之间通过明确的领域接口和异步任务交互；当负载或团队规模证明需要时，再拆分部署单元。

## 4. 模块边界

### Workspace Access

负责用户身份、内部 Workspace、Member、Workspace Role、Project Role 和所有租户边界检查。每个认证用户自动解析到自己的私有 Workspace，用户不选择、不切换 Workspace，也没有成员管理入口。任何 Project、Data Asset、Conversation、Memory、Plugin 或 Chart Artifact 查询仍必须携带 Workspace 作用域。

### Project

负责 Project 的创建、列表、归档、主题继承、Project Member、Analysis Brief、Metric Definition、Visual Template 和项目级配置。用户直接管理自己的 Project；Project Member 授权结构暂时保留用于兼容和后续协作，但第一阶段不提供 Workspace 成员管理。

### Data

负责文件上传、格式解析、字段画像、Data Asset 和 Data Snapshot。HTTP upload/paste 只负责传输解析、Project action 权限、intake command 组装和安全错误响应；Data Asset intake module 负责来源 Conversation 与 Project 关系校验、Conversation-scoped canonical key、解析编排、`processing → ready/failed` 状态和 PostgreSQL/S3 补偿。原始文件进入私有对象存储，解析后的结构化快照进入受控存储。一次 intake 成功后，Snapshot 元数据和 `ready` 状态在同一 PostgreSQL transaction 中提交。

### Conversation

负责消息、附件引用、当前对话上下文和 Generation Cycle/Generation Job 的创建。Conversation 可以引用 Project 资产；第一阶段单个 Generation Cycle 和 Chart Revision 只绑定一个 Data Snapshot。

### Memory

负责 Conversation Memory、Memory Candidate、Project Memory 和当前用户私有 Workspace Memory。长期记忆写入必须经过确认，并保存来源、创建人、更新时间、置信度和删除状态；Workspace Memory 不跨用户共享。

### Generation

负责拥有 Generation Cycle 的阶段顺序、澄清/失败语义、模型调用 seam、数据执行、指标口径、Visual Template 和校验修复。公共入口是 `GenerationCycle`；其内部使用有限 LangGraph `StateGraph` 表达准备、规划、变换、编译、校验和最多两轮修复，对外不泄漏框架类型。Model Gateway 同时保留确定性 Adapter，并已接入百炼兼容 HTTP 路径；是否调用真实模型由冻结的 Model Route Snapshot 和 Worker 配置决定。首期使用 `canonical_text_context`：API 在 Job 创建时冻结 Conversation 的版本化文本投影和哈希，Worker 只消费该快照。Generation Job 将 `planValidation` 与 `renderValidation` 分列保存；前者覆盖计划/Flint Spec，后者覆盖具体 Vega-Lite、SVG、PNG 产物。Flint Spec 由经过校验的计划和固定模板确定性编译，不要求模型直接生成可执行图表规范。一次 Cycle 最多执行两轮自动修复。

### Chart

负责 Chart Artifact、Chart Revision、Evidence Block、Flint 输入、Vega-Lite 输出、静态导出、版本关系和渲染元数据。

### Collaboration

负责评论、分享、Review 状态和审核审计。第一阶段先做异步协作，不引入实时协同编辑协议。

### Extensions

负责 Plugin Manifest 的目录解析、安装生命周期、版本/哈希固定、Project 启用、能力发现和 Revision 快照。第一阶段只接受平台发布的内置 Manifest：系统在当前用户私有 Workspace 中维护可用能力，用户可以从项目入口启用或停用精确版本；`uploaded` 来源和任意 Manifest 均被拒绝。插件只追加模板、Theme、字段语义和校验规则，不能载入代码、替换核心校验或引入未知 Renderer。

## 5. 生成流程

1. API 创建 Generation Job，并记录用户原始意图、Project、Conversation、Analysis Brief、Data Snapshot 和 Visual Template 版本。
2. API 的 Data 模块解析指定 Data Asset，生成 Data Snapshot 和字段画像；当前没有独立的 Data Worker 部署单元。
3. Generation Worker 原子领取带 Worker Lease 和 Fencing Token 的 Job。进入 `GenerationCycle` 前，Worker 通过 `Snapshot access module` 校验 `Generation Job → Data Snapshot → Data Asset → Project` 关系、来源 Conversation 和当前 Conversation-scoped canonical object key，再读取并验证快照 payload。该 module 只向 Workflow 返回 `rows`、`profiles` 以及 Snapshot/Asset 标识；原始 `Buffer`、JSON 解析细节和 object key 不跨 seam 泄漏。之后 Worker 只传递 Job 已固化的 Brief、Metric Definition、Data Snapshot、Memory、Conversation projection、Visual Template、Plugin Context、Model Route Snapshot 和 Execution Assembly；`GenerationCycle` 在内部构造 `PreparedModelContext`，按 `canonical_text_context` 交给 Model Gateway，不直接回放供应商私有历史字段或重新读取可变 Conversation。
4. `GenerationCycle` 通过内部有限 `EvidenceGenerationGraph` 统一形成 `drafted`、`needs_clarification` 或 `failed` 结果；节点执行 TransformPlan、记录每一步输入/输出/空值处理/字段血缘，并确定性编译和校验 Flint Spec。Graph 不直接写数据库，业务提交仍由持有有效 Lease 的 Worker 完成。
5. 系统根据通过计划校验的 TransformPlan 和固定 Visual Template 确定性编译 Flint Spec，并将结构、语义、数据字段和模板规则写入 Job 的 `planValidation`；渲染完成后将 Vega-Lite、SVG、PNG 产物检查写入独立的 `renderValidation`。
6. 计划或渲染校验失败时最多执行两轮受控修复；模型能力降级、工具调用失败或协议不兼容时，结束当前 Cycle 并提示用户选择模型。用户补充澄清或选择新模型后创建新的 Generation Cycle，不在原 Job 上覆盖输入。
7. Generation Worker 交接到 `rendering` 时释放租约；Render Worker 重新原子领取同一 Job，并按 Job 中冻结的 Renderer 名称从内部 `RendererAdapter` registry 解析 Adapter。当前 registry 只注册 `vega-lite`，由固定版本的 `flint-chart` 编译 Flint Spec，生成 Vega-Lite JSON、SVG 和 PNG；HTML 尚未实现。
8. 系统以当前、未超期 Worker Lease 的 owner、token 和 fencing token 条件写入不可变 Chart Revision 和 Evidence Block 的完成状态，保存输入、口径、计划、规范、字段血缘、Visual Template 快照、输出对象地址、校验结果和生成版本。

## 6. Flint 集成边界

核心 SaaS 后端通过 `RendererAdapter` Interface 使用 `flint-chart`，并将实现放在独立 Render Worker 中。当前 registry 只有平台内置的 `vega-lite` Adapter；新增 Renderer 必须由平台发布并通过既有产物和校验合同接入，Plugin Manifest 只能引用已注册名称。LangReport 的 Chart Revision 保存平台包装后的 Flint 输入和对应的原生 Vega-Lite 输出；Flint 负责图表语义到渲染后端的编译，不负责 Workspace、Project、记忆、权限或审核。

第一阶段不依赖远程 Flint MCP 服务。未来可增加 MCP Adapter，让外部 Agent 以同一套 Project 权限和 Chart Artifact 模型调用 LangReport。

## 7. 数据与存储

### PostgreSQL

存储 Workspace、Member、Project、Analysis Brief、Metric Definition、Data Asset 元数据、Data Snapshot 元数据、Conversation、Memory、Visual Template、Generation Job、Chart Artifact、Chart Revision、Evidence Block、Plugin、Review 和审计事件。

### 私有对象存储

存储原始上传文件、标准化快照、Vega-Lite JSON、PNG、SVG 和其他导出产物。对象路径必须包含 Workspace 和 Project 作用域，访问使用短时授权地址或 Worker 的受控凭据。

由 Conversation 发起的上传使用以下可审计路径：

```text
workspaces/{workspaceId}/projects/{projectId}/conversations/{conversationId}/user-data/uploads/{assetId}/source/{filename}
workspaces/{workspaceId}/projects/{projectId}/conversations/{conversationId}/user-data/uploads/{assetId}/snapshots/{snapshotId}.json
```

新建 Data Asset 必须绑定来源 Conversation；`sourceConversationId` 用于目录隔离和来源审计，但 Data Asset 的所有权仍归 Project。Snapshot 对象名包含 Snapshot ID，避免后续解析覆盖已被 Chart Revision 引用的输入。旧的项目级上传路径不再由应用生成或兼容读取，历史对象可以在部署时清理。

`sourceConversationId` 是不可变、非空的来源/路径标识，不再使用指向 live Conversation 的 `ON DELETE SET NULL` FK。来源 Conversation 删除后，Data Asset 继续保留该 UUID；读模型通过 left join 派生 `sourceConversationDeleted`，并保留 Project-owned 资产及其 Snapshot 的可读性。intake 的解析、对象写入和持久化失败使用稳定的 Data Asset error code，成功写入的 source/normalized object 会按逆序 best-effort 删除；补偿失败写入审计事件，不把 provider 错误或 object key 返回给客户端。

第一阶段的模型读取链路仍由 Generation Worker 控制：Worker 先通过 `Snapshot access module` 从 `workspaceId`、Project、来源 Conversation、Data Asset 和 Snapshot ID 重建 canonical `normalizedObjectKey`，拒绝旧项目级路径、关系不一致或缺失来源 Conversation 的记录，然后读取并验证 JSON payload。读取失败使用 `SNAPSHOT_RELATION_INVALID`、`SNAPSHOT_KEY_INVALID`、`SNAPSHOT_OBJECT_NOT_FOUND`、`SNAPSHOT_PAYLOAD_INVALID` 或 `SNAPSHOT_READ_FAILED` 等可审计错误码；只有经过验证的字段画像和行数据才会传给 Model Gateway。对象路径不会进入模型上下文，也不开放任意 `read_file`、`grep` 或 `glob`；若未来需要工具式文件阅读，必须另行实现带 Workspace/Project/Conversation 权限和路径白名单的受控工具。

### 任务队列

初期使用 PostgreSQL-backed Queue 与事务性任务记录，保证业务写入和任务投递的一致性。Job 领取以数据库条件更新写入 owner、随机 lease token、单调 fencing token、到期时间和 heartbeat；只有这些字段仍匹配且未到期的 Worker 可以推进状态。超期的生成阶段 Job 回到 `queued`，超期的渲染阶段 Job 回到 `rendering` 以复用已通过的计划。任务量增长后可以替换为 Redis-backed Queue，但 Generation Job 的业务状态、租约和 fencing 仍由数据库保存。

## 8. 记忆策略

```text
Conversation Memory   当前会话临时上下文
        ↓ 提取候选
Memory Candidate      等待用户确认
        ↓ 确认
Project / Workspace Memory   可检索的长期事实
```

Project Memory 优先于 Workspace Memory；同名指标或规则出现冲突时，系统必须展示冲突来源，不得静默覆盖。每次 Chart Revision 记录实际使用的记忆版本或记忆 ID，保证结果可解释。

## 9. 主题和插件解析

主题解析顺序为：图表临时设置、Project Visual Template 中的 Theme、Workspace Theme、系统默认 Theme。解析后的结果在生成 Chart Revision 时固化为 Visual Template 和 Theme 快照。

Plugin Manifest 只能声明模板、Theme、语义、校验器、示例和平台已允许的渲染后端。第一阶段的校验和安装都必须命中平台内置目录的精确内容哈希；当前用户在其私有 Workspace 中管理安装、撤销和恢复，Project Owner、Admin、Editor 管理启用。任何自定义代码执行能力都不属于插件协议；`uploaded` 安装入口保持禁用。

## 10. 权限原则

- 当前用户管理自己的 Project、私有 Workspace Theme、Workspace Memory、插件和配额；Workspace 成员由系统初始化/迁移，不提供用户管理。
- Project Editor 管理项目数据、Project Memory、Project Visual Template，并可创建和修改图表版本。
- Project Reviewer 可以评论、提交审核和批准/退回 Chart Revision，但不能修改 Project 设置。
- Project Viewer 只能读取被授权的项目资产和图表。
- 外部分享默认关闭；未来公开链接必须是只读、可过期和可撤销的。

## 11. 可靠性与安全

- 每个 Generation Job 都必须有幂等键、状态、重试次数和错误分类；渲染是同一 Job 的受租约保护阶段，不另建 Render Job 实体。
- Worker 以至少 3 秒的可续约 Lease 领取 Job；所有状态推进、失败、交接和完成写入同时匹配 owner、lease token、fencing token 与未过期时间。租约丢失的 Worker 只能停止，不能提交数据库结果。
- Render Worker 对同一个 Generation Job 使用 PostgreSQL advisory lock 做 single-flight 作为性能优化；正确性依赖持久化 Lease/Fencing 条件和 `generation_job_id` 上的 Revision/Evidence Block 唯一约束，未取得锁或租约的调用交给后续轮询。
- Approved Chart Revision 不可变；任何修改都产生新 Revision。
- 模型默认只接收字段摘要、统计信息和少量脱敏样本。
- 完整原始数据只通过受控 Worker 权限访问，不直接暴露给浏览器或模型供应商。
- 所有跨模块查询都必须先验证 Workspace 作用域和 Project 权限。
- 记录生成、导出、分享、记忆确认、插件安装和审核事件。

## 12. Harness 与应用层的当前 seam

详细决策与迁移门槛见 [ADR 0014：将受控执行 Harness 与 LangReport 应用层分离](../adr/0014-harness-and-application-seam.md)、[ADR 0015：用 LangGraph 编排有限的 Generation Cycle](../adr/0015-langgraph-bounded-generation-orchestration.md) 和 [Harness 与 LangGraph 迁移实施计划](../generation/harness-langgraph-migration-plan.md)。M1–M4 的代码和 Schema 已存在于当前工作树；这不表示已经完成生产部署或真实供应商验收，也不扩大第一阶段范围。

```text
apps/*（Web / API / Worker 宿主）
        │ 组装依赖、处理传输与进程生命周期
        ▼
LangReport 应用层（GenerationCycle、数据、图表、记忆、审核）
        │ 使用小而稳定的 Harness Interface
        ├───────────────────────┐
        ▼                       ▼
@langreport/harness        产品基础设施 Adapter
模型调用/预算/取消         db / storage / flint-adapter
        │
        ▼
模型供应商与遥测端
```

Harness 不得依赖 Workspace、Project、Data Snapshot、Metric Definition、TransformPlan、Flint Spec、Chart Revision、Evidence Block 或任何 LangReport 数据库 Schema。应用层先冻结并授权输入，再通过 Harness 调用模型；模型调用结果不能自行改写业务状态。

第一步只抽取已有 deterministic 与百炼 Adapter 支撑的结构化模型调用 seam。Generation Job 状态机、Worker Lease、Fencing Token、受限 TransformPlan、Flint 渲染和 Plugin Manifest 均保持在应用层。通用 Agent、用户代码 Sandbox、MCP、IM Channel 和运行中配置热加载不属于这一目标。

LangGraph 已作为 `GenerationCycle` 的内部、有限 `StateGraph` 实现；Graph State、节点与路由仍属于 `packages/generation` 的应用语义，而非 Harness。当前运行时使用 `@langchain/langgraph`，但不启用持久化 Checkpointer 或 `interrupt()`；`needs_clarification` 继续由 Job、Conversation 和新的 Generation Cycle 表达。Generation Job 在创建时冻结无密钥的 Execution Assembly，并随不可变 Chart Revision 保留；完整部署验收仍以迁移计划的门禁为准。

## 13. 当前仓库结构

```text
apps/
  web/                  # 对话、数据、图表和协作界面
  api/                  # 模块化单体 API
  generation-worker/    # Job 调度、Cycle 输入快照和结果持久化
  render-worker/        # flint-chart、Vega-Lite、PNG/SVG
packages/
  harness/              # 中性的结构化模型调用 Interface/Adapter
  domain/               # 领域对象和不变量
  contracts/            # API、任务和 Plugin Manifest Schema
  generation/           # GenerationCycle 与有限 EvidenceGenerationGraph
  model-gateway/        # 模型路由、凭据边界和业务输出映射
  data-engine/          # 受限 TransformPlan 执行器
  flint-adapter/        # LangReport 与 flint-chart 的适配边界
  plugins/              # Plugin 生命周期、权限、能力解析和快照
  plugin-sdk/           # 声明式 Manifest Schema、安全校验和内置目录
  chart/                # Chart Revision、Evidence Block 与审核规则
  memory/               # Memory Candidate 与分层记忆服务
  db/                   # Drizzle Schema、迁移和数据库访问
  storage/              # 私有对象存储 Adapter
infra/                  # 数据库、对象存储和部署配置
docs/
  adr/
```
