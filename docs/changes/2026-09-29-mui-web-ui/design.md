# Material UI 全站组件规范化：Design

- 变更编号：`CHG-2026-09-29-mui-web-ui`
- 状态：`VERIFYING`（设计获批；实现、自动化回归、独立复核与性能对照完成，用户体验验收待记录）
- 创建时间：2026-09-29
- 更新时间：2026-09-29

## 现状与约束

- 物理产品仓库：`D:\front\newProject\LangReport`；2026-09-29 主工作树 HEAD 为 `75e83b09da02b47727accd5071f9dad16a7569eb`，含登录/工作台等既有未提交修改。记忆 A/GA 候选在独立分支。T0 冻结实施快照后才可修改 Web 源码。
- `apps/web` 使用 Next.js 16.3.3、React 19.2.8、CSS Modules 和 `globals.css`；现有通用依赖只有 React Query，没有 MUI。根 `app/layout.tsx` 组合 `QueryProvider`，受保护路由由 `AuthGate` 包裹。
- [DESIGN.md](../../../DESIGN.md) 是 Web 视觉权威：暖色画布、咖啡色文字、橙色主操作、Inter/mono 字体、4px 间距基数、按钮至少 44px、输入至少 48px、按钮 12px 与输入 6px 圆角、可见焦点、四个响应断点。
- [ADR-0023](../../adr/0023-center-first-evidence-drawers.md) 固定中心 Evidence 画布、可并行的左右抽屉、右侧 300–560px 会话内调宽和 Snapshot 原位预览；通用库迁移必须保留这些行为。
- `Project Visual Template` 与插件 `Theme` 决定图表和导出的版本化视觉，不等于 Web UI 主题。Flint 输出和 Approved Revision 不随本次组件迁移重写。

## 设计目标

用户在每个 Web 页面看到同一套通用控件，状态反馈、键盘行为和触控目标一致。采用用户已选择的带样式库 Material UI Core，直接使用 MUI 基础组件和主题；仅为产品独有的布局、图表和证据组合保留自定义组件。

## 方案选型与依据

| 方案                    | 优点                                      | 代价                                    | 结论                                                                            |
| ----------------------- | ----------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| 继续各页面 CSS 实现     | 无安装成本                                | 同类控件重复且状态不一致                | 不采用                                                                          |
| 无样式库 + 自有通用控件 | 行为可复用                                | 仍要自建带样式组件体系                  | 用户未选择                                                                      |
| Material UI Core v9     | 带样式控件、主题与状态体系，支持 React 19 | App Router 样式集成、CSS 和组件迁移量大 | 采用；[ADR-0030](../../adr/0030-material-ui-web-component-foundation.md) 待审核 |

官方资料：[v9 稳定版](https://mui.com/material-ui/getting-started/versions/)、[React 19 peer 支持与安装](https://mui.com/material-ui/getting-started/installation/)、[Next.js App Router 集成](https://mui.com/material-ui/integrations/nextjs/)、[CSS 主题变量](https://mui.com/material-ui/customization/css-theme-variables/usage/)。此处只记录 2026-09-29 核查结果；安装时以锁定的实际包版本和导出表复核。

## 模块边界与组件映射

| 位置                                     | 通用控件迁移                                                                                                    | 保留的产品组合                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `app/layout.tsx`、主题目录               | `AppRouterCacheProvider`、`ThemeProvider`、`CssBaseline` 和主题变量                                             | 根布局与 QueryProvider/AuthGate 所有权不变                                 |
| 登录与账号                               | `TextField`、`Button`、`Alert`、等待指示、链接样式                                                              | 现有表单校验、认证请求与账号动作                                           |
| 工作台、Project/Conversation             | `AppBar`/`Toolbar` 适用部分、`Button`、`IconButton`、`Menu` 或 `Select`、`Dialog`、`TextField`、`Alert`、`Chip` | Project/Conversation 选择与创建状态、Evidence 画布、双抽屉和 composer 布局 |
| Analysis Brief、Metric、图表编辑、Review | `TextField`、`Select`、`FormControl`、`Dialog`、`Button`、`Alert`、状态 `Chip`                                  | 表单业务字段、Revision 编辑/审核约束与 API 调用                            |
| Data Asset 与 Snapshot 预览              | `Button`、`IconButton`、`Paper`、适用的 `Table`/`TableContainer`                                                | 隐藏的原生 file input、Snapshot 历史/字段表与原位预览容器                  |
| 记忆与插件                               | `TextField`、`Select`、`Button`、`Alert`、`Dialog`、`Chip`、`Paper`                                             | Project Memory / User Preference、Manifest 操作的现有请求与版本控制        |
| API Console                              | `TextField`、`Button`、`Tabs`/`Accordion`（适用处）、`Alert`、`Table`、`Paper`                                  | OpenAPI 展示、请求示例、场景编排和实际请求语义                             |

本次的“全站”指现有路由的**通用可见控件**统一以 MUI 为基础。原生 `<input type="file">`、SVG 图表、证据专属布局和必须保持原生表格语义的部分有明确例外；T1 形成逐项盘点，T7 核对无遗漏。`components/feedback/alert-banner.tsx` 可改用 MUI `Alert`，但保留其 `tone/message/onDismiss` 与现有业务调用合同，或在同一切片中迁移调用点后移除，避免两套反馈层长期并存。

## 主题与样式所有权

1. `DESIGN.md` 仍是人工视觉规范。实施中新增 `apps/web/theme`（最终路径由 T2 集成切片确认），用 MUI `createTheme({ cssVariables: true })` 表达 `palette`、`typography`、`spacing`、`shape` 与 `components` 默认样式；主题是运行时唯一的通用控件视觉配置。
2. `primary.main=#ff4f00`、`primary.contrastText=#201515`；背景 `#fffefb/#f8f4f0`；文字 `#201515/#605d52`；语义成功、警告、错误继续使用现有令牌。字体采用 `DESIGN.md` 的 Inter 与 JetBrains Mono 回退栈，不引入默认 Roboto。MUI 默认蓝色、阴影和胶囊 CTA 不进入最终 UI。
3. MUI `components` override 固定 Button、IconButton、OutlinedInput/TextField、Select、Dialog、Menu、Alert、Chip 等通用组件的高度、圆角、焦点、按下、禁用和 pending 外观。状态不能仅由透明度或颜色表达；`prefers-reduced-motion` 关闭非必要动画。
4. 现有 `globals.css`/CSS Modules 在迁移期通过 MUI CSS 变量和语义别名过渡；每迁移一个页面就删除该页通用控件的重复规则。图表与产品布局 CSS 仍归各自拥有者。不能仅靠页面级 `!important` 覆盖 MUI 来伪装统一。
5. 主题层只影响 Web Chrome。交互图表与固定导出的字体/色板维持原有对齐合同；任何视觉令牌改动若实际影响 Flint 输出，须另行同步并验证。

## Next.js 16 / SSR 集成门

根布局顺序拟为 `AppRouterCacheProvider → ThemeProvider/CssBaseline → QueryProvider → 页面`，保持 `app/layout.tsx` 的服务端边界，主题提供器置于必要的客户端边界。MUI 官方推荐 App Router 样式缓存，并说明与 CSS Modules 共存时可开启 `enableCssLayer: true`。[官方源码目录](https://github.com/mui/material-ui/tree/master/packages/mui-material-nextjs/src)已有 `v16-appRouter`；仍须检查已安装版本的实际 exports。先做一个独立页面切片，验证服务端首屏、客户端导航、Dialog portal、CSS 优先级和 hydration。若 T2 失败，停下修订设计。

## 状态与数据流

```text
服务端根布局
  → MUI 样式缓存与主题 → 现有 QueryProvider/AuthGate → 页面

用户操作 MUI 控件
  → 既有页面/feature handler → apiFetch / React Query → 现有 API 授权与业务规则
  → pending：控件显示等待并阻止重复提交
  → success：使用统一 Alert/状态反馈，必要时刷新现有 Query
  → error：保留错误内容、字段与草稿，显示可恢复反馈
```

弹层和菜单的关闭、焦点回返、Esc、Tab 与屏幕阅读器语义由 MUI 组件承担，业务层仍决定何时可以提交或关闭。删除个人偏好和 Project Memory 的确认由受控 `Dialog` 取代 `window.confirm`；确认前明确对象与后果，取消不发请求，请求失败保留页面状态。API 返回的 Project 权限、Revision 状态和记忆版本仍是权威；前端禁用只提供可见反馈，不成为权限门。

## API、权限与异常

- 本变更无 HTTP 合同或数据库变化；`api-console` 只迁移 UI，不改 OpenAPI 请求示例或接口行为。
- 保留 401/403、版本冲突、生成失败、导出失败等现有错误处理与可见文案。MUI `Alert`/`FormHelperText` 映射展示，不吞掉错误或自动将失败视为成功。
- 不改变已批准 Revision 的只读约束。账号/记忆/插件的权限与冲突判定继续由 API 执行。
- 组件 mount/unmount 不改变 React Query key、Abort、status watcher 或生成状态机；切换 Project、Conversation、Revision 的旧请求处理按原实现回归。

## 迁移、兼容与回滚

T0 冻结目标代码快照并列出主工作树未提交 UI 修改与 A/GA 候选差异。迁移分“根集成 → 登录/账号/记忆 → 工作台与业务弹层 → 插件/API Console → 清理与全量验证”，每片保留可回退提交或工作树 diff；不得整文件覆盖用户修改。若技术门失败，先移除未投入使用的依赖和 provider；若单页回归，撤回该切片而不回退 API 或数据。所有切片通过后再删除旧通用 CSS，避免过渡期样式级联失控。

## 观测与测试策略

- T2 记录实际 MUI/Emotion/Next.js 版本、package exports、SSR 首屏和 hydration 控制台结果；记录四断点样式截图与对比。
- 对新控件建立鼠标、键盘、触屏路径和 `prefers-reduced-motion` 检查；重点覆盖删除确认、Project/Conversation 选择、Brief/Metric 提交、Review 和导出。
- 运行 Web typecheck/test:typecheck、相关离线测试与 E2E；独立验证角色从固定代码快照执行 [test-plan.md](./test-plan.md)。具体结果写入 `test-report.md` 和 [acceptance.md](./acceptance.md)。

## 需求追踪矩阵

| 需求            | 设计落点           | 任务   | 计划证据                        | commit                               |
| --------------- | ------------------ | ------ | ------------------------------- | ------------------------------------ |
| R1 全站通用控件 | 组件映射、例外清单 | T1–T7  | 控件盘点、页面 E2E、代码复核    | 已实施，独立复核通过                 |
| R2 视觉一致     | 主题与样式所有权   | T2–T7  | 四视口截图、对比度/尺寸检查     | 已实施，用户验收待记录               |
| R3 交互状态     | 状态与数据流       | T3–T7  | 键盘/触屏/失败态 E2E            | 已实施，完整人工验收待记录           |
| R4 业务不变     | API、权限与异常    | T3–T8  | 既有流程 E2E、Web 测试          | 模拟环境回归通过                     |
| R5 SSR 稳定     | Next.js 集成门     | T2、T8 | build、首屏/导航/hydration 记录 | build 与日志抽查通过，逐路由监听待补 |
