# LangReport Agent Instructions

## UI work

When a task changes `apps/web` pages, components, styles, layout, or interaction:

1. Read the complete root `DESIGN.md` before editing. It is the source of truth for the visual system.
2. Apply the documented color, typography, spacing, radius, component, responsive, and Do/Don't rules. Reuse existing tokens and styles when they fit.
3. Preserve the current product information architecture, API calls, and data behavior unless the task explicitly asks for a functional change. Translate the visual language to the data workspace; do not turn it into a marketing landing page by default.
4. Keep new visual values inside the documented token system. If a new value is necessary, explain the deviation in the final response.
5. Check the result at desktop and mobile widths. Confirm that text hierarchy, contrast, touch targets, overflow, and empty/loading/error states remain usable.
6. Run `pnpm --filter @langreport/web typecheck` after UI changes. Treat failures as unresolved until fixed or clearly reported.

## Completion standard

A UI task is complete only when the implementation matches the applicable `DESIGN.md` rules, existing behavior still works, responsive states have been checked, and the web typecheck passes. In the final response, summarize the changed UI and name any intentional design deviations.
