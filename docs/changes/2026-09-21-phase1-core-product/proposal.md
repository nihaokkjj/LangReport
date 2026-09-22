# 第一阶段核心产品可用化提案

- 变更编号：`CHG-2026-09-21-phase1-core-product`
- 状态：`APPROVED`
- 负责人：LangReport owner agent
- 创建时间：2026-09-21
- 更新时间：2026-09-21

## 背景

LangReport 已经具备 Project、Data Snapshot、Generation Job、受限变换、Flint 渲染、Chart Revision 和 Evidence Block 的分层实现，也有离线测试、API 集成测试、Worker 集成测试和 Web E2E。现状可以证明若干模块分别工作，但还缺少一条由真实 Web/API/Generation Worker/Render Worker 共同完成、可由用户恢复和验收的第一阶段产品闭环。

第一阶段的产品承诺不是生成一张孤立的图，而是让顾问从客户表格和分析问题出发，得到带来源、指标口径、变换、视觉规范、校验结果和审核状态的 Evidence Block，并能在刷新或重新进入 Project 后继续处理固定 Revision。

## 要解决的问题

1. 用户需要一条明确的首次使用路径，不必理解内部 Workspace、Job 或 Worker 才能完成咨询项目分析。
2. 数据上传、Brief/Metric 确认、异步生成、失败恢复、图表编辑、审核和导出目前没有由同一条真实运行验收锁定。
3. 第一阶段规格要求 PNG、SVG、HTML 都绑定到不可变 Chart Revision，当前 HTML 输出仍缺失。
4. 现有 Web E2E 使用 API fixture，不能证明浏览器请求经过真实 API 并由常驻 Worker 产生最终结果。
5. 失败、需要澄清、重试、Changes Requested 和刷新恢复必须成为用户可理解、可继续的状态，而不是只能在测试或数据库中观察。

## 目标用户与使用场景

目标用户是咨询顾问、研究分析师和项目 Reviewer。

首个可验收场景：用户在一个 Consulting Project 中导入销售 CSV，确认“销售额”及同比口径，填写按月份/区域的 Analysis Brief，生成一个 Line/Bar/Area 图表 Evidence Block，修改图表并产生新 Chart Revision，提交审核、评论或要求修改，批准后导出固定 Revision 的 PNG、SVG 和 HTML。

## 需求范围

### MVP

本变更以第一阶段产品规格的 12 条验收标准为边界，交付以下可操作能力：

- Project 创建、列表、切换和重新打开；Conversation 创建、继续和持久化；
- CSV/XLSX/JSON/粘贴表格导入，Data Asset 与不可变 Data Snapshot、字段画像、数据质量警告和只读历史预览；
- Analysis Brief 和 Metric Definition 的保存、确认、澄清门禁及来源 Conversation 关联；
- 一次 Generation Cycle 只使用一个 Data Snapshot，经过 Profile → Plan → Transform → Compile → Validate → Render，最终生成一个 Draft Evidence Block；
- 真实 PostgreSQL-backed Generation Job 由 Generation Worker 和 Render Worker 异步推进，状态、失败原因、重试和需要澄清可在 Web 中恢复；
- Line、Bar、Area 图表预览和受限图表编辑；逻辑编辑重新执行 TransformPlan，所有编辑均追加新 Chart Revision；
- Evidence Block 展示 Snapshot、Metric Definition、TransformPlan、字段血缘、Flint Spec、Visual Template/Theme 版本、Plan/Render Validation 和质量警告；
- Draft、In Review、Changes Requested、Approved 的审核状态、评论和评论解决，Approved Revision 只读；
- PNG、SVG、HTML、Vega-Lite JSON 均绑定固定 Chart Revision，不能指向可变 Artifact head；
- 一个无 API mock 的 live smoke 场景，覆盖浏览器/HTTP 入口、真实 API、隔离数据库/对象存储和两个常驻 Worker；
- 最小运行说明、错误下一步动作和可复现验收证据。

### 后续范围

- 多页报告排版、Dashboard、跨文件 Join、实时数据同步、PPT 自动排版和 Excel 回写；
- Workspace 成员管理、实时多人协作、公开分享和完整外部插件市场；
- 通用行业语义层、任意服务器端代码执行和自动发布客户结论；
- 超出首个场景所需的高级主题编辑器、复杂评论锚点和批量导出；
- 第一阶段必须保留 LLM 路径；本地 deterministic 测试保证可重复性，但发布环境必须通过真实百炼结构化调用门禁，未通过不得上线。

## 明确不做

本变更不改变第一阶段产品边界，不新增同义领域实体，不把模型推断自动写入 Project Memory/Workspace Memory，不覆盖历史 Snapshot 或 Approved Revision，不引入新的任意代码执行能力，也不把 Web E2E fixture 当作真实链路证据。

## 成功指标

- 新环境执行一条受控命令可以完成真实 API → Generation Worker → Render Worker → Evidence Block → 固定 Revision 导出闭环，并在结束后清理测试资源。
- 首个销售 CSV 场景在没有手工数据库写入、没有 API mock 的情况下生成 `succeeded` Job、一个 Chart Revision 和一个 Evidence Block。
- 每个成功 Revision 都能读取唯一 Snapshot、Metric Definition、TransformPlan、字段血缘、Flint Spec、Theme/Template 快照和两层校验记录。
- 失败、需要澄清和 Changes Requested 场景不会产生伪造成功结果，并能在 UI 给出下一步操作。
- Approved Revision 的编辑、覆盖和非固定 Revision 导出被拒绝。
- `pnpm docs:check`、`pnpm typecheck`、`pnpm test`、数据库迁移校验、隔离集成测试、Web E2E 和 live smoke 全部通过。
- 验收后工作树只包含本变更相关文件，无密钥、无临时调试日志、无未解释 TODO。

## 假设、依赖与风险

- 本地 Docker 可启动仓库已有的测试 PostgreSQL 和 MinIO；集成测试仍使用独立 schema/bucket guard。
- deterministic route 作为离线和代码回归的稳定基线；发布环境额外执行真实百炼结构化调用门禁，配置的 LLM route 继续使用冻结的 Model Route Snapshot。
- HTML 导出采用 Render Worker 服务端生成的静态 SVG 包装页，不接受用户任意 HTML/JavaScript 注入。
- API 新增或修改必须同步 `apps/web/app/api-console` 的 OpenAPI 展示、请求示例或场景编排。
- 主要风险是现有状态/契约已经较多，修复时可能触及迁移、异步幂等和 UI 状态；所有范围变化先回到本变更文档，不直接扩大第一阶段。

## 审核结论

- 结论：`APPROVED`
- 审核依据：用户已明确要求完成第一阶段，并确认 HTML 首版采用服务端生成的静态 SVG 包装页、发布环境必须通过真实百炼结构化调用门禁。
- 遗留约束：真实百炼业务质量、配额和生产稳定性不纳入本变更验收；发布连通性与结构化响应门禁必须通过，否则阻断上线。

deterministic route 继续用于离线和回归测试，不替代发布门禁。

## 验收标准概要

验收以 [第一阶段产品规格](../../product/phase1-consulting-report.md) 第 10 节为准，并增加一条真实链路标准：使用隔离环境、不依赖 API fixture，从 Project 创建到固定 Revision 导出完成一次完整 live smoke。所有标准将在 `test-plan.md`、`acceptance.md` 和 `handoff.md` 中记录命令、数据、日志和遗留问题。
