# 工作区与双 Agent 协作治理：Design

- 变更编号：CHG-2026-09-21-workspace-agent-governance
- 状态：ACCEPTED
- 创建时间：2026-09-21
- 更新时间：2026-09-21

> 范围调整：最终宿主目录布局保留 LangReport 原名；本文中早期出现的
> langreport 仅记录原始方案，不再构成实施要求。

## 现状与约束

- D:\front\newProject 不是 Git 工作树；deer-flow 与 LangReport 是两个独立 Git 工作树。
- 两个工作树各自只有一个已列出的 worktree；两者均不存在 .gitmodules 文件。
- LangReport 当前有用户在途修改，包含 API route registration、API Console、合同、架构文档和两个被删除的 Web 局部 Agent 指引文件；本变更不接管这些内容。
- DeerFlow 当前有未追踪的 .codegraph 目录；本变更不判断其是否应保留或删除。
- LangReport 的产品事实、架构事实、长期决策与单项变更记录已有明确入口：CONTEXT.md、docs/project-spec.md、docs/adr/ 和 docs/changes/。
- LangReport/config.fixed.toml 发现一个旧的绝对项目路径 D:\front\LangReport。其所有者和生效性尚未确认。

## 设计目标与非目标

### 目标

1. 建立单一、可追溯的跨仓库协作控制面。
2. 让 DeerFlow 研究成为有证据的输入，而不是 LangReport 的隐式架构模板。
3. 保留 LangReport 现有 ADR/SDD 作为产品事实来源。
4. 使物理目录迁移可暂停、可验证、可回滚。

### 非目标

- 不为两个仓库建立统一 monorepo、共享依赖或统一 Git 历史。
- 不强制 DeerFlow 的开发规范覆盖 LangReport。
- 不创建后台自动派发、自动批准或自动合并机制。
- 不以目录改名为借口变更产品名、包名、Docker 服务名、数据库名或对外合同。

## 方案选型

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 继续在当前两个目录直接协作，不建控制面 | 零迁移成本 | 决策、研究和任务状态分散在聊天中 | 不采用 |
| 将 DeerFlow 与 LangReport 合并为一个 Git monorepo | 单一顶层结构 | 会污染独立历史、远端和发布边界 | 不采用 |
| 保持两个 Git 仓库，加独立 agent-tasks 控制面 | 边界清晰，可版本化研究与任务状态 | 需要避免文档重复 | 采用 |
| 将 agent-tasks 全部放进 LangReport docs | 无第三个仓库 | DeerFlow 研究与工作区规则被错误视为产品实现事实 | 不采用 |

## 模块边界

最终目录结构固定在 D:\front\newProject：

    D:\front\newProject/
    ├── AGENTS.md
    ├── deerflow/
    │   ├── AGENTS.md
    │   └── ...
    ├── langreport/
    │   ├── AGENTS.md
    │   ├── docs/
    │   └── ...
    └── agent-tasks/
        ├── AGENTS.md
        ├── current-task.md
        ├── decisions.md
        ├── research/
        └── archive/

### 根 AGENTS.md

只定义跨仓库导航和写入边界：

- deerflow 为参考仓库，研究 Agent 不修改其内容；
- langreport 为产品仓库，只有 owner Agent 可修改产品代码和产品文档；
- agent-tasks 为协作控制面；
- 开始任何任务先读取 current-task.md、目标仓库 AGENTS.md 和相应的变更记录；
- 不允许两个 Agent 并发编辑同一文件。

它不复制任一子仓库的产品术语、构建命令或架构事实。

### deerflow

保留为独立 Git 仓库和只读研究对象。目录从 deer-flow 改名为 deerflow 只改变宿主目录名；项目内 deer-flow 品牌、服务名、配置键、测试夹具和 Git remote 不做全局替换。

### langreport

保留为独立 Git 仓库和唯一产品实现边界。目录名不改变 LangReport、@langreport、数据库、Docker 服务或 API 合同。现有 docs/adr 与 docs/changes 继续是技术决策和实现证据的权威来源。

### agent-tasks

建议初始化为第三个、小型 Git 仓库，因为父目录本身不受 Git 追踪。其职责如下：

| 文件或目录 | 唯一职责 | 不承担的职责 |
| --- | --- | --- |
| current-task.md | 当前唯一任务、状态、owner、研究问题、下一步和用户决策 | 任务历史、完整技术设计 |
| decisions.md | 已批准 ADR / 方案的索引及链接 | ADR 正文或实现细节 |
| research/ | DeerFlow 或外部研究的带证据报告 | LangReport 代码或验收记录 |
| archive/ | 已关闭任务的索引与里程碑复盘 | 当前任务状态 |

## 数据模型与状态流转

这是协作控制状态，不是 LangReport 产品数据模型。

    IDLE
      → RESEARCHING
      → PROPOSED
      → USER_REVIEW
      → APPROVED
      → IMPLEMENTING
      → VERIFYING
      → ACCEPTED
      → ARCHIVED

- current-task.md 同一时刻只能指向一个非终态任务。
- DeerFlow research agent 只能将状态推进到 PROPOSED。
- 只有用户可以将一个 L/XL 方案从 USER_REVIEW 变为 APPROVED。
- LangReport owner 负责 IMPLEMENTING、VERIFYING、ACCEPTED 和 ARCHIVED 的文档同步。
- 任何范围变化都回到 PROPOSED / USER_REVIEW，不在实现期间静默扩张。

## API / 外部契约

本变更不修改 LangReport HTTP、数据库、模型、Worker、插件或 UI 契约。

Agent 之间使用以下最小研究报告合同：

    Research question:
    DeerFlow evidence: commit + file paths + relevant symbols
    Original problem and mechanism:
    LangReport mapping:
    Phase 1 compatibility and non-goals:
    Costs / risks / migration boundary:
    Recommendation: adopt | adapt | reject
    Required proof if adopted:

LangReport owner 必须独立核对引用；研究报告不是架构批准，也不能替代 proposal、design、task 或 ADR。

## 架构图

    User
      │ approves L/XL decisions
      ▼
    current-task.md ────────► LangReport proposal/design/ADR
      │                              │
      │ research question             │ implemented evidence
      ▼                              ▼
    DeerFlow research agent      LangReport owner agent
      │ read-only                    │ sole product writer
      └──── research/<task>.md ──────┘

## 数据流

1. LangReport owner 在 current-task.md 登记一个有界问题。
2. DeerFlow research agent 对指定问题进行只读研究，并写入或返回 research 报告。
3. LangReport owner 以本地代码事实和研究证据形成设计；不直接搬运参考实现。
4. 用户审核设计和取舍。
5. owner 在 LangReport docs/changes 与 docs/adr 中完成实现、验证和交接。
6. current-task.md 更新为下一步或归档；decisions.md 仅追加 ADR 索引。

## 权限、校验与异常处理

| 角色 | 可写范围 | 禁止范围 |
| --- | --- | --- |
| DeerFlow research agent | agent-tasks/research/<task-id>-deerflow.md | deerflow、langreport、current-task.md、decisions.md |
| LangReport owner agent | langreport、current-task.md、decisions.md、必要的任务归档 | deerflow 源码与配置 |
| 临时验证 Agent（L/XL） | 隔离 worktree 中的测试文件或 test-report.md | 业务源码、需求边界、ADR 决策 |
| 用户 | 批准产品和架构取舍，授权移动/提交/推送 | 不适用 |

Codex Agent 共享宿主文件系统；上述权限是协作协议。若未来需要硬隔离，使用独立 Git worktree 或独立的受限执行环境，而不是假定子 Agent 天然隔离。

发生以下情况时立即停止物理迁移并回到 USER_REVIEW：

- 目标父目录或最终名称未确认；
- 任一仓库的 HEAD、工作树或未跟踪文件未完成基线记录；
- 有运行中的开发服务器、Docker 绑定或编辑器进程占用目标目录；
- 发现生效的绝对路径、Git worktree、junction/symlink、子模块或外部工具配置没有迁移方案；
- 迁移后 Git 状态与基线不一致。

## 迁移、兼容与回滚

### 已知前置事实

| 项目 | 当前事实 | 处理 |
| --- | --- | --- |
| 父目录 | D:\front\newProject 不是 Git 工作树 | 在此目录内创建独立的 agent-tasks Git 仓库 |
| DeerFlow | 独立 Git 工作树；有未追踪 .codegraph | 用户允许放弃；先写入 Git stash 以保留恢复入口 |
| LangReport | 独立 Git 工作树；存在在途修改 | 用户允许放弃；先写入 Git stash 以保留恢复入口 |
| 子模块 | 两仓库均未发现 .gitmodules 文件 | 迁移前仍执行 Git 元数据预检 |
| 绝对路径 | LangReport/config.fixed.toml 含旧路径 D:\front\LangReport | 先确认生效性和所有者，再决定是否更新 |

### 安全移动清单

#### 0. 已批准决策

- 父目录保留 D:\front\newProject。
- 子目录命名为 deerflow、langreport 和 agent-tasks；agent-tasks 为独立 Git 仓库。
- 用户允许放弃现有在途修改；实现使用 Git stash 作为非破坏性的恢复入口，不自动删除 stash。

#### 1. 迁移前预检

- 关闭以两个工作树为 cwd 的终端、开发服务器、测试 watcher 和 Docker compose 服务。
- 对每个仓库记录绝对路径、HEAD、分支、remote 名称、worktree 列表、git status --short、未追踪文件清单、git diff --check 结果。
- 扫描 .gitmodules、git worktree list、core.worktree、hook 路径、junction/symlink、Docker bind mount、.env、IDE/Codex 配置和绝对路径。
- 在原路径运行 LangReport 的 docs:check，并记录 typecheck/test 的基线结果或既有失败；迁移后只要求“不比基线更差”。
- 创建用户批准的、可恢复的未提交修改备份，并验证备份可读取。

#### 2. 受控移动

- 在既有父目录下创建空的 agent-tasks，不改两个仓库内容。
- 一次只移动一个完整仓库目录；移动其 .git、隐藏文件和未追踪文件，不单独移动 .git。
- LangReport 到 langreport 是 Windows 上的仅大小写改名，先经过唯一的临时目录名再改为 langreport，以避免大小写不敏感文件系统把改名视为 no-op。
- 每移动一次，立即在新路径运行 Git 身份和状态检查，再移动下一个仓库。
- 只更新预检中确认会生效的外部路径；不批量替换项目标识符。

#### 3. 迁移后验证

- 比较迁移前后的 HEAD、分支、remote、worktree 和工作树清单。
- 确认 LangReport 未跟踪/修改/删除文件与基线一致，外加本变更明确新增文件。
- 在新路径运行 LangReport docs:check，并与迁移前的 typecheck/test 结果比较。
- 确认 DeerFlow 与 LangReport 各自的根 AGENTS.md 可读取，根 AGENTS.md 的导航路径有效。
- 以新绝对路径启动新的 Codex 会话，并验证两个 Agent 的写入边界。

### 回滚

在目标父目录、配置更新和新 Git 状态尚未被用户批准提交前：

1. 停止运行进程；
2. 将已移动的完整仓库移动回已记录的原始绝对路径；
3. 恢复经确认更新的本地路径配置；
4. 用迁移前清单比对 HEAD、分支、status 和未跟踪文件；
5. 保留失败日志和差异，不删除证据。

不得使用 git reset --hard、git checkout -- 或递归删除作为回滚替代。

### 实施事件：失败移动的恢复

首次对 deer-flow 使用非原子 Move-Item 后，Windows 在部分顶层条目已出现于
deerflow 时返回访问拒绝。实施立即停止：先将已移动的根条目复制回原目录，再从
partial target 复制完整 .git 元数据，最后用记录的 HEAD、stash 和 clean status
验证原仓库，才删除该 partial duplicate。后续只允许在目录句柄释放后使用原子
Rename-Item；不允许以复制后删除原仓库替代改名。

## 日志、监控与可观测性

迁移日志写入本变更的 acceptance.md：执行时间、操作者角色、原/目标目录、每个预检命令的结果摘要和差异。日志不得包含密钥、.env 明文、Git 凭据或未脱敏的 remote URL。

## 测试策略

详见 test-plan.md。关键原则是先获取可比较基线，再验证迁移后的 Git 身份、文件差异、文档链接和项目命令输出。

## 需求追踪矩阵

| 需求 | 设计 | 任务 | 测试 | commit |
| --- | --- | --- | --- | --- |
| R1：参考与实现职责隔离 | 模块边界、权限矩阵 | T3、T6 | TP-3、TP-6 | N/A |
| R2：决策可长期追溯且不重复 | agent-tasks 职责、数据流 | T3、T6 | TP-4、TP-6 | N/A |
| R3：目录整理不损失工作树 | 迁移与回滚 | T1、T2、T4、T5 | TP-1、TP-2、TP-5 | N/A |
| R4：用户控制架构门禁 | 状态流转、停止条件 | T0、T6 | TP-3、TP-6 | N/A |
