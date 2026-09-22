# 第一阶段核心产品可用化测试计划

- 变更编号：`CHG-2026-09-21-phase1-core-product`
- 状态：`VERIFYING`
- 负责人：LangReport owner agent
- 创建时间：2026-09-21
- 更新时间：2026-09-21

## 测试范围

验证一个咨询顾问从 Project 创建开始，完成数据导入、Snapshot 预览、Metric/Brief 确认、Generation Cycle、图表编辑、Review、Approved 和固定 Revision 导出的核心闭环；同时验证失败、澄清、重试、幂等、越权、刷新恢复和 Worker 接管边界。

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| Project/Conversation 作用域错乱 | API integration + live smoke | 用户创建/切换 Project，刷新后恢复当前 Project/Conversation | 只读到当前用户/Project 数据，刷新不丢上下文 |
| Snapshot 被覆盖或跨 Asset 使用 | data integration + Worker integration | 重复上传、历史 Snapshot 切换、构造错配 Job | 新版本追加，历史可读；错配 Job 失败且不写 Revision |
| Brief/Metric 缺失仍生成 | API + readiness unit + live smoke | 只有数据、只有 Brief、指标歧义、缺时间字段 | 返回澄清/可操作前置条件，不产生成功结果 |
| Generation/Render 异步断链 | Worker integration + live smoke | 两个常驻 Worker 依次消费 Job | `queued → ... → rendering → succeeded`，Revision/Evidence 可读 |
| Worker 重复提交污染历史 | concurrency integration | 并发领取、重复 Render、租约过期接管 | Fencing Token 拒绝旧 Worker；每 Job 至多一个结果 Revision |
| TransformPlan 改写原始数据 | data-engine unit + revision integration | 过滤、聚合、排序、同比/环比编辑 | Snapshot 不变，输出有字段血缘和步骤记录 |
| Render 输出缺失或不安全 | contract/render/API | SVG/PNG/Vega-Lite/HTML 生成和恶意标题/结论文本 | 四种输出均存在；HTML 自包含且用户文本已转义，无外部脚本 |
| Approved Revision 被覆盖 | domain/API/Web | 批准后再次编辑、审核、导出非固定 head | 编辑/覆盖被拒绝；固定 Revision 导出仍可用 |
| Review 记录丢失 | API/Web E2E | 评论、解决、要求修改、批准 | 评论与状态持久化，Changes Requested 可恢复为 Draft 流程 |
| UI 只在 mock 中可用 | live browser/HTTP smoke | 不注册 `page.route`，连接真实 API/Worker | 页面能看到真实 Job 终态、证据元数据和下载结果 |
| 外部模型配置改变排队语义 | gateway/worker unit + integration | deterministic route、无效 route、凭据缺失 | Route Snapshot 冻结；错误可解释，不后台静默切换模型 |
| 资源和敏感信息泄漏 | test runner audit | 运行/失败/清理日志、环境变量和对象 key | 输出脱敏；schema/bucket/process 清理成功 |

## 测试数据与环境

- 固定销售 CSV：月份、区域、销售额，覆盖同比、缺失月份、缺失值和两种区域。
- 一份最小 XLSX/JSON fixture，用于验证格式边界；一份非法/超限 fixture，用于验证失败提示。
- 集成服务使用 `infra/docker-compose.test.yml` 的 PostgreSQL/MinIO；每次运行生成独立 `DATABASE_SCHEMA` 和 `S3_BUCKET`。
- 测试默认使用 deterministic Model Route，不访问真实客户数据或外部模型；外部 LLM 只做独立配置/合同测试。
- live smoke 启动真实 `apps/api`、`apps/generation-worker`、`apps/render-worker`，使用独立端口/临时日志目录，结束时终止进程并清理资源；它通过 HTTP 验证主路径。Web E2E 单独覆盖现有工作台 UI，当前测试使用 API fixture。

## 自动化测试

### 现有回归门禁

```text
pnpm docs:check
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @langreport/db db:verify
pnpm test:integration
pnpm test:e2e
```

### 本变更新增或扩展

- Contract tests：HTML output format、Content-Type/Disposition、固定 Revision 参数和错误合同。
- API integration：Project→Asset→Brief/Metric→Job→Review/Comment/Export 真实请求链路，以及越权、幂等和状态冲突。
- Worker integration：四种输出、HTML 转义、重复渲染、租约接管、Revision/Evidence 单写。
- 完整事实链：用 600 行变换结果验证预览仍为 500 行，但 `resultSummary` 的行数、合计和极值来自全量数据；Worker integration 验证 Job、Revision、Evidence 三处摘要一致且 finding 只引用摘要。
- 验证审计：断言 Job 最终 `renderValidation` 包含静态 HTML validator，并与 `generationAudit.renderValidation` 完全一致。
- Web E2E：现有 mock 用例继续覆盖快速 UI 回归；本变更的无 mock 真实链路由 `pnpm phase1:smoke` 的 HTTP 主路径覆盖。
- `pnpm phase1:smoke`：一条可重复命令，输出脱敏的 Job status sequence、Revision/Evidence ID、export checks 和 cleanup checks。

## 人工验收步骤

1. 启动开发或验收环境，打开 Web，创建一个咨询 Project，填写名称、客户、目标、受众和 Visual Template。
2. 创建/选择 Conversation，上传销售 CSV；确认看到字段画像、质量提示和最新 Snapshot。
3. 打开历史 Snapshot 预览，确认只读且不会改变生成输入。
4. 确认“销售额”Metric Definition，填写并确认 Analysis Brief。
5. 输入“按月份展示各区域销售额并对比同比变化”，等待真实 Job 完成；确认页面展示图表、发现、来源、口径、TransformPlan、血缘、Theme 和 Validation。
6. 刷新页面或重新打开 Project，确认 Evidence Block、Job 终态、Conversation 和 Revision 仍存在。
7. 编辑图表类型/筛选/排序/注释，确认生成新 Draft Revision 且旧 Revision 不变。
8. 提交审核，添加并解决评论；执行 Changes Requested，再确认新的 Draft 流程。
9. 重新提交并批准，确认 Approved Revision 进入只读状态。
10. 从该 Revision 下载 PNG、SVG、HTML 和 Vega-Lite JSON，确认 URL/响应均携带固定 Revision，HTML 离线可打开且无外部脚本。
11. 触发一次缺失字段/无 Brief/非法文件场景，确认页面展示原因和下一步，不出现成功图表。

## 不测试的内容及原因

- 真实百炼 API 的业务质量、延迟和配额不属于产品功能验收；但发布环境必须执行 `pnpm phase1:release-gate`，验证认证、端点、模型 ID、结构化输出合同和错误归一化，失败则阻止上线。
- 多用户实时协作和公开分享：明确不在第一阶段范围。
- 大于 100,000 行的首轮性能目标：只验证 50 MB/1,000,000 行硬边界和首轮目标内的稳定性。
- 完整咨询报告/PPT/Excel：后续阶段范围。
