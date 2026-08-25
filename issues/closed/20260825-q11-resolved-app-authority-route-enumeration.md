# Q11 `ResolvedAppAuthority` derivation and target-engine binding

**Status:** Resolved
**Systems:** Auth, Sync, Engine, Server
**Date:** 2026-08-25
**Rows:** F143, C005
**Ruling:** LLP 0303 — DERIVE

## Closure claim

This closes Q11 for the subject-bearing authority classes by derivation. It
does not claim that every discriminant of the public `ResolvedAppAuthority`
enum is generally unconstructible. `Anonymous`, local-dev impersonation,
operator admin bypass, and system authority remain intentionally selected at
their class-specific composition boundaries. In particular, no Q09
`ResolvedSession` claim is made here.

For session, scoped-service, revalidated-watch, watch-anchor, and asset-callback
subjects, the resolved subject is now a lifetime property:

- callers cannot build or retarget an authority payload from copied identity
  fields;
- extracting or cloning a genuine value preserves its exact process-local
  subject/controller identity;
- the raw `(lease, resolved authority)` preparation join is crate-private;
- public preparation routes either accept a producer-owned opaque carrier or
  reject subject-bearing variants; and
- a genuine prepared grant-management authority is refused when used against
  a second `LocalSnapback` engine graph.

The last check is required even after construction closure. A caller can
legitimately receive a genuine `PreparedAuthority`; possession must not turn
the authority into a bearer accepted by another engine whose durable rows use
the same copied identifiers.

## Producer and reconstruction enumeration (LLP 0303 revision n)

The audit searched definitions, struct and enum literals, constructors,
`From`/`Into`, builders, defaults, serde derives, setters, `&mut` authority
receivers, accessors, `into_parts`, re-exports, type aliases, `#[doc(hidden)]`
items, cfg-gated helpers, retained effects, watches, asset callbacks, and raw
invocation preparation across `crates/`.

### Subject-bearing producers

1. **Session:** `SessionProjection` resolves a presented bearer from its
   protected projection. `AuthCoordinator` is the only caller of
   `ResolvedAppAuthority::from_projected_session`, which is `pub(super)` and
   seals that coordinator's `AdmissionLeaseOrigin`. The final payload literal
   occurs only in the private `resolved_session` constructor.
2. **Scoped service:** `ServingDatabase` produces an opaque
   `ResolvedScopedToken` carrying its private `DatabaseBinding`.
   `ResolvedServiceSubject::from_scoped_token` requires that opaque token and
   an admission origin with the same binding before the private
   `resolved_service_principal` constructor runs.
3. **Retained service effects:** retained facts are re-resolved through the
   protected serving database. They do not reconstruct app authority from the
   durable strings.
4. **Retained live reruns:** `RetainedLiveAuthority` preserves the subject's
   sealed `AdmissionLeaseOrigin`. Its `prepare_rerun` accepts no lease; the
   origin acquires a fresh counted root from its own controller and rejoins it
   only to the same subject identity. Event-producing mutation leases are not
   authority inputs to reruns.
5. **Revalidated watch principal:** the public preparation route accepts an
   opaque kernel `RevalidatedWatchPrincipal`, not user and authority-instance
   strings. The carrier retains the exact serving database's private
   `DatabaseBinding`; the gate refuses an admission origin for any other
   database, then seals that same managed origin into the private payload.
6. **Watch anchor:** the route accepts a protected-catalog
   `WatchAnchorAuthority`, verifies that its database binding matches the
   managed admission origin, and uses the private service constructor.
7. **Asset callbacks:** the route accepts an opaque
   `AssetCallbacksServicePrincipal`, verifies the same exact-database join,
   and uses the private service constructor.

Clean routes as well as closed routes were counted. The only non-test literals
for `ResolvedSessionAuthority`, `ResolvedServicePrincipalAuthority`, and
`ResolvedRevalidatedPrincipalAuthority` are the private constructions listed
above. No serde implementation, `Default`, builder, parts-based public
constructor, `From`/`Into`, or subject/origin setter was found.

### Preparation joins

- `InvocationGate::prepare_admitted_authority` is `pub(crate)`, so a dependent
  cannot independently choose a lease and resolved subject.
- `prepare_admitted_subjectless_authority` is public for the intentional
  anonymous/dev/admin/system classes and explicitly rejects `Session`,
  `ServicePrincipal`, and `RevalidatedPrincipal`.
- Session preparation consumes `PreparedBearerAuthority`; service preparation
  consumes `ResolvedServiceSubject`/`ResolvedServiceAuthority`; revalidated
  and auxiliary routes consume their producer-owned opaque carriers.
- `AdmissionLeaseOrigin::owns` requires pointer identity with the producing
  controller and claims the lease's shared subject slot. A clone of one lease
  cannot be split across separately resolved subjects.
- `AdmissionLeaseOrigin::admit_for_mode` is `#[doc(hidden)]` but was counted as
  public. It has no subject or controller parameter: it can mint a root only
  from the already sealed controller/subject origin. Retained live rerun
  preparation now uses this route and accepts no independent lease.
- Bundle registration and live-unsubscribe continuation use
  `PreparedAuthority::inherit_for` only for enumerated source transitions.
  The method clones the complete prepared carrier and never accepts a resolved
  subject or a lease; the target engine still verifies ownership before bundle
  use.
- `LocalSnapback` rejects foreign admissions at its subjectless, bearer, and
  service preparation boundaries, so a dependent cannot use engine B to
  rederive a value produced under engine A's controller.
- `LocalSnapback::require_agent_grant_management_session` additionally checks
  that the target engine's controller owns the prepared authority's lease.
  This covers OAuth begin/deny/approve/issue, pairing-code mint, grant
  approve/deny, and single/bulk grant-revocation planning and commit.

The public `lease_origin`, `AdmissionLease::origin`, and `#[doc(hidden)]`
routes were treated as public during the audit. An origin has no writable
identity fields, and its clones preserve the same controller, authority, and
database-binding `Arc` identities.

### Clone, extraction, and re-wrapping

`ResolvedAppAuthority`, its opaque payloads, the kernel subject carriers,
`PreparedBearerAuthority`, and `PreparedAuthority` may be cloned or, under
`test-support`, extracted. Those operations move or clone the existing private
`AdmissionLeaseOrigin`, `DatabaseBinding`, and shared lease token; they do not
mint a second subject identity. Getters expose copied facts or an opaque
identity binding only. Re-wrapping an opaque enum payload preserves the same
origin. No setter can replace user, session, actor, effective user, grant,
token, authority instance, database binding, or origin after derivation.
The two added source continuations (`HttpQuery` to bundled
`LiveInitialQuery`, and `LiveInitialQuery` to `LiveUnsubscribe`) preserve that
same carrier; source classification changes, but the subject, projection,
publication fences, admission token, and origin do not.

### Intentional non-claims

- `Anonymous` and `System` are subjectless unit variants.
- `DevImpersonation` is caller-selected only in local dev mode and remains
  fenced by the target engine's managed lease at engine composition.
- `AdminBypass` is selected by the operator composition path.

These classes were enumerated; they are why the row claim is derivation for
the subject-bearing authority classes, not general enum unconstructibility.

## Additive feature enumeration (LLP 0303 revision o)

Cargo features are additive and graph-unified, so the audit did not treat a
default build as sufficient. The relevant declared sets are:

- `snapback-auth`: empty default; `test-support`;
- `snapback-kernel`: empty default; `test-support`;
- `snapback-sync`: default `sync-owner`; no default; `test-support`; all;
- `snapback-engine`: default `engine-owner`; no default; `test-support` (which
  enables auth/runtime/sync test support); all; and
- `snapback-server`: default `server-owner`; no default;
  `benchmark-support`; `test-support`; all.

The dependent-crate attacks are compiled with no features, unified auth+sync
test support, engine test support, and the union of those test-support roots.
The standalone `snapback-sync` cells containing `test-support` (with
`sync-owner` either disabled or enabled) were also enumerated: they are
existing unbuildable combinations because sync's test-only code refers to
helpers gated by auth/kernel test support without enabling those dependency
features. Those cells produce no usable authority route; the corresponding
buildable graph-unified cells are covered by explicitly enabling auth test
support alongside sync test support. Changing sync's feature wiring would
reclassify 107 unrelated privilege-ratchet entries and is outside this
narrowed Q11 landing. Feature-enabled
`PreparedBearerAuthority::authority`/`into_parts` expose only an already
resolved value. `InvocationGate::prepare_authority` can prepare that same
origin under test support, but the private payloads and shared origin prevent
a parts-based mint or retarget. Raw unit-test constructors are `cfg(test)` and
crate-private; they are not enabled for a dependent by Cargo feature
unification. The former public `synthetic_for_test` subject/service mint routes
are absent.

## Durable-state audit (LLP 0303 revision p)

No new durable state was introduced. The new provenance is process-local:

- the admission controller owns the database binding and lease tokens;
- only the verifier/projection paths can seal a subject origin;
- callers cannot advance, pre-empt, or retarget an origin by writing durable
  rows;
- the lease's subject claim is structurally single-assignment across clones;
  retained live reruns acquire a fresh root from that same sealed origin rather
  than retaining an event producer's root;
  and
- the target-engine check occurs before grant-management planning or the
  effect transaction.

Because there is no new durable authority record, writer ownership,
transactional co-write, and monotonic durable advancement are not applicable.
The authorized durable effects retain their existing transactions.

## Proof

Two no-feature external dependent witnesses split the complete old composition
at independently pinned compiler spans. `construct-resolved-app-authority-from-parts`
tries to construct a session naming copied user/session facts and fails at the
private payload fields with `E0451`. `join-and-carry-resolved-app-authority`
accepts a resolved value, combines it with an independently minted admission
lease through the former generic gate, and carries the result into a second
engine's grant-revocation planner; it fails at the crate-private join with
`E0624`. Both witnesses are recompiled under every buildable additive
test-support combination above; the isolated unbuildable cell is reported
separately rather than mistaken for a witness pass.

The `snapback-engine` integration test is also compiled as an external crate
with `--no-default-features`. It verifies both that engine B refuses to prepare
authority under engine A's admission and that a genuine prepared value from
the public admission/gate surface fails when presented to engine B, each with
`SNAPBACK_AUTH_POLICY_UNAVAILABLE`.

The revalidated-watch boundary test obtains a genuine protected-catalog
principal from database A and attempts the public preparation route using a
managed lease bound to database B. The join fails with
`SNAPBACK_AUTH_POLICY_UNAVAILABLE`; preparing the same carrier with database
A's lease remains the succeeding control path used by the watch reaction.

The runtime boundary test uses a *genuine* session authority from engine A and
matching users, agent, and grants in engine B. It attempts the full formerly
successful single and bulk compositions: plan, acquire the terminal service
gate, and execute the durable revocation. With the target-engine check removed,
the operation succeeds and the test fails at `expect_err`. With the check
present, both paths return `SNAPBACK_AUTH_POLICY_UNAVAILABLE`, and an exact
before/after readback proves every grant, token, watch, and authorization-clock
row is unchanged.

The retained-live and bundle controls exercise the compositions that must
continue to succeed: authorization reruns acquire their root from the retained
subject producer, a bundle child inherits the exact prepared carrier, and an
unsubscribe continuation uses the same carrier. These are paired with the
foreign-engine refusal rather than testing only the already-closed parts-based
mint.

## Resolution

Resolved on 2026-08-25. The implementation closes the caller-minted
session/service/revalidated payload routes, preserves provenance across clones
and feature-only extractors, removes the public generic lease/authority join,
and binds grant-management use to the target engine graph. The row claim is
limited to Q11: F143 and C005.
