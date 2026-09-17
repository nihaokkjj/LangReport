# ADR 0022：历史 Snapshot 只读预览，生成始终使用最新版本

- 状态：`ACCEPTED`
- 日期：2026-09-17
- 关联变更：`CHG-2026-09-17-DATA-SNAPSHOT-PREVIEW`

LangReport 决定为同一 Data Asset 提供默认最新、可切换历史的 `Data Snapshot Preview`，但历史 Snapshot 只能用于核对，不能作为新的 Generation Cycle 输入；Generation Cycle 始终固定使用该 Data Asset 的最新 Snapshot。这样既保留历史审计能力，又避免用户仅为查看旧数据而意外基于旧版本生成图表。

## 取舍

- 预览版本与生成输入分离，减少误用旧数据的风险，但用户不能直接从历史预览发起生成；需要基于历史版本分析时，后续必须另立明确的历史分析流程。
- 预览使用有限行数和按需加载，控制客户数据在浏览器中的暴露量与首屏负担，但不提供完整原始文件浏览能力。
- 新 Snapshot 保存来源文件元数据；既有 Snapshot 的新增字段允许为空且不做历史回填，避免迁移依赖对象存储或伪造历史事实。
