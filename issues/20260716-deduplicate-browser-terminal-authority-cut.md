# Deduplicate the browser terminal authority cut

**Status:** Open
**Severity:** P1
**Systems:** JavaScript client, Browser auth, AuthCoordinator, Client store
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0059 §Transition barrier, LLP 0059 §Participant contract
**Marker:** security, concurrency, lifecycle

A classified browser `durableDelete` first performs the client's manual
synchronous transport/materialization cut and then calls
`AuthCoordinator.compareAndClear()`, whose transition invokes the same client
participant phases again. Double callback and generation advancement can make
otherwise-idempotent cleanup fail, overflow, or obscure the one terminal event
that owns the transition.

**Done when:**

- One terminal event performs each client transport participant's quiesce,
  blank, and clear-memory phase exactly once.
- The following durable coordinator transition recognizes only the exact
  predecessor cut; other transitions and partially failed phases still run.
- Durable participants outside the pre-cut client transport continue through
  the normal coordinator barrier and final confirmation.
- Deterministic browser terminal tests assert exact callback/generation counts,
  durable clearing, and successor resume.
