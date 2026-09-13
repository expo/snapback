# Stream fences are blocked on a flush-API refactor, and transcript settlement was misclassified

Status: Open — blocks the stream half of the split-phase migration
Created: 2026-08-21
Related: issues/shelved/20260821-authorized-effect-remedy-classification.md,
issues/shelved/20260821-durable-authority-to-effect-handoff-design.md, LLP 0076, LLP 0204

## Summary

The remedy classification listed two stream families as needing the split-phase reservation, both
at Medium confidence / INFERRED. Per-write-site analysis corrects both:

1. **Stream-transcript settlement: REFUTED.** It is host settlement under platform authority, not
   a caller-authorized effect. It needs **no fence**.
2. **Stream-attempt upsert: partly confirmed, but not implementable as-is.** The flush API cannot
   represent the caller/host branch split, so adding a guard now would fence the wrong writes.

Do not dispatch a stream fencing lane until the refactor below lands.

## Why transcript settlement is refuted

The implemented RFC says transcripts settle in reserved platform tables "under platform
authority", including final text and token accounting (LLP 0204). The accepted stream RFC
additionally requires transcript settlement on failure, cancellation, timeout and process death,
with no final value (LLP 0076). A caller-authority fence would therefore suppress settlements the
spec requires to happen precisely when the caller is gone.

The transcript row does fuse content and terminal bookkeeping (`final_text`, cause, initiator,
chunk count, token counts inserted together). Under the platform-authority rule that fusion is
correct and needs no schema split. What must be split is the **ordering**: commit the exact
terminal attempt durably, release caller/mode guards, then insert or repair the transcript as host
settlement.

## Why the attempt upsert cannot be fenced yet

`flush_stream_attempts_required` and `flush_stream_attempts_trusted` look like they separate the
caller and host paths. They do not: both call `dirty_snapshots(namespace)`, which returns **every**
dirty attempt for the instance. Consequences:

- a caller-backed start flush can include host terminal/cursor bookkeeping, or another session's
  dirty attempt;
- a trusted close/terminal flush can persist a not-yet-authorized caller start or cursor premark;
- **one reservation cannot authorize the mixed batch**;
- `upsert_stream_attempts` executes rows one at a time with no containing transaction, so a mixed
  batch can be partially durable.

The separation key must be **transition provenance, not terminal cause**:

- `CallerAuthorized` — fresh start, takeover, cursor premark, explicit authored settle/cancel.
- `ModeOnly` — the same transitions arriving from credential-free background or Dev authority.
- `HostSettlement` — counters, transport outcome, close, automatic terminalization, recovery,
  terminal adoption.

The automatic worker terminalization and the JS-authored settle currently enter the *same*
`settle_stream_attempt` function, and cause values cannot distinguish their authority. That
function must be split first.

## Separate defect: abandonment is not durably marked

**Nothing currently marks watchdog abandonment durably at the abandonment transition.** It locks
`commit_gate`, sets an in-memory `AtomicBool`, and cancels the room reservation. That is all.

A caller write can race it, because `flush_stream_attempts_required` takes `LocalSnapback` but
never takes `commit_gate`, and its last abandonment check happens before the SQL call. So
abandonment can set the flag after the final check and the stale caller snapshot still commits.

Worse, the timeout and worker-death legs do not themselves perform a durable flush. If the worker
never returns, **the database can remain nonterminal until process restart**, at which point
startup records `failed` rather than the watchdog's in-memory `timed_out`.

The existing watchdog test does not prove durability: its second runner shares the same
`SharedSnapback` and process-global registry and never reopens the database after the timeout.

Correct ordering: every caller/mode-backed stream write takes `commit_gate` at its final SQL cut;
abandonment either loses to a writer that owns the gate, or acquires it first and marks the
invocation abandoned so later caller writes refuse; only then may the host terminalizer CAS and
durably flush without caller or mode fencing.

## Implementation sequence

1. Split `settle_stream_attempt` by provenance, not cause.
2. Make the flush API select by provenance instead of flushing all dirty snapshots, and give
   `upsert_stream_attempts` a containing transaction.
3. Durably mark abandonment, and take `commit_gate` at the final SQL cut of every caller/mode
   write.
4. Only then add the split-phase reservation to the `CallerAuthorized` transitions, and the mode
   guard to the `ModeOnly` ones.

Riskiest item: step 3. Fencing a host-owned recovery flush against a retired session would strand
the stream non-terminal forever, which is worse than the unguarded write being fixed.

## Open ruling

If the author intends to override LLP 0204 and treat transcript content as caller-authorized, say
so explicitly — the analysis follows the implemented spec, which says the opposite.

## Provenance

Read-only codex analysis against `c87786c2d`. Full per-write-site table with file:line citations
appended below.

---

Analysis basis: checked-out `origin/main` at `c87786c2d3c105b36e3e3582fe17c1c34adcea8f`. No files were modified.

## Verdict

The old classifications need correction:

- **Stream-attempt upsert:** partly confirmed. New caller-requested attempt state needs the split-phase reservation plus mode guard, but transport settlement, counters, terminalization, and recovery are host-owned. The current all-dirty batching makes those branches impossible to fence correctly without first refactoring the flush API.
- **Stream-transcript settlement:** **refuted.** The governing implemented RFC says transcripts settle in reserved platform tables “under platform authority,” including final text and token accounting ([LLP 0204:723](llp/0204-app-external-surfaces.rfc.md:723), [LLP 0204:738](llp/0204-app-external-surfaces.rfc.md:738)). The accepted stream RFC also requires failure, cancellation, timeout, and process-death transcript settlement with no final value ([LLP 0076:277](llp/0076-bounded-streamed-actions.rfc.md:277)). Therefore transcript insertion is host settlement, not a new caller-authorized effect.

Here, “Both” means reserve session/authorization-stream and optional service authority outside `LocalSnapback`, then acquire the mode guard only at the SQL cut. Action-host writes additionally must participate in the action `commit_gate`; that gate is orthogonal to the three remedies.

## Per-write-site classification

| Durable site | Actual authority and exact branch | Remedy | Confidence |
|---|---|---|---|
| Output-stream attempt creation: `initialize_output_stream → flush_stream_attempts_required` ([server.rs:867](crates/snapback-server/src/server.rs:867), [server.rs:905](crates/snapback-server/src/server.rs:905)) | For `Session` or `ServicePrincipal`, the still-live invocation publication plus the new runner lease. For `RevalidatedPrincipal`/`System`, credential-free invocation/job authority plus global mode. Dev has no publication. Anonymous output binds a separately prepared connection act, but that act is discarded before the worker starts ([server.rs:27917](crates/snapback-server/src/server.rs:27917), [server.rs:27932](crates/snapback-server/src/server.rs:27932)). | **Both** for session/service. **Mode only** for credential-free background and Dev. Anonymous needs the additional ruling below; `AuthorizedEffectReservation` alone does not retain the exact connection grant. | High except anonymous, which is **INFERRED**. |
| `ctx.streamAttempt.start`, fresh attempt or live-runner takeover ([server.rs:2410](crates/snapback-server/src/server.rs:2410), [host_glue.rs:4227](crates/snapback-engine/src/runtime/host_glue.rs:4227)) | Caller invocation plus new/current runner lease. Branch by authority class: session/service versus credential-free `System`/`RevalidatedPrincipal`/Dev. | **Both** for session/service; **Mode only** for credential-free/Dev. | High. |
| `ctx.streamAttempt.start`, adoption of an already-terminal persisted row | No new lease or caller effect: `terminal.is_some()` produces `lease_held == false`; the rewrite merely adopts/normalizes an authoritative durable winner ([stream_attempt.rs:369](crates/snapback-sync/src/stream_attempt.rs:369), [stream_attempt.rs:428](crates/snapback-sync/src/stream_attempt.rs:428)). | **Neither**, or eliminate the redundant rewrite. Exact branch: `started.terminal.is_some() && !started.lease_held`. | High. |
| Upstream cursor write-ahead premark before HTTP ([server.rs:1735](crates/snapback-server/src/server.rs:1735), [server.rs:1749](crates/snapback-server/src/server.rs:1749)) | This is the durable handoff `H`: current caller/background invocation plus exact attempt/runner lease. It must commit before outbound bytes. | **Both** for session/service; **Mode only** for credential-free background/Dev. Release every guard before `send_string`/`call` at [server.rs:1771](crates/snapback-server/src/server.rs:1771). | High. |
| Cursor outcome and closure: `definitely_not_initiated`, `response_observed`, `open=false` ([server.rs:1040](crates/snapback-server/src/server.rs:1040), [server.rs:1778](crates/snapback-server/src/server.rs:1778), [server.rs:1841](crates/snapback-server/src/server.rs:1841)) | Host-observed settlement under the already-durable cursor premark/attempt. After `H`, caller liveness must not veto truthful outcome bookkeeping. | **Neither.** | High. |
| `progress_commits` counter dirtied after a nested mutation ([server.rs:1444](crates/snapback-server/src/server.rs:1444), [server.rs:1563](crates/snapback-server/src/server.rs:1563)) | The authority is the already-committed nested mutation plus the attempt/runner relation. The counter itself is host-owned retry-fencing evidence. | **Neither.** | High; the accepted RFC assigns fence-critical fields to the host record ([LLP 0076:509](llp/0076-bounded-streamed-actions.rfc.md:509)). |
| Durable `emitted_bytes`/`chunk_count` after `ctx.stream.emit` ([server.rs:2477](crates/snapback-server/src/server.rs:2477), [server.rs:2500](crates/snapback-server/src/server.rs:2500), [server.rs:2517](crates/snapback-server/src/server.rs:2517)) | The database row is bookkeeping for a live-room publication that has already occurred. It contains no chunk bytes. The ephemeral publication itself still needs its own caller-authority cut; fencing only the later counter cannot prevent an unauthorized chunk. | **Neither** for the upsert. Separately fix/verify the ephemeral publication authority. | Medium — **INFERRED**. Confirm with a ruling/test that logout after room publication but before counter persistence must not suppress the counter. |
| Explicit authored `ctx.streamAttempt.settle` ([host_glue.rs:4243](crates/snapback-engine/src/runtime/host_glue.rs:4243), [server.rs:2441](crates/snapback-server/src/server.rs:2441)) | A still-running handler requests a particular terminal cause under its runner lease. If caller authority retires first, that authored cause must lose and the trusted terminalizer must write the host-selected winner. | **Both** for session/service; **Mode only** for credential-free/Dev. | Medium — **INFERRED**. Confirm with an authored-`complete` versus logout race expecting the host `cancelled` winner. |
| Automatic completion/failure terminalization ([server.rs:2904](crates/snapback-server/src/server.rs:2904), [server.rs:2932](crates/snapback-server/src/server.rs:2932)) | Trusted runtime terminalizer under the exact invocation/runner lease, including normal completion, action failure, generation loss, authority loss, and timeout. This is not the JS-authored settle branch, despite calling the same method today. | **Neither.** Split it from `settle_stream_attempt`; do not route it through the caller-backed required flush. | High; the RFC explicitly separates authored and abandoned paths ([LLP 0076:491](llp/0076-bounded-streamed-actions.rfc.md:491)). |
| Explicit `/streams/{token}/cancel` attempt terminal ([server.rs:28089](crates/snapback-server/src/server.rs:28089), [server.rs:28103](crates/snapback-server/src/server.rs:28103)) | Direct initiating session/service caller; initiator equality alone does not keep a prepared session current through the terminal commit. Dev has only mode authority. | **Both** for session/service; **Mode only** for Dev. The target attempt upsert is the handoff `H`. | High. |
| Watchdog/worker-death terminal attempt ([server.rs:2982](crates/snapback-server/src/server.rs:2982), [server.rs:2998](crates/snapback-server/src/server.rs:2998), [server.rs:3034](crates/snapback-server/src/server.rs:3034)) | Host abandonment plus exact runner-to-attempt binding. `terminalize_invocation` only changes a nonterminal record held by that runner ([stream_attempt.rs:924](crates/snapback-sync/src/stream_attempt.rs:924), [stream_attempt.rs:936](crates/snapback-sync/src/stream_attempt.rs:936)). | **Neither.** It must not use the retired caller’s reservation or predecessor mode lease. | High. |
| Ask stream creation ([server.rs:25095](crates/snapback-server/src/server.rs:25095), [server.rs:25254](crates/snapback-server/src/server.rs:25254)) | Direct Ask caller. Ask runs under caller authority ([LLP 0204:468](llp/0204-app-external-surfaces.rfc.md:468), [LLP 0204:474](llp/0204-app-external-surfaces.rfc.md:474)). | **Both** for session/service; **Mode only** for Dev. Reserve after earlier work and immediately before the short attempt-start write. | High. |
| Ask terminal attempt upsert ([server.rs:25135](crates/snapback-server/src/server.rs:25135), [server.rs:25166](crates/snapback-server/src/server.rs:25166)) | Running attempt/runner plus the provider outcome. The unresolved per-provider-turn authorization affects whether a provider call may start, not whether its actual outcome may be recorded. | **Neither.** | High for settlement ownership; provider initiation remains governed by the separate handoff issue. |
| Startup orphan attempt reconciliation ([engine.rs:24894](crates/snapback-engine/src/local/engine.rs:24894), [engine.rs:24921](crates/snapback-engine/src/local/engine.rs:24921)) | Host recovery from the existence of a persisted nonterminal attempt before any new runner can start. It closes cursors and creates a `failed` terminal ([stream_attempt.rs:149](crates/snapback-types/src/stream_attempt.rs:149)). | **Neither.** | High. |
| Output-action transcript insert, including `final_text` ([server.rs:912](crates/snapback-server/src/server.rs:912), [server.rs:935](crates/snapback-server/src/server.rs:935), [server.rs:966](crates/snapback-server/src/server.rs:966)) | Platform transcript settlement under the durable terminal attempt. Exact content condition is `terminal.cause == Complete && result.is_ok()`. Other outcomes write `final_text = None`. | **Neither**, but first make the terminal attempt durable. The abandonment path currently can insert the transcript from an in-memory terminal before the attempt terminal is flushed. | High under implemented LLP 0204. |
| Ask transcript insert ([server.rs:25153](crates/snapback-server/src/server.rs:25153), [server.rs:25328](crates/snapback-server/src/server.rs:25328)) | Platform settlement. Successful Ask may carry final response text and token counts; failure carries no final text but still carries token accounting. | **Neither**, after the target terminal attempt commit. | High. |
| Cancellation transcript insert ([server.rs:28111](crates/snapback-server/src/server.rs:28111)) | Host continuation from the already-authorized cancellation terminal. Exact branch always has `final_text = None`. | **Neither.** | High. |
| Startup transcript repair ([engine.rs:24909](crates/snapback-engine/src/local/engine.rs:24909), [engine.rs:24925](crates/snapback-engine/src/local/engine.rs:24925)) | Host recovery from a durable terminal attempt, including the gap where attempt terminal committed but transcript did not. It deliberately invents neither final content nor token counts ([stream_transcripts.rs:282](crates/snapback-kernel/src/storage/stream_transcripts.rs:282)). | **Neither.** | High. |
| Reset/schema lifecycle deletion or DDL ([schema_seed.rs:99](crates/snapback-kernel/src/storage/schema_seed.rs:99), [stream_transcripts.rs:69](crates/snapback-kernel/src/storage/stream_transcripts.rs:69)) | The committed reset/deployment transaction, not a stream caller. | **Neither.** | High. |

## The current branch split is not representable

`flush_stream_attempts_required` and `flush_stream_attempts_trusted` appear to separate caller and host paths, but both call `dirty_snapshots(namespace)`, which returns **every** dirty attempt for that instance ([server.rs:1051](crates/snapback-server/src/server.rs:1051), [server.rs:1087](crates/snapback-server/src/server.rs:1087), [stream_attempt.rs:471](crates/snapback-sync/src/stream_attempt.rs:471)).

Consequences:

- A caller-backed start flush can include host terminal/cursor bookkeeping or another session’s dirty attempt.
- A trusted close/terminal flush can persist a not-yet-authorized caller start or cursor premark.
- One reservation cannot authorize the mixed batch.
- `upsert_stream_attempts` executes rows one by one without opening a containing transaction ([settlement.rs:11](crates/snapback-kernel/src/storage/settlement.rs:11)). A mixed batch can therefore be partially durable.

This must be split before adding any guard. The separation key must be transition provenance, not terminal cause:

- `CallerAuthorized`: fresh start, takeover, cursor premark, explicit authored settle/cancel.
- `ModeOnly`: the same new-effect transitions from credential-free background/Dev authority.
- `HostSettlement`: counters, transport outcome, close, automatic terminalization, recovery, terminal adoption.

The automatic worker call at [server.rs:2932](crates/snapback-server/src/server.rs:2932) and the JS call at [host_glue.rs:4264](crates/snapback-engine/src/runtime/host_glue.rs:4264) currently enter the same `settle_stream_attempt` function. That function must be split; cause values cannot distinguish their authority.

## Abandonment ordering

**Nothing currently marks watchdog abandonment durably at the abandonment transition.**

The transition:

1. Locks `commit_gate`.
2. Sets an in-memory `AtomicBool`.
3. Cancels the active room reservation.

That is all ([server.rs:2616](crates/snapback-server/src/server.rs:2616), [server.rs:2630](crates/snapback-server/src/server.rs:2630)). `terminalize_invocation` later updates only the process registry and marks the row dirty ([server.rs:3026](crates/snapback-server/src/server.rs:3026), [stream_attempt.rs:924](crates/snapback-sync/src/stream_attempt.rs:924)).

A caller write can race this transition because `flush_stream_attempts_required` takes `LocalSnapback` but never takes `commit_gate`. Its last abandonment check occurs before the SQL call ([server.rs:1206](crates/snapback-server/src/server.rs:1206), [server.rs:1221](crates/snapback-server/src/server.rs:1221), [server.rs:1063](crates/snapback-server/src/server.rs:1063)). Therefore:

- abandonment can set the flag after `lock_live`’s final check;
- the old caller snapshot can then commit after abandonment;
- the terminal registry update remains dirty because `clear_flushed` compares exact snapshots and will not clear a newer terminal version ([stream_attempt.rs:500](crates/snapback-sync/src/stream_attempt.rs:500));
- a later trusted flush, if one happens, serializes through `LocalSnapback` and overwrites the durable row with the terminal snapshot.

But the timeout and worker-death legs do not themselves perform that durable flush. If the worker never returns, the database may remain nonterminal until process restart. Startup then records `failed`, not the watchdog’s in-memory `timed_out` ([stream_attempt.rs:158](crates/snapback-types/src/stream_attempt.rs:158)).

The watchdog test does not prove durability: its second runner uses the same `SharedSnapback` and process-global registry ([server/tests.rs:27671](crates/snapback-server/src/server/tests.rs:27671), [server/tests.rs:27674](crates/snapback-server/src/server/tests.rs:27674)). It never reopens the database after timeout.

Correct ordering:

- Every caller/mode-backed stream write must take `commit_gate` at its final SQL cut.
- If the writer owns the gate, it commits before abandonment.
- Otherwise abandonment acquires the gate first, marks the invocation abandoned, and every later caller write refuses.
- Only after that linearization may the host terminalizer CAS and durably flush without caller or mode fencing.
- Registry terminal CAS orders competing authored/cancel/terminalizer outcomes; the first terminal wins and later `settle` returns it verbatim ([stream_attempt.rs:879](crates/snapback-sync/src/stream_attempt.rs:879), [stream_attempt.rs:893](crates/snapback-sync/src/stream_attempt.rs:893)).

## Content versus bookkeeping

The attempt row contains no durable chunk or final-result content. It stores identity, lease generation, cursor states, terminal/certainty, initiator, byte count, and chunk count ([stream_attempt.rs:109](crates/snapback-types/src/stream_attempt.rs:109)). Its individual transitions can therefore be separated cleanly by provenance.

The transcript row does fuse content and terminal bookkeeping: `final_text`, terminal cause, initiator, chunk count, and token counts are inserted together ([stream_transcripts.rs:40](crates/snapback-kernel/src/storage/stream_transcripts.rs:40), [stream_transcripts.rs:209](crates/snapback-kernel/src/storage/stream_transcripts.rs:209)). Under the governing platform-authority rule, that fusion is correct and does **not** require a schema split.

What must be split is the ordering:

1. Durably commit the exact terminal attempt.
2. Release caller/mode guards.
3. Insert or repair the transcript as host settlement.

Ask and cancellation currently perform the attempt upsert and transcript insert sequentially under one `LocalSnapback` turn, but they are separate SQLite autocommits ([server.rs:25165](crates/snapback-server/src/server.rs:25165), [server.rs:28110](crates/snapback-server/src/server.rs:28110)). They should become explicitly typed Phase 1/Phase 2 calls.

If the author intends to override LLP 0204 and retain the classification’s caller-authorized-content policy, that is an author policy change, not an engineering inference. Then:

- Output content branch is `terminal == Complete && result.is_ok()`.
- Ask content branch is the successful `Ok(completed)` arm, even when serialization/size leaves `final_text == None`, because token counts and the successful-result fact remain.
- The entire immutable transcript insert should ride the caller reservation; on reservation failure the host inserts a null-content fallback.
- Because insertion is `ON CONFLICT DO NOTHING` ([stream_transcripts.rs:209](crates/snapback-kernel/src/storage/stream_transcripts.rs:209)), the content and fallback branches need terminal-CAS ordering or the null fallback can permanently win.

## Re-entrant admission risk

No current stream storage callee revalidates admission:

- attempt persistence reaches direct `conn.execute` calls;
- transcript settlement checks table/shape and performs direct `conn.execute`;
- `validate_live` checks only abandonment, generation, and deadline ([server.rs:1188](crates/snapback-server/src/server.rs:1188)).

Therefore the exact SQL cuts can safely acquire `AuthorizedEffectReservation::commit_guard` last. The implementation must not acquire it around:

- `reserve_authorized_effect`, which itself calls `validate_admission` ([invocation.rs:1674](crates/snapback-sync/src/auth/invocation.rs:1674));
- a network call;
- the JS handler;
- a blocking join;
- a broad `with_snapback` closure that might later gain admission-validating work.

Acquire it inside a narrow guarded storage method immediately before the relevant `execute`/transaction commit, and drop it before any after-Local completion.

## Ordered implementation sequence

1. **Replace namespace-wide untyped dirty drains.** Introduce exact-token/version transition objects tagged `CallerAuthorized`, `ModeOnly`, or `HostSettlement`. Trusted drains must exclude pending caller transitions.

2. **Split authored and trusted terminal APIs.** Keep the runtime JS call on an authored method; move [server.rs:2932](crates/snapback-server/src/server.rs:2932), watchdog, worker death, and startup recovery to a host-terminal method.

3. **Add exact guarded single-attempt persistence.** Caller transitions accept `AuthorizedEffectReservation`; background transitions accept explicit mode-only authority; host transitions accept an exact attempt/generation/terminal proof and no admission carrier.

4. **Wire the action `commit_gate`.** For caller/mode transitions: reserve outside `LocalSnapback`, acquire Local, stage the exact row, acquire `commit_gate`, recheck abandonment/generation, acquire the mode guard last, commit, then release everything. No guard crosses HTTP, ephemeral fan-out, JS, or joins.

5. **Fence initial creation sites.** Apply the caller/mode split to output initialization, `ctx.streamAttempt.start`, Ask start, and persisted-row takeover. Elide or host-classify terminal-row adoption.

6. **Fence the cursor premark only.** Commit the exact `initiation_possible` row under the caller/mode posture, release all guards, then perform the HTTP call. Classify response observation, provable pre-send narrowing, and close as host settlement.

7. **Move counters to host settlement.** Persist `progress_commits`, `emitted_bytes`, and `chunk_count` from exact host-tagged transitions. Separately verify the authority cut for ephemeral chunk publication.

8. **Make abandonment durable independently of the worker.** After abandonment wins `commit_gate`, terminalize the exact runner records and launch/complete an owned host persistence path. Do not rely on the abandoned worker reaching [server.rs:2950](crates/snapback-server/src/server.rs:2950).

9. **Order transcripts after durable terminal attempts.** Output, Ask, cancellation, and recovery transcripts use host settlement with no caller/mode guard. Preserve immutable first-write semantics.

10. **Add race proofs:** logout-before-reservation; logout-after-reservation; service retirement; authored settle versus abandonment; cancellation versus completion; two unrelated callers with simultaneous dirty rows; durable DB reopen immediately after watchdog timeout; and a no-self-deadlock guard test.

11. **Resolve anonymous connection initiation.** Decide whether connection closure before durable output-attempt start defeats that start. If yes, retain `PreparedConnectionAct::reserve_authority_work` through the attempt commit; if no, document that the initial `prepare_act` authorizes detached start despite later connection closure. A barrier test at [server.rs:27917](crates/snapback-server/src/server.rs:27917) → [server.rs:905](crates/snapback-server/src/server.rs:905) confirms the ruling.

The riskiest item is step 8 combined with step 1: abandonment is not durably marked today, and the shared dirty queue permits a caller and host transition to be persisted by the wrong authority path. Adding guards before separating those transitions can either publish caller state without its reservation or strand the required terminal winner.