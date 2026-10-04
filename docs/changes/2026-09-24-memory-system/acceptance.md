# 项目记忆系统：Acceptance

- 变更编号：CHG-2026-09-24-memory-system
- 状态：DRAFT
- 创建时间：2026-09-25
- 更新时间：2026-09-28

## 结论与授权

业务验收：A1～A4、TP-25 已实现；rev2 GA FAIL、rev3 NEEDS-EVIDENCE、当时的 9 文件/41 条诊断保留为历史证据。2026-09-28 本次针对 `61460f6` 纯提交的独立复核显示 A 提交文件 Prettier 6 文件失败、ESLint 39 errors；纯提交 typecheck 与完整集成也未通过。新增 startup 集成测试单项 4/4 通过，实时混合工作树的 13 文件 lint/format 与 typecheck 通过，但不替代提交快照门禁。技术 GA 未通过，继续 VERIFYING；用户最终验收尚未发生。
产品修订原则：用户已确认。
实施授权：仅 A1、A2、A3、A4 与 GA 获得；B/C 与 Git 推送未授权；2026-09-28 已单独授权提交已验证 A 代码，commit `61460f6ab2f4a80534fea3c9b0ff0e231953895e`。
本次交付保持 DRAFT / VERIFYING，不标为 ACCEPTED。独立验证结果不能代替用户最终接受。

## 证据

| 对象                           | 文件/依据                                           | 状态                                                                                       |
| ------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 已确认规则                     | proposal.md、design.md；本会话用户确认              | 已记录                                                                                     |
| 三批任务、依赖和退出门         | task.md A/B/C、G0/GA/GB/GC                          | 仅 A 批获准实施，B/C 未授权                                                                |
| 风险与验收追踪                 | test-plan.md TP-01～34；design.md 需求追踪          | A 适用 TP 已执行；B/C 未执行，详细见 test-report.md                                        |
| A 批代码与迁移                 | task.md A1～A4                                      | 实现完成；迁移仅在隔离测试库核验，未运行生产迁移                                           |
| API/OpenAPI/API Console 与 Web | task.md A4、API 合同测试、Playwright E2E            | 源码与合同已同步；UI E2E 使用 Mock API，用户现场验收未进行                                 |
| 自动化测试                     | test-report.md 与 rev3 evidence                     | TP-25 隔离集成、离线测试、迁移核验及最终 typecheck 已通过；全仓 format/lint 失败并逐项归因 |
| 独立只读复核                   | test-report.md、rev3 快照和 Verification agent 报告 | rev3 原始 verdict NEEDS-EVIDENCE；2026-09-28 补查确认 typecheck 31 项完成，质量门仍非零    |
| 用户最终接受                   | 本文件                                              | 待用户；本文件保持 DRAFT                                                                   |

## 尚未通过的业务门禁

- GA 当前未通过：本次纯提交 A 文件 Prettier exit 1（6 文件）、ESLint exit 1（39 errors）；`pnpm typecheck` exit 1（父提交同有账号测试夹具缺字段）；完整 `pnpm test:integration` exit 1（隔离 Docker pipe 访问被拒，另两个非记忆用例返回 500）。rev3 旧备份恢复通过与本次 startup 单项通过均保留，但不能替代本次完整门禁；见 test-report.md 新增复核段。
- GB/GC 未开始且未获授权；Task/Cycle、压缩、归档和候选自动化不在本次验收结果内。
- 未进行生产迁移、备份恢复、真实模型、真实用户或生产 HTTPS 验证；不能从隔离测试推断生产接受。
- 旧登录网关 VERIFYING/PARTIAL 与账号生产部署待验证风险不属于本次完成项。

## 同步检查

- [x] proposal/design/task/test-plan 的目标与依赖建立
- [x] 记录用户已确认的产品修订原则和规划-only 边界
- [x] 领域词汇、ADR 和当前任务索引同步
- [x] 实施授权 G0（仅 A 批）
- [x] A 批实现、迁移定义和 API Console/UI 同步（迁移仅隔离验证，未运行生产迁移）
- [x] rev2 独立 A 批复核（历史结论：GA FAIL，TP-25 恢复重放缺失）
- [x] TP-25 修复后的 rev3 快照独立复核与最终 typecheck 补证
- [ ] 全仓 format/lint 质量门补齐或明确记录适用例外
- [ ] 最终用户接受

## 本次最终确认门（2026-09-28）

- [x] 已区分纯 HEAD、只叠加 startup 测试的快照与含其他任务修改的实时工作树；552/552 个纯 HEAD tracked blob 匹配，独立只读复核完成。
- [x] startup 测试以合成隔离 schema/ledger 复测 exit 0（4/4），并核对脚本接入和测试文件格式/lint exit 0。
- [ ] A 提交文件格式/lint 与纯提交类型门禁通过，或有经批准且明示范围的例外。
- [ ] 当前提交快照的完整集成恢复场景和非记忆失败得到可复现结论；本次因 Docker 访问限制与两个 500，exit 1。
- [ ] 用户对 A 批作最终接受；在此之前本文件状态保持 DRAFT，不标记 ACCEPTED。
