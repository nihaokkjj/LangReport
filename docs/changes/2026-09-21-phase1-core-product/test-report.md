# 独立测试报告

- 变更编号：`CHG-2026-09-21-phase1-core-product`
- 测试状态：`VERIFYING — 本地/隔离回归通过，真实百炼门禁阻塞`
- 代码快照：工作树快照；基线为 `a29ed06`，当前变更尚未提交

## 测试范围

本报告记录实现后的等价测试快照。由于当前环境没有独立 worktree 测试角色，本轮由主 Agent 在业务代码完成后重新运行同一测试契约；不把 mock Web E2E 当成真实 Worker 证据，真实 API/Worker 证据来自 `pnpm phase1:smoke`。

## 测试环境

- Windows + Node 22 + pnpm 11
- LangReport monorepo
- 隔离 PostgreSQL/MinIO 测试 Compose
- deterministic Model Route
- live smoke 使用 deterministic Model Route；发布门禁另行要求真实百炼

## 执行命令与结果

| 命令 | 结果 | 关键输出 |
| --- | --- | --- |
| `pnpm docs:check` | 通过 | `docs:check passed` |
| `pnpm typecheck` | 通过 | 全 workspace 与 test:typecheck passed |
| `pnpm test` | 通过 | 离线契约/单测全部 passed |
| `pnpm build` | 通过 | Next.js 生产构建和全 workspace build passed |
| `pnpm --filter @langreport/db db:verify` | 通过 | 迁移兼容性验证 passed |
| `pnpm test:integration` | 通过 | API 4 项、Generation/Render Worker 1 项通过，真实 PostgreSQL/MinIO |
| `pnpm test:e2e` | 通过 | Chromium 桌面/移动共 12 项；使用 API fixture，授权环境运行 |
| `pnpm phase1:smoke` | 通过 | 2026-09-22 runId `f13399726e4e4affa5066bdf20b8f6a6`；生成/编辑 Job 均到 `succeeded`，导出四种格式，资源已清理 |
| `pnpm phase1:release-gate` | 未通过（阻止发布） | 2026-09-22 已实际执行；当前环境 `GENERATION_MODE=deterministic`，门禁按合同在请求前拒绝，必须在发布环境用真实 `llm` 配置重跑 |

## 遗留与门禁项

| 用例 | 严重程度 | 复现步骤 | 实际结果 | 预期结果 |
| --- | --- | --- | --- | --- |
| HTML 固定 Revision 导出 | 已解决 | 对 Approved Revision 请求 HTML 输出 | 已由静态 SVG 包装页实现，并在 smoke/Worker 单测检查转义和脚本禁用 | 返回可离线打开的安全 HTML |
| 发布环境真实百炼门禁 | P0 | `GENERATION_MODE=llm pnpm phase1:release-gate` | 当前环境为 deterministic，未发供应商请求 | 发布环境真实结构化调用成功且保存脱敏证据 |

## 测试代码变更

已扩展 `apps/generation-worker/test/integration/worker.integration.test.ts`，增加 HTML 对象存在、静态 SVG、无脚本、三处 `resultSummary` 一致性和最终 Render Validation 审计一致性断言；`packages/data-engine` 的 600 行用例证明摘要不受 500 行预览截断影响。本报告只记录结果，不把 release gate 配置失败改写为通过。

## 覆盖缺口

- 真实模型供应商的业务质量、生产认证 Provider 和多用户协作不在 deterministic 功能回归范围；真实百炼连通性和结构化输出属于单独发布门禁。
- 没有真实百炼发布环境凭据，不能代替最终发布门禁结论。

## 复测记录

下一步：在发布 ECS/CI 环境加载真实 `GENERATION_MODE=llm`、`BAILIAN_BASE_URL`、`BAILIAN_MODEL_ID`、`BAILIAN_STRUCTURED_OUTPUT` 和 Worker-only `BAILIAN_API_KEY`，执行 `pnpm phase1:release-gate`；通过后再将本变更从 `VERIFYING` 推进到人工验收。
