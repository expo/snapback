# Fence finite scoped-token effects and response publication

**Status:** Closed
**Severity:** P0
**Systems:** Agent auth, HTTP invocation gate, Bootstrap handshake, Connection grants, Storage, Runtime, Concurrency
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0055 §Ending authority: revocation, expiry, deactivation; LLP 0058 §Gate algorithm
**Marker:** security, authorization, concurrency

**Implementation evidence (2026-07-16):** The database-owned
`ServiceAuthorityFenceRegistry` now registers an exact token/grant/actor/
credential/deadline witness while resolution still owns the app lock. Finite
query, mutation, action, `/auth/session`, connection-open, retained live, and
connection-act paths carry and validate that handle. Every authority-ending
transaction performs a read-only exact-token plan, premarks those fences before
its first write, and settles only its own ticket; deterministic rollback
uncertainty proves the planned token remains unavailable while an unrelated
token stays current and exact durable reconciliation reopens only the former.
Token/grant deadline observation is persisted before terminal publication and
survives restart. Ibex native fetch has a tested Begin → native enqueue →
Initiated handshake, including synchronous refusal and terminal-at-Begin.

Root review recorded the canonical full route-by-ending pause matrix in
`97cb1f8`: all six real HTTP route classes pause after scoped-token resolution,
then each of the six real storage endings wins before the applicable effect or
publication cut.

At discovery, finite scoped-token routes resolved a token from SQLite but
prepared no service-authority publication fence. A concurrent grant revocation, credential
rotation/revocation, principal deactivation, token expiry, or token-cap eviction
could therefore linearize after resolution but before a query response became
visible or a mutation/action effect committed. `PreparedAuthority` treated the
missing publication handle as permission to publish directly. The same
resolve-to-use gap let `/auth/session` publish a stale durable-custody
descriptor and `/connection/open` install a service grant after the revocation
notifier already missed it; later `PreparedConnectionAct` checked only the
cached token deadline plus anonymous stream/registry state.

**Done when:**

- Finite scoped-token authority carries an exact service/token witness from
  resolution through the in-lock effect cut and final response handoff.
- Query responses computed under a predecessor authority cannot publish after
  that authority becomes terminal.
- `/auth/session` cannot publish a service-principal authority descriptor after
  its exact token/grant/credential/principal witness becomes terminal.
- Mutation and applicable action effects revalidate before commit, so a
  revocation that wins the cut prevents both the effect and its response.
- Scoped-token connection insertion atomically revalidates and binds the exact
  service witness, and every connection act rechecks that witness; a
  resolve→revoke→insert race cannot create a stale grant and an
  open→revoke→act race cannot produce an effect.
- Terminal diagnostics preserve the exact `carrier` versus `durableDelete`
  axis: token expiry/cap eviction are carrier-only; grant/credential/principal
  endings are durable.
- Deterministic pause-after-resolution races cover grant revoke, credential
  rotation/revoke, principal deactivation, token expiry/cap eviction, the
  finite query/mutation/action route classes, `/auth/session`, connection
  insertion, and connection acts.

## Resolution

Closed 2026-07-16. Commit `dfd829e` introduced `src/auth/service_fence.rs` and threaded
its act/publication fence through finite routes, handshake, connection open/acts, and
retained live work. Commit `97cb1f8` adds deterministic post-resolution barriers and
a 36-case real HTTP route × real storage-ending matrix, proving exact disposition and
no stale row, connection-grant, queued-frame, descriptor, or response publication.
