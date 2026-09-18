# 生成前提决策门：Proposal

- 变更编号：`CHG-2026-09-17-generation-readiness-gate`
- 状态：`APPROVED`
- 创建时间：2026-09-17
- 更新时间：2026-09-17

## 背景

第一阶段的 Generation Cycle 已经支持模型在规划阶段返回 `needs_clarification`，但 TransformPlan 与 Flint Spec 之间的可恢复前提问题仍会直接进入 `GENERATION_COMPILATION_FAILED`。用户只能看到失败，不能判断系统建议的字段是否符合本次分析意图。

用户已确认本变更的产品边界：建立通用的 Generation Readiness Gate，覆盖 Profile、Plan、Transform、Compile、Validate 的决策语义，但业务范围仍限制在第一阶段的 Line、Bar、Area 图表和 Evidence Block；本次点击只作用于当前生成尝试，不写入长期记忆、Metric Definition 或 Visual Template。

## 要解决的问题

当图表缺少横轴、指标或其他用户可决定的前提时，系统需要：

1. 用确定性数据证据生成 Clarification Proposal；
2. 向用户展示建议、候选项和原因，而不是把“最可能”说成“正确”；
3. 记录用户接受、选择、补充或停止的 Generation Decision；
4. 接受或调整后创建新的 Generation Cycle，保留原 Cycle；
5. 用户停止时使用独立的终态，不伪装成系统失败。

## 目标用户与使用场景

咨询顾问输入“按月份展示各区域销售额趋势”，但模型计划没有把“月份”或“区域”保留到 Transform 输出。系统应显示：当前横轴缺失、哪些字段可用、哪些候选需要调整变换计划，以及每个候选的类型、基数和缺失值证据。用户可以采用建议、选择其他字段、补充方向或停止。

## 需求范围

### MVP

- 新增可复用的 Generation Readiness Gate 接口和确定性候选排序；
- 将已知的 `缺少图表横轴字段` 转换为 `needs_clarification`；
- 扩展 ClarificationQuestion，保存阶段、严重性、推荐项和候选证据；
- 用户接受/选择/补充后，创建带父 Generation Job 和 Generation Decision 的新 Job；
- 对等待澄清的 Job 提供用户停止接口，状态为 `cancelled`；
- Web 展示建议、证据、候选、补充入口和停止入口；
- 通过离线单元测试、合同测试、API 类型检查和 Web 类型检查验证。

### 后续范围

- 对 Profile、Plan、Transform、Validate 的更多具体规则接入同一 Gate；
- 对质量警告增加“继续并接受风险”的独立审计动作；
- 运行中 Worker 的取消信号、AbortController 与租约协作；
- 非图表任务和通用 BI 工作流。

## 明确不做

- 不自动修改 Analysis Brief、Metric Definition、Project Memory 或 Visual Template；
- 不让模型凭空创建字段、口径或 Transform 操作；
- 不把所有编译失败都改成澄清；不可恢复的系统、数据和权限错误仍为 `failed`；
- 不覆盖旧 Generation Job、旧审计或已批准 Revision；
- 不把本次变更扩展成 Dashboard、跨文件 Join 或通用 Agent Loop。

## 成功指标

- 已知的横轴缺失场景返回结构化澄清，而非 `GENERATION_COMPILATION_FAILED`；
- 候选项全部来自 Data Snapshot 或已执行 Transform 输出，并展示可验证证据；
- 用户决策和父 Job 可在新 Job 中追溯；
- 用户停止的 Job 不出现在失败重试路径；
- 非目标编译错误仍保持原有失败语义。

## 假设、依赖与风险

- 用户“按照计划执行”视为对上一轮方案和推荐状态语义的实施确认；
- 本轮只允许在 `needs_clarification` 状态取消，避免引入未设计的运行中取消协议；
- 数据库迁移必须保持已有 Generation Job、租约和 Revision 的兼容；
- 当前 Web 页面为单文件工作台，需要局部交互改动并遵守既有 DESIGN.md 令牌。

## 未决问题

- 后续 Gate 规则的质量阈值需在对应垂直场景中单独确认；
- “继续并接受风险”不属于本轮 MVP。

## 验收标准概要

1. 固定输入触发横轴缺失时，Generation Cycle 返回澄清问题、推荐项、候选和字段证据。
2. Worker 将澄清结果持久化为 `needs_clarification`，不创建 Chart Revision。
3. 用户选择候选后，前端提交 Generation Decision，API 创建新的 Generation Job，并保存父 Job 关系。
4. 用户停止后，Job 状态为 `cancelled`，不会显示“生成失败”或提供重试。
5. 旧 Job 的问题、审计和状态保持不变。
