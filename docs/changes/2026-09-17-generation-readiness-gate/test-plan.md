# 生成前提决策门：Test Plan

- 变更编号：`CHG-2026-09-17-generation-readiness-gate`
- 状态：`APPROVED`
- 创建时间：2026-09-17
- 更新时间：2026-09-17

## 测试范围

验证从确定性候选生成、Generation Cycle 终态、Job 持久化、API 权限到 Web 交互合同的最小闭环。

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| 候选凭空出现 | Gate 单元 | 候选字段不在 Snapshot | 不生成该候选 |
| 只有一个候选被静默采用 | Contracts/Gate | 只有一个日期或维度字段 | 仍返回 needs_clarification |
| Transform 丢失横轴被误判为系统失败 | Generation 回归 | intent 有维度但 transform 无该字段 | 返回 MISSING_X_FIELD 澄清 |
| 用户选择绕过字段校验 | Generation 回归 | selectedValue 不在 profiles | 不生成草稿，返回可解释失败/澄清 |
| 旧 Job 被覆盖 | API 集成 | 提交 Generation Decision | 新 Job 有父 Job，旧 Job 不变 |
| 用户停止被当成失败 | API/合同 | 取消 needs_clarification Job | status=cancelled，无 retry |
| 非目标异常被吞掉 | Generation 回归 | 模型鉴权或 Snapshot 读取错误 | 保持 failed 原语义 |
| UI 状态不可读 | Web 类型/人工 | 澄清、停止、长中文候选 | 语义文本、触控尺寸和移动布局正常 |

## 测试数据与环境

- `tests/fixtures/consulting/monthly-regional-sales` 固定销售快照；
- 额外构造“TransformPlan 丢弃月份/区域”的内存 TransformResult；
- 离线确定性 Model Gateway；不调用真实百炼；
- API 测试使用现有测试数据库和权限夹具。

## 自动化测试

- `packages/contracts/test/unit/model.test.ts` 和 `http.test.ts`；
- `packages/generation/test/unit/index.test.ts` 新增 Gate/Decision 回归；
- `packages/generation/test/unit/readiness-gate.test.ts`；
- `apps/api` 现有 HTTP/路由测试扩展 cancel 与父 Job 校验；
- `pnpm --filter @langreport/generation-worker typecheck`；
- `pnpm --filter @langreport/web typecheck`；
- `pnpm docs:check`、`pnpm typecheck`、`pnpm test`。

## 人工验收步骤

1. 创建咨询 Project，导入区域销售数据并确认 Brief/Metric。
2. 触发会导致横轴缺失的生成请求。
3. 确认界面显示推荐项、候选字段和字段证据，且没有伪造图表。
4. 选择候选并提交，确认新 Job 进入队列，旧 Job 仍为 `needs_clarification`。
5. 返回澄清面板并点击停止，确认显示“已停止”，没有失败重试按钮。

## 不测试的内容及原因

- 运行中 Job 的取消：本轮明确不做；
- 完整质量阈值和“接受风险”：后续需求；
- 多文件 Join、Dashboard 和非图表生成：超出第一阶段。

## 实际执行记录

- Contracts：25/25；Generation：22/22；API：29/29；Generation Worker：9/9。
- `pnpm typecheck`、`pnpm test`、`pnpm --filter @langreport/db db:verify`、`pnpm docs:check` 通过。
- Web desktop/mobile Playwright：10/10 通过；新增澄清状态沿用现有工作台的响应式断点和触控尺寸规则。
- 未调用真实百炼或外部供应商；相关鉴权失败仍保持系统失败语义，不由 Readiness Gate 吞掉。
