# Replay retention: exclusive purge to iat+30+1 on both tables; race the production transaction

**Status:** Closed (2026-07-24)
**Severity:** P1
**Systems:** Auth, Storage, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0077 §HTTP binding (retention) + defect 4, src/auth/sender_proof.rs (MINIMUM_REPLAY_RETENTION_SECONDS, purge predicate, two-connection race), issues/20260723-llp0077-senderauth-program.md
**Marker:** llp-0077, sender-auth, replay, security

**Resolution (2026-07-24, re-landed on main):** expiry is `iat + 30 + 1`
(`REPLAY_RETENTION_AFTER_IAT_SECONDS`), both purges are exclusive (`< now`),
and the production verify/consume/rotate transaction refuses the same `jti`
at the final inclusive second
(`production_admission_refuses_replay_at_final_inclusive_second`). Two
independent SQLite connections race the production transaction, and
`two_processes_racing_production_transaction_have_one_success_and_one_replay`
launches two OS processes against the same durable predecessor — one success,
one replay refusal.

Closes LLP 0077 ledger **defect 4** and the associated test-fidelity gap. The
retention invariant must be: a `jti` is retained strictly past its latest
possible acceptance instant, realized as expiry at `iat + 30 + 1` with an
exclusive `expires_at_seconds < now` purge, on **both** the replay and nonce
tables. Shipped code anchors retention at commit-time `now + 35` (`PAST+FUTURE`)
and purges inclusively (`<= now`), so a proof first accepted at the `+5`
future-skew boundary can be purged exactly when the verifier still accepts it —
a self-replay at the final inclusive second.

**Done when:**

- Retention/purge corrected to the invariant (`< now`, past the latest
  acceptance instant) on both tables; the `now+35`/`<=` form is gone.
- The two-connection race exercises the **production** verify/consume/rotate
  transaction (not the test-only `consume_sender_proof_id`), and an explicit
  test replays the same `jti` at the final inclusive second and is refused.
- A true two-process (not two-thread) replay race is added, as the checkpoint
  already commits to.
- LLP 0077's defect 4 row moves to closed; the conformance retention line and
  the code agree.
