# Lane Q — expiring aggregate backlog reads

2026-09-25. Branch `sb4-intent/q-expiring-counts`, based on `e3451183e`.
Implementation commits: `de0eff82c` (server/index), `3d11d3c52` (PostgreSQL),
`114a1d95f` (memory adoption and device upgrade tests), `a1704231a`
(portable key boundary), `8f8f14631` (unavailable-answer cache retirement),
`372afb204` (readiness fixture recovery).
Implementation of the safe server/index/adoption portion of LLP 3000.013 Lane Q.
The physical-total device delivery portion is **stopped**, under the brief's
explicit stop rule, for the two counterexamples below. It is not claimed built.

## Result and measurements

The server reads the stored physical total minus selected expired contributions
not yet swept. The shared internal index orders `(group, expiry, source id)`;
null expiry sorts after all integer instants. Writes and sweeps still update
the physical total exactly once. A final live-entry seek preserves live
candidate semantics and records the next clock invalidation.

| Selected live rows | Unswept expired rows | Server examined | Complete count |
| ---: | ---: | ---: | ---: |
| 100 | 0 | 2 | 100 |
| 10,000 | 0 | 2 | 10,000 |
| 100 | 500 | 502 | 100 |
| 10,000 | 500 | 502 | 10,000 |

The lookup costs one examination, the live-entry seek one, and each backlog
row one. A missing target costs one. An examined ceiling of 100 cuts the
500-row backlog to `data: null, complete: false`, never a partial count.
The old live-recomputation path retained on devices measures 101 examinations
at 100 held rows, and cuts at 8,193 at 10,000 rows. These are measured device
reference-path costs, not a separate rebuild of the old server binary.

For the single-view fixture with 10,000 receipts and 300 expiries, the real
one-second tick schedule, 2 ms cooperative slice and 2,000-row maximum drained
the backlog in **12 passes / 12,000 ms** on this shared host. The physical
total became 9,700 and subsequent server reads examined two rows. This is an
observed lag, not a service guarantee; the time slice and host contention can
limit a pass before its row maximum. Additional fast-loop tests with four views
drained the same 300 rows in 15–20 passes / 31,881–42,841 microseconds in the
recorded focused run. Their printed `simulated_tick_lag_ms` is an estimate,
not the wall-clock measurement above.

The wasm artifact measures **1,767,654 B raw / 492,341 B gzip**, versus the
recorded 0.4.1 integration artifact 1,765,796 / 491,640: +1,858 / +701 bytes
for the whole artifact. The documented wasm ratchet is 493,000 bytes, with
659 bytes headroom. No runtime resource ceiling changed. Server backlog and
PostgreSQL code are outside the web artifact.

## Files

Paths below are relative to `snapback4/`, except the LLP.

| File | Change |
| --- | --- |
| `crates/snapback4-core/src/maintain.rs` | Prepare expiry-ordered contribution indexes; retain the existing predicate/key evaluator. |
| `crates/snapback4-core/src/rows.rs` | Encode expiry after the group, using a private string sentinel for null, after every integer instant. |
| `crates/snapback4-core/src/schema.rs` | Validate legacy and new internal index representations; document the format. |
| `crates/snapback4-core/src/engine/aggregate_expiry.rs` | Server backlog subtraction and next-live seek; preserve device live recomputation. |
| `crates/snapback4-core/src/engine/read.rs` | Route aggregate reads through the extracted module, share clock invalidation, reserve expiry-bearing witness key space. |
| `crates/snapback4-core/src/engine/maintains.rs` | Share the existing contribution delta helper with backlog reads. |
| `crates/snapback4-core/src/engine/mod.rs` | Normalize stored contribution descriptors before activation checks on reopen. |
| `crates/snapback4-core/src/store/activation.rs` | Meter contribution index rebuild work within the existing atomic activation walk. |
| `crates/snapback4-core/src/engine/postgres/contribution_upgrade.rs` | Rebuild changed contribution indexes under the adapter writer lock and advance the stored generation atomically. |
| `crates/snapback4-core/src/engine/postgres/mod.rs` | Install the upgrade on attach and retain its generation. |
| `crates/snapback4-core/src/engine/postgres/tests.rs` | Register the PostgreSQL regression module. |
| `crates/snapback4-core/src/engine/postgres/tests/expiring_counts.rs` | Real PostgreSQL live/backlog/null-expiry and legacy-index upgrade checks. |
| `crates/snapback4-device/src/memory.rs` | Check contribution rebuild costs before memory adoption publishes metadata or clears entries. |
| `crates/snapback4-device/tests/expiring_counts.rs` | Scale, differential, prediction, SQLite upgrade, disclosure counterexample and sweep-lag tests. |
| `crates/snapback4-device/tests/expiring_counts_upgrade.rs` | Reopen legacy-shaped memory and SQLite device stores; assert key ordering and atomic refusal. |
| `crates/snapback4-device/tests/readauth/round2.rs` | Preserve the early-live-witness allocation test under expiry ordering by choosing an early live deadline and clock. |
| `crates/snapback4-lang/tests/fixtures/expiring-counts.q` | One-table receipts program with filtered count/sum and computed-day groups, shared by the adapter and certificate tests. |
| `crates/snapback4-lang/src/guide/language.rs` | Add a compiled expiring unread-count example. |
| `crates/snapback4-lang/src/guide/maintains.md` | Replace server live-population cost with backlog cost, sweep bound and unchanged device limitations. |
| `crates/snapback4-lang/src/guide.rs` | Correct expiry-card read cost and sweep scheduling/lag language. |
| `crates/snapback4-lang/src/guide/types.rs` | State server backlog versus device recomputation cost. |
| `crates/snapback4-lang/tests/guide.rs` | Count the added block; select the timeline compatibility example by its declaration. |
| `crates/snapback4-lang/tests/timeline_guide.rs` | Select that compatibility example by declaration, independently of later examples. |
| `crates/snapback4-sim/tests/review_corrections.rs` | Exercise interrupted point/page aggregates with expired backlog instead of live population. |
| `crates/snapback4-sim/tests/trending/mod.rs` | Prove a large live count completes, then the same expired backlog makes the projected count unavailable. |
| `crates/snapback4/src/scale.rs` | Describe constant server lookup plus backlog, name the sweep, and explicitly retain the device cost. |
| `crates/snapback4/tests/scale.rs` | Update the old live-scan certificate expectation. |
| `crates/snapback4/tests/scale_windows_expiry.rs` | Compare examined measurements at both scales/backlogs against the certificate. |
| `packages/snapback4/src/local.ts` | Evict a remembered server answer after a definitive loading reply, so transport loss cannot revive it. |
| `packages/snapback4/test/page-authority.test.mjs` | Deterministic loading-then-transport-failure regression without a replica commit clearing the cache. |
| `packages/snapback4/test/page-ready.test.mjs` | Await an actual sync after controlled transport loss before asserting a server loading reply; all assertions retained. |
| `metrics/wasm-budget.json` | Record measured bytes and the justified 493,000-byte ratchet. |
| `../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` | Dated Lane Q amendment to §20.9.3, including both stopped device requirements. |
| `JOURNAL.md` | One append-only dated entry with costs, lag, verification and stopped work. |
| `reports/20260925-lane-q-expiring-counts.md` | This implementation and verification report. |
| `reports/20260925-lane-q-test-failures.md` | Every failure from the intermediate completed suite, with attribution. |

## Forms exercised

No syntax or refusal code was added. These existing forms now use the optimized
server path, and the compiled guide includes the one-table unread example:

```quarry
view unreadCounts: count receipts where .state < 2 and .visible by .chat, .principal
view unreadWeight: sum receipts of .weight where .state < 2 and .visible by .chat, .principal
view dailyUnread: count receipts where .state < 2 and .visible by .chat, .principal, day(.at)
view dailyWeight: sum receipts of .weight where .state < 2 and .visible by .chat, .principal, day(.at)
```

The fixture declares `expiresAt: time ?` and `expire at .expiresAt`; scalar
lookups include `unreadCounts['chat', viewer]` and
`dailyWeight['chat', viewer, day]`. The inbox uses
`unreadCounts where .principal = viewer first 20 after c`.
Old `maintain`, explicit `by <index>` and other compatibility spellings remain.

## Tests and evidence

- `server_cost_is_constant_plus_backlog_and_cuts_never_return_a_number`:
  100/10,000 live rows crossed with 0/500 backlog, including null expiry;
  exact examined costs and no number on a meter cut.
- `scale_memory`, `scale_sqlite`: both device hosts acquire the same 100/10,000
  receipts, cross expiry, sweep and reopen. Exact local answers agree where
  available; a metered device returns null/incomplete. Physical totals lose
  exactly the swept 300 contributions.
- `physical_delivery_would_disclose_an_expired_contribution_to_a_new_device`:
  preserves the indistinguishable live snapshots in the disclosure counterexample.
- `seeded_changes_match_the_old_live_recomputation`: four seeded sequences of
  180 insert/update/delete/sweep/clock turns, six scalar comparisons each
  (4,320 comparisons), against a full physical-row live-filter oracle. Covers
  signed sums, filtered selection, expiry changes and computed-day key moves.
- `predicted_expiry_changes_memory`, `predicted_expiry_changes_sqlite`:
  predicted insert/update/delete and clock boundaries agree with the server,
  including query-level next-expiry invalidations. This tests the retained
  recomputation path, not unimplemented delivered metadata.
- `sqlite_041_store_rebuilds_expiry_index_at_open`: downgrade real persisted
  keys/schema to 0.4.1 shape, retain live/expired-unswept/null rows, reopen,
  prove generation advances once, total stays physical and live reads are exact.
- `memory_041_upgrade`, `sqlite_device_041_upgrade`: legacy `(group,id)` keys
  reopen as `(group,expiry,id)` with null last; local/server answers agree at
  three pinned instants. `refused_memory_rebuild_does_not_publish_metadata_or_clear_entries`
  proves an adoption heap refusal preserves metadata, rows and indexes.
  `memory_upgrade_preserves_the_portable_key_ceiling` and
  `sqlite_upgrade_preserves_the_portable_key_ceiling` prove a legacy key exactly
  at the portable ceiling cannot be widened past it or partially publish adoption.
- PostgreSQL `expiry_counts_and_041_upgrade_match_sqlite`: passed against an
  isolated PostgreSQL 16 server on a private Unix socket; the default ignored
  integration test was explicitly run. No shared database was modified.
- `expiring_aggregate_certificate_matches_live_population_and_backlog_measurements`:
  the 2/502 examined measurements fit the declared certificate at both scales.
- `sweep_lag_at_one_second_ticks`: explicitly ran this normally ignored wall-clock
  measurement; it produced the 12-pass/12-second result above.
- `a loading server reply retires the remembered answer before a later transport failure`:
  deterministically failed on the unchanged 0.4.1 client, then passed after
  retiring the remembered answer on loading. This closes a pre-existing fallback
  bug exposed by the suite, consistent with the no-stale-answer requirement.
  The existing readiness fixture also had a recovery race: an offline query
  cannot reconnect. Awaiting sync removes that race; ten consecutive isolated
  runs passed with every original assertion retained.
- Existing affected suites: guide 80/80, timeline guide 4/4, authority witness
  2/2, capped aggregate 2/2, trending projection 1/1; included again in the full suite.
- `./ref-check --verbose`: `ref-check: ok — 507 LLP docs, 9272 refs in 25856 files, 0 errors, 0 unchecked`.

## Stopped requirements and reproductions

1. **Physical device total/nextExpiry delivery discloses expired data.** At
   time 100 compare an empty receipts table with one selected physical receipt
   whose expiry is 100. Both live counts are zero; both current fresh snapshots
   are empty. Sending physical `T=1` and the past expiry in the second world
   reveals the expired contribution to a device that never held it. Engine-owned
   metadata still travels to the device. Run
   `cargo test -p snapback4-device --test expiring_counts physical_delivery_would_disclose`.
   The existing simulator expired-snapshot test remains unchanged and passes.

2. **Required device recomputation cannot produce the required large exact answer.**
   Hold all 10,000 selected receipts, then expire 300 without sweeping. The
   specified recomputation needs 10,000 source examinations plus lookup work;
   the unchanged 8,192 ceiling cuts at 8,193. Run
   `cargo test -p snapback4-device --test expiring_counts scale_ -- --nocapture`.
   Devices return unavailable, never a stale or partial count. Because physical
   delivery is stopped, the current device also remains unavailable before
   expiry at that size. Constant-cost device answers and the delivery/prediction
   metadata protocol need the supervisor's design decision.

Value-order indexes over expiring sources, maintained columns over expiring
sources, and value comparisons in expiring-maintain rules remain refused. Their
freshness/authorization proof is not supplied by backlog subtraction; no disagreement
with the scope fence and no new diagnostic codes.

## Engineering decisions and limits

- Legacy and new index descriptors decode; engine/device activation normalizes
  them. The extra expiry column is part of the engine index descriptor only.
  Null uses the existing ordered string tag after the integer tag.
- Existing atomic activation remains atomic. SQLite contribution work uses job
  meters in bounded row chunks; PostgreSQL uses 32-row scan pages within its
  writer transaction; memory checks bounded chunks before its infallible rebuild.
  This is not a new resumable adoption protocol. Meters can refuse an oversized
  adoption chunk without publishing it.
- The first surviving entry seek avoids scanning live rows, preserves a live
  zero-sum candidate and supplies query invalidation. Stored zero-sum occupancy
  and sweep subtraction retain their existing implementation.
- The unchanged portable key ceiling also applies to the widened index. A
  near-limit legacy key can refuse adoption with `E_INDEX_KEY_BYTES`; shorten
  its indexed values with the previous binary before retrying. There is no
  partial adoption and no portable-key ceiling increase.
- A pre-existing client fallback bug was fixed to meet the unavailable-answer
  contract and the requested green suite: a loading reply now retires its
  remembered prior answer. It was not among the older shared baseline log
  failures; the added isolated regression failed before the one-branch fix.
- No application column, wire metadata, authorization rule, source coverage
  exception or runtime ceiling was added. No version
  bump, push or publication; integration belongs to the supervisor.
- Build artifacts remained on the shared disk. The recovered ENOSPC run had
  no final summary; it is environmental and is superseded by the completed runs.

## Final verification

Final `scripts/test.sh`, exit 0: **`== 0 failure(s) in 265 s`**.
The source stayed fixed throughout the run. Command environment:
`CARGO_BUILD_JOBS=8 SNAPBACK4_RUST_TEST_PROCESSES=8`; client files used the
normal parallel harness. All 882 Rust test executions, including doctests,
passed. The main client process reported 1,479 tests, 1,469 passes, zero
failures and ten existing explicit skips; separate client shards also passed.
No new skip or waived failure was used to pass. The log is
`~/sb4-intent/lane-q-test-complete.log`.

The intermediate completed suites reported `== 2 failure(s) in 417 s`
(cargo test and client tests) and `== 1 failure(s) in 1295 s` (client tests).
The [failure ledger](20260925-lane-q-test-failures.md) names every individual
failure and classifies it as ours, baseline or environmental. The final suite
has no failures. The explicit real-PostgreSQL upgrade rerun also passed after
the last key-bound guard; its private server was stopped afterward. Logs are
`~/sb4-intent/lane-q-pg-complete.log` and `~/sb4-intent/lane-q-sweep.log`.
