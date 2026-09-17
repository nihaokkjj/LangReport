# ADR 0021：同一 Data Asset 追加 Snapshot，并按 Snapshot 隔离原始文件

- 状态：`PROPOSED`
- 日期：2026-09-16
- 关联变更：`CHG-2026-09-16-DATA-ASSET-SNAPSHOT-REINGEST`

## 背景

第一阶段需要区分逻辑数据资源和不可变数据版本。每次更新同一逻辑数据集时，如果创建新的 Data Asset，会造成重复资源和断裂的版本语义；如果复用 Asset 但继续使用只包含 `assetId` 的 source object Key，又会覆盖历史原始文件。

## 决策

1. “更新已有数据集”必须是显式操作，在同一 Data Asset 下追加新的 Data Snapshot；普通“导入文件”仍创建新的 Data Asset。
2. 每个 Snapshot 保存自己的 `sourceObjectKey` 和 `normalizedObjectKey`。
3. 新 source object 使用：

   ```text
   .../uploads/{assetId}/snapshots/{snapshotId}/source/{filename}
   ```

4. `data_assets.object_key` 不再作为多版本数据集的存储归属；历史值回填到对应 Snapshot 后移除该字段。
5. Generation Job 和 Chart Revision 永远绑定具体 Snapshot，不跟随 Asset 的最新版本漂移。

## 取舍

- 显式操作多一个用户动作，但避免了按文件名或 Hash 自动合并造成的错误归档；
- Snapshot 增加 source key 字段和迁移成本，但换取原始输入可追溯、可保留和不覆盖；
- 更新期间保留旧 Asset/最新 Snapshot 可用，代价是更新状态不再完全由 Data Asset 的 `processing` 表达；本次同步接口以最终事务提交作为更新原子边界。

## 后果

- API、Web、DB、storage helper、intake 和测试需要一起变更；
- 历史 source object 可以继续使用旧路径引用，新对象不得生成旧路径；
- 后续若要支持 Snapshot 级清理、比较或异步处理，可以直接以 Snapshot 的 source/normalized key 为边界；
- 不允许通过修改 Asset 当前指针来覆盖历史含义。
