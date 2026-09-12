# ADR 0015：用 LangGraph 编排有限的 Generation Cycle

## 状态

已接受；实现尚未开始。

本 ADR 细化并部分覆盖 [ADR 0014](./0014-harness-and-application-seam.md) 中“本轮不引入 LangGraph”的限定：LangGraph 现在被选为后续实现有限 `Generation Cycle` 的内部编排库。ADR 0014 的 Harness/App 依赖方向、第一阶段产品边界和其他排除项保持不变。

## 背景

LangReport 的第一阶段有一个固定、可审核的生成闭环：一个 `Generation Cycle` 只使用一个冻结的 `Data Snapshot`、`Analysis Brief`、`Metric Definition`、`Conversation projection`、`Visual Template` 和 `Model Route Snapshot`，最多执行两轮自动修复，最终只产生一个主 `Chart Artifact` / `Evidence Block` 的候选结果。

当前 `GenerationCycle` 已是应用层的公共深模块；`Generation Worker` 负责 `Generation Job` 的领取、`Worker Lease`、`Fencing Token`、冻结输入读取、凭据解密、状态提交和渲染交接。两者不能因引入框架而失去各自的领域责任。

DeerFlow 将 LangGraph 用于开放式 Agent 的模型、工具、中间件、子 Agent 与长期线程状态组装。LangReport 只借鉴其“纯参数工厂由宿主组装”的依赖方向，不引入通用 Agent、任意工具、MCP、Sandbox 或 IM Channel。关于框架和供应商适配的研究证据保留在 [LangChain / LangGraph 选型研究](../langchain-langgraph-selection.md)。

## 决策

### 以原始 StateGraph 表达受限应用工作流

在 `packages/generation` 中采用 TypeScript 的 `@langchain/langgraph` `StateGraph`。不使用 LangChain 高层 Agent、`create_agent` / ReAct 循环、`MessagesState`、模型自行选择工具或 LangGraph Agent Server。

`GenerationCycle.run(input)` 继续是调用方唯一的公共 Interface。它内部构造并调用 `EvidenceGenerationGraph`，将 Graph 的终态映射回现有的 `drafted`、`needs_clarification` 或 `failed` `GenerationCycleResult`。API、Web 和 Worker 不接收 LangGraph 类型，也不直接操作 Graph State。

Graph 工厂必须是纯参数组装入口：冻结的 `GenerationCycleInput` 和经 Worker 组装的 Port 显式传入，不读取全局配置、当前 Conversation 或 Workspace Credential。Port 至少包括已构造的 `ModelGateway`、时钟/预算与受限的 Snapshot/Plugin 读取能力；凭据本身不进入 Graph。

### 图的节点和有界路由

首版图只表达现有已批准的 Cycle 规则：

```text
prepare → plan → transform → compile → validate
              │                         │
              ├─ needs_clarification ───┤→ terminal
              └─────────────────────────┤
                                        ├─ valid → ready_for_render
                                        ├─ repairCount < 2 → repair → transform
                                        └─ otherwise → failed
```

- `prepare` 校验已冻结输入、上下文投影、Memory 冲突与总预算；
- `plan` 仅通过 `ModelGateway` 请求结构化 Chart Plan；
- `transform` 只执行允许列表内的 `TransformPlan`；
- `compile` 确定性生成 Flint Spec；
- `validate` 保存计划/语义校验结果并选择有限分支；
- `repair` 复用既有修复策略，累计计数不得超过二；
- `terminal` 只形成应用层结果，不能批准、渲染或持久化 `Chart Revision`。

`ready_for_render` 仍由 Generation Worker 在持有有效 Lease 时交接给 Render Worker；真实渲染、`Render Validation`、不可变 `Chart Revision` 和 `Evidence Block` 继续由 Render Worker 完成。

### Graph State 不是领域事实

Graph State 仅保存有界、可审计的运行数据：Job/Cycle 标识、输入和路由/模板版本哈希、截止时间、修复计数、结构化决策、`TransformPlan`、Flint Spec、校验记录和终态原因。

不得写入 Graph State：Workspace Model Credential、原始 API Key、整份 Data Snapshot、完整 Conversation、未脱敏样本、供应商原始响应、隐藏推理或可变的 Project / Workspace Memory。首版 Graph 以每个 Cycle 的冻结输入运行；原始行数据只能在非持久的节点执行上下文中使用，不能成为可恢复状态。

`Generation Job`、`Chart Revision`、`Evidence Block` 和 `Generation Audit` 仍是业务事实来源。节点不得直接写数据库：由 Worker 在 owner、lease token、fencing token 和未超期 Lease 条件下提交状态和终态结果。Graph 事件只能用于进度观测，不能绕过该条件更新。

### Harness 与应用层的归属

`EvidenceGenerationGraph` 的状态、节点和路由具有 LangReport 业务语义，属于逻辑应用层，物理上放在 `packages/generation`。`@langreport/harness` 继续承载已证明存在变化的中性模型调用 Adapter、预算、取消和事件归一化，且不得导入生成领域。

首个 Graph 不创建一个仅转发 LangGraph 的通用 `GraphRuntime` Harness Interface；只有第二条独立应用工作流确实需要相同的运行控制时，才将可复用的运行时 Adapter 提升到 Harness。这避免将单一调用方的假设做成浅模块。

### 持久化和人工澄清

首版使用无 Checkpointer 的 Graph；不使用 `interrupt()`。当前 `needs_clarification` 的应用语义保持为：持久化澄清问题、追加可见 Conversation 消息并结束当前 Cycle；用户补充信息后创建新的 Cycle，绝不静默改写旧 Job 的输入。

只有出现“同一 Cycle 必须跨进程暂停后从节点边界恢复”的已验证需求时，才单独设计 PostgreSQL Checkpointer。届时：

- `thread_id` 必须为 `generationJobId:fencingToken`，不得复用跨多个 Cycle 的 `conversationId`；
- Checkpoint 是运行恢复记录，不取代 Job、Revision 或审计事实；
- 节点重放前后的外部调用和持久化必须可证明幂等，并继续接受 Lease/Fencing 条件保护；
- Checkpoint 迁移、Graph State 版本和删除/保留策略必须另立 ADR 后才可上线。

## 后果

生成路径的分支、修复上限和终态变得显式可测，`GenerationCycle` 的外部 Interface、确定性执行器和审计合同保持稳定。代价是新增运行时依赖、Graph State 版本和节点路由测试；这些成本不以引入通用 Agent 或第二套业务状态机来交换。

该决定不授权自动批准、自动写入长期 Memory、跨文件 Join、任意用户代码、模型自动切换、外部追踪数据外发或运行中更改冻结的模型路线。

## 验证

- 固定咨询销售样例在改造前后保持相同的 `GenerationCycleResult`、TransformPlan、Flint Spec、校验记录和修复上限；
- 单元测试覆盖澄清、成功、验证失败、预算耗尽与两次修复后的停止分支；
- Worker 集成测试继续证明 Lease 丢失的旧 Worker 不能写入澄清、失败、渲染交接或 Revision；
- 静态依赖检查证明 Harness 不导入 `generation`、`db`、`data-engine`、`chart`、`memory`、Flint 或数据库 Schema；
- 对新增 Execution Assembly 验证不包含密钥、原始数据或供应商原始正文，且历史 Revision 明确标记为 legacy，而不伪造运行信息。

详细阶段、目标文件、验证命令和迁移前置条件见 [Harness 与 LangGraph 迁移实施计划](../harness-langgraph-migration-plan.md)。
