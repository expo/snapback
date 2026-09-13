# Build the Swift optimistic mutation and offline-settlement write path

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 1
**Confidence:** 5
**Systems:** Swift, Native client, Mutation IR, Optimistic rebase, Offline
outbox
**Date:** 2026-08-16
**Governing:** LLP 0155 Move 3, LLP 0218, LLP 0270
**Related:** LLP 0043, LLP 0053, LLP 0064, LLP 0093, LLP 0095, LLP 0129,
LLP 0133, LLP 0166; `issues/20260815-local-first-defaults-audit.md`

## Problem

Swift's public `mutate(...)` is a direct HTTP POST
(`clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift`).
It does not persist a client mutation identity, evaluate generated mutation
IR, install an optimistic layer, rebase pending operations, or replay after a
connectivity failure.

Two similarly named fixture mechanisms are not the product capability:

- Swift `drainOnce()` reads the server's live-delivery
  `GET /outbox/{connection_id}` lane, not a client mutation outbox; and
- `StateMachine.seedReplayQueue(...)`/`noteMutationSettled(...)` model
  conformance transitions in memory, but are not connected to mutation
  dispatch, durable storage, restart, or connectivity recovery.

`guide/clients/swift.md` accordingly makes no offline `Parity` claim.

## What default means

On a qualified native store, the ordinary Swift mutation call should durably
record deterministic generated intent before exposing it, apply every
locally-executable generated operation to the local materialization without a
hand-written reducer, and return an explicit settled-or-queued outcome. One
client lifecycle owner should replay restored intent automatically after
connectivity/readiness returns, settle exactly once, and rebase remaining
layers over canonical server delivery.

Server-only or incomplete-read operations remain valid: they expose pending
intent without inventing a row effect. Authority/artifact changes quarantine,
strand, adopt, or delete according to the same typed contract as LLP 0218;
they never replay under a guessed successor.

## Consequence classification

**Semantic consequences — not SAFE as an additive helper.** The default
changes pre-settlement UI, begins durable mutation custody and background
network replay, and can cause an operation accepted while offline to execute
later. It needs explicit queued-result, cancellation/recovery, lifecycle,
authority, rejection, and provisional-identity semantics under LLP 0270,
LLP 0218, LLP 0155, and LLP 0133.

## Acceptance

- Generated create/update/delete reference mutations paint immediately with
  no app-authored reducer and survive process death with stable intent and
  provisional identities.
- Offline enqueue followed by app restart and connectivity recovery settles
  exactly once; duplicate delivery is harmless and observable.
- Rejection, strand, quarantine, result-gone, logout, user switch, artifact
  rotation, and authority-recovery cases match the JS settlement contract.
- Lifecycle background/foreground transitions neither lose accepted intent
  nor replay after client teardown.
- The shipped guide and capability rows distinguish this client mutation
  outbox from the server live-delivery outbox.
