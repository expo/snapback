# RP — receipt-derived maintenance and prediction

2026-10-03. Branch `sb4-intent/rp-receipt-derived-prediction`.
Base: `a8c20c40e986f8af98f4579386bdb80b9fa7f69e` (unmodified main at lane start).
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
