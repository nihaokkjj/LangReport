# 交接

- 变更编号：LANGREPORT-2026-09-30-lark-table-agent
- 状态：VERIFYING
- 创建时间：2026-09-30
- 更新时间：2026-10-02

## 已完成

固定 CLI、显式账号绑定、有界子进程、结构化表格 Agent、异步持久化 intake、流式源文件传输、不可变 Snapshot、Web 等待/表格说明、OpenAPI/API Console 契约、图表字段绑定和自动化验证。真实 CLI 安装、版本/help/dry-run 已验证。0031 迁移已应用本地开发数据库。

实现文件清单见 `changed-files.txt`。旧独立验证快照保留于 `implementation-snapshot.json`，真实协议修复后的快照为 `implementation-snapshot-live.json`。Git 基线 main / 1e279bc63d8300e31b839c4c45b33fdbfae0cbc4；没有提交或推送。工作树原有记忆系统、账号和 UI 未提交修改仍保留，不能纳入本次完成声明。

## 当前进行中与下一步

2026-10-02 真实 OAuth 已完成：专用 profile `langreport` 使用用户新建应用，联网验证用户身份后已更新本地连接；`pnpm lark:check` 通过，开关为 `lark`。不要回填旧应用 open_id 或 bot open_id，不要复用已消耗的 device flow，也不要在聊天、报告或 Git 中保存任何凭据。

真实导入发现 CLI 的 `sheet_name` 与原代码 `title` 不匹配，已修复业务映射、单元与集成夹具。最新 unit 11/11、专项 12/12、隔离 API 13 + Worker 2、相关类型通过。增量独立 Agent 因用量上限未执行；最新证据由 owner 产生，旧独立结论只适用于旧快照。

运行中的本地 HTTP 上传及后台 Worker 已真实通过，多 Sheet/第 3 行表头/重复列/编号 001/不可变旧快照均已验证。利润图表合计为华东 45、华南 30，源字段为利润，计划与渲染程序校验通过；PNG 的边缘柱形裁切是尚未修复的显示问题。详见 [真实验证](./live-verification.md)。本地工作台可直接使用，最终用户验收仍待实际使用。

当前完整开发服务由隐藏后台 `pnpm dev:all` 启动，2026-10-02 启动时父 PID 为 14200；后续操作前重新核实 PID/命令，不能盲目终止历史 PID。启动元数据与日志在系统 TEMP 的 `langreport-lark-live-OqVeLT` 中。端口 Web 3000/API 4000；配置改动若热重载仍出现身份差异，应完整重启开发服务并重新检查。早先失败的 HTTP 作业没有产生远端导入，失败状态保留。

## 验证入口

见 [acceptance.md](./acceptance.md)、[test-plan.md](./test-plan.md)、[操作手册](../../operations/lark-table-intake.md)。真实数据接入通过，不自动标记业务 ACCEPTED，也不把程序渲染校验当作完整视觉验收。

## 已知限制

单用户/Workspace 连接，读取单个矩形表，一行表头；限额和错误处理以操作手册为准。待澄清任务目前需补充提示重新提交，不续用旧导入；失败远端副本不自动删除。没有生产发布、全量 Excel 写回、多用户 OAuth 或无限规模查询引擎。
