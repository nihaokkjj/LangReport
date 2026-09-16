# 咨询项目证据工作台 UI 与交互改造：提案

- 变更编号：`CHG-2026-09-16-CONSULTING-WORKBENCH-UI`
- 状态：`IMPLEMENTING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 背景

现有 Web 工作台已经覆盖 Data Snapshot、Metric Definition、Analysis Brief、Conversation、Generation Cycle 和 Evidence Block，但交互入口分散，生成条件不透明，审核动作和移动端操作路径不完整。改造必须继续服务第一阶段“咨询项目报告”的证据闭环，不把产品扩展成通用 BI。

## 要解决的问题

1. 重复的 Project/Conversation 入口造成当前上下文不明确。
2. Composer 被生成前置条件锁死，用户无法先讨论问题。
3. 澄清选项只是文本，失败状态的关闭动作不能可靠返回分析状态。
4. 图表缺少可操作的数据点反馈，审核依据和评论入口不够集中。
5. 移动端没有适合审核的明确操作路径。
6. UI 改版后，旧 E2E 定位器和 Next 开发输出目录会阻断验证。

## 目标用户与使用场景

- 咨询顾问：导入客户表格，确认指标与 Brief，生成 Evidence Block。
- 研究分析师：先在 Conversation 中澄清问题，再满足准备度后生成。
- Reviewer：在固定 Chart Revision 上查看依据、评论、要求修改或批准。

## 需求范围

### MVP

- 将工作台收敛为单一对话入口和清晰的四项准备度提示。
- 支持未满足生成条件时提交普通问题，满足条件后自动进入 Generation Cycle。
- 使澄清选项、失败返回、图表数据点反馈和审核操作可用。
- 在桌面端使用右侧审核 Inspector，在移动端使用底部审核操作面板。
- 保留现有领域状态和 Chart Revision 追溯关系；T7-T9 只按任务清单补齐 Project/Theme/导出所需的最小 API 与持久化合同。
- 建立独立 E2E Next 输出目录，并补充普通会话发送回归测试。

### 后续范围

- 完整 Project onboarding 已在本次继续执行中由 T7 处理：客户代号、目标、受众和 Visual Template。
- 补齐图表编辑器的聚合、筛选、排序、注释和 Theme token 编辑。
- HTML 导出、完整视觉验收和更细的权限/角色测试。

## 明确不做

- 不引入 Dashboard、实时协作、跨文件 Join、公开分享或完整 PPT 排版。
- 不改变 Generation Worker、Render Worker 或领域状态机的既有边界；T7 允许增加向后兼容的 Project metadata migration，T8 沿用现有 Worker/Revision 管线完成最小编辑能力，T9 不扩展为通用 BI 或主题市场。
- 不把前端按钮状态当作权限安全边界；权限仍由 API 校验。

## 成功指标

- 桌面和移动端核心咨询报告链路 E2E 全部通过。
- 准备度不足时提交问题不产生浏览器 TypeError，消息可见且状态可解释。
- In Review 状态下 Reviewer 可以从当前视口完成评论、要求修改或批准。
- Approved Revision 仍保持只读，现有 API 和追溯字段不变。

## 假设、依赖与风险

- 假设现有 API 的普通消息响应为 `{ messages: [...] }`，生成响应为 `{ message, job, nextAction }`。
- E2E 使用 Playwright route fixture，不依赖真实模型或 API 服务。
- 移动端审核面板覆盖画布操作区，因此移动端测试必须验证面板操作路径。
- 现有 `apps/web/page.tsx` 为高密度单文件页面，后续需要在不改变行为的前提下拆分组件以降低维护风险。

## 未决问题

- Project 创建表单已进入 T7；客户信息和 Visual Template 使用独立的 Project create contract 持久化。
- 图表编辑器下一轮是否拆为独立模块，以及 Theme token 的 API 读写合同。
- HTML 导出的完成时间和固定 Revision 下载合同。

## 验收标准概要

本轮 P0/P1 改造以 [acceptance.md](./acceptance.md) 的已执行 E2E、类型检查和 diff 检查为证据；完整 MVP 仍需完成后续任务并重新人工验收。
