# ECS 部署说明

当前部署目标是：Vercel 托管 `apps/web`，ECS 通过 Docker Compose 托管 API、PostgreSQL、MinIO、Generation Worker 和 Render Worker。

## 1. 准备服务器目录

将项目上传到 ECS，例如 `/opt/langreport`，并在项目根目录创建生产环境文件：

```sh
cp .env.production.example .env.production
chmod 600 .env.production
```

填写强随机的 `POSTGRES_PASSWORD`、`S3_SECRET_KEY`，并将 `WEB_ORIGIN` 改为 Vercel 生产域名。

## 2. 启动 API、基础服务和 Workers

```sh
cd /opt/langreport
docker compose --env-file .env.production -f infra/docker-compose.prod.yml config
docker compose --env-file .env.production -f infra/docker-compose.prod.yml up -d --build
```

查看状态和日志：

```sh
docker compose --env-file .env.production -f infra/docker-compose.prod.yml ps
docker compose --env-file .env.production -f infra/docker-compose.prod.yml logs -f api generation-worker render-worker
```

API 只绑定到 ECS 本机的 `127.0.0.1:4000`，PostgreSQL、MinIO 和 Workers 不映射到公网。Generation Worker 负责处理 `queued` Generation Job，Render Worker 负责处理 `rendering` Generation Job。后续应由 Nginx/Caddy 监听 80/443，并反向代理到 `127.0.0.1:4000`。

## 3. 初始化数据库

第一次启动后执行：

```sh
docker compose --env-file .env.production -f infra/docker-compose.prod.yml run --rm api \
  pnpm --filter @langreport/db db:push
```

## 4. Vercel 环境变量

在 Vercel 的 Production 环境设置：

```text
NEXT_PUBLIC_API_URL=https://api.example.com
```

`api.example.com` 应指向 ECS 的公网 IP 或负载均衡器，并配置 HTTPS。不要把数据库或 MinIO 地址填入 Vercel。

## 注意事项

- 现有 API 使用开发态 `x-user-id` 身份识别，正式公网开放前必须接入真实登录认证和项目级授权。
- 当前上传接口会将文件读入内存，2 核 4 GiB 服务器不适合高并发大文件上传。
- 2 核 4 GiB ECS 建议 Generation Worker 和 Render Worker 各运行一个实例；增加实例前先观察内存和任务耗时。
- `db:push` 适合首次部署或开发阶段；正式生产发布前应补齐并固定迁移流程。
- 必须配置 ECS 安全组，仅按需开放 22、80、443；不要开放 5432、9000、9001、4000 到公网。
