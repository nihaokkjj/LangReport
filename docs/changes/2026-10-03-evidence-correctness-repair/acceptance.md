# 文档交付与未来修复验收

- change-id：`CHG-2026-10-03-evidence-correctness-repair`
- 状态：整体 `IMPLEMENTING`；T6 技术验收通过
- 创建时间：2026-10-03
- 更新时间：2026-10-08

## 2026-10-08 T7 技术验收（通过；实现提交 `251cb4c`）

T7 按 TP10、TP11、TP15 技术验收通过，整体仍为 IMPLEMENTING。审核固定目标 Revision：Job→Artifact→Revision 锁序下核验成功 Job、完整 Brief/Metric/Snapshot、唯一 Evidence、Plan/Render Validation 和四对象清单，读回校验长度与 SHA-256；拒绝发生在状态、Review 与成功审计写入前。批准旧版本只更新 published 指针并追加独立审计，较新 head 和其他版本内容保持不变；Evidence 状态从目标 Revision 投影。默认列表选 head/published，Viewer 仅 published Approved，revisionId 历史查询不借用其他版本证据。

| 场景 | 结果与证据 |
| --- | --- |
| TP10 | submit/approve 各九类故障共18次拒绝：Plan、Render、Job failed、缺 PNG/HTML、同长度错哈希、真实 loopback ECONNREFUSED、缺 Brief、错版本清单；409/503 分类正确，恢复故障后全部业务记录与之前相同。旧无成功 Job 版本也拒绝。 |
| TP11 | 真实两类 Worker 产出的 R1/R2 finding 不同；提交/批准 R1 保持 R2、其余 Evidence 及较新 head 不变。两次并发批准恰一200/一409，Review仅提交/批准各一，published指针恰一独立审计。历史查询及冗余状态故意失配后的投影通过；无 Evidence 历史返回空数组。 |
| TP15 | Editor 可提交不可批准；Reviewer 可批准；Viewer 不读/导出/复制 Draft、可读/导出 Approved、不可审核；非成员404、未认证401、跨Project来源拒绝、非法迁移及expectedStatus冲突通过。 |

最终 `node scripts/test-integration.mjs` 自然退出0（API14、真实预算失败浏览器2、Worker2），原始记录：[最终集成](./evidence/t7-integration-final.txt)。[离线回归](./evidence/t7-offline.txt)自然退出0（含API55）；[API Console](./evidence/t7-console.txt)四屏宽20/20。Chart/API/Contracts/Web源码、API/Web/Generation Worker测试类型，定向Prettier/ESLint、docs检查与diff检查通过。routes.ts仍有三项HEAD既有lint（未使用导入/两个any），[boundaries](./evidence/t7-boundaries.txt)仍为既有Worker集成跨API导入未声明依赖；T7新辅助测试通过传入API factory避免新增跨包导入。[hygiene](./evidence/t7-hygiene.txt)仍因既有UI两份跟踪.log失败，不放宽检查器、不删除历史证据，不能称全仓质量门禁通过。

[独立只读复核](./evidence/t7-independent.md)检查固定770文件快照及关键哈希，未见确定性阻断缺陷；未独立运行集成或类型。快照位于 `C:\Users\sai_8\.codex\visualizations\2026\10\08\01a119ef-072e-7071-a33c-83d3bb4e4931\t7-review`，manifest记录代码身份；最终集成日志当时仍在写入，未作为静态代码哈希依据。

过程证据保留：[沙箱spawn EPERM](./evidence/t7-integration-sandbox.txt)、[无序SQL比较误报](./evidence/t7-integration-attempt2.txt)、[排序修复后通过](./evidence/t7-integration-attempt3.txt)。最终补验曾被自动审批用量限制阻止执行，用户要求继续后恢复获批并通过；不是安全拒绝。存储不可达用注入reader发起真实loopback连接拒绝，不是停止整个MinIO；此结论只证明分类与业务不写入。审核后外部删除对象、历史分类迁移、完整TP25及生产未由本轮证明。没有改变评论阻塞语义。

下一项为T8；本轮不扩展。保留原 `apps/web/next-env.d.ts` 修改不提交，agent-tasks/runtime-experiment未改动或纳入提交；不推送、不部署。

## 2026-10-08 T6 技术验收（通过）

**T6 技术验收通过。**编辑、回滚、复制现在通过持久 Job、候选四对象清单和带 fencing 的原子发布事务。TP12 的六 Job 场景为三个编辑、三个回滚；复制和回滚各自验证对象写入失败后无 Revision/Evidence/审计/成功回复、新复制 Artifact 或 head 推进，再经 API retry 唯一发布。编辑/回滚/复制的同键并发入队以事务保护 Conversation 与 Job；对象已写入 MinIO 而 PUT 回执丢失也通过回归。先前 TP09 的 COMMIT 回执丢失、TP13 的四阶段写入及数据库故障、独立进程崩溃和候选对账、TP14 的提交前失租由下方对应记录支撑。

最终完整 `pnpm test:integration` 在隔离 PostgreSQL/MinIO 自然退出 0（API14/真实浏览器2/Worker2）；API Console 桌面/平板/窄屏/手机 16 项、相关类型、定向 ESLint/Prettier 和文档检查通过。[独立只读复核](./evidence/t6-final-independent.md)未发现确定性 P1/P2，其指出的审计/回复断言缺口已补齐并再核对；独立角色未重跑集成。租约接管测试用隔离库受控推进截止时间，没有实测自然等待和自动轮询；这不改变 TP14 提交前 fencing 与接管的判定。完整变更任务仍为 `IMPLEMENTING`，T7–T12 不因 T6 通过自动验收。下方“当前”“T6 未通过”等段落仅描述各历史时点。

## 2026-10-08 T6 六个并发编辑 Job（当前）

**T6 仍未通过。**真实隔离 PostgreSQL/MinIO 中，六个同一 Chart Artifact 的编辑请求经 API 并发入队，两类 Worker 完整处理。Render Worker 在发布回调入口的同步屏障等待六个候选，五个较高编号并发争抢发布，最低编号最后完成。测试确认六个编号不重复且均高于此前已发布编号，六个 Job 全部成功，每个 Job 恰一 Revision/Evidence/审计/助手回复、四对象可读；同 Artifact 的全部 Revision 编号唯一，head 保持最高成功编号，同 Job 再处理不增加 Revision。完整隔离集成自然退出 0（API14/浏览器2/Worker2）。此项只覆盖编辑 Job；回滚仍是同步 Chart 写入，没有持久 Job 与四对象重新发布，因此不能将 TP12 或 T6 标为通过。

## 2026-10-08 T6 独立进程崩溃与接管（前次结果）

**T6 仍未通过。**真实隔离 PostgreSQL/MinIO 测试通过真实 API 入队、Generation Worker 准备编辑 Job，再让独立 Render Worker 子进程完成四个对象 PUT、读回和候选清单事务后，在业务发布回调入口直接退出。父进程确认退出标记、Job 停在 `validating`、候选账本为 `validated`、四对象可读，而目标 Revision/Evidence/审计/回复均未出现且 head 未推进。只在隔离测试库中将该租约截止时间调至过去，再调用生产恢复入口；新 Worker 取得更高 fencing token、使用新候选键复用预留 Revision 身份，唯一发布四对象与业务行，重复处理不增加结果。完整隔离集成自然退出 0（API14/浏览器2/Worker2）。此证据覆盖写完四对象后的发布前进程退出；不覆盖 MinIO 已接收字节但 PUT 回执丢失，也不覆盖 TP12 六个完整并发编辑/回滚。复制/回滚仍未 Job 化。

## 2026-10-07 T6 TP13 故障矩阵（前次结果）

**T6 仍未通过。**真实隔离 PostgreSQL/MinIO 测试新增四个对象 PUT 阶段、head 更新和审计插入失败注入；连同既有 Evidence 插入失败，验证每例都不暴露半成品，API 重试复用预留身份并唯一发布，二次处理不重复业务行。补充 PostgreSQL 错误码和约束名断言后的最终完整集成 API14/浏览器2/Worker2 自然退出 0，独立只读复核未见新增确定性 P1/P2，未独立重跑。尚缺独立子进程在写完对象、提交前崩溃的证据，以及 TP12 六个完整并发编辑/回滚；复制/回滚仍未 Job 化。下方较早记录保留对应时点的结论。

## 2026-10-07 T6 逐次候选对象对账（前次结果）

**T6 仍未通过。**0034 迁移新增逐次候选账本，首个对象写入前登记四个计划键；发布事务核对已验证账本并原子标为 `published`。真实隔离 PostgreSQL/MinIO 回归验证首写后失败、API 重试、新旧尝试分离、有效租约阻止删除、失败删除退避重试、迟到 PUT 再清理、已发布四对象不被删除。完整集成自然退出 0（API14/浏览器2/Worker2），独立只读复核在修正数据库时钟和队列饥饿后未发现新增确定性 P1/P2，未独立重跑集成。TP12 六个完整编辑/回滚并发、TP13 其余阶段故障和复制/回滚 Job 化仍待完成。下方“候选账本未实现”属于此前快照的历史结论。

## 2026-10-07 T6 提交前失租补验（前次结果）

**T6 仍未通过。**TP14 的新编辑路径现有真实数据库接管测试：A 写完四个私有候选、进入发布事务前失去租约，业务行均未发布；B 取得更高 fencing token，以新对象键唯一完成。A 的迟到完成/失败写入被拒绝，B 的 Job、head、Revision、Evidence、审计和回复保持一致，旧对象字节不变。完整隔离集成 API14/浏览器2/Worker2 通过。逐次候选账本/对账、TP12 六个完整并发编辑/回滚及 TP13 其余故障仍未完成。

## 2026-10-07 T6 COMMIT 回执丢失补验（前次结果）

**T6 仍未通过。**TP09 的新编辑路径现有真实 PostgreSQL 线协议故障注入：数据库提交发布事务后，代理丢弃 COMMIT 回执；Worker 直连查询已成功的 Job/Revision，不误写失败；四个被引用对象仍可读。同 Job 再处理时 Revision、Evidence、审计和回复各保持一份。完整隔离集成 API14/浏览器2/Worker2 通过。该限定结果不覆盖逐次候选对账、TP12 六个完整编辑/回滚并发、TP13 其他完成阶段故障和 TP14 提交前接管。

## 2026-10-07 T6 单事务发布复验（前次结果）

**T6 仍未通过。**本轮在初次审计后，将新生成/编辑的 Revision、独立 Evidence、单调 head、审计、回复和 Job 成功移入一个受租约 fencing 保护的事务。真实隔离 PostgreSQL/MinIO 测试在 Evidence 插入时制造数据库故障，证明这些业务行整体回滚；真实 API 重试后同一预留 Revision 身份成功发布。异常的“已有 Revision 但 Job 未成功”历史恢复写入已删除，故不会在失败时改写旧 HTML 指针或 Evidence。此代码没有承诺自动修复旧业务数据。

| 验收项 | 当前剩余条件                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| TP09   | 新编辑的真实 COMMIT 回执丢失与同 Job 再处理通过；生成及候选对账仍需结合最终整体验收。                             |
| TP12   | 六个完整编辑 Job 的并发发布与反序完成通过；回滚/复制仍绕过持久 Job，编辑/回滚混合场景未验。                       |
| TP13   | 四对象 PUT、Evidence/head/审计故障回滚、候选对账与写完四对象后的独立进程崩溃通过；未模拟已收字节但 PUT 回执丢失。 |
| TP14   | 新编辑 A 提交前失租、B 接管并成功、A 迟到完成/失败被拒绝通过；整体并发和对账仍待验。                              |

下方初次验收表仅描述旧 HEAD `5b100b3`，由[独立只读审计](./evidence/t6-acceptance-readonly.md)支撑，不能直接套用于本轮新代码。最新实施与测试范围见[测试记录](./test-report.md)。

## 2026-10-07 T6 验收判定

**未通过，不得将 T6 标为完成。**本次按 [D3 原子完成设计](./design.md)和 [TP09、TP12–TP14](./test-plan.md)核对产品 HEAD `5b100b3`。候选对象隔离、身份预留、历史计数器回填和四输出读回清单已有各自的限定验证；这些结果不证明 Revision、Evidence、head、审计、回复与 Job 成功状态原子发布。

| 验收项                            | 结论   | 当前证据与阻断                                                                                                                                                                                                            |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TP09 同 Job 幂等、COMMIT 回执丢失 | 未通过 | 同键请求和普通重试已有局部集成断言；完成提交回执未知时没有按 Job 查明事实的恢复路径，也没有证明已引用对象不会被误删。                                                                                                     |
| TP12 六个并发编辑/回滚            | 未通过 | 已验证身份预留编号唯一和反序完成时 head 不回退；没有六个完整业务提交及每个 Job 恰一 Revision/Evidence/审计的断言。新编辑 Job 还可能更新同 Artifact 的旧 Evidence；回滚/复制仍是同步 Chart 写入而非持久 Job，T8 尚未接通。 |
| TP13 存储/数据库故障原子性        | 未通过 | 候选四对象读回失配会阻止创建 Revision；但 Render Worker 分别提交 Revision/head/审计、Evidence、回复、Job 成功。后一步失败可留下已可见 Revision 与失败 Job。已有 Revision 恢复先更新 HTML 指针，再验证其他输出。           |
| TP14 租约接管与迟到 Worker        | 未通过 | Job 状态写入使用 fencing；Revision/head/Evidence 写入不在同一个带租约校验的事务中，提交前失租场景没有通过证据。                                                                                                           |
| 孤儿候选对账                      | 未通过 | 重试会清空 Job 当前候选清单，尚无持久的失败尝试账本和满足保留窗口、无引用、无有效租约条件的清理证明。                                                                                                                     |

独立角色对固定 HEAD 做只读源码审计，未改代码、未独立运行集成。其明确阻断路径为 `apps/render-worker/src/index.ts` 中的完成步骤、Evidence 更新和恢复 HTML 指针，以及 `packages/chart/src/index.ts` 中不受 Worker 租约保护的 Revision/head 事务。本次验收结论来自这些可核对的代码事实和缺失的目标故障注入；现有正常路径测试通过也不能覆盖上述条件。后续需实现单事务 `commitCompletedRevision(lease, candidate)`、固定绑定 Evidence、恢复路径 fencing、未知 COMMIT 结果核对与候选对账，并在真实隔离 PostgreSQL/MinIO 中执行 TP09、TP12–TP14 后重新验收。

## 结论边界

以下为 2026-10-03 文档阶段的历史记录。其“代码修复尚未开始”只描述当时状态；当前实施与 T6 判定以上述新记录和 [测试记录](./test-report.md)为准。历史 217 个离线测试及 15 个集成测试通过只属于审查基线，不能用于关闭本变更。

## 文档交付标准

| 标准                                       | 证据                                        | 状态                             |
| ------------------------------------------ | ------------------------------------------- | -------------------------------- |
| F1–F11 有来源、修复行为与测试映射          | audit-baseline、proposal、design、test-plan | 已编写                           |
| 设计包含输入/渲染/事务/权限/错误/迁移/回滚 | design、ADR-0032/0033                       | 已编写，未批准                   |
| 实现任务、依赖与未授权范围明确             | task、follow-up-scope                       | 已编写                           |
| 原飞书任务状态与修改保留                   | agent-tasks 交接快照、handoff               | 已核对，原字节快照保留 VERIFYING |
| 文档检查与非文档哈希不变                   | test-report                                 | 通过；379 个非文档文件无变化     |

## 修复验收状态

| 需求                 | 实现   | 业务测试         | 人工接受 |
| -------------------- | ------ | ---------------- | -------- |
| R1–R2 图表一致性     | 未开始 | TP01–TP05 未执行 | 未发生   |
| R3–R6 来源/版本/审核 | 未开始 | TP06–TP15 未执行 | 未发生   |
| R7–R8 变换/解析      | 未开始 | TP16–TP20 未执行 | 未发生   |
| R9 并发原子性        | 未开始 | TP12–TP14 未执行 | 未发生   |
| R10 性能             | 未开始 | TP21 未执行      | 未发生   |
| R11 全链路与质量     | 未开始 | TP22–TP25 未执行 | 未发生   |

## 遗留与同步

待审核的是具体设计而非修复完成确认。兼容性运行时、性能与旧库分类必须在授权后的对应任务验证；失败时修订方案，不能删除场景。

本轮不修改 CONTEXT、现行架构正文或产品规格来宣称目标已实现；实施时同步这些权威文档。两项 ADR 仅 Proposed，不加入“已批准决策”索引。飞书/UI/记忆/登录原验收不由本变更代办。
