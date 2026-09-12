# LangReport 实现完成度审计

> 审计日期：2026-09-10  
> 审计范围：当前工作树中的第一阶段“咨询项目报告”闭环，以及已经接入仓库的模型网关、插件、接口调试和部署能力。  
> 审计目标：区分真实实现、确定性 Demo、仅通过离线测试的模块和仍未完成的产品能力，并检查结果是否使用当前 Project 的实际数据。

## 结论先行

当前项目不是“全部 Demo”，但也还不能标记为生产完成。更准确的状态是：

> **核心数据处理、受限变换、图表渲染、版本与审核的工程骨架已经实现；第一阶段闭环仍处于工程 MVP / Alpha，真实模型账户验收、端到端部署验证和若干产品契约尚未完成。**

结果是否针对 Project 实际值的结论：

- **数据快照、TransformPlan、Flint Spec、PNG/SVG 渲染**使用的是当前任务绑定的 Data Snapshot，不是固定示例数据。
- **确定性模式的意图识别**仍是本地规则/关键词逻辑，不是大模型推理；但规则执行后的数值来自当前 Project 数据。
- **LLM 模式的模型调用适配器已经存在**，但当前仓库只完成模拟 HTTP 和离线契约测试，尚未完成真实百炼账户验收。
- **Evidence 的发现文本和 Web 图表预览只使用变换结果的前 500 行**，因此“最高值”“数据点数量”等返回内容不一定代表全量 Project 数据。这是当前最重要的结果正确性风险。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| 已实现 | 代码链路存在，使用真实输入，且有针对性测试或明确运行证据 |
| 部分实现 | 主链路存在，但产品能力、边界、权限或验收证据不完整 |
| Demo / 确定性 | 可以演示或离线运行，但核心决策依赖固定规则、合成输入或模拟外部服务 |
| 未完成 / 未验证 | 代码缺失、测试被跳过、部署不可验证，或与产品验收标准不一致 |

## 总览

| 模块 | 完成度 | 是否仍是 Demo | 是否使用 Project 实际值 | 主要结论 |
| --- | --- | --- | --- | --- |
| Project / Workspace | 部分实现 | 否 | 是 | 创建、列表、切换和 Workspace 权限已有；完整 Project 生命周期和生产身份未完成端到端验收 |
| Data Asset / Data Snapshot | 已实现 | 否 | 是 | CSV/XLSX/JSON/粘贴数据会解析、画像、写入对象存储并生成不可变 Snapshot |
| Conversation | 部分实现 | 否 | 是 | 消息持久化和上下文投影已实现；发送消息本身不会调用模型，必须显式点击生成 |
| Analysis Brief | 部分实现 | 否 | 是 | 会持久化问题，但 API 将缺少时间信息的 Brief 直接标记为 confirmed |
| Metric Definition | 部分实现 | 否 | 是 | 用户可确认并持久化指标；生成时默认取最新 confirmed 指标，不支持明确选择多个指标 |
| Generation Job / Worker | 已实现但未全链路验收 | 否 | 是 | 队列、Lease、Fencing Token、状态和失败记录存在；真实 PostgreSQL Worker 集成测试被跳过 |
| Deterministic Generation | Demo / 确定性 | 是 | 是 | 本地规则生成意图和计划，实际 Transform 使用 Project Snapshot |
| LLM Model Gateway | 部分实现 | 离线层面是 | 是 | 百炼 OpenAI 兼容适配器、密钥加密和错误归一化已实现；真实供应商账户调用未验收 |
| TransformPlan / Data Engine | 已实现但能力不完整 | 否 | 是 | 受限执行器真实处理快照；产品规格声明的全部操作尚未覆盖 |
| Flint Spec / Render | 已实现 | 否 | 是 | Vega-Lite、SVG、PNG 由当前变换结果生成并校验 |
| Evidence Block | 部分实现 | 否 | 部分 | 追溯字段齐全，但 finding 使用前 500 行，存在全量事实不准确风险 |
| Chart Revision / Edit | 部分实现 | 否 | 是 | 编辑会创建新 Revision，Approved 只读；部分编辑与审核 UI/接口未完整验收 |
| Review | 部分实现 | 否 | 是 | 状态转移和评论 API 有；当前主 Web 页面没有完整评论工作流入口 |
| Theme / Visual Template | 部分实现 | 否 | 是 | Theme 版本会冻结；Project Visual Template 的完整复制、编辑和验收 UI 不完整 |
| Memory | 部分实现 | 不是纯 Demo | 是 | 候选、确认、作用域和快照已有；自动提取仍是确定性 extractor，Web 管理入口不完整 |
| Plugin | 工程能力已实现，产品闭环未完成 | 部分 | 是 | Manifest 校验和安全 DSL 有测试；项目级插件使用的端到端验收不足 |
| Export | 部分实现 | 否 | 是 | PNG/SVG/Vega-Lite 存储和下载存在；README/规格声明的 HTML 导出当前没有实现 |
| Web Workbench | 部分实现 | 部分 | 是 | 主流程可操作，存在示例数据入口；移动端、完整错误/澄清/审核体验未完成验证 |
| API Contract / Console | 部分实现 | 否 | 是 | OpenAPI 和 Console 存在；契约测试因新模型凭据路由未同步而失败 |
| Production / Deployment | 未完成验证 | 不是代码 Demo | 未验证 | 生产 Compose 和配置存在，但本轮无法连接 Docker，也没有真实部署验收证据 |

## 逐模块证据

### 1. Project、Workspace 和权限

**状态：部分实现。**

已经实现：

- API 通过 Workspace、Member、Project 和 Project Member 表建立作用域。
- Web 可以创建 Project、列出 Project、切换 Project，并在刷新后重新读取数据。
- 模型凭据入口要求 Workspace Owner 或 Admin；API 会再次校验角色，不能只依赖前端隐藏按钮。

证据：

- [apps/api/src/routes.ts](../apps/api/src/routes.ts) 的 Project 查询、创建和 Workspace 权限代码。
- [apps/web/app/page.tsx](../apps/web/app/page.tsx) 的 Project 选择器和创建入口。
- [packages/domain/src/index.test.ts](../packages/domain/src/index.test.ts) 通过了角色和 Revision 权限测试。

未完成：

- 当前没有充分证据证明完整 Project 归档生命周期已经在 Web 和生产 API 上验收。
- 生产认证只通过了单元/API 装配测试，本轮没有真实部署身份验证。

### 2. Data Asset 和 Data Snapshot

**状态：已实现，且不是 Demo。**

实际行为：

1. 上传或粘贴数据后，API 调用 `parseData`。
2. 支持 CSV、XLSX、JSON 和 pasted 数据。
3. 生成字段类型、空值数、唯一值数和示例值画像。
4. 原始文件和标准化 `snapshot.json` 写入对象存储。
5. 数据库保存新的 Snapshot 版本，旧版本不被覆盖。
6. Generation Worker 根据任务中的 `snapshotId` 读取对应 `normalizedObjectKey` 的完整行数据。

证据：

- [packages/data-engine/src/index.ts](../packages/data-engine/src/index.ts)：解析、画像和受限执行器。
- [apps/api/src/data-assets.ts](../apps/api/src/data-assets.ts)：对象存储、Snapshot 创建和 50 MB 限制。
- `data-engine` 测试通过：**2/2**。

结论：图表数值的输入不是前端固定的 `sampleCsv`；`sampleCsv` 只是 Web 侧“使用示例”按钮的可选演示数据入口。

### 3. Conversation

**状态：部分实现。**

实际行为：

- 消息会持久化到 Conversation。
- 创建 Generation Job 时，会将 Conversation 投影为版本化的 `canonical_text_context`，并保存版本和哈希。
- Worker 消费 Job 中已经冻结的投影，不会在排队后重新读取可变历史。

重要限制：

- Web 的“发送”按钮只调用消息保存接口，不调用模型。
- 用户必须再次点击“生成证据”才会创建 Generation Job。
- 这符合当前工程设计，但与普通用户对“问问题即获得回答”的直觉不同。

证据：

- [apps/web/app/page.tsx](../apps/web/app/page.tsx)：`sendMessage` 与 `generateEvidence` 是两个独立动作。
- [apps/api/src/routes.ts](../apps/api/src/routes.ts)：创建 Job 时固化 Conversation projection。
- [packages/generation/src/context-projection.test.ts](../packages/generation/src/context-projection.test.ts) 已纳入 Generation 测试。

### 4. Analysis Brief 和 Metric Definition

**状态：部分实现，存在产品不变量风险。**

已实现：

- 指标可由用户在 Web 表单中确认。
- 指标保存版本、公式、单位、时间规则和确认状态。
- 生成前要求至少存在一个 confirmed Metric Definition。

发现的问题：

- [apps/api/src/routes.ts](../apps/api/src/routes.ts) 创建 Generation Job 时，用用户 prompt 生成 Analysis Brief，但固定写入 `audience: "客户汇报"`、`timeRange: null`、`timeGrain: null`，同时写入 `status: "confirmed"`。
- 这意味着一个没有时间范围和时间粒度的 Brief 可能被当成已确认输入，违反“缺少必要信息时应澄清”的第一阶段规则。
- 生成时按 Project 内最新 confirmed 指标排序取一条，而不是由用户明确选择指标。

结论：口径实体和存储是真的，但 Brief 确认边界和多指标选择还不是完整产品能力。

### 5. Generation Job、Lease 和 Worker

**状态：实现完整度较高，但没有完成真实全链路验收。**

已实现：

- Job 状态包括 profiling、planning、transforming、compiling、rendering、validating、succeeded、failed 等阶段。
- PostgreSQL 领取任务、Lease、Heartbeat、Fencing Token 和过期恢复代码存在。
- Job 失败保存 `errorCode`、`errorMessage`、validation 和 generation audit。
- retry 只允许特定可恢复错误，并限制尝试次数。

证据：

- [apps/generation-worker/src/index.ts](../apps/generation-worker/src/index.ts)：领取、处理、失败和交接 Render Worker。
- [apps/render-worker/src/index.ts](../apps/render-worker/src/index.ts)：渲染阶段 Lease 和幂等处理。
- [packages/db/scripts/verify-migrations.mjs](../packages/db/scripts/verify-migrations.mjs) 通过，迁移包含 `0016_workspace_model_credentials.sql`。

验证限制：

- [apps/generation-worker/src/worker.integration.test.ts](../apps/generation-worker/src/worker.integration.test.ts) 本轮结果为 **1 skipped**，不是通过。
- Docker 本轮无法连接，无法确认真实 PostgreSQL、对象存储和两个 Worker 的联合运行。

### 6. Deterministic Generation：当前最明确的 Demo 部分

**状态：Demo / 确定性实现，但会处理真实 Project 数据。**

`GenerationCycle` 默认使用 `DeterministicModelGateway`。它根据字段画像、prompt 和少量规则推断：

- 时间字段；
- 分组字段；
- 数值指标；
- 图表类型；
- 聚合计划。

这部分不调用外部模型，属于本地规则 adapter。其后续变换执行会读取 Worker 从 Data Snapshot 取出的完整 rows，因此：

- **意图识别是 Demo/规则实现；**
- **数值计算不是固定 Demo 数据，而是当前 Snapshot 的实际值。**

证据：

- [packages/generation/src/index.ts](../packages/generation/src/index.ts) 的 `DeterministicModelGateway`。
- 同文件的 `materializeArtifacts` 调用 `executeTransformPlan(plan, input.rows)`。
- Generation 测试通过：**13/13**，其中包含澄清、非法输出、上下文投影、模型调用摘要和审计测试。

### 7. LLM Model Gateway 和 Workspace API Key

**状态：适配器已实现，真实供应商能力未完成验收。**

已实现：

- 百炼 OpenAI 兼容 Chat Completions 请求。
- JSON Schema 和 JSON Object 两种结构化输出路径。
- `MODEL_CREDENTIAL_ENCRYPTION_KEY` 校验、AES-256-GCM 加密和解密。
- Workspace credential 覆盖 Worker fallback `BAILIAN_API_KEY`。
- 模型调用记录保存有限审计摘要，不保存 API Key、原始响应或隐藏推理。
- Provider 错误、限流、超时、空响应和非法响应有统一归一化。

未完成：

- 测试使用合成上下文和模拟 HTTP fetch，不等于真实百炼账户验收。
- 当前根 `.env` 审计时仍使用加密主密钥占位符时，Workspace Key 入口不能保存；真实使用必须替换为 32 字节 Base64 值并重启 API/Worker。
- 首批 DeepSeek 和 OpenAI 适配器尚未完成，当前实际供应商只有 Bailian 路径。

证据：

- [packages/model-gateway/src/index.ts](../packages/model-gateway/src/index.ts)。
- Model Gateway 测试通过：**5/5**。
- [docs/model-gateway-implementation-plan.md](./model-gateway-implementation-plan.md) 明确写明真实账户验收仍待实施，模拟传输测试不等于真实账户验证。

### 8. TransformPlan 和数据引擎

**状态：已实现，但产品声明的操作集合未全部兑现。**

实际执行器会对 `sourceRows` 做受限 JSON 计划执行，并生成字段血缘、输入/输出行数和步骤记录。当前模型上下文实际只声明：

```text
filter / derive / aggregate / sort / limit
```

第一阶段产品规格还声明了 `select_fields`、`rename_fields`、`cast_type`、`calculate_ratio`、`calculate_delta`、`calculate_yoy`、`calculate_mom` 等语义操作。当前代码不能把这些全部视为已完成的独立产品操作；部分计算通过 `derive` 或内部规则表达。

结论：受限执行器是真实现，不执行任意 SQL/JavaScript；但 TransformPlan 产品契约仍是部分实现。

### 9. Flint Spec、渲染和输出

**状态：渲染链路已实现，输出范围部分完成。**

已实现：

- 当前变换结果进入 Flint Spec 的 `data.values`。
- 编译 Vega-Lite。
- 生成确定性 SVG，并用 Sharp 生成 PNG。
- 分别校验 Vega-Lite、SVG 和 PNG。
- 输出写入对象存储，并绑定到 Revision。

证据：

- [packages/flint-adapter/src/index.ts](../packages/flint-adapter/src/index.ts)。
- Flint Adapter 测试通过：**5/5**，包含真实渲染产物存在性和签名校验。

未完成：

- 当前 API 支持 `png`、`svg`、`vegaLite`，没有 HTML 输出；但 README 和第一阶段规格把 HTML 列为支持格式。
- 本轮没有浏览器端、对象存储和生产下载链路的端到端验证。

### 10. Evidence Block 和“结果是否针对实际值”

**状态：部分实现，存在高优先级准确性问题。**

真实部分：

- Evidence Block 绑定 Project、Conversation、Generation Job、Chart Artifact、Chart Revision、Snapshot、Analysis Brief、Metric Definition 和 quality warnings。
- 图表 Spec 中的数据来自当前变换结果，而不是前端样例 CSV。
- Revision 保存 TransformPlan、字段血缘、Theme 快照和 validation。

结果风险：

- Generation Worker 将变换结果保存到 Job 的 `previewData` 时只取 `artifacts.transform.rows.slice(0, 500)`。
- Render Worker 的 `buildFinding` 从 `previewData` 计算点数和最高值。
- Web 的 `rowsForEvidence` 也优先使用 `job.previewData.rows`。

因此，当前返回的“有多少个数据点”“哪个分组数值最高”和 Web 交互预览可能只反映前 500 行，而不代表完整 Data Snapshot。图表输出文件本身使用完整 `FlintSpec.data.values`，但 finding 文本和 Web 预览不一致。

这是当前最需要修复的功能问题：全量事实摘要必须在受限执行器完成后计算并持久化，不能用截断预览代替。

### 11. Chart Artifact、Revision、编辑和审核

**状态：部分实现。**

已实现：

- 生成初始 Chart Revision。
- 编辑、回滚或复制走新的 Revision，而不是覆盖历史版本。
- Approved/Archived Revision 在 Web 编辑入口被禁止修改，领域测试覆盖不可变行为。
- Revision 状态包括 draft、in_review、approved、changes_requested、archived。

测试证据：

- Domain 测试通过：**8/8**，包括合法状态转移、Viewer 只读、Revision 不变性和比较。

未完成或未验证：

- Web 主页面支持提交审核、批准和要求修改，但没有完整的评论创建/查看/解决交互入口。
- 本轮没有执行真实 API + 数据库的审核全链路测试。

### 12. Theme 和 Visual Template

**状态：部分实现。**

已实现：

- Project Theme 会在创建 Job 时解析并固化版本。
- Revision 保存 Theme 快照。
- Flint 渲染器使用受控颜色、字体和布局配置。
- 插件 Theme 引用会被记录到 Plugin Snapshot。

未完成：

- 主 Web 工作台没有完整的 Visual Template 复制、令牌编辑、对比度校验和显式保存流程。
- 目前更接近 Project Theme preset，而不是产品规格中完整版本化 Visual Template 编辑器。

### 13. Memory

**状态：部分实现，不是纯 Demo。**

已实现：

- Memory Candidate、接受/拒绝、Project/Workspace scope、冲突和 Revision memory snapshot 有数据模型与 API。
- 未确认候选不会进入可检索长期 Memory。
- Domain 测试覆盖作用域、候选状态和冲突优先级。

限制：

- 当前 extractor 是确定性规则 extractor，不是大模型抽取。
- 主 Web 工作台主要展示已存在 Memory，没有完整 Candidate 审核工作流界面。
- 本轮没有通过真实数据库验证接受后检索和 Revision 固化链路。

### 14. Plugin

**状态：工程能力已实现，产品闭环部分完成。**

已实现：

- Manifest 结构、未知字段、深度、循环、Theme 继承、Renderer 能力和安全 DSL 校验。
- 不执行用户上传的任意服务器端 JavaScript。
- Plugin Snapshot 会进入 Revision 追溯。

测试证据：

- Plugin SDK 测试通过：**10/10**。
- Plugin service 测试通过：**2/2**。
- Flint plugin theme 测试通过：**5/5**。

限制：

- Plugin 安装、启用、生成、渲染、撤销和恢复的真实数据库闭环未完成端到端验收。
- 插件属于当前工程扩展能力，不是第一阶段核心闭环的必要完成条件。

### 15. Web Workbench

**状态：可演示的工作台，产品验收未完成。**

已实现：

- Project、Conversation、数据上传/粘贴、指标确认、生成轮询、Evidence 预览、依据面板和基础编辑。
- 有加载、空态、错误态、生成状态和失败重试 UI。
- `pnpm --filter @langreport/web typecheck` 等价检查通过，直接运行 Web `tsc --noEmit` 通过。

Demo 信号：

- 页面内有固定的销售示例 CSV 和两个固定 prompt chip。
- 确定性模式可不依赖外部模型完成演示。
- 当前页面不是仅有静态 mock，API 调用和结果读取都是真实的；但示例入口容易让演示路径看起来像固定 Demo。

未完成：

- 本轮没有 Playwright 或真实浏览器桌面/移动截图验证。
- 审核评论、完整澄清状态、HTML 导出和部分 Theme 管理未形成完整用户流程。

### 16. API Contract、OpenAPI 和调试页面

**状态：部分实现，并有明确测试回归。**

已验证：

- API 认证相关测试：**7/7**。
- OpenAPI 相关测试中的大部分子测试通过。
- API 和 Web TypeScript 类型检查通过。

当前失败：

- `packages/contracts/src/http.test.ts` 的“路由契约覆盖当前全部路由”失败：测试期望 **63** 条，实际路由契约为 **65** 条。
- 新增的 `GET/PUT /api/v1/workspaces/:workspaceId/model-credential` 已进入 `routeContracts`，但测试中的 `expectedRoutes` 没有同步更新。
- 这不是模型业务逻辑失败，但说明接口契约基线没有跟上当前代码，不能把 API 契约模块标记为全绿。

### 17. Production / Deployment

**状态：配置和 Compose 代码存在，但未完成部署验证。**

已实现：

- 生产 Compose 将路由配置注入 API，将 API Key fallback 和加密主密钥注入 Generation Worker。
- API 和 Worker 共享 `MODEL_CREDENTIAL_ENCRYPTION_KEY` 的设计已落地。
- 迁移兼容性脚本通过。

未验证：

- 本轮 Docker 客户端无法访问 Docker Engine，因此无法启动或检查 PostgreSQL、MinIO、API、Generation Worker、Render Worker 的真实组合。
- 没有真实百炼账户、真实 Workspace Key、真实费用受控的生成记录。
- 因此不能宣称当前系统已完成生产部署验收。

## 验证记录

### 通过的测试

| 检查 | 结果 |
| --- | --- |
| Data Engine | 2/2 passed |
| Generation | 13/13 passed |
| Model Gateway | 5/5 passed |
| Flint Adapter | 5/5 passed |
| Domain | 8/8 passed |
| Memory | 2/2 passed |
| Plugin Service | 2/2 passed |
| Plugin SDK | 10/10 passed |
| API auth/integration suite | 7/7 passed |
| packages/apps TypeScript typecheck | 16/16 package/app checks passed |
| Migration compatibility | passed; migrations through `0016_workspace_model_credentials.sql` |

### 失败或未完成的验证

| 检查 | 结果 | 含义 |
| --- | --- | --- |
| HTTP route contract coverage | failed: 63 expected vs 65 actual | 模型凭据路由未同步到测试基线 |
| Generation Worker integration | 1 skipped | 需要真实数据库/对象存储环境，不能计入通过 |
| Real Bailian account acceptance | not run | 当前测试是模拟 HTTP，不代表供应商真实可用 |
| Docker/production composition | not run | Docker Engine 权限/连接不可用 |
| Browser desktop/mobile QA | not run | 本轮没有 Playwright 证据 |
| Full API + Worker + Render E2E | not run | 缺少可运行的基础设施和测试数据环境 |

## 关键问题排序

### P0：修复结果事实使用截断预览

不要用 `previewData.rows.slice(0, 500)` 生成最高值、数据点数量和 Evidence finding。应在完整 TransformResult 上计算结构化事实摘要，例如全量点数、最大值、最小值、分组和质量统计，然后让 finding 只引用摘要。Web 预览可以保留 500 行，但必须明确标记为预览，不能影响结果事实。

### P0：补齐真实模型与 Worker 验收

使用合成 Project 数据、费用上限和真实百炼账户验证：

- Workspace Key 保存和轮换；
- API 加密保存、Worker 解密；
- 百炼请求和结构化返回；
- 真实失败、超时、限流和重试；
- Job、Model Invocation、Revision 和 Evidence 追溯。

### P1：修正 Brief 确认边界

没有 `timeRange` / `timeGrain` 或其他必要约束时，应进入 `needs_clarification` 或 draft，而不是写成 confirmed。多指标 Project 需要允许用户明确选择指标。

### P1：同步接口契约测试

将两个模型凭据路由加入 `packages/contracts/src/http.test.ts` 的 expected route 基线，并重新跑 OpenAPI/contract suite。

### P1：补齐产品规格声明的输出和变换能力

- HTML 固定 Revision 导出；
- select / rename / cast 的显式 TransformPlan 操作；
- ratio / delta / yoy / mom 的可审计操作映射；
- Visual Template 管理界面；
- Review comments 的 Web 入口。

### P2：完成浏览器和生产环境验收

- 桌面、移动、加载、空态、错误、澄清、Approved 只读状态；
- 真实 API、PostgreSQL、MinIO、两个 Worker 联合运行；
- requestId、日志脱敏、权限和生产文档访问控制。

## 最终判定

### 可以认为已经完成的部分

- 真实数据文件解析和 Data Snapshot 持久化；
- 基于 Snapshot 的受限变换和字段血缘；
- 基于实际变换结果的 Flint Spec、SVG、PNG 渲染；
- Chart Revision 基础不可变和状态模型；
- Workspace API Key 的加密存储设计和离线适配器测试；
- 插件 Manifest 安全校验和基础追溯；
- 大部分包级单元测试和 TypeScript 类型检查。

### 不能标记为完成的部分

- 第一阶段完整产品闭环；
- 真实百炼账户模型调用；
- 真实 PostgreSQL/MinIO/Worker/Render Worker 联合运行；
- 全量 Project 结果 finding 的准确性；
- Brief 澄清和多指标选择；
- HTML 导出、完整 Visual Template 管理和完整 Web Review 评论流程；
- API Contract 全绿和生产部署验收。

**最终状态：工程 MVP / Alpha，核心数据链路已脱离纯 Demo，但产品闭环和生产验收尚未完成。**
