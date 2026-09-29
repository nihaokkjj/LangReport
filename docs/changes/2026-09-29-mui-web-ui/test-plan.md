# Material UI 全站组件规范化：Test Plan

- 变更编号：`CHG-2026-09-29-mui-web-ui`
- 状态：`VERIFYING`（自动化验证、独立复核与性能对照完成，人工视觉验收待记录）
- 创建时间：2026-09-29
- 更新时间：2026-09-29

## 范围与环境

在固定 LangReport 代码快照上验证 `apps/web` 的 MUI 集成和六类现有页面。E2E 使用仓库 `apps/web/playwright.config.ts` 的 Chromium 1440×900、1024×900、760×900、390×844 四项目；使用已有 mock/合成数据，不接触生产或真实用户数据。验证记录需写出实际 commit 或文件散列、MUI/Next/React 包版本、命令、退出码与截图/trace 路径。

## 风险到测试映射

| ID    | 风险                                   | 场景与方法                                                                                                 | 通过条件                                                                       |
| ----- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| TP-01 | App Router 首屏无样式或 hydration 错误 | 直接打开登录、工作台、账号、插件、API Console，再客户端跳转与刷新；检查控制台/截图                         | 无 hydration/Emotion 样式错误、蓝色/Roboto 闪烁或弹层被页面遮挡                |
| TP-02 | MUI 主题与旧 CSS 争夺优先级            | 六类页面抽样主/次/危险按钮、TextField、Menu、Dialog、Alert，四视口量测                                     | `DESIGN.md` 色彩/字级/圆角/高度/焦点统一；无 `!important` 修补链               |
| TP-03 | 菜单/弹层键盘与焦点回归                | Tab、Shift+Tab、Enter、Space、方向键、Esc；Project/Conversation 选择、删除确认、编辑/审核 Dialog           | 可完成、可取消、焦点回到合理触发点，背景不可误操作                             |
| TP-04 | 异步重复提交与反馈不明确               | 慢响应/失败/冲突模拟登录、记忆删除、Brief 保存、生成、Review、插件开关                                     | pending 可见且操作不可重复；失败保留输入/状态并给可恢复错误；成功反馈准确      |
| TP-05 | 触控、溢出和减少动画                   | 四视口核对长中文、ID、数据表、菜单、抽屉、弹层；模拟 reduced motion                                        | 44px 可触控目标、48px 输入、无不可达控件/水平裁切，动画不是必要信息            |
| TP-06 | 现有业务链路受组件替换影响             | 运行现有 `login`、`account`、`memory-management`、`consulting-report`、`api-console` E2E，并补插件关键路径 | Project→Data Snapshot→Brief→Evidence→Review→导出及账号/记忆/插件行为与基线一致 |
| TP-07 | Approved Revision、权限/版本冲突误表现 | 模拟只读 Revision、401/403、记忆 CAS 冲突、生成失败和导出失败                                              | UI 正确阻止或解释操作；服务端原合同与失败语义不变                              |
| TP-08 | 组件与依赖迁移不完整                   | 静态盘点所有页面可见按钮、输入、选择器、确认框、弹层、反馈和图标                                           | 通用控件有 MUI 映射；业务专用例外有理由；无原生 `window.confirm`               |
| TP-09 | 包体积/渲染开销明显恶化                | 对比同一生产构建的主要路由产物和首屏交互观察                                                               | 记录量化差异及原因；严重性能退化在验收前修复或调整加载边界                     |

## 自动化命令

- `pnpm --filter @langreport/web typecheck`
- `pnpm --filter @langreport/web test:typecheck`
- `pnpm --filter @langreport/web test`
- `pnpm --filter @langreport/web test:e2e`
- `pnpm --filter @langreport/web build`（核实 `apps/web/package.json` 已声明）
- `pnpm docs:check`、适用的 `pnpm format:check`/`pnpm lint`、`git diff --check`

新增自动化只覆盖迁移引入的真实风险：组件交互、状态、SSR 和关键业务回归；不编写镜像实现的测试。若基线存在无关失败，保留原始输出并按固定快照归因，不把全仓失败改写为通过。

## 人工验收

1. 对六类页面的默认、hover、active、focus、disabled、pending、success、error、empty 和长内容状态在桌面/移动端审阅截图。
2. 仅用键盘完成 Project 选择、创建 Project、打开/取消/确认记忆删除、Brief 保存与 Review 操作。
3. 用触控模拟检查底部 sheet、右侧预览、Dialog、表单和文件选择入口；检查 44px/48px 规则。
4. 对比同一 `DESIGN.md` 标准下工作台、记忆页和 API Console 主按钮及表单，确认没有旧页局部外观残留。

## 边界与报告

真实 HTTPS、生产登录限速、生产数据、真实模型与数据库恢复属于其他变更；本计划不重判这些结果。独立验证角色从冻结 worktree/快照只读执行，写出 `test-report.md`；用户最终验收与失败项写入 [acceptance.md](./acceptance.md)。
