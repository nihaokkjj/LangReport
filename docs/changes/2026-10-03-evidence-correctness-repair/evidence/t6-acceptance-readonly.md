# T6 验收独立只读审计

- 日期：2026-10-07
- 固定产品 HEAD：`5b100b3`
- 角色与方式：独立短期验证角色，只读检查源码和现有测试；未修改产品文件，未独立运行集成测试
- 判定：**T6 未通过验收**

## 阻断项

1. `apps/render-worker/src/index.ts` 的新版本路径先调用 Chart 服务分别提交 Revision、Artifact head 与审计，再写 Evidence、回复，最后设置 Job `succeeded`。任一后续写入失败会留下已提交的业务行与失败 Job，违反 TP13。
2. 同文件的 `persistEvidenceBlock` 对新编辑 Job 优先找同 Artifact 最近的 Evidence 并更新其 Revision、Job、finding 与状态，可能把旧版本 Evidence 改绑，已批准状态也可能退回 Draft；数据库只对 `generationJobId` 设置唯一约束，不能防止这一行为。
3. 业务写入之前的租约检查和 Chart 服务事务分开。Chart 的 Revision/head 事务本身不核对 owner、token、fencing token 和数据库到期时间；旧 Worker 在检查后失去租约仍可能提交业务结果，违反 TP14。
4. 已有 Revision 恢复先独立更新 HTML 输出指针，然后读回并核对其余对象；PNG 等输出失配时，Job 失败但 Revision 的 HTML 指针已变化。
5. 完成事务的 COMMIT 回执未知时没有先按 Job 核实既成事实的专用分支；失败尝试的候选对象缺少可对账的持久账本和保留窗口判定。Storage 已提供删除接口，但 Render Worker 没有对账流程。
6. `apps/api/src/chart-routes.ts` 的回滚/复制仍同步调用 Chart；复制在 `packages/chart/src/index.ts` 分段写 Artifact、Revision、head 与审计，没有 Generation Job、候选四输出或 Evidence。TP12 包含回滚，不能只凭编辑 Job 的并发编号断言通过。审核入口还按 Artifact 批量更新 Evidence 并在批准旧版本时改写 head；后者属于 T7 待修，但会影响“每个 Job 恰一固定 Evidence”的持续不变量。

## 测试缺口

现有集成覆盖普通重试、候选输出读回失配、两次并发身份预留、反序版本 head、Job 状态 fencing 和旧 PNG 篡改拒绝。未执行六个完整编辑/回滚并发提交、Evidence/head/audit 故障回滚、提交前 A/B 失租、COMMIT 回执丢失、孤儿候选对账的 TP09/TP12–TP14 组合场景。正常路径集成通过不能推导这些场景通过。

建议先完成带租约 fencing 的单事务业务提交和 insert-only Evidence，再补恢复、未知提交结果与候选对账；全部故障场景在隔离 PostgreSQL/MinIO 下通过后重新验收。
