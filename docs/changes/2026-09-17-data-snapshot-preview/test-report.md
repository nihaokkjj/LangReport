# Data Snapshot Preview：测试报告

- 变更编号：`CHG-2026-09-17-DATA-SNAPSHOT-PREVIEW`
- 测试状态：`PARTIAL`
- 代码快照：`工作树快照（未创建 commit；保留会话开始前的 CONTEXT.md、ADR 和变更文档修改）`

## 测试范围

测试范围已在 [test-plan.md](./test-plan.md) 中定义，覆盖 Snapshot 列表/详情 API、权限、nullable 来源元数据、Web 最新/历史预览、只读表格、懒加载、错误重试、响应式和生成输入回归。

## 测试环境

沿用仓库现有 API、DB、Web E2E 和集成测试入口；集成验证启动了 `infra/docker-compose.test.yml` 定义的隔离 PostgreSQL/MinIO 测试服务，不使用真实客户数据。

## 执行命令与结果

| 命令 | 结果 | 关键输出 |
| --- | --- | --- |
| `pnpm --filter @langreport/contracts test` | PASSED | 23/23 tests；summary/detail schema 边界通过 |
| `pnpm --filter @langreport/api typecheck` | PASSED | API TypeScript 检查通过 |
| `pnpm --filter @langreport/api test` | PASSED | 29/29 unit/HTTP tests |
| `pnpm --filter @langreport/web typecheck` | PASSED | Web TypeScript 检查通过 |
| `pnpm --filter @langreport/web test:e2e -- consulting-report.spec.ts` | PASSED | Chromium desktop/mobile 10/10；含最新/历史版本预览 |
| `pnpm --filter @langreport/db db:verify` | PASSED | 迁移链和历史 nullable 元数据验证通过 |
| `pnpm typecheck` | PASSED | workspace production/test typecheck 全部通过 |
| `pnpm test` | PASSED | offline test 和 workspace unit tests 全部通过 |
| `pnpm test:integration` | PASSED | API 3/3、worker 1/1；含权限、对象键隔离、并发追加和生成回归 |
| `pnpm docs:check` | PASSED | 文档检查通过 |
| `git diff --check` | PASSED | 无 whitespace 错误 |

## 失败用例

最终执行没有未通过的自动化用例。执行过程中的可恢复失败已修正并复测：首次迁移断言需将 postgres Result 转为普通数组；首次集成测试前测试 Compose 未启动；沙箱内 Playwright 无法启动 Chromium（`spawn EPERM`），授权在沙箱外重跑后通过；E2E fixture 的折叠上下文和移动端依据抽屉定位已修正。

## 测试代码变更

无自动化失败用例；本变更新增/更新了 API integration、contracts unit 和 Web E2E 测试，详见代码文件与上方结果。

## 覆盖缺口

- 尚未完成人工 25 行 × 200 列 fixture 的全列到达、sticky header/first column 和页面级横向溢出检查；
- 尚未完成人工读屏/完整 Tab 焦点路径、注入历史详情 404/500 后重试和编辑尝试的逐项验收；
- 独立测试 Agent 当前不可用，后续由主 Agent 按 test-plan 执行并记录限制。

## 复测记录

- 2026-09-17：完成 T1-T6 自动化验证；全部 test-plan 自动化命令通过。
- 2026-09-17：验收仍保留 `PARTIAL`，等待人工验收缺口完成后再决定是否推进到 `ACCEPTED`。
