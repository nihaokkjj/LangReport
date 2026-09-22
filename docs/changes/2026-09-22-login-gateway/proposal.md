# 登录网关与会话 Cookie：Proposal

- 变更编号：`CHG-2026-09-22-login-gateway`
- 状态：`VERIFYING`
- 创建时间：2026-09-22
- 更新时间：2026-09-22

## 背景

LangReport API 已能校验 HS256 JWT，并能从 `Authorization: Bearer` 或 `langreport_session` Cookie 读取 Token；Web 请求也已使用 `credentials: include`。内置登录入口补齐后的首轮实现仍为开发环境保留了 `x-user-id` 和隐式 `local-dev-user` 回退，导致开发与生产走两套身份边界；用户进一步确认开发模式也必须登录，本轮已移除该回退。

## 要解决的问题

为第一阶段单用户/单部署场景补充最小登录网关：用户提交部署侧配置的账号和密码后，服务端验证密码哈希，签发短期 HS256 JWT，并通过 HttpOnly 的 `langreport_session` Cookie 建立会话。登出时清除同名 Cookie；失败时不泄露账号是否存在、密码哈希或 JWT 密钥。

## 目标用户与使用场景

- 部署维护者：通过环境变量配置唯一登录身份和密码哈希，不在仓库或生产环境保存明文密码。
- 咨询顾问：在 `/login` 输入账号密码，成功后进入既有 Project 工作台；刷新页面仍由 Cookie 恢复身份。
- 验收人员：通过 API、浏览器和生产 Smoke 验证登录、会话、登出、过期和错误凭据路径。

## 需求范围

### MVP

1. 新增 `POST /api/v1/auth/login`，验证部署配置的单账号和 scrypt 密码哈希。
2. 登录成功后签发 `alg=HS256` 的 JWT，至少包含 `sub`、`iat`、`exp` 和随机 `jti`；沿用 `AUTH_JWT_SECRET`，并按现有配置写入 `iss`/`aud`。
3. 通过 `Set-Cookie` 写入固定名称 `langreport_session`，属性为 `HttpOnly`、`Path=/`、`SameSite=Lax`，生产环境必须 `Secure`，并设置与 JWT 一致的 `Max-Age`。
4. 新增 `POST /api/v1/auth/logout` 清除 Cookie，以及 `GET /api/v1/auth/session` 返回当前会话的最小用户投影。
5. 新增 Web `/login` 页面；主工作台在任意环境请求返回 `UNAUTHENTICATED` 时进入登录页，登录成功后返回工作台。
6. 登录失败使用统一错误响应和有限的按来源地址失败频率控制，不记录密码、JWT 或 Cookie。
7. 同步 OpenAPI、API Console、生产 Compose、环境变量示例、部署文档和 Smoke。
8. 开发环境必须配置并使用同一登录网关；删除 `x-user-id` 与隐式 `local-dev-user` 身份回退，开发 Bootstrap 仅在登录后可调用。

### 后续范围

- 多账号、用户注册、密码修改/找回、邮箱验证和管理员用户管理。
- 企业 SSO、OAuth/OIDC、MFA、Refresh Token、服务端会话撤销列表和多设备管理。
- 多实例共享的分布式登录限流；第一阶段单 API 实例使用进程内失败窗口，并由 Nginx 增加入口限速。

## 明确不做

- 不新增 User/Account 领域实体或数据库表。
- 不把密码明文、密码哈希、JWT 或 Cookie 写入数据库、日志、响应正文或浏览器存储。
- 不改变既有 Workspace/Project 授权模型，不开放 Workspace 成员管理。
- 不移除现有 Bearer JWT 验证能力；它继续用于部署 Smoke 和非浏览器客户端。
- 不保留任何运行环境的 `x-user-id` 或隐式 `local-dev-user` 认证路径；测试如需伪造身份只能显式注入测试 AuthProvider。

## 成功指标

- 正确凭据返回 200，响应含安全的 `langreport_session` Cookie，后续不带 Bearer 的 API 请求可恢复相同 `sub`。
- 错误账号、错误密码、无配置、过期/篡改 Token 和限流均返回稳定且不泄密的错误。
- 登出响应清除 Cookie，旧 Cookie 不能再由浏览器继续发送；过期 JWT 被现有验证器拒绝。
- API 契约、API Console、Web、生产配置和部署 Smoke 与实现一致。
- API/Web 类型检查、认证单元测试、HTTP 契约测试和登录浏览器 E2E 通过。

## 假设、依赖与风险

- 假设第一阶段只需一个部署管理的登录身份；JWT 的 `sub` 由 `AUTH_LOGIN_USER_ID` 指定，并与生产初始化脚本的 `PROVISION_USER_ID` 一致。
- 密码只以 scrypt 编码后的哈希配置在 `AUTH_LOGIN_PASSWORD_HASH`；提供离线哈希生成脚本，脚本不输出其他环境变量。
- 依赖同源 Vercel Rewrite 或等价 HTTPS 反向代理。跨站第三方 Cookie 不作为支持路径。
- HS256 要求登录网关与 API 共享签名密钥；密钥泄露会影响全部会话，因此生产必须使用至少 32 字符的随机密钥并支持运维轮换。
- 进程内限流只适用于当前单 API 实例；扩容前必须迁移到共享限流存储或上游身份系统。

## 未决问题

1. 是否批准第一阶段使用“部署配置的单账号 + scrypt 密码哈希”，而不是本次引入用户表或第三方 OAuth？

## 已确认决策

- 默认会话有效期为 7 天（`604800` 秒）；`AUTH_SESSION_TTL_SECONDS` 允许部署侧将其缩短至最低 5 分钟，但不得配置超过 7 天。
- 用户已于 2026-09-22 批准第一阶段采用“部署配置的单账号 + scrypt 密码哈希”，不引入用户表或第三方 OAuth。
- 用户已于 2026-09-22 明确要求开发模式也必须登录，不再保留开发身份绕过。

## 验收标准概要

1. 登录成功签发合法 HS256 JWT，并只通过 HttpOnly `langreport_session` Cookie 返回浏览器。
2. Cookie 在生产为 `Secure; HttpOnly; SameSite=Lax; Path=/`，生命周期不超过 JWT `exp`。
3. 登录、会话查询、登出、错误凭据、限流、过期和篡改路径有自动化证据。
4. 开发与生产无登录配置时登录明确失败；任意环境的 `x-user-id` 均不能认证业务请求。
5. Web 登录页在桌面和 390px 移动宽度可用，且不把密码写入 URL、本地存储或历史记录。
