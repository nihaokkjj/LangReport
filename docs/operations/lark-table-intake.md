# 飞书 CLI 表格接入（Windows）

截至 2026-10-02，项目固定 `@larksuite/cli@1.0.97`。当前开发机已完成自建应用、浏览器 OAuth、专用用户绑定和真实上传验收，本地已启用；其他部署仍须自行授权，不能复制本机授权状态。证据见[真实验收](../changes/2026-09-30-lark-table-agent/live-verification.md)。

## 行为与边界

设置 `TABLE_INGESTION_PROVIDER=lark` 后，CSV/XLSX/XLS 上传通过 API 暂存文件并流式写入 S3，返回 `202 {asset,intakeJobId}`。Generation Worker 的独立接入队列调用 CLI 导入为新的飞书电子表格，再由表格 Agent 决定检查哪张工作表、选择哪一行表头和哪块数据区域。完整数据由工具层处理；模型只看到目录、真实行号和少量头尾样本。读取通过完整性与文档版本检查后，保存不可变 Snapshot，再交给原有图表生成链路。

JSON、粘贴数据和 `local` 模式保持既有方式。开启飞书模式后的账号/权限/读取错误会明确失败，不会回退到本地 Excel 解析器。

当前为一个 LangReport 用户及 Workspace 绑定一个固定 CLI profile 和飞书 open_id。允许显式复用已有应用配置，不能依赖机器当前默认身份；其他 LangReport 用户不能借用该连接。API 保存的配置不含飞书 token/app secret，CLI 自己管理授权。模型密钥仍只在 Worker 解密，CLI 子进程也不会继承数据库、S3 或模型密钥。

## 安装与检查

在项目根目录的 PowerShell 执行：

```powershell
pnpm install --frozen-lockfile
pnpm lark --version
pnpm lark profile list
```

workspace 已明确允许官方 CLI 的安装脚本。若安装时主动使用了 `--ignore-scripts`，可执行 `pnpm rebuild @larksuite/cli`，再核对 `lark-cli version 1.0.97`。服务端直接启动此依赖下的原生可执行文件，不在每个请求中运行 npm/npx 下载。

已有应用时使用它的明确 profile 名称。没有应用时：

```powershell
pnpm lark config init --new --name langreport
```

根据 CLI 的链接在浏览器完成应用创建。不要在聊天、命令行参数或仓库文件中提交 App Secret；已有 app secret 的配置流程使用官方 `--app-secret-stdin`。

## 最小授权

固定版本的 `+workbook-import` 源码声明需要 `docs:document.media:upload` 和 `docs:document:import`；读取工作簿、版本和表格需要 `sheets:spreadsheet:read`。本接入不申请邮件、消息、通讯录或删除文件权限。

```powershell
pnpm lark --profile <你的profile> auth login --scope "docs:document.media:upload docs:document:import sheets:spreadsheet:read" --no-wait --json
```

打开返回的 `verification_url` 授权。Agent 代办场景由 Agent 在用户明确完成后执行同次流程的 `auth login --device-code ...`，不要求用户粘贴 token。检查：

```powershell
pnpm lark --profile <你的profile> auth status --json --verify
```

需要 `identity=user`、`verified=true`，并记录 `identities.user.openId` 作为绑定身份。应用权限和用户授权两层都必须满足；缺少应用 scope 时按 CLI 给出的开发者后台链接开通相应权限。授权过期应重新执行上述最小范围登录。

## 项目配置

在本地未跟踪的 `.env` 中设置：

```dotenv
TABLE_INGESTION_PROVIDER=lark
LARK_CLI_PROFILE=langreport
LARK_OWNER_USER_ID=<LangReport登录用户ID>
LARK_WORKSPACE_ID=<该用户的Workspace UUID>
LARK_EXPECTED_OPEN_ID=<飞书用户open_id>
LARK_FOLDER_TOKEN=
```

`LARK_FOLDER_TOKEN` 可选；建议使用专门存放 LangReport 导入文件的云空间文件夹，留空则使用飞书云空间根目录。User ID 不能填用户名。此变量应与 API/Worker 所在机器及 Windows 运行账号的 profile 保持一致；本机登录不会自动授权另一台服务器。

同时需要既有的 `GENERATION_MODE=llm`、百炼 endpoint/model/structured-output 配置，以及 Worker 的工作区模型密钥或部署级备用密钥。表格选择是单独的结构化模型任务，会记录实际输入/输出 token 用量。

```powershell
pnpm lark:check
pnpm db:migrate
pnpm dev:all
```

环境变量变更后重启 API 与 Generation Worker。如果监视器热重载后身份检查仍与单独执行不一致，完整退出并重新运行 `pnpm dev:all`，再核对；不要只通过触发源文件变更断言配置已正确加载。`pnpm lark:check` 只验证固定版本和绑定身份，**不代表已有全部文档权限或完整导入验收**。

## 使用与接口示例

在工作台“表格说明”输入可选提示，例如“使用销售明细，第 3 行为列名，排除最后的合计行”，然后导入文件。收到文件后显示处理中，成功后才显示新快照；问题不明确时显示 Agent 的澄清问题，补充说明并重新提交。

API Console 从 OpenAPI 自动生成 `tableHint` 输入、202 响应和状态查询接口：

```http
POST /api/v1/projects/{projectId}/data-assets/upload
Content-Type: multipart/form-data

conversationId=<UUID>
tableHint=使用销售明细，第3行是列名
file=<文件>
```

```json
{"asset":{"id":"<asset UUID>","status":"processing"},"intakeJobId":"<job UUID>"}
```

查询 `GET /api/v1/projects/{projectId}/data-intake-jobs/{intakeJobId}`，状态为 `queued / running / succeeded / failed / needs_clarification`。更新现有资产使用原 `/data-assets/{assetId}/snapshots/upload`，处理中和失败时保留旧快照。任务查询只允许提交者且要求项目数据管理权限，不返回云表 token、对象键或凭据。

## 限额与失败处理

- 原始上传最多 50 MB；API 不把 CSV/Excel 完整读入 Buffer。
- CLI 自身并非流式表格查询引擎。每次 `table-get` 设置 2,000,000 字符上限，进程 stdout 另有 12 MiB 上限，超过或截断则失败。
- 当前矩形最多 10,000 条数据、200 列；这只是上限，宽表仍可能先触发字节/字符限制。复杂合并表头、交叉表或多个数据块需要明确范围，不承诺自动正确展开所有 Excel 布局。
- Agent 最多 6 次决策；单次观察上下文最多 40,000 字符，累计最多 100,000 字符；每次输出最多 1,000 token。字符预算不等于供应商计费 token，系统额外记录真实用量。
- 单命令最多 120 秒，模型单次 30 秒，整个已领取任务 8 分钟。上传排队不会消耗模型 token。
- 导入会新建在线表格，不覆盖/追加/删除已有云文件。失败后不自动删除远端文件、不自动重复导入；即使返回 `ready:false`，已取得的远端 token 和导入 ticket 仍保存在内部作业记录，供管理员追溯。崩溃发生在云端导入与引用持久化之间时仍可能有无记录的远端副本，应在专门文件夹人工检查。
- 收到澄清后重新上传会新建一次导入；本轮未实现原作业续答或多用户自助 OAuth。异步任务持续在 Worker 执行；切换项目停止当前浏览器等待。大文件重试和云空间保留策略需要按部署规模管理。
- 来源表格在读取期间变更、返回行列数不匹配或顶层/子表截断时，不能发布 Snapshot。重复列名按真实列位置区分，例如 `销售额 [B]`、`销售额 [C]`。
- 空白 Sheet 以零行观察提供给 Agent，可以继续检查其他 Sheet，但不能发布空快照。手机端打开“历史”面板后也可填写表格说明和选择文件。

## 验收与回滚

使用包含标题行、多个 sheet、重复列以及文本编号 `001` 的小样例，核对原始值、列位置、生成快照行数、图表选定指标和内部作业审计。离线与测试环境禁止调用真实 CLI；集成测试使用真实隔离 PostgreSQL/MinIO 和模拟 CLI/模型。

回滚先停止新增接入并等待运行任务结束，再设置 `TABLE_INGESTION_PROVIDER=local` 并重启。保留新任务表和已生成的不可变快照，无需删除历史记录。

官方依据：[CLI 仓库](https://github.com/larksuite/cli)、[固定版本导入权限](https://github.com/larksuite/cli/blob/v1.0.97/shortcuts/drive/drive_import.go)、[固定版本工作簿命令](https://github.com/larksuite/cli/blob/v1.0.97/shortcuts/sheets/lark_sheet_workbook.go)、[类型化读取实现](https://github.com/larksuite/cli/blob/v1.0.97/shortcuts/sheets/lark_sheet_table_io.go)。
