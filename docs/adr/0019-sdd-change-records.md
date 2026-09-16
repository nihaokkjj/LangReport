# ADR-0019：以变更目录作为 SDD 需求到验收的单一追踪边界

- 状态：Proposed
- 日期：2026-09-16
- 关联变更：`CHG-2026-09-16-SDD-GOVERNANCE`

## 背景

LangReport 已有产品规格、架构文档、Agent Loop 规范和测试记录，但这些稳定文档不能承载一次具体需求的设计取舍、执行依赖、验收证据和会话交接。若只依靠 commit 或聊天摘要，需求很难稳定追溯到测试和实现范围。

## 决策

使用 `docs/changes/YYYY-MM-DD-change-name/` 作为每个 L/XL 变更的 SDD 聚合边界，固定包含 `proposal.md`、`design.md`、`task.md`、`test-plan.md`、`acceptance.md` 和 `handoff.md`。所有文档共享一个 `change-id`，并在 `design.md` 中维护 `R → D → T → 测试 → commit` 追踪矩阵。

根 `AGENTS.md`、`CONTEXT.md`、`docs/project-spec.md` 和产品/架构文档继续承担稳定事实；`CLAUDE.md` 和 `.agents/manifest.json` 只做工具入口与上下文路由，不复制这些事实。

状态采用 `DRAFT → REVIEWING → APPROVED → IMPLEMENTING → VERIFYING → ACCEPTED → COMMITTED → ARCHIVED`。未 `APPROVED` 的设计不能作为业务代码生成依据；验收失败保留证据并回到实现或文档修订。

## 为什么不只使用 Git commit

commit 能记录版本，但不能单独表达用户目标、明确不做范围、设计约束、人工审核结论、验收失败项和下一会话上下文。把这些内容放在变更目录，可以让文档先于代码建立约束，并在代码之后继续保存证据。

## 后果

正面结果：中大型变更有固定入口；新会话可恢复；需求、测试和 Git 历史能互相定位；未批准和部分验收状态不会被自然语言掩盖。

代价：每个 L/XL 变更需要维护六份文档；manifest 和项目基线需要随代码结构变化更新；若未来要强制执行状态，需要另行接入 CI 或 Git 工具。

## 未选择的方案

- 只维护一份不断增长的项目 README：缺少按变更隔离的状态、证据和交接；
- 每个 Agent 工具复制一套业务上下文：容易产生术语和边界漂移；
- 当前就引入外部项目管理系统：会增加凭据、同步和权限边界，不属于第一阶段治理初始化。
