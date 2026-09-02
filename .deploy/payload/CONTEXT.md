# LangReport Context

LangReport 帮助非专业 BI 用户把数据和自然语言意图转化为可复现的图表产物。本文档定义项目中的业务语言；实现细节和技术选择记录在 `docs/` 中。

## Workspace 与项目

**Workspace**：用户、项目、数据、插件和团队级记忆的隔离边界，也是团队协作和配额管理的边界。
_Avoid_: Team、Organization、Account、Tenant

**Member**：属于 Workspace 的用户，以及该用户在 Workspace 中的角色。
_Avoid_: Collaborator、Participant

**Project**：围绕一个业务主题组织数据、会话、记忆、主题和图表产物的长期工作空间。
_Avoid_: Report、Dashboard、Workspace

**Project Role**：Member 在单个 Project 中拥有的 Editor、Reviewer 或 Viewer 权限。
_Avoid_: Permission、Access Level

## 数据与生成

**Data Asset**：用户导入到 Project 中的原始文件或表格数据。
_Avoid_: Dataset、Data Source、Upload

**Data Snapshot**：从 Data Asset 解析出的不可变数据版本，是一次图表生成实际使用的数据输入。
_Avoid_: Copy、Cache、Current Data

**Conversation**：用户与系统围绕一个 Project 展开的自然语言交互上下文。
_Avoid_: Chat、Thread、Session

**TransformPlan**：模型根据用户意图生成的结构化数据变换计划，由受限执行器执行，而不是由模型直接修改数据。
_Avoid_: SQL、Script、Query

**Flint Spec**：描述图表语义、字段映射和图表类型，并交给 Flint 渲染层编译的规范。
_Avoid_: Chart Config、Vega Spec

**Chart Artifact**：代表一个可持续管理的图表产物，包含其数据来源、变换、规范、主题和版本关系。
_Avoid_: Image、Graphic、Report

**Chart Revision**：Chart Artifact 的一次不可变版本，保存生成时使用的 Data Snapshot、TransformPlan、Flint Spec、主题快照、渲染输出和校验结果。
_Avoid_: Edit、Save、Draft Copy

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

## 扩展与治理

**Plugin Manifest**：描述图表模板、Theme、字段语义、校验器、示例和可用内置渲染后端的版本化声明式文件。
_Avoid_: Plugin Code、Extension Script

**Review**：针对某个 Chart Revision 的协作审核过程，包含状态、评论、审核人和审核时间。
_Avoid_: Project Approval、Publish

**Generation Job**：从用户意图开始，经过数据画像、计划生成、变换、规范生成、校验和渲染的异步任务。
_Avoid_: Request、Chat Response
