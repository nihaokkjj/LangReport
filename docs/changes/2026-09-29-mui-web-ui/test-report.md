# Material UI 全站组件规范化：独立验证报告

- 变更编号：`CHG-2026-09-29-mui-web-ui`
- 验证角色：独立验证 Agent（只读审查产品源码；仅写本报告）
- 记录时间：2026-09-29
- 结论：**源码迁移、自动化回归与 TP-09 数据计算通过独立复核，整体仍为 VERIFYING**。24 张四视口截图已留存并抽查；用户视觉/键盘/触屏验收及正式发布的性能成本审阅仍待完成，不应标记 `ACCEPTED`。

## 快照与方法

审查工作树：`D:\front\newProject\LangReport-MUI-2026-09-29`；分支 `codex/langreport-mui-web-ui-20260929`；HEAD `75e83b09da02b47727accd5071f9dad16a7569eb`。主工作树已有五个 UI/E2E 未提交文件被原样复制到本工作树，归属见 [baseline.md](./baseline.md)。初查 tracked diff blob 为 `1baa8275bc65cf4ae37a4d40a1e90627033a7350`；**最终冻结复核**的 `git diff --binary | git hash-object --stdin` 为 `03fbdb7bc4e78945f14644c7e60231b78a12084b`。该 Git 散列不包含未追踪文件，最终关键 SHA256 如下：

| 文件                                   | SHA256                                                             |
| -------------------------------------- | ------------------------------------------------------------------ |
| `apps/web/theme/theme.ts`              | `72ADE6DE3C1F1155F081CEF68A6AE3F1011B22DBEA3ADEE53D481B917C65980E` |
| `apps/web/app/ui-provider.tsx`         | `27BED4104E642E9FBCF2493184AA9ED2923064834DE179784D8BEF03209E89EC` |
| `apps/web/app/layout.tsx`              | `A20274858F132379DE26C93997D2C473759C395C972F9A9A0EF80FBA71512CF4` |
| `apps/web/package.json`                | `040F213506BE7392C13EE95B6062141D088C96BEB4CA7EEEA83159980F8FB14C` |
| `pnpm-lock.yaml`                       | `DE5BAF646FA1DA4A86771E32F10B359A44617EC8D1FCC5F8A489114257C751C9` |
| `apps/web/test/e2e/plugins.spec.ts`    | `0072EEA7E05C96DC92A127B87CE4E77A5B30067986520E7C17C75649C6824D9F` |
| `apps/web/test/e2e/visual-evidence.ts` | `41FB1CC6856371E7BEB52BAFFDACDC63857ED52E1CB95B64D2F19A85EB3BCA6E` |
| `evidence/e2e-final.txt`               | `53A203F3EAA496080BBFBC82BC49F768DB8431F90E6297CCCA063A48982C23C9` |

`pnpm --filter @langreport/web list @mui/material @mui/material-nextjs @mui/icons-material next react --depth 0`：MUI 三包均 `9.4.0`，Next `16.3.3`，React `19.2.8`。`layout.tsx` 使用 `@mui/material-nextjs/v16-appRouter` 的 `AppRouterCacheProvider`，开启 `enableCssLayer`，再包 `UiProvider` 和现有 `QueryProvider`。Theme 映射了暖色主色 `#ff4f00`、咖啡色文字 `#201515`、44px Button/IconButton 和 48px OutlinedInput。

## 独立执行的检查

| 检查                                           | 实际结果                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @langreport/web typecheck`      | exit 0；输出 `$ tsc --noEmit -p tsconfig.json`，无诊断                                                                                                                                                                                                                |
| `pnpm --filter @langreport/web test:typecheck` | exit 0；输出 `$ tsc --noEmit -p tsconfig.test.json`，无诊断                                                                                                                                                                                                           |
| `pnpm docs:check`                              | exit 0；输出 `docs:check passed.`                                                                                                                                                                                                                                     |
| `git diff --check`                             | exit 0；无空白错误                                                                                                                                                                                                                                                    |
| 静态控件扫描                                   | `rg` 扫描 Web TSX，只命中 4 个原生 `<input>`，均为文件选择入口（Data Asset 2、插件 1、API Console 1）；未命中原生 button、select、textarea、旧 dialog 或 `window.confirm`                                                                                             |
| Playwright 配置与日志抽查                      | 1440×900、1024×900、760×900、390×844 四项目存在；[e2e-final.txt](./evidence/e2e-final.txt) 原始列表为 64 个测试，`60 passed / 4 skipped`，无失败。4 个 skip 均为需真实 HTTPS 后端的 `auth-live` 用例                                                                  |
| 截图抽查                                       | [evidence](./evidence/) 下六类页面各四张 PNG，共 24 张；查看登录、账号、记忆、插件、API Console 与工作台的桌面/390px 截图，页面主体可读、未见整页横向裁切。截图来自开发服务器，有 Next 开发标记；只覆盖所拍状态，不代表所有 hover/focus/disabled/error 状态已人工通过 |

主实施 Agent 报告 Web unit `24 passed` 和生产 `build` 通过；这两项未在本独立角色重复执行，按实施方结果记录。`docs:check` 已独立运行通过；最终 E2E 的 `60 passed / 4 skipped` 已通过原始日志独立核对。历史 [capture.txt](./evidence/capture.txt) 是 17:42 的失败回放：登录页截图前误断言空表单的按钮应启用，四视口因此失败；登录截图写入时间为 19:06–19:08，与最终 E2E 阶段一致，该历史失败不应被误当作最终结果，也不应删除其记录。

## 风险项复核

| 计划项                                | 独立观察                                                                                                                                                                                                                                                                                                                                                                                                                  | 判定                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| TP-01 / R5 SSR 与 hydration           | `layout.tsx` 的 Next.js 16 缓存入口、CSS layer 和主题顺序保持正确；生产 build 由实施方报告通过。最终 E2E 日志未出现 hydration/MUI 告警，24 张首屏/页面截图有内容；但没有六类页面逐路由 `console`/`pageerror` 监听及客户端导航刷新记录，不能把“日志无字符串”提升为完整 hydration 证明                                                                                                                                      | 自动化抽查通过，人工/逐路由证据待补          |
| TP-02 / R2 主题统一                   | 主题色、字体、44px Button/IconButton、48px OutlinedInput 与圆角符合静态抽查；MUI OutlinedInput 已补 2px 橙色、3px offset 焦点环，记忆页支持字改为 15px；账号/记忆/API Console 未定义的 `--body`/`--body-mid` 与旧 API Console 按钮 CSS 已清理。六页四视口截图抽查主体可读，具体对比度与触控尺寸尚无全状态量测                                                                                                             | 代码问题已修；最终视觉量测待用户验收         |
| TP-03 / R3 菜单与弹层                 | Project/Conversation 使用 MUI Menu，业务弹层使用 Dialog；记忆 E2E 验证取消、Esc 后不发 DELETE，再确认删除；指标保存期间 Esc 不关闭的 E2E 四视口通过。Project/Conversation、Brief、Review 的仅键盘完成、方向键和焦点回返尚无完整记录                                                                                                                                                                                       | 部分通过                                     |
| TP-04 / R3 异步反馈                   | Metric 新增 `isSavingMetric`、按钮禁用及保存中不可关闭，慢响应 E2E 验证只发一次 POST；ProjectCreateDialog 和 AnalysisBriefForm 在保存中也禁用关闭按钮并拦截 Dialog 的 Esc/onClose，已静态核对但未单独测；记忆删除与插件操作继续有 pending 禁用。更多失败/冲突组合仍需交互验收                                                                                                                                             | 关键重复提交风险已修；Project/Brief 待单独测 |
| TP-05 / R2/R3 四视口与 reduced motion | 六页各 1440/1024/760/390px 截图共 24 张，抽查未见整页横向裁切；E2E 覆盖四 viewport 的关键业务路径。截图未囊括所有 hover/active/focus/disabled/pending/error/长内容状态，44px/48px 全页面量测、触屏和 reduced motion 实际操作未完成                                                                                                                                                                                        | 默认态证据齐，完整人工验收待做               |
| TP-06 / R4 业务链路                   | 最终 E2E 60 通过/4 条真实 HTTPS 环境跳过；新增插件用例在四视口验证安装、启停、Manifest 校验和显式 ThemeRef 请求。Project→Snapshot→Brief→Evidence→Review→导出及 API Console 401/脱敏均列于通过日志                                                                                                                                                                                                                         | 模拟环境路径通过                             |
| TP-07 / R4 权限/版本                  | E2E 覆盖 API Console 401、记忆版本/冲突、固定 Revision 导出与审核；未独立证实 403、Approved 只读、生成/导出失败的所有排列组合，真实 HTTPS auth-live 四视口因环境跳过                                                                                                                                                                                                                                                      | 部分通过，边界保留                           |
| TP-08 / R1 组件迁移                   | 静态扫描无原生 button/select/textarea、旧 dialog 或 `window.confirm`；四处原生 input 均为文件选择。Snapshot 预览仍为右抽屉 `Paper role=region`；通用下拉图标现由 MUI ExpandMore 提供。品牌/图表 SVG 留作业务图形                                                                                                                                                                                                          | 静态范围通过                                 |
| TP-09 性能                            | [performance.md](./performance.md) 使用同一脚本比较两版生产构建和本地登录页面：全站静态 JS gzip +102,325 B（+40.7%），登录路由引用 JS gzip +76,975 B（+53.3%），其余路由约 +50–54%；登录 FCP 中位数 40→52 ms。独立复算 8 项体积增量/百分比及 2×5 个正式样本的三个中位数均匹配原始 JSON，当前 `.next` 重算与 MUI JSON 一致。脚本集合非实际传输量；输入只测 load 后可填写，未测响应延迟；基线 JSON 未嵌入源码或构建命令散列 | 量化对照完成；体积成本待发布审阅             |

### TP-09 原始证据核对

`measure-build.mjs` 对每个路由的 Next.js client-reference manifest 与 root scripts 去重，再对引用的 JS 单文件 gzip 求和；`build-baseline.json` 与 `build-mui.json` 均包含六个目标路由及全站 JS/CSS 统计。MUI 当前生产构建重新执行该脚本所得数据与 MUI JSON 逐项相同。两版 JS 全量为 251,294→353,619 B gzip，CSS 全量为 21,434→18,725 B gzip；报告的绝对差及百分比计算正确。CSS chunk 减少只描述静态 CSS 文件，不能据此推断含 Emotion 运行时样式的总 CSS 成本下降。

`measure-login.mjs` 在同一 Chromium 配置下交错访问两个本地生产服务，每版先预热 2 次、记录 5 次；原始 `login-performance.json` 中两版正式样本均为 5/5 FCP 有值、5/5 字段可填写、0 `pageerror`。独立排序后，DOMContentLoaded 中位数 28.0→39.5 ms、load 75.7→98.9 ms、FCP 40→52 ms，与 [performance.md](./performance.md) 一致。样本只覆盖本机 1440×900 登录页；没有网络传输、低端设备、交互延迟或真实路由流量数据。基线文件归属由 `performance.md` 和 [baseline.md](./baseline.md) 说明，三个 JSON 本身未包含源文件散列，独立角色不能仅靠 JSON 证明基线构建的源码来源。

## 交接边界

[task.md](./task.md) 的 T2–T7 已标完成，T8 为“验证中”；[handoff.md](./handoff.md) 和 [acceptance.md](./acceptance.md) 均为 VERIFYING。TP-09 的同口径本地对照已经完成，显示明确的包体积成本；发布前应按目标网络和设备审阅该成本。用户视觉/键盘/触屏验收仍待记录，因此不应写 `ACCEPTED`。独立角色不批准 scope，也不替代用户验收。真实 HTTPS、生产数据、模型和数据库行为不属于本次模拟验证。

本报告只证明上述最终快照和抽查范围。若源码、测试或视觉证据继续修改，需重新计算散列并复核受影响项。
