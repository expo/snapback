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

## 2026-09-12 — the hub fixture wrapper landed (Codex lane)

- `fixtures/clique.mjs` (Codex gpt-6-astra, xhigh, in `~/projects/snapback-sb4-fixtures`,
  brief in `~/projects/snapback-sb4-lanes/fixtures/`) replays the frozen
  social-messenger action log into JSONL seed tables. Verified outside the
  sandbox on Node 24.18.0: 9/9 tests in 5.0 s; `stats --log scale` prints
  1,000 users, 5,909 follows, 48,200 posts, 1,000 conversations, 2,048
  memberships, 100,000 messages; `u0001` has 1,000 memberships, `u0500` 500
  follows; 99,090 text and 910 media sends; the largest conversation is
  `g0001` with 10,000 messages; the manifest check passes including both
  checkpoints. The lane touched nothing outside `fixtures/`.
- The fixture tests join the blocking suite (5 s of the 60 s budget). Node
  24 is now declared in `engines`; the lane found the ambient Homebrew node
  is 25.9 and selected 24.18.0 explicitly — run the suite with the pinned
  runtime on PATH.
- Week one, day one, is complete apart from the expo-sqlite floor (week 4).

## 2026-09-12 — week two, day one: the server core runs the chat schema

- **Quarry is bound in Rust, not TypeScript.** Snapback 2's compiler is a
  TypeScript worker the Rust binary spawns; Snapback 4's `snapback4-lang`
  crate ports the lexer and parser (with `sync` in place of `deliver` and a
  continuation line for shapes) and binds to the core IR in Rust. `check`
  on the chat schema takes 3–6 ms with no other runtime, the simulator can
  compile programs, and one grammar serves every host. Recorded in LLP 3000
  §7. Ported from `snapback2/packages/compiler/src/quarry/`, split across
  `lexer.rs`, `parser.rs`, `bind/{catalog,schema,program}.rs`; the binder
  is written fresh against the IR rather than ported (the Snapback 2 binder
  carries receipt-era typing).
- **The IR and value model are Snapback 2's, in their serialized form**, so
  the conformance corpus runs unchanged against the engine as a server with
  exactly the rows the twin held: 172 comparable cases pass, 0 fail, 121 are
  skipped as receipt-, pricing-, search- or asset-era forms (the harness
  names each reason). Maintained rows keep the corpus's canonical-key id.
- **The store is one key encoding.** Two SQLite tables carry every table:
  row images by (table, id) and index entries as one order-preserving byte
  key (`key.rs`: the value model's total order, self-terminating, so a
  prefix is a byte prefix). A point lookup, a prefix scan, a cursor position
  and a cap count are all one B-tree range. The same encoding is what the
  IndexedDB store will use in week 3.
- **The meter replaces the certificate's prices.** Examined rows, index
  entries, rule probes, steps, heap, output bytes and rows written are
  charged as a program runs; a query past a ceiling returns `complete:
  false` with no continuation; a mutation aborts with `E_BOUND` naming the
  meter, the actual, the ceiling and the site. Snapback 2's uniformity and
  `decided_true` hoisting are copied: `check --cost` prints each site's
  structural class (decided by the prefix / one verdict / per row).
- **The partition log.** `sync public | to .col | to target[.prefix]` with an
  optional `last N by index` horizon. Binding checks the read rule carries
  the matching disjunct, resolves the target's principal column, and demands
  the two indexes the engine needs (group → principals, principal →
  groups). Every row change fans out `put`/`del` events per recipient; a
  target row appearing bootstraps the group's rows (within the horizon) to
  the new member and disappearing sends one `scope` tombstone; a fresh
  device takes a snapshot then follows the merged stream (own partition +
  `public`) from its watermark, pages never split a commit. A `maintain`
  grouped by the audience inherits it and is delivered as a value row.
- **At most once.** A mutation carries a client-minted id; the engine records
  the outcome under `(principal, id)` and a replay returns it. Ids are 26
  base32 digits (48 bits of ms, 80 of entropy), the same on the device.
- **The binary and the wire.** `init`, `check [--cost]`, `dev` (serves on
  127.0.0.1:4400, re-adopts the schema on every save and prints the
  day-two class of the change), `run`, `test [--fixture dir]` (prints the
  meters beside the ceilings per persona), `why <code|op|table>`, `guide`,
  `data`, `doctor`. The wire is `POST /q/<op>`, `POST /m/<op>` (with `id`
  and `newIds`), `GET /sync?from=W` (snapshot at 0), `GET /changes?since=S
  &wait=25` (long poll), `POST /seed`; plain JSON, typed by the declared
  arguments; personas by `x-snapback-persona` on loopback.
- **The client.** `packages/snapback4/src/client.ts` is the online tier on
  the card: reads are `fresh` when the server answered and carry `since`
  when it did not; observed reads re-run when a commit touches their tables;
  writes are sent with a minted id and wait as `pending` while the link is
  down. `snapback4 check` writes `snapback/generated/api.ts` with the row
  types and every operation's argument and result types by inference;
  `apps/chat` now imports it and the real client (the mock stays in the
  package, labelled). Operations in `schema.q` are `api.<name>`; a module
  `snapback/feed.q` gives `api.feed.<name>`.
- **The simulator hosts the real server.** `crates/snapback4-sim` gained
  `host.rs` (the engine as a host under the virtual clock), `replica.rs` (a
  device: replica, watermark, durable outbox, predictions the stream
  replaces, screens counted by the card's words) and `chat.rs` (three
  devices on the chat schema under rough faults, kills of devices and the
  server, one member leaving). LLP 3000 §6's invariants 1, 2, 3, 5 and 6
  are checked after every event; 4 and 7 at quiescence; a seed replays to
  one digest. Three seeds run in the blocking suite.
- Not yet: authentication beyond personas (H0, week 4), effects execution
  (the outbox fills; no host runs it), jobs and `chunk` at runtime, word
  search, assets, the web replica (week 3).
- Loop numbers at this landing (`metrics/loop.jsonl`): blocking suite 27.2 s
  (of 60; the chat simulation is 16 s of it, in debug), incremental rebuild
  0.25 s, chat app 71,101 gzip bytes (React 19 is most of it; the client is
  measured alone once the replica lands), production binary 2,010,800 bytes
  with SQLite and the engine inside (PocketBase, the anchor named in LLP
  2000.000 §12, ships ~30 MB).

## 2026-09-12 — week three, day one: the local-first tier on the card

- **The replica store is the server's layout on the device.** `key.ts` is
  the key encoding byte-for-byte (held to vectors printed by
  `cargo run -p snapback4-core --example key_vectors`); `store.ts` keeps rows
  by (table, id) and index entries by `[table.index, key bytes]` — in memory
  for tests and the twin, in IndexedDB on the web, where a compound key of a
  string and an ArrayBuffer sorts exactly as the server's B-tree does.
  Every read is one transaction; every applied page commits with its
  watermark.
- **One interpreter, second host.** `interpreter.ts` runs the same IR the
  server runs (the programs come from `GET /schema`, bound to a generation)
  over the store: the meter, opaque cursors identical to the server's
  (`cursor.ts`), rules with probes over the replica, and predictions —
  a mutation runs locally, its rows render `pending`, unique/cap/immutable
  refuse typed, maintained counts move with it. A page is `complete`
  inside the horizon and not at it; an online-only site is never complete.
  Six interpreter tests on the compiled chat backend pass.
- **The local-first client (`snapback4/local`)** is the card: `Read` with
  `fresh` = caught up and online, `since` otherwise; observed reads re-run
  when an applied batch or a prediction touches their tables; `Write` is
  `pending` until the outbox lands it, `sent` with the server's sequence, or
  `failed` with the refusal and its predicted rows withdrawn. A generation
  change re-bootstraps the partition; the outbox survives it. The chat app
  runs on it; `snapback4/client` remains the online tier.
- **Witness:** two devices on one `snapback4 dev`, memory stores: a send
  reaches the other device through the stream; a device offline renders its
  queued send `pending` with `since`; back online it lands and both devices
  hold the server's images; a stranger's local read is `MEMBERSHIP_REQUIRED`.
  In the blocking suite.
- **Bytes, one toolchain (Vite 8.3 / rolldown / oxc, React external,
  gzip-9), `scripts/measure-client.mjs` → `metrics/client.jsonl`:** online
  tier 3,176 B; local-first tier 13,957 B (interpreter, store, replica,
  cursors, key). Anchors measured the same way: Convex's React client
  (`convex@1.45.0`) 21,713 B; PowerSync's web client (`@powersync/web@2.3.1`
  + react) 3,697,919 B with its wa-sqlite chunks. LLP 3000 §3's two byte
  gates hold with room; the twin over the replica came in under LLP
  2000.000 §9's 20 KB, so TypeScript stays on the web.
- **The Chromium witness (`witness/idb.mjs`)** drives system Chrome through
  playwright-core on a harness page bundled from the package source against
  a real `snapback4 dev`: the replica syncs 305 rows into IndexedDB in
  59 ms, a thread page reads `complete` with a cursor, a send with the link
  cut is `pending` and the local read says `fresh: false` with `since`; a
  reload finds the 305 rows in IndexedDB before the client opens, reopens
  in 4.5 ms, and the queued write lands with the watermark advanced.
  `metrics/witness.jsonl` carries the line. The playwright Chromium cache
  is gone from this machine; the witness falls back to `/Applications/
  Google Chrome.app`.

## 2026-09-12 — week four, in advance: H0 — identity, deploy, rollback, serve

- **Identity (`crates/snapback4-core/src/identity.rs`).** `use identity`
  (or `guests` / `password`) in the schema opens `POST /auth/guest`
  (a `guest:<id>` principal) and `POST /auth/signup` and `/auth/login`
  (`user:<id>` behind argon2id; one refusal for a wrong email or password),
  `POST /auth/logout`. A session is a 32-byte token whose SHA-256 digest the
  store keeps for 90 days; the token itself is never stored. The wire takes
  `authorization: Bearer <token>`; `snapback4/auth` is the client's door.
- **Two doors, by mode.** `dev` admits `x-snapback-persona` from loopback
  and `POST /seed`; `serve` (a release) refuses both with a refusal that
  names the other door. Copied in spirit from Snapback 2's "`serve` refuses
  personas" (LLP 1002 §1).
- **Deploy and rollback (H0, LLP 1015 §7 in miniature).** `snapback4 deploy
  <dir>` compiles the project, classifies the change against the current
  release with the day-two classifier (a destructive change needs
  `--allow-destructive`), copies `snapback/*.q` into `<dir>/releases/N/`,
  installs the schema into the directory's one shared store and records
  the generation, sets `current`, and appends to `releases.jsonl`.
  `snapback4 rollback <dir>` moves `current` back and re-installs.
  `snapback4 serve <dir> --port N --bind H` runs the current release on
  the shared store with tokens only. Exercised end to end on the chat app:
  two deploys, a served release refusing a persona, a guest reading an
  empty inbox, signup, a wrong password, login, seeding refused, logout
  making the token dead, rollback to release 1 with the ledger.
- Not yet: a hosted target (the release runs wherever the binary runs), TLS
  (a proxy's job in slice one), secrets (`snapback4 secret`), effects.

## 2026-09-12 — week four: day two in the simulator

- **Generations.** `Engine::adopt` returns the next generation and records
  it in the store's meta; every reply on the wire and from the simulator's
  server host carries it. A device that sees a generation other than the
  one it holds clears its rows, resets its watermark to 0 and re-derives
  its partition from a fresh snapshot; the outbox and its predictions stay
  (the predictions are re-derived from the queued writes). The web replica
  does the same: `local.ts` reloads `/schema` when the stream's generation
  moves, and `replica.ts` re-bootstraps on the next round.
- **Replays before judgement.** A resend of a write that already applied
  is answered with its recorded outcome before the current generation
  decodes its arguments (`Engine::replay`, consulted by the server and the
  simulator host ahead of argument decoding). The day-two scenarios found
  the bug: under a narrowing or a rename, an old client's resend of an
  applied `send` was refused `E_INPUT` and the device withdrew a row the
  server holds.
- **Five scenarios (`snapback4-sim/src/chat.rs`, `day_two`)**: additive
  (an optional column), widening (an enum variant), narrowing (`body` to
  five characters), rule change (the read rule and the horizon), rename
  (`body` → `text`). Alice loses the link and keeps sending; the server
  adopts the change; the link heals. Additive and widening: every queued
  write lands, every device re-bootstraps once, convergence holds.
  Narrowing and rename: the queued writes fail typed (`E_INPUT`, "send
  takes no argument body" / "body: at most 5 characters"), their
  predictions are withdrawn, nothing is dropped silently. Rule change:
  classified `RuleChange`; every partition re-derives; bob held every
  message before and fewer than the server after (the horizon is three).
  The monotone-watermark invariant is now per generation.
- **The classifier.** `Optional(a) → Optional(b)` classifies as `a → b`
  (it said Destructive); optional → required is at least Narrowing;
  required → optional at least Additive.
- **A SQLite replica store (`replica/sqlite.ts`)**: the server's two-table
  layout on `node:sqlite` and `expo-sqlite` behind a four-method driver
  (run, all, transaction, close); one test runs pages, counts and
  predictions on it.
- Suite 36 s (all of `scripts/test.sh`).

## 2026-09-12 — the two blind reviews, and the core after them

LLP 3000 decision 4 reserved two blind reviews, one per model family, for
the two disclosure-sensitive mechanisms. Both ran read-only on
`ce597c58a06d`; both said NOT READY; both are recorded whole in
`llp/reviews/3000-partition-inversion.gpt.md` (Codex, gpt-6-astra) and
`llp/reviews/3000-meter-cut.grok.md` (Grok, grok-4.6). Every finding is
reproduced as the reviewer's scenario in
`crates/snapback4-sim/tests/reviews.rs` (eight tests) and, for the device,
in `packages/snapback4/test/interpreter.test.mjs`. Dispositions:

**Partition inversion (gpt).**
1. *A principal named `public` turns private delivery public* — fixed:
   principal partitions are tagged (`p:<principal>`), the public partition
   is `public`, and no name collides.
2. *Validation ignores the probe's index; the audience is reconstructed from
   names and types* — fixed: `schema::audience_binding` proves the audience
   from the read rule's probe. The rule must be exactly
   `exists target[.prefix, viewer]`; the target index that probe uses is
   the audience index; its column at the viewer position is the recipient
   column (`by .other` is refused with the rewrite). `partition.rs`
   delivers by that binding and nothing else.
3. *An oversized commit advances the watermark past undelivered
   revocations* — fixed: a commit larger than the page is delivered whole
   (`Tx::read_log_seq`); `more` is recomputed from the returned watermark.
4. *A membership inserted and deleted in one transaction delivers rows* —
   fixed twice over: when a grant ends, the same commit's puts to that
   principal for that group are withdrawn before the scope is logged; and
   `partition::append` coalesces a row's events within a commit to the
   last (a put then a delete logs the delete alone).
5. *A synced aggregate can count unreadable source rows (core API)* —
   fixed: `validate_maintain` requires a delivered aggregate's audience to
   be its source's, grouped by the audience columns, unless the source is
   public.
6. *Horizons are acquisition limits, not maintained partition limits* —
   accepted as the design and written into §7: the horizon bounds what a
   snapshot or a bootstrap acquires; a device holds what was delivered;
   a local read past the horizon says `complete: false`. Exact horizon
   maintenance (evictions and back-fills) is in NOT-DOING.
7. *Deleting one of several membership rows revokes a still-authorized
   group* — fixed: the audience index must be unique.
8. *A matching disjunct does not establish the complete audience* — fixed
   by refusal: the read rule is exactly the sync's probe (or exactly
   `.column = viewer`); a second disjunct or a conjunct is a diagnostic
   with the rewrite. Union audiences (several `sync` lines per table) are
   in NOT-DOING until an app needs them; `retain delivered-history` covers
   the author who keeps their own rows.
   The undetermined item — a snapshot page that did not clear the rows a
   device held — is fixed in `replica.ts` (`apply` clears on a snapshot).

**The meter's cut (grok).**
- H1 *`complete` is "the meter did not cut", not Snapback 2's opaque
  `Capped`* — fixed: `complete` is a class. A query with a scan whose read
  rule the prefix does not decide is `complete: false` whatever the meter
  found (`Runner::non_uniform`); a capped-class page's `next` continues
  from its last visible row when the page is non-empty and is absent when
  it is empty, so the presence of `next` says nothing about hidden rows.
  Merges inherit the class from their lanes (M2).
- H2, H3 *`metered` and `capped { meter, site }` on the wire* — fixed:
  `/q` and `/m` carry `data`, `complete`, `seq`, `next` and the write
  state; the meter's numbers stay in-process for `test`, `check --cost`,
  `run` and `why`.
- H4 *a miss charges index entries, a hidden hit charges examined rows and
  probes* — fixed: one examined row whether absent, hidden or visible; the
  probes that decided a hidden row are rolled back (`Meter::mark` /
  `restore`, Snapback 2's `rollback_candidate`).
- M1 *hoisted-false costs one row, empty costs none* — fixed: the
  uniform-false verdict restores the meter to before the determining row.
- M3 *`E_BOUND` names actual work* — fixed: the refusal names the ceiling,
  never the count; a failed write carries no `metered`. The site stays
  (it is the builder's rewrite target); that it names which scan crossed
  the ceiling is the recorded residual.
- M4 *the device does not hoist* — fixed: `interpreter.ts` carries
  `visibility` (uniform, decided-true, the self-probe case), one verdict
  per uniform range, and the same rollback; delivered history a viewer may
  no longer read is decided by one row. The device's `complete` still
  speaks of the horizon and the meter alone: a device holds only its
  partition, so there is no hidden population to class (§7).
- L1 *a cut probe still looks up* — fixed: no lookup, no verdict.
- Not measured: timing (the review was timing-free by brief). No
  count-over-scan primitive exists in Snapback 4's Quarry, so H1's class is
  the only completeness word; a forged cursor on a capped-class scan
  returns `complete: false` like any other page.

Follow-up worth a diagnostic: `check` could say "this scan is never
complete: the read rule is not decided by the prefix; scan by an index that
leads with the rule's columns", as Snapback 2's structural facts did.

The chat schema binds unchanged under the stricter validator. Bytes after
the device hoist: online 3,218 B gzip, local-first 14,846 B gzip. The
blocking suite: 0 failures.

## 2026-09-12 — the Snapback 2 Clique 0.0.29 run report, read against Snapback 4

The author's report on the Snapback 2 run (`benchmarks/runs/2026-09-12-
snapback2-clique-0029/README.md`) names five structural problems. Where
Snapback 4 stands on each, and what it owes:

- *Client coordination reaches application code* (auth restoration, query
  coverage, freshness, durable write admission, navigation). Here: one
  client over the viewer's partition, so coverage is not the app's; the
  card carries `fresh`/`since` and `pending`/`sent`/`failed`. Owed: the
  client restores its own session (the token kept beside the replica, one
  `createLocalClient` call from a cold start), so nothing but navigation
  is the app's. Next.
- *Cold sync expensive enough to feel broken* (62 s, 748 MB heap). Here:
  the snapshot is bounded by the horizons and applied in pages of 2,000
  events; 305 rows took 59 ms in Chromium. Owed: a witness at scale
  (thousands of rows across many groups) with wall time and JS heap on the
  line in `metrics/witness.jsonl`. Next.
- *Storage amplification* (70% indexes; recipient delivery records). Here:
  the partition log is one row per recipient per event with the row image
  in each — the same shape of cost. Owed: measure `_log` against `r` on a
  scale fixture (`snapback4 data` reports bytes per table), then keep one
  image per commit and reference it from the per-partition rows, and
  compact below every device's watermark. Measure first.
- *Bounded-algorithm design for ordinary features.* Here: no word search
  in slice one; day two is one verb and a classifier, with typed refusals
  for what no longer fits; the meter names the site. Watched in the hub run.
- *No byte headroom* (89,993 of 90,000). Here: budgets are anchored to a
  competitor's measured number (Convex React 21,713 B gzip; the online tier
  is 3,218 B, the local-first tier 14,846 B), so correctness work is not
  a byte-integration problem.

The localized ones — photo retry after a transient refusal (assets are not
in slice one; when they come, `retryable` refusals retry in the client, not
the app), misleading compiler advice (every diagnostic here carries its
rewrite; the hub run judges them), vacuous tests and stale receipts (the
fixture wrapper fails on any mismatch and the loop bar records N≥3) — are
the hub run's to catch, and the run record will say whether they did.

## 2026-09-12 — the client owns its session; cold sync and storage at scale, measured

- **Session restoration (`snapback4/local`, `snapback4/auth`).** A device
  keeps its session itself: `createLocalClient({ url, session })` keeps the
  session from `guest()`/`login()`/`signup()`; `createLocalClient({ url })`
  restores it on the next start; `guest: true` mints one when none is kept;
  `signOut()` ends it on the server and forgets it; a session the server
  refuses (`E_AUTH`) is forgotten and `session()` reads null, so the app
  shows sign-in and nothing else. The store is `localStorage` on the web,
  memory elsewhere, or whatever the app passes (`expo-secure-store` fits
  behind three methods). The `"token"` placeholder principal is gone: a
  session names its principal, and predictions carry it. Nothing but
  navigation is the app's. Test: a cold start mints a guest, the next start
  is the same principal, sign-out kills the token on the server, a fresh
  start with `guest: true` is someone new.
- **Cold sync at scale (`witness/scale.mjs`, release binary).** Bob holds
  40 groups × 500 messages × 10 members: a 5.2 MB snapshot of 20,480
  events. A fresh Chromium page syncs it into IndexedDB in 4.4 s with the
  JS heap at 26 MB after; a thread page reads in 6 ms, the inbox (40
  conversations with counts) in 17 ms; a reload reopens in 3 ms. Snapback
  2's run: 62 s and 748 MB. `metrics/witness.jsonl` has both lines
  (debug: 3.7 s, the same heap).
- **Storage at scale (`scripts/measure-storage.mjs`, `snapback4 doctor`'s
  new `storage` line).** The same seed on the server: rows 5.2 MB (20,480),
  index entries 2.2 MB, the partition log 56.6 MB for 204,800 events —
  **10.8× the rows** — and the file 78 MB (14.9×). Seeding took 4.0 s on
  the release binary (31.7 s debug): 204,800 log inserts for 20,440 rows.
  This is the recipient-delivery amplification the Snapback 2 report
  names, in Snapback 4's own shape: the log writes every event once per
  recipient, image included. Next: a group-keyed log — a target audience's
  events logged once under the group, a device's stream merged from the
  groups it holds over the intervals it held them, joins expanded at stream
  time — so a message costs one log row however many members. The
  reviews' tests and the simulator's invariants are the safety net for
  that change.
- The Chromium witnesses share `witness/lib.mjs` (the bundled harness, the
  seeded dev server, a CDP session for the heap); `SNAPBACK4_BIN` picks the
  binary under test.

## 2026-09-12 — the log is keyed by group

- **What changed (`partition.rs`).** A row of a table that syncs to a
  target is logged once, under its group's partition
  (`g:<table>:<group>`); a principal's own partition (`p:<principal>`)
  carries the rows that name it by column and a `join`/`scope` event per
  content table for every group it enters or leaves; `public` is as it was.
  Writing a row no longer scans the audience at all. A device's stream is
  the merge of its own partition, the public one, and each group it held
  over the interval it held it — intervals reconstructed from its
  memberships now and the joins and scopes logged since its watermark,
  `[join, leave)`, so a join and a leave in one commit deliver nothing
  (finding 4 of the partition review holds by construction). A `join` is
  expanded to the group's rows (within the horizon) when it is streamed
  and only while the membership still stands; it never reaches a device.
  Pages are still whole commits; `more` looks past the watermark in every
  partition the device holds.
- **Numbers, release binary, the scale seed (40 × 500 × 10):** the log
  weighs 6.0 MB for 22,080 events — **1.15× the rows** (was 10.8×, 204,800
  events); the file 16 MB (was 78); seeding 2.1 s (was 4.0). Cold sync
  into IndexedDB 3.3 s, heap 26 MB, unchanged in shape. A message costs one
  log row however many members read it.
- Read cost moved to the stream: a poll reads `2 + groups × tables` short
  ranges (bob: 162). Fine at this scale; a principal in thousands of
  groups is the next ceiling to measure, and `partition IN (...)` the
  likely answer.
- Every invariant, day-two scenario and review test passes on the new
  log; the lang crate's chat test now expects one put per group, not one
  per member.

## 2026-09-12 — the Expo arm, and the package with the binary on it

- **`apps/chat-expo`**: the chat app on React Native, on the same client
  and the same generated `api.ts` as the web app. The device holds its
  partition in SQLite (`expo-sqlite` behind `snapback4/replica`'s
  four-method driver), keeps its session in the secure store, mints a
  guest when it has none; a screen is a query plus JSX, as on the web.
  `createLocalClient` takes a store opener for hosts that bring their own
  store.
- **The simulator witness (`witness/expo.mjs`)**: Expo Go on the booted
  iPhone 17 Pro simulator against a real `snapback4 dev`; the app runs the
  scenario itself and posts its report. 303 rows sync into SQLite in
  209 ms; a thread page reads 50 rows `complete` with a cursor; the inbox
  count is 300; a send is `sent`; a second open of the same file finds the
  301 rows and reopens in 22 ms. The line is in `metrics/witness.jsonl`.
- **Expo tooling notes.** The workspace installs hoisted (`bunfig.toml`),
  since Metro could not bundle from bun's isolated layout. `expo install
  --fix` pins the SDK 57 versions (React Native 0.86). `expo export`'s
  bytecode step still resolves an old `hermes-compiler` (0.14.1, "private
  properties are not supported") under bun; development bundles and Expo
  Go do not go through it. A follow-up for the production build.
- **`npx snapback4`**: the client package carries the CLI. `bin/snapback4.js`
  finds the binary in `snapback4-darwin-arm64` (an optional dependency, the
  release build copied in at publish time), or `SNAPBACK4_BIN`, or this
  repository's build. `scripts/publish.mjs` builds the binary, packs both
  packages, proves them from an installed consumer (`snapback4 --version`
  runs; the mock client works) and publishes the platform package first.
  Versions move together: 0.0.2 (the Cargo workspace too).

## 2026-09-12 — snapback4@0.0.2 on npm; the Clique run packet

- **Published** `snapback4@0.0.2` and `snapback4-darwin-arm64@0.0.2`
  (`scripts/publish.mjs`: the release binary in the platform package, both
  packed, an installed consumer runs `snapback4 --version` and the mock
  client, then the platform package publishes first). Cold from the
  registry: `npm install snapback4@0.0.2`, `npx snapback4 init`, `check`,
  `guide`, `dev`, one query — the published surface a fresh agent gets.
  The README is now the start packet: the whole surface on one page (the
  shape of an app, Quarry, sync, the client and the card, React, sign-in,
  the mock, development, the wire, release, Expo, and what is not in this
  release).
- **The Clique run packet** (`~/clique-sb4-20260912/`): the repository's
  instrument (brief, contract, protocol, schema, fixtures, UI kit,
  choreography, grader, metering, observability) at the commit in
  `INSTRUMENT_COMMIT`, read-only, with an `ENVIRONMENT.md` overlay that
  strikes media (avatars, photo/video messages, view-once, backgrounds,
  simulator artifacts) and scheduled server-side work (the digest; expiry
  enforced at read time) — as commissioned: "skip media and jobs, astra
  medium". One lane, `astra-snapback4`, codex `gpt-6-astra` at medium,
  ports 49200–49219 (49100–49102 are held by a stale Snapback 2 lane, not
  mine to kill). Phases: the continuous session M1 → M2 → M3 → M4 → M5 →
  M6 → M8; a fresh other-family grade; M7; the record.

## 2026-09-12 — `check` says which pages are never complete; the loop-bar harness

- **`N_NEVER_COMPLETE`** (`bind/mod.rs`, `ir::scans`): after binding, the
  compiler runs the engine's own `scan_visibility` over every page scan;
  a scan whose read rule reads a column the prefix does not pin is noted
  at the operation's site with the rule, the unpinned columns and the
  rewrite (`by byOwner: owner, at, id`, or read it on the device). Notes
  are not errors: `check` prints them after `ok`, `--json` carries them.
  The chat schema has none; the reviews' `notes` schema has one (a test).
- The `sync` guide card said "must contain the matching disjunct"; the
  validator requires the rule to be exactly the audience. The Clique lane
  noticed the difference in its first minutes and chose the stricter
  README. The card now says what the validator does.
- **The loop bar** (`loopbar/brief.md`, `loopbar/run.mjs`): the reduced
  Clique M1–M3 brief for a fresh agent on the published pin (accounts and
  profiles, posts and the follow graph, messaging core; React web; no
  media, no search), with the four-part proof (`check`, a fixture under
  `snapback4 test`, an HTTP acceptance script, a build) and the run log's
  `start=`/`green=` clock. The runner launches N serial codex sessions,
  verifies the proof independently, counts attributed correction loops,
  and records `metrics/loopbar.jsonl` with `bar: true` when a run is green
  within 1,200 s with at most one `snapback4-defect` loop. It runs when
  the machine is quiet: after the Clique lane.

## 2026-09-12 — what the Clique lane's first hour taught

The lane read the README and every card in its first minutes and hit
three things worth fixing at once (all on 0.0.2, which it keeps):

- `read <- public 'reason'` was refused ("expected the end of the line");
  only the table line `public 'reason'` parsed, while the rules card and
  the README listed the reason on the rule. The parser now takes the
  reason on the rule too (a `public` call with one string argument, bound
  to the same `RuleExpr::Public`); the README says both spellings.
- The wire's `/auth/*` shapes were not written down; the lane expected the
  helper's `{ ok, session }` envelope on the wire and normalized. The
  README now gives `{ session: {..} }` / `{ denied }`.
- The choreography harness imports `../../lib/json-schema.mjs` from the
  instrument's sibling `lib/`; the packet lacked it and the lane
  relocated a copy (attributed to the environment). The packet now carries
  `lib/` for the grader and M7 sessions.

The lane also chose Node 25 from its login shell over the overlay's Node
24 and switched to the absolute path — the launcher prepends it, codex's
shell does not inherit that; recorded as environment. M1's iOS Hermes
bundle exported cleanly on the lane's npm install.

## 2026-09-12 — two more from the lane's second hour; 0.0.4

- **A refused prediction surfaced as a page error.** On IndexedDB, a
  mutation the device refuses while predicting (a `require`, a unique
  clash) aborted the transaction on purpose, and the abort's rejection
  reached the page unhandled ("pageerror aborted") beside the `failed`
  write on the card. The lane attributed it to Snapback 4 and moved
  profile writes to the online client. The store now owns that rejection;
  `read` aborts on a thrown body too. A second one behind it: a client
  closed while a sync was in flight tried a transaction on a closing
  database. `Replica.close` now waits for the follow loop, and a sync
  after close is a no-op. The Chromium witness records every page error
  and requires none, with a stranger's refused send on IndexedDB in the
  run.
- **Killing the CLI wrapper did not stop the server.** `bin/snapback4.js`
  used `spawnSync`; a SIGTERM to the wrapper left the binary on its port
  ("Address already in use" on the lane's restart). The wrapper now
  forwards SIGINT/SIGTERM/SIGHUP and exits as the binary does.
- `snapback4 why E_UNIQUE` (the lane's guess) now names the real codes
  and says a unique clash is `E_CONSTRAINT`; `why` explains `E_OFFLINE`,
  `E_PREDICT`, `E_TYPE` and the `N_NEVER_COMPLETE` note too.
- Published `snapback4@0.0.4`. The lane keeps its exact pin (0.0.2); the
  loop bar and the next runs take the latest.

## 2026-09-12 — the loop bar runs beside the Clique lane

`loopbar/run.mjs --n 3 --version 0.0.4` started at 14:31 UTC on this
machine while the Clique lane runs (18 cores, 128 GB; both wall clocks are
recorded as measured, with the parallelism noted here and in the records).
Three fresh Astra sessions at medium, serial, each on the published
0.0.4, each verified independently after it stops. Results land in
`metrics/loopbar.jsonl`; the lanes are under `~/loopbar-sb4-2026-09-12/`.
- The Expo bytecode export works after a clean reinstall: the old
  `hermes-compiler` was a leftover of the isolated-linker install, not a
  version conflict. `expo export --platform ios` writes the `.hbc`; the
  follow-up is closed.

## 2026-09-12 — what the loop bar's first run found; 0.0.5

- **`conversationId ?? 'dm1'` after an optional reference scanned nothing.**
  The text literal on the right of `??` stayed a string when the left side
  was an *optional* identity (`Ty::Optional(Ref)` is not `is_identity`),
  so the key encoded as text and matched no id. Beside `=` and in a key
  the literal was already an id; now it is after `??` too, through the
  required type. Found by the loop bar's first agent within its first ten
  minutes and attributed to Snapback 4, correctly.
- **`snapback4 test` skipped queries with required arguments silently.**
  It now derives arguments from the data and the persona (a reference is
  the table's first row, a principal is the persona, a text is the shortest
  that fits, an enum its first variant), prints the arguments it used on
  each line, and names every query it still cannot run and why.
- The online client's HTTP 400 refusals now reach the card as the refusal
  (0.0.4 said "unreachable"). Published `snapback4@0.0.5`.
- **Loop bar, run 1 (0.0.4):** green in 433 s wall (415 s by the agent's own
  clock), one Snapback-attributed correction loop (the `??` defect above),
  two docs gaps, two agent errors, two environment items; `check`, the
  fixture test and the acceptance script pass under independent
  verification. The bar is met by this run (≤ 1,200 s, ≤ 1 loop); runs 2
  and 3 follow on the same pin.
- The reference web app now keeps a guest session of its own when the URL
  names no persona (`?as=bob` stays the development door), and offers
  sign-out: the shape a fresh agent should copy.
- **Loop bar, run 2 (0.0.4):** green in 572 s, two attributed loops — the
  `??` defect again, and a new one: a merge feed of 20 rows over 28 matches
  answered `complete: true, next: null` because the query declared no
  cursor. The card now says `complete: false` when a cursorless page had
  more rows than it holds (server and device alike), `check` notes such a
  page (`N_NO_CURSOR`, with the `c: cursor ?` rewrite; the chat app's
  `inbox` earns one), and the README says what `complete` means in each
  case and gives `observe`'s shape (an agent-error in run 2 guessed it).
  Run 2 fails the bar on loops; run 3 follows on 0.0.4, then a second set
  of three on 0.0.6, which carries every fix the first set found.
- **Loop bar, run 3 (0.0.4):** green in 567 s, the same two attributed
  loops as run 2. Set A on 0.0.4: three greens at 433, 572 and 567 s
  (every run well inside 1,200 s), the bar met by one of three on the
  loop count, and both counted defects fixed in 0.0.5 and 0.0.6. Set B on
  0.0.6 (three more, `~/loopbar-sb4-2026-09-12-b/`) started at 14:48 UTC.
  Docs gaps the set named: `observe`'s shape (now in the README) and the
  fixture test accumulating rows across runs in the dev store — `test
  --fixture` now runs against a fresh store in memory.
- **The Clique lane at M3: delivered history was unreadable.** Under
  `retain delivered-history` the device kept a left conversation's
  messages but hid every one of them, because the device re-evaluated the
  read rule (`exists memberships[..]`) that the server had already applied
  when it delivered them. Decided: a synced table's rows are the partition,
  delivered under the rule and withdrawn on revocation, so the device does
  not run the read rule on them at all; what `delivered-history` keeps is
  readable through a query without a membership `require` (the server
  refuses the same query once the membership is gone). The device's hoist
  stays for online-only tables. The README says how to write a history
  query. The lane also met the IndexedDB abort a second time (fixed in
  0.0.4; it keeps 0.0.2). Published `snapback4@0.0.7`.

## 2026-09-12 — two more from the runs; 0.0.8

- **Two writes at once left one `pending` on a healthy link** (the Clique
  lane at M3: "acknowledge and send return pending with no failed request
  and do not flush"). A write queued while a flush was running waited for
  the next link change: the flush read the outbox once. It now runs
  another pass whenever a write arrived during the last one. The
  end-to-end test sends two at once and sees two `sent`.
- **A merged feed with a cursor answered `next: null` over more rows than
  the page** (loop bar set B, run 1). Each lane read exactly `take` rows,
  so a lane that alone filled the page could not show there was more. Each
  lane now reads one row past the page, on the server and on the device;
  the second page picks up where the first ended.
- `crates/snapback4-sim/tests/loopbar.rs` carries the loop bar's three
  attributed findings as tests (the merge continuation, the cursorless
  page, `??` after an optional reference). Published `snapback4@0.0.8`.

## 2026-09-12 — from the lane's M4 and set B; 0.0.9

- **`check` accepted a synced table that the first sync refused.** The
  lane's `reactions` synced to a conversation's members with no index
  leading with `conversationId`; `check` passed, `/sync` failed
  `E_SCHEMA` (a 503), and the client showed an empty partition with
  `fresh: false` — silent on both sides. The validator now requires an
  index leading with the audience columns when there is no horizon (the
  rewrite names it); a refusal's status follows its retryability (500 for
  what will not change, 503 for what may); and a device whose partition
  the server refuses makes every read `denied` with that refusal, logged
  once, until a sync succeeds. Test in `tests/reviews.rs`.
- **`snapback4 dev --fresh`**: a store in memory that dies with the
  process, for acceptance scripts that must start from nothing (set B's
  agent found the dev store persisting between runs and moved its
  acceptance into a disposable directory).
- Published `snapback4@0.0.9`.
- **A switch only worked as the last argument.** The flag parser gave
  every `--flag` the next token as its value, so `dev --no-watch --fresh`
  set `no-watch` to "--fresh" and never saw `fresh` — and 0.0.9's
  `--fresh` proof above had passed only because the seeded row was not
  the viewer's to see. Switches (`--no-watch`, `--fresh`, `--cost`,
  `--allow-destructive`) take no value now, and no flag swallows a
  following flag. Re-proven: a fresh instance shows nothing a previous
  one seeded, in either argument order. Published `snapback4@0.0.10`.

## 2026-09-12 — loop bar set B (0.0.6), and `test` on derived arguments; 0.0.11

- **Set B on 0.0.6:** 499 s with three attributed loops (all the merge
  continuation, fixed in 0.0.8); 765 s with none — the bar met; 420 s
  with two (a `--fresh` promise read from a newer README than the pinned
  package, and a pagination investigation the agent closed as correct).
  My independent fixture check refused run 3's `thread` and `members` for
  alice on a derived conversation she is not in — `test` now reports a
  program's own `require` refusing a derived argument as information,
  not a failure, and the runner checks the fixture with every persona.
  One of three met the bar on 0.0.6 as on 0.0.4; set C on 0.0.8 runs.
- Published `snapback4@0.0.11`.

## 2026-09-12 — an observed key returned to; set C's first run; 0.0.12

- **A screen navigating between two components observing the same key
  rendered a stale value** (the Clique lane at M5). React unmounts the old
  component before the new one subscribes; the old one's close removed
  the shared watch, and the new subscriber sat on a watch nothing
  updated. A subscriber returning to a closed key now re-registers the
  watch and refreshes it, on both clients; the end-to-end test closes one
  observer and subscribes another before a change arrives.
- **Loop bar set C (0.0.8), run 1:** green in 366 s with no attributed
  loop — the bar met. My verifier had first failed it: the agent's
  acceptance script started `dev --fresh` on a pin that has no such flag
  (it read a newer README than it installed) and so re-seeded a store its
  own run had filled; and the fixture check on every persona met a
  `require` on a derived argument, which 0.0.8's `test` counts as a
  failure. The verifier now stops servers the agent left running under
  its lane, drops the lane's dev stores before the acceptance script, and
  reads a program's own refusal on a derived argument as information;
  `--reverify <lane>` records a second look beside the first.
- Published `snapback4@0.0.12`.
- **A shape dropped `pending`** (the Clique lane at M6): a shaped history
  built new objects from a predicted row's fields and lost the card's
  word, so a screen on a shape could not say "Sending…". On the device an
  object built from a pending row's fields is pending; tested. Published
  `snapback4@0.0.13`.
- **Loop bar set C (0.0.8):** 366 s and 472 s with no attributed loop —
  two of three met the bar; the middle run (592 s) charged two loops to
  `dev --fresh`, read from the registry's newer README and absent from
  the pin it installed (the brief now names the installed README). Set D
  on 0.0.11 runs with that brief.

## 2026-09-12 — a device starts offline; 0.0.14

- **A device restarting with no network could not open** (the Clique lane
  at M6, cold-start offline): `createLocalClient` fetched `/schema` before
  it opened the replica it already held. The client now opens the store
  first, keeps the compiled backend in it, and when the server is
  unreachable starts from that copy: `link()` says offline, reads carry
  `fresh: false` and `since`, and the stream catches up (and re-adopts a
  new generation) when the link returns. Only a device that never synced
  needs the server to open, and says so. The end-to-end test restarts a
  SQLite-backed device with every fetch failing.
- Published `snapback4@0.0.14`.

## 2026-09-12 — from the lane's M8; 0.0.15

- **A reference key was "ambiguous" with `byId`.** `upsert likesCount[postId]`
  on a table with a unique key over a reference matched two indexes
  (an id compares with a reference), and the rewrite named the wrong one.
  When candidates differ only in that way, the index whose column types
  are the key's own types is the one meant, and is chosen.
- **`snapback4 data` beside a running `dev` raced its schema adoption on
  the catalog** (`UNIQUE constraint failed: _catalog.name`) and the
  adoption failed. `install` now takes the write lock first and re-reads
  the catalog under it, and every store waits up to five seconds for a
  lock instead of failing at once.
- The README wrote `sum messages.x by ..`; the grammar is `sum <table> of
  <column> by ..`. Published `snapback4@0.0.15`.

## 2026-09-12 — the loop bar is met

Set D on 0.0.11: three fresh Astra agents at medium, green in 537, 443 and
535 s, no Snapback-attributed correction loop (the third agent charged one
and retracted it as its own error a minute later; the runner no longer
counts a retracted line), `check`, the fixture test and the acceptance
script verified independently for each. LLP 3000 §3's loop bar (≤ 1,200 s,
≤ 1 loop, N ≥ 3, the published package, a fresh agent) holds. The road
there — twelve runs on four pins, every one green inside the clock, the
loops on the earlier pins all traced to defects fixed the same day — is
`benchmarks/runs/2026-09-12-snapback4-loopbar/`.

## 2026-09-12 — the Clique lane finished: every milestone green

The continuous session on `snapback4@0.0.2` (Astra at medium, media and
scheduled work struck) ended at `end=1789230003`, 7,725 s after it began:
M1 green at +873 s, M2 +1,416, M3 +2,922, M4 +3,601, M5 +5,030, M6
+6,013 (the full 167,157-action scale replay verified on the second
attempt after a verifier mistake of the agent's own), M8 +7,128; M7 is
the separate session. The lane validated its own record, shut down the
servers it owned by exact pid, and exported seven Hermes bytecodes. The
anchors (§ the run record): Snapback 2 0.0.4's Astra lane reached M8 at
+7,885 s with four milestones later aborted; Convex's Astra lane, full
scope, at +5,643 s all green; Snapback 2 0.0.29's took 13,667 s including
a 6,146 s replay. Twelve Snapback-attributed lines in the builder's log,
eight distinct findings, every one but the expiry gap fixed on main and
published the same day (0.0.4 through 0.0.15); the expiry gap is in
NOT-DOING as the `expires` clause on `sync`. The independent grade (a
fresh Claude session on the frozen grader prompt) runs now; M7 follows.

## 2026-09-12 — the independent grade of the Clique lane

A fresh Claude session (claude-opus-5, an uncalibrated grader by the
protocol's own rule, not contaminated, one rerun) on the frozen grader
prompt: 69 of 101 assertions pass, 2 fail, 9 not-run, 21 not-applicable
(the struck media and scheduled work); coverage spot-verification
`honest`; O1 78, O2 48, O4 72 (O3 and O5 have no input in this scope).
For the anchor: Snapback 2 0.0.29's Astra lane graded O1 73, O2 55, O4
65 on the full brief. The two failed assertions: m3-a09 (the sender's
receipt indicator on an established replica) and m5-a01 (the disclosed
expiry gap). The five defects, read against today's main:

- d-01 (major) receipt-row updates never reached the sender's established
  replica in a group, even across a reload. Not reproduced on 0.0.15 at
  the client level: with the lane's own schema, bob's and carol's
  acknowledgements reach alice's SQLite replica within three seconds and
  survive a reload. The lane's UI on 0.0.2 sat on the orphaned-watch race
  fixed in 0.0.12 or on its own aggregation; the grader's probes drove the
  UI. Open until the M7 session's app is re-graded on a current pin.
- d-02 (major) reactions set through the UI intermittently never reached
  the peer while the API path did in ~100–300 ms: the flush that read the
  outbox once, fixed in 0.0.8.
- d-03 (minor) a push payload dropped for a message sent within ~12 s of
  an abrupt disconnect: the lane's own presence-lease design for the push
  seam (scheduled re-evaluation is struck work).
- d-04 (minor) live updates intermittently past the harness's 10 s budget
  under a load average of 17–25 on the shared host: the loop-bar sets ran
  beside the lane; environmental, as the grader says.
- d-05 (cosmetic) `/q/history` returned 32 of 50 rows with `complete: false`
  and no `next`: a cursorless page on the meter's cut, documented by the
  lane's API.md; today's `check` notes such a page and the README says
  what the card means.

## 2026-09-12 — from the M7 session: an added aggregate is built; 0.0.16

- **A `maintain` added on day two counted nothing that already existed.**
  The classifier said "maintained aggregates change and are rebuilt";
  nothing rebuilt them, so a message count added over an old conversation
  read zero until the next write, and the M7 session built its own paged
  ledger instead. `adopt` now builds every aggregate the change adds or
  redefines from the rows in the store, in one commit that fans out to
  the partitions like any other; a store opened by a release with an
  aggregate whose target is empty while its source is not builds it too.
  Test: `tests/clique.rs`.
- **Adding an optional column with its own constraint classified as
  Narrowing.** A constraint over a column or index that did not exist
  before binds no existing row; the classifier now compares only
  constraints over what was already there. Additive, as it should be.
- Published `snapback4@0.0.16`.

## 2026-09-12 — the Clique run is complete

M7, a fresh Astra session on the inherited lane: green in 917 s — group
polls with idempotent vote intents, a backfilled message count per
conversation, the pre/post API snapshot equal for eight personas, every
prior suite and the M7 choreography segment passing. Its two
Snapback-attributed lines were one defect, the aggregate backfill, fixed
in 0.0.16 above. The record — builder, grade, M7, the anchors, every
finding with its fix — is `benchmarks/runs/2026-09-12-snapback4-clique-0002/`;
the loop bar's is beside it. LLP 3000 §5's fourth week is delivered:
Expo, deploy, day two, the loop bar (met on 0.0.11), the Clique hub run
and its record. What remains on the clock is fix-forward from evidence.

## 2026-09-12 — the whole brief: expiry, assets, jobs and schedules; 0.1.0

The author: "complete snapback4 to the point where the entire clique
benchmark can be run … take whatever you want from snapback1 or 2 or 3."
The run on 0.0.2 struck media and scheduled work; the three things it
struck are one release, each the smallest word that closes its half of
the brief, and each carried from Snapback 2 where Snapback 2 had it right.

- **`expire at .column`** (a table line; a `time ?` column with an index
  leading with it, the rewrite names the index). A row past that time is
  absent to every reader on every host from that moment — before any
  rule, in points, scans, merges, `exists` probes, and the row a mutation
  would update or delete — and the server's sweep deletes it within
  seconds (one commit per pass, bounded), so the deletion streams to
  every device holding it and it leaves local stores and local search on
  the next sync. A null time never expires; the system principal sees no
  more than anyone, so an expired row contributes to nothing a job
  computes. This is the M5 answer NOT-DOING deferred as "time in rules":
  not a rule (a rule that varies with time is no audience a partition can
  hold) but a lifetime, and the device mirrors it on its own clock while
  the server's word is authoritative. Disappearing messages are
  `expiresAt: now + ttl` on insert; nothing else to write.
- **Assets** (LLP 1006's shape, the byte sniffers ported from Snapback 2's
  media crate onto slices). `POST /assets` takes the bytes, sniffs JPEG,
  PNG, WebP and MP4 (dimensions from the header, duration from `mvhd`),
  bounds them by the largest column of that kind in the schema, keeps
  them beside the store (`assets/` next to the database, so every release
  serves the same bytes), and records them under the uploader. An
  `image`/`video` column names an upload by id; on the write the engine
  replaces the client's map with the facts the server established and
  claims the asset for the row — one asset, one home, the uploader's own
  — and releases the one a column stops naming. `GET /assets/<id>` is the
  home row's read rule, run on the row as it stands: present, still
  naming the asset, not expired, readable by this viewer; a `once` image
  records one view per principal and refuses the second with 410
  `E_ASSET_VIEWED`, `Cache-Control: no-store`; the uploader is never
  counted. Hidden, released and absent are one word, `E_ASSET_UNKNOWN`,
  on purpose. Released and abandoned uploads leave the disk once a
  minute. On the client: `upload(bytes)`, `asset(id)` (a blob URL fetched
  under the viewer's credentials, so no token ever sits in an `<img
  src>`), `assetSource(id)` for native views, `useAsset(id)` in React
  (revoked on unmount; a second mount of a one-view photo is `denied`,
  which is the feature). Uploads are online only; there is nothing to
  queue. The system principal may name an asset that was never uploaded
  (a fixture's placeholder): metadata only, never served.
- **Jobs and schedules** (LLP 1016 §4 D2–D5, the sweep as Snapback 2
  built it, without the operator console). `job name(args):` is a
  sequence of `chunk x in table[prefix] first N by index:` sweeps; each
  chunk is one page through the body as the system principal under the
  job ceilings, its cursor committed with the rows it wrote, so a chunk
  is wholly done or not started and a restart resumes at the next one.
  The index's columns are `id` or `immutable` (`E_JOB_CURSOR_INDEX`,
  rewrite `immutable <cols>`), so nothing moves under the cursor; the
  upper key is captured when the sweep begins, so a sweep over its own
  table ends. `break` ends the sweep, `return` the job; a refused chunk
  parks the run with its refusal; a run queued under one program parks
  with `E_JOB_GENERATION` when the program changes. No client calls a job
  (`E_OP` at the wire; jobs are not on `api.ts`). `schedule name every
  2m|1h|1d [at HH:MM]: job` fires once per period boundary of the
  server's clock, the boundary committed in one transaction with the job
  row, so a restart never fires twice for one period; a schedule first
  seen starts from its next boundary; a boundary crossed while the
  server was down fires once on return; `periodStart`/`periodEnd` are
  supplied when the job declares them and nothing else may be declared
  (`E_SCHEDULE`). `snapback4 run <job>` runs one whole, now; `doctor`
  lists schedules and the last runs. The server's maintenance thread
  (every five seconds: the expiry sweep, due schedules, queued chunks
  one at a time with the engine free between them, and once a minute the
  asset sweep) is the only clock.
- Tests: `tests/clique.rs` (expiry absent then swept; the asset flow with
  `once` and release; a two-sweep job and a parked run; a schedule's
  boundaries; the compiler's refusals), the sniffers' unit tests, the
  device's expiry filter, and an end-to-end upload → `sendPhoto` →
  serve → unsend on a live `dev`. The chat schema gains `sendPhoto`.
- What is deliberately smaller than Snapback 2: no rungs, thumbnails or
  HEIC; no `_timers` table (a schedule's state is one meta key); no job
  console; missed boundaries fire once, not once per period. Recorded
  in NOT-DOING's Moves.
- `snapback4@0.1.0`: the first release that carries the whole brief.

## 2026-09-12 — from the full-brief lane's M1: the four workers; 0.1.1

Thirty-nine minutes into the full-brief run the lane recorded a
`snapback4-defect`: the backend accepted TCP but `/schema` "timed out"
once two clients were writing profiles (`evidence/backend-hang.txt`: the
answer came after 2.0 s, past the lane's own budget). Reproduced here in
one line: four `GET /changes?wait=15` long polls, then `/schema` waits
14.5 s. The wire had a pool of four worker threads, and every connected
device keeps one long poll open, so the fifth request of any kind —
another device's bootstrap, a write, a probe — waited for a poll to time
out. This is the same shape as the struck run's d-04 ("live updates
intermittently past the harness's 10 s budget"), which the grader read
as host load. Fix: one thread per request, no pool; a waiting poll holds
nothing but its thread, and the engine serializes behind its own lock as
before. Twelve polls open, `/schema` and a query answer in milliseconds.
Published `snapback4@0.1.1`; the lane stays on its 0.1.0 pin and the
record reads the defect against main.

## 2026-09-12 — from the full-brief lane's M2: the facts arrive before the program; 0.1.2

Two lines from the lane's M2. **A video argument carried only the id, so
`require clip.duration <= 60000` raised `E_FIELD` inside the mutation**:
the facts the server sniffed were put on the row at the write, after the
program had already read the argument. Now an `image`/`video` argument
that names the writer's own upload carries the server's facts before the
program runs (`type`, `bytes`, `width`, `height`, `duration`, every key
present and null where the kind has none, on the argument and on the
row alike; a fixture's placeholder keeps the same shape), so the 60 s
bound is one `require` and the client needs to send nothing but `{ id }`.
Test: `tests/clique.rs`, a clip of 4.5 s sent and one of 120 s refused
with the author's code. **The README said a `maintain` was read "by
group" and described the row**, and the lane expected a row where the
read is the number; it is the number (0 when the group has no row), and
the README now says so, the row shape being sync's business. Published
`snapback4@0.1.2`.

## 2026-09-12 — from the full-brief lane's M5: the card promised a form the grammar lacked; 0.1.3

The `expire` card said disappearing messages were "`now + ttl if ttl`
on insert". The lane wrote exactly that and `check` refused it,
`E_QUARRY_SYNTAX`: the phrase was prose in the shape of code, and Quarry
had no conditional value at all — this session had hit the same wall
writing the expiry test and stepped around it with a second mutation
instead of noticing what that meant. A `snapback4-defect`, rightly.
Quarry now has `a if cond else b`, below every operator, the arm not
taken never evaluated (lowered to a temporary assigned in one arm of an
`if`, so both hosts run it unchanged) and `x != null` narrowing `x` in
the taken arm; the card and the README say the true line,
`expiresAt: now + ttl if ttl != null else null` with `ttl: int ?`, and
the expiry test sends through exactly it. Published `snapback4@0.1.3`.

## 2026-09-12 — from the full-brief lane's M8: three more words the README owed; 0.1.4

The lane's M8 line, a knowledge gap attributed to the package: the
README's `sum(page, .x)` was refused (the binder knew only `sum(list)`,
and nothing in Quarry made a list of numbers from a page); a bare
`return` was refused; and division was found only through its
diagnostic. Now `sum(page, .x)` is real — a loop pushing each row's field
into a list, then the sum, the same IR on both hosts, `E_QUARRY_TYPE`
with `?? 0` as the rewrite for an optional field — a bare `return` is
`return null`, and the README says there is no `/`: `(quotient,
remainder) = divmod(a, b)` binds both so no remainder goes unread.
Published `snapback4@0.1.4`.

## 2026-09-12 — from the full-brief lane's M8: the clock ticks once a second; 0.1.5

The lane's unattended digest proof asserted 1.5 s after the two-minute
boundary and found nothing; its restarted backend then logged
`schedule daily fired` and `job digest done: 5 chunks, 17 rows written`
for that same boundary — once, as the boundary committed with the job
row says. The mechanism held; the server's clock ticked every five
seconds. It ticks once a second now (a quiet tick is a few index probes
under the lock), so an expired row is swept and a schedule's job runs
within a second of its moment. Published `snapback4@0.1.5`.

## 2026-09-13 — from the full-brief lane's M8: the cold start of a large partition; 0.1.6

The lane's cold-sync probe — a Node client on the memory store, the
persona `u0500`, the full M8 scale corpus (990,355 rows, a 1.8 GB
store) — blocked its event loop past 30 s and was stopped at 51 s and
2.2 GB RSS; the lane recorded a capability gap and claimed no
performance pass. Two causes, both the platform's to answer. **The
snapshot came as one response**: the whole partition's JSON parsed at
once, applied in one transaction. It is paged now — `GET /sync?from=0`
returns 2,000 events and a `next` token; each page is one short
transaction on the server and one on the device; the first page clears
the rows, the watermark the first page pinned lands with the last, and a
row changed or a group joined between pages arrives through the log,
idempotently (`tests/clique.rs`: 4,500 rows in three pages, no row
twice, a conversation joined mid-snapshot streamed after). **The
schema had no horizons**: `sync public` on posts, follows, likes and
feed entries, and no `last N` on messages or receipts, so every device
held 227,699 public rows and a group's 490,000 receipts, at every cold
start. The compiler now notes it once per table (`N_NO_HORIZON`, with
the horizon line to add), the README and the `sync` card say what a
horizon is for, and the README says the memory store is for tests and
Node hosts open SQLite. This is the Snapback 2 run's "cold sync 62 s /
748 MB" answered where it should be: at `check`, before the corpus
exists, and on the wire, a page at a time. Published `snapback4@0.1.6`.

## 2026-09-13 — from the full-brief lane's M8 closure: the outbox in submission order; 0.1.7

The lane's last attributed line: queued writes did not always flush in
the order they were submitted, and it re-ordered them itself through the
client's `fetch` and `store` seams. True: the outbox flushed by id, and an
id is 48 bits of milliseconds then 80 of entropy, so two writes in one
millisecond flushed in the order of their entropy. Now an id minted by
one process strictly increases (two in one millisecond take successive
milliseconds), and the outbox carries its own submission sequence, kept
in the store's meta and flushed by, so the order survives a restart and
a clock that steps back. Test: twenty sends in one offline burst reach
the other device in the order they were sent. Published `snapback4@0.1.7`.

## 2026-09-13 — the full-brief Clique run: every milestone green on 0.1.0

The lane (`~/clique-sb4-20260912-full`, Astra medium, `snapback4@0.1.0`
pinned, nothing struck) ended at 7,002 s of wall clock with M1, M2, M3,
M4, M5, M6 and M8 green: 654, 607, 716, 151, 673, 1,180 and 2,945 s of
closure wall in turn (the struck run on 0.0.2: 7,725 s to M8 with media
and scheduled work removed). Media messages, avatars, view-once photos,
asset revocation, server-enforced expiry with no client open, and the
scheduled digest under the two-minute config all passed the frozen suite
and the two-client choreography; the scale replay settled 167,157
actions in 512 s and verified against the invariant manifest. Of 31
recorded correction events the lane attributed 20 to itself, 4 to the
environment, 4 as ambiguous and 3 to the package; every package line is
answered above, in 0.1.1 through 0.1.7, and the record reads each
against main. The lane declares one protocol deviation: its last
diagnosis read the installed package's `dist/local.js`, not a source
checkout, and it says so.

What it did not claim: the scale envelope's O5. Cold sync of `u0500`
over the full corpus on the memory store blocked Node past 30 s (0.1.6:
the snapshot is paged and `check` notes a table with no horizon; the
lane's schema had none), and the wide-follow probe — the following feed
for a user who follows 500 against one who follows 5 — measured 19.2×
where the envelope allows 3×. That ratio is the shape of `merge` over
500 lanes, each lane read one page deep; the feed the brief describes
wants a fan-out-on-write table or a bounded lane count, and the
package's notes should say so at `check` when a merge's lane source is
unbounded in practice. Open, for the next slice. The 60-second video
bound the lane checked on the client is one `require` on the server
since 0.1.2. Grading and M7 follow.

## 2026-09-13 — the wide merge, named at `check`; 0.1.8

The lane's following feed was `merge feedEntries … [f.followed] for f in
follows[viewer] first 1000 by byFollower`: a thousand lanes, a page of 21
each, 21,000 rows per read — past the 8,192 the meter allows, so cut, and
19× the five-lane read. The design the brief's envelope wants is the
entries written on the way in, one table per reader synced to `.reader`,
read as one page; nothing said so before the run. `check` now notes a
merge whose lanes may exceed fifty, with the row count and, when it is
past the ceiling, that the page is cut (`N_WIDE_MERGE`); the README and
the `reads` explanation carry the fan-out-on-write shape. Published
`snapback4@0.1.8`.

## 2026-09-13 — the full-brief run is complete: the grade, M7, the record; 0.1.9

The grade (a fresh Claude session, claude-opus-5, on the frozen grader
prompt): 84 pass, 1 fail, 16 not-run of 101 on the whole brief — 100 of
119 by independent execution — against 69 pass and 21 struck on 0.0.2.
Coverage was judged dishonest on one sampled mapping of seventeen (the
lane's M3 quote-jump test asserted a bubble count and the jump does not
happen), which the protocol adjudicates to M3 capability-failure for O1
alone: O1 62, O2 48, O3 null, O4 35 (no native simulator proof), O5 band
30 (the following-feed ratio; the cold-sync timeout — both answered in
0.1.6 and 0.1.8, the feed's shape still the app's). Two majors: the app's
logout crash, and the horizonless schema's cold start. M7, a fresh Astra
session on the inherited lane: polls, a backfilled maintained count
grouped by conversation, tombstone and expiry, an exact migration
comparison, every previously green suite passing but M1 — which fails at
logout with the pre-M7 schema too, the same crash, preserved as the rules
say — so `capability-failure` on m7-a09 after 1,386 s. Its one package
line worth a word: a maintained count over an expiring table counts a
row until the sweep removes it while a read of the row is null at once;
the card and the README now say so (exact within a second). The record is
`benchmarks/runs/2026-09-13-snapback4-clique-0003/`, every finding beside
its fix. Published `snapback4@0.1.9` (the docs). The whole brief runs;
what the run says to do next is the feed's fan-out-on-write shape as a
recipe, native proof in the simulator witness, and the loop bar again on
the 0.1 line.

## 2026-09-13 — the loop bar on 0.1.9: met again, faster

Set E, three fresh Astra sessions on `snapback4@0.1.9` with the host quiet
after the full-brief run: 373, 400 and 376 s of wall clock, every one
green on the independent verification (`check` clean, the fixture under
`test` for every persona, the acceptance script), no Snapback-attributed
loop in any of them — set D on 0.0.11 was 537, 443 and 535 s. The bar
stands on the 0.1 line, a third faster. One docs loop in run 2: the agent
wrote `messages first 50 by index` with no `[..]` and the parser refused
it; it found the empty prefix from the grammar in one step. `chunk`
already took the bare form; reads take it now too (0.1.10). Record:
`benchmarks/runs/2026-09-12-snapback4-loopbar/`.

## 2026-09-13 — 0.1.10 was broken and went out anyway; 0.1.11, and the gate

The bare-read form in 0.1.10 matched a cursor variable too: in `messages[..]
after c last 50 by byConvTime` the parser took `c last 50` as a table
read of `c`, and every read with a cursor was refused. The suite caught
it — the chat schema no longer compiled — and the release went out
regardless, because the shell chain ran the publish after the suite with
a `;`, not an `&&`: a red result that did not stop anything, the failure
class NOT-DOING names. 0.1.10 is deprecated on the registry (both
packages) with the reason and the successor. 0.1.11: the bare form honours
the range parser's stop words, so a cursor is a cursor; and
`scripts/publish.mjs` now runs the suite itself and refuses to publish
over a red one, so the gate is in the script and not in the hand that
types the chain.

## 2026-09-13 — what the run said to do next: feeds, the sign-out contract, native proof; 0.1.12

Three things the full-brief run named, done. **The feed.** A `feeds`
card and a README section give the fan-out-on-write shape the O5 miss
wanted: one `feed` row per reader per post, `unique` by reader and post,
`sync to .readerId last 200`, the near 200 followers written by the
mutation (a mutation writes at most 1,024 rows), the rest by a `fanOut`
job a schedule fires every minute, five posts a chunk with `if absent`
making its pass idempotent over what the mutation wrote, an account past
the job's bound being the one lane its readers merge, which is what a
celebrity is; the read is one local page. Compiled and run in
`tests/clique.rs`: 250 followers, 201 rows from the mutation, 251 after
the job, none twice, a far follower's device holding exactly its own
entry. `N_WIDE_MERGE` now points at the card. **The sign-out contract.**
The grade's d-01 was the app reading `client.session().token` in an
effect's cleanup after `signOut()`, when the session is null. The client
gains `onSession` and the React arm `useSession`: whoever keeps the
token — a native image header, a presence lease — takes it from there
and stops when it is null, and the README says so; the e2e test asserts
the listener hears the end before the client closes. **Native proof.**
The simulator witness now proves, on the real SQLite store in Expo Go,
what O4 found undemonstrated: a cold start with the server unreachable
opens in 2 ms on what the store holds and answers the thread with
`fresh: false`; two writes composed offline are `pending` after the app
restarts still offline, in order, and land in order on reconnect (the
whole scenario: cold sync 199 ms for 303 rows, reopen 10 ms). The README
tells an app how to prove the same with the client's `fetch` gate. One
trap on the way: `expo start --localhost` binds Metro to `::1` alone and
Expo Go, dialing 127.0.0.1, "could not connect"; the witness names the
packager host as 127.0.0.1 instead and picks its own simulator by
`WITNESS_UDID` when several are booted. Published `snapback4@0.1.12`.

## 2026-09-13 — one interpreter, measured as wasm: the web keeps TypeScript, native hosts get the core

The author: ship a native Rust module for Expo and for Exact2, and how
much larger is the wasm than the TypeScript twin? Measured, not guessed.
The core now compiles without SQLite: a `Rows` trait (`rows.rs`) is what
the interpreter needs of a store — get, lookup, scan, count, put, delete,
and an asset ledger it may not have — the server's transaction implements
it, `MemoryRows` implements it on the heap, and the `sqlite` feature
(default on) gates the store, identity, the asset ledger, jobs and the
log. `engine::local` runs a program on a device with the device's three
words (a synced table's rows readable as held, an online-only table and a
page at the horizon `complete: false`), so the Rust interpreter says on a
device what the TypeScript twin says; `tests/device.rs` proves the thread
pages with the server's cursors, delivered history stays readable, the
horizon is a `complete: false`, and a send predicts and counts. A new
crate, `snapback4-device`, is that interpreter as wasm over a host's
synchronous callbacks (rows as JSON, keys as hex), size-first: opt-level
z, fat LTO, one codegen unit, panic abort.

| | raw | gzip | brotli |
| --- | ---: | ---: | ---: |
| the device core as wasm (`scripts/measure-wasm.sh` → `metrics/wasm.jsonl`) | 680,459 | 194,465 | 156,211 |
| its wasm-bindgen glue | 15,935 | 3,656 | 3,242 |
| the TypeScript interpreter alone | 21,521 | 7,067 | 6,406 |
| the TypeScript interpreter, store and replica | 31,241 | 10,303 | 9,358 |
| the whole local-first TypeScript tier (client included) | 58,484 | 16,842 | 14,888 |

Twenty-eight times the TypeScript interpreter, nine times the Convex
anchor LLP 3000 §3 budgets the web client against; `wasm-opt -Oz` made
the gzip larger, not smaller. The bytes are serde's derived readers for
the schema, the IR and the value model, `serde_json`, and `std`'s
formatting, none of which a smaller interpreter would shed. So LLP
2000.000 §9's recommendation stands, now with its number: TypeScript
stays on the web, and the Rust core is the native module where SQLite is
already native and bytes are a static library, not a download — Expo,
and Exact2's Apple and Linux hosts, which link Rust and expose
`storage.sqlite` to their TypeScript apps. There the module owns the
store outright (the server's two-table SQLite layout, the same code),
applies the stream, keeps the outbox, and answers queries and
predictions; the JavaScript client keeps only the session, the link and
the transport. That is the next landing; this one is the foundation.

## 2026-09-13 — the native module: the device in Rust, over the core's own SQLite

`snapback4-device` with its `native` feature (the default) is the device
the TypeScript replica has been: the partition in the core's own SQLite,
the server's two-table layout through the server's own code; the stream
applied a page at a time with the watermark landing with the rows (a
snapshot's first page clears, its last carries the watermark; a scope
tombstone applies the table's leave policy, its group typed by the
audience columns before it meets the index); the outbox as a side table
in submission order; queries through `engine::local`; predictions in one
transaction whose rows carry `pending: true` until the server's image
replaces them, withdrawn if the server refuses; a generation change
clearing the rows and keeping the outbox; and a JSON call over a C ABI —
`sb4_open`, `sb4_call`, `sb4_free`, `sb4_close`, one `op` per request,
every answer `ok` or `denied`, a query's refusal the card's `denied`
inside `ok` — with `ffi::call` for a Rust host to use without the C
layer. `tests/native.rs` runs it against a real server engine: the
snapshot in pages of fifty, the thread paging with the server's cursors,
a send predicted and counted then confirmed through the stream, a leave
under `delivered-history` and `until-revoked`, a reopen keeping the
watermark, a new generation not. What an app pays: the iOS dynamic
library, production profile, stripped, is 1.7 MB (`text` 1,736,704 B),
SQLite included (`scripts/measure-native.sh` → `metrics/native.jsonl`);
the static archive is larger only because it carries every object. Next:
the JavaScript tier over the module (`snapback4/native`: session, link,
transport and observation only, one code path the TypeScript twin also
implements so the client is tested without a device), the Expo module
(Swift over the C ABI, a development build since Expo Go loads no custom
native code, the simulator witness on it), and the Exact2 host, which
links Rust and can call `ffi::call` directly.

## 2026-09-13 — the native tier: what the JavaScript client is when the device is Rust; 0.1.13

`snapback4/native` is the client over the module: `createNativeClient({
url, native, dataDir, persona | session | guest, ... })`, where `native`
is how the host opens its device — `open(path, backend)` returning one
JSON `call` — and everything else is the session, the link, the
transport (`/schema`, `/sync` paged, `/changes`, `/m`) and the
observation of reads, on the unchanged card. The device opens on the
backend the server sends or, with the server unreachable, on the one it
kept (`Device::open` with none), so a cold start offline opens on what
it holds. `snapback4 device <store> [backend]` runs the same module as a
process, one JSON line each way, and `processCore` in the tier drives it,
so `test/native-e2e.test.mjs` runs the tier against the real Rust module
and a live `dev`: two devices converge, a send is pending then sent, an
offline burst of five queues durably and lands in order, a cold start
offline answers thirty-seven rows with `fresh: false`. Six seconds.

Two defects the slice exposed, both in the client. **`mintId` shifted
the time out of the id**: the timestamp was moved up by eighty bits and
then by the entropy's eighty again, so every client-minted id began with
ten zero digits and none was time-ordered; the 0.1.7 fix ("ids minted by
one process strictly increase") sat on that and worked only because the
outbox's own counter did the ordering. The time leads now. **The
submission number through an async seam**: the first draft of the tier
asked the module for `next_submission` inside `mutate`, so a burst of
five took one number before any of them enqueued, the outbox's primary
key refused four, and the tier ignored the refusal — the 0.1.7 lesson
again, one seam over. The number is taken synchronously at admission
from a counter continued from the outbox, and a refused enqueue is a
failed write with its prediction withdrawn. Published `snapback4@0.1.13`.
Next: the Expo module (Swift over `snapback4.h`, an xcframework of the
two iOS targets, a development build, the simulator witness on it), and
the Exact2 host.

## 2026-09-13 — common-workload performance, first measured change

The author asked to make Snapback 4 faster than Convex and Supabase for
common use cases. The starting point is `130af1ae2` / 0.1.12, not the older
0.0.16 checkout. The existing Clique record identifies wide feeds and cold
sync as gaps; it does not establish a performance lead across workloads.

The existing storage measurement now accepts `--workloads`. It runs the
actual release HTTP server on a temporary file-backed WAL/NORMAL store,
then the actual replica and interpreter on MemoryStore and Node SQLite.
It measures points, ordered thread pages and continuations, an inbox with
joined conversations and maintained counts, a feed, sends, edits and cold
sync. A timed refusal fails the run; row identity, ordering, pagination and
acquired row counts are checked. Completeness is recorded, so an incomplete
page is never presented as a successful performance comparison. Later run
records also include binary/client/fixture/instrument hashes and the dirty
source flag. This extends an existing instrument; no new gate or registry.

The first 500-conversation × 50-message × 2-member run (25,000 messages,
27,000 snapshot events, M5 Max Black, Node 24.18.0, 20 samples after 3 warmups)
found the feed taking 17.643 ms median over HTTP, 4.161 ms in MemoryStore,
and 21.403 ms on Node SQLite. All three were incomplete: discovery plus a
page per lane reached the 8,192-row meter before reaching the newest lanes.

Uniform merges now keep an ordered head per lane and advance the winners;
eight or fewer actual lanes buffer a page each to avoid excessive SQLite
calls. Setup, non-uniform rules and indexes without an unambiguous row
position retain the existing scan order. Nullable unique indexes allow
repeated nulls, so they stay on that path too. Rows, lookahead and probes
still cost the meter. Both interpreters implement it; the compiler note and
feed card describe it. SQL statement reuse also removes repeated preparation
from server writes and Node replica operations.

The first candidate run returned the exact complete newest 20 rows at
5.765 ms HTTP, 1.758 ms MemoryStore and 6.383 ms Node SQLite. Node SQLite cold
sync fell from 507.0 to 209.6 ms; bulk seed from 4,789 to 4,050 ms. These are
initial within-Snapback measurements recorded in `metrics/storage.jsonl`,
not a Convex/Supabase win. Node SQLite here is **in memory**, not a durable
Expo store or device witness. Small HTTP differences are within the noise
of this shared machine. The final repeated comparison follows separately.

Validation: the entire Snapback 4 suite passed in 60 seconds; ref-check
reported 466 LLPs, 8,673 references, no errors or unchecked references.
Added cases compare the merge against an eager sorted union across ascending
and descending pages, ties, overlapping and empty lanes, and nullable unique
keys. The 500-author server test returns the actual newest page below 2,000
examined rows. Memory and SQLite tests also cover expiry and low budgets.

The full goal stays open. Owed: current Convex and Supabase runs with matched
fixtures, indexes, authorization, durability, hardware/region and concurrency;
small and wide feeds, point/filtered/page/join/count reads, single and batch
writes, realtime fanout, reconnect and offline writes, cold acquisition on
web and native, search, authentication, files/media and scheduled/background
work. Record p50/p95, throughput, transferred/stored bytes and failures rather
than treating a fast microbenchmark as whole-product evidence. Ranked/vector
search and multi-region also remain product gaps; no blanket lead is claimed.

## 2026-09-13 — repeated workload controls and the native integration

The final instrument ran on both `130af1ae2` (0.1.12) and `ee57355a1`
(the performance candidate), on the same M5 Max / Node 24.18.0. Three
independent seeds per version at 5 and 500 conversations × 50 messages,
2 members; 3 warmups then 20 timed samples per operation in each run.
The table shows the median of the three per-run p50s, in milliseconds:

| Workload | 0.1.12 | Candidate |
| --- | ---: | ---: |
| HTTP feed, 5 lanes | 1.872 | 1.854 |
| HTTP feed, 500 lanes | 21.061, incomplete | 6.201, complete |
| Memory feed, 500 lanes | 5.105, incomplete | 1.967, complete |
| Node SQLite feed, 500 lanes | 23.328, incomplete | 6.659, complete |
| Node SQLite cold sync, 27,000 events | 647.5 | 232.0 |

For the wide HTTP feed the median per-run p95 was 27.335 → 7.442 ms;
for the small HTTP feed it was 2.272 → 2.279 ms. One additional 5 × 150
run per version checked HTTP continuation pages (1.711 → 1.624 ms p50)
and horizon-limited replica acquisition. These shared-machine observations
support the wide-feed and Node SQLite improvements; microsecond differences
in ordinary reads and writes are not asserted as wins. Node SQLite was
`:memory:`: this does not measure durable Expo storage. The 500-group inbox
remains incomplete under its declared first-50 source limit on both versions.
All raw runs are in `metrics/storage.jsonl`, with matching instrument and
seed hashes across the pair. `dirty: true` includes the instrument's own
metrics append, and on the control the copied final instrument; runtime and
client artifact hashes identify the measured code. Candidate and control
runs were consecutive batches, not randomized trials or hosted comparisons.

Main meanwhile gained the `Rows` interpreter and native device module. The
integration preserves its device authority and horizon checks inside every
merge refill. A native SQLite test snapshots and reopens ten conversation
lanes, compares complete pages and cursors with the server, checks that the
first page examines fewer than 100 rows, and reaches `complete: false` when
the device exhausts its 500-row horizon. It passes. The broader comparison
goal remains open as listed in the previous entry.

## 2026-09-13 — performance release qualification, 0.1.14

The native tier landed as 0.1.13 during qualification; this release preserves
it and takes the next version. The shared core also checks with SQLite
features disabled. Client bytes: 4,080 B gzip online and 18,062 B local-first,
within the recorded 21,713 B Convex anchor (a byte budget, not a latency
comparison). Correction to the previous entry: the 5 × 150 fixture is below
the 500-row horizon and checks ordinary replica acquisition; the new native
550-row fixture is the one that proves truncation and incomplete pages.

## 2026-09-13 — performance update shipped

Landed through `99919c432`; the full integrated suite passed in 56 s and
reference validation found no errors. The publication path repeated the
suite (51 s), passed its installed-consumer proof, and published 0.1.14 in
78.7 s; both npm packages were verified in the registry. An additional
six-run-per-variant HTTP worker-reuse experiment found no reliable read
improvement in alternating controls, so that production change was discarded.
Its raw timings remain in `metrics/storage.jsonl`; no thread-pool win is claimed.

## 2026-09-13 — feeds: the question, the decomposition, an Interview sketch compiled and run; LLP 3000.004

The author: a lot of apps have an algorithmic feed as a crucial part of
the backend, Convex and Supabase give primitives only — could Snapback 4
be a good solution, and does Interview (the Quora successor on Exact2 and
Snapback 2) need one? The answer, written as
[LLP 3000.004](../llp/3000.004-feeds-and-the-interview-reference-app.rfc.md)
and carried provisionally in LLP 3000 §7: **yes for the serving half, no
for the model half, and the line is the design.** Delivery, sync, read
state, freshness and bounds are what the two flips already make
declarative; candidate generation and learned scoring are an external
ranker writing through mutations under a rule. Two shapes: the card's
per-reader fan-out for a follow graph, and — new — a shared `ranked`
partition scored by a job on a cadence, every device holding it, plus
the viewer's own signals (`votes`, `seen`, a ranker's `affinity`) synced
to the viewer, the device composing the two. Evidence, not argument:
Interview's feed-relevant schema written for Snapback 4 — twelve tables,
ten operations — compiled clean at 0.1.14 (`check: ok … no problems, 1
note, 12.9 ms`) and run on a local store with `snapback4 run`: three
posts, votes and a comment; `rescore` wrote three `ranked` rows (20, 2,
−10 from `postScore * 10 + commentCount * 2 - ageHours`); `home --as
bob` read them in score order with `seen` and the viewer's own vote
beside each row (12 examined, 69 steps, 0.6 ms); `markSeen` flipped one
row; three more votes and a second `rescore` moved the order; a ranker
persona without a `services` row was refused `E_RULE`. Found on the way
and ticketed: `N_NO_CURSOR` fires on `for … first N` in a mutation and
on `chunk` in a job (the `feeds` card's own recipe gets two notes); a
reference column stores an id that names no row. The document proposes
Interview as LLP 2000 §4's second reference application with a bounded
spike (the ranked recipe on the card, Interview's Home on Snapback 4, a
device witness, `rescore` at 1k and 10k posts) and asks the author for
three decisions. Numbering: 3000.000–3000.003 are the architecture
review's children, allocated in another session and not yet on main, so
this took 3000.004. Nothing moved off `NOT-DOING.md`.

## 2026-09-13 — the Expo module: the Rust device in a development build, proved on the simulator

`snapback4-expo` is the module for Expo: `Snapback4Module.swift` over the
C ABI (`open`, `call`, `close`, handles as small integers, one lock
around the device), the Rust library as `ios/Snapback4Device.xcframework`
with the header and a module map so Swift imports `Snapback4Device`, and
`src/index.ts` giving `snapback4/native` its opener — `nativeDevice`,
`documentDirectory()`, and `nativeAvailable()` for the app to choose the
tier, since Expo Go loads no custom native code and the module is present
only in a development or production build. `apps/chat-expo` chooses at
import: the Rust module when the build carries it, the TypeScript tier
over expo-sqlite in Expo Go; the app above the choice is unchanged.

The witness runs in both. `WITNESS_DEV_CLIENT=1 node witness/expo.mjs`
starts Metro for the development client and launches the build straight
onto it — the launcher reads `--initialUrl` from its process arguments —
and the same five proofs pass on the module (`metrics/witness.jsonl`,
`dev-client-native`): the cold sync of 303 rows in 31 ms where the
TypeScript tier took 199, the reopen in 6 ms (10), the cold start offline
in 2 ms with the thread answered from the store and `fresh: false`, two
writes composed offline surviving a restart and landing in order. A
module call is a millisecond; the thread's fifty rows come back as 6.7 KB
of JSON.

Two traps, both the harness's. **A system alert stalls the app behind
it.** `xcrun simctl openurl` on the app's own scheme raises "Open in
Snapback 4 chat?" on this simulator; the alert outlives the app and the
Metro that opened it, and under it the app's JavaScript reached the
module's first `query` and never got an answer — one call in, no thread
in the module, no thread on the lock, the process idle. The witness no
longer opens a link; a simulator that has one up needs a reboot.
**The static library was 37 MB of bitcode.** The crate is also an rlib,
and a build of every crate type at once leaves the staticlib
un-optimised across crates, every object carrying its bitcode for a
consumer's LTO; `cargo rustc --crate-type staticlib` builds it alone,
optimised into one object beside SQLite and the builtins, and stripped it
is 4.8 MB a slice: the xcframework is 9.1 MB where it was 71, the npm
tarball 3.3 MB. The app pays the same 1.7 MB linked either way.

Not in this landing: Android (the same C ABI under Kotlin, a later
slice), and the Exact2 host, filed in that repository's `issues/` as a
`DataSource` over `ffi::call` with `apps/messages` as the first app, to be
built there when its `main` is quiet. Published `snapback4-expo@0.1.14`
beside `snapback4@0.1.14`.


## 2026-09-13 — link the device beside Exact2 SQLite

Exact2 embeds the device beside ibex2-sqlite, which uses rusqlite 0.40.2.
Cargo refuses two different libsqlite3-sys versions with the same sqlite3
link name. Core and device now use rusqlite 0.40.2 so the app links one
SQLite. No interpreter or storage API changed. The core and native-device
tests pass with the updated dependency. Codex implements this integration
prerequisite for the Exact2 snapback4 native-module issue.

## 2026-09-12 — comprehensive architecture and code review (Codex)

Charlie requested a comprehensive review, then assigned security holes to a
separate model. This review covers architecture, correctness, performance and
ergonomics at repository commit `d6c803878a5432cce5f045777786a049972d3d70`,
Snapback 4 tree `cf0a13dca32b3e1721d1d947a3f82c262a0807f0` (0.0.16).
The [review record and ticket index](../llp/reviews/3000-architecture-code-review-20260912.md)
contain scope, source coverage, observed results and limitations.

The existing `scripts/test.sh` passed in 46 seconds on pinned Node 24.19.0.
Additional probes reproduced unchecked schema narrowing/projection, a stale
restart generation, reused deployment source, failed snapshot replacement,
regressed watermarks, overlapping SQLite transaction loss, incorrect prediction
rollback and retry, stale observations, value-model/lowering differences,
worker starvation and React/page lifecycle defects. The green baseline does
not cover those examples. Findings distinguish execution from source tracing;
no real deployment or npm publication was performed, and no product code was
changed.

37 filesystem tickets were filed: 23 P1 and 14 P2. LLP 3000 was extended first;
[3000.000](../llp/3000.000-atomic-schema-and-release-activation.research.md),
[3000.001](../llp/3000.001-durable-replica-and-write-lifecycle.research.md),
[3000.002](../llp/3000.002-end-to-end-resource-bounds.research.md) and
[3000.003](../llp/3000.003-one-semantics-and-credible-verification.research.md)
are Draft Research on activation ownership, durable replica/write state,
resource boundaries and shared semantics/verification. They accept no design
on the author's behalf. Four historical Snapback 1 research working-set links
were archived to keep `llp/current/` at 59; the review records the exact links,
and their documents remain unchanged. Core implementation custody remains
with the lead under LLP 3000.

## 2026-09-13 — implementing the comprehensive review's corrections (Codex)

Charlie asked to fix all 37 tickets from the 0.0.16 review. The implementation
was based on 0.1.13, then integrated the concurrently landed 0.1.14 merge
performance work, native Expo module and SQLite 0.40.2 integration. Work stayed
in the reused fixture worktree on an owned integration branch; active sibling
worktrees and the shared dirty root were preserved.

The store now publishes schema, programs, projection, changed maintains and
monotone generation in one checked transaction. CLI inspection attaches to
persisted content; immutable release directories and an authoritative SQLite
release pointer replace independently mutable activation owners. Device arms
keep confirmed before-images and ordered durable writes, stage snapshots until
their final transaction, guard competing snapshot/send owners, and replay
surviving predictions after refusal or sync. Compiler corrections preserve
lexical scope, source evaluation order, short circuiting and narrowing; device
values preserve checked i53 arithmetic, Unicode order and typed aggregate IDs.
HTTP admission/output, React/page lifetimes, reference-app drafts and cleanup,
loop-bar process ownership, witness dependency resolution and publication
artifact identity have corresponding corrections.

The corpus is now an honest Rust server check: 211 passing cases and 82 named
exclusions for source semantics outside this model. It checks retained states
and continuations, and has no failure allowlist. Actual Rust/TypeScript
execution probes cover value semantics and byte-identical cursors. The larger
cross-host/physical resource questions remain explicit in Draft Research
3000.000–3000.003; asset argument normalization and durable terminal-outcome
discovery are among the boundaries those documents still identify.

The five archived historical working-set links across this review and follow-up
are 0329.011, 0329.014, 0329.019, 0329.021 and 0329.020. Only their current links
were removed; documents and references remain. The last retirement makes room
for concurrently landed 3000.004 while keeping the 59-document budget.
Verification and independent review results follow in the closure record.

## 2026-09-13 — comprehensive review corrections qualified and tickets closed (Codex)

All 37 review tickets are resolved and moved to `issues/closed/`, with their
original reproductions, individual resolutions and regression pointers intact.
The [complete index](../llp/reviews/3000-architecture-code-review-20260912.md)
and [qualification record](../llp/reviews/3000-review-corrections-20260913.md)
link the delivered state. Integration includes upstream 0.1.15 HTTP response
batching alongside bounded encoding. The feeds card now uses an explicitly
capped immediate audience, and video examples narrow nullable duration.

The complete workspace passed 121 Rust tests; the full prescribed suite passed
its fixture, client, build and typecheck steps. A final mixed-version native
startup guard then passed package build/typecheck and all 94 client tests.
Independent core/periphery reviews and the final HTTP/example/native deltas
reported no material findings remaining in their defined scopes.

The production dry run built, packed and installed a 2,710,816-byte darwin-arm64
binary with matching source/installed version and SHA-256. The final
JavaScript-only follow-up was separately repacked and installed: all 36 dist
files match, and installed types, mock behavior and native incompatibility
cleanup pass with the unchanged binary. These were dry runs; the Expo native
framework/application still needs rebuilding for native publication. Cold
macOS executable-launch waits inflated the full-suite wall time to 277 seconds;
this record makes no claim to the 60-second cold budget.

The four Research children remain Draft with explicit remaining questions.
Source changes stayed in the owned integration worktree; the shared dirty root
and active sibling work were preserved.

## 2026-09-13 — native pending metadata on repeated updates

Interview reported `people row contains undeclared field pending` against its
older, modified `snapback-sb4` dependency. The comprehensive-review fix already
on main (`12c12a8e6`) filters this device metadata at all three `Predicting`
read paths. Query results and persisted pending cards keep the field; strict
application validation is unchanged. The same narrow filter was backported
to Interview's local dependency without taking its unrelated edits.

A shared authored fixture now covers repeated profile updates, vote upserts,
indexed and scanned vote updates, maintained totals, offline reopen/replay,
durable outbox order and replacement by confirmed server images. The native
control also checks that undeclared input fields still refuse. Verification
and the exact local-dependency scope are recorded with the resolved ticket.

## 2026-09-13 — three remaining ticket corrections (Codex)

Charlie asked to resolve the remaining suite-budget, reference-ID and cursor-note
filesystem tickets. References retain their existing typed-ID semantics: no
implicit target lookup, no cascade. Mutations needing a visible target use an
explicit metered `require exists`; the types/writes cards, E_INPUT explanation,
README and Interview sketch now say so. The regression exercises the string
`"null"`, actual JSON null, unchecked insert/update/upsert, guarded absent/hidden
and visible targets, and target deletion without dependent cleanup.

The compiler's N_NO_CURSOR note now uses the same alias/shape return-provenance
walk as continuation ownership, in a separate mode that includes cursorless
pages. The runtime's opaque-cursor-only plan is unchanged. Returned query pages
receive the note; consumed loops, mutation loops and job chunks do not. Authored
cases cover these paths, and the feeds fixture now requires zero notes.

The unchanged suite on M5 Max Black took 88.409 seconds during a sharp rise in
shared load (18.36 to 58.14), with two client failures. Sampling a fault run
found 2,001 of 2,258 samples under invariant inspection. The simulator now builds
one parsed host view per check pass and shares it among that pass's invariants;
every existing predicate still runs after every event. A regression verifies
that the next event's decreasing watermark is detected. The first affected
simulator unit group took 10.94 seconds versus the baseline's 27.15 seconds;
that comparison alone is not a complete-suite or controlled-host qualification.
The existing suite prints stage durations and Cargo reports all failing targets.

The client run also exposed a test race: Bob's query can fall back to the server
before its rows are durable locally. The native e2e test now waits for its actual
committed replica before closing, within the original reconnect deadline, and
keeps the cold-restart assertions. Chromium discovery includes Linux paths so
an idle fleet host can run the same React assertions during timing qualification.
Final repeated-suite evidence follows in the closed tickets.


## 2026-09-13 — integrating the concurrent performance landing (Codex)

While the ticket fixes were being qualified, main landed the same shared-chat
observation optimization in 4e126d206, alongside prepared statements, borrowed
JSON encoding and the HTTP worker reservation fix. Integration keeps that
landed ChatChecks implementation and its original simulator Invariant interface.
The provisional generic Inspection wrapper is discarded; its event-boundary
regression now exercises ChatChecks directly, alongside upstream's shared versus
separate observation and first-failure checks. This preserves both regressions
and every baseline assertion. The reference, note and native-test corrections
are unchanged. Preliminary measurements above refer to the pre-integration
candidate; the final ticket evidence records the integrated qualification.


## 2026-09-13 — three remaining tickets qualified and closed (Codex)

All three tickets are closed with their original observations and individual
resolutions under `issues/closed/`. The final integrated source 50c8edfdc
passes the complete suite on the otherwise idle expo-build-1000 host:
127 Rust tests, 94 client tests, 9 fixture tests, no failures or skips, plus
all build/typecheck steps. Warm repeats take 44.248 and 44.283 seconds, versus
61.621 seconds for the controlled baseline. The simulator group takes
10.88/10.87 seconds versus 28.35 seconds. The version-change rebuild run
also passes in 59.405 seconds. The closed suite-budget ticket preserves the
host/toolchain, per-stage table and limitations of earlier shared-Mac runs.

The final implementation keeps main's ChatChecks optimization, prepared
statements, borrowed-wire encoding and worker reservation fix. It adds the
reference/diagnostic corrections and test robustness without a new gate,
a larger budget or fewer assertions. Independent read-only review found no
material issues at 50c8edfdc. The Interview sketch compiles with 12 tables,
10 operations and zero notes; ref-check passes 471 LLPs and 8,684 references.
## 2026-09-13 — the guide is compiled: the language card, the cards as tests, and what the docs promised that the grammar refused

The author asked for a review of the Snapback 4 docs against the code —
docs to match the code, or the code to catch up where the docs sounded
nicer — and named the class the Clique lane paid for: a guide page can
promise what the parser refuses (the lane lost loops to a ternary the
guide promised, a `sum` helper, a bare `return` and division, each fixed
forward). The fix is guide-as-tests plus one language card.

**The guide is tested text.** `guide.rs` moved from the binary into
`snapback4-lang` (`snapback4_lang::guide`), where `tests/guide.rs` can
reach it: every ```quarry block on every card and in the package README
is compiled with no diagnostic and no note (a block that declares a table
stands alone; one that does not compiles beside the language card's
schema), the language card's one program is run against the engine —
every operation on it does what its comment says — and `init`'s template
compiles clean. The same test scans the sources: every `E_`/`N_` code the
engine, the compiler and the client emit must be in `guide::CODES` (the
one table `why` reads; fourteen were unexplained — `E_OVERFLOW`,
`E_DIV_ZERO`, `E_FIELD`, `E_STRUCTURAL_FANOUT`, `E_UNBOUND_SCAN`,
`E_JOB_GENERATION`, `E_SCHEMA_CONSTRAINT`, `E_QUARRY_PLACEMENT`,
`E_SCHEDULE`, `E_QUARRY_RETAIN`, `E_JOB_CURSOR_INDEX`, `E_CLIENT`,
`E_CLOSED`, `E_NATIVE_VERSION`), every `guide("..")` a diagnostic carries
must name a card (`indexes` is now one; `expressions` and `effects` named
none), the bounds card's numbers are `Ceilings::default()` and
`Ceilings::job()`, the refusals card names every family
`RuntimeError::FAMILIES` answers, and the keyword list is one list
(`guide::KEYWORDS`) that the language card, the README and the binary all
print. The language card (`snapback4 guide`) is one file that exercises
every form the parser accepts, with a comment on each, followed by what
is left out on purpose and the idiom for it: the ternary, `/` and `%`,
reassignment, `else if`, `while`, `continue`, `where`, `before`, string
concatenation, floats, `len`, result annotations, other comment marks,
imports, Snapback 2's words, `system` in a rule, `E_` codes, time
arithmetic, `not` binding tightest, writes in queries, loops past a cap,
effects, word search.

**What the docs promised and the grammar refused, now in the grammar.**
`break` — the README and the jobs card said it ends a sweep, the runtime
and the job runner handled it, the parser had no such statement; it is
one now, inside a `for` or a `chunk` (`E_QUARRY_PLACEMENT` elsewhere), and
`continue` is refused with its idiom. **What the grammar accepted and did
nothing with, now refused.** `shape|fn|proc x from module` parsed into
import lists nobody read (every `.q` file shares one namespace);
`readable <- rule` on a maintain bound into a field the engine never
consults. Both are `E_QUARRY_UNSUPPORTED` with the rewrite. **Notes that
fired where nothing was wrong.** `N_NO_CURSOR` follows returned-page
provenance (landed on main the same day by another session, closing the
ticket of LLP 3000.004; the `feeds` card compiles with zero notes, and
`tests/clique.rs` reads the recipe from the card); `N_NEVER_COMPLETE` skips jobs, which sweep as the system; and
`N_NO_HORIZON` skips a group that cannot grow — one row per group (a
table synced by its own `id`) or a group a `cap` bounds — so the chat
schema and the template compile with no note. The parser was at 1,499
lines; its expression half is `parser/expr.rs` now.

**The docs, corrected against the code** (two read-only audits, of the
CLI and wire and of the client, each finding cited to a line). The
client: `Link` has three states (`"signed-out"` was missing),
`useMutation` returns `last`, `family` is an open set (`asset`,
`prediction`, `generation`, `store`, `link`, `client` were missing; the
TypeScript twin spelled one refusal `predict` — now `prediction`, as the
engine does), `Refusal.rule`, a write is `pending` after four seconds
online and at `close()` (the online tier fails it `E_CLOSED`), the
`Asset` facts are always present (the contract's `?` is gone; the mock
now sends `duration: null`), a `NativeOpener` returns `{ call, close }`,
`store` is `"indexeddb"` | `"memory"` | an opener, creation rejects,
`E_NATIVE_VERSION`, `processCore`, `useClient`, `asset()`'s `revoke`,
`usePage` needs the cursor named `c`, the mock's `ops` shape, an
online-only table's query runs on the server, and the Expo sample now
sanitises the store and session names as the reference app does. The
CLI and wire: all thirteen verbs and their flags (`deploy`, `rollback`,
`serve`, `device`, `types`, `--version`, `data --limit`, `doctor --json`,
`run`'s output and exit codes, `test`'s derivations), `GET /` and `GET
/api.ts`, the paged snapshot (`after`, `limit`, `pending`), `/changes`'s
`wait`, `/m`'s `id`, `current` and `replayed`, `/q`'s `tables` and
`viewer`, status codes and body ceilings, the auth header rules, asset
headers, the maintenance cadence, `serve`'s bind and symlink, the
persona card's "(week 4)", the ceilings the bounds card omitted, the
snapshot page sizes (the client asks for 4,000; the wire's default is
2,000). `tokens(text)` is served — it is the @mentions of a text — where
§8 said it was parsed and not served; `emit` is accepted and queued in
`_outbox` with nothing delivering it, which the language card and §8 now
say in the same words. The top README's table and the agent sheet list
the crates and packages that exist. Published `snapback4@0.1.17` (0.1.16 was another session's, the same
day). One flake on the way: with the machine at a load average of 20–60
(other sessions' cargo runs), `native-e2e.test.mjs` failed fast in two of
three group runs — 142 and 298 ms, before its server answered — and passed
alone and in the third; no code on its path changed here.
## 2026-09-13 — native jobs: the app's Rust in the data plane, hosted as wasm, metered like a job; LLP 3000.005

The author, after the feeds document: *what if we let you write Rust
programs that could access the database and generate a feed that the
normal Snapback live query could serve — would that be crazy?* Not crazy;
then "write up an LLP about this and then implement." Both done tonight:
[LLP 3000.005](../llp/3000.005-native-jobs.rfc.md) and the code. `job
name(): native` is a job whose body is the app's crate under
`snapback/native/`, which `check` builds to `snapback/generated/native.wasm`
after writing `native.rs` — a constant per table, index and maintain and a
`serde` struct per table — and refuses if a declared job is not one the
module implements. The engine hosts it with `wasmi`: one chunk per call,
one transaction per chunk under `Ceilings::job()`, the module's one import
`sb4_call` dispatching to the chunk's own `Runner` (get, lookup, scan,
mint, insert, insert-if-absent, update, upsert, delete, log, now) so
rules' companions, maintains and the partition log apply and the meter
counts; the module returns `again` with a state of its own — a scan's
`next` — that commits with the chunk in the job row and comes back next
turn, or `done`; the first refusal parks the job, a trap parks it as
`E_NATIVE_TRAP` with the panic's text (the SDK's hook sends it through
`log` before the abort). No unsafe code in the core: the wasmi `Store<T>`
takes the borrowed runner as `T`, and a chunk-per-call shape means no
transaction outlives an instantiation. Fuel: measured on the fixture, one
host call costs about 90,000 units (JSON each way, interpreted); 8,192
inserts spent 750 M, a 100-post rescore 46 M; the ceiling is 2 G so the
row ceilings bind first (`SNAPBACK4_FUEL_PROBE=1` prints a chunk's fuel
and wall time). The guest SDK `crates/snapback4-native` (`Ctx`, `Chunk`,
`Next`, `jobs!`, `from_row`/`row_of`) is a path dependency until
published — the author's decision 2 in the document. The fixture
`native-fixtures/rescore` is Interview's rescore in Rust with a float
exponent, plus `overflow` (9,000 inserts → parked `E_BOUND`, the chunk
rolled back) and `boom` (a panic → parked with its text);
`crates/snapback4-sim/tests/native.rs` builds it for wasm inside the test
(cold ~20 s, then cached) and proves the scores, the query serving them,
the public partition holding them, three chunks resuming by state over
250 posts, the schedule firing it, and a parse refusal of `native` on a
mutation. On the CLI, the LLP 3000.004 sketch with the job native: `check`
13.1 s cold and 95 ms warm (a 105,000 B module), `run rescore` three rows,
`home` in score order with `seen` and `mine`, `doctor` naming the job,
the module and the toolchain, `deploy` shipping `native.wasm` in the
release and `serve` loading it. `parser.rs` split (`parser/programs.rs`)
to stay under the line budget. The `feeds` card's twin `native` card,
four codes (`E_NATIVE`, `E_NATIVE_TOOLCHAIN`, `E_NATIVE_BUILD`,
`E_NATIVE_TRAP`), the README section, the Moves line in `NOT-DOING.md`.
Not done: the SDK on crates.io; the same Rust over the device's `Rows`;
a binary protocol should the JSON per call ever be the cost.

## 2026-09-13 — one implementation: the device over a store trait, memory for the web, the ruling

The author asked whether the TypeScript twin was there only because wasm
had measured larger, and ruled: unify, one implementation in Rust (LLP
3000 §7). The web keeps its device in memory, since the interpreter's
store boundary is synchronous and IndexedDB is not; the host writes each
commit's changes behind the call and hands them back on the next open.

The device crate is that now. `store.rs` says what a device needs of a
store beyond `Rows` — a transaction with savepoints, metadata, the
outbox in submission order, the confirmed images beneath predictions,
the staged snapshot — and `device.rs` is the one device over it: the
stream applied with the watermark, paged snapshots staged until the last
page, admit and settle over confirmed images with the survivors replayed,
queries and predictions through `engine::local`; the snapshot owner is
a number from the store, not a process id, because a browser has none.
`sqlite.rs` binds the core's store on a native host, unchanged in
behaviour: the seven scenarios the reviewed module carried pass on it as
they did. `memory.rs` is the web's store — B-trees, transactions as an
undo log with savepoints as marks in it, index entries rebuilt on
install — and every commit reports its changes as `{s, k, v}` for the
host to persist; the first drain after an open carries what the open
installed, the backend and the generation. `call.rs` is the one JSON
dispatcher every host speaks, and `web.rs` the wasm surface over the
memory store: open with the backend and what the host kept, call, drain.

`tests/device.rs` runs every scenario on both stores — the memory host
in the test keeps each drain the way IndexedDB will, and a reopen loads
it back — and `tests/native.rs` keeps what only SQLite has: two devices
over one store, a store that fails mid-snapshot. One defect the memory
store had before the suite caught it: a committed transaction rolled
itself back on drop, because commit left its undo log standing.

Measured whole as wasm (`metrics/wasm.jsonl`): 1,212,605 B raw,
312,924 gzip, 237,870 brotli, against 194,465 gzip when the wasm carried
query and predict alone. That is the price before the diet; the ruling
accepts it and the diet is the third slice. Next: the one client over
one device interface with three openers (wasm on the web, the Expo
module, the process for Node), the TypeScript interpreter, replica and
stores retired once the Chromium and scale witnesses pass on wasm, the
apps and the docs moved, 0.2.0.

## 2026-09-13 — one client, three openers: the twin retired; 0.2.0

The JavaScript that remains is the one client the native tier already
was — `snapback4/local`'s `createLocalClient({ url, device, ... })`: the
session, the link, the transport, the observation of reads — over one
device interface, `DeviceOpener`: `open(name, backend)` giving back one
JSON call. The client derives the store's name from the server and the
viewer; where it lives is the opener's business. Three openers:
`webDevice()` from `snapback4/web` (the wasm device over memory, each
call's changes written to IndexedDB behind it, in one transaction per
call, so a queued write is as durable as the twin's was); `nativeDevice`
from `snapback4-expo` (the module, the store under the documents
directory); `processDevice()` from `snapback4/native` (the `snapback4
device` process, for Node). On the web one tab is one device: a tab that
finds the store's lock held opens a tab-scoped store, and the writes an
orphaned tab left queued are adopted, in their order, by the next device
that opens the store. Expo Go, which loads no custom native code and no
wasm under Hermes, runs the online tier with a session the app keeps.

Gone: the TypeScript interpreter, replica, stores, cursors and key
encoding (`src/replica/*`, 2,400 lines), their tests and the key vectors,
the two compiler tests that ran the twin against the interpreter, and
the twin's half of the storage measurement. The lifecycle suite runs its
scenarios on both the wasm and the process tier — thirty of them; the
one about two clients over one store stays native, since on the web a
tab is a device. The end-to-end suites run on the wasm device in Node
and the process device.

Two defects the move found. Replay minted past the admitted ids only to
learn it needed more, and minting with no entropy asked the clock —
`SystemTime::now`, which a browser does not have — so the wasm aborted
where a native host went on; replay's entropy now comes from the entry,
and the core's seed is a counter on wasm. And the memory store projected
every kept row onto the schema at each open, which stripped the device's
own `pending` mark from predictions across a reopen — caught by the
pending-metadata scenario that landed on main meanwhile, once it ran on
the wasm tier; rows are projected only when the schema's hash moved, and
the mark is not a column. That scenario now runs on both stores in the
device suite.

Measured (`metrics/client.jsonl`, `metrics/witness.jsonl`): the
local-first JavaScript is 12,070 B gzip where the twin's tier was
16,842, and the wasm beside it 313,763. The Chromium witness on the
wasm device: 303 rows synced in 75 ms (the twin: 59), a reopen in 17 ms
(4.5), the queued write landing after a reload, the refused prediction
typed; at scale, 20,440 events in 3,304 ms (4,496), the heap at 19.6 MB
(22.1), a thread read in 4.8 ms (10.2), and a reopen in 256 ms (11.7) —
the price of loading the partition into memory, which the ruling
accepted, and the number to watch. The simulator witness on the native
module is unchanged in kind and in number.

What the bytes are, from a symbol-bearing build: serde's derived
visitors 284 KB, serde_json 335 KB, alloc 267 KB (mostly serde's
instantiations), core 181 KB, the interpreter 126 KB, the device 61 KB —
two thirds JSON, a tenth interpreter. The diet is filed
(`issues/20260913-snapback4-wasm-device-diet.md`): decode the backend by
hand from one `Value` walk and drop the IR's derives on the device,
answer as text, fewer `format!` sites; done under 150 KB gzip. Next
after it: a rerun of the full brief on the unified client.

## 2026-09-13 — what Clique and Interview still needed: search, effects, service seats, presence, the ranked feed

The author asked for everything the two applications still lacked on the
platform, in this order: Clique's feed and search gaps, production identity
with worker integration, then Interview's authoring model and ranked feed.
The full-brief Clique record listed the platform half plainly — word
search parsed but not served, effects excluded, the push seam's connection
tracking hand-built in tables, the following feed at 19.2× — and
Interview's implementation record listed its adapter's remaining
responsibilities: it proxied every request because the engine had no seat
for a service and no session for a phone it verified. Five things landed
in one change, each in the Rust core so the server and the unified device
share them; the TypeScript replica (being deleted by the unification lane)
was not touched.

- **Word-prefix search.** `words(cols)` is an index component (Snapback
  2's serialized `WordPrefixes`, now built: one entry per distinct token,
  `index_keys` on every store, `key::word_range` for the byte range of a
  prefix) and `matching q` is the read. The first term's words are found by
  one seek each (at most 32; more is `complete: false`) and merged as lanes
  through the existing lazy merge, so a page is newest-first across every
  matching word with one cursor; further terms filter the page. One
  tokenizer (`words.rs`: NFC, lowercase, alphanumeric words; the contract
  string is recorded in the schema so a store built under another is
  refused). The device runs the same interpreter over the same entries, so
  offline search is the same code. Cursor suffixes are counted in
  components now (`Index::suffix_after`), the one change the plain paths
  needed. `parser.rs` was at its 1,500-line limit: the table block moved to
  `parser/tables.rs`.
- **Effects.** `emit` and `_outbox` existed with nothing draining them. The
  engine now keeps the queue honest (`engine/effects.rs`: claim under a
  lease, settle done or failed, backoff 2 s doubling to 5 min, eight
  attempts, expired leases requeued by the maintenance thread) and the
  wire exposes it to a worker (`/effects/claim` with a long poll,
  `/effects/<id>/done|failed`, `GET /effects`). `snapback4/worker` is the
  loop (`runWorker`), forty lines over the wire. The engine never calls
  out; NOT-DOING's "embedded JS engine, until measured" is decided: no.
- **Service seats and custom sessions.** `service:<name>` principals with
  their own sessions (`snapback4 token --service name`, a store row, printed
  once), admitted by rules as `viewer = 'service:name'` (a text literal
  beside `viewer` in a rule is a principal now, as in a program). A service
  mints sessions for accounts the application authenticated itself
  (`POST /auth/session`, principals outside the engine's namespaces) and
  revokes them (`POST /auth/revoke`). This is Interview's adapter reduced
  to an identity provider and two workers: the device talks to the server
  with its own token.
- **Presence.** `connected[p]` counts the long polls the server holds open
  for a principal (and 35 s after one answered), through a `Presence`
  registry the engine hands every context. Not a table. On a device the
  word is unknown: a query says `complete: false`, a prediction reads
  everyone as connected and the server decides. The Clique push seam is
  now `if not exists connected[m.principal]: emit notify {..}`.
- **The feed at scale, and the ranked shape.** The fan-out-on-write recipe
  is measured on the brief's probe: a reader with 500 follows and one with
  5, twenty posts by every author, both pages examine the same rows (the
  bar is 3×; this is 1×) and each device holds exactly its own lane under
  the horizon. LLP 3000.004 §4.2 lands on the `feeds` card as the ranked
  variant, compiled and run: a `ranked` public partition scored by a job
  from a maintain, `seen` and `affinity` synced to the viewer, the ranker
  admitted by its service name and refused as a user.

Tests: `tests/clique.rs` gained six (search on the server and on a
`MemoryRows` device, the compiler's search checks, the effects lifecycle
with a test `Presence`, the service seat and device presence, the feed
ratio, the ranked feed); `packages/snapback4/test/worker.test.mjs` drives
the real binary: `token` from the CLI, minted member sessions, a held
poll read as presence, an emit claimed, retried and settled by
`runWorker`, revocation closing the door. Version 0.1.17. The web replica
does not run `matching` locally until the unified device replaces it (the
README says so); the unification lane's device stores must write
`index_keys`, not `index_key`, for a words index to exist on a device —
one call each in `memory.rs` and `sqlite.rs`.

Not done here, by design: relevance ranking, stemming, an identity
provider in the engine (phone, OAuth), push delivery, multi-server
presence. Interview's own re-authoring onto these seats (its phone worker
minting sessions, its model worker as an effect handler, Home on the
ranked recipe) is application work in the Interview repository.

## 2026-09-13 — 0.2.2 published: search, effects, services, presence, the ranked feed

The landing above rebased over the 0.2.0 unification, native jobs and the
compiled guide (`1f5b8a6ac`), then took its own version (`bf63040d1`)
because another session published 0.2.1 from main four minutes before the
first publish attempt. `snapback4@0.2.2` and `snapback4-darwin-arm64@0.2.2`
are on npm (the record is in `metrics/publish.jsonl`; production profile,
7.3 MB binary, 438 KB client tarball with `dist/worker.js` and the wasm
device). `snapback4-expo` stays at 0.2.0: its module's ops did not change.


## 2026-09-13 — remaining-ticket repair, core boundary checkpoint (Codex)

The 36-ticket repair run starts from origin/main `42437496d`, after the
unified device, compiled guide, search and effects landings. The engine
remains under one implementation owner, with compiler/device, JavaScript
client and HTTP/CLI lanes isolated beside it. The shared dirty main
checkout is preserved.

This checkpoint makes membership reconstruction read every transition
through its transaction head, then batches authorized log intervals in one
SQLite statement per page/probe. Join expansion uses the images at the join
commit, including a join followed by a later leave; it never substitutes an
image changed after the leave. Same-commit grants still disclose nothing.
Read-only connections retain catalog/generation identity and use deferred
transactions, so HTTP response construction can leave the engine mutex.

Non-unique internal scan continuations keep the appended id. Acquisition
horizons count living rows. Job chunks check final-existence constraints
before commit, and emit-only chunks commit their effects. Schedule
activation refuses missing jobs; boundary state is monotone and a changed
schedule shape begins from its next boundary. Released assets detach their
home and can be reclaimed by their uploader while bytes remain. Asset
authorization no longer consumes a view: the host records successful
delivery separately. The simulator uses audience columns in order for
scope removal. Projected queries retain the next visible expiry so clients
can invalidate without polling.

Focused review suites pass 31 tests, including new regressions for both
sides of the membership disclosure boundary, duplicate-index continuation,
job rollback, rewind/shape changes, reclaim, acquisition expiry and a
concurrent writer under a stable reader snapshot. HTTP wiring, full-suite
qualification and blind review follow before delivery.

## 2026-09-13 — integrated ticket correction pass

The remaining expiry cuts now share explicit virtual time in the simulator and logical absence in acquisition, non-unique lookup, uniqueness, caps, final-exists constraints and maintained reads. Partition spans carry a membership's lifetime, so an unswept membership cannot authorize commits made after expiry. Changing that lifetime writes a new grant; legacy expiring grants with no recoverable lifetime fail closed. Aggregate rebuilds page source and target rows. Schema serialization happens after releasing the compiled-backend lock.

Client outcomes now have reactive viewer and terminal-write subscriptions, authenticated probes, table-scoped invalidation after stream apply, and timers for visible expiry. HTTP one-view delivery opens first, rejects partial transfers, serializes per asset/viewer, and records consumption only after a complete successful response. Poison recovery, activation interlocks, generated-write failures and CLI diagnostics have real-host regressions. Native reads use deferred transactions; device withdrawal replays surviving predictions; C exports contain unwinds where the build unwinds (production panic=abort still aborts). Language fallthrough is nullable and the ancillary declaration diagnostics are explicit. The retired TypeScript interpreter reports are covered by regressions against the unified Rust device.

## 2026-09-13 — the device-side twin: native reads, the same Rust on the server and on the device; LLP 3000.005 §9

The author ruled on LLP 3000.005's third decision first: the device-side
twin over the same `Rows` trait is the next native-module step. Built the
same day, on top of the one-implementation device that landed meanwhile.
`query name(args): native` is a **native read**: the module's `sb4_read`
over a `Runner` built for the viewer on the server — every `get`,
`lookup`, `scan` the interpreter's own, hidden rows null, the read meter
capping, `complete` the meter's word, writes refused — and over the
device's transaction on a native device (`engine::local::native_query`,
`runner.device = true`, a page at the horizon `complete: false`, the
coverage flag the client already falls back on). The device installs the
module through the one JSON call (`install_native { wasm, digest }`),
keeps its bytes in the store beside the backend so a cold start offline
reloads it, and reports the digest in `state`; the server names the module
in `/schema` and serves it at `/native.wasm`; the client fetches it once
per digest at open and on adopt. `wasmi` is built `deterministic`. The
core's host moved behind a `wasm-host` feature so a device carries it
without SQLite; the device's `native` feature does, its `web` feature
does not: measured on one tree, the web device's wasm with the host is
647,583 B gzip against 384,531 without, and doubling every web app's
wasm for a feature most will not use was refused — a web device says it
has no module and the client asks the server; a second wasm build chosen
by the opener is the follow-up, after the diet. The SDK gained `module!
{ jobs: [..], reads: [..] }` (`jobs!` stays), `sb4_reads`/`sb4_read`,
`Ctx::viewer`. The fixture gained `personalize` — the shared `ranked`
page lifted by the viewer's `affinity`, sunk when `seen`, the viewer's own
vote beside each row, a float in the weight — and its own `schema.q` the
sim and device tests both compile. `tests/native_reads.rs` proves the
twin: the server's answer for bob and the memory device's and the SQLite
device's are byte-equal, a device without the module says so with
`unknown: true`, a reopened device with no server holds the module and
answers, a read the module lacks refuses by name. A mutation cannot be
native; `check` refuses a declared read the module does not implement;
the guide's `native` card, the language card, the programs card and the
README carry the read. Not done: the web's second build; the SDK on
crates.io.


## 2026-09-13 — 0.2.4 published: native reads, the device-side twin

`snapback4@0.2.4` and `snapback4-darwin-arm64@0.2.4` are on npm
(15:35 UTC): the twin of LLP 3000.005 §9 on the pin. The publish ran the
suite green in 65 s under a load of about twenty, built the production
binary (6,802,080 B, opt-level 3), packed 439,283 B for the client and
3,329,586 B for the platform, proved the installed consumer, and published
both in 176 s. The client tarball carries the web device's wasm without
the host (1.4 MB raw), as §9 decided. The registry answered `snapback4@0.2.4`
about two minutes after the platform package; a view in between reads 404.

## 2026-09-13 — moving-main integration and review correction

The ticket pass integrates 0.2.4's native reads while preserving deferred device transactions, query expiry metadata, refusal-safe client adoption and asset-delivery serialization. A partial independent Sol review found a legacy grant borrowing a later rejoin's expiry. The regression fails against the prior fallback and passes when historical legacy grants without their own deadline fail closed. The reviewer was stopped by a provider safety filter before completing its broader audit; this is a received finding, not a clean whole-review verdict.

The first full local suite passed all assertions in 87 s with rebuilt artifacts. A controlled warm Linux run also passed but took 64.04 s, so the 60-second ticket requires a further runner correction. Publication remains pending that qualification. The planned pins are snapback4/snapback4-darwin-arm64 0.2.5 and a rebuilt snapback4-expo 0.2.1.

## 2026-09-13 — received Grok expiry review

Grok 4.6 independently reproduced two remaining gaps at `3d2007794`: catch-up after logical membership expiry installed until-revoked rows without a scope, and a partial device returned the stored maintain count including expired sources. The correction appends an expiry scope after catch-up, and an offline until-revoked read rechecks an expiring audience on the local clock. That check supplies the observation's next expiry; delivered history keeps its policy. A device that does not hold the required membership is honestly incomplete. Maintained reads over partial sources now count only live held rows and remain incomplete where the horizon cannot establish full coverage. A row count smaller than a horizon does not prove coverage because exact backfill remains out of scope.

## 2026-09-13 — native adoption and device expiry qualification

The native-read integration now verifies downloaded SHA-256 bytes and persists the module, digest and backend generation together. Reopen rejects corrupt, partial, unbound legacy or obsolete-generation caches. A generation change invalidates all three metadata entries in the same transaction that installs the backend, then clears the in-memory module without another fallible store operation. Failed JavaScript installation falls back online and later queries retry; offline reopen refreshes the descriptor after reconnect. Seven native-read regressions include interrupted adoption and a store that refuses any post-install transaction.

Device expiry regressions run over both SQLite and memory: an expiring membership sets nextExpiry=10, hides until-revoked rows at time 20 while preserving delivered history, and receives a terminal scope on drained catch-up. Maintained values count only live held sources (two becomes one), retain incomplete coverage for a horizon, and never substitute a stale global count from an online-only source. Both expiry tests pass, as does the complete 14-test device target in the test lane.

The existing blocking runner now overlaps its independent Rust, fixture and client checks after their build prerequisites. Every child is waited, every failure is reported, and interrupts remain nonzero. On the same controlled Linux host, the unchanged product checkpoint fell from a green 64.04 s sequential run to a green 34.34 s concurrent run. No assertion was removed and no ceiling changed. Final integrated qualification and publication receipts follow.

## 2026-09-13 — final repair suite within the blocking budget

The exact integrated checkpoint `669dc0c01` passes the complete existing suite twice warm on expo-build-1000: 36.70 s and 36.50 s, with 189 Rust, 9 fixture and 77 client tests passing and one predeclared native throughput test ignored for its recorded cost. The local full run passed in 54 s with a rebuilt wasm artifact. Reference validation reports 472 LLPs, 8,716 references, zero errors and zero unchecked. The rebuilt iOS xcframework totals 13,134,849 bytes across device/simulator slices; every packed file hash matches the build. Publication remains pending final independent review.

## 2026-09-13 — second blind core review and boundary regressions

Independent Sol and Grok reviews of `65e2ad752` found six actionable boundary defects. Replacement grants now own their interval before an old membership is swept, and sweeping the old grant preserves the replacement. Expiring sums retain zero-valued candidates while source rows remain; opening a legacy server store repairs missing candidates once without changing its backend generation. Meter cuts preserve scan continuation and return observed partial maintained contributions; visible expiring point reads charge once. Fully held device scans remain complete while checking their expiring audience.

The four Sol findings were first reproduced red. The resulting focused targets pass: 31 correction tests, 11 earlier review tests, 16 device tests across SQLite and memory, and 11 guide tests. Grok's proposed all-pages snapshot history guarantee was declined after reading the existing cursor contract: membership is rechecked per page and delivered-history covers acquired rows. A deterministic two-store test retains the first delivered page, excludes unacquired rows after expiry, and denies post-expiry writes. No client-supplied cursor clock can extend authority. Received findings and dispositions are retained under `llp/reviews/`; final whole-suite qualification follows.

## 2026-09-13 — the security boundary: local development, bounded host work, rotated sessions

The first dedicated security review found twelve holes and the integration
pass added three adjacent ones. The development door now belongs to a literal
loopback request: loopback peer and `Host`, absent or matching local `Origin`,
one unambiguous credential, reflected origin. The release host defaults to
`127.0.0.1`; exposing its cleartext socket takes an explicit flag and warning,
with the supported deployment contract a same-host TLS proxy that cannot reach
the development persona door. The catalog, module, generated API, and change
feed all require a live session, including both sides of a long-poll wait.

The process has finite admission now: connections, short workers, waiters,
headers, bodies, writes, idle time, password work, password attempts, and
uploads each have a bound. Protected bodies are authenticated before they are
buffered. Argon2, staged upload writes, and asset-file deletion happen outside
the engine mutex; password and upload commits recheck the authority they began
with. Store parents and asset directories are owner-only on Unix, as are the
database, SQLite sidecars, staged files, and final bytes. Other platforms fail
closed until they can make the same custody promise.

The rule boundary also became closed under the less obvious paths. Hidden id
and unique collisions use the generic rule refusal, including if-absent and
upsert. Partition catch-up reconstructs the current readable image rather than
replaying a deleted or since-hidden one. Minted IDs use OS randomness on native
targets and Web Crypto in the browser. Audience insertion must follow an
existing grant or a group created in the same mutation, must use the actual
recipient slot and plain group index, and cannot later rewrite its group or
recipient columns without an equivalent guard.

Ordinary sessions now live seven days, rotate atomically through refresh, can
all be revoked for an account, and are pruned through an expiry index. The web
client keeps them in memory unless the application explicitly opts into the
page-readable local-storage adapter; it refreshes before the final day and
rejects stale-token races. Media facts have dimension and duration ceilings.
Once-view accounting includes the uploader after placement and refuses ranges
before consuming a view; ordinary unsatisfiable ranges return 416, and every
asset response is private and `no-store`. The exact checks and independent
review for the integrated result live in the 2026-09-13 security remediation
record beside LLP 3000.

## 2026-09-13 — effect claims close the wait boundary

The independent remediation review found one remaining authorization gap in
the long effect-claim path: a service session was checked before waiting, but
could be revoked or expire before the next claim attempt. The claim loop now
reauthenticates at every attempt, including every wake, before it can observe
or lease newly available work. A deterministic host regression revokes the
service token exactly at that boundary and requires `E_AUTH`.

## 2026-09-13 — security integration during ticket qualification

The repair checkpoint `9bf6d4a83` passed the complete suite locally in 48 s and on the controlled Linux host in 36.59 s (197 Rust, 9 fixture, 81 client passes; one predeclared ignored test). Main meanwhile advanced through `867045564` with separately reviewed security hardening and SQLite plan reuse; npm 0.2.5 was occupied. This delivery integrates that content and reserves 0.2.6 for the client/platform, while the rebuilt Expo module remains 0.2.1.

The security ruling narrows server history: a stream cannot recover deleted, expired, replaced or currently hidden content from an old watermark. Join candidates and grant intervals remain reconstructed correctly, but serving resolves candidates to current readable images. Delivered-history retains an already acquired device copy, without granting retrieval after revocation. This supersedes the earlier ticket pass's historical-body acquisition expectation for a closed membership; live rejoining, whole-commit pagination and expiry boundaries remain covered. One-view authorization remains separate from delivery: the uploader follows the placed row's rule, Range is refused, and the host records a view only after a complete successful transfer. An xcframework build interrupted by the merge failed on conflict markers and is discarded; the final merged core will be rebuilt.

The asset merge regression reproduced a released upload being reclaimed between collection preparation and file removal. Collection now writes a durable internal `_asset_gc` reservation in its preparation transaction; claiming a reserved asset refuses while ordinary release still permits a move. Restarted collection can retry the reserved row, and forgetting the asset removes the marker. This composes outside-lock file removal with the ticket's release/reclaim behavior.

The narrow Sol correction review found that a capped aggregate scan discarded a partial contribution that the corresponding point read retained. A five-source group under an examined ceiling of three reproduced an empty page instead of the observed count two. The scan now returns that partial row with incomplete coverage and a cursor after it, while preserving the existing two-group continuation regression.

## 2026-09-13 — merged security and ticket qualification

The exact merged product checkpoint `d8cdc6c81` passes the entire existing blocking suite: 56 s locally and 34.29 s warm on expo-build-1000. Both report 234 Rust, 9 fixture and 86 client passes with zero failures and one explicitly ignored debug-host throughput test. The Linux checkout remained clean; the raw log SHA-256 is `e654d70e889ab84ce61872d57f27e91dfbf41873482dee91580989655d84136b`. Reference validation reports 472 LLPs, 8,728 references, zero errors and zero unchecked. The rebuilt iOS framework contains 13,190,633 bytes across device/simulator slices, rounded to 13.2 MB in its command sheet and README. Every packed framework file matches the build byte for byte. Publication remains pending the final integration review.

The independent host lane reviewed the new GC reservation statically and found no material defect: prepare reserves inside the write transaction, claim refuses while reserved, interrupted file removal remains retryable, and catalog cleanup removes the reservation. The host integration separately passes 26 Rust tests, 12 tiny_http tests, 9 HTTP bounds tests and 10 release-activation tests. The independent client lane's integration checks pass type/build, four session-security tests, ten focused lifecycle tests and ten React tests.

## 2026-09-13 — a grant replacement retires its expired predecessor

The later Grok correction review exposed a device that had acquired a row before membership expiry, missed its deletion during the unauthorized gap, then rejoined. Current-image filtering fixed a catch-up starting before the first join, but could not delete a row already held at a later watermark. The device regression reproduced the stale row. Expanding a replacement join now sends the expired predecessor's scope before acquiring the new group image; a renewal whose predecessor was still live sends no such scope and keeps its acquired horizon. Delivered-history continues to apply its declared leave policy.

The two-store control exposed both missing pieces: initialization now uses the latest grant before the watermark even when the next transition is another join, and renewing the same audience before expiry emits a new deadline without an ordinary scope. The gap and continuous-renewal tests pass on SQLite and memory; the complete focused targets pass 18 device, 32 correction and 11 earlier-review tests. Scope ordering is asserted before replacement content, including after the old grant is swept.

The final integration's independent Sol review also reproduced a delayed mutation being terminally failed by an obsolete bearer response during successful session rotation. The client now keeps that mutation's durable outbox entry and ID, retries under the new bearer, and emits exactly one terminal outcome. The regression first failed waiting for a retry; after correction, five session-security and ten focused lifecycle tests pass with typecheck/build.

## 2026-09-13 — rotated credentials preserve live observations

The received Grok integration review independently found the stale-token write race and its online-only read variant. A delayed old-bearer query could install an authentication refusal after refresh succeeded, with no later table change to rerun the watch. The regression first reproduced that stuck observation. Server reads now wait for an active rotation and retry obsolete authentication replies, while a successful refresh reruns watches after its current-credential sync. Subscribers never see the obsolete refusal; the same watch recovers with current data. Typecheck/build, all six session-security tests and ten focused lifecycle tests pass, including the durable same-ID mutation retry.

Immediately before that final JavaScript correction, the full suite at product checkpoint `d65e8aad4` passed locally in 50 seconds: 236 Rust, 9 fixture and 87 client tests, zero failures and one explicitly ignored debug throughput test. Product inputs remained fixed during execution; only a received review artifact was staged. The retained raw log SHA-256 is `dff17e9735cfc7c73610d708114efe00b39a959fed2a517cf864b84521238b31`. Final publication qualification includes the additional query regression.

## 2026-09-13 — final ticket checkpoint and native package

The complete suite at exact product checkpoint `c30a517d7cbb7429295a0708bee33b51b5534a94` passes warm on expo-build-1000 in 34.209 seconds, with its tracked checkout clean. It includes 236 Rust, 9 fixture and 88 client passes, zero failures and one declared ignored debug throughput test. The raw log SHA-256 is `415bc070ac4de6b8dda8eb755f2fbbddee0baa82ef66a2ec07c2868f2e9490eb`; the receipt SHA-256 is `be9ebc5d83bd3325d6c5fc5f7a91ff68fd4690772da1d598bad00c6712cc6aa6`. Reference validation passes with 472 LLPs, 8,730 references, zero errors and zero unchecked.

Both iOS slices were rebuilt after the grant corrections. The framework totals 13,192,393 bytes; all seven files and the README match the packed Expo artifact byte for byte. The prepared 0.2.1 tarball has SHA-256 `02aa66c6d7bf385b9724f08adb1448e3508f38cd4237d08ac00b2de0e13894fe`. These are build and pack receipts; publication and the full three-model Clique runs remain pending at this entry.

## 2026-09-13 — credential staleness belongs to the request

The final narrow Sol pass found a concurrent-sign-out variant: a current-bearer query can end the session before an old-bearer mutation refusal arrives. Classifying the old reply from the global session-dead flag then wrongly settles it. A deterministic regression reproduced that deletion. The client now captures authentication staleness from the request revision or active rotation before handling the refusal; the old write stays durable and pending, and a current-credential refusal still ends the session. Typecheck/build, seven session-security tests and ten focused lifecycle tests pass. The old-red log SHA-256 is `d2e96b0d1eb970575b8ae2e63c203b1baf17aba289692f1ffaa50f7c8c9a97d2`; focused green is `d1f05964c14fc716fd37fd971d068eefb144ef30c489796015911b225afc125d`.

## 2026-09-13 — final independent review complete

The final bounded Grok pass at `c30a517d7` reports no material finding in expired-predecessor/live-renewal handling and the stale-authentication observation correction. Sol separately cleared that core correction, reproduced the concurrent-session-end mutation race, and reviewed its one-expression correction at `0c21402edaa23381d42d94edb915d73762ecaebe` in a fresh session. A fresh, mutually blind Grok review of the same final request-revision delta also reports no material finding. All received reports, including earlier material findings and dispositions, are retained under `llp/reviews/`. The final source delta has typecheck/build and focused regressions green; the qualified publisher reruns the complete suite before any npm publication.

## 2026-09-13 — ticket repairs published; full Clique comparison launched

The 52 run-owned repair and evidence commits landed at `342c53d306d7484cd64e820ee27a151e02eb4b0b`. The normal push hook initially lacked a root JavaScript dependency in the isolated worktree; `bun install --frozen-lockfile` restored it and the normal push passed, with no bypass. The qualified publisher passed its entire suite in 30 seconds (236 Rust, 9 fixture and 89 client passes, zero failures, one declared ignored test), built the production binary and verified the installed consumer. `snapback4` and its darwin-arm64 binary are published at 0.2.6; the rebuilt Expo module is published at 0.2.1. Registry integrity matches all three exact qualified tarballs.

The full unchanged Clique instrument is now frozen to those pins for Astra medium, Grok 4.6 xhigh and Muse Spark 1.3 xhigh. Astra started its cold continuous session at 18:30:36 UTC; later builders, independent grades and fresh M7 runs remain pending. The new record is `benchmarks/runs/2026-09-13-snapback4-clique-0004/`. The grade records all 119 assertions while retaining the previous 101-assertion subtotal for comparison. These are launch facts, not benchmark results.

## 2026-09-13 — LLP 3000.007 implementation launched: five Codex lanes, cut by file ownership

The author ruled on every question of LLP 3000.007 and said "Go. Use
Astra on xhigh for coding." Five Codex lanes (gpt-6-astra, xhigh) run
concurrently from worktrees `~/projects/snapback-lane-{M,L,R,C,B}` on
branches `sb4/lane-*`; the lead lands each. A concurrent session touching
these files should expect a rebase against them:

- **M — the meter (§5.0):** `crates/snapback4-core/src/{engine/runner.rs
  (heap charges), value.rs, meter.rs}`; tests in core, sim and both device
  stores. Concat, Let/Assign and allocating builtins charge the heap;
  clone-or-charge on variable reads decided by measurement.
- **L — the language (§5.1–§5.8):** `crates/snapback4-lang/src/{parser*,
  bind/program*, types, print, diag, guide}`, `crates/snapback4-core/src/
  {ir.rs, engine/{runner,read,pages,write,job,validate}.rs, schema.rs,
  cursor.rs}`, README §2, `tests/clique.rs`, the corpus. The seven forms,
  `fn` bodies (`proc` deleted), job preludes, range seeks, `where` with the
  §5.6 cursor rule, `group`/`first`/`last`/`at`, `join`/`trim`/`lower`,
  page-as-list, `upsert` that patches, column defaults, `range` over
  expressions, `pending` through shapes, guessed spellings refused with
  exact rewrites.
- **R — residency (§6):** `bind/schema.rs`, `bind/mod.rs`, `emit.rs` (the
  `runs`/`predicts` words and doc comments), `verbs.rs` (`check
  --residency`, `why`, `test --residency`), `local.ts` READ path,
  `contract.ts` `Op` only, a `residency` card, `tests/residency.rs`. The
  inferred sync audience, `online only` on tables and maintains, the
  per-site classes, the three notes, `E_PREDICT` naming the fact.
- **C — the client and dev seams (§8.1–§8.6, §8.13):** `contract.ts`
  `Write` only, `client.ts`, `local.ts` WRITE path and assets, `react.tsx`,
  `web.ts`, `snapback4-expo`, `serve.rs`/`verbs.rs` dev identity limits,
  the device crate and `validate.rs` for the `{ id }` asset facts, the
  `E_RULE` message, the media cache.
- **B — the ceremony bar (§10.3):** `loopbar/`, `metrics/ceremonybar.jsonl`,
  the "before" record on the published 0.2.8.

Not launched: the periphery verbs, worker actions, and §8.7/§5.9 (the blind
security review is in flight; its artifacts land under `llp/reviews/`).

## 2026-09-13 — the blind review of LLP 3000.007 §8.7 and §5.9 returned

GPT (Codex, gpt-6-astra, xhigh): NOT READY. Grok (grok-4.6, xhigh): READY
WITH CHANGES. One brief, one baseline (`4e8e3efef`), read-only, blind to
each other. They converge: the binder's unique-key write reads under the
read rule (that is the Clique bug); an unreadable target's failure words
must collapse to one; the merged image, `old`, `result` and `current` stay
in the engine; withhold before `_ops` records (replay returns cached
content after revocation today — a P1 ticket); the device must queue
without a row on a write miss instead of predicting `NOT_FOUND` or an
insert; and §5.9's pass must be admitted on uniformly authorized prefixes
only, because abort versus success at the examined ceiling is the
meter-cut oracle. Both artifacts are under `llp/reviews/`; the
dispositions, the narrowed §8.7/§5.9 and the regression list are LLP
3000.007 §15; ruling 15 is the author's. Neither section lands before it.


## 2026-09-13 — Lane M: the heap meter owns accumulation (LLP 3000.007 §5.0)

Implemented allocation charging in the interpreter without changing a ceiling,
serialized value, binder, or client implementation. Concat, Slice, Sort,
MentionTokens, Divmod and Share charge their result or workspace; bindings
(including Const, Let and Assign), owned variable/literal/field copies, page
loop materialization, literal ranges and recursive results count too. Push
keeps its value charge and uses the actual Value slot width (32 B here)
instead of 16 B. Argument/viewer copies now count. Sort and derived loops
consume owned arrays instead of copying again; text concatenation borrows
its string operands instead of making temporary string copies. Shared
Arc row/map images still do not allocate on Clone. The byte model remains
conservative: binding a compound value charges its retained image even
when that image was also charged during construction; it is not a live-RSS
measurement.

Compared charging every owned variable read with borrowing pure field
accesses and Len/Count/CountCapped/Sum inputs. Kept borrowing plus charging
every residual owned clone. This preserves the existing Value API and wire;
it avoids changing String/Array to Arc across other lanes. On the IR
workloads, it saves 32,000 / 2,064,384 / 400,000 B against clone charging,
and the measured execution medians fall from 362 / 915 / 143 us to
291 / 636 / 87 us. The chat queries do not exercise those scalar inspectors;
their heap counters are identical between the two candidates. The fixture
wall times are small and noisy; the seeded chat run was slower with the
chosen candidate, so this is an allocation win, not a claim of universally
lower query latency.

Heap cuts now record capped_at through Meter::charge and immediately unwind.
A query whose scalar/shape cannot be finished returns data: null,
complete: false, next: null; neither a partial value of the wrong shape nor
a continuation past unprocessed work is invented. The cut and counts remain
private to the engine, as LLP 3000 §7 requires. A mutation still aborts
E_BOUND and rolls back the entire transaction. The package README records
this outcome. The bounds guide needs the same wording when the lead
integrates the binder lane: its file was explicitly protected from Lane M.
No new diagnostic code was added.

Measurements use base 4e8e3efefeac6e313d40e5556c45d378b4fdb807. The baseline
runtime was measured with only the CLI heap-column instrumentation and the
IR measurement test added; neither changes its execution. For each variant,
build once, warm each command once, then measure three sequential runs;
wall times below are medians in seconds, including process startup and the
warm Cargo invocation, excluding builds. Raw logs and the timer script are
in /tmp/lane-m-{baseline,charge,borrow}-* and /tmp/lane-m-measure.py on this
machine. They are development evidence, not committed benchmark apparatus.

| Command/workload | Baseline s | Charge copies s | Borrow + charge s |
|---|---:|---:|---:|
| cargo test -p snapback4-core --test corpus -- --nocapture | 1.196233 | 1.141561 | 1.191866 |
| chat: snapback4 test --fixture ../../fixtures | 0.012059 | 0.010793 | 0.011400 |
| chat: snapback4 test (empty dev store) | 0.010677 | 0.010184 | 0.009983 |
| chat: snapback4 test --fixture /tmp/lane-m-chat-fixture | 0.018311 | 0.018182 | 0.024483 |
| cargo test -p snapback4-core --test meter measured_ir_programs -- --nocapture | 0.080390 | 0.080400 | 0.081147 |

The requested ../../fixtures directory contains the Clique wrapper, not
chat JSONL: that command loaded 0 rows, ran inbox for all three personas,
and explicitly skipped thread for missing conversationId. Also launched
snapback4 dev --fresh --no-watch --port 4499, stopped that recorded process,
and ran test on the empty dev store. --fresh serves an in-memory store;
test independently opens the project's empty dev store. To avoid calling
that a representative data fixture, separately measured a temporary chat
sample matching the device suite: one conversation, two memberships and
120 messages (123 rows). Its queries and byte deltas are below. Charlie's
thread is refused MEMBERSHIP_REQUIRED on the derived conversation in every
variant, so no successful-program heap counter exists for that row.

| Program/persona and data | Baseline heap B | Charge copies B | Borrow + charge B | Final delta B |
|---|---:|---:|---:|---:|
| Empty inbox alice | 0 | 9 | 9 | +9 |
| Empty inbox bob | 0 | 7 | 7 | +7 |
| Empty inbox charlie | 0 | 11 | 11 | +11 |
| 123-row thread alice | 33,120 | 33,135 | 33,135 | +15 |
| 123-row thread bob | 33,120 | 33,133 | 33,133 | +13 |
| 123-row inbox alice | 739 | 2,584 | 2,584 | +1,845 |
| 123-row inbox bob | 739 | 2,581 | 2,581 | +1,842 |
| 123-row inbox charlie | 0 | 11 | 11 | +11 |
| IR concat_page_8 | 0 | 666,640 | 634,640 | +634,640 |
| IR push_page_8 | 2,056,192 | 6,227,792 | 4,163,408 | +2,107,216 |
| IR count_text_100 | 0 | 411,200 | 11,200 | +11,200 |

The empty-query deltas are exactly the newly charged viewer string copies.
Thread adds its argument and viewer copies. Inbox also materializes a page,
point-read row and shaped object, binds locals and copies field values that
previously went uncharged. Output bytes and query results remain unchanged.
The three IR execution medians, baseline / charge / borrow in microseconds,
are 428 / 362 / 291 (concat), 921 / 915 / 636 (push), and 124 / 143 / 87
(count text). The concat workload folds eight 4,000-character bodies; push
appends each of those bodies 64 times; count reads a 4,000-character local
100 times.

Stress fixtures use a complete, schema-capped 128-row page of 4,000-character
bodies so accumulation, not an examined-row or output cut, reaches the heap
ceiling. Concat cuts at 16,806,240 B; push at 16,780,160 B; ceiling
16,777,216 B. Both stores report the same query counts; server mutations
reach the same counts at 212 and 6,075 steps respectively. Two-row positive
runs produce 8,000 characters or 128 items and commit successfully. Failed
server and device mutations leave their pre-loop write absent. A separate
meter test accepts exactly 16,777,216 B and refuses the next byte, recording
the first cut under Cap. Builtin tests check returned values and smaller
heap ceilings; the corpus is unchanged. The CLI test table previously
omitted heap entirely; verbs.rs now prints heap B beside its ceiling.
The unmerged binder does not yet emit source text concat, so its end-to-end
source-to-CLI demonstration belongs to that lane; the IR execution and the
CLI's real heap counters are independently exercised here.

Verification (commands run from snapback4 unless noted):

- cargo test -p snapback4-core --test meter -- --nocapture:
  test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
- cargo test -p snapback4-device --test device heap_cuts_and_successful_accumulators_on_both_stores -- --nocapture:
  test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 18 filtered out; finished in 0.44s
- cargo test -p snapback4-sim --test reviews:
  test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
- cargo test -p snapback4-core --test corpus -- --nocapture: every candidate
  passes all 16 tests; corpus (Rust server only; no TypeScript/replica conformance claim): 211 passed, 82 skipped, 0 failed.
- From repository root, with PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH,
  bash snapback4/scripts/test.sh: first run 2 failure(s) in 60 s; final run
  == 1 failure(s) in 57 s. Final Rust totals: 245 passed, 0 failed, 1 ignored;
  fixture wrapper: 9 passed, 0 failed; client: 79 passed, 1 failed.

The first suite exposed two introduced assertions comparing meters for
unequal-length caller IDs. Updated the simulator review scenarios to use
identical caller inputs against empty versus hidden stores; all 11 reviews
pass, preserving the privacy invariant rather than subtracting its heap
counter. The remaining full-suite failure is Chromium SIGABRT during launch
in React hooks and reference-app lifetimes, before any browser assertion.
node --test packages/snapback4/test/react.test.mjs reproduces alone (0 pass,
1 fail) and in an untouched git archive of baseline
4e8e3efefeac6e313d40e5556c45d378b4fdb807 at /tmp/lane-m-base/snapback4
(0 pass, 1 fail), using the same installed dependencies and Node 24. The
final suite log is /tmp/lane-m-suite-final.log; baseline browser evidence
is /tmp/lane-m-baseline-react.log. No browser/client source was changed.

Out of the core/tests scope, only the explicitly allowed missing CLI column
in crates/snapback4/src/verbs.rs, the required meter documentation in the
package README, and this required journal entry changed. No commit, push,
tag or publication was made. Existing LANE-BRIEF.md was left untouched.

## 2026-09-13 — Lane B: the ceremony bar's instrument lands; the "before" runs from the lead's shell

The ceremony bar (LLP 3000.007 §10.3) is `loopbar/ceremony-brief.md` — eight
personas, three chats, forty posts, sixty messages, five shapes with exact
expected values, a fixed wire contract, the loop bar's attribution vocabulary
and one machine-readable schema-shape line — and `loopbar/ceremony.mjs` with
its helpers: serial runs on the exact npm pin, the fresh agent launched by
`~/.volta/bin/codex exec` at medium, independent reverification on fresh
copies (`check`, the agent's own acceptance, and the runner's wire probes,
which change likes, messages and membership before re-querying so a
hard-coded answer cannot pass), schema-shape measurement (work tables,
per-principal counter tables, world-readable counter lines, Quarry lines,
operations, by name heuristics and by the agent's own declaration), and one
JSON line per run to `metrics/ceremonybar.jsonl`; five tests in
`packages/snapback4/test/loopbar.test.mjs`. The lane's three attempts to run
the bar from inside its own Codex sandbox failed before model work ("failed
to initialize in-process app-server client: Operation not permitted"): a
nested Codex cannot start under the sandbox. Those attempts are not a
measurement and are not recorded; the "before" (N = 3, `snapback4@0.2.8`,
gpt-6-astra at medium) runs from the lead's shell and lands with its record.

## 2026-09-13 — Lane P: read-only SQL, mechanical fixes, online and Expo starters

Implemented LLP 3000.007 §§7, 8.8–8.10 in additive CLI modules. `sql`
opens the persisted generation read-only, takes one WAL snapshot of its
schema/catalog/rows, exposes application views and returns a bounded table
or JSON. Tagged scalar values are unwrapped without changing stored forms.
An authorizer experiment showed that a CTE can spoof a public view's accessor
name; private backing views whose names submitted SQL cannot contain close
that bypass. UPDATE, internal tables and raw r/i are refused with the two
new SQL codes. The chat witness read 200 of 205 messages at the default
limit, saw all 205 with an explicit limit, and counted 205 while a WAL writer
held its lock in 4.97 ms (one targeted observation, not a benchmark). The
running dev accepted another mutation afterward and SQL counted 206.

`check --fix` applies only the diagnostic's explicit `mechanical` flag,
recompiles between edits, preserves comments, and can fix ambiguity and then
a missing cursor tie-break in one invocation, including an index declared
in another file. Rust contract tests cover seven guessed spellings, quoted
keywords/delimiters, Unicode/CRLF, and refusal to edit unmarked diagnostics.
Lane L must use `.mechanical()` on exact spelling diagnostics (the shared
`unsupported` constructor already marks the seven bare construct names).
The combined elif/ambiguity integration test is explicitly skipped until
L's E_QUARRY_UNSUPPORTED elif diagnostic arrives; no parser/binder was edited.

The default template retains 1 synced table; the online template has 0 sync
lines and 0 notes. The Expo starter embeds 12 files plus `.gitignore`, copies
the reference configs/client/screens, removes the witness entry point, fixes
standalone import paths and selects native versus online from availability.
Pins: Expo 57.0.22, RN 0.86.3, React 19.2.3, expo-sqlite 57.0.3 and Babel
preset 57.0.11. Its generated API and TypeScript client compile; no iOS export
was run. The reference chat's inbox still emits its existing N_NO_CURSOR note.

Targeted results: guide 8/8; fixer 4/4; CLI periphery 6 passed, 0 failed,
1 explicitly skipped. Final blocking suite: 241 Rust tests passed, 1 ignored;
fixture wrapper 9 passed; client tests 85 passed, 1 failed, 1 skipped;
`== 1 failure(s) in 28 s`. Chromium aborts with SIGABRT before the React
hook test can run. The isolated React test also fails 0 passed/1 failed on
a clean source snapshot of base 0a8775aba95ae73f76b91c16c1b4dbaf7a98a723
using the same installed dependencies. This is not a green full-suite claim.
All new source files are below 1,500 lines. This journal was already 2,339
lines; its explicit append-only rule was preserved. No commit or publication.

## 2026-09-13 — Lane R: residency, inferred audiences and server-run observations

Implemented LLP 3000.007 §6.1–§6.8 and §8.11: bare `sync` infers the same resolved audience as its explicit form; an explicit clause is checked against the rule; `online only` documents a table or opts a maintain out of inheritance. Compilation records held/horizon/server sites and the runs/predicts words in the schema and /schema programs, and emits operation documentation in api.ts. check/why print the facts; check keeps a successful-generation sidecar while dev compares its served generation. The added redundant messages-byId guard stays eligible and produces N_NOT_PREDICTABLE describing the newly conditional prediction, resolving the acceptance example without mislabelling eligibility. Public maintains and group maintains with unbounded recipients or multiple values per group produce N_MAINTAIN_SYNCED. test --residency uses actual paged snapshots and builds fixture maintains from the loaded sources before measuring.

The local client uses compiled runs, keeps last server answers in memory across watch closure/recreation, refuses E_OFFLINE without one, and reruns server-run watches for /changes table notifications. The device refuses statically non-predicting mutations without changing the write path; a dynamic horizon refusal preserves the first undecidable table/index/site and evaluated key. No ceiling or value serialization changed. The chat schema uses inferred audiences; its parser expectation and existing string-based simulator edits were updated to preserve their original scenarios.

Measured on the embedded cold fixture: each of alice and bob acquires 2 note rows (106 compact JSON bytes) and 1 inherited value row (63 bytes), 3 rows / 169 bytes per persona, 6 rows / 338 bytes summed across both. These are row-payload bytes, excluding transport framing. The maintain has 1 value row; the source has 3 rows and its horizon acquires 2. The final wasm build reports 1,418,142 raw bytes and 398,449 gzip bytes; no size comparison is claimed. The embedded Astra shapes cover 7 operations, and the regression adds a server-only mutation separately.

Validation: 7 residency Rust tests, 8 guide tests, and the 5 process-device/CLI residency tests plus 7 session-security tests pass. The final blocking suite ran in 54 s: 244 Rust passes, 0 failures, 1 declared ignored; 9 fixture passes; 84 client passes and 1 failure. Its sole failure is Chromium SIGABRT at launch in react.test.mjs, before any browser assertion. It reproduces with that test alone and with unchanged sources exported from base 0dc0107e68dd504dbc1311754dd9783ab5477826 (0 passes, 1 launch failure). Build, wasm, package and both app typechecks pass. Logs are /tmp/lane-r-targeted-final.log, /tmp/lane-r-client-final.log, /tmp/lane-r-suite-final.log and /tmp/lane-r-base-react.log. No commit, push, tag or publication was made.

Integration boundary edits: declaration AST/parser and catalog metadata support the two new table/maintain forms; Runner/read/write carry the missing-fact diagnostic; serve adds only /schema words and served-generation notes; backend.ts declares the additive wire words; main.rs advertises the switches. No program lowering or IR forms changed. The journal was already 2,301 lines; this required append preserves its append-only history. Changed source files remain below 1,500 lines.

The final recovery review added a guard for an already-refused maintain declaration whose generated table is absent, with a regression alongside the positive maintain cases. The same 8 guide and 7 residency tests pass. A complete rerun after that correction reports 244 Rust passes / 0 failures / 1 ignored, 9 fixture passes, and 84 client passes / 1 Chromium launch failure, in 58 s (/tmp/lane-r-suite-last.log); the source and package checks remain green. This is the final verification record for the uncommitted lane.

## 2026-09-13 — Lane C: sent results, dev admission and device-owned media

Implemented LLP 3000.007 §8.1, §8.3–§8.6 and §8.13 under rulings 8, 9
and 14. `Write<R>.sent.result` reaches both clients, terminal queued-write
events, and React's `run()`/`last`; pending still has no predicted result.
The device keeps this uploader's server upload receipts, resolves image/video
arguments from them during prediction and replay, and queues without
prediction when a receipt is missing. Caller-supplied facts never replace a
receipt. The id-only video ticket is closed with both-store and live-process
regressions. `dev` loopback skips the two minute counters and prints one line;
the two Argon2 slots and HTTP caps remain, and `serve` keeps its counters.
`E_RULE` keeps its generic refusal and names the upsert/update/maintain idiom.

`webDevice()` persists and verifies wasm bytes by SHA-256 and retains the
compiled backend. Explicit `assets: { keep: "viewed" | "none", maxBytes }`
controls ordinary media retention (default none). Confirmed stream images
index media homes; the device checks the current row and its lifetime before
cache use. Apply/adopt and write transitions reconcile retained bytes, and a
timer handles offline expiry. IndexedDB holds web bytes, the Expo opener
supplies files in Documents without an Expo import in the client, and the
process opener uses device metadata. One-view responses never store bytes;
the server's response flag overrides even a stale device schema. A 501-row
regression caught the need to retire media beyond one page on a non-unique
audience index while preserving delivered text history.

Measured: the Chromium offline reload opens in 283.6 ms with 0 wasm fetches,
2 failed transport probes, and a rendered 1×1, 68-byte image; a viewed once
photo answers E_OFFLINE. Reopen holds 307 rows; the queued write lands. The
process cache retains 2 images under maxBytes 136 and 0 after keep:none; once
bytes and deleted-home bytes are 0. A 60-byte MP4 with duration 1,000 ms
predicts from an id after offline reopen, agrees with sent.result, and survives
a second offline reopen. Dev admits 200 guest sign-ins and 200 bounded-invalid
same-email login attempts with 0 E_RATE_LIMIT; serve refuses peer attempt 31
and email attempt 11. This admission probe took 578 ms on Linux.

Verification: 21 device and 8 guide tests pass locally; 57 targeted client
tests pass; Expo TypeScript checks and Swift syntax parsing pass. The final
blocking suite on expo-build-1000 passes in 43 s: 240 Rust, 9 fixture and
93 client tests, 0 failures, 1 declared ignored Rust test. Its log SHA-256 is
`60870ca5fe293fefcaa5d9f925b65d6815e46da5af89dba6b433360fb4aa8c49`. The final independent React run passes
10 tests. The local full suite takes 35 s with all 240 Rust, 9 fixture and
83 non-browser client tests passing; Chromium fails at process startup under
the local sandbox. No pre-existing product-failure claim is made. The Linux
snapshot and local changed product sources match SHA-256
`cb2fd7bfdf092a4f4b9f16f42e846f378e3783934c40141b1269b7475006f3ea`
(before this journal append), based on worktree commit
`0dc0107e68dd504dbc1311754dd9783ab5477826`. No commit or publication was made.

Scope seams: the host counters actually live in `crates/snapback4/src/auth.rs`;
`assets.ts` needs the successful-byte callback and `mock.ts` must follow the
new sent form. `contract.ts` changes only Write and the necessary Client.mutate
return type, leaving Op alone. The local read evaluator and watches, the
compiler and core interpreter, write authority (§8.7), ceilings and existing
corpus cases are untouched. Expo's file methods require rebuilding the native
app; an iOS binary was not built or exercised in this lane.

## 2026-09-13 — lane L: relaxed Quarry through job preludes and patching upsert

Implemented LLP 3000.007 lane items 1–9, in order: local reassignment,
heap-bound list accumulation lowered to Push, continue, else if (elif refuses
with its exact rewrite), text + and count/lower/trim/join, Euclidean / and %,
fn bodies with proc deleted, read-only job preludes, and insert-or-patch upsert.
The language card exercises each form and its engine test asserts the new
values. The programs, jobs, writes, types and bounds cards and README §2 agree.
No existing corpus case or serialized value form changed. Job preludes use
ordinary setup statements before each sweep, replayed under each chunk's
transaction and meter. The new text results and merged upsert rows charge heap;
lane M's allocation/clone charging changes still need integration before this
lane satisfies the RFC's §5.0 prerequisite.

Measured: the targeted frontend suite has 26 passes and the compiled guide 8,
zero failures. The final full blocking suite finished in 36 s: 249 Rust passes,
zero Rust failures, one declared ignore; 9 fixture passes; 79 client passes and
one failure before Chromium could launch the React page. The same isolated
launch failure (SIGABRT, kill EPERM) was reproduced using an archive of base
0dc0107e68dd504dbc1311754dd9783ab5477826. The isolated React suite on the Linux
expo-build-1000 host passed all 10 tests, zero failures or skips, using Node
24.13.1; local checks used the pinned Node 24.18.0. Raw final logs are
/private/tmp/lane-l-final-targeted.log, /private/tmp/lane-l-qualified-suite.log,
/private/tmp/lane-l-base-react.log and /private/tmp/lane-l-linux-react.log.
The wasm build reported 1,381,929 B raw and 390,462 B gzip. No size comparison
or performance improvement is claimed.

The accumulator type's heap-bound marker is u32::MAX (4,294,967,295), not a
raised meter ceiling. The prelude fixture ran 6 chunks over 2 sweeps, wrote
6 rows, and produced [8, 12, 12] after a configuration change following the
first chunk. A prelude that exhausted heap parked with 0 committed chunks
and 0 rows written. The largest changed Rust source is 1,315 lines.

What the implementation taught: reassignment needs a loop-carried type join,
including paths that continue, while a fresh assignment has the new value's
own type. Recursively nesting an accumulator has no finite inferred type.
Heap-bound strings and lists can be written, with actual lengths checked by
the row validator, without claiming smaller bounds inside inline helpers.
A helper's early return must leave that helper's nested loops and preserve
the caller; a chunk's setup must run before even evaluating its scan prefix.
Quoted '-' also exposed a lexer-kind distinction the expression parser had
missed; it now remains a text literal.

Stopped before item 10 (column defaults). Items 10–20 remain, including seeks,
where and disclosure-sensitive cursors, grouping and page/list unification,
expression ranges, pending through shapes, the remaining guessed-spelling
rewrites, the rest of the card rewrite and the Clique acceptance programs.
Section 5.9 and E_STRUCTURAL_FANOUT were not changed. Work remains uncommitted
for the lead to integrate; no publication was attempted.

## 2026-09-13 — the ceremony bar's "before" on 0.2.8: three green, the same loop three times

Run from the lead's shell (`node loopbar/ceremony.mjs --n 3 --version
0.2.8`): 510, 407 and 456 s wall, agent 494, 384 and 441 s, every run
reverified on fresh copies with all five wire probes green; loops 3 / 5 /
3, of which Snapback-attributed 0 / 1 / 0 (a `docs` loop on `token`'s
stdout mixing prose with the token — a ticket). Schema shape: ten tables
each; maintains 8 / 1 / 1; a `digestPeriods` guard table in every run,
declared a work table by two agents; no world-readable counters (the
brief's digest runs as the system, so the counter shape that opened
tables in the Clique lanes does not arise). The finding: every run's first
`check` produced `N_NEVER_COMPLETE` on the membership scan and every agent
answered by duplicating the membership table keyed the other way — a
membership row read by the viewer's own principal is its own witness for
`exists memberships[.chat, viewer]`, and the compiler does not see that
yet. Record: `benchmarks/runs/2026-09-13-snapback4-ceremonybar-before/`;
metrics: `metrics/ceremonybar.jsonl` (three lines).

## 2026-09-13 — Lane X: durable worker actions

Implemented LLP 3000.007 §9.2, ruling 11, phase C2. Quarry declares
`action name(args)` with typed arguments and an optional viewer rule; the
application supplies the TypeScript body. The generated API exposes
`Action<A, unknown>`. Admission records `_requests` transactionally once
per client id, keeps results private to the original principal and action,
and returns a settled result or a pending id after at most 25 seconds.
Replays survive store reopen and ignore replacement arguments. Action
results are bounded JSON outside Quarry's value model; no serialized value
form, meter ceiling or existing corpus case changed.

Service workers claim requests with a fresh non-renewable session for the
REQUEST's principal. The session ends at the shorter of its configured
lifetime and lease, defaults to 60 seconds, and is revoked on settlement.
A delegated session cannot become a worker credential, even when its
principal is a service seat. Settlement requires the claim's session token
in `x-snapback-action-lease`: this additional wire header fences a stale
attempt when the next worker uses the same service token. Expired leases
requeue; errors back off from 2 seconds to 5 minutes, at most 8 attempts;
`GiveUp` fails immediately. A lost settlement response leaves the lease
recoverable; invalid JSON results fail without repeatedly running the handler.

Both clients expose `act` without prediction, mutation receipts or device
outbox entries. A known offline client returns `denied: E_OFFLINE`; an
uncertain transport response preserves a pending id for an explicit retry.
React's `useAction` keeps `last` on the newest invocation and respects its
client/component lifetime. **`Act<R>` is a new card word needing the author's
ruling under LLP 2000.000 §8**, as the lane brief requires. Its done/failed/
pending union also has `{ denied, id }` for refusal before admission. The
implementation and the actions card expose that choice for review; no
ruling on the new word is implied by this entry.

`dev` supervises `snapback/worker.ts` or `.mjs` with Node 24 and one printed
`service:worker` token, restarts crashes with backoff and stops its own child
on exit. `doctor` reports the worker file and queue counts. Chat's action
`invite(email: text <=200)` mints a session for `member:<email>` and returns
only the principal. Its old membership mutation is now `addMember`, with
all callers updated. The Expo starter copies the worker together with the
schema. Data-only chat fixtures and witnesses exclude the worker file;
copying it into temporary projects without its dependencies had introduced
an unwanted worker and a server-shutdown race in those tests.

Measurements: the final isolated Mac worker suite passed 8 tests in
15,787.616125 ms. Its action round trips, including a viewer write and read,
were 10.44 ms online and 11.07 ms through the process device; a one-second
pending wait took 1,004.26 ms. In the final Linux suite those measurements
were 20.33 ms, 14.22 ms and 1,003.64 ms. These are individual observations,
not percentiles or improvement claims. The core proves 60,000 ms default
and 120,000 ms configured viewer lifetimes, terminal expiry on attempt 8,
and exactly 2 attempts after a lost settlement. Offline action POSTs and
queued device entries are both 0. The dev probe observes 1 crash/restart,
1 printed service token, and doctor counts 0 queued / 0 running / 2 done /
1 failed. Local wasm: 1,441,096 B raw / 405,953 B gzip; Linux wasm:
1,440,852 B raw / 406,361 B gzip, both optimized with wasm-opt 132.

Verification: targeted Rust tests pass (4 action engine/simulator, 1 both-
store device, 1 frontend action test, 8 compiled-guide tests); 4 local
end-to-end and 7 periphery tests pass. The final complete blocking suite on
Minisforum, with Node 24.18.0, passes in 36 seconds: 277 Rust passes,
0 Rust failures, 1 declared ignored Rust test; 9 fixture passes; 117 client
passes including the browser tests; 0 failures overall. Its log is
`/tmp/sb4-lane-x-suite-linux-final.log`, SHA-256
`28d04b6a92556b2adc7ba015e4da65d4a4bff6b92deb79e30e8a2fd9b14fcb59`.
The local and Linux changed-source digest before this append is
`1a4cfcc4d5eede8308e38882704046035c74f19cc4522e347d51da52efe5e22d`,
based on `cf2d13eea1858f5e89093d70562841f7296cab0c`.

A completed local suite before the final starter-copy seam passed all 277
Rust and 9 fixture tests, with 106 client passes and 1 Chromium startup
failure in 26 seconds. The isolated browser failure (SIGABRT / kill EPERM)
was reproduced with untouched sources from that exact base commit; the
isolated Linux React suite passed all 11 tests. Later Mac reruns hit
executable startup stalls, even for `--version`; the periphery tests passed
alone afterward. No pre-existing attribution is made for those stalls.
The remote setup needed its shared `benchmarks/fixtures/social-messenger`
input and removal of macOS `._` transfer metadata; neither required a
product change. The final successful run includes the complete fixture tree.

Scope seams: parser/binder implementations live in new `actions.rs` modules;
the AST, parser registration/recovery keyword, IR kind and emitter need
small registrations. `bind/residency.rs` has one exhaustive-match arm for
server-only, never-predicted execution. The language card's program is
untouched; declarations compile in the new actions card. Local engine and
device dispatchers refuse execution through query/mutation/prediction.
The starter, existing renamed chat callers, data-only fixture copies and
the libc dependency for child termination are the other integration seams.
The largest changed source is guide.rs at 1,439 lines. This required
append preserves the already-long journal's history. SQL application reads
remain unimplemented as ruled; NOT-DOING records the trade. No commit,
push, tag or publication was made; the lead owns integration.

## 2026-09-13 — lane L2: the language, re-derived, part two

Implemented LLP 3000.007 items 10–20 after cf2d13eea: literal/now/viewer
column defaults, typed range seeks on the first unpinned index column,
row-local where predicates (including lazy metered reads), disclosure-safe
continuations, group/first/last/at, page/list/collection unification,
expression ranges under the step meter, pending through row shapes, the
remaining mechanical guessed-spelling refusals, and the compiled language
card plus the reads/writes/shapes/types/bounds cards and README §2. N_SEEK
names the canonical key spelling. check --cost reports prefix seeks, filter
examined bounds, predicate probes and expression-range steps. Every new
allocating builtin charges its result; defaults filled by the engine charge
the new row. No meter ceiling or serialized Value form changed.

The disclosure fixtures return all 4 matches after 23 filter rejections at
an examined ceiling of 7, with cursor positions [6, 13, 20, 24, 26] and 3
capped pages. A non-uniform fixture decodes every cursor, rejects every
hidden key, reaches visible key 16, and ends in an empty capped page inside
the hidden run. A full filtered page returns keys 0 and 3 after examining
4 rows; its cursor carries 3. A separate positive case verifies that N
matches also complete a uniform filtered page without a cursor. Predicate
reads in the language regression cost 5 probes for 2 returned matches.

Five Clique acceptance tests run the seven-day Insights loop, all 3 receipt
states with sender/late-joiner continue, a two-counter digest (Alice: 5
messages in 2 chats; Bob: 1 in 1), an 80-character Unicode push preview,
around's 20 before/21 after rows, first-seen reaction groups of 2 and 1,
and the corrected whole-day trending query. Trending ranks all 250 fixture
posts and selects the oldest, most-liked post first; the 8,193-post day
returns 10 rows with complete:false and an examined-meter cut. Both device
stores preserve defaults at the pinned write time 1,234 and pending through
raw, spread, named, repeated, projected and extended shapes, offline reopen,
and server confirmation. Lazy ranges remove the old 100-element temporary:
the existing count-text meter fixture now charges 8,000 B rather than
11,200 B, while retaining its step charges. A range ending at
9,007,199,254,740,991 stops at the test's 30-step ceiling without materializing
its domain; the positive literal range completes 10,001 iterations.

Verification used Node 24.18.0 locally and Cargo/Bun from snapback4. The
compiled guide passed 8/8 after each item 10–19 and again in the final suite.
Final targeted results: frontend regressions 32/32, guide 8/8, Clique 23/23,
filters 4/4, device 24/24, core meter 7/7, chat typing 4/4 and periphery 9/9.
The final unchanged bash snapback4/scripts/test.sh run reports
`== 1 failure(s) in 26 s`: 289 Rust passes, 0 failures, 1 declared ignore;
9 fixture passes; 101 client passes, 1 failure, 0 skips. Wasm is 1,476,787 B
raw and 412,887 B gzip. The remaining failure is Chromium SIGABRT during
process launch, before the React assertions. The isolated test reproduces
on an untouched git archive of base
cf2d13eea1858f5e89093d70562841f7296cab0c using the same installed dependencies.
The Linux expo-build-1000 snapshot passes all 10 React tests, with 0 failures
or skips, using Node 24.13.1. This is not a green local full-suite claim.

An earlier loaded run took 219 s and hit process-start timeouts in 40 client
cases in addition to the browser failure. Serial client-file verification
recovered all those cases (101 passed, 1 browser failure); the final normal
suite then reproduced only that browser failure. No timeout was changed.
The initial full runs also caught the corpus harness's new IR cases and two
assertions affected by the intended behavior (lazy-range heap and pending in
the inferred inbox shape); those are fixed. Raw commands and verbatim counts
are in /private/tmp/l2-verification.md, the final full log is
/private/tmp/l2-suite-last.log, and browser baseline/Linux logs are
/private/tmp/l2-react-base.log and /private/tmp/l2-react-remote.log.

What this taught: a predicate's setup must execute inside each row's scope
and preserve lazy reads; seek keys/bounds must preserve source evaluation
order; positions may pass author-filtered rows but never rule-hidden keys.
The parser must not discard a seek in a point write or rule read. Device
metadata belongs to a projected row, including through named spreads, not
to its enclosing ordinary object. Defaults need both the engine boundary
and the insert expression's returned image to agree.

Scope seams are minimal: bind/schema.rs installs defaults and initializes
the new AST field; bind/residency.rs walks new expressions and bounds;
engine/admission.rs, engine/native.rs and the corpus test harness handle the
new IR fields/variants. E_STRUCTURAL_FANOUT policy is unchanged. No existing
corpus case changed. The largest changed Rust file is 1,445 lines; this
journal was already 2,678 lines and its explicit append-only rule is kept.
Items 10–20 are complete; §5.9 and §8.7 were not implemented. Nothing was
committed, pushed, tagged or published, and the existing LANE-BRIEF.md is
untouched.

## 2026-09-13 — 0.2.9 published: the pin after the language landing; the Expo module at 0.2.2

The pin LLP 3000.007 §10.3 and §16 ask for. On main at `d4f29b705` and
in the package: the meter (lane M, `c3b2d0f1b`), the ceremony bar (lane B,
`b8acd113f`), `sql`, `check --fix` and `init --online`/`--expo` (lane P,
`10324ebf5`), residency and the inferred sync audience (lane R,
`047862694`), the client seams and the media cache (lane C, `7b2b8fc65`),
the language in two parts (lane L, `cf2d13eea`; lane L2, `4fd2d2eb0`) and
worker actions (lane X, `8e52cab71`). Not in it: §8.7 and §5.9 (lane W),
which return to both reviewer families before they land (ruling 15).

The publisher ran the whole suite first — 0 failures in 113 s — then
built the production binary: 7,579,344 bytes, sha256 `6550376e…`, and
proved the installed consumer (query complete and fresh, an online write
`sent`, an offline write `pending`). The client tarball is 487,036 bytes
over 33 files; the platform tarball 3,700,981 bytes. `snapback4@0.2.9`
and `snapback4-darwin-arm64@0.2.9` are on npm; `metrics/publish.jsonl`
has the record.

The Expo module moved to 0.2.2 because the device crate changed under it
(the media cache, the actions): `scripts/build-xcframework.sh` rebuilt
the two slices, 13 MB together, and `snapback4-expo@0.2.2` went out at
4.8 MB packed, 13.4 MB unpacked, 13 files. The lock file moved with the
crate version.

Landing L2 over X found the one semantic conflict a textual rebase cannot:
L2 gave every bound program its own `notes`, and X's action binder built a
program without them — a one-line initializer, caught by the compiler,
not by the merge. The append-vs-append test files were rebuilt as main's
text plus the lane's tail.

The ceremony bar's "after" started on the published pin at 06:27 UTC,
three serial runs on the unchanged instrument (its packet hashes match
the "before"), from the lead's shell as before. Its record follows in
`benchmarks/runs/`. The Clique rerun of §10.3 waits for W: the pin it
runs on must carry §8.7, the hidden-collision friction the rerun exists
to measure, and a three-model serial run costs eleven hours in the
anchor. A fresh packet is prepared with pending pins.

Two loose ends are written down rather than left in the lead's head:
ruling 16 (the `Act<R>` card word) is open in the RFC's §14 with a
recommendation, and the self-witnessing membership rule of §16 is being
built as lane S — the "before" agents' original rule was own-row OR
co-member, and inside a chat-pinned prefix the first disjunct is implied
by the second, so the roster page was complete all along and the note
was wrong.

## 2026-09-13 — Lane S: a membership row witnesses its own equality

Built LLP 3000.007 §16's commissioned absorption in core `engine/rules.rs`:
within an `or`, `.principal = viewer` (either operand order) is implied by
a same-table `exists` on a total unique plain index whose principal term
is `viewer` and whose other terms are their own columns' fields. Literal
terms, nullable/non-unique/words keys, different tables and an `and`
disjunct do not qualify. `prefix_visibility` and the binder's
N_NEVER_COMPLETE text/rewrite now share the deciding fields; `decided_true`
and runtime rule evaluation are unchanged. The reads/search cards and
README explain why the chat-pinned roster needs no second membership table.

The new simulator membership fixture preserves the brief's table verbatim.
Its deciding fields fall from 2 (`chatKey`, `principal`) to 1 (`chatKey`).
All 3 alpha members see all 3 rows with `complete: true`; a member of a
different chat and a principal with no memberships see 0 rows, also complete,
with no cursor and the empty-range examined count. Bob's roster makes exactly
1 rule probe for all 3 rows, whereas the viewer-pinned directory makes 0.
Receipt aggregation stays complete through sent, delivered, read and leave.
Literal-admin and foreign-table probes keep Bob's roster at 1 visible row
and `complete: false`. Both device stores produce the same data, preserve
privacy, and keep these online-only reads incomplete even when candidate
rows are deliberately installed: a uniform rule is not a residency fact.

Measured existing bound schemas: the app's 5 read rules, 106 read rules in
the 15 loopbar fixtures named by metrics/loopbar.jsonl (sets A–E), and 40
read rules in the 3 retained ceremony-before fixtures. Deciding-field sets
shrank for 0 of these 151 read rules, and for 0 of all 604 read/write rules
(including implicit deny rules and maintained tables). No existing test's
completeness assertion changed; the complete Rust suite passed without
editing any existing expectation or corpus case.

Targeted checks: simulator membership 4/4; device membership selection 4/4
(the new scenario runs on SQLite and memory); frontend self-witness 1/1;
guide 8/8. `bash snapback4/scripts/test.sh`: 301 Rust passed, 0 failed,
1 ignored; fixtures 9/9; client 108 passed, 1 failed; all builds and
typechecks passed. The run took 507 s, including cold builds and a long
pre-harness launch stall on the simulator device binary, which subsequently
passed all 3 tests. The lone failure is Chromium SIGABRT before the React
assertions: reproduced alone and on an untouched archive of base
`d4f29b70528a3235c8ac82247fe84d8a8f9eb0a4` with Node 24.18.0. The current
React source snapshot passed all 11 tests (0 skips) on expo-build-1000,
Node 24.13.1. This is not a green local full-suite claim. Verbatim logs and
commands are retained in `/private/tmp/lane-s-verification.md`.

Learned: the sampled row can change whether equality short-circuits the
probe, but cannot change the prefix's verdict; the negative cases must keep
testing the completeness class even when a particular viewer sees all rows.
The ceremony instrument, other lanes' engine files, meter, value forms and
client TypeScript are untouched. No commit, push, tag or publication. Every
changed source file stays below 1,500 lines; this journal was already 2,869
lines and its explicit append-only instruction is preserved.

## 2026-09-14 — the ceremony bar's "after" on 0.2.9: eleven loops became six, and the tenth table became a public roster

Three serial runs on the published 0.2.9, launched by the publish chain
the moment npm served the pin, from the lead's shell (`node
loopbar/ceremony.mjs --n 3 --version 0.2.9`); the record is
`benchmarks/runs/2026-09-13-snapback4-ceremonybar-after/`, the metrics
lines 4–6 of `metrics/ceremonybar.jsonl`. All three green and reverified,
5/5 probes each: 494, 403 and 535 s wall; loops 3, 2 and 1, none
Snapback-attributed; nine tables each; maintains 0, 1 and 6; the
`digestPeriods` guard in every run; no world-readable counter line.

Against the "before" on 0.2.8 (510, 407, 456 s; loops 3, 5, 3 with one
Snapback-attributed; ten tables each): the loops the bar exists to count
fell from eleven to six and the Snapback-attributed one to none; the wall
is the same within the noise of a heavier host (run 1 started at load
31.8 under the xcframework build). The tenth table — the private
restatement of membership every "before" agent wrote — is gone from every
run. In its place every "after" agent made the roster public to silence
`N_NEVER_COMPLETE` on the chat-pinned roster scan ("explicit public
roster policy so both principal and chat scans are uniform"), two of them
after paying the loop, one without logging it. On this seed harmless; on
a product, a disclosure where the before had a duplicate. The note was
wrong both times: the row is its own witness on the unique key. Lane S
landed the absorption at `30cf4ce80`, after this pin, and the bar runs a
third time on the pin that carries S and W; the roster's read rule in
each `schema.q` is the sentence to read.

`snapback4 token` cost a loop for the fourth time in six runs (the prose
and the token on one stdout); lane T is fixing the P3 ticket. The packet
hashes: the brief, the probes and the process helper identical to the
before; the runner and the metrics helper differ by two `@ref` comment
lines (`c82b22824`).

## 2026-09-14 — Lane T: captured CLI values own stdout

Closed [the token-output P3](../issues/closed/20260913-snapback4-token-prints-prose-with-the-token.md).
`token` has one stdout form: the bearer token and one newline, including
when the shared `--json` flag is present; principal, expiry and custody
prose are on stderr. It mints service tokens for the project or a release;
viewer sessions still come from `/auth/session`. The README and services
card now pave `TOKEN=$(npx snapback4 token --service worker)`.

The adjacent audit separated `dev`/`serve`'s listening URL from startup,
schema-reload, native/job/schedule and lease logs, including stdout from
the supervised Node worker. `types` prints only the generated path;
`data` keeps JSON lines on stdout and its truncation hint on stderr; SQL
keeps its table on stdout and its inspection header/row-count footer on
stderr. SQL `--json` remains one JSON result. `check --json --cost` now
sends cost prose to stderr so its JSON remains parseable. `init`, deploy,
rollback, help/guide/why/test and other human reports are unchanged;
`run`'s successful JSON, `check --json`, `doctor --json` and `device`'s
JSON protocol were already separate. No chat-app or fixture token parser
needed an update; the ceremony instrument is untouched.

Measured a local `token --service worker` before and after on base
`30cf4ce809d68eb8f99c770a7cf6b98d3193708a`: **44 B → 44 B** on stdout,
**113 B → 113 B** on stderr. The default was already clean on this base;
with `--json`, stdout is **128 B → 44 B**, stderr **0 B → 113 B**.
All eight regression calls (default, days, equals flags and `--json`, on
each of the project/release stores) produced a 43-character base64url
token plus newline, minted a session over `/auth/session`, and queried
as `member:captured` using that session. Worker output and a live schema
adoption also preserved the single URL on stdout. SQL/data tests cover
both truncation and the full 205-row result; types resolves to a readable
file. Targeted periphery: **12 passed, 0 failed**; compiled guide:
**8 passed, 0 failed**.

The final blocking suite took **46 s** (the first run, before the final
`check --json --cost` correction, took **106 s**): **301 Rust passed,
0 failed, 1 ignored; 9 fixture tests passed; 111 client tests passed,
1 failed**. All builds/typechecks passed. The sole failure is Chromium
SIGABRT before the React assertions, reproduced alone and from an
untouched archive of the base above (60 tracked files verified
byte-identical), using Node **24.18.0**. This is not a green local-suite
claim; the lead's outside-sandbox rerun remains necessary. Full commands
and verbatim summaries are in `/private/tmp/lane-t-verification.md`.

Learned: the capture contract needs to cover optional flags, truncation,
and inherited child descriptors; separating the ordinary token print
alone did not establish it. No engine, language form, meter, serialized
value, existing corpus case or client TypeScript changed. Modified source
files stay under 1,500 lines (maximum **1,461**, the guide); this journal
was already **2,969** lines and its append-only instruction is preserved.
No commit, push, tag or publication.


## 2026-09-14 — lane U: sync bodies and bounded link-loss detection

Moved the shared client's sync request to `POST /sync` with JSON
`{ from, limit, after, stream, pending }`, removed the GET route, and
updated the scale witness and HTTP/cursor fixtures. The native opener
already delegates HTTP to the shared client; the labelled mock has no
wire request to migrate. The body ceiling is **262,144 B** with one
oversize outcome, **HTTP 413 / E_INPUT**, including chunked requests and
CORS. That allows **256 × 128-byte IDs** even at **6 encoded bytes per
byte**, plus a cursor; malformed fields use **400 / E_INPUT**. No request-line
or meter ceiling was raised, no serialized value form or engine changed.

At watermark **1091**, the old request lines for **232 / 233 / 256**
ordinary 26-byte IDs were **8,171 / 8,206 / 9,011 B**; at 128 bytes they
were **31,835 / 31,972 / 35,123 B**. Every POST line is **19 B**; its
bodies are **6,794 / 6,823 / 7,490 B** for ordinary IDs and
**30,458 / 30,589 / 33,602 B** for maximum-length IDs. The real host
regression checks both lengths, the old parser boundary, **262,144 B**
admitted and **262,145 B** refused, declared/chunked bodies and malformed
fields. On each device store it correlates and terminally acknowledges
**232, 233, and 273** writes (the last has a **256-ID** window and a
**17-ID** tail), with **37** snapshot rows over **6** pages and **5**
cursors, no dropped/duplicate IDs, one terminal notification per write,
and an empty outbox. Across the two stores: **1,476** receipts and
**1,476** terminal writes.

Held change responses now send JSON-whitespace heartbeats every **2 s**;
both client tiers race response progress against **4 s** of silence.
Native fetch without response streaming uses polls of at most **2 s**
with the same watchdog. Browser offline/online hints are registered and
removed with the client; authenticated `/probe` remains the recovery
condition. README, `Link`, and the guide document detection within **5 s**
while polling on a running host, with notifications deferred during host
suspension. The real TCP proxy drops bytes without closing the held poll;
final-suite detection times after cuts at **500 / 5,000 / 15,000 ms**:
wasm **3,503.941 / 3,007.609 / 3,023.060 ms**, native
**3,502.317 / 3,006.491 / 3,028.957 ms**. The test retains request start,
cut, rejection and notification times and checks recovery. Healthy idle
polls, a buffered native response, a fetch that ignores abort, browser
hints, cleanup, and revocation after the first heartbeat are covered.

Learned: tiny_http's absolute **5 s** write phase cannot include an idle
**25 s** response. The minimal vendor addition (**22 lines**) writes and
flushes complete frames with the existing deadline, retaining the request
until its terminator so a later request cannot start the next header
phase too early. It aborts incomplete streams. Two Rust HTTP tests prove
healthy pipelining across idle frames and refusal of a stalled frame;
auth is rechecked before final JSON, including after heartbeats started.
The early regression run caught that phase mismatch; fixture repairs used
unique native outbox sequences, avoided closing a wasm core twice, and
explicitly enabled identity for the revocation test.

Verification on base **0d7b77bb3c577366ac81bf159e57524c613c9e12**:
targeted host **17 passed**, framing **2 passed**, compiled guide
**8 passed**, lifecycle/auth/HTTP **62 passed**. The final blocking suite
ran in **71 s**: **303 Rust passed, 0 failed, 1 ignored; 9 fixture tests
passed; 117 client tests passed, 1 failed**. Every new transport test
passed. All builds and typechecks passed. The only final failure is
Chromium **SIGABRT** before the React assertions; it reproduces alone and
from an untouched archive of the base (**33** relevant tracked files
verified byte-identical, installed dependencies shared). The IndexedDB
witness fails at the same launch boundary, so its offline scenario needs
the lead's outside-sandbox run. This is not a green browser-suite claim.
The first full run took **114 s** and also caught the now-fixed identity
fixture. Exact commands, verbatim summaries and timing records are in
`/private/tmp/lane-u-verification.md`.

Both transport tickets moved to `issues/closed/` with resolutions and
measured numbers. Changed source files remain at most **1,472 lines**;
this append-only journal was already **3,054 lines** and was not split or
rewritten. No commit, push, tag or publication; the existing untracked
`LANE-BRIEF.md` is untouched.

## 2026-09-14 — Lane V: unique probes, qualified schedules and snapshot-field null guards

Implemented the three remaining cold-start loops of LLP 3000.007 §10,
under §5.5's one-spelling rule. Named equalities that cover a total unique
key use that index and check the other columns on the returned row, in
program point reads/exists and ordinary effect-rule exists/created probes.
The schema carries optional residual equalities; existing value forms and
corpus cases are unchanged. A rule's focal residual terms participate in
`deciding_fields`; self-witness absorption and `rule_true` also check the
residuals, and a filtered probe cannot silently widen a sync audience.
Final-insert obligations retain their exact-index contract: their write
path belongs to W2 and is untouched.

The ceremony run-2 insert rule is verbatim in the regression, without
`byKeyAdmin`. With 100 chats seeded, it uses **1 rule probe without that
index and 1 with it**; the program get/exists each examines **1 row** for a
hit, mismatch and miss. `check --cost` prints `rule probe chats.byKey — one
point read, then 1 extra equality check(s) when this branch runs`. The full
recorded schema, minus that index, checks with **10 bound tables, 14
operations, 0 problems and 0 notes**. Non-unique prefixes and nullable
unique keys do not acquire the relaxation. The original roster remains
uniform; an unpinned residual focal field remains non-uniform, a pinned
one gives one probe for the whole page, and an admin test cannot disappear
behind a self-probe. Both device stores exercise the read and rule paths.

The 0.2.6 M8 logs reveal a two-step module failure: the bare
`backfillTimeline` did not resolve, and `timeline.backfillTimeline` then
failed to parse. Schedules now accept the operation's qualified name;
the bare-name diagnostic names that exact target, and `check --fix`
replaces only the target, retaining the period, offset and comment. The
null loop was a binder gap, not a bad program: `readiness = null or
readiness.changedAt = null or readiness.changedAt < periodStart` now
compiles. Null guards refine fields of lexical snapshots across short
circuits, conditional arms and surviving branches, with reassignment and
loop backedges clearing stale facts. The language/reads/rules/types/jobs
cards, compiled module-card regression, README and stale AGENTS hint now
agree. No new diagnostic code was needed.

Targeted suites: frontend **37/0**, compiled guide **9/0**, Clique **29/0**,
membership **5/0**, device **27/0** (each scenario on SQLite and memory),
CLI fix/cost **6/0** (passed/failed). The final blocking suite on Node
**24.18.0** took **73 s**: Rust **311 passed, 0 failed, 1 ignored**;
fixtures **9 passed, 0 failed**; client **111 passed, 1 failed**. Builds
and all typechecks passed. The one failure is Chromium SIGABRT before the
React assertions, reproduced alone and against **57 tracked files**
verified byte-identical to base `0d7b77bb3c577366ac81bf159e57524c613c9e12`.
This is not a green local full-suite claim; the lead's outside-sandbox
rerun remains necessary. The first full run took **144 s** with the same
sole failure; two initial regression-test mistakes (inline-if syntax and
the device dispatcher's nested refusal envelope) were corrected, not
classified as inherited failures. One initial `cargo check` was mistakenly
launched at repository root and failed before compilation on the missing
Ibex submodule; it was immediately rerun inside `snapback4/`, with no root
files changed. Commands, verbatim summaries, before/after diagnostic text
and measurement logs are in `/private/tmp/lane-v-verification.md`.

Learned: the unique key decides which row, not whether its remaining
fields match; both static hoisting and runtime probes must retain that
distinction. Narrowing likewise belongs to a particular local snapshot,
not to an arbitrary repeated read expression. Changed source files stay
under **1,500 lines** (largest **1,476**, the guide); this append-only
journal was already **3,054** lines. No ceiling, engine write-path file,
existing corpus case or ceremony instrument changed. No commit, push,
tag or publication.

## 2026-09-14 — Lane A: dev loopback Argon2 capacity follows the host

Applied LLP 3000.007 §14 ruling 9: admission snapshots the host's available
parallelism once, clamps it to 2–16, and uses that capacity only for `dev`
loopback password work. The shared bounded semaphore still refuses excess
work with retryable `E_RATE_LIMIT`; `serve` and non-loopback requests keep
two slots. This host reports 18 available cores and dev prints
`Argon2 slots: 16 on this host` on stderr. Minute counters, Argon2
parameters, the engine meter, serialized values and client code are unchanged.
The README and personas card explain both capacities; ruling 9 gains one
dated application sentence without changing its existing text.

The new HTTP regression parks eight simultaneous sign-ins before their
Argon2 work, proves a query completes while they are parked, then verifies
all eight sessions succeed without a refusal. On hosts with fewer than
eight available cores it tests the smaller physical capacity. The existing
third-request refusal test now runs as `serve` with a real guest session
instead of a dev persona, covering both signup and login and the retryable
flag. The semaphore regression fills each admission class, refuses the
next permit, and proves released permits can be reused.

Measured eight existing accounts over loopback HTTP on unoptimized Cargo
dev binaries, before at `0d7b77bb3c577366ac81bf159e57524c613c9e12` and after
this change. Account creation is outside the clock; eight request threads
start together. Three trials per mode, measured sequentially after the
baseline suite finished (milliseconds):

| Mode | Before trials | After trials | Before → after median |
| --- | --- | --- | --- |
| One attempt per login | 256.980, 248.675, 253.208 | 261.905, 290.482, 314.969 | 253.208 → 290.482 |
| All eight complete, retry refusals every 25 ms | 1137.052, 1033.687, 1032.919 | 339.553, 355.558, 358.707 | 1033.687 → 355.558 |

The first row is **2 successes / 6 rate refusals before, 8 / 0 after** in
every trial, so its elapsed times are not equal amounts of completed work.
The second row completes eight in every trial: 115, 108, 106 refusals
before and zero after, a 2.907× median completion speedup with this retry
policy. An earlier baseline measured alongside the busy base suite took
1677.680 ms median to complete eight, illustrating shared-host variance.
These are local debug-build observations, not packaged throughput claims.
The measurement program and raw results are in `/tmp/snapback-lane-A-auth/`.

Targeted tests: auth **3 passed**, HTTP **18 passed**, compiled guide
**8 passed**, client seams **4 passed**, all with zero failures. The full
suite's first changed-tree run caught the client-seams assertion expecting
the old startup sentence; its one-line expectation now checks a printed
2–16 slot count. That test file is the only addition to the brief's named
file scope. The final full suite took **30 s**: **303 Rust passed,
0 failed, 1 ignored; 9 fixture tests passed; 111 client tests passed,
1 failed**. All builds and typechecks passed. The sole remaining failure
is Chromium SIGABRT before the React assertions, reproduced alone on this
tree and on the untouched base above. The base suite also encountered an
HTTP startup timeout and a worker timeout (the latter repeated alone);
both passed in the final full suite. A green outside-sandbox Chromium run
remains the lead's, not a green-suite claim from this lane.

Learned: lifting minute counters did not remove the two-slot correction
loop; concurrent admission needed its own regression, independent of the
implementation's selected capacity. Startup text is also an exercised
surface, with an assertion outside the server crate. Modified source files
remain below 1,500 lines (maximum 1,464); this journal was already 3,054
lines, and its prior entries are preserved verbatim. No commit, push, tag
or publication.
