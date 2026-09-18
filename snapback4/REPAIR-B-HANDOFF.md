# Repair B — round 6 handoff

Scope: base `27a8a4d66`, incoming HEAD `a3c0a367d`, branch
`sb4/repair-b-defer-image-0bf8a4b5`. Commit locally; no push, rebase or merge.

## Requested findings

| Finding | Disposition and evidence |
| --- | --- |
| **U1: abandoned capture** | **Fixed.** The persisted capture now includes its send revision. Request preparation reuses it only at that revision; a later revision captures the current outbox atomically with the request. `begin_send` leaves the old capture available for a late response, and inspection remains read-only. Rejection also compares the revision, so an older response cannot erase a newer capture with identical bounds. `abandoned_capture_after_deferral_includes_later_send` reproduces external=2, q1=3, abandoned `[q1]`, q2=4 plus both receipts and reopen; the retry at watermark 3/images_at 4 defers and finishes at value 3. The old-revision mutant publishes value 4. The earlier capture-lifetime test still covers arrival/rejection of the old response; a separate test covers equal bounds at different revisions. |
| **U2: terminal rule** | **Fixed by removing the duplicate rule.** `deferred::validate` already rejects *every* known terminal image gap and remains the sole protocol rule. Deleted `!page.more` from `should_defer` and deleted `defer` from replacement's stay-private condition. That condition now names only further pages or explicit snapshot staging. Replaced the direct-predicate test with a validation-refusal test. The public-apply regression covers ordinary, direct snapshot, staged snapshot, and snapshot catch-up, checks unchanged values/watermarks and reopens. No extra terminal predicate was added. Mutation evidence disables the shared validation rule or exempts snapshots; each compiles and fails the refusal assertions. The removal of an unreachable redundant shortcut is structural, not claimed as a separate behavioral mutation. |
| **U3: snapshot cut after catch-up** | **Wrong premise in grok-b6-03.1; no production change needed.** A publishing catch-up has `replacing=true`, calls `snapshot::clear` (staged rows plus all eight keys), and after commit sets `self.snapshot_owner=None`. Its next request uses published progress and reports `snapshot_catchup=false`. `snapshot_cut_is_consumed_before_live_requests` checks a staged cut equal to the old published watermark, a catch-up beyond it, every deleted key, another ordinary live page, and reopen. The same code exists at incoming HEAD. Removing publication cleanup fails the new test. The proposed `cut > watermark` filter also fails it: equal cuts still need catch-up before staged images can publish. Open additionally initializes `snapshot_owner=None`; it does not reload an old owner as the review assumed. |
| **U4: partition reset** | **Already one complete call; clarified and verified.** `clear_rows` calls `reset_publication(tx, false)`, which unconditionally clears deferred state, capture and snapshot staging. `false` means discard published replay evidence, not retain private state. The new public-reset regression seeds all private keys, the cursor, staging and base rows, then checks disposal, preserved incarnation/allocator, and zero request progress through reopen on both stores. Mutations separately retaining snapshot state and deferred progress fail. The exact key table is below. |
| **U5: first-page store identity** | **Wrong premise in grok-b6-03.3; no production change needed.** `require_owner` checks the installed backend/native digest and *published* store against this owner's interpreter. On a fresh device both published IDs are None, so it succeeds. `observe(..., false)` binds the authenticated page store privately in the same apply transaction; publishing `observe(..., true)` promotes it and the in-memory owner after commit. Passing the unpublished page ID to the published-owner check would reject this legitimate first page. `first_page_identity_is_bound_before_replacement` runs the exact fresh None/None/page S inputs, direct and staged, verifies S's published/private placement and revision, then requires reset and backend adoption for same-generation T, including reopen. Early promotion and ignored identity-change mutants both fail. Existing omitted-identity publication tests also pass. |
| **grok-b6-04.1: missing requested watermark** | **Fixed.** For an omitted echo, require `transfer == watermark`; do not additionally require the snapshot request floor to equal that ordinary cursor. Snapshot owner, continuation, send revision and monotonic `SNAPSHOT_THROUGH` checks remain in force. The updated `snapshot_catchup_uses_its_own_request_floor` first refuses a page below the snapshot cut, then publishes a valid catch-up with no echo. The existing ordinary-deferred missing-echo test still refuses an advanced private continuation. Restoring the extra equality fails the snapshot regression. `requested_watermark` is local transport metadata, not a new server wire field. |

## Old-server question: measured regression

The **identical** `tests/repair_b_legacy_r6.rs` runs against the archived base
and incoming HEAD. It acquires value 0, captures an empty pending set and loses
that fetch, admits/sends q, commits q on the real engine while losing its mutation
response, and retries sync. The terminal reply omits both `images_at` and
`committed_above`; acknowledgements are computed from that request's IDs. It
prints the server, device and reopened values before asserting base behavior.

| Source / both stores | Server | Device | Reopened | Retry pending / acknowledgement |
| --- | ---: | ---: | ---: | --- |
| Base `27a8a4d66` | 1 | 1 | 1 | `[q]` / `{q:2}` |
| Incoming HEAD `a3c0a367d` | 1 | 2 | 2 | `[]` / `{}` |
| Round 6 fix | 1 | 1 | 1 | `[q]` / `{q:2}` |

The fresh-request controls give 1/1/1 on both revisions. This terminal failure
was introduced by the lane and is fixed; it is distinct from the old server's
original truncated-page image limitation. LLP 3000.001 now makes that distinction.
The base was rebuilt from `git archive 27a8a4d66 snapback4`, including core,
language and device crates. Package artifacts were cleared before switching
back to this branch to avoid Cargo reusing same-name artifacts across archives.
A preliminary branch check hit that cache collision and is not qualification;
`focused.log` and the final crate logs are from the corrected branch rebuild.

## Durable-key table correction

| State touched by `clear_rows` | Operation |
| --- | --- |
| Visible rows and indexes; confirmed base sidecar | `clear_rows`, `base_clear` |
| `device:deferred:*`, including cursor, folded rows, metadata, acknowledgements and identity | `reset_publication` → `deferred::clear`; only the previously known identity is then restaged in the same transaction |
| `device:declaration:capture`, `first-capture`, `published` | `predictions::reset(false)` clears all three; observed execution sequences are retained as send evidence while published observation authority is removed |
| `device:snapshot:acks`, `next`, `owner`, `watermark`, `send_revision`, `through`, `groups`, `boundaries:*`; staged rows | `snapshot::clear` deletes the eight key entries/prefixes and clears staging, regardless of the keep-images flag |
| Published watermark | Set to zero in the same transaction |
| Acquired generation, published history groups, acquisition boundaries/report | Deleted in that transaction |
| Snapshot owner allocator `device:snapshot:owners` | Preserved; tokens are never reused |
| Published store/backend/native identity, send revision and submission allocator | Preserved; row reset is not backend adoption or a new incarnation |
| In-memory snapshot owner | Cleared only after commit; open also starts with no snapshot owner |
| Capture reuse (all request paths) | Same send revision only; read inspection never replaces durable bytes; a new request under a newer revision replaces an abandoned capture |

Media hints are not blanket-cleared by this existing row-reset path: readers
revalidate the row/generation/lifetime. They authorize neither publication nor
request progress. No new durable namespace or wire field was introduced.

## Verification and mutation evidence

Final command results and the complete per-mutation records are recorded in
[`target/review-fix6/report.md`](./target/review-fix6/report.md). Raw command logs
are preserved verbatim, including warnings and existing ignored tests. Mutation
controls and mutants compile copied source with identical native features and
debug assertions, optimization disabled; the three Cargo commands use the
repository's normal test profiles and fixtures. Mutants never replace branch
source. Each failed-run record includes its exact edit, source hash, compiler
command, test filter and assertion output.

| Command | Passed | Failed | Ignored | Exit |
| --- | ---: | ---: | ---: | ---: |
| `cargo test -p snapback4-device` | 608 | 0 | 3 | 0 |
| `cargo test -p snapback4-core` | 160 | 0 | 0 | 0 |
| `cargo test -p snapback4` | 265 | 0 | 0 | 0 |

All 12 distinct mutations compiled and failed their intended regressions, with passing controls. The three ignored device tests are existing. `git diff --check` passed. No push, rebase or merge was performed.
