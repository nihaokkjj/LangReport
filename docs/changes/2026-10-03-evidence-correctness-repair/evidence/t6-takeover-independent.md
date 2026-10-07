# T6 提交前失租限定独立复核

- 角色：独立只读验证代理；未修改产品代码，未独立重跑集成测试。
- 固定快照：`C:\Users\sai_8\.codex\visualizations\2026\10\04\01a10606-4bd3-7033-bf98-f84d2e7059da\t6-takeover-review\tree`；基线 `417ca42b54d3be1efc1dcd15c3585668a851c050`。同目录的 `manifest.sha256` 中 7 个改动文件与快照一致，另有 `change.patch`。
- 结论：本轮差异未见确定性 P1/P2；不接受 T6 整体。

复核确认：测试经真实 API 与 Generation Worker 准备编辑 Job；A 完成四候选后将数据库租约置过期并运行实际恢复，发布事务因租约失效拒绝且未产生 Revision、Evidence、审计。B 重新处理，取得更高 fencing token；同预留 Revision 身份的四个输出键属于新尝试，A 旧对象字节未变。B 成功后，A 迟到发布被拒绝，旧租约失败写入未命中；Job、head、Revision、Evidence、审计和回复均保持 B 的结果。生产发布事务按 Job→Artifact 锁序，在数据库内校验租约和最终条件更新；成功 Job 幂等分支现在同时比较身份、候选清单与输出对象。

边界：测试使用受控的 A→B→迟到 A 时序，没有让两个完整 Worker 同时争抢；A 的迟到失败调用的是生产 `failRenderJob` 底层 `updateGenerationJobUnderLease`，不是再次运行完整失败分支。主代理的完整隔离集成通过，独立代理未重跑。
