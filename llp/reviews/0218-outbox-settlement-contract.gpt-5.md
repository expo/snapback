# Review artifact — LLP 0218, GPT family, round 1

- **Target:** `llp/0218-outbox-settlement-contract.rfc.md`
- **Round:** 1 (llp-super-refine, sub-orchestrated loop)
- **Date:** 2026-08-10
- **Target blob (git hash-object, revision b):** 51d213675d800af4e3878afbe8e66ac1b0b2ab0b
- **Capsule sha256-16 (tar):** 5e16f930d00085d5
- **Reviewer runtime/mechanism:** codex exec, model gpt-5.6-sol,
  model_reasoning_effort=xhigh, read-only sandbox, capsule cwd; mutually
  blind to the Claude-family reviewer. Final message extracted after the
  last "tokens used" line of the run log (first line below is the token
  count trailing that marker).
- **Verdict:** NOT READY

The review below is sealed verbatim as received.

---

147,361
## Overall assessment

The RFC chooses the right direction and directly targets both pilot failures: a discriminated queued outcome makes durable deferral visible, and preserving optimistic state after accepted enqueue prevents erroneous rollback. Separating dispatch from durable settlement also fits LLP 0043’s ownership model, while the resync-first default drain correctly avoids treating connectivity as sufficient authority.

It is not ready as the contract ruling yet. Several caller-visible cuts and drain invariants remain ambiguous enough for conforming implementations to behave differently.

## Material concerns

### M1 — MATERIAL: “Durable enqueue” is not the correct boundary for returning `queued`

The RFC says `mutate()` resolves at authoritative settlement or durable enqueue, whichever happens first, and directs the drain to react to enqueue (`llp/0218-outbox-settlement-contract.rfc.md:111-115`, `:143-146`). But LLP 0043 requires the complete pending record to become durable before an explicit-ID online delivery (`llp/0043-offline-replay-retention.rfc.md:270-282`), and the current generated path likewise enqueues before continuing its online attempt (`code/snapback-client-index.mjs.EXCERPT.mjs:245-327`).

Read literally, an ordinarily online queue-capable mutation would reach durable enqueue first and immediately return `queued`; an enqueue-triggered drain could also race its foreground delivery.

Smallest fix: distinguish:

- the internal durable-custody cut;
- the caller-visible transition to deferred/replay-eligible dispatch; and
- an active foreground delivery attempt.

Return `queued` only when foreground settlement has been relinquished and the durable record is replay-eligible. Trigger the drain on that transition, not every durable record insertion, and forbid replay while the original delivery attempt owns the record.

### M2 — MATERIAL: The public union is not specified across the actual mutation facades

The only concrete union wraps `MutationOutput<Result>` (`llp/0218-outbox-settlement-contract.rfc.md:102-109`), while §4.5 says both headless `mutate()` and `useSnapbackMutation()` adopt “the union” (`:170-176`). Those surfaces currently have different successful values: headless returns `MutationOutput<FunctionResult<Ref>>` (`code/snapback-client-index.d.mts:1318-1349`), while React returns `FunctionResult<Ref>` (`code/snapback-react-index.d.mts:473-495`).

The RFC also omits `invokeSnapbackMutation()` and bound-surface mutation functions, which currently expose result-only promises (`code/snapback-react-index.d.mts:338-339`, `:581-596`). The unnamed “settled-only convenience hook” leaves compatibility behavior equally indeterminate. Finally, `presentation` does not say which layer populates it or whether it is a point-in-time observation or continuing guarantee.

Smallest fix: add a compact API table giving the exact resolved type and rejection behavior for headless mutate, hook, imperative React invocation, bound surfaces, Expo/Contract projections, and the named compatibility surface. Define who assigns `presentation` and its temporal meaning.

### M3 — MATERIAL: The durable observation contract omits existing lifecycle states and consumption semantics

`mutationStatus()` and `subscribeMutation()` are introduced without signatures and summarized as `pending → settled/failed/stranded` (`llp/0218-outbox-settlement-contract.rfc.md:111-119`). Existing custody includes acknowledgement-pending, consumed/ACK-ready, and removed states (`llp/0043-offline-replay-retention.rfc.md:268-303`), while the shipped outbox also exposes quarantine and result-gone dispositions (`code/snapback-client-index.d.mts:835-951`). The RFC itself requires the drain to honor quarantine (`llp/0218-outbox-settlement-contract.rfc.md:149-152`) but does not say what the per-mutation observer reports for it.

It is also unclear whether observing `settled` counts as consumption or whether callers must still invoke `markMutationSettlementsConsumed()`. That distinction controls exactly-once recovery and bounded ACK storage.

Smallest fix: define the full `MutationStatus` union, missing/removed/privacy-deleted behavior, subscription delivery semantics, and whether observation is non-consuming. Preserve LLP 0043’s explicit consumption cut unless deliberately amended. Specify how these states and the blocked reason project through `useSnapbackOutbox`; leaving stranded recovery “unowned” (`llp/0218-outbox-settlement-contract.rfc.md:220-222`) is inconsistent with accepting this as the public observability contract.

### M4 — MATERIAL: The RFC does not make the resync barrier unavoidable for manual drains

The RFC correctly prohibits raw `online → replayQueuedMutations()` (`llp/0218-outbox-settlement-contract.rfc.md:143-154`), but then makes `drainNow()` available while retaining `replay()` as an alias (`:195-200`) and tells existing flushers to select manual mode (`:140-143`). Today that React `replay()` directly invokes the headless replay method and explicitly leaves resync ownership elsewhere (`code/snapback-react-index.d.mts:514-518`). The replay method itself performs custody checks but does not establish resync; the current safe automatic path relies on a fresh-subscribe snapshot before scheduling it (`code/snapback-client-index.mjs.EXCERPT.mjs:170-231`, `:374-377`).

The new no-mounted-query proof row makes this more important: the RFC never defines what constitutes a full resync barrier when there is no subscription.

Smallest fix: state that `drainNow()` and its `replay()` alias request the safe controller and can never bypass resync/custody. Manual mode should disable automatic scheduling, not safety invariants. Define the abstract barrier provider and what “current” means for mounted, retained-but-unmounted, and empty query sets; gate or internalize the raw replay primitive.

### M5 — MATERIAL: The default drain lacks a complete liveness and multi-context contract

The trigger list covers enqueue, connectivity restoration, resume/foreground, and connection readiness (`llp/0218-outbox-settlement-contract.rfc.md:143-152`), but does not require:

- scanning durable pending work on cold controller start;
- retrying after a transient replay/resync failure when no new external event occurs;
- reacting to writer-lock acquisition after being a non-writer;
- propagating writer settlement to follower tabs/providers; or
- deterministic controller cleanup and deduplication across Strict Mode/HMR/provider replacement.

“Backs off boundedly rather than polling forever” does not say whether retry delays are bounded or retries eventually cease. A silent permanent stop would reproduce the pilot wedge. Current non-writer replay simply returns stopped (`code/snapback-client-index.mjs.EXCERPT.mjs:195-210`), and P2 proves only writer refusal, not takeover or follower convergence (`llp/0218-outbox-settlement-contract.rfc.md:191-194`).

Smallest fix: add normative cold-start, retry, writer-transition, follower-observation, and teardown obligations. Extend P2 with cold restored work, transient retry without another event, writer death/takeover, follower status convergence, and duplicate-provider lifecycle rows.

### M6 — MATERIAL: Optimistic settlement after a queued return lacks a correlation contract and adequate proof

The RFC requires installed layers to survive enqueue and later retire or roll back from authoritative terminal facts (`llp/0218-outbox-settlement-contract.rfc.md:121-136`). Once the dispatch promise has resolved `queued`, however, the existing promise-driven React path is finished; current code removes the layer in its catch path (`code/snapback-react-index.mjs.EXCERPT.mjs:428-495`). The RFC does not say how the provider correlates later durable success, typed failure, stranding, quarantine, result-gone, or cross-context settlement back to that process-local layer.

P3 proves only “no rollback after enqueue” plus automatic drain (`llp/0218-outbox-settlement-contract.rfc.md:195-200`). An implementation could pass both while leaking every queued layer until the 256-layer cap.

Smallest fix: state that a retained layer is keyed to `clientMutationId` and observed through the durable status channel, define the layer disposition for each relevant terminal/custody state, and clarify that `presentation:'installed'` is process-local. Add P3 rows for replay success, typed refusal, custody transition, quarantine/result-gone policy, rebase failure, authority loss, and settlement performed by another writer.

### M7 — MATERIAL: The fallback audit occurs too late, and the compatibility alias is unsafe under package skew

Section 4.5 says the new-hook fallback is selected if a release audit finds callers cannot absorb the in-place change (`llp/0218-outbox-settlement-contract.rfc.md:177-180`), but P6 schedules that audit after the in-place migration and one-release alias window (`:208-210`). By then the fallback decision can no longer protect the release.

Additionally, retaining `queued:true` causes an older React wrapper paired with the newer client to keep throwing `SnapbackQueuedMutationError`, because the current wrapper explicitly detects that property (`code/snapback-react-index.mjs.EXCERPT.mjs:241-243`). Thus the alias preserves the M7 failure under mixed supported versions.

Smallest fix: add a pre-publication facade/caller and package-skew audit that selects primary versus fallback before release. Define supported client/React/Expo/Contract version combinations and enforce a lockstep peer range or test an adapter strategy that prevents the old wrapper from interpreting the alias. Reserve P6 for post-release removal evidence.

## Minor concerns

### m1 — MINOR: The LLP 0129 citation is incorrect

The RFC twice attributes resync-before-replay to LLP 0129 governing constraint 4 (`llp/0218-outbox-settlement-contract.rfc.md:17`, `:147-149`). In the supplied excerpt, constraint 4 says the ephemeral lane does not sync (`llp/0129-local-first-program.plan.EXCERPT-governing-constraints.md:41-45`). LLP 0043 correctly supports resync-before-replay, so this is a citation repair rather than a design defect.

### m2 — MINOR: Diagnostic trigger ownership should be reconciled with LLP 0219

LLP 0218 owns a “first silently queued mutation in a session” trigger and payload (`llp/0218-outbox-settlement-contract.rfc.md:159-166`), while LLP 0219 specifies emitting `SNAPBACK_REACT_MUTATION_QUEUED` synchronously whenever enqueue commits, with channel coalescing and a somewhat different payload (`llp/0219-client-dev-diagnostics-channel.rfc.md:108-129`, `:135-155`). Clarify that every eligible transition emits a structured event while the reporter may promote/coalesce the first occurrence, and align the canonical code and payload fields.

## AUTHOR-DECISION

None. The concerns above can be resolved within the recorded binding decisions and the RFC’s chosen direction.

VERDICT: NOT READY

---

# Review artifact — LLP 0218, GPT family, round 2

- **Target:** `llp/0218-outbox-settlement-contract.rfc.md`
- **Round:** 2 (llp-super-refine, sub-orchestrated loop)
- **Date:** 2026-08-10
- **Target blob (git hash-object, revision c):** 77b410f758e035be55d97a6b2a6d7c0fea5f7b29
- **Capsule sha256-16 (tar):** 1db7d9bb608e81b4
- **Reviewer runtime/mechanism:** codex exec, model gpt-5.6-sol,
  model_reasoning_effort=xhigh, read-only sandbox, capsule cwd; mutually
  blind to the Claude-family reviewer; delta from revision (b) enumerated
  in the round instructions. Final message extracted after the last
  "tokens used" line of the run log (first line below is the token count
  trailing that marker).
- **Verdict:** NOT READY

The review below is sealed verbatim as received.

---

144,351
## Overall assessment

The RFC’s direction is strong: it correctly separates dispatch from durable settlement, preserves the three-fact model, prevents queued intent from becoming error-shaped, and gives the platform ownership of resync-gated draining. Revision (c) substantially improves custody, cross-context convergence, and migration honesty.

It is not yet ready as a binding contract, however. Several in-delta statements leave caller-visible behavior contradictory or underdetermined.

## Material concerns

**M1 — MATERIAL / IN-DELTA — The headless compatibility claim is false for typed callers.**

The RFC says flattened settled outcomes let headless settled-path callers continue unchanged (`llp/0218-outbox-settlement-contract.rfc.md` §4.1, lines 123–126; §4.5, lines 253–256). Today both `mutate()` overloads return `Promise<MutationOutput<...>>` (`code/snapback-client-index.d.mts`, lines 1318–1349). Once that becomes a union, existing TypeScript such as `output.result` or destructuring `{result}` no longer compiles until the caller narrows `status`, because the queued branch lacks those fields. The RFC’s own Options section correctly says default-queue callers must branch (`llp/0218...`, lines 76–78).

Smallest fix: state that flattening preserves the settled branch’s runtime/top-level shape after narrowing, not source compatibility. Include ordinary headless TypeScript callers in the P1 absorption audit, and say that only a literal `{queue:false}` overload or settled-only convenience surface preserves the old resolved type unchanged.

**M2 — MATERIAL / IN-DELTA — The “deterministic” optimistic disposition map is neither total nor sufficient to run LLP 0107 matchers.**

`mutationStatus`/`subscribeMutation` enumerate dispositions without pinning their branch payloads (`llp/0218...` §4.1, lines 138–148). The new provider map then covers `settled`, `failed`, and custody dispositions but omits `pending` and `unknown` (`llp/0218...` §4.2, lines 181–188). `unknown` is expressly valid after ACK consumption and collection and licenses no settlement inference (lines 143–144; see also `llp/0043-offline-replay-retention.rfc.md` §Settlement consumption, lines 283–293).

Moreover, LLP 0107’s matcher requires the validated mutation result and does not treat HTTP success alone as authoritative (`llp/0107-react-presence-and-optimistic-lifecycle.spec.md` §Optimistic mutation projection, lines 210–214; `code/snapback-react-index.d.mts`, lines 489–492). A bare `settled` tag cannot execute that matcher, especially for settlement performed by another writer.

Smallest fix: pin that `settled` carries the retained settlement/result needed for validation and matching, and that `failed` carries the typed refusal. Complete the map: `pending` retains the layer; `unknown` retains it without inference and surfaces an inspectable orphaned state until authoritative delivery or authority loss provides evidence. If a stronger no-missed-terminal-transition guarantee is intended, state that guarantee and its relationship to ACK GC.

**M3 — MATERIAL / IN-DELTA — The post-enqueue presentation-failure rule conflicts with the new relinquishment cut.**

The new text establishes that ordinary explicit-ID online dispatch reaches durable enqueue before its foreground attempt settles (`llp/0218...` §4.1, lines 129–136). Section 4.2 then says that after durable enqueue, no local presentation problem may reject and “the dispatch resolves queued” with `presentation:'unavailable'` (lines 170–176). But an online foreground attempt may subsequently settle, and React permits only a validated-result settled branch (lines 152–166). Current React validation occurs after `client.mutate()` returns (`code/snapback-react-index.mjs.EXCERPT.mjs`, lines 307–317 and 435–447). The RFC therefore supplies no legal result if such a settled response encounters a post-enqueue local/result-contract failure.

The same paragraph says “plus a structured diagnostic,” but the displayed queued type has no diagnostic member and does not say whether the diagnostic is returned or emitted through LLP 0219 (`llp/0218...`, lines 116–121, 172–176).

Smallest fix: distinguish optimistic-install/presentation failure from settled mutation-result validation. Scope `queued + unavailable` to a foreground attempt that is relinquished and replay-eligible, then explicitly define the outcome of post-enqueue validation failure on a foreground-settled attempt. Also identify the diagnostic carrier.

**M4 — MATERIAL / IN-DELTA — A paused drain has no specified wakeup for restored authority or custody.**

The trigger list includes relinquishment, connectivity, foregrounding, connection readiness, writer acquisition, and startup scan (`llp/0218...` §4.3, lines 202–206). Later, the controller pauses when custody or authority is unavailable while promising never to stop silently (`llp/0218...`, lines 222–226). LLP 0043 explicitly leaves records pending during terminal authority loss until a successor bind resolves them (`llp/0043...` §Auth posture, lines 629–631). That successor can arrive without any new enqueue or network edge, particularly if authority changes over an already-ready connection.

Smallest fix: add settled-authority, custody-replacement, and authority-fence transitions as level-triggered controller wakeups, and add the successor-bind-after-pause case to P2 proof.

**M5 — MATERIAL / IN-DELTA — “Every enqueue commit” is now the wrong diagnostic cut.**

Section 4.1 newly says ordinary online foreground delivery also reaches durable enqueue (`llp/0218...`, lines 129–134). Section 4.4 nevertheless says the queued channel event fires on every enqueue commit (`llp/0218...`, lines 241–247), matching LLP 0219’s current wording (`llp/0219-client-dev-diagnostics-channel.rfc.md` §Producers, lines 146–155). Taken literally, normal online mutations would emit `SNAPBACK_REACT_MUTATION_QUEUED` before settling.

The runtime excerpt shows the intended distinction: the queued diagnostic is recorded by `#enqueueOfflineMutation` when delivery has actually been relinquished (`code/snapback-client-index.mjs.EXCERPT.mjs`, lines 93–131), while durable online insertion occurs separately (lines 245–327).

Smallest fix: define the channel cadence as every transition across the relinquishment-to-queued cut, not every durable insertion. Preserve this RFC’s additional first-occurrence promotion over those actual queued transitions, and schedule the matching LLP 0219 wording amendment.

**M6 — MATERIAL / IN-DELTA — `resultGone` recovery is safety-critical but left as a naming question.**

The optimistic map groups `resultGone` with custody dispositions and promises an affordance (`llp/0218...` §4.2, lines 181–191), while the Open Questions section says only the affordance’s naming/shape remains (`llp/0218...`, lines 331–334). LLP 0043 defines this state as outcome-known with the payload gone, not outcome-unknown (`llp/0043...` §LLP 0162 amendment, lines 881–890). Re-recording it could therefore duplicate an already-committed effect.

The current headless contract exposes read/re-entry for quarantine and read/discard/re-record for stranded intent, but only a count for `resultGone` (`code/snapback-client-index.d.mts`, lines 883–949 and 1364–1379). It also says `resultGone` keeps ordered successors fenced (lines 947–949), so an absent resolution action can permanently block the drain.

Smallest fix: pin `resultGone` as non-replayable and non-rerecordable, define the safe acknowledge/discard/escalation cut that releases or deliberately preserves its successor fence, and then leave only the React prop naming to implementation.

**M7 — MATERIAL / IN-DELTA — The `SnapbackQueuedMutationError` migration story is internally contradictory.**

The settled-only hook and `{queue:false}` mode are said to make queueing impossible and fail loudly online (`llp/0218...` §4.1, lines 158–160). Yet §4.5 says `SnapbackQueuedMutationError` continues only inside those result-only compatibility modes and is removed later as a compatibility rejection (lines 270–275, 317–319). A queued-specific rejection cannot occur where queueing is impossible.

Smallest fix: choose and state one contract. Under the primary plan, the settled-only surface can force `queue:false`, while the class remains a deprecated export but is no longer thrown. Under the fallback plan, a named legacy queue-capable hook may continue throwing it until that hook retires. Tie P6 explicitly to the selected path.

## Minor concerns

**m1 — MINOR / PRE-EXISTING — LLP 0219 is no longer merely “number reserved.”**

The Related header calls LLP 0219 “number reserved” (`llp/0218...`, line 29), but the capsule contains it as a Review RFC (`llp/0219-client-dev-diagnostics-channel.rfc.md`, lines 1–4). Change this to identify the actual document and status-neutral ownership relationship.

## AUTHOR-DECISION

None. These are contract-closure edits within the RFC’s chosen direction; none requires reconsidering its recorded binding decisions.

VERDICT: NOT READY
