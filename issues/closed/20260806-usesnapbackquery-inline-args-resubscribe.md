# useSnapbackQuery resubscribes every render when callers pass inline args objects

**Status:** Resolved
**Severity:** P2 (escalated 2026-08-09 from P3 — pilot evidence shows this is a hard main-thread-saturation failure with zero diagnostics, not a papercut)
**Systems:** snapback-react, live queries, ephemeral presence
**Date:** 2026-08-06
**Related:** `packages/snapback-react/index.mjs` (`useSnapbackQuery`), LLP 0183 (surfaced during Zerobugs control-app work), LLP 0208 (pilot evidence)

## Problem

`useSnapbackQuery(reference, args)` memoizes its descriptor on the *identity*
of `args`:

```js
const descriptor = useMemo(
  () => provider.registry.descriptor(reference, args),
  [provider, reference, args],
);
```

When a caller passes an inline object literal — `useSnapbackQuery(issues.byLabel,
{label})` — `args` is a fresh object every render, so the descriptor memo
misses, `subscribe` is recreated, and `useSyncExternalStore` tears down and
re-establishes the subscription on every render. Behavior stays correct (the
registry's lease handoff — `subscribe(descriptor, listener, lease.current)` —
and the store keying on `canonicalReactStoreKeyV1` keep the underlying store
alive and the data continuous), but the churn is wasted work on every render
of every inline-args call site, and inline args objects are the natural way to
write the call.

Observed while building the Zerobugs control app, where the pattern shows up
in list views that render frequently.

## Escalation (2026-08-09, LLP 0201 P2 pilot evidence)

"Correct but wasteful" understates the worst case. In the pilot's
messaging screen (four queries plus a presence hook), inline args objects
**combined with a per-render `useSnapbackPresence` value object** produced
a hard render/resubscribe/publish loop that saturated the browser main
thread until clicks stopped landing entirely — Playwright could not
complete a click — with **zero diagnostics anywhere** (no console warning
from the hooks). Root-causing took ~50 minutes of bisection; the
authoring skill documents the trap and the builder still hit it. The
pilot's B3 score discounts for exactly this, and its diary calls it the
single worst DX moment of the build.

Consequences for scope: the presence-value half is not a "same treatment
considered" nice-to-have (as below) — it is a confirmed co-trigger and
should be in the primary fix. If the content-keyed descriptor fix carries
unacceptable hot-path hashing cost, the fallback is a dev-mode storm
detector (N resubscribes/republishes of the same reference within M ms →
named console warning); either way the skill/guide wording should stop
saying "wasteful" and name the saturation failure mode.

## Done when

- The descriptor memo (or the registry `descriptor()` entry point) keys on the
  *canonical content* of `args` rather than object identity — e.g. reuse the
  canonical store key already computed by `canonicalReactStoreKeyV1`, or a
  stable serialization — so inline args objects with equal content produce a
  stable descriptor and no resubscribe.
- Same treatment considered for `useSnapbackPresence`'s
  `options.scope`/`options.value` deps, which have the same shape of hazard.
- A unit test in `packages/snapback-react/` asserts that re-rendering with a
  content-equal inline args object does not release/re-establish the
  subscription (observable via registry inspection or a counting fake).
- No behavior change for `skip` sentinel args or handoff descriptors.

## Resolution

Resolved 2026-08-09 with the preferred content-keyed fix. `useSnapbackQuery`
now derives its descriptor memo dependency from `CanonicalClientValueV1`
content (with `skip` preserved as the sentinel), so a fresh content-equal args
object retains the existing descriptor and committed subscription.
`useSnapbackPresence` applies the same treatment to `options.scope` and
`options.value`, retaining the room lease and declarative publish intent when
fresh objects have equal content.

The package regression uses a counting provider to prove that an unrelated
rerender with fresh equal query args and presence scope/value creates no new
descriptor, subscription, release, or publish. It also covers changed content,
stable `skip`, and a handoff-shaped query descriptor. The author guide now
names the combined render/resubscribe/publish loop as a browser-main-thread
saturation failure, not merely wasted work, and fences the fix as unreleased
after 0.1.15.

No storm detector shipped: the bounded canonical grammar already defines
React/store identity, and no unacceptable hot-path cost was demonstrated that
would justify replacing the direct correctness fix with a diagnostic fallback.

Verification passed:

- `bun run --cwd packages/snapback-react test`
- `node scripts/check-guide.mjs` (pass with existing freshness warnings)
- `node scripts/check-inventories.mjs`
- `./ref-check --verbose`
