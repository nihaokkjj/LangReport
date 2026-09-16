# 咨询项目证据工作台 UI 与交互改造：验收记录

- 变更编号：`CHG-2026-09-16-CONSULTING-WORKBENCH-UI`
- 状态：`PARTIAL`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 验收结论

- 结论：`PARTIAL`
- 验收时间：2026-09-16
- 验证 commit：`未提交；基线 HEAD 为 cc94b25`

P0/P1 第一轮以及 T7/T8 的自动化验证已通过；完整 UI 改造仍有 Theme token、固定 Revision 导出和桌面/移动人工验收等遗留任务，因此不能标记为完整 `ACCEPTED`。

## 验收证据

| 标准 | 证据 | 命令或文件 | 结果 |
| --- | --- | --- | --- |
| 普通问题可以在准备度不足时提交 | 回归 E2E | `consulting-report.spec.ts`：准备度不足用例 | PASS |
| 生成、审核和 SVG 导出闭环可用 | 桌面/移动 E2E | `consulting-report.spec.ts`：核心链路 | PASS |
| 本地 3000 服务存在时 E2E 可启动 | 独立 Next 输出目录 | `next.config.ts`、`playwright.config.ts` | PASS |
| Web 类型正确 | TypeScript | `pnpm --filter @langreport/web typecheck` | PASS |
| E2E 类型正确 | TypeScript | `pnpm --filter @langreport/web test:typecheck` | PASS |
| 工作树无空白错误 | Git | `git diff --check` | PASS |
| Project 创建完整信息 | T7 API 契约、迁移和 Web 表单 | `packages/contracts/test/unit/http.test.ts`；`0020_project_onboarding.sql`；DB verify | PASS |
| 图表逻辑和显示编辑可追溯 | T8 contracts/domain/Worker/Web E2E | Worker + Render Worker 集成；编辑器 E2E；来源 Revision 保持不变 | PASS |
| Theme token 编辑 | T9 | 待实现 | TODO |
| HTML 固定 Revision 导出 | 第一阶段规格 | 待实现 | TODO |

## 失败项与遗留问题

- 当前工作树未提交，不能提供包含变更编号的 commit。
- 初始 E2E 测试因共享 `.next/dev/lock` 被阻断，已通过 `.next-e2e` 隔离解决。
- 旧测试定位器曾使用“填写简报”和“发送”等旧文案，已同步为精确/行为语义定位。
- 移动端审核面板覆盖画布操作区，测试和产品路径已改为使用审核面板按钮；后续人工检查底部面板的滚动和触控区域。
- 尚未完成人工截图级视觉验收；Theme token 和 HTML/固定 Revision 导出仍留在 T9。

## 文档同步确认

- [x] `proposal.md`、`design.md`、`task.md`、`test-plan.md`、`acceptance.md`、`handoff.md` 共享同一变更编号。
- [x] 已记录本轮实际测试结果和未完成范围。
- [ ] T9-T10 完成后重新进行人工验收并将状态推进到 `ACCEPTED`。
