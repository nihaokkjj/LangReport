# T9 历史分类与维护恢复操作

- change-id：`CHG-2026-10-03-evidence-correctness-repair`
- 状态：`IMPLEMENTING`；仅本地隔离演练，生产操作须另行授权
- 更新时间：2026-10-08

## 分类规则

`0035_evidence_integrity_lifecycle.sql` 为 additive 迁移。已有 Revision 增加 `integrity_status=legacy_unverified`，已有 Evidence 增加 `binding_version=1`；保留原状态、文本、快照、输出键、重复行和对象。迁移不根据数据库元数据推断对象字节正确，也不自动提升旧记录；完整旧记录仍可选择确认输入后创建新 Generation Cycle。当前原子发布显式写入 `verified` 和 `binding_version=2`，审核入口仍逐次核验成功 Job、固定 Evidence、来源与四对象长度/SHA-256。这个标记不能代替存储即时核验。

新绑定采用 v2 局部唯一索引和数据库触发器，核对 Revision/Artifact/Job/Snapshot/Project/Conversation、冻结 Brief 和 Metric。一条新 Revision 对应一条新 Evidence；v1 不得挂到 verified Revision。历史重复不强行加全局唯一索引、不选取任意一行修复。`evidence_integrity_audit` 返回数量及原因：迁移前未重验、缺 Evidence、重复、混合绑定、缺成功 Job、缺分析问题/口径、缺输出键。审计不验证对象是否存在或字节是否正确，报告明确 `objectBytesVerified=false`。

原 Approved 保持 Approved，UI 并列显示历史未验证提示；保留原导出读取权限，禁止新增审核批准与编辑/复制/回滚派生。不能通过修改旧状态制造已验证记录；重新确认输入后新建 Cycle，历史记录继续保留。

## 上线顺序（尚未执行）

1. 固定发布快照，备份数据库及对象引用，记录旧 Approved 四对象的 SHA-256。阻断新生成/修订入口，排空所有旧 API/Worker 和在途租约；维护模式不能代替排空在途外部写入。
2. 在迁移前使用只读事务审计旧库，保存计数和原始报告；例如下列查询覆盖重复/混合与缺来源，不做 UPDATE。逐项检查历史对象读取及哈希。

```sql
BEGIN TRANSACTION READ ONLY;
SELECT r.id, r.status, count(b.id) AS evidence_count,
  bool_or(b.generation_job_id IS DISTINCT FROM r.generation_job_id
    OR b.chart_artifact_id IS DISTINCT FROM r.artifact_id
    OR b.snapshot_id IS DISTINCT FROM r.snapshot_id
    OR b.project_id IS DISTINCT FROM a.project_id) AS mixed_binding,
  r.generation_job_id IS NULL AS missing_job,
  r.analysis_brief_snapshot = '{}'::jsonb AS missing_brief,
  r.metric_definition_snapshot = '{}'::jsonb AS missing_metric,
  r.output_objects
FROM chart_revisions r JOIN chart_artifacts a ON a.id = r.artifact_id
LEFT JOIN evidence_blocks b ON b.chart_revision_id = r.id
GROUP BY r.id, a.project_id ORDER BY r.id;
COMMIT;
```

3. 执行 additive 迁移及保守分类；运行后述 `audit`，比较原状态、文本、输出键、对象 SHA-256 和计数。迁移不搬运或删除对象。
4. 升级兼容客户端、合同、同版本 API/两类 Worker。DB 主连接设置 `application_name=langreport-lifecycle-v2`；无此标记的生命周期写入拒绝。该标记是兼容防错机制，数据库调用者能自行设置它，不是权限/认证边界；仍须实际停止旧进程并遵守部署版本一致性。
5. 合成验收生成、审核和四输出读取，确认只读维护与恢复行为，再开放写入。生产尚未执行，不能依据本地演练宣称线上数据已核验。

## 回滚与前向恢复

操作 CLI 要求显式 `DATABASE_URL`、`DATABASE_SCHEMA`，没有默认环境。以下为已演练的本地测试地址，schema 必须换成该次生成的隔离 schema；不要照抄到生产连接。

```powershell
$env:DATABASE_URL='postgres://langreport_test:langreport_test@127.0.0.1:54330/langreport_integration_test'
$env:DATABASE_SCHEMA='langreport_test_本次生成的标识'
node packages/db/scripts/evidence-lifecycle.mjs audit
node packages/db/scripts/evidence-lifecycle.mjs set-read-only
node packages/db/scripts/evidence-lifecycle.mjs audit
# 修复并启动同版本 API/Worker，完成读取检查后：
node packages/db/scripts/evidence-lifecycle.mjs resume-v2
```

`audit` 在 READ ONLY 事务中读取，不包含客户发现文本或 Brief/Metric 正文。维护控制行是单例；图表生命周期写入触发器对控制行持有共享锁，模式切换等待已进入生命周期事务的写入结束。`read_only` 拒绝 Job/Artifact/Revision/Evidence/Review 的增改删。它不是整站所有表的只读开关；只读导出仍可追加既有导出审计，非图表业务需由维护入口另行暂停。API 将生命周期只读/写入版本不匹配映射为 503 `EVIDENCE_LIFECYCLE_READ_ONLY` / `EVIDENCE_WRITER_VERSION_MISMATCH`，历史列表和导出仍可读。

回滚保留所有新列、新 Revision、新对象和候选账本；先阻断入口/排空，再进入生命周期只读并前向修复，禁止重启旧写入进程、降级 schema 或删除历史对象。`resume-v2` 只恢复同版本生命周期写入，不修改历史分类。对象清理仍遵守 T6 对账窗口、引用和租约规则。

## 隔离复现

`DATABASE_URL` 显式设为上述隔离测试库后，执行 `node packages/db/scripts/verify-migrations.mjs`。脚本生成随机 `migration_verify_*` schema 并最终删除，仅操作合成数据；验证旧库迁移前后 Revision/Evidence/Snapshot 的 JSON/SHA-256、重复与混合分类、新约束、旧写入版本拒绝、CLI 审计/只读/恢复。空库路径由 `node scripts/test-integration.mjs` 的独立 schema 初始化覆盖；Worker 集成里的 `verifyT9Lifecycle` 验证真实 API/MinIO 四输出 SHA-256 保持、历史 Approved 分类、拒绝派生、维护 503 和前向恢复。
