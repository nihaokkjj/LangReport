# Web 工作台认证感知架构重构：Design

- 变更编号：`CHG-2026-09-22-WEB-WORKBENCH-ARCHITECTURE`
- 状态：`VERIFYING / PARTIAL`
- 创建时间：2026-09-22
- 更新时间：2026-09-23

> 审核结论：用户于 2026-09-22 指示执行；未决问题按 proposal 中的推荐默认值关闭。

## 现状与约束

当前事实来自 `apps/web` 工作区快照：

| 区域 | 当前事实 | 本变更处理方式 |
| --- | --- | --- |
| 登录 | `app/login/page.tsx` 已实现 session 检查、login、错误提示和安全 `returnTo`；登录网关在独立变更中验证 | 保留页面视觉与 API 合同，把请求行为收口到 Auth module |
| 工作台 | `app/(protected)/page.tsx` 约 10.65 万字符、57 个 `useState`、9 个 `useEffect`、38 次 `apiFetch`；同时承载业务状态、编辑器、Job、审核和 Modal | 分阶段抽取，先不改变信息架构和 API 行为 |
| 插件 | `app/(protected)/plugins/page.tsx` 自己复制 API client、401 跳转、开发初始化和数据加载 | 迁移到共享 HTTP/Auth/Query module |
| API Console | 具备 Auth 操作和场景编排，使用独立的请求预览逻辑 | 保留诊断能力，明确是否自动跳转的策略 |
| 生成监听 | `generation-job-status-watcher.ts` 已有单飞、Abort、fallback 和单测 | 保留为传输 Adapter，页面协调迁移到 Generation module |
| 样式 | `globals.css` 与登录 CSS 已有视觉 token 和响应式规则 | 不以架构重构为由重做视觉系统 |
| 认证开发模式 | 当前登录变更已移除开发身份绕过，开发和生产统一登录边界；开发 Cookie 因 HTTP 不设置 Secure | Web 不再依赖 `x-user-id` 作为认证事实；仅由登录变更定义环境差异 |

约束来自 [LangReport AGENTS.md](../../../AGENTS.md)、[apps/web/AGENTS.md](../../../apps/web/AGENTS.md)、[CONTEXT.md](../../../CONTEXT.md)、[第一阶段产品规格](../../product/phase1-consulting-report.md) 和 [登录网关设计](../2026-09-22-login-gateway/design.md)。第一阶段仍只服务一个认证用户的私有 Workspace 视图，不扩展为完整账户系统。

## 设计目标与非目标

### 目标

1. 在浏览器端建立唯一 Auth seam，不暴露 JWT，不复制 401 行为。
2. 让服务端状态拥有明确的 Query cache 生命周期和身份作用域。
3. 让 URL 成为当前 Project/Conversation/Revision 选择的可复制事实来源。
4. 让业务 feature 通过小接口协作，页面只做布局与命令编排。
5. 保留现有 Generation/Render/Revision/Evidence 不变量和所有用户可见流程。

### 非目标

- 不改变 API 服务端的认证实现和 JWT Claim。
- 不重新设计 Project、Snapshot、Generation Job 或 Review 领域模型。
- 不把客户端 reducer 当成权限或业务事实来源。
- 不在本变更内优化 SSR、边缘缓存或实时协作。

## 方案选型

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 只把 JSX 拆成多个组件 | 改动小 | 远端状态、401、缓存和身份切换仍散落；模块接口浅 | 不采用 |
| Auth seam + 统一 HTTP + TanStack Query + feature slices | 解决当前重复请求、失效和身份切换；可逐步迁移；测试面清晰 | 增加一个实际依赖，迁移期需要维护新旧路径 | 采用 |
| Redux/Zustand 全局状态 | 可以集中状态 | 会把服务端缓存、表单和 UI 状态混在一起；身份清理责任变大 | 不采用 |
| XState 管理全部生成和登录流程 | 状态图显式 | 当前流程规模不足以抵消学习和接入成本 | 不采用；Generation 先用 reducer |

TanStack Query 的引入理由不是关键词，而是当前已有大量手写请求生命周期：项目切换时清空状态、重复读取、终态刷新、迟到响应保护和多个页面复制的 API client。它只拥有服务端状态；表单、Modal 和编辑器仍归本地模块。

## 模块边界

### Auth module

`features/auth` 对页面暴露：

- `getSession()`：返回最小 session projection，不返回 JWT；
- `login(username, password)`：只提交内存中的凭据，成功后刷新 session query；
- `logout()`：调用幂等 logout，清理 QueryClient 和当前导航状态；
- `AuthGate`：处理 `checking / authenticated / anonymous / unavailable` 四种 UI 状态；
- `safeReturnTo()`：只接受同源绝对路径，拒绝外部 URL 和 `/login` 自跳转。

Auth module 的实现隐藏 Cookie、请求头、401 归一化和导航副作用。浏览器只通过 HttpOnly Cookie 维持会话。登录网关的服务端实现和 `packages/contracts` 是外部合同，不在本变更重写。

### HTTP client seam

`lib/http-client.ts` 是所有 Web feature 的远程请求入口：

- 默认 `credentials: include` 和 `cache: no-store`；
- 将 `{ error, code, details, requestId }` 归一化成可判别的 `HttpError`；
- 401 更新 session query，但不在 client 内部无条件跳转；由 `AuthGate` 或调用方策略决定；
- 支持 `public` 请求（login、session、logout、API Console Auth 场景）和 `required` 请求（业务数据）；
- 不接受任意页面传入生产 `x-user-id`。

这是一个真正的 seam：生产适配器是 Cookie/同源 HTTP，测试适配器是内存 request adapter；页面不创建 fetch 依赖。

### Protected route group

```text
app/
  (auth)/login/page.tsx
  (protected)/layout.tsx
  (protected)/page.tsx
  (protected)/plugins/page.tsx
  api-console/page.tsx
```

`(protected)/layout.tsx` 挂载 AuthGate，不改变现有 `/` 和 `/plugins` URL。API Console 默认保留公开诊断入口；其业务场景的 401 只在结果面板展示，不自动把调试者踢到登录页。

### Server state module

Query key 必须包含身份相关的作用域：

```text
["auth", "session"]
["workspace", userId]
["projects", workspaceId]
["project", projectId, "conversations"]
["project", projectId, "data-assets"]
["project", projectId, "evidence"]
["revision", revisionId, "comments"]
["generation-job", jobId]
```

身份从 authenticated 变为 anonymous 时，清空所有 Workspace/Project/Job query。logout 不能只跳转页面。

#### T3 实施设计（2026-09-23）

T3 只迁移服务端状态的读取和缓存所有权，不提前拆分页面 JSX 或表单状态。查询层按领域对象提供稳定的 key/fetcher：

- `features/project/project-queries.ts`：Workspace/Project 列表，key 包含 `userId`；
- `features/conversation/conversation-queries.ts`：Conversation 列表和 Messages，分别按 `userId + projectId`、`userId + conversationId` 隔离；
- `features/data-snapshot/data-asset-queries.ts`：Project 下的 Data Asset 列表，按 `userId + projectId` 隔离；Snapshot 历史详情继续由预览交互按需读取；
- `features/evidence/evidence-queries.ts`：Project 下 Evidence Block 列表，按 `userId + projectId` 隔离；
- `features/project/project-resource-queries.ts`：Metric Definition、Analysis Brief、Memory、Theme 等 Project 资源的读取 key；
- `features/project/use-project-server-state.ts`：为工作台组合这些 `useQuery`，仅暴露只读 data/loading/error 投影。

页面保留的本地状态只有当前选择 ID、表单、Modal、编辑器和 Generation Job 协调状态。服务端返回的实体不再同时放进 `useState`；创建、上传、确认或审核成功后使用 `queryClient.setQueryData` 写入对应 key，跨实体变化使用精确的 `invalidateQueries`。登出继续由 `useAuthActions` 清空整个 QueryClient，因此不会残留前一身份的数据。

Query 错误只进入页面已有的错误提示，不在 fetcher 中导航；401 仍由统一 HTTP/Auth seam 处理。查询启用条件必须同时满足 authenticated `userId` 和有效 Project/Conversation ID，项目切换依靠 key 隔离与 React Query Abort，不能用旧请求回填新项目。

#### T5 实施设计（2026-09-23）

T5 先收敛工作台中最容易继续膨胀的四个业务切片，不改变 API、路由、认证或 Query 合同：

- `features/project/project-panel.tsx`：拥有 Project 选择器和创建 Project 对话框的展示边界；接收 Project 列表、当前 ID、表单值和 `onSelect`、`onOpenCreate`、`onCreate` 等窄回调。创建请求仍由页面组合层发起，避免在展示组件复制 HTTP/401 处理。
- `features/conversation/conversation-panel.tsx`：拥有顶部 Conversation 选择器、历史列表、消息日志和 composer；接收 Query 投影、当前 Conversation ID、证据摘要、composer 值及发送/新建/选择回调。Generation Job 和消息 mutation 继续由父层协调。
- `features/data-snapshot/data-asset-panel.tsx`：拥有左侧数据导入入口及隐藏 file input；接收当前 Asset、上传状态和文件操作回调。Snapshot 只读预览的请求生命周期暂留页面，下一步再迁入独立 Snapshot controller。
- `features/analysis-brief/analysis-brief-form.tsx` 与 `metric-form.tsx`：拥有 Brief/Metric modal 的字段布局和可访问性；表单值采用受控 props，保存/取消/字段变更通过回调交给页面，避免把服务端 mutation 与表单本地状态混在组件内。

这些组件只保留现有 CSS class、文案、DOM 语义和测试选择器，不新增视觉规则。页面组合层仍负责 URL context、Query mutation、Job watcher、Revision/Evidence 和暂未迁移的 Review/Editor UI；T5 不提前改动 T6/T7 的状态机或错误策略。

#### T6 实施设计（2026-09-23）

T6 本轮只收敛 Chart Editor 的纯本地状态和编辑计划逻辑，Generation coordinator 沿用已经接入的 `features/generation/use-generation-job.ts`，不再复制一套 Job 状态机：

- `features/chart-editor/chart-editor-state.ts` 定义 `EditorState`、`ChartEditorAction` 和纯 `chartEditorReducer`；`reset` 用于打开指定 Revision，`set-field` 用于输入控件，reducer 不触碰 API、Query 或路由。
- 同一模块提供 `editorStateFromRevision()`，将当前 Revision 的 Flint Spec、TransformPlan、注释和显示选项投影为编辑器初始状态；非法或缺失的聚合/筛选值回到安全默认值。
- 同一模块提供 `buildEditorTransformPlan()`，只根据不可变 Snapshot 的字段画像、当前编辑器状态和旧 TransformPlan 生成新的有限计划；它保留已有 derive 步骤、显式字段血缘输入和 expected columns，不修改 Snapshot。
- 页面组合层继续拥有编辑器 modal 的 DOM、API mutation、错误提示和 Job 回填；只改为 `useReducer` + `dispatch`，因此 T6 不改变视觉选择器、Approved 只读门禁或 Revision append-only 合同。

T6 的验收重点是 reducer 的 reset/field update、Revision 投影、数字/布尔筛选值归一化、聚合/排序计划和现有图表编辑 E2E；不在本轮迁移 Evidence/Review UI 或 API Console 错误策略。

#### T7 实施设计（2026-09-23）

T7 本轮先收敛请求与错误的边界，不修改任何 API 路径、请求体、响应合同或认证协议：

- `lib/http-client.ts` 增加可复用的 `apiRequest`、`apiDownload` 和 `formatApiError`。前者负责 Cookie、`no-store`、401 事件和结构化 payload 解析；`apiFetch` 继续作为 JSON 成功请求的简化入口；`apiDownload` 只负责固定 Revision 输出的二进制读取并复用同一错误合同。
- API Console 的 OpenAPI 加载、普通请求和 Loop 4 场景请求改用 `apiRequest`，但显式采用 `unauthorized: "none"` 与 `throwOnError: false`，因此诊断请求仍把 401/4xx 留在结果面板，不触发登录跳转或 AuthGate 循环。请求预览、原始响应和 requestId 展示保持原样。
- `features/evidence/revision-export.tsx` 接管 PNG/SVG/HTML/Vega-Lite JSON 的固定 Revision 导出。组件用 `apiDownload` 取得 Blob、保留现有按钮 class 和文件名语义，并在导出失败时显示统一错误文案；Approved/固定 Revision 门禁仍由父层传入。
- `features/evidence/plugin-trace.tsx` 与 `features/review/review-panel.tsx` 只接管既有展示边界，使用受控 props，不复制 API 请求。页面组合层继续拥有 plugin-context、评论、Revision transition 的 mutation 和 Query 回填，但 catch 统一调用 `formatApiError`，让 code/requestId 在 Evidence、Review、Plugin 的错误路径一致可读。

T7 不在本轮把整页 Evidence/Review 业务状态迁入 Query，也不新增独立 API client；这些属于后续页面组合层收敛。验证重点是共享 seam 的 credentials/401/非 JSON/二进制失败行为、API Console 不跳转、导出错误可解释，以及现有工作台/插件/API Console 回归。

#### T8 实施设计（2026-09-23）

T8 先处理页面组合层中仍然自持请求生命周期的 Snapshot 预览，这是一个独立且可回归的 feature slice；不以此轮为由重写整个 `page.tsx`，也不改变 Snapshot API 或预览 Modal 的视觉合同。

- `features/data-snapshot/use-snapshot-preview.ts` 提供 `useSnapshotPreview()` 控制器、Snapshot 领域类型和两个只读 fetcher。控制器拥有 `isOpen`、Asset/版本选择、摘要列表、详情、`idle/loading-list/loading-detail/ready/error` 状态及关闭、选择、重试命令；fetcher 仅通过 `apiFetch` 读取既有 `/api/v1/data-assets/:assetId/snapshots` 和 `/snapshots/:snapshotId`。
- 控制器为每次打开、版本选择和重试建立新的请求代次，并保留 `AbortController`。关闭或新代次开始时中止旧请求；响应写入前同时检查代次和 `AbortError`，因此迟到的列表/详情不能覆盖新 Asset、已关闭 Modal 或新选择。版本摘要在控制器内按 `version` 降序排序，页面不再复制排序和错误映射。
- `app/(protected)/page.tsx` 只保留选中 Asset 必须存在 `latestSnapshot` 才能打开的产品门禁，以及 `SnapshotPreviewModal` 的受控展示映射。Modal、表格、焦点管理和 CSS 保持原位置，继续接收窄 props，不持有远程状态。
- T8 不新增共享 UI 组件、不引入新的状态库、不迁移 Evidence/Review 的剩余 mutation；这一步只验证“页面组合层把命令交给 feature controller”的边界，为后续审计留下可测 seam。

#### T8 Review comments controller 切片（2026-09-23）

本轮继续沿同一边界审计 Review：只下沉评论读取/新增与审核意见草稿，不把 Revision 状态转换或 Evidence Query 写回一起迁移。

- `features/review/use-review-comments.ts` 提供 `useReviewComments(revisionId, callbacks)`，拥有当前 Revision 的评论列表、审核意见草稿、读取/保存状态和刷新/新增命令；列表和新增 fetcher 均通过 `apiFetch` 与既有 `/api/v1/chart-revisions/:revisionId/comments` 合同通信。
- Revision ID 改变、组件卸载或新请求开始时，中止旧请求并重置评论与草稿；响应写入前检查请求代次，防止切换 Revision 后旧评论污染当前审核面板。新增评论只追加服务端返回对象，不在客户端制造评论事实。
- `page.tsx` 只保留 `transitionRevision` 的状态 mutation、Evidence Query 回填、全局 notice/error 投影和 `ReviewPanel` 组合；ReviewPanel 的 DOM、CSS、审核按钮和既有文案保持不变。
- 本轮不自动加载评论、不引入评论 Query key、不改变 Review/Revision API，不处理 T9 的真实登出和独立验收。

#### T8 Plugin trace controller 切片（2026-09-23）

本轮继续收敛 Evidence 组合层中仍由页面持有的远端请求生命周期：只迁移当前 Revision 的 Plugin Context 读取、快照结构校验和竞态清理，不改变 `PluginTrace` 的展示合同。

- `features/evidence/use-plugin-trace.ts` 提供 `usePluginTrace(revisionId)`、`fetchPluginSnapshot()` 和 `parsePluginSnapshot()`；读取既有 `/api/v1/chart-revisions/:revisionId/plugin-context`，继续通过共享 `apiFetch`、Cookie 和 `no-store` seam。
- Controller 在 Revision 切换、卸载时中止旧请求；写入前检查 Revision/Abort 代次，避免旧 Plugin Snapshot 污染当前 Evidence。空快照、非法版本/Renderer/能力结构和网络错误继续投影为现有 `idle/empty/invalid/error` 状态。
- `page.tsx` 删除 Plugin Snapshot 解析函数、状态和 effect，只把 `activeRevision.id` 交给 controller，并继续将状态传给 `PluginTrace`；不把插件状态写入 Query，也不改变全局错误 banner、Revision transition 或 Evidence Query 回填。
- 本轮不新增 API、不修改 API Console、不改 CSS/DOM；只补充 parser/fetcher 的 unit 覆盖和插件上下文桌面/移动回归，不进入真实登出缓存和 T9。

#### T8 Evidence canvas 组合切片（2026-09-23）

本轮继续收敛 Evidence 的页面组合边界，但只移动受控展示，不移动服务端状态或领域命令。目标是让 `page.tsx` 负责选择上下文和组装 props，Evidence feature 负责自己的 DOM 合同。

- `features/evidence/evidence-canvas.tsx` 提供 `EvidenceCanvas` 与 `EvidenceTrace` 受控接口，渲染现有 Evidence 标题、Revision 状态、图表 slot、发现、数据快照/指标/版本摘要、质量提示、编辑/依据/导出/提交审核动作和 trace cards。
- `EvidenceCanvas` 只接收字符串、数值、React node 和窄回调；`RevisionExport` 仍在 Evidence feature 内部处理固定 Revision 下载，`InteractiveChart` 仍由页面提供，不把图表编辑器本地状态、Evidence Query、Revision transition、Plugin Context 或 Review comments 请求带入组件。
- `page.tsx` 仅把 `activeEvidence`、`activeRows`、`metric` 和既有回调投影为 props。Approved/archived 编辑门禁、Approved 导出门禁、draft 提交审核和 `showTrace` 开关语义保持不变。
- 组件不提升到 `components/*`：它依赖 Evidence 专属的状态文案、证据摘要和审核动作，因此当前仍是 feature-specific public boundary。跨 feature 的公共组件审计留给后续 Review 组合切片。

本轮不新增 API、不改变 Query ownership、Revision API、CSS 或共享组件目录；验证重点是受控 props 类型、Evidence DOM 选择器与桌面/390px 证据链路回归。

#### T8 Review composition 组合切片（2026-09-23）

本轮把 Review 的“何时出现以及如何把 controller 投影给面板”收敛到 `features/review`，但不移动审核领域命令。页面仍拥有 Revision transition mutation、Evidence Query 回填和全局错误/通知投影；Review comments controller 仍拥有评论读取、新增和审核意见草稿。

- `features/review/review-composition.tsx` 提供 `ReviewComposition` 受控边界，接收当前 Revision 的最小状态、`useReviewComments` 返回值和审核回调；当 Revision 不是 `in_review` 时由 feature 边界返回空，不在页面重复实现状态门禁。
- `ReviewPanel` 保持现有 DOM、CSS、评论文案、刷新/新增操作和批准/要求修改按钮；组合组件只负责 status gate 与 props forwarding，不复制 HTTP、Query 或 Revision API。
- `page.tsx` 只传入 `activeRevision`、评论 controller 状态以及 `transitionRevision` 回调；不将 Review 状态写入共享 `components/*`，因为审核面板和 Revision 状态门禁仍属于 Review feature 的领域合同。

本轮不新增 API、不修改评论合同、Query key、Revision 状态机或视觉规则；验证重点是 `in_review` 显示、非审核状态隐藏和既有评论/批准链路回归。

#### T8 跨 feature 公共组件审计（2026-09-23）

审计工作台与插件页后，只发现一组具有稳定、领域无关契约的重复反馈条：工作台和插件页都使用同一组全局 `.alert`、`.error-alert`、`.notice-alert` 样式，渲染消息、语义 role 和关闭动作。其余候选仍带有明确领域所有权，因此不强行上移。

- `components/feedback/alert-banner.tsx` 提供 `AlertBanner`，接收 `tone`、`message`、可选 `title` 和 `onDismiss`；组件不拥有远程状态，只复用现有全局 CSS class 和 44px 关闭按钮语义。
- 工作台与插件页改用 `AlertBanner`，保持错误/通知文案、`role`、关闭回调和 DOM class 不变；登录页、API Console 使用各自 CSS module 和错误上下文，保留原实现。
- `InteractiveChart`、`SnapshotPreviewModal`、`EvidenceCanvas`、`ReviewComposition` 和插件/编辑器面板均不迁移到 `components/*`：它们依赖 Chart/Evidence/Review/Plugin 的领域数据与交互合同，不满足稳定跨 feature 复用条件。

本轮不新增 API、不改变 Query ownership 或视觉 token；公共组件目录只新增反馈条，作为可回滚的最小审计结果。

#### T8 UI 视觉与抽屉交互细化（2026-09-23）

本轮按用户确认的视觉决策细化工作台，不改变 API、Query ownership、领域状态或生成/审核行为。设计决策记录在 [ADR 0023](../../adr/0023-center-first-evidence-drawers.md)，根视觉规则同步到 `DESIGN.md`。

- `leftRailOpen` 与 `rightRailOpen` 默认均为关闭，两个抽屉互不排斥；宽屏使用左右 grid track，中心 Evidence 画布占剩余空间；平板使用左右 edge drawer，移动端使用底部 sheet。
- 依据抽屉通过 pointer drag handle 调整宽度，范围 300–560px，默认 360px；宽度仅保存于当前页面会话，不写入 localStorage，不进入 URL 或领域状态。
- Snapshot 预览不再使用全屏 `modal-backdrop`。打开时临时替换依据抽屉的内容，保留同一宽度和焦点入口；预览的关闭按钮、Esc 和底部关闭操作统一关闭整个依据抽屉。
- Evidence 画布的主阅读顺序保持标题/状态、图表、发现、紧凑来源摘要；完整追溯信息仍由依据抽屉承载。全局按钮和上下文操作减少 pill 形状，状态徽标继续使用语义颜色和文本。
- 图表在 Evidence stage 与编辑预览中保持居中，并限制最大可读宽度；图表编辑的下拉选择沿用通用字段控件样式，只增加明确的 hover、focus 和 disabled 状态。
- 顶栏在桌面保留 Project、历史/依据开关、会话菜单；移动端提供历史与依据的明确打开按钮。所有 drawer/sheet 过渡只使用 transform/opacity，并遵守 `prefers-reduced-motion`。
- 本轮不抽取新的领域组件，不改变 `SnapshotPreview` controller 的请求/Abort 语义；只改变它的展示容器和关闭回调。

回滚方式：恢复 `leftRailOpen`/`rightRailOpen` 默认值、移除 context width state/resize handle，并将 Snapshot preview wrapper 恢复为原有 modal；API 与服务端状态无需回滚。

### URL context module

当前选择由 `hooks/use-project-context.ts` 的 `useProjectContext()` 读取：

```text
/?project=:projectId&conversation=:conversationId&revision=:revisionId
```

首阶段保留 `/` 入口以避免外部链接回归；显式 URL 优先于 `localStorage`。`localStorage` 只可保存最近 Project 偏好，不可覆盖 URL，也不可保存敏感信息。

URL 改变时，Query 的 `enabled` 条件和 watcher Abort 共同保证旧 Project/Conversation 的响应不能写入新上下文。API 仍负责最终的 Workspace/Project 权限校验。

### Feature modules

```text
features/
  project/          Project list, create, switch
  conversation/     Conversation list, messages, composer
  data-snapshot/    intake, asset list, snapshot preview
  analysis-brief/   Brief and Metric Definition forms
  generation/       Job command, watcher coordination, clarification
  chart-editor/     local reducer, transform plan command, editor dialog
  evidence/         Evidence canvas, trace, fixed revision export
  review/           comments and Revision status commands
```

Feature module的外部接口只接收已选择的 ID、Query data 和少量命令回调；不把整个 `Home` 状态对象作为 props 继续向下传递。

### Shared components

`components/chart`、`components/layout` 和 `components/feedback` 只放跨 feature 复用且不拥有领域远端状态的模块；当前审计新增 `components/feedback/alert-banner.tsx`。`SnapshotPreviewModal`、`ReviewPanel`、`EvidenceCanvas` 等如果仍只服务一个 feature，应先留在 feature 内。

## 数据模型与状态流转

```text
anonymous
  ├─ login success ─────────► authenticated
  ├─ login failure/429/503 ─► anonymous + error
  └─ session 401 ───────────► anonymous + clear cache + /login

authenticated
  ├─ URL project change ────► scoped queries + abort old watcher
  ├─ Job active ─────────────► watcher → reducer → terminal invalidation
  └─ logout ─────────────────► clear cookie/cache → /login
```

Generation UI reducer只表达客户端显示与协调状态，不创造领域状态：

```text
idle → watching → refreshing-result → complete
               ├→ needs-clarification
               ├→ failed
               └→ cancelled
```

Job status、Revision status、Evidence status仍以 API 返回的服务端事实为准。Approved Revision 的只读约束仍由 API 和领域模块执行，前端按钮状态不是权限边界。

## API / 外部契约

本变更不新增业务 API，不改现有 Auth API 合同：

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/session`
- `POST /api/v1/auth/logout`

现有 Project、Conversation、Snapshot、Generation、Revision、Review 和 Plugin API 保持路径、请求体、响应事实和错误 code 不变。若迁移发现某个 Web query 需要新增字段，必须另建 API/Contracts 变更并同步 API Console，不能在本重构中隐式扩大合同。

## 架构图

```text
┌───────────────┐
│ Auth / Login  │ ── public HTTP ──┐
└───────────────┘                  │ HttpOnly Cookie
                                   ▼
┌─────────────────────────────────────────────┐
│ Web route groups                             │
│  AuthGate → HTTP client → Query cache        │
│             │                │               │
│             ▼                ▼               │
│      Feature modules     Job watcher         │
│  Project/Data/Evidence  → Generation reducer │
│             │                │               │
│             └──── URL context ┘               │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
              Fastify API
```

成功路径：登录建立 Cookie → AuthGate 允许受保护路由 → Query 读取 Workspace/Project → Feature mutation 失效相关 query → Job watcher 在终态刷新 Evidence/Revision。

失败路径：401 只更新 session 状态并清理缓存；login 的 401/429/503 留在登录页；API Console 的业务 401 只展示结果；旧请求被 Abort 或 query key 隔离。

## 数据流

1. `(protected)/layout` 查询 session；`checking` 显示最小 loading，`anonymous` 导航 `/login?returnTo=...`。
2. 登录页调用 Auth module，成功后只让浏览器保存 HttpOnly Cookie，并使 session query 失效。
3. Authenticated 状态出现后，Project/Workspace Query 才启用；Query data 向 feature UI 提供只读投影。
4. Mutation 使用服务端响应更新或失效相关 Query，不在页面维护第二份实体副本。
5. URL Project/Conversation/Revision 选择改变时，旧消息和 Job watcher 取消；新 Query 以新的 key 读取。
6. Generation module 接收 Job ID，复用 `generation-job-status-watcher.ts` 的传输逻辑；终态调用 `invalidateQueries` 并重新读取完整 Evidence。
7. logout 清除 Cookie、Query cache、local selection 和 watcher，再导航登录页。

## 权限、校验与异常处理

- 所有业务查询必须在 authenticated session 下运行；API 仍是 Workspace/Project 权限最终校验者。
- 401 不能在多个页面各自实现导航；由 Auth module 统一记录为 session invalidation。
- 401 的请求若属于 login/session/logout 或 API Console 调试，必须允许 `redirect: none`。
- 401 处理必须避免循环：当前路径是 `/login`、请求本身是 Auth route 或 Abort 已触发时不再导航。
- 登出无论 Cookie 是否有效都应清理客户端缓存；服务端 logout 的幂等合同保持不变。
- Query cache 不得跨 session 复用；不要把 userId、JWT、Cookie 或密码放入 URL/storage。
- Job watcher 切换上下文时 Abort；Query 的 `enabled` 和 key 不能仅依赖组件是否仍挂载。
- `localStorage` 中历史 Project ID 无权限时丢弃并回到 API 返回的第一项或空态。

## 迁移、兼容与回滚

迁移按可回滚的小步进行：

1. 先新增 Auth/HTTP/Query module，不删除旧页面代码。
2. 迁移 Project/Conversation 查询，保留旧路径可通过 feature flag 或小范围 commit 回退。
3. 迁移 URL context，再迁移 Snapshot/Evidence/Review。
4. 最后迁移 Editor/Generation 和 Plugin 页面。
5. 每步通过 Web typecheck、E2E 后再删除重复实现。

回滚时可以保留登录网关和 `/login`，只回滚 Web feature/query 层；不撤回 Auth API、Cookie 或服务端权限实现。若 TanStack Query 引入出现兼容问题，可先保留统一 HTTP client 和 feature 拆分，回退 Query adapter，不恢复页面内的身份绕过。

## 日志、监控与可观测性

本变更不新增敏感日志。HTTP client 可在开发和测试模式携带 requestId/错误 code，生产不记录密码、JWT、Cookie 或 Query data。需要观察：

- 页面因 401 进入登录页的次数；
- login 后 session 恢复失败次数；
- logout 后仍发生的受保护请求；
- Job watcher 取消、fallback 和终态刷新失败；
- query cache 清理后旧 Project/Evidence 是否仍出现在 DOM。

## 测试策略

- Auth module：session 状态、safe returnTo、401、logout cache clear 和重复导航。
- HTTP client：Cookie credentials、错误合同、public/required 策略和 Abort。
- Query：身份变化清理、Project/Conversation key、mutation invalidation。
- URL：刷新、前进后退、显式 URL 优先于 localStorage、非法 ID 回到空态。
- Generation：保留现有 watcher 单测，新增 reducer 终态和上下文切换测试。
- Web E2E：未登录跳转、正确/错误登录、刷新、登出、工作台主路径、插件页、API Console Auth 场景、桌面和 390px。
- 回归：`pnpm --filter @langreport/web typecheck`、`test:typecheck`、`test:e2e`、全仓 `typecheck/test/build/docs:check`。

## 需求追踪矩阵

| 需求 | 设计 | 任务 | 测试 | commit |
| --- | --- | --- | --- | --- |
| R1 统一登录/session/401 seam | Auth module、HTTP client、权限处理 | T1、T2 | Auth/HTTP unit、login E2E | 待实现 |
| R2 受保护路由与登出清理 | Protected route、状态流 | T2、T9 | Web E2E、cache clear test | 本地浏览器 logout/cache 契约通过；真实同源 `auth-live` 部署验收待执行 |
| R3 服务端状态按身份缓存 | Query keys、invalidation | T3 | Query unit、workspace E2E | 待实现 |
| R4 Project/Conversation/Revision URL 恢复 | URL context、数据流 5 | T4 | URL/E2E | 待实现 |
| R5 feature 模块化 | 模块边界、共享组件 | T5、T8 | typecheck、E2E 回归 | T5 展示边界、T8 Snapshot、Review comments、Plugin trace controller、EvidenceCanvas、ReviewComposition 与 AlertBanner 已实现；领域专属 UI 保留在 feature 内 |
| R6 Generation 状态可独立测试 | reducer、watcher seam | T6 | watcher/reducer unit、live smoke | Generation coordinator 与 Chart Editor reducer 已实现；live smoke/独立验收待完成 |
| R7 业务合同和 API Console 不漂移 | API/外部契约 | T7 | contracts/docs/E2E | `apiRequest`/`apiDownload` seam、API Console 401 smoke 与固定 Revision 导出回归已通过；无 API 合同变更 |
| R8 迁移可回滚且无用户行为变化 | 迁移兼容与回滚 | T9 | 全量验证、diff check | 本地全量检查、浏览器 logout/cache 契约和只读共享快照复核通过；真实同源部署 live-auth、隔离 worktree 复核和登录网关 HTTPS 验收待补 |
