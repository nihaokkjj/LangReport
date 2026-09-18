# Generation Readiness Gate seam 深化：Task

- 变更编号：`CHG-2026-09-18-generation-readiness-gate-seam`
- 状态：`ACCEPTED`
- 创建时间：2026-09-18
- 更新时间：2026-09-18

## 执行前提

- 当前变更必须先通过人工审核，状态变为 `APPROVED` 后才能进入 `IMPLEMENTING`。
- 当前工作树在建档前为干净状态；实现时必须再次检查并保留任何新增的用户修改。
- 主要实现只允许修改 `packages/generation/**`；为移除旧数据传递而修改直接消费者、contracts 或持久化字段时，只允许做机械的最新版 Proposal 接线，不新增产品行为。
- 不保留上一轮 `ClarificationQuestion`/`questions` 投影、双读、双写或历史 payload 回填；现有历史数据可清理或丢弃。

## 任务清单

| ID | 任务 | 依赖 | 可并行 | 负责人 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T0 | 人工审核 proposal/design/task/test-plan；记录意见和遗留问题 | — | 否 | 人工审核 | 完成 | 文档状态检查 | 用户已批准执行；不保留旧数据传递兼容 |
| T1 | 在 `packages/generation` 建立 Generation Diagnostic 类型和稳定错误归一化；移除 Gate 对 `unknown` message 的业务判断 | T0 | 否 | Codex | 完成 | `pnpm --filter @langreport/generation test` | 已知 code 可进入正确分支，未知错误仍 blocked/failed |
| T2 | 实现结构化 Candidate、provenance/evidence 和固定排序；覆盖零/一/多候选 | T0/T1 | 否 | Codex | 完成 | `pnpm --filter @langreport/generation test` | 候选只来自 profiles/TransformResult，重复运行顺序稳定，推荐为候选成员 |
| T3 | 定义 ClarificationProposal，接入 Graph State、GenerationCycle result/audit，并删除旧 `questions` 结果路径 | T1/T2 | 否 | Codex | 完成 | `pnpm --filter @langreport/generation test` `pnpm --filter @langreport/generation typecheck` | Proposal 是唯一澄清结果；不生成旧 questions |
| T4 | 将直接 Worker/API/Web/传输读取切换为 Proposal；清理或丢弃历史澄清 payload，不加入兼容分支 | T3 | 否 | Codex | 完成 | 跨包回归命令 | 活跃路径只读写最新版 Proposal，旧数组不再被解析 |
| T5 | 补齐 generation 单元、Graph 路由和固定销售样例回归 | T1-T4 | 否 | Codex | 完成 | `pnpm --filter @langreport/generation test` | Gate/Cycle/Graph/直接传递风险场景全部有可复现测试 |
| T6 | 运行跨包回归、范围检查和文档同步 | T5 | 否 | Codex | 完成 | 见“验证矩阵” | 机械接线和实现证据回写 acceptance/handoff |

## 执行顺序

```text
T0（人工审核） → T1 → T2 → T3 → T4 → T5 → T6
```

人工审核通过后，先修改 Gate 的输入事实和 Diagnostic，再实现候选，最后让直接消费者切换到 Proposal；不增加其他业务流程。

## 验证矩阵

实现完成后至少运行：

| 范围 | 命令 |
| --- | --- |
| Contracts 回归 | `pnpm --filter @langreport/contracts test` |
| Generation 单测 | `pnpm --filter @langreport/generation test` |
| API 回归与类型 | `pnpm --filter @langreport/api test`；`pnpm --filter @langreport/api typecheck` |
| Generation Worker 回归与类型 | `pnpm --filter @langreport/generation-worker test`；`pnpm --filter @langreport/generation-worker typecheck` |
| Web 回归与类型 | `pnpm --filter @langreport/web test:typecheck`；`pnpm --filter @langreport/web typecheck`；如环境可用再运行 `pnpm --filter @langreport/web test:e2e` |
| 全 workspace 类型 | `pnpm typecheck` |
| 离线测试集合 | `pnpm test` |
| 数据库迁移/Schema | `pnpm --filter @langreport/db db:verify` |
| 文档约束 | `pnpm docs:check` |

## 并行工作流

人工审核完成后，T1/T2/T3 在 `packages/generation` 内顺序完成；T4 只做直接消费者的机械接线。T6 必须在源代码和测试完成后执行，且不把其他包的既有失败误归因给本变更。

## 阻塞条件

- 审核意见要求新增产品行为、修改长期记忆或 Project 规范；
- 结构化 Diagnostic 无法在不解析 error message 的情况下区分已知可恢复问题；
- 候选无法证明来自 profiles/TransformResult，或需要引入模型排序；
- 直接消费者无法在不保留旧双读的情况下切换到 Proposal；
- 任何验证失败且当前上下文不足以判断是本轮改动还是已有问题。

## 回滚或替代方案

- 若 T1 引入的 typed diagnostic 不完整，保留原有 failed 映射并暂停 Proposal 接入，不将不可靠的 message 识别重新扩大为新规则。
- 若 T2 的候选证据不能稳定计算，返回零候选 Proposal，不伪造字段，不引入新的数据访问接口。
- 若直接接线需要新的业务流程，暂停并重新提交设计审核；不得通过兼容层绕过范围判断。
- 代码回滚仅针对本变更新增的 generation 文件/修改；不得使用破坏性 Git 清理覆盖用户修改。

## Definition of Done

- T0 已记录人工审核结论，且只有 `APPROVED` 后才执行 T1-T6。
- Diagnostic、Candidate、Proposal 的不变量由 generation 单测和 Cycle 回归覆盖。
- 现有 `needs_clarification`、`drafted`、`failed` 状态语义保持不变；澄清结果只使用最新版 Proposal，旧 `ClarificationQuestion` 投影不再存在。
- 候选不来自模型、不使用随机或时间、不写入长期记忆或项目规范。
- `packages/generation` 专项验证、直接消费者/传输回归、全量 typecheck/test、db verify 和 docs check 的结果已记录。
- `acceptance.md`、`handoff.md`、git diff 和实际修改范围一致；未验证内容不得标记为完成。
