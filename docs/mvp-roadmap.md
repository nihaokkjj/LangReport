# LangReport MVP 路线

## MVP 目标

完成一条可信的垂直闭环：

> 用户上传销售 CSV，用中文描述“按月份展示各区域销售额和同比变化”，系统识别字段、生成 TransformPlan、执行数据变换、调用 Flint 生成可编辑图表，用户选择项目 Theme，导出 PNG/SVG，并提交审核。

## Phase 0：工程底座

### 交付

- TypeScript monorepo 和基础 CI
- Web App、API、Generation Worker、Render Worker 的运行骨架
- PostgreSQL 迁移和 Workspace 作用域
- 私有对象存储接口
- Generation Job 持久化和任务状态
- Model Gateway、Flint Adapter、Data Engine 的接口

### 验收

- 可以创建 Workspace、Project 和成员
- 所有核心查询都有 Workspace/Project 作用域
- 失败任务可以重试，重复请求不会创建重复 Job

## Phase 1：数据输入和字段画像

### 交付

- CSV、XLSX、JSON 上传
- 粘贴表格输入
- 文件格式和大小校验
- Data Asset 和 Data Snapshot
- 字段类型、缺失值、基数、时间粒度和统计摘要
- 数据预览和错误提示

### 验收min

- 单文件不超过 50 MB、100 万行
- 原始文件和快照可按 Project 查找和删除
- 同一个 Data Asset 的重新上传不会改变旧 Snapshot

## Phase 2：生成和渲染垂直切片

### 交付

- Conversation 和自然语言意图
- TransformPlan Schema
- 受限 TransformPlan 执行器
- 字段血缘记录
- Flint Spec 生成
- Flint Spec、语义、数据字段和视觉校验
- 最多两轮自动修复
- `flint-chart` Render Worker
- Vega-Lite 交互预览
- PNG/SVG 导出

### 验收

- 示例销售 CSV 可以完成端到端生成
- 生成结果能回溯到 Data Snapshot、TransformPlan 和 Flint Spec
- 校验失败时不会被标记为成功
- 重新使用相同输入、计划、主题和版本可以重建结果

## Phase 3：Chart Artifact 和异步协作

### 交付

- Chart Artifact 和不可变 Chart Revision
- Draft、In Review、Approved、Changes Requested、Archived
- Revision 对比、回滚和复制
- Project Editor、Reviewer、Viewer
- 评论、审核和审计事件
- Workspace 内只读分享
- 项目 Theme 和主题快照

### 验收

- Approved Revision 不可修改
- 每次修改都产生新 Revision
- Viewer 不能上传数据、修改图表或审核
- 历史 Revision 不受当前主题和当前数据影响

## Phase 4：三层记忆

### 交付

- Conversation Memory
- Memory Candidate 提取
- Project Memory 和 Workspace Memory
- 用户确认、拒绝、删除和审计
- 来源、创建人、更新时间、置信度
- 冲突提示和作用域优先级

### 验收

- 未确认候选不会参与长期记忆检索
- Project Memory 不会自动升级为 Workspace Memory
- 冲突记忆会展示来源，不会静默覆盖

## Phase 5：声明式插件

### 交付

- Plugin Manifest Schema
- 内置插件目录
- 管理员上传和安装
- 版本、哈希和兼容性检查
- Project 启用/禁用
- 模板、Theme、语义和 Validator 能力发现
- 插件冲突检测

### 验收

- 未知字段或可执行代码会被拒绝
- Project 使用精确插件版本
- 插件删除不会破坏已有 Chart Revision

## 后续版本

- Flint MCP Adapter
- ECharts、Plotly、Excel 等后端
- Dashboard/多图报告
- 数据库、API 和实时连接器
- 外部只读分享链接
- Workspace BYOK 和模型策略
- 受控实时协作
- 更强的数据脱敏和行业合规能力

## 初始工程指标

以下指标作为实现起点，后续根据真实用户行为调整：

- 数据上传失败必须可解释
- Job 状态变化必须可查询
- 生成链路每一步都有结构化日志
- 失败任务不能产生“成功”图表
- 产物、数据、规范和版本之间可以通过 ID 追踪
- 所有跨 Workspace 访问测试必须覆盖越权场景
