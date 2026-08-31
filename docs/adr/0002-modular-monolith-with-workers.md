---
status: accepted
---

# Use a modular monolith with asynchronous workers

MVP 采用模块化单体 API 加独立 Generation Worker 和 Render Worker。图表生成涉及模型调用、数据处理和渲染，不能绑定在 HTTP 请求生命周期内；但在产品早期拆成大量微服务会增加部署、调试和跨模块一致性成本，因此模块先在一个 API 进程内通过明确边界协作，耗时工作通过持久化 Job 异步执行。

## Consequences

模块必须拥有清晰的领域接口和数据访问边界。任务状态以 PostgreSQL 为准，初期使用 PostgreSQL-backed Queue；只有当吞吐量或隔离需求明确时才拆分更多服务或更换队列基础设施。
