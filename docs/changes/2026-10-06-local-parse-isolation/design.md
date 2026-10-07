# 本地解析隔离设计

- change-id：`CHG-2026-10-06-local-parse-isolation`
- 状态：`APPROVED`
- 创建/更新时间：2026-10-06

## D1 执行边界

现状：`apps/api/src/table-intake.ts` 将 multipart 流写入临时文件后读入 Buffer；`apps/api/src/data-assets.ts` 调用 `parseData` 并在 API 线程 `JSON.stringify` 全表。只把函数包成 Promise 无法隔离 CPU；只移动画像也留下解析和序列化阻塞。

建议新增 API 内部解析执行器，沿用 `packages/data-engine` 的纯函数和 parserVersion。执行器以固定 Worker 入口创建短生命周期线程，通过异步消息等待结束。开发入口与发布后的 JS 入口都要在真实构建中测试，不能把实验 loader 作为生产依赖。

API 先完成现有权限、Project/Conversation、目标资产验证，申请一个工作槽，再读取/写入有界输入。每个 API 进程最多一个活动解析，队列长度为零；槽在退出确认后释放。正在流式上传的请求也占槽，避免不限量落盘；沿用服务请求超时，客户端断开即释放输入资源。多实例总体并发随实例数增长，部署容量须记录。

## D2 输入与结果传递

上传继续使用有字节限制的流式 spool；粘贴和直接 Buffer 入口将已有受限输入写到服务器创建的临时目录。只把 sourceType、输入路径、输出路径、请求关联 ID 发给线程。所有路径由服务器创建并验证归属于该次请求目录，客户端不能指定；线程无外部服务凭据。

线程读取输入、执行同一 `parseData`、生成与当前一致的 normalized 对象并序列化写文件，采用排他创建，完成后才回报成功。父线程通过文件流写对象存储，不读取并反序列化完整 rows。线程仅返回 rowCount、columnCount、profiles、preview、parserVersion、columnMapping、warnings 及 normalized 文件字节数。元信息按固定 schema 和大小校验；超限明确失败，不静默裁切业务数据。来源原始文件也流式上传。

从 `ingestDataAsset` 分离解析结果与发布输入，使数据库元信息使用 count/profiles/preview，完整行仅保存在 normalized 对象中。数据库和 S3 仍由父线程调用；复用现有发布与失败清理，不在线程中写入业务记录。成功响应只在现有发布条件满足后返回，失败不推进旧资产最新 Snapshot。

## D3 资源、取消与错误

候选参数必须经实验验证：单槽、解析期限 15 秒、Worker V8 old generation 384MiB、normalized 文件最多 256MiB、元信息最多 4MiB。文件输出按字节计数并中断；不能先生成无限输出再检查。序列化生成的峰值也纳入预算；若整表 stringify 不满足边界要求，在线程内按行写同一 JSON 格式。以上不是已测得的安全容量，不改变源文件硬限制。

父线程设置墙钟计时器；超时、请求断开、服务关闭时终止 Worker 并等待退出，之后清理临时目录、释放槽。成功消息与超时竞争只能完成一次；线程错误、非零退出、无消息退出及畸形消息均失败。不得在失败后回退到主线程解析，不自动重试；用户重新发起是新的请求。连接断开后的清理不覆盖已成功发布的 Snapshot，保留现有 COMMIT 不确定性处理，无法证明时列为阻塞。

新增错误候选：`DATA_PARSE_BUSY`（503，可稍后重试）、`DATA_PARSE_TIMEOUT`（503）、`DATA_PARSE_RESOURCE_LIMIT`（422，提示拆分或减少输入）、`DATA_PARSE_WORKER_FAILED`（500，隐藏内部路径）。现有格式错误继续 `DATA_PARSE_FAILED`，大小错误沿用原码。新增码及状态须与 Contracts、API Console、Web 展示共同落地；不增加新的成功字段或 202 分支。

## D4 兼容、替代与回滚

无需数据库迁移；旧 Snapshot、历史 parserVersion 和飞书 Data Intake Job 不改写。provider 路由维持原行为：local 走隔离执行，飞书分支保持原实现，原来落到 local 的 JSON 也受隔离保护。服务停止时不接受新解析，终止在途线程并清理文件。

不选持久化 Data Intake Job local provider：它需要 202 客户端兼容、状态恢复、重试与租约发布设计，超出此最小方案。不选独立进程作为首选：增加进程传输和 Windows 生命周期管理成本；若线程的内存失败边界不达标，再评审切换，不能把 V8 限额说成硬 RSS 限制。

回滚前先停止新接入并等待/终止本版本在途解析，再回退相关应用；保留已发布数据和对象。旧同步实现仍有已知延迟问题，回退不视为性能验收通过。

## D5 可观测性

记录等待/解析/序列化/上传/发布耗时、输入与结果字节数、行列数、Worker 退出原因、超时和繁忙计数。日志只含关联 ID 和数值，不含表格单元格、临时绝对路径或凭据。测量同时覆盖 API 主进程与线程所在进程的总内存、CPU及健康/授权只读接口延迟。

## 2026-10-06 实施细化

当前API构建脚本实际仅做类型检查，部署start/dev均使用tsx；固定`local-parse-worker.mjs`通过已安装`tsx/esm/api`加载固定TS任务。未添加不存在的编译JS发布路径，未引入实验加载器。线程仅接收TEMP/TMP（本次解析目录）和TSX_DISABLE_CACHE=1，不继承服务凭据；避免Windows缺少TEMP导致tsx写入项目内undefined目录。Worker只处理文件与数据引擎，tsconfig和依赖由平台路径确定。

multipart先经Project权限，再申请进程共享接入槽并spool；Conversation字段可能排在文件之后，所以完整Conversation/目标校验发生在spool后、解析与数据库写入前。槽覆盖整个上传、解析、存储、发布与结果文件清理，避免慢存储期间堆积完整输出；粘贴共享同一槽。HTTP请求接收期限60秒，解析期限15秒；请求断开和app preClose通过AbortSignal取消。source临时文件由API生成，复制到解析专用目录，不接收客户端路径。

已修正发现的既有提交补偿风险：一旦尝试数据库发布，其异常不证明ROLLBACK，因此保留候选对象且不将可能已ready的资产改为failed。尚无自动对账器；保存结果不明时返回安全错误并指引查询，可能留下待核查processing资产/孤立对象，此限制保留在验收清单，不能以删除掩盖。
