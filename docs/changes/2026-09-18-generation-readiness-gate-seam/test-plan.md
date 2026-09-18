# Generation Readiness Gate seam 深化：Test Plan

- 变更编号：`CHG-2026-09-18-generation-readiness-gate-seam`
- 状态：`ACCEPTED`
- 创建时间：2026-09-18
- 更新时间：2026-09-18

> 审核结论：用户已批准按最新版 Proposal 执行；历史澄清 payload 不纳入兼容测试。

## 测试范围

验证 `packages/generation` 内部从结构化 Diagnostic 到 Candidate、ClarificationProposal、Graph 终态和最新版直接传递的确定性 seam。跨包命令验证直接消费者已切换，不保留上一轮兼容路径。

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| 错误文案变化导致状态漂移 | Gate 单元 | 相同 `MISSING_X_FIELD` code 使用不同 message | 结果均为同一 Proposal；不解析 message |
| 未知异常被误转为澄清 | Gate/Cycle 回归 | 未知 compile code 或无 Diagnostic | `blocked`/`GENERATION_COMPILATION_FAILED`，不产生 Proposal |
| 候选凭空出现 | Gate 单元 | 字段不在 profiles 且不在 TransformResult.columns | 不生成候选 |
| 候选来源丢失 | Gate 单元 | 输出字段、Snapshot-only 字段、lineage | source 和 `requiresTransformAdjustment` 与事实一致 |
| 指标被当作横轴候选 | Gate 单元 | measure、`*_sum`、派生数值字段 | 排除指标字段；不伪造横轴 |
| 候选顺序不稳定 | Gate 单元/重复运行 | 同一输入重复执行、输入顺序变化 | 顺序按固定 key 稳定，推荐项一致 |
| 推荐被误认为自动选择 | Proposal 单元 | 零/一/多候选 | `requiresUserDecision=true`；一候选也不自动采用 |
| 推荐不是候选成员 | Proposal 单元 | 构造候选集合和推荐 | schema/断言保证推荐引用候选集合，空集合推荐为空 |
| Proposal 丢失在 Graph seam | Generation/Graph 回归 | Compile 缺少横轴 | 当前 Cycle 终止为 `needs_clarification`，audit/结果含 Diagnostic/Proposal |
| 旧数据路径残留 | Generation/API/Worker/Web 回归 | 搜索/运行活跃路径中的 `questions`、旧数组读取和双写 | 活跃路径只使用 Proposal；历史 payload 不做回填或双读 |
| Gate 变成通用规则引擎 | 范围审计 | 检查 diff 和依赖 | 无新 package、注册表、配置规则、模型调用或跨层改动 |

## 测试数据与环境

- 使用现有 `packages/generation/test` 固定销售 Snapshot、profiles、TransformResult 和 deterministic Model Gateway。
- 至少覆盖：月份/区域/销售额完整样例；Transform 丢失月份；只有一个候选；没有候选；包含高缺失率和高基数字段；未知编译错误。
- 测试不调用真实百炼、外部模型、数据库或 Web 服务；跨包命令使用仓库现有离线测试配置。

## 自动化测试

拟新增或扩展 `packages/generation/test/unit/readiness-gate.test.ts`、`packages/generation/test/unit/index.test.ts`，必要时扩展 Graph route 单元覆盖：

1. `GenerationDiagnostic` 只能通过 code/stage/target 进入已知 evaluator。
2. Candidate 集合、provenance、evidence 和排序在重复运行中稳定。
3. `ClarificationProposal` 的候选/推荐/用户决策边界满足不变量。
4. `GenerationCycleResult` 和 `GenerationCycleAudit` 只包含最新版 Proposal/Diagnostic，不再生成旧 questions 投影。
5. Proposal 终止后不进入 Transform/Validate/Render；非目标错误仍失败。

已按批准范围运行以下命令；历史澄清 payload 不纳入兼容测试：

```text
pnpm --filter @langreport/contracts test
pnpm --filter @langreport/generation test
pnpm --filter @langreport/api test
pnpm --filter @langreport/api typecheck
pnpm --filter @langreport/generation-worker test
pnpm --filter @langreport/generation-worker typecheck
pnpm --filter @langreport/web test:typecheck
pnpm --filter @langreport/web typecheck
pnpm typecheck
pnpm test
pnpm --filter @langreport/db db:verify
pnpm docs:check
```

Web E2E 不属于本轮新增产品行为；若环境可用，作为直接消费者回归运行 `pnpm --filter @langreport/web test:e2e`，确认 Proposal 数据能被现有澄清面板消费。不得新增 UI 行为或把 E2E 失败改写为 Gate 缺陷。

本轮曾启动 Web E2E；首个 desktop/mobile 用例在启动后立即失败，测试进程未输出可归因的断言并被终止。该可选回归不作为验收依据；Web `typecheck` 与 `test:typecheck` 已通过。

## 人工验收步骤

人工审核通过并完成实现后：

1. 用固定销售 Snapshot 触发一个缺少月份横轴的 Compile 场景。
2. 检查结果只包含 `MISSING_X_FIELD` Diagnostic、Proposal 和候选 provenance/evidence，不再生成旧 questions。
3. 修改错误 message 但保持结构化 code，确认 Proposal 和候选顺序不变。
4. 检查推荐只是 Proposal 的 recommendation；没有 Generation Decision 时不应生成图表或修改输入。
5. 触发未知 Compile 错误，确认仍显示为系统失败语义而非澄清。
6. 检查 `git diff --name-only`，确认变更集中在 `packages/generation/**`，以及为最新版 Proposal 必需的 contracts、Worker、API、Web、DB 机械接线。

## 不测试的内容及原因

- 新 HTTP/DB/Worker/Web 功能：本轮只允许为最新版 Proposal 做机械接线，不新增功能。
- 真实模型候选或模型排序：本轮明确要求确定性候选。
- 通用规则注册、质量 warning 接受风险、运行中取消：超出本轮 Gate seam。
- 长期记忆、Metric Definition、Visual Template 和项目规范写入：本轮不改变持久化业务规则。
