# 工作区与双 Agent 协作治理：Test Plan

- 变更编号：CHG-2026-09-21-workspace-agent-governance
- 状态：ACCEPTED
- 创建时间：2026-09-21
- 更新时间：2026-09-21

> 范围调整：LangReport 保留原名，因此不再测试其仅大小写改名；此前的拒绝
> 结果作为迁移风险证据保留。

## 测试范围

本计划验证协作治理和目录迁移的安全性，不验证 LangReport 新产品功能。迁移前、后都应运行同一组无副作用检查并比较结果；现有用户修改导致的基线失败必须原样记录，不能被本变更掩盖。

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| Git 工作树或未提交修改丢失 | 基线/文件差异 | 比较每仓库迁移前后 HEAD、branch、status、未追踪文件和 diff --check | 结果一致，只有本变更明示的新增文件例外 |
| 移动后仓库不再被 Git 识别 | 命令 smoke | 在新路径运行 rev-parse、worktree list 和 status | 两个仓库独立、可读、身份不变 |
| 绝对路径或外部配置失效 | 配置审阅 + smoke | 检查确认生效的路径并按需要更新，验证对应工具启动前检查 | 无未知旧路径；未确认配置保持不变 |
| 文档链接与单一真相漂移 | 自动化文档检查 | 在 LangReport 新路径运行 pnpm docs:check | 通过，或失败与迁移前基线相同且已记录 |
| 两个 Agent 同时改同一文件 | 人工角色演练 | DeerFlow agent 提交研究报告，owner 将其转化为设计，验证 Agent 独立复查 | research/、current-task、LangReport 文档的所有者符合权限矩阵 |
| 研究结论被当作批准 | 人工门禁检查 | 在没有用户 APPROVED 结论时尝试进入产品实现 | 流程停在 USER_REVIEW |
| 回滚无法恢复 | 人工演练/检查表 | 模拟某仓库移动后 Git 校验失败 | 可按记录路径回到原位置，基线重新匹配 |

## 测试数据与环境

- 原始目录：D:\front\newProject\deer-flow 与 D:\front\newProject\LangReport。
- 目标目录：由用户在 T0 确认后填写。
- 使用迁移前的 Git 状态清单、命令输出摘要和经用户批准的本地修改备份作为比较基准。
- 不将 .env、凭据、完整 remote URL 或用户数据写入 test-report/acceptance。

## 自动化测试

迁移前后在相应仓库根目录执行：

    git rev-parse --show-toplevel
    git status --short
    git diff --check
    git worktree list --porcelain

LangReport 额外执行：

    pnpm docs:check

若迁移前 typecheck 或 test 可运行，则记录：

    pnpm typecheck
    pnpm test

迁移后只要求同一命令的结果不劣于迁移前基线；本变更不得借由跳过、删除或弱化已有检查制造“通过”。

## 人工验收步骤

1. 审核 proposal、design、task 中的目标目录、名称、保护策略和未决问题。
2. 确认 DeerFlow agent 只写 research/<task-id>-deerflow.md，LangReport owner 不修改 DeerFlow。
3. 确认 decisions.md 仅指向 LangReport ADR，不包含 ADR 正文。
4. 在移动后重新打开两个项目根目录，确认 Codex 启动时能分别读取根和局部 AGENTS.md。
5. 模拟一个小研究任务，检查从 research 报告到 LangReport 设计、用户批准和 handoff 的链路。
6. 审核 acceptance.md 中的前后基线、路径更新和遗留项。

## 不测试的内容及原因

- 不运行 DeerFlow 全套测试：本变更不修改 DeerFlow 源码，物理迁移主要由 Git/路径 smoke 检查证明。
- 不运行生产部署、数据库迁移或模型调用：它们会引入外部状态且不属于目录治理验证。
- 不验证 LangReport 业务新功能：本变更不改变产品行为；已有未提交工作由其各自 change record 负责。
