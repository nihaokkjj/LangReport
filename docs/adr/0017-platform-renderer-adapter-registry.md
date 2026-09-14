---
status: accepted
---

# ADR 0017：以平台 RendererAdapter registry 扩展渲染

Generation Cycle、受限 TransformPlan 执行、核心计划/渲染校验、Worker Lease/Fencing 和不可变 Chart Revision 继续由平台核心拥有，不能由 Plugin 替换。平台使用版本化的 RendererAdapter registry 选择受信任的渲染实现；第一阶段只注册现有 `vega-lite` Adapter，Plugin Manifest 只能声明其兼容的已注册 renderer ID。Flint Spec 编译器和 ModelGateway Provider registry 暂不抽取：两者目前各只有一个应用实现，过早抽象会增加表面面积而不增加可验证的扩展能力。Plugin validator 只能追加约束，不能跳过、降级或替换核心 Plan Validation 与 Render Validation。
