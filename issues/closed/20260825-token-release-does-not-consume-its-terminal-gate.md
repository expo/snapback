# `/auth/agents/token/release` does not consume its terminal gate

Status: closed
Date: 2026-08-25
Systems: snapback-kernel, snapback-server
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/20260824-test-support-tiering.md

## Finding

`/auth/agents/token/release` acquires a service-authority terminal gate, but **its storage release
cut does not consume that gate through the service-terminal transaction path.**

Consequence: the route can return **204** while the process publication **reopens or remains
current**. The caller is told the token was released; the durable effect the gate was guarding did
not happen in the way the gate implies.

## Why it matters

This is the acquire-without-consume shape. A gate that is taken and then not consumed by the
transaction it guards provides ordering theatre rather than a control — the same family as
LLP 0303 revision (k), where a durable record consulted only at acquisition turns out to be a cache,
and the F112 root finding, where `acquire_gate` **borrows** rather than consumes its plan so the plan
survives its own use.

A 204 on a release path is a particularly bad place for it, because callers reasonably treat that as
"the credential is gone."

## Provenance

Found incidentally by the test-support harness migration lane while converting service-terminal
tests to production ceremonies. Fixing the kernel path was outside that lane's scope, so its
migrated server tests instead use the working `/auth/agents/revoke-self` ceremony and explicitly
observe `DurableDelete` — a deliberate choice to avoid asserting against a broken path, and worth
noting because a lane that had quietly written its test against `token/release` would have baked the
defect into the suite as expected behaviour.

## What a fix needs

The release cut must run through the service-terminal transaction path so the gate is consumed by
the same transaction that performs the release, and the route must not report success unless that
transaction committed the intended durable effect.

Check the sibling release/revocation routes for the same shape before closing — this programme's
consistent finding is that a correct path sits next to an incorrect one (LLP 0303 revision (n)).

## Resolution (2026-08-25)

Root cause: `auth_agent_token_release` acquired and installed the exact scoped token's Carrier
terminal gate, but `LocalDatabase::release_scoped_token` performed the revocation through an
ordinary auth transaction. The storage cut therefore never consumed the installed service-terminal
plan, and dropping the unconsumed gate could republish Current authority after a 204 response.

`release_scoped_token` now resolves and revokes the exact token inside
`attempt_auth_transaction_with_service_terminal`, so the same transaction consumes the Carrier
gate and commits `revoked_at_ms`. Commit-uncertain handling proves either the exact durable revoked
successor or the exact live predecessor before reporting success or rollback. A kernel regression
observes the consumed gate, durable row, and idempotent retry; a second kernel regression covers a
lost commit acknowledgement. The server regression retains the live process publication and
observes both `Terminal(Carrier)` and production resolution refusing the durably revoked token.

The sibling audit enumerated every other `server.rs` service-terminal acquisition: single and bulk
grant revocation, agent credential rotation, grant/pairing token mint replacement, `revoke-self`,
integration credential retirement, expired-service-authority persistence, operator integration
principal retirement, and the live expired-authority settlement path. Their corresponding kernel
cuts already use `attempt_auth_transaction_with_service_terminal`; no sibling acquire-without-
consume ticket was required. `/auth/oauth/revoke` does not acquire a service-terminal gate and is
not this defect shape.

Fail-first evidence:

- `cargo test -p snapback-kernel exact_scoped_token_release_consumes_terminal_transaction_and_is_idempotent`:
  `FAILED. 0 passed; 1 failed; 846 filtered out` because the interlock observed no consumed gate.
- `cargo test -p snapback-kernel scoped_token_release_reconciles_a_lost_commit_acknowledgement`:
  `FAILED. 0 passed; 1 failed; 847 filtered out` via `uncertainty.consumed()` because the release
  cut did not consume the selected commit-uncertainty injection.
- `cargo test -p snapback-server token_release_consumes_terminal_gate_and_commits_durable_revocation`:
  `FAILED. 0 passed; 1 failed; 598 filtered out` because the retained publication remained
  `Current` instead of `Terminal(Carrier)`.

Verification after the fix:

- `cargo test -p snapback-kernel scoped_token_release`: `ok. 2 passed; 0 failed; 846 filtered out`.
- `cargo test -p snapback-server token_release`: `ok. 1 passed; 0 failed; 598 filtered out`.
- `cargo test -p snapback-server agent_token_route_accepts_exactly_one_target_and_returns_complete_receipts`:
  `ok. 1 passed; 0 failed; 598 filtered out`.
- `cargo build --bin snapback`: finished the dev profile successfully.
- `scripts/bootstrap-ibex-runtime`: exact link, launch, and restricted handler-VM qualification
  passed and re-minted the dirty-input readiness receipt.
- `./ref-check --verbose`: `311 LLP docs, 7176 refs in 15414 files, 0 errors, 0 unchecked`.
- `node scripts/check-inventories.mjs`: `PASS: 353 package tests; 29 scripts tests; 31 demos/31
  catalog entries; 487 publication leaves; 157 guide pages/1871 snippets`.

Round-2 test-isolation verification:

- `cargo test -p snapback-kernel commit_acknowledgement -- --test-threads=3` ten times:

  ```text
  run 01: test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 845 filtered out; finished in 0.17s
  run 02: test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 845 filtered out; finished in 0.19s
  run 03: test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 845 filtered out; finished in 0.19s
  run 04: test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 845 filtered out; finished in 0.17s
  run 05: test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 845 filtered out; finished in 0.18s
  run 06: test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 845 filtered out; finished in 0.17s
  run 07: test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 845 filtered out; finished in 0.17s
  run 08: test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 845 filtered out; finished in 0.17s
  run 09: test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 845 filtered out; finished in 0.17s
  run 10: test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 845 filtered out; finished in 0.17s
  stress summary: 10/10 ok
  ```

- `cargo test -p snapback-kernel scoped_token_release`: `test result: ok. 2 passed; 0 failed; 0
  ignored; 0 measured; 846 filtered out; finished in 0.10s`.
- `./ref-check --verbose`: `ref-check: ok — 311 LLP docs, 7176 refs in 15414 files, 0 errors,
  0 unchecked`.
- `node scripts/check-inventories.mjs`: `[check-inventories] PASS: 353 package tests; 29 scripts
  tests; 31 demos/31 catalog entries; 487 publication leaves; 157 guide pages/1871 snippets`.
- `node scripts/check-guide.mjs`: `[guide-check] FAILED — 21 passed, 1 failed, 0 skipped, 0
  preconditions; 157 pages, 1871 snippets, 174 routes + 51 host-ops joined, 94 warnings`. The sole
  failure is the known inherited benchmark-transcript accessor check:
  `unallowlisted raw-client asset accessor in benchmarks/runs/2026-08-23-r2-published-0125/cells/opus-clique-explicit/events/harness.stdout.jsonl; use createAssetClient(client)`.
- `git diff --check`: clean (no output).

This landing enforces the durable Carrier terminal cut only for
`/auth/agents/token/release`. It does not claim closure of the wider authorization or
service-terminal surface.
