---
status: accepted
---

# Minimize data sent to models behind a Model Gateway

默认只向模型发送字段摘要、统计信息、必要的脱敏样本、相关记忆和用户意图；完整原始数据只在受控 Worker 中按需读取。所有模型调用经过统一 Model Gateway，而不是让领域模块直接依赖具体供应商。这个选择降低敏感数据暴露和供应商锁定风险，并为未来的 BYOK、模型路由和 Workspace 策略保留边界。

## Consequences

Model Gateway 需要记录模型、请求策略、脱敏策略、Token/成本和失败信息。某些复杂任务可能需要额外的数据授权或受控计算步骤；系统不能承诺模型永远只看到摘要，必须在 Generation Job 中记录实际数据访问范围。
