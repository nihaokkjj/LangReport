# Generation Job 状态同步优化：Test Plan

- 变更编号：`CHG-2026-09-19-GENERATION-JOB-STATUS-SYNC`
- 状态：`VERIFYING`
- 创建时间：2026-09-19
- 更新时间：2026-09-19

## 测试范围

测试覆盖 Generation Job status projection、状态版本、PostgreSQL 通知、API 长轮询、Web watcher、API Console、认证授权、取消清理、兼容回退和请求量目标。

测试不重新验证图表算法本身，但必须回归 Generation Job 成功、失败、澄清、retry、cancel、Revision/Evidence Block 唯一性和完整结果读取，防止状态同步改动破坏生成闭环。

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| 慢请求导致重叠 | Web 单元测试 | 第一个 fetch 挂起超过 900ms | 底层请求数保持 1，完成后才允许下一次请求 |
| 切换上下文不取消旧 fetch | Web 单元/E2E | 请求进行中切换 Project、Conversation 或 Job | 旧 signal 为 aborted，旧响应不能更新新状态 |
| abort 后仍发生迟到写入 | Web 单元测试 | transport 忽略 abort 并返回旧数据 | session token 拒绝旧回调 |
| heartbeat 误触发状态版本 | DB 集成测试 | 多次 Lease heartbeat | `statusVersion/statusChangedAt` 不变 |
| 公开状态更新没有版本 | DB 集成测试 | claim、stage、clarify、fail、success、retry、cancel、lease recovery | 每次公开变化版本严格递增并产生通知 |
| 通知先于事务提交被观察 | DB/API 集成测试 | 事务中更新后延迟 commit | commit 前不返回新状态，commit 后唤醒并读取已提交数据 |
| 通知丢失造成永久等待 | API 集成测试 | 不发送通知但数据库版本已经变化，或等待超时后变化 | 当前请求最多 25 秒结束；下一请求立即读到新版本 |
| 每个 waiter 占用数据库连接 | 性能/集成测试 | 100 个并发长轮询 | API 只有共享监听连接，连接池占用不随 waiter 线性增长 |
| waiter 内存泄漏 | API 集成测试 | notification、timeout、client abort、observer shutdown | 每条路径结束后 waiter 计数回到基线 |
| 越权订阅泄露状态 | API 权限测试 | 未认证、其他 Project 用户、Viewer 读取未发布结果 | 返回与现有 GET 一致的 401/403/404，不注册 waiter |
| 等待期间权限变化 | API 集成测试 | 注册 waiter 后撤销访问并触发通知 | 最终响应重新检查权限，不返回 Job 状态 |
| 终态仍继续请求 | Web 单元/E2E | succeeded/failed/needs_clarification/cancelled | watcher 结束，后续 status 请求数为 0 |
| 完整结果被轻量接口替代 | API/Web 回归 | succeeded 后展示 Evidence | status 仅用于观察，终态执行一次完整刷新，追溯信息完整 |
| 长轮询关闭无法使用 | Web/API 回归 | 配置关闭或 status route 不可用 | 回退到串行自适应轮询，无重叠且可完成 |
| API Console 逻辑漂移 | Console 场景测试 | Loop 4 成功和澄清 Job | 使用同一终态和错误语义，60 秒上限保持 |

## 测试数据与环境

- 使用仓库现有合成销售 CSV 和 Generation Job fixture，不读取生产客户数据。
- PostgreSQL 集成环境使用项目约定的隔离测试数据库。
- API 测试至少准备 owner/editor/viewer/无权用户和两个不同 Project。
- Web watcher 测试使用可控 fetch、fake timer、AbortSignal 和手动完成 Promise。
- 并发 waiter 测试记录 API 进程监听连接数、普通连接池活动连接数和 waiter 数。
- 不调用真实百炼账户；模型路径使用 deterministic 或受控 fake Adapter。

## 自动化测试

### Contracts

- status path、query、200、204 和错误合同存在。
- status projection 不包含 TransformPlan、Flint Spec、previewData、outputs、Lease 或凭据字段。
- 完整 GET 合同保持兼容。

### Database

- 新字段默认值、非空约束和迁移可重复验证。
- heartbeat 不递增版本。
- claim、公开状态提交、过期恢复、retry、cancel 单调递增版本。
- 通知 payload 只有 Job ID 和版本。

### API

- 无 `afterVersion` 立即 200。
- 当前版本高于 `afterVersion` 立即 200。
- 版本相等且发生变化时被通知唤醒并返回 200。
- 版本相等且无变化时在上限内返回 204。
- client abort 会移除 waiter。
- 监听连接中断后等待者能够超时，监听器能够重连。
- 多个 Job 的通知只唤醒匹配 waiter。
- 同一 Job 多个合法客户端可以各自等待，但不增加 LISTEN 连接。

### Web

- 同一标签页、同一 Job 复用 active session。
- 慢请求期间不会启动第二个底层请求。
- Project、Conversation、Job 切换和组件卸载都会 abort。
- 旧 transport 忽略 abort 时，session token 仍阻止陈旧写入。
- 204 后继续等待；网络错误按 1/2/4/8/15 秒退避并带抖动。
- 四种终态停止；成功后只刷新一次完整数据。
- status route 不可用时进入串行 fallback。

### 性能和稳定性

- 模拟 60 秒、8 个可见状态变化的 Job，状态请求总数不超过 15。
- 模拟 100 个并发 waiter，数据库监听连接每 API 进程为 1。
- 连续执行 timeout/abort/notification 各 100 次，waiter 数回到 0。

### 计划执行命令

```text
pnpm --filter @langreport/contracts test
pnpm --filter @langreport/db db:verify
pnpm test:integration
pnpm --filter @langreport/api typecheck
pnpm --filter @langreport/api test
pnpm --filter @langreport/web typecheck
pnpm --filter @langreport/web test
pnpm --filter @langreport/web test:typecheck
pnpm typecheck
pnpm test
pnpm docs:check
```

若新增专项脚本，实际命令必须在 `test-report.md` 和 `acceptance.md` 中记录，不能用计划命令冒充已执行结果。

## 人工验收步骤

1. 在工作台提交一个至少持续 30 秒的 Generation Job，确认状态持续更新且浏览器 Network 中同一 Job 不出现重叠 status 请求。
2. 在请求 Pending 时切换 Conversation，确认旧请求显示 cancelled/aborted，旧 Job 状态不出现在新 Conversation。
3. 在请求 Pending 时切换 Project，执行同样检查。
4. 让 Job 成功，确认 status 请求停止，Evidence Block、Snapshot、Metric Definition、TransformPlan、Flint Spec、Visual Template 和校验记录仍可读取。
5. 分别检查 failed、needs_clarification 和 cancelled，确认终态停止且操作按钮正确。
6. 临时关闭长轮询配置，确认页面回退到无重叠的普通轮询。
7. 运行 API Console Loop 4，确认成功和澄清路径在 60 秒内结束。

## 不测试的内容及原因

- 不测试跨标签页请求合并：MVP 明确只保证单标签页 single-flight。
- 不测试 Worker Queue 通知驱动：属于后续独立变更。
- 不测试 SSE/WebSocket：本设计未采用。
- 不进行真实模型供应商 canary：状态同步不需要外部付费调用。
- 不重新验证图表视觉质量；只回归成功结果可读取和追溯信息完整。
