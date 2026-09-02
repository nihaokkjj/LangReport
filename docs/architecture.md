# LangReport 系统架构

## 1. 目标

LangReport 第一阶段的核心目标，是把咨询顾问的客户数据和 Analysis Brief，可靠地转化成可审核的图表证据模块。完整产品边界见 [phase1-consulting-report.md](./phase1-consulting-report.md)。系统必须同时满足以下要求：

- 数据来源和转换过程可追溯
- 图表规范和渲染结果可复现
- Workspace、Project 和成员权限隔离
- 长短期记忆可控且可审计
- 插件扩展不引入任意服务器端代码执行
- 生成过程可异步执行、可重试、可观察

## 2. MVP 边界

第一阶段支持咨询 Project、Project 内 Conversation、CSV/XLSX/JSON/粘贴表格、Analysis Brief、已确认 Metric Definition、有限 TransformPlan、Line/Bar/Area 主图表、Evidence Block、Visual Template、Chart Revision、Review 和浏览器交互图表/PNG/SVG/HTML 输出。

第一阶段不支持数据库、外部 API、实时数据源、跨文件 Join、Dashboard、实时多人编辑、Workspace 外部公开分享、用户自定义服务器端代码、插件市场、完整 PPT 排版或强监管行业合规承诺。单次 Generation Cycle 只绑定一个 Data Snapshot 和一个 Visual Template 版本，并创建一个主 Evidence Block。

## 3. 系统形态

```text
                         ┌─────────────────────┐
                         │   Web App            │
                         │  对话 / 数据 / 图表   │
                         └──────────┬──────────┘
                                    │ HTTPS
                         ┌──────────▼──────────┐
                         │ API 模块化单体        │
                         │ 鉴权 / 项目 / 数据    │
                         │ 记忆 / 图表 / 协作    │
                         └──────┬─────────┬─────┘
                                │         │
                      ┌─────────▼───┐ ┌──▼────────────┐
                      │ PostgreSQL  │ │ 私有对象存储   │
                      │ 元数据/权限 │ │ 原始文件/产物  │
                      └─────────────┘ └───────────────┘
                                │
                         ┌──────▼────────┐
                         │ Generation Job │
                         │ / Render Job   │
                         └───┬────────┬───┘
                             │        │
                  ┌──────────▼──┐ ┌──▼─────────────┐
                  │ Generation  │ │ Render Worker   │
                  │ Worker      │ │ flint-chart     │
                  │ 模型/变换/校验│ │ Vega-Lite/导出  │
                  └─────────────┘ └────────────────┘
```

初期采用模块化单体 API 加独立 Worker，而不是一开始拆分成大量微服务。模块之间通过明确的领域接口和异步任务交互；当负载或团队规模证明需要时，再拆分部署单元。

## 4. 模块边界

### Workspace Access

负责用户身份、Workspace、Member、Workspace Role、Project Role 和所有租户边界检查。任何 Project、Data Asset、Conversation、Memory、Plugin 或 Chart Artifact 查询都必须携带 Workspace 作用域。

### Project

负责 Project 的创建、归档、主题继承、Project Member、Analysis Brief、Metric Definition、Visual Template 和项目级配置。Project 是长期上下文的拥有者，但不拥有用户身份。

### Data

负责文件上传、格式解析、字段画像、Data Asset 和 Data Snapshot。原始文件进入私有对象存储，解析后的结构化快照进入受控存储。

### Conversation

负责消息、附件引用、当前对话上下文和 Generation Cycle/Generation Job 的创建。Conversation 可以引用 Project 资产；第一阶段单个 Generation Cycle 和 Chart Revision 只绑定一个 Data Snapshot。

### Memory

负责 Conversation Memory、Memory Candidate、Project Memory 和 Workspace Memory。长期记忆写入必须经过确认，并保存来源、创建人、更新时间、置信度和删除状态。

### Generation

负责将 Analysis Brief 和自然语言意图编译为 TransformPlan 和 Flint Spec，调用 Model Gateway，协调数据执行、指标口径、Visual Template 和校验修复。一次 Cycle 最多执行两轮自动修复。

### Chart

负责 Chart Artifact、Chart Revision、Evidence Block、Flint 输入、Vega-Lite 输出、静态导出、版本关系和渲染元数据。

### Collaboration

负责评论、分享、Review 状态和审核审计。第一阶段先做异步协作，不引入实时协同编辑协议。

### Extensions

负责后续阶段 Plugin Manifest 的安装、解析、版本固定、管理员审核、Project 启用和能力发现。第一阶段只使用平台内置 Visual Template；插件执行范围由声明式能力限制。

## 5. 生成流程

1. API 创建 Generation Job，并记录用户原始意图、Project、Conversation、Analysis Brief、Data Snapshot 和 Visual Template 版本。
2. Data Worker 读取指定 Data Asset，生成 Data Snapshot 和字段画像。
3. Generation Worker 将字段摘要、统计信息、脱敏样本、已确认 Metric Definition、相关 Project Memory 和用户意图交给 Model Gateway。
4. 模型生成 TransformPlan；受限执行器执行并记录每一步输入、输出、空值处理和字段血缘。
5. 模型生成 Flint Spec，系统执行结构校验、语义校验、数据字段校验和 Visual Template 规则校验。
6. 校验失败时最多执行两轮受控修复；仍失败则返回可解释的失败结果或请求用户澄清。
7. Render Worker 使用固定版本的 `flint-chart` 编译 Flint Spec，生成 Vega-Lite 规范和浏览器/PNG/SVG/HTML 输出。
8. 系统创建不可变 Chart Revision 和 Evidence Block，保存输入、口径、计划、规范、字段血缘、Visual Template 快照、输出对象地址、校验结果和生成版本。

## 6. Flint 集成边界

核心 SaaS 后端直接使用 `flint-chart`，并将其放在独立 Render Worker 中。LangReport 的 Chart Revision 保存平台包装后的 Flint 输入和对应的原生 Vega-Lite 输出；Flint 负责图表语义到渲染后端的编译，不负责 Workspace、Project、记忆、权限或审核。

第一阶段不依赖远程 Flint MCP 服务。未来可增加 MCP Adapter，让外部 Agent 以同一套 Project 权限和 Chart Artifact 模型调用 LangReport。

## 7. 数据与存储

### PostgreSQL

存储 Workspace、Member、Project、Analysis Brief、Metric Definition、Data Asset 元数据、Data Snapshot 元数据、Conversation、Memory、Visual Template、Generation Job、Chart Artifact、Chart Revision、Evidence Block、Plugin、Review 和审计事件。

### 私有对象存储

存储原始上传文件、标准化快照、Vega-Lite JSON、PNG、SVG 和其他导出产物。对象路径必须包含 Workspace 和 Project 作用域，访问使用短时授权地址或 Worker 的受控凭据。

### 任务队列

初期使用 PostgreSQL-backed Queue 与事务性任务记录，保证业务写入和任务投递的一致性。任务量增长后可以替换为 Redis-backed Queue，但 Generation Job 的业务状态仍由数据库保存。

## 8. 记忆策略

```text
Conversation Memory   当前会话临时上下文
        ↓ 提取候选
Memory Candidate      等待用户确认
        ↓ 确认
Project / Workspace Memory   可检索的长期事实
```

Project Memory 优先于 Workspace Memory；同名指标或规则出现冲突时，系统必须展示冲突来源，不得静默覆盖。每次 Chart Revision 记录实际使用的记忆版本或记忆 ID，保证结果可解释。

## 9. 主题和插件解析

主题解析顺序为：图表临时设置、Project Visual Template 中的 Theme、Workspace Theme、系统默认 Theme。解析后的结果在生成 Chart Revision 时固化为 Visual Template 和 Theme 快照。

Plugin Manifest 只能声明模板、Theme、语义、校验器、示例和平台已允许的渲染后端。安装时进行 Schema 校验、能力校验和哈希固定；启用时再进行 Project 级选择。任何自定义代码执行能力都不属于插件协议；第一阶段不启用用户插件安装。

## 10. 权限原则

- Workspace Owner/Admin 管理成员、Workspace Theme、Workspace Memory、插件和配额。
- Project Editor 管理项目数据、Project Memory、Project Visual Template，并可创建和修改图表版本。
- Project Reviewer 可以评论、提交审核和批准/退回 Chart Revision，但不能修改 Project 设置。
- Project Viewer 只能读取被授权的项目资产和图表。
- 外部分享默认关闭；未来公开链接必须是只读、可过期和可撤销的。

## 11. 可靠性与安全

- 每个 Generation Job 和 Render Job 都必须有幂等键、状态、重试次数和错误分类。
- Approved Chart Revision 不可变；任何修改都产生新 Revision。
- 模型默认只接收字段摘要、统计信息和少量脱敏样本。
- 完整原始数据只通过受控 Worker 权限访问，不直接暴露给浏览器或模型供应商。
- 所有跨模块查询都必须先验证 Workspace 作用域和 Project 权限。
- 记录生成、导出、分享、记忆确认、插件安装和审核事件。

## 12. 建议的仓库结构

```text
apps/
  web/                  # 对话、数据、图表和协作界面
  api/                  # 模块化单体 API
  generation-worker/    # Model Gateway、TransformPlan、校验修复
  render-worker/        # flint-chart、Vega-Lite、PNG/SVG
packages/
  domain/               # 领域对象和不变量
  contracts/            # API、任务和 Plugin Manifest Schema
  data-engine/          # 受限 TransformPlan 执行器
  flint-adapter/        # LangReport 与 flint-chart 的适配边界
  plugin-sdk/           # 声明式插件校验与能力解析
infra/                  # 数据库、对象存储和部署配置
docs/
  adr/
```
