# LangReport 工程代码规范与质量门禁：独立测试报告

- 变更编号：`CHG-2026-09-23-engineering-governance`
- 测试状态：`PARTIAL`
- 代码快照：`LangReport 工作树；基线 commit 97a05cbb9d26f20542ec9ca260494270856eb7d0；尚未提交`

## 测试范围

本报告记录 T1-T8 的本地验证和等价独立只读快照验证。PR workflow 已完成静态审阅但尚未在远端 Runner 执行；最终人工验收仍待 T9。

## 测试环境

使用 Node.js `>=22`、pnpm `11.19.0`，未读取真实外部凭据或连接业务运行环境。

## 执行命令与结果

| 命令 | 结果 | 关键输出 |
| --- | --- | --- |
| `pnpm format:check` | 通过 | 变更文件格式检查通过 |
| `pnpm lint` | 通过 | 变更 JavaScript/TypeScript 文件 lint 通过 |
| `pnpm check` | 通过 | 组合格式、lint、边界、卫生、文档和 Commit 检查通过 |
| `pnpm check:boundaries` | 通过 | 4 个边界正反例和实际 workspace 扫描通过 |
| `pnpm check:hygiene` | 通过 | 3 个卫生正反例、Git 状态和迁移 journal 扫描通过 |
| `pnpm db:verify` | 通过 | 27 个迁移完成 journal 校验和隔离 schema 回放 |
| `pnpm check:commits` | 通过 | 当前基线最近提交按 M 级规则通过 |
| `pnpm docs:check` | 通过 | 文档链接和根目录约束通过 |
| `pnpm test` | 通过 | root 治理契约测试和 workspace 离线单元测试通过 |
| `pnpm typecheck` | 通过 | workspace 与测试类型检查通过 |
| `pnpm build` | 通过 | workspace build 通过 |
| `pnpm test:coverage` | 基线失败 | `@langreport/domain` branch coverage `76.09% < 81%`；未修改阈值或业务测试 |
| `git diff --check` | 通过 | 无空白错误 |

## 独立只读快照

快照位于系统 Temp，使用当前变更完整文件、无生产凭据，并通过只读依赖映射执行。快照中以下验证通过：

- Prettier、ESLint；
- boundary/hygiene 正反例和实际 workspace 扫描；
- docs-check、Commit checker 及其 5 个单测；
- 全部 workspace 与测试 `tsconfig` 类型检查；
- 全部 workspace 的离线 `test` 脚本；
- 27 个迁移文件检查和隔离 schema 回放。

快照 Web build 尝试了 Turbopack 和 Webpack，均因依赖 Junction 内部保留主工作树绝对 `.pnpm` 路径而失败；这是快照依赖布局限制，不是源码编译错误。主工作树 `pnpm build` 已通过，故保留该项为环境覆盖缺口而非产品回归。

## 失败用例

T1-T8 没有新增失败用例。唯一失败是既有 `@langreport/domain` coverage threshold：branch coverage 为 `76.09%`，低于 `81%`；这属于本变更明确延期的历史覆盖率清理，不通过降低阈值或修改业务测试处理。

## 测试代码变更

更新了既有 `tests/support/test-system.contract.test.mjs`：将 PR workflow 契约测试从旧的三项离线命令扩展为当前全部 MVP 门禁，并保持只验证工程契约，不改变产品运行时行为。

## 覆盖缺口

- 独立快照已验证新 lint/format 规则、包边界脚本正反例和实际 workspace 扫描；
- 尚未验证 PR workflow 在 PR/push 场景的 Commit 历史读取；Commit checker 本地正反例通过；
- 尚未在远端 Runner 验证 workflow 的 service container 和权限行为；
- 独立快照 Web build 受依赖 Junction 绝对路径限制，主工作树 build 已通过；
- 覆盖率阈值仍未达标，后续需单独处理历史测试覆盖缺口；
- 本地完整回归和独立快照验证通过，仍不能替代远端 workflow 和 T9 人工验收。

## 复测记录

待 T9；下一次复测应在远端 PR Runner 运行 workflow 后补充证据，或在真正独立依赖副本中重跑 Web build。
