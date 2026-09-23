# Web 工作台认证感知架构重构：Test Report

- 变更编号：`CHG-2026-09-22-WEB-WORKBENCH-ARCHITECTURE`
- 验证时间：2026-09-23
- 快照：`e800fe7`（本轮跨 feature 公共组件审计提交快照）
- 结论：`PARTIAL / PASS FOR LOCAL AND SHARED-SNAPSHOT VERIFICATION`

## 已通过

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @langreport/web typecheck` | 通过 |
| `pnpm --filter @langreport/web test:typecheck` | 通过 |
| `pnpm --filter @langreport/web test` | 通过，24 个单测 |
| `pnpm --filter @langreport/web build` | 通过，Next.js 生产构建完成 |
| Playwright 桌面 + 390px 移动端 | 通过，22 条中 20 条通过；另有 2 条 live-auth 因未配置部署凭据跳过（含 API Console 401 smoke） |
| `pnpm typecheck` | 通过，workspace 与 test:typecheck 全部通过 |
| `pnpm test` | 通过，workspace 离线测试全部通过 |
| `pnpm build` | 通过，workspace build 全部通过 |
| `pnpm docs:check` / `git diff --check` | 通过 |

本轮跨 feature 公共组件审计复验：`pnpm --filter @langreport/web typecheck`、`pnpm --filter @langreport/web test:typecheck`、`pnpm --filter @langreport/web test`（24 个单测）、`pnpm --filter @langreport/web build`、Playwright 桌面 + 390px 移动端（22 条中 20 条通过；live-auth 2 条因缺少环境变量跳过）、`pnpm docs:check` 和 `git diff --check` 均通过。T8.16 的中心画布、并行抽屉、依据宽度拖拽和 Snapshot 覆盖位已由桌面/移动 E2E 覆盖。`AlertBanner` 只复用现有 global alert class；未新增 API、Query、Revision mutation 或视觉 token。

## T9 只读独立复核

独立验证角色基于当前 `main` 的 `e800fe7` 快照执行复核，期间未修改文件、未提交代码，最终工作区保持干净。可执行检查全部通过：

| 检查 | 结果 |
| --- | --- |
| Web typecheck / test:typecheck / 24 个 unit / build | 通过 |
| Web Playwright 桌面 + 390px 移动端 | 通过，22 条中 20 条通过；live-auth 2 条因缺少部署凭据跳过 |
| 全仓 `pnpm typecheck` / `pnpm test` / `pnpm build` | 通过 |
| `pnpm docs:check` / `git diff --check` | 通过 |

复核覆盖 Auth/HTTP seam、Cookie credentials 与 401 策略、受保护路由和登录回跳、URL/Query 作用域、Generation watcher/reducer、Chart Editor、Snapshot/Review comments/Plugin trace controller、Evidence canvas、Review composition、AlertBanner、API Console 401 不跳转、T8.16 抽屉/预览行为，以及桌面/390px 移动端主要状态。Playwright 在沙箱首次启动 Chromium 时遇到 `spawn EPERM`，获准启动本机浏览器进程后主回归为 22 条中 20 条通过；2 条 live-auth 仍因未配置部署凭据显式跳过。

本复核使用与主 Agent 相同的工作区快照，没有隔离 worktree；因此记录为“只读独立角色复核”，不宣称隔离环境验证。

## T9.1 浏览器 logout/cache 验证

- `pnpm --filter @langreport/web exec playwright test -c playwright.config.ts test/e2e/login.spec.ts`：通过，桌面 + 390px 移动端 6/6；新增场景验证浏览器 Cookie Jar、logout Cookie、localStorage 选择、Generation abort 事件、旧 DOM 和重新登录恢复。
- `pnpm --filter @langreport/web test:e2e`：通过，20 passed、2 skipped；2 条 skipped 为 `auth-live.spec.ts` 在未设置 `LANGREPORT_E2E_BASE_URL`、`LANGREPORT_E2E_USERNAME`、`LANGREPORT_E2E_PASSWORD` 时的显式保护。
- `apps/web/test/e2e/auth-live.spec.ts` 已提供真实同源部署测试入口。它不伪造 Cookie，也不使用 API route fixture；必须在 HTTPS 部署环境使用部署账号运行 `pnpm --filter @langreport/web test:e2e:auth-live`，结果才可作为真实 Cookie-only 证据。

单测覆盖 Chart Editor reducer 的 reset/field update、Revision 投影、类型化筛选值、derive 保留和排序回退；HTTP/Auth seam 的 credentials、错误 code、安全 returnTo、诊断 401、不抛错响应、二进制下载和 requestId 错误投影；固定 Revision 导出路径/文件名；Project/Conversation/Asset/Evidence/Project resource 的用户与上下文作用域 Query key、fetcher 的 AbortSignal 和响应解包；Snapshot controller 的版本排序、列表/详情 fetcher、共享 credentials/cache 和初始状态；Review comments controller 的列表/新增 fetcher、AbortSignal、Revision 切换清理与响应解包；Plugin trace controller 的快照 parser、空/非法结构、fetcher、共享 credentials/cache 和 AbortSignal；Generation watcher 的单飞、Abort、fallback、终态行为；以及 Generation reducer 和 URL context 的状态序列。T5 以受控 props 接入 Project/Conversation/Data Asset/Analysis Brief/Metric，T7 以受控 props 接入 Evidence/Review/PluginTrace/Export，T8 将 Snapshot 预览、Review comments、Plugin Context 请求生命周期、Evidence canvas、Review composition 和 AlertBanner 展示边界下沉到 feature controller/component，并统一 API Console、工作台和插件错误投影，未改变请求合同或 CSS。浏览器回归覆盖登录回跳、未登录保护、数据导入、Snapshot 预览、空 Plugin Snapshot、Review 刷新/新增评论、固定 Revision 导出、图表编辑、API Console 401 不跳转、澄清态、长对话和移动端。EvidenceCanvas、ReviewComposition 与 AlertBanner 均为受控展示边界，未新增远程状态单测。

## 尚未完成

- 真实同源部署的 logout/cache 浏览器场景尚未执行；本地 route fixture 场景已经覆盖浏览器 Cookie Jar、localStorage、watcher abort、旧 DOM 和重新登录恢复，但不能替代真实 API/Cookie 部署验证。
- `auth-live.spec.ts` 需要 HTTPS 部署域名、可用 Project 和测试账号；缺少这些变量时只能显式跳过，不能记为通过。
- 登录网关的真实同源 HTTPS `Secure` Cookie smoke 和用户最终验收属于 `CHG-2026-09-22-login-gateway`，仍未完成。

## 环境说明

首次在沙箱内运行 Playwright 时 Chromium 启动返回 `spawn EPERM`；在获准启动本机浏览器进程后重跑，桌面和移动端均通过。该环境限制不计为产品失败。
