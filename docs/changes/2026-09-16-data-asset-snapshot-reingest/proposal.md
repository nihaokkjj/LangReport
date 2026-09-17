# Data Asset Snapshot re-ingest：提案

- 变更编号：`CHG-2026-09-16-DATA-ASSET-SNAPSHOT-REINGEST`
- 状态：`ACCEPTED`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 背景

第一阶段把 `Data Asset` 定义为 Project 内的逻辑数据资源，把 `Data Snapshot` 定义为一次生成实际使用的不可变数据版本。现有上传入口每次都创建新的 Data Asset 和 `v1` Snapshot，无法表达同一数据集的后续更新。现有数据 intake 变更（`CHG-2026-09-16-DATA-ASSET-INTAKE`）已明确将 re-ingest 留作后续变更。

## 要解决的问题

1. 同一逻辑数据集重复上传后产生重复 Data Asset，Asset 级列表和“当前数据”语义不清。
2. Snapshot 版本号无法形成 `v1 → v2 → v3` 的数据演进链。
3. 历史 Chart Revision 虽然仍绑定 Snapshot，但用户无法在同一 Asset 下查看、比较和选择历史数据版本。
4. 现有原始文件 Key 只包含 `assetId`，复用 Asset 时会覆盖旧原始文件，破坏输入审计。

## 目标用户与使用场景

咨询顾问在同一 Project 中维护“客户销售数据”时：

```text
首次导入销售表       → Data Asset A / Snapshot v1
上传更新后的销售表   → Data Asset A / Snapshot v2
历史图表             → 仍绑定 v1，不受 v2 影响
新导入库存表         → Data Asset B / Snapshot v1
```

## 需求范围

### MVP

1. 新导入仍创建新的 Data Asset。
2. 增加显式的“更新已有 Data Asset”操作，在目标 Asset 下创建新的 Data Snapshot。
3. 新 Snapshot 分配单调递增的版本号，并保留旧 Snapshot 和旧 Chart Revision。
4. 原始文件按 Snapshot 隔离，使用：

   ```text
   .../uploads/{assetId}/snapshots/{snapshotId}/source/{filename}
   ```

5. 将原始文件 Key 归属到 Snapshot，避免 `data_assets.object_key` 表示不明确的“当前文件”。
6. 更新失败时保留原有可用 Snapshot 和 Asset 状态，不把一次失败的更新覆盖成全局失败。
7. 前端提供“导入新文件”和“更新当前数据”两个明确入口；不按文件名自动猜测是否为同一 Asset。

## 后续范围

- Snapshot 差异比较和可视化；
- Snapshot 删除、恢复和保留策略；
- 异步大文件 re-ingest；
- 内容指纹去重和上传进度协议；
- 自动识别同名文件对应的 Asset。

## 明确不做

- 不覆盖或删除历史 Snapshot、Chart Revision 或 Approved Revision；
- 不把不同 Asset 自动合并；
- 不通过文件名、大小或内容 Hash 静默决定目标 Asset；
- 不改变 Generation Job 的输入合同，Job 仍冻结具体 `snapshotId`；
- 不引入跨文件 Join、实时数据源或通用 BI 能力；
- 不修改现有无关的 Web 样式和用户已有工作树修改。

## 成功指标

1. 同一 Asset 连续更新后能得到 `v1`、`v2`，且两者的 normalized object 和 source object Key 均不同。
2. 使用 v1 创建的 Generation Job/Chart Revision 在上传 v2 后仍能读取 v1。
3. 更新失败时旧 Asset 仍为 `ready`，最新可用 Snapshot 不变。
4. 并发更新不会生成重复 `(assetId, version)`，也不会覆盖对象。
5. 新建和更新两条入口都执行 Project/Conversation 权限和来源校验。
6. PublicDataAsset 不暴露任何 source 或 normalized object Key。

## 假设、依赖与风险

- 依赖现有 Data Asset intake、Snapshot access module、S3/MinIO adapter 和 PostgreSQL 迁移链。
- 更新使用目标 Asset 的不可变 `sourceConversationId` 构造 canonical object namespace；当前操作所在 Conversation 只用于请求关系校验和审计，不改变 Asset provenance。
- S3 与 PostgreSQL 仍不能使用同一事务，必须保留对象补偿；DB 事务只负责 Snapshot 元数据和 Asset 当前元数据的原子提交。
- 为了让历史原始文件可追溯，需要把 source object key 从 Data Asset 移到 Data Snapshot，并为已有记录执行可回滚的元数据回填。

## 未决问题

无。维护者已于 2026-09-16 确认本提案和设计文档，自动化验收已完成。

## 验收标准概要

1. 首次导入创建 Asset + v1，显式更新创建同一 Asset + v2。
2. source object 使用 Snapshot-scoped Key，normalized object 继续按 Snapshot ID 固定。
3. v1、v2 的 Snapshot 和原始文件均可独立读取，历史 Chart Revision 不受影响。
4. 更新并发、失败补偿、权限、迁移和 HTTP 合同测试通过。
