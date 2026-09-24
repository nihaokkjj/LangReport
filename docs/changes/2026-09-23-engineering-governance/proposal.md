# LangReport 工程代码规范与质量门禁：Proposal

- 变更编号：`CHG-2026-09-23-engineering-governance`
- 状态：`IMPLEMENTING`
- 创建时间：2026-09-23
- 更新时间：2026-09-23

## 背景

LangReport 已经具备 `AGENTS.md`、`CONTEXT.md`、项目基线、领域架构、Agent Loop 和 SDD 变更治理，但工程质量规则仍主要依赖文档和人工记忆。当前根 `package.json` 没有统一的 `lint`、`format` 或 `check` 入口；仓库没有根级 `CONTRIBUTING.md`、统一 ESLint/Prettier 配置、Pre-commit 配置或 PR 模板；现有 PR offline gate 也没有执行 `docs:check`、`db:verify`、包边界检查和 diff 检查。

DeerFlow 已将格式化、静态检查、测试、文档同步、PR 说明和 AI assistance disclosure 组合成可执行的贡献流程。本变更只借鉴其工程治理机制，不引入 DeerFlow 的通用多 Agent、MCP、Sandbox、IM Channel 或运行时扩展能力。

## 要解决的问题

- 新开发者和 Agent 无法从一个人类开发入口获知代码、分支、Commit 和 PR 规则；
- TypeScript 格式、静态质量和 Import 约束没有统一的可执行门禁；
- Harness、Domain、Contracts、Web、Worker 的依赖方向主要靠文档，缺少自动回归检查；
- 已存在的 `docs:check`、`db:verify` 和 `git diff --check` 没有统一接入 PR gate；
- LangReport 的 `change-id`、产品不变量、API Console 同步和验收证据没有在 PR 模板中形成固定检查项；
- 本地 Hook、CI 和完整测试之间的职责尚未分层。

## 目标用户与使用场景

目标用户是 LangReport 的开发者、Agent、Reviewer 和维护者。

完成后，开发者应能从根目录运行统一检查，Reviewer 应能在 PR 中快速判断变更范围、受影响的不变量、验证证据和 Git 追踪关系；CI 应能阻止格式、类型、文档、迁移和依赖边界回归。

## 需求范围

### MVP

1. 新增人类开发者入口 `CONTRIBUTING.md` 和工程规范文档 `docs/engineering/code-standards.md`，不复制 `CONTEXT.md`、`AGENTS.md` 或架构 ADR 的业务事实。
2. 引入适合 TypeScript/Next.js monorepo 的最小 ESLint + Prettier 配置，并提供 `lint`、`format:check`、`format:write` 和组合检查入口。
3. 增加包边界检查，至少覆盖 Harness、Domain、Contracts、Web、Generation Worker 和 Render Worker 的依赖方向。
4. 复用并统一接入 `docs:check`、`db:verify`、`git diff --check` 以及敏感文件/生成产物检查。
5. 新增 LangReport 专用 PR 模板，包含 `change-id`、Outcome、Aggregate、范围、不变量、测试、API Console、迁移、UI 和 AI assistance 项。
6. 增加 CI 中的 Conventional Commit 校验；L/XL 变更必须包含 `CHG-YYYY-MM-DD-短名`，S/M 小修复不强制。
7. 扩展 PR offline gate，执行格式、lint、文档、迁移、边界、类型、离线测试、构建和 diff 检查。
8. 用测试、验收和交接文档证明本变更不改变运行时业务行为。

### 后续范围

- 在 CI 稳定后再引入 Husky 或其他 Pre-commit Hook；
- 根据首轮基线统计逐步收紧 `any`、覆盖率和复杂度规则；
- 自动检查 SDD 状态和需求追踪矩阵；
- 发布版本、依赖升级和 changelog 自动化；
- 更复杂的跨包依赖图、循环依赖可视化和架构指标。

## 明确不做

- 不引入 Python、`ruff`、`uv`、Makefile 或 DeerFlow 的运行时架构；
- 不引入通用多 Agent、MCP、Sandbox、IM Channel、Skill Runtime 或动态配置热加载；
- 不修改认证、数据库 Schema、Generation Cycle、Worker Lease/Fencing、Render Worker 或既有 UI 行为；
- 不在 Pre-commit 中运行完整 E2E、真实模型调用或完整 Worker 集成测试；
- 不一次性强制清理全部历史 `any`、格式差异或覆盖率缺口；
- 不新增大规模依赖升级，不修改当前登录网关变更；
- 不在本变更中自动提交、推送或修改工作区控制面的 `current-task.md`、`decisions.md`。

## 成功指标

- 根目录存在可供人类开发者使用的贡献入口，且不复制权威业务文档；
- `pnpm lint`、`pnpm format:check`、`pnpm check` 等命令可从全新依赖环境执行；
- 违规 Import、文档链接、迁移 journal、敏感文件和格式问题能在 CI 中失败；
- PR 模板能够要求变更编号、范围、不变量和验证证据；
- L/XL Commit 可验证包含统一 `change-id`；
- 完整检查通过后，现有 API、生成、渲染、认证和 Web 行为保持不变；
- 变更目录能够建立 `R → D → T → 测试 → commit` 追踪链。

## 假设、依赖与风险

- 假设：Node.js 22、pnpm 11.19.0 和现有 workspace 结构继续作为工程基线；
- 依赖：现有 `package.json` scripts、`pnpm-lock.yaml`、`.agents/manifest.json`、`docs:check`、离线测试和 PR workflow；
- 风险：首次格式化可能产生较大 diff；应先记录基线，再只在明确范围内格式化；
- 风险：过强的 ESLint 或依赖边界规则可能阻塞现有代码，需要先报告违规并分阶段收紧；
- 风险：CI Commit 检查可能无法在所有触发方式中完整读取历史，需要设计清晰的 PR/push fallback；
- 风险：引入本地 Hook 会增加安装和 Windows 兼容成本，因此不纳入 MVP。

## 未决问题

- ESLint + Prettier 是否作为第一阶段固定工具，还是先只加入 CI 检查脚本；本计划推荐固定采用，但规则保持最小；
- 包边界检查采用轻量 Node 脚本还是第三方依赖；本计划推荐先用仓库内脚本；
- `format:check` 的范围是否包含 Markdown、YAML 和 JSON；本计划推荐先覆盖源码、配置和变更文档，不覆盖生成目录；
- Commit 校验是否只在 PR 执行，还是同时覆盖 push；本计划推荐 PR 必须、push 尽力执行；
- 首轮是否需要创建独立 `test-report.md` 快照报告；L/XL 验证阶段必须创建，本阶段暂不伪造测试结果。

## 验收标准概要

1. 贡献指南、工程规范、PR 模板和 SDD 文档职责清晰且通过 `pnpm docs:check`；
2. 新增工程检查命令可执行，并能对一个故意制造的违规样例失败；
3. 现有源码在基线整理后通过格式、lint、类型、离线测试和构建；
4. 包边界测试能拒绝至少一类非法依赖；
5. PR workflow 执行新增门禁并保留离线、无真实凭据测试属性；
6. Commit 校验能接受合法 S/M 提交、拒绝缺少 `change-id` 的 L/XL 提交；
7. 未修改 LangReport 运行时业务行为，登录网关变更保持原范围；
8. acceptance、handoff 和独立测试报告记录可复现证据。
