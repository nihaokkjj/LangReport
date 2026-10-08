# T6 最终候选独立只读复核

- 日期：2026-10-08
- 角色：独立 Verification agent，只读当前 LangReport 工作树
- 基线：产品 HEAD `9914f07` 加本轮未提交 T6 差异；原有 `apps/web/next-env.d.ts` 差异不属于本轮
- 方法：源码、测试断言与 API Console 合同静态核对；未独立运行共享 PostgreSQL/MinIO 集成

## 结论

未发现本轮确定性 P1/P2。编辑、回滚、复制的同键并发入队使用事务内的 Conversation 与 Job 唯一约束，冲突回滚不会留下孤立 Conversation；来源 Project/Artifact、权限与冻结输入得到核验。Render Worker 在同一事务内核验候选清单、租约和 fencing，并发布 Revision、Evidence、head、审计、回复及 Job 成功。

六 Job 测试包含三个编辑、三个回滚；候选就绪屏障后反序发布，检查编号、head、逐 Job 业务行与四输出。对象存储测试在实际 `putObject` 成功后抛出回执丢失错误，检查账本、重试和对账。

首次复核建议复制/回滚 PUT 失败时显式断言无审计和助手回复。Owner 已补失败态无审计/仅用户消息，以及成功和重处理后各恰一份的断言；独立角色再次只读确认这些断言位于 `rollback`、`copy` 共用循环内。最终集成运行结果由 Owner 记录，不归为独立重跑。
