# 项目记忆系统：Handoff

- 变更编号：CHG-2026-09-24-memory-system
- 状态：A/GA 技术退出门通过；整体变更 VERIFYING（B/C 未授权）
- 创建时间：2026-09-25
- 更新时间：2026-09-29

## 当前状态与授权

用户授权范围为 A1～A4 与 GA；B/C 未授权。`61460f6` 原始质量失败、父提交归因及 rev2/rev3 历史结论均保留。用户于 2026-09-29 批准纳入账号任务的三个测试夹具并确认完成 A/GA；代码提交 `56af7a55287490415aecba09058051a9a626a2be` 基于 `75e83b09da02b47727accd5071f9dad16a7569eb`。分支 `codex/langreport-memory-a-ga-20260929` 已按用户要求推送到 `origin`，包含代码与验收文档提交。候选 A 范围质量门、typecheck、offline 与隔离 Docker 集成通过，完整日志与反事实复测见 test-report.md 指向的证据目录。没有生产操作；整体 Acceptance 保持 DRAFT，因 B/C 未获授权/未实施。

## A 批实施结果

- A1：新增 `0029_memory_identity_private_scope.sql`，保留不可变 Project Memory 版本与逻辑 ID、确认/有效时间、冲突/head 规则；个人偏好落独立 owner 表，私有 Job 引用/使用表不把偏好正文写入共享 Job/Revision。
- A2：实现 Project 记忆与个人偏好的手动创建、编辑、查询、历史/current/as-of/实际使用、冲突及删除撤销；删除写 tombstone、抑制旧来源并清除偏好历史正文与派生私有引用。
- A3：唯一活动 ModelGateway 发送 seam 由 `MemoryInvocationGateway` 包装；发送准入事务重读/锁定适用记忆并过滤删除/来源抑制；完整 Bailian 请求在准入和发送前进行硬预算拒绝。准入后、实际发送前预算拒绝会撤销本次临时使用凭据；Project Memory 和个人偏好均有两种删除/准入竞态证据。
- A4：新增账户 Memory 管理页；同步手动管理 API、OpenAPI、API Console 与账户入口。通用/Workspace Memory 路由维持首期 disabled/410。
- Task 与 Cycle 语义仍按 ADR-0028：澄清同 Task 新 Cycle；本轮未实现 B 批 Task/Cycle 生命周期、压缩或归档。
- 偏好正文不进入 Generation Job API/数据库行、Revision、审计记录或 Worker 日志；真实发送上下文只从 owner 私有引用表解析。

## 验证与快照

- 通过/失败复测/未执行清单：[`test-report.md`](./test-report.md)。A/GA 候选完整质量门、typecheck、offline、startup 与隔离 Docker 集成均通过；Web E2E 四视口 4/4 使用 Mock API 的历史证据仍适用，不代表生产部署。命令与原始日志见候选证据目录及历史 rev3 evidence。
- 独立 Verification agent：rev1 三项阻塞已在 A 范围修复；rev2 TP-25 恢复缺口 GA FAIL；rev3 对 561 文件逐项散列核验，原始 verdict NEEDS-EVIDENCE。2026-09-28 只读补查确认最终 typecheck 日志 31 项完成且无 TS 诊断，并确认最新 format/lint 失败。原报告与补查证据均在 rev3 evidence；独立判断不取代全仓质量门或用户验收。
- rev1 只读快照和清单保留为历史证据：`D:\front\newProject\LangReport-A-GA-2026-09-27\code-snapshot`，476 个文件；清单 SHA-256 `26015abf3357343d6a4fef8f78d6093dea4e5f04962d2a04c5aaeb174222ee9a`。
- rev2 只读快照：`D:\front\newProject\LangReport-A-GA-2026-09-27-rev2\code-snapshot`，476 个文件；清单 SHA-256 `e324066e840e3d831b0ae24a44367c4caabc74231d2a76d93b396956139b7966`；476/476 文件与源工作树逐项匹配且只读。命令日志、首轮 E2E 沙箱失败证据、rev1 报告、rev2-review-report.md 和 `snapshot-info.txt` 位于同级 `evidence/`。
- rev3 只读快照：`D:\front\newProject\LangReport-A-GA-2026-09-27-rev3\code-snapshot`，561 个文件；清单 SHA-256 `b53fcb30981829bffcbcdece6912c657862a33c8c65005bb102107fce06c564c`；独立复核确认 561/561 文件匹配、无缺失且只读。命令输出与摘要、manifest、snapshot-info、独立报告均在同级 `evidence/`。
- A/GA 候选代码 HEAD 为 `56af7a55287490415aecba09058051a9a626a2be`，分支 `codex/langreport-memory-a-ga-20260929`；本次用户明确授权推送该候选分支。主产品工作树及其他账号、登录、工作台和规范修改均未纳入候选，保留原状。
- DeerFlow 仓库只读，没有写入。

## 全仓检查与边界

- A/GA 当前候选提交的作用文件 Prettier 47 项与 ESLint 42 项通过；`pnpm typecheck`、`pnpm test` 通过；隔离 `pnpm test:integration` 的 API 12/12、worker 2/2 通过。`61460f6` 原提交的失败与早期 rev2/rev3 检查均作为历史结论保留，不与最终候选结果混淆。
- 隔离 Postgres 已完成旧备份恢复演练；未运行生产迁移或生产恢复，未使用真实模型供应商、真实用户或生产 HTTPS；不据隔离结果推断线上运行行为。外置账本不自动清理；主机快照若连同该 named volume 一起回滚，仍需运行手册明确保留账本卷的恢复流程。
- 已发送模型请求与已生成报告不可由记忆删除撤回；测试只证明后续准入撤销。
- 原账号数据库接受状态保留；登录网关维持 VERIFYING / PARTIAL，生产 HTTPS、入口限速、公网旁路与备份恢复风险未关闭。

## 历史规划复核

规划阶段的独立只读审查（Pauli，`01a0e13b-8edb-7ab0-a5b1-a20ad893d77c`）提出终态 Task 跨摘要、A 缺完整请求预算拒绝、删除/发送准入竞态和归档并发四项问题。此前已将生命周期问题放入 B 任务，将 A3 硬预算与删除竞态纳入设计和测试计划。此规划审查不等同本轮 A 代码复核。

## 下一步

1. A/GA 技术退出门已完成并推送；本交接无剩余的 A/GA 实施或验证步骤。
2. 整体变更保持 VERIFYING / Acceptance DRAFT；B/C 仅在用户另行授权后启动。
3. 不运行生产操作或真实用户/模型验证；外置撤销账本卷回滚和账号生产部署风险保持其各自任务状态。

## 本次 GA 交接增量（2026-09-28）

- 快照：`D:\front\newProject\LangReport-A-GA-2026-09-28-final`；`committed` 的 552/552 tracked blob 与 HEAD 匹配，`pending-test` 仅叠加未提交的 `apps/api/test/integration/memory-revocation-startup.integration.test.ts` 和 `scripts/test-integration.mjs` 一行接入，`parent` 用于父提交归因。原始命令、退出码、Docker 拒绝日志与启动单项复测脚本均在 `evidence/`，具体索引见 `test-report.md`。
- A/GA 最小测试改动：startup 子进程显式设置 `LANGREPORT_OFFLINE_TEST=0`，避免继承离线绕过开关；新测试检查真实 API/Worker 的缺失/损坏账本启动关闭、运行时关闭与修复后恢复。`run-startup-targeted.ps1` 在合成隔离 schema/ledger 上复跑 exit 0、4/4；完整 `pnpm test:integration` exit 1，未将其记为通过。
- 验证边界：pending-test 离线测试 exit 0、隔离迁移 `db:verify` exit 0；纯提交和 pending-test 的 `pnpm typecheck` 均 exit 1，父提交同样因未提交的账号夹具缺字段而失败。实时工作树 `pnpm typecheck` exit 0，但包含其他任务修复。纯提交 A 文件检查为 Prettier 43 文件中 6 失败、ESLint 38 文件中 39 errors；当前相对 HEAD 的 `pnpm format:check`/`pnpm lint` 只检查 13 个文件、exit 0。
- 其他任务的账号、登录、工作台、规范和相关集成测试修改均保持原状；没有清理或重置工作树。DeerFlow 保持只读。

## 新会话必读

`AGENTS.md`、`CONTEXT.md`、第一阶段产品规格、Agent Loop 规范、`agent-tasks/current-task.md`，以及本目录 `proposal.md`、`design.md`、`task.md`、`test-plan.md`、`test-report.md`、`acceptance.md`。继续前核对当前 HEAD 和工作树，不能以本交接中的快照代替实时事实。
