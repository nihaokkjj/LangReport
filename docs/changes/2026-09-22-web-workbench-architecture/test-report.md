# Web 工作台认证感知架构重构：Test Report

- 变更编号：`CHG-2026-09-22-WEB-WORKBENCH-ARCHITECTURE`
- 验证时间：2026-09-23
- 快照：本轮跨 feature 公共组件审计提交快照
- 结论：`PARTIAL / PASS FOR CURRENT SLICE`

## 已通过

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @langreport/web typecheck` | 通过 |
| `pnpm --filter @langreport/web test:typecheck` | 通过 |
| `pnpm --filter @langreport/web test` | 通过，24 个单测 |
| `pnpm --filter @langreport/web build` | 通过，Next.js 生产构建完成 |
| Playwright 桌面 + 390px 移动端 | 通过，18/18（含 API Console 401 smoke） |
| `pnpm typecheck` | 通过，workspace 与 test:typecheck 全部通过 |
| `pnpm test` | 通过，workspace 离线测试全部通过 |
| `pnpm build` | 通过，workspace build 全部通过 |
| `pnpm docs:check` / `git diff --check` | 通过 |

本轮跨 feature 公共组件审计复验：`pnpm --filter @langreport/web typecheck`、`pnpm --filter @langreport/web test:typecheck`、`pnpm --filter @langreport/web test`（24 个单测）、`pnpm --filter @langreport/web build`、Playwright 桌面 + 390px 移动端（18/18）、`pnpm docs:check` 和 `git diff --check` 均通过。`AlertBanner` 只复用现有 global alert class；未新增 API、Query、Revision mutation 或视觉 token。

单测覆盖 Chart Editor reducer 的 reset/field update、Revision 投影、类型化筛选值、derive 保留和排序回退；HTTP/Auth seam 的 credentials、错误 code、安全 returnTo、诊断 401、不抛错响应、二进制下载和 requestId 错误投影；固定 Revision 导出路径/文件名；Project/Conversation/Asset/Evidence/Project resource 的用户与上下文作用域 Query key、fetcher 的 AbortSignal 和响应解包；Snapshot controller 的版本排序、列表/详情 fetcher、共享 credentials/cache 和初始状态；Review comments controller 的列表/新增 fetcher、AbortSignal、Revision 切换清理与响应解包；Plugin trace controller 的快照 parser、空/非法结构、fetcher、共享 credentials/cache 和 AbortSignal；Generation watcher 的单飞、Abort、fallback、终态行为；以及 Generation reducer 和 URL context 的状态序列。T5 以受控 props 接入 Project/Conversation/Data Asset/Analysis Brief/Metric，T7 以受控 props 接入 Evidence/Review/PluginTrace/Export，T8 将 Snapshot 预览、Review comments、Plugin Context 请求生命周期、Evidence canvas、Review composition 和 AlertBanner 展示边界下沉到 feature controller/component，并统一 API Console、工作台和插件错误投影，未改变请求合同或 CSS。浏览器回归覆盖登录回跳、未登录保护、数据导入、Snapshot 预览、空 Plugin Snapshot、Review 刷新/新增评论、固定 Revision 导出、图表编辑、API Console 401 不跳转、澄清态、长对话和移动端。EvidenceCanvas、ReviewComposition 与 AlertBanner 均为受控展示边界，未新增远程状态单测。

## 尚未完成

- Query cache 的跨身份清理和真实 logout 过程需要独立浏览器场景；当前代码路径已由 `useAuthActions` 接入。
- T5 feature slices、T6 Chart Editor reducer、T7 请求/错误 seam 和 T8 Snapshot/Review comments/Plugin trace controller/Evidence canvas/Review composition/AlertBanner 切片已完成本轮；T8 页面组合层与公共组件审计已完成，独立验证仍未完成。

## 环境说明

首次在沙箱内运行 Playwright 时 Chromium 启动返回 `spawn EPERM`；在获准启动本机浏览器进程后重跑，桌面和移动端均通过。该环境限制不计为产品失败。
