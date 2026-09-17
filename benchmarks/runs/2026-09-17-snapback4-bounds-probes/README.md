# Bounds probes on published Snapback 4 0.2.27

**Status: complete; a probe record, not a calibration.** Small projects run against the
**published `snapback4-darwin-arm64@0.2.27` binary** (`npm pack`, `snapback4 --version` →
`snapback4 0.2.27`) on 2026-09-17, to test one reading of the last four Astra-medium Clique
calibrations: that the recurring `queries_and_live` / `scale_and_limits` deductions are
"the builder must reason about bounds before they can write a query", and that the engine
should therefore plan batched walks and compute completeness. They are the evidence for
LLP 3000.007 rulings 23–27 and §20.22 ("total reads"; drafted, landing after wave 12) and
for two tickets filed with this record:

- [`issues/20260917-snapback4-merge-cursor-skips-rows-with-equal-ordering-key.md`](../../../issues/20260917-snapback4-merge-cursor-skips-rows-with-equal-ordering-key.md) — **P1**
- [`issues/20260917-snapback4-merge-next-survives-a-later-non-uniform-read.md`](../../../issues/20260917-snapback4-merge-next-survives-a-later-non-uniform-read.md) — P3

Nothing here changes the product. Raw output for every probe is in [`RESULTS.md`](./RESULTS.md).

| | |
| --- | --- |
| Binary | published `snapback4-darwin-arm64@0.2.27`; no repository build |
| Method | `dev --memory`, `POST /seed`, `POST /q/<op>` with `meter: true`; `check`, `check --cost`, `check --residency` |
| Host | the shared development Mac, load average 12–37 during the runs; Node 24.18.0 |
| Evidence level | counters are the engine's deterministic meter; the few latencies are loopback HTTP p50s on a loaded host and are not magnitude claims |
| Run | `cd <probe> && SB=/path/to/snapback4 node measure.mjs` |

## What they show

| Probe | Finding |
| --- | --- |
| `search/` | The one-cursor `merge messages matching q … for m in members[viewer] first 1000` is **complete with `next` at 1,000 chats when hits are sparse** (1,115 examined). It is cut, with no `next`, only when every chat holds hits — because matching lanes read a page each (≈ 24 examined a chat) where the same lanes as a plain merge read one head (3,040 at 1,000 lanes, complete). The card's two-cursor walk reproduces exactly (792,359 examined over 1,220 requests at 1,000 dense chats). `check` prints `N_WIDE_MERGE` for the sparse case too; `dev` prints nothing when a read is really cut (`banner.mjs`). |
| `search/measure-grouped.mjs`, `grouped-search-9000/` | "Grouped by chat" is **one filtered page with one cursor**, and its meter cut already carries `next` (§5.6): 1 request at 1,000 chats when five hold hits; at 9,000 memberships, cut at 8,194 examined, `next` present, done on request 2. This is why the windowed continuation was shelved. |
| `grouped-defect/` | **Defect.** An inner top-1 read inside a `where` predicate sets `page_overflow`: a fully walked answer reports `complete: false, cut: null`. The same read in a shape does not. |
| `following/`, `following-synced/` | Merge-on-read Following is complete with one cursor; 500-follow over 5-follow p50 = 2.05–2.32× (Clique's gate is 3×). With the public tables synced it `runs: device` and `follow`/`post` predict. `check` rewrites it to the hybrid recipe regardless. |
| `cap-restated/` | Compile-only: a capped group cannot be read, looped or used as a lane source without restating its cap as `first N`; `exists` over a prefix is refused with the rewrite "`unique byColumn: <column>`"; a page read already infers its index when unambiguous. |
| `merge-equal-suffix-skip/`, `merge-cursor-bypasses-cursor-index/` | **Defect, P1.** A merge cursor never reaches `E_CURSOR_INDEX`; the merged position is the index suffix alone. Over `unique byRoomAt: roomId, at` a walk returns 3 of 4 rows; over the non-unique `by byRoomAt: roomId, at` (refused for a direct page) it returns 2 of 3 **inside one lane**. Every page says `complete: true`. |
| `merge-next-after-non-uniform/` | **Defect, P3.** A merge's `next` is withheld for the non-uniform class only when the non-uniform read runs *before* the merge (§20.3's rule is order-dependent). No cross-world difference was observed. |
| `group-drops-next/` | **A dead end, honestly reported but not foretold.** `return group(page, 'roomId')` over a page read `after c` can never publish `next`: every full page answers `complete: false, cut: null`; `check` prints no note. `return { page, groups: group(page, …) }` keeps it. Met by the bounds bar's own reference-app author. Not a defect of correctness — a candidate for the total-reads invariant (carry the page through row-preserving helpers, or note it). |

## Clique scale fixture facts used in the argument

From `benchmarks/fixtures/social-messenger/scale.log` (167,159 lines): all 99,090 `send`
actions contain the word "coffee"; `u0001` is a member of all 1,000 conversations, every one
created before the `# checkpoint 10%` marker; `u0500` is the probe user (500 follows, 100
conversations). The 0.2.27 builder's "failed search midpoint" is p95 8.229 / 7.940 / 7.316 ms at
10 / 50 / 100% — a flat curve missing a downward-sloping line by 0.12 ms.
