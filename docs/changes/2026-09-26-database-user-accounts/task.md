# 数据库账号管理：Task

- 变更编号：CHG-2026-09-26-database-user-accounts
- 状态：ACCEPTED（实现与自动化验收通过；生产网络实测待部署环境）
- 创建时间：2026-09-26
- 更新时间：2026-09-26

## 执行前提

- 本变更为 L 级跨模块、身份权限和数据库迁移变更。
- proposal、design、task 和 test-plan 经用户审核并将状态更新为 APPROVED 后，才允许改业务代码。
- 用户已确认共享初始/重置密码、6 字符用户自设密码、CLI-only 管理、无应用级登录限速、Workspace 关系迁移、7 天内旧会话映射，以及自助改密后现存 JWT 保留至各自原 exp 等产品取舍；API 字段、环境变量名、CLI 命令细节仍由本 Design 明确并等待审核。
- 所有 API 修改同步 Contracts、OpenAPI 与 API Console；Web 账号页遵循 DESIGN.md 和 apps/web/AGENTS.md。
- 保留现有工作树修改。旧 login-gateway SDD 继续保持 VERIFYING/PARTIAL；真实 HTTPS Smoke 不得标为通过。

## 任务清单

| ID | 任务 | 依赖 | 可并行 | 负责人 | 状态 | 验证命令 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T0 | 审核账号模型、共享密码、自助改密会话策略和迁移策略 | 无 | 否 | 用户 + 主 Agent | 完成 | 人工审阅 | 用户已批准完整 Proposal、Design、Task、Test Plan 和 ADR |
| T1 | 增加 users schema、唯一规范化用户名、迁移和启动 bootstrap | T0 | 否 | LangReport owner | 完成 | db typecheck、db:verify、DB integration | 空库/有用户/失败事务/重复启动及旧成员关联符合设计 |
| T2 | 将登录 AuthProvider 切换到 DB 用户并添加临时旧 subject 解析 | T1 | 否 | LangReport owner | 完成 | API typecheck、API tests | 新登录签发数据库 user id；旧 subject 最多兼容 7 天 |
| T3 | 实现服务器侧 users CLI | T1 | 可与 T4 后半并行 | LangReport owner | 完成 | CLI 与 DB integration tests | 创建/列表/停用/启用/重置有效；密码不回显或入日志 |
| T4 | 新增自助改密 API、Contracts、API Console 与账号页 | T2 | 否 | LangReport owner | 完成 | API/Contracts tests、Web typecheck、Web E2E | 当前密码验证，6 字符下限，账号页桌面/移动可用 |
| T5 | 同步反向代理限速、配置、Compose、迁移与运维文档 | T1–T4 | 部分可并行 | LangReport owner | 完成（静态与配置校验；生产网络实测未执行） | docs:check、Nginx config check、Compose config | 应用失败窗口移除、入口限速配置和 API 内部暴露已核对 |
| T6 | 独立快照验证、修复、验收和交接 | T1–T5 | 否 | Verification agent + owner | 完成 | Test Plan 中列出的适用命令 | 独立报告、Acceptance 和 Handoff 记录真实证据及环境限制 |

## 执行顺序

    T0 → T1 → T2 → T3/T4 → T5 → T6

T3 与 T4 仅在 T2 稳定后可并行。涉及同一 API 契约或登录代码的任务由主 Agent 顺序集成。

## 并行工作流

- 设计审核期间未启动实现或验证 Agent；T6 将在实现快照完成后启动独立验证角色。
- 完成实现快照后，按 L 级要求启动独立 Verification agent。其工作区必须隔离；只能写测试与 test-report，不改业务代码、范围或决策。
- 主 Agent 负责生产代码、修复、验收文档；独立验证只提供证据，不替代用户验收。

## 阻塞条件

- 用户已批准完整 SDD；T1–T5 按依赖顺序实现。
- 生产数据库未备份、迁移演练不通过、旧身份 ID 不明确或 Workspace/Project 关系无法原子迁移时，暂停上线迁移。
- Nginx/WAF 限速或 API 私网边界不可验证时，不得宣称生产登录防猜测要求已完成。
- 用户确认的“停用/重置/自助改密后会话保留到原 exp”意味着最多 7 天延迟撤销；若产品要求即时撤销，先回到 PROPOSED 修改设计。
- 旧 HTTPS Smoke 已在前一登录网关任务中按用户要求跳过；不能将其历史未验证状态覆盖成 PASS。

## 回滚或替代方案

- 代码上线前可停止部署并保留 schema migration。
- 首个账号、临时旧 ID 映射和成员关系必须在同一事务中写入；任何一步失败事务全部回滚。
- 生产数据迁移前备份并演练恢复。切换后如回滚旧单账号认证，需恢复切换前数据库快照及旧认证配置；业务写入后的数据不得被自动删除或降级。
- 不通过永久保留旧 ID alias 回滚；临时映射最长 7 天。

## Definition of Done

- [x] 用户审核通过 proposal、design、task 和 test-plan；关键 API、迁移和 CLI 设计无未决问题。
- [x] users 表与迁移可在隔离 Postgres 上重放；启动 bootstrap 幂等并验证历史成员迁移。
- [x] 登录、停用、重新启用、CLI 重置和自助改密满足确认的密码与 session 规则。
- [x] 两个账号的 Workspace/Project 授权相互隔离；迁移保留旧数据 ID 和历史来源。
- [ ] 入口限速配置和 API 内部暴露已静态核对；生产公网旁路与真实流量限速需在部署环境验证。
- [x] Contracts、OpenAPI、API Console、Web、Compose、环境示例和运维文档同步。
- [x] API、DB、Contracts、Web 检查及独立测试报告有可复现证据。
- [x] Acceptance 与 Handoff 记录验收结论、未验证的真实 HTTPS/网络风险和后续状态。
