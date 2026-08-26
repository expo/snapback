# Lane E report — snapback-engine lib-test seam debt

Date: 2026-08-26
Branch: `ws/seams`

## Migration

- Asset finalize/width tests no longer read or replace a store retained inside
  `FinalizePrepareTicketV1` or `AssetWidthPrepareTicketV1`.
- Affected tests construct `LocalSnapback` with the harness-owned
  `ControlledAssetStore` before upload/preflight. Tickets therefore retain the
  store selected before construction. Finalize tickets are owner-bound; width
  tickets are engine-produced with immutable store selection but have no owner
  identity and retain a public constructor. LLP 0312/F272 origin binding stays
  open. Tests arm bounded one-shot controls on the harness fixture for copy,
  PUT, hash, source-read substitution, and hash corruption.
- The push system-authority fixture no longer uses `AdmissionLease::unmanaged`
  or a disposable second engine. New `#[cfg(test)] pub(crate)`
  `LocalSnapback::prepare_cron_system_authority_for_test` accepts no caller
  authority coordinates; it admits through the target engine's controller,
  derives `System` internally, and installs that engine's authorization-stream
  binding. The consuming sink rechecks target admission ownership and exact
  consuming-database stream ownership, with a cross-engine refusal test.
- No removed broad backdoor was reintroduced.

## Round 3 — same-engine push authority correlation

The immediate authorized-effect route now verifies identity instead of deriving the push
principal from the reservation. Each freshly prepared authority receives a private
`ProcessBoundIdentity`; clones and permitted refinements preserve it, while another session
preparation in the same engine cannot reproduce it. `AuthorizedEffectReservation` retains that
exact authority lineage, and the immediate reservation sink compares it with the separately
presented push authority before projecting the principal or reaching the durable cut. The
authorized-effect batch claim and transmitting-marker siblings perform the same check.

The new two-session, same-engine regression was observed failing before the check:

```text
authority A committed durable intent pint_01m102ffgdfkh9hranjt6smch8 with principal B's reservation; durable readback state zero-target
test push::authority_tests::immediate_push_reservation_refuses_different_session_from_same_engine ... FAILED
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 609 filtered out; finished in 0.21s
```

With the check restored, the mismatched pair refuses with
`SNAPBACK_AUTH_POLICY_UNAVAILABLE`. A correctly correlated retry is non-deduplicated and its
intent state is read back directly from the durable push registry, proving the refused attempt
left no intent.

Command:

```text
DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks RUST_MIN_STACK=16777216 cargo test -p snapback-engine --lib push_reservation_refuses_ -- --nocapture
```

All refusal and epoch-gate result lines, verbatim:

```text
test local::engine::admission_fence_tests::push_reservation_refuses_retired_epoch_without_a_durable_intent ... ok
test push::authority_tests::push_reservation_refuses_authority_from_different_engine ... ok
test push::authority_tests::immediate_push_reservation_refuses_different_session_from_same_engine ... ok
test push::authority_tests::immediate_push_reservation_refuses_authority_from_different_engine ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 606 filtered out; finished in 0.30s
```

The follow-up audit found no remaining decoupled `PreparedAuthority` /
`AuthorizedEffectReservation` pair in the three push authorized-effect sinks. It did reconfirm
the previously inventoried non-push population, including post-I/O asset paths that need a
ticket-to-reservation lineage rather than this push-specific check. The scoped disposition is
recorded in
`issues/20260823-uncorrelated-authority-axes-are-systemic-153-sites.md`; no repository-wide
closure is claimed.

## Earlier cargo results

Earlier commands used:

```text
DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks RUST_MIN_STACK=16777216 cargo test -p snapback-engine --lib engine_authorization_snapshot_path_discards_predecessor_after_installed_fence -- --nocapture
DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks RUST_MIN_STACK=16777216 cargo test -p snapback-engine --lib push_reservation_refuses_authority_from_different_engine -- --nocapture
DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks RUST_MIN_STACK=16777216 cargo test -p snapback-engine --lib
```

Engine no-run: exit 0; lib-test executable produced.

Epoch-gate first execution, verbatim:

```text
test local::engine::tests::engine::engine_authorization_snapshot_path_discards_predecessor_after_installed_fence ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 607 filtered out; finished in 0.10s
```

Cross-engine refusal, verbatim:

```text
test push::authority_tests::push_reservation_refuses_authority_from_different_engine ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 607 filtered out; finished in 0.06s
```

Full engine suite, verbatim:

```text
test result: FAILED. 586 passed; 22 failed; 0 ignored; 0 measured; 0 filtered out; finished in 25.90s
```

The 22 reproducible failures are inherited and outside the migrated paths: no
affected asset test or push authority test failed. They are auth/admission-room
failures, pending-effect/postcommit failures, and one `/dev/fd` fixture failure.
This lane did not change the failing functions or their production paths. The
original first run's `584/23` aggregate was followed by `585/22`; an
original-tree replay and repeated amended-tree replays recovered only the same
22 names pasted into both related tickets, so the unretained intermittent
twenty-third name is unknown rather than guessed.

`snapback-sync` did not reach test execution. It remains inherited compile-red
with 15 missing room-reauthorization helper calls in
`tests/room_reauthorization_settlement.rs` and 5 stale pending-effect API calls
in `src/auth/invocation.rs`. This lane did not touch `snapback-sync`.

## Generated/proof checks

```text
node scripts/generate-diagnostics-registry.mjs
[diagnostics-registry] wrote — 3691 codes, 13091 sites, 1728 HTTP-classified
```

`node scripts/generate-guide-manifest.mjs` exited 1.
It regenerated the diagnostics/symbol projections, then refused the manifest
because these inherited guide sources are absent:

- `demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json`
- `demos/todo-v2/snapback/generated/contract/setCompleted.mutation.ts`
- `demos/todo-v2/snapback/generated/contract/runtime-links.ts`

`node scripts/check-inventories.mjs` exited 1 on the same guide-manifest source
errors; after diagnostics regeneration it reported no stale diagnostics projection.
`./ref-check --verbose` passed:

```text
ref-check: ok — 321 LLP docs, 6812 refs in 12792 files, 0 errors, 0 unchecked
```
