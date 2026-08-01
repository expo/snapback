# 0137 A2 guide-gap: bounded keyset verbs missing from packaged ctx.db, and the guide documents neither the verbs nor their absence

- **Date:** 2026-08-01
- **Source:** LLP 0137 Phase 1, A2 snapback-web arm (external consumer, @expo/snapback-* 0.1.7)
- **Finding:** `demos/improvement-sweep/arms/a2-snapback-web/findings/0137-a2-f5-bounded-keyset-not-in-packaged-ctx-db.json`
- **Severity:** capability + documentation — shared-visibility history pagination cannot do bounded storage work on the public closure

Probe: `withIndex('by_channel').eq(...).gt('_version', boundary).order('_version','asc').take(6)` passes codegen but fails at runtime as `SNAPBACK_HANDLER_FAILED` / `details.message: "undefined is not a function"` (`demos/improvement-sweep/arms/a2-snapback-web/evidence/probes.json`, boundedKeyset). Diary 0034 used `.lt/.take` on repo main and already flagged the guide's silence; for 0.1.7 consumers the surface is absent, not just undocumented. `defineOwnedKeysetPages` is owner-scoped only and cannot express membership-visible history. The arm shipped collect+sort+slice with an opaque commit-order cursor (correct, stable across appends — but O(channel) per page).

Asks, in order:
1. Ship the bounded verbs (`.lt/.lte/.gt/.gte/.take`) in the packaged inline-handler runtime.
2. Codegen statically validates the chain so an unsupported verb fails generation with a named diagnostic rather than a runtime "undefined is not a function".
3. The guide's "Inside a JS handler" section documents the complete chain (guide-gap per LLP 0061 §5; Diary 0034's discoverability lesson, still unabsorbed).

---

**2026-08-01 (fix-wave Lane β2) — ask 1 is satisfied-by-release, not by
new code.** The bounded verbs exist in the current handler runtime
(`packages/snapback-harness/ctx-bootstrap.js`: `lt` @610, `gt` @618,
`take` @630 — with the collect-cap diagnostic even *recommending*
`order(...).take(n)`), and diary 0034 exercised them on repo main. The
0.1.7 packaged absence is the same staleness class as the closed
packaged-asset tickets: the release refresh (fix-wave Lane α's
handoff/execution item) delivers them to external consumers. Remaining
open asks: (2) codegen static validation of the chain so an unsupported
verb refuses at generation with a named diagnostic, and (3) the guide's
"Inside a JS handler" complete-chain documentation — both still owed.
