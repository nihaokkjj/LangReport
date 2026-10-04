# 文档与实施检查记录

- change-id：`CHG-2026-10-03-evidence-correctness-repair`
- 状态：`IMPLEMENTING`，部分验证
- 创建时间：2026-10-03
- 更新时间：2026-10-03
- 业务测试状态：`PARTIAL`；下方保留原文档阶段结果，不代表当前未修改代码。
- 执行角色：owner 自测；独立角色完成一次冻结快照的只读代码复核，未完成最终独立测试。

## A 批实施验证（新增）

- 原始数据回归：11 项中新增六项失败，旧五项通过；渲染新增两项失败，追加完整数据回归后共三项失败。
- 数据修复后：15 项通过；之后追加 ISO/日期兼容测试，最终结果见后续复验记录。
- contracts、generation 测试通过；generation 24 项通过。
- API 上传专项 12 项通过，覆盖持久化 parserVersion 和 columnMapping。
- data-engine/generation/API/Worker/Web 类型检查通过；docs:check、git diff --check 通过。
- API 完整单元命令在 auth 16 项输出完成后未退出，主动中止，记为未完成；不等于其他 API 测试通过。
- flint-adapter：12 项中九项通过、三项失败（完整数据、Area、负柱）；产品渲染未修改。
- 独立角色 `verify_data_repair` 基于 repair-data-review 冻结快照发现 ISO 拒绝和日期偏移单位回归；owner 已修正并添加测试。独立复核未运行测试，也尚未复验最终快照，不能视为独立验收通过。
- 未执行数据库迁移、真实模型/飞书、部署、完整浏览器 E2E、全仓质量验收。

### 最终离线复验

按 scripts/test-offline.mjs 的环境先执行 `--check` 排除外部配置，再设置 APP_ENV/NODE_ENV=test、LANGREPORT_OFFLINE_TEST=1、确定性模型、本地接入和不可连接的测试端点，运行 data-engine/contracts/generation/generation-worker/api 五个包的 test：**118 项通过，0 失败，命令退出 0**（16/26/24/14/38）。先前 API/Worker 包级测试不退出的问题在规定离线环境下消失；不是通过 test-force-exit 隐藏句柄问题。

受影响六个包的源码类型检查、六个包的测试类型检查、定向 ESLint、文档链接及 git diff --check 均通过。上述通过范围不包含渲染三项失败用例，也不代表完整 E2E 或用户验收。

原始输出：[离线复验](./evidence/data-repair-offline-final.txt)、[渲染未修复回归](./evidence/render-regressions.txt)、[渲染预算实验](./evidence/render-budget.json)。

## T4 时间粒度补充复验

2026-10-04继续T2隔离实验：Node/Chromium的Line与Area场景图相等，多系列乱序期间、null断点、Area填充及零基线断言通过，进程退出0。见[原始结果](./evidence/render-cross-runtime-results.json)。测试采用明确不堆叠的候选规范，不是生产链路验收。未更换产品渲染器。

本轮定向 ESLint 未通过：data-engine一个未使用current、generation未使用materializeArtifacts、测试两个未使用_request。对照repair-baseline确认四项均已存在（旧物化调用位于已注释的命令式实现），未改检查器或删除原工作。早先“定向lint通过”不代表这些文件当前全量lint通过。最新docs:check和git diff --check通过。

最终六包离线复验：**136项通过，0失败，退出0**（contracts27/data-engine18/lark-data12/generation27/generation-worker14/api38），使用规定离线环境。[完整原始日志](./evidence/t4-final-six-packages.txt)。

新增回归覆盖月度归组、季度/年度同比、逐日与跨闰年匹配、JSON/XLSX列冲突、CSV与合成飞书typed-table编号/数值对照。前一实现的六包离线原始结果保存在 [t4-offline-tests.txt](./evidence/t4-offline-tests.txt)。

独立复核 repair-t4-final-review 发现两项 P2：只根据前五个样例跳过归一化会遗漏后续日期；日内多时间戳未按日期归组。修正后冻结 repair-t4-calendar-final（665文件），verify_data_repair 从冻结源码运行纯函数断言，退出0，确认两项修复及v1兼容，没有发现本轮其他可确认缺陷；不构成全链路或用户验收。

最新 data-engine18/generation27项全部通过，三个包（contracts/data-engine/generation）源码及测试类型检查通过。先前一次运行仅旧血缘夹具失败，因为v2新增归组步骤；更新v2期望并保留旧夹具后通过。失败证据 [calendar-recheck](./evidence/t4-calendar-recheck.txt)，通过证据 [calendar-recheck-final](./evidence/t4-calendar-recheck-final.txt)。

## 原文档阶段记录（历史）

## 本次验证范围

只检查新增修复文档、两份 Proposed ADR、文档导航和 agent-tasks 交接。对 Git 列出的 tracked/untracked 非 Markdown 文件逐一比较 SHA-256（排除 docs 目录和本地 .env）；379 个文件内容及文件集合均未变化，涵盖代码、测试、依赖、配置和迁移。未读取或修改 .env，未执行数据库写入；原仓库已有代码修改保持原状。

## 命令与结果

以下为 2026-10-03 本轮实际执行结果。业务测试仍为 NOT_RUN。

| 检查                               | 结果                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `pnpm docs:check`                  | 通过，退出码 0                                                           |
| 本次文档定向 Prettier              | write 后 check 通过，退出码 0；仅本次 13 个 Markdown，原任务快照不格式化 |
| `git diff --check`                 | 通过，退出码 0                                                           |
| 本次新增文档/ADR相对链接与任务映射 | 仓库链接检查通过；人工核对 F1–F11 → R1–R11 → D/T/TP 对应关系             |
| 非文档文件 SHA-256 前后比较        | 前后各 379 个，新增/删除/内容差异均为 0                                  |
| 原任务交接快照                     | 覆盖 current-task 前复制原字节，SHA-256 相同；原状态 VERIFYING 保留      |

## 未执行项

没有运行/编写 TP01–TP25 的修复回归，没有安装渲染依赖，没有运行数据迁移或压力测试，没有启动独立实现测试 Agent。原因是用户明确仅要求文档，且尚无实施快照。本计划已规定实施后的独立测试输入、职责与退出条件。
