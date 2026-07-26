# Step 5 semantics implementation program (LLP 0065/0080/0081) — index

**Status:** Resolved (2026-07-26)
**Severity:** P2
**Systems:** Codegen, Storage, Query planning, Live Queries, Authorization, Migrations, CLI, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0065/0080/0081 (authorities), LLP 0004/0007/0051/0053/0055/0056/0058/0063/0072
**Marker:** program-index, step5-impl

Umbrella index for implementing the three Accepted Step 5 semantic
authorities. Acceptance (2026-07-24, dual-family LLP 0005 loops) authorized
implementation; `Implemented` status and LLP 0063's Step 5 executable
witnesses are gated on the conformance suites below. Step 0 remains the
conjunctive prerequisite for *claiming* any Step 5 gate — building these does
not require it.

Three lanes run in parallel; the coupled suite joins the 0080/0081 lanes at
the end. `20260724-step5-impl-0007-implicit-id-suffix.md` is a shared early
dependency of both the 0065 and 0080 lanes.

**Phasing (author-ratified 2026-07-24):**

- **Phase A (now):** the 0007 implicit-suffix ticket, the full 0065 lane,
  and the 0080 callable-query slice (plan codegen, root-window evaluator,
  live/0053). Rationale: highest value density — generated CRUD removes
  boilerplate from every app and feeds `STEP5.DECLARATION_REDUCTION`;
  bounded joins are the most user-visible gap. No maintained-projection or
  migration machinery required.
  **Status (2026-07-25): executed.** 0007 suffix, the full 0065 lane
  (candidate-conformance, conditional lowering, effect ceiling incl. the
  new runtime subset enforcement, DTO identities, opaque keyset cursors,
  principal profile-class admission, and the §6 suite index in
  `20260724-step5-impl-0065-conformance-suite.md`), and the 0080 callable
  slice (plan codegen, root-window evaluator with opaque cursors +
  `RelationalResultEncodingV1`, live/0053 inheritance + retention
  default-deny + capability facts) are landed and witnessed. Named
  residuals live in the 0065 suite ticket and the 0080 live-0053 ticket
  (retention successor class, disabled-skip capability record,
  Sessions-mode negative matrix, acceptance corpus).
- **Phase B (next):** maintained projections + rebuild, the minimal 0081
  slice they force (barrier/executor, journal events, plan artifact +
  approval for `RebuildMaintainedProjection`), and the coupled suite.
  **Status (2026-07-25): executed.** Maintained projections landed whole
  (core engine in both mutation tiers, activation validation, the local
  IMMEDIATE-transaction barrier rebuild with receipts and the streaming
  split-oracle digest, `defineMaintainedProjection` authoring + demo +
  guide) and `RELATIONAL_MIGRATION_COUPLED_SUITE_V1`'s v1 fixtures are
  green (`tests/relational_migration_coupled_suite_v0.rs` +
  `tests/relational_corpus_v0.rs` + the src witnesses; item→witness map
  in the coupled-suite ticket). The minimal 0081 slice is deliberately
  narrowed to the local profile — the durable batch-cursor executor,
  full approval records, journal events, and verification/rollback stay
  the complete Phase C lane. `Implemented` status flips and the
  `relational_query_v1` maturity promotion are author decisions gated on
  the ticket-recorded residuals (hosted arms, retention lease class,
  obligation-fault e2e, Step 0).
- **Phase C (when real deployments need schema changes):** the rest of the
  0081 lane. 0081 is safety machinery and should land essentially whole —
  do not trim it; defer it. The hosted DO executor stays deferred behind an
  LLP 0072 target selection.
  **Status (2026-07-25): executed on the local profile.** Three waves:
  (1) `MigrationPlanArtifactV1` + observation/approval/admission types
  with frozen golden vectors, the deterministic planner order/step-ID
  grammar, and the UUIDv7 synthesis namespace (`d10c80aa`);
  `MigrationKeysetScanV1` + `ContentDigestV1` with resumable accumulators
  (`73023273`). (2) The durable executor (`907214a2`): the closed
  13-state journal machine with its transition relation committed as
  schema, the persisted migration fence over the enumerated 8-lane
  registry surviving process reopen, semantic approval/admission
  enforcement, batch atomicity, the enforced downtime ceiling, and the
  `snapback migrate` CLI. (3) Schema-transition events as first-class
  LLP 0007 journal grammar with floor-gated replay, the stable
  upgrade-required refusal, retained-work proof, and live retirement
  (`85fa2375`, `5116c269`); the §5 independent data proof, §6 fast
  rollback from published-held, staged generations, and the kill-point
  matrix (`17f0741c` — which found and fixed two Wave-2 executor bugs).
  0081 acceptance corpus green; coupled-suite map updated. Deferred by
  design: the hosted DO executor (LLP 0072 selection); sessions-profile
  residuals (durable auth-scoped dispositions at publication, client
  quarantine UX, mutation-wire artifact identity — LLP 0093 adjacency)
  are named in the tickets. `Implemented` flips for 0065/0080/0081 and
  capability-maturity promotions remain author decisions; three small
  0081 spec frictions are recorded for the next amendment
  (cancel_requested naming, an explicit `release` verb, the
  admission-timing profile note).
  **Flip disposition (2026-07-25, author-delegated):** LLP 0065 flipped
  to `Implemented` (§6 suite green on every claimed adapter; the
  declaration-reduction receipt stays LLP 0063's). LLP 0080 and 0081
  deliberately stay `Accepted`: 0080's §Acceptance still has unmet items
  (the `opaque-authorized-snapshot-v1` lease enforcement, the
  obligation-fault e2e, examined-entries instrumentation) and 0081 has
  the sessions-profile publication tails and schema-diff→intents
  derivation open. `relational_query_v1` stays `experimental` per the
  registries' own recorded gate ("until the coupled suite passes and
  both RFCs flip to Implemented") — promoting it is the same act as
  flipping 0080/0081, not a separate lever.
  **Flip audit (2026-07-25, post-flip-closure):** the flip-closure
  package landed both halves (retention lease class end to end,
  obligation-fault recovery, examined-entries instrumentation;
  publication dispositions under Sessions, schema-diff→intents
  derivation, staged-pair successor check, physical cleanup). The
  item-by-item §Acceptance audit still withholds both flips, and the
  remaining blockers converge:
  - **0080**: every item is witnessed on the claimed adapters EXCEPT the
    final one — "Partitime or the admitted Step 5 fixture demonstrates
    both generated helpers, records source/glue reduction, and reruns
    the cumulative gates." The Step 5 application witness is 0080's last
    open acceptance item (hosted arms stay vacuous — no hosted target
    claims the capability).
  - **0081**: the same Step 5 application witness item, plus the
    quarantined-offline-mutation settlement e2e (client half; the
    server refusal and floor are landed), the restore-derived rehearsal
    fixture (§7), and the genuinely-dual-compatible ordering fixture.
    DO-target items are explicitly deferred to hosted profiles by the
    RFC's own closing paragraph.
  The Step 5 application witness (the `STEP5.DECLARATION_REDUCTION`
  run on Partitime or the admitted fixture) is therefore the single
  biggest unlock: it closes 0080's last item, one of 0081's last items,
  and delivers the LLP 0063 Step 5 receipt — and Step 0's refreshed
  ledger closed on 2026-07-25, so the claim path is open.
  **Fixture admission (2026-07-26): executed.** Charlie admitted
  `demos/competitive-checkpoint` as the admitted Step 5 fixture (LLP
  0063 Revised 2026-07-26; protocol amendment v0.8). Both 0080 §7
  helpers now run there in production shape (`conversationsWithModel`
  landed callable + paged, 5/5; projection retained, 8/8 rerun), and
  0081's witness reviewed and executed the real `models.provider`
  change through `migrate` preview→approve→apply (6/6), finding and
  fixing two engine defects (CLI async-guard panic; dual manifest-slot
  publication divergence). Receipts: `step5-both-helpers.v1.json`,
  `schema-evolution.v1.json`, `relational-conversations.v1.json`. Both
  RFCs' Step 5 application witness items are witnessed; the audited
  flip landing (0080/0081 → Implemented + `relational_query_v1`
  promotion in one change) is the remaining act.
  **Receipt landed (2026-07-25):** `STEP5.DECLARATION_REDUCTION` is
  `passing` (136 ≤ 152 under the frozen method; dated LLP 0063 amendment;
  claim manifest + lock + bundles regenerated together). Honest residue:
  the reduction claim is delivered, but LLP 0080's acceptance clause
  "Partitime or the admitted Step 5 fixture demonstrates both generated
  helpers" remains open — Partitime's shared-visibility workload fits
  neither the owner-only 0065 floor nor an in-cell join within the frozen
  threshold headroom (review C7 materialized), and admitting
  competitive-checkpoint (where both families run in production shape) as
  the Step 5 fixture is an author decision. The 0080/0081 Implemented
  flips therefore still wait on that admission (or a ratified 0080
  amendment) plus the 0081 fixtures in flight.
  **Final record (2026-07-26):** Charlie admitted
  `demos/competitive-checkpoint` as the admitted Step 5 fixture (LLP 0063
  Revised 2026-07-26; LLP 0075 protocol amendment v0.8, prospective — no
  timed run has occurred). The fixture adopted the callable
  `defineRelationalQuery` helper in production shape and executed a real
  reviewed v0→v1 schema change through `snapback migrate
  preview→approve→apply` (receipts:
  `step5-both-helpers.v1.json`, `schema-evolution.v1.json`,
  `relational-conversations.v1.json` under the fixture's
  acceptance/results/). The witness found and fixed two engine defects:
  the migrate-CLI async-worker-guard panic and the dual-slot
  schema-manifest publication bug that bricked migrated stores on reopen.
  With those last two §Acceptance items witnessed, the item-by-item audit
  came back clean and the flips executed: **LLP 0080 and LLP 0081 are
  Implemented**, and `relational_query_v1` + `migration_keyset_scan_v1`
  promoted to stable in both registries (src/manifest.rs non-stable table
  emptied; codegen's EXPERIMENTAL_TARGET_CAPABILITY_IDS emptied; all
  capability manifests, demo artifacts, and the guide regenerated; the
  fixture witnesses re-run green against the promoted artifacts). The
  program is complete. Still open, each in its own ticket: projection
  capability-artifact facts (0080-maintained-projections), client
  quarantine UX (0081-journal-events), the hosted DO executor
  (0081-hosted-do-executor), and the 0081 spec-amendment frictions
  (20260726-0081-spec-amendment-frictions).
- Step 0's exit remains the critical path for *claiming* any Step 5 gate
  and outranks Phase B/C work when capacity is contended.

LLP 0065 lane (standard patterns):
- `20260724-step5-impl-0065-candidate-conformance.md` — move the shipped
  candidate to the accepted spec
- `20260724-step5-impl-0065-conditional-lowering.md` — server-evaluated
  conditional update/delete
- `20260724-step5-impl-0065-effect-ceiling.md` — `EffectCeilingV1`
- `20260724-step5-impl-0065-dto-manifest.md` — versioned DTOs in the
  Rust-owned manifest
- `20260724-step5-impl-0065-conformance-suite.md` — the §6 suite (gates
  `Implemented` + `STEP5.DECLARATION_REDUCTION`)

LLP 0080 lane (relational):
- `20260724-step5-impl-0080-plan-codegen.md` — closed plan normalization +
  validation
- `20260724-step5-impl-0080-root-window-evaluator.md` — `root-window-v1`
  across evaluators + result encoding + cursors
- `20260724-step5-impl-0080-live-0053.md` — live_replace/0053 inheritance +
  retention capability
- `20260724-step5-impl-0080-maintained-projections.md` — same-transaction
  maintenance + fan-out proof
- `20260724-step5-impl-0080-rebuild.md` — barrier rebuild under the split
  oracle
- `20260724-step5-impl-0080-acceptance-corpus.md` — the §Acceptance suite
  (0080 half of the coupled suite)

LLP 0081 lane (migrations):
- `20260724-step5-impl-0081-plan-artifact.md` — canonical artifact, planner
  determinism, deterministic IDs
- `20260724-step5-impl-0081-approval-admission.md` — approval/admission
  records + CLI surface
- `20260724-step5-impl-0081-executor-state-machine.md` — durable executor,
  fence, lifecycle (local SQLite profile)
- `20260724-step5-impl-0081-typed-steps-keyset-scan.md` — closed steps +
  `MigrationKeysetScanV1`
- `20260724-step5-impl-0081-journal-events.md` — LLP 0007 schema-transition
  events + 0053 activation + client handshake
- `20260724-step5-impl-0081-content-digest.md` — `ContentDigestV1`
- `20260724-step5-impl-0081-verification-rollback.md` — proof, receipts,
  `generationRepublish`
- `20260724-step5-impl-0081-retained-work.md` — retained-work postures
- `20260724-step5-impl-0081-acceptance-corpus.md` — the §Acceptance suite
  (0081 half of the coupled suite)

Join + deferred:
- `20260724-step5-impl-coupled-suite.md` —
  `RELATIONAL_MIGRATION_COUPLED_SUITE_V1`; flips both docs to Implemented on
  pass
- `20260724-step5-impl-0081-hosted-do-executor.md` — Deferred: hosted Durable
  Object executor as a separately versioned LLP 0072 conformance profile
