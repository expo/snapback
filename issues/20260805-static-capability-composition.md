# Static capability composition — narrow client entries drop the sync closure

**Status:** Open — commissioned 2026-08-05 (Charlie's ruling on the
2026-08-04 bundle-growth review, see
`issues/closed/20260804-bundle-closure-growth-review.md` §Delegated review)

Compatibility entry points (`app-data`, `online`, sessions,
push-registry, vector-search, …) inherit ~138 kB min of local-sync
closure (`materialization-store.mjs`, `local-read-admission.mjs`,
`ir-evaluator.mjs`, `materialization-bridge.mjs`,
`optimistic-rebase.mjs`) because every entry constructs the all-owning
`SnapbackClient`. Per the audit's remediation sketch: factor the client
kernel and the local-sync lifecycle into statically composed capability
modules; narrow entries depend only on their selected kernel/capability
modules; the root class remains the Full compatibility composition. Add
metrology profiles asserting the sync modules are ABSENT from non-sync
entries so the win is ratchet-pinned. This is a spec-coordinated
architecture lane: no behavior change, no validation or authority check
removed from any profile that needs it; wire bytes and existing test
suites stay green; the LLP owning the client composition takes a dated
amendment describing the composition rule.

## Review outcome (2026-08-05) — lane superseded; scope narrowed

The full static-composition refactor was implemented and then REJECTED
on adversarial review before landing (archived in the worktree stash
"lane-b static-capability-composition refactor — REJECTED"):

1. **The objective was already achieved on main.** The Move-2
   finish-out (1b4d104bc) made the store runtime a dynamic import, so
   narrow entries already exclude the five local-sync modules; the
   audit that motivated this lane measured a pre-Move-2 tree. The
   refactor added +641–873 min bytes per profile and its savings
   rollover compared against a stale predecessor receipt.
2. The refactor broke narrow entries (generated-mutation `mutate()`
   threw capability-unselected; masked in suites by an accidental root
   import) and made capability selection a process-global,
   construction-order-dependent singleton.
3. It absorbed a pre-existing assets ratchet breach silently; that
   breach (13,913 vs the 13,860 ceiling since 1b4d104bc, with a stale
   current receipt) is instead fixed transparently in this ticket's
   landing: the genuinely dead `state.lifecycleGeneration` assignment
   is removed and the current receipt refreshed.

**Remaining scope (open):** ratchet-pin the already-achieved win —
absence assertions for the five local-sync modules on resolved narrow
profiles, with the checked subpath set DERIVED from the package
exports map (not hand-enumerated) so future subpaths cannot dodge the
gate, plus a resolved-profile sweep that also covers
`local-sync-capability`-class regressions via the dynamic boundary. No
client-source refactor; no savings rollover (there are no savings to
declare).
