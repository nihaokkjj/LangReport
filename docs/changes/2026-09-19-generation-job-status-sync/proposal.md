# Generation Job 状态同步优化：Proposal

- 变更编号：`CHG-2026-09-19-GENERATION-JOB-STATUS-SYNC`
- 状态：`VERIFYING`
- 创建时间：2026-09-19
- 更新时间：2026-09-19

## 背景

LangReport 在用户提交一次生成型 Conversation 消息后，通过 Generation Job 表达异步 Generation Cycle。当前 Web 工作台每 900ms 请求一次完整 Job 读取接口，API Console 的 Loop 4 也维护独立轮询逻辑。

当前 Web 实现使用 `setInterval` 启动异步请求，但不等待上一次请求完成。当接口耗时超过 900ms 时，同一标签页、同一 Job 可以同时存在多个状态请求。切换 Project、Conversation 或 Job 时，现有清理只阻止旧响应写入 React 状态，不会通过 `AbortController` 终止已经发出的网络请求。

完整 Job 接口还会返回 TransformPlan、Flint Spec、预览数据、校验记录和输出等内容。把它作为高频状态探测接口会重复传输当前阶段不需要的大量数据。

## 要解决的问题

1. 同一标签页、同一 Generation Job 可能产生重叠的在途状态请求。
2. 切换 Project、Conversation 或 Job 后，旧网络请求继续占用浏览器和服务端资源。
3. 高频轮询重复返回完整 Generation Job 结果，响应体过大。
4. 固定 900ms 间隔无法根据任务阶段、网络失败和页面生命周期调整。
5. Web 工作台与 API Console 各自维护轮询实现，错误处理和停止条件容易漂移。
6. 现有 `updatedAt` 会被 Worker Lease heartbeat 更新，不能作为用户可见状态版本。

## 目标用户与使用场景

目标用户是提交咨询分析问题并等待 Evidence Block 的顾问或分析师。

核心场景：用户在一个 Project 的 Conversation 中提交生成请求，页面持续显示 Generation Job 的真实阶段；切换到其他 Project 或 Conversation 时，旧请求立即停止；任务进入终态后，页面读取一次完整结果并展示对应 Evidence Block。

## 需求范围

### MVP

1. 新增只返回用户可见状态摘要的 Generation Job status 接口。
2. status 接口支持最长 25 秒的有界 HTTP 长轮询。
3. Generation Job 增加独立的 `statusVersion` 和 `statusChangedAt`，Lease heartbeat 不改变这两个字段。
4. PostgreSQL 在 Job 创建或 `statusVersion` 变化时发送不含业务正文的通知。
5. 每个 API 进程使用一个共享 PostgreSQL 监听连接，将通知分发给等待相应 Job 的请求。
6. Web 提取统一的 Generation Job 状态监听 Module；同一标签页、同一 Job 只有一个底层请求。
7. 切换 Project、Conversation、Job 或卸载页面时，使用 `AbortController` 终止旧请求，并用 session token 防止迟到响应污染新状态。
8. API Console Loop 4 复用同一状态监听策略，仍保留 60 秒场景总时限。
9. 长轮询不可用或被关闭时，客户端回退到串行、自适应的普通轮询。
10. 保留现有完整 Generation Job 查询接口，终态只读取一次完整结果。

### 后续范围

1. 用通知驱动替代 Generation Worker 和 Render Worker 的每秒 PostgreSQL Queue 扫描。
2. 跨浏览器标签页通过 `BroadcastChannel` 和 Web Locks 共享一个 Job 监听请求。
3. 当状态事件密度和订阅规模证明有必要时，评估 SSE。

## 明确不做

- 不引入 WebSocket、通用实时协作或实时数据源。
- 不修改 Generation Cycle 状态机、澄清语义或终态定义。
- 不修改模型供应商调用、自动修复预算或 Job retry 规则。
- 不删除 Worker Lease heartbeat，不改变 Fencing Token 和租约恢复语义。
- 不修改 Data Snapshot、Chart Revision、Evidence Block 或 Review 的业务不变量。
- 不保证同一浏览器的多个标签页只建立一个请求；MVP 只保证单个标签页内 single-flight。
- 不在本变更中优化 Memory Extraction Job 调度。

## 成功指标

1. 单个标签页内，同一 Job 的最大在途状态请求数为 1。
2. 切换 Project、Conversation 或 Job 后，旧请求在清理阶段收到 abort，迟到响应不能更新当前页面。
3. 正常 60 秒 Generation Job 的状态 HTTP 请求不超过 15 次。
4. PostgreSQL 通知正常时，Job 用户可见状态变化到页面显示的 P95 延迟小于 1 秒。
5. 100 个并发等待请求不会各自占用一个 PostgreSQL 连接；每个 API 进程只维护一个通知监听连接。
6. 通知丢失或监听连接短暂中断不会导致永久等待；客户端在最长 25 秒后重新读取当前状态。
7. 终态后不再发送 status 请求，只执行一次完整 Job/Evidence/Conversation 刷新。

## 假设、依赖与风险

- PostgreSQL 仍是 Generation Job 状态的事实来源，并支持 `LISTEN/NOTIFY`。
- HTTP 入口允许最长 25 秒的请求；生产代理超时必须高于该值。
- 通知不是持久队列，正确性依赖每次 status 请求先读数据库以及等待超时后的重新读取。
- API 进程必须在监听连接断开后自动重连，并记录可观测错误。
- 所有用户可见 Job 更新路径都必须统一递增 `statusVersion`；遗漏会造成状态延迟。
- 当前工作树中的 API route registration、contracts 和 API Console 修改与本变更重叠；实现前必须先确认其最终落点，不能覆盖现有用户修改。

## 未决问题

- 当前没有阻塞方案审核的产品问题。
- 实现前需要确认部署代理的实际空闲请求超时；若低于 30 秒，则将服务端 `waitMs` 上限调整到安全值。
- Worker Queue 通知驱动另开变更，不与本轮合并。

## 验收标准概要

1. 慢响应场景下不会出现同一标签页、同一 Job 的重叠 status 请求。
2. 切换上下文会真实取消旧 fetch，而不只是忽略响应。
3. 长轮询的即时返回、状态变化唤醒、25 秒超时、断开清理和终态停止均有自动化测试。
4. 权限、Project 隔离、Viewer 可见性与现有完整接口保持一致。
5. heartbeat 不改变 `statusVersion`，所有用户可见状态更新会递增版本。
6. contracts、OpenAPI、API Console、Web、API、数据库迁移和相关文档在同一变更内同步。
