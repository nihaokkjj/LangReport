# 工作区与双 Agent 协作治理：Handoff

- 变更编号：CHG-2026-09-21-workspace-agent-governance
- 状态：ACCEPTED
- 创建时间：2026-09-21
- 更新时间：2026-09-21

## 当前状态

用户已批准具体目录、Git 边界和在途修改处置策略，并调整目录命名范围：DeerFlow 已完成原子改名并通过 Git 核验，LangReport 保留原名。工作区治理任务已验收。

## 已完成

- 建立 proposal、design、task、test-plan、acceptance 和 handoff。
- 确认父目录 D:\front\newProject 不是 Git 工作树；deer-flow 与 LangReport 是两个独立 Git 工作树。
- 确认两个仓库均未发现 .gitmodules 文件，并记录已列出的 worktree 基线。
- 识别当前工作树修改不得被本变更接管。
- 识别 LangReport/config.fixed.toml 中旧绝对路径为迁移前必须核对的项目。
- 在 LangReport 与 DeerFlow 中分别建立 recovery stash，并记录不可变 SHA。
- LangReport 的 docs:check、pnpm typecheck 和 pnpm test 均在干净基线上通过。
- 建立 D:\front\newProject\agent-tasks 独立 Git 仓库、根 AGENTS.md 和双 Agent 协作契约。
- 失败的 DeerFlow 非原子移动已恢复到原 HEAD、clean status 和原 stash；partial duplicate 已删除。
- 用户释放 DeerFlow 目录句柄后，已用单次原子 Rename-Item 完成 deer-flow → deerflow；HEAD、clean status、stash 和 Git worktree 根均符合基线。
- 用户明确决定不再执行 LangReport → langreport 的仅大小写改名；最终布局为 deerflow、LangReport 和 agent-tasks。
- 已将后续任务计划默认使用中文写入 agent-tasks/AGENTS.md。

## 进行中

无。本治理任务已验收，下一项工作应作为独立任务创建。

## 下一步

1. 在 agent-tasks/current-task.md 中登记一个有界 DeerFlow 研究问题或 LangReport 产品问题。
2. 使用中文编写计划与配套 SDD 文档；代码、命令和标识符保持其既有语言。
3. 对 L/XL 产品方案经过用户审批后，再进入 LangReport 实现与验证。

## 当前 commit 与修改范围

- LangReport 当前 HEAD：603b65884e0f2c7323b8d06c3a51ab420590f979；在途工作保留于 stash 1152f9aa981588305ba551d19f0031ca70a07439。
- DeerFlow 当前 HEAD：29d285731b326a728a9df33d3641f73b68bbe48b；在途工作保留于 stash 28effbb9f7807b42d5e7248ddffa0aa8b688d6ac。
- LangReport 新增本变更目录；工作区新增根 AGENTS.md 和独立 agent-tasks 控制面。

## 已运行验证

- 已读取 LangReport AGENTS.md、CONTEXT.md、docs/project-spec.md 和 docs/changes/README.md。
- 已检查两个现有 Git 工作树的 top-level、worktree list 与 status。
- 已确认两个仓库均无 .gitmodules 文件。
- pnpm docs:check：PASS（在 recovery stash 恢复原始 Web Agent 指引后）。
- pnpm typecheck：PASS。
- pnpm test：PASS。
- DeerFlow failed move recovery：PASS（原仓库验证 clean、HEAD 与 stash 仍匹配）。

## 已确认决策

- DeerFlow 是只读研究对象；LangReport 是唯一产品实现对象。
- 工作区控制面不复制 LangReport ADR 或 SDD 正文。
- L/XL 产品变更在用户批准前不进入业务代码实现。

## 已知问题与未决问题

- LangReport 的仅大小写改名曾受外部 Windows 目录句柄阻塞；用户已决定保留原名，因此不再需要诊断或处理该锁。
- DeerFlow 位于 D:\front\newProject\deerflow；LangReport 保持 D:\front\newProject\LangReport。
- config.fixed.toml 的旧绝对路径仍待确定是否由外部工具实际使用。
- Codex Agent 之间没有天然文件系统写入隔离，必须依赖角色协议或后续独立 worktree。

## 新会话启动必读

1. LangReport/AGENTS.md
2. LangReport/CONTEXT.md
3. LangReport/docs/project-spec.md
4. 本目录的 proposal.md、design.md、task.md 和 test-plan.md
5. 两个仓库的最新 git status
