# 项目记忆系统：Acceptance

- 变更编号：CHG-2026-09-24-memory-system
- 状态：DRAFT
- 创建时间：2026-09-25
- 更新时间：2026-09-29

## 结论与授权

业务验收：A1～A4、TP-25 已实现；rev2 GA FAIL、rev3 NEEDS-EVIDENCE、当时的 9 文件/41 条诊断和 `61460f6` 原始提交快照失败均保留为历史证据。2026-09-29 用户确认完成 A/GA 后，已在候选分支 `codex/langreport-memory-a-ga-20260929` 形成提交 `56af7a55287490415aecba09058051a9a626a2be`；候选 A 范围 Prettier/ESLint、typecheck、离线测试和隔离 Docker 完整集成门均通过，两个 500 的 fixture 根因在同一隔离快照中复现并修复。A/GA 技术退出门通过；整体 Acceptance 仍为 DRAFT，因为 B/C 未授权且未实施。
产品修订原则：用户已确认。
实施授权：A1、A2、A3、A4 与 GA 已获授权；2026-09-29 用户批准将数据库账号任务的 3 个测试夹具纳入 A/GA 候选，并授权推送该候选分支。B/C 未获授权。提交 `56af7a5` 仅是隔离候选分支的交付，不改写主工作分支。
A/GA 技术退出门已由用户确认完成；本文件所代表的完整记忆系统 Acceptance 继续保持 DRAFT，直到 B/C 另行获批并验收。独立验证结果仅作为证据，不代替用户的范围决定。

## 证据

| 对象                           | 文件/依据                                  | 状态                                                                                            |
| ------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 已确认规则                     | proposal.md、design.md；本会话用户确认     | 已记录                                                                                          |
| 三批任务、依赖和退出门         | task.md A/B/C、G0/GA/GB/GC                 | 仅 A 批获准实施，B/C 未授权                                                                     |
| 风险与验收追踪                 | test-plan.md TP-01～34；design.md 需求追踪 | A 适用 TP 已执行；B/C 未执行，详细见 test-report.md                                             |
| A 批代码与迁移                 | task.md A1～A4                             | 实现完成；迁移仅在隔离测试库核验，未运行生产迁移                                                |
| API/OpenAPI/API Console 与 Web | task.md A4、API 合同测试、Playwright E2E   | 源码与合同已同步；UI E2E 使用 Mock API，用户现场验收未进行                                      |
| 自动化测试                     | test-report.md、候选证据目录               | A/GA 范围 Prettier、ESLint、typecheck、offline 与专用隔离 Docker integration 通过；历史失败保留 |
| 独立只读复核                   | candidate snapshot 与提交复核              | 候选内容、父提交归因、测试日志和 12 文件提交清单均复核通过                                      |
| 用户 A/GA 确认                 | 2026-09-29 本会话                          | 已确认完成 A/GA；B/C 与整体 Acceptance 仍未获批                                                 |

## 尚未通过的业务门禁

- A/GA 退出门已通过：候选 `56af7a5` 的 A 范围格式/lint、`pnpm typecheck`、`pnpm test` 和隔离 `pnpm test:integration` 均通过。`61460f6` 原始失败及 500 反事实日志作为历史证据保留；没有质量豁免。
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
- [x] A/GA 作用文件的 format/lint 与 typecheck 通过，无豁免
- [x] 当前候选快照的隔离恢复、startup 和完整集成门通过
- [x] 用户确认 A/GA 退出门完成（2026-09-29）
- [ ] B/C 后续范围（未获授权；本次整体 Acceptance 仍为 DRAFT）

## 本次最终确认门（2026-09-28）

- [x] 已区分纯 HEAD、只叠加 startup 测试的快照与含其他任务修改的实时工作树；552/552 个纯 HEAD tracked blob 匹配，独立只读复核完成。
- [x] startup 测试以合成隔离 schema/ledger 复测 exit 0（4/4），并核对脚本接入和测试文件格式/lint exit 0。
- [x] A/GA 候选的作用文件格式/lint 和类型门禁通过；原提交与父提交的 6/39 诊断逐项归因为基线继承，并在候选中清理。
- [x] 当前候选快照的恢复用例、startup 场景、两个 500 的根因反事实与修复后完整集成均可复现。
- [x] 用户于 2026-09-29 确认完成 A/GA 技术退出门。
- [ ] 整体 Acceptance：因 B/C 未获授权，仍保持 DRAFT；不将未执行范围标成通过。
