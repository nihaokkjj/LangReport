# 修复方案交接

- change-id：`CHG-2026-10-03-evidence-correctness-repair`
- 状态：`IMPLEMENTING`（A 批部分实施，未验收）
- 创建时间：2026-10-03
- 更新时间：2026-10-03

## 当前状态与授权

原文档阶段要求“先不要修改代码”。用户后续“jixu执行该任务”和“l继续”授权继续既有任务；A 批已进入实施，B/C 批未启动。没有提交、推送、部署或生产数据操作授权。

原 LANGREPORT-2026-09-30-lark-table-agent 仍是 VERIFYING；其完整控制文件保存在 [交接快照](../../../../agent-tasks/archive/LANGREPORT-2026-09-30-lark-table-agent-20261003-repair-docs-handoff.md)，不表示原任务验收或关闭。UI、记忆和登录验收继续沿原记录。

## 工作树与修改范围

产品路径 `D:\front\newProject\LangReport`，HEAD `1e279bc63d8300e31b839c4c45b33fdbfae0cbc4`。原有未提交/未跟踪改动覆盖飞书、UI、记忆等；实施时必须重读 git status 和原变更，不能整树清理或只检出 HEAD 丢失这些代码。

本轮实施修改 data-engine、执行快照合同、新 Job 冻结与 Worker 版本传递、上传快照内部元数据、API Console 生成场景校验及相关测试。没有修改数据库迁移或产品依赖，没有 Git commit/push。

实施前完整混合工作树：`C:\Users\sai_8\.codex\visualizations\2026\10\03\01a100b7-383f-7873-84e2-beebc5f0634b\repair-baseline`，658 个文件及哈希、tracked.patch、status.txt。独立只读复核使用同级 `repair-data-review` 快照；此快照早于 ISO 兼容修正，不能当作最终实施快照。

## 已完成与待完成

- 已实施：CSV/粘贴位置列映射、保守类型推断、超宽行拒绝；v2 排序/周期索引、重复周期拒绝、数值非法值拒绝、缺期/零基数警告；新 Job 冻结 v2，历史缺版本保持 v1。
- T1 部分完成：数据六项原始失败回归已转绿；渲染三项回归仍失败，保留失败证据。
- T2 未通过：Flint 默认隐式截断及完整高基数图形资源问题见 [实验记录](./rendering-experiment.md)；T3 未开始。
- T4 已补完整粒度：v2 计划聚合前逐行归一化日/月/季度/年；新增 periodUnit 明确日历偏移，未声明单位保持原月偏移兼容。JSON/XLSX 冲突列和合成飞书 typed-table 对照已通过；独立复核发现的样例遗漏与日内归组问题已修正并复验通过。最终全链路验收仍未执行。
- API Console 已增加新 Job 的 v2 冻结校验，尚未在真实浏览器执行该场景。类型通过不等于浏览器场景通过。
- 先前 API/Worker 包级测试未退出的问题已定位为缺少仓库离线环境；按 scripts/test-offline.mjs 环境重跑受影响五包，118 项全部通过并正常退出。细节与原始结果见 test-report。

## 下一会话

当前待决：T2五轮十万行测试峰值最高约1.10GB、Line中位11.22秒；已向用户询问保留十万绘图结果加隔离控制，或最多一万绘图结果并要求确认聚合。没有答案前不冻结阈值、不接入T3。安全守卫八类拒绝与柱形场景图验证通过，但只属隔离实验。最新六包离线136项通过；定向lint四项为基线已有未使用代码问题，仍未通过，不改检查器隐藏。

先读根 AGENTS、CONTEXT、产品规格、Loop 规范、manifest、agent-tasks/current-task，再读本目录 proposal/design/task/test-plan。继续 A 批不需要再次索取实施授权；完成 T2 的非截断配置、安全 loader、字体/交互/资源预算证据。不得直接更换产品运行时并跳过 T2 门禁。最新 T4 只读快照为基线同级 repair-t4-calendar-final（665文件），独立角色纯函数断言退出0；最新 data-engine18/generation27项及三包源码/测试类型检查通过。

任何 UI 实施前读取完整 DESIGN.md；接口改动必须同步 API Console；私有记忆不因本次来源继承扩大范围。独立验证必须使用冻结快照，按项目规则在实施后启用。
