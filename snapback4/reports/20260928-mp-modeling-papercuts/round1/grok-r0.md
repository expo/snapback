I'll review the MP modeling-papercuts diff read-only, starting with the lane prompt, the report, and the exact commit range.The lane is a deliberate admission plus diagnostics. I'll diff the named range and read the disclosure-sensitive paths before judging whether anything should block landing.The range is one commit, mostly reports and fixtures. Next I’ll read the product diff: aggregates, sequences, and refusal records.The admission path is small. I'll read how parent verdicts, meters, and cursors are produced before any group key is touched.**READY.** The parent-pinned aggregate page does not reveal other parents' groups, and the refusal log is not a caller channel. Nothing here should stop MP from landing.

## What is sound

**Aggregates.** `reactionTotals[message = .id] by .emoji` is authorized in `aggregate_parent_prefix` (`through_read.rs:8`) before any group key is read. A missing, hidden, or expired parent returns `Some(false)` and `scan_consumed` returns an empty page (`read.rs:829`) without scanning the aggregate index. Deadlines noted during that check sit in `aggregate_scope`, which is dropped and not emitted, so `next_expiry` cannot carry a hidden parent's deadline. `rule_dependencies` (`read.rs:153`) records witness tables from the rule text before the parent fetch, so the `tables` set does not depend on whether the row exists. Explicit `read` clears `parent_key` (`schema.rs:79`); the compiler and raw IR both refuse the scan. `authorized_synthetic` (`authorized_point.rs:131`) runs only after that parent verdict, and only for rows under the pinned prefix. Device enumeration stays unknown when the view has no sync (`through_read.rs:18`), which is the private read-through case: audience columns are not group keys, so the view does not inherit sync. The report's missing-versus-hidden claim matches the test in `mp_reproduction.rs:51` (data, meter, cursor, expiry) and the control flow above. I did not re-execute it; this worktree has no build cache.

**Refusals.** `Capture::new` returns `None` unless `personas` is set, and `serve` sets that only for `Mode::Dev` (`serve.rs:260`, `serve.rs:319`). There is no flag that turns it on for `Mode::Release`. The collector is not deserialized from the wire. Replayed receipts return before a `Capture` is built (`serve.rs:1076`). Caller `E_RULE` bytes are built from the existing `Refusal`; the trace is a side `Arc` and is not serialized. On/off meter equality is what `mp_reproduction.rs:73` checks. Production responses do not gain a header, a body field, or a logical meter charge.

**Sequences.** The note fires only when the read rule is `exists` on the same table, the key contains `viewer`, and it contains the sequence's parent field (`refusals.rs:28-32`). `messages.ordinal` with `read <- exists members[...]` does not match. `sequence-by.q` is `public` and does not match. `check` still succeeds when the only new output is a note (`verbs.rs:81`).

**Rewrites.** Owner-key text matches the builder indexes: `exists likes[post, viewer]` and `exists reposts[viewer, post]`. The likes line is compiled verbatim (`audience_bounds.rs:174`). A filtered count does not get it. The M8 line names `digestPreview` because that is `call_chain[0]` while the query is what is being compiled (`prefix.rs:100`); the test locks that string.

**Existing programs.** The old compiler rejected every parent-grouped aggregate scan before emitting IR. Programs that already compiled do not contain this scan. Point reads are unchanged. The new behavior is the admission in LLP 3000.014 §5.1, plus notes and longer diagnostics on programs that were already failing.

## Sequence decision

The argument in LLP 3000.015 §2.1 is right. The counter is keyed by parent id, shared across tables, and kept after deletes and after allocations that happened before any parent row. `created_parent_and_empty_group_do_not_prove_a_fresh_shared_counter` shows a deleted prior allocation still forces ordinal 2. Allowing the insert only when that counter is zero would make success mean "no hidden history."

A narrower safe form exists and is not required. Put the counter on the parent row, start it at 0 when that row is inserted, and refuse a sequence insert unless that parent row is live. The first child in the same transaction then reads a counter the caller just created. There is no hidden map to branch on. That is a lifetime-enforcing reference plus a per-incarnation counter, not a special case in `sequence_insert_readable`. Do not add the zero test.

## Findings

None of these block landing.

### 1. Low — sequence note rewrite names the wrong column

`snapback4/crates/snapback4-lang/src/bind/refusals.rs:36`

A members-only table `joinedAt: sequence by room` with `read <- exists members[.room, viewer]` is a real trap, but the note says to increment `lastOrdinal` on each message insert and to keep a message `ordinal` unique by `(room, ordinal)`. There is no message column. Following it literally invents one. The membership fix itself (int ordinal, parent counter, seed 0) is right.

Smallest fix: build the rewrite from this column and parent. Point at `guide sequences` for the shared-counter recipe. Do not hardcode `ordinal` or "message insert."

### 2. Low — `why recent` is per directory, not per store or process

`snapback4/crates/snapback4/src/dev_refusals.rs:40`
`snapback4/crates/snapback4/src/verbs.rs:843`

`dev` and `dev --fresh` both write `{project}/.snapback4/dev-refusals.json`. The fresh store is thrown away; its clauses stay in the durable project's file, with no store id. A second `dev` on the same tree keeps its own memory list and overwrites the file on the next refusal, so `why recent` shows the other process's clauses or drops them. `why recent --release` reads `{release}/releases/{id}/.snapback4/`, which `serve` does not write. Another project is not visible unless the cwd or `--release` points at it. The file mode is `0600` and the JSON has no row values or arguments. Callers still do not see it.

Smallest fix: write the fresh server's file only in its temporary directory, and put `store_id` in each record. Take the file lock and merge, or stop sharing one deque across processes.

### 3. Low — dev refusal recording delays the response

`snapback4/crates/snapback4/src/serve.rs:1238`

The `Capture` is created and dropped while the engine lock is still held, and the HTTP response is sent after that. On `dev`, a refusal waits on a create-and-rename of the JSON file, so wall time and any duration header differ from collector-off. The body and the logical meter do not. `serve` never enters `Capture::drop`.

Smallest fix: drop the capture after the engine lock is released and after the response is written. Not required for the secrecy claim.

## Test strength

A mutation that survives: in `read.rs`, before the empty return at line 829, emit `aggregate_scope` after `note_expiry` on an expired parent. `parent_denials_hide_other_groups_and_unpinned_scan_still_refuses` compares a missing id with Bob's live message (`expiresAt` null). It checks `data`, `metered`, `next`, and `next_expiry`. It does not include an expired parent, `tables`, or `complete`. The leaked deadline would not fail that test.

A second survivor: drop `witness != name` in `refusals.rs:29`. `first_member_note_is_located` uses `find` and only checks that the members column is noted. An ordinary `messages.ordinal` whose witness is `members` would also be noted, and nothing asserts that it is not.

## Verdict

**READY.** The admission and the dev-only refusal record do what they claim. The three Lows are a sloppy note, store-unscoped developer files, and dev latency. They do not disclose group keys, counts, or populations, and they do not put the clause on a caller byte.
