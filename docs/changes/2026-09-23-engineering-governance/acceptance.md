# LangReport 工程代码规范与质量门禁：Acceptance

- 变更编号：`CHG-2026-09-23-engineering-governance`
- 状态：`IMPLEMENTING`
- 创建时间：2026-09-23
- 更新时间：2026-09-24

## 验收结论

- 结论：`PARTIAL`
- 验收时间：2026-09-24
- 验证 commit：`N/A`

当前已完成 T1-T8：工程规范、静态检查、边界/卫生/Commit 检查、PR workflow、本地全仓回归和独立只读快照验证均已落地或验证。`pnpm test:coverage` 暴露了既有 `@langreport/domain` 分支覆盖率基线不足（76.09% < 81%）；本变更不降低阈值、不修改业务测试。独立快照的 Web build 受共享依赖 Junction 的绝对路径限制，主工作树 `pnpm build` 已通过，因此整体验收仍为部分通过，待远端 workflow 运行和人工最终验收。

## 验收证据

| 标准 | 证据 | 命令或文件 | 结果 |
| --- | --- | --- | --- |
| 需求范围已明确 | Proposal | `proposal.md` | 已记录，已获本轮执行授权 |
| 设计、边界和回滚已明确 | Design | `design.md` | 已记录，已获本轮执行授权 |
| 任务、依赖和延期项已拆分 | Task | `task.md` | 已记录，已获本轮执行授权 |
| 人类贡献入口和工程代码规范已建立 | T1 文档 | `CONTRIBUTING.md`; `docs/engineering/code-standards.md` | 通过 |
| ESLint、Prettier 和根级命令可执行 | T2 工具接入 | `eslint.config.mjs`; `.prettierrc.json`; `scripts/check-changed.mjs`; `package.json` | 通过 |
| Harness/Domain/Contracts/Web/Worker 边界可自动验证 | T3 边界检查 | `scripts/check-boundaries.mjs`; `scripts/check-boundaries.test.mjs` | 通过 |
| 仓库卫生和迁移一致性可自动验证 | T4 卫生检查 | `scripts/check-hygiene.mjs`; `scripts/check-hygiene.test.mjs`; `pnpm db:verify` | 通过 |
| PR 和 Commit 可追踪到变更 | T5 PR/Commit 检查 | `.github/PULL_REQUEST_TEMPLATE.md`; `scripts/check-commits.mjs`; `scripts/check-commits.test.mjs` | 通过 |
| PR offline gate 执行 MVP 门禁 | T6 workflow | `.github/workflows/pr-offline.yml` | 通过审阅，待远端运行 |
| 风险有对应验证方式 | Test Plan | `test-plan.md` | 已记录并完成本地/快照验证 |
| 工程工具和 CI 已可执行 | 实现与 PR workflow | T2-T6；`test-system.contract.test.mjs` | 本地通过，远端待运行 |
| 全仓无运行时回归 | 回归命令 | T7/T8；本地 `pnpm test`、`pnpm typecheck`、`pnpm build`，快照逐包测试与类型检查 | 本地和快照测试/类型检查通过；快照 Web build 受依赖路径限制；coverage 基线未达标 |
| 独立验证和最终验收 | `test-report.md`、handoff | T8 快照报告；T9 人工验收 | 独立验证完成，最终验收未完成 |

## 失败项与遗留问题

- 详细设计已获本轮执行授权，整体验收仍未完成；
- T1-T8 已完成本地实现、回归和独立只读快照验证，但尚未完成远端 workflow 和最终人工验收；
- `pnpm test:coverage` 仍因既有 `@langreport/domain` 分支覆盖率 `76.09%` 低于 `81%` 阈值而失败；该阈值与历史测试清理已明确延期，本变更未调整它；
- 独立快照的 Next Web build 使用共享依赖 Junction 时被 Turbopack/Webpack 的绝对路径解析限制拦截；主工作树 `pnpm build` 已通过，该快照环境失败不归因于产品代码；
- PR workflow 尚未在远端 GitHub Runner 实际执行；
- Pre-commit 明确延期，不属于本次 MVP；
- 当前登录网关真实 HTTPS smoke 仍由原变更负责。

## 文档同步确认

- [x] 本变更文档使用统一 `change-id`；
- [x] 未修改 `CONTEXT.md`，因为没有新增业务领域术语；
- [x] 未修改当前登录网关变更；
- [x] T1 已新增 `CONTRIBUTING.md` 和工程代码规范；
- [x] T2 已新增 ESLint、Prettier 和变更文件检查命令；
- [x] T3 已新增包边界检查及正反例测试；
- [x] T4 已新增仓库卫生检查，并通过迁移 journal 与隔离 schema 回放；
- [x] T5 已新增 PR 模板、Conventional Commit 和 change-id 正反例检查；
- [x] T6 已扩展 PR offline workflow，使用本地临时 Postgres，不读取生产凭据；
- [x] 已评估无需同步 `AGENTS.md`、manifest 或新增业务上下文；PR workflow 已在本变更内同步；
- [x] T1 已运行底层 `node scripts/docs-check.mjs` 和 `git diff --check`；
- [x] 已运行完整 `pnpm docs:check`、类型检查、离线测试和构建；
- [x] 已完成独立只读快照的静态检查、逐包类型检查、逐包离线测试和迁移验证，并记录 Web build 环境限制；
- [x] 已记录 coverage 基线失败、远端 workflow 和人工最终验收缺口，不将部分通过描述为最终通过。
