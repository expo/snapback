# Settlement acknowledgement lifecycle: durable consumption, retention,
# terminal outcomes (LLP 0043)

**Status:** Open
**Impact:** 5
**Urgency:** 3
**Ease:** 2
**Confidence:** 4
**Severity:** P2
**Systems:** Client integration, API, Storage
**Author:** Claude (Fable 5), 2026-08-01 triage sweep (re-filed from the
shelved app-cli program per Charlie's 2026-08-01 decision)
**Date:** 2026-08-01
**Related:** LLP 0043 (mutation acknowledgement), LLP 0053,
src/storage.rs (recorded mutations, retention caps),
issues/closed/20260717-app-cli-mutation-settlement.md (original),
issues/20260731-js-arm-lease-custody-and-sessions-outbox.md (the JS-arm
outbox lane this contract must compose with)
**Marker:** protocol, contracts

Re-filed against its real owner: this is an LLP 0043 protocol-contract
item, not an app-cli feature. The substantive ask, carried over:

LLP 0043 pins durable `clientMutationId` persistence "until settled" and
server-bounded retention (`SNAPBACK_CLIENT_MUTATION_RETENTION_FULL`)
reclaimed only after client acknowledgement. Two hazards follow for any
durable non-browser caller: never acknowledging exhausts retention, and
acknowledging before durable local consumption can destroy the only
settlement proof. The acknowledgement lifecycle contract is still
unpinned:

- define the durable client state machine (pending →
  settlement-received → durably consumed → acknowledgement-pending →
  acknowledged/removed) with fsync and publication ordering; unknown
  outcomes are never acknowledged;
- define what "durably consumed" means per caller class (long-lived
  provider with a durable store vs a process-per-invocation caller —
  a complete stdout/report write alone is not durable recovery state
  unless explicitly chosen and justified);
- pin standalone vs piggyback ACK usage and retry behavior;
- decide (not merely test) the terminal outcome for settlements whose
  function was removed or renamed post-commit: recovered through a
  non-executing authority-bound lookup, or permanently unknown under a
  pinned outcome;
- wire replay re-attestation to the auth-fingerprint-keyed
  recorded-mutation store (replay under changed
  profile/user/grant/authority/generation refuses with zero dispatch).

Context since the original filing: the JS arm's M2 outbox landed
(client-minted `clientMutationId`, ordered exactly-once replay,
settlement-ledger dedupe — verified against 0.1.8 in the 0137
re-verification pass), so the queue half exists; what remains unpinned
is the acknowledgement/retention half of the LLP 0043 contract and its
crash-ordering guarantees.

**Done when:**

- The state machine, durable-consumption/publication boundary, ACK
  mode/retry ordering, and removed-function terminal outcome are pinned
  in LLP 0043 (dated revision).
- Crash-point tests at every state transition; ACK-loss retry;
  retention-pressure behavior; commit-then-deploy/removed-function
  terminal outcome — all green against a live server.
- Replay under changed authority refuses with zero dispatch, wired to
  this state machine's records.
