# Snapback 4 journal

Append-only, dated. What actually happened against LLP 3000 §5's plan. Never
rewrite an entry; correct it with a later one. Decisions that must outlive this
file go to LLP 3000 §7.

## 2026-09-12 — the clock starts

- Author accepted the bakeoff (LLP 3000 decisions 1–8) and said "go".
- LLP 2000, 2000.000 and 3000 landed on `main` as `638b74fb9f`, with the
  Snapback 2 substrate freeze in `rules/NOT-DOING.md`.
- This commit is the fence: `snapback4/` with its own Cargo and Bun workspaces,
  the card contract (`packages/snapback4/src/contract.ts`), a binary that only
  knows `--version` and `doctor`, `scripts/test.sh`, this journal, the
  not-doing list, and the root routing lines. The four-week clock runs from
  this commit's landing; its SHA is recorded in the next entry.
- Lane: `~/projects/snapback-sb4`, branch `sb4/root`. Toolchain: Rust 1.97.0
  (pinned), Node 24.18.0, Bun as installed at the root.
- Decision taken today: the simulator is written in Rust and hosts the Rust
  server core; whether it hosts the client through a Rust client core or
  through an embedded JS engine running the TypeScript client is decided with
  the week-3 byte measurement (LLP 2000.000 §9). Recorded in LLP 3000 §7 when
  the skeleton lands.
- Decision taken today: the Snapback 2 corpus and `ir-contract.json` are copied
  in week 1 (they are the contract any interpreter is held to); the Rust
  engine pieces are copied in week 2 as the engine needs them, split on the
  way in, rather than wholesale now.
- Not yet measured: the five floors (LLP 3000 §5, week 1). Next entries.

## 2026-09-12 — the fence landed; the five floors

- The fence is `961a3eb1c5` on `main`. The four-week clock runs from it:
  the first slice is due on the hub fixture by 2026-10-10.
- Toolchain (author, same day): `tsc` to typecheck, `rolldown` to bundle and
  to measure bytes, `oxc` to transform and minify; esbuild only with a reason
  written here first. Recorded in LLP 3000 §7.
- The Snapback 2 corpus (295 cases) and `ir-contract.json` are copied to
  `corpus/`; nothing reads them yet.

### The physical floors (LLP 3000 §5, week 1)

Machine: Apple M5 Max, 128 GB, macOS 26.6.2; Node 24.18.0 (`node:sqlite`,
bundled SQLite); Chromium from the Playwright cache (`chromium-1243`), headless.
Rows are the frozen Clique scale log's own text sends (`floors/rows.mjs`):
99,090 messages across 901 conversations, about 204 bytes per row as a
partition-log envelope. Scripts under `floors/`; each prints one JSON line.

| Floor | What | Result |
| --- | --- | --- |
| 1. One response | 10,000 envelopes as JSON | 2.04 MB raw; gzip-6 207 KB in 6.7 ms; gzip-9 189 KB in 36 ms; brotli-5 103 KB in 12 ms |
| 1. One response | all 99,090 envelopes | 20.3 MB raw; gzip-6 2.0 MB in 59 ms; brotli-5 1.18 MB in 92 ms |
| 2. IndexedDB write | 10,000 rows, one transaction (message + log row each) | 197 ms |
| 2. IndexedDB write | the same 10,000 rows as 200 transactions of 50 | 197 ms |
| 2. IndexedDB write | 99,090 rows in chunks of 5,000 | 2,270 ms |
| 2. IndexedDB read | one thread page of 50 through the compound index | 0.6 ms |
| 3. SQLite write (native, WAL) | 10,000 rows, one transaction | 31 ms (`synchronous=NORMAL`), 22 ms (`FULL`) |
| 3. SQLite write | the same as 200 transactions of 50 | 46 ms (`NORMAL`), 49 ms (`FULL`) |
| 3. SQLite write | 99,090 rows in 20 transactions | 375 ms |
| 4a. Local query, JS | index build over 99,090 rows; thread page via the index; full-scan page; body substring search | 5.7 ms; 0.14 µs; 1.1 ms; 2.8 ms (heap +12.7 MB) |
| 4b. Local query, SQLite | thread page via `byConvTime`; `count(*)`; `LIKE` scan | 26 µs; 1.0 ms; 5.9 ms |
| 5. Send fan-out | 1 message + 1 partition-log row + 50 recipient-log rows, one durable transaction | 0.15 ms per send (`NORMAL`), 0.34 ms (`FULL`) |

What the floors say. Acquiring 10,000 messages is bounded below by about
7 ms to compress, 200 KB on the wire, and 200 ms to write on the web or
30 ms on native SQLite: roughly a quarter of a second on the web and well
under a tenth on a phone before rendering. Snapback 2's measured 28.4 s for
the same content sits about 140× above the web floor and about 900× above
the native one; the 2× target LLP 3000 §3 sets is therefore about 0.5 s on
web and 0.1 s native for the 10,000-row tier, to be restated for the hub
principal's full partition once its horizon is chosen. A 50-member send
costs a third of a millisecond durably; fan-out on write is not the cost.

Not measured: `expo-sqlite` on a device or simulator (floor 3 uses native
SQLite through Node as its stand-in; the Expo witness lane should confirm
the constant in week 4); a real network; a mid-range phone. These are
recorded as gaps, not estimated.
