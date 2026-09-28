# EQ: selected-index history equivalence

Implementation acceptance for [LLP 3000.028 §7.1](../../../../llp/3000.028-one-query-online-or-offline.rfc.md), commissioned separately from P19's immutable research record. This directory does not replace that record.

`builder.q` is the calibration schema with exactly two changes: ordinary `history` uses the equality spelling, and `historyHeld` is removed. `receipts.ts` copies the builder hook, removes the archived query selector and uses `api.history` in every state; `archived` remains a presentation fact derived from the separate progress result. All other builder declarations and receipt behavior are unchanged. The browser witness copies this hook into its app and resolves its generated API import there.

`harness.mjs` adds paired bracket/residual operations and one held compatibility control. `history.test.mjs` runs public `createClient`/`createLocalClient` with real SQLite process and wasm devices. It stages acquisition, reopens offline before catch-up, holds terminal publication, and additionally holds the wasm persistence commit. Both ordinary observations remain mounted through an actual delayed leave sync. It exercises empty and 10,000-message groups, exact floor and below-floor pages, residual filtering and ascending order, server denial of media access, remount, offline reopen and rejoin. Original mutations create the small/empty groups, send text/media, remove/add members and send after departure.

The builder's selected history index orders `(conversation, ordinal, id)`. A separate fixture changes that one index to `(conversation, at, id)` and seeds 10,000 messages in timestamp ties, including a tie straddling the 500th full-key floor. This is explicitly a boundary test variant, not a rewritten calibration schema. The small isolated ordinal/time fixtures use bulk seed for the large message population; the full-store arm uses the builder's existing 10,000-message group and original membership mutations.

The full-store arm copies the supplied SQLite, WAL and assets with `cp --reflink=auto` into a fresh ignored directory under this worktree. Only copies are opened by engines. The scale admin's fixture login is read only to authenticate to the private copy; no credentials are recorded. The original program, logs, SQLite and WAL hashes are checked against P19's manifest. The original `../builder.q` is also compiled unchanged by the Rust regression.

From `snapback4/`, after building the binary, wasm and client:

```sh
cargo test -p snapback4-lang --test selected_prefix
node --test experiments/p19-one-query/equality/history.test.mjs
EQ_FULL_STORE=1 node --test experiments/p19-one-query/equality/history.test.mjs
node --test experiments/p19-one-query/equality/browser.test.mjs
python3 experiments/p19-one-query/verify-inputs.py
```

`EQ_EVIDENCE` overrides the read-only calibration directory; set `P19_EVIDENCE` too when using its integrity check. Test state and full snapshots stay in `.work/eq-*`; the [report](../../../reports/20260928-eq/REPORT.md) retains compressed query snapshots with hashes. Unpack any `*.jsonl.gz` with `gzip -dc` to inspect real public answers, raw device observations and query request paths.

The React witness uses Chromium, IndexedDB, the real client and the copied hook. It delays route/progress device results, checks composer DOM identity, focus and draft, and checks retained IDs through remount, offline reload and rejoin. This is not an Expo simulator witness. Native Expo execution remains an explicit qualification gap on this Linux host; neither the process device nor browser emulates that proof. No §7.2–§7.5 or calibration-score claim follows from EQ.
