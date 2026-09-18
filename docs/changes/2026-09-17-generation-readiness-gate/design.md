# 生成前提决策门：Design

- 变更编号：`CHG-2026-09-17-generation-readiness-gate`
- 状态：`APPROVED`
- 创建时间：2026-09-17
- 更新时间：2026-09-17

## 现状与约束

- `GenerationCycle` 是 Generation 模块对外的唯一生成入口；Graph 只在模块内部编排。
- `ClarificationQuestion` 已存在，但只有问题文本、原因、字段和候选选项。
- Graph 的 Compile 节点捕获异常后统一返回 `GENERATION_COMPILATION_FAILED`。
- Generation Job 目前没有 `cancelled` 状态，也没有父 Job 或结构化 Generation Decision。
- 第一阶段要求一个 Cycle 绑定一个 Data Snapshot、一个 Visual Template 版本和一个主 Evidence Block；旧 Job 与 Approved Revision 不可覆盖。

## 设计目标与非目标

### 目标

- 用一个深模块隐藏“当前阶段能否继续、是否需要用户选择、哪些候选有证据”的判断；
- 让候选字段只来自 Data Snapshot 或当前 TransformResult；
- 将用户决策作为当前 Cycle 的输入事实保存，并创建新的 Cycle；
- 把用户停止与系统失败分开。

### 非目标

- 本轮不重构 LangGraph、不改变模型供应商协议、不增加长期记忆写入；
- 本轮不支持运行中 Job 的强制取消；
- 本轮只接入 Compile 阶段的横轴缺失规则，其他阶段复用同一接口但保留后续接入点。

## 方案选型

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 在 Worker 和 Web 中分别判断错误文本 | 改动快 | 规则分散、无法保证候选有证据 | 拒绝 |
| 继续把所有问题归为 Failed | 不改状态机 | 用户无法决策，失败统计失真 | 拒绝 |
| Generation Readiness Gate 返回结构化结果 | 规则集中、可单测、可扩展到五个阶段 | 需要扩展合同和 Job 状态 | 采用 |

## 模块边界

### `@langreport/generation`：Generation Readiness Gate

公共 Interface 保持一个函数：

```text
evaluateGenerationReadiness(input) ->
  ready | needs_clarification | blocked
```

Implementation 接收当前阶段、ConversationIntent、ColumnProfile、TransformResult 和可选错误。它不读数据库、不写状态、不调用模型、不修改 Data Snapshot。当前实现只在 Compile 阶段处理横轴缺失；未来阶段规则通过内部评估器接入同一 Interface。

### `@langreport/contracts`

- 扩展 ClarificationQuestion：`stage`、`severity`、`recommendedOption`、`evidence`；
- 允许只有一个候选，符合“一个候选也必须询问”的规则；
- 增加 GenerationDecision：`accept_recommendation`、`select_candidate`、`adjust_direction`；
- 增加 Job 状态 `cancelled`。

### API / Worker

- API 创建新 Job 时校验 `parentJobId` 属于同一个 Project/Conversation 且父 Job 为 `needs_clarification`；
- API 将 `generationDecision`、`parentGenerationJobId` 写入新 Job；
- Worker 将 Generation Decision 传入 GenerationCycle；确定性 Adapter 对明确的 `x_field` 选择重建 TransformPlan；
- `POST /api/v1/generation-jobs/:jobId/cancel` 只允许取消 `needs_clarification` Job，并写入 `GENERATION_STOPPED_BY_USER`。

### Web

- 澄清面板展示问题、原因、推荐项和证据；
- 选择按钮只预填用户可见回答，同时保存结构化决策；
- 补充文本创建 `adjust_direction` 决策；
- 停止按钮调用 cancel 接口；
- `cancelled` 显示为“已停止”，不显示失败或重试操作。

## 数据模型与状态流转

```text
Generation Job (compiling)
  → Readiness Gate
      ├─ ready → Flint Spec → Validate → Render
      ├─ needs_clarification → Job.needs_clarification
      │       ├─ accept/select/adjust → new Generation Job (parent + decision)
      │       └─ stop → Job.cancelled
      └─ blocked → Job.failed
```

新增 Job 持久字段：

- `parent_generation_job_id`：只保存父 Job UUID，由 API 校验作用域；
- `generation_decision`：当前 Cycle 的结构化用户决策；
- 状态枚举增加 `cancelled`。

不增加 Chart Revision 的父关系：只有成功生成的 Revision 才建立既有 Job → Revision 关系；澄清和停止阶段保留在 Job 审计链中。

## API / 外部契约

### Generation Decision

```json
{
  "action": "select_candidate",
  "parentJobId": "uuid",
  "questionCode": "MISSING_X_FIELD",
  "target": "x_field",
  "selectedValue": "区域"
}
```

`adjust_direction` 使用 `text`，不直接写入字段选择；新的 Generation Cycle 仍必须重新经过 Gate、权限和字段校验。

### Cancel

```text
POST /api/v1/generation-jobs/:jobId/cancel
```

只允许当前 Project Editor 及以上角色取消等待澄清的 Job。取消是幂等的：已取消返回当前 Job，其他终态返回冲突。

## 架构图

```text
Model Plan / TransformResult
          │
          ▼
Generation Readiness Gate
   ┌──────┼─────────┐
 ready  clarify   blocked
   │       │          │
 compile  Job/API    failed
          │
    Web decision
      ├─ new Cycle
      └─ cancelled
```

## 数据流

1. `GenerationCycle` 获得冻结 Snapshot、Brief、Metric、Template 和 Conversation projection。
2. Plan 和 Transform 产生当前意图、计划、字段画像和输出字段。
3. Gate 使用确定性规则生成候选；对缺失横轴，直接输出字段候选和证据，不调用模型。
4. Worker 将 `needs_clarification`、问题、审计和校验记录写入原 Job。
5. 用户选择或补充后，API 创建新 Job，冻结相同或当前有效 Snapshot/Template，并保存父 Job 与决策。
6. 新 Job 重新经过完整 Cycle；旧 Job 不被修改。

## 权限、校验与异常处理

- 所有 Job 查询、选择和停止都验证 Project 权限；
- 候选字段必须来自当前 Snapshot profiles 或 TransformResult.columns；
- 结构化选项值不会被直接信任，Worker 重新验证字段存在性；
- 未知编译异常、Snapshot 读取异常、模型鉴权异常和租约错误仍为 `failed`；
- 澄清问题不创建 Chart Revision，不产生成功 Evidence Block；
- 用户停止不进入失败重试集合。

## 迁移、兼容与回滚

- 增加一个可前滚 SQL 迁移：扩展 `generation_job_status`，增加两个 nullable JSON/UUID 字段；
- 旧 Job 的新增字段保持 null，旧状态继续有效；
- API 合同向后兼容，缺少决策字段仍按原生成路径；
- 回滚代码前需先停止创建新字段数据，再回滚应用；数据库字段保留以避免破坏审计；
- 不删除或重写历史 Job、Revision 和审计。

## 日志、监控与可观测性

- Generation Audit 保存 Gate 阶段和澄清问题；
- Job 保存问题、推荐项、用户决策和父 Job；
- 记录 `MISSING_X_FIELD` 的出现次数、澄清后新 Cycle 成功率和用户停止率；
- 不记录模型密钥、原始供应商正文或隐藏推理。

## 测试策略

- Gate 单元测试：已有输出字段、源字段被 Transform 丢弃、只有一个候选、无候选、不可恢复错误；
- Generation Cycle 回归测试：编译缺少横轴返回澄清而非失败；接受候选后重建计划并成功；
- Contracts 测试：推荐项、证据、一个候选、Generation Decision 和 cancelled 状态；
- API 测试：父 Job 作用域、停止权限、幂等和终态冲突；
- Web 类型检查和现有 E2E 类型检查。

## 需求追踪矩阵

| 需求 | 设计 | 任务 | 测试 | commit |
| --- | --- | --- | --- | --- |
| R1 可恢复前提进入澄清 | Gate + Compile 接入 | T2/T3 | Gate 单测、Generation 回归 | N/A |
| R2 候选带证据 | ClarificationQuestion 扩展 | T1/T2/T5 | Contracts、Web 类型 | N/A |
| R3 决策创建新 Cycle | GenerationDecision + parent Job | T1/T4/T5 | API、Worker/Generation | N/A |
| R4 用户停止不算失败 | cancelled + cancel route | T1/T4/T5 | API、Web 类型 | N/A |
| R5 旧结果可追溯 | append-only Job 链 | T4 | API 集成 | N/A |
