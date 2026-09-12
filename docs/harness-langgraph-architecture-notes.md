# Harness / App + LangGraph 架构学习与面试笔记

> 用途：理解 LangReport 的 Harness/App 分层、有限 `Generation Cycle` 图编排，以及准备真实、可追问的技术面试表达。
>
> 事实状态（2026-09-12）：当前代码已有 `GenerationCycle`、自有 `ModelGateway`、`Generation Job`、Worker Lease / Fencing Token 和受限 TransformPlan。当前工作树出现了未提交的 M1 `@langreport/harness` 抽取改动，尚未经过计划中的完整验收或合并；LangGraph `StateGraph` 与 `Execution Assembly` 仍处于已接受的实施计划，尚未安装或上线。面试时必须按真实状态选择“设计/规划”“开发中”或“实现/上线”的时态。

相关决策：[ADR 0014：Harness/App seam](./adr/0014-harness-and-application-seam.md)、[ADR 0015：有限 Generation Cycle 的 LangGraph 编排](./adr/0015-langgraph-bounded-generation-orchestration.md)、[迁移实施计划](./harness-langgraph-migration-plan.md)。

## 1. 这个问题到底在解决什么

LangReport 不是通用聊天 Agent，而是一个咨询项目报告产品：用户给出数据和分析问题，系统生成一个可追溯、可审核的 `Evidence Block`。一次 `Generation Cycle` 必须固定使用一个 `Data Snapshot`、已确认的 `Analysis Brief`、`Metric Definition`、Conversation projection、Visual Template 和 Model Route Snapshot；生成成功也只能创建 Draft，不能自动批准。

原有实现已经把规划、受限 TransformPlan 执行、Flint Spec 编译、校验和最多两轮修复放在 `GenerationCycle` 中。接下来的架构改造不是“让模型更自由”，而是让这条受控链路的责任、分支、审计和演进方式更清晰。

```text
API / Conversation
        │ 创建并冻结 Generation Job
        ▼
Generation Worker
  领取 Lease、心跳、组装依赖、受条件保护地提交
        │
        ▼
GenerationCycle（应用层公共 Interface）
  prepare → plan → transform → compile → validate
               │                         │
               ├─ needs_clarification ───┤→ 结束当前 Cycle
               ├─ repair ≤ 2 ─────────────┘
               └─ valid → ready_for_render
        │
        ▼
Render Worker → Render Validation → 不可变 Chart Revision / Evidence Block
```

## 2. 核心模式：Harness 提供技术能力，App 拥有业务语义

这里的 Harness 不是“另一个业务系统”，而是将可跨业务复用、且已经有真实变化来源的技术能力收敛起来的 Module。第一条真实 seam 是模型传输：deterministic 与百炼 Adapter 已经证明“结构化模型调用”存在多种 Adapter。

应用层则拥有咨询报告不可替代的语义：一个 Cycle 的冻结输入、Chart Plan、TransformPlan、Flint Spec、Revision、Evidence Block、审核、Worker Lease 和 Fencing Token。

| 位置 | 应负责什么 | 不应负责什么 |
| --- | --- | --- |
| `@langreport/harness` | 中性模型传输、超时、取消、结构化响应归一化、运行事件 | Data Snapshot 选择、Chart Plan Prompt、凭据存储、Job 状态、Revision、数据库 Schema |
| `packages/generation` | `GenerationCycle` Interface、EvidenceGenerationGraph 的 State/节点/路由、受限变换与校验 | 供应商 HTTP 细节、通用 Agent 平台、任意工具调用 |
| `apps/generation-worker` | Lease、心跳、读取冻结输入、短暂解密凭据、依赖组装、条件写入和 render handoff | 决定图的业务路由、绕过 Cycle 直接生成 Revision |
| `apps/render-worker` | 固定 Flint 渲染、Render Validation、不可变 Revision / Evidence Block | 重新理解用户意图、重新选择模型路线 |

这个划分借鉴 DeerFlow 的“纯参数工厂 + 宿主组装”方向，但不复制其开放式多 Agent、工具、中间件、Sandbox 和 IM Channel。LangReport 的约束更强，因此图的拓扑必须留在应用层，而不是塞入通用 Harness。

## 3. LangGraph 在这里扮演什么角色

LangGraph 只作为有限 `StateGraph` 的实现工具：节点做工作，条件边决定下一步。它不替代领域模型、数据库事务、权限校验或审计。

首版计划中的节点是：

| 节点 | 输入与职责 | 允许的结果 |
| --- | --- | --- |
| `prepare` | 校验冻结输入、上下文投影、Memory 冲突、总预算 | 进入 `plan`、澄清或失败 |
| `plan` | 只经 `ModelGateway` 请求结构化 Chart Plan | 候选计划、澄清或模型失败 |
| `transform` | 执行允许列表内的 TransformPlan | 变换结果和字段血缘，或失败 |
| `compile` | 由变换结果和固定模板确定性生成 Flint Spec | Flint Spec 或失败 |
| `validate` | 校验字段、语义、模板和计划 | render-ready、repair 或失败 |
| `repair` | 复用现有修复策略并增加计数 | 回到 transform；最多两次 |

`GenerationCycle.run(input)` 仍是外部调用方唯一需要理解的 Interface。Graph 的内部拆分提高可读性和测试局部性，但 API、Web 和 Worker 不应暴露 LangGraph 类型或直接读写 Graph State。

### Graph State 与业务记录的差别

这是面试最容易被追问的点：Graph State 是一次运行的工作内存，`Generation Job` / `Chart Revision` / `Evidence Block` 才是产品事实。

Graph State 只放有界的派生数据：Cycle/Job 标识、输入版本哈希、截止时间、修复次数、结构化决策、TransformPlan、Flint Spec、校验记录和终态原因。不能放 API Key、整份原始数据、完整 Conversation、未脱敏样本、供应商原始正文或隐藏推理。

因此首版显式使用 `checkpointer: false`：现有 Job、Lease 和 Fencing 已经是跨 Worker 的可靠执行机制。引入持久化 Checkpointer 会带来第二套恢复状态、节点重放和迁移问题；没有“同一 Cycle 必须跨进程暂停恢复”的真实需求前，不应为了框架能力而增加它。

## 4. 技术选型：选了什么，也明确没选什么

| 选择 | 解决的问题 | 为什么不是替代方案 | 代价与控制方式 |
| --- | --- | --- | --- |
| 原始 `StateGraph` | 将固定流程、条件分支和修复上限显式化 | 不用 ReAct / 高层 Agent：产品不允许模型任意决定步骤或工具 | 需要维护 State 与路由测试；保留 `GenerationCycle` 作为小 Interface |
| TypeScript 运行时 | 与现有 pnpm monorepo、Worker 和 contracts 同语言 | 不新建 Python / LangGraph Server：避免双运行时、双凭据路径和第二个调度器 | 锁定 npm 版本并在现有测试体系验证 |
| 自有 `ModelGateway` + Harness 传输 Adapter | 保留供应商路由、凭据、结构化输出、请求 ID、用量和错误审计 | 不让 LangGraph 或 LangChain 模型类型扩散进业务层 | Harness 只抽已有多 Adapter 证明的模型传输 seam |
| App 层 EvidenceGenerationGraph | Graph 的节点与 State 直接体现咨询报告领域规则 | 不在第一个图就建通用 `GraphRuntime`：只有一个调用方时它只是转发层 | 第二条独立工作流出现后再评估提升到 Harness |
| 现有 Job + Lease/Fencing | Worker 接管时仍禁止旧 Worker 写入结果 | 不立即采用 Checkpointer：避免双事实来源 | 每次写入持续匹配 owner、token、fencing token 与未超期 Lease |
| `needs_clarification` 结束当前 Cycle | 将人工补充信息纳入可追溯的 Conversation/Job 模型 | 不先用 `interrupt()`：恢复会重放节点，前置副作用必须幂等 | 用户补充信息后创建新的 Cycle，旧输入不被静默改写 |

需要特别说明：引入 LangGraph 不会自动提高图表正确率、降低模型费用或让任务恰好一次执行。正确性来自受限 TransformPlan、字段血缘、Plan/Render Validation 和人工审核；费用与时延需要在实施后用固定评测集、供应商调用记录和 p50/p95 数据测量。

## 5. 这个模式的优点，以及实际改进了什么

下表中的“改进”是实施后的可验证目标，不是当前已经取得的线上指标。

| 原来的痛点或风险 | 改造后的机制 | 可验证的改进 |
| --- | --- | --- |
| 受控修复隐藏在命令式循环中 | `validate → repair → transform` 成为显式条件边 | 测试可逐条证明“最多两轮、预算耗尽即停止” |
| 模型调用、供应商 HTTP 与业务语义容易相互渗透 | Harness 只收敛中性传输；App 保留 Prompt/Route/审计语义 | 新增或替换 Provider 不要求修改 TransformPlan、Revision 或 Worker 状态机 |
| Worker 同时承担过多细节 | Worker 负责执行权与提交，Cycle/Graph 负责业务计算 | Lease/Fencing 的正确性集中在一个位置，图节点更容易离线测试 |
| 运行时版本变化难以解释历史结果 | Execution Assembly 在新 Job 创建时冻结 Graph、Harness、合同和路由版本 | 可从 Revision 追溯“使用了哪种编排与模型执行装配” |
| 框架状态可能与数据库业务状态混淆 | Graph State 是运行内存；Job/Revision 是业务事实 | 不会因为 checkpoint 或 replay 绕过 Approved 不可变、唯一 Revision、权限与 Lease 规则 |
| 未来想增加独立流程但不想复制底层能力 | 先以小 Interface 封装传输；只在第二条工作流证明复用后抽运行时 | 避免过早抽象，同时保留演进空间 |

从模块设计角度，这带来三类收益：

- **Depth**：调用方只面对 `GenerationCycle.run()`，内部可以演进为多个节点和分支；
- **Locality**：模型协议改动集中在 Adapter，业务流程改动集中在 Generation Graph；
- **Testability**：通过固定输入、假的 ModelGateway 和明确终态测试整个 Cycle，而不是依赖真实模型或 Worker 进程。

## 6. 实施顺序与知识检查点

1. **M1：Harness 模型传输**。理解 Provider Adapter、超时、取消、结构化输出和 `ModelInvocation` 审计；不引入 LangGraph。
2. **M2：有限 StateGraph**。理解 State、Node、Edge、条件路由、终态映射、修复计数和无 Checkpointer 的原因。
3. **M3：Worker 收口**。理解 Lease、Heartbeat、Fencing Token、受条件保护写入和 render handoff。
4. **M4：Execution Assembly**。理解冻结配置、版本/哈希、历史兼容和 Revision 来源。
5. **M5：未来才讨论**。只有有真实暂停/恢复需求时，学习 Checkpointer、`thread_id`、节点重放、幂等和状态迁移。

每阶段的确切目标文件、命令和回退条件以 [迁移实施计划](./harness-langgraph-migration-plan.md) 为准。

## 7. 面试怎么讲：先保证事实，再组织故事

### 先选正确时态

| 你的真实状态 | 可以怎么说 | 不要怎么说 |
| --- | --- | --- |
| 只完成架构设计和文档 | “我负责设计/推动了这套迁移方案，并定义了验收与回退条件。” | “我上线了 LangGraph，显著提升了稳定性。” |
| M1 代码正在本地开发或尚未完成验收 | “我正在抽取 Harness 的中性模型传输，并以现有模型契约测试验证无行为回归。” | “Harness 已稳定上线并已经证明可复用。” |
| 已完成 M1/M2，但未上线 | “我完成了 Harness / Graph 的实现和离线回归测试，正在进行 Worker 集成。” | “生产已经支持跨进程恢复。” |
| 已完成并有运行数据 | “我实现并上线了……；指标的 baseline、周期和样本量是……” | 报没有来源的百分比、费用或稳定性指标 |

同样，只有你实际负责或共同负责过的决定，才能使用“我主导”；否则用“我参与设计，负责其中的 X 模块”，并说清团队其他人的职责。

### 30 秒版本：方案设计阶段

> 我在一个咨询报告生成系统里处理的是可追溯的图表证据生成，而不是开放式聊天 Agent。一次生成必须冻结数据快照、指标口径和模型路由，最多两次自动修复，最终还要经过渲染和人工审核。为此我把通用模型传输与业务流程分开：Harness 只处理模型调用、取消和错误归一化；应用层保留 Generation Cycle、TransformPlan、Revision 和 Lease/Fencing。LangGraph 只用于把固定的“规划—变换—编译—校验—有限修复”变成可测试的 StateGraph，不让模型自由调用工具。第一版仍以数据库 Job 作为事实来源，不急着引入 checkpoint，避免两套状态和节点重放风险。

这段话之后，必须能继续说明每个节点、为什么修复上限是两次、以及 Lease/Fencing 如何阻止旧 Worker 写入。

### 90 秒版本：已完成 M1–M4 后才使用

> 原来的 Cycle 已经能完成受限生成，但流程控制、模型传输和 Worker 组装集中度较高。我负责将它拆成两条清晰的 seam：第一条是 Harness 的结构化模型传输，保留了业务侧的路由冻结、凭据和审计；第二条是应用层的 EvidenceGenerationGraph。Graph 从 prepare 开始，经 plan、transform、compile、validate，在校验失败时最多两次回到 repair，成功只交接 render，不直接创建 Approved Revision。Worker 继续独占 Lease、心跳和 Fencing Token 校验，因此 Graph 节点没有数据库写权限。为保证历史可解释，我在 Job 创建时冻结 Execution Assembly，并在 Revision 创建时保留它。上线验证我会给出固定样例的回归结果、陈旧 Worker 提交被拒绝的集成测试，以及真实调用的耗时/费用口径；没有这些证据时，我不会宣称性能提升。

将“我负责”替换为真实职责；将最后一句的验证结果替换为你实际拥有的事实，不要背造指标。

### 高频追问与答题要点

| 面试官可能问什么 | 回答必须覆盖的要点 |
| --- | --- |
| 为什么选 LangGraph，不自己写 `while` 循环？ | 不是为了更智能，而是为了显式节点、条件边、有限修复、可视化和节点级测试；公共 Interface 仍是 `GenerationCycle.run()`。 |
| 为什么不用 Agent / ReAct？ | 产品操作集合和停止条件是固定的；让模型决定工具与步骤会突破数据、审核和修复预算约束。 |
| 为什么 Graph 不放 Harness？ | 该 Graph 的 State/节点直接是咨询报告业务语义；只有模型传输已经有多 Adapter，才是当前真实 seam。第一个 Graph 没有必要伪装成通用运行时。 |
| 为什么不一开始用 Checkpointer / interrupt？ | 现有 Job + Lease/Fencing 已解决 Worker 接管；checkpoint 会形成第二套恢复状态。interrupt/replay 可能重放节点，前置副作用需严格幂等，当前澄清用新 Cycle 更可追溯。 |
| 如何保证不重复写 Revision？ | Job 写入匹配 owner、lease token、fencing token 和未过期 Lease；Revision/Evidence Block 与 Job 的唯一关系保持业务幂等。外部模型调用仍可能至少一次，不能宣称 exactly-once。 |
| 如何保证模型不会泄露数据或绕过规则？ | 模型只拿最小上下文；凭据短暂存在于 Worker；Graph State 不存敏感数据；TransformPlan 只允许白名单操作；所有结果经过本地校验和人工审核。 |
| 如何衡量方案有效？ | 回归固定数据样例、分支/Lease 故障注入测试、审计完整度；上线后分别报告成功率、澄清率、修复率、p50/p95、费用，说明 baseline 和统计窗口。 |

## 8. 面试前自检清单

- 能不用框架名，先讲清楚“一个 Cycle 为什么必须冻结哪些输入”；
- 能画出 `prepare → plan → transform → compile → validate` 及两个终止分支；
- 能解释 Harness、Application、Worker、Render Worker 各自唯一的写入和决策责任；
- 能说清 `Worker Lease` 与 `Fencing Token` 的差别，以及为什么两者都需要；
- 能解释 Graph State、Checkpoint、Generation Job、Chart Revision 的不同事实地位；
- 能给出至少一个不选方案及其代价：通用 Agent、Python 服务、立即启用 Checkpointer；
- 能指出哪些内容仍是计划，哪些有测试/代码/运行数据作为证据；
- 如果要使用“主导”“上线”“提升”等强表述，已经准备好个人职责、baseline、数据来源和验证周期。

## 9. 延伸阅读

- [Harness/App 架构决策](./adr/0014-harness-and-application-seam.md)
- [LangGraph 有限编排决策](./adr/0015-langgraph-bounded-generation-orchestration.md)
- [具体迁移计划](./harness-langgraph-migration-plan.md)
- [LangChain / LangGraph 选型研究](./langchain-langgraph-selection.md)
