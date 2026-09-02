---
status: accepted
---

# Use Flint as the rendering boundary

LangReport 选择在独立 Render Worker 中直接使用 `flint-chart`，将 Flint Spec 作为平台生成层与具体图表后端之间的边界。这样可以复用 Flint 的语义布局、主题和多后端能力，同时让 LangReport 自己拥有 Workspace、Project、记忆、权限、版本和审核模型；MCP 作为未来的外部 Agent 适配层，而不是 MVP 的核心依赖。

## Consequences

Chart Revision 必须保存 LangReport 包装后的 Flint 输入、固定的 Flint 版本、Vega-Lite 原生规范和渲染输出。平台需要维护 Flint Adapter，但不应把业务权限或项目记忆耦合进 Flint。
