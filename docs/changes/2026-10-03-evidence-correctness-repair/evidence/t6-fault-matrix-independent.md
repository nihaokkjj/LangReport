# T6 TP13 故障矩阵独立只读复核

- 日期：2026-10-07
- 基线：产品 HEAD `6e0a605` 加本轮 `apps/generation-worker/test/integration/worker.integration.test.ts` 未提交差异。
- 范围：只读核对四个 MinIO PUT 注入点、两个 PostgreSQL 约束、失败回滚与同 Job 重放断言；未修改代码，未独立重跑集成。
- 结论：未发现新增确定性 P1/P2。四次 PUT 均在实际调用前抛错，阶段调用次数和已写对象字节由真实 MinIO 验证；head 更新与审计插入的 `CHECK ... NOT VALID` 分别命中目标语句，错误来源由 SQL、PostgreSQL `23514` 和约束名核对。失败后目标 Revision/Evidence/审计、head 与回复保持不变；真实 API retry 后唯一发布，再次处理同 Job 无重复业务行。
- 边界：未模拟对象存储已收字节但回执丢失，亦未模拟 Worker 进程硬崩溃。执行结果以 owner 的完整隔离集成为准。
