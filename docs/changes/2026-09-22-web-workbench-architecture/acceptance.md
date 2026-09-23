# Web 工作台认证感知架构重构：Acceptance

- 变更编号：`CHG-2026-09-22-WEB-WORKBENCH-ARCHITECTURE`
- 状态：`VERIFYING / PARTIAL`
- 创建时间：2026-09-22
- 更新时间：2026-09-23

## 验收结论

- 结论：`PARTIAL`
- 验收时间：2026-09-23（本阶段）
- 验证 commit：工作区未提交快照（未创建 commit）

本阶段完成 Auth/HTTP seam、受保护路由、Query 基础设施、URL context、Generation coordinator、T5 feature slices、T6 Chart Editor reducer、T7 请求/错误 seam 和 T8 Snapshot/Review comments controller 切片；真实 logout/cache 清理、T8 剩余页面组合层审计和 T9 独立验收仍未完成，因此不标记为 COMPLETE。

## 验收证据

| 标准 | 证据 | 命令或文件 | 结果 |
| --- | --- | --- | --- |
| Auth module 和 HTTP client 统一处理 session/401 | `apps/web/lib/http-client.ts`、`features/auth/*` | Web typecheck、登录 E2E | 通过（本阶段） |
| `/` 与 `/plugins` 受保护访问和 login 回跳 | `(protected)/layout.tsx`、`login.spec.ts` | Playwright 18 条回归 | 通过（桌面/移动） |
| logout 清理 Cookie、Query cache 和 watcher | `features/auth/use-auth-actions.ts` | 代码审计；真实 logout smoke 待补 | 部分通过 |
| Project/Conversation/Revision URL 可恢复 | `hooks/use-project-context.ts`、`project-context.test.ts` | URL unit、build、工作台回归 | 通过（首阶段路径） |
| T5 Project/Conversation/Data Asset/Analysis Brief/Metric feature slice 边界 | `features/project/project-panel.tsx`、`features/conversation/conversation-panel.tsx`、`features/data-snapshot/data-asset-panel.tsx`、`features/analysis-brief/*` | Web typecheck、unit、build、Playwright 18/18 | 通过（本轮） |
| Chart Editor reducer 接管本地字段与 TransformPlan 纯逻辑 | `features/chart-editor/chart-editor-state.ts`、`chart-editor-state.test.ts` | 22 个 Web unit、Web build、Playwright 18/18 | 通过（本轮） |
| T7 Evidence/Review/Export/Plugin 使用共享错误/请求 seam | `features/evidence/*`、`features/review/review-panel.tsx`、`lib/http-client.ts`、插件页 | 22 个 Web unit、Web build、固定 Revision E2E | 通过（本轮） |
| T8 Snapshot 预览 controller 收敛请求与状态边界 | `features/data-snapshot/use-snapshot-preview.ts`、`snapshot-preview.test.ts` | 22 个 Web unit、全仓检查、Snapshot 桌面/移动 E2E | 通过（本轮切片） |
| T8 Review comments controller 收敛评论请求与审核草稿 | `features/review/use-review-comments.ts`、`review-comments.test.ts` | 22 个 Web unit、全仓检查、Review 桌面/移动 E2E | 通过（本轮切片） |
| Generation、Evidence、Review 行为不变 | `features/generation/*`、Evidence/Review controlled slices、watcher tests | 22 个 Web unit、18 条 E2E | 通过（服务端 Query 所有权和 T8 剩余 Evidence/Review 组合层审计仍待后续） |
| API Console Auth 调试不发生 401 循环 | `api-console/page.tsx`、`api-console.spec.ts` | API Console 401 smoke（桌面/移动） | 通过（本轮） |
| 桌面/移动加载、空、错、Approved 只读状态可用 | 现有 globals.css、Playwright 配置 | Playwright desktop/mobile | 通过（现有主路径） |
| 全量检查通过 | `test-report.md` | 全仓 typecheck/test/build/docs:check | 通过 |

## 失败项与遗留问题

- 当前遗留：登录网关自身仍在 `VERIFYING`，真实 HTTPS smoke 和用户验收属于其独立变更。
- 当前遗留：T8 的剩余 Evidence/Review 页面组合层与公共组件审计、Evidence/Review 服务端 Query 所有权、独立验证角色和真实 logout/cache 清理场景尚未完成；Snapshot 与 Review comments controller 本轮已完成。

## 文档同步确认

- [x] 登录网关变更未被本变更覆盖。
- [x] 本变更范围限定为 Web 架构和行为保持型迁移。
- [x] 本阶段已同步 task、acceptance、handoff 和测试证据。
- [ ] 完成 T5–T9 后再将结论提升为 COMPLETE。
