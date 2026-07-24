# Sender-proof nonce integrity: challenge never rotates a live nonce; unknown-carrier cover nonce

**Status:** Closed (2026-07-24)
**Severity:** P1
**Systems:** Auth, Hosted runtime, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0077 §Nonce protocol + defects 1 and 13, src/auth/sender_proof.rs (fresh_challenge → issue_sender_nonce), issues/20260723-llp0077-senderauth-program.md
**Marker:** llp-0077, sender-auth, nonce, security

**Resolution (2026-07-24, re-landed on main):** `fresh_challenge` returns a
live installed nonce unchanged; a generation is minted only when none is
installed or the installed one expired; rotation happens only inside the
verified-proof consume/rotate transaction
(`pre_body_admission_challenges_then_accepts_and_rotates`). Unknown/malformed
carriers with or without a proof receive `_REQUIRED` with the decision-3
deterministic keyed cover nonce (`HMAC(purpose key, epoch ‖ token_digest ‖
time_bucket)`), stable within one nonce-TTL bucket and never installed
(`unknown_carrier_cover_nonce_is_keyed_stable_and_never_installed`,
`invalid_bearer_missing_proof_gets_untracked_opaque_challenge`); a genuinely
absent Authorization header still yields `SNAPBACK_AUTH_REQUIRED` (served
suites). LLP 0077 ledger rows 1 and 13 carry the fix witnesses.

Closes LLP 0077 ledger **defect 1** and **defect 13** — both are nonce-challenge
integrity bugs on the copied-bearer adversary's only reachable lever.

Defect 1: `fresh_challenge` unconditionally calls `issue_sender_nonce`, which
rotates a live installed generation (`generation = value + 1`, `ON CONFLICT DO
UPDATE`) on any resolvable thumbprint, including the unauthenticated
missing-proof and nonce-mismatch paths. The Spec requires a challenge to return
the **still-current** live nonce unchanged and to install a fresh generation
**only when the current one is absent or expired**. As shipped, a copied-bearer
holder can churn a family's nonce and race the legitimate client's one-shot
challenge-retry into lockout.

Defect 13: an unknown carrier bearing a present proof returns
`SNAPBACK_AUTH_SENDER_PROOF_INVALID` **without** the cover nonce, diverging from
the anti-oracle matrix (unknown/malformed carriers must fold into the
`_REQUIRED` challenge *with* a cover nonce). The cover nonce's existence is the
fixed contract; whether it must be stable-and-keyed is the separate open
question in `20260723-llp0077-client-contract.md`.

**Done when:**

- `fresh_challenge`/`issue_sender_nonce` return the current live nonce without
  rotation; a new generation is minted only when none is installed or the
  installed one is expired; rotation of a live nonce happens only inside the
  verified-proof consume/rotate transaction.
- Negative test: repeated unauthenticated (missing-proof and wrong-nonce)
  requests against a live generation leave both the nonce value and generation
  unchanged; the legitimate client's single retry still succeeds.
- Unknown/malformed carrier with a present proof returns `_REQUIRED` with a
  cover nonce (not `_INVALID` without one); test covers absent/malformed/unknown
  × no-proof/valid-proof cells.
- LLP 0077's defect 1 and 13 rows move to closed and the tagged normative rules
  drop their defect tags.
