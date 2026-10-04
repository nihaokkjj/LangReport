---
status: accepted
---

# 用 Task 承接多次 Cycle，保持单次生成输入固定

用户已确认设计修订，并要求先规划、不实施。Conversation 是会话层，一个 Task 表达持续分析目标，Generation Cycle 是固定输入的单次生成尝试。澄清保持 Task 但创建新 Cycle，符合既有 Generation 规范；同 Cycle 的执行重试不变输入。等待澄清不结束 Task，成功、最终失败或显式取消才结束 Task Memory。

此前以 Cycle 代替 Task 会迫使“澄清继续记忆”与“澄清必须新 Cycle”互相矛盾；因此增加明确逻辑任务关联，而不是改写旧 Cycle 或把整条父 Job 链归成同 Cycle。新 Cycle 重选当时有效记忆，固定消息来源及兼容摘要；当前 Cycle 可重压缩但不能读后续用户消息。删除是继续使用资格的例外，不是重新选择版本。

代价是 Task 状态、Cycle 关联、摘要来源血缘和 selected/actual-used 记录需要显式表达。历史映射只按证据回填，无法确认的链仅保留历史读取。归档 Conversation 前先完成或取消未结束 Task，不隐式终止。稳定记忆 ID、不可变版本、单值 head 和独立冲突标记使 current/as-of/actual-used 可区分；历史不是当前指令。实现分 A/B/C 三批，见 [设计](../changes/2026-09-24-memory-system/design.md)及[任务](../changes/2026-09-24-memory-system/task.md)。
