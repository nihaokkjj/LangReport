# 文档与实施检查记录

- change-id：`CHG-2026-10-03-evidence-correctness-repair`
- 状态：`IMPLEMENTING`，部分验证
- 创建时间：2026-10-03
- 更新时间：2026-10-07
- 业务测试状态：`PARTIAL`；下方保留原文档阶段结果，不代表当前未修改代码。
- 执行角色：owner 自测；独立角色完成一次冻结快照的只读代码复核，未完成最终独立测试。

## A 批实施验证（新增）

### 2026-10-07 T6 执行尝试隔离候选对象

Render Worker 对新渲染使用独立随机执行标识，为 Vega-Lite、SVG、PNG、HTML 生成同组候选对象键；已有 Revision 的恢复只重写 HTML，改用新的候选 HTML 键。真实隔离集成先在写入候选 Vega-Lite 后使第二次写入失败，确认 Job 失败、无新 Revision；真实 API 重试后成功且新 Revision 未引用旧候选键。独立只读复核发现已有 Revision 的恢复分支仍覆写旧 HTML 键，随后修正并新增第二场景：HTML 对象写入成功后注入故障，保留已创建 Revision，真实 API 重试进入恢复分支；Revision ID 不变，最终 HTML 键不同，旧键内容保持不变。完整 `node scripts/test-integration.mjs` 再次自然退出 0：API 14/14、Generation Worker 2/2、真实预算失败浏览器桌面/移动 2/2。Render Worker 源码、Generation Worker 测试类型检查、两文件定向 ESLint、Prettier 与 `git diff --check` 通过。

这是 T6 候选对象隔离的限定结果。[独立只读复核](./evidence/t6-attempt-independent.md)记录了旧 HTML 键覆写发现、修复与最终限定结论。失败候选的对账清理、目标 Revision 预留、内容哈希清单、事务内 Revision/Evidence/head/Job 一起完成以及迟到 Worker 的数据库写入 fencing 仍待实施；本用例没有模拟 A/B 同时持有不同租约，不代表 TP09/TP12–TP14 验收。

### 2026-10-07 T5 临时输出故障与 API 重试

在隔离 PostgreSQL/MinIO 的真实编辑链路中，先经 Fastify API 创建视觉编辑 Job，入队后修改来源 Evidence 的 finding，再运行 Generation Worker。Render Worker 在首次写对象前注入一次暂时性写入异常，Job 持久化为 `failed/RENDER_FAILED`，错误信息可查，且没有产生 Revision。随后调用真实 `POST /generation-jobs/:jobId/retry`，同一 Job 回到 `queued`；两类 Worker 再次执行后，Job 成功且仅有一个新 Revision，Evidence 与 HTML 保留入队时冻结的 finding，私有偏好正文未进入 Revision。注入异常验证的是对象写入失败处理，未实际中断 MinIO 服务。

首轮完整集成测试在基于更早 Revision 发起第二次编辑时得到 `409 REVISION_PROVENANCE_INCOMPLETE`：现有 Evidence 持久化会把该行的 `chartRevisionId` 改指新 Revision，旧 Revision 随即缺失 Evidence。这是 T7 固定绑定的待修缺陷，不因本轮重试用例通过而关闭。用例改为基于当前仍具完整 Evidence 的视觉编辑 Revision，覆盖 T5 重试路径；第二轮完整 `node scripts/test-integration.mjs` 自然退出 0，API 14/14、Generation Worker 2/2、真实预算失败浏览器桌面/移动 2/2。该结果不代表 T6 原子发布或 T7 历史 Evidence 不可变验收。

### 2026-10-07 T5 逻辑编辑 API 链路补验

将逻辑编辑集成测试从直接插入 `generationJobs` 改为真实 Fastify `POST /chart-artifacts/:id/revisions` 入队。相同输入与幂等键复用同一个 Job，不同编辑输入复用该键返回 `409 IDEMPOTENCY_CONFLICT`。入队 Job 的 Brief、Metric 和执行来源与源 Revision 一致；Generation Worker 重新执行筛选/聚合，Render Worker 写入新 Revision/Evidence，统计、字段血缘和发现与逻辑编辑结果一致。源 Revision 缺 Brief 时，真实 API 返回 `409 REVISION_PROVENANCE_INCOMPLETE` 且不创建 Job。

完整 `node scripts/test-integration.mjs` 使用隔离 PostgreSQL/MinIO 运行并退出 0：API 14/14、Generation Worker 2/2，内嵌真实预算失败浏览器桌面/移动 2/2；Generation Worker 测试类型、Prettier、定向 ESLint 退出 0。逻辑编辑的 HTTP→两类 Worker→DB/S3 已覆盖。**真实临时故障后的重试仍未验证**；既有“成功后手动改写失败状态再运行 Worker”的用例只能证明已存在 Revision 的重入，不等于真实故障注入。

### 2026-10-06 T5 编辑来源与发现补验

限定[独立复核](./evidence/t5-finding-independent.md)已完成，无新增缺陷；[复现脚本](./evidence/t5-finding-check.mjs)按原字节归档，相对路径应在原t5-edit-finding目录解析。独立实际验证来源变更、JSON往返、缺失/错绑/篡改拒绝及逻辑分支转交新统计；未独立执行DB/S3和真实失败重试。主代理视觉测试从真实API创建Job，逻辑编辑测试直接构造Job后运行两类Worker，不能称逻辑编辑API合同完整验收。T5本轮finding修复与限定验证完成；T6/T7仍另行推进。

本轮补齐TP06的真实API→Generation Worker→Render Worker→DB/S3验证：只改标题时Snapshot、Brief、Metric、TransformPlan、lineage、resultSummary、executionAssembly及完整数据保持来源值。入队后刻意改写来源Evidence的finding，新版本Evidence与HTML仍保留入队时原文，私人偏好正文未扩散。筛选/聚合编辑产生新lineage与resultSummary、重新建立finding，且Brief/Metric保持冻结来源。复制/回滚仍由先前65722ec的回归覆盖。

修复前代码路径会在视觉编辑时调用通用buildEvidenceFinding，未保留人工核对原文。现在API在幂等复用检查之后冻结来源finding与来源身份/SHA-256到generationAudit.derivedFinding，Render三处统一读取并校验。缺失/跨来源/内容篡改拒绝；逻辑编辑继续重算。未增加数据库字段，不代表T6原子提交或T7不可变Evidence已完成。首轮集成执行过程中实现已更新，因此只记录修复后通过，不伪称已取得修复前红灯运行。

验证：Chart离线7/7；完整默认隔离集成API14/14、真实失败态浏览器2/2、Worker2/2（其中新增编辑断言）通过且自然退出；API Console新增说明桌面/移动2/2可见且无横向溢出。API/Generation Worker测试、Render Worker源码、Web类型检查通过；受影响Chart/API chart-routes/Render Worker/Worker测试定向ESLint通过，清理chart-routes四个既有未使用导入。最初从根运行单元命令找不到tsx，改到Chart包目录后正常执行，未安装依赖。固定740文件快照t5-edit-finding供限定独立复核，结论待补。不把这些结果当全项目验收；G6历史性能异常仍保留。

- 原始数据回归：11 项中新增六项失败，旧五项通过；渲染新增两项失败，追加完整数据回归后共三项失败。
- 数据修复后：15 项通过；之后追加 ISO/日期兼容测试，最终结果见后续复验记录。
- contracts、generation 测试通过；generation 24 项通过。
- API 上传专项 12 项通过，覆盖持久化 parserVersion 和 columnMapping。
- data-engine/generation/API/Worker/Web 类型检查通过；docs:check、git diff --check 通过。
- API 完整单元命令在 auth 16 项输出完成后未退出，主动中止，记为未完成；不等于其他 API 测试通过。
- flint-adapter：12 项中九项通过、三项失败（完整数据、Area、负柱）；产品渲染未修改。
- 独立角色 `verify_data_repair` 基于 repair-data-review 冻结快照发现 ISO 拒绝和日期偏移单位回归；owner 已修正并添加测试。独立复核未运行测试，也尚未复验最终快照，不能视为独立验收通过。
- 未执行数据库迁移、真实模型/飞书、部署、完整浏览器 E2E、全仓质量验收。

### 最终离线复验

按 scripts/test-offline.mjs 的环境先执行 `--check` 排除外部配置，再设置 APP_ENV/NODE_ENV=test、LANGREPORT_OFFLINE_TEST=1、确定性模型、本地接入和不可连接的测试端点，运行 data-engine/contracts/generation/generation-worker/api 五个包的 test：**118 项通过，0 失败，命令退出 0**（16/26/24/14/38）。先前 API/Worker 包级测试不退出的问题在规定离线环境下消失；不是通过 test-force-exit 隐藏句柄问题。

受影响六个包的源码类型检查、六个包的测试类型检查、定向 ESLint、文档链接及 git diff --check 均通过。上述通过范围不包含渲染三项失败用例，也不代表完整 E2E 或用户验收。

原始输出：[离线复验](./evidence/data-repair-offline-final.txt)、[渲染未修复回归](./evidence/render-regressions.txt)、[渲染预算实验](./evidence/render-budget.json)。

## T4 时间粒度补充复验

2026-10-04继续T2隔离实验：Node/Chromium的Line与Area场景图相等，多系列乱序期间、null断点、Area填充及零基线断言通过，进程退出0。见[原始结果](./evidence/render-cross-runtime-results.json)。测试采用明确不堆叠的候选规范，不是生产链路验收。未更换产品渲染器。

本轮定向 ESLint 未通过：data-engine一个未使用current、generation未使用materializeArtifacts、测试两个未使用_request。对照repair-baseline确认四项均已存在（旧物化调用位于已注释的命令式实现），未改检查器或删除原工作。早先“定向lint通过”不代表这些文件当前全量lint通过。最新docs:check和git diff --check通过。

最终六包离线复验：**136项通过，0失败，退出0**（contracts27/data-engine18/lark-data12/generation27/generation-worker14/api38），使用规定离线环境。[完整原始日志](./evidence/t4-final-six-packages.txt)。

新增回归覆盖月度归组、季度/年度同比、逐日与跨闰年匹配、JSON/XLSX列冲突、CSV与合成飞书typed-table编号/数值对照。前一实现的六包离线原始结果保存在 [t4-offline-tests.txt](./evidence/t4-offline-tests.txt)。

独立复核 repair-t4-final-review 发现两项 P2：只根据前五个样例跳过归一化会遗漏后续日期；日内多时间戳未按日期归组。修正后冻结 repair-t4-calendar-final（665文件），verify_data_repair 从冻结源码运行纯函数断言，退出0，确认两项修复及v1兼容，没有发现本轮其他可确认缺陷；不构成全链路或用户验收。

最新 data-engine18/generation27项全部通过，三个包（contracts/data-engine/generation）源码及测试类型检查通过。先前一次运行仅旧血缘夹具失败，因为v2新增归组步骤；更新v2期望并保留旧夹具后通过。失败证据 [calendar-recheck](./evidence/t4-calendar-recheck.txt)，通过证据 [calendar-recheck-final](./evidence/t4-calendar-recheck-final.txt)。

## T10 画像优化阶段检查

2026-10-06并发健康接口探针失败：空闲65个成功样本p95为6.728ms，解析阶段39个成功样本p95为1180.516ms，增加1173.788ms，超过200ms预算；解析1238.725ms，得到100,000行，HTTP错误0。使用真实buildApp的/health，客户端在独立线程每20ms发起请求，主线程直接执行真实parseData。未包含上传、S3及DB，因此是同线程阻塞诊断证据，不是完整上传验收。一个baseline样本跨入解析期（max1240.579ms）；保留全部样本，不据此作精确生产容量推断。来源：[探针](./evidence/api-profile-latency.mts)、[原始结果](./evidence/api-profile-latency-20261006.json)。T10/R10明确未通过，已提交[G6独立设计](../2026-10-06-local-parse-isolation/proposal.md)，尚未授权实现；不改变本地同步上传合同。

2026-10-06补充预热后五轮测量：10k/20k/40k唯一值单列中位数分别27.68/26.58/52.37ms，40k与10k比值1.89，低于6倍预算；小规模计时存在明显噪声，不据此声称严格线性。100k×20、6,499,054字节CSV中位1426.82ms，五轮范围1222.76–2210.21ms，低于5秒。进程总峰值328272KiB（约320.6MiB），包含构造、预热和多轮运行；该总量低于512MiB，不能将运行前后RSS差称为精确额外峰值。各规模顺序执行，轮前调用显式GC，数据构造不计时。原始结果：[10k](./evidence/profile-10000-20261006.json)、[20k](./evidence/profile-20000-20261006.json)、[40k](./evidence/profile-40000-20261006.json)、[100k×20](./evidence/profile-100k-20-20261006.json)。API并发延迟另测，T10仍未验收。

2026-10-04 将 `profileRows` 的画像统计改为每列单次扫描，保留原有 `String(value)` 去重规则、前五个按原类型区分的非空样例、空值数和日期/数字/布尔推断。新增 20,000 行高基数与混合类型回归；data-engine 单元测试 19/19、源码类型检查和变更格式检查通过。

本机一次参考测量：Node `v22.22.2`，i5-13500HX，16 GB RAM；100,000 行×20 列、CSV 6,499,054 字节，解析和画像约 1,181 ms，运行前后 RSS 约 176→346 MB。测量脚本见 [profile-benchmark.mts](./evidence/profile-benchmark.mts)。这只是单次、冷启动进程内测量，不能作为 TP21 的五轮中位数、峰值额外内存或 API 并发 p95 验收。批量复测命令因自动审批复核达到用量上限未执行；本次未绕过复核。T10 保持部分实施，性能门禁未通过。

## T5 私有记忆引用补充

后续通过Node进程内TypeScript加载器运行相同测试文件，避免测试运行器/esbuild启动子进程的EPERM，不放宽文件系统权限，也不使用force-exit。当前Chart6项（含私有数组过滤、来源冻结、纯视觉完整数据复用）与data-engine19项合计25项通过，退出0，见[当前Chart/Data回归](./evidence/current-chart-data-tests.txt)。这补齐此前“新增断言未执行”，不代表Worker/数据库完整链路验收。

Render Worker 对旧式数组记忆的兜底路径原会直接保留任何对象，可能把私有正文写入公开 Chart Revision。本轮复用 Chart 包的显式投影，仅允许具备 `id/scope=project/key/version/contentHash` 的公开引用，去除正文和个人偏好。新增数组输入回归。Chart 包源码/测试类型检查、Render Worker 源码类型检查、五个受影响代码文件的定向 ESLint 均通过；Chart 原有未使用导入及三个 `any` 同轮清理。测试运行器在当前沙箱因 `spawn EPERM` 未执行该新断言，故 T5 仍未验收。此错误发生在测试进程启动阶段，不代表断言失败。

## 10,000 点绘图结果预算

2026-10-04 用户确定绘图结果最多 10,000 点，超限提示聚合。Adapter 在 Flint 编译前拒绝 10,001 点，在编译后核对实际数据行数；显式设置 Flint 的 `maxStretch`/`maxColorValues`，并固定输出尺寸与稀疏类别轴标签。Worker 将超限记为 `CHART_POINT_BUDGET_EXCEEDED`，错误信息提示按时间或类别聚合；API Console 和 OpenAPI 同步说明。新增边界回归：600、10,000、10,001 点通过；10,000 点实际 SVG/PNG 渲染保留末行和全部标记。旧 SVG 路径的重复索引扫描与过密标签已修正，Area 填充、混合正负柱形零基线及画布范围回归转绿；Adapter 全套 14/14 通过。类型检查：flint-adapter 源码/测试、render-worker、contracts、API、Web 均通过。T2/T3 统一渲染门禁未通过；未执行数据库和图表浏览器端到端验收。

补充验证：API Console 现有 Playwright 桌面/移动用例 4/4 通过；该用例组没有断言新预算提示本身。API OpenAPI 定向测试的 3 项断言均通过，但 Node 进程在断言后长时间不退出，已中断，不能记为整套测试通过。定向 Prettier、Adapter/Render Worker ESLint、`git diff --check`、`docs:check` 通过；API、Contracts、API Console 的定向 ESLint 仍报原有未使用变量/`any` 问题，未冒充质量门禁通过。

独立只读复核指出 Generation 层仍有 `xCardinality <= 500` 且视觉校验失败时会自动加入 `limit 500`，以及 Web 优先绘制 `previewData.rows`。已在同轮修复：绘图预算常量和提示由 Contracts 共享；Generation 对 10,001 条变换结果立即返回 `CHART_POINT_BUDGET_EXCEEDED`，不执行自动限行，编辑 Job 的校验错误也透传该码；Web 优先读取固定 Revision 完整数据并优化索引、系列分组与标签。Generation 29/29 测试通过，其中真实 Cycle 10,001 行没有新增限行步骤、修复次数为 0。桌面/移动核心链路 Playwright 2/2 通过，图表绘制了不在三行表格预览中的第 4 个点。Generation/Worker/Web 源码及 Generation/Web 测试类型检查通过；上述新文件的定向 ESLint 通过。仍未做 10,000 点浏览器响应性与统一运行时验收。

同一真实 Cycle 回归还验证 10,001 行源数据经明确类别聚合后只产生 100 个绘图结果并成功生成，证明上限针对变换结果，不误伤超过 10,000 行的源输入。该回归与拒绝分支同在 Generation 29/29 通过记录中。

新增 OpenAPI 实际响应断言发现 nullable 字段规范化丢弃了字段描述；已修正规范化器保留外层注释，`CHART_POINT_BUDGET_EXCEEDED` 聚合说明可在 Generation Job 完整状态和轻量状态两处读到。`node --test-force-exit --import tsx --test test/unit/openapi.test.ts` 为 3/3 通过；使用 Node 官方 `--test-force-exit` 避免原有打开句柄使进程滞留，不代表全量 API 测试已通过。

主界面失败态补充 Playwright 桌面/移动 2/2：模拟 Job 返回 `CHART_POINT_BUDGET_EXCEEDED`，均显示先聚合文案且不提供相同输入直接重试。该测试通过模拟 API 响应验证 Web 投影；尚未覆盖真实数据库 Job 从 Generation/Render Worker 到 API 的持久化链路。

## 2026-10-06 统一 Vega 与失败链路验收阶段

- 固定依赖 Vega 6.4.0 / Vega-Lite 6.4.3；Flint Adapter 与 Web 使用同一保存的 Vega-Lite 语义规范，服务端实际调用 Vega，浏览器大图使用 Canvas。渲染器版本为 `vega-lite-svg-v4`；历史 Revision 不改写。
- Adapter 单测 18/18，退出 0：10,000 点完整路径与末行、10,001 点拒绝、Area、正负柱形、主题、注释、安全规范和导出校验通过。Web 源码/测试、API 测试、Adapter 与 Contracts 源码类型检查通过。
- 独立只读复核发现原产物校验只检查 SVG 标签字串和 PNG 签名；已改为 SVG 解析和 PNG 完整解码，新增畸形 SVG 与 9 字节伪 PNG 回归，Adapter 18/18 通过。规范输入行哈希和场景图逐点一致性仍未由该校验器证明，TP05 的全部视觉正确性门禁不得据此关闭。
- Playwright 桌面/移动核心生成导出与图表编辑 4/4，退出 0。10,000 点专用场景桌面/移动各五轮，共 10/10，退出 0；桌面 Canvas 绘制中位 133 ms、最大采样间隔中位 289.2 ms，移动 138 ms、293.9 ms，每轮末行读出通过。原始日志：[十轮测量](./evidence/vega-browser-10000-20261006.txt)。均为本机 Chromium 开发构建，不代表其他硬件性能。
- Next 16.3.3 生产构建退出 0；四个可由 Vega 相关字符串识别的 chunk 合计 476,600 字节、gzip 后 146,715 字节，属于可识别子集，不等于全部 Vega 动态依赖或页面总包体。Web 独立安全策略定向单测 1/1、边界检查、定向 ESLint、Prettier 均通过。
- 新增隔离集成测试：真实 PostgreSQL 的 10,001 点 Generation Job 交给 Render Worker，查询 API 完整/轻量状态，确认 `CHART_POINT_BUDGET_EXCEEDED` 与聚合文案且禁止重试。后续浏览器用例仅把该 API 状态数据映射到固定测试 Job，检验 UI 对失败合同的投影；浏览器没有直接请求真实 API，**不构成数据库→Worker→API→Web 完整链路测试**。`scripts/test-integration.mjs` 显式枚举并清理临时投影文件。测试代码已完成类型检查，**尚未运行**：Docker Engine 的 `docker info` 返回 503，测试 Compose 无法获取 `postgres:16-alpine` 镜像，隔离服务端口 54330/9002 均未监听。真实失败链路保持未验收。
- 最终快照的桌面/移动核心、失败态和 10,000 点 Playwright 8/8 通过；渲染计时分别 130/158 ms，最大事件采样间隔 282.6/261.6 ms。

## 2026-10-06 真实失败链路补验

Docker Engine 恢复后，`docker compose -f infra/docker-compose.test.yml up -d --wait` 的 PostgreSQL、MinIO 均健康。`node scripts/test-integration.mjs` 在随机 test schema/bucket 执行并退出 0：API 集成 14/14、Generation Worker 集成 2/2；测试结束执行隔离 schema/bucket 清理。

10,001 点 Generation Job 写入隔离 PostgreSQL 后由真实 Render Worker 写成 `failed`，持久化 `CHART_POINT_BUDGET_EXCEEDED` 和聚合建议。运行中的 Fastify API 对相同 Job ID 的 `/status`、详情返回同一错误，原输入重试返回 409。API 测试保持服务与 Job 存活并启动 Playwright；桌面和 390px 移动浏览器各 1/1 通过：页面的状态轮询及详情请求转发到该真实 API，响应核对真实 Job ID 与错误码，界面显示聚合建议且无直接重试按钮。页面其他准备数据仍用合成夹具，因此该证明限定于**预算失败从数据库、Render Worker、API 到页面的传播**，不等于上传/生成成功全流程。

最终测试夹具的 10,000 点 Canvas 场景另在桌面/移动各重跑一次，2/2 通过；绘制耗时 171/125 ms、最大事件采样间隔 421.2/343.5 ms，均满足场景中的 3,000/500 ms 断言。API/Web/Generation Worker 测试类型检查、Web 源码类型检查、定向 ESLint、Prettier、边界和文档检查通过。

首次全套运行在独立的旧“状态契约投影”步骤因 Windows 命令行筛选拆词误选真实用例而失败；已移除重复步骤，真实浏览器检查只在 API 存活时执行。第二次运行暴露旧 Worker 夹具缺少冻结 Analysis Brief/Metric Definition，派生编辑被正确拒绝；补齐夹具后第三次完整运行退出 0。历史失败没有计入通过数。

## 2026-10-06 T5 来源冻结补验

复制与回滚的数据库写入现在使用来源 Revision 的 Analysis Brief、Metric Definition、执行来源及公开 Project 记忆引用；旧数组中的私有偏好和正文会在派生前被投影掉。回滚即使收到调用方传入的另一条公开记忆引用，也只写来源引用。来源缺 Brief/Metric 时返回 `409 REVISION_PROVENANCE_INCOMPLETE`。现有纯标题编辑单元断言证明 TransformPlan、lineage、resultSummary 与完整数据值继承；逻辑编辑仍由 Generation Worker 重新执行变换。此轮没有宣称 TP06 全链路已验收：视觉编辑与逻辑编辑的完整数据库、Worker、API、Web 连贯检查仍待补齐。

真实 PostgreSQL/MinIO 集成测试新增复制、回滚、私有记忆排除、外来记忆引用排除和缺来源拒绝断言。完整 `node scripts/test-integration.mjs` 退出 0：API 14/14、Generation Worker 2/2，且现有真实预算失败浏览器桌面/移动 2/2。最初在沙箱内启动 Node test runner 时遇到 `spawn EPERM`，未进入断言；随后在允许子进程的环境中重跑通过。

Chart 源码、Generation Worker 测试和 Web 源码类型检查均退出 0；本轮四个代码文件 Prettier 检查、`pnpm docs:check`、`git diff --check` 通过。API Console 桌面/移动 Playwright 6/6 通过。定向 ESLint 仍有 API Console 原有 4 项和 contracts/http 原有 2 项未使用赋值错误，均不在本轮修改行；Chart 与 Worker 本轮代码没有 lint 报错。这些存量 lint 错误未计为通过。

## 原文档阶段记录（历史）

## 本次验证范围

只检查新增修复文档、两份 Proposed ADR、文档导航和 agent-tasks 交接。对 Git 列出的 tracked/untracked 非 Markdown 文件逐一比较 SHA-256（排除 docs 目录和本地 .env）；379 个文件内容及文件集合均未变化，涵盖代码、测试、依赖、配置和迁移。未读取或修改 .env，未执行数据库写入；原仓库已有代码修改保持原状。

## 命令与结果

以下为 2026-10-03 本轮实际执行结果。业务测试仍为 NOT_RUN。

| 检查                               | 结果                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `pnpm docs:check`                  | 通过，退出码 0                                                           |
| 本次文档定向 Prettier              | write 后 check 通过，退出码 0；仅本次 13 个 Markdown，原任务快照不格式化 |
| `git diff --check`                 | 通过，退出码 0                                                           |
| 本次新增文档/ADR相对链接与任务映射 | 仓库链接检查通过；人工核对 F1–F11 → R1–R11 → D/T/TP 对应关系             |
| 非文档文件 SHA-256 前后比较        | 前后各 379 个，新增/删除/内容差异均为 0                                  |
| 原任务交接快照                     | 覆盖 current-task 前复制原字节，SHA-256 相同；原状态 VERIFYING 保留      |

## 未执行项

没有运行/编写 TP01–TP25 的修复回归，没有安装渲染依赖，没有运行数据迁移或压力测试，没有启动独立实现测试 Agent。原因是用户明确仅要求文档，且尚无实施快照。本计划已规定实施后的独立测试输入、职责与退出条件。
