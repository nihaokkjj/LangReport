# LangReport Context

LangReport 第一阶段服务“咨询项目报告”：把客户提供的数据和分析问题整理成可追溯、可审核、符合项目视觉规范的图表证据模块。本文档只定义业务语言；产品规则、状态机和技术实现记录在 `docs/` 中。

## Workspace 与项目

**Workspace**：用户、项目、数据、插件和组织级记忆的隔离边界，也是成员协作和资源配额的边界。
_Avoid_: Team、Organization、Account、Tenant

**Member**：属于 Workspace 的用户，以及该用户在 Workspace 中的角色。
_Avoid_: Collaborator、Participant

**Project**：围绕一个长期业务主题组织数据、会话、指标口径、视觉规范和图表产物的工作空间。第一阶段的 Project 默认是一个咨询客户项目。
_Avoid_: Report、Dashboard、Workspace

**Consulting Project**：以客户问题和客户交付物为目标的 Project，包含分析范围、数据证据、审核过程和最终可交付版本。
_Avoid_: Generic Workspace、Analysis Session

**Project Role**：Member 在单个 Project 中拥有的 Editor、Reviewer 或 Viewer 权限。
_Avoid_: Permission、Access Level

**Analysis Brief**：对一次咨询分析的范围约束，至少说明业务问题、目标受众、时间范围、指标要求和期望交付形式。Brief 可以在 Conversation 中逐步澄清，但确认后的内容才是生成依据。
_Avoid_: Prompt、Task、Chat Request

## 数据、口径与生成

**Data Asset**：用户导入到 Project 中的原始文件或表格数据。
_Avoid_: Dataset、Data Source、Upload

**Data Snapshot**：从 Data Asset 解析出的不可变数据版本，是一次 Generation Cycle 实际使用的数据输入。
_Avoid_: Copy、Cache、Current Data

**Metric Definition**：项目确认的指标名称、业务含义、计算口径、单位、时间规则和过滤规则。它描述“指标是什么”，不是一张图表。
_Avoid_: Metric Note、Formula Guess

**Conversation**：用户与系统围绕一个 Project 展开的自然语言交互上下文。
_Avoid_: Chat、Thread、Session

**Generation Cycle**：围绕一个明确 Analysis Brief，从用户意图到一个候选 Evidence Block 的完整生成尝试。一次 Cycle 有明确输入、输出、校验结果和结束原因。
_Avoid_: Infinite Loop、Chat Response

**TransformPlan**：根据 Analysis Brief 和 Metric Definition 形成的结构化数据变换计划，由受限执行者执行；它不改变 Data Snapshot。
_Avoid_: SQL、Script、Query

**Flint Spec**：描述图表语义、字段映射和图表类型，并交给 Flint 渲染层编译的规范。
_Avoid_: Chart Config、Vega Spec

**Chart Artifact**：代表一个可持续管理的图表产物，包含其数据来源、变换、规范、视觉规范和版本关系。
_Avoid_: Image、Graphic、Report

**Chart Revision**：Chart Artifact 的一次不可变版本，保存生成时使用的 Data Snapshot、Metric Definition、TransformPlan、Flint Spec、视觉规范快照、渲染输出和校验结果。
_Avoid_: Edit、Save、Draft Copy

**Evidence Block**：面向咨询交付的最小证据单元，由一个 Chart Revision、一个可读的发现/结论、指标口径和数据来源组成。Evidence Block 可以进入审核，但不等同于完整报告。
_Avoid_: Dashboard、Final Report、Insight Guess

## 记忆与视觉规范

**Conversation Memory**：当前 Conversation 内用于继续对话的临时上下文，不自动成为长期事实。
_Avoid_: Long-term Memory、Project Memory

**Project Memory**：经用户确认后，对单个 Project 持久有效的指标定义、数据口径、业务规则或偏好。
_Avoid_: Project Notes、Chat History

**Workspace Memory**：经授权后，对 Workspace 内多个 Project 共享的组织规范、术语和模板偏好。
_Avoid_: Team Memory、Global Memory

**Memory Candidate**：模型从 Conversation 中提取、等待用户确认是否写入 Project Memory 或 Workspace Memory 的候选事实。
_Avoid_: Auto Memory、Learned Fact

**Theme**：控制图表颜色、字体、布局、标签和视觉层级的可复用视觉规则。
_Avoid_: Style、Skin、Brand Config

**Visual Template**：供咨询项目重复使用的版本化输出规范，包含 Theme 以及图表类型、标题、脚注、单位、注释和导出约束。Theme 是视觉规则，Visual Template 是完整的项目表达规范。
_Avoid_: Color Palette、Template Skin

## 扩展与治理

**Plugin Manifest**：描述图表模板、Theme、字段语义、校验器、示例和可用内置渲染后端的版本化声明式文件。
_Avoid_: Plugin Code、Extension Script

**Review**：针对某个 Evidence Block 或 Chart Revision 的协作审核过程，包含状态、评论、审核人和审核时间。
_Avoid_: Project Approval、Publish

**Generation Job**：承载 Generation Cycle 的可观察执行单元，记录数据画像、计划、变换、规范生成、校验和渲染状态。
_Avoid_: Request、Chat Response
