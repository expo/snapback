# LLP 0218: Outbox settlement contract and queued-write visibility

**Type:** RFC
**Status:** Implemented
**Systems:** Client integration, Sync, React arm
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-21 (LLP 0295 D0.2 cross-reference amendment: LLP 0059's
dated authority-transition matrix amendment owns the cross-surface state and
settlement semantics this contract's dispatch/queue/drain behavior composes
into; records the implemented matrix-ruled W2 changes to this contract —
the typed `auth-barrier` blocked reason beside the shipped
`custody-unsettled` vocabulary, the declared-housekeeping lane split so
foreground sends never head-of-line block behind housekeeping, item-5-
aligned strand/delete dispositions for predecessor housekeeping with typed
supersession, and the normative ruling-6 `timing` fields; §4.3's
single-flight bullet now points at the amendment; see "Dated amendment"
below)
**Revised:** 2026-08-15 (P6 implemented — deprecation closure executed after
the window elapsed; Status → Implemented.)
**Revised:** 2026-08-15 (removed the LLP 0255 S3.2 amendment after the author
selected LLP 0254 D10 Withdraw and retired the Tiny doorway before the next
publication)
**Revised:** 2026-08-10 (P3 implemented: React union, durable optimistic
disposition lifecycle, provider drain, outbox projection, caller sweep, and
browser witness source)
**Revised:** 2026-08-10 (Review → Accepted — accepted to begin implementation (author direction in-session, 2026-08-10); final verdicts bind revision (c), the (d) tail is unreviewed and disclosed)
**Revised:** 2026-08-10 (a — initial draft, synthesized from the Clique P2
pilot evidence and a GPT-5.6-sol design consultation)
**Revised:** 2026-08-10 (b — Draft → Review at llp-super-refine loop start,
the one authorized transition; sub-orchestrated loop)
**Revised:** 2026-08-10 (d — **UNREVIEWED** delta-convergence closure of
the round-2 in-delta MATERIALs (both families reported pre-existing text
clean; artifacts in `llp/reviews/0218-outbox-settlement-contract.
{claude,gpt-5}.md` round 2): typed-caller narrowing honesty + audit scope
(GPT M1/Claude M2); status-channel branch payloads and total §4.2 map
incl. `pending`/`unknown` (GPT M2); queued-path scoping of the
no-reject rule, settled-validation outcome, diagnostic carrier (GPT M3);
level-triggered custody/successor-bind wakeups + P2 row (GPT M4);
channel cadence = relinquishment transitions, LLP 0219 amendment
scheduled (GPT M5); `resultGone` pinned non-replayable/non-rerecordable
with an acknowledge cut (GPT M6); compat surfaces force `queue:false`,
class throw-site-free from the union release, P6 deletes the export
(GPT M7/Claude M1); minors: 0219 header status, typed-refusal
settlement wording, `identity-horizon-passed` placement, barrier
registration set, `withheld` gloss, evidence-join naming, command-task
scope-out, `replayQueuedMutations()` redirect)
**Revised:** 2026-08-10 (c — round-1 dual NOT READY repairs, per
`llp/reviews/0218-outbox-settlement-contract.{claude,gpt-5}.md`: settled
branch flattened onto `MutationOutput` (Claude AD1(b)), per-facade table
with React validated-result-only; `queued` = relinquishment cut; full
disposition union, non-consuming observation; drain barrier/liveness/
multi-context obligations; §4.2 layer correlation map; migration honesty +
pre-publication audit + lockstep peer ranges; citation/quote/naming/LLP
0219-cadence/LLP 0107-amendment minors)
**Related:** LLP 0043 (offline replay/retention — owns the durable
settlement lifecycle this dispatch contract hands off to; gets a dated
cross-reference at landing), LLP 0107 (React optimistic lifecycle — owns
the layer semantics §4.2 constrains; gets a dated amendment at the P3
landing), LLP 0063 §Workstream 5 (three-fact
settlement families this contract must not collapse), LLP 0129 (local-first
program — governing constraint 3, speculative state is never presented as
settlement), LLP 0208 §G1 (the
gap-closure plan this RFC is the commissioned contract ruling for),
LLP 0219 (dev diagnostics channel — owns §4.4's delivery
surface; gets a producer-cadence wording amendment per §4.4), `benchmarks/records/2026-08-09-social-messenger-p2-pilot.md` (F5),
`issues/20260809-outbox-silent-queue-dx.md`,
`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md`,
LLP 0059 (owner of the D0.2 authority-transition matrix this contract's
queue/drain semantics compose into), LLP 0295 (D0.2 commissioning Plan),
`issues/closed/20260821-client-authority-transition-state-matrix.md`

## Summary

The strongest convergent product finding of the Clique P2 pilot (pilot
record F5; `issues/20260809-outbox-silent-queue-dx.md`) was hit
independently by two contamination-shielded sessions. In the builder lane,
a transient connectivity-classified refusal silently queued a mutation —
`{queued:true}` resolving indistinguishably from success — every later
mutation queued behind it in the ordered lane, and a screen with no outbox
drain wedged for hours; the fix was a hand-built 30-line app-wide
`OutboxFlusher`, and the recorded lesson generalized to "every screen needs
outbox awareness." In the M7 session, an offline vote queued durably but
the promise **rejected** with `SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED`,
and a generic rollback-on-error handler erased the pending marker while the
intent settled fine on reconnect.

Both failures are the same defect: the dispatch contract is untruthful.
The headless declaration promises `Promise<MutationOutput<FunctionResult<Ref>>>`
with no queued branch anywhere in the type system
(`packages/snapback-client/index.d.mts:1318`; only the `offlineQueue`
option's JSDoc mentions it) while the runtime returns a
distinct `{queued:true, clientMutationId, sequence}` shape
(`packages/snapback-client/index.mjs` ~6718–6728); the React arm converts
that shape into a `SnapbackQueuedMutationError` throw (`index.mjs:1205`)
whose rejection path removes the just-installed optimistic layer
(`index.mjs:1254–1260`). Durable enqueue — accepted, retained intent — is
presented as silence or as an error, never as what it is: a non-error
pending branch. The settlement facts already exist and are shipped
(`clients.mutation-outcomes`, `guide/capabilities.md:96`; LLP 0043 "Raw
settlement facts and projection ownership"); the defect is purely the
default dispatch DX. And replay is today scheduled only by a successful
fresh-subscribe snapshot (`index.mjs` `#scheduleOutboxReplay`, ~6739), so
a screen without that lifecycle wedges. This RFC fixes the contract and
gives the platform ownership of the drain.

## Options considered

1. **Discriminated dispatch outcome + separate settlement observation**
   (chosen). `mutate()` resolves with a union: `settled` carrying the
   mutation output, or `queued` carrying `clientMutationId`, `sequence`,
   and a presentation field. Durable settlement is observed separately
   through the existing mutation-outcomes facts (`settledMutations()`,
   consumption ACKs) keyed by mutation ID — not by pretending one
   process-local promise survives restart. Tradeoff: default-queue callers
   must branch on `status`; real cost, but it makes the runtime's existing
   hidden union truthful.
2. **First-class mutation task/handle.** `mutate()` returns a
   `MutationAttempt` with `accepted()`/`snapshot()`/`subscribe()`/
   `settled()`, matching the command-task precedent. Models the lifecycle
   elegantly, but it is substantially more API machinery, the handle
   cannot survive process death, and recovery still rehydrates through
   LLP 0043's durable store. **This was the close call**, and close only
   on API packaging, not semantics. The union wins because the durable
   outbox already owns the long-lived state; a task object would be a
   second, non-durable owner of the same facts.
3. **Keep result-only React contract + distinct queued rejection.** Retain
   `SnapbackQueuedMutationError` (the shipped partial repair) plus
   automatic drain. Smallest migration, but pending settlement stays
   error-shaped, generic rollback handlers stay hazardous (exactly the M7
   failure), and headless vs React semantics stay inconsistent.
4. **Make `mutate()` await final settlement.** Wrong for a durable offline
   system: the promise can pend indefinitely and cannot survive reload;
   LLP 0043's settlement-consumption lifecycle explicitly makes the
   durable record and post-relaunch consumption APIs the owner.

## Decision

The default `mutate()` dispatch outcome becomes a discriminated union. A
successfully queued mutation **resolves** with `status:'queued'` — a
non-error pending branch, never indistinguishable from committed and never
error-shaped. Durable settlement is observed separately via the existing
mutation-outcomes facts. Optimistic installs on queued mutations must not
reject as failures (§4.2). A platform-owned default drain ships (§4.3) so
screens need no hand-built `OutboxFlusher`. A loud dev diagnostic fires on
first silent queue (§4.4). This preserves LLP 0063's three independent
fact families (effect attempt, optimistic presentation, and the
evidence-join status that the authoritative settlement facts feed)
rather than collapsing them into fulfilled-vs-rejected, and
LLP 0129's boundary that queued or optimistic state is never authoritative.

## Design detail

### 4.1 The dispatch union (headless contract)

```ts
type MutationDispatchOutcome<Result> =
  | (MutationOutput<Result> & { status: 'settled' })
  | { status: 'queued'; clientMutationId: string; sequence: number;
      presentation: 'installed' | 'withheld' | 'unavailable' };
```

The settled branch is the existing `MutationOutput` with the discriminant
stamped on top (`status` becomes a reserved key; no such member exists
today), so headless settled-path callers keep working unchanged. The
queued branch is open to additive payload-safe facts (the shipped
`operationCoverageDisposition` is the precedent).

**`queued` is the relinquishment cut, not the durable-custody cut.**
LLP 0043 commits the durable record before an explicit-id online delivery,
so ordinary online dispatches also "reach durable enqueue". The dispatch
resolves `settled` whenever its foreground delivery attempt settles
successfully (a typed terminal refusal is also a settlement, but still
rejects the call — the settled branch is a success shape), and resolves
`queued` only when that attempt is relinquished (connectivity-classified
refusal, offline, no-attempt policy) and the record is replay-eligible.
Replay never touches a record a foreground attempt still owns; the drain
(§4.3) triggers on this transition, not on every durable insertion.

New observation surfaces over the durable record (per the LLP 0043
lifecycle and the ratified sessions-custody strand matrix):
`mutationStatus(clientMutationId)` and `subscribeMutation(clientMutationId,
listener)` report the disposition union — `pending`, `settled` (carrying
the retained settlement result/receipt, sufficient to run LLP 0107
matchers and result validation), `failed` (carrying the typed terminal
refusal), `stranded`, `quarantined`, `resultGone`, and `unknown` (no
durable record: never enqueued here, or ACK-consumed and collected —
licensing no settlement inference). The union is additive-open like the
queued branch; LLP 0043's `identity-horizon-passed` (outcome-unknown
**with** a durable record) surfaces as `pending` with an outcome-unknown
blocked reason, never as `failed`. `resultGone` is outcome-known with the
payload gone (LLP 0043 `result-expired`): never replayable, never
rerecordable — re-recording could duplicate a committed effect — and it
holds its successor fence until an explicit payload-free acknowledge cut
(outcome known, result absent) releases it. `subscribeMutation`
delivers the current disposition on subscribe, then transitions.
Observation is **non-consuming**: `markMutationSettlementsConsumed()`
remains the only consumption cut, and existing `settledMutations()`/ACK
behavior is unchanged — this RFC adds no second settlement owner.
`outboxStatus()` gains `oldestPendingAtMs` (LLP 0219's field name), drain
phase, last attempt, next retry, and a payload-free blocked reason.

**Facade contracts.** Every mutation surface has a pinned resolved type:
headless `mutate()` resolves the flattened union above. React's
`useSnapbackMutation`, `invokeSnapbackMutation`, and bound mutation
surfaces resolve `{status:'settled'; result}` — `result` the LLP 0101
validated result, never the raw `MutationOutput` (LLP 0107's result-only
rule holds inside the settled branch) — or the queued branch. The
settled-only convenience hook and the `{queue:false}` compat mode keep
today's result-only shape by explicit choice: both dispatch `queue:false`,
so queueing is impossible there and connectivity failures reject loudly
with the original error — `SnapbackQueuedMutationError` is **never thrown
anywhere** from the union release onward (§4.5). The command-task surface
(`useSnapbackCommand`) is explicitly out of scope: its task object owns
its own settlement presentation, and this RFC does not change it. Expo
re-exports the React contracts; Contract
normalizes the additive raw outcome (Exact keeps the three-fact
projection). `presentation` is stamped by the arm that owned the
optimistic-install decision — the React/Expo provider for hook dispatches;
the headless client stamps `withheld` — with one gloss everywhere: no
optimistic install was attempted, whether declined by the caller or
absent machinery. It is a point-in-time, process-local dispatch fact, not
a continuing guarantee (the layer's later life is §4.2's).

### 4.2 The optimistic contract (exact)

- A genuine optimistic-install failure detected **before** dispatch
  (invalid update, install-time contract violation) rejects, queues nothing.
- On the **queued path** (foreground attempt relinquished, §4.1), no
  local presentation problem may turn accepted intent into a rejected
  call: the dispatch resolves `queued` with `presentation:'unavailable'`,
  carrying a payload-safe diagnostic code on the queued branch and
  emitting the matching LLP 0219 channel event; `withheld` and
  `installed` as glossed in §4.1. A dispatch whose foreground attempt
  **settles** keeps today's settled semantics end to end — a
  post-settlement result-validation failure rejects with its typed error
  exactly as shipped (nothing is pending; the settlement stays observable
  through the mutation-outcomes facts), and never masquerades as `queued`.
- A successfully installed layer **remains pending** when the write queues.
  It retires or rolls back only from authoritative settlement, typed
  terminal replay failure, custody disposition (strand/delete per the
  ratified matrix), or authority loss — never from the queued branch.
- Correlation is by `clientMutationId`: once the dispatch resolves
  `queued` the promise is finished, so the provider drives the retained
  layer from the durable status channel (§4.1 `subscribeMutation`), with
  a **total** disposition map — `pending` retains the layer; `settled`
  retires it (its branch carries the retained result, so LLP 0107
  matchers run; settlement performed by another writer context arrives
  the same way); `failed` rolls back; `stranded`/`quarantined`/
  `resultGone` retire with the custody affordance surfaced; `unknown`
  retains the layer without settlement inference, visible through the
  LLP 0107 inspection surface as orphaned, until authoritative delivery
  or authority loss supplies evidence; authority loss follows LLP 0107's
  existing rule.
- Layers retained through long outages consume the 256-layer bound;
  terminal outbox dispositions must retire them deterministically, and the
  provider must expose them for inspection (LLP 0107 owns layer mechanics).

### 4.3 The platform-owned drain

`<SnapbackProvider outboxDrain="auto">` — `"auto"` is the default whenever
automatic queueing and a durable writer store are available; `"manual"` is
the escape hatch for custom coordinators (existing hand-built flushers set
it during migration). The provider owns a headless drain controller
(`startOutboxDrain()` in the client, so non-React hosts get the same
machinery) that:

- reacts to the §4.1 relinquishment transition, restored connectivity,
  provider resume/app-foreground, authoritative connection readiness,
  writer-lock acquisition after being a non-writer, and — level-triggered,
  so a pause always has a wakeup — custody replacement, successor
  authority bind, and authority-fence transitions (LLP 0043 leaves records
  pending across terminal authority loss until a successor bind; that bind
  can arrive with no new enqueue or network edge) — and on controller
  start scans the durable store for pending work, so cold start drains
  restored intent without any fresh event;
- establishes an explicit full-resync barrier before replay — never raw
  `online → replayQueuedMutations()` (LLP 0043 §Mutation Replay; LLP 0008)
  — and **establishes it itself** when no query lifecycle provides one: a
  fresh authoritative resync cut over the durable store's retained query
  registrations, mounted or not (none retained: the connection-readiness
  handshake is the cut), never waiting for
  a mounted query to resubscribe — the pilot wedge was exactly a screen
  that never produced a fresh-subscribe snapshot. "Cannot produce a
  barrier" is a bounded, observable refusal state surfaced through
  `outboxStatus()`'s blocked reason, never an open-ended silent wait;
- drains single-flight in sequence order (once the dated 2026-08-21 D0.2
  amendment's W2 work lands: within the foreground lane — declared
  housekeeping drains in a second lane per that amendment; until then this
  bullet remains the whole shipped drain); honors writer locks, captured
  authority/custody, stranding, quarantine, and terminal failure; rechecks
  captured authority immediately before each transport; only the durable
  store's writer drains, and non-writer contexts converge by observing the
  durable record (their `subscribeMutation`/`outboxStatus` projections
  update when the writer settles work);
- retries transient replay/resync failure on capped backoff without
  needing a new external event, pauses rather than spins when resync,
  custody, or authority is unavailable, and **never silently stops
  permanently** — draining ceases only on typed terminal dispositions,
  each observable per mutation and in the blocked reason;
- tears down deterministically with its provider and deduplicates to at
  most one live controller per durable store across Strict-Mode
  double-mount, HMR, and provider replacement (duplicate drains during
  migration remain correctness-safe — single-flight replay, idempotent
  IDs — merely wasteful).

`drainNow()` and the retained `replay()` alias request a cycle from this
controller — barrier and custody checks included — and can never bypass
its safety invariants; `"manual"` disables automatic scheduling only,
never safety. The shipped public `replayQueuedMutations()` is kept but
redirected through the controller in the union release, so existing
callers inherit the same invariants; raw un-barriered replay becomes
internal-only.

### 4.4 Dev diagnostic

The queued diagnostic is recorded at the relinquishment cut
(`SNAPBACK_OFFLINE_MUTATION_QUEUED`), and the structured channel event
fires on **every relinquishment-to-queued transition** — not on every
durable insertion, since ordinary online dispatch also writes the durable
record first (§4.1); LLP 0219's "when enqueue commits" producer wording
gets a matching amendment at landing. This RFC owns the promotion rule
and payload: the first queued dispatch in a session is additionally
promoted to a loud dev-mode diagnostic naming the mutation, queue reason
class, and drain mode ("silently queued" means queued-at-dispatch — the
client cannot observe whether the caller branched on `status`). Delivery
surface, formatting, and coalescing belong to the LLP 0219 diagnostics
channel.

### 4.5 Compatibility and migration

The **primary migration is the return-type migration, in place**, with
the blast radius stated per facade. Headless settled-path callers are
**runtime-unchanged** by the flattened settled branch (§4.1) — but the
declared return type becomes the union, so typed callers must narrow on
`status` before touching settled fields. That compile-time churn is
Option 1's admitted cost and the design's point (it is what makes the
hidden union visible); the P1 audit counts it as absorbable churn, not a
fallback trigger. The headless
queued branch keeps `queued:true` as a deprecated alias for one release.
React-arm settled-path callers **do break** — the resolved value changes
from the bare validated result to the wrapped union in one minor release.
That break is deliberate and is gated by a **pre-publication absorption
audit** (P1) covering known callers, every facade in the §4.1 table, and
supported package-skew combinations; the audit selects primary versus
fallback **before** the return-type change publishes. The consultation's
fallback — ship the union under a new mutation-attempt hook first, retain
the current hook temporarily — remains the recorded fallback plan if that
audit finds callers that cannot absorb the change. Version skew: an older
React arm over a newer client would re-interpret the `queued:true` alias
as its rejection path (the shipped wrapper detects exactly that property),
reproducing the M7 failure — so the release pins lockstep peer ranges
(React/Expo arms require the matching client minor) and the new React arm
consumes the union, never the alias. `SnapbackQueuedMutationError` is
retired **in the same release the union lands**: the compat surfaces
dispatch `queue:false` (queueing impossible; connectivity failures reject
with the original error), so from that release the class is a deprecated
export with **no remaining throw site**; P6 deletes the export and the
`queued:true` alias after the deprecation window. Expo re-exports the surfaces; Contract
normalizes the additive raw outcome without changing Exact's ownership of
the three-fact projection. LLP 0107's dated amendment (queued resolution
replaces the queued rejection) lands with P3.

## Phases

1. **P1 — headless union.** `MutationDispatchOutcome`, truthful
   `index.d.mts` types, `mutationStatus`/`subscribeMutation`,
   `outboxStatus` extension; the §4.5 pre-publication absorption and
   package-skew audit completes before the return-type change publishes.
   Proof: `outbox-store.test.mjs` + `outbox-custody.test.mjs` rows for
   queued-vs-settled resolution at the relinquishment cut, restart
   settlement recovery, and every §4.1 disposition (including `unknown`
   after ACK GC).
2. **P2 — drain controller.** `startOutboxDrain()` lifecycle-owned,
   resync-gated, custody-honoring. Proof: client offline tests covering
   resync-before-replay, cold-start drain of restored work,
   transient-failure retry without a new external event, no-mounted-query
   drain (controller-established barrier), two-tab writer refusal plus
   writer takeover and follower status convergence, auth replacement,
   successor-authority bind waking a paused drain,
   terminal refusal, bounded backoff, duplicate-provider dedup/teardown.
3. **P3 — React contract.** Queued dispatch resolves the wrapped
   validated-result union (§4.1 facade table); installed layers survive
   enqueue and follow the §4.2 disposition map; provider drain wiring;
   `useSnapbackOutbox` gains depth/oldest-pending/drain-phase/
   disposition counts and blocked reason/`drainNow()` (`replay()` stays
   as alias); lands the LLP 0107 dated amendment and LLP 0043
   cross-reference. Proof: React `offline.test.mjs`/`optimistic.test.mjs`
   (no-rollback-after-enqueue is the M7 regression row) plus
   per-disposition layer rows — replay-success retirement, typed-refusal
   rollback, strand/quarantine/result-gone retirement, authority loss,
   settlement by another writer — + the real-browser witness extended
   with offline→online automatic drain.
4. **P4 — Expo/Contract propagation + dev diagnostic.** Proof: package
   tests; diagnostic asserted in dev-mode React tests (channel shape
   deferred to LLP 0219).
5. **P5 — docs/capabilities.** Update `clients.mutation-outcomes`,
   `clients.react`, `sync.offline-js-arm` rows; add `clients.outbox-drain`
   with the browser witness; React + offline guide pages. Proof:
   `node scripts/check-guide.mjs` + the capability witnesses.
6. **P6 — deprecation closure.** Remove the `queued:true` alias and
   delete the (throw-site-free since P3) `SnapbackQueuedMutationError`
   export after the deprecation window. Proof: post-release closure audit
   of caller absorption (the §4.5 primary-vs-fallback trigger is P1's
   pre-publication audit; this one is closure evidence).

## Implementation notes

**P1 pre-publication absorption audit (2026-08-10, recorded at P1
implementation).** Repo-wide caller scan over demos, CLI templates, guide
snippets, and packages: ~676 `mutate(` call sites total, of which the
React-arm resolved-value break reaches only surfaces that consume the
resolved value of `useSnapbackMutation`/`invokeSnapbackMutation`/bound
mutations. Live-linked consumers (`file:../../packages/snapback-react`):
12 demo apps (browser-local-first, chirp, file-drop,
fleet-observatory-move1, messaging-snapback, signal-desk, warble,
zerobugs/control, zero-bakeoff contention-calendar + latency-kanban,
relay-room-bakeoff snapback-expo, tandem-expo-bakeoff) plus the 4 CLI
templates (react, crud-dashboard, expo-chat, media-feed). Frozen bakeoff
evidence directories pin tarballs/published versions and are exempt.
Every affected surface is in-repo and migrated by the P3 sweep; package
skew is handled by the §4.5 lockstep peer-range floor in the release that
carries the union. **Ruling: primary path (in-place return-type
migration) selected; the churn is absorbable; the new-hook fallback is
not triggered.**

**Phase status.** P1 headless union: implemented (landed 2026-08-10,
9f62b14e2). P2 drain controller: implemented (this landing) —
`startOutboxDrain()` with a per-store deduplicated controller,
level-triggered wakeups (outbox transitions, `online`, writer-lock
notification via a new store `subscribeWriterLock` seam with bounded
pending-work-only polling on carriers without one, auth-terminal/custody
transitions, cold-start scan), barrier establishment that first asks
mounted live-query lifecycles (each subscription self-registers a
resubscribe barrier provider), then resyncs the durable store's retained
registrations itself, then falls back to the connection-readiness
handshake for the empty set; capped jittered backoff; observable pause
reasons in `outboxStatus()` (`drainPhase`/`lastAttemptAtMs`/
`nextRetryAtMs`/`blockedReason`); public `replayQueuedMutations()`
redirects through a running controller. P3 React contract: implemented
(2026-08-10) — the default facade resolves the validated-result union,
queued optimistic layers follow §4.2 through `subscribeMutation`, the
provider owns the P2 controller, and the outbox hook mirrors its status
and custody affordances. The scoped caller sweep and package/static
proofs land with this phase; the browser witness source now records the
React queued branch and automatic drain, with its qualified receipt to be
re-minted by the witness runner. P4 propagation + diagnostic: implemented
(2026-08-10) — Expo passes `outboxDrain`/`outboxDrainOptions` through its
provider and re-exports the settled-only hook; Contract forces
`queue:false` at every inner transport call and strips the additive
settled discriminant before its Exact-owned projection
(`normalizeContractMutationOutput`, fail-loud
`SNAPBACK_CONTRACT_INNER_MUTATION_QUEUED` guard); the §4.4 relinquishment
diagnostic emits a stable payload-safe event
({code, mutation, clientMutationId, sequence, queueReasonClass,
drainMode, firstInSession}) at every relinquishment-to-queued transition
through an internal injected-channel stub — the LLP 0219 attachment seam
(constructor option `devDiagnosticsChannel`); delivery/formatting/
coalescing remain LLP 0219's, per this program's carve-out — and the
React arm promotes the first queued dispatch per provider session to the
loud dev warning naming mutation, reason class, and drain mode. P5 docs: implemented
(2026-08-10) — capability rows updated (`clients.mutation-outcomes`,
`clients.react`, `sync.offline-js-arm`) plus a distinct
`clients.outbox-drain` row citing outbox-drain.test.mjs, the React
offline battery, and the browser witness's offline→online automatic
drain leg; React, headless, and offline guide pages document the union,
the settled-only compat surface, the §4.2 layer lifecycle, the
platform drain, and the extended outbox hook with CI-verified
source-pinned snippets (`check-guide` green, 121 pages / 1327
snippets). LLP 0219's producer wording already carries the
relinquishment cadence in its accepted text, so §4.4's scheduled
amendment is satisfied without an edit; §4.4's channel delivery is
stubbed behind the internal `devDiagnosticsChannel` seam per this
program's carve-out, for the LLP 0219 program to attach. P6 deprecation
closure is window-gated: it runs after the deprecation window of the
release carrying the union, tracked as
`issues/20260810-llp-0218-p6-deprecation-closure.md` (filed at the P5
landing). P6 deprecation closure: implemented (2026-08-15) — the union first
shipped in 0.1.19 (2026-08-11; 0.1.17/0.1.18 predate it, verified against the
published tarballs) and the default one-release window elapsed at 0.1.20, with
0.1.22 current at closure time. Closure audit: repo-wide grep found no live
in-repo reader of the `queued: true` alias or importer of
`SnapbackQueuedMutationError` outside the removal sites themselves; the only
remaining textual mentions are frozen historical evidence
(`demos/improvement-sweep` arms pinned to pre-union published versions, the
client-bundle-metrology rollover records) and Contract's separately owned
durable-queue result, all left untouched. No known external consumers exist
(LLP 0041 publication posture). Removals: both headless queued-return alias
stamps and the `MutationDispatchOutcome` alias member; the React
`queuedMutationOutcome` stamp; the three React skew-compat
`output?.queued === true` disjuncts and Contract's `mutation-output.mjs` twin;
the throw-site-free `SnapbackQueuedMutationError` class, its React
`index`/`core` re-exports and `.d.mts` twins (Expo re-exports follow). One
client regression assertion now pins that a queued outcome carries no
`queued` own-property. 27 authored `removedIn: 0.1.23` symbol-lifecycle facts
cover the class identities across the three export paths
(`guide/reference/lifecycle.json`). Guide pages (headless, offline) now
describe only the union. Proof at closure: client 482 pass / 5 fail (the 5
verified byte-identical at the base SHA — inherited, unrelated), react 40/0,
contract 58/0, check-guide 18/18 green, check-inventories PASS, ref-check 0
errors; client-bundle-metrology `--check` red is inherited at base (the open
subpath-publication pickup), verified under the pinned node toolchain.

## Open questions

- ~~Deprecation window for the `queued:true` alias and the compatibility
  rejection mode (one release is the default; the P6 audit may extend it).~~
  Resolved 2026-08-15: the default held. The P6 closure audit found no
  absorbed caller left on the alias, so the window was not extended; closure
  ran three releases after it elapsed.
- Whether `clients.outbox-drain` stays a distinct capability row or folds
  into `clients.react` once shipped.
- Drain backoff parameters (bounds, jitter) — implementation-owned unless
  a battery/foreground concern surfaces on Expo.
- Exact prop naming/shape for the stranded/quarantined/result-gone
  affordances in `useSnapbackOutbox` (the hook mirrors the headless
  read/discard/re-record affordances and the §4.1 dispositions per P3;
  only the naming/shape is implementation-owned).

## Dated amendment: authority-transition matrix participation (2026-08-21, LLP 0295 D0.2)

LLP 0059's dated amendment "Total client authority-transition state and
settlement matrix" (adopted per LLP 0295; the author may revise) is the
single cross-surface owner of the
anonymous/authenticating/authenticated/revoking/reconnecting state machine.
The shipped semantics this RFC implemented — the dispatch union, the
relinquishment cut, the disposition map, and the pause-with-observable-reason
drain — remain this RFC's and are not retroactively changed; the matrix
binds how they compose across an authorization barrier. The following three
W2 changes are implemented through
`issues/closed/20260821-client-authority-transition-state-matrix.md`:

1. **Typed `auth-barrier` blocked reason.** While a transition barrier is
   active, the drain pauses with `blockedReason: auth-barrier` and wakes
   level-triggered at barrier settlement — the shipped custody/
   successor-bind wakeups already carry this edge. The vocabulary boundary
   is pinned: barrier-active reports `auth-barrier`; other unsettled-custody
   pauses keep the shipped `custody-unsettled` (and
   `authority-unavailable:*`) spellings. A barrier wait is therefore
   attributable, never an undifferentiated pending, and no transport
   dispatch occurs under unsettled authority.
2. **Foreground/housekeeping lane split.** Writes explicitly declared
   housekeeping (idempotent, coalescible latest-wins, valid under the
   successor principal) drain in a separate housekeeping lane. Coalescing
   is typed: a superseded housekeeping record settles `failed` carrying
   `SNAPBACK_HOUSEKEEPING_SUPERSEDED`, never a silent no-op. Predecessor
   housekeeping intent at a barrier follows the **item-5 disposition of its
   row exactly like foreground intent** — strand for anonymous →
   authenticated, dev → sessions, and same-user/new-session; delete for A →
   B, A → anonymous, sessions → dev, and incarnation change — and a stranded housekeeping
   record is never auto-replayed under a different principal; there is no
   separate "drop" outcome. The foreground lane keeps this RFC's ordered
   single-flight semantics within the lane; a suspended or slow
   housekeeping write can never head-of-line block a foreground send, and
   cross-lane ordering is explicitly not promised. During a barrier, only
   declared-housekeeping writes targeting the successor may durably queue
   (matrix ruling 3) — these are successor intent and drain at settle —
   while other newly started dispatches promptly refuse typed with zero
   transport. The declaration spelling (dispatch option or generated
   annotation) is recorded in the implementation section below.
3. **Predecessor intent at the barrier** continues to follow LLP 0059's
   item-5 custody transition table (strand/delete); this RFC adds no
   alternative. Item-5 deletion is observable afterward as disposition
   `unknown` (the dispatch promise already resolved `queued`), stranding as
   `stranded`.

Queue, authorization, execution, commit, and delivery time become separately
observable per matrix ruling 6, whose named fields are normative: the
disposition union gains a `timing` object (`enqueuedAtMs`, `dispatchedAtMs`,
`authorizedAtMs`, `executedAtMs`, `committedAtMs`), `outboxStatus()` owns
queue wait and suspension attribution, the live projection owns delivery
(`lastDeliveryAtMs`, `authoritativeRevision`), and the LLP 0219 channel
carries the events.

### W2 implementation record (2026-08-21)

The prospective changes above are implemented. The disposition union now
always carries the five-field nullable `timing` object in two clock domains.
Durable enqueue and first transport admission are recorded atomically in every
JS store arm on the client clock. Successful responses and rejected mutations
that reached the staged server path contribute the server-clock authorization,
handler-execution, and durable-commit triple. Ordering is guaranteed within
each domain; cross-domain subtraction is advisory unless independently clock-
offset-calibrated, not a five-field total order. Existing records and older
servers project missing phases as `null` rather than fabricating chronology.

The declaration spelling is
`housekeeping: { key, idempotent: true, successorValid: true }`. Same-key
pending housekeeping intent is atomically failed with
`SNAPBACK_HOUSEKEEPING_SUPERSEDED`; an active coordinator barrier accepts only
that declared shape and returns queued with `blockedReason: auth-barrier` and
zero transport. The drain subscribes to the coordinator's level-triggered
settlement signal, selects foreground replay before the independent
housekeeping sequence, and uses a two-lane authorization-dispatch gate:
single-flight within each lane, concurrent admission across lanes, and an
exclusive mode for roots and authority-transition cuts. Thus an already slow
housekeeping transport does not block a foreground send. Successor-targeted
housekeeping remains pending even when admitted after a predecessor delete
root is installed, then binds exact successor custody at settlement; shared
item-5 custody reconciliation remains in force for both lanes.

The Expo SQLite arm participates in the same proof: it implements
`withOutboxAuthorizationDispatch`, atomically advances authorization authority
inside `wipeForAuthorityTransition`, exposes `outboxAuthorizationStatus`, and
passes expected authorization/generation CAS values through enqueue and
custody reconciliation. Its focused tests prove stale enqueue/reconcile
refusal and exclusive authority cuts beside independently admitted lanes.
