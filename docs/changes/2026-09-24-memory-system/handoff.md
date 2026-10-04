# 项目记忆系统：Handoff

- 变更编号：CHG-2026-09-24-memory-system
- 状态：VERIFYING（提交快照质量门与完整集成未通过；startup 单项通过）
- 创建时间：2026-09-25
- 更新时间：2026-09-28

## 当前状态与授权

用户仅授权 A1～A4、GA 及 TP-25。A 批代码已提交为 `61460f6ab2f4a80534fea3c9b0ff0e231953895e`；rev2 GA FAIL、rev3 NEEDS-EVIDENCE 和当时 9 文件/41 条诊断均保留为历史结论。2026-09-28 本次纯提交快照复核发现 A 提交文件 Prettier 6 文件、ESLint 39 errors，完整集成与纯提交 typecheck 也未通过；实时混合工作树的 13 文件检查及 typecheck 虽通过，但证据范围不同。整体 GA 保持 VERIFYING，Acceptance 保持 DRAFT。未进行生产操作或用户最终接受；B/C、Git 推送与再次提交均未获本轮授权。

## A 批实施结果

- A1：新增 `0029_memory_identity_private_scope.sql`，保留不可变 Project Memory 版本与逻辑 ID、确认/有效时间、冲突/head 规则；个人偏好落独立 owner 表，私有 Job 引用/使用表不把偏好正文写入共享 Job/Revision。
- A2：实现 Project 记忆与个人偏好的手动创建、编辑、查询、历史/current/as-of/实际使用、冲突及删除撤销；删除写 tombstone、抑制旧来源并清除偏好历史正文与派生私有引用。
- A3：唯一活动 ModelGateway 发送 seam 由 `MemoryInvocationGateway` 包装；发送准入事务重读/锁定适用记忆并过滤删除/来源抑制；完整 Bailian 请求在准入和发送前进行硬预算拒绝。准入后、实际发送前预算拒绝会撤销本次临时使用凭据；Project Memory 和个人偏好均有两种删除/准入竞态证据。
- A4：新增账户 Memory 管理页；同步手动管理 API、OpenAPI、API Console 与账户入口。通用/Workspace Memory 路由维持首期 disabled/410。
- Task 与 Cycle 语义仍按 ADR-0028：澄清同 Task 新 Cycle；本轮未实现 B 批 Task/Cycle 生命周期、压缩或归档。
- 偏好正文不进入 Generation Job API/数据库行、Revision、审计记录或 Worker 日志；真实发送上下文只从 owner 私有引用表解析。

## 验证与快照

- 通过/失败复测/未执行清单：[`test-report.md`](./test-report.md)。rev3 离线、集成、Memory 单测、隔离 DB 核验已通过；2026-09-28 最终 `pnpm typecheck` 复跑 exit 0。Web E2E 四视口 4/4 的 rev2 证据仍适用，期间无 Web 运行时代码变化。命令与原始日志见 rev3 evidence。
- 独立 Verification agent：rev1 三项阻塞已在 A 范围修复；rev2 TP-25 恢复缺口 GA FAIL；rev3 对 561 文件逐项散列核验，原始 verdict NEEDS-EVIDENCE。2026-09-28 只读补查确认最终 typecheck 日志 31 项完成且无 TS 诊断，并确认最新 format/lint 失败。原报告与补查证据均在 rev3 evidence；独立判断不取代全仓质量门或用户验收。
- rev1 只读快照和清单保留为历史证据：`D:\front\newProject\LangReport-A-GA-2026-09-27\code-snapshot`，476 个文件；清单 SHA-256 `26015abf3357343d6a4fef8f78d6093dea4e5f04962d2a04c5aaeb174222ee9a`。
- rev2 只读快照：`D:\front\newProject\LangReport-A-GA-2026-09-27-rev2\code-snapshot`，476 个文件；清单 SHA-256 `e324066e840e3d831b0ae24a44367c4caabc74231d2a76d93b396956139b7966`；476/476 文件与源工作树逐项匹配且只读。命令日志、首轮 E2E 沙箱失败证据、rev1 报告、rev2-review-report.md 和 `snapshot-info.txt` 位于同级 `evidence/`。
- rev3 只读快照：`D:\front\newProject\LangReport-A-GA-2026-09-27-rev3\code-snapshot`，561 个文件；清单 SHA-256 `b53fcb30981829bffcbcdece6912c657862a33c8c65005bb102107fce06c564c`；独立复核确认 561/561 文件匹配、无缺失且只读。命令输出与摘要、manifest、snapshot-info、独立报告均在同级 `evidence/`。
- 当前 HEAD 为 `61460f6ab2f4a80534fea3c9b0ff0e231953895e`：按用户新授权仅提交 A/GA 已验证代码、测试、迁移及必需配置，未提交 SDD/ADR 或其他任务工作树修改，也未推送。其他账号、登录、工作台与规范修改保持未暂存；不执行 reset/clean。
- DeerFlow 仓库只读，没有写入。

## 全仓检查与边界

- rev3 `pnpm test`、`pnpm test:integration`、Memory 单测与隔离 DB `db:verify` 通过；Web E2E rev2 4/4。2026-09-28 最终 `pnpm typecheck` exit 0；标准 `format:check` exit 1（9 文件），`lint` exit 1（41 errors），全仓质量检查仍不记通过。文档、边界、卫生和 diff 检查的既有日志在 rev3 evidence，文档更新后需复核。
- rev3 `pnpm format:check` 有 9 个文件仍需整文件格式化；逐文件与 HEAD 基线、A 新增片段的归因见 `test-report.md` 和 evidence。A 自有 Memory 文件及 A 在共享文件中的新增片段已单独格式化。2026-09-28 标准 `pnpm lint` 已能启动 ESLint，但仍报告 41 条诊断；此前的 `minimatch@10.2.6` 启动错误仅作历史记录。诊断已逐行归因，未将共享文件身份作为排除理由；未发现 A 新增记忆符号的 lint 错误。全仓检查仍失败。
- 隔离 Postgres 已完成旧备份恢复演练；未运行生产迁移或生产恢复，未使用真实模型供应商、真实用户或生产 HTTPS；不据隔离结果推断线上运行行为。外置账本不自动清理；主机快照若连同该 named volume 一起回滚，仍需运行手册明确保留账本卷的恢复流程。
- 已发送模型请求与已生成报告不可由记忆删除撤回；测试只证明后续准入撤销。
- 原账号数据库接受状态保留；登录网关维持 VERIFYING / PARTIAL，生产 HTTPS、入口限速、公网旁路与备份恢复风险未关闭。

## 历史规划复核

规划阶段的独立只读审查（Pauli，`01a0e13b-8edb-7ab0-a5b1-a20ad893d77c`）提出终态 Task 跨摘要、A 缺完整请求预算拒绝、删除/发送准入竞态和归档并发四项问题。此前已将生命周期问题放入 B 任务，将 A3 硬预算与删除竞态纳入设计和测试计划。此规划审查不等同本轮 A 代码复核。

## 下一步

1. 按 `test-report.md` 新增的提交快照证据处理纯 A 提交文件的 6 个格式失败、39 条 lint 诊断和父提交已存在的账号测试类型失败；任何适用例外需明确记录，不能把基线归因当成通过。本轮不跨任务整文件格式化。
2. 在可访问隔离 Docker 的环境复测完整集成恢复场景，并单独定位提交快照的两个非记忆 `DATA_PROCESSING_ERROR`；不得以 startup 单项 4/4 或 rev3 历史通过覆盖这次 exit 1。
3. 质量门与集成门明确通过或获准例外后再判技术 GA；用户最终接受前 Acceptance 保持 DRAFT。B/C、生产操作、再次提交与 Git 推送不在本轮。

## 本次 GA 交接增量（2026-09-28）

- 快照：`D:\front\newProject\LangReport-A-GA-2026-09-28-final`；`committed` 的 552/552 tracked blob 与 HEAD 匹配，`pending-test` 仅叠加未提交的 `apps/api/test/integration/memory-revocation-startup.integration.test.ts` 和 `scripts/test-integration.mjs` 一行接入，`parent` 用于父提交归因。原始命令、退出码、Docker 拒绝日志与启动单项复测脚本均在 `evidence/`，具体索引见 `test-report.md`。
- A/GA 最小测试改动：startup 子进程显式设置 `LANGREPORT_OFFLINE_TEST=0`，避免继承离线绕过开关；新测试检查真实 API/Worker 的缺失/损坏账本启动关闭、运行时关闭与修复后恢复。`run-startup-targeted.ps1` 在合成隔离 schema/ledger 上复跑 exit 0、4/4；完整 `pnpm test:integration` exit 1，未将其记为通过。
- 验证边界：pending-test 离线测试 exit 0、隔离迁移 `db:verify` exit 0；纯提交和 pending-test 的 `pnpm typecheck` 均 exit 1，父提交同样因未提交的账号夹具缺字段而失败。实时工作树 `pnpm typecheck` exit 0，但包含其他任务修复。纯提交 A 文件检查为 Prettier 43 文件中 6 失败、ESLint 38 文件中 39 errors；当前相对 HEAD 的 `pnpm format:check`/`pnpm lint` 只检查 13 个文件、exit 0。
- 其他任务的账号、登录、工作台、规范和相关集成测试修改均保持原状；没有清理或重置工作树。DeerFlow 保持只读。

## 新会话必读

`AGENTS.md`、`CONTEXT.md`、第一阶段产品规格、Agent Loop 规范、`agent-tasks/current-task.md`，以及本目录 `proposal.md`、`design.md`、`task.md`、`test-plan.md`、`test-report.md`、`acceptance.md`。继续前核对当前 HEAD 和工作树，不能以本交接中的快照代替实时事实。
