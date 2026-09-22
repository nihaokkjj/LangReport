# LangReport 项目基线

- 类型：项目结构与工程事实基线
- 状态：`ACTIVE`
- 更新时间：2026-09-16
- 事实来源：workspace `package.json`、各 app/package 的 `package.json`、现有架构文档和代码目录

## 项目目标与边界

LangReport 第一阶段服务“咨询项目报告”这一条垂直闭环：用户在一个 Project 中提供客户表格和 Analysis Brief，系统生成一个可追溯、可审核的 Evidence Block。一个 Generation Cycle 只使用一个 Data Snapshot、一个 Analysis Brief，并生成一个主 Chart Artifact/Chart Revision。

第一阶段不扩展为通用 BI 平台。数据库/实时数据、跨文件 Join、Dashboard、实时协作、公开分享、任意服务器端代码、插件市场和完整 PPT 排版不属于当前验收范围。产品术语以根目录 [CONTEXT.md](../CONTEXT.md) 为唯一来源，产品范围以 [第一阶段产品规格](./product/phase1-consulting-report.md) 为唯一来源。

## 代码结构

这是一个由 `pnpm-workspace.yaml` 管理的 TypeScript monorepo，包含 `apps/*` 和 `packages/*` 两类 workspace。

### 应用进程

| 路径 | 职责 | 运行边界 |
| --- | --- | --- |
| `apps/web` | Next.js 用户工作台 | 页面、交互、API 调用和浏览器预览 |
| `apps/api` | Fastify 模块化单体 API | HTTP、认证/作用域、业务编排和任务入口 |
| `apps/generation-worker` | Generation Job Worker | 读取固化输入、推进 Generation Cycle 并持久化结果 |
| `apps/render-worker` | Render Worker | 在独立进程中执行 Flint 编译并生成图表输出 |

### 共享包

| 路径 | 职责 | 关键约束 |
| --- | --- | --- |
| `packages/contracts` | Zod HTTP、任务和 TransformPlan 合同 | 跨 app/package 的共享结构从这里导出 |
| `packages/db` | Drizzle Schema、数据库客户端和迁移入口 | 数据库 Schema 的唯一拥有者 |
| `packages/domain` | 领域规则和状态不变量 | 不承载 HTTP 或页面行为 |
| `packages/data-engine` | CSV/XLSX/JSON 解析、字段画像和预览 | 不改写 Data Snapshot |
| `packages/generation` | Generation Cycle、计划生成、TransformPlan、Flint Spec 和校验 | 受限变换和有限自动修复 |
| `packages/chart` | Chart Artifact/Chart Revision 领域写入规则 | Revision append-only，Approved 不可变 |
| `packages/flint-adapter` | Flint 编译及 Vega-Lite/SVG/PNG/静态 HTML 输出边界 | `flint-chart` 只在此包和 Render Worker 使用；HTML 不执行用户脚本 |
| `packages/harness` | 结构化模型输出 seam 和依赖边界 | 不依赖 LangReport 应用包 |
| `packages/model-gateway` | 模型路由和供应商调用边界 | 不把密钥写入 Generation Job 或审计正文 |
| `packages/memory` | Conversation/Project/Workspace Memory 规则 | Memory Candidate 未确认不进入长期检索 |
| `packages/plugin-sdk` | 声明式插件能力合同 | 不执行用户任意代码 |
| `packages/plugins` | 内置 Plugin Manifest 和模板能力 | 只接受平台拥有且哈希匹配的能力 |
| `packages/storage` | S3/MinIO 对象存储适配 | 对象路径必须服从 Workspace/Project 作用域 |

## 主要运行流

```text
Web
  → API
  → Project / Conversation / Data Asset
  → immutable Data Snapshot + Analysis Brief
  → Generation Job (PostgreSQL-backed)
  → Generation Worker
      → Profile → Plan → Transform → Compile → Validate
      → needs_clarification / failed / drafted
  → Chart Revision + Evidence Block
  → Render Worker
  → Vega-Lite / SVG / PNG / 静态 HTML
  → Web review and fixed-Revision export
```

Generation Worker 与 Render Worker 通过 PostgreSQL-backed Generation Job 状态协作。Worker Lease、Fencing Token 和 Job 到业务结果的幂等关系是并发安全边界；详细状态和停止条件见 [Agent 启动与 Loop 规范](./agent/agent-loop-spec.md)。

Generation Job 状态同步由 `statusVersion/statusChangedAt` 表示用户可见变化，不复用会被 Lease heartbeat 更新的 `updatedAt`。Web 工作台对同一标签页、同一 Job 只保留一个 status watcher；切换 Project、Conversation 或 Job 时 abort 旧请求并用会话令牌拒绝迟到响应。API status projection 与完整 Job 结果分离，长轮询可由 `GENERATION_STATUS_LONG_POLL=false` 关闭并回退到串行读取。

## 持久化与领域不变量

- Workspace 是内部技术隔离边界；第一阶段用户直接操作自己的 Project，不显示 Workspace 管理入口。
- Data Snapshot 是一次 Generation Cycle 的事实输入，重新上传产生新 Snapshot，旧 Snapshot 可读。
- Chart Revision 保存 Snapshot、Metric Definition、TransformPlan、字段血缘、Flint Spec、Visual Template 快照和校验结果。
- Approved Revision 只读；编辑、复制和回滚都创建新的 Revision。
- Generation Cycle 的成功只代表必要计划和渲染校验通过，不代表审核批准或可以发布。
- Memory Candidate、模板变更和 Review 决策都必须有显式状态。
- 模型只能通过受控 Gateway 获得最小必要数据；TransformPlan 只能由受限执行者运行。

领域关系和状态细节见 [领域模型](./architecture/domain-model.md)，系统边界见 [系统架构](./architecture/architecture.md)。

## 当前实现事实与已知缺口

- 已实现的数据上传/解析、字段画像、Generation Cycle 的确定性 seam、Flint 编译以及 Vega-Lite JSON、PNG、SVG、静态 HTML 输出边界。
- 现有生产配置、Workspace 私有化和插件页面等工作树修改属于本次治理初始化前已经存在的用户修改，本次不覆盖、不重构。
- HTML 首版由 Render Worker 从已验证 SVG 生成自包含静态包装页；输出对象绑定固定 Revision，用户文本经过转义且不加载外部资源。
- 现有 `docs/` 以 `docs/README.md` 为根导航；项目基线和变更记录分别位于本文件与 `docs/changes/`。

## 开发与验证入口

以下命令来自根目录和 workspace 的实际 `package.json`：

| 目的 | 命令 |
| --- | --- |
| 本地前端 + API | `pnpm dev` |
| 全部本地进程 | `pnpm dev:all` |
| 全 workspace 类型检查 | `pnpm typecheck` |
| 离线测试集合 | `pnpm test` |
| 文档链接和目录约束 | `pnpm docs:check` |
| 集成测试 | `pnpm test:integration` |
| Web E2E | `pnpm test:e2e` |
| 数据库迁移验证 | `pnpm db:verify` |
| 第一阶段真实 HTTP 闭环 | `pnpm phase1:smoke` |
| 发布前真实百炼门禁 | `pnpm phase1:release-gate` |

数据库、Docker、环境变量和本地服务的操作说明见 [开发环境](./operations/development-setup.md)。涉及 UI 变更时，还必须遵守根目录 [DESIGN.md](../DESIGN.md) 和 `apps/web/AGENTS.md`。

## 文档与变更地图

| 问题 | 权威入口 |
| --- | --- |
| 我该用什么业务术语？ | [CONTEXT.md](../CONTEXT.md) |
| 第一阶段做什么、不做什么？ | [phase1-consulting-report.md](./product/phase1-consulting-report.md) |
| 当前代码有哪些模块？ | 本文件 |
| Agent 如何启动、循环和停止？ | [agent-loop-spec.md](./agent/agent-loop-spec.md) |
| 为什么采用某个架构取舍？ | [docs/adr/](./adr/) |
| 如何接收和执行一次中大型变更？ | [docs/changes/README.md](./changes/README.md) |
| 这次变更改了什么、如何验收？ | 对应 `docs/changes/<change-id>/` |
