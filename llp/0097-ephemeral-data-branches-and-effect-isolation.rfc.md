# LLP 0097: Ephemeral data branches and effect isolation for live futures

**Type:** RFC
**Status:** Accepted
**Systems:** Storage, Sync, Effects, API, Auth, Deployment
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-25
**Revised:** 2026-07-25 (initial draft); 2026-07-25 (super-refine R1→R2: promotion staged not cross-system-atomic; branch-egress-mediation as a prerequisite, not the 0036 seam; materialized branch-base primitive, 0075/0090 de-cited as the base; command/operation-log replay + simulated-effect revalidation; firm version-substream contract); 2026-07-25 (R2→R3: decide the version-stream question — propose LLP 0007/0018 typed-child-stream amendment; promotion provisional/pending-state machine for effect-outcome-dependent writes; host-mediated vs end-to-end isolation-scope split; 0083 bookmark-fork marked unverified; editorial: Status Review, inbound-webhook reclassified as ingress, red-team qualified); 2026-07-25 (R3→R4: promotion commit model pinned — re-execute into a staging overlay, commit one canonical transaction/version, drop "ordinary serialized mutations"/"fresh versions"; authority revalidated at promotion + each effect attempt, not preserved from fork); 2026-07-25 (R4→R5: 0007/0018 amendment made normative in-doc, not "to ratify"; v1 promotion requires exact base equality — refuse on any canonical advance, since "re-executes cleanly" ≠ meaning-preserved; effect-outcome dependence made transitive through downstream reads/writes/effects); 2026-08-03 (LLP 0164 implementation note — the named post-image promotion and mutable-base deviations are corrected; acceptance and every capability claim remain gated)
**Related:** LLP 0088 (record history and branching — defers this capability), LLP 0008 (local-first sync, journal, retention/replay-floor), LLP 0007 (storage portability, per-app version stream — **amended** here for typed ephemeral child streams), LLP 0018 (app-instance boundaries — **amended** here for child streams), LLP 0066 (effect lessons — settlement taxonomy), LLP 0070 (durable background work — `CaptureOnly`, fencing/idempotency), LLP 0036 (secrets & `uses` grants — the egress boundary), LLP 0069 (payment provider boundary — conformance provider), LLP 0045 (notifications outbox — capture adapter), LLP 0028 (cron/actions — egress-bearing execution + `--cron-disabled`), LLP 0043 (offline replay & receipts), LLP 0055 (agent principals & scoped grants), LLP 0075 / LLP 0090 (query/read & checkpoint snapshots — related read primitives, NOT the branch-base), LLP 0083 (Cloudflare DO/D1 prior art — PITR/bookmarks), [Exact LLP 0390 (Design Mode as a Live Canvas)](../../exact/llp/0390-design-mode-live-canvas.rfc.md)

## Summary

Exact's Design Mode wants to run **several live "futures" of the same app side by side, on real data** — you *use* three checkout flows and keep the one that feels right ([Exact LLP 0390](../../exact/llp/0390-design-mode-live-canvas.rfc.md), feature 2). Doing that safely requires a Snapback capability that does not exist today: an **ephemeral, forkable, effect-isolated data branch** — a short-lived writable copy of real data, forked from a base version, that diverges independently, **never fires real external effects**, tears down cleanly, and can be **promoted** back to the canonical app.

LLP 0088 decomposed "history and branching" and **explicitly deferred data branching** ("Do not design it now"), naming the revisit trigger: a *concrete draft/branch workflow ask, or a second independent demand signal*. This RFC is that trigger. It does **not** re-open the deferred items casually — it inherits 0088's hard constraints (no semantic merge in the sync core; two independent retention clocks; the per-app version-stream fact) and reuses the existing change journal, effect taxonomy, durable-work model, and egress-grant seam rather than inventing parallels.

The genuinely new work is two coupled things: (1) **effect isolation** — mediating every external-effect egress so that, inside a branch, effects are *captured* as durable intents instead of fired; and (2) **effect-replay-on-promotion** — when a branch is promoted, its data **re-executes into a staging overlay and commits as one canonical transaction**, and its captured effects then **settle** for real under the existing settlement invariant (LLP 0066/0070). Because external effects can never be transactional, that coupling is a **single staged transition**, not cross-system atomicity: the data replay + a promotion record + durable effect *intents* commit atomically, after which the external effects settle asynchronously under idempotency keys. That staged data-branch-plus-captured-effect-ledger promotion is the core of this design.

This is not a Design-Mode-only feature. The same primitive is what preview/PR data environments, agent sandboxes (including Exact's adversarial red-team agent), and "design against a real user's actual session" all need. Design Mode is simply the first consumer.

## Motivation

### The hazard: real data × N live futures

Running several interactive futures against live Snapback data can **charge a card three times, send three emails, fire three webhooks**, and one future's writes can silently invalidate the comparison. Contract-IR forks and state-preserving HMR isolate the *UI and client state*; they do nothing for the *backend*. Without a backend isolation primitive, "many live futures on real data" is unsafe by construction — which is why Exact LLP 0390 names per-future Snapback isolation as a **prerequisite it does not assume** (0390 Open Question 5). This RFC owns that prerequisite.

### We are LLP 0088's named revisit trigger

LLP 0088 §3 deferred data branching but enumerated exactly what it would cost — branch identity in the data model, **branch-scoped commit-version streams** (the DK-2 concern against LLP 0007's single gap-free stream), **copy-on-write row storage**, branch-aware live queries/subscriptions/resume, per-branch authorization, and **branch lifecycle GC** — and set the reopen condition: "a concrete draft/branch workflow ask." Exact's live futures are that ask. We take 0088's list as our invariant checklist rather than rediscovering it.

### Broadly useful, not a point feature

The ephemeral-branch-with-effect-isolation primitive generalizes cleanly to: **preview/PR data environments** (each PR branch gets an isolated data namespace), **agent sandboxes for *cooperating* agent code** (an agent tries a change against real-shaped data without touching production — Exact's red-team agent is a consumer; untrusted *generated* code still needs LLP 0009 isolation, per §Design 1's cooperating-not-adversarial posture), **"design against the bug"** (fork from a specific captured session/state), and **safe tests on production-shaped data**. Building it as a first-class Snapback capability, with Design Mode as consumer #1, is the right altitude.

## What this RFC does not re-specify (claim boundary, build-on)

- **Record-level read-only history** stays owned by LLP 0088 (capability 1); we *consume* it, not redefine it.
- **The change journal `_snapback_changes`** (per-row post-image per committed version, LLP 0008) and its **retention/replay-floor** rule are reused verbatim; a branch is a **materialized base at version *V* + an operation/command log + a COW overlay** (§Design), and history retention must never pin the resume replay floor (0088 §5, two independent clocks).
- **Semantic merge in the sync core is permanently declined** (0088 §4). Promotion here is **application-level command re-execution into a staging overlay, committed as one canonical transaction**, never field-level LWW merge inside sync.
- **The effect/step taxonomy and settlement invariant** are owned by LLP 0066 (F3) + LLP 0043; we reuse `retryable | terminal | ambiguousExternalEffect` and "retries can never manufacture a terminal external outcome," and do not recoin them.
- **Durable job / lease / fencing / idempotency machinery** is owned by LLP 0070; captured effects are modeled *in its idiom* (its `CaptureOnly` class is nearly this primitive), not a new queue.
- **The egress credential model** — LLP 0036 `uses` grants — is reused for credential access; but a complete **branch egress mediation** contract (branch identity at *every* host egress initiation, including credential-free and client-side paths) is a **prerequisite this RFC defines** (§Design 2), not something 0036 already provides.
- **Whole-app provisioning and rollback** stay with LLP 0089; we borrow only its *publication-vs-activation* pattern to frame promotion as an explicit transition.

## Design

### 1. The branch is an ephemeral child of a logical app

A **future branch** is a short-lived, writable child *within one logical app's trust boundary* (LLP 0018), not a new logical app. It inherits 0018's **cooperating-not-adversarial** posture: branches guard against bugs and accidental cross-talk, not malicious code (that remains LLP 0009's job). A branch owns its own divergent storage overlay, version substream, subscription namespace, and captured-effect ledger; it shares the parent app's schema, function bundle, secrets namespace, and auth namespace (with scoped-down authority, §4).

- **Fork from a materialized base (a new primitive).** A branch is created from a **materialized branch-base**: a full branch-visible image captured atomically at one canonical head — every row/table the branch may read, with tombstone semantics, plus schema/deployment identity and authorization metadata — **retained independently of the parent replay-floor and history-retention clocks**. This is *not* supplied by existing work: LLP 0075/0090 are query-result / checkpoint snapshots, not a writable full-database image, and the pruned `_snapback_changes` journal cannot preserve an arbitrary base. **v1 forks the current canonical head only;** forking a *prior* captured state ("design against the bug") is a separate historical-snapshot capability, deferred. The branch records its `baseVersion` for promotion (§5).
- **Copy-on-write divergence.** Reads resolve against the branch overlay over the **materialized base** — never live canonical, so canonical drift after the fork cannot leak into the branch; writes land in the branch's overlay journal. This is the COW row storage 0088 §3 named as a cost, specified here for the ephemeral case only.
- **Branch-scoped version substream — requires amending LLP 0007 + LLP 0018.** A branch has a **distinct stream identity** with **locally monotonic, gap-free** versions, *not* numerically comparable to the canonical stream (`baseVersion` is a fork pointer, not a shared coordinate). Because branch subscriptions and resume expose this second stream to clients *within one logical app*, this is exactly the DK-2 change LLP 0088 §3 predicted — so 0097 **normatively amends the governing rules** rather than merely proposing:

> **Amendment (normative, accepted atomically with this LLP).** LLP 0007 §Commit-version graduation and LLP 0018 §Default App Boundary currently read that a logical app has *one* logical commit-version stream. This is replaced by: **a logical app has one canonical commit-version stream plus zero-or-more typed *ephemeral child streams*.** Each child stream has its own `(childStreamId, version)` cursor identity, its own gap-free monotonic versions, and its own independent replay floor and reset/teardown; child-stream versions are **never numerically comparable** to the canonical stream (`baseVersion` is a fork pointer, not a shared coordinate). The canonical stream's contract is otherwise unchanged.

The canonical gap-free stream is unchanged; branch versions live only in the child stream, and **promotion commits one canonical transaction (one new canonical version)** via re-execution into a staging overlay (§5). What remains open (Open Question 1) is only the **per-target allocator/layout conformance** (SQLite child stream, Cloudflare, Postgres) — the stream-ownership and cursor-identity contract is decided here, not deferred.
- **Branch-aware live queries.** Subscriptions inside a branch resolve against `overlay ∪ base@baseVersion`; the matcher/resume machinery (LLP 0008) runs on the branch substream. A future's canvas subscribes to *its* branch, so its live queries reflect *its* divergence.

### 2. Effect isolation — intercept, don't fire (the net-new core, part 1)

Effect isolation requires that **branch identity reaches every host-mediated egress initiation** — a **branch egress mediation** contract this RFC treats as a *prerequisite*, not an existing fact. Most effect paths do flow through `uses`-granted actions at the host egress boundary (payments 0069, notification delivery 0045, outbound webhooks 0070, `fetch` in actions 0028) — but **LLP 0036 governs credential/secret access, not exhaustive egress mediation**, and credential-free `fetch` and server-side provider-SDK activity are *not* covered by a `uses` grant. So the mediation contract must: inventory every outbound-initiation path by subsystem and execution locus; require branch identity + isolation mode at the **actual host egress operation** (not merely at credential access); and **refuse branch execution** for any action, adapter, native module, or target lacking proved mediation. One un-mediated host path is enough to charge or send for real from a supposedly isolated branch, so **exhaustive negative/bypass tests gate the capture class** (§Acceptance) — not merely an "effect-safe" label. (Inbound webhooks are *ingress*, not egress; the branch concern there is callback routing + downstream reconciliation, handled at promotion, not interception.)

**Host mediation is a *baseline*, not end-to-end future isolation.** Host-side mediation cannot contain effects a *client* initiates directly: a branch UI holding an ordinary user session can redirect to a hosted checkout, call a provider SDK, or invoke a native module without ever traversing the Snapback host boundary — and "refuse branch execution" on the backend does not stop the client. So this RFC's baseline capability is **host-mediated effect isolation**. **End-to-end future isolation** (containing client-side effects too) is a *distinct, stronger* contract — branch-aware generated clients, network/SDK allowlisting, provider test-account isolation, callback routing, hosted-page restrictions, native-module refusal — and requires Design Mode (Exact LLP 0390) to suppress or replace client effect paths in a future. Capability reporting distinguishes the two (see §Capability classes); the host capture class never implies end-to-end isolation.

- **Default-deny capture.** Inside a branch, a mediated effect is **captured as a durable intent, not executed** — recorded to the branch's **captured-effect ledger** in the LLP 0070 `CaptureOnly` idiom (transactional enqueue + inspection, no worker firing). An effect that reaches egress but cannot be classified or mediated is **blocked and captured, never fired** — fail-closed, matching the house posture (the double-charge hazard lives exactly here).
- **Per-effect settlement capability.** Each captured effect declares the settlement capability LLP 0066 recommends each external step declare (`transactional | provider-idempotent | provider-queryable | compensatable | inherently-ambiguous` — a recommended vocabulary, not yet an owned/accepted taxonomy). This governs whether and how it settles on promotion (§5) and whether it may be *simulated* meanwhile.
- **Simulation adapters, generalized from existing patterns.** For a live future to behave realistically, some effects want a *simulated* response (a fake charge success, a captured email). We generalize the two patterns Snapback already ships: the LLP 0069 **deterministic conformance provider** (simulates success/rejection/timeout-before-commit/timeout-after-commit/duplicate-webhook) and the LLP 0045 **local capture adapter** (captures notifications to a mailbox). In a branch, `uses`-gated egress resolves to a **branch simulation adapter** that records the intent and returns a declared simulated outcome, rather than the real provider.
- **Capability-gated real firing.** An operator/session may opt a *specific* effect to really fire from a branch (rare; e.g. a genuinely idempotent read) via an explicit capability grant — never the default.

### 3. Receipts and scoped identity

- **Branch-tagged receipts.** Every mutation/subscription receipt (LLP 0043's mutation-settlement receipts) gains the originating **branch id + isolation mode**; captured effects get **new external-effect receipts** (0043 covers mutation settlement, not arbitrary activity — this is a defined extension, not a reuse; whether it amends 0043/0070 or gets its own authority is Open Question 6). Receipts are what let the canvas and the runtime attribute state to a future and what promotion reconciles against.
- **Scoped authority, revalidated at promotion and at each effect attempt.** A branch runs under a **scoped grant** (LLP 0055) that cannot exceed the authority of the session that spawned it. Because grants are TTL'd and revocable (LLP 0055) and a branch may be promoted long after it was created, promotion **revalidates every replayed operation against current principal, grant, policy, and manifest** and **refuses** if any required authority has ended — unless the branch holds a deliberately-issued, still-valid `capturedGrant` satisfying LLP 0070's fail-closed `revalidatePrincipal` default. **Each asynchronous effect attempt** (post-promotion settlement) revalidates authority again (LLP 0055/0070). If an operator's promotion authority deliberately substitutes for the original principal, that substitution is **explicit and audited**, never implicit. Recorded historical authority is never silently reused.

### 4. Teardown (unowned territory today)

Futures are ephemeral. A branch — its overlay journal, substream, subscription namespace, captured-effect ledger, and receipts — is discarded cleanly on **explicit kill or TTL**, leaving no residue in the canonical app and never pinning the parent's replay floor (0088 §5). LLP 0089 explicitly leaves data-teardown unowned (its Open Question 4) and 0088's branch-GC is unwritten; ephemeral-branch teardown is specified here as bounded and mandatory, with a drain/cancel/inspect lifecycle borrowed from LLP 0070.

### 5. Promotion — command replay + staged effect settlement (the net-new core, part 2)

Promotion makes one future's branch the canonical reality. It is **not** a sync-core merge (0088 §4 forbids that), and it is **not** a blind replay of row post-images — `_snapback_changes` is a changeset of committed post-images, not an invocation log, so it cannot on its own drive a safe promotion.

- **Promotion replays a durable operation/command log, not post-images.** A promotable branch records, per invocation: function/artifact identity, canonical arguments, principal/grant, read baseline, idempotency identity, and — load-bearing — **the simulated-effect outcomes it observed and their causal ordering** relative to later writes. (This is net-new; the row journal lacks all of it.)
- **Data replay re-executes into a staging overlay, then commits once.** Promotion re-executes the branch's operation log **into a promotion staging overlay** (never directly onto canonical), validating each resulting decision against current canonical state. **v1 promotion requires the canonical head to equal `baseVersion`** (compare-and-swap): **if canonical has advanced since the fork, promotion refuses** and the user re-forks from current head. This is deliberate — a re-execution that merely runs *without error* on an advanced base is **not** evidence the selected future's meaning was preserved (e.g. a checkout command replayed against changed prices could validly enqueue a charge for a *different amount*). Faithful advanced-base promotion (comparing canonicalized decision + effect-intent digests and the relevant read/output facts against the branch execution, with any divergence forcing explicit application-level resolution and renewed operator approval) is a **later enhancement**, not v1. On success the staged result — the application-level patch + provisional states + promotion record + durable effect intents — commits as **one canonical transaction allocating one canonical version**, *not* as independent per-operation mutations (which would expose a partial prefix or resist atomic rollback). The alternative *state-diff* model (explicit patch + preconditions + conflict handlers) uses the same single-transaction boundary. Per-operation canonical versions, if ever wanted, would need a separate atomic-batch/subversion amendment to LLP 0007/0008 — out of scope here.
- **Effect-outcome-dependent writes commit only as provisional state (the causal boundary).** Classify each branch operation as **effect-independent**, **effect-intent-producing**, or **effect-outcome-dependent**. In the promotion transaction: effect-independent writes commit normally; an effect-outcome-dependent canonical assertion (e.g. `order.status = paid`, contingent on a *simulated* `chargeSucceeded`) commits **only as explicit provisional/pending state**, together with the durable effect intent and a continuation/reconciliation identity — **never as asserted truth**. Provider settlement then invokes a **fenced reconciliation mutation** (LLP 0070) that transitions the pending state to `succeeded | rejected | ambiguous`. **If the application declares no pending representation and reconciliation handler for a dependency, the branch is non-promotable** (fail-closed). "Settle the real effect before the promotion commit" is explicitly *not* offered — that would fire an external effect before the durable boundary. **This dependency is transitive.** Effect-outcome dependence propagates through every subsequent read and derived write/effect: a later operation that consumes a simulated `paid` state (creating fulfillment, loyalty credit, inventory movement, or another external intent) is itself effect-outcome-dependent and must either **stay provisional behind the same reconciliation identity**, carry its **own explicit success/rejection/ambiguity continuation**, or make the branch **non-promotable**. Recording causal order in the operation log is necessary but not sufficient — provenance must be *enforced* transitively, so canonical state can never assert a downstream consequence of an effect that later rejects or stays ambiguous. This provisional-then-reconcile boundary is the guard against canonical data ever asserting a provider success (direct or downstream) that has not actually occurred.
- **The atomic boundary is staged, not cross-system.** Promotion **atomically commits** the **single staged canonical transaction** (data patch + provisional states + promotion record + durable **canonical effect intents**). The external effects then **settle asynchronously** under stable promotion/effect idempotency keys (LLP 0070 fencing), exposing promotion states `committedEffectsPending | settled | ambiguousExternalEffect`. **Once an external effect is initiated, promotion is never rolled back or reported as a no-op;** an ambiguous effect requires provider lookup or idempotency recovery before any retry (the LLP 0066/0043 invariant — retries can never manufacture a terminal external outcome). Cross-system transactional atomicity with providers is not claimed, because it is impossible (LLP 0045/0069).

Non-promoted branches are discarded (§4) or kept as inert alternatives. A promotion emits a receipt/checkpoint recording its state and settled/pending/ambiguous effects.

### 6. Portability

Following LLP 0088's discipline (never elevate a one-provider ops trick to product API):

- **Local (Rust SQLite, `crates/snapback/src/storage.rs`):** COW overlay + branch substream over `_snapback_changes`; the reference implementation and conformance target.
- **Cloudflare DO (`targets/cloudflare/src/coordinator.js`):** DO PITR + lexically-comparable bookmarks (LLP 0083) are a recovery / read-consistency primitive; *whether* a bookmark can seed a forked child-DO base is **unverified** (LLP 0083 is silent on forking) and is Open Question 2 — a non-anchoring, one-provider, ops-layer candidate only. The portable contract is the branch/overlay/capture model above, not any bookmark mechanism.
- **Postgres graduation (LLP 0046):** branch semantics on Postgres (schema-per-branch vs row-namespace vs logical copy) is an Open Question; the portable contract must not assume any one of them.

## Capability classes and honesty

Mirroring LLP 0070's capability-class discipline and snapback's Online-vs-Parity honesty rule (LLP 0012), a target advertises **two orthogonal axes**. **Branch capability:** `Missing` (no branching), `CaptureOnly` (branch + host-side capture, no real-effect promotion), `Promotable` (data re-execution + staged effect settlement). **Isolation scope:** `HostMediated` (host-side effects captured; **client-side effects not contained**) vs `EndToEnd` (client effects also contained — requires the client-isolation contract + Design Mode participation, §Design 2). A target **must not report a weaker class or scope as a stronger one**, must not report `EndToEnd` while any client path can escape, and must declare any effect subsystem it cannot mediate **unsafe-in-branch** rather than silently let it fire.

## Non-goals and claim boundary

- **Not general/persistent data branching.** This is the *ephemeral* case (short-lived, throwaway-or-promote), which is what unblocks live futures; the persistent product-surface branching 0088 deferred remains deferred.
- **Not semantic merge in the sync core** (0088 §4). Promotion is command re-execution / explicit state-diff + conflict resolution.
- **Not cross-system transactional atomicity.** External effects settle asynchronously post-commit under idempotency keys (LLP 0066/0070); promotion never claims to make providers transactional, and never rolls back after an effect is initiated.
- **Not a new effect taxonomy, sync journal, or queue** — reuse LLP 0066/0070/0008. (This RFC *does* define net-new pieces: a materialized branch-base, an operation/command log, a branch-egress-mediation contract, and external-effect receipts — each called out as such.)
- **Not an adversarial sandbox** — branches are cooperating-not-adversarial (LLP 0018); untrusted-code isolation stays with LLP 0009.
- **Claim boundary (while Draft):** no capability manifest may report a branch-isolation class above `Missing`, and **no effect may be marked branch-safe**, until the branch-egress-mediation contract and the staged promotion/effect-settlement path pass the Acceptance corpus below.

## Acceptance (executable evidence)

- **Base isolation:** a branch's reads never observe canonical writes made after the fork — proven against a **materialized base**, not journal fall-through — including tombstoned/deleted rows.
- **No cross-branch / no-canonical writes:** a mutation in branch A is invisible to branch B and to the canonical app until promotion; conformance proves isolation across concurrent branches.
- **Host-mediated egress is exhaustive; client scope is declared, not assumed:** negative/bypass tests prove no *host-mediated* path (credential-free `fetch` in actions, outbound webhook, server-side provider call, native host module) can initiate a real effect from a branch — an un-mediated or unclassifiable host path is proven **blocked-and-captured** (fail-closed), gating `CaptureOnly`/`HostMediated`. Client-initiated effect paths (browser/native SDK, hosted-checkout redirect) are **out of scope for host mediation**; a target must not report `EndToEnd` unless client containment (Design Mode suppression/replacement + client allowlisting) is separately proved.
- **No real effects fired in a branch:** every effect subsystem (payments 0069, notifications 0045, cron/actions 0028, webhooks 0070) is exercised in a branch and proven to **capture, not fire**.
- **Clean teardown:** after kill/TTL, no branch residue remains in the canonical app and the parent replay floor is unmoved.
- **Promotion data replay is compare-and-swap-safe, re-executed, and v1-strict:** onto an unadvanced base (canonical head == `baseVersion`), branch operations re-execute + validate into a staging overlay and commit as one canonical transaction; **onto any advanced base, v1 promotion refuses** (proven by a fixture); a write contingent on a *simulated* effect outcome is never committed as truth.
- **Effect dependence is transitive:** a multi-command fixture where a later command consumes data derived from a *simulated* result (e.g. fulfillment created off a simulated `paid`) proves the downstream write/effect is itself held provisional under the same reconciliation identity (or the branch is non-promotable) — canonical state never asserts a downstream consequence of an unsettled effect.
- **Effect settlement is staged, never claimed atomic:** the data replay + promotion record + canonical effect intents commit atomically; effects then settle asynchronously per settlement capability (exactly-once where the capability allows; explicit `ambiguousExternalEffect` where not), under LLP 0070 fencing/idempotency; **once an effect is initiated, promotion is never rolled back or reported as a no-op**. Crash tests exercise every promotion boundary, including immediately before/after external initiation and provider acceptance.
- **Authority is revalidated, not preserved:** a grant revoked between fork and promotion makes promotion refuse (absent a valid `capturedGrant`); a grant revoked after promotion but before an effect settles makes that effect attempt refuse — both proven by fixtures.
- **Portability parity:** the local reference and at least one hosted target agree on the branch/capture/promote conformance corpus.

## Open questions

1. **Per-target child-stream conformance.** §Design 1 **normatively amends** LLP 0007/0018 to allow typed ephemeral child streams (stream-ownership + cursor identity are decided, not open); what remains is per-target allocator/layout conformance — local SQLite child stream, Cloudflare, and Postgres (row-namespace vs schema-per-branch vs logical copy) — each proving cursor identity, independent replay floor, and reset/teardown. The rejected-but-recorded alternative is modeling a branch as a separate logical app/instance (0018/0089), heavier on provisioning/auth/secret-sharing.
2. **Cloudflare and Postgres mappings.** *Whether* a DO bookmark can even seed a forked base (unverified; LLP 0083 doesn't establish it); schema-per-branch vs row-namespace on Postgres — which satisfy the portable child-stream contract without becoming load-bearing?
3. **Proving host-egress mediation exhaustive (gating prerequisite, §Design 2).** Fail-closed only works if branch identity reaches *every host* egress initiation. Which host paths are not yet mediated today — credential-free `fetch`, server-side provider SDKs, native modules — and which must be closed (or branch-refused) before any `CaptureOnly` claim? (Client-side containment is the separate `EndToEnd` scope.)
4. **Base-state capture UX.** How does a future choose its base — current canonical, a named snapshot, or a specific captured user session ("design against the bug")? Who is authorized to fork from another user's state, and under what scoped grant (LLP 0055)?
5. **Resource bounds for N concurrent futures.** COW overlays + captured-effect ledgers for many live branches — what are the default caps, suspension, and GC pressure limits?
6. **Ownership of external-effect receipts.** LLP 0043 covers mutation settlement; the new external-effect receipt shape — does it live here or as an amendment to 0043/0070?

## Status

**Accepted** (super-refine converged Round 5 — fable + codex both READY; began as Draft). Implementation is gated by the Acceptance corpus. (The LLP 0007/0018 typed-child-stream amendment is normative in §Design 1, accepted atomically with this LLP; only per-target conformance remains open.) Until the corpus passes, the claim boundary above holds: no target may advertise a branch capability above `Missing`, and no effect may be marked branch-safe. First consumer and motivating driver: Exact Design Mode live futures ([Exact LLP 0390](../../exact/llp/0390-design-mode-live-canvas.rfc.md)).

## Amendment (2026-08-03 — LLP 0162, effective with its acceptance)

Accepted LLP 0162 (agent-safe storage profile) amends this RFC in the
following enumerated places; LLP 0164 carries the implementation-altitude
contracts.

- **§Capability classes.** The single ordered branch axis is split into
  orthogonal axes: egress policy (`Missing` | `DenyAll` | `CaptureOnly`),
  promotion (`NotPromotable` | `Promotable`), base (`currentHead` |
  `namedCheckpoint`; promotion only at `currentHead`), and the existing
  isolation scope. `DenyAll` refuses fail-loud and records a bounded
  payload-free attempt marker (no intent payload — `CaptureOnly` keeps this
  RFC's ledger-backed meaning). Forward mapping is lossless: `Missing` →
  (`Missing`, any); `CaptureOnly` → (`CaptureOnly`, `NotPromotable`);
  `Promotable` → (`CaptureOnly`, `Promotable`). The new combination
  (`DenyAll`, `Promotable`) is named `Promotable(noEffects)` — a strictly
  narrower claim than this RFC's `Promotable` (its staged-settlement half is
  unexercised) — and projects to `Missing` for legacy three-value consumers
  (a deliberate under-claim; projecting to `CaptureOnly` would assert a
  ledger that does not exist). The projection is total: any (egress,
  promotion) pair maps to the greatest three-value claim it fully
  satisfies, so (`DenyAll`, `NotPromotable`) also projects to `Missing`.
- **Claim boundary.** Restated across all four axes: no capability manifest
  may report any of the egress, promotion, base, or isolation axes above
  its weakest value until this RFC's acceptance corpus (as amended above)
  passes on that target; the original "(while Draft)" qualifier is
  superseded — the boundary binds by corpus passage, not document status.
- **§Acceptance.** A `Promotable(noEffects)` target passes this corpus with
  the effect-settlement fixtures replaced by negative fixtures proving its
  attempt markers are empty and that any egress attempt forecloses
  promotion. Every capture-specific clause in the corpus
  ("blocked-and-captured", "capture, not fire") is conditional on the
  `CaptureOnly` egress class: under `DenyAll`, the corresponding fixture is
  the marker/refusal/bypass form (denial is fail-loud, the payload-free
  attempt marker is durable, and no bypass fires an effect). All other
  rows stand.
- **§5 (promotion protocol additions).** Promotion consumes a sealed
  `PromotionRequestV1` (reviewed child-stream head under branch-head CAS;
  log/diff/manifest digests; approver — a human or an agent principal
  holding an LLP 0055 scoped grant; a rebase-invariant admission-ticket
  identity that is the sole admissible retry identity). The approval binds
  the full approved-facts digest (reads, ctx answers, decision/result
  facts, writes, effects, artifact, coverage) — this RFC's
  meaning-preservation comparison made concrete; a rebase reproducing it
  re-seals as a separately identified engine attestation over the preserved
  approval, and any divergence forces fresh approval. Admission is
  serialized and fair per canonical stream (inherited FIFO tickets,
  concurrency-scaled rebase budget, quotaed bounded head reservation), and
  **rebase-by-replay** — re-executing the recorded log into a fresh fork
  from the new head — is the paved recovery after a strict-CAS refusal.
- **Code-deviation resolution (2026-08-03).**
  `issues/closed/20260803-branches-promote-postimage-deviation.md` records the
  correction: the legacy post-image `branches::promote` surface is
  compile-disabled, LLP 0164's replacement accepts only replay-sufficient
  operations and re-executes them under strict CAS, and `MaterializedBase`
  retains a separate SQLite-enforced query-only comparison base. This removes
  the named implementation deviation; it does not pass the Acceptance corpus
  or raise any branch capability above `Missing`.
