# Harness 与 LangGraph 迁移实施计划

> 状态：已批准的实现计划；尚未开始代码迁移。
>
> 决策来源：[ADR 0014：Harness/App seam](./adr/0014-harness-and-application-seam.md)、[ADR 0015：有限 Generation Cycle 的 LangGraph 编排](./adr/0015-langgraph-bounded-generation-orchestration.md)。

## 结果、范围与停止条件

结果是让 `GenerationCycle` 在不改变其公共 Interface、领域终态和可追溯性的前提下，以有限的 `StateGraph` 表达规划、受限变换、编译、校验和最多两轮修复；同时将中性模型传输收敛到 Harness。

本计划只覆盖一个 Consulting Project 的一个 Data Snapshot、一个 Analysis Brief 和一个主 Evidence Block。它不创建通用 Agent、工具/MCP 注册、Sandbox、IM Channel、Python 服务、LangGraph Server、自动审批或跨文件 Join。

任一阶段遇到下列情况必须停止在该阶段：固定样例的业务结果改变、Lease/Fencing 测试失败、Graph State 出现敏感数据、已冻结路由被重新解析，或当前未提交修改与目标文件重叠而无法安全合并。

## 目标依赖关系

```text
apps/generation-worker
  领取 Lease、心跳、冻结输入读取、依赖组装、受条件保护的提交
        │
        ▼
packages/generation
  GenerationCycle Interface → EvidenceGenerationGraph（业务状态、节点、路由）
        │                         │
        │                         ├─ ModelGateway
        │                         ├─ data-engine / Flint / plugin 受限执行
        │                         └─ 不直接写数据库
        ▼
packages/harness
  中性模型传输、超时、取消、归一化事件
```

`packages/generation` 虽位于 `packages/`，在本计划中仍是逻辑应用层。Harness 不包含 `EvidenceGenerationGraph` 的节点、Graph State 或 `Generation Job` 语义。

## 里程碑

### M0：决策与文档基线

状态：随本计划一并完成；不改运行时代码。

- 新增 `docs/adr/0015-langgraph-bounded-generation-orchestration.md`，明确 LangGraph 的采用范围、State、节点、持久化限制和 ADR 0014 的关系。
- 新增本计划；更新 `docs/architecture.md` 与 `docs/langchain-langgraph-selection.md` 的交叉引用和当前决策状态。
- 保留现有研究中有关供应商适配、数据发送和 LangSmith 的证据；ADR 0015 和本计划优先于其中“是否采用 LangGraph”的条件性措辞。

完成条件：文档同时说明 LangGraph 已被选为后续内部实现、当前运行时尚未安装依赖，以及它不会扩大第一阶段产品范围。

### M1：建立结构化模型调用 Harness

状态：未开始。该阶段不引入 LangGraph。

目标文件：

- 新增 `packages/harness/package.json`、`tsconfig.json`、`src/index.ts`、`src/structured-model.ts`、`src/structured-model.test.ts`；
- 修改 `packages/model-gateway/package.json`、`src/index.ts`、`src/index.test.ts`；
- 更新工作区锁文件；为 Harness 加入不反向导入应用层的依赖检查。

实现：将百炼/兼容 HTTP 的请求发送、超时、取消、结构化响应归一化和中性传输错误置于 Harness。`model-gateway` 保留 Workspace Credential 解密、Model Route Snapshot 校验、LangReport chart-plan Prompt、输出合同、本地 Zod 解析及 `ModelInvocation` 映射。

不做：不将 `GenerationCycle`、TransformPlan、Flint Spec、Job 状态、数据库或供应商凭据移入 Harness。

完成条件：deterministic 与百炼路径保留相同请求合同、错误分类、审计字段和取消行为；Harness 只依赖中性 TypeScript/传输类型。

验证：

```text
pnpm --filter @langreport/model-gateway test
pnpm --filter @langreport/generation test
pnpm typecheck
```

### M2：将 GenerationCycle 内部改为有限 StateGraph

状态：未开始。该阶段不改数据库 Schema、HTTP 合同或 Worker 入口。

目标文件：

- 修改 `packages/generation/package.json`，增加 `@langchain/langgraph` 及其实现所需的锁定 peer dependency；更新工作区锁文件；
- 新增 `packages/generation/src/evidence-generation-graph/state.ts`、`nodes.ts`、`routes.ts`、`graph.ts`、`graph.test.ts`；
- 修改 `packages/generation/src/index.ts`，让 `GenerationCycle.run()` 调用 Graph 并保持现有返回类型；
- 修改 `packages/generation/package.json` 的 test 脚本，将 Graph 测试加入现有离线基线。

实现：Graph 工厂接受冻结 `GenerationCycleInput` 与已组装 Port；以 `checkpointer: false` 编译。图严格执行 `prepare → plan → transform → compile → validate`，并仅在 `repairCount < 2` 时进入 `repair → transform`。Graph 结束于 `ready_for_render`、`needs_clarification` 或 `failed`，再映射为当前 `GenerationCycleResult`。

Graph State 只保存有界的派生结果和版本/哈希。Data Snapshot 行、密钥、完整 Conversation、原始供应商正文和隐藏推理不进入 State；节点不直接写数据库。

完成条件：现有 `model-baseline`、上下文投影和 Generation Cycle 测试继续通过；新增测试证明所有条件分支、修复上限、预算截止和审计连续性；对外没有 LangGraph 类型泄漏。

验证：

```text
pnpm --filter @langreport/generation test
pnpm --filter @langreport/model-gateway test
pnpm typecheck
```

### M3：收口 Generation Worker 的应用编排

状态：未开始；须先稳定当前 `apps/generation-worker/src/index.ts` 的未提交修改。

目标文件：

- 新增 `apps/generation-worker/src/evidence-generation-workflow.ts`；
- 修改 `apps/generation-worker/src/index.ts`，仅保留轮询、Lease 领取/心跳、依赖组装、调用和受条件保护的提交；
- 修改 `apps/generation-worker/src/worker.integration.test.ts`。

实现：`EvidenceGenerationWorkflow` 从已领取 Job 组装冻结输入、Theme/Plugin Context 和已构造的 `ModelGateway`，调用 `GenerationCycle`，再将结果映射为 Worker 的状态提交。`processEditJob` 保持独立，直到它有与首次生成相同的深度和不变量；不为目录统一而混合两条流程。

Worker 仍是唯一可写 `Generation Job` 的位置：所有澄清、失败、计划结果和 render handoff 都必须匹配 owner、lease token、fencing token 和未过期 Lease。Graph 不能获得数据库写入能力。

完成条件：成功、澄清、失败、Lease 丢失、超期恢复和 render handoff 的集成测试无行为回归；没有重复 Chart Revision 或 Evidence Block。

验证：

```text
pnpm --filter @langreport/generation-worker test
pnpm --filter @langreport/generation test
pnpm typecheck
```

### M4：冻结 Execution Assembly 并写入 Revision 来源

状态：未开始；须先稳定当前 `packages/contracts`、`packages/db/src/schema.ts` 和 Drizzle journal 的未提交修改。

目标文件：

- 修改 `packages/contracts/src/index.ts`、`http.ts`、`http.test.ts`，增加无密钥 `ExecutionAssembly` Schema 和只读 DTO；
- 修改 `packages/db/src/schema.ts`，由 Drizzle 在当前迁移序号之后生成 `generation_jobs.execution_assembly` 与 `chart_revisions.execution_assembly` 的增量迁移、snapshot 和 journal 更新；
- 修改 `apps/api/src/routes.ts`，在 Job 创建时冻结 Assembly；
- 修改 `apps/generation-worker/src/evidence-generation-workflow.ts`、`apps/render-worker/src/index.ts` 和相应集成测试，使 Assembly 随 Job 进入不可变 Revision。

Assembly v1 仅记录：Graph ID、Graph 定义哈希、Graph/运行时版本、`checkpointerMode: "none"`、Harness Adapter 版本、结构化输出合同版本/哈希和已有 Model Route Snapshot 的标识或哈希。它不得含 API Key、原始输入、完整 Prompt、供应商原始正文或隐藏推理。

历史 Job 和 Revision 不回填虚构信息；使用显式 `legacy` 描述或 `null` 加兼容显示。新 Job 必须在创建时完成冻结，重试、Worker 接管和渲染不得根据当前部署重新计算 Assembly。

完成条件：每个新 Chart Revision 都可定位输入快照、模型路线和实际图编排版本；Approved Revision 仍只读；旧 Revision 仍可读取且不会被伪造为使用了新图。

验证：

```text
pnpm --filter @langreport/contracts test
pnpm --filter @langreport/db db:verify
pnpm --filter @langreport/generation-worker test
pnpm typecheck
```

### M5：持久化 Checkpointer（未排期）

只有在同一个 Generation Cycle 必须跨进程暂停和恢复、且现有 Job 重新排队不足以满足产品要求时才启动。本阶段需要新的 ADR、PostgreSQL Checkpointer Adapter、State 迁移版本、保留策略、节点重放幂等证明和故障注入测试。

禁止使用 `conversationId` 作为 `thread_id`；仅使用 `generationJobId:fencingToken`。不在 M5 完成前使用 `interrupt()` 处理澄清、审核或模型切换。

## 阶段门禁与回退

- M1、M2 不触及 Schema，因此可通过恢复上一版已验证的 Harness / Generation 部署回退；删除依赖前先恢复通过的基线测试。
- M3 仅在 Worker 的现有未提交改动被审阅、测试并固定后开始；如回归，恢复为原有 `processClaimedGenerationJob` 入口，不改变已固化 Job 数据。
- M4 采用先扩展 Schema、Reader 兼容、写入新字段、最后要求新 Job 完整字段的顺序。回退只影响新 Job 是否采用 Graph，不回写历史 Assembly 或 Approved Revision。
- 任何阶段不通过时，不继续到下一阶段，也不以“框架已安装”作为实现完成的证明。
