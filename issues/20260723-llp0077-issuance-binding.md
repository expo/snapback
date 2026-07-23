# Issuance binding: bind-only-at-issuance; consume the jti even on a wrong code

**Status:** Open
**Severity:** P1
**Systems:** Auth, Storage, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0077 §Issuance + defect 6 and defect 11 (jti half), LLP 0057 (code-attempt accounting; Revised note covers the issuance-outcome table), src/auth/sender_proof.rs (bind_new_session_sender_constraint), src/server.rs (exchange reject vs issue arms), issues/20260723-llp0077-senderauth-program.md
**Marker:** llp-0077, sender-auth, issuance, security

Closes LLP 0077 ledger **defect 6** and the jti half of **defect 11**.

Defect 6: `bind_new_session_sender_constraint` accepts any existing `session_id`,
so a v1 (bearer-only) family could be bound after issuance. The capability to
bind a sender constraint must exist only inside the new-session issuance
transaction — no supported API may attach a constraint to an extant session.

Defect 11 (jti half): a cryptographically valid issuance proof paired with a
wrong/locked/exhausted code returns before sender commitment, so its `jti` is
not consumed — permitting cross-guess reuse of a single valid proof. The
LLP 0057 Revised note already delegates this outcome accounting.

**Done when:**

- Binding is restricted to the session-issuance transaction; a test proves no
  supported API binds an extant v1 family.
- A valid issuance proof consumes its `jti` even on a wrong/locked/exhausted
  code (a wrong code still increments the LLP 0057 attempt counter); only a
  valid proof plus a correct code binds the thumbprint and publishes, all in
  one transaction.
- Tests cover invalid-proof, valid-proof+wrong-code, valid-proof+correct-code,
  exhausted-challenge, replay, and authority-failure outcomes.
- LLP 0077's defect 6 row and the jti half of defect 11 move to closed.
