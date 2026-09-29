# Material UI 全站组件规范化：Proposal

- 变更编号：`CHG-2026-09-29-mui-web-ui`
- 状态：`VERIFYING`（用户于 2026-09-29 明确回复“审批通过”；实现、自动化回归、独立复核与性能对照完成）
- 创建时间：2026-09-29
- 更新时间：2026-09-29

## 背景与问题

`apps/web` 当前依赖 Next.js 16、React 19 和 React Query，没有通用 UI 组件库。工作台、登录、账号、记忆、插件和 API Console 分别维护按钮、字段、弹层和状态样式。同为主按钮，工作台使用 44px 高、12px 圆角和橙色；记忆页使用 42px 高、8px 圆角；API Console 使用深色胶囊形状。记忆删除还调用 `window.confirm`。这些差异使视觉和操作反馈无法由一个规范控制。

用户在 2026-09-29 选择“整套引入 MUI 等带样式库”。本提案将该选择具体化为 **Material UI（MUI Core）v9 作为 Web 通用组件体系**，并以现有 [DESIGN.md](../../../DESIGN.md) 的暖色工作台规范配置主题。MUI 默认 Material 视觉不自动取代现有产品视觉规范；如需改变视觉方向，需单独修订 `DESIGN.md`。

## 目标用户与场景

咨询顾问、研究分析师和 Reviewer 在创建 Project、准备 Data Snapshot、补充 Analysis Brief、生成与审核 Evidence Block 时，看到一致的表单、按钮、菜单、弹层与反馈状态。账号、记忆、插件和 API Console 使用相同的基本控件与交互语言。

## 需求范围

| ID  | 用户可验收结果                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------- |
| R1  | 登录、工作台、账号、记忆、插件和 API Console 的通用可见控件统一使用 MUI 组件及项目主题；例外有逐项清单和原因。          |
| R2  | 主/次/危险操作、输入、状态、弹层在各页面使用 `DESIGN.md` 的颜色、字级、尺寸和圆角；桌面与移动端一致。                   |
| R3  | 菜单、确认操作和表单具备清晰的 hover、active、focus、disabled、pending、success、error 状态；键盘和触屏操作可完成。     |
| R4  | Project、Data Snapshot、Analysis Brief、Generation Cycle、Chart Revision、Review 和导出的现有行为与服务端合同保持一致。 |
| R5  | Next.js App Router 服务端渲染与客户端导航无样式闪烁、hydration 错误或弹层层级回归。                                     |

### 本次交付边界

- 覆盖 `apps/web` 所有现有路由及其中的通用可见控件，含工作台对话框、右侧预览、审核面板与移动端操作入口。
- 建立一个 MUI `ThemeProvider`、主题映射、组件级默认样式和迁移清单；统一图标来源与尺寸规则。
- 保留 Evidence 画布、交互图表及可调整宽度的双抽屉等产品特有组合；内部通用控件迁入 MUI。完整组件映射见 [design.md](./design.md)。

### 后续范围

- 新增页面默认使用本次建立的 MUI 主题和通用组件规则。
- 未来如需 MUI X Data Grid、Charts、Date Pickers 或商用组件，按具体业务需求单独评估能力、体积和许可。

## 明确不做

- 不改变 API、数据库、授权、记忆、生成、Revision 或 Review 业务规则。
- 不将 Project `Visual Template`、插件 `Theme` 与 Web 工作台 MUI 主题合并；前者仍只控制可追溯的图表输出。
- 不改写 Flint SVG/PNG/静态 HTML 渲染器、Approved Revision 或历史导出。
- 不在本变更中切换到 MUI 默认蓝色、Roboto 或 Material 页面信息架构。

## 成功指标与验收概要

1. 六类页面的组件盘点完成，所有可替换的可见通用控件有 MUI 映射；留存自定义控件仅用于业务特有布局、图表或文件输入等有记录的场景。
2. 移除页面级重复主/次按钮、输入与确认弹层规则；主题为唯一的通用控件视觉配置入口。
3. 1440、1024、760、390px 下检查层级、溢出、44px 触控目标、48px 输入、高对比度以及加载、空态、失败、审核只读状态。
4. 键盘可打开/关闭菜单与弹层、在弹层内导航并回到触发点；删除、保存与生成在等待服务端时阻止重复提交并显示结果。
5. Web 类型检查、适用的离线测试、现有 E2E 和样式/键盘新增回归通过；业务请求和 Revision 绑定保持不变。

## 假设、依赖与风险

- 视觉默认以现有 `DESIGN.md` 为准；用户本轮确认的是组件库路线，未要求改变品牌方向。
- 官方 [版本页](https://mui.com/material-ui/getting-started/versions/) 将 v9 标为稳定版；[安装说明](https://mui.com/material-ui/getting-started/installation/) 支持 React 19。实际安装时固定兼容版本并核对锁文件。
- [Next.js 集成说明](https://mui.com/material-ui/integrations/nextjs/)要求 App Router 样式缓存，并建议 CSS Modules 共存时使用 CSS layer。MUI [官方源码目录](https://github.com/mui/material-ui/tree/master/packages/mui-material-nextjs/src)已有 `v16-appRouter`，但锁定版本的包导出及本项目 SSR 表现仍须在首个实施任务中实测。
- 主工作树有登录/工作台等未提交修改，记忆 A/GA 在独立候选分支；实施快照必须先确认并保护两者，不覆盖、不混入无关提交。
- MUI 依赖、样式注入顺序和组件替换可能增加客户端体积或改变焦点与布局；按页面切片迁移并记录回退点。

## 审核点

用户于 2026-09-29 回复“审批通过”，批准本目录的完整 MUI 全站迁移设计、任务与测试计划。保留现有暖色 `DESIGN.md` 作为视觉规范；实施与验收结果继续记录在本目录。
