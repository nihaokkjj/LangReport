# 建立 LangReport SDD 项目治理体系：测试计划

- 变更编号：`CHG-2026-09-16-SDD-GOVERNANCE`
- 状态：`VERIFYING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 测试范围

覆盖治理文件存在性、JSON 结构可解析、Markdown 相对链接和锚点有效、docs 根目录约束、变更文档六件套和本次 diff 范围。业务代码、数据库和 UI 行为不在本次变更范围内。

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| manifest 语法或字段损坏 | 配置校验 | 解析 `.agents/manifest.json` | 解析成功，包含 context/routes/checks |
| 新文档链接断裂 | 文档校验 | 运行 `pnpm docs:check` | 根导航、模板和变更文档链接全部通过 |
| 误触碰业务修改 | Git 范围检查 | 查看 `git status` 和 `git diff --stat` | 既有用户修改保留，本次只包含治理文件 |
| 变更文档缺件或编号漂移 | 文件/文本检查 | 枚举本次变更目录并搜索 change-id | 六份文档齐全且编号一致 |
| 治理规则误宣称已批准 | 人工审阅 | 检查状态、验收结论和遗留项 | 明确处于 REVIEWING，保留维护者审核待办 |

## 测试数据与环境

- 环境：Windows PowerShell，仓库根目录 `D:\front\LangReport`；
- 输入：仓库 Markdown、JSON、package scripts 和当前 Git 工作树；
- 不需要数据库、Docker、外部 API、模型凭据或客户数据。

## 自动化测试

1. `pnpm docs:check`
2. `Get-Content -Raw '.agents/manifest.json' | ConvertFrom-Json`
3. `git diff --check`
4. `rg -n 'CHG-2026-09-16-SDD-GOVERNANCE' docs/changes/2026-09-16-sdd-project-governance`

## 人工验收步骤

1. 从 [docs/changes/README.md](../README.md) 进入模板和本次变更；
2. 检查 `proposal.md` 的 MVP/不做范围与第一阶段规格一致；
3. 检查 `design.md` 的模块边界、状态、数据流和追踪矩阵；
4. 检查 `task.md` 的依赖、验证命令和未完成的 T8；
5. 确认 `acceptance.md` 没有把未经过维护者审核的方案标为完全通过；
6. 确认 `handoff.md` 能让下一会话直接恢复。

## 不测试的内容及原因

- 全量 TypeScript、API、数据库、Worker 和 E2E：本次无业务代码或运行时行为变化；
- UI 视觉和响应式：本次没有修改 `apps/web` 页面、组件、样式或交互；
- CI/Git hook：本次明确不引入这些外部执行机制。
