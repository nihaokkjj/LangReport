# LangReport

LangReport 是一个面向咨询团队的 AI 数据报告工作台。

第一阶段只服务“咨询项目报告”：用户把客户的 CSV、XLSX、JSON 或粘贴表格放入 Project，再用自然语言描述业务问题。系统生成一个带指标口径、数据来源、转换过程、可编辑图表和审核状态的 Evidence Block。

产品承诺不是“生成一张好看的图”，而是让顾问能够回答：这张图使用了什么数据、指标如何计算、AI 做了哪些转换、谁审核过、修改前后有什么差异。

## 第一阶段产品闭环

```text
Consulting Project
  → Analysis Brief
  → Data Asset / Data Snapshot
  → Conversation / Generation Cycle
  → TransformPlan / Metric Definition
  → Chart Artifact / Chart Revision
  → Evidence Block
  → Review / Export
```

第一阶段的硬边界是：单 Project、单 Data Snapshot、单 Analysis Brief、每次 Cycle 一个主图表证据模块。目标支持有限的表格变换、Line/Bar/Area 主图表、项目 Visual Template、浏览器交互预览、PNG/SVG/静态 HTML/Vega-Lite JSON 固定 Revision 输出和异步审核。HTML 首版由 Render Worker 生成自包含的静态 SVG 包装页，用户文本会转义，不加载外部资源，也不执行用户脚本。数据库/实时数据、跨文件 Join、Dashboard、实时协作、公开分享、任意服务器端代码和完整 PPT 排版暂不进入第一阶段。

## 文档

- [项目基线与模块地图](./docs/project-spec.md)
- [SDD 变更治理与模板](./docs/changes/README.md)
- [领域上下文](./CONTEXT.md)
- [第一阶段产品规格：咨询项目报告](./docs/product/phase1-consulting-report.md)
- [Agent 启动与 Loop 规范](./docs/agent/agent-loop-spec.md)
- [领域模型](./docs/architecture/domain-model.md)
- [系统架构](./docs/architecture/architecture.md)
- [多供应商模型接入实施计划（部分实施）](./docs/generation/model-gateway-implementation-plan.md)
- [LangChain / LangGraph 选型研究与实现状态](./docs/generation/langchain-langgraph-selection.md)
- [插件 Manifest](./docs/plugins/plugin-manifest.md)
- [MVP 路线](./docs/product/mvp-roadmap.md)
- [市场研究](./docs/research/market-research.md)
- [Phase 3 设计与实施](./docs/history/phase3-design.md)
- [Phase 4 设计与实施](./docs/history/phase4-design.md)
- [Phase 5 设计与实施](./docs/history/phase5-design.md)
- [开发环境](./docs/operations/development-setup.md)
- [ECS 发布与真实百炼门禁](./docs/operations/deploy-ecs.md)
- [登录网关变更设计](./docs/changes/2026-09-22-login-gateway/proposal.md)
- [架构决策记录](./docs/adr/)
