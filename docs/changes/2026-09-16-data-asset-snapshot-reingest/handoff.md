# Data Asset Snapshot re-ingest：交接

- 变更编号：`CHG-2026-09-16-DATA-ASSET-SNAPSHOT-REINGEST`
- 当前阶段：`ACCEPTED`
- 更新时间：2026-09-16

## 当前状态

设计已按维护者指令确认，业务实现、自动化验收和交接均已完成。当前状态为 `ACCEPTED`；尚未创建包含变更编号的 Git commit，因此不推进到 `COMMITTED`。

## 已完成

- [proposal.md](./proposal.md)：定义同一 Asset 追加 Snapshot、显式新建/更新入口和范围边界；
- [design.md](./design.md)：定义 API、DB、对象存储、intake、Worker、Web、迁移和失败补偿方案；
- [task.md](./task.md)：拆分实现和验证任务；
- [test-plan.md](./test-plan.md)：定义 unit、API、迁移、Worker、集成和 Web E2E 验收；
- [ADR 0021](../../adr/0021-data-asset-snapshot-reingest.md)：记录同一 Asset 追加 Snapshot 和 Snapshot-scoped source object 的决策；
- `pnpm docs:check` 已通过；
- 当前工作树原有 `apps/web/app/globals.css` 未被本变更修改，已保留。

## 已确认设计

1. 普通导入创建新的 Data Asset + Snapshot v1。
2. 显式更新已有 Asset 创建同一 Asset 下的 Snapshot v2/vN。
3. 新增更新入口：

   ```text
   POST /api/v1/projects/:projectId/data-assets/:assetId/snapshots/upload
   POST /api/v1/projects/:projectId/data-assets/:assetId/snapshots/paste
   ```

4. 每个 Snapshot 保存自己的 `sourceObjectKey`；新原始文件路径为：

   ```text
   .../uploads/{assetId}/snapshots/{snapshotId}/source/{filename}
   ```

5. normalized object 保持现有路径，避免破坏 Snapshot access module：

   ```text
   .../uploads/{assetId}/snapshots/{snapshotId}.json
   ```

6. `data_snapshots.source_object_key` 从历史 `data_assets.object_key` 回填后，删除 `data_assets.object_key`。
7. 更新失败时保持旧 Asset 和旧 Snapshot 可用；新建 Asset 继续使用现有 `processing → ready/failed` 语义。
8. Generation Job/Chart Revision 仍绑定具体 `snapshotId`，不跟随最新版本漂移。
9. 前端显式提供“导入文件”和“更新当前数据”，不按文件名或 Hash 自动合并。

## 下一会话启动必读

1. 根目录 `AGENTS.md`、`CONTEXT.md`；
2. `docs/project-spec.md`、`docs/product/phase1-consulting-report.md`、`docs/agent/agent-loop-spec.md`；
3. `docs/changes/README.md`；
4. 本变更目录的 `proposal.md`、`design.md`、`task.md`、`test-plan.md`、本文件；
5. 现有实现：`apps/api/src/data-assets.ts`、`apps/api/src/routes.ts`、`packages/db/src/schema.ts`、`packages/storage/src/index.ts`、`apps/generation-worker/src/snapshot-access.ts`、`apps/web/app/page.tsx`；
6. `DESIGN.md` 和 `apps/web/AGENTS.md`（会修改 Web 交互）。

## 实现顺序

1. 已取得维护者对 proposal/design 的确认；
2. 已修改 contracts 和 API route，加入更新 upload/paste 入口；
3. 已修改 storage helper 和 DB migration，将 source key 移到 Snapshot；
4. 已修改 intake，支持 new/existing target、Snapshot 版本锁定和更新失败隔离；
5. 已回归 Snapshot access/Generation Worker；
6. 已修改 Web 数据入口并补充 E2E；
7. 已同步 ADR、验收、测试报告和交接文档；
8. 已运行 test plan 中的验证命令。

## 重要实现注意事项

- 更新请求的 `conversationId` 必须属于目标 Project；目标 Asset 也必须属于该 Project；
- Asset 的不可变 `sourceConversationId` 不因更新请求来自其他 Conversation 而改变；canonical key 使用 Asset 的来源 Conversation；
- 更新已有 ready Asset 时不要先把它改成 failed；新 Snapshot 提交前旧版本必须继续可读；
- 版本分配事务需要锁定目标 Asset 行，再读取最大 Snapshot version；
- source 和 normalized 对象都必须使用新的 `assetId + snapshotId`，失败时只清理本次对象；
- 不使用破坏性 Git 命令，不覆盖用户已有 CSS 修改。

## 验证入口

已运行：

```text
pnpm --filter @langreport/api typecheck
pnpm --filter @langreport/api test
pnpm --filter @langreport/contracts test
pnpm --filter @langreport/web typecheck
pnpm --filter @langreport/db db:verify
pnpm typecheck
pnpm test
pnpm test:integration
pnpm docs:check
git diff --check
```

详细结果见 [acceptance.md](./acceptance.md) 和 [test-report.md](./test-report.md)。
