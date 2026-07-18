# Stage connection live effects outside auth fences

**Status:** Closed
**Severity:** P1
**Systems:** Auth, Live queries, Authorization invalidation, Runtime, Connection grants
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0059 §Locking and linearization; LLP 0053
**Marker:** auth, lock-order, staging, realtime, release-blocker

Five connection-bound routes currently call `PreparedConnectionAct::try_act`
from inside `with_snapback`: live subscribe, resume, unsubscribe,
authorization-invalidation acknowledgement, and manual retry. They therefore
retain the global `LocalSnapback` guard plus stream/session/registry locks while
local methods may execute Hermes, read SQLite, or mutate the obligation
ledger. LLP 0059 unconditionally forbids that overlap and limits the exact
connection act to one bounded in-memory ownership transfer.

The uniform stream/registry/mode order prevents the observed admission ABBA,
but it does not make this broader overlap compliant. A precheck/local
mutation/postcheck is also insufficient: terminalization between those steps
could expose or strand a stale scope, subscription, acknowledgement, or retry
episode.

**Done when:**

- Each route reserves only immutable inputs, capacity, and exact target keys
  under Local; it performs no Hermes/SQLite or subscription/obligation effect
  before the exact connection act.
- A staged object is non-publishable until one exact connection act performs a
  bounded in-memory commit beneath stream/session, registry, then mode
  admission.
- The act first reserves bounded stream/session and optional finite-service
  authority work. Those lock-free permits remain owned through post-cut Local
  execution, while terminal premark closes new reservations and drains every
  predecessor permit before a durable authority-ending write.
- Once the act commits, an independently spawned finalizer owns the stage,
  mode root, and authority permits; request cancellation cannot abandon the
  committed stage or release terminal exclusion while Local work still runs.
- Act refusal or terminalization abandons the stage idempotently without
  consuming an acknowledgement, resolving a retry episode, exposing a live
  scope, or replacing/removing a retained subscription.
- Post-act finalization is idempotent and cannot fail into a half-published
  state; disconnect and terminal purge handle pending/committed stages.
- Deterministic races cover terminalization before commit, act refusal,
  duplicate finalize/abandon, and no live fanout from pending stages.
- Focused local/server tests, repeated RBAC acceptance, and the canonical proof
  pass.

## Resolution

Connection-bound live operations now prepare inert stages under Local, perform
one bounded connection act to reserve the exact authority carriers, and hand a
committed stage to an independently owned finalizer. Refusal and abandonment
are one-shot and cannot publish, consume an acknowledgement, or disturb the
retained predecessor.

Focused proof covers `staged_subscribe_queries_after_the_exact_act_cut`,
`staged_live_effect_binding_terminal_and_one_shot_lifecycle`,
`prepared_connection_act_loses_to_concurrent_stream_premark`,
`committed_live_stage_finalize_outlives_request_cancellation_and_retains_work`,
and `refused_connection_act_abandons_staged_subscribe_without_publication`.
Repeated RBAC acceptance and the full Rust library suite also passed.
