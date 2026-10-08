# T11：职责整理与质量门禁

2026-10-08，基线 `a30a4391b3e54ce879f2315fd4123648014bb892` 已按用户指令推送并核对 origin/main。本轮继续下一项 T11；T10/G6 的历史 p95 异常保持 VERIFYING，不因顺序推进而关闭。T11 依赖门尚未满足，不标完整验收，不进入 T12；本轮只提交可复核的职责整理与 TP24 证据。

## 实现与职责

- API 的 Snapshot/Metric/Brief 生成前置条件查询、缺失原因和 Brief 完整性检查从 routes.ts 按原行为提取至 generation-preconditions.ts。路由保持编排职责，未改变查询顺序、排序、错误码、权限检查、身份来源或接口合同。两个 any 改为 Fastify 请求类型与实际使用字段，Conversation 内部调用显式传 headers；移除未使用导入。
- API→两类 Worker→数据库/MinIO 的联合生命周期测试归 API 测试目录：worker.integration.test.ts、t7-review.ts、t9-lifecycle.ts 和崩溃子进程夹具一起移动，修改仅为应用入口相对路径。API 已有两类 Worker 开发依赖；Worker 目录只保留自己的 memory-revocation 集成。运行器按 API原集→API联合Worker集→Worker撤销集顺序执行，仍统一创建/清理隔离资源。
- 旧 UI capture.log/e2e-final.log 改名 .txt 并更新当前 Markdown 链接，失败与成功内容均保留；[迁移清单](./evidence/t11-evidence-migration.json)记录旧/新路径和迁移前后同一 SHA-256。历史冻结清单仍记录当时路径，不改写快照来冒充新路径。旧审计两处当前链接更新并说明历史标签保留，触及文档的既有行尾空白清理。
- 没有新接口字段或业务行为，API Console 不需新增合同；现有四视口 E2E 验证其说明与交互。未改 Web 页面/样式，不进行无证据的整仓拆分或设置文件行数门槛。

## TP24 证据

| 命令/范围 | 结果 | 证据 |
| --- | --- | --- |
| pnpm typecheck | 全工作区源码与已注册测试类型通过，自然退出0 | [日志](./evidence/t11-typecheck.txt) |
| pnpm test | 273/273（测试系统合同13、workspace测试260），零失败/跳过，自然退出0 | [日志](./evidence/t11-offline.txt) |
| node scripts/test-integration.mjs | API原集14/14，迁移联合Worker集1/1，Worker撤销1/1；真实失败态浏览器2/2；自然退出0 | [日志](./evidence/t11-integration.txt) |
| pnpm build | 所有已注册build通过，含Next生产构建及静态页面生成，自然退出0 | [可读日志](./evidence/t11-build.txt)、[原字节gzip](./evidence/t11-build.txt.gz) |
| pnpm check | 原有format/lint/boundaries/hygiene/docs/commit检查串通过，自然退出0；本次提交L级另检查 | [日志](./evidence/t11-check-repaired.txt) |
| Web四视口完整E2E | 修复后完整重跑96通过、8条件跳过、零失败，自然退出0 | [最终日志](./evidence/t11-e2e-final.txt)、[首次失败](./evidence/t11-e2e.txt) |

真实集成只使用专用 PostgreSQL 54330/MinIO 9002、随机 schema/bucket 和合成用户/数据，无现用环境、飞书或真实模型调用。迁移后的联合测试继续包含T6并发/故障/失租、T7审核、T8复制回滚和T9维护恢复，不因移动而删除场景。

构建日志原字节gzip与可读副本同时保存；副本仅去行尾空白，不删除警告或失败信息。测试日志中的 schema strictTypes、NO_COLOR/FORCE_COLOR 等警告保留；通过结论来自自然退出码和测试统计。

完整E2E第一轮自然退出1：92通过、4失败、8跳过。四视口登出用例均寻找旧的独立“退出”按钮，实际页面已有“账号→退出登录”菜单。测试改为点击账号Button与退出登录MenuItem，保留所有Cookie/选择状态/取消事件/重新登录断言；[四视口定向复验](./evidence/t11-logout-repaired.txt)4/4，自然退出0。修复后完整104项重跑96通过、8条件跳过、零失败，自然退出0；不是仅以定向通过替代全量结果。

首次失败的截图与trace保存在 evidence/t11-e2e-failures；初次运行的T8/T9新截图另存 evidence/t11-e2e-captures，原历史路径已恢复HEAD（重命名后的两旧UI文本日志Git blob与旧路径完全相同，R100）。不会以重跑覆盖旧验收原件。8个条件跳过为四视口真实同源HTTPS auth-live，以及四视口仅由隔离数据库集成提供fixture的真实绘图预算失败；后者本轮集成已执行桌面/移动2项，前者未执行。

## 失败和修复过程

[模块边界基线](./evidence/t11-boundaries-before.txt)失败：Worker测试导入未声明API。试加API开发依赖后离线lock同步提示循环依赖，撤回这一方案并恢复manifest/lock内容，最终通过测试归属迁移解决；不是豁免检查器。pnpm随后的自动安装检查曾因无TTY中止，未删除node_modules；恢复原lock与manifest后全类型/build/测试正常。最终二者均无提交差异。

[hygiene基线](./evidence/t11-hygiene-before.txt)失败：旧.log路径；[改名后第一次检查](./evidence/t11-hygiene-after.txt)仍失败，因为检查索引保留旧名。暂存重命名后[检查通过](./evidence/t11-hygiene-indexed.txt)。[格式首次](./evidence/t11-format-before.txt)失败于新增迁移JSON格式，按现有Prettier修复。

[第一次全质量检查](./evidence/t11-check.txt)揭示两个移动后的文档死链；修复后[第二次](./evidence/t11-check-after.txt)揭示触及旧审计文档两行空白；[第三次](./evidence/t11-check-final.txt)揭示运行中构建日志行尾空白。构建完成后保留原字节gzip并清理可读副本，最终检查串通过。前置条件移动后的两个未使用表导入亦删除，定向ESLint通过。所有失败保留，不称初次全部通过。

## 未完成与交接

第一固定快照885文件，manifest SHA-256 `a39dfc3e422480c0acb721b60576a09afd0534167acc437bd74208c077269d19`。[独立报告](./evidence/t11-independent.md)核对全部哈希、机械提取与测试路径，无新增确定性P1/P2；边界独立通过。独立docs受快照未包含相邻控制库限制，测试合同受子进程EPERM限制；未独立重跑全仓。完整E2E与后发现的登出测试修正不在第一固定快照，[登出固定补充复核](./evidence/t11-logout-independent.md)三文件哈希一致，无新增确定性P1/P2，未独立重跑。[最终补录独立核验](./evidence/t11-final-independent.md)确认96通过/8条件跳过/零失败、四宽登出通过、历史PNG无diff和next-env既有差异保留；未独立重跑。

T10旧延迟根因未知，不能通过本轮质量绿色解释或关闭。T12固定完整闭环/用户最终接受未执行。生产旧库/对象、真实同源HTTPS登录与真实供应商环境不由本轮证明。原 next-env.d.ts 的 .next-e2e/dev 引用差异与 agent-tasks/runtime-experiment 文件保留、不提交；新成果不自动推送或部署。

最终E2E新截图保存在 evidence/t11-e2e-captures-final，历史T8/T9路径再次恢复，git diff PNG无历史修改。全仓check是仓库既有入口，其中format/lint按changed-file范围执行，不冒称全仓每个源文件均经过ESLint。

最终文档与登出测试修正后的完整质量串再次自然退出0：[最终质量日志](./evidence/t11-quality-final.txt)。本轮源码/适用检查通过，但T10依赖门未满足，T11不标完整验收。
