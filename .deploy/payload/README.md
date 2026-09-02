# LangReport

LangReport 是一个面向产品、运营、咨询和研究团队的 SaaS 图表生成平台。

用户上传 CSV、XLSX、JSON 或粘贴表格，再用自然语言描述需求。系统负责生成可复现、可编辑、可审核和可协作的图表产物。

当前仓库沉淀产品领域和系统设计，并按 MVP 路线持续实现。

## 文档

- [领域上下文](./CONTEXT.md)
- [领域模型](./docs/domain-model.md)
- [系统架构](./docs/architecture.md)
- [插件 Manifest](./docs/plugin-manifest.md)
- [MVP 路线](./docs/mvp-roadmap.md)
- [Phase 3 设计与实施](./docs/phase3-design.md)
- [Phase 4 设计与实施](./docs/phase4-design.md)
- [开发环境](./docs/development-setup.md)
- [架构决策记录](./docs/adr/)

## MVP 核心闭环

```text
数据输入 → 数据画像 → TransformPlan → Flint Spec → Vega-Lite
→ 交互图表 → PNG/SVG → Chart Revision → 分享/评论/审核
```
