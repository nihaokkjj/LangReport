# 数据库账号管理：Handoff

- 变更编号：CHG-2026-09-26-database-user-accounts
- 状态：ACCEPTED（生产部署验收项待环境验证）
- 创建时间：2026-09-26
- 更新时间：2026-09-26

## 当前状态

用户已完成账号设计选择并于 2026-09-26 批准完整 SDD。本变更的实现与自动化验收已完成；自助改密后现存 JWT 保留至各自原 exp、最长 7 天的策略已确认。

## 已完成

- 核对现有单部署身份登录、scrypt hash、HS256 Cookie、默认 7 天 session、应用内失败窗口与 Nginx 限速。
- 核对 users 表目前不存在，members.user_id 与 project_members.user_id 为 text。
- 整理启动 seed、旧成员关系迁移、旧 JWT 临时映射、CLI-only 账号管理、自助改密和安全边界。
- 编写 proposal、design、task、test-plan、acceptance、handoff 和 ADR；用户已批准完整 SDD。

## 已完成实现

- 新增数据库 users、首用户引导迁移、DB 登录/旧 subject 有限映射和服务器 CLI。
- 新增自助改密 API 与 `/account` 页面，同步 Contracts、OpenAPI、API Console 和部署文档。
- 移除应用内失败窗口，更新入口限速与 Compose 内部 API 暴露配置。
- 完成主工作区自动化验证和隔离快照独立复核；最新 Workspace 隔离账号集成测试通过。

## 下一步

1. 部署前备份数据库并演练恢复；在目标环境应用 `0028_database_user_accounts.sql`，配置 `AUTH_BOOTSTRAP_USERNAME`、`AUTH_SHARED_DEFAULT_PASSWORD`，旧部署迁移时设置 `AUTH_LEGACY_USER_ID`。
2. 在部署入口实测登录限速、确认 API 无公网旁路，并运行真实 HTTPS Cookie Smoke；这些运行时验收需要部署环境，目前未执行。
3. 遵守旧 login-gateway 任务 `VERIFYING/PARTIAL` 状态，完成其真实 HTTPS 验收后再更新该旧任务记录。

## 当前 commit 与修改范围

- 当前实现、自动化验收和账号范围代码审查均已完成，进入提交准备阶段。
- 本次修改范围按已批准的 task.md 执行，覆盖 packages/db、apps/api、apps/web、contracts、infra 和运维文档。
- 既有未提交登录页、CONTEXT、旧 login-gateway acceptance/handoff/task、记忆系统文档和 ADR 0025/0026 均保留在工作区，没有加入本次暂存区。
- agent-tasks/current-task.md 跟踪本变更并保留前一登录网关 VERIFYING/PARTIAL 状态；agent-tasks/decisions.md 已登记 WDG-011。

## 已运行验证

- 主工作区：DB/API/Contracts/Web typecheck 与 test:typecheck 通过；API 单测 38/38、Contracts 单测 26/26、Web 单测 24/24。
- 主工作区：完整 E2E 48 passed、4 skipped；账号页与 API Console targeted E2E 通过。最新 API Console 凭据脱敏用例 2/2 通过。
- 主工作区：`pnpm test:integration` 通过（API 5/5、Worker 1/1），覆盖首用户事务、旧成员迁移、CLI 生命周期及多用户 Workspace 隔离；测试容器、schema、bucket 均已清理。
- 主工作区：28 个迁移验证、`pnpm docs:check`、Compose config 和 Nginx 配置语法检查通过；`git diff --check` 通过。
- 独立验证报告：类型、单测、迁移与集成复核通过。独立快照 E2E 受 Windows Junction/Turbopack 限制，不能作为页面行为结果；主工作区 E2E 通过。
- `pnpm format:check` 只对既有登录页 `apps/web/app/login/page.tsx` 报格式差异，保留该文件的既有修改，未据此改变本次功能。

## 已确认决策

- 每个数据库用户有私有 Workspace；首个数据库用户接收旧 Workspace/Project 成员关系。
- username 大小写不敏感且去除首尾空格；所有用户为普通权限，无应用管理员角色。
- 首次空库启动从显式配置创建用户；已有账号不被启动配置覆盖。
- CLI 管理创建/查询/停用/启用/重置；用户账号页自行改密并验证当前密码。
- 用户自设密码至少 6 字符；共享初始/重置秘密至少 15 个随机字符，且存储为 scrypt hash；不强制首登或定期改密。
- 停用、管理员重置和用户自助改密不撤销现存 JWT；各会话保留至原 exp，最长 7 天；旧部署 JWT 最多通过临时映射兼容 7 天。
- 应用不做失败计数，生产 Nginx/WAF 限速并关闭 API 旁路。
- 账号管理操作不写审计记录；不给用户提供邮件找回。

## 已知问题与未决问题

- 生产停用的即时撤销能力不在本次范围内；现有会话最多 7 天仍有效。
- 自助改密后的所有现存 JWT 均保留至各自原 exp，最长 7 天；这是已确认的会话策略，不含主动登出或即时撤销。
- 六字符用户自设密码低于 NIST 单因素基线；共享密码泄漏可能波及尚未改密的账号。
- API 进程不限制失败登录，依赖部署入口保护；配置已核对，Nginx/WAF 实流量限速和 API 公网不可达尚需在部署环境验证。
- 旧 login-gateway 任务的真实 HTTPS Smoke 仍未执行；其 VERIFYING/PARTIAL 状态在新 current-task 中保留，不在本变更中重写。
- 用户已批准环境变量名、迁移顺序、CLI 范围和 API endpoint；若实现发现必须改变这些约束，先回到 SDD 修改。

## 新会话启动必读

1. workspace 的 AGENTS.md、agent-tasks/AGENTS.md 和 agent-tasks/current-task.md。
2. LangReport/AGENTS.md、CONTEXT.md、docs/project-spec.md、第一阶段产品规格和 docs/changes/README.md。
3. 本目录所有六份 SDD 文档与 docs/adr/0027-database-backed-user-accounts.md。
4. 最新 git status；保留工作树中与本任务无关的用户修改。
