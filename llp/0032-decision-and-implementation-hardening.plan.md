# LLP 0032: Decision and Implementation Hardening Program

**Type:** Plan
**Status:** Accepted
**Systems:** Project, Runtime, Storage, Sync, Realtime, Security, Auth, API, Client integration, Contract/Exact, Cron, Ephemeral state, Tooling, Packaging, Testing, Developer experience
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-01
**Revised:** 2026-07-01 (accepted by Charlie after the two-family review loop; earlier same day: revision applying the GPT-5 and Claude-family reviews — S0/R7 fast lanes, R1 ratification split, docket status column and full acceptance coverage, register corrections from independent re-verification)
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
core under `src/` and `tests/`; the JS estate under `demos/_kit/`,
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
  only `/_snapback/*` (`src/server.rs:48-76` vs `src/admin.rs:232-261`)
  [confirmed]. Do not wait for the full 0031 program: gate these four
  handlers behind the same `authorize()` policy as their `/_snapback/*`
  twins now. (There is no route middleware today — gating is per-handler
  `authorize()` calls in the admin handlers — so this is adding four calls,
  not widening a layer.) **Done when:** unauthenticated `POST /admin/reset`
  fails closed on loopback and on non-loopback with a token set, with a
  regression test that stays green through S1's alias retirement.
  **Landed 2026-07-01** — the four alias handlers call the shared
  `authorize()` write gate; `s0_*` tests in `tests/admin_v0.rs` cover
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
  with S0's fail-closed test still green.
- **S2 — Subscription ownership.** Subscription ids are sequential (`sub_1`,
  `sub_2`, …) and `resume_live` performs no ownership check, so any caller
  can re-point another subscription's stream to its own connection
  (`src/local.rs:433-434`, `454-514`) [confirmed]. Make ids unguessable and
  bind resume (and any future per-subscription op) to the owning
  connection/principal. **Done when:** a hijack test fails closed with a
  structured diagnostic. **Landed 2026-07-01** — ids are UUIDv7 bearer
  tokens; `resume_live` binds to the subscribing principal
  (`SNAPBACK_LIVE_RESUME_OWNERSHIP`); tests `s2_subscription_ids_are_unguessable`,
  `s2_resume_live_fails_closed_for_a_different_principal`.
- **S3 — WebSocket sender binding.** WS `ephemeral_publish` frames carry a
  client-chosen `connection_id` that is never checked against the socket's
  own connection (`src/server.rs:474-534`) [confirmed]. Bind frames to the
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

### Confirmed defect register

Each fix lands with a failing-then-passing test named for the step id.

- **S5.D1 — Nested Ibex re-entry nulls the host-call context** [analysis].
  `run_ibex_handler_with_context` sets a thread-local pointer and
  unconditionally nulls it after eval (`src/runtime.rs:518-524`). An Ibex
  *action* whose `ctx.runMutation` targets an Ibex *mutation* re-enters, and
  the inner call's cleanup strands the outer action — any later host call
  fails with `SNAPBACK_HANDLER_HOST_CALL_WITHOUT_CONTEXT`. The only existing
  nesting test ends with a host-plan mutation, so the path is untested
  (`tests/local_v0.rs:888-904`, `2018-2037`). Fix: save/restore semantics
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
  after the mutation committed (`src/local.rs:411-412`); a live-query re-run
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
- **S5.D5 — WS drain-then-send loses messages on send failure** [analysis].
  Messages are drained from the outbox under the lock, then written to the
  socket; a send error discards the failing message and everything drained
  after it (`src/server.rs:436-446`) — and the loop then breaks into
  `disconnect`, which deletes the whole outbox, so requeue-on-failure is
  meaningless unless the outbox survives socket close. Fix: drain-after-ack
  or requeue-on-failure — pick the one consistent with the L1
  bounded-outbox design *and* P4's reconnect/resume design; decide outbox
  survival across disconnect together with P4.
- **S5.D6 — Ephemeral rate-bucket leak on disconnect** [confirmed].
  `disconnect` removes outboxes and subscribers but never `rate_buckets`
  keyed by `(ConnectionId, collection)` (`src/ephemeral.rs:832-876`).
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
  `finished_at_ms = claim.started_at_ms` (`src/local.rs:784-786`). Already
  registered as [LLP 0029](./0029-all-aboard-gap-closure.plan.md) G6 —
  schedule it here, semantics owned there. **Landed 2026-07-01** — duration is
  measured from real wall-clock around the run (finished = logical start +
  elapsed); test `s5_d8_cron_run_records_nonzero_duration`.
- **S5.D9 — Silent empty result on non-array Ibex query returns**
  [confirmed]. `as_array().cloned().unwrap_or_default()`
  (`src/runtime.rs:125`) converts a handler returning a non-array into
  `rows: []` with no diagnostic — a silent-drop-class violation of the
  corpus's own cardinal rule. Fail with a structured
  `SNAPBACK_HANDLER_RESULT_INVALID`-family diagnostic. **Landed 2026-07-01** —
  `invoke_ibex_query_with_reads` fails closed on a non-array result; test
  `s5_d9_non_array_query_result_fails_closed`.
- **S5.D10 — No 5xx class** [confirmed]. Every unrecognized error, including
  internal SQLite failures, maps to HTTP 400 (`src/server.rs:688-699`).
  Introduce an internal-error class so clients and agents can distinguish
  "you erred" from "the server erred". **Landed 2026-07-01** —
  `status_for_diagnostic_code` maps `SNAPBACK_SQLITE_ERROR`/
  `SNAPBACK_INTERNAL_ERROR` to 500; test `s5_d10_internal_errors_map_to_5xx`.
- **S5.D11 — Cron ticker swallows its own errors** [confirmed].
  `let _ = snapback.tick_cron(...)` every second (`src/server.rs:273`);
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

## Phase 2 — Execution-semantics honesty

The ratified execution/write boundary (LLP 0003 §Execution and Write
Semantics; restated in LLP 0004 and LLP 0007) claims snapshot reads,
read-your-writes-consistent buffered `ctx.db`, and commit-time read-set
validation. The implementation diverges [confirmed]:

- No snapshot exists: handler reads are bare autocommit reads on the live
  connection (`src/runtime.rs:270-331`), and consistency comes from the
  global mutex, not a pinned snapshot.
- No read-your-writes: buffered writes are invisible to later reads in the
  same handler — insert-then-query misses the insert; `patch` after a
  buffered insert reports `existed: false`.
- Validation is two-tier: Ibex handlers get automatic capture; host-plan
  mutations capture nothing and validate only the *client-supplied* read set
  (`src/storage.rs:557`).
- Query-shaped dependencies validate at whole-table granularity via
  `MAX(version) FROM _snapback_changes WHERE table_name = ?`
  (`src/storage.rs:1015-1103`) — effectively table-level locking with
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
  "pending M1".
- **E2 — Read-your-writes overlay.** `ctx.db` reads consult the buffered
  write set layered over storage (`src/runtime.rs:270-331`). **Done when:**
  insert-then-query sees the row; patch-after-buffered-insert reports
  `existed: true`; delete-then-get misses.
- **E3 — Host-plan read capture.** Host-plan mutations capture reads
  server-side like Ibex handlers do (`src/storage.rs:423-559`), ending the
  trust-the-client validation asymmetry. **Done when:** a host-plan
  conflict test passes with no client-supplied `read_set`.
- **E4 — Predicate-granularity validation.** Reuse the matcher's boundary
  facts (LLP 0020 Phase 3's "one extractor, three consumers" already names
  this) so disjoint-row writes to a queried table stop conflicting every
  Ibex mutation. Gated on M1's validation-cost measurement — if the numbers
  say table-granularity is fine at target scale, record that in DK-1's
  outcome instead and keep the honest docs. Note Row/MissingRow captured
  reads already validate per-row; the whole-table check is specifically the
  Query-kind arm — and MissingRow mixes the table version into its check too
  (`src/storage.rs:1054-1055`), so point-miss reads inherit table-granularity
  conflicts; include them in the narrowing. **Done when:** the
  disjoint-write no-conflict test passes (or DK-1 records the measured
  accept).
- **E5 — `indexed_by` becomes real or goes away.** The query builder accepts
  and stores index hints but never uses them (`src/storage.rs:895-985`)
  [confirmed]; at minimum, validate that a declared index exists and emit a
  diagnostic when it doesn't. **Done when:** unknown-index queries fail
  closed at codegen or load time.
- **E6 — Document the frozen per-invocation clock.** `ctx.runtime.now()` is
  frozen at handler start (`src/runtime.rs:237,333`) — correct for replay
  determinism, surprising for long handlers. Actions freeze it to the run's
  `due_at_ms` (`src/runtime.rs:257`) — not even invocation wall-clock. One
  paragraph in LLP 0004 covering both.

**Phase 2 Done when:** the semantics described in LLP 0003/0004/0007 §§ are
the semantics `tests/local_v0.rs` demonstrates, and DK-1's outcome is
ledgered. E4 closes by test or by DK-1's measured accept; because its gate
is M1 (which runs after L1–L5), Phase 2's last leg lands after Phase 3's
L1–L5 by construction.

## Phase 3 — Lifecycle and resource hardening

Ordered by blast radius. L1–L5 are independent of design decisions; L6–L8
change the concurrency architecture and should land as one reviewed arc.

- **L1 — Bound the durable outboxes.** The per-connection durable `VecDeque`
  is unbounded — the 1,024 cap applies only to the coalesced ephemeral map
  (`src/ephemeral.rs:568-570`, `886-892`) [confirmed]. A subscriber that
  never drains accumulates full query-result payloads per matching commit,
  forever. The `resync` deque in the same queue is unbounded too — bound
  both; overflow converts to a `ResyncRequired`-class signal (never a
  silent drop — LLP 0008 §Realtime Delivery). **Done when:** an overflow
  test observes the resync signal and bounded memory.
- **L2 — Connection/subscription reaping.** No TTL or heartbeat exists;
  abandoned connections and their subscriptions live forever
  (`src/local.rs:169`) [confirmed]. (WS-attached connections do reap on
  socket close; the leak is HTTP-polling connections that vanish without
  calling disconnect.) Add heartbeat/expiry with counters.
  **Done when:** an abandoned-connection test shows reap, and counters
  appear in `/inspect`.
- **L3 — Change-journal retention.** `_snapback_changes` grows without bound
  (pruned only by `reset`) and its per-query
  `MAX(version) WHERE table_name = ?` check is a full scan — the only index
  is `(version, id)` (`src/storage.rs:705-716`, `1156-1172`) [confirmed].
  Implement LLP 0008 §Retention (version-and-time-bounded, forced resnapshot
  below the floor), add the `(table_name, version)` index, and a prune job.
  **Done when:** a growth test bounds journal size; resume-below-floor
  forces resnapshot; the scan uses the index (checked via `EXPLAIN QUERY
  PLAN` in a test).
- **L4 — Incremental ephemeral counters.** `refresh_counts` recomputes
  diagnostics over all rooms, entries, and outboxes after every publish,
  subscribe, delete, and disconnect (`src/ephemeral.rs:1212-1249`)
  [confirmed] — quadratic at cursor rates. Maintain counters incrementally;
  keep the full recompute as a debug-assert parity check. **Done when:**
  per-op cost is O(1) and the parity test passes.
- **L5 — Idle means idle.** The cron ticker takes the global lock and
  persists the full cron-state JSON to SQLite every second even with no due
  jobs (`src/server.rs:267-276`, `src/local.rs:700-707`) [confirmed] — at
  odds with scale-to-zero and with
  [LLP 0028](./0028-cron-scheduled-execution.rfc.md)'s own honesty about
  idle cost. Persist only on state change; skip work when nothing is due or
  armed. **Done when:** an idle instance performs zero periodic writes
  (asserted by watching the DB file/WAL in a test) and the 1s tick does no
  lock acquisition when no jobs are armed. **needs owner doc update**
  (LLP 0028 §local scheduler).
- **L6 — Reader pool.** LLP 0003 §Database Model designed a WAL reader pool;
  the implementation serializes even read-only queries on the single
  `tokio::Mutex<LocalSnapback>` (`src/server.rs:23`, `378`) [confirmed].
  Give queries read connections with snapshot-pinned version reads (the
  current version-after-rows read at `src/storage.rs:334-337` is safe only
  under the mutex — pin inside a read transaction instead). **Done when:**
  concurrent reads proceed during a long write in a test, and the
  version/rows consistency test passes.
- **L7 — Blocking work off the async workers.** Hermes eval and SQLite run
  synchronously inside async handlers with no `spawn_blocking` anywhere
  [confirmed]. Move blocking sections onto blocking threads (or a dedicated
  runtime thread for the VM, which S5.D1's context work may want anyway).
  **Done when:** no `ex_hermes_eval` or rusqlite call executes on a tokio
  worker (enforced by a debug assertion or lint note), and the busy-loop
  handler test (`tests/local_v0.rs:1770-1790`) no longer stalls *other*
  endpoints. Full preemption/limits remain owned by
  [LLP 0009](./0009-code-execution-security.rfc.md) — this step is
  scheduling hygiene, not a security claim.
- **L8 — Event-driven delivery.** The WS path polls each connection's outbox
  every 25ms under the global lock (`src/server.rs:419`, `437-446`)
  [confirmed] — a ~25ms latency floor and idle lock traffic linear in
  connections. Replace with wakeup notification (the change-notification
  seam LLP 0008 already declares swappable); keep poll as a fallback lane.
  **Done when:** idle connections generate zero periodic lock traffic and a
  latency test shows sub-poll-interval delivery.
- **L9 — Ephemeral room authority off the global mutex.** Owned by
  [LLP 0026](./0026-ephemeral-backend-abstraction.plan.md); this plan only
  sequences it (after L4, alongside L6–L8). Also close the scope-epoch
  dead-code finding (this review's — 0026 does not yet record it; add it to
  0026's gap list as part of this step): epochs are allocated but never
  advanced, so the `AuthRevoked`/`AuthChanged`/`Restarted` machinery is
  unreachable [confirmed]; wire epoch advancement to the events that own it
  or remove the dead variants until they're real. **Done when:** the
  finding is recorded in 0026 and the epoch machinery is either live (with
  a revocation test) or removed.

**Phase 3 Done when:** L1–L5 closed; L6–L8 landed as a reviewed arc with the
M1 harness (Phase 4) run before/after to quantify the win; L9 landed per
LLP 0026's own acceptance — sequenced here, owned there.

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
  + eval overhead — `src/runtime.rs:515`, `183-204`); matcher cost per
  commit; read-set validation cost; spurious-conflict rate under concurrent
  disjoint-row writers at table granularity (the number DK-1/E4 actually
  turns on); ephemeral publish cost at 20–60 Hz.
  **Done when:** results are committed as a Research LLP with methodology,
  and CI runs a smoke-scale variant to catch order-of-magnitude regressions.
- **M2 — Decide DK-4 (VM lifecycle) on M1 evidence.** Fresh-VM-per-invocation
  is the dominant compute cost, multiplied by fan-out re-queries. The
  candidate: warm VM per bundle hash for the **trusted local** target only,
  with fresh-per-invocation retained for hosted/untrusted (LLP 0009's five
  pooling proof obligations unchanged — this is not the hosted pooling
  question). **Done when:** DK-4 ledgered with numbers attached.
- **M3 — Decide DK-3 (delta shape and read lane) on M1 + LLP 0022 evidence.**
  Whole-document `live_replace` per affected subscription per commit
  (`src/local.rs:887-948`) versus op-log deltas, and the stateful-WS-only
  read path versus an Electric-style cacheable HTTP read lane — 0022 calls
  the latter "the most actionable single idea" and it is hard to retrofit
  after LLP 0012's capability classes and the wire protocol harden. This
  decision must be made deliberately even if the answer is "replace-only and
  WS-only for v1, revisit at N subscribers." **Done when:** DK-3 ledgered;
  LLP 0008/0012 revised to record the outcome and its revisit trigger.

## Phase 5 — Product boundary and DX

The review's strongest product finding: the flagship realtime never reaches
the flagship Contract surface, and the codegen pipeline — the component the
agent-first philosophy leans on hardest — is the least fed-back component in
the repo. This phase makes the JS estate product-grade. It can run in
parallel with Phase 3.

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
  admin-ui bindings are generated by the same package.
- **P2 — Server-derived capability manifest.** `capability.manifest.json` is
  a hardcoded literal in codegen describing what the *Rust server* supports
  (`demos/_kit/codegen.mjs:341-388`) while the server independently computes
  its own report for `/inspect` — two sources of truth [confirmed]. Make the
  server (or a shared generated schema, per DK-7) the single source; codegen
  embeds or fetches it. **Done when:** the JS literal is deleted and a
  parity test compares generated manifest to live `/inspect`.
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
  open question (LLP 0016, 0020, 0024 all block on it); recommendation:
  Rust types are the source of truth, `schemars`-style JSON Schema is
  generated from them, JS validates against it. Also close the typing gaps:
  JS-handler result types are guessed from the first declared read table and
  `v.json()` becomes `unknown` (`demos/_kit/codegen.mjs:145-146`, `807-808`)
  — require declared result validators for JS handlers or mark the type
  honestly. The gates may land as plain repo scripts in CI before P6's
  workspaces exist. **Done when:** all three gates run in CI and the S5.D2
  bug class cannot land; DK-7 is ledgered. **needs owner doc update**
  (LLP 0012 §Versioning).
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
  non-destructive until acked.
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
  banner from R4 flips to "built" for the shipped verbs.
- **P7 — Ibex bring-up doctor.** Three diaries hit Hermes/dyld bring-up
  failures in three different shapes (build env, spawned-process dyld,
  cargo-can't-compile), and `cargo test` still requires a manual
  `DYLD_FRAMEWORK_PATH` on macOS. Fold the known failure shapes into a
  `doctor`-grade structured check (extend `scripts/bootstrap-ibex-runtime`
  or add a host-op): detect frameworks, paths, env, and print
  diagnostic-coded remediation. **Done when:** a fresh clone on macOS goes
  red→green through doctor guidance alone, and a CI lane exercises the
  doctor.
- **P8 — One admin client, typed inspect.** The embedded console and the
  Contract admin-ui duplicate client and view-model logic, which is where
  the diary-0005 casing bug lived; `/inspect` still mixes camelCase,
  snake_case, and PascalCase in one payload [confirmed]. Extract the shared
  admin client (LLP 0017 open question), normalize or typed-project the
  inspect payload (pairs with 0031 D3's trimmed public inspect). **Done
  when:** both consoles consume one client package and a typed inspect
  schema; a casing-consistency test exists.

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
  protocol pins.
- **X2 — Decide DK-5; if "now", build the V8 conformance twin.** The
  runtime-conformance floor is ratified but `async_handler_completion:
  Available` is a hardcoded constant (`src/runtime.rs:76`), the canonical
  engine cannot enforce CPU/wall-clock limits (self-declared Missing,
  `src/manifest.rs:745-753` — the vendored watchdog hook is cooperative and
  cannot preempt a busy loop), and a `while(true){}` handler wedges the
  whole process while holding the global lock — the hosted story hangs on a
  V8 path with a Valet history of designed-never-built. Candidate: the
  minimal second runtime passing the LLP 0009 conformance floor and the
  existing Ibex test suite behind a feature flag — conformance only, not
  hosted isolation. **The DK-5 decision gates this program; the build lands
  per its outcome.** **Done when:** DK-5 is ledgered; if "twin now", the
  same `tests/local_v0.rs` handler tests pass on both engines in CI and the
  capability report's enforced/advisory limit fields are *computed*, not
  asserted; if "defer", the revisit trigger is named in LLP 0009.
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
  records the chosen stance and DK-9 is ledgered.
- **X5 — Idle-cost audit per target.** After L5/L8, measure and record what
  an idle local instance actually does (target: nothing periodic), and
  write the per-target idle-cost expectations LLP 0000 §Multi-target
  deployment demands. **Done when:** the numbers are in the M1 Research LLP
  and 0000's claim links to them.

---

## Decision docket

Decisions this program forces. Each lands as a revision to its owner doc
(new Decision LLP only where noted), gets ledgered in LLP 0000, and cites
its gating evidence. **Program acceptance requires every row ledgered —
decided, or explicitly deferred with a named revisit trigger.** Update the
Status column in place as rows close.

| Id | Decision | Options (recommendation first) | Gate | Lands in | Status |
| --- | --- | --- | --- | --- | --- |
| DK-1 | Read-set validation semantics | Implement-up staged (E2→E3→E4); or honest-downgrade (ratify table-granularity serialized writes as v0 semantics) — R7's doc-honesty patch lands first either way | E1; E4 gated on M1 cost numbers | LLP 0003/0004/0007 | Open — E1 decides; E4 leg blocked on M1 |
| DK-2 | Commit-version graduation shape | Postgres sequence + logical-decoding feed; per-app shards (LLP 0018); HLC ordering | X1 design note | LLP 0007/0014 (+0012 wire impact) | Open — X1 |
| DK-3 | Delta shape + read lane | Deliberate v1 pin of replace-only/WS with named revisit trigger; op-log deltas; cacheable HTTP read lane | M1 + LLP 0022 | LLP 0008/0012 | Blocked on M1 |
| DK-4 | VM lifecycle (trusted local) | Warm VM per bundle hash local-only; fresh always | M1 VM-cost numbers; LLP 0009 constraints unchanged | LLP 0009 | Blocked on M1 |
| DK-5 | V8 twin timing | Conformance twin now (X2); defer until hosted work | none (strategic) | LLP 0009/0000 §Implementation order | Open — X2 decides |
| DK-6 | Cron DOM/DOW semantics | POSIX OR (match user expectation, breaking); keep AND and document loudly | none | LLP 0028 | Open — closes with the cron test-debt work |
| DK-7 | Single source-of-truth schema | Rust types → generated JSON Schema consumed by JS/tools; hand-maintained schema repo; TS-first | none (blocks P3c) | new Decision LLP (0016/0020/0024 all block on it) | Open — blocks P3c |
| DK-8 | MIT free-riding exposure | MIT eyes-open (recorded); MIT + trademark policy; FSL-style restriction (conflicts with LLP 0000 "truly open") | none | new Decision LLP (R5) | Decided 2026-07-01 — MIT eyes-open (LLP 0033) |
| DK-9 | Client local-store mandate | Store-agnostic interface, SQLite reference impl; mandated SQLite everywhere | none (cheap now) | LLP 0008 §Local Store | Open — X4 |
| DK-10 | Adapter live-push architecture | Adapter owns the live subscription; separate live-provider seam beside the boundary | prototype in P5 | LLP 0021/0029 | Open — P5 prototype |

## Test-debt register

Every row closes with a test or a recorded won't-test rationale. (Rows
marked → are already scheduled by a step above.) Rows added during
execution carry a blocker/advisory tier, so late discoveries do not
silently grow the acceptance gate.

- Calendar cron: parser, `next_calendar_nominal_after`, civil-date math,
  DOM/DOW semantics — `src/cron.rs` has zero in-file tests today; also the
  unsatisfiable-expression ~527k-iteration scan (`src/cron.rs:689-699`)
  needs a bound test. Partly → DK-6.
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
  (`src/storage.rs:817-857`) — no test exercises additive migration on a
  populated DB.
- Seed with duplicate `_id`s; function-manifest reload while subscriptions
  exist.
- CORS middleware behavior (`src/server.rs:278-320`).
- Cron retry: `CronRetryMode::Backoff` parses but is unimplemented
  [confirmed] — and no mode has retry logic today (`NextTick` has no
  explicit handling to match), so retry semantics are net-new. Implement or
  reject at codegen (fail-closed rule), then test.
- Cron tick-machinery error path (S5.D11): the recording seam and counter
  are tested on the happy path, but forcing `tick_cron`'s own claim/persist
  failure needs storage fault injection that does not exist yet. **Won't-test
  for now** — revisit if a storage fault-injection harness lands (would also
  serve L3/L5). The recording wiring is one line, verified by inspection.
- Perf regression floor → M1 smoke lane.
- Codegen: `tsc` over generated output, regen-diff staleness, JS-handler
  result typing → P3. **Blocker for P3(a):** codegen keys handler-source
  hashes by *absolute path* (`loadHandlerSource`, `demos/_kit/codegen.mjs`
  ~464 → `bundleHash`/`inputsHash` at ~305-312), so committed hashes drift
  per checkout and the regen-diff gate cannot pass until hashing is made
  path-relative (surfaced by the S5.D2 regen, 2026-07-01).
- Client: multiplexed subscriptions, reconnect/resume, parse-before-ok →
  S5.D3/S5.D7/P4.

## Cross-cutting cleanups (opportunistic, low priority)

Fold into whichever step touches the file; do not schedule independently:
`now_millis` duplicated six times across modules; the near-duplicate
120-line step loops in `execute_mutation` vs `commit_buffered_writes`
(`src/storage.rs:423-559`, `561-675`); the two parallel read-capture
implementations that must stay in sync (`src/live_matcher.rs:12-84` vs
`src/runtime.rs:436-491` — E3/E4 should unify them per LLP 0020's one
extractor); `eval_expr` vs `eval_action_expr`; identical
`entry_key_for_publish`/`entry_key_for_delete`; the
`*mut LocalSnapback`/`*const LocalDatabase` aliasing in the action host
(`src/local.rs:190-203`, `809-816` — L7's threading work is the natural
moment); per-invocation process-global host install and the `"*"` fetch
grant under `SNAPBACK_OUTBOUND_ACTIONS` (`src/runtime.rs:189-193`,
`690-709` — revisit with X2); linear function-manifest lookup per invocation
(`src/manifest.rs:204-208`); O(n²) read-dep dedup (`src/runtime.rs:493-497`);
per-change plan re-deserialization in the matcher (`src/live_matcher.rs:193`).

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
  live-push glue (five diaries of evidence).
- **Do not port to Cloudflare before X1 and X2** — the version-allocator and
  runtime-conformance answers change what gets ported.
- **Do not pin further wire-protocol surface (LLP 0012 extensions) before
  DK-2/DK-3 are decided.**
- Land doc updates in the same commit as the code they describe (`AGENTS.md`
  rule); run `ref-check --verbose` and, once P3 exists, the artifact gates
  on every step.

## Program acceptance

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
