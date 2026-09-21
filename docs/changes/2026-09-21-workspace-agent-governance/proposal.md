# 工作区与双 Agent 协作治理：Proposal

- 变更编号：CHG-2026-09-21-workspace-agent-governance
- 状态：ACCEPTED
- 创建时间：2026-09-21
- 更新时间：2026-09-21

> 用户于 2026-09-21 批准：保留 D:\front\newProject 作为父目录、agent-tasks 作为独立 Git 仓库，并允许放弃现有在途修改。最初计划把产品目录命名为 langreport；用户随后明确调整为保留 LangReport 原名。最终布局为 deerflow、LangReport 和 agent-tasks，实施仍先通过可恢复 Git stash 保留恢复入口。

## 背景

当前 D:\front\newProject 下有两个独立 Git 工作树：

- deer-flow：用于研究的参考项目；
- LangReport：唯一计划持续实现和交付的产品项目。

后续工作既需要持续研究 DeerFlow 的成熟模式，也需要避免参考项目的复杂度、术语和源码修改泄漏进 LangReport。聊天记录不能作为长期项目记忆；技术选型、方案取舍和可复现证据需要有稳定、可版本化的落点。

## 要解决的问题

1. 当前父目录不是 Git 仓库，跨仓库协作状态没有一个明确的、可追溯的控制面。
2. DeerFlow 研究与 LangReport 实现若由同一无边界的 Agent 流程处理，容易出现“照搬架构”、并发写入或证据不完整。
3. LangReport 已有 ADR 和 SDD 变更记录；若另建一套完整 decisions 文档，会出现两个相互竞争的架构事实来源。
4. 两个工作树当前都不是干净状态。未经预检直接移动或重命名，可能丢失用户在途修改、失效本地配置或破坏工具信任路径。

## 目标用户与使用场景

用户在一个长期 Codex 协作过程中：

1. 向 DeerFlow research agent 提出一个有界研究问题；
2. 获得带源码路径、提交基线、适用边界和反例的研究报告；
3. 由 LangReport owner agent 将报告转化为 LangReport 的问题评估与设计；
4. 用户审核技术取舍后，owner 实现、验证并保留 ADR、变更记录和复盘材料；
5. 新会话可从任务状态和项目文档恢复，不依赖此前聊天全文。

## 需求范围

### MVP

- 将 D:\front\newProject 定义为包含参考仓库、LangReport 产品仓库和协作控制面的工作区根。
- 定义 DeerFlow research agent 与 LangReport owner agent 的只读/写入职责、产出合同和状态转移。
- 定义 agent-tasks/current-task.md 与 agent-tasks/decisions.md 的最小职责，避免与 LangReport docs/adr 和 docs/changes 重复。
- 给出物理迁移前、迁移中、迁移后以及回滚的安全清单。
- 在实际移动前记录当前 Git、工作树、配置和路径依赖的基线。

### 后续范围

- 为 agent-tasks 初始化独立 Git 历史，并按批准的目录结构创建其初始文件。
- 在确认的目标父目录中移动两个现有 Git 工作树。
- 创建根 AGENTS.md 和 agent-tasks 的协作约束文件。
- 将每个已验收里程碑汇总为面试/复盘案例。

## 明确不做

- 不修改 DeerFlow 任何业务源码、配置、Git 历史或产品行为。
- 不在本变更中修改 LangReport 的产品、领域模型、API、Worker 或依赖。
- 不把 DeerFlow 的 super-agent、子 Agent、Sandbox、MCP、IM 通道或动态代码插件引入 LangReport。
- 不自动提交、暂存、stash、reset、restore、push 或删除用户已有修改。
- 不把 agent-tasks 当成 LangReport 产品文档、ADR 或源代码的第二份副本。

## 成功指标

- 每项 LangReport 架构建议都可追溯到：问题证据、DeerFlow 参考（如有）、适用性判断、用户批准、实现和验证。
- 任何时刻都能从 current-task.md 得到唯一当前任务、状态、下一步和所需用户决定。
- 长期技术决策只在 LangReport docs/adr 中保存正文；agent-tasks/decisions.md 仅保存索引。
- 目录迁移后两个 Git HEAD、分支和原有未提交变更与迁移前基线一致，除本变更明确新增的文件外无额外差异。

## 假设、依赖与风险

- 最终名称为 deerflow 和 langreport；my-agent 不采用，因为它会混淆产品名与 Agent 角色。
- 最终父目录为 D:\front\newProject，不移动父目录本身。
- Codex 子 Agent 共享宿主文件系统，因此角色隔离依赖明确约束，不能被描述为操作系统级权限隔离。
- LangReport 当前存在在途 API Console / route registration 修改；DeerFlow 当前有未追踪的 .codegraph 目录。两者均必须在移动前由用户选择保护方式。
- LangReport/config.fixed.toml 包含 D:\front\LangReport 的绝对项目路径，且与当前目录不同；必须先确认其是否仍被实际工具使用，不能机械替换。

## 未决问题

无。批准结论已记录在本文档顶部；实施前只需完成 task.md 中的可验证预检。

## 验收标准概要

- 用户批准本 proposal、design 和 task 后，才允许进入物理整理。
- 每个工作树完成预检、可恢复快照和迁移后验证。
- 两位 Agent 的角色、交接格式和禁止行为可由第三方从文档中复现。
- docs:check 能通过，或仅保留迁移前已记录且与本变更无关的失败。
