# LangReport 前后端部署上线复盘

> 用途：面试前回顾项目部署架构、前后端通信、故障定位和解决过程。
>
> 首次整理：2026-09-03；最近更新：2026-09-13
>
> 安全说明：本文不记录真实公网 IP、密码、Token 或私钥，示例中的地址均使用占位符。

## 1. 项目背景与部署目标

LangReport 第一阶段是一个面向咨询项目的报告证据工作台。用户上传客户数据，确认 Analysis Brief 和 Metric Definition，系统通过一次 Generation Cycle 生成可追溯的 Evidence Block。

本次部署目标是：

- 前端部署到 Vercel；
- API、数据库、对象存储和异步 Worker 部署到阿里云 ECS；
- 不额外购买域名；
- 让浏览器能够稳定访问后端 API；
- 保证 PostgreSQL、MinIO 和 API 内部端口不直接暴露到公网。

## 2. 最终部署架构

```text
浏览器
  │ HTTPS
  ▼
Vercel Web App
https://<vercel-project>.vercel.app
  │ 同源请求 /api/...
  │ Next.js Rewrite
  ▼
ECS 公网 IP:8080
  │
  ▼
项目 Nginx 容器:80
  │ Docker Compose 网络
  ▼
API 容器 api:4000
  ├── PostgreSQL
  ├── MinIO
  ├── Generation Worker
  └── Render Worker
```

最终采用了两个不同层级的端口：

| 层级 | 地址 | 作用 |
| --- | --- | --- |
| Vercel 前端 | `https://<vercel-project>.vercel.app` | 浏览器访问的 HTTPS 页面 |
| ECS 项目入口 | `http://<ECS_PUBLIC_IP>:8080` | 项目 Nginx 的公网入口 |
| Nginx 容器 | `:80` | 容器内部监听端口 |
| API 容器 | `api:4000` | Docker 网络内部 API |
| PostgreSQL | `postgres:5432` | Docker 网络内部数据库 |
| MinIO | `minio:9000` | Docker 网络内部对象存储 |

## 3. 为什么不让前端直接访问 API:4000

最初容易想到的方式是把 Vercel 环境变量设置为：

```text
NEXT_PUBLIC_API_URL=http://<ECS_PUBLIC_IP>:4000
```

但这个方案存在几个问题：

1. Vercel 页面是 HTTPS，浏览器访问 HTTP API 容易触发 Mixed Content，被浏览器拦截；
2. API 端口需要直接暴露到公网；
3. 浏览器跨域访问还需要配置 CORS；
4. 客户数据、上传文件和 API 请求缺少完整的 HTTPS 保护；
5. API 当前还使用开发态 `x-user-id`，直接公网暴露存在身份伪造风险。

因此最终让浏览器始终访问同源地址：

```text
/api/v1/projects
/api/v1/projects/<projectId>/data-assets
/api/v1/generation-jobs/<jobId>
```

Vercel 再在服务端把这些请求转发到 ECS。

## 4. 前端通信配置

配置文件是 [apps/web/next.config.ts](../../apps/web/next.config.ts)。

核心 Rewrite 规则：

```ts
const apiOrigin = (process.env.API_PROXY_ORIGIN ?? "http://localhost:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/health",
        destination: `${apiOrigin}/health`
      },
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`
      }
    ];
  }
};
```

后端的健康接口是 `/health`，业务接口是 `/api/v1/...`，所以健康检查需要单独映射。

前端 Production 环境变量：

```text
API_PROXY_ORIGIN=http://<ECS_PUBLIC_IP>:8080
NEXT_PUBLIC_API_URL=/api
```

`API_PROXY_ORIGIN` 是 Vercel 构建时使用的服务端代理目标，不应使用 `NEXT_PUBLIC_` 前缀。

`NEXT_PUBLIC_API_URL=/api` 表示浏览器只访问当前 Vercel 站点的 `/api` 路径。

## 5. ECS 生产配置

ECS 上创建：

```text
.env.production
```

关键配置包括：

```text
POSTGRES_USER=langreport
POSTGRES_PASSWORD=<strong-random-password>
POSTGRES_DB=langreport

S3_ACCESS_KEY=langreport
S3_SECRET_KEY=<strong-random-password>
S3_BUCKET=langreport

WEB_ORIGIN=https://<vercel-project>.vercel.app
API_PORT=4000
```

生产环境文件需要限制权限：

```bash
chmod 600 .env.production
```

Vercel 不配置数据库地址、MinIO 地址、数据库密码或对象存储密钥。

## 6. Docker Compose 配置

生产 Compose 文件是 [infra/docker-compose.prod.yml](../../infra/docker-compose.prod.yml)。

API 不直接暴露公网端口，只在 Docker 网络中提供：

```yaml
expose:
  - "4000"
```

项目 Nginx 使用：

```yaml
ports:
  - "8080:80"
```

含义是：

```text
ECS:8080 → Nginx 容器:80 → api:4000
```

Nginx 配置是 [infra/nginx/nginx.conf](../../infra/nginx/nginx.conf)：

```nginx
server {
    listen 80;
    server_name _;

    client_max_body_size 60m;

    location / {
        proxy_pass http://api:4000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_request_buffering off;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

这里的 `proxy_pass http://api:4000` 使用的是 Docker Compose 服务名，不是 `localhost`。因为 Nginx 和 API 在不同容器中，Nginx 容器内的 `localhost` 指向 Nginx 自己。

## 7. 实际部署流程

### 7.1 本地准备和推送

本地项目需要包含以下部署文件：

- `infra/docker-compose.prod.yml`；
- `infra/nginx/nginx.conf`；
- `apps/web/next.config.ts`；
- `apps/web/app/page.tsx` 中的同源 API 地址处理；
- `.env.example`；
- `docs/operations/deploy-ecs.md`。

确认改动后，将对应代码推送到 GitHub，Vercel 才能读取新的前端配置。

### 7.2 ECS 启动服务

在 ECS 项目目录执行：

```bash
cd /opt/langreport

docker compose --env-file .env.production \
  -f infra/docker-compose.prod.yml \
  config --services

docker compose --env-file .env.production \
  -f infra/docker-compose.prod.yml \
  up -d --build

docker compose --env-file .env.production \
  -f infra/docker-compose.prod.yml \
  ps
```

第一次部署数据库时执行：

```bash
docker compose --env-file .env.production \
  -f infra/docker-compose.prod.yml \
  run --rm api pnpm --filter @langreport/db db:push
```

正常情况下：

- API 是 `Up (healthy)`；
- PostgreSQL 是 `Up (healthy)`；
- Generation Worker 和 Render Worker 是 `Up`；
- `minio-init` 完成初始化后显示 `Exited (0)` 是正常的；
- Nginx 应显示 `0.0.0.0:8080->80/tcp`。

### 7.3 阿里云安全组

最终需要开放：

```text
22/TCP      SSH
8080/TCP    项目 Nginx 公网入口
```

不要开放：

```text
4000/TCP    API 内部端口
5432/TCP    PostgreSQL
9000/TCP    MinIO
9001/TCP    MinIO 控制台
```

宿主机原有 Nginx 已占用 80，因此项目 Nginx 不再抢占 80。

### 7.4 Vercel 配置

Vercel 项目使用 `apps/web` 作为 Root Directory。

Production 环境变量：

```text
API_PROXY_ORIGIN=http://<ECS_PUBLIC_IP>:8080
NEXT_PUBLIC_API_URL=/api
```

保存后重新部署 Vercel。

## 8. 前后端通信验证

验证应该按链路从内到外执行。

### 8.1 API 容器健康检查

```bash
docker compose --env-file .env.production \
  -f infra/docker-compose.prod.yml \
  exec api node -e "fetch('http://127.0.0.1:4000/health').then(async r => console.log(r.status, await r.text()))"
```

预期返回 `200` 和：

```json
{"status":"ok","service":"api"}
```

### 8.2 Nginx 容器访问 API

```bash
docker compose --env-file .env.production \
  -f infra/docker-compose.prod.yml \
  exec nginx wget -S -O - http://api:4000/health
```

这里必须使用裸 URL，不能把 Markdown 链接格式复制进 Shell。

### 8.3 ECS 公网入口

```bash
curl -i http://<ECS_PUBLIC_IP>:8080/health
```

### 8.4 Vercel Rewrite

```bash
curl -i https://<vercel-project>.vercel.app/api/health
```

三层都返回 200，说明：

```text
API 正常
→ Docker 内部 Nginx 正常
→ ECS 公网端口正常
→ Vercel Rewrite 正常
```

## 9. 遇到的问题与解决过程

### 问题一：一开始没有域名，不知道前后端怎么通信

直接让 Vercel 浏览器端请求 ECS 的 HTTP IP 地址会遇到 HTTPS、Mixed Content 和 CORS 问题。

解决方式：

```text
浏览器请求同源 /api/...
→ Vercel Next.js Rewrite
→ ECS:8080
→ Nginx
→ api:4000
```

这样前端不需要知道 API 的真实地址，浏览器也不会直接跨域访问 API。

### 问题二：Nginx 服务存在但没有运行

执行：

```bash
docker compose ... exec nginx ...
```

出现：

```text
service "nginx" is not running
```

之后查看到 Nginx 容器状态是：

```text
Created
```

原因是 `exec` 只能进入已经运行的容器，不负责启动服务。

解决方式：

```bash
docker compose --env-file .env.production \
  -f infra/docker-compose.prod.yml \
  up -d nginx
```

### 问题三：项目 Nginx 无法绑定 80 端口

启动项目 Nginx 时出现：

```text
listen tcp4 0.0.0.0:80: bind: address already in use
```

通过：

```bash
sudo ss -lntp | grep ':80'
```

发现 ECS 宿主机已经有 Nginx 进程监听：

```text
0.0.0.0:80 users:("nginx", ...)
```

而：

```bash
docker ps | grep 80
```

没有 Docker 容器占用，说明冲突来源是宿主机 Nginx。

没有贸然停止已有 Nginx，而是把项目 Nginx 的端口映射改成：

```yaml
ports:
  - "8080:80"
```

并在 Vercel 中把代理地址改成：

```text
API_PROXY_ORIGIN=http://<ECS_PUBLIC_IP>:8080
```

### 问题四：安全组遗漏 8080 导致 Vercel Rewrite 返回 502

#### 故障现象

前端页面能够由 Vercel 正常加载，但请求 `/api/v1/projects` 时返回：

```text
502 Bad Gateway
ROUTER_EXTERNAL_TARGET_CONNECTION_ERROR
```

绕过本机代理、直接从开发机访问 ECS 公网入口时，也没有收到有效的 HTTP 响应：

```bash
curl.exe -v --noproxy "*" --connect-timeout 10 http://<ECS_PUBLIC_IP>:8080/health
```

```text
Connected to <ECS_PUBLIC_IP> port 8080
Request completely sent off
Empty reply from server
curl: (52) Empty reply from server
```

与此同时，ECS 内部检查全部正常：

- Nginx 容器状态为 `healthy`；
- `nginx -t` 显示配置语法正确；
- Docker 显示 `0.0.0.0:8080->80/tcp`；
- ECS 宿主机访问 `http://127.0.0.1:8080/health` 返回 `200`；
- Nginx 健康检查日志持续显示来自 `127.0.0.1` 的 `GET /health` 返回 `200`。

这些结果证明 `Nginx → api:4000` 和 ECS 宿主机内部端口映射正常，但不能证明公网请求能够进入 ECS。容器 `healthy` 只覆盖容器内部链路，不覆盖阿里云安全组。

#### 根因

将项目 Nginx 从宿主机 80 端口改为 `8080:80` 后，阿里云 ECS 安全组中没有同步增加入方向 TCP 8080 规则。Vercel Rewrite 的目标虽然正确配置为 `http://<ECS_PUBLIC_IP>:8080`，但公网流量无法通过云侧网络边界到达项目 Nginx。

本次环境中，安全组遗漏表现为客户端建立连接后收到 `Empty reply from server`；不能仅凭“TCP 已连接”排除安全组或云侧网络规则，应继续用 ECS 外部健康检查验证完整 HTTP 请求和响应。

#### 修复

在当前 ECS 实例实际关联的阿里云安全组中新增入方向规则：

```text
协议：TCP
目的端口：8080
授权对象：覆盖 Vercel 访问来源的允许范围
```

规则生效后，不需要修改 Nginx 配置，也不需要暴露 API 容器的 4000 端口。

#### 验证

按从外到内的真实调用路径执行：

```bash
curl -i http://<ECS_PUBLIC_IP>:8080/health
curl -i https://<vercel-project>.vercel.app/api/health
```

两层健康检查均返回 `200`，随后浏览器中的 `/api/v1/projects` 不再返回 Vercel 502，前后端通信恢复。

#### 可复用结论

- Docker `ports` 只负责宿主机与容器之间的端口发布，不会自动修改阿里云安全组；
- “容器健康 + 本机访问成功”不能替代 ECS 公网访问测试；
- Vercel 的 `ROUTER_EXTERNAL_TARGET_CONNECTION_ERROR` 应优先检查外部目标的公网可达性；
- 排查时要区分应用层、容器层、宿主机端口层、云安全组层和 Vercel Rewrite 层。

### 问题五：把 Markdown 链接复制到了终端

错误形式：

```bash
wget [http://api:4000/health](http://api:4000/health)
```

正确形式：

```bash
wget http://api:4000/health
```

终端命令必须使用裸 URL。

### 问题六：GitHub `git pull` 返回 Empty reply from server

执行 `git pull` 时出现：

```text
fatal: unable to access 'https://github.com/...': Empty reply from server
```

当时 `ping github.com` 成功，但这只能说明 DNS 和 ICMP 通路正常，不能说明 Git 使用的 HTTPS/TCP 443 通路正常。

另外，remote 地址显示末尾有多余的 `/`，排查时建议先规范化为标准地址：

```bash
git remote set-url origin https://github.com/<owner>/<repo>.git
```

会话记录没有明确确认这条规范化命令是否在最终成功前实际执行，因此面试时不要把它说成确定完成的步骤；确定发生并成功的是下面的 HTTP/1.1 拉取命令。

还曾经在离开项目目录、进入 `/` 后执行 `git pull`，出现：

```text
fatal: not a git repository
```

原因是 `/` 目录没有 `.git`，正确做法是返回项目目录：

```bash
cd /opt/langreport
```

先用以下命令隔离测试 HTTPS：

```bash
curl -4 -I --connect-timeout 10 --max-time 20 https://github.com
```

然后使用 HTTP/1.1 拉取：

```bash
git -c http.version=HTTP/1.1 pull --ff-only
```

最终通过这条命令成功拉取仓库，之后再次执行仓库拉取也成功。

命令参数的面试解释：

- `-4`：强制 IPv4，排除 IPv6 路由问题；
- `-I`：只请求响应头，快速检查 HTTPS；
- `--connect-timeout` 和 `--max-time`：避免网络异常时无限等待；
- `http.version=HTTP/1.1`：绕过部分代理或网络设备对 HTTP/2 的兼容问题；
- `--ff-only`：只允许快进更新，不自动创建 Merge Commit，降低部署时误合并风险。

## 10. 最终故障定位方法

这次排查形成了一个从内到外的分层方法：

```text
API 容器健康检查
  ↓
Nginx 容器到 api:4000
  ↓
ECS 公网 IP:8080
  ↓
Vercel /api/health
```

每一层只验证一个问题，避免把“API 未启动、端口未开放、Nginx 未启动、Vercel Rewrite 未部署”混在一起排查。

典型判断：

| 现象 | 定位方向 |
| --- | --- |
| API 容器 unhealthy | 数据库、MinIO、环境变量或 API 本身 |
| Nginx 容器无法访问 `api:4000` | Compose 网络、服务名或 API 容器 |
| ECS 连接超时 | 阿里云安全组、系统防火墙或公网 IP |
| ECS 内部 `/health` 为 200，但外部请求返回 `Empty reply from server` | 优先核对当前实例关联的安全组是否开放实际映射端口；本次根因是缺少 TCP 8080 入方向规则 |
| ECS 返回 HTML 404 | 命中了宿主机原有 Nginx，而不是项目 Nginx |
| Vercel 返回 404 | Rewrite 未部署、Root Directory 错误或代理仍指向 80 |
| Vercel 返回 502/504 | ECS:8080 不可达或 Vercel 代理目标错误 |

## 11. 面试表达版

### 60 秒版本

我把 LangReport 的前端部署在 Vercel，后端及 PostgreSQL、MinIO 和异步 Worker 部署在阿里云 ECS，并用 Docker Compose 管理。由于没有单独购买域名，我没有让浏览器直接跨域访问 ECS API，而是在 Next.js 中配置 `/api` 的 Rewrite，让 Vercel 作为同源代理。ECS 上用 Nginx 容器接收公网请求，再通过 Docker Compose 网络转发到 `api:4000`。

部署过程中发现 ECS 宿主机已经有 Nginx 占用 80 端口，项目 Nginx 启动失败并报 `address already in use`。我通过 `ss` 和 `docker ps` 区分出端口是宿主机进程占用，随后把项目 Nginx 映射到 8080，并修改 Vercel 的 `API_PROXY_ORIGIN`。首次公网验收时，Vercel 返回 `ROUTER_EXTERNAL_TARGET_CONNECTION_ERROR`，虽然容器健康且 ECS 本机 `/health` 返回 200，但公网请求仍得到空响应。分层检查后确认是安全组遗漏 TCP 8080 入方向规则；补齐规则后，ECS 公网和 Vercel 两层健康检查均恢复 200。另外 GitHub 拉取曾出现 `Empty reply from server`，我把 HTTPS 访问和 Git 操作分开排查，最后使用 HTTP/1.1 和 `--ff-only` 成功拉取。

### STAR 版本

**Situation：** 前端和后端部署在不同平台，且没有独立域名；ECS 80 端口还被原有 Nginx 占用。

**Task：** 在不影响已有网站的前提下，让 Vercel 前端稳定访问 ECS API，并保证内部服务不直接暴露。

**Action：** 使用 Next.js Rewrite 实现同源 `/api` 代理；用 Docker Compose 部署 API、数据库、MinIO、Worker 和项目 Nginx；通过 `ss` 确认 80 端口冲突来源，将项目 Nginx 改映射到 8080；面对 Vercel 502，依次验证 API、Nginx、宿主机映射和 ECS 公网入口，最终确认安全组遗漏 TCP 8080 入方向规则并补齐；随后重新验证 Vercel Rewrite。

**Result：** API 容器健康，ECS `:8080/health` 返回 200，Vercel `/api/health` 也能返回 API 健康结果，前后端通信链路打通。

## 12. 可以继续改进的地方

当前方案解决了部署和通信问题，但不等于完整生产安全方案。面试时可以主动说明后续改进：

1. 为 API 配置独立域名和 HTTPS，避免 Vercel 到 ECS 的 HTTP 链路；
2. 将开发态 `x-user-id` 替换为正式登录、JWT 或安全 Cookie；
3. 完善 Workspace、Project 和 Project Role 权限校验；
4. 将大文件上传改为私有对象存储的受控直传，降低 API 内存压力；
5. 使用正式数据库迁移流程代替生产环境长期依赖 `db:push`；
6. 增加日志、健康监控、限流、备份和故障告警；
7. 为 Vercel Preview 环境配置允许来源列表和独立环境变量。

## 13. 部署前自检清单

- [ ] ECS 项目目录正确，包含 `.git` 或已经同步最新文件；
- [ ] `.env.production` 已创建，权限为 `600`；
- [ ] 数据库和 MinIO 密钥不是开发默认值；
- [ ] `docker compose config --services` 包含 `api`、`nginx`、Worker 和基础服务；
- [ ] API 状态为 `healthy`；
- [ ] 项目 Nginx 映射为 `8080:80`；
- [ ] 当前 ECS 实例实际关联的阿里云安全组已开放入方向 TCP 8080，授权来源覆盖 Vercel 的访问来源；
- [ ] 4000、5432、9000、9001 未暴露公网；
- [ ] Vercel Root Directory 为 `apps/web`；
- [ ] Vercel 设置了 `API_PROXY_ORIGIN=http://<ECS_PUBLIC_IP>:8080`；
- [ ] Vercel 设置了 `NEXT_PUBLIC_API_URL=/api`；
- [ ] Vercel 已重新部署；
- [ ] 从 ECS 之外执行 `curl http://<ECS_PUBLIC_IP>:8080/health` 返回 200；
- [ ] `curl https://<vercel-project>.vercel.app/api/health` 返回 200；
- [ ] 正式上线前已处理 HTTPS 和真实认证。
