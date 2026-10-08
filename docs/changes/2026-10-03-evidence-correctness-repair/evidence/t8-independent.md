# T8 独立复核：第二固定快照

日期：2026-10-08。Verification agent 只读源码与证据，仅写本报告，不批准范围、不代替用户接受。

## 身份与范围

快照 `t8-review2` 的 manifest 共 787 个文件，逐一重新计算 SHA-256，787/787 匹配，无哈希差异。本轮复核固定 page、revision-command、Canvas、Web E2E、Worker integration、Generation watcher；新增检查 Render Worker、flint-adapter 静态 HTML 及其 unit。未独立运行单元、集成、类型或浏览器测试，也未使用共享 3100 端口。

第一次固定快照的报告保留在 `t8-review/t8-independent.md`，记录真实 P2，不能改写为首次无缺陷。

## 首次 P2 修复复核

`selectConversation` 在实际对话改变时同步 abort 版本命令、dispatch `langreport:generation-abort`、清 job/restoredJobId 与 busy/notice。同步 event 立即使旧 watcher 的 controller aborted；isCurrent 同时检查此 signal，因此 React effect cleanup 前收到旧响应也不会提交结果。随后清 Job 让观察停用。用户选择的新对话按 scoped ID 单独恢复；旧 Job ID仍留在其原用户/项目/对话 key，显式切回可以恢复。派生成功内部直接 setConversationId，不经过用户切换的清 Job 分支。

新增 E2E 持有 retry 后旧 /status 请求，用户通过历史列表切回原对话，释放成功响应，核对不跳回、不显示复制成功；刷新仍保持原对话，显式切回复制对话后恢复固定 Revision。此测试覆盖了第一报告的遗漏条件。静态复核确认首次 P2 已修复，未见新增确定性 P1/P2。

## 新增 HTML 身份修复

此前 TP07 真实集成暴露 HTML 无 Artifact ID 的失败，已保留失败日志。StaticSvgHtmlInput 新增可选 artifactId，模板在 provenance 中用 escapeHtml 输出，Render Worker 从 reservedRevision.artifactId 传入，与 Revision ID/编号同源。这是新候选 HTML 的生成变化，没有修改旧对象路径或旧 Revision 更新行为。集成检查新 HTML 包含新 Artifact ID、Revision ID、实际模板 R编号，并继续比较来源所有 Revision/Evidence 与四输出字节不变。adapter unit 增加真实 Artifact 元数据断言。

## 其他结论与证据限制

- TP07/TP08 的 Approved 来源、较新 Draft head、固定冻结来源、新身份/输出、旧记录与字节不变断言保持；未见新增确定性缺陷。
- TP22 的旧 201/200 Revision 与新 202/200 Job分支、失败重试、终态恢复、固定历史读取、project/Conversation 切换取消均有对应路径。历史选项包含当前版本且按 Artifact 过滤，避免加载新 Artifact 时借用旧选项。
- 快照 owner 日志 adapter unit 为18/18、Conversation桌面检查2/2。后者仍含修复历史option之前的MUI警告，因此不把它当作最终option修复验收。旧四宽日志是首次P2修复前执行记录，不能当作第二快照四宽证明。
- owner 说明最终完整集成此前被两个浏览器进程争抢3100中断，最终串行补跑尚在进行；本报告不声称最终集成自然退出，也不独立证明完整质量门禁、生产或部署。

静态结论：第二固定快照未发现确定性 P1/P2，初次 P2修复可从源码及新增测试设计成立；关闭T8仍需 owner完成与此代码一致的最终串行集成及浏览器验收并如实记录。
