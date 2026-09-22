# ECS 部署说明

当前部署目标是：Vercel 托管 `apps/web`，ECS 通过 Docker Compose 托管 API、PostgreSQL、MinIO、Generation Worker 和 Render Worker。

## 1. 准备服务器目录

将项目上传到 ECS，例如 `/opt/langreport`，并在项目根目录创建生产环境文件：

```sh
cp .env.production.example .env.production
chmod 600 .env.production
```

填写强随机的 `POSTGRES_PASSWORD`、`S3_SECRET_KEY`、`AUTH_JWT_SECRET`，并将 `WEB_ORIGIN` 改为 Vercel 生产域名。使用 `pnpm auth:hash-password` 离线生成密码哈希，将整段输出以单引号包裹后写入 `AUTH_LOGIN_PASSWORD_HASH`，同时配置 `AUTH_LOGIN_USERNAME` 和作为 JWT `sub` 的 `AUTH_LOGIN_USER_ID`。不要把明文密码写入 `.env.production`。内置登录网关签发 HS256 JWT，并只通过 HttpOnly `langreport_session` Cookie 返回浏览器；默认有效期为 7 天，部署侧只允许缩短。

## 2. 启动 API、基础服务和 Workers

```sh
cd /opt/langreport
docker compose --env-file .env.production -f infra/docker-compose.prod.yml config
docker compose --env-file .env.production -f infra/docker-compose.prod.yml up -d --build
```

查看状态和日志：

```sh
docker compose --env-file .env.production -f infra/docker-compose.prod.yml ps
docker compose --env-file .env.production -f infra/docker-compose.prod.yml logs -f nginx api generation-worker render-worker
```

生产 Compose 已包含一次性 `migrate` 服务：PostgreSQL 健康且迁移成功后，API、Generation Worker 和 Render Worker 才会启动。这样不会在新库上先轮询不存在的业务表。Compose 还包含 Nginx；由于 ECS 宿主机已有 Nginx 占用 80 端口，项目 Nginx 对外监听 ECS 的 8080 端口，并在 Compose 内部将请求代理到 `api:4000`；API、PostgreSQL、MinIO 和 Workers 不直接映射到公网。Generation Worker 负责处理 `queued` Generation Job，Render Worker 负责处理 `rendering` Generation Job。

## 3. 初始化数据库

首次部署或发布迁移时，Compose 会通过 `migrate` 服务执行版本化迁移；需要单独重跑时使用：

```sh
docker compose --env-file .env.production -f infra/docker-compose.prod.yml run --rm migrate
```

不要在生产环境使用 `db:push` 替代迁移。发布前应在备份或 staging 数据库执行一次兼容性校验：

```sh
docker compose --env-file .env.production -f infra/docker-compose.prod.yml run --rm api \
  pnpm --filter @langreport/db db:verify
```

`db:verify` 只在目标数据库创建并删除 `migration_verify_*` 临时 schema，重放完整迁移链并检查历史 Phase 2–4 Job/Revision/Theme；生产发布仍需由运维确认备份、回滚窗口和数据库权限。

首次部署还需要把 `AUTH_LOGIN_USER_ID` 初始化为个人 Project 作用域。开发 Bootstrap 在生产环境不可用，使用下面的显式确认命令按用户创建内部私有 Workspace、Project 和授权记录；重复执行不会重复创建成员或 Project：

```sh
docker compose --env-file .env.production -f infra/docker-compose.prod.yml run --rm \\
  -e PROVISION_CONFIRM=I_UNDERSTAND \\
  -e PROVISION_USER_ID='<AUTH_LOGIN_USER_ID>' \\
  -e PROVISION_PROJECT_NAME='咨询项目 Demo' \\
  api pnpm --filter @langreport/api provision:production
```

只读预览可将确认变量替换为 `PROVISION_DRY_RUN=true`。只有迁移或修复历史数据时才额外设置 `PROVISION_WORKSPACE_ID`；普通用户初始化不要复用已有 Workspace，脚本不会因为重复执行而提升已有成员权限。

## 4. 第一阶段发布前真实百炼门禁

正式发布不能使用 `.env.production.example` 的 deterministic 默认值。发布环境必须先在应用仓库目录设置以下变量，并让它们与即将启动的 Generation Worker 使用同一套路由配置：

```text
GENERATION_MODE=llm
BAILIAN_BASE_URL=https://<bailian-endpoint>/compatible-mode/v1
BAILIAN_MODEL_ID=<model-id>
BAILIAN_STRUCTURED_OUTPUT=json_schema
BAILIAN_API_KEY=<worker-only-secret>
```

在 `docker compose up` 之前执行一次真实结构化调用：

```sh
set -a
. ./.env.production
set +a
pnpm phase1:release-gate
```

门禁必须输出 `{"status":"passed","gate":"phase1-release-gate",...}` 才允许继续启动或切换生产服务。它会验证百炼认证、端点、模型 ID、结构化输出合同和成功的 Model Invocation；输出只包含脱敏 request ID、耗时和 finish reason，不打印 API Key、提示词或模型原文。门禁失败时停止发布，不得用 deterministic 结果替代。`BAILIAN_API_KEY` 只注入 Generation Worker，不能注入 Web 或 API。

该命令会产生一次真实模型调用费用，应使用合成上下文和发布预算执行。业务质量、模型延迟和配额由运维另行监控，但认证和结构化响应门禁不能跳过。

## 5. Phase 5 生产 Smoke 验收

完成登录网关配置和数据库初始化后，在可访问 API 的环境执行一次：

```sh
PHASE5_API_ORIGIN=https://<public-api-origin> \\
PHASE5_LOGIN_USERNAME='<AUTH_LOGIN_USERNAME>' \\
PHASE5_LOGIN_PASSWORD='<deployment-login-password>' \\
PHASE5_WORKSPACE_ID='<workspace-id>' \\
PHASE5_PROJECT_ID='<optional-project-id>' \\
pnpm phase5:smoke
```

该命令只输出每个检查的 HTTP 状态，不输出认证凭据。推荐提供 `PHASE5_LOGIN_USERNAME` 和 `PHASE5_LOGIN_PASSWORD`，脚本会真实登录并验证 `langreport_session` 的 `HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/` 和 7 天 `Max-Age`，再用 Cookie 查询会话、访问业务接口并登出。`PHASE5_JWT` 或 `PHASE5_SESSION_COOKIE` 仍可用于兼容验证。脚本同时验证健康检查、数据库就绪、无认证拒绝、生产环境伪造 `x-user-id` 拒绝和插件管理接口。提供 `PHASE5_PROJECT_ID` 时还会检查 Project 插件 Binding 和能力目录。

如需验证完整垂直链路，可在 Smoke 通过后执行下面的验收脚本。它会写入一条带随机后缀的数据快照、对话和 Generation Job，并默认执行“撤销插件 → 读取历史 Revision → 导出 → 恢复插件”；不要在需要保持生产数据完全不变的环境执行，或设置 `PHASE5_E2E_REVOCATION=false` 跳过撤销段：

```sh
PHASE5_API_ORIGIN=https://<public-api-origin> \
PHASE5_JWT='<short-lived-user-token>' \
PHASE5_WORKSPACE_ID='<workspace-id>' \
PHASE5_PROJECT_ID='<project-id>' \
pnpm phase5:e2e
```

脚本会验证精确插件上下文、插件 Theme、Generation Worker → Render Worker → Revision、SVG 导出以及撤销后的历史快照保留；认证凭据不会打印。

## 6. Vercel 环境变量

在 Vercel 的 Production 环境设置：

```text
API_PROXY_ORIGIN=http://<ECS_PUBLIC_IP>:8080
NEXT_PUBLIC_API_URL=/api
```

前端请求 `/api/...`，由 Vercel Rewrite 转发到 ECS 的 8080 端口，再由项目 Nginx 转发到 API。生产前端会通过登录网关携带的认证 Cookie 读取已初始化的 Workspace/Project，不调用仅限开发环境的 Bootstrap；本地开发才会自动 Bootstrap。这样无独立域名时也不会发生浏览器的 HTTPS 页面访问 HTTP API 的混合内容问题。不要把数据库或 MinIO 地址填入 Vercel。

## 注意事项

- API 生产边界自动校验内置登录网关签发的 JWT 并拒绝可伪造的 `x-user-id`；部署前必须配置登录账号、scrypt 哈希与签名密钥，并完成真实 HTTPS 登录回归，未完成前不要正式公网开放。
- 第一阶段正式发布必须先通过 `pnpm phase1:release-gate`；当前仓库的 deterministic 配置只适用于离线和回归测试。
- 当前上传接口会将文件读入内存，2 核 4 GiB 服务器不适合高并发大文件上传。
- 2 核 4 GiB ECS 建议 Generation Worker 和 Render Worker 各运行一个实例；增加实例前先观察内存和任务耗时。
- `db:push` 只适合开发阶段；正式生产发布必须执行版本化 `db:migrate`，并在备份/staging 环境完成 `db:verify`。
- 必须配置 ECS 安全组，至少开放 22 和项目 API 使用的 8080；宿主机已有网站时保留其 80 规则；未来配置 HTTPS 后再开放 443；不要开放 5432、9000、9001、4000 到公网。
