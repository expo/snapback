# Move 5 slices 5-qual and 5-types: armed-VM bootstrap qualification (CV-2/CV-3) + types-condition sweep

**Status:** Open (5-qual EXECUTED in-branch 2026-07-31, pending landing on
main; 5-types is a separate lane and remains open here)
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

## 2026-07-31 — slice 5-types: SWEPT in-branch (pending landing)

Branch `move5-types-sweep` (isolated worktree, base `7a4c58a7`). Every
published subpath export of every publishing `packages/snapback-*` package
now resolves TypeScript declarations under the standard `types` condition —
the full sweep, not just `@snapback/client`:

- 51 new hand-authored `.d.mts` files (no `any`-dumps; signatures traced
  from the `.mjs` sources) across `@snapback/client` (7: agent-authority,
  hosted-browser, online, rqs, rqs-preload, rqs-store, rqs-store-file),
  `@snapback/vite` (4), `@snapback/cli` (6), `@snapback/app-cli` (1),
  `@snapback/codegen` (7), `@snapback/contract` (18), and
  `@snapback/hosted-supervisor` (8). Each export map gained
  `{ "types": …, "import"/"default": … }` conditions with `types` first,
  and every declaration joined the publish `files` allowlist (a tarball
  that drops the `.d.mts` would re-open the defect for installed users).
- Declaration drift in the PRE-EXISTING typed surfaces was found and fixed
  by the new parity gate: `@snapback/client`'s root `index.d.mts` was
  missing ~20 runtime exports (the rqs-store/rqs-preload/react-binding/
  result-contract surfaces, `DEFAULT_INGRESS_LIMIT_BYTES`) and carried
  `...args: unknown[]` stubs for the agent-authority fence;
  `app-data.d.mts` leaked an importable phantom class
  (`SnapbackAppDataClientBase` — `undefined` at runtime);
  `codegen/define.d.ts` was missing `defineRoutes`/`routeParam`/
  `isRoutesDef`/`isTableDef`/`isEphemeralDef`; `vite/index.d.mts` was
  missing 12 runtime exports including `default`.
- REGRESSION CHECK: `scripts/check-package-export-types.mjs`
  (`bun run check:export-types`; wired into `verify-local-proof` right
  after the package-test inventory gate, which CI runs). Three phases:
  (1) static export-map audit — `types` condition present and FIRST,
  declaration + runtime files exist, publish `files` covers both;
  (2) a generated consumer fixture importing every subpath by its public
  specifier, compiled with the locked TypeScript under
  `--module nodenext --strict` against a symlinked node_modules (installed-
  consumer resolution); (3) declared-value-export vs runtime `Object.keys`
  parity per subpath. Green: 60 subpaths across 10 publishing packages.
  Red-path demonstrated: stripping `./online`'s types condition fails the
  check with the exact defect named (restored after the scratch run).
- Tests: client 18/18 (+ tsc fixture), react (incl. tsc fixture), vite
  package/channel-a/serializer (runtime binary borrowed from the primary
  checkout), full `@snapback/cli` suite with the same binary, app-cli,
  codegen, hosted-supervisor 12/12 all pass.
  `packages/snapback-cli/comparator-profile.test.mjs:331` was updated to
  normalize string-or-conditions export targets. One pre-existing failure
  on the unmodified base (not this change):
  `packages/snapback-contract/query-authorization.test.mjs:507` asserts
  `schemas/live.wire-fixtures.v1.json` `formatVersion === 2` but the
  schema (untouched here) carries 3 — flagged for whoever bumped the
  corpus. Second pre-existing observation: running
  `comparator-profile.test.mjs` regenerates
  `packages/snapback-cli/fixtures/comparator/app/snapback/generated/`
  with richer presence shapes than the committed fixture (committed
  bytes predate a generator improvement); the churn was restored, not
  committed, here.
- LLP 0115 CV-1 named gap 4 / exit clause 4 text updated in-branch (dated,
  pending landing). Slice 5-qual is NOT this branch: CV-2 landed
  separately at `814acd77` per 0115 v0.7; CV-3/doctor-harness
  convergence and the LLP 0009 handoff ratification remain with this
  ticket's other half.

## 5-qual execution note (2026-07-31, in-branch, pending landing on main)

Work item (1) — CV-2 — had already landed on main at `814acd77`
(`snapback runtime-qualify`, `SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED`, the
rsync-mtime hypothesis CONFIRMED and fixed at source; LLP 0115 v0.7
conformed the "trivial execution" and "single readiness receipt" clauses to
the landed owner text). This branch executed the remainder:

- **Work item (2) — CV-3, the persisted receipt.** Location and custody:
  `<binary>.runtime-readiness.json`, `snapback.runtime-readiness.v1`
  (`packages/snapback-cli/runtime-readiness.mjs`), colocated with the binary
  it certifies; digest-coherence recomputed on every consumption (binary
  sha256 + the shared Hermes-artifact candidate set, root-relative);
  invalidation on framework change or rebuild is structural
  (`framework-drift` / `binary-drift`), and a receipt is never issued for a
  failed qualification. Issuers: the runtime-link probe on kept targets
  (bootstrap smoke, kit cargo rung) and `verify-local-proof` (pre-doctor +
  post-final-build). Consumers with the one shared
  `SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` code (LLP 0010 registry): doctor
  (read-only against the SERVED binary, both recoveries named), kit
  `configured`/`prebuilt` rungs (verify → re-qualify self-heal → refuse),
  kit `reused` rung (identity bind or refuse reuse), and the proof's default
  path. Kit-rungs residue ticket closed
  (`issues/closed/20260730-kit-rungs-skip-handler-vm-qualification.md`).
- **Work item (3) — the strict-Host precondition.** Resolved as a documented
  finding rather than a code change: the landed CV-2 shape is
  posture-neutral toward serving processes BY PROCESS ISOLATION
  (`runtime-qualify` is a separate short-lived process; no server startup
  path runs the probe in-process). LLP 0123 carries the dated 2026-07-31
  note; `tests/runtime_qualify_posture_v0.rs` is the 0123-required
  post-probe test (external qualification, then first/second in-process VMs
  present identical fail-closed enforcement). The standing
  first-VM-only-Enforce fact is ticketed with LLP 0009's owners
  (`issues/20260731-first-vm-only-strict-host-context.md`); any
  in-serving-process boot witness remains gated on that ratification.
- **CV-15 (picked up by this lane per the wave-1 program):** the harness
  `unpinned` verdict split into `pinned-binary-dirty-checkout` /
  `unpinned-binary` (`demos/_kit/server-process.mjs`, README, lifecycle
  suite).

Proof in-branch: `tests/runtime_readiness_receipt_v0.mjs` (7 tests),
`tests/runtime_link_smoke_v0.mjs` (11 tests — CV-2 fixtures still green +
receipt/tamper/doctor-read-only fixtures),
`demos/_kit/tests/server-process-lifecycle.mjs` (rung coverage),
`tests/runtime_qualify_posture_v0.rs` (posture neutrality). 5-types remains
with its own lane; this ticket closes when both halves land on main.
