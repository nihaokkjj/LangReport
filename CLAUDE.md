# Claude 项目适配说明

本文件只做工具适配，不复制项目事实。权威规则按以下顺序读取：

1. [AGENTS.md](./AGENTS.md)：协作纪律、产品边界、验证和 Git 规则；
2. [CONTEXT.md](./CONTEXT.md)：业务术语和领域对象；
3. [docs/project-spec.md](./docs/project-spec.md)：当前代码结构、模块职责和事实基线；
4. [docs/product/phase1-consulting-report.md](./docs/product/phase1-consulting-report.md)：第一阶段产品范围和验收边界；
5. [docs/changes/README.md](./docs/changes/README.md)：SDD 变更流程和状态门禁。

涉及生成、数据、Worker、记忆或模板时，再读取 [docs/agent/agent-loop-spec.md](./docs/agent/agent-loop-spec.md) 和对应架构文档；涉及 Web 页面、组件、样式或交互时，完整读取根目录 [DESIGN.md](./DESIGN.md) 及 `apps/web/` 下的局部说明。

每个非 trivial 的跨模块或架构变更都在 `docs/changes/YYYY-MM-DD-change-name/` 建立 `proposal.md`、`design.md`、`task.md`、`test-plan.md`、`acceptance.md` 和 `handoff.md`。文档未达到 `APPROVED` 前，不开始对应的业务代码实现；验证结果和未决问题必须回写变更目录。

不要创建与 `CONTEXT.md` 同义的领域实体，不要把未验证内容描述为完成，不要覆盖工作树中的既有修改。常用验证入口以根目录 `package.json` 为准：`pnpm docs:check`、`pnpm typecheck`、`pnpm test` 以及任务涉及范围的专项脚本。
