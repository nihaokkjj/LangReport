# ADR-0031：由受限表格 Agent 管理飞书 CLI 数据接入

- 日期：2026-09-30
- 状态：本地实现；2026-10-02 真实飞书授权与数据接入验证通过
- 授权：用户明确要求配置并集成 lark-cli，由 Agent 管理表格读取。

## 决策

CSV/Excel 的可选飞书模式使用 API 流式接收、Postgres 持久化 intake job、Worker 内受限工具 Agent 和不可变 Snapshot。表格工具只开放新建导入、工作簿/版本/类型化读取，不把完整 CLI、shell、凭据或整张表交给模型。Agent 负责选择已观察的 sheet、表头与范围；程序负责完整性、版本、权限、类型与状态提交。

接入任务发生在 Evidence Generation Cycle 之前；每个成功的 Cycle 仍只引用一个已冻结 Snapshot，不执行实时云表查询。数值统计继续由现有确定性 TransformPlan 执行。图表编译使用并校验模型明确选定的字段，禁止用第一个数值列替换。

固定 CLI 版本和结构化输出契约；显式绑定一个 LangReport 用户、Workspace、CLI profile 与飞书用户身份。不将个人默认授权共享给其他产品用户。多用户自助授权属于后续连接器设计。

## 取舍

导入飞书带来外部依赖和云空间副本，但符合用户选择。CLI 有界结果并不等于无限流式 Excel；读取截断必须失败。单次领取、截止时间和条件提交保证并发任务不会重复发布；为了避免重复远端导入，过期任务不自动重试。保留源文件和内部来源审计支持复现；真实授权前功能保持关闭。

用户已授权本轮集成范围，2026-10-02 自建应用并完成 OAuth；实际 HTTP → 后台 Worker → 飞书 → Snapshot 已验证，详见[真实验证](../changes/2026-09-30-lark-table-agent/live-verification.md)。没有声称用户单独审阅过实施后才形成的细节，也没有将代码/离线测试视为外部服务验收。

设计与验收：[本次变更](../changes/2026-09-30-lark-table-agent/design.md)；配置：[操作手册](../operations/lark-table-intake.md)。
