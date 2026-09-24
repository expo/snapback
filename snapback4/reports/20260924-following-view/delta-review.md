# Following view delta review — 2026-09-24

Both requested test gaps are covered. This delta changes tests and records only;
the view binder and runtime are unchanged.

## Files and behavior proved

| File | Change |
| --- | --- |
| `crates/snapback4-lang/tests/following_view.rs` | Assert Bob is the returned actor of Bob's repost of Alice's post. Add `refollow_view_pages_exclude_old_epochs_before_cleanup`, which reads the view before cleanup or backfill runs. |
| `crates/snapback4-device/tests/following_view.rs` | Add the same pre-cleanup proof on both memory and SQLite devices, applying the server's unfollow/refollow stream to an already acquired inbox. |
| `JOURNAL.md` | Append the dated result, measurements and scope. |
| `reports/20260924-following-view/delta-review.md` | This report, including mutation-test reproductions. |

The three new refollow tests first deliver 600 events. Unfollow deletes 256
copies synchronously; 344 retired-epoch copies remain when refollow adds its
50-copy preview. Each test proves those retired copies overlap the newest 20
events, so its query actually needs the epoch predicate. Before any background
chunk runs, the first page must contain 20 distinct event ids, with exactly one
current-epoch copy backing each result. Pagination must produce exactly
`p599` through `p550`, once each, and every page must report `complete: false`.
The server test also drains afterward and verifies completion becomes true.

The existing compiled fixture exercises these forms (no new syntax in this
delta):

```quarry
view feed: activity where .actor = viewer or exists follows[viewer, .actor]

query home(c: cursor ?):
  return feed last 20 by .at after c
```

Here `feed` is the materialized Following view; `home` invokes the view binder.
The fixture supplies the activity union and public source tables.

## Validation and reproductions

Run from `snapback4/`, with the prescribed Rust/Bun tools on `PATH`:

```sh
cargo test -p snapback4-lang -p snapback4-device --test following_view --no-fail-fast
```

All **11 tests pass**: seven language tests and four device tests. The command
passed both before and after the temporary mutations below. Final focused log:
`/tmp/lane-c-following-delta-focused-restored.log`.

The review's two mutations were applied separately, tested, then completely
restored:

1. In `bind/feed_view.rs`, change the actor projection mapping from
   `(actor.into(), "actorId".into())` to `(actor.into(), "authorId".into())`.
   Run the language test
   `viewer_pages_map_event_fields_then_apply_shapes_and_keep_pending_completeness`.
   It fails at the new assertion: actual actor `alice`, expected `bob`.
   Log: `/tmp/lane-c-following-delta-actor-mutant.log`; Cargo exit 101.
2. In `feed_view::read`, make the `base` returned by `timeline::read` mutable,
   then walk that base with `intent_walk::expression`, removing keys whose
   `column` is `Some("epoch")` from `Expr::Exists` reads. Leave
   `timeline::read` unchanged. Run the focused command above with `refollow`
   as the test filter. All three new tests fail: their first 20 rows contain
   only **16 distinct event ids**. Log:
   `/tmp/lane-c-following-delta-epoch-mutant.log`; Cargo exit 101.

These four intentional assertion failures are mutation-test evidence, not
failures of the final tree. Neither mutation is committed.

Required full `scripts/test.sh`, exit 0:

```text
== 0 failure(s) in 97 s
```

Log: `/home/ccheever/sb4-intent/lane-c-following-delta-test.log`.
Every suite step passed; no introduced, baseline or environmental failures.
Wasm remains 1,743,912 bytes raw / 484,496 gzip, within the unchanged
485,000-byte budget. `./ref-check --verbose` also passed: 504 LLP documents,
9,227 references, zero errors and zero unchecked references.

## Scope and remaining issues

No deviations from the delta request and no remaining review gaps. The dedicated
600-event tests supplement the existing shorter lifecycle tests because those
tests' 65/70 events all disappear within unfollow's synchronous cleanup allowance.
Both changed source files remain below 1,500 lines.

No new open problem. The previously recorded wide-payload task parking limit is
unchanged; reproduce it with:

```sh
cargo test -p snapback4-lang --test timeline_background delivery_charges_large_edge_payloads_before_materializing_them -- --nocapture
```

That passing regression test proves heap exhaustion parks the task without
unmetered copy writes; adaptive retry remains outside this test delta.
