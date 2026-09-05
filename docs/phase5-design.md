# Phase 5：声明式插件设计与实施方案

> 状态：Partially implemented（插件管理入口、能力使用追踪、Theme 渲染转换、真实 PostgreSQL/MinIO Worker-Render 链路、API/Job 集成验收、本地迁移兼容、签名 JWT 回归、本地浏览器端到端验收和隔离生产 Compose 验收已落地；真实登录网关、ECS 部署数据库和 Vercel/ECS 生产验收待完成）
>
> 依据：`README.md`、`docs/mvp-roadmap.md`、`docs/phase1-consulting-report.md`、`docs/architecture.md`、`docs/domain-model.md`、`docs/plugin-manifest.md`、ADR 0005，以及当前工作树中的 Phase 3/4 实现。

本文件定义 Phase 5 的生命周期、存储、权限、能力解析和生成链路接入。Manifest 的字段语义和示例以 [`docs/plugin-manifest.md`](./plugin-manifest.md) 为唯一事实源；本文不重新定义一套 Manifest 格式。

## 1. 阶段目标

Phase 5 要让 Workspace 管理员安装可复用的图表扩展，让 Project 明确选择其中的固定版本，并把实际使用的插件能力写入 Generation Job 和 Chart Revision：

```text
Manifest JSON
    ↓ 解析 / 安全校验 / 兼容性检查
Workspace Plugin Installation（固定 pluginId + version + hash）
    ↓ Project 显式启用
Resolved Capability Catalog（模板 / Theme / 语义 / Validator）
    ↓ 生成前固化
Generation Job pluginContext
    ↓ 生成 / 校验 / 渲染
Chart Revision pluginSnapshot
```

本阶段必须完成：

- 严格校验 Plugin Manifest，拒绝未知字段、可执行代码、远程代码地址和未经平台允许的 Renderer；
- 支持内置插件目录以及管理员上传并安装 Manifest；
- 以 `pluginId + metadata.version + canonical content hash` 标识不可变插件版本；
- Workspace 管理员可以安装、停用和撤销插件，Project 可以启用/禁用已安装的精确版本；
- 在安装、启用和生成前执行 API 版本、SemVer、Flint Adapter、Renderer、Theme 和能力冲突检查；
- 让 Generation Worker 发现 Project 当前启用的模板、Theme、语义和 Validator；
- 保存生成时使用的插件版本、哈希和能力快照，使插件撤销或删除不影响已有 Chart Revision；
- 所有安装、启用、禁用、撤销、冲突和权限拒绝都能通过 `audit_events` 追溯。

## 2. 边界和非目标

### 2.1 本阶段范围

Phase 5 只增加声明式能力，不改变 Phase 2 的受限 TransformPlan 执行器、Phase 3 的不可变 Revision 和 Phase 4 的确认式记忆模型。插件可以提供：

- 图表模板及字段要求；
- Flint ThemeSpec 片段和 Theme 继承关系；
- 字段语义名称、描述和识别样例；
- 基于平台规则 DSL 的字段、数据和规范校验器；
- 模型理解和用户预览所需的示例；
- 平台已经发布的 Renderer 名称。

### 2.2 明确不做

- 不执行插件上传的 JavaScript、TypeScript、WASM、Shell、SQL、正则脚本或任意表达式；
- 不允许 Manifest 提供 `entrypoint`、`runtime`、`script`、`code`、`eval` 或远程代码地址；
- 不支持插件自行注册新的 Renderer；新增 Renderer 仍由平台发布和审查；
- 不做公共插件市场、远程 Registry、自动下载依赖或跨 Workspace 共享安装；
- 不做 Project 自动启用、自动选择插件版本或模型自主安装插件；
- 不允许插件修改 Data Snapshot、TransformPlan、Chart Revision、Workspace 权限或长期 Memory；
- 不把插件内容直接当作系统提示词或执行指令。`intentHints`、`examples` 和描述只作为带来源的非可信数据提供给模型。

这意味着 MVP 的扩展能力是“可组合的声明”，不是用户自定义后端。需要任意代码执行时，应另立安全边界、沙箱、权限和审计设计，不能在本阶段偷偷扩大 Manifest 协议。

## 3. 当前代码基线和主要缺口

以下状态以当前工作树为准，不以本文件原先的路线图描述为准：

| 层 | 当前状态 | 证据 | 收尾要求 |
| --- | --- | --- | --- |
| Manifest Contract / SDK | 已落地 | `packages/contracts`、`packages/plugin-sdk` 已提供 strict Schema、规范化、SHA-256、能力目录、Theme 继承和 Validator DSL；递归安全扫描包含禁止键、地址、循环引用、深度、节点数、字符串和 1 MiB 序列化上限；`packages/flint-adapter/src/validation.ts` 以固定 Adapter 版本校验模板/Theme payload，并在 SDK 中拒绝未知适配器字段 | Adapter 版本升级时同步扩展 payload allowlist 和回归测试 |
| 内置插件 | 已落地 | `packages/plugin-sdk/src/builtin-manifests/sales-editorial.json` | 作为端到端验收的固定 fixture，不自动启用 |
| 数据库结构 | 已落地 | `packages/db/src/schema.ts`、`packages/db/drizzle/0007_lush_starbolt.sql` 和 `packages/db/drizzle/0010_plugin_usage.sql` 已包含 Manifest、Installation、Binding、Job/Revision/Theme 字段；`pnpm db:verify` 会在隔离 schema 重放完整 SQL 链并验证历史 Phase 2–4 数据、默认值和索引 | 在部署数据库上按发布流程执行同一迁移校验；不再重复生成 0007 |
| 安装和 Project Binding 服务 | 已落地 | `packages/plugins/src/index.ts` 已提供安装、查询、撤销、恢复、启用/禁用、能力解析、事务锁、幂等、失败审计和审计事件 ID 回执 | 补齐更完整的跨 Workspace/Revision 集成测试 |
| 插件 API | 核心已落地 | `apps/api/src/routes.ts:130-232` 已注册 11 个插件相关路由，Contracts 也已登记 | 接入正式认证；当前安装入口实际只处理 JSON，不宣称已支持 multipart |
| Generation Job | 已落地 | 创建 Job 时写入 `pluginContext`、`pluginUsage` 并加入 `inputFingerprint`；API 集成测试验证插件上下文固化和插件状态变化导致的指纹变化；真实 Worker 集成测试验证实际能力使用结果 | 补齐真实 ECS/Vercel 验收 |
| Generation Worker | 已落地 | 已加载精确哈希 Manifest，并执行 Template requiredFields、语义提示、Renderer 限制和 Validator；真实 PostgreSQL/MinIO 测试已跑通 Job → Worker | 补齐真实 ECS/Vercel 验收 |
| Render Worker / Revision | 已落地 | 根据带完整来源的 `plugin_usage` 能力引用（pluginId/version/contentHash）过滤并保存 `pluginSnapshot`，插件 Theme 配置进入 Flint Spec/导出；真实 MinIO 测试验证 SVG/PNG/Vega-Lite、撤销后历史 Revision 和失败 Job 不创建 Revision | 补齐真实 ECS/Vercel 验收 |
| Web 主工作台 | 已落地 | `/plugins` 提供 Workspace 安装管理、Project 启用/禁用、能力目录和 Theme 选择；主工作台右上角提供入口并显示 Revision 插件快照条；追溯卡片通过独立 API 读取并覆盖 loading、无插件和损坏态；生产前端不依赖开发 Bootstrap | 补齐真实 ECS/Vercel 验收 |
| Web API Console | 已落地但仅用于调试 | `apps/web/app/api-console/page.tsx` 从 OpenAPI 动态展示 `Plugins` 标签并手动发送请求 | 不把 API Console 作为产品管理入口 |
| 正式身份认证 | 已接入签名 JWT Provider，待部署登录网关验收 | 非生产仍兼容 `x-user-id`；生产可自动校验 HS256 JWT（Bearer 或 HttpOnly Cookie），也保留 `buildApp` 的 `authProvider` 接入点；无有效认证时拒绝请求 | 配置部署环境的 JWT 签发网关、密钥和 Claim 校验，并执行真实登录回归 |
| 验收测试 | 不完整 | SDK、Generation、API、真实 PostgreSQL/MinIO Worker/Render 集成测试已增加；`pnpm db:verify` 和签名 JWT 回归已通过；2026-09-04 已用本地 Chrome 验证 `/plugins` 安装 → 启用 → Theme/Manifest 校验、主工作台上传 → 生成 → Revision 快照、撤销后历史 Revision 读取、插件上下文 API、损坏/无插件状态，并检查 390px 移动宽度无溢出；`provision:production` 已提供显式确认的首次 Workspace 初始化；隔离生产 Compose 已通过版本化迁移、迁移后 Worker 启动、Bearer JWT/Session Cookie、无认证和伪造身份头拒绝、插件 API 及完整生成导出链路；`pnpm phase5:smoke` 已提供部署后验收 | 补齐真实登录网关、ECS 部署数据库和 Vercel/ECS 生产验收 |

当前实现与设计目标的关键差异：

1. 插件管理入口已增加为主产品路由 `/plugins`；API Console 仍只用于调试。
2. `POST /api/v1/workspaces/:workspaceId/plugins` 当前接收 JSON Manifest、`source` 和 `idempotencyKey`，没有实现设计中提到的 multipart 原始文件上传。
3. `pluginContext` 和 `pluginUsage` 已进入 Job；生成器已将插件语义提示、Template `requiredFields`、Renderer 限制和 Validator 执行纳入确定性校验。
4. 插件 Theme 已解析为安全的 `themeConfig` 写入 Flint Spec，Flint Adapter 和确定性 SVG/PNG/Vega-Lite 渲染会消费该配置；真实 PostgreSQL/MinIO Worker 集成已验证颜色和 Theme 元数据进入输出。
5. 身份边界已区分开发和生产；生产默认校验签名 JWT 并将 `sub` 写入请求上下文，仍需在部署环境配置真实签发网关，不能继续把可伪造的 `x-user-id` 当作认证。
6. 生产 Web 前端不调用仅限开发环境的 `POST /api/v1/dev/bootstrap`；主工作台和 `/plugins` 都从认证后的 `GET /api/v1/projects` 读取已 provision 的 Workspace/Project，本地开发仍保留自动 Bootstrap。

本阶段后续工作以这些差异为待办事实。Manifest 的解析和校验继续只放在 `packages/plugin-sdk`，API 路由和 Worker 不各自实现第二套规则。

## 4. 领域模型

### 4.1 不可变 Plugin Manifest Version

Manifest 文件本身不是安装状态。一次成功校验后，平台把它规范化为一个不可变的 Manifest Version：

- `pluginId` 来自 `metadata.id`，是插件的稳定逻辑身份；
- `version` 来自 `metadata.version`，必须是规范化 SemVer；
- `contentHash` 是规范化 JSON 的 SHA-256，而不是原始文件空白和键顺序的哈希；
- `apiVersion` 决定平台如何解释包络；
- `manifest` 保存规范化后的完整声明，用于审计和重新解析；
- `validationReport` 保存 Schema、禁止字段、能力、Theme、Renderer 和 Adapter 检查结果；
- `source` 区分 `builtin` 和 `uploaded`。

同一个 Workspace 内，`pluginId + version` 只能对应一个 `contentHash`。同一版本重新上传不同内容必须返回版本/哈希冲突，而不是覆盖旧 Manifest。历史 Manifest 不做原地更新。

### 4.2 Plugin Installation

Plugin Installation 表示一个 Manifest Version 已进入某个 Workspace 的可用范围。它保存：

- Workspace 归属；
- 精确的 Manifest Version 引用和冗余的 `pluginId`、`version`、`contentHash`；
- `installed`、`revoked` 等安装状态；
- 安装人、安装时间、撤销人、撤销时间和原因；
- 当前平台兼容性状态或最近一次检查结果。

内置插件也必须先以 Workspace Installation 的形式进入 Project 可选范围；内置目录只是平台可读的候选来源，不代表所有 Project 自动启用。这样内置插件和管理员上传的插件使用同一套权限、审计和精确版本语义。

### 4.3 Project Plugin Binding

Project Plugin Binding 表示 Project 是否启用了某个 Workspace Installation：

- `project_id` 和 `installation_id` 必须属于同一个 Workspace；
- Binding 永远指向一个不可变 Manifest Version，不使用 `^1.0` 或 `latest`；
- `enabled` 时，Project 内同一 `pluginId` 只能有一个启用版本；
- 禁用保留历史 Binding，便于审计，不删除 Manifest 或旧 Revision；
- Workspace Installation 被撤销时，相关 Binding 变为不可用/禁用，并记录原因。

### 4.4 Capability Reference

解析后的能力不直接以裸 `templateId` 或 `semanticTypeId` 在模块间传递。每个能力都带有：

```ts
type CapabilityReference = {
  kind: "template" | "theme" | "semantic-type" | "validator" | "example" | "renderer";
  id: string;
  pluginId: string;
  version: string;
  contentHash: string;
};
```

`kind + id` 是 Project 能力目录中的稳定能力键，用于检测重复声明；`pluginId + version + contentHash` 是来源，用于追溯和复现。生成器不能只保存能力名称而丢失来源。

### 4.5 Resolution Snapshot

在 Generation Job 创建时解析当前 Project 的启用集合，并保存 `pluginContext`。Worker 不在任务执行中读取“最新插件集合”替换上下文。这样，任务排队期间管理员改变启用状态，也不会让同一个 Job 的输入含义漂移。

`pluginContext` 至少包含：

```json
{
  "version": "v1",
  "flintAdapterVersion": "0.1.0",
  "renderer": "vega-lite",
  "enabledPlugins": [
    {
      "installationId": "...",
      "pluginId": "sales-editorial",
      "version": "1.0.0",
      "contentHash": "sha256:..."
    }
  ],
  "capabilities": [
    {
      "kind": "template",
      "id": "monthly-regional-sales",
      "pluginId": "sales-editorial",
      "version": "1.0.0",
      "contentHash": "sha256:..."
    }
  ],
  "themeRef": null,
  "conflicts": []
}
```

Chart Revision 的 `pluginSnapshot` 保存该 Revision 实际使用的插件定义，而不只保存当前 Installation ID。至少要包含所用模板、Theme、语义、Validator 和 Renderer 声明的规范化内容、来源版本、哈希及 Flint/Renderer 版本。插件撤销、软删除或后续版本安装都不能改变这个快照。

### 4.6 启用能力与实际使用能力

`enabledPlugins` 表示本次 Job 可用的精确 Installation 集合，不等于最终使用的能力集合。为避免 Revision 快照虚胖或产生“启用了就等于使用了”的错误证据，目标 Contract 需要区分：

- `enabledPlugins`：解析时全部启用的插件来源；
- `selectedTemplate`：本次生成实际选中的 Template，可为空；
- `selectedTheme`：本次实际生效的内置或插件 Theme，可为空；
- `usedCapabilities`：实际影响意图、字段映射、校验或渲染的能力引用；
- `unusedCapabilities`：可选的诊断信息，不进入 Revision 的必要快照。

Job 必须先保存可复现且不再变化的 `pluginContext`；Worker 根据确定性结果写入独立的 `pluginUsage`/`usedCapabilities` 输出，不能回写影响幂等性的输入上下文或 `inputFingerprint`。Revision 的 `pluginSnapshot` 至少保存 `usedCapabilities` 对应的完整能力 payload 和来源，不得只保存能力名称或 Installation ID。

## 5. Manifest 校验和安全模型

### 5.1 校验顺序

所有来源（内置目录、管理员上传、测试 fixture）都走同一个 `PluginManifestService`：

1. 检查 MIME、UTF-8 JSON 和大小上限；MVP Manifest 原文上限为 1 MiB；
2. 解析严格的顶层 Schema，拒绝未知顶层字段；
3. 递归检查禁止字段和禁止远程地址；
4. 检查 `apiVersion`、`metadata.id`、SemVer、名称和各数组数量/字符串长度上限；
5. 检查能力内部 Schema，并将模板/Theme/语义/Validator/示例转换为规范化内部结构；
6. 检查 Renderer 是否属于平台 allowlist；
7. 用固定版本的 Flint Adapter 校验模板 payload 和 Theme payload；
8. 解析 Theme 继承图，拒绝未知父节点、循环和超过深度上限的继承；
9. 编译 Validator DSL，拒绝未知 `kind`、未知参数、任意表达式和超出执行预算的规则；
10. 计算规范化 Manifest 的 SHA-256，并返回可供管理员确认的校验报告。

任一环节失败，Manifest 都不能成为可安装或可启用版本。校验报告应返回稳定错误码和字段路径，例如 `PLUGIN_UNKNOWN_FIELD`、`PLUGIN_FORBIDDEN_CODE`、`PLUGIN_RENDERER_UNSUPPORTED`、`PLUGIN_THEME_CYCLE` 和 `PLUGIN_VALIDATOR_RULE_INVALID`。

### 5.2 严格字段和执行边界

- Contracts 层对顶层和能力对象使用 strict Schema；未知字段是错误，而不是静默丢弃；
- 禁止键包括 `entrypoint`、`runtime`、`script`、`code`、`eval`、`function`、`command`、`sql`、`wasm` 和 `url`；检查递归应用于所有能力 payload；
- `$schema` 只允许指向平台规定的 Schema 地址，其他 `http://`、`https://`、`data:`、`file:` 和自定义协议值均拒绝；
- Validator 只能使用平台 allowlist 中的规则和参数，不使用 `eval`、动态导入、用户正则或脚本表达式；
- 插件声明不能降低平台基础校验、权限检查、Workspace 隔离或 Data Snapshot 追溯要求；
- `intentHints`、`description`、`examples.prompt` 和语义样例在模型上下文中必须作为带来源的数据块，不得拼接到系统提示词中；
- 解析器、Theme 合并器和 Validator 执行器都应有条数、深度、字符数和执行时间上限，防止 Manifest 造成资源消耗。

### 5.3 Manifest 与对象存储

规范化 Manifest 体积小，可直接保存在 PostgreSQL 的 JSONB 中；管理员上传的原始文件如需下载或审计，另存私有对象存储，并将 `sourceObjectKey` 写入记录。对象键必须包含 Workspace 作用域。数据库中的规范化内容是解析和复现的事实源，原始文件不是执行输入。

## 6. 兼容性、版本和冲突

### 6.1 兼容性层级

兼容性不是一次性上传检查，而是三个时点的同一套规则：

| 时点 | 检查 | 失败处理 |
| --- | --- | --- |
| 上传/安装 | API、Manifest Schema、能力 payload、当前 Adapter、Renderer | 不创建可用 Installation，返回错误报告 |
| Project 启用 | Installation 状态、当前平台版本、Project 冲突 | 不创建启用 Binding |
| Generation Job 创建 | 快照引用仍完整、Adapter/Renderer 未失效、能力目录可解析 | Job 不入队或标记 `PLUGIN_CONTEXT_INVALID` |

安装后平台升级导致旧插件不兼容时，不修改历史 Manifest 或 Revision；Installation 标为 `incompatible`，新 Job 不能使用，管理员可以安装兼容的新版本。

### 6.2 Theme 解析

MVP 的 Theme 引用使用明确的 `ThemeRef`：

```ts
type ThemeRef =
  | { source: "builtin"; id: string; version: string }
  | { source: "plugin"; pluginId: string; version: string; capabilityId: string; contentHash: string };
```

保留现有内置 Theme 字符串的读取兼容性；新字段逐步保存规范化 `ThemeRef`。插件 Theme 只有在用户或 Project Theme 明确选择时才生效，不因为插件启用就自动替换当前 Theme。

MVP 允许插件 Theme 继承平台内置 Theme 或同一 Manifest 中较早解析的 Theme；跨插件 Theme 继承暂不开放。解析结果必须包含完整父链和最终配置，并写入 Generation Job/Chart Revision。Theme 合并不能覆盖平台安全字段或引入外部资源。

### 6.3 冲突规则

启用时执行以下冲突检测：

1. 同一 Project 中同一个 `pluginId` 不允许同时启用两个版本；
2. 同一 Project 能力目录中，`kind + id` 重复声明时视为冲突；
3. 同一插件内部重复声明能力 ID 是 Manifest 错误，不等到 Project 启用才发现；
4. Renderer 不是能力冲突，而是平台 allowlist 和兼容性检查；
5. 仅 `description`、`intentHints` 或示例文本相似不构成冲突，MVP 不做语义相似度判断。

MVP 不引入管理员优先级覆盖。冲突会阻止启用或生成，并返回所有来源的 `pluginId`、版本、哈希和能力路径；管理员需要禁用其中一个版本/能力后重试。这样不会因安装顺序产生隐式覆盖。

## 7. 数据库设计

### 7.1 `plugin_manifests`

保存不可变 Manifest Version 和校验结果：

| 字段 | 说明 |
| --- | --- |
| `id` | Manifest Version ID |
| `workspace_id` | 上传 Manifest 的 Workspace；内置目录记录为空 |
| `source` | `builtin` / `uploaded` |
| `plugin_id` | `metadata.id` |
| `version` | 规范化 SemVer |
| `api_version` | Manifest 包络版本 |
| `name`、`description` | 展示元数据 |
| `manifest` | 规范化完整 JSONB，不可变 |
| `content_hash` | 规范化内容 SHA-256，不可变 |
| `validation_status` | `valid` / `rejected` / `incompatible` |
| `validation_report` | 稳定错误码、字段路径和 Adapter/Renderer 结果 |
| `source_object_key` | 原始上传文件的私有对象键，可为空 |
| `created_by`、`created_at` | 来源和创建时间 |

约束和索引：

- `source = builtin` 时 `workspace_id` 必须为空；`source = uploaded` 时必须有 Workspace；
- 内置版本按 `plugin_id + version + content_hash` 唯一；同 Workspace 上传版本按 `workspace_id + plugin_id + version` 唯一；
- 同 Workspace 的相同 `plugin_id + version` 使用不同哈希必须被拒绝；
- 对 `workspace_id`、`plugin_id`、`version`、`validation_status` 和 `content_hash` 建索引；
- Manifest 内容插入后不允许 UPDATE，修订必须创建新版本。

### 7.2 `plugin_installations`

保存 Workspace 安装关系：

| 字段 | 说明 |
| --- | --- |
| `id` | Installation ID |
| `workspace_id` | 安装所属 Workspace |
| `manifest_id` | 不可变 Manifest Version 外键 |
| `plugin_id`、`version`、`content_hash` | 冗余快照，便于审计和查询 |
| `status` | `installed` / `revoked` / `incompatible` |
| `installed_by`、`installed_at` | 安装操作者和时间 |
| `revoked_by`、`revoked_at`、`revoke_reason` | 撤销信息 |
| `last_compatibility_check` | 最近兼容性结果，可为空 |

`workspace_id` 与 `manifest_id` 的归属必须由 Repository 使用带作用域的查询校验。撤销是软状态，不物理删除 Manifest，也不级联删除 Project Binding 或 Chart Revision。

MVP 中“删除插件”统一解释为撤销 Workspace Installation：从可用目录移除并阻止新生成，保留 Manifest、Binding、审计和历史 Revision。若需要恢复，管理员必须重新通过兼容性检查；不提供会物理擦除历史来源的删除操作。

### 7.3 `project_plugin_bindings`

保存 Project 的显式启用：

| 字段 | 说明 |
| --- | --- |
| `id` | Binding ID |
| `project_id`、`workspace_id` | Project 和冗余 Workspace 作用域 |
| `installation_id` | Workspace Installation 外键 |
| `plugin_id`、`version`、`content_hash` | 启用时写入的精确版本快照 |
| `status` | `enabled` / `disabled` |
| `enabled_by`、`enabled_at` | 最近启用信息 |
| `disabled_by`、`disabled_at`、`disabled_reason` | 禁用信息 |
| `updated_at` | 并发控制时间 |

建议索引和约束：

- `(project_id, installation_id)` 唯一；
- 对 `project_id + plugin_id` 增加“状态为 enabled 时唯一”的部分唯一索引；
- 对 `project_id + status`、`installation_id + status` 建索引；
- Project 和 Installation 的 Workspace 一致性在事务中强制校验；
- 禁用 Binding 不删除记录，重新启用必须重新检查 Installation、兼容性和冲突。

### 7.4 既有表的变化

- `generation_jobs` 增加 `plugin_context` JSONB，保存创建 Job 时的解析快照；
- `generation_jobs` 增加 `plugin_usage` JSONB，保存 Worker 确认的实际 Template、Theme、语义、Validator 和 Renderer 能力引用；该字段是 Job 输出，不参与创建时的 `input_fingerprint`；
- `chart_revisions` 增加 `plugin_snapshot` JSONB，默认空快照以兼容 Phase 2–4 历史数据；
- `project_themes` 增加规范化 `theme_ref` JSONB，保留现有 `preset` 以兼容内置 Theme；
- `audit_events` 继续作为安装、启用、禁用、撤销、冲突和权限拒绝的追加式记录；
- 不直接把插件能力复制成多张可变表，能力目录从不可变 Manifest 解析并可由包内缓存加速，避免 Manifest 与索引漂移。

当前工作树的迁移日志已经包含 `0007` 插件迁移；文档和实施不得再把它描述为“待生成”。迁移必须显式覆盖历史 JSONB 默认值、部分唯一索引、状态枚举、Workspace 约束和既有 Job/Revision 读取兼容性；本阶段不依赖 `db:push` 代替迁移。若迁移日志中存在编号间隔（当前可见 0008 缺失），先确认是否为有意跳号，再执行真实数据库迁移。

## 8. 权限和状态机

### 8.1 角色能力

| 能力 | Owner/Admin | Project Editor | Project Reviewer | Project Viewer |
| --- | --- | --- | --- | --- |
| 查看 Workspace 插件目录和已安装版本 | 是 | 按 Workspace 可见策略 | 否 | 否 |
| 上传/安装 Manifest | 是 | 否 | 否 | 否 |
| 撤销/重新启用 Workspace Installation | 是 | 否 | 否 | 否 |
| 查看 Project 已启用插件 | 是 | 是 | 按项目可见策略 | 否 |
| 启用/禁用 Project Plugin Binding | 是 | 是 | 否 | 否 |
| 查看能力目录和冲突详情 | 是 | 是 | 是 | 否 |
| 选择 Project Theme 为插件 Theme | 是 | 是 | 否 | 否 |

Project Editor 的启用权限只影响自己的 Project，不等于 Workspace 插件管理权限。任何角色都不能使用插件 ID 绕过 Workspace/Project 归属检查。跨 Workspace 的插件、Installation、Binding 和 Revision 查询应统一返回 404 或无权限错误，不泄露资源存在性。

### 8.2 状态机

```text
Manifest 输入
    ├─ 校验失败 → Rejected（不产生可用 Installation）
    └─ 校验成功 → Valid Manifest Version
                         ↓ 安装
                 Installed Installation
                         ↓ 撤销
                 Revoked Installation

Project Binding：Disabled ──启用──→ Enabled
       Enabled ──禁用/插件撤销──→ Disabled
```

兼容性失效是 Installation 的不可用原因，可单独记录 `incompatible` 状态或 `status_reason`；不能把不兼容版本继续暴露给生成器。重新启用或恢复安装必须重新运行完整校验。

所有状态变化由 `PluginService` 执行，不能由路由直接 UPDATE。安装、启用和撤销事务至少要完成：

1. 带 Workspace/Project 作用域读取和锁定目标记录；
2. 校验操作者角色、版本/哈希和当前状态；
3. 校验关联资源归属、兼容性和能力冲突；
4. 写入状态变化和冗余版本字段；
5. 写入 `audit_events`，包含 request ID、来源哈希、能力冲突和原因。

## 9. 生成链路接入

### 9.1 Job 创建时解析

API 创建 Generation Job 时，在确定性地计算输入指纹后调用 `PluginResolutionService`，并在 Job 入队前固化结果：

1. 根据 Project 和 Workspace 读取 `enabled` Binding；
2. 确认每个 Binding 指向已安装、未撤销且兼容当前 Adapter/Renderer 的 Manifest；
3. 从所有 Manifest 构建能力目录并执行冲突检测；
4. 根据请求的 `ThemeRef`、Project Theme 和内置默认 Theme 解析最终 Theme；没有显式选择时，插件 Theme 不得自动生效；
5. 将启用插件来源、完整能力引用、Theme 引用、平台版本和空冲突列表写入 `plugin_context`；
6. 将 `plugin_context` 的稳定序列化哈希纳入 `generation_jobs.input_fingerprint`；
7. 通过唯一幂等键写入 Job，确认写入成功后才投递 Job；重试不能创建第二个 Job。

如果冲突或兼容性失败，API 返回可解释错误，Job 不进入生成队列。若系统选择允许“排队后失败”，必须写入明确的 `PLUGIN_CONTEXT_INVALID`，不能退化为无插件生成。

### 9.2 Generation Worker

Generation Worker 只消费 Job 已固化的 `plugin_context`：

- 将 Template 的字段要求、语义提示和示例作为带来源的结构化能力目录提供给意图解析和 TransformPlan 生成；
- 选择 Template 时同时检查 `intentHints`、`requiredFields` 和 `allowedRenderers`，并记录完整 `CapabilityReference`，不能只保存裸模板名；
- 将插件语义作为候选字段识别提示，最终字段、数据和转换仍必须来自 Data Snapshot 与平台允许的 TransformPlan；
- 生成 Flint Spec 后，确定性校验 Template 的字段角色与语义映射；不满足要求时进入可解释失败或有限修复，不降级成无插件生成；
- 将插件 Validator 编译结果与平台基础校验合并，平台基础校验优先且不可被插件关闭；
- 只使用 `plugin_context` 中明确选择的 Theme，不因模型文本自行改变 Project Theme；
- 记录实际使用的 Template、Theme、语义和 Validator 引用到 `plugin_usage`，用于生成 `usedCapabilities`；
- 每个插件校验问题包含 `pluginId`、版本、能力 ID、规则 ID、错误码和字段路径；
- 若 Job 快照引用的 Manifest 内容哈希与数据库内容不一致，任务失败并记录完整错误。

模型生成的 TransformPlan 仍由平台受限执行器执行。插件不能读写原始文件、调用外部网络、改变 Workspace 权限或直接创建 Chart Revision。

### 9.3 Render Worker 和 Revision

Render Worker 不执行插件代码。它可以根据 Job 已固化的精确引用重新解析不可变 Manifest，以构建快照，但不能读取“当前最新插件集合”替换 Job 输入；它接收已经校验的 Flint Spec、解析后的 Theme、平台允许的 Renderer 和 Job 的插件上下文，只负责固定版本的 Flint/Vega-Lite 编译和导出。

创建 Chart Revision 时：

1. 从 Job 读取 `plugin_context`；
2. 根据 Generation Worker 记录在 `plugin_usage` 中的 `usedCapabilities` 只提取本次实际使用的能力定义，生成 `plugin_snapshot`；
3. 确认 Flint Adapter 已消费的是解析后的安全 Theme 配置，而不是未解释的 Manifest payload；与 Renderer、Theme、Memory 和 Data Snapshot 元数据一并写入不可变 Revision；
4. 输出对象继续按 Revision 归属保存；
5. 插件撤销或删除后，旧 Revision 仍可以预览、导出和审计，重新渲染时优先使用快照并验证平台 Renderer 兼容性。

`plugin_snapshot` 至少保存：

```json
{
  "version": "v1",
  "flintAdapterVersion": "0.1.0",
  "renderer": { "id": "vega-lite", "version": "vega-lite-svg-v1" },
  "plugins": [
    {
      "pluginId": "sales-editorial",
      "version": "1.0.0",
      "contentHash": "sha256:...",
      "capabilities": {
        "template": [],
        "theme": [],
        "semanticTypes": [],
        "validators": []
      }
    }
  ]
}
```

保存完整能力定义会增加 Revision JSONB 体积，因此实现时应只保存本次使用的能力；但必须保留足够内容来解释和重建当时的模板、Theme、语义映射和 Validator。只保存 Installation ID 不满足“插件删除不破坏历史 Revision”。

## 10. API 设计

以下 API 均使用现有的 `userId → Workspace Member → Project Role` 授权上下文。具体 DTO 放入 `packages/contracts`，错误码保持稳定。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/workspaces/:workspaceId/plugin-catalog` | 查看平台内置插件目录 |
| `POST` | `/api/v1/workspaces/:workspaceId/plugins/validate` | 校验 Manifest，返回规范化摘要、哈希、能力和错误报告，不安装 |
| `POST` | `/api/v1/workspaces/:workspaceId/plugins` | 校验并安装 JSON Manifest；multipart 原始文件上传不属于当前 MVP |
| `GET` | `/api/v1/workspaces/:workspaceId/plugins` | 查看 Workspace 已安装插件、版本、哈希和状态 |
| `GET` | `/api/v1/workspaces/:workspaceId/plugins/:installationId` | 查看安装详情、能力和兼容性报告 |
| `POST` | `/api/v1/workspaces/:workspaceId/plugins/:installationId/revoke` | 撤销安装，不删除历史版本 |
| `POST` | `/api/v1/workspaces/:workspaceId/plugins/:installationId/restore` | 重新检查并恢复一个未删除的安装 |
| `GET` | `/api/v1/projects/:projectId/plugins` | 查看 Project 的启用/禁用 Binding |
| `PUT` | `/api/v1/projects/:projectId/plugins/:installationId` | 启用或禁用精确插件版本 |
| `GET` | `/api/v1/projects/:projectId/capabilities` | 查看解析后的模板、Theme、语义、Validator 和冲突 |
| `GET` | `/api/v1/chart-revisions/:revisionId/plugin-context` | 查看该 Revision 的插件来源和快照 |

安装请求至少需要 Manifest 内容和幂等键。返回结果应包含 `installationId`、`pluginId`、版本、规范化哈希、校验结果、兼容性、能力摘要和审计事件 ID。重复安装相同 Workspace、版本和哈希应返回原 Installation；相同版本不同哈希应返回 `PLUGIN_VERSION_HASH_CONFLICT`。

启用/禁用请求至少需要 `enabled`、`expectedVersion` 或等效并发条件和幂等键。启用失败时返回全部冲突来源，而不是只返回第一个冲突能力。

当前代码的接口边界需要和目标设计明确区分：

- `GET /api/v1/workspaces/:workspaceId/plugin-catalog`、校验、安装、Workspace 查询、撤销、恢复、Project Binding、能力解析和 Revision 快照查询都已经注册；
- 当前安装请求是 JSON：`{ manifest, source?, idempotencyKey }`。Manifest 原文上传、`sourceObjectKey` 写入和 multipart 处理属于后续增量，不作为当前已完成能力；
- 安装、启用、禁用、撤销和恢复服务已写入 `audit_events`，成功响应返回对应 `auditEventId`；幂等复用响应返回原变更事件 ID（历史记录缺失时为 `null`），前端不自行推断审计结果；
- 当前路由通过 `x-user-id` 兼容非生产开发环境；生产环境由 `apps/api/src/auth.ts` 自动校验 `AUTH_JWT_SECRET` 对应的 HS256 Bearer/Cookie Token，并拒绝伪造身份头。部署时仍需配置真实 Token 签发网关，前端产品请求不得让用户编辑身份头。

建议的稳定错误码：

- `PLUGIN_MANIFEST_INVALID`
- `PLUGIN_MANIFEST_TOO_LARGE`
- `PLUGIN_MANIFEST_TOO_DEEP`
- `PLUGIN_MANIFEST_TOO_MANY_NODES`
- `PLUGIN_MANIFEST_STRING_TOO_LONG`
- `PLUGIN_MANIFEST_CYCLE`
- `PLUGIN_UNKNOWN_FIELD`
- `PLUGIN_FORBIDDEN_CODE`
- `PLUGIN_VERSION_HASH_CONFLICT`
- `PLUGIN_API_UNSUPPORTED`
- `PLUGIN_ADAPTER_INCOMPATIBLE`
- `PLUGIN_RENDERER_UNSUPPORTED`
- `PLUGIN_CAPABILITY_CONFLICT`
- `PLUGIN_THEME_INVALID`
- `PLUGIN_VALIDATOR_INVALID`
- `PLUGIN_NOT_INSTALLED`
- `PLUGIN_REVOKED`
- `PLUGIN_CONTEXT_INVALID`
- `PLUGIN_SCOPE_FORBIDDEN`

生产前端请求统一使用 `credentials: include` 以携带登录网关的 HttpOnly Session Cookie；API CORS 同时显式返回 `Access-Control-Allow-Credentials: true`。部署 Smoke 支持用短期 Bearer JWT 或 `PHASE5_SESSION_COOKIE` 回归真实 Session Cookie，并验证 `/ready` 数据库就绪和无认证拒绝。同源 Vercel Rewrite 仍是推荐部署方式，开发环境的 `x-user-id` 只在非生产配置下启用。

## 11. Web 体验

在现有数据工作区中增加两个管理入口，不改变当前“对话 → 数据 → 图表 → Revision”的信息架构：

### 11.0 当前入口和目标入口

当前 `apps/web` 提供主工作台、`/api-console` 和 `/plugins`。API Console 从 OpenAPI 动态生成 `Plugins` 标签，适合调试和验收；产品入口是 `/plugins`，主工作台右上角的“插件”链接会进入该页面。

目标入口分为三处：

1. Workspace 设置中的“插件”：负责目录、Manifest 校验、安装、查看、撤销和恢复；
2. Project 设置中的“扩展”：负责查看 Project Binding、启用/禁用精确版本、查看能力目录和选择插件 Theme；
3. Evidence/Revision 追溯区域中的“插件上下文”：负责查看本次 Revision 实际使用的插件来源和能力快照。

三个入口都只负责展示状态和发起请求；权限、作用域、冲突、兼容性和版本检查必须由服务端再次执行。

### Workspace 插件设置

- 内置插件目录：名称、用途、支持的 Adapter/Renderer、版本和能力摘要；
- Manifest 上传/粘贴入口：显示文件大小、规范化哈希和逐字段校验错误；
- 已安装列表：精确版本、来源、安装人、时间、兼容性和撤销状态；
- 能力详情：模板字段要求、Theme 预览、语义类型和 Validator 规则；
- 撤销/恢复确认：明确说明新生成不可使用该版本，但历史 Revision 不受影响。

### Project 扩展设置

- 已安装插件的启用/禁用开关，展示 `pluginId@version` 和内容哈希前缀；
- 当前解析出的模板、Theme、语义和 Validator 目录；
- 同一能力重复声明时并排展示来源和解决动作；
- 插件 Theme 需要明确选择，选择后显示其继承的内置 Theme 和最终解析配置；
- 空目录、插件撤销、不兼容、冲突和权限不足都提供可解释状态。

生成结果的 Revision 追溯 API 已提供“插件上下文”数据；主工作台在已有 Revision 结果上方显示插件快照条，当前 `/plugins` 能力目录可查看生成前的有效能力。前端只展示和发起操作，权限、冲突、兼容性和版本检查必须由服务端再次执行。

### 11.1 前端调用顺序

Workspace 插件设置打开时：

1. 并行读取内置目录和已安装列表；
2. 用户选择 Manifest 后先调用校验接口，只展示校验报告，不改变安装列表；
3. 用户确认后调用安装接口，客户端生成一次性的 `idempotencyKey`；
4. 安装成功后重新读取列表和详情；撤销/恢复也采用“提交 → 重新读取”的方式；
5. `403`、`409` 和 `PLUGIN_*` 错误必须显示服务端原因，不把失败状态伪装成成功。

Project 扩展设置打开时：

1. 读取 Project 插件 Binding 和能力目录；
2. 启用/禁用时发送 `enabled`、当前 `expectedVersion` 和新的 `idempotencyKey`；
3. 收到 `PLUGIN_CAPABILITY_CONFLICT` 或版本冲突后刷新列表和能力目录，再让用户处理；
4. 选择插件 Theme 时通过现有 Project Theme 接口保存精确 `ThemeRef`，不能只保存 Theme 名称；
5. 只有服务端解析成功的能力目录才能被生成流程使用。

Revision 追溯卡片在已有 Revision 数据加载后调用 `GET /api/v1/chart-revisions/:revisionId/plugin-context`。无插件时显示“本次未使用插件”，快照损坏或来源无法解析时显示阻塞性追溯错误。

前端请求状态至少要区分 `idle`、`loading`、`submitting`、`success`、`empty` 和 `error`；启用/禁用按钮在请求期间锁定，不能通过重复点击绕过幂等语义。移动端使用抽屉或全屏面板承载详情，不能要求用户在窄屏横向滚动完整 Manifest。

## 12. 推荐实施步骤

本节按当前代码基线排序：标记为“已落地”的步骤不再重复实现，而是补齐验证或将其作为后续步骤的依赖；标记为“部分落地”的步骤必须在 Phase 5 关闭前完成。

### Step 1：冻结 Contracts 和规范化规则（核心已落地，需补边界测试）

在 `packages/contracts` 定义 Manifest、Capability、ThemeRef、Installation、Binding、ResolutionContext、PluginSnapshot、校验报告和 API 请求/响应 Schema。实现稳定 JSON 规范化、SHA-256、禁止字段扫描、长度/深度限制和稳定错误码。

完成标准：同一语义 JSON 在键顺序或空白变化后得到相同哈希；未知字段、禁止字段、远程地址、无效 SemVer 和超限 Manifest 均被拒绝；所有调用方引用同一套 Contracts。

### Step 2：实现 `packages/plugin-sdk`（核心已落地，需补覆盖）

按架构文档新增 `packages/plugin-sdk`，至少包含：

- `parseManifest()`：JSON 解析和严格 Schema 校验；
- `canonicalizeManifest()` / `hashManifest()`：规范化和内容哈希；
- `validateCapabilities()`：模板、Theme、语义、Validator 和示例校验；
- `checkCompatibility()`：API、Flint Adapter 和 Renderer 检查；
- `resolveTheme()`：继承图、循环和最终 Theme 配置；
- `compileValidators()`：把规则 DSL 转为平台内部的受限谓词，不使用动态代码；
- `buildCapabilityCatalog()` / `detectConflicts()`：来源完整的能力目录和冲突报告；
- `builtin-manifests/`：提交到仓库、可审查、可复现的内置 Manifest。

完成标准：内置和上传 Manifest 走同一解析路径；SDK 的纯函数测试覆盖禁止代码、Theme 循环、Validator 未知规则、Renderer allowlist、重复能力和同版本哈希冲突。

### Step 3：增加 DB Schema 和迁移（结构与 0007 已落地，临时库迁移验收已完成）

`packages/db/src/schema.ts`、`packages/db/drizzle/0007_lush_starbolt.sql` 和 `packages/db/drizzle/0010_plugin_usage.sql` 已增加 `plugin_manifests`、`plugin_installations`、`project_plugin_bindings` 及相关枚举、约束和索引，并为 `generation_jobs`、`chart_revisions`、`project_themes` 增加插件/Theme 字段。`pnpm db:verify` 会在隔离 schema 执行工作树中的完整 SQL 链，先写入代表 Phase 2–4 的历史 Job/Revision/Theme，再验证新字段默认值、既有输出和部分唯一索引；部署数据库仍需按发布流程执行同一命令并确认实际备份/回滚策略。不得再次生成或覆盖 0007。

完成标准：跨 Workspace 的 Manifest、Installation 和 Binding 关系无法通过 Repository 查询绕过作用域；历史 Job/Revision 在新字段默认值下可以读取；删除/撤销操作不会级联删除旧 Revision 或其输出对象。

### Step 4：实现安装、启用和审计服务（核心与并发审计验收已落地）

在 `packages/plugin-sdk` 或独立的 Extensions 领域服务中实现 `PluginInstallationService`、`ProjectPluginService` 和 `PluginResolutionService`。所有方法接收 `workspaceId`，Project 方法同时接收 `projectId`；服务负责幂等、expected version、冲突、兼容性、软撤销和 `audit_events`。当前服务已对 Workspace、Project 做事务锁定，并对权限拒绝和 409 冲突写入带 request ID 的失败审计。

安装事务建议顺序：

1. 解析和校验 Manifest；
2. 规范化并计算哈希；
3. 检查同 Workspace 的版本/哈希冲突；
4. 写入不可变 Manifest Version；
5. 创建或恢复 Workspace Installation；
6. 写入 `plugin.installed` 审计事件。

启用事务建议顺序：

1. 锁定 Project 和 Installation，并确认 Workspace 相同；
2. 确认安装状态和当前兼容性；
3. 构建 Project 能力目录并检测全部冲突；
4. 写入精确版本 Binding；
5. 写入 `plugin.enabled` 或 `plugin.disabled` 审计事件。

完成标准：相同请求重试不会生成重复 Installation/Binding；无权限用户不能改变状态；同一 Project 的重复版本和能力冲突会原子失败；撤销后历史 Revision 和审计记录仍可读。

补充验证：安装、启用、禁用、撤销和恢复接口的成功响应已返回对应审计事件 ID；API 测试通过 `auditEventId` 和 `requestId + entityId + action` 双重定位审计，并覆盖权限拒绝、幂等冲突、同一安装幂等键并发和 Theme `expectedVersion` 并发冲突。

### Step 5：接入 Generation Job 和 Chart Revision（核心闭环已落地，隔离生产链路已验收）

在 API 创建 Generation Job 时解析并写入 `plugin_context`，把其哈希加入 `inputFingerprint`。Generation Worker 只消费 Job 快照；Render Worker 创建 Revision 时写入实际使用能力的 `plugin_snapshot`。插件内容不得覆盖平台基础校验和 Renderer allowlist。Render Worker 对同一个 Job 使用 PostgreSQL advisory lock 做 single-flight，未取得锁的并发调用交给后续轮询，已有 Revision 恢复逻辑保持幂等。API 集成测试、真实 PostgreSQL/MinIO Worker/Render 测试和隔离生产 Compose 链路已验证模板、语义、Validator、Theme、SVG/PNG/Vega-Lite、撤销后的历史快照以及失败 Job 不创建 Revision。

完成标准：改变 Project 插件启用集合会改变后续 Job fingerprint；同一个已创建 Job 不会因当前启用集合变化而改变输入；生成失败不会创建成功 Revision；删除/撤销插件后旧 Revision 仍能预览、导出并显示插件来源；Revision 能区分启用但未使用的能力与实际使用的能力；插件 Theme 经安全解析后确实影响 Flint Spec/导出，或者明确记录为未使用。

### Step 6：增加 API 和 Web 管理界面（已落地，需异常态、跨域权限和部署验收）

API 路由已覆盖 Workspace 插件目录、Manifest 校验/安装/撤销/恢复、Project 启用/禁用、能力目录和 Revision 追溯；`apps/web/app/plugins/page.tsx` 已提供 Workspace/Project 两层管理入口，API Console 继续保留为调试入口；主工作台也已显示 Revision 插件快照条，并通过独立追溯请求处理 loading、无插件和损坏状态。核心角色读写权限已有 API 集成覆盖，本地 Chrome 已完成浏览器全链路验收，剩余工作是更完整的跨 Workspace/Revision 权限矩阵和部署环境验收。

完成标准：管理员可从上传到安装，Project Editor 可在已安装范围内启用精确版本；Viewer/Reviewer 不能修改；用户能在生成前看到冲突和 Theme 来源，在 Revision 中看到实际插件版本与哈希。

### Step 7：接入正式认证和运行时边界（签名 JWT 边界已落地，待部署网关验收）

`apps/api/src/auth.ts` 已将 `x-user-id`/`local-dev-user` 限制在非生产环境；配置 `AUTH_JWT_SECRET` 后，`buildApp` 自动验证 HS256 Bearer/Cookie Token 并将 `sub` 写入 `request.user`，也支持部署侧通过 `authProvider` 注入用户。当前 API 集成测试已覆盖 Owner/Admin 安装、Editor 启用、Reviewer 只读、Viewer 拒绝 Project 插件/能力读取和跨 Workspace 资源 ID；剩余工作是配置真实 Token 签发网关并完成部署登录回归。

完成标准：生产环境没有可伪造的用户身份头；权限矩阵与第 8 节一致；跨 Workspace 的 Installation、Binding、能力和 Revision 请求统一返回约定的 403/404；审计记录使用真实操作者 ID。

### Step 8：补齐迁移、兼容性和端到端验证（本地及隔离生产 Compose 已完成，待真实部署验收）

使用内置销售插件完成一条垂直验收：安装 → Project 启用 → 模板/语义发现 → Theme 选择 → Validator → 生成 → Revision 快照 → 撤销插件 → 历史 Revision 读取。该链路已在本地 Chrome、真实 PostgreSQL/MinIO Worker/Render 和隔离生产 Compose 中通过；上传 Manifest 的读取 → 校验 → 安装 → 启用 → 撤销路径、追溯卡片的损坏态和无插件态也已通过浏览器验收。失败重试已覆盖可恢复的 `RENDER_FAILED` 重新入队、并发幂等、不可重试错误和次数上限；本地及隔离生产迁移兼容、签名 JWT、Session Cookie 和 `/ready` 回归已通过，仍需在 ECS 部署数据库、真实登录网关和 Vercel/ECS 生产环境执行验收。

完成标准：所有路线图验收、权限、越权、幂等、并发、删除保留、版本漂移、Theme 实际渲染和错误分类测试通过；文档中的字段、状态、API 和前端入口与最终实现一致。

## 13. 测试与路线图验收

### 13.1 必须覆盖的测试

- 未知顶层字段、未知能力字段和递归禁止键会被拒绝；
- Manifest 中的 `entrypoint`、`runtime`、`script`、`code`、`eval`、远程地址和任意 Renderer 会被拒绝；
- 同一 Workspace 同一 `pluginId + version` 的不同哈希不能覆盖或并存为可用版本；
- 内置 Manifest 和管理员上传 Manifest 使用同一校验、规范化和哈希路径；
- 非 Workspace Owner/Admin 不能上传、安装、撤销或恢复插件；
- Project Editor 不能安装 Workspace 插件，但可以启用/禁用当前 Project 已安装的精确版本；
- 跨 Workspace/Project 的 Installation、Binding、能力和 Revision 查询不泄露资源；
- 同一 Project 不能同时启用同一 `pluginId` 的两个版本；
- 两个插件声明相同 `kind + id` 时，启用或生成被阻止并返回全部来源；
- Theme 未知父节点、循环、超深继承和外部资源会被拒绝；
- Validator 只执行 allowlist DSL，平台基础校验不能被插件关闭；
- Generation Job 的 `plugin_context` 固化启用版本，插件状态变化不会改写排队中的 Job；
- `inputFingerprint` 包含插件上下文哈希，插件集合/版本/内容变化不会错误复用旧 Job；
- Chart Revision 的 `plugin_snapshot` 包含实际使用能力和完整来源，插件撤销/删除不影响历史预览和导出；
- Template 的 `requiredFields`、`allowedRenderers` 和插件语义提示参与生成前确定性校验，并保留实际使用能力引用；
- 选中的插件 Theme 能够转换为 Flint Adapter 可消费的安全 Theme 配置，并在 SVG/PNG/Vega-Lite 输出中可观察；
- 安装、启用、禁用、撤销、恢复、冲突和权限拒绝均有追加式审计事件；
- 相同安装/启用请求重试和并发执行不会创建重复或互相覆盖的状态；
- `POST /api/v1/generation-jobs/:jobId/retry` 只重新入队可恢复的生成/渲染失败；确定性失败和超过三次尝试返回稳定错误码，已有 Revision 恢复时不会生成重复版本；
- Web 设置页覆盖加载、空目录、上传校验、安装确认、撤销/恢复、冲突、权限不足和网络失败；
- `pnpm --filter @langreport/web typecheck`、API/SDK/插件服务测试和数据库迁移验收全部通过。

### 13.2 对应路线图验收

| 路线图要求 | 可观察验收 |
| --- | --- |
| Plugin Manifest Schema | `packages/contracts` 和 `packages/plugin-sdk` 对 Manifest、能力和校验报告做严格 Schema 校验 |
| 内置插件目录 | 仓库内有可审查的内置 Manifest，Workspace 可以查看并安装，Project 仍需显式启用 |
| 管理员上传和安装 | Owner/Admin 可上传、校验、查看报告并创建 Workspace Installation；其他角色被拒绝 |
| 版本、哈希和兼容性检查 | Installation 和 Job 显示精确 SemVer、canonical SHA-256、Adapter/Renderer 兼容性 |
| Project 启用/禁用 | Binding 指向精确 Installation，启用集合变化有审计且不影响历史 Revision |
| 模板、Theme、语义、Validator 能力发现 | Project 能力目录和 Generation Job context 返回每项能力的来源插件/版本 |
| 插件冲突检测 | 重复能力 ID、重复插件版本和不兼容 Renderer 阻止启用/生成并展示来源 |
| 未知字段或可执行代码拒绝 | strict Schema、递归禁止字段和地址检查返回稳定错误码 |
| Web 插件管理入口 | Workspace 设置可完成目录/校验/安装/撤销/恢复；Project 设置可完成启用/禁用和能力查看；Revision 可查看快照 |
| 前端不绕过服务端规则 | 前端只提交 Manifest、精确 Installation、ThemeRef 和并发参数；权限/冲突/兼容性由 API 决定 |
| Project 使用精确插件版本 | Job/Revision 保存 `pluginId + version + contentHash`，不存在 `latest` 或浮动范围引用 |
| 插件删除不破坏已有 Chart Revision | 撤销/软删除只阻止新生成；历史 Revision 使用自身 `plugin_snapshot` 和输出对象继续可读 |

## 14. 建议交付顺序

按“先修正事实基线，再补一条可验收垂直闭环”的顺序实施，不重复开发已经存在的核心代码：

1. **基线和迁移验收**：确认 `0007_lush_starbolt.sql`、`0010_plugin_usage.sql` 已纳入迁移链；`pnpm db:verify` 已自动验证插件表、JSONB 默认值、历史 Phase 2–4 数据和唯一索引，发布前仍需在部署数据库执行同一校验并确认实际备份/回滚策略；
2. **认证收口**：配置 `AUTH_JWT_SECRET`、Issuer/Audience 和外部登录网关，使签名 JWT 的 `sub` 进入 `request.user`；保持生产环境关闭伪造 `x-user-id` 的路径，补真实登录回归；
3. **服务和 API 收口**：安装/启用/撤销/恢复的事务锁、并发、幂等、request ID 审计、审计事件 ID 回执和错误响应测试已补。明确 JSON-only MVP，multipart 原始文件上传另列任务；
4. **能力闭环**：Template `requiredFields`、语义提示、Validator 引用和 `usedCapabilities` 已接入；插件 Theme 已完成到 Flint Spec/Renderer 的安全转换，真实 PostgreSQL/MinIO Worker 输出差异已验证，剩余部署环境验收；
5. **Workspace 管理入口**：`/plugins` 已实现目录、Manifest 校验、安装、安装状态、撤销和恢复；成功后刷新服务端状态，失败显示稳定错误码；
6. **Project 扩展入口**：`/plugins` 已实现 Binding 列表、精确版本启用/禁用、能力目录和 Plugin Theme 选择；使用 `expectedVersion + idempotencyKey`；
7. **Revision 追溯入口**：主工作台已展示实际使用插件数量、能力数量、ThemeRef 和 Renderer；本地 Chrome 已验收撤销后的历史快照、独立追溯 API、损坏态和无插件态；
8. **端到端验收和发布门槛**：真实 Worker/Render 的撤销后历史 Revision、失败 Job、可恢复失败重试、Theme 实际输出、桌面/移动端页面、迁移兼容、签名 JWT 回归和全部类型检查已通过；隔离生产 Compose 也已完成迁移后启动、认证、插件和完整导出链路验收，仍需执行 ECS 部署数据库、真实登录网关和 Vercel/ECS 生产环境验收。

Phase 5 完成的判定标准是：管理员可以安装一个通过严格校验的声明式插件；Project 可以启用该插件的精确版本；生成链路可以发现并使用其模板、Theme、语义和 Validator；冲突、不兼容、越权和重试都有明确结果；生成的 Chart Revision 保存插件来源与能力快照；插件被撤销或删除后，已有 Revision 的预览、导出和审计仍然完整。
