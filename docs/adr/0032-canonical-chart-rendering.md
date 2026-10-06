# ADR-0032：统一固定版本图表的渲染语义

- change-id：`CHG-2026-10-03-evidence-correctness-repair`
- 状态：`Proposed`（产品候选已实施，验收未完成）
- 创建时间：2026-10-03
- 更新时间：2026-10-03

## 问题

前端 SVG、服务端 SVG/PNG 和 Flint 生成的 Vega-Lite 分别实现图形。已复现负数、Area、画布边界和前 500 行预览差异，用户看到与导出的证据可能不同。

## 提议

保留 Flint Spec 和受限编辑入口，以服务端固定输入编译出的 Vega-Lite 作为唯一图形语义来源，保存规范与哈希；浏览器交互预览和服务端输出使用兼容且锁定的编译/运行时链。表格 previewData 不作为图表输入。HTML 从同一次候选输出和固定 Revision 元数据生成。

不开放任意 Vega/JavaScript、外部数据 URL 或服务器文件给用户；客户端不引入 flint-adapter 后端包和 sharp。新依赖、运行时版本、资源 loader、字体与构建体积必须在授权后的 T2 验证并锁定。本 ADR 不声称当前 lockfile 已包含或验证这些运行时。

## 替代方案与取舍

继续维护三套绘图逻辑改动较小但长期易分叉；仅展示服务端图片缺少产品要求的交互；全换图表技术栈扩大范围。提议方案增加浏览器/服务端运行时和字体一致性要求，但把图形语义收回一个实现。

一致性指数据、排序、标记、堆叠、零基线、主题和标签，不承诺跨平台抗锯齿完全一致。视觉验证仍需黄金样例和人工复核，文件签名检查不能证明正确性。

## 验证与回退

2026-10-03 T2已证明Vega6.4.0/Vega-Lite6.4.3能完整保留输入、在Windows生成SVG/PNG并提供浏览器悬停；公开Flint编译参数需显式防止隐式截断。十万行五轮冷进程测量显示Line中位11.22秒，最高峰值约1.10GB；拒绝loader可能仍返回空SVG，须增加执行前规范守卫和拒绝标志核验。2026-10-04 用户确定单图最多 10,000 个绘制点，超出时提示先聚合；100,000 行源输入目标不变。详见[兼容性实验](../changes/2026-10-03-evidence-correctness-repair/rendering-experiment.md)。运行时替换尚未验收，ADR 仍为 Proposed。

T2 失败则停留 Proposed，修订方案；不能将局部修补冒充最终统一。历史 Approved 输出不重新渲染或覆盖；新渲染器采用新版本，新生成写新对象。实施和验收参见 [design D1](../changes/2026-10-03-evidence-correctness-repair/design.md)、[测试计划](../changes/2026-10-03-evidence-correctness-repair/test-plan.md)。

2026-10-06 实施候选：固定 Vega 6.4.0 / Vega-Lite 6.4.3，服务端以 Vega 执行受限规范输出 SVG/PNG，浏览器消费固定 Revision 的同一规范并在超过 1,000 点时用 Canvas。规范守卫禁止外部资源、表达式和不支持的图形语法，loader 拒绝结果仍由失败标志复核。桌面/移动 10,000 点单轮响应已通过；真实数据库→Worker→API→UI 失败链路与最终独立复验尚未完成，因此保持 Proposed。
