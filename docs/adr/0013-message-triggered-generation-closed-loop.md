# ADR 0013：发送消息触发一次 Generation Cycle

## 状态

已接受；第一期已实施，第二至第四期待实施。

## 背景

当前 Web 将保存 Conversation 消息和创建 Generation Job 拆成两个动作：用户先点击“发送”，再点击“生成证据”。这不符合“用户描述分析问题后得到产物”的最小产品心智模型，也容易使用户发送的消息与实际生成的 prompt 不一致。

当前生成接口在带有 `conversationId` 时会再次写入用户消息。如果直接在前端串联两个请求，会产生重复消息，并使 Conversation projection、幂等键和生成审计难以解释。

## 决策

生成型发送统一使用现有 Conversation 消息接口：

```text
POST /api/v1/conversations/:conversationId/messages
```

当请求包含 `generate=true` 时，API 在一个应用层流程中完成：

1. 校验 Project 权限和生成前置条件；
2. 写入一条用户消息；
3. 固化 Conversation projection；
4. 固化 Snapshot、Metric Definition、Theme 和 Model Route；
5. 创建一个幂等的 Generation Job；
6. 返回消息、Job 和下一步动作。

Generation Job 不再重复插入同一条用户消息。成功、澄清和失败的 assistant 消息由异步生成流程在终态追加。

## 取舍

### 选择统一消息接口

优点：

- 用户动作和产品语义一致；
- 一次发送对应一次 Generation Cycle；
- 更容易保持消息、Job 和审计的因果关系；
- 前端只需维护一套提交和轮询状态。

代价：

- Conversation message API 同时承担普通消息和生成命令；
- 需要扩展现有 HTTP contract；
- 需要处理“消息已保存但 Job 未创建”的可解释响应。

### 不选择保留两个按钮

保留两个动作实现成本较低，但用户必须理解内部 Generation Job 概念，且会继续存在 prompt 不一致、重复消息和忘记点击生成的问题。因此不作为最小闭环方案。

## 不变量

- 一次生成型发送最多一条用户消息和一个 Generation Job；
- 幂等键重复提交不得创建新的消息、Job、Revision 或 Evidence Block；
- 前置条件不足时可以保存消息，但不得创建成功产物；
- 生成成功始终创建 Draft，不自动批准；
- Job 必须固化单一 Data Snapshot、Metric Definition 和 Conversation projection；
- assistant 终态消息不得包含未由 Job 事实支持的结论。

## 影响

需要同步修改：

- `packages/contracts` 的消息请求/响应 Schema；
- `apps/api/src/routes.ts` 的消息和生成逻辑；
- `apps/web/app/page.tsx` 的发送、轮询和状态展示；
- Generation Job / Evidence 的 `resultSummary` 持久化；
- API contract 测试和本地端到端验收脚本。
