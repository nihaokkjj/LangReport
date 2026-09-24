# LangReport 贡献指南

本文是人类贡献者的开发入口。它说明如何开始工作、如何选择变更流程以及提交前必须检查什么；产品事实、领域术语和 Agent 专用指令仍以项目原有文档为准。

## 开始前必须阅读

根据任务范围，先读取以下文件：

- [`AGENTS.md`](AGENTS.md)：项目边界、协作纪律、UI 要求和完成标准；
- [`CONTEXT.md`](CONTEXT.md)：业务术语和领域对象的唯一来源；
- [`docs/project-spec.md`](docs/project-spec.md)：当前代码结构、包边界、运行流和验证入口；
- [`docs/product/phase1-consulting-report.md`](docs/product/phase1-consulting-report.md)：第一阶段产品范围；
- [`docs/changes/README.md`](docs/changes/README.md)：中大型需求和架构变化的 SDD 流程；
- [`docs/engineering/code-standards.md`](docs/engineering/code-standards.md)：工程代码规范和架构约束。

如果修改 `apps/web` 的页面、组件或样式，还必须完整阅读根目录 [`DESIGN.md`](DESIGN.md) 和对应的 `apps/web/AGENTS.md`。如果修改 Agent 启动、生成循环、数据访问、记忆或模板，还必须阅读 `docs/agent/agent-loop-spec.md`。

开始修改前检查当前任务记录、工作树和目标分支。保留已有修改，不用重置、覆盖或清理与当前任务无关的文件。

## 本地环境

- Node.js：`>=22`；
- 包管理器：`pnpm@11.19.0`；
- 仓库类型：pnpm workspace monorepo。

常用命令：

```text
pnpm install
pnpm dev
pnpm dev:all
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm docs:check
pnpm db:verify
```

涉及数据库、外部服务或真实浏览器的命令，先阅读相关开发文档并确认本地环境；离线检查优先使用仓库现有脚本。不要为了通过检查而提交生成物、凭据、真实数据或本地环境文件。

## 变更规模与流程

先判断变更属于哪一类：

- `S`：单文件、局部实现或文案修正，不改变公共契约、领域不变量或架构边界；
- `M`：跨文件或跨包实现，涉及公共接口、持久化、用户可见行为或测试策略；
- `L`：跨模块功能、数据流、Worker、生成闭环或显著的工程治理变化；
- `XL`：架构、领域模型、不可逆基础设施、发布流程或多个产品边界的变化。

`M/L/XL` 变更先建立 `docs/changes/YYYY-MM-DD-<slug>/`，至少包含 proposal、design、task 和 test-plan；`L/XL` 还必须保存 acceptance、handoff 和独立验证证据。没有进入实现阶段前，不修改业务代码。每项任务只推进一个可验收的垂直结果。

涉及真实取舍且难以回滚的架构决策，补充 [`docs/adr/`](docs/adr/)；新增业务领域术语先更新 [`CONTEXT.md`](CONTEXT.md)，不要把实现细节或临时别名写进领域词汇表。

## 代码与架构纪律

具体规则见 [`docs/engineering/code-standards.md`](docs/engineering/code-standards.md)。贡献者至少要遵守以下原则：

- TypeScript 保持严格类型；公共输入输出显式建模，错误使用可识别的错误码或结构，不用静默吞错；
- `packages/contracts` 负责共享契约和运行时校验，`packages/domain` 负责业务规则；领域层不直接依赖 HTTP、React 或数据库连接；
- `packages/db` 负责 schema、迁移和数据库访问，迁移必须可审计；业务代码不能绕过契约直接拼装持久化结构；
- 生成、Worker、图表和适配器遵守现有单向依赖；不要把 UI、凭据或真实外部服务引入离线 Harness；
- Generation Cycle、Revision、Data Snapshot、Chart Artifact/Evidence Block 等对象的来源、口径、变换、规范、主题和校验记录必须可追溯；批准版本保持不可变；
- 记忆候选、模板变更和审核决策必须有显式状态，模型推断不能直接变成项目事实；
- API 变更必须同步 `apps/web/app/api-console` 及相关 OpenAPI 展示、请求示例、场景编排或校验；
- UI 变更遵守设计 token，验证桌面和移动端，以及加载、空、错误和批准状态。

## 测试与验证

按改动范围选择最小充分验证集，并在 PR 中记录命令和结果：

- 文档：`pnpm docs:check`、`git diff --check`；
- 格式与静态检查：`pnpm format:check`、`pnpm lint`；需要修复当前变更文件时使用 `pnpm format:write`；
- TypeScript、包边界、仓库卫生或提交：优先运行组合入口 `pnpm check`，必要时再单独运行 `pnpm typecheck`、`pnpm check:boundaries`、`pnpm check:hygiene`、`pnpm check:commits` 及受影响 workspace 的专项检查；
- 业务逻辑和契约：相关单元测试，再运行 `pnpm test`；
- 构建或跨包变更：`pnpm build`；
- UI：`pnpm --filter @langreport/web typecheck`，并检查桌面/移动端状态；
- 数据库：按变更要求运行 `pnpm db:verify`，不要把真实数据库操作当作离线测试替代品。

当前 `pnpm check`、`pnpm format:check`、`pnpm format:write`、`pnpm lint`、`pnpm check:boundaries`、`pnpm check:hygiene` 和 `pnpm check:commits` 已可用。`pnpm check` 组合静态、文档、边界、卫生和 Commit 检查，不替代 `typecheck`、`test`、`build` 或 `db:verify`。格式和 lint 默认只检查当前工作树或 `CHECK_BASE`/`GITHUB_BASE_SHA` 之后变更的源码、测试和配置文件，不代表历史全仓基线已经格式化；PR workflow 已接入对应独立门禁。

## 分支、提交和 PR

分支名使用能表达意图的前缀，例如 `feature/`、`fix/`、`docs/`、`refactor/`。提交信息使用 Conventional Commits 风格，例如：

```text
docs(governance): add engineering code standards
fix(api): preserve report revision history
```

每个提交只表达一个逻辑结果。提交信息必须符合 Conventional Commits；`M/L/XL` 变更在提交信息或 PR 元数据中关联唯一 `change-id`，其中 `L/XL` 的每个提交都必须包含同一个合法 ID；`S` 级小修复不强制 change-id。可用 `CHANGE_SIZE`、`CHANGE_ID`、`COMMIT_BASE` 和 `COMMIT_HEAD` 配置 `pnpm check:commits`。不要提交密钥、`.env`、构建产物、覆盖率目录、编辑器状态、临时导出文件或真实用户数据。

提交 PR 前确认：

- PR 描述包含问题、范围、不做事项、验证命令和结果；
- 涉及数据或接口时说明迁移、兼容性、回滚和 api-console 同步；
- 涉及 UI 时说明设计依据、响应式检查和状态覆盖；
- 相关 SDD 文档、ADR、验收矩阵和 handoff 与实现一致；
- `git diff`、`git status` 和 `git diff --check` 只包含本任务内容；
- 未经用户明确确认，不执行 commit、push、合并或删除他人修改。

## 当前明确延期的事项

以下事项不因本指南发布而自动启用：全量历史 `any` 清理、覆盖率阈值、Pre-commit Hook、SDD 状态自动推进、发布自动化、DeerFlow 运行时能力和与本阶段咨询项目报告无关的通用 BI 能力。它们必须另立任务并完成相应评审。
