# Zapier-inspired 暖色工作台视觉迁移：Task

- 变更编号：`CHG-2026-09-24-zapier-inspired-workbench-theme`
- 状态：`VERIFYING`
- 负责人：LangReport owner agent
- 创建时间：2026-09-24
- 更新时间：2026-09-24

## 执行前提

- 本变更按 L 级跨模块视觉迁移处理；`proposal.md`、`design.md`、`task.md` 和 `test-plan.md` 需人工审核后才能修改业务代码。
- 当前登录网关变更 `CHG-2026-09-22-login-gateway` 仍为 `VERIFYING/PARTIAL`；本变更不修改其状态，也不覆盖其工作树修改。
- 实现前必须重新读取根 `DESIGN.md`、`apps/web/AGENTS.md` 和当前变更目录，并记录重叠文件的快照边界。
- 不改变 API HTTP 合同、数据库结构、权限、Generation Cycle、Review 状态和 Visual Template 持久化合同；仅同步内部渲染器版本标识。

## 任务清单

| ID | 阶段 | 任务 | 依赖 | 可并行 | 负责人 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T0 | Phase 0 基线 | 保护现有工作树，确认当前分支、dirty files、设计/渲染器入口和回滚边界 | 无 | 否 | 主 Agent | DONE（只读） | `git status`、`git diff --stat`、`rg` | 有文件清单和不覆盖声明 |
| T1 | Phase 1 规范 | 完成 proposal/design/task/test-plan，确认暖色令牌、状态扩展、字体 fallback、R4 范围 | T0 | 否 | 主 Agent + 用户 | DONE | `pnpm docs:check` | 文档一致，未决问题有结论 |
| T2 | Phase 1 门禁 | 用户审核并批准变更，记录审核意见和遗留问题 | T1 | 否 | 用户 + 主 Agent | DONE | 文档审查 | 用户已批准，审核结论已写入 `proposal.md` |
| T3 | Phase 2 Web | 更新 `DESIGN.md`、`globals.css`、Web utility CSS 消费方式和必要的工作台组件样式 | T2 | 否 | 主 Agent | DONE | Web typecheck/test:typecheck/build | 桌面/移动工作台不改业务行为，令牌集中且无旧色板漂移 |
| T4 | Phase 3 图表/导出 | 对齐 `page.tsx` 交互图表与 Flint adapter 的字体、默认色板、静态 HTML；更新相关单测 | T2 | 可与 T3 后半并行 | 主 Agent | DONE | Flint tests/typecheck、Web typecheck/build | 同一 Spec 的预览与导出默认视觉一致，自定义 Theme 仍覆盖 |
| T5 | Phase 4 回归 | 检查空、加载、失败、澄清、Review、Approved、抽屉、预览和认证入口；完成桌面/平板/移动自动化检查 | T3/T4 | 否 | 主 Agent | DONE | `pnpm --filter @langreport/web test:e2e`、人工截图 | 1440/1024/760/390 四断点共 40 项通过；4 项真实 HTTPS smoke 按既有决策跳过 |
| T6 | Phase 5 独立验证 | 使用隔离快照按 test-plan 执行验证，输出 test-report；失败由主 Agent 修复后复测 | T5 | 否 | 验证角色 | DONE（主 Agent 只读复核；独立角色不可用） | 全量/专项验证命令 | `test-report.md` 记录 `TEST_PASSED_WITH_LIMITATION`、跳过项和验证限制 |
| T7 | Phase 5 验收交接 | 更新 acceptance/handoff，确认回滚点、未决风险和下一步 | T6 | 否 | 主 Agent + 用户 | TODO | `pnpm docs:check`、`git diff --check` | 用户确认后才可 `ACCEPTED`/提交 |

## 执行顺序

```text
T0 → T1 → T2（DONE）→ T3 ─┐
                         T4 ─┴→ T5 → T6 → T7
```

当前 T0、T1、T2、T3、T4、T5、T6 已完成，T7 待用户验收；既有 dirty diff 继续保留。Flint 新默认输出使用 `vega-lite-svg-v2`，历史数据库默认值不迁移。T6 的独立角色不可用限制已记录在 `test-report.md`。

## 并行工作流

- T3 与 T4 只能在 T2 批准后开始；T4 后半可与 T3 并行，但不能同时修改同一文件。
- T6 优先使用独立 worktree、隔离分支或等价只读快照；当前环境无法启动独立验证角色，因此由主 Agent 按同一 test-plan 执行只读复核，且不修改业务代码、范围和架构。
- 当前环境若不能启动独立验证角色，主 Agent 必须在 handoff 中声明限制，并按同一 test-plan 执行只读复核。

## 阻塞条件

- 未完成用户审核前，不修改 `DESIGN.md`、CSS、交互图表或 Flint adapter。
- 无法区分当前登录网关 dirty diff 与本变更所需修改时，暂停并要求明确快照/提交边界。
- 若需求扩大到营销官网、完整报告模板、字体授权或 Visual Template 数据迁移，返回 `DRAFT/REVIEWING` 重新设计。
- 如果预览与导出无法共享一致令牌，保留失败证据，不降低验证标准。

## 回滚或替代方案

- 优先回滚视觉 token 和 Flint 默认色板，不回滚 API、数据库或历史 Revision。
- 若 R4 风险过高，可在审核时将范围缩小为 Web workbench Chrome，暂不改变 Flint 默认图表输出；必须同步修改 proposal/design/task/test-plan。
- 若 Degular 字体不可用，使用 Inter fallback，不引入未授权字体文件。

## Definition of Done

- [ ] 文档获得人工批准，需求、设计、任务、测试和不做范围一致。
- [ ] Web 工作台暖色令牌迁移完成，四个固定入口、证据层级和抽屉行为未改变。
- [ ] 交互图表与 Flint 默认输出字体/颜色一致；自定义 Theme 覆盖仍可用。
- [ ] 空/加载/失败/澄清/Review/Approved/文件预览/认证状态完成检查。
- [ ] Web、Flint、全量类型/测试和文档验证通过。
- [ ] 独立验证报告、acceptance 和 handoff 已同步，用户完成验收。
- [ ] 只有在用户确认后才提交包含变更编号的 Git 历史。
