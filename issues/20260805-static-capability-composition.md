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
