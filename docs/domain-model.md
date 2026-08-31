# LangReport 领域模型

## 1. 聚合和所有权

### Workspace

Workspace 是多租户隔离边界，拥有 Member、Project、Workspace Memory、Workspace Theme、Plugin 和使用配额。

### Project

Project 属于一个 Workspace，拥有 Data Asset、Conversation、Project Memory、Project Theme、Chart Artifact 和 Project Role。

### Data Asset

Data Asset 属于一个 Project，代表用户导入的逻辑数据资源。每次重新上传或重新解析都生成新的 Data Snapshot；历史 Snapshot 不被覆盖。

### Conversation

Conversation 属于一个 Project，保存用户意图、消息、附件引用和 Generation Job 引用。Conversation Memory 只对当前 Conversation 有效。

### Chart Artifact

Chart Artifact 属于一个 Project，是图表的稳定身份；它通过 Chart Revision 保存每次生成或编辑后的不可变状态。

### Memory

Memory Candidate 来自 Conversation，确认后转化为 Project Memory 或 Workspace Memory。长期 Memory 必须可以追溯到来源 Conversation 或用户明确输入。

### Plugin

Plugin 属于 Workspace 的安装范围，具体是否生效由 Project 选择。插件能力由固定版本的 Plugin Manifest 决定。

## 2. 关系

```text
Workspace 1 ── * Member
Workspace 1 ── * Project
Workspace 1 ── * Workspace Memory
Workspace 1 ── * Plugin Installation

Project 1 ── * Data Asset
Data Asset 1 ── * Data Snapshot
Project 1 ── * Conversation
Project 1 ── * Project Memory
Project 1 ── * Chart Artifact
Chart Artifact 1 ── * Chart Revision
Chart Revision 1 ── 1 Data Snapshot
Chart Revision 1 ── 1 TransformPlan
Chart Revision 1 ── 1 Flint Spec
Chart Revision 1 ── * Review Comment
```

## 3. 不变量

1. 所有持久化业务对象必须能解析到唯一 Workspace。
2. Project 不能跨 Workspace 移动；Project 内的资产不能被其他 Workspace 直接引用。
3. Chart Revision 必须引用一个明确的 Data Snapshot，不能引用“当前数据”。
4. Chart Revision 保存完整 TransformPlan、Flint Spec、主题快照和输出版本。
5. Chart Revision 一旦 Approved 就不可修改；修改只能创建新的 Revision。
6. TransformPlan 由受限执行器执行，模型不能直接写入或修改 Data Snapshot。
7. Memory Candidate 未确认前不能参与长期记忆检索。
8. Workspace Memory 不能被 Project 成员静默修改；Project Memory 不能自动升级为 Workspace Memory。
9. Plugin 必须以固定版本安装和启用；Project 不能依赖未解析版本的插件能力。
10. 用户可见的“生成成功”必须意味着 Flint Spec 和输出产物通过必要校验。

## 4. 状态机

### Data Asset

```text
Uploaded → Processing → Ready
                    └→ Failed
Ready → Archived → Deleted
```

### Generation Job

```text
Queued → Profiling → Planning → Transforming → Compiling
                                      ↓              ↓
                                  Failed         Rendering
                                                     ↓
                                                 Validating
                                              ┌──────┴──────┐
                                           Succeeded      Failed
```

修复循环只能发生在 Validating 之后，最多两次；每次修复都必须保留模型输出和校验错误。

### Chart Revision

```text
Draft → In Review → Approved
   │         └──────→ Changes Requested
   └──────────────────────────────→ Archived
```

### Memory Candidate

```text
Proposed → Accepted → Active
     └──────────────→ Rejected
Active → Superseded / Deleted
```

## 5. 关键领域事件

- `DataSnapshotReady`
- `GenerationJobRequested`
- `TransformPlanExecuted`
- `ChartRevisionGenerated`
- `ChartRevisionSubmittedForReview`
- `ChartRevisionApproved`
- `ChartRevisionChangesRequested`
- `MemoryCandidateProposed`
- `MemoryCandidateAccepted`
- `PluginInstalled`
- `PluginEnabledForProject`

事件用于审计、异步任务和通知；它们不是把整个系统改造成事件溯源系统的理由。当前写模型以 PostgreSQL 为准。

## 6. 角色能力矩阵

| 能力 | Workspace Owner/Admin | Project Editor | Project Reviewer | Project Viewer |
| --- | --- | --- | --- | --- |
| 管理 Workspace 成员 | 是 | 否 | 否 | 否 |
| 创建/归档 Project | 是 | 按 Workspace 策略 | 否 | 否 |
| 上传和管理数据 | 是 | 是 | 否 | 否 |
| 生成和编辑图表 | 是 | 是 | 否 | 否 |
| 管理 Project Memory/Theme | 是 | 是 | 否 | 否 |
| 提出评论 | 是 | 是 | 是 | 可选 |
| 审核 Chart Revision | 是 | 否 | 是 | 否 |
| 管理插件 | 是 | 否 | 否 | 否 |
| 查看项目图表 | 是 | 是 | 是 | 是 |

## 7. 典型用例

### 从 CSV 生成同比图表

1. Member 将销售 CSV 创建为 Data Asset。
2. 系统解析列名、类型、缺失值、基数和时间粒度，生成 Data Snapshot。
3. 用户在 Conversation 中提出“按月份展示各区域销售额和同比变化”。
4. Generation Job 检索已确认的指标口径，生成 TransformPlan。
5. 受限执行器聚合数据、计算同比并记录字段血缘。
6. 系统生成 Flint Spec，选择 Project Theme，校验并调用 Render Worker。
7. 系统创建 Draft Chart Revision，用户可以预览、评论或提交审核。
8. Reviewer 批准后，Revision 锁定；用户导出 PNG/SVG。

### 记忆候选冲突

如果模型提出“收入按含税金额计算”，但 Project Memory 已记录“收入按不含税金额计算”，系统必须展示冲突并停止自动写入。用户选择的结果才可以进入后续生成上下文。
