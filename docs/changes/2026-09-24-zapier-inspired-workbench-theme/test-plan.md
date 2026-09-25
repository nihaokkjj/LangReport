# Zapier-inspired 暖色工作台视觉迁移：Test Plan

- 变更编号：`CHG-2026-09-24-zapier-inspired-workbench-theme`
- 状态：`VERIFYING`
- 负责人：LangReport owner agent
- 创建时间：2026-09-24
- 更新时间：2026-09-24

## 测试范围

验证暖色设计迁移不会破坏 LangReport 的咨询项目报告工作台、证据追溯、审核状态、图表预览和固定 Revision 导出；同时验证 Web 与 Flint 输出的默认视觉保持一致。

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| 只改规范未改运行时 | 文档审查 + UI | 检查 CSS、交互图表和 Flint 入口 | 规范与实现入口一一对应 |
| 暖色迁移误伤工作台结构 | Web typecheck/E2E + 人工 | Project、Conversation、Brief、Data、Evidence、抽屉 | 信息架构和 API 行为不变 |
| 橙色按钮文字对比度不足 | 可访问性/人工 | 主按钮、hover、disabled、focus | 普通按钮文字满足 AA，焦点始终可见 |
| 状态语义被品牌橙色覆盖 | 状态回归 | success、warning、danger、in_review、approved、changes_requested | 有文字和语义色，不依赖单一颜色 |
| 交互预览与导出漂移 | Flint unit + 人工比对 | 同一 Flint Spec 的 Web SVG 与 SVG/PNG/HTML | 默认字体角色和主色一致 |
| 自定义 Theme 被默认色板覆盖 | Flint unit/integration | `themeConfig` 单色覆盖与默认主题 | 显式自定义覆盖优先级保持不变 |
| 历史 Revision 被重写 | 领域/回归 | 已有 Draft/Approved Revision 查看与导出 | 历史内容不可变，新版本才使用新默认样式 |
| 响应式布局溢出 | 人工/Playwright | 1440px、1024px、760px、390px | 桌面/平板打开历史或依据抽屉时中心画布变窄；移动端使用底部 sheet；抽屉、表单、中文长文和图表不横向截断 |
| 现有 dirty diff 被覆盖 | Git/范围审查 | 实现前后比较 dirty files 和变更文件 | 登录网关/抽屉修改保持原意，不误删 |

## 测试数据与环境

- 使用现有第一阶段测试 Project、Data Snapshot、Evidence Block 和 Revision fixture；不新增业务数据模型。
- 使用同一 Flint Spec 分别生成交互预览和固定导出，记录 renderer version、theme 和 themeVersion。
- 使用桌面与 390px 移动 viewport；必要时补充 1024px 和 760px 断点。
- 不下载或依赖 Degular Display；断言当前环境使用 Inter fallback 时仍满足层级和可读性。
- 生产 HTTPS 登录 smoke 不属于本变更，继续遵守 `CHG-2026-09-22-login-gateway` 的用户决定。

## 自动化测试

规格/格式：

```text
pnpm docs:check
git diff --check
```

Web：

```text
pnpm --filter @langreport/web typecheck
pnpm --filter @langreport/web test:typecheck
pnpm --filter @langreport/web test
pnpm --filter @langreport/web test:e2e
```

Flint/全量回归：

```text
pnpm --filter @langreport/flint-adapter test
pnpm --filter @langreport/flint-adapter typecheck
pnpm typecheck
pnpm test
pnpm build
```

必要时执行已有的 `pnpm phase1:smoke`，证明主题迁移没有改变完整业务闭环；不把它当作视觉截图证据的替代品。

## 当前执行结果

- 通过：`pnpm docs:check`、`git diff --check`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- 通过：Flint 单测（9/9）、Flint 类型检查、Web 单测（24/24）、Web 类型/测试类型检查、API 类型检查。
- Playwright：在 1440px、1024px、760px、390px 四个 viewport 运行 44 项，40 项通过，4 项 `auth-live` 按既有真实 HTTPS/Cookie 决策跳过；工作台数据导入、快照预览、抽屉 resize、生成、Review、Approved、导出和图表编辑均通过。
- 为适配已批准的右侧依据抽屉行为，E2E 已改为显式打开/关闭抽屉并在关闭预览后断言返回依据上下文；未回退产品结构。
- 响应式专项断言已确认 1440px 桌面和 1024px 平板打开历史/依据抽屉时 `.workspace-main` 宽度收缩；760px/390px 继续使用底部 sheet。
- T6 验证报告：`test-report.md` 已建立，结论为 `TEST_PASSED_WITH_LIMITATION`。当前环境没有独立验证角色，主 Agent 按本计划对当前合并工作树执行只读复核；这一限制、既有 dirty diff 和 4 项跳过项均已记录。

## 人工验收步骤

1. 打开工作台，确认画布为暖奶油色，主要文字为咖啡色，主操作为橙色，蓝色不再作为默认装饰色。
2. 创建/切换 Project、Conversation，打开 Brief、Data、Evidence、历史抽屉和依据抽屉，确认信息架构和交互不变。
3. 分别查看空态、加载态、澄清态、失败态、Evidence、In Review、Approved 和 Changes Requested。
4. 检查输入框、主按钮、次按钮、图标按钮、关闭按钮的尺寸、圆角、hover、active 和键盘焦点。
5. 以 1440px、1024px、760px、390px 检查长中文、长 ID、表格、图表和抽屉，不允许横向截断。
6. 对同一个生成结果分别查看浏览器图表、SVG、PNG 和静态 HTML，确认默认色板和字体角色一致。
7. 使用显式自定义 Theme 生成一次结果，确认自定义图表颜色仍覆盖默认色板。
8. 查看旧 Revision 和 Approved Revision，确认它们仍可读、可导出且不可被主题迁移直接覆盖。

## 不测试的内容及原因

- 营销 Landing Page、Pricing、Footer 和产品选择器：明确不在本次工作台变更范围。
- Degular Display 的像素级还原：当前没有授权字体资源。
- API、认证、数据库和权限新行为：本变更不修改这些合同；只执行相关回归以证明无副作用。
- 真实 HTTPS Secure Cookie：由登录网关变更按用户要求跳过，不在本变更重新声明已验收。
