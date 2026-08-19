---
type: Reference
title: Markd primitives 到 Octane Base UI 的 capability matrix
description: >
  对照 Markd 当前 UI contract、Base UI 1.6.0 官方 API 与 Octane Base UI port，冻结 P0 adoption
  的 owner、保留行为和验证重点。
status: superseded # Octane Base UI port 随 runtime 迁移作废；Solid 侧替代在 Phase 0 裁决
version: 0.9
superseded_by: ./solid2-migration-plan.md
timestamp: 2026-08-05T10:00:00+08:00
resource: https://base-ui.com/llms.txt
tags: [octane, base-ui, markd, migration]
---

# Sources

- [`base-ui.com/llms.txt`](https://base-ui.com/llms.txt) 及其 Button、Input、Tooltip、Context Menu、
  Dialog、Popover、Composition、Animation pages；当前 upstream version line 是 1.6.0。
- 已安装的 `@octanejs/base-ui@0.1.21` package exports、source 与 tests。
- `src/components/ui/` 与 `src/components/motion/popover-morph.tsrx` 的现有行为。

Upstream 文档描述目标 API；Octane port 源码/tests 决定当前可用性。React-only composition 示例不能
机械复制：Octane 使用 ref-as-prop、native events，并通过自己的 `render`/`useRenderElement` 实现组合。

# Capability matrix

| Markd owner | Octane Base UI owner | adopt | Markd behavior retained locally | evidence focus |
| --- | --- | --- | --- | --- |
| `ui/Input.tsx` | `@octanejs/base-ui/input` | yes | Tailwind classes、native `onInput` callers、普通 ref prop | controlled/uncontrolled value、accessible name、disabled/invalid state |
| `ui/Button.tsx` | `@octanejs/base-ui/button` | yes | variant/size classes、loading spinner、CSS press feedback | native button semantics、`type="button"`、disabled/loading focus、ref |
| `ui/Tooltip.tsx` | `@octanejs/base-ui/tooltip` | yes | `label`/`side` convenience adapter 和 Markd visual classes | hover + keyboard focus、delay provider、portal positioning、aria association、unmount |
| `ui/ContextMenu.tsx` | `@octanejs/base-ui/context-menu` | available, not adopted | `MenuItem[]` data adapter、icon/danger classes、selection callback | right-click/long-press、collision positioning、roving focus、typeahead、Escape/outside dismissal |
| `ui/Modal.tsx` | `@octanejs/base-ui/dialog` | yes | `open/onClose/align/className` adapter、state-attribute CSS styling | focus trap/restore、Escape/outside dismissal、title/description labeling、nested dialog、exit lifecycle |
| `motion/popover-morph.tsrx` | `@octanejs/base-ui/popover` | yes | clip-path morph、Arrow/Home/End navigation、Markd classes | Base UI owns trigger/portal/positioner/dismissal/focus；`pnpm exec playwright test tests/browser/app-shell.spec.ts` verifies focus/navigation/dismissal |

# Current progress

- Installed `@octanejs/base-ui@0.1.21` through pnpm.
- `ui/Input.tsx` now delegates to Base UI Input while preserving Markd classes and native input props.
- `ui/Button.tsx` now delegates button semantics to Base UI and retains press feedback with CSS active state.
- `ui/Tooltip.tsx` now delegates hover、focus、delay、portal and positioning to Base UI while preserving
  the `label`/`side` adapter and visual classes.
- `ui/Modal.tsx` now delegates portal、focus trap/restore、Escape/outside dismissal、ARIA and transition
  lifetime to Base UI Dialog. A system-Chrome fixture verified open、Escape、outside dismissal、focus trap and
  focus restoration without runtime errors.
- `motion/popover-morph.tsrx` now delegates explicit trigger/content composition、portal、collision positioning、outside/Escape
  dismissal、initial focus and focus restore to Base UI Popover. The local context、global listeners、manual
  positioning and Motion lifecycle were deleted; Base UI state attributes drive the retained clip-path morph.
  System Chrome verified Note actions initial focus、Arrow/End、Escape restore、outside dismissal、no nested
  interactive trigger，以及 Property editor 的显式 save/dismiss/focus contract。
- These changes pass frozen pnpm install、`pnpm run typecheck`、`pnpm run build` and `pnpm test`.

ContextMenu reconnaissance found that the current adapter contract is imperative: FileTree/PinnedNotes calculate
pointer coordinates and render `{ position, items, onClose }`. Base UI owns the right-click/long-press event through
`ContextMenu.Root + ContextMenu.Trigger`, so adopting it correctly requires moving the root/trigger boundary into
those callers. `ui/ContextMenu.tsx` cannot be swapped in isolation; the final manifest must include the relevant
FileTree/PinnedNotes caller changes and remove their manual positioning/focus/dismissal code.

`@octanejs/base-ui@0.1.21` exposes ContextMenu、Menu 与 Menubar. The remaining ContextMenu work is an app-owner
migration across FileTree/PinnedNotes callers, not a package publication blocker. Keep that work scoped to the
existing backlog item; do not vendor binding source or retain the obsolete module-resolution restriction.

# Composition contract

- Local adapters are app-owned styling surfaces, not React compatibility shims. They may preserve concise Markd
  props while delegating semantic behavior to Base UI.
- Base UI `render` composition requires the rendered component to accept ref and spread supplied props. In Octane,
  refs are ordinary props; touched adapters must not reintroduce `forwardRef` or child cloning.
- A local adapter may not duplicate focus management、outside click、collision handling、roving focus 或 portal
  lifecycle already owned by Base UI.
- Direct package imports are preferred when no Markd-specific styling/API contract exists.

# Animation contract

Base UI exposes `data-starting-style`、`data-ending-style`、`data-open`、`data-closed` and owns popup transition
lifetime. Prefer cancellable CSS transitions on these states. Only retain Motion composition when CSS cannot
express a confirmed product behavior.

Markd's morph/layout effects remain product behavior. Adoption may replace popup semantics and positioning, but it
must not silently delete the clip-path morph、shared `layoutId`、reduced-motion handling or exit cleanup.

The historical Motion failure was a `hostComponent` input-shape bug, not a hook-slot collision. TSRX callers supply
a children render function, while TSX/createElement value positions supply a descriptor. The fix from
[`octanejs/octane#328`](https://github.com/octanejs/octane/pull/328) is included in the installed Octane release;
Riffle no longer carries the pnpm patch. Fresh production builds and system-Chrome journeys cover Welcome,
Settings/Motion, Dialog focus trap/restore and the ready AppShell with no runtime errors.

`Modal` uses Base UI state attributes plus CSS transitions because it has no real `layoutId` consumer.
Popover now follows the same ownership model while retaining its clip-path reveal in CSS; no shared `layoutId`
consumer existed in either caller.

# P0 order

1. Add `@octanejs/base-ui` using pnpm; package manager chooses the version.
2. Migrate Input and Button adapters, then typecheck/build.
3. Migrate Tooltip, then verify hover、focus、delay and portal behavior.
4. Migrate ContextMenu, then verify pointer、keyboard、focus and dismissal behavior.
5. Migrate Modal to Dialog and Popover semantics to Base UI while retaining Motion appearance.
6. Record any confirmed port divergence in `.agents/backlog.md`; do not create app-local copies of Base UI internals.
