---
status: accepted
decision_date: 2026-09-27
---

# 备份恢复期间的记忆撤销账本与 fail-closed 恢复门

## 状态与授权

用户于 2026-09-27 批准仅在记忆系统 A/GA 范围补齐 TP-25。该决策不授权 B/C、Git 提交/推送或任何生产操作。

## 背景

A 批 GA 要求旧备份恢复后已删除的 Project Memory 与个人偏好不可复活。PostgreSQL tombstone 与主业务库备份一起回滚，无法独自证明删除优先。

当前仓库部署资料记载 Vercel 托管 Web，阿里云 ECS 通过 Docker Compose 托管 API、PostgreSQL、MinIO 和 Workers；生产 Compose 为 PostgreSQL 与 MinIO 分别使用本机 named volume。仓库没有自动备份/恢复脚本或 ECS 卷快照恢复流程。本方案据此只保证 PostgreSQL 逻辑备份恢复期间单独的 ECS 本机账本卷保持原状。

## 决策

1. 新增专用 Docker named volume `langreport-memory-revocation-prod`，挂载到现有 ECS 的 API、Generation Worker 和 Render Worker 容器路径 `/var/lib/langreport/memory-revocations`。该卷与 `langreport-postgres-prod` 分离，不使用 MinIO、新云服务、新付费服务、外部数据托管、新 IAM 身份或新凭据。
2. 账本只追加、无自动清理。每条事件只含格式版本、账本 ID、单调序号、撤销范围、Project/owner ID、opaque logical memory ID、删除时间、来源消息 ID；个人偏好可另含撤销版本 ID，用于重试识别和恢复时清理旧私有引用。禁止写记忆正文、偏好值、描述性 key 或内容 hash。SHA-256 只覆盖序列化账本元数据，不覆盖记忆内容。
3. 账本目录限制为服务容器可读写，不提供用户或 Project 成员 API。现有服务身份读取/写入此卷；不新增外部访问主体。
4. 删除持有跨实例 PostgreSQL advisory lock，锁定并校验当前 head/版本和来源后，先将完整元数据事件写入临时文件、fsync、原子重命名到序号文件并 fsync 目录，再原子更新并 fsync `HEAD.json`。随后在同一数据库事务中写入现有 tombstone、来源抑制、Project 活动版本删除状态、个人偏好正文/派生引用清理及 DB replay checkpoint。只有账本持久化与数据库事务均成功才返回删除成功。账本写入失败时不提交业务记忆变更；账本已持久化但 DB 失败时，checkpoint 落后，所有业务入口 fail closed，后续启动/请求按事件重放；相同逻辑记忆和偏好版本的重试幂等。
5. `memory_revocation_replay_state` 的 ledger ID、sequence、metadata digest 是数据库回放 checkpoint。API 在启动监听前、每个业务请求和 readiness 检查时校验账本；Generation/Render Worker 在启动和开始轮询前校验，Generation Worker 在模型发送前再校验。重放逐事件事务提交 tombstone、来源抑制、偏好正文/引用清理、Project 活动 head 删除状态与 checkpoint。重复重放为空操作。
6. 首次建账必须用显式 init 命令。命令从现有 tombstone、Project deleted 版本和来源抑制导入最小撤销元数据，并拒绝 queued/processing extraction job；它不复制记忆正文。`HEAD.json` 在完整导入前保持 `initialized: false`，完成后才原子置为 true；API/Worker replay 和业务门拒绝读取未完成初始化的账本，避免 init 中途崩溃后只重放部分旧撤销记录。空账本若没有 checkpoint 视为未初始化；应用启动不得自动把缺失账本解释为空账本。
7. 缺文件、格式/序号/校验不一致、DB checkpoint 超前、ledger identity 不匹配、重放/清理失败、磁盘写入失败时，不开放业务读取或模型调用。已原子落盘但尚未提交 DB checkpoint 的事件会在锁内重放；未完成临时文件不作为事件使用。完整性无法确认时保持关闭等待运维处理。
8. 不实现账本清理。至少等到所有可能恢复的旧备份、引用其来源的旧任务/队列和重放输入均不可能再执行后，才可以另行评估记录清理；本 A 批没有这样的 retention proof。
9. API 可读写该卷；Generation/Render Worker 只读挂载该卷。恢复流程要求停 API/Nginx/Workers，恢复 PostgreSQL 逻辑备份但保留账本卷，先运行 `memory:revocation:replay` 并确认成功，再启动 API/Workers、检查 readiness，最后开放 Nginx。整台 ECS 或包含账本卷的主机快照回滚不在本设计保证内；这种恢复方式需要另行获批的独立存储/防回滚 anchor。

## 后果

此方案利用现有 ECS 本机持久化，不新增付费、云端外部数据位置或身份权限。账本与 PostgreSQL 分离，所以 PostgreSQL 旧备份恢复可检测 checkpoint 落后并重放。ECS 主机/磁盘整体回滚可能同时回滚账本，不能据此声称支持整机快照恢复。账本不自动过期会持续占用磁盘；磁盘写入失败时删除不得报告成功，账本完整性无法确认时服务保持关闭。
