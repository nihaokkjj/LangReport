# Material UI 全站组件规范化：Handoff

- 变更编号：`CHG-2026-09-29-mui-web-ui`
- 状态：`VERIFYING`（实现与自动化回归完成）
- 创建时间：2026-09-29
- 更新时间：2026-09-29

## 当前状态

用户于 2026-09-29 批准全站引入 MUI 的设计。实施在隔离工作树 `D:\front\newProject\LangReport-MUI-2026-09-29`、分支 `codex/langreport-mui-web-ui-20260929` 完成，尚未提交或推送。六类页面通用控件、MUI 主题、Next.js 16 App Router 缓存和图标已迁移；主工作树和记忆 A/GA 候选未动。Snapshot 预览保持右抽屉原位阅读，API 合同和业务数据行为未改。

## 已完成与证据

- 起点 HEAD `75e83b09da02b47727accd5071f9dad16a7569eb`，既有五份 UI/E2E 修改单独归属，见 [baseline.md](./baseline.md)。最终 tracked diff blob：`03fbdb7bc4e78945f14644c7e60231b78a12084b`；未追踪文件需单独按 SHA256 校验。
- MUI 9.4.0、Next 16.3.3、React 19.2.8；通用控件静态扫描无原生 button/select/textarea、旧 dialog 或 `window.confirm`，仅保留隐藏文件 input。
- 最终四视口 E2E：60 passed、4 skipped（真实同源 HTTPS 后端条件），原始输出见 [e2e-final.log](./evidence/e2e-final.log)，无 hydration/MUI 告警。Web unit 24/24、typecheck、test:typecheck、build、docs:check、git diff --check 通过。
- `evidence/capture.log` 是中途截图脚本误把空表单的登录提交按钮预期为可用时产生的历史失败日志；测试改为等待账号输入可用后，最终完整 E2E 与四视口登录截图均通过，以 `e2e-final.log` 为准。
- 六类页面每类四视口共 24 张截图见 [截图索引](./evidence/README.md)；独立验证见 [test-report.md](./test-report.md)。全量 Prettier 检查命中 20 个本次未改的旧文件，本次改动文件已单独格式化。
- [TP-09 同基线性能对照](./performance.md)完成：全量静态 JS gzip 251,294→353,619 B；六路由引用 JS 各增加 77–87 KB gzip。本地登录 FCP 中位数 40→52 ms，首次输入 5/5 可操作、无 `pageerror`。体积代价明显，实际部署 Web Vitals 仍需观察。

## 下一步

1. 请用户审阅截图并实际验收键盘/触屏体验，在 [acceptance.md](./acceptance.md) 记录结果。
2. 用户审阅 [performance.md](./performance.md) 的包体积代价和本地首屏结果；目标部署环境发布后继续观察 Web Vitals。
3. 完成用户视觉验收后才将变更标记 `ACCEPTED`；本隔离工作树未提交、未推送。

## 当前快照与已运行验证

- 实施树基于 `75e83b09da02b47727accd5071f9dad16a7569eb`；原始主树和 A/GA 候选仍保持原归属。
- 最新自动化结果、截图、代码散列和剩余边界见上文及独立报告。

## 已知问题与边界

- 记忆系统 A/GA 仍为独立 VERIFYING 任务，B/C 未授权；其状态已存入工作区任务归档，不能由本 UI 变更代替验收。
- 真实 HTTPS、生产数据和模型链路仍属其他变更。本 UI 变更不触及 API、Flint 渲染器或 Project `Visual Template` 业务合同。
- 自动化和同基线本地性能对照不替代用户最终视觉验收或真实部署 Web Vitals。

## 新会话启动必读

[AGENTS.md](../../../AGENTS.md)、[DESIGN.md](../../../DESIGN.md)、本目录 [proposal.md](./proposal.md)、[design.md](./design.md)、[task.md](./task.md)、[test-plan.md](./test-plan.md) 与 [ADR-0030](../../adr/0030-material-ui-web-component-foundation.md)。
