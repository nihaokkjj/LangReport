# T6 六个并发编辑 Job 限定只读复核

- 日期：2026-10-08
- 产品基线：`9263c8c`；复核当前未提交的 Worker 集成测试差异及必要生产路径。
- 角色：独立 Verification agent；未修改文件，未独立重跑完整集成。

复核确认：六个独立编辑请求经真实 API 入队，Generation Worker 与 Render Worker 均以 `Promise.all` 并发处理。六个候选在发布回调屏障相会，五个较高编号争抢提交，最低编号最后完成；最终 head 等于最高编号能发现低编号迟到导致的 head 回退。测试逐 Job 校验成功状态、Revision/Evidence/审计及独立 Conversation 的一条新回复，四对象可读；重处理后逐 Job 复查 Evidence/审计/回复仍唯一，全部 Revision 总数不变。固定生产 schema 的 `chart_revisions_generation_job_unique` 约束提供同 Job Revision 唯一性。未发现新增确定性 P1/P2。

证据边界：60 秒只约束已到发布屏障的 Worker；底层渲染或对象存储操作若在到达屏障前停滞，此测试不能取消该操作。TP12 原定义含回滚，本轮仅覆盖编辑 Job，不能据此关闭 TP12 或 T6。完整集成结果以 owner 的[测试记录](../test-report.md)为准。
