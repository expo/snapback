# LLP 0218: Outbox settlement contract and queued-write visibility

**Type:** RFC
**Status:** Draft
**Systems:** Client integration, Sync, React arm
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-10 (a — initial draft, synthesized from the Clique P2
pilot evidence and a GPT-5.6-sol design consultation)
**Related:** LLP 0043 (offline replay/retention — owns the durable
settlement lifecycle this dispatch contract hands off to; gets a dated
cross-reference at landing), LLP 0107 (React optimistic lifecycle — owns
the layer semantics §4.2 constrains), LLP 0063 §Workstream 5 (three-fact
settlement families this contract must not collapse), LLP 0129 (local-first
program — governing constraint 4, resync-before-replay), LLP 0208 §G1 (the
gap-closure plan this RFC is the commissioned contract ruling for),
LLP 0219 (dev diagnostics channel — number reserved; owns §4.4's delivery
surface), `benchmarks/records/2026-08-09-social-messenger-p2-pilot.md` (F5),
`issues/20260809-outbox-silent-queue-dx.md`,
`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md`

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
The headless declaration promises only `Promise<FunctionResult<Ref>>`
(`packages/snapback-client/index.d.mts:1318`) while the runtime returns a
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
fact families (effect attempt, optimistic presentation, authoritative
settlement) rather than collapsing them into fulfilled-vs-rejected, and
LLP 0129's boundary that queued or optimistic state is never authoritative.

## Design detail

### 4.1 The dispatch union (headless contract)

```ts
type MutationDispatchOutcome<Result> =
  | { status: 'settled'; output: MutationOutput<Result> }
  | { status: 'queued'; clientMutationId: string; sequence: number;
      presentation: 'installed' | 'withheld' | 'unavailable' };
```

`mutate()` resolves after authoritative settlement **or** durable enqueue,
whichever the dispatch reaches. New observation surfaces:
`mutationStatus(clientMutationId)` and `subscribeMutation(clientMutationId,
listener)` over the durable record (pending → settled/failed/stranded per
the LLP 0043 lifecycle and the ratified sessions-custody strand matrix).
`outboxStatus()` gains `oldestPendingAt`, drain phase, last attempt, next
retry, and a payload-free blocked reason. Existing `settledMutations()`/
consumption/ACK behavior is unchanged — this RFC adds no second settlement
owner.

### 4.2 The optimistic contract (exact)

- A genuine optimistic-install failure detected **before** dispatch
  (invalid update, install-time contract violation) rejects, queues nothing.
- Once the durable enqueue cut has happened, no local presentation problem
  may turn accepted intent into a rejected call. The dispatch resolves
  `queued` with `presentation:'unavailable'` plus a structured diagnostic;
  `withheld` covers callers that declined optimistic install; `installed`
  is the normal case.
- A successfully installed layer **remains pending** when the write queues.
  It retires or rolls back only from authoritative settlement, typed
  terminal replay failure, custody disposition (strand/delete per the
  ratified matrix), or authority loss — never from the queued branch.
- Layers retained through long outages consume the 256-layer bound;
  terminal outbox dispositions must retire them deterministically, and the
  provider must expose them for inspection (LLP 0107 owns layer mechanics).

### 4.3 The platform-owned drain

`<SnapbackProvider outboxDrain="auto">` — `"auto"` is the default whenever
automatic queueing and a durable writer store are available; `"manual"` is
the escape hatch for custom coordinators (existing hand-built flushers set
it during migration). The provider owns a headless drain controller
(`startOutboxDrain()` in the client, so non-React hosts get the same
machinery) that: reacts to enqueue, restored connectivity, provider
resume/app-foreground, and authoritative connection readiness; establishes
an explicit full-resync barrier before replay — never raw
`online → replayQueuedMutations()` (LLP 0043 §Mutation Replay; LLP 0129
governing constraint 4); drains single-flight in sequence order; honors
writer locks, captured authority/custody, stranding, quarantine, and
terminal failure; backs off boundedly rather than polling forever; and
pauses rather than spins when resync, custody, or authority is unavailable.
If the provider cannot produce a real app-wide resync barrier, auto-drain
waits — "auto" as a raw online-event replay would be worse than today.
Only the durable store's writer drains; every replay rechecks captured
authority immediately before transport. Duplicate drains during migration
are correctness-safe (single-flight replay, idempotent IDs), merely wasteful.

### 4.4 Dev diagnostic

The first silently queued mutation in a session fires a loud dev-mode
diagnostic (durable enqueue already records
`SNAPBACK_OFFLINE_MUTATION_QUEUED`; this promotes first occurrence to the
developer-facing channel) naming the mutation, queue reason class, and
drain mode. Delivery surface and formatting belong to the LLP 0219
diagnostics channel (number reserved); this RFC owns the trigger and payload.

### 4.5 Compatibility and migration

The **primary migration is the return-type migration, in place**:
`useSnapbackMutation` and headless `mutate()` change their resolved type to
the union in one minor release; `queued:true` stays on the queued branch as
a deprecated alias for one release; `SnapbackQueuedMutationError` is
demoted to an explicit result-only compatibility mode (callers opting out
of the union — `{queue:false}` fail-loud-online behavior, or a settled-only
convenience hook — keep a result-shaped contract by choice, not default).
The consultation's fallback — ship the union under a new mutation-attempt
hook first, retain the current hook temporarily — is the recorded
**fallback plan** if the release audit finds callers that cannot absorb the
return-type change; it is not the primary. Expo re-exports the surfaces;
Contract normalizes the additive raw outcome without changing Exact's
ownership of the three-fact projection.

## Phases

1. **P1 — headless union.** `MutationDispatchOutcome`, truthful
   `index.d.mts` types, `mutationStatus`/`subscribeMutation`,
   `outboxStatus` extension. Proof: `outbox-store.test.mjs` +
   `outbox-custody.test.mjs` rows for queued resolution, restart
   settlement recovery, stranded observation.
2. **P2 — drain controller.** `startOutboxDrain()` lifecycle-owned,
   resync-gated, custody-honoring. Proof: client offline tests covering
   resync-before-replay, no-mounted-query drain, two-tab writer refusal,
   auth replacement, terminal refusal, bounded backoff.
3. **P3 — React contract.** Queued dispatch resolves the union; installed
   layers survive enqueue; provider drain wiring; `useSnapbackOutbox`
   gains depth/oldest-pending/drain-phase/`drainNow()` (`replay()` stays
   as alias). Proof: React `offline.test.mjs`/`optimistic.test.mjs`
   (no-rollback-after-enqueue is the M7 regression row) + the
   real-browser witness extended with offline→online automatic drain.
4. **P4 — Expo/Contract propagation + dev diagnostic.** Proof: package
   tests; diagnostic asserted in dev-mode React tests (channel shape
   deferred to LLP 0219).
5. **P5 — docs/capabilities.** Update `clients.mutation-outcomes`,
   `clients.react`, `sync.offline-js-arm` rows; add `clients.outbox-drain`
   with the browser witness; React + offline guide pages. Proof:
   `node scripts/check-guide.mjs` + the capability witnesses.
6. **P6 — deprecation closure.** Remove the `queued:true` alias and the
   default-path queued rejection after one release window. Proof: release
   audit of caller absorption (the §4.5 fallback trigger).

## Open questions

- Deprecation window for the `queued:true` alias and the compatibility
  rejection mode (one release is the default; the P6 audit may extend it).
- Whether `clients.outbox-drain` stays a distinct capability row or folds
  into `clients.react` once shipped.
- Drain backoff parameters (bounds, jitter) — implementation-owned unless
  a battery/foreground concern surfaces on Expo.
- How stranded sessions-custody records surface in `useSnapbackOutbox`
  (read/discard/re-record affordances exist headlessly; hook shape is
  unowned).
