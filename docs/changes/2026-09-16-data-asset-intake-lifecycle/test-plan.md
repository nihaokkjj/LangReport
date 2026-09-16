# 收拢 Conversation-bound Data Asset intake：测试计划

- 变更编号：`CHG-2026-09-16-DATA-ASSET-INTAKE`
- 状态：`REVIEWING`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 测试范围

测试覆盖 Data Asset intake 从 HTTP 输入到 PostgreSQL/S3 持久化的成功、失败、补偿、权限和合同行为，并验证它与 Snapshot access module 的 canonical key 约束一致。

本次重点不是验证 LLM 生成质量，而是证明：

```text
输入 → relation validation → processing → parse → object writes
     → Snapshot metadata → ready
     ↘ failure compensation → failed + auditable error
```

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| upload/paste 漏掉来源 Conversation | HTTP/route | 缺失、格式错误、跨 Project 的 `conversationId` | 请求失败，不创建可用 Data Asset |
| Data Asset ownership 被误改 | module/回归 | 同一 Project 的另一 Conversation 引用资产 | 仍可引用；不要求 Generation Job Conversation 等于来源 Conversation |
| source 写入成功后 normalized 写入失败 | module unit | `putObject(source)` 成功，第二次失败 | 删除 source，资产为 `failed`，返回稳定 storage code |
| Snapshot DB 写入失败 | module + DB integration | 两个对象成功，Snapshot transaction 失败 | 删除两个对象，资产为 `failed`，不进入 `ready` |
| cleanup 删除失败 | module/observability | `deleteObject` callback 失败 | 保留 failed 记录，写结构化清理失败事件/指标 |
| Provider 错误泄露到 HTTP | HTTP contract | S3/DB 抛出带 key 的异常 | 外部只收到稳定 code 和安全消息 |
| nullable source 与读取规则漂移 | migration/access | null、旧项目级 key、错误关系的历史记录 | 清理或拒绝；不启用旧路径 fallback |
| Conversation 删除导致 Data Asset 不可读 | migration/read-model/access | 来源 Conversation 删除后保留不可变 UUID | key 仍可重建，DTO/审计显示 `sourceConversationDeleted` |
| 本次范围偷偷模拟 re-ingest | contract/regression | 检查当前 intake 与后续 endpoint | 本次不新增 re-ingest HTTP，也不创建新 Data Asset 伪装 Snapshot version |
| PublicDataAsset 泄露内部 key | DTO/unit | 检查 asset 和 latestSnapshot 响应 | 不含 `objectKey` / `normalizedObjectKey` |
| 50 MB 限制绕过 | route/module | multipart 超限、直接调用 module 超限 | HTTP 413 或稳定 input code |

## 测试数据与环境

- 单元测试：Node test runner、内存 DB stub 或现有测试 helper、内存 object-store callbacks；不需要真实 S3。
- API/合同测试：Fastify test app，覆盖 multipart route、paste route 和错误响应。
- DB 集成测试：PostgreSQL test database，验证事务、约束和迁移；按照 [开发环境](../../operations/development-setup.md) 准备。
- 对象存储集成测试：测试 MinIO bucket，仅使用隔离的测试 endpoint 和 bucket。
- 输入数据：最小 CSV、JSON、XLSX fixture，以及解析失败和超限 fixture；不得使用客户数据。

## 自动化测试

1. `pnpm --filter @langreport/api typecheck`
2. `pnpm --filter @langreport/api test`
3. `pnpm --filter @langreport/contracts test`
4. `pnpm typecheck`
5. `pnpm test`
6. `pnpm db:verify`
7. `pnpm test:integration`（PostgreSQL/MinIO 可用时）
8. `pnpm docs:check`
9. `git diff --check`

需要新增或调整的自动化测试文件由实现阶段确定，预期包括：

- `apps/api/test/unit/data-assets.test.ts`：DTO、command、module failure paths；
- `apps/api/test/unit/routes.test.ts` 或现有 HTTP route 测试：upload/paste 错误映射；
- `packages/contracts/test/unit/http.test.ts`：DTO、请求和 error response contract；
- `packages/db/test` 或迁移验证：非空约束、删除策略、状态流；
- 对象存储测试：内存 callback 单元测试和隔离 MinIO 集成测试。

## 人工验收步骤

1. 在一个 Project 中创建两个 Conversation；从 Conversation A 上传文件，确认 Data Asset 的 `projectId` 正确且 source Conversation 为 A。
2. 使用 Conversation B 发起生成输入，确认只要仍在同一 Project 内即可引用该 Project-owned Data Asset。
3. 使用不属于该 Project 的 Conversation ID 上传，确认请求失败且不会出现 `ready` Data Asset。
4. 通过测试故障注入让 normalized 写入失败，确认 source object 被补偿删除，Data Asset 为 `failed`。
5. 通过测试故障注入让 Snapshot DB 写入失败，确认两个对象均被处理，错误可通过 assetId 追踪。
6. 查询成功响应和 Data Asset DTO，确认不包含任何内部 object key。
7. 检查历史无效记录/旧项目级对象清理结果，确认没有新增兼容读取分支。
8. 删除来源 Conversation 后查询 Data Asset，确认 `sourceConversationId` 仍保留、Snapshot key 仍可读取，并显示来源已删除状态。
9. 检查当前 intake 没有通过创建新 Data Asset 模拟 re-ingest；真正的 re-ingest HTTP 操作应在后续变更中实现。

## 不测试的内容及原因

- LLM 生成质量、TransformPlan 正确性和 Render Worker：本次只改变 intake 写入语义；
- 通用多 adapter 替换：当前只有一个真实 S3 adapter，正式抽象属于后续范围；
- 大文件流式性能：50 MB 上限下先保证正确性，流式上传另立变更；
- 旧项目级路径恢复：用户已确认历史数据可丢弃，兼容读取违反当前路径规则；
- UI 视觉和交互：本次不修改 `apps/web` 页面或样式。
