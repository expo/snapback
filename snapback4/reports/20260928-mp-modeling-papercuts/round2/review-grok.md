I'll review the MP round-1 diff read-only: first the lane prompts, prior reports, and the merge resolution, then the change itself and the reproductions you listed.The range is one product commit on a merge that only touched the journal. Next I’ll read the round-1 report and the code that claims to fix the three Mediums.The committed tests passed. I'll run one extra probe for a nested page and for a same-group witness that is not an index column, which those tests do not cover.**READY.** Round 1 fixes all three blocking diagnostics and the Lows that were asked for. Nothing here should stop MP from landing.

The merge `07179b8dd` only conflicted in `snapback4/JOURNAL.md`. The remerge diff drops the conflict markers and keeps both journal entries. No product file was resolved by hand.

I ran the locking tests in a temporary build directory: `dev_refusals` 4/4, `mp_reproduction` 16/16, `audience_bounds` 10/10. The worktree was not modified.

## 1. Each round-0 finding

**Store and instance identity — fixed.** Two simultaneous `dev --fresh` processes write `.snapback4/dev-refusals/<storeId>/<instance>.json`, each under an exclusive lock held by that process's writer thread. `why recent` with two live instances fails and names them. `--store` on the quiet instance returns an empty record list and a different instance id. `--instance` returns only that producer's envelope. Copying the other process's envelope into this store's file is rejected as mismatched. After the process is killed, that instance is no longer selected. `simultaneous_fresh_instances_are_selected_and_stale_or_mismatched_records_rejected` fails if they share one file again. Production `serve` still does not create the directory.

**Read-through insert causes — fixed.** `capture_insert` records three clauses, and the compiler maps all three to the child's `read through` token (`schema.q:11:3` in the fixture). Missing and expired share `read through parent missing or expired` on purpose: the expired parent is still stored, and the clock is between the two deadlines. An unreadable parent records `read through parent read rule`. Trace on and off, the caller `E_RULE` bytes and every meter field match. Those three tests fail if the trace stays empty.

**`N_SEQUENCE_READ` — fixed for the reported case.** The note requires a same-table `exists` whose selected index pairs the sequence-parent column with that same field on the inserted row. Astra's `access = .parent` witness is another group: the committed test has no note, and the insert commits. The builder's `joinedOrdinal: sequence by conversation` with `exists members[.conversation, viewer]` still notes, on that column. `joinedAt: sequence by room` rewrites `joinedAt` and `rooms`, not a message `ordinal`. A `messages.ordinal` whose witness is `members` is not noted. I also compiled the same cross-group pin as a residual equality (`slot = 'witness', access = .parent` on an index of only `slot`): no note, and the insert commits.

**Writer off the engine lock — fixed.** On the durable path the capture is owned outside the engine-lock block and dropped only after `respond_timed`. The ephemeral path does the same. `Drop` only `try_send`s. Stderr and the rename run on the `dev-refusals` thread. `blocked_stderr_cannot_block_responses_or_later_mutations` pins the pipe at 4 KiB, leaves it unread, fires 4096 refusals, then completes a later mutation.

**Preview wording — fixed.** The rewrite is now "if this viewer query is unused, remove `digestPreview`". `audience_bounds` locks that string.

**The two test-strength holes from round 0 — closed.** Forty refusals retain `add8` through `add39`. An authorization grant that expires before the parent and the source row sets `next_expiry` to the grant, and the group is empty at that instant.

## 2. Refusal-cause coverage

I walked every `RuntimeError::Rule` and every `NOT_FOUND` that follows an evaluated rule. The new write paths record a clause and do not change the caller error:

- Read-through capture, as above. The site is the child's `read through` line, which is what was asked.
- A hidden delete, a hidden update condition, and `project_row` record `read rule` at that table's read rule.
- A hidden `written by` denial records `field authority <column>` at that column. `hidden_write_rule_denials_record_causes_without_changing_not_found` locks `NOT_FOUND` bytes and meters.
- An unreadable update that collides records `unique <columns>` before `NOT_FOUND`.
- Insert, sequence, unique, cap, and allowance were already recorded. Allowance still overwrites a guessed false rule. Upsert's conversion to `NOT_FOUND` keeps the clause.

These still have no rule clause, and should not:

- A missing or expired write target that never evaluated a denying rule.
- Validation, immutable-field, and projection failures converted to `NOT_FOUND`.
- An authored `require … else E_RULE/NOT_FOUND`, which already carries its program site.
- Action-seat admission, which already returns `actions.<name>`.
- Replay, which returns before a capture is built.
- Queries and `snapback4 run`. The collector is attached only to dev HTTP mutations. A query budget that surfaces as `E_RULE` still has no `why recent` line. That is outside the mutation channel this lane added, and it is not a new caller byte.

I did not find a write path whose recorded clause points at the wrong declaration. Missing and expired parents intentionally share one clause, so the developer still cannot tell those two apart. That is the LLP note, not a wrong site.

## 3. Disclosure

The caller-visible `E_RULE` is unchanged. `rule_refusal` still builds `RuntimeError::Rule { table, effect }` with the same four-cause message. `developer_gets_each_cause_without_changing_one_byte_of_the_refusal` matches `baseline-rule.json` and checks trace-on against trace-off for the body and every meter field. The trace is an in-memory `Arc` on `Context`, not a field of `Refusal`, and it is not serialized. Dev query meters are separate and already dev-only.

A record cannot reach a caller, a production log, or another store's `why recent`. `Capture::new` returns `None` unless `personas` is set, and `serve` sets that only for `Mode::Dev`. Release never starts the writer. The JSON is mode `0600`. Selection requires a live lock, a matching store directory, and the same identity in the lock file and the envelope. Records have no arguments or row values. The committed test checks that `bob` does not appear.

Aggregate admission is unchanged and still holds. `aggregate_parent_prefix` returns before any group scan when the parent is not readable. On that path `scan_consumed` drops the expiry scope without emitting it, so a hidden deadline cannot become `next_expiry`. `missing_hidden_and_expired_aggregate_parents_have_identical_metadata` locks data, the full meter, cursor, deadline, tables, and completeness for a missing, hidden, and expired parent. I probed the forms that test does not compile:

- A page shape, `parents[owner = viewer] { groups: totals[parent = .id] by .kind }`, returns only the live parent and its count of 1. The expired parent is absent. A hidden parent's 25 other rows do not appear as data, ids, or a deadline.
- A point read `totals[parent, kind]` and a shape wrapped around that same id match the missing parent on data, meter, cursor, deadline, tables, and completeness for both the hidden and the expired parent, once the caller-supplied ids are the same length. A two-byte heap gap in an earlier run was the argument string length, not the hidden row.
- The live parent still returns its count and its own deadline. That is the readable case.

## 4. What should not stop landing

No Highs and no Mediums.

### Low — a same-group pin in a residual equality still has no note

`snapback4/crates/snapback4-lang/src/bind/refusals.rs:34`

The matcher zips index columns with the ordered key and drops `equalities`. This schema compiles, gets no `N_SEQUENCE_READ`, and the first insert fails with the four-way `E_RULE`:

```quarry
ordinal: sequence by parent
unique bySlot: slot
read <- exists members[slot = 'witness', parent = .parent]
```

A witness has to be an existing row in this same parent, so every first row of a parent fails. The cross-group residual `access = .parent` correctly stays silent and the insert commits, so this is a missed note, not Astra's false promise. The builder's index-column schema is still noted.

Smallest fix: also accept an equality whose column is the sequence parent and whose term is that same field. Do not accept a term whose column has a different name.

### Low — `why N_SEQUENCE_READ` still says "message"

`snapback4/crates/snapback4-lang/src/guide/why/N_SEQUENCE_READ.md:12`

The check rewrite now names `joinedAt` and `rooms`. The why card still says to keep an int ordinal and increment `lastOrdinal` on each message. Following the why card on a members-only table invents a message column. The note at the source site does not.

Smallest fix: use the same column and parent wording as the diagnostic, and point at `guide sequences` for the shared counter.

### Low — one crashed save wedges later persistence

`snapback4/crates/snapback4/src/dev_refusals.rs:83`

`save` creates `{instance}.tmp` with `create_new`. The error path removes it, but a kill between create and rename leaves the temp file. Every later save fails `AlreadyExists`. Stderr still prints the clause. `why recent` stays on the last good file for the rest of the process.

Smallest fix: create the temp file with truncate, or unlink it before creating it.

None of these disclose a group key, a count, or a population, and none put a clause on a caller byte.

## 5. Test strength

A mutation that survives the committed tests: in `get_prepared` (`read_point.rs`), after a denied parent verdict, charge one extra `examined` and return. `missing_hidden_and_expired_aggregate_parents_have_identical_metadata` only runs the grouped scan `totals[parent] by .kind`. The point form is untested there. I ran that point form, and the nested shape around it, and both match today. Deleting the second live-lock check at `dev_refusals.rs:137` also survives: the killed-process test is already rejected by the first `try_lock_shared`, because the process is dead before `why` runs.

## Verdict

**READY.**
