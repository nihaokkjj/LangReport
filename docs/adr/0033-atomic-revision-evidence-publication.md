# ADR-0033：固定 Evidence 内容与原子提交修订结果

- change-id：`CHG-2026-10-03-evidence-correctness-repair`
- 状态：`Proposed`（未批准、未实施）
- 创建时间：2026-10-03
- 更新时间：2026-10-03

## 问题

派生版本、Evidence、head、审核和 Job 由不同入口分段写入，导致来源遗漏、并发版本号冲突、半成品可批准和历史审核混合内容。只给 Job 状态更新加 fencing 不能保护无租约条件的业务写入。

## 提议

每个成功 Revision 对应一个内容固定的 Evidence。审核按目标 Revision 转换状态，不改其他 Evidence 的版本指针。Revision 是审核状态权威；可保留兼容冗余状态，但必须按同一 revisionId 在同事务维护。

生成、编辑、复制、回滚统一创建持久化 Job；先在短事务内预留目标身份和单调编号，事务外生成并验证候选对象，最后受 owner/token/fencingToken/数据库租约期限保护，在同事务提交 Revision、Evidence、head、审计/回复记录与 Job 成功。对象路径隔离执行尝试，不覆盖旧输出；COMMIT 未知时先核对事实。

允许失败留下编号空洞；不重用编号。head 不被晚完成的低编号结果或旧版本审核回退，publishedRevisionId 仅随审核更新。copy/rollback 从同步成功改为异步合同，必须 Web、OpenAPI、API Console 同步并安排兼容发布。

## 替代方案与取舍

只把 max+1 放进锁内可缓解编号冲突，但不能解决 Evidence/Job 部分提交。持续覆盖每个 Artifact 唯一 Evidence 较省数据，但无法可靠保留历史发现。数据库事务内调用 S3 会长时间持锁，也无法获得跨系统原子性。

提议方案增加历史 Evidence 行数、候选对账与迁移成本，换取清晰的版本归属、幂等和失败恢复。外部渲染仍是至少一次执行，不能宣传 exactly-once。

## 历史与回滚

历史来源缺失或混合内容不能猜测重建；保留原记录并投影为未验证，不自动改 Approved 内容/旧导出。新记录约束与历史分类采用 additive 迁移，旧 Worker 必须排空后再升级。不能通过启动旧写路径“回滚”并破坏新的一对一关系，必要时只读并前向修复。

详细锁顺序、合同、迁移和故障测试见 [设计 D2–D8](../changes/2026-10-03-evidence-correctness-repair/design.md) 与 [测试计划](../changes/2026-10-03-evidence-correctness-repair/test-plan.md)。本 ADR 未加入已批准决策索引。
