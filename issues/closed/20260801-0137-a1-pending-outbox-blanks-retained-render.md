# A1 sweep design question: any pending outbox intent blanks the retained render on offline relaunch

**Status:** Resolved
**Opened:** 2026-08-01
**Resolved:** 2026-08-01
**Systems:** Sync, Client integration
**Related:** LLP 0137 (A1 arm), LLP 0090 (D3 outbox rule), LLP 0043, demos/improvement-sweep/arms/a1-snapback-web/findings/0137-a1-f6-pending-outbox-blanks-retained-render.json

Observed on the packaged closure: the same public sites query that cold-boots
retained (freshness 'retained', rows rendered) throws the raw connectivity
error on an offline relaunch once two intents are queued — LLP 0090 D3
("a relaunch with pending intent renders nothing ahead of the full resync").
For the field-notebook shape this is nearly a product contradiction: the act
of capturing offline is exactly what disables the retained render on the next
boot. Firebase and InstantDB both render cached rows plus queued local writes
together after an offline relaunch (frozen Diary 0027).

Ask: a designed presentation for relaunch-with-pending-intent (retained rows
marked retained plus an explicit unsettled-intent fact — still no fabricated
overlay), or a documented mutual-exclusion statement in the offline page so
builders can design around it. The honesty invariant behind D3 must not
regress either way.

## Resolution (2026-08-01, 0137 between-arms fix lane): the designed presentation, no D3 relaxation

**Design analysis.** LLP 0090 D3's normative outbox rule is a *protocol*
rule: "a relaunching client with a non-empty mutation outbox does not send
`resumeFromToken`; it takes the 0043 path (full resync, then replay)." The
"renders nothing" clause lived only in the implementation (the seed path
nulled the verified persisted candidate) and its test/comment paraphrase —
and the implementation was already asymmetric: a Channel A preloaded
candidate rendered retained with a pending outbox while the persisted
candidate blanked. Rendering verified retained rows is a display decision
governed by LLP 0043's never-presented-as-current rule, not by the resume
protocol, so a rendering-side fix exists that keeps every D3 invariant.

**Implemented** (`seedFromResumeState` in
`packages/snapback-client/index.mjs`): a relaunch with pending intent now

- renders the verified persisted rows marked `freshness: 'retained'` —
  **pre-intent** (queued writes are never overlaid; this arm has no local
  execution to derive an overlay) — and survives an offline first subscribe
  at connection `'stale'` exactly like the empty-outbox boot;
- carries the explicit unsettled-intent fact the ticket asked for:
  `handle.pendingIntentsAtSeed` (count at seed; live queue state is
  `client.outboxStatus()` / `useSnapbackOutbox()`);
- **withholds the resume token entirely** (`handle.rqsResume = null`): with
  a non-empty outbox `resumeFromToken` is never sent from seeding, on top
  of the existing every-fresh-subscribe gate, and reconnect takes the
  unchanged full-resync-then-ordered-replay path. Settlement is never
  claimed; replay ordering is untouched.

**Proof:** the updated D3 case in
`packages/snapback-client/rqs-resume-suite.mjs` (runs on both store arms;
fails on the old blanking behavior) and the rewritten pending-intent check
in `demos/public-dashboard/tests/acceptance/offline-local-first.mjs` — 9/9
against a real server: retained pre-intent rows render with
`pendingIntentsAtSeed: 2`, the queued update's value is proven absent from
the retained frame, and the subsequent restart settles both intents
exactly-once.

**Docs:** LLP 0090 D3 gained the dated "Outbox rendering note (2026-08-01)"
plus a revision-history amendment; the offline guide page's outbox bullet
now teaches the retained-pre-intent presentation and points the badge at
the outbox projection instead of fabricated rows.
