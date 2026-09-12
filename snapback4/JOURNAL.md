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

## 2026-09-12 — simulator skeleton; checkpoint `1700c1c755`

- `crates/snapback4-sim` landed in `1700c1c755` with the floors and the
  corpus. Zero dependencies. Nine tests pass in the workspace: two on the
  seeded generator, two on the disk model, four on the replicated-counter
  witness, one on the binary. The witness runs 20 seeds × 16 kills under
  rough faults (20% drop, 10% duplicate, delays 1–40 ms, 15% fsync failure)
  holding at-most-once and acked-is-durable after every event, then heals
  and converges with every minted op landed exactly once; same seed gives
  the same trace digest; a partition heals.
- What the skeleton does not do yet: host the real server (week 2). Of LLP
  3000 §6's seven invariants, the witness carries 3, 4, 6 and 7 in
  miniature; 1, 2 and 5 wait for the real client and the card.
- Decision recorded in LLP 3000 §7: the simulator is Rust; how it hosts the
  client is decided at week 3 with the byte measurement.

## 2026-09-12 — the chat app against the card, on a mock

- `packages/snapback4/src/mock.ts` (141 lines, labelled MOCK everywhere) and
  `src/react.tsx` (105 lines: provider, `useQuery`, `usePage`, `useMutation`,
  `useLink`, `useViewer`) sit on the card. `apps/chat` is the reference app
  on that mock: `Thread.tsx` is 26 lines, `Composer.tsx` 22, `Inbox.tsx` 14;
  the only words the screens read are `data`, `complete`, `fresh`, `since`,
  `next`, `pending`, `denied`, `loading`, and the write's three states.
  There is no `shared/thread.ts`, no bindings, no recovery code.
- `apps/chat/snapback/schema.q` is the Snapback 2 chat schema with `sync`
  lines added per table — `sync public last 2000 by byHandle`, `sync to
  memberships[.id]`, `sync to memberships[.conversationId] last 500 by
  byConvTime` — and a `maintain` delivered into the partition as a value.
  Nothing compiles it until week 2; it is the desired dialect, written first.
- Toolchain proof: Vite 8.3.0 (rolldown 1.2, oxc minify) builds the app in
  297 ms: 229,171 bytes raw, 71,080 gzip-9, of which the SDK and app are a
  few kilobytes and React 19 the rest. The online-tier budget (LLP 3000 §3)
  is measured on the SDK alone once it is real; this number is the toolchain
  working, not a client size.
- The blocking suite now typechecks the package and the app beside
  `cargo test`; 0.9 s wall on this machine.
- Card amendment (lead): `since` is the wall-clock time of the newest server
  state a stale read reflects, so a screen can say "as of 3:12". Three type
  guards (`isReady`, `isLoading`, `isDenied`) join `contract.ts`.

## 2026-09-12 — `snapback4@0.0.1` on npm; the loop measured

- `scripts/publish.mjs`: build with `tsc` (ESM + declarations, `.ts`
  imports rewritten), `npm pack`, then an installed-consumer proof in a
  fresh directory — the tarball plus React and TypeScript from the registry,
  a `.tsx` that typechecks against all three entry points, and a runtime
  script that runs a query and an online and an offline write through the
  mock — and only then `npm publish`. The dry run passed first; the real
  publish followed: 5,833-byte tarball, 8 files, 3.1 s end to end
  (`metrics/publish.jsonl`). This is the client package only; the platform
  binary packages come with a binary that does something (week 2).
- `scripts/measure.mjs --check` appends the loop's numbers to
  `metrics/loop.jsonl` and fails on a missed budget. First record at
  `39af0c81a6`: blocking suite 2.18 s (budget 60), incremental rebuild
  0.11 s (budget 15), chat app 229,175 raw / 71,073 gzip bytes, production
  binary 286,112 bytes.
- The blocking suite now builds the package to `dist/` before the app
  typechecks, so the app consumes the package exactly as a consumer would.
