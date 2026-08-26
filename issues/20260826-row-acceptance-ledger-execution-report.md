# Row-acceptance ledger execution report

Type: Research  
Status: Active  
Systems: auth, engine, kernel, server, sync, test-support  
Author: Codex  
Date: 2026-08-26  
Revised: 2026-08-26  
Related: `issues/20260826-row-acceptance-ledger-62-units-remain.md`, LLP 0303 revision (s)

## Result

This pass tested the requested present-state claim at repository commit
`81d3321449b2af0f1e2f2f11b5bb4c5aa37dd65b`. Of the 28 units tested, 16 were
CONFIRMED, 11 were WRONG, and one was UNDETERMINED.

- POWERLESS: 2 CONFIRMED, 0 WRONG, 1 UNDETERMINED.
- OUTSIDE-AUTHORITY-CREATION: 9 CONFIRMED, 6 WRONG.
- sampled DELETED: 5 CONFIRMED, 5 WRONG.

The deletion-sample error rate is **5/10**. All five errors point in the same
direction: **false DELETED** — a public route still reached the authority effect.
There were no errors in the opposite direction. This was a purposive cross-crate
sample, not a random sample, so 5/10 measures this sample and is not a confidence
interval for the unsampled 37 units.

The source ledger describes these dispositions as final-state work, while the
commission asked whether the surfaces are gone on the current tree. This report
uses the commissioned present-state acceptance criterion. The ledger was not
edited.

## Bootstrap and witness provenance

The required first command was:

```text
scripts/bootstrap-ibex-runtime
```

It exited 1 before any Cargo command because the sandbox could not lock
`.git/config` while initializing `vendor/ibex`:

```text
error: could not lock config file .git/config: Operation not permitted
SNAPBACK_IBEX_SUBMODULE_INIT_FAILED
```

The gitlink commit was already present in the prepared sibling checkout
`/Users/ccheever/lanes/ibex.wedged.20260825134000/ibex`. Recovery and the successful
bootstrap were:

```text
rsync -a --exclude='.git' /Users/ccheever/lanes/ibex.wedged.20260825134000/ibex/ vendor/ibex/
SNAPBACK_IBEX_CHECKOUT=/Users/ccheever/lanes/ibex.wedged.20260825134000/ibex scripts/bootstrap-ibex-runtime
```

The second command exited 0 and emitted `SNAPBACK_IBEX_RUNTIME_LINK_OK` and a
runtime-qualification result with `"ok":true`. The qualified binary SHA-256 was
`e4ded28fe1bca4e4f5f25c500a07804acd492d7a525c8622195de47fe16e24f8`.

Custom evidence code lived only in ignored build space at
`target/ledger-execution-81d332`; it did not change product code. Its source
SHA-256 values were:

```text
793f22c5b27138db40bfa1bbb8171df8a5905270ad879cd4c1af5120d12b7ab0  Cargo.toml
bea5bd732c693019a85d69f5ba44a13a7b0dad9f117efed2ff472f23b7e78887  src/bin/f006.rs
22bf308cd7eff2ca93adeb3ca99d62d95851b22fc689450546bc7f67f83bc977  src/bin/f096.rs
7c140e4094de4c56e741da2a8e42b105ec760a89bc7092c11e07cc8c79d87f10  src/bin/rooms.rs
1db1f3a438942898411f19769a5d58c4411d54a50cadc78e89f4201b5993832b  src/bin/ask.rs
5e6646c68d26559b65e2f584fe151aa4fa4859322c407f56e9bc519e7b9069a9  src/bin/rehearsal.rs
4caf6b33915844294ca2413130a5404437010e65fc7a7c9fc466fb62907d0814  src/bin/watch.rs
```

## Verdict table

Commands in this table are the commands that actually ran. A command shared by
multiple rows is repeated so each verdict remains independently auditable.

| Unit | Claimed disposition | Verdict | Command that settled it |
|---|---|---|---|
| F006 | POWERLESS | CONFIRMED | `./target/ledger-execution-81d332/target/debug/f006` |
| F096 | POWERLESS | UNDETERMINED | `cargo check --manifest-path target/ledger-execution-81d332/Cargo.toml --bin f096` refused the attempted consumer; both runtime test commands listed under “Could not settle” were build-blocked. |
| F242 | POWERLESS | CONFIRMED | `./target/ledger-execution-81d332/target/debug/rooms` |
| F043 | OUTSIDE-AUTHORITY-CREATION | WRONG | `cargo test -q -p snapback-server grant_step_up_is_domain_separated_target_bound_and_single_effect -- --nocapture 2>/dev/null` |
| F044 | OUTSIDE-AUTHORITY-CREATION | WRONG | `cargo test -q -p snapback-server planned_exchange_verifies_and_accounts_inside_the_issuance_transaction -- --nocapture 2>/dev/null` |
| F054 | OUTSIDE-AUTHORITY-CREATION | WRONG | `cargo test -q -p snapback-server grant_step_up_is_domain_separated_target_bound_and_single_effect -- --nocapture 2>/dev/null` |
| F055 | OUTSIDE-AUTHORITY-CREATION | WRONG | `cargo test -q -p snapback-server planned_exchange_verifies_and_accounts_inside_the_issuance_transaction -- --nocapture 2>/dev/null` |
| F063 | OUTSIDE-AUTHORITY-CREATION | WRONG | `cargo test -q -p snapback-server password_lockout_is_uniform_resets_decays_and_expires -- --nocapture 2>/dev/null` |
| F067 | OUTSIDE-AUTHORITY-CREATION | WRONG | `cargo test -q -p snapback-server request_code_has_exact_window_supersession_and_no_app_stream_effect -- --nocapture 2>/dev/null` and `cargo test -q -p snapback-server challenge_exchanges_through_its_retired_key_after_rotation -- --nocapture 2>/dev/null` |
| F129 | OUTSIDE-AUTHORITY-CREATION | CONFIRMED | `set -o pipefail; cargo check --manifest-path tests/fixtures/row-attacks/Cargo.toml --bin f129 2>&1 \| tail -30` and `cargo test -q -p snapback-server external_gate_keeps_first_party_direct_and_approval_executes_or_denies_once -- --nocapture 2>/dev/null` |
| F203 | OUTSIDE-AUTHORITY-CREATION | CONFIRMED | `./target/ledger-execution-81d332/target/debug/ask` |
| F204 | OUTSIDE-AUTHORITY-CREATION | CONFIRMED | `./target/ledger-execution-81d332/target/debug/ask` |
| F243 | OUTSIDE-AUTHORITY-CREATION | CONFIRMED | `./target/ledger-execution-81d332/target/debug/rooms` |
| F257 | OUTSIDE-AUTHORITY-CREATION | CONFIRMED | `./target/ledger-execution-81d332/target/debug/ask` |
| F258 | OUTSIDE-AUTHORITY-CREATION | CONFIRMED | `./target/ledger-execution-81d332/target/debug/ask` |
| F259 | OUTSIDE-AUTHORITY-CREATION | CONFIRMED | `./target/ledger-execution-81d332/target/debug/ask` |
| F260 | OUTSIDE-AUTHORITY-CREATION | CONFIRMED | `./target/ledger-execution-81d332/target/debug/ask` |
| C014 | OUTSIDE-AUTHORITY-CREATION | CONFIRMED | `./target/ledger-execution-81d332/target/debug/ask` |
| F094 | DELETED | CONFIRMED | `set -o pipefail; cargo check --manifest-path tests/fixtures/row-attacks/Cargo.toml --bin f094 2>&1 \| tail -35` |
| F113 | DELETED | CONFIRMED | `set -o pipefail; cargo check --manifest-path tests/fixtures/row-attacks/Cargo.toml --bin f113 2>&1 \| tail -28` and alternate `set -o pipefail; cargo check --manifest-path tests/fixtures/row-attacks/Cargo.toml --bin c006 2>&1 \| tail -28` |
| F115 | DELETED | CONFIRMED | `set -o pipefail; cargo check --manifest-path tests/fixtures/row-attacks/Cargo.toml --bin f115 2>&1 \| tail -28` and alternate `set -o pipefail; cargo check --manifest-path tests/fixtures/security-boundaries/Cargo.toml --bin service-interlock-factory 2>&1 \| tail -35` |
| F121 | DELETED | WRONG | obsolete spelling: `set -o pipefail; cargo check --manifest-path tests/fixtures/row-attacks/Cargo.toml --bin c005 2>&1 \| tail -28`; surviving route: `./target/ledger-execution-81d332/target/debug/ask` |
| F202 | DELETED | WRONG | `./target/ledger-execution-81d332/target/debug/rehearsal` |
| F232 | DELETED | WRONG | `cargo run --quiet --manifest-path tests/fixtures/row-attacks/Cargo.toml --bin f321 2>/dev/null` |
| C005 | DELETED | WRONG | obsolete spelling: `set -o pipefail; cargo check --manifest-path tests/fixtures/row-attacks/Cargo.toml --bin c005 2>&1 \| tail -28`; surviving route: `./target/ledger-execution-81d332/target/debug/ask` |
| C009 | DELETED | CONFIRMED | `set -o pipefail; cargo check --manifest-path tests/fixtures/row-attacks/Cargo.toml --bin c009 2>&1 \| tail -28` |
| C012 | DELETED | CONFIRMED | `set -o pipefail; cargo check --manifest-path tests/fixtures/row-attacks/Cargo.toml --bin c012 2>&1 \| tail -28` |
| ADD-TS-01 | DELETED | WRONG | `./target/ledger-execution-81d332/target/debug/watch` |

## Executed observations

The five custom runtime witnesses were executed together, each exiting 0:

```text
F006 guard_provider=A plan_provider=B same_sqlite=true commit=Committed different_digest=Conflict conclusion=guard_not_authority
F242 wrong_generation=AuthorityPending wrong_room=AuthorityPending victim_generation_before=1 after=1 other_generation=0 conclusion=admission_has_no_effect
F243 absent_target_retirement=victim_unchanged selected_victim_retirement=generation_1_to_0 conclusion=in_memory_destruction_only
C014/F257/F258 local_ask_rows=3 local_sessions=0 local_users=0 F259/F260 serving_ask_rows=3 serving_sessions=0 serving_users=0 F203/F204 independent_authority=authority-owner billed=independent-billing-victim settled_tokens=7 conclusion=durable_billing_only
F202 local_grant=01a03dde-efb4-70e1-81c3-38482d9ff74b engine_grant=01a03dde-eff0-7f11-8238-92708ee2b283 scope=challengeCapture conclusion=rehearsal_authority_still_minted
ADD-TS-01 seeded=watch-caller-selected production_consumer=transition_watch final_status=dead conclusion=test_support_seam_still_reachable
```

F006 held provider A's guest-idempotency mutex guard, then used provider B
against the same SQLite resource and keyring. A valid request committed. Reusing
the same durable key with a different digest conflicted. The guard did not confer
authority.

F242 supplied both a wrong generation and a wrong room to protected room
admission. Both returned `AuthorityPending`; victim and other-room generations
were unchanged. Dropping a valid admission also changed no room or authority
state.

F243 selected a victim room for retirement. A selected live generation moved
from 1 to 0, while an absent-target retirement left the victim unchanged. The
effect was in-memory availability/destruction only.

The ask witness supplied a caller-selected `AskSpendSubject` through local,
guarded-local, serving, and guarded-serving wrappers. It found three durable
`_snapback_ask_spend` rows and zero `_auth_sessions` and `_auth_users` rows in
each database. It then prepared dev authority for `authority-owner`, billed the
independent `independent-billing-victim`, and settled seven tokens. F203, F204,
F257, F258, F259, F260, and C014 are billing attribution/DoS defects, not
authority creation.

F129's old single-value caller-attribution API failed with `E0599`. Its replacement
requires separate effect and approver attribution. The runtime test executed the
effect and asserted telemetry `callerLane=anonymous`, `callerKey=anonymous`, and
an approver key derived from the actual approver user. The residual defect is
audit attribution only.

The six named server tests each exited 0 with one passed test and no failures.
Their material assertions were:

- F043/F054: missing proof, challenge substitution, request substitution, and
  wrong-session proofs were unauthorized; the correct proof created a grant;
  concurrent retry produced a single effect.
- F044/F055: a wrong code committed `CodeInvalid` with durable
  `(attempts,sessions)=(1,0)`; a correct retry committed a session.
- F063: ten bad passwords produced `CredentialInvalid`, a failed count of 10,
  and lockout; a correct password at lock expiry returned
  `IssuanceFinish::Committed` and reset the ledger.
- F067: the delivery path created and superseded challenges and throttled the
  sixth request without app-stream facts. A separately executed challenge
  exchange still created an `email-code` session after key rotation.

The successful F321 runtime attack printed exactly:

```text
SNAPBACK_ROW_ATTACK {"row":"F321","observed":"OPEN","diagnostic":"durable row=approles_... principal=victim-principal role=\"admin\""}
```

This is the alternate route to F232: public `MembershipWriter::Admin` planned a
privileged membership insert, commit succeeded, and durable readback found the
victim principal's admin row.

## Misclassifications and concrete routes

### OUTSIDE-AUTHORITY-CREATION

- **F043 and F054:** the step-up transition charges/refuses invalid attempts,
  but the same executed public transition accepts the correctly bound proof and
  creates a grant. Concrete route: challenge + correct request/session-bound
  proof -> `grant_step_up...` -> committed grant. Under the commissioned “ANY
  composition” criterion these are not outside authority creation.
- **F044 and F055:** the exchange transaction durably advances another
  challenge's failed-attempt state, then a correct code through that same
  exchange transaction creates a session. Concrete route: planned exchange +
  valid code -> issuance transaction -> committed session.
- **F063:** the password ledger supplies the lockout/DoS effect, and the same
  password issuance composition creates a session after the lock expires.
  Concrete route: account + correct password at expiry ->
  `IssuanceFinish::Committed`.
- **F067:** unauthenticated delivery creates a challenge which composes with the
  email-code exchange into session authority. Concrete route: request code ->
  issued challenge -> code exchange (including after key rotation) -> committed
  `email-code` session.

### DELETED

- **F121 and C005:** an all-fields session literal is gone (`E0451`), but public
  `ResolvedAppAuthority::dev_from_auth(AuthInput { user_id: ... })` still creates
  caller-selected dev authority. Concrete route:
  `dev_from_auth("authority-owner")` -> `InvocationGate::prepare_authority` ->
  `LocalSnapback::reserve_ask_spend`; the durable effect committed.
- **F202:** both public `LocalDatabase::auth_rehearsal_mint` and public
  `LocalSnapback::auth_rehearsal_mint` returned real grant IDs with
  `challengeCapture` scope. Rehearsal authority is still minted.
- **F232:** the executed F321 composition used public
  `MembershipWriter::Admin`, planned a privileged membership insert, committed,
  and read back the victim's durable admin membership.
- **ADD-TS-01:** public `seed_grant_revocation_watch_for_test` seeded a
  caller-selected watch; production `active_watches` and `transition_watch`
  consumed it, ending in `dead`. The test-support seam remains reachable.

## Confirmed sampled deletions

- **F094:** the executed alternate composition used database A's raw projection
  source, a public admission controller, database B's binding, and the real
  `AuthCoordinator` consumer. Construction of the replacement
  `PreparedLocalSessionCoordinator` was refused with `E0451` because all carrier
  fields are private.
- **F113:** direct service-witness registration was refused with `E0624`; the
  alternate all-fields `ServiceAuthorityWitness` route was refused with `E0451`.
- **F115:** the terminal factory/interlock spelling and the separate
  service-interlock factory/install composition were each refused with `E0599`.
- **C009:** the historical alternate route cloned a real
  `AuthorizationInvalidationConnection` and tried to install a never-issued
  generation before the live-resume consumer. Mutation was refused with `E0616`
  because `connection_generation` is private.
- **C012:** the attack supplied a caller-authored `AuthorityDescriptor` to the
  current recorded-mutation consumer. It was refused with `E0061`: the consumer
  now requires an opaque `PreparedRecordedMutationAuthority`, not a descriptor
  plus independent authority.

## Could not settle

**F096 is UNDETERMINED.** The external witness obtained a victim-selected
`SessionFence`, cloned it, and dropped the original. Its attempted operative
consumer was refused with:

```text
error[E0599]: no method named `session_terminal_reason` found for struct `Arc<session_projection::SessionFence>` in the current scope
```

That is exterior compiler evidence, not the requested executed runtime proof
against every reachable consumer. Two attempts to obtain runtime evidence were
blocked before the named tests ran:

```text
cargo test -p snapback-engine f091_verified_bound_carrier_refuses_a_cloned_database_graph -- --nocapture
```

This exited 101 while compiling unrelated library tests with 14 missing stale
test-support helpers, including `replace_store_for_test`, `store_for_test`, and
`AdmissionLease::unmanaged`.

```text
cargo test -p snapback-sync session_premark_closes_new_work_then_drains_the_exact_predecessor -- --nocapture
```

This exited 101 with five unrelated stale errors in `auth/invocation.rs`; calls to
`prepare_pending_effect_approval` still supplied strings where the current API
requires `&PendingEffectOwner` (`E0061`/`E0308`). No F096 runtime assertion ran,
so this report does not promote the compile refusal to CONFIRMED.

Two other built-in checks were not used as verdict evidence because their test
targets did not compile:

```text
cargo test -p snapback-kernel protected_accounting_charges_denial_and_exact_replay_is_free -- --nocapture
```

It exited 101 on three unrelated missing `include_str!` demo manifests. The
custom F202 runtime witness did execute successfully, so this did not leave F202
undetermined.

Finally, `node scripts/run-row-attacks.mjs --help` and
`node scripts/check-security-boundaries.mjs --help` do not implement a passive
help mode: they ran their suites and exited nonzero on existing corpus/inventory
disagreements. Their output was excluded from all verdicts above.
