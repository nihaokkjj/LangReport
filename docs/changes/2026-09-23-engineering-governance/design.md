# LangReport 工程代码规范与质量门禁：Design

- 变更编号：`CHG-2026-09-23-engineering-governance`
- 状态：`IMPLEMENTING`
- 创建时间：2026-09-23
- 更新时间：2026-09-24

## 现状与约束

LangReport 是 Node.js 22+、pnpm 11.19.0 的 TypeScript monorepo，workspace 由 `apps/*` 和 `packages/*` 组成。当前已有 `typecheck`、离线 `test`、`build`、`docs:check`、`db:verify` 和各类专项 smoke 命令，但没有 root `lint`/`format`/`check`，也没有统一 formatter/linter、PR 模板、Pre-commit 或 Commit message 检查。

现有硬边界必须保持不变：

- `apps/*` 负责进程、传输、认证和依赖组装；
- `packages/contracts` 是共享合同出口；
- `packages/db` 是 Schema 和迁移唯一拥有者；
- Harness 不得反向依赖 LangReport 领域包或数据库 Schema；
- Generation Cycle、Data Snapshot、Chart Revision、Worker Lease/Fencing 和 Plugin Manifest 的领域规则不因工程治理变更而改变；
- 当前登录网关变更仍由 `LANGREPORT-2026-09-22-login-gateway` 负责，本变更不接管其验证或部署 smoke。

## 设计目标与非目标

### 目标

- 建立单一的人类开发入口和最小、可执行的 TypeScript 质量规则；
- 将重要依赖边界和仓库卫生要求自动化；
- 将已有文档、迁移和离线测试命令接入 PR gate；
- 让 PR 和 Commit 能够追踪到 SDD change-id；
- 保持离线检查不访问真实数据库、对象存储、模型、认证或外部服务。

### 非目标

- 不重构任何业务包；
- 不把 LangReport 改造成 DeerFlow 的通用 Agent 平台；
- 不在本阶段建立覆盖率、复杂度或 `any` 的全量强制基线；
- 不在本阶段把完整测试放入本地 Hook；
- 不自动推进 SDD 状态或替代人工验收。

## 方案选型

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| ESLint + Prettier | Next.js/TypeScript 生态成熟，职责清楚，易于逐步收紧 | 需要配置 monorepo、测试文件和 Markdown 范围 | 采用，作为 MVP 工具链 |
| Biome 一体化 | 依赖更少、速度快 | 需要一次性迁移格式和 lint 语义，现有生态兼容性需重新确认 | 暂不采用 |
| 只靠文档和人工 Review | 改动最小 | 无法稳定阻止格式、边界和迁移回归 | 不采用 |
| 直接复制 DeerFlow 的工具链 | 可借鉴成熟流程 | Python/Make/ruff 与 LangReport 技术栈不匹配 | 不采用 |
| 第三方依赖图分析器 | 覆盖范围广 | 增加依赖和误报调试成本 | MVP 先用仓库内 Node 检查脚本 |

## 模块边界

```text
CONTRIBUTING.md / docs/engineering/code-standards.md
                    │ 规范来源
                    ▼
root package scripts ──► eslint / prettier / docs-check / db-verify
                    │
                    ├──► package-boundary-check
                    ├──► repository-hygiene-check
                    └──► typecheck / offline test / build
                    │
                    ▼
             PR workflow / PR template
                    │
                    ▼
             Reviewer + acceptance evidence
```

规则职责：

- `AGENTS.md`：Agent 工作纪律、产品边界和任务门禁；
- `CONTRIBUTING.md`：人类开发、分支、Commit、PR 和验证入口；
- `docs/engineering/code-standards.md`：格式、类型、Import、包边界和检查矩阵；
- `.agents/manifest.json`：按路径路由上下文和检查命令；
- `package.json`：可执行脚本事实来源；
- `.github/workflows/pr-offline.yml`：PR 的机械门禁；
- `docs/changes/`：单次变更的范围、设计、任务、测试、验收和交接。

## 数据模型与状态流转

本变更不修改运行时数据库、对象存储、API 数据模型或 Generation Job 状态。

工程治理自身采用以下流转：

```text
规则文档 REVIEWING
  → 人工审核 APPROVED
  → 工具和脚本 IMPLEMENTING
  → CI/独立快照 VERIFYING
  → 验收证据 ACCEPTED
  → 带 change-id 的 COMMITTED
```

如果格式、lint 或边界脚本首次运行发现历史违规，记录基线和修复范围，不把失败伪装成通过；若修复范围显著扩大，返回 `REVIEWING` 更新设计。

## API / 外部契约

本变更不新增运行时 HTTP API、数据库接口、模型供应商接口或对象存储合同。

新增的工程命令属于开发契约：

```text
pnpm lint
pnpm format:check
pnpm format:write
pnpm check
pnpm check:boundaries
pnpm check:hygiene
```

`pnpm check` 只编排可在本地和 CI 复现的静态检查与离线验证；真实模型、生产数据库、MinIO 和部署 smoke 继续使用独立命令。

## 架构图

```text
Developer / Agent
       │
       ├─ local: format:check + lint + typecheck + diff check
       │
       ▼
Pull Request
       │
       ├─ docs-check ───────────────┐
       ├─ migration journal check ──┤
       ├─ boundary check ───────────┤
       ├─ hygiene check ────────────┤
       ├─ commit/change-id check ───┤
       ├─ offline test ─────────────┤
       ├─ typecheck/build ──────────┤
       ▼                            │
   CI pass/fail ────────────────────┘
       │
       ▼
Reviewer checks scope, invariants and evidence
       │
       ▼
Acceptance + handoff + commit
```

成功路径是所有适用检查通过后进入人工 Review；失败路径保留原始错误，回到实现或设计阶段；异步边界是 PR workflow 和独立验证快照；权限边界是 CI 只读代码和配置，不访问生产凭据；数据落点是 CI 日志、测试报告、acceptance 和 handoff，不是产品数据库。

## 数据流

1. 开发者根据 `CONTRIBUTING.md` 和变更文档修改代码。
2. Root scripts 调用格式、lint、类型、文档、迁移、边界和卫生检查。
3. PR workflow 在无真实外部环境的条件下重复这些检查，并运行已有离线测试、构建和覆盖率命令。
4. 检查失败时返回稳定的文件、规则和命令；不自动修改业务代码。
5. Reviewer 根据 PR 模板核对 change-id、范围、不变量、API Console 和验证证据。
6. 验收记录把需求、设计、任务、测试和 commit 关联起来。

## 权限、校验与异常处理

- 所有静态检查默认不读取或打印 secret；
- 离线测试继续拒绝真实 `DATABASE_URL`、S3、模型和认证环境变量；
- hygiene check 只报告路径和规则，不输出文件内容中的 secret；
- boundary check 对未知语法和无法解析的依赖应失败并要求人工处理，不静默放过；
- 误报或规则冲突必须记录为例外，并带文件、原因、责任范围和移除条件；
- CI 失败不能通过修改测试、隐藏错误或降低检查范围来关闭；
- Commit message 校验只对当前 PR 中可见的提交执行，无法获得完整历史时明确报告限制。

## 迁移、兼容与回滚

本变更无运行时数据库迁移。工具链迁移按以下顺序实施：

1. 先添加配置和检查脚本，不改变业务源文件；
2. 在本地记录现有违规基线；
3. 只修复进入 MVP 的必要文件和规则；
4. CI 先以报告模式运行，再切换为阻断模式；
5. 如工具链造成大范围误报，可回滚配置和脚本，不回退产品代码或数据库。

本地 Pre-commit 不属于 MVP；后续若引入，仍只运行快速检查，不承担完整测试责任。

## 日志、监控与可观测性

- CI 保留每个检查命令和失败摘要；
- `test-report.md` 记录独立快照、命令、结果、失败用例和覆盖缺口；
- 例外规则必须带期限或移除条件；
- 不上传环境变量、Cookie、模型密钥、数据库连接串或真实数据；
- 规则的通过不等于业务验收通过，acceptance 仍需记录领域不变量和功能回归证据。

## 测试策略

- 脚本单元测试：验证 boundary/hygiene/commit 检查的通过和拒绝路径；
- 契约测试：验证 root scripts、`.agents/manifest.json` 和 CI 命令名称一致；
- 回归测试：运行 `pnpm docs:check`、`pnpm db:verify`、`pnpm typecheck`、`pnpm test`、`pnpm build`；
- PR 测试：验证无真实外部环境变量时可运行，配置真实环境变量时离线测试主动拒绝；
- 业务不变量回归：确认 Generation、Chart、Worker、Auth 和 Web 现有专项测试未被影响；
- 独立验证：使用实现后的干净 commit 或只读快照复跑测试，不把主工作树自测描述为独立验证。

## 需求追踪矩阵

| 需求 | 设计 | 任务 | 测试 | commit |
| --- | --- | --- | --- | --- |
| R1 人类开发规范单一入口 | D1 模块边界 | T1 | docs-check、人工审阅 | 已完成 |
| R2 最小 TypeScript 格式和 lint 门禁 | D2 方案选型、D3 命令契约 | T2 | format/lint 正反例 | 已完成 |
| R3 包依赖方向可自动验证 | D1、D3、权限边界 | T3 | boundary 正反例 | 已完成 |
| R4 仓库卫生和迁移一致性 | D3、异常处理 | T4 | hygiene、db:verify、diff check | 已完成 |
| R5 PR/Commit 可追踪 | D1、D4 | T5 | PR 模板、commit checker | 已完成 |
| R6 CI 覆盖所有 MVP 门禁 | D4、测试策略 | T6 | PR workflow | 已完成 |
| R7 不改变产品运行时行为 | 非目标、回滚 | T7/T8 | 全仓 regression | 本地和独立快照测试/类型检查通过；coverage 基线和快照 Web build 路径限制已记录 |
