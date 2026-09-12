# ADR 0014：将受控执行 Harness 与 LangReport 应用层分离

## 状态

已接受；本 ADR 只确定目标模块关系、迁移顺序和约束，不在本轮创建新 package、移动实现或改变运行时行为。

> 后续决策：[ADR 0015：用 LangGraph 编排有限的 Generation Cycle](./0015-langgraph-bounded-generation-orchestration.md) 已采用 LangGraph 作为应用层内部编排库。它只覆盖本 ADR 中“不引入 LangGraph”的限定；本 ADR 的 Harness/App 依赖方向和第一阶段排除项保持有效。

## 背景

LangReport 第一阶段的目标是可追溯、可审核的咨询项目图表证据，而不是通用 Agent 平台。当前 `GenerationCycle` 已将意图理解、受限 TransformPlan 执行、字段血缘、Flint Spec 编译、计划校验和最多两轮修复封装在一个公共入口之后；这是应用层的深模块，不应为复用而拆散。

同时，`apps/generation-worker` 目前同时承担 Job 领取、固化输入读取、模型路线与凭据解析、应用工作流调用和状态提交。模型调用路径也已有 deterministic 与百炼两种 Adapter。需要一个小而稳定的 Harness Interface，把可跨业务复用的受控执行机制从咨询报告领域规则中分离出来。

本决定参考 DeerFlow 的实际依赖方向：宿主 `app` 依赖 `harness`，而 Harness 不反向导入宿主；其纯参数 Agent 工厂与配置驱动工厂分开，并通过装配描述记录有效模型、工具和策略。LangReport 不采用 DeerFlow 的通用多 Agent、任意工具、MCP、IM 渠道或沙箱产品范围。

## 决策

### 目标模块关系

`apps/` 继续表示可部署进程，不新建一个与其混淆的业务 `app/` 目录。这里的“应用层”是逻辑层，由现有领域 package 和后续工作流模块组成。

```text
                         目标结构（非当前物理目录状态）

┌──────────────────────────────────────────────────────────────────┐
│ apps/web · apps/api · apps/generation-worker · apps/render-worker │
│ 传输、认证、进程生命周期、依赖组装                                │
└─────────────────────────────┬────────────────────────────────────┘
                              │ 调用并组装
┌─────────────────────────────▼────────────────────────────────────┐
│ LangReport 应用层                                                  │
│ GenerationCycle · Chart · Data · Memory · Review · Plugin Manifest│
│ 冻结 Cycle 输入；定义成功、澄清、失败与 Revision 的业务语义       │
└───────────────┬──────────────────────────────┬───────────────────┘
                │ 使用 Harness Interface       │ 使用领域基础设施
┌───────────────▼──────────────┐  ┌────────────▼───────────────────┐
│ @langreport/harness           │  │ db · storage · flint-adapter   │
│ 结构化模型调用                │  │ data-engine · plugin-sdk       │
│ 执行预算/取消/事件（按需）    │  │ 具体持久化和受限领域执行       │
└───────────────┬──────────────┘  └────────────────────────────────┘
                │ Adapter
      ┌─────────▼──────────┐
      │ 模型供应商 / 遥测端 │
      └────────────────────┘
```

依赖规则如下：

- `apps/*` 可以依赖应用层、Harness 和基础设施 Adapter，并只在这里组装进程级依赖。
- 应用层可以依赖 Harness 的 Interface，以及本产品的领域模块和基础设施 Adapter。
- Harness 不得导入 `@langreport/domain`、`generation`、`data-engine`、`chart`、`memory`、`flint-adapter`、`plugins`，或任何 LangReport 数据库 Schema。
- Harness 不得读取 `Workspace Model Credential`、重新读取可变 Conversation，或决定 Chart Revision / Evidence Block 的状态；应用层必须先提供非密钥、已冻结且已授权的执行输入。

### Harness 的初始 Interface

初始只建立已有两个 Adapter 证明过的 `StructuredModelInvocation` seam。它接收应用层准备好的非密钥模型路由、消息/上下文、结构化输出合同、执行预算与取消信号，返回归一化的成功或失败结果及 `Model Invocation` 审计摘要。

Harness 不生成 LangReport 的 chart-plan prompt，不选择 Data Snapshot，不执行 TransformPlan，也不写入 Generation Job。`Workspace Model Credential` 的加解密、Model Route Snapshot 的冻结和供应商选择仍在应用层/基础设施侧；调用时才把短暂明文交给模型 Adapter。

应用层应逐步提供一个纯参数的 `EvidenceGenerationWorkflow` 构造入口；Worker 的配置、轮询和依赖组装留在 `apps/generation-worker`。这借鉴了 DeerFlow 的“纯参数工厂 + 配置驱动宿主工厂”模式，同时避免把全局可变配置带入 Cycle。

### 明确不纳入 Harness

- `GenerationCycle`、TransformPlan、字段血缘、Flint Spec、Chart Revision、Evidence Block、Review、Memory Candidate 和 Plugin Manifest；
- Generation Job 的状态机、Worker Lease、Fencing Token、幂等和渲染交接；这些都绑定第一阶段的可追溯业务语义；
- 通用 `agents/`、多 Agent 编排、任意 `tools/`、MCP、IM `channels/` 或用户代码 `sandbox/`；第一阶段不支持这些能力；
- DeerFlow 式运行中配置热加载。一次 Generation Cycle 必须继续冻结 Data Snapshot、Analysis Brief、Metric Definition、Conversation projection、Visual Template 与 Model Route Snapshot。

## 迁移边界和顺序

| 阶段 | 变更边界 | 保留不变 | 进入下一阶段的证明 |
| --- | --- | --- | --- |
| 0：记录 | 本 ADR 与系统架构图 | 所有目录、运行时与数据库 Schema | 文档评审通过 |
| 1：模型调用 seam | 新增窄的 `@langreport/harness` 模型调用模块；从 `model-gateway` 分离供应商传输、超时、取消、结构化输出归一化 | Model Route Snapshot、凭据加密、LangReport prompt 和 GenerationCycle | deterministic 与百炼路径均通过原有模型/生成合同测试；Harness 无应用层导入 |
| 2：应用工作流 | 从 Generation Worker 提取纯参数 `EvidenceGenerationWorkflow`，由 Worker 负责领取 Lease、提供 Adapter、提交结果 | Job 状态机、Lease/Fencing 条件、唯一 Revision/Evidence Block 约束 | 现有成功、澄清、失败、Lease 丢失和渲染交接测试保持通过 |
| 3：装配审计 | 在 Job 创建时补充非密钥的执行装配描述/指纹，记录 Harness Adapter 版本、输出合同与有效执行策略 | 已有 Model Route、模板和上下文快照不被替代 | 任一 Revision 可同时定位业务输入快照与有效执行装配 |
| 延后 | 仅在第二种独立执行流或多种受控能力出现后评估运行控制、能力注册或隔离执行 seam | 第一阶段产品范围 | 至少两个真实 Adapter/调用方证明 seam 不是假设性的 |

现有模块的归属：

| 当前模块 | 目标归属 | 迁移动作 |
| --- | --- | --- |
| `packages/generation` | 应用层 | 保持 `GenerationCycle` 作为公共 seam；新增 Workflow 时调用它 |
| `packages/data-engine`、`chart`、`memory`、`flint-adapter`、`domain`、`plugin-sdk` | 应用层 | 不移入 Harness |
| `packages/model-gateway` | 过渡层 | 仅将中性的供应商调用 Adapter 抽入 Harness；路由、凭据和产品 prompt 留下 |
| `packages/db` 的 Generation Job Lease | 应用基础设施 | 不抽成通用 RunManager |
| `packages/storage` | 应用基础设施 | 保持对象存储 Adapter |
| `apps/api` | Gateway 宿主 | 保持鉴权、前置条件检查和 Job 创建 |
| `apps/generation-worker` | Worker 宿主 | 逐步缩为领取/心跳/组装/调用/提交 |
| `apps/render-worker` | Worker 宿主 | 保持固定 Flint 渲染与输出校验 |

## 后果

此决定把可复用性建立在小 Interface 上，而不是建立一个覆盖所有未来 Agent 特性的浅层框架。模型调用是目前唯一已有多个 Adapter 的真实 seam；其他 Harness 能力必须在出现第二个真实变体前保持在应用层。

产品不变量保持不变：一次第一阶段 Generation Cycle 仍只使用一个 Data Snapshot 和一个 Visual Template，生成一个主 Evidence Block；Approved Revision 仍不可变；模型、工具和 Worker 都不能绕过 Workspace/Project 权限、Snapshot、Revision 或 Lease/Fencing 条件。

本 ADR 不引入 DeerFlow、LangChain、LangGraph、MCP 或新的运行时依赖，也不授权用户代码执行、热更新模型路线或自动批准结论。

## 验证

- 对新增 Harness package 建立依赖检查，证明其不反向导入 LangReport 应用层；
- 每个迁移阶段复跑 GenerationCycle、Model Gateway、Worker Lease/Fencing、Render Worker 和相关 HTTP 合同测试；
- 对固定销售 CSV 验证同一 Data Snapshot、Metric Definition、TransformPlan、Flint Spec、Visual Template 和校验记录仍能生成相同的 Draft Evidence Block；
- 在 Schema 或状态推进发生变化时，额外验证 Approved Revision 不可修改、过期 Worker 不能提交结果，且导出仍绑定固定 Revision。
