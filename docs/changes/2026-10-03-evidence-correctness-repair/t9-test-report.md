# T9 历史分类、迁移与回滚演练

- change-id：`CHG-2026-10-03-evidence-correctness-repair`
- 状态：T9 技术验收通过；整体仍 `IMPLEMENTING`
- 日期：2026-10-08
- 基线：T8 `396fc2c93cdbd02ff6aeee40c01b504e583c527c`，已按用户指令推送并核对 origin/main

## 实现与 TP23 范围

0035 additive 增加历史完整性标记、v2 Evidence 局部唯一与固定来源约束、只读审计视图和生命周期维护单例。旧数据一律保守标记 legacy_unverified，不依据数据库字段自动提升；原 Approved 状态、正文、快照及输出引用保留，新审核/派生拒绝。当前原子发布显式 verified/v2，审核入口仍实时核验对象。Web 并列显示 Approved 与未验证状态，禁用编辑/复制/回滚/提交；API Console 与 OpenAPI 同步说明分类和维护错误。

维护触发器拒绝生命周期表增改删及旧连接版本；版本标记是防错机制，不是身份权限。CLI 显式指定环境，audit 使用 READ ONLY 事务，set-read-only/resume-v2 可逆且不删列/记录/对象。生产排空、备份、迁移前审计、升级与恢复顺序见 [操作手册](./t9-operations.md)。没有进行生产部署、真实旧库重验或对象清理。

## 已执行验证

| 场景                                                                                                                                         | 命令与结果                                                                                             | 证据                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 旧库迁移、重复/混合/缺来源/Approved 分类，保留 Revision/Evidence/Snapshot；新绑定/重复拒绝，旧版本写入拒绝；CLI audit→read-only→audit→resume | 显式隔离 DATABASE_URL + `node packages/db/scripts/verify-migrations.mjs`，退出 0，临时 schema 最终删除 | [迁移最终记录](./evidence/t9-migrations-complete.txt)    |
| 空库 additive 初始化、真实 API/两类 Worker/MinIO，旧 Approved 四输出哈希保留、维护 503、恢复写入及 T6–T8 回归                                | `node scripts/test-integration.mjs`，自然退出 0；API14/真实预算失败浏览器2/Worker2                     | [集成修复后记录](./evidence/t9-integration-repaired.txt) |
| 历史 Approved 与未验证提示、派生禁用、无横向溢出、Console 新错误说明                                                                         | Playwright consulting-report + api-console，grep `T9                                                   | 固定历史证据`；1440/1024/760/390，共 8/8，退出 0         | [浏览器修复后记录](./evidence/t9-browser-repaired.txt)；同目录 t9-legacy-approved 四屏宽截图 |
| 包装数据库 cause 映射，只识别 55000，隐藏 SQL/客户键                                                                                         | 定向 http-errors 测试 3/3，退出 0                                                                      | [错误路径定向记录](./evidence/t9-errors-focused.txt)     |
| HTTP 合同注册                                                                                                                                | 定向 http-contracts 测试 5/5，退出 0                                                                   | [合同记录](./evidence/t9-contracts-focused.txt)          |
| 全仓源码及测试类型                                                                                                                           | `pnpm typecheck`，退出 0                                                                               | [类型修复后记录](./evidence/t9-typecheck-repair.txt)     |
| 完整离线回归                                                                                                                                 | `node scripts/test-offline.mjs`，自然退出 0，API56（新增维护错误回归）                                 | [最终离线记录](./evidence/t9-offline-final.txt)          |

四输出 SHA-256 实际值见集成日志 `T9 TP23 actual API/MinIO` 行，比较的是同一次运行前后，跨次合成记录会生成不同身份。数据库历史 JSON/SHA-256 排除本次新增列，保留原全部字段；不是宣称整行增加列后序列化字节仍相同。

## 失败与修复过程

1. 初始/第二迁移夹具分别被早期0021清理、复用早期ID破坏旧断言；改为0035前新建独立旧版夹具，不改变0021历史验收断言。失败日志 `t9-migrations-initial.txt`、`t9-migrations-second.txt` 保留，后续最终脚本通过。
2. 首轮集成把 outputObjects 的 rendererVersion/flintVersion 当成对象键，出现 NoSuchKey；修为明确四格式哈希。`t9-integration-initial.txt` 保留。
3. 第二轮实测维护命令返回500而非503：chart-routes 自己捕获未知数据库异常，绕过全局映射。统一 http-errors helper，校验55000与完整cause后供全局、chart及data错误路径使用；补稳定响应与不泄露回归。`t9-integration-final.txt` 保留，修复后完整集成通过。
4. 默认沙箱禁止 pnpm 子进程，初次类型检查EPERM；获自动审批后正常通过。`t9-typecheck-initial.txt` 保留。
5. 补录截图时无条件点击移动端关闭历史按钮，关闭状态下按钮不在屏幕内，两个宽度超时；改为仅 left-open 时点击并滚动到警告，最终8/8。`t9-browser-final.txt` 保留。
6. 直接 package API test 加载开发.env，完成auth文件后进程未退出，不能算整套通过。已仅停止本轮定位的测试进程树，改用官方离线入口隔离环境并自然通过；`t9-api-unit-final.txt` 保留这一不完整运行，不作通过证据。未操作生产环境。

## 独立复核与限制

[独立复核](./evidence/t9-independent.md)核验固定836文件快照，全部哈希匹配，未发现新增确定性P1/P2；未独立重跑全套。manifest SHA-256为 `3cb2bee8ab1575b001a324045e2853dff419637c1688ca4ecf094c4e6d5be12a`，记录见 [manifest](./evidence/t9-snapshot-manifest.txt)。快照外补录采用同一冻结createFixture，临时浏览器用 `scrollIntoView({block:'center'})` 后等300ms再截图，四宽4/4；临时夹具已删除，没有改正式测试或产品代码。[补录日志](./evidence/t9-visual-capture.txt)记录实际滚动位置；同目录 `t9-visible-legacy-*` 与 `t9-legacy-alert-*` 是补录图片。owner检查四宽渲染，独立角色直接检查390/1440并确认Approved与警告并列可读；补录不冒充固定源码快照内证据。

最终format检查、Web类型、定向ESLint、docs检查通过。root lint仍为既有routes三项（未使用导入、两处any），[完整lint记录](./evidence/t9-lint-final.txt)保留；[定向lint](./evidence/t9-targeted-lint.txt)排除该文件及用户保留next-env后退出0，没有放宽检查器。早期T7/T8记录的boundaries/hygiene遗留由T11处理，不称本轮全仓check通过。日志有行尾空白时原字节压缩保存为同名.txt.gz，再只清理可读.txt行尾空白以通过diff检查，内容/失败事实保留。

生命周期只读覆盖 Job/Artifact/Revision/Evidence/Review，不等同整站数据库只读；必须先阻断入口并排空在途 Worker，对象存储事务外写入仍遵守T6账本和对账限制。历史审计只读元数据，objectBytesVerified=false，不能替代获授权后的真实历史对象核验。

整体变更仍 IMPLEMENTING。T10资源预算异常解释、T11全仓质量基线和T12完整端到端/最终人工接受尚未关闭。本轮保留 next-env.d.ts 和 runtime-experiment，不部署；T9仅本地提交。
