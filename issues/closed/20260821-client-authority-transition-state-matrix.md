# Define and enforce one client authority-transition state matrix

**Status:** Closed — implemented 2026-08-21
**Opened:** 2026-08-21
**Systems:** Client auth coordinator, Live queries, Mutations/outbox, React,
Familiar projections, Headless/provider adapters, Diagnostics
**Governing:** LLP 0295 D0.2/W2; LLP 0059; LLP 0107; LLP 0218
**Related:** `issues/closed/20260820-agent-auth-transition-residuals.md`;
`issues/closed/20260820-optional-user-live-query-auth-transition-stall.md`;
`issues/closed/20260820-authenticated-query-signed-out-settlement.md`;
`issues/closed/20260818-guide-gap-background-writes-during-auth-transitions.md`;
`issues/20260820-familiar-live-subscription-contention.md`

## Problem

One-shot queries, live queries, foreground mutations, outbox work, React
hooks, Familiar projections, and provider adapters currently expose adjacent
but not demonstrably total interpretations of anonymous -> authenticating ->
authenticated -> revoking -> reconnecting transitions. The result is a mix of
silent ready/empty projections, indefinitely unsettled signed-out operations,
foreground work serialized behind housekeeping, and app-authored retry delays.

This is the client/runtime authority lifecycle. It is distinct from LLP 0293's
kernel authority-write chokepoint.

## Required decision

Amend the owning LLPs with one state and settlement matrix that answers:

- which operations are admitted, rejected, queued, blanked, or restarted in
  every principal class and transition state;
- when awaited sign-in/sign-out is settled enough for queries, ephemeral
  state, subscriptions, and outbox work;
- how predecessor frames and queued writes are fenced across A -> anonymous
  and A -> B;
- whether background writes have an admitted housekeeping lane or an explicit
  wait/skip policy, without head-of-line blocking foreground work;
- which state is safe for subscribe-after-settle and reconnect; and
- which public status and diagnostic fields expose queue, authorization,
  execution, commit, and delivery separately.

## Conformance scope

Build one table-driven suite projected through core/headless, React, Familiar,
and provider surfaces. Cover anonymous -> A, A -> anonymous, A -> B, watch
reload, reconnect during transition, unmount/remount, foreground work beside
housekeeping, and late predecessor delivery. Each surface may adapt vocabulary
but may not invent different terminal semantics.

## Decision (2026-08-21)

**Adopted per LLP 0295; author may revise.** The total matrix landed as
LLP 0059's dated amendment "Total client authority-transition state and
settlement matrix (2026-08-21, LLP 0295 D0.2)" — LLP 0059 is the single
cross-surface owner; LLP 0107 ("Authority-transition matrix participation")
and LLP 0218 (dated amendment, same date) carry the surface-binding
cross-references. The five client states (anonymous / authenticating /
authenticated / revoking / reconnecting) are a partition defined onto the
LLP 0059 barrier phases: the barrier decides between
authenticating/revoking by LLP 0059's **ordered classifier** —
incarnation/staged auth-mode transitions classify revoking first, then an
authenticated predecessor, else authenticating — is matrix-active from the
phase-2 CAS (phase 1 observes the settled predecessor column), holds
through phase-9 resume even after phase-8 custody settle, and takes
precedence over reconnecting; a **transient watch-reload**
`SNAPBACK_AUTH_MODE_PENDING` refusal (the axisless non-terminal occurrence
per LLP 0059's mode-pending discriminant) is reconnecting state —
retryable, never custody-clearing, never live-stream terminal (a real
staged mode transition per LLP 0058 carries the disposition axis, remains
a barrier, and runs item-5). Ruling numbers below match LLP 0059's "Rulings (the six D0.2
questions)":

1. Every live query — including `optional-user` — is a barrier participant:
   fence at blank, exactly one successor at resume, classified diagnostic on
   failure; never ready/empty/disconnected as settled success. (Consistent
   with the Phase 1A stall fix.)
2. An authenticated one-shot op started signed out settles promptly with a
   typed auth-required refusal, zero transport, no caller timeout; live ops
   project blocked with a transition owner. (Consistent with the Phase 1A
   settlement fix.)
3. During a barrier only declared-housekeeping writes (idempotent,
   latest-wins, successor-valid) may queue, observable as
   `blockedReason: auth-barrier`; nothing dispatches transport under
   unsettled authority; predecessor intent strands/deletes per the item-5
   table.
4. Foreground/housekeeping outbox lane split: housekeeping is coalesced with
   typed supersession (`SNAPBACK_HOUSEKEEPING_SUPERSEDED`), follows the
   item-5 strand/delete disposition of its barrier row exactly like
   foreground intent (no separate "drop"), is never auto-replayed under a
   different principal, and can never head-of-line block a foreground send.
5. Subscribe-safe iff no barrier is active for the context; barrier
   settlement includes usable ephemeral authority, and awaited sign-in
   absorbs the ephemeral successor wait. Reconnecting is subscribe-safe.
6. Queue/authorization/execution/commit/delivery time are separately
   observable with named normative fields: the disposition-union `timing`
   object (`enqueuedAtMs`, `dispatchedAtMs`, `authorizedAtMs`,
   `executedAtMs`, `committedAtMs`), `outboxStatus()` suspension
   attribution (`auth-barrier` beside the shipped `custody-unsettled`),
   subscription `lastDeliveryAtMs`/`authoritativeRevision`, coordinator
   readiness facts, and the LLP 0219 channel.

## W2 implementation checklist

- [x] Author the normative row table (surface × auth declaration × starting
      state × transition event × operation timing → terminal semantic +
      observable fields) as the shared conformance artifact; events and
      timings per the LLP 0059 amendment's suite-shape section.
- [x] Implement the shared core state machine in the headless client; expose
      the settled-authority signal provider adapters consume.
- [x] Core/headless projection of the suite (reference execution).
- [x] React hook projection; Familiar projection (identical semantics);
      Expo re-export rows; provider-adapter projection.
- [x] `optional-user` successor restart rows: sign-in, sign-out, A → B,
      reconnect during transition, unmount/remount, late predecessor frame
      never repopulates (closes
      `20260820-optional-user-live-query-auth-transition-stall.md`).
- [x] Prompt signed-out settlement rows, timeout-independent (closes
      `20260820-authenticated-query-signed-out-settlement.md`).
- [x] Watch-reload rows: no custody loss on transient
      `SNAPBACK_AUTH_MODE_PENDING`; live-stream successor; tight-loop
      awaited-sign-in/ephemeral-authority witness (closes
      `20260820-agent-auth-transition-residuals.md`).
- [x] `auth-barrier` blocked reason (beside shipped `custody-unsettled`) +
      level-triggered settle wakeup in the LLP 0218 drain; housekeeping lane
      split + declaration spelling + item-5-aligned strand/delete
      dispositions + typed supersession; head-of-line witness (foreground
      send latency unaffected by suspended or slow housekeeping).
- [x] Phase-separated diagnostics row: the ruling-6 `timing` fields
      (queue/authorization/execution/commit) plus subscription
      `lastDeliveryAtMs` populated, ordered, and disjoint for one
      instrumented mutation.
- [x] Same-user/new-session rows: strand (never delete) predecessor intent;
      authenticated surfaces re-admit under the same principal.
- [x] Guide recipe for background writes during auth transitions from the
      matrix (absorbs
      `20260818-guide-gap-background-writes-during-auth-transitions.md`),
      with cold retrieval probes per LLP 0061.
- [x] Prove fixes through packed external packages (LLP 0295 Phase 1A exit),
      not source-checkout-only.

## Exit

The owning LLPs contain one accepted total matrix (done 2026-08-21; see
Decision above); the conformance suite proves every named surface against it;
the related defect tickets close on their specific reproductions; and no
transition can remain indefinitely ready/empty/disconnected, pending without
an admitted wait, or silently bound to the predecessor principal.

## Implementation evidence (2026-08-21)

`packages/snapback-client/authority-transition.mjs` generates 2,250 immutable
rows from ten surfaces, five authority states, nine transition events, and
five operation timings. The core suite independently transcribes all 50
surface/state terminal cells, exercises the ordered classifier and
mode-pending discriminant, and pins housekeeping admission both before and
after a predecessor delete root, successor binding, typed supersession,
cross-lane concurrency with exclusive authority cuts, and the strictly ordered five-phase
mutation timing carrier. Contract's readiness suite holds real coordinator
barriers (including same-user/new-session) and joins 200 phase-9 waiters.
React/Familiar replay their matrix projection and retain the production
optional-user choreography for sign-in, sign-out, A → B, reconnect,
unmount/remount, and late-predecessor fencing.

The packed receipt
`node packages/snapback-react/auth-transition-liveness-packed.test.mjs`
installs tarballs for Contract, Client, React, and Expo. It verifies the Expo
row re-export, prompt one-shot and live terminal behavior, Familiar's
optional-user successor, durable-session survival through axisless
mode-pending retries (with a disposition-bearing negative control), and
declared housekeeping queueing under `auth-barrier` with zero transport.

Ruling-6 plumbing is public on every mutation disposition (`timing`) and live
projection (`lastDeliveryAtMs`, `authoritativeRevision`); server mutation
responses stamp authorization, execution, and durable commit separately.
`guide/recipes/auth-transition-writes.md` and retrieval case 61 teach the
declaration, diagnostics, lane behavior, and anti-patterns. The two residual
tickets named by the checklist are resolved under `issues/closed/`.
