# Signed-URL bearer test flaked ~1 run in 4 — root cause: the tamper was a no-op

**Status:** RESOLVED 2026-07-31 (Lane-2 interrupt cluster)

`asset_signed_url_issues_and_serves_as_a_bearer_until_ttl` failed
transiently across the W2b..W2g full-suite runs and was suspected
parallelism-sensitive. Reproduced on run 7 of a dedicated loop
(`panicked at src/local.rs:27141:14` — the
`.expect_err("tampered token refuses")`): the test "tampered" the token
by replacing its final character with a fixed `'A'`. An HMAC-SHA256
signature is 32 bytes → 43 base64url characters, and the final
character's 6-bit group carries only two meaningful bits, so its value
set is exactly `{A, Q, g, w}` — with probability 1/4 the signature
already ended in `'A'`, the "tampered" token was byte-identical to the
valid one, and delivery correctly served it. Not parallelism: each run
mints a fresh signing key, an independent 1/4 coin flip, which matches
the observed sighting rate; "full-suite-only" was sampling bias (the
subset was rerun fewer times).

Fix: the tamper now swaps the final character to a guaranteed-different
member of the value set. 12/12 targeted runs and two consecutive full
suites green post-fix. Lesson for future signature tests: never tamper
by writing a fixed character into a base64 tail; flip to a value proven
different.
