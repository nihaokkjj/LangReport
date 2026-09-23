# Web 工作台认证感知架构重构：Proposal

- 变更编号：`CHG-2026-09-22-WEB-WORKBENCH-ARCHITECTURE`
- 状态：`APPROVED`
- 创建时间：2026-09-22
- 更新时间：2026-09-22

> 用户于 2026-09-22 指示执行本变更；按兼容现有 `/` 入口的实现方案采用公开 API Console 诊断入口，Project/Conversation/Revision 均使用 query，并进入实现阶段。

## 背景

LangReport 的登录网关已在 `CHG-2026-09-22-login-gateway` 中实现：开发与生产统一使用登录边界，浏览器通过 HttpOnly `langreport_session` Cookie 访问业务 API，登录、会话恢复、登出和 401 恢复已有代码与 E2E 覆盖。该变更目前仍处于独立复测阶段，本变更不修改其认证协议、配置或服务端实现。

登录加入后，Web 工作台的前端状态边界更加重要。当前 `apps/web/app/(protected)/page.tsx` 仍是一个高密度工作台入口，承载 Project、Conversation、Data Snapshot、Analysis Brief、Metric Definition、Generation Job、Chart Revision、Evidence、Review、上传、模型凭据和多个 Modal。插件页又复制了请求、开发初始化和 401 跳转逻辑。

本变更是基于 2026-09-22 工作区快照的结构重构规划，不以文件数量作为目标，而以认证身份切换、服务端缓存、URL 恢复和业务模块 locality 作为目标。

## 要解决的问题

1. `page.tsx` 同时保存远端实体、表单草稿、Job 监听、编辑器状态和临时 UI 状态，修改一个业务流程需要理解整页状态簇。
2. 工作台、插件页和登录页各自实现 HTTP 请求和 401 处理，登录成功、登出或会话失效后的行为可能分叉。
3. Project 和 Conversation 当前主要依赖 `localStorage` 恢复，不是可复制、可前进后退的 URL 状态。
4. 引入 Cookie 登录后，若 Query/cache 不按认证身份清除，登出或切换身份可能短暂展示旧用户的 Project、Evidence 或 Plugin 数据。
5. 现有 Generation Job watcher 已有单飞、Abort 和迟到响应保护，但仍嵌在页面业务编排中，无法作为独立的生成状态模块测试。

## 目标用户与使用场景

- 已登录的咨询顾问：进入工作台，选择 Project，继续 Conversation，导入数据并生成 Evidence Block。
- 已登录的 Reviewer：打开固定 Revision，查看依据、评论、要求修改或批准。
- 部署维护者：在登录页建立会话、刷新恢复会话、登出并验证业务缓存已清除。
- 内部 API 调试者：在 API Console 调试 login/session/logout；未登录调用业务接口时看到稳定 401，而不发生不可控跳转。

## 需求范围

### MVP

1. 建立唯一的 Web Auth module，统一 session、login、logout、safe `returnTo` 和 401 处理。
2. 将工作台与插件管理放入受保护的 route group；登录页保持公开。
3. 将业务 HTTP 请求、错误合同和 `credentials: include` 收口到一个客户端 seam。
4. 引入 TanStack Query 管理服务端状态，建立按用户、Workspace、Project 和 Conversation 作用域的 query key 与失效规则。
5. 将当前 Project、Conversation、Revision 纳入 URL；`localStorage` 只保留可选的最近选择偏好，不作为事实来源。
6. 按业务 feature 拆分页面，并将 Chart Editor 与 Generation Job 协调逻辑分别收进 reducer/module。
7. 保持现有 API、Generation、Revision、Review、导出和 API Console 的业务行为不变。

### 后续范围

- 多账号、用户注册、密码修改/找回、MFA、OAuth/OIDC 和多设备会话。
- Workspace 成员管理与 Project Role UI。
- 服务端组件直接读取会话 Cookie 的 SSR/边缘渲染优化。
- 完整的跨页面导航重设计和新的视觉语言。

## 明确不做

- 不修改 `CHG-2026-09-22-login-gateway` 的 JWT、Cookie、scrypt、限流或生产部署合同。
- 不新增用户表、Session 表、Refresh Token 或共享 Session Store。
- 不改变第一阶段咨询项目报告的领域实体、Generation Job 状态机、Chart Revision append-only 规则或 Evidence 事实链。
- 不引入 Redux、Zustand 或状态机库；Generation UI 先使用 reducer，TanStack Query 只管理服务端状态。
- 不将 `apps/web/app/api-console` 改造成产品业务页；它仍是诊断入口。
- 不以“拆出更多文件”替代可测试的模块接口；公共 `components/` 只收纳两个以上 feature 确实复用的模块。

## 成功指标

- 工作台和插件页只通过同一个 HTTP client 处理业务请求、Cookie 和 401。
- 未登录访问受保护页面进入 `/login`；登录后安全返回原页面；失效会话不形成重定向循环。
- 登出或用户身份变化后，Query cache、当前选择和 Job watcher 均被清理或中止，旧用户数据不再显示。
- 刷新或复制 URL 后，Project、Conversation、Revision 能恢复；URL 中不包含密码、JWT 或 Cookie 值。
- `page.tsx` 只保留工作台组合与布局编排，不直接实现业务请求和跨 feature 的远端缓存。
- 现有 login E2E、Generation watcher 单测、咨询工作台 E2E、类型检查和 live smoke 行为保持通过。

## 假设、依赖与风险

- 依赖 `CHG-2026-09-22-login-gateway` 完成范围调整后的独立复测；真实 HTTPS smoke 是登录变更的发布条件，但不阻止本变更先完成文档审核。
- 当前 `apps/web/package.json` 尚未包含 TanStack Query；新增依赖必须有实际缓存、失效和身份切换收益，不能只用于简历关键词。
- Next route group 不改变现有 `/`、`/plugins`、`/login` URL；迁移过程中必须保留现有 E2E 选择器和 API 行为。
- API Console 是否需要登录取决于其诊断用途。本变更默认保留其公开入口：Auth 操作可调用，业务操作未登录时显示 401 且不自动导航；若部署侧要求完全隐藏 API Console，应在审核时改为受保护路由。
- 旧工作区已经有登录相关未提交修改；实现时只修改本变更新增的文件或明确列出的 Web 文件，不重置、不覆盖既有修改。

## 未决问题

1. API Console 是否维持公开诊断入口（推荐）还是纳入受保护 route group。
2. TanStack Query 的版本和是否由根 workspace 统一管理，需在实现前按当前 pnpm lockfile 确认。
3. URL 实现首阶段保留 `/` 入口，使用 `?project=:projectId&conversation=:conversationId&revision=:revisionId`；后续若需要 `/projects/:projectId` 分享链接，另建兼容迁移并保留旧入口。

## 验收标准概要

1. Auth module、HTTP client、AuthGate 和 Query cache 的接口可单独测试，页面不再复制 401 跳转。
2. `/` 和 `/plugins` 的受保护访问、登录恢复、刷新恢复、登出清理和过期会话均有 Web E2E 证据。
3. Project/Conversation/Revision URL 状态可恢复，旧的本地偏好不会覆盖显式 URL。
4. Generation Job 的 watcher 与 reducer 可在不挂载完整工作台的情况下验证终态、澄清、失败、取消和切换上下文。
5. Feature 拆分后咨询项目报告的 API、数据血缘、审核和固定 Revision 导出行为不变。
6. 通过本变更 test-plan 中的 Web 类型检查、单测、E2E、文档检查和必要 live smoke。
