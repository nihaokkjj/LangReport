# T6 COMMIT 回执丢失限定独立复核

- 复核角色：独立只读验证代理；未修改产品代码，未独立重跑集成测试。
- 固定快照：`C:\Users\sai_8\.codex\visualizations\2026\10\04\01a10606-4bd3-7033-bf98-f84d2e7059da\t6-commit-loss-review\tree`，基线 `5d5d0529a087a63bf5974bb298f3c2f80b362b6f`；同目录保存 `change.patch` 与 10 个改动文件的 SHA-256 清单。
- 结论：未发现本轮新增的确定性 P1/P2；仅覆盖新编辑发布事务的 COMMIT 回执丢失路径，不接受 T6 整体。

复核确认：代理限定本地专用测试库，仅被注入的发布事务经过代理；PostgreSQL 发出 `CommandComplete(COMMIT)` 后代理截断返回连接，测试用 `didDropCommit()` 排除未触发故障。Render Worker 的异常路径使用独立 `db` 读取 Job/Revision，只有 Job `succeeded` 且存在同 Job Revision 才承认已提交，因此不会再写失败状态；该路径没有对象删除。集成断言核对四个引用对象可读，以及再次处理后 Revision、Evidence、审计和回复不重复。`postgres` 测试依赖与 lockfile 已同步，生产默认发布函数不变。

复核指出一项非阻断测试精度缺口：固定快照只检查代理确实丢回执，没有显式断言发布 Promise 以异常返回。主代理随后加入 `publishRejected` 断言并重跑完整隔离集成，自然退出 0（API14/浏览器2/Worker2）；该补丁不在独立代理固定快照中，独立代理未复验补丁。
