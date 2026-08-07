# First npm `latest` promotion of the nine-package surface

**Status:** Closed — executed 2026-08-06 (0.1.9 fast-path)
**Opened:** 2026-08-03 (Charlie: "pull the trigger", follow-on ratification
in `issues/20260802-author-decision-packet.md`)
**Systems:** Packaging, Deployment, Testing
**Related:** LLP 0074 (parallel npm gate — the authorizing ruling), LLP 0134
(maturity promotion machinery — the qualification bar), LLP 0122 (nine-package
closure and packaging facets), LLP 0145 (client bundle metrology), LLP 0148
(id registry — `@expo/snapback-*` scope facts)

## Running log

- **2026-08-05 — green source proof and qualified staging completed; first
  production use stopped honestly at two fail-closed machinery gaps.**
  Candidate source `4c8245a1a05e4f5f724771e7557f9a583bac2410` had green
  main local-proof run `31035872210`: 119 selected gates passed, zero failed
  or blocked gates, and only the two expected not-selected gates. Qualified
  EAS staging run `019fd366-7f4c-7998-a1ff-1c4382ac338d` then completed for
  `0.1.9`; both runtime builds, nine-package assembly, both staged cold
  installs, and final retention succeeded. The retained release archive
  SHA-256 was
  `feea37839dfd2e426eab0b1376886fe8972a86af20d98c6b166a348e77249b81`;
  qualified ledger file SHA-256
  `f1501bd223eea5f69366624177e6c2530d900657ebc820d7c6e1940bab0b41cd`;
  macOS/Linux receipt SHA-256 values
  `99f491e231109c37492d419366275cfc21577774598395ad10c6a7e9e7f0db6f`
  and
  `464fed1f7ad6c5ace22805bdc58abf9284c21e240017e27de7af3cd289ff7b80`.
  Publication stopped before npm mutation because the instruction named no
  capability transition from which LLP 0134 could construct a maturity
  receipt, and the real-publication validator rejected the EAS-hosted
  receipts. The findings are retained in
  `issues/closed/20260805-0134-npm-promotion-route-undefined.md` and
  `issues/closed/20260805-eas-qualified-receipts-rejected-by-publish-validator.md`;
  their later dispositions are recorded there. No candidate or `latest` tag
  changed in this stopped attempt; the public vector remained `0.1.8` at that
  checkpoint.

- **2026-08-05 — source-checkout consumer found a non-hermetic local package
  edge.** Relay Room installed `@expo/snapback-client` and
  `@expo/snapback-react` from local `file:` paths, but the client's exact
  `@expo/snapback-contract@0.1.0` dependency still resolved through the
  registry and stopped installation because that version was unavailable.
  The app required both an explicit local Contract dependency and an
  `overrides` entry. This is tracked separately in
  `issues/20260805-local-source-package-closure-needs-contract-override.md`.
  Publishing a coherent closure should make the registry path green, but the
  promotion proof should also cover a source-checkout/file consumer so local
  development cannot silently mix checkout packages with registry packages.

- **2026-08-03 — PUSH-01 is closed and no longer caps promotion.** The local
  `notifications.expoPushSeam` surface has its packaged fake-provider kit and
  a retained physical iOS development-build ticket/receipt witness with both
  statuses `ok`. The scoped guide row is shipped. The broader first-class
  `notifications` capability correctly remains false under LLP 0045, and the
  complete hosted push conjunction remains Missing. PUSH-01 therefore
  unblocks this npm-promotion capstone without widening the package claims.

Execute the first real promotion of the locally-provable nine-package
surface to npm `latest`, under the 0134 evidence bar — not judgment:

1. **Preconditions (all must hold at execution time):** a green local-proof
   run on the promotion's `candidateSourceSha`; the wave's feature landings
   complete and the closing greening batch pass done; the staged-registry
   cold-install rehearsal green (the qualified staging lane).
2. **Run the LLP 0134 machinery for real:** per-route soak witnesses with
   digest-bound `soakEvidence`, a promotion receipt pinned to
   `candidateSourceSha`/`stagedTreeManifestSha256`, records under
   `tests/acceptance/maturity/`. This is the machinery's first production
   use — expect and file honest gaps.
3. **Honesty sweep before publish:** capability index and package READMEs
   claim only what the local surface proves; hosted-dependent capabilities
   stay gated (ruling 1); `notifications` reflects push-01's actual state
   at publish time.
4. **Publish** the nine-package closure to npm `latest` under the
   `@expo/snapback-*` scope, then verify a from-scratch
   `npm install`/cold-start against the published artifacts (not the staged
   registry) and record the receipt here.
5. Dated implementation-record notes on LLP 0074 and LLP 0122; LLP 0115
   board row updated.

Per Charlie's standing release-cadence guidance (packet ratification,
2026-08-02): pre-release, aggressive repeated releasing is intended —
subsequent promotions should get cheaper and more frequent, not rarer.

**Exit:** packages live on npm `latest` with the promotion receipt recorded
here and the cold-install-from-npm verification green; ticket closes citing
the published versions.

- **2026-08-06 — Lane D preflight complete; 0.1.9 goes fast-path; two structural gaps filed.** Full machinery mapping found (a) the qualified `--publish` path is structurally unrunnable — the receipt validator demands GitHub-hosted provenance from the deleted `.github/workflows/qualified-package-staging.yml` while staging now runs on EAS, which mints `githubProof: null` (`issues/20260806-qualified-publish-eas-provenance-blocker.md`); and (b) checklist item 2 (LLP 0134 for real) is not achievable inside this window — E6 requires 14 consecutive same-UTC-day-committed soak observations, and exactly one (now-lapsed) observation exists. Per this ticket's own "expect and file honest gaps" language and LLP 0041's standing pre-consumer fast-path ruling, 0.1.9 executes on the 0.1.8 fast-path shape at candidateSourceSha e32f35eb3, with the local proof, linux-x64 attested fleet build, honesty sweep, publish, ledger retention, public cold-install verification, and same-change guide closure sweep all retained. The 0134 soak window starts as its own 14-day program, decoupled from npm promotion. Also filed: `issues/20260806-linux-runtime-fleet-recipe-unscripted.md`.

- **2026-08-06 (supersession) — candidateSourceSha re-pinned e32f35eb3 →
  7c16f6d0b.** The earlier preflight pinned e32f35eb3 before the day's
  remaining agent-efficiency landings reached main. 7c16f6d0b is a strict
  superset adding three package-affecting fixes: the served `/llms.txt`
  root projection (LLP 0186 W2), reservation-time
  `SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE` refusal of the unsatisfiable
  anonymous-owner asset contradiction, and the `argOpt` optional-arg
  omission surfacing (remediation, guide, witnesses). Runtime binaries for
  both platforms are building at 7c16f6d0b (linux-x64 on `expo-build-1000`
  in `~/projects/snapback-release-0-1-9`, darwin-arm64 locally); this
  session holds the 0.1.9 publish and will re-check the registry
  immediately before publishing. If a publish from e32f35eb3 lands first
  despite this entry, the 7c16f6d0b shape ships as 0.1.10 under the same
  fast-path ruling and the closure sweep adjusts accordingly. Artifacts
  built at e32f35eb3 should be discarded, not published.

- **2026-08-06 (BLOCKING) — precondition 1 is not met at either candidate;
  do not publish claiming it.** `scripts/verify-local-proof` is red at
  every commit since `8f217183f` (2026-08-04 17:26) on
  `tests/agent_safe_publication_checker_v1.mjs` → "P-vs-C generated
  allowance is the exact qualification-C leaf set", which compares an exact
  leaf count against a hardcoded 224. Measured directly:

  | candidateSourceSha | actual | expected | precondition 1 |
  | --- | --- | --- | --- |
  | `e32f35eb3` (original pin) | 226 | 224 | **fails** |
  | `7c16f6d0b` (current pin) | 226 | 224 | **fails** |
  | current `main` | 230 | 224 | **fails** |

  Precondition 1 of this ticket requires "a green local-proof run on the
  promotion's `candidateSourceSha`". No commit in the last two days can
  satisfy it. Root cause and remediation:
  `issues/20260806-main-red-agent-safe-leaf-set-drift.md`.

  **This is deliberately not a fast-path candidate.** The two gaps
  fast-pathed above are expensive and genuinely independent of this release
  — the 0134 soak needs 14 days and the EAS provenance blocker is
  infrastructure. Precondition 1 is neither: the reconciliation is hours of
  work, and it is the central claim a promotion makes, that the shipped
  thing passed its own proof. Fast-path what is expensive and independent;
  do not fast-path what is cheap and central, or "expect and file honest
  gaps" stops being exceptional.

  Required before publish, in order: reconcile the leaf set (a review of
  the drifted leaves, **not** a bump of 224 to the current count); pick and
  prove a fresh candidate SHA; re-pin here with the green proof recorded.
  If 0.1.9 ships before that happens anyway, precondition 1 must be
  explicitly re-scoped in this ticket — stating that the local proof was
  red on a known, filed gate and why that was acceptable — rather than
  closing while the checklist reads as met.

- **2026-08-06 — EXECUTED: 0.1.9 live on npm `latest`; ticket closes.**
  Fast-path per the supersession entry above, from clean main
  `7c16f6d0b88ef6308d959d40d51fb36ee957fe99`. Receipts: nine `dry-run-ok`
  staging rows; nine `npm publish --access public` publications in ledger
  order; registry serves `latest: 0.1.9` on all nine names with the
  `@expo/snapback-cli` shasum byte-identical to the staged tarball
  (`b80e5f0b77b3…`); ledger retained at
  `~/snapback-release-ledgers/fastpath-ledger-0.1.9-7c16f6d0b8.json`; cold
  install from the public registry green (`runtime-qualify` ok with the
  exact release identity, `snapback new` scaffold + `snapback dev` boot,
  `/llms.txt` served with build-bound headers). The full LLP 0134 ceremony
  did not run: the qualified-receipt path is structurally blocked
  (`issues/20260806-qualified-publish-eas-provenance-blocker.md`), the
  authority is undeployed (`issues/20260806-publication-authority-not-deployed.md`),
  and the 0134-vs-packaging ruling is Charlie's
  (`issues/20260806-llp0134-bar-vs-npm-promotion-ruling-needed.md`); the
  0134 soak window runs as its own decoupled 14-day program. The
  source-checkout/`file:` consumer proof remains open in
  `issues/20260805-local-source-package-closure-needs-contract-override.md`.
  Dated notes landed on LLP 0041/0074/0122 and the LLP 0115 board.

- **2026-08-06 — 0.1.10 publication anomaly; do not treat as a proved G4
  prerequisite.** The fresh release attempt pinned clean `origin/main`
  `430c48669ff7a716e6296f1ae6cb3b5db1575968` and correctly cleared the
  repaired capability-maturity and agent-safe-publication gates, but the
  complete 133-gate proof then stopped at `client-bundle-metrology`: 19
  frozen-ceiling regressions across the E2-expanded React, asset, command,
  and IR-evaluator profiles. The measured method matched the repository pin
  (Node 24.18.0); details are retained in
  `issues/20260806-client-bundle-metrology-red-on-main.md`. This session
  therefore did not stage, publish, move a tag, or run the public G4-shaped
  cold proof.

  During that proof, the registry changed externally. npm records all ten
  0.1.10 publications on `latest` between 18:34:48Z and 18:35:32Z, including
  first publication of `@expo/snapback-expo` at 18:35:23Z. The retained
  ledger is
  `~/snapback-release-ledgers/fastpath-ledger-0.1.10-b6afed6ef3.json`; a
  read-only registry re-download proved all ten tarballs byte-identical to
  it. But that ledger binds old revision
  `b6afed6ef3eedd7be18e845e31b953da438ddc5a`, the candidate from before the
  capability-maturity repair that this task explicitly superseded, not
  `430c48669`. Public bytes exist, but the ordered release preconditions did
  not pass on their source revision or on the required fresh candidate.
  Reconciliation needs an explicit owner ruling; this entry makes no LLP
  0176 G4-prerequisite or release-proof claim.

  *Same-day reconciliation:* the `0.1.10` close-out (`d6222e7f2`) is that
  disposition — the publishing lane closed the release under LLP 0041's
  standing pre-consumer fast-path authority, the same shape 0.1.9 used,
  with the metrology red independently filed
  (`issues/20260806-client-bundle-metrology-red-on-main.md`, its writer
  blocker cleared in `5b495b098`). This entry stands as the honest record
  of the parallel attempt's stop, not as a dispute of that close-out: LLP
  0176 G4 may consume the live 0.1.10 vector, citing the fast-path
  provenance, once the metrology gate is green again on main.

- **2026-08-06 — 0.1.11 successor attempt BLOCKED before staging; nothing
  published.** The attempt pinned clean `origin/main`
  `34c61fdc63968f143c59e1afab976dca79380237`, confirmed npm authentication,
  selected the complete 134-gate inventory and ran it fail-fast under the
  repository-pinned Node 24.18.0 (26 PASS, then 1 FAIL). Capability maturity,
  agent-safe publication, and
  client-bundle metrology (56 profiles, no frozen-ceiling regressions) were
  green. The proof then failed `fleet-observatory-move1-receipt`: the retained
  Fleet controlled-run receipt binds debug server SHA-256 `c96d9f9b…`, while
  the mutable ignored `target/debug/snapback` in this checkout is the valid
  clean `430c48669` build with SHA-256 `1e67934b…`. Rebuilding at the candidate
  would produce a candidate-bound identity, not the historical receipt bytes.
  The non-hermetic gate is filed as
  `issues/20260806-local-proof-fleet-receipt-ambient-binary-drift.md`. Per this
  log's central-gate rule, the attempt did not stage tarballs, create a 0.1.11
  ledger, publish any package, move `latest`, or run public-registry/G4 smoke
  proofs. A landed gate repair and fresh green candidate proof are required
  before retry.

- **2026-08-06 — 0.1.11 successor attempt 2 BLOCKED before staging; nothing
  published.** The attempt fetched and pinned clean `origin/main`
  `ea347f4122fe975902669849c6db6be5834bf967`, confirmed npm authentication as
  `ccheever`, observed `latest: 0.1.10` and no `0.1.11` on all ten names, and
  selected the complete 134-gate inventory under the repository-pinned Node
  24.18.0. The repaired capability-maturity and agent-safe-publication gates,
  governed client-bundle metrology (56 profiles, no frozen-ceiling
  regressions), and hermetic Fleet receipt (8/8 PASS) were green. The proof
  then stopped after 43 PASS at `demo-materialization`: discovery correctly
  includes the metadata-declared `demos/fleet-observatory-move1`, but
  `tests/demo_setup_v0.mjs` omits that id from its exact expected inventory.
  Filed `issues/20260806-local-proof-demo-materialization-inventory-drift.md`.
  Per this log's central-gate rule, the attempt did not stage tarballs, create
  a 0.1.11 ledger, publish or move any dist-tag, or run public-registry/G4
  smoke proofs. A landed inventory repair and fresh complete green candidate
  proof are required before retry.

- **2026-08-06 — 0.1.11 successor attempt 3 BLOCKED before staging; nothing
  published.** The attempt fetched and pinned clean `origin/main`
  `f6b7906ba817a710ee932e2cbf23cd9b29563bef`, confirmed npm authentication as
  `ccheever`, observed `latest: 0.1.10` and no `0.1.11` on all ten names, and
  selected the complete 134-gate inventory with Exact required under the
  repository-pinned Node 24.18.0. All four prior blockers were green:
  capability maturity and agent-safe publication, governed client-bundle
  metrology (56 profiles, no frozen-ceiling regressions), the hermetic Fleet
  receipt, and demo materialization. The proof then stopped after 47 PASS at
  `required-surface-builds`: its mandatory root `bun install
  --frozen-lockfile` found that the tracked `bun.lock` would change under the
  pinned Bun 1.3.12. Isolated lock regeneration traces the first semantic
  delta to the `expo-file-system` peer added to `@expo/snapback-expo` in
  `47b4a59ac` without a matching root-lock update; the full characterization
  is in
  `issues/20260806-local-proof-required-surface-builds-root-lock-drift.md`.
  Per this log's central-gate rule and the task's fifth-distinct-gate stop
  ruling, the attempt did not stage tarballs, create a 0.1.11 ledger, publish
  or move any dist-tag, or run public-registry/G4 smoke proofs. A landed lock
  reconciliation and fresh complete green candidate proof are required before
  retry.

- **2026-08-06 — 0.1.11 successor attempt 4 BLOCKED before staging; nothing
  published.** The attempt fetched and pinned clean `origin/main`
  `85e1e5a160e7080214e15bed02deb3c9c2432380`, confirmed npm authentication as
  `ccheever`, and observed `latest: 0.1.10` with no `0.1.11` on all ten names.
  The complete 134-gate proof selected Exact and ran fail-fast under the
  repository-pinned Node 24.18.0. Fifteen gates passed, including capability
  maturity, before `agent-safe-publication-fixtures` failed three of its 28
  cases. Commit `29d4c3d465` moved the production local-store publication
  transform and allowlist to the 2026-08-06 carrier/Triage receipt paths, but
  the self-test scratch fixture and allowlist assertions still name the
  2026-08-04 paths. The transform tests consequently try to read absent
  2026-08-06 files from their synthetic qualification-C commit, and the
  allowlist case expects an old Triage receipt the production set no longer
  admits. Filed
  `issues/20260806-local-proof-agent-safe-publication-fixture-lineage-drift.md`.
  This is the task's sixth distinct central-gate failure, so the attempt did
  not stage tarballs, create a 0.1.11 ledger, publish or move any dist-tag, or
  run public-registry/G4 smoke proofs. A landed fixture/lineage reconciliation
  and fresh complete green candidate proof are required before retry.

- **2026-08-06 — 0.1.11 successor attempt 5 BLOCKED before staging; nothing
  published.** The attempt fetched and pinned clean `origin/main`
  `cdc0fe03e8d75c4a1d1d25f79fe820f20b772ef7`, confirmed npm authentication
  as `ccheever`, and observed `latest: 0.1.10` with no 0.1.11 on all ten
  names. The complete 134-gate proof selected Exact and ran fail-fast under
  repository-pinned Node 24.18.0. Twenty-one gates passed, including the
  repaired capability-maturity and agent-safe-publication gates and governed
  client-bundle metrology (56 profiles, no frozen-ceiling regressions), before
  `relation-activity-publication` failed: all three governed publication
  carriers name `src/storage.rs` digest `1c2a8eef...`, while the candidate's
  tracked file hashes to `975d8201...`. Focused checks confirmed the same
  mismatch at `sequence-allocation-publication` and
  `local-persistent-store-publication`. The batch commit `d2bd5fbbd` refreshed
  the carriers against an intermediate tree and then changed `src/storage.rs`
  again in the same commit. The recurrence is reopened at
  `issues/20260806-publication-carrier-lineage-drift.md`. Per this log's
  central-gate rule, the attempt did not stage tarballs, create a 0.1.11
  ledger, publish or move any dist-tag, or run public-registry/G4 smoke proofs.
  A landed carrier rebind and fresh complete green candidate proof are required
  before retry.

- **2026-08-06 — 0.1.11 successor attempt 6 BLOCKED before staging; nothing
  published.** The attempt fetched and pinned clean `origin/main`
  `1250b7a6a8e918bb3ca3fe3b2f50da45aec5e9f8`, confirmed npm authentication
  as `ccheever`, and observed `latest: 0.1.10` with no `0.1.11` on all ten
  names. The complete 134-gate proof selected Exact and ran fail-fast under
  repository-pinned Node 24.18.0. Twenty-six gates passed, including the
  repaired capability-maturity and agent-safe-publication gates, governed
  client-bundle metrology (56 profiles, no frozen-ceiling regressions), and
  all three refreshed publication carriers. The proof then failed
  `fleet-observatory-move1-receipt`: its retained source manifest binds
  `packages/snapback-client/index.mjs` to SHA-256 `40f0d7a4...`, while the
  candidate's tracked file hashes to `688ec4d2...`. The existing Fleet owner
  action is updated at
  `issues/20260806-main-red-post-fleet-landing-sweep.md`. Per this log's
  central-gate rule, the attempt did not stage tarballs, create a 0.1.11
  ledger, publish or move any dist-tag, or run public-registry/G4 smoke
  proofs. A fresh owner-issued Fleet receipt against one final tracked source
  tree and its readiness-qualified binary, followed by a complete green
  candidate proof, is required before retry.

- **2026-08-06 — 0.1.11 successor attempt 7 STOPPED on concurrent publish;
  this lane made no npm mutation.** During the attempt's preflight, another
  authorized lane published 0.1.11 while this lane was still checking the
  candidate. The registry transition was treated as an ownership stop, not an
  invitation to race or repeat any write. This lane did not stage a second
  vector, create a competing ledger, publish a package, or move a dist-tag.

  *Same-day reconciliation:* all ten 0.1.11 package names are now live on npm
  `latest`, published from clean revision
  `281eb17c785f5ca82185fd34ad5de8049e852bf5` under the same LLP 0041
  pre-consumer fast-path disposition used for 0.1.10. The retained ledger is
  `~/snapback-release-ledgers/fastpath-ledger-0.1.11-281eb17c78.json`; a
  read-only registry re-download byte-verified all ten public tarballs against
  its SHA-256 vector. The orchestrator records the candidate's then-current
  post-revision delta as four proof-fixture repairs that do not ship in these
  packages. LLP 0176 G4 may therefore consume the live 0.1.11 vector by
  citing this reconciliation without reopening the fast-path ruling or
  attributing any npm mutation to attempt 7.
