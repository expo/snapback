# Snapback 4: two implementations of oversized-sync recovery are both on main

Status: Closed 2026-09-20 — the second implementation is retired and MC0's stands, landed as `8bdb56ef2`. Not published; the release is the diet program's call.
Priority: P3 (surface, not correctness: redundant machinery on the sync recovery path)
Date: 2026-09-19
Systems: `snapback4` `serve.rs`, `serve_sync_dispatch.rs`, `serve_sync_measurement.rs`, `serve_sync_stream.rs`; `snapback4-device` `device/sync_metadata.rs`; `packages/snapback4/src/local.ts`
Evidence status: both suites executed on `aab10d8b0` — `sync-overflow.test.mjs` 11/11, `oversized-sync.test.mjs` 66/66, `http-bounds.test.mjs` 10/10

## What happened

`issues/.../20260917-snapback4-oversized-sync-page-hides-generation.md` was
fixed **twice, independently, by two sessions**.

- **MC0**, `c60751e30`, landed 2026-09-18 05:23, ruled as LLP 3000.007 §14
  ruling 39. The bounded refusal retains `generation`, `store_id` and
  `watermark`; the client adopts a changed generation *before* shrinking or
  retrying, and never applies a refusal as a delivered page. About **80 lines**
  of product code across `serve.rs` and `local.ts`, plus a 212-line regression.
- **This session's lane**, `c2789d0c1..aab10d8b0`, landed 2026-09-19 17:13
  after five two-family review rounds. An overflow triggers an authenticated
  `/sync` metadata request; the server re-materializes the next indivisible
  commit under the unchanged ceiling and answers a **typed grant carrying the
  measurement that made it** — position, limit, stream, send revision,
  single-commit, commit, head, store, generation. Six new files and a protocol
  round trip.

The lane was dispatched after checking `origin/main` for claimed work; MC0 had
not landed at that moment and the lane ran for about a day. This is the second
duplication in two days — W13g was the first (`157a80798` against a parallel
lane) — and both were found only at integration.

## Why it is not urgent

They compose. The merge resolved 21 hunks across 9 files and both suites pass
together, as does `http-bounds`. Nothing is wrong today.

## Why it should still be consolidated

MC0's regressions already assert the invariants this session spent five rounds
establishing — its test list includes *"limit 1 grants a snapshot only after
measuring the indivisible stream page"* and *"reacquires an indivisible commit
by snapshot at the same generation"*. So the second implementation buys very
little, and LLP 3000.010's own finding is that **surface volume is what the
calibration charges**: twelve waves added capability while every category
measuring the cost of using it declined, and the instrument's single largest
movement came from *removing* friction, not adding mechanism.

Two mechanisms on one recovery path is where the next defect comes from.

## Recommendation

**Retire this session's implementation and keep MC0's**, unless the review
residue below is judged worth its surface:

- the typed grant binds the **send revision**, so a fitting rewrite at the same
  position grants nothing. MC0's test list does not show an equivalent, and that
  was round 5's S2 — *"that is how round 1 started: remembered permission,
  snapshot anyway."* Establish whether MC0 closes it before deleting anything.
- the grant also binds limit, walk position and single-commit at the mint, which
  round 5 found was not implied by checking the limit at acceptance.

If MC0 closes the revision window too, retire this lane's six files and the
metadata round trip outright. If it does not, port **only** the revision binding
onto MC0 and retire the rest.

Not recommended: keeping both. Whoever takes this should run both suites before
and after, plus `http-bounds`, the device crate and the horizon/retained-history
suites.

## Related

- LLP 3000.007 §14 ruling 39, LLP 3000.007.001 §3.11 (the prerequisite both fix)
- LLP 3000.010 §5 (surface volume is what this instrument charges)
- `benchmarks/runs/2026-09-19-snapback4-mc1-milestone-zero/` — gate 5 fails, so
  maintained columns is stopped and neither implementation unblocks it

## Resolution — 2026-09-20

The author chose MC0's tokenless inline response and directed retirement of
the metadata/grant implementation. This supersedes the recommendation above
to consider carrying revision binding across: there is no saved grant to
revalidate in MC0. No grant, metadata round trip or measurement type remains.

Before removing any duplicate file, restored the MC0 path integrated with
Repair B and executed the real oversized-first-commit case on both wasm and
SQLite process devices: 2/2 pass, watermark 0 → 1, acquired, exact final row
content. Initial acquisition already uses a snapshot and halves to 31 rows.
MC0's condition needs no change. The final suite also covers a first commit
arriving during zero-head snapshot catch-up.

Deleted the six server sync modules, device metadata module/dispatcher, their
grant/capture/measurement types, metadata wire fields, inspection hooks and
grant-only acquisition flag, and `oversized-sync.test.mjs`. Distinct behavior
was ported into `sync-overflow.test.mjs`; token-only tests were retired.
Shared ordinary receipt persistence and current-image normalization remain.
The detailed case-by-case ledger and executed evidence are in
[snapback4/JOURNAL.md](../../snapback4/JOURNAL.md), under the 2026-09-20 duplicate-retirement entries.

Final verification: sync overflow 23/23; HTTP bounds 10/10; horizon 82/82;
retained history 48/48; four store-reset suites 43/43; client lifecycle 56/56;
affected Repair B client suites 12/12; server crate 266 passed; device crate
897 passed, 3 ignored; core rows 8/8. Package build, typecheck and wasm build
pass. Wasm gzip: **451,094 → 443,474 B**, recovering **7,620 B**; the existing
452,000 B budget is unchanged. The integration report is retained unchanged.

This resolution describes the reviewable working-tree patch. Per the author's
instruction, it has not been committed, pushed, tagged or published.
