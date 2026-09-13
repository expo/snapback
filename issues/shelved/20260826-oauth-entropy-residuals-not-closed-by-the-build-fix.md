# What the OAuth entropy build fix did *not* close

**Status:** open
**Context:** `75961ea9b` ("fix(auth): derive OAuth token entropy from provider") unbroke `main`.
It is a narrow fix and should not be described as kernel closure. These residuals were
named by review and are recorded here so the fix is not overclaimed later.

## What the fix did close

The engine/HTTP seam no longer accepts a `RandomSource` beside an independently obtained
provider. `AuthAdmission::mint_scoped_token_for_oauth_code_plan` takes no `RandomSource` and
closes over the provider's private `random` field; `LocalSnapback::mint_scoped_token_for_oauth_code`
— the wrapper that accepted caller-supplied entropy — is deleted, with no remaining callers.
Restoring the removed `agent_random_source` accessor would have re-opened a
live-provider-plus-independent-RNG pair; this did not.

## Residual 1 — the kernel mint still takes caller entropy

`crates/snapback-kernel/src/storage/auth_agent_credentials.rs` — the kernel
`mint_scoped_token_for_oauth_code(..., random: &dyn RandomSource)` is the actual effect, and the
`ServingDatabase` forwarder is a pure pass-through to it. A dependent holding
`&mut LocalDatabase` or `ServingDatabase` still supplies entropy directly.

`ServingDatabase::auth_database_mut` is `#[doc(hidden)] pub`, which is not a boundary, and yields
`&mut LocalDatabase`. This is a declared sibling, not a hole in what the fix claims — but it is
open.

## Residual 2 — `execute_auth_plan` does not bind provider instance to database instance

`crates/snapback-engine/src/local/engine.rs` — `execute_auth_plan` runs a sealed plan against
`self.db.auth_database_mut()` without binding the plan's producing provider to the database it
executes against. Read from types, this composition still compiles in a dependent:

```rust
let rogue = AuthProvider::new_with_dependencies(profile, keyring, constant_rng, clock)?;
let admission = rogue.admit().await;
live.execute_auth_plan(admission.mint_scoped_token_for_oauth_code_plan(..));
```

Entropy is then chosen at provider construction (`AuthProvider::new_with_dependencies` is `pub`
and not feature-gated) rather than as a fourth parameter. This is **narrower** than what preceded
it and is the same unbound shape every other `AuthAdmission` plan already has, so it is inherited
rather than introduced — but it is the subject/authority correlation defect in its usual form and
belongs on the roster.

**Marked UNVERIFIED**: the reviewer that found this could not compile, so the composition was read
from types and not executed. Executing it is the first step for whoever picks this up.

## Residual 3 — `admit()` placement

`crates/snapback-server/src/server/oauth.rs` — `provider.admit().await` sits *before*
`spawn_owned_auth_transaction` rather than as the first line inside the spawned future, which is
the pattern used elsewhere (`server.rs:~18583`). Review confirmed this does **not** invert a ranked
lock and does not change mint or refusal semantics: `admit()` takes a process-state read guard, not
a ranked mutex, and cancellation during that await drops the terminal gate and runs exact rollback
before any durable mint begins. Cosmetic ordering, worth tidying, explicitly not a release blocker.

## Related

- `issues/20260826-main-did-not-compile-and-no-gate-caught-it.md` — how the break reached `main`.
- `issues/shelved/20260826-authorization-denominator-and-seam-map.md` — where residuals 1 and 2 sit.
- LLP 0303 revision (s) — a fix that removes a spelling has not necessarily removed a capability.
