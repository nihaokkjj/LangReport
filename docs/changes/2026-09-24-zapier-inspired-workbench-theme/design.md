# Zapier-inspired 暖色工作台视觉迁移：Design

- 变更编号：`CHG-2026-09-24-zapier-inspired-workbench-theme`
- 状态：`VERIFYING`
- 负责人：LangReport owner agent
- 创建时间：2026-09-24
- 更新时间：2026-09-24

## 现状与约束

- 根 [DESIGN.md](../../../DESIGN.md) 是 Web 视觉系统的人工规范，但当前没有自动解析器或 token 生成器。
- [apps/web/app/globals.css](../../../apps/web/app/globals.css) 维护 CSS 变量和绝大多数工作台样式。
- `apps/web/app/(protected)/page.tsx` 内嵌了交互图表默认色板。
- [packages/flint-adapter/src/index.ts](../../../packages/flint-adapter/src/index.ts) 维护确定性图表字体、色板和静态 HTML 包装页样式。
- `Visual Template` 是 Project 的版本化输出规范，不等同于产品 Chrome；本变更不修改既有模板 ID、Project 数据或 Revision 历史。
- 当前根 `DESIGN.md`、`globals.css` 和 `page.tsx` 已有登录网关/工作台变更的未提交修改，必须保留并在实现前重新核对。
- Web 本地规则要求保留 API 和数据行为，并在 UI 变更后运行 `pnpm --filter @langreport/web typecheck`。

## 设计目标与非目标

### 目标

- 把品牌温度从冷白/蓝灰迁移到暖奶油/咖啡黑/橙色。
- 以工作台信息架构为主：中心 Evidence 画布、历史抽屉、依据抽屉和审计信息保持原有关系。
- 桌面和平板打开历史/依据抽屉时，抽屉占用工作区 grid 列并压缩中心画布；移动端继续使用底部 sheet，避免窄屏横向挤压。
- 通过共享的语义令牌和渲染器常量，减少交互预览与固定导出的视觉漂移。
- 保留语义成功、警告、错误状态和可访问性要求。

### 非目标

- 不实现营销页 Hero、Pricing、Footer、产品选择器或购物车等用户提供文本中的示例组件。
- 不把所有 Project Visual Template 强行改名或改成 Zapier 风格。
- 不改变 HTTP、数据库、权限、生成状态、Review 状态或导出文件合同。

## 方案选型

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 只替换 `DESIGN.md` | 风险最低 | 页面、图表和导出完全不变，规范与实现脱节 | 不采用 |
| 直接复制用户文本 | 视觉方向明确 | 会把营销官网组件和规则带入工作台，丢失证据/状态约束 | 不采用 |
| 工作台适配式主题迁移 | 保留产品语义，能同步 Web 与导出，改动可回滚 | 需要维护 CSS、预览和 Flint 的一致性 | 采用 |

## 视觉令牌适配

### 基础令牌

| 语义 | 目标值 | 使用 |
| --- | --- | --- |
| `canvas` | `#fffefb` | 页面、输入和主内容表面 |
| `surface` | `#f8f4f0` | 工作区、抽屉和分组内容 |
| `ink` | `#201515` | 标题、正文、图标和主要边界 |
| `body` | `#605d52` | 正文及一般说明 |
| `body-mid` | `#939084` | 辅助信息和低优先级元数据 |
| `mute` | `#c5c0b1` | 分隔线、低强调边界 |
| `primary` / `accent` | `#ff4f00` | 主行动、选中和焦点关联动作 |
| `primary-active` | `#ff7a45` | 主按钮按下/活跃状态的浅橙背景 |
| `primary-generate-active` | `#ff9873` | `生成证据` 按钮按下/活跃状态的更浅橙背景 |
| `on-primary` | `#201515` | 橙色按钮文字；相对用户文本中的奶油色做对比度适配 |

### 保留的工作台扩展

- `success`、`warning`、`danger` 及对应 soft surface 继续作为状态令牌，避免把审核和数据质量状态混成品牌橙色。
- `accent-soft` 使用暖橙浅底，用于选中/hover/focus 关联区域和次按钮按下状态；不能演变成装饰性渐变。
- `border`、`border-soft`、`overlay` 和滚动条令牌使用咖啡色系派生值，并在实现时集中定义，不在组件中散落硬编码。
- `font-display` 声明 `Degular Display` 优先、`Inter` fallback；当前没有 Degular 文件，因此不把字体加载视为本次完成条件。

### 组件映射

| 用户文本组件 | LangReport 适配 |
| --- | --- |
| `button-primary` | 橙色主行动按钮，最小高度 44px，12px 圆角 |
| `button-secondary` | 奶油画布 + 咖啡色边界的次行动按钮 |
| `button-tertiary` / `button-text` | 工作台次级操作，不引入营销 CTA 层级 |
| `text-input` | 奶油输入框，6px 圆角，至少 48px 高 |
| `card-content` | Evidence、Trace、项目资料等工作台面板 |
| `hero-band` / `content-band` | 不直接实现；工作台使用中心画布和抽屉布局 |
| `pricing-card` / `footer` | 不在本变更范围 |
| `badge-pill` | 保留给状态/元数据，但状态始终包含可读文字 |

## 模块边界

### 需要修改

1. `DESIGN.md`：合并暖色品牌令牌与工作台规则。
2. `apps/web/app/globals.css`：更新 root 令牌、按钮/输入/面板/抽屉/状态的消费方式。
3. `apps/web/app/(protected)/page.tsx`：交互图表默认色板与新的渲染器默认色板对齐。
4. `packages/flint-adapter/src/index.ts`：更新默认字体、默认图表颜色和静态 HTML 视觉包装。
5. `packages/flint-adapter/test/unit/index.test.ts` 及必要的 Web 视觉/行为测试：更新并扩展断言。
6. `apps/api/src/routes.ts`、`apps/api/src/chart-routes.ts`：同步内部 `RENDERER_VERSION` 标识；不改变 HTTP 路由或请求/响应结构。

### 明确不修改

- API 的 HTTP 路由逻辑与请求/响应合同、`packages/contracts`、数据库 Schema、认证和权限代码；仅允许同步内部渲染器版本标识。
- Project、Visual Template、Chart Revision 的持久化结构和状态机。
- 历史导出文件和已批准 Revision 的不可变内容。
- 用户提供文本中不属于工作台的营销页面组件。

## 数据模型与状态流转

- 不新增数据库字段或领域实体。
- 新生成的 Chart Revision 继续保存已有的 Visual Template/Theme 快照；默认图表色板变化只影响新生成的渲染产物。
- 已存在的 Draft、In Review、Approved、Changes Requested 和 Archived Revision 不被重写。
- 如果默认 Flint 输出确实变化，渲染器版本标识应升级，避免将新旧确定性输出误认为同一渲染版本；具体常量变更列入 T4。

## API / 外部契约

- 不新增或修改 HTTP 路由、请求/响应、OpenAPI、Cookie、认证和 API Console。
- SVG、PNG、静态 HTML 和 Vega-Lite JSON 的文件合同保持不变；仅允许视觉内容在默认主题下变化。
- 自定义 Project Theme/Plugin Theme 的覆盖优先级保持不变。

## 架构图

```text
用户提供的暖色设计方向
            │
            ▼
  根 DESIGN.md（品牌 + 工作台约束）
       ┌────┴───────────────┐
       ▼                    ▼
 Web CSS tokens        Flint adapter constants
       │                    │
       ▼                    ▼
工作台/交互预览       SVG/PNG/静态 HTML 导出
       └──────────┬─────────┘
                  ▼
       同一默认字体、色板和状态语义

Project Visual Template / Plugin Theme ──► 仅按已有显式覆盖规则覆盖图表主题
```

失败路径：如果对比度、移动端布局、渲染器输出或既有状态表现不通过，停留在 `VERIFYING`，不将变更标记为 `ACCEPTED`，也不修改历史 Revision。

## 数据流

1. 读取 `DESIGN.md` 形成实现约束；运行时不解析 Markdown，而是由 CSS 与 Flint 常量显式落地。
2. Web 使用 CSS root token 渲染顶栏、画布、抽屉、表单、Evidence、Review 和 utility 页面。
3. Web 交互图表读取 Flint Spec，使用与 Flint 默认色板一致的本地常量生成 SVG 预览。
4. Render Worker 通过 Flint adapter 生成 Vega-Lite、SVG、PNG 和静态 HTML；自定义 Theme 仍在既有边界内覆盖默认色板。
5. Revision 继续保存原有主题版本、校验和输出对象，不因主题迁移改变来源或审核关系。

## 权限、校验与异常处理

- 不改变认证和权限；主题迁移后未登录、无权 Project、失效 Revision 的处理必须保持原行为。
- 普通正文、按钮和错误说明使用满足 WCAG AA 的对比度；橙色按钮默认使用咖啡色文字。
- 焦点环保持可见，不以颜色作为唯一状态信号；状态徽章必须带文字。
- 长中文、长 ID、空态、加载态、失败态和 Approved 只读态必须允许换行或滚动，不通过缩小至 10px 以下解决溢出。
- 图表预览和导出默认色板不一致时，视为验证失败；不能通过隐藏图表或绕过校验解决。

## 迁移、兼容与回滚

- 迁移不涉及数据库结构或 API 合同；仅同步内部渲染器版本标识，旧 Revision 不迁移、不重渲染。
- 本次已将未来生成路径的内部渲染器标识升级为 `vega-lite-svg-v2`；数据库历史默认值和已有 Job/Revision 保留 `v1`，不做追溯迁移。
- 在实现前保存并保护当前登录网关变更的工作树修改；只在明确范围内编辑重叠文件。
- 回滚顺序为：恢复 Flint 默认主题 → 恢复交互预览色板 → 恢复 CSS root/组件样式 → 恢复 `DESIGN.md`，不删除任何数据。
- 如果 Flint 默认输出版本需要升级，只升级未来生成路径，不追溯修改已有 Revision。
- 若后续要提供完整 Zapier 风格报告模板，应新建版本化 Visual Template，不在本次迁移中覆写 `consulting-neutral`、`consulting-insight` 或 `consulting-research`。

## 日志、监控与可观测性

- 不新增业务日志或敏感信息。
- 记录验证时使用的工作树快照、渲染器版本和默认色板断言，便于区分视觉回归与业务回归。
- 视觉失败保留截图/渲染产物和失败用例，不将人工未检查状态写成通过。

## 测试策略

- 设计文档与链接：`pnpm docs:check`、`git diff --check`。
- Web：`pnpm --filter @langreport/web typecheck`、`test:typecheck`，必要时运行 Web E2E。
- Flint：默认色板、字体、静态 HTML、SVG/PNG 产物和自定义 Theme 覆盖单测。
- 人工视觉：至少 1440px、1024px、760px、390px；检查工作台空/加载/错误/证据/Review/Approved、抽屉和文件预览。
- 一致性：同一个 Flint Spec 比较浏览器预览与静态导出的颜色、字体角色和基本层级。

## 需求追踪矩阵

| 需求 | 设计 | 任务 | 测试 | commit |
| --- | --- | --- | --- | --- |
| R1 混合设计规范 | 视觉令牌、组件映射 | T1 | docs-check、人工文档审查 | 待定 |
| R2 Web 暖色工作台 | 模块边界、Web CSS 数据流 | T3 | Web typecheck、E2E、人工视觉 | 待定 |
| R3 保留工作台语义 | 非目标、组件映射、异常 | T3/T5 | 状态回归、移动端检查 | 待定 |
| R4 图表/导出一致 | 架构图、数据流、兼容 | T4 | Flint unit、预览/导出比对 | 待定 |
| R5 不改业务合同 | API、数据模型、迁移 | T0/T3/T4 | contracts/API 回归、全量 typecheck | 待定 |
| R6 可验收迁移 | 测试策略、失败路径 | T5/T6 | test-plan 全部命令和人工证据 | 待定 |
