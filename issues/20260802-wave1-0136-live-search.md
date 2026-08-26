# Wave-1 remainder: implement LLP 0136 — live search by coarse re-execution

**Status:** Open
**Systems:** Live queries, Search, Wire Protocol, Realtime
**Related:** LLP 0136 (Accepted 2026-07-31, design-only — crates/snapback/src/live_matcher.rs
has no search path; full_text_search_v1 ships non-live), LLP 0073, LLP 0091,
LLP 0094 (its Appendix B wire amendments), LLP 0155 Move 1 (delta/replace
classification vocabulary — coordinate)

Implement `live_full_text_search_v1`: live search subscriptions delivered by
coarse re-execution on table-scoped invalidation. Normative boundaries from
the spec: v1 restricted to non-auth-scoped subscriptions (sessions-mode
`owner.v1` refused at admission with a stable reason), offer-gated wire
negotiation, per-table wake-amplification ceilings.

At landing, apply the spec's own fold-ons: Appendix A's LLP 0073 amendment
("apply only on acceptance" — acceptance happened, the fold never did) and
Appendix B's dated 0091/0094 wire amendments — coordinate with the hygiene
ticket so they land exactly once.

Collision note: this touches crates/snapback/src/live_matcher.rs and the delivery
classification machinery that 0155 Move 1 and the register-cliff ticket
(20260802-convex-erg-04) also orbit — check both lanes' state before
starting, and do not run this concurrently with erg-04.

**Exit:** the spec's acceptance obligations as tests (including refusal at
admission for auth-scoped subscriptions and the ceiling behavior); the
campfire demo's "design-only" nonclaim flipped honestly; capability id
registered; dated implementation-record amendment + 0115 CV-11 row updated.


## Triage (2026-08-26 leftover sweep)

Still open. LLP 0136 remains Accepted, not Implemented. The 0166-impl-program hold **fired** (that program closed 2026-08-03). `live_full_text_search_v1` is still Experimental / GAP on all targets; `guide/backend/text-search.md` still `SNAPBACK_CAPABILITY_UNSUPPORTED`. Child `issues/20260825-llp0209-d6-search-membership-certificates.md` is separate.

## Coordination log

- **2026-08-02 — owner folds taken by corpus hygiene.** The
  `20260802-corpus-hygiene-fold-on-amendments` lane folded LLP 0136 Appendix
  A/B at `d7eef3c65db5ab39abcefdebc0c642b247c02623` into LLP
  0073/0091/0094 as staged, explicitly unimplemented contracts
  and marked the appendices folded. This ticket must not duplicate those doc
  amendments; it still owns every code/schema/fixture/capability and
  implementation-record obligation they name.

- **2026-08-02 — closed authoring/manifest checkpoint in progress.** The
  first implementation slice is intentionally limited to
  `defineLiveSearchQuery`, its closed `LiveQuery` + `SearchQueryPlanV1`
  artifact shape, schema-carried `liveLimits` / `searchLiveLimits`, exact
  public-read authority validation, and the experimental
  `live_full_text_search_v1` registry/facts/GAP vocabulary. Every target still
  reports support false and carries the structured GAP; this checkpoint does
  not claim that live search is implemented or publish target support. The
  remaining program still owns wire offer/`LiveReplace` cursor carriage,
  runtime admission and dispatch, per-index/connection/table ceilings and
  table-scoped fan-out, client live-search state, acceptance/measurement
  evidence, implementation-record updates, and final publication-carrier
  refresh after integration.

- **2026-08-02 — held after the static authoring/carrier checkpoint.** Charlie
  explicitly held LLP 0136 after the already-landed static authoring and
  carrier checkpoint. Wire negotiation and cursor carriage, runtime admission
  and execution, client live-search state, acceptance/measurement evidence,
  and capability-claim work are not proceeding in this wave. Every target
  continues to report `live_full_text_search_v1` support false with its
  structured GAP. Resume this ticket only after a later explicit release from
  Charlie.

- **2026-08-03 — CONDITIONAL RELEASE (author decision sitting #2,
  `issues/20260803-author-decision-sitting-2.md`).** The hold above is
  now a recorded **auto-release condition**, not an indefinite hold: the
  held implementation program resumes when the LLP 0166 implementation
  umbrella (`issues/20260803-0166-impl-program.md`) closes — its
  carrier-exit evidence run plus closing audit. No further explicit
  release is needed at that point. The wave-3 program ticket sequences
  this as the next Track-A lane after umbrella close.
