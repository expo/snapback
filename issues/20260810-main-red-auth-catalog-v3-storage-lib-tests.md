# main red: 53 lib tests fail after the LLP 0214 auth-floor landing (identity-catalog NOT NULL)

**Status:** Open
**Systems:** Auth, Storage, Testing
**Date:** 2026-08-10
**Detected during:** owner-#2 generation-commit slice verification; reproduced
on pristine merge-base e6d0fe270 (LLP 0218 P2 outbox drain controller), which
contains 961b8be8c (LLP 0214 floor — catalog v3).

Failing on a clean checkout at e6d0fe270, verified this session (identical
counts on the slice branch — the owner-#2 slice adds zero failures):

- `cargo test --lib storage::` — 377 passed / **50 failed**
- `cargo test --lib 'local::'` — 292 passed / **2 failed**
- `cargo test --lib generation` — 62 passed / **1 failed**

Representative failures (all in the auth-catalog families):

- `storage::authorized_lease::tests::*` (issuer_mismatch_and_clock_rollback…,
  reservation_is_one_atomic…, revoked_session_cannot_reserve…, and siblings)
- `storage::auth_agent_credentials::tests::*` (thief_rotates_n…,
  token_cap_evicts_oldest…, and siblings)
- `storage::auth_mode::tests::privileged_restage_between_preflight_and_consume_cannot_mix_function_pairs`
- `storage::tests::membership_write_tests::*` (protected_demotion…,
  expired_protected_holders…, protected_departures…)

Failure shape: `NOT NULL constraint failed: _auth_identities.kind` (and
`_auth_sessions.authn_source` in the generation subset) — test fixtures that
insert identities/sessions directly have not been migrated to the catalog-v3
columns introduced by 961b8be8c.

Attribution: the 0214 auth-floor landing session should claim; per the
2026-08-10 sitting convention, unclaimed for 24h → fix-forward by anyone.
Not bisected past containment here: counts identical with and without the
owner-#2 slice, so this red is wholly pre-existing at the merge-base.
