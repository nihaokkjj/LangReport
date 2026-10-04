# 验收记录

- 变更编号：LANGREPORT-2026-09-30-lark-table-agent
- 状态：VERIFYING
- 创建时间：2026-09-30
- 更新时间：2026-10-02
- 结论：本地真实数据接入与图表字段通过；整体验收保持 PARTIAL（图表视觉问题及最终用户验收另列）

## 已执行证据

| 标准 | 命令/证据 | 结果 |
| --- | --- | --- |
| 固定版本真实可执行 | `pnpm lark --version` | 1.0.97 |
| 官方命令/权限匹配 | help、`+workbook-import --dry-run`、v1.0.97 官方源码 | 已核实三个必要 scope |
| 多 Sheet、真实表头、重复列、截断/版本/身份、空 Sheet 与未完成导入引用 | `pnpm --filter @langreport/lark-data test` | 10 passed |
| 表格模型路由与 JSONB 顺序 | `pnpm --filter @langreport/model-gateway test` | 10 passed |
| 图表尊重选中的 avg 字段，拒绝不存在字段 | generation unit / 全仓 `pnpm test` | 通过 |
| 全部源码/测试类型 | `pnpm typecheck` | 通过 |
| 流式上传 → 真实测试 S3/DB → 模拟 CLI/Agent → Snapshot | `pnpm test:integration` | API 13 passed，Worker 2 passed，0 skipped |
| 异步 UI 与旧上传/预览兼容 | Playwright desktop，`飞书异步|导入文件与更新|数据预览` | 3 passed |
| 最新异步状态在桌面/手机可用 | Playwright desktop/mobile，真实可见提示输入与文件选择、请求含 hint、等待/成功/澄清；[桌面截图](./evidence/table-hint-desktop.png)、[手机截图](./evidence/table-hint-mobile.png) | 2 passed，截图已查看 |
| 独立复验 | [test-report.md](./test-report.md)；初始全仓测试/类型，修复后专项与隔离集成；最终快照哈希 | TEST_PASSED（本地范围），12/12；API 13 + Worker 2；40/40 一致 |
| 迁移兼容、文档、依赖边界 | `pnpm db:verify`、`pnpm docs:check`、`pnpm check:boundaries` | 通过 |
| 本地开发数据库迁移 | 本地 public 先确认仅缺 0031 后执行 `pnpm db:migrate` | 已应用新任务表；未操作生产 |
| 真实 OAuth 与用户绑定 | 新建专用 profile；`auth status --json --verify`、`pnpm lark:check` | 已通过；本地已启用 lark |
| 真实 CLI 目录字段兼容 | 先失败的回归后修复 `sheet_name`；unit、相关类型、专项、隔离集成 | 11/11、12/12、API 13 + Worker 2；本轮由 owner 执行 |
| 正常 HTTP → 常驻 Worker → 飞书/模型 → Snapshot → 利润图 | [真实验证](./live-verification.md)与合成样例证据 | 3 行 6 列；保留 001/同名列；新旧快照独立；利润合计 45/30 与血缘正确 |

## 尚未完成

- PNG 目视发现首尾柱形跨越绘图区边缘并裁切，显示问题尚未修复；不能把程序渲染校验当成完整视觉验收。
- 真实协议修复后有 3 个实现/测试文件变化，最新快照为 `implementation-snapshot-live.json`。新增独立复核因验证 Agent 用量上限未执行，本轮由 owner 复验；原独立结论不覆盖此增量。最终用户验收仍未代办，不标记 ACCEPTED。
- 当前未执行多用户 OAuth、复杂 Excel 公式等价验证、超大表性能基准或生产部署。
- 直接 ESLint 有历史错误，新增问题对比见 `lint-baseline.json`；不宣称完整 lint 为绿色。

## 来源与边界

CLI 导入属于到飞书的格式转换，不保证所有复杂 Excel 公式、合并表头或显示格式与本地 Excel 完全等价。Snapshot 记录的是经过校验的飞书读取结果。隔离集成测试的外部工具与模型使用明确夹具；2026-10-02 另行执行了真实 CLI、模型和常驻服务小样例验证，范围与认证方法见真实验证报告。
