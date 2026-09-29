---
status: accepted
---

# 每次模型调用准备上下文，固定来源并有界压缩

用户已确认本设计决策；当前仅规划，尚未授权实施。所有模型发送入口执行应用层上下文准备与撤销门；每次调用前检查 token、消息数和窗口比例，多个阈值为 OR，计入当前消息和已有 summary_text。另外检查包含 system、tools、schema、记忆、数据上下文与输出预留的完整请求硬预算。

在应用组合层注入 Memory Adapter，不让通用 Harness/Provider 导入数据库或用户权限逻辑。Cycle 创建时固定记忆版本选择、合格消息集合与摘要来源边界；澄清创建新 Cycle，同 Cycle 执行重试保持选择。压缩可以变换表示、吸收本 Cycle 的合格工具结果，不能读取更晚的全局摘要扩大来源。删除撤销优先于冻结，详情见 ADR 0025。

## Considered Options

- 各调用点独立判断：容易遗漏工具循环，因此采用统一调用前接缝。
- 覆盖单条最新摘要：并发和历史边界不可证明，因此采用带来源的不可变版本、分支内 CAS。
- 每次调用读实时会话：旧任务会混入新消息，因此坚持固定来源。
- 让 Gateway 直接访问用户记忆库：会污染通用执行边界，因此采用注入式应用 Adapter。

## Consequences

摘要使用独立 invocation kind、结构化合同和 budget；递归保护、次数/deadline 上限、无缩减与保留区超限退出都必须测试。失败保留原文并阻止目标下游调用。删除使摘要失效时只能安全重建或拒绝，不能回退已撤销版本。阈值数值在 B3 用固定样例确定。Task/Cycle 关系见 [ADR 0028](0028-task-cycle-memory-consistency.md)，任务依赖见 [实施规划](../changes/2026-09-24-memory-system/task.md)。
