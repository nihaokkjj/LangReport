---
status: accepted
---

# 第一阶段先做咨询项目报告证据模块

LangReport 第一阶段聚焦咨询项目报告，而不是同时服务产品、运营、研究和通用 BI。每次 Generation Cycle 只生成一个主图表和一个 Evidence Block；完整多页报告、Dashboard 和通用行业指标库延后。

## 背景

“AI 生成图表、可编辑、项目记忆和主题模板”已经是多个数据分析产品的共同能力。LangReport 需要先验证更具体的价值：顾问能否用更短时间完成一份可审核的数据证据，并且在复盘时解释数据、指标、变换和修改历史。

咨询项目同时具备高价值、重复性、客户视觉规范和审核流程，适合作为第一个垂直场景。若第一阶段直接做完整报告编辑器或通用 BI，会同时引入多图编排、数据连接、权限、协作和企业治理，无法判断核心价值来自哪里。

## 决策

第一阶段采用以下产品边界：

- 一个 Consulting Project；
- 一个 Analysis Brief；
- 一个 Data Snapshot；
- 一个 Generation Cycle；
- 一个主 Chart Artifact/Chart Revision；
- 一个 Evidence Block；
- 一个固定版本的 Visual Template；
- 经过 Review 后导出固定 Revision。

证据模块必须能回溯到 Data Snapshot、Metric Definition、TransformPlan、字段血缘、Flint Spec、Visual Template 快照和校验结果。生成成功表示候选结果通过必要校验，不表示已审核或可自动发布。

## 后果

### 正面

- 可以用一个完整但狭窄的工作流验证产品价值；
- 数据正确性、指标口径和审核能力成为核心体验；
- Chart Revision、Project Memory 和 Visual Template 都有真实使用场景；
- 自动生成结果的质量可以用“Draft 到 Approved 的耗时和修改次数”衡量。

### 代价

- 第一阶段不能覆盖完整咨询报告和复杂 Dashboard；
- 需要用户先理解 Brief、指标口径和审核状态；
- 单次只生成一个证据模块，报告编排需要后续阶段；
- 早期模板数量和图表类型较少。

## 未选择的方案

### 通用 AI 图表工具

启动成本低，但与 ChatGPT、Julius、Data Formulator 等产品的功能重合，难以建立差异化。

### 先做完整在线报告编辑器

能展示更完整的 Demo，但会把资源集中到排版和协作基础设施，无法优先证明“可追溯图表证据”的价值。

### 先做企业 BI 替代品

需要数据库连接、实时刷新、语义层、细粒度权限、Dashboard 和合规能力，产品范围过大，不适合作为第一阶段验证。
