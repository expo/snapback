# Move 5 slices 5-qual and 5-types: armed-VM bootstrap qualification (CV-2/CV-3) + types-condition sweep

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 3
**Confidence:** 4
**Severity:** P0
**Systems:** Runtime, Bootstrap, Packaging, Client integration, Developer experience
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-30
**Related:** LLP 0127, LLP 0115, LLP 0123, LLP 0122, LLP 0010, LLP 0030, LLP 0031, LLP 0009, LLP 0041, issues/20260730-bootstrap-smoke-does-not-create-armed-handler-vm.md, issues/20260729-external-package-lifecycle-gaps.md
**Marker:** parity-moves, move-5

LLP 0127 move 5 ("One sealed artifact, actually adopted") names three
separately named workstreams; this ticket carries the two the closing
enumerates as startable today with no author decision: *slice 5-qual* —
CV-2's bootstrap VM qualification plus the mismatched-framework regression
fixture (already LLP 0115's P0) — and *slice 5-types* — the
`types`-condition sweep. Bootstrap's smoke today never executes JavaScript
or creates a VM; the handler VM is created only at first invocation
(`RuntimeGuard::create` -> `ex_hermes_create_no_eval()`), which is exactly
where the rerun's incident surfaced. Owners per 0115 and 0127: LLP 0010
(bootstrap qualification and diagnostics), LLP 0030/0031 (harness/server
surfaces), LLP 0009 (host-install policy any boot-witness shape must go
through), LLP 0041 (packaging closure context for the types sweep).

Work items, 5-qual (0115 CV-2/CV-3). (1) Extend the LLP 0010 bootstrap
contract: after final framework selection, create and destroy the same VM
`RuntimeGuard::create` uses, execute at least one trivial function through
it, and bind binary and framework digests into a single readiness receipt,
with a stable `SNAPBACK_*` diagnostic on failure; own the invalidation half
(a framework refresh must invalidate or relink the final binary before
qualification runs), confirming or refuting the rsync-mtime missed-relink
hypothesis (0123 OQ1). (2) Build that receipt into the shared artifact
doctor, bootstrap, and harness all trust and re-verify — defined location
and custody, digest-coherence comparison, invalidation semantics — extending
coverage to the harness's `prebuilt`/`configured`/reused rungs and
`verify-local-proof`'s default path (doctor/harness convergence). (3)
Explicit precondition work item: the strict-Host handoff correction — ratify
a posture-neutral handoff shape with LLP 0009's owners before any
serving-process boot witness, because the naive probe spends the one-shot
strict-Host claim and readiness evidence must not weaken the posture it
verifies (0123 option 2's hazard, with a posture-neutrality test per 0123).
Work items, 5-types: add a `types` condition (declaration file plus
export-map condition) to every declarationless public subpath export —
`./online` (the defect three bakeoff arms hit independently, verified
unfixed on current main by LLP 0122), the `./rqs*` subpaths,
`./agent-authority`, `./hosted-browser`, and any other declarationless
subpath the sweep finds. Exits per 0115, verbatim: CV-2 — "A regression
fixture that reproduces the rerun's mismatched-framework state fails
bootstrap with the new named code instead of passing; the readiness receipt
binds both digests; a post-receipt framework swap is detected (by relink or
by receipt invalidation) rather than served"; CV-3 — "Doctor detects the
CV-2 fixture's incoherence read-only against the *served* binary and names
the recovery; every harness rung and `verify-local-proof` refuse to run
acceptance against a runtime whose receipt is absent, stale, or incoherent,
with the same code"; 5-types — every published-package subpath resolves with
type declarations (CV-1's exit clause 4, extended to the full sweep).

Decision boundary (updated 2026-07-30: all ten 0127-routed decisions were
adjudicated by the author; registry in LLP 0115 v0.6 open question 8).
Slice 5-rebuild — the CV-1 external workout-arm rebuild from published
artifacts only — is still NOT this ticket, but it is now UNBLOCKED:
decision 4 resolved custody (the admin surface folds into the CLI,
command-shaped and outside app graphs, with the served path remaining the
documented external-tooling fallback; the acceptance test helpers are
published as a real package), making CV-1's exit satisfiable, and
decision 1 resolved the channel gate (LLP 0074's parallel gate adopted;
LLP 0111 to be amended to decouple the local closure's default channel
from hosted qualification; hosted stays a candidate-tag nonclaim until the
hosted journey lands), un-blocking move 5's packaging-shape exits and the
rerun's published-channel mode. Where 5-rebuild lands: per decision 9's
sequencing note it runs after or with the `@expo/snapback-*` scope
migration — decision 9 fixed the terminal npm scope as @expo/snapback-*
(the repository moves to the expo/snapback GitHub org, publicly committing
Snapback as an Expo product; the `@snapback` org release request is filed
in parallel, gates nothing, and if granted becomes deprecation-stub
aliases pointing at @expo names, never a second migration), with the scope
migration (a proof-system migration: protocol name table, schema consts,
cold-install preset, ledger lineage) scheduled before the starter/GA
front-door moment — so the external-rebuild proof binds the terminal name,
not the throwaway alias. 5-rebuild is tracked as its own follow-on
alongside the scope-migration work rather than by extending this ticket;
5-qual and 5-types proceed here unchanged. Also excluded: the full
serving-process `/health` boot witness (it proceeds under LLP 0030/0031
only after the posture-neutral handoff shape above is ratified — this
ticket carries the ratification, not the witness), the static-for-adopters
build-policy ratification (0123 OQ3), the scope migration itself
(decision 9's execution), and the starter-front-door/CV-13/CV-15 items,
which are separately tracked.
