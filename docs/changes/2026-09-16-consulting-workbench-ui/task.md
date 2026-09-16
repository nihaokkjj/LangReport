# 咨询项目证据工作台 UI 与交互改造：任务

- 变更编号：`CHG-2026-09-16-CONSULTING-WORKBENCH-UI`
- 状态：`IMPLEMENTING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 执行前提

- 已读取 [AGENTS.md](../../../AGENTS.md)、[CONTEXT.md](../../../CONTEXT.md)、[项目基线](../../project-spec.md)、[第一阶段产品规格](../../product/phase1-consulting-report.md) 和 [DESIGN.md](../../../DESIGN.md)。
- 本轮保持一个 Project、一个 Data Snapshot、一个 Analysis Brief、一个主 Evidence Block 的第一阶段边界。
- 当前代码改动尚未提交，其他会话必须先检查 `git status` 和 `git diff`，不要覆盖已有工作。

## 任务清单

| ID | 任务 | 依赖 | 可并行 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 收敛 Workbench Composer 和四项准备度 | 无 | 否 | DONE | Web typecheck；核心 E2E | 可先提问，准备度清晰，满足条件才创建 Generation Cycle |
| T2 | 修复澄清选项、失败返回和图表点选反馈 | T1 | 是 | DONE | 核心 E2E；人工检查 | 选项可回填，失败可返回，数据点可聚焦并显示读数 |
| T3 | 兼容普通/生成消息响应并防止 malformed message | T1 | 否 | DONE | 普通发送回归 E2E | `{ messages: [...] }` 不再读取 `payload.message.id` 或写入 undefined |
| T4 | 增加桌面右侧和移动底部 Review Inspector | T1-T2 | 否 | DONE | 桌面/移动核心 E2E | 可加载/新增评论，要求修改需要意见，批准后只读 |
| T5 | 隔离 E2E Next 输出目录 | 无 | 是 | DONE | Playwright E2E | 本地 3000 服务存在时，E2E 仍可在 3100 独立启动 |
| T6 | 同步 E2E 定位器与响应式审核路径 | T2-T4 | 否 | DONE | `test:e2e` | 桌面和移动核心链路均通过 |
| T7 | 补齐 Project 创建信息和 onboarding | T1 | 是 | DONE | API 契约测试；API/Web/DB typecheck；迁移验证 | 创建 Project 可记录客户、目标、受众和 Visual Template |
| T8 | 补齐图表编辑器的聚合/筛选/排序/注释 | T4 | 是 | DONE | contracts/domain/worker 测试；Web E2E；API/Web typecheck | 逻辑变化重新生成 Revision，视觉变化也追加 Revision |
| T9 | 接入 Theme token 编辑和完整导出状态 | T7-T8 | 是 | TODO | API 契约；人工视觉验收 | 模板版本、允许令牌和固定 Revision 导出状态可追溯 |
| T10 | 完成桌面/移动人工验收并更新 acceptance | T1-T9 | 否 | TODO | `pnpm docs:check`；人工验收 | 空态、加载、错误、溢出、触控和对比度均有证据 |

## 执行顺序

T1 → T2/T3 → T4/T5 → T6 → T7 → T8 → T9 → T10。T1-T6 是已完成的第一轮；下一会话从 T7 开始，不要重复修改已完成任务，除非回归测试证明需要修复。

## T7 实施约束

- `POST /api/v1/projects` 的完整 onboarding 字段必须先进入 `packages/contracts`，再由 API 和 Web 使用；前端不得发送未登记字段。
- 新字段直接记录在 `projects`，Visual Template 使用固定内置模板 ID；不把 Project Theme token 或插件 ThemeRef 混入 onboarding 请求。
- 数据库迁移必须向后兼容历史 Project；开发 bootstrap 和生产 provision 继续可用。

## T8 实施约束

- 聚合、筛选、排序只能编译为现有 `TransformPlan` v1 的白名单操作；禁止前端传 SQL、表达式或浏览器侧伪造聚合结果。
- Worker 必须读取来源 Revision 的同一 `snapshotId`，重算 `transformPlan`、`fieldLineage`、`previewData` 和 Flint Spec；任何执行/校验失败都不能写入新 Revision。
- 注释、数值标签和图例是 Flint Spec display 字段，仍通过编辑 Job 追加 Revision；不得修改来源 Revision 或已批准版本。
- 编辑器提供最小单条件筛选、单条件排序和当前聚合度量运算切换，避免在第一阶段引入任意 BI 查询能力。

## 并行工作流

- T7 可调查 Project 创建 API 和产品字段，但不能绕过现有 API 合同直接在前端伪造字段。
- T8 可独立盘点编辑器字段与生成接口，先写设计/测试，再实现。
- T9 依赖 T7/T8 的模板和编辑状态，暂不提前扩展为通用主题市场。

## 阻塞条件

- 需要修改数据库、API 合同、权限或 Generation Worker 时，先回到 `proposal.md`/`design.md` 并重新审核。
- 现有用户工作树修改与目标文件冲突时，停止覆盖并记录冲突。
- E2E 若再次遇到 Next lock，检查 `.next-e2e`、端口 3100 和现有 3000 进程，不要直接删除正在使用的 `.next`。

## 回滚或替代方案

- UI 回滚只撤回 `apps/web/app/page.tsx` 与 `globals.css` 的本变更部分。
- 测试基础设施回滚可移除 `LANGREPORT_NEXT_DIST_DIR` 配置，但会重新暴露共享 `.next` 锁风险。
- 不使用 `git reset --hard` 或覆盖用户未提交修改。

## Definition of Done

- [x] T1-T6 已实现并有自动化验证。
- [x] 普通消息发送 TypeError 有回归测试。
- [x] 桌面/移动核心 E2E 通过。
- [x] Web 与测试 TypeScript 检查通过。
- [x] T7/T8 已实现并有契约、Worker 集成和 Web E2E 验证。
- [ ] T9-T10 完成并人工验收。
- [ ] acceptance、handoff 与变更状态同步到 `ACCEPTED` 或如实保留 `PARTIAL`。
