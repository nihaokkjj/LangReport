# Data Asset Snapshot re-ingest：验收记录

- 变更编号：`CHG-2026-09-16-DATA-ASSET-SNAPSHOT-REINGEST`
- 状态：`ACCEPTED`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 验收结论

- 结论：`ACCEPTED`
- 验收时间：2026-09-16
- 验证 commit：未提交；基线 HEAD 为 `cc94b25`
- 结论说明：新建/更新 API、Snapshot-scoped source object、历史元数据迁移、失败补偿、并发版本分配、Worker 固定 Snapshot 读取和 Web 显式入口均已通过自动化验收。

## 验收证据

| 标准 | 证据 | 命令或文件 | 结果 |
| --- | --- | --- | --- |
| 新建入口创建新 Asset + Snapshot v1 | API intake 与 Web E2E | `apps/api/test/unit/data-assets.test.ts`；`apps/web/test/e2e/consulting-report.spec.ts` | PASS |
| 更新入口复用 Asset 并追加 v2/vN | API 集成、intake unit、Web E2E | `apps/api/test/integration/data-assets.integration.test.ts`；显式分流用例 | PASS |
| source object 按 Snapshot 隔离 | Storage helper、DB 集成 | `snapshotSourceObjectKey`；真实 MinIO 对象读取 | PASS |
| normalized object 和 Snapshot access 合同保持稳定 | Worker unit/integration | `apps/generation-worker/test/integration/worker.integration.test.ts`；`snapshot-access.test.ts` | PASS |
| 历史 Job/Revision 仍读取冻结 v1 | Worker 集成回归 | `worker.integration.test.ts`：historical snapshot | PASS |
| 更新失败不污染旧 Asset/Snapshot | intake unit | source 写入失败补偿用例 | PASS |
| 并发更新不重复版本、不覆盖对象 | PostgreSQL/MinIO 集成 | `data-assets.integration.test.ts`：连续 v3/v4 与对象读取 | PASS |
| 跨 Project 和来源 Conversation 更新被拒绝 | API 集成 | `data-assets.integration.test.ts`：404/400 稳定错误 | PASS |
| 迁移可回填 source key 并移除旧列 | migration verifier | `0022_data_asset_snapshot_reingest.sql`；`pnpm --filter @langreport/db db:verify` | PASS |
| PublicDataAsset 不泄露对象 Key | contracts/intake unit | `data-assets.test.ts`；HTTP contract tests | PASS |
| Web 明确区分导入和更新 | Playwright 桌面/移动 | `consulting-report.spec.ts`：8 passed | PASS |
| 用户现有 CSS 修改保留 | 工作树审计 | `git diff -- apps/web/app/globals.css` | PASS（无本次修改） |

## 验收范围外

- Snapshot diff、删除/恢复、异步大文件、内容 Hash 去重和自动 Asset 匹配仍按 proposal 保持后续范围。
- Git commit 未在本次任务中创建，因此变更仍处于 `ACCEPTED`，未进入 `COMMITTED`。
