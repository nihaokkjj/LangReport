# LangReport HTTP 路由清单

> Loop 1 证据：接口契约基线
>
> 清点日期：2026-09-04
>
> 当前路由声明：60 个

本清单以 `packages/contracts/src/http.ts` 的 `routeContracts` 为契约来源，以 `apps/api/src/http-contracts.test.ts` 验证 Fastify 实际注册结果。API 启动时若发现代码路由没有对应契约，会直接失败，避免新增接口绕过契约基线。Loop 2 新增的文档入口也纳入契约注册，但不会作为业务接口重复展示在 OpenAPI paths 中。

## 路由状态

| 状态 | 数量 | 规则 |
| --- | ---: | --- |
| 公开接口 | 59 | 进入 OpenAPI 文档和调试平台 |
| 内部接口 | 3 | `POST /api/v1/dev/bootstrap`、`GET /openapi.json`、`GET /docs`；仅本地开发或受控内部调用 |
| 生产隐藏接口 | 0 | 没有单独分类的生产专用路由；3 个内部入口在生产环境统一返回 404 |

## 清单

### Health / Internal / Projects

- `GET /health` — `healthCheck` — 公开
- `GET /ready` — `readinessCheck` — 公开
- `POST /api/v1/dev/bootstrap` — `devBootstrap` — 内部
- `GET /openapi.json` — `getOpenApiDocument` — 内部，非生产环境文档入口
- `GET /docs` — `getSwaggerUi` — 内部，非生产环境文档入口
- `GET /api/v1/projects` — `listProjects` — 公开
- `POST /api/v1/projects` — `createProject` — 公开

### Plugins

- `GET /api/v1/workspaces/:workspaceId/plugin-catalog` — `listPluginCatalog` — 公开
- `POST /api/v1/workspaces/:workspaceId/plugins/validate` — `validatePluginManifest` — 公开
- `POST /api/v1/workspaces/:workspaceId/plugins` — `installPlugin` — 公开
- `GET /api/v1/workspaces/:workspaceId/plugins` — `listWorkspacePlugins` — 公开
- `GET /api/v1/workspaces/:workspaceId/plugins/:installationId` — `getWorkspacePlugin` — 公开
- `POST /api/v1/workspaces/:workspaceId/plugins/:installationId/revoke` — `revokePluginInstallation` — 公开
- `POST /api/v1/workspaces/:workspaceId/plugins/:installationId/restore` — `restorePluginInstallation` — 公开
- `GET /api/v1/projects/:projectId/plugins` — `listProjectPlugins` — 公开
- `PUT /api/v1/projects/:projectId/plugins/:installationId` — `setProjectPluginBinding` — 公开
- `GET /api/v1/projects/:projectId/capabilities` — `getProjectCapabilities` — 公开
- `GET /api/v1/chart-revisions/:revisionId/plugin-context` — `getRevisionPluginContext` — 公开

### Data Assets

- `GET /api/v1/projects/:projectId/data-assets` — `listDataAssets` — 公开
- `POST /api/v1/projects/:projectId/data-assets/upload` — `uploadDataAsset` — 公开
- `POST /api/v1/projects/:projectId/data-assets/paste` — `pasteDataAsset` — 公开
- `GET /api/v1/data-assets/:assetId` — `getDataAsset` — 公开

### Conversations / Analysis Brief / Metric Definitions

- `POST /api/v1/projects/:projectId/conversations` — `createConversation` — 公开
- `GET /api/v1/projects/:projectId/conversations` — `listConversations` — 公开
- `GET /api/v1/conversations/:conversationId/messages` — `listConversationMessages` — 公开
- `POST /api/v1/conversations/:conversationId/messages` — `createConversationMessage` — 公开
- `GET /api/v1/projects/:projectId/metric-definition` — `getMetricDefinition` — 公开
- `POST /api/v1/projects/:projectId/metric-definitions` — `createMetricDefinition` — 公开
- `GET /api/v1/projects/:projectId/analysis-brief` — `getAnalysisBrief` — 公开
- `GET /api/v1/projects/:projectId/evidence-blocks` — `listEvidenceBlocks` — 公开

### Generation Jobs

- `POST /api/v1/projects/:projectId/generation-jobs` — `createGenerationJob` — 公开
- `POST /api/v1/projects/:projectId/generate` — `createGenerationJobAlias` — 公开
- `GET /api/v1/generation-jobs/:jobId` — `getGenerationJob` — 公开
- `GET /api/v1/generation-jobs/:jobId/outputs/:format` — `getGenerationJobOutput` — 公开

### Memory

- `GET /api/v1/conversations/:conversationId/memory` — `getConversationMemory` — 公开
- `GET /api/v1/projects/:projectId/memory-candidates` — `listMemoryCandidates` — 公开
- `POST /api/v1/memory-candidates/:candidateId/accept` — `acceptMemoryCandidate` — 公开
- `POST /api/v1/memory-candidates/:candidateId/reject` — `rejectMemoryCandidate` — 公开
- `GET /api/v1/projects/:projectId/memories` — `listProjectMemory` — 公开
- `GET /api/v1/workspaces/:workspaceId/memories` — `listWorkspaceMemory` — 公开
- `DELETE /api/v1/memories/:memoryId` — `deleteMemory` — 公开
- `GET /api/v1/chart-revisions/:revisionId/memory-context` — `getRevisionMemoryContext` — 公开

### Chart Artifacts / Revisions / Reviews

- `GET /api/v1/projects/:projectId/chart-artifacts` — `listChartArtifacts` — 公开
- `GET /api/v1/projects/:projectId/chart-artifacts/:artifactId` — `getChartArtifact` — 公开
- `POST /api/v1/projects/:projectId/chart-artifacts/:artifactId/archive` — `archiveChartArtifact` — 公开
- `GET /api/v1/chart-revisions/:revisionId` — `getChartRevision` — 公开
- `GET /api/v1/chart-revisions/:revisionId/compare/:otherRevisionId` — `compareChartRevisions` — 公开
- `POST /api/v1/chart-artifacts/:artifactId/revisions` — `createChartRevisionCommand` — 公开
- `POST /api/v1/chart-revisions/:revisionId/submit` — `submitChartRevision` — 公开
- `POST /api/v1/chart-revisions/:revisionId/approve` — `approveChartRevision` — 公开
- `POST /api/v1/chart-revisions/:revisionId/request-changes` — `requestRevisionChanges` — 公开
- `POST /api/v1/chart-revisions/:revisionId/reopen` — `reopenChartRevision` — 公开
- `POST /api/v1/chart-revisions/:revisionId/archive` — `archiveChartRevision` — 公开
- `GET /api/v1/chart-revisions/:revisionId/comments` — `listRevisionComments` — 公开
- `POST /api/v1/chart-revisions/:revisionId/comments` — `createRevisionComment` — 公开
- `POST /api/v1/comments/:commentId/resolve` — `resolveChartComment` — 公开
- `GET /api/v1/projects/:projectId/theme` — `getProjectTheme` — 公开
- `PUT /api/v1/projects/:projectId/theme` — `updateProjectTheme` — 公开
- `GET /api/v1/chart-revisions/:revisionId/outputs/:format` — `getChartRevisionOutput` — 公开

### Shares

- `POST /api/v1/chart-revisions/:revisionId/shares` — `createRevisionShare` — 公开
- `GET /api/v1/chart-shares/:shareId` — `getChartShare` — 公开
- `POST /api/v1/chart-shares/:shareId/revoke` — `revokeChartShare` — 公开

## 检查结果

- `routeContracts` 与清单均为 62 条，其中 59 个业务接口进入 OpenAPI paths，3 个内部入口按环境保护。
- operationId 唯一。
- 所有路径参数均出现在请求契约的 `params` 中，并标记为必填。
- Fastify 路由注册测试通过；漏登记契约会在 `app.ready()` 阶段失败。
