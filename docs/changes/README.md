# SDD 变更治理

`docs/changes/` 是 LangReport 的需求到实现追踪入口。文档是约束，代码是结果，测试是证据，Git 是版本记录：

```text
需求 → proposal → design → task → 实现 → 测试 → 验收 → commit → handoff
```

## 什么时候建立变更目录

| 等级 | 典型范围 | 最小产物 |
| --- | --- | --- |
| S | 文案、孤立样式、无行为变化的小修复 | 变更说明和必要测试 |
| M | 单模块字段、接口或交互变化 | 简化 proposal、task 和测试记录 |
| L | 跨模块流程、权限、数据模型或核心交互变化 | 完整 proposal、design、task、test-plan |
| XL | 新项目、核心业务或技术架构变化 | 项目基线、完整 SDD、ADR、验收和交接 |

本仓库的跨模块、权限、数据模型、生成闭环、Worker、记忆、模板和架构变更至少按 L 级处理；新项目治理、核心边界和本次 SDD 初始化按 XL 级处理。用户明确要求时，S/M 也可以升级为完整流程。

## 目录与命名

每个 L/XL 变更使用唯一目录：

```text
docs/changes/YYYY-MM-DD-change-name/
├── proposal.md
├── design.md
├── task.md
├── test-plan.md
├── acceptance.md
└── handoff.md
```

变更正文第一段必须包含 `change-id`、状态和创建/更新时间。目录名使用日期加短横线英文名；`change-id` 使用 `CHG-YYYY-MM-DD-短名`，在所有文档、测试记录和 commit message 中保持一致。可复制的空白模板位于 [_template/](./_template/)。

## 状态与门禁

文档状态按以下顺序推进：

```text
DRAFT → REVIEWING → APPROVED → IMPLEMENTING → VERIFYING → ACCEPTED → COMMITTED → ARCHIVED
```

- `DRAFT`：范围或设计仍在整理；只做调查和文档修订。
- `REVIEWING`：proposal、design、task 已成稿，等待人工审核结论。
- `APPROVED`：审核意见和遗留问题已记录，允许按 task 进入实现。
- `IMPLEMENTING`：只实现已批准范围；范围变化先回到文档。
- `VERIFYING`：按 test-plan 运行验证并收集证据。
- `ACCEPTED`：所有必需验收标准通过，文档与代码已同步。
- `COMMITTED`：规格、实现、测试和验收已用包含 change-id 的 Git 历史记录。
- `ARCHIVED`：变更已关闭，作为历史上下文保留。

未获批准的 design 不能作为业务代码生成依据。若验证失败，保留失败证据并回到 `IMPLEMENTING`；不能通过删除测试、隐藏错误或把 `PARTIAL` 写成 `PASSED` 来关闭变更。

## 六份文档的职责

| 文件 | 必须回答的问题 |
| --- | --- |
| `proposal.md` | 为什么做、谁使用、MVP 和明确不做什么？ |
| `design.md` | 方案如何满足约束，模块/数据/API/权限/异常/回滚如何工作？ |
| `task.md` | 哪些任务按什么依赖完成，每项如何验证和回滚？ |
| `test-plan.md` | 哪些风险用什么自动化或人工场景证明？ |
| `acceptance.md` | 每条验收标准的命令、文件、日志或截图证据是什么？ |
| `handoff.md` | 下一会话从哪里继续，已完成什么，还有哪些未决问题？ |

## 需求追踪要求

每个 L/XL 变更在 `design.md` 中维护追踪矩阵，至少关联：

```text
R（需求） → D（设计） → T（任务） → 测试文件/命令 → commit
```

需求必须写成用户或系统可验证的行为；任务必须可单独判断完成；测试证据必须让另一位开发者能够复现。技术文档引用 `CONTEXT.md` 的规范术语，不创建同义实体。

## 会话交接与 Git

每完成一组任务就更新 `handoff.md`，记录当前阶段、修改范围、当前 commit、已运行命令、已确认决策、已知问题和下一步。新会话必须读取根上下文、[项目基线](../project-spec.md) 和当前变更目录。

开始和结束都检查 `git status` 与 `git diff`，只修改并只提交本次变更范围；保留用户已有修改。提交前至少运行 `git diff --check`、适用的 `manifest` checks 和 `pnpm docs:check`。本项目没有在本次初始化中自动添加 CI、Git hook 或外部项目管理系统，后续若引入须另建变更记录。

## 当前治理初始化

本规则由 [CHG-2026-09-16-SDD-GOVERNANCE](./2026-09-16-sdd-project-governance/proposal.md) 建立。该变更记录保留了初始化范围、设计、任务、验证、验收状态和交接信息。
