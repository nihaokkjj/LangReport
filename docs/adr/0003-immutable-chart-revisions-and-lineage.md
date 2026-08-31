---
status: accepted
---

# Make Chart Revisions immutable and traceable

每次生成或编辑都创建新的 Chart Revision，不覆盖已有版本。每个 Revision 必须绑定一个 Data Snapshot，并保存 TransformPlan、字段血缘、Flint Spec、主题快照、渲染后端版本、校验结果和输出产物。这个选择保证图表可以复现、审核和回滚，也避免“当前文件变化导致历史图表悄悄变化”。

## Consequences

编辑、审核和导出都以 Revision 为对象；Approved Revision 只能读取，修改必须产生新 Revision。系统需要承担快照和对象存储的保留成本，并在 UI 中明确展示版本关系。
