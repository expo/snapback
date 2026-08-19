# LLP 0032: Decision and Implementation Hardening Program

**Type:** Plan
**Status:** Accepted
**Systems:** Project, Runtime, Storage, Sync, Realtime, Security, Auth, API, Client integration, Contract/Exact, Cron, Ephemeral state, Tooling, Packaging, Testing, Developer experience
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-01
**Revised:** 2026-08-18 (LLP 0276 crate-path relocation); 2026-07-22 (LLP 0074 public-package checkpoint: the `@snapback/*` source/import namespace remains stable, while the first public artifacts use the already-implemented `@ccheever/snapback-*` alias mapping because a live npm probe found `@snapback/cli` occupied by an unrelated product and no project publication authority over that scope). 2026-07-17 (E2/L6 completeness and storage-ordering closure: buffered query overlays capture the exact overfetch and touched rows they consume; direct/live/in-memory query invocations pin their complete logical read view; query dependencies carry inseparable snapshot cursors; and SQLite allocates app commit versions only after its writer reservation). 2026-07-17 (S5.D4 post-COMMIT closure: durable mutation truth,
internal invalidation, per-subscription fan-out isolation, and receipt
publication are distinct cuts; publication failure cannot recast a committed
write as rejected). 2026-07-17 (L2 owned-cleanup failure closure: maintenance retains
the exact mint-only terminal capture across a child panic/cancellation, emits
an identifier-free stable failure, and retries idempotent whole-ID cleanup
without reopening readable-id minting). 2026-07-12 (ENG-24357: unknown/internal diagnostics now default 500 with explicit client-code allow-list; earlier: 2026-07-03 Phase 5 re-landed adapted to the post-sync main — ENG-22680: P1–P8 done-whens closed on this line, Milestone C reached, docket + acceptance status records restored; per-phase adaptation notes in §Phase 5). 2026-07-03 (§Phase 5 stranding note: Phase 5 was executed end to
end on 2026-07-02 on a pre-origin-sync line now preserved as
`backup/main-before-origin-sync-20260702`; its doc-only decision records —
X1/DK-2, X2/DK-5, X4/DK-9, DK-10, the LLP 0011 and LLP 0036 ratifications,
the X5 idle audit — re-landed onto main today, and the code phases are
tracked for adapted re-landing in ENG-22680. Earlier: 2026-07-02 (L9 landed
per LLP 0026 Phase 1+2, closing Phase 3 —
L1–L9 all landed. Same day: DK-6 decided as POSIX OR — ratified by Charlie same day, ledgered in LLP 0000 — with the calendar-cron and cron-retry test-debt rows closed; and L6+L7 landed as the dedicated reviewed concurrency arc: design note, register entries with measured numbers, and the review's HIGH `GET /` fix recorded. Earlier: 2026-07-01 accepted by Charlie after the two-family review loop; same day, revision applying the GPT-5 and Claude-family reviews — S0/R7 fast lanes, R1 ratification split, docket status column and full acceptance coverage, register corrections from independent re-verification))
**Related:** LLP 0000, LLP 0002, LLP 0003, LLP 0004, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0014, LLP 0015, LLP 0016, LLP 0017, LLP 0018, LLP 0019, LLP 0020, LLP 0021, LLP 0022, LLP 0023, LLP 0024, LLP 0026, LLP 0027, LLP 0028, LLP 0029, LLP 0030, LLP 0031

## Summary

This plan is the execution program for bringing the repository to a state where
**every load-bearing decision the 2026-07-01 review surfaced is settled,
current, and honestly statused**, and
**the implementation matches the decided semantics, with agent-checkable
evidence**. It is driven by the 2026-07-01 whole-repo architecture review and
is organized as seven phases:

- **Phase 0 — Corpus truth:** make the LLP corpus match reality (statuses,
  stale cross-references, missing decisions).
- **Phase 1 — Safety floor:** close the known security gaps and fix every
  confirmed defect, each with a regression test.
- **Phase 2 — Execution-semantics honesty:** make the ratified write/read
  semantics and the code agree (the read-set-validation decision).
- **Phase 3 — Lifecycle and resource hardening:** no unbounded queue, table,
  or state; no idle churn; leaks have tests.
- **Phase 4 — Measurement:** turn the corpus's named unknowns (single-writer
  breaking point, fan-out ceiling, VM cost, matcher cost) into numbers, so the
  big deferred decisions can be made on evidence.
- **Phase 5 — Product boundary:** codegen, client protocol, adapter, and CLI
  become product surfaces with CI feedback loops; demos consume product only.
- **Phase 6 — Strategic derisking:** the graduation/second-target spikes that
  keep the local core from hardening around unportable assumptions.

Phases 0 and 1 are strictly first and deliberately small. Later phases have
named dependencies and can partially overlap. Every step has a **Done when**
an agent can check.

## Inputs and provenance

The findings below come from a whole-repo architecture review conducted
2026-07-01 by Claude (Fable 5) with Charlie Cheever: four parallel survey
passes (core-architecture LLPs; newer LLPs plus all eight diaries; the Rust
core under `crates/snapback/src/` and `tests/`; the JS estate under `demos/_kit/`,
`packages/`, `admin-ui/`, and the demos), synthesized into a ranked review.
This plan is the durable artifact of that review; the registers in it are
self-contained so the plan can be executed without the conversation that
produced it.

Confidence tags used throughout:

- **[confirmed]** — observed directly in committed artifacts or verified by
  reading the code path end to end.
- **[analysis]** — code-path reasoning about an untested path; write the
  reproducing test first.
- **[design]** — a judgment call, not a defect; goes through the decision
  docket, not the defect register.

File/line citations anchor to the 2026-07-01 working tree (HEAD `4fb5962`
plus uncommitted demo changes). Line numbers will drift; treat them as search
anchors, not gospel. A same-day Claude-family review independently
re-verified the register claims (four parallel verification passes over the
Rust core, the JS estate, and the corpus; per-claim verdicts in
[the review artifact](./reviews/0032-decision-and-implementation-hardening.claude.md)),
and the registers below incorporate its corrections. Verification is a
snapshot, not a warranty: steps still re-verify their own claim at step
start (see the execution rules).

## How to execute this plan

- Steps carry stable ids (`R1`, `S5.D2`, `E2`, `L4`, `M1`, `P3`, `X1`).
  Reference them in commit messages (e.g. `LLP 0032 S5.D2: fix optional-field
  regex in codegen`) so progress is greppable.
- **Ownership rule** (borrowed from [LLP 0016](./0016-diary-driven-change-program.plan.md)):
  where a detail LLP already owns an area, this plan schedules the work and
  defers semantics to that document; on conflict, the detail document governs.
  Steps that introduce semantics no document owns are flagged **needs owner
  doc update** and must land with that doc change (per `AGENTS.md`).
- A step is done only when its **Done when** holds. Most are tests or CI
  gates; some are document diffs. "Implemented but untested" does not close a
  step.
- **Revalidate before implementing.** Register claims were verified
  2026-07-01; before starting a step, re-check its claim against the current
  tree and fix the register row in place if it drifted. `[analysis]` rows
  land their reproducing (failing) test before the fix, per the tag's
  definition.
- Update the checklists in place as steps land (this is a living document);
  record ratifications in [LLP 0000](./0000-snapback.explainer.md)'s ledger.

## What this plan does not reopen

The review affirmed these decisions; executors should not relitigate them
here (changes would need their owner docs and fresh evidence):

- Server-authoritative query-result sync; no CRDT core; LWW-per-field with
  delete-wins as the conflict default ([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md),
  corroborated by [LLP 0022](./0022-electric-powersync-turso.research.md)).
- One changeset, one commit version, stamped on every affected row as the
  ordering spine ([LLP 0007](./0007-storage-portability.spec.md)) — Phase 6
  X1 designs its *graduation*, not its replacement.
- The durable/ephemeral lane split with budgets as capability facts
  ([LLP 0013](./0013-ephemeral-realtime-state.rfc.md)).
- Fail-closed codegen, structured diagnostic codes, capability manifests,
  deterministic reset/seed, executed-DSL-not-parsed
  ([LLP 0004](./0004-application-data-api.rfc.md),
  [LLP 0010](./0010-agent-dx-and-acceptance.spec.md)) — every diary calls
  these out as the core agent-DX wins.
- Snapshot-plus-subscription as one seam ([LLP 0012](./0012-headless-integration-contract.spec.md)).
- The diary/glue-inventory feedback mechanism itself
  ([LLP 0016](./0016-diary-driven-change-program.plan.md)) — it caught the
  Diary 0008 adapter regression and produced
  [LLP 0029](./0029-all-aboard-gap-closure.plan.md), exactly as designed.
- Decisions owned by documents whose surfaces have not shipped at all — the
  auth/permissions model ([LLP 0011](./0011-auth-and-permissions.rfc.md))
  and the hosted-profile choice
  ([LLP 0014](./0014-cloudflare-strategy.rfc.md)) — stay scheduled by their
  owner docs. This program gates only its docket: X3 schedules 0014's
  proofs, and nothing here schedules 0011.

## End state: what "perfect shape" means

Seven checkable properties. The program is complete when all seven hold.

1. **Corpus truth.** Every LLP's status reflects reality; the ratification
   ledger is current; no document cites superseded semantics; `ref-check`
   passes and a recurring reconcile cadence exists.
2. **Safety.** No ungated destructive operation on any bind; every HTTP route
   and WebSocket message kind is classified app-data or system per
   [LLP 0031](./0031-server-route-taxonomy.spec.md), enforced by a route
   registry test.
3. **Semantic honesty.** The execution/write semantics the corpus ratifies
   are the semantics the code implements; capability manifests are derived
   from the server, never asserted by hand.
4. **Resource sanity.** No unbounded queue, journal, or per-connection state;
   an idle instance performs no periodic disk writes; every leak class found
   in the review has a regression test.
5. **Evidence.** The named unknowns (M1's output list: single-writer
   breaking point, fan-out ceiling, per-invocation VM cost, matcher cost,
   validation cost, spurious-conflict rate, ephemeral publish cost) have
   measured numbers committed in-repo, and the decisions gated on them are
   made or explicitly deferred with a named revisit trigger.
6. **Product boundary.** Codegen, the wire client, the Contract adapter, and
   the operating CLI are product packages with their own CI feedback loops;
   demos contain no product code and no hand-rolled glue for paved-path
   needs.
7. **Test floor.** Every row of the test-debt register is closed with a test
   or an explicit, recorded won't-test rationale.

---

## Phase 0 — Corpus truth reconciliation

Cheap, high-leverage, and first: an agent-first corpus whose statuses and
cross-references are wrong produces confidently wrong agents. Run this as an
`llp-maintain`-style audit pass; land each item as a small doc diff.

- **R1 — Status audit across the corpus.** Outside LLP 0000 (Active),
  LLP 0002 (Accepted), and LLP 0027 (Implemented), every document — including
  the core RFCs/Specs whose slices shipped long ago
  ([LLP 0020](./0020-core-authoring-surface.plan.md) Phases 1–4, cron, the
  admin console, route work) — still says Draft. For every LLP: annotate
  section-level implementation status (several docs are part-ratified,
  part-draft — say so in the doc, the way LLP 0003 already does for its
  ratified boundary) and propose lifecycle transitions. Agents may land the
  mechanical annotations; **lifecycle `Status` transitions are ratified by
  Charlie** (LLP 0000 §Source and ratification), batched at phase boundaries
  unless urgent. Record promotions in LLP 0000's ratification ledger with
  dates. **Done when:** every `**Status:**` line has been reviewed against
  implementation reality, proposed transitions are ratified or declined, and
  the ledger lists the outcomes; a note in each changed doc says what
  evidence justified the change.
  **Proposal batch prepared 2026-07-01** (all 33 statuses reviewed; pending
  Charlie's ratification): 0002 → Active; research docs 0001/0006/0019/0022 →
  Active; 0013/0017/0023/0028/0031 → Accepted; 0025 → Implemented; 0020 →
  Implemented if Phases 1–4 are its full scope (verify at ratification);
  ratify the 0010 V1 charter (R2) and LLP 0033 (R5/DK-8); everything else
  stays Draft, which is accurate. Section-level annotations landed via
  R3/R4/R7. **Ratified and applied 2026-07-01** — two apply-time deviations,
  both honesty-preserving: 0020 stays Draft (its §Remaining Phase 4 design is
  still open), and 0001/0022 stay Draft (`ref-check` blocks Active documents
  from carrying `[inferred]` claims, which both keep). R1 done; ledger
  current.
- **R2 — Replace the outgrown V0 charter.** The ratified charter in
  [LLP 0010](./0010-agent-dx-and-acceptance.spec.md) §V0 Implementation
  Charter forbids cron; cron shipped and
  [LLP 0027](./0027-all-aboard-caltrain-demo.plan.md) consumes it. Write the
  V1 charter (what the current slice does and does not claim), mark the V0
  charter superseded in place, and ledger it. **Done when:** LLP 0010 carries
  the current charter and no shipped subsystem is charter-forbidden.
  **Done 2026-07-01** — V1 charter added to 0010 and ratified, superseding
  V0; ledgered in LLP 0000.
- **R3 — Fix stale cross-references.** [confirmed] items from the review:
  - [LLP 0013](./0013-ephemeral-realtime-state.rfc.md) §App API boundary
    justifies publish-after-commit by citing the *superseded* whole-handler
    lock model; re-ground it on the ratified commit-time boundary
    (LLP 0003 §Execution and Write Semantics, LLP 0009 §Runtime Boundary).
  - [LLP 0007](./0007-storage-portability.spec.md) lists the id algorithm as
    open; [LLP 0004](./0004-application-data-api.rfc.md) ratified opaque
    UUIDv7. Close it in 0007.
  - [LLP 0017](./0017-admin-console-inspection-surface.rfc.md) still carries
    the superseded Exact layout-kernel diagnosis corrected in
    [LLP 0023](./0023-admin-console-dev-serve-loop.rfc.md) (dom-mirror
    `flex-shrink` default, Exact ENG-22199/22214), and its "local safe by
    default" claim predates the ungated-root-alias finding (see S1).
  - [LLP 0027](./0027-all-aboard-caltrain-demo.plan.md)'s demo-manifest
    sketch still shows `"gestures": true` versus the implemented
    `exact.gestures: false`.
  - [LLP 0015](./0015-demo-application-suite.plan.md) /
    [LLP 0016](./0016-diary-driven-change-program.plan.md) demo-ladder
    mismatch (task tracker omission; actual demo sequence diverged) —
    re-ratify or amend the ladder.
  - Diary 0006 cites "LLP 0024" as the whiteboard demo plan; today's
    LLP 0024 is the operating-surface spec, no whiteboard plan was ever
    committed at any number, and no LLP has ever been renumbered — the diary
    evidently cited an uncommitted draft, so an erratum has no "correct"
    number to point to. Decide the diary erratum policy (recommended:
    diaries are immutable point-in-time records; append a dated erratum
    footnote — here, noting the referenced plan never landed — rather than
    rewriting) and apply it. **needs owner doc update** (the policy belongs
    in LLP 0016).
  - [LLP 0000](./0000-snapback.explainer.md)'s Related index is missing
    LLP 0031 (fixed alongside this plan's creation).
  **Done when:** each listed item has landed and `ref-check --verbose`
  passes. **Landed 2026-07-01** — all six items (0013 boundary re-ground,
  0007 id close-out, 0017 diagnosis + safe-by-default fixes, 0027 sketch,
  0015/0016 ladder reconcile, diary 0006 erratum with the immutability
  policy adopted in 0016).
- **R4 — Mark pinned-not-built surfaces.** [LLP 0024](./0024-agent-operating-surface.spec.md)
  pins a full CLI/host-ops verb table that does not run anywhere
  ([LLP 0030](./0030-managed-snapback-vite-dev.rfc.md) says so). Add a
  prominent implementation-status banner to 0024 (and any other spec that
  reads as shipped) distinguishing *pinned contract* from *built surface*, so
  agents reading the corpus cannot mistake aspiration for API. **Done when:**
  an agent reading 0024 top-to-banner knows what exists today.
  **Landed 2026-07-01** (banner in 0024; flips per verb as P6 slices land).
- **R5 — Name the licensing decision.** [LLP 0022](./0022-electric-powersync-turso.research.md)
  flags PowerSync's deliberate FSL choice; Snapback's pure-MIT free-riding
  exposure is currently a blind spot rather than a decision. Write the short
  Decision LLP (options: MIT eyes-open; MIT + trademark policy; dual/FSL
  variants — recommendation: MIT eyes-open, since "truly open" is a ratified
  core value in LLP 0000, but the trade should be recorded and ratified).
  **Done when:** a Decision LLP exists and LLP 0000/0022 cross-reference it.
  **Done 2026-07-01** — [LLP 0033](./0033-license-posture.decision.md)
  ratified (MIT eyes-open with revisit triggers), cross-referenced from
  0000/0022, ledgered; DK-8 decided.
- **R6 — Reconcile cadence.** Adopt a standing rule (in `AGENTS.md` or
  LLP 0016): run the `llp-maintain` audit before each demo lands and after
  each phase of this plan completes. **Done when:** the rule is written down
  and has run once. **Done 2026-07-01** — adopted in LLP 0016 and AGENTS.md;
  the first run was this Phase 0 audit.
- **R7 — Execution-semantics honesty patch (doc-only).** The corpus's most
  load-bearing overclaim cannot wait for Phase 2: LLP 0003/0004/0007
  describe snapshot reads, read-your-writes `ctx.db`, and commit-time
  read-set validation that the code does not implement (evidence in
  Phase 2). Revise those sections now to describe current semantics
  precisely — global-mutex serialization, bare live-connection reads, no
  read-your-writes, two-tier validation that is whole-table for query-shaped
  reads — using LLP 0012's mutation-isolation capability field, and mark the
  ratified target semantics as *target*, not current. The implement-up
  ladder stays in Phase 2; DK-1 still governs direction. **Done when:** no
  corpus document describes unimplemented execution semantics as current;
  each revised section cites the register evidence and names the Phase 2
  step that closes its gap.
  **Landed 2026-07-01** — status callouts in 0003 §Execution and Write
  Semantics, 0004 §Write Semantics, and 0007's read-set-validation contract;
  0013's stale lock citation was R3's fix.

**Phase 0 completed 2026-07-01.** R1–R7 done; the ratification batch is
ledgered in LLP 0000; `ref-check` green across the corpus.

## Phase 1 — Safety floor and confirmed defects

Small, urgent, and independent of every design question. Everything here
ships with a regression test and, where user-visible, a diagnostic code.

### Route and session gating

- **S0 — Close the live destructive hole first.** The root `/admin/reset`,
  `/admin/schema`, `/admin/functions`, `/admin/seed` aliases are ungated on
  **any** bind even when `SNAPBACK_ADMIN_TOKEN` is set — the token guards
  only `/_snapback/*` (`crates/snapback/src/server.rs:48-76` vs `crates/snapback/src/admin.rs:232-261`)
  [confirmed]. Do not wait for the full 0031 program: gate these four
  handlers behind the same `authorize()` policy as their `/_snapback/*`
  twins now. (There is no route middleware today — gating is per-handler
  `authorize()` calls in the admin handlers — so this is adding four calls,
  not widening a layer.) **Done when:** unauthenticated `POST /admin/reset`
  fails closed on loopback and on non-loopback with a token set, with a
  regression test that stays green through S1's alias retirement.
  **Landed 2026-07-01** — the four alias handlers call the shared
  `authorize()` write gate; `s0_*` tests in `crates/snapback/tests/admin_v0.rs` cover
  token-required-on-loopback, disabled/gated non-loopback, and the
  preserved open-loopback default.
- **S1 — Implement [LLP 0031](./0031-server-route-taxonomy.spec.md) D1–D5.**
  With S0's exposure closed, land the rest: the compile-time route registry,
  gated system writes
  (`/_snapback/api/{schema/load,functions/load,app/reset}`), the trimmed
  public `/inspect` identity descriptor, ephemeral `register` retirement, and
  the WebSocket message-kind classification. **Done when:** 0031's
  enforcement and migration tests pass — the registry test enumerating every
  operation including WS message kinds, the black-box
  no-privileged-root-paths test, and the field-level public-inspect test —
  with S0's fail-closed test still green. **Landed 2026-07-01** — the declared
  `route_registry` (+ `live_socket_operations`) is the single source of truth;
  the migrated writes live under `/_snapback/api/{schema/load, functions/load,
  app/reset}` (seed folded into `app.reset` per D5), `/connections/{id}/
  disconnect` moved gated (D2), `/ephemeral/collections` register retired (D4),
  and public `/inspect`/`/` are a typed projection dropping `connection_id` and
  `sqlite_path` (D3). Enforcement tests: `s1_route_registry_matches_the_invariant`,
  `s1_retired_root_operations_are_absent_from_the_registry`,
  `s1_live_socket_operations_are_all_app_data` (server.rs);
  `s1_retired_root_operations_are_absent`, the gated fail-closed tests, and
  `s1_public_inspect_is_trimmed_gated_inspect_is_full` (admin_v0.rs). Verified
  against a running server; LLP 0031 → Active; LLP 0017/0030 notes updated. The
  kit client repoints all callers, so demos/acceptance follow without edits.
- **S2 — Subscription ownership.** Subscription ids are sequential (`sub_1`,
  `sub_2`, …) and `resume_live` performs no ownership check, so any caller
  can re-point another subscription's stream to its own connection
  (`crates/snapback/src/local.rs:433-434`, `454-514`) [confirmed]. Make ids unguessable and
  bind resume (and any future per-subscription op) to the owning
  connection/principal. **Done when:** a hijack test fails closed with a
  structured diagnostic. **Landed 2026-07-01** — ids are UUIDv7 bearer
  tokens; `resume_live` binds to the subscribing principal
  (`SNAPBACK_LIVE_RESUME_OWNERSHIP`); tests `s2_subscription_ids_are_unguessable`,
  `s2_resume_live_fails_closed_for_a_different_principal`.
- **S3 — WebSocket sender binding.** WS `ephemeral_publish` frames carry a
  client-chosen `connection_id` that is never checked against the socket's
  own connection (`crates/snapback/src/server.rs:474-534`) [confirmed]. Bind frames to the
  socket identity. **Done when:** a spoofed-connection publish test fails
  closed. **Landed 2026-07-01** — all three WS message kinds bind to the
  socket's connection (`SNAPBACK_WEBSOCKET_SENDER_MISMATCH`); test
  `s3_websocket_frames_bind_to_the_socket_connection` (also the first WS
  text-protocol coverage).
- **S4 — Take deployment away from the browser.** All Aboard's Contract
  surface loads schema, resets, and reseeds the shared DB on **every page
  load** (`demos/all-aboard/surfaces/contract/main.ts:75-79`) [confirmed];
  the same pattern exists in the other demos' boot paths. Interim fix now
  (the demo harness/CLI performs setup server-side; pages only read); the
  full lifecycle story is owned by [LLP 0030](./0030-managed-snapback-vite-dev.rfc.md)
  and lands with P6. **Done when:** no demo page-load calls any `/admin/*` or
  system write; a grep gate over `demos/*/surfaces/` enforces it.
  **Closed 2026-07-02 with P6, reconciled to the later-ratified boot
  semantics.** After this register was written, LLP 0034 D4 ("bootstrap by
  blast radius", Accepted) defined and landed the page-boot contract:
  inspect-first *conditional* provisioning and seed-if-empty are legitimate
  page behavior; the destructive class (reset-then-seed, legacy `/admin/*`)
  is not. Per this plan's own ownership rule the detail doc governs, so the
  done-when is enforced at D4's line: todo and todo-v2 pages (the last
  unconditional reset-then-seed boots) migrated to the D4 pattern, the
  destructive class is gated by `scripts/check-demo-surfaces` (proven
  against an injected `client.reset()`), and the server-side setup path the
  interim fix asked for exists twice over — `scripts/demo-setup <demo>` and
  the P6 CLI (`snapback load/reset`). All Aboard and cursors-web already
  implemented D4.

### Confirmed defect register

Each fix lands with a failing-then-passing test named for the step id.

- **S5.D1 — Nested Ibex re-entry nulls the host-call context** [analysis].
  `run_ibex_handler_with_context` sets a thread-local pointer and
  unconditionally nulls it after eval (`crates/snapback/src/runtime.rs:518-524`). An Ibex
  *action* whose `ctx.runMutation` targets an Ibex *mutation* re-enters, and
  the inner call's cleanup strands the outer action — any later host call
  fails with `SNAPBACK_HANDLER_HOST_CALL_WITHOUT_CONTEXT`. The only existing
  nesting test ends with a host-plan mutation, so the path is untested
  (`crates/snapback/tests/local_v0.rs:888-904`, `2018-2037`). Fix: save/restore semantics
  (a stack), plus the reproducing test — which must make a host call *after*
  the nested call returns; a test that merely ends with `ctx.runMutation`
  passes even on broken code. The nested entry also replaces the
  process-global Ibex host and creates a second VM mid-flight
  (`vendor/ibex/src/host/abi.rs:128-142`); the thread-local fix alone leaves
  those — scope them here or hand them to L7's threading work explicitly.
  **Landed 2026-07-01** — the context pointer is now saved and restored (a
  stack via recursion), not nulled on the inner exit; the second-VM and
  host-reinstall inefficiency is explicitly handed to L7/M2. Test
  `s5_d1_action_calling_ibex_mutation_preserves_context` makes a second host
  call after the nested Ibex mutation returns; proven to fail closed
  (`SNAPBACK_HANDLER_HOST_CALL_WITHOUT_CONTEXT`) on the pre-fix code.
- **S5.D2 — Codegen optional-field regex emits invalid TypeScript**
  [confirmed]. `typeForValidator` strips optionals with a mis-escaped
  pattern (`demos/_kit/codegen.mjs:1220`); committed proof:
  `demos/cursors-web/snapback/generated/api.d.ts:31` ends `number |`. Fix the
  regex, regenerate all demos, and note that P3's `tsc` gate is what keeps
  this class out permanently. **Landed 2026-07-01** — the over-escaped pipe
  is now `/ \| undefined$/`; regenerating produced exactly one content change
  (`cursors-web/api.d.ts` → `updatedAt?: number`). Regen also exposed a
  determinism bug (below): codegen keys handler-source hashes by absolute
  path, so `bundleHash`/`inputsHash` churn per checkout; that hash-only churn
  was reverted and registered for P3 rather than committed.
- **S5.D3 — Client parses JSON before checking `res.ok`**
  (`demos/_kit/client.mjs:31-33`; same flaw in
  `admin-ui/admin-client.mjs`) [confirmed]. A proxy 502/HTML error page
  surfaces as a bare `SyntaxError` with no status or diagnostic. Check
  status first; wrap non-JSON bodies in a structured error. **Landed
  2026-07-01** — both clients check status and wrap non-JSON bodies
  (`SNAPBACK_HTTP_ERROR` with status + snippet; `SNAPBACK_RESPONSE_NOT_JSON`
  on an ok-but-unparseable body); tests in `demos/_kit/tests/client-errors.mjs`
  (`s5_d3` × 5), proven against HEAD.
- **S5.D4 — Post-commit fan-out failures are misreported** [confirmed].
  `notify_permission_resyncs(...)?` / `notify_live_subscriptions(...)?` run
  after the mutation committed (`crates/snapback/src/local.rs:411-412`); a live-query re-run
  failure returns an *error* to a caller whose write *persisted*, and the
  fan-out loop aborts mid-iteration, silently starving remaining
  subscribers. Fix: fan-out errors are per-subscription diagnostics (and
  outbox resync signals), never a mutation failure; the loop continues.
  **needs owner doc update** (LLP 0003 §Realtime Pipeline should state the
  post-commit error contract). **Landed 2026-07-01** —
  `notify_live_subscriptions`/`notify_permission_resyncs` are now infallible
  w.r.t. the mutation: per-subscription failures record a diagnostic, bump
  `live_delivery.total_failed`, and enqueue a `resync_required` signal, then
  continue. LLP 0003 §Realtime Pipeline gained the contract; test
  `s5_d4_fanout_failure_does_not_fail_mutation_or_starve_others`.
  **Revised 2026-07-17:** the commit version is now the immutable publication
  frame. Internal permission-epoch invalidation derived from the durable write
  advances before any external guard; a failed head-coherence/admission check
  records a diagnostic and suppresses unsafe output without changing commit
  truth. Authorization preprojection, permission refresh, ordinary live rerun,
  and recovery guards are isolated per subscription, so only successfully
  projected ids are suppressed from the ordinary pass and one failure cannot
  starve later ids. Receipt publication uses the same boundary: a failed guard
  retains nothing and exposes no handler result, but an existing commit still
  yields `Confirmed` at its exact version, never `Rejected`. Tests
  `postcommit_head_corruption_preserves_confirmed_receipt_and_durable_truth`
  and
  `postcommit_publication_guard_failure_confirms_without_retaining_sensitive_output`.
- **S5.D5 — WS drain-then-send loses messages on send failure** [analysis].
  Messages are drained from the outbox under the lock, then written to the
  socket; a send error discards the failing message and everything drained
  after it (`crates/snapback/src/server.rs:436-446`) — and the loop then breaks into
  `disconnect`, which deletes the whole outbox, so requeue-on-failure is
  meaningless unless the outbox survives socket close. Fix: drain-after-ack
  or requeue-on-failure — pick the one consistent with the L1
  bounded-outbox design *and* P4's reconnect/resume design; decide outbox
  survival across disconnect together with P4. **Resolved 2026-07-02 with
  P4:** the decision is **neither requeue nor acked drain — recovery by
  snapshot**. The outbox deliberately does not survive disconnect; the
  LLP 0034 D1 reconnect policy (always a fresh `subscribe_live` with an
  authoritative snapshot, explicit supersession, generation-guarded
  teardown) makes any loss on a dying socket unobservable after
  reconnect. Pinned by `regression-fake-live` ("nothing silently lost"),
  `regression-reconnect-nuke`, and `regression-multiplexed-lanes`'
  kill-socket leg; contract recorded in LLP 0008 §Realtime Delivery.
- **S5.D6 — Ephemeral rate-bucket leak on disconnect** [confirmed].
  `disconnect` removes outboxes and subscribers but never `rate_buckets`
  keyed by `(ConnectionId, collection)` (`crates/snapback/src/ephemeral.rs:832-876`).
  (Wholesale clears exist on schema reload/reset; the missing piece is
  per-connection removal.) **Landed 2026-07-01** — `disconnect` retains only
  other connections' buckets; test `s5_d6_disconnect_clears_rate_buckets`.
- **S5.D7 — Dead socket without pending waiters hangs the client forever**
  [analysis]. The `close` handler only fails waiters that exist at close
  time (`demos/_kit/client.mjs:156-158`); later `nextUpdate()` calls wait
  until timeout, and cursors-web's read loop treats timeout as `continue` —
  a frozen board that never errors. Fix: fail waiters unconditionally on
  close (the `streamError` latch already exists but is skipped on a clean
  close with no pending waiters); surface a structured stream-closed error.
  (Full reconnect is P4.) **Landed 2026-07-01** — close now fails waiters
  unconditionally and `fail` latches first-error-wins (`streamError ??=`), so
  a trailing close cannot mask an earlier failure; tests
  `demos/_kit/tests/client-errors.mjs` (`s5_d7` × 3), proven against HEAD.
- **S5.D8 — Cron run durations always record zero** [confirmed].
  `finished_at_ms = claim.started_at_ms` (`crates/snapback/src/local.rs:784-786`). Already
  registered as [LLP 0029](./0029-all-aboard-gap-closure.plan.md) G6 —
  schedule it here, semantics owned there. **Landed 2026-07-01** — duration is
  measured from real wall-clock around the run (finished = logical start +
  elapsed); test `s5_d8_cron_run_records_nonzero_duration`.
- **S5.D9 — Silent empty result on non-array Ibex query returns**
  [confirmed]. `as_array().cloned().unwrap_or_default()`
  (`crates/snapback/src/runtime.rs:125`) converts a handler returning a non-array into
  `rows: []` with no diagnostic — a silent-drop-class violation of the
  corpus's own cardinal rule. Fail with a structured
  `SNAPBACK_HANDLER_RESULT_INVALID`-family diagnostic. **Landed 2026-07-01** —
  `invoke_ibex_query_with_reads` fails closed on a non-array result; test
  `s5_d9_non_array_query_result_fails_closed`.
- **S5.D10 — No 5xx class** [confirmed]. Every unrecognized error, including
  internal SQLite failures, maps to HTTP 400 (`crates/snapback/src/server.rs:688-699`).
  Introduce an internal-error class so clients and agents can distinguish
  "you erred" from "the server erred". **Landed 2026-07-01** —
  `status_for_diagnostic_code` initially mapped `SNAPBACK_SQLITE_ERROR`/
  `SNAPBACK_INTERNAL_ERROR` to 500; ENG-24357 completed the fail-safe class:
  intentional client diagnostics are now allow-listed and every new/unknown
  code defaults to 500, preventing config I/O, runtime spawn, serialization,
  or future server faults from silently inheriting HTTP 400. Test
  `s5_d10_internal_errors_map_to_5xx` pins both sides.
- **S5.D11 — Cron ticker swallows its own errors** [confirmed].
  `let _ = snapback.tick_cron(...)` every second (`crates/snapback/src/server.rs:273`);
  claim/persistence failures vanish. (Failed cron *runs* already record
  diagnostics inside `execute_cron_claims` — the gap is the tick machinery's
  own errors.) Route into the diagnostics ring with a counter. **Landed
  2026-07-01** — `tick_cron_recording` records tick errors into the
  diagnostics ring and increments `cron_tick_errors()`; the ticker uses it.
  Happy path tested (`s5_d11_recording_tick_runs_cron_without_error`); the
  error path needs storage fault injection and is a recorded won't-test row
  (see test-debt register).

**Phase 1 Done when:** all S-steps closed; `cargo test` includes every new
regression test; the 0031 registry test is in CI.

**Phase 1 completed 2026-07-02** (record re-landed 2026-07-03, ENG-22680).
The two legs deliberately deferred at the 07-01 sweep closed with their
owning steps: S5.D5 resolved with P4 (recovery-by-snapshot; the outbox dies
with the connection) and S4 closed with P6 (reconciled to LLP 0034 D4's
boot semantics; destructive class gated). Every other S-step landed
2026-07-01 with regression tests.

## Phase 2 — Execution-semantics honesty

The ratified execution/write boundary (LLP 0003 §Execution and Write
Semantics; restated in LLP 0004 and LLP 0007) claims snapshot reads,
read-your-writes-consistent buffered `ctx.db`, and commit-time read-set
validation. The implementation diverges [confirmed]:

- No snapshot exists: handler reads are bare autocommit reads on the live
  connection (`crates/snapback/src/runtime.rs:270-331`), and consistency comes from the
  global mutex, not a pinned snapshot.
- No read-your-writes: buffered writes are invisible to later reads in the
  same handler — insert-then-query misses the insert; `patch` after a
  buffered insert reports `existed: false`.
- Validation is two-tier: Ibex handlers get automatic capture; host-plan
  mutations capture nothing and validate only the *client-supplied* read set
  (`crates/snapback/src/storage.rs:557`).
- Query-shaped dependencies validate at whole-table granularity via
  `MAX(version) FROM _snapback_changes WHERE table_name = ?`
  (`crates/snapback/src/storage.rs:1015-1103`) — effectively table-level locking with
  retries, wearing fine-grained-OCC clothing. The captured predicate and
  boundary metadata is stored but used only by the live matcher, never by
  validation.

This is the load-bearing correctness mechanism of the system; the spec and
the code must be made to agree. **Decision DK-1 governs the direction**; the
recommended staging:

- **E1 — Decide DK-1** (see docket). The doc-honesty patch is Phase 0's R7;
  this step decides direction. Recommended: *implement-up, staged*
  (E2→E3→E4) rather than ratifying current semantics as final. **Done
  when:** DK-1's direction is ledgered; its E4 leg may remain explicitly
  "pending M1". **Decided 2026-07-01** — *implement-up, staged*, ledgered in
  LLP 0000. E2/E5/E6 landed; E3's mechanism is pinned as part of DK-1 (see the
  E3 finding below); E4 stays pending M1.
- **E2 — Read-your-writes overlay.** `ctx.db` reads consult the buffered
  write set layered over storage (`crates/snapback/src/runtime.rs:270-331`). **Done when:**
  insert-then-query sees the row; patch-after-buffered-insert reports
  `existed: true`; delete-then-get misses. **Landed 2026-07-01** — reads fold
  this invocation's buffered writes over storage (`apply_buffered_to_point`,
  `merge_buffered_into_query`), reusing the live matcher's
  `row_matches_query_filters`/`sort_key`/`compare_sort_keys` (LLP 0020's one
  extractor); test `e2_handler_reads_its_own_buffered_writes`. **Hardened
  2026-07-17:** the buffered-query path captures the exact bounded overfetch
  consumed by the merge plus a point dependency for every touched id. The
  merge is pure over those captured rows, so no later uncaptured storage read
  can influence the handler result.
- **E3 — Host-plan read capture → host-plan isolation decision.** The original
  framing ("host-plan mutations capture reads server-side like Ibex handlers do,
  ending the trust-the-client asymmetry"; done-when: "a host-plan conflict test
  passes with no client-supplied `read_set`") was refuted by the Finding below.
  **Finding (2026-07-01), sequenced with DK-1's design:** host-plan
  `MutationPlan`s are *unconditional* write sequences that execute reads and
  writes in **one transaction** (`crates/snapback/src/storage.rs` `execute_mutation`) under the
  global instance mutex, so a server-captured read cannot be stale relative to
  the commit — there is no read-then-commit window to validate. Detecting the
  intended conflict (a client that optimistically read stale state) therefore
  needs a *client-supplied baseline* (which is exactly today's `input.read_set`),
  or a redesign where host-plan mutations carry conditional read predicates.
  "Capture reads server-side" as a mechanical fix is a no-op for conflict
  detection under the atomic model. This is a DK-1 design decision, not a
  mechanical step. **Decided 2026-07-02 — Option A (client-supplied baseline),
  pending Charlie's ratification nod.** Rationale: the client-supplied
  `input.read_set` is the *principled* optimistic-concurrency mechanism for
  atomic host-plan mutations, not a trust asymmetry to be fixed. The deciding
  read happened on the *client* (before the request), against a snapshot the
  server never saw; the client declares that baseline and `execute_mutation`
  enforces it atomically inside the commit transaction (version-match CAS, the
  same shape as HTTP `If-Match`/ETags). A client that omits or lies about its
  baseline only weakens *its own* mutation's isolation — it cannot corrupt other
  writers (writes stay atomic and version-stamped) or gain authority — so this is
  a division of labor, not a security gap. The asymmetry with Ibex handlers is
  *justified by the execution model*: Ibex reads → awaits (releasing the lock) →
  commits, so the server performed the deciding read at an earlier snapshot and
  must capture it (`validate_captured_read_set`); host-plan has no server-side
  read→decide→write, so there is nothing to capture. **Option B** (host-plan
  mutations carry declarative conditional read predicates the server evaluates
  atomically at commit) is recorded as a *future* extension — it enables guarded
  writes without the client knowing exact versions, but it is strictly bigger
  surface (a precondition language, portability, codegen, diagnostics) and does
  not *replace* Option A's correctness; A already provides sound isolation today.
  **Landed 2026-07-02 — zero code change** (`execute_mutation` already validates
  `input.read_set` inside its commit `tx`); the leg is docs + tests. Tests
  `e3_hostplan_conflict_uses_client_baseline` (stale baseline rejected, current
  baseline commits) and `e3_hostplan_without_baseline_commits_against_changed_state`
  (proves server-capture would add nothing under the atomic model). LLP 0003
  §Execution and Write Semantics, LLP 0004 §Write Semantics, and LLP 0007 now
  describe host-plan isolation as client-baseline-validated by design.
- **E4 — Predicate-granularity validation.** Reuse the matcher's boundary
  facts (LLP 0020 Phase 3's "one extractor, three consumers" already names
  this) so disjoint-row writes to a queried table stop conflicting every
  Ibex mutation. Gated on M1's validation-cost measurement — if the numbers
  say table-granularity is fine at target scale, record that in DK-1's
  outcome instead and keep the honest docs. Note Row/MissingRow captured
  reads already validate per-row; the whole-table check is specifically the
  Query-kind arm — and MissingRow mixes the table version into its check too
  (`crates/snapback/src/storage.rs:1054-1055`), so point-miss reads inherit table-granularity
  conflicts; include them in the narrowing. **Done when:** the
  disjoint-write no-conflict test passes (or DK-1 records the measured
  accept). **Landed 2026-07-01** (after M1) — the Query arm reuses the live
  matcher's `query_dependency_change_may_affect`: on a table change it conflicts
  only if a change since the read actually affects *this query* (a non-matching
  disjoint write no longer conflicts), with a retention-floor guard
  (pruned-below-floor → conservative conflict). The MissingRow arm is narrowed
  to a current-presence check (no whole-table version bump). The M1
  spurious-conflict measurement (corrected to a filtered query) drops **1.0 →
  0.0**; test `e4_query_validation_is_predicate_granular` (non-matching write
  no-conflict, matching write conflicts). This unblocks the L6 concurrent-writer
  arc.
- **E5 — `indexed_by` becomes real or goes away.** The query builder accepts
  and stores index hints but never uses them (`crates/snapback/src/storage.rs:895-985`)
  [confirmed]; at minimum, validate that a declared index exists and emit a
  diagnostic when it doesn't. **Done when:** unknown-index queries fail
  closed at codegen or load time. **Landed 2026-07-01** — `validate_query_index`
  fails closed with `SNAPBACK_QUERY_UNKNOWN_INDEX` at query execution (the
  authoritative backstop); a codegen-time check remains available as
  defense-in-depth. Test `e5_unknown_index_fails_closed`.
- **E6 — Document the frozen per-invocation clock.** `ctx.runtime.now()` is
  frozen at handler start (`crates/snapback/src/runtime.rs:237,333`) — correct for replay
  determinism, surprising for long handlers. Actions freeze it to the run's
  `due_at_ms` (`crates/snapback/src/runtime.rs:257`) — not even invocation wall-clock. One
  paragraph in LLP 0004 covering both. **Landed 2026-07-01** — LLP 0004
  §First-Slice API Decisions documents both.

**Phase 2 status (updated 2026-07-02):** E1 decided (implement-up, staged;
ledgered), E2/E5/E6 landed with tests and the LLP 0003/0004/0007 status callouts
updated to match. E4 landed (predicate-granular, after M1). E3 was a DK-1 design
decision (the atomic-host-plan finding above), not a mechanical step, and is now
**decided — Option A** (host-plan isolation is the client-supplied read_set
baseline by design; zero code change), pending Charlie's ratification nod. With
that, all of Phase 2's execution-semantics legs are closed and DK-1 is fully
resolved (E2/E3/E4). **Phase 2 Done when:** the semantics described in
LLP 0003/0004/0007 §§ are the semantics `crates/snapback/tests/local_v0.rs` demonstrates (now
holds for every leg), and DK-1's outcome is ledgered (done).

## Phase 3 — Lifecycle and resource hardening

Ordered by blast radius. L1–L5 are independent of design decisions; L6–L8
change the concurrency architecture and should land as one reviewed arc.

- **L1 — Bound the durable outboxes.** The per-connection durable `VecDeque`
  is unbounded — the 1,024 cap applies only to the coalesced ephemeral map
  (`crates/snapback/src/ephemeral.rs:568-570`, `886-892`) [confirmed]. A subscriber that
  never drains accumulates full query-result payloads per matching commit,
  forever. The `resync` deque in the same queue is unbounded too — bound
  both; overflow converts to a `ResyncRequired`-class signal (never a
  silent drop — LLP 0008 §Realtime Delivery). **Done when:** an overflow
  test observes the resync signal and bounded memory. **Landed 2026-07-01** —
  the durable and resync lanes share a `MAX_OUTBOX_BACKLOG` bound (decoupled
  from the ephemeral-map cap); hitting either collapses the queue to one
  durable `resync_required` signal (`reason: outbox_overflow`, sticky until
  drained) and bumps `outbox_overflows`. Test
  `l1_durable_lane_overflow_bounds_and_signals_resync`. **Review note (P4):**
  the server emits the overflow signal correctly and loses no rooms, but the
  connection-level durable `resync_required` sentinel carries no
  `subscription_id`; the client's handling of a *connection-wide* resync (vs a
  per-subscription one) is part of P4's reconnect/resume protocol. *(Closed
  with P4 2026-07-02: a sentinel without a `subscription_id` re-snapshots
  every handle on the connection — `demos/_kit/client.mjs` `applyDurable`.)*
- **L2 — Connection/subscription reaping.** No TTL or heartbeat exists;
  abandoned connections and their subscriptions live forever
  (`crates/snapback/src/local.rs:169`) [confirmed]. (WS-attached connections do reap on
  socket close; the leak is HTTP-polling connections that vanish without
  calling disconnect.) Add heartbeat/expiry with counters.
  **Done when:** an abandoned-connection test shows reap, and counters
  appear in `/inspect`. **Landed 2026-07-01** — `connections_last_seen`
  tracks per-connection activity (touched on subscribe/resume/outbox-drain and
  every ephemeral op); a background `spawn_connection_reaper` (30 s interval,
  120 s TTL) calls `reap_stale_connections`, which disconnects idle
  connections (tearing down subscriptions + ephemeral state) and counts them.
  `/inspect` gains `activeConnections`/`reapedConnections`. Test
  `l2_abandoned_connection_is_reaped_with_counters`. **Review note (edge,
  accepted):** a WebSocket wedged by >120 s of send backpressure can be reaped
  and, if it later resumes, re-register as a subscription-less connection until
  socket close — self-correcting and only under pathological backpressure;
  reaping an unresponsive client is the intended behavior. *(Revisited
  2026-07-07, ENG-23427: "self-correcting" was client-dependent — the resumed
  socket looked healthy while every subscription was gone, and only the kit's
  own freshness-budget reconnect recovered it. Reaping stays the intended
  behavior, but it is no longer silent: an unconditional disconnect (reaper or
  admin route) that runs while the connection still owns a delivery
  registration — the pump task parked in `sender.send` on a peer that stopped
  reading, socket open — seeds the fresh outbox with a connection-wide durable
  `resync_required` sentinel (`reason: disconnected`, the L1 overflow shape)
  plus one ephemeral `ResyncRequired { reason: Disconnected }` per wiped room,
  and stores a wake permit so the pump drains the sentinels the moment the
  peer resumes reading. The guarded WS-teardown path never signals — a
  surviving registration there can only be a reconnect's. Test
  `eng_23427_reap_under_open_registration_signals_resync`.)* **Review fix
  (2026-07-06, ENG-23424):** the L8 safety net defeated L2 for WS peers that
  vanish without FIN/RST — its 30 s drain touched activity even when the
  outbox was empty (and an empty drain does no socket I/O, so no send error
  ever surfaced), immortalizing a dead idle subscriber. Fixed on both sides:
  `drain_live_stream` touches activity only when it actually drained
  something, WS client liveness comes from `EphemeralApi::touch_connection`
  on incoming Ping/Pong frames, and the safety-net tick now sends a WS Ping —
  a vanished peer errors the socket within the TCP retransmission timeout,
  and a live idle peer's Pong keeps it under the TTL. Test
  `eng_23424_empty_ws_drain_is_not_liveness`. **Revised 2026-07-16:** server
  maintenance now selects idle connections from the exact connection-registry
  last-use index, atomically retires each grant and enables mint-only
  containment, then runs owned notifier/ephemeral cleanup before entering
  Local for topology removal and counter publication. No ephemeral shard lock
  overlaps the Local writer, and the old bearer is invalid throughout cleanup.
  **Revised 2026-07-17:** each spawned child has an owner-retained copy of its
  exact mint-only capture until join. A panic/cancellation emits stable
  identifier-free failure output and requeues that capture for an idempotent
  next-tick cleanup; requested readable-id reuse remains disabled while retry
  is pending. Test
  `maintenance_cleanup_join_failure_retains_exact_retry_capture`.
  `LocalSnapback::reap_stale_connections` remains only as a direct-library
  compatibility orchestrator outside the managed Local write scope.
- **L3 — Change-journal retention.** `_snapback_changes` grows without bound
  (pruned only by `reset`) and its per-query
  `MAX(version) WHERE table_name = ?` check is a full scan — the only index
  is `(version, id)` (`crates/snapback/src/storage.rs:705-716`, `1156-1172`) [confirmed].
  Implement LLP 0008 §Retention (version-and-time-bounded, forced resnapshot
  below the floor), add the `(table_name, version)` index, and a prune job.
  **Done when:** a growth test bounds journal size; resume-below-floor
  forces resnapshot; the scan uses the index (checked via `EXPLAIN QUERY
  PLAN` in a test). **Landed 2026-07-01** — the `(table_name, version)` index
  is added (validation query no longer scans, asserted via `EXPLAIN QUERY
  PLAN`); `prune_change_journal` (version-and-time-bounded) runs in the
  periodic maintenance worker; `journal_floor_version` +
  `resume_requires_resnapshot` encode the below-floor contract. Tests
  `l3_journal_retention_prune_floor_and_index` and
  `l3_prune_preserves_cold_table_validation_version`. **Review fix (same day):**
  a Claude-family review caught a HIGH bug — naive pruning dropped a cold
  table's `MAX(version)` to 0, spuriously conflicting a mutation that only
  *read* that table. Fixed: prune never deletes a table's high-water change
  (validation stays correct), and the replay floor is a monotonic persisted
  watermark (highest actually-pruned version + 1), not `MIN(version)` (which the
  per-table exception would pollute). **Note:** the version-based delta-resume
  *consumer* is future wire work (P4/DK-3) — today live delivery re-runs
  queries rather than replaying the journal, so the floor primitive exists but
  has no client caller yet; recorded in LLP 0008 §Retention.
- **L4 — Incremental ephemeral counters.** `refresh_counts` recomputes
  diagnostics over all rooms, entries, and outboxes after every publish,
  subscribe, delete, and disconnect (`crates/snapback/src/ephemeral.rs:1212-1249`)
  [confirmed] — quadratic at cursor rates. Maintain counters incrementally;
  keep the full recompute as a debug-assert parity check. **Done when:**
  per-op cost is O(1) and the parity test passes. **Landed 2026-07-01** —
  simpler than the incremental-plus-parity plan: the gauge fields are read
  only through `diagnostics()` (the `/inspect` path), so the full recompute
  (`recompute_counts`) moved there and the per-op calls were removed — the
  hot ephemeral path is now O(1) and the gauges are computed on demand (always
  accurate, no drift to assert). Event counters stay incremented at their
  sites. Test `l4_gauges_are_accurate_on_demand`.
- **L5 — Idle means idle.** The cron ticker takes the global lock and
  persists the full cron-state JSON to SQLite every second even with no due
  jobs (`crates/snapback/src/server.rs:267-276`, `crates/snapback/src/local.rs:700-707`) [confirmed] — at
  odds with scale-to-zero and with
  [LLP 0028](./0028-cron-scheduled-execution.rfc.md)'s own honesty about
  idle cost. Persist only on state change; skip work when nothing is due or
  armed. **Done when:** an idle instance performs zero periodic writes
  (asserted by watching the DB file/WAL in a test) and the 1s tick does no
  lock acquisition when no jobs are armed. **needs owner doc update**
  (LLP 0028 §local scheduler). **Landed 2026-07-01** — `persist_cron_state`
  writes only when the serialized state changes (idle ticks are no-ops), and a
  lock-free `cron_active` flag (recomputed on manifest/subscription changes via
  `refresh_cron_active`, keyed on `LocalCronRuntime::any_armed`) lets the ticker
  skip the global lock entirely when no job is armed. Owner-doc contract added
  to LLP 0028 §Scheduler state. Tests
  `l5_idle_instance_performs_no_periodic_cron_writes` and
  `l5_cron_activity_flag_tracks_arming`.
- **L6 — Reader pool.** LLP 0003 §Database Model designed a WAL reader pool;
  the implementation serializes even read-only queries on the single
  `tokio::Mutex<LocalSnapback>` (`crates/snapback/src/server.rs:23`, `378`) [confirmed].
  Give queries read connections with snapshot-pinned version reads (the
  current version-after-rows read at `crates/snapback/src/storage.rs:334-337` is safe only
  under the mutex — pin inside a read transaction instead). **Done when:**
  concurrent reads proceed during a long write in a test, and the
  version/rows consistency test passes. **Deferred to a dedicated arc
  2026-07-01** — see the L6+L7 note below. The enabling pieces are now in
  place: E4 (predicate-granularity validation) means concurrent disjoint
  writers no longer spuriously conflict (the measured 1.0→0.0), which is the
  precondition this step's own text calls out; M1 is the "before" baseline to
  quantify the win against. **Landed 2026-07-02** (with L7, as the designed
  arc — see the design note below): `ReaderPool` (read-only WAL connections,
  checkout-on-demand, retain 4) plus `ReadLane` — `/query/{name}` and
  `/health` run with no global mutex, the whole invocation (host-plan SQL or
  a full Ibex eval's `ctx.db` host calls) inside one deferred read
  transaction pinned by reading `_snapback_version` first, so rows, captured
  read versions, and the reported version are one snapshot. Manifests and
  permission epochs come from `Arc<RwLock<…>>` snapshots refreshed
  post-commit under the global mutex; epochs are cloned before the pin (the
  conservative direction). In-memory instances (no WAL) fall back to the
  serialized write lane. **Completed across fallback lanes 2026-07-17:** the
  direct-library, live-subscription, and in-memory query entry point now wraps
  the whole invocation in the same deferred snapshot, including membership
  dependency construction; every smaller head-bound storage read also pins its
  reported head and rows together. **Measured (M1 re-run, release, one machine):** a
  read during a busy 400 ms write drops from **~305 000 µs** (queued behind
  the mutex — the pre-arc path, measured in the same build) to
  **~4 300–4 600 µs** on the read lane (≈ the query's own fresh-VM cost,
  i.e. zero queueing — **~70×**); single-writer throughput 248–278 mut/s vs
  the ~227 baseline (no regression). Tests
  `l6_concurrent_reads_proceed_during_a_long_write`,
  `l6_version_and_rows_come_from_one_snapshot_under_concurrent_writes`,
  `l6_memory_instance_falls_back_to_the_write_lane`. **Review note (LOW,
  accepted):** the manifest snapshot is cloned before the data snapshot
  pins, so a reader racing `apply_schema` can decode post-migration rows
  with the pre-migration schema for the microseconds between DDL commit and
  refresh; the additive-only migrator bounds this to a new column surfacing
  untyped/NULL — never an error or a torn row (documented at
  `ReadLane::invoke_query`).
- **L7 — Blocking work off the async workers.** Hermes eval and SQLite run
  synchronously inside async handlers with no `spawn_blocking` anywhere
  [confirmed]. Move blocking sections onto blocking threads (or a dedicated
  runtime thread for the VM, which S5.D1's context work may want anyway).
  **Done when:** no `ex_hermes_eval` or rusqlite call executes on a tokio
  worker (enforced by a debug assertion or lint note), and the busy-loop
  handler test (`crates/snapback/tests/local_v0.rs:1770-1790`) no longer stalls *other*
  endpoints. Full preemption/limits remain owned by
  [LLP 0009](./0009-code-execution-security.rfc.md) — this step is
  scheduling hygiene, not a security claim. **Deferred to a dedicated arc
  2026-07-01** — see the note below. **Landed 2026-07-02** (with L6):
  every server path that can reach Hermes or rusqlite funnels through
  `with_snapback` (`Arc::lock_owned().await` — queued callers wait async,
  burning no thread — then `spawn_blocking` with the owned guard moved in)
  or the read-lane equivalent; that covers all HTTP handlers plus the cron
  scheduler tick, the maintenance tick, and `GET /`. Memory-only endpoints
  (ephemeral ops, outbox/WS drains, disconnect) still lock inline — they
  touch no engine or database. The referenced busy-loop test did not exist
  (stale line reference); it exists now:
  `l7_busy_mutation_does_not_stall_other_endpoints` proves `/health` and
  `/query` respond in <500 ms while a 900 ms busy mutation holds the write
  lane (possible only because L6 reads bypass the mutex — the coupling the
  note below predicted). Enforcement is `crates/snapback/src/exec_guard.rs`: a debug-build
  assertion at the Hermes-eval and storage chokepoints panics if blocking
  work reaches a **multi-thread** tokio worker without the offload helpers'
  thread-local sanction (current-thread test runtimes are exempt — blocking
  there stalls only the caller). S5.D1's `CURRENT_IBEX_HOST_CONTEXT`
  save/restore moves wholesale with the invocation onto its blocking
  thread, so action→mutation re-entry is unchanged (suite-verified).
  **Review fix (HIGH, same day):** the adversarial review pass found `GET /`
  (`instance_home`) still locking inline — its `inspect()` reads SQLite, so
  every debug-build request to `/` panicked the exec guard on the real
  multi-thread server while the suite stayed green (current-thread test
  runtimes are the guard's blind spot). Fixed via `with_snapback`,
  live-verified, and the gap is closed structurally by
  `l7_every_blocking_route_passes_the_exec_guard`, a multi-thread sweep
  over every rusqlite/Hermes-touching route. Also hardened on review: the
  action host's db pointer now derives from the same provenance root as the
  `*mut LocalSnapback` it aliases (Stacked-Borrows hygiene, behavior
  unchanged). Tests `l7_busy_mutation_does_not_stall_other_endpoints`,
  `l7_every_blocking_route_passes_the_exec_guard`,
  `l7_exec_guard_refuses_blocking_work_on_async_workers`.

  > **L6 + L7 are one coupled concurrency-architecture arc, and are being run
  > as a dedicated reviewed pass rather than folded into the Phase 3 tail.**
  > Three reasons the coupling is real, not scheduling convenience: (1) L7's
  > own done-when — "the busy-loop handler no longer stalls *other* endpoints"
  > — is not achievable by L7 alone. A busy-loop handler holds the single
  > `tokio::Mutex<LocalSnapback>`; moving its eval to `spawn_blocking` frees the
  > tokio *worker* but not the *mutex*, and every other endpoint still locks
  > that mutex. The stall only lifts once reads run off a separate reader pool
  > (L6) that does not take the write mutex — so the L7 goal *requires* L6.
  > (2) Both restructure the same invariant: today version-after-rows is
  > consistent *only* because the global mutex serializes everything
  > (`storage.rs:334-337`); L6 must move that read inside a pinned read
  > transaction and L7 must not let a handler eval observe a torn snapshot.
  > (3) They interact with S5.D1's `CURRENT_IBEX_HOST_CONTEXT` thread-local —
  > a dedicated VM thread (the L7 hint) changes which thread that local lives
  > on. Rushing either in isolation risks data races/deadlocks that the current
  > test suite would not reliably catch. **Prerequisites, now all landed:** E4
  > (concurrent writers don't spuriously conflict), M1 (before-baseline
  > numbers), S5.D1 (context save/restore is correct), L8 (delivery is already
  > event-driven, so the reader-pool change doesn't have to also fix latency).
  > The dedicated arc should: design the read/write split (reader pool + a VM
  > owner — actor thread or `spawn_blocking` with a `Send` handler boundary),
  > land it behind concurrency tests (concurrent reads during a long write;
  > version/rows consistency; busy-loop isolation), get one adversarial review
  > (the L3 HIGH bug shows that pays for itself here), and re-run M1 to
  > quantify the win — exactly the "one reviewed arc, M1 before/after" this
  > plan already prescribes for L6–L8.

  **The L6+L7 read/write split (arc design, written before implementation,
  2026-07-01).** Two lanes:

  - **Write lane (semantics unchanged).** `Arc<tokio::Mutex<LocalSnapback>>`
    keeps owning every state-mutating operation — mutations, schema/function
    loads, live subscribe/resume, ephemeral, cron, connection lifecycle,
    inspect. Single-writer is preserved (LLP 0003 §Database Model; WAL has one
    writer anyway).
  - **Read lane (new).** `/query/{name}` and `/health` execute with **no
    global lock**, against (a) a WAL **reader pool** for file-backed databases
    and (b) an `Arc<RwLock<ReadShared>>` snapshot of the non-DB state a query
    needs (function manifest, schema, permission epochs, runtime
    capabilities).

  **L6 — reader pool + pinned snapshots.**

  - `ReaderPool` (file-backed only): read-only SQLite connections
    (`SQLITE_OPEN_READ_ONLY`, `PRAGMA query_only=ON`) checked out per query
    invocation from a `Mutex<Vec<Connection>>`; an empty pool opens a new
    connection on demand and check-in retains up to a small cap, so checkout
    never blocks and the pool has no wait/deadlock surface.
  - Each read-lane invocation runs inside **one deferred read transaction**
    pinned at start (the first statement reads `_snapback_version`), so the
    handler's entire execution — host-plan SQL or an Ibex eval making many
    `ctx.db` host calls — observes a single WAL snapshot, and the reported
    `version` comes from the same snapshot as the rows. As of 2026-07-17 the
    serialized live/in-memory fallback also creates one outer deferred
    transaction for a complete query invocation; it no longer relies on the
    mutex to make separate autocommit version/row statements appear atomic.
  - **Ordering rule:** permission epochs are snapshotted **before** the data
    snapshot pins. Recorded-epoch-older-than-data at worst conflicts/resyncs
    conservatively; the reverse order could label pre-bump data with a
    post-bump epoch and mask a permission resync.
  - **Refresh rule:** the write lane refreshes `ReadShared` after commit,
    while still holding the global mutex (so refreshes are ordered). A reader
    between commit and refresh sees the old manifests — indistinguishable from
    having arrived a moment earlier.
  - In-memory databases cannot run WAL (`configure` skips it): the read lane
    falls back to the serialized write lane. The product default is
    file-backed (`.snapback/dev.sqlite3`), so the default target gets the
    concurrency.

  **L7 — blocking work off the async workers.**

  - Chosen shape: **`lock_owned()` + `spawn_blocking`**, not a dedicated
    VM-owner thread. Waiting for the write mutex stays async
    (`Arc::lock_owned` — queued callers burn no thread); only actual execution
    occupies a blocking-pool thread, with the `OwnedMutexGuard` moved into the
    closure. A dedicated VM thread was considered and rejected: with
    fresh-VM-per-invocation (M1) there is no VM affinity to preserve, and an
    actor conversion would touch every lock site for no additional
    correctness.
  - Uniform rule: `LocalSnapback` methods — and therefore every
    `ex_hermes_eval` and rusqlite call — execute only on blocking threads.
    Every server call site funnels through one helper (`with_snapback`),
    including the cron scheduler tick, the maintenance tick, and the WS
    drain/disconnect path; queries funnel through the read-lane equivalent.
  - S5.D1 thread-local: `CURRENT_IBEX_HOST_CONTEXT` set/eval/restore all
    happen inside `run_ibex_handler_with_context`, which moves as a unit onto
    the blocking thread; action→mutation re-entry stays synchronous on that
    same thread, so the save/restore stack discipline is untouched.
  - Enforcement: a `debug_assert`-backed sanction marker (thread-local set by
    the lane helpers) fires if Hermes eval or a chokepoint `LocalDatabase`
    method runs inside a tokio runtime context without the marker — so any
    future endpoint that calls into the core directly on an async worker fails
    loudly in debug/test builds.

  **Explicit non-goals (scope fence).** Preemption/timeouts stay owned by
  LLP 0009 §Resource Limits — a busy-loop handler still runs forever; it now
  costs one blocking thread and the write lane, not the async workers or the
  read lane. Ephemeral-off-the-global-mutex is L9 (LLP 0026): ephemeral and
  inspect endpoints still queue behind a busy write. Concurrent writers stay
  out: single writer is the design.
- **L8 — Event-driven delivery.** The WS path polls each connection's outbox
  every 25ms under the global lock (`crates/snapback/src/server.rs:419`, `437-446`)
  [confirmed] — a ~25ms latency floor and idle lock traffic linear in
  connections. Replace with wakeup notification (the change-notification
  seam LLP 0008 already declares swappable); keep poll as a fallback lane.
  **Done when:** idle connections generate zero periodic lock traffic and a
  latency test shows sub-poll-interval delivery. **Landed 2026-07-01** — a
  `DeliveryNotifier` (per-connection `tokio::Notify`) is woken at every enqueue
  site (durable fan-out + ephemeral fan-out); the WS loop registers, drains once
  to close the startup race (enqueues are serialized under the global lock), and
  then `select!`s on the waker instead of a 25ms tick, so delivery is on-enqueue
  (sub-millisecond, no poll floor). The poll is replaced by a 30s defensive
  heartbeat (~1200× less lock traffic — effectively idle). Test
  `l8_enqueue_wakes_the_registered_delivery_waiter`; the WS integration tests
  confirm end-to-end delivery.
- **L9 — Ephemeral room authority off the global mutex.** Owned by
  [LLP 0026](./0026-ephemeral-backend-abstraction.plan.md); this plan only
  sequences it (after L4, alongside L6–L8). Also close the scope-epoch
  dead-code finding (this review's — 0026 does not yet record it; add it to
  0026's gap list as part of this step): epochs are allocated but never
  advanced, so the `AuthRevoked`/`AuthChanged`/`Restarted` machinery is
  unreachable [confirmed]; wire epoch advancement to the events that own it
  or remove the dead variants until they're real. **Done when:** the
  finding is recorded in 0026 and the epoch machinery is either live (with
  a revocation test) or removed. **Landed 2026-07-02** per LLP 0026's
  Phase 1+2 acceptance (design written before code, as that plan's as-built
  note): the room authority is an internally synchronized sharded store —
  per-room locks, room-granular expiry index, hard limits, store-global
  epoch allocation — and the ephemeral endpoints, WS socket-text ops, and
  drains reach it with no global mutex. The scope-epoch finding is recorded
  in 0026 with its resolution (the same wiring landed concurrently upstream
  as ENG-22478 review fix D; the sharded authority adopts its ratified
  reasons): `Restarted` (reset) and `EpochChanged` (destructive definition
  replacement) are live boundaries, recreated rooms get fresh epochs, and
  the ownerless `AuthRevoked`/`AuthChanged` variants are removed until
  real. Tests
  `l9_ephemeral_ops_proceed_while_a_busy_mutation_holds_the_write_lane`
  (the L6/L7 payoff: ephemeral publish/subscribe/drain complete in <500 ms
  while a ~900 ms mutation holds the write lane),
  `l9_hot_room_publish_does_not_stall_unrelated_rooms_or_durable_drain`,
  `l9_snapshot_registration_is_atomic_under_concurrent_publishes`,
  `l9_room_limits_reject_never_silently_evict`,
  `l9_recreated_room_gets_a_fresh_scope_epoch`,
  `l9_cleanup_expired_visits_due_rooms_and_prunes_empty_ones`,
  `l9_reset_and_destructive_replace_signal_resync_boundaries`; the cursors-web
  browser acceptance passes 7/7 against the sharded authority.

**Phase 3 Done when:** L1–L5 closed; L6–L8 landed as a reviewed arc with the
M1 harness (Phase 4) run before/after to quantify the win; L9 landed per
LLP 0026's own acceptance — sequenced here, owned there. **Phase 3 is
complete (L1–L9) as of 2026-07-02.**

**L1–L5 completed 2026-07-01** (the design-independent lifecycle fixes), each
test-first and adversarially reviewed (the review caught and fixed a HIGH
read-set-validation bug in L3). **L8 landed 2026-07-01; L6+L7 landed
2026-07-02 as the dedicated reviewed arc** (design written before code,
concurrency tests, one adversarial review pass — which again caught a HIGH,
the unconverted `GET /` handler — and the M1 before/after recorded in
[LLP 0035](./0035-local-target-benchmarks.research.md)). **L9 landed
2026-07-02** (owned by LLP 0026, which records what shipped), closing
Phase 3.

## Phase 4 — Measurement

The corpus repeatedly (and correctly) refuses to decide certain things
without numbers; this phase produces the numbers. Do it after L1–L5 so the
measurements aren't dominated by known leaks, and ideally interleaved with
L6–L8.

- **M1 — Benchmark harness in-repo.** A `cargo bench`-able (or dedicated
  bin) harness over the canonical local target with controllable dimensions:
  connections, live subscriptions, write rate, result-set size, tables,
  change-journal size, ephemeral publish rate. Named outputs, each a number
  with method: single-writer breaking point; fan-out ceiling (subscriptions
  × write rate at target latency); per-invocation VM cost (create + install
  + eval overhead — `crates/snapback/src/runtime.rs:515`, `183-204`); matcher cost per
  commit; read-set validation cost; spurious-conflict rate under concurrent
  disjoint-row writers at table granularity (the number DK-1/E4 actually
  turns on); ephemeral publish cost at 20–60 Hz.
  **Done when:** results are committed as a Research LLP with methodology,
  and CI runs a smoke-scale variant to catch order-of-magnitude regressions.
  **Landed 2026-07-01** — harness now in `crates/snapback-tools/src/bench.rs` (bin `snapback-bench`,
  `--json`); first numbers + methodology committed as
  [LLP 0035](./0035-local-target-benchmarks.research.md); CI smoke lane is the
  `m1_bench_smoke` lib test (tiny scale, 10× threshold headroom). **Headline:**
  per-invocation VM cost ~3.9 ms dominates everything — single-writer ~230
  mut/s, and live fan-out ~4.9 ms per *affected* subscriber (a fresh-VM
  re-query each), so the fan-out ceiling is ~2 subs/commit at a 10 ms budget.
  Matcher (~1.8 µs/sub), validation (~1.3 µs/dep), and ephemeral publish (~2 µs,
  ~485k/s) are cheap; the disjoint-writer spurious-conflict rate is 1.0. This is
  decisive evidence for M2 (DK-4 warm VM) and M3 (DK-3 deltas/read lane), and
  the "before" baseline for the L6–L8 arc.
- **M2 — Decide DK-4 (VM lifecycle) on M1 evidence.** Fresh-VM-per-invocation
  is the dominant compute cost, multiplied by fan-out re-queries. The
  candidate: warm VM per bundle hash for the **trusted local** target only,
  with fresh-per-invocation retained for hosted/untrusted (LLP 0009's five
  pooling proof obligations unchanged — this is not the hosted pooling
  question). **Done when:** DK-4 ledgered with numbers attached. **Decided
  2026-07-01** — ledgered in LLP 0000; recorded in LLP 0009 §Invocation
  Isolation with the M1 numbers (LLP 0035). Direction ratified (reduce
  per-invocation VM cost is *the* lever); the warm-VM leg is gated on a proven
  per-invocation reset (Valet found none on Hermes). **Cheapest safe step done
  (M2, 2026-07-01):** the per-invocation host install is now cached to
  once-per-process (`ensure_host_installed`) — a correct cleanup that also
  removes the nested-re-entry host-reinstall side effect — but the M1
  decomposition (`vm_create_us` in `snapback-bench`) shows the install was *not*
  the cost: caching left VM cost within noise, and the cost is **~55 %
  `ex_hermes_create` + ~45 % eval**. So the real lever is **VM reuse**, not the
  cheap step; this sharpens DK-4 (recorded in LLP 0009 and LLP 0035).
  **Warm VM landed 2026-07-02** — the gated leg shipped: a per-instance pool
  keyed by exact module source reuses VMs for queries/mutations behind a
  verified per-invocation reset (baseline-restore of globalThis, the dispatch
  table, and a broadened intrinsic-root set; fail-closed burn on any doubt);
  actions and hosted stay fresh; capability-flagged as `vmLifecycle`
  (`warm-pooled-reset` vs `fresh-per-invocation`) with a `SNAPBACK_FRESH_VM=1`
  opt-out. **Hardened same day after adversarial review** — a HIGH
  cross-invocation context-injection bug (a module-scope-stashed `ctx`/resolver
  firing during a later invocation would route through the wrong context and
  inject a cross-user write) is closed by an **invocation-epoch
  stale-continuation guard** (every host call carries its originating
  invocation's epoch; a mismatch against the live context is rejected
  fail-closed); a MEDIUM (shallow reset root-set) by broadening the sweep to
  the iterator/generator prototypes and all constructors with restore-or-burn;
  a read-lane check-in race by a pool generation counter. The proven-reset gate
  is the `dk4_*` leak suite (`crates/snapback/tests/warm_vm_dk4.rs` + `crates/snapback/src/warm_vm.rs` unit
  tests), including the cross-invocation regression test that fails against the
  pre-guard code. Measured
  ([LLP 0035](./0035-local-target-benchmarks.research.md) §After warm VM, two
  runs, guard adds no measurable cost): warm invocation **~800–900 µs** vs
  fresh ~3.6 ms (**4.5–6.1×**); single-writer **~1 050–1 280 mut/s** (was
  248–278, ~4–5×); fan-out **~1 550–2 000 µs**/affected sub (was ~4 900,
  ~2.4–3×), ceiling ~5–6 subs/commit @ 10 ms; the remaining fan-out cost is row
  work (DK-3 territory), not VM work. As-built design + honest limits
  (module-level closure *state* persists — documented pooled-runtime semantics
  — while cross-invocation *execution* is fenced by the epoch guard) in
  [LLP 0009](./0009-code-execution-security.rfc.md) §DK-4 as-built.
- **M3 — Decide DK-3 (delta shape and read lane) on M1 + LLP 0022 evidence.**
  Whole-document `live_replace` per affected subscription per commit
  (`crates/snapback/src/local.rs:887-948`) versus op-log deltas, and the stateful-WS-only
  read path versus an Electric-style cacheable HTTP read lane — 0022 calls
  the latter "the most actionable single idea" and it is hard to retrofit
  after LLP 0012's capability classes and the wire protocol harden. This
  decision must be made deliberately even if the answer is "replace-only and
  WS-only for v1, revisit at N subscribers." **Done when:** DK-3 ledgered;
  LLP 0008/0012 revised to record the outcome and its revisit trigger.
  **Decided 2026-07-01** — v1 pin: whole-document `replace`, WS-only. The M1
  fan-out cost is VM-bound (each affected sub is a fresh-VM re-query), so DK-4
  (warm VM) is the higher-leverage immediate fix and op-log deltas are the next
  lever after it. Recorded in LLP 0008 §Reactivity with a named revisit trigger
  (warm-VM fan-out still exceeding target at a real subscriber count, or the
  hosted multi-subscriber target) and an LLP 0012 wire guardrail keeping the
  cacheable-HTTP-read-lane option open; ledgered in LLP 0000. **Re-measured
  2026-07-02 after DK-4 (the trigger's own instruction):** the trigger is
  armed. Warm re-query fan-out is ~1 680–1 970 µs/affected sub (ceiling ~5–6
  subs/commit @ 10 ms); the op-log-delta projection for the analyzable subset —
  classify each `ChangedRow` against the captured predicate with the real live
  matcher, no VM — is ~0.32–0.36 µs/sub (~5 200×; ceiling ~28 000+
  subs/commit), recorded in [LLP 0035](./0035-local-target-benchmarks.research.md)
  §M3 with a CI smoke guard. Op-log deltas for the analyzable syncable-live
  subset are the sanctioned next fan-out lever; **implementation is Phase-2
  work whose wire kind + client apply are shared surface with the LLP 0034
  provider-side kit and must be sequenced with it** (additive `live_delta`
  beside the `live_replace` fallback, never a breaking change). LLP 0008
  §Decision DK-3 records the fired trigger; LLP 0000 ledger updated.

## Phase 5 — Product boundary and DX

The review's strongest product finding: the flagship realtime never reaches
the flagship Contract surface, and the codegen pipeline — the component the
agent-first philosophy leans on hardest — is the least fed-back component in
the repo. This phase makes the JS estate product-grade. It can run in
parallel with Phase 3.

**Phase 5 completed (P1–P8) — Milestone C reached** (executed 2026-07-02 on
the stranded line; re-landed 2026-07-03, ENG-22680). The one Milestone C
leg that only a future event can measure: acceptance #6's glue-inventory
drop is recorded by the *next* demo's diary.

> **Status (2026-07-03) — Phase 5 re-landed; Milestone C reached
> (ENG-22680).** Phase 5 was first executed end to end on 2026-07-02 on a
> local main that had diverged from origin/main; the origin sync kept the
> origin lineage and the 22-commit execution was preserved unmerged on
> `backup/main-before-origin-sync-20260702`. The doc-only decision records
> were re-landed 2026-07-03 (morning), and the code phases were re-landed
> the same day *adapted to the post-sync main* (ENG-22680): P1–P6 as
> adapted cherry-picks that preserve this line's DK-7 emit-time
> validation, ENG-22527 liveness facts, ENG-22525 publish descriptors,
> live_delta protocol, ensureApp boot, graffiti demo, and schema_export
> generator; P7 as a coverage port onto ENG-22595's doctor (the stranded
> `ibex-artifacts.sh` extraction deliberately dropped — superseded by
> ENG-22660/22664); P8 legs 2+3 (one admin client, camelCase typed
> inspect) with leg 1's pin ceremony superseded by the
> registry-packages-over-pinned-checkout direction (b64336a). Per-phase
> adaptation notes live in each P-row below.

- **P1 — Promote codegen out of `demos/_kit`.** `demos/_kit/codegen.mjs`
  (1,281 lines) is the only writer of the manifests, typed API, and Contract
  binding modules that the Rust server ingests and
  `packages/snapback-contract` validates —
  `docs/contract-exact-integration.md` already admits it is product code in
  a demo directory. Move it to a product package (e.g.
  `packages/snapback-codegen`); the kit and demos import it. Fold in the
  duplicate emitters in `admin-ui/generate-contract-bindings.mjs` (already
  drifted from the kit's output shapes) [confirmed]. **Done when:** one
  emitter exists, demos/_kit re-exports nothing of substance, and the
  admin-ui bindings are generated by the same package. **Re-landed
  2026-07-03 (ENG-22680)** — `packages/snapback-codegen` (`@snapback/codegen`,
  matching the existing `@snapback/contract` namespace) holds the codegen
  (`index.mjs`), the authoring surface (`define.mjs` — moved intact; its
  Symbol markers demand one module instance, so the kit shims re-export
  rather than copy), and the extracted shared `contract-emitter.mjs`
  (runtime-links / binding / contract-meta renderers, now carrying the
  ENG-22527 liveness facts through an `extraFacts` seam the admin bindings
  don't use). `demos/_kit/{codegen,define}.mjs` are compatibility shims (CLI
  delegation preserved); `admin-ui/generate-contract-bindings.mjs` keeps
  only its binding list and arg vocabulary and emits through the shared
  emitter — the drifted copy is deleted. Adapted to the post-sync main: the
  moved codegen carries the DK-7 emit-time schema validation, the ENG-22527
  liveness facts / real ephemeral value shapes, and the ENG-22525
  publish-descriptor emission that landed on this line after the divergence
  point. All committed artifacts regenerated (generated-by headers +
  define-comment inputsHash churn; todo's manifest additionally picked up
  the app-identity block main's committed copy predated). Proof: kit
  client-errors 8/8 + eight regression suites + live-delta 3/3,
  provider-live-conformance 13/13, todo headless 23/23, todo-v2 16/16,
  all-aboard egress 14/14, admin-ui binding smoke ok.
- **P2 — Server-derived capability manifest.** `capability.manifest.json` is
  a hardcoded literal in codegen describing what the *Rust server* supports
  (`demos/_kit/codegen.mjs:341-388`) while the server independently computes
  its own report for `/inspect` — two sources of truth [confirmed]. Make the
  server (or a shared generated schema, per DK-7) the single source; codegen
  embeds or fetches it. **Done when:** the JS literal is deleted and a
  parity test compares generated manifest to live `/inspect`. **Landed
  2026-07-02** — the Rust declaration
  (`CapabilityManifest::local_v0_declared`; the gap list extracted to
  `local_v0_default_capability_gaps` so `inspect` shares it) generates the
  committed `schemas/capability.manifest.local-dev-sqlite-ibex.json`
  (regenerate: `SNAPBACK_UPDATE_CAPABILITY_MANIFEST=1 cargo test p2_`);
  codegen embeds the file verbatim (fail-closed
  `CODEGEN_CAPABILITY_MANIFEST_{MISSING,INVALID,MISMATCH}` diagnostics, file
  content folded into `inputsHash`), and the JS literal is deleted. The
  drift the step predicted was real: the literal had never learned
  `vmLifecycle`. Parity tests in `crates/snapback/tests/capability_v0.rs`:
  committed-file == declaration, and live `/inspect` == declaration modulo
  the two documented instance-live fields (`vmLifecycle`, `ibex_cli` gap).
  Demo artifacts regenerated — each `capability.manifest.json` is now
  byte-identical to the canonical schemas file. LLP 0012 §Capability
  Manifest records the contract.
- **P3 — CI feedback loops for generated artifacts.** Three gates:
  (a) regen-and-diff — run codegen for every demo and `git diff
  --exit-code` on `generated/`, closing the stale-but-internally-consistent
  hole (`inputsHash` is stamped but never recomputed against sources; the
  Contract adapter already compares stamped hashes *across* artifacts —
  `SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH` — don't duplicate that)
  [confirmed]; (b) `tsc --noEmit` over every generated `.d.ts` plus a typed
  consumer fixture (the S5.D2 bug shipped because no TypeScript ever
  compiled the output); (c) manifest JSON-Schema validation against a schema
  derived from the Rust types — this is **DK-7**, the corpus's most-repeated
  open question (LLP 0016, 0020, 0024 all block on it); **decided 2026-07-02**
  ([LLP 0037](./0037-schema-source-of-truth.decision.md), Rust-first) and
  **P3(c) landed 2026-07-02**: the Snapback-owned serde types carry
  `schemars::JsonSchema`; one generator
  (`snapback::schema_export::artifact_schemas`) is written to
  `schemas/*.schema.json` by the `snapback-schemagen` bin and diffed by the
  drift gate `crates/snapback/tests/artifact_schemas_v0.rs`
  (`dk7_committed_schemas_match_rust_types`); a representative value of each
  artifact round-trips through serde and validates against its committed schema
  (`dk7_representative_values_validate_against_committed_schemas`, proving the
  generated schema matches the serde output — no `#[schemars(...)]` overrides
  needed); and `demos/_kit/codegen.mjs` validates every Snapback-owned artifact
  it emits against the committed schemas before writing, failing closed with a
  structured `CODEGEN_ARTIFACT_SCHEMA_{MISSING,INVALID}` diagnostic. **P2
  handoff:** the capability manifest now has a committed schema
  (`schemas/capability.manifest.schema.json`, from `manifest::CapabilityManifest`)
  so P2 can delete the JS literal and consume the schema half. Also close the
  typing gaps:
  JS-handler result types are guessed from the first declared read table and
  `v.json()` becomes `unknown` (`demos/_kit/codegen.mjs:145-146`, `807-808`)
  — require declared result validators for JS handlers or mark the type
  honestly. The gates may land as plain repo scripts in CI before P6's
  workspaces exist. **Done when:** all three gates run in CI and the S5.D2
  bug class cannot land; DK-7 is ledgered. **needs owner doc update**
  (LLP 0012 §Versioning). **Landed 2026-07-02** — all three gates in
  `scripts/verify-local-proof` (the CI entry): (a)
  `scripts/check-generated-artifacts` re-runs codegen for all five committed
  backends + admin bindings and fails on any diff or untracked output — the
  registered absolute-path-hashing blocker was **already fixed** by the
  LLP 0034 review fix 4 (manifest-relative hashing; the register row was
  stale on revalidation); (b) `scripts/check-generated-types` runs pinned
  `tsc --strict --noEmit` over every generated `api.d.ts` plus
  `demos/_kit/tests/typed-consumer-fixture.ts` (typed calls, a
  `@ts-expect-error` misuse probe, and a pinned assertion on the S5.D2
  regression site) — proven to reject the S5.D2 class by injecting the
  historical bug; (c) per DK-7/LLP 0037, `schemars`-derived JSON Schemas for
  the three manifests are committed at `schemas/*.schema.json` with a
  Rust snapshot drift gate, every committed demo manifest validates against
  them (`jsonschema` dev-dependency) and parses through the runtime structs
  (`crates/snapback/tests/artifact_schemas_v0.rs`, in `cargo test`). Typing gaps closed:
  `defineJsQuery`/`defineJsLiveQuery` accept a declared `result` row
  validator (todo's `listTodos` declares one; its emitted shape is
  byte-identical to the old guess), and undeclared JS-handler results are
  an honest `unknown[]` — which exposed that the old first-read-table guess
  had been typing egress-probe's `{fetchState, config}` rows as `probe`
  rows. JS emit-time schema validation (defense-in-depth beyond the CI
  gates) follows once P6's workspace can carry a JS validator dependency.
- **P4 — Wire protocol: multiplexing, reconnect, resume.** The
  per-connection outbox is drained destructively by whoever asks first: two
  `liveQuery` handles on one connection silently discard each other's
  updates, durable and ephemeral consumers discard each other's envelopes,
  and HTTP polling races the WS stream for the same messages
  (`demos/_kit/client.mjs:123-133`, `189-198`, `246-254`) [confirmed]. No
  client reconnect/backoff exists; the server's `/live/{name}/resume` is
  never called; `EphemeralOverlay.needsResync` is set and never acted on
  [confirmed]. Design the addressed-envelope/acked-drain protocol (owned by
  LLP 0012/0008 — **needs owner doc update**), then implement client
  reconnection with resume and backoff. **Done when:** the
  two-subscriptions-plus-overlay-on-one-connection test passes; a
  kill-socket test reconnects, resumes, and converges; drains are
  non-destructive until acked. **Closed 2026-07-02 — the register was
  superseded on revalidation, and the step's remainder landed now.** The
  LLP 0034 D1 + ENG-22478 D2 arc (landed 2026-07-01/02, concurrent with
  this plan's Phase 3) had already rebuilt the protocol: subscription-id
  addressed envelopes with explicit supersession, the per-connection
  cross-lane registry (durable and ephemeral consumers no longer discard
  each other's messages; the poll lane shares stream-owned connections),
  bounded-backoff reconnect that only promotes connection state after a
  successful fresh subscribe, receipts with correlation, and the
  consumer-driven `needsResync` recovery the adapter exercises. The
  deliberate protocol decisions, now recorded in LLP 0008 §Realtime
  Delivery (the owner-doc update): **reconnect is a fresh
  snapshot-with-subscribe, never a resume** (the outbox dies with the
  connection — S5.D5's resolution; drains need no ack because loss is
  recovered by snapshot), `resume_live` stays a same-connection op, and
  version-based delta-resume stays future work behind DK-3's revisit
  trigger. P4's own landing: the named
  `regression-multiplexed-lanes` test (two durable handles + an ephemeral
  overlay on one connection, every lane advancing; kill-socket convergence
  across all lanes), wired into `verify-local-proof`, plus the L1
  connection-wide `resync_required` sentinel handling verified in the
  client (no-`subscription_id` sentinel re-snapshots every handle —
  `demos/_kit/client.mjs` `applyDurable`).
- **P5 — Resolve the adapter live-push fork (DK-10) and rebuild the Contract
  adapter.** [LLP 0029](./0029-all-aboard-gap-closure.plan.md) G2's open
  fork: the packaged adapter owns a live subscription versus a separate
  live-provider seam beside it. Today `createSnapbackContractSurface` is
  single-boundary (every generated query link returns the same rows —
  `packages/snapback-contract/index.mjs:182-186`), reconciles only after
  local mutations, and ships todo-demo mutation names inside the generic
  package (`index.mjs:539-559`) [confirmed]. Five of eight diaries
  hand-rolled glue around this; All Aboard's `store.mjs` + 1.5 s poll (plus
  a 1 s UI clock) is the current workaround. All Aboard is the proving demo
  for P5/P6 — the "no new demos before P5" guardrail makes it the only
  candidate. **Done when:** a cron-authored (server-initiated)
  change reaches a Contract surface with zero per-demo glue; All Aboard's
  `store.mjs` is deleted; multi-query surfaces bind per-query; the todo
  defaults are gone; the diary glue-inventory count falls (LLP 0016's rule).
  **Closed 2026-07-02 — partially superseded on revalidation, remainder
  landed now.** The LLP 0034 D1/C1 arc had already rebuilt the adapter:
  it owns the live subscription (single-query mode subscribes when the
  bound descriptor is live; the multi-query `liveQueries` mode binds each
  named query to its own boundary key and connection axis over one shared
  socket), and All Aboard's `store.mjs`/poll pump were already deleted —
  **DK-10 is thereby decided: adapter-owned live push**, the
  live-provider-seam fork is dead (docket + LLP 0029 G2 + ledger updated).
  P5's own landing: the todo-demo defaults are out of the generic package
  (`queryName`/`boundaryKey` are required options failing closed with
  `SNAPBACK_CONTRACT_SURFACE_BINDING_REQUIRED`; optimistic reducers are
  app logic, moved to `demos/{todo,todo-v2}/surfaces/contract/optimistic.mjs`;
  seven call sites migrated), and the done-when proof exists:
  `demos/all-aboard/tests/acceptance/contract-live.mjs` — a forced cron
  tick's committed rows stream into the Contract boundary with zero
  per-demo glue, the adapter's own subscription arming the demand-activated
  job. Suites: todo contract 8/8, todo-v2 contract 13/13,
  adapter-semantics, provider-conformance, optimistic-clobber,
  ephemeral-wiring, contract-live 2/2. The glue-inventory-falls leg is
  measured by the next demo's diary (program acceptance #6), not here.
- **P6 — Packaging and the operating surface.** Root `package.json` +
  lockfile + workspaces (there are none today); decide and claim the real
  package name ([LLP 0021](./0021-contract-exact-integration-hardening.plan.md)
  open question); build the minimal host-ops core so
  [LLP 0024](./0024-agent-operating-surface.spec.md) stops being
  pinned-not-built — first slice: `host.start/stop`, `app.inspect`,
  `app.reset`, `schema.load`, `functions.load`, `function.run` as the CLI +
  `POST /_snapback/api/host-ops`, with `--ready-file` readiness so
  [LLP 0030](./0030-managed-snapback-vite-dev.rfc.md) attach/managed modes
  can land on top. S4's interim demo-boot fix graduates to this. **Done
  when:** `snapback` (or the chosen binary name) performs the six ops
  against a local instance; 0030's attach descriptor validation works; 0024's
  banner from R4 flips to "built" for the shipped verbs. **Landed
  2026-07-02.** Packaging: repo-root `package.json` + `bun.lock` with
  `packages/*` workspaces; the namespace decision (0021's open question) is
  **`@snapback/*`** (`@snapback/contract`, `@snapback/codegen`) for source and
  application imports. The deferred public-registry part was resolved at the
  LLP 0074 checkpoint on 2026-07-22: the first published artifacts map to
  `@ccheever/snapback-*`, because `@snapback/cli` is an unrelated live package
  and this project has no recorded authority over that scope; staged npm alias
  dependencies keep authored imports stable (LLP 0021). Host-ops:
  `crates/snapback/src/host_ops.rs` is the envelope source of truth
  (committed `schemas/host-ops.result.schema.json` +
  `schemas/host-ready.schema.json` per LLP 0037, drift-gated); the gated
  `POST /_snapback/api/host-ops` endpoint (route-registry entry) serves
  `app.inspect`, `app.reset` (+seed), `schema.load`, `functions.load`,
  `function.run` (queries/mutations, never actions), and every
  pinned-not-built operation fails closed with a structured envelope
  (`SNAPBACK_HOST_OP_{UNKNOWN,UNIMPLEMENTED,CLI_ONLY,…}`). The `snapback`
  CLI projects `start` (foreground; `--ready-file` writes the LLP 0030
  readiness descriptor, removed on exit), `stop` (descriptor-validated
  signal), `inspect`, `reset [--seed]`, `load
  --schema/--functions`, and `run <function> [--args] [--user]`, printing
  one envelope per op with exit-code projection over `ok`. Proof:
  `crates/snapback/tests/host_ops_v0.rs` (served-op round trip, fail-closed matrix,
  ready-file write + attach validation + tamper rejection) and a live
  end-to-end CLI run (start → load → reset+seed → run query/mutation →
  inspect → stop, ready file cleaned up). 0024's banner flipped per verb;
  0030 records the shipped handshake.
- **P7 — Ibex bring-up doctor.** Three diaries hit Hermes/dyld bring-up
  failures in three different shapes (build env, spawned-process dyld,
  cargo-can't-compile), and `cargo test` still requires a manual
  `DYLD_FRAMEWORK_PATH` on macOS. Fold the known failure shapes into a
  `doctor`-grade structured check (extend `scripts/bootstrap-ibex-runtime`
  or add a host-op): detect frameworks, paths, env, and print
  diagnostic-coded remediation. **Done when:** a fresh clone on macOS goes
  red→green through doctor guidance alone, and a CI lane exercises the
  doctor. **Re-landed 2026-07-03 (ENG-22680), reconciled with ENG-22595's
  doctor** — main had independently built `scripts/ibex-doctor`
  (adversarially reviewed: the fine-grained submodule wedge states
  WEDGED/DRIFT/CONFLICT/UNINITIALIZED/BROKEN/SOURCE_MISSING) plus the
  ENG-22660/22664 bootstrap evolution (stable non-submodule diagnostic
  codes; baked LC_RPATH + launch smoke). That doctor is kept as the base;
  the stranded P7's *additional* coverage is ported onto it: the macOS
  runtime-framework probe (the launch-SIGABRT shape, distinct from missing
  headers), the SIP/DYLD standing guidance (macOS strips `DYLD_*` across
  protected binaries so the doctor structurally cannot observe the
  caller's env — kept as info, with the real `LD_LIBRARY_PATH` check on
  Linux), the vendored-CLI presence check, the cargo/node/bun toolchain
  checks, and `--json` structured output. The stranded
  `scripts/lib/ibex-artifacts.sh` extraction is deliberately dropped —
  ENG-22664's bootstrap (LC_RPATH baking + launch smoke) superseded the
  detection helpers it would have shared. `verify-local-proof` runs the
  doctor's green path.
- **P8 — One admin client, typed inspect.** The original embedded console and
  the Contract admin-ui duplicated client and view-model logic, which is where
  the diary-0005 casing bug lived; `/inspect` still mixes camelCase,
  snake_case, and PascalCase in one payload [confirmed]. Extract the shared
  admin client (LLP 0017 open question), normalize or typed-project the
  inspect payload (pairs with 0031 D3's trimmed public inspect). **Done
  when:** admin UI/tooling consumers share one client package and a typed
  inspect schema; a casing-consistency test exists. **Scope addition (2026-07-02,
  found by the Phase 5 full-proof run):** admin-ui still consumes the
  sibling Exact checkout at live HEAD — its `./build.sh` broke against
  Exact commits landed the same day ("pure context calls opaque import
  fonts" in `app.contract` + a moved exact-core internal), while the demos,
  pinned via `exact.pin.json` since ENG-22463/22487, kept building. P8
  should adopt the pinned consumption (`exactContractWeb` preset + pin) for
  admin-ui — the same toolchain-drift class Diary 0009's red-team named.
  **Re-landed 2026-07-03 (ENG-22680), legs 2+3; leg 1 superseded.**
  (1) *Pinned consumption:* NOT re-landed — the stranded `checkExactPin` +
  `admin-ui/exact.pin.json` ceremony was superseded on this line by the
  registry-packages-over-pinned-checkout direction (b64336a: bun.lock is
  THE pin) and by ENG-22600's dev-serve/build fixes against the sibling
  checkout; admin-ui's future pin is registry packages, not a checkout
  hash. The stranded `theme.contract-meta.ts` pure() declarations were
  independently superseded by ENG-22665's version on this line. (2) *One admin client:*
  `@snapback/admin-client` — the Contract admin-ui imports the workspace
  package, and the server exposes the byte-identical module at
  `/_snapback/admin/client.mjs` for tooling; the old embedded console's inline
  `api()` duplicate was deleted before the embedded console itself was removed
  on 2026-07-04. (3) *Typed inspect:* the payload is
  camelCase end to end (StorageInfo, RuntimeCapabilities, delivery/
  ephemeral/cron counters, the server/admin blocks; `DiagnosticSeverity`
  now serializes lowercase, conforming Rust to the JS diagnostic family it
  had drifted from — aliases keep old spellings parsing); the embedded v0
  artifacts keep their LLP 0012-pinned shapes as the documented exception;
  committed schemas `inspect.admin.schema.json` + `inspect.public.schema.json`
  ride the LLP 0037 drift gate; `crates/snapback/tests/inspect_casing_v0.rs` walks both real
  payloads. All 188 Rust tests green; every touched JS suite green.

## Phase 6 — Strategic derisking

Spikes that protect the two claims the whole design leans on — graduation
and the second target — before local pins make them expensive. Gated on
Phases 2 and 4 learnings; X1/X2 can start earlier since they are
design-first.

- **X1 — Commit-version graduation spike (DK-2).** The single global
  monotonic version is trivially correct on single-writer SQLite and
  undesigned for concurrent Postgres writers and for D1
  ([LLP 0007](./0007-storage-portability.spec.md) and
  [LLP 0014](./0014-cloudflare-strategy.rfc.md) both flag it). Produce the
  design note: candidate shapes (Postgres sequence + logical-decoding change
  feed; per-app version shards using
  [LLP 0018](./0018-app-instance-boundaries.rfc.md)'s boundary; HLC-style
  ordering) and what each means for the wire format and client cursors.
  **Gates this program** (design note and ledger only; implementation
  follows later). **Done when:** DK-2 is ledgered in 0007/0014 revisions and
  any wire-format implication is reflected in LLP 0012 *before* further
  protocol pins. **Landed 2026-07-02** — design note in
  [LLP 0007](./0007-storage-portability.spec.md) §Commit-version graduation:
  the pinned portable contract is **per-app, gap-free-in-commit-visibility
  version streams with opaque `(stream, version)` cursors**; allocator
  mechanics are target-owned (SQLite serialized commit as shipped; Postgres
  **commit fencing** recommended with the logical-decoding change feed
  recorded as the measured scale escape; Durable Object per-object counter
  with **one version authority per app** named as the Profile C constraint);
  HLC ordering rejected for v1 with a named revisit trigger (multi-master
  within one stream). LLP 0014 §Durable State carries the Cloudflare answer;
  LLP 0012 §Versioning pins the cursor shape ahead of P4's reconnect/resume
  envelopes. DK-2 ledgered in LLP 0000.
- **X2 — Decide DK-5; if "now", build the V8 conformance twin.** The
  runtime-conformance floor is ratified but `async_handler_completion:
  Available` is a hardcoded constant (`crates/snapback/src/runtime.rs:76`), the canonical
  engine cannot enforce CPU/wall-clock limits (self-declared Missing,
  `crates/snapback/src/manifest.rs:745-753` — the vendored watchdog hook is cooperative and
  cannot preempt a busy loop), and a `while(true){}` handler wedges the
  whole process while holding the global lock — the hosted story hangs on a
  V8 path with a Valet history of designed-never-built. Candidate: the
  minimal second runtime passing the LLP 0009 conformance floor and the
  existing Ibex test suite behind a feature flag — conformance only, not
  hosted isolation. **The DK-5 decision gates this program; the build lands
  per its outcome.** **Done when:** DK-5 is ledgered; if "twin now", the
  same `crates/snapback/tests/local_v0.rs` handler tests pass on both engines in CI and the
  capability report's enforced/advisory limit fields are *computed*, not
  asserted; if "defer", the revisit trigger is named in LLP 0009.
  **Decided 2026-07-02 — defer, with four named revisit triggers**
  (LLP 0009 §Decision DK-5): the synthetic twin's anti-hardening job is
  already done by the fail-closed handler-surface gates that exist in CI;
  the second target (Cloudflare, X3) is V8 by construction and exercises
  the conformance floor with more fidelity than a local embed; a second
  native bring-up would double the repo's #1 recurring DX pain (P7's
  reason for existing); and the busy-loop risk that argued for "now" was
  re-scoped by L6/L7 (one blocking thread + the write lane, not the
  process). Triggers: X3 starting; any hosted/untrusted work; an observed
  Hermes/V8 handler-visible divergence; the missing wall-clock/CPU
  enforcement becoming user-facing locally. The capability-truthfulness
  note records that `async_handler_completion` is suite-verified, with
  computed limit fields landing alongside whichever V8 runtime ships
  first. Ledgered in LLP 0000.
- **X3 — Cloudflare narrow proof.** Execute
  [LLP 0014](./0014-cloudflare-strategy.rfc.md)'s ten narrow proofs (profile
  choice is 0014's call). Sequenced after X1/X2 and P6 (artifacts must be
  consumable off-repo). This plan only schedules it; 0014 owns it.
  **Successor work — scheduled, not gating** (this resolves the former open
  question). **Done when (for this program):** the proof program is recorded
  in LLP 0014 with its X1/X2/P6 prerequisites and an owner.
- **X4 — Client store mandate re-argument (DK-9).** "SQLite on every client
  platform" is inherited from Valet;
  [LLP 0022](./0022-electric-powersync-turso.research.md) says it should be
  argued, not assumed, and it is cheap to reconsider now because no client
  local store exists yet. Short revision to LLP 0008 §Local Store: mandate,
  or store-agnostic interface with SQLite as the reference implementation.
  **Gates this program** (cheap now). **Done when:** LLP 0008 §Local Store
  records the chosen stance and DK-9 is ledgered. **Decided 2026-07-02 —
  store-agnostic interface, SQLite as the reference implementation**
  (LLP 0008 §Decision DK-9): under server-authoritative query-result sync
  the client store is a result cache + cursor/epoch state + outbox, never a
  relational replica, so the contract is the observable-state list and
  nothing on the wire may require SQL client-side; capability reports name
  the physical store; the first client store lands as an implementation of
  the pinned interface with a second store exercising the seam. Valet's two
  SQLite non-negotiables carry into the reference implementation. Revisit
  trigger: parity-class offline replay demanding capabilities the interface
  cannot express without SQL. Ledgered in LLP 0000.
- **X5 — Idle-cost audit per target.** After L5/L8, measure and record what
  an idle local instance actually does (target: nothing periodic), and
  write the per-target idle-cost expectations LLP 0000 §Multi-target
  deployment demands. **Done when:** the numbers are in the M1 Research LLP
  and 0000's claim links to them. **Landed 2026-07-02** — LLP 0035 §Idle
  cost: a provisioned idle instance (todo loaded, zero
  connections/subscriptions/armed jobs) over a 120 s window shows **zero
  disk writes** (database and WAL byte-identical, mtimes frozen), **no
  measurable CPU** (cputime unchanged at 0:00.02), and ~13 MiB resident —
  the L5/L8/L2/L3 periodic machinery is visible as nothing. LLP 0000
  §Multi-target deployment links the measured local entry and keeps the
  dollars-when-idle question per target profile.

---

## Decision docket

Decisions this program forces. Each lands as a revision to its owner doc
(new Decision LLP only where noted), gets ledgered in LLP 0000, and cites
its gating evidence. **Program acceptance requires every row ledgered —
decided, or explicitly deferred with a named revisit trigger.** Update the
Status column in place as rows close. **All ten rows closed as of
2026-07-02** (DK-1's E3 leg stays a pinned design question inside the
decided implement-up direction; DK-5 is an explicit defer with four named
revisit triggers).

| Id | Decision | Options (recommendation first) | Gate | Lands in | Status |
| --- | --- | --- | --- | --- | --- |
| DK-1 | Read-set validation semantics | Implement-up staged (E2→E3→E4); or honest-downgrade (ratify table-granularity serialized writes as v0 semantics) — R7's doc-honesty patch lands first either way | E1; E4 gated on M1 cost numbers | LLP 0003/0004/0007 | **Decided 2026-07-01 — implement-up, staged; fully resolved 2026-07-02.** E2 landed; E4 landed after M1 (predicate-granular); E3 decided Option A (host-plan isolation is the client-supplied baseline *by design* — atomic-host-plan finding) with zero code change. All three legs closed; the E3 decision is **pending Charlie's ratification nod** (ledgered in LLP 0000) |
| DK-2 | Commit-version graduation shape | Postgres sequence + logical-decoding feed; per-app shards (LLP 0018); HLC ordering | X1 design note | LLP 0007/0014 (+0012 wire impact) | **Decided 2026-07-02** — per-app gap-free streams, target-owned allocators (Postgres commit fencing; DO counter), `(stream, version)` opaque cursors; HLC rejected with revisit trigger (LLP 0007 §Commit-version graduation) |
| DK-3 | Delta shape + read lane | Deliberate v1 pin of replace-only/WS with named revisit trigger; op-log deltas; cacheable HTTP read lane | M1 + LLP 0022 | LLP 0008/0012 | **Decided 2026-07-01 — v1 pin replace/WS. Trigger fired 2026-07-02 after DK-4 (M3, ~5 200×). Op-log deltas *landed* 2026-07-02 as an additive `live_delta` wire kind for the analyzable HostPlan subset (server + client + tests; LLP 0008 §Decision DK-3, resolves LLP 0034 OQ1); Ibex-passthrough and windowed deltas are future work. Cacheable read lane still deferred (hosted trigger)** |
| DK-4 | VM lifecycle (trusted local) | Warm VM per bundle hash local-only; fresh always | M1 VM-cost numbers; LLP 0009 constraints unchanged | LLP 0009 | **Decided 2026-07-01; gated leg landed 2026-07-02** — warm VM pool + verified per-invocation reset shipped behind the `dk4_*` leak suite (LLP 0009 §DK-4 as-built; numbers in LLP 0035 §After warm VM) |
| DK-5 | V8 twin timing | Conformance twin now (X2); defer until hosted work | none (strategic) | LLP 0009/0000 §Implementation order | **Decided 2026-07-02 — defer**, four named revisit triggers (X3 start; hosted/untrusted work; observed engine divergence; limits gap user-facing). LLP 0009 §Decision DK-5 |
| DK-6 | Cron DOM/DOW semantics | POSIX OR (match user expectation, breaking); keep AND and document loudly | none | LLP 0028 | **Decided 2026-07-02 — POSIX OR; landed with cron test-debt closure; ratified by Charlie same day, ledgered in LLP 0000** |
| DK-7 | Single source-of-truth schema | Rust types → generated JSON Schema consumed by JS/tools; hand-maintained schema repo; TS-first | none (blocks P3c) | new Decision LLP (0016/0020/0024 all block on it) | **Decided 2026-07-02 — Rust-first** ([LLP 0037](./0037-schema-source-of-truth.decision.md)); **P3(c) landed** — `schemars`-derived schemas at `schemas/`, drift gate `crates/snapback/tests/artifact_schemas_v0.rs`, codegen emit-time validation; P2 consumes `schemas/capability.manifest.schema.json` |
| DK-8 | MIT free-riding exposure | MIT eyes-open (recorded); MIT + trademark policy; FSL-style restriction (conflicts with LLP 0000 "truly open") | none | new Decision LLP (R5) | Decided 2026-07-01 — MIT eyes-open (LLP 0033) |
| DK-9 | Client local-store mandate | Store-agnostic interface, SQLite reference impl; mandated SQLite everywhere | none (cheap now) | LLP 0008 §Local Store | **Decided 2026-07-02 — store-agnostic interface, SQLite reference impl** (LLP 0008 §Decision DK-9) |
| DK-10 | Adapter live-push architecture | Adapter owns the live subscription; separate live-provider seam beside the boundary | prototype in P5 | LLP 0021/0029 | **Decided 2026-07-02 — adapter-owned live push** (proved by the LLP 0034 D1/C1 implementation; single- and multi-query modes; `store.mjs` dead; the P5 close-out — generic `@snapback/contract` defaults and the `contract-live.mjs` acceptance, LLP 0029 G2 — re-landed 2026-07-03, ENG-22680) |

## Test-debt register

Every row closes with a test or a recorded won't-test rationale. (Rows
marked → are already scheduled by a step above.) Rows added during
execution carry a blocker/advisory tier, so late discoveries do not
silently grow the acceptance gate.

- Calendar cron: parser, `next_calendar_nominal_after`, civil-date math,
  DOM/DOW semantics, and the unsatisfiable-expression scan bound. **Closed
  2026-07-02 with DK-6:** `crates/snapback/src/cron.rs` gained an in-file unit-test module
  (parser grammar, DOM/DOW OR matrix, month-boundary and leap-day
  `next_calendar_nominal_after`, civil-date round-trips); the ~527k-iteration
  minute scan is now a day-stepping scan bounded at 3,000 days, and an
  unsatisfiable expression (Feb 30) is rejected at validation as
  `SNAPBACK_CRON_UNSATISFIABLE_EXPRESSION`, with a termination test.
- Ibex action → Ibex mutation nesting, and multi-host-call actions →
  S5.D1.
- Post-commit notify failure surfacing → S5.D4.
- WS send-failure/drain loss → S5.D5; WS text-protocol ephemeral messages
  (only HTTP publish is covered today).
- Ungated legacy `/admin/*` on all binds → S1 (becomes the gated test).
- Outbox growth under a never-draining subscriber → L1; subscription reap →
  L2; `_snapback_changes` growth and resume-below-floor → L3.
- `resume_live` hijack/ownership → S2; WS publish spoofing → S3.
- Schema evolution: `ALTER TABLE ADD COLUMN` against existing data
  (`crates/snapback/src/storage.rs:817-857`) — no test exercises additive migration on a
  populated DB.
- Seed with duplicate `_id`s; function-manifest reload while subscriptions
  exist.
- CORS middleware behavior (`crates/snapback/src/server.rs:278-320`).
- Cron retry: `CronRetryMode::Backoff` parses but is unimplemented
  [confirmed] — and no mode has retry logic today (`NextTick` has no
  explicit handling to match), so retry semantics are net-new. **Closed
  2026-07-02 (reject half):** manifest validation now rejects `retry:
  backoff` fail-closed as `SNAPBACK_CRON_RETRY_MODE_UNIMPLEMENTED`, with a
  test asserting the diagnostic and that the job is never scheduled; actual
  retry logic stays net-new work for whichever job first needs it.
- Cron tick-machinery error path (S5.D11): the recording seam and counter
  are tested on the happy path, but forcing `tick_cron`'s own claim/persist
  failure needs storage fault injection that does not exist yet. **Won't-test
  for now** — revisit if a storage fault-injection harness lands (would also
  serve L3/L5). The recording wiring is one line, verified by inspection.
- Perf regression floor → M1 smoke lane.
- Codegen: `tsc` over generated output, regen-diff staleness, JS-handler
  result typing → P3. ~~**Blocker for P3(a):** codegen keys handler-source
  hashes by *absolute path*~~ — stale on revalidation: the LLP 0034 review
  fix 4 had already made hashing manifest-relative. **Closed 2026-07-02 by
  P3** (all three gates in CI; the tsc gate proven against the injected
  S5.D2 bug).
- Client: multiplexed subscriptions, reconnect/resume, parse-before-ok →
  S5.D3/S5.D7/P4. **Closed 2026-07-02**: S5.D3/S5.D7 landed 07-01; the
  multiplex/reconnect rows are covered by the LLP 0034 D1/D2 regression
  suites plus P4's `regression-multiplexed-lanes`.

## Cross-cutting cleanups (opportunistic, low priority)

Fold into whichever step touches the file; do not schedule independently:
`now_millis` duplicated six times across modules; the near-duplicate
120-line step loops in `execute_mutation` vs `commit_buffered_writes`
(`crates/snapback/src/storage.rs:423-559`, `561-675`); the two parallel read-capture
implementations that must stay in sync (`crates/snapback/src/live_matcher.rs:12-84` vs
`crates/snapback/src/runtime.rs:436-491` — E3/E4 should unify them per LLP 0020's one
extractor); `eval_expr` vs `eval_action_expr`; identical
`entry_key_for_publish`/`entry_key_for_delete`; the
`*mut LocalSnapback`/`*const LocalDatabase` aliasing in the action host
(L7 kept the raw-pointer pattern — `DbRead::LiveRaw` — but now derives the
db pointer from the same provenance root as the `*mut`, per this arc's
review; retiring the pattern outright remains open); per-invocation
process-global host install and the `"*"` fetch
grant under `SNAPBACK_OUTBOUND_ACTIONS` (`crates/snapback/src/runtime.rs:189-193`,
`690-709` — revisit with X2); linear function-manifest lookup per invocation
(`crates/snapback/src/manifest.rs:204-208`); O(n²) read-dep dedup (`crates/snapback/src/runtime.rs:493-497`);
per-change plan re-deserialization in the matcher (`crates/snapback/src/live_matcher.rs:193`).

## Sequencing, dependencies, and sizing

| Phase | Depends on | Size | Parallel with |
| --- | --- | --- | --- |
| 0 Corpus truth | — | S (days) | 1 |
| 1 Safety floor | — | S–M | 0 |
| 2 Semantics | 1 (S5.D1 first); E4 on M1 | M | 3 (early), 5 |
| 3 Lifecycle | 1 | M (L1–L5) + M (L6–L8 arc) | 2, 5 |
| 4 Measurement | L1–L5 | M | L6–L8 (before/after) |
| 5 Product boundary | 1; P4 wants S5.D3/D7; P6 wants S4 | L | 2, 3 |
| 6 Strategic | X1/X2 anytime; X3 after X1/X2/P6; X5 after L5/L8 | M–L | 4, 5 |

Intermediate milestones, so partial completion is a legible state:

- **Milestone A — safe core:** Phases 0–1 complete. Corpus honest, live
  holes closed, defects regression-tested.
- **Milestone B — honest, bounded core:** Phases 2–3 complete. Semantics
  match docs; no unbounded state; idle is idle.
- **Milestone C — product boundary:** P1–P8 complete. The next demo builds
  on product packages only.

Guardrails while executing:

- **Do not start new demos before P5 lands** — each one hand-rolls the same
  live-push glue (five diaries of evidence). *(Satisfied: P5 landed — the
  next demo builds on the packaged adapter's live push and must report a
  lower glue count than Diary 0008's, per acceptance #6.)*
- **Do not port to Cloudflare before X1 and X2** — the version-allocator and
  runtime-conformance answers change what gets ported.
- **Do not pin further wire-protocol surface (LLP 0012 extensions) before
  DK-2/DK-3 are decided.** *(Satisfied 2026-07-02: DK-3 decided 07-01, DK-2
  decided 07-02 — P4 may pin protocol surface within their recorded
  constraints.)*
- Land doc updates in the same commit as the code they describe (`AGENTS.md`
  rule); run `ref-check --verbose` and, once P3 exists, the artifact gates
  on every step.

## Program acceptance

**Status 2026-07-02 (record re-landed 2026-07-03, ENG-22680):** properties
1–5 hold (Phases 0–5 complete; every docket row ledgered; the gating
Phase 6 steps X1, X2's decision, X4, and X5 landed — X3 is
scheduled-not-gating per its own step). What remains for full program
acceptance: property 6's final leg (the *next* demo diary's glue inventory
reporting a lower count than Diary 0008's — a future demo event by
construction) and property 7's three still-open test-debt rows (additive
`ALTER TABLE` migration on a populated DB; seed with duplicate `_id`s +
function-manifest reload under live subscriptions; CORS middleware
behavior), each of which needs a test or a recorded won't-test rationale.

The program is complete when the seven end-state properties hold, checked
concretely as:

1. R1–R6 landed; `ref-check` green; ledger current.
2. The 0031 route-registry test enumerates every operation and passes on
   loopback and non-loopback binds.
3. LLP 0003/0004/0007's described semantics each cite a passing test by
   name; capability manifests are server-derived (P2).
4. L1–L5 regression tests pass; the idle-instance test observes zero
   periodic writes.
5. The M1 Research LLP exists with M1's named numbers; every docket row
   (DK-1–DK-10) is ledgered — decided, or explicitly deferred with a named
   revisit trigger — with evidence attached where a gate names it; the
   gating Phase 6 steps (X1, X2's decision, X4, X5) have landed.
6. P1–P8 done-whens hold; the next demo diary's glue inventory reports a
   lower count than Diary 0008's.
7. The test-debt register has no open rows without a recorded rationale.

## 2026-08-04 Wave 3 registry introductions

- `agent_safe_storage_v1` is registered at `Experimental` maturity as the
  LLP 0162 `agentSafe.v1` extension/component-fact vocabulary, not as the
  `AgentSafeV1` core aggregate. Its positive target predicate is false and the
  guide row remains a GAP; this board entry records vocabulary reservation,
  not publication.
- `agent_safe_derived_deployment_fork_v1` is separately registered at
  `Experimental` maturity for LLP 0158's additive derived-deployment tuple.
  Its positive target predicate is false and the complete public tuple stays
  `Missing`; registration neither inherits storage nor in-app branch support.

## Open questions

- Diary erratum policy (R3) — immutable-plus-footnote is recommended but
  unratified.
- Whether the M1 harness should live in `tests/`, `benches/`, or a dedicated
  crate once packaging (P6) reshapes the workspace.
- Whether X2's "decide DK-5, build only if 'now'" shape is right, or the
  conformance twin should gate this program unconditionally. (Ratification
  authority and X3's classification, formerly open here, are now written
  into R1 and X3.)

## Status

Accepted 2026-07-01, ratified by Charlie after the LLP 0005 loop ran: a
GPT-5/Codex review and a Claude-family review (which independently
re-verified the registers) are in [`llp/reviews/`](./reviews/), and the
accepted revision applies both. The plan is a living execution document:
update the registers, docket statuses, and checklists in place as phases
complete, and ledger phase-boundary ratifications in LLP 0000. Its registers
supersede the conversation that produced them; if a citation drifts, fix it
here.
