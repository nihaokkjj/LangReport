# LangReport 产品路线

## 当前产品第一阶段

第一阶段只验证一个垂直场景：

> 咨询顾问上传客户销售数据，用自然语言提出一个分析问题，确认指标口径，生成一个可编辑、可追溯、符合项目视觉规范的图表证据模块，经过审核后导出固定版本。

第一阶段产品规格和限制以 [phase1-consulting-report.md](./phase1-consulting-report.md) 为准；Agent 的开发启动和 Loop 行为以 [agent-loop-spec.md](./agent-loop-spec.md) 为准。

## 第一阶段范围

### 产品能力

- 创建、列表、切换和归档咨询 Project；
- Project 内持久化 Conversation；
- 上传 CSV、XLSX、JSON 或粘贴表格；
- Data Asset、不可变 Data Snapshot 和字段画像；
- Analysis Brief 和已确认 Metric Definition；
- 有限 TransformPlan 和字段血缘；
- Line、Bar、Area 主图表生成；
- 一个 Generation Cycle 生成一个主 Chart Artifact 和一个 Evidence Block；
- Chart Revision、修订、回滚、审核和评论；
- Project Visual Template 和模板版本快照；
- 交互式预览、PNG、SVG 和 HTML 导出。

### 工程交付顺序

#### M1：Project、Conversation 和数据资产

验收：用户可以进入 Project，上传文件，查看字段画像，刷新后仍能看到 Data Asset、Snapshot 和 Conversation。

#### M2：Brief、口径和生成输入

验收：系统可以记录业务问题、受众、时间范围和指标定义；歧义字段会进入澄清流程，不会静默猜测。

#### M3：Generation Cycle

验收：固定示例 CSV 可以完成 Profile → Plan → Transform → Compile → Validate → Render，并生成可解释的 Draft。

#### M4：Evidence Block 和图表编辑

验收：用户能修改图表类型、字段、筛选、排序、标题和允许的视觉令牌；逻辑变化会重新执行并生成新 Revision。

#### M5：审核、模板和导出

验收：Reviewer 可以评论、要求修改和批准；Approved Revision 不可修改；导出绑定固定 Revision 和模板快照。

## 第一阶段硬限制

- 一个 Cycle 使用一个 Data Snapshot；
- 一个 Cycle 生成一个主图表和一个 Evidence Block；
- 单文件 50 MB、1,000,000 行硬上限；首发目标为 20 MB、100,000 行以内；
- 主图表只支持 Line、Bar、Area；
- 自动校验修复最多两轮；
- 一次 Cycle 不跨文件 Join；
- 只支持有限的字段、过滤、聚合、排序、比率、差值、同比和环比变换；
- 只允许声明式 Visual Template；
- 不执行用户任意 SQL、Python、JavaScript 或服务器端插件；
- 不自动批准、发布、写入长期记忆或改变 Project Template；
- 不提供数据库/实时连接、Dashboard、实时协作、公开分享和完整 PPT 排版。

## 第一阶段生成闭环

```text
Project
  → Analysis Brief
  → Data Asset / Data Snapshot
  → Conversation
  → Generation Cycle
  → TransformPlan / Metric Definition
  → Chart Artifact / Chart Revision
  → Evidence Block
  → Review
  → Approved Revision
  → PNG / SVG / HTML
```

每一个用户可见的成功结果必须能回答：

- 使用了哪个 Data Snapshot；
- 指标如何定义；
- 做了哪些数据变换；
- 哪些字段生成了图表；
- 使用了哪个 Visual Template 版本；
- 哪些校验通过或产生了警告；
- 当前 Revision 是谁在何时生成和审核的。

## 暂缓范围

以下内容属于后续产品阶段，不得成为第一阶段隐含依赖：

- 数据库、API、实时刷新和多表 Join；
- Dashboard、多图联动和完整报告编辑器；
- PPT/Excel 原生排版；
- Workspace 外部访问和客户门户；
- 实时多人协作；
- 自定义代码插件、插件市场和未知渲染器；
- 通用行业指标库；
- BYOK、复杂模型路由和强监管行业合规承诺。

## 第一阶段验证指标

- 上传数据到首个 Draft 的中位耗时；
- Draft 到 Approved 的中位耗时；
- 每个 Evidence Block 的平均修改次数；
- 指标口径被 Reviewer 纠正的比例；
- Visual Template 的重复使用率；
- 包含 Snapshot、口径和 TransformPlan 的 Revision 比例；
- 用户重新打开同一 Project 的比例；
- 生成失败按数据、口径、变换、渲染和权限分类的比例。

## 与现有工程文档的关系

当前仓库的工程设计仍可按数据、生成、Artifact、记忆和插件模块推进。`phase3-design.md`、`phase4-design.md` 和 `phase5-design.md` 继续作为工程参考，但它们不构成第一阶段的额外产品承诺。第一阶段的范围、验收和限制以本文件及其产品规格为准。
