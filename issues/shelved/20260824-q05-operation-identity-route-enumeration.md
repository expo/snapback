# Q05 operation identity: complete route enumeration

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Systems:** Auth, Sync, Kernel
**Date:** 2026-08-24
**Related:** LLP 0303 (revisions f–i),
  `issues/shelved/20260824-q04-membership-writer-route-enumeration.md`,
  `issues/shelved/20260824-q05-database-provenance-confirmed.md`,
  `issues/shelved/20260824-sealed-trait-does-not-seal-its-database-parameter.md`

## Why this exists

Q05 has been beaten by *relocation* three times. Round 2 minted the operation identity at
`AddressAdmission::for_address` and cloned it into each plan, so two mint plans were one operation.
Round 3 fixed that, removed three `commit_*_for_test` functions and every public fn taking a
caller-chosen `&mut LocalDatabase` from the provider — all verified — and a reviewer immediately
walked in through `AuthDatabasePlan::execute`, which is public and needs **no feature flags**.

Each round closed the route the previous finding named and was defeated one indirection away. So a
reviewer was commissioned to enumerate every route at once rather than return a verdict, working
from a dependent crate. The same technique was applied to Q04 and produced a comparable map.

## The class-closing condition

> An operation identity closes this class only when it is **minted once**, is **not `Clone`d into any
> second committable or joinable carrier**, is **unusable with a caller-named database or a second
> provider**, and **cannot be stripped into public catalog fields the kernel will commit without
> it**.

Four conditions, all of which must hold. Rounds 2 and 3 each satisfied one of them.

## How to read the enumeration

Routes are separated into those the reviewer **executed** and those it **could not construct**. That
distinction is load-bearing and has been got wrong repeatedly in this programme — "could not
construct" is not "refuted", and several items in the could-not-construct list remain reachable
behind `test-support`, which is not a safety boundary here.

The compile-fail results are recorded with their exact error codes (`E0277` on the sealed trait,
`E0451`, `E0624`, `E0599`, `E0616`, `E0603`), so a later round can tell whether a refusal it observes
is the same one or a new one.

---

I'll treat this as a completeness enumeration, not a verdict: map every route that can name a database, mint or reuse an operation identity, carry state between verify and effect, or mutate auth off the intended derivation. First I'll load the lane context and inspect commit `ca4389648` against origin/main.The commit message already names the intended pairing; next I’ll map the actual public surface and the sibling-lane enumeration so this list covers the class, not the last instance.I’ll load the Q05 plan, the sibling-lane enumeration that actually closed a class, and the current public auth/storage surfaces before building a dependent crate.I’ll inventory public database handles, identity mint sites, and verify→effect carriers first, then compile each composition in a dependent crate.I’ll pull the remaining public constructors and catalog/coordinator write surfaces so the dependent crate can actually execute each composition.I have the surface map. Next I’ll build a dependent crate and compile/run each composition, including the live/shadow execute split that beat r3.I'll create the dependent crate and a runtime that actually executes every constructible composition, including the live/shadow split.Rewriting the runtime into a complete, compilable enumerator that actually runs each composition.Dependent crate: `tmp-q05-enum` (no `test-support`). Runtime binary compiled and ran. Fail-bins were compiled separately; a compile error is **could not construct**, not a refutation. `LocalSnapback::execute_auth_plan` was **could not construct** here because `snapback-engine` → `ibex-runtime` via `vendor/ibex/Cargo.toml` and this worktree nests the crate at `vendor/ibex/ibex`. Source composition is still listed.

---

## 1. Every way a caller can name the database a mutation executes against

`AuthDatabasePlan` is a **sealed `#[doc(hidden)]` trait**. Sealing blocks implementation (`fail-impl-trait`: `E0277` missing `private::Sealed`). `database_plan::plan` is `pub(crate)` (`fail-auth-database-plan-from-closure`: `E0603`). Neither is a capability boundary: **`fn execute(self, database: &mut LocalDatabase)` is public, no feature flag.** Every factory below is `impl AuthDatabasePlan`, so the execute target is whatever `&mut LocalDatabase` the caller passes.

### 1a. How to obtain a `LocalDatabase` / view

| # | Composition | Executed | Result |
|---|---|---|---|
| D1 | `LocalDatabase::memory()` | yes | constructed |
| D2 | `LocalDatabase::open(path)` | yes | constructed, `activate_current_auth_catalog` ok |
| D3 | `ServingDatabase::adopt(db).auth_database_mut()` | yes | named `&mut LocalDatabase` (`#[doc(hidden)]`, public) |
| D4 | `ServingDatabase::auth_catalog()` | yes | `AuthCatalogKernel` on serving owner |
| D5 | `LocalDatabase::auth_catalog()` / `auth_catalog_read()` | yes | both kernels constructed |
| D6 | `DetachedReadSnapshot::as_database()` | yes | `&LocalDatabase` (read snapshot; not adoptable) |
| D7 | Extract `LocalSnapback.db` | **could not construct** | field private; only `execute_auth_plan` / `execute_auth_gc_plan` name it |
| D8 | `LocalDatabase.conn` / rusqlite handle | **could not construct** | `conn` private; no public accessor. `snapback-services` re-exports `rusqlite` (known boundary bin); that is a raw SQL path, not `LocalDatabase` |

`snapback_kernel::storage` is a **public module**. `pub mod auth_catalog_ops` and `pub use auth_catalog_ops::AuthCatalogKernel` make submodule types public. `snapback-auth` has `pub(crate) use snapback_kernel::storage`, so **auth-only dependents cannot name `LocalDatabase`**, but any crate that also depends on kernel (or uses engine’s `execute_auth_plan`) can. Module-private is not privacy.

### 1b. The two execute sinks

| # | Composition | Executed | Result |
|---|---|---|---|
| E1 | `plan.execute(&mut caller_db)` | yes | guest plan `Ok(Planned(_))` on caller memory db |
| E2 | `LocalSnapback::execute_auth_plan(plan)` → `plan.execute(self.db.auth_database_mut())` | **could not construct** (ibex path) | source: engine-owned db only |
| E3 | `LocalSnapback::execute_auth_gc_plan` | **could not construct** (ibex path) | source: same db, then push idle retirement |
| E4 | `AuthMaintenanceGuard::gc_plan(now).execute(&mut caller_db)` | yes | `Ok(AuthGcPass { … zeros … })` |

### 1c. Plan factories (all `execute(&mut LocalDatabase)`)

**`AuthAdmission` (from `AuthProvider::admit`):**

| Factory | Executed | Result |
|---|---|---|
| `plan_guest_session_plan` | yes | `Ok(Planned)` |
| `commit_guest_issuance_plan` | yes | `BoundIssuanceAttempt`; join `Ok(Committed(Committed))` on **shadow** |
| `plan_logout_plan` | yes | `Err(SNAPBACK_AUTH_REQUIRED)` (invalid bearer) |
| `plan_refresh_plan` | yes | `Err(SNAPBACK_AUTH_REQUIRED)` |
| `plan_family_alarm_plan` | yes | `Ok(dummy plan, actionable=false)` |
| `resolve_session_plan` | yes | `Err(SNAPBACK_AUTH_REQUIRED)` |
| `record_authenticated_use_plan` (consumes `self`) | yes | `Ok(NotLive)` — caller-chosen `session_id` |
| `step_up_address_plan` | yes | `Err(SNAPBACK_AUTH_REQUIRED)` |
| `step_up_coordination_plan` | yes | `Err(SNAPBACK_AUTH_REQUEST_INVALID)` |
| `exchange_coordination_plan` | yes | `Err(SNAPBACK_AUTH_REQUEST_INVALID)` |
| `exchange_unknown_plan` | yes | `Err(SNAPBACK_AUTH_REQUEST_INVALID)` |
| `prepare_guest_claim_password_plan` | **could not construct args** | needs a real `SessionBearer` |
| `prepare_password_change_plan` | **could not construct args** | same |
| `plan_password_recovery_rotate_plan` | **could not construct args** | same |
| `commit_password_issuance_plan` | not separately driven | same `execute` + `BoundIssuanceAttempt::new(plan.operation_id.clone(), …)` shape as guest commit |
| `commit_password_change_plan` | not separately driven | same shape → `BoundPasswordChangeAttempt` |
| `commit_planned_rotation_plan` | not separately driven | same shape → `BoundRotationAttempt` |
| `commit_planned_revocation_plan` | not separately driven | same shape → `BoundRevocationAttempt` |
| `commit_planned_family_alarm_plan` | not separately driven | same shape → `BoundFamilyAlarmAttempt` |

**`AddressAdmission` (`admit_email` / `for_address`):**

| Factory | Executed | Result |
|---|---|---|
| `plan_mint_session_plan` | yes | `Ok(ProviderSessionIssuancePlan)` |
| `request_code_plan` | yes | `Ok(RequestCodeResponse)` — **durable challenge insert** |
| `prepare_password_registration_plan` | yes | `Ok(PasswordRegistrationPreparation)` |
| `prepare_password_authentication_plan` | yes | `Ok(PasswordAuthenticationPreparation)` |
| `request_step_up_plan` | yes | `Err(SNAPBACK_AUTH_REQUIRED)` |
| `plan_password_recovery_consume_plan` | yes | `Err(SNAPBACK_AUTH_PROVIDER_UNAVAILABLE)` |
| `request_code_for_rehearsal_window_plan` | **could not construct args** | needs `AuthRehearsalWindowV1` |
| `prepare_guest_claim_password_plan` / `prepare_password_change_plan` | **could not construct args** | need acting bearer |

**`PlannedIssuanceAdmission`:** `for_planned_issuance(commit_plan)` then `commit_plan().execute(db)` — **yes**. Same-provider: `Ok`. Second provider: `Err(INTERNAL_AUTH_STATE)` (`Arc::ptr_eq` on `provider_identity`). Then **same admission’s `commit_plan().execute(&mut shadow)`** → join original mint plan `Ok(Committed(Committed))`.

**`ExchangeAdmission` (`for_exchange`):** `plan_exchange_plan`, `prepare_password_reset_plan`, `commit_planned_issuance_plan` (**clones `plan.operation_id`, no provider ptr_eq**), `commit_planned_rejection_plan`. **could not construct** a live `ExchangeCoordination` (invalid challenge). Same execute class as guest commit.

**`StepUpProofAdmission`:** `prepare_password_set_plan`. **could not construct** (needs verified step-up).

**Other plans:** `backup::create_backup_plan.execute` — yes, `Err(SNAPBACK_AUTH_BACKUP_INVALID)` in-memory. `lifecycle::apply_declared_restore_plan.execute` — yes, `Err` (bad declaration id). `hosted_edge::install_verified_admission_plan` / `renew_hosted_admission_plan` — **could not construct** `VerifiedHostedAdmission`; `execute` would still take any `&mut LocalDatabase`.

### 1d. Direct public fns taking `&mut LocalDatabase` / `&LocalDatabase` (no plan)

These are a **second naming surface**. The plan factories only wrap them.

**Executed:** `AuthProvider::plan_guest_session(&mut db)`, `AddressAdmission::plan_mint_session(&db)`, `request_code(&mut db)`, `AuthAdmission::plan_logout/refresh/family_alarm/resolve_session(&db)`, `record_authenticated_use(&mut db, session_id, …)`, `lifecycle::activate_catalog(&mut db, …)`, `backup::create_backup(&db, …)`, `LocalDatabase::auth_gc`, `advance_auth_session_clock_floor`, `activate_current_auth_catalog`.

**Present, same shape, not fully driven** (need live bearer / code / export): `prepare_password_*`, `plan_password_*`, `finish_password_*` (finish itself is CPU/KDF; commit still goes through a plan), `prepare_guest_claim_password`, `plan_exchange`, `commit_planned_rejection`, `exchange_unknown`, `run_gc_pass` (via guard).

**`cfg(test)` / `test-support` only** (`fail-mint-session`: `E0599` no `mint_session`): `AddressAdmission::mint_session`, `AuthAdmission::refresh/logout/family_alarm`. **could not construct** on the production dependent surface.

---

## 2. Every way to obtain an operation identity, or two equal ones

Mint site: **only** `AuthProvider::mint_session_operation_id` (private). Fresh `Arc::new(())` plus clone of provider `Arc<()>`. Equality is `Arc::ptr_eq` on the **operation** arc, not the provider arc. Direct call **could not construct**. Field read **could not construct** (`fail-operation-id-field`: `E0616`).

Mint is invoked from (source; several ran):

- `AddressAdmission::plan_mint_session` — **yes**, per call
- `AuthAdmission::plan_logout` / `plan_refresh` / `plan_family_alarm` — **yes** (family alarm always mints, even dummy)
- `prepare_password_change` **and** `finish_password_change` (finish **mints again** and `bind_revocations_to_operation` reclones that id onto composite revocations)
- `prepare_guest_claim_password` **and** `finish_guest_claim_password` (same remint/rebind)
- guest / exchange / recovery / password registration planning (source; guest planning ran)

### Two equal identities (clones of one mint)

| Composition | Executed | Result |
|---|---|---|
| `plan.commit_plan()` twice, then `BoundIssuanceAttempt::rolled_back(commit).join(plan)` | yes | **`Ok(RolledBack)`** — same identity |
| `ProviderGuestSessionIssuancePlan::commit_plan()` twice | yes | two commit plans from one mint |
| `ProviderFamilyAlarmPlan` `Clone` | yes | two planning calls + `Clone` of first |
| `ProviderRevocationPlan` `Clone` (trait) | yes | type is `Clone`; invalid bearer did not produce `Revoke` |
| `BoundIssuanceAttempt::rolled_back(&commit_plan, err)` | yes | public ctor **clones plan identity with no database** |
| `BoundIssuanceAttempt::rolled_back_for_plan` / `rolled_back_for_guest` | yes | same |
| Commit factories `Bound*Attempt::new(plan.operation_id.clone(), raw(db))` | yes (guest + capture) | identity comes from the **plan**, not the db or executing provider |

`AuthSessionOperationId` itself is `#[derive(Clone)]`. Commit plans that carry it are `Clone`: `ProviderSessionIssuanceCommitPlan`, `ProviderGuestSessionIssuanceCommitPlan`, `ProviderTokenRotationCommitPlan`, `ProviderPasswordChangeCommitPlan`, `ProviderRevocationPlan`, `ProviderCompositeRevocationPlan`, `ProviderFamilyAlarmPlan`.

### Two **unequal** identities (re-run the producer)

| Composition | Executed | Result |
|---|---|---|
| Two `plan_mint_session` on **one** `AddressAdmission`; `plan_b` attempt `.join(plan_a)` | yes | **`Err(INTERNAL_AUTH_STATE)`** (r3: mint is per call, not per admission) |
| `rolled_back_for_plan(plan_b).join(plan_a)` | yes | **`Err(INTERNAL_AUTH_STATE)`** |
| Two `plan_family_alarm` | yes | two plans constructed (distinct mints; join not cross-checked) |
| Two `plan_logout` (invalid bearer) | yes | both `AUTH_REQUIRED` — no plan to compare |

### Identity without cloning the mint plan

| Composition | Executed | Result |
|---|---|---|
| Second `AuthProvider`, `commit_guest_issuance_plan(&commit).execute(&mut shadow)`, `plan.join_bound_attempt` | yes | **`join=Ok(Committed(Committed))`**. Guest commit does **not** ptr_eq providers. `for_planned_issuance` **does**. |
| Same, plus premark live + finish live | yes | **`finish=Ok(Committed { issue: CredentialIssue { session: ses_… } })`**. Projection finalized; plaintext released. |

`mint_session_operation_id` is not re-run by `commit_plan()`; commit **clones**. Re-running **planning** mints a second id. Both are live.

---

## 3. Every carrier between verification and effect

Consumers take **by value** unless noted. `join` / `finish_*` / `into_issue` consume.

| Carrier | Clone | By value / ref | Mutate after ctor | Transform keeping carrier | Extract reusable inner |
|---|---|---|---|---|---|
| `ProviderSessionIssuancePlan` | **no** | `premark_issuance` by value; `join(&plan)` by ref | **`bind_rehearsal_provenance`, `bind_rehearsal_effect`, `bind_sender_issuance` (`&mut self`)** — args **could not construct**; methods exist and keep the same `operation_id` | `commit_plan()` clones id into a new commit carrier | `projected_insert()` **yes** (`ProjectedSessionInsert`, `Clone`, **public fields**); `planned_identity()` clones; `revocations()` by ref; `catalog_plan` on the commit plan |
| `ProviderSessionIssuanceCommitPlan` | **yes** | `for_planned_issuance` by value; commit factories by ref | no `set_`/`with_` | `catalog_plan()` → `CatalogSessionIssuancePlan` **without `operation_id`** | public `catalog_plan` fields |
| `ProviderGuestSessionIssuancePlan` | **no** | `premark_guest_issuance` by value | none public | `commit_plan()` clones inner issuance id | `projected_insert`, `revocations`, `join_bound_attempt` |
| `ProviderGuestSessionIssuanceCommitPlan` | **yes** | commit factory by ref | no | no public `catalog_plan` | inner issuance commit (private) |
| `ProviderTokenRotationPlan` | **no** | `premark_rotation` by value | no | `commit_plan()` clones id | `into_issue(MatchedRotationCommit)` by value |
| `ProviderTokenRotationCommitPlan` | **yes** | commit factory by ref | no | `catalog_plan()` strips id | public catalog fields |
| `ProviderRevocationPlan` | **yes** | `premark_revocation` by value | no | `catalog_plan()` strips id | public catalog fields |
| `ProviderCompositeRevocationPlan` | **yes** | not accepted by standalone revocation commit | `bind_revocations_to_operation` overwrites id | `catalog_plan` private | session_id/generation/reason accessors |
| `ProviderFamilyAlarmPlan` | **yes** | `premark_family_alarm` by value | no | **`revocation_plan()` clones id into a composite** | `catalog_plan()` strips id |
| `ProviderPasswordChangePlan` | **no** | `premark_password_change` by value | no | `commit_plan()` clones id | `rotation()` / `revocations()` by ref; `into_issue` |
| `ProviderPasswordChangeRotation` | **no** | not accepted by rotation commit | no | **no `commit_plan`** (compile-fail in-tree) | accessors only |
| `ProviderPasswordChangeCommitPlan` | **yes** | commit factory by ref | no | `catalog_plan()` strips id | public catalog fields |
| `BoundIssuanceAttempt` (and Rotation/Revocation/PasswordChange/FamilyAlarm) | **no** | `join(self, &plan)` / `finish_*(carrier, attempt)` by value | no | no | **no `into_inner`**. `new` is **private** (`fail-bound-new`: `E0624`). Public: `rolled_back*` |
| `PremarkedIssuance` / Guest / Rotation / Revocation / FamilyAlarm / PasswordChange | **no** | `finish_*` consumes | no | no | `plan()` by ref |
| `PlannedIssuanceAdmission` | **no** | `commit_plan()` borrows | no | `rolled_back(error)` mint Bound attempt | owned commit plan inside |
| `MatchedIssuanceCommit` etc. | **no** | `into_issue` by value | no | no | `session()`, `committed_revocations()`; `MatchedRevocationCommit::into_revocation`. Struct fields **private** (`fail-matched-commit`: `E0451`) |
| `CredentialIssue` | — | finish payload | `with_recovery_codes` is `pub(crate)` | no | **`into_parts` → `(CredentialResponse, Option<SessionRevocation>)`** |
| `AuthFinish<T>` | — | by value | no | no | **`into_parts` → `(SnapbackResult<T>, Vec<CommittedRevocationTarget>)`** |
| `CommittedAuthOutcome` | **yes** (shared mutex) | `try_publish` by value | no | **`try_publish<T>(FnOnce() -> T)`** | one-shot take |
| `ExchangeCoordination` | **yes** | `for_exchange` by value | no | no | `reacquisition_key()` |
| `PasswordChangePreparation` | — | `finish_password_change` by value | no | no | `revocations` **public only under test-support** |
| `Catalog*Plan` | N/A (borrowed structs) | kernel `attempt_*` by ref | **all fields `pub`** | reconstruct a new plan from extracted fields | **this is the extract-and-replay seam** |
| `ProjectedSessionInsert` | **yes** | premark uses a clone | **all fields `pub`** | caller can edit a copy | extracted from mint plan |
| `ExactCommitRows<I,T>` | — | `into_value_for` by value | no | **`map(FnOnce(T)->U)` keeps binding+identity** | ctor `pub(crate)` — **could not construct** a value; method exists |

`AuthCoordinator::new` is `pub(crate)` without `test-support` (`fail-coordinator-new`: `E0624`). `from_admitted_snapshot` **is public** and **ran**.

No `set_*` / `replace_*` / `advance_*` on Q05 session plans. Post-mint mutation is the three `bind_*` methods on issuance.

---

## 4. Every generic or callback that hands raw fields to caller code

| Seam | Executed | Result |
|---|---|---|
| `AuthDatabasePlan::execute<P>` | yes | any plan, caller-named db |
| `LocalSnapback::execute_auth_plan<P>` | **could not construct** here; source confirmed | engine db |
| `CommittedAuthOutcome::try_publish<T>(FnOnce() -> T)` | source; not driven to publish | arbitrary `T` after finalize |
| `AuthFinish<T>::into_parts` | yes | outcome + revocation targets |
| `CredentialIssue::into_parts` | source (issued in finish) | raw `CredentialResponse` + optional `SessionRevocation` |
| `ExactCommitRows::map` | **could not construct** the carrier | would keep operation identity, swap `T` |
| `catalog_plan()` → public-field `Catalog*Plan` | yes (`ProviderFamilyAlarmPlan::catalog_plan`; issuance commit `catalog_plan` is public) | **identity stripped** |
| Hand-built `CatalogSessionIssuancePlan { public fields… }` + `AuthCatalogKernel::attempt_planned_session_issuance` | yes | **`attempt=Committed`, `optional=true`** |
| Hand-built `CatalogRotationPlan` + `attempt_planned_rotation` | yes | `Committed` |
| Hand-built `CatalogRevocationPlan` + `attempt_planned_revocation` | yes | `Committed` |
| Hand-built `CatalogFamilyAlarmPlan` + `attempt_planned_family_alarm` | yes | `Committed` |
| Private `CoordinatedIssuancePlan` generic on `premark_issuance_inner` / `finish_issuance_inner` | yes (guest premark/finish) | `projected_insert` / `revocations` / `join_attempt` / `into_issue` |
| `StepUpBinding::{grant_approval, agent_invitation, password_set, effect_approval}` | yes (`grant_approval` / `password_set` used) | **caller-chosen user/session/generation/authority/target** into a later plan |

This is the sibling-lane “delete the type, keep the generic” class: `catalog_plan` plus `AuthCatalogKernel::attempt_*` pass the four-plus fields out and accept an arbitrary reconstructed `Catalog*Plan`. Kernel commit **does not see `AuthSessionOperationId`**.

---

## 5. Every path to a durable auth mutation that does not go through the intended derivation

Intended derivation: **one mint** → premark that plan on the coordinator bound to **that** db’s projection → commit plan **derived from that plan** → `execute` on **the same** database → `Bound*Attempt` joined to **that** plan → finalize/plaintext.

Paths that do **not** do that:

| Path | Executed | Result |
|---|---|---|
| Plan on live, premark live, `commit_*_plan.execute(&mut shadow)`, finish live | **yes** (guest) | **`finish=Ok(Committed { issue, session id, … })`**. Join checks plan id, not which db was written. |
| Plan on live, `for_planned_issuance` (same provider), `commit_plan().execute(&mut shadow)`, `attempt.join(&plan)` | **yes** (capture mint) | **`Ok(Committed(Committed))`** |
| Second provider `commit_guest_issuance_plan(&commit).execute(&mut shadow)` then join original | **yes** | **`Ok(Committed(Committed))`**. Only `for_planned_issuance` ptr_eq’s provider. |
| `AuthCatalogKernel::attempt_planned_{session_issuance,rotation,revocation,family_alarm}` with hand-built `Catalog*Plan` | **yes** | **`Committed`** — no operation identity at all |
| `AddressAdmission::request_code` / `request_code_plan.execute` | **yes** | durable challenge row; **no operation identity** |
| `record_authenticated_use` / `_plan` with caller `session_id` | **yes** | `NotLive` here; would extend a live row with **no operation identity** |
| `LocalDatabase::auth_gc` / `gc_plan.execute` | **yes** | GC writes; **no operation identity** |
| `activate_current_auth_catalog` / `lifecycle::activate_catalog` | **yes** | catalog create/ready |
| `advance_auth_session_clock_floor` | **yes** | durable floor |
| `apply_auth_restore_declaration` / restore plan | **yes** (refused: bad id) | would revoke sessions off the Q05 join |
| `backup::create_backup` | **yes** (refused: in-memory) | read-side export |
| Direct `AuthProvider::plan_*` / `commit_*_raw` via public methods taking `&mut LocalDatabase` | **yes** where driven | same as 1d — db is caller-named |
| `LocalDatabase::auth_logical_import` | **could not construct** payload | public write of logical auth state |
| `LocalSnapback::auth_rehearsal_mint/revoke/resolve` | **could not construct** (engine + plan type) | public |
| `hosted_edge::install_verified_admission` | **could not construct** verified envelope | public `&mut LocalDatabase` |
| `insert_*_for_test` / `mint_session` / `refresh`/`logout`/`family_alarm` one-shot | **could not construct** without `test-support` | still exist behind that feature |

`Bound*Attempt::new` is private. `rolled_back*` is not a durable write, but it **is** a joinable attempt with a cloned identity.

---

Compile-fail (dependent crate, **could not construct**): implement `AuthDatabasePlan` (`E0277` Sealed); `MatchedIssuanceCommit { … }` (`E0451`); `BoundIssuanceAttempt::new` (`E0624`); `AddressAdmission::mint_session` (`E0599`); `AuthCoordinator::new` (`E0624`); `commit_plan.operation_id` (`E0616`); `database_plan::plan` (`E0603`).

---

An operation identity closes this class only when it is minted once, is not `Clone`d into any second committable or joinable carrier, is unusable with a caller-named database or a second provider, and cannot be stripped into public catalog fields the kernel will commit without it.
