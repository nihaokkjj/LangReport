# Data Snapshot Preview：上传数据只读预览提案

- 变更编号：`CHG-2026-09-17-DATA-SNAPSHOT-PREVIEW`
- 状态：`APPROVED`
- 创建时间：2026-09-17
- 更新时间：2026-09-17

## 背景

当前上传流程已经解析并持久化 Data Snapshot 的字段画像和有限 `preview` 数据，但 Web 工作台只展示文件名、快照版本、行数、字段数和部分字段画像，没有把上传后的数据行渲染出来。用户无法快速确认表头、空值和数值是否被正确解析。

本变更服务第一阶段“咨询项目报告”的数据证据闭环。它增加的是 Data Snapshot 的只读核对能力，不是通用 BI 数据浏览器。

## 要解决的问题

1. 上传后用户无法直接核对解析出的真实数据行。
2. 同一 Data Asset 更新后，用户无法在数据入口查看历史 Snapshot 的内容。
3. 预览、历史版本和生成输入之间的关系不够明确，容易误用旧数据。
4. 多列和长值在桌面、移动端需要有可解释的溢出和懒加载行为。

## 目标用户与使用场景

- 咨询顾问：上传客户 CSV/XLSX/JSON 后，确认前 25 行和字段解析结果。
- 研究分析师：在同一 Data Asset 下切换历史 Snapshot，核对版本演进和旧数据质量。
- Reviewer：查看与历史 Chart Revision 相关的 Snapshot 内容，验证来源事实。

## 需求范围

### MVP

1. 在右侧“数据快照”摘要增加“查看数据”入口；上传成功只显示成功提示，不自动打开预览。
2. 桌面端使用宽 modal，移动端使用全屏 sheet。
3. 默认打开最新 Snapshot；同一 Data Asset 的版本列表展示全部 Snapshot 元数据。
4. 选择 Snapshot 后按需加载其 schema 和前 25 行 preview。
5. 表格保留全部字段，支持横向滚动；表头和第一列固定，不可见列只做懒渲染。
6. 数字按本地化格式展示，空值显示 `—`，长值截断但可查看完整值；预览完全只读。
7. 历史 Snapshot 只能预览，不能覆盖，也不能作为新的 Generation Cycle 输入；生成始终使用最新 Snapshot。
8. 仅对当前 Project 拥有 `view` 权限的用户开放，不公开原始文件和对象存储路径。
9. 为新 Snapshot 保存来源文件名、类型、MIME 类型和大小；字段允许为空，既有 Snapshot 不做回填。
10. 提供 Snapshot 列表和单个 Snapshot 详情 API，详情按需返回 schema/preview。

### 后续范围

- 完整原始文件下载或在线打开；
- 全量数据分页、搜索、排序、筛选和导出；
- Snapshot diff、字段级比较和差异可视化；
- 基于历史 Snapshot 的专门生成流程；
- 自动 PII 识别、脱敏和字段级访问策略；
- 实时协作和多人同时查看状态同步。

## 明确不做

- 不把 Data Snapshot Preview 扩展为 Dashboard、Excel 编辑器或通用数据浏览器。
- 不允许在浏览器中编辑、删除、排序、筛选或变换 Data Snapshot。
- 不把预览数据发送给模型，也不改变 Generation Worker、TransformPlan 或 Chart Revision 的输入语义。
- 不提供原始文件下载、公开分享链接或内部 object key。
- 不因查看历史 Snapshot 改变 Data Asset 的最新指针。

## 成功指标

- 用户可以在上传成功后通过“查看数据”打开最新 Snapshot，并看见前 25 行真实数据。
- 用户可以在同一 Data Asset 内切换任意历史 Snapshot，且显示版本、行数、列数和可用的来源元数据。
- 预览加载失败时，用户能在当前 modal 内重试，不会静默回退到其他版本。
- 200 列以内的数据在桌面和移动端可横向查看，不发生页面级横向溢出；长值、空值和类型展示可理解。
- 查看历史 Snapshot 不会改变下一次 Generation Cycle 使用的最新 Snapshot。
- 越权用户不能通过列表、详情或猜测 snapshotId 读取其他 Project 的数据。

## 假设、依赖与风险

- 依赖现有 Data Asset、Data Snapshot、Project 权限和对象存储路径；不改变数据解析规则。
- `packages/data-engine` 当前生成前 25 行 preview，字段上限为 200 列；前端按此边界设计。
- 新接口必须按 `assetId + snapshotId + projectId` 校验归属和权限。
- 既有 Snapshot 新增来源字段允许为空，UI 必须将缺失信息显示为“不可用”，不能用当前 Asset 元数据冒充历史事实。
- 一次性把所有版本的 preview 返回给浏览器会放大数据暴露和响应体；因此历史详情必须按需加载。

## 未决问题

无。用户已确认本提案及关联设计，进入 `APPROVED`；后续 T1-T7 已完成实现和自动化验证，人工验收缺口记录在 `acceptance.md`。

## 验收标准概要

- Web 具备“查看数据”入口、最新默认、历史切换、宽 modal/移动 sheet 和明确加载/失败状态。
- API 提供 Snapshot 列表和详情读取，严格执行 Project `view` 权限和 Snapshot 归属校验。
- 数据表格只读、最多 25 行、保留全部列、支持横向滚动和懒渲染，并符合 `DESIGN.md` 的响应式与可访问性约束。
- 新 Snapshot 的来源元数据可追溯；旧 Snapshot 的缺失元数据不被伪造。
- Web/API/合同/数据库验证和桌面/移动 E2E 通过后，才能进入 `ACCEPTED`。
