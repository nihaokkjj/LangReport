# LangReport 工程代码规范

## 适用范围与权威来源

本文件约束 LangReport 的 TypeScript、pnpm workspace、数据流、生成闭环、Worker、Web 和工程工具。它是工程实现的约束，不替代产品规格或领域词汇：

- [`AGENTS.md`](../../AGENTS.md) 是项目协作纪律和完成标准；
- [`CONTEXT.md`](../../CONTEXT.md) 是业务术语和领域对象的唯一来源；
- [`docs/project-spec.md`](../project-spec.md) 是当前目录结构、包边界和验证入口的事实基线；
- [`docs/product/phase1-consulting-report.md`](../product/phase1-consulting-report.md) 是第一阶段产品边界；
- [`docs/agent/agent-loop-spec.md`](../agent/agent-loop-spec.md) 约束 Agent、Generation Loop、记忆和模板；
- [`docs/changes/README.md`](../changes/README.md) 约束中大型需求的 SDD、审核、验收和交接。

规则按以下等级理解：

| 等级 | 含义 | 违反时的处理 |
| --- | --- | --- |
| `MUST` | 当前已经生效的产品、领域或架构不变量 | 不得合并，除非先完成变更评审 |
| `SHOULD` | 默认工程实践 | PR 中说明例外原因和后续处理 |
| `CHECK` | 将由工具或 CI 固化的门禁 | 工具启用后必须通过；启用前记录手动证据 |
| `DEFERRED` | 已明确延期的工作 | 不在当前任务中顺手扩大范围 |

本文件在 T1 建立，T2 已接入 ESLint/Prettier，T3/T4/T5 已接入边界、卫生和提交检查，T6 已接入 PR offline workflow。`pnpm check` 是本地静态门禁组合入口；它不替代类型检查、测试、构建或数据库迁移验证。

## 当前格式与 lint 命令契约

- `pnpm format:check` 使用根目录 `.prettierrc.json` 检查当前工作树变更；可以通过 `CHECK_BASE` 或 `GITHUB_BASE_SHA` 指定比较基线。
- `pnpm format:write` 只格式化同一范围内的变更文件，不自动重排全仓历史代码；`pnpm-lock.yaml` 和生成目录不纳入该命令。
- `pnpm lint` 使用根目录 `eslint.config.mjs` 和 `typescript-eslint` 推荐规则，检查变更的 JavaScript/TypeScript 源码与测试；浏览器和 Node 运行时全局变量已显式声明。
- `pnpm check` 依次运行 `format:check`、`lint`、`check:boundaries`、`check:hygiene`、`docs:check` 和 `check:commits`，是提交 PR 前的静态检查组合入口。
- `pnpm check:hygiene` 检查版本控制候选路径中的敏感文件、生成物、未解决冲突、变更空白和迁移 journal；它不会删除文件，也不会读取或打印 secret 内容。
- `pnpm db:verify` 执行数据库迁移文件检查和隔离 schema 回放；需要本地测试数据库时，按数据库开发文档准备环境。
- 当前门禁优先报告新改动的问题，不把一次工具接入升级成全仓格式迁移。CI 接入时必须显式设置稳定的 base commit，并保留本地复现方式。
- ESLint 错误会使命令失败；警告会出现在报告中，但不会因为历史范围扩大而被静默隐藏。

## 语言、模块和依赖

### TypeScript 与 ESM

- `MUST` 遵守仓库 `strict` 类型检查；公共函数、事件、持久化模型和跨包接口显式声明类型。
- `MUST` 优先使用 `unknown`、判别联合、Schema 推导和窄化，不新增无边界的 `any`。历史 `any` 不要求在本变更中一次性清理，但新增代码不能继续扩散。
- `MUST` 处理 `Promise` 的失败路径；不得无说明地丢弃异步结果、吞掉异常或用宽泛 `catch` 隐藏契约错误。
- `SHOULD` 保持模块小而内聚，先通过已有公共模块和契约复用能力，不复制领域类型或错误码。
- `MUST` 遵守现有 ESM 和 workspace 解析方式，使用包的公开入口，不通过相对路径穿透其他包的 `src` 或内部目录。
- `MUST NOT` 在库模块中引入全局可变单例、运行时隐式环境状态或依赖导入顺序的初始化副作用。

### 包职责与允许的依赖方向

下表描述当前第一阶段的职责。新增依赖必须能解释为下游依赖上游稳定能力，不能反向穿透。

| 包或目录 | 负责 | 不负责 |
| --- | --- | --- |
| `packages/contracts` | Zod/schema、API 输入输出、事件和跨包共享契约 | 业务副作用、HTTP 调用、数据库连接 |
| `packages/domain` | Workspace、Project、Snapshot、Brief、Generation、Revision 等领域规则 | React、HTTP 框架、具体 ORM 或外部服务 |
| `packages/db` | schema、迁移、数据库 repository 和事务边界 | Web 展示、模型推理、隐式迁移 |
| `packages/data-engine` | 表格读取、字段识别、指标和 TransformPlan | 生成提示词、UI 状态、任意服务器端代码执行 |
| `packages/generation` | 生成编排、候选结果、校验和修复策略 | 直接操作 Web、绕过契约写库 |
| `packages/harness` | 离线、可重复的 Agent/模型测试替身和 fixture | 真实凭据、真实外部服务、产品业务分支 |
| `packages/model-gateway` | 模型提供商抽象、请求/响应适配和错误归一化 | 领域状态持久化、前端展示 |
| `packages/chart` | Chart Artifact、Flint Spec/渲染输入和图表验证 | 直接决定产品审批、任意数据库查询 |
| `packages/flint-adapter` | LangReport 结构到 Flint 能力的适配 | 改写领域事实、绕过校验 |
| `packages/memory` | 记忆候选、状态和可审计读写 | 自动把模型推断变成长期事实 |
| `packages/plugin-sdk`、`packages/plugins` | 受限插件接口、manifest、权限和生命周期 | 任意代码执行、绕过权限或拿到宿主秘密 |
| `apps/api` | HTTP 路由、认证、授权、输入校验和应用编排 | 把路由当作领域规则唯一实现 |
| `apps/web` | 页面、交互、api-console 和用户可见状态 | 直接访问数据库或复制服务端领域规则 |
| `apps/generation-worker`、`apps/render-worker` | 队列消费、重试、租约和 Worker 生命周期 | 绕过 Generation/Revision 不变量 |

生产 Worker 的 `src` 不能互相导入或形成运行时依赖。端到端集成测试可以显式调用对端 Worker 入口，以验证真实交接；该例外只对 `test/`、`tests/`、`.test.` 或 `.spec.` 文件生效，不得复制到生产代码。

推荐依赖方向：

```text
contracts ← domain ← data/db/generation/chart/memory
                         ↑
                 api / workers / web adapters
```

箭头表示“依赖稳定抽象”。实际导入以 `docs/project-spec.md` 和各包 `package.json` 为准；如果需要反向依赖，先建立 ADR 或变更设计并说明为什么不能通过端口、适配器或事件解决。

### API 与契约

- `MUST` 先定义并校验输入，再进入业务服务；错误响应使用稳定的错误码、可读消息和可选的字段级细节。
- `MUST` 修改接口时同步 `apps/web/app/api-console`、OpenAPI 展示、请求示例、场景编排和相关校验。
- `MUST` 保持向后兼容，或在 design/ADR 中写明版本化、迁移和回滚；不能仅因前端当前调用方式简单就破坏公共字段。
- `SHOULD` 让运行时 Schema 成为类型推导的来源，避免“TypeScript 能编译但运行时接受任意形状”。

### 数据库、迁移与仓储

- `MUST` 所有 schema 变更都有可审计迁移和迁移说明；不手改共享环境数据库，不提交本地数据库文件。
- `MUST` 通过 repository 或明确的 data access service 访问数据库，保持事务、授权、租约和幂等边界可见。
- `MUST` 记录破坏性变更的兼容窗口、回滚方式和数据修复方案；删除列、改语义或改变枚举值不能隐藏在普通重构中。
- `MUST` 保留 Data Snapshot、指标口径、TransformPlan、主题版本和 Revision 关联，使图表证据可追溯。

## 领域与生成闭环不变量

### 报告范围

第一阶段只优先实现“咨询项目报告”垂直闭环：一个 Workspace 内的一个 Project、一个 Data Snapshot、一个 Analysis Brief、一次 Generation Cycle 生成一个主 Chart Artifact/Evidence Block。不要把本规范扩展成通用 BI 平台规范。

以下能力默认不在第一阶段：实时数据库、跨文件 Join、Dashboard、实时协作、公开分享、任意服务器端代码、插件市场和完整 PPT 排版。扩大边界必须先修改产品规格和变更文档。

### 可追溯性与不可变性

- `MUST` 成功的图表证据同时保留来源数据、指标口径、变换计划、Flint Spec、主题版本和校验记录。
- `MUST` 批准版本不可变；修订必须生成新的 Revision，并保留前一版本和审核关系。
- `MUST` 区分草稿、生成中、校验失败、待审核、已批准、已拒绝等状态；不能用布尔值替代状态机。
- `MUST` 使失败可解释：记录阶段、错误码、可重试性、关联的 Generation Cycle/Revision 和用户下一步。
- `MUST` 让 Worker 的租约、重试、幂等和停止条件与 Generation Loop 规范一致；重复消费不能生成多个逻辑事实。

### Agent、记忆和插件

- `MUST` Agent 启动前完成身份、Workspace/Project、Data Snapshot、Analysis Brief、能力和停止条件校验。
- `MUST` 离线 Harness 使用可控 fixture 和替身；测试不得依赖真实模型、真实凭据、真实外部 API 或网络波动。
- `MUST` 记忆写入先形成候选，经过来源、置信度、作用域、状态和审核策略后才能成为项目事实。
- `MUST` 插件通过 manifest 声明能力、权限和版本；宿主不能因为插件方便而暴露任意文件、网络、凭据或执行能力。

## Web 与 UI

- `MUST` 修改页面、组件、样式或交互前阅读根 `DESIGN.md` 和 Web 局部规则，优先复用现有 token、组件和数据行为。
- `MUST` 同时检查桌面和移动端；至少覆盖加载、空、错误、成功/审核和不可用状态。
- `MUST` 保持文本层级、对比度、触控区域、溢出和键盘可用性；不为局部效果引入无记录的新颜色、字号或间距。
- `MUST` UI 只消费公开 API/契约，不直接读取数据库或复制服务端领域规则。
- UI 变更完成后运行 `pnpm --filter @langreport/web typecheck`，并在 PR 说明手工检查的视口和状态。

## 测试规范

测试名称要说明行为和边界，不以实现细节为唯一断言依据。

- 契约测试验证输入、输出、错误码和兼容性；
- 领域测试验证不变量、状态迁移、幂等和不可变性；
- 数据库测试验证迁移、事务、唯一约束和 repository 行为；
- Generation/Worker 测试验证重试、租约、停止条件、失败恢复和重复消费；
- Harness 测试必须离线、确定、可复现；
- 图表测试验证 Flint Spec、主题、来源和校验记录；
- Web 测试验证用户可见状态和公共 API 行为，而不是依赖脆弱的内部 DOM 结构。

常用入口：

```text
pnpm docs:check
pnpm check
pnpm typecheck
pnpm test
pnpm build
pnpm check:boundaries
pnpm check:hygiene
pnpm check:commits
pnpm --filter @langreport/web typecheck
pnpm db:verify
```

测试失败时记录实际命令、环境、失败阶段和是否为已知基线问题。不要通过跳过测试、放宽断言、静默捕获异常或提交生成物来“修复”门禁。

## 格式、静态检查与仓库卫生

T2 已把格式和基础 lint 接入本地脚本，T3/T4/T5 已接入包边界、仓库卫生和 Commit 检查，T6 已把这些门禁接入 PR offline workflow。以下规则在相应自动化尚未启用前仍是人工审查标准：

- 格式化保持稳定、无无关重排；
- lint 只允许明确的例外，并在同一变更中说明原因；
- 新增包依赖必须有职责说明，禁止未使用依赖和跨层绕过；
- 禁止提交 `.env`、密钥、令牌、数据库文件、构建目录、覆盖率、日志、临时导出和个人 IDE 文件；
- Markdown、YAML、JSON 和 workflow 修改必须保持可解析、链接有效、相对路径正确；
- 迁移、生成物和锁文件只在确有必要时修改，并在 PR 中说明来源；
- `git diff --check` 必须通过，工作树中不得混入其他任务改动。

当前不自动强制以下事项：历史 `any` 的全量清理、覆盖率阈值、Pre-commit Hook、SDD 状态自动推进、发布自动化和 DeerFlow 运行时接入。它们属于独立变更，不能在普通 PR 中偷偷改变规则强度。

## 例外、升级与回滚

需要违反 `MUST` 规则时，先停止实现并在变更文档或 ADR 中记录：问题背景、受影响边界、替代方案、风险、迁移、回滚和到期时间。临时例外必须有负责人和删除条件，不得以永久 `TODO` 取代决策。

工程规则的升级顺序是：更新设计/ADR → 更新本文件和贡献指南 → 提供本地命令 → 接入 CI → 更新验收和交接。发现规范与代码事实不一致时，以可验证的代码和项目文档为依据，修正规范或创建变更，不要在实现中默默形成第三套规则。
