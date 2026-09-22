# 第一阶段核心产品可用化验收

- 变更编号：`CHG-2026-09-21-phase1-core-product`
- 状态：`VERIFYING`
- 负责人：LangReport owner agent
- 创建时间：2026-09-21
- 更新时间：2026-09-21

## 验收结论

- 结论：`PARTIAL — 产品闭环通过，发布环境真实百炼门禁待执行`
- 验收人：待人工审核
- 验收时间：2026-09-21
- 验证 commit：工作树快照（基线 `a29ed06`，尚未提交）

本轮实现和回归已完成，产品核心闭环通过真实隔离 HTTP smoke；HTML 首版为服务端静态 SVG 包装页。当前仍不能标记为 `ACCEPTED`：发布环境的真实百炼结构化调用尚未提供可用的 `GENERATION_MODE=llm` 配置，本地门禁因此在发出请求前失败。

## 验收证据

| 标准 | 证据 | 命令或文件 | 结果 |
| --- | --- | --- | --- |
| 1. 创建、重开、切换 Project | live smoke + Web E2E | `pnpm phase1:smoke`, `pnpm test:e2e` | 通过；Project 创建和刷新列表可恢复，E2E 桌面/移动 10 项通过 |
| 2. 上传 CSV 并显示画像/质量 | data integration + live smoke | `apps/api/test/integration/data-assets.integration.test.ts`, `pnpm phase1:smoke` | 通过；真实粘贴 CSV、Snapshot 和字段画像可读 |
| 3. 创建/继续 Conversation | API integration + live smoke | `apps/api/test/integration/message-generation.integration.test.ts`, `pnpm phase1:smoke` | 通过；Conversation 创建和刷新列表可读 |
| 4. 确认 Metric/同比口径 | readiness + live smoke | generation/API tests, `pnpm phase1:smoke` | 通过；确认 Metric Definition 和 Brief 后才创建 Job |
| 5. 生成 Chart Artifact/Evidence Block | Worker integration + live smoke | `apps/generation-worker/test/integration/worker.integration.test.ts`, `pnpm phase1:smoke` | 通过；真实 Job 状态到 `succeeded` 并持久化 Evidence |
| 6. 编辑类型、字段、筛选、标题、主题令牌 | chart/API/Web tests | `packages/chart`, API tests, `pnpm test:e2e`, `pnpm phase1:smoke` | 通过；编辑入口可用，Revision 2 生成并可审核 |
| 7. 逻辑/视觉修改追加 Revision | domain/Worker integration | chart/worker tests, `pnpm phase1:smoke` | 通过；子 Revision 的 `parentRevisionId` 指向初始 Revision |
| 8. Revision 可查看完整血缘和校验 | API/Web/live smoke | >500 行 unit、worker integration、revision/evidence routes、`pnpm phase1:smoke` | 通过；完整 `resultSummary` 在 Job/Revision/Evidence 一致，finding 不读预览，最终 HTML 校验同步进入 Generation Audit |
| 9. 评论、要求修改、批准和只读 | API/Web/live smoke | chart routes + `pnpm test:e2e`, `pnpm phase1:smoke` | 通过；评论、resolve、Changes Requested、reopen、submit、approve 全链路通过 |
| 10. PNG/SVG/HTML/Vega-Lite 固定 Revision 导出 | render/API/live smoke | output contract + export tests, `pnpm phase1:smoke` | 通过；四种格式均从指定 Revision 导出，HTML 含静态 SVG 且无脚本 |
| 11. 失败显示原因和下一步 | API/Worker/Web/live smoke | failure/clarification/retry tests, `pnpm test`, `pnpm test:integration` | 通过；单测/集成覆盖缺前置条件、澄清、失败、重试和租约接管 |
| 12. 刷新/重登后数据仍存在 | live HTTP smoke | `pnpm phase1:smoke` | 通过；刷新 Project/Conversation/Evidence 仍可读取，Approved 状态保留 |
| 13. 无 API mock 的真实 API/Worker 闭环 | live smoke | `pnpm phase1:smoke` | 通过；隔离 PostgreSQL/MinIO、API、Generation Worker、Render Worker 全链路通过并清理 |

## 失败项与遗留问题

- 真实 live smoke 当前是 HTTP 主路径；现有 Web E2E 使用 API fixture，不能替代生产浏览器到常驻 Worker 的部署验收。
- 发布环境真实百炼结构化调用是上线前强制门禁；本地执行结果为 `GENERATION_MODE=deterministic` 配置失败，未发出供应商请求，必须在发布环境补充脱敏通过证据。

## 文档同步确认

- [x] `proposal.md`、`design.md`、`task.md`、`test-plan.md` 与实现一致。
- [x] `CONTEXT.md`、产品规格、架构文档没有描述已被实现改变的旧行为。
- [x] `test-report.md` 已记录当前工作树快照的命令和结果；未伪造独立 Agent。
- [x] `handoff.md` 已记录当前验证状态、已知限制和下一步。
