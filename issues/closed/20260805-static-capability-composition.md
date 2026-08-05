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

## Absence-ratchet landing (2026-08-05)

The narrowed landing derives its resolved narrow-profile set directly from
`packages/snapback-client/package.json`'s `exports` map. The script subtracts
one explicit, commented allowlist of Full/compatibility and directly
sync-owned subpaths; `./package.json` is excluded as metadata rather than an
executable entry. Every other current export — and every future export by
default — receives a `resolveOptionalRuntimes` profile. Those profiles assert
the absence of `materialization-store.mjs`, `local-read-admission.mjs`,
`ir-evaluator.mjs`, `materialization-bridge.mjs`, `optimistic-rebase.mjs`, and
an independent explicit absence of `store-runtime.mjs`.

`baseline.local-sync-absence.v1.json` freezes the nine derived profiles as a
prospective additive supplemental receipt. No historical ceiling changed, no
savings rollover was added, and all 45 pre-existing current profiles remained
byte-for-byte unchanged. The script's write modes continue to run the complete
primary + historical supplemental + rollover behavior train.

Bite proof: a temporary static side-effect import of
`./materialization-store.mjs` in the derived `./assets` narrow entry made
`volta run node scripts/client-bundle-metrology.mjs --check` fail with
`resolved-public-subpath-assets: resolved narrow closure excludes
packages/snapback-client/materialization-store.mjs`. The probe was removed;
the post-revert check passes with 54 profiles and no frozen ceiling
regressions.

## Resolution (2026-08-05)

Lane complete under the narrowed scope: the exports-map-derived
absence ratchet landed (nine resolved narrow profiles, five sync
modules + store-runtime rejected, bite-proof recorded above); the
closure win itself was already delivered by 1b4d104bc. Closed.
