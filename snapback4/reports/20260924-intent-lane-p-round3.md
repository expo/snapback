# Lane P — round 3 authorization reservation

Date: 2026-09-24. Worktree: `~/sb4-intent/lane-p`.
Branch: `sb4-intent/p-expiry`.
Runtime/regressions: `82ba4b277`. Device expectations: `27a478595`.
No push, merge, version bump or publication.

## Root cause and fix

The new alternate-key `DeleteTarget` preserved the old lowering's read gate,
but omitted the `Get`'s authorization-budget reservation. With
`read <- exists grants[.id, viewer]`, an empty grant set and exhausted probes,
lookup could select two different observable paths: an absent target returned
`NOT_FOUND`, while a hidden live target reached `check_rule` and `E_BOUND`.
The expiry charge fix alone did not protect this separate resource boundary.

A shared `reserve_write_rules` now checks the static worst-case probe allowance
before target lookup. It returns `E_BOUND` before existence or expiry can select
a different path. It checks room without debiting it: actual rule execution
keeps its existing charges and short-circuiting. It does not bypass any rule.

The audit covered all thirteen execution paths exercised by the new tests:
compiled update/upsert/delete by id or unique key, ordinary insert and
insert-if-absent with primary or secondary collisions, raw compatibility
Update/Upsert, and raw by-id DeleteTarget.

Let R/I/U/D mean the schema's worst-case read/insert/update/delete probe counts.

| Path | Reservation and lookup order |
|---|---|
| Update, compiled or compatibility, either address | Existing `2R + U` check, through the shared helper, before fetch or live lookup. |
| Upsert, compiled or compatibility, either address | Existing `2R + U + 2I` check before fetch/live lookup or selecting the insert arm. |
| Alternate-key delete / raw DeleteTarget | New `R + D` check before the private lookup, expiry walk and missing-target branch. Read and delete gates remain. |
| Raw by-id delete | New `R + D` check before `fetch`; its existing delete-only authority gate is preserved. |
| Insert / insert-if-absent | New `R + I` check before insertion-rule execution and primary/secondary collision lookups, including expiry walks. |

The insert arm of an upsert also passes through the insertion check. The
existing column and maintain reservations inspect schema facts, not target
populations. Expiring targets are excluded from speculative prefetch; optional
non-expiring prefetch returns no refusal and changes no logical meter. Private
engine cleanup and final-exists postconditions retain their distinct contracts.

## Files changed

Paths are relative to `snapback4/`, except the two parent-directory documents.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/write_target.rs` | Add shared static rule-room check; use it for update/upsert's existing reservation and before DeleteTarget lookup. |
| `crates/snapback4-core/src/engine/write.rs` | Reserve read/write authorization before insert, if-absent and raw by-id delete lookups. |
| `crates/snapback4/tests/expiry_writes.rs` | Register authorization regressions. |
| `crates/snapback4/tests/expiry_writes/authorization.rs` | Four tests: zero budget, default budget exhausted by real probes, worst-case short-circuit allowance, and the unreadable-delete gate with a positive control. |
| `crates/snapback4-device/tests/readauth/timing.rs` | Assert zero-budget prediction refuses; build the overlay with one reserved probe, then preserve the independent zero/one-probe query checks. |
| `crates/snapback4-device/tests/presence/unconfirmed.rs` | Update the measured minimum from 2 to 3 probes; enable the formerly ignored server/device boundary test, requiring refusal at 2 and success at 3. |
| `crates/snapback4-lang/src/guide/writes.rs` | Explain authorization reservation for deletes and insert collision lookups, including short-circuit probes. |
| `../llp/3000.013-quarry-states-intent.rfc.md` | Record the root cause, audit, fix, tests and deliberate changes to tight prediction allowances in §11.1. |
| `../issues/20260917-snapback4-presence-conjunction-server-charges-more-heap-than-prediction-reserves.md` | Record resolution of its rule-probe instance; retain the separate heap issue and open status. |
| `JOURNAL.md` | Append one dated round 3 entry, measurements, failure accounting and final qualification. |
| `reports/20260924-intent-lane-p-round3.md` | This report. |

Every changed source file is below 1,500 lines. No new syntax, refusal code,
wire field, runtime ceiling or wasm budget was introduced.

## Forms exercised

These existing forms compile and execute with the `records` fixture's declared
columns and rules. With insufficient authorization room, every path refuses
before lookup. Alternate-key delete requires read and delete authority; the
other existing write-authority contracts remain unchanged.

| Form | Example |
|---|---|
| Update by id | `update records[id = 'target'] { amount: 2 }` |
| Update by unique key | `update records[key = 'key'] { amount: 2 }` |
| Upsert by id | `upsert records[id = 'target'] { key: 'key', amount: 2, until: null }` |
| Upsert by unique key | `upsert records[key = 'key'] { amount: 2, until: null }` |
| Delete by id | `delete records[id = 'target']` |
| Delete by unique key | `delete records[key = 'key']` |
| Insert | `insert records { id: 'new', key: 'key', amount: 2, until: null }` |
| Insert-if-absent | `insert records { id: 'new', key: 'key', amount: 2, until: null } if absent` |

The schema variants include `expire at .until` and a non-expiring table. Raw
compatibility IR has independent tests rather than relying only on the current
compiler's WriteTarget lowering.

## Tests and evidence

- `every_write_target_reserves_authorization_with_zero_rule_probe_budget`:
  78 executions across thirteen paths and the non-expiring/expiring worlds.
  Compares serialized complete `MutationOutcome`s, including all refusal fields,
  current data, every meter field, tables, event count and replay status. Storage
  remains unchanged. Worlds include absent, live hidden, one expired target id,
  and 9,000 expired siblings. Each refusal is specifically a rule-probe bound.
- `every_write_target_reserves_authorization_after_8192_real_rule_probes`:
  the same 78 executions under default ceilings after an actual 8,192-read
  prelude. A successful control proves the prelude spent exactly 8,192 probes.
  The target refuses before an examination/expiry cut can substitute for the
  authorization refusal; reservations do not debit an extra probe.
- `write_targets_reserve_even_the_read_probes_that_would_short_circuit`:
  26 executions with a two-probe read conjunction and allowance 1. Even though
  its first probe would deny, both possible probes must fit before lookup.
- `alternate_key_delete_requires_read_authority_even_when_delete_is_allowed`:
  with a live unreadable target and delete allowed, refusal matches absence
  and storage remains unchanged. Adding the read grant permits deletion.
  Tested on both schema variants. A deliberate removal of the read gate made
  the test fail with a successful unauthorized deletion; the gate was restored.
- Existing expiry inventory: **26 passed in 11.31 s**. All 9,000 sends still
  assert **examined == 1**, with either zero or 3,000 unrelated expired rows.
- Existing authority inventory: **35 write-authority tests and 25 disclosure
  reviews passed**, including the never-live-grant regression.
- Updated device fixtures: **10 timing tests and both fifty-member tests pass**.
  Both device stores and server accept the send at a three-probe ceiling and
  refuse at two, with no effects on refusal. The measured prediction minimum
  is `[52, 2, 3, 1367, 69843, 27, 1]` in examined/index/probe/step/heap/output/write
  order. Only its probe minimum changed; the other six values stayed fixed.

Commands from `snapback4/` with the required toolchain PATH:

```sh
CARGO_INCREMENTAL=0 cargo test -p snapback4 --test expiry_writes -- --nocapture
CARGO_INCREMENTAL=0 cargo test -p snapback4-sim --test write_authority --test reviews
CARGO_INCREMENTAL=0 cargo test -p snapback4-device --test readauth timing::
CARGO_INCREMENTAL=0 cargo test -p snapback4-device --test device presence::unconfirmed:: -- --nocapture
```

Wasm: **1,753,894 B raw / 487,627 B gzip**, versus round 2's
1,753,421 / 487,644: **+473 raw / -17 gzip**. This is a whole-artifact
measurement; no independent subcomponent attribution is claimed. The existing
488,000 B ratchet remains, with 373 B headroom.

## Deliberate behavior changes and remaining limits

The reservation can now refuse an absent-target write that previously reached
`NOT_FOUND` or succeeded with too little authorization room. That is the review's
required change: target existence cannot select a different budget outcome.
Actual rule charges and the runtime ceilings remain unchanged. Three existing
tests pinned the old behavior and were updated accordingly, with their
underlying read-time authorization and server/device comparisons retained.

No round 3 requirement was deferred. No new unresolved runtime defect is known.
Earlier decisions, one separately tracked issue and a scheduling limit remain:

- Expiring-cap occupancy increases still queue without prediction. Reproduce
  cap 1 with an expired row, then sweep on the server while withholding sync:
  the device cannot distinguish current space from the unswept world. Round 2
  explicitly permitted this deferral; no occupancy transport was added here.
- Secondary expired collisions still wait for sweep. With cap 1, an expired
  `old` row and a new-id insert using its secondary key, the server refuses
  `E_CONSTRAINT` until sweeping frees capacity. The refusal names the one-second
  tick and maximum 2,000-row pass. The round 1 never-live-grant disclosure
  constraint still prevents ordinary immediate retirement.
- The existing presence issue's **six-byte heap** instance remains open. Its
  reproduction is `if not exists connected[p] and not exists connected[q]:`
  followed by `emit notify {}` for two three-byte principals at a 1,961-byte
  heap ceiling. Its issue records the server's 1,967-byte need. Only the separate
  rule-probe instance was resolved by this round's reservation.
- Default parallel client scheduling hit one transport timeout on this shared
  host. Reproduction command: `CARGO_INCREMENTAL=0 scripts/test.sh`; see the
  exact failing case and the successful serial/isolated controls below.
  The test's timeout and implementation remain unchanged.

## Full qualification and failure accounting

First full harness: **`== 1 failure(s) in 755 s`**, exit 1, using
`CARGO_INCREMENTAL=0 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh`.
Its client inventory passed: 1,098 tests, 1,088 passes, 10 skips, zero failures
(716 s). Its Rust inventory finished in 129 s with three introduced expectation
failures:

1. `w15a_fifty_member_prediction_includes_read_authorization_on_both_stores`
   pinned a two-probe prediction minimum; the required reservation makes it 3.
2. `reading_probe_meter_memory` constructed its overlay with zero probe room.
3. `reading_probe_meter_sqlite` had the same zero-budget assumption.

All three expectations were corrected and their targeted tests pass. There was
no runtime exemption added to make them pass. The related probe-boundary test
was enabled and passes too.

Earlier development results:

- Initial fixture compilation: **three failures, mine**, because positional
  id syntax was ambiguous with another arity-one unique key. Fixed with named
  `id = 'target'` addresses.
- Corrected pre-fix reproduction: **two expected failures**, absent delete
  returned `NOT_FOUND` at both exhausted probe configurations.
- Deliberate gate-removal experiment: **one expected failure**, unreadable
  delete succeeded. Restored the production gate before qualification.

The baseline was read: `== 1 failure(s) in 276 s` in `cargo test`, containing
four pre-existing test failures: `genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`,
`uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots`,
`census::authoring_census`, and `w9b_why_operation_keeps_residency_and_cost_output`.
None recurred in this round's second Rust inventory. The three failures above
are introduced expectation drift, not baseline failures.

Second full harness: **`== 1 failure(s) in 227 s`**, exit 1, using
`CARGO_INCREMENTAL=0 scripts/test.sh` and default parallel client scheduling.
Rust passed in 158 s. The sole client failure was
`native: maximum pending ids (232), cursor batches and every terminal acknowledgement`
at `packages/snapback4/test/transport-http.test.mjs:175`, a 30-second wait for
terminal acknowledgements and an empty queue. Classified **environmental / scheduling
timeout**, inferred from the controls: it passed in the first serial full run with identical runtime code,
then passed independently in 3.46 s. All six maximum-pending-ID cases passed in
that independent run (23.10 s). Neither client code nor timeout was changed.

Final full harness: **`== 0 failure(s) in 750 s`**, exit 0, invoked with
`CARGO_INCREMENTAL=0 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh`.
Its complete Rust inventory passed in 133 s, including all 26 expiry tests.
Clients passed in 711 s: 1,098 tests, 1,088 passes, 10 skips, zero failures.
The native 232-ID transport case passed in 3.20 s; its 233-ID and 256-ID
neighbors passed too. Builds, docs budget, release guard, package and app
typechecks, chat check and fixture wrapper tests all passed. No remaining
failure is classified as introduced, baseline or environmental in this run.
Each full run completed before the next began; only one full Rust inventory
ran at a time.

Logs outside the checkout use `~/sb4-intent/lane-p-round3-` followed by:
`repro.log`, `repro-fixed-fixture.log`, `read-gate-mutation.log`,
`expiry-final.log`, `authority.log`, `readauth-update.log`,
`presence-update.log`, `wasm.log`, `refs-final.log`, `suite.log`,
`suite-final.log` (the parallel run), `transport-isolated.log`, and
`suite-serial-final.log`.
