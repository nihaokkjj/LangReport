# 建立 LangReport SDD 项目治理体系

- 变更编号：`CHG-2026-09-16-SDD-GOVERNANCE`
- 状态：`REVIEWING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 背景

LangReport 已有业务上下文、第一阶段产品规格、Agent Loop 规范、架构文档和多份 ADR，但缺少统一的项目基线入口、Agent 上下文路由、Claude 适配层和按变更归档的 SDD 文档骨架。新任务容易只依赖自然语言交接，导致需求、设计、验证和 Git 历史之间断链。

## 要解决的问题

- 新会话无法从一个入口知道当前代码结构和模块事实；
- 不同工具没有统一的上下文加载路由；
- 中大型变更没有固定的 proposal/design/task/test/acceptance/handoff 产物和状态门禁；
- 文档检查只验证链接，不能指向一个明确的变更追踪入口。

## 目标用户与使用场景

目标用户是 LangReport 的开发者、Agent 和 Reviewer。收到跨模块、权限、数据模型、生成流程或架构需求时，开发者可以从项目基线和 `docs/changes/` 模板启动一条可审计的 SDD 流程；新会话可以从 `handoff.md` 恢复，不依赖上一会话的口头摘要。

## 需求范围

### MVP

1. 提供 `CLAUDE.md` 薄适配层，并明确权威文档顺序；
2. 提供 `.agents/manifest.json`，路由默认上下文、模块上下文和真实验证命令；
3. 提供 `docs/project-spec.md`，记录当前 monorepo 模块边界、运行流、不变量、已知缺口和文档地图；
4. 提供 `docs/changes/` 使用规则、空白模板和本次治理初始化的完整变更记录；
5. 把治理入口加入根 `AGENTS.md`、`README.md` 和 `docs/README.md`；
6. 增加一个 ADR，记录治理文档的单一权威来源和变更追踪决策。

### 后续范围

- 在 CI 中自动解析 manifest 并执行变更状态门禁；
- 与 Git hook、Issue/项目管理系统或外部审核系统集成；
- 为 S/M 级小修复建立更轻量的命令行生成器。

## 明确不做

- 不修改业务代码、数据库 Schema、API 合同、前端行为或生成流程；
- 不改变第一阶段产品范围、领域术语、不变量或已有 ADR 的结论；
- 不自动提交、推送、创建分支或改写用户已有工作树修改；
- 不引入 CI、Git hooks、外部凭据或新的运行时依赖。

## 成功指标

- 根入口能够指向业务、结构和变更治理的唯一来源；
- `.agents/manifest.json` 覆盖 Web、API、生成、数据/产物和文档主要路径；
- 新建 L/XL 变更可以按模板生成六份文档，并能建立 R→D→T→测试→commit 追踪链；
- `pnpm docs:check` 通过，且本次不产生业务行为变化。

## 假设、依赖与风险

- 假设：当前 `package.json` 中的脚本是可执行验证命令的事实来源；
- 依赖：已有 `AGENTS.md`、`CONTEXT.md`、第一阶段规格、Agent Loop 规范和 docs-check；
- 风险：manifest 是项目内约定而不是现成运行时协议，后续自动化接入时需要保持其字段兼容；
- 风险：现有工作树有用户修改，治理文档不能把它们误报为本次变更。

## 未决问题

- 是否在后续变更中把 `docs/changes` 状态校验接入 CI；
- 是否需要为提交信息增加自动检查；
- 本次治理方案需项目维护者确认后，才将当前变更从 `REVIEWING` 推进到 `APPROVED`。

## 验收标准概要

1. `CLAUDE.md`、`.agents/manifest.json` 和 `docs/project-spec.md` 存在且职责不重复；
2. `docs/changes/` 规则和模板能指导一次完整的 L/XL 变更；
3. 本次变更的六份记录齐全，状态和人工审核待办可信；
4. 根导航均能到达新增入口；
5. 文档检查和 diff 检查通过，未修改业务行为。
