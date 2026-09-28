# Lane MP — calibration 24 modeling papercuts

2026-09-28. Branch `sb4-intent/mp-modeling-papercuts`, base
`5763da0734164738dbb4a05b0fd4fb9eea4cb5b3` (OK and DG included).
The required first `git fetch origin && git merge origin/main` completed with
“Already up to date.” No push or publication. EQ was not a prerequisite for
these changes; no equality-prefix behavior is changed here.

## Result

- `check` locates the first-member sequence trap with `N_SEQUENCE_READ` and
  gives the manual parent-counter rewrite. Sequence authorization is unchanged.
- A page can now read each message's **per-emoji** maintained totals using
  `reactionTotals[message = .id] by .emoji` inside its shape. Every group domain
  is authorized through that one parent. This is a deliberate admission change,
  documented in LLP 3000.014 §5.1. Unpinned and explicitly overridden audiences
  remain refused.
- `dev` logs the actual refusing clause and its schema source coordinate.
  `why recent` reads the last 32 local records. Caller E_RULE bytes and meters
  are unchanged; production `serve` neither collects nor logs these records.
- The two aggregate-audience errors give the concrete owner-key sync and
  ordinary-existence replacements. OK already supplies their offline behavior.
- DG's preview refusal identifies the helper and caller; its job-preserving
  repair now explicitly names the unused viewer query to remove.
- The [rewritten full builder fixture](../../crates/snapback4-lang/tests/fixtures/mp/builder.q)
  compiles and has behavior tests. **519 → 517 physical lines.**

The aggregate **group index remains on the server**. New parent-pinned group
pages use server fallback on devices, including devices holding all children.
Existing complete-key scalar totals can still recount held children locally.
The changed builder helper is `apiReaction`, used by the custom HTTP API;
its separate `messageReactions` raw-row query and offline UI remain intact.
No offline group-enumeration claim or new aggregate replica copy is made.

## Orientation and constraints

Applied `llp-orient` before implementation. The worktree's skill symlink had an
uninitialized vendor target; the skill was read from the available enginefix
checkout, read-only. No other worktree was changed. Context pack:

| Governing document | Constraint applied |
| --- | --- |
| LLP 3000, LLP 2000.000, Snapback 4 AGENTS/NOT-DOING and rules/RULES | Independent workspaces, existing ceilings, source-file cap, local checks and append-only journal. |
| Accepted LLP 3000.028 §§2.4, 3.4, 4, 7.4–7.5 | Builder-source diagnostics; own-key absence is distinct from arbitrary aggregates; job previews must not silently truncate complete digests. |
| LLP 3000.007 rules and bounded reads | Preserve authorization, complete-prefix requirements, ordinary page/cursor and meter behavior. |
| LLP 3000.013 maintained views | Inherited audience and sync cannot be narrowed by an aggregate; group totals retain source semantics. |
| LLP 3000.014 §§4–5 | Parent captures, current lifetimes, authorization before group data, no hidden group enumeration. Revised §5.1 records this lane's admission. |
| LLP 3000.015 §§2–3 | Shared sequence counters; independent read authority; generic E_RULE and request-wide authorization allowance. Revised §2.1 records the disclosure argument and dev-only instrumentation. |

Read the compiled sequences, maintains, offline-interactions, rules and relevant
`why` surfaces. Checked existing SE latency/doctor code before adding refusal
records. No existing operator-side permission for the private cause was found,
so collection is dev-only. No public header or HTTP endpoint was added.

## Reproduction before changes

Evidence at `~/sb4-intent/rg-evidence/lane/` was read-only. The schema, relevant
logs and diary/essay were copied under [inputs](inputs/). That tree was never
written to, served, adopted, or used as a writable store. The historical failed
schema checkpoints are not present: the schema copies under [reproduction](reproduction/)
reconstruct the logged failed edits against the final 519-line builder schema;
they are not claimed to be byte-identical historical checkpoints. Every
baseline below ran before the implementation changes.

| Item | Reproduction and observed baseline |
| --- | --- |
| 1, first sequence member | Changed membership/message ordinals back to `sequence by conversation`, removed supplied values and parent-counter increments. `check` passed with no sequence warning. Calling `createGroup` after seeding Bob's profile failed at the first member and rolled back both parent and members. [baseline-sequence.json](baseline-sequence.json), [baseline-runtime.log](baseline-runtime.log). Its serialized [E_RULE](baseline-rule.json) matches the four-cause message in `m3-seed.txt`/`m3-rule.txt`. |
| 2, page totals | Added `reactionTotals: count reactions by .message, .emoji` and a messages page with a nested parent-prefix totals read. Baseline `check` refused `E_READ_THROUGH_SCAN`, with only the full-parent point-lookup advice. [baseline-aggregate.json](baseline-aggregate.json); historical `m6-check-3.txt` and `why-read-through-scan.txt` are copied under inputs. |
| 3, developer cause | The runtime first-insert reproduction returned only the generic E_RULE. Inspection of dev/doctor/why and SE timing confirmed no clause collector or recent-refusal source record. Timing identifies stages, not the refusing rule. The baseline bytes were saved before adding instrumentation. |
| 4, own summaries | Restored ordinary `exists likes[post, viewer]` and `exists reposts[viewer, post]` in `postState`. Acquired devices without own-key coverage returned unknown/unavailable, including empty-store absence. Adding OK's own-key declarations returned complete false/false. [baseline-offline.log](baseline-offline.log). Reconstructed summary `read` + `sync` edits separately produced E_QUARRY_SYNTAX and E_SYNC: [baseline-narrow-sync.json](baseline-narrow-sync.json), [baseline-narrow-read.json](baseline-narrow-read.json). |
| 5, preview query | Appended the original `digestPreview(periodStart, periodEnd)` calling `digestCounts(viewer, ...)`. DG refused at `schema.q:504:17`, named `digestPreview → digestCounts`, distinguished partial preview from complete job, and retained the recipient work bound. [baseline-preview.json](baseline-preview.json); original `m8-check*.txt` copied under inputs. |

Run-log anchors: line 50 (first member), 119 (M6 reaction groups), 135 (own
summaries), 143 (M8 preview); diary lines 34 and 42. The retained full-scale
store was not copied or re-qualified in this lane. DG's full-store test remains
explicitly ignored; the active digest tests exercise 100 memberships and an
oversized recipient without relying on that store.

Original schema SHA-256:
`3cac14ad097703a0106d0a2f64256b096e03c07702d34d577b5f52ed7a33c99e`.
Rewritten fixture SHA-256:
`b2b34fa3a9d44b735ca281959328b3562a9cee0bf1fc09bfc41b23918bf4b9f6`.

## Decisions and behavior

### 1. Diagnose the sequence design; do not weaken disclosure

A genuinely fresh shared counter has no hidden history. A newly inserted parent
or empty child group does not prove counter freshness: ordinary references do
not enforce parent lifetime, allocations are shared across tables, and deletion
does not reset the counter. The new test creates history before the parent,
deletes that history, then creates the parent and attempts its first membership.
The membership still refuses; the next authorized allocation is 2. Branching on
an internal zero counter would itself disclose whether prior allocations exist.

The builder's self-membership read therefore receives a note at the sequence
column (`schema.q:158:3` in the reconstructed schema), naming the exact missing
sequence read authority and the `lastOrdinal` rewrite. Keeping this a note
preserves existing programs. The manual allocator remains in the rewritten
builder because it preserves the roster audience; changing memberships to
owner-only reads would change the model. [after-sequence.json](after-sequence.json).

### 2. Authorize a group domain through one readable parent

The compiler and core require the complete parent identity in the selected
index prefix and inherited parent-key authorization. The core checks this even
for raw IR. Authorization precedes access to any aggregate group key/counter.
A source cap on the parent bounds the number of live groups; otherwise the
ordinary page bound/cursor is required. Existing aggregate live recount,
expiry, retention, and physical/logical meters remain in use.

Missing and hidden parents with zero or 25 groups produce identical data,
meters, cursor and expiry. Tests exercise counts/mine on the full builder,
parent expiration, meter cuts without partial counts, unpinned raw IR,
explicit read overrides, and device unknown/fallback. The maintains card has a
compiled, clean, complete messages-with-totals example. The source diagnostic
shows the builder's nested `reactionTotals[message = .id] by .emoji` form, not
just a scalar point lookup. [after-aggregate.json](after-aggregate.json).

### 3. Developer evidence without a caller channel

Native Context has an opt-in collector. It records table, clause, execution
coordinate and generation; the compiler supplies the schema source coordinate.
The runtime does not reevaluate rules or access extra rows to obtain the cause.
Tests cover insert rule, sequence read authority, hidden unique key, hidden cap
row, and exhausted authorization allowance. Each collector-on/off pair has
identical serialized refusals and meters, and all five E_RULE byte strings equal
the pre-change captured baseline.

`dev` logs source information and atomically writes a bounded, mode-0600 local
`.snapback4/dev-refusals.json`. `why recent` reads it; no caller response/header
contains it. There are no row values, arguments, hidden counts or credentials in
the record. The real-process test verifies dev stderr, why output, permissions,
and identical production refusal bytes with no production record/log. Replayed
receipts do not rerun a rule or synthesize an unavailable historical cause.

### 4–5. One-step repairs in the current authoring surface

Both narrowing errors now start with the concrete source declaration, e.g.
`sync public last 2000 by .at, .id with own keys .principal`, and
`exists likes[post, viewer]`. Tests apply the suggested sync/existence text
verbatim. A filtered count does not receive this equivalence suggestion.
The existing alternatives retain the public aggregate or explicitly accept
online-only aggregate reads. [after-narrow-sync.json](after-narrow-sync.json),
[after-narrow-read.json](after-narrow-read.json).

The complete rewritten schema answers own-state true and false offline after
reopen on memory and SQLite, with Alice's source interactions pushed outside
the 2,000/1,000-row public windows. It does not require either fully synced
summary. The ordinary raw read without own coverage still returns unknown.

DG's M8 explanation is retained, with the concrete job-preserving instruction
“remove the unused viewer query `digestPreview`”. The job and its bounded
recipient work are unchanged. Existing behavioral tests confirm 100 memberships
require two preview pages and an oversized recipient parks with no partial
notification or emission key. [after-preview.json](after-preview.json).

### 6. What disappears from the builder

| Workaround | Rewritten schema |
| --- | --- |
| Fully synced `ownLikes` and `ownReposts` | Removed; source own-key coverage plus ordinary exists. |
| Materialize and `group` up to 50 reactions in `apiReaction` | Replaced by parent-pinned maintained per-emoji groups; source cap retained. |
| Manual conversation/message ordinal allocation | Retained deliberately; the exact first-member repair is now given before running. |
| Remove unused digestPreview to keep complete scheduled digest | Retained; final evidence schema already omitted it. The diagnostic now names the edit directly. |

The two summary lines disappear; adding reactionTotals and replacing the two-line
raw-group implementation balances out. The total is 519 → 517 lines, including
blank lines. No score increase or full-scale replica-size reduction is claimed;
owner-key coverage still has its own local state cost.

## Validation

The requested single `bash scripts/test.sh` completed with exit 1 and the exact
summary **`== 1 failure(s) in 3199 s`**, followed by `cargo test`.
That stage failed while building test artifacts because the new `refusals` field
was missing from one `serve_tests` initializer: **ours**, fixed. The complete
Rust stage was then rerun, revealing one additional fixture-census failure
(also **ours**, fixed and retested below). No remaining observed failure; no
baseline or environmental failure was used to waive a result. The original
full-script result remains a failure, not a claimed green rerun.

All other full-script stages passed, including **3,928 client tests, zero
failures, 10 existing skips**, and **79 model tests, zero failures/skips**.
The script selected serial client execution at host load 109.79 across 96 CPUs;
no test count, timeout, or concurrency policy was changed. Detailed command logs
accompany this report. Every development failure and its attribution is listed
in [VALIDATION.md](VALIDATION.md).

- Broad Rust recovery completed all 266 binaries / 979 executions plus doctests:
  **4,201 passed, 1 failed, 33 ignored**. The sole failure was the new fixture
  entering the frozen ephemeral-compat census. Moving it into its own fixture
  subdirectory preserved all frozen expectations; that test passes in the final
  affected run. No remaining Rust failure. Counts are not added again across
  overlapping reruns.
- Whole compiled guide: 93 passed, 0 failed (`affected-12.log`).
- MP behavior target: 8 passed, 0 failed (`affected-13.log`).
- The preceding affected matrix (`affected-10.log`) also passed the real dev/
  production test, five device tests, read-through suites, sequence suites,
  audience bounds, and digest runtime tests. Its one test-fixture failure was
  fixed and rerun; no product failure from that run remains.
- `./ref-check --verbose`: `ref-check: ok — 522 LLP docs, 9781 refs in 40969 files, 0 errors, 0 unchecked`.
- Final affected correction run: 57 passed, zero failures (`final-affected.log`),
  including the compatibility census and verbatim owner-key rewrite.
- Final reference audit: `ref-check: ok — 522 LLP docs, 9781 refs in 40986 files, 0 errors, 0 unchecked`.
- No modified source file exceeds 1,500 lines. Budget and wire-contract files
  are unchanged.

Wasm from the full suite: **2,019,245 B raw / 585,639 B gzip**. Baseline:
2,017,908 / 585,100. Delta **+1,337 raw / +539 gzip**, for the parent-prefix
aggregate authorization/enumeration path. It is **554 B below** the unchanged
586,193 B gzip budget. No budget increase. The native-only trace payload is
excluded from wasm.

Dependencies were installed only in this worktree, using its `.bun-cache`
(which was removed after building);
no executable/tool was installed and no shared tool path was changed. Node
24.13.1 and the existing Bun 1.3.14 were used. The user-visible surfaces changed
are compiled guide/why text, diagnostics and CLIENT-AND-OPERATIONS, all included
in the published package; no repository-only knowledge is needed for the repair.
