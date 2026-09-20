# Generation Job 状态同步优化：Design

- 变更编号：`CHG-2026-09-19-GENERATION-JOB-STATUS-SYNC`
- 状态：`VERIFYING`
- 创建时间：2026-09-19
- 更新时间：2026-09-19

## 现状与约束

当前 Web 工作台使用固定 900ms `setInterval` 请求 `GET /api/v1/generation-jobs/:jobId`。回调是异步函数，但 interval 不等待 Promise，因此慢请求可能重叠。React effect 清理会清除 interval 并设置本地 `cancelled` 标记，能够避免多数旧响应写入状态，但不会取消已经发出的网络请求。

现有 GET 返回完整 Generation Job 和结果对象，包含 Intent、TransformPlan、字段血缘、Flint Spec、Plan/Render Validation、预览数据和输出信息。状态观察只需要少数字段，不应持续传输完整结果。

Generation Job 的 `updatedAt` 同时被状态推进和 Worker Lease heartbeat 更新。长轮询若使用 `updatedAt` 判断用户可见变化，会被心跳错误唤醒。因此需要独立状态版本。

必须保持以下约束：

- PostgreSQL 是 Generation Job 状态的事实来源；通知只负责降低等待成本，不负责保存状态。
- Generation Job 的权限、Project 作用域和 Viewer 可见性规则不能因长轮询弱化。
- Worker Lease、owner、lease token、Fencing Token 和未过期校验保持不变。
- 现有完整 GET 接口继续可用，避免破坏 API Console 和外部调用者。
- 新增或修改接口时，同一变更必须同步 contracts、OpenAPI 和 API Console。
- 单个标签页内保证 single-flight；跨标签页去重不属于 MVP。

## 设计目标与非目标

### 目标

- 用一个小而稳定的状态监听 Interface 隐藏长轮询、取消、退避、停止和兼容回退逻辑。
- 状态探测只传输最小摘要，终态再读取完整结果。
- 同一标签页、同一 Job 最多一个底层状态请求。
- Project、Conversation 或 Job 变化时真实 abort 旧请求，并拒绝迟到响应。
- 通知丢失时仍能通过数据库重新读取和有界超时得到正确结果。

### 非目标

- 不把 Generation Job 改造成事件溯源聚合。
- 不保证前端观察到每一个短暂中间状态；前端只需得到当前最新状态，审计仍以持久化业务记录为准。
- 不在本轮改变 Worker Queue 的领取和扫描方式。
- 不增加 SSE、WebSocket 或跨标签页 leader election。

## 方案选型

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 仅把固定间隔调大 | 改动小 | 仍有无效请求；状态延迟与负载直接冲突；不解决响应体和取消 | 拒绝 |
| 串行自适应短轮询 | 容易回退；消除重叠 | 任务越长请求越多；仍持续访问 API | 作为兼容回退 |
| HTTP 长轮询 + PostgreSQL 通知 | 复用现有 fetch、认证和 JSON 合同；请求量低；部署边界变化较小 | 需要等待器生命周期、共享监听连接和代理超时治理 | MVP 主方案 |
| SSE | 单连接持续推送，事件表达自然 | Header 认证、代理、重连和 API Console 支持更复杂 | 当前不采用，后续按规模评估 |
| WebSocket | 双向实时能力强 | 明显超过单 Job 状态同步需求，运维和授权复杂 | 拒绝 |

## 模块边界

### GenerationJobStatusWatcher Module（Web）

Interface：

```ts
watchGenerationJob(input: {
  jobId: string;
  afterVersion?: number;
  signal: AbortSignal;
  onStatus(snapshot: GenerationJobStatusSnapshot): void;
}): Promise<GenerationJobStatusSnapshot | null>;
```

Implementation 内部拥有：

- 单标签页内按 Job ID 管理的 active session registry；
- long-poll 请求、204 重连和网络错误退避；
- `AbortController` 组合与 session token；
- 终态识别；
- 长轮询关闭或不可用时的串行自适应普通轮询 Adapter。
- API 通过 `GENERATION_STATUS_LONG_POLL=false` 可关闭等待；Watcher 收到禁用标记后以串行 900ms 读取兜底。

页面只需要订阅状态和处理最终结果，不了解间隔、重试、响应码或取消竞态。

### GenerationJobObserver Module（API）

Interface：

```ts
waitForChange(input: {
  jobId: string;
  afterVersion: number;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<"changed" | "timeout">;
```

Implementation 使用每个 API 进程一个 PostgreSQL `LISTEN` 连接，并在内存中按 Job ID 分发通知。HTTP request 不持有数据库连接；收到通知后 route 重新读取 PostgreSQL，通知 payload 不被当作授权或业务事实。

### Generation Job status projection（Contracts/API）

状态读取只暴露：

- `id`
- `status`
- `operation`
- `attemptCount`
- `repairCount`
- `errorCode`
- `errorMessage`
- `clarificationProposal`
- `statusVersion`
- `statusChangedAt`
- `terminal`

完整 Job 结果继续由现有 GET 返回。

## 数据模型与状态流转

在 `generation_jobs` 增加：

```text
status_version      integer not null default 1
status_changed_at   timestamptz not null default now()
```

`statusVersion` 在以下路径递增：

1. Worker 原子领取使状态从 `queued` 进入 `profiling`，或从 `rendering` 进入渲染处理状态；
2. 持有有效 Lease 的 Worker 提交新的用户可见阶段、澄清、失败或成功结果；
3. 过期 Lease 恢复到 `queued` 或 `rendering`；
4. 用户允许的 retry 重新排队；
5. 用户取消等待澄清的 Job；
6. 用户可见的错误、澄清提案、attempt/repair 次数在状态不变时发生变化。

以下更新不递增：

- heartbeat；
- lease owner、token、fencing token、过期时间或 heartbeat 时间的纯内部更新；
- 不影响 status projection 的审计或内部元数据更新。

Job 创建时版本为 1。版本只单调递增，不回退、不复用。`statusChangedAt` 与版本递增同时更新。

PostgreSQL 在插入 Job 或 `status_version` 改变后发送通知。通知在事务提交后才会被监听者看到，payload 仅包含 Job ID 和版本。通知丢失不影响持久化状态。

## API / 外部契约

### 新接口

```http
GET /api/v1/generation-jobs/:jobId/status
```

Query：

| 参数 | 类型 | 默认值 | 规则 |
| --- | --- | --- | --- |
| `afterVersion` | 非负整数 | 无 | 省略时立即读取；传入时等待更高版本 |
| `waitMs` | 非负整数 | `0` | 服务端 clamp 到 `0..25000`；只有同时传 `afterVersion` 时才等待 |

响应：

- `200`：当前版本高于 `afterVersion`、未要求等待，或等待期间发生变化；正文为 status projection。
- `204`：等待到期但版本没有变化；无正文，返回当前版本 Header。
- `400`：query 无效。
- `401/403/404`：沿用当前认证、Project 权限和资源隐藏策略。

Headers：

```text
Cache-Control: no-store
X-LangReport-Generation-Job-Version: <integer>
```

现有完整 GET 不改变语义：

```http
GET /api/v1/generation-jobs/:jobId
```

创建 Job 的响应可以继续返回现有 `nextAction`，并增加可选的 `statusUrl` 或标准 `Location` Header；是否加入返回正文由 contracts 评审决定，但不得破坏现有调用者。

## 架构图

```text
Web GenerationJobStatusWatcher
        │ GET /generation-jobs/:id/status?afterVersion=N&waitMs=25000
        ▼
API auth + Project access check
        │
        ├─ DB current version > N ───────────────► 200 status snapshot
        │
        └─ DB current version = N
                 │ register waiter (no DB connection held)
                 ▼
       GenerationJobObserver
                 │
        shared PostgreSQL LISTEN connection
                 │
      ┌──────────┴──────────┐
      │                     │
statusVersion changed     25s timeout / client abort
      │                     │
      ▼                     ├─ timeout ─────────► 204
re-read DB + re-check       └─ abort ───────────► cleanup only
permission/state
      │
      └────────────────────────────────────────► 200 latest snapshot

Terminal snapshot
      │
      ├─ stop watcher
      └─ one full Job/Evidence/Conversation refresh
```

## 数据流

### 正常状态变化

1. Web 用当前 `statusVersion` 发起长轮询。
2. API 完成认证、Job 读取和 Project 可见性检查。
3. 版本未变化时，API 将 request signal 注册到 observer 后释放数据库查询连接。
4. Worker 在有效 Lease 下提交状态和 `statusVersion + 1`。
5. PostgreSQL 事务提交后发送通知。
6. API observer 唤醒对应 Job 的等待者。
7. Route 重新读取 Job、重新执行可见性判断，并返回最新 projection。
8. Web 更新状态并以新版本继续等待。

### 超时路径

1. 25 秒内没有通知。
2. API 清理 waiter 并返回 `204`。
3. Web 立即发起下一次有界长轮询；新请求先读数据库，因此能够恢复漏掉的通知。

### 切换 Project/Conversation/Job

1. React effect 清理调用 watcher session 的 `abort()`。
2. 浏览器 fetch 收到 abort，API request signal 清理 waiter。
3. session token 失效；即使底层环境晚于 abort 返回结果，旧回调也不能写入当前页面。
4. 新上下文为新 Job 建立独立 session。

### 网络失败路径

1. watcher 捕获非主动 abort 的网络错误。
2. 采用 1、2、4、8、15 秒上限的指数退避，并加入随机抖动。
3. 恢复后带最后已确认版本重新请求；服务端返回最新状态。
4. 网络错误不写成 Generation Job `failed`，也不自动调用 retry。

## 权限、校验与异常处理

- 等待前先完成身份认证、Job 存在性和 Project 访问检查。
- 通知只作为唤醒信号；唤醒后必须重新读取数据库，不能直接返回通知 payload。
- 最终响应前重新应用 Viewer/Revision 可见性规则，避免等待期间权限变化造成泄露。
- `waitMs` 必须有服务端硬上限；无效 query 返回稳定的 400 错误合同。
- 每个 request close/abort、timeout、notification 和 observer shutdown 路径都必须移除 waiter。
- API 进程应设置等待器总量保护；达到上限时回退为立即状态读取或返回可重试的受控错误，不能无限增长内存。
- `LISTEN` 连接断开时记录错误并重连；已有等待者可以超时返回，不能挂起到进程结束。
- status projection 不包含 Lease token、凭据、对象路径或原始模型正文。

## 迁移、兼容与回滚

部署顺序：

1. 先部署数据库迁移和向后兼容的 API；旧 Web 仍使用完整 GET。
2. 验证 status 接口、监听连接和指标后启用新 Web watcher。
3. API Console 在同一变更内切换并验证。

兼容与回滚：

- 现有完整 GET 始终保留。
- Web watcher 在 status 接口返回 404/501 或特性开关关闭时，回退到串行自适应普通轮询。
- 长轮询可由部署配置关闭，关闭后 status 接口立即返回当前状态。
- 新字段保留不会改变旧客户端行为；回滚应用代码时无需删除 Job 或 Revision 数据。
- 不使用破坏性回滚迁移删除已经写入的版本字段。

## 日志、监控与可观测性

至少记录聚合指标，不记录 Prompt 或业务正文：

- status 请求总数、200/204/4xx/5xx 分布；
- 等待时长和状态变化到响应的延迟；
- 每进程当前 waiter 数和峰值；
- observer 监听连接重连次数；
- client abort、timeout 和 notification wakeup 数；
- Web 每 Job 请求次数、最大并发请求数、回退次数；
- terminal 后额外 status 请求数，应为 0。

## 测试策略

- Web watcher 单元测试使用 fake timer 和可控 fetch，证明 single-flight、abort、session token、退避和终态停止。
- API 单元/集成测试覆盖 immediate read、通知唤醒、204 timeout、断开清理、并发 waiter 和监听重连降级。
- DB 测试覆盖版本单调性、heartbeat 不递增、领取/推进/恢复/retry/cancel 递增。
- 权限测试覆盖未认证、越权、Viewer 和等待期间权限变化。
- API Console 场景覆盖成功、澄清和 60 秒总时限。
- 性能测试模拟 60 秒 Job 与 100 个并发 waiter，核对请求数和数据库连接数。

## 需求追踪矩阵

| 需求 | 设计 | 任务 | 测试 | commit |
| --- | --- | --- | --- | --- |
| R1 单标签页同 Job single-flight | D1 watcher registry + 串行循环 | T5 | Web watcher 慢请求并发测试 | 通过单元测试 |
| R2 切换上下文真实取消旧请求 | D2 AbortController + session token | T5 | Project/Conversation/Job 切换测试 | 代码 guard + abort 单元测试通过；真实浏览器待验收 |
| R3 状态请求使用轻量 projection | D3 独立 status contract | T3/T4 | Contract/API 响应字段测试 | 通过 |
| R4 有界长轮询降低请求量 | D4 25 秒 wait + 204 | T4/T5 | 60 秒请求数量测试 | 实现与 fallback 测试通过；60 秒专项性能待补 |
| R5 心跳不产生用户状态变化 | D5 独立 statusVersion | T2 | DB heartbeat 版本测试 | 真实 PostgreSQL 集成通过 |
| R6 通知丢失仍可恢复 | D6 timeout 后重新读 DB | T4/T5 | 丢失通知与重连测试 | 超时回读与不可用 fallback 已覆盖；重连专项待补 |
| R7 权限和 Project 隔离不回归 | D7 等待前后权限检查 | T4 | API 认证/授权集成测试 | 通过现有 API/集成测试 |
| R8 API Console 同步 | D8 共享 watcher 策略 | T6 | Loop 4 成功/澄清测试 | 代码与 Web 类型检查通过 |
| R9 可回滚和兼容旧客户端 | D9 保留完整 GET 与 fallback | T4/T5/T8 | 特性关闭/接口不可用测试 | 通过 fallback/关闭开关测试 |
