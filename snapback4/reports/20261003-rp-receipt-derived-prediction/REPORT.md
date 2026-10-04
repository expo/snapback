# RP — receipt-derived maintenance and prediction

2026-10-03. Branch `sb4-intent/rp-receipt-derived-prediction`.
Base: `a8c20c40e986f8af98f4579386bdb80b9fa7f69e` (unmodified main at lane start).
The initial sections record round 0. **Round 1 below supersedes its compatibility,
reservation and table-wide pending behavior**, and records its qualification.
**Round 2 supersedes Round 1's remaining reservation gaps, permissive capability
waiver, canceled-insert fallback and exact-Linux wasm cap.**
**Round 3 supersedes the remaining partial reservations and blanket legacy downgrade
with complete shared prices and program-specific compatibility.**
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

## Round 3 — 2026-10-03

Round 3 replaces the partial receipt-only prices with a complete source-write
reservation plan. The missing ordinary private-maintain charges, online-only
public aggregate work and receipt counter update charges **predated RP**. They
also affect ordinary predictions or receipt sends without an unread view; RP
made them reachable through newly eligible unread-maintaining sends. The blanket
legacy downgrade was introduced by RP and is narrowed here.

### One source-price calculation

`core/schema/reservations.rs` computes each source's complete fixed plan, and the
compiler and authoritative engine call these same functions. Compiler prices are
refreshed after planner-added indexes. All-zero schemas retain their legacy
bytes and derive their exact zero prices from complete visible declarations;
all other schemas export every source. The public projection retains source
prices and omits private formulas, private target names, predicates and totals.
The old `receipt_column_costs`, duplicated private formula, separate asset-slot
reservation module and row-view reservation formula are removed.

The plan keeps separate phases rather than adding all dimensions at function
entry: an unsuccessful insert arm must not pay for a successful counter update,
and transient scratch must retain its existing lifetime. All seven dimensions
are represented: steps, indexes, examined, rows written, heap, output and rule
probes. The audit of reservation entry points is:

| Entry point/work | Shared device/server rule |
| --- | --- |
| `reserve_columns` | Every private maintain, receipt-derived or ordinary, including no-receipts schemas; same four-row mirrored-write allowance per maintain and declared scratch/index work. |
| Declared media lists | Same recursive optional/nested slot walker and 2 rows / 4 examined / 8 steps / 16,384 heap bytes per slot, regardless of null/empty cell and without device asset custody. |
| `reserve_maintains` | The device skipping receipt-derived/online-only public deltas pays the shared server worst-case reservation, also on insert. Existing server fixed reservations are unchanged; ordinary insert delta work can cost less. Synced ordinary deltas keep their shared path. |
| Row views | Shared source/member prices before any skip, including online-only targets; source fanout × 4 rows plus all other dimensions, member bounded recount allowance and ordinary-key recipient-cap check. |
| Receipt allocation | Both hosts pay a fixed 51-key allowance (steps, examined, indexes) before allocation; only the server counts actual recipients. |
| Receipt counter replacement | Both hosts pay one written row, two steps, declared scope scratch and scope list slots. The server alone executes the replacement in the existing restoring authorization scope. No device path consumes the provisional ordinal there. |
| `reserve_capture` | Shared declared read-through capture price; capture, parent authority and lifetime checks still run on both hosts. |
| Target resolution, write-rule and sequence authorization | Existing common entry points still run on both hosts, including input-dependent patch/copy/witness prices. They are not skipped. |
| Recorded captures, constraints, output, partition/source writes | Existing common interpreter paths remain; recorded activation, timeline edges and generated receipt reports keep their existing server-only fences. |

A receipt counter scope with field-write authority, through/recorded/sequence
hooks, a counter index, nontrivial constraints, downstream maintenance or timeline
hooks makes its source writers `never`. Those effects cannot be priced as a
simple counter replacement. Canonical uniqueness, unchanged text/ordinary
immutable fields and insert-only final-exists obligations are safe. RY's
receipt-derived sum fence remains. Ordinary private sums retain their pre-existing
prediction contract and fixed resource reservation; the resource-admission
property is not a promise against semantic refusal or concurrent server changes.
No execution ceiling is raised.

Online-only ordinary counts remain eligible when their reservation fits. The
six-hundred-insert case now queues on the device and fails server admission after
1,025 rows. The device pays the exact shared reservation formula rather than
evaluating unheld totals; the server preserves its existing actual-delta charges
where no fixed reservation is required. Thus a device may queue earlier. A bound after
skipped maintenance rolls back the whole prediction and retains the outbox entry.

### Differential and regression evidence

Seed `0x525020261003`, a fixed 64-bit LCG, generates 256 schemas/mutations per
store. It varies receipts, zero/one/two/ten private counts or sums, zero/one/two/six
public aggregates, row/non-row keys, synced/online-only targets, declared slots
from 0 through 512, bursts from 1 through 600 and a second source with up to 30
writes. Each case prints its seed, ordinal and complete parameter tuple; failures
also print its schema. It compares admission with actual server-engine execution
under `Ceilings::default()`. Every predicting case must commit on the server;
this is stronger than checking only resource refusal codes for these fixtures.
Every compiled plan is also compared with the authoritative schema's shared
calculation.

Both stores give the same result: **58 predicted commits, 8 conservative queues
whose server commits, 190 server refusals**. Conservative queues are **3.125% of all
cases, 12.12% of server-committing cases**. There are no predicted server refusals.
Six queues retain RY receipt dependencies; two pay the shared upper reservation
for skipped public delta work that happens to cost less on the server.
The successful predictions include 26 receipt cases, 43 private-maintain cases
(8 private sums), 5 public non-row sums, 16 online-public cases, 5 row-view cases,
35 media-list cases and 42 multiple-source cases; these categories overlap.
The differential therefore exercises admission, not just universal queuing.
Log: `/tmp/rp-r3-differential-qualified.log` (7 tests, 16.31 s).

All six review shapes queue with zero provisional rows on memory and SQLite,
and are included in the wasm corpus:

| Shape | Server `E_BOUND` rows |
| --- | ---: |
| Five receipt messages, unread view, ordinary private shelf count | 1,030 |
| Five receipt messages with unread view, fifteen plain notes | 1,025 |
| Receipt send, 510 declared slots, ordinary private count | 1,025 |
| No receipts, 510 declared slots, private count | 1,025 |
| No receipts, ten private counts, 26 inserts | 1,025 |
| Online-only ordinary non-row count, 600 matching inserts | 1,025 |

`rp-reservation-cases.json` contains these six shapes plus the first sixteen seeded
cases: schema text, authoritative initial snapshot and expected admission outcome,
not a fabricated backend. Its outcomes are 5 predicted commits, 2 conservative
queues and 15 server refusals. A Rust test re-executes the server and byte-independent
JSON-compares the corpus on every suite run. Wasm gets a freshly compiled backend
from the real server and replays those snapshots. The fixture stays below 256 KB.
Regeneration uses `UPDATE_RP_WASM_CASES=1`; ordinary suite runs only verify it.

### Selective legacy decoding

New schemas carry `source-write-reservations-v1` as well as their existing
capabilities. Genuine old representations without prices keep their old wire
shape on decode. Full visible declarations can reconstruct the price on demand;
a private projection cannot invent the missing source footprint.

Backend decode and runtime preflight inspect each expanded mutation's complete
write inventory, including helper expression blocks, selection inputs and merge
lanes. Receipt-source writes and legacy hidden effects queue, existing read
fences remain, and a source with no complete recoverable price queues. An old
private projection without a map conservatively queues all writers because it
cannot identify hidden effects. Unrelated fully priced programs stay eligible.

Memory and SQLite Kept tests preserve an ordinary post and a conversation-title
edit, with both ordinary and expression-block receipt sends still queued. The
client test calls the actual SDK `openLocalDevice` with a new backend available
and an unstamped kept backend in real wasm persistence: it opens Kept first,
predicts the unrelated writes offline, and queues the send without a pending
history row. Authentic a8c20c40e9 fixtures remain unchanged. Strict capability-set
assertions now include the additional required capability. The byte fixture
comparison verifies and normalizes only the newly versioned price metadata;
every pre-existing schema field and emitted TypeScript byte remains compared.

### Qualification

The initial full run was stopped after finding legacy-byte and server-meter
regressions. Their unchanged codec/fixture/meter/boundary tests now pass. The
obsolete pre-fix affected run was also stopped after final Rust qualification;
neither interrupted run is used as qualification. The durable schema
compatibility test verifies the new prices against the shared calculation, then
retains every pre-existing schema/type byte comparison; its historical fixture
files remain untouched. The guide fits its existing line cap without raising it.

Final eb1000 command:
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`.
It exited **0**, reporting **`== 0 failure(s) in 1489 s`**:

- Rust unit/integration: **4,811 passed**, 34 existing ignores, across 1,000
  scheduled targets; **17 doctests passed**. This includes all **199 receipt
  tests**, every RY escape, native upgrade modes, group/expiry cases and the new
  seeded differential. Rust stage: 513 s.
- Client pool: **6,063 passed**, 11 existing skips; stage: 609 s. All 22 wasm
  differential/regression cases and the actual SDK Kept-opening test passed.
- Serial client models: **79 passed**, including the three 5,000-sequence
  session models; stage: 323 s. Fixture wrappers: **9 passed**.
- Wasm build/budget, docs budget, release guard, package build/typecheck and
  chat/Expo checks all passed. The separate affected client run passed **41**
  tests; the targeted differential run passed **7** tests.

No failure requires an unmodified-main exception. All **1,850** source/test/build
qualification inputs remained unchanged throughout the final full run. Staging
then found one extra terminal blank line in `core/src/ir/writes.rs`; removing it
was the only post-run source edit. A fresh pinned wasm build remained byte-identical
(SHA-256 below) and passed the budget. The committed-source manifest records this
one-byte whitespace cleanup separately from the tested-source manifest.
`./ref-check --verbose` passes (527 LLPs, 10,296 refs, zero errors/unchecked),
and `git diff --check` passes.

Evidence remains on eb1000; logs are summarized here rather than committed:

| Evidence | SHA-256 |
| --- | --- |
| `/tmp/rp-r3-full-final.log` | `ea26663bcf7427a2ead6ff25bb1978b43f16491c8424f7cb88b9baa72842539e` |
| `/tmp/rp-r3-differential-qualified.log` | `aedb7f7e66b0a743791c58fbc4274c8961da0527f709fdbcd18aca7c891bdd7d` |
| `/tmp/rp-r3-client-final.log` | `517d2972f1ada0be3456426b057b021168629be0015c2ef5cb09d4b96d56489d` |
| `/tmp/rp-r3-final-source-start.sha256` | `e2682f7f4401f0e3b8b832fe45af7ddb033e4c8a2542e182808d7947614cf876` |
| `/tmp/rp-r3-final-source-committed.sha256` | `192d9c9feae870ba44dc9cd0682fd152f2f2a8532efff1ae3737d094692f7295` |

Wasm was rebuilt with the pinned Binaryen pipeline on eb1000. The retained
unmodified a8c20c40e9 artifact was remeasured on the same host using the same
filename/gzip command; no Mac was used:

| Revision | Raw bytes | gzip bytes |
| --- | ---: | ---: |
| a8c20c40e9 base | 2,048,676 | 617,327 |
| RP round 2 | 2,072,900 | 624,929 |
| RP round 3 | 2,096,970 | 633,309 |

Round 3 adds **8,380 B gzip** over Round 2; total RP growth is **15,982 B (2.59%)**
over base. The artifact includes complete price serialization/calculation,
shared fixed admission, recursive program write inventories and selective
legacy decoding. This is whole-artifact attribution, not invented per-function
sizes. Budget: **633,439 B**, exactly the Linux measurement plus the existing
130 B macOS allowance recorded in the budget history. The unused partial
reservation code was removed; no additional margin is requested.

Round 3 wasm SHA-256:
`12fc73a709d85518530a2e5dc53e1e8520219ce96612a99b1257f643d5dac5bb`.
Base SHA-256:
`1fd8cd3fdef29bc5038a642e10ba0eb22df841b44ca704d1f0d2d4f5decf0e74`.
Final measured command: `bash snapback4/scripts/build-wasm.sh`; its artifact is
2,096,970 B raw / 633,309 B gzip. The full suite rebuilt and checked the same
artifact and the 633,439 B cap.

All work stayed on eb1000. No Apartment mini, office M1 or M5 was used.
Only processes started by this session were signaled. The commit includes the
requested co-author trailer. Nothing is pushed or published. No wasm, gzip,
video or new file over 256 KB is added; the existing JOURNAL receives the
requested append.

## Round 4 — 2026-10-04

The four review counterexamples now queue without provisional rows on memory,
SQLite and wasm. All four meter omissions **predated RP**: they also occur in
ordinary oversized mutations without receipts. The audit additionally reproduced
pre-existing gaps in omitted effect payloads, Following work rows, and the
already-ticketed six-byte presence conjunction reservation. Those are fixed here
without removing the existing small offline predictions. Runtime ceilings are
unchanged. No existing test was dropped; the ignored conjunction regression is
now enabled.

### Shared execution charges and representation

`birth_columns` pays an exported owner-birth phase before the host split. Each
maintained owner column pays its examined row and declared private image; one
owner-image copy is also charged. Sequence allocation pays one index entry per
uncached counter within the row; commit pays one per declared sequence column,
independently of whether the host stores the counter or computes a provisional
suffix. Parent deletion prepays
three examined rows, three steps and three declared child images per child table.
Only the server touches the authoritative counters and child probes.

`effect_once` is one runtime charge function. It evaluates the actual key on both
hosts, charges one step and its canonical encoded heap, and charges one written
row for a newly seen key. Devices keep an attempt-local set, never durable keys.
A server key from an earlier transaction can make prediction more conservative;
a bound then retains custody with no row. This also works when the payload is a
server-only read: the key and its dependencies remain in the interpreter.

For eligible mutations, the compiler and server share a native-only calculation
for bounded omitted effect statements. Programs already classified server-only
retain their ordinary effect-payload fees. The public schema carries only opaque prices. Both hosts pay
before the server executes the payload in a restoring scope. Declared value
bounds, total expression work, simple point reads and presence bookkeeping are
included. Unpriceable payloads keep their original reads and ordinary residency:
expiring/row-keyed/read-through maintained values, authorization probe graphs,
unknown value bounds and growing loop-carried values are not erased. Ordinary
non-expiring aggregate point reads remain supported. Legacy omitted statements
without a complete price queue. This replaces LLP 3000.013's explicit old
server-only meter exception, rather than keeping that exception in a receipt
mutation. The allowance uses declared maxima, so eligible payload
slices can reach a server ceiling earlier than their old actual-value charges,
including when stored text is short. This is a deliberate admission change on
both hosts, not a claim of preserving every earlier committing resource budget.
Programs already classified server-only retain their ordinary effect-payload fees.

Following Work upserts and omitted partial-event inserts/deletes now have a
shared owned-row reservation, including their source maintenance prices. Scratch
is reused between writes, preserving its peak; output is bounded from supplied
images when available. The Feed duplicate probe has one shared reservation.
Neither private Work rows nor partial event history is created on a device.
Fully held event rows and own copies retain their ordinary write path. The
257-post counterexample now reaches the same 1,025-row refusal, while one-post
controls still predict. The named existing Following/slot tests remain intact.

New schemas always export complete source prices, **including all-zero plans**.
The whole `reservation()` calculator and effect bound analysis are absent from
the wasm build. A missing legacy plan may use a cheap structural proof of zero;
otherwise its writer queues. The v2 capability includes the owner-birth and
maintained-read prices. V1 owner writers with no birth price queue. Kept backends,
queued sends, outboxes and delivery debt still use the earlier authentic upgrade
fixtures; no migration erases them. The explicit-zero wasm control and its
unstamped, provably-zero predecessor both predict.

### Interpreter audit

Scope: `engine/` and its shared helpers, `schema/reservations.rs`, partition
accounting, the device admission path, plus server-feature and wasm-only branches.
The audit searched `device`, `holds_assets`, feature gates and meter/reservation
calls, then traced callers so a skipped physical operation was not confused with
a skipped logical charge. `S/I/E/W/H/O/P` below mean steps, index entries,
examined rows, written rows, heap, output and rule probes. A zero in a price is
intentional; hidden actual work cannot add a later logical charge outside its
restoring reservation. Administrative work and query-only paths are called out
explicitly.

| Host-dependent branch / shared entry | Logical admission and disposition |
| --- | --- |
| `runner::Emit` / `effect_once`: durable `_effect_keys` insert and replay/discard arm | **Fixed R4.** Common runtime S=1, H=encoded key, W=1 for a new key; attempt-local device dedup; server alone claims durable keys. Ordinary emits have W=0. |
| `runner::statements`: `prediction_skips`, including exclusive bindings/coalescing and an emit with `once` | **Fixed R4.** Native shared bound analysis exports S/E/H/P prices; device pays before skipping, server pays before restoring payload scope. Key evaluation stays outside that scope. Missing price queues. Unpriceable work keeps ordinary reads/residency. |
| `prediction::charge_untaken` and `presence` guard/dependency propagation | Ordinary expression/guard fees remain shared; device also evaluates safe untaken work. **Fixed R4:** saved binding slot now charges `64 + name.len()` heap, closing the existing six-byte conjunction deficit. Presence metadata and branch ownership remain unchanged. |
| `presence::needed_setups`, `mark_bindings`, absent-value projection | Server-only proof/selection bookkeeping adds no separate logical fee. `plan_guards`, actual expressions, guard copies and emission copies are metered; untaken-arm coverage remains conservative. Non-effect presence decisions retain the compiler fence. |
| `columns::birth_columns` | **Fixed R4.** BIRTH price charges E=number of owned columns and H=private images plus owner image on both hosts. Only server fetches values. Private formulas stay off devices. |
| `columns::reserve_columns`, private `mirror_column`, rebuild flag | R3 COLUMNS price is shared for every source, receipts or not. Private source/target/owner S/I/E/W/H are prepaid. Mirror work cannot add caller charges. Rebuild/import is administrative. |
| `reserve_assets`, `asset_columns::{with_asset_facts, asset_columns}` / `holds_assets` | Shared ASSETS phase charges each declared list slot: S=8, E=4, W=2, H=16,384, including null/empty/nested/optional cells. Scalar asset lookup/ledger work adds no skipped caller charge. Ledger ownership and availability remain authoritative. |
| `reserve_maintains`, public non-row aggregate `charge_maintain` | Shared AGGREGATES price covers deferred receipt-derived and online-only targets. Ordinary synced deltas execute on both hosts. Server fixed reservation and device fixed reservation use the same plan; known ordinary server inserts can cost less actual work. |
| `maintain_row_views`: online-only or receipt-derived target early exit | R3 ROW_SOURCE/ROW_MEMBER prices precede both exits: full fanout, both old/new groups, predicate steps, indexes, rows, copies and output. No receipt predicate is evaluated on the device. |
| `row_views::{source_delta, member_delta, rebuild_member}`: member authority, source scan, `$basis`/work updates, recount publication, batch optimization | All are inside their row-view fixed allowance. Recipient-cap admission still runs over ordinary keys. Unknown device coverage or incomplete certification queues. Server batch optimization changes physical work inside that allowance. |
| `row_views::live_row_view_inner`, live count certificate reuse | **Fixed R4.** Mutation reads use a shared VIEW_READ allowance (E=1, S=1 and declared source/certificate scratch); server certificate/scan and bounded device recount run inside it. Incomplete device recount queues. Query certificate/cache versus local range evaluation retains its query cut contract. |
| `row_views::live_row_view_inner`, non-live private work-key probe | **Fixed R4.** Mutation devices pay the same E=1 and four index-key scratch blocks before using the settled image. Server-only pending work access is prepaid. Pending answers remain unavailable to a mutation. |
| `live_aggregate_inner` / `backlog_aggregate` | **Fixed R4.** Server backlog shortcut is query-only (including aborting native query calls). Mutation reads use the shared source scan/evaluation path, including expiry. Receipt-derived pending snapshots still cannot be mutation inputs (RY fence). |
| `sequences::{sequence_fields, commit_sequences}` | **Fixed R4.** One I per uncached counter allocation within the row and one I per sequence-column commit on both hosts. Device suffix/coverage work uses its separate bounded allowance; no counter is stored on a device. |
| `sequences` authorization, read-result/provisional selection checks | Common authority/rule reservations precede counter use. Ordinal-based selections, dependent constraints and provisional sequence reads queue through existing fences. Coverage uncertainty cannot authorize a guessed counter. |
| `receipts::receipt_insert_fields` allocation | Shared ALLOCATION price S/I/E=51, before device provisional suffix work or server member allocation. RY ordinal-read/whole-row/loop/builtin fences are unchanged. |
| `receipts::receipt_row_changed` counter replacement | Shared COUNTER price: W=1, S=2, declared counter-image H plus scope slots. Only server replaces it. Extra authority, sequence, capture, index, constraint, maintain or timeline hooks make the source server-only. |
| Receipt reports, membership changes, runs, compaction and builtins | Mutations that read clause-owned/derived state or invoke these operations remain `predicts: never`; there is no device path that silently omits their work. Import/rebuild are separate administrative operations. |
| `through::{reserve_capture,capture_insert}` and parent read/capture | Common CAPTURE phase charges S/E/H/P before reading the parent. Device current-parent proof is extra physical work; unheld/retained evidence queues. Captured values still share ordinary authorization. |
| `through::refuse_live_children` | **Fixed R4.** Common E=3C, S=3C, H=three images per child table. Device current-child check runs under its separate work allowance after prepay; server probes live and physical children. |
| `through::physical_children`, parent expiration and staged cascade activation | Physical-child fee is already common (E=C, S=C, declared H). Activation is server-only and cannot run as an ordinary predicting write. No authored unbounded cascade is admitted. |
| `recorded::capture_*`, live-target and retained-target branches | Ordinary point-read/capture fees are common before host-specific coverage proof. Unknown target queues. Recorded activation is server-only. |
| `write::{insert,update,delete,upsert,insert_if_absent}` and alternate `write_target` resolution | Common source phases, rule room, target scratch, unique/cap checks, immutable/final-exists checks, indexes and output execute on both hosts. Device absence/coverage proof is additional bounded work; unresolved/online targets queue. Read-through insert-if-absent is explicitly refused for prediction. |
| `write` expired predecessors and cap groups | Devices cannot rely on an expired predecessor or missing group. Their proof runs separately; the complete logical reservation remains shared. No device-only skip removes a cap charge. |
| `field_authority`, private field omission and disclosure | Common declared scratch and rule reservations apply before private access. Undisclosed mutations/ownership changes without complete evidence queue. Projection changes the lawful payload, not private reservation prices. |
| `row_changed`, `charge_source_indexes`, word/contribution index changes | Common source index/step fees execute before host log selection, including word-token fanout. Server/private index maintenance is already prepaid by its source phase. |
| `partition::account_row_change<LOG>` / `event_free` | LOG selects persistent events, not ordinary S/I/E/W/H/O/P admission. Audience and field-delivery allowances are shared. Raw born-row/grant bookkeeping is explicitly unmetered engine bookkeeping on both logical contracts. |
| `timeline_enqueue` Work upsert; partial `Posts` birth/removal | **Fixed R4.** Shared owned-row S/I/E/W/H/O plus complete source phases; server physical writes execute inside the restoring reservation; device pays only. Internal H is reusable scratch. |
| `timeline_insert` Feed duplicate probe and foreign-copy branch | **Fixed R4.** Duplicate probe prepays E=1, S=8 and declared row scratch on both hosts. Predictable mapped inserts are owner-authorized; foreign delivery belongs to server jobs/edge work. Own visible Feed insert still uses the shared writer. |
| Timeline follow/unfollow/refollow, activation, backlog delivery/purge | Existing compiler/runtime `never` fence for edge transitions. Administrative adoption and background chunks have their own server admission. Retained/missing event evidence queues. |
| `read::{merge,streaming extrema}`, `authorized_member` trusted search path | **Fixed R4.** Membership/head search optimizations are restricted to query operation kind; a mutation uses the shared merge/read path. Trusted member pricing is reached by that query-only plan. Word expansion itself retains the common ledger. |
| `read` delivered-rule trust, parent pinning, public/private page selection | Prepaid full rule/tree charges remain even when delivered evidence avoids witnesses. Horizon, retained and unknown branches affect readiness/coverage and may queue; they do not replace rule admission. |
| `authorized_point::{scan_authorized, authorized_point}` public/trusted fast paths | Common examined/probe admission; typed disclosure controls retained H. Private decodes use fixed restoring scratch. Server public fast paths do less work; devices may spend more or queue. |
| `witness` expiry index-head shortcut, aggregate/sequence witness coverage | Runs within the common authorization reservation. Device witness scans consume the separate physical allowance and cannot decide logical success from exhaustion. Unknown witnesses queue. |
| `authorized_scan::{prepaid_scan, authorized_scratch}`, `device_work_active` | Logical allowance is charged before the restoring scope. Device-only coverage uses a separate finite meter and maps exhaustion to uncertainty. A nested scope cannot reset the physical allowance. |
| `expiry`, query invalidations, `retire_expired_births` | Ordinary expiry checks are common. Commit-end retirement runs on a separate unbounded bookkeeping meter after the mutation's logical record; it cannot introduce an E_BOUND admission charge skipped by prediction. Sweeps/rebuilds are not predicting mutations. |
| `components`, delivery-origin collection, search decoration and pending query work | Query-only paths (query kind or declaration guard), outside predicted mutation admission. Decoration preserves the caller meter. Query answer completeness/expiry differences remain intentional. |
| Job viewer scopes, native jobs/actions, ephemeral renewals, import/activation | Server-only operations or administrative entry points. Device mutations cannot silently enter them: static classification/runtime refusal applies. Native device queries are read-only. |
| Schema/argument validation and prefetch/storage representation feature gates | Server validation establishes the admitted backend; wasm consumes it. No logical meter call is hidden by these gates. Prefetch and physical SQL/memory adapters preserve the same logical writer/interpreter fees. |

The presence ticket is moved to `issues/closed/`. Its original both-store
boundary assertions are enabled unchanged. One meter golden rises by the six
previously uncharged bytes (3,857 → 3,863); all other fields and admission checks
are retained. This is not a new receipt-specific exception.

### Differential and boundary evidence

The original 256-case seed is unchanged (`0x525020261003`). Round 4 adds 64
cases using `0x52500420261003`, for **320 cases per store**. The added families
include parent deletes, ordinary updates/deletes with maintenance, owner births,
sequence/index fanout, ordinary emits, distinct/duplicate once keys, bounded
private payload reads, and full/partial Following events. Multiple-source and
receipt/no-receipt coverage remains. Each failing assertion prints seed, case,
full schema and server result. No-prediction assertions compare every table
against the acquired pre-admission state, so they also check rollback of earlier
writes and deletions.

The affected reservation group (both-store differential, concrete cases and
server-verified corpora) took **20.71 seconds**.
Each store reports **113 predicted-and-committed / 8 conservative queues that
commit / 199 server refusals**. Thus conservative queuing is 8/320 cases (2.5%),
or 8/121 committing cases (6.61%). This is finite seeded evidence, not an
exhaustive proof over arbitrary programs or changing authoritative state.

| Concrete boundary | Device result (both stores and wasm) | Server result |
| --- | --- | --- |
| Receipt send + 600 owners × 20 maintained columns | queues, no rows | E_BOUND at 8,198 examined; complete owner-birth prepay crosses 8,192 as a group |
| Receipt send + 740 sequenced rows × 17 secondary indexes | queues, no rows | E_BOUND at 16,385 index entries |
| Receipt send + 160 deletes × 20 empty child tables | queues, no rows | E_BOUND at 8,239 examined |
| 1,024 distinct once keys, no source writes | predicts | commits, 1,024 written rows |
| 1,025 distinct once keys, no source writes | queues | E_BOUND at 1,025 written rows |
| 1,024 / 1,025 ordinary emits without once | predicts | commits, zero written rows |
| 1,025 repeats of one key | predicts | commits, one written row |
| Receipt send + distinct once-key burst | queues, no history row | E_BOUND at 1,025 written rows |
| 600 private-profile SHA-256 payloads + an ordinary insert | queues, no row | E_BOUND in shared bounded payload allowance |
| 257 full / partial Following posts | queues, no source or derived rows | E_BOUND at 1,025 written rows |
| One private payload / one full or partial Following post | predicts | commits |

The wasm corpus contains these controls and review shapes and is re-executed by
the real Rust server engine during the suite. It stores source, actual acquired
pages and the observed admission results, not manually invented server verdicts.
The client tests compile each source again and exercise wasm admission. Separate
native tests first claim 1,025 durable keys across two committing transactions,
then show conservative device queuing while the server's all-duplicate burst
commits with zero new rows. Missing legacy payload prices queue on wasm too.

### Verification and size

Affected evidence includes eight Round 4 native boundary/compatibility tests,
eight language effect-slice tests, all 22 presence tests (zero ignores), 43
Following/event-slot/unread-range tests, 81 authority tests, 35 read-through
review tests, the unchanged authoring census and 112 guide tests. The client
reservation/upgrade checks pass; the asset/avatar follow-up passes all 18 tests. The first complete run exposed compatibility regressions in the guide, query
shortcuts, current client fixtures and payload pricing. Its corpus comparison
also caught random ids in the new Following setup; that setup now supplies a
fixed id. These failures are corrected before the final qualification below.
No failing admission assertion was removed.

Same eb1000 host and pinned toolchain, measured with the build script's gzip
command and filename:

| Artifact | Raw bytes | gzip bytes |
| --- | ---: | ---: |
| Retained unmodified a8c20c40e9 base, remeasured | 2,048,676 | 617,327 |
| Round 3 | 2,096,970 | 633,309 |
| Four requested gaps + native-only calculator, before wider audit fixes | 2,088,977 | 630,344 |
| Round 4 | 2,107,138 | 636,469 |

Keeping the full calculator out of wasm saves space, while explicit zero plans
retain ordinary new-schema prediction. The final wider audit costs **3,160 B
more than Round 3**, or **19,142 B (3.10%) over base**. Relative to the isolated
four-gap build, the payload/read prices and Following/presence fixes add 6,125 B.
These are whole-artifact measurements, not independent function attribution.
The budget is **636,599 B**, Linux plus the file's recorded upper macOS offset
of 130 B, with no additional discretionary margin. No Mac was used.

Wasm SHA-256: `a64e6c175828c5f4205f984ca0836df408a6c2a03739845ca7c03b9a9203443b`.
Base SHA-256: `1fd8cd3fdef29bc5038a642e10ba0eb22df841b44ca704d1f0d2d4f5decf0e74`.

The current chat client fixture now carries compiler-equivalent complete prices;
its programs are byte-for-byte unchanged. A Rust test verifies that its schema
matches the native export. Authentic predecessor upgrade fixtures remain frozen.
The old event-slot wasm test separately refuses the full current backend and a
candidate with only reservation metadata removed, so the event-slot capability
itself must still reject installation, adoption and persisted reopen. New
capability-set expectations add v1/v2 without removing the old fence assertions.
The authoring census remains unchanged. The guide's existing 368-line limit holds.

A subsequent full run passed all behavior tests but caught one direct JSON
serializer call in the new native calculator through two codec-census assertions
(`== 1 failure(s) in 1467 s`, client stage). It now uses the existing codec funnel;
all 26 census tests pass unchanged. The final full run was repeated after that fix.
The wrapper produces identical JSON bytes, reservation prices and wasm output.

### Final qualification

On eb1000, with the final implementation and fixtures frozen:

```text
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
== 0 failure(s) in 1470 s
```

Exit 0. Rust: **4,820 passed**, 33 existing ignores; doctests: **17 passed**.
Client pool: **6,088 passed**, 11 existing skips; serial models: **79 passed**;
fixture wrappers: **9 passed**. All **207 receipt tests**, every RY escape,
authentic upgrades, group/expiry cases, the extended differential and both
server-verified wasm corpora passed. The native stage took 521 seconds, the
client pool 592 seconds and the serial models 302 seconds. Build, wasm budget,
release guard, docs budget, package and app typechecks also passed.

All **1,703 qualification inputs** stayed unchanged throughout this final run.
The regenerated wasm is byte-identical to the measured artifact above. Reference
validation passes (527 LLPs, 10,298 references, zero errors/unchecked references),
as does `git diff --check`. **No failure needs an unmodified-main exception.**
Earlier introduced failures are recorded above; none is waived in this result.

Evidence retained locally, summarized here instead of committing oversized logs:

| Evidence | SHA-256 |
| --- | --- |
| `/tmp/rp-r4-full-qualified.log` | `e69aac3d82374eaf4a6deb0c1e3c144cffaba1a38acdcc853a52e7421dc543a2` |
| `/tmp/rp-r4-source-qualified.sha256` | `5f2f6e8a42245d44f921bbb8678a3e15858d4787f1dccd93bf39222bb3fe7296` |
| `/tmp/rp-r4-reservations-final3.log` | `fe3960ed231c7052dbb55c9e480775fde876dcdb12b31aa9af074458cf412629` |
| `/tmp/rp-r4-codec-final.log` | `58ce55d6c183f2eb252a2b376650fea0d98a58e102369426b2cb9bf5962feea7` |

The new corpus is 74,893 bytes. No new file over 256 KB, wasm artifact, gzip or
video is committed; the existing journal receives the requested append. Work
stayed on eb1000. No Apartment mini, office M1 or M5 was used, and nothing is
pushed or published.

## Round 5 — 2026-10-04

### Decision and headroom

Restore the pre-round-4 **actual-value effect-payload behavior on both hosts**,
as expressly permitted by the round-5 task. The server evaluates and meters the
original payload, bindings, reads and presence metadata. The device omits only
the compiler's exclusive, infallible payload slice. Remove the declared-maximum
analyzer, serialized effect-price map and runtime prepaid scopes. This does not
remove the complete **source-write** price plans or any other R0–4 reservation.

The two complete, unchanged calibration backends now predict and commit a send
at their declared cap of **50 members**, with short realistic profiles and each
of three message bodies. Every server meter is **exactly equal to round 3**,
not merely below the default ceilings. Permanent assertions compare all seven
fields to independently measured base values; memory, SQLite and wasm all
predict a `pending: true` message in the actual `history` query.

| App / text | R3 heap = R5 heap (B) | Heap headroom | Examined | Index entries | Steps | Writes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.4.11 / hello | 132,571 | 99.21% | 513 | 1,062 | 9,354 | 202 |
| 0.4.11 / realistic 81 chars | 140,605 | 99.16% | 513 | 1,092 | 9,354 | 202 |
| 0.4.11 / 1,999 chars | 154,023 | 99.08% | 513 | 1,062 | 9,354 | 202 |
| 0.4.12 / hello | 224,907 | 98.66% | 561 | 1,063 | 9,798 | 202 |
| 0.4.12 / realistic 81 chars | 236,535 | 98.59% | 561 | 1,093 | 9,798 | 202 |
| 0.4.12 / 1,999 chars | 341,633 | 97.96% | 561 | 1,063 | 9,798 | 202 |

Every case also uses 10 rule probes and 182,210 output bytes on both revisions.
No ceiling changed. These are **server headroom measurements**, paired with
successful default-ceiling admission on all three device runtimes; no numerical
device-meter measurement is claimed through an API that does not expose it.

Evidence is `/tmp/rp-r5-base.log` (R3 `7fc57283b3`, detached eb1000 worktree),
`/tmp/rp-r5-original.log` (R4), `/tmp/rp-r5-tight-prototype.log` (experiment) and
`/tmp/rp-r5-apps-native.log` (R5). All revisions use the same seed and timestamp,
50-member group, realistic profile values and exact Quarry source files.
R4 refused all six at the heap ceiling. A local tighter-price experiment joined
selected-column bounds, capped literal slices and replaced rule-JSON node counts
and four-row read scratch with a fixed read allowance. It still refused all six:
0.4.11 hello reached 16,637,231 heap bytes before the refused reservation;
0.4.12 hello reached 16,538,434. Retained maximum-bound copying and per-node
allowances were still too large. This was a **measurement prototype**, not a
qualified sound replacement analyzer or proof that all tight pricing is
impossible; its patch is retained at `/tmp/rp-r5-tight-prototype.patch`.
The actual-value option meets the strict base-headroom requirement without
inventing another static byte policy for private payloads.

### Exact coverage and the explicit exception

`crates/snapback4-lang/tests/reservation_app_headroom.rs` compiles every program
and helper in both real apps, acquires actual server pages, predicts on memory
and SQLite, checks the pending history and executes the server mutation. It
also revalidates the fixtures used by the six wasm tests in
`packages/snapback4/test/reservation-app-headroom.test.mjs`. Sources and SHA-256
provenance are in `tests/fixtures/rp-calibrations/README.md`. The 0.4.12 source
is absent from the lane's base commit; it was copied read-only from the exact
named run in eb1000's `lane-lu` worktree. No other machine was accessed. Backends
are split into schema/program files, each below 256 KB; no full large artifact,
gzip or wasm binary is committed.

The source/interpreter reservation differential retains its 320 seeded cases
per store, with **114 predicted-and-committed / 8 conservative queues / 198
server refusals**, about 21 seconds for its affected group. Adding the six real
apps gives **326 cases per store: 120 / 8 / 198**. The seed and case labels remain
reproducible. The four R3 review shapes, owner births, sequence indexes, parent
deletes, 1,024/1,025 once/no-once pairs, duplicate keys, private/public/online
maintains, list slots, Following work and all earlier receipt cases remain.

There is deliberately **no universal device-predicts ⇒ server-resource-admits
claim for omitted effect payloads**. The R4 600-payload case is preserved as an
explicit counterexample test, separate from the passing differential, and the
same shape at 40 iterations stays in that differential and its wasm corpus.
It predicts one note, then the server atomically refuses at `burst:4:3`:
1,001,466 steps against 1,000,000, 6,336,802 heap bytes, 497 examined, 1 index
entry, 0 rule probes, 0 output bytes, 1 metered write. No server row or effect
commits. The exact result reproduces on **unmodified main `a8c20c40e9`**, R3 and
R5; logs are `/tmp/rp-r5-pre-rp-gap.log`, `/tmp/rp-r5-r3-gap.log` and
`/tmp/rp-r5-gap.log`. Memory, SQLite and wasm assert the restored behavior rather
than ignoring the old test. See
[the open ticket](../../../issues/20261004-snapback4-omitted-effect-payload-resource-gap.md).

Runtime once-key charges are unchanged: key expressions still execute, their
heap/step charge is common, new keys cost a written row and devices never take
the durable ledger. A kept effect slice without obsolete payload prices can
predict a small payload; a 1,025-distinct-key slice still queues without rows.
Expiring rows, private owner columns, read-through authority, rule probes and
live/row-keyed aggregates retain the real read path. The compiler now checks
those dependencies directly when selecting a slice. Coalescing only erases
value branches; an emit, including `once` inside a branch, cannot disappear
inside an erased branch. New compiler tests retain those fences and the
ordinary read deciding whether a once emission occurs.

All other R4 audit-table rows stand. Its effect-payload reservation row and the
R4 paragraph claiming that gap closed are **superseded by this explicit R5
exception**. The analyzer was already `#[cfg(feature = "sqlite")]` in committed
R4, so no additional wasm saving is attributed to Grok's suggested cfg change.
Removing the price representation and interpreter scopes is the runtime cut.

### Legacy and documentation

The historical ordinary chat `send`, maintaining `messageCounts`, may queue
until a current priced backend is adopted. This is an **accepted compatibility
limit**, not a promise that every old ordinary writer retains prediction. An
old public/private projection may lack the complete nonzero source plan;
assuming zero reopens the reviewed reservation holes. Custody, queued writes,
outbox and delivery debt survive offline, unaffected provably-zero writers
still predict under Kept and the SDK helper, and adoption restores current
compiler facts. No runtime price reconstruction is reintroduced into wasm.

LLP 3000.013 §12.3 records the actual-value decision and ticketed exception;
LLP 3000.022 §14.3 records the corresponding reservation scope and legacy
aggregate limitation, with dated revision notes. `guide prediction` explains
that the worked send can still receive a server resource refusal and that the
SDK restores settled rows; `guide effects` and `why` state the actual-value
server-only payload fee. Guide line budgets and reference checks remain binding.

### Wasm

Locked eb1000 builds use the same Rust/wasm-bindgen/Binaryen toolchain. Base
`a8c20c40e9` was rebuilt again this round, not inferred from a previous report.

| Artifact | Raw (B) | gzip (B) |
| --- | ---: | ---: |
| Same-host pre-RP base | 2,048,676 | 617,327 |
| R4 | 2,107,138 | 636,469 |
| R5 | 2,097,970 | 634,330 |

R5 is **−2,139 B gzip vs R4**, **+17,003 B / 2.75% vs base**. Ratchet the budget
down to **634,460 B = Linux + the recorded 130 B macOS offset**. The offset is
historical allowance, not a claimed macOS measurement. Runtime ceilings are
unchanged. Final build log: `/tmp/rp-r5-full-qualified.log`; base: `/tmp/rp-r5-base-wasm.log`.
The earlier `/tmp/rp-r5-wasm.log` measured 634,326 B before the final comment
edit; the final full-run rebuild is the figure above. Raw artifact SHA-256:
R5 `17df474c6444a4ebc06bc5757ca5b1ad1ef8f1549d43522a0cdef8454ffd3b20`;
base `1fd8cd3fdef29bc5038a642e10ba0eb22df841b44ca704d1f0d2d4f5decf0e74`.

### Qualification and delivery

All work and checks ran on eb1000. The affected run passed **209 receipt/RY**,
**9 effect-read** and **2 real-app headroom** tests (six cases per host),
**112 guide** tests, **20 selected device** tests, and **73 client** tests,
including real-app wasm headroom, both reservation corpora, Kept opening,
upgrades, the explicit payload counterexample and the social starter. Logs:
`/tmp/rp-r5-affected-rust.log`, `/tmp/rp-r5-guide.log`,
`/tmp/rp-r5-device.log`, `/tmp/rp-r5-affected-clients.log`.

The complete command, from `snapback4/`, was:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
```

Result: **`== 0 failure(s) in 1480 s`**, exit **0**.
Rust: **4,825 passed**, 33 existing ignores; doctests: **17 passed**.
Client pool: **6,095 passed**, 11 existing skips; serial client models:
**79 passed**; fixture wrappers: **9 passed**. All RY escapes, the extended
reservation differential and every real-app case ran in this full suite.
There is no failed full-suite check requiring an unmodified-main exception.
The separate, explicitly asserted payload counterexample is the pre-existing
main mismatch named above; it is not silently counted as a parity success.

All **1,916** recorded implementation/test inputs remained byte-identical
through full-run completion. The final wasm was the same artifact used by the
full client run. After completion, only the budget metadata among those inputs
changed: **634,456 → 634,460 B**, reconciling the 4 B final-build difference and
keeping exactly 130 B of host allowance. The complete suite had already passed
the stricter cap; `node scripts/wasm-budget.mjs metrics/wasm-budget.json 634330`
passes the final cap. No implementation or test changed after qualification.

Evidence SHA-256:

- `/tmp/rp-r5-full-qualified.log`:
  `028d11b4dcce04e9caea74160b94c5c0c10c9d2ba99dd3151541d60f53b9fdf7`
- `/tmp/rp-r5-source-qualified.sha256`:
  `052039b7c466ca630b8217f27837dce0fe2b1949d9d75f36d852132bf5ca5578`

`./ref-check --verbose` and `git diff --check` pass. No new file exceeds
256 KB, and no gzip, video or wasm artifact is committed. The pre-existing
JOURNAL receives the specifically requested append. No Apartment mini, office
M1 or M5 was used. Nothing pushed or published. The commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
