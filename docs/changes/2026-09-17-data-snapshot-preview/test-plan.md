# Data Snapshot Preview：测试计划

- 变更编号：`CHG-2026-09-17-DATA-SNAPSHOT-PREVIEW`
- 状态：`APPROVED`
- 创建时间：2026-09-17
- 更新时间：2026-09-17

## 测试范围

验证 Snapshot 历史列表/详情读取、来源元数据、Project view 权限、Web 最新/历史预览、懒加载、只读表格、错误重试和生成输入不受预览影响。

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| 列表响应携带过多 preview | API contract/integration | 多版本 Data Asset 列表 | 列表只返回版本元数据，不返回历史 schema/preview/object key |
| 详情读取越权 | API integration | 跨 Project、跨 Asset、无 view 权限的 assetId/snapshotId | 稳定 403/404，不泄露资源存在性，不返回数据 |
| snapshotId 与 assetId 错配 | API unit/integration | 使用同 Project 其他 Asset 的 Snapshot ID | 请求失败，不返回内容 |
| 历史来源元数据被当前 Asset 冒充 | DB/API/Web | 旧 Snapshot 新字段为空，Asset 当前文件名不同 | UI 显示“不可用”，不显示当前文件名作为历史事实 |
| 新 Snapshot 没有记录来源信息 | intake/API | 新建和更新上传 | Snapshot metadata 正确写入，Asset 当前 metadata 仍正常 |
| 历史预览影响生成 | Web/API regression | 查看 v1 后点击生成，Asset 最新为 v2 | Generation Job 仍冻结 v2；预览状态不修改生成输入 |
| 默认版本错误 | Web E2E | Data Asset 存在 v1/v2 | 打开预览默认 v2，版本列表可切到 v1 |
| 历史详情加载失败后静默回退 | Web E2E | mock v1 详情 500/404 | modal 保持 v1 选择，显示错误和重试，不显示 v2 内容 |
| 表格丢字段或页面溢出 | Web E2E/visual | 25 行、200 列 | 全部列可通过横向滚动访问；sticky header/first column；页面不横向溢出 |
| 长值/空值/类型难以理解 | Web unit/E2E | null、number、boolean、date、长字符串 | 数字格式化、空值 `—`、长值可查看完整内容 |
| 预览被编辑 | Web E2E | 点击单元格、尝试排序/筛选 | 无编辑控件，不创建 Snapshot，不触发 API 写入 |
| 移动端 modal 遮挡或触控过小 | Web E2E/manual | 430px/760px 宽度 | 全屏 sheet 可滚动，关闭/版本切换/重试可触达，触控目标不少于 44px |
| 键盘和辅助技术不可用 | manual/accessibility | Tab、Escape、读屏表头 | dialog 有标题和焦点路径，表格有 caption/scope，Escape 可关闭 |

## 测试数据与环境

- 一个包含 v1/v2 的同一 Data Asset，两个 Snapshot 的文件名、行数和 preview 内容不同；
- 一个历史 Snapshot 来源元数据为空的 fixture；
- 25 行 × 200 列表格 fixture，包含中文字段、空值、数字、布尔值、日期和长文本；
- 跨 Project 的 Asset/Snapshot 和不同 Project Role fixture；
- Web E2E 使用 `apps/web/test/e2e/consulting-report.spec.ts` 的 route fixture，不依赖模型供应商；
- API/DB 使用现有测试数据库和迁移验证入口；不使用真实客户数据。

## 自动化测试

1. `pnpm --filter @langreport/contracts test`
2. `pnpm --filter @langreport/api typecheck`
3. `pnpm --filter @langreport/api test`
4. `pnpm --filter @langreport/web typecheck`
5. `pnpm --filter @langreport/web test:e2e -- consulting-report.spec.ts`
6. `pnpm --filter @langreport/db db:verify`
7. `pnpm typecheck`
8. `pnpm test`
9. `pnpm test:integration`
10. `pnpm docs:check`
11. `git diff --check`

T1-T6 已完成实现，自动化命令结果记录在 [test-report.md](./test-report.md)；未执行的人工步骤仍不能写入 PASSED 证据。

## 人工验收步骤

1. 导入一个新文件，确认只出现成功提示；点击“查看数据”后默认打开最新 Snapshot。
2. 确认 modal 显示 Data Asset、Snapshot 版本、行数、列数和来源信息；旧记录的缺失来源字段显示“不可用”。
3. 切换到历史 Snapshot，确认详情按需加载、数据行变化且表格只读。
4. 在 200 列 fixture 中横向滚动，确认全部列可到达、首列和表头固定、页面无级联横向滚动。
5. 在移动宽度打开预览，确认 sheet 可滚动、关闭、切换版本和重试。
6. 让历史详情接口失败，确认不回退到最新版本，重试可以重新请求。
7. 查看历史 Snapshot 后发起生成，确认 Generation Job 和 Composer 仍使用最新 Snapshot。
8. 用 Viewer 和跨 Project 用户分别访问列表/详情，确认权限结果和错误信息符合设计。

## 不测试的内容及原因

- 完整原始文件下载：明确不在 MVP；
- 全量数据分页、搜索、排序和筛选：明确后续范围；
- Snapshot diff 和历史版本生成：ADR 0022 明确排除；
- 自动 PII 脱敏：当前没有可靠敏感字段识别机制，另立变更；
- 数据解析算法本身：沿用现有 data-engine 合同，只验证 preview 读出和展示。
