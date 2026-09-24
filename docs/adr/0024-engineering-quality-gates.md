# LangReport 采用分层工程质量门禁

> 状态：proposed

LangReport 采用“文档规范 + 本地命令 + CI 门禁 + PR/Commit 追踪”的分层治理方式：第一阶段使用最小 ESLint/Prettier、包边界和仓库卫生检查，优先在 CI 中阻断回归，暂不把完整测试或 Pre-commit Hook 作为本地硬门禁。这样借鉴 DeerFlow 的可执行贡献流程，同时保留 LangReport 以领域不变量、SDD 审核和可追溯证据为核心的治理方式；本决定不引入 DeerFlow 的通用 Agent、MCP、Sandbox 或运行时架构。

## 考虑过的方案

- 只维护文档：改动小，但无法稳定阻止格式、依赖边界和迁移回归；不采用。
- 直接复制 DeerFlow 的 `ruff`/Make/Pre-commit：与 TypeScript monorepo 不匹配；不采用。
- 一开始将所有检查放进本地 Hook：反馈快，但会增加安装成本、Windows 兼容问题和完整测试等待时间；暂不采用。

## 后果

- 工程规范可以逐步收紧，不需要一次性清理所有历史债务；
- CI 成为统一可信门禁，本地 Hook 后续可以作为加速层而不是唯一防线；
- 新增工具、脚本和 CI 属于工程治理变更，仍需经过 SDD 和人工审核；
- 误报、例外和规则升级必须保留证据，不得通过降低测试范围来掩盖失败。
