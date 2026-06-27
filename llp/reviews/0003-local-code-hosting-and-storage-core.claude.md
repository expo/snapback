# Review: LLP 0003 — Local code hosting and storage core

**Reviewed:** `llp/0003-local-code-hosting-and-storage-core.rfc.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-25
**Redacted:** No — reviewed locally against the in-repo document; no document
content was sent to any external provider beyond the model serving this Claude
Code session.
**Method:** Single-session, independent read-and-critique of the full document
at its uncommitted working-tree state.

> **Independence (LLP 0005).** This session did **not** author the draft — it was
> drafted by Charlie Cheever / Codex (a GPT-family agent). A Claude review is
> therefore genuinely cross-family, which is the point of the loop: different
> families miss different things. This is **one** family's review. For a
> first-implementation RFC this is a real, independent read; a second non-author
> family is optional and lower-priority than the two empirical gates this RFC
> already names (the Valet retrospective and a working prototype).

## Overall assessment

This is a well-scoped RFC that knows exactly what it is deciding and what it is
not. The central call — make the first slice *one* vertical (Rust server + SQLite
+ Ibex + realtime) rather than separate code-hosting and database LLPs — is
correct and well argued (*Summary*: "the first useful system depends on their
integration"). The Boundaries/Deferred Work section is unusually disciplined, the
agent-and-test surface genuinely operationalizes LLP 0000's agent-first
principle, and the document is candid that it inherits Valet's shape "while
keeping the details open where Valet's confirmed failures are still unrecovered."

The concerns below are almost all of one kind: **load-bearing mechanisms that are
described at the happy-path level but whose hard edges — the ones most likely to
be what actually bit Valet — are not yet pinned.** Two of them (the busy-poll
realtime tailer and the unbounded change log) sit directly on top of LLP 0000's
*scale to zero, then scale up* thesis, so I have flagged them slightly higher.
None of this is a structural objection; it is the difference between a shape and a
contract. I applied the gap-surfacing edits I could make without inventing a
design decision; the decisions themselves I left as open questions for the
prototype and the Valet recovery to settle (see *Recommended next step*).

## Strengths

- **One vertical slice, well justified** (*Summary*). "Code hosting without the
  app database cannot validate queries, mutations, or realtime behavior. The
  database without the code host cannot validate the programming model." This is
  the right unit of first delivery and the reasoning is explicit.
- **Server-authoritative, host-mediated data access** (*Execution and Write
  Semantics*). "handler-visible database APIs go through Rust host calls, not
  direct SQLite access from JavaScript" is the right isolation and determinism
  posture, and it lines up cleanly with LLP 0004's `ctx.db` contract.
- **Disciplined boundaries** (*Boundaries and Deferred Work*). The list of what
  this RFC does *not* settle — portability, sync protocol, isolation, secrets,
  auth, assets, cron, backup — is precise, and the claim that these can be added
  "without replacing the local core" is the right architectural bet to state out
  loud.
- **Agent/test surface as a first-class deliverable** (*Agent and Test Surface*).
  Machine-readable schema/function diffs, inspection of loaded schema/functions/
  subscriptions/version, deterministic reset, and an end-to-end smoke test are
  exactly the feedback loop LLP 0000's agent-first DX implies — and the RFC is
  right that "this is not polish."
- **Honest Valet inheritance** (*Context*, *Realtime Pipeline*). Copying the
  trigger → change-table → version → tailer → hydrator → matcher → dispatcher
  shape "until we have evidence that a different design is better," with the 50ms
  poll called "a starting point, not a commitment," keeps inheritance from
  hardening into assumption.

## Concerns

Severity reflects impact on someone trying to *implement* against this RFC.

- **C1 — Realtime is a fixed-interval blind poll; this is in tension with
  scale-to-zero and with the Cloudflare target. [Medium-High]**
  The tailer polls every 50ms regardless of activity (*Realtime Pipeline*). LLP
  0000 makes "costs almost nothing when idle" a *primary* design goal and names
  Cloudflare as the privileged second target whose model may force
  rearchitecting. A 20 Hz poll does steady work at idle, and an interval-poll
  tailer does not map onto Cloudflare's event-driven substrate. Because this RFC
  states the local shape is "the product shape that other targets must either
  implement or consciously adapt," baking polling in risks exporting both an
  idle-cost and a portability problem. The server owns the single writer
  connection, so a SQLite `commit_hook`/`update_hook` can *wake* the tailer
  instead of it spinning — a concrete alternative worth benchmarking before 50ms
  is treated as the mechanism rather than a local-target placeholder.
  *Resolves when:* the wake mechanism is named as open, the hook-driven
  alternative is on record, and the 50ms figure is explicitly scoped to the local
  target. (Applied as a note + open question; the choice is left open.)

- **C2 — `_snapback_changes` has no retention/GC story; it grows without bound.
  [Medium-High]**
  Triggers append a change row per write, forever (*Realtime Pipeline*,
  *Database Model*). Nothing says when a change may be pruned. At idle this is
  harmless; at the "few hundred thousand MAU" scale-up target it becomes
  unbounded storage and an ever-slower tail scan — precisely the wrong direction
  for *scale to zero, then up*. *Resolves when:* the RFC names a retention rule
  (e.g. prune once all live subscriptions have advanced past a change's version,
  plus a bounded horizon for reconnect/replay) or explicitly defers it as a named
  open question. (Applied as an open question + one-line note.)

- **C3 — Per-row `_version` and the global `_snapback_version` are two ordering
  mechanisms whose relationship is undefined. [Medium]**
  *Database Model* gives every row a `_version` field *and* a global monotonic
  `_snapback_version`, *and* a `_snapback_changes` table. How the three relate is
  load-bearing for sync: if per-row `_version` is stamped with the global version
  at commit, "every row changed since version N" is one indexed scan and the
  change table is needed mainly for deletions (tombstones) and tailer ordering;
  if they are maintained independently, they can disagree. *Resolves when:* the
  RFC pins the relationship or flags it explicitly as unresolved. (Applied: stated
  the conservative default — per-row `_version` = global version at commit;
  change table carries tombstones + ordering — plus an open question.)

- **C4 — Hydrating "the current row" can emit a delta whose state is newer than
  the version it is labelled with. [Medium]**
  Step 3 hydrates the current full row for a change. If a row changed at v5 and
  again at v7 before the tailer reaches v5, hydration returns v7 state while the
  pipeline is processing the v5 change. Unless each emitted delta carries the
  row's *current* version and the pipeline coalesces multiple pending changes per
  row, a client can receive `(state, version)` pairs that are individually
  inconsistent or non-monotonic — a classic state-vs-log sync hazard and a strong
  candidate for one of Valet's empirical problems. *Resolves when:* the contract
  says deltas carry the hydrated row's current version and coalesce per row within
  a tick. (Applied as a correctness note in *Realtime Pipeline*.)

- **C5 — "Single SQLite connection" forfeits WAL's concurrent-reader benefit.
  [Medium]**
  *Database Model* proposes "a single SQLite connection or a serialized
  connection boundary" *and* WAL mode. A single connection serializes reads behind
  writes and behind one another, discarding the main reason to run WAL. The
  read-heavy reference apps (feeds, leaderboards — LLP 0000) want concurrent
  readers alongside one writer. *Resolves when:* the model distinguishes one
  serialized *writer* connection from a pool of WAL *reader* connections.
  (Applied as a clarification.)

- **C6 — Subscription-matching cost is the probable scaling bottleneck and isn't
  linked to the known open question. [Low-Medium]**
  The matcher evaluates active subscriptions per change (~O(subscriptions ×
  changes)). This is exactly LLP 0000's unresolved high-frequency fan-out ceiling
  (the continuously-synced mouse-position case) and the place the Valet
  retrospective should most inform. The RFC inherits Valet's matcher without
  noting that its cost model is the thing most likely to bend. *Resolves when:* a
  forward-link names matcher cost as the expected bottleneck to benchmark, tied to
  LLP 0000's fan-out open question and the Valet recovery. (Applied as a one-line
  forward-link.)

- **C7 — The tailer cursor's durability across restart/reconnect is unspecified.
  [Low]**
  "A tailer polls for changes since its last processed version" — where does that
  cursor live across a server restart, and how does a reconnecting subscription
  resume without missing or replaying changes? The first slice may punt, but the
  resume contract should be named. *Resolves when:* noted as an open question.
  (Applied.)

## Suggestions (non-blocking)

- Treat **hook-driven wakeups vs. the 50ms poll** as the *first* realtime
  benchmark, not a later optimization — it is cheap to measure and it decides
  whether the local shape is portable to Cloudflare in spirit.
- Fold the **tombstone** question into C2/C3 now rather than later: retention,
  delete markers, and the version relationship are one design, and deciding them
  together avoids a rework when sync arrives.
- When the Valet retrospective lands, map each confirmed failure onto the
  pipeline stage it bit (tailer / hydrator / matcher / dispatcher / write path) —
  this RFC's stage decomposition is a good frame for that, and *Open Questions*
  already asks which Valet failures become hard constraints.

## Open questions (for the author / prototype / Valet recovery)

- Change-log retention horizon, and the prune trigger (all-subscriptions-past-N
  vs. a time/size bound).
- The exact relationship between per-row `_version`, global `_snapback_version`,
  and `_snapback_changes`.
- Delta/version correspondence under current-row hydration (coalescing + which
  version a delta carries).
- Writer connection vs. reader pool under WAL.
- Tailer cursor durability and subscription resume across restart/reconnect.
- Hook-driven wakeups vs. polling for the tailer.

## Recommended next step

*Proposed only — the author decides; this review changes no `**Status:**`.*

1. **Status stays `Draft`.** I did not change it. The RFC's own status note
   already gates hardening on the Valet retrospective and a first prototype; that
   is the right gate.
2. **Charlie reviews the gap-surfacing diff** I applied (C1–C7 — all faithful
   clarifications or new open questions, no new design decisions) and ratifies or
   reverts.
3. **The two empirical gates do the heavy lifting:** recover the Valet failures
   (LLP 0001) and stand up the prototype; both will turn several of the open
   questions above into decisions. These outrank a second-family review for an
   RFC at this altitude.
4. **A second non-author family is optional** here; if wanted, I can prepare the
   standard LLP 0005 review prompt on request, but per the honesty rules I will
   not run it against an external provider, or record a review that wasn't
   produced, without an explicit human action. (Sub-agents available in this
   session are all Claude-family and would not satisfy the cross-family
   requirement.)
