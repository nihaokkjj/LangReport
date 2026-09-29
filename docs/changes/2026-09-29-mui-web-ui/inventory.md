# Material UI 全站组件盘点

- 变更编号：CHG-2026-09-29-mui-web-ui
- 状态：IMPLEMENTING
- 时间：2026-09-29
- 口径：`rg -o '<(button|input|select|textarea)\b' apps/web/app apps/web/components apps/web/features -g '*.tsx'`。盘点为 JSX 词法计数，后续以代码复核实际使用。

| 页面或模块                                                     | 原生控件数 | 迁移重点                                                                                       |
| -------------------------------------------------------------- | ---------: | ---------------------------------------------------------------------------------------------- |
| 登录                                                           |          3 | 两个账号字段、提交 Button、错误 Alert、pending                                                 |
| 账号                                                           |          4 | 三个密码字段、提交 Button、错误/成功 Alert                                                     |
| 记忆                                                           |         25 | 增改删表单、Project/类别选择、历史查看、受控删除 Dialog                                        |
| 工作台主页面                                                   |         38 | 顶栏、状态和编辑表单的 Button/TextField/Select                                                 |
| 工作台辅助 rail 和 Snapshot 预览                               |          7 | IconButton、版本列表、原位预览                                                                 |
| Project/Conversation/Data/Brief/Metric/Evidence/Review feature |         49 | 选择菜单、业务 Dialog、表单、审核与导出                                                        |
| 插件                                                           |         10 | Button、选择、Manifest 多行字段、反馈                                                          |
| API Console                                                    |         22 | 请求表单、筛选、动作、响应与错误反馈                                                           |
| 反馈组件/AuthGate                                              |          2 | Alert、重试 Button                                                                             |
| **总计**                                                       |    **160** | 其中原生 file input、项目 Visual Template radio 需保留语义或经 MUI FormControlLabel/Radio 迁移 |

现有 `role="dialog"` 6 处，分布在工作台、Snapshot 预览、Project、Brief、Metric。记忆页另有两次 `window.confirm`。工作台业务弹层由 MUI Dialog 接管焦点和关闭行为；Snapshot 预览实际位于右抽屉，需保留原位查看，不改成全屏弹层。

## 控件映射与例外

- 动作统一使用 MUI Button、IconButton 和主题 variants；选择/菜单使用 MUI Select 或 Menu，原有 Project/Conversation 触发组合可用 Button + Menu 保留多行内容。
- 普通输入与多行文本使用 TextField；只为程序触发的 file input 保留隐藏原生元素，触发按钮仍用 MUI Button。项目 Visual Template 选择改用 MUI Radio/FormControlLabel，保留版本化视觉模板的业务含义。
- 页面反馈统一使用 MUI Alert；阶段状态可用 Chip。表格与图表中已有必须保留的业务结构只迁移其通用动作、字段和容器，不把 Evidence 图表改为 MUI Charts。
- 双抽屉、composer、Evidence 画布及 Snapshot 表格的专用尺寸、滚动与位置规则归产品布局 CSS 所有，不在主题中伪造。
