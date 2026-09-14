
# 接口调试平台验收标准

> 版本：v1.0
>
> 状态：执行基线
>
> 适用范围：LangReport 内部接口调试平台的契约、文档、调试、追踪和安全验收

## 1. 目标和边界

本标准用于验收一个内部使用的接口调试平台。平台必须能够读取后端接口契约、生成 OpenAPI 文档、提供 Swagger 调试入口，并通过自定义页面调试现有接口和异步 Generation Job。

接口调试平台属于工程和开发工具，不是新的业务聚合。MVP 不新增 Workspace、Project、Data Snapshot、Generation Cycle、Chart Artifact 或 Evidence Block 等业务实体，也不改变第一阶段咨询项目报告的产品边界。

当前代码清点基线为 60 个路由声明。实施前必须重新生成路由清单；数量变化不改变“每个公开路由必须有契约或明确隐藏理由”的验收要求。

## 2. 通过规则

以下任一硬性条件不满足，平台不能标记为完成：

- 现有项目、数据、生成、图表和审核链路回归通过；
- 公开接口的请求、响应和错误契约完整；
- OpenAPI 文档可被标准工具解析；
- Swagger 页面和自定义调试页面都使用同一份接口契约；
- 异步 Generation Job 的状态、失败原因和追踪信息可见；
- 生产环境的文档、身份和敏感信息受到保护；
- Workspace、Project、Data Snapshot、Chart Revision、Memory 和 Visual Template 不变量没有被破坏；
- 所有相关类型检查、契约测试、接口测试和端到端测试通过。

## 3. Loop 1：接口契约基线

### Outcome

为现有后端路由建立可执行、可生成文档的 HTTP 契约。

### 验收项

#### C1.1 路由清单

每个路由必须属于以下一种状态：

- 公开接口，并进入 OpenAPI 文档；
- 内部接口，并有内部标签和访问限制；
- 生产环境隐藏接口，并有隐藏理由。

代码中存在、但文档和清单均没有说明的路由，视为失败。

#### C1.2 请求契约

每个公开接口必须定义：

- HTTP Method；
- Path；
- Path 参数；
- Query 参数；
- Header 参数；
- Request Body；
- 必填字段；
- 默认值；
- 枚举值；
- 字段说明；
- JSON 或 Multipart 内容类型。

#### C1.3 响应契约

每个公开接口必须定义适用的成功响应，至少覆盖以下状态中的适用项：

~~~text
200 读取或重复请求成功
201 创建成功
202 异步任务已接受
400 请求参数错误
403 无权限
404 资源不存在
409 幂等或状态冲突
413 请求体超过限制
422 业务校验失败
500 服务异常
503 服务未就绪
~~~

响应契约使用稳定的公共 DTO，不直接暴露数据库表结构。

#### C1.4 错误契约

错误响应统一包含以下结构：

~~~json
{
  "error": "用户可读错误",
  "code": "STABLE_ERROR_CODE",
  "requestId": "request-id",
  "details": {}
}
~~~

现有 error 字段保持兼容；新增字段不能导致现有前端无法读取错误信息。

#### C1.5 路由元数据

每个公开接口必须具备：

- 唯一 operationId；
- summary；
- description；
- tags；
- 权限说明；
- 幂等说明；
- 成功响应说明；
- 失败响应说明。

### 完成条件

- 路由清单与代码一致；
- 没有重复 operationId；
- 没有未定义的 Path 参数；
- OpenAPI Schema 能表达所有公开请求和响应；
- 错误样例至少覆盖参数错误、权限错误、资源不存在和冲突错误；
- 契约测试通过。

### 必须提交的证据

- 路由清单；
- 契约清单；
- OpenAPI Schema 校验结果；
- 重复 operationId 检查结果；
- 错误响应样例。

## 4. Loop 2：OpenAPI 和 Swagger

### Outcome

后端自动提供合法、完整、可调试的 OpenAPI 文档和标准 Swagger 页面。

### 验收项

#### D2.1 文档地址

以下地址必须可用：

~~~text
GET /openapi.json
GET /docs
~~~

#### D2.2 文档有效性

/openapi.json 必须满足：

- 返回合法 JSON；
- 符合 OpenAPI 3.x；
- 可以被 Swagger UI 加载；
- 没有重复路径；
- 没有未解析的 $ref；
- 所有 Path 参数均已定义；
- 所有公开响应都有 Schema 或明确的空响应说明；
- 文档中没有泄露密钥、数据库连接信息或对象存储凭据。

#### D2.3 Swagger 调试

通过 /docs 至少完成以下接口调试：

~~~text
GET  /health
GET  /ready
POST /api/v1/dev/bootstrap
GET  /api/v1/projects
POST /api/v1/projects
POST /api/v1/projects/:projectId/data-assets/paste
POST /api/v1/projects/:projectId/metric-definitions
POST /api/v1/projects/:projectId/generation-jobs
GET  /api/v1/generation-jobs/:jobId
~~~

#### D2.4 内部接口

以下接口在生产环境必须关闭、隐藏或受管理员认证保护：

~~~text
/docs
/openapi.json
/api/v1/dev/bootstrap
~~~

### 完成条件

- /openapi.json 能被 OpenAPI 解析器校验；
- /docs 能加载全部公开接口；
- Try it out 可以发送 JSON 请求；
- Try it out 可以发送 Multipart 请求；
- 400、403、404、409 等错误可以在页面中观察到；
- 现有前端请求行为没有变化。

### 必须提交的证据

- /openapi.json 返回内容或测试产物；
- /docs 页面截图；
- 至少一条成功请求记录；
- 至少一条参数错误记录；
- 至少一条权限错误记录；
- 生产环境访问控制结果。

## 5. Loop 3：自定义调试页面

### Outcome

提供一个基于 OpenAPI 自动生成的接口调试页面，不为每个接口重复编写调试逻辑。

建议入口为：

~~~text
/api-console
~~~

### 验收项

#### UI3.1 自动生成

接口目录、参数表单、请求说明和响应结构必须来自 /openapi.json。

页面中不得维护与 OpenAPI 平行的完整接口清单和参数定义。

#### UI3.2 接口目录

必须支持：

- 按标签分组；
- 按 HTTP Method 筛选；
- 按路径搜索；
- 显示接口摘要；
- 标记内部接口；
- 显示当前环境。

#### UI3.3 请求编辑

必须支持：

- Path 参数；
- Query 参数；
- Header 参数；
- JSON Body；
- Multipart 文件；
- 必填字段提示；
- 枚举字段选择；
- 默认值填充；
- 请求重置。

#### UI3.4 响应展示

必须显示：

- HTTP 状态码；
- 响应耗时；
- 响应 Header；
- requestId；
- 格式化 JSON；
- 原始响应；
- 错误码；
- 错误详情；
- 复制响应内容；
- 复制 cURL；
- 重新发送。

#### UI3.5 请求历史

MVP 的请求历史可以保存在浏览器本地，但必须：

- 默认不保存 Authorization；
- 默认不保存 Cookie；
- 默认不保存 API Key；
- 不把完整客户数据上传到新的服务端存储；
- 支持删除历史记录。

#### UI3.6 响应式可用性

必须检查桌面和移动宽度下的：

- 长路径溢出；
- 大 JSON 响应滚动；
- 加载态；
- 空响应；
- 错误响应；
- 文件上传状态；
- 可操作按钮和输入框的触控区域。

### 完成条件

- 页面完全依赖 OpenAPI 生成接口信息；
- JSON、Query、Path、Header、Multipart 均可调试；
- 可以查看和复制请求、响应和 cURL；
- 刷新页面后本地历史行为符合设计；
- 桌面和移动端均可完成一次请求；
- Web 类型检查通过。

### 必须提交的证据

- 桌面端截图；
- 移动端截图；
- JSON 请求调试记录；
- Multipart 请求调试记录；
- 错误响应调试记录；
- cURL 复制结果；
- 本地历史清理结果。

## 6. Loop 4：Generation Job 场景

### Outcome

验证平台可以调试 LangReport 的核心异步生成链路。

### 验收流程

~~~text
健康检查
→ Bootstrap
→ 创建 Project
→ 粘贴示例数据
→ 确认 Metric Definition
→ 创建 Generation Job
→ 查询 Job 状态
→ 查看 Evidence Block
~~~

### 验收项

#### G4.1 异步状态

平台必须区分并展示：

~~~text
queued
profiling
planning
transforming
compiling
validating
rendering
succeeded
failed
~~~

HTTP 202 只代表任务已接受，不能直接显示为最终成功。

#### G4.2 任务失败

Generation Job 失败时必须显示：

- 失败状态；
- errorCode；
- errorMessage；
- requestId；
- generationJobId；
- 下一步建议。

失败时不得生成伪造的 Evidence Block。

#### G4.3 幂等性

重复提交同一个幂等键时：

- 不创建重复任务；
- 返回已有任务；
- 页面显示“复用已有任务”。

相同幂等键对应不同输入时，必须返回冲突错误。

#### G4.4 结果追溯

成功后能够查看：

- Data Snapshot；
- Metric Definition；
- TransformPlan；
- 字段血缘；
- Flint Spec；
- Visual Template 版本；
- 校验结果；
- Chart Revision；
- Evidence Block。

#### G4.5 审核不变量

通过调试平台执行操作时：

- Approved Chart Revision 仍然不可修改；
- 编辑必须产生新的 Chart Revision；
- 回滚不能覆盖历史 Revision；
- 调试平台不能绕过审核直接发布客户结论。

### 完成条件

- 至少完成一次成功生成；
- 至少完成一次失败生成；
- 至少完成一次幂等复用；
- 至少完成一次错误输入；
- 任务状态变化可见；
- 结果追溯链路完整。

### 必须提交的证据

- 成功生成记录；
- 失败生成记录；
- 幂等复用记录；
- 错误输入记录；
- Generation Job 状态变化记录；
- Evidence Block 追溯截图。

## 7. Loop 5：请求追踪和安全

### Outcome

确保接口调试平台可以被内部使用，但不会成为生产数据和身份安全漏洞。

### 验收项

#### S5.1 请求追踪

每次请求必须：

- 自动生成或接收 requestId；
- 在响应 Header 返回 x-request-id；
- 在服务端结构化日志中出现；
- 在错误响应中出现；
- 可以与 generationJobId 关联。

#### S5.2 日志字段

服务端日志至少包含：

~~~text
requestId
method
path
statusCode
duration
userId
projectId
generationJobId
errorCode
~~~

#### S5.3 身份安全

开发环境可以继续使用 x-user-id，但生产环境必须：

- 从真实认证上下文取得用户身份；
- 禁止客户端任意修改用户身份；
- 禁止调试页面伪造其他 Member；
- 不在前端持久化生产密钥。

#### S5.4 敏感数据

以下内容默认不得写入服务端日志：

~~~text
Authorization
Cookie
API Key
完整上传文件
完整客户数据
完整请求 Body
完整响应 Body
~~~

#### S5.5 环境隔离

调试页面必须区分：

~~~text
local
test
production
~~~

环境地址只能来自允许列表，不允许将任意后端地址作为调试目标。

### 完成条件

- 可以通过 requestId 找到对应服务端日志；
- 越权访问被拒绝；
- 生产环境文档受保护；
- 日志中没有密钥和完整客户数据；
- 生产环境不能通过请求头伪造用户身份。

### 必须提交的证据

- 未带身份请求结果；
- 越权访问结果；
- 生产环境 /docs 访问控制结果；
- 日志脱敏结果；
- requestId 全链路检索结果。

## 8. 回归验收

以下检查必须通过：

~~~text
pnpm typecheck
pnpm --filter @langreport/api typecheck
pnpm --filter @langreport/web typecheck
~~~

另外必须执行或新增：

- OpenAPI 文档校验；
- 路由与文档完整性检查；
- 错误响应测试；
- 权限测试；
- 幂等测试；
- Generation Job 状态测试；
- 关键链路端到端测试。

如果修改 apps/web，还必须完成桌面端、移动端、加载态、空态、错误态和溢出检查。

## 9. 最终验收结论

只有同时满足以下条件，才能宣布接口调试平台完成：

~~~text
契约完整
+ OpenAPI 有效
+ Swagger 可调试
+ 自定义页面可调试
+ Generation Job 可追踪
+ 错误可解释
+ requestId 可检索
+ 生产环境受保护
+ 现有业务回归通过
~~~

## 10. Loop 执行顺序

后续必须按以下顺序推进：

~~~text
Loop 1：接口契约基线
Loop 2：OpenAPI + Swagger
Loop 3：自定义调试页面
Loop 4：Generation Job 场景
Loop 5：安全、追踪和回归
~~~

未通过当前 Loop 前，不进入下一个 Loop。

每个 Loop 结束时提交：

~~~text
Outcome:
Changed:
Acceptance items passed:
Evidence:
Failed items:
Known limitations:
Next loop:
~~~
