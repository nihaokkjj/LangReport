# 本地解析隔离测试记录

- change-id：`CHG-2026-10-06-local-parse-isolation`
- 状态：`VERIFYING`，部分验证通过
- 创建时间：2026-10-06；更新时间：2026-10-07

立项依据为原修复 T10 的[测量记录](../2026-10-03-evidence-correctness-repair/test-report.md)。以下为授权后的实现测试，不是用户最终验收。

## 已执行

### 2026-10-07 提交前复验

当前完整 `node scripts/test-offline.mjs` 在隔离离线环境自然退出 0，其中 API 单元测试 55/55 通过；API 源码/测试、Web、Storage、Contracts 类型检查通过，`docs:check` 与 `git diff --check` 通过。直接 Prettier 检查受影响产品代码和变更文档通过；原始 evidence 脚本与测量 JSON 保持原字节。仓库 `format:check` 脚本在沙箱中启动 `git` 子进程时遇到 `spawnSync git EPERM`，直接 Prettier 检查不等同该脚本通过。定向 ESLint 在 `routes.ts`、API Console 与 Contracts 的未改动位置仍有 9 项既有错误，不声称这些文件全量 lint 通过。

G6 保持 `VERIFYING`：此前真实数据库/对象存储集成和五轮性能测量证据有效，但授权读取 p95 超限样本尚未解释。本次离线复验不替代真实集成，也不关闭 T10。

### 最新续验：生命周期、真实提交断连与性能波动

最终生命周期补验：独立角色复现`request.file()`之前未注册取消造成停机等待；两个上传入口现将包装提前至权限检查/读取文件之前，并在已停机时销毁传输。真实集成新增新建与更新请求均停在文件头前，和慢文件同时关闭服务，4/4通过；[独立修复复验](./evidence/prefile-independent-verification.md)确认两条路由及已停机后进入均通过，P2关闭。[发现记录](./evidence/lifecycle-independent-verification.md)保留。完整固定快照为738文件`g6-prefile-fixed`。

此次[五轮报告](./evidence/full-upload-1791292641084.json)中位2636.032ms、额外RSS最高265.469MiB、授权读取p95最大增量178.833ms，仍在门槛内但波动明显。慢请求的服务端耗时最高296.101ms，其中进入handler前185.180ms；同窗数据库监测查询约35.899ms，采样显示连接idle/ClientRead。仅能确认等待分布，不能据此解释前次一秒异常。补充五轮中位小于5秒的显式断言，并直接对已保存结果核算通过；不重复压力测试来筛选通过结果。

完整默认集成最终自然退出通过：API14/14、内嵌真实数据库失败态浏览器桌面/移动2/2、Worker2/2。旧主题断言改为实际规范中的系列颜色并保留SVG与历史主题快照验证。此前浏览器失败与旧`_theme`失败是历史执行结果，不再作为当前未通过项。API测试类型与定向lint、docs:check、diff检查通过。

最后扩大lint到整个routes.ts后仍有3项既有错误（未使用assertProjectThemeReference、两处any），不声称该文件全量lint通过；新取消模块与集成测试无lint报错。这三项不在本轮修改的上传路由代码中。

以下结果优先于本文件后面的历史待办。新增真实慢 multipart 测试先复现停机超过30秒：只取消文件管道不足以结束未发完的HTTP请求。`shutdownAbort`现同时关闭请求/响应传输；复测取消与服务关闭均释放单槽、清除临时目录且不创建资产，约0.92秒通过。

真实PostgreSQL代理在收到服务端`CommandComplete(COMMIT)`后丢弃确认并断开连接，接入返回提交结果未知；独立连接证实Snapshot已提交且版本为1，S3源与normalized均保留。约1.61秒通过。生产仓库操作通过`createIntakeRepository(database)`复用，没有业务故障开关。

一次续测性能失败已永久保留：[失败样本](./evidence/full-upload-p95-failure.json)。第4轮授权读取基线p95为72.663ms、上传期1091.533ms，增量1018.870ms超限；健康接口增量约0.478ms。该次不能判为通过，也不能仅据健康接口正常认定数据库是根因。

性能测试增加客户端绝对起始时间、服务器进入/鉴权前后及响应计时、独立连接每100ms采样数据库等待状态；不跳过任何权限或撤销检查。新增按时间命名的报告避免重跑覆盖证据。[诊断复测五轮](./evidence/full-upload-1791292378467.json)中位2471.737ms，额外RSS采样最高270.270MiB，健康/授权读取p95最大增量1.416/10.194ms；数据库采样查询最高27.096ms。本轮未复现旧波动，不据此关闭未解释回归。

`node scripts/test-integration.mjs --data-intake`最终4/4通过并自然退出（不可变快照并发、真实提交断连、慢上传/停机、五轮性能）。API测试类型检查及上述新增/修改代码定向ESLint通过。固定737文件快照为`g6-lifecycle-final`，等待限定独立复核。G6保持VERIFYING，原T10不关闭。

最终限定独立复核已归档：[报告](./evidence/independent-verification.md)、[脚本](./evidence/independent-check.mjs)。原文件按字节复制；其中相对快照路径以原报告目录`g6-cancel-repaired`为基准，完整父目录见handoff。最终g6-review-fixed取消/线程断言自然退出通过；未知COMMIT文案静态复核通过，真实DB断连未独立执行。当前验收矩阵见[acceptance](./acceptance.md)。

### 2026-10-06 最新续验（优先于下方历史环境限制）

Docker已恢复（28.5.2），使用项目test Compose启动54330 PostgreSQL和9002 MinIO。`node scripts/test-integration.mjs --data-intake`退出0：数据资产并发/历史快照集成与新增真实multipart性能集成2/2通过，脚本自动建立并清理独立schema/bucket；未连接生产服务。新性能用例已纳入该明确命令的测试发现范围。

[五轮完整上传原始结果](./evidence/full-upload-results.json)：100k×20，6,498,958字节CSV，真实HTTP上传→隔离解析→S3文件写入→DB发布全部返回201；每轮另从S3读取normalized并断言100000行与末行row-99999。预热一次完整上传后五轮耗时2531.83/2557.36/2613.16/2678.72/2411.48ms，中位2557.36ms。每20ms同时请求健康及需权限的资产列表，客户端在独立线程；基线客户端完全排空后才进入压力阶段。健康p95最高4.812ms、最大增量0.874ms；授权读取p95最高46.221ms、最大增量8.794ms，均低于200ms增量线，无错误样本。以10ms间隔采样API所在进程RSS，五轮额外峰值254.59–264.15MiB，低于512MiB；这是采样峰值，不宣称精确瞬时峰值，也不包含外部DB/MinIO进程。

[展开输入探针](./evidence/expanded-input-probe.mts)与[结果](./evidence/expanded-input-results.json)：1,452,487字节压缩Excel（5000×20、51.2MB重复文本）成功输出52,061,167字节normalized，约1.25秒；8MiB单元格因元信息预算明确返回DATA_PARSE_RESOURCE_LIMIT，约0.59秒。两次后续小输入都成功。该组进程总峰值547400KiB包含父进程构造工作簿和两个场景，不等同目标样本额外内存；不是穷尽所有压缩炸弹组合的证明。

发现Windows线程环境为空时tsx缓存落到项目`undefined/temp`；改为仅传TEMP/TMP指向本次解析目录并设TSX_DISABLE_CACHE=1，凭据不继承。新增环境断言通过，已核实并清理本次生成的7个缓存文件，复跑未重建错误目录。

补齐解析/序列化/源与normalized存储/发布/总耗时及失败阶段日志，内容仅阶段、数值、错误码；清理异常不会把已提交成功误报为失败，发出LOCAL_PARSE_CLEANUP_FAILED供运维排查。定向28项离线测试通过；独立复核提出的取消与提交未知文案修复后，相关19项再通过。API源码及测试类型、定向ESLint与docs:check通过。

完整默认集成命令另执行：API14项通过、真实失败状态界面桌面/移动2项通过；Worker2项中1项失败，位置`apps/generation-worker/test/integration/worker.integration.test.ts:308`，断言旧导出`_theme`对象但当前统一渲染规范无此字段。此项仍列原证据修复的回归欠项，不把G6定向2/2等同全仓集成通过。

独立复核已恢复：完整731文件快照g6-parser-integrated发现P2（完整请求体已收完、权限等待期间断开，包装器错过close）；内置真实HTTP复现证明request.aborted=false而reply.destroyed=true。修复后进入时检查reply.destroyed，并在run前throwIfAborted，g6-cancel-repaired快照复验called=false、AbortError。另发现未知COMMIT结果仍提示直接重试；已改为先查询资产/快照再决定重试，并增加精确文案回归。最终修复快照为g6-review-fixed；独立最终报告待归档，未以主代理测试代替全部独立验收。

- API全部52项离线单元通过，正常退出，无force-exit：auth/http-contracts/http-errors/data-assets/local-parse/intake-cancellation/openapi。命令：在apps/api运行`node --import tsx --test --experimental-test-isolation=none`并列出package.json中七个测试文件。先执行offline环境检查，DB/S3显式指向127.0.0.1:1，不访问真实服务。包括丢失COMMIT响应后不删已提交对象、慢存储期间保持单槽、上传文件路径、CSV/paste/JSON/Excel、取消/超时/退出故障、大小及元信息限额。
- API源码/测试、Storage、Web类型检查通过；新增解析及受影响Data Assets/Table Intake/Storage定向ESLint通过；新模块及核心API定向Prettier检查通过，涉及文件diff --check通过。
- Console新增场景桌面1440×900、移动390×844，2/2通过，说明可见且无横向溢出；使用模拟OpenAPI。命令：`pnpm exec playwright test test/e2e/api-console.spec.ts --grep 本地解析 --project chromium-desktop --project chromium-mobile`。
- [资源探针](./evidence/resource-probe.mts)、[结果](./evidence/resource-results.json)：100k×20成功约1.82秒，100万单列成功约1.80秒，200列成功；超过100万行/200列明确格式错误。100k×200、40,000,890字节输入在约13.14秒触发DATA_PARSE_RESOURCE_LIMIT，父进程存活且后续小输入成功。整轮进程峰值573236KiB包含压力场景，不能当成目标样本额外峰值，也不能证明操作系统级硬内存隔离。

## 五轮健康接口对照

[脚本](./evidence/api-profile-latency.mts)使用真实buildApp /health和固定Worker入口，每轮新进程，API侧预热原解析器；实际短生命周期Worker是冷启动。合成输入100k×20，完整解析、画像和JSON文件写入都在线程中。五轮父线程等待耗时：1817.23、1992.03、1939.17、2265.20、2040.65ms，中位1992.03ms；不能将该数称为预热Worker纯解析中位。

解析期间p95：2.1474、2.3621、1.9242、1.8901、1.7422ms；相对各轮基线增量均为负（-2.7084至-1.5392ms），属于测量噪声，不声称解析让API变快。HTTP错误均0，均返回100000行。原始：[第1轮](./evidence/api-profile-round-1.json)、[第2轮](./evidence/api-profile-round-2.json)、[第3轮](./evidence/api-profile-round-3.json)、[第4轮](./evidence/api-profile-round-4.json)、[第5轮](./evidence/api-profile-round-5.json)。未包含上传、授权只读接口、DB/S3，不是P3最终验收；目标额外内存五轮仍待测。

## 未通过与环境

Docker只读检查返回503 Service Unavailable，隔离测试端口54330/9002不可用，因此未运行真实集成，不换用生产/现用数据库。首版固定快照723文件位于`C:\Users\sai_8\.codex\visualizations\2026\10\03\01a100b7-383f-7873-84e2-beebc5f0634b\g6-parser-first`，只含T1初版；独立验证代理因用量上限失败，无复核结论，后续接入也尚未独立验证。初版19/20离线失败源于旧测试要求在提交结果不明时删除对象；更正安全行为并新增提交后丢响应夹具后最终52项通过。
