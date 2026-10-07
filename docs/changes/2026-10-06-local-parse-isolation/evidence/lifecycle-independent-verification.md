# G6 生命周期限定独立复核

2026-10-06。固定快照 `./tree`，manifest HEAD `d1c499cd9b26013c82862feef3a1de4dc049ecc9`，完整文件以 manifest 为准。未修改产品或快照；未运行性能压力、数据库写入或 S3 集成。

## P2：file part 出现前的慢 multipart 仍阻塞关闭

`apps/api/src/routes.ts:589–591` 在 `withIntakeCancellation` 之前等待 `request.file()`；更新上传同样在 642–644 行。因此只发送前导字段、不发送 file header 的客户端还没有注册关闭监听器。`preClose` 只 abort 已注册操作，不能关闭这条传输。`intake-cancellation.ts:34` 对已经关闭的服务也只执行 abort()，没有调用销毁传输的 shutdownAbort。

独立真实 HTTP 复现见 `pre-file-shutdown-check.mjs`：只读使用已安装 Fastify 5.12.1 / @fastify/multipart 10.1.1，加载固定快照取消函数，复制路由的 request.file→包装顺序。客户端只发送 conversation 字段并保持请求未结束；app.close 300ms 后仍未完成；显式 client.destroy 后才关闭。输出 `closedBeforeClientDestroy=false`。这不是完整产品集成，但覆盖同样的框架/取消调用顺序，且未接触 DB。

建议将等待文件 part 纳入取消范围；服务已关闭时也销毁未结束传输。补完整产品集成的 file-header 前关闭场景。此快照该发现未关闭。

## 已独立实测通过

- `shutdown-check.mjs`：真实未结束 HTTP multipart、已进入取消包装；执行注册的 preClose 后 signal 取消、请求和响应均 destroyed、服务器自然关闭，监听器移除。Fastify hook 在该脚本由最小注册夹具调用，非完整 Fastify 产品 app。
- 对此新快照重跑 `../g6-cancel-repaired/independent-check.mjs`：无消息退出/崩溃/畸形消息失败关闭，CPU Worker 超时、忙槽、取消通过；请求体已收到后、包装前断开不执行 run。
- 全部进程自然退出，不使用 force-exit。

## COMMIT ack 故障测试与 Repository seam：静态复核

`local-intake-commit-loss.integration.test.ts:44–126` 确实是 PostgreSQL wire proxy：处理分片帧，识别服务端 CommandComplete(COMMIT)，在返回调用者前毁连接；随后经独立直连查 ready、一个版本，并从 S3 检查原始对象和 normalized 行。不是仅在模拟仓储提交后抛错。连接限制为隔离54330测试库/测试schema，代理不接生产端口；测试显式 ssl:false 使协议可解码。

`data-assets.ts:236–335` 将原生产仓储构造为 createIntakeRepository(database)，所有相关查询和事务均使用注入的 database。生产默认仍使用 db；未发现 seam 改变事务原子性或绕过路由权限。该 API seam 本身没有权限职责，与原层次一致。

本角色未运行这个真实数据库测试，不把主代理4/4视作独立执行。其源码足以验证测试设计针对真正提交确认丢失，执行成败仍引用主代理原记录。

## 性能诊断：不能关闭门禁

独立读取 `full-upload-p95-failure.json` 并计算：第4轮授权资产读取 p95 增量 **1018.8705ms**，该轮健康增量0.4776ms，各轮样本错误为0。200ms要求被违反，不能用后续成功覆盖。

新增诊断在 server request/preHandler/onResponse 保存绝对时间和处理分段，客户端保存 startedAt，可与 pg_stat_activity 100ms采样关联；失败阈值前保存带时间戳原始报告，有助于保留真实异常。基线排空后才进入压力阶段，错误样本先断言，p95不筛掉错误，这些设计有效。

限制：beforeHandlerMs 不是纯认证时间，包含此前hook；数据库活动按整个数据库聚合，不足以单独归因某次授权请求、某schema或应用连接池等待。不能从这两组值直接断言数据库锁、CPU或网络是根因。若 HTTP/upload 本身断言失败，报告写入发生在五轮全部结束之后，可能无法保存当次完整诊断；这不影响已有p95失败记录，但调试其他失败时须注意。

本轮依请求未压力重跑；异常根因仍未知，G6 P3及总体验收继续开放。
