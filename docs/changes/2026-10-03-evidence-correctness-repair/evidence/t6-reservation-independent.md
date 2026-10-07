# T6 版本身份预留限定独立复核

- 固定快照：`C:\Users\sai_8\.codex\visualizations\2026\10\04\01a10606-4bd3-7033-bf98-f84d2e7059da\t6-reservation-review-final2`，基线为提交前 LangReport HEAD `15e31c8`。
- 角色：短期只读验证代理；仅核对冻结补丁、迁移和基线源码，没有修改产品代码，也没有独立执行集成测试。
- 结论：身份预留限定切片未发现新的 P1/P2 缺陷。0032 迁移对历史最大编号加一；编辑 Job→Artifact 锁顺序、同 Job 候选复用、直接派生计数器、head 单调逻辑一致。最终补丁对首次分配和已有候选复用都在等锁后使用 `clock_timestamp()` 复查租约；分配末尾失效会回滚 Artifact 计数器。新增测试覆盖两条超期路径、故障前后候选身份直接比较和低编号晚落库。
- 范围限制：Revision、Evidence、Job 业务完成仍分事务，`assertGenerationJobLease` 与 Revision 插入之间可被接管，旧 Worker 可能写入 Revision/head。这是 T6 原子发布与业务写入 fencing 的待办，不属于本轮已验收结果。历史非空旧库的迁移回填尚无独立夹具。
- 主代理验证：最终 `node scripts/test-integration.mjs` 真实隔离 PostgreSQL/MinIO 退出 0；API 14/14、浏览器桌面/移动 2/2、Worker 2/2。此项不归为独立代理亲自执行。
