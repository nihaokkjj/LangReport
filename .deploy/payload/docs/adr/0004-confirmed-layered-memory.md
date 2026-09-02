---
status: accepted
---

# Use confirmed layered memory

LangReport 将记忆分为 Conversation Memory、Project Memory 和 Workspace Memory。模型可以从对话中提出 Memory Candidate，但只有用户确认后才能写入长期记忆；长期记忆必须记录来源、创建人、更新时间、置信度和可删除状态。这样可以让项目获得持续上下文，同时避免模型把猜测静默升级为团队事实。

## Consequences

记忆检索必须区分作用域和优先级，并能展示冲突来源。系统需要增加候选审核和记忆审计流程；原始聊天记录不能直接等同于长期事实。
