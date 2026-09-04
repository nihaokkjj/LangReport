---
status: accepted
---

# Serialize rendering per Generation Job

Render Worker 在处理同一个 `Generation Job` 时使用 PostgreSQL session advisory lock，以 `generation-render:<jobId>` 作为锁键。只有取得锁的 Worker 可以读取并推进 `rendering` 状态；并发到达但未取得锁的调用直接返回，由下一次轮询继续处理。

选择数据库 advisory lock 而不是进程内锁，是因为生产环境可以运行多个 Render Worker 实例，而 PostgreSQL 已经是 Job 状态的事实来源。锁只覆盖单个 Job，不阻塞不同 Job 的并行渲染；锁释放后，已有 Revision 恢复逻辑仍负责处理进程崩溃或重试导致的重复到达。

## Consequences

同一 Job 的并发渲染不会重复创建 Chart Revision 或互相覆盖最终状态。锁依赖数据库连接生命周期，数据库不可用时 Worker 仍应按现有错误分类失败；锁本身不是队列持久化机制，Job 仍必须通过状态和轮询重新获得处理机会。
