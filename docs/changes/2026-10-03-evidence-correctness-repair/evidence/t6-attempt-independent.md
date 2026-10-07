# T6 候选对象隔离限定独立复核

- 复核日期：2026-10-07
- 基线：LangReport `a671c10`
- 冻结补丁：`C:\Users\sai_8\.codex\visualizations\2026\10\04\01a10606-4bd3-7033-bf98-f84d2e7059da\t6-attempt-review\change-final-assertions.patch`
- 角色：短期独立只读复核；未修改产品代码，未独立执行数据库测试

首轮复核发现 P2：新渲染虽使用独立候选键，已有 Revision 的恢复分支仍将 HTML 写入原键。主实施者改为恢复时新建 HTML 键，并补充 HTML 对象实际写入后抛错、真实 API 重试的用例。

第二轮复核指出用例尚未断言重试后的 Job 状态，不能支持“重试成功”结论。主实施者补充 `succeeded` 与 Evidence 绑定断言。最终冻结补丁的限定只读复核未发现新增明确缺陷：新渲染四种输出使用同一尝试标识，已有 Revision 的 HTML 恢复使用新键；测试检查同一 Revision ID、新旧键不同、旧对象字节不变、Job 成功及 Evidence 指向该 Revision。

主实施者在最终断言后运行完整隔离 `node scripts/test-integration.mjs`，自然退出 0：API 14/14、真实预算失败浏览器桌面/移动 2/2、Generation Worker 2/2。独立复核只检查冻结补丁，不将主实施者测试冒充独立重跑。并发租约、数据库 fencing、Revision/Evidence/head/Job 原子提交及孤儿候选清理仍未验收。
