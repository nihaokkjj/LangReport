# Data Snapshot Preview：任务

- 变更编号：`CHG-2026-09-17-DATA-SNAPSHOT-PREVIEW`
- 状态：`PARTIAL`
- 创建时间：2026-09-17
- 更新时间：2026-09-17

## 执行前提

- 需求方已确认 `Data Snapshot Preview` 设计和 ADR 0022。
- 本变更保持第一阶段咨询项目报告边界，不引入完整文件浏览或历史 Snapshot 生成。
- 实现前必须再次检查 `git status`/`git diff`，保留已有 Web 工作树修改。
- 代码开始前设计文档已经进入 `APPROVED`；如需要改变生成输入、权限或 Snapshot 不变量，必须回到 proposal/design 重新审核。

## 任务清单

| ID | 任务 | 依赖 | 可并行 | 负责人 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | 增加 Snapshot 来源元数据的 contracts/DB nullable 字段和迁移 | 无 | 否 | Agent | DONE | contracts test；`pnpm --filter @langreport/db db:verify` | 新 Snapshot 可保存 metadata；旧记录不回填；内部 key 不进入 DTO |
| T2 | 实现 SnapshotSummary/Detail 读模型和列表/详情 API | T1 | 否 | Agent | DONE | API typecheck/test；contract/integration | 权限、Project/Asset/Snapshot 归属和稳定错误覆盖；列表轻量、详情含 schema/preview |
| T3 | 增加 Web 预览入口、modal/sheet 状态和按需读取 | T2 | 否 | Agent | DONE | Web typecheck；Web E2E | 手动打开，默认最新，历史版本切换，不改变生成状态 |
| T4 | 实现只读数据表格、全列横向滚动和列懒渲染 | T3 | 否 | Agent | DONE | Web E2E；人工桌面/移动验收 | 25 行、全部字段、sticky header/first column、类型/空值/长值可读 |
| T5 | 完成加载、空态、失败重试、权限和可访问性状态 | T2/T3/T4 | 是 | Agent | DONE | Web E2E；人工检查 | 失败不回退、不泄露信息；dialog/table/触控目标符合 DESIGN.md |
| T6 | 补齐历史预览与生成最新 Snapshot 的回归测试 | T2/T3 | 是 | Agent | DONE | API/Web/Generation tests | 预览历史版本不会改变 Generation Job 输入 |
| T7 | 执行全量验证、更新验收和交接文档 | T1-T6 | 否 | Agent | DONE | test-plan 全部命令；`pnpm docs:check` | 自动化验证证据已记录；人工验收缺口如实保留 |

## 执行顺序

```text
T1 → T2 → T3 → T4 → T5/T6 → T7
```

T5 和 T6 在 T3/T4 的接口和状态稳定后可并行；T7 必须等待所有实现和测试完成。

## 并行工作流

- T1 先明确 nullable 来源字段和 DTO，避免 API/前端猜测历史元数据。
- T2 可在 T1 完成后独立实现并测试权限和归属校验。
- T5/T6 可分别覆盖 UI 状态和生成回归，但不得修改业务边界。
- 当前运行环境未启用独立测试 Agent；主 Agent 将按 test-plan 分阶段执行，验收文档保留这一限制。

## 阻塞条件

- 需要让历史 Snapshot 参与生成；
- 需要新增原始文件下载、完整分页查询、搜索/排序/筛选或脱敏策略；
- 需要改变 Data Snapshot 不可变性、Project view 权限或 Generation Job Snapshot 冻结语义；
- 现有 `page.tsx`/`globals.css` 用户修改与本变更无法安全合并；
- 历史 nullable 字段被要求伪造回填，无法说明事实来源。

## 回滚或替代方案

- UI 可独立隐藏预览入口并保留 API/DB 兼容字段。
- API 路由可独立停用，不影响现有 latest Asset 读模型。
- DB nullable 字段默认保留，避免破坏已写入的新来源信息。
- 不使用 `git reset --hard`、`git checkout --` 或删除历史对象。

## Definition of Done

- [x] proposal/design/task/test-plan 已保持一致，状态和范围可信；
- [x] contracts/API/DB 的 Snapshot 读取和来源元数据通过自动化验证；
- [x] Web 已实现手动打开最新预览并切换历史 Snapshot，桌面/移动 E2E 通过；
- [ ] 表格 200 列横向到达、懒渲染、sticky 结构和完整人工响应式验收尚未完成；
- [x] 历史预览不会改变生成输入，现有 Generation/Worker 集成回归通过；
- [x] 加载、空态、失败重试、权限、长值和无可用元数据状态已实现；自动化覆盖和人工覆盖范围见 test-report；
- [x] Web typecheck、相关测试、`pnpm docs:check` 和 `git diff --check` 通过；
- [x] acceptance/handoff/test-report 已同步，未完成项保留为 PARTIAL。
