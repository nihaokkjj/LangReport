# T9 独立固定快照复核

- 角色：独立 Verification，只读产品快照；不批准范围或用户最终接受。
- 日期：2026-10-08。
- 基线：396fc2c93cdbd02ff6aeee40c01b504e583c527c（T8）。
- 快照：C:/Users/sai_8/.codex/visualizations/2026/10/08/01a119ef-072e-7071-a33c-83d3bb4e4931/t9-review-1。
- snapshot-manifest.txt SHA-256：3cb2bee8ab1575b001a324045e2853dff419637c1688ca4ecf094c4e6d5be12a。独立逐项计算 836 个文件 SHA-256，零失配。

## 结论

在本轮 T9/TP23 的实现范围内，未发现新增确定性 P1/P2 阻断。支持 owner 将该项技术验证记录为通过；不表示整体变更验收、生产升级完成、真实历史对象已经核验或用户最终接受。

## 复核证据

已读取 workspace agent-tasks/AGENTS.md 的 Verification 纪律、快照 AGENTS.md、manifest、CONTEXT、产品规格、change task/test-plan/acceptance/handoff，以及 t9-test-report.md、t9-operations.md；以主工作树只读 git show 查看 T8 基线，以冻结快照审查实现与测试。未修改产品/控制文件。

1. 0035 additive 增加 integrity_status/binding_version，旧值分别 default legacy_unverified/1；迁移没有 UPDATE 旧状态、发现、快照或输出引用。v2 局部唯一与触发器检查 Revision、Artifact、Job、Snapshot、Project、Conversation 及冻结 Brief/Metric，不对旧重复强加全局唯一。publication.ts 当前原子发布显式 verified/v2；旧记录不会因为齐备元数据自动升级。
2. packages/chart/src/index.ts 的 freezeDerivedProvenance 拒绝 legacy_unverified（409），真实 edit/copy/rollback 命令及提交/批准就绪门沿用该规则。旧 Approved 读取/导出不因分类被降级。Web Evidence/Review 提示历史未验证，派生/提交/批准入口禁用；原状态 Chip 保留。合同/Console 同步分类与维护错误说明。
3. 生命周期写入触发器覆盖 Job/Artifact/Revision/Evidence/Review 增改删，控制单例共享锁使切换等待已经进入的生命周期事务；主 DB 连接设置同版本 application_name。CLI 要求显式连接及 schema，audit 使用 READ ONLY 并声明 objectBytesVerified=false；恢复只更新 mode，保留列、记录和对象。
4. sendLifecycleError 遍历有界 Error cause，仅识别 PostgreSQL 55000 与精确维护标识，不将任意错误文本当维护错误；全局、chart 和 data 异常路径均接入。定向测试覆盖包装 cause、稳定503、敏感SQL/键不外泄。
5. verify-evidence-lifecycle.mjs 在0035前构造独立旧库重复/混合/缺来源/Approved夹具，比较迁移前后旧 Revision/Evidence/Snapshot JSON/hash（排除新增列）；savepoint 验证新混合、v1→verified、重复、旧 writer 和维护拒绝。t9-lifecycle.ts 使用真实 API/MinIO 的四输出比较，维护期间只读历史，验证503与恢复；该夹具中的临时分类切换不是产品旧记录提升入口。

## 验证方式与范围

本角色独立执行了固定快照836文件哈希核验；未独立重跑 DB、API、Worker、浏览器、离线套件或类型检查。以下是对 owner 固定日志和对应测试代码的交叉核验，不等于独立执行测试：

- evidence/t9-migrations-complete.txt：TP23历史迁移断言及 CLI audit→set-read-only→audit→resume-v2 均有成功记录。
- evidence/t9-integration-repaired.txt：API14、预算失败浏览器2、Worker2，fail0；第564行记录实际四输出 SHA-256 比较与维护恢复成功。
- evidence/t9-browser-repaired.txt：四宽度8 passed；对应测试覆盖历史 Approved 提示/禁用/横向溢出及Console文本。
- evidence/t9-offline-final.txt：API56 pass、fail0；t9-typecheck-repair.txt 记录源码/测试类型完成。
- 初轮迁移、集成、浏览器与类型失败日志保留，报告区分失败原因及后续修复。

## 限制与未覆盖

历史审计仅为元数据分类，不核验历史对象实际存在/字节；未授权运行真实旧库或生产。application_name 可由数据库调用者设置，是兼容防错而非权限/认证。生命周期维护并非整站只读，也不能阻止已经开始的事务外 S3 PUT；操作手册明确先阻断入口并排空旧 API/Worker，不承诺在线混跑。SQL触发器不是所有历史完整性事实的独立证明，审核门仍实时验证成功Job、来源与输出。

T11既有全仓质量问题及T10/T12不属于本项关闭范围。最终 task/acceptance/handoff 在快照仍为实现/待复核状态，需 owner 记录本报告结果和最终提交。未验证部署或推送，未进行任何生产操作。

视觉证据补充限制：owner 告知快照内 t9-legacy-approved-390.png 是 viewport 截图，未充分呈现历史提示；本角色不据该手机图片证明提示实际可视。四宽度测试的 DOM 断言与截图可视证据需区别，后续补录图片不在本固定快照复核范围。

## 快照外视觉补录复核

2026-10-08 只读查看主工作树 evidence/t9-visible-legacy-390.png 与 t9-visible-legacy-1440.png：两图均实际呈现绿色“已批准”状态与完整历史未验证 Alert。手机警告正常折行，内容在390宽度内完整可读；桌面警告全文可读，二者提示均未被固定 composer 遮挡。t9-visual-capture.txt 记录1440/1024/760/390四宽补录4/4通过。未独立执行补录测试；此处仅直接视觉核验390/1440两图，不对未查看的1024/760图片作视觉结论。

补录属于原manifest快照外的额外视觉证据，不改变836文件固定源码审查结论，也不替代原正式测试。原手机viewport截图不能证明提示可视的限制仍保留为证据历史，新图补足该视觉证据缺口。
