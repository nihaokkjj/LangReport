# LangReport Agent Instructions

## Product scope

LangReport 当前只优先实现“咨询项目报告”这一条垂直闭环。产品承诺是：把客户提供的表格和分析问题转换为可追溯、可审核、符合项目视觉规范的图表证据模块。

每次任务开始前，先读取 [CONTEXT.md](./CONTEXT.md) 和 [docs/phase1-consulting-report.md](./docs/phase1-consulting-report.md)。涉及 Agent 启动或循环、生成状态、自动修复、数据访问、记忆写入或模板启用时，再读取 [docs/agent-loop-spec.md](./docs/agent-loop-spec.md)。这些文档分别是业务词汇、第一阶段产品边界和执行限制的唯一参考。

第一阶段的默认边界：一个 Workspace 内的一个 Project、一个 Data Snapshot、一个 Analysis Brief、一次 Generation Cycle 生成一个主 Chart Artifact/Evidence Block；生成结果必须能回溯到数据快照、指标口径、TransformPlan、Flint Spec、主题版本和修订记录。

第一阶段优先交付确定性和审核能力，不扩展为通用 BI 平台。数据库/实时数据、跨文件 Join、Dashboard、实时协作、公开分享、任意服务器端代码、插件市场和完整 PPT 排版属于后续范围，除非用户明确改变阶段目标。

## Agent operating rules

1. 先核对当前代码和文档，再声明本次任务的 Project/aggregate、用户场景、验收标准和明确不做的边界。
2. 使用 `CONTEXT.md` 中的规范术语；发现代码与领域词汇冲突时，先指出冲突并选择一个权威定义，不创建同义实体。
3. 将持久化业务规则写入 `docs/`，将领域词汇写入 `CONTEXT.md`，将难以逆转且有真实取舍的决定写入 `docs/adr/`。不要把实现细节塞进 `CONTEXT.md`。
4. 每一轮只推进一个可验收的垂直结果；不要为了“顺便完整”扩大到下一阶段。
5. 任何图表成功结果都要具备来源、口径、变换、规范、主题和校验记录；任何批准版本都保持不可变。
6. 记忆候选、模板变更和审核决策都需要显式状态，不能把模型推断直接当成项目事实。
7. 保留用户已有的工作树修改；修改前后检查 `git diff`，只验证本次范围。

## UI work

When a task changes `apps/web` pages, components, styles, layout, or interaction:

1. Read the complete root `DESIGN.md` before editing. It is the source of truth for the visual system.
2. Apply the documented color, typography, spacing, radius, component, responsive, and Do/Don't rules. Reuse existing tokens and styles when they fit.
3. Preserve the current product information architecture, API calls, and data behavior unless the task explicitly asks for a functional change. Translate the visual language to the data workspace; do not turn it into a marketing landing page by default.
4. Keep new visual values inside the documented token system. If a new value is necessary, explain the deviation in the final response.
5. Check the result at desktop and mobile widths. Confirm that text hierarchy, contrast, touch targets, overflow, and empty/loading/error states remain usable.
6. Run `pnpm --filter @langreport/web typecheck` after UI changes. Treat failures as unresolved until fixed or clearly reported.

## Completion standard

一项第一阶段功能只有在以下条件全部满足时才算完成：产品边界仍是咨询项目报告；领域不变量没有被破坏；失败状态可解释；数据和图表版本可追溯；相关测试或类型检查通过；文档中的验收标准与实现一致。

UI 任务还必须满足：实现符合 [DESIGN.md](./DESIGN.md) 的视觉规则，现有 API 和数据行为仍然可用，桌面与移动端的层级、对比度、触控区域、溢出、空态、加载态和错误态已检查，并通过 `pnpm --filter @langreport/web typecheck`。
