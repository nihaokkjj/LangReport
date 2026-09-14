# Plugin Manifest 设计

> Plugin Manifest 是声明式能力的版本化载体。第一阶段只接受随平台版本发布、已审核的内置 Manifest，用于模板、Theme、字段语义和追加校验规则；Workspace Owner/Admin 只能安装、撤销或恢复目录中的精确版本，Project Owner、Admin、Editor 只能启用或禁用已安装的内置能力。平台不接受上传或任意 Manifest。现有 Manifest 生命周期基础设施保留为内置能力追溯和后续阶段基础，不构成插件市场承诺。

## 1. 目标

Plugin Manifest 是 LangReport 的声明式扩展格式。它让管理员为 Workspace 安装可复用的图表模板、Theme、字段语义和校验规则，再由 Project 选择启用。

Manifest 描述能力，不携带可执行服务器端代码。它不是 npm 包，也不是任意 JavaScript 的沙箱替代品。

## 2. 能力范围

Manifest 当前支持以下声明式能力：

- `template`：图表类型、字段要求、默认 Flint Spec 片段和使用说明
- `theme`：可继承的 Flint ThemeSpec
- `semantic-type`：字段语义名称、描述和识别提示
- `validator`：基于规则 DSL 的字段、数据和规范校验
- `example`：用于模型理解和用户预览的输入/输出样例
- `renderer`：平台已内置且允许使用的渲染后端名称

当前及后续声明式 Manifest 都不支持以下字段或能力：

- `entrypoint`
- `runtime`
- `script`
- `code`
- `eval`
- 任意远程代码地址
- 未经平台发布的渲染后端

## 3. Manifest 示例

下面是平台 Manifest 包络的示例。`template.payload` 和 `theme.payload` 的具体内容由固定版本的 Flint Adapter 校验，不应把本示例当作 Flint 官方完整 Schema。

```json
{
  "$schema": "https://langreport.example/schemas/plugin-manifest/v1.json",
  "apiVersion": "langreport.dev/v1",
  "kind": "ChartPlugin",
  "metadata": {
    "id": "sales-editorial",
    "version": "1.0.0",
    "name": "Sales Editorial",
    "description": "销售趋势和区域对比图表规范"
  },
  "compatibility": {
    "flintAdapter": ">=0.1 <0.2",
    "renderers": ["vega-lite"]
  },
  "templates": [
    {
      "id": "monthly-regional-sales",
      "name": "月度区域销售",
      "intentHints": ["销售趋势", "区域对比", "同比"],
      "requiredFields": [
        { "role": "time", "semanticTypes": ["Date", "Month"] },
        { "role": "category", "semanticTypes": ["Region", "Category"] },
        { "role": "measure", "semanticTypes": ["Quantity", "Currency"] }
      ],
      "allowedRenderers": ["vega-lite"],
      "payload": {
        "chartType": "Line Chart",
        "encodings": {
          "x": { "fieldRole": "time" },
          "y": { "fieldRole": "measure" },
          "color": { "fieldRole": "category" }
        }
      }
    }
  ],
  "themes": [
    {
      "id": "sales-brand",
      "name": "Sales Brand",
      "payload": {
        "extends": "economist",
        "ink": { "series": { "single": "#2563EB" } }
      }
    }
  ],
  "semanticTypes": [
    {
      "id": "Region",
      "description": "表示销售区域或地理分区",
      "examples": ["华东", "华南", "North America"]
    }
  ],
  "validators": [
    {
      "id": "time-required-for-trend",
      "when": { "templateId": "monthly-regional-sales" },
      "rules": [
        {
          "kind": "required-role",
          "role": "time",
          "severity": "error",
          "message": "趋势图必须包含时间字段"
        }
      ]
    }
  ],
  "examples": [
    {
      "prompt": "按月份展示各区域销售额趋势",
      "templateId": "monthly-regional-sales"
    }
  ]
}
```

## 4. 第一阶段安装与启用流程

```text
平台内置 Manifest 目录
        ↓
Workspace Owner / Admin 选择精确版本
        ↓
校验 Schema、能力、兼容性和内置内容哈希
        ↓
安装 / 撤销 / 恢复 Workspace Installation
        ↓
Project Owner / Admin / Editor 启用精确版本
        ↓
生成前解析兼容能力
        ↓
Generation Job 固化 Plugin Context
        ↓
Chart Revision 固化 Plugin Snapshot
```

Manifest 安装记录必须保存 `pluginId`、版本、内容哈希、安装人、安装时间、兼容的 Flint Adapter 和当前状态。

校验接口虽然接收 Manifest 文档，但只在其 `pluginId`、版本和规范化内容哈希与平台内置目录完全一致时通过；修改过的内置 Manifest 或未知 Manifest 返回 `PLUGIN_BUILTIN_NOT_FOUND`。安装请求的 `source` 必须是 `builtin`；`uploaded` 返回 `PLUGIN_UPLOADED_DISABLED`。

## 5. 后续上传扩展

管理员上传、待审核状态、签名或来源信誉、恶意内容处置和插件市场不属于第一阶段。以后若开放这些能力，必须另行设计治理、权限、审核、撤回和兼容策略；不能复用当前接口绕过内置目录校验。

## 6. 版本和兼容性

- `apiVersion` 决定平台如何解释包络格式。
- `metadata.version` 必须遵守 SemVer 或平台指定的等价规则。
- Project 启用的是精确版本，不是浮动范围。
- Flint Adapter 升级后，旧版本 Revision 继续使用原始渲染元数据重新渲染或直接读取已保存产物。
- 删除插件不会删除已有 Chart Revision；只会阻止新生成使用该插件。

## 7. 能力解析

生成前，Generation Worker 只把当前 Project 已启用且兼容的插件能力提供给模型。解析结果必须包含来源插件和版本，写入 Chart Revision 的生成元数据。

多个插件声明同一个模板或语义时，不允许静默覆盖。系统应要求管理员选择优先级，或者将冲突标记为不可用。

## 8. 校验规则

Validator 只能使用平台提供的声明式规则，例如：

- 必须存在某种字段角色
- 字段必须匹配某种语义类型
- 数值范围或空值率限制
- 类别基数上限
- 规范字段必须来自 Data Snapshot
- 只能使用允许的 renderer

复杂业务校验先作为平台能力增加，不通过插件执行任意表达式解决。

插件 Validator 只能追加约束，不能替换、关闭或降低平台核心的字段、TransformPlan、Flint Spec、Renderer 和产物校验。
