# False-DELETED population: disposition of all 23 WRONG units

**Status:** open (triage complete; no repair performed)

**Date:** 2026-08-26

**Systems:** authorization, kernel, engine, server, sync, test-support

**Related:** `issues/20260826-deletion-class-full-execution-47-units.md`,
`issues/20260826-row-acceptance-ledger-62-units-remain.md`, LLP 0303, LLP 0313

## Result

All 23 prior WRONG units reproduced at
`736217afebca4f2aba9e009b40d44e7d489dae68`. There are **23 settled, 0
UNDETERMINED**. No product code was changed. Every Cargo invocation reused this
lane's repository `target/`; the final disk check had **1.1 TiB available**.

The dominant miss is **NEVER-DELETED: 18/23 (78.3%)**. This is not primarily an
alternate-spelling population. Two units are `ALTERNATE-SPELLING`, two are
`FEATURE-GATED`, and one is `PARTIAL-DELETION`.

Only **2/23 are independent of Landing A: F081 and F305**. They are contained
visibility deletions and are schedulable now. Every other row belongs to the
accepted A -> B -> C -> D sequence or, for F202/F068, also needs the rehearsal
policy contradiction resolved.

## Unit dispositions

`C` means Landing C after A/B; `D` means Landing D after A-C. A row's size is
the size of the work needed to close the capability, not the size of deleting
its named symbol.

| Unit | Executed surviving public route | Miss class | What closing actually requires | Size | Dependency |
|---|---|---|---|---|---|
| F005 | [`AuthProvider::admit_email`](../crates/snapback-auth/src/auth/provider.rs#L3058) -> [`AddressAdmission::request_code_plan`](../crates/snapback-auth/src/auth/provider.rs#L4409) -> durable/public challenge path [`request_code`](../crates/snapback-auth/src/auth/provider.rs#L4582). V01 created a challenge. | `NEVER-DELETED` | **Real fix, not deletion of email challenge.** Replace generic address custody and caller-executable database plans with an exact serving ceremony that accepts an untrusted selector and derives the address/effect under private-core custody. | LARGE — exact address ceremonies span auth, kernel/engine, and server flows and need per-purpose design. | C |
| F056 | [`AuthAdmission::for_address`](../crates/snapback-auth/src/auth/provider.rs#L4021) -> [`request_code_plan`](../crates/snapback-auth/src/auth/provider.rs#L4409) -> [`request_code`](../crates/snapback-auth/src/auth/provider.rs#L4582). V01 created a second challenge from a caller-built canonical address. | `NEVER-DELETED` | **Real fix.** Remove the generic canonical-address entry and route each legitimate caller through the same exact ceremony as F005. | MEDIUM — cross-crate migration, sharing F005's design. | C |
| F068 | Production still selects a rehearsal window and calls [`request_code_for_rehearsal_window_plan`](../crates/snapback-server/src/server.rs#L19090), whose public definition delegates to the durable request-code path at [`provider.rs:4417`](../crates/snapback-auth/src/auth/provider.rs#L4417). V01 minted/installed a public window and created its challenge. | `NEVER-DELETED` | If rehearsal is deleted, this is a **genuine deletion** with F202. If exact non-production rehearsal survives, it is a **real fix**: derive the window and contact inside the exact challenge ceremony. The F202/LLP 0313 contradiction must be ruled first. | LARGE — four-crate rehearsal/address composition plus an unresolved product decision. | C + rehearsal ruling |
| F073 | Raw public [`AuthProvider::issue_authorized_lease_at`](../crates/snapback-auth/src/auth/provider.rs#L2981) minted and verified the independently authored issue in V02. A legitimate route now also exists: exact capture at [`engine.rs:18802`](../crates/snapback-engine/src/local/engine.rs#L18802) -> signing wrapper at [`engine.rs:5216`](../crates/snapback-engine/src/local/engine.rs#L5216) -> HTTP use at [`server.rs:30400`](../crates/snapback-server/src/server.rs#L30400). | `NEVER-DELETED` | **Real fix, not deletion of leases.** Remove the raw signer surface while retaining only the capture-bound, reserve-after-signing ceremony. Doing that across the auth/engine crate boundary without adding another forgeable carrier belongs in the private core. | MEDIUM — cross-crate signing/capture boundary. | C |
| F081 | Public caller-key construction [`IssuerAuthenticator::new`](../crates/snapback-auth/src/auth/invalidation.rs#L548) -> public tuple signing [`authenticate`](../crates/snapback-auth/src/auth/invalidation.rs#L554). V03 minted and verified attacker-selected issuer/target/app facts. | `NEVER-DELETED` | **Genuine deletion.** Make the raw authenticator constructor/signing API crate-private and keep the exact reserved-boot provider ceremony at [`provider.rs:2939`](../crates/snapback-auth/src/auth/provider.rs#L2939). | SMALL — contained in `snapback-auth`; external tests migrate to the exact provider path. | Independent |
| F089 | Public [`RetryEpisodeRegistry::reserve`](../crates/snapback-types/src/auth/invalidation.rs#L495) -> feature-public durable bulk sink [`seed_invalidation_retry_episodes_for_test`](../crates/snapback-kernel/src/storage/auth_invalidation.rs#L1150). V04 reopened SQLite with one persisted attacker-authored episode. | `FEATURE-GATED` | **Genuine deletion.** Remove the helper from the enableable feature closure; keep only owning-crate `cfg(test)` setup or production retry ceremonies and migrate engine tests. | MEDIUM — kernel surface plus dependent engine tests. | B |
| F091 | Public raw tuple resolver [`AuthCoordinator::resolve_bound_connection_session`](../crates/snapback-sync/src/auth/coordinator.rs#L1797) constructs public [`BoundConnectionSessionIdentity::new`](../crates/snapback-sync/src/auth/session_projection.rs#L210) and returns a preparable carrier. V05 submitted the copied tuple to a cloned database graph and prepared authority there. | `NEVER-DELETED` | **Real fix.** Replace raw-tuple rehydration with an exact, origin-bound prepared connection operation consumed by the server; privacy alone cannot cross the sync/server boundary. | MEDIUM — sync/engine/server carrier migration. | D |
| F121 | Public caller-selected factory [`ResolvedAppAuthority::dev_from_auth`](../crates/snapback-sync/src/auth/invocation.rs#L761) -> general preparation [`InvocationGate::prepare_authority`](../crates/snapback-sync/src/auth/invocation.rs#L3369) -> effect reservation [`PreparedAuthority::reserve_authorized_effect`](../crates/snapback-sync/src/auth/invocation.rs#L2841); V11 used the result in a durable ask-spend transaction at [`engine.rs:7326`](../crates/snapback-engine/src/local/engine.rs#L7326). | `NEVER-DELETED` | **Real fix.** Delete request-auth-derived impersonation and derive the dev subject from the ruled owner-bound identity, then migrate server, engine, and host-glue consumers to an exact dev operation. | LARGE — wide cross-crate identity-policy migration. | D |
| F122 | Public [`HandlerAuthProjection::from_authority`](../crates/snapback-sync/src/auth/invocation.rs#L1120) accepted the caller-selected dev authority; V06 then prepared it and reserved an effect through [`prepare_authority`](../crates/snapback-sync/src/auth/invocation.rs#L3369) and [`reserve_authorized_effect`](../crates/snapback-sync/src/auth/invocation.rs#L2841). | `NEVER-DELETED` | **Real fix.** Projection must be minted only inside exact prepared-operation construction from the verified subject/claims pair; remove the public projection constructor. | MEDIUM — sync API with engine/runtime consumers. | D |
| F127 | Public publication producer [`prepare_anonymous_publication`](../crates/snapback-sync/src/auth/coordinator.rs#L1705) -> generic attachment [`PreparedAuthority::with_fenced_publication`](../crates/snapback-sync/src/auth/invocation.rs#L2305) -> [`reserve_authorized_effect`](../crates/snapback-sync/src/auth/invocation.rs#L2841). V07 crossed independent coordinator/authority graphs and reserved the effect. | `NEVER-DELETED` | **Real fix.** Delete generic attachment and have exact prepared operations own their final session/service/publication fences, including the HTTP handoff and rollback/ambiguity path. | LARGE — LLP 0313 requires the full publication/fence group to move atomically. | D |
| F143 | The historical [`prepare_admitted_authority`](../crates/snapback-sync/src/auth/invocation.rs#L3409) spelling is now crate-private (N02/N03), but feature-public [`prepare_authority`](../crates/snapback-sync/src/auth/invocation.rs#L3369) performs the same resolved-authority join and V06 reserved an effect. | `ALTERNATE-SPELLING` | **Real fix.** Landing B should delete the feature-public compatibility entry; the row closes only when Landing D removes the generic resolved-authority join in favor of exact operations. | MEDIUM — sync implementation plus cross-crate tests/consumers. | D (B removes the executed alternate) |
| F144 | Same executed alternate as F143: [`prepare_authority`](../crates/snapback-sync/src/auth/invocation.rs#L3369) delegates to the surviving general join at [`invocation.rs:3392`](../crates/snapback-sync/src/auth/invocation.rs#L3392), producing effect-capable `PreparedAuthority` in V06. | `ALTERNATE-SPELLING` | **Real fix.** Remove every general sibling join, not only the old entry name, as exact prepared operations land. | MEDIUM — same cross-crate D workstream as F143. | D (B removes the executed alternate) |
| F160 | Public, `Clone` [`PreparedBearerAuthority`](../crates/snapback-sync/src/auth/coordinator.rs#L431) -> public consuming [`prepare`](../crates/snapback-sync/src/auth/coordinator.rs#L547). V05 cloned the carrier and prepared twice in its owning graph; only cross-graph use was refused. | `NEVER-DELETED` | **Real fix.** Replace the reusable generic carrier and its replayable producer pipeline with a move-only exact prepared operation; deleting `Clone` alone is insufficient under LLP 0303. | MEDIUM — sync/engine/server pipeline. | D |
| F202 | Public durable mint [`LocalDatabase::auth_rehearsal_mint`](../crates/snapback-kernel/src/storage/auth_rehearsal.rs#L165) and public engine wrapper [`LocalSnapback::auth_rehearsal_mint`](../crates/snapback-engine/src/local/engine.rs#L7215); the production host operation calls it at [`server.rs:24424`](../crates/snapback-server/src/server.rs#L24424). V12 minted two real grants. | `NEVER-DELETED` | **Blocked disposition.** LLP 0313 says both “non-production rehearsal survives” and “delete rehearsal outright.” Obtain an owner ruling; then either genuinely delete the 43-file feature or rebuild it as an exact administrator/internal ceremony. | LARGE — broad feature removal/rebuild and a required design ruling. | C + rehearsal ruling |
| F210 | Public [`ResolvedAppAuthority::Anonymous`](../crates/snapback-sync/src/auth/invocation.rs#L328) -> V06 general preparation -> [`reserve_authorized_effect`](../crates/snapback-sync/src/auth/invocation.rs#L2841). A non-feature production producer also remains at [`engine.rs:9573`](../crates/snapback-engine/src/local/engine.rs#L9573). | `NEVER-DELETED` | **Genuine vocabulary deletion plus real migration.** Represent anonymous access as absence of credentials under active purpose policy and migrate all prepared-authority consumers. | LARGE — pervasive engine/sync/server/runtime semantic migration. | D |
| F212 | Public [`ResolvedAppAuthority::AdminBypass`](../crates/snapback-sync/src/auth/invocation.rs#L352) -> V06 preparation/attachment/effect reservation. Production still constructs it in [`prepare_admin_authority`](../crates/snapback-engine/src/local/engine.rs#L9644). | `NEVER-DELETED` | **Genuine vocabulary deletion plus real replacement.** Install the store-bound administrator anchor in C, then move admin/operator effects to exact operations and delete `AdminBypass` in D. | LARGE — durable anchor plus pervasive in-memory consumer migration. | C + D |
| F232 | Public caller-authored [`MembershipWriter::Admin`](../crates/snapback-kernel/src/storage.rs#L17422) -> public privileged planner [`membership_plans.rs:1898`](../crates/snapback-kernel/src/storage/membership_plans.rs#L1898) -> public commit [`membership_plans.rs:1890`](../crates/snapback-kernel/src/storage/membership_plans.rs#L1890). V13 durably inserted and read back the victim's admin row. | `NEVER-DELETED` | **Real fix.** Delete public writer variants while relocating every protected membership writer below the private core and enabling exact authorizer enforcement in the same atomic landing. | LARGE — LLP 0313's required writer/authorizer atomic group. | C |
| F233 | Public caller-authored [`ResolvedMembershipWriter`](../crates/snapback-kernel/src/storage.rs#L17450) -> public consent-bearing conversion [`from_resolved_with_authority_creating`](../crates/snapback-kernel/src/storage.rs#L17474). V08 produced a delegated writer with attacker actor/grant, victim effective user, and authority-creating consent; that writer feeds the public planners/commit above. | `NEVER-DELETED` | **Real fix.** Delete the conversion and derive writer plus consent inside the exact private membership ceremony from verified evidence. | MEDIUM — kernel/sync/runtime changes, sharing F232's atomic group. | C |
| F305 | Public assertion constructor [`HostedServingAuthority::from_authenticated_target`](../crates/snapback-auth/src/auth/deployment.rs#L440) -> authority consumer [`canonical_external_uri`](../crates/snapback-auth/src/auth/deployment.rs#L747). V09 authorized attacker-selected hosted target facts. The authenticated envelope path already exists at [`hosted_edge.rs:714`](../crates/snapback-auth/src/auth/hosted_edge.rs#L714). | `NEVER-DELETED` | **Genuine deletion.** Make the raw constructor crate-private and leave external construction only through verify/install of `VerifiedHostedAdmission`; migrate direct external tests. | SMALL — contained product change in `snapback-auth`. | Independent |
| C005 | N01 confirms the all-fields `ResolvedSessionAuthority` literal is private, but public legacy [`ResolvedAppAuthority`](../crates/snapback-sync/src/auth/invocation.rs#L328) plus [`dev_from_auth`](../crates/snapback-sync/src/auth/invocation.rs#L761) survived. V11 prepared that alternate and used its reservation in the durable ask-spend sink at [`engine.rs:7326`](../crates/snapback-engine/src/local/engine.rs#L7326). | `PARTIAL-DELETION` | **Real fix.** Delete the legacy general authority vocabulary rather than only privatizing session fields, and replace consumers with exact prepared operations. | LARGE — the central D vocabulary/consumer migration. | D |
| C007 | Public assertion enum [`ResolvedMembershipWriter`](../crates/snapback-kernel/src/storage.rs#L17450) -> public conversion [`storage.rs:17474`](../crates/snapback-kernel/src/storage.rs#L17474). V08 constructed the authority-creating delegated writer. | `NEVER-DELETED` | **Genuine deletion plus private derivation.** Remove the public enum and derive a private writer only from verified evidence inside the C membership ceremony. | MEDIUM — kernel/sync/runtime migration, shared with F232/F233. | C |
| C013 | Public selector enum/variant [`AuthorizationCommitPreflight::AllProtectedRooms`](../crates/snapback-kernel/src/storage.rs#L806) -> public reservation [`LocalEphemeralBackend::reserve_authorization_commit`](../crates/snapback-sync/src/ephemeral.rs#L3777) -> selector consumption [`room_authority.rs:725`](../crates/snapback-kernel/src/storage/room_authority.rs#L725). V10 created the reservation. | `NEVER-DELETED` | **Real fix.** Derive the room selector from the exact staged mutation/authority inside the protected commit ceremony; do not accept a caller-authored preflight. | LARGE — kernel/sync/engine/server commit choreography needs exact-operation design. | C |
| ADD-TS-01 | Feature-public durable seed [`seed_grant_revocation_watch_for_test`](../crates/snapback-kernel/src/storage/watches.rs#L1286) -> production reader [`active_watches`](../crates/snapback-kernel/src/storage/watches.rs#L626) -> production mutation [`transition_watch`](../crates/snapback-kernel/src/storage/watches.rs#L1338). V14 seeded and transitioned the caller-selected watch to `dead`. | `FEATURE-GATED` | **Genuine deletion.** Remove the helper from the additive public closure and migrate dependent tests to owning-crate `cfg(test)` or production watch ceremonies. | MEDIUM — kernel surface plus engine tests. | B |

## Cross-cutting findings

### Dominant class

| Miss class | Count | Share |
|---|---:|---:|
| `NEVER-DELETED` | **18** | **78.3%** |
| `ALTERNATE-SPELLING` | 2 | 8.7% |
| `FEATURE-GATED` | 2 | 8.7% |
| `PARTIAL-DELETION` | 1 | 4.3% |
| `OTHER` | 0 | 0% |

The programme does have a reachability-instrument problem, but this population
does **not** say “23 alternate spellings.” Eighteen named surfaces still exist.
The dominant systemic failure is that a final-state disposition was accepted as
a present-state fact without an effect-side execution gate. The spelling-only
failure is narrower: F143/F144, plus the partial C005 closure. The feature-matrix
failure is F089 and ADD-TS-01.

### Independent of Landing A

**2 units:** F081 and F305.

- F081: restrict the raw invalidation signer API to `snapback-auth`; preserve the
  exact reserved-boot provider ceremony.
- F305: restrict the raw hosted-authority assertion constructor to
  `snapback-auth`; preserve the verified-envelope install path.

Everything else is in B/C/D or needs the rehearsal ruling. In particular,
F143/F144 are not counted independent: B can remove the executed compatibility
spelling, but the generic join does not disappear until D.

### Size distribution

| Size | Count | Units |
|---|---:|---|
| SMALL | **2** | F081, F305 |
| MEDIUM | **11** | F056, F073, F089, F091, F122, F143, F144, F160, F233, C007, ADD-TS-01 |
| LARGE | **10** | F005, F068, F121, F127, F202, F210, F212, F232, C005, C013 |

These counts are not 23 additive projects. F005/F056/F068/F202 share the C
address/rehearsal work; F232/F233/C007 share the C writer atomic group; and most
of F091/F121/F122/F127/F143/F144/F160/F210/F212/C005 collapse into the D exact
prepared-operation/vocabulary landing.

### Landing distribution

| Dependency | Count | Units |
|---|---:|---|
| Independent | **2** | F081, F305 |
| B | **2** | F089, ADD-TS-01 |
| C (including ruling-gated rehearsal) | **9** | F005, F056, F068, F073, F202, F232, F233, C007, C013 |
| D | **10** | F091, F121, F122, F127, F143, F144, F160, F210, C005, plus F212 after its C anchor |

F212 is shown under D because D deletes the vocabulary, but it also requires
C's administrator anchor first. Thus the disjoint schedule is Independent 2,
B 2, C 9, D 10 = 23.

## Execution transcript

Bootstrap ran before the first Cargo command. The initial run linked and
qualified the current binary with `SNAPBACK_IBEX_RUNTIME_LINK_OK` and
`"ok":true`. A later exact receipt-reuse run produced:

```text
$ scripts/bootstrap-ibex-runtime
[exit 0]
[snapback-bootstrap] vendored Ibex/Hermes artifacts are already usable
[snapback-bootstrap] reusing exact current-revision runtime readiness receipt; link and qualification are already authoritative
bytes 532,839,128 vs baseline 489,895,784 (+8.77%)
__LINKEDIT 303,104,000 vs baseline 277,856,256 (+9.09%)
strsize 178,679,424 vs baseline 163,725,768 (+9.13%)
[snapback-bootstrap] Ibex runtime bootstrap complete
```

Every settling Cargo command and its exact visible output follows. Commands
using `2>/dev/null` intentionally expose only witness stdout.

### V01 — F005, F056, F068

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin address_routes 2>/dev/null
[exit 0]
F005 admit_email=challenge:sbc_62PERmgl-cTDJDIdUe4f3g F056 canonical_for_address=challenge:sbc_CPfuRy_5NShjElsxEWiJ-Q F068 rehearsal_window_plan=challenge:sbc_XedRkszg_d3dXhReZLIgBA
```

### V02 — F073

```text
$ cargo test -q -p snapback-server file_backed_keyring_reopens_and_verifies_an_independently_bound_authorized_lease -- --nocapture 2>/dev/null
[exit 0]

running 1 test
.
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 602 filtered out; finished in 0.04s


running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

### V03 — F081

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin ambient_signer 2>/dev/null
[exit 0]
F081 authenticated_boot_issuer=created key_id=attacker-selected-root target=attacker-selected-target app=attacker-selected-app
```

### V04 — F089

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin f089_retry 2>/dev/null
[exit 0]
F089 caller_registry=reserved test_support_sink=persisted reopen_count=1 attempts=1
```

### V05 — F091, F160

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin session_binding 2>/dev/null
[exit 0]
C004 forged_subject=current:false F091 clone_graph_from_parts=prepared F160 cloned_carrier_same_graph=prepared crossed_carrier=refused code=SNAPBACK_AUTH_POLICY_UNAVAILABLE
```

### V06 — F122, F143, F144, F210, F212

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin authority_routes 2>/dev/null
[exit 0]
F122 projection_user=attacker-selected-dev-user F143/F144 selected_effect=reserved F210 anonymous_effect=reserved F212 admin_bypass_effect=reserved
```

### V07 — F127

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin f127_cross_publication 2>/dev/null
[exit 0]
F127 authority_subject=independent-authority-subject publication_incarnation=01a03e77-c9d6-7f62-81d5-c3a7354e950a cross_graph_effect=reserved
```

### V08 — C007, F233

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin membership_writer 2>/dev/null
[exit 0]
C007/F233 resolved_writer=caller-authored actor=attacker-selected-agent effective=victim-selected-user grant=attacker-selected-grant authority_creating_consent=true
```

### V09 — F305

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin hosted_authority 2>/dev/null
[exit 0]
F305 hosted_authority=constructed canonical_external_uri=https://attacker-selected.example/authority-effect
```

### V10 — C013

```text
$ cargo run --quiet --manifest-path target/ledger-execution-17caa/Cargo.toml --target-dir target --bin c013_preflight 2>/dev/null
[exit 0]
C013 caller_preflight=AllProtectedRooms authority_commit_reservation=created
```

### V11 — F121, C005

```text
$ cargo run --quiet --manifest-path target/ledger-execution-81d332/Cargo.toml --target-dir target --bin ask 2>/dev/null
[exit 0]
C014/F257/F258 local_ask_rows=3 local_sessions=0 local_users=0 F259/F260 serving_ask_rows=3 serving_sessions=0 serving_users=0 F203/F204 independent_authority=authority-owner billed=independent-billing-victim settled_tokens=7 conclusion=durable_billing_only
```

The witness source constructs `ResolvedAppAuthority::dev_from_auth` at lines
126-129, prepares it at 130-139, reserves the authority effect at 149-151, and
passes that reservation to the durable sink at 152-160.

### V12 — F202

```text
$ cargo run --quiet --manifest-path target/ledger-execution-81d332/Cargo.toml --target-dir target --bin rehearsal 2>/dev/null
[exit 0]
F202 local_grant=01a03e78-146e-7360-b0d2-5134c7bd040e engine_grant=01a03e78-14ab-78a1-869d-debb8e0a5cd6 scope=challengeCapture conclusion=rehearsal_authority_still_minted
```

### V13 — F232

```text
$ cargo run --quiet --manifest-path tests/fixtures/row-attacks/Cargo.toml --target-dir target --bin f321 2>/dev/null
[exit 0]
SNAPBACK_ROW_ATTACK {"row":"F321","observed":"OPEN","diagnostic":"durable row=approles_01m0z7h13tebgbvsepzktd3hk9 principal=victim-principal role=\"admin\""}
```

### V14 — ADD-TS-01

```text
$ cargo run --quiet --manifest-path target/ledger-execution-81d332/Cargo.toml --target-dir target --bin watch 2>/dev/null
[exit 0]
ADD-TS-01 seeded=watch-caller-selected production_consumer=transition_watch final_status=dead conclusion=test_support_seam_still_reachable
```

### N01 — C005 partial-deletion control

```text
$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/row-attacks/Cargo.toml --target-dir target --bin c005 2>&1 | tail -28
[exit 101]
   = note: `#[warn(unreachable_code)]` (part of `#[warn(unused)]`) on by default

error[E0451]: fields `user_id`, `session_id`, `provider`, `generation`, `authority_instance_id`, `session_not_after_ms`, `provider_not_after_ms`, `rehearsal_provenance` and `admission_origin` of struct `ResolvedSessionAuthority` are private
  --> src/attacks/c005.rs:7:9
   |
 6 |     let _ = ResolvedSessionAuthority {
   |             ------------------------ in this type
 7 |         user_id: "victim-user".to_owned(),
   |         ^^^^^^^ private field
 8 |         session_id: "victim-session".to_owned(),
   |         ^^^^^^^^^^ private field
 9 |         provider: "email-code".to_owned(),
   |         ^^^^^^^^ private field
10 |         generation: 1,
   |         ^^^^^^^^^^ private field
11 |         authority_instance_id: "victim-authority".to_owned(),
   |         ^^^^^^^^^^^^^^^^^^^^^ private field
12 |         session_not_after_ms: u64::MAX,
   |         ^^^^^^^^^^^^^^^^^^^^ private field
13 |         provider_not_after_ms: None,
   |         ^^^^^^^^^^^^^^^^^^^^^ private field
14 |         rehearsal_provenance: None,
   |         ^^^^^^^^^^^^^^^^^^^^ private field
15 |         admission_origin: panic!("compile-only forged admission origin"),
   |         ^^^^^^^^^^^^^^^^ private field

For more information about this error, try `rustc --explain E0451`.
error: could not compile `snapback-row-attack-fixtures` (bin "c005") due to 1 previous error; 1 warning emitted
```

### N02/N03 — F143 historical-spelling controls

```text
$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/row-attacks/Cargo.toml --target-dir target --bin f143 2>&1 | tail -28
[exit 101]
55 | fn unsupported_capability_error(capability: &str, message: impl Into<String>) -> SnapbackError {
   |    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^

warning: function `vector_manifest_invalid` is never used
  --> /Users/ccheever/lanes/ledgerv/crates/snapback-engine/src/manifest.rs:59:4
   |
59 | fn vector_manifest_invalid(message: impl Into<String>) -> SnapbackError {
   |    ^^^^^^^^^^^^^^^^^^^^^^^

error[E0624]: associated function `prepare_admitted_authority` is private
    --> src/attacks/f143.rs:10:29
     |
  10 |       let _ = InvocationGate::prepare_admitted_authority(
     |                               ^^^^^^^^^^^^^^^^^^^^^^^^^^ private associated function
     |
    ::: /Users/ccheever/lanes/ledgerv/crates/snapback-sync/src/auth/invocation.rs:3409:5
     |
3409 | /     pub(crate) fn prepare_admitted_authority(
3410 | |         source: InvocationSource,
3411 | |         active_mode: AuthMode,
3412 | |         profile: ServerProfile,
...    |
3416 | |         session_claims: Option<AuthClaimsProjection>,
3417 | |     ) -> SnapbackResult<PreparedAuthority> {
     | |__________________________________________- private associated function defined here

For more information about this error, try `rustc --explain E0624`.
error: could not compile `snapback-row-attack-fixtures` (bin "f143") due to 1 previous error

$ set -o pipefail; cargo check --quiet --manifest-path tests/fixtures/row-attacks/Cargo.toml --target-dir target --features additive --bin f143 2>&1 | tail -28
[exit 101]
55 | fn unsupported_capability_error(capability: &str, message: impl Into<String>) -> SnapbackError {
   |    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^

warning: function `vector_manifest_invalid` is never used
  --> /Users/ccheever/lanes/ledgerv/crates/snapback-engine/src/manifest.rs:59:4
   |
59 | fn vector_manifest_invalid(message: impl Into<String>) -> SnapbackError {
   |    ^^^^^^^^^^^^^^^^^^^^^^^

error[E0624]: associated function `prepare_admitted_authority` is private
    --> src/attacks/f143.rs:10:29
     |
  10 |       let _ = InvocationGate::prepare_admitted_authority(
     |                               ^^^^^^^^^^^^^^^^^^^^^^^^^^ private associated function
     |
    ::: /Users/ccheever/lanes/ledgerv/crates/snapback-sync/src/auth/invocation.rs:3409:5
     |
3409 | /     pub(crate) fn prepare_admitted_authority(
3410 | |         source: InvocationSource,
3411 | |         active_mode: AuthMode,
3412 | |         profile: ServerProfile,
...    |
3416 | |         session_claims: Option<AuthClaimsProjection>,
3417 | |     ) -> SnapbackResult<PreparedAuthority> {
     | |__________________________________________- private associated function defined here

For more information about this error, try `rustc --explain E0624`.
error: could not compile `snapback-row-attack-fixtures` (bin "f143") due to 1 previous error
```

## Final repository and disk observation

```text
$ git rev-parse HEAD && git status --short && df -h .
736217afebca4f2aba9e009b40d44e7d489dae68
Filesystem      Size    Used   Avail Capacity iused ifree %iused  Mounted on
/dev/disk3s5   3.6Ti   2.5Ti   1.1Ti    71%     29M   12G    0%   /System/Volumes/Data
```

`git status --short` emitted nothing at that observation. The only intended
tracked change after it is this report.
