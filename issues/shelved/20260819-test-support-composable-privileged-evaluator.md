# `test-support` still composes into a privileged JavaScript evaluator (F-1 program work)

**Status:** Open
**Filed:** 2026-08-19
**Systems:** Security/authorization, Runtime, Testing
**Related:** LLP 0283 F-1, LLP 0285 §5.3, `26af6b6d7`, `bf1c0d9a7`

## Provenance

Found by an independent blind review of `26af6b6d7` (lane `0283-c-f4`), which
returned BLOCK. The orchestrator verified each cited element against the lane's
base `ede899a20` and **all of them were already public there**, with the lane's
diff touching none of the relevant files. The findings are real but are
**pre-existing F-1 surface, not a regression introduced by that lane** — which
strictly removed capability. They are recorded here as F-1 program work rather
than as a landing veto. The second reviewer independently returned APPROVE on
the same delta.

## Finding 1 — the removed convenience wrapper is reconstructible by composition

`26af6b6d7` deleted `run_service_principal_ibex_mutation_host_calls`, but the
capability it packaged can be reassembled from public surfaces that predate it:

- `crates/snapback-engine/src/test_support.rs:51` — `auth_database_mut` hands
  out the live `LocalDatabase`.
- `crates/snapback-sync/src/auth/invocation.rs:1915`, `:2138` —
  `InvocationGate::prepare_authority` / `prepare_function` fabricate a
  `ResolvedAppAuthority::ServicePrincipal` with a caller-chosen
  authority-creating scope and an unmanaged lease.
- `crates/snapback-kernel/src/storage.rs:7453` — `DbRead::Live` is public.
- `crates/snapback-engine/src/runtime/host_glue.rs:778` —
  `execute_ibex_mutation_prepared` is public and enables writable mode and
  caller-backed elevated reads (`:793`).

A dependent enabling `snapback-engine/test-support` while also depending on
`snapback-sync` (Cargo unifies features) can run an arbitrary `IbexModule`
against a live database with service-principal authority, authority-creating
consent, and `elevated_database_allowed = true`, without durable service-fence
validation.

Independently, `LocalDatabase::mutation_writes()` (`storage.rs:1753`) is public
and `storage/mutation_writes.rs:647` commits a caller-supplied `MutationPlan`
using caller-supplied `HandlerInput` identity — a writable-handle escape in its
own right.

## Finding 2 — `SNAPBACK_TEST_SUPPORT_RUNTIME_FORBIDDEN` is a partial fence

The fence added in `26af6b6d7` sits only in the facade
(`crates/snapback-engine/src/test_support.rs:101`). Two gaps, both pre-existing:

- A caller can use the public unguarded staging route instead —
  `prepare_subscribe_live_for_transport_generation` and
  `finalize_subscribe_live_for_transport` (`crates/snapback-engine/src/local/engine.rs`,
  `pub` at base).
- Definition-swap TOCTOU: stage a name while it is a HostPlan, reload it as an
  `IbexModule`, then commit and finalize. The facade stages with
  `expected_generation = None`, and final execution resolves the definition by
  name, so the JavaScript runs with no second runtime check.

**Do not read this fence as closure.** It narrows the convenient path; it does
not confine a determined caller. That limitation is why this ticket exists.

## Required repair

This is LLP 0285 program work, not a local patch. The composition is exactly the
shape LLP 0285 §1 rules out — a capability that is `pub` and confers real
authority because the kernel accepts caller-projected facts. It should be closed
by §5.1's "the kernel derives, never accepts" (no fabricable
`ResolvedAppAuthority::ServicePrincipal`, no unmanaged lease) plus §5.3's rule
that feature-gated library APIs must not expose capability. Bind
`expected_generation` through stage/finalize so the definition cannot be swapped
underneath a staged live subscription.

The LLP 0284 gate suite should grow a fixture for the composed path, not just
for the individual seams — composition is how this survived.
