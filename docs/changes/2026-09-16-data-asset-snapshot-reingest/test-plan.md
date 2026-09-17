# Data Asset Snapshot re-ingest：测试计划

- 变更编号：`CHG-2026-09-16-DATA-ASSET-SNAPSHOT-REINGEST`
- 状态：`ACCEPTED`
- 创建时间：2026-09-16
- 更新时间：2026-09-16

## 测试范围

验证新建 Asset、更新同一 Asset、Snapshot 版本、source/normalized 对象隔离、旧生成输入稳定性、失败补偿、权限和迁移。

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| 更新被错误实现为新 Asset | intake/API | 首次上传后显式更新 | Asset ID 不变，Snapshot v1→v2 |
| source 文件覆盖 | intake/storage | v1、v2 使用不同文件名上传 | 两个 source Key 不同且对象都存在 |
| normalized 读取回归 | worker unit/integration | Worker 读取 v1/v2 | 按冻结 Snapshot 读取对应 normalized object |
| 历史图表受新数据影响 | generation regression | v1 生成 Job 后上传 v2 | v1 Job/Revision 仍绑定并读取 v1 |
| 更新失败污染旧数据 | intake unit | parse、source、normalized、DB 任一失败 | 旧 Asset/最新 Snapshot 不变，新对象按补偿删除 |
| 并发版本重复 | DB integration | 两个更新同时提交 | 得到不同连续版本，不违反唯一索引，不覆盖对象 |
| 跨 Project 越权更新 | API | 使用其他 Project 的 assetId | 404/403，不写对象和 Snapshot |
| 来源 Conversation 越权 | API/intake | conversation 不属于目标 Project | 请求失败，不改变 Asset |
| 迁移丢失历史 source 引用 | migration | 历史 Asset + Snapshot 回填 | Snapshot source key 非空，旧 Asset 字段移除 |
| 公共响应泄露路径 | contract/unit | 新建和更新成功响应 | 不包含 object key |
| UI 意外合并 | Web E2E | “导入文件”与“更新当前数据”各执行一次 | 前者新 Asset，后者同 Asset 新 Snapshot |

## 测试数据与环境

- 最小 CSV、JSON、XLSX fixture；不使用客户数据；
- 单元测试使用内存 storage callback；
- DB 迁移验证使用隔离 PostgreSQL schema；
- 对象集成使用隔离测试 MinIO bucket；
- Web E2E 使用现有 consulting workbench fixture，并增加 v2 响应。

## 自动化测试

1. `pnpm --filter @langreport/api typecheck`
2. `pnpm --filter @langreport/api test`
3. `pnpm --filter @langreport/contracts test`
4. `pnpm --filter @langreport/web typecheck`
5. `pnpm --filter @langreport/web test:e2e -- consulting-report.spec.ts`
6. `pnpm --filter @langreport/db db:verify`
7. `pnpm typecheck`
8. `pnpm test`
9. `pnpm test:integration`
10. `pnpm docs:check`
11. `git diff --check`

## 人工验收步骤

1. 导入 `sales-v1.csv`，确认创建一个 Data Asset 和 Snapshot v1。
2. 在同一 Asset 上执行“更新当前数据”，上传 `sales-v2.csv`，确认 Asset ID 不变且显示 Snapshot v2。
3. 检查 v1 和 v2 的 source object 均可独立读取，路径分别包含各自 Snapshot ID。
4. 用 v1 创建或查看历史 Chart Revision，再上传 v2，确认历史图表仍显示 v1 数据。
5. 注入更新失败，确认旧 Asset 仍可生成，失败对象没有成为可用 Snapshot。
6. 使用其他 Project 的 Asset ID 或 Conversation ID，确认更新被拒绝。
7. 检查成功响应和列表响应没有 source/normalized object key。

## 不测试的内容及原因

- Snapshot 差异可视化：后续范围；
- 异步进度和流式上传：当前 intake 仍是同步请求；
- 内容 Hash 自动去重：会改变 Asset 身份判断，另立变更；
- LLM、TransformPlan 和渲染质量：本变更只验证输入 Snapshot 稳定性。
