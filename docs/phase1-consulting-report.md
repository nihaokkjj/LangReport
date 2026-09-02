# 第一阶段产品规格：咨询项目报告

> 状态：当前产品优先级基线
>
> 目标：用一条可验收的垂直闭环验证“可追溯的 AI 图表证据”是否能为咨询团队节省报告制作和审核时间。

## 1. 产品承诺

LangReport 第一阶段不是通用 BI，也不是自动替代顾问的报告生成器。它是咨询项目中的数据证据工作台：

> 顾问提供客户数据、业务问题和判断；LangReport 负责生成可复现的图表证据，保留指标口径、数据来源、转换过程、视觉规范和修改记录；顾问或 Reviewer 负责确认结果。

第一阶段的最小可交付物是一个 `Evidence Block`，而不是完整的多页报告。Evidence Block 包含：

1. 一个主 `Chart Revision`；
2. 一段可编辑的发现或结论；
3. 使用的 `Metric Definition`；
4. 数据来源和 `Data Snapshot`；
5. 关键转换和字段血缘；
6. 当前审核状态。

## 2. 目标用户和首个场景

### 目标用户

- 咨询顾问：需要把客户数据快速整理成报告中的证据页；
- 研究分析师：需要反复验证指标、图表和结论；
- 项目 Reviewer：需要检查口径、来源、版本和结论是否可信。

### 首个场景

使用一个客户销售 CSV，生成如下证据模块：

> “按月份展示各区域销售额、同比变化和异常区域，并说明计算口径与数据限制。”

这个场景必须覆盖数据上传、字段画像、指标澄清、自然语言生成、可编辑图表、项目视觉规范、版本修订和审核导出。

### 用户不在第一阶段解决的问题

- 多数据源实时同步；
- 企业级语义层替代；
- 自动完成整份咨询报告；
- 自动写出无需人工确认的客户结论；
- 实时多人同时编辑一张图；
- 任意 Python/JavaScript 插件执行。

## 3. 第一阶段范围

### 必须做

| 能力 | 第一阶段要求 |
| --- | --- |
| Project | 创建、列表、切换、归档一个咨询项目；保存项目名称、客户代号、描述和当前 Visual Template |
| Conversation | Project 内创建、继续和切换 Conversation；消息和生成结果可持久化 |
| 数据 | 上传 CSV/XLSX/JSON 或粘贴表格；生成不可变 Data Snapshot；显示字段类型、缺失值、基数和时间粒度 |
| Analysis Brief | 记录业务问题、受众、期间、输出要求和已确认约束；不明确时要求澄清 |
| Metric Definition | 保存指标名称、含义、公式、单位、过滤和时间规则；区分用户确认和模型推断 |
| 生成 | 一个 Generation Cycle 生成一个主 Chart Artifact 和一个 Evidence Block |
| 变换 | 支持字段选择/重命名、类型转换、过滤、分组聚合、排序、同比/环比、比率和差值 |
| 图表 | 第一阶段支持 Line、Bar、Area；图表字段、标题、排序、筛选和注释可编辑 |
| 可追溯 | 每个结果关联 Data Snapshot、Metric Definition、TransformPlan、字段血缘、Flint Spec、Visual Template 版本和校验结果 |
| 项目规范 | 提供内置模板；项目可复制模板并修改允许的视觉令牌，保存为版本 |
| 审核 | Draft、In Review、Approved、Changes Requested；Approved 内容不可变 |
| 输出 | 浏览器交互预览、PNG、SVG、HTML；下载固定 Revision |

### 明确不做

以下内容即使在代码中已有接口或基础类型，也不属于第一阶段验收：

- 数据库、外部 API、实时刷新和跨文件 Join；
- Dashboard、图表之间的联动和完整在线报告排版；
- PPT 自动排版和 Excel 回写；
- Workspace 外部公开分享；
- 实时协作、光标同步和冲突合并；
- 任意服务器端 SQL、Python、JavaScript 或用户代码；
- 用户上传插件和插件市场；
- 自动把模型猜测写入 Project Memory 或 Workspace Memory；
- 自动批准图表或自动发布客户结论；
- 为所有行业提供通用指标语义。

## 4. 第一阶段用户流程

### 4.1 启动 Project

用户创建 Project 时必须提供：

- 项目名称；
- 客户代号或客户名称；
- 项目目标描述；
- 默认受众：内部分析、客户汇报或管理层；
- 一个 Visual Template。

项目创建后，系统展示四个固定入口：`Brief`、`Data`、`Conversation`、`Evidence`。用户可以从任意入口继续，但生成前必须能够定位到 Analysis Brief 和 Data Snapshot。

### 4.2 数据准备

1. 用户上传文件或粘贴表格。
2. 系统校验文件格式、大小、行数和列名。
3. 系统生成 Data Asset 和 Data Snapshot。
4. 系统显示字段画像：字段名、推断类型、缺失率、唯一值数量、示例值、最小/最大值和时间粒度。
5. 用户确认关键字段或修正字段语义。

重新上传同一个 Data Asset 会产生新的 Snapshot。旧 Snapshot 保持可读取，历史 Chart Revision 不受影响。

### 4.3 对话生成

用户可以直接提问，但系统在生成前要确认最小 Brief：

- 想回答什么业务问题；
- 使用哪个指标；
- 时间范围和粒度；
- 需要比较、分组或筛选什么维度；
- 图表受众和输出形式。

如果问题可以安全解释，系统可以自动填充 Brief，并把推断内容标成“待确认”。如果存在指标歧义、字段缺失、时间范围不明或数据质量风险，系统先提出澄清问题，不生成 Approved 结果。

### 4.4 生成 Evidence Block

生成成功后，界面必须同时展示：

- 图表预览；
- 发现/结论文本；
- 使用的数据 Snapshot；
- 指标定义和公式；
- TransformPlan 的人类可读摘要；
- 字段血缘；
- 数据质量警告；
- Visual Template 名称和版本；
- 当前 Revision 和校验状态。

用户可以修改图表和结论，但任何修改都创建新的 Chart Revision。

### 4.5 审核和导出

1. Editor 将 Draft 提交为 In Review。
2. Reviewer 检查图表、口径、数据来源、结论和警告。
3. Reviewer 可以批准或要求修改，并必须能够留下评论。
4. Approved Revision 锁定。
5. 导出只能针对固定 Revision，导出记录保存操作者、时间和 Revision ID。

## 5. 生成 Loop 约束

第一阶段把一次用户请求视为一个有限的 `Generation Cycle`，采用以下循环：

```text
Brief ready
  → Profile
  → Plan
  → Transform
  → Compile
  → Validate
  → Render
  → Draft Evidence Block
  → User edit / Review
```

### 单次 Cycle 的限制

1. 一次 Cycle 只使用一个 Data Snapshot。
2. 一次 Cycle 只生成一个主 Chart Artifact 和一个 Evidence Block。
3. 一次 Cycle 只允许使用已确认的 Metric Definition；推断口径必须显式标注。
4. TransformPlan 只能使用平台允许的变换操作。
5. Validate 失败后最多自动修复两轮；每轮都保留错误和修复前后的模型输出。
6. 两轮修复仍失败时，Cycle 进入需要用户澄清或失败状态，系统不伪造成功结果。
7. 生成、编辑、回滚和复制都产生新的 Chart Revision。
8. 系统不会因为生成成功而自动批准、发布、写入长期记忆或改变项目模板。

### 支持的 TransformPlan 操作

第一阶段只允许以下语义操作：

- `select_fields`
- `rename_fields`
- `cast_type`
- `filter_rows`
- `group_aggregate`
- `sort_rows`
- `calculate_ratio`
- `calculate_delta`
- `calculate_yoy`
- `calculate_mom`
- `limit_top_n`

每个操作都必须声明输入字段、输出字段、空值处理和排序/时间规则。操作需要产生字段血缘；不支持模型直接修改原始数据。

### 数据边界

- 单文件硬上限：50 MB；
- 单 Snapshot 硬上限：1,000,000 行；
- 一个 Cycle 只允许一个输入文件或一份粘贴表格；
- 首次生成目标：100,000 行以内、20 MB 以内；
- 时间字段必须能够识别时间粒度，无法识别时要求用户确认；
- 不把缺失月份静默补成零；
- 不把重复记录静默去重；
- 不把空值、异常值和截断结果隐藏在结论中。

## 6. 图表编辑器边界

### 可编辑字段

第一阶段编辑器必须支持：

- 图表类型：Line / Bar / Area；
- X/Y/系列字段；
- 聚合方式；
- 筛选条件；
- 排序方式；
- 标题、副标题、脚注和单位；
- 标签、图例和注释开关；
- 允许范围内的颜色、字体和布局令牌。

### 编辑行为

- 只改变视觉属性的编辑仍产生新 Revision，但可以复用同一个 Data Snapshot 和 TransformPlan；
- 改变字段、聚合、筛选或计算的编辑必须重新执行 TransformPlan 并重新校验；
- 编辑器显示“此次修改是否改变数据逻辑”；
- Approved Revision 进入只读模式；
- 回滚使用目标 Revision 创建新的 Draft，不移动历史指针覆盖历史含义；
- 图表编辑器不允许直接编辑 Vega-Lite JSON 作为第一阶段用户入口。

## 7. Visual Template 规范

第一阶段把“风格模板”定义为项目输出规范，而不是一组颜色。

### 内置模板

第一阶段提供三个可区分的内置模板：

- `consulting-neutral`：正式、克制、适合客户报告；
- `consulting-insight`：强调重点数字、异常和结论；
- `consulting-research`：强调来源、脚注、样本和不确定性。

### 模板内容

模板至少声明：

- 颜色令牌和对比度要求；
- 字体层级；
- 图表尺寸和导出尺寸；
- 标题、副标题、脚注和来源格式；
- 数值单位和小数位规则；
- 推荐图表类型；
- 允许的注释和强调方式；
- 必须显示的数据更新时间和口径提示。

### 自定义模板

用户只能基于内置模板复制创建 Project Visual Template，并修改平台允许的令牌。新模板必须：

1. 有名称和用途说明；
2. 固定父模板和版本；
3. 通过颜色对比度、必填字段和图表兼容性校验；
4. 经用户显式保存后才成为 Project 的 Active Template；
5. 生成 Revision 时固化完整模板快照。

第一阶段不支持上传任意 CSS、JavaScript、Vega-Lite 代码或服务器端渲染器。

## 8. 记忆规则

### 允许形成 Project Memory 的内容

- 客户已确认的指标口径；
- 项目专用术语；
- 项目时间规则；
- 客户报告的视觉规范；
- 用户明确要求保留的分析偏好。

### 写入流程

```text
Conversation
  → Memory Candidate
  → 用户确认 / 拒绝
  → Project Memory
  → 后续 Generation Cycle 检索
```

以下内容必须保持在 Conversation Memory 或候选状态：

- 模型推测的业务含义；
- 尚未确认的字段映射；
- 仅适用于一次问题的临时筛选；
- 没有来源的结论；
- 与已有 Metric Definition 冲突的新口径。

Project Memory 优先于 Workspace Memory；冲突必须展示来源并要求用户选择。Memory Candidate 不参与长期检索。

## 9. 审核和质量门槛

### 图表生成成功条件

只有同时满足以下条件，Generation Cycle 才能生成 Draft Evidence Block：

- 所有引用字段存在于 Data Snapshot；
- TransformPlan 通过 Schema 和执行校验；
- 计算字段具有字段血缘；
- Metric Definition 已确认或明确标记为待确认；
- Flint Spec 通过结构和语义校验；
- 渲染输出成功；
- 数据质量警告已保存并可见；
- Visual Template 已解析并保存版本；
- 结果能定位到唯一的输入和生成版本。

### Approved 条件

Reviewer 只能在以下内容都可见时批准：

- 图表与用户问题一致；
- 指标口径与项目记录一致；
- 数据来源和更新时间明确；
- 重要数据质量风险已经处理或被接受；
- 结论没有超出图表证据；
- 图表符合当前 Visual Template；
- 未解决的阻塞性评论为零。

## 10. 第一阶段验收标准

使用“区域销售月度同比”示例数据完成以下验收：

1. 用户可以创建、重开和切换咨询 Project。
2. 用户可以上传 CSV，并看到字段画像和数据质量提示。
3. 用户可以在 Project 内创建和继续 Conversation。
4. 用户可以确认“销售额”和“同比”的指标口径。
5. 系统可以生成一个主图表和一个 Evidence Block。
6. 用户可以修改图表类型、字段、筛选、标题和主题令牌。
7. 逻辑修改会重新执行并生成新 Revision；视觉修改也会留下 Revision。
8. 每个 Revision 都能查看 Snapshot、Metric Definition、TransformPlan、字段血缘、Flint Spec、模板版本和校验结果。
9. Reviewer 可以评论、要求修改和批准；Approved Revision 不可修改。
10. PNG、SVG、HTML 导出都指向固定 Revision。
11. 失败的生成显示原因和下一步操作，不显示成功图表。
12. 刷新页面或重新登录后，Project、Conversation、Data Asset、Evidence Block 和 Revision 仍然存在。

## 11. 发布前指标

第一阶段发布前，至少记录以下产品指标：

- 从上传数据到产生首个 Draft 的耗时；
- 从 Draft 到 Approved 的耗时；
- 每个 Evidence Block 的平均修改次数；
- 首次生成的指标口径纠正率；
- Visual Template 的重复使用率；
- 带完整数据来源和口径信息的 Revision 比例；
- 用户重新打开同一 Project 的比例；
- 生成失败按数据、口径、变换、渲染和权限分类的数量。

## 12. 与工程阶段的关系

本文件定义的是产品第一阶段，不再沿用旧文档中“Phase 1 只做上传、Phase 2 才做生成、Phase 3 才做协作”的产品优先级拆分。工程实现可以继续分为数据、生成、Artifact、记忆和插件等里程碑，但所有里程碑都必须服务本文件的咨询项目闭环。

现有 `phase3-design.md`、`phase4-design.md` 和 `phase5-design.md` 是工程设计和历史实施参考；第一阶段只启用其中满足本文件范围的能力。
