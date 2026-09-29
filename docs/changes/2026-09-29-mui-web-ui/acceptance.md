# Material UI 全站组件规范化：Acceptance

- 变更编号：`CHG-2026-09-29-mui-web-ui`
- 状态：`VERIFYING`
- 创建时间：2026-09-29
- 更新时间：2026-09-29

## 验收结论

- 结论：实施、自动化验证、独立源码复核与 TP-09 同基线性能对照完成，已按用户要求合入本地 `main`；用户视觉/键盘/触屏验收仍待记录，暂不标记 `ACCEPTED`。
- 设计审核：用户于 2026-09-29 回复“审批通过”，允许按暖色 `DESIGN.md` 实施 MUI 全站迁移。
- 验证快照：隔离工作树 `codex/langreport-mui-web-ui-20260929` 的提交 `2ff5afe`，基线 HEAD `75e83b09da02b47727accd5071f9dad16a7569eb`，实施前最终 tracked diff blob `03fbdb7bc4e78945f14644c7e60231b78a12084b`；未追踪文件散列见独立报告。该提交已合入本地 `main`，尚未推送。
- 合并后复测：本地 `main` 的 Web typecheck、test:typecheck、unit 24/24、生产 build、docs:check 和四视口 E2E 60 passed / 4 skipped 均通过。

## 验收证据清单

| 标准                    | 证据                                                    | 当前结果                                                                      |
| ----------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| R1 六类页面通用控件统一 | [组件盘点](./inventory.md)、静态扫描、四视口 E2E        | 通过；仅隐藏 file input 保留原生语义                                          |
| R2 视觉规范一致         | `DESIGN.md` 主题、[24 张截图索引](./evidence/README.md) | 手机排版及聚焦双橙线已修正；待用户视觉验收                                    |
| R3 交互状态与可访问性   | 删除 Dialog 取消/Esc、指标慢响应、插件启停 E2E          | 自动化覆盖关键路径；完整人工键盘/触屏验收待记录                               |
| R4 业务和 API 合同不变  | [完整 E2E 日志](./evidence/e2e-final.log)、unit 24/24   | 60 passed、4 环境跳过；API 合同未改                                           |
| R5 SSR/客户端导航稳定   | Next.js 生产 build、四视口首屏截图与 E2E 日志           | build 通过；日志无 hydration/MUI 告警                                         |
| TP-09 性能代价          | [同基线生产构建与本地首屏测量](./performance.md)        | 路由引用 JS 增加 77–87 KB gzip；本机登录 FCP 中位数增加 12 ms，待用户审阅代价 |

## 失败与遗留问题

用户截图指出登录输入框聚焦时有两层橙色边框。Chromium 复现确认主题外层 `2px` 橙色 outline 与 MUI 默认内层 `2px` 橙色 fieldset 同时显示；已将聚焦时内层边框改为 `1px` 中性色，保留 `DESIGN.md` 的外层焦点环。账号与密码框在 390px、1440px 点击聚焦检查均只剩一层橙色，Web typecheck 通过。

TP-09 同基线构建与本地首屏对照已记录；包体积增量明显，真实网络/低端设备的 Web Vitals 仍需发布环境观察。四个真实同源 HTTPS 后端用例按环境条件跳过，不能宣称生产登录已验证。完整的 Project/Conversation、Brief 和 Review 键盘焦点回返及触屏人工验收仍待记录。六类页面尚未逐路由以 `console`/`pageerror` 监听验证客户端导航与刷新。全量 Prettier 检查有 20 个本次未改的旧文件不符合格式；本次改动已单独格式化。

## 文档同步确认

- [x] Proposal、Design、Task、Test Plan 及 ADR-0030 获用户审核通过。
- [x] 实施、自动化回归、四视口截图与交接完成。
- [x] 独立验证完成最终快照复核；见 [test-report.md](./test-report.md)。
- [x] TP-09 同基线性能对照完成；见 [performance.md](./performance.md)。
- [ ] 用户人工视觉/键盘/触屏验收完成，并审阅包体积代价。
