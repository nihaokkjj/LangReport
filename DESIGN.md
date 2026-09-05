---
version: alpha
name: LangReport-consulting-workbench
description: "A quiet, evidence-first consulting workbench. Clear typography, a restrained neutral canvas, and a single blue interaction color keep data lineage, chart evidence, and review decisions easy to read."

colors:
  primary: "#17212b"
  on-primary: "#ffffff"
  ink: "#17212b"
  ink-muted: "#5b6875"
  canvas: "#ffffff"
  surface: "#f5f7fa"
  surface-muted: "#edf1f5"
  border: "#d7dee6"
  border-soft: "#e8edf2"
  accent: "#2457c5"
  accent-soft: "#eaf1ff"
  success: "#18794e"
  success-soft: "#e8f6ef"
  warning: "#8a5a00"
  warning-soft: "#fff5d8"
  danger: "#b42318"
  danger-soft: "#fdecea"
  inverse-canvas: "#17212b"
  inverse-ink: "#ffffff"
  overlay-scrim: "#17212b"

typography:
  display-xl:
    fontFamily: interSans
    fontSize: 56px
    fontWeight: 400
    lineHeight: 1.10
    letterSpacing: -0.80px
    fontFeature: kern
  display-lg:
    fontFamily: interSans
    fontSize: 44px
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: -0.50px
    fontFeature: kern
  heading-xl:
    fontFamily: interSans
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.20
    letterSpacing: -0.30px
    fontFeature: kern
  heading-lg:
    fontFamily: interSans
    fontSize: 26px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.20px
    fontFeature: kern
  heading:
    fontFamily: interSans
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.30
    letterSpacing: 0
    fontFeature: kern
  body-lg:
    fontFamily: interSans
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.60
    letterSpacing: 0
    fontFeature: kern
  body:
    fontFamily: interSans
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.60
    letterSpacing: 0
    fontFeature: kern
  body-sm:
    fontFamily: interSans
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
    fontFeature: kern
  label:
    fontFamily: interSans
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.40
    letterSpacing: 0
    fontFeature: kern
  meta:
    fontFamily: interMono
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: 0.20px
    fontFeature: kern
  caption:
    fontFamily: interMono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: 0.15px
    fontFeature: kern
  button:
    fontFamily: interSans
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.40
    letterSpacing: 0
    fontFeature: kern

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 20px
  pill: 999px
  full: 9999px

spacing:
  hair: 1px
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 40px
  section: 64px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 10px 18px
    minHeight: 44px
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 10px 18px
    minHeight: 44px
  button-icon:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    size: 44px
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 11px 12px
    minHeight: 48px
  text-input-focused:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 11px 12px
    minHeight: 48px
  evidence-panel:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 24px
  trace-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 16px
  notice-banner:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  error-banner:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px 16px
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

LangReport is a consulting-project evidence workbench. The visual system should make the four fixed entrances — Brief, Data, Conversation, and Evidence — easy to scan, compare, and audit. It is not a marketing landing page and should not feel like a collage of unrelated cards.

The interface has one visual job: help a consultant understand what was used, what was calculated, what was rendered, and what still needs review. Typography carries hierarchy; color is reserved for interaction and state. Every successful chart remains traceable to its Data Snapshot, Metric Definition, TransformPlan, Flint Spec, Visual Template version, and validation record.

### Design priorities

- Readability before decoration: normal text is 16px, supporting text is 15px, and metadata never drops below 11px.
- One voice: all normal interface text uses Inter; JetBrains Mono is reserved for IDs, timestamps, field names, and compact status labels.
- Quiet surfaces: white is the main canvas, soft gray groups related content, and borders define structure without heavy shadows.
- Controlled color: blue communicates action and focus; green, amber, and red communicate success, warning, and failure. No decorative rainbow palette appears in one view.
- Evidence first: the chart, finding, source, metric, transformation, theme, and validation state remain visually connected.

## Color system

The product chrome uses a small semantic palette. Color names describe purpose, not a page section or a visual mood.

### Base

- **Ink** (`{colors.ink}`): primary text, headings, icons, and strong borders.
- **Canvas** (`{colors.canvas}`): page background, input background, and primary content surface.
- **Surface** (`{colors.surface}`): work areas, trace panels, and grouped secondary content.
- **Surface Muted** (`{colors.surface-muted}`): icon buttons, compact controls, and neutral badges.
- **Border** (`{colors.border}`) and **Border Soft** (`{colors.border-soft}`): structural dividers and low-emphasis separators.
- **Ink Muted** (`{colors.ink-muted}`): supporting text only. It must not be used for primary findings, labels, or error explanations.

### Interaction and state

- **Accent** (`{colors.accent}`) is the only general-purpose accent. Use it for focus rings, selected controls, links, active progress, and the default chart series.
- **Accent Soft** (`{colors.accent-soft}`) is the only non-semantic accent surface.
- **Success** (`{colors.success}`) and **Success Soft** (`{colors.success-soft}`) mean a check passed or a revision is approved.
- **Warning** (`{colors.warning}`) and **Warning Soft** (`{colors.warning-soft}`) mean attention is required, such as a data-quality warning.
- **Danger** (`{colors.danger}`) and **Danger Soft** (`{colors.danger-soft}`) mean a request failed or a blocking issue exists.
- **Inverse Canvas** (`{colors.inverse-canvas}`) and **Inverse Ink** (`{colors.inverse-ink}`) are reserved for compact inverse areas, not general card backgrounds.

Do not add one-off colors to the product chrome. A Project Visual Template or explicitly selected plugin Theme may define chart colors; that choice is a traceable project decision and is preserved in the Chart Revision snapshot. It does not change the base workbench palette.

## Typography

### Font family

- **Inter** (`interSans`) is the single sans-serif family for headings, body copy, controls, and chart titles. The implementation fallback is `"Inter", "SF Pro Display", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`.
- **JetBrains Mono** (`interMono`) is reserved for compact metadata: field names, IDs, timestamps, pipeline labels, eyebrow labels, and chart axes. The implementation fallback is `"JetBrains Mono", "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`.
- `font-feature-settings: "kern"` is enabled globally. Do not use a different family in an individual component or export renderer.

### Hierarchy

| Token | Size | Weight | Line Height | Use |
|---|---:|---:|---:|---|
| `{typography.display-xl}` | 56px | 400 | 1.10 | Empty-state or page lead, sparingly |
| `{typography.display-lg}` | 44px | 400 | 1.15 | Major page title |
| `{typography.heading-xl}` | 32px | 600 | 1.20 | Job or evidence title |
| `{typography.heading-lg}` | 26px | 600 | 1.25 | Section heading |
| `{typography.heading}` | 22px | 600 | 1.30 | Panel heading |
| `{typography.body-lg}` | 18px | 400 | 1.60 | Finding or lead explanation |
| `{typography.body}` | 16px | 400 | 1.60 | Default reading text and inputs |
| `{typography.body-sm}` | 15px | 400 | 1.55 | Supporting copy and compact rows |
| `{typography.label}` | 13px | 500 | 1.40 | Button text, field labels, row labels |
| `{typography.meta}` | 11px | 400 | 1.40 | Status, IDs, timestamps, and technical metadata |
| `{typography.caption}` | 12px | 400 | 1.40 | Longer metadata and compact notes |

### Rules

- Keep text at or above 11px. If content cannot fit, change layout or allow wrapping; do not shrink it.
- Use 16px and a 1.6 line height for paragraphs and user-entered text.
- Use 400 for reading text, 500 for labels and actions, 600 for headings, and 700 only for a strong numeric emphasis.
- Keep letter spacing at zero for Chinese and body text. Use at most 0.2px on mono metadata.
- Do not use all caps for Chinese sentences. English technical labels may use uppercase when they are short and use the mono role.
- Do not use opacity as the only way to communicate disabled, warning, or secondary states; combine it with surface, border, or text treatment.

## Layout and spacing

- The primary workbench is a three-region layout: conversation history, evidence canvas, and project context. The center canvas always gets the flexible width.
- The API Console and Plugin page reuse the same canvas, surface, border, type, and control tokens; they are utility views, not separate brands.
- Use the 8px base rhythm: 8px for compact gaps, 12px for field and row gaps, 16px for component padding, 24px for panel padding, 32px for section separation, and 64px only for major page breaks.
- Keep the reading column around 760–840px when displaying findings, explanations, or validation messages.
- Prefer one clear panel surface over several nested colored cards. Use borders and spacing to show ownership and hierarchy.
- Long IDs, file names, request URLs, and field names may wrap or ellipsize, but their full value must remain available through the existing trace or detail view.

## Components

### Buttons and controls

- Primary and secondary buttons use a 44px minimum height and the same 15px Inter label style.
- Primary buttons use `{colors.primary}` with `{colors.on-primary}`. Secondary buttons use `{colors.canvas}` with a `{colors.border}` border.
- Focus uses a 2px `{colors.accent}` ring with a 3px offset. Never remove the focus indicator to preserve the visual style.
- Icon buttons are at least 44px on touch layouts. Their icon may use the mono family only when it represents a compact symbol or code-like mark.

### Inputs

- Inputs are at least 48px high, use 16px Inter text, and have 12px horizontal padding.
- Labels sit above fields and use 13px Inter at weight 500. Helper and validation text uses at least 15px when it carries user action guidance.
- Textareas use a 1.5–1.6 line height and never force a user to read long content in 11px metadata type.

### Evidence and trace

- The evidence panel keeps chart preview, finding, source, metric, transform, theme, and validation in one visual group.
- Trace values use Inter at 15–16px. Field names and technical keys may use JetBrains Mono at 11–12px.
- Status badges use one semantic color each and always include readable text; color is never the only status signal.
- Approved content is visually calm and read-only. Error and warning panels explain the cause and the next action in normal body text.

### Charts

- The default chart palette is limited to `{colors.accent}`, `{colors.ink-muted}`, and `{colors.success}`. Use the first color for the primary series.
- Chart titles use Inter; axes and compact legend labels use JetBrains Mono. Chart labels must remain at least 11px in exports.
- The interactive preview and deterministic SVG/PNG renderer must use the same font families and default palette.
- A custom Project Visual Template or plugin Theme may override chart styling only when the explicit choice and its version are recorded in the revision.

## Responsive behavior and accessibility

### Breakpoints

| Name | Width | Behavior |
|---|---:|---|
| Wide | 1240px and above | Three-region workbench with persistent side rails |
| Tablet | 900–1239px | Context rail becomes an overlay; center canvas remains primary |
| Mobile | 760–899px | History becomes a horizontal strip; panels stack |
| Compact | 430px and below | Single-column actions, wrapped headings, no horizontal clipping |

### Requirements

- Maintain 44px minimum touch targets and 48px input targets at every breakpoint.
- Check heading wrapping, long Chinese copy, long IDs, loading state, empty state, error state, and approved read-only state at desktop and mobile widths.
- Never rely on color alone for readiness, revision state, validation, or data-quality warnings.
- Maintain readable contrast: normal text should meet WCAG AA contrast, and focus indicators must be visible against both canvas and surface backgrounds.
- Respect `prefers-reduced-motion`; animation must not carry essential information.

## Do and don't

### Do

- Use the canonical `Inter` and `JetBrains Mono` tokens instead of local font-family values.
- Use black/white/gray for structure and one blue for interaction.
- Use semantic green, amber, or red only when the state requires it.
- Increase available space or wrap content when type does not fit.
- Keep source, metric, transform, theme, and validation information visually close to the chart they qualify.

### Don't

- Do not introduce pastel section colors, multiple competing accent colors, gradients, or decorative rainbow palettes in the workbench.
- Do not use 8–10px text for content a user needs to understand or act on.
- Do not use very light 320–340 weights or large negative tracking for normal Chinese text.
- Do not set a component to Arial, generic `monospace`, or another local font outside the canonical stacks.
- Do not turn the consulting workbench into a marketing landing page or hide traceability behind decoration.

## Implementation notes

- `apps/web/app/globals.css` owns the base tokens and the workbench styles. CSS modules for utility pages consume those same root tokens.
- The current implementation uses Inter and JetBrains Mono as the documented open-source substitutes; no proprietary Figma font files are bundled.
- `packages/flint-adapter` owns the deterministic SVG/PNG typography and must stay aligned with the web preview.
- Visual changes do not change the Phase 1 product boundary. Approved revisions remain immutable, and explicit Project Visual Template or plugin Theme choices remain versioned and auditable.
