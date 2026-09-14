---
status: accepted
---

# ADR 0016：第一阶段仅使用平台发布的 Plugin Manifest

第一阶段只消费随平台版本发布、审核并固定版本的声明式 Plugin Manifest。Workspace Owner/Admin 可以从平台内置目录安装、撤销或恢复精确版本；Project Owner、Admin、Editor 可以启用或禁用 Workspace 已安装的版本。校验入口只接受与内置目录内容哈希一致的 Manifest，`uploaded` 安装来源和任意 Manifest 均被拒绝。现有 Manifest 安装、哈希、兼容性和 Revision 快照基础设施继续用于内置能力追溯，并为后续阶段铺路。

该取舍保留了验证 Theme、模板、字段语义和追加校验规则复用价值所需的最小生命周期，同时放弃早期 Workspace 自定义内容的灵活性，避免在核心 Evidence Block 闭环完成前引入插件市场、内容治理和支持成本。任何 Manifest 都不能载入代码、替换平台核心校验或引入未知渲染后端。
