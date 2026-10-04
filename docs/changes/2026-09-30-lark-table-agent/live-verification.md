# 真实飞书接入验证

- 日期：2026-10-02
- 执行者：LangReport owner Agent
- 结论：本地真实数据接入、不可变快照和图表字段链路通过；用户最终验收与图表视觉问题另列。

## 账号与运行配置

用户新建自己的飞书应用并在浏览器完成最小权限 OAuth。专用 `langreport` profile 的 `auth status --json --verify` 返回 `identity=user`、`verified=true`，项目使用新应用下的用户 open_id；`pnpm lark:check` 通过。CLI 固定 1.0.97，App Secret/访问令牌由 CLI 保存，未写入代码、证据或聊天。

本地未跟踪的 `.env` 已设置 `TABLE_INGESTION_PROVIDER=lark`，绑定既有 admin 用户及其私有 Workspace。Web/API/Generation Worker/Render Worker 已完整重启，Web 3000、API 4000 的就绪检查通过。默认 CLI profile 没有切换；没有生产部署、Git 提交或推送。

一次旧开发进程热重载后的 HTTP 任务出现 `LARK_IDENTITY_MISMATCH`，该任务的连接字段与成功任务相同，未产生远端导入。同机单独身份检查通过；完整重启开发进程后同一路径成功。没有采集旧进程完整环境，因此不把“具体是哪一个环境变量不同”写成已证实根因。

## 真实协议缺陷及修复

首次实际导入已经成功，但目录解析报 `LARK_SHEETS_INVALID`。只读核查发现 `+workbook-info` 的实际 Sheet 结构为：

```json
{"sheet_id":"<脱敏>","sheet_name":"销售明细","resource_type":"sheet","is_hidden":false}
```

原实现及测试夹具错误读取 `title`，导致真实普通工作表被拒绝。固定版本[官方命令实现](https://github.com/larksuite/cli/blob/v1.0.97/shortcuts/sheets/lark_sheet_workbook.go)直接输出 `get_workbook_structure` 的结果；CLI help 中的描述不能代替实测响应契约。

已改为校验 `sheet_name` 并映射为 Agent 上下文内部 `title`；资源类型与目录字段错误分别解释。实测字段结构的回归测试在修复前失败，修复后成功；缺少名称、名称类型错误或非普通 Sheet 仍被拒绝。单元、API 集成及专项脚本的外部响应夹具已同步。

旧独立实现快照保留。最新 `implementation-snapshot-live.json` 含 40 个文件，相比旧快照只有以下三个文件变化：

- `packages/lark-data/src/table-agent.ts`
- `packages/lark-data/test/unit/table-agent.test.ts`
- `apps/api/test/integration/table-intake.integration.test.ts`

最新快照文件 SHA-256：`805239a8ed5ea6744757d81bc45404c7efd0518e87a7db858665be1fb9093022`。

## 已执行场景

使用 [17,943 字节的合成 XLSX](./evidence/lark-live-sample.xlsx)：第一页为说明，第二页为销售明细；第 1 行标题、第 2 行空白、第 3 行表头、第 4–6 行数据、第 7 行合计。包含同名销售额 B/C 列、文本编号 `001` 和独立利润列。

1. 先通过 Fastify 实际 multipart handler、真实本地 DB/S3、真实 CLI 和模型验证接入。该阶段由脚本提供本地认证用户上下文，不能将其冒充实际 HTTP 身份验证。
2. 随后向正在运行的 `127.0.0.1:4000` 发出真实 HTTP 上传，并由常驻 Worker 自动领取任务。使用内存中签发的短期本地测试 JWT，正常经过 API 签名与账号验证；没有重新验证用户名/密码登录，也没有关闭认证。
3. 更新成功资产产生新 Snapshot；旧 Snapshot 仍能通过 API 读取。查询到 3 行、6 列，`001/002/003` 与数值原样保留，字段为 `销售额 [B]`、`销售额 [C]`，选择范围为 `A3:F6`，合计行未进入快照。
4. 使用同一新 Snapshot 生成“按区域汇总利润”柱状图。TransformPlan 对 `利润` 求和，字段血缘 `利润合计 ← 利润`，X/Y 为区域/利润合计；数据精确为华东 45、华南 30。计划校验、渲染程序校验通过，PNG 经授权 HTTP 导出成功。

第二阶段接入实际调用模型两次：输入 1,067 + 1,266 token，输出 23 + 58 token，共 2,414 token；这是该小样例的表格选择开销，不包含后续图表生成，也不代表大文件固定费用。模型没有收到完整原始文件；当前仍按有限观察和预算运行。

## 证据与复验

| 证据 | 结果 |
| --- | --- |
| [工具接入结果](./evidence/live-intake-result.json) | 真实 CLI/模型，多 Sheet/表头/类型/快照通过 |
| [正常 HTTP 与后台 Worker 结果](./evidence/live-http-result.json) | 新快照、旧版本保留、图表字段和值通过 |
| [导出图](./evidence/lark-live-profit.png) | PNG 可读取；目视问题见下节 |
| `pnpm --filter @langreport/lark-data test` | 11/11 |
| 专项脚本 `independent-verification.mts` | 本轮由 owner 重跑，12/12 |
| `pnpm test:integration` | API 13/13、Worker 2/2，0 skipped，隔离资源清理完成 |
| lark-data typecheck、API test:typecheck | 通过 |
| 修复涉及的三个文件 ESLint | 通过；不代表历史全仓 lint 问题已修复 |
| `pnpm docs:check`、`git diff --check`、新快照复核 | 通过；40/40 文件哈希一致 |

本地验收项目名为“飞书接入验收（合成数据）”。初次协议失败留下的云端副本与失败任务保留；后续成功导入也是新副本，不覆盖原云文件。验收图表仍为草稿，没有替用户批准证据。

## 未通过及未覆盖

- PNG 目视发现首尾柱形跨越绘图区边缘并被裁切。数值和字段正确，显示问题未在本次数据连接修复中处理；程序渲染校验通过不等于视觉全部通过。
- 原独立验证报告适用于原冻结快照。本轮发起增量独立复核时，该 Agent 达到用量上限而未执行；本轮回归和真实验收由 owner 完成，不标记为新增独立证明。
- 没有执行多用户 OAuth、生产部署、复杂 Excel 公式等价或超大表性能验收。当前连接限定一个本地用户/Workspace。

后续应在发布前保留真实协议样例的冒烟验证，避免模型与测试共同复制未经证实的外部接口假设。用户最终业务验收仍由用户决定。
