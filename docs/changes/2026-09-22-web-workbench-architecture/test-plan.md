# Web 工作台认证感知架构重构：Test Plan

- 变更编号：`CHG-2026-09-22-WEB-WORKBENCH-ARCHITECTURE`
- 状态：`VERIFYING`
- 创建时间：2026-09-22
- 更新时间：2026-09-23

## 测试范围

验证登录网关已存在的 Web 合同在架构迁移后不回归，并验证工作台的认证上下文、远端状态、URL 状态、Generation Job、Chart Editor、Evidence、Review 和 Plugin feature 可以独立演化。测试不重新证明 API scrypt/JWT 实现；该部分由 `CHG-2026-09-22-login-gateway` 负责。

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| 页面各自处理 401 产生分叉 | unit + E2E | 工作台、插件、登录和 API Console 同时收到 401 | 业务页只跳 `/login` 一次；Auth/API Console 请求不循环跳转 |
| 登出后旧用户缓存残留 | Query unit + browser | 登录→读取 Project→登出→重新登录/访问 | Query cache、选择状态、Job watcher 清理，DOM 不显示旧数据 |
| Cookie 未随请求发送 | HTTP client unit + E2E | login 后读取 session、Project、Evidence | 所有 required 请求使用 `credentials: include`，session 恢复成功 |
| login/session/logout 被 Query 拦截 | Auth unit + E2E | 错误凭据、429、503、logout | 登录页保留错误；logout 幂等；不触发错误跳转循环 |
| URL 与 localStorage 冲突 | URL unit + E2E | URL 指向 A，localStorage 记住 B；刷新/前进后退 | URL 优先；无权限 ID 进入可解释空态或回退项 |
| 切换上下文收到迟到响应 | watcher unit + E2E | 切换 Project/Conversation/Job 时旧请求延迟返回 | Abort 或 session/query key 阻止旧数据写入 |
| Query key 未包含作用域 | Query unit + integration | 两个 Project 使用同名 Conversation/Revision | 缓存不串 Project、Workspace 或用户 |
| Job 终态刷新不完整 | watcher/reducer unit + live smoke | succeeded、needs_clarification、failed、cancelled、edit | Evidence/Revision/Conversation 按规则重新读取，状态与旧行为一致 |
| Editor 拆分改变业务逻辑 | pure unit + E2E | 视觉编辑、筛选/聚合/排序、Approved 只读 | TransformPlan、Revision append-only、Approved 禁止编辑均不变 |
| Feature 提取后遗漏空/错/加载态 | browser visual/manual | 首次空态、上传中、401、错误、移动端 390px | 信息层级、触控区域、对比度、溢出和下一步动作可用 |
| API Console 诊断行为回归 | E2E/manual | Auth login/session/logout 与未登录业务请求 | Auth 操作可调试；业务 401 展示稳定错误，不自动跳转 |

## 测试数据与环境

- 使用登录变更提供的固定测试账号和 Cookie 合同；不在测试报告输出密码、JWT 或 Cookie 值。
- 使用现有 Playwright route fixture 覆盖快速 UI 回归，并增加真实同源 Cookie 场景。
- 390px 和桌面 viewport 各覆盖登录、工作台、插件和主要空/错/加载态。
- Generation 测试沿用现有 watcher 测试数据；新增 reducer 状态序列 fixture。
- Query 测试使用内存 request adapter，不把测试绑定到真实 API 进程；至少一个 live smoke 验证同源 API 连接。

## 自动化测试

```text
pnpm --filter @langreport/web typecheck
pnpm --filter @langreport/web test:typecheck
pnpm --filter @langreport/web test
pnpm --filter @langreport/web test:e2e
pnpm docs:check
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

本阶段已实际运行并通过：

- `pnpm --filter @langreport/web typecheck`
- `pnpm --filter @langreport/web test:typecheck`
- `pnpm --filter @langreport/web test`（24 个单测：Chart Editor reducer/Revision 投影/TransformPlan、HTTP/Auth/Export seam、Project/Server Query key 与 fetcher、Snapshot controller fetcher/排序、Review comments controller fetcher/竞态、Plugin trace parser/fetcher、watcher、generation reducer、URL context）
- `pnpm --filter @langreport/web build`
- Playwright 桌面与 390px 移动端全量回归（18 passed，含 API Console 401 smoke）
- T5 feature slice 回归：Project/Conversation/Data Asset/Analysis Brief/Metric 受控组件通过同一套 typecheck、unit、build 和 16 条桌面/移动 E2E；未新增 API 或 CSS 规则。
- T6 Chart Editor 回归：reducer reset/field update、Revision 投影、筛选值类型归一化、derive 保留和排序回退单测通过；编辑器桌面/移动 E2E 通过。
- T7 请求/错误 seam 回归：`apiRequest`/`apiDownload` 的 Cookie、`no-store`、401 策略、结构化错误、非 JSON 错误和二进制失败；API Console 使用 `unauthorized: "none"` 时不触发登录跳转；固定 Approved Revision 导出仍绑定原路径且失败可解释。
- T8 Snapshot controller 回归：列表按版本降序排序；列表/详情 fetcher 透传 `AbortSignal` 并保留共享 HTTP seam；控制器关闭或切换版本时旧请求不能回填，错误状态继续映射到 Modal 可读文案。
- T8 Review comments controller 回归：评论列表/新增 fetcher 透传 `AbortSignal`、使用共享 credentials/cache；切换 Revision 或新请求开始时旧响应不能回填；审核意见草稿、刷新评论、添加评论和批准门禁在桌面/移动链路保持可用。
- T8 Plugin trace controller 回归：Plugin Context fetcher 透传 `AbortSignal` 并使用共享 credentials/cache；空快照、合法快照、非法 Renderer/能力结构和网络错误映射保持稳定；Revision 切换时旧响应不能覆盖当前插件追溯，桌面/移动 Evidence 链路保持可用。
- T8 Evidence canvas 组合回归：`EvidenceCanvas` 只接收受控 props，Evidence 图表、发现、快照/指标/版本摘要、质量提示、依据、导出和提交审核入口保持现有 DOM/门禁语义；桌面与 390px 移动端固定 Revision、审核和图表编辑链路通过。
- T8 Review composition 组合回归：`ReviewComposition` 只负责 `in_review` 显示门禁和 controller props forwarding；非审核 Revision 不渲染 Review 面板，审核中仍可刷新/新增评论、提交修改请求和批准，桌面与 390px 移动端行为保持一致。
- T8 公共反馈组件回归：`AlertBanner` 在工作台和插件页复用全局 alert class，error/notice 的 role、文案、关闭动作和移动布局保持一致；领域专属组件不被错误上移。

全仓 `typecheck/test/build` 与 `docs:check` 已通过；API Console 401 smoke、Snapshot 预览、Review comments、Plugin trace、Evidence canvas 和 Review composition 桌面/移动回归已通过，AlertBanner 的复用契约通过类型检查、生产构建和现有页面回归验证；T8 页面组合层与公共组件审计完成，独立验证角色和真实 logout/cache 场景仍属于 T9/登录网关后续验收。

新增或迁移的测试建议：

- `apps/web/test/unit/auth-client.test.ts`
- `apps/web/test/unit/http-client.test.ts`
- `apps/web/test/unit/query-keys.test.ts`
- `apps/web/test/unit/url-context.test.ts`
- `apps/web/test/unit/generation-job-reducer.test.ts`
- `apps/web/test/unit/project-server-queries.test.ts`
- `apps/web/test/unit/snapshot-preview.test.ts`（新增 Snapshot controller fetcher、排序和初始状态覆盖）
- `apps/web/test/unit/review-comments.test.ts`（新增 Review comments fetcher、AbortSignal 和响应解包覆盖）
- `apps/web/test/unit/plugin-trace.test.ts`（新增 Plugin Snapshot parser、fetcher、空/非法结构和 AbortSignal 覆盖）
- `apps/web/test/unit/generation-job-status-watcher.test.ts`（保留并扩展）
- `apps/web/test/unit/http-client.test.ts`（扩展 apiRequest/apiDownload/formatApiError）
- `apps/web/test/unit/revision-export.test.ts`（新增固定 Revision 导出与错误路径）
- `apps/web/test/e2e/login.spec.ts`（保留并扩展）
- `apps/web/test/e2e/consulting-report.spec.ts`（保留现有选择器和主路径）

## 人工验收步骤

1. 未登录打开 `/` 和 `/plugins`，确认进入 `/login`，并且 `returnTo` 只包含同源路径。
2. 输入错误凭据、触发限流、输入正确凭据，确认错误不泄露账号状态，密码不会出现在 URL、storage 或历史记录。
3. 登录后刷新并复制带 Project/Conversation/Revision 的 URL，确认上下文可恢复。
4. 在工作台发起 Generation Job，切换 Conversation 或 Project，确认旧 Job watcher 不会覆盖新上下文。
5. 在 Evidence 中打开 Editor，分别执行视觉修改和逻辑修改，确认 Revision/TransformPlan 规则不变。
6. 登出后确认旧 Evidence/Project 不短暂显示；重新登录后只看到当前身份可访问的数据。
7. 访问 API Console，验证 Auth 操作可以调试，未登录业务请求展示 401 且页面不跳转。
8. 在桌面和 390px 宽度检查登录、加载、空态、错误、Approved 只读和移动 Inspector。

## 不测试的内容及原因

- API 端 scrypt、JWT claim、Cookie Secure/SameSite 和生产限流：属于登录网关变更的测试计划。
- 多账号并发、用户注册、MFA、OAuth/OIDC 和共享 Session Store：不在第一阶段范围。
- 新增 API 或领域模型：本变更明确不做；若实现需要则重新规划。
- 视觉风格重新设计：只验证现有 DESIGN.md 规则在拆分后保持一致。
