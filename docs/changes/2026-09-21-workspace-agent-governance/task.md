# 工作区与双 Agent 协作治理：Task

- 变更编号：CHG-2026-09-21-workspace-agent-governance
- 状态：ACCEPTED
- 创建时间：2026-09-21
- 更新时间：2026-09-21

## 执行前提

物理实施前必须同时满足：

1. 用户已确认 D:\front\newProject、deerflow、保留 LangReport 原名和 agent-tasks 的 Git 归属；
2. 用户已允许放弃当前 LangReport 和 DeerFlow 未提交内容；实施仍先建立 Git stash 恢复入口；
3. proposal、design、task 和 test-plan 获得 APPROVED 结论；
4. 没有运行中的进程占用旧/新路径；
5. 所有预检结果、路径依赖和可恢复备份均已记录。

## 任务清单

| ID | 任务 | 依赖 | 可并行 | 负责人 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T0 | 审核并批准目录、命名、Git 边界和保护策略 | 无 | 否 | 用户 | DONE | 人工审核本变更文档 | 所有未决问题有明确答案 |
| T1 | 记录两个仓库的迁移前 Git/文件/命令基线 | T0 | 否 | LangReport owner | DONE | git status、rev-parse、worktree list、diff --check | HEAD、branch、worktree、stash 和 LangReport 命令基线已记录 |
| T2 | 识别运行进程、绝对路径、挂载、链接和外部配置；建立恢复备份 | T1 | 部分 | LangReport owner | DONE | 预检清单 | 恢复 stash 已建立；旧绝对路径和 Windows 目录句柄已记录为后续风险 |
| T3 | 创建目标目录、根 AGENTS.md 和 agent-tasks 的最小控制面 | T0、T2 | 否 | LangReport owner | DONE | 文档链接与任务文件审阅 | 独立 agent-tasks Git 仓库和最小 Agent 契约已建立 |
| T4 | 完成 deerflow 改名并确认 LangReport 原名保留 | T1、T2、T3 | 否 | LangReport owner | DONE | 每仓库 Git 身份与 status 比对 | DeerFlow 已原子改名并核验；用户决定保留 LangReport，故不再执行其仅大小写改名 |
| T5 | 评估已确认生效的外部路径并执行迁移后验证 | T4 | 否 | LangReport owner | DONE | docs:check、基线对比 | 无已确认生效的外部路径需要修改；LangReport 保持原位置，docs:check 与迁移前基线一致 |
| T6 | 建立两个固定 Agent 角色、研究报告模板、当前任务和决策索引 | T3、T5 | 否 | LangReport owner | DONE | 控制面文档审阅 | 角色边界、研究报告合同、当前任务和决策索引均已可由新会话读取；首个研究问题作为下一独立任务执行 |

## 执行顺序

T0 → T1 → T2 → T3 → T4 → T5 → T6。

T1 与 T2 都必须完成才能开始 T3；T4 绝不与 T5、T6 并发。这样任意迁移故障都仍能定位到单一移动步骤并回滚。

## 并行工作流

T2 期间可由 DeerFlow research agent 仅做路径/研究文档阅读，但不能移动目录、创建配置或修改代码。L/XL 产品变更的独立验证 Agent 只在 T5 使用隔离 worktree 或只读快照。

## 阻塞条件

- 用户未选择最终目标目录，或未确认 deerflow 与保留 LangReport 原名；
- 任一仓库仍有未处理的工作树差异或无法制作可恢复备份；
- 绝对路径、symlink/junction、Git worktree 或工具配置无法安全迁移；
- 迁移前基线命令已有未知失败且无法判断迁移后是否回归。

## 回滚或替代方案

- 若物理移动风险超过收益，保留 D:\front\newProject 作为 workspace 根，仅新增 agent-tasks，并通过根 AGENTS.md 规定角色边界。
- 若移动后验证失败，按 design.md 的回滚步骤移动回原始路径，不使用破坏性 Git 命令。
- 若 agent-tasks 不适合作为独立 Git 仓库，则将其保持为本地、非权威任务缓存；长期决策继续只写入 LangReport docs/adr。

## Definition of Done

- 所有验收标准有可复现证据；
- 两个 Git 仓库的身份和用户在途修改均完整保留；
- DeerFlow research agent 与 LangReport owner agent 的权限边界和研究报告合同已写入；
- LangReport ADR/SDD 仍为技术决策与实现证据的唯一权威来源；
- current-task.md、decisions.md 和研究记录可从新会话恢复当前工作。
