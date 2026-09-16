# 建立 LangReport SDD 项目治理体系：交接

- 变更编号：`CHG-2026-09-16-SDD-GOVERNANCE`
- 状态：`REVIEWING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 当前状态

治理入口、项目基线、manifest、变更说明、空白模板和本次变更记录已落地；机械验证通过。当前变更停留在 `REVIEWING`，等待项目维护者确认治理规则。

## 已完成

- 新增根 `CLAUDE.md` 薄适配层；
- 新增 `.agents/manifest.json`，覆盖默认上下文、Web、API、生成、数据/产物和文档路由；
- 新增 `docs/project-spec.md` 项目事实基线；
- 新增 `docs/changes/README.md` 和六份空白模板；
- 新增本次变更目录的 proposal/design/task/test-plan/acceptance/handoff；
- 更新根 `AGENTS.md`、`README.md`、`docs/README.md`；
- 新增 ADR-0019，说明 SDD 变更记录的单一权威来源。

## 进行中

- T8：维护者人工审核 proposal/design/task，确认是否接受状态门禁、manifest 字段和后续范围。

## 下一步

1. 维护者审阅 `docs/changes/2026-09-16-sdd-project-governance/`；
2. 在 `acceptance.md` 记录审核结论、意见和遗留问题；
3. 若批准，将六份文档状态推进到 `APPROVED`，后续新业务变更按本流程执行；
4. 若需引入 CI 或 Git hook，另建变更目录，不在本变更中顺手扩张。

## 当前 commit 与修改范围

- 基线 commit：`fe1df14`；
- 本次新增/修改仅限治理文档、ADR、根导航、`.agents/manifest.json` 和 `scripts/docs-check.mjs` 的 docs 根目录白名单；
- 用户原有的 API、Web、部署、架构、产品规格和 `CONTEXT.md` 修改保留，未被覆盖。

## 已运行验证

- `pnpm docs:check`：通过；
- `.agents/manifest.json` JSON 解析：通过；
- `git diff --check`：通过；
- 未运行全量业务测试，因为本次没有业务代码或运行时行为变化。

## 已确认决策

- `CONTEXT.md` 继续作为业务术语唯一来源；
- `docs/project-spec.md` 只记录当前结构和事实，不复制全部产品规格；
- `docs/changes/` 作为一次变更的需求、设计、任务、测试、验收和交接聚合；
- 不在本次引入 CI、Git hook、外部权限或运行时依赖。

## 已知问题与未决问题

- manifest 目前是仓库内约定，尚未由 CI 自动执行；
- 本次治理变更未提交，需维护者按项目 Git 规则决定提交；
- 审核完成前，不能把本变更描述为完全验收。

## 新会话启动必读

1. [AGENTS.md](../../../AGENTS.md)
2. [CONTEXT.md](../../../CONTEXT.md)
3. [docs/project-spec.md](../../../docs/project-spec.md)
4. [docs/changes/README.md](../../README.md)
5. 本目录的 `proposal.md`、`design.md`、`task.md`、`acceptance.md`
