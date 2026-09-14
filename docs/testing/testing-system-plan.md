# LangReport 测试系统搭建计划

> 状态：已确认，待分阶段实施
>
> 基线日期：2026-09-14
>
> 适用范围：第一阶段“咨询项目报告”垂直闭环

## 本轮边界

```text
Outcome: 固化 LangReport 测试系统的目标结构、门禁、隔离规则和实施顺序
Aggregate: 工程测试基础设施；不改变任何业务聚合
In scope: 测试计划文档
Out of scope: 修复测试、迁移旧测试、迁移现有文档、增加 CI、引入 Playwright 或启动真实外部调用
Proof: Markdown 差异检查、链接目标检查、工作树范围检查
```

本计划使用 [CONTEXT.md](../../CONTEXT.md) 的领域术语，以[第一阶段产品规格](../product/phase1-consulting-report.md)中的咨询项目闭环为验收边界，并遵循 [Agent Loop 规范](../agent/agent-loop-spec.md)的可追溯与停止条件。任何后续阶段都只交付该阶段定义的结果，不提前实现下一阶段。

## 现状

### 工具链与命令

- 根 [package.json](../../package.json) 固定 Node.js `>=22` 和 pnpm `11.19.0`，已有 `build`、`typecheck`，但没有根 `test`、覆盖率或 lint 命令。
- 当前测试统一使用 Node.js 内置 `node:test`、`node:assert/strict`，由各 workspace 的 `tsx --test` 脚本执行。例如 [API package.json](../../apps/api/package.json)、[Generation package.json](../../packages/generation/package.json)和 [Data Engine package.json](../../packages/data-engine/package.json)。
- 测试文件当前与生产源码混放在 `src/`。仓库共有 22 个 `*.test.ts` 文件；递归执行 `pnpm -r --if-present test` 的盘点结果为 88 通过、1 失败、3 跳过。
- 唯一红测位于 [apps/api/src/auth.test.ts](../../apps/api/src/auth.test.ts)：篡改 JWT 的断言失败。API 测试脚本已通过 `--test-concurrency=1` 串行执行，见 [apps/api/package.json](../../apps/api/package.json)。
- `pnpm -r --if-present run typecheck --incremental false` 的盘点结果为 17 个 workspace 全部通过。
- 当前没有 lint 工具链。本测试计划不引入 lint，也不把格式或规则迁移夹带进测试建设。

### 已有覆盖

| 类型 | 已有覆盖 | 具体依据 |
| --- | --- | --- |
| 离线单元/组件测试 | 数据解析与 TransformPlan、Generation Cycle、生成上下文、领域状态与权限、contracts、Flint 渲染、Model Gateway、内置插件和 memory | [Data Engine 测试](../../packages/data-engine/src/index.test.ts)、[Generation 测试](../../packages/generation/src/index.test.ts)、[Domain 测试](../../packages/domain/src/index.test.ts)、[Flint Adapter 测试](../../packages/flint-adapter/src/index.test.ts)、[Model Gateway 测试](../../packages/model-gateway/src/index.test.ts) |
| API 组件测试 | 认证、HTTP 合同、错误映射、Data Asset、OpenAPI；通过 Fastify `app.inject` 运行 | [apps/api/src/auth.test.ts](../../apps/api/src/auth.test.ts)、[apps/api/src/http-contracts.test.ts](../../apps/api/src/http-contracts.test.ts)、[apps/api/src/data-assets.test.ts](../../apps/api/src/data-assets.test.ts) |
| 集成测试 | 消息触发 Generation Job 的前置条件与幂等；插件安装、Binding、Theme、撤销/恢复与审计；Generation Worker 的数据库工作流 | [message-generation.integration.test.ts](../../apps/api/src/message-generation.integration.test.ts)、[plugins.integration.test.ts](../../apps/api/src/plugins.integration.test.ts)、[worker.integration.test.ts](../../apps/generation-worker/src/worker.integration.test.ts) |
| 浏览器 E2E | 无 Playwright 配置，也没有浏览器测试 | [apps/web/package.json](../../apps/web/package.json)没有测试脚本；仓库不存在 `playwright.config.*` |
| 远端部署检查 | 有需要真实部署地址和认证信息的 API smoke/E2E 脚本，但没有浏览器行为、独立 canary 授权或调用费用门槛 | [phase5-production-smoke.mjs](../../scripts/phase5-production-smoke.mjs)、[phase5-production-e2e.mjs](../../scripts/phase5-production-e2e.mjs) |

当前 Model Gateway 测试通过注入假的 `fetch` 验证供应商请求与错误归一化，仍属于离线测试；它不是一次真实供应商调用，见 [packages/model-gateway/src/index.test.ts](../../packages/model-gateway/src/index.test.ts)。

### 现有门禁与隔离

- 仓库当前不存在 `.github/workflows/`，因此没有可验证的 CI 必过检查、定时测试或失败通知。
- 三个集成测试依赖 `RUN_INTEGRATION=1` 或 `RUN_WORKER_INTEGRATION=1`；默认递归测试会把它们报告为跳过，而不是在独立环境中运行。
- [DB client](../../packages/db/src/client.ts)、[Drizzle 配置](../../packages/db/drizzle.config.ts)和 [Storage client](../../packages/storage/src/index.ts)会读取根 `.env`；已有集成测试把当前 `process.env` 直接传入应用。这不满足测试资源隔离前提。
- 现有开发基础设施位于 [infra/docker-compose.yml](../../infra/docker-compose.yml)，没有专用测试 Compose。
- 仓库没有覆盖率配置；`packages/chart`、`apps/render-worker` 和 `apps/web` 的 package scripts 当前没有测试命令，见各自的 `package.json`。

## 风险

### 1. 默认绿色信号不可信

根目录没有统一测试入口和 CI 门禁；默认递归运行同时包含一个红测和三个条件跳过测试。API 认证还使用可变的进程级环境配置，见 [apps/api/src/auth.ts](../../apps/api/src/auth.ts)，因此现阶段不能安全提高 API 测试并发。

### 2. 集成测试可能连接或清理非测试资源

数据库和对象存储客户端会加载根 `.env`，而集成测试没有数据库名、schema、bucket 前缀的强制保护。仅设置 `APP_ENV=test` 不能证明实际连接目标安全；任何写入和清理前都必须同时验证完整资源标识。

### 3. 核心垂直链路缺少跨边界证明

现有测试覆盖多个局部模块，但没有一条确定性浏览器链路证明“销售 CSV → Analysis Brief/Metric Definition → Generation Cycle → Evidence Block → Review → 固定 Chart Revision 导出”。`packages/chart`、Render Worker、Web 端和真实供应商审计也没有进入分层门禁。

## 目标测试系统

### 目录约定

测试采用“归属模块拥有测试、根目录只放共享资产”的统一形式：

```text
apps/<app>/test/unit/
apps/<app>/test/integration/
apps/web/test/e2e/
packages/<package>/test/unit/
packages/<package>/test/integration/
tests/fixtures/
tests/support/
tests/canary/
```

测试不再与生产源码混放。需要编译检查测试代码的 workspace 增加 `tsconfig.test.json`；根 `pnpm typecheck` 最终必须同时检查生产代码和测试代码，不能以 `tsx` 能执行为由跳过测试类型检查。

旧测试可以保留、迁移、替换或删除，但必须在 `docs/testing/test-migration-ledger.md` 记录旧路径、新路径或删除理由。允许删除的情形仅限：

1. 已由公开接口上的等价或更强测试替代；
2. 与另一测试完全重复；
3. 只绑定私有实现，并已补上公开行为测试；
4. 明确不属于第一阶段，且记录了范围依据。

不得因为测试失败、迁移不便或数据难以维护而直接删除行为覆盖。历史测试数据可以丢弃并重新生成匿名合成数据，但领域不变量和失败场景必须等价保留。

### 根命令合同

| 命令 | 唯一含义 | 外部依赖 |
| --- | --- | --- |
| `pnpm test` | PR 必跑的离线、确定性测试 | 无网络、无数据库、无对象存储、无真实凭据 |
| `pnpm test:integration` | 使用专用 Postgres/MinIO 的集成测试 | 仅测试 Compose 资源 |
| `pnpm test:e2e` | Playwright 确定性核心链路 | staging 的确定性模型路线，不调用真实供应商 |
| `pnpm test:canary` | 显式授权的真实供应商 canary | 受保护 staging Environment 和限额凭据 |
| `pnpm test:coverage` | 离线测试覆盖率报告/门槛 | 无外部依赖 |

不提供可能意外访问真实凭据的模糊 `test:all`。lint 保持为独立工具链决策，不进入上述命令或本计划门禁。

### 测试公开边界

- 离线测试：`detectSourceType`、`parseData`、`executeTransformPlan`、`GenerationCycle.run`、Domain/Chart 公共 API、Model Gateway、Flint Adapter、Fastify `buildApp` + `app.inject`。
- 集成测试：HTTP API、`processGenerationJob`、`processRenderJob` 及其持久化结果。
- E2E：只断言浏览器中可观察的用户行为和固定 Chart Revision 导出。
- Canary：一个真实 Generation Job、一次供应商请求，以及不含密钥和原始供应商正文的 Model Invocation 审计。

不新增针对 LangGraph 内部节点、私有方法或内部调用次数的行为测试。[现有 graph 测试](../../packages/generation/src/evidence-generation-graph/graph.test.ts)只能在公开 `GenerationCycle` 行为得到等价覆盖后替换或删除。

### 三层门禁

| 层级 | 触发 | 必须通过 | 阻断策略 |
| --- | --- | --- | --- |
| PR 离线门禁 | 普通 PR | `pnpm install --frozen-lockfile`、`pnpm test`、`pnpm typecheck`、`pnpm build` | 从启用起即为必过 |
| main/nightly 集成门禁 | nightly、手动、随后升级为 main 保护检查 | 专用 Postgres/MinIO、迁移、API/Worker 集成测试 | 先报告不阻断；连续 10 次绿色后才升级 |
| staging 门禁 | 部署后、每周或显式手动 | Playwright 核心链路、部署 smoke、真实供应商 canary | E2E 按发布策略执行；canary 永不进入普通 PR |

GitHub Actions 使用 Ubuntu、Node.js 22 和 pnpm 11.19.0。nightly 或 canary 失败时创建或更新去重的 GitHub Issue，不发送飞书通知。

集成门禁的连续绿色运行由一个 GitHub Issue 记录，每次附 workflow run 链接；任一失败把计数重置为 0。连续 10 次绿色且人工关闭该 Issue，才构成把集成检查设为 `main` 必过的授权。

### 确定性与隔离规则

- 默认测试必须离线、无真实凭据、无系统时间和随机值漂移；需要时间、UUID、模型响应时注入固定值。
- 集成环境新增 `infra/docker-compose.test.yml`，不得复用开发 Compose 或根 `.env`。
- 写入或清理前必须同时满足：`APP_ENV=test`、数据库名以 `_test` 结尾、schema 为本次运行生成且不为 `public`、bucket 以 `langreport-test-` 开头。
- schema 和 bucket 每次运行随机生成；保护条件不满足时必须在第一次写入前立即失败，清理逻辑也必须执行同一保护检查。
- 离线 package 测试可并行；API 在移除可变认证全局状态前保持串行；单次集成运行内部串行；Playwright `workers=1`；canary 最多一个 Generation Job。
- 所有层级默认 `retries=0`。Generation Job 自身的重试和最多两轮自动修复是产品行为，必须作为显式状态测试，不得用测试运行器重试掩盖。
- `pnpm test` 不允许出现跳过项。集成测试若需 quarantine，必须关联 GitHub Issue、负责人和移除日期；不得只留下永久 `.skip`。

### 共享 fixture

首条垂直链路统一使用匿名合成数据：

```text
tests/fixtures/consulting/monthly-regional-sales/
  sales.csv
  brief.json
  metric-definition.json
  expected-transform.json
  expected-lineage.json
```

期望值必须是独立维护的字面量，不能调用被测生产函数生成 expected 文件。fixture 不包含生产客户数据、真实 Workspace 标识或供应商响应正文。

### 覆盖率策略

- 使用 Node.js 原生 test coverage，不引入另一套测试框架。
- T2 只生成报告，不阻断；T3 核心行为补测完成后再建立阈值。
- 阈值只覆盖 `packages/data-engine`、`packages/generation`、`packages/domain`、`packages/chart`、`packages/model-gateway` 的分支覆盖率，不设置全仓百分比。
- 每个核心 package 的首次阈值等于 T3 实测分支覆盖率向下取整；随后执行不回退，只允许提高，长期目标为至少 80%。

### Playwright 与 canary 合同

Playwright 首期只保留一个 spec，覆盖：

```text
销售 CSV
  → 确认 Analysis Brief / Metric Definition
  → Generation Cycle
  → Evidence Block
  → Review
  → 导出固定 Chart Revision
```

只运行 Chromium，覆盖桌面视口和 390px 移动视口；使用语义断言，截图仅在失败时保存，不使用像素快照，`workers=1`、`retries=0`。该链路使用确定性模型路线，不使用真实供应商。

真实供应商 canary 使用 GitHub `staging-canary` Environment，禁止 fork 或普通 PR 获得 secret。每周一次并允许发布前手动运行；每次只用匿名合成数据创建一个 Generation Job，最多一次供应商请求，`maxOutputTokens=1024`，总 deadline 30 秒。月度费用上限为人民币 10 元；达到上限后停止计划任务并创建或更新告警 Issue。canary 不自动重试，不读取生产客户数据，不输出密钥、隐藏推理或供应商原始正文。

## 阶段计划

### P0：固化计划（当前阶段）

- 只新增本文档。
- 不修复 JWT 红测，不移动测试或其他文档，不新增 package script、依赖、Compose 或 workflow。
- 完成标志：计划与已确认决策一致，工作树只有本文档。

### D0：文档信息架构迁移

- `docs/` 根目录最终只保留 `docs/README.md`；其余文档按功能或场景迁移到：`product/`、`architecture/`、`agent/`、`generation/`、`plugins/`、`web/`、`operations/`、`testing/`、`research/`、`audits/`、`history/`、`adr/`。
- 先新增一个会因现有根层文档或失效链接而失败的无第三方 `docs:check`，再移动文档、修复仓库内链接直至通过。
- 不保留旧路径兼容 stub；`CONTEXT.md`、`DESIGN.md` 和 `AGENTS.md` 继续位于仓库根目录。

### T1：恢复可信红绿基线

- 以 [JWT 篡改红测](../../apps/api/src/auth.test.ts)为现成失败测试，定位原因并做最小修复。
- 本阶段不迁移测试目录，也不扩展认证功能。
- 完成标志：现有默认 package 测试没有失败；三个集成测试仍按现状分类，不把跳过误报为已覆盖。

### T2：统一测试基础设施与 PR 门禁

- 按模块归属迁移所有测试，生成迁移台账；必要时以新的匿名合成数据替换旧数据。
- 增加根测试命令、测试 TypeScript 配置、离线运行保护和 GitHub PR workflow。
- 先写基础设施合同测试，使其对缺失命令、错误目录、测试类型未检查、默认测试含 skip 或意外外部环境访问失败，再完成最小配置。
- 覆盖率在此阶段仅上传/展示报告，不设置阈值。

### T3：补齐核心离线行为覆盖

- 围绕公开边界逐个测试先行补齐 Data Engine、Generation、Domain、Chart、Model Gateway 和 Flint Adapter 的成功、失败、边界与不变量。
- 优先证明 Data Snapshot 不变、TransformPlan/字段血缘确定、修复预算有界、Approved Chart Revision 不可变、Model Invocation 脱敏，以及渲染校验失败可解释。
- 阶段末记录五个核心 package 的分支覆盖基线并启用不回退门槛。

### T4：隔离的 Postgres/MinIO 集成门禁

- 先为非测试数据库名、`public` schema、错误 bucket 前缀和根 `.env` 污染写失败测试，再实现保护器和专用 Compose。
- 迁移并扩充 API、Generation Worker、Render Worker 集成测试；允许直接查询测试数据库作为 fixture 设置或结果 oracle。
- 启用 nightly 与手动 workflow、失败 Issue 和连续 10 次绿色追踪；未满足晋级条件前不阻塞普通 PR。

### T5：一条确定性 Playwright 核心链路

- 先提交唯一的用户链路 spec，使其在缺少 E2E harness 时失败，再补齐最小 staging 测试入口。
- 仅覆盖已约定的销售 CSV 到固定 Chart Revision 导出，不增加第二条业务链路、视觉像素回归或真实模型调用。

### T6：受保护的 staging canary

- 先用离线合同测试证明单请求预算、deadline、费用熔断、secret/正文脱敏和审计字段，再接入显式授权的真实调用。
- 配置 `staging-canary` Environment、每周/手动触发、月度费用熔断和失败 Issue。
- canary 始终与 PR 必跑门禁分离。

## 每阶段验收命令

下列标记为“目标命令”的脚本会在对应阶段创建；在该阶段之前不存在不视为失败。

| 阶段 | 验收命令 | 预期结果 |
| --- | --- | --- |
| P0 | `git diff --check` | 无空白错误 |
| P0 | `git status --short` | 只有 `docs/testing/testing-system-plan.md` |
| D0 | `pnpm docs:check` | 文档根层级、相对链接和锚点检查全部通过 |
| D0 | `git diff --check` | 迁移差异无空白错误 |
| T1 | `pnpm --filter @langreport/api test` | JWT 红测及全部 API 默认测试通过 |
| T1 | `pnpm -r --if-present test` | 无失败；集成跳过仍作为已知旧结构记录 |
| T1 | `pnpm typecheck` | 生产 TypeScript 通过 |
| T2 | `pnpm install --frozen-lockfile` | 锁文件与依赖声明一致 |
| T2 | `pnpm test` | 离线、确定性、0 失败、0 跳过 |
| T2 | `pnpm typecheck` | 生产代码与测试代码全部通过 |
| T2 | `pnpm build` | 全 workspace 构建通过 |
| T2 | `pnpm test:coverage` | 生成报告但不因比例阻断 |
| T3 | `pnpm test` | 核心行为测试通过 |
| T3 | `pnpm test:coverage` | 五个核心 package 达到各自分支基线 |
| T3 | `pnpm typecheck` | 生产与测试类型检查通过 |
| T3 | `pnpm build` | PR 构建门禁通过 |
| T4 | `docker compose -f infra/docker-compose.test.yml up -d --wait` | 仅启动测试 Postgres/MinIO |
| T4 | `pnpm test:integration` | 隔离 guard、迁移、API 和 Worker 集成测试通过且不跳过 |
| T4 | `pnpm typecheck` | 集成测试代码通过类型检查 |
| T4 | `docker compose -f infra/docker-compose.test.yml down -v` | 仅清理已通过 guard 的本次测试资源 |
| T5 | `pnpm test:e2e` | Chromium 桌面与 390px 移动视口的唯一核心链路通过 |
| T5 | `pnpm typecheck` | Playwright 测试代码通过类型检查 |
| T5 | `pnpm build` | staging 构建通过 |
| T6 | `pnpm test:canary` | 经 Environment 授权后，一个真实 Job/最多一次供应商请求通过并留下脱敏审计 |

每个阶段结束时同时检查 `git diff --check` 和 `git status --short`，确认只包含本阶段范围。由于本计划明确不引入 lint，各阶段均不报告 lint 通过；若未来需要 lint，必须另立工具链决策和迁移阶段。
