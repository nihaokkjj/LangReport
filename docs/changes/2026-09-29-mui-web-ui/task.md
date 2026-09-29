# Material UI 全站组件规范化：Task

- 变更编号：`CHG-2026-09-29-mui-web-ui`
- 状态：`VERIFYING`（实现、自动化回归、独立复核和性能对照完成，用户视觉验收待记录）
- 创建时间：2026-09-29
- 更新时间：2026-09-29

## 执行前提

- 规模：L（跨全部 Web 路由、共享主题与核心交互）；用户已选 Material UI 带样式库路线，并于 2026-09-29 明确批准 [proposal.md](./proposal.md)、[design.md](./design.md)、本任务和 [test-plan.md](./test-plan.md)，允许进入 Web 源码实施。
- `DESIGN.md` 继续约束暖色主题。`Project Visual Template` 与插件 `Theme` 仍独立于 Web Chrome。
- 首个源码改动前，固定可追溯的目标分支和工作树快照，保护当前主工作树登录/工作台的未提交修改与已推送的 A/GA 候选。
- 每个 UI 切片只调整展示与交互容器，保留现有 API、Query key、授权与业务状态；调整接口时必须另行满足 `api-console` 同步规则。

## 任务清单

| ID  | 任务                                                                                                       | 依赖     | 状态   | 完成标准与证据                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------- | -------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| T0  | 冻结实施基线，记录主工作树、A/GA 候选及相关 UI diff 的归属；在隔离工作树准备迁移快照                       | 设计审核 | 已完成 | [baseline.md](./baseline.md)：基线 SHA、文件归属、无覆盖/丢失的比对清单                                              |
| T1  | 盘点六类页面的可见通用控件、状态、业务例外和旧 CSS 规则                                                    | T0       | 已完成 | [inventory.md](./inventory.md)：160 个原生控件、6 个旧 Dialog 与 2 个原生确认框                                      |
| T2  | 安装并锁定兼容的 MUI Core v9、图标、Emotion 与 Next.js 集成包；创建 ThemeProvider、CSS 变量和 SSR 技术切片 | T0、T1   | 已完成 | MUI 9.4.0、Next 16 集成；生产 build 和四视口 E2E 无 hydration/MUI 告警                                               |
| T3  | 迁移登录、账号和记忆页通用控件；以受控 Dialog 替换删除 `window.confirm`                                    | T2       | 已完成 | 登录、账号、记忆 E2E；删除 Dialog 取消、Esc、确认均通过                                                              |
| T4  | 迁移工作台及 Project/Conversation、Brief、Metric、编辑、Review、Snapshot 预览中的通用控件                  | T2       | 已完成 | Project→Snapshot→Brief→Evidence→Review→导出与编辑 Patch 四视口通过；预览留在右抽屉                                   |
| T5  | 迁移插件页面通用控件和反馈                                                                                 | T2       | 已完成 | 插件安装、启停、Manifest 校验、显式主题选择四视口 E2E 通过                                                           |
| T6  | 迁移 API Console 通用控件、状态与表单                                                                      | T2       | 已完成 | 请求输入/响应、401 留在响应面板、敏感信息脱敏四视口 E2E 通过                                                         |
| T7  | 删除已迁移页面的重复通用 CSS；核对主题、图标、状态、四视口和例外清单                                       | T3–T6    | 已完成 | 原生通用控件与 `window.confirm` 静态扫描为零；24 张截图和色彩/焦点规则复核                                           |
| T8  | 固定代码快照并执行独立回归、人工视觉/键盘验收，更新报告与交接                                              | T7       | 验证中 | E2E 60 通过/4 环境跳过、unit 24 通过、build/typecheck、独立复核与 TP-09 同基线对照完成；用户视觉/键盘/触屏验收待记录 |

T3–T6 可以在 T2 成功后按不重叠文件顺序推进；共同的主题、布局与全局 CSS 由一个负责人串行修改。T8 独立验证在冻结快照上进行，不与业务源码并发写入。

## 执行门与停止条件

1. **G0 设计审核**：明确批准完整 MUI 迁移方案和保留暖色 `DESIGN.md` 的视觉假设；未通过时仅修订文档。
2. **G1 技术集成**：T2 证明 MUI v9、Next.js 16 和 React 19 的依赖、App Router 缓存、CSS layer 与 hydration 可用；失败则停下修订设计，不扩大页面迁移。
3. **G2 逐页验收**：每片迁移后运行 Web typecheck、对应 E2E 与桌面/移动状态检查，失败先修复或回退该切片。
4. **G3 全站验收**：T7–T8 的控件清单、业务回归、独立证据和用户视觉验收完成后才写 `ACCEPTED`。

## 验证入口

命令均以仓库脚本为准：`pnpm --filter @langreport/web typecheck`、`pnpm --filter @langreport/web test:typecheck`、`pnpm --filter @langreport/web test`、`pnpm --filter @langreport/web test:e2e`、`pnpm docs:check`。样式变更还需 1440/1024/760/390px 截图和键盘操作记录。最终按变更文件范围运行适用的 format/lint 与 `git diff --check`。真实 HTTPS/生产行为不由本 UI 变更宣称通过。

## 回滚与 Definition of Done

依赖与 provider 集成、各页面迁移、旧 CSS 清理分片留痕。单片失败先恢复该片的 JSX/CSS；全局集成失败回退主题/provider/依赖，保留业务请求和数据。完成定义：R1–R5 的证据齐全、没有关键 UI/业务回归、`DESIGN.md` 与实现一致、独立验证及用户最终验收记录完成。未授权前不修改 Web 业务源码、不提交或推送此变更。
