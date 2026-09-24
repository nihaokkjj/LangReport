## 变更摘要

<!-- 用一两句话说明用户问题、实现结果和为什么现在提交。 -->

## 变更规模与追踪

- 变更规模：
- `change-id`：`CHG-YYYY-MM-DD-short-name`（L/XL 必填）
- Aggregate / Project：
- 关联任务或文档：

## 范围

### 本次包含

-

### 明确不包含

-

## 领域和架构检查

- [ ] 我已阅读目标模块的 `AGENTS.md`、`CONTEXT.md` 和相关产品/架构文档。
- [ ] 我没有新增同义领域对象；新增术语已同步 `CONTEXT.md`。
- [ ] 我没有破坏 Workspace/Project 作用域、Snapshot/Revision 可追溯性或 Approved 不可变性。
- [ ] API 变更已同步 `apps/web/app/api-console`、OpenAPI 展示、示例和校验。
- [ ] 数据库/迁移变更已说明兼容性、回滚和 `db:verify` 结果。
- [ ] Worker、Generation、Harness、Plugin 或权限边界变更已说明不变量和失败恢复。
- [ ] UI 变更已按 `DESIGN.md` 检查桌面、移动端及加载/空/错误/审核状态。

## 验证证据

<!-- 每条命令写实际结果；失败项不能用“本地没复现”代替。 -->

| 命令或场景 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm format:check` | ☐ | |
| `pnpm lint` | ☐ | |
| `pnpm check:boundaries` | ☐ | |
| `pnpm check:hygiene` | ☐ | |
| `pnpm docs:check` | ☐ | |
| `pnpm typecheck` | ☐ | |
| `pnpm test` | ☐ | |
| `pnpm build` | ☐ | |
| 其他专项测试 / 手工场景 | ☐ | |

## 风险、迁移和回滚

- 已知风险：
- 迁移或兼容窗口：无 / 见上文
- 回滚方式：
- 未覆盖的验证：

## AI 辅助披露

- [ ] 本次变更使用了 AI 辅助；我已逐项审阅生成内容、运行验证并对结果负责。
- [ ] 本次变更未使用 AI 辅助。

## Reviewer checklist

- [ ] 范围、Aggregate、变更规模和 `change-id` 与代码一致。
- [ ] PR 没有混入构建物、凭据、真实数据或无关格式化。
- [ ] 测试、文档、API Console、迁移、验收和 handoff 已同步到实际实现。
- [ ] 未自动执行 commit、push、合并或删除他人修改。
