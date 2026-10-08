# 修复方案交接

- change-id：`CHG-2026-10-03-evidence-correctness-repair`
- 状态：`IMPLEMENTING`（A 批部分实施，未验收）
- 创建时间：2026-10-03
- 更新时间：2026-10-08

## 最新续做状态（优先于下方历史段落）

2026-10-08 用户要求推送并继续下一项，T8 396fc2c已推送并核对origin/main；T9现按TP23技术验收通过。0035 additive保守标记legacy_unverified、旧Approved与内容/对象不变，新发布verified/v2及局部唯一/固定来源约束、只读分类和维护恢复CLI落地。真实隔离迁移旧库与空库、API→两类Worker→MinIO四输出SHA-256保留、维护503与恢复通过；完整集成自然退出0（API14/浏览器2/Worker2）、四屏宽8/8与补录4/4、离线API56、类型/定向质量通过。独立836文件固定快照无新增确定性P1/P2，未独立重跑；补录手机/桌面图片直接复核可读。[T9完整报告](./t9-test-report.md)和[操作手册](./t9-operations.md)保留全部失败/修复与上线排空前提。下一项T10：读取G6解析隔离报告，解释历史轻API p95异常并按TP21复验，不重复宣布预算达标；之后T11全仓基线及T12完整闭环。T9仅本地提交，不继续自动推送/部署；保留next-env.d.ts和runtime-experiment。
2026-10-08 T7已按用户指令推送origin/main并核对3c78c99；随后T8技术验收通过。工作台copy/rollback/历史目标、旧201与新202/200兼容、scoped Job ID刷新恢复、固定Evidence结果、项目/对话切换同步取消已接通。TP07/TP08真实API→两类Worker→PostgreSQL/MinIO通过：Approved源不变、派生新身份/新编号/parent、head与published及四导出/HTML元数据一致；HTML缺Artifact身份的实测问题已修复且旧字节不变。TP22四屏宽加核心导出/编辑/Console20/20，离线回归及相关类型/定向格式lint通过；最终完整串行隔离集成自然退出0（API14/真实预算失败浏览器2/Worker2）。[完整T8记录](./t8-test-report.md)保留所有失败证据和验证范围。首次独立复核P2是同Project切Conversation仍观察旧Job，已同步abort/清状态并补持有旧status回归；第二787文件快照复核无新增确定性阻断，未独立重跑。下一项T9历史分类/迁移/回滚演练，未执行。整体IMPLEMENTING，T11全仓遗留与T12真实端到端仍未关闭。T8仅本地提交，不再次推送/部署；原next-env.d.ts与runtime-experiment保留。

2026-10-08 T7 技术验收通过，实现提交 `251cb4c`，TP10/TP11/TP15 的真实 API→隔离 PostgreSQL/MinIO 断言全部通过；最终完整集成自然退出0（API14/浏览器2/Worker2），离线集与API Console四屏宽20/20通过。审核按固定Revision核验完整来源、成功Job、两层校验与四输出长度/SHA-256；失败409/503不写业务状态。批准旧版本不回退head、不改其他Evidence，published变化独立审计。历史查询revisionId、Viewer过滤、并发批准、非法迁移、401/403/404与跨Project拒绝均通过。独立静态复核未见阻断，未独立重跑。既有routes lint、boundaries和hygiene保留，详见acceptance；不称全仓门禁通过。用户已授权本轮提交，不推送或部署。下一步T8，整体仍IMPLEMENTING；next-env.d.ts和runtime-experiment保留。

2026-10-08 T6 技术验收通过：编辑、复制、回滚通过持久 Generation Job 和带租约 fencing 的单事务发布；六个同 Artifact 的三个编辑与三个回滚 Job 经真实 API、两类 Worker、PostgreSQL/MinIO 并发反序发布，编号唯一，head 指向最高成功编号，每 Job 恰一 Revision/Evidence/审计/回复。复制/回滚在第三个对象 PUT 失败后无业务半成品，真实 API retry 唯一发布；同键并发三操作不留孤立 Conversation；PUT 已写入但回执丢失、既有 COMMIT 回执丢失、候选对账和提交前失租均有对应测试。最终完整隔离集成 API14/真实浏览器2/Worker2 自然退出 0，API Console 四屏宽16/16、相关类型、定向格式/lint、docs 通过。独立只读复核未发现确定性 P1/P2，未独立重跑；其建议的复制/回滚审计/回复断言已补并复核。完整变更仍为 IMPLEMENTING，下一任务为 T7 Evidence 固定绑定与审核就绪门；T8 的工作台交互接通仍待做。自然租约等待/自动轮询未实测。原有 `apps/web/next-env.d.ts` 差异不纳入提交。下方“不通过”均为历史时点。

2026-10-08 T6 六完整并发编辑 Job 限定结果：同一 Artifact 的六个真实 API 编辑 Job 经两类 Worker 并行处理，发布前屏障让五个较高编号竞争提交、最低编号最后完成；真实隔离 PostgreSQL/MinIO 中全部成功，编号唯一且不重用，head 保持最高成功编号，每 Job 恰一 Revision/Evidence/审计/回复，四对象可读，重复处理不增 Revision。完整隔离集成 API14/浏览器2/Worker2 自然退出 0。回滚仍同步绕过 Job，TP12 编辑/回滚混合场景未覆盖，T6 不标通过。

2026-10-08 T6 独立进程发布前崩溃限定结果：真实隔离 API→Generation Worker 编辑 Job 后，子进程 Render Worker 写完、读回四个 MinIO 候选并保存 `validated` 清单，在发布回调入口经 IPC 标记后以 86 直接退出。父进程确认无目标 Revision/Evidence/审计/回复、head 不变、四对象可读且账本保留；隔离库推进租约截止并执行生产恢复后，新 Worker 以更高 fencing 和新键唯一发布，重跑同 Job 幂等。完整隔离集成 API14/浏览器2/Worker2 自然退出 0；定向类型、lint、格式通过。仍缺 TP12 六完整并发编辑/回滚及复制/回滚 Job 化；MinIO 已接收字节而 PUT 回执丢失未模拟，T6 未验收。

2026-10-07 T6 TP13 六处故障矩阵限定结果：四种对象按第 1–4 次 PUT 注入失败，PostgreSQL 约束分别阻断目标 Artifact head 更新和新 Revision 审计插入；每例在真实隔离 PostgreSQL/MinIO 中验证无可见半成品，账本保存已写候选，API retry 复用预留 Revision 身份并唯一发布，再次处理同 Job 无重复 Revision/Evidence/审计/回复。补充底层 PostgreSQL `23514` 与约束名断言后的最终完整集成 API14/浏览器2/Worker2 自然退出 0；独立只读复核未见新增确定性 P1/P2，未独立重跑。独立子进程写后、提交前崩溃与 TP12 六完整并发编辑/回滚仍缺，复制/回滚尚未 Job 化，T6 不标通过。

2026-10-07 T6 逐次候选对象账本/对账限定结果：0034 迁移记录首个 S3 PUT 前的四个计划键、尝试 UUID、预留 Revision 和 fencing token；验证清单与 Job 同事务保存，业务发布同事务标记 `published`。Render Worker 轮询执行有界清理：PostgreSQL 时间判断 24 小时保留期及有效租约，核对键归属和所有 Revision 引用，删除失败隔离并一分钟后重试，已删除行每天重扫迟到写入。真实隔离 PostgreSQL/MinIO 测试覆盖首写中断、API 重试、有效租约保护、删除失败重试、迟到 PUT 再清理和已发布对象保护；完整集成 API14/浏览器2/Worker2 自然退出 0。独立只读复核最初两项 P2 已修正，最终未见新增确定性 P1/P2，未独立重跑。T6 仍缺六完整编辑/回滚并发及 TP13 其余阶段故障；复制/回滚仍绕过持久 Job。`apps/web/next-env.d.ts` 既有差异未纳入本轮。

2026-10-07 T6 TP14 提交前失租限定补验：真实数据库中 A 写完四候选后、发布前使租约截止并恢复；A 被 fencing 拒绝。B 取得更高 token、以新尝试键重新渲染并唯一发布；A 迟到完成/失败写入均不能修改 B，旧候选字节不变。成功 Job 的幂等分支现校验候选清单和输出键，避免旧尝试认领新结果。完整隔离集成 API14/浏览器2/Worker2 自然退出 0。逐次候选账本/对账、六完整编辑/回滚并发及 TP13 其他故障仍待补，T6 未验收。

2026-10-07 T6 TP09 限定补验：真实隔离 PostgreSQL 代理在完成事务 `CommandComplete(COMMIT)` 后丢回执，Render Worker 从直连 Job/Revision 查明已成功；四个被引用 MinIO 对象可读，同 Job 再处理不重复 Revision/Evidence/审计/回复。完整集成 API14/浏览器2/Worker2 自然退出 0。仅覆盖新编辑的发布事务，逐次候选账本/对账、TP12 六并发、TP14 提交前接管和复制/回滚 Job 化仍待完成，T6 保持 IMPLEMENTING。

2026-10-07 T6 先完成新生成/编辑的单事务业务发布：Render Worker 把候选四输出交给 `commitCompletedRevision`，事务按 Job→Artifact 锁序核对租约、身份、冻结输入、清单与双层校验，然后一次写 Revision、独立 Evidence、单调 head、审计、回复和 Job 成功。真实 Evidence 插入故障会全部回滚，真实 API 重试成功；原 Evidence 绑定保持不变。旧的半成品恢复写入路径已删除，异常旧 Job 只失败且不改既有 Revision。移除恢复路径后的默认隔离集成最终 API14/浏览器2/Worker2 自然退出 0。独立只读复核固定快照未发现本轮原子路径的确定性 P1/P2，未独立重跑测试。逐次候选账本、COMMIT 丢失故障注入、提交前接管、复制/回滚 Job 化尚待做，T6 未验收。

2026-10-07 T6 正式验收未通过：固定 HEAD `5b100b3` 的默认隔离集成 API14/浏览器2/Worker2 均通过，但 TP09/TP12–TP14 的 COMMIT 未知结果、六个完整编辑/回滚、事务故障全回滚、提交前失租和候选对账未覆盖。独立只读审计确认业务完成步骤跨事务、旧 Evidence 可被改绑、恢复 HTML 指针先于旧对象校验更新，故不能把正常路径通过等同 T6 验收。判定及修复顺序见 acceptance 和 evidence/t6-acceptance-readonly；下一轮先实现带租约 fencing 的单事务业务提交与 insert-only Evidence，随后处理恢复/未知提交/候选对账并复验。任务保持 IMPLEMENTING。

2026-10-07 T6 候选输出清单限定结果：0033 迁移保存 Job 候选清单，新渲染先写并读回四对象、核对字节/哈希后才创建 Revision；HTML 使用预留版本身份，输出键包含目标与执行尝试身份及内容哈希前缀。真实数据库/MinIO 失配注入证明失败时无新 Revision，API 重试可恢复；最终完整集成 API14/浏览器2/Worker2 通过。已有 Revision 恢复以新键重写 HTML，旧 PNG/SVG/Vega 与已有清单的键、哈希、字节数比较；篡改 PNG 被拒绝。独立只读复核最终固定快照无新 P1/P2，详见 test-report；复核未独立重跑集成。历史无清单的恢复仅能证明旧对象可读。T6 原子发布、业务写入 fencing、候选对账仍待做；恢复路径在核对旧对象前更新 HTML 引用的非原子窗口仍待修复。

2026-10-07 T6 历史计数器补验：0032 前插入保留 Artifact 的 Revision R4 与空 Artifact，完整迁移后编号计数器分别为 5 与 1；`db:verify` 通过。产品业务代码未变，原子发布、业务写入 fencing、输出清单、孤儿对账仍待完成。下方“历史非空库迁移回填夹具未完成”是补验前状态。

2026-10-07 T6 第二个限定结果：0032 迁移回填 Artifact 单调编号计数器，Job 冻结候选 Artifact/Revision 身份；Render Worker 预留后写入包含目标 Revision UUID 和随机尝试标识的对象键，Chart 落库使用预留身份。直接派生路径也通过 Artifact 行锁分配编号，低编号晚完成不回退 head。隔离真实集成最终 API14/浏览器2/Worker2 全过；新增并发预留、故障重试复用、旧租约拒绝、两种行锁等待超期拒绝与反序落库 head 断言。独立只读复核最终限定通过，详见 test-report。历史非空库迁移回填夹具、候选输出清单、Revision/Evidence/Job 原子完成、旧 Worker 的业务写入 fencing 与孤儿对账仍未完成，T6 保持部分实施。`apps/web/next-env.d.ts` 原有生成差异继续保留、不纳入提交。

2026-10-07 T6 先完成候选对象键隔离：新渲染的四种输出使用同一独立尝试标识；已有 Revision 恢复时 HTML 改写入新键。真实数据库/MinIO 用例分别覆盖创建 Revision 前和 HTML 已写入、Revision 已创建后的故障，真实 API 重试均成功；后者沿用 Revision ID，旧 HTML 键内容不变。默认集成 API14/浏览器2/Worker2 自然退出。独立只读复核发现并推动修正恢复分支的旧键覆写，最终复验见 test-report。此项未覆盖候选对账、版本预留、事务内原子提交和数据库 fencing；T6 未验收，下一步实现预留与事务完成路径。

2026-10-07 T5 补充真实 Worker 输出写入异常与 API 重试：首次对象写入前注入暂时故障，Job 持久化 `failed/RENDER_FAILED` 且不产生 Revision；真实 retry 接口重排同一 Job，随后 Generation/Render Worker 成功生成唯一 Revision，Evidence/HTML 仍使用入队冻结 finding。完整隔离集成 API14/Worker2/预算失败浏览器2 均通过且自然退出。注入的是对象写入故障，未实际关闭 MinIO。首轮测试还复现旧 Revision 的 Evidence 被后继 Revision 改绑，导致该旧版本再次编辑返回 409；列为 T7 待修，不关闭 T6/T7。T5 实现及限定集成验证通过，整体任务仍 IMPLEMENTING；下一步推进 T6 原子发布，保留共享 G6 修改。

2026-10-07 T5逻辑编辑测试已从直接构造Job改为真实API入队，并在隔离PostgreSQL/MinIO走通Generation Worker、Render Worker、新Revision/Evidence；同键复用、不同输入冲突、缺Brief拒绝且不入队均通过。完整默认集成API14+浏览器2+Worker2自然退出；Worker测试类型、格式、lint通过。真实临时故障后的重试尚未验证，T5不标全部完成。下方旧段落为当时状态。

T5本轮独立复核已归档evidence/t5-finding-independent.md，未发现新增缺陷；finding冻结修复及限定复验完成。验证边界：视觉编辑从真实API进入，逻辑编辑是直接构造Job的Worker集成；完整逻辑API和真实失败重试仍未验证。不自动关闭整项T5或原项目，下一步可补上述两项后进入T6。

2026-10-06继续T5：在65722ec之后补视觉编辑finding入队冻结，来源随后修改不会影响既有任务，HTML与Evidence一致；逻辑编辑重算统计/血缘/发现。Chart7、默认集成API14+浏览器2+Worker2、Console2项通过；相关类型与定向lint通过。固定t5-edit-finding快照等待独立复核。T6/T7的原子发布/固定Evidence绑定未在本轮实现，G6/T10性能异常未关闭。当前代码未提交、推送或部署，保留共享G6工作树。

以下为2026-10-06较早的历史交接，后续结果以上方记录和test-report为准。当时HEAD为57a037c，保留已有未提交修改。资源策略已确定为最多10,000绘图结果、超限提示聚合，源输入100,000行目标不变，不再重复询问。T2/T3当时尚未验收，T5来源继承/公开记忆过滤/纯视觉复用部分实施，T6–T9未完成。

最新Chart6/data-engine19项通过（进程内原生TypeScript加载器，未用force-exit）；画像预热五轮中位：10k/20k/40k单列27.68/26.58/52.37ms，100k×20为1426.82ms，总峰值约320.6MiB。并发健康接口探针p95增量1173.79ms，超过200ms预算，T10未通过；探针不含完整上传/DB/S3。[G6方案](../2026-10-06-local-parse-isolation/proposal.md)已成稿待审，建议有界线程解析、结果文件流式交接，维持本地同步成功合同。未经新授权不实现G6；可继续原已授权T5。具体原始证据见test-report。

## 当前状态与授权

原文档阶段要求“先不要修改代码”。用户后续“jixu执行该任务”和“l继续”授权继续既有任务；A 批已进入实施，B/C 批未启动。没有提交、推送、部署或生产数据操作授权。

原 LANGREPORT-2026-09-30-lark-table-agent 仍是 VERIFYING；其完整控制文件保存在 [交接快照](../../../../agent-tasks/archive/LANGREPORT-2026-09-30-lark-table-agent-20261003-repair-docs-handoff.md)，不表示原任务验收或关闭。UI、记忆和登录验收继续沿原记录。

## 工作树与修改范围

产品路径 `D:\front\newProject\LangReport`，HEAD `1e279bc63d8300e31b839c4c45b33fdbfae0cbc4`。原有未提交/未跟踪改动覆盖飞书、UI、记忆等；实施时必须重读 git status 和原变更，不能整树清理或只检出 HEAD 丢失这些代码。

本轮实施修改 data-engine、执行快照合同、新 Job 冻结与 Worker 版本传递、上传快照内部元数据、API Console 生成场景校验及相关测试。没有修改数据库迁移或产品依赖，没有 Git commit/push。

实施前完整混合工作树：`C:\Users\sai_8\.codex\visualizations\2026\10\03\01a100b7-383f-7873-84e2-beebc5f0634b\repair-baseline`，658 个文件及哈希、tracked.patch、status.txt。独立只读复核使用同级 `repair-data-review` 快照；此快照早于 ISO 兼容修正，不能当作最终实施快照。

## 已完成与待完成

- 已实施：CSV/粘贴位置列映射、保守类型推断、超宽行拒绝；v2 排序/周期索引、重复周期拒绝、数值非法值拒绝、缺期/零基数警告；新 Job 冻结 v2，历史缺版本保持 v1。
- T1 部分完成：数据六项原始失败回归已转绿；渲染三项回归仍失败，保留失败证据。
- T2 未通过：Flint 默认隐式截断及完整高基数图形资源问题见 [实验记录](./rendering-experiment.md)；T3 未开始。
- T4 已补完整粒度：v2 计划聚合前逐行归一化日/月/季度/年；新增 periodUnit 明确日历偏移，未声明单位保持原月偏移兼容。JSON/XLSX 冲突列和合成飞书 typed-table 对照已通过；独立复核发现的样例遗漏与日内归组问题已修正并复验通过。最终全链路验收仍未执行。
- API Console 已增加新 Job 的 v2 冻结校验，尚未在真实浏览器执行该场景。类型通过不等于浏览器场景通过。
- 先前 API/Worker 包级测试未退出的问题已定位为缺少仓库离线环境；按 scripts/test-offline.mjs 环境重跑受影响五包，118 项全部通过并正常退出。细节与原始结果见 test-report。

## 下一会话

当前待决：T2五轮十万行测试峰值最高约1.10GB、Line中位11.22秒；已向用户询问保留十万绘图结果加隔离控制，或最多一万绘图结果并要求确认聚合。没有答案前不冻结阈值、不接入T3。安全守卫八类拒绝与柱形场景图验证通过，但只属隔离实验。最新六包离线136项通过；定向lint四项为基线已有未使用代码问题，仍未通过，不改检查器隐藏。

先读根 AGENTS、CONTEXT、产品规格、Loop 规范、manifest、agent-tasks/current-task，再读本目录 proposal/design/task/test-plan。继续 A 批不需要再次索取实施授权；完成 T2 的非截断配置、安全 loader、字体/交互/资源预算证据。不得直接更换产品运行时并跳过 T2 门禁。最新 T4 只读快照为基线同级 repair-t4-calendar-final（665文件），独立角色纯函数断言退出0；最新 data-engine18/generation27项及三包源码/测试类型检查通过。

任何 UI 实施前读取完整 DESIGN.md；接口改动必须同步 API Console；私有记忆不因本次来源继承扩大范围。独立验证必须使用冻结快照，按项目规则在实施后启用。
