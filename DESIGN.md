---
version: alpha
name: LangReport-zapier-warm-consulting-workbench
description: "A warm, evidence-first consulting workbench. Cream surfaces, coffee ink, and one saturated orange action color make chart evidence feel confident without turning the product into a marketing page."

colors:
  primary: "#ff4f00"
  primary-active: "#ff7a45"
  primary-generate-active: "#ff9873"
  on-primary: "#201515"
  ink: "#201515"
  ink-soft: "#2f2a26"
  ink-mid: "#36342e"
  body: "#605d52"
  body-mid: "#939084"
  mute: "#c5c0b1"
  canvas: "#fffefb"
  canvas-soft: "#f8f4f0"
  border: "#c5c0b1"
  border-soft: "#ebe4dd"
  accent: "#ff4f00"
  accent-soft: "#fff0e8"
  success: "#18794e"
  success-soft: "#e8f6ef"
  warning: "#8a5a00"
  warning-soft: "#fff5d8"
  danger: "#b42318"
  danger-soft: "#fdecea"
  inverse-canvas: "#201515"
  inverse-ink: "#fffefb"
  overlay-scrim: "#201515"

typography:
  display-xl:
    fontFamily: Degular Display, Inter, system-ui, -apple-system, sans-serif
    fontSize: 56px
    fontWeight: 500
    lineHeight: 56px
  display-lg:
    fontFamily: Degular Display, Inter, system-ui, sans-serif
    fontSize: 48px
    fontWeight: 500
    lineHeight: 48px
  display-md:
    fontFamily: Degular Display, Inter, system-ui, sans-serif
    fontSize: 32px
    fontWeight: 500
    lineHeight: 36px
    letterSpacing: 1px
  display-sub-lg:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 48px
    fontWeight: 500
    lineHeight: 49.92px
  display-sub-md:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 32px
    fontWeight: 400
    lineHeight: 40px
  display-sub-sm:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 24px
    fontWeight: 600
    lineHeight: 30px
    letterSpacing: -0.6px
  display-xs:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 20px
    fontWeight: 700
    lineHeight: 25px
    letterSpacing: -0.5px
  body-lg:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 20px
    fontWeight: 400
    lineHeight: 30px
    letterSpacing: -0.2px
  body-md:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 18px
    fontWeight: 400
    lineHeight: 27px
  body-sm:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  caption:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 21px
  meta:
    fontFamily: JetBrains Mono, SFMono-Regular, Consolas, monospace
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0.2px
  button:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 16px
    fontWeight: 600
    lineHeight: 24px

rounded:
  none: 0px
  sm: 6px
  md: 12px
  lg: 12px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  4xl: 64px

components:
  nav-bar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    padding: "{spacing.md} {spacing.xl}"
  button-primary:
    backgroundColor: "{colors.primary}"
    activeBackgroundColor: "{colors.primary-active}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "{spacing.md} {spacing.xl}"
    minHeight: 44px
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "{spacing.md} {spacing.xl}"
    minHeight: 44px
  button-tertiary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.lg}"
  button-icon:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: 44px
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.md} {spacing.lg}"
    minHeight: 48px
  evidence-panel:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.xl}"
  trace-panel:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.lg}"
  notice-banner:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.md} {spacing.lg}"
  error-banner:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.md} {spacing.lg}"
  status-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
  status-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
  status-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"

---

## Overview

LangReport is a consulting-project evidence workbench, not a marketing landing page. Its visual direction borrows the warm temperature and confident restraint of Zapier: a warm-cream canvas, coffee ink, one saturated orange action color, and a two-face type system. The workbench still has one job: help a consultant understand what was used, what was calculated, what was rendered, and what still needs review.

The four fixed entrances — Brief, Data, Conversation, and Evidence — remain easy to scan and audit. Every successful chart remains traceable to its Data Snapshot, Metric Definition, TransformPlan, Flint Spec, Visual Template version, and validation record.

### Design priorities

- Warmth before decoration: the cream canvas is a product temperature, not a marketing background effect.
- Evidence first: chart, finding, source, metric, transformation, theme, and validation remain visually connected.
- One chromatic action color: orange communicates primary action and selected progress; semantic green, amber, and red remain reserved for state.
- Quiet surfaces: cream contrast and hairline borders carry hierarchy; avoid heavy shadows and decorative gradients.
- Readability before density: normal text is at least 16px, supporting text 15–16px, and technical metadata never drops below 11px.

## Color system

### Brand and surface

- **Primary orange** (`{colors.primary}` — `#ff4f00`) is the conversion/action signature for primary buttons, selected progress, and the default chart series.
- **Canvas** (`{colors.canvas}` — `#fffefb`) is the warm page and input background. Do not replace it with pure white.
- **Canvas soft** (`{colors.canvas-soft}` — `#f8f4f0`) groups panels, drawers, trace regions, and secondary work areas.
- **Coffee ink** (`{colors.ink}` — `#201515`) is used for headings, normal text, icons, strong borders, and inverse surfaces.
- **Body** (`{colors.body}` — `#605d52`) and **body mid** (`{colors.body-mid}` — `#939084`) are supporting text levels.
- **Mute** (`{colors.mute}` — `#c5c0b1`) is the lowest-priority structural neutral and divider color.

### Semantic extension

The source brand direction does not define a separate state palette, but the workbench must. `success`, `warning`, and `danger` retain explicit colors and soft surfaces for validation, data quality, review, and failure. Status badges always include readable text; color is never the only signal.

`accent-soft` is a derived warm orange surface for focus, selected controls, and hover. It is not a second decorative accent. Project Visual Templates and plugin Themes may define chart colors only through their existing versioned and auditable contracts; they do not rewrite the workbench chrome.

### Contrast decision

The user-provided `#fffefb` text on `#ff4f00` has about `3.27:1` contrast and is insufficient for ordinary button text. LangReport uses `{colors.on-primary}` `#201515` on orange primary buttons, which is about `5.40:1`. This is an intentional accessibility adaptation of the source direction.

## Typography

### Font family

- **Degular Display** is the preferred display face for hero-scale or major page lead moments. The repository currently has no licensed Degular font files, so the implementation must fall back to Inter without claiming pixel-level Degular parity.
- **Inter** is used for workbench headings, body copy, controls, chart titles, and buttons.
- **JetBrains Mono** is reserved for IDs, timestamps, field names, pipeline labels, compact status labels, and chart axes.

The fallback stacks are:

```css
"Degular Display", "Inter", system-ui, -apple-system, sans-serif
"Inter", "SF Pro Display", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif
"JetBrains Mono", "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace
```

### Rules

- Use display-xl/display-lg only for page leads and major evidence titles; do not turn every panel into a hero.
- Use 400 for reading text, 500 for labels and actions, 600 for headings, and 700 only for strong numeric emphasis.
- Use sentence case for Chinese and English headings. Short English technical labels may use uppercase in the mono role.
- Keep Chinese/body letter spacing at zero. Use positive tracking only for compact technical labels.
- Use tabular or mono figures where numbers are compared.
- Use `text-wrap: balance` or `text-wrap: pretty` for major headings when supported.

## Layout and spacing

- The primary workbench is center-canvas first: the Evidence canvas gets the flexible width while conversation history and project context are independent drawers.
- On wide screens, open drawers consume their own grid tracks; the center canvas uses the remaining width. The project context drawer can be resized without changing the evidence data contract.
- The brand spacing base is 4px. The dense workbench rhythm uses 8px, 12px, 16px, 24px, 32px, and 64px at semantic boundaries.
- Keep findings, explanations, and validation messages around a 760–840px reading width.
- Prefer one clear panel surface over several nested colored cards. Use spacing and borders to show ownership.
- Long IDs, file names, request URLs, and field names may wrap or ellipsize, but the full value must remain available in the existing trace/detail view.

### 工作台抽屉与文件预览

- 历史抽屉和依据抽屉互不排斥，可以同时打开；它们分别贴靠左右边缘，不覆盖彼此。
- 依据抽屉默认约 360px，可通过垂直拖拽把手调整到 300–560px；宽度只在当前页面会话内保留，刷新后回到默认值。
- Evidence 画布保持中心优先。抽屉打开时使用剩余宽度，不改变图表、Revision 或证据数据行为。
- 文件预览直接替换依据抽屉的内容区域，不创建全屏 Modal；右侧抽屉同一时间只展示一个内容视图，关闭预览返回证据上下文。
- 平板使用边缘抽屉，紧凑移动端使用底部 sheet；移动端不再依赖始终可见的横向历史条。

## Shapes and elevation

- Buttons and primary cards use the canonical 12px radius.
- Inputs and compact workbench controls use 6px radius.
- Status badges and metadata tags may use pill radius only when the text is short and the pill communicates status or grouping.
- Full-bleed bands use no radius; circular icon controls use the full radius.
- Default workbench elevation is flat or hairline. Surface contrast carries most hierarchy; use coffee-tinted soft shadows only for drawers, menus, and modal layers.

## Components

### Buttons and controls

- Primary buttons use orange `#ff4f00` with coffee `#201515` text, a lighter active background `#ff7a45`, a 44px minimum height, 12px radius, and 12px/24px padding. The `生成证据` composer action uses the lighter `#ff9873` active background so this high-intent action does not feel visually heavy when pressed.
- Secondary buttons use the warm canvas with a coffee or mute border. They must not compete with the orange primary action.
- Active secondary buttons use the warm orange soft surface so the pressed state remains visible without becoming heavier than the primary action.
- Tertiary and text buttons reduce visual noise in panels and utility views.
- Icon buttons are at least 44px on touch layouts. Their hover and focus surfaces use warm orange soft fill.
- Hover, active, and disabled states must remain distinct without relying only on opacity.
- Focus uses a 2px orange ring with a 3px offset against both canvas and soft surfaces.

### Inputs and forms

- Inputs are at least 48px high, use 16–18px Inter text, 12px horizontal padding, a warm canvas fill, and a 6px radius.
- Labels sit above fields at 13–14px and weight 500. Helper and validation guidance stays at least 15px.
- Textareas use a 1.5–1.6 line height and never force actionable guidance into metadata size.

### Evidence and trace

- The Evidence canvas keeps chart preview and finding in the main reading flow.
- Source, metric, transform, theme, and validation stay one action away in the context drawer.
- Trace values use Inter at 15–16px. Technical keys may use JetBrains Mono at 11–12px.
- Approved content is visually calm and read-only. Error and warning panels explain the cause and the next action in normal body text.

### Charts

- The default chart palette is `[primary orange, body-mid, success]` — `#ff4f00`, `#939084`, `#18794e`.
- Chart titles use Inter. Axes and compact legend labels use JetBrains Mono and remain at least 11px in exports.
- Chart visuals are centered inside a readable max width instead of stretching to the full panel.
- The interactive preview and deterministic SVG/PNG renderer use the same font families, default palette, and title hierarchy.
- A custom Project Visual Template or plugin Theme may override chart styling only when its explicit choice and version are recorded in the Revision.

### Marketing components that are intentionally excluded

The supplied direction includes `hero-band`, `pricing-card`, `product-selector`, `cart-drawer`, and a marketing footer. These are illustrative brand surfaces, not LangReport workbench components, and are not implemented in this migration.

## Responsive behavior and accessibility

| Name | Width | Behavior |
| --- | ---: | --- |
| Wide | 1240px and above | Center canvas first; history and context drawers can open independently and in parallel. |
| Tablet | 761–1239px | Center canvas remains primary; open history/context drawers occupy grid columns and compress the canvas. |
| Mobile | 431–760px | History and context become bottom sheets; panels stack inside the active sheet. |
| Compact | 430px and below | Single-column actions, wrapped headings, no horizontal clipping. |

Requirements:

- Maintain 44px touch targets and 48px inputs at every breakpoint.
- Check long Chinese copy, long IDs, loading, empty, error, clarification, review, and Approved read-only states.
- Never rely on color alone for readiness, revision state, validation, or data-quality warnings.
- Normal text meets WCAG AA contrast; primary orange buttons use coffee text.
- Respect `prefers-reduced-motion`; animation must not carry essential information.

## Do and don't

### Do

- Keep the canvas warm and the ink coffee-colored.
- Reserve orange for action, selection, and the default chart series.
- Keep Evidence, traceability, review, and revision status visually close to the chart they qualify.
- Use the canonical Inter and JetBrains Mono stacks; treat Degular as an optional licensed display face.
- Use borders, spacing, and soft surfaces before adding shadows or decorative effects.
- Preserve the existing API calls, data behavior, and Project information architecture.

### Don't

- Do not replace the workbench with a marketing landing page.
- Do not use pure white, pure black, cool gray, gradients, or a second decorative accent.
- Do not use orange as the only success/warning/error signal.
- Do not render CTAs as pills; pills are for short status/grouping labels.
- Do not use 8–10px text for content a user must understand or act on.
- Do not alter Visual Template versioning or rewrite historical Approved Revisions as part of a Chrome redesign.

## Implementation notes

- `apps/web/app/globals.css` owns the base tokens and workbench styles. Utility-page CSS modules consume the same root variables.
- `apps/web/app/(protected)/page.tsx` owns the browser-side chart preview and must stay aligned with Flint defaults.
- `packages/flint-adapter` owns deterministic SVG/PNG typography and the static SVG HTML wrapper.
- The Markdown design file is not parsed at runtime; any token change must be applied to both Web and Flint consumers and verified.
- Visual changes do not change the Phase 1 product boundary. Approved revisions remain immutable, and explicit Project Visual Template or plugin Theme choices remain versioned and auditable.
