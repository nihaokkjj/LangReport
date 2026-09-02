# Agent 启动与 Loop 规范

> 适用对象：在 LangReport 仓库中执行产品、文档、后端、Worker 或 UI 任务的 Agent。
>
> 目标：让每一轮工作都从真实状态出发，以一个可验证的咨询项目结果结束，并把下一轮需要的上下文保存下来。

## 1. 文档路由

Agent 按以下顺序加载上下文：

1. 根目录 `AGENTS.md`：工作纪律、产品总边界和 UI 特殊要求；
2. 根目录 `CONTEXT.md`：业务术语和领域对象；
3. 与任务分支匹配的文档：
   - 咨询项目产品范围：`docs/phase1-consulting-report.md`；
   - 生成、数据、Worker 或系统边界：`docs/architecture.md`；
   - 聚合、不变量或状态机：`docs/domain-model.md`；
   - 模板、记忆或插件变更：对应 ADR 和设计文档；
   - UI 页面、组件、样式或交互：完整读取 `DESIGN.md`。

`CONTEXT.md` 是术语唯一来源；第一阶段产品规格是范围和验收唯一来源；本文件是 Agent 启动、循环和停止条件的唯一来源。实现代码、package script 和配置文件是运行事实的唯一来源，不在文档中复制容易过期的命令细节。

## 2. 启动协议

每次新任务或新一轮继续工作都按以下顺序执行。

### S1：建立事实

读取相关文档，检查：

- 当前工作树和已有用户修改；
- 目标模块和现有入口；
- 相关测试、类型和构建脚本；
- 任务是否属于第一阶段。

如果实现与文档不一致，记录“代码事实”和“目标规范”两者，不把任意一方静默当成另一方。

### S2：声明范围

在开始修改前，形成一段内部任务记录：

```text
Outcome: 本轮要交付的一个用户可感知结果
Aggregate: 主要修改的领域边界
In scope: 本轮会改变的行为
Out of scope: 明确留给后续轮次的内容
Proof: 完成时要运行的测试、检查或可视验证
```

一个任务只设置一个主要 Outcome。若同时涉及多个独立聚合，拆成多个 Loop；文档联动修改可以随主要 Outcome 一起完成。

### S3：设计最小改变

先确认已有领域对象、状态机和不变量，再选择最小的实现路径。新实体只有在现有实体无法表达用户场景时才创建；新名词先进入 `CONTEXT.md`，新且难以逆转的取舍才进入 ADR。

### S4：执行前检查

- UI 任务已读取 `DESIGN.md`；
- 数据或生成任务已读取第一阶段产品规格和本文件；
- 预计会改变数据模型时已检查 schema 和迁移状态；
- 预计会改变 API 时已检查前端调用和 contracts；
- 工作树中的无关修改已被识别并保留。

启动协议的完成条件：Agent 能说清本轮 Outcome、范围、证明方式和受影响的不变量。

## 3. 开发 Loop

每轮开发依次经过以下状态：

```text
START
  → SCOPED
  → MODELED
  → IMPLEMENTED
  → VERIFIED
  → RECORDED
  → DONE
```

### L1：SCOPED

把用户请求翻译成一个具体行为。例如：

> 顾问上传销售 CSV 后，可以确认“净销售额”口径，并生成一张有数据来源和模板版本的月度区域图表。

不要把“做一个完整报告平台”当作单轮目标。

### L2：MODELED

列出本轮使用或改变的对象和不变量。至少回答：

- 数据来自哪个 Data Snapshot；
- 哪个 Project 拥有该对象；
- 生成或修改是否产生新 Chart Revision；
- 是否使用了已确认的 Metric Definition 或 Project Memory；
- 使用了哪个 Visual Template 版本；
- 失败时会留下什么可解释状态。

### L3：IMPLEMENTED

只修改实现 Outcome 所需的代码和文档。保持：

- Workspace/Project 作用域完整；
- Data Snapshot 和已批准 Revision 不被覆盖；
- TransformPlan 由受限执行器执行；
- 用户可见的成功状态与真实校验结果一致；
- 记忆、模板、审核和导出都有显式状态。

### L4：VERIFIED

按风险选择证明方式：

- 领域规则：单元测试和状态转移测试；
- API：成功、失败、幂等、越权和空数据测试；
- 生成：固定输入的回归样例、TransformPlan 和字段血缘检查；
- 渲染：规范校验、输出存在性和版本检查；
- UI：桌面/移动端、加载/空/错误状态和 `@langreport/web` typecheck；
- 文档：术语、链接、范围和验收标准交叉检查。

验证失败时回到 MODELED，先修正假设或实现；不通过删掉测试、隐藏错误或把失败标成成功来结束 Loop。

### L5：RECORDED

完成前更新必要的文档：

- 新领域词汇写入 `CONTEXT.md`；
- 第一阶段范围或验收变化写入 `docs/phase1-consulting-report.md`；
- 状态机、不变量或领域关系变化写入 `docs/domain-model.md`；
- 技术边界变化写入 `docs/architecture.md`；
- 难以逆转的真实取舍写入 ADR。

开发 Loop 的完成条件：Outcome 已实现，Proof 已通过，受影响的不变量已检查，文档不再描述旧行为，且 `git diff` 只包含本轮相关变化。

## 4. 产品 Generation Loop

Agent 设计或实现用户生成能力时，遵循下面的有限循环。它与开发 Loop 分开：前者是产品运行时，后者是仓库修改流程。

```text
Brief ready
  → Profile
  → Clarify when needed
  → Plan
  → Transform
  → Compile
  → Validate
  → Repair 0..2 times
  → Render
  → Draft Evidence Block
  → User edit / Review
```

### 输入合同

一次 Generation Cycle 必须知道：

- Workspace 和 Project；
- Conversation；
- 一个 Data Snapshot；
- 一个 Analysis Brief；
- 已确认的 Metric Definition 或明确的待确认口径；
- 一个 Visual Template 及版本；
- 用户原始请求。

缺少这些信息时，Cycle 进入澄清状态或返回可操作的失败原因。

### 生成限制

1. 一次 Cycle 只使用一个 Data Snapshot 和一个 Visual Template 版本。
2. 一次 Cycle 只创建一个主 Chart Artifact、一个 Chart Revision 和一个 Evidence Block。
3. 首阶段主图表只支持 Line、Bar、Area。
4. TransformPlan 只能使用产品规格列出的受限操作，并记录输入、输出、空值处理和字段血缘。
5. 自动修复最多两轮；每轮记录错误、修复意图和新的校验结果。
6. 口径不清、字段不存在、时间粒度不确定或数据质量阻塞时，系统请求用户澄清。
7. Cycle 成功只代表生成的 Draft 通过必要校验；它不代表结论已经审核或可以发布。
8. 每次图表编辑、回滚或复制都创建新的 Revision。
9. 长期记忆和 Project Visual Template 只在用户显式确认后更新。
10. 生成结果必须显示数据来源、口径、更新时间和数据质量警告。

### 生成状态

```text
Queued
  → Profiling
  → Planning
  → Transforming
  → Compiling
  → Validating
  → Rendering
  → Drafted

Planning / Validating
  → Needs Clarification

任意运行状态
  → Failed
```

`Needs Clarification` 由用户补充信息后创建新的 Generation Cycle；它不通过静默修改原始请求继续运行。`Failed` 必须带错误类别、用户可理解的原因和建议动作。

## 5. 不变量和安全护栏

### 数据不变量

- Data Snapshot 是生成输入的事实版本；任何重新上传都产生新 Snapshot；
- 一个第一阶段 Cycle 不跨文件 Join；
- 缺失值、重复值、异常值和截断结果被记录并展示；
- 模型不能直接写入或改写 Data Snapshot。

### 图表不变量

- Chart Revision 内容 append-only；
- Approved Revision 只读；
- Revision 必须绑定 Snapshot、TransformPlan、Flint Spec、模板快照和校验结果；
- 导出和分享绑定固定 Revision，不绑定可变的 Artifact head。

### 记忆不变量

- Conversation Memory 不等于长期事实；
- Memory Candidate 未确认前不参与长期检索；
- Project Memory 不自动升级为 Workspace Memory；
- 冲突记忆展示来源并等待选择。

### 模板不变量

- Project 使用固定版本的 Visual Template；
- 历史 Revision 保存解析后的模板快照；
- 自定义模板只能修改允许的视觉和表达令牌；
- 模板不能注入任意服务器代码或未知渲染器。

### 模型和执行不变量

- 模型通过 Model Gateway 获得最小必要数据；
- 结构化计划由受限执行器运行；
- 运行时限制、重试次数和实际数据访问范围被记录；
- 任何外部工具或插件都服从 Workspace/Project 权限。

## 6. 停止条件

Agent 在以下任一条件成立时停止当前 Loop，并报告具体原因：

- 需要用户决定两个会改变产品边界的方案；
- 需要新的外部权限、凭据或数据授权；
- 发现已有用户修改与本轮实现无法安全共存；
- 违反 Workspace、Snapshot、Revision、Memory 或 Template 不变量；
- 自动修复预算耗尽；
- 代码、契约和迁移无法保持一致；
- 验证失败且当前上下文不足以判断正确修复。

停止时提供：已完成内容、阻塞事实、已验证证据、未完成项和建议的下一步。不把“暂时没运行测试”描述成“已完成”。

## 7. 交付记录模板

每轮结束时，Agent 的最终记录至少包含：

```text
Outcome: …
Changed: …
Invariants checked: …
Proof: …
Known limitations: …
Next loop: …
```

`Next loop` 只描述下一条已被当前范围解锁的工作，不自动承诺后续阶段。
