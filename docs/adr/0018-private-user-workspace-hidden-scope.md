# ADR-0018：隐藏 Workspace，按用户解析私有项目作用域

- 状态：Accepted
- 日期：2026-09-15

## 背景

产品入口调整为“用户 → Project → Conversation”。用户不应看到 Workspace，也不应管理 Workspace 成员；但当前数据模型、权限检查、插件安装、模型凭据、记忆和对象存储都以 Workspace 作为隔离键。

## 决策

保留 Workspace 作为内部技术租户边界，并为每个认证用户自动维护一个私有 Workspace：

- 用户访问 Project 列表或创建 Project 时，由服务端根据认证用户解析其 Workspace；用户不能从普通产品入口选择 Workspace。
- 新用户初始化时创建 Workspace 和 owner Member 记录；不再使用所有用户共享的默认 Workspace。
- 前端隐藏 Workspace 名称、切换入口和成员管理入口，用户直接操作自己的 Project。
- 保留数据库中的 `workspaceId`、成员授权、对象存储 `workspaces/{workspaceId}/...` 路径，以及内部的模型凭据和插件 API；这些是安全边界和审计链的一部分，不属于用户体验层。
- Project、Conversation、Data Snapshot、Memory、Plugin 和 Generation Job 仍必须完成 Workspace/Project 关系校验。

## 为什么不直接删除 Workspace

直接删除会同时改变多条稳定边界：数据库外键、对象存储路径、Worker 快照访问、Project Access、插件安装范围、Workspace Memory、模型凭据和历史审计。短期收益只是减少一个概念，代价是一次跨层迁移并增加越权和历史数据断链风险。隐藏 Workspace 可以先改变产品心智模型，同时保留可审计的隔离 seam。

## 后果

正面结果：

- 用户只需要理解 Project 和 Conversation；
- 新建 Project 不再依赖“用户加入哪个 Workspace”的偶然状态；
- 底层仍可复用现有隔离、授权、对象存储和 Worker 校验；
- 未来若恢复团队协作，可以在不重写数据边界的情况下增加 Workspace/成员产品能力。

需要承担的约束：

- `Workspace` 仍会出现在内部类型、API 路径、数据库和日志中，但不得出现在用户可见文案中；
- 当前实现不自动迁移已经属于历史共享 Workspace 的用户。此类数据需要单独的迁移脚本，按用户、Project 和审计关系拆分后才能达到完全私有化；
- 兼容期内不能把“已有任意 Workspace Member”直接提升为新的个人 owner，否则可能意外扩大其对历史 Project 的访问范围。

## 验收标准

- 新用户首次访问 Project 列表时自动拥有一个私有 Workspace；
- 同一用户创建的 Project 归入该私有 Workspace，另一用户不能通过 Project API 读取；
- Web 工作台和插件页面不显示 Workspace 名称、Workspace 切换或成员管理；
- 现有 Workspace/Project/Conversation/对象存储路径和 Worker 访问校验继续有效；
- 历史共享 Workspace 的迁移状态被明确记录，不伪装成已经完成私有化。
