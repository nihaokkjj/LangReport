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
pnpm infra:up
pnpm db:push
pnpm dev:all
```

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
apps/generation-worker   TransformPlan / Model Gateway 的进程边界
apps/render-worker       flint-chart / Vega-Lite 的进程边界
packages/contracts       Zod API、任务和 TransformPlan Schema
packages/db              Drizzle Schema、数据库客户端和迁移入口
packages/data-engine     CSV/XLSX/JSON 解析、字段画像和预览
packages/storage         S3/MinIO 对象存储适配
infra                    PostgreSQL、MinIO 等本地依赖
```

当前两个 Worker 只提供进程和 Flint smoke test 骨架，还没有连接任务队列；下一步再实现 Generation Job、队列和真实数据处理器。

## 4. 数据输入 API

当前本地开发身份是 `local-dev-user`，通过 `x-user-id` 请求头传递；这只用于开发验证，不能作为生产认证方案。

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
```

## 6. 数据库工作流

开发阶段可以使用 `pnpm db:push` 快速同步 Schema。进入多人协作或部署阶段后，改用：

```powershell
pnpm db:generate
pnpm --filter @langreport/db db:migrate
```

提交 migration 文件，不要在共享环境直接依赖 `db:push`。

## 7. 第一阶段实现顺序

1. 补充身份认证和 Workspace/Project API；目前 API 只有健康检查。
2. 增加 Data Asset、Data Snapshot 和私有对象存储适配器。
3. 为 Generation Job 增加持久化状态和 PostgreSQL-backed Queue。
4. 实现 TransformPlan 受限执行器和字段血缘。
5. 将 Render Worker 的 demo 输入替换为真实 Chart Revision 输入。
6. 加入 Workspace 作用域、Project Role 和越权测试。

## 8. 开发环境原则

- 本地依赖通过 Docker 管理，应用进程通过 pnpm 管理。
- `.env` 不提交 Git，只提交 `.env.example`。
- 所有跨包共享数据结构放入 `packages/contracts`，不要在前后端重复定义。
- 数据库 Schema 只由 `packages/db` 拥有。
- `flint-chart` 只在 Render Worker 和 `packages/flint-adapter` 中出现。
- API 请求不能直接在 HTTP 进程内执行长时间模型、数据处理或渲染任务。
