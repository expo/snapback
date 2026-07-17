# Register the agent client store before durable custody recovery

**Status:** Open
**Severity:** P1
**Systems:** Contract adapter, Agent auth, Client store, Offline replay
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0043, LLP 0055 §Grant-backed live and queued replay
**Marker:** security, durability, recovery

Contract boot synchronized agent custody before registering the physical
client-store participant. A restart from a persisted clearing intent could
therefore settle that intent without replaying the store transition, then fail
to bind the store's predecessor epoch after the recovery witness was gone.
Contract also accepted process-local agent custody for a durable outbox, which
reintroduced epoch-zero identity after every restart.

**Done when:**

- The physical store participant is registered before any agent custody
  synchronization or handshake that can recover an intent.
- Construction failure releases that early registration.
- Agent-backed offline replay requires transactional durable custody.
- A crash-at-clearing restart replays the exact store transition and binds the
  recovered epoch without exposing predecessor data.
