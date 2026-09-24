# LangReport 工程代码规范与质量门禁：Handoff

- 变更编号：`CHG-2026-09-23-engineering-governance`
- 状态：`IMPLEMENTING`
- 创建时间：2026-09-23
- 更新时间：2026-09-24

## 当前状态

已根据用户确认建立工程治理变更的 SDD 文档，并完成用户授权的 T1、T2、T3、T4、T5、T6、T7、T8 任务；变更整体处于 `IMPLEMENTING`。本轮只安装开发工具依赖、修改工程配置、增加静态检查、扩展 PR offline workflow、更新治理契约测试并执行只读快照验证，未修改产品运行时逻辑或引入 Git Hook。

## 已完成

- 完成 DeerFlow 与 LangReport 规范差异研究；
- 确认第一批范围：文档、最小 ESLint/Prettier、包边界、仓库卫生、PR 模板、Commit CI 检查和 PR CI；
- 确认暂缓 Pre-commit、覆盖率阈值、全量 `any` 清理、SDD 自动状态门禁和发布自动化；
- 建立本变更的 `proposal.md`、`design.md`、`task.md`、`test-plan.md`、`acceptance.md` 和 `handoff.md`。
- 新增人类贡献入口 `CONTRIBUTING.md`；
- 新增工程代码规范 `docs/engineering/code-standards.md`；
- 新增 `.prettierrc.json`、`eslint.config.mjs` 和 `scripts/check-changed.mjs`；
- 根 `package.json` 增加 `format:check`、`format:write`、`lint` 和组合入口 `check`；
- 新增 `scripts/check-boundaries.mjs` 及正反例测试，并增加 `check:boundaries`；
- 新增 `scripts/check-hygiene.mjs` 及正反例测试，并增加 `check:hygiene`；
- 新增 `.github/PULL_REQUEST_TEMPLATE.md`、`scripts/check-commits.mjs` 及正反例测试，并增加 `check:commits`；
- 扩展 `.github/workflows/pr-offline.yml`，加入格式、lint、边界、卫生、文档、Commit、迁移、离线测试、类型、构建和覆盖率门禁；
- 更新 `tests/support/test-system.contract.test.mjs`，使 PR workflow 契约测试覆盖全部新增 MVP 门禁；
- 已完成 T7 本地全仓回归：`pnpm test`、`pnpm typecheck`、`pnpm build` 和 docs check 通过；`pnpm test:coverage` 仅暴露既有 domain 分支覆盖率基线不足，已记录且未改阈值。
- 已完成 T8 独立只读快照验证：Prettier、ESLint、边界、卫生、文档、Commit、逐包类型检查、逐包离线测试和迁移验证通过；快照 Web build 因共享依赖 Junction 的绝对路径限制未完成，主工作树 build 已通过。

## 进行中

- 待用户完成 T9 人工验收，并等待 PR workflow 在远端 GitHub Runner 实际执行；
- ESLint + Prettier、Node boundary checker、仓库卫生、CI-first Commit checker 和 PR offline workflow 已按推荐方案接入；Pre-commit、coverage threshold 和全量历史清理仍延期。

## 下一步

1. 在真实 PR Runner 上运行 `.github/workflows/pr-offline.yml`，确认 checkout、Commit 元数据和本地 Postgres 服务行为；
2. 由用户完成 T9 人工验收，确认 coverage 基线缺口和快照 Web build 路径限制是否进入后续独立变更；
3. 仅在用户明确要求后创建带 `CHG-2026-09-23-engineering-governance` 的 commit，不自动推送。

## 当前 commit 与修改范围

- LangReport 基线 commit：`97a05cbb9d26f20542ec9ca260494270856eb7d0`；
- 当前 LangReport 工作树包含本变更文档、治理配置/脚本、PR workflow、治理契约测试和锁文件更新；未修改产品运行时逻辑；
- 本阶段新增治理文档、T1 两份规范文档、T2 工具配置、T3 边界检查、T4 卫生检查、T5 PR/Commit 检查、T6 PR workflow、T7 治理契约测试更新和后续拟议 ADR；
- `agent-tasks/decisions.md` 的既有用户修改保持不动；
- 当前 `LANGREPORT-2026-09-22-login-gateway` 仍由原变更负责，不在本变更中接管。

## 已运行验证

- 已读取并核对 LangReport 根规则、项目基线、`.agents/manifest.json`、package scripts、PR workflow 和 SDD 治理规则；
- 已运行 `node scripts/docs-check.mjs` 和 `git diff --check`，用于验证 T1 文档；
- `pnpm format:check`：通过；
- `pnpm lint`：通过；
- `pnpm check:boundaries`：通过，包含 4 个正反例测试和实际 workspace 扫描；
- `pnpm check:hygiene`：通过，包含 3 个卫生正反例测试、Git 状态和迁移 journal 扫描；
- `pnpm db:verify`：通过，27 个迁移完成 journal 校验和隔离 schema 回放；
- `pnpm check:commits`：通过，当前基线最近提交按 M 级规则通过；L/XL 缺 ID 和多 ID 反例已由 4 个单测覆盖；
- PR workflow：已审阅命令顺序、checkout 全历史、PR head/base 和本地 Postgres service 配置；尚未在远端 GitHub Runner 实际执行。
- `pnpm typecheck`：通过；
- `pnpm docs:check`：通过；
- `pnpm check`：通过，组合静态、边界、卫生、文档和 Commit 检查全部通过；
- `pnpm test`：通过，root 契约测试和 workspace 离线单元测试通过；
- `pnpm build`：通过，workspace build 成功；
- `pnpm test:coverage`：基线失败，`@langreport/domain` branch coverage 为 `76.09%`，低于既有 `81%` 阈值；未修改覆盖率阈值或业务测试；
- `git diff --check`：通过。
- T8 独立快照：静态检查、逐包类型检查、逐包离线测试和迁移验证通过；Next Turbopack/Webpack build 因依赖 Junction 指向主工作树而被快照路径限制拦截。

## 已确认决策

- 采用“规则文档 → 本地命令 → CI → PR → Commit → 验收”的闭环；
- 第一批不引入 DeerFlow 运行时能力；
- 第一批不修改认证、数据库、生成、Worker、渲染和 UI 行为；
- L/XL Commit 要求 `change-id`，S/M 小修复不强制；
- Pre-commit 延期到独立后续变更；
- 没有新增业务领域术语，因此不修改 `CONTEXT.md`。

## 已知问题与未决问题

- ESLint/Prettier 当前只对变更文件执行，尚未清理历史全仓格式差异；
- boundary checker 已在当前 workspace 和独立快照正反例通过；
- CI 对 PR Commit 历史的读取已写入 workflow，尚未在远端 Runner 执行；
- Markdown 不纳入 T2 格式命令，YAML/JSON 已纳入；若扩大范围需更新命令契约；
- 当前环境未启动真正独立测试 Agent；已使用等价只读快照完成静态、类型、测试和迁移验证，快照 Web build 的依赖路径限制已单独记录；
- `@langreport/domain` coverage 基线低于 81%，属于已延期的历史测试清理范围。

## 新会话启动必读

1. [LangReport AGENTS.md](../../../AGENTS.md)；
2. [CONTEXT.md](../../../CONTEXT.md)；
3. [docs/project-spec.md](../../../docs/project-spec.md)；
4. [docs/changes/README.md](../../README.md)；
5. 本目录的 `proposal.md`、`design.md`、`task.md`、`test-plan.md`；
6. 当前 `git status` 和 `git diff`；
7. 原登录网关变更目录，仅在验证边界发生交集时读取。
