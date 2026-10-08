# T7 独立静态复核

日期：2026-10-08。基线：6204e60。冻结快照：`C:\Users\sai_8\.codex\visualizations\2026\10\08\01a119ef-072e-7071-a33c-83d3bb4e4931\t7-review`；身份以该目录 manifest.json 为准。

结论：未发现本轮 T7 范围内可确定的阻断缺陷。此结论是独立代码和断言复核，不标记为独立集成执行通过。

## 已复核

- 根 AGENTS.md、CONTEXT.md、变更 proposal/design/task/test-plan，重点 D4、TP10、TP11、TP15。
- packages/chart/src/index.ts、apps/api/src/routes.ts、apps/api/src/chart-routes.ts、packages/contracts/src/http.ts、apps/generation-worker/test/integration/t7-review.ts 的 SHA-256 均与 manifest.json 一致。
- 两个审核入口共用审核门；事务按 Job → Artifact → Revision 锁定，与完成发布 Job → Artifact 顺序兼容；等待后重新核验状态，审批不更新 head。
- 门检查 Snapshot Project、Job 成功及候选身份、两层校验、唯一 Evidence 与 Brief/Metric/统计绑定、四格式清单与完成输出引用；对象读回验证长度和 SHA-256。明确缺键/错哈希 409、基础设施不可核验 503；失败在状态/Review/审计写入之前抛出并回滚。
- Evidence 内容无审核改写；冗余状态按 revisionId 更新，DTO 以 Revision 状态为权威。默认列表选择 head/published，历史查询先按 Project/角色授权，不借用其他版本 Evidence。
- TP10 测试对 submit/approve 各注入九类故障，断言 HTTP 状态和代码，并在还原故障后对比完整业务记录快照，能够发现额外状态、指针、Review 或审计写入。
- TP11 对旧 R1 审核时断言 R2 Revision/所有其他 Evidence 内容不变、head 不回退、published 变化独立审计；并发批准要求恰一成功且恰一冲突。
- TP15 有 Editor/Reviewer/Viewer/非成员、跨 Project、草稿输出与复制、非法迁移、expectedStatus、未认证入口的实际状态断言。测试函数显式由 worker.integration.test.ts 导入并调用，非未接入文件。

## 验证边界

- 按 owner 要求未重复运行昂贵数据库/S3/浏览器集成，未独立执行类型检查或离线套件。最终集成退出码和运行结果由 owner 提供并另行保留。
- 快照 task.md 仍显示 T7 未开始；这是冻结发生在最终任务记录更新之前，不据此判定代码未实现。
- 审核门相信成功发布时已冻结的规范/执行记录和输出清单，未重新渲染图表或重新计算 finding；任意数据库管理员同时篡改内容及可信清单的行为不在本次运行边界内。检查后的外部删对象同样不由数据库事务保证。
- 本复核没有评价 T8 异步 Web、T9 历史分类迁移、生产部署、完整 TP25 或用户接受。
