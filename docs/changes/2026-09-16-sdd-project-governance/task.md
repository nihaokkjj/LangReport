# 建立 LangReport SDD 项目治理体系：任务

- 变更编号：`CHG-2026-09-16-SDD-GOVERNANCE`
- 状态：`IMPLEMENTING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 执行前提

- 已读取根 `AGENTS.md`、`CONTEXT.md`、第一阶段产品规格和 Agent Loop 规范；
- 已读取 SDD skill 的 artifact template 和 governance checklist；
- 已确认现有未提交修改，治理任务不触碰这些业务文件；
- 业务代码实现门禁仍由本变更的人工审核状态控制，本次只实现治理文档和配置入口。

## 任务清单

| ID | 任务 | 依赖 | 可并行 | 负责人 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | 建立 Claude 薄适配层 | 无 | 是 | Agent | DONE | `Get-Content CLAUDE.md` | 只引用权威入口，不复制领域事实 |
| T2 | 建立 `.agents/manifest.json` 上下文路由和 checks | T1 | 是 | Agent | DONE | `ConvertFrom-Json` | JSON 可解析，覆盖主要 app/package/docs 路径 |
| T3 | 编写 `docs/project-spec.md` 项目事实基线 | 无 | 是 | Agent | DONE | `pnpm docs:check` | 结构、模块、运行流、不变量和缺口与代码/文档一致 |
| T4 | 编写 `docs/changes/` 流程说明和六份空白模板 | 无 | 是 | Agent | DONE | `pnpm docs:check` | 命名、状态、门禁、追踪、交接规则清晰 |
| T5 | 建立本次 XL 治理变更六份记录 | T1-T4 | 否 | Agent | DONE | `pnpm docs:check` | proposal/design/task/test-plan/acceptance/handoff 齐全且共享 change-id |
| T6 | 更新根导航并补充治理 ADR | T1-T5 | 否 | Agent | DONE | `pnpm docs:check` | README、docs/README、AGENTS 和 ADR 可互相到达 |
| T7 | 运行范围验证并记录证据，修正 docs-check 根目录约束冲突 | T1-T6 | 否 | Agent | DONE | `pnpm docs:check`; `git diff --check` | 文档检查、JSON 解析、diff 检查通过；用户修改保留 |
| T8 | 维护者审核本治理方案 | T1-T7 | 否 | Project maintainer | TODO | 人工审核 | 记录审核结论、意见和遗留问题后推进状态 |

## 执行顺序

先完成 T1-T4 建立入口和模板，再完成 T5-T6 形成可追踪的本次变更，最后执行 T7。T8 不由本次 Agent 代替完成。

## 并行工作流

T1、T2、T3、T4 只读依赖既有项目文档，可以并行设计；实际写入前仍统一检查当前 diff。T5-T7 必须串行，避免变更矩阵和验收记录落后于文件内容。

## 阻塞条件

- 发现现有用户修改与治理入口冲突；
- 无法从现有 `package.json` 确认验证命令；
- docs-check 失败且无法判断正确链接；
- 维护者要求改变产品边界或引入 CI/外部系统，需要另建变更范围。

## 回滚或替代方案

本次为文档和 JSON 配置变更，不涉及运行时迁移。若维护者否决某个入口，保留变更历史，修订对应文档后重新验证；不删除用户已有修改，不执行破坏性 Git 回退。

## Definition of Done

- [x] 根入口、项目基线、manifest、变更流程和模板已建立；
- [x] 本次治理变更六份记录齐全，追踪矩阵包含 R/D/T/测试/commit 列；
- [x] 业务术语仍由 `CONTEXT.md` 维护，第一阶段边界未改写；
- [x] `docs:check` 和 `git diff --check` 通过；
- [ ] 维护者完成 `REVIEWING → APPROVED` 的人工审核记录。
