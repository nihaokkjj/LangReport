# 登录网关与会话 Cookie：Design

- 变更编号：`CHG-2026-09-22-login-gateway`
- 状态：`VERIFYING`
- 创建时间：2026-09-22
- 更新时间：2026-09-22

## 现状与约束

- `apps/api/src/auth.ts` 已验证 HS256 签名、`sub`、`exp`、`nbf`、可选 `iss`/`aud`，并从 Bearer 或 Cookie 读取 Token，但没有签发函数。
- `buildApp` 在请求前尝试解析认证上下文；公开健康检查仍可访问，业务路由在读取用户时返回 `UNAUTHENTICATED`。
- Web 业务请求已使用 `credentials: include`，生产部署推荐同源 Rewrite。
- 范围调整前，开发 Web/API 仍发送并接受 `x-user-id`，且可隐式解析为 `local-dev-user`；当前实现已删除该绕过。
- 第一阶段每个认证用户有一个私有 Workspace，但当前需求不授权建立完整账户系统。
- API 变更必须同步 `packages/contracts`、OpenAPI 与 `apps/web/app/api-console`。

## 设计目标与非目标

目标：以最小新增面补齐可部署登录闭环，复用现有 JWT 验证边界，避免新数据库模型，并使浏览器不接触可读 Token。

非目标：多用户生命周期、OAuth/OIDC、Refresh Token、跨站 Cookie、服务端会话存储和权限模型重构。

## 方案选型

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 部署配置单账号 + scrypt 哈希 + API 签发 Cookie | 改动小、无迁移、可完成当前单用户生产验收 | 不支持自助账号和多实例共享限流 | 采用，限定第一阶段 |
| 新增用户表和密码认证 | 可支持多账号和用户管理 | 引入迁移、注册/重置/审计等大量新范围 | 不采用 |
| 接入外部 OAuth/OIDC | 标准化、可扩展企业身份 | 需要供应商、回调域名和外部配置，当前未指定 | 后续变更 |

## 模块边界

- `apps/api/src/auth.ts`：集中实现配置解析、scrypt 校验、HS256 签发/验证、Cookie 序列化和认证错误；签发与验证共享同一 Claim 规则。
- `apps/api/src/auth-routes.ts`：只负责 login/session/logout 的 HTTP 输入输出、失败窗口和稳定错误映射。
- `packages/contracts/src/http.ts`：声明三条 Auth 契约、请求/响应和 `Set-Cookie` 描述；Auth 路由不要求已有身份，session/logout 按 Cookie 身份处理。
- `apps/web/app/login/*`：收集账号密码并直接 POST 同源 API；只保留非敏感的返回路径，不持久化凭据。
- `apps/web` 现有页面：所有环境统一识别 401 `UNAUTHENTICATED` 并跳转 `/login`；开发 Bootstrap 路由仍只在非生产暴露，但调用者必须已有有效 Cookie/Bearer 身份。
- `infra/nginx`：只对登录入口增加上游请求速率限制，不改变 50 MB 业务上传路径。

## 配置与状态流转

### 运行配置

| 变量 | 规则 |
| --- | --- |
| `AUTH_LOGIN_USERNAME` | 必填，1–128 字符，仅用于恒定时间比较后的账号匹配 |
| `AUTH_LOGIN_PASSWORD_HASH` | 必填，格式 `scrypt$<salt-base64url>$<digest-base64url>`；salt 至少 16 字节、digest 固定 32 字节 |
| `AUTH_LOGIN_USER_ID` | 必填，作为 JWT `sub`，与初始化用户 ID 一致，1–200 字符 |
| `AUTH_JWT_SECRET` | 复用现有配置，至少 32 字符 |
| `AUTH_SESSION_TTL_SECONDS` | 可选，默认 604800（7 天）；范围 300–604800，只允许部署侧缩短会话 |
| `AUTH_JWT_ISSUER` / `AUTH_JWT_AUDIENCE` | 可选；配置后签发与验证必须一致 |

JWT Header 固定为 `{ "alg": "HS256", "typ": "JWT" }`。Payload 为 `sub`、`iat`、`exp`、随机 `jti`，以及可选 `iss`、`aud`。不放入用户名、角色、Workspace ID 或权限。

### 登录状态流

```text
anonymous
  ├─ valid credentials ─► authenticated cookie ─► existing Workspace/Project access
  ├─ invalid credentials ─► generic 401 + failed-attempt window
  └─ too many failures ─► 429 + Retry-After

authenticated cookie
  ├─ GET /auth/session ─► minimal { authenticated, userId, expiresAt }
  ├─ POST /auth/logout ─► expired cookie
  └─ expired/tampered JWT ─► 401 UNAUTHENTICATED
```

失败窗口只保存规范化来源地址、失败次数和到期时间，不保存账号或密码。成功登录清除该来源的失败记录。实现必须周期性删除过期记录并设置最大条目数，避免无界内存增长。

## API / 外部契约

### `POST /api/v1/auth/login`

请求：

```json
{ "username": "operator", "password": "<secret>" }
```

成功：`200 { "authenticated": true, "userId": "...", "expiresAt": "..." }`，同时写入：

```text
Set-Cookie: langreport_session=<JWT>; Max-Age=<ttl>; Path=/; HttpOnly; Secure; SameSite=Lax
Cache-Control: no-store
```

错误凭据统一为 `401 INVALID_CREDENTIALS`；未配置为 `503 AUTH_LOGIN_UNAVAILABLE`；超限为 `429 AUTH_LOGIN_RATE_LIMITED`。响应和日志不得回显提交值。

### `GET /api/v1/auth/session`

有效 Cookie 返回与登录成功相同的最小投影并设置 `Cache-Control: no-store`；无效或缺失会话返回 `401 UNAUTHENTICATED`。

### `POST /api/v1/auth/logout`

无论 Cookie 是否有效都返回 `204`，并使用与登录 Cookie 相同的 `Path`、`Secure`、`SameSite` 属性写入 `Max-Age=0`。该幂等语义避免泄露会话是否存在。

## 架构图

```text
Web /login
   │ credentials: include, HTTPS
   ▼
API Auth Route ──► deployment credential hash
   │                    │ scrypt verify
   │ HS256 sign         ▼
   └────────────► HttpOnly langreport_session
                            │
Web business request        │ automatic browser cookie
   └────────────────────────▼
                 existing JWT AuthProvider
                            │ sub
                            ▼
              private Workspace / Project scope
```

## 数据流

1. 登录页只在内存中保存输入并提交 JSON；请求完成后清空密码状态。
2. API 先校验请求长度与配置，再执行统一成本的 scrypt 验证；账号不匹配时仍执行一次虚拟哈希校验，避免明显时序差异。
3. 成功后用 `AUTH_JWT_SECRET` 签发短期 JWT，通过 HttpOnly Cookie 返回；响应正文不包含 Token。
4. 后续业务请求由浏览器自动携带 Cookie，现有 `createJwtAuthProvider` 验签并把 `sub` 写入 `request.user`。
5. 登出覆盖 Cookie 为立即过期；无服务端 Session 数据需要删除。

## 权限、校验与异常处理

- login/logout 为公开传输入口，但只有 login 成功产生身份；session 必须有有效认证上下文。
- 开发与生产的业务路由都只接受 JWT Cookie/Bearer 或显式受信任代理身份；`x-user-id` 与隐式 `local-dev-user` 不再参与身份解析。
- 用户名/密码设硬长度上限，拒绝非字符串、空值和超限输入；错误正文不区分账号或密码。
- 密码比较使用 `scrypt` 与 `timingSafeEqual`；JWT 签名复用现有 HMAC SHA-256 和 canonical base64url 检查。
- 生产 Cookie 强制 `Secure`。不提供环境变量关闭 `HttpOnly`、修改 `SameSite=None` 或扩大 Domain。
- CORS 保持精确 `WEB_ORIGIN` 与 credentials；Cookie 会话的状态修改依赖同源部署和 `SameSite=Lax`，不接受任意 Origin。
- 登录密码、哈希、JWT Secret、JWT 和 Cookie 值进入日志脱敏清单；请求错误日志只记录 requestId、稳定错误码和限流结果。
- 启动期对生产认证配置执行 fail-fast：启用登录网关时三项登录配置必须成组合法；不允许用明文密码变量回退。

## 迁移、兼容与回滚

- 无数据库迁移；现有 Bearer JWT 和自定义 `authProvider` 保持兼容。
- 开发和生产都必须配置登录身份、scrypt 哈希与 JWT Secret；开发环境仅因 localhost HTTP 不给 Cookie 添加 `Secure`，其他属性和 TTL 规则一致。
- 回滚可撤下 Web 登录入口和三条 Auth 路由，保留现有外部 JWT Provider；不需要数据回滚。
- JWT Secret 轮换会使现有 Cookie 立即失效，用户重新登录即可；当前不支持双密钥平滑轮换。

## 日志、监控与可观测性

- 记录登录成功/失败/限流的计数和 requestId，但不记录账号原文、来源密码、Token 或 Cookie。
- 生产 Smoke 只断言 `Set-Cookie` 属性和会话行为，对值统一显示 `[REDACTED]`。
- 建议运维观察 401/429 比率；异常突增时可在 Nginx 层进一步收紧入口。

## 测试策略

- Auth unit：哈希生成/校验、签发/验签、Claim、TTL、Cookie 属性、无效配置和恒定错误。
- API HTTP：login→session→业务 API→logout；错误凭据、限流、过期、篡改、Issuer/Audience 和 Bearer 兼容。
- Contract/OpenAPI/API Console：三条路由、request/response、401/429/503 和敏感字段不进入文档示例。
- Web E2E：登录成功返回、错误提示、401 跳转、刷新恢复和登出；桌面与 390px。
- Development auth：未登录和伪造 `x-user-id` 均为 401；登录 Cookie 可调用开发 Bootstrap 和业务 API。
- Production smoke：HTTPS 代理后的真实 `Set-Cookie` 安全属性和无 Bearer Cookie 访问。

## 需求追踪矩阵

| 需求 | 设计 | 任务 | 测试 | commit |
| --- | --- | --- | --- | --- |
| R1 凭据校验与 HS256 签发 | 配置与状态流、数据流 1–3 | T1 | Auth unit、API HTTP | 工作树待提交 |
| R2 HttpOnly Cookie 会话 | API 契约、权限校验 | T1–T2 | Cookie 属性、login→session | 工作树待提交 |
| R3 登出与过期 | API 契约、状态流 | T2 | logout、expired/tampered | 工作树待提交 |
| R4 Web 登录闭环 | 模块边界、数据流 | T4 | Web E2E、响应式检查 | 工作树待提交 |
| R5 防爆破与不泄密 | 权限校验、可观测性 | T1–T3 | rate limit、日志脱敏 | 工作树待提交 |
| R6 契约与部署同步 | 兼容回滚、测试策略 | T3、T5 | docs/check、OpenAPI、smoke | 工作树待提交 |
| R7 开发环境强制登录 | 模块边界、权限校验、迁移兼容 | T7 | dev auth unit、Web E2E、contracts | 工作树待提交 |
