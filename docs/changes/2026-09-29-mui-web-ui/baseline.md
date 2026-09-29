# Material UI 全站组件规范化：实施基线

- 变更编号：CHG-2026-09-29-mui-web-ui
- 状态：IMPLEMENTING
- 时间：2026-09-29

## 冻结的代码与归属

产品主工作树位于 `D:\front\newProject\LangReport`，基线 HEAD 为 `75e83b09da02b47727accd5071f9dad16a7569eb`，分支为 `main`。该树存在此前任务的 API、文档、登录、工作台和 E2E 未提交修改；UI 任务不在主树实施，也不修改或清理其中的文件。记忆系统 A/GA 位于独立候选 `D:\front\newProject\LangReport-A-GA-2026-09-28-candidate`，HEAD `efb273a3e1cb63559e179658454110221d813201`；本任务不触碰该分支。

本任务创建 `D:\front\newProject\LangReport-MUI-2026-09-29`，分支 `codex/langreport-mui-web-ui-20260929`，从同一 HEAD 分出。将主树中与 UI 直接相关的五个既有修改原样复制过来，以下 SHA256 在两个工作树逐项相同：

| 文件                                          | SHA256                                                             | 原归属                              |
| --------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| `apps/web/app/(protected)/page.tsx`           | `CB0A4BF6858E95804FB4A6C58900024D7FBC426EFAE8AC8BEBCD970593190AA2` | 既有工作台修订，不属于本次 MUI 新增 |
| `apps/web/app/login/page.tsx`                 | `5BC562C7A980E4E55F65130846881C74AF9AAF3AA3F7302F7E7A468C1012F6ED` | 既有登录页修订                      |
| `apps/web/app/login/login.module.css`         | `14AC89D17E3B2069E180F52B8C05CDFC26C71BA477C7FB4E2671365D610FDE82` | 既有登录页样式修订                  |
| `apps/web/test/e2e/login.spec.ts`             | `1CB81F16EEC9FE0B1EE534626BD81C5836D37C8569F8FD7F3F08B1B088F3BF5F` | 既有登录回归测试修订                |
| `apps/web/test/e2e/consulting-report.spec.ts` | `80BA3DEC6AE7B98BCB46492B4493435B5F478E56C93334FCC4461F6D3A0084BE` | 既有工作台回归测试修订              |

审核时形成的本变更目录及 ADR-0030 也复制到隔离工作树，用户批准后才改为实施状态。未复制主树中的其他 API、记忆、部署或架构文件。本工作树之后的 UI diff 必须基于上述既有差异复核，不能把复制带入的修改误写为 MUI 产出。
