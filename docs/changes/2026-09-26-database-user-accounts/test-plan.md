# 数据库账号管理：Test Plan

- 变更编号：CHG-2026-09-26-database-user-accounts
- 状态：ACCEPTED
- 创建时间：2026-09-26
- 更新时间：2026-09-26

## 测试范围

验证数据库身份唯一性、scrypt 密码流程、账号生命周期、首次启动迁移、JWT 兼容、Workspace/Project 隔离、账号页、CLI secret 处理和 Nginx/WAF 限速。真实部署测试只有在用户提供环境并要求执行时进行。

## 风险到测试映射

| 风险 | 测试类型 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| 启动重跑覆盖或重复创建账号 | DB integration | 空库首次启动、重复启动、两个 API 同时启动、用户表非空 | 只创建一次；现有账号/密码/状态不被配置覆盖 |
| 首次迁移只完成一半 | DB migration integration | 插入用户后成员迁移故意失败 | 整个事务回滚，无半成品账号或部分授权 |
| Workspace/Project 数据丢失 | DB integration | 预置 workspaces、members、projects、project_members 与历史业务记录 | 关系 user_id 更新；实体 ID、角色和历史作者值保持 |
| 用户名大小写绕过唯一约束 | API/CLI integration | 创建 Alice 后尝试 alice、带首尾空格的 ALICE | 唯一冲突；登录规范化到原账号 |
| 用户不存在或停用导致账号枚举 | API contract | 不存在、disabled、错密码登录 | 返回相同 401 错误；不泄露用户名存在性 |
| 密码明文泄露 | API/CLI log test | 创建、登录、改密、重置、错误输入 | DB 仅有 scrypt hash；输出、日志、响应没有输入秘密或 Cookie |
| 密码策略与确认不一致 | API/CLI unit | 用户改密 5、6 字符；共享配置 14、15 字符；空值/超长 | 用户密码 6 位通过、少于 6 被拒绝；共享密码至少 15 位 |
| 错误当前密码允许变更 | API integration | 带错 currentPassword 改密 | 失败且旧密码仍有效 |
| 自助改密意外撤销会话或延长有效期 | API auth integration | 改密前建立当前和第二设备 JWT，记录各自 exp；改密后分别请求并在测试时钟推进到 exp | 两个 JWT 在改密后均有效至各自原 exp，随后均被拒绝；exp 不延长，最长不超过 7 天 |
| 重置/停用意外撤销会话 | API auth integration | 有 JWT 时重置密码或停用账号 | 新登录被拒绝；原 JWT 仍有效至原 exp，之后拒绝 |
| 旧 JWT 身份迁移错误 | API/DB integration | 旧 sub alias 有效、过期、缺失映射 | 有效时解析到新 user id；过期/无映射时 401；不延长 exp |
| 应用无速率限制导致公网暴露 | Infra/integration | 通过 Nginx 多次失败并尝试直连 API | Nginx 达到策略后 429；公网无法直连 API；API 代码无 failure map |
| 首个用户读到错误 Workspace | API integration | 首次登录 /projects，检查旧关联后调用 ensurePersonalWorkspace | 复用迁移后的 Workspace；其他用户得到独立 Workspace |
| 账号 UI 泄露或不可用 | Web E2E/visual | 登录后访问 /account，desktop 与 390px | 可改密且错误/成功状态清楚，无密码持久化 |
| 文档/API Console 漂移 | Contract/docs check | Auth/password contract、OpenAPI、API Console | 字段、错误和示例一致，不包含共享凭据 |

## 测试数据与环境

- 迁移测试使用隔离 Postgres schema；不对用户生产数据库执行 destructive reset。
- 准备一个旧 AUTH_LOGIN_USER_ID、其私有 Workspace、Project、成员授权及审计记录；准备空库、已有 active/disabled 用户库。
- 使用虚构用户名、短测试密码和独立随机 JWT 密钥；不复制生产共享秘密、JWT 或 Cookie。
- CLI 测试把部署 secret 注入隔离进程环境，不放在 shell 参数中。
- Nginx 限速测试通过实际测试容器或配置解析入口；API 直连仅在隔离网络中验证。

## 自动化测试

实现完成后至少运行：

- pnpm --filter @langreport/db typecheck
- pnpm --filter @langreport/db db:verify
- pnpm --filter @langreport/api typecheck
- pnpm --filter @langreport/api test
- pnpm --filter @langreport/contracts test
- pnpm --filter @langreport/web typecheck
- pnpm --filter @langreport/web test:typecheck
- pnpm test:e2e
- pnpm docs:check
- 适用环境的 pnpm test:integration

独立验证 Agent 从实现快照运行本计划，输出 test-report.md；此文档阶段不执行上述测试。

## 人工验收步骤

1. 在本地或隔离环境启动空数据库，确认仅按显式引导配置创建首个 active 用户。
2. 连续重启服务，确认 username、密码、status 和用户 ID 不变化。
3. 迁移预置的旧 Workspace/Project，确认新首账号能访问原项目、实体 ID 不变、旧审计来源保留。
4. 使用大小写不同且带首尾空格的用户名登录；确认重复规范化用户名不能创建。
5. 用户在 /account 使用正确当前密码改成 6 个字符密码；错误当前密码不得更新。更改后当前设备和第二设备的 JWT 均继续有效到各自原 exp，不清除或延长 Cookie/JWT。
6. 使用 CLI 停用账号，确认新登录拒绝、数据未删除、旧 JWT 到原 exp 才失效；重新启用后用户可登录。
7. 使用 CLI 重置密码，确认重置值来自部署秘密、命令输出不包含秘密，账号能使用该值登录。
8. 检查旧 JWT 映射不能延长 exp，最长在 7 天后不再解析。
9. 通过入口连续失败登录，确认入口限速响应；验证生产 API 端口无法从入口外访问。
10. 检查 API Console 请求示例、错误反馈和 Web 账号页在 desktop/390px 宽度的交互。

## 不测试的内容及原因

- 不测试用户注册、邮件恢复、MFA、SSO、管理员网页和 Session 撤销表，因为不属于已确认范围。
- 未提供真实 HTTPS 地址与用户要求前，不执行生产 Secure Cookie Smoke；缺失证据必须继续记录为未验证。
- 本次设计文档阶段不运行项目测试，只做文档检查与 diff 检查。
