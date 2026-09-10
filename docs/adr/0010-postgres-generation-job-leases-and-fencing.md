---
status: accepted
---

# Use PostgreSQL Generation Job leases with fencing tokens

## Context

Generation Worker 与 Render Worker 可以在不同进程中轮询同一 PostgreSQL-backed Queue。进程暂停、网络抖动或部署替换后，单靠内存状态或 PostgreSQL advisory lock 无法阻止旧 Worker 在任务被新 Worker 接管后继续提交状态、失败或完成结果。未来真实模型调用也不能普遍提供 exactly-once 语义。

## Decision

- Generation Job 持久化 `leaseOwner`、随机 `leaseToken`、单调递增的 `leaseFencingToken`、到期时间和最后 heartbeat 时间。
- 领取、heartbeat、状态推进、失败与完成都使用 PostgreSQL 条件更新，要求 owner、token、fencing token 匹配且 Lease 尚未过期。
- Worker 每三分之一 Lease 时间 heartbeat，最低 Lease 为三秒。领取 Generation 阶段时进入 `profiling` 并增加尝试次数；交接到 `rendering`、失败、成功或澄清时释放 Lease。
- 超期的生成阶段恢复为 `queued`；超期的渲染阶段恢复为 `rendering`，从而保留已经通过的计划和避免未来重复模型调用。
- `generation_job_id` 上既有的 Chart Revision 与 Evidence Block 唯一关系继续作为至少一次处理的业务幂等边界。Render advisory lock 保留为减少重复渲染的优化，不承担正确性职责。

## Alternatives considered

- 只用 PostgreSQL advisory lock：不能把旧持锁者的延迟写入与新接管者区分，且锁断开后的陈旧副作用无法 fencing。
- 引入 Redis/外部队列：可改善吞吐，但不能替代 Job 记录的条件提交和审计；第一阶段没有吞吐需求证明该新增基础设施。
- 依赖外部模型的幂等键：不能覆盖本地渲染、Revision/Evidence Block 写入或不支持该能力的供应商。

## Consequences

Worker 需要在每个可见状态提交前检查 Lease，并在丢失 Lease 时停止；运维可以通过到期时间解释重试和接管。对象存储写入和外部模型请求仍可能发生至少一次，因此实现必须允许孤儿对象或未知调用结果，并以受 fencing 保护的业务记录和唯一约束确保不重复创建 Draft Revision/Evidence Block。未来替换队列实现时必须保持这些数据库语义。
