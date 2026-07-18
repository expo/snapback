# Isolate finite-service terminal gates by exact token

**Status:** Closed
**Severity:** P2
**Systems:** Agent auth, Service authority, Connection grants, Live queries, Runtime
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0059 §Finite-service-authority fence
**Marker:** auth, service-authority, isolation, availability, terminal-fence

`ServiceAuthorityFenceRegistry` currently has one process-wide
`terminal_pending` bit and one global active-work counter. Ending any one grant,
credential, scoped token, or expiry closes publication and work for every
finite-service principal and waits for all unrelated tokens to drain. A busy or
hung token B can therefore delay revocation of token A, while an A terminal
request transiently denies otherwise-current B. This contradicts LLP 0059's
exact affected-token fence and its explicit requirement that unrelated tokens
remain usable.

The durable transaction does eventually install exact token tickets, so the
defect is isolation and liveness rather than a stale-authority safety hole. The
existing tests encode the coarse behavior and contain no unrelated-token
noninterference proof.

**Done when:**

- Terminal intent is installed for the exact planned token-id set before
  waiting, and only those tokens reject new publication, connection work, and
  native-effect initiation.
- Registration races are covered: a resolution of an affected token between
  durable planning and commit inherits or observes the exact pending intent;
  an unrelated token remains current.
- The exact gate drains only affected-token predecessors outside Local/SQLite,
  is transferred to independently owned durable work, and is settled by exact
  commit, rollback, or ambiguous-commit reconciliation.
- The durable transaction rechecks that its affected token set matches the
  preplanned gate; a changed predecessor rolls back and replans without
  widening to a global closure.
- Grant revoke, bulk revoke, credential rotation/revocation, scoped-token cap
  eviction, pairing mint, and both deadline-terminalization paths use the exact
  gate. Direct storage callers fail closed rather than waiting under Local.
- Deterministic two-token tests prove A terminalization neither blocks on B's
  retained work nor refuses B publication, while A's own predecessor still
  drains before the first durable ending write. Ambiguous sibling tickets
  remain exact.
- Focused service-fence/storage/server tests and the canonical proof pass.

## Resolution

The service fence now installs and drains terminal intent by exact token-id
domain. Affected registrations join the pending domain, disjoint tokens remain
usable, the durable transaction must reproduce the planned token set, and the
ticket remains installed through typed lifecycle propagation before exact
release.

Focused proof includes
`exact_token_gate_drains_only_its_token_and_leaves_unrelated_work_live`,
`absent_token_registration_joins_the_pending_exact_domain`,
`overlapping_gates_serialize_while_disjoint_gates_proceed`,
`transaction_must_reproduce_the_gate_exact_token_set`, and the real-route
terminal pause matrix. The full Rust library suite passed 1,102 tests.
