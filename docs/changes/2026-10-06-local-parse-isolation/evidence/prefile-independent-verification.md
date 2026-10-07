# G6 file part 前关闭窗口修复复验

日期2026-10-06；独立Verification角色。只读固定738文件快照 `./tree`，未改产品，未运行性能或数据库测试。

## 结论

上一报告 `../g6-lifecycle-final/verification-report.md` 的 P2 在本快照关闭。

静态检查确认新建上传与更新上传都先进入 withIntakeCancellation，再等待 assertChartAction 和 request.file；每次等待后检查 signal。intake-cancellation 的 shutdown 已取消分支执行 shutdownAbort，销毁请求和响应后 throwIfAborted，不再仅标记取消。

## 独立实测

`prefile-check.mjs` 加载本快照的取消函数，只读加载既有 Fastify 5.12.1 / multipart 10.1.1，按最终路由顺序构造两个最小路由。使用真实 HTTP 同时挂起新建和更新两条 multipart 请求，都只发 conversation 字段而没有 file header。等待两条路由进入包装后调用 app.close。

结果：服务自行关闭，无需显式客户端 destroy；2秒兜底计时器未触发。另断言服务关闭后才进入包装会销毁请求/响应，抛 AbortError 且不执行 run。进程自然退出，未 force-exit。

可复现命令：`node ./prefile-check.mjs`。

## 边界

这是独立真实HTTP/框架取消路径验证，授权等待使用已完成Promise代替；没有启动完整产品数据库/S3。新增真实集成源码检查确认同测两条file-header前请求和零资产，但主代理4/4不冒充本角色执行。此前授权读取p95增量1018.87ms异常未在本轮重测或解释，G6性能与总体验收仍开放。
