# 数据库账号管理：测试报告

- 变更编号：CHG-2026-09-26-database-user-accounts
- 验证日期：2026-09-26
- 主工作区：`D:\front\newProject\LangReport`
- 独立复核：只读隔离快照 `langreport-db-user-accounts-verify`

## 主工作区结果

| 检查 | 结果 |
| --- | --- |
| DB/API/Contracts/Web 类型检查及测试类型检查 | 通过 |
| API 单元测试 | 38/38 通过 |
| Contracts 单元测试 | 26/26 通过 |
| Web 单元测试 | 24/24 通过 |
| 完整 Playwright E2E | 48 passed、4 skipped；4 个视口项目。跳过项为需要真实认证服务的测试，未设置 live baseURL |
| `/account` 定向 E2E | 通过 |
| API Console 定向 E2E | 2/2 通过；实际请求保留凭据，预览、cURL 与本地历史脱敏；旧历史 Authorization 值会在加载时清除 |
| 隔离数据库集成 | API 5/5、Worker 1/1 通过；覆盖首用户启动事务、幂等/并发启动、旧成员关系迁移、账号流程和多用户 Workspace 隔离 |
| Workspace 隔离增量断言 | 通过；旧用户复用迁移 Workspace，第二账号获得独立且空的 Workspace |
| 数据库迁移验证 | 28 个迁移文件与 journal 一致，迁移验证通过 |
| `pnpm docs:check` | 通过 |
| Compose 配置与 Nginx 语法 | 通过；仅验证配置解析，未验证目标部署的真实公网路径与流量限速 |
| `git diff --check` | 通过 |

`pnpm test:integration` 使用 `infra/docker-compose.test.yml` 定义的测试专用 Postgres/MinIO。测试成功后已运行 `docker compose -f infra/docker-compose.test.yml down -v`；本轮容器、网络、卷、隔离 schema 和 bucket 均已清理。

## 独立快照复核

独立验证复核了 DB/API/Contracts/Web 类型检查、API 单测 37/37、Contracts 单测 26/26、Web 单测 24/24、迁移检查与迁移验证、隔离集成 API 5/5 和 Worker 1/1。随后对最新 Workspace 隔离断言增量复验 1/1 通过，并确认测试资源清理完成。

隔离快照中的完整 E2E 无法获得有效页面结果：默认权限下 Chromium 报 `spawn EPERM`；提升权限后，Next/Turbopack 因快照 `node_modules` Junction 指向快照目录外而 panic，浏览器连接被拒绝。该快照 E2E 不用于判断应用页面通过或失败；主工作区完整 E2E 与定向 E2E 结果如上。

## 未执行的部署验收

- 没有真实 HTTPS 部署地址和用户要求，因此未执行生产 Secure Cookie Smoke。
- 未对生产 Nginx/WAF 运行真实流量限速测试，也未从公网探测 API 旁路；目前仅检查 Nginx 语法及 Compose 网络配置。
- 前一 `2026-09-22-login-gateway` 变更继续保持 `VERIFYING/PARTIAL`，其历史未验证项未被本报告覆盖。

## 其他检查结果

`pnpm format:check` 仍报告既有 `apps/web/app/login/page.tsx` 的格式差异。本次保留了该登录页的既有工作，没有对它做格式化修改；账号管理新增和修改的文件已按项目格式化。
