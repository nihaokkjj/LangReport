# 接口调试平台 Loop 4 交付记录

> 日期：2026-09-04
>
> 范围：Generation Job 场景；不扩展业务实体，不进入 Loop 5 安全和追踪改造。

## Outcome

自定义 API Console 新增 Loop 4 场景运行器，按验收顺序编排并轮询核心异步生成链路：

```text
健康检查
→ Bootstrap
→ 查询 Project
→ 粘贴示例数据
→ 确认 Metric Definition
→ 创建 Generation Job
→ 幂等复用
→ 幂等冲突
→ 轮询 Job 状态
→ 查看 Evidence Block
→ 错误输入
→ 失败 Job
```

场景运行器通过当前 `/openapi.json` 的 `operationId` 查找请求定义，不维护与 OpenAPI 平行的接口目录或参数契约。

## Changed

- `apps/web/app/api-console/page.tsx`：新增 Loop 4 场景编排、Job 状态轮询、成功结果追溯、幂等复用、400 错误输入和预期失败 Job 展示；
- `apps/web/app/api-console/api-console.module.css`：新增场景步骤、异步状态流水线、追溯卡片、失败卡片和桌面/移动布局；
- `apps/api/src/openapi.test.ts`：增加 Generation Job 异步状态、失败字段和追溯字段的 OpenAPI 契约测试；
- `apps/api/src/chart-routes.ts`：修正审核状态接口返回值，确保提交/批准操作返回事务更新后的 Revision；
- `packages/chart/src/index.ts`：将非法 Revision 状态转换映射为稳定的 400 业务错误；
- `docs/api-debug-loop4-evidence.md`：记录本轮验收范围、证据和环境限制。

## Acceptance status

- G4.1：界面枚举并展示全部九种 Job 状态；HTTP 202 先显示为已接受的异步任务。真实运行中成功分支到达 `succeeded`，失败分支到达 `failed`。
- G4.2：失败卡片展示 `errorCode`、`errorMessage`、`generationJobId` 和轮询 `requestId`，并明确没有生成伪造 Evidence；真实失败 Job 已确认无 Evidence。
- G4.3：真实运行确认同一 `idempotencyKey` 返回 HTTP 200、`reused: true` 和同一 Job；修改输入返回 HTTP 409 `IDEMPOTENCY_CONFLICT`。
- G4.4：真实成功结果包含 Data Snapshot、Metric Definition、TransformPlan、字段血缘、Flint Spec、Visual Template 版本、校验结果、Chart Revision 和 Evidence Block。
- G4.5：真实运行确认 draft 不能跳过审核批准或分享；批准后编辑产生新的 Revision；回滚产生新的 draft Revision，已批准历史和发布指针未被覆盖；错误输入仍返回统一 400。

## Evidence

静态和构建验证：

```text
pnpm --filter @langreport/web typecheck  ✅
pnpm --filter @langreport/web build      ✅
pnpm --filter @langreport/api typecheck  ✅
pnpm --filter @langreport/api test       ✅ 7/7
pnpm typecheck                           ✅
git diff --check                          ✅
```

开发环境接口验证：

```text
GET http://localhost:4000/health                 ✅ 200
GET http://localhost:4000/openapi.json           ✅ OpenAPI 3.0.3
GET http://localhost:4000/ready                  ✅ 200 / database ok
GET http://localhost:3000/api-console             ✅ 页面包含 Loop 4 场景和追溯区域
```

真实 Generation Job 链路（HTTP API，2026-09-04）：

```text
Project       e2237889-7c48-471f-ade3-2716ba33b5ae
Data Snapshot 3a2861fa-5fa5-4328-980a-ee3d96398128
Metric        f0426e2e-6b61-4cad-9855-b191476f1e3b
Success Job   96387dbd-e07f-4692-b799-695522bdb509 → succeeded
Revision      6a8d8aa2-d416-4c6f-9e93-9c0a860dd843
Artifact      75f6d8cf-f93e-4e08-aa7f-4ec1ab96d0ac
Evidence      e5a7e608-f055-4516-994f-7a2e9dd31d4b
Idempotency   200 reused=true sameJob=true；409 IDEMPOTENCY_CONFLICT
Invalid input 400 INVALID_INPUT
Failure Job   746aec02-0b28-4244-a0ab-ab14132a1519 → failed
Failure trace GENERATION_FAILED；无法从数据画像中识别数值指标；无 Evidence
```

G4.5 审核不变量真实运行记录：

```text
Approved original Revision  2f75310e-3a46-42cb-8c29-4284062f8121
Edited Job                  0199241c-2553-4f63-bb70-6ff9eb2f7c43 → succeeded
Edited Revision             8b051595-d950-4ab5-a572-74c15e4cecda → approved
Rollback Revision           4995c9b7-57d2-4044-b91e-c266c6e59182 → draft
Revision history            3 条；original 仍为 approved；rollback 未覆盖历史
Published Revision          8b051595-d950-4ab5-a572-74c15e4cecda
Draft direct approve        400 INVALID_STATE_TRANSITION
Draft share                 400 REVISION_NOT_PUBLISHED
```

页面响应检查确认：页面非空、Loop 4 场景标题和接口目录均存在，新增 CSS Module 没有产生 `undefined` 类名。由于当前环境没有可用的 `agent-browser`/Playwright 运行时，尚未完成真实浏览器截图和点击检查。

## Known limitations

- 已有 API/Web 开发进程占用了 4000/3000 端口，复用现有进程完成了健康、OpenAPI 和页面响应检查；
- 当前环境没有可用的 `agent-browser`/Playwright 运行时，因此未完成真实浏览器截图和点击记录；Generation Job、Worker、Evidence 和审核不变量已通过真实 HTTP API 验证；
- Loop 5 的服务端 requestId 结构化日志、生产身份校验和生产文档访问控制不在本轮修改范围内。

## Next loop

Loop 5：在真实部署环境验证 requestId 全链路日志、生产身份和敏感数据脱敏，并完成回归验收。
