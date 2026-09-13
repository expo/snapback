# Q04 membership writer: complete route enumeration

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Systems:** Kernel, Sync, Engine, Auth
**Date:** 2026-08-24
**Related:** LLP 0303 (revisions f–i), `issues/shelved/20260824-privilege-surface-scanner-is-the-llp-0303-progress-metric.md`

## Why this exists

Three lanes in this programme were each defeated by the same pattern: the lane closes the named
construction route, a reviewer finds the capability one indirection away, the lane closes that, and
the next review finds the next one. Q05 went through three rounds that way.

So for Q04 — the highest-footprint change in the programme, which moved the privilege-surface
scanner from 105 violations to 44 — a second reviewer was commissioned **not to produce a verdict**
(DO NOT LAND was already established) but to enumerate *every* route at once, so the fix closes the
class rather than the instance.

The reviewer worked from an external dependent crate, which is the threat model that matters here:
171 of 172 known bypass items are reachable from a dependent.

Its conclusion, verbatim:

> Closing the named factory without making `ResolvedAppAuthority` non-constructible,
> non-`Clone`-extractable, and non-re-derivable, and without binding a writer to one
> invocation/database and one commit-time identity, will be beaten by the next route in this list.

The enumeration follows as produced, including which routes were executed and which could not be
constructed. Treat "could not construct" as distinct from "refuted" — that distinction has been got
wrong repeatedly in this programme.

---

I'll treat this as an independent second review: reproduce the known forge, then enumerate every remaining construction, authority, and write path a dependent crate can actually run. First I'll load the review skill and inspect the commit against origin/main.HEAD is the Q04 commit. Next I’ll map every public construction and write path, then reproduce the known forge from a dependent crate.I have the change footprint. Next I’ll read the public types, constructors, and scanner so the dependent crate can try every composition rather than just the known forge.The known factory is public and the writer constructors are `pub(crate)`. I’ll now map authority construction, plan/commit APIs, and re-exports a dependent can actually name.The known factory is public. Next I’ll enumerate constructors, re-exports, clone/transform APIs, and remaining scanner findings so the dependent crate can try every composition.The public factory is one obtain path; I’ll now map every other constructor, re-export, and write sink, then compile them from a dependent crate.I have the factory and plan/commit surfaces. Next I’ll check remaining authority constructors, mutation/extract APIs, scanner leftovers, and a schema that makes a durable insert succeed.I have the public factory and the plan/commit surface. Next I’ll pull schema helpers, remaining scanner findings, and Clone/extract APIs, then build the dependent crate.`MembershipReadsKernel::insert_channel_member` looks like a write that may skip the writer entirely. I’ll inspect that plus the other authority DTOs before compiling the dependent crate.I have the public surfaces. Next I’ll write a dependent crate that compiles and runs every composition, including the ones expected to fail.Scanner is still running. I’ll start the dependent-crate build in parallel and wait on both.Known defect reproduced from a default-feature dependent crate (no `test-support`). Closing `ServicePrincipal` construction alone does not close the class. Every composition below was compiled; runtime ones were executed unless marked **could not construct**.

Assume **DO NOT LAND**. This is the route list, not a verdict.

---

## 0. Known defect (reproduced)

**Composition.** Default-feature dependent of `snapback-kernel`:

```text
ExactGrantScope { fn, kind: Mutation, authority_creating: true }
  → ResolvedGrantScope::from_exact
  → ResolvedAppAuthority::ServicePrincipal { actor, effective, grant, scopes, … }  // public enum
  → membership_writer_for_function("fn:membership-fixture", Mutation)              // storage.rs:17198
  → MembershipPlansKernel::plan_membership_insert
  → commit_membership_plan
```

**Executed.** Durable `event_members` row. Transition log: actor `caller-chosen-actor`, effective `victim-user`, grant `nonexistent-grant`, writer_class `delegated`. Clone of the same writer against a second in-memory database succeeded identically.

That is one instance. The rest of the class:

---

## 1. Every way to obtain a `MembershipWriter`

### 1a. Direct constructors — **could not construct** (compile_fail from dependent)

| Composition | Result |
|---|---|
| `MembershipWriter::user / delegated / autonomous / system / admin_bypass / anonymous / seed / import / admin` | **COMPILE_FAIL** `E0624` associated function is private (`pub(crate)`) |
| `MembershipWriter::Admin` (old enum spelling) | **COMPILE_FAIL** `E0599` no associated item `Admin` |
| `MembershipWriter { kind: … }` | **COMPILE_FAIL** `E0451` field `kind` private; `MembershipWriterKind` private |
| `MembershipWriter::default()` | **COMPILE_FAIL** `E0599` no `Default` |
| `serde_json::from_str::<MembershipWriter>` | **COMPILE_FAIL** `E0277` no `Deserialize` |
| `MembershipWriter::from_resolved_with_authority_creating` | **COMPILE_FAIL** `E0599` item deleted |
| `use …::ResolvedMembershipWriter` | **COMPILE_FAIL** `E0432` type gone |
| `From`/`Into` | **could not construct** — no impl exists |

`test-support` does **not** re-export those `pub(crate)` constructors.

### 1b. Public factory — **executed**, the live obtain class

`ResolvedAppAuthority::membership_writer_for_function` is `pub` on a `pub enum` with `pub` fields. It is the only production obtain path a dependent can name. Every authority variant that returns `Some` is an obtain route:

| Route | Authority | Writer kind | Executed write |
|---|---|---|---|
| R1 | `ServicePrincipal` delegated, matching scope, `authority_creating: true` | Delegated + consent | **durable insert** (known defect) |
| R5 | same, `authority_creating: false` | Delegated, `has_authority_creating_consent()==false` | **durable insert anyway** (kernel plan/commit does not check consent; only `host_glue::ensure_membership_authority_creating` does) |
| R3 | `ServicePrincipal` autonomous (`effective_user_id: None`) | Autonomous | **durable insert**, grant preserved |
| R4 | `ServicePrincipal` unmatched `fn`/`kind` | — | **executed**: returns `None` (no writer) |
| R6 | `Session { user_id, … }` | User / `invocation` | **durable insert** |
| R7 | `RevalidatedPrincipal { user_id, … }` | User | **durable insert** |
| R8 | `DevImpersonation { user_id, … }` | User | **durable insert** |
| R9 | `System` | System | insert refused; **durable sweep delete** succeeded |
| R10 | `AdminBypass` | AdminBypass | insert refused `SNAPBACK_MEMBERSHIP_NO_EFFECTIVE_PRINCIPAL` |
| R11 | `Anonymous` | Anonymous | same refusal |

`function_id` / `FunctionKind` are ignored for every non-service variant (R31: Session + `Query` or `Action` still produced a writer that inserted).

### 1c. Other public factories that feed (1b)

| Route | Composition | Result |
|---|---|---|
| R12 | `ResolvedAppAuthority::from_session(ResolvedSession { pub fields })` | **durable insert** as that `user_id` |
| R13 | `from_scoped_token(ResolvedScopedToken { pub fields, pub scopes: Vec<ExactGrantScope> })` | **durable insert**, delegated provenance from token |
| R14 | `dev_from_auth(&AuthInput { user_id: Some(…) })` | **durable insert** as DevImpersonation |
| R16 | `serde_json` → `ExactGrantScope` → `from_exact` → ServicePrincipal | **durable insert** |
| R17 | `snapback_sync::auth::invocation::ResolvedAppAuthority` (`pub use`) | **same type, durable insert** |
| — | `snapback_activation::storage` and `snapback_server::storage` are `pub use snapback_kernel::storage` | **not compiled as a third crate**; crate-path aliases of the same factory, not a new type |

### 1d. `PreparedInvocation::membership_writer`

Calls the same factory on retained authority.

| Route | Composition | Result |
|---|---|---|
| R18 | `AdmissionController::new` (Dev) → `prepare_admitted_dev_input` → `prepare_function` → `membership_writer()` | **EXECUTED** durable insert as `prepared-dev-user`. Clone of `PreparedInvocation` yielded a second writer that wrote a second DB. `prepared.authority().resolved().clone()` extracted a reusable `ResolvedAppAuthority` that minted yet another writer. |
| R19 | Dev lease + `AuthMode::Sessions` + ServicePrincipal | **could not construct** `PreparedAuthority`: `SNAPBACK_AUTH_POLICY_UNAVAILABLE` |
| R32 | Forged `AuthModeStateRecord { active: Sessions, … }` → `from_mode_state` | **could not construct** controller: `SNAPBACK_AUTH_MODE_STATE_CORRUPT` (sessions monotonic activation evidence) |
| R20 | `PreparedAuthority::inherit_for(NestedMutation)` then `resolved()` + factory | **EXECUTED** durable insert (inner authority cloned onto a new carrier) |

So: a dependent **can** obtain a writer through `PreparedInvocation::membership_writer` for Dev impersonation without `test-support`. A dependent **could not construct** a sessions-mode `PreparedInvocation` carrying a forged ServicePrincipal from this crate. That does **not** bound the kernel factory (R1).

### 1e. `test-support` obtain / write

| Route | Composition | Result |
|---|---|---|
| TS2 | `AdmissionLease::unmanaged` + `InvocationGate::prepare_authority` | **EXECUTED** writer from forged DevImpersonation |
| TS3 | `InvocationGate::prepare_dev_input` | **EXECUTED** writer |
| TS1 | `MembershipReadsKernel::insert_channel_member` (feature-gated) | **EXECUTED** raw SQL `INSERT INTO channel_members` — **no `MembershipWriter` at all** |
| — | `PreparedBearerAuthority::into_parts` is `pub` under `test-support` | **not executed**; extracts `(ResolvedAppAuthority, FencedPublication)` |

### 1f. Readers / `From` / builders that return a writer

None found. `AuthorizedMembershipPlan` stores a writer privately and has **no getter / `into_inner`**. `BufferedMembershipCommand` **consumes** a writer; it does not produce one.

---

## 2. Every `ResolvedAppAuthority` the membership path will accept

`membership_writer_for_function` is exhaustive over the public enum. **ServicePrincipal is not the only forgeable type.**

| Variant | Forgeable from dependent? | Writer | Membership effect |
|---|---|---|---|
| `ServicePrincipal` (delegated) | yes, plus `from_scoped_token` | Delegated | insert (consent ignored on kernel path) |
| `ServicePrincipal` (autonomous) | yes | Autonomous | insert |
| `Session` | yes, plus `from_session` | User | insert |
| `RevalidatedPrincipal` | yes | User | insert |
| `DevImpersonation` | yes, plus `dev_from_auth` | User | insert |
| `System` | yes | System | no insert; **sweepExpired durable delete** |
| `AdminBypass` | yes | AdminBypass | no effective principal → insert refused |
| `Anonymous` | yes | Anonymous | same refusal |

Privileged kinds `Seed` / `Import` / `Admin` are **not** produced by this factory. They remain `pub(crate)`-only. A dependent still gets seed **effects** via `SchemaSeedKernel::seed` (R24), which internally uses `MembershipWriter::seed()`.

`ResolvedGrantScope` fields are private; the public constructor is `from_exact(ExactGrantScope)` and `ExactGrantScope` is fully public + `Deserialize`. Matching scope is required only for ServicePrincipal; unmatched → `None`.

---

## 3. Durable membership writes that do **not** go through `PreparedInvocation::membership_writer`

All of these were reached from a default-feature dependent except TS1.

| Route | Composition | Result |
|---|---|---|
| R1–R8, R12–R17 | `LocalDatabase::membership_plans()` `{plan,commit}_membership_*` with a factory-minted writer | **durable insert** |
| R21 | `ServingDatabase::adopt` → same kernel | **durable insert** |
| R22 | `BufferedMembershipCommand::insert(writer, …)` → `authorize_membership_commands` | **EXECUTED** `authorized_len=1` (plan carrier; commit is a separate sink) |
| R23 | `AuthorizedMembershipPlan::user_transition(writer, plan)` → `BufferedCommitPayload { membership_plans }` → `commit_buffered_writes_idempotent_guarded` | **durable insert** — sanctioned gate, **does not call `commit_membership_plan`** |
| R24 | `schema_seed().seed(SeedData { event_members: […] })` | **durable insert** with no caller-held writer (internal seed writer; no transition log row) |
| R9 | forged `System` writer → `plan_membership_sweep_expired` → commit | **durable delete** (`sweep_changes=1`) after a seeded expired row |
| R27 | plan with writer A, `commit_membership_plan` with writer B | **durable insert**; provenance is **B** (`actor-b` / `grant-b`) |
| R25 | `execute_mutation` HostPlan `Insert` into `event_members` | refused `SNAPBACK_MEMBERSHIP_HOSTPLAN_WRITE_DENIED` |
| R26 | `commit_buffered_writes` raw `BufferedWrite::Insert` | refused `SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED` |
| R29 | `plan_privileged_membership_insert` with a User writer | refused `SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_REQUIRED` |
| TS1 | `insert_channel_member` | **durable raw SQL insert** (`test-support`) |
| `MembershipCommitAuthority::sanctioned` | named from dependent | **COMPILE_FAIL** struct private |
| `LocalDatabase::membership_plans_read` | named from dependent | **COMPILE_FAIL** method private. Type `MembershipPlansReadKernel` is `pub use`d but **could not construct** (`new` is `pub(super)`). Plan methods on it are therefore unreachable from a dependent. |
| `IbexHostContext::new_with_projection` | `pub(crate)` in engine | **could not construct** from this dependent |

`MembershipPlansKernel` plan family is fully public: insert, set_role, remove, remove_principal, transfer_owner, patch, bootstrap, teardown, sweep_expired, privileged insert, plus `authorize_membership_commands` and `commit_membership_plan`. `ServingDatabase::authorize_invocation_membership_commands` is also public.

---

## 4. `Clone` / lifetime / mutate / transform / extract

Executed unless noted.

| Type | `Clone`? | How consumers take it | Mutate after construction | Transform, keep carrier | Extract reusable inner |
|---|---|---|---|---|---|
| `ResolvedAppAuthority` | **yes** | factory takes `&self` | **yes — all variant fields are `pub`**. R15 mutated actor/effective/grant then re-derived a different writer that wrote | `inherit_for` / `ask_query_authority` clone the resolved value onto a new carrier (R20 wrote) | the value **is** the inner |
| `MembershipWriter` | **yes** (R2, R30) | plan/commit take `&`; `BufferedMembershipCommand` / `user_transition` take **by value** | **no** `set_*` / `with_*` / `replace_*` / `advance_*` | **no** `map` / `and_then` / `into_*` | **no** `take_*` / `into_inner` / `into_parts` |
| `MembershipPlan` | **yes** | `commit_membership_plan` takes **by value** | only `skipped_protected()` getter | clone then commit: R28 **second commit refused** `SNAPBACK_MUTATION_CONFLICT` | no |
| `AuthorizedMembershipPlan` | **yes** | `BufferedCommitPayload.membership_plans` by value | no setters | `user_transition(writer, plan)` is a public wrap (R23) | **could not extract** writer/plan (no getters) |
| `PreparedAuthority` | **yes** | `prepare_function` takes by value | `with_fenced_publication` / `with_service_publication` / `with_caller_attribution` keep `resolved` | `inherit_for`, `ask_query_authority` | **`resolved() -> &ResolvedAppAuthority`** then `.clone()` (R18 extracted and wrote) |
| `PreparedInvocation` | **yes** | `membership_writer(&self)` | no | `inherit_authority_for` | `authority().resolved().clone()` |
| `PreparedBearerAuthority` | yes | — | — | — | `into_parts` **pub under `test-support`**, `pub(crate)` otherwise — **not executed** |
| `ExactGrantScope` | yes | `from_exact` by value | **pub fields**, including `authority_creating` | replace in `ServicePrincipal.scopes` | — |
| `ResolvedGrantScope` | yes | stored in authority | fields private; replace via `from_exact` | — | getters only |

Sibling-lane defeat patterns, all live here:

1. **Mutate derived field after construction** — `ResolvedAppAuthority` public fields (R15); `ExactGrantScope.authority_creating` before `from_exact` (R16).
2. **Transform, keep carrier** — `inherit_for` (R20); `PreparedInvocation` clone (R18).
3. **Extract reusable inner** — `PreparedAuthority::resolved().clone()` (R18); `test-support` `into_parts`.

Plus the one that already beat a lane this cycle: **`Clone` the writer and replay on another database** (R2).

`commit_membership_plan` takes writer **by reference, independently of the plan**. R27 planned as A and committed as B; durable provenance followed **B**. That is a fourth sibling pattern: split plan-time vs commit-time writer.

---

## 5. The 44 remaining scanner violations

**None of them is a relocated `MembershipWriter` under a new type name.** The MembershipWriter seed-obtain findings are gone, matching the 105→44 ratchet.

What remains (executed the scanner: 44 violations, 28 feature cells):

- **Whole-module re-exports of `snapback_kernel::storage`**: `snapback_activation::storage`, `snapback_server::storage`. Same `MembershipWriter` / same factory, different crate path.
- **Other privilege seeds**: `PushStorageAuthority`, `AskSpendReservation`, `AuthorizationCommitReservation`, `PromotionContentionReservation`, `ProtectedRecordErasureRequestV1`, `ServiceAuthorityCommitInterlock` / `PreparedServiceAuthorityTerminal`.
- **SQL ingress**: `rusqlite::Connection` / `Transaction` (throttle, push `test_support`); `snapback_services::test_support::rusqlite` re-export.

Those are other F-1 seeds, not a renamed membership writer. The membership bypass class in this commit is **caller-constructible `ResolvedAppAuthority` + public `membership_writer_for_function` + public plan/commit (and `BufferedCommitPayload.membership_plans`)**, which the scanner does not currently treat as a MembershipWriter obtain.

---

## Class to close (not the instance)

A fix that only seals `ServicePrincipal` construction, or only `membership_writer_for_function` for service scopes, or only the detached Boolean, leaves at least:

1. `Session` / `RevalidatedPrincipal` / `DevImpersonation` / `from_session` / `dev_from_auth` → User writer → insert  
2. `from_scoped_token` / serde `ExactGrantScope` → ServicePrincipal again  
3. `authority_creating: false` still inserts on the kernel path  
4. `System` → sweepExpired durable delete  
5. `Clone` writer onto another DB  
6. Mutate public authority fields, re-derive  
7. `PreparedAuthority::resolved().clone()` after a legitimate prepare  
8. `AuthorizedMembershipPlan::user_transition` + `BufferedCommitPayload`  
9. `schema_seed().seed` membership rows (internal seed writer)  
10. plan writer ≠ commit writer  
11. crate-path aliases `snapback_activation::storage` / `snapback_server::storage` / `snapback_sync::auth::invocation`  
12. `test-support` `insert_channel_member` raw SQL  

Closing the named factory without making `ResolvedAppAuthority` non-constructible, non-`Clone`-extractable, and non-re-derivable, and without binding a writer to one invocation/database and one commit-time identity, will be beaten by the next route in this list.
