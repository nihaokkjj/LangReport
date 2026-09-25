# Zapier-inspired 暖色工作台视觉迁移：Test Report

- 变更编号：`CHG-2026-09-24-zapier-inspired-workbench-theme`
- 报告状态：`TEST_PASSED_WITH_LIMITATION`
- 执行日期：2026-09-24
- 执行角色：LangReport 主 Agent（只读复核）
- 代码提交：本次变更提交；验证针对提交前工作树快照执行

## 验证角色与快照边界

本环境没有可用的独立验证 Agent、隔离 worktree 或隔离分支工具，因此本报告不是独立角色出具的报告。主 Agent 按同一份 `test-plan.md` 对当前工作树执行了只读验证；验证期间没有因测试失败修改业务代码。该限制会保留到最终用户验收，不降低测试结果的事实记录，也不将本报告标记为独立验收。

当前工作树同时包含既有 `CHG-2026-09-22-login-gateway` 的未提交修改，包括登录、抽屉及相关文档文件。本变更保留这些 dirty diff，未执行 reset、checkout、清理或提交；因此测试结果表示“当前合并工作树”的结果，不是一个只包含本变更的干净提交结果。

## 自动化结果

| 检查 | 结果 | 证据摘要 |
| --- | --- | --- |
| `pnpm docs:check` | PASS | 变更文档结构、状态和必需字段通过检查 |
| `git diff --check` | PASS | 无 whitespace/error；Git 的全局 ignore 文件权限 warning 不影响退出码 |
| `pnpm --filter @langreport/flint-adapter test` | PASS | Flint 单测 9/9 |
| `pnpm --filter @langreport/flint-adapter typecheck` | PASS | Flint 类型检查通过 |
| `pnpm --filter @langreport/web typecheck` | PASS | Web 应用类型检查通过 |
| `pnpm --filter @langreport/web test:typecheck` | PASS | Web 测试类型检查通过 |
| `pnpm --filter @langreport/web test` | PASS | Web 单测 24/24 |
| API 类型检查 | PASS | API 类型检查通过 |
| `pnpm typecheck` | PASS | 全工作区 17 个项目的源码与测试类型检查通过 |
| `pnpm test` | PASS | 全量离线测试通过 |
| `pnpm build` | PASS | 全工作区构建、Next.js 编译和静态生成通过 |
| `pnpm --filter @langreport/web test:e2e` | PASS WITH SKIP | 4 个 viewport 共 44 项：40 项通过、4 项 `auth-live` 跳过 |

## E2E 覆盖

Playwright 使用 1440px、1024px、760px、390px 四个 viewport。已通过的路径覆盖：

- 工作台加载、项目/会话、数据导入和快照更新；
- Brief、Data、Evidence、历史、右侧依据抽屉及抽屉 resize；
- 文件预览打开/关闭后回到依据上下文；
- 生成、Review、Approved、导出和图表编辑；
- 登录入口与 API Console 的现有回归路径。

E2E 断言已按当前批准的右侧抽屉行为显式打开/关闭上下文，并未回退产品结构或业务行为。

## 主题迁移专项证据

- Web 默认令牌已切换为暖奶油画布、咖啡色文字、橙色主操作、暖灰边框，并保留 success/warning/danger 等语义色。
- 交互图表和 Flint 默认图表使用同一组橙色/暖灰/成功绿色板；Flint 默认输出版本为 `vega-lite-svg-v2`。
- Degular Display 仅作为 display fallback，未引入未授权字体文件；当前环境不可用时回退 Inter。
- Flint 显式自定义 Theme 的覆盖优先级保持不变；历史数据库默认值和已有 Revision 不迁移、不重写。
- 未修改 API HTTP 合同、数据库结构、权限、Generation Cycle、Review 状态或 Visual Template 持久化合同。

## 跳过项与限制

- 4 项 `auth-live.spec.ts` 在四个 viewport 各跳过 1 项。它们依赖真实 HTTPS/Secure Cookie 环境，按用户对 `CHG-2026-09-22-login-gateway` 的既有决定跳过；本报告不声明生产 HTTPS 登录已验证。
- 1024px/760px 已有自动化断点覆盖，但人工视觉清单尚未由用户完成；本报告不把自动化通过等同于人工视觉验收。
- 没有独立验证角色或隔离快照，因此需由用户完成最终验收，之后才能把变更从 `VERIFYING/PARTIAL` 推进为 `ACCEPTED`。

## 结论

在当前合并工作树上，已执行的自动化检查全部通过；唯一跳过项是按既有决策排除的真实 HTTPS 登录 smoke。没有发现本变更相关的 P0/P1 缺陷。结论为 `TEST_PASSED_WITH_LIMITATION`：测试门禁通过，但独立验证、人工视觉验收和用户最终确认仍未完成。

## T7 前的按钮状态微调

在本报告建立后，根据用户反馈将主按钮按下态背景调整为更浅的 `#ff7a45`，次按钮按下态调整为 `accent-soft`；随后进一步将 `生成证据` composer action 的按下态单独调整为 `#ff9873`。同步更新了根 `DESIGN.md` 和本变更 `design.md`。该 CSS/组件微调已重新通过 `pnpm docs:check`、`git diff --check` 和 `pnpm --filter @langreport/web typecheck`；此前的四断点 E2E 结果仍为本变更基线，按钮颜色的最终观感留给 T7 人工视觉验收确认。

随后根据用户反馈调整响应式抽屉布局：761–1240px 时历史/依据抽屉改为工作区 grid 列，打开时压缩 `.workspace-main`；760px 及以下仍保持底部 sheet。布局专项新增的 Playwright 主画布宽度收缩断言已在 1440px 和 1024px 通过；完整四断点 E2E 最终为 44 项中的 40 项通过、4 项既有 `auth-live` 跳过。

最后按用户反馈压缩 Snapshot 版本列表面板（`snapshot-preview-modal.tsx` 第 167 行对应的 `snapshot-version-panel`），并进一步压缩“查看数据”标题栏，同时将 `evidence-context-rail.tsx` 第 53 行的 `context-header` 统一为相同的 57px 高度，保留关闭按钮的 44px 触控尺寸。Snapshot 预览专项 E2E 四断点 4/4 通过，并新增标题栏高度一致性断言；完整四断点矩阵的 40/44 基线仍有效，未因该 CSS-only 微调重新执行全量矩阵。
