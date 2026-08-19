---
name: "solid2"
description: >
  Write or review Solid code in the Riffle renderer. Trigger when touching
  anything under src/ — components, stores, effects, async data, control flow —
  or when deciding which Solid API to reach for. Riffle targets Solid 2, where
  much of what you remember about Solid was removed.
---

# Solid 2 in Riffle

Riffle's renderer runs `solid-js@2.0.0-rc.0`. Your priors are Solid 1.x, and 1.x
code mostly **compiles and renders on 2.0 while behaving wrong**. Read this before
writing reactive code, not after a test fails.

## Where the truth is

- `https://github.com/solidjs/solid/tree/next/documentation/solid-2.0` — the RFC
  directory. This is what Solid 2 actually does.
- The `MIGRATION.md` in that directory — full 1.x → 2.0 replacement table.
- Read them with `ctx read <url>`.

**`docs.solidjs.com` documents Solid 1.x.** So does almost every blog post, Stack
Overflow answer, and library README you will find. If a source does not say Solid 2,
assume it is describing APIs that no longer exist.

## Removed — reaching for these is the default failure

| You want to write | Solid 2 |
| --- | --- |
| `createResource` | a `createMemo` that returns a Promise |
| `batch(fn)` | nothing — batching is automatic; `flush()` only to force it now |
| `startTransition` / `useTransition` | nothing — transitions are built in |
| `<Suspense>` | `<Loading>` |
| `<ErrorBoundary>` | `<Errored>` |
| `onMount` | `onSettled` |
| `on(deps, fn)` | nothing — split effects make it unnecessary |
| `createComputed` | a derived primitive; never a write-back computation |
| `createSelector` | `createProjection` |
| `createDeferred` | nothing in core |
| `createMutable` / `modifyMutable` | `createStore` |
| `produce` | nothing — store setters are already mutable-style |
| `unwrap` | `snapshot` |
| `resource.loading` | `isPending(fn)` |
| `resource.refetch()` | `refresh(memo)` |
| `resource.mutate()` | `createOptimisticStore` + `action` |
| `resource.error` | let it throw; catch with `<Errored>` |
| `<Index>` | `<For>` — one signature covers both |
| `<SuspenseList>` | `Reveal` + `createRevealOrder` |

There is no `createAsync` in core. If you find yourself writing one, you want an
async `createMemo`.

`lazy` and `<Dynamic>` survive. `createDynamic` became a `dynamic(...)` factory that
returns a stable component.

For anything not listed, the authoritative answer is the commented-out
`/* Not Implemented` block at the bottom of `packages/solid/src/index.ts` on the
`next` branch — it names every removed export with its replacement. Read it before
assuming a 1.x API still exists.

## Rules the runtime enforces

**Never write a signal from inside a reactive scope.** Effects, memos, and component
bodies all throw in dev on write. Writes belong in event handlers, in `onSettled`, or
inside `untrack`. The `ownedWrite: true` option exists for genuinely internal state
(a ref cell); using it to silence this error on application state builds a feedback
loop that will bite later.

**Never read reactive state at the top level of a component body.** It warns, and the
read does not track. Wrap it in `untrack` when you mean a one-time read, or move it
into `createMemo` / `createEffect` / a JSX expression when you mean it to be live.
This includes destructuring props — `function C({ title })` loses reactivity.

When the one-time read happens inside a third-party factory you call at setup, put the
`untrack` around **your call site**, not around the getter it reaches. A getter that is
later re-read inside a tracked scope must still subscribe.

**The same applies inside control-flow callback bodies.** `<Show when={u()}>{(u) => ...}`
callbacks build structure; a reactive read directly in the body won't update. Read
through the returned JSX instead.

**Effects have two phases, and the one-argument form throws.** `createEffect(compute, effect)`
— the first argument only reads (dependencies are recorded), the second runs side effects
after the flush. Passing a single function fails with `MISSING_EFFECT_FN`; this is an error,
not a warning.

**The effect callback must return a cleanup function or nothing.** An arrow function's
implicit return — `(v) => arr.push(v)` — throws `invalid cleanup value`. Use a block body.

**Updates land on the next microtask.** After a setter, reads still return the old value
until the batch flushes. When you must touch the DOM right after a state change — focus,
measure, scroll — call `flush()` first.

## Async is part of the graph

A computation that returns a Promise is async. Consumers read it as a normal accessor;
if it isn't ready, the read follows the `Loading` path.

```jsx
const note = createMemo(() => loadNote(path()));

<Loading fallback={<Spinner />}>
  <NoteView note={note()} />
</Loading>
```

Three things that follow, and that 1.x instincts get wrong:

- **`Loading` is for branch readiness, not for every refetch.** Once a branch has
  rendered, changed inputs keep showing the current content while the new value loads.
  It does not flash back to the spinner. Pass `on={key()}` when you actually want the
  fallback again on a key change.
- **`isPending(fn)` performs the read you give it**, so where you put it matters. Under
  the same `Loading` boundary as the data, it drives an inline "updating…" affordance.
  A bare `refresh()` re-asks the same question and reads as *not* pending.
- **Errors go through the graph.** No `.error` property to branch on; `<Errored>` catches
  it, which is also what makes failures visible to the boundary above.

Riffle is a client-only Electron renderer. `ssrSource`, `deferStream`, `transparent`,
and everything about hydration in the RFCs do not apply here — ignore them.

## Components run once

The component function body executes exactly once. There is no re-render, so there is
nothing for `useMemo`/`useCallback`/`memo` to optimize and no dependency array anywhere.
Reactivity lives in the JSX expressions and in the computations you create.

Concretely, when porting a component that came from a hooks-shaped runtime:

- `useState` → `createSignal`, but check whether the value needs to be a signal at all;
  a plain `let` is fine for anything the UI doesn't read reactively.
- `useEffect` with a dependency array → `createEffect(compute, effect)`, where the deps
  are whatever the compute phase reads. An empty-array effect is usually `onSettled`.
- `useRef` → a plain `let` binding plus `ref={el => ...}`; there is no `.current`.
- `useMemo` → `createMemo` only when the computation is expensive or shared. A cheap
  derived value is just a function.
- `useCallback` / `memo` → delete them.

Reading a prop is a live read every time. `props.value` inside JSX tracks; pulling it
into a `const` at the top of the body freezes it.

## Testing reactive behavior

One `await flush()` is enough for ordinary reactive chains — including an effect whose
effect phase writes another signal. It is **not** enough for changes travelling through a
Zag state machine: those converge on the second flush, and an assertion after the first
reads a stale value that looks exactly like a lost subscription.

Don't flush twice by reflex. When an assertion reads stale, add a flush first to find out
whether the chain simply settles late, before you go hunting for a broken subscription.

## Riffle-specific contracts

- **Tab panes are hidden with `display:none`, never unmounted.** `<Show>` destroys its
  branch — using it for tab switching silently reintroduces a full Markdown reparse on
  every switch, with no error to tell you.
- **The Source Editor autosaves on a 500ms debounce and flushes on teardown.** That flush
  belongs in `onCleanup`, and it must run before the CodeMirror instance is disposed.
- **`src/markdown/riffle-markdown.ts` is framework-free** and stays that way. It projects
  Comark AST into `ProjectedNode`; only the view consumes Solid.
- **Icons in `src/icons/` are generated** by `pnpm run icons:generate`. Never hand-edit.
