# 飞书表格接入恢复与工具审计：设计

- change-id：`CHG-2026-10-04-lark-intake-recovery`
- 状态：`DRAFT`
- 创建时间：2026-10-04
- 更新时间：2026-10-04

## 现状与约束

`apps/api/src/table-intake.ts` 创建 Data Intake Job；`apps/generation-worker/src/table-intake.ts` 单次领取并调用 `packages/lark-data`。当前 `data_intake_jobs` 保存 `remote_token`，而导入 ticket 仅在 `audit` JSONB。`runLarkTableAgent` 总是先执行 `+workbook-import`，即使原任务已有恢复引用。过期任务直接失败。固定 CLI 1.0.97 的本机 `drive +task_result --help` 显示 `--scenario import --ticket` 为只读查询；正式实现前应以固定版本协议夹具确认其完整输出结构。

一个成功 Data Intake Job 只发布一个不可变 Data Snapshot。旧 Snapshot 在新版本接入失败时仍可用。命令边界仅允许固定白名单，显式 profile 和 user 身份，子进程不继承模型/存储/数据库密钥。原文件与云表内容均属不可信输入。

## 方案与边界

采用“持久化恢复引用 + 状态续查”，不重放创建导入动作。将 CLI 执行包装成类型化方法：`startImport`、`getImportResult(ticket)`、`getWorkbookInfo`、`getRevision`、`getTypedRange`。模型只产生 `inspect_sheet`、`select_table` 或 `clarify` 决策，不能构造命令参数中的 ticket/token。CLI adapter 将参数逐项验证；恢复路径只接受本 intake job 已保存的引用。

拒绝“失败后重新运行整个 Agent”方案：它会再次导入。也不把 `ready=false` 当作不可恢复错误；有效 ticket 是已建立的服务端任务标识。缺失引用时不能证明外部创建未发生，因此标记结果未知，由管理员核查。

## 状态与持久化

建议增加 `import_ticket`、`import_ready`、`stage` 和有限的 `resume_count` 字段，并增加 `awaiting_import` 状态。迁移对旧记录只提取格式合法的 `audit.importTicket` 作为人工核查信息，不自动重新排队。状态流：

```text
queued → running/importing → awaiting_import → running/resolving
                                     ↓                    ↓
                               failed/unknown       running/reading
                                                          ↓
                                               succeeded + Snapshot
```

- 首次领取：若没有已保存引用，只允许一次 `startImport`。调用前持久化 `stage=importing`；响应的 ticket/token 必须先落库，再推进状态。
- `ready=false` 且有 ticket：转 `awaiting_import`，后续领取只调用 `getImportResult(ticket)`。未就绪可在有界退避后继续等待；超过总期限转终态，保留 ticket 供人工核查，不新建导入。
- 已确认 `ready=true` 且有 token：保存 `import_ready=true`，后续恢复跳过导入，重新验证身份、工作簿版本并继续选表/读取。
- 进程在 `stage=importing` 且无引用时消失：结果不确定，标记 `LARK_IMPORT_OUTCOME_UNKNOWN`，不得自动重新发起导入。
- 每次状态提交仍匹配 job、execution token 和期限；Snapshot 插入与任务成功仍同事务。若数据库提交结果未知，先查 Snapshot ID，再决定后续补偿。

`awaiting_import` 的 API 状态应有中文可理解的说明；普通用户只见状态、错误和最终 Snapshot ID，不返回 ticket/token。Web 等待超时仅停止浏览器等待，不改变后台任务。`api-console` 与 OpenAPI 同步状态枚举和示例。

## 工具调用审计

每条 CLI 调用保存结构化摘要：intake job ID、阶段、命令类别、开始/结束时间、耗时、结果码、响应是否截断、返回行列数/字节数。命令参数只记录已验证的 sheet ID/范围等非凭据摘要；ticket/token 不写公共日志。stderr 仍只用于有界诊断，不持久化原文。模型调用继续记录 route fingerprint、输入/输出 token 和结果状态，并补调用序号以与工具轨迹关联。

审计写入失败应让该阶段停止或进入可解释故障，不能发布无来源/无调用记录的 Snapshot。审计体积设上限，并在压力测试中核对上限内的最后错误可见。监控指标只聚合成功率、耗时、模型 token、导入等待时间和 `OUTCOME_UNKNOWN` 数量。

## 权限、迁移与回滚

任务创建者、Project、Workspace、飞书 profile/open_id 在恢复时再次验证；不接受客户端传入 ticket/token。旧 Worker 不识别新状态，迁移与新 Worker 必须作为一个发布单元；回滚应先停止新任务与 Worker，保留 additive 字段和历史引用，不能让旧 Worker 重放含 ticket 的任务。现有失败任务不自动恢复。若未知远端结果，需要人工核查专用文件夹；本设计不申请删除权限。

## 待验证的外部协议

固定 CLI 1.0.97 对 `drive +task_result --scenario import --ticket` 的成功、待处理、明确失败和协议异常响应需建立真实脱敏夹具。仅 `--help` 确认命令存在，不能替代响应结构验证。没有 ticket 的命令失败路径是否通过 CLI 结构化错误暴露服务端任务 ID，也要实测；在确认前按结果未知处理。

## 需求追踪矩阵

| 需求 | 设计 | 任务 | 计划验证 | commit |
| --- | --- | --- | --- | --- |
| R1 无重复导入 | ticket 状态续查 | T2/T3 | 模拟 pending→ready 与导入计数 | 待实施 |
| R2 同一 Snapshot | 恢复读取与事务提交 | T3/T4 | 中断/并发集成测试 | 待实施 |
| R3 结果未知停止 | importing 无引用终态 | T3 | 故障注入测试 | 待实施 |
| R4 完整审计 | CLI wrapper 摘要 | T2/T4 | 审计脱敏与规模测试 | 待实施 |
| R5 权限与兼容 | 绑定复核、API 投影 | T1/T4/T5 | 权限/API/Web 回归 | 待实施 |
