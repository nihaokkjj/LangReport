# 隔离集成测试环境

T4 的集成测试只允许访问 `infra/docker-compose.test.yml` 启动的本地 PostgreSQL 与 MinIO；它不读取根 `.env`，不复用开发 Compose，也不访问真实模型或客户数据。

## 运行方式

```text
docker compose -f infra/docker-compose.test.yml up -d --wait
pnpm test:integration
docker compose -f infra/docker-compose.test.yml down -v
```

`pnpm test:integration` 为每次运行生成独立的 `DATABASE_SCHEMA` 和 `S3_BUCKET`，先在该 schema 应用迁移、创建该 bucket，再顺序运行 API 与 Worker 集成测试。结束时它以同一 guard 删除本次 schema 和 bucket；Compose 的 `down -v` 只删除 `langreport-test` 项目及其测试卷。

## 强制 guard

在任何测试数据库写入、测试对象写入或清理前，环境必须同时满足：

- `APP_ENV=test` 与 `LANGREPORT_INTEGRATION_TEST=1`；
- PostgreSQL 仅为 `127.0.0.1:54330` 上数据库名以 `_test` 结尾的测试 Compose 实例；
- `DATABASE_SCHEMA` 不是 `public`，且是本次运行生成的 `langreport_test_<id>`；
- MinIO 仅为 `http://127.0.0.1:9002`，bucket 以 `langreport-test-` 开头。

根 runner 会先丢弃父进程中的数据库、对象存储、模型和认证环境变量，再显式注入这些测试值。`@langreport/db` 与 `@langreport/storage` 在集成模式下不会加载根 `.env`。

## CI 策略

[integration-nightly.yml](../../.github/workflows/integration-nightly.yml) 仅在 nightly 或手动触发时运行，不属于 PR workflow。它启动测试 Compose、运行 `pnpm test:integration`，并在成功或失败后清理资源。

workflow 通过一个去重 GitHub Issue 记录连续绿色次数和 workflow 链接；失败重置为 0。连续 10 次绿色后必须由维护者手动关闭该 Issue，才可将集成检查升级为 `main` 必过；该升级并不由 workflow 自动执行。
