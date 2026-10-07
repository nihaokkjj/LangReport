# T5 冻结发现限定独立复核

2026-10-06；固定740文件快照 `./tree`。只读检查源码、AGENTS/manifest及原修复设计D2/TP06。未修改产品或快照，未运行DB负载。

## 结论

本次新增finding冻结与读取路径未发现需要报告的新缺陷。限定纯函数断言通过；不能据此宣布T5全部通过，也不覆盖T6/T7原子发布与不可变Evidence。

## 独立实测

同目录 `finding-check.mjs` 从快照提取原样 ChartServiceError、record/nonempty、freezeDerivedFinding、findingForGenerationJob函数体，使用Node内置类型转换执行。为避免加载DB依赖，旧buildEvidenceFinding被替换为只记录spec/summary的测试函数；因此逻辑分支只验证参数转交，不冒充候选发现生成器完整执行。

通过：

- 来源finding入队后变化不改变冻结字符串；JSON持久化往返后再次读取相同。
- 缺Evidence、空白finding、缺audit、来源Revision不符、文本与hash不符均拒绝REVISION_PROVENANCE_INCOMPLETE。
- transformPlan或encodings编辑均忽略旧冻结发现，向构建器转交新spec/summary。
- 进程自然退出；命令 `node ./finding-check.mjs`。

## 静态链路检查

- API `chart-routes.ts:173–188` 在来源授权后，仅视觉编辑按sourceRevision和project查询Evidence，缺失由freezeDerivedFinding拒绝；首次插入Job保存derivedFinding。不复用项目当前值。幂等复用在重新读取Evidence之前返回既有Job，避免相同请求因来源文本变化漂移。
- Generation Worker编辑路径更新变换/统计/验证但未覆盖generationAudit；Render Worker的withValidationAudit采用展开保留derivedFinding。API retry仅重置租约/失败字段，不清除该冻结记录。
- Render Worker的候选HTML校验、最终HTML输出、Evidence保存三处调用同一个findingForGenerationJob。视觉分支读取冻结字符串，不再查可变Evidence；逻辑分支调用新统计构建器。
- Worker集成新增真实API创建视觉编辑Job、随后修改源Evidence，再检查新Evidence和HTML仍使用入队前文本；统计、血缘、Brief/Metric及数据继承有断言。逻辑编辑仍直接插入Job绕过API，检查新结果统计和finding不同；这不是逻辑编辑API完整合同测试。

## 限制

- 未独立执行Worker/DB/S3集成或故障重试；纯函数JSON往返不等同真实失败后重试。集成源码中当前没有新加“渲染失败后重试且来源再变化”的完整流程。
- missing finding的HTTP409路径只读验证，未发真实API请求。
- 现有persistEvidenceBlock仍按Artifact重用并更新旧Evidence；后续旧Revision可能失去对应Evidence。属于已明确保留的T7欠项，本轮不把它报为新T5实现缺陷，也不把T5本次复核当作历史Evidence完整性验收。
- buildEvidenceFinding原有算法没有在本脚本执行；逻辑发现内容准确性仍需实际集成结果证明，不能仅凭notEqual(oldFinding)全面验收。
