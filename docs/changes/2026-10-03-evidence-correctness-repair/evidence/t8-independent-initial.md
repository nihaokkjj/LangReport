# T8 独立只读复核

日期：2026-10-08。角色：Verification agent，仅报告事实与缺陷，不批准范围、不代替用户接受。

## 快照与验证方式

固定快照：`t8-review`，相对 `origin/main 3c78c99` 的 `t8-diff.patch`。独立读取新增的 `revision-command.ts`、其单元测试及 tracked diff。完整核对 manifest 的 780 个文件 SHA-256，全部匹配。关键 page、command、Canvas、Web unit、Web E2E、Worker integration 六文件再次核对全部匹配。未修改产品或控制文档，未独立重跑测试。

阅读工作区角色规则、current-task、产品 AGENTS/CONTEXT/第一阶段产品规格、本变更 task/test-plan/acceptance/handoff 的相关部分；审阅 Web 版本命令、历史读取、Job 恢复与 watcher、TP07/TP08 集成断言及 TP22 E2E。快照内 browser-four-widths 日志为 owner 执行 8 passed；这不是独立运行结论。

## 确定性阻断

**P2：同 Project 切换 Conversation 后旧版本 Job 会重启观察，并在成功时把界面拉回旧 Conversation。**

位置：`apps/web/app/(protected)/page.tsx:715`（selectConversation），`:922`（成功结果强制路由），`:975`（watcher enabled）；`apps/web/features/generation/use-generation-job.ts` effect 依赖 onTerminal。

复现条件：复制或回滚提交得到 queued Job，界面切到其新 Conversation；用户在任务完成前选择同一 Project 的其他 Conversation。selectConversation 只更新 conversationId 与路由，不清 job/restoredJobId。onTerminal 因 conversationId 变化获得新引用，旧 watcher 被取消后立即使用同一个旧 jobId 重建；因此 isCurrent 对重建 watcher 仍为 true。旧 Job 完成后 handleGenerationTerminal 无 Job/当前 Conversation 一致性门，直接 setContext 到 payload.job.conversationId。旧任务结果覆盖用户选择，也可能刷新错误 Conversation 的消息。

建议：显式用户对话切换同步取消版本命令、清除当前 Job 与恢复标记，或仅对属于当前 Conversation 的 Job 启动 watcher并提交结果；派生命令内部跳转继续保留其新 Job。补同 Project 对话切换 E2E，延迟旧 Job 完成后断言当前 Conversation 不变。现有测试只覆盖 project 切换，不覆盖此条件。

## 其余审阅结果

- TP07/TP08：集成断言从 Approved 来源且较新 Draft 为 head 的状态派生；检查新 Artifact/Revision/Evidence、parent、冻结 Brief/Metric/plan/lineage/result/execution/memory/finding、四输出新键与 HTML 新身份，逐条比较原 Revision/Evidence 和旧四输出字节。未见这些新增断言的确定性阻断。
- TP22：command helper区分旧 201/200 固定 Revision 与新 202/200 Job，错响应拒绝；pending Job key 包含认证用户/项目/对话，只有 ID 存储。终态恢复显式启用 watcher，后端 status 对终态不受 afterVersion 限制。固定历史读取不回退为 head。项目切换同步 abort 命令、清 busy，固定读取有 AbortSignal。未见这些路径的其他确定性阻断。
- Canvas沿用既有按钮与 TextField，不新增视觉 token；E2E日志覆盖四屏宽和水平溢出。未独立视觉截图比较、未独立访问真实页面。

结论：此固定快照存在上述一个 P2，修复并提供同对话隔离复验前，不支持关闭 T8。没有新增 P1。数据库/对象存储测试日志最终自然退出、全仓 lint/boundaries/hygiene、生产与部署均不由本报告证明。
