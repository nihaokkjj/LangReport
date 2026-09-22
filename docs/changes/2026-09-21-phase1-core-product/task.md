# 第一阶段核心产品可用化任务拆分

- 变更编号：`CHG-2026-09-21-phase1-core-product`
- 状态：`VERIFYING`
- 负责人：LangReport owner agent
- 创建时间：2026-09-21
- 更新时间：2026-09-21

## 执行前提

- `proposal.md`、`design.md`、`task.md` 和 `test-plan.md` 已按用户确认的范围批准；当前进入业务代码实现阶段。
- 实现前已检查 `git status`，保留工作区已有修改；当前业务、测试、脚本和治理文档修改均属于本变更。
- 任何 API/Contract 变更必须在同一任务中同步 `apps/web/app/api-console`。
- UI 变更必须遵循根 `DESIGN.md` 和 `apps/web/AGENTS.md`，完成桌面、移动、加载、空、错误和 Approved 只读状态检查。

## 任务清单

| ID | 任务 | 依赖 | 可并行 | 负责人 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T0 | 建立第一阶段变更文档和基线 | 无 | 否 | 主 Agent | 已完成 | `git status`, `pnpm docs:check` | 文档状态一致，范围/不做/追踪矩阵可审阅 |
| T1 | 固化测试数据、隔离 live smoke 运行器和资源清理 | T0 | 否 | 主 Agent | 已完成 | `pnpm phase1:smoke` | 不使用 API mock，能启动隔离 PostgreSQL/MinIO、API、两个 Worker，结束清理 schema/bucket/process；发布环境另有真实百炼门禁 |
| T2 | 审计并修正 Project/Conversation/Data Snapshot/Brief/Metric 的真实 API 前置条件和刷新恢复 | T0 | 可与 T5 并行 | 主 Agent | 已完成 | `pnpm --filter @langreport/api test`, `pnpm test:integration`, live smoke | 首次使用路径可创建项目、对话、数据、Brief、Metric；历史 Snapshot 不被覆盖；越权/重复请求有稳定错误 |
| T3 | 固化 Generation Readiness、Job 状态、澄清/失败/重试/取消的用户可恢复行为 | T2 | 否 | 主 Agent | 已完成 | `pnpm test`, API/Worker integration, live smoke | 缺前置条件不伪造成功；状态序列和下一步在 API/Web 一致；两轮 repair 上限有效 |
| T4 | 串通真实 Generation Worker→Render Worker→Revision/Evidence 持久化和幂等 | T3 | 否 | 主 Agent | 已完成 | Worker integration, live smoke | 一个真实 Job 产生一个 Revision/Evidence；租约接管和重复提交不重复写结果；所有血缘和校验记录齐全 |
| T5 | 补齐固定 Revision HTML 输出并同步 Contracts/API/API Console/Web 下载入口 | T4 | 否 | 主 Agent | 已完成 | contract tests, render tests, API tests, `pnpm docs:check` | PNG/SVG/HTML/Vega-Lite 都来自指定 Revision；HTML 自包含、转义安全、无用户脚本；OpenAPI 和 api-console 同步 |
| T6 | 完成图表编辑、主题/模板版本和审核 Comment/Changes Requested/Approved UI 的可用路径 | T4 | 可与 T5 后半并行 | 主 Agent | 已完成 | `pnpm --filter @langreport/web typecheck`, Web E2E, live smoke | 逻辑/视觉修改追加 Revision；审核评论可保存/解决；Approved 只读；桌面和移动端状态可操作 |
| T7 | 增加无 mock 的浏览器/HTTP 主路径验收和异常路径 | T1-T6 | 否 | 主 Agent + 独立测试角色 | 已完成 | `pnpm phase1:smoke`, `pnpm test:e2e` | 覆盖创建→上传→确认→生成→刷新→审核→批准→导出；失败/澄清/重试至少一条可复现 |
| T8 | 完成验收、交接、文档同步和发布前门禁 | T7 | 否 | 主 Agent | 进行中 | `pnpm docs:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:verify`, `pnpm phase1:release-gate` | `acceptance.md` 每条标准有证据；`test-report.md` 有独立快照结果；发布环境真实百炼结构化调用通过；`handoff.md` 可让新会话继续 |

## 执行顺序

```text
T0 → T1 → T2 → T3 → T4 → T5/T6 → T7 → T8
```

T5 和 T6 在 T4 的 Revision/Evidence 数据合同稳定后可以并行，但两者都必须先完成 Contract/API Console 联动再进入 live smoke。

## 并行工作流

- 主 Agent：T1–T6 的设计内实现、业务代码、契约和文档同步。
- 独立测试角色：T7 从完成后的代码快照执行测试，只修改测试文件和 `test-report.md`，不修改业务代码。
- 若运行环境不能提供隔离 worktree/子 Agent，主 Agent 必须在 `test-report.md` 记录限制，并以独立快照/干净状态执行同一测试契约。

## 阻塞条件

- 用户未批准本 L/XL 变更时，禁止修改业务代码。
- Docker Engine、Node/pnpm 或测试端口不可用时，允许继续离线实现，但不能把 live smoke 标记为通过。
- 需要改变产品边界、引入新实体、跨文件 Join 或真实外部供应商依赖时，返回 `PROPOSED` 重新审核。
- 发现现有用户修改与任务无法安全共存时停止并报告，不覆盖或重置。

## 回滚或替代方案

- HTML 输出失败时，保留旧的 SVG/PNG/Vega-Lite 路径，回滚只撤回 HTML 格式暴露，不删除历史对象。
- live smoke 失败时保留失败日志和 Job 数据摘要，先修复对应状态/契约，不降低验收为 mock 测试。
- 若必须迁移数据库，使用可前向兼容的 nullable/JSON 扩展；迁移失败时不覆盖现有 Snapshot/Revision。
- 若 Web 改动造成回归，保留 API/Worker 业务闭环，按小任务回退 UI 暴露并保留测试证据。

## Definition of Done

- [ ] T0–T8 均有完成记录，需求追踪矩阵不再出现“待实现”。
- [x] 第一阶段 13 条产品验收标准和无 mock live smoke 已有通过证据；发布环境门禁仍待真实凭据。
- [x] 失败、澄清、重试、审核、Approved 只读和固定 Revision 导出均有自动化证据。
- [x] 迁移、Contracts、API Console、Web、Worker、Storage 文档和代码已同步。
- [x] `pnpm docs:check`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm db:verify`、集成测试和 E2E 通过。
- [ ] 发布环境真实百炼结构化调用门禁通过，且脱敏证据已记录。
- [x] 当前 diff 无调试日志、临时文件或敏感信息，`git diff --check` 通过。
- [x] 变更已进入 `VERIFYING`；最终 `ACCEPTED` 仍需发布门禁和人工验收。
