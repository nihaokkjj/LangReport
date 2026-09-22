# LangReport 开发环境

## 1. 前置环境

当前仓库按以下环境准备：

- Node.js 22+
- pnpm 11+
- Docker Desktop（包含 Docker Compose）
- Git

在 Windows PowerShell 中检查：

```powershell
node --version
pnpm --version
docker compose version
```

## 2. 第一次启动

在仓库根目录执行：

```powershell
Copy-Item .env.example .env
pnpm install
pnpm auth:hash-password
pnpm infra:up
pnpm db:push
pnpm dev:all
```

把哈希脚本输出写入本地 `.env` 的 `AUTH_LOGIN_PASSWORD_HASH`，并同时配置
`AUTH_JWT_SECRET`、`AUTH_LOGIN_USERNAME` 和 `AUTH_LOGIN_USER_ID`。开发环境不会接受
`x-user-id` 或隐式 `local-dev-user`；未配置登录网关时 `/login` 会明确提示服务不可用。
本地 HTTP Cookie 仍为 `HttpOnly; SameSite=Lax; Path=/`，只有 `Secure` 留给 HTTPS 生产环境。

启动后：

- 前端：http://localhost:3000
- API 健康检查：http://localhost:4000/health
- API 数据库就绪检查：http://localhost:4000/ready
- PostgreSQL：localhost:54329
- MinIO API：http://localhost:9000
- MinIO 控制台：http://localhost:9001

MinIO 开发账号是 `langreport`，密码是 `langreport-dev-secret`。生产环境必须替换凭据，不得复用 `.env.example`。
Compose 会通过一次性 `minio-init` 服务自动创建 `langreport` bucket。

## 3. 本地服务职责

```text
apps/web                 Next.js 前端
apps/api                 Fastify 模块化单体 API
apps/generation-worker   Generation Job 调度、Generation Cycle 输入快照和结果持久化边界
apps/render-worker       flint-chart / Vega-Lite 的进程边界
packages/contracts       Zod API、任务和 TransformPlan Schema
packages/db              Drizzle Schema、数据库客户端和迁移入口
packages/data-engine     CSV/XLSX/JSON 解析、字段画像和预览
packages/generation      Generation Cycle seam、确定性 adapter、计划生成、Flint Spec 和校验
packages/flint-adapter    Flint 编译、确定性 SVG/PNG 输出边界
packages/storage         S3/MinIO 对象存储适配
infra                    PostgreSQL、MinIO 等本地依赖
```

Generation Worker 和 Render Worker 通过 PostgreSQL-backed Generation Job 状态轮询协作：前者只组装固化输入并消费 `GenerationCycle` 的 `drafted / needs_clarification / failed` 结果，Cycle 内部负责意图、TransformPlan、变换、血缘和计划校验，后者负责固定版本 Flint 编译、Vega-Lite/SVG/PNG 输出以及静态 SVG 包装 HTML。

## 4. 数据输入 API

本地开发与生产共用账号密码、HS256 JWT 和 HttpOnly Cookie 身份边界。先访问 `/login`
建立会话，再由工作台调用开发 Bootstrap；Bootstrap 只负责创建或读取本地 Demo 数据，不负责授予身份。

```text
POST /api/v1/dev/bootstrap
    创建或读取本地 Demo Workspace/Project

GET  /api/v1/projects/:projectId/data-assets
    查询项目的数据资产和最新 Snapshot

POST /api/v1/projects/:projectId/data-assets/upload
    multipart 上传 CSV/XLSX/JSON，最大 50 MB

POST /api/v1/projects/:projectId/data-assets/paste
    JSON 粘贴 CSV/TSV 表格内容

GET  /api/v1/data-assets/:assetId
    读取数据资产及最新 Snapshot 预览

POST /api/v1/projects/:projectId/conversations
    创建 Conversation

POST /api/v1/projects/:projectId/generation-jobs
    从自然语言和 Data Snapshot 创建幂等 Generation Job

GET  /api/v1/generation-jobs/:jobId
    查询任务状态、Intent、TransformPlan、字段血缘、Flint Spec 和校验结果

POST /api/v1/generation-jobs/:jobId/retry
    重新入队可恢复的生成/渲染失败任务；确定性失败和超过三次尝试会被拒绝

GET  /api/v1/generation-jobs/:jobId/outputs/:format
    下载 png、svg、html 或 vegaLite 输出
```

## 5. 常用命令

```powershell
# 只启动前端和 API
pnpm dev

# 启动全部本地进程
pnpm dev:all

# 检查所有 TypeScript workspace
pnpm typecheck

# 生成 Drizzle migration
pnpm db:generate

# 将当前 Schema 推送到本地数据库
pnpm db:push

# 打开 Drizzle Studio
pnpm db:studio

# 停止本地数据库和对象存储
pnpm infra:down

# 运行隔离的第一阶段真实 HTTP 闭环（会自行启动并清理测试服务）
pnpm phase1:smoke
```

`pnpm phase1:smoke` 使用 deterministic Model Route，验证 Project → Snapshot → Brief/Metric → Generation/Render Worker → Evidence → 编辑/审核 → 四种固定 Revision 导出；它不访问真实百炼。正式发布前必须在发布环境执行 `pnpm phase1:release-gate`，具体变量和顺序见 [ECS 部署说明](./deploy-ecs.md)。

## 6. 数据库工作流

开发阶段可以使用 `pnpm db:push` 快速同步 Schema。进入多人协作或部署阶段后，改用：

```powershell
pnpm db:generate
pnpm --filter @langreport/db db:migrate
```

提交 migration 文件，不要在共享环境直接依赖 `db:push`。

发布前可以用隔离 schema 重放完整迁移链，并验证 Phase 2–4 历史 Job、Revision、Project Theme 在新增插件字段后的默认值和原值：

```powershell
pnpm db:verify
```

该命令只创建并删除 `migration_verify_*` 临时 schema，不会修改现有业务表；它还会校验迁移文件与 Drizzle journal 一致，并检查 Phase 5 的部分唯一索引仍存在。

## 7. 阶段 2 实现顺序

1. Conversation 保存用户自然语言意图，按 Project 固定 Data Snapshot。
2. Generation Cycle 通过确定性 adapter 生成并执行受限 TransformPlan，保存每一步的行数和字段血缘。
3. Generation Cycle 生成 Flint Spec，执行 Schema、语义、数据字段和视觉校验，最多自动修复两轮。
4. Render Worker 使用固定版本的 `flint-chart`，写入 Vega-Lite、SVG、PNG 和静态 HTML 私有对象；HTML 只包装服务端已验证的 SVG。
5. 通过 Chart Revision 保存 Snapshot、计划、规范、主题快照、校验结果和输出地址。

## 8. 开发环境原则

- 本地依赖通过 Docker 管理，应用进程通过 pnpm 管理。
- `.env` 不提交 Git，只提交 `.env.example`。
- 所有跨包共享数据结构放入 `packages/contracts`，不要在前后端重复定义。
- 数据库 Schema 只由 `packages/db` 拥有。
- `flint-chart` 只在 Render Worker 和 `packages/flint-adapter` 中出现。
- API 请求不能直接在 HTTP 进程内执行长时间模型、数据处理或渲染任务。
