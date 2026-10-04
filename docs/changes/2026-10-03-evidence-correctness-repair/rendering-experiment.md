# 渲染兼容性实验记录

- change-id：`CHG-2026-10-03-evidence-correctness-repair`
- 状态：`T2_NOT_PASSED`
- 创建时间：2026-10-03
- 更新时间：2026-10-04

用户已要求继续 A 批实施。最初增加六项数据回归和两项渲染回归时，新增八项均失败，原有测试分别五项、九项通过。这是修复前记录；随后数据实现已修改，渲染生产实现仍未替换，三项渲染失败回归保留。

实施前 658 个文件及 SHA-256 清单保存于 `C:\Users\sai_8\.codex\visualizations\2026\10\03\01a100b7-383f-7873-84e2-beebc5f0634b\repair-baseline`，包含完整混合工作树、tracked.patch、status.txt 和失败测试原始输出。

实验位于 `D:\front\newProject\agent-tasks\runtime-experiment`，使用隔离安装的 Vega 6.4.0、Vega-Lite 6.4.3 和产品已锁定的 Flint 0.5.1 / sharp。入口为 probe.mjs、budget.mjs；原始输出为 results.json、budget-results.json。仅使用合成数据，无真实服务调用。

## 观察结果

- 三种图表可在 Windows/Node 生成 SVG/PNG；中文样例可显示，但默认窄画布存在标题裁切和标签拥挤。
- Flint 默认编译把 600 行、100000 行输入都裁为 215 行，最大值也变为 215。仅固定最终尺寸到 900×360 无法恢复数据。
- 调整公开 minStep/maxColorValues 参数后，600 行可以完整保留；100000 行也保留，但 SVG 达 44138174 字节，单次耗时约 14.4 秒，最终进程 RSS 1448394752 字节。
- 数值是单次同进程测量，不是五次中位数或额外峰值内存；不将解析预算冒充渲染预算。
- 根因在安装包 `src/vegalite/assemble.ts` 的 computeChannelBudgets → filterOverflow → filteredData 链路，发生在运行时渲染之前。

## 门禁与下一步

补充实验 canonical.mjs 使用公开 maxStretch/maxColorValues 避免预编译截断，逐行临时身份验证集合完全相等，再冻结900×360尺寸；仅稀疏轴标签，不删除 marks。600/10000行的 Bar/Line/Area 均保留全部输入，SVG 经 sharp 生成尺寸正确的 PNG。单次10000行耗时约0.32–0.48秒，最终 RSS 约233MB；不代表峰值或五次中位数。Chromium 离线宿主悬停取值通过；多系列显式色板、390px宽度重新布局后人工截图检查可读。最初整体SVG缩放造成移动文字过小，已弃用。压缩后的独立运行时文件合计260374字节，不等于产品构建增量。加载器已配置拒绝资源，恶意输入测试和产品集成尚未执行。

T2 未通过，T3 尚未接入产品。ADR-0032 保持 Proposed。继续验证非截断编译配置、固定尺寸、主题、浏览器交互和渲染预算；不能通过编译后简单替换 data 假定尺度与布局仍正确。允许稀疏轴标签，不能删数据 marks；超预算须明确失败和建议用户确认聚合。100000 行源输入目标保持。

十万行补测仍显示高基数风险：Bar 约4.62秒/SVG17.93MB，Line约11.99秒，Area约11.41秒；同进程最终RSS最高约993MB。稀疏标签改善了输出大小，但没有消除完整大量marks的运行时成本。原始结果见 [100k测量](./evidence/render-canonical-100k.json)，[移动重排截图](./evidence/render-canonical-mobile.png)、[桌面截图](./evidence/render-canonical-desktop.png)。这些是单次实验，不代表峰值预算或产品集成验收。后续必须落实显式绘图预算和超限聚合提示，并验证安全输入，T2不能以10k通过推断100k通过。

T4 数据正确性可按原任务依赖独立推进，必须同时落实版本化执行与旧 Snapshot 不变。产品依赖、运行时、历史输出尚未因实验改变。

## 安全加载补测

loader-probe.mjs 用自定义拒绝loader拦截HTTPS及file URL，没有进行网络或文件读取；两种输入均调用拒绝函数，但运行时仍resolve并输出3106字节空SVG。不能只依赖loader抛错或SVG根元素验证成功。后续统一宿主必须在执行前拒绝外部资源规范，并记录loader拒绝标志；出现该标志时整体失败，不允许提交空图。该发现仍属于T2实验，产品尚未接入。

guarded-runtime.mjs 实验边界对平台单视图规范预检查，拒绝外部data、资源/表达式键、非标量数据、超100000行和超32MiB规范，并在运行后检查loader拒绝标志及输出大小。guard-probe八类非法输入均明确失败（包括过滤与参数表达式），标题脚本文本转义通过；该原型尚非产品安全合同，时间/内存隔离仍须完成。[守卫结果](./evidence/render-guard-results.json)。geometry-probe直接检查Vega场景图，全正/全负/混合零与null柱形的数量、零基线、方向、1:2长度及绘图区范围均通过，[几何结果](./evidence/render-geometry-results.json)。

## 五轮测量与待决资源取舍

Windows / Node22.22.2 / i5-13500HX / 约16GB物理内存，五轮各启一个Node进程，每轮依次渲染十万行Bar/Line/Area并编码PNG。中位耗时分别4541.28/11222.01/9729.60ms，进程峰值最高1096945664字节。峰值包含同进程三种图形，不能归因于某一种图形；数据构造不计入单图计时，进程未做预热，结果是冷进程重复测量。每轮60秒保护均未触发。原始证据：[五轮结果](./evidence/render-repeat-budget.json)。

补充Chromium600行场景图断言：标记600个，第600行异常值99999保留，见[浏览器完整性](./evidence/render-browser-complete.json)。这些证据证明候选能保留数据，并不证明无资源约束的直接接入可上线。

待用户选择资源策略：A保留十万条绘图结果，增加隔离执行、超时和内存约束，并补浏览器大规模响应性验证；B将绘图结果预算定为一万条，超限要求确认聚合，源数据十万行输入目标保持。两者均不截断或隐式Top-N。该选择影响用户可直接展示的范围及运行成本，未收到答案前不冻结阈值、不进入T3。T2仍为NOT_PASSED。

## 2026-10-04 跨运行时语义复验

cross-runtime-probe.mjs 对同一份受限Vega-Lite规范分别在Node和离线Chromium编译、执行，直接比较场景图数据、位置、颜色和defined状态。Line/Area各用两个系列、每系列四个乱序期间和一个null：两端8个场景项完全一致，每系列按1/2/3/4排序，两个缺失值均标为断点；Area填充颜色与零基线通过。原始结果：[跨端场景图](./evidence/render-cross-runtime-results.json)。

本次明确设置不堆叠和缺失值断开，验证范围是候选运行时消费相同规范；不证明当前Flint默认输出、产品浏览器宿主或所有堆叠规则已正确。资源策略仍待答复，T3未启动。
