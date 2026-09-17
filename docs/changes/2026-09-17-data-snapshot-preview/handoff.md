# Data Snapshot Preview：交接

- 变更编号：`CHG-2026-09-17-DATA-SNAPSHOT-PREVIEW`
- 状态：`PARTIAL`
- 创建时间：2026-09-17
- 更新时间：2026-09-17

## 当前状态

需求和设计已经由用户确认；T1-T7 的代码实现、自动化验证和证据文档已完成。当前状态为 `PARTIAL`：自动化门禁全部通过，但 200 列人工验收、完整键盘/读屏和故障注入重试仍待执行。

## 已完成

- 明确 `Data Snapshot Preview` 的领域含义：有限行、只读、可追溯的 Snapshot 查看能力；
- 确认默认最新 Snapshot、同一 Data Asset 切换历史 Snapshot；
- 确认历史 Snapshot 不能生成，Generation Cycle 始终使用最新 Snapshot；
- 确认 modal/sheet、版本列表懒加载、25 行全列、列懒渲染、只读和错误重试；
- 建立 `proposal.md`、`design.md`、`task.md`、`test-plan.md`、`acceptance.md`；
- 建立 ADR 0022，并在 `CONTEXT.md` 增加术语。
- 增加 `data_snapshots` nullable 来源元数据迁移、summary/detail contracts 和 Project `view` API；公共响应不暴露 object key；
- 增加 Web 只读预览 modal/sheet、默认最新版本、历史切换、按需详情读取、加载/空态/错误重试和移动端依据抽屉路径；
- 补充 API integration、contracts unit、Web desktop/mobile E2E 和全量验证证据。

## 进行中

- 无自动化阻塞；实现和自动化验证已完成。
- 待完成：人工检查 25×200 表格的全列到达、sticky 结构/页面溢出、完整 Tab/读屏，以及注入历史详情失败后的重试体验。

## 下一步

1. 若继续验收，读取本交接和 `test-plan.md`，先检查当前工作树，不覆盖会话开始前修改。
2. 完成人工 200 列桌面/移动表格、sticky/溢出、Tab/读屏和失败重试步骤，并把可复现结果补入 `test-report.md`/`acceptance.md`。
3. 只有所有必须人工标准也通过后，才将状态从 `PARTIAL` 推进为 `ACCEPTED`；当前不要创建 commit 或改变生成输入边界。

## 当前 commit 与修改范围

- 当前 commit：未创建本变更 commit；基线保持现有工作树状态。
- 本次文档修改范围：`CONTEXT.md`、`docs/adr/0022-data-snapshot-preview-latest-generation.md`、`docs/changes/2026-09-17-data-snapshot-preview/`；业务修改集中在 API、contracts、DB、Web 及对应测试。
- 未创建 commit；工作树仍包含会话开始前已有的 `CONTEXT.md`、ADR 和变更文档修改。

## 已运行验证

- `pnpm --filter @langreport/contracts test`、`pnpm --filter @langreport/api test`、`pnpm --filter @langreport/web test:e2e -- consulting-report.spec.ts`、`pnpm --filter @langreport/db db:verify`、`pnpm typecheck`、`pnpm test`、`pnpm test:integration`、`pnpm docs:check` 和 `git diff --check` 均通过。
- 集成测试使用 `infra/docker-compose.test.yml` 的隔离 PostgreSQL/MinIO；Playwright 在授权沙箱外执行，桌面/移动共 10/10 通过。
- 自动化证据完整，但人工验收尚未完成，因此 acceptance 保持 `PARTIAL`。

## 已确认决策

1. 用户主动点击“查看数据”，上传成功不自动打开。
2. 默认最新 Snapshot；版本列表可以切换同一 Data Asset 的历史 Snapshot。
3. 历史 Snapshot 只读，只能预览，不能覆盖或生成。
4. 生成始终使用最新 Snapshot，不新增 Generation API 的 `snapshotId`。
5. 版本列表先加载，详情 schema/preview 按需加载。
6. 桌面宽 modal、移动全屏 sheet；25 行、全部列、横向滚动、sticky header/first column、列懒渲染。
7. 单元格按类型展示，空值为 `—`，长值可查看完整内容，表格不可编辑。
8. Snapshot 来源文件元数据新增 nullable 字段；既有历史 Snapshot 不回填，缺失显示“不可用”。
9. 读取权限沿用 Project `view`，不暴露 object key 或原始文件下载。

## 已知问题与未决问题

- 设计已无未决产品问题。
- `data_snapshots` 的 nullable 来源字段已通过 `0023_data_snapshot_preview_source_metadata.sql` 增加；旧 Snapshot 保持空值。
- 200 列和人工辅助技术验收尚未执行，后续必须确认所有列仍可到达、sticky 结构不造成页面级横向溢出。
- 独立测试 Agent 当前不可用；本次由主 Agent 执行并记录自动化/人工覆盖边界。

## 新会话启动必读

1. [AGENTS.md](../../../AGENTS.md)
2. [CONTEXT.md](../../../CONTEXT.md)
3. [项目基线](../../project-spec.md)
4. [第一阶段产品规格](../../product/phase1-consulting-report.md)
5. [Agent 启动与 Loop 规范](../../agent/agent-loop-spec.md)
6. [DESIGN.md](../../../DESIGN.md)
7. [apps/web/AGENTS.md](../../../apps/web/AGENTS.md)
8. 本目录的 `proposal.md`、`design.md`、`task.md`、`test-plan.md`、`acceptance.md`、`handoff.md`
9. [ADR 0022](../../adr/0022-data-snapshot-preview-latest-generation.md)
