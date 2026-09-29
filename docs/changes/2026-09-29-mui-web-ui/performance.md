# Material UI 全站组件规范化：TP-09 性能对照

- 日期：2026-09-29
- 口径：Windows 11，同机 Next.js 16.3.3 / React 19.2.8 / Chromium；两版均运行 `pnpm --filter @langreport/web build`。
- 迁移前：HEAD `75e83b09da02b47727accd5071f9dad16a7569eb`，叠加 [baseline.md](./baseline.md) 冻结的五个既有 UI/E2E 修改；原锁文件离线安装。
- 迁移后：工作树 `codex/langreport-mui-web-ui-20260929`；MUI 9.4.0、Emotion 与 Next.js App Router 缓存。

## 生产构建产物

从每个路由的 Next.js client-reference manifest 取得客户端模块引用，与 route build manifest 的 root scripts 去重。以下 gzip 为逐文件 level 9 压缩后求和，**代表路由引用脚本集合，不等于首次导航实际传输量**；浏览器缓存、动态执行路径及服务器 Brotli 均未计入。计算方法见 [measure-build.mjs](./measure-build.mjs)，原始记录见 [build-baseline.json](./evidence/build-baseline.json) 与 [build-mui.json](./evidence/build-mui.json)。

| 范围                    | 迁移前 gzip | MUI 版 gzip |                 增量 |
| ----------------------- | ----------: | ----------: | -------------------: |
| 全部静态 JS chunk       |   251,294 B |   353,619 B | +102,325 B（+40.7%） |
| 全部静态 CSS chunk      |    21,434 B |    18,725 B |   −2,709 B（−12.6%） |
| 登录路由引用 JS         |   144,411 B |   221,386 B |  +76,975 B（+53.3%） |
| 工作台路由引用 JS       |   174,093 B |   261,341 B |  +87,248 B（+50.1%） |
| 账号路由引用 JS         |   151,746 B |   228,801 B |  +77,055 B（+50.8%） |
| 记忆路由引用 JS         |   155,203 B |   236,826 B |  +81,623 B（+52.6%） |
| 插件路由引用 JS         |   151,812 B |   233,574 B |  +81,762 B（+53.9%） |
| API Console 路由引用 JS |   158,556 B |   239,098 B |  +80,542 B（+50.8%） |

各路由共同增加了 MUI、Emotion、图标和样式运行时；选用全套带样式组件库使共享脚本变大。这个增量明显，应作为正式发布的性能成本审阅；目前未设置量化包体积预算。

## 本地登录首屏与首次输入

两个生产服务分别监听本机 3100/3101，Playwright Chromium 1440×900 交错运行；每版 2 次预热、5 次记录。以下为记录样本中位数。输入账号、密码后两版均可编辑，5/5 无 `pageerror`。脚本与完整样本见 [measure-login.mjs](./measure-login.mjs) 和 [login-performance.json](./evidence/login-performance.json)。

| 指标                   |     迁移前 |     MUI 版 |     差异 |
| ---------------------- | ---------: | ---------: | -------: |
| DOMContentLoaded       |    28.0 ms |    39.5 ms | +11.5 ms |
| load                   |    75.7 ms |    98.9 ms | +23.2 ms |
| First Contentful Paint |      40 ms |      52 ms |   +12 ms |
| 首次账号/密码输入      | 5/5 可操作 | 5/5 可操作 | 未见阻塞 |

本地低延迟样本没有观察到严重首屏或首次输入退化；12 ms 的 FCP 差异不应直接外推到线上网络、低端设备或缓存冷启动。正式发布前仍应在目标部署环境记录 Web Vitals 和真实路由流量；若有既定体积预算或发现低端设备交互退化，需据此调整加载边界。
