# 修复需求与审查基线

- change-id：`CHG-2026-10-03-evidence-correctness-repair`
- 状态：`REVIEWING`
- 创建时间：2026-10-03
- 更新时间：2026-10-03

## 来源与证据强度

来源为本聊天于 2026-10-02 执行、2026-10-03 整理的代码审查。HEAD 为 `1e279bc63d8300e31b839c4c45b33fdbfae0cbc4`，另有原用户未提交/未跟踪代码。以下行号是审查时位置，实施前按符号重新定位。本文件将修复所需证据保存在仓库中，不依赖聊天附件才能理解。

动态探针使用合成数据。数据库探针位于专用测试 PostgreSQL 54330 的随机 schema，已清理；没有访问现用数据、真实模型或飞书。首次生命周期探针末段因自建夹具缺 idempotency_key 中止，复制/编辑/并发输出有效；补齐夹具后单独完成审核探针。没有留存可重复执行的探针文件，后续 T1 必须建立正式回归，不能把口述当成测试代码。

## 缺陷矩阵

| ID/级别 | 代码定位                                                                                          | 已观察结果                                                                                    | 证据范围                                                  |
| ------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| F1/P1   | `apps/web/app/(protected)/page.tsx` rowsForEvidence，约 337；Worker previewData，约 188           | 执行实际函数体：600 行返回 500 行，最大值 600 变为 500                                        | 动态函数探针，非浏览器 E2E                                |
| F2/P1   | `packages/flint-adapter/src/index.ts` renderChart/负数基线，约 230/289/302；页面 InteractiveChart | A=-10/B=20，负柱高 1；右柱 x+width=543.28 超过 500；Area 导出为 fill=none 折线；验证仍 passed | 真实本地渲染；前端负数/主题问题为源码确认                 |
| F3/P1   | `apps/api/src/chart-routes.ts` 编辑 Job，约 131；Render Worker，约 281                            | 来源有 Brief/指标，仅改标题返回 202，但 Job 快照均 {}、assembly=null                          | 隔离路由探针；新 Revision 丢失为写入链路追踪              |
| F4/P1   | `packages/chart/src/index.ts` copyRevisionToArtifact，约 311；派生输出约 295                      | 复制 brief={}、metric={}、execution=null、复用来源 HTML key                                   | 隔离数据库探针；HTML 内嵌旧身份由渲染实现确认             |
| F5/P1   | chart transitionChartRevision，约 401；Render Worker 提交顺序                                     | 关联 Job failed、renderValidation failed、outputs={}，仍可转 approved                         | 合成失败状态验证审批规则；未注入真实 S3 故障              |
| F6/P1   | chart Evidence 更新，约 423                                                                       | 提交 R1 审核后，Evidence 指针=R1，但 title/finding=R2                                         | 隔离数据库探针                                            |
| F7/P1   | data-engine deriveRows，约 493                                                                    | 输入 3月150/1月100/2月120，orderBy=month，实际 3月null/1月-33.33%/2月20%                      | 纯函数探针；预期 1月null/2月20%/3月25%                    |
| F8/P1   | data-engine parseDelimited/coerceDelimitedString，约 168/286                                      | 两个 amount 列只剩最后一个；粘贴编号 001 变成数值 1                                           | 纯函数探针；仅本地/粘贴路径，未将问题归到飞书 typed table |
| F9/P2   | chart createDerivedRevision，约 267/297                                                           | 6 个并发派生中 3 次 23505 版本号唯一键冲突                                                    | 隔离数据库探针；比例取决于调度                            |
| F10/P2  | data-engine profileRows，约 254；API parseData，约 454                                            | 单列高基数 JSON：1万46ms/2万154ms/4万691ms；filter+indexOf 为平方搜索                         | 单次本机测量，非正式性能承诺；API 同步调用为源码确认      |
| F11/P2  | scripts 与质量门禁                                                                                | 格式 3 文件失败、lint 23 错误、hygiene 2 个日志路径失败                                       | 实际命令结果；路径违规不等于日志内容泄密                  |

## 历史验证，不是修复后验收

| 命令                    | 2026-10-02 审查结果                               |
| ----------------------- | ------------------------------------------------- |
| `pnpm test`             | 217 passed（测试系统合同 13 + workspace 204）     |
| `pnpm typecheck`        | 通过                                              |
| `pnpm test:integration` | API 13 + Worker 2 通过，隔离测试环境              |
| `pnpm check`            | 在格式阶段失败；后续另行检查                      |
| `pnpm lint`             | 23 errors                                         |
| `pnpm check:boundaries` | 通过                                              |
| `pnpm check:hygiene`    | 失败：既有 UI 证据 capture.log/e2e-final.log 路径 |
| `pnpm docs:check`       | 通过                                              |
| `git diff --check`      | 通过                                              |

格式失败文件为 `apps/api/src/table-intake.ts`、飞书变更 evidence 下 `live-http-result.json` 和 `live-intake-result.json`。类型与离线/集成通过不能覆盖图表语义、版本绑定和故障注入。生产构建、真实浏览器闭环、生产恢复和发布门禁没有在本次审查执行。

## 当前代码与目标规范的差异

以 [第一阶段规格](../../product/phase1-consulting-report.md)、[领域模型](../../architecture/domain-model.md) 和 [Loop 规范](../../agent/agent-loop-spec.md) 为目标；以实际代码为现状。本文没有把“应当不可变、完整、受租约保护”误写为“现有全部路径已做到”。与飞书、UI、记忆等原变更的 VERIFYING 状态并存，不替代它们的验收。
