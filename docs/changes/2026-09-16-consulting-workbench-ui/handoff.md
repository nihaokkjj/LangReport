# 咨询项目证据工作台 UI 与交互改造：交接

- 变更编号：`CHG-2026-09-16-CONSULTING-WORKBENCH-UI`
- 状态：`IMPLEMENTING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 当前状态

第一轮 P0/P1 已完成，普通会话发送的 `undefined.id` 回归已修复，桌面和移动端 E2E 已通过。T7 Project onboarding 和 T8 图表编辑器已实现并完成自动化验证；完整变更仍未完成人工验收和提交，下一步从 T9 继续。

## 已完成

- Workbench 改为状态驱动的单一 Composer + 四项准备度。
- 未满足 Snapshot/Metric/Brief 时允许先提交普通问题。
- 兼容普通消息 `{ messages: [...] }` 和生成消息 `{ message, job, nextAction }`。
- 澄清选项可回填 Composer，失败状态可返回分析。
- 图表数据点支持交互读数。
- 增加桌面右侧、移动底部 Review Inspector；评论、审核意见、批准和要求修改入口可用。
- E2E 使用 `.next-e2e`，不再与 3000 端口本地开发服务共享 `.next` 锁。
- 更新 E2E 定位器并新增普通消息发送回归用例。
- Project 创建已保存客户、目标、受众和 Visual Template，历史 Project 通过默认值兼容。
- 图表编辑器已支持聚合运算、单条件筛选、单条件排序、注释、数值标签和图例开关；逻辑编辑会基于来源 Snapshot 重算并追加子 Revision。
- Render Worker 已保留编辑 Job 的新 TransformPlan 和 field lineage，不再把逻辑编辑回退为父版本事实。

## 进行中

- 无正在执行的代码任务；T7/T8 已完成，T9/T10 尚未开始。
- 文档是补录的正式变更记录，当前状态为 `IMPLEMENTING`/`PARTIAL`，不要描述为完整验收。

## 下一步

1. 继续 T9：实现允许范围内的 Theme token 和固定 Revision 导出状态，保持 Visual Template、Project Theme 和 Plugin ThemeRef 分层。
2. 完成 T10：进行桌面/移动人工验收，更新 `acceptance.md`，再决定是否进入 `ACCEPTED`。

## 当前 commit 与修改范围

- 分支：`main`。
- 基线 HEAD：`cc94b25`。
- 本轮 UI 和测试修改尚未提交，当前文件范围：
  - `apps/web/app/page.tsx`
  - `apps/web/app/globals.css`
  - `apps/web/next.config.ts`
  - `apps/web/playwright.config.ts`
  - `apps/web/test/e2e/consulting-report.spec.ts`
  - `apps/api/src/chart-routes.ts`
  - `apps/generation-worker/src/index.ts`
  - `apps/generation-worker/test/integration/worker.integration.test.ts`
  - `apps/render-worker/src/index.ts`
  - `packages/contracts/*`
  - `packages/domain/src/index.ts`
  - `packages/chart/src/index.ts`
  - `packages/flint-adapter/*`
  - `packages/db/src/schema.ts` 与 `packages/db/drizzle/0020_project_onboarding.sql`
- E2E 生成目录 `.next-e2e` 已清理；`next-env.d.ts` 无未提交差异。

## 已运行验证

- `pnpm --filter @langreport/web exec playwright test -c playwright.config.ts --project=chromium-desktop --project=chromium-mobile`：T8 新增编辑器 E2E 后 `6 passed`。
- `pnpm --filter @langreport/web typecheck`：通过。
- `pnpm --filter @langreport/web test:typecheck`：通过。
- `pnpm --filter @langreport/contracts test`：22 个测试通过。
- `pnpm --filter @langreport/chart test`、`@langreport/data-engine test`、`@langreport/flint-adapter test`：通过。
- `pnpm --filter @langreport/generation-worker test:typecheck`：通过。
- Generation Worker + Render Worker 集成测试：通过，验证编辑 Job 生成父子 Revision。
- 本地 PostgreSQL 已应用 `0020_project_onboarding`，`pnpm --filter @langreport/db db:verify`：通过。
- `git diff --check`：通过。

## 已确认决策

- 保留第一阶段咨询项目报告边界，不扩展为 Dashboard 或实时协作。
- T7 使用最小兼容 API/数据库字段扩展；T8 沿用现有 Generation Job、TransformPlan 和 Chart Revision，不新增业务实体。
- 编辑逻辑只允许 JSON-only TransformPlan 白名单操作；Worker 基于来源 Revision 的同一 Snapshot 重算，失败不产生 Revision。
- 注释、数值标签和图例属于 Flint Spec display 字段，通过编辑 Job 追加版本。
- 审核状态由现有 Chart Revision 状态机决定；Approved 仍只读。
- E2E 使用专用 `.next-e2e`，本地开发服务可以继续运行在 3000。
- 移动端审核以底部 Review 面板为主操作路径。

## 已知问题与未决问题

- Theme token 编辑和 HTML/固定 Revision 导出状态尚未完成，列入 T9。
- 还没有人工截图级视觉验收记录。

## 新会话启动必读

1. [AGENTS.md](../../../AGENTS.md)
2. [CONTEXT.md](../../../CONTEXT.md)
3. [docs/project-spec.md](../../project-spec.md)
4. [docs/product/phase1-consulting-report.md](../../product/phase1-consulting-report.md)
5. [DESIGN.md](../../../DESIGN.md)
6. [proposal.md](./proposal.md)
7. [design.md](./design.md)
8. [task.md](./task.md)
9. [acceptance.md](./acceptance.md)

启动后先执行 `git status --short`，确认没有新的用户修改；然后从 T9 开始，不重复 T1-T8。
