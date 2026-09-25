# Lane Z review round 3 — snapshot charge witnesses

2026-09-25 · LLP 3000.016 revision 12 · `sb4-intent/z-event-slots`.

## Status

Items 2 and 3 are implemented. **Item 1 is waiting on lane U round eight**:
when the snapshot tests and both mutation checks finished, U's branch was
still at `cdb029a83`, its round-seven documentation commit. Per the explicit
stop condition, Z has not duplicated U's routing change. The two new client
regressions and the U8 merge remain pending; the current client High findings
are not claimed fixed by a passing snapshot or full-suite result.

## File by file

| File (relative to `snapback4/`) | Change |
|---|---|
| `crates/snapback4-core/tests/event_slot_snapshot.rs` | Add a kept-then-excluded event group before another owned group, and assert the second group's exact remaining budget. Add 257- and 600-unit pages in both mixed-residency directions, assert cumulative decoded/requested storage rows per page, require multiple storage batches, and retain the exactly-once continuation assertions. |
| `reports/20260925-event-slots-r3/mutate-snapshot.py` | Apply each requested mutant independently, require the intended assertion failure, restore production source even on failure, and rerun all six snapshot tests. |
| `reports/20260925-event-slots-r3/*.log.gz` | Targeted, mutation, restored and full-suite evidence. |
| `JOURNAL.md` | Append one dated entry recording the completed snapshot work, verification and U8 dependency. |

No production code changes: the existing snapshot charge and accumulator are
correct. The added tests bind the work to LLP 3000.016 §2.1a and §5 without
changing residency, authorization, disclosure, durability or engine bounds.
No new language form, diagnostic or author-visible behavior is introduced.

## Tests and mutations

`kept_and_excluded_events_both_spend_the_next_groups_budget` uses two public
owned tables from Following declarations sharing the same sources. The first
group emits its highest-key original, then examines excluded repost events.
After that group and the intervening empty groups exhaust, the next group
receives exactly 1, 2, 3 or 5 remaining units. Both the emitted event's identity
and the second group's requested/read counts are asserted.

`cumulative_storage_reads_are_bounded_across_multiple_batches` walks 4,096
owned events with budgets 257 and 600 for each mixed-residency direction.
The instrumented store counts all decoded rows and requested scan limits
across batches, independently of emitted rows. Each page stays within budget;
continuations advance, selected rows arrive exactly once, and total storage
reads equal 4,096. A separate assertion proves the fixture actually crossed
the 256-row batch boundary. Existing limits 1–7 and wholly partial-table
coverage remain.

Run with no other build in the worktree:

```sh
python3 reports/20260925-event-slots-r3/mutate-snapshot.py
```

| Mutation | Observed failure |
|---|---|
| `work = if filtered { examined - live.len() } else { live.len() }` | Exit 101: the second group's request/read tuple is `("otherPosts", 2, 2)` instead of `("otherPosts", 1, 1)`. |
| `examined += count` → `examined = count` | Exit 101: the multi-batch test decodes 3,841 rows against a page budget of 257, emitting only three rows. |
| Restore implementation | All six snapshot tests pass. |

## Open dependency and reproductions

The remaining work belongs to U's `local-query.ts` change described in
`~/sb4-intent/u-r8.md`:

1. **Local expiry at publication:** an offline record has a retained `left`
   component containing a row that expires at T and a speculative `right`
   point. Hold the device reply after evaluation before T, then publish at or
   after T. The round-two client can publish the expired retained row because
   its final expiry guard excludes local candidates. Required outcome: no
   expired row is published (reobserve, or loading with no expired deadline).
2. **Speculative sibling of retained data:** with both event kinds fully synced,
   a retained `older` message page, an online-only `eventSwitch`, and a pending
   own post, return `home()` with `{ older, events }`, where `events` is the
   conditional `feedPosts last 10 by .at` page or `[]`. The device's unknown
   gate produces a speculative empty array. The round-two client publishes it
   beside the retained page. Required outcome: `older` is data, `events` is
   absent from `data`, and its component metadata says loading.

Both reproductions still need real wasm/native regression tests after merging
U8. No workaround, whole-composition behavior change, or new component
contract is implemented by Z while waiting. This is the requested stop, not a
claim that the High findings are resolved.

## Qualification

Targeted command:

```sh
cargo test -p snapback4-core --test event_slot_snapshot
```

Six passed, zero failed before and after the two intentional mutant failures.
The full command passed at snapshot commit `525c623cd`:

```sh
SNAPBACK4_RUST_TEST_PROCESSES=8 CARGO_BUILD_JOBS=8 bash scripts/test.sh
```

Exact summary, exit **0**:

```text
== 0 failure(s) in 658 s
```

Rust passed in 194 seconds; client tests in 193 seconds (the main run reported
1,671 passes and ten existing skips); all 78 model tests passed in 238 seconds.
**Full-suite failures: none**, introduced, baseline or environmental. The only
failures during this round were the two intentional mutants, each exit 101,
followed by the passing restored implementation. The inherited baseline log
ends `== 1 failure(s) in 276 s` in cargo; no baseline exemption was used.

U's branch was rechecked after qualification and remained at `cdb029a83`.
Item 1 is still waiting; neither the U8 merge nor the two new client regressions
is included in this qualification.

## Scope and decisions

The prior two-group fixture is shared by the all-excluded and mixed-output
cases, keeping their assertions equivalent except for the single kept event.
The minimum empty-page assertion scales with the page budget so budgets above
256 exercise the same continuation checks as small pages. Both mutations are
caught by the new test that names their respective risk.

No source file exceeds 1,500 lines. No inventory remeasurement, new syntax,
engine-budget increase, push or publication. The only incomplete requested
work is item 1, subject to the explicit U8 dependency/stop instruction.
