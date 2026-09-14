---
status: accepted
---

# Restrict MVP plugins to declarative manifests

MVP 插件只能通过版本固定的 Plugin Manifest 声明图表模板、Theme、字段语义、校验器、示例和平台已经允许的渲染后端。Workspace 管理员安装插件，Project 显式启用插件；插件不能在服务器执行任意 JavaScript，也不能自行注入未知渲染器。这个边界牺牲了一部分早期灵活性，但保护了多租户 SaaS 的安全、可审计性和渲染一致性。

## Consequences

插件协议需要 Schema 版本、能力校验、哈希固定和兼容性检查。新增渲染器由平台发布；用户扩展优先通过声明式能力完成，受控代码执行属于未来独立的安全产品能力。

第一阶段的发布来源和操作权限由 [ADR 0016](./0016-phase1-platform-owned-plugin-manifests.md) 收窄：只允许平台内置目录中的精确 Manifest，拒绝 `uploaded` 来源和任意 Manifest；声明式、安全与可追溯原则保持不变。
