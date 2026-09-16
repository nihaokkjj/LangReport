# 咨询项目证据工作台 UI 与交互改造：设计

- 变更编号：`CHG-2026-09-16-CONSULTING-WORKBENCH-UI`
- 状态：`IMPLEMENTING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 现状与约束

- 业务术语以 [CONTEXT.md](../../../CONTEXT.md) 为唯一来源，产品边界以 [第一阶段产品规格](../../product/phase1-consulting-report.md) 为准。
- Web 负责页面、交互和 API 调用；P0/P1 的 UI 改造不改变 API、数据库和 Worker。T7/T8 按原任务清单进入本次继续实施范围：T7 只增加 Project onboarding 所需的最小 API/数据库字段，T8 只沿用现有 Generation/Render Worker 和领域状态机完成可追溯编辑。
- 视觉系统以 [DESIGN.md](../../../DESIGN.md) 为准：8px spacing、Inter 正文、JetBrains Mono 元数据、克制的蓝色动作层级和右侧证据上下文。
- Evidence Block 必须保持 Snapshot、Metric Definition、TransformPlan、Flint Spec、Theme、校验和 Revision 状态可追溯。

## 设计目标与非目标

目标是让用户在一个明确工作台内理解“当前准备度、下一步动作、当前证据和审核状态”，并让桌面和移动端都有可完成的闭环。

非目标是重写产品信息架构、引入通用 Dashboard，或让前端绕过 API 权限；T7/T8 的最小合同扩展不改变既有审核和追溯边界。

## 方案选型

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 只调整颜色和间距 | 风险低 | 无法解决状态和动作冲突 | 不采用 |
| 单一工作台 + 状态驱动动作 | 解决准备度、对话、生成和审核的主路径；保留现有 API | 页面仍需后续拆分 | 采用 |
| 重写为多页面向导 | 状态更显式 | 改变现有信息架构，增加跨页状态和回滚成本 | 暂不采用 |

## 模块边界

- `apps/web/app/page.tsx`：工作台状态、Conversation 发送、准备度、图表交互、Revision 编辑器和 Review Inspector。
- `apps/web/app/globals.css`：现有 Design Token、响应式布局、Composer、Review Inspector 样式。
- `apps/web/test/e2e/consulting-report.spec.ts`：桌面/移动核心链路和普通消息发送回归。
- `apps/web/next.config.ts`：允许 E2E 使用隔离的 Next 输出目录。
- `apps/web/playwright.config.ts`：将 E2E server 的 `LANGREPORT_NEXT_DIST_DIR` 固定为 `.next-e2e`。

## 数据模型与状态流转

```text
Conversation input
  ├─ Brief/Metric/Snapshot 未齐
  │    → POST message(generate=false)
  │    → messages[]
  │    → Conversation log + notice
  └─ Brief/Metric/Snapshot 已齐
       → POST message(generate=true)
       → message + job + nextAction
       → Generation Cycle polling
       → Draft Evidence Block
       → In Review
          ├─ 评论 / 要求修改
          └─ 批准 → Approved（只读）
```

失败路径：请求异常显示可关闭的错误通知； Generation Job failed 显示原因、返回分析和重试；需要澄清时选项可回填 Composer，不直接伪造生成结果。

异步边界：生成请求只创建/读取 Generation Job，状态由轮询更新；成功后重新读取 Evidence Block、Conversation 和固定 Revision。

权限边界：Review 操作通过现有 API 执行，前端 Review 面板只提供交互入口，不改变 API 的权限判定。

### T7 Project onboarding 扩展

`POST /api/v1/projects` 的请求在现有 `name` 之外要求 `clientName`、`objective`、`audience` 和 `visualTemplate`。`audience` 使用固定的 `internal_analysis`、`client_presentation`、`management` 枚举；`visualTemplate` 使用第一阶段的三个内置模板 ID：`consulting-neutral`、`consulting-insight`、`consulting-research`。这些字段直接保存在 `projects`，列表和创建响应原样返回，避免前端维护未持久化的 onboarding 状态。

旧的开发 bootstrap、生产 provision 和历史 Project 通过数据库默认值保持可读取；只有新建 Project 的 API 合同要求完整 onboarding 信息。Visual Template 是 Project 的当前输出规范选择，仍与已有 `project_themes` 的 Theme token/version 分开，后续 T9 再通过既有 Theme API 编辑允许令牌。

### T8 Revision 编辑扩展

编辑请求仍通过 `POST /api/v1/chart-artifacts/:artifactId/revisions` 的 `operation=edit` 进入 Generation Job，不在浏览器直接写入 Revision。编辑 Patch 分为两类：

- 数据逻辑：可选的 `transformPlan` 使用现有 v1 JSON-only 操作（filter、aggregate、sort、limit 等）。Generation Worker 读取该 Revision 绑定的同一 Data Snapshot，重新执行计划，写回 `transformPlan`、`fieldLineage` 和 `previewData`，再编译新的 Flint Spec。
- 表达层：`title`、`chartType`、`encodings`、注释文本、数值标签和图例显示属于 Flint Spec 的 chart display 字段。它们也只能通过新 Job 生成新的 Draft Revision，不能覆盖来源版本。

编辑器只提供单个筛选条件、单个排序条件和当前聚合度量的运算切换；这是第一阶段可审核的最小操作面，不扩展为任意 SQL、跨文件 Join 或 Dashboard 交互。已批准版本保持只读。Worker 无法读取快照、计划执行失败或编译校验失败时，Job 进入可解释的 failed 状态，不产生 Revision。

## API / 外部契约

- `POST /api/v1/conversations/:conversationId/messages`：普通消息返回 `messages[]`；生成消息返回 `message`、可空 `job` 和 `nextAction`。
- `POST /api/v1/projects`：要求 `name`、`clientName`、`objective`、`audience` 和 `visualTemplate`，Project DTO 和 `GET /api/v1/projects` 同步返回这些字段。
- `POST /api/v1/chart-artifacts/:artifactId/revisions`：编辑 Patch 可携带 `transformPlan` 以及注释、数值标签和图例显示设置；逻辑编辑由 Worker 基于来源 Revision 的 `snapshotId` 重算，视觉编辑沿用来源数据但仍追加新 Revision。
- `POST /api/v1/chart-revisions/:revisionId/submit`、`approve`、`request-changes`：沿用现有 Revision 状态迁移。
- `GET/POST /api/v1/chart-revisions/:revisionId/comments`：加载和追加 Review 评论。
- `LANGREPORT_NEXT_DIST_DIR` 仅是本地 Next 构建输出配置，不是业务 API。

## 架构图

```text
User
  → Workbench Composer / Readiness / Review Inspector
  → Web state reducer and API client
  → API contracts and existing domain permissions
  → Conversation / Generation Job / Chart Revision persistence
  → polling result → Evidence canvas and audit context
```

成功、失败、异步、权限和数据落点均在同一个工作台状态中表达；不新增持久化实体。

## 数据流

用户输入经过 trim 和当前 Project/Conversation 绑定后发送。普通消息进入 `messages[]`，生成消息进入 Job 并通过轮询得到 Revision。编辑器把数据逻辑操作编译为 TransformPlan，把显示设置编译为 Flint Spec Patch；UI 只展示 API 返回的可追溯字段。图表点选仅改变本地 `activePoint`，不会修改数据或 Revision。

## 权限、校验与异常处理

- `projectId`、发送状态和 Job 活跃状态不满足时阻止重复发送。
- 普通/生成响应分别归一化；只接收带 `id` 的消息，避免 malformed payload 污染状态。
- 要求修改必须填写审核意见；批准版本显示只读检查项。
- API 错误使用 `role=alert`，成功和准备度状态使用 `role=status`。
- 移动端 Review 面板的批准动作是主路径，避免点击被底部面板遮挡的画布按钮。

## 迁移、兼容与回滚

T7 增加一次向后兼容的 Project metadata migration，为历史行提供空的客户/目标、客户汇报受众和 `consulting-neutral` 默认模板；新建请求仍由合同强制填写。T8 不新增业务实体，沿用 Generation Job 的 `editPatch`、`transformPlan` 和 Chart Revision 父子关系。`distDir` 默认仍为 `.next`，只有 Playwright 的 WebServer 环境使用 `.next-e2e`。如需回滚，撤回本变更涉及的 Web、契约、API、迁移、Worker 和 E2E 文件即可；不删除任何业务数据。

## 日志、监控与可观测性

- 用户可见的 `notice` 和 `error` 反馈请求与生成状态。
- E2E 捕获 `pageerror`，普通发送回归明确拒绝 `Cannot read properties of undefined (reading 'id')`。
- Playwright 保留失败截图和 trace；测试结束后 `.next-e2e` 不进入 Git。

## 测试策略

- Web 应用类型检查和 E2E 类型检查。
- 桌面/移动端核心链路：数据 → 指标 → Brief → Generation Cycle → Draft → Review → Approved → SVG。
- 普通会话回归：准备度不足 → `generate=false` → `messages[]` → 通知可见且无 PageError。
- 编辑器回归：聚合/筛选/排序生成可验证的 TransformPlan，注释/标签进入 Flint Spec Patch；同一来源下每次成功编辑均产生新 Draft Revision。
- 人工检查：桌面右侧 Inspector、移动底部 Review 面板、空态/错误态/加载态和触控区域。

## 需求追踪矩阵

| 需求 | 设计 | 任务 | 测试 | commit |
| --- | --- | --- | --- | --- |
| R1 单一输入和准备度 | 状态驱动工作台 | T1-T2 | 核心链路 E2E | 未提交，工作树 |
| R2 普通问题可先提交 | 响应归一化 | T3 | 普通发送回归 E2E | 未提交，工作树 |
| R3 澄清/失败可操作 | 失败和澄清状态 | T4 | 核心链路与人工检查 | 未提交，工作树 |
| R4 审核可完成 | Review Inspector | T5 | 桌面/移动核心链路 E2E | 未提交，工作树 |
| R5 E2E 可独立启动 | 独立 `distDir` | T6 | Playwright WebServer | 未提交，工作树 |
| R6 完整项目准备和编辑能力 | T7 Project onboarding；T8 编辑器；T9 Theme/导出 | T7-T9 | 契约测试、Worker 集成、Web E2E、人工验收 | T7/T8 已实现，T9 待验收 |
