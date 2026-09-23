# Web 工作台认证感知架构重构：Handoff

- 变更编号：`CHG-2026-09-22-WEB-WORKBENCH-ARCHITECTURE`
- 状态：`VERIFYING / PARTIAL`
- 创建时间：2026-09-22
- 更新时间：2026-09-23

## 当前状态

本变更已根据 2026-09-22 工作区代码快照进入实现；当前为 `VERIFYING / PARTIAL`，保留后续 feature slices。

## 已完成

- 读取并核对根规则、LangReport 产品边界、项目基线和登录网关变更记录。
- 确认登录网关已移除开发身份绕过，开发/生产均使用登录边界；登录变更仍独立处于复测阶段。
- 统计工作台现状：约 10.65 万字符、57 个 `useState`、9 个 `useEffect`、38 次 `apiFetch`。
- 识别工作台、插件页、登录页之间重复的 HTTP、session 和 401 处理。
- 建立 Auth seam、HTTP client、Query、URL context、Feature module 和 reducer 的迁移设计。
- 新增 `apps/web/lib/http-client.ts`，统一 Cookie 请求、错误归一化、安全 `returnTo` 和 401 事件。
- 新增 `apps/web/features/auth/*`、`app/query-provider.tsx`，并将 `/`、`/plugins` 放入 `(protected)` route group。
- 新增 `hooks/use-project-context.ts`，项目/对话/Revision 选择支持 URL 恢复；显式 URL 优先于 localStorage。
- 新增 `features/generation/generation-state.ts` 与 `use-generation-job.ts`，保留 watcher 单飞/Abort/fallback 语义并抽出终态协调。
- 新增 `features/project/project-queries.ts`，项目列表开始使用 TanStack Query 作用域缓存。
- 完成 T3：新增 Conversation、Data Asset、Evidence、Project resource query key/fetcher 与 `useProjectServerState`；工作台的 Conversation、Asset、Metric/Brief/Memory、Evidence/Messages 不再由实体 `useState` 持有，写操作统一回填 Query cache。
- 完成 T5 首轮 feature slice：`features/project/project-panel.tsx`、`features/conversation/conversation-panel.tsx`、`features/data-snapshot/data-asset-panel.tsx`、`features/analysis-brief/analysis-brief-form.tsx` 和 `metric-form.tsx` 接管 Project/Conversation/Data Asset/Analysis Brief/Metric 的展示边界；页面只保留受控状态、Query 投影和业务回调，未改变 API、认证或 CSS。
- 完成 T6 Chart Editor reducer：`features/chart-editor/chart-editor-state.ts` 接管 EditorState、Revision→表单投影、字段更新 reducer、筛选值类型归一化和 TransformPlan 构造；页面保留 modal 展示、API mutation 和 Generation Job 协调。
- 完成 T7 共享请求/错误策略：`lib/http-client.ts` 提供 `apiRequest`、`apiRawRequest`、`apiDownload` 和 `formatApiError`；API Console、工作台、插件、Evidence/Review、固定 Revision Export 使用同一 seam，诊断 401 保留在结果面板。
- 新增 Evidence `PluginTrace`、`RevisionExport` 和 Review `ReviewPanel` 受控展示边界，保留原有 CSS、DOM 语义、Approved 门禁和 API 路径。
- 完成 T8 Snapshot controller 首个切片：新增 `features/data-snapshot/use-snapshot-preview.ts`，统一 Snapshot 列表/详情 fetcher、版本排序、Abort/stale-response 防护、关闭清理、重试和错误投影；页面只保留打开门禁与 `SnapshotPreviewModal` 展示映射。
- 完成 T8 Review comments controller 切片：新增 `features/review/use-review-comments.ts`，统一评论列表/新增、审核意见草稿、Revision 切换清理和 Abort/stale-response 防护；页面继续拥有 Revision 状态转换与 Evidence Query 回填，ReviewPanel 保持受控展示。
- 完成 T8 Plugin trace controller 切片：新增 `features/evidence/use-plugin-trace.ts`，统一 Plugin Context fetcher、快照结构校验、Revision 切换清理和 Abort/stale-response 防护；页面只保留 `PluginTrace` 展示映射。
- 新增 24 个 Web unit 测试覆盖 Chart Editor、T7 HTTP/Export seam、Project/Server Query key 与 fetcher、Snapshot controller fetcher/排序、Review comments controller fetcher/竞态、Plugin trace parser/fetcher、watcher、Generation reducer、URL context；桌面/移动 Playwright 18/18 通过。

## 进行中

- API Console 采用公开诊断入口，Project 使用 query `project`、Conversation/Revision 使用 `conversation`/`revision`；API Console 401 不跳转策略已接入共享 seam 并通过桌面/移动 smoke。
- 登录网关独立复测仍作为外部发布条件，不修改其服务端实现。
- T5 首轮 feature slices、T6 Chart Editor reducer、T7 请求/错误 seam 与 T8 Snapshot/Review comments/Plugin trace controller 切片已完成；Evidence/Review 服务端 Query 所有权、T8 剩余页面组合层/公共组件审计和独立验证仍未完成；T3 Query 迁移已完成本轮闭环。

## 下一步

1. 继续 T8 的剩余 Evidence/Review 页面组合层与公共组件审计，保持 T5–T7 受控边界和本轮 Snapshot/Review comments/Plugin trace controller 不变。
2. 补真实 logout/cache 清理 E2E，并执行独立验证角色。
3. 完成后再进入 T9 独立验收、旧实现清理和最终结论。

## 当前 commit 与修改范围

- 当前分支：`main`
- 本变更新增范围：`docs/changes/2026-09-22-web-workbench-architecture/`、`apps/web/lib/`、`apps/web/features/`、`apps/web/hooks/`、`apps/web/app/(protected)/`、`apps/web/app/query-provider.tsx` 及对应测试/依赖。
- 工作区已有登录及相关 API/Web 修改属于 `CHG-2026-09-22-login-gateway`，本变更不覆盖、不重置。

## 已运行验证

- Web typecheck、test:typecheck、24 个 unit、Next build、全仓 typecheck/test/build、docs:check 和 Playwright 18/18 已通过；证据详见 `test-report.md`。
- API Console 401 smoke、Snapshot 预览、Review comments 和 Plugin trace 桌面/移动回归已通过；真实 logout cache 清理、T8 剩余审计、独立验证和 T9 仍未完成，不能将本变更标为 COMPLETE。

## 已确认决策

- 不修改登录网关的服务端协议和配置。
- 生产/开发均使用登录边界；前端不把 `x-user-id` 当作业务认证事实。
- TanStack Query 只管理服务端状态；表单、Modal、编辑器使用本地状态/reducer。
- Generation watcher 保留为 transport Adapter，UI 协调抽到 generation module。
- Approved Revision、Workspace/Project 权限和 API 领域校验仍由服务端负责。

## 已知问题与未决问题

- 登录网关的真实 HTTPS Secure Cookie smoke 尚未在部署环境完成。
- API Console 公开诊断策略按推荐默认值执行，业务 401 不跳转 smoke 已补；仍需真实部署环境验证。
- 为保持 `/` 兼容，Project/Conversation/Revision 当前均采用 query，而不是新增 path route。
- TanStack Query `^5.103.2` 已写入 `apps/web/package.json` 和 lockfile。

## 新会话启动必读

1. 根 `AGENTS.md`、`CONTEXT.md`、`docs/project-spec.md`。
2. `docs/changes/2026-09-22-login-gateway/` 的当前状态和 handoff。
3. 本目录的 `proposal.md`、`design.md`、`task.md`、`test-plan.md`。
4. `apps/web/AGENTS.md` 和根 `DESIGN.md`。
5. 开始实现前检查 `git status`，只修改已批准范围。
