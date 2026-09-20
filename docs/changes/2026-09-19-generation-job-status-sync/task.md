# Generation Job 状态同步优化：Task

- 变更编号：`CHG-2026-09-19-GENERATION-JOB-STATUS-SYNC`
- 状态：`VERIFYING`
- 创建时间：2026-09-19
- 更新时间：2026-09-19

## 执行前提

- `proposal.md`、`design.md`、本任务清单和 `test-plan.md` 获得人工审核并进入 `APPROVED`。
- 当前未提交的 API route registration、contracts 和 API Console 修改已经完成、提交或明确交接，实施时不得覆盖。
- 已确认目标部署代理允许至少 25 秒的长请求；否则先调整 `waitMs` 上限和验收值。
- 实施前重新检查 `git status` 和相关文件 diff。
- 本轮不修改 Worker Queue 的每秒扫描行为。

## 任务清单

| ID | 任务 | 依赖 | 可并行 | 负责人 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | 固化基线：为当前重叠请求和未取消 fetch 增加可复现测试 | 审核通过 | 否 | Agent | DONE | Web 专项测试 | watcher 单飞、迟到响应保护和 abort 测试通过 |
| T2 | 增加 `statusVersion/statusChangedAt` Schema、迁移、递增规则和 PostgreSQL 通知 | T1 | 否 | Agent | DONE | `pnpm --filter @langreport/db db:verify`；DB 集成测试 | 迁移 ledger、真实 schema 回放、通知触发和版本递增验证通过 |
| T3 | 在 contracts 中增加 status projection、query 和 200/204/error 响应合同 | T2 | 是 | Agent | DONE | `pnpm --filter @langreport/contracts test` | OpenAPI 精确描述新接口且不改变完整 GET |
| T4 | 实现 API `GenerationJobObserver`、status route、权限、超时、断开清理和可观测指标 | T2/T3 | 否 | Agent | DONE | `pnpm --filter @langreport/api typecheck`；`pnpm --filter @langreport/api test` | 单监听连接分发等待者、权限和清理逻辑已实现 |
| T5 | 实现 Web `GenerationJobStatusWatcher` 并替换工作台固定 interval | T3/T4 | 否 | Agent | DONE | `pnpm --filter @langreport/web typecheck`；Web 专项测试 | 单标签页 single-flight、上下文 abort、终态停止、fallback 已通过 |
| T6 | 同步 API Console 的 OpenAPI 展示、请求示例与 Loop 4 状态等待 | T3/T5 | 是 | Agent | DONE | `pnpm --filter @langreport/web test:typecheck`；Loop 4 场景 | Console 使用 status operation 和同一终态语义 |
| T7 | 增加请求量、并发 waiter、通知丢失和连接重连测试 | T4/T5/T6 | 否 | 测试 Agent | PARTIAL | test-plan 中专项命令 | 已覆盖 Web 单元、真实 PostgreSQL 100 waiter 和离线回归；连接数/长时请求量/重连证据待补 |
| T8 | 增加部署开关、回退路径、指标说明和运维文档 | T4/T5 | 是 | Agent | DONE | `pnpm docs:check` | `GENERATION_STATUS_LONG_POLL=false` 与串行 fallback 已实现 |
| T9 | 完整回归、验收证据、文档同步和 handoff | T1-T8 | 否 | Agent + 测试 Agent | VERIFYING | `test-report.md` | 离线与真实 DB 集成检查通过，人工浏览器和专项性能证据待补 |

## 执行顺序

```text
人工批准
  → T1 缺陷基线测试
  → T2 数据版本与通知
  → T3 合同
  → T4 API Observer/Route
  → T5 Web Watcher
  → T6 API Console
  → T7 性能与恢复测试
  → T8 运维/回退文档
  → T9 验收与交接
```

T3 在 T2 的字段和状态语义冻结后开始。T6 可以在 T5 watcher Interface 稳定后与 T7 的 API 侧测试准备并行，但不得让 API Console 出现另一套状态等待实现。

## 并行工作流

- 主实现流：T1-T6、T8，由主 Agent 按依赖推进。
- 独立测试流：审核 `test-plan.md`；等待 T4/T5 代码快照后执行 T7，只修改测试和 `test-report.md`，不修改业务实现。
- 文档流：T8 可在 T4/T5 Interface 冻结后与部分测试并行。

## 阻塞条件

- 现有 route registration 变更仍在修改相同 route/contracts/API Console 文件，且无法安全合并。
- 生产代理不支持有界长请求，且没有可接受的 `waitMs` 上限。
- PostgreSQL 连接层无法提供稳定的专用 LISTEN 连接。
- `statusVersion` 无法覆盖所有用户可见状态更新路径。
- 权限检查无法在等待前后保持与现有接口一致。
- 自动化测试无法证明 abort、single-flight 或 waiter 清理。

出现阻塞时保持变更为 `REVIEWING` 或 `IMPLEMENTING`，记录证据，不降级权限或删除测试来结束。

## 回滚或替代方案

- 关闭长轮询特性后，status route 只执行立即读取。
- Web watcher 回退到串行、自适应普通轮询；仍保留 single-flight 和 abort。
- 保留现有完整 GET 作为最终结果读取和兼容入口。
- 新数据库字段保留，不执行破坏性回滚；通知函数可以停用。
- 若共享 LISTEN 连接不稳定，先发布 P0 的串行自适应轮询，长轮询保持关闭，待修复后再启用。

## Definition of Done

- R1-R9 均有实现和可复现测试证据。
- 单标签页 single-flight、上下文切换 abort、session token 防陈旧写入均通过自动化测试。
- 状态接口响应轻量、权限一致、超时有界、断开可清理。
- heartbeat 不递增 `statusVersion`；所有公开状态变化递增并通知。
- 60 秒 Job 请求数和 100 waiter 连接目标达标。
- contracts、OpenAPI、API Console 同步完成。
- `pnpm --filter @langreport/contracts test`、DB verify、API/Web checks、仓库适用 typecheck/test、`pnpm docs:check` 通过。
- `acceptance.md`、`handoff.md` 和必要架构文档已更新，工作树没有夹带无关修改。
