# 项目记忆系统：Design

- 变更编号：CHG-2026-09-24-memory-system
- 状态：VERIFYING
- 创建时间：2026-09-25
- 更新时间：2026-09-28
- 授权：用户于 2026-09-27 明确授权仅实施 A1、A2、A3、A4 与 GA；2026-09-28 单独授权提交已验证 A 代码，提交为 `61460f6ab2f4a80534fea3c9b0ff0e231953895e`。B/C 与 Git 推送未授权。以下仍区分目标规范与当前运行行为。

## 现状与不变量

现有 packages/memory 提供 Project/Workspace 记忆、候选审核、软删除和生成投影；Conversation 使用单行摘要，提取在用户消息后触发，尚无私有偏好和显式会话归档。既有 Generation 规范要求澄清创建新 Cycle，Worker 消费冻结 Conversation 投影；不能为了记忆系统改成读取实时会话。

本设计修正此前 Task=Cycle、澄清复用 Cycle、逐次读取全局最新摘要的错误假设。身份复用已交付的 users 表和认证 userId；不新增另一套账户体系。

不改变单 Project、单 Snapshot、单 Brief、单主 Evidence Block 的产品边界。权限、Data Snapshot 事实、Metric Definition 确认、Approved Revision 不可变和输出合同，始终高于记忆优先级。业务发现属于 Evidence，不自动变成 Project Memory；已有 Metric Definition/Visual Template 由记忆引用，不维护第二份权威正文。

## 层级与结束条件

| 层级                   | 定义与所有者                                                            | 自动使用与结束                                                                     |
| ---------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Task Memory            | Conversation 内逻辑分析任务的请求、澄清和约束；一个 Task 可有多个 Cycle | Task 成功、最终失败或显式取消后 expire；needs_clarification 不结束 Task            |
| Conversation Memory    | Session 映射现有 Conversation，不新造 Session 实体；近期原文与滚动摘要  | 显式归档后停止自动注入，历史仍可读；存在未结束 Task 时拒绝归档，要求先完成/取消    |
| Project Memory         | 经授权用户确认的项目可复用事实、规则、术语和决定                        | 无时间 TTL；只在本 Project 使用，支持编辑、删除、置顶和重新确认                    |
| User Preference Memory | 当前认证用户的语言、语气、详略、交互和默认输出格式                      | 用户私有、跨本人 Project 生效，无时间 TTL；图表视觉由 Project Visual Template 管理 |
| Workspace Memory       | 未来的跨 Project 共享层                                                 | 首期禁止读、写、删除及可用 UI/API；既有行保留                                      |

Task/Conversation 的 expire 是退出活动注入，不是删除业务记录。没有不可由用户治理的“永久记忆”。关键规则、指标引用、偏好和置顶记录不参与衰减；低价值 Project 背景仅可降低检索权重，不自动删除。首期保留策略接口，自动衰减调优后置。

## 双优先级与权威边界

- 指令：当前明确请求 > Project 规则 > 当前 Conversation 约束 > 个人偏好 > 历史记忆 > 模型默认行为。
- 事实背景：当前用户信息 > 当前会话已确认信息 > 当前 Task 上下文 > Project Memory > 历史 Conversation Memory > 模型推断/默认值。

优先级是本次上下文处理规则，不等于事实真伪证明或访问授权。临时覆盖不更新长期记忆；若涉及指标变更，必须显式 Generation Decision/新确认口径并创建相应新 Cycle，不改写旧 Snapshot 或 Revision。记忆正文、引用、历史记录均是数据，不能提升为系统指令或绕过权限。

## Task、Cycle 与版本固定

1. Conversation 包含多个 Task；Task 关联一个或多个 Generation Cycle，Job 是执行单元，不与 Task 混同。
2. 用户补充澄清创建新 Cycle，继承 Task 关联并重选当时相关、已确认且有效的记忆；修改模型/业务输入也创建新 Cycle。
3. 同一 Cycle 的执行重试、工具循环和租约恢复复用固定输入；普通编辑不替换已选择的记忆版本。删除撤销是例外，不触发其他记忆重新检索。
4. Cycle 创建时冻结允许参与的消息 ID/顺序上界、摘要基线及其完整来源边界、任务上下文、Project 版本选择和私有偏好版本选择。仅 timestamp 或“最新摘要”不足以表达边界；使用稳定消息顺序和明确来源集合。
5. 调用期间只允许重压缩该固定来源集合及本 Cycle 的工具结果；不能吸入同 Conversation 后来新增的无关消息或另一个 Cycle 的摘要。
6. 摘要来源不完整、超出边界或含撤销内容时，不可复用；从合格来源重建，无法安全重建则停止本次调用。
7. 原始 Cycle 输入快照不覆盖；每次调用另记实际采用的摘要版本和实际使用的记忆版本。任务历史区分“创建时选择”与“实际发送使用”，不承诺删除后可全文重放。
8. Task 状态必须由显式事件更新：一个 Cycle 可恢复失败不自动结束 Task；最终失败、成功产出或明确取消才结束。已终结 Task 再提新目标建立新 Task，不静默复活。
9. 原文投影与摘要条目都保留适用层级和 Task 归属；新 Task 排除已结束 Task 的一次性约束，即使其文字仍存在于原文/旧摘要。真正的 Conversation 级约束需单独标注，不能将所有旧任务约束默认为会话规则。历史查询可显示旧约束，但不得将其作为新任务指令；无法判断归属的摘要不能自动注入，须从合格来源重建或要求澄清。

## 记忆身份、版本、冲突与查询

### 身份与状态

为每条逻辑记忆保留稳定 memoryId，版本正文不可原地覆盖；同一 owner/scope/规范化单值 key 只有一个当前 head。候选和已确认记录分开。

- Candidate：proposed → accepted / rejected / expired。
- 已确认版本：active / superseded / deleted；Project 历史保留，偏好正文删除例外见下节。
- 冲突是独立标记，例如 clear / disputed；不能把“待更新”混成普遍过期。
- recordedAt、confirmedAt、effectiveFrom/effectiveTo 分开；历史未知确认时间明确标注未知，不用 createdAt 伪造确认事实。

新候选与已确认记忆矛盾：展示候选冲突，不停用旧记录。用户明确纠错或两个已确认事实冲突：标记 disputed，仅阻断依赖该事实的分析；其他无关记忆和任务仍可使用。用户确认替换时，在同一事务内校验 expectedVersion、创建新版本、旧版本 superseded 并更新 head。禁止单值 key 以“keep both”保留两个活动值。

### 三种查询模式

| 模式        | 返回内容                                                          | 限制                                                                |
| ----------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| current     | 当前授权范围内的已确认 active head，按相关性和预算选取            | disputed、deleted、superseded、候选、归档会话不自动注入             |
| as-of       | 指定业务有效时间的版本；同时展示记录/确认时间，必要时限定 knownAt | 显式历史查询，不能按 createdAt 最大值代替；历史作为证据而非当前指令 |
| actual-used | 某 Cycle/Invocation 实际使用的版本和来源                          | 与当时 selected 区分；偏好仅 owner 可见，删除后正文显示不可用       |

有效时间区间不得重叠；首期编辑从确认时生效，不开放任意追溯生效编辑。历史查询后端/API 首期提供基本能力，高级时间线 UI 后置。归档消息只在显式历史查询中读取，不回填普通检索。

### 隔离

所有数据库读取、候选来源、队列、缓存键、摘要和快照校验 Project/Conversation 归属；私有偏好额外匹配认证 owner。不能先全库检索再由模型筛选。User Preference 候选从创建起就是私有，不混入 Project 列表。

## 删除、留存与防复活

用户已确认两类不同策略：

| 类别                   | 删除成功后的使用资格                                 | 正文与历史                                                                        |
| ---------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| Project Memory         | 所有后续调用排除该逻辑记忆及所有版本，包括活动 Cycle | 逻辑删除；历史版本仅授权审计可读，UI 明示保留历史                                 |
| User Preference Memory | 同上；私有缓存/侧表/摘要副本同样撤销                 | 清除记忆存储内当前及历史正文、派生正文；仅保留 owner-only、无正文的最小删除元数据 |

每次模型发送前经过撤销门，覆盖冻结版本、缓存、摘要及其他派生上下文。删除完成和发送准入需要明确的并发线性化点/同步屏障：删除成功后才准入的调用必须排除；已准入发送且无法撤回的调用按 in-flight 记录，不宣称供应商接收内容已撤回。具体实现须在 A3 用受控并发测试证明，不能仅靠一次早期查询。

维护源消息/记忆版本到派生上下文的依赖关系。派生内容失效后重建或停止调用；原文可留存不等于允许通过原文重压缩恢复已删除记忆。个人删除不保留值、值 hash、key 或可推断正文的通用日志；最小私有元数据仅用于撤销、来源抑制和审计。

延迟 extraction job、队列重放和旧来源再次提取不得复活已删除内容；来源抑制与逻辑记忆撤销关联。后续用户新的明确“记住”可以新建逻辑记忆，不能用永久主题黑名单阻止。

删除记忆不自动删除原始 Conversation、已生成报告或其独立留存的正文；界面应清楚说明范围，历史读取不得变成活动注入绕过途径。已经发出的调用及结果不能撤回。备份不承诺即时物理清除；恢复必须先重放删除/撤销记录，再开放读取或模型调用，不能靠回滚恢复被删偏好。

### TP-25 撤销账本与恢复门

已确认部署资料记载 Web 部署于 Vercel，API、PostgreSQL、MinIO 和 Workers 由阿里云 ECS Docker Compose 托管；PostgreSQL 与 MinIO 使用不同的本机 named volume。仓库没有自动备份/恢复脚本。A 批采用同一 ECS 上独立于 PostgreSQL 的 `langreport-memory-revocation-prod` Docker named volume，不使用 MinIO、新云服务、付费服务、外部托管或新 IAM/凭据。该边界适用于 PostgreSQL 逻辑备份恢复，不覆盖整台 ECS 或含账本卷的主机快照回滚。

账本为只追加序号文件和 `HEAD.json` manifest，保存格式/ledger ID/序号/范围与必要的 opaque owner、Project、logical memory、preference-version 和 source-message IDs、撤销时间及仅覆盖账本元数据的 hash chain。事件先写临时文件、fsync、原子重命名及目录 fsync，再原子更新 HEAD。HEAD 含受校验的初始化状态；显式 init 完成全部旧撤销元数据导入后才原子标记 initialized，部分初始化不能被启动 replay 当作完整账本。绝不存记忆正文、偏好值、描述性 key 或内容 hash；不提供成员 API。个人偏好事件保留偏好版本 ID，以清理恢复出的私有引用并识别删除重试。

删除在持有跨实例 advisory lock 并锁定/校验当前 head 后先持久化账本事件，再在同一数据库事务中提交 tombstone、来源抑制、Project 活动 head 删除状态、偏好正文/派生引用清理及 replay checkpoint。账本写入失败不得更改 DB 或返回删除成功；账本已写入而 DB 事务失败时，checkpoint 落后会关闭服务入口，重试重放。重复事件按 ledger identity、序号和逻辑记忆 ID 幂等。显式首次 init 会导入现有撤销元数据并拒绝待处理 extraction job；应用启动绝不自动创建空账本。

API 在监听前、每个业务请求和 readiness 时验证；Generation/Render Worker 在启动和轮询前验证，Generation Worker 发送模型请求前再验证。恢复时先停 API/Nginx/Workers，恢复主业务 PostgreSQL 逻辑备份而保留账本卷；服务启动逐事件事务重放并清理，checkpoint 与账本一致后才开放。账本缺失、损坏、身份/完整性不符、checkpoint 超前或重放失败均保持 fail closed。应用不得自动初始化丢失账本；首次部署用显式 init，且只接受无记忆、无历史撤销/来源抑制、无待提取工作的空状态。

不自动清理账本；旧备份、来源或重放任务仍可复活内容时不得删除对应记录。ECS 本机卷无法防御同时回滚整台主机的快照；若生产 restore 实际采用整机回滚，需要另行批准独立 anchor/存储。本批不执行生产初始化、迁移或恢复。详细决策见 [ADR-0029](../../adr/0029-memory-revocation-ledger-and-recovery-gate.md)。

## 窄接口与依赖

应用层组合 packages/memory 与 Generation/ModelGateway Adapter；通用 Harness/Provider 不导入用户存储、数据库或 Project 授权逻辑。

- freezeGenerationMemoryContext：以授权 user/Project/Conversation/Task/Cycle 和固定来源创建共享 Project 快照及 owner-only 偏好侧记录，幂等且事务一致。
- prepareModelInvocationContext：每次调用基于固定来源检查撤销、冲突、压缩及预算；返回不可直接混合序列化的共享与私有投影。
- enqueueMemoryProposal：用户可见助手回复持久化后的幂等 outbox 排队，封装来源上界、重试和去重。
- 管理用例：current/as-of/actual-used、确认/编辑/删除/重新确认及归档，统一权限和并发语义。

现有 Gateway 以 chart-plan 为主；摘要和候选需独立 typed invocation kind、结构化输出合同、预算、调用审计和注入式 Adapter，不复用图表计划 prompt 冒充通用模型接口。压缩器的模型调用有独立 budget、有限次数及 recursion guard。任一模型发送都经过预算与隐私边界；压缩调用不再递归发起压缩。

公共 Job/Revision/inputFingerprint/日志中禁止偏好正文、key、ID、hash、私有 fingerprint 或使用标记；偏好版本选择、幂等比较与使用记录仅 owner-only。幂等重放沿用原 Cycle；新业务输入或新偏好选择请求不得静默复用旧 Cycle。普通对话每轮建立调用来源边界，不需要创建虚假的 Generation Cycle。

## 持久化规划

以下是目标约束，不是已经执行的 migration：

| 对象                    | 必需约束                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Task/Cycle 关联         | taskId、cycleId 和 Job 关系明确；不能用父 Job 根链自动等同 Cycle                   |
| 记忆实体/版本           | 稳定 ID、不可变版本、单值 head 唯一约束、expectedVersion、有效区间、来源和冲突标记 |
| 用户偏好及候选          | owner 复用实际 users.id 类型与授权关系，私有 DTO/表/运行时侧记录                   |
| Conversation            | active/archived；归档与 Task 创建/终结、消息追加、候选确认事务竞争受控             |
| 摘要版本                | 基线版本、来源集合/顺序水位、适用 Cycle 边界、压缩策略版本和依赖血缘；同边界 CAS   |
| Cycle/Invocation 上下文 | selected 与 actual-used 分离；原投影不可变，私有记录不进入共享对象                 |
| 撤销与来源抑制          | owner/scope、逻辑 ID、删除顺序、依赖失效、必要源 ID；私有删除记录不存正文/值 hash  |
| 提取 outbox             | 持久化回复幂等键、固定来源上界、提取版本、有限重试/失败状态；不查询无限实时会话    |

既有摘要迁为 baseline，不能验证来源边界的旧摘要仅历史读。旧 active 记忆的确认来源不足时列为待重新确认，不补造 confirmedAt。旧 visual_preference 不自动迁成用户偏好或视觉默认；经确认迁往 Visual Template。旧 Workspace 行不迁移/删除。

历史 Job 回填依据冻结输入、澄清决定和已有 lineage 证据；父子链只证明关联，不证明同 Cycle。无法可靠判断的记录仅历史读取，不参与活动续接。回填 dry-run、歧义清单、备份和恢复演练属于实施任务，未在本轮执行。

## 逐调用压缩

1. 从本次合格固定来源读取摘要和消息，不读取超出 Cycle 边界的最新摘要。
2. 每次调用前检查配置：token、消息数、窗口比例，多个条件为 OR；包括当前消息和已有 summary_text。无启用条件为无效配置。
3. 除触发阈值外，检查完整请求硬预算：system、tools、输出 schema、数据上下文、Project/私有记忆、摘要、消息及输出预留。完整请求超限不能仅因消息未触发阈值而放行。
4. 只压缩合格的较旧闭合消息，保留当前用户请求、近期尾部及 tool call/result 配对。摘要标注目标、已确认事实、未决问题、约束与来源，不把推断变成事实。
5. 合格工具结果可参加压缩，但原始表格行/样例值不进入摘要提取器；这些数据若是目标生成请求的合法输入，仍计入该请求总预算。
6. 摘要追加版本，同一来源分支 CAS；竞争失败只重读与本 Cycle 边界兼容的摘要。压缩改变表示，不扩大信息来源。
7. 分块/合并有总次数、deadline、token 上限；摘要无缩减、保留区自身过大或重试预算耗尽时明确失败，不无限压缩。
8. 失败保留原文和旧摘要，目标下游调用数为零；持久化输入可用于后续明确重试。删除导致的失效不能回退到旧摘要。

默认数值在 B3 用固定长会话/工具链样例评估并写配置合同；不再作为需用户反复选择的产品决策。已有 Worker deadline 与输出预算必须一并核算，不能直接加一次无预算模型调用。

## 候选、确认与冲突门控

每次持久化的面向用户助手回复（含澄清）后异步提取；工具消息、内部调用和流式片段不触发。助手输出可以作为有限理解上下文，但候选 sourceMessageIds 只能引用本 Conversation、合格上界内的用户陈述。

Gate 至少检查：owner/scope、长期适用性、来源/证据、显式确认、隐私、类别/长度、重复和冲突。一次性的筛选不成为偏好，项目客户事实不成为全局用户偏好；随口陈述最多是待审候选，不自动正式写入。Agent 推断只能作为假设/待核实建议，不伪装为用户证据。

明确、当前、非引用/非假设的“记住”且 scope 清楚时直接确认；有歧义先澄清。直接确认与异步候选去重。候选接受/编辑/拒绝须授权及 expectedVersion；scope 变更重新校验来源与权限，不能借接受操作跨项目搬运信息。

归档使本 Conversation 未决候选 expired；后台任务即使完成也不得新增可接受候选。失败不回滚已完成助手回复，保留可观测的有限重试/失败状态。候选确认与删除、归档、其他确认的竞态须事务化。

## API、UI 与错误合同

| 操作         | 规划合同与约束                                                                               |
| ------------ | -------------------------------------------------------------------------------------------- |
| Project 管理 | 查看 current/as-of/actual-used、版本编辑、重新确认、置顶、删除、冲突来源；Project Role 授权  |
| 私有偏好     | GET/POST /api/v1/me/preferences；PATCH/DELETE /api/v1/me/preferences/:id；owner 只取认证身份 |
| 私有使用     | GET /api/v1/me/memory-usage；偏好已删时正文不可恢复，不由公共 Job API 代理                   |
| 会话候选     | GET /api/v1/conversations/:id/memory-candidates；接受/编辑/拒绝；Project 与个人候选分开过滤  |
| 归档         | POST /api/v1/conversations/:id/archive；未结束 Task 返回冲突；终态归档后只读                 |
| Workspace    | 禁用/410，应用路径不查询、修改已有 Workspace memory rows                                     |

幂等键用于创建/重放，expectedVersion 用于并发修改，不要求无状态 GET 携带 expectedVersion。外部稳定错误区分版本冲突、需澄清、上下文超限、压缩失败、归档冲突和禁用作用域；私有越权统一不泄露存在性。

每批改 API 时同时更新 OpenAPI、API Console 示例/场景/校验和对应 Web 入口。UI 显示 scope、来源、确认时间、冲突、删除范围；隐藏别人偏好的存在性。Reviewer/Viewer 不能看他人偏好，但仍可管理自己的私有偏好，不能用项目角色禁止本人设置。

## 交付、降级与可观测性

- A：版本/隔离/人工管理/删除闭环。只有所有现有模型发送路径、缓存和快照已接撤销门，且完整请求硬预算的最低拒绝门已生效后才能启用偏好，不等待 B 才保障删除和预算。A 超预算直接失败；B 再加入可用的压缩重构策略。
- B：Task/Cycle、固定来源、摘要压缩和归档，复用 A 撤销机制并补全新派生摘要的依赖链。
- C：持久化异步候选、门控/去重/冲突和完整独立验收。
- 三批均属于本次 MVP；向量检索、自动批准、图谱、复杂历史 UI、衰减调优不进入本轮。

additive migration 与前向修复优先；各批通过退出门后再开放适用能力。若隐私隔离或撤销门失败，关闭受影响调用只能临时止损，不能替代 A 批实施、修复或 GA 验证；权限、撤销和完整请求硬预算门必须保留，应用回退不能启用不认识删除记录的旧读取器。个人已授权正文清除是预期删除，不以“审计永不删除”为由保留秘密副本。

允许记录非私有任务标识、摘要版本、来源水位、阈值/耗时/用量、Project 版本及排除原因。私有使用/撤销仅 owner 可读；公共日志不写 prompt、候选模型原始输出、偏好标识/hash/使用标记和原始数据行。指标包括队列失败/重试、CAS 冲突、预算失败、撤销阻断、冲突与越权拒绝。

## 需求追踪

| 需求                      | 任务           | 测试                                     | 实现证据                                                                          |
| ------------------------- | -------------- | ---------------------------------------- | --------------------------------------------------------------------------------- |
| R1 层级/隔离，R9 私有边界 | A1、A3、A4、B1 | TP-14～17、TP-25、TP-30                  | A1～A4 已实现；Job/Revision/API/审计隔离见 test-report；B1 未授权                 |
| R2 双优先级/不变量        | A2、B1         | TP-01、02、TP-34                         | A 批现有手动链路与版本冲突已实现；完整 Task/Cycle 优先级语义属于 B，未授权        |
| R3 生命周期/冲突/衰减     | A2、B4、C2     | TP-03、12、18、19、TP-27                 | A 批 Project 冲突/历史/as-of 已实现；归档、自动候选和衰减不在 A                   |
| R4/R5 提取/门控/确认      | A2、C1～C3     | TP-09～11、TP-28、TP-31                  | A 批人工确认和偏好管理已实现；异步提取/候选自动化不在 A                           |
| R6 固定来源/删除/留存     | A1～A3、B1、B2 | TP-13、15、22、23、TP-25、26、29、30、32 | A 批撤销、正文清除、来源抑制及两范围准入竞态已实现并测试；Task/Cycle 摘要传播属 B |
| R7 完整预算与逐次压缩     | A3、B2、B3     | TP-04～08、TP-13、TP-26、TP-33           | A3 完整请求硬预算拒绝门已实现并测试；逐次压缩属 B，未授权                         |
| R8 管理 API/UI            | A4、B4、C3     | TP-03、12、14、20、21、TP-32             | Project/偏好手动管理 API、OpenAPI/API Console 与 Web 已同步；归档和候选 UI 不在 A |
| R10 检索/历史/实际使用    | A2、A3、B2     | TP-19、TP-29、30、32                     | A 批确定性检索、current/history/as-of/actual-use 已实现；摘要实际使用属 B         |

详细用例见 [test-plan.md](test-plan.md) 和 [test-report.md](test-report.md)，任务依赖和门禁见 [task.md](task.md)。本轮只执行 A 适用用例；B/C 测试未执行，独立复核与用户最终验收待完成。

## 依据与工程待办

- [ADR 0004](../../adr/0004-confirmed-layered-memory.md)：确认式长期记忆。
- [ADR 0025](../../adr/0025-private-user-preference-memory-scope.md)：私有偏好及删除留存。
- [ADR 0026](../../adr/0026-invocation-scoped-memory-context-and-compaction.md)：逐调用准备与压缩。
- [ADR 0028](../../adr/0028-task-cycle-memory-consistency.md)：Task/Cycle 与固定来源。
- DeerFlow 本地只读研究：agent-tasks/research/LANGREPORT-2026-09-24-memory-deerflow.md；参考提交 29d285731b326a728a9df33d3641f73b68bbe48b。参考持久化提取、scope/durability/authority 门控与成对替换思路，不复制自动批准或完整 middleware 体系。

已确认产品规则不再待决。实施仍须核对旧数据回填证据、发送/撤销并发屏障、默认配置和数据库约束；这些分别进入 A1/A3/B1/B3/C1，不是本轮执行动作。若验证发现必须改变已确认的隐私、留存或生命周期语义，先回设计评审，不静默降级。
