# The deletion class, fully executed: 23 of 47 are false DELETED

**Status:** open (measurement complete)
**Date:** 2026-08-26
**Systems:** authorization, kernel, engine, server, sync, test-support
**Related:** `issues/20260826-row-acceptance-ledger-62-units-remain.md`,
`issues/20260826-row-acceptance-ledger-execution-report.md`, LLP 0303 revision (s), LLP 0313 §10

Completes the execution of the acceptance ledger's DELETED class. The first pass sampled 10
and found 5 wrong; this pass executed the remaining 37 and found 18 wrong. **Combined: 24
CONFIRMED, 23 WRONG, 0 UNDETERMINED across all 47.** Every error runs the same direction —
*false DELETED*, with a public route still reaching the claimed authority effect. No
opposite-direction error exists.

The two passes ran at different commits (`81d332144` and `17caa3e30`), so the combined tally
is the programme tally rather than a same-commit rerun.

---

Executed all 37 unsampled normalized DELETED units.

## Result

| Population | CONFIRMED | WRONG | UNDETERMINED |
|---|---:|---:|---:|
| This pass: 37 | **19** | **18** | **0** |
| First pass: 10 | **5** | **5** | **0** |
| Combined: 47 | **24** | **23** | **0** |

Thus **23/47 = 48.9%** of the complete deletion class are false DELETED classifications.

All 18 new errors—and all 23 combined errors—have the same direction: **false DELETED; a public route still reaches the claimed authority effect.** No opposite-direction classification error was found.

F001 was more thoroughly closed than its one-line description: besides the private closure factory, external arbitrary plans cannot implement the sealed trait. That strengthens its CONFIRMED verdict; it does not reverse it.

This pass ran at commit `17caa3e30cd60f34588e5c7ce5ea45ff721d606e`. The prior 10-unit report ran at `81d3321449b2af0f1e2f2f11b5bb4c5aa37dd65b`, so the combined tally is the requested programme tally, not a same-commit rerun of the first 10.

Normalization followed the ledger: F002 is the F073 alias, F095 is the already-sampled F094 alias, and the raw SQLite re-export is F313.

## Verdict table

Command IDs expand to exact commands and decisive output below.

| Unit | Claimed disposition | Verdict | Settling command |
|---|---|---:|---|
| F001 | Delete generic closure-to-`LocalDatabase` plan factory | CONFIRMED | E01 |
| F005 | Delete generic `AddressAdmission` authority custody | **WRONG** | E02 |
| F056 | Delete canonical-address admission form | **WRONG** | E02 |
| F068 | Delete rehearsal-window challenge wrapper | **WRONG** | E02 |
| F073 | Delete public authorized-lease minting | **WRONG** | E03 |
| F075 | Delete shape-only invalidation-issuer constructor | CONFIRMED | E04 |
| F081 | Delete ambient issuer signer API | **WRONG** | E05 |
| F084 | Delete obligation registry from caller expectations | CONFIRMED | E04, E06 |
| F089 | Delete feature-public retry-persistence path | **WRONG** | E07 |
| F091 | Delete public from-parts bound-session constructor | **WRONG** | E08 |
| F118 | Delete conversion from `ExactGrantScope` | CONFIRMED | E09 |
| F119 | Delete `ResolvedSession` → app authority | CONFIRMED | E10 |
| F120 | Delete `ResolvedScopedToken` → service authority | CONFIRMED | E11 |
| F122 | Delete claims-plus-authority projection construction | **WRONG** | E12 |
| F126 | Delete deferred rehearsal binding | CONFIRMED | E13 |
| F127 | Delete generic session-publication attachment | **WRONG** | E14 |
| F128 | Delete generic service-publication attachment | CONFIRMED | E15 |
| F133 | Delete raw stream-incarnation setter | CONFIRMED | E16 |
| F143 | Delete generic admission-plus-authority preparation | **WRONG** | E12 |
| F144 | Delete sibling general prepared-authority join | **WRONG** | E12 |
| F149 | Delete descriptor factory accepting independent stream | CONFIRMED | E17 |
| F150 | Delete descriptor construction from caller authority | CONFIRMED | E18 |
| F157 | Delete bearer-free reusable retained-session authority | CONFIRMED | E19 |
| F160 | Delete generally movable session-authority/fence carrier | **WRONG** | E08 |
| F210 | Delete `Anonymous` authority value | **WRONG** | E12 |
| F212 | Delete `AdminBypass` authority value | **WRONG** | E12 |
| F233 | Delete writer-plus-consent conversion | **WRONG** | E20 |
| F302 | Delete generic caller-I/O secret helper | CONFIRMED | E21 |
| F305 | Delete assertion-based hosted-target construction | **WRONG** | E22 |
| C001 | Delete fact-asserting `ResolvedSession` construction | CONFIRMED | E10 |
| C002 | Delete public all-fields `ResolvedScopedToken` | CONFIRMED | E11 |
| C003 | Delete all-fields `ExactGrantScope` in authority role | CONFIRMED | E09 |
| C004 | Delete construction/rebuild of projected session authority | CONFIRMED | E08 |
| C006 | Delete public all-fields service witness | CONFIRMED | E23 |
| C007 | Delete `ResolvedMembershipWriter` assertion enum | **WRONG** | E20 |
| C013 | Delete public selector-bearing authorization preflight | **WRONG** | E24 |
| F313 | Delete raw SQLite re-export | CONFIRMED | E25 |

## Concrete surviving routes

- **F005, F056, F068:** public `admit_email`, `for_address`, ordinary plan, and rehearsal-window plan remain at [provider.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-auth/src/auth/provider.rs:3058), [provider.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-auth/src/auth/provider.rs:4021), [provider.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-auth/src/auth/provider.rs:4409), and [provider.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-auth/src/auth/provider.rs:4417). E02 created three durable challenges, including one under a publicly minted and installed rehearsal window.

- **F073:** public `issue_authorized_lease_at` remains at [provider.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-auth/src/auth/provider.rs:2981). E03 executed the independent-binding mint/reopen/verification test at [provider_tests.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-server/src/auth/provider_tests.rs:702).

- **F081:** both caller-selected signer-root construction and `authenticate` remain public at [invalidation.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-auth/src/auth/invalidation.rs:548) and [invalidation.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-auth/src/auth/invalidation.rs:554). E05 minted and verified an `AuthenticatedBootIssuer` for attacker-selected target/app facts.

- **F089:** caller-owned `RetryEpisodeRegistry::reserve` at [invalidation.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-types/src/auth/invalidation.rs:495) still composes with the feature-public durable sink at [auth_invalidation.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-kernel/src/storage/auth_invalidation.rs:1150). E07 reopened SQLite and found the episode persisted.

- **F091:** `BoundConnectionSessionIdentity::new` remains public at [session_projection.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-sync/src/auth/session_projection.rs:210), and the public raw-tuple resolver remains at [coordinator.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-sync/src/auth/coordinator.rs:1797). E08 independently submitted the same tuple to each cloned database and prepared authority in both.

- **F122:** `HandlerAuthProjection::from_authority` remains public at [invocation.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-sync/src/auth/invocation.rs:1120). E12 projected an authenticated attacker-selected dev user and reserved an effect from the same public authority route.

- **F127:** public `with_fenced_publication` remains at [invocation.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-sync/src/auth/invocation.rs:2305). E14 attached a publication from an independent coordinator and reserved the authority effect.

- **F143, F144:** the feature-public general preparation route at [invocation.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-sync/src/auth/invocation.rs:3369) calls the supposedly deleted general join and returned effect-capable prepared authority in E12.

- **F160:** `PreparedBearerAuthority` remains a public, `Clone` carrier at [coordinator.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-sync/src/auth/coordinator.rs:432), with public preparation at [coordinator.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-sync/src/auth/coordinator.rs:547). E08 cloned it and successfully prepared in its owning graph. The negative control correctly refused carrying it into another graph.

- **F210, F212:** `Anonymous` and `AdminBypass` remain public variants at [invocation.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-sync/src/auth/invocation.rs:328). E12 prepared both; anonymous directly reserved an effect, while admin used the surviving public publication attachment and then reserved one.

- **C007, F233:** the assertion enum and authority-creating conversion remain public at [storage.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-kernel/src/storage.rs:17450) and [storage.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-kernel/src/storage.rs:17474). E20 produced a delegated writer with attacker-selected actor, victim effective user, grant, and authority-creating consent.

- **F305:** assertion-based `HostedServingAuthority::from_authenticated_target` remains public at [deployment.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-auth/src/auth/deployment.rs:440). E22 used it to authorize hosted canonicalization through [deployment.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-auth/src/auth/deployment.rs:747).

- **C013:** `AuthorizationCommitPreflight::AllProtectedRooms` remains publicly constructible at [storage.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-kernel/src/storage.rs:806) and is consumed by public commit reservation at [ephemeral.rs](/Users/ccheever/lanes/ledgerv/crates/snapback-sync/src/ephemeral.rs:3777). E24 created the reservation.

## Exact commands and decisive output

Bootstrap ran before Cargo:

```text
$ scripts/bootstrap-ibex-runtime
[exit 0]
SNAPBACK_IBEX_RUNTIME_LINK_OK
... "ok":true ...
```

All Cargo commands used this lane’s existing `target/`, either by default from the repository root or explicitly with `--target-dir target`.

### E01 — F001

```text
$ set -o pipefail; cargo check --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin arbitrary_auth_plan 2>&1 | tail -25
[exit 101]
error[E0277]: the trait bound `ArbitraryPlan: database_plan::private::Sealed` is not satisfied
```

### E02 — F005, F056, F068

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin address_routes 2>/dev/null
[exit 0]
F005 admit_email=challenge:sbc_QBubQPoem9Pshf7MjUsIKQ F056 canonical_for_address=challenge:sbc_r-Gbw1Gk6tO7f306LvC6Fg F068 rehearsal_window_plan=challenge:sbc_a0yAJAJu4Zx7g3mFkbNXfw
```

### E03 — F073

```text
$ cargo test -q -p snapback-server file_backed_keyring_reopens_and_verifies_an_independently_bound_authorized_lease -- --nocapture 2>/dev/null
[exit 0]
running 1 test
.
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 602 filtered out
```

### E04 — F075

```text
$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/security-boundaries/Cargo.toml --target-dir target --bin forge-live-invalidation-issuer 2>&1 | rg -A18 -B2 'error\[E0624\]|error\[E0061\]'
[exit 101]
error[E0624]: associated function `new` is private
error[E0061]: this function takes 6 arguments but 1 argument was supplied

$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/security-boundaries/Cargo.toml --target-dir target --bin clone-live-invalidation-issuer 2>&1 | tail -22
[exit 101]
error[E0599]: no method named `clone` found for struct `LiveInvalidationIssuer`

$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/security-boundaries/Cargo.toml --target-dir target --bin reuse-live-invalidation-issuer 2>&1 | tail -22
[exit 101]
error[E0382]: use of moved value: `issuer`
```

### E05 — F081

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin ambient_signer 2>/dev/null
[exit 0]
F081 authenticated_boot_issuer=created key_id=attacker-selected-root target=attacker-selected-target app=attacker-selected-app
```

### E06 — F084

```text
$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/security-boundaries/Cargo.toml --target-dir target --bin supply-obligation-authorization 2>&1 | tail -22
[exit 101]
error[E0061]: this method takes 0 arguments but 1 argument was supplied

$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/security-boundaries/Cargo.toml --target-dir target --bin replace-obligation-expectation 2>&1 | tail -22
[exit 101]
error[E0599]: no method named `replace_authenticated_expectation` found for mutable reference `&mut ObligationRegistry`
```

### E07 — F089

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin f089_retry 2>/dev/null
[exit 0]
F089 caller_registry=reserved test_support_sink=persisted reopen_count=1 attempts=1
```

### E08 — F091, F160, C004

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin session_binding 2>/dev/null
[exit 0]
C004 forged_subject=current:false F091 clone_graph_from_parts=prepared F160 cloned_carrier_same_graph=prepared crossed_carrier=refused code=SNAPBACK_AUTH_POLICY_UNAVAILABLE

$ set -o pipefail; cargo check --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin projected_authority_literal 2>&1 | tail -18
[exit 101]
error[E0451]: fields `session_id`, `user_id`, `provider`, `generation`, `authority_instance_id`, `expires_at_ms`, `absolute_expires_at_ms` and `rehearsal_provenance` of struct `ProjectedSessionAuthority` are private
```

### E09 — F118, C003

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin grant_scope 2>/dev/null
[exit 0]
C003/F118 resolved_scope=constructed function=attacker-selected:function basis=9001 authority_creating=true

$ set -o pipefail; cargo check --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin grant_scope_to_service 2>&1 | tail -18
[exit 101]
error[E0451]: fields ... of struct `ResolvedServicePrincipalAuthority` are private
```

The constructible scope could not reach the service-authority consumer.

### E10 — F119, C001

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin resolved_session_dto 2>/dev/null
[exit 0]
C001 dto_constructed=true session=attacker-selected-session user=victim-selected-user generation=77

$ set -o pipefail; cargo check --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin session_from_parts 2>&1 | tail -18
[exit 101]
error[E0599]: no variant, associated function, or constant named `from_session` found for enum `ResolvedAppAuthority`

$ set -o pipefail; cargo check --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin session_enum_literal 2>&1 | tail -18
[exit 101]
error[E0451]: fields ... of struct `ResolvedSessionAuthority` are private
```

### E11 — F120, C002

```text
$ set -o pipefail; cargo check --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin token_literal 2>&1 | tail -18
[exit 101]
error[E0451]: fields ... of struct `ResolvedScopedToken` are private

$ set -o pipefail; cargo check --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin token_to_authority 2>&1 | tail -18
[exit 101]
error[E0624]: associated function `from_scoped_token` is private
```

### E12 — F122, F143, F144, F210, F212

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin authority_routes 2>/dev/null
[exit 0]
F122 projection_user=attacker-selected-dev-user F143/F144 selected_effect=reserved F210 anonymous_effect=reserved F212 admin_bypass_effect=reserved
```

The historical F143 spelling was separately refused with E0624, but the feature-public `InvocationGate::prepare_authority` route above survived and settled the WRONG verdict.

### E13 — F126

```text
$ cargo run --quiet --manifest-path tests/fixtures/row-attacks/Cargo.toml --target-dir target --bin f126-fork 2>/dev/null
$ cargo run --quiet --manifest-path tests/fixtures/row-attacks/Cargo.toml --target-dir target --features additive --bin f126-fork 2>/dev/null
[each exit 0]
SNAPBACK_ROW_ATTACK {"row":"F126","observed":"CLOSED","diagnostic":"forked child reached DatabaseBinding equality and inherited identity was refused"}
```

### E14 — F127

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin f127_cross_publication 2>/dev/null
[exit 0]
F127 authority_subject=independent-authority-subject publication_incarnation=01a03e4a-ed9e-7631-ac86-0238ed59906a cross_graph_effect=reserved
```

### E15 — F128

```text
$ cargo check --manifest-path tests/fixtures/security-boundaries/Cargo.toml --target-dir target --bin substitute-service-publication
[exit 101]
error[E0624]: method `with_service_publication` is private

$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin service_binding 2>/dev/null
[exit 0]
F128 same_database_service_publication=attached foreign_database=refused code=SNAPBACK_AUTH_POLICY_UNAVAILABLE
```

### E16 — F133

```text
$ set -o pipefail; cargo check --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin raw_stream_setter 2>&1 | tail -20
[exit 101]
error[E0599]: no method named `with_authorization_stream_incarnation` found for struct `PreparedAuthority`
```

### E17/E18 — F149, F150

```text
$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/row-attacks/Cargo.toml --target-dir target --features additive --bin f149 2>&1 | tail -16
[exit 101]
error[E0061]: this method takes fewer arguments; expected `PreparedRecordedMutationAuthority`, found `Option<String>`

$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/row-attacks/Cargo.toml --target-dir target --features additive --bin f150 2>&1 | tail -16
[exit 101]
error[E0061]: this method takes fewer arguments; expected `PreparedRecordedMutationAuthority`, found `Option<String>`
```

The same E0061 refusals occurred in the default feature cell.

### E19 — F157

```text
$ cargo run --quiet --manifest-path tests/fixtures/row-attacks/Cargo.toml --target-dir target --bin f157 2>/dev/null
$ cargo run --quiet --manifest-path tests/fixtures/row-attacks/Cargo.toml --target-dir target --features additive --bin f157 2>/dev/null
[each exit 0]
SNAPBACK_ROW_ATTACK {"row":"F157","observed":"CLOSED","diagnostic":"engine B refused engine A's session carrier: SnapbackError { diagnostic: Diagnostic { code: \"SNAPBACK_AUTH_POLICY_UNAVAILABLE\", severity: Error, subsystem: \"auth\", message: \"resolved authority does not match its resolution graph\", details: Object {} }, trusted_permission_denial: false, private_failure: None, captured_read_dependencies: [] }"}
```

### E20 — C007, F233

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin membership_writer 2>/dev/null
[exit 0]
C007/F233 resolved_writer=caller-authored actor=attacker-selected-agent effective=victim-selected-user grant=attacker-selected-grant authority_creating_consent=true
```

### E21 — F302

```text
$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/security-boundaries/Cargo.toml --target-dir target --bin clone-secret-read-operator 2>&1 | tail -22
[exit 101]
error[E0599]: no method named `clone` found for struct `SecretReadOperator`

$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/security-boundaries/Cargo.toml --target-dir target --bin mint-secret-read-lease-from-registry 2>&1 | tail -22
[exit 101]
error[E0624]: method `mint` is private
```

### E22 — F305

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin hosted_authority 2>/dev/null
[exit 0]
F305 hosted_authority=constructed canonical_external_uri=https://attacker-selected.example/authority-effect
```

### E23 — C006

```text
$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/row-attacks/Cargo.toml --target-dir target --features additive --bin c006 2>&1 | tail -16
[exit 101]
error[E0451]: fields ... of struct `ServiceAuthorityWitness` are private

$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/security-boundaries/Cargo.toml --target-dir target --bin register-service-authority-witness 2>&1 | tail -22
[exit 101]
error[E0624]: method `register` is private
```

### E24 — C013

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin c013_preflight 2>/dev/null
[exit 0]
C013 caller_preflight=AllProtectedRooms authority_commit_reservation=created
```

### E25 — F313/raw SQLite re-export

```text
$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/security-boundaries/Cargo.toml --target-dir target --bin services-rusqlite-reexport-default 2>&1 | tail -22
[exit 101]
error[E0433]: cannot find `test_support` in `snapback_services`

$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/row-attacks/Cargo.toml --target-dir target --features kernel-push-fixture --bin f313 2>&1 | tail -20
[exit 101]
error[E0616]: field `connection` of struct `PushAuthorizationTestFixture` is private
```

## Unsettled and infrastructure

No unit is UNDETERMINED.

One attempted in-crate F089 unit-test command exited 101 before the named test because the current engine test library has 14 unrelated stale test-support references. It was not counted; E07’s external public-composition harness settled F089 instead.

The final disk check showed **1.1 TiB available, 69% used**. No isolated target trees were created. Custom witnesses live only under ignored [target/ledger-execution-17caa](/Users/ccheever/lanes/ledgerv/target/ledger-execution-17caa/Cargo.toml), and `git status --short` was empty.