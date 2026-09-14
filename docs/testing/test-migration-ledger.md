# 测试迁移台账

> 阶段：T2
>
> 规则：所有既有行为测试均保留；本台账只记录路径和执行层级变化，不把移动本身视为行为替代。

## 已迁移测试

| 旧路径 | T2 路径 | 层级 | 处理说明 |
| --- | --- | --- | --- |
| `apps/api/src/auth.test.ts` | `apps/api/test/unit/auth.test.ts` | unit | 保留 Fastify/JWT 公开认证行为；默认离线运行。 |
| `apps/api/src/data-assets.test.ts` | `apps/api/test/unit/data-assets.test.ts` | unit | 保留公开 Data Asset DTO 行为；默认离线运行。 |
| `apps/api/src/http-contracts.test.ts` | `apps/api/test/unit/http-contracts.test.ts` | unit | 保留 `buildApp`/HTTP contract 行为；默认离线运行。 |
| `apps/api/src/http-errors.test.ts` | `apps/api/test/unit/http-errors.test.ts` | unit | 保留 HTTP 错误映射行为；默认离线运行。 |
| `apps/api/src/openapi.test.ts` | `apps/api/test/unit/openapi.test.ts` | unit | 保留 OpenAPI 可观察行为；默认离线运行。 |
| `apps/api/src/message-generation.integration.test.ts` | `apps/api/test/integration/message-generation.integration.test.ts` | integration | 保留原测试；等待 T4 专用 Postgres/MinIO 与隔离 guard，未列入默认测试。 |
| `apps/api/src/plugins.integration.test.ts` | `apps/api/test/integration/plugins.integration.test.ts` | integration | 保留原测试；等待 T4 专用 Postgres/MinIO 与隔离 guard，未列入默认测试。 |
| `apps/generation-worker/src/worker.integration.test.ts` | `apps/generation-worker/test/integration/worker.integration.test.ts` | integration | 保留原 Worker 流程；等待 T4 专用 Postgres/MinIO 与隔离 guard，未列入默认测试。 |
| `packages/contracts/src/http.test.ts` | `packages/contracts/test/unit/http.test.ts` | unit | 保留路由合同公开行为；默认离线运行。 |
| `packages/contracts/src/model.test.ts` | `packages/contracts/test/unit/model.test.ts` | unit | 保留模型合同公开行为；默认离线运行。 |
| `packages/data-engine/src/index.test.ts` | `packages/data-engine/test/unit/index.test.ts` | unit | 保留 TransformPlan 行为；默认离线运行。 |
| `packages/domain/src/index.test.ts` | `packages/domain/test/unit/index.test.ts` | unit | 保留领域状态和权限行为；默认离线运行。 |
| `packages/flint-adapter/src/index.test.ts` | `packages/flint-adapter/test/unit/index.test.ts` | unit | 保留 Flint Adapter 行为；默认离线运行。 |
| `packages/generation/src/context-projection.test.ts` | `packages/generation/test/unit/context-projection.test.ts` | unit | 保留 Conversation 投影行为；默认离线运行。 |
| `packages/generation/src/index.test.ts` | `packages/generation/test/unit/index.test.ts` | unit | 保留 `GenerationCycle` 公开行为；默认离线运行。 |
| `packages/generation/src/model-baseline.test.ts` | `packages/generation/test/unit/model-baseline.test.ts` | unit | 保留匿名区域销售基线行为；默认离线运行。 |
| `packages/generation/src/evidence-generation-graph/graph.test.ts` | `packages/generation/test/unit/evidence-generation-graph/graph.test.ts` | unit | 保留既有内部 graph 覆盖，不新增同类测试；待 T3 公开 `GenerationCycle` 覆盖等价后再评估替换。 |
| `packages/harness/src/structured-model.test.ts` | `packages/harness/test/unit/structured-model.test.ts` | unit | 保留结构化模型 Harness 行为；默认离线运行。 |
| `packages/memory/src/index.test.ts` | `packages/memory/test/unit/index.test.ts` | unit | 保留确定性 Memory Candidate 行为；默认离线运行。 |
| `packages/model-gateway/src/index.test.ts` | `packages/model-gateway/test/unit/index.test.ts` | unit | 保留注入 fake fetch 的 Model Gateway 行为；默认离线运行。 |
| `packages/plugin-sdk/src/index.test.ts` | `packages/plugin-sdk/test/unit/index.test.ts` | unit | 保留内置 Plugin Manifest 行为；默认离线运行。 |
| `packages/plugins/src/index.test.ts` | `packages/plugins/test/unit/index.test.ts` | unit | 保留内置 Plugin catalog/validation 行为；默认离线运行。 |

## T2 新增基础设施测试

- `tests/support/test-system.contract.test.mjs`：验证目录、根命令、测试 TypeScript、默认无 skip、离线 guard、PR workflow 和本台账。它是仓库级共享测试支持资产，不替代任何模块行为测试。

## 未删除项

本阶段没有删除既有测试，也没有生成或替换历史 fixture。集成测试仍保留其旧有条件 guard，但默认 `pnpm test` 不再发现或执行它们；T4 将以专用测试环境替换该临时结构。
