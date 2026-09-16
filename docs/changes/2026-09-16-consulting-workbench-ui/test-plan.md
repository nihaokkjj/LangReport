# 咨询项目证据工作台 UI 与交互改造：测试计划

- 变更编号：`CHG-2026-09-16-CONSULTING-WORKBENCH-UI`
- 状态：`VERIFYING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 测试范围

验证本轮 Workbench 的状态驱动交互、普通消息发送、生成审核闭环、桌面/移动布局以及 E2E 服务隔离。T7 API/数据库和 T8 编辑 Worker 属于本次继续实施范围；仍不引入通用 BI 查询或实时数据源。

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| 普通消息响应没有 `message` 字段 | E2E 回归 | `generate=false` 提交问题 | 消息列表正常更新，不产生 PageError |
| 生成路径被普通消息兼容逻辑破坏 | E2E | CSV → Metric → Brief → Generation | Evidence Block、审核和导出成功 |
| 移动审核面板遮挡画布操作 | 响应式 E2E | 390px 审核并批准 | 使用面板按钮完成批准 |
| 桌面交互布局被覆盖 | 响应式 E2E/人工 | 1440px 审核 | 使用画布按钮或 Inspector 完成审核 |
| 本地开发服务持有 `.next` 锁 | 测试基础设施 | 3000 已运行时启动 E2E | E2E 使用 `.next-e2e`，3100 独立启动 |
| UI 状态缺少错误反馈 | 人工/DOM | API 错误、Generation failed、澄清 | 有可解释的 alert/status 和下一步动作 |
| Project onboarding 字段丢失或绕过合同 | API 契约/类型检查 | 创建请求包含客户、目标、受众和 Visual Template；缺字段或非法模板 | 合同拒绝不完整输入，Project DTO 和列表响应包含完整字段 |
| 编辑逻辑没有回溯来源快照 | contracts/domain/worker 集成 | 编辑 Patch 携带聚合、筛选或排序 | Worker 重算 TransformPlan 和血缘，成功后只追加子 Revision |
| 显示编辑覆盖历史版本 | 领域/API/E2E | 修改标题、注释、标签或图例 | 来源 Revision 不变，生成新的 Draft Revision；Approved 版本只读 |

## 测试数据与环境

- Playwright fixture：`apps/web/test/e2e/consulting-report.spec.ts`。
- 浏览器：Chromium desktop 1440×900、mobile 390×844。
- API 请求由 `page.route("**/api/**")` 拦截，不需要真实模型凭据。
- E2E Next 输出目录：`apps/web/.next-e2e`，运行后应清理且不提交。

## 自动化测试

```text
pnpm --filter @langreport/contracts test
pnpm --filter @langreport/chart test
pnpm --filter @langreport/data-engine test
pnpm --filter @langreport/api typecheck
pnpm --filter @langreport/generation-worker typecheck
pnpm --filter @langreport/web typecheck
pnpm --filter @langreport/web exec playwright test -c playwright.config.ts --project=chromium-desktop --project=chromium-mobile
pnpm --filter @langreport/web test:typecheck
git diff --check
```

本轮已执行：桌面/移动核心链路、普通发送回归和 T8 编辑器用例共 6 个测试通过；Contracts 22 个测试、Chart/Data Engine/Flint Adapter 测试、Generation/Render Worker 集成、API/Web/Worker 类型检查、数据库迁移验证和 diff 检查均通过。具体证据见 [acceptance.md](./acceptance.md)。

## 人工验收步骤

1. 在 3000 端口运行本地开发服务。
2. 打开工作台，确认可以在未完成 Brief 时提交问题，且通知显示“问题已记录”。
3. 导入示例 CSV，确认指标、Brief 后生成 Evidence Block。
4. 在桌面端打开审核 Inspector，检查来源、口径、校验、评论和操作。
5. 缩放到移动宽度，确认审核底部面板的按钮有足够触控区域，且批准后显示只读。
6. 检查空态、加载态、错误态、澄清态和 Composer 不遮挡画布。

## 不测试的内容及原因

- Theme token 和 HTML 导出：列入 T9；复杂 BI 查询、跨文件 Join 和实时数据仍不在第一阶段。
- 真实模型和 Worker 失败恢复：不依赖真实模型凭据，失败恢复沿用既有边界；本轮已覆盖 T8 成功编辑的 Generation/Render Worker 集成路径。
- 视觉像素级截图回归：当前先完成 DOM/交互回归，人工验收后再决定是否增加截图基线。
