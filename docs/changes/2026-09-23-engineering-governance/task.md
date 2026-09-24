# LangReport 工程代码规范与质量门禁：Task

- 变更编号：`CHG-2026-09-23-engineering-governance`
- 状态：`IMPLEMENTING`
- 创建时间：2026-09-23
- 更新时间：2026-09-24

## 执行前提

- 已读取根 `AGENTS.md`、`CLAUDE.md`、`CONTEXT.md`、README、项目基线和 `.agents/manifest.json`；
- 已读取当前 SDD 治理规则、现有 package scripts、PR workflow 和 Git 状态；
- 本轮已完成用户明确授权的 T2、T3、T4、T5、T6 工具接入任务，并完成 T7 本地全仓回归和 T8 独立只读快照验证；T9 仍需最终验收；
- 用户已同意第一批范围：文档、最小 ESLint/Prettier、包边界、PR 模板、Commit CI 检查和 PR CI；
- 当前登录网关变更仍独立处于 `VERIFYING`，本变更不修改其代码、文档、当前任务状态或部署验收；
- 用户已确认第一批范围并授权继续执行，变更进入 `IMPLEMENTING`；
- 本变更只允许修改工程治理、测试和本变更文档范围。

## 任务清单

| ID | 任务 | 依赖 | 可并行 | 负责人 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T0 | 固化现状基线、脚本、CI、依赖边界和工作树范围 | 无 | 否 | LangReport owner | DONE | `git status`; package/CI inventory | 基线事实和缺口写入 design/handoff，不覆盖已有修改 |
| T1 | 新增 `CONTRIBUTING.md` 与 `docs/engineering/code-standards.md` | T0 | 否 | LangReport owner | DONE | `node scripts/docs-check.mjs`; `git diff --check` | 人类规范、Agent 规范、产品术语和架构事实职责不重复 |
| T2 | 引入最小 ESLint + Prettier 及 root scripts | T1 | 否 | LangReport owner | DONE | `pnpm format:check`; `pnpm lint`; `pnpm typecheck` | 源码、测试和配置可检查；不强制清理非 MVP 历史问题 |
| T3 | 实现 Harness/Domain/Contracts/Web/Worker 包边界检查 | T1 | 是 | LangReport owner | DONE | `pnpm check:boundaries` | 合法依赖通过，至少一类非法依赖被测试拒绝 |
| T4 | 实现仓库卫生和提交前静态检查 | T1 | 是 | LangReport owner | DONE | `pnpm check:hygiene`; `pnpm docs:check`; `pnpm db:verify`; `git diff --check` | 迁移 journal、敏感路径、生成物和 diff 规则可执行 |
| T5 | 新增 PR 模板和 Commit/change-id checker | T1 | 是 | LangReport owner | DONE | checker unit tests; PR fixture tests | L/XL 缺 change-id 失败，合法 S/M 提交通过 |
| T6 | 扩展 `.github/workflows/pr-offline.yml` | T2-T5 | 否 | LangReport owner | DONE | workflow review; local command parity | CI 执行所有 MVP 门禁且不使用真实外部环境 |
| T7 | 运行全仓回归并同步文档 | T2-T6 | 否 | LangReport owner | DONE | `pnpm docs:check`; `pnpm typecheck`; `pnpm test`; `pnpm build` | 运行时行为无回归，验收矩阵和 handoff 与实际一致；coverage 基线缺口已记录 |
| T8 | 独立只读快照验证 | T7 | 否 | Verification agent | DONE | `test-plan.md` 静态、类型、测试、迁移命令 | 独立报告记录快照、命令、结果、失败和覆盖缺口；Web build 的快照依赖路径限制已记录 |
| T9 | 人工验收、提交和交接 | T8 | 否 | User / LangReport owner | TODO | acceptance review; `git diff --check` | 所有必需标准通过，commit 含 change-id，未提交无关文件 |
| T10 | 引入 Pre-commit Hook | T6 | 是 | LangReport owner | DEFERRED | 另立变更 | 不纳入本次 MVP，后续单独评估 Windows/安装成本 |

## 执行顺序

```text
T0 → T1 → (T2 ∥ T3 ∥ T4 ∥ T5) → T6 → T7 → T8 → T9
```

T10 不进入本次执行序列。

## 并行工作流

- T2、T3、T4、T5 共享 T1 的规范文档，但不互相修改同一业务文件；
- T8 必须使用 T7 完成后的干净 commit、隔离 worktree 或等价只读快照；
- 测试 Agent 只维护测试文件和 `test-report.md`，不修改业务代码、设计或范围；
- 当前环境若无法启动真正独立的测试 Agent，必须在 handoff 和 test-report 中明确记录，并由主 Agent 使用等价只读快照执行验证。

## 阻塞条件

- 用户未确认 `proposal/design/task`，不得进入实现；
- 发现 ESLint/Prettier 基线改动会触及大量无关业务文件；
- 无法定义稳定的包边界或误报无法收敛；
- CI 无法在无真实凭据环境执行；
- 发现规则变更需要 API、数据库、认证或生成行为调整；
- 当前登录网关变更需要修改同一文件且无法安全分离；
- 独立验证不能获得完整代码快照。

## 回滚或替代方案

- 工具配置或脚本误报：回到报告模式，保留失败证据并收窄规则；
- 格式化 diff 过大：不做全仓自动格式化，改为按包/文件分批清理；
- 包边界脚本不稳定：先保留现有测试并暂停阻断门禁，不引入重量级依赖；
- CI 兼容问题：保留本地可执行脚本，暂时只在 PR 中运行稳定检查；
- 任何业务回归：停止治理变更并恢复工程配置，不回退或覆盖用户已有业务修改。

## Definition of Done

- [ ] `proposal/design/task/test-plan` 已经用户审核并达到 `APPROVED`；当前仅记录本轮执行授权；
- [x] `CONTRIBUTING.md` 和工程规范文档完成且不复制权威事实；
- [x] `pnpm check`、`pnpm lint`、`pnpm format:check`、`pnpm check:boundaries`、`pnpm check:hygiene` 可执行；
- [x] 正反例测试覆盖新增脚本；
- [x] PR offline gate 已配置并由治理契约测试核对所有 MVP 门禁；远端执行仍待完成；
- [x] 全仓 typecheck、offline test、build 和 docs check 通过；
- [x] 既有离线业务测试通过，登录网关范围未扩大；
- [x] 测试报告、acceptance、handoff 和需求追踪矩阵已同步当前本地结果；
- [x] 独立测试报告已记录快照、命令、通过项、coverage 缺口和 Web build 环境限制；
- [ ] 用户完成最终验收后，才允许提交或推送。
