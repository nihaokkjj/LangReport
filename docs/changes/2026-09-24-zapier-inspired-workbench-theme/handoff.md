# Zapier-inspired 暖色工作台视觉迁移：Handoff

- 变更编号：`CHG-2026-09-24-zapier-inspired-workbench-theme`
- 状态：`VERIFYING`
- 负责人：LangReport owner agent
- 创建时间：2026-09-24
- 更新时间：2026-09-25

## 当前状态

已完成 Phase 0 只读侦察和 Phase 1 SDD。用户于 2026-09-24 回复“继续”，批准按 R4 同步迁移 Web 工作台、交互图表和固定导出；当前完成 Phase 2/3、T5 自动化验证和 T6 主 Agent 只读复核，进入最终 T7 用户验收阶段。

## 已完成

- 读取工作区、LangReport、Web 局部规则、产品规格、项目基线和当前登录网关变更记录。
- 确认根 `DESIGN.md` 不是运行时 token 解析源，实际视觉入口分布在 Web CSS、交互图表和 Flint adapter。
- 确认用户提供的 Zapier 文本包含营销官网组件，已拆出不适用于 LangReport 工作台的部分。
- 建立本变更的 proposal、design、task、test-plan 和初始 acceptance/handoff。

## 已完成的实现片段

- 根 `DESIGN.md` 已替换为暖色工作台适配规范，保留 Evidence-first、抽屉/预览和状态语义。
- `apps/web/app/globals.css` 已切换暖奶油/咖啡黑/橙色令牌，并更新按钮、标题、画布、抽屉和弹层的消费方式。
- Web 交互图表和 Flint 默认图表色板已对齐为橙色/暖灰/成功绿；静态 HTML 包装页同步暖色表面。
- Flint 默认输出版本已升级为 `vega-lite-svg-v2`；未来 API 生成路径同步使用 v2，历史数据库默认值与已有 Revision 保留不变。
- 桌面和平板的历史/依据抽屉打开时占用工作区 grid 列并压缩中心画布；移动端保持底部 sheet。

## 进行中

- T3/T4/T5 已完成；T6 已完成，但当前环境没有可用的独立验证角色，因此报告标记为 `TEST_PASSED_WITH_LIMITATION`。
- 当前 `CHG-2026-09-22-login-gateway` 仍处于 `VERIFYING/PARTIAL`；重叠文件必须保留其 dirty diff。

## 下一步

1. 用户按 `test-plan.md` 完成 1440/1024/760/390 的人工视觉检查，重点确认 1024px/760px 抽屉、长中文、图表和焦点态。
2. 用户确认 `test-report.md` 中 4 项 `auth-live` 跳过项和独立验证角色不可用的限制是否可接受。
3. 用户已确认提交 Git；本次提交后仍保持 `VERIFYING/PARTIAL`，待人工视觉验收后再推进为 `ACCEPTED`。

## 当前 commit 与修改范围

- 当前 commit：本次变更提交；用户现有工作树修改不属于本变更。
- 本变更修改范围包括 `DESIGN.md`、Web 样式/交互图表、Flint adapter/单测，以及 API 内部渲染器版本标识。
- 未修改数据库结构、认证、权限、业务状态机或历史 Revision；既有登录网关 dirty diff 继续保留。

## 已运行验证

- 已完成只读 `git status`、palette/font/Design 入口扫描和当前变更记录审查。
- `pnpm docs:check`、`git diff --check`、`pnpm typecheck`、`pnpm test`、`pnpm build` 通过。
- Flint 单测 9/9、Web 单测 24/24、Flint/Web/API 定向类型检查通过。
- Playwright 四断点共 44 项：40 项通过、4 项 `auth-live` 跳过。已覆盖 1440/1024/760/390 的工作台、抽屉、预览、生成、审核、导出、登录和 API Console。
- `test-report.md` 已建立，结论为 `TEST_PASSED_WITH_LIMITATION`；主 Agent 按 test-plan 只读复核，未发现本变更相关 P0/P1 缺陷。
- 最新完整 Playwright 回归为 44 项中的 40 项通过、4 项 `auth-live` 跳过；新增的桌面/平板主画布收缩断言通过。

## 已确认决策

- 采用“工作台适配式主题迁移”，不采用纯文档替换或营销官网重做。
- 保留 Evidence-first 信息架构、语义状态、Visual Template 版本边界和历史 Revision 不可变性。
- 默认按钮文字将优先使用咖啡色，以修复橙色背景上的普通字号对比度风险。
- 当前没有 Degular Display 字体资源，先使用 Inter fallback。

## 已知问题与未决问题

- `RENDERER_VERSION` 已按默认输出确实变化的判断升级为 `vega-lite-svg-v2`；数据库历史默认值保持 v1，需在验证中确认未来 API 生成路径均写入 v2。
- 当前环境没有可用的独立验证角色或隔离快照；主 Agent 已按同一 test-plan 完成只读复核，限制和证据记录在 `test-report.md`。真实 HTTPS smoke 继续由 `CHG-2026-09-22-login-gateway` 管理。

## 新会话启动必读

1. 根 `AGENTS.md`、`CONTEXT.md`、`README.md`、`.agents/manifest.json` 和 `docs/project-spec.md`。
2. 本目录的 proposal、design、task、test-plan、acceptance 和 handoff。
3. 根 `DESIGN.md`、`apps/web/AGENTS.md`、`apps/web/app/globals.css`、受保护工作台页面和 `packages/flint-adapter/src/index.ts`。
4. `CHG-2026-09-22-login-gateway` 的 proposal、design、task、test-plan、acceptance 和 handoff。
5. 最新 `git status` 和 `git diff`；不得覆盖既有未提交修改。
