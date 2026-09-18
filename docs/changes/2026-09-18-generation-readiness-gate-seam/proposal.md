# Generation Readiness Gate seam 深化：Proposal

- 变更编号：`CHG-2026-09-18-generation-readiness-gate-seam`
- 状态：`APPROVED`
- 创建时间：2026-09-18
- 更新时间：2026-09-18

> 审核结论：用户已批准执行。按最新指示不保留上一轮 `questions`/`clarificationQuestions` 数据传递、双读、双写或历史回填；Proposal 作为唯一最新版语义。

## 背景

上一轮 `CHG-2026-09-17-generation-readiness-gate` 已将已知的横轴缺失从编译失败转换为 `needs_clarification`，并建立了候选、推荐项和用户决策的产品闭环。本轮不重新设计该闭环，而是深化 `packages/generation` 内部的 Gate seam。

当前 seam 仍有三处语义不够稳定：

1. Gate 从 `unknown` 错误中读取 `code` 和 message，并用文本包含关系识别横轴缺失；同类错误可能因为文案变化而改变状态。
2. 候选只在生成 `ClarificationQuestion` 时临时拼装，候选来源、资格和字段证据没有独立的结构化表示；排序规则也没有稳定的可审计输入输出。
3. Gate 直接返回 `ClarificationQuestion[]`，把“系统提出一个可供用户决定的建议”压扁成了“问题列表”，无法清楚区分 Diagnostic、Proposal、Recommendation 和用户最终的 Generation Decision；上一轮数据传递也不应继续成为最新版的约束。

本轮只处理这三个 seam 问题，保持上一轮已批准的状态、合同和跨模块边界不变。

## 要解决的问题

对一个固定的 Data Snapshot 和当前 TransformResult，Gate 必须能够：

- 接收稳定、可序列化的 Generation Diagnostic，而不是解析任意异常文本；
- 只从已验证的 Snapshot profiles 或 TransformResult 输出构造候选，并为每个候选给出来源、可用性和统计证据；
- 使用可重复的确定性顺序产生候选和推荐，不调用模型、不使用模型排序、不暴露不可复现的分数；
- 返回一个明确的 Clarification Proposal：它说明为什么暂停、需要用户决定什么、有哪些候选、哪一个只是推荐，以及推荐不等于自动选择；
- 在 `GenerationCycle` 中以 Proposal 和 Diagnostic 作为唯一最新版结果；直接消费者切换到 Proposal，不保留上一轮 `questions` 投影、双读或旧数据回填。

## 目标用户与使用场景

咨询顾问请求“按月份展示各区域销售额趋势”。模型计划或 TransformPlan 没有把“月份”保留到输出，编译阶段发现横轴缺失。Generation Readiness Gate 应输出：

- 结构化 Diagnostic：`MISSING_X_FIELD`、阶段 `compiling`、阻塞严重性和安全的可读原因；
- 候选“月份”“区域”等字段的来源（当前 Transform 输出或 Data Snapshot 需保留）、类型、基数和缺失值证据；
- 一个 Clarification Proposal，明确“请用户确认”，并把最有证据的候选标为推荐，但不代替用户做 Generation Decision。

## 需求范围

### MVP

- 在 `packages/generation` 内定义稳定的 Generation Diagnostic 输入和输出语义；已知横轴缺失通过结构化 code 识别，未知/不可恢复错误继续走 `blocked`/`failed`。
- 在 Gate 内定义结构化候选模型，保存候选值、来源、是否需要调整 TransformPlan、字段类型、缺失值数量、唯一值数量和有限证据摘要。
- 用固定的、可测试的排序键生成候选和推荐；推荐候选必须属于候选集合，只有一个候选时仍然需要用户确认。
- 在 Gate 内定义 `ClarificationProposal`，让 `needs_clarification` 表示“提出建议并等待 Generation Decision”，而不是“系统已经选择答案”。
- 让 `GenerationCycle` 将 Diagnostic/Proposal 纳入结果和审计，并让直接消费者改用 Proposal 数据形状；这是机械传递更新，不新增 API/Web 产品能力。
- 允许丢弃历史 `clarificationQuestions` payload；新运行只写入和读取最新版 Proposal，不提供旧数组格式的兼容分支。
- 增加 `packages/generation` 的单元和 Cycle 回归测试，证明确定性、来源约束、Proposal 不变量及未知错误隔离。

### 后续范围

- 将更多 Profile、Plan、Transform 或 Validate 业务规则接入 Gate；每个规则另立变更并提供独立验收。
- Quality warning 的“继续并接受风险”、运行中 Job 取消、模型排序或多轮 Proposal 编排。
- 将 Proposal 设计成新的 HTTP/数据库合同，或改变 `GenerationDecision`、Generation Job 状态机和 Web 信息架构。

## 明确不做

- 不新增产品能力，不修改长期记忆或 Project/Workspace 规范。为移除旧数据传递而进行的直接消费者、contracts 或持久化字段机械更新属于本变更的必要落地，不建立额外业务流程。
- 不新建 package，不建立通用规则引擎、可配置规则注册表或跨业务 Gate 框架。
- 不调用模型生成候选、不让模型排序、不根据自然语言猜测字段，不把推荐自动写成用户决策。
- 不引入新的字段语义、Metric Definition、Visual Template 或 Project Memory。
- 不改变上一轮的 `needs_clarification`、`failed`、`cancelled`、Generation Decision 或 Chart Revision 语义。

## 成功指标

- 相同结构化 Diagnostic、profiles、intent 和 TransformResult 在重复运行中产生字节级等价的 Proposal 和候选顺序。
- 编译错误 message 改变但结构化 code 不变时，Gate 结果不变；没有结构化 code 的未知错误不会被误转为澄清。
- 每个候选都能追溯到 Snapshot profile 或 TransformResult 列，推荐项总是候选集合成员。
- `needs_clarification` 结果只表达 Diagnostic 和 Proposal；没有用户 Decision 时不表示已选择字段。
- 活跃代码路径不再读取或生成上一轮 `questions`/`clarificationQuestions` 数组；历史 payload 可清理或丢弃，不做迁移回填。
- Gate 的主要实现仍只深化 `packages/generation`；直接消费者只做最新版数据形状的机械接线，contracts、API、Worker、Web、全量 typecheck/test 和数据库验证在实现后保持通过。

## 假设、依赖与风险

- 现有 Job/HTTP 传输可以在不保留旧读路径的前提下切换到 Proposal；若需要调整 JSONB 字段名或 contracts 类型，直接替换即可，不做旧字段双写/双读。
- `TransformResult.rows`、`TransformResult.columns`、`TransformResult.lineage` 和 `ColumnProfile` 是候选证据的唯一输入来源。
- 候选排序中的固定类型优先级、意图引用优先级和统计 tie-breaker 是实现细节；若未来要改变其业务含义，应另行审查，而不是隐式调整。
- `GenerationCycle` 当前仍由有限 LangGraph 编排；Proposal 只是 Graph State/结果中的应用语义，不引入 Checkpointer、interrupt 或新的运行时。

## 未决问题

- 人工审核需要确认：候选上限沿用现有合同上限 8，还是在 Gate 内更严格限制为 3；本提案默认沿用 8。

## 验收标准概要

1. Gate 不再从 `unknown` 错误 message 推断可恢复规则；已知结构化 Diagnostic 才能进入 Proposal，未知错误保持 blocked/failed。
2. 候选只来自 Data Snapshot profiles 或 TransformResult 输出，携带稳定 provenance/证据，并按固定排序键确定性生成。
3. Proposal 明确 Diagnostic、用户目标、候选、推荐和“需要用户决定”语义；推荐不自动变成 Generation Decision。
4. GenerationCycle 只返回结构化 Diagnostic/Proposal；直接消费者使用最新版数据形状，旧 `questions` 投影和历史 payload 不再兼容。
5. 变更实现前已经过人工审核；审核通过后，按 test-plan 完成专项和全量回归验证。
