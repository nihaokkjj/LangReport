# 登录网关与会话 Cookie：独立测试报告

- 变更编号：`CHG-2026-09-22-login-gateway`
- 测试角色：独立验证 Agent
- 测试日期：2026-09-22
- 自动化结论：`TEST_PASSED`
- 生产验收结论：`BLOCKED`（缺少真实 HTTPS 目标域名、部署账号和生产 Workspace）

## 测试快照

- Git HEAD：`1d4dd9aa7647d063ab8b24e200723b0b3681275b`
- 快照类型：该 HEAD 上的未提交工作树；包含登录网关相关 API、Web、Contracts、Compose、Nginx、Smoke 和文档变更。
- 工作树状态：认证变更文件均为 modified/untracked，未暂存、未提交。验证期间未修改业务代码；仅新增本报告。
- 隔离说明：当前工具没有独立 worktree，本次按只读共享快照执行；主 Agent 在验证期间仅修复了下述 issuer/audience 规范化问题，修复后由同一验证 Agent 复测。

## 结果摘要

| 检查项 | 结果 | 证据摘要 |
| --- | --- | --- |
| 默认/最大 7 天 TTL | PASS | `DEFAULT_SESSION_TTL_SECONDS=604800`；单测断言 JWT `exp-iat` 和 Cookie `Max-Age` 均为 604800，并拒绝 604801 |
| HS256 与既有验证器兼容 | PASS | 签发 Header 为 `alg=HS256, typ=JWT`，Claims 含 `sub/iat/exp/jti` 和可选 `iss/aud`；登录 Cookie 回送 session 成功；Bearer、篡改签名、过期 Token、非规范 base64url 均有回归证据 |
| Cookie 安全属性 | PASS（本地 HTTP 注入） | 生产配置下断言 `langreport_session`、`HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`、`Max-Age=604800`；logout 写入 `Max-Age=0` |
| scrypt 与配置校验 | PASS | 16 字节随机 salt、32 字节 digest、固定 scrypt 参数；格式/长度校验；账号比较和密码摘要比较均使用恒定时间原语；无明文密码配置回退 |
| 错误凭据和限流 | PASS | 错误账号/密码统一 `401 INVALID_CREDENTIALS`；第 6 次尝试返回 `429` 和 `Retry-After`；Map 有过期清理和 10,000 条上限，Nginx 另有真实来源入口限速 |
| login/session/logout | PASS | 登录、Cookie 会话恢复、幂等清 Cookie、未配置 503、无会话 401 均通过 API 测试 |
| Web 与敏感信息不落盘 | PASS | 登录请求使用 `credentials: include`；失败后清空密码；桌面/390px E2E 验证密码不进入 Local/Session Storage；API Console 历史清空 login body，并在预览/cURL 中替换密码 |
| Contracts/OpenAPI/部署同步 | PASS | 三条 Auth 路由、请求 schema、401/429/503、API Console、Compose 必填变量、Nginx 限速和部署说明一致；Compose 渲染成功 |
| 真实 HTTPS Cookie-only smoke | BLOCKED | 当前没有可访问的 HTTPS 生产目标、部署凭据和 Workspace；不得以 Fastify inject 代替浏览器/反向代理验收 |

## 实际执行命令

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @langreport/api test` | PASS，32/32；修复后再次 PASS，32/32 |
| `pnpm --filter @langreport/api test:typecheck` | PASS |
| `pnpm --filter @langreport/api typecheck` | PASS；修复后再次 PASS |
| `pnpm --filter @langreport/contracts test` | PASS，26/26 |
| `pnpm --filter @langreport/web typecheck` | PASS |
| `pnpm --filter @langreport/web test:typecheck` | PASS |
| `pnpm --filter @langreport/web exec playwright test -c playwright.config.ts test/e2e/login.spec.ts` | PASS，桌面与 390px 共 2/2 |
| `pnpm test:e2e` | PASS，桌面与 390px 全量 14/14 |
| `pnpm docs:check` | PASS |
| `pnpm typecheck` | PASS，17 个 workspace 及适用 test:typecheck |
| `pnpm test` | PASS，离线门禁与 17 个 workspace 测试通过 |
| `pnpm build` | PASS，17 个 workspace；Next 产出 `/login` 静态路由 |
| `docker compose --env-file .env.production.example -f infra/docker-compose.prod.yml config --quiet` | PASS；仅有本机 Docker config 权限 warning |
| `git diff --check` | PASS |

## 已发现并复测的问题

### P2（已关闭）：issuer/audience 首尾空格导致签发与验证规则不一致

- 原因：签发配置会 `trim()` `AUTH_JWT_ISSUER` / `AUTH_JWT_AUDIENCE`，验证器曾直接比较原始环境变量；带首尾空格的部署值会使服务自己签发的 Cookie 在后续请求中被拒绝。
- 预期：签发和验证使用同一规范化配置。
- 修复：验证器对期望 issuer/audience 使用相同的 `trim()`；登录 roundtrip 测试改用带首尾空格的配置。
- 复测：`pnpm --filter @langreport/api test` 32/32、`pnpm --filter @langreport/api typecheck` 均通过。

当前没有未关闭的 P0/P1/P2 代码缺陷。

## 阻塞项与部署后复现步骤

### BLOCKED：真实 HTTPS Secure Cookie 验收

阻塞原因：缺少真实 HTTPS 域名、部署账号密码、已初始化的 `AUTH_LOGIN_USER_ID` 对应 Workspace。该项是外部环境条件，不是本地测试失败。

环境具备后执行：

1. 按 `docs/operations/deploy-ecs.md` 配置强随机 `AUTH_JWT_SECRET`、离线 scrypt 哈希、登录账号和用户 ID。
2. 启动同源 HTTPS 代理并设置 `PHASE5_API_ORIGIN`、`PHASE5_LOGIN_USERNAME`、`PHASE5_LOGIN_PASSWORD`、`PHASE5_WORKSPACE_ID`。
3. 运行 `pnpm phase5:smoke`。
4. 确认真实响应 Cookie 为 `langreport_session`，具有 `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`，Cookie-only session/业务访问成功，logout 后浏览器不再发送 Cookie。

## 覆盖缺口

- 进程内限流 Map 的 10,000 条上限和 15 分钟自然恢复由代码审查确认，当前没有专门的可控时钟单测。
- Web E2E 对 Auth API 使用 route mock；真实浏览器 Cookie 的刷新恢复、保护页 401 跳转和 logout 后访问拒绝需要由上述 HTTPS smoke/人工验收补齐。
- 无状态 logout 只清除浏览器 Cookie，不提供服务端 Token 撤销；这是已批准的非目标，旧 Token 若被手工保存仍可使用到 `exp`。

## 测试代码变更

- 独立验证 Agent 未新增或修改测试代码。
- 主 Agent 在复测前仅扩展既有登录 roundtrip 用例，用首尾空格 issuer/audience 覆盖本报告记录的修复。

## 结论

当前工作树满足本地可执行的登录网关验收：默认且最长 7 天的 HS256 JWT、HttpOnly `langreport_session` Cookie、scrypt 凭据校验、会话/登出、错误限流、Bearer 兼容、Web 不持久化密码、Contracts/OpenAPI/部署配置均有通过证据。代码层无阻断缺陷；变更仍应保持 `VERIFYING`，直到真实 HTTPS smoke 和用户最终验收完成。

## 开发强制登录范围调整复测

### 增量结论

- 复测结论：`TEST_PASSED`
- 未关闭缺陷：无 P0/P1/P2
- 生产验收：仍为 `BLOCKED`，原因仍是缺少真实 HTTPS 目标、部署凭据和生产 Workspace；本次开发范围调整没有新增外部阻塞。
- 快照：仍基于 Git HEAD `1d4dd9aa7647d063ab8b24e200723b0b3681275b` 的最新未提交工作树，包含用户批准的 T7 开发强制登录调整和复测期间修复。

### 范围核验

| 新增要求 | 结果 | 证据 |
| --- | --- | --- |
| development 空身份与 `x-user-id` 均不能认证 | PASS | `userIdFromRequest` 不再包含开发回退；API unit 同时断言空身份和伪造 Header 抛出 `UNAUTHENTICATED`，开发业务 API 返回 401 |
| 开发登录 Cookie 可恢复身份 | PASS | development 登录返回 `HttpOnly; SameSite=Lax; Path=/` 和默认/配置 TTL，不含独立 `Secure` 属性；Cookie 查询 session 成功 |
| 登录后开发 Bootstrap 可用 | PASS | 独立执行 `pnpm phase1:smoke`，真实 login 获取 Cookie 后 session 200、`POST /api/v1/dev/bootstrap` 200，再完成完整业务闭环 |
| Web 开发态不发身份 Header，并统一处理 401 | PASS | 工作台/插件页请求 Header 不再包含 `x-user-id`；所有环境的 401 均跳 `/login?returnTo=...`；退出入口始终存在 |
| OpenAPI 不暴露 `x-user-id` | PASS | `commonHeaders` 已删除该字段；Contracts 测试对每条路由断言其不存在 |
| 测试身份只能显式注入 | PASS | 运行代码与 `phase1-smoke` 不再发送 `x-user-id`；剩余正向使用只在 integration test 的显式 `authProvider` 内，其他出现位置为拒绝/缺失断言或生产拒绝 Smoke |
| Memory 无隐式本地用户 | PASS | `getMemoryContextForGeneration.userId` 改为必填，调用方均传入已认证用户或 Job `createdBy`；Memory typecheck/test 通过 |
| 开发配置和说明一致 | PASS | `.env.example` 要求本地配置 JWT Secret、账号、用户 ID 和 scrypt 哈希；`development-setup.md` 指导先生成哈希、访问 `/login`，并解释本地 Cookie 不含 `Secure` |

### 复测中发现并关闭的问题

#### P2（已关闭）：`phase1:smoke` 仍依赖已删除的开发身份 Header

- 复现条件：T7 移除开发回退后运行旧 `pnpm phase1:smoke`；脚本向真实 API 发送 `x-user-id`，首个受保护请求会返回 401。
- 影响：不形成产品身份绕过，但会破坏仓库的第一阶段真实 HTTP 验证入口，并违反“测试伪造身份只能通过显式 AuthProvider”的新边界。
- 修复：Smoke 在隔离环境生成随机登录账号、密码、scrypt 哈希和 JWT Secret；先真实调用 login，精确验证本地 Cookie 属性，通过 Cookie 恢复 session 和调用开发 Bootstrap，再执行原有完整闭环。日志脱敏覆盖密码、哈希、Secret、Token 与 Cookie。
- 独立复测：`pnpm phase1:smoke` PASS；输出仅包含随机业务标识和状态，不含认证秘密；PostgreSQL/MinIO 测试容器及网络均完成清理。

### 实际增量命令

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @langreport/api test` | PASS，33/33；包含开发空身份/Header 拒绝与非 Secure Cookie session |
| `pnpm --filter @langreport/api test:typecheck` | PASS |
| `pnpm --filter @langreport/api typecheck` | PASS |
| `pnpm --filter @langreport/contracts test` | PASS，26/26 |
| `pnpm --filter @langreport/memory typecheck` | PASS |
| `pnpm --filter @langreport/memory test` | PASS，2/2 |
| `pnpm --filter @langreport/web typecheck` | PASS |
| `pnpm --filter @langreport/web test:typecheck` | PASS |
| `pnpm test:e2e` | PASS，桌面与 390px 共 16/16；含开发未登录跳转和无 `x-user-id` |
| `pnpm phase1:smoke` | PASS，真实本地登录 Cookie、session、Bootstrap、生成/审核和四种导出闭环 |
| `pnpm typecheck` | PASS，17 个 workspace 及适用 test:typecheck |
| `pnpm test` | PASS，离线门禁与 17 个 workspace 测试通过 |
| `node --check scripts/phase1-smoke.mjs` | PASS |
| `pnpm docs:check` | PASS |
| `git diff --check` | PASS |

按主 Agent 要求，本轮没有重新运行 `pnpm build`，避免 Next 自动改写 `apps/web/next-env.d.ts`；T7 的 TypeScript、浏览器运行行为和真实 API/Worker 闭环已分别由 typecheck、E2E 与 `phase1:smoke` 覆盖。E2E 运行产生的 `next-env.d.ts` 临时变化已由主 Agent 恢复，最终状态不包含该文件。

### 剩余覆盖缺口与阻塞

- 真实 HTTPS 反向代理下的 `Secure` Cookie、浏览器刷新恢复和浏览器登出后不再发送 Cookie，仍需部署后的 `pnpm phase5:smoke` 与人工 DevTools 验收。
- 登录页和开发 401 E2E 使用路由 mock；真实 API Cookie 到 Bootstrap/完整业务闭环已由 `phase1:smoke` 补齐，但它不是浏览器 Cookie Jar 测试。
- 进程内限流 Map 的自然窗口恢复和条目上限仍缺少可控时钟专项单测，与原报告记录一致。
