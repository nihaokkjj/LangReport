# LangReport 工程代码规范与质量门禁：Test Plan

- 变更编号：`CHG-2026-09-23-engineering-governance`
- 状态：`REVIEWING`
- 创建时间：2026-09-23
- 更新时间：2026-09-23

## 测试范围

验证工程规范、静态检查、包边界、仓库卫生、Commit/change-id、PR workflow 和既有业务回归；不验证新的产品功能，因为本变更不应新增产品行为。

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| ESLint/Prettier 规则误伤现有代码 | 脚本 + 全仓检查 | 合法源码、测试、配置和文档 | 通过或记录明确基线，不产生无关业务改动 |
| 格式检查未接入 root scripts | 契约测试 | 全新依赖环境运行命令 | `format:check`、`lint`、`check` 可执行 |
| 包边界规则失效 | 正反例单测 | 合法 import、模拟非法 Harness/App 或 Domain/Web import | 合法通过，非法失败 |
| 依赖解析误报/漏报 | 边界回归 | workspace alias、相对路径、type-only import | 规则结果稳定且有可解释错误 |
| 迁移或文档检查未进入 CI | workflow review + 本地复现 | 修改 journal、断链或 docs 根目录 | 适用 PR gate 失败 |
| 离线测试访问真实环境 | 环境契约测试 | 配置真实 DATABASE/S3/Model/Auth 环境变量 | 离线测试主动拒绝 |
| Commit checker 误拒绝 S/M | 正反例单测 | 合法 Conventional Commit、无 change-id 的 S/M | 通过 |
| Commit checker 放过 L/XL | 正反例单测 | 缺少或错误 change-id 的 L/XL | 失败 |
| PR 模板遗漏领域风险 | 人工审阅 | API、DB、Worker、UI、认证和 AI 改动 | 模板能要求范围、不变量和证据 |
| 工程治理引入运行时回归 | 全仓回归 | API/Web/Generation/Render/Auth 现有测试 | typecheck、test、build 和专项测试保持通过 |
| 首次格式化产生无关大 diff | diff 审计 | 运行 format 后检查文件列表 | 只包含批准范围，必要时拆分基线清理 |

## 测试数据与环境

- Node.js 22、pnpm 11.19.0；
- 离线测试使用仓库现有 deterministic 模式；
- 不注入真实数据库、S3、模型、认证或 Worker 凭据；
- 边界和 Commit checker 使用临时 fixture 文件，不修改产品源码；
- CI 使用 `pnpm install --frozen-lockfile`；
- 独立验证使用实现后的 commit 或只读快照。

## 自动化测试

预计命令：

```text
pnpm format:check
pnpm lint
pnpm check:boundaries
pnpm check:hygiene
pnpm docs:check
pnpm db:verify
pnpm typecheck
pnpm test
pnpm build
pnpm test:coverage
git diff --check
```

专项场景：

- Web：`pnpm --filter @langreport/web typecheck`、Web unit、E2E；
- API：`pnpm --filter @langreport/api typecheck`、API/HTTP contract tests；
- Generation/Worker：既有 Generation、Lease/Fencing 和 Snapshot tests；
- Render/Chart：既有 Flint、Revision immutability 和输出校验 tests；
- Auth：现有登录网关测试，不新增认证范围；
- Docs：`pnpm docs:check` 和变更目录内部链接检查。

## 人工验收步骤

1. 从干净 commit 安装依赖，运行所有 root check 命令。
2. 修改一个合法文件，确认所有适用检查通过。
3. 在临时 fixture 中加入一条非法依赖，确认 boundary check 失败并显示稳定错误。
4. 构造缺少 `change-id` 的 L/XL Commit，确认 checker 拒绝；构造合法 S/M Commit，确认通过。
5. 检查 PR 模板覆盖 Scope、Aggregate、不变量、验证、API Console、迁移、UI 和 AI disclosure。
6. 确认 PR workflow 不读取真实凭据，不访问生产数据库或对象存储。
7. 确认现有登录、Project、Generation、Revision、Render 和 Web 回归保持通过。
8. 确认 `git diff` 只包含本变更批准范围，未覆盖用户已有修改。

## 不测试的内容及原因

- Pre-commit Hook：本次明确延期到 T10；
- 真实模型调用和生产 HTTPS smoke：属于既有产品/部署变更，不属于工程治理；
- 新的覆盖率阈值：没有先建立基线，不在本次强制；
- 全量历史 `any` 清理：属于后续代码质量债务，不应阻塞本次治理；
- DeerFlow Agent/MCP/Sandbox 行为：本变更不引入这些能力。
