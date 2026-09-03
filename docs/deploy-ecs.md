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
docker compose --env-file .env.production -f infra/docker-compose.prod.yml logs -f nginx api generation-worker render-worker
```

生产 Compose 已包含 Nginx。由于 ECS 宿主机已有 Nginx 占用 80 端口，项目 Nginx 对外监听 ECS 的 8080 端口，并在 Compose 内部将请求代理到 `api:4000`；API、PostgreSQL、MinIO 和 Workers 不直接映射到公网。Generation Worker 负责处理 `queued` Generation Job，Render Worker 负责处理 `rendering` Generation Job。

## 3. 初始化数据库

第一次启动后执行：

```sh
docker compose --env-file .env.production -f infra/docker-compose.prod.yml run --rm api \
  pnpm --filter @langreport/db db:push
```

## 4. Vercel 环境变量

在 Vercel 的 Production 环境设置：

```text
API_PROXY_ORIGIN=http://<ECS_PUBLIC_IP>:8080
NEXT_PUBLIC_API_URL=/api
```

前端请求 `/api/...`，由 Vercel Rewrite 转发到 ECS 的 8080 端口，再由项目 Nginx 转发到 API。这样无独立域名时也不会发生浏览器的 HTTPS 页面访问 HTTP API 的混合内容问题。不要把数据库或 MinIO 地址填入 Vercel。

## 注意事项

- 现有 API 使用开发态 `x-user-id` 身份识别，正式公网开放前必须接入真实登录认证和项目级授权。
- 当前上传接口会将文件读入内存，2 核 4 GiB 服务器不适合高并发大文件上传。
- 2 核 4 GiB ECS 建议 Generation Worker 和 Render Worker 各运行一个实例；增加实例前先观察内存和任务耗时。
- `db:push` 适合首次部署或开发阶段；正式生产发布前应补齐并固定迁移流程。
- 必须配置 ECS 安全组，至少开放 22 和项目 API 使用的 8080；宿主机已有网站时保留其 80 规则；未来配置 HTTPS 后再开放 443；不要开放 5432、9000、9001、4000 到公网。
