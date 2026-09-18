# Generation Readiness Gate seam 深化：Design

- 变更编号：`CHG-2026-09-18-generation-readiness-gate-seam`
- 状态：`APPROVED`
- 创建时间：2026-09-18
- 更新时间：2026-09-18

> 审核结论：用户已批准执行。直接消费者只做最新版 Proposal 的机械接线，不恢复兼容层；历史澄清 payload 可丢弃。

## 现状与约束

- `packages/generation/src/readiness-gate.ts` 当前接收 `error?: unknown`，通过错误 code 或中文 message 识别 `MISSING_X_FIELD`。
- 当前 Gate 已有 `ready | needs_clarification | blocked` 三分支，并对横轴缺失生成 `ClarificationQuestion` 的 options、recommendedOption 和 evidence。
- `GenerationCycle` 的公共入口和有限 `EvidenceGenerationGraph` 属于 `packages/generation`；Graph State 不直接写数据库。
- `@langreport/contracts`、API、Worker 和 Web 当前仍存在上一轮 `ClarificationQuestion`/`questions` 数据传递；本轮以最新版 Proposal 替换该传递，不保留旧投影或双读。
- 依据 [CONTEXT.md](../../../CONTEXT.md)、[领域模型](../../architecture/domain-model.md) 和 [ADR 0015](../../adr/0015-langgraph-bounded-generation-orchestration.md)，Proposal 只对当前 Generation Cycle 生效，不能成为 Project Memory、Metric Definition 或 Visual Template。

## 设计目标与非目标

### 目标

- 将 Gate 的输入事实、确定性候选和用户待决 Proposal 分层表达。
- 让已知可恢复问题由稳定 Diagnostic code 驱动，去掉对错误 message 的业务分支依赖。
- 让候选的来源、资格、统计证据和推荐理由可测试、可审计、可重复。
- 让 GenerationCycle 和直接消费者只使用最新版 Proposal；必要的 contracts/HTTP/Worker/Web/持久化类型更新只负责接线，不新增产品行为。

### 非目标

- 不创建通用规则引擎、规则注册表、插件规则扩展点或动态阈值配置。
- 不改变当前只接入的 Compile 横轴缺失和 Planning 数值指标缺失规则；本轮只重构它们的 seam 表达。
- 不修改 LangGraph 拓扑、Harness Interface、Model Gateway 或 TransformPlan 执行器；DB/HTTP 只做最新版 Proposal 字段的机械替换，不新增路由或业务行为。

## 方案选型

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 继续把 `unknown` error 和 `ClarificationQuestion[]` 作为唯一接口 | 改动最小 | message 识别不稳定，诊断/建议/用户决策混在一起 | 拒绝 |
| 在 Gate 内建立结构化 Diagnostic、Candidate、Proposal，并让直接消费者切换到 Proposal | 语义单一、无需双读、历史数据可丢弃，最新版可直接演进 | 需要同步更新直接调用方和传输类型 | 采用 |
| 建立可注册的通用 Rule Engine | 未来规则扩展方便 | 当前只有少数固定规则，提前固化扩展点会扩大边界和维护面 | 拒绝 |
| 让模型生成或排序候选 | 表达能力更强 | 不确定、不可复现，无法证明字段来自 Snapshot/TransformResult | 拒绝 |

## 模块边界

### `readiness-gate.ts`

保留一个明确的 `evaluateGenerationReadiness(input)` 入口，但将输入从任意错误改为可序列化 `GenerationDiagnostic | undefined`。Gate 内部使用显式的固定分支，不使用规则注册表：

```text
GenerationReadinessInput
  ├─ stage
  ├─ profiles
  ├─ intent
  ├─ transform
  └─ diagnostic?

GenerationReadinessResult
  ├─ ready: diagnostics[]
  ├─ needs_clarification: diagnostic + proposal
  └─ blocked: diagnostic
```

`GenerationDiagnostic` 至少包含 `code`、`stage`、`severity`、安全可读的 `message`、`source` 和可选的结构化 details。details 只允许保存缺失目标、已存在列、候选目标等有限数据，不保存异常 stack、供应商原文、密钥或完整原始行。

`GenerationClarificationProposal` 至少包含：

- `code` 和 `target`：本次 Proposal 对应的稳定问题及用户需要决定的目标；
- `diagnostic`：触发 Proposal 的结构化事实；
- `question`、`reason`：面向用户的解释；
- `candidates`：确定性候选及其 evidence/provenance；
- `recommendedCandidate`：可为空；若存在必须是 candidates 的成员；
- `requiresUserDecision: true`：明确 Proposal 不是自动选择。

Proposal 不包含 `GenerationDecision`，也不修改输入快照；用户的选择仍由已有 API/Job 流程在后续 Cycle 表达。

### 候选来源和结构

本轮只支持 `MISSING_X_FIELD` 的横轴候选。候选集合由两个来源合并、按字段名去重：

1. `transform_output`：当前 `TransformResult.columns` 中可以作为横轴的字段，并从 `TransformResult.rows` 计算有限统计证据；
2. `snapshot_requires_transform`：当前 `ColumnProfile[]` 中存在、但没有出现在 Transform 输出的非空字段，表示需要在新的 Cycle 中调整 TransformPlan 才能保留。

候选必须排除当前指标字段、明确的数值聚合/派生指标输出和 `null` 类型字段；候选至少需要一个非空值。Gate 不从错误文本、Prompt 词语或模型输出之外的来源创建字段。

候选的结构化表示包含 `value`、`label`、`source`、`requiresTransformAdjustment` 和：

```text
evidence = {
  inferredType,
  nullCount,
  distinctCount,
  availableInTransform,
  sourceColumns[]
}
```

`sourceColumns` 优先来自 TransformResult 的 lineage；无法获得 lineage 时只保留字段自身，不伪造上游字段。候选 evidence 不包含样例原文，避免把原始数据带入审计展示。

### 确定性顺序

不暴露模型分数。候选使用固定的字典序 key 排序：

1. 当前 `intent.timeColumn` 精确引用；
2. 当前 `intent.dimensionColumns` 的声明顺序；
3. 是否已经在 Transform 输出中；
4. 固定类型顺序：`date`、`string`、`boolean`、`number`；
5. `nullCount` 升序；
6. `distinctCount` 升序；
7. 字段名稳定排序。

候选默认最多输出 8 个；推荐为排序后的第一个候选，但只有用户提交 `accept_recommendation` 后才可在外部流程使用。排序函数只依赖输入快照和固定常量，不依赖当前时间、随机数、模型或全局配置。

## 数据模型与状态流转

本轮不新增领域实体。变化发生在 `packages/generation` 的运行结果和 Graph State；直接消费者同步采用最新版 Proposal，历史澄清 payload 可以丢弃：

```text
typed diagnostic
      │
      ▼
Readiness Gate
  ├─ ready → continue existing graph
  ├─ needs_clarification → diagnostic + ClarificationProposal
  └─ blocked → existing failed mapping
```

`EvidenceGenerationGraphState` 增加可选的 Proposal/Diagnostic 运行字段；`GenerationCycleAudit` 增加结构化 readiness diagnostic/proposal 摘要。它们是当前 Cycle 的结果快照，不是 Checkpoint、Project Memory 或跨 Cycle 规则。

`GenerationCycleResult.status` 不变。`needs_clarification` 结果只返回结构化 Proposal；`questions` 字段删除，不再从 Proposal 派生旧数组。`drafted`、`failed` 的状态和错误码语义不变。

## API / 外部契约

Proposal 是本轮唯一的澄清数据形状。直接消费者必须切换为 `proposal`：

```text
GenerationCycleResult.needs_clarification
  → Generation Worker
  → Generation Job / HTTP response
  → Web clarification panel
```

旧 `questions`/`clarificationQuestions` 数组不再生成、读取或校验；已有历史 payload 可以清理、截断或直接丢弃，不做回填、不做双读、不做旧字段兜底。若持久化字段名需要从 `clarificationQuestions` 改为 `clarificationProposal`，直接替换即可。

为保持 Proposal 的结构化校验，直接消费者可以复用 `packages/generation` 导出的最新版类型/解析器，或同步更新 `packages/contracts` 的单一合同；不得重新引入 `ClarificationQuestion` 兼容适配。该机械传递更新不新增新的 HTTP route、Generation Decision action 或 Web 产品能力。

## 架构图

```text
typed compile/planning diagnostic
            │
            ▼
  @langreport/generation
  ┌──────────────────────────┐
  │ Readiness Gate            │
  │ explicit fixed evaluators │
  └───────┬───────────┬──────┘
          │           │
       blocked      proposal
          │           │
       failed   candidates + recommendation
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
   GenerationCycle audit     latest Proposal transport
                                  │
                         Worker/API/Web direct consumer
```

## 数据流

1. Graph 的 planning/compile 节点先把已知异常归一为稳定 Diagnostic；未知异常只生成 blocked Diagnostic，不通过 message 猜规则。
2. Gate 使用冻结输入中的 profiles、intent、TransformResult 和 Diagnostic，构造候选 provenance/evidence，并按固定 key 排序。
3. Gate 返回 `ready`、`needs_clarification` 或 `blocked`。`needs_clarification` 必须包含 Proposal，且 Proposal 的推荐项只能引用候选。
4. GenerationCycle 将 Proposal/Diagnostic 写入运行结果和 audit；Worker/API/Web 直接传递和展示 Proposal，不经过旧 questions 映射。
5. 外部层若收到用户选择，仍按已有 Generation Decision 创建新 Cycle；本轮 Gate 不消费或持久化长期记忆，不自动修改原 Job。

## 权限、校验与异常处理

- Gate 不做数据库查询和权限判定；它只消费调用方已授权、已冻结的 profiles/rows/TransformResult。
- 候选值必须在 profiles 或 TransformResult.columns 中出现；任何外部传入的用户选择仍由已有 API/Worker 重新校验，本轮不改变该边界。
- 结构化 Diagnostic 不含 secrets、provider raw body、stack 或原始供应商响应；未知异常转换为安全的 blocked/failed 原因。
- `MISSING_X_FIELD` 只在指定阶段和指定 target 下生成 Proposal；同 code 在其他阶段不自动放行。
- 零候选仍可返回 Proposal，但 `candidates=[]`、`recommendedCandidate=null`，要求用户通过既有文本方向重新开始；不得伪造候选。
- 一个候选也仍返回 Proposal，不自动采用。

## 迁移、兼容与回滚

- 不新增 package、HTTP route、Generation Decision action 或外部配置；允许对直接传递类型、持久化 JSONB 字段名和 contracts 类型做最新版替换。
- 不做历史 payload 回填、双写、双读或兼容解析；部署前可清理/丢弃旧 `clarificationQuestions` 数据，旧 Job 不作为新读取路径的输入。
- 实现前提是人工审核通过；未通过前只允许文档和只读调查。
- 回滚只针对本变更代码和最新版字段，不承诺恢复已丢弃的旧澄清 payload；如需恢复历史数据必须另行从备份处理。
- 若结构化 Diagnostic 导致既有未知错误被错误识别，修复最新版 evaluator；不得通过重新加入旧 message 兼容分支解决。

## 日志、监控与可观测性

- 本轮只在现有 GenerationCycle audit 中增加安全的 Diagnostic/Proposal 摘要；不新增跨模块指标和日志通道。
- 审计应能区分 `blocked` Diagnostic、`needs_clarification` Proposal 和用户后续 Generation Decision；Proposal 本身不表示用户已接受。
- 不记录模型排序分数、隐藏推理、原始数据样本、密钥或供应商原文。

## 测试策略

- Gate 单测：结构化 code 驱动、message 变化不影响结果、未知 code blocked、候选 provenance、固定排序、零/一/多候选和推荐成员约束。
- Cycle 回归：Compile 横轴缺失只返回 Proposal；未知 Compile 错误继续 `GENERATION_COMPILATION_FAILED`；audit 保存结构化摘要。
- Graph 路由回归：Proposal 终止当前 Cycle，不进入 Transform/Validate/Render；ready/failed 既有路径不变。
- 全量回归：contracts、generation、API、Worker、Web、全 workspace typecheck、offline test、db verify 和 docs check 均按变更 test-plan 执行。

## 需求追踪矩阵

| 需求 | 设计 | 任务 | 测试 | commit |
| --- | --- | --- | --- | --- |
| R1 结构化 Diagnostic 驱动 Gate | Diagnostic 输入、显式 evaluator、未知 blocked | T1/T3 | Gate diagnostic 单测、Cycle 回归 | N/A |
| R2 候选可追溯且确定性 | Candidate provenance/evidence 与固定排序 | T2 | candidate 单测、重复运行回归 | N/A |
| R3 Proposal 与 Decision 语义分离 | Proposal 类型，Result 只返回 Proposal | T3 | Proposal 不变量、Cycle/Graph 回归 | N/A |
| R4 直接消费者采用最新版 | Worker/API/Web/传输类型机械切换，无旧读路径 | T0/T5 | diff 范围检查、跨包回归 | N/A |
| R5 现有成功/失败状态保持 | 保持 Result status 和非澄清路径；历史澄清数据不兼容 | T3/T4 | generation、API、Worker、Web 回归 | N/A |
