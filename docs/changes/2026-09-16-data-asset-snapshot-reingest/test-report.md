# Data Asset Snapshot re-ingest：测试报告

- 变更编号：`CHG-2026-09-16-DATA-ASSET-SNAPSHOT-REINGEST`
- 状态：`ACCEPTED`
- 测试时间：2026-09-16
- 执行方式：主 Agent 在共享工作树执行；本任务环境未提供独立测试 Agent。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @langreport/api typecheck` | PASS |
| `pnpm --filter @langreport/api test` | PASS，29 tests |
| `pnpm --filter @langreport/contracts test` | PASS，22 tests |
| `pnpm --filter @langreport/web typecheck` | PASS |
| `pnpm --filter @langreport/web test:typecheck` | PASS |
| `pnpm --filter @langreport/web test:e2e -- consulting-report.spec.ts` | PASS，桌面/移动 8 tests |
| `pnpm --filter @langreport/db db:verify` | PASS，迁移至 0022 |
| `pnpm typecheck` | PASS，含 workspace test:typecheck |
| `pnpm test` | PASS，离线门禁与各 package tests |
| `pnpm test:integration` | PASS，API 3 tests、Worker 1 test |
| `pnpm docs:check` | PASS |
| `git diff --check` | PASS |

## 失败与重试记录

第一次在普通沙箱执行 Playwright 时，Chromium 启动报 `browserType.launch: spawn EPERM`；错误发生在浏览器进程启动阶段，不是页面断言。提升执行权限后，同一 E2E 套件通过。一次中断的 E2E 子进程还导致 pnpm 依赖链接暂时不完整，已结束残留进程、按 `pnpm-lock.yaml` 重建依赖并重新通过全仓 typecheck/test；该环境修复没有改动业务源码或 `apps/web/app/globals.css`。

## 覆盖结论

- 新建和显式更新使用不同 HTTP target；更新复用同一 Asset。
- 真实 PostgreSQL 行锁保证并发更新按 Snapshot version 连续提交，MinIO 中每个 source/normalized object 均可读。
- 迁移 verifier 验证历史 source key 回填、`source_object_key` 非空和 `data_assets.object_key` 移除。
- 历史 Generation Worker 输入仍以冻结 `snapshotId` 读取；未修改 Generation Job 或 Chart Revision 合同。
