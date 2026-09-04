# 接口调试平台 Loop 2 交付记录

> 日期：2026-09-04
>
> 范围：OpenAPI + Swagger；不包含 Loop 3 自定义调试页面。

## Outcome

API 在非生产环境自动提供合法的 OpenAPI 3.0.3 文档和标准 Swagger UI 页面：

- `GET /openapi.json` 返回由 `routeContracts` 生成的接口文档；
- `GET /docs` 返回加载 `/openapi.json` 的标准 Swagger UI 页面；
- JSON 请求体、Multipart 文件请求、路径参数、查询参数、请求头和响应 schema 均从同一份契约生成；
- 生产环境下 `/openapi.json`、`/docs` 和 `/api/v1/dev/bootstrap` 均隐藏并返回统一 404 错误。

## Changed

- `packages/contracts/src/http.ts`：新增 OpenAPI 3.0.3 文档生成器、路径参数转换、请求/响应 schema 转换和内部入口标记；
- `apps/api/src/app.ts`：新增可测试应用工厂、OpenAPI/Swagger 路由、统一 404 处理；
- `apps/api/src/swagger.ts`：提供标准 Swagger UI 页面壳；
- `apps/api/src/server.ts`：仅负责启动应用；
- `apps/api/src/openapi.test.ts`：覆盖文档、Swagger、必验接口和生产隐藏行为；
- `docs/api-debug-route-inventory.md`：同步 62 条实际路由声明及内部入口。

## Acceptance items passed

- D2.1：`/openapi.json` 与 `/docs` 均有 API 测试覆盖；
- D2.2：OpenAPI 版本、路径参数、请求/响应 schema、无未解析 `$ref`、无敏感配置字段均由契约测试覆盖；
- D2.3：Swagger 页面加载共享文档，且文档包含 health、ready、bootstrap、projects、paste、metric definition、generation job 创建与查询接口；
- D2.4：生产环境三条内部入口均返回统一 404。

## Evidence

```text
pnpm --filter @langreport/contracts typecheck  ✅
pnpm --filter @langreport/api typecheck        ✅
pnpm --filter @langreport/contracts test       ✅ 4/4
pnpm --filter @langreport/api test             ✅ 6/6
```

自动化测试还验证了：`x-request-id` 会回写到响应 Header；JSON 与 Multipart schema 可生成；OpenAPI 文档不含 `$schema`、未解析 `$ref` 或 JSON Schema `null` 类型；未匹配路由返回统一 404 结构。

## Failed items / Known limitations

- Swagger UI 静态资源当前使用 `swagger-ui-dist@5` 公共 CDN；生产环境文档入口关闭，因此不会暴露内部 API。若部署环境禁止外部 CDN，后续可在 Loop 3 前将静态资源纳入受控构建产物；
- 本轮没有新增 API 业务请求或改变现有咨询项目数据链路；需要真实数据库数据的完整 Generation Job 调试留给 Loop 4。

## Next loop

Loop 3：基于 `/openapi.json` 自动生成自定义接口调试页面。
