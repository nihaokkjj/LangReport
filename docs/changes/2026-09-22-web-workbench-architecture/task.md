# Web 工作台认证感知架构重构：Task

- 变更编号：`CHG-2026-09-22-WEB-WORKBENCH-ARCHITECTURE`
- 状态：`VERIFYING / PARTIAL`
- 创建时间：2026-09-22
- 更新时间：2026-09-23

> 执行授权：用户于 2026-09-22 指示执行本任务；T0–T9 按依赖顺序推进，登录网关服务端合同保持独立。

## 执行前提

- `CHG-2026-09-22-login-gateway` 的独立复测和用户最终验收保持独立；本变更不修改其服务端认证实现。
- 本变更为 L 级 Web 架构和权限感知流程变更。proposal、design、task 通过用户审核后，才能进入业务代码实现。
- 实现前必须读取根 `DESIGN.md`、`apps/web/AGENTS.md`、当前变更文档和登录网关交接记录。
- 保留当前工作区所有登录、API Console、Plugin 和主工作台未提交修改；不执行 reset、checkout、stash 或覆盖式格式化。
- API/Contracts 没有预期变更；若实现确需修改，必须先回到 proposal/design 并同步 API Console。

## 任务清单

| ID | 任务 | 依赖 | 可并行 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- |
| T0 | 建立行为基线、确认登录变更状态和 API Console 访问策略 | login-gateway 验收/或用户确认可并行 | 否 | 已完成 | `git status`、Web E2E、`pnpm docs:check` | 基线记录主路径、登录、插件、API Console、Job watcher；API Console 公开诊断默认值已记录 |
| T1 | 新增 `lib/http-client` 与 `features/auth`，统一 session/login/logout/401/error contract | T0 | 否 | 已完成 | Web typecheck、Auth E2E | 工作台、插件、登录使用共享 seam；Cookie 认证和错误 code 归一化可验证 |
| T2 | 建立 `(auth)` / `(protected)` route group、AuthGate 和 logout cache 清理 | T1 | 否 | 已完成 | login E2E、Web E2E | `/`、`/plugins` 匿名跳转、登录回跳、Query 清理和 watcher 中断已接入 |
| T3 | 接入 TanStack Query，迁移 Workspace/Project/Conversation/Asset/Evidence server state | T2 | 否 | 已完成（本轮） | Query key/fetcher unit、Web typecheck、Web unit、Web build、工作台回归 | 既有 Workspace/Project list Query adapter 保持兼容；Conversation、Asset、Metric/Brief/Memory、Evidence/Messages 使用身份和上下文作用域 Query，工作台不再复制这些实体 |
| T4 | 实现 URL context，迁移 Project/Conversation/Revision 选择 | T3 | 否 | 已完成（首阶段） | URL unit、Web E2E、build | `project/conversation/revision` 显式 URL 优先；localStorage 仅作 fallback |
| T5 | 提取 Project、Conversation、Data Snapshot、Analysis Brief/Metric feature | T3–T4 | 可与 T6 前半并行 | 已完成（本轮） | Web typecheck、unit、build、工作台 E2E | 受控展示组件接管四个 feature slice；页面保留 Query/mutation/Job 编排，不改变行为和 API |
| T6 | 提取 Chart Editor reducer 和 Generation coordinator | T5 | 否 | 已完成（本轮） | chart editor unit、Web typecheck、build、图表编辑 E2E | Generation coordinator 保持已接入；Chart Editor reducer 接管编辑器本地状态与 TransformPlan 纯逻辑，不改变 API/视觉行为 |
| T7 | 迁移 Evidence、Review、Export、Plugin 和 API Console 的共享错误/请求策略 | T5–T6 | 可并行 | 已完成（本轮） | Web unit、Web E2E、API Console smoke | Plugin/Evidence/Review/Export/API Console 均通过共享 HTTP/Auth seam；API Console 401 不跳转，固定 Revision 导出失败可解释 |
| T8 | 页面组合层收敛与公共组件审计 | T5–T7 | 否 | 已完成（本阶段） | Snapshot/Review/Plugin controller、Evidence canvas、Review composition、AlertBanner、Web typecheck、Web unit、工作台 E2E | 保留当前大页面；服务端状态和领域专属 UI 留在原 feature 边界，稳定的跨 feature 反馈条已提取为公共组件；不将领域组件强行上移 |
| T8.16 | Evidence 中心画布与并行抽屉视觉细化 | T8 | 否 | 已完成（本轮） | Web typecheck、UI unit/E2E、桌面/390px 人工检查、`git diff --check` | 默认中心画布；历史/依据可并行打开；依据 300–560px 可拖拽；Snapshot 预览覆盖依据位置且关闭时关闭依据抽屉；API/领域行为不变 |
| T9 | 独立验证、验收、交接和清理旧实现 | T8 | 否 | 部分完成（本阶段） | test-plan、全仓检查、只读独立复核、logout/cache E2E | 本地可执行验证、浏览器登出契约和只读独立复核已通过；真实同源部署 Cookie、隔离 worktree 复核和登录网关 HTTPS smoke 仍待补 |

## 执行顺序

```text
login-gateway VERIFYING/ACCEPTED
  → T0
  → T1
  → T2
  → T3
  → T4
  → T5/T6
  → T7
  → T8
  → T8.16
  → T9
```

T5 的纯展示提取可以在 T3 完成后开始，但不能绕过 T1/T2 继续复制请求和 401 逻辑。T6 必须在 T3 的 Query invalidation 规则稳定后开始。

### T5 实施子任务（本轮）

- T5.1 新增 Project feature 展示边界：Project 选择器与创建对话框使用受控 props，保留原有切换、创建回调和表单校验。
- T5.2 新增 Conversation feature 展示边界：顶部选择器、历史对话/证据摘要、消息日志与 composer 使用受控 props，不复制请求逻辑。
- T5.3 新增 Data Snapshot feature 展示边界：数据导入 rail 和隐藏文件 input 移出页面，上传/示例数据仍由父层处理；Snapshot 只读预览先保持原位置。
- T5.4 新增 Analysis Brief/Metric 受控表单组件，保留原有字段、文案、CSS class、保存草稿/确认行为和关闭行为。
- T5.5 删除页面中上述四个 slice 的重复 JSX，运行 Web typecheck、unit、build 和桌面/移动工作台 E2E；失败则只回退 T5 展示边界，不回退 T3 Query/Auth seam。

T5.1–T5.5 已完成：新增 `project-panel.tsx`、`conversation-panel.tsx`、`data-asset-panel.tsx`、`analysis-brief-form.tsx` 与 `metric-form.tsx`；页面只保留受控值、Query 投影和业务回调。Web typecheck、test:typecheck、12 个 unit、Next build、16 条桌面/移动 E2E 和 `git diff --check` 已通过。

### T6 实施子任务（本轮）

- T6.1 新增 `features/chart-editor/chart-editor-state.ts`，集中定义 EditorState、reducer action、默认状态和 Revision 投影。
- T6.2 将 `scalarForFilter` 与 `buildEditorTransformPlan` 移出页面，保持过滤、聚合、排序、derive 和 expected columns 语义一致。
- T6.3 页面使用 `useReducer` 管理编辑器字段；编辑器 modal 保留原有 DOM、CSS、选择器和保存 mutation，Approved/archived 仍不可编辑。
- T6.4 补充 reducer、Revision 投影和 TransformPlan 单测，运行 Web typecheck、test:typecheck、unit、build 和桌面/移动 E2E。

T6.1–T6.4 已完成：`chart-editor-state.ts` 已接管 reducer、Revision 投影和 TransformPlan 构造；页面仅保留编辑器 modal 展示、API mutation 和 Job 协调。15 个 Web unit、Web typecheck、test:typecheck、Next build、16 条桌面/移动 E2E 和 `git diff --check` 已通过。

### T7 实施子任务（本轮）

- T7.1 扩展 `lib/http-client.ts`：提供 `apiRequest`、`apiDownload` 和 `formatApiError`，统一 credentials、`no-store`、401 事件、结构化错误和二进制错误处理；保持 `apiFetch` 兼容。
- T7.2 将 API Console 的 OpenAPI、普通请求和 Loop 4 场景请求接入共享 seam；诊断请求使用 `unauthorized: "none"` 与不抛错模式，4xx/401 仍呈现在结果面板。
- T7.3 新增 Evidence/Review 受控展示边界；Export 使用 `apiDownload` 读取固定 Revision Blob，保留 Approved 门禁、按钮 class、下载文件名和现有 API 路径。
- T7.4 将工作台、插件页和导出错误投影统一为 `formatApiError`，补齐共享 seam、导出失败和 API Console 401 不跳转测试，再运行 Web/全仓验证。

T7.1–T7.4 已完成：共享 `apiRequest`/`apiRawRequest`/`apiDownload`/`formatApiError` 已接入 API Console、工作台、插件和固定 Revision 导出；Evidence/Review/PluginTrace/Export 展示边界已抽出，API Console 401 smoke 与导出回归通过。本轮不迁移 Evidence/Review 的服务端 Query 所有权，也不执行 T8 页面组合层审计。

### T8 实施子任务（本轮）

- T8.1 将 Snapshot 预览的列表/详情 fetcher、版本排序、状态投影和请求竞态保护迁移到 `features/data-snapshot/use-snapshot-preview.ts`；控制器统一使用共享 HTTP seam，并通过 `AbortController` 在关闭、切换版本或重新打开时中止旧请求。
- T8.2 页面只保留“当前 Asset 是否允许打开预览”的业务门禁和 `SnapshotPreviewModal` 展示；Modal 继续负责 DOM、CSS、焦点和空/错/加载态，不复制请求逻辑。
- T8.3 补充 Snapshot fetcher/排序/错误投影单测，运行 Web typecheck、unit、build 和桌面/移动工作台 E2E；本轮不迁移 Evidence/Review 的剩余业务状态，也不启动 T9 独立验收。

T8.1–T8.3 已完成本轮切片：Snapshot controller 已接管列表/详情读取、版本排序、Abort/stale-response 防护、关闭清理和重试；页面仅保留打开门禁与 Modal 展示映射。21 个 Web unit、Web/全仓 typecheck、Web/全仓 build、Web/全仓 test、18 条桌面/移动 E2E、docs:check 和 `git diff --check` 已通过。当时未标记的 Evidence 组合层已在 T8.10–T8.11 完成，Review 组合层与公共组件审计仍待后续切片。

### T8 Review comments controller 子任务（本轮）

- T8.4 新增 `features/review/use-review-comments.ts`，把评论列表、审核意见草稿、刷新/新增请求和加载/保存状态从页面移出；使用共享 HTTP seam，不复制 401 或错误解析。
- T8.5 页面保留 Revision 状态转换和 Evidence Query 回填；ReviewPanel 继续接收受控 props，Revision 切换时旧评论和草稿清理，迟到响应不能覆盖新 Revision。
- T8.6 增加 Review controller fetcher/竞态边界单测，并在现有桌面/移动审核链路验证刷新评论、添加评论、批准门禁；不进入 T9。

T8.4–T8.6 已完成本轮切片：Review comments controller 已接管评论读取/新增、审核意见草稿和请求竞态清理；页面仍保留 Revision 状态转换与 Evidence Query 回填。22 个 Web unit、Web/全仓 typecheck、Web/全仓 build、Web/全仓 test、18 条桌面/移动 E2E（含刷新评论、添加评论和批准门禁）、docs:check 和 `git diff --check` 已通过。Evidence canvas 已在后续 T8.10–T8.11 收敛；Review 组合层与公共组件审计仍未标记完成。

### T8 Plugin trace controller 子任务（本轮）

- T8.7 新增 `features/evidence/use-plugin-trace.ts`，接管 Plugin Context fetcher、快照结构校验、`loading/empty/invalid/error/ready` 投影和 Abort/stale-response 防护；保留既有 API 路径与 `PluginTrace` 展示组件。
- T8.8 页面删除 `parsePluginSnapshot`、Plugin Trace 本地 state/effect，只传入当前 Revision ID；全局错误 banner、Evidence Query、Revision transition 和插件展示语义保持不变。
- T8.9 增加 parser/fetcher 单测并验证桌面/移动插件追溯状态；不迁移 Plugin Query、不修改 API Console、不进入 T9。

T8.7–T8.9 已完成本轮切片：Plugin trace controller 已接管 Plugin Context 读取、快照结构校验和 Revision 切换 Abort/stale-response 防护；页面只保留 `PluginTrace` 展示映射。24 个 Web unit、Web/全仓 typecheck、Web build、Web unit、18 条桌面/移动 E2E（含空插件快照、审核、导出链路）、docs:check 和 `git diff --check` 已通过。Evidence canvas 已在后续 T8.10–T8.11 收敛；Review 组合层与公共组件审计仍未标记完成。

### T8 Evidence canvas 组合切片（本轮）

- T8.10 新增 `features/evidence/evidence-canvas.tsx`，把 Evidence 标题、Revision 状态、图表 slot、发现、快照/指标/版本摘要、质量提示、编辑/依据/导出/提交审核动作和 trace cards 收敛为受控展示组件；不持有 Query、Revision mutation、Editor state 或 Plugin/Review 请求生命周期。
- T8.11 页面只组装 Evidence record 的窄 props，`InteractiveChart` 仍由页面提供为 React node；保留现有 DOM class、按钮文案、Approved/archived 编辑门禁、Approved 导出门禁和 `showTrace` 行为。不把 EvidenceCanvas 提升到 `components/*`，因为它仍是 Evidence feature 的领域展示合同。

T8.10–T8.11 已完成本轮切片：页面 Evidence JSX 已替换为 `EvidenceCanvas` 受控调用，API、Query ownership、Revision transition、Chart Editor 和 CSS 均未迁移。Web typecheck、24 个 Web unit、18 条桌面/移动 Playwright E2E 和 `git diff --check` 已通过；Review 剩余组合层与跨 feature 公共组件审计仍未标记完成。

### T8 Review composition 组合切片（本轮）

- T8.12 新增 `features/review/review-composition.tsx`，收敛 `in_review` 状态门禁和 `useReviewComments` → `ReviewPanel` 的受控 props 投影；非审核状态在 feature 边界返回空，页面不再重复 Review 显示条件。
- T8.13 页面继续拥有 `transitionRevision`、Evidence Query 写回、错误/通知和 URL/Revision 选择；ReviewPanel 的 DOM/CSS、评论 controller、审核意见草稿和 Approved/Changes Requested 业务语义保持不变。

T8.12–T8.13 已完成本轮切片：Review 组合边界已下沉，不新增 API、Query key、共享组件或 Revision 状态机。Web typecheck、24 个 Web unit、18 条桌面/移动 Playwright E2E 和 `git diff --check` 通过；跨 feature 公共组件审计已在后续 T8.14–T8.15 完成，真实 logout/cache 与 T9 仍未标记完成。

### T8 跨 feature 公共组件审计切片（本轮）

- T8.14 审计工作台、插件、登录、API Console 与 feature 展示组件的复用关系；确认只有工作台/插件的全局错误与通知条具备稳定、无领域状态的共享契约。
- T8.15 新增 `components/feedback/alert-banner.tsx`，迁移工作台和插件页的 error/notice banner；保留现有 `.alert`、`.error-alert`、`.notice-alert` class、role、文案和关闭回调。`InteractiveChart`、Snapshot、Evidence、Review、Plugin 和 Editor 保持 feature/page 所有权。

T8.14–T8.15 已完成本阶段切片：公共反馈条完成最小提取，领域专属组件未被过度抽象。Web typecheck、test:typecheck、24 个 Web unit、Web build、18 条桌面/移动 E2E、docs:check 和 `git diff --check` 通过；下一步进入 T9 独立验证与验收。

### T8.16 Evidence 中心画布与并行抽屉视觉细化（本轮）

- T8.16.1 将工作台默认状态改为中心画布优先；历史和依据 drawer 保持独立开关，可同时打开，宽屏使用剩余空间布局。
- T8.16.2 新增依据抽屉 300–560px 的 pointer/keyboard resize seam；宽度只保存在当前页面内，关闭或刷新回到 360px。
- T8.16.3 将 Snapshot 预览从全屏 modal 迁入依据抽屉 slot；预览关闭统一关闭依据抽屉，保留 controller 的请求、Abort、错误和只读表格行为。
- T8.16.4 调整移动端历史/依据为 bottom sheet，补充 drawer close/focus/keyboard 语义，保留 44px 触控目标与 reduced-motion。
- T8.16.5 仅调整工作台 CSS 和必要 JSX/state；不改 API、Query key、领域状态、生成 Job、Revision 或 Review 合同。

### T9 独立验证与验收（本阶段）

独立验证角色在 `e800fe7` 完整实现快照上执行只读复核，期间未修改文件或提交代码。以下命令全部通过：

- `pnpm --filter @langreport/web typecheck`
- `pnpm --filter @langreport/web test:typecheck`
- `pnpm --filter @langreport/web test`（24/24）
- `pnpm --filter @langreport/web build`
- `pnpm --filter @langreport/web test:e2e`（桌面 + 390px 移动端 22 条中 20 条通过，2 条 live-auth 跳过）
- `pnpm docs:check`、`git diff --check`
- `pnpm typecheck`、`pnpm test`、`pnpm build`

复核覆盖 Auth/HTTP seam、受保护路由、URL/Query 作用域、Generation、Chart Editor、Snapshot/Review/Plugin controller、Evidence/Review 组合、AlertBanner、API Console 401 和桌面/移动主路径。当前验证仍为与主 Agent 共享工作区的只读快照，不是隔离 worktree；不能将其描述为隔离环境验证。真实同源部署 Cookie 的 logout/cache 场景和登录网关真实 HTTPS smoke 继续作为外部验收条件。

### T9.1 浏览器 logout/cache 验收场景

- `apps/web/test/e2e/login.spec.ts` 新增浏览器 Cookie Jar 场景：验证 logout 请求携带会话 Cookie、响应清除 Cookie、Project/Conversation localStorage 选择被清理、`langreport:generation-abort` 广播触发、登录页不显示旧工作台 DOM，并在重新登录后恢复工作台。
- `apps/web/test/e2e/auth-live.spec.ts` 提供真实同源部署验收入口；设置 `LANGREPORT_E2E_BASE_URL`、`LANGREPORT_E2E_USERNAME` 和 `LANGREPORT_E2E_PASSWORD` 后，使用真实 API/Cookie 验证登录、Project 读取、登出和保护页回跳。未提供部署凭据时测试显式跳过，不把 route mock 当成真实部署证据。
- `playwright.config.ts` 在提供 `LANGREPORT_E2E_BASE_URL` 时不启动本地 Web server，允许直接针对 HTTPS 同源部署运行 live test；默认本地 E2E 行为保持不变。

本地新增登出场景在桌面和 390px 移动端均通过；完整 Web E2E 当前为 20 passed、2 skipped（live-auth 缺少部署凭据）。

### T3 实施子任务

- T3.1 建立 Conversation、Data Asset、Evidence 和 Project resource 的 query key/fetcher；不改变 API 路径和响应合同。
- T3.2 建立 `useProjectServerState` 组合 hook，按 authenticated user、Project、Conversation 启用查询，并统一 loading/error 投影。
- T3.3 移除 Conversation、Asset、Metric/Brief/Memory、Evidence/Messages 对应的实体 `useState` 和项目切换 `Promise.all`，改由 Query data 驱动；保留既有 Project list 启动适配器、选择 ID、表单和 Job 本地状态。
- T3.4 将创建对话、发送消息、上传/粘贴数据、确认指标、保存 Brief、Generation 终态和 Review 状态更新接入 `setQueryData` 或精确失效。
- T3.5 补充 key 作用域、fetcher 和 Query 更新单测，运行 Web 与全仓验证；失败时回滚本次 Query adapter，不回退统一 HTTP/Auth seam。已完成：12 个 Web unit、Web/全仓检查和 16 条浏览器回归通过。

## 并行工作流

- 主 Agent：T0–T8 的文档、架构、业务代码和失败修复。
- 独立验证角色：T9 从完整实现快照执行 test-plan，修改测试报告和必要测试文件，不修改业务代码。
- 若无法提供隔离 worktree，主 Agent 必须在 test-report 中记录等价只读快照和限制；不能把同一工作树的自测描述为独立验证。

## 阻塞条件

- 用户未批准本变更的 AuthGate、Query、URL 和 API Console 策略时，不能进入业务代码实现。
- 登录网关的 Cookie 合同、开发/生产边界或 401 错误码发生变化时，本变更返回 PROPOSED，不能静默适配。
- 发现需要新增 API、Contracts、用户表、Session 表或权限模型时，停止并建立新的变更范围。
- 现有 E2E、Job watcher 或固定 Revision 行为发生回归时，暂停后续 feature 拆分，先恢复行为。

## 回滚或替代方案

- 每个迁移任务保持小 commit，回滚优先撤回 Query/route/feature adapter，保留登录网关和既有业务 API。
- 若 TanStack Query 依赖导致构建或运行问题，保留 Auth seam、HTTP client 和 feature 目录，暂时改用自有 cache adapter；不能退回页面各自处理 401。
- 若 URL path 迁移造成 E2E 或外部链接回归，保留 `/` 入口并先使用 query 参数，不删除旧 URL。
- 若 API Console 的公开诊断策略未获批准，先把它排除出 protected group 迁移，单独记录决策，不改变业务接口权限。

## Definition of Done

- [ ] proposal、design、task、test-plan 已获用户审核，关键未决问题已关闭。
- [ ] Auth module、HTTP client、AuthGate、Query key/invalidation 和 URL context 有可测试接口。
- [ ] 工作台、插件、登录和 API Console 的认证行为没有重复实现或重定向循环。
- [ ] `page.tsx` 不再直接持有业务 HTTP 请求、服务端实体副本和跨 feature Job 编排。
- [ ] Project/Conversation/Revision 可由 URL 恢复，登出清理 Query cache 和 watcher。
- [ ] Chart Editor、Generation、Evidence、Review 的领域行为与重构前一致。
- [ ] Web typecheck、test:typecheck、Web unit/E2E、全仓 typecheck/test/build/docs:check 通过。
- [ ] acceptance.md、handoff.md 和需求追踪矩阵已同步，未把未验证内容标为通过。
- [x] T8.16 的中心画布、并行抽屉、依据宽度拖拽、Snapshot 覆盖预览和移动 bottom sheet 在设计基线下通过验证。
