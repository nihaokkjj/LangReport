# 飞书表格接入恢复与工具审计：任务

- change-id：`CHG-2026-10-04-lark-intake-recovery`
- 状态：`DRAFT`
- 创建时间：2026-10-04
- 更新时间：2026-10-04

## 执行前提

本变更为 L 级。先确认用户选择的接入路线，完成 design 审核后才能修改业务代码。当前 `CHG-2026-10-03-evidence-correctness-repair` 仍在实施；开始本变更前须记录其工作树状态和文件交叉范围，不覆盖其修改。无提交、推送、部署或真实客户数据操作授权。

## 任务清单

| ID | 任务 | 依赖 | 完成标准 |
| --- | --- | --- | --- |
| T0 | 固定 CLI 1.0.97 响应契约与真实脱敏夹具 | 审核通过 | pending/ready/failed/异常四类可解析；明确未知路径 |
| T1 | additive schema、状态合同及 API Console | T0 | 旧任务不自动续跑；状态/迁移/DTO 一致 |
| T2 | 类型化 CLI adapter 与结构化审计 | T0 | 白名单、参数校验、脱敏与调用摘要可测 |
| T3 | Worker 持久化恢复和幂等发布 | T1/T2 | 仅一次导入，按 ticket 续查；中断后同一 Snapshot 最多发布一次 |
| T4 | API/Web 等待状态和操作说明 | T1/T3 | pending 与未知结果可理解；移动/桌面状态正常 |
| T5 | 故障注入、隔离集成、独立复验 | T1–T4 | test-plan 必需项通过；工作树快照与失败证据完整 |

## 验证入口

`pnpm --filter @langreport/lark-data test`、`pnpm --filter @langreport/api test`、`pnpm test:integration`、`pnpm typecheck`、`pnpm --filter @langreport/web typecheck`、`pnpm docs:check`、`pnpm db:verify`、`git diff --check`。UI 改动前读完整 `DESIGN.md`；接口改变同步 `api-console`。

## 阻塞与回滚

- 固定 CLI 响应无法验证：停在 T0，不按猜测实现恢复解析。
- 无法证明导入是否创建：终止自动续跑，保留人工核查信息。
- 新旧 Worker 混跑可能重复创建：发布前先停旧 Worker；回滚保留新 schema 和引用，禁止旧 Worker 领取含恢复状态的任务。

## Definition of Done

已批准设计的 R1–R5 在同一代码快照通过自动化、隔离集成和独立复验；API Console、操作文档、迁移与回滚记录同步；不把本地模拟测试写成真实云端验收。
