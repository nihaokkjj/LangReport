# 独立测试报告

- 变更编号：LANGREPORT-2026-09-30-lark-table-agent
- 状态：TEST_PASSED（独立离线与隔离集成范围；真实云端尚未验证，不代表业务最终验收）
- 创建时间：2026-09-30
- 更新时间：2026-10-01
- 角色：独立 Verification Agent，仅测试与报告，不修改业务实现

两项独立发现的 P2 已由主 Agent 修复并通过定向复测；本报告范围内没有未解决的阻断缺陷。全仓离线测试、类型检查、独立专项和隔离集成已通过。真实飞书 OAuth、在线导入与计费模型调用均未执行。

## 快照与环境

工作树为 `D:\front\newProject\LangReport`，base commit 为 `1e279bc63d8300e31b839c4c45b33fdbfae0cbc4`。初始只读快照由 [implementation-snapshot-initial.json](./implementation-snapshot-initial.json) 记录，创建时间为 `2026-09-30T10:46:30.857Z`，共 39 个 SHA-256；修复快照见 [implementation-snapshot.json](./implementation-snapshot.json)。

- 开始核验：`2026-09-30T10:48:56.2395713Z`，39/39 一致。
- 原轮结束核验：`2026-09-30T11:16:19.3684995Z`，38/39 一致。唯一变化是主 Agent 已明确通知的移动端验收修补：`apps/web/test/e2e/consulting-report.spec.ts` 从 `1c3e793f26fcd208e66567c5a6d9dd1ba1be36a08bfd85b9cbec1653e9a5eb49` 变为 `c97ed814c18b2f89c992c62a15cd013c80c130ff5126d44418b8ebfc8b8a5c79`。本轮后端、Agent、Worker、合同文件均未漂移；修复后已转入新快照复测。
- 修复复测起点：`2026-09-30T11:19:00.6085422Z`，40/40 一致，对应 `2026-09-30T11:18:19.556Z` 创建的快照。新增第 40 项是移动端入口涉及的 `apps/web/app/globals.css`。主 Agent 后续只继续调整 E2E 的就绪时序，未修改后端文件。
- 最终快照创建于 `2026-09-30T11:22:15.827Z`；在 `2026-09-30T11:23:00.5687823Z` 与收尾时的 `2026-10-01T08:05:37.2090211Z` 均核验为 40/40 一致。快照清单文件本身 SHA-256 为 `d0233fcc55335054e31d8dcba11630ebd67397bf46ab8b0d0b0d801c529a0c0e`。
- 系统为 Windows / PowerShell。默认执行沙箱因 `helper_unknown_error: apply deny-read ACLs` 无法启动；后续使用已获自动审批的只读/离线或隔离测试执行，没有绕过审批拒绝。
- 未读取 `.env` 或账号凭据，未执行 `lark:check`、真实授权、真实导入或计费模型。CLI 只执行 `--version` / `--help`；所有业务 CLI 和模型调用均为桩。
- 集成测试只通过 `pnpm test:integration` 使用 `127.0.0.1:54330` / `127.0.0.1:9002` 的独立 schema/bucket，未使用默认开发数据库。

## 实际执行与原始结果摘要

所有命令均从仓库根目录执行。

| 命令/核验 | 独立执行结果 |
| --- | --- |
| `pnpm test` | exit 0；离线保护合同、workspace unit tests 全部通过；没有 skip/fail 导致的伪通过 |
| `pnpm typecheck` | exit 0；workspace 源码和已有测试类型检查通过 |
| `pnpm test:integration` | exit 0；API `tests 13, pass 13, fail 0`；Worker `tests 2, pass 2, fail 0`；隔离资源清理完成 |
| 修复后 `pnpm test:integration` | session `21098` 已完成并取回 exit 0；API `pass 13, fail 0`，其中表格接入用例含 pending token/ticket 落库、旧快照不变断言；Worker `pass 2, fail 0`。API 原始耗时 `91407.6701 ms`，Worker `5466.306 ms`；没有因中断重跑 |
| `pnpm lark --version` | `lark-cli version 1.0.97` |
| `pnpm lark sheets +table-get --help` | 确认支持 `--sheet-id`、`--range`、`--no-header`、`--max-chars`；说明明确指出列类型推断和混合类型转字符串 |
| TEMP 独立专项脚本 | `tests 9, pass 9, fail 0`。前 8 项是正确性断言；第 9 项断言原始缺陷仍可复现，不能把其 pass 解读为缺陷已修复 |
| 修复后独立专项脚本 | exit 0；`tests 12, pass 12, fail 0`。修复后将诊断断言改为 4 项正确行为/反例断言，其余 8 项仍通过 |
| SHA-256 开始/结束核验 | 见上一节，业务实现未在本轮执行中漂移 |
| `pnpm docs:check` / `git diff --check` | exit 0；报告链接校验与工作树空白检查通过 |

专项脚本已保存为 [independent-verification.mts](./independent-verification.mts)。复现命令：

```powershell
node apps/api/node_modules/tsx/dist/cli.mjs --test docs/changes/2026-09-30-lark-table-agent/independent-verification.mts
```

原轮执行原件位于 `$env:TEMP\langreport-lark-independent-verification.mts`。仓库脚本使用 `process.cwd()`，并已更新为修复后的 12 项可复现测试；原始缺陷结果保留于本报告。

## 已验证范围

1. 字段保真：以 `C4:J5` 偏移范围验证列位置 C–J、重复列、与自动生成列名碰撞、空白列、`__proto__`、文本编号 `001`、日期和布尔值。列没有覆盖，字段画像和原始列位置保持一致。
2. 表头：150 字真实表头在模型观察中截为 120 字，但通过单独的 header read 获取完整名称后才进入 Snapshot。现有回归样例验证第二张 sheet、第三行表头、重复指标列。
3. 完整性：顶层及子表 `truncated`、`has_more`、`complete=false`、非空 `unread_sheets` 均拒绝；行列数量不符、200 列/10,001 读取行上限和非有限数字被拒绝。既有用例验证读取期间 revision 变化不发布 Snapshot。
4. 模型预算：重复检查最多 6 次决策，导入只发生一次；单次上下文超过 40,000 字符时阻止下一次模型调用，累计超过 100,000 字符前停止；固定模型标识、`max_completion_tokens=1000`、`enable_thinking=false` 和真实用量字段通过离线请求桩核验；冻结 route 被修改后不发出请求。
5. 身份/工具边界：错误 open_id 在导入前停止；用户和 Workspace 绑定、专用 profile、子进程环境凭据过滤由现有用例验证；模型决策含额外任意命令字段时 Schema 拒绝，不能变为 CLI 命令。生产执行器采用白名单及 `shell:false` 的代码审查结论与离线约束一致。
6. API → 队列 → Worker → Snapshot：真实隔离 PostgreSQL/MinIO 集成验证上传返回 202/processing、同一个 Job 并发领取只有一个成功、源文件内容保留、读取结果形成不可变 Snapshot、状态变为 succeeded 后才返回 Snapshot ID、外人查询遭拒且状态不暴露云 token。更新失败保留旧 Snapshot 和 ready 状态；超期任务终止且不能重领、不会再次导入。
7. 图表：仓库回归用例实际运行，sum/avg 共存时使用模型选择的 avg，未知 yField 不产出成功图表。此次新增字段绑定的 x/y/series 在实现中检查转换后字段存在性；既有 `tooltipFields` 完整支持不作为本轮已验证能力，也不把此前已存在的遗漏当作本次新增回归。

## 发现与复测

### V1 — P2：合法空工作表会终止整个选择流程

位置：[table-agent.ts](../../../packages/lark-data/src/table-agent.ts) 的 `parseTypedGrid` / `parseRange`。

固定 CLI 在空工作表返回合法空结构：

```json
{"sheets":[{"name":"Sales","range":"","columns":[],"dtypes":{},"data":[]}]}
```

原始快照中，Agent 执行 `inspect_sheet` 后，`parseTypedGrid` 调用 `parseRange("")`，抛出 `LARK_RANGE_INVALID`，整个作业结束。独立复现原始输出为：

```json
{"blankSheet":{"decisions":1,"savedTraces":[]}}
```

预期：空 sheet 是可观察事实，Agent 能据此继续检查其他 sheet 或澄清；不得把空 sheet 发布为有效 Snapshot。这个问题会阻断含空白 sheet 的多表工作簿在检查阶段继续决策；不涉及静默数据损坏。

官方依据：[v1.0.97 readSheetAsSpec](https://github.com/larksuite/cli/blob/v1.0.97/shortcuts/sheets/lark_sheet_table_io.go) 的 `emptySpec` 分支。源码下载到 TEMP 只用于只读协议核验。

复测状态：已在修复快照上独立通过。验证空 sheet → 检查另一张 sheet → 成功形成数据表；空 sheet 选择被 `LARK_SELECTION_UNVERIFIED` 拒绝；显式请求范围与空响应不一致或空响应带截断标志时仍失败，未为了兼容空 sheet 放松完整性校验。

### V2 — P2：异步导入的有效恢复引用丢失

位置：[table-agent.ts](../../../packages/lark-data/src/table-agent.ts) 的导入结果验证和 `onImported` 调用顺序。

固定 CLI 的 `RunImport` 始终返回 ticket/type/ready；若服务端已经给出 token，也会在 `ready=false` 时返回 token，随后添加 `timed_out` 和 `next_command`。用该合法协议构造：

```json
{"ready":false,"type":"sheet","token":"pendingToken","ticket":"ticket123","timed_out":true}
```

原始快照实际结果：在调用 `onImported` 前抛出 `LARK_IMPORT_INCOMPLETE`，token 和 ticket 均未保存。独立原始输出：

```json
{"unfinishedImport":{"persistedTokens":[]}}
```

预期：在不重试或重复导入的前提下保留有效恢复引用，管理员能定位服务端已经开始的导入；不能把“有 token/ticket 但尚未 ready”与“从未取得引用”混为一类。操作手册承诺保留已取得远端 token；原实现不满足该边界。

官方依据：[v1.0.97 drive_import.go](https://github.com/larksuite/cli/blob/v1.0.97/shortcuts/drive/drive_import.go)，`RunImport` 第 184–216 行。这个复现只使用合法协议桩，没有创建真实飞书文件。

复测状态：工具层和 Worker 落库均已独立通过。`token+ticket`、`ticket-only`、`非法 token+有效 ticket` 三种输入均保留可用引用，再返回 `LARK_IMPORT_INCOMPLETE`，全过程只有 auth/import 两次 CLI 调用、0 次模型决策。第二轮隔离集成确认 `remoteToken=pendingToken`、`audit.importTicket=ticket123` 已持久化，Job 为 `failed/LARK_IMPORT_INCOMPLETE`，旧 Snapshot 数量仍为 1，原 Asset 仍为 ready。

## 覆盖缺口与限制

- 真实飞书 OAuth、应用 scope、profile 与用户的在线验证、导入数据在服务端的实际类型保真和真实模型结构化输出兼容性均未验证，不能据此标记真实云端验收通过。
- 模型字符预算是应用上下文限额，不是供应商实际计费 token 上限；真实用量只验证了审计字段的离线采集。
- 单 Job 双领取已实测；跨进程崩溃、提交响应丢失、读取期间真实远端并发编辑没有故障注入，仅有对应保护代码和部分协议桩覆盖。
- 本角色未独立运行桌面/手机浏览器测试。主 Agent 已修复手机 `.rail-source` 隐藏问题，并报告真实填写提示、点击可见文件选择按钮、hint 入请求、等待/成功/澄清状态在 desktop/mobile 两项均通过。截图为[桌面](./evidence/table-hint-desktop.png)与[手机](./evidence/table-hint-mobile.png)，由主 Agent 查看；本报告只记录其来源，不将其冒充为本角色独立浏览器证据。
- 没有独立重跑 ESLint。主 Agent 提供的 `lint-baseline.json` 显示本次前后均为 23 个已有错误；本报告不把该转述替代独立 lint 证据。
- 测试 Agent 不批准业务范围，也不代替人工验收。两项 P2 的定向复测、修复后的隔离集成以及最终 40 文件核验已完成；真实云端验收仍待专用飞书账号授权后执行。

## 2026-10-02 owner 增量记录（非独立复核）

以上独立报告及 40 文件快照保持为历史结论。真实 OAuth 后，owner 发现 `+workbook-info` 实际返回 `sheet_name`，原实现及此专项脚本的模拟目录使用 `title`。已修正业务映射和夹具，并新增名称结构/资源类型反例；原独立覆盖不能宣称发现或防止了这一真实兼容错误。

新增独立 Agent 复核请求因该 Agent 用量上限而未执行。owner 已更新本文件所链接专项脚本的三个目录夹具并执行 12/12；lark-data unit 11/11、相关类型、隔离集成 API 13 + Worker 2 通过。新 40 文件快照见 `implementation-snapshot-live.json`，相对旧快照仅 3 个实现/测试文件变化。

owner 还完成真实 HTTP → 常驻 Worker → 飞书与模型 → Snapshot → 利润图表，详情与显示限制见 [live-verification.md](./live-verification.md)。该补充不把 owner 的结果改称独立证据，也不替用户批准最终验收。
