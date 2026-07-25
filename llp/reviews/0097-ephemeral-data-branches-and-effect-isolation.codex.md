# Super-Refine Review — codex family — LLP 0097

**Family:** codex (OpenAI `gpt-5.6-sol`, via `codex exec`, ChatGPT-authed). Independent, blind. Skill: llp-super-refine.
**Blindness:** run concurrently with the fable reviewer; instructed not to read `llp/reviews/`. Self-attested + concurrent-structural.

## Round 1
- **Revision hash reviewed (sha256, first 16):** 0097 = `0191fa9a32cb2d22`.
- **Verdict:** 0097 NOT READY (4 material concerns).
- **Verbatim review below** (telemetry lines from the `codex exec` transport stripped).

---

## 1. Summary

LLP 0097 identifies a real missing capability and correctly treats Exact's live futures as LLP 0088's named revisit trigger. Its ephemeral-only scope, fail-closed intent, refusal of sync-core semantic merge, independent retention clocks, and provider-portability posture are directionally sound.

It is not ready, however. Four load-bearing parts remain unresolved or conflict with the cited corpus:

- atomic promotion is promised across database state and irreversible external effects;
- the claimed universal `uses`/LLP 0036 interception chokepoint does not exist as stated;
- the proposed base snapshot is not supplied by LLP 0075 or LLP 0090;
- promotion requires an operation/causality log that `_snapback_changes` does not provide.

The RFC itself also calls its version-stream question "central" and gates status on resolving it.

## 2. Material concerns

### 1. Promotion promises impossible cross-system atomicity
Section 5 says captured effects "fire for real" and promises "a promotion either fully applies (data + settled effects) or is a clean no-op"; the Summary says data + effects "fire together, atomically." That cannot generally hold for payments/email/webhooks/arbitrary APIs. LLP 0045 keeps database intent and provider delivery separate because they cannot pretend to be one transaction; LLP 0069: "No API pretends those commits form a distributed transaction"; LLP 0066 F3: crash after provider acceptance but before local persistence is necessarily ambiguous; LLP 0070: at-least-once, "Exactly-once effects are never implied." A provider can accept a charge, then the process crashes before recording settlement — promotion is then neither a clean no-op nor atomically complete; fencing prevents stale local publication but cannot retract an external effect. The acceptance requirement "partial failure leaves a clean no-op with the branch intact" is unimplementable for external effects. **Fix:** redefine the atomic boundary — (1) atomically commit canonical data replay + a promotion record + durable canonical effect intents; (2) settle those intents asynchronously under stable promotion/effect idempotency keys; (3) expose promotion states `committedEffectsPending | settled | ambiguousExternalEffect`; (4) never roll back or report "no-op" after external initiation; (5) require provider lookup / stable-idempotency recovery before retrying ambiguous effects. If effects must settle before canonical activation, use a staged publication/activation state machine — but still do not claim transactional atomicity with providers.

### 2. The asserted universal effect-interception chokepoint is not established
Section 2: "Every external effect in Snapback flows through actions carrying LLP 0036 `uses` grants at the host egress boundary"; build-on calls 0036 "the single interception chokepoint." That overstates the cited authority. LLP 0036 defines per-function access to declared config and secret handles; its "Egress coupling" section says enforcement belongs to the separate egress-allowlist/runtime seam; it does not establish that all external effects require a `uses` grant. An action can perform credential-free `fetch`. LLP 0028 assigns ambient-capability policy to LLP 0009 and describes egress as a separately granted `network:fetch`. Provider paths also include inbound webhooks, client-side provider SDK/hosted-page activity, and possible explicit secret exposure to unsupported SDKs. A credential grant is not exhaustive mediation proof. Open Question 3 asks whether the boundary is exhaustive — but that question invalidates a load-bearing premise stated as fact. **Why material:** one bypass suffices to charge/send/call from a supposedly isolated branch. **Fix:** replace the 0036 claim with a prerequisite "branch egress mediation" contract — inventory every outbound-initiation path by subsystem/locus; distinguish `uses`-controlled credential access from network/effect authority; require branch identity + isolation mode at the actual host egress op; refuse branch execution for actions/adapters/native modules/targets lacking proved mediation; exclude client-side provider SDK effects unless they use branch-specific provider/test credentials + callbacks; make exhaustive negative/bypass tests a prerequisite to `CaptureOnly`, not merely to "effect-safe."

### 3. The cited snapshot substrate does not provide `base@version`
Section 1: "created from a base snapshot version — the point-in-time consistent read primitive Snapback already has (LLP 0075 / LLP 0090)." Incorrect. LLP 0075 is a Convex competitive-checkpoint protocol (experimental machine/application checkpoints), not a portable Snapback DB snapshot at an arbitrary commit version. LLP 0090 defines resumable query-result snapshots (`LiveReplace` rows + resume token), not a complete writable relational DB image. 0088's history is opt-in/per-record/bounded/Draft; 0008's journal is pruned (replay window). Neither can supply all tables/rows at arbitrary `baseVersion`. **Why material:** COW reads require a stable base after canonical rows change/disappear; falling through to canonical = not isolated; reconstructing from a pruned journal can invalidate a live branch. **Fix:** specify a real branch-base materialization primitive — atomically capture a full branch-visible base at one canonical head; copy/independently retain every row/table (incl. tombstones) the branch may read; lifetime independent of parent replay-floor + history clock; define schema/deployment identity + authorization metadata at capture; restrict v1 to "fork current head" or define a separate historical-snapshot capability before claiming prior-state forks. Provider PITR can implement, not define, that contract.

### 4. Promotion lacks the operation and causal ledger needed for safe replay
Build-on: branch = "base version V + its own journal"; Section 5 promotes by replaying "the branch's committed mutations … as ordinary serialized mutations" and on advancement "rebind and replay cleanly." 0008/0007's journal is a changeset stream of committed row ops/post-images — not a durable invocation log (handler identity, validated args, principal/grant, artifact generation, read dependencies, deterministic result, causal ordering between a simulated effect response and later mutations). This matters when branch code receives a simulated payment success/timeout/captured-email result then writes state based on it: firing the real effect later may yield a different/ambiguous outcome; blindly replaying post-images then firing can make canonical data assert a success the provider did not produce. **Fix:** choose one promotion model — **Command replay:** durably record each promotable invocation (function/artifact identity, canonical args, authority, read baseline, idempotency identity, simulated effect outcomes, causal ordering); re-execute against canonical + require resulting decisions to validate. **State-diff application:** treat branch changes as an explicit application-level patch with preconditions + conflict handlers (do not call it mutation replay). In either, define how simulated-effect-dependent writes are revalidated; unsafe dependencies refuse automatic promotion or require an application-supplied reconciliation function. The branch version stream also needs a firm contract, not OQ1: distinct stream identity, locally monotonic gap-free versions, canonical promotion allocating fresh canonical versions; numeric "rooting" at `baseVersion` must not imply cross-stream comparability (LLP 0007 says undefined).

## 3. Dispositioned implementation-phase notes
TTLs/branch-count/overlay-byte limits/suspension/GC; branch-ID entropy/non-reuse/incarnation/receipt serialization; external-effect receipt home (amend 0043/0070 or dedicated); TTL racing with subscriptions/promotion/worker-claims/inspection; branch-aware matcher cache keys (prevent canonical/branch plan reuse); export/backup treatment (exclude in-progress branches; retain in-progress promotions + canonical effect intents); schema/function activation for existing branches; redaction/access-control for captured effect payloads (may contain secrets); which read-only external calls are genuinely safe ("idempotent read" ≠ no privacy leak / rate-limit / observable access); crash tests at every promotion boundary incl. immediately before/after external initiation + provider acceptance.

## 4. Citation-accuracy check
- 0088 deferral + trigger: **accurate.** No sync-core merge: **accurate.** Two retention clocks: **accurate.**
- 0008 journal retention: **substantially accurate** (version+time prune, monotonic persisted replay floor; keep the high-water exception visible).
- 0007 per-app stream/DK-2: **accurate but unresolved here** (comparisons across streams undefined; 0097 changes this dimension but leaves the contract open).
- 0018 posture: **accurate.**
- 0066/0070 settlement: **partly accurate** — outcome vocabulary + "ambiguity can't be manufactured into terminal settlement" are real; the five settlement-capability classes appear in 0066 as *recommended design input, not an owned/accepted taxonomy*; 0070 `CaptureOnly` = transactional enqueue + inspection, no worker, but does not itself define *branch* effect capture.
- **0036 chokepoint claim: inaccurate** — governs config/secret handles + `uses` grants; does not prove every effect/`fetch` traverses a single `uses`-based interception point.
- 0069 conformance provider: **accurate.** 0045 capture adapter: **accurate.** 0028 action/egress + `--cron-disabled`: **accurate.**
- 0043 receipts: **partially accurate** — owns mutation replay/settlement + ambiguity; the specific `Receipt::Mutation`/committed-schema characterization is more concrete than 0043's text; arbitrary external-effect receipts are outside its present scope.
- 0055 scoped grants: **directionally accurate** (branch-specific authority projection + historical-state access still need design).
- **0075/0090 snapshot citation: inaccurate** — neither supplies a portable full-database `base@version` primitive for COW branching.
- 0083 PITR/bookmark: **accurate** (supports prior-art claim, not a portable product branch API).

`0097: NOT READY`

---

## Round 2
- **Revision hash reviewed (sha256, first 16):** 0097 = `9ccf86488be51af3`.
- **Verdict:** 0097 NOT READY (R1 concerns confirmed resolved; 3 new deeper concerns).
- **Verbatim review below** (codex exec run with telemetry off).

## 1. Summary

LLP 0097 identifies a real safety problem and chooses several sound high-level constraints:

- LLP 0088 genuinely deferred data branching and named the trigger that Exact now supplies.
- A materialized immutable base plus COW overlay is necessary; the retained journal cannot serve as an arbitrary branch base.
- Branch effects must fail closed.
- Promotion must allocate fresh canonical versions and must not become semantic merge inside sync.
- External settlement cannot be cross-system atomic; durable intents followed by asynchronous settlement is the correct baseline.
- Ephemeral-only scope is a reasonable first slice.

However, three material decisions remain unresolved. Most importantly, the RFC introduces a second observable version stream inside one logical app without reconciling the governing storage and app-boundary contracts. Its promotion model also does not fully resolve data that causally depends on simulated effects, and its acceptance claim over client-side egress is stronger than the proposed mediation boundary can prove.

## 2. Material concerns

### 1. The branch version-stream contract contradicts LLP 0007 and LLP 0018 but is left open

**Concern.** Design §1 says a branch has a “distinct stream identity” and “locally monotonic, gap-free versions,” while remaining “within one logical app.” Open Question 1 then asks whether this can avoid revising LLP 0007.

It cannot simply avoid that revision under the current corpus:

- LLP 0007 §Commit-version graduation pins gap-free visibility within a stream and opaque cursors as `(stream identity, version)`.
- LLP 0018 §Default App Boundary says a logical app owns “one logical commit-version stream.”
- LLP 0088 §3 explicitly says branch-scoped streams are “breaking LLP 0007’s single per-app gap-free stream, DK-2.”

Saying that branch versions never enter the canonical stream does not remove the contradiction. Branch subscriptions and resume expose an additional stream to application clients inside the same logical app. This is exactly the contract change 0088 predicted.

**Why material.** Stream identity governs cursor validity, reset identity, resume, receipts, retention floors, storage portability, and authorization boundaries. The RFC cannot be accepted while its central portable primitive is simultaneously a “firm contract” and its compatibility with the governing storage contract remains its “central portability question.” The RFC’s own Status correctly says it is gated on this issue.

**Suggested fix.** Choose and ratify one model:

1. Amend LLP 0007 and LLP 0018 so a logical app owns one canonical stream plus explicitly typed ephemeral child streams, defining cursor identity, independent replay floors, reset/teardown behavior, and target conformance; or
2. Model a branch as a separate logical app/instance with an explicit parent/fork relationship, accepting the provisioning, auth, and secret-sharing consequences.

Do not leave whether the governing contract changes as an implementation-time question.

### 2. Promotion does not define a coherent transition for simulated-effect-dependent data

**Concern.** Design §5 requires the atomic promotion transaction to commit “canonical data replay + a promotion record + durable canonical effect intents,” after which effects settle asynchronously. But the preceding rule says a write contingent on simulated payment success cannot be promoted “unless the real effect settles, or the invocation re-executes and reconciles.”

Those statements leave a circular case unresolved:

- The real effect cannot settle through the specified staged machinery until its canonical intent has committed.
- The same transaction is said to commit the branch’s canonical data replay.
- Yet data asserting the simulated success must not commit before real settlement.
- “Re-executes and reconciles” does not define which data commits before settlement or how later settlement changes it.

For example, a branch operation observes simulated `chargeSucceeded` and writes `order.status = paid`. Promotion cannot atomically commit that postcondition and merely enqueue the charge without temporarily making a false canonical assertion. Nor can it settle the charge first without introducing an external effect before the durable promotion boundary.

**Why material.** This is the central safety invariant behind the proposed “effect-replay-on-promotion.” An underspecified causal boundary can produce exactly the false-paid, duplicate-charge, and irreversibility hazards the RFC exists to prevent.

**Suggested fix.** Pin one explicit state machine. A safe shape would be:

- Classify branch operations as effect-independent, effect-intent-producing, or effect-outcome-dependent.
- In the promotion transaction, effect-independent writes may commit; effect-outcome-dependent canonical assertions may only commit as explicit pending/provisional state, together with durable intents and continuation/reconciliation identities.
- Provider settlement invokes a fenced reconciliation mutation that transitions pending state to success, rejection, or ambiguity.
- If the application has no declared pending representation and reconciliation handler, the branch is non-promotable.
- Never offer “real effect settles before promotion commit” as an alternative unless a separately durable pre-promotion intent protocol is designed.

This would make promotion coherent with LLP 0066’s rule that ambiguity cannot be manufactured into a terminal outcome.

### 3. The no-egress acceptance claim exceeds the defined enforcement boundary

**Concern.** Design §2 correctly admits that LLP 0036 governs secret access, not exhaustive egress, and calls branch egress mediation net-new. It also recognizes credential-free fetch, native modules, and client-side provider SDK/hosted-page activity.

But Acceptance then requires negative tests proving that no client-side provider SDK path “can initiate a real external effect from a branch.” Host egress mediation cannot establish that guarantee for arbitrary browser/native networking. A future UI may hold an ordinary user session, redirect to a hosted checkout, call a provider directly, or invoke a native SDK without traversing the Snapback host boundary.

The proposed response—exclude these paths unless they use branch-specific test credentials and callbacks—is a policy statement, not an enforcement mechanism. “Refuse branch execution” on the backend does not prevent the client from initiating the request independently.

**Why material.** The RFC’s primary promise is that a branch “never fires real external effects.” One uncontained client path defeats that safety claim. This is not a request for test details; the security boundary and capability semantics are undecided.

**Suggested fix.** Either:

- Narrow the capability contract to **host-mediated effect isolation**, explicitly disclaiming arbitrary client-side effects and requiring Design Mode to suppress or replace those UI paths; or
- Define a complete client isolation contract: branch-aware generated clients, network/SDK allowlisting, provider test-account isolation, callback routing, hosted-page restrictions, native-module refusal, and evidence that the containing runtime controls all outbound initiation.

Capability reporting should distinguish at least host-only capture from end-to-end future isolation. `CaptureOnly` must not imply the latter unless both layers are proved.

## 3. Dispositioned implementation-phase notes

These should be resolved during design completion or implementation but do not independently block readiness:

- Whether local COW uses attached SQLite databases, namespace columns, shadow tables, or another overlay layout.
- Cloudflare bookmark-fork and Postgres schema/namespace mechanics, once the portable child-stream contract is settled.
- Concrete TTLs, branch counts, disk quotas, suspension rules, and GC pressure thresholds.
- API naming and UX for creating, inspecting, killing, and promoting branches.
- Whether external-effect receipts amend LLP 0043/0070 or gain a dedicated authority document.
- Exact receipt fields, indices, ledger retention periods, and inspection projections.
- The operation-log serialization format and canonical argument encoding.
- Detailed conflict-handler APIs and command rebinding diagnostics.
- Historical-base forking beyond v1’s current-head-only base.
- Metadata says `Status: Review`, while the final Status section says “Draft.” Normalize this editorial inconsistency.
- “Inbound webhook” should not be listed as outbound initiation. The relevant branch problem is callback routing and downstream reconciliation, not webhook ingress itself.
- The claim that branches support an “adversarial red-team agent” should be qualified. Design §1 and Non-goals explicitly inherit LLP 0018’s cooperating, non-adversarial posture; untrusted generated code still requires LLP 0009 isolation.

## 4. Citation-accuracy check

- **LLP 0088 — accurate and important.** Section 3 says branch creation would require branch identity, branch-scoped streams, COW storage, branch-aware subscriptions/resume, authorization, and GC. It says: “Recommendation: defer. Do not design it now” and names “concrete user asks for draft/branch workflows” or another demand signal as the revisit trigger. Section 4 keeps semantic merge out of sync. Section 5 requires independent history and resume retention clocks.

- **LLP 0008 — substantially accurate.** §Retention and Resume specifies version-plus-time pruning, a monotonic replay floor, and forced resnapshot below the floor. The implementation note preserves per-table high-water rows, so “pruned by max versions or max age” is directionally right but omits that exception. Its journal/post-image description is consistent with 0088 and 0090.

- **LLP 0007 — partially accurate, but the compatibility conclusion is not established.** DK-2 does define gap-free visibility and `(stream identity, version)` cursors. It also preserves one per-app version authority. Nothing in it establishes that arbitrary ephemeral child streams are already permitted; LLP 0088 explicitly says branching would force a change.

- **LLP 0018 — partially accurate.** It supports the cooperating-not-adversarial posture and logical-app isolation claims. But it also says one logical app owns “one logical commit-version stream,” which 0097 does not reconcile.

- **LLP 0066 — mostly accurate with authority overstatement.** F3 distinguishes transactional database effects from external ambiguity. F4 states that exhaustion/deadline cannot turn an ambiguous outcome into terminal success or failure. However, `retryable | terminal | ambiguousExternalEffect` is identified there as LLP 0070’s vocabulary; 0066 is Research, not the sole owner of that taxonomy.

- **LLP 0070 — accurate.** It defines transactional enqueue, leases, fencing, stable idempotency, the listed failure classes, and `CaptureOnly` as “transactional enqueue and inspection, no worker.” Reusing that idiom is justified.

- **LLP 0036 — corrected accurately inside the body, inaccurately summarized in Related.** It defines per-function `uses` grants and opaque secret handles, but expressly places host enforcement in a separate egress allowlist seam. It is not an exhaustive egress chokepoint. The RFC body correctly acknowledges this; the metadata phrase “the egress boundary” is too broad.

- **LLP 0069 — accurate.** It defines deterministic provider conformance behavior, stable idempotency, lookup after ambiguity, webhook deduplication, and sandbox/provider conformance.

- **LLP 0045 — accurate.** It defines durable notification intents, separate delivery, provider credentials through a `uses`-granted action, and a local capture adapter.

- **LLP 0028 — broadly accurate.** Actions are egress-bearing and not transactionally coupled to their external effects. Its cron/durable execution machinery is a relevant path to inventory.

- **LLP 0043 — accurate but narrowly scoped.** It governs mutation replay receipts and ambiguity: a receipt-less failure stays queued and retry retains the same mutation identity. It does not define general external-effect receipts, as 0097 correctly notes.

- **LLP 0055 — accurate at principle level.** It defines immutable, scoped grants with non-widening authority. A branch-specific derived-grant mechanism is still new work.

- **LLP 0090 — accurate.** Its snapshots are query-result/resume-token artifacts, not full writable database images.

- **LLP 0075 — inaccurate characterization.** It is a Convex competitive checkpoint protocol, not a storage/checkpoint-snapshot primitive suitable for comparison with a branch base. Its use of “snapshot” freezes test/protocol facts. It should be removed from the branch-base discussion.

- **LLP 0083 — accurate.** It records Cloudflare SRS log-plus-snapshot PITR, 30-day recovery, and lexically comparable bookmarks as provider-specific prior art, not a portable app-level branching API.

The RFC has the right overall direction, but its own “firm contract” and promotion safety claim are not yet firm enough for acceptance.

0097: NOT READY

---

## Round 3
- **Revision hash reviewed (sha256, first 16):** 0097 = `8bf8dcb03a964bf7`.
- **Verdict:** 0097 NOT READY (R2 concerns confirmed resolved; 2 new material concerns — promotion commit model + authority revalidation).
- **Verbatim review below.**

## 1. Summary

LLP 0097 identifies a real safety problem and correctly fires LLP 0088’s explicit revisit trigger. Its strongest decisions are sound:

- branches use isolated materialized bases and COW overlays;
- branch versions are separate typed child streams, not canonical coordinates;
- promotion avoids sync-core semantic merge;
- host-mediated capture is fail-closed and honestly distinguished from end-to-end client isolation;
- external effects settle asynchronously after a durable intent boundary;
- simulated provider success cannot become canonical truth without a pending/reconciliation model.

However, two load-bearing parts of promotion remain materially inconsistent with inherited contracts: the claimed atomic replay boundary is not defined on the existing mutation/version substrate, and recorded branch authority is not explicitly revalidated at promotion or later effect execution. Both can produce unsafe or incoherent promotion behavior.

## 2. Material concerns

### 1. The promotion atomic boundary is incompatible with “ordinary serialized mutations” and fresh canonical versions

**Concern.** Section “Promotion — command replay + staged effect settlement” simultaneously says:

> “its data replays as ordinary serialized mutations”

> “Promotion atomically commits the canonical data replay + a promotion record + durable canonical effect intents”

and:

> “Promotion allocates fresh canonical versions.”

Those claims do not currently compose. LLP 0007 DK-2 defines a version as the commit coordinate of one transaction, with ordered changesets and gap-free commit visibility. Ordinary Snapback mutations commit independently and each advances that stream. Replaying several ordinary mutations therefore exposes intermediate canonical states and cannot later roll the whole promotion back atomically. Conversely, wrapping the whole command log in one new transaction is not ordinary serialized-mutation replay and ordinarily produces one commit version, not fresh versions corresponding to each replayed operation.

The RFC also allows effect-independent writes to “commit normally” while asserting that the entire replay and all intents share one atomic boundary. It never chooses whether:

- promotion is one synthetic canonical transaction/version;
- promotion introduces an atomic multi-mutation batch with defined subversions;
- or replay stages invisibly and atomically activates a prepared result.

**Why material.** This boundary is the primary protection against partial promotion, missing effect intents, and canonical visibility of only a prefix of the selected future. It also directly affects LLP 0007’s version contract, live-query fan-out, crash recovery, CAS against `baseVersion`, and feasibility across SQLite, Durable Objects, and Postgres. Acceptance tests cannot determine the expected result until the transaction/version model is decided.

**Suggested fix.** Choose and specify one portable commit model. The simplest coherent option appears to be: re-execute and validate into a promotion staging overlay, then commit one canonical transaction containing the resulting application-level patch, promotion record, provisional states, and effect intents, allocating one canonical version. If per-operation canonical versions are required, define a new atomic batch/subversion contract and amend LLP 0007/0008 explicitly, including visibility and crash semantics. Remove “ordinary serialized mutations” unless promotion truly uses their existing commit boundaries.

### 2. Promotion can replay authority that has expired or been revoked

**Concern.** The operation log records:

> “principal/grant”

and §3 only says branch authority:

> “cannot exceed the authority of the session that spawned it.”

The RFC does not require promotion-time or effect-attempt-time revalidation of that authority. This is especially important because branches have TTLs, promotion may occur later, and captured effects settle asynchronously after promotion.

LLP 0055 makes grants TTL’d and revocable and explicitly requires queued work to be refused when durable authority ended after enqueue. LLP 0070 likewise says execution must not impersonate a stale session and defaults durable work to fail-closed `revalidatePrincipal`, with `capturedGrant` as an explicitly narrow, expiring alternative.

**Why material.** Without a rule here, a branch can preserve revoked authority: perform a privileged operation while authorized, wait for the grant or membership to end, then promote its writes and initiate payments, notifications, or webhooks under the recorded historical grant. That violates the cited scoped-grant and durable-work settlement contracts.

**Suggested fix.** Define promotion authorization explicitly:

- revalidate every replayed operation against current principal, grant, policy, manifest, and resource authority;
- refuse promotion if any required authority has ended, unless the branch recorded a deliberately issued, still-valid `capturedGrant` satisfying LLP 0070;
- separately revalidate authority at each asynchronous effect attempt, following LLP 0070/0055;
- specify whether an operator’s promotion authority may deliberately substitute for the original principal, with that substitution explicit and audited rather than implicit.

Add revocation/expiry-between-fork-and-promotion and revocation-after-promotion-before-effect fixtures to Acceptance.

## 3. Dispositioned implementation-phase notes

These are important but do not independently block readiness once the material decisions above are settled:

- Define the concrete child cursor encoding, replay-floor persistence, teardown reset signal, and cursor behavior after TTL. Section 1 already decides the semantic model; these are conformance details.
- Specify operation-log canonicalization, artifact retention, size limits, and deterministic comparison of re-executed decisions.
- Inventory exact host egress paths and implement bypass tests. The RFC correctly makes this an implementation gate and does not falsely claim LLP 0036 already provides exhaustive mediation.
- Define limits and GC pressure for branch bases, overlays, ledgers, and concurrent futures.
- Decide the authoritative home and schema for external-effect receipts.
- Specify callback routing for provider webhooks associated with promoted intents.
- Clarify whether cron execution inside a branch is disabled, simulated, or branch-scoped; the existing fail-closed mediation decision provides the governing safety rule.
- Define how tombstones and schema/deployment changes invalidate or rebase a materialized branch base.
- For “capability-gated real firing,” distinguish actual external writes from genuinely read-only calls; firing a write before promotion complicates discard semantics even when provider-idempotent.

## 4. Citation-accuracy check

- **LLP 0088 — verified.** It explicitly says branch creation is deferred, “Do not design it now,” lists branch identity, branch-scoped streams, COW storage, branch-aware live queries/resume, authorization, and GC, and names concrete draft/branch demand or a second signal as the revisit trigger. LLP 0097 accurately qualifies as that trigger.
- **LLP 0008 — substantially accurate.** It defines the bounded `_snapback_changes` journal, post-image changesets, monotonic replay floor, and forced resnapshot below the floor. LLP 0097 correctly does not treat the journal as an arbitrary durable branch base or command log.
- **LLP 0088 retention — accurate.** It explicitly requires history retention not to pin the resume replay floor and calls the two retention clocks independent. LLP 0097 respects that and gives branch-base retention its own TTL lifecycle.
- **LLP 0007 DK-2 — accurate.** It pins one per-logical-app stream with opaque monotonically increasing integers and gap-free commit visibility. LLP 0097 correctly recognizes typed child streams as a required amendment, not an already-supported feature.
- **LLP 0018 — accurate.** It says a logical app owns one storage/version, auth, secrets, realtime, backup, and admin boundary and describes cooperating-app isolation as non-adversarial. The child-stream proposal genuinely changes its “one logical commit-version stream” language.
- **LLP 0066/0070/0043 — partly misattributed.** `retryable | terminal | ambiguousExternalEffect` is concretely defined by LLP 0070; LLP 0066 is Research that endorses and analyzes it, while LLP 0043 governs mutation receipt/ambiguity rules. Saying the taxonomy is “owned by LLP 0066 (F3) + LLP 0043” is inaccurate. Cite LLP 0070 as the normative owner and LLP 0066/0043 as rationale/inherited invariants.
- **LLP 0070 — accurate, but incompletely inherited.** It provides `CaptureOnly`, transactional enqueue, fencing, stable idempotency keys, ambiguity handling, and explicit current-authority revalidation. The last of those exposes material concern 2.
- **LLP 0036 — accurately narrowed.** It owns `uses`-scoped credential access and host-fetch secret unwrapping, not exhaustive egress mediation. LLP 0097 correctly stops calling it a universal egress chokepoint.
- **LLP 0069 — accurate.** It specifies a deterministic conformance provider covering success, rejection, before/after-commit timeout, duplicate/out-of-order webhooks, and related cases.
- **LLP 0045 — accurate.** It specifies a local notification capture adapter/mailbox and durable outbox/provider boundary.
- **LLP 0028 — accurate.** Actions may perform outbound `fetch`, execute outside transaction snapshots, and commit durable changes through mutations; `--cron-disabled` exists.
- **LLP 0043 — accurate.** Its receipts settle mutations, not arbitrary external activities; an external-effect receipt is genuinely new work.
- **LLP 0055 — accurate as motivation, but its revocation semantics are not fully applied.**
- **LLP 0090 — accurate.** It concerns resumable query-result snapshots, not a writable whole-database branch base.
- **LLP 0075 — inaccurate characterization.** LLP 0075 is the Convex checkpoint comparison protocol, including machine/benchmark snapshots; it is not a Snapback query/read checkpoint or writable-database snapshot primitive. Remove it from the snapshot-primitive characterization unless a more precise, non-load-bearing relationship is stated.
- **LLP 0083 — accurate.** It documents DO PITR and D1 bookmarks; it does not establish that a bookmark can seed a forked child database. Marking that mapping unverified is correct.

0097: NOT READY

---

## Round 4 (author-authorized continuation)
- **Revision hash reviewed (sha256, first 16):** 0097 = `09318d9f72822a2c`.
- **Verdict:** 0097 NOT READY (R3 concerns confirmed resolved; 3 new: normative amendment vs 'ratify'; advanced-base 're-execute cleanly' undefined; transitive effect-dependency provenance).
- **Verbatim review below.**

## 1. Summary

LLP 0097 identifies a real missing capability and correctly reopens the work LLP 0088 explicitly deferred. Its strongest decisions are:

- a materialized base plus COW overlay, rather than journal fall-through;
- branch-local typed version streams, preserving the canonical gap-free stream;
- fail-closed host-egress capture;
- command re-execution rather than post-image merge;
- one canonical promotion transaction followed by asynchronous, fenced effect settlement;
- provisional state for assertions dependent on simulated effects.

Those choices generally respect the cited corpus. In particular, promotion is not presented as sync-core semantic merge or as a distributed transaction.

However, three promotion/version-contract decisions remain materially unresolved. They could cause promotion to commit a reality different from the selected future or to promote downstream consequences of effects that never occurred.

## 2. Material concerns

### 1. The required version-stream contract is proposed but not actually ratified

**Concern.** Design §1 says branches “require amending LLP 0007 + LLP 0018,” but Open Question 1 still asks for “ratifying” that amendment, and Status says the RFC is gated on it. The governing documents currently require:

- LLP 0007 §Commit-version graduation: “The version stream is per logical app.”
- LLP 0018 §Default App Boundary: one logical app owns “one logical commit-version stream.”

LLP 0097’s child stream is observably inside that same logical app, so this is not merely target mapping. It changes the portable identity and cursor contract.

**Why material.** The branch substream underlies writes, subscriptions, resume, replay floors, receipts, teardown, and promotion. Accepting an RFC whose central primitive contradicts the still-governing contract leaves implementations free to choose incompatible interpretations: child stream, separate app, or canonical-stream interleaving.

**Suggested fix.** Make 0097 itself normatively amend the two governing rules, with exact replacement language, or require a companion 0007/0018 amendment to be accepted atomically with 0097. Per-target allocator/layout details can remain implementation work; the stream ownership and cursor identity cannot remain an open ratification question.

### 2. Promotion after canonical advancement does not define semantic-equivalence admission

**Concern.** Design §5 says promotion is CAS against `baseVersion`, but then allows promotion when canonical has advanced if operations “rebind and re-execute cleanly.” “Cleanly” is not defined. Re-execution can succeed without a database conflict while producing different data, different effect parameters, or additional effects from those experienced in the selected future.

For example, a checkout command replayed against changed prices could validly execute and enqueue a charge for a different amount. That is neither a sync conflict nor faithful promotion of the future the user selected.

**Why material.** This affects both decision integrity and external-effect safety. A successful re-execution is not evidence that the selected branch’s meaning was preserved.

**Suggested fix.** Choose one normative rule:

- v1 promotion requires canonical head exactly equal to `baseVersion`; otherwise refuse; or
- advanced-base promotion must compare canonicalized decision/effect-intent digests and all relevant read/output facts against the branch execution, with any divergence requiring explicit application-level resolution and renewed operator approval before committing.

“Re-executes without error” must not be sufficient.

### 3. Effect dependency is not required to propagate transitively

**Concern.** Design §5 classifies each operation as effect-independent, effect-intent-producing, or effect-outcome-dependent. It correctly makes a direct assertion such as `order.status = paid` provisional. But it does not state that dependency on a simulated outcome propagates through subsequent reads, writes, commands, and effects.

A later operation might read the simulated `paid` state and create fulfillment, loyalty credit, inventory movement, or another external intent. Treating that later operation as independently promotable would preserve the direct payment assertion as provisional while committing its downstream consequences as truth.

The command log records “simulated-effect outcomes … and their causal ordering,” but recording order is not the same as enforcing transitive causal provenance.

**Why material.** This is the core correctness boundary for effect-replay-on-promotion. Without transitive closure, canonical state can still assert consequences of an effect that later rejects or remains ambiguous.

**Suggested fix.** Require effect-dependency provenance to propagate through every read and derived operation. Every transitively dependent write or effect must either:

- remain provisional behind the same reconciliation identity;
- have an explicit success/rejection/ambiguity continuation; or
- make the branch non-promotable.

Acceptance should include multi-command fixtures where a later command consumes data derived from a simulated result.

## 3. Dispositioned implementation-phase notes

These should be resolved before implementation claims capability, but do not independently block the design:

- Define concrete branch quotas, TTL defaults, suspension, and GC pressure behavior.
- Choose local, Cloudflare, and Postgres physical layouts after the portable child-stream contract is ratified.
- Specify the materialized-base capture algorithm and its authorization-metadata representation.
- Decide whether external-effect receipts amend LLP 0043/0070 or remain owned by 0097.
- Define cursor/reset diagnostics for clients resuming a deleted branch.
- Inventory actual host-egress paths and build the required negative/bypass corpus.
- Keep `HostMediated` and `EndToEnd` separate; the RFC correctly refuses to claim that host capture contains browser SDKs, hosted checkout redirects, or native client modules.
- Specify how permanently refused post-promotion effects expose operationally stuck provisional state. The existing `revalidatePrincipal` choice is coherent, but inspection and repair UX still need definition.

## 4. Citation-accuracy check

- **LLP 0088:** Accurate. §3 says branch creation is deferred, says “Do not design it now,” lists branch identity, branch-scoped streams, COW storage, branch-aware sync/auth/GC, and names concrete draft/branch demand or a second signal as the revisit trigger.
- **LLP 0008:** Accurate. It specifies bounded version-plus-time retention, a monotonic replay floor, and forced resnapshot below that floor. The RFC correctly avoids using the prunable journal as an arbitrary branch base.
- **LLP 0007 / 0018:** Accurate about the current single per-app gap-free stream and the need for an amendment. The unresolved amendment is material, as above.
- **LLP 0066 / 0070 / 0043:** Substantively aligned but attribution is imprecise. The explicit `retryable | terminal | ambiguousExternalEffect` job failure vocabulary is defined in LLP 0070 §Execution and retries; LLP 0066 F3 endorses 0070’s ambiguity vocabulary and explains the external-effect limitation. LLP 0043 supplies mutation-settlement and receipt-less ambiguity rules, not a general external-effect taxonomy.
- **LLP 0070:** Accurate regarding transactional enqueue, `CaptureOnly`, leases, fencing, stable idempotency, `revalidatePrincipal`, and `capturedGrant`.
- **LLP 0036:** Accurately limited. It provides per-function `uses` grants and, on the Cloudflare profile, host-boundary credential unwrap. It does not prove exhaustive egress mediation; 0036 explicitly records local host-mediated fetch as a gap and permits explicit secret exposure for unsupported SDK shapes.
- **LLP 0069:** Accurate regarding durable payment intent, stable provider idempotency, ambiguity/reconciliation, and the deterministic conformance provider.
- **LLP 0045:** Accurate regarding durable notification intents, action-based delivery, `uses` grants, and a local capture adapter.
- **LLP 0028:** Accurate regarding egress-bearing actions, repeated-egress risk under recovery, and `--cron-disabled`.
- **LLP 0055:** Accurate regarding finite/revocable grants and per-invocation validation. The specific queued-work modes come more directly from LLP 0070.
- **LLP 0090:** Accurate: it defines resumable query-result snapshots and stream-bound tokens, not writable database snapshots.
- **LLP 0075:** Inaccurately characterized as a “checkpoint snapshot” read primitive. LLP 0075 is a competitive evaluation/checkpoint protocol; its machine snapshot and authoritative reconnect fixture do not supply a reusable Snapback database snapshot primitive. This should be removed from the snapshot-related citation.
- **LLP 0083:** Accurate. It records 30-day DO PITR and lexically comparable bookmarks but does not establish that bookmarks can fork a child database/DO.

0097: NOT READY

---

## Round 5 (author-authorized continuation)
- **Revision hash reviewed (sha256, first 16):** 0097 = `a04c8dd03aff6784`.
- **Verdict:** 0097 READY — **first codex READY; zero material concerns.**
- **Verbatim review below.**

## 1. Summary

LLP 0097 is a strong, safety-conscious proposal. It correctly identifies Exact’s live-futures workflow as LLP 0088’s named trigger for revisiting data branching, preserves the canonical per-app version stream by introducing non-comparable typed child streams, avoids sync-core semantic merge, separates branch-base retention from both journal replay retention and product-history retention, and treats real external effects as a staged settlement problem rather than pretending they can be transactionally atomic.

The most important decisions are coherent:

- v1 forks only from a materialized current-head image.
- Branches read from an immutable base plus COW overlay, never canonical fall-through.
- v1 promotion refuses if canonical head differs from `baseVersion`.
- Promotion re-executes commands in a staging overlay and commits one canonical version.
- Simulated-effect-dependent facts, including transitive consequences, cannot become canonical truth before real settlement.
- External effects begin only after the atomic data/promotion/intent commit.
- Ambiguous provider outcomes remain ambiguous and cannot be converted into success by generic retry.
- Host-mediated and end-to-end isolation are reported separately.
- Branch execution fails closed when an egress path is unproved.

I found no unresolved material defect in correctness, coherence, feasibility, safety, or decision quality.

## 2. Material concerns

None.

The remaining uncertainties are substantial implementation work, but the RFC either decides the safety-sensitive behavior or gates capability claims until evidence exists. They do not leave an unsafe product decision open.

## 3. Dispositioned implementation-phase notes

1. **Promotion idempotency mechanics.**  
   The implementation should give `promotionId` a canonical uniqueness constraint and perform the `head == baseVersion` CAS, promotion-record insertion, staged patch, and canonical effect-intent insertion in the same storage transaction. The RFC already requires the relevant atomic boundary and stable promotion/effect idempotency keys; the exact schema and retry response are implementation details.

2. **Transitive effect provenance.**  
   “Effect-outcome dependence propagates through every subsequent read and derived write/effect” is the correct decision. Implementing that will require an explicit provenance representation, validation algorithm, and diagnostic for unsupported flows. This is difficult but not underdecided at RFC altitude: fail-closed non-promotability is already specified.

3. **Exhaustive egress inventory.**  
   Each action runtime, provider adapter, outbound-webhook sender, notification runner, server/native module, and credential-free fetch path needs a mechanically maintained mediation inventory. The acceptance section already makes negative/bypass evidence a capability gate.

4. **Branch-base capture details.**  
   Atomic capture of rows, tombstones, schema/deployment identity, and authorization metadata needs a target-specific protocol, including concurrent schema activation and reset behavior. The RFC has correctly defined the required observable result without prematurely choosing a physical layout.

5. **Retention and teardown limits.**  
   Default TTLs, byte/row caps, suspended-branch behavior, and deletion batching remain to be selected. They do not weaken the mandatory rule that branch retention is independent and must never pin the parent replay floor.

6. **Canonical document reconciliation.**  
   If 0097 is accepted, its typed-child-stream amendment should also be incorporated directly into LLP 0007 and LLP 0018 as living-document updates. Keeping the normative text only in 0097 would create avoidable corpus drift, but the decision itself is already clear.

7. **External-effect receipt ownership.**  
   Open Question 6 is organizational rather than semantic. The RFC expressly defines the receipt as new surface and does not falsely claim LLP 0043 already owns arbitrary external-effect receipts.

## 4. Citation-accuracy check

- **LLP 0088 — accurate and load-bearing.**  
  Section “3. Branch creation — defer” says: “Do not design it now” and names reopening when history produces “concrete user asks for draft/branch workflows, or a second independent demand signal.” It also explicitly lists branch identity, branch-scoped version streams, COW storage, branch-aware live queries/resume, authorization, and lifecycle GC. Section 4 rejects merge policy in the sync core. Section 5 requires history and resume retention clocks to remain independent.

- **LLP 0008 — accurate.**  
  The journal is a bounded changeset journal with row post-images, pruning by retention limits, a monotonic replay floor, and resnapshot below that floor. 0097 correctly refuses to treat this prunable journal as an arbitrary historical branch base or as an invocation log.

- **LLP 0007 — accurate.**  
  “Commit-version graduation (DK-2)” pins the stream per logical app and requires gap-free commit visibility. A branch-visible second stream is therefore a genuine contract change. The proposed `(childStreamId, version)` identity and non-comparability preserve the canonical stream rather than interleaving speculative commits into it.

- **LLP 0018 — accurate.**  
  “Default App Boundary” currently assigns a logical app “one logical commit-version stream.” It also explicitly characterizes its isolation as protection against “bugs and accidents between cooperating apps,” not adversarial code. 0097 accurately acknowledges both the amendment and the security limit.

- **LLP 0066 / LLP 0070 — mostly accurate, with an attribution correction.**  
  LLP 0066 F3 correctly states that external effects cannot be made exactly-once by transactional bookkeeping and recommends declared capabilities such as transactional, provider-idempotent, provider-queryable, compensatable, and inherently ambiguous. LLP 0070 actually defines the operational outcome classes `retryable`, `terminal`, and `ambiguousExternalEffect`, plus fencing, stable idempotency, `CaptureOnly`, `revalidatePrincipal`, and `capturedGrant`.  
  Therefore, 0097’s statement that the taxonomy is “owned by LLP 0066 (F3) + LLP 0043” is imprecise: 0066 is Research and recommends the settlement-capability vocabulary; 0070 owns the job outcome classes. This is citation hygiene, not a defective decision.

- **LLP 0036 — accurately bounded.**  
  It owns per-function `uses` grants, action-only secret handles, redaction, and credential unwrapping at host fetch. It does not prove exhaustive control of credential-free fetch or every provider/native egress path. Section “Effect isolation” correctly says branch egress mediation is new prerequisite work and that `uses` is not the universal chokepoint.

- **LLP 0069 — accurate.**  
  It provides the deterministic conformance provider and covers success, rejection, pre/post-commit timeouts, duplicate responses/webhooks, and other provider ambiguity cases. It also rejects making application state and provider history appear atomic.

- **LLP 0045 — accurate.**  
  It separates durable notification intent from side-effectful delivery and includes a local capture adapter. It supports 0097’s adapter analogy without supplying general branch isolation.

- **LLP 0028 — accurate.**  
  Actions are the egress-bearing execution class, may `fetch`, are not action-level transactions, and may repeat egress under recovery even when nested mutations deduplicate. The cited `--cron-disabled` behavior is real.

- **LLP 0043 — substantially accurate.**  
  It owns durable mutation-settlement and receipt facts, not arbitrary external-activity settlement. 0097 correctly calls external-effect receipts an extension. Its ambiguity rule is consistent with 0043, although the clearest “generic retry cannot manufacture an outcome” wording is in LLP 0070.

- **LLP 0055 — accurate.**  
  It defines scoped, TTL’d, revocable grants, host-enforced non-widening, and live-authority validation at settlement. Revalidating promotion and each later effect attempt is consistent with it.

- **LLP 0090 — accurate.**  
  It defines resumable query-result snapshots and tokens, not writable full-database images. It cannot supply 0097’s materialized branch base.

- **LLP 0075 — inaccurate citation, non-load-bearing.**  
  LLP 0075 is the “Convex checkpoint protocol,” a competitive evaluation/preregistration document. It is not a storage checkpoint or database-snapshot primitive. Describing “LLP 0075 / LLP 0090” together as “query/read & checkpoint snapshots” is misleading. Remove LLP 0075 from this branch-base discussion unless the intended reference was another LLP. Because 0097 explicitly says these documents do **not** supply the branch base, the bad citation does not undermine its design.

- **LLP 0083 — accurate and appropriately qualified.**  
  It records Cloudflare SRS/DO PITR and lexically comparable bookmarks but does not establish that a bookmark can fork a child DO. 0097 correctly labels that mapping unverified and non-anchoring.

Overall, the two citation defects—LLP 0075 and the overbroad 0066/0043 taxonomy attribution—should be corrected, but neither changes a material decision.

0097: READY
