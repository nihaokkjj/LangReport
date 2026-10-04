# 项目记忆系统：Test Plan

- 变更编号：CHG-2026-09-24-memory-system
- 状态：VERIFYING（本次纯提交快照质量门、typecheck 与完整集成未通过；详见 test-report.md）
- 创建时间：2026-09-25
- 更新时间：2026-09-28
- 执行状态：rev3 的 TP-25 旧备份恢复重放、失败/重试、重复重放与崩溃恢复隔离测试通过；rev1 阻塞已修复，rev2 GA FAIL、rev3 NEEDS-EVIDENCE 和其后补齐的实时工作树 `pnpm typecheck` 通过均保留为历史证据。2026-09-28 纯提交快照与新增 startup 测试分别复核：startup 单项通过，提交范围的格式/lint 和完整类型/集成门未通过。实际命令、退出码和证据边界见 [test-report.md](./test-report.md)。技术 GA 仍为 VERIFYING，B/C 用例不执行。

## A 批执行范围说明

- 本轮只验收现有手动 Project Memory 与个人偏好链路：版本、冲突、scope 隔离、API/OpenAPI、实际生成调用的撤销门、完整请求预算硬拒绝、删除清理和管理 UI。
- 删除/发送准入竞态分别覆盖 Project Memory 与个人偏好。删除先完成时下一次准入不含该条记忆；准入先完成时只允许该在途调用保留，后续调用必须排除。
- UI E2E 使用合成数据和 Mock API，覆盖桌面、平板、紧凑及移动视口；不等同于真实 API、生产部署或用户验收。
- Task/Cycle 跨澄清、摘要压缩、Conversation 归档、候选 outbox 与自动审核属于 B/C，本轮明确未实施、未验证。

## 测试范围

验证 Task/Conversation/Project/User Preference 作用域、双优先级、候选生命周期、逐模型调用压缩、Cycle 快照冻结、确定性检索、私有偏好隔离、Workspace 首期禁用、API Console 同步与 UI 管理流程。覆盖 Unit、数据库/集成、API/Contract、Worker、Web 人工验收和独立回归。

## 风险到测试映射

| ID    | 风险                                             | 测试类型                      | 场景                                                                                                                               | 预期结果                                                                                                                                              |
| ----- | ------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| TP-01 | 两套优先级被合并或颠倒                           | Domain unit                   | 分别构造指令冲突与事实冲突                                                                                                         | 指令按“当前请求 > Project 规则 > 当前会话约束 > 偏好 > 历史 > 默认”执行；事实来源按确认的六级顺序评估                                                 |
| TP-02 | 当前明确请求静默改写长期记忆                     | Memory/API integration        | 请求临时偏离 Project Memory 后结束 Cycle                                                                                           | 本轮按当前请求处理；长期记录不变，除非用户显式修改/确认                                                                                               |
| TP-03 | 归档语义错误导致内容丢失或继续写                 | API/DB integration            | 归档、切换 Conversation、重新登录、归档后追加消息                                                                                  | 存在未结束 Task 时拒绝归档，需先完成/显式取消；只有显式归档结束；历史原文仍可读/搜索；归档后只读；页面切换/登录不自动归档                             |
| TP-04 | 摘要覆盖丢失消息或并发回退                       | Memory interface + DB         | 多次滚动压缩；两个并发压缩基于同一版本写入                                                                                         | 追加新摘要版本；source watermark 单调；CAS 冲突不覆盖较新版本；原始消息完整                                                                           |
| TP-05 | 压缩阈值使用 AND 或漏计摘要                      | Unit                          | 分别达到 token、message、window ratio；构造“summary + 当前消息”越阈值                                                              | 任一启用条件达到即触发；计数包括现有 summary_text 与当前消息                                                                                          |
| TP-06 | 工具循环中未重新检查压缩                         | Agent/Worker integration      | 多轮工具/模型调用，在循环中途跨过阈值                                                                                              | 每次 ModelGateway 调用前重新检查；长工具调用中可触发多次                                                                                              |
| TP-07 | 摘要截断破坏请求或工具交接                       | Unit/Worker integration       | 压缩时存在当前请求、未完成 tool call 与 tool response                                                                              | 当前请求、最近原文尾部、完整工具交接配对保留；旧闭合消息才被合并                                                                                      |
| TP-08 | 压缩递归、预算失控或错误后继续调用               | Unit/Worker integration       | 摘要输入超长、摘要超时/异常、压缩自身触发阈值                                                                                      | 分块并使用独立预算；recursion guard 阻止递归；压缩失败保留原始数据且下游模型调用计数为 0                                                              |
| TP-09 | 候选在助手回复持久化前触发或被工具消息污染       | API/Queue integration         | 用户输入、内部工具消息、已持久化助手回复、重放同一 outbox                                                                          | 仅已持久化的面向用户助手回复触发异步提取；内部/纯工具/流式未持久化内容不触发；幂等去重                                                                |
| TP-10 | 模型推断或原始数据行进入长期记忆                 | Gate/Contract tests           | 候选来源指向 assistant、system、错误 Conversation 或表格样例值                                                                     | Gate 拒绝；accepted memory 必须有合法用户消息来源；原始数据行不作为 extraction 输入                                                                   |
| TP-11 | 显式记住与 inferred candidate 生命周期混淆       | API/Memory integration        | 用户明确要求记住偏好/Project 规则；模型从普通描述提取偏好                                                                          | 明确命令 scope 清楚时创建 confirmed 记录并写 confirmedAt；普通推断只能 proposed；scope 不清先澄清                                                     |
| TP-12 | Session 归档后候选仍可接受                       | DB/API integration            | Conversation 有 proposed Candidate 后归档，再尝试接受                                                                              | Candidate 进入 expired 且不可接受；已确认长期记忆保留；transcript 不删除                                                                              |
| TP-13 | 混淆 Task/Cycle 导致上下文漂移                   | Worker integration            | 修改记忆后重试旧 Cycle，再补充澄清；分别模拟等待澄清、可恢复失败、成功/最终失败/取消                                               | 旧 Cycle 重试保持原选择；澄清同 Task 新 Cycle 并重新选择；等待澄清不结束 Task；Task 终态才停止 Task Memory 注入；删除按 TP-23                         |
| TP-14 | Project 成员读取个人偏好                         | API/Contract/authorization    | 其他 user、Reviewer、Viewer 按 preference ID、Job ID、Conversation ID 查询                                                         | 返回 404/403；不泄露存在性、正文、key、hash、ID、使用标记                                                                                             |
| TP-15 | 个人偏好通过共享序列化/幂等/hash/错误泄露        | API/Worker privacy regression | 获取 Job、Revision、memory-context、audit、error 和日志快照                                                                        | 所有项目可见对象不含偏好正文、key、hash、preference ID/private fingerprint/usage flag；owner-only 使用记录可读                                        |
| TP-16 | User Preference 被错误共享或视觉偏好覆盖项目模板 | Domain/API/UI                 | 不同 Project/成员读取偏好；设置颜色默认值；项目 Visual Template 冲突                                                               | 同一认证用户跨 Project 可使用其表达偏好；其他成员不可见；视觉规范仍由 Project Visual Template 管理                                                    |
| TP-17 | Workspace Memory 在首期继续参与生成              | DB/API/Worker integration     | 插入已有 Workspace row 后创建 Cycle，调用 Workspace memory route                                                                   | Generation 上下文不含该行；API 返回 disabled/410 且不查询/写入；数据库原行仍保留                                                                      |
| TP-18 | 低价值衰减误删关键规则/偏好                      | Domain unit                   | 长期未命中 Project 背景、Metric、业务规则、置顶记录、User Preference                                                               | 仅允许可选 Project 背景降权；无自动删除；关键规则、指标、置顶项及所有偏好不衰减；重新确认恢复优先级                                                   |
| TP-19 | 检索超预算或冲突被静默选择                       | Memory interface              | 多 scope/key 冲突，context budget 不足，输入无关键词                                                                               | 确定性筛选并记录命中/冲突/排除；冲突等待决定；预算上限有效；不得按更新时间静默选择                                                                    |
| TP-20 | API Console 与服务端合同漂移                     | Contract/API Console test     | 新增/修改 Memory、archive、private usage API                                                                                       | OpenAPI、请求/响应示例、场景编排和校验同步；测试中无暴露偏好字段                                                                                      |
| TP-21 | 管理 UI 造成误操作或信息泄露                     | Manual Web                    | 候选接受/编辑/拒绝；偏好显示确认时间、编辑、删除；移动端布局                                                                       | 操作范围清楚、冲突可见、错误可恢复；仅 owner 可见偏好页面/数据；桌面与移动端布局可用                                                                  |
| TP-22 | Migration 回填错误或回滚破坏已有数据             | DB migration test             | 旧快照、候选、Workspace rows、Generation parent chain 上执行前向迁移与应用回退                                                     | 原文/既有记忆/Workspace 行保留；快照基线可读取；无法确定的旧 Cycle 不被错误拼接                                                                       |
| TP-23 | 删除未撤销活动 Cycle 后续调用的记忆注入          | Worker/privacy integration    | Cycle 冻结 Project Memory/Preference 后由有权限用户删除；分别覆盖缓存命中、摘要派生上下文、工具循环、澄清/重试及删除时已有调用发出 | 删除成功后的下一次及后续调用不注入该记忆或从其旧版本/派生副本恢复；未删除项不刷新版本；偏好撤销不泄露到项目 DTO；不声称能撤回已发出的调用或已生成结果 |
| TP-24 | 遗留视觉偏好误进入个人偏好                       | Memory migration/integration  | 插入旧 visual_preference 记录并创建新 Cycle                                                                                        | 旧记录不自动映射为用户偏好或新视觉默认；需用户确认迁入 Project Visual Template                                                                        |

| TP-25 | 删除后被队列、旧来源或恢复操作复活 | Memory/Queue/DB/Compose | 在隔离 Postgres 中创建旧备份快照，成功删除 Project Memory 与个人偏好，再恢复删除前表状态，启动 replay gate 重放；重复重放；模拟账本写入失败、DB 事务失败、损坏/缺账本、进程在账本 fsync 后或 replay transaction 中崩溃；之后再尝试旧来源/提取任务 | 恢复后的 Project 记忆不可查询/as-of/注入，个人偏好正文及私有引用被清除；来源仍受抑制；重复重放不重复副作用；任何完整性/重放失败时 API、Workers 和模型发送保持关闭；新明确记住可创建全新 logical memory |
| TP-26 | 旧 Cycle 吸入新会话消息/摘要 | Worker/DB | 两个 Cycle 并发，后续追加无关用户消息；旧 Cycle 触发摘要 CAS 重试 | 仅用各自固定来源/兼容摘要及各自工具结果；不能按全局最新版本扩大来源；原投影不覆盖 |
| TP-27 | 候选冲突错误停用旧事实或阻塞整个 Project | Domain/Memory | 未确认矛盾候选、明确用户纠错、两个确认事实矛盾；运行依赖/无关两个任务 | 未确认候选不影响旧 active；确认冲突为独立标记，仅影响相关分析；确认替换原子化 |
| TP-28 | 随口陈述、一次性要求、引用或推断变永久偏好 | Gate/API | “这次用英文”、客户语言要求、引用“记住”、假设语句、Agent 推断 | 临时约束留 Task；客户事实留 Project 范围；引用/假设非写入指令；推断不能直接正式入库 |
| TP-29 | 并发编辑/确认产生两个 active head | DB/Memory | 两个同 expectedVersion 编辑、双候选确认同 scope/key、确认同时删除 | 至多一项成功更新 head；冲突返回稳定错误；新旧版本/有效区间原子更新、不重叠 |
| TP-30 | 删除留存与私有使用记录泄露 | Privacy/DB/Worker | 删除偏好后查询所有版本/私有使用/缓存/摘要；删除 Project 后普通与审计查询 | 偏好当前历史及派生正文清除，只留 owner-only 无正文元数据；Project 不注入、授权审计可读；原对话/报告独立留存，不宣称一并删除 |
| TP-31 | 提取任务读取回复之后新增消息 | Queue/Gate | 固定 source watermark 后新增用户消息；重复派发、进程重启、归档后完成 | 提取只读固定合格来源；幂等有限重试；归档后无新可接受候选，原回复不回滚 |
| TP-32 | 当前、历史和实际使用混淆 | Memory/API | v1 被选择后改 v2，查询 current/as-of/actual-used；删除后再次查询 | 明确返回对应 head/有效时间版本/实际发送版本；未发送不算已使用；历史不作为当前指令；已删偏好正文不可重放 |
| TP-33 | 压缩不终止或漏算完整请求预算 | Unit/Gateway | 巨大 tools/schema、摘要无缩减、保留区超大、次数/deadline 耗尽 | 即使消息阈值未达也执行硬预算；输出预留计入；有限压缩后失败关闭，原文保留 |
| TP-34 | 当前请求越过业务/安全不变量 | Domain/Generation | 请求改旧 Snapshot、覆盖 Approved、绕过角色或临时改指标 | 拒绝越权/破坏性覆盖；指标变更须显式决定/确认并新 Cycle，优先级不充当授权 |
| TP-35 | 删除成功却没有外部撤销持久化 | Memory/DB/fs | 模拟 ledger 目录只读、磁盘写入失败、头文件更新失败、DB 提交失败及并发重复 DELETE | ledger 持久化前 DB 不变且不得报告删除成功；ledger 已持久化但 DB 未完成时 readiness 关闭并可幂等重放；重复请求无重复副作用 |
| TP-36 | 旧备份恢复令已删除记忆复活 | DB integration/recovery | 创建删除前 SQL 数据快照；删除成功；恢复原 snapshot 的相关记忆、偏好、派生引用与旧 checkpoint；触发启动重放 | Project tombstone/来源抑制恢复；偏好正文与私有引用再次清除；current/history/as-of/context 和旧来源接受均不可复活内容 |
| TP-37 | 撤销账本缺失或完整性无法确认仍对外服务 | API/Worker/DB | 缺 HEAD/ledger、截断末行、序号缺口、digest 不符、DB checkpoint 超前、ledger identity 不符及 replay SQL 失败 | API 不监听/业务请求 503，readiness 非 ready；Generation/Render Worker 不轮询，Model Gateway 不发送；恢复记录后可重试 |
| TP-38 | 崩溃造成初始化、记录或 replay 半完成 | Memory/DB integration | 在 init 导入中途、事件 fsync 后、HEAD 提交后、tombstone 事务提交前后及 replay/checkpoint 事务中途注入进程故障并重启 | 部分初始化在完成标记前 fail closed；完成标记后所有导入撤销可重放；已 fsync 完整事件可恢复；未完整/不一致日志 fail closed；DB tombstone 与 checkpoint 原子提交，不能留下假成功或跳过事件 |
| TP-39 | 重试与重复 replay 造成版本、审计或清理副作用 | Memory/DB integration | 同一 logical memory 重复 delete、同 ledger 多次完整 replay、并发 API/Worker 启动重放 | 事件按 scope/ledger identity/sequence 幂等；tombstone、来源抑制、私有正文清理与 checkpoint 稳定，不重复写私有正文或向审计泄露值 |

## 分批测试安排

### 必测并发与跨任务补充

- TP-13：同一 Conversation 结束 Task A 后创建 Task B；A 的“仅这次用英文”等约束仍存于原文与摘要，但 B 不得继承；已明确标注的 Conversation 级约束仍按其范围生效。
- TP-23：用可暂停 Fake 在早期撤销查询后、发送准入前设置屏障。顺序一：删除先成功，释放屏障后必须阻断或重建排除内容；顺序二：发送先准入，记录为 in-flight，不承诺撤回，但之后所有调用排除。GA 必须保留两种顺序的证据，不能只测试串行删除。
- TP-03/TP-12：分别让归档与创建新 Task、追加消息、接受候选并发。按事务先后保证归档成功后无活动 Task、无新消息写入、无新候选接受；竞争方只能在归档之前完成或收到稳定冲突。Task 创建先成功时归档必须拒绝，不能静默取消该 Task。
- TP-33：A3/GA 即验证包含私有偏好、system、tools、schema 与输出预留的完整请求超限拒绝；B3 再补阈值压缩、无缩减和有限次数退出。不得等 B 才限制新增偏好的请求大小。

- A：TP-01、02、11、14～25、27、29、30、32～34、35～39；TP-25/35～39 覆盖撤销账本持久化、旧备份恢复、重复重放、失败/崩溃关闭与重试；TP-33 覆盖完整请求硬预算拒绝。
- B：TP-03～08、12、13、22、23、26、30、32、33，回归 A；补新增摘要与归档的派生撤销。
- C：TP-09～12、14、15、19～21、25、27～29、31；最终 TP-01～34 完整独立验证。
- 每批区分已适用和后批新增路径；不得用“后批实现”推迟已开启功能的隐私/删除保障。

## 测试数据与环境

- 使用隔离 Postgres 测试库和不同 userId、Project Role、Conversation、Generation Cycle。
- 偏好测试值使用合成数据；不得在日志或 CI artifact 写入真实用户偏好。
- ModelGateway 使用可计数的 Fake Adapter 验证压缩调用次数、下游调用是否被阻止和 recursion guard。
- 归档/Candidate/Cycle 测试固定时钟或显式版本，不依赖真实等待时间。
- API Console 检查使用仓库现有 Contract/OpenAPI 与 Web 测试设施；不连接生产模型供应商。
- Project/User Preference 删除测试验证运行中及新 Cycle 的后续调用撤销；使用可暂停的 Fake Adapter 区分已发出的调用与下一次调用，无需真实模型服务。历史正文清理按 TP-30 验证，删除后不可通过历史查询恢复个人偏好正文。

## 自动化测试

- Memory/Domain unit：TP-01、TP-02、TP-05、TP-07、TP-08、TP-10、TP-18、TP-19。
- Database/Integration：TP-03、TP-04、TP-09、TP-12、TP-13、TP-17、TP-22、TP-23。
- API/Contract/Privacy：TP-11、TP-14、TP-15、TP-20。
- Web/Manual：TP-16、TP-21。
- 整体验证命令以实现时 manifest 为准，至少包括 pnpm typecheck、pnpm test、pnpm docs:check、API Contract tests 和 Web typecheck。独立 Verification Agent 记录快照、命令、原始结果、失败与复测。

## 人工验收步骤

以下现场步骤未在本轮运行；桌面/移动 UI 只通过 Mock API 的 Playwright E2E，等待用户最终验收：

1. 在 Conversation 中形成一个 proposed 候选，检查来源、scope、冲突和接受/编辑/拒绝入口。
2. 发出明确“记住”请求，确认不经过 proposed 状态即可看到已确认状态、来源和确认时间。
3. 在两个 Project 间发起 Cycle，检查个人偏好对所有者生效而对 Reviewer/API Console/Revision 不可见。
4. 在长工具循环中跨过配置阈值，检查压缩版本更新、消息尾部保留和摘要失败时没有目标模型调用。
5. 先验证未结束 Task 阻止归档，完成或取消后归档，确认只读、候选过期、历史消息仍可搜索；创建新 Conversation 后能使用确认的 Project/个人记忆。
6. 查询 Workspace Memory API，确认无数据被返回且已有数据库记录仍存在。
7. 在运行中的 Cycle 删除已冻结的 Project Memory 或个人偏好，确认下一次模型调用不再注入；已生成结果保持原状，界面不声称已撤回供应商收到的内容。

## 不测试的内容及原因

- 外部向量数据库、跨用户偏好同步和 Workspace Memory 产品入口：不在首期范围。
- 生产模型质量的主观优劣：通过结构化/边界测试验证安全和可用性；数值阈值需独立评估后配置。
- 登录网关真实 HTTPS smoke：属于现存独立变更，本记忆系统测试不改变其 VERIFYING/PARTIAL 状态。
