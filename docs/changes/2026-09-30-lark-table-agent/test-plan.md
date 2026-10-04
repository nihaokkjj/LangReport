# 测试计划

- 变更编号：LANGREPORT-2026-09-30-lark-table-agent
- 状态：VERIFYING
- 创建时间：2026-09-30
- 更新时间：2026-10-01

| 风险 | 验证 |
| --- | --- |
| 默认账号串用、任意 CLI 执行 | actor/workspace/profile/open_id 校验，白名单与 shell=false |
| 表头错位、同名列覆盖、Sheet 错选 | 模拟多表与标题行；位置映射；已检查 sheet 限制 |
| 截断被当成功、并发编辑 | 顶层/子表截断、range/数据数量与 revision 不一致拒绝 |
| 模型读取整表、无限循环 | 工具观察上限、决策次数和总截止时间 |
| 重启重复导入、旧版本被覆盖 | 原子领取、过期失败、提交条件、失败不改旧快照 |
| API 内存峰值 | 流式上传和 S3 流式写入，50 MB 截断清理 |
| 图表忽略真实字段 | sum/avg 共存时必须用模型选择，未知字段失败 |
| 外部依赖污染离线测试 | 测试保护开关；所有远端依赖 stub |

自动化：相关 workspace unit/typecheck、仓库 offline tests、boundary/docs/migration 检查。外部验收：用户完成专用飞书 profile 授权后，上传含标题行/两个 sheet 的小文件，核对实际列、行数、Agent 记录与生成图；未执行前不得标记真实飞书已通过。
