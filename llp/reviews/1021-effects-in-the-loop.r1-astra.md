<!-- Provenance: blind read-only review received from codex gpt-6-astra (reasoning max) on 2026-09-09 against origin/main 635999335; launched by the orchestrator (Claude Fable 5.1) from ~/projects/snapback-el-20260908/reviews/rfc/1021.prompt.md; content verbatim. -->

Reviewer: gpt-6-astra, reasoning max · Date: 2026-09-09 · Method: blind read-only review of llp/1021-effects-in-the-loop.rfc.md at 635999335

## Part 1 — the open questions

### 1. Should provider stand-ins be available during manual `dev`, or only in journeys?

**My answer:** Journeys only, enforced by the test supervisor. Ordinary `dev` admission is insufficient: bindings must belong to a particular journey, and the entire test owner must prohibit outbound fallback.

**Why:** A local HTTP provider exercises the real engine consistently with LLP 1003’s existing engine tests; it need not replace Snapback infrastructure. However, journeys share an owner, and the supervisor can kill their process without executing JavaScript cleanup. An owner-lifetime binding followed by journey-owned `unbind` therefore has the wrong lifetime. (`llp/1003-effects-on-ibex2.spec.md:232`; `llp/1002-dev-loop.spec.md:765`; `snapback2/crates/snapback2/src/test.rs:996`.)

The grant must authorize the **logical origin before transport substitution**, on every redirect. Replacing the URL before the existing grant-bound fetch either refuses the loopback destination or requires widening the grant. The existing redirect wrapper also bases credential stripping on logical origins. (`snapback2/crates/snapback2-effects/src/ibex.rs:308`; `snapback2/crates/snapback2-effects/src/prelude/fetch.js:155`.)

Manual stand-in management adds a development surface unnecessary for the reduced loop bar. The later brief asks for a logged push seam and excludes real APNs/FCM delivery; it does not require this additional manual configuration facility. (`rules/NOT-DOING.md:13`; `benchmarks/briefs/social-messenger.md:625`.)

**Confidence:** 96/100.

**Exact replacement text** — replace §3’s prose at `llp/1021-effects-in-the-loop.rfc.md:172`:

> `effects.provider(origin, handler)` starts a loopback HTTP server owned by the journey. Binding is available only to the supervised test owner and belongs to one journey epoch, not the owner’s lifetime. The supervisor revokes bindings on completion, failure, timeout, or process death; revocation does not depend on journey cleanup.
>
> Every effect fetch in the test owner requires a binding, including work emitted before registration or remaining after a journey. An unmatched or expired binding produces an explicit unbound-provider outcome and never falls through to external transport. Pending work cannot acquire a subsequent journey’s binding.
>
> The existing grant check authorizes the logical origin on every request and redirect before transport selects the loopback endpoint. Logical URL and redirect semantics remain intact. Effect source, execution, and `then` use the real engine.
>
> Manual `dev` has no binding override. A builder using a local provider configures both the effect’s request URL and its grant explicitly.

**Resolution under question 1:**

> Resolved: journeys only, with supervisor-owned lifetime, per-journey isolation, and no external fallback anywhere in the test owner.

### 2. May an effect opt out when its provider has no idempotent no-op call?

**My answer:** Allow replacement of synthetic probes with authored witnesses; never allow silent omission of effect evidence. In fact, replace the universal synthetic probe design with authored witnesses for every declared effect.

**Why:** The proposed `200 {}` response already fails the chat effect: it returns `{ providerId: response.id }`, producing an undefined property that the real prelude rejects. An input type cannot determine a provider’s successful response or the database prerequisites of `then`. Furthermore, the runtime declaration contains neither a payload schema nor a declared budget. (`snapback2/packages/snapback2/templates/chat/snapback/delivery.ts:16`; `snapback2/crates/snapback2-effects/src/prelude.js:251`; `snapback2/crates/snapback2-core/src/registry.rs:27`.)

There is an implemented precedent for recognizing the generic prover’s limits: asset arguments require an upload journey. Missing committing evidence otherwise blocks. The same distinction belongs here. Accepting an “expected refusal” alone would prove that an effect can fail, while the RFC promises successful execution and committed bookkeeping. (`llp/1002-dev-loop.spec.md:719`; `llp/1002-dev-loop.spec.md:727`; `llp/1021-effects-in-the-loop.rfc.md:193`.)

The meaningful later benchmark witness is domain-specific: scheduled digest emission, authorization-correct counts, and idempotency under retry/restart. A fabricated payload cannot prove those properties. Neither that benchmark nor a universal probe should expand the reduced loop bar silently. (`benchmarks/briefs/social-messenger.md:752`; `rules/NOT-DOING.md:13`.)

**Confidence:** 98/100.

**Exact replacement text** — replace §4 at `llp/1021-effects-in-the-loop.rfc.md:185`:

> The `effects` check aggregates framework-recorded execution evidence after the selected authored journeys. The compiler does not manufacture effect payloads or assume a universal successful provider response.
>
> A complete run requires a successful witness for every declared effect: a real mutation, job, or schedule commits an emission; the real engine executes it against journey-owned provider handlers; and any declared `then` commits. The receipt identifies the journey, effect, outbox id, emission sequence, attempts, terminal state, elapsed time, and the linked `then` outcome and commit sequence. An effect without `then` records that explicitly.
>
> Expected refusal journeys provide negative evidence and cannot substitute for a successful witness. Missing witnesses produce `blocked`, naming the effect and the journey needed. Selected runs state their coverage scope; `--derived-only` cannot claim execution coverage it did not obtain.
>
> Without an engine, the effects check remains blocked and provides the build remedy. Engine-dependent journey work is also explicitly blocked with reason `effects:no-engine`, never passed or reported as an application failure. Engine-less measurement accepts precisely these engine-absence blocks when every unrelated check passes; publication requires complete passing coverage. This explicitly amends the current measurement acceptance rule.
>
> Journeys retain the five-second budget and the full test retains thirty seconds. Longer engine conformance runs remain scheduled.

**Resolution under question 2:**

> Resolved: no silent coverage opt-out; replace generic probes with authored successful witnesses, with missing evidence reported as blocked.

## Part 2 — the review

### 1. Verdict

**NOT READY.** The generic probe, settlement predicate, provider lifetime, seed names, and timeout-policy statements need substantive correction. This judgment concerns implementability; the document remains a nonbinding Draft. (`llp/1021-effects-in-the-loop.rfc.md:4`; `rules/RULES.md:58`.)

### 2. Blocking defects

1. **The universal probe fails its own acceptance fixture.** `200 {}` causes `delivery.notify` to return an invalid JSON result, preventing its `then` from running. Accepting that failure as an expected refusal would contradict the requirement that bookkeeping committed. Payload and budget metadata also do not exist in `EffectDecl`; adding them would still provide no response oracle. Adopt question 2’s replacement. (`llp/1021-effects-in-the-loop.rfc.md:187`; `snapback2/packages/snapback2/templates/chat/snapback/delivery.ts:16`; `snapback2/crates/snapback2-effects/src/prelude.js:304`; `snapback2/crates/snapback2-core/src/registry.rs:27`.)

2. **`settle` can declare completion while bookkeeping remains pending.** Its predicate excludes `then_pending`. Pending execution can encounter a store error and remain pending, yet satisfy “no due queued or running rows.” Also, `sent` explicitly includes rejected bookkeeping, so the example’s `state === "sent"` assertion does not prove `then` committed. Include pending continuations and expose their actual outcome. (`llp/1021-effects-in-the-loop.rfc.md:138`; `snapback2/crates/snapback2-effects/src/runner_settlement.rs:19`; `llp/1003-effects-on-ibex2.spec.md:110`; `llp/1021-effects-in-the-loop.rfc.md:153`.)

3. **Provider isolation does not support the no-external-I/O promise.** The test owner starts the real runner before derived checks and journeys. Derived invalidation checks execute real mutations. Therefore, binding providers inside a later journey leaves an earlier execution window; journey death and backoff create later windows. An isolated database does not isolate provider traffic. Question 1’s owner-wide transport restriction and supervisor lifetime are prerequisites. (`snapback2/crates/snapback2/src/owner.rs:216`; `snapback2/crates/snapback2/src/test.rs:185`; `snapback2/crates/snapback2/src/test_invalidation.rs:970`; `llp/1021-effects-in-the-loop.rfc.md:172`.)

4. **The proposed handles violate the schema.** `alice-dev`, `bob-dev`, and `charlie-dev` contain forbidden hyphens: `format handle` admits lowercase ASCII letters, digits, and underscores. Use valid fixture names such as `alice_dev` and `bob_dev`. Preserve Charlie’s deliberately absent profile. Narrow “cannot collide with a real signup” to freeing the ordinary example handles; suffixing does not reserve a namespace. (`llp/1021-effects-in-the-loop.rfc.md:234`; `snapback2/packages/snapback2/templates/chat/snapback/schema.q:6`; `snapback2/crates/snapback2-core/src/schema.rs:404`; `snapback2/packages/snapback2/guide/testing.md:18`.)

5. **Timeout retry policy contradicts the implemented contract and the RFC itself.** §5 changes timeout to `retry:false`; LLP 1003 and the host use `retry:true`; §“What this does not do” promises no retry-policy change. Name and justify the change, including an effect that contacted its provider before timing out. Detachment is also insufficient evidence that execution stopped: the related ticket explicitly rejects that inference. Acceptance must observe owner termination, not merely command return. (`llp/1021-effects-in-the-loop.rfc.md:212`; `llp/1021-effects-in-the-loop.rfc.md:248`; `llp/1003-effects-on-ibex2.spec.md:168`; `snapback2/crates/snapback2-effects/src/ibex.rs:695`; `issues/20260901-snapback2-effect-timeout-cannot-interrupt-synchronous.md:23`.)

6. **“Release” does not provide the promised staging-accounting fix.** Existing release frees pending object slots but deliberately retains original-byte charges. Usage is recomputed from ledger rows; there are no independent counters to decrement. If the proposal intends immediate byte relief, it needs explicit unused-argument **discard/tombstone** semantics, distinct from ordinary release and its grace period, and an amendment to LLP 1006. For an attached original plus discarded retries, pending staging objects should be **zero**, with one attached asset—not one staged object. (`llp/1021-effects-in-the-loop.rfc.md:224`; `snapback2/crates/snapback2-core/src/assets_ledger.rs:249`; `llp/1006-assets.rfc.md:808`; `llp/1006-assets.rfc.md:1322`.)

7. **Several evidence statements overreach their sources.** “`test` never runs an effect” is false globally: `check_effects` only checks availability, but the test owner runs effects and the chat send mutation emits them. “Reset says nothing” should say it omits reseed accounting: it prints a JSON result, and help explicitly describes reseeding. The CLI already returns `E_OWNER_STOP_TIMEOUT` after two seconds; distinguish that from the owner’s unbounded join. (`llp/1021-effects-in-the-loop.rfc.md:67`; `snapback2/crates/snapback2/src/owner.rs:216`; `snapback2/packages/snapback2/templates/chat/snapback/messages.q:32`; `snapback2/crates/snapback2/src/verbs.rs:25`; `snapback2/crates/snapback2/src/verbs.rs:297`; `snapback2/crates/snapback2/src/owner.rs:469`.)

   I could not verify the attributed “no external I/O” quotation in `social-messenger.md`; cite the binding capability-bar wording in `rules/NOT-DOING.md:20`, and the actual push requirement at `benchmarks/briefs/social-messenger.md:625`. I could not verify the historical **seventh-retry threshold** independently; the ticket records it without an executable reproducer. The unused-argument mechanism is supported by the row-only reconciler. (`issues/20260906-snapback2-asset-staging-quota-unrecoverable-after-abandoned-uploads.md:4`; `snapback2/crates/snapback2-core/src/assets_ledger.rs:562`.)

### 3. Material changes

- **Define settlement scope, time, and completeness.** Specify a fixed scope or watermark, stable pagination, byte limits, and explicit reasons for remaining work: backoff, unavailable engine, pending continuation, or budget exhaustion. Waiting must occur outside the sole writer. After `tick`, an empty outbox cannot prove a due schedule/job has finished producing emissions: those producers run on later bounded background turns. Distinguish “nothing runnable now” from successful delivery. (`llp/1021-effects-in-the-loop.rfc.md:133`; `snapback2/crates/snapback2/src/writer.rs:817`; `llp/1016-administrative-plane.rfc.md:409`.)

- **Resolve engine-less journey behavior before F3 lands.** The example throws when `settle` returns `settled:false`, which is precisely the proposed no-engine result. That would add a failing journey to a measurement path accepting only an effects block with all other checks passing. Question 2’s replacement makes the required receipt-policy amendment explicit. (`llp/1021-effects-in-the-loop.rfc.md:141`; `llp/1021-effects-in-the-loop.rfc.md:151`; `llp/1002-dev-loop.spec.md:1296`.)

- **Specify observable transition coverage and loss.** Log committed emission, claim, retry, restart recovery, requeue, and both committed/rejected `then` outcomes at their authoritative transition sites. Current forwarding happens after a drain; current file logging can fail; current `trace` returns a row snapshot, not transition history or a linked bookkeeping commit. Either provide the promised completeness or explicitly report unavailable history and logging gaps. (`snapback2/crates/snapback2/src/effects.rs:335`; `snapback2/crates/snapback2/src/watch.rs:228`; `snapback2/crates/snapback2/src/writer_ledger.rs:272`; `llp/0329.016-agentic-dev-loop-from-scratch.rfc.md:794`.)

- **Make the deadline one monotonic deadline.** Carry remaining time across engine entrances and cleanup; preserve the upstream ticket’s checked interruption and `end_drive` requirements. Stop admitting new claims during shutdown. The current runner can drain sixteen jobs before checking its stop flag, and its default job budget is thirty seconds—already the full test budget. Do not reset that budget at every entrance or drain iteration. (`issues/20260901-snapback2-effect-timeout-cannot-interrupt-synchronous.md:21`; `snapback2/crates/snapback2-effects/src/runner.rs:15`; `snapback2/crates/snapback2-effects/src/runner.rs:229`; `snapback2/crates/snapback2/src/effects.rs:343`; `rules/RULES.md:44`.)

- **Define asset consumption and reset boundaries.** Unused-argument disposal must be transactional, restricted to validated typed assets owned by the caller, bounded, and consistent across normal and offline-replay settlement. Preserve rollback, receiving-byte custody, and fork-aware deletion. `reset --empty` also changes semantics: specify retained identities, schedule rearming, and restart behavior rather than calling it a wording change. (`snapback2/crates/snapback2-core/src/engine/mod.rs:667`; `snapback2/crates/snapback2-core/src/engine/mod.rs:699`; `snapback2/crates/snapback2/src/blob_store.rs:479`; `llp/1006-assets.rfc.md:881`; `snapback2/crates/snapback2-core/src/engine/mod.rs:908`; `snapback2/crates/snapback2/src/owner.rs:174`.)

- **Complete the provider and diagnostic contracts.** Specify transport substitution beneath logical-origin admission, loopback-target validation, request/response capture caps, and cap reporting. Every new refusal needs its family, source/control site, rewrite, and guide page—including invalid binding, expired binding, and exhausted settle budget. F3 therefore includes transport and supervisor work; split F6’s transaction work from its template/prose changes. (`snapback2/crates/snapback2-effects/src/ibex.rs:308`; `snapback2/crates/snapback2-effects/src/prelude/fetch.js:134`; `rules/NOT-DOING.md:102`; `llp/1021-effects-in-the-loop.rfc.md:276`.)

### 4. Minor

- Use the qualified effect name `delivery.notify` in row assertions; the compiler emits that identity. Normalize `Systems:` paths and add the compiler, transaction/replay paths, LLP 1006, offline LLP 1012, and both sibling RFCs to the relevant references. (`llp/1021-effects-in-the-loop.rfc.md:5`; `llp/1021-effects-in-the-loop.rfc.md:152`; `snapback2/packages/compiler/src/test-effects.ts:51`.)
- Preserve the machine-readable startup envelope when adding the engine announcement. Update guide examples within the existing budget; do not add a diagnostics registry. (`snapback2/crates/snapback2/src/owner.rs:658`; `llp/0329.016-agentic-dev-loop-from-scratch.rfc.md:844`; `rules/NOT-DOING.md:93`.)
- The quoted 7.3/4.1 MB sizes are supported: the record reports 7,312,592 and 4,078,496 bytes. Cite that record directly. (`snapback2/metrics/loop.jsonl:241`.)

### 5. What acceptance does not prove

**Lifecycle and receipts.** One successful send does not prove restart completeness or bookkeeping success. Add cases for restart between provider completion and `then`, rejected `then`, changed continuation generation, pending-work errors, pagination beyond 200 rows, and future backoff. Require exact outbox identity, explicit continuation outcome, and at most one committed bookkeeping transaction. (`llp/1021-effects-in-the-loop.rfc.md:258`; `llp/1003-effects-on-ibex2.spec.md:110`; `snapback2/crates/snapback2-effects/src/runner_settlement.rs:19`.)

**Provider isolation and stopping.** Kill a journey after a provider accepted a request but before settlement; then run another journey using the same logical origin. Prove no binding inheritance or external fallback. Add an ungranted redirect, an unbound granted origin, recursive microtasks, and a provider-await timeout; observe process termination and durable states. A handler returning `{id}` and a single synchronous-loop fixture do not establish these guarantees. (`llp/1021-effects-in-the-loop.rfc.md:258`; `snapback2/crates/snapback2/src/test.rs:996`; `issues/20260901-snapback2-effect-timeout-cannot-interrupt-synchronous.md:21`.)

**Offline, schedules, and sibling coherence.** Queue an offline send, lose its authoritative response, replay it, and verify one server emission and provider idempotency. The twin must consume the same id without executing an effect. Separately advance a schedule with all clients disconnected and observe its emission. Keep LLP 1019’s delivery custody distinct from provider delivery; exercise LLP 1020-style successors while `then` is pending. (`snapback2/packages/evaluator/src/runner.ts:199`; `llp/1002-dev-loop.spec.md:1215`; `benchmarks/briefs/social-messenger.md:752`; `llp/1019-derived-delivery-custody.rfc.md:162`; `llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:106`.)

**Assets and reset.** Reproduce the actual retry workload, checking pending objects **and bytes**, attachment survival, rollback, restart, and eventual physical cleanup. Test ordinary reset and empty reset across restart with schedules installed. Prove a real account can claim `alice`, while Charlie still exercises profile creation. The proposed “seven → one” assertion and output-string test establish neither custody correctness nor reset semantics. (`llp/1021-effects-in-the-loop.rfc.md:266`; `snapback2/crates/snapback2-core/src/assets_ledger.rs:249`; `snapback2/crates/snapback2-core/src/engine/mod.rs:924`; `snapback2/packages/snapback2/guide/testing.md:18`.)

### 6. Alternatives

The strongest smaller design is authored effect journeys over the existing durable outbox, using explicitly configured loopback providers, with transition visibility and the upstream interrupt fix added independently. It avoids synthetic payloads and origin substitution while retaining real execution; its cost is testing a local provider configuration instead of unchanged production URLs/grants. Existing engine tests already establish that basic shape. I prefer its authored-witness model to this RFC’s universal probe. Origin rebinding is a useful additional convenience only after its isolation and redirect contracts are complete; it should not be the foundation of an unsupported automatic correctness claim. (`llp/1003-effects-on-ibex2.spec.md:232`; `llp/1021-effects-in-the-loop.rfc.md:172`; `llp/1021-effects-in-the-loop.rfc.md:187`.)

### 7. Sequencing after the five-lane program

Publish the five-lane result and run the reduced loop bar immediately, then use the Clique cold rerun to establish which composition failures remain. Advance truthful effect visibility and the timeout repair as focused fixes. Prioritize verification and repair of LLP 1020’s reported underpricing defects before broader effect automation, then its day-two evolution witness. Sequence LLP 1019’s larger custody/certification change against the cold rerun’s evidence, with explicit interaction tests for successors and offline retention. The full three-RFC program should not become a prerequisite for obtaining that feedback: the binding bar is the published M1–M3 loop, while the broader scopes require evidence and explicit trades. (`rules/NOT-DOING.md:13`; `rules/NOT-DOING.md:116`; `llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:216`; `llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:260`; `llp/1019-derived-delivery-custody.rfc.md:174`.)

---

I could not save `/Users/ccheever/projects/snapback-el-20260908/reviews/rfc/1021-astra-max.md`: this session’s filesystem permissions are read-only. The complete review is printed above.