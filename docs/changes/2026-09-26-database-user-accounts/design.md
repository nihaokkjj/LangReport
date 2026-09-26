# 数据库账号管理：Design

- 变更编号：CHG-2026-09-26-database-user-accounts
- 状态：COMMITTED（生产部署实测待目标环境）
- 创建时间：2026-09-26
- 更新时间：2026-09-26

## 现状与约束

- apps/api/src/auth.ts 通过 AUTH_LOGIN_USERNAME、AUTH_LOGIN_PASSWORD_HASH 和 AUTH_LOGIN_USER_ID 认证一个部署身份；密码使用现有 scrypt 格式，成功后签发 HS256 JWT。
- 浏览器使用 HttpOnly 的 langreport_session Cookie；默认 JWT/Cookie TTL 为 7 天，现有会话不存数据库。
- apps/api/src/auth-routes.ts 当前按进程内来源地址保存失败次数；infra/nginx/nginx.conf 也对 /api/v1/auth/login 执行入口限速。
- packages/db/src/schema.ts 的 members.user_id 与 project_members.user_id 都是 text，没有 users 表或 user 外键。Project 等创建者字段及 audit_events.actor_id 也保存历史文本身份。
- API 的 ensurePersonalWorkspace(userId) 在用户首次访问 Project 时惰性创建私有 Workspace；现有首个用户的 Workspace/Project 关系由 members 和 project_members 决定。
- 登录网关原变更记录明确排除用户表。此变更新建独立记录，不改写原变更的历史验收；对登录限流和身份源的调整只在新方案批准后实施。

## 设计目标与非目标

目标：以一张用户身份表管理数据库登录账号；保留既有 Cookie/JWT 边界、私有 Workspace 解析和 Project 数据；提供有限的 CLI 生命周期管理及用户自助改密。

非目标：建立应用内管理员角色或控制台、邮箱恢复、MFA、即时 JWT 撤销、共享 Session 存储、多租户成员产品能力。

## 方案选型

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 继续使用单个环境变量身份 | 改动最少 | 无法满足多个账号、停用和自助改密 | 不采用 |
| 新增 users 表并复用现有 JWT Cookie | 用户身份持久化，继续复用现有数据授权和浏览器会话 | 需要迁移、登录查询和账号生命周期治理 | 采用 |
| 引入第三方身份提供商 | 可提供成熟 MFA、恢复和企业集成 | 增加外部系统、部署和账户同步范围 | 当前不采用 |

## 模块边界

- packages/db：拥有 users 表、唯一索引和数据库迁移；提供账号读写函数，不暴露明文密码。
- apps/api：把登录验证从环境变量切换到 users；只接受 active 用户的新登录；提供当前用户改密 API；启动时完成一次引导账号与旧关系迁移。
- apps/api CLI：在服务器/容器运维边界执行创建、列表、停用、启用和重置；CLI 权限来自操作系统和部署权限，不来自应用用户 role。
- apps/web：新增普通用户账号页，展示当前用户名并提供当前密码、新密码、确认密码表单；登录页继续维持精简内容。
- packages/contracts 与 API Console：同步会话用户投影和改密 API 契约。
- infra/nginx：继续作为公网登录入口并承担失败请求速率限制；API 端口只允许内部网络访问。

## 数据模型与状态流转

### users 表提案

| 字段 | 约束与用途 |
| --- | --- |
| id | text 主键；服务端生成随机 UUID 字符串，并作为新 JWT 的 sub |
| username | 用户输入后去除首尾空格的显示值 |
| username_key | 对 username 去空格并转小写后的比较键；唯一索引 |
| password_hash | 现有 scrypt 格式，含随机 salt 与派生摘要；不得存明文 |
| status | active 或 disabled；不包含角色 |
| created_at / updated_at | 创建和最近账号资料更新时间 |
| password_changed_at | 最近一次创建、重置或自行修改密码的时间 |
| disabled_at | 停用时间；重新启用时清空 |
| legacy_auth_subject | 迁移前 AUTH_LOGIN_USER_ID；仅用于旧 JWT 临时兼容，唯一且可空 |
| legacy_auth_subject_expires_at | 旧身份映射停止使用的时间，最长为迁移时刻加 7 天 |

username_key 由服务端统一计算并在数据库唯一约束下写入，避免大小写或首尾空格绕过唯一检查。登录时使用同一规范化函数查找。密码原样校验，不去除首尾空格。用户自设密码最低 6 个字符；部署共享初始/重置密码至少 15 个随机字符。

用户创建、停用、启用、重置和改密均更新相应时间字段。停用是软状态变更；不删除 users 行、Workspace、Project、成员关系或对象存储。

### 引导与迁移事务

1. 数据库 schema migration 先创建 users 表与唯一约束。
2. API 启动时用数据库事务和 advisory lock 检查 users 是否为空。
3. 若已有任一用户记录，跳过引导写入，不用环境值更新用户名、密码、状态或旧身份映射。停用账号也计为已存在记录。
4. 若 users 为空，要求显式配置引导用户名和共享密码。缺少配置时 API 不进入 ready；配置错误时不得创建半成品用户。
5. 新建 active 的首个普通用户，密码通过现有 scrypt 实现散列。
6. 若提供旧 AUTH_LOGIN_USER_ID，将其保存为临时 legacy_auth_subject，并设置不晚于当前时间加 7 天的映射截止时间。
7. 同一事务把 members.user_id 和 project_members.user_id 中的旧 subject 更新为新 users.id，保留 workspace_id、project_id、role、创建时间和业务数据 ID。事务失败时用户创建、映射和关系更新一并回滚。
8. 不改写 audit_events.actor_id、created_by、createdBy、消息/Revision 作者等历史来源字段；它们记录发生时的身份来源，不决定当前 Workspace/Project 授权。
9. 启动完成关系迁移后才允许 API 接收业务请求。首次读取 Project 时，现有 ensurePersonalWorkspace 复用迁移后的 Workspace；其他新用户仍由现有逻辑创建个人 Workspace。

本变更不为现有 text user_id 列增加 users 外键，避免把授权关联迁移与各业务表中的历史作者标识混为一谈。访问仍由现有 Workspace/Project member 检查限制。

### 认证与会话

- 新数据库登录成功后 JWT sub 使用 users.id，Cookie 名称、安全属性和最长 7 天 TTL 保持现状。
- 旧 JWT 的 sub 等于 legacy_auth_subject 且映射未过期时，认证提供器把 request.user.id 规范化为新 users.id。映射只解析身份，不刷新或延长 token exp。
- 映射过期后旧 subject 拒绝认证。legacy_auth_subject_expires_at 之后不可用于身份解析，即使数据库中仍保留该值。
- 登录仅对 active 用户执行密码验证；不存在、disabled 或密码不匹配都返回相同的 401 INVALID_CREDENTIALS。
- 按用户选择，认证中间件不对已签发 JWT 查询 status 来撤销会话。停用、管理员重置密码或用户自助改密都不会让既有 JWT 立即失效；所有会话继续到各自原 exp，最多 7 天。
- 后续若需要即时停用或密码变更后踢出会话，须单独引入有状态 Session/撤销设计。

### 账号 CLI

CLI 仅能通过服务器/API 容器运行，访问权限由操作系统和部署权限控制。建议操作为：

| 操作 | 行为 |
| --- | --- |
| 创建 | 输入唯一用户名，读取部署共享密码配置，写入 active 用户及 scrypt hash |
| 列表 | 显示 id、用户名和状态，不显示密码或 hash |
| 停用 | 将目标用户设为 disabled，保留其 Workspace 与数据 |
| 启用 | 将 disabled 用户恢复为 active，不改写密码 |
| 重置密码 | 将当前部署共享密码散列后写入指定用户，旧 JWT 继续到 exp |

命令不接受密码作为命令行参数，不向 stdout/stderr 打印秘密，不写入账号操作审计。目标用户不存在、用户名冲突、共享密码配置无效时以非零状态退出。

## API / 外部契约

### POST /api/v1/auth/login

继续接受 username/password。服务端规范化 username，读取用户行并验证 active 状态与 scrypt hash。响应保持通用错误，不泄露账号是否存在。响应 Cookie 沿用 HttpOnly、Path=/、SameSite=Lax、生产 Secure 和原 JWT TTL。

应用移除 auth-routes.ts 中的进程内失败窗口。生产 Nginx/WAF 必须对登录入口限速，并设置 API 网络边界，阻止公网绕过入口。入口返回的 429 继续作为外部契约；直连 API 的错误凭据返回 401。

### GET /api/v1/auth/session

有效认证返回当前数据库用户的最小投影：userId、username、expiresAt。响应不含 role、password_hash、legacy_auth_subject 或跨用户信息。

### POST /api/v1/auth/password

仅需有效登录会话。请求字段为 currentPassword、newPassword；currentPassword 必须匹配当前 hash，newPassword 至少 6 个字符。失败响应不泄露用户或 hash。成功更新密码 hash 与 password_changed_at。成功后不清除当前 Cookie，也不撤销当前或其他设备上已签发的 JWT；各 JWT 保留到自己的原 exp，最长 7 天。

此操作必须同步 packages/contracts、OpenAPI 与 apps/web/app/api-console。

### CLI

账号管理不新增管理员 HTTP 路由。部署、操作和命令用法文档同步到 docs/operations；具体脚本名在实现前由用户审核后的任务确定。

## 架构图

普通登录：

    Web /login → Nginx/WAF 限速 → API login → users / scrypt → HS256 JWT → HttpOnly Cookie

已有数据迁移：

    旧 AUTH_LOGIN_USER_ID → 启动引导事务 → 新 users.id
                                      ├─ members.user_id 更新
                                      ├─ project_members.user_id 更新
                                      └─ legacy subject 映射（最多 7 天）

改密：

    Web /account → API 验证 currentPassword → 更新 users.password_hash → JWT 保持至原 exp

## 数据流

1. API 启动前由部署流程应用 schema migration；启动事务取得互斥锁并完成首个账号及旧成员关系转移。
2. 浏览器提交用户名和密码；API 规范化用户名、查询用户、验证状态与密码，签发以 users.id 为 sub 的 JWT。
3. 业务请求由 JWT AuthProvider 验签。新 subject 原样使用；有效期内的旧 subject 通过 users 临时映射解析成新 id。
4. Project 查询继续使用 members 与 project_members 的用户关联。新用户无 Workspace 时由现有 ensurePersonalWorkspace 逻辑创建。
5. 改密仅在 API 内存短暂处理输入；数据库只收到新的 scrypt hash。
6. CLI 从部署注入的共享密码秘密读取重置值；秘密不放入终端参数、日志、HTTP 响应或数据库明文。

## 权限、校验与异常处理

- 所有 users 行都是普通用户，没有 role 或全局数据访问权限。
- 登录时 active 状态必需；停用后拒绝新登录。已有 JWT 按用户选择继续有效到 exp。
- Workspace/Project 数据仍以 members、project_members 及现有 project access service 授权；JWT subject 不直接等同于跨项目权限。
- username_key 唯一冲突返回稳定的账号冲突错误；登录对未知、停用和错误密码使用同一错误响应。
- 密码采用现有 scrypt 实现和随机 salt；日志不得包含密码、hash、JWT、Cookie、共享密钥或提交的 currentPassword/newPassword。
- 密码按原字符串校验；用户名去首尾空格并按大小写不敏感处理。
- 应用没有登录失败窗口；生产 API 只能由 Nginx/WAF 暴露，直连 API 的网络路径必须关闭。基础设施配置缺少限速时不得完成生产部署验收。
- 账号管理动作不写 audit_events。运行指标如需记录，只保留不含用户名与秘密的计数。

## 迁移、兼容与回滚

### 上线顺序

1. 备份 Postgres，并验证恢复路径。
2. 发布 users 表 migration。
3. 部署需要引导用户名、共享密码和旧 subject 配置的新 API。
4. API 在 readiness 前执行单次引导事务；旧关联更新和新用户创建必须原子完成。
5. 验证首个账号能登录、旧 token 映射、Workspace/Project ID 与数据保持。
6. 确认外部反向代理限速和 API 网络隔离；移除应用内失败窗口。
7. 运行登录、改密、CLI、数据授权和 Cookie 自动化回归；生产 HTTPS Smoke 依原项目环境要求单独验收。

建议环境值名称：AUTH_BOOTSTRAP_USERNAME、AUTH_SHARED_DEFAULT_PASSWORD、AUTH_LEGACY_USER_ID。AUTH_LEGACY_USER_ID 仅迁移旧部署时设置。具体命名须在实现任务里统一更新 .env 示例、Compose 和运维文档。AUTH_SHARED_DEFAULT_PASSWORD 是明文部署秘密，必须通过受控 secret 注入；轮换该值不批量修改现有 users 密码，只影响之后的新建/CLI 重置操作。首次启动完成后，重复启动不再使用引导用户名覆盖用户资料。

### 回滚

- migration 和引导事务失败时不提供不完整服务；事务自动回滚用户行、成员关系和旧身份映射。
- 数据库已接受新账号登录或用户改密后，不执行自动 down migration 或删除 users 表。回滚到旧单账号网关需要恢复切换前数据库备份并重新部署旧环境变量认证；新建账号和后续业务写入可能不在旧备份中，因此优先向前修复。
- legacy subject 映射只为最多 7 天的会话兼容服务；它不是永久账户合并记录。
- 新增接口失败可先回滚 Web/API 版本；数据库 schema 暂留，由后续兼容版本处理，不立即删除用户数据。

## 日志、监控与可观测性

- 不记录账号管理审计事件或凭据内容。
- 登录错误可以计数，但不得记录提交的 username、password、hash、JWT、Cookie 或共享秘密。
- 生产监控入口 429、401、引导失败、账号表访问错误和 Workspace authorization 失败；日志使用 requestId 与稳定错误码。
- 不将 disabled 账号尝试与错误密码区分返回。

## 测试策略

- DB migration 与 bootstrap：空库、已有用户库、重复启动、并发启动、配置缺失、事务失败和历史关系转移。
- 账号 CLI：创建、规范化用户名冲突、列表脱敏、停用、启用、重置、配置缺失与非零退出。
- API：登录边界、通用错误、密码 hash 与自助改密、当前密码验证、session 用户投影、disabled 后禁止新登录。
- 会话：停用、管理员重置和自助改密后，所有现存 JWT 都保持到各自原 exp，最长 7 天；旧 subject alias 不延长 exp 且在 7 天内失效。
- 授权：两个用户不能访问彼此 Project；迁移保留 Workspace、Project、Revision、对象和授权记录。
- 部署：Nginx/WAF 对入口限速；生产 API 不能从公网直达；secret 不进入 Compose 日志和 API 响应。
- Web：账号页桌面与 390px 宽度可用；错误、成功、加载和未登录状态符合 DESIGN.md。
- 契约：更新 Contracts、OpenAPI 和 API Console 示例；不暴露共享秘密、hash 或 legacy id。

## 需求追踪矩阵

| 需求 | 设计 | 任务 | 测试 | commit |
| --- | --- | --- | --- | --- |
| R1 数据库用户和唯一用户名 | 数据模型 | T1 | DB migration/integration | 16bf52a |
| R2 一次性启动引导与旧关系迁移 | 引导与迁移事务 | T1、T2 | empty/existing DB、迁移事务 | 16bf52a |
| R3 数据库登录和安全会话 | 认证与会话、API | T2 | API Auth unit/HTTP | 16bf52a |
| R4 自助密码修改 | API、模块边界 | T4 | API contract/Web E2E | 16bf52a |
| R5 CLI 生命周期管理 | 账号 CLI | T3 | CLI integration | 16bf52a |
| R6 私有 Workspace 和历史数据 | 迁移、权限 | T1、T2 | DB authorization integration | 16bf52a |
| R7 停用/重置会话语义 | 认证与会话 | T2 | JWT exp regression | 16bf52a |
| R8 入口限速、不加应用失败窗口 | 外部契约、权限 | T5 | Nginx config/production smoke | 16bf52a（配置已提交；生产实测待部署） |
| R9 文档、契约与部署同步 | 模块边界、测试策略 | T5 | docs-check/API Console | 16bf52a |
