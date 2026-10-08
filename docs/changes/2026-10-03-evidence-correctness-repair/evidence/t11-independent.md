# T11 固定工作树独立复核

2026-10-08。Verification角色，只读源码，不修改产品/控制文件，不批准范围或整体接受。

快照t11-review-fixed：885文件，manifest SHA-256 a39dfc3e422480c0acb721b60576a09afd0534167acc437bd74208c077269d19；独立逐项计算全部哈希，零失配。基线a30a4391b3e54ce879f2315fd4123648014bb892。

## 结论

本轮限定职责整理未发现新增确定性P1/P2。T10/G6根因未知和T11依赖门未闭合，不能据质量绿色关闭T11整项或推进T12。快照内完整Web E2E执行中占位不当作缺陷；本报告不宣称104项已完成。

## 实现核验

- generation-preconditions.ts 按原查询/检查提取Snapshot→Metric→Brief逻辑，保留按Snapshot version/Metric version/Brief updatedAt排序、缺失原因与完整性规则。routes调用位置及错误处理保持原顺序。
- 两处any替换为Fastify请求类型及使用字段；创建身份仍options.userId优先，其后userIdFromRequest，权限检查位置不变。Conversation内部传入headers没有把headers变成新身份源，因为该调用已有显式options.userId。无新增接口合同。
- 四个联合测试/helper/崩溃夹具移动到API；t7-review、t9-lifecycle、crash fixture内容逐行与基线相同。联合worker测试仅两处import调整：API app入口与Generation Worker入口，全部场景保持。crash fixture继续使用相同深度render-worker入口，IPC/退出边界未变。运行器依次API原集→API联合Worker→Worker撤销，共用隔离资源与finally清理；包已有相应依赖。manifest/lock无差异。
- 两旧UI日志git识别R100改名，新文件SHA与迁移清单逐项匹配；当前Markdown引用更新，历史冻结标签不伪造。原boundaries/hygiene/docs/commit检查器均无基线差异，未通过弱化规则掩盖问题。

## 独立检查及日志

独立node scripts/check-boundaries.mjs通过。docs-check.mjs在产品快照单独目录报一个指向workspace agent-tasks/archive的既有跨仓库链接缺失；这是快照未包含相邻控制库，不是产品新死链。测试系统合同直接执行8/9通过，第6项依赖spawnSync，在沙箱子进程EPERM下返回undefined输出，故不能宣称独立全通过；node --test同样被spawn EPERM阻断。误用check-docs.mjs入口及不支持的--test-isolation=none均已识别，没有产品写入。

静态交叉核验owner t11-typecheck/offline/integration/build/check-repaired日志及报告：联合Worker1/1及撤销1/1均fail0，offline API56 fail0，build尾部完成，最终质量串含原docs/hygiene/commit通过。仅审查日志，不独立重跑全类型、离线、集成、构建和依赖工具检查；完整E2E日志不在冻结manifest，尚未核验最终结果。报告明确初轮失败和修复，不将T10未知延迟描述为已修复。

## 证据保护与限制

复核期间主工作树完整E2E自动改写部分历史T8/T9截图，已提醒owner结束后恢复本轮生成的覆盖，或将新图另存，不能无说明替换历史验收原件；这些动态写入不影响885文件快照源码结论。其处理及最终E2E属于快照外补录，需另核验。

未操作生产/推送/部署，未读取真实供应商数据，不代替用户最终接受。
