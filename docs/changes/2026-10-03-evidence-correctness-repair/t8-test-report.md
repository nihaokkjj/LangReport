# T8 复制、回滚与固定版本工作台验收

- 日期：2026-10-08
- 状态：技术验收通过；最终串行集成自然退出0
- 基线：已推送的 T7 `origin/main=3c78c992b5f54ed39d44427b170071a25cc6da81`
- 对应：TP07、TP08、TP22；整体变更仍 IMPLEMENTING

## 实施行为

Evidence 工作台增加“复制为新图表”“从此版本创建草稿”和 Artifact 历史版本选择。所有命令共用响应兼容层：新 202/幂等 200 的 Job 仅代表接收，持续观察后读取固定 Revision Evidence；旧同步 201/200 的 Revision 分支也先读取其固定 Evidence 才显示保存。缺少身份或证据明确报错，不用当前 head 替代。

兼容窗口保留旧同步客户端接入分支，现行 API 仍只按已有合同返回 202/200 Job，不恢复旧同步发布路径。只有确认旧服务退出并经过后续合同审核才移除此分支。API Console 同步说明兼容、恢复、重试和 HTML 身份。

仅在 localStorage 保存按 authenticated user、Project、Conversation 隔离的 Job ID。刷新时连已终态 Job 也重新读取固定结果，失败仍可用既有 retry。用户切换 Project/Conversation 同步取消命令与 watcher，不让旧结果改变新上下文；原对话 Job ID 保留，明确切回可恢复。历史 Revision 路由不在默认 Evidence 列表时单独按 revisionId 获取，不退回 head。历史菜单过滤当前 Artifact 并始终包含当前版本，防止异步切换期间借用旧 Artifact 选项。

TP07 发现静态 HTML 原先没有 Artifact ID。现在 Render Worker 使用同一 reservedRevision 的 Artifact ID、Revision ID、编号生成新候选 HTML，Artifact 字段转义后展示；兼容旧 adapter 调用。没有重写历史对象或批准版本。四种导出继续绑定新版本身份。

## 场景与证据

| 场景 | 验证方式与结果 |
| --- | --- |
| TP07 | 通过。真实 API 对 Approved 来源发 copy，202 入队、同键200复用；两类 Worker 完成新 Artifact/R1/Evidence。检查固定 Snapshot、Brief、Metric、执行装配、公开项目记忆、TransformPlan、血缘、统计与 finding；默认标题按既有合同追加“副本”。四输出实际 GET/存储可读，HTML 包含新身份与编号；来源所有 Revision/Evidence/四对象字节不变。 |
| TP08 | 通过。同一 Artifact 存在更新 Draft head 时回滚旧 Approved 来源，创建更高编号 Draft、parent 指向目标，推进新 head、保留 published；历史记录和源字节不变，新四对象与固定导出通过。 |
| TP22 | 新202与200 Job、旧201 Revision、排队无成功提示、失败/retry、持有旧status后同Project切Conversation、释放旧成功响应、原对话刷新不跳回、明确切回恢复终态、回滚后选择非head历史并刷新、迟到命令不覆盖其他Project。四屏宽新增场景8/8；加核心导出、编辑、Console共20/20，最终自然退出0。 |

- [最终浏览器回归](./evidence/t8-browser-final.txt)：1440/1024/760/390，20/20，自然退出0；最终未出现历史选项 out-of-range 警告。历史与操作区八张截图 `evidence/t8-history-*.png`、`evidence/t8-actions-*.png`，owner 检视桌面和手机；手机按钮使用既有44px触控区域，换行无横向溢出断言通过，未新增视觉token。
- [离线回归](./evidence/t8-offline.txt)：自然退出0，包含 API55、Web27、Adapter18；[Web定向](./evidence/t8-web-unit.txt)、[Adapter定向](./evidence/t8-adapter-unit.txt)也通过。
- [类型/定向质量检查](./evidence/t8-checks.txt)：Web源码/测试、Generation Worker测试、Render Worker源码、Adapter源码/测试类型通过；本轮源码与测试 ESLint、Prettier通过。
- [最终串行集成](./evidence/t8-integration-final.txt)：自然退出0，API14、预算失败真实浏览器2、Worker2；包含明确 TP07/TP08 通过标记，隔离 schema/bucket 完成清理。

## 失败、修复与独立复核

没有删除失败证据：[首轮输出键误取](./evidence/t8-integration-initial.txt)把版本标记当对象键；[默认复制标题预期不符](./evidence/t8-integration-attempt2.txt)；[真实 HTML Artifact 身份缺失](./evidence/t8-integration-html-failure.txt)促成输出修复。[端口冲突](./evidence/t8-integration-port-collision.txt)来自本轮同时启动两个共享3100的Playwright服务，记录EADDRINUSE；owner改为浏览器结束后串行集成，不放宽测试。最早浏览器定位“重试”而实际按钮为“再次尝试”，修正后桌面通过；[后续桌面记录](./evidence/t8-browser-desktop-attempt2.txt)保留项目切换断言曾错误检查永存空画布region的情况。[初版回归](./evidence/t8-browser-regression.txt)20/20但包含开发热更新effect依赖数量警告，不作为最终冻结源码证据。

上述桌面attempt2、初版回归、集成attempt2/HTML故障/端口冲突五份终端日志带行尾空白。为通过Git diff检查，仅在可读`.txt`副本移除行尾空白；完整原始字节各自压缩保留为同名`.txt.gz`，不删失败行或改变结果。

[首次独立报告](./evidence/t8-independent-initial.md)在780文件快照发现同Project切Conversation仍观察旧Job的P2。修复后冻结787文件第二快照，[第二独立报告](./evidence/t8-independent.md)重新核对全部哈希及相关源码，确认原P2修复、未发现新增确定性P1/P2；也复核新HTML身份。验证角色未独立重跑测试，不代替用户接受。快照根为 `C:\Users\sai_8\.codex\visualizations\2026\10\08\01a119ef-072e-7071-a33c-83d3bb4e4931` 下的 `t8-review`、`t8-review2`；最终正在写入的集成/浏览器日志不计入静态源码快照，完成后由owner归档。

## 限制与交接

浏览器交互用受控API夹具；TP07/TP08为真实API、PostgreSQL/MinIO与两类Worker。两者不能合称完整浏览器→两类Worker生产闭环，TP25留给T12。本轮未验旧库分类迁移/生产部署/自然租约等待。既有全仓 routes lint、Worker测试跨API依赖 boundaries、旧UI两份跟踪.log hygiene问题仍按T7记录保留，不能称全仓门禁通过，T11继续处理。

T7 两提交已按本次用户指令推送并核对；本轮T8完成后仅本地提交，未再次推送或部署。原 `apps/web/next-env.d.ts` 修改保留但不纳入提交；agent-tasks/runtime-experiment所有文件未改动或纳入提交。下一项为T9，尚未执行。
