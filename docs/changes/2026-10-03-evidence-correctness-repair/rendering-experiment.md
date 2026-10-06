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

2026-10-04 用户选择 B：单图最多 10,000 个绘制点；超出时提示先聚合，不截断或隐式 Top-N。源数据 100,000 行输入目标保持。产品已接入 Flint 编译前预算守卫、编译后行数校验及 Worker 聚合错误码；Generation 去除 500 类别门与静默 `limit 500`，Web 改读完整 Revision。10,000/10,001 边界和实际 10,000 标记 SVG/PNG 回归通过；桌面/移动浏览器确认完整 Revision 多于表格预览时不截取。运行时统一、安全守卫、完整资源预算和浏览器 10,000 点响应性尚未完成，T2 仍为 NOT_PASSED。

## 2026-10-04 跨运行时语义复验

cross-runtime-probe.mjs 对同一份受限Vega-Lite规范分别在Node和离线Chromium编译、执行，直接比较场景图数据、位置、颜色和defined状态。Line/Area各用两个系列、每系列四个乱序期间和一个null：两端8个场景项完全一致，每系列按1/2/3/4排序，两个缺失值均标为断点；Area填充颜色与零基线通过。原始结果：[跨端场景图](./evidence/render-cross-runtime-results.json)。

本次明确设置不堆叠和缺失值断开，验证范围是候选运行时消费相同规范；不证明当前Flint默认输出、产品浏览器宿主或所有堆叠规则已正确。资源策略已确定，产品统一渲染仍未完成。

## 2026-10-06 产品统一运行时与浏览器响应

本轮将 Vega 6.4.0、Vega-Lite 6.4.3 固定进产品锁文件。Flint Adapter 仍由 Flint 选择图形类型和编码，随后收窄为平台允许的单视图内联数据规范；服务端 Vega 执行同一规范生成 SVG，再由 sharp 编码 PNG。浏览器固定 Revision 读取数据库保存的同一 Vega-Lite 规范，1,000 点以上使用 Canvas，较小图使用 SVG；编辑预览使用当前 Revision 规范与未保存的 Patch 字段生成临时规范。旧手写 SVG 实现已移除。服务端与浏览器均在执行前拒绝外部数据、资源、表达式和不支持的 mark，并在 loader 尝试外部读取时失败。

Adapter 18/18 通过：10,000 点折线 SVG 路径含 9,999 个连续线段及末行，Bar/Area 也实际输出 10,000 点且保留末行；10,001 点明确拒绝；Area 填充、正负柱形比例、多系列分组/不堆叠/null 断点、主题、标题注释、SVG/PNG/HTML 校验及非法规范守卫通过。Playwright 桌面和移动各自的核心生成导出、图表编辑共 4/4 通过，完整 Revision 中超出 3 行表格预览的第 4 行可由键盘读出。浏览器 10,000 点五轮各视口全部通过：桌面 Canvas 绘制中位 133 ms（132–169 ms）、最大主线程采样间隔中位 289.2 ms（263.3–352.5 ms）；390px 移动视口绘制中位 138 ms（124–190 ms）、最大采样间隔中位 293.9 ms（259.1–346.1 ms）。两端均保留第 10,000 行键盘读出。原始日志见 [十轮浏览器测量](./evidence/vega-browser-10000-20261006.txt)。这是本机 Chromium 开发构建，不能推断低配设备或生产并发上限。

Next 16.3.3 生产构建成功。静态产物中四个可通过 `Vega-Lite`/`vega-lite`/`scaleBand` 文本定位的 JS chunk 合计 476,600 字节，gzip 后合计 146,715 字节；它只是可识别子集，不代表完整 Vega 动态依赖或页面总传输量，不据此声称构建体积预算通过。冻结锁文件离线校验退出 0。

真实 PostgreSQL→Render Worker→API 的 10,001 点失败检查已写入隔离测试入口；浏览器用例把 API 状态映射到固定测试 Job，只验证界面投影，没有从浏览器请求真实 API。本机 Docker Engine 返回 503，`54330` 与 `9002` 端口不可连接，隔离测试尚未执行。完整数据库→Worker→API→Web 失败链路与 T2/T3 最终门禁仍未通过。
