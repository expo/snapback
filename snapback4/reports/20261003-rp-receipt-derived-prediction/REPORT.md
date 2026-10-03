# RP — receipt-derived maintenance and prediction

2026-10-03. Branch `sb4-intent/rp-receipt-derived-prediction`.
Base: `a8c20c40e986f8af98f4579386bdb80b9fa7f69e` (unmodified main at lane start).
The initial sections record round 0. **Round 1 below supersedes its compatibility,
reservation and table-wide pending behavior**, and records its qualification.
**Round 2 supersedes Round 1's remaining reservation gaps, permissive capability
waiver, canceled-insert fallback and exact-Linux wasm cap.**
All execution stayed in the provided eb1000 Linux workspace (OS hostname
`expose-builder-pixel`). No office M1/M5, push or publication.

## Result

Calibration #29's complete schema now classifies `send`, `sendMedia`,
`createGroup` and `addMember` as eligible. The original schema and `windows.q`
are compiled by a regression. Its CLI reproduction copies both files and
`workers/push.mjs`: main reports **15 mutations never predict**, RP **11**.
`why send` changes from `predicts: never; queued without a row` to eligible
with the existing quote/profile horizon caveats. It additionally explains:

> receipt-derived maintenance unreadCounts stays settled during prediction;
> readers report incomplete until settlement

Both binaries also checked a control without the view. The control replaces
its sole inbox reference with literal zero so the schema remains compilable;
it changes no mutation. `send` is eligible on both controls. All twenty
`check`/`why` invocations exited zero. The pinned main binary was built in the
separate, clean `../rp-baseline` worktree; no candidate source was copied into it.

Prediction skips targets in `schema.receipt_dependencies` before contribution
or predicate evaluation, on the shared interpreter used by memory, SQLite and
wasm. It also skips the corresponding aggregate reservation. Existing private
parent-column maintenance remains server-only. Pending source inserts,
updates and deletes never alter these stored totals; member inserts create no
provisional count row. Server maintenance and settlement remain authoritative.

Read-time recounting needs the same boundary. While either the source table
or row-key member table has any overlay entry, point reads, scans and live
recounts preserve the last settled value and report `complete: false`.
Row-keyed results additionally report `recountPending: true`; these marks are
query output, not stored writes. The lookup uses durable overlay metadata,
including deletion entries, on both stores. It is conservative across a table,
so another held group's pending write can also mark the answer incomplete.
There is no source walk, per-value taint or guessed-ordinal aggregate. The
metadata check includes the empty identity: a strict after-empty cursor missed
that legal id and let a live query count a provisional insert. A table-existence
probe now uses the memory base-map range or SQLite indexed EXISTS. Both-store
regressions cover the empty-id insert, settled count, deletion and settlement. A pending
new member's absent count is incomplete, not a certified zero. Expiry can make
the frozen value too large: it is a snapshot, **not** an `L+` lower bound.
A parent-key aggregate computed only on read has no cached settled value: it
returns null/incomplete while pending. The raw-schema adversary exposed an
`E_FIELD` from a synthetic row without a value; the point-read path now returns
explicit unavailability. After the overlay clears, ordinary live expiry/coverage
certification resumes.
Parent columns retain their existing unmarked synchronized-value contract.

`receipt-derived-prediction-v1` is a required schema capability when these
maintains exist. An older device must reject the schema instead of applying
its former maintenance implementation to newly eligible operations. Existing
receipt fingerprints and delivery debt semantics are unchanged.

## Safety boundary and counterexample

The unrestricted rule is unsafe for sums. Two messages each contributing
`I53_MAX`, selected by `.recipients > 0`, make the server refuse the second
write with **E_OVERFLOW**. The new counterexample runs on both device stores,
checks static refusal, durable custody and exact rollback, and leaves one
settled message. Receipt-derived sums, including private mirrored sums, remain
`predicts: never` even when the authored body never reads their result.

The engine audit found these decision points:

| Path | Disposition |
| --- | --- |
| Aggregate sum/contribution overflow (`maintains.rs`) | Receipt-derived sums remain server-only. Existing RY huge-score/key/predicate regressions remain intact. |
| Row-keyed count cardinality and delta arithmetic | Valid counts represent a safe-integer store population; no new overflow bypass. The server retains its checked arithmetic. |
| Target constraints and extra unique indexes | Classified conservatively as server-only, except the intrinsic id/group uniqueness. Aggregate engine puts bypass authored target rules and `check_constraints`; target caps are **not** currently enforced by maintenance. |
| Row-key member authorization (`row_view_member`) | The ordinary readable-member and readable-source-group precondition still runs before device suppression, without examining the predicate/count. Its read rules join the binder walk. |
| Member update/move | Server-only: preserving a cached count while moving its member could attach the old domain's number to the new domain. Source edits/deletes are supported. |
| Source cap keys using receipt state | Server-only. Ordinary caps/automatic uniqueness retain their existing checks and allocation refusal custody. |
| Count-dependent body, rule or final-exists check; returned count | Unchanged static dependency rule, including before/after a write and later queued mutations. |
| Meter/store/authorization-budget failure | Existing transaction rollback and allocation refusal custody; no ceiling or runtime exemption. Skipped maintenance cannot locally exhaust its former reservation. |
| Aggregate cascades; maintained columns used for authority, identity or expiry | Existing schema rejection remains. No new admitted form. |

The reader classifier is unchanged for counter/ordinal/count/floor/watermark
reads, builtins, whole-row values, explicit helper returns, compound builtins,
non-receipt-index loops, untaken branches, aliases and ordinal-keyed writes.
Only the maintenance edge is refined. Frozen values cannot supply evidence to
a later prediction: their fields, keys and aggregate existence remain in the
transitive dependency closure.

## Tests and validation

| Affected check | Result |
| --- | --- |
| `snapback4-lang --test declarative_receipts` | 169 passed, zero ignored; all RY escape cases plus thirteen RP cases |
| `snapback4-lang --test guide` | 112 passed; maintained-view card remains within its existing 879-line limit |
| `snapback4-core row_view` | 58 passed |
| Language row_keyed_views | 46 passed |
| Device delivery, readauth, sequence_by, sequence_disclosure, unread_range, expiring_mutations, w13g_probe | 280 passed |
| Client social-starter, delivery-integrated and unread-range files | 79 passed, zero skipped/cancelled |
| CLI calibration reproduction | 20 successful invocations across main/RP and with/without view |
| Docs budget, client build/typecheck, reference audit | Passed in affected checks or full-suite opening stages |

RP's reduced calibration-shaped fixture exercises all four named mutations,
nullable media, both expiring and non-expiring sources, pending history,
unchanged raw counts, durable restart, three queued sends, a second device of
the same user, a different settled ordinal, server refusal, stable-id edit and
delete rollback, join/create settlement, and absence for a provisional member.
The expiry adversary reads beyond a settled source's expiry while another send
is pending: it observes the marked settled snapshot, then the exact live zero
after withdrawal. Static cases cover count-dependent writers/returns, cap keys,
target constraints and loops on ordinary indexes. Two more both-store cases
cover inherited totals with a stored value and the validated raw-schema
parent-key form without a cached total. The wasm SDK case independently
checks three pending history rows, frozen/incomplete badges and exact reordered
settlement after a second device sends first.

The RY tests' dependent-read and settlement assertions were retained. Their
former blanket-maintenance expectations now assert that counts stay frozen
while the clean write predicts. The private-column cases now require a sum
writer to queue, but still require count writers to predict and all dependent
followers to queue. The guide census changes only for the new example's three
generated receipt operations and its renamed, group-readable count.

The first diagnostic full run completed with `== 2 failure(s) in 1444 s`.
Its Rust category failed three tests: `unread_range::guide_memory`,
`unread_range::guide_sqlite` (seed rows still used `readUpTo`), and
`row_keyed_views::blind_member_marks_have_identical_meters_bounds_and_changes`
(a reflow split its asserted guide phrase). Its client category failed
`the guide Clique program certifies and expires on wasm after reopen` for the
same old seed field. All four were introduced by the documentation change,
corrected, and passed in affected reruns. Counts/expiry/reopen assertions were
kept; no timeout or test was weakened. The first run's client models passed
79/79. No failure has been attributed to unmodified main.

The affected run before the empty-ID refinement passed 167/167 in 214.83 s. A concurrent
guide compilation captured an intermediate 880-line card and failed its 879-line
budget; the finalized card is 879 lines and the subsequent guide/row-view run
passed 112 + 46 tests. This report retains that development failure.

The second full attempt passed its Rust/build stages but was deliberately
stopped during clients (exit 143) after the empty-id adversary exposed the
metadata cursor hole above. It has no completed-suite verdict. Only the owned
suite process was signaled; its own cleanup handled its child commands. The
final table-presence fix passed 169/169 receipt tests in 210.78 s, 280 device
tests and 79 client tests before the fresh full run below. The wasm SDK case
now starts its queue with an empty message id too.

The final full run's Rust stage passed in 478 s: the runner's result summaries
report 4,779 passed, zero failed and 34 existing ignores. Both app typechecks
and all nine fixture-wrapper tests passed. The client stage passed in 590 s:
6,035 passed, zero failed/cancelled and 11 existing skips, including the new
wasm SDK witness. All 79 client-model tests passed in 302 s, with zero skips or cancellations.

Final command (from the repository root):

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh
```

**`== 0 failure(s) in 1420 s`**, exit 0. No remaining failure to name on
unmodified main; the four introduced first-run failures and the subsequent
adversarial fixes are resolved. Existing ignored/skipped tests were retained;
no new test is ignored or skipped.

The same 1,829 selected source/test/build/wasm-budget files were hashed before
and after this run, with no changes. SHA-256 of the sorted hash manifest:
`de14c587ca21c9c7f879a3b41f9d79bd35c3580ef82fcd2a8e6cc4c3ff1fb6e6`.
Reports and the required journal append follow qualification. The clean main
control worktree also remains unmodified.

## Wasm

Locked `scripts/build-wasm.sh`: **2,051,596 B raw / 618,306 B gzip**.
Inherited ceiling: **618,040 B**. The final cap is exactly **618,306 B**,
**+266 B with no new headroom**. The added shared device behavior suppresses
receipt-derived maintenance and checks overlay metadata before recounts; the
capability prevents old-device misexecution. This is a whole-artifact result,
not component attribution or a rebuilt-main comparison. The full-suite build
confirmed the same size. Rust 1.97.0, wasm-bindgen 0.2.127 and locked Binaryen
132.0.0. Runtime meters and existing test counts/timeouts are unchanged.

## Orientation, documentation and evidence

Applied `llp-orient` after initializing the pinned small `vendor/llp` submodule.
Governing context: LLP 3000 and the adopted 2000.000 brief; LLP 3000.022 §14.3
(receipt prediction/custody); LLP 3000.015 §3 (row-keyed maintenance, authority,
live certification); LLP 3000.020 §3 (device suffix counts); the current compiled
receipts and maintains cards. No Snapback 1–3 bootstrap/inventory gates apply.

Updated LLP 3000.022's static rule and dated revision, the receipts prediction
paragraph, and the compiled unread example in `guide maintains`. LLP 3000.015
now points to the receipt specialization. The report and append-only journal
record the same decision. Hand-off: none.

Development failures were corrected rather than skipped: old blanket-rule
assertions; newly added test syntax/metadata and optional-field normalization;
an authority probe missing its synthetic id; guide example notes, line budget
and census; inherited-aggregate fixture syntax and the missing synthetic value;
and the measured wasm overrun. The final affected results above
supersede those exploratory runs. Full-suite failures are recorded separately.

Raw logs and build artifacts remain outside git under `/tmp/rp-*`; this report
retains their bounded summary and the regressions retain executable evidence.
No new file over 256 KB, gzip or video is committed. The existing oversized
`JOURNAL.md` receives only the requested dated append.

## Round 1 — 2026-10-03

Both round-0 reviews were NOT READY. Read the complete Astra and Grok reviews
under `../reviews/rp-r0.*.md` and Astra's reproductions under
`/tmp/rp-review-astra-20261003`. This revision fixes both blockers and the
reader behavior findings. All work stayed on eb1000; no Apartment mini,
office M1, M5, push or publication.

### Compatibility and authentic predecessor fixtures

New serialization still stamps `receipt-derived-prediction-v1`, including
receipt-derived parent columns after private maintains are projected away.
The reader accepts its absence in the older representation: the existing
`receipt_dependencies` closure is not evidence that RP emitted the schema.
Unknown capabilities, other missing capabilities and malformed/multiple
carriers retain their refusal checks. This changes no receipt fingerprint.

The fixtures in
[`crates/snapback4-lang/tests/fixtures/rp-predecessor`](../../crates/snapback4-lang/tests/fixtures/rp-predecessor/README.md)
were generated by the actual **a8c20c40e9** compiler, core and memory/SQLite
device implementations in the clean `../rp-baseline` worktree. Only a temporary
test harness was added, then removed. Their backend has the authentic old
capability set and classifies `send` as never. Each device holds the old
backend, server incarnation/clock, acquired message `m1`, delivery debt `[1,1]`,
and pending outbox write `alice7`. The server database holds the matching
settled store. SQLite was vacuumed to 1,024-byte pages with its entire SQL dump
asserted unchanged; each new fixture is below 256 KB. The README records
commands, byte sizes and SHA-256 hashes. These are not current blobs with a
capability renamed or removed.

The native regression opens the old server, adopts the current schema, then
opens both devices through **Kept, Initial and Install**. It checks unchanged
incarnation, queued id and debt; admits a fresh predicting send; settles the
old and new writes; obtains exact count 3 and debt `[1,3]`; reports those
positions and clears the delivery queue. Direct `Engine::new` installation
into the old database is covered separately. The wasm regression reopens the
real memory persistence batch in all three modes, adopts a newly compiled
backend, predicts a new row without collecting it as delivery, and reopens
with both outbox entries intact.

The actual predecessor wasm was rebuilt too. It opens its own fixture, then
rejects the backend emitted by the RP compiler with `E_SCHEMA_CAPABILITY:
receipt-derived-prediction-v1`. Evidence is `/tmp/rp-r1-old-reader-qualified.log`;
this is separate from the retained unknown-capability unit test.

### Resource refusals remain effective

Deferred row-keyed maintenance now reserves before skipping the predicate or
target write. Source writes pay `reserve_row_view` for two parent groups:
**fanout × 4 written rows**, plus its existing examined/step/index/output/heap
allowances. Member writes pay the one-recipient reservation and bounded recount
allowance. Member writes also retain the member/source-group authority check;
source writes do not run that member-write check. Ordinary write authorization
still applies to both.

The defensive `E_VIEW_KEY` recipient cap check uses only parent/expiry index
keys, without loading a receipt field or a maintained value. It examines at
most cap + 1 live keys per affected group. A malformed restored watcher group
exceeding its cap is a regression on both stores. Valid member mutations still
have their ordinary cap constraint; as with any local check, unheld or later
server changes are not locally observable.

Public non-row-key aggregates retain `reserve_maintains`. Inserts ordinarily
charge actual selected work on the server; a deferred device insert cannot
select that work and conservatively pays the same fixed worst-case reservation
used for update/delete. That can queue a device write earlier than the server
when fewer targets actually contribute. It never evaluates a receipt predicate
to decide its charge.

An added adversarial test found another instance of the blocker: **30 sends
feeding ten private parent counts** predicted on both devices while the server
refused `E_BOUND`. The pre-fix failure is recorded in
`/tmp/rp-r1-column-before.log`. Private formulas are absent from device schemas,
so merely restoring the public reservation was insufficient. The public schema
now retains `receipt_column_costs`, a source-keyed map of fixed reservation
prices: `[steps, index_entries, examined, rows_written, heap_bytes]`. The server
and compiler use the same reservation calculation; when a source has a
receipt-derived private maintain, the price includes all private sibling
maintains charged by that source attempt. Devices charge these prices without
receiving private formulas, reading totals or applying a mirrored delta. The
single-send positive test stays predicting; the burst now queues on memory,
SQLite and wasm. Sums and all existing read fences remain unchanged.

Regression controls include: one row-keyed count succeeds at 202 server rows;
six counts refuse; the ten-message row-keyed burst refuses; a burst feeding 50
distinct public receipt-derived counts refuses; and the private-column burst
refuses. Refused predictions leave no provisional rows and preserve allocation
refusal custody. No runtime ceiling or existing test expectation was weakened.

### Group-specific readers and rendering

For each target/query, collect ordinary keys from overlay metadata and one
point read per touched row. An insert contributes its current group; a delete
its base group; an update both. Member overlays use the same rule, including
both sides of a move. Empty ids are included. The cache is shared across point,
scan and live-aggregate reads, and invalidated on writes.

Only dirty groups freeze. An unrelated conversation remains complete and its
count expires while another conversation has a pending send, edit, deletion
or join, including after restart. A clean member-point count also remains
complete. Ordinary aggregates obey the same group boundary when their source
coverage is complete. Source history is never scanned to determine dirtiness.

The conservative whole-target fallback is limited to computed/receipt-owned
group keys, missing ordinary key fields, or a touched row with neither base nor
current image (for example an insert then delete). An unpinned scan has incomplete
query coverage if any group is dirty; each clean returned row still uses its
live count. The overlay metadata tests cover moves, deletes, inserts and empty
ids on both stores.

The existing answer flags cannot distinguish all incomplete causes after a
scalar projection. A dirty snapshot can be too high after expiry, so **all
incomplete receipt-derived badges render as a stable number with a quiet
refreshing indication, never `L+`**. The latter is documented only for a live
lower bound on a view without receipt dependencies. No new client-contract
field or ambiguous lower-bound claim was introduced.

The instrumented query reads the same target three times. With 16 or 512 settled
messages and 1, 8 or 32 pending sends it performs exactly **1, 8 or 32 source
point reads, zero source scans**, once per target/query. Representative eb1000
query times are about 0.12–0.19 ms on memory and 0.23–0.34 ms on SQLite. These
are elapsed fixture measurements, not latency guarantees. The executable
assertion is the O(pending) point-read count independent of history length;
raw observations are in `/tmp/rp-r1-derived-qualified.log`.

### Wasm and validation

Both artifacts were built on eb1000 with Rust 1.97.0, wasm-bindgen 0.2.127 and
locked Binaryen 132.0.0, using `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
bash scripts/build-wasm.sh` and the script's gzip -9 measurement.

| Artifact | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| a8c20c40e9, unmodified base | 2,048,676 | 617,327 |
| RP round 1 | 2,069,537 | 623,434 |
| RP minus base | +20,861 | **+6,107 (+0.99%)** |

The budget is **623,434**, exactly the measured size, +5,128 over round 0's
618,306 with no headroom. The bytes pay for compatible old-schema decoding,
per-group overlay keys and all three forms of reservation preservation.
The compact column-price tuple saves 95 gzip bytes versus resource objects;
no public answer flags were added. Build logs are `/tmp/rp-r1-wasm-base.log`
and `/tmp/rp-r1-wasm-tuple.log`. No wasm/gzip artifact is committed.

Affected checks on eb1000:

| Check | Result |
| --- | --- |
| `declarative_receipts`, including every RY escape regression | 182 passed |
| Guide / row-keyed view language tests | 112 / 46 passed |
| Core row-view tests / maintained-column review tests | 58 / 4 passed |
| Device library, delivery, read authorization, sequence, unread, expiry and W13G tests | 340 passed |
| Four affected client files, including wasm upgrade and private-count charge | 81 passed, zero failed or skipped |
| Final derived-prediction checks after compact prices and fixture regeneration | 26 passed |
| Calibration #29 CLI `check` and four `why` invocations | All five passed; all four mutations eligible |
| Actual predecessor wasm against an RP-emitted backend | Opens old fixture; refuses new capability |

The CLI now says affected groups report incomplete until settlement. Logs are
`/tmp/rp-r1-{lang,core,columns,device,client,derived,cli}-qualified.log` and
`/tmp/rp-r1-old-reader-qualified.log`. The final full suite below also includes
the entire receipt suite after the last implementation and fixture changes.

Final full suite on eb1000, exit **0**:

```text
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh
== 0 failure(s) in 1469 s
```

Rust unit/integration targets: **4,794 passed, zero failed, 34 existing ignores**;
doctests: **17 passed**. Clients: **6,037 passed, zero failed, 11 existing skips**;
serial client models: **79 passed**; fixture wrappers: **9 passed**. The build,
wasm budget, release guard, docs budget, package and app typechecks also passed.
No full-suite failure needed an unmodified-main exception. No existing test,
runtime ceiling or timeout was weakened. Full log: `/tmp/rp-r1-full-suite.log`, SHA-256
`7e56c92c79bb52dd38fa07ae57747aa489c7de32bb9864f00db23a9bf55f7c53`.

The qualification manifest covers 1,839 source/test/build/budget files.
Implementation and test inputs remained unchanged throughout the full run.
During the run, one prose-only clarification narrowed a second, previously unqualified
`L+` sentence in `guide maintains`; the complete **112-test guide suite** passed
again (`/tmp/rp-r1-guide-final-prose.log`). Its 879-line budget is unchanged.
All other 1,838 hashes match the pre-run manifest. Final manifest SHA-256:
`6b45dcd6d772c5aef914d16d165c65fd70ba9eeb491152b3b38ee050c57a9430`.
The full-run wasm SHA-256 is
`06cbcbef9ad72f8d1fcf0a01af3dcd462e642434c7e7203325ba24ea66daac0b`,
identical to the paired measurement above.

`./ref-check --verbose` passes: **527 LLP docs, 10,293 refs in 33,920 files,
zero errors, zero unchecked** (`/tmp/rp-r1-refcheck-qualified.log`). Final
whitespace and artifact-size checks pass. The report and requested append-only
JOURNAL entry retain the bounded evidence; raw logs, builds and temporary harnesses
stay outside git. Nothing is pushed or published.


## Round 2 — 2026-10-03

Addresses the six findings in `~/sb4-intent/reviews/rp-r1.astra.md` and
`rp-r1.grok.md`, starting from Round 1 commit `770dbef5a1`. All execution stays
on eb1000. No Apartment mini, office M1 or M5; nothing pushed or published.

### Reservations on every predicting source write

The online-only row-view early return now follows its fixed reservation. A
source write pays `fanout × 4` written rows even when the target has no sync
clause. Member writes also reserve before the online-only skip. This uses
schema prices; it reads neither an unheld recipient nor a receipt predicate.
The existing synchronized recipient-cap check and maintenance behavior are
unchanged. Six online-only views with fanout 50 now queue without a provisional
row on memory, SQLite and wasm. The one-view control still predicts.

The media list-slot walker and reservation moved from the SQLite-only asset
module to the shared interpreter. Every device source-write attempt charges
**2 written rows, 4 examined, 8 steps and 16,384 transient heap bytes per declared
image/video list slot**, including null, empty and unchanged cells. Optional
and nested lists use the existing recursive declared-maximum formula; scalar
media contributes no list slots. The server's formula, scratch admission and
ledger operations are unchanged. Devices receive no asset ledger. Existing
per-attempt heap release also releases this reservation on the device.

These are runtime bounds, not static `predicts: never` classifications. The
schemas remain eligible; oversized receipt writes keep their allocation-refusal
custody, with an empty prediction and no provisional history. Ordinary writes
without receipt allocation retain their existing immediate known-input
`E_BOUND` refusal instead of gaining a new outbox policy.

| Regression shape | Device outcome | Server written rows / outcome |
| --- | --- | --- |
| One online-only row-keyed receipt count | Predicts | 202 / sent |
| Six online-only counts | Queues, no row | 1,202 / `E_BOUND` |
| Row-keyed unread send, null image or video list `<=480` | Queues, no row | 1,162 / `E_BOUND` |
| 16 receipt messages, null image list `<=32`, no view | Queues, no rows | 1,054 / `E_BOUND` |
| Same burst with public count | Queues, no rows | 1,069 / `E_BOUND` |
| Same burst with private count and video list | Queues, no rows | 1,048 / `E_BOUND` |
| Single receipt message, null image list `<=480`, no view | Predicts | 962 / sent |
| Single receipt message, null image list `<=512`, no view | Queues, no row | 1,025 / `E_BOUND` |

The table's cases run on both native stores and wasm. Additional native tests
remove the receipts clause entirely: an ordinary 480-slot insert predicts and
commits, while a 512-slot insert and a 16-insert/32-slot mutation refuse on
both sides and leave zero rows. No upload or populated list is needed for any
counterexample. No ceiling, timeout or existing expectation was weakened.

### Old stores and stripped current schemas

Missing `receipt-derived-prediction-v1` remains accepted for opening authentic
old blobs, but no longer grants prediction eligibility. Decoding a receipt-
maintenance schema without it downgrades **all mutation facts** to `never`.
The same downgrade applies to a public projection with receipt-derived parent
columns and an absent/empty `receipt_column_costs`, even if its stamp remains.
Full schemas recompute their private prices from the authoritative formulas.

This is deliberately broader than finding exactly the affected operations:
private write footprints are unavailable during public-schema decoding. An
unrelated mutation in such an old/stripped backend also queues until normal
adoption of a current stamped/priced backend. Queries, server execution,
outbox custody and delivery debt are unaffected. Authentic predecessor fixture
tests still cover Kept, Initial and Install on memory and SQLite; the wasm
upgrade and restart witnesses still pass. Those fixtures were not modified.

New regressions remove (1) stamp and prices, (2) stamp alone, and (3) prices
alone from a genuinely current ten-private-count projection. Both native stores
and wasm queue without provisional rows. The wasm test also submits a small
send, proving the downgrade itself rather than merely the burst ceiling.
Adopting the intact backend restores ordinary send prediction while the
30-message burst still queues at its legitimate reservation. Other capability
checks stay exact. Arbitrarily forged nonempty compiler price maps remain
outside the trusted-backend contract; this change closes the absence waiver,
not a new untrusted-schema execution surface.

### Canceled rows and unread rendering

Before a predicted delete removes its last image, the device stores just the
ordinary group-key fields needed by receipt-dependent maintained targets in
transactional overlay metadata. Receipt-owned/derived fields, guessed ordinals
and unrelated payload are excluded. The rollback base remains unchanged.
If both base and current images are absent, the group lookup uses these saved
keys rather than marking the whole target. Settlement/replay and reset clear
the metadata with the overlay, including refusal rollback.

Both-store regressions cover separate insert/delete mutations, a same-mutation
insert/delete, empty ids, reopen between reads, refusal settlement and metadata
cleanup. Conversation `c` retains its pending settled snapshot while `d` stays
complete and expires independently. The test asserts the saved row contains
only `conversation`. The wasm social-starter witness adds a canceled insert
without changing its existing unread-count assertions and keeps another
conversation complete. A canceled row adds at most one metadata point lookup
after its empty current-row lookup; there is no source scan and the per-target
query cache remains O(pending). No new independent latency claim is made.

The conservative whole-target fallback remains for computed/receipt-derived
keys, missing group fields, or an older no-image overlay with no saved keys.
LLP 3000.020 §§3.3, 3.6 and 4 now explicitly exempt receipt-derived unread
badges from `L+`. Every incomplete receipt-derived count renders a stable number
with a quiet refreshing indication, since expiry can make its settled snapshot
too high. The exception applies when the range is uncovered as well. Online
fallback and the existing answer contract stay unchanged.

The affected design audit covered LLP 3000 §7, 3000.022 §14.3, 3000.019 §3.5,
3000.020 §§3.3/3.6/4, 3000.015 §3 and 3000.007.001's private reservation rule.
The first three affected child LLPs and both guide cards now agree on prices,
old-backend decoding, saved keys and snapshot rendering. The RY read fence,
receipt-derived sum refusal and server-authoritative settlement are unchanged.

### Wasm and affected validation

Locked Linux build on eb1000: Rust 1.97.0, wasm-bindgen 0.2.127 and Binaryen
132.0.0, through `scripts/build-wasm.sh` and its gzip -9 measurement.

| Artifact | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| a8c20c40e9, same-host unmodified base rebuilt in Round 1 | 2,048,676 | 617,327 |
| RP Round 1 | 2,069,537 | 623,434 |
| RP Round 2 | 2,072,900 | 624,929 |
| Round 2 minus Round 1 | +3,363 | **+1,495** |
| Round 2 minus original base | +24,224 | **+7,602 (+1.23%)** |

The new cap is **625,059 B = 624,929 measured Linux + 130 macOS allowance**,
+1,625 over Round 1's cap. The budget file records actual host offsets of 108
and 127 bytes and the later 110–130-byte convention; this uses the upper 130
with no additional discretionary padding. No macOS build was run or claimed.
The whole-artifact growth pays for shared media/online-view charges, the decode
downgrade and durable canceled-row keys; it is not per-function attribution.
The initial build exceeded the old cap as expected; the final full suite checks
the new cap. Raw/gzip artifacts stay out of git.

Affected checks on eb1000:

| Check | Result |
| --- | --- |
| `declarative_receipts`, including all RY escape tests and authentic predecessor upgrades | 192 passed |
| Guide / row-keyed view language tests | 112 / 46 passed |
| Core row-view / maintained-column review / asset-column tests | 58 / 4 / 3 passed |
| Affected device library and integration suites | 340 passed |
| Social starter, delivery integrated, unread range and receipt upgrade clients | 84 passed, zero failures or skips |

Logs: `/tmp/rp-r2-{lang,core,columns,assets-core,device}-qualified.log` and
`/tmp/rp-r2-client-final.log`. The client run includes all five old-backend/R2
wasm tests. The new social fixture initially attached its delete rule to the
wrong table; correcting that test setup passed the targeted witness and then
all 84 selected clients. No product exception is taken for that resolved error.

Final full suite on eb1000, exit **0**:

```text
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh
== 0 failure(s) in 1442 s
```

All 1,000 Rust test executions completed: **4,804 passed, zero failed, 34 existing
ignores**; doctests: **17 passed**. Clients: **6,040 passed, zero failed, 11
existing skips**; serial models: **79 passed**; fixture wrappers: **9 passed**.
Cargo/wasm builds, release guard, docs budget, package build/typecheck and both
app typechecks passed. No full-suite failure required an unmodified-main
exception. The full run retains every existing test and all RY escape cases.

Full log: `/tmp/rp-r2-full-suite.log`, SHA-256
`54caa82417b00352bc815ef0c45a342751b6ce6b34d6ff432cd979365bbd4582`. The qualification manifest covers
**1,841 source/test/build/budget files**; every path and hash remained unchanged
through the full run. Final manifest: `/tmp/rp-r2-qualified-source-final.sha256`,
SHA-256 `3d11f3e1b32dcdb6317f06cfb8e85be3e7fd7ffcda7b24e8a035378b38c45306`.
The full-run wasm SHA-256 is
`75f7999b771100a63cfec4c19037884090c3cafc3b355a4a7c40de67f0d75b1b`,
identical to the measured artifact above. Its budget check reports
`wasm 2072900 B raw, 624929 B gzip (budget 625059: ok)`.

`./ref-check --verbose` passes: **527 LLP docs, 10,295 refs in 33,922 files,
zero errors, zero unchecked** (`/tmp/rp-r2-refcheck-final.log`). Whitespace and
new-artifact checks pass. No new file is over 256 KB, and no gzip, video or wasm
artifact is committed. The existing append-only JOURNAL receives the requested
entry; logs and build outputs stay outside git. Nothing is pushed or published.
