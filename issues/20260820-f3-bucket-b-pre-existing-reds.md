# F-3 bucket B: the 36 pre-existing product reds, triaged into a plan

**Status:** Open
**Filed:** 2026-08-20
**Systems:** Verification, Auth, Live/realtime, Publication, Codegen
**Related:** LLP 0283 F-3, LLP 0189, LLP 0175, LLP 0276 Phase 4,
`issues/20260820-f3-complete-battery-toolchain-preconditions.md`

## Why this exists

The LLP 0283 F-3 complete proof battery ran end to end for the first time on 2026-08-20,
after three toolchain preconditions were fixed. Its failures triaged into four buckets:
2 environmental, 6 regressions from the 2026-08-19/20 program (fixed or ticketed), 3 expected
red until F-1 — and **36 pre-existing product reds that had never been examined**.

This is that examination. It was produced as read-only analysis against the battery log at
commit `157118d4e`.

## Headline

The 36 gates collapse to roughly **29 work items**. It is mostly accumulated migration,
fixture, golden and publication-evidence debt — **but it is not harmless**: at least six gates
contain credible product defects, including TypeScript exports without declarations,
offline/outbox failures, handshake validation, authorization transitions, and ephemeral
recovery after restart.

Estimate: **7–12 engineer-days if the auth/outbox failures converge on shared roots, 12–20 if
they do not.** That is an estimate, not a schedule, and the log does not yet prove the
convergence either way.

## Two clusters worth knowing before costing anything

- **Nine gates are wholly or partly preempted by the 2026-08-16 explicit visibility /
  write-policy enforcement.** Six look like straightforward fixture migration; three carry
  additional failures.
- **Two publication-carrier gates are the same stale `local.rs` digest.**

Finding clusters was the point of the exercise: today already produced two cases where one
root explained many symptoms — an unassigned generated file caused three failing gates, and a
single Node version mismatch blocked 123.

## What this does and does not block

Per LLP 0189, complete-battery reds are signature-keyed **fix-forward** work, not ambient
landing blockers, and release is blocked only by claim-relevant gates. **Publication is
already blocked by F-1 independently of anything here.** But LLP 0276 Phase 4 requires every
red to carry signature continuity and a disposition, and required-green gates — migration
inventories, cold-clone witnesses, publication claim-relevant gates — cannot be excluded. So
"blocks nothing" below means *needs a Phase 4 disposition, not a fix before Phase 4*.

---

# Bucket B analysis and prioritized plan

## Honest headline

Bucket B is **mostly accumulated migration, fixture, golden, and publication-evidence debt—but it is not harmless**.

The 36 failing gates collapse to roughly **29 work items**, with two valuable clusters:

- **Nine gates are wholly or partly preempted by the August 16 explicit visibility/write-policy enforcement.** Six look like straightforward fixture migration; three contain additional failures.
- **Two publication-carrier gates are the same stale `local.rs` digest.**

Most remaining failures are small and independent. However, at least six gates contain credible product defects: TypeScript exports without declarations, offline/outbox failures, handshake validation, authorization transitions, and ephemeral recovery after restart. The auth/outbox failures may share one or two roots, but the log does not prove that yet.

A reasonable total is **7–12 engineer-days if the auth/outbox failures converge on shared roots; 12–20 if they do not**. That is an estimate, not a schedule.

## Blocker interpretation

The battery tested `157118d4e` and selected all 172 gates (`f3m2-proof.log:1`). The 36-gate roster is verified at `/Users/ccheever/lanes/out/f3-triage2.md:59-98`.

The important policy distinction is:

- Complete-battery reds become signature-keyed fix-forward work, not ambient landing blockers (`llp/0189-verification-cadence-and-claim-gating.decision.md:96-112`).
- Release is blocked only by claim-relevant gates; unrelated reds are ticketed and named (`llp/0189-verification-cadence-and-claim-gating.decision.md:217-228`).
- Phase 4 requires every red to have signature continuity and a disposition. Required-green gates—migration-sensitive inventories, cold-clone witnesses, and publication claim-relevant gates—cannot be excluded (`llp/0276-ideal-codebase-architecture.rfc.md:573-599`).
- Publication is already blocked by F-1 independently of Bucket B (`llp/0283-post-rearchitecture-followups.plan.md:48-57`).

Therefore, unless noted below, “blocks nothing” means: **it still needs a Phase 4 ticket/disposition, but it need not be fixed before Phase 4**.

## Root-cause ledger

`VERIFIED` means directly established from the log, source, or history. `INFERRED` marks diagnosis or cost.

| Work item | Failure, age, meaning, cost, blocker |
|---|---|
| 1. `authoring-profile-branches` | **VERIFIED:** The checker finds a read of `authoringProfile` at `crates/snapback-sync/src/ephemeral.rs:673`, outside its adapter/custody/admission allowlist (`f3m2-proof.log:1191-1196`). That fixture entered in `15b5e4525`, 2026-08-17. **INFERRED:** Architecture-policy violation, not demonstrated runtime breakage. Trace whether the Rust fixture should consume the normalized manifest or be admitted explicitly. **Cost:** hours. **Blocks:** disposition only; possibly F-1 affected scope if touched. |
| 2. `agent-safe-publication-fixtures` | **VERIFIED:** `tests/agent_safe_publication_checker_v1.mjs:2513-2518` expects the build digest to bind every implementation root; `Cargo.toml` is missing (`f3m2-proof.log:1433-1436`). Relevant path lineage ends at `91744ae8d`, 2026-08-17. **INFERRED:** Publication-integrity contract drift, not runtime behavior. Establish whether `Cargo.toml` belongs in the digest or in the checker’s root set. **Cost:** hours. **Blocks:** likely publication/Phase 4 required-green because it validates the publication checker; exact current D-4 scope must be derived. |
| 3. `agent-safe-publication` | **VERIFIED:** The qualification-C custody record says `crates/snapback-engine/src/local-sequence-allocation-publication.v1.json` moved to `sequence-allocation-publication`, but the historical registered gate does not cover that path (`f3m2-proof.log:1453-1473`; checker at `scripts/check-agent-safe-publication.mjs:1120-1139`). Checker custody logic dates to `04332ab8b`, 2026-08-09; the path migration candidate is `91744ae8d`, 2026-08-17. Static history does not prove the first red. **INFERRED:** Frozen publication-chain custody mismatch; do not weaken it casually. **Cost:** hours, possibly a day if the historical record must be repaired. **Blocks:** historically publication claim-relevant (`llp/0041-packaged-dev-loop.rfc.md:1576-1580`), therefore publication/Phase 4 if still in current scope. |
| 4. `client-bundle-metrology` | **VERIFIED:** Missing narrow profile `resolved-public-subpath-app-client-internal` (`f3m2-proof.log:1475-1496`, assertion `scripts/client-bundle-metrology.mjs:2990`). The `./app-client-internal` public export entered in `b186296fd`, 2026-08-15; see `packages/snapback-client/package.json:135-138`. **INFERRED:** Evidence/metrology gap for a shipped export, not proof that the implementation is broken. **Cost:** hours. **Blocks:** verified historical publication scope and thus Phase 4 required-green if current scope is unchanged. |
| 5. `package-export-types` | **VERIFIED:** `@expo/snapback-codegen` exports `./visibility-governance` and `./visibility-governance-dev-config` without `types`, causing TS7016 for external TypeScript consumers (`f3m2-proof.log:1504-1517`; `packages/snapback-codegen/package.json:125-126`). Introduced by `51157f37e`/`d6ad5f123f`, 2026-08-16. **Meaning:** genuine published-package defect. **Cost:** hours—add declarations or make/remove internal exports, then exercise an external consumer. **Blocks:** not historically a formal publication blocker; LLP 0041 explicitly carried this class as ticketed (`llp/0041-packaged-dev-loop.rfc.md:1580-1584`). It should nevertheless be fixed before the next quality claim. |
| 6. Shared `local.rs` carrier root: `relation-activity-publication`, `local-store-publication` | **VERIFIED:** Both compare the same actual `sha256:862d…` with expected `sha256:6279…` for `crates/snapback-engine/src/local.rs` (`f3m2-proof.log:1548-1571`, `1598-1621`). Source drift is `94f759394`, 2026-08-18. **Meaning:** one carrier/golden drift, not two feature failures. Audit the source delta once, then refresh both records together. **Cost:** minutes to hours. **Blocks:** disposition only unless included by the current publication claim. |
| 7. `fleet-observatory-move1-receipt` | **VERIFIED:** Retained schema digest actual `e872…`, expected `e272…` (`f3m2-proof.log:1633-1658`; verifier `tests/acceptance/fleet-observatory-move1-v1.mjs:989`). Last implicated schema change is `7264b4008`, 2026-08-16. **Meaning:** receipt drift; validate the visibility-policy change before reminting. **Cost:** hours. **Blocks:** disposition only. |
| 8. `template-portfolio-self-check` | **VERIFIED:** `crud-dashboard` “does not register its carrier kit for a cold agent” (`f3m2-proof.log:1863-1874`; checker `scripts/template-portfolio-qualification-lib.mjs:351-363`). It already ships `carry:headless` and a valid carrier (`packages/snapback-cli/templates/crud-dashboard/package.json:11-13`, `carrier.mjs:11`), but its agent packet advertises only the web carrier (`AGENTS.md:11`). Contract dates to `89ed8b646`, 2026-08-08. **Meaning:** real cold-agent discoverability defect, not missing capability. **Cost:** minutes. **Blocks:** likely the template/cold-clone portion of Phase 4; confirm which template witness is selected. |
| 9. `app-api-md-fixtures` | **VERIFIED:** Four fixture functions omit required `stream` and `authorityProfileDependence` fields (`f3m2-proof.log:49545-49560`; failing test begins `scripts/generate-app-api-md.test.mjs:369`). Fields came from `8d0df9ee6`, 2026-08-17. **Meaning:** test fixture schema staleness. **Cost:** minutes. **Blocks:** disposition only. |
| 10. `contract-meta` | **VERIFIED:** The Coterie sidecar declares `COTERIE_COMPOSER_MEDIA_OPTIONS` as `pure`, but the source exports a constant rather than a function (`f3m2-proof.log:49562-49568`; sidecar `demos/coterie/src/data/coterie-fixtures.contract-meta.ts:20`, source `coterie-fixtures.ts:12`). Introduced in `56487e369`, 2026-08-16. **Meaning:** generated/hand-authored metadata staleness. It also blocks `contract-meta-fixtures`. **Cost:** minutes. **Blocks:** disposition only, but fixing improves two gate statuses. |
| 11. `cargo-clippy` | **VERIFIED:** Two findings: `Result<(), ()>` at `crates/snapback-types/src/auth/descriptor.rs:102`, and `manual_flatten` at `manifest/types.rs:1751-1759` (`f3m2-proof.log:51465-51510`). The unit-error content dates to `8e11168bf2`, 2026-07-13, moved by `0f4181ad2`, 2026-08-18; the flatten case dates to `f4019e182`, 2026-08-18. **Meaning:** code-quality red, no observed product defect. **Cost:** minutes. **Blocks:** operationally blocks an F-1 Rust landing because affected Rust changes select Clippy (`llp/0175-local-proof-economics.rfc.md:609-623`). |
| 12. `cargo-audit` | **VERIFIED:** RUSTSEC-2026-0249 marks `smartstring 1.0.1` unmaintained through SWC → Ibex → Snapback (`f3m2-proof.log:51512-51558`). The advisory predates the dependency; `Cargo.lock:4001-4010` entered in `fdd348c796`, 2026-06-27. **Meaning:** supply-chain maintenance risk, not an identified vulnerability. **Cost:** days or needs-design because the owner is the Ibex/SWC closure. A time-bounded advisory disposition is possible, but deleting the audit is not. **Blocks:** current claim scope must decide publication relevance; otherwise disposition only. |
| 13. Explicit visibility/write-policy migration: `rust-tests`, `asset-conformance`, `app-cli-served-journey`, `app-cli-settlement-goldens`, `codegen-regressions`, `live-delta-e2e` | **VERIFIED:** One August 16 enforcement family preempts all six. `rust-tests` has five watchdog mutations/cron flows refused with `SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED`; its fixture still has `visibility: None` at `crates/snapback/tests/action_watchdog_v0.rs:184` from `a35bbe37e1`, 2026-08-11 (`f3m2-proof.log:53792-53849`). Asset generation rejects seven undeclared table visibilities; both app-CLI acceptances reject `notes`; all nine codegen regression cases are preempted by implicit visibility; all three live-delta writes lack a table policy (`f3m2-proof.log:56000-56070`, `56690-56713`, `56895-56910`). Enforcement landed in `7264b4008`/`4fe648fd0`, 2026-08-16. **Meaning:** fixture migration, not evidence those named capabilities broke. Policies must be semantically chosen—never blanket `public-read`. **Cost:** hours to days as one lane. **Blocks:** `rust-tests` operationally blocks F-1 and `auth-invalidation-report`; the others need Phase 4 disposition unless selected by a claim. |
| 14. Mixed Todo migration: `todo-headless`, `todo-v2-headless` | **VERIFIED:** Todo v1 has four failures: oversized ephemeral cursor returns argument normalization instead of value-too-large; an `In` matcher lacks a generated function reference; two negative tests are preempted by visibility-plan/implicit-visibility errors. Todo v2 has the same two visibility-preempted negative tests (`f3m2-proof.log:56072-56109`, `56158-56185`). All implicated changes predate August 19; the precise first-red commits for the normalization expectations are not established. **Meaning:** two visibility fixtures plus two generated-reference/diagnostic expectation drifts; no runtime Todo failure was observed. **Cost:** hours. **Blocks:** disposition only. |
| 15. `provider-live-conformance` | **VERIFIED:** Three independent failures: codegen migration cross-check receives `SNAPBACK_AUTH_SCOPE_FIELD_WITHOUT_CALLER_PREDICATE`; permission resync refuses caller-provided owner input with `SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED`; optimistic-create fixture lacks explicit visibility (`f3m2-proof.log:56720-56747`). Lineage is August 15–16. **Meaning:** mostly fixture/policy migration, but owner-input semantics require an explicit decision. **Cost:** hours; potentially needs-design for the owner-input case. **Blocks:** disposition only absent a matching claim. |
| 16. `local-store-carrier-receipt` | **VERIFIED:** Retained source digest actual `2fcf…`, expected `0243…` for `tests/acceptance/local-store-carrier-exit-v1.mjs` (`f3m2-proof.log:53853-53878`; verifier around source line 2702 in the logged checkout). Inputs predate August 19, but static history does not isolate the first mismatching commit. **Meaning:** receipt drift. Audit before reminting. **Cost:** minutes to hours. **Blocks:** disposition only unless current storage/publication scope includes it. |
| 17. `snapback-cli-real-server` | **VERIFIED:** `packages/snapback-cli/package.test.mjs:630-638` forbids direct `SnapbackClient`, `createExternalSessionClient`, `AuthCoordinator`, bearer, or `adoptAuthority` usage in generated Expo acceptance; the template imports/calls `createExternalSessionClient` at `templates/expo-chat/acceptance.mjs:17,446-450` (`f3m2-proof.log:55320-55330`). Both sides were introduced August 16 (`5f1e79bbc`, `224fbcd9e`). **Meaning:** source-custody/architecture disagreement in a shipped template harness. Determine whether LLP 0258 permits a harness-only exception; otherwise route through the product facade. **Cost:** hours. **Blocks:** likely publication/Phase 4 because the full CLI suite was historically claim-relevant, but derive the current D-4 set. |
| 18. `workout-apps` | **VERIFIED:** Three distinct groups: dispatch-board expects validation but receives normalization for trusted timestamp injection; public-dashboard offline-local-first fails five cases, beginning with `SNAPBACK_CLIENT_REFUSED: fetch failed` and later a restart-settlement timeout; card-game offline custody fails all three with the same fetch refusal (`f3m2-proof.log:56187-56289`). Originating client/policy work is August 16–17; the precise first-red commit is not established. **Meaning:** dispatch is test expectation drift. The eight offline failures are credible user-visible offline/outbox defects or one shared harness/authority setup error. **Cost:** dispatch minutes; offline cluster days until isolated. **Blocks:** no formal release blocker established, but high product urgency. |
| 19. `all-aboard-egress` | **VERIFIED:** Loopback `ctx.fetch` is refused by `SNAPBACK_HOST_FETCH_SSRF_REFUSED`; dependent `config.verify` is consequently false (`f3m2-proof.log:56321-56348`). The test enables actions at `demos/all-aboard/tests/acceptance/egress.mjs:85` but not explicit loopback; policy requires `SNAPBACK_OUTBOUND_LOOPBACK=1` at `crates/snapback-services/src/outbound_policy.rs:53-68`, introduced by `2d543c8c59`, 2026-08-12. LLP 0036 still requires local host-mediated fetch. **Meaning:** harness capability omission, not an SSRF-product regression. **Cost:** minutes. **Blocks:** disposition only. |
| 20. `expo-chat-template-typecheck` | **VERIFIED:** Actual dev dependencies omit `fake-indexeddb ^6.2.5` (`f3m2-proof.log:56372-56402`; checker `scripts/check-expo-chat-template-typecheck.mjs:145`), while shipped acceptance imports it at `templates/expo-chat/acceptance.mjs:20`. Dependency work ends at `f6bc463b8`, 2026-08-17. **Meaning:** real fresh-template/package defect. **Cost:** minutes to hours including lock/typecheck validation. **Blocks:** likely CLI cold-install/Phase 4 witness; exact current scope required. |
| 21. `auth-handshake` | **VERIFIED:** Two failures: a non-null unsolicited `authInvalidation` echo is accepted instead of raising `SNAPBACK_AUTH_HANDSHAKE_INVALID`; a delayed custody broadcast fails `SNAPBACK_OUTBOX_NOT_WRITER` (`f3m2-proof.log:56406-56440`). Protocol work ends August 16–17, including defaulting in `af6abdfbf`. **Meaning:** the first is a genuine handshake validation/security defect. The second belongs to the possible shared outbox-ownership cluster. **Cost:** hours to days. **Blocks:** high product/security priority; formal publication relevance must be derived. |
| 22. `auth-coordinator-client` | **VERIFIED:** Authority transition fails in `commitDurable` with cause `SNAPBACK_OUTBOX_AUTHORITY_TRANSITION_STALE` (`f3m2-proof.log:56457-56480`; transition handling `packages/snapback-contract/auth-coordinator.mjs:2520-2537`). Relevant client work predates August 19. **Meaning:** genuine auth transition failure unless the test constructs an obsolete transition. **Cost:** hours to days. **Blocks:** high product urgency; may be affected by F-1 work. |
| 23. `auth-invalidation-client` | **VERIFIED:** After a stale ACK, `demos/_kit/tests/auth-invalidation-client.mjs:282-302` expects at least three `queue-apply:2` events and gets fewer (`f3m2-proof.log:56482-56503`). Test assertion dates to `f0f23d2ce9`, 2026-07-13; behavior changed in the August 16–17 invalidation wave. **INFERRED:** Either queue custody is not reinstalled, or the event-count assertion is brittle. The log lacks the actual event order. **Cost:** hours. **Blocks:** nothing formal until the semantic result is known. |
| 24. `client-errors` | **VERIFIED:** Five failures (`f3m2-proof.log:56526-56619`): stale handshake expectation omits default `authInvalidationProtocol:1`; external-bearer terminal loss records lifecycle failures; durable deletion returns `SNAPBACK_OUTBOX_AUTHORITY_TRANSITION_EPOCH_INVALID`; superseded credential expected but receives the same epoch error; admin query lacks a generated reference kind. Defaulting begins in `af6abdfbf`, 2026-08-16; transition work continues through August 17. **Meaning:** failures 1 and 5 are test/reference migration; failures 2–4 are credible auth/outbox defects. **Cost:** days for the gate as a whole, probably hours per root. **Blocks:** high product urgency; possible shared root with items 21–22 and 25. |
| 25. `snapback-client-package` | **VERIFIED:** `app-data.test.mjs:171` mutates through a client that no longer owns the shared outbox and gets `SNAPBACK_OUTBOX_NOT_WRITER` (`f3m2-proof.log:57080-57119`). The test creates a facade at `packages/snapback-client/app-data.test.mjs:104`, then another external session on the same default store at `:139`, before mutating the facade. Single-writer enforcement is August 16 (`c6e83ec4f`). **INFERRED:** Likely test setup staleness—dispose/isolate the second client or disable its queue—rather than a package product failure. **Cost:** minutes to hours. **Blocks:** disposition only unless current publication scope selects the package suite. |
| 26. `snapback-app-cli-package` | **VERIFIED:** Expected `['/auth/agents/token','/auth/agents/token/release']`; actual `['/auth/agents/token/release','/auth/session']` (`f3m2-proof.log:57302-57323`; test `packages/snapback-app-cli/auth.test.mjs:221-224`). Already reproduced and ticketed on 2026-08-15 at `issues/20260815-app-cli-auth-route-inventory-drift.md:13-39`. **Meaning:** stale route inventory or a real route regression; the existing ticket correctly requires the semantic owner to decide. **Cost:** minutes after decision, otherwise hours. **Blocks:** disposition exists; no additional blocker established. |
| 27. `snapback-contract-package` | **VERIFIED:** `limits.test.mjs` expects three enforcement sources but only one remains because it names removed `crates/snapback/src/manifest.rs` and `storage.rs` (`f3m2-proof.log:57389-57408`; `packages/snapback-contract/limits.test.mjs:18-31`). Paths were partially migrated in `91744ae8d`, 2026-08-17 and removed by the August 18 carve. **Meaning:** test path staleness, but the parity invariant remains valuable. **Cost:** minutes to hours. **Blocks:** **INFERRED Phase 4 required-green**, because this is exactly a path-sensitive inventory mutated by the rearchitecture. |
| 28. `snapback-codegen-package` | **VERIFIED:** Bootstrap-emitted `SNAPBACK_AUTH_BOOTSTRAP_RQS_STORE_INCOMPATIBLE` has no D9 diagnostic row (`f3m2-proof.log:57410-57444`; assertion `packages/snapback-codegen/client-lifecycle.test.mjs:365,451-485`). Code existed before August 19. **Meaning:** shipped diagnostic/declaration completeness defect, not runtime failure. **Cost:** minutes to hours including regeneration/parity review. **Blocks:** historically publication claim-relevant (`llp/0041-packaged-dev-loop.rfc.md:1576-1580`), so publication/Phase 4 if current scope is unchanged. |
| 29. `regression-ephemeral-wiring` | **VERIFIED:** Six cases pass, but after server restart the room remains stale and times out waiting for `live` after a fresh subscribe (`f3m2-proof.log:57743-57761`; invariant at `demos/_kit/tests/regression-ephemeral-wiring.mjs:384-421`). The test dates to July; relevant implementation last changed in `0477fda40`, 2026-08-15. The same signature persisted across both proof runs, but the exact first-red commit is not known. **Meaning:** genuine user-visible realtime recovery defect unless rerun reveals a harness-only restart issue. **Cost:** days. **Blocks:** no formal publication blocker established; high product urgency. |

## Prioritized execution plan

1. **Clear the cheap F-1 collateral first.** Fix the two Clippy findings, then give `action_watchdog_v0` an explicit visibility/write policy. This is hours of work, removes `cargo-clippy` and `rust-tests`, allows `auth-invalidation-report` to execute, and prevents unrelated test debt from obstructing the F-1 Rust lane.

2. **Run one focused auth/outbox/realtime investigation lane.** Treat `auth-handshake`, `auth-coordinator-client`, the substantive parts of `client-errors`, the offline portions of `workout-apps`, and `regression-ephemeral-wiring` as a candidate cluster—not yet as one confirmed bug. Instrument:

   - writer identity and store owner;
   - authority epoch/generation before and after transition;
   - queue ownership transfer;
   - socket-regain resubscription state;
   - the first causal diagnostic rather than wrapper `fetch failed`.

   Fix the unsolicited handshake echo rejection immediately; it is already isolated and security-relevant. If the remaining failures share the single-writer/epoch transition, one days-scale fix could clear several gates. If not, split ephemeral reconnect into its own lane.

3. **Make the known publication-required-green set green.** In order:

   - `client-bundle-metrology`;
   - `snapback-codegen-package`;
   - `agent-safe-publication-fixtures` and `agent-safe-publication`;
   - `snapback-cli-real-server`;
   - `expo-chat-template-typecheck`;
   - `snapback-contract-package`.

   Before implementation, derive the exact current D-4 claim scope rather than copying the historical 0.1.16 list. These are mostly hours-scale, but the agent-safe historical custody repair may consume a day.

4. **Execute one explicit policy-migration batch.** Cover the six clean cluster members first: watchdog, asset, both app-CLI fixtures, codegen regressions, and live-delta. Then handle Todo and provider-live separately because they contain additional generated-reference/owner-input failures. Policies should be selected table-by-table from the intended authority model; no bulk `public-read` migration.

5. **Run a short package/test hygiene batch.** These are independent but mechanically compatible:

   - template carrier packet;
   - app API fields;
   - Coterie contract metadata;
   - package export declarations;
   - app-CLI route decision;
   - Contract enforcement-source paths;
   - codegen D9 row;
   - Snapback client package test isolation;
   - all-aboard loopback capability.

   Expected cost: roughly one engineer-day if the route and CLI-custody decisions are already clear.

6. **Refresh frozen carriers only after functional sources stabilize.** Audit and refresh the shared `local.rs` carriers, fleet receipt, and local-store carrier receipt in one carrier lane. Refreshing earlier risks repeating the work and could bless unintended behavior.

7. **Give `cargo-audit` its own dependency lane.** Determine whether current Ibex/SWC can move off `smartstring`, whether a maintained fork/substitute exists, or whether a time-bounded RUSTSEC disposition is warranted. This needs an owner and expiry; it should not be mixed with fixture cleanup.

8. **Record every remaining signature.** Phase 4 does not require all unrelated reds to be green, but it does require signature continuity and explicit dispositions. Create one ticket per root signature, not one per gate; the shared `local.rs` pair and visibility cluster should not become duplicate tickets.

## Batching map

- **Lane A — F-1 Rust hygiene:** Clippy + watchdog policy.
- **Lane B — auth/outbox product:** handshake, coordinator, substantive client-errors, offline workout cases; possibly Snapback client package after diagnosis.
- **Lane C — realtime recovery:** ephemeral restart, separated if not the same outbox root.
- **Lane D — publication qualification:** agent-safe, bundle metrology, CLI custody, Expo dependency, codegen D9, Contract path parity.
- **Lane E — visibility/write migration:** six clean gates, then Todo/provider residuals.
- **Lane F — frozen evidence:** relation/local-store carriers, fleet receipt, local-store carrier receipt.
- **Lane G — quick JS metadata:** app API, Coterie, template packet, app-CLI route, export declarations, all-aboard.
- **Lane H — dependency design:** `smartstring`/SWC/Ibex.

## Delete or retire recommendations

There is **no evidence sufficient to delete any canonical gate**. LLP 0175 requires mutation overlap, retained unique-failure history plus review, or proof that the guarded product claim no longer exists (`llp/0175-local-proof-economics.rfc.md:795-803`). None is present here.

Several stale assertions or records should be retired or replaced:

- Retire the Coterie `pure` sidecar row for `COTERIE_COMPOSER_MEDIA_OPTIONS` if regeneration confirms it is a module constant; keep the `contract-meta` gate.
- Retire `/auth/agents/token` from the app-CLI expected route inventory only after the auth owner confirms `/auth/session` is intentional; keep the route-inventory assertion.
- Replace the removed Contract source paths with their new owners; do not remove the parity guard.
- Replace the auth-invalidation `queue-apply >= 3` count with a semantic custody assertion only if event-order capture proves the correct final state with fewer internal events.
- Narrow the Snapback CLI regex prohibition only if LLP 0258 explicitly permits the acceptance harness to own an external-session client. Otherwise fix the harness.
- A scoped, expiring `cargo-audit` advisory disposition may be legitimate; retiring `--deny unmaintained` is not.
- Keep the all-aboard local-fetch assertion, visibility/write gates, carrier gates, and package-export-types gate. Their failures are useful and correctly exposed real drift.

## Commands needed to convert remaining inferences to verified findings

Run these in an isolated checkout with the logged toolchain and binary:

```sh
# Unresolved non-B gate; run before claiming the full census is final.
SNAPBACK_BINARY=target/debug/snapback \
  node tests/conformance/run-versioned-seed-v1.mjs \
  --receipt target/conformance/versioned-seed-v1.receipt.json

# Auth/outbox isolates.
node demos/_kit/tests/auth-handshake.mjs
node demos/_kit/tests/auth-coordinator-client.mjs
node demos/_kit/tests/auth-invalidation-client.mjs
node demos/_kit/tests/client-errors.mjs
node demos/public-dashboard/tests/acceptance/offline-local-first.mjs
node demos/card-game/tests/acceptance/offline-sessions-custody.mjs

# Realtime restart.
bun demos/_kit/tests/regression-ephemeral-wiring.mjs

# Supply-chain ownership.
cargo tree -i smartstring

# Publication custody.
node scripts/check-agent-safe-publication.mjs
node --test tests/agent_safe_publication_checker_v1.mjs

# Unknown carrier first-red.
node tests/acceptance/local-store-carrier-exit-v1.mjs --check
```

For `auth-invalidation-client`, the current command does not print the `order` array. A disposable diagnostic copy must emit `order` immediately before `demos/_kit/tests/auth-invalidation-client.mjs:302`; only then can the count assertion be classified as stale versus a missed custody reinstall.

For precise first-red attribution of agent-safe custody, the local-store receipt, and ephemeral restart, run `git bisect run` around the respective commands in a disposable worktree. Static blame alone cannot identify those behavioral transitions.

No files were changed.
