---
status: accepted
---

# Use a versioned Model Gateway with cycle-bound context projection

LangReport 首期只通过项目自有 Model Gateway 生成 `chart-plan`。Gateway 可以在内部使用 LangChain.js v1 的模型组件，也可以在供应商能力不足时使用受控的原生 HTTP/SDK 适配器；业务层不依赖 LangChain 或供应商类型。LangGraph 延后到确实需要节点恢复、条件分支、人工暂停或跨进程续跑时再引入。

## 决策

- 每个 Generation Cycle 固化 Data Snapshot、Analysis Brief、Metric Definition、Visual Template、Model Profile、提示词、Schema、数据策略和执行器版本。
- 首期上下文策略固定为 `canonical_text_context`。Gateway 只发送确认后的业务上下文、必要统计和脱敏文本；不直接回放 reasoning、tool call、thought signature、供应商私有字段或未经授权的图片。
- 模型切换由用户显式触发。模型降级、工具调用失败或协议不兼容时，当前 Cycle 结束并展示原因和可选模型；用户选择后在同一 Conversation 下创建新的 Generation Cycle。澄清信息同样通过新 Cycle 生效。
- 不自动故障切换供应商。当前 Cycle 内只允许受预算约束的同 Profile 重试和有限修复；未知模型名称、必需能力不支持、鉴权或数据策略错误不得回退到默认模型。
- 模型计划校验和渲染产物校验分别持久化，分别记录状态、错误、校验器版本和时间。
- `requestedProfile`、`effectiveProfile`、`requestedOptions`、`effectiveOptions`、HistoryAdapter 版本及上下文投影哈希都写入 Job/调用审计。前端 `localStorage` 只保存偏好，服务端是 Profile 和权限的权威来源。
- 真实模型调用前实现最小 Worker 租约、心跳、fencing token 和幂等写入；完整的并发扩展和 LangGraph Checkpointer 可后续增强。

## 后果

模型适配、数据发送和错误映射集中在 Gateway，增加供应商时不需要改动 TransformPlan 执行器或渲染层。固定 Cycle 快照能够解释同一任务实际使用的模型、上下文和参数；用户切换模型或补充信息会产生可审计的新输入和新幂等键。

代价是首期不能把任意 Conversation 历史直接交给任意模型，也不能用换模型掩盖配置或工具错误。若未来要支持通用多轮 Agent，必须增加带版本和哈希的 HistoryAdapter，并单独设计跨协议分支或摘要交接；LangGraph checkpoint 也不能替代业务表、调用记录和 Worker 租约。
