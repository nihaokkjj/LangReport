# Zapier-inspired 暖色工作台视觉迁移：Proposal

- 变更编号：`CHG-2026-09-24-zapier-inspired-workbench-theme`
- 状态：`VERIFYING`
- 负责人：LangReport owner agent
- 创建时间：2026-09-24
- 更新时间：2026-09-24

## 背景

用户希望把 LangReport 当前偏冷的蓝灰色工作台视觉，迁移到用户提供的
`Zapier-Inspired-design-analysis` 暖奶油、咖啡黑和饱和橙视觉方向。

当前根目录 [DESIGN.md](../../../DESIGN.md) 仍以证据优先工作台为语义基础；运行时又在
[globals.css](../../../apps/web/app/globals.css)、交互图表和
[Flint adapter](../../../packages/flint-adapter/src/index.ts) 中分别复制了部分令牌。
因此本变更不是简单替换一个 Markdown 文件，而是一次保持业务行为不变的视觉系统迁移。

## 要解决的问题

1. 让 Web 工作台、交互图表和固定 Revision 导出使用同一套暖色视觉基础。
2. 保留 Evidence Block 的来源、口径、变换、主题、校验和审核状态层级。
3. 避免把营销官网的 Hero、Pricing、Footer 等组件直接带入咨询工作台。
4. 在使用橙色 CTA 的同时满足可读性、焦点可见性和状态语义要求。

## 目标用户与使用场景

- 咨询顾问：在工作台中上传数据、生成和修改 Evidence Block。
- 研究分析师：查看图表、发现、指标口径和字段血缘。
- Reviewer：在暖色视觉下检查状态、校验结果和固定 Revision 导出。

## 需求范围

### MVP

- R1：将根 `DESIGN.md` 改为“Zapier 暖色品牌方向 + LangReport 工作台约束”的混合规范。
- R2：Web 工作台使用暖奶油画布 `#fffefb`、软奶油表面 `#f8f4f0`、咖啡黑 `#201515`
  和橙色交互色 `#ff4f00`。
- R3：按钮、输入、Evidence 面板、抽屉、状态和焦点样式继续覆盖现有工作台状态，不能退化为营销页面。
- R4：交互图表预览与 Flint 的 SVG、PNG、静态 HTML 导出保持默认字体、颜色和层级一致。
- R5：保留现有 API、认证、Project、Conversation、Generation Cycle、Review、导出合同和
  `Visual Template` 领域边界。
- R6：完成桌面、平板、移动端、空态、加载态、失败态、Approved 只读态和导出一致性验证。

### 后续范围

- 获得合法的 `Degular Display` 字体资源并接入生产字体加载。
- 若产品需要客户报告图表也使用独立的暖色模板，新增版本化的 Project Visual Template；不在本次修改既有模板 ID。
- 独立的品牌资产、favicon、营销 Landing Page 和定价页面。

## 明确不做

- 不把 LangReport 工作台改造成 Zapier 风格营销官网。
- 不新增或修改 API、数据库表、认证边界、Workspace/Project 权限和 Generation Cycle 状态机。
- 不删除 `success`、`warning`、`danger` 等语义色；状态不能只依赖橙色或颜色本身。
- 不覆盖当前登录网关变更的未提交修改，不回写其验收结论。
- 不在没有字体授权和文件的情况下下载或捆绑 Degular Display。
- 不回写或重新生成历史 Approved Revision 的产物。

## 成功指标

- Web 工作台的主要画布、按钮、输入、抽屉和模态使用暖色令牌，旧蓝色仅在明确的语义或遗留项目主题中出现。
- 同一默认 Flint Spec 在浏览器交互预览和固定 Revision 导出中使用相同的默认字体和图表色板。
- 所有既有 API/Web 数据行为和 Revision 不变量保持不变。
- Web typecheck、Flint adapter 测试、相关 E2E、`pnpm docs:check` 和 `git diff --check` 通过。
- `#fffefb` 按钮文字不直接用于普通字号橙色按钮；默认橙色按钮采用满足对比度的咖啡色文字或等效调整。

## 假设、依赖与风险

- 本方案默认包含工作台 Chrome 与默认图表/导出色板的同步；如果只想换工作台 Chrome，应在审核时缩小 R4。
- `Degular Display` 在当前仓库没有字体文件，显示层先使用 `Inter` fallback，不能宣称已完成原字体还原。
- 用户提供的 `#ff4f00` + `#fffefb` 对比度约为 `3.27:1`，不满足普通按钮文字的 WCAG AA；此处需要记录为有意的语义适配。
- 当前工作树已有登录网关、工作台抽屉及根 `DESIGN.md` 的未提交修改；实现前必须重新确认重叠文件范围。
- 默认渲染色板变化会影响新生成的渲染产物，但不会覆盖历史 Chart Revision；必要时升级渲染器版本标识。

## 未决问题

无。用户于 2026-09-24 回复“继续”，批准进入 Phase 2，并确认默认图表/固定导出同步迁移；现有未提交修改继续保留，不执行重置或覆盖。

## 审核结论

- 结论：`APPROVED`
- 审核时间：2026-09-24
- 审核意见：按工作台适配式主题迁移执行，不改 API、数据模型、权限和历史 Revision；橙色 CTA 使用满足对比度的咖啡色文字。
- 遗留问题：Degular Display 字体资源仍未提供，继续使用 Inter fallback；登录网关的真实 HTTPS 风险仍由原变更管理。

## 验收标准概要

1. 根设计规范明确区分品牌令牌、工作台组件、语义状态和 Project Visual Template。
2. Web 工作台主要页面和 utility 页面在桌面与移动宽度使用暖色令牌，信息架构不变。
3. 图表交互预览、SVG/PNG/静态 HTML 默认输出的字体和颜色一致；自定义 Theme 仍可覆盖默认图表色板。
4. 空态、加载、错误、澄清、Review、Approved、文件预览和认证入口均可读、可操作且焦点可见。
5. 所有自动化检查和人工视觉验收有可复现记录；历史 Revision、API 和业务权限没有回归。
