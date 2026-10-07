# G6 独立只读复核

- 日期：2026-10-06；角色：独立 Verification agent。
- 初始完整快照：`../g6-parser-integrated/tree`。
- 第一修复复核快照：`./tree`；最终复核快照：`../g6-review-fixed/tree`。manifest HEAD 均为 `d1c499cd9b26013c82862feef3a1de4dc049ecc9`，以各自完整文件 manifest 区分未提交内容。只读读取，没有修改快照或产品文件。
- 范围：本地解析线程、上传/paste/更新接入、取消、元信息协议、资源与发布补偿。不是 G6 全链路验收。

## 发现

### P2：请求体收完之后、取消包装注册之前的断开被遗漏（已复验修复）

原快照 `apps/api/src/intake-cancellation.ts:27` 只检查 IncomingMessage.aborted 和 shutdown，没有检查响应对象是否已关闭。paste 路由在包装前会 await 权限查询。请求体完整收到后客户端关闭连接，request.aborted 可以为 false，response.close 又已发生，因此解析和发布仍会启动。

独立真实 Node HTTP 复现：完整 POST `{}`，客户端 50ms 后 destroy；服务端等 120ms 模拟权限查询，随后调用快照包装函数。原实现输出：`requestComplete=true, requestAborted=false, responseDestroyed=true, signalAborted=false`。

修复快照 `intake-cancellation.ts:28–30` 检查 response.destroyed 并在调用 run 前 throwIfAborted。相同 HTTP 测试输出：`requestComplete=true, requestAborted=false, responseDestroyed=true, called=false, rejected=AbortError`。此缺陷关闭。

### P2：发布结果未知仍提示直接重试（最终快照静态复核已修复）

`apps/api/src/data-assets.ts:386` 返回“Data Snapshot 保存失败，请稍后重试”；`597–607` 的发布异常也使用此错误。COMMIT 已成功但确认丢失时，代码正确保留对象且不覆盖 ready 状态，但客户端仍得到确定失败和重试指引。用户按此指引重复新上传会创建另一资产，重复更新会新增另一快照。

这与设计 D3、同快照 Contracts 第 1370/1409 行及 API Console 第 2053 行规定的“先查询资产/快照再决定重试”不一致。应在 persistenceAttempted 后返回保存结果尚不能确认、先查询的安全文案，而非断言失败。依据为固定快照可达代码路径；本角色没有独立注入真实数据库 COMMIT 断连。

最终 `g6-review-fixed/tree` 中 `data-assets.ts:607–612` 已在 persistenceAttempted 且 SNAPSHOT_PERSIST_FAILED 时覆盖为“Data Snapshot 保存结果暂无法确认，请先查询资产及快照列表，再决定是否重试”。静态检查确认转换发生在对外 throw 前，继续保留对象、不更改 ready。默认 persistenceFailure 文案用于其他前置失败，不误报为此缺陷仍存在。新回归 `data-assets.test.ts:499–520` 模拟先提交再抛错并断言精确文案、ready、对象保留；本角色仅审读该回归，未执行其 DB 依赖入口。此次缺陷在代码层关闭，真实 COMMIT 断连仍未独立验证。

## 独立执行的验证

脚本：同目录 `independent-check.mjs`。Node v22.22.2，Windows。命令：

```powershell
node --experimental-transform-types ./independent-check.mjs ./tree
node --experimental-transform-types ./independent-check.mjs ../g6-review-fixed/tree
```

从快照直接加载产品 TypeScript；使用 Node 内置类型转换，仅执行独立验证，不加入生产入口。测试 Worker 为快照自带固定 fixtures。

- 无消息退出、Worker 崩溃、畸形消息：均 DATA_PARSE_WORKER_FAILED。
- 活动 CPU Worker 超时：DATA_PARSE_TIMEOUT。
- 活动槽再次调用：DATA_PARSE_BUSY。
- 活动 CPU Worker 取消：DATA_PARSE_CANCELLED，等待结束后 close。
- 完整请求体收到后、注册取消之前的真实 HTTP 断开：修复后拒绝且 run 未执行。
- 以上进程自然退出，未使用 force-exit。
- 最终 g6-review-fixed 快照再次执行同一脚本，所有以上断言通过。

## 范围限制与未验收项

- 源码审查确认父线程不返回完整 rows，结果通过文件流写入 S3；消息大小、行列、画像、preview 等有校验，Worker 成功需 exit=0 且输出字节匹配。
- 源码审查确认 local 发布尝试后不删除候选对象、不将资产覆盖 failed；这不等于 COMMIT 未知情况下的自动对账已实现。
- 已读取原代理的 full-upload-results.json / expanded-input-results.json，但不视为本角色独立重跑的通过证据。
- 本快照没有 node_modules；本次未重跑真实 CSV/XLSX 引擎入口、数据库/S3、五轮性能、UI、慢上传、内存极限和真实关闭服务全链路。不能据此关闭 P1–P9 或原 T10。
- 本角色没有发现足以报告的其他确定性 G6 产品缺陷；未执行项目仍按未验证处理。
