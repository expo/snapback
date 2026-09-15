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

## 2026-09-14 — Lane D: the silent dev exit was a lost SQLite shared-memory lock

Closed [the schema/backfill exit ticket](../issues/closed/20260913-snapback4-dev-exits-without-diagnostic-during-schema-change.md).
The original macOS crash report identifies PID 62517, parent 62515, as
SIGBUS in a writable 32 KiB mapped file, with `FS pagein error: 22 Invalid
argument`. The two recorded PIDs were a launcher and its binary, not evidence
of two independent binary crashes. The permission helper opened and closed
SQLite's SHM file after SQLite had locked it; POSIX discarded the process's
locks, allowing the CLI backfill's SQLite opener to truncate a mapping the
server still used. Existing files now get chmod by path; new databases still
start at 0600. The only store change is its permission-setup call. No engine
write path, value form, ceiling, client implementation or language form changed.

Seven fresh SQLite reproduction attempts used the retained Clique scale
log's 49,200 post/set-repost feed entries, changing the public counter to a
repost-only source at 24,600 entries, with replay, reads and CLI backfill
concurrent. Two unchanged-base and two published 0.2.6 attempts crashed with
SIGBUS; three fixed attempts completed, with zero request failures and 1,000
backfilled rows each, in 9.237, 10.765 and 9.143 s. The first 0.2.6 attempt
looked for the adoption line on stderr when that pin printed it on stdout;
the retained line and the corrected repeat confirm generation 2. These are
focused host reproductions, not a replay of all 167,157 app/auth/media actions.
Commands and raw logs remain under `/private/tmp/lane-d/`.

Eleven Rust regressions cover cross-process database/SHM lock retention with
0600 permissions, memory and SQLite adoption waiting behind replay, the real
watcher and CLI backfill, a backfill parking after 200 committed chunks then
completing after correction, invalid source keeping the old generation,
startup refusals, off-thread unwind and abort panics, a real truncated-mapping
SIGBUS while holding a mutex, signals for both verbs, and app-worker cleanup.
The watcher also takes its initial stamp before compilation so an edit just
after the listening URL is not missed. `dev`/`serve` now print generation,
reason and a stable code on stderr for exits, panics, signals and background
thread stops; fatal signal reporting does not lock the engine or allocate.
The README and refusals card explain these codes and the limits for SIGKILL,
power loss or unwritable stderr. Without a worker, signals retain immediate
OS termination; with a worker, INT/TERM/HUP allow the existing child cleanup.

Targeted checks: lifecycle 11 passed; compiled guide 8 passed; local-client
and periphery 16 passed. Final blocking suite: 45 s; 312 Rust passed, 0 failed,
1 ignored; 9 fixture tests passed; 111 client tests passed, 1 failed. Chromium
SIGABRT before React assertions reproduces alone and on 60 tracked files
verified byte-identical to base `0d7b77bb3c577366ac81bf159e57524c613c9e12`,
Node 24.18.0. Earlier full runs took 122 and 38 s and exposed an introduced
100 ms shutdown delay in workerless servers; a reused-port test reached the
exiting server. Restoring immediate termination fixed that regression; no
client test was edited. The lead's outside-sandbox Chromium rerun remains.
`ref-check` is green. Modified source stays under 1,500 lines; this journal
was already 3,054 lines and remains append-only. No commit, push, tag or publish.

Learned: a Rust mutex cannot replace the OS locks SQLite uses across processes.
Permission tightening must preserve descriptor ownership, and a native signal
needs its own diagnostic path; a panic hook alone would not have explained this
crash. The original report could be attributed from the OS receipt before any
engine change was necessary.

## 2026-09-13 — Lane W: private write authority and uniform server page passes

Implemented LLP 3000.007 §8 item 7 and §5.9 as revised by §15, against
base `2bc7b01a204ddece01a7f03512ab20067fcb7fd9`. The implementation is
uncommitted for the lead and the required second blind review. No publication
or compatibility transition was attempted. Below, simulator test names refer
to `crates/snapback4-sim/tests/write_authority.rs` unless another path is given.

- (a) `crates/snapback4-lang/src/bind/program.rs` lowers id/unique update and
  upsert to `Stmt::WriteTarget`; `crates/snapback4-core/src/engine/write_target.rs`
  resolves the complete unique key privately and checks the update rule over
  engine old/next images. `s05_upsert_on_a_hidden_row_succeeds_when_the_update_rule_admits_and_returns_no_row`
  proves hidden success; `w1_not_found_and_e_rule_are_one_word_on_an_unreadable_row`
  exercises both id and unique addressing. The key-once/helper regression
  proves one key evaluation and isolated condition bindings.
- (b) `engine/write_target.rs` and `engine/write.rs` define readability at the
  pre-write read authority. `w1_not_found_and_e_rule_are_one_word_on_an_unreadable_row`,
  `w1_e_conflict_current_is_withheld_and_the_code_does_not_tell_hidden_from_absent`,
  `w1_an_immutable_mismatch_on_a_hidden_row_is_not_a_searchable_constraint`, and
  `w1_incomplete_patch_upsert_does_not_tell_hidden_deny_from_absent` compare
  complete replies, durable retries, state, effects, snapshots and streams.
  The incomplete case includes a supplied foreign asset: completeness is
  established before asset diagnostics. Readable controls retain detailed
  errors. The historical test name
  `s05_upsert_on_a_hidden_row_is_e_rule_when_the_update_rule_refuses` is kept,
  but its assertion is `NOT_FOUND`, as the revised contract requires.
- (c) `engine/write_target.rs` re-reads valued update/upsert results; conditions
  run after update authorization in an isolated engine scope whose locals are
  restored, with writes refused even inside nested expression setup. Condition
  helper loops still undergo structural admission. `engine/write.rs` preserves
  unchanged asset facts and checks update authority before assets.
  `w1_the_merged_image_is_not_in_result_current_or_the_program`,
  `wa3_hidden_patch_preserves_foreign_asset_without_disclosing_id`, and
  `a_unique_upsert_evaluates_its_key_once_and_conditions_keep_helper_bindings_private`
  prove these paths. `w1_the_writers_stream_and_snapshot_do_not_gain_the_row`
  proves that hidden success does not extend the writer's partition.
- (d) `crates/snapback4-core/src/engine/receipt.rs`, `engine/mod.rs`, and only
  the `/m` arms of `crates/snapback4/src/serve.rs` share one reply serializer:
  `_ops` records the exact original body, without meters/tables/events.
  Every replay omits result/current, including scalars, and keeps execution
  identity. `w1_replayed_ops_returns_the_withheld_body`,
  `wa5_hidden_write_replay_returns_only_sanitized_receipt`, and
  `wa5_revoked_result_and_conflict_current_are_not_retrievable` cover hidden
  content, revoked authority, dropped originals and principal-scoped ids.
  `packages/snapback4/test/write-authority.test.mjs` exercises the actual HTTP
  replies too. The replay ticket was resolved and moved into `issues/closed/`.
- (e) `engine/write_target.rs`, `engine/write.rs`, and
  `crates/snapback4-device/src/device.rs` queue every unheld update/upsert
  target with the existing site/key-specific `unknown_fact` word. Admission
  clears stale predictions. `crates/snapback4-device/tests/write_authority.rs`'s
  `w1_a_device_queues_without_a_row_and_does_not_predict_not_found_or_insert`
  compares both stores: 4 operations × 2 horizon policies × 2 hidden/absent
  worlds × 2 stores = 32 scenarios, each with reopen and no pending row.
  A held target still predicts, one positive per store. The separate server
  page-pass test queues even a held target across reopen on both stores.
  The package HTTP/client test proves an offline queued upsert still sends
  `/m` and settles through an empty writer stream.
- (f) `engine/write.rs` retains S05 insert and if-absent refusals and collapses
  an update's secondary hidden clash without transferring target authority.
  `s05_insert_and_insert_if_absent_on_a_hidden_unique_clash_stay_e_rule`,
  `s05_a_readable_clash_still_names_the_index`,
  `wa2_secondary_hidden_collision_does_not_borrow_target_authority`, and
  `wa2_retained_composite_key_never_enters_refusal` cover this split.
  `tests/security.rs` now has an admitted/denied hidden `put` pair,
  `hidden_put_uses_update_authority_and_old_owner_can_deny_it`.
- (g) `crates/snapback4-lang/src/bind/residency.rs` emits `N_MAINTAIN_DELTA`,
  registered in `guide::CODES`, for potentially wider source update authority
  beneath a readable maintain. It uses sufficient implication proofs and
  says "may disclose" when implication cannot be proved, not a satisfiability
  claim. `a_readable_maintain_notes_the_declared_hidden_delta_channel` holds
  the initial readable sum at 30 in both worlds, then observes 23 versus 11
  after removing hidden contributions 7 versus 19. A denied update has no note.
- (h) The engine delete implementation and binder delete lowering are
  unchanged. The retained delete/rule/cascade coverage in the existing
  security, reviews, review_corrections and workspace suites remains green.

For §5.9, `engine/admission.rs` retains uniformity and rejects merge/unknown
origins, while removing complete-group/cap requirements for `predicts: never`.
`bind/mod.rs` computes the operation class before admission; the AST and one
parser dispatch recognize `: server`. The language card both compiles and runs
that marker. `m3_a_non_predicting_pass_over_a_hidden_prefix_does_not_abort_when_a_query_would_not`
refuses non-uniform passes at admission, including loops in private helpers.
Uniform hidden prefixes with 0, 100 and 10,000 hidden rows each return 0 and
write 0 rows; the readable-prefix test returns and writes 3 with either 0 or
10,000 hidden rows, agreeing with the query. Inferred never prediction is
also covered. `p2_a_predicting_mutation_still_refuses_e_structural_fanout`
retains the predicting requirement and a positive capped control.
`p2_rows_written_still_aborts_at_1024` commits 1,024 writes, then refuses the
1,025th attempted write with 0 committed changes. `p2_the_pass_is_atomic`
rolls back rows, maintains, effects and partition events together; its positive
control commits 2 rows and 2 effects. The existing
`h1_a_non_uniform_scan_is_capped_whatever_the_meter_found` remains green.
`crates/snapback4/src/verbs.rs` prints the tested line:
`a pass over the first 10 rows of counters[owner] by byOwner; examined ceiling 8192`.

The README §2 and rules/writes/programs cards state the authority table, S05
split, upsert idiom, private old image, replay policy and uniform page pass.
The feeds card and its Clique fixture now guard both old and next vote owner;
otherwise their readable maintain legitimately attracts the new note. Existing
pending-metadata fixtures now seed a held vote before testing prediction.
The only change in `crates/snapback4-core/tests/corpus.rs` teaches its exhaustive
walker the added statement; no existing `corpus/` case, read loop, value
serialization or ceiling was changed. No L2 read binding or X action route
was edited. Largest changed Rust file: `guide.rs`, 1,490 lines; this journal
was already over the source limit and has only this required append.

Verification: targeted simulator suites passed 93 tests (17 Clique, 32 review
corrections, 11 reviews, 10 security, 23 write authority); language/frontend
passed 34 (8 guide, 26 frontend); device/native/write-authority passed 29
(22/5/2); the targeted package and lifecycle run passed 49. Final full suite
on isolated Linux passed 297 Rust tests (1 declared ignore), 9 fixture tests,
and 112 client tests, including browser/wasm coverage: `== 0 failure(s) in 55 s`.
Its input archive SHA-256 was
`c46d79094f7e6be062340571380a535c44e2873e25523654e3e467b0fee6edb3`;
it contains the final code, tests, README and guide plus the unchanged
social-messenger fixture dependency. This append and ticket disposition are
subsequent documentation only. Linux used Node 24.13.1, Bun 1.3.14; local JS
used the requested Node 24.18.0 prefix. The final Linux wasm measured
1,465,805 B raw / 414,296 B gzip; local final build measured
1,466,057 B raw / 414,387 B gzip. No size improvement is claimed.

The completed local full suite before the last asset/helper hardening passed
297 Rust and 9 fixture tests and 102 client tests, with Chromium aborting
before the React test could start: `== 1 failure(s) in 93 s`. The same isolated
Chromium SIGABRT/EPERM launch failure was verified against an archived exact
base `2bc7b01a204ddece01a7f03512ab20067fcb7fd9`. The additional local final
rerun stalled launching new native executables (even `snapback4 --help`
timed out after 8 s); it and the additional language rerun were interrupted,
exit 130. No assertion failure or base-precedence claim is made for that
startup stall. The final Linux full suite covers the final semantic changes.
Logs: `/private/tmp/lane-w-sim-final2.log`, `lane-w-lang-final.log`,
`lane-w-device-final.log`, `lane-w-client1.log`, `lane-w-suite-final.log`,
`lane-w-suite-final2.log`, `lane-w-base-react.log`, and
`lane-w-suite-remote-final.log` in the same directory.

Learned: old-image authority must be a write operation in the engine, not a
read-filtered temporary in lowering. Completeness checks can themselves reveal
which upsert branch ran unless they precede asset lookup and share the refusal
word. A durable execution receipt must not confer permanent historical read
authority. This implements the declared channels, not constant time or general
noninterference: cap/postcondition outcomes, near-ceiling budget aborts, timing,
and the explicitly noted maintain delta retain the RFC's stated limitations.


## 2026-09-14 — Lane W2: second blind-pass dispositions on write authority and mutation pages

Built LLP 3000.007 §17 on lane W HEAD
`604dd6c3c5c9fa8269eb123993bd3cf14db3ef2b`, leaving the work uncommitted for
the lead and the third blind pass. Read both reviews in full; §14's ruling
text is byte-for-byte unchanged. No commit, push, tag, publication, meter
ceiling, serialized value form, existing corpus case or ceremony instrument
changed. Delete's authority remains unchanged; the shared runtime write guard
also prevents a delete inside a condition, as §17 requires.

The repair map follows the brief's order:

1. `engine/write.rs::check_constraints` preserves generic S05 `E_RULE` for
   a secondary hidden collision on a readable target; unreadable targets get
   `NOT_FOUND`. The paired regression covers update and upsert-patch, both
   target visibilities, and a successful control.
2. `insert_upsert` decides insert authority before asset or constraint
   diagnostics. `write_target.rs::target_attempt` marks before target
   resolution and restores every meter field on `NOT_FOUND`, also for legacy
   IR update/upsert. The complete-patch test covers an unknown upload and a
   recorded foreign upload, both hidden/absent worlds, an admitted foreign
   asset refusal, and a successful owned-asset insertion. Another pair
   exercises a read rule's probe work.
3. Cap refusals name columns and size, never group values, on readable and
   unreadable targets. The hidden cap pair varies only the retained group key;
   the readable controls check the same value-free diagnostic.
4. Every expression, statement, loop domain and builtin in condition purity
   has an explicit disposition. Blocks, both shape positions, scan filters,
   merge setup, expression-range bounds, id minting and the side-effecting
   divmod builtin are exercised via serialized IR, alongside a successful
   pure-block condition. Eighteen scenarios (9 forms × 2 visibilities) write
   no copies of `old`; a runtime flag independently forbids writes while a
   condition holds the old image.
5. `engine/receipt.rs::receipt` stores the replay-shaped body: no result or
   current, a value-free diagnostic message, and the original code, site,
   rewrite, guide and other refusal identity. Re-encoding `from_receipt` is
   identical to the stored body. Readable composite-key collision followed by
   revocation is tested through `Engine::replay`, mutation retry and real `/m`,
   including a lost first response. The closed replay ticket records this
   additional coverage.
6. Never-predicting mutation reads are plain prefix scans only. Word scans,
   merges and expiring tables are refused even without a loop. Tests compare
   0/40 hidden matching words and 0/9,000 expired rows at check. A plain
   uniformly false page following 100 iterations of metered work is admitted
   with identical observations at 0/10,000 hidden rows.
7. `refuse_hidden_immutable_patch` isolates ruling 17 (a): presence refuses
   without comparing, including matching guesses; readable mismatch keeps
   named E_CONSTRAINT.
8. `require_readable_condition` isolates ruling 17 (b): a hidden author
   condition is not evaluated. The README and cards say: a condition needs a
   row you can read; a blind patch needs none.
9. `require_uniform_mutation_pages` isolates ruling 17 (c), with the existing
   E_STRUCTURAL_FANOUT and the exact rewrite "read it in a query, or pin the
   deciding columns". Census: 4 checked-in `.q` files / 26 operations, the
   loopbar fixture (3 queries), 21 guide blocks and 8 README blocks; **0**
   programs newly refused by (c). The separate expiry narrowing refused **2**
   documentation examples, language `pagePass` and README `recentPass`; both
   now scan members. No app or fixture program needed a rewrite.
10. `snapback4-sim/tests/common/write_observation.rs` is shared with the
    device crate: first and retry /m serializer bytes, durable receipt,
    every meter, complete before/after source and maintain rows, committed
    changes, effects, writer stream page/snapshot, and both stores' initial,
    pending, reopened and settled observations. Paired equality compares
    committed changes rather than equating intentionally different retained
    hidden images; each refusal also asserts full rollback. Real HTTP is
    separately exercised in the package suite. The device regression remains
    in the device crate and now covers 64 scenarios (4 ops × 2 horizons ×
    2 worlds × 2 authority classes × 2 stores), plus held-target controls.
    Both renamed tests say what they prove; the retained composite-key case
    gains a non-colliding world and explicitly preserves the ruled outcome
    residual.
11. Rules/writes/programs cards, README and RFC §5.9/§8/§15/§17 record the
    narrowed surface. The rules card moved to `guide/rules.md` to keep source
    under the cap. Largest changed source: `guide.rs`, **1,471** lines;
    `write.rs` is **612**. The pre-existing 3,145-line append-only journal and
    1,517-line RFC are documentation exceptions to an all-files reading of
    1,500; this required entry and the RFC's dated record extend them, without
    rewriting history or splitting the author's rulings.

Measured acceptance: the final isolated Linux blocking suite passed **335 Rust
tests** (1 declared ignore), **9 fixture tests**, and **123 client tests**, with
`== 0 failure(s) in 84 s`. Node 24.18.0 and Bun 1.3.12; wasm-opt was on PATH.
The input archive SHA-256 was
`555f65c38b64a7a3d635f62d3b710ee09f16c949d3b64323301bf5cd020f8d5e`;
all **661** regular input files were hash-checked remotely, **0** mismatches,
and no temporary census test remained. Subsequent edits are this journal and
RFC records only. Wasm measured **1,507,842 B raw / 423,385 B gzip** on Linux,
**1,508,078 B raw / 423,233 B gzip** locally. No size improvement is claimed.
The seven compared meters are examined, index_entries, rule_probes, steps,
heap_bytes, output_bytes and rows_written. The unchanged write ceiling still
commits **1,024** source writes and aborts attempted write **1,025**, with
no committed delta; rollback coverage also includes maintains and effects.

Targeted commands run from `snapback4/` (Node commands always used
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`):

- `cargo test -p snapback4-core --test corpus`: `test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.27s`.
- `cargo test -p snapback4-sim --test write_authority --test condition_authority --test page_admission --no-fail-fast`: condition **1/0**, pages **3/0**, write authority **27/0**; the final local summaries are in `/private/tmp/lane-w2-sim-final2.log`.
- `cargo test -p snapback4-device --test write_authority`: `test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.93s`.
- `cargo test -p snapback4-lang --test guide`: `test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s`.
- `node --test snapback4/packages/snapback4/test/write-authority.test.mjs` (repo root): **4 passed / 0 failed** (`lane-w2-http-alone.log`).
- `node --test --test-name-pattern='online watches retain' snapback4/packages/snapback4/test/client-lifecycle.test.mjs`: **1/0**; the same command with pattern `wasm:`: **12/0** (`lane-w2-flake-online.log`, `lane-w2-flake-wasm.log`).
- `bash snapback4/scripts/test.sh` (repo root), both local and on the isolated Linux input above; Linux output in `/private/tmp/lane-w2-suite-linux.log`.
- `./ref-check --verbose` (repo root) and `git diff --check`.

The first local full run reported `== 2 failure(s) in 400 s`: the introduced
sibling diagnostic code broke 3 corpus expectations, fixed by retaining
E_STRUCTURAL_FANOUT (no corpus edits), and concurrent client launches timed out.
The isolated HTTP/lifecycle retries above pass. Chromium's launch SIGABRT/EPERM
was reproduced against the exact archived base
`604dd6c3c5c9fa8269eb123993bd3cf14db3ef2b` with
`node --test /private/tmp/lane-w2-base-604dd6c/snapback4/packages/snapback4/test/react.test.mjs`
(**0 passed / 1 failed**, `/private/tmp/lane-w2-base-react.log`). No other
failure is labeled pre-existing. The Linux suite includes Chromium and passes.

Learned: normalization must cover the complete absent branch and the meter,
not only the final error word. Purity checks need an exhaustive allowlist and
an independent runtime guard. Historical diagnostic text has the same custody
problem as a cached row. A mutation binding a page has the same population
abort risk as looping over it. This is the ruled disclosure contract, not a
claim of constant-time execution or elimination of the explicitly retained
constraint-outcome and maintained-delta channels.

Final local verification: `bash snapback4/scripts/test.sh` reported
`== 1 failure(s) in 304 s`: **335 Rust passed / 0 failed / 1 ignored**,
**9 fixture tests passed**, and the concurrent client run **57 passed / 48
failed** from startup deadlines and Chromium. The follow-up command, from
`snapback4/`, `node --test --test-concurrency=1 'packages/snapback4/test/*.test.mjs'`
reported `ℹ tests 113`, `ℹ pass 112`, `ℹ fail 1`; its only failure was the
base-reproduced Chromium SIGABRT. All startup-deadline failures passed on this
serial run. The Linux full suite above is completely green, browser included.
Logs: `/private/tmp/lane-w2-suite-final.log` and
`/private/tmp/lane-w2-client-serial.log`. Final reference check:
`ref-check: ok — 474 LLP docs, 8796 refs in 22437 files, 0 errors, 0 unchecked`.
`git diff --check` is clean; the journal's entire base is an unchanged prefix,
§14 is unchanged, and the existing corpus, meter ceilings and ceremony
instrument have no diff. The pre-existing untracked `LANE-BRIEF.md` is untouched.

## 2026-09-14 — lane W3: third-pass write authority and uniform-page repairs

Built LLP 3000.007 §17's third-pass dispositions in this worktree, starting at
`b80ad0cb60582c08ed1fb5cc6cad60b4947b90c9`. The nine dated built lines under
that table map its rows to this repair; §14 is byte-for-byte unchanged from
this lane's supplied RFC. The governing constraints are LLP 3000 §6–§7 and
LLP 3000.007 §5.9, §8 item 7, and §17. No ceiling, serialized value form,
existing corpus case, delete implementation, or ceremony instrument changed.

1. Uniform pages decide their read rule from pinned prefix values before
   fetching a candidate. A false verdict returns an empty complete page
   with **0 examined / 0 rule probes**, including after **8,192 examined**
   or **8,192 probes**. Complete observations match across **0 / 1 / 10,000**
   hidden rows. A rule probe costs **1** logical unit regardless of expired
   siblings; existence of a live maintain needs a live source witness, not
   its sum. The expiry regression compares **0 / 9,000** expired probe
   targets on false and true verdicts: **0 / 0** and **1 / 1** examined/probes
   respectively. This is logical accounting, not a physical-time claim.
2. Before an ID or unique-key target lookup, resolution checks available
   room for twice the read rule's probe sites, the update rule's, and (for
   upsert) twice the insert rule's; short-circuit branches cannot exceed
   that static count. Heap room covers two schema-maximum copied row images
   plus twice the supplied patch's measured heap. Merges charge the memory
   they actually copy; retained map/asset Arcs are shared, and overwritten
   hidden columns are never copied just to discard them. A non-fitting
   reservation refuses E_BOUND before lookup in both worlds. The exhaustion
   fixture reserves **3 probes**, a **17,561 B** maximum copied row, and
   **35,374 B** for an amount patch or **35,384 B** for its immutable patch.
   Its heap prelude uses **16,004,012 B**; the refused amount target reaches
   **16,004,156 B** with a test ceiling of **16,005,036 B** (lower than the
   unchanged **16,777,216 B** default). Its other prelude uses the full
   **8,192** probes. **16 paired scenarios / 32 worlds** cover ID update,
   unique update and upsert, with immutable and conditional updates; the
   existing ample-budget and readable-admitted controls remain.
3. Physical and live maintained-sum overflow share a value-free E_OVERFLOW:
   the maintain name and `value` column, never the computed total. Retained
   contributions **1 / 2** overflow identically in both paths; a total of
   **9,007,199,254,740,991** still succeeds. The live fixture seeds its
   cancelling expired contribution first so setup stays within range.
4. An explicit asset ID on an unreadable target proves upload ownership
   before any equality-preservation shortcut. Both **G / H** hidden worlds
   refuse the same foreign G; omitted-column controls retain the old
   placement, and a writer-owned upload succeeds.
5. The scan traversal records structural Expr::Merge, independent of
   merge_site. A serialized non-looping merge without that marker refuses;
   the corresponding plain bound page succeeds. Plain, non-expiring,
   non-merge pages are required in **every** mutation, predicting or not,
   looped or bound. The predicting matching-page pair refuses equally for
   **0 / 8,193** hidden words.
6. The shared helper retains the serializer's exact first-body bytes; it
   does not claim an actual HTTP transport/status capture. It compares all
   **7** meter fields (examined, index_entries, rule_probes, steps,
   heap_bytes, output_bytes, rows_written), receipt, retry, committed source
   and maintain deltas, effects, stream, snapshot and **2** device stores,
   including admission, pending, reopen and settlement. An intervention
   now revokes before retry and both stores' settlement. Readable clash
   asserts `byKey` with a no-clash control; failed receipts, revocations,
   matching conditions and serialized-condition runtime cases use the
   helper. Structural/compiler refusals are explicitly the no-receipt
   exception. Pure readable conditions retain a successful control.
7. from_receipt re-sanitizes historical why.message; a W-shaped historical
   response with current and row-derived diagnostic text cannot recover
   either after revocation. No published W receipts exist, so no migration
   was added.
8. The binder refuses upsert conditions with **1** population-independent
   diagnostic and the rewrite “a condition belongs on update; an upsert
   inserts or patches”. The parser consumes the form so it reaches that
   single refusal rather than two parser-recovery errors. Serialized IR
   receives the same pre-lookup runtime prohibition. The named
   ignore_hidden_immutable_patch drops immutable fields without comparison
   on hidden update/upsert hits; readable mismatches still name the column.
   Matching/mismatching update worlds agree. Profile upsert inserts its
   supplied immutable fields on a miss and preserves them on a hidden hit;
   both send. Its explicit owner change grants read authority, so the test
   preserves and checks the legitimately returned, streamed and settled
   row differences instead of redacting them in the helper. Admitted-work
   meters and physical insert/update deltas remain the ruled residuals.
9. README, rules/writes/programs cards and CODES describe these forms and
   refusals. Census correction to W2: **5** tracked Quarry files contain
   **38** operations, including the native fixture's **12**. No application,
   fixture or loopbar caller needed a rewrite for these changes. The largest
   changed source is guide.rs, **1,479 lines**. The already oversized RFC
   and this required append-only journal remain documentation, not source.

Learned: restoring a meter after a refusal is too late if deciding that
refusal can exhaust it. The reservation must precede lookup, and a uniform
page needs no first row to establish its verdict. Omitted versus explicit
patch fields carry different authority. Ignoring hidden immutables keeps the
ordinary upsert insert branch usable; refusing only the hit reopens existence.
The recorded residuals (caps, after-insert, admitted-write budget outcomes,
retained-unique match and physical timing) remain; no constant-time claim.

The broad suite also required a minimal update to the existing membership
regression (`snapback4-sim/tests/membership.rs`): a readable roster now uses
**1 probe** for the first member too, because its verdict precedes every
candidate. Its old **0-probe** expectation depended on sampling that member's
own row first. Only that assertion and its comment changed; the membership
fixture, application, self-witness analysis and ceremony instrument did not.

Verification: the final focused simulator run passes **40 / 0** (condition
**1**, page admission **7**, write authority **32**); guide **8 / 0**, device
write authority **2 / 0**, and the adjusted membership suite **4 / 0**. The
complete blocking script passes on the fleet Linux host in **71 s**:
**344 Rust passes / 0 failures / 1 ignored**, **9 fixture passes / 0 failures**,
and **126 client passes / 0 failures**, including Chromium. This exceeds the
script's 60-second budget by **11 s**; no test or timing threshold was changed.
The isolated copy's **661** tracked input files had **0** hash mismatches,
manifest SHA256
`0ae4b7b6c9b63924588bd154e824fa8808339629ea7cce1991e242d3f43e0fcd`;
only this verification paragraph was appended afterward. Linux wasm measured
**1,517,613 B raw / 425,787 B gzip** (Binaryen 132); the local macOS build
measured **1,517,859 B raw / 426,105 B gzip**.

The first local complete run reported **2 failing steps in 827 s**: Rust
included the now-fixed membership expectation and a live-overflow regression
whose seed order itself overflowed; concurrent client launches hit startup
deadlines under local load. A serial client rerun passed **115 / 116**, with
only Chromium's sandbox SIGABRT left. That exact browser failure was reproduced
on base **b80ad0cb60582c08ed1fb5cc6cad60b4947b90c9** (**0 / 1** browser tests).
The first isolated Linux run passed all **126** client tests but still had
the old membership assertion and lacked the shared social-messenger fixture
inputs; the final complete rerun above includes both corrections. These
setup/test corrections are not labelled inherited product failures. No commit,
push, tag, or publication was performed.


### 2026-09-14 — lane W4: normalize the page attempt, reserve created equalities, refuse expired maintained-value probes

Built the fourth-pass dispositions of LLP 3000.007 §17. An aborting page
pass charges **1 examined unit** before its prefix verdict and charges the
verdict's probes for both outcomes. This is scoped to the aborting pass of
§5.9: applying the extra charge to capped queries changed the immutable
corpus's wide-merge pages and filter continuation boundaries. Capped queries
keep their existing contract; no corpus case or meter ceiling changed.
`Created` with residual equalities now contributes **1 probe** to the static
worst case before target lookup. A rule equality on the `value` of a maintain
over an expiring source produces **1 E_QUARRY_LIVE_MAINTAIN_PROBE** at check,
with the rewrite “read the maintain in the program; its live value cannot be
probed at one unit”. Existence and non-expiring equality probes stay supported.
The guide's code explanations were split into `guide/codes.rs` to keep the
edited guide below **1,500 lines**; the public `guide::CODES` API is unchanged.

Measured paired observations through the shared helper: the negated self
probe has `(examined, rule_probes)` **(1, 1)** with ample budget,
**(8193, 8192)** after the ordinary **8192**-probe/examined prelude (both
E_BOUND), and **(5, 5)** with a deliberately lowered **4**-probe ceiling
that isolates probe exhaustion (both E_BOUND). All **7 meter fields** and
the complete observation agree in each pair. Literal reference IDs for
that exact rule are supplied through schema IR, because Quarry's rule
comparison requires a typed reference. Created-equality upserts compare
absent and hidden denied targets on **2 entry points**, at **0** and
**8192** prior probes: NOT_FOUND with room, E_BOUND at the ceiling; an
allowed insertion succeeds and uses **2 probes** for its two authority
checks. The existing **16** target-exhaustion pairs remain covered.

Live-maintain existence probes compare **0** with **9000** expired sources
for both verdicts: `(rule_probes, examined)` is **(1, 1)** for false and
**(1, 2)** for true. Non-expiring maintained-value equality controls over
**1** and **9001** sources admit the page and update at **1 probe** each.
Historical raw receipts and scalar results now have paired revocation
lifecycles, including replay, queued admission, reopen and settlement on
**2 device stores**. Ignored immutable patches match the patch without that
field on ordinary and expiring sources: amount **7 → 0**, aggregate
**10 → 3**, immutable value retained, identical committed rows, maintain
deltas, reply/receipt, effects, stream, snapshot and both devices. Different
caller-authored expressions may cost different evaluation work; that test
compares the requested state and delivery boundary without pretending the
programs are identical. The exhaustion fixture's debug print is removed.

The lesson from these repairs is that deciding before a population-dependent
charge still needs a common attempt cost, and an equality on a created or
maintained fact must account for how that fact is actually obtained. The
maintain refusal keeps a one-unit existence contract without testing a stale
physical total. No commit, push, tag or publication was performed.

Final verification: focused simulator **50 passed / 0 failed** (condition
**1**, membership **5**, page admission **10**, write authority **34**),
guide **9 / 0**, corpus harness **16 / 0** with **211 cases passed /
82 skipped / 0 failed**. The final local blocking script reports **1 failing
step in 142 s**: **374 Rust passes / 0 failures / 1 ignored**, **9 fixture
passes / 0 failures**, **121 client passes / 1 failure**. All builds and
typechecks pass. The only failure is Chromium startup SIGABRT inside the
sandbox, reproduced by the isolated React test on untouched base
**e3187c87ff0f4b6db2ae03bc19beea433f8a8d86** (**0 passed / 1 failed**);
the lead reruns that witness outside. Local wasm is **1,523,579 B raw /
427,369 B gzip**. Runtime is **82 s** above the script's 60-second budget;
no threshold was changed. `ref-check --verbose`: **474 LLP docs, 8812 refs,
22590 files, 0 errors, 0 unchecked**. All **8 changed Rust source/test files**
are below 1,500 lines; the largest is **1449**.

The first local blocking run was **2 failing steps / 162 s** while the
query-wide attempt charge and two fixture mistakes were still present; the
final run above fixes those introduced failures. A supplemental Linux run
on a **669-file, 0-mismatch** snapshot was interrupted after
client cleanup stalled and is not counted as passing evidence. No claim
that those supplemental failures predate this lane is made.

## 2026-09-14 — the 0.2.9 calibration scored; the catch-up program opens (LLP 3000.007 §18)

The Astra calibration on 0.2.9 scored 85 overall and behind the September 5 Convex and Supabase cells on setup_and_docs (78), data_modeling (88) and queries_and_live (74). The scorer's notes charge four things the published surface did: `processDevice()` named without a signature, retained history lost under a horizon on removal, an unscoped authorized search that is never complete on the server, and a defaulted column that refused adoption while `check` stayed green; the rest is learning cost. LLP 3000.007 §18 records the five decisions and their lanes: a merge of matching lanes over the viewer's groups (CU1), retained history kept whatever the horizon (CU2), the Node device's directory argument and a README example check (CU3), literal defaults materialized wherever absent and `check` reading the dev store (CU4), four more mechanical rewrites with the Trending recipe (CU5). The 0.2.10 three-model cell keeps running unchanged; the pin after these landings is 0.2.11.

## 2026-09-14 — CU3: the Node device takes its directory; README calls compile

Built LLP 3000.007 §18.4 in the client package: one
`processDevice({ dir, binary?, spawn?, writeFile? })` opener, synchronous directory
validation, one resolver shared with the CLI shim, lazy Node host defaults, and
creation of the stores' directory when writing the initial backend. Migrated all
**9 positional calls**. The injected host can import and open without Node builtins;
the default host writes and spawns using Node; the real Rust device's existing
replication, prediction, queued writes and cold-offline reopen test now supplies only
`dir`. Resolver tests cover **4 choices**: environment, platform package, release
build and debug build, plus the no-binary refusal. No Rust, contract or guide-card
change was needed.

The README now has **11 standalone TypeScript/TSX blocks**, checked in one TypeScript
program against the package source and the workspace's React/Expo types, with a typed
stub only for the app's generated API. The check discovers all **36 callable exports**
from the **8 public function subpaths** and resolves each example call to its exported
symbol. Before this lane **22 exports** lacked a named call in any TypeScript fence:
`auth.guest`, `auth.signup`, `auth.login`, `auth.refreshSession`, `auth.logoutAll`,
`auth.memorySessionStore`, `auth.localStorageSessionStore`, `auth.sessionKey`,
`auth.restoreSession`, `auth.keepSession`, `auth.forgetSession`, `auth.logout`,
`client.mintId`, `mock.page`, `mock.mockId`, `mock.createMockClient`,
`native.processDevice`, `react.SnapbackProvider`, `react.useAction`,
`web.indexedDbPersistence`, `web.memoryPersistence`, `worker.listEffects`.
Two more calls (`createClient`, `useAsset`) lacked an in-scope import. The original
**7 blocks** also exposed undefined example values and untyped card fields. The new
check takes **877.03 ms** alone, **1061.47 ms** in the focused group and **1308.50 ms**
in the sequential client run (all below **10 s**). The package README is **1494 lines**;
the longest changed source/test file is **1262 lines**. Keep the README's six-line
headroom in mind when integrating the other lanes' documentation.

On base **518891fd1cc67b969a6f57b683e80efadc89b612**, a bare call returned an opener
and its first open threw `TypeError: Cannot read properties of undefined (reading 'replace')`.
It now throws synchronously: `Error: processDevice needs { dir }: the directory its stores live in`.
The lesson: prose naming an opener and imports naming a helper did not prove a builder
could call either. Compiling isolated examples and checking their actual bindings
found the missing directory, the missing imports and the untyped examples together.
The Node paragraph and the generated `api.<module>` explanation are in the client section.

Verification: focused native/periphery/README **18 passed / 0 failed**; opener-only
**4 / 0**; package typecheck and build green. The blocking script completed with
**1 failing step in 666 s**: Rust **374 passed / 0 failed / 1 ignored**, fixtures
**9 / 0**, concurrent clients **98 / 21**. The rebuild took **78 s**, chat check
**195 s**, Rust tests **388 s**, Expo typecheck **139 s**; executable startup also
made an earlier run stall and time out otherwise unchanged server tests. The sequential
client rerun is **126 / 1** in **122941.09225 ms**: every timing failure clears;
Chromium startup SIGABRT remains. The unchanged React test from the exact base above,
with all its loaded repository sources verified unchanged, reproduces it **0 / 1**.
No product failure is labelled pre-existing beyond this verified browser-start failure.
`ref-check --verbose` is green; no ceiling, test timeout or gate changed. The wasm
build reports **1523587 B raw / 427302 B gzip**. The automatic Cargo.lock version
refresh was reverted. The resolved ticket moved into `issues/closed/` by filesystem
rename because `git mv` could not write the worktree index outside the sandbox.
No commit, push, tag or publication was performed.

## 2026-09-14 — CU5: a guess costs a command, and Trending is on the feeds card

Implemented LLP 3000.007 §18.5: four mechanical repair families, with the
missing-index family covering named range reads and named rule probes. The
fixer inserts a concrete `by` line after the table’s last declared index
(or its last column when it has no declared indexes), preserving indentation
and line endings across files. It leaves placeholder columns, conflicting
index names, explicit wildcard-field expressions, column `once` errors and
malformed operation headers manual. The repeated wildcard field can be
before or after `*`; an explicit expression is never discarded. A marked
rewrite now ends with ` — check --fix applies it`; JSON retains the existing
`mechanical: true` field. No new diagnostic code or parser alias was added.

Helpers are expanded at each call in `helper_arguments`/`fn_call`, not bound
once. A parameter typed by a table now binds a same-table row argument as a
row, keeping its fields without a lookup; references keep their current
meaning. The language card compiles and runs both forms, and a single
identity helper is exercised with both kinds of argument in one query.
The feeds card has a `likes` table, `likeCounts` maintain and `trending()`
query, seeking the trailing day at the unchanged 8,192 examined ceiling,
sorting by likes and time, and slicing ten. Its warning names the incomplete
set past the ceiling and points to the adjacent maintained ranking. The
README mirrors that explanation.

Baseline diagnostic reproductions on 518891fd1cc67b969a6f57b683e80efadc89b612
(the five source fixtures are in `snapback4-lang/tests/fixtures/repair-*.q`):

```text
schema.q:7:10 — E_QUARRY_UNKNOWN: members has no index whose prefix takes 2 keys; its indexes are byId (id), byRoom (room, id)
  rewrite: by byRoomPrincipal: room, principal, id
  guide: language
schema.q:8:11 — E_QUARRY_UNKNOWN: chats has no index with 2 columns matching this key
  rewrite: declare `unique byC: <columns>` on chats; its indexes are byId: id; byKey: key, id; an index is needed when the named equalities do not cover a total unique key
  guide: language
schema.q:1:22 — E_QUARRY_SYNTAX: once is a column modifier, not an argument constraint
  rewrite: remove once from this argument; declare image <=10000000 once on the owning table column
  guide: language
schema.q:5:41 — E_QUARRY_UNKNOWN: shape repeats field tombstone
  rewrite: keep one
  guide: language
schema.q:1:15 — E_QUARRY_SYNTAX: expected "(", got ":"
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language
```

After, from the same source fixtures:

```text
schema.q:7:10 — E_QUARRY_UNKNOWN: members has no index whose prefix takes 2 keys; its indexes are byId (id), byRoom (room, id)
  rewrite: by byRoomPrincipal: room, principal, id — check --fix applies it
  guide: indexes
schema.q:8:11 — E_QUARRY_UNKNOWN: chats has no index with 2 columns matching this key
  rewrite: by byKeyAdmin: key, admin — check --fix applies it
  guide: indexes
schema.q:1:15 — E_QUARRY_SYNTAX: once is a column modifier, not an argument constraint; declare it on the owning table column
  rewrite: photo: image <=10000000 ? — check --fix applies it
  guide: language
schema.q:5:41 — E_QUARRY_UNKNOWN: shape wildcard already includes field tombstone
  rewrite: { * } — check --fix applies it
  guide: shapes
schema.q:1:1 — E_QUARRY_SYNTAX: an operation with no arguments still needs parentheses
  rewrite: query trending(): — check --fix applies it
  guide: language
```

Measured on the authored fixtures: **5 exact diagnostic envelopes** across **4 repair families**; helper `rowArg` **1 examined**, `refArg` **1 examined**, and the combined query **2 examined**. Trending over the complete trailing-day fixture returns **2 rows**, **4 examined**, `complete: true`; with **8,202 posts** in the day it returns **10 rows**, **16,385 examined attempts**, `complete: false`. The configured ceiling remains **8,192**; the meter records subsequent attempts after a capped read, so its reported attempted count is not a raised ceiling. No meter or serialized value/IR form changed. The lesson is to keep the completeness flag beside a ranking and to distinguish an already-read row from its reference during inline helper binding.

Verification on this worktree: **59 targeted tests passed / 0 failed**
(37 frontend, 9 guide, 3 repair/runtime, 10 CLI fix); the standalone requested
guide command also passed **9 / 0**. Exact commands and final summary lines
follow; Cargo commands ran from `snapback4/`. The final CLI, standalone guide,
full script and isolated React commands used
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`.

```text
cargo test -p snapback4-lang --test repairs --test guide --test frontend_regressions --no-fail-fast -- --nocapture
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.26s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.69s

cargo test -p snapback4 --test fix -- --nocapture
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.72s

cargo test -p snapback4-lang --test guide
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s

bash snapback4/scripts/test.sh
-- ok: cargo test (257 s)
-- ok: fixture wrapper tests (38 s)
ℹ tests 122
ℹ pass 121
ℹ fail 1
-- FAIL: client tests (69 s)
== 1 failure(s) in 771 s

node --test packages/snapback4/test/react.test.mjs
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

The full script ran **381 Rust passes / 0 failures / 1 ignored**, **9 fixture
passes / 0 failures**, **121 client passes / 1 failure**. All builds and
package/chat/Expo typechecks passed. WASM measured **1,523,587 B raw /
427,302 B gzip**; its build took **502 s** on the shared machine, and the
script took **771 s**, **711 s** beyond its 60-second budget. A separate
`--version` startup probe also timed out after **90 s**; no product-latency
claim is made from this loaded run.

The sole remaining failure is the React witness's Chromium startup
**SIGABRT**, before any browser assertion. The isolated rerun reproduced it
(**0 passed / 1 failed**). Its **43 tracked input files**—the test, client
sources, app sources, witness helper and package/toolchain manifests—were
byte-verified against base **518891fd1cc67b969a6f57b683e80efadc89b612**, with
**0 differences**. This test launches no backend and stubs its generated API
and local client, so its reproduction uses the base's unchanged inputs. The
lead must rerun the browser witness in a host that can launch Chromium; no
skip or gate was weakened here. Full-suite green is the one unmet acceptance
item.

Earlier development runs caught an introduced Rust compile error (calling a
map method on the row-field vector), the language-card operation inventory
(**8 passed / 1 failed**), and two CLI fixture defects: colliding temporary
directory names (**6 / 4**) and a missing empty `schema.q` project marker
(**9 / 1**). All were corrected before the final passing targeted runs and
the full script's Rust pass. Two early Cargo commands were accidentally
issued from the repository root and failed before tests; subsequent commands
used the fenced workspace. No root file changed. The build refreshed five
workspace versions in `snapback4/Cargo.lock`; that incidental file was
restored byte-for-byte to the base, leaving no out-of-scope change.

`./ref-check --verbose` passed before this append: **474 LLP docs, 8816 refs
in 22735 files, 0 errors, 0 unchecked**. Every changed source/test file is
below 1,500 lines; the largest is `guide.rs`, **1,474 lines**. The existing
journal remains append-only. No commit, push, tag or publication was made.

Post-append verification: `ref-check: ok — 474 LLP docs, 8816 refs in 22741 files, 0 errors, 0 unchecked`. `git diff --check` is clean; the intended change set is **19 files**, including the five regression fixtures and this journal.

## 2026-09-14 — CU1: search across the viewer's rooms (LLP 3000.007 §18.1)

Admitted `merge messages matching q after c last 50 by byRoomWords`, with
exact scope prefixes and the same modifier order as a matching scan. The
binder uses the existing `Merge` / `Scan` / `WordPrefix` serialization;
no corpus case or value form changed. Matching scopes read their existing
word pages and the outer merge orders by the suffix and id. The heap path
accepts resolved word heads, not an unresolved matching prefix. A uniform
scope decides its rule once before discovering words, so a denied room
cannot use its word population to cap the page. The per-row rule path and
32-word limit remain. A cut names its scope in the private meter site.

The search card, language card and README exercise `everywhere`; the reads
card names matching lanes. N_NEVER_COMPLETE leads with the scoped merge
rewrite and guide search. `check --cost` prints the lane count and the
32-word work inside each matching scope; 50 lanes have no wide-merge note,
51 do. Existing self-probe analysis already proves that the viewer's own
membership prefix is readable: no membership-rule or sync change was
needed. The source discovery remains bounded by the author's first 50.

Measured over 2 rooms × 3 distinct first-term words × 20 messages (120
messages), one page returned 50 rows, complete with a next cursor: examined
122, index entries 8, rule probes 2, steps 244, heap bytes 19664, output
bytes 4941, rows written 0. More than 8 word heads still use 2 verdicts;
24 distinct rows exhaust across 12 pages without gaps. The 33-word fixture
is incomplete and names `programs.everywhere.2 lane [Id("r2")]`; a denied
33-word room leaves the admitted page complete. Both device stores return
the server's rows and cursors for `cof` and `cof car`.

Focused verification: search merge 8 passed / 0 failed, guide 9 / 0,
device 1 / 0 (the scenario runs on both stores). Early local attempts caught
and fixed test-code type errors and fixture sync declarations; those reds
are not claimed to predate CU1. The measured wasm is 1528868 B raw and
428709 B gzip; its build took 427 s on this shared host. All changed source
files and the README remain below 1500 lines; this already-long journal
was kept append-only as instructed. No commit, push, tag, or publication.

Final blocking run: `bash snapback4/scripts/test.sh` reported **1 failure
in 1571 s**: Rust **383 passed / 0 failed / 1 ignored**, fixture
wrapper **9 / 0**, client **121 / 1**; all builds, typechecks and the chat
check passed. The React browser-launch test fails with Chromium SIGABRT,
alone as well as in the suite. Its unchanged inputs exported from base
**518891fd1cc67b969a6f57b683e80efadc89b612** reproduce **0 passed / 1 failed**
with the same SIGABRT; no other failure is claimed to predate CU1. The
full run included long executable-startup delays; no time budget or gate
was changed. `ref-check --verbose`: **474 LLP docs, 8816 refs, 0 errors,
0 unchecked**. Cargo's version-only lockfile drift was restored; only
CU1's intended changes remain for the lead to commit.

## 2026-09-14 — CU2: retained history survives replacement acquisition (LLP 3000.007 §18.2)

Reproduced against base **518891fd1cc67b969a6f57b683e80efadc89b612** with
self-synced members, conversations and messages all retaining delivered
history, **26 messages**, a **25-row** message horizon and a local
`last 50 by byTime` read. The new regression is
`crates/snapback4-device/tests/retained_history.rs`; its ten tests were
**0 passed / 10 failed** against the base implementation. The paired
physical-store count matters: the actual deletion is
`crates/snapback4-device/src/device.rs:427` **at that base**, where replacement
application calls `tx.clear_rows()` and reinstalls only staged acquisition.
The server's horizon re-evaluation did not send message deletions. A live
scope itself already preserved the rows.

Both SQLite and memory produced these message counts; reopening each
store preserved the same result. The fixed replacement is also tested with
**15 unrelated public rows**, forcing a multi-page snapshot after leaving;
partial pages remain private.

| Path | Before leave | Base after | Fixed after | Local completeness before → after |
| --- | ---: | ---: | ---: | --- |
| Live scope | 25 | 25 | 25 | false → false |
| New paged snapshot from zero after leave | 25 | 0 | 25 | false → false |
| Snapshot catch-up starting after leave | 25 | 0 | 25 | false → false |
| Snapshot staged before leave, then log catch-up across leave | 25 | 25 | 25 | false → false |
| Logical membership expiry, appended scope without a sweep | 25 | 25 | 25 | false → false |

The unbounded control holds **26 rows**, with `complete: true` before and
after: the base also lost those **26 → 0** on replacement and catch-up
starting after leave, while the fix keeps **26 → 26** on every path. Thus
replacement loss is not specific to horizons. Rejoin acquires **25 current
images**, keeps the already delivered older image outside that acquisition,
and leaves **26 distinct rows** even after duplicate page application and
another paged snapshot; the never-delivered oldest row stays absent. An
explicit catch-up deletion leaves **24 rows**, and a later snapshot keeps
**24**. Predicted insertion, edit and deletion are not promoted to history:
replacement preserves the **25 confirmed images**. Media home authority is
retired on the staged scope and stays retired on resnapshot; reacquisition
activates it again, on both stores.

Built the fix by seeding snapshot staging with delivered-history rows and
overlaying their confirmed bases beneath predictions before acquisition.
Incoming puts replace those images; explicit deletes still remove them;
scopes preserve text and retire media authority. Staging distinguishes a
newly acquired image from a retained one, so publication does not authorize
revoked media. Tables without media keep their constant-work retained scope
path. No server partition filtering, acquisition limit, completeness rule,
meter ceiling, value-model serialization, or existing corpus case changed.
The sync card and README §3 now state the acquisition/retention distinction.
The exhausted horizon stays `complete: false`; the whole-group control
without a horizon stays `complete: true`. The existing rule cannot certify
an exhausted horizon merely because a small group happened to fit, and no
new coverage receipt or count-based completeness claim was introduced.

The browser evidence taught a second lesson: **0 rows / complete: true** is
not proof that the device store was cleared. In these regressions the local
read after a live leave is **25 / false**, and the revoked server's query is
**0 / true**. `packages/snapback4/src/local.ts:657` replaces an incomplete
local answer with `server()` while online with no pending prediction. That
path can hide retained history without deleting it. The package is outside
CU2's scope; it remains unchanged and the remaining visible defect is filed
as `issues/20260914-snapback4-online-fallback-hides-retained-history.md`.
The original ticket is closed specifically for the reproduced device
replacement loss, with that remaining issue linked explicitly. `git mv`
could not create this worktree's index lock under the filesystem sandbox;
the file was moved into `issues/closed/` without staging for the lead.

Targeted verification after the fix: **27 device / 5 native / 10 retention
tests passed, 0 failed**. The ten regression tests took **0.62 s** in the
combined targeted run (a standalone copy of the same final test executable:
**1.34 s**). Process startup on this host took minutes before some native
binaries reached the harness; those delays are not test execution times.
The first test authoring attempts had an invalid named-key separator and a
short raw-list page assertion that needed an opaque cursor; both were
corrected. One intermediate native test launch was SIGKILLed while another
Cargo invocation relinked its executable; the completed final runs above
supersede that interrupted attempt. No commit, push, tag or publication was
performed. The existing journal was already **3,795 lines**; this required
entry appends to it, while every changed Rust source/test and the README
remain below **1,500 lines** (largest: the guide, **1,453**).

Final blocking run: `bash snapback4/scripts/test.sh` reports **2 failure(s)
in 1343 s**: **383 Rust passed / 1 failed / 1 ignored**, **9 fixture passed /
0 failed**, **121 client passed / 1 failed**; every build and typecheck passed.
The first wasm rebuild took **362 s**; the complete Rust step took **957 s**.
The wasm output is **1,529,741 B raw / 429,065 B gzip**. The separate guide
suite is **9 passed / 0 failed**. `./ref-check --verbose` reports **474 LLP
docs, 8815 refs in 22741 files, 0 errors, 0 unchecked**.

The client failure is `react.test.mjs`'s Chromium startup **SIGABRT**, also
**0 passed / 1 failed** in isolation. Its test, React/app source inputs,
package inputs and browser helper were verified byte-identical to base
**518891fd1cc67b969a6f57b683e80efadc89b612**; this mock-based test does not
load the changed device implementation. The Rust failure is
`dev_and_serve_report_signals_without_an_application_worker`: the combined
run interleaved the serve startup text with its SIGHUP diagnostic, so its
exact-line assertion failed (**10 passed / 1 failed** in that suite).
Two isolated attempts instead failed waiting **15 s** for startup. Rebuilding
the CLI with both changed device production files restored to the named
base reproduced that startup timeout (**0 passed / 1 failed**, **10 filtered
out**, **15.01 s**). Both edited sources and the fixed CLI were restored
immediately afterward. This proves the startup timeout at the base; it does
not claim that the combined run's interleaving was separately reproduced
there. No host lifecycle code or test, browser configuration, test timeout,
or threshold was changed. The blocking suite is therefore **not green**;
the lead still needs a completed green host/browser run. Cargo's automatic
0.2.9 → 0.2.10 lockfile rewrites were restored to the original file because
version bookkeeping is outside this lane.

After the base probes and final cleanup, the reference recheck is still
**474 LLP docs, 8815 refs, 0 errors, 0 unchecked**, now across **22742 files**;
`git diff --check` also passes. Only the intended source, docs and ticket
changes remain; no lockfile change is left for the lead.

## 2026-09-14 — CU2b: left history is the online answer; held snapshots replace (LLP 3000.007 §18.2)

Continued CU2 at base **09bbd95e7b7caed30ae2e281e187a28ee443b222**. The real
client regression first reproduced the builder-visible failure on that
unchanged base: **0 passed / 2 failed**, wasm and process device. Its output:

```text
R5 wasm online left: rows=0, complete=true; held: rows=26, complete=true
R5 process online left: rows=0, complete=true; held: rows=26, complete=true
```

The seam is the existing snapshot audience calculation, factored without
changing its rule or row filtering. The first snapshot page adds `held`, a map
from each delivered-history synced table to the viewer's current audience
prefixes, including an empty list when none are held. A stream page adds
`joined`, only the prefixes of this viewer's current grants whose joins are
on that page; an empty rejoin must clear left state without a row image.
Both fields use plain wire values and carry no row image or another
principal's groups. `local.ts` already forwards the whole page as a record,
so there is no separate transport parser to update. The server's current
readable-image filter is unchanged.

The device persists held/left state in its existing transaction metadata,
including groups with no delivered rows. Snapshot candidates and membership
state stay private together until publication; catch-up can mark a group
left between pages before its current rows were acquired. Only acquired
images or confirmed candidates of left groups publish. A held group therefore
replaces its rows with the snapshot's current acquisition, and an absent
server deletion cannot be copied back as a held row. Predictions are still
replaced by their confirmed bases before retention; explicit deletions and
media-home revocation keep their existing behavior. Reopen preserves the
state; clear/generation reset clears it with the partition.

The shared interpreter asks the device about a scan's evaluated prefix.
When it pins a left delivered-history group, its result keeps the existing
completeness rule but carries `retained: true`, and that horizon is not an
`unknown` fact. This is an internal device outcome, alongside `unknown`;
`contract.ts` and `Read<R>` are unchanged. `local.ts` consumes it at the
fallback shared by one-shot reads and watches, online and offline. A read
that does not pin a group, including a scan across all conversations, keeps
today's fallback. Held incomplete reads also keep their server fallback.
No acquisition limit, log backfill, meter ceiling, value-model serialization,
search form, `check`, `--fix`, or `processDevice` implementation changed.

Both stores produced the same physical/read counts and states:

| Path (SQLite and memory each) | Rows before → after | Complete after | Unknown / retained after |
| --- | --- | --- | --- |
| R1 held deletion while away, replacement | 25 → 25 | false | true / false |
| R2 unseen removal, replacement | 25 → 25 | false | false / true |
| R3 live removal, later replacement | 25 → 25 | false | false / true |
| R4 live rejoin, duplicate page | 25 → 26 distinct | false | true / false |
| R4 subsequent held replacement | 26 → 25 | false | true / false |
| Removal between snapshot pages plus catch-up | 25 → 25 | false | false / true |
| Unbounded whole-group leave/replacement/reopen | 26 → 26 | true | false / true |
| Confirmed delete, then left replacement | 24 → 24 | false | false / true |
| Predicted insert/edit/delete, left replacement | 25 confirmed → 25 | false | false / true |

R1 deletes visible `m25`; it remains absent, while ordinary snapshot
acquisition supplies `m00`, leaving 25 current rows. R4 still acquires exactly
25 puts on rejoin without duplication, but CU2's assertion that a *held*
replacement kept a 26th old row was the over-retention defect: it now expects
25 and excludes `m01` outside that horizon. Every CU2 scenario remains in the
suite. A 10-row page of the left group remains complete; full exhausted
horizon reads stay incomplete. The existing conservative rule is unchanged:
no coverage receipt or count-based completeness claim was introduced.

Fixed R5, **2 passed / 0 failed**, on the real server and real wasm/process
devices, verbatim:

```text
R5 wasm online left: rows=25, complete=false; held: rows=26, complete=true
R5 wasm watch: rows=25, complete=false; offline left: rows=25; revoked server: rows=0
R5 process online left: rows=25, complete=false; held: rows=26, complete=true
R5 process watch: rows=25, complete=false; offline left: rows=25; revoked server: rows=0
```

Targeted commands run from `snapback4/` (Node commands first set
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`):

- `cargo test -p snapback4-device --test retained_history --test device --test native -- --nocapture`:
  **27 device / 5 native / 16 retention passed, 0 failed**, harness times
  **2.04 s / 0.05 s / 0.37 s**. A separate final retention run was **16 / 0**
  in **0.56 s**.
- `cargo test -p snapback4-lang --test guide`: **9 passed / 0 failed**, **0.05 s**.
- `node --test packages/snapback4/test/retained-history.test.mjs`:
  **2 passed / 0 failed**, **384.914709 ms**.

The sync card and README §3 now say a pinned left-group read answers from
the device online and offline, and distinguish left retention from held
replacement. Closed the online-fallback ticket with this resolution. The
supporting seams beyond the brief's named files are `Rows`, engine local
coverage/snapshot plumbing, the device RPC dispatcher and shared test page
helper, and the HTTP response assembly; no other lane's implementation is
changed. All changed source files are under 1,500 lines (largest: guide,
**1,454**). This journal was already over that size; this is the required
append-only entry. No commit, push, tag or publication was performed.

Final verification: `bash snapback4/scripts/test.sh` at the repository root
ran twice, with no source changes between runs. The first ended
`== 2 failure(s) in 1361 s`; the second ended
`== 2 failure(s) in 370 s`. Each had **389 Rust passed / 1 failed / 1 ignored**
and **9 fixture passed / 0 failed**. Their parallel client phases reported,
respectively, **85 passed / 38 failed / 1 cancelled** (124 tests) and
**45 passed / 70 failed / 1 cancelled** (116 tests). All builds and
package/chat/Expo typechecks passed. The chat check waited **196 s / 209 s**
even though its own measured work was **9.3 ms / 5.5 ms**. Both wasm builds
reported **1,577,426 B raw / 437,990 B gzip**. The two full runs are **not
green**, and no timeout or test threshold was changed to make them pass.

The failed Rust case in both runs is
`abort_profile_reports_an_off_thread_panic_to_redirected_stderr`: its fresh
abort-probe child did not exit within 15 seconds. Isolated with
`cargo test -p snapback4 --test lifecycle abort_profile_reports_an_off_thread_panic_to_redirected_stderr -- --exact --nocapture`, it again reported
**0 passed / 1 failed / 10 filtered out**, **15.19 s**. The test and
`src/lifecycle.rs` are byte-identical to base
**09bbd95e7b7caed30ae2e281e187a28ee443b222**. A separate identical probe
compiled directly from that base's lifecycle blob (linking only libc)
completed with SIGABRT in **8.17 s** and emitted both expected panic/signal
lines. This does **not** establish the observed timeout as pre-existing;
no such claim is made. The lead needs to rerun that case outside this lane's
sandbox alongside the known Chromium artifact.

The parallel client failures were startup/readiness timeouts plus Chromium
startup SIGABRT. Rerunning the entire client group alone, with
`node --test 'packages/snapback4/test/*.test.mjs'` from `snapback4/`, twice
reported **123 passed / 1 failed / 0 cancelled**, **38,728.997875 ms** and
**38,901.479541 ms**. Only `React hooks and reference-app lifetimes` failed,
at Chromium launch with SIGABRT; `node --test packages/snapback4/test/react.test.mjs`
also reported **0 passed / 1 failed** in isolation. The final standalone
client group includes both R5 hosts passing with the exact output above.
No client readiness failure is labeled pre-existing from inference alone.

For an additional controlled red, a scratch package under
`/private/tmp/cu2b-base-client` restores only `local.ts` from the exact base
blob and uses the fixed server and devices. Its R5 run is **0 passed / 2
failed**, again printing the two base `rows=0, complete=true` lines above.
The repository sources were never reverted for this proof. The scratch CLI
copy and the workspace CLI have the same SHA-256:
`b87b4ac55ee613c5123910f0e7460f20e010d5c4a11b10dc14f6a71b31ab8fc1`.
This isolates the fallback fix from device storage correctness.

The held-prefix seam is needed because absence from horizon acquisition
cannot establish membership, and membership rows may themselves be retained.
Reusing the server's own audience calculation supplies the missing fact
without reconstructing authority from device-held images. The internal state
also records empty held groups, so a later missed removal can mark them left.
`joined` handles the complementary empty rejoin without changing stream event
kinds or serving an image. Preparing the compiled test executables with
`--list` during the long run changed no sources and ran no tests; those
listings are not included in pass counts.

Final `./ref-check --verbose`: **474 LLP docs, 8817 refs in 22744 files,
0 errors, 0 unchecked**. `git diff --check` passes. The full logs and exact
verbatim command summaries are retained under `/private/tmp/cu2b-*`, with
`/private/tmp/cu2b-verification.md` as the handoff index. There are no changed
diagnostic codes or texts in this lane; R5's before/after lines above are
observations, not new diagnostic vocabulary.

## 2026-09-14 — CU4: literal defaults interpret old images; check assesses the dev store

Built LLP 3000.007 §18.3. A required literal default is additive and fills
absent fields through the existing row-materialization path, before reads,
rule probes, validation, constraints, index keys and the wire. Adoption keeps
the stored image unchanged; it rebuilds index entries from the interpreted
image. A device keeps old images through a safe literal-default addition,
including on reopen with a new backend, while a changed generation still
invalidates native code and requests a snapshot. Both stores build, replace
and delete index entries using the same interpreted values. Optional defaults
keep their insert-only meaning: an absent optional still reads null.

`check` now opens the dev database read-only (or the explicit `--store`),
compares its active generation with the compiled schema in one read snapshot,
and reports each failed successor step as `E_ADOPT` at the declaration's site.
Atomic activation uses the same assessment and step message/rewrite. Checked
narrowing whose existing values already fit still adopts. Required `now` and
`viewer` additions refuse populated tables and adopt empty ones; insert
context is unchanged. The existing runtime codes did not describe this
located schema-adoption refusal, so `E_ADOPT` has its own `why` explanation.
The README's column text, Schema evolution paragraph and types card say so.

Measured scenarios use **3 old rows**, **0 adoption row rewrites** (a SQLite
trigger refuses any attempted rewrite), **0 new partition events**, and
**3 matches** on the newly added default-column index. Five required literal
kinds (bool, int, text, enum and decimal minor units) and one optional default
are checked on each server row: **18 field assertions**. SQLite and memory
devices each exercise live adoption and reopen with the successor, **4 device
scenarios**, each reading the same **3 old images** without a new snapshot;
their persisted images still lack the new column. The empty-table insert
controls read `now` as **1234** and `viewer` as **dev:alice**. Unique-index and
cap refusals also see the materialized value, and rule residual equalities
read it from the old image.

Before, the successor said:

```text
column messages.tombstone is added as required; existing rows must already carry it
```

The runtime refusal was `E_INPUT: messages.tombstone is required (bool)`.
After, the additive step says:

```text
column messages.tombstone is added with default false; rows written before it read false
```

For required contextual defaults the new messages are:

```text
column messages.at is added as required with default now; existing rows would read the adoption's clock
column messages.author is added as required with default viewer; existing rows would read the adoption's viewer
```

The text `check` output, verbatim (exit **1**):

```text
schema.q:3:3 — E_ADOPT: column messages.at is added as required with default now; existing rows would read the adoption's clock
  rewrite: at: time ? or at: time default <literal>; otherwise backfill existing rows before making the column required
  guide: types

check: 1 problem
```

The viewer rewrite is `author: principal ? or author: principal default
<literal>; otherwise backfill existing rows before making the column required`.
The live dev regression verifies that its refusal contains the exact message
and rewrite produced by check, then successfully adopts the literal default.

The important discovery was that the two stores previously did different
things to absent fields: SQLite persisted optional nulls during adoption,
while memory filled every missing column with null and a generation change
dropped all rows. Making a literal default mean the same thing everywhere
required keeping the raw image separate from its interpretation, including
when rebuilding or deleting an index entry. New optional text constraints
remain additive; caps can bind the materialized default group and must be
checked. No parser, client-package implementation, meter ceiling, serialized
value form or existing conformance case changed.

A final old-image regression covers a predicted row carrying `pending: true`.
SQLite now preserves that metadata while validating only schema columns;
the memory store already retained the mark. Both stores keep the raw image
and give it one match in the new default index: **2 additional device-store
scenarios**, **6 device scenarios total**.

Final focused verification: `cargo test -p snapback4-device --test adoption
-p snapback4-sim --test adoption --test clique -- --nocapture` passed **35/35**
(**2 device**, **4 adoption**, **29 Clique**; test-body times **0.04 s**,
**0.03 s**, **3.35 s**). CLI check tests passed **4/4**, the isolated live
dev refusal/adoption test **1/1**, and compiled guide/README tests **9/9**.

The first blocking run reported **2 failing steps / 1422 s**: an introduced
invalid sync-rule fixture and optional-text-constraint classifier regression
were fixed; the affected suites subsequently passed. It also hit client
startup timeouts. The second run reported **2 failing steps / 2196 s**:
Rust **378 passed / 6 failed / 1 ignored** (lifecycle startup deadlines),
fixtures **9/9**, clients **33 passed / 80 failed / 1 cancelled**. Serial
client verification passed **121/122**; isolated HTTP and release activation
passed **9/9** and **10/10**. The remaining Chromium launch abort reproduced
from the unchanged browser witness inputs at base
`518891fd1cc67b969a6f57b683e80efadc89b612` (**0 passed / 1 failed**, SIGABRT).
No claim that the lifecycle/startup timeouts predate CU4 is made.

Each of the **6** lifecycle failures was also rerun individually with
`cargo test -p snapback4 --test lifecycle <test-name> -- --exact --nocapture`;
all **6** again missed their **15-second** subprocess deadlines. This
includes the CU4 dev regression, which had passed earlier in isolation.
The final report retains both outcomes instead of declaring those failures
pre-existing or raising a timeout.

Final review also covered a required literal with a new-column text
constraint (`label: text 1..10 default 'old'`). The compiler already checks
the literal against that constraint. Device adoption now recognizes that
constraint, and new-column immutability, as safe for the held images; it
still refuses to preserve them across changes to existing column meaning.
All **4** live/reopen device scenarios also assert the constrained text
default on each of their **3** held rows. The final wasm build measures
**1,538,036 B raw / 430,830 B gzip**.

The final affected rerun, including constrained text defaults, passed
**35/35** (**2 device / 0.06 s**, **4 adoption / 0.03 s**, **29 Clique /
3.70 s**). A final blocking run on the final source used
`RUST_TEST_THREADS=1 bash snapback4/scripts/test.sh`: **383 Rust passed /
2 failed / 1 ignored**, fixtures **9 passed / 0 failed**, clients **91
passed / 30 failed / 1 cancelled**; `== 2 failure(s) in 1132 s`. All builds,
typechecks and the chat check passed. The CU4 dev test passed in this run.
The remaining Rust failures were the abort probe's child-exit deadline and
interleaved startup/signal output; the signal test's isolated retry instead
hit its startup deadline (**0 passed / 1 failed**, **15.00 s**). Client
failures were waiting/listen deadlines and the base-reproduced Chromium
abort. The preceding ordinary blocking run reported **379 Rust passed /
6 failed / 1 ignored**, clients **69 passed / 51 failed / 2 cancelled**,
and `== 2 failure(s) in 2416 s`. No test deadline or meter ceiling changed.

The blocking gate therefore remains red. No claim that the process deadlines
or signal-output failure predate CU4 is made. `ref-check --verbose` passed:
**474 LLP docs, 8816 refs, 22745 files, 0 errors, 0 unchecked**. The largest
changed Rust file is **1456 lines**. The journal was already **3795 lines**
at the base; its complete original prefix is preserved, as required by the
append-only instruction. Cargo's automatic workspace-version lockfile edits
were restored; the handoff contains **21 intended files**, uncommitted.

## 2026-09-14 — lane W5: charge a uniform verdict by rule shape

Built the fifth-check disposition of LLP 3000.007 §17. A page verdict
from the pinned prefix charges the rule's static probe allowance once on
both outcomes, including the probes that short-circuit evaluation skipped.
The counter moved unchanged from write-target reservation into `rules.rs`:
`exists` costs **1**, `created` with residual equalities **1**, a bare
`created` fact **0**, `and`/`or` sum their children, and `not` keeps its
child's allowance. The reviewed two-probe shapes therefore cost **2**.
W4's aborting-page attempt still costs **1 examined unit** before the
verdict, with no candidates fetched before an allowed verdict. Capped
queries gain no attempt charge; a denied verdict restores hidden expiry
before its allowance can cut the query. No ceiling or serialized form changed.

The named denied regression compares **8 pairs**: `and` and its negated
`or` mirror, empty/hidden and equality mismatch/match, **0** or **8191**
prelude probes. Permits are empty in every world; the equality pair keeps
the same secret and varies only `enabled`. Another **8 pairs** exercise
true verdicts with a fixed target row. The shared helper compares all
**7 meters**, first/retry serializer bytes, receipt, committed source and
maintain deltas, effects, stream, snapshot, and admission/reopen/settlement
on **2 device stores**. Every world retains its starting source state.

Measured meter vectors, identical within every pair (the `and`/`or` and
existence/equality variants have the same numbers):

| Verdict and prelude | examined | index_entries | rule_probes | steps | heap_bytes | output_bytes | rows_written |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Denied, 0, sent with constant 7 | 1 | 0 | 2 | 5 | 0 | 9 | 0 |
| Allowed, 0, sent with constant 7 | 2 | 0 | 2 | 5 | 384 | 9 | 0 |
| Either, 8191, E_BOUND on rule probes | 8192 | 0 | 8193 | 32767 | 2096896 | 0 | 0 |

The query control covers both verdicts at probe ceilings **1** and **8192**,
with **2 probes** charged and **0** candidate examinations at the cut;
with room it examines **0** denied candidates or **1** allowed candidate.
A hidden expiring probe contributes no `next_expiry` on a denied query,
even when the allowance exceeds the ceiling. The lesson is that a verdict
can be uniform while its executed branch count is not: metering must use
schema shape at this boundary, not pad a state-dependent charge afterward.

The existing membership suite asserted a zero-cost false query verdict;
its assertion and two-line comment now expect **1 probe** for either
verdict. This is the one additional test file touched beyond the brief's
named files. The membership suite passes **5 / 0**; the focused suites
pass **72 / 0** (corpus harness **16**, guide **9**, page admission **13**,
write authority **34**), with **211 corpus cases passed / 82 skipped / 0
failed**. The dedicated W5 run passes **3 / 0**. An initial test assertion
spelled the diagnostic meter name `rule_probes` instead of `rule probes`;
that test-only mistake was corrected before these passing runs.

Final blocking verification used serial Rust tests and serial Node test
files on the shared host, with the script and all assertions/time limits
unchanged: **377 Rust passed / 0 failed / 1 ignored**, **9 fixture passed /
0 failed**, **121 client passed / 1 failed / 0 cancelled**. The script's
verbatim summary is `== 1 failure(s) in 201 s`; the remaining failure is
Chromium startup **SIGABRT** inside the sandbox. The exact invocation, from
the repository root under Bash, was:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
node() {
  if [ "${1:-}" = --test ]; then
    command node --test-concurrency=1 "$@"
  else
    command node "$@"
  fi
}
export -f node
RUST_TEST_THREADS=1 bash snapback4/scripts/test.sh
```

Two ordinary parallel invocations of `bash snapback4/scripts/test.sh`
reported `== 2 failure(s) in 1566 s` and `== 2 failure(s) in 637 s`:
each had **376 Rust passes / 1 panic-process timeout / 1 ignored**;
the clients had **61 passes / 52 failures / 1 cancelled** and **81 passes /
33 failures / 0 cancelled**, mostly server-startup timeouts. These are not
labelled inherited product failures. `cargo test -p snapback4 --test
lifecycle abort_profile_reports_an_off_thread_panic_to_redirected_stderr --
--exact --nocapture` passed **1 / 0** alone; `node --test
packages/snapback4/test/write-authority.test.mjs` passed **4 / 0** alone;
`node --test --test-concurrency=1 'packages/snapback4/test/*.test.mjs'`
passed **121 / 1**, Chromium alone. A redundant macOS base build was stopped
after the isolated current panic test passed; it provides no baseline claim.

The isolated React test (`node --test packages/snapback4/test/react.test.mjs`)
reproduced **0 passed / 1 failed**, with Chromium SIGABRT, on untouched
source archived from **3ffae1e059df22428f03d9d63c94e70a29a7577e**. That
snapshot also initially warned about the unbuilt package during dependency
scanning; the failure was at browser launch before visiting a page. The
lead still needs the browser witness outside the sandbox.

A supplemental Linux snapshot was checked as **669 files / 0 hash
mismatches** after adding the shared benchmark fixtures omitted from its
initial transfer. Its full script did not finish client cleanup and is not
passing evidence. The six Linux signal-handler failures reproduced on an
untouched base **3ffae1e059df22428f03d9d63c94e70a29a7577e** with
`CARGO_TARGET_DIR=/tmp/w5-base-target cargo test -p snapback4 --test lifecycle`:
**5 passed / 6 failed**. The initial base build and a supplemental membership
rerun ran out of filesystem space, so neither supplies test results; the
base rerun used available temporary storage. The fixture-only rerun, after
including its inputs and using temporary storage, passed **9 / 0**. No Linux
platform repair is part of W5.

All **6 changed Rust source/test files and the README** are below 1,500 lines
(the largest, `guide.rs`, is **1450**); the existing oversized RFC and
append-only journal keep their history. RFC §14 and the existing corpus
are unchanged. Cargo's incidental five workspace-version lockfile refreshes
were restored. No commit, push, tag or publication was performed.

`./ref-check --verbose` reports **474 LLP docs, 8813 refs in 22609 files,
0 errors, 0 unchecked**; `git diff --check` passes. Supplemental-host
handoff: after the SSH run was interrupted, its launcher **817388** and
script **817389** on **100.126.225.7** still waited for client cleanup;
that run is unfinished. Its snapshot is
`/home/ccheever/lanes/w5-snapshot-3ffae1e`; the host filesystem also exhausted
its available space. Only this task's failed base build files were removed,
and its named failed incremental directory was moved to
`/tmp/w5-generated-recovery` for recovery; no source work was removed.


## 2026-09-14 — 0.2.10 published; the third ceremony run keeps the membership rule

The publication record is now retained: `snapback4@0.2.10` and its Darwin
package at 11:02:06 UTC, followed by `snapback4-expo@0.2.3` at 11:14:36.
The binary is 7,728,288 B (`af4e26be…`); the client tarball 505,169 B.
The first publisher attempt refused on client startup timeouts under host
load; the successful attempt's suite passed before publication. npm then
processed the client package asynchronously for roughly seven minutes,
outlasting the launcher's five-minute visibility wait; the continuation
allowed thirty minutes and completed the remaining steps. The package
version bookkeeping in Cargo.lock and the publish metric land with this
record. W5 is later than this pin.

The third ceremony run, on that pin, is three green and independently
reverified, 5/5 runner probes each: walls 437/407/419 s; loops 1/2/1,
all agent-error; source tables 9/9/9; maintains 1/1/0. Every agent wrote
and kept `.principal = viewer or exists members[.chatKey, viewer]`, with
no membership correction, public roster or duplicate membership table.
Lane S's absorption removed both forms of the ceremony §16 identified.
The before/after/third totals are 11/6/4 loops, with recorded
Snapback-attributed totals 1/0/0. Means from raw walls are
457.4/477.4/421.0 s, N = 3 per pin under shared-host load, not a
magnitude claim. Search still carries N_NO_CURSOR in runs 1 and 3.
The Clique builder overlapped the latter part of run 1 and all of runs
2–3; the full cell remains in flight.

The [third-run record](../benchmarks/runs/2026-09-14-snapback4-ceremonybar-third/README.md)
keeps the schemas, reports, logs and runner results. A P3
[ticket](../issues/20260914-snapback4-lifecycle-tests-time-out-under-host-load.md)
records the loaded-host lifecycle and client startup waits: the prior
orchestrator observed them across trees including main, and the retained
serial client control passes 132/132. No timeout is counted as product
success. This landing changes records and version bookkeeping only;
validation is the evidence consistency audit and `./ref-check --verbose`.
The orchestrator still owes the §10.3 finding from the full cell. The
SQL-read choice and rulings 16, 17 (a)–(c) remain for the author.


## 2026-09-14 — the author accepts the four outstanding card and write-authority choices

Charlie accepted the orchestrator's recommendations for LLP 3000.007
§14 rulings 16 and 17 (a)–(c): "your recs fine." The dated ruling now
accepts the landed `Act<R>` words, ignored immutable patch fields on
unreadable targets, conditions refused without evaluation on those
targets with `upsert … if` refused at check, and uniformly decided plain
prefix scans for every mutation page read. Earlier question and review
text remains intact. No code or status line changes; the existing guards
are the accepted behavior. The 0.2.10 Clique cell continues unchanged,
and the SQL-read choice remains pending its §10.3 finding.

## 2026-09-14 — R1b: default interpretation, store assessment, inspection and repair races

Lane R1b started clean at `db1173ca2c612b1603894756623e8c05fd7369b6` and read
both integration reviews in full. The governing context is LLP 3000 §6–§7
and LLP 3000.007 §18.3–§18.5 under §14's rulings. Seven assigned findings
reproduced before their fixes; the WAL durable-content hypothesis did not.
The regression-first evidence and final summaries are in `/tmp/r1b-*.log`
in this lane's environment; the lead owns the commit and outside-sandbox run.

| Finding | Base observation | Built and verified |
| --- | --- | --- |
| GPT 4 | `defaulted_membership_group_agrees_with_rules_snapshot_and_stream_{sqlite,memory}`: rule admits 1 row but `held` is `[]`, expected `[["r"]]` | Partition row consumers use the existing `row_image` helper before audience/group/lifetime extraction, including interval reconstruction and join images. Alice/Bob: admitted 1/0, held groups 1/0, snapshots 1/0; a later put streams 2 rows to Alice. Leaving emits a scope, retains 2 device rows, and serves 0 online. |
| GPT 5 | `defaulted_sum_keeps_zero_candidate_through_expiry_{sqlite,memory}` returns `Int(0)`, expected `Int(-1)`; `rule_probe_materializes_defaulted_maintain_source_groups` returns `Null` for the live group | Materialize before source-presence grouping and the rule-probe source comparison. Three sources (+1, -1, +1), deletion, then expiry give 1 → 0 → -1; 1 candidate remains and both device stores read -1 before and after a replacement snapshot. The probe has live/expired controls with and without a grouping index. |
| GPT 6 / Grok H3 | Inspection fixture: SQL returns seven nulls; `data` returns only `{"body":"old","id":"m0"}` | Six required defaults appear as 0, -7, O'Reilly, member, 125 and r in SQL; the optional default stays null. `data` uses the stored generation in one read transaction. Explicit true/zero/empty-text/enum/id/optional-false values win. SQL uses absence-specific CASE so an explicit value is never replaced. Device persistence exports remain raw storage images, now named on the cards and README. |
| GPT 7 | `changed_default_rechecks_unchanged_{unique_index,cap}`: check exits 0; dev refuses `E_CONSTRAINT: cannot activate messages.byFlag: existing group exceeds a unique key` / `cap 1` | A changed column rechecks dependent unique indexes, caps and text constraints. Both checks exit 1 at schema.q:3:3 and activation uses its existing shared `Step::refusal` E_ADOPT path. Non-colliding controls check and adopt successfully. No blanket conversion of unrelated store errors. |
| GPT 8 | `check_preserves_database_and_wal_bytes_with_live_and_stopped_dev` passes at the base | No open-mode change. With live dev, stopped dev, and stopped dev with shm removed: database 143360 B, WAL 8272 B, SHA-256 before/after equal in all 3 cases, 0 durable bytes changed. A normal SQLite WAL reader recreates `-shm` and participates in its shared-memory read-lock protocol. |
| GPT 10 | Changed query and last-moment destination saves are accepted; stale final compile has 0 diagnostics, expected 1. The earlier destination-save control already refuses. | Every compiled source is checked before a repair, destination bytes re-read immediately before writing, and final compile reads the project again. Deterministic observer boundaries interleave editor saves without sleeps; subprocesses use check's shared I/O-error mapping and exit 2 naming queries.q or tables.q with no edit. These checks are not an atomic compare-and-write lock against arbitrary editors. |
| GPT 11 | `processDevice requires its directory synchronously before spawning`: `Missing expected exception (Error).` | Empty and whitespace-only dir refuse synchronously with the existing sentence. The injected-host and actual Node-opening controls pass; the 16-test periphery suite passes. |
| GPT 12 (helper half) | `table_typed_helpers_bind_at_each_call_as_rows_or_references` has the generic rewrite and guide types | Exact text and JSON envelopes now name messages[m] and the shape's implicit row parameter, guide shapes. Quarry has no declared shape-typed helper parameter, so the alternative is the working projection `messages[m] { body: .body }`, compiled and run. Row and reference helper paths each examine 1 row; the combined call examines 2. |

Targeted results: core 52/52 (29 unit, 16 corpus-adapter, 7 meter);
simulator adoption 5/5; device adoption 6/6; language repairs 3/3;
guide 9/9; CLI check 9/9 and fix 15/15; client periphery 16/16.
The base WAL control is 1/1. The initial failed tests are recorded separately
from fixture-authoring corrections, and only failures of valid compiled
fixtures above are attributed to the base. The fixer base run adds only
observer calls at compile/write boundaries, without changing behavior.

`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH` followed by
`bash snapback4/scripts/test.sh` completed with `== 1 failure(s) in 138 s`:
Rust 437 passed, 0 failed, 1 explicitly ignored; fixture wrappers 9/9;
client 128/129. All build/typecheck steps and lifecycle tests passed.
The sole client failure is `React hooks and reference-app lifetimes`:
Chromium exits with SIGABRT during launch, before application execution.
`node --test packages/snapback4/test/react.test.mjs` alone repeats it (0/1).
This is the sandbox launch limitation named in the lane brief; no claim of
verification against an unchanged base build is made for that failure.
The wasm build reports 1597346 B raw and 443040 B gzip.

The personas/inspection card moved to `guide/personas.rs` before the guide
was extended (guide.rs 1470 lines). README was already 1525 lines at the
base; tightening the affected client, check, inspection and evolution prose
brings it to 1499, with its Queries bullet untouched. The append-only
journal retains its existing history. No new diagnostic codes, ceilings,
serialized value forms or existing corpus cases changed. The only edit
in R1a's `engine/read.rs` is the authorized single source-materialization
line outside search; its other owned files were not edited. No commit,
push, tag, publication, new agent or remote machine was used.

Final reference check: `ref-check: ok — 474 LLP docs, 8837 refs in 22770 files,
0 errors, 0 unchecked`; `git diff --check` passes. Standalone
`cargo test -p snapback4-lang --test guide` also passes 9/9 after the README
was shortened. HEAD remains the base; only the intended lane changes remain.

## 2026-09-14 — R1a: search verdict dependencies, nested reads, and retained coverage

Reproduced the review findings against `db1173ca2c612b1603894756623e8c05fd7369b6`
before repairing them (and reran the expanded regressions with that commit's
implementation files restored). Rule dependencies now include every possible
probe table, including an expiring maintain's source, independently of executed
branches. A pinned conjunct can deny a non-uniform scope before word discovery
or candidate reads, at the whole rule's static allowance; admitted scopes keep
per-row authority and their never-complete class. Search terms and verdicts are
passed only to the generated word merge's direct lanes: nested reads cannot
inherit them, including hand-built IR that repeats a site or an error exit.
Empty matching reads establish horizon coverage before returning. Retained
history suppresses fallback only in the absence of another unknown/incomplete
reason; a complete held site alone does not invalidate the retained answer.

The core covers **32 paired observations** (and the same 32 with dependencies
removed to isolate W5's already-correct meter/error behavior): `and`/`or`,
denied/admitted, matching merge/plain page, Cap/Abort, 8192/1 remaining probes.
Every pair compares rows, completeness, cursor, cap, all **7 meters**, dependencies,
next expiry and refusal. W5 already charged **2**, or **8193** after the
8191-probe prelude; no allowance repair was needed. Four additional pairs put
**0/33** hidden words before an admitted scope with one visible and one hidden
row. Matching Cap observes examined **2**, index entries **2**, probes **4**,
steps **10**, heap **431 B**, output **121 B**, writes **0** in both worlds;
Abort differs only at examined **5**. The existing **2 scopes × 3 words × 20 rows**
fixture remains 50 returned, examined **122**, index entries **8**, probes **2**,
steps **244**, heap **19,664 B**, output **4,941 B**, writes **0**.

Both device stores cover nested filters and a repeated-site scan whose audience
expires. The real wasm and process clients each changed the held empty-search
answer from **0 to 1** (server fallback), keep the left empty search **0 rows,
complete false**, and changed the mixed left/held read from **25 to 26**; its
watch also returns **26**. Existing retained history stays **25**, including
online/offline watches. Exact N_NEVER_COMPLETE-envelope coverage extends the
matching-merge suggestion to a scope-decided conjunction and refuses that
suggestion when a row field is unpinned. No new diagnostic code or wire form.
The README's Queries/Reads bullet now spells matching merges. The search card
moved to `guide/search.rs`; guide.rs is **1436** lines. Reflowing only the affected
README prose preserves every word and leaves it **1496** lines.

Targeted results: core **5/0**, simulator search **10/0**, device search **5/0**,
existing device retention **16/0**, diagnostic envelope **1/0**, guide **9/0**,
real client retention **6/0**, README **2/0**. The blocking script completed in
**109 s**: Rust **434 passed, 0 failed, 1 ignored**; fixture wrapper **9/0**;
client **133/1**. Its sole red is the sandbox's Chromium launch (`SIGABRT`) in
`react.test.mjs`, also red alone before running any browser assertions; the lead
must rerun that witness outside. No lifecycle timeout reproduced in this run.
Wasm measures **1,598,034 B raw / 443,173 B gzip**, versus the base's
**1,596,940 / 442,873 B** (**+1,094 / +300 B**); no ceiling changed. These are
within-tree measurements on a shared host, not a performance claim. No R1b
file, existing corpus case, commit, push, tag, or publication was touched.

The isolated React witness also aborts `SIGABRT` with tracked implementation
sources restored to **db1173ca2c612b1603894756623e8c05fd7369b6** (**0 passed,
1 failed**); it launches no backend and uses no compiled Rust/wasm artifact.
Every R1a file was restored afterward. Final `./ref-check --verbose`: **474 LLP
docs, 8833 refs in 22772 files, 0 errors, 0 unchecked**. `git diff --check`
passes, and all **15** changed source/test/README files are at most **1496**
lines (the existing append-only journal is separate).


## 2026-09-14 — R2: ordered prefix admission, SQL defaults, and mixed retained reads

Reproduced N1, N2 and N4 against `056335ebf3f27976227f8cee655219e0b875c70a`
before repairing implementation code. The core base run had **5 passed, 6
failed**: five N1 regressions (reversed conjuncts, the examined boundary,
malformed cursor order, partial-verdict expiry, and missing take input) and
one N2 self-witness regression. With base implementation restored, the device
run had **1 passed, 2 failed**: both SQLite and memory lost the coffee row;
the mixed-result test passed because it pins the documented limitation.
The SQL base run had **0 passed, 1 failed**: JSON false, JSON 'Null', JSON 7,
and bytes projected differently when absent versus explicitly stored.

Prefix admission now simplifies statically true self-witnesses, then takes
only the leading conjuncts whose actual fields the prefix pins. A
row-dependent conjunct stops the pre-check. The existing self-probe absorption
used by uniformity is reflected in the evaluated expression, so no absorbed
field is read from an incomplete image. Matching reads validate bounds,
cursors and take before any early return. Every non-uniform pre-check restores
its expiry mark, including a true verdict; admitted rows still record their
expiries. Uniform verdicts retain W5's static allowance and admitted expiry.
R1a's leading-conjunct denial and W5's complete-observation pairs stay green.

N1's reversed pair compares **16 pairs of complete observations** across plain/matching,
Cap/Abort, ample/boundary budgets and both malformed-cursor orders. In the four
ample-budget pairs, base W0/W1 examined counts were **0/1, 1/2, 0/1, 1/3**;
afterward they are **1/1, 2/2, 1/1, 2/2**. Matching index entries changed from
**0/2** to **2/2**, steps from **4/6** to **6/6**, and heap from **4/11 B** to
**11/11 B**. All seven meters match: final plain/matching probes **0/0**,
output **12 B**, writes **0**, and expiry **null/null** instead of **null/200**.
At examined ceiling **0**, Cap marks both worlds; at ceiling **1**, Abort
refuses both with the same E_BOUND envelope. Malformed cursors now refuse both
before admission. A leading true permit with a denied row leaves expiry null;
an admitted row and a uniform admitted rule both retain expiry **200**.
N2 returns **1 coffee row**, excluding the non-coffee candidate, on plain and
matching reads with both cuts over the server and both device store substrates;
the actual device query also preserves online-only unknown coverage.

SQL defaults now use the same JSON extraction path as a stored value of the
column's declared type. **3 JSON cases and all 11 scalar projection kinds**
compare equal and group into **1 group of 2 rows** each; optional absence and
explicit overrides retain their existing tests. Bytes also needed this repair:
the old default was '[0,255]' while the stored projection was '00ff'. No value
serialization, ceiling, diagnostic code, or existing corpus case changed.

N3 intentionally adds no result provenance. Both real client hosts and both
Rust device stores pin the whole-query limit: online **left 0 / held 26**,
offline **left 25 / held 25**, including watches and reconnect; a separate left
query keeps **25**. The base real-host reproduction passed **2/2** and the
final retained-history suite **8/8**. The sync card and README each gain one
sentence directing authors to keep a left-group read in its own query. The
P3 ticket `issues/20260914-snapback4-mixed-left-held-query-loses-retained-rows-online.md`
records the read/result provenance and composition design a future change needs.

Final targeted Rust: core read_verdict **11/0**; simulator membership **5/0**,
page_admission **13/0**, search_merge **10/0**, write_authority **34/0**;
device (including search_merge) **35/0**, retained_history **16/0**;
CLI check **10/0**; language guide **9/0**. The blocking script completed in
**120 s**: Rust **459 passed, 0 failed, 1 ignored**, fixture wrapper **9/0**,
client **135/1**. The sole failure is Chromium aborting **SIGABRT** before the
React assertions; it also fails alone (**0/1**) and with the relevant sources
restored to the exact base above (**0/1**). That witness launches no Rust
backend and directly imports unchanged client/app source. No lifecycle timeout
occurred. All intended files and artifacts were restored after base checks.

The same local wasm build measured base **1,598,440 B raw / 443,350 B gzip**,
final **1,600,989 / 444,211 B**, delta **+2,549 / +861 B**. These are artifact
sizes on this shared host, not a performance claim. All Snapback 4 code files
remain under the cap (largest **1,447 lines**); no bare formatter, installation,
commit, push, tag, publication, remote machine or sub-agent was used. The
lesson is that a static truth must disappear from an incomplete-row evaluation,
and a safe early decision must preserve the rule's order as well as its fields.

A final temporary N3 preservation assertion was also run on the process client
with the implementation and CLI rebuilt at the exact base: **0 passed, 1
failed**, `0 !== 25` for the online left component. The permanent regression
was restored to pin today's whole-query behavior, and the final CLI rebuilt.

## 2026-09-14 — R3: nested denial, a word bound per scope, and best-effort fixes

Reproduced all three findings before changing implementation at base
`c3c80fc8f0b03f1bc014dc5cc4a9a5b5876fd2e5`. The compiled three-term rule
really is `And([And([permit, principal]), body])`. The base core run was
**0 passed / 4 failed** (complete observation, examined boundary, 33-word
later-lane preservation, and the admitted-scope bound under both cuts).
The admitted-scope server pair was **0/1**, both device stores **0/2**, and
the query-save-at-write-boundary fixer regression **0/1**. The new tests
use the compiler's output, including its cursor, rather than reconstructing
only a two-term rule. A test-only language dependency and its lock entry
let the core's private observation suite inspect that compiled output.

Prefix simplification and selection flatten nested conjunctions in their
left-to-right short-circuit order. A leading denial runs before discovery;
the first unpinned term still stops the pre-check. No term is reordered.
The 32-word bound now records the first scope in `word_cut_at`, independently
of `capped_at`: the scope makes the page incomplete but later lanes run.
Completeness and cursor publication on both hosts include the word bound;
retained-history fallback cannot mistake it for retained incompleteness.
The existing uniform wide-lane regression changes only its name carrier.
`check --cost`, `why`, the search card and README name the bound. An admitted
non-uniform scope's hidden rows still spend the query-wide examined and
index-entry budgets. At a real ceiling of **10**, W0 returns its row while
W1 caps or refuses under Cap/Abort; no ceiling was raised. Mutation pages
still refuse matching at check (`E_STRUCTURAL_FANOUT`), including a bound
page outside a loop; the runner can execute matching IR under either cut,
and both cuts are covered on SQLite and memory as well as the server.

The nested-denial test compares **10 complete observation pairs**: plain
and matching under Cap/Abort at ample and boundary budgets, plus the
33-hidden-word merge under both cuts. With ample budgets, the plain
Cap/Abort examined W0/W1 counts change **0/1 → 0/0** and **1/2 → 1/1**;
matching changes **0/1 → 0/0** and **0/2 → 1/1**. Matching index entries
change **1/2 → 0/0**, probes **0/1 → 1/1**, steps **5/9 → 5/5**, and heap
**4/11 → 4/4 B**. Output remains **12 B**, writes **0**, expiry **null**.
Every observation also compares rows, complete, cursor, cap, dependencies,
and the error envelope. The 33-word nested merge now returns **1/1** row
with identical cursors, all seven meters, and no error under either cut.
R2's reversed-conjunct, input-order, expiry and self-witness tests stay green.

For the admitted-scope pair, alice belongs to both r1 and r2; only r1's
**33** hidden `cof*` words differ. The server and both device stores now
return **1/1** row and the same non-null cursor, both **complete: false**;
the base returned **1/0** and lost W1's cursor. Core Cap's final W0/W1
meters are examined **3/35**, index entries **3/35**, probes **3/35**,
steps **20/117**, heap **427/651 B**, output **115/115 B**, writes **0/0**.
Abort examined is **7/71**, the other six fields as above; it no longer
raises the artificial `index entries reached the ceiling 32` refusal.
These unequal private costs are the documented non-uniform contract.

The fixer repeats whole-project source validation at `observe("write")`.
A save to queries.q there now leaves tables.q unchanged and exits **2**,
naming queries.q; the base wrote the stale index repair and exited **1**.
Existing positive byte-exact repairs remain green. README calls validation
best effort: an observed edit refuses, but a save after the final read and
before `fs::write` can still be overwritten. No editor-lock mechanism added.

Targeted: core read_verdict **15/0**; simulator membership **5/0**,
page_admission **13/0**, search_merge **11/0**, write_authority **34/0**;
device (including search_merge) **37/0**, retained_history **16/0**;
CLI check **11/0**, fix **16/0**; language guide **9/0**. The blocking
`bash snapback4/scripts/test.sh` completed in **183 s**: Rust **468 passed,
0 failed, 1 ignored**, fixture wrapper **9/0**, client **135/1**. The sole
failure was Chromium **SIGABRT** before the React assertions. It fails
alone **0/1** and **0/1** using the React witness, package source and reference
apps extracted from the exact base above, with the same installed dependencies;
that witness launches no Rust backend. No lifecycle timeout occurred.

The suite's wasm build measured **1,602,708 B raw / 444,853 B gzip**.
All Snapback 4 code remains below 1,500 lines (largest **1,447**).
No serialized value form, meter ceiling, diagnostic code, existing corpus
case, or client card type changed. No sub-agent, remote machine, repository
clone, formatter, installation, commit, push, tag or publication was used.
The lesson is to preserve evaluation order through nesting and to separate
a scope's bounded search from exhaustion of the query's actual budget.

## 2026-09-14 — shorten the shared write-observation check without shrinking its worlds

The current warm full suite took 140 seconds, reopening the existing
[60-second budget ticket](../issues/20260913-snapback4-blocking-suite-over-60-seconds.md).
Its shared test observation helper checked each before-row's deletion by
scanning every after-row, including 10,000-row privacy fixtures. A per-table
index of typed identities removes that quadratic search while preserving
nominal-ID/string equality and the complete observations of LLP 3000.007 §17.
The privacy worlds, probe ceilings, receipts, both device stores and all
existing assertions remain intact. One regression runs in four existing
integration targets; the product runtime and client contract do not change.

On the same prepared M4 Pro, the isolated candidate passed the unchanged
suite twice: 140 seconds including first-build work, then **96 seconds warm**.
Both passed 383 Rust, 132 client and 9 fixture tests, with zero failures and
one existing ignored Rust test. The warm comparison is 44 seconds / 31.4%
shorter; it is consecutive, uses a shared build cache, and is not a randomized
repeated experiment. The suite still exceeds its budget, so the P0 stays open.
The page-admission group still takes 33.61 seconds and needs profiling.
The [performance record](../benchmarks/runs/snapback4-public-catalog-20260913/README.md)
and ticket retain source, raw-log and cleanup evidence. No release is needed
for this test-helper change.

## 2026-09-14 — the catch-up lands as 0.2.12 (LLP 3000.007 §18)

The lead (Claude, after the handoff's Astra lead was never started)
integrated lanes CU1–CU5 and a continuation, CU2b, as `4582f8421`. Two blind
families reviewed that commit (GPT NOT READY, twelve findings; Grok READY
WITH CHANGES, four), and three fix rounds followed (R1a and R1b, R2, R3). In
each round a finding was first reproduced as a failing test; four did not
reproduce, and their regressions stay. After round 3 both families' narrow
re-checks returned READY. The integration found what no single lane could
see. CU2b's client test called the positional `processDevice` that CU3 had
removed, and main's W5 had removed the probe counter CU1's lane verdict still
read, so each lane now takes W5's static allowance.

What the builders will meet, measured on the real client and the real CLI:

- A left group's history read online: 0 rows, `complete: true` before; 25
  rows, `complete: false` after, on both the wasm and process devices.
- `check` against a stopped `dev` store: `default now` on a new required
  column prints `E_ADOPT` at its line and exits 1; a literal default exits
  0, and `dev` then serves the old row with the default.
- A bare `processDevice()` refuses in one sentence before spawning anything.

Two environment traps cost time. First, `git checkout` and `git merge` in
lane worktrees hang in the post-checkout hook, so run them with
`-c core.hooksPath=/dev/null`. Second, five `lifecycle.rs` host tests time
out outside the sandbox when the machine is loaded: the child stalls in
`_dyld_start` (ticketed). They were green once the load dropped.

Versions move to 0.2.12 (client, darwin binary, crate) and snapback4-expo
0.2.4. Another session published 0.2.11 at 15:24 UTC with bounded HTTP
reader reuse, so this pin is the next number.

## 2026-09-14 — published: snapback4 0.2.12, snapback4-expo 0.2.4

`scripts/publish.mjs` ran from `a5ef8da61`, 16:50–16:54 UTC. Its suite had
no failure in 82 s. The production binary is 7,877,184 packed bytes, sha256
`46696513876d0bbb059b51ae2711fb04b4c77c628b7b767a7b551ca3178bf1a1`. The
installed-consumer proof passed: a query came back complete and fresh, an
online write was sent, and an offline write stayed pending. npm served
`snapback4@0.2.12` and `snapback4-darwin-arm64@0.2.12` at 16:55 UTC. The
xcframework rebuilt in 74 s, and `snapback4-expo@0.2.4` was served at 16:57
UTC. The receipt line is in `metrics/publish.jsonl`. The ceremony bar's
fourth run and the Astra calibration run on this pin.


## 2026-09-14 — locate the remaining maintained-sum setup cost

The performance lane's fourteen separate page-admission tests all pass;
one expired-source maintained-sum case takes 20.44 s. An independently
accounted five-second startup sample puts all 3,667 test-worker observations
inside seeding, with 3,393 under aggregate-source presence. The presence
check eagerly decodes a page before returning on its first matching row.
The [open suite-budget ticket](../issues/20260913-snapback4-blocking-suite-over-60-seconds.md)
records the exact old-source artifact and the core-owner follow-up,
including current main's literal-default handling. No core edit, smaller
privacy world or new full-suite timing follows from this diagnosis.

## 2026-09-14 — the catch-up measured on 0.2.12: ceremony bar and Astra calibration

- **Ceremony bar, fourth run.** 3/3 green with 4 loops, none attributed to
  Snapback, and the natural membership rule 3/3.
- **Astra calibration, first attempt.** It aborted at M1 in 777 s because
  the packet's frozen choreography imports a library that does not
  resolve from a lane copy. Two earlier builders had supplied that file
  themselves. The packet now provides the instrument's own copy, and the
  attempt is kept unscored.
- **Astra calibration, second attempt.** 7/7 green in 5,438 s, 13 loops,
  holistic 86. The target categories moved to setup_and_docs 79,
  data_modeling 89 and queries_and_live 80. The grade passed 101/119.

Everything §18 fixed disappeared from the scorer's notes. The remaining
drag is two new Snapback-attributed loops. One is the presence card
promising prediction the binder refuses; it recurred from 0.2.10. The
other is a helper whose early `return` drops its page's cursor while the
page reads complete, which I reproduced in 12 rows and filed as P1. Both
are the next landing's work; §18.7 records the numbers.

## 2026-09-14 — lane N3: guessed equality costs one repair

Implemented LLP 3000.007 §19.3 in the expression parser and `check --fix`.
The parser records a mechanical refusal at the first of exactly two adjacent
`=` symbols and continues parsing the comparison and helper. Compilation
still stops before binding. The fixer rechecks the original symbol tokens
at that exact site, outside strings and comments, then changes only `==`
to `=`. Stale sites and `===` receive no equality repair. The language card
and package README name the spelling; the P3 ticket is closed.

The regression was red on base `ce15819ad71bd24c9d1b9ec228c083330dee3a31`
(0 passed, 1 failed), then green (1 passed, 0 failed). One guessed operator
previously produced 3 diagnostics; now it produces 1. The six-line helper
fixture's before diagnostics, verbatim:

```text
schema.q:2:9 — E_QUARRY_SYNTAX: expected expression, got "="
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language
schema.q:3:1 — E_QUARRY_SYNTAX: expected expression, got "<indent>"
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language
schema.q:1:1 — E_QUARRY_SYNTAX: a fn body ends with return
  rewrite: end the helper with `return expr` or a bare `return`
  guide: language
```

After, verbatim:

```text
schema.q:2:8 — E_QUARRY_SYNTAX: equality is = in Quarry
  rewrite: = — check --fix applies it
  guide: language
```

After `check --fix`, the corrected helper compiles with 0 diagnostics and
0 notes. Tests cover expression bodies, conditions, bindings, guards,
objects, arrays, rules and filters, plus 2 comparisons on one line in each
of 2 files (4 replacements), preserving Unicode, CRLF, strings and comments
byte-exactly. `!=` still compiles unchanged and its positive runtime control
returns true. For `query q():` followed by `  return 1 === 1`, the unchanged,
non-mechanical diagnostics are:

```text
schema.q:2:13 — E_QUARRY_SYNTAX: expected expression, got "="
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language
schema.q:1:1 — E_QUARRY_SYNTAX: query q has an empty body
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language
```

Targeted checks: `cargo test -p snapback4-lang --test guide --test repairs`
passed 9 guide and 6 repair tests; `cargo test -p snapback4 --test fix`
passed 18. With Node 24.18.0 on PATH, `bash snapback4/scripts/test.sh`
reported `== 1 failure(s) in 207 s`: Rust passed 477, failed 0, ignored 1;
fixture tests passed 9; client tests passed 135 and failed 1, Chromium
SIGABRT in `react.test.mjs`. The isolated command
`node --test packages/snapback4/test/react.test.mjs` also passed 0 and
failed 1 with SIGABRT, matching the brief's named sandbox artifact; no
independent unchanged-base suite was run and no pre-existing-failure claim
is made. `./ref-check --verbose` passed with 0 errors and 0 unchecked;
the largest changed code file is 1,407 lines. No meter, serialized value,
existing corpus case, helper runner or residency code changed.

What I learned: recovery can keep the helper's complete structure while
the recorded diagnostic still blocks compilation. Rechecking full-source
tokens matters even for a two-byte edit: matching a source substring alone
would also match an operator inside a newly edited string or comment.


## 2026-09-14 — lane N2: a helper return preserves its caller's page (LLP 3000.007 §19.2)

The twelve-row reproduction was a page-ownership analysis bug, not a
helper executing the runtime's `Stmt::Return`. `helper_returns` in
`bind/program/control.rs:465` already lowers the return to assignments
and a conditional loop-local `Break`. `engine/pages.rs:159` counted that
nested break as an exit from the outer shape collector, so it discarded
the one-to-one page origin. The actual query return then selected no
page, although the scan's position was still recorded. The analysis now
keeps nested `Break`/`Continue` local; a program `Return` still propagates
through all loops. Helper inlining and the serialized IR are unchanged.

Both query hosts now check for a lost page position before claiming
complete. The private `PagePosition.filled` bit also catches an exactly
full final scan whose interrupted collector dropped rows: five stored
rows, five scanned, one returned, no safe continuation, incomplete. A
proved full final page remains complete, and an auxiliary scan cannot
reclassify an owned final page. The first full suite caught an overly
broad safeguard on native reads; that correction preserves their existing
class because a native scan carries its continuation in its own response.
The existing native-read suite then passed all seven tests.

The final regression fixture was run with all five changed core files
restored temporarily to base `ce15819ad71bd24c9d1b9ec228c083330dee3a31`,
then restored byte-for-byte to the intended changes. From `snapback4/`,
`cargo test -p snapback4-sim -p snapback4-device --test helper_pages --no-fail-fast`
reported (device first, simulator second):

```text
Base:
test result: FAILED. 6 passed; 14 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: FAILED. 3 passed; 7 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
Fixed:
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.44s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
```

Each of eight paged shapes traversed **12 distinct rows in 3 pages
(5, 5, 2)**, with **0 duplicates and 0 gaps**, on the server and both
SQLite and memory devices: **24 traversals, 72 pages**. The cases include
return inside a loop, pure `if`/`else if`, nested helpers, a merge over
two populated lanes, matching, auxiliary scans, and the original plain
and accumulated controls. The interrupted-page tests cover both 5 and
12 stored rows; program returns retain their early-exit behavior.
Mutations have no `next` field, so the conditional mutation-continuation
requirement is inapplicable. No corpus case is needed: neither IR nor
value serialization changed. The ticket is resolved under `issues/closed/`;
the README and shapes/control cards state the helper's page guarantee.

With Node 24.18.0 on PATH, `bash snapback4/scripts/test.sh` first reported
`== 2 failure(s) in 212 s` (the native-read regression above and Chromium).
After correction it reported `== 1 failure(s) in 123 s`: **502 Rust passed,
0 failed, 1 ignored; 9 fixture passed; 135 client passed, 1 failed**.
The remaining client failure is Chromium `SIGABRT` at browser launch in
`react.test.mjs`, the sandbox artifact listed in the lane instructions.
`node --test packages/snapback4/test/react.test.mjs` reproduced it alone
(**0 passed, 1 failed**), before app code loads. This is not a claim that
an unrun base blocking suite passed. The lead must rerun that browser
check outside the sandbox. `cargo test -p snapback4-lang --test guide`
passed **9/9**. All **9 changed code files** are below 1,500 lines
(maximum **1,410**). No diagnostics, ceilings or helper forms changed;
no commit, push, tag or publication was made.

## 2026-09-14 — N1: presence that decides only effects keeps prediction

Implemented LLP 3000.007 §19.1 (ruling 18, option C), against base
`ce15819ad71bd24c9d1b9ec228c083330dee3a31`. No commit, push or publication.
The bound-IR flow check follows values through locals, assignments, pushes,
expression blocks, branches and loop back edges. Presence reaching a write,
refusal, result, read key, loop domain or a non-effect statement arm keeps a
server site naming its use. Only emitted values and emit-only branches keep
prediction. Queries and jobs keep their previous classification; the runtime,
presence registry, parser, fixer, meter ceilings and value serialization are
unchanged. No diagnostic code was added, so guide::CODES needs no new entry.

The additive `connected_effects_only` execution fact is serialized in
residency.json; generated api.ts documents it without removing a field.
`check --residency` and `why` share the explanation. Losing eligibility still
emits N_NOT_PREDICTABLE, gaining it emits no note, and query-side assertions
remain. The guide and README carry the three clarified sentences and the
unconditional emit plus service mutation pattern for dispatch-time presence.
The presence guide-gap ticket is resolved under issues/closed/.

What I learned: the effects card also lacked sync lines. Its corrected
members table uses an existing membership grant, and its messages use the
500-row horizon, so the example both predicts and compiles without a note.
The language card's sendBrief exposed a second necessary distinction:
Quarry lowers `and` and `??` into assignments. The minimal additional binder
change in bind/program/control.rs keeps mutation condition and emit-payload
setup inside existing Expr::Block values, so expression computation is not
mistaken for a source assignment controlled by presence. Helpers' writes
and refusals remain sinks even inside an emitted payload. Query and job
lowering is unchanged. No N2/N3-owned file was touched.

Measurements: 2 guide operations change from never to eligible (`send`,
`sendBrief`); 20 negative programs remain never. On each of 2 device stores,
0/1/2 connected recipients give 1 predicted message row identical to the
server's row and 2/1/0 server notifications: 6 of 6 row comparisons equal.
Presence queries remain incomplete on both stores. The chat backend checks
with 5 synced tables and 9 operations; 0 execution/eligibility changes
against the base binary. Chat Expo imports that backend and both apps
pass typecheck. The changed code files number 11, maximum 1,449 lines
(using caps' split-on-newline count), 0 over 1,500; guide.rs is 1,413.
The full suite measured 136 s; its wasm build reported 1,603,327 B raw and
445,115 B gzip. These are one-run observations, not comparative claims.

Validation commands below ran from snapback4/ except the full suite,
ref-check and caps, which ran from the repository root. Every Node/Bun
command used `export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`.
Two early Cargo invocations mistakenly used the repository-root cwd:
`cargo build --manifest-path snapback4/Cargo.toml --quiet` selected the right
workspace; a bare `cargo test -p snapback4-lang --test presence -- --nocapture`
failed before compiling because root's vendor/ibex was absent, and was rerun
from snapback4/. No root code/build inputs changed. The first device test
attempt needed a collect type-inference correction, and the first JS test
attempt needed the package build; the red regression counts below are the
subsequent executable assertions on the base implementation.

### Red before, green after

`cargo test -p snapback4-lang --test presence -- --nocapture`

```text
Before:
test result: FAILED. 0 passed; 4 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
After:
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

`cargo test -p snapback4-device --test device presence_effects -- --nocapture`

```text
Before:
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 37 filtered out; finished in 0.03s
After:
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 37 filtered out; finished in 0.11s
```

`node --test --test-name-pattern='presence effects residency' packages/snapback4/test/residency.test.mjs`

```text
Before:
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 84.614291
```

`node --test packages/snapback4/test/residency.test.mjs`

```text
After (all residency tests, including the new regression):
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3461.648125
```

### Targeted suites and acceptance

`cargo test -p snapback4-lang --test guide`

```text
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

`cargo test -p snapback4-lang --test presence --test guide`

```text
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

`cargo test -p snapback4-device --test device`

```text
test result: ok. 38 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.01s
```

`cargo test -p snapback4-sim --test residency --test clique`

```text
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.51s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
```

The blocking run reported Rust 476 passed, 1 failed, 1 ignored; the 44
verbatim Rust summary lines and each phase verdict follow. The single Rust
failure was startup stderr interleaving with a signal diagnostic in
`dev_and_serve_report_signals_without_an_application_worker`; it passed
alone. This is a flaky observation, not a claimed base-proven product defect.
The only client failure was the user-documented Chromium sandbox SIGABRT,
reproduced alone; an outside-sandbox rerun remains the lead's. No other
client test failed, so a lower-concurrency client rerun was not needed.

`bash snapback4/scripts/test.sh`

```text
-- ok: cargo build (3 s)
-- ok: wasm build (17 s)
-- ok: package typecheck (0 s)
-- ok: package build (1 s)
-- ok: chat app check (1 s)
test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.06s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.40s
test result: FAILED. 11 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.34s
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.43s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.27s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 38 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.91s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.95s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.33s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.84s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.68s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.62s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.53s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.71s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.84s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 7 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 6.00s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 29.81s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.59s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
-- FAIL: cargo test (114 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
-- ok: fixture wrapper tests (12 s)
ℹ tests 137
ℹ pass 136
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
-- FAIL: client tests (45 s)
== 2 failure(s) in 136 s
```

`cargo test -p snapback4 --test lifecycle dev_and_serve_report_signals_without_an_application_worker -- --nocapture`

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 11 filtered out; finished in 3.59s
```

`node --test packages/snapback4/test/react.test.mjs`

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 696.540875
```

`./ref-check --verbose`

```text
ref-check: ok — 474 LLP docs, 8842 refs in 22819 files, 0 errors, 0 unchecked
```

`node scripts/caps.mjs`

```text
caps — budgets declared in rules/RULES.md

  rules/RULES.md: 625 words
  blocking checks: 5 (caps, ref-check, snapback2/scripts/test.sh, snapback2/scripts/measure.mjs --check, check-inventories)
  product-latency row: filled
  working set: 59 of 59
  foundation: 12 of 12
  source files: 5291 scanned, 794 skipped as generated, 101 skipped as vendored, 690 skipped as benchmark run records
  oversize files: 205 of 204 allowed by baseline

  cap:lines
    crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs is 1504 lines, over the cap of 1500.
    Baseline allows 204 oversize files; there are 205.

1 violation.
```

The caps failure is base-proven: `git show
ce15819ad71bd24c9d1b9ec228c083330dee3a31:crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs`
is byte-identical to the working file and has 1,504 lines by the checker.
All changed tracked code files are below 1,500 both at the base and now,
so the 205-file oversize count is unchanged. All three new code files are
also below the cap. No out-of-scope file was changed to repair that failure.

### Verbatim residency evidence

The original effects card before the change (its missing sync is visible):

```text
residency (facts)
  members: online only (no sync line); cap 100 by roomId
  messages: online only (no sync line)
operations (facts)
  send: predicts: never; queued without a row
    Server: point members by byRoomPrincipal: online only (site programs.send.0)
      rewrite: sync members to its read-rule audience, or read a compact synced projection
    Server: scan members by byRoomPrincipal: online only (site programs.send.1)
      rewrite: sync members to its read-rule audience, or read a compact synced projection
    Server: connected[principal] is known only by the server (site connected)
      rewrite: remove connected from this query; observe presence separately online
    Server: write messages by byId: online only (site insert messages)
      rewrite: sync messages to its read-rule audience, or read a compact synced projection
    Server: rule members by byRoomPrincipal: online only (site insert messages rule)
      rewrite: sync members to its read-rule audience, or read a compact synced projection
    Server: rule members by byRoomPrincipal: online only (site insert messages rule)
      rewrite: sync members to its read-rule audience, or read a compact synced projection
```

The corrected synced card still failed on the base binary, isolating the
presence classification from the missing sync declarations:

```text
operations (facts)
  send: predicts: never; queued without a row
    Held: point members by byRoomPrincipal: held, no horizon (site programs.send.0)
    Held: scan members by byRoomPrincipal: held, no horizon (site programs.send.1)
    Server: connected[principal] is known only by the server (site connected)
      rewrite: remove connected from this query; observe presence separately online
    Held: rule members by byRoomPrincipal: held, no horizon (site insert messages rule)
    Held: rule members by byRoomPrincipal: held, no horizon (site insert messages rule)
```

After, `check --residency` on the corrected effects card:

```text
residency (facts)
  members: sync to members[.roomId] (from the read rule); cap 100 by roomId
  messages: sync to members[.roomId] last 500 by byRoomTime (from the read rule)
operations (facts)
  send: predicts: eligible
    connected: decides effects only — the server decides who is notified at commit
    Held: point members by byRoomPrincipal: held, no horizon (site programs.send.0)
    Held: scan members by byRoomPrincipal: held, no horizon (site programs.send.1)
    Held: rule members by byRoomPrincipal: held, no horizon (site insert messages rule)
    Held: rule members by byRoomPrincipal: held, no horizon (site insert messages rule)
```

Every negative below previously printed this same presence site and rewrite:

```text
  probe: predicts: never; queued without a row
    Server: connected[principal] is known only by the server (site connected)
      rewrite: remove connected from this query; observe presence separately online
```

After, the following are the exact presence reason lines for each negative
from `check --residency`; every operation remains `predicts: never; queued
without a row`. Every line has this same rewrite:

```text
      rewrite: decide only the emit with presence; read it on the server in a service mutation for anything else
```

absent

```text
    Server: connected[p] decides a write row at programs.probe.body.2 insert notes (site programs.probe.body.2 insert notes)
    Server: connected[p] decides the returned value at programs.probe.body.3 (site programs.probe.body.3)
```

alias

```text
    Server: connected[p] decides a write row at programs.probe.body.3 insert notes (site programs.probe.body.3 insert notes)
    Server: connected[p] decides the returned value at programs.probe.body.4 (site programs.probe.body.4)
```

break

```text
    Server: connected[p] decides break at programs.probe.body.0.loop.0 (site programs.probe.body.0.loop.0)
    Server: connected[p] decides break at programs.probe.body.0.loop.0.then.0 (site programs.probe.body.0.loop.0.then.0)
```

condition

```text
    Server: connected[p] decides the returned value at programs.probe.body.1 (site programs.probe.body.1)
    Server: connected[p] decides a write condition at schema.q:12:3 (site schema.q:12:3)
```

continue

```text
    Server: connected[p] decides continue at programs.probe.body.0.loop.0 (site programs.probe.body.0.loop.0)
    Server: connected[p] decides continue at programs.probe.body.0.loop.0.then.0 (site programs.probe.body.0.loop.0.then.0)
```

delete

```text
    Server: connected[p] decides a read key at programs.probe.0 (site programs.probe.0)
    Server: connected[p] decides a write key at programs.probe.body.2 delete notes (site programs.probe.body.2 delete notes)
    Server: connected[p] decides a require NOT_FOUND at schema.q:12:3 (site schema.q:12:3)
```

effect_assignment

```text
    Server: connected[p] decides an assignment at programs.probe.body.1 (site programs.probe.body.1)
```

else_write

```text
    Server: connected[p] decides a write at programs.probe.body.0 (site programs.probe.body.0)
    Server: connected[p] decides a write row at programs.probe.body.0.else.2 insert notes (site programs.probe.body.0.else.2 insert notes)
    Server: connected[p] decides the returned value at programs.probe.body.0.else.3 (site programs.probe.body.0.else.3)
```

filter

```text
    Server: connected[p] decides a read condition at programs.probe.0 (site programs.probe.0)
```

implicit

```text
    Server: connected[p] decides an assignment at programs.probe.body.1 (site programs.probe.body.1)
    Server: connected[p] decides a write row at programs.probe.body.4 insert notes (site programs.probe.body.4 insert notes)
    Server: connected[p] decides the returned value at programs.probe.body.5 (site programs.probe.body.5)
```

key

```text
    Server: connected[p] decides a read key at programs.probe.0 (site programs.probe.0)
```

loop

```text
    Server: connected[p] decides a loop domain at programs.probe.body.0 (site programs.probe.body.0)
```

loop_carried

```text
    Server: connected[p] decides a write row at programs.probe.body.1.loop.2 insert notes (site programs.probe.body.1.loop.2 insert notes)
```

patch

```text
    Server: connected[p] decides the returned value at programs.probe.body.1 (site programs.probe.body.1)
    Server: connected[p] decides a write patch at schema.q:12:3 (site schema.q:12:3)
```

push

```text
    Server: connected[p] decides a write row at programs.probe.body.4 insert notes (site programs.probe.body.4 insert notes)
    Server: connected[p] decides the returned value at programs.probe.body.5 (site programs.probe.body.5)
```

require

```text
    Server: connected[p] decides a require X at schema.q:12:3 (site schema.q:12:3)
```

return

```text
    Server: connected[p] decides the returned value at programs.probe.body.0 (site programs.probe.body.0)
```

update

```text
    Server: connected[p] decides the returned value at programs.probe.body.1 (site programs.probe.body.1)
    Server: connected[p] decides a write key at schema.q:12:3 (site schema.q:12:3)
```

upsert

```text
    Server: connected[p] decides the returned value at programs.probe.body.1 (site programs.probe.body.1)
    Server: connected[p] decides a write patch at schema.q:12:3 (site schema.q:12:3)
```

write

```text
    Server: connected[p] decides a write at programs.probe.body.0 (site programs.probe.body.0)
    Server: connected[p] decides a write row at programs.probe.body.0.then.2 insert notes (site programs.probe.body.0.then.2 insert notes)
    Server: connected[p] decides the returned value at programs.probe.body.0.then.3 (site programs.probe.body.0.then.3)
```

### Final exit-path correction and re-verification

A final review added two negatives: a presence-derived value can survive a
`break` or `continue` that skips a later overwrite. The first implementation
joined only ordinary branch tails and incorrectly called the break case
eligible. The flow now conservatively retains every possible exit image;
`return`, `break` and `continue` stop their path. This preserves taint into
both the next iteration and the code after the loop. The final count is
**22 negative programs**, superseding the 20-case count earlier in this
entry; all six required negatives' recorded reason lines above are unchanged.
The full blocking suite was rerun after this last code correction.

`cargo test -p snapback4-lang --test presence presence_non_effect_uses_keep_precise_server_reasons -- --nocapture`

```text
Before the exit-path correction:
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
After the exit-path correction:
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.02s
```

`cargo test -p snapback4-lang --test presence -- --nocapture`

```text
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

`cargo test -p snapback4-lang --test guide`

```text
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
```

break_exit — before (base binary), the common server reason printed above; after:

```text
    Server: connected[p] decides a write row at programs.probe.body.4 insert notes (site programs.probe.body.4 insert notes)
    Server: connected[p] decides the returned value at programs.probe.body.5 (site programs.probe.body.5)
```

continue_exit — before (base binary), the common server reason printed above; after:

```text
    Server: connected[p] decides a write row at programs.probe.body.1.loop.2 insert notes (site programs.probe.body.1.loop.2 insert notes)
```

Final `bash snapback4/scripts/test.sh` run after the exit-path correction:

```text
-- ok: cargo build (2 s)
-- ok: wasm build (2 s)
-- ok: package typecheck (1 s)
-- ok: package build (1 s)
-- ok: chat app check (1 s)
test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.44s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.41s
test result: FAILED. 11 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.97s
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.61s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.13s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.24s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 38 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.98s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.66s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.46s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.38s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.66s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.83s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.13s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.33s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.93s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.88s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 7 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 5.74s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 25.16s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.80s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
-- FAIL: cargo test (176 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
-- ok: fixture wrapper tests (11 s)
ℹ tests 137
ℹ pass 136
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
-- FAIL: client tests (46 s)
== 2 failure(s) in 183 s
```

Final totals: Rust 476 passed, 1 failed, 1 ignored; fixtures 9/9;
client 136 passed, 1 failed (Chromium SIGABRT). The repeated lifecycle
failure was the same startup/signal stderr interleaving, on SIGABRT this
time. Its isolated retry is:

`cargo test -p snapback4 --test lifecycle dev_and_serve_report_signals_without_an_application_worker -- --nocapture`

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 11 filtered out; finished in 3.63s
```

The lifecycle symptom is now **base-proven**, supplementing the earlier
isolated retry: `python3 /tmp/n1-base-signal.py` deployed and launched the
unchanged base binary, read its readiness URL, then sent SIGHUP. It
reproduces the test's signal/startup-line interleaving without any lane
code. The host's lifecycle.rs, serve.rs and lifecycle test are unchanged
at base `ce15819ad71bd24c9d1b9ec228c083330dee3a31`.

```text
base ce15819ad71bd24c9d1b9ec228c083330dee3a31: 36 exact signal lines; 4 interleaved signal lines; 40 expected SIGHUP exits
'snapback4 serve: http://127.0.0.1:53909  (release /var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/n1-base-signal-mla4mmq3/release/releases/1, generation SNAPBACK4_SIGNAL verb=serve generation=1 reason=SIGHUP signal=1\n'
'snapback4 serve: http://127.0.0.1:53920SNAPBACK4_SIGNAL verb=serve generation=1 reason=SIGHUP signal=1\n'
```

No implementation work from N1 is deferred. The lead still needs the
outside-sandbox acceptance rerun; the baseline host log race and repository
caps overflow remain outside N1. No runtime or other lane file was changed
to hide either failure. The ticket is closed with the final 22-case count.


## 2026-09-14 — R1g: lost pages, exactly; equality controls (LLP 3000.007 §19.2–§19.3)

Base: `fde9623145bfbaba4c1062e64b756a1e7bdb252e`. Read both blind reviews,
`gpt.md` and `grok.md` in the lead's `snapback-next-review` directory, before
changing runtime code. The lane reproduces the short interrupted page, the
owned page masking its lost sibling, and the exhausted exact-bound scalar.
The equality findings are coverage gaps: both controls pass on the base, so
neither the lexer, parser nor fixer implementation changes.

The page plan now retains each early-exiting loop's source page, including
aliases, alongside the returned page's owner. Execution records a loss only
when that loop actually breaks or returns with rows still in its iterator;
a helper's nested loop exit does not exit the enclosing collector. Every
recorded page is checked independently: `next` without its own returned owner
is lost, including an auxiliary page, and an interrupted collector cannot
claim exhaustion just because its scan was short. `filled` is gone. An
exhausted scalar needs no cursor owner, whether it consumed 4 rows or exactly
5. Server, local device, native query and retained-history classification
continue to use the common loss predicate; native reads carry their guest
continuation rather than opaque Quarry pages and keep their existing behaviour.
No meter ceiling, serialized value/IR form or effect-id path changed.

| Finding | Reproduced at the base? Test and red output | Fix | Green |
| --- | --- | --- | --- |
| Interrupted short page claims complete | Yes: `interrupted_2`, `interrupted_3`, `interrupted_4`; `test interrupted_2 ... FAILED`; both device stores fail the same cases | Record actual collector interruption with remaining rows | All 7 populations on server, SQLite and memory pass; only the 1-row case is complete |
| An owned page masks a lost sibling | Yes: `owned_page_cannot_mask_lost_sibling ... FAILED`; device short and continuing sibling cases fail | Check every page against its own owner | Owned field retains its cursor; the query stays incomplete for the lost field |
| Fully consumed exact-5 scalar claims incomplete | Yes: `test exhausted_scalar_is_complete ... FAILED`, plus both device stores | Remove `filled` as evidence of loss | 5-row scalar complete; 6-row scalar incomplete with no cursor |
| Auxiliary continuation masked by returned page | Yes: `test auxiliary_lost_page_is_incomplete ... FAILED`, plus both stores | Same per-page predicate | Returned data and cursor preserved, completeness false |
| Retained marker conceals an independent lost page | Yes: `0 passed; 2 failed` in the two-store collector regression | Existing retained classifier receives the corrected common predicate | Lost collector is not retained-only; exhausted scalar remains retained-only under the horizon |
| Returning helper actually inside merge setup | No defect reproduced: `returning_helper_inside_merge_setup_keeps_page` passes on all 3 hosts at base | Tests only; helper computes lane keys inside setup | 12 distinct rows in pages 5, 5, 2 |
| Complete page with returning helper; `returnedFromLoop` | Both controls already pass at base | Kept unchanged behaviour | Exact-5 helper page complete; program return yields 1 row, no cursor, incomplete over 12 rows |
| `!==` and mixed `==` plus independent syntax error | No defect reproduced after calibrating the test's expected diagnostic location and independent syntax input | Tests only | `!==` lexes as `!=` then `=` and is not repaired; only `==` changes in the mixed source |

The first equality test draft expected column 13 rather than the actual 14
for `!==`. Its independent `return )` also produced a lexer diagnostic as well
as a parser diagnostic; the final fixture uses `return :` to isolate one
independent syntax error. Those were test-authoring corrections, not product
regressions. The retained-history positive control initially asserted complete;
the existing acquired-horizon policy deliberately remains incomplete on
exhaustion, with `unknown=false, retained=true`. That expectation was corrected
without changing the horizon implementation.

Targeted commands run from `snapback4/`; all summaries below are verbatim.
The base page run preceded every runtime edit:

`cargo test -p snapback4-sim -p snapback4-device --test helper_pages --no-fail-fast -- --nocapture`

Base (device, then simulator):

```text
test result: FAILED. 32 passed; 14 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.28s
test result: FAILED. 15 passed; 6 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
```

After (device, then simulator):

```text
test result: ok. 46 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.26s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
```

`cargo test -p snapback4-device --test retained_history interrupted_collector -- --nocapture`

Base:

```text
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 16 filtered out; finished in 0.03s
```

`cargo test -p snapback4-device --test native_reads --test retained_history --no-fail-fast -- --nocapture`

After (native reads, then retained history):

```text
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.15s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.43s
```

`cargo test -p snapback4-lang --test repairs --test guide --no-fail-fast -- --nocapture`

Base, after the test-authoring corrections (guide, then repairs):

```text
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.54s
```

After (guide, then repairs):

```text
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.72s
```

`cargo test -p snapback4 --test fix -- --nocapture`

Base, after the test-authoring corrections:

```text
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.13s
```

After:

```text
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.28s
```

The first complete suite exposed one expected semantic change in the copied
corpus: `conditional-auxiliary-page-is-not-result` expected receipt freshness
to mean a complete answer despite losing the auxiliary page's continuation.
Its failure was:

```text
  FAIL conditional-auxiliary-page-is-not-result: expected card state Fresh (corpus Fresh), got Partial
```

The necessary out-of-brief file is `crates/snapback4-core/tests/corpus.rs`:
its existing trace-to-card adapter now combines the golden `rangeStops` with
returned-page provenance when interpreting completeness, while preserving the
nested-preview and merge-discovery controls. No case in `snapback4/corpus/`
was edited or excluded; all 211 supported cases execute, and the same 82 legacy
exclusions remain. No other out-of-scope file was touched.

`cargo test -p snapback4-core --test corpus -- --nocapture`

```text
corpus (Rust server only; no TypeScript/replica conformance claim): 211 passed, 82 skipped, 0 failed
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.01s
```

From the repository root, with the required Node 24 runtime:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
bash snapback4/scripts/test.sh
```

First full run, before the corpus adapter correction (554 Rust passed,
1 failed, 1 ignored; the failed corpus expectation above and Chromium):

```text
-- ok: cargo build (5 s)
-- ok: wasm build (13 s)
-- ok: package typecheck (1 s)
-- ok: package build (0 s)
-- ok: chat app check (1 s)
test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.05s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.40s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.64s
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.19s
corpus (Rust server only; no TypeScript/replica conformance claim): 210 passed, 82 skipped, 1 failed
test result: FAILED. 15 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.14s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 38 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.60s
test result: ok. 46 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.29s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.23s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.31s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.66s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.55s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.45s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.36s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.58s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.75s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 7 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 3.75s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 18.87s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.04s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
-- FAIL: cargo test (94 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0

### 2026-09-14 — R1p: presence soundness and analysis-only expression ownership

Implemented review round 1 of LLP 3000.007 §19.1 from base
`fde9623145bfbaba4c1062e64b756a1e7bdb252e`, after reading both the GPT and
Grok review artifacts. No commit, push, tag, publication, sub-agent or
remote machine was used. All Cargo commands that actually built or ran
these tests used the `snapback4/` workspace. Node and Bun used Node 24.18.0.

Chose route (a): keep the binder's grouping only in its transient analysis
image, then restore the spilled statements before admission or execution.
A side map translates analysis paths into original runner statement sites;
only the resulting prediction charge sites enter additive execution facts.
This is smaller than teaching every IR consumer a transparent wrapper:
there is no new runtime expression, admission exception, meter exception
or special error-site prefix. Authored scan predicates retain their original
blocks. The original 10-step program again takes 10 steps, rather than 11;
the two condition failures again identify `probe:2:then:1` and
`probe:5:then:1`, rather than both identifying `where:2:then:1`.

Effects now use URL-safe commit-sequence/emission-ordinal ids. They never
consume `Context::mint`, including when `new` appears in the payload;
payload `new` still consumes its own ordinary value id. Both device stores
exercise emits before, between and after inserts at connection counts
0/1/2, reopen and replay the queue, compare returned ids and rows, then
claim and settle effects. Additional effect-only commits and at-most-once
write replay retain five distinct, stable effect ids. The full-suite worker
caught an intermediate colon-delimited spelling: its encoded `%3A` did not
match the route's literal id. Using hyphens fixes the worker without
changing the endpoint or the value model.

Presence-derived arguments cannot enter arithmetic, negation, fallible or
variable-cost builtins, read keys, minting or explicit refusals. Safe
presence guards carry their original statement sites to prediction, which
evaluates the untaken total arm too, discards its effects and restores its
local slots. Thus prediction pays at least the server's cost. Conditional
values also need a fixed-size proof: otherwise a later clone can vary in
cost even after both arms paid. The conservative proof admits scalar
literals, presence counts and booleans; unknown variable widths stay
`never`. A counterfactual arm requiring a combined data/presence guard's
nullable-value refinement yields `E_PREDICT` and queues without a row;
an outer data guard preserves prediction. This is covered positively on
both stores. `send` and `sendBrief` remain eligible. All 22 original N1
negative programs remain unchanged and green. Four unsafe N1 positive
examples are now retained in the totality-negative test, with total
versions in their original positive test; preserving their old eligibility
would contradict this lane's soundness requirement. The new 12-case
negative matrix includes the already-refused require/unwrap as a control.

No existing corpus case was edited. The frozen `named-emit` oracle reserves
a row id for its effect, so it has the adapter's named
`shared-effect-id-supply` exclusion. The added `named-emit-independent-ids`
case keeps the same program and result while supplying only its two row
ids. Its adapter regression is red against the base and green now. Corpus
coverage is 211 passed, 83 named exclusions, 0 failed (294 cases).

For the binder comparison, captured 740 compiler input bundles from the
workspace and client tests, and inventoried all 15 checked-in Quarry files
in the app/fixture/crate directories plus every guide and README Quarry
block. The one-time census bound 1,112 mutation instances. It compared
2,224 admission verdicts (2,192 admitted) and 2,114 fresh-engine executions
at step ceilings 10 and 2,000, including all seven meter fields and complete
refusals/sites. Reference lowering used `control.rs` from
`ce15819ad71bd24c9d1b9ec228c083330dee3a31` with the base compiler, holding
residency policy fixed so the intended eligibility change is not mistaken
for an IR change. Both eligible and never admission policies were checked.
Execution used synthesized arguments, empty stores, fixed time and
fixed-width ids; this is a repository census, not an exhaustive exploration
of every input/store/presence world. Every captured mutation's serialized IR
is identical, with 0 missing instances, 0 admission differences and 0 meter
or refusal/site differences. The two JSON snapshots have the same SHA-256:
`45b072efbac7c107686d51057988c32553033c1c014f3d72a6036b1ba9fc0be0`.
The temporary compiler logger and census test were removed; the source
bundles, harness and before/after JSON remain in `/tmp/r1p-evidence/`.

The id regression's base results at connection counts 0/1/2 were device
`[A,B]` versus server `[B,D]`, `[A,B]`, `[A,C]`, on both SQLite and memory.
All six worlds now return `[A,B]` and consume exactly 2 row ids. The cost
pair now refuses on both hosts at ceiling 18 and succeeds on both at 19;
the server's 19 steps are unchanged. The baseline predicted at ceiling 18
while the server refused. Division now has `predicts: never` in all three
worlds; at zero connections the server still reports `E_DIV_ZERO` and
rolls back its row. The device queues without predicting that row.

Regression runs against the exact base production sources (temporarily
restored with `git show`, then restored from byte-for-byte local backups)
were followed by the final targeted green runs below. Tests collect
failures through both device stores instead of stopping at the first
store's failure. All commands in the following list ran from `snapback4/`.

`cargo test -p snapback4-lang --test presence r1p_ -- --nocapture`

```text
test result: FAILED. 0 passed; 5 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.02s
```

`cargo test -p snapback4-device --test device r1p_ -- --nocapture`

```text
test result: FAILED. 0 passed; 5 failed; 0 ignored; 0 measured; 38 filtered out; finished in 0.15s
```

`cargo test -p snapback4-core --test corpus independent_effect_ids_replace_only_the_frozen_shared_supply_oracle -- --nocapture`

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 16 filtered out; finished in 0.01s
```

`cargo test -p snapback4-lang --test presence --test guide -- --nocapture`

```text
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```

`cargo test -p snapback4-sim --test residency --test clique --test write_authority --test page_admission -- --nocapture`

```text
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.18s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 18.03s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.84s
```

`cargo test -p snapback4-device --test device -- --nocapture`

```text
test result: ok. 43 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.63s
```

`cargo test -p snapback4-core --lib -- --nocapture`

```text
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.09s
```

`cargo test -p snapback4-core --test corpus -- --nocapture`

```text
corpus (Rust server only; no TypeScript/replica conformance claim): 211 passed, 83 skipped, 0 failed
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.04s
```

The one-time comparison commands were
`R1P_MEASURE=/tmp/r1p-evidence/before.json cargo test -p snapback4-lang --test r1p_census measure -- --nocapture`
and the same command with `after.json` under the restored implementation.
Each passed 1 test (1 filtered out), in 8.89 s and 8.85 s respectively.
The exact shared count line is:

```text
census: 1112 mutations; 2224 admission verdicts (2192 admitted); 2114 metered executions
```

The first full `bash snapback4/scripts/test.sh` run reported
`== 2 failure(s) in 124 s`: the obsolete shared-id corpus oracle and the
client group (the intermediate effect-id URL bug plus Chromium). The next
run on the corrected implementation reported 523 Rust passed, 0 failed,
1 ignored; 9/9 fixtures; 136/137 clients, with only Chromium failing:

```text
-- ok: cargo test (84 s)
-- ok: fixture wrapper tests (8 s)
ℹ tests 137
ℹ pass 136
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
-- FAIL: client tests (42 s)
== 2 failure(s) in 114 s
```

Final full run (555 Rust passed, 0 failed, 1 ignored; fixtures 9/9;
client 136 passed, 1 failed):

```text
-- ok: cargo build (0 s)
-- ok: wasm build (1 s)
-- ok: package typecheck (1 s)
-- ok: package build (1 s)
-- ok: chat app check (0 s)
test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.08s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.52s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.41s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.44s
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.37s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.07s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 38 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.57s
test result: ok. 46 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.35s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.40s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.36s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.60s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.57s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.16s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.29s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.03s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.22s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 7 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 4.96s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 23.10s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.68s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
-- ok: cargo test (64 s)
-- ok: chat app typecheck (0 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
-- ok: fixture wrapper tests (6 s)
ℹ tests 137
ℹ pass 136
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
-- FAIL: client tests (40 s)
== 1 failure(s) in 68 s
```

The sole final red is `React hooks and reference-app lifetimes`, Chromium
`SIGABRT` during browser launch inside the sandbox, the environment artifact
named in the lane brief. Its isolated retry, from `snapback4/`, was:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
node --test packages/snapback4/test/react.test.mjs
```

-- FAIL: client tests (42 s)
== 1 failure(s) in 103 s
```

`node --test packages/snapback4/test/react.test.mjs` was retried alone:

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
```

No failure is claimed base-proven pre-existing: the Chromium retry used this
lane's build. The lead's outside-sandbox browser rerun remains necessary for
an entirely green blocking suite. Lifecycle and all other client tests passed;
there was no en-masse timeout requiring a concurrency-2 retry. Implementation
and all requested test cases are complete; no commit, push, tag or publication
was performed.

Measurements: interrupted populations 1, 2, 3, 4, 5, 6, 12 each return 1 row and
0 cursors on all three hosts; completeness is true only at population 1. Scalar
population 5 returns 5, complete true, 0 cursors; population 6 returns 5,
complete false, 0 cursors. The new merge-setup witness returns 12 unique rows in
3 pages (5 + 5 + 2), complete throughout. The owned-and-lost 6-row case returns
5 owned rows and 1 lost-collector row, with 1 owned cursor and complete false.
All 11 changed code files are below 1,500 lines; the largest is the guide at
1,420. The first wasm rebuild measured 1,604,529 B raw and 445,577 B gzip; this
is a build observation, not a before/after performance claim. Learned: scan
lookahead answers whether storage continues, while executed collector flow
answers whether materialized rows were consumed; neither the take bound nor
one sibling's ownership can substitute for the other fact.

Exact diagnostic observations (unchanged by this lane). Before and after
`--fix`, `query q():` followed by `return 1 !== 2` produces:

```text
schema.q:2:14 — E_QUARRY_SYNTAX: expected expression, got "="
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language
schema.q:1:1 — E_QUARRY_SYNTAX: query q has an empty body
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language
```

For `query q():`, `yes = 1 == 1`, `return :`, before `--fix`:

```text
schema.q:2:11 — E_QUARRY_SYNTAX: equality is = in Quarry
  rewrite: = — check --fix applies it
  guide: language
schema.q:3:10 — E_QUARRY_SYNTAX: expected expression, got ":"
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language
```

After the byte-exact `==` → `=` repair (still exits 1):

```text
schema.q:3:10 — E_QUARRY_SYNTAX: expected expression, got ":"
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language
```

Final repository checks:

`./ref-check --verbose`

```text
ref-check: ok — 474 LLP docs, 8847 refs in 22822 files, 0 errors, 0 unchecked
```

`git diff --check` exits 0. All 11 changed code files were counted: zero
over 1,500 lines, maximum 1,420. The final diff contains only the 13 intended
files; the corpus cases and lane R1p's named files are unchanged.

```

Its browser again exited `exitCode=null, signal=SIGABRT` while Playwright
reported `Error: kill EPERM`. This is base-verified at
`fde9623145bfbaba4c1062e64b756a1e7bdb252e`: the baseline client runs also
reach that identical Chromium failure. Those exploratory runs additionally
lacked generated package/wasm artifacts (38 tests: 25 pass, 13 fail; after
package build, 77 tests: 71 pass, 6 fail); their setup failures are not
claimed as product failures. The completed suite builds those artifacts.
The lead's outside-sandbox browser rerun remains necessary. Lifecycle's
12 tests passed; no lifecycle failure is attributed to the base here.
The built wasm is 1,607,844 B raw / 446,719 B gzip.

The root caps command `node scripts/caps.mjs` reports `1 violation.`:
205 oversize files versus the allowed 204, with the smallest overflow
`crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` at 1,504 lines.
A complete `git ls-tree`/`git cat-file` census of base
`fde9623145bfbaba4c1062e64b756a1e7bdb252e` proves the same 205/204 count and
identical offending file. No such file was changed. All 15 changed/new
Rust code files are below 1,500 lines (maximum: guide.rs, 1,418 lines).
No ceilings, value encodings, R1g files or frozen corpus cases changed.
The necessary neighboring constructor change in `bind/actions.rs` only
initializes the new transient presence field. The core corpus adapter and
new positive corpus case are the additional validation files.

Exact diagnostic changes: the admission counterexamples previously had
no diagnostic, and now have the message:

```text
E_STRUCTURAL_FANOUT: probe/for/$r1/0: notes has no cap over the selected group; pin a schema-capped group with a literal bound at least its cap, or use a job chunk
```

The 10-step regression previously refused with message
`steps reached the ceiling 10` at `probe:1:then:1`; it now succeeds with
result `Int(1)`. The two heap cuts retain the verbatim message
`heap bytes reached the ceiling 40`; their sites change from
`where:2:then:1` / `where:2:then:1` to
`probe:2:then:1` / `probe:5:then:1`. Division previously predicted without
a denial; its new device denial message is:

```text
E_PREDICT: site programs.probe.body.3: connected[p] decides fallible division at programs.probe.body.3; queued without a predicted row
```

The server message is unchanged: `E_DIV_ZERO: division by zero`.
No E_/N_ code was introduced, so `guide::CODES` needs no new entry.

Exploratory command mistakes were corrected: two early Cargo invocations
used the root and stopped before building because its Ibex dependency was
unavailable; two output-wrapper commands assigned zsh's read-only `status`
after their tests completed; an intermediate failure-collection edit hit
a Rust borrow error and was corrected before the final base and green runs.
None is reported as a product or inherited failure. The implementation
lesson is that effect-only dataflow needs three independent proofs:
persistent outputs, refusal/totality and metered cost. Expression ownership
belongs to the compiler's analysis; moving it into executed IR silently
changes consumers that never opted into the new analysis.

Final verification after the complete regression edits repeated
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH` and
`bash snapback4/scripts/test.sh` from the repository root. All 523 Rust
tests passed (1 ignored); the worker test passed; the only failure remained
the isolated/base-verified Chromium launch:

```text
-- ok: cargo test (83 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
-- ok: fixture wrapper tests (7 s)
ℹ tests 137
ℹ pass 136
ℹ fail 1
-- FAIL: client tests (41 s)
== 1 failure(s) in 101 s
```

Root `./ref-check --verbose` and `git diff --check` passed:

```text
ref-check: ok — 474 LLP docs, 8849 refs in 22825 files, 0 errors, 0 unchecked
```

No implementation work is deferred; the remaining external verification is
Chromium outside this sandbox. The inherited root caps overflow remains
untouched. The final working tree contains only the 19 intended lane files.

## 2026-09-14 — R2g: page loss survives repeated execution; auxiliary traversals keep the returned page whole

Base: `56cdedba6a8ff343c8d297b246b7431824ef0241`. Read the GPT re-check's A and B and R1g's entry.
Reproduced both findings on the server, SQLite device and memory device before
changing the runtime. No binder setup/residency files, meter ceilings,
serialized value/IR forms or existing corpus cases changed.

The runner now retains one monotone bit for loss from replaced executions.
All plain, matching, empty-matching and merge page registrations use the same
replacement method: an earlier interruption or continuation survives the
replacement. The returned site's final execution still supplies `next`; it
never takes custody of an earlier execution's cursor. The same loss predicate
continues to drive server, local, native and retained-history classification.

The page plan filters exiting loops by backward flow from returned values,
including aliases, selected record fields and enclosing loops. Only writes
that contribute to that result make a loop a collector. An auxiliary traversal
can break without interrupting its intact returned source. A separate returned
collector of that source still records its own loss. Growing field paths in
loop-carried serialized IR widen to the whole variable so analysis terminates;
queries with no candidate exiting page collector skip this analysis.

| Finding | Reproduced (test, red output) | Fix | Green |
| --- | --- | --- | --- |
| A: earlier interruption replaced | `interrupted_twice_4_1` and `interrupted_twice_5_0`, server and both stores; `interruptedTwice/[4, 1]: rows=2, next=false, complete=true` | Remember loss before replacing the site's page | 4/1: 2 rows, no cursor, incomplete; 5/0: 1 row, no cursor, incomplete; 0/5 stays incomplete; 1/1 stays complete |
| A: earlier continuation replaced | `repeated_count_loses_first_cursor` and `repeated_owned_site_keeps_only_last_cursor`, server and both stores | A final execution cannot own an earlier cursor | Scalar 6/0 incomplete; exhausted 5/0 complete; owned-site controls keep the final cursor byte-for-byte |
| B: intact returned page poisoned | `still_whole_4`, `_5`, `_6`, server and both stores; `stillWhole/[4, 0]: rows=4, next=false, complete=false` | Only returned-value collectors register interruption | 4/5 rows complete without cursor; 6 rows return 5, with cursor and complete under the existing owned-page rule |
| B: auxiliary values hidden behind aliases | `auxiliary_field`, server and both stores, failed the first implementation | Track selected record fields through aliases | `return alias.rows` ignores the broken collector in `alias.unused` |

The positive cases include an auxiliary loop that finishes, an auxiliary loop
that builds an unused array and breaks, a collector overwritten before return,
a different returned collector from the same page, and both the intact page
and that partial collector returned together. All R1g controls remain: the
short collector populations, lost sibling, exact-five scalar, helper inside
merge setup, early/nested helper returns and program return from a loop.
The repeated-owner witness reuses a compiled scan's exact static site in IR
before returning its final execution; cases are 4/7, 6/1, 6/7, 7/0 and 0/7.

The generated oracle enumerates 12 combinations of 0–2 loops, break/no break
and returned/auxiliary traversal, with 0–7 rows in each of two scopes: 768
cases per host, 2,304 total. It independently enumerates the input row IDs,
models emitted rows and cursor coverage, and asserts both implications of
completeness plus exact output order and cursor presence. It does not read
runtime loss flags or the ownership plan. All 2,304 pass.

Targeted commands run from `snapback4/`. Summaries are verbatim.

`cargo test -p snapback4-sim -p snapback4-device --test helper_pages --no-fail-fast -- --nocapture`

Base runtime with the expanded regression suite (device, server):

```text
test result: FAILED. 62 passed; 20 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.11s
test result: FAILED. 29 passed; 10 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.30s
```

Final (device, server; the selected-field case adds two device tests and one
server test after the base run above):

```text
test result: ok. 84 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 22.42s
test result: ok. 40 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.00s
```

`cargo test -p snapback4-sim -p snapback4-device --test helper_pages auxiliary_field --no-fail-fast -- --nocapture`

First implementation, then field-sensitive correction:

```text
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 82 filtered out; finished in 0.02s
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 39 filtered out; finished in 0.01s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 82 filtered out; finished in 0.03s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 39 filtered out; finished in 0.01s
```

`cargo test -p snapback4-device --test retained_history --test native_reads --no-fail-fast -- --nocapture`

```text
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.82s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.41s
```

`cargo test -p snapback4-core --test corpus -- --nocapture`

```text
corpus (Rust server only; no TypeScript/replica conformance claim): 211 passed, 83 skipped, 0 failed
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.29s
```

`cargo test -p snapback4-lang --test guide -- --nocapture`


## 2026-09-14 — Lane C: complete device Following, measured before choosing

Implemented LLP 3000.007 §20.3 (S14/S15) from base
`33b530d41b00f1d685656f360e37c52ec1255ad6`. The feeds card and package README
now carry the same complete hybrid recipe: ordinary accounts push private
entries, the 51st follower promotes future events to a shared public table,
follow backfills 200 recent events, and unfollow purges private entries and
the pull lane atomically. Own posts and attributed reposts appear; repeated
follow, unfollow and repost calls are idempotent. The original ranked-feed
recipe is unchanged. The recipe's Following operation is certified `device`.

Two small additions support the recipe: a same-shaped named-table merge
lane with a shared cursor, and `cap N` without `by` for a whole-table cap.
The language card compiles and runs both forms. The runtime still applies
each table's read rule; no union audience, exact horizon maintenance, job
framework, meter increase or serialized value/cursor change was introduced.
The earlier private-group prototype hit the existing grant guard and was
rejected without weakening it.

### Measured alternatives

The simulator has 1,000 authors, 50,000 source events, 1,415 follow edges,
independent 0/1/5/500-follow readers, a celebrity with 900 followers and 200
posts, a celebrity-plus-four reader, and an ordinary five-follower writer.
Latencies are nearest-rank p95 of 20 runs after three warm-ups, on the shared
host. Index entries use the existing meter counter; plain scans charge rows
examined instead. Fixture acquisition temporarily omits caps for bulk seed,
then adopts the original schema and validates all constraints before any
measured operation. Cold counts are actual snapshot rows.

| Candidate | Follows | Examined | Index entries | Fill | Complete | Cold rows | Read p95 ms |
|---|---:|---:|---:|---:|---|---:|---:|
| Merge on read | 0 | 22 | 0 | 20/20 | true | 51415 | 0.357 |
| Merge on read | 1 | 45 | 0 | 20/20 | true | 51415 | 0.544 |
| Merge on read | 5 | 137 | 0 | 20/20 | true | 51415 | 1.325 |
| Merge on read | 500 | 1542 | 0 | 20/20 | true | 51415 | 16.690 |
| Merge on read | 5 (celebrity + 4) | 137 | 0 | 20/20 | true | 51415 | 1.275 |
| Fan-out on write | 0 | 21 | 0 | 20/20 | true | 50 | 0.499 |
| Fan-out on write | 1 | 21 | 0 | 20/20 | true | 100 | 0.530 |
| Fan-out on write | 5 | 21 | 0 | 20/20 | true | 300 | 0.499 |
| Fan-out on write | 500 | 21 | 0 | 20/20 | true | 25050 | 0.506 |
| Fan-out on write | 5 (celebrity + 4) | 21 | 0 | 20/20 | true | 450 | 0.399 |
| Hybrid | 0 | 22 | 0 | 20/20 | true | 250 | 0.550 |
| Hybrid | 1 | 22 | 0 | 20/20 | true | 300 | 3.775 |
| Hybrid | 5 | 22 | 0 | 20/20 | true | 500 | 0.570 |
| Hybrid | 500 | 22 | 0 | 20/20 | true | 25250 | 0.550 |
| Hybrid | 5 (celebrity + 4) | 45 | 0 | 20/20 | true | 451 | 3.320 |

| Candidate | Followers of writer | Examined | Index entries | Rows written | Acknowledgement p95 ms |
|---|---:|---:|---:|---:|---:|
| Merge on read | 5 | 1 | 6 | 1 | 2.800 |
| Merge on read | 900 | 1 | 6 | 1 | 2.803 |
| Fan-out on write | 5 | 7 | 47 | 7 | 3.068 |
| Fan-out on write | 900 | 902 | 6312 | 902 | 244.318 |
| Hybrid | 5 | 7 | 47 | 7 | 4.556 |
| Hybrid | 900 | 1 | 11 | 2 | 3.144 |


The unscoped filter reproduced the defect: zero follows examined 8,193 rows
for 4/20 results, one follow 8,193 for 8/20, both `complete: false`; five
follows needed 7,969 examined to fill 20. Merge-on-read filled pages but the
500-follow read cost 12.60× the five-follow read; full fan-out made the
celebrity acknowledgement 79.63× the ordinary acknowledgement. The hybrid
keeps a dense reader at 22 examined and a celebrity post at two writes.

The first hybrid wall-time set above had host-load outliers, including a
3.775 ms one-follow read with the same 22 examined as the 0.550 ms dense
read. Its celebrity ratio did not pass. An isolated hybrid repeat retained
the same complete pages, cold counts and meter counts, and measured p95
reads of 0.364 / 0.343 / 0.356 / 0.373 / 0.577 ms for 0 / 1 / 5 / 500 /
celebrity-plus-four follows. Ordinary/celebrity write p95s were 1.664 /
0.637 ms. The three ratios were 1.05× dense/5, 1.62× celebrity/5 and 0.38×
celebrity/ordinary-write. Both the first sample and repeat are retained;
regressions assert deterministic cost and correctness rather than shared-host
timing thresholds.

The 220-post lifecycle regression backfilled precisely the latest 200:
207 examined / 1,405 index entries / 201 written including the follow edge.
Unfollow purged those 200 entries plus the edge at 204 / 1,003 / 201, while
preserving the reader's own original and repost. It paged across promotion
and refollow without duplicates. Both device stores matched server IDs and
cursors for up to three scale pages, including an empty reader, and consumed
streamed follow/repost/unfollow changes. Dense cold acquisition of 25,250
rows took 3,130.977 ms on SQLite and 2,826.078 ms on memory, following a
765.905 ms server snapshot.

Limits are explicit: 1,000 follows/account, 1,000 source events/actor,
50,000 private entries/reader, 32 pulled authors/reader and 32,000 broadcast
entries total. Reaching a cap refuses the write atomically. Devices hold
private inboxes and the public broadcast table in full; the latter adds 200
rows at this envelope even to an empty reader. These costs buy complete
local answers without depending on an exhausted horizon. The 200-event
backfill is recent history, not unlimited history; archive or redesign
before exceeding the caps.

### Regression evidence and commands

All Cargo commands below ran from `snapback4/`. Node/Bun and the root suite
used `export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`.

`cargo test -p snapback4-lang --test sparse_filter -- --nocapture`, before
and after:

```text
test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`cargo test -p snapback4-lang --test feed_forms -- --nocapture`, with the
six affected parser/binder/core implementation files read from the named
base, then restored (no git reset/checkout):

```text
test result: FAILED. 0 passed; 3 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`cargo test -p snapback4-lang --test feed_forms --test sparse_filter --test guide -- --nocapture`, after:

```text
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`cargo test -p snapback4-lang --test guide`:


## 2026-09-14 — lane D-design: filtered, bucketed and ordered maintains (LLP 3000.007 §20.9)

Built a proposal in LLP 3000.007 §20.9 and an opt-in measurement in
`crates/snapback4-sim/tests/maintain_measurement.rs`; no production code,
parser, guide, README, value serialization, ceiling or existing corpus case
changed. Base: `56cdedba6a8ff343c8d297b246b7431824ef0241`.

Orientation: LLP 3000 §6–§7 (seven invariants, current expiry and delivery
semantics), LLP 3000.007 §6, §8, §14, §18 and §20 (residency, explicit
aggregate disclosure, accepted rulings and evidence), and LLP 3000.004
(the rank recipe) govern this proposal. The current maintain schema, write,
live-read, successor and activation paths were read alongside the language
card and package README. `NOT-DOING.md` keeps jobs bounded and rules out
exact horizon maintenance, time in rules, relevance scoring and a second
language. No review or author acceptance is claimed; the hand-off is to the
author for the four questions in §20.9.7, then to the implementation lane.

Proposed: a closed row-local filter; UTC day/hour and literal-duration
buckets; ordinary bounded row pages over multi-column maintains for reaction
chips; ordinary value indexes for non-expiring maintained groups. The existing
source cap bounds the number of distinct chip rows. Full-key maintain reads
stay scalar. The value index reuses the store's existing target-write path;
`maintain top N` would need that candidate index anyway after a winner falls.
Exact trailing-day Trending with zero-like candidates, joins for author
attribution, and per-recipient unread watermarks remain explicit recipes.
The readable aggregate is still a declared disclosure channel, including
filter and computed-key membership; a filter is not anonymization.

What I learned: a paged rebuild is not yet bounded adoption. The base scans
256 rows at a time but keeps all group totals in a map and publishes using an
unbounded meter in one transaction. The proposal prepares disk-backed target
state in bounded durable chunks and publishes the generation once, with a
write pause pending the author's ruling. The other questions are the rank
scope, incomplete read-only `check` assessment, and whether aggregate retention
should continue to default to until-revoked when its source retains history.
No acceptable write-pause duration is inferred from a debug memory store.

The read-only Clique evidence's 366,624 row writes / 1,047 chunks belong to
`insights.backfill`, including derived writes; they are not distinct source
rows or the separate reaction-cache job. The shortened digest's 120,000 ms
period at epoch origin is why the closed key set includes a literal bucket
rather than just calendar days. Counts do not replace lists of reactors or
cross-row unread logic.

### Measurement numbers

Command, from `snapback4/`:

```sh
cargo test -p snapback4-sim --test maintain_measurement -- --ignored --nocapture > /private/tmp/lane-d-maintain-measurement.log 2>&1
```

One run, debug, SQLite `:memory:`, no sync, 1,000 group ids, small synthetic
rows, on the shared loaded host (partly concurrent with the full suite).
Every mode seeds an independent store before timing adoption. `none` adopts
an identical schema and is an identity/no-op control, not a scan baseline.
`filter_proxy` uses a stored 0/1 flag (75% true seed rows); `key_proxy` uses
that flag plus a stored bucket. Neither measures the unimplemented predicate
or bucket evaluator. Chips have 100,000 distinct groups across 50,000 item
ids; the value index is added to that existing compiled schema only inside
the measurement. It does not become a parser feature.

| Source | Source rows | Mode | Target rows | Adoption ms |
| --- | ---: | --- | ---: | ---: |
| posts | 50000 | none | 0 | 0.533 |
| posts | 50000 | count | 1000 | 2337.643 |
| posts | 50000 | filter_proxy | 750 | 2360.927 |
| posts | 50000 | key_proxy | 37500 | 4716.384 |
| messages | 100000 | none | 0 | 0.467 |
| messages | 100000 | count | 1000 | 4967.736 |
| messages | 100000 | filter_proxy | 750 | 5272.848 |
| messages | 100000 | key_proxy | 75000 | 9678.313 |
| reactions | 100000 | none | 0 | 0.618 |
| reactions | 100000 | chips | 100000 | 12757.363 |
| reactions | 100000 | rank_index | 100000 | 12120.141 |

Per-write times are µs, 200 observations per operation/mode. `move` changes
group, bucket, flag to false, and emoji; for chips it deletes/creates a group,
not an in-place value increment. The meters below are the last actual sample,
including source work. Their current aggregate internals are not completely
charged; §20.9 specifies the additional accounting the new paths need.

| Source | Mode | Operation | p50 µs | p95 µs | Last sample meters |
| --- | --- | --- | ---: | ---: | --- |
| posts | none | add | 100.334 | 169.458 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":13,"heap_bytes":1379,"output_bytes":169,"rows_written":1}` |
| posts | none | move | 132.708 | 200.833 | `{"examined":1,"index_entries":2,"rule_probes":0,"steps":12,"heap_bytes":1788,"output_bytes":170,"rows_written":1}` |
| posts | none | remove | 63.167 | 102.833 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":6,"heap_bytes":40,"output_bytes":6,"rows_written":1}` |
| posts | count | add | 114.041 | 153.041 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":13,"heap_bytes":1379,"output_bytes":169,"rows_written":2}` |
| posts | count | move | 178.125 | 237.167 | `{"examined":1,"index_entries":2,"rule_probes":0,"steps":12,"heap_bytes":1788,"output_bytes":170,"rows_written":3}` |
| posts | count | remove | 89.791 | 117.750 | `{"examined":0,"index_entries":4,"rule_probes":0,"steps":6,"heap_bytes":40,"output_bytes":6,"rows_written":2}` |
| posts | filter_proxy | add | 128.083 | 214.209 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":13,"heap_bytes":1379,"output_bytes":169,"rows_written":2}` |
| posts | filter_proxy | move | 158.417 | 232.625 | `{"examined":1,"index_entries":4,"rule_probes":0,"steps":12,"heap_bytes":1788,"output_bytes":170,"rows_written":2}` |
| posts | filter_proxy | remove | 70.042 | 118.459 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":6,"heap_bytes":40,"output_bytes":6,"rows_written":1}` |
| posts | key_proxy | add | 133.917 | 214.917 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":13,"heap_bytes":1379,"output_bytes":169,"rows_written":2}` |
| posts | key_proxy | move | 173.791 | 278.917 | `{"examined":1,"index_entries":4,"rule_probes":0,"steps":12,"heap_bytes":1788,"output_bytes":170,"rows_written":2}` |
| posts | key_proxy | remove | 68.625 | 141.125 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":6,"heap_bytes":40,"output_bytes":6,"rows_written":1}` |
| messages | none | add | 94.000 | 149.833 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":13,"heap_bytes":1379,"output_bytes":169,"rows_written":1}` |
| messages | none | move | 131.333 | 212.375 | `{"examined":1,"index_entries":2,"rule_probes":0,"steps":12,"heap_bytes":1788,"output_bytes":170,"rows_written":1}` |
| messages | none | remove | 62.750 | 125.958 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":6,"heap_bytes":40,"output_bytes":6,"rows_written":1}` |
| messages | count | add | 121.750 | 175.250 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":13,"heap_bytes":1379,"output_bytes":169,"rows_written":2}` |
| messages | count | move | 179.417 | 264.250 | `{"examined":1,"index_entries":2,"rule_probes":0,"steps":12,"heap_bytes":1788,"output_bytes":170,"rows_written":3}` |
| messages | count | remove | 82.291 | 148.875 | `{"examined":0,"index_entries":4,"rule_probes":0,"steps":6,"heap_bytes":40,"output_bytes":6,"rows_written":2}` |
| messages | filter_proxy | add | 129.792 | 225.459 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":13,"heap_bytes":1379,"output_bytes":169,"rows_written":2}` |
| messages | filter_proxy | move | 165.792 | 251.792 | `{"examined":1,"index_entries":4,"rule_probes":0,"steps":12,"heap_bytes":1788,"output_bytes":170,"rows_written":2}` |
| messages | filter_proxy | remove | 69.208 | 109.125 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":6,"heap_bytes":40,"output_bytes":6,"rows_written":1}` |
| messages | key_proxy | add | 167.875 | 279.375 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":13,"heap_bytes":1379,"output_bytes":169,"rows_written":2}` |
| messages | key_proxy | move | 218.291 | 361.792 | `{"examined":1,"index_entries":4,"rule_probes":0,"steps":12,"heap_bytes":1788,"output_bytes":170,"rows_written":2}` |
| messages | key_proxy | remove | 77.667 | 99.375 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":6,"heap_bytes":40,"output_bytes":6,"rows_written":1}` |
| reactions | none | add | 125.667 | 149.208 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":13,"heap_bytes":1379,"output_bytes":169,"rows_written":1}` |
| reactions | none | move | 162.292 | 199.542 | `{"examined":1,"index_entries":2,"rule_probes":0,"steps":12,"heap_bytes":1788,"output_bytes":170,"rows_written":1}` |
| reactions | none | remove | 77.542 | 95.709 | `{"examined":0,"index_entries":2,"rule_probes":0,"steps":6,"heap_bytes":40,"output_bytes":6,"rows_written":1}` |
| reactions | chips | add | 145.500 | 201.541 | `{"examined":0,"index_entries":4,"rule_probes":0,"steps":13,"heap_bytes":1379,"output_bytes":169,"rows_written":2}` |
| reactions | chips | move | 211.000 | 376.458 | `{"examined":1,"index_entries":6,"rule_probes":0,"steps":12,"heap_bytes":1788,"output_bytes":170,"rows_written":3}` |
| reactions | chips | remove | 94.625 | 111.917 | `{"examined":0,"index_entries":4,"rule_probes":0,"steps":6,"heap_bytes":40,"output_bytes":6,"rows_written":2}` |
| reactions | rank_index | add | 158.917 | 257.584 | `{"examined":0,"index_entries":5,"rule_probes":0,"steps":13,"heap_bytes":1379,"output_bytes":169,"rows_written":2}` |
| reactions | rank_index | move | 227.125 | 474.333 | `{"examined":1,"index_entries":8,"rule_probes":0,"steps":12,"heap_bytes":1788,"output_bytes":170,"rows_written":3}` |
| reactions | rank_index | remove | 96.333 | 142.875 | `{"examined":0,"index_entries":5,"rule_probes":0,"steps":6,"heap_bytes":40,"output_bytes":6,"rows_written":2}` |

No speedup is claimed from the indexed adoption's lower time in its separate
trial. The sound measurements are its observed work and its reuse of an
existing path. Remaining measurements are explicit in §20.9.5: actual new
forms, value changes, durable/chunk/peak-memory costs, expiry group index,
full fixture distribution, replicated bytes and both device stores. This
prototype adds no regression fix; a red-before/green-after regression is not
applicable to a measurement of unchanged base behavior. The implementation
lane is required to demonstrate that transition for each new behavior.

### Commands and verbatim summaries

The targeted measurement's summary:

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 111.57s
```

Published-surface control, from `snapback4/`:

```sh
cargo test -p snapback4-lang --test guide > /private/tmp/lane-d-guide.log 2>&1
```
```text
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

Fixture-authoring corrections before the valid base reproduction: the
simulator source must be named `schema.q` for bare operation names, a collector
rebound to rows must collect rows rather than integers, and generated device
worlds need distinct stores because snapshot watermarks cannot move backwards.
Those draft-test errors are not counted as product regressions.

No diagnostic or note was added or changed; `guide::CODES` is unchanged.
The README, shape card and LLP 3000.007 §19.2 describe the corrected policy.
No out-of-scope file was touched. No commit, push, tag or publication was made.

Full suite, from the repository root, on Node 24.18.0:


### 2026-09-14 — R2p: baseline lowering with a separate ownership map

Implemented the GPT narrow re-check's section C from lane base
`56cdedba6a8ff343c8d297b246b7431824ef0241`. No commit, push, tag,
publication, sub-agent, clone or remote machine was used. R2g's page files
are untouched. The language surface and diagnostic codes did not change,
so the package README, language cards and `guide::CODES` need no update.
The existing §19.1 sentence about temporary grouping is replaced with the
implemented ownership-map rule; that small LLP edit is the one file outside
the lane's language-crate and journal implementation scope.

The executed binder now has no condition/payload grouping, at any stage.
A private `Body` holds the ordinary statement vector and a separate map
from each setup statement path to its owning `if` condition or `emit`
payload. Buffer concatenation and nesting remap that map, and
`helper_ownership` remaps it across helper-return lowering, including each
separate `not returned` guard. The actual `helper_returns(Vec<Stmt>, ...)`
function is byte-identical to `ce15819ad`. Presence analysis reads the map
only after the final program has been built. No map or grouping is
serialized into the program or read by admission or execution. The
structural argument is erasure: each buffer operation performs exactly the
baseline vector operation regardless of the side map, and recording never
changes temporary names, type refinement, exit analysis or emitted code.
This proves the executed-IR invariant independently of the finite census.

The focused `pick` regression is red on the unmodified base extracted into
scratch: `stop=false/true` costs 28/20 steps with two missing guards. The
fixed program matches the checked baseline bytes and costs 34/26 steps.
At ceiling 28, `pick(false)` formerly succeeded; the baseline and fixed
program refuse with `E_BOUND`, actual steps 29, at
`probe:7:then:1:then:2`. At ceiling 34 the positive case succeeds with result
2. The positive helper-ownership test covers helper calls as a binding, an
emit payload and an if condition, with early returns before presence and
nested short circuits; it checks eligibility and that every charge-plan
site names an actual baseline `If`.

The checked-in differential harness generated 1,225 bundles: GPT's exact
`pick`, 0–3 early returns in `if`, `else if` and `for`, conditions and emit
payloads before/after them, `and`, `or`, `??`, helpers, reads, `new`, source
nesting and helper expansion to depth 3, and mutations and queries. It also
pins all 740 R1p source bundles and asserts every one of R1p's original
1,112 mutation identities remains represented. The final corpus has 3,219
programs, including additional census queries and programs from sources
with schema diagnostics. Six generated argument worlds use step ceilings
10, 28, 34 and 2,000. Both arms start each program with the same fixture
(two rows for generated programs; empty for census programs), fixed time,
entropy and ids, and replay the same calls on that store. Admission uses
both eligible and never policies, frozen to isolate lowering. The live
comparison includes all seven meters, results and complete refusals/sites.

Measured: 6,438 byte-for-byte IR comparisons, 6,438 admission comparisons,
37,376 execution comparisons, **0 differences**. The final targeted
language run took 43.96 s for the differential and its two focused tests;
guide and presence took 0.05 s and 0.02 s. All 22 original presence
negatives, R1p's admission regressions, `send` and `sendBrief` remain green.
The first intermediate census accidentally omitted schema-diagnostic
sources; the permanent 1,112-identity assertion closes that sampling gap.

The golden was generated by extracting the complete language crate from
`ce15819ad71bd24c9d1b9ec228c083330dee3a31` using `git archive`, adapting only
its scratch Cargo manifest, and using the current core serializer. All 27
Rust source files were byte-compared with that commit. No old compiler is
vendored. The golden records IR only; live runtime comparisons share the
current core so engine changes are not mistaken for lowering changes.
Separate scratch targets with `CARGO_INCREMENTAL=0` were used for the final
golden and the red base run: an initial shared target reused an incremental
artifact between extracted packages with the same identity. The retained
`tests/lowering/README.md` and `generate.rs` explain reproduction. Golden
creation passed 1 test in 1.30 s.

SHA-256 evidence:

- `ce15819ad.jsonl` (5,166,923 B): `1867910089cbe47894bbef4592e15cdcdaedce3a017c5836c2b5f51a991bcdee`.
- `r1p-sources.jsonl` (803,295 B): `e05abc8aae7838c72783f89478fc345c71c3f3cb130a5d9976d44cf64376c4f5`.
- `r1p-programs.txt` (79,701 B): `44df5dc8b4a4a31576061c06344320917e6bbfb429db940475ff9fc8fbd6361f`.
- `pick.json` (1,458 B): `43ee10d1cd0339b2587c7bca1c9ed590e9fd77fdc922ffe4d4722d14069ddf02`.

Commands below ran from `snapback4/`, except the explicitly rooted shell
suite and repository checks. Logs and scratch extracts are retained in
`/tmp/r2p-evidence/`. One initial `cargo check -p snapback4-lang` was
accidentally issued at the repository root; it failed to select the package
and built nothing. All actual Cargo builds/tests used the fenced workspace
or the explicit scratch manifest from within that workspace.

Red, against the unmodified exact lane base:

`CARGO_TARGET_DIR=/tmp/r2p-evidence/base-target CARGO_INCREMENTAL=0 cargo test --offline --manifest-path /tmp/r2p-evidence/base/snapback4/crates/snapback4-lang/Cargo.toml --test lowering -- --nocapture`

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```

`cargo test -p snapback4-lang --test lowering --test presence --test guide -- --nocapture`

```text
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
differential: 1225 generated bundles; 740 R1p bundles; 3219 programs; 6438 IR comparisons; 6438 admission comparisons; 37376 execution comparisons; 0 differences
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 43.96s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```

`cargo test -p snapback4-sim --test residency --test clique --test write_authority --test page_admission -- --nocapture`

```text
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.01s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 33.60s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.34s
```

`cargo test -p snapback4-device --test device -- --nocapture`

```text
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.82s
```

`cargo test -p snapback4-core --lib --test corpus -- --nocapture`

```text
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.68s
corpus (Rust server only; no TypeScript/replica conformance claim): 211 passed, 83 skipped, 0 failed
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.55s
```

The unchanged conformance corpus was not edited. `git diff --check` passed.
The repository-wide `node scripts/caps.mjs` reported `1 violation.`: 205
oversize files against baseline 204, naming the Snapback 1 file
`crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` at 1,504 lines.
A `git ls-tree`/`git cat-file` census of exact base
`56cdedba6a8ff343c8d297b246b7431824ef0241` independently found the same 205
oversize source blobs and the same 1,504-line overflow. All 12 added or
modified Rust files here are below the cap; the largest is `program.rs`,
906 lines by caps' newline-splitting convention.

Full suite, from the repository root with Node 24.18.0 first on PATH:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
bash snapback4/scripts/test.sh
```

The first pass completed before the selected-field refinement; the second
uses the final source. Both report only the sandbox Chromium failure.

First pass: Rust totals 621 passed, 0 failed, 1 ignored.

```text
-- ok: cargo test (178 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ tests 137
ℹ pass 136
ℹ fail 1
-- FAIL: client tests (44 s)
== 1 failure(s) in 205 s
```

Final pass: Rust totals 624 passed, 0 failed, 1 ignored.

```text
-- ok: cargo test (163 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0

## 2026-09-14 — Lane F: provable upsert absence and service read grants

Built LLP 3000.007 §20.5 and §20.6 on base
`56cdedba6a8ff343c8d297b246b7431824ef0241`. A device now predicts the
insert arm of an absent upsert when its synced group has no horizon and
its key proves readability. The shared prefix/deciding-field analysis
proves public and viewer-keyed rows directly; a pinned membership rule
also needs a positive local witness. The synthetic proof row is never
passed through the held-row read shortcut, and retained groups cannot
supply whole-group absence. Horizons, unpinned readability, online-only
targets and an unestablished membership still queue without a row.
Both engine upsert paths use the proof; update misses keep their existing
behavior. No meter ceiling or serialized value form changed.

Service equality disjuncts are removed only for audience inference and
validation, in the shared core rule helper also used by partition binding.
The original read rule still admits the service on the server. Other
extra disjuncts retain E_SYNC and its rewrite. Residency and why report
insert-arm eligibility and service grants. No prediction card was on this
base, so the writes, rules and services cards carry the new sentences.
The feeds vote recipe now holds its full vote group, capped at 1,000 votes
per principal, and predicts a first offline vote when the post is held.
README sync/services/write text follows the cards. The one neighboring
scope edit is NOT-DOING's clarification that service grants are not union
device audiences. No client implementation, presence analysis, corpus
case, unrelated lane file, commit, push, tag or publication was changed.

Measured: a first offline like changes from 0 predicted rows to 1 on both
SQLite and memory, with identical application fields at the server (the
local row additionally has `pending: true`), including reopen and
settlement. The five public/owner/horizon/unpinned/online cases run on both
stores (10 scenarios); pinned membership has held/unheld controls on both
stores (4 scenarios). Two admitted hidden worlds compare the complete
existing observation helper, including all seven meter fields, first and
retry bodies, receipt, committed changes, effects, snapshots, streams and
both device lifecycles; the earlier absent/hidden device pairs also pass.
The feeds card predicts 2 rows: the vote and its maintained score. Service
reads change from 0 to 1 visible message; three ordinary viewers under
one and two service grants have 0 byte differences in full snapshots,
paginated snapshots and streams. The namespace refusal is retained and
the service bearer reads the private message over `/q`.

Regression evidence (Cargo commands run from `snapback4/`). The final
regressions were also run with the changed production sources temporarily
restored from the exact base above, then all lane files restored. Their
red summaries were:

```text
cargo test -p snapback4-device --test device upsert -- --nocapture
test result: FAILED. 2 passed; 3 failed; 0 ignored; 0 measured; 44 filtered out; finished in 0.08s
cargo test -p snapback4-sim --test residency -- --nocapture
test result: FAILED. 7 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
cargo test -p snapback4 --test check upsert_insert_proof -- --nocapture
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 11 filtered out; finished in 2.19s
cargo test -p snapback4 --test lifecycle service_read_disjunct -- --nocapture
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 12 filtered out; finished in 0.00s
```

The lifecycle red was captured before the implementation, at the same
base. Green targeted summaries:

```text
cargo test -p snapback4-device --test device upsert -- --nocapture
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 44 filtered out; finished in 0.18s
cargo test -p snapback4-sim --test residency -- --nocapture
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
cargo test -p snapback4 --test check upsert_insert_proof -- --nocapture
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 11 filtered out; finished in 2.06s
cargo test -p snapback4 --test lifecycle service_read_disjunct -- --nocapture
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out; finished in 3.30s
cargo test -p snapback4-lang --test guide
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
cargo test -p snapback4-device --test device --test write_authority
test result: ok. 49 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.61s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.29s
cargo test -p snapback4-sim --test residency --test write_authority
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 9.67s
```

From the repository root, with the required pinned Node runtime:

```text
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
bash snapback4/scripts/test.sh
-- ok: cargo build (8 s)
-- ok: wasm build (18 s)
-- ok: package typecheck (2 s)
-- ok: package build (3 s)
-- ok: chat app check (1 s)
-- ok: cargo test (184 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (2 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
-- ok: fixture wrapper tests (14 s)
ℹ tests 137
ℹ pass 136
ℹ fail 1
-- FAIL: client tests (49 s)
== 1 failure(s) in 192 s
```

Isolated reproduction, from `snapback4/`:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
node --test packages/snapback4/test/react.test.mjs
```

The 47 Rust summaries total **570 passed, 0 failed, 1 ignored**. All host
lifecycle tests passed in this run. Fixtures passed 9/9. The client group
passed 136/137; its sole failure is the known Chromium `SIGABRT` at browser
launch in `react.test.mjs`, before any backend or rendered app is run.
Verbatim stage and count summaries:

```text
-- ok: cargo build (12 s)
-- ok: wasm build (15 s)
-- ok: package typecheck (1 s)
-- ok: package build (1 s)
-- ok: chat app check (2 s)
-- ok: cargo test (163 s)

`cargo test -p snapback4-sim --test clique following -- --nocapture`:

```text
test result: ok. 4 passed; 0 failed; 1 ignored; 0 measured; 29 filtered out; finished in 32.82s
```

`cargo test -p snapback4-device --test device following -- --nocapture`:

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 44 filtered out; finished in 40.61s
```

`cargo test -p snapback4-sim --test clique following_candidates_at_scale -- --ignored --nocapture`:

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 33 filtered out; finished in 141.50s
```

`SB4_FEED_CANDIDATE=hybrid cargo test -p snapback4-sim --test clique following_candidates_at_scale -- --ignored --nocapture`:

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 33 filtered out; finished in 28.05s
```

The old feeds card also failed its new positive lifecycle regression before
the recipe change (`cargo test -p snapback4-sim --test following -- --nocapture`,
before the test moved into the existing `clique` suite):

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

The failure was `UnknownOp("register")`; the new card's compiled follow
lifecycle is among the four green Following tests above.

### Exact diagnostics

The unscoped `.actor = viewer` scan previously produced no diagnostic or
note. It now produces:

```text
schema.q:9:57 — N_SPARSE_FILTER: entries by byTime: this unscoped `where` pins no index prefix; sparse matches can exhaust the row meter and return short `complete: false` pages
  rewrite: pin a leading index key, or use the Following recipe in `snapback4 guide feeds` for followed authors, own posts and reposts
  guide: feeds
```

The note is registered in `guide::CODES`. Positive scoped, seek, prefix-pinned
and constant-filter regressions receive no sparse note; the feeds recipes
and README compile without any note. An OR avoids the note only if both
branches pin the leading index column. Before the two language additions,
the parser messages were `cap requires non-empty grouping columns` and
`expected "[", got "shared"`; the successful forms now have no diagnostic.


### Final verification and remaining environment failure

The final root command `bash snapback4/scripts/test.sh` (with the pinned
Node PATH above) passed all 578 Rust tests (2 ignored), all 9 fixture wrapper
tests, builds and app/package typechecks. The only remaining failure is the
Chromium launch in the React test:

```text
-- ok: cargo build (1 s)
-- ok: wasm build (1 s)
-- ok: package typecheck (0 s)
-- ok: package build (1 s)
-- ok: chat app check (1 s)
-- ok: cargo test (160 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9

Full suite, from the repository root:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
bash snapback4/scripts/test.sh > /private/tmp/lane-d-full-suite.log 2>&1
```

All Rust test summaries and the script/fixture/client summaries, verbatim:

```text
== cargo build
-- ok: cargo build (11 s)
== wasm build
-- ok: wasm build (15 s)
== package typecheck
-- ok: package typecheck (1 s)
== package build
-- ok: package build (1 s)
== chat app check
-- ok: chat app check (1 s)
== cargo test
test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.06s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.22s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.42s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.45s
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.30s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.17s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.65s
test result: ok. 46 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.25s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.80s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.35s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.72s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.58s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.19s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.24s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.65s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.82s
test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 7 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 4.83s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 24.55s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.42s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
-- ok: cargo test (118 s)
== chat app typecheck
-- ok: chat app typecheck (1 s)
== expo app typecheck
-- ok: expo app typecheck (1 s)
== fixture wrapper tests
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0


## 2026-09-14 — A1: a word finds its card, and prediction has one

Implemented LLP 3000.007 §20.1 against base
`33b530d41b00f1d685656f360e37c52ec1255ad6`. The guide has 25 canonical
cards and 35 aliases in one table beside KEYWORDS. Lookup prints a card
on stdout; a miss prints three distinct nearest cards (substring and edit
distance over keywords and aliases), the keyword/alias list, and exits 1.
Bare `guide` lists the vocabulary; `guide language` prints the language card.
The existing personas card already covers SQL inspection, so sql/inspect
resolve there. Evolution is a short card from README §5.

Inventory rows closed within this lane: **S01** (discovery and prediction
card), **S19** (retry-id versus redundant horizon guards), **S20 docs**
(upsert misses and the compiled set-state alternative), **S21 recipe**
(per-conversation server ordinals and cursor paging), **S04** (availability
query, first post-signup profile mutation and recoverable null-profile
onboarding). **S13's card portion** is answered; its always-on summary is
B2's work and is absent on this base. The inventory and builder evidence
were read in place; neither external checkout was modified.

The prediction card distinguishes held/horizon/server sites and static
eligibility from a call's outcome. Its examples prove eligible draft,
message and effect-only-presence writes, versus never-predicting online-only
maintain and fallible-presence writes. Existing upsert recipes retain their
semantics and gain their prediction limit. A stable mutation id dedupes a
retry for a principal; reusing a row id with a fresh mutation id is not the
same guarantee. The boolean set-state alternative uses insert-if-absent and
an existence-guarded delete over a complete viewer partition.

Measurements: 4 new compiled Quarry blocks (2 prediction, 1 arrival order,
1 onboarding), 1 new TypeScript block, 12 README TypeScript blocks checking
36 public functions. The ordinal witness sends 51 messages with the same
millisecond and reverse-ordered row ids, retries all 51 mutations, and reads
50 + 1 rows with ordinals 51 through 1. The onboarding witness observes a
taken handle, a null profile after the race, then a successful profile under
the same principal. The set-state witness executes 6 set/clear calls in the
prediction interpreter and 6 on the server, including an initial clear,
a first like and repeated set/clear. Largest changed code file: guide.rs,
1,383 lines by caps' split-on-newline convention (1,382 newline characters),
down from 1,424. The writes card moved byte-for-byte into guide/writes.rs
before its additions; existing Markdown prose was not compressed or reflowed.

Targeted commands run from `snapback4/`; every JS command used
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH` first.

`cargo test -p snapback4-lang --test guide`, before implementation and final:

```text
test result: FAILED. 9 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
```

Intermediate guide passes had 12 and 14 passing tests respectively, each
with 0 failed in 0.04s. `cargo test -p snapback4 --test check guide_`,
before implementation and after:

```text
test result: FAILED. 0 passed; 3 failed; 0 ignored; 0 measured; 11 filtered out; finished in 1.05s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 11 filtered out; finished in 1.04s
```

Final review added `cargo test -p snapback4-lang --test guide set_state_recipe`
before fixing the new recipe's missing clear guard, then after:

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 14 filtered out; finished in 0.01s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 14 filtered out; finished in 0.00s
```

The unguarded clear refused `NOT_FOUND` at `schema.q:15:5`; the corrected
recipe completes all 6 calls on each interpreter. That is an application
recipe correction, with no runtime or diagnostic change.

`node --test packages/snapback4/test/readme-examples.test.mjs` initially
reported 2 tests, 1 pass, 1 fail: the draft used read/write instead of the
client's query/mutate, and the generated wasm module had not been built.
After correcting those calls and running `bash scripts/build-wasm.sh`
(`wasm 1608850 B raw, 447107 B gzip`), the same command reported:

```text
ℹ 12 README blocks; 36 public functions; 734.10 ms
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

One wrongly rooted Cargo invocation stopped before building; it was rerun
from snapback4. One test append used a doubly prefixed path and ran a filter
matching 0 tests; the path was corrected. An exploratory test used the
nonexistent Ceilings::mutation constructor, corrected to the unchanged
Ceilings::default before the red/green witness above. None is a product or
inherited failure.

From the repository root, with Node 24 on PATH:
`bash snapback4/scripts/test.sh`. First run: 575 Rust tests passed, 0 failed,
1 ignored; final run after the clear-guard regression: 576 passed, 0 failed,
1 ignored. Both runs built wasm, typechecked/built the package and checked
both apps. Verbatim first/final summaries:

```text
-- ok: cargo test (121 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
-- ok: fixture wrapper tests (7 s)
ℹ tests 137
ℹ pass 136
ℹ fail 1
-- FAIL: client tests (41 s)
== 1 failure(s) in 125 s

-- ok: cargo test (108 s)


## 2026-09-14 — Lane E: a queued web write survives navigation (S29)

Implemented LLP 3000.007 §20.4 against base
`33b530d41b00f1d685656f360e37c52ec1255ad6`. Read the inventory's S29,
the 0.2.12 run's epoch 1789409378 and `m3-choreo.txt` (under its
0.2.11-named lane directory), and the 0.2.6 Astra diary's M3: both
builders routed administrative writes around the local client to survive
navigation. The Node reproduction uses fake page events, the real wasm
device, and a real `snapback4 dev` HTTP server. Before the fix it measured
2 durable admissions, 0 exit requests, 0 server rows before reopen, and
2 rows only after reopening the device. After the fix it measured 2 exit
requests and 2 rows before reopen; explicit duplicate HTTP requests and
reopening with the same mutation IDs left exactly 2 rows.

The web device already awaited `save` before returning an admission, and
IndexedDB `save` already awaited transaction completion. Its read/write
transactions now request strict durability. A synchronous view of committed
outbox entries changes only after a successful save; a failed save stops
further device calls so a drained but uncommitted admission cannot leak
into either transport. Pagehide and hidden visibility dispatch committed
unsent writes with authenticated fetch keepalive, without the ordinary
client's abort signal. Closing unregisters the hooks without cancelling
requests already dispatched. No Node process-device or Expo implementation
changed. The synchronous web hook advances the device send revision before
each dispatch wave, so a sync already in flight cannot apply an older
receipt on a resumed page; metadata persistence stays ordered behind any
current IndexedDB transaction. Settlement stays with ordinary sends and
sync receipts, so the next page reuses the same mutation IDs.

Keepalive counts UTF-8 JSON body bytes across these clients in the same
module instance. The test measured 64,082 bytes across 2 concurrent
requests against the 65,536-byte browser budget; 2 further requests
(including another client's) dispatched as quota was released. Larger
queues split into waves while the page can still run. A single atomic
mutation over 65,536 bytes cannot be split across the existing `/m`
endpoint, and the page may disappear before a subsequent wave starts;
those entries remain durable for ordinary sends or reopening. Other page
libraries can also consume the browser quota. Beacon is not a fallback:
it cannot attach the endpoint's bearer/persona headers and shares the
keepalive quota. The README and writes card state the bounded behavior.
No E_/N_ code or diagnostic text was added or changed.

Added `witness/navigation.mjs`: it checks actual IndexedDB admissions,
performs a full navigation to about:blank, queries the server before
opening another device, and checks replay. **The real-browser reproduction
did not run:** `node witness/navigation.mjs` exited 1 on Chromium
`signal=SIGABRT` before a page could launch, both on the unchanged base
and after implementation. The executable reproduction here is Node-level;
the witness remains for the lead to run outside this sandbox.

Validation used Node 24.18.0 with
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`; package and
Node commands ran from `snapback4/`, the suite and ref-check from the
repository root. No install, commit, push, tag or publication occurred.

- `node --test packages/snapback4/test/web-navigation.test.mjs`: initial
  regression `ℹ tests 4`, `ℹ pass 0`, `ℹ fail 4` before implementation;
  `ℹ tests 4`, `ℹ pass 4`, `ℹ fail 0` after it. Final expanded file:
  `ℹ tests 7`, `ℹ pass 7`, `ℹ fail 0`.
- To verify the additional regressions against the same base without
  changing the worktree, compiled a temporary package with `local.ts`
  and `web.ts` read verbatim from `git show HEAD:<path>`. Ran
  `node --test --test-name-pattern='pagehide|hidden flushes|mutate waits|IndexedDB|failed persistence|older sync' /tmp/lane-e-base-package/web-navigation.test.mjs`:
  `ℹ tests 6`, `ℹ pass 0`, `ℹ fail 6`. The same command against
  `packages/snapback4/test/web-navigation.test.mjs` on the fix:
  `ℹ tests 6`, `ℹ pass 6`, `ℹ fail 0`.
- `node --test packages/snapback4/test/web-navigation.test.mjs packages/snapback4/test/local-e2e.test.mjs packages/snapback4/test/client-lifecycle.test.mjs`:
  initially `ℹ tests 57`, `ℹ pass 56`, `ℹ fail 1` because the new stale-sync
  test omitted the required `snapshot`/`more` fields; after correcting its
  fixture, `ℹ tests 57`, `ℹ pass 57`, `ℹ fail 0`. Subsequent keepalive-wave
  refinements passed the 7-test file and the final complete suite.
- `bun run --cwd packages/snapback4 typecheck`: exit 0,
  `$ tsc -p tsconfig.json --noEmit`.
- `node --test packages/snapback4/test/react.test.mjs`: `ℹ tests 1`,
  `ℹ pass 0`, `ℹ fail 1`; Chromium SIGABRT before page launch. This is
  the same launch failure reproduced with the witness on the exact base.
- `bash snapback4/scripts/test.sh`, initial run: Rust 567 passed, 0 failed,
  1 ignored; fixtures 9/9; client `ℹ tests 144`, `ℹ pass 142`,
  `ℹ fail 2` (Chromium and the subsequently corrected test fixture);
  `== 1 failure(s) in 129 s`.
- `bash snapback4/scripts/test.sh`, final run: Rust 567 passed, 0 failed,
  1 ignored; builds and all typechecks green; the only failure was
  Chromium launching the React test:

```text
-- ok: cargo test (75 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
-- ok: fixture wrapper tests (10 s)
ℹ tests 137

ℹ todo 0
ℹ duration_ms 10387.962417
-- ok: fixture wrapper tests (11 s)
== client tests
ℹ tests 137
ℹ suites 0
ℹ pass 136
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
-- FAIL: client tests (45 s)
== 1 failure(s) in 195 s
```

Standalone retry (from `snapback4/`, same Node PATH):

`node --test packages/snapback4/test/react.test.mjs`

The same test and its package/app sources were extracted from exact base
`56cdedba6a8ff343c8d297b246b7431824ef0241` into scratch, with symlinks only
to the already installed dependencies, then run with:

`node --test /tmp/r2p-evidence/base-react/snapback4/packages/snapback4/test/react.test.mjs`

Both commands reproduced `signal=SIGABRT` at Chromium launch and both
reported the identical summary:

-- FAIL: client tests (43 s)
== 1 failure(s) in 114 s
```

The sole suite failure is Chromium SIGABRT during browserType.launch,
before the React harness executes. Isolated command:
`node --test packages/snapback4/test/react.test.mjs`:

== 1 failure(s) in 216 s
```

All 576 Rust tests passed, 1 ignored. The only failure was the known
Chromium SIGABRT at browser launch in `react.test.mjs`, before the browser
loaded application code. The isolated command (from `snapback4/`, same
Node export), `node --test packages/snapback4/test/react.test.mjs`, was run
on both the lane and with all tracked edits temporarily restored from base
`56cdedba6a8ff343c8d297b246b7431824ef0241`; both report verbatim:

-- ok: fixture wrapper tests (8 s)
ℹ tests 137
ℹ pass 136
ℹ fail 1
-- FAIL: client tests (42 s)
== 1 failure(s) in 164 s
```

`node --test packages/snapback4/test/react.test.mjs` failed alone at browser
launch with SIGABRT. The test file read from base
`33b530d41b00f1d685656f360e37c52ec1255ad6`, temporarily placed beside it as
`.lane-c-base-react.mjs` to preserve imports, failed the same way under
`node --test packages/snapback4/test/.lane-c-base-react.mjs`. The temporary
file was removed. Both commands reported:

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

Chromium exits `signal=SIGABRT` at `react.test.mjs:72:30` in both full
runs and the isolated rerun. This is the sandbox artifact explicitly named
in the lane instructions; the lead's outside-sandbox rerun remains necessary
for a completely green blocking suite. No lifecycle or client-concurrency
failure occurred. No failure is claimed independently base-verified as
pre-existing; the base hash above binds the page regression reproduction.

Final checks at the repository root: `./ref-check --verbose`,
`git diff --check`, and a count of changed code files. The 10 changed code
files have a maximum of 1,428 lines (the guide); zero exceed 1,500. Markdown
was not compressed or reflowed to meet a cap. Reference validation:

```text
ref-check: ok — 474 LLP docs, 8854 refs in 22829 files, 0 errors, 0 unchecked
```

Learned: a static page site is a cursor-selection key, not an execution
history. Remembering an earlier loss needs one monotone bit, while deciding
whether a traversal loses returned data needs value flow precise enough to
exclude unused record fields. These are independent decisions; neither
requires changing the cursor encoding or charging another data-plane step.

ℹ cancelled 0
ℹ skipped 0
```

Thus a wholly green blocking-suite result is the only requested acceptance
not delivered in this sandbox; the lead must rerun the Chromium witness
outside it. No client timeout or lifecycle failure was labelled inherited
without evidence, and none occurred in this full run. The unrelated caps
failure is verified against the same exact base above. No product fix or
ceiling increase was made for either environment/repository artifact.

`./ref-check --verbose` after the main journal entry:

```text
ref-check: ok — 474 LLP docs, 8852 refs in 22834 files, 0 errors, 0 unchecked
```

Exact focused error observation: before the repair at ceiling 28,
`pick(false)` is `sent` with result 2 and has no diagnostic. After the
repair it has this refusal (the same as baseline lowering); at ceiling 34
it remains a successful positive case:

```json
{"code":"E_BOUND","family":"bound","message":"steps reached the ceiling 28","site":"probe:7:then:1:then:2","rewrite":"move the loop into a job with `chunk`, or read a maintained aggregate instead of counting rows","guide":"bounds"}

The React harness, witness helper, package runtime sources, app sources and
dependency inputs were verified byte-unchanged from base
`33b530d41b00f1d685656f360e37c52ec1255ad6` with git diff before that isolated
run; this test launches no backend and therefore does not exercise the
changed binary. The lead must rerun Chromium outside this sandbox.
No lifecycle or bulk client timeout occurred in either suite run.

`./ref-check --verbose` passed before this entry:
`ref-check: ok — 474 LLP docs, 8853 refs in 22825 files, 0 errors, 0 unchecked`.
`git diff --check` passed. `node scripts/caps.mjs` reported `1 violation.`:
205 oversize files versus 204 allowed. A read-only git ls-tree/git cat-file
census at the exact base above found the same 205/204, with
`crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` at 1,504 lines.
No oversize source file was changed; all 8 changed/new code files are below
1,500, including untracked new cards which root caps does not yet enumerate.

Only out-of-brief file: snapback4/AGENTS.md, one command-sheet comment
corrected for bare guide's new list behavior. No runtime, ceilings,
serialized values, conformance cases, client package implementation or
other lane's diagnostics were changed. No commit, push, tag or publish.
B2's absent always-on summary is intentionally omitted; all other lane
work is complete. The lesson is to test both transitions and repeated
set-state calls: a compiled delete is not an idempotent clear on an absent
row, even though a whole partition can establish that absence.

Exact CLI text before, on stderr with empty stdout and exit 1:

```text
no card for prediction; cards: language, types, indexes, rules, sync, residency, expire, assets, reads, shapes, writes, programs, jobs, native, feeds, search, effects, actions, services, presence, bounds, refusals, personas
```

After, `snapback4 guide prediction` exits 0, with empty stderr. First 20
stdout lines, verbatim:

```text
# Prediction: queued writes and local rows

`pending` means the write has not settled; `sent` means the server committed it.
A predicted row carries `pending: true`; a pending write may have no predicted row.

Run `snapback4 check --residency` and `snapback4 why <op>` to see read sites:
- `held`: the viewer's whole synced partition, or an inherited maintain.
- `horizon`: a synced `last N` window; a held row can be read, but a miss
  cannot prove absence beyond the horizon, so that call may queue without a row.
- `server`: online-only data; a mutation reading it has `predicts: never`.

`predicts: eligible` requires device-readable sites and synced writes;
the call still needs its facts on this device and must fit the meter and rules.
Every mutation can queue on the local client; eligibility is not a promise
that every call produces a predicted row. Native reads also need their module.

```quarry
table drafts:
  owner: principal
  body: text <=200
```

`snapback4 guide banana` exits 1 with empty stderr and this stdout:

```text
no card named banana; nearest: reads, assets, bounds
cards: language, types, indexes, rules, sync, residency, prediction, evolution, expire, assets, reads, shapes, writes, programs, jobs, native, feeds, search, effects, actions, services, presence, bounds, refusals, personas
aliases: grammar -> language, quarry -> language, predict -> prediction, predictable -> prediction, offline -> prediction, optimistic -> prediction, pending -> prediction, pagination -> reads, paging -> reads, cursor -> reads, next -> reads, migration -> evolution, migrate -> evolution, schema-evolution -> evolution, adoption -> evolution, sql -> personas, inspect -> personas, push -> effects, notification -> effects, notify -> effects, worker -> effects, auth -> personas, signin -> personas, login -> personas, session -> personas, upload -> assets, media -> assets, image -> assets, video -> assets, realtime -> reads, live -> reads, subscribe -> reads, order -> writes, ordinal -> writes, arrival -> writes
```


## 2026-09-14 — A2: CLI and client mistakes from the Astra inventory

Implemented LLP 3000.007 §20.2 on base
`33b530d41b00f1d685656f360e37c52ec1255ad6`, without commits or publication.
Closed this lane's S02 (rendered/narrowed React asset example and shared
`Client.signOut`), S03 (package dependency/script merging with named conflicts),
S22 (typed replay receipts, ticket moved to `issues/closed/`), S28 (independent
`dev --hold-effects` and `--hold-schedules`), and S32 (Metro wasm configuration).
The separate observed-query fan-out concern in inventory S32 is outside this
lane's Expo-config brief.

Both client tiers preserve a sent replay as `replayed: true` with no result
property. The fresh arm uses `replayed?: false`, preserving the wire's smaller
fresh shape and letting a caller narrow before reading `result: R`. The online
client now revokes its bearer when reachable, clears credentials and closes;
the local client already did. The mock implements the same shared method.
README React examples render all four asset states, including an Image with
its URL guarded by `status === "ready"`. A compiled fixture exercises both
client types and rejects an unchecked write result.

Init checks all destinations before writing. Existing package metadata stays;
required dependencies, devDependencies and scripts merge, with the existing
and required values named on a key conflict. The README uses an exact initial
package pin and puts the merged dependency install before check. An existing
ESM package receives `.cjs` Metro/Babel configs. Config aliases are also
protected from collisions. The Metro transformer turns the web module's wasm
URL into a static asset dependency; the generated resolver includes wasm.

Effect holds gate authenticated claims without removing emitted work: the
regression observes 1 queued effect, 0 attempts while held, and 1 claim after
restart. A durable schedule-hold marker skips held periods on release, then
admits exactly 1 job at the next boundary; queued jobs remain runnable. This
uses the host's existing store transaction API, with no core or meter change.

Before/after regressions: init 0 passed / 2 failed → 2 passed / 0 failed;
replay holds 0 passed / 3 failed → 3 passed / 0 failed; client/README tests
5 passed / 4 failed → 9 passed / 0 failed. The generated Expo config and
reference-toolchain typecheck pass (2 tests); its initial typecheck attempt
also exposed a test-fixture module-resolution mistake, fixed by linking the
workspace node_modules. The README check compiles 11 blocks and covers 36
public functions (880.04 ms on the first green run).

A real Expo web export of a minimal `webDevice()` entry built 4 modules in
458 ms, emitted 1 wasm asset (1,608,850 bytes), and a 14,091-byte JS bundle.
A Node VM ran the exported bundle against an HTTP server rooted at the export:
1 wasm fetch, a device opened, `queued` returned `{ "ok": [] }`, 0 failures.
No manual wasm URL was supplied. Export used the installed Expo toolchain,
2 Metro workers, offline/no-cache flags, and disabled automatic web dependency
setup for the headless entry (the reference app does not install react-native-web).
This is a wasm-resolution witness, not a rendered Expo UI witness.

The first complete `bash snapback4/scripts/test.sh` took 127 s: Rust totals
572 passed, 0 failed, 1 ignored; fixture tests 9 passed; client tests 140 passed,
1 failed. Package, chat and Expo typechecks passed. The sole failure was
Chromium SIGABRT before the React harness started. It reproduced in the isolated
React test (0 passed / 1 failed), and with that test's unmodified source from
the base commit above (0 passed / 1 failed). No product test ran in that browser;
the lead still needs the React witness outside this sandbox. The changed source
maximum was 1,222 lines (`serve.rs`), with 0 changed code files above 1,500.
`ref-check` passed with 0 errors and 0 unchecked references.

Learned: types must preserve the server's withholding policy, and a bundler
asset extension alone does not make `new URL` a Metro dependency. Schedule
holds also need a release boundary persisted across restarts; merely skipping
the timer would replay the skipped period as soon as the flag was removed.

Final verification of the completed change: the two Rust target suites passed
2/2 and 3/3, and the combined README/write-authority/periphery run passed 26/26.
The second full suite took 75 s: all Rust tests and typechecks passed; default
client concurrency produced 130 passes and 3 failures (Chromium plus HTTP
admission and release-activation process timeouts). The required
`node --test --test-concurrency=2 'packages/snapback4/test/*.test.mjs'` rerun
completed in 63,641.284 ms with 140 passes, 1 failure, 0 cancellations: both
timeouts cleared, leaving only Chromium's launch SIGABRT. The final reference
audit reports 474 LLP docs, 8,855 refs, 0 errors, 0 unchecked. No other lane's
files, meter ceilings, serialized value forms or existing corpus cases changed.

ℹ tests 144
ℹ pass 143
ℹ fail 1
-- FAIL: client tests (44 s)
== 1 failure(s) in 78 s
```

The persistence-ordering and shared aggregate quota were the important
findings: awaiting the outbox commit solves durability but does not send
the write, and splitting bodies alone cannot evade the browser's total
keepalive budget. No out-of-scope files were touched; the guide change is
four lines in the published writes card. The remaining external check is
the browser witness outside the sandbox, and unrestricted unload delivery
beyond the browser quota is not claimed.

Both browser logs report `signal=SIGABRT`. The lead's outside-sandbox
browser run remains. No lifecycle or other client test failed, so no
concurrency workaround was needed. The built wasm measures 1,616,497 B
raw / 448,730 B gzip. All 12 changed code files are under 1,500 lines;
the maximum is `tests/device.rs` at 1,449. Root `./ref-check --verbose`
and `git diff --check` passed; ref-check reported:

```text
ref-check: ok — 474 LLP docs, 8854 refs in 22820 files, 0 errors, 0 unchecked
```

Exact diagnostic/fact changes: the first-like operation previously had
`predicts: eligible` and only its held write-target site, with no insert
explanation. It retains eligibility and adds:

```text
upsert inserts predict: absence is provable (likes by byPostPrincipal)
upsert inserts do not predict: the target has a horizon; queue without a row (likes by byPostPrincipal)
upsert inserts do not predict: the key does not pin readability; queue without a row (likes by byPostPrincipal)
```

Those are the three respective fixture variants, not simultaneous claims.
The service fixture previously refused with code `E_SYNC` and message:

```text
sync cannot infer an audience from `exists members[.room, viewer] or viewer = 'service:pusher'`; use public, `.column = viewer`, or `exists target[.columns, viewer]`
```

Its rewrite was, and remains for non-service extra disjuncts:

```text
use one invertible read rule, or remove sync (online only)
```

The service fixture now compiles without E_SYNC. Residency adds the
verbatim fact `service grants: service:pusher`. No E_/N_ code was added,
so `guide::CODES` needs no new entry. The lesson is that row holdings
and absence are different proofs: reusing the held-row read shortcut for
a synthetic key row would incorrectly predict into an unreadable group.
Likewise, the service exception belongs in the one audience-binding
function used by snapshots and streams, not only in compiler acceptance.

## 2026-09-14 — Lane S: Developer ID publication and fresh-copy launch measurement

Built LLP 3000.007 §20.8 on base
`56cdedba6a8ff343c8d297b246b7431824ef0241`. The publisher signs the
production darwin binary before hashing or packing, with hardened runtime
and a secure timestamp, verifies it strictly, and records the authority
and team id with the signed digest. The installed-consumer proof still
checks those exact bytes. An explicit `SNAPBACK4_SIGN_IDENTITY` selects
the signer; otherwise discovery requires exactly one Developer ID
Application identity. Signing, verification or identity failures refuse
the publish, including a dry run.

With `SNAPBACK4_NOTARY_PROFILE`, the publisher submits a zip to notarytool,
requires `Accepted` and records the submission id; refusals name the log
id when Apple returned one. A bare binary cannot be stapled. Without a
profile, the explicit output is
`publish: snapback4 <version> is signed but NOT notarized (set SNAPBACK4_NOTARY_PROFILE)`
and the metrics record `notarized: false`. This signs only the packaged
darwin CLI, not ordinary builds, JavaScript or the Expo xcframework. The
publication instructions live in the workspace README; no language card
or compiler diagnostic changed.

`scripts/measure-launch.mjs <binary> --n 20 --load 2` prepares ad-hoc and
Developer ID copies, then times `--version` on a fresh file per sample,
alternating order. It reports samples and nearest-rank p50/p95/max in
milliseconds, with copying/signing outside the timer. Load workers start
before samples and are stopped after success or failure; each launch has
a configurable 60,000 ms timeout. Fresh inodes avoid reusing one assessed
file, but do not establish that every macOS assessment cache is cold.

The publisher regression ran against the unchanged base script before
implementation: `node --test packages/snapback4/test/publish-signing.test.mjs`
reported `ℹ tests 14`, `ℹ pass 2`, `ℹ fail 12` (546.286958 ms). The same
14 cases passed after implementation (`ℹ pass 14`, `ℹ fail 0`, 472.115708
ms). The expanded final command, from `snapback4/` with Node 24 on PATH,
was `node --test packages/snapback4/test/publish-signing.test.mjs packages/snapback4/test/measure-launch.test.mjs`:
`ℹ tests 21`, `ℹ pass 21`, `ℹ fail 0`, 619.66125 ms. Tests run the real
publisher in disposable package trees with mocked external tools, including
positive signed packing and installed proof, accepted notarization,
refusals and tampered installed bytes. The launch test observes six unique
paths/inodes for three samples per variant and validates JSON percentiles
with synthetic clock values; another test starts/stops one real CPU worker
without signing. These synthetic samples are not launch-latency evidence.

`bash snapback4/scripts/test.sh`, with the pinned Node 24 PATH, reported:

```text
-- ok: cargo test (120 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
-- ok: fixture wrapper tests (11 s)
ℹ tests 155
ℹ pass 154
ℹ fail 1
-- FAIL: client tests (45 s)
== 1 failure(s) in 149 s
```

Rust totals across its summary lines were 567 passed, 0 failed and 1
ignored. The sole client failure was Chromium `SIGABRT` in
`react.test.mjs`. The isolated rerun
`node --test packages/snapback4/test/react.test.mjs` also reported
`ℹ tests 1`, `ℹ pass 0`, `ℹ fail 1` (505.920375 ms). This matches the
lane brief's named sandbox artifact; no exact-base reproduction was run,
so this entry makes no independently verified pre-existing-failure claim.
The suite began before three additional test cases were added; the
expanded 21-case targeted run above includes them. Retained logs are
`/private/tmp/lane-S-signing-before.log`, `lane-S-signing-after.log`,
`lane-S-targeted-final.log`, `lane-S-suite.log` and `lane-S-react-alone.log`
in the same directory.

The actual `node scripts/publish.mjs --dry-run`, from `snapback4/` with
Node 24 on PATH, ran the complete suite again with the publication SQLite
build flags and the expanded tests. Its client summary was `ℹ tests 158`,
`ℹ pass 157`, `ℹ fail 1`; it ended `== 1 failure(s) in 126 s` and
`publish: the suite is red; snapback4@0.2.12 is not published`. The only
failure was the React/Chromium sandbox abort. This refused at the suite
gate, before the production build or signing step; no suite bypass was
added. `/private/tmp/lane-S-publish-dry-run.log` retains the complete run.
Real signing attempts: 0; notarization submissions: 0; real comparative
launch samples: 0. p50/p95/max for real binaries remain unmeasured, for
the lead's outside-sandbox signing/measurement run. No claim is made that
Developer ID signing fixes the observed `_dyld_start` delay.

The root `./ref-check --verbose` reported:

```text
ref-check: ok — 474 LLP docs, 8853 refs in 22829 files, 0 errors, 0 unchecked
```

`git diff --check` passed. Seven intended files changed; no out-of-scope
files, language diagnostics, serialized forms, meter ceilings or existing
corpus cases changed. Nothing was committed, pushed, tagged or published.
The implementation lesson is that signing changes the artifact digest,
so it belongs before packing and the installed proof; codesign's authority
and team display must be read from stderr, even on success. The remaining
acceptance work is external qualification, not an unsigned fallback.

**Lead's outside-sandbox measurements (2026-09-14).** `node scripts/publish.mjs --dry-run` ran end to end: the suite had no failure in 105 s; the production binary was built and signed with `Developer ID Application: Charles Cheever (UD2ZVW5WU5)`; the publish printed "signed but NOT notarized"; and the installed-consumer proof passed on the signed bytes (sha256 `5f087f29…`). I then measured launch latency with `node scripts/measure-launch.mjs` on the published `snapback4-darwin-arm64@0.2.12` binary. It ran 30 fresh copies per variant, with 8 load workers on top of a host load of about 16. **Ad-hoc signing:** p50 280 ms, p95 1,174 ms, max 1,678 ms. **Developer ID signing:** p50 293 ms, p95 2,197 ms, max 2,937 ms. Signing does not reduce first-launch assessment latency, and the difference is within noise. It is kept for authenticity (ruling 22), and it is not a fix for the `_dyld_start` stall in `issues/20260914-snapback4-lifecycle-tests-time-out-under-host-load.md`.

Earlier complete runs caught an old feed test still using bucket fields
and an accidental bucket-field removal in an unrelated digest fixture.
Both were introduced during this lane and fixed; neither is called
pre-existing. The final diff leaves the unrelated digest fixture unchanged.
The second run also caught interleaved address/signal text in a host test.
`cargo test -p snapback4 --test lifecycle dev_and_serve_report_signals_without_an_application_worker -- --nocapture`
passed alone, and that test passed in the final whole suite:

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 11 filtered out; finished in 3.47s
```

The repaired digest regression was checked with
`cargo test -p snapback4-sim --test clique clique_digest_uses_two_counters_and_push_preview_concatenates_text -- --nocapture`:

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 33 filtered out; finished in 0.02s
```

The first/second full runs respectively reported
`== 2 failure(s) in 295 s` and `== 2 failure(s) in 186 s`; their introduced
Rust failures are resolved in the final run above. Complete command logs
are `/tmp/lane-c-suite.log`, `/tmp/lane-c-suite-final.log` and
`/tmp/lane-c-suite-verified.log`.

Root `./ref-check --verbose` passed:

```text
ref-check: ok — 474 LLP docs, 8857 refs in 22831 files, 0 errors, 0 unchecked
```

`git diff --check` passed. All 16 changed/new code files are below 1,500
lines; the largest is the existing device suite at 1,450. Root
`node scripts/caps.mjs` reports `1 violation.`: the unchanged
`crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` is 1,504 lines
and produces 205 oversize files against 204 allowed. Its bytes were verified
identical to the named base. No out-of-scope file was changed. The JOURNAL
is append-only, README text outside Feeds is unchanged, and the ranked-feed
card was verified byte-identical after extracting it into `guide/feeds.md`.
No commit, push or publication was performed. Chromium needs the lead's
outside-sandbox rerun; no implementation item is deferred.

## 2026-09-14 — §19.2 third review round: a direct return and the fail-safe filter (lead)

GPT's round-3 re-check of `4c1e825bc` found A, B and C repaired and two new
completeness defects from R2g's returned-collector filter. D (High): a loop
that returns straight from its body (`return [i]`) registered no collector
because the backward flow only recorded writes, so four rows read one row,
no cursor, `complete: true`. E (Medium): a scan site re-executed after its
earlier interrupted output was discarded keeps the earlier loss, so a whole
re-collected page reads `complete: false`.

Fix for D in `engine/page_collectors.rs`: `Stmt::Return` adds every enclosing
loop to the returned set, and the planner (`engine/pages.rs`) drops a
registration only for a loop the analysis visited and proved auxiliary
(`Flow { returned, visited }`); loops it never reached stay registered.
Regression `directReturn` at 4/1/0 rows on the server and both device stores:
`direct_return_4` red without the change (42 passed; 1 failed), green with it
(43 passed; 0 failed). The generated shapes gained `return result` in place of
`break` at depths 1 and 2; the oracle counts a page that never executes after
the return as unread, not lost: 896 generated cases pass. E is accepted as
conservative (§19.2): it errs toward `complete: false` only, and removing it
needs per-value provenance. This closes the three-round limit for §19.



## 2026-09-14 — a restarted dev worker's orphaned claim poll (lead)

`chat's real TypeScript invite worker is supervised by dev, restarts and stops
with it` went red 4 of 4 on `ba40649ef` and on the wave-2 integration (it had
passed in the `4c1e825bc` suite): after the test SIGKILLs the worker, the second
`invite` stays `pending` for the whole 25 s wait. `/actions/claim` and
`/effects/claim` long-poll up to 25 s and cannot see that the killed child's
connection closed; when the next request commits, the orphaned poll can win
the claim and lease the work to nobody for the claim's 60 s lease. Which poll
wins is a race, so it passed before. Agents meet the same stall in `dev`
whenever the supervised worker crashes or restarts.

Fix in `dev_worker.rs`: each child gets its own `service:worker` session,
closed when that child exits (and on drop). The claim loops already
reauthenticate after every wait, so an orphaned poll answers 401 instead of
claiming. The printed token stays valid for the developer. After: the worker
tests 5 of 5, three runs in a row. External `serve` workers still recover
through lease expiry, as documented.



## 2026-09-14 — holistic product excellence: an umbrella and five children

Charlie asked whether Snapback 4 was holistically excellent, beautiful,
ergonomic, elegant and performant, then requested an LLP and a child for each
of the assessment's five gaps. [LLP 3000.008](../llp/3000.008-holistic-product-excellence.rfc.md)
records the answer: a coherent implemented foundation and a credible path,
with whole-application ergonomics and evidence still uneven. Its five Draft
RFC children cover ordinary Quarry programming, understandable data placement,
the client experience, whole-application performance, and dependable composition
and broader usefulness.

The family references the existing residency and relaxed-language drafts rather
than re-parenting them. It distinguishes static capability from current device
coverage, flags filtering/cursor disclosure and exact-ranking semantics for
resolution, treats documented client workarounds as ergonomic evidence, and
requires actual-client and operational evidence for the claims those models
cannot establish. Retained benchmark numbers keep their original versions and
limits. No new benchmark, product test, runtime implementation or publication
was performed for this documentation task.

All six new drafts are linked into `llp/current/`. The non-hidden working-set
count was already 60 against the declared 59-document cap and is now 66. This
requested document family does not raise that cap or archive another session's
in-progress proposals to make the count green; working-set curation remains
outstanding. Root LLP 3000 and drafts 3000.006/3000.007 link the new agenda.

Documentation validation: all 76 local Markdown links in the six drafts,
their anchors, required metadata and current symlinks pass. The existing
reference checker restricted to tracked source plus the six new drafts reports
480 LLPs, 8,732 references, zero errors and zero unchecked. The unmodified
whole-tree `./ref-check --verbose` reports 42 errors in ignored
`.llp/ship-runs/` logs and retained instrument copies; none is in this change.
Whitespace validation passes. These are documentation checks, not new product
qualification.

## 2026-09-14 — membership feed query CPU and wall time

The performance lane completed and independently audited an instrumented
0.2.10 Office run: 18,432 HTTP calls and all 2,304 selected traces passed.
At 150 groups/C8, first/rotating feed query CPU averaged 5.898/7.817 ms and
query wall 10.557/16.154 ms, accounting for 78.9%/85.5% of server wall. The
residual does not identify an internal lock or I/O cause. The older partial
capture remains failed; no smoke or partial trace entered these statistics.

The [performance record](../benchmarks/runs/snapback4-public-catalog-20260913/README.md)
retains the result and limits. The [core-owner follow-up](../issues/20260914-snapback4-membership-feed-query-cost.md)
starts with a current-source measurement: 0.2.12 added work on these query
paths, so the old diagnostic is not a current-release claim. No core edit,
result/authority cache, ceiling change or new performance win follows yet.


## 2026-09-14 — holistic excellence panel and the residual implementation

Charlie commissioned the usual panel, including this authoring session, and
Astra implementation of the directions that hold up. Astra (high), Grok 4.6
(xhigh), Muse Spark 1.3 (xhigh) and Claude Fable 5.1 (high) returned independent
source reviews at `5ec0a75a2`; all said READY WITH CHANGES. The author critical
pass is separately labeled, not counted as an independent vote. Each actual
review is retained under `llp/reviews/3000.008-holistic-product-excellence.*.md`.

The main correction is factual: much of the .008 drafts already shipped under
.007. The revised family preserves the product outcomes, keeps .006 superseded,
and accepts a bounded residual increment under Charlie's delegated instruction.
Three disjoint Astra lanes own replay results, browser persistence and durable
acquisition. The .007 §19 presence/helper/`==` program already has an owner and
is not duplicated. Ranking verification, one browser acquisition/offline-reopen
measurement and a stopped-server disposable recovery procedure complete the
selected evidence; a second application, broad tuning and seamless restore of
old device outboxes remain deferred. No promotion claim or new gate follows.

The first reproduced failure is the existing replay type ticket: the server
correctly withholds a result while the clients return `result: undefined` under
required `R`. The fix preserves `replayed: true` without a result in both
clients, hooks and the card. Four real-HTTP baseline failures become green;
25 focused runtime/type/React/security tests pass on the EPYC host, with the
existing server disclosure tests unchanged. The acquisition and browser-save
hypotheses also reproduced; their fixes and integrated evidence follow.

### 2026-09-14 — LLP 3000.008 reproduced-boundary repairs

Astra's four replay regression failures are repaired by an explicit fresh/replayed
`Write` union, without retaining historical results. Actual wasm/process clients
also reproduced never-acquired empty answers; readiness now commits with the
generation's snapshot/catch-up, with a one-sync upgrade boundary for old stores.
Browser failed saves now discard uncommitted memory and reopen persisted state;
failed initialization releases locks. A failed runtime-cache save cannot let
wasm-bindgen's initialized shortcut bless incompatible replacement bytes.

Stopped-release recovery testing found that a copied absolute store symlink
followed the original deployment, even while serving a new directory. The CLI
now maintains a relative link under its existing lock and refuses unexpected
regular files. Twelve release and 30 CLI tests passed; the package now documents
a stopped whole-directory backup and isolated restore with fresh devices.
Built-in jobs/schedules resume on serve; external workers remain disconnected
for the exercise. This is not production rewind or power-loss qualification.

### 2026-09-14 — LLP 3000.008 integrated evidence and code review

Fresh Sol and Grok code reviews both returned READY with no must-fix code
defects. Their source-only scope and documentation dispositions are retained
with the panel under `llp/reviews/`. The worker-crash fixture's 60 s lease
could not fit its 20 s deadline; an explicit 1 s fixture lease/poll preserves
the real worker, action and supervision assertions and the production defaults.

The final affected Linux checks pass: 71 Rust and 26 Node tests. Real Chrome
IDB fault/reopen and production scale witnesses also pass. First useful local
content for 20,000 messages takes 11.66 s; a new offline realm reopens in
622 ms. Instrument overhead, seed, source, bytes and runtime hashes are kept
in the existing metrics and `benchmarks/runs/2026-09-14-snapback4-excellence/`.
A separately measured TCP_NODELAY correction reduces a 273-write replay drain
from 20.25 s to 4.61 s; the original 15 s assertion is unchanged.

The initial integrated Linux suite's 116 s red and the cold Office M1
publication dry-run's 656 s refusal remain recorded. The latter encountered
five deadline failures during high host load; it published nothing. These
observations do not close the suite-budget ticket or prove holistic excellence.

## 2026-09-14 — confirm the feed query bottleneck on 0.2.12

The performance lane repeated the bounded Office diagnostic on fixed
`206650f29` (0.2.12): all 18,432 requests and 2,304 selected traces passed,
with full fixture/auth checks and independently audited cleanup. At 150
groups/C8, first/rotating feed query wall averages 11.138/17.293 ms and
accounts for 84.7%/82.5% of server wall. At C1 the query interval is about
99.7% thread CPU. The residual does not identify an internal wait cause.

The [performance record](../benchmarks/runs/snapback4-public-catalog-20260913/README.md)
preserves the current and historical measurements separately. The
[core-owner follow-up](../issues/20260914-snapback4-membership-feed-query-cost.md)
now calls for internal query cost decomposition. No core code, authority
cache, ceiling or client contract changed, and no new speedup is claimed.


## 2026-09-14 — encode sync replies from their existing values

The performance lane extends the existing borrowed query-wire encoding to
snapshot and stream replies. Each reply owns its original events, borrows
their plain values during serialization, and drops the rows before socket
I/O. Full wire fields, explicit nulls, event order, held/joined groups,
acknowledgements, cursors and the bounded response writer are unchanged.
No core, reader, transaction, auth or client-contract change is involved.

On fixed 0.2.12 source, six native Linux A/B runs passed all 9,600 timed
calls and their ordinary-auth/full-page proofs. A 4,000-event first snapshot
at C1 falls 38.832 → 25.873 ms p50 and 45.992 → 28.541 ms p95. C8 first-page
p50 is effectively flat, and stream C8 p99/maximum regress about 10%.
The [comparison record](../benchmarks/runs/snapback4-public-catalog-20260913/README.md)
preserves every gain and loss; a [tail follow-up](../issues/20260914-snapback4-sync-concurrent-tail-latency.md)
remains open. These warm source-built measurements do not establish device,
realtime, cold-cache or competitor performance.

The actual native production qualification passed 71/73 baseline/candidate
CLI tests; both variants passed the HTTP bounds suite (nine reported tests,
including eight nested cases) and 32 normalized ordinary-auth response pairs. Two independent formal calculations reconcile.
The failed V1 smoke and first independent calculator attempt remain excluded
and retained. The source and evidence have independent reviews; publication
qualification and registry verification are separate work.

## 2026-09-14 — Clique's expiry receipt can pass before expiry

Recording the 0.2.10 three-model cell found a false-positive M5 expiry
receipt. Muse's final choreography passed after 46.459 seconds, but an
independent read-only inspection found the exact probe message still stored
with a 24-hour TTL. The frozen packet supplies shortened grading windows;
the lane used production windows and a 45-second adapter wait. The probe
checks for absent bubbles after relaunch without establishing that their
data has loaded. Its original pass is retained and qualified, not rewritten.
The [benchmark ticket](../issues/20260914-clique-expiry-choreography-can-pass-with-unexpired-row.md)
and selected-field evidence separate that insufficient measurement from an
engine expiry defect. No frozen instrument or product code changed;
independent grading has begun, and the M7 phases remain pending.

## 2026-09-14 — Awaited browser admission survives page closure in a reduced control

Muse's Clique essay attributed a settings/navigation loss to the SDK's
outbox. A reduced published-0.2.10 Chromium control awaited an offline
mutation with default IndexedDB persistence, closed the page as its next
asynchronous action, recovered the one queued mutation from a new page and
committed one row on reconnect. It used no keepalive or write-through path.
The [follow-up ticket](../issues/20260914-snapback4-muse-navigation-outbox-loss-needs-reproduction.md)
retains that counterexample and asks for the full app flow's admission and
navigation ordering. The received app bug, workaround and scorer's charge
remain recorded; the broad durability claim is not established. No product
or frozen benchmark code changed.


## 2026-09-14 — published 0.2.13: borrowed sync replies

The performance lane's unchanged publisher completed from `d81381a98` at
23:10:55 UTC. It passed 474 Rust, 146 reported client and 9 fixture tests,
zero failures and one existing ignored Rust test, in 130 s. The existing
suite-budget follow-up remains open; this release is no new timing comparison.
The production binary is 7,893,696 B, SHA-256
`096b464f9a9afb3e0ec8b6ad64b0dd29558897b60fba65c2c0847aa97e4963e8`.
The installed CLI/version/digest and TypeScript checks passed; the mock
consumer asserted ready/fresh query rows, online sent and offline pending.

Both npm packages' 0.2.13 archives matched the tested bytes by 23:14:28 UTC.
The first platform metadata request returned 404 and is retained; a read-only
retry verified it, with no second publication. Both owned process groups
ended, the temporary credential was removed and the 700-file source check
passed. The unchanged receipt is in `metrics/publish.jsonl`; the
[performance record](../benchmarks/runs/snapback4-public-catalog-20260913/README.md)
preserves qualification details and the sync A/B's separate measured identities.
Concurrent stream-tail and many-group-feed follow-ups remain open.

## 2026-09-14 — Clique grading comparison needs an avatar-contract qualification

The completed 0.2.10 Astra independent grade reports 99 pass, 2 fail and
18 not run. Nine missing native proofs were classified as fail on the
earlier pins and not run here; the smaller fail count is not a corresponding
product improvement. One new failure follows conflicting frozen requirements:
the DM-avatar assertion and brief require avatars, while the contract and
choreography allow the kit's default no-avatar layout. A [narrow instrument
ticket](../issues/20260914-clique-dm-avatar-assertion-conflicts-with-conditional-kit-contract.md)
retains the contradiction and received result. The other failure is a
settings action followed by navigation before admission; its evidence is
added to the existing navigation follow-up. No received grade, frozen
instrument or product code changed. Grok's independent grade is running;
Muse's grade and all fresh M7 sessions remain to be completed.

## 2026-09-14 — release numbering: the §19 landing is 0.2.15 / snapback4-expo 0.2.6 (lead, LLP 3000.007)

Two programs landed on main within the hour. The LLP 3000.008 excellence
program prepared and qualified 0.2.14 / snapback4-expo 0.2.5 (`a0ee114aa`,
dry run 23:17Z) before publishing it; the LLP 3000.007 §19 landing (presence
option C, a helper's return and the caller's page, `==`, the dev worker's
per-child session) merges after it and takes 0.2.15 / snapback4-expo 0.2.6,
published only after 0.2.14 is on npm. 0.2.14 is that program's qualified
commit, not main after this merge.

## 2026-09-14 — integration with main's acquisition gate (lead, LLP 3000.007 §19)

Merging `origin/main` brought `4bb2ff958` (a device refuses to predict until
its generation's partition finishes acquisition). Three R1p presence tests
predicted on a freshly opened device and went red with `E_PREDICT: this
generation's partition has not completed acquisition`; they now apply the
viewer's snapshot pages first, as main's own device tests do (device presence
tests 7 passed; 0 failed). Main's `c87954e45` had bounded the chat worker
fixture to a 1 s lease and poll because a killed worker's orphaned claim could
lease new work; with `dev`'s per-child session (`0380b3ae6`) the fixture runs
the reference worker's production defaults again (worker tests 5 of 5, three
runs), so the test guards the fix instead of hiding the race.

ℹ todo 0
ℹ duration_ms 44580.211625
-- FAIL: client tests (45 s)
== 1 failure(s) in 147 s
```

Rust totals obtained by summing the individual lines: 567 passed, 0 failed,
2 ignored (one is this measurement). No lifecycle timeout occurred. The one
client failure is Chromium SIGABRT in `react.test.mjs`, the known sandbox
artifact. It reproduced alone, from `snapback4/`:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
node --test packages/snapback4/test/react.test.mjs > /private/tmp/lane-d-react-isolated.log 2>&1
```

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 646.542083
```

Base verification: `git diff --exit-code
56cdedba6a8ff343c8d297b246b7431824ef0241 -- snapback4/packages
snapback4/crates/snapback4 snapback4/crates/snapback4-core
snapback4/crates/snapback4-device snapback4/crates/snapback4-lang
snapback4/scripts snapback4/Cargo.toml snapback4/Cargo.lock` exited 0.
The runtime and failed client test are byte-identical to that base; the only
added Rust file is the opt-in simulator measurement. The lead still needs
the browser witness outside the sandbox. No other failure is attributed to
the base and no code was changed to avoid this browser failure.

No out-of-scope file was touched. README/guide/CODES are unchanged because
no form or diagnostic ships from a design lane. The existing
`N_MAINTAIN_DELTA` text is unchanged; §20.9 proposes its future dependency
wording and one adoption-availability diagnostic. There is no before/after
production diagnostic pair in this task. Root `ref-check --verbose` and
`git diff --check` are the final documentation checks.

Final reference check, from the repository root:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
./ref-check --verbose > /private/tmp/lane-d-ref-check-final.log 2>&1
```

```text
ref-check: ok — 474 LLP docs, 8853 refs in 22826 files, 0 errors, 0 unchecked
```

`git diff --check` exited 0; the journal prefix matches the base byte for
byte, §20.9 is between §20.8 and Non-claims, and the only code addition is
the 118-line ignored measurement (below the 1,500-line code cap).

## 2026-09-14 — D1: filtered and calendar maintains, group pages and value order

Implemented LLP 3000.007 §20.9 (a)–(d) from base `397c0a829001f1df4f1e096d9bdee5693a56416d`.
The source contribution evaluator is shared by server writes, rebuilds,
expiry and both device stores. It handles restricted typed predicates,
Euclidean day/hour/literal-duration bucket keys, coalesced key moves and
wide intermediate sums. Generated group pages and scoped/global value indexes
use ordinary rows and cursors. An internal selected-source contribution index
keeps computed expiry groups off the source-wide fallback. Source caps prove
distinct-group bounds without creating a target constraint.

Prediction preserves ordinary source authority and requires each aggregate
base or its absence to be known. Online-only aggregate side effects are omitted
locally. Inherited aggregates have no horizon and remain until-revoked when
their source retains history. Hidden writes reserve predicate/key, two-group,
index and transient heap work before inspecting the old image; transient
buffers are released. The in-memory store now counts actual index removals
and insertions, matching SQLite's changed-key behavior. The language card runs
calendar scalars, pages and reaction chips; README and guide cards compile
without notes. Disclosure diagnostics name the target's filter/key/value
dependencies, and the rules card includes a restrictive aggregate read rule.

Successor classification reports filter/key/duration/default/index changes at
the maintain declaration. Read-only assessment checks interpreted source
images and final sums before today's atomic activation. A failing regression
showed that a filter change could previously pass assessment and overflow
during rebuild; check and adoption now agree. No source backfill writes are
needed. Resumable adoption, a write fence, check exit 2, bounded preparation
and S26's digest continuation remain outside this slice. There is no claim
of the complete five-million-row, disk-backed scale qualification or a
measured durable write pause.

What I learned: ordinary group pages already supplied the chips runtime
control on the base; the missing work was its paved contract and bound
propagation, plus the new contribution/key/rank forms. Not-comparison
precedence needs the maintain's own grammar. A missing scoped-rank prefix
must be refused instead of accidentally ordering across scopes. A physical
zero-sum group must survive independent signed expiry. Unknown local bases
must queue; partial source history cannot reconstruct an authoritative total.

### Measurements

Command, from `snapback4/`:

```sh
cargo test -p snapback4-sim --test maintain_measurement accepted_maintain_costs -- --ignored --nocapture > /private/tmp/d1-measurements-final.log 2>&1
```

SQLite in-memory stores, debug Rust, on the shared loaded host. Each of six
real modes has a separate 50,000-post or 100,000-message store. There are 200
samples per operation: 14,400 mutation samples and 400 rank reads in total.
Filter selectivity is 0%, 50% or 100% for both seeded rows and the measured
add/unrelated batches. Decrease exits selected rows; enter makes every sample
selected before keyMove/remove. Rank decrease lowers the initially winning
group one contribution at a time. Calendar/expiry modes have 50,000/100,000
distinct groups; filter100/rank have 1,000 groups.

Temporary SQLite triggers independently count physical source/target index
inserts/deletes and target writes. Timings include that instrumentation.
All seven logical meters are printed as the last sample and as a 200-sample
sum; heap is the engine's logical accounting, not a peak RSS measurement.
Adoption timing includes exhaustive assessment and the existing unbounded
atomic rebuild, with zero resumable chunks. These timings are observations,
not controlled throughput or disk-backed pause claims.

| Source rows | Mode | Target groups | Adoption ms |
| --- | --- | ---: | ---: |
| posts 50000 | filter0 | 0 | 3383.382 |
| posts 50000 | filter50 | 500 | 2729.744 |
| posts 50000 | filter100 | 1000 | 2805.781 |
| posts 50000 | calendar | 50000 | 5884.015 |
| posts 50000 | rank | 1000 | 3312.036 |
| posts 50000 | expiry | 50000 | 6596.769 |
| messages 100000 | filter0 | 0 | 5194.768 |
| messages 100000 | filter50 | 500 | 5837.429 |
| messages 100000 | filter100 | 1000 | 6658.824 |
| messages 100000 | calendar | 100000 | 11899.762 |
| messages 100000 | rank | 1000 | 5296.803 |
| messages 100000 | expiry | 100000 | 13675.413 |

| Source | Mode / operation | p50 µs | p95 µs |
| --- | --- | ---: | ---: |
| posts | filter0 / add | 109.666 | 263.625 |
| posts | filter0 / decrease | 121.416 | 374.292 |
| posts | filter0 / keyMove | 252.208 | 594.208 |
| posts | filter50 / add | 106.833 | 199.375 |
| posts | filter50 / decrease | 123.041 | 286.125 |
| posts | filter50 / keyMove | 162.584 | 217.750 |
| posts | filter100 / add | 110.166 | 217.000 |
| posts | filter100 / decrease | 124.583 | 178.583 |
| posts | filter100 / keyMove | 163.666 | 236.208 |
| posts | calendar / add | 121.708 | 172.625 |
| posts | calendar / decrease | 136.458 | 227.459 |
| posts | calendar / keyMove | 188.292 | 277.125 |
| posts | rank / add | 128.500 | 192.792 |
| posts | rank / decrease | 145.958 | 212.208 |
| posts | rank / keyMove | 196.583 | 235.750 |
| posts | rank / read | 90.416 | 125.875 |
| posts | expiry / add | 152.125 | 298.333 |
| posts | expiry / decrease | 219.417 | 467.625 |
| posts | expiry / keyMove | 251.375 | 344.584 |
| messages | filter0 / add | 82.500 | 96.417 |
| messages | filter0 / decrease | 99.208 | 102.458 |
| messages | filter0 / keyMove | 166.416 | 215.792 |
| messages | filter50 / add | 103.500 | 125.000 |
| messages | filter50 / decrease | 121.958 | 126.125 |
| messages | filter50 / keyMove | 163.459 | 186.000 |
| messages | filter100 / add | 109.333 | 175.750 |
| messages | filter100 / decrease | 125.167 | 176.333 |
| messages | filter100 / keyMove | 172.292 | 259.875 |
| messages | calendar / add | 114.583 | 163.833 |
| messages | calendar / decrease | 130.084 | 183.459 |
| messages | calendar / keyMove | 171.916 | 188.792 |
| messages | rank / add | 125.000 | 145.208 |
| messages | rank / decrease | 141.375 | 154.875 |
| messages | rank / keyMove | 193.500 | 203.459 |
| messages | rank / read | 88.958 | 93.083 |
| messages | expiry / add | 145.250 | 197.500 |
| messages | expiry / decrease | 163.167 | 176.291 |
| messages | expiry / keyMove | 236.250 | 404.958 |

The 0/50/100% add batches wrote respectively 0/100/200 target rows for 200
source writes. The 200 ranked winner decreases deleted 200 and inserted
200 value-index entries. Calendar key moves wrote 400 target rows; expiry
key moves additionally deleted 400 and inserted 400 source-index entries
(the ordinary group index plus the internal contribution index). A live
computed expiry scalar examined 2 rows over either source size, returned
1 before expiry and 0 at expiry before sweep, and exposed next_expiry 2000.
Both rank reads examined 11 target rows, with no source scan.

Full measured records, preserving the seven meters and physical counters:

```text
REAL adoption source=posts n=50000 mode=filter0 groups=0 ms=3383.382 store=sqlite-memory resumable_chunks=0
REAL write source=posts mode=filter0 op=add n=200 p50_us=109.666 p95_us=263.625 last_meter={"examined":0,"index_entries":2,"rule_probes":0,"steps":17,"heap_bytes":1363,"output_bytes":165,"rows_written":1} meter_sum_200={"examined":0,"heap_bytes":272600,"index_entries":400,"output_bytes":33000,"rows_written":200,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":400,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=posts mode=filter0 op=unrelated n=200 p50_us=144.708 p95_us=317.125 last_meter={"examined":1,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1499,"output_bytes":166,"rows_written":1} meter_sum_200={"examined":200,"heap_bytes":299800,"index_entries":0,"output_bytes":33200,"rows_written":200,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=posts mode=filter0 op=decrease n=200 p50_us=121.416 p95_us=374.292 last_meter={"examined":1,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1492,"output_bytes":166,"rows_written":1} meter_sum_200={"examined":200,"heap_bytes":298400,"index_entries":0,"output_bytes":33200,"rows_written":200,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=posts mode=filter0 op=enter n=200 p50_us=156.042 p95_us=342.292 last_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":2,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":2,"target_rows":200}
REAL write source=posts mode=filter0 op=keyMove n=200 p50_us=252.208 p95_us=594.208 last_meter={"examined":3,"index_entries":4,"rule_probes":0,"steps":18,"heap_bytes":1583,"output_bytes":173,"rows_written":3} meter_sum_200={"examined":600,"heap_bytes":316600,"index_entries":404,"output_bytes":34600,"rows_written":600,"rule_probes":0,"steps":3600} physical_200={"source_index_delete":200,"source_index_insert":200,"target_index_delete":2,"target_index_insert":2,"target_rows":400}
REAL write source=posts mode=filter0 op=remove n=200 p50_us=146.541 p95_us=283.541 last_meter={"examined":1,"index_entries":4,"rule_probes":0,"steps":10,"heap_bytes":32,"output_bytes":6,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":6400,"index_entries":402,"output_bytes":1200,"rows_written":400,"rule_probes":0,"steps":2000} physical_200={"source_index_delete":400,"source_index_insert":0,"target_index_delete":2,"target_index_insert":0,"target_rows":200}
REAL adoption source=posts n=50000 mode=filter50 groups=500 ms=2729.744 store=sqlite-memory resumable_chunks=0
REAL write source=posts mode=filter50 op=add n=200 p50_us=106.833 p95_us=199.375 last_meter={"examined":0,"index_entries":2,"rule_probes":0,"steps":17,"heap_bytes":1363,"output_bytes":165,"rows_written":1} meter_sum_200={"examined":100,"heap_bytes":272600,"index_entries":400,"output_bytes":33000,"rows_written":300,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":400,"target_index_delete":0,"target_index_insert":0,"target_rows":100}
REAL write source=posts mode=filter50 op=unrelated n=200 p50_us=103.166 p95_us=227.500 last_meter={"examined":1,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1499,"output_bytes":166,"rows_written":1} meter_sum_200={"examined":200,"heap_bytes":299800,"index_entries":0,"output_bytes":33200,"rows_written":200,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=posts mode=filter50 op=decrease n=200 p50_us=123.041 p95_us=286.125 last_meter={"examined":1,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1492,"output_bytes":166,"rows_written":1} meter_sum_200={"examined":300,"heap_bytes":298400,"index_entries":0,"output_bytes":33200,"rows_written":300,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":100}
REAL write source=posts mode=filter50 op=enter n=200 p50_us=125.583 p95_us=157.875 last_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":0,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=posts mode=filter50 op=keyMove n=200 p50_us=162.584 p95_us=217.750 last_meter={"examined":3,"index_entries":2,"rule_probes":0,"steps":18,"heap_bytes":1583,"output_bytes":173,"rows_written":3} meter_sum_200={"examined":600,"heap_bytes":316600,"index_entries":402,"output_bytes":34600,"rows_written":600,"rule_probes":0,"steps":3600} physical_200={"source_index_delete":200,"source_index_insert":200,"target_index_delete":0,"target_index_insert":2,"target_rows":400}
REAL write source=posts mode=filter50 op=remove n=200 p50_us=82.334 p95_us=96.625 last_meter={"examined":1,"index_entries":4,"rule_probes":0,"steps":10,"heap_bytes":32,"output_bytes":6,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":6400,"index_entries":402,"output_bytes":1200,"rows_written":400,"rule_probes":0,"steps":2000} physical_200={"source_index_delete":400,"source_index_insert":0,"target_index_delete":2,"target_index_insert":0,"target_rows":200}
REAL adoption source=posts n=50000 mode=filter100 groups=1000 ms=2805.781 store=sqlite-memory resumable_chunks=0
REAL write source=posts mode=filter100 op=add n=200 p50_us=110.166 p95_us=217.000 last_meter={"examined":1,"index_entries":2,"rule_probes":0,"steps":17,"heap_bytes":1363,"output_bytes":165,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":272600,"index_entries":400,"output_bytes":33000,"rows_written":400,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":400,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=posts mode=filter100 op=unrelated n=200 p50_us=100.959 p95_us=108.666 last_meter={"examined":1,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1499,"output_bytes":166,"rows_written":1} meter_sum_200={"examined":200,"heap_bytes":299800,"index_entries":0,"output_bytes":33200,"rows_written":200,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=posts mode=filter100 op=decrease n=200 p50_us=124.583 p95_us=178.583 last_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":0,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=posts mode=filter100 op=enter n=200 p50_us=124.042 p95_us=130.542 last_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":0,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=posts mode=filter100 op=keyMove n=200 p50_us=163.666 p95_us=236.208 last_meter={"examined":3,"index_entries":2,"rule_probes":0,"steps":18,"heap_bytes":1583,"output_bytes":173,"rows_written":3} meter_sum_200={"examined":600,"heap_bytes":316600,"index_entries":402,"output_bytes":34600,"rows_written":600,"rule_probes":0,"steps":3600} physical_200={"source_index_delete":200,"source_index_insert":200,"target_index_delete":0,"target_index_insert":2,"target_rows":400}
REAL write source=posts mode=filter100 op=remove n=200 p50_us=82.625 p95_us=97.708 last_meter={"examined":1,"index_entries":4,"rule_probes":0,"steps":10,"heap_bytes":32,"output_bytes":6,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":6400,"index_entries":402,"output_bytes":1200,"rows_written":400,"rule_probes":0,"steps":2000} physical_200={"source_index_delete":400,"source_index_insert":0,"target_index_delete":2,"target_index_insert":0,"target_rows":200}
REAL adoption source=posts n=50000 mode=calendar groups=50000 ms=5884.015 store=sqlite-memory resumable_chunks=0
REAL write source=posts mode=calendar op=add n=200 p50_us=121.708 p95_us=172.625 last_meter={"examined":1,"index_entries":2,"rule_probes":0,"steps":19,"heap_bytes":1363,"output_bytes":165,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":272600,"index_entries":400,"output_bytes":33000,"rows_written":400,"rule_probes":0,"steps":3800} physical_200={"source_index_delete":0,"source_index_insert":400,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=posts mode=calendar op=unrelated n=200 p50_us=106.084 p95_us=119.459 last_meter={"examined":1,"index_entries":0,"rule_probes":0,"steps":21,"heap_bytes":1499,"output_bytes":166,"rows_written":1} meter_sum_200={"examined":200,"heap_bytes":299800,"index_entries":0,"output_bytes":33200,"rows_written":200,"rule_probes":0,"steps":4200} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=posts mode=calendar op=decrease n=200 p50_us=136.458 p95_us=227.459 last_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":21,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":0,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":4200} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=posts mode=calendar op=enter n=200 p50_us=139.500 p95_us=233.541 last_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":21,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":0,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":4200} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=posts mode=calendar op=keyMove n=200 p50_us=188.292 p95_us=277.125 last_meter={"examined":3,"index_entries":2,"rule_probes":0,"steps":22,"heap_bytes":1583,"output_bytes":173,"rows_written":3} meter_sum_200={"examined":600,"heap_bytes":316600,"index_entries":402,"output_bytes":34600,"rows_written":600,"rule_probes":0,"steps":4400} physical_200={"source_index_delete":200,"source_index_insert":200,"target_index_delete":0,"target_index_insert":2,"target_rows":400}
REAL write source=posts mode=calendar op=remove n=200 p50_us=96.166 p95_us=116.750 last_meter={"examined":1,"index_entries":4,"rule_probes":0,"steps":12,"heap_bytes":32,"output_bytes":6,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":6400,"index_entries":402,"output_bytes":1200,"rows_written":400,"rule_probes":0,"steps":2400} physical_200={"source_index_delete":400,"source_index_insert":0,"target_index_delete":2,"target_index_insert":0,"target_rows":200}
REAL adoption source=posts n=50000 mode=rank groups=1000 ms=3312.036 store=sqlite-memory resumable_chunks=0
REAL write source=posts mode=rank op=add n=200 p50_us=128.500 p95_us=192.792 last_meter={"examined":1,"index_entries":4,"rule_probes":0,"steps":14,"heap_bytes":1363,"output_bytes":165,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":272600,"index_entries":800,"output_bytes":33000,"rows_written":400,"rule_probes":0,"steps":2800} physical_200={"source_index_delete":0,"source_index_insert":400,"target_index_delete":200,"target_index_insert":200,"target_rows":200}
REAL write source=posts mode=rank op=unrelated n=200 p50_us=102.167 p95_us=209.042 last_meter={"examined":1,"index_entries":0,"rule_probes":0,"steps":11,"heap_bytes":1499,"output_bytes":166,"rows_written":1} meter_sum_200={"examined":200,"heap_bytes":299800,"index_entries":0,"output_bytes":33200,"rows_written":200,"rule_probes":0,"steps":2200} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=posts mode=rank op=decrease n=200 p50_us=145.958 p95_us=212.208 last_meter={"examined":2,"index_entries":2,"rule_probes":0,"steps":11,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":400,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":2200} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":200,"target_index_insert":200,"target_rows":200}
REAL write source=posts mode=rank op=enter n=200 p50_us=143.792 p95_us=217.542 last_meter={"examined":2,"index_entries":2,"rule_probes":0,"steps":11,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":400,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":2200} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":200,"target_index_insert":200,"target_rows":200}
REAL write source=posts mode=rank op=keyMove n=200 p50_us=196.583 p95_us=235.750 last_meter={"examined":3,"index_entries":6,"rule_probes":0,"steps":12,"heap_bytes":1583,"output_bytes":173,"rows_written":3} meter_sum_200={"examined":600,"heap_bytes":316600,"index_entries":1201,"output_bytes":34600,"rows_written":600,"rule_probes":0,"steps":2400} physical_200={"source_index_delete":200,"source_index_insert":200,"target_index_delete":399,"target_index_insert":402,"target_rows":400}
REAL write source=posts mode=rank op=remove n=200 p50_us=100.833 p95_us=130.208 last_meter={"examined":1,"index_entries":5,"rule_probes":0,"steps":7,"heap_bytes":32,"output_bytes":6,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":6400,"index_entries":801,"output_bytes":1200,"rows_written":400,"rule_probes":0,"steps":1400} physical_200={"source_index_delete":400,"source_index_insert":0,"target_index_delete":202,"target_index_insert":199,"target_rows":200}
REAL rank source=posts n=200 p50_us=90.416 p95_us=125.875 last_meter={"examined":11,"index_entries":0,"rule_probes":0,"steps":3,"heap_bytes":3150,"output_bytes":901,"rows_written":0}
REAL adoption source=posts n=50000 mode=expiry groups=50000 ms=6596.769 store=sqlite-memory resumable_chunks=0
REAL write source=posts mode=expiry op=add n=200 p50_us=152.125 p95_us=298.333 last_meter={"examined":1,"index_entries":4,"rule_probes":0,"steps":26,"heap_bytes":1533,"output_bytes":186,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":306600,"index_entries":800,"output_bytes":37200,"rows_written":400,"rule_probes":0,"steps":5200} physical_200={"source_index_delete":0,"source_index_insert":800,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=posts mode=expiry op=unrelated n=200 p50_us=133.709 p95_us=219.584 last_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":33,"heap_bytes":1669,"output_bytes":187,"rows_written":1} meter_sum_200={"examined":400,"heap_bytes":333800,"index_entries":0,"output_bytes":37400,"rows_written":200,"rule_probes":0,"steps":6600} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=posts mode=expiry op=decrease n=200 p50_us=219.417 p95_us=467.625 last_meter={"examined":3,"index_entries":1,"rule_probes":0,"steps":33,"heap_bytes":1662,"output_bytes":187,"rows_written":2} meter_sum_200={"examined":600,"heap_bytes":332400,"index_entries":200,"output_bytes":37400,"rows_written":400,"rule_probes":0,"steps":6600} physical_200={"source_index_delete":200,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=posts mode=expiry op=enter n=200 p50_us=198.917 p95_us=445.500 last_meter={"examined":3,"index_entries":1,"rule_probes":0,"steps":33,"heap_bytes":1662,"output_bytes":187,"rows_written":2} meter_sum_200={"examined":600,"heap_bytes":332400,"index_entries":200,"output_bytes":37400,"rows_written":400,"rule_probes":0,"steps":6600} physical_200={"source_index_delete":0,"source_index_insert":200,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=posts mode=expiry op=keyMove n=200 p50_us=251.375 p95_us=344.584 last_meter={"examined":4,"index_entries":4,"rule_probes":0,"steps":34,"heap_bytes":1753,"output_bytes":194,"rows_written":3} meter_sum_200={"examined":800,"heap_bytes":350600,"index_entries":802,"output_bytes":38800,"rows_written":600,"rule_probes":0,"steps":6800} physical_200={"source_index_delete":400,"source_index_insert":400,"target_index_delete":0,"target_index_insert":2,"target_rows":400}
REAL write source=posts mode=expiry op=remove n=200 p50_us=143.334 p95_us=262.000 last_meter={"examined":1,"index_entries":6,"rule_probes":0,"steps":18,"heap_bytes":32,"output_bytes":6,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":6400,"index_entries":802,"output_bytes":1200,"rows_written":400,"rule_probes":0,"steps":3600} physical_200={"source_index_delete":800,"source_index_insert":0,"target_index_delete":2,"target_index_insert":0,"target_rows":200}
REAL expiry source=posts before=1 after=0 next_expiry=Some(2000) before_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":20,"heap_bytes":821,"output_bytes":9,"rows_written":0} after_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":19,"heap_bytes":5,"output_bytes":9,"rows_written":0}
REAL adoption source=messages n=100000 mode=filter0 groups=0 ms=5194.768 store=sqlite-memory resumable_chunks=0
REAL write source=messages mode=filter0 op=add n=200 p50_us=82.500 p95_us=96.417 last_meter={"examined":0,"index_entries":2,"rule_probes":0,"steps":17,"heap_bytes":1363,"output_bytes":165,"rows_written":1} meter_sum_200={"examined":0,"heap_bytes":272600,"index_entries":400,"output_bytes":33000,"rows_written":200,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":400,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=messages mode=filter0 op=unrelated n=200 p50_us=100.208 p95_us=106.708 last_meter={"examined":1,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1499,"output_bytes":166,"rows_written":1} meter_sum_200={"examined":200,"heap_bytes":299800,"index_entries":0,"output_bytes":33200,"rows_written":200,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=messages mode=filter0 op=decrease n=200 p50_us=99.208 p95_us=102.458 last_meter={"examined":1,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1492,"output_bytes":166,"rows_written":1} meter_sum_200={"examined":200,"heap_bytes":298400,"index_entries":0,"output_bytes":33200,"rows_written":200,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=messages mode=filter0 op=enter n=200 p50_us=124.000 p95_us=138.791 last_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":2,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":2,"target_rows":200}
REAL write source=messages mode=filter0 op=keyMove n=200 p50_us=166.416 p95_us=215.792 last_meter={"examined":3,"index_entries":4,"rule_probes":0,"steps":18,"heap_bytes":1583,"output_bytes":173,"rows_written":3} meter_sum_200={"examined":600,"heap_bytes":316600,"index_entries":404,"output_bytes":34600,"rows_written":600,"rule_probes":0,"steps":3600} physical_200={"source_index_delete":200,"source_index_insert":200,"target_index_delete":2,"target_index_insert":2,"target_rows":400}
REAL write source=messages mode=filter0 op=remove n=200 p50_us=84.583 p95_us=138.917 last_meter={"examined":1,"index_entries":4,"rule_probes":0,"steps":10,"heap_bytes":32,"output_bytes":6,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":6400,"index_entries":402,"output_bytes":1200,"rows_written":400,"rule_probes":0,"steps":2000} physical_200={"source_index_delete":400,"source_index_insert":0,"target_index_delete":2,"target_index_insert":0,"target_rows":200}
REAL adoption source=messages n=100000 mode=filter50 groups=500 ms=5837.429 store=sqlite-memory resumable_chunks=0
REAL write source=messages mode=filter50 op=add n=200 p50_us=103.500 p95_us=125.000 last_meter={"examined":0,"index_entries":2,"rule_probes":0,"steps":17,"heap_bytes":1363,"output_bytes":165,"rows_written":1} meter_sum_200={"examined":100,"heap_bytes":272600,"index_entries":400,"output_bytes":33000,"rows_written":300,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":400,"target_index_delete":0,"target_index_insert":0,"target_rows":100}
REAL write source=messages mode=filter50 op=unrelated n=200 p50_us=100.666 p95_us=104.417 last_meter={"examined":1,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1499,"output_bytes":166,"rows_written":1} meter_sum_200={"examined":200,"heap_bytes":299800,"index_entries":0,"output_bytes":33200,"rows_written":200,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=messages mode=filter50 op=decrease n=200 p50_us=121.958 p95_us=126.125 last_meter={"examined":1,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1492,"output_bytes":166,"rows_written":1} meter_sum_200={"examined":300,"heap_bytes":298400,"index_entries":0,"output_bytes":33200,"rows_written":300,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":100}
REAL write source=messages mode=filter50 op=enter n=200 p50_us=123.541 p95_us=126.709 last_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":0,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=messages mode=filter50 op=keyMove n=200 p50_us=163.459 p95_us=186.000 last_meter={"examined":3,"index_entries":2,"rule_probes":0,"steps":18,"heap_bytes":1583,"output_bytes":173,"rows_written":3} meter_sum_200={"examined":600,"heap_bytes":316600,"index_entries":402,"output_bytes":34600,"rows_written":600,"rule_probes":0,"steps":3600} physical_200={"source_index_delete":200,"source_index_insert":200,"target_index_delete":0,"target_index_insert":2,"target_rows":400}
REAL write source=messages mode=filter50 op=remove n=200 p50_us=83.167 p95_us=105.125 last_meter={"examined":1,"index_entries":4,"rule_probes":0,"steps":10,"heap_bytes":32,"output_bytes":6,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":6400,"index_entries":402,"output_bytes":1200,"rows_written":400,"rule_probes":0,"steps":2000} physical_200={"source_index_delete":400,"source_index_insert":0,"target_index_delete":2,"target_index_insert":0,"target_rows":200}
REAL adoption source=messages n=100000 mode=filter100 groups=1000 ms=6658.824 store=sqlite-memory resumable_chunks=0
REAL write source=messages mode=filter100 op=add n=200 p50_us=109.333 p95_us=175.750 last_meter={"examined":1,"index_entries":2,"rule_probes":0,"steps":17,"heap_bytes":1363,"output_bytes":165,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":272600,"index_entries":400,"output_bytes":33000,"rows_written":400,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":400,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=messages mode=filter100 op=unrelated n=200 p50_us=108.958 p95_us=181.500 last_meter={"examined":1,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1499,"output_bytes":166,"rows_written":1} meter_sum_200={"examined":200,"heap_bytes":299800,"index_entries":0,"output_bytes":33200,"rows_written":200,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=messages mode=filter100 op=decrease n=200 p50_us=125.167 p95_us=176.333 last_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":0,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=messages mode=filter100 op=enter n=200 p50_us=132.292 p95_us=180.333 last_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":17,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":0,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":3400} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=messages mode=filter100 op=keyMove n=200 p50_us=172.292 p95_us=259.875 last_meter={"examined":3,"index_entries":2,"rule_probes":0,"steps":18,"heap_bytes":1583,"output_bytes":173,"rows_written":3} meter_sum_200={"examined":600,"heap_bytes":316600,"index_entries":402,"output_bytes":34600,"rows_written":600,"rule_probes":0,"steps":3600} physical_200={"source_index_delete":200,"source_index_insert":200,"target_index_delete":0,"target_index_insert":2,"target_rows":400}
REAL write source=messages mode=filter100 op=remove n=200 p50_us=89.083 p95_us=123.417 last_meter={"examined":1,"index_entries":4,"rule_probes":0,"steps":10,"heap_bytes":32,"output_bytes":6,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":6400,"index_entries":402,"output_bytes":1200,"rows_written":400,"rule_probes":0,"steps":2000} physical_200={"source_index_delete":400,"source_index_insert":0,"target_index_delete":2,"target_index_insert":0,"target_rows":200}
REAL adoption source=messages n=100000 mode=calendar groups=100000 ms=11899.762 store=sqlite-memory resumable_chunks=0
REAL write source=messages mode=calendar op=add n=200 p50_us=114.583 p95_us=163.833 last_meter={"examined":1,"index_entries":2,"rule_probes":0,"steps":19,"heap_bytes":1363,"output_bytes":165,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":272600,"index_entries":400,"output_bytes":33000,"rows_written":400,"rule_probes":0,"steps":3800} physical_200={"source_index_delete":0,"source_index_insert":400,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=messages mode=calendar op=unrelated n=200 p50_us=104.750 p95_us=188.916 last_meter={"examined":1,"index_entries":0,"rule_probes":0,"steps":21,"heap_bytes":1499,"output_bytes":166,"rows_written":1} meter_sum_200={"examined":200,"heap_bytes":299800,"index_entries":0,"output_bytes":33200,"rows_written":200,"rule_probes":0,"steps":4200} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=messages mode=calendar op=decrease n=200 p50_us=130.084 p95_us=183.459 last_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":21,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":0,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":4200} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=messages mode=calendar op=enter n=200 p50_us=128.875 p95_us=143.542 last_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":21,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":0,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":4200} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=messages mode=calendar op=keyMove n=200 p50_us=171.916 p95_us=188.792 last_meter={"examined":3,"index_entries":2,"rule_probes":0,"steps":22,"heap_bytes":1583,"output_bytes":173,"rows_written":3} meter_sum_200={"examined":600,"heap_bytes":316600,"index_entries":402,"output_bytes":34600,"rows_written":600,"rule_probes":0,"steps":4400} physical_200={"source_index_delete":200,"source_index_insert":200,"target_index_delete":0,"target_index_insert":2,"target_rows":400}
REAL write source=messages mode=calendar op=remove n=200 p50_us=87.084 p95_us=95.750 last_meter={"examined":1,"index_entries":4,"rule_probes":0,"steps":12,"heap_bytes":32,"output_bytes":6,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":6400,"index_entries":402,"output_bytes":1200,"rows_written":400,"rule_probes":0,"steps":2400} physical_200={"source_index_delete":400,"source_index_insert":0,"target_index_delete":2,"target_index_insert":0,"target_rows":200}
REAL adoption source=messages n=100000 mode=rank groups=1000 ms=5296.803 store=sqlite-memory resumable_chunks=0
REAL write source=messages mode=rank op=add n=200 p50_us=125.000 p95_us=145.208 last_meter={"examined":1,"index_entries":4,"rule_probes":0,"steps":14,"heap_bytes":1363,"output_bytes":165,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":272600,"index_entries":800,"output_bytes":33000,"rows_written":400,"rule_probes":0,"steps":2800} physical_200={"source_index_delete":0,"source_index_insert":400,"target_index_delete":200,"target_index_insert":200,"target_rows":200}
REAL write source=messages mode=rank op=unrelated n=200 p50_us=100.542 p95_us=107.542 last_meter={"examined":1,"index_entries":0,"rule_probes":0,"steps":11,"heap_bytes":1499,"output_bytes":166,"rows_written":1} meter_sum_200={"examined":200,"heap_bytes":299800,"index_entries":0,"output_bytes":33200,"rows_written":200,"rule_probes":0,"steps":2200} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=messages mode=rank op=decrease n=200 p50_us=141.375 p95_us=154.875 last_meter={"examined":2,"index_entries":2,"rule_probes":0,"steps":11,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":400,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":2200} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":200,"target_index_insert":200,"target_rows":200}
REAL write source=messages mode=rank op=enter n=200 p50_us=139.792 p95_us=145.792 last_meter={"examined":2,"index_entries":2,"rule_probes":0,"steps":11,"heap_bytes":1492,"output_bytes":166,"rows_written":2} meter_sum_200={"examined":400,"heap_bytes":298400,"index_entries":400,"output_bytes":33200,"rows_written":400,"rule_probes":0,"steps":2200} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":200,"target_index_insert":200,"target_rows":200}
REAL write source=messages mode=rank op=keyMove n=200 p50_us=193.500 p95_us=203.459 last_meter={"examined":3,"index_entries":6,"rule_probes":0,"steps":12,"heap_bytes":1583,"output_bytes":173,"rows_written":3} meter_sum_200={"examined":600,"heap_bytes":316600,"index_entries":1201,"output_bytes":34600,"rows_written":600,"rule_probes":0,"steps":2400} physical_200={"source_index_delete":200,"source_index_insert":200,"target_index_delete":399,"target_index_insert":402,"target_rows":400}
REAL write source=messages mode=rank op=remove n=200 p50_us=98.500 p95_us=108.500 last_meter={"examined":1,"index_entries":5,"rule_probes":0,"steps":7,"heap_bytes":32,"output_bytes":6,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":6400,"index_entries":801,"output_bytes":1200,"rows_written":400,"rule_probes":0,"steps":1400} physical_200={"source_index_delete":400,"source_index_insert":0,"target_index_delete":202,"target_index_insert":199,"target_rows":200}
REAL rank source=messages n=200 p50_us=88.958 p95_us=93.083 last_meter={"examined":11,"index_entries":0,"rule_probes":0,"steps":3,"heap_bytes":3150,"output_bytes":911,"rows_written":0}
REAL adoption source=messages n=100000 mode=expiry groups=100000 ms=13675.413 store=sqlite-memory resumable_chunks=0
REAL write source=messages mode=expiry op=add n=200 p50_us=145.250 p95_us=197.500 last_meter={"examined":1,"index_entries":4,"rule_probes":0,"steps":26,"heap_bytes":1533,"output_bytes":186,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":306600,"index_entries":800,"output_bytes":37200,"rows_written":400,"rule_probes":0,"steps":5200} physical_200={"source_index_delete":0,"source_index_insert":800,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=messages mode=expiry op=unrelated n=200 p50_us=128.750 p95_us=138.125 last_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":33,"heap_bytes":1669,"output_bytes":187,"rows_written":1} meter_sum_200={"examined":400,"heap_bytes":333800,"index_entries":0,"output_bytes":37400,"rows_written":200,"rule_probes":0,"steps":6600} physical_200={"source_index_delete":0,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":0}
REAL write source=messages mode=expiry op=decrease n=200 p50_us=163.167 p95_us=176.291 last_meter={"examined":3,"index_entries":1,"rule_probes":0,"steps":33,"heap_bytes":1662,"output_bytes":187,"rows_written":2} meter_sum_200={"examined":600,"heap_bytes":332400,"index_entries":200,"output_bytes":37400,"rows_written":400,"rule_probes":0,"steps":6600} physical_200={"source_index_delete":200,"source_index_insert":0,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=messages mode=expiry op=enter n=200 p50_us=165.584 p95_us=212.666 last_meter={"examined":3,"index_entries":1,"rule_probes":0,"steps":33,"heap_bytes":1662,"output_bytes":187,"rows_written":2} meter_sum_200={"examined":600,"heap_bytes":332400,"index_entries":200,"output_bytes":37400,"rows_written":400,"rule_probes":0,"steps":6600} physical_200={"source_index_delete":0,"source_index_insert":200,"target_index_delete":0,"target_index_insert":0,"target_rows":200}
REAL write source=messages mode=expiry op=keyMove n=200 p50_us=236.250 p95_us=404.958 last_meter={"examined":4,"index_entries":4,"rule_probes":0,"steps":34,"heap_bytes":1753,"output_bytes":194,"rows_written":3} meter_sum_200={"examined":800,"heap_bytes":350600,"index_entries":802,"output_bytes":38800,"rows_written":600,"rule_probes":0,"steps":6800} physical_200={"source_index_delete":400,"source_index_insert":400,"target_index_delete":0,"target_index_insert":2,"target_rows":400}
REAL write source=messages mode=expiry op=remove n=200 p50_us=113.542 p95_us=137.542 last_meter={"examined":1,"index_entries":6,"rule_probes":0,"steps":18,"heap_bytes":32,"output_bytes":6,"rows_written":2} meter_sum_200={"examined":200,"heap_bytes":6400,"index_entries":802,"output_bytes":1200,"rows_written":400,"rule_probes":0,"steps":3600} physical_200={"source_index_delete":800,"source_index_insert":0,"target_index_delete":2,"target_index_insert":0,"target_rows":200}
REAL expiry source=messages before=1 after=0 next_expiry=Some(2000) before_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":20,"heap_bytes":821,"output_bytes":9,"rows_written":0} after_meter={"examined":2,"index_entries":0,"rule_probes":0,"steps":19,"heap_bytes":5,"output_bytes":9,"rows_written":0}
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 129.91s
```

### Validation and regression evidence

The targeted cargo commands reported below ran from snapback4/. An initial
cargo test invocation at the repository root exited before running tests
because the package is outside that workspace; it was rerun from snapback4/.
No root workspace code changed. Node used the pinned Node 24 path:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
```

```sh
cargo test -p snapback4-lang --test maintains
```

Red (`/private/tmp/d1-lang-red.log`):

```text
test result: FAILED. 0 passed; 3 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

Green (`/private/tmp/d1-final-lang.log`):

```text
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

```sh
cargo test -p snapback4-sim --test maintains
```

Red (`/private/tmp/d1-base-sim-regressions.log`):

```text
test result: FAILED. 2 passed; 9 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
```

Green (`/private/tmp/d1-final-sim.log`):

```text
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.82s
```

```sh
cargo test -p snapback4-device --test device maintains
```

Red (`/private/tmp/d1-base-device-regressions.log`):

```text
test result: FAILED. 0 passed; 3 failed; 0 ignored; 0 measured; 51 filtered out; finished in 0.00s
```

Green (`/private/tmp/d1-final-device.log`):

```text
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 51 filtered out; finished in 0.08s
```

```sh
cargo test -p snapback4-device --test device the_feeds_card_predicts
```

Red (`/private/tmp/d1-base-feeds-regression.log`):

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 0.03s
```

Green (`/private/tmp/d1-final-feeds.log`):

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 53 filtered out; finished in 0.03s
```

```sh
node --test packages/snapback4/test/maintains.test.mjs
```

Red (`/private/tmp/d1-base-client-regressions.log`):

```text
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1960.389042
```

Green (`/private/tmp/d1-final-client.log`):

```text
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 404.836
```

```sh
cargo test -p snapback4-lang --test guide
```

Green (`/private/tmp/d1-final-guide.log`):

```text
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
```

```sh
cargo test -p snapback4-sim --test maintains hidden_filter_work
```

Green (`/private/tmp/d1-hidden-final.log`):

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 10 filtered out; finished in 14.99s
```

The initial language and simulator regressions were red before implementation
(0 passed / 3 failed in each). Later isolated regressions caught not-comparison
precedence, identity literal coercion, missing rank scope and adoption's final
sum assessment; each was rerun green. The final simulator/device/client
regressions were also run with production source restored from the exact base
commit, then restored byte-for-byte to D1. The two passing base simulator
controls were the shared observation helper and the existing chips runtime.
No repository clone, branch switch, stash, reset, commit or push was used.

The wider hidden test compares first/retry wire bytes, durable receipts,
all seven meters, effects, stream/snapshot and both devices through reopen
and settlement. It also compares server query data, completeness, cursor,
dependency tables, expiry and cap/error metadata. It covers true/false,
hidden-refused/absent and expiring/non-expiring worlds at low limits, around
observed work thresholds, and around 16/64 KiB heap limits.

### Full-suite and base failures

```sh
bash scripts/test.sh > /private/tmp/d1-suite-first.log 2>&1
```

```text
-- FAIL: cargo test (285 s)
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9542.980208
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ before acquisition write: {"state":"pending","id":"01M2H6A9TT9GXB48N373WK4WG3"}; durable queue: [{"args":{"body":"queued before acquisition"},"id":"01M2H6A9TT9GXB48N373WK4WG3","new_ids":["01M2H6A9TVP5MABFZ00YKHKEWA","01M2H6A9TWYRDPJ73EWSJSJCE4","01M2H6A9TX7H6TSWPZHS0HDQ5Z","01M2H6A9TY162T1APNZTJEMH6P","01M2H6A9TZRMRQS35WT8RTXS81","01M2H6A9V085YJCNGVD94AQWWB","01M2H6A9V13X20A6J42VY9J9SQ","01M2H6A9V2DK95FBCF52KNKZ3H"],"now":1789430933339,"observed_seq":null,"op":"add","predictable":false,"predicted":[],"sent_seq":null,"seq":1,"viewer":"dev:alice"}]
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ before acquisition write: {"state":"pending","id":"01M2H6AHVXYZ1EJCTNPB9NWGJY"}; durable queue: [{"args":{"body":"queued before acquisition"},"id":"01M2H6AHVXYZ1EJCTNPB9NWGJY","new_ids":["01M2H6AHVYH6C7FSGZKE8KQTKR","01M2H6AHVZSNR9638KPK927M10","01M2H6AHW0YWK5HT10ME6G9YFS","01M2H6AHW15YZPHGNREDW7CQY9","01M2H6AHW2F1VRKAXGH1ZFX4VA","01M2H6AHW3RVN32BCP34GQ71FG","01M2H6AHW47M43ETHHSNXGMF31","01M2H6AHW5JRYMN3Z0JCMTECKV"],"now":1789430941566,"observed_seq":null,"op":"add","predictable":false,"predicted":[],"sent_seq":null,"seq":1,"viewer":"dev:alice"}]
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ wire={"id":"01M2H6ADCE7SW3NFXF91SF72FA","replayed":true,"seq":3,"state":"sent"}; client={"state":"sent","id":"01M2H6ADCE7SW3NFXF91SF72FA","seq":3,"replayed":true}; result key=false
ℹ wire={"id":"01M2H6ADPJW7YX65CP3BV5FBCW","replayed":true,"seq":3,"state":"sent"}; client={"state":"sent","id":"01M2H6ADPJW7YX65CP3BV5FBCW","seq":3,"replayed":true}; result key=false
ℹ wire={"id":"01M2H6AEKA2H9ENZV9CFEE64SK","replayed":true,"seq":3,"state":"sent"}; client={"state":"sent","id":"01M2H6AEKA2H9ENZV9CFEE64SK","seq":3,"replayed":true}; result key=false
ℹ wire={"id":"01M2H6AER7H08M4AXZ2ZJVVSF9","replayed":true,"seq":3,"state":"sent"}; client={"state":"sent","id":"01M2H6AER7H08M4AXZ2ZJVVSF9","seq":3,"replayed":true}; result key=false
ℹ media: 68 B/image; maxBytes 136; 2 retained then 0 with keep:none; once bytes 0; deleted home bytes 0
ℹ identity: 200 guest sign-ins + 200 same-email attempts; dev E_RATE_LIMIT=0; serve peer 31 and email 11 refused; 4239 ms
ℹ video: 60 B retained; duration 1000 ms; id-only pending prediction agrees with sent.result after reopen
ℹ token dev default: stdout 44 B; redeemed session queried as member:captured
ℹ token dev --days 1: stdout 44 B; redeemed session queried as member:captured
ℹ token dev --days=2 --service=worker: stdout 44 B; redeemed session queried as member:captured
ℹ token dev --json: stdout 44 B; redeemed session queried as member:captured
ℹ token serve default: stdout 44 B; redeemed session queried as member:captured
ℹ token serve --days 1: stdout 44 B; redeemed session queried as member:captured
ℹ token serve --days=2 --service=worker: stdout 44 B; redeemed session queried as member:captured
ℹ token serve --json: stdout 44 B; redeemed session queried as member:captured
ℹ SQL count of 205 messages with WAL writer held: 7.18 ms
ℹ 12 README blocks; 36 public functions; 1695.48 ms
ℹ recovery point: release 1, generation 1, sequence 1; post-backup original writes excluded; queued effects never delivered
ℹ action round trip tier=online: 13.29 ms
ℹ action round trip tier=device: 16.96 ms
ℹ pending wait: 1011.41 ms
ℹ tests 188
ℹ suites 0
ℹ pass 186
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 46043.808375
-- FAIL: client tests (46 s)
== 2 failure(s) in 331 s
```

```sh
bash snapback4/scripts/test.sh > /private/tmp/d1-suite-final.log 2>&1
```

```text
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7808.689083
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ before acquisition write: {"state":"pending","id":"01M2H7MRYWWBK2YFXAZQNFX26P"}; durable queue: [{"args":{"body":"queued before acquisition"},"id":"01M2H7MRYWWBK2YFXAZQNFX26P","new_ids":["01M2H7MRYX3A7AGFZ5QKDP9YZB","01M2H7MRYY5JXX17ZPCED5PZTJ","01M2H7MRYZ8Q4RQ42VPG735Y3P","01M2H7MRZ0JHZFMD49WGSYPBP0","01M2H7MRZ18TZF6K2X4AV2YTCZ","01M2H7MRZ2QY61N3T94EZTEJQB","01M2H7MRZ3ZPK73RSGXPWVC9X6","01M2H7MRZ47F517SZYRBN2BEHJ"],"now":1789432325084,"observed_seq":null,"op":"add","predictable":false,"predicted":[],"sent_seq":null,"seq":1,"viewer":"dev:alice"}]
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ before acquisition write: {"state":"pending","id":"01M2H7N21QRZT0E6KZ3S88F0FB"}; durable queue: [{"args":{"body":"queued before acquisition"},"id":"01M2H7N21QRZT0E6KZ3S88F0FB","new_ids":["01M2H7N21RRYJBFFG18ZAVXAQF","01M2H7N21S1BFSSNNZVM42M0W0","01M2H7N21TG58K7F0921Z5BXNB","01M2H7N21VCZRT9F8DZR84KEDY","01M2H7N21WTDK35YX6RWSSFNSG","01M2H7N21X6MV09ND3XEHGPQDE","01M2H7N21YKPC73Y07RF6YZQ6A","01M2H7N21Z4S5X0NXZ3R4NM56K"],"now":1789432334391,"observed_seq":null,"op":"add","predictable":false,"predicted":[],"sent_seq":null,"seq":1,"viewer":"dev:alice"}]
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ wire={"id":"01M2H7MWS5G8QZA1D1ZYPNR4GR","replayed":true,"seq":3,"state":"sent"}; client={"state":"sent","id":"01M2H7MWS5G8QZA1D1ZYPNR4GR","seq":3,"replayed":true}; result key=false
ℹ wire={"id":"01M2H7MX3MER1N935FCT1F1BCD","replayed":true,"seq":3,"state":"sent"}; client={"state":"sent","id":"01M2H7MX3MER1N935FCT1F1BCD","seq":3,"replayed":true}; result key=false
ℹ wire={"id":"01M2H7MXXPNP62GWFQMT75TJJV","replayed":true,"seq":3,"state":"sent"}; client={"state":"sent","id":"01M2H7MXXPNP62GWFQMT75TJJV","seq":3,"replayed":true}; result key=false
ℹ wire={"id":"01M2H7MY0P706JAJ1XEAWTN896","replayed":true,"seq":3,"state":"sent"}; client={"state":"sent","id":"01M2H7MY0P706JAJ1XEAWTN896","seq":3,"replayed":true}; result key=false
ℹ media: 68 B/image; maxBytes 136; 2 retained then 0 with keep:none; once bytes 0; deleted home bytes 0
ℹ identity: 200 guest sign-ins + 200 same-email attempts; dev E_RATE_LIMIT=0; serve peer 31 and email 11 refused; 1194 ms
ℹ video: 60 B retained; duration 1000 ms; id-only pending prediction agrees with sent.result after reopen
ℹ token dev default: stdout 44 B; redeemed session queried as member:captured
ℹ token dev --days 1: stdout 44 B; redeemed session queried as member:captured
ℹ token dev --days=2 --service=worker: stdout 44 B; redeemed session queried as member:captured
ℹ token dev --json: stdout 44 B; redeemed session queried as member:captured
ℹ token serve default: stdout 44 B; redeemed session queried as member:captured
ℹ token serve --days 1: stdout 44 B; redeemed session queried as member:captured
ℹ token serve --days=2 --service=worker: stdout 44 B; redeemed session queried as member:captured
ℹ token serve --json: stdout 44 B; redeemed session queried as member:captured
ℹ SQL count of 205 messages with WAL writer held: 7.03 ms
ℹ 12 README blocks; 36 public functions; 1224.32 ms
ℹ recovery point: release 1, generation 1, sequence 1; post-backup original writes excluded; queued effects never delivered
ℹ action round trip tier=online: 10.71 ms
ℹ action round trip tier=device: 13.42 ms
ℹ pending wait: 1009.38 ms
ℹ tests 190
ℹ suites 0
ℹ pass 188
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 41930.2525
-- FAIL: client tests (42 s)
== 1 failure(s) in 251 s
```

The first run additionally found the feeds-card test expecting an online-only
aggregate overlay. Its expectation now matches this slice; the targeted
regression and the second run's entire Rust workspace pass. The remaining
client failures reproduce in isolated tests built from base
397c0a829001f1df4f1e096d9bdee5693a56416d: Chromium SIGABRT in react.test.mjs,
and web-navigation.test.mjs:159 expecting the first device core to reject
after the injected disk-full save. No lifecycle timeout occurred in these
runs. The lead must rerun the browser witness outside the sandbox.

```sh
node --test --test-name-pattern='failed persistence' packages/snapback4/test/web-navigation.test.mjs
```

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1395.933292
```

```sh
node --test packages/snapback4/test/react.test.mjs
```

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 403.450416
```

The root caps command reports two unchanged base violations: working set
65 of 59, and crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs
at 1504 lines by caps' newline convention (205 oversize files against baseline
204). The rule file, cap runner, working-set links and offending file are
byte-identical to the exact base; git diff of those inputs exited 0.
All 37 changed code files are below 1,500 lines; the largest is 1,456 by
the cap runner's convention. No meter ceiling or existing corpus case changed.

Minimal changes outside the brief's named files: CLI verbs/adoption.rs
maps maintains[n] back to its declaration; parser/expr.rs recognizes the
literal bucket duration for query builtins; device/tests/upsert/mod.rs
updates the feeds expectation for online-only aggregate side effects.
Other touched files implement the requested runtime, binding, proof,
guide or acceptance paths.

### Diagnostic wording

The before fixture has count posts by author; the after fixture adds
where .selected and day(.at). These are the actual CLI note lines:

Before:

```text
note: schema.q:11:1 — N_MAINTAIN_DELTA: maintain counts may disclose the delta of a hidden posts row: its update rule can be wider than its read rule, and the maintain has its own readable audience
  rewrite: treat the maintain as a declared read channel; restrict its read rule or the source update rule if the delta is private
  guide: rules
```

After:

```text
note: schema.q:11:1 — N_MAINTAIN_DELTA: maintain counts may disclose the delta of a hidden posts row: insert/delete and a potentially wider update rule affect this readable target; filter/key/value dependencies: at, author, selected
  rewrite: treat the maintain as a declared read channel; restrict its read rule or the source update rule if the delta is private
  guide: rules
```

New codes E_QUARRY_MAINTAIN and E_QUARRY_MAINTAIN_EXPIRE are registered in
guide::CODES; expression-specific refusals point to guide maintains and the
expiring value-index refusal points to guide expire. E_ADOPT is reused for
invalid interpreted contributions/final sums; no incomplete-adoption code
is introduced in this slice.

### Final complete run

From the repository root, after the final contribution-buffer reservation:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
bash snapback4/scripts/test.sh > /private/tmp/d1-suite-complete.log 2>&1
```

```text
wasm 1695854 B raw, 470041 B gzip
-- ok: cargo test (448 s)
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11652.66225
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ before acquisition write: {"state":"pending","id":"01M2H87EVXE9Q0APXNQHBVC9G8"}; durable queue: [{"args":{"body":"queued before acquisition"},"id":"01M2H87EVXE9Q0APXNQHBVC9G8","new_ids":["01M2H87EVY41WA5AV4JDZXHGRD","01M2H87EVZRMCP3C6PJNGYJ612","01M2H87EW0E9T468D7XZ8351H5","01M2H87EW1XHDGHE3HEA0AN7CE","01M2H87EW28QH2NB54A7V9DWQJ","01M2H87EW38ZXQ9HNB6X0ER9YY","01M2H87EW4Z9ZSY4XHGSVVCPKX","01M2H87EW5NCEFN9YQFTCFV2HX"],"now":1789432937342,"observed_seq":null,"op":"add","predictable":false,"predicted":[],"sent_seq":null,"seq":1,"viewer":"dev:alice"}]
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ before acquisition write: {"state":"pending","id":"01M2H87PYJ65DTEFH6QX0ZSXCV"}; durable queue: [{"args":{"body":"queued before acquisition"},"id":"01M2H87PYJ65DTEFH6QX0ZSXCV","new_ids":["01M2H87PYKNGBZGRCHB9F9S8TF","01M2H87PYMXPE9EY4P3F55Q3V0","01M2H87PYN5WSVN27ZJBRAG858","01M2H87PYPWH41T0Y3SWZETBE8","01M2H87PYQ1FFHXWKW39D6J1C9","01M2H87PYR7ND4EPG9BQ0B43X6","01M2H87PYS84PAFAWQP2GTJBR1","01M2H87PYTMEY36HWNQ4C4VK0R"],"now":1789432945618,"observed_seq":null,"op":"add","predictable":false,"predicted":[],"sent_seq":null,"seq":1,"viewer":"dev:alice"}]
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ unacquired answers: {"all":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"countAll":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"one":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}},"guarded":{"denied":{"code":"E_OFFLINE","family":"link","message":"the server is unreachable","retryable":true}}}
ℹ wire={"id":"01M2H87JNYFCZSVGRGFE77RDC4","replayed":true,"seq":3,"state":"sent"}; client={"state":"sent","id":"01M2H87JNYFCZSVGRGFE77RDC4","seq":3,"replayed":true}; result key=false
ℹ wire={"id":"01M2H87K106TMN3TBYQ6HHW2EA","replayed":true,"seq":3,"state":"sent"}; client={"state":"sent","id":"01M2H87K106TMN3TBYQ6HHW2EA","seq":3,"replayed":true}; result key=false
ℹ wire={"id":"01M2H87M0WAWFDPHCK1TW0SD6F","replayed":true,"seq":3,"state":"sent"}; client={"state":"sent","id":"01M2H87M0WAWFDPHCK1TW0SD6F","seq":3,"replayed":true}; result key=false
ℹ wire={"id":"01M2H87M7H303MH72ANE0R6CTP","replayed":true,"seq":3,"state":"sent"}; client={"state":"sent","id":"01M2H87M7H303MH72ANE0R6CTP","seq":3,"replayed":true}; result key=false
ℹ media: 68 B/image; maxBytes 136; 2 retained then 0 with keep:none; once bytes 0; deleted home bytes 0
ℹ identity: 200 guest sign-ins + 200 same-email attempts; dev E_RATE_LIMIT=0; serve peer 31 and email 11 refused; 3001 ms
ℹ video: 60 B retained; duration 1000 ms; id-only pending prediction agrees with sent.result after reopen
ℹ token dev default: stdout 44 B; redeemed session queried as member:captured
ℹ token dev --days 1: stdout 44 B; redeemed session queried as member:captured
ℹ token dev --days=2 --service=worker: stdout 44 B; redeemed session queried as member:captured
ℹ token dev --json: stdout 44 B; redeemed session queried as member:captured
ℹ token serve default: stdout 44 B; redeemed session queried as member:captured
ℹ token serve --days 1: stdout 44 B; redeemed session queried as member:captured
ℹ token serve --days=2 --service=worker: stdout 44 B; redeemed session queried as member:captured
ℹ token serve --json: stdout 44 B; redeemed session queried as member:captured
ℹ SQL count of 205 messages with WAL writer held: 7.63 ms
ℹ 12 README blocks; 36 public functions; 2355.08 ms
ℹ recovery point: release 1, generation 1, sequence 1; post-backup original writes excluded; queued effects never delivered
ℹ action round trip tier=online: 28.51 ms
ℹ action round trip tier=device: 23.91 ms
ℹ pending wait: 1012.15 ms
ℹ tests 190
ℹ suites 0
ℹ pass 188
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 46969.017167
-- FAIL: client tests (47 s)
== 1 failure(s) in 480 s
```

The Rust workspace totals 692 passed, 0 failed,
4 ignored. The expanded hidden-boundary matrix ran
in that suite. The two client failures are the same base-verified Chromium
and persistence assertions above. There are no failing affected Rust or D1
client tests. Full suite wall time was 480 s on this loaded host; its Rust
worker took 448 s. Final wasm is 1,695,854 bytes raw / 470,041 bytes gzip.

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
./ref-check --verbose > /private/tmp/d1-ref-final.log 2>&1
git diff --check
```

```text
ref-check: ok — 480 LLP docs, 8883 refs in 22925 files, 0 errors, 0 unchecked
D1 code caps: 37 files; max 1456 lines; 0 over 1500
```

git diff --check exited 0. The base journal prefix is byte-identical.
The working tree is left for the lead; nothing was committed or published.

## 2026-09-14 — D1R1: maintain occupancy, coverage, admission and cursors

Repaired the GPT review's five findings from
`b8ca38bbf24d26d5a4f062304ad6a0cb6eaff8e1`, with the worktree initially clean.
Read `/Users/ccheever/projects/snapback-d1-review/gpt.md` in full. No commit,
push, tag, publication, sub-agent, repository clone or remote machine was used.
The full-suite results below are sandbox runs on the shared host.

**What changed.** A zero-sum candidate can be retained by a local positive
source witness. A local negative needs source coverage with no horizon and a
currently held group; otherwise the prediction rolls back and queues without
rows. Live scalar misses and empty pages now check coverage before returning.
Every expiring maintain, filtered or not, has a selected contribution index;
physical occupancy uses `count_prefix(..., 1)`, never a source fallback.
Core and device schema entry points prepare that index for raw schemas too.
Prepayment covers two contribution images, the one-entry occupancy buffer and
encoded key, both target groups/indexes, and the source-index evaluations.
No meter ceiling moved. Actual hidden work remains prepaid; no population-based
charge is added after the lookup.

Public-subset inherited aggregates are conservatively server-class and unknown
locally, including a viewer-pinned read. Core validation rejects value indexes
on expiring maintains on creation and adoption, preserving the binder's
existing diagnostic. Direct page cursors now bind evaluated prefix values and
the active generation. Ordinary table pages reproduced the same defect, so
they use the same fix. Ordinary value changes and deletions keep an old cursor
valid; rows can move between pages. Query-issued cursors also work in mutations
and outbox replay under the same generation. Merge/search shared-lane cursor
semantics were not changed.

**Finding 3 qualification.** The literal public-source `sync to .owner`
Quarry example does not compile at this base: the binder emits E_SYNC. I did
not widen that other lane's syntax. Core raw-schema admission already accepts
the subset, and that admitted form reproduces false completeness on both
stores. The test compiles public sync, changes the source and inherited target
to the column subset through the raw schema API, and recomputes execution
facts. It covers the viewer, another owner and an unpinned page. Server reads
remain complete; local reads are conservatively unknown after the fix.

**Red before green.** Production code was unchanged for each finding's base
reproduction. Fixture compile/setup errors were corrected before treating a
failure as evidence. The first combined device run below also contains the
initial subset fixture error; the separate subset run supplies finding 3's
actual runtime reproduction. The baseline physical test's paired observation
control was already green; its independent scan bound was red.

Commands run from `snapback4/` unless marked root; log paths are under
`/private/tmp/`. Repeated setup runs with no executing regression are not
counted as reproductions. One mistaken root-level cargo invocation refused
before running tests; all executing cargo suites ran inside `snapback4/`.

| Finding | Base command / log | Verbatim summary | Green coverage |
|---|---|---|---|
| 1: a/b/c history and clock tick, both stores | `cargo test -p snapback4-device --test device maintains::review -- --nocapture` (`d1r1-red-device.log`) | `test result: FAILED. 0 passed; 10 failed; 0 ignored; 0 measured; 54 filtered out; finished in 0.20s` | both history cases in final device suite; positive complete-history and local-witness controls |
| 2: hidden filtered sum, 9,000 excluded rows | `cargo test -p snapback4-sim --test maintains_review -- --nocapture` (`d1r1-red-physical.log`) | `test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.07s` | final simulator suite; filtered/unfiltered and 0/9,000 controls; paired complete observations including both devices |
| 3: raw public-subset inheritance | `cargo test -p snapback4-device --test device maintains::review::review3 -- --nocapture` (`d1r1-red-subset.log`) | `test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 62 filtered out; finished in 0.06s` | both subset cases in final device suite |
| 4: raw creation and adoption | combined base device command above | `test result: FAILED. 0 passed; 10 failed; 0 ignored; 0 measured; 54 filtered out; finished in 0.20s` | both raw refusal cases; non-expiring ranked and live unranked controls in existing/expanded suites |
| 5: prefix and generation, maintain and ordinary table pages | `cargo test -p snapback4-device --test device maintains::review::review5 -- --nocapture` (`d1r1-red-cursors.log`) | `test result: FAILED. 0 passed; 8 failed; 0 ignored; 0 measured; 60 filtered out; finished in 0.15s` | all eight cases plus old-cursor decrease/delete and query-to-mutation controls |

The first fix pass was `6 passed; 4 failed` (the remaining four were maintain
cursor cases); the cursor pass was `14 passed; 0 failed`. A new positive
query-to-mutation cursor control caught a repair regression: query execution
used the active generation while mutation execution still used zero. Before
that correction, `cargo test -p snapback4-device --test device
maintains::review::review5_query_cursor -- --nocapture` reported:

```text
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 72 filtered out; finished in 0.03s
```

It is green in the final device suite. The later acceptance fixture also
initially reused one persisted device name for two different fresh servers;
that produced watermark refusals, not a product regression. Distinct fixture
names fixed it. No production changes were made for that setup error.

### Targeted verification

```sh
# snapback4/
cargo test -p snapback4-device --test device maintains -- --nocapture
```

```text
test result: ok. 23 passed; 0 failed; 0 ignored; 0 measured; 51 filtered out; finished in 0.51s
```

```sh
cargo test -p snapback4-sim --test maintains --test maintains_review -- --nocapture
```

```text
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 23.22s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 13.25s
```

```sh
cargo test -p snapback4-lang --test guide --test maintains
```

```text
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

```sh
cargo test -p snapback4-core --test corpus -- --nocapture
```

```text
corpus (Rust server only; no TypeScript/replica conformance claim): 211 passed, 83 skipped, 0 failed
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.78s
```

The frozen corpus cases are byte-unchanged. Its existing adapter now wraps
legacy direct cursor inputs/oracles in the new scope, using fixture prefix
inputs and initial generation 1, never execution output. This is the necessary
out-of-scope harness change from fixing the shared ordinary-table cursor bug.
The cursor descriptor and suffix/value oracle remain exact.

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
node --test packages/snapback4/test/maintains.test.mjs
```

```text
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 372.269334
```

The wasm and process client cases reject another prefix and continue from the
old ranked cursor after a winner decreases. All rank oracles in the maintain
simulator tests now fold source rows. Both device stores run 28 fold attempts,
26 commits and two overflow rollbacks; updates, deletes, upsert insertion and
hits, every filter transition, key moves, no-op patches and signed cancellation
check target rows, value-index query order and exact target partition events.

### Physical measurements

The counter wraps the real SQLite transaction's Rows interface, independently
of the interpreter meter. The allocator tracks the runner's peak temporary
ownership on the calling thread, excluding seeded database state. Source scan
counts include the two source target-resolution reads. These are bounded-work
measurements, not latency, RSS or constant-time claims.

| Case | Physical source rows examined | Maximum buffered source rows | Peak source-buffer bytes | Peak temporary allocated bytes | Occupancy lookups |
|---|---:|---:|---:|---:|---:|
| Base filtered, 9,000 excluded | 9,003 | 32 | 15,808 | 38,743 | 0 (fallback scan) |
| Fixed filtered, 9,000 excluded | 2 | 1 | 494 | 17,298 | 1 |
| Fixed filtered, 0 excluded | 2 | 1 | 494 | 17,298 | 1 |
| Fixed unfiltered, 9,000 zero contributions | 3 | 1 | 494 | 17,638 | 1 |
| Fixed unfiltered, 0 additional rows | 3 | 1 | 494 | 17,638 | 1 |

The fixed filtered occupancy miss visits zero source entries; the unfiltered
positive witness visits one. Its hidden-write logical meter is:

```json
{"examined":5,"index_entries":10,"rule_probes":0,"steps":25,"heap_bytes":707,"output_bytes":6,"rows_written":3}
```

`heap_bytes` here is the ending logical meter, not the independent peak above.
The paired worlds compare response/receipt/retry bytes, all seven meters,
effects, stream, snapshot and both devices; denied hidden versus absent and
selected versus excluded worlds are identical at full and tight examined
budgets. The existing maintain boundary matrix also exercises all seven
ceiling dimensions. No secret-dependent source scan is exempted by prepayment.

### Diagnostic texts

Finding 4 raw creation/adoption previously succeeded, so there was no refusal.
After the fix the raw error is:

```text
E_SCHEMA: maintains[0]: maintain totals cannot order by value because source posts expires
```

The Quarry diagnostic remains, before and after:

```text
E_QUARRY_MAINTAIN_EXPIRE: maintain totals cannot order by value because source posts expires
rewrite: use a live bounded query, or the scheduled ranked-table recipe for exact rolling-window Trending
guide: expire
```

Finding 5 previously accepted another prefix/generation without a diagnostic.
Its new refusal uses existing E_INPUT:

```text
E_INPUT: cursor: cursor token describes a different prefix or generation
```

Finding 1's new internal prediction reason is:

```text
the zero-sum group's source occupancy is not known locally; queued without a predicted row
```

The public outbox behavior is queueing without predicted rows. No new E_/N_
code was introduced; existing codes remain registered. The expiry card now
names E_QUARRY_MAINTAIN_EXPIRE and the maintained-value restriction.

### Full suite, remaining failures and scope

Both root invocations used:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
bash snapback4/scripts/test.sh
```

The first run (`d1r1-suite.log`), before the query-to-mutation generation
correction, accumulated 713 Rust passes, zero failures, four ignored; fixtures
9/9; client 188/190:

```text
-- ok: cargo test (366 s)
ℹ tests 190
ℹ pass 188
ℹ fail 2
-- FAIL: client tests (48 s)
== 1 failure(s) in 398 s
```

The final-source run (`d1r1-suite-final.log`) accumulated **715 Rust passes,
zero failures, four ignored**. Every build/typecheck/app/fixture step passed;
fixtures 9/9, client 188/190. Final wasm: **1,707,900 bytes raw / 473,904 gzip**.

```text
-- ok: cargo test (274 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
-- ok: fixture wrapper tests (12 s)
ℹ tests 190
ℹ pass 188
ℹ fail 2
-- FAIL: client tests (46 s)
== 1 failure(s) in 309 s
```

Isolated current-code reruns:

```sh
# snapback4/, Node 24 PATH as above
node --test packages/snapback4/test/react.test.mjs
node --test --test-name-pattern='failed persistence stops' packages/snapback4/test/web-navigation.test.mjs
```

```text
# React
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ duration_ms 847.973833
# persistence
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ duration_ms 431.803667
```


Both client failures were then checked against the exact base
`b8ca38bbf24d26d5a4f062304ad6a0cb6eaff8e1`. I saved the completed source/card
and runtime artifacts, restored the base production Rust and included guide
card with `git show HEAD:<path>` (no branch change or reset), built the base CLI
and wasm, and ran each failed test alone. Base wasm was 1,695,854 bytes raw /
470,041 gzip, matching D1's recorded artifact size. The persistence test again
misses its expected `/disk full/` rejection. The base React log explicitly
records Chromium `signal=SIGABRT`; current isolated runs reported ENOTEMPTY
while cleaning up the failed browser. The browser boundary is the supplied
sandbox artifact; the persistence assertion is also base-reproduced. Neither
failure was repaired in this maintains lane.

The exact-base replay also reran the completed regression suite. The subset
case now starts with Bob and records `Int(0), complete: true` on Alice's device
on both stores. The six positive controls pass while the fourteen refusal/
coverage regressions fail. These are supplementary base measurements after
the initial red-before-fix work, not a claim that the final code was still
unmodified when they ran:

```sh
# snapback4/, production files at b8ca38bbf24d26d5a4f062304ad6a0cb6eaff8e1
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
cargo build --workspace --quiet
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
node --test --test-name-pattern='failed persistence stops' packages/snapback4/test/web-navigation.test.mjs
node --test packages/snapback4/test/react.test.mjs
cargo test -p snapback4-device --test device maintains::review -- --nocapture
cargo test -p snapback4-sim --test maintains_review -- --nocapture
```

```text
# persistence, exact base
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ duration_ms 1211.553542
# React, exact base
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ duration_ms 274.364042
# expanded regressions, exact base
test result: FAILED. 6 passed; 14 failed; 0 ignored; 0 measured; 54 filtered out; finished in 0.21s
test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.50s
```

All 23 saved source/card/artifact files were restored and SHA-256 verified
against the completed implementation, then targeted device/client checks were
rerun. No affected Rust or maintains client test remains red. No final source
change followed the completed full suite except ordering the subset fixture
to exercise the other-owner miss first; that test passed again after restore.

```sh
# snapback4/
cargo test -p snapback4-device --test device maintains -- --nocapture
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
node --test packages/snapback4/test/maintains.test.mjs
```

```text
test result: ok. 23 passed; 0 failed; 0 ignored; 0 measured; 51 filtered out; finished in 0.27s
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 620.972625
```

The requested five repairs and added acceptance cases are implemented. The
public-subset Quarry syntax was not widened because it did not reproduce as
an admitted form on this base; the raw-schema defect did reproduce and is
fixed. Durable adoption preparation and digest continuation remain outside
D1R1, as §20.9's built note already states. No app form changed. Apart from the
shared ordinary-table cursor and its frozen-corpus adapter, changes stay in
the maintain/core/device/compiler/tests/docs scope. Twenty changed code files
have a maximum of 1,262 lines; zero exceed 1,500. The README, cards and §20.9
built note are updated without reflowing existing prose. This journal entry
is appended once, preserving every byte of the earlier journal.

Final repository checks:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
./ref-check --verbose > /private/tmp/d1r1-ref-final.log 2>&1
git diff --check
```

```text
ref-check: ok — 480 LLP docs, 8888 refs in 22928 files, 0 errors, 0 unchecked
D1R1 code caps: 20 files; max 1262 lines; 0 over 1500
```

The earlier journal is byte-identical, and exactly one dated entry was added.
The worktree remains on the base commit for the lead; nothing was committed
or published.

## 2026-09-14 — D1R2: Grok maintain review, hidden deletes and index accounting

Started clean at `fc76b6391a5875d330bd3eacb8076748b8805f88` on
`sb4/w3-d1`, after reading the D1R1 entry and the complete review at
`/Users/ccheever/projects/snapback-d1-review/grok.md`. All initial
reproductions below ran with production code unchanged at that HEAD. No
commit, push, tag, publication, sub-agent, clone or remote machine was used.

### Findings and starting-HEAD reproductions

Commands in this entry run from `snapback4/` unless explicitly marked root.
Logs are under `/private/tmp/`; their prefix is `d1r2-`.

1. **Hidden delete: reproduced.** `delete` now calls the same maintain
   reservation before `fetch`, wrapped in `target_attempt` so prepayment and
   transient heap end with that attempt. The existing NOT_FOUND/E_RULE delete
   distinction is retained; it is outside §8.7's one-word update contract.
   Filter worlds match within each target outcome. If the reservation cannot
   fit, present/absent and admitted/denied worlds all refuse before lookup.
   No ceiling changed and actual maintain work is not charged twice.

   `cargo test -p snapback4-sim --test maintains hidden_filter_work_delete -- --nocapture`

   Red (`red-delete.log`):
   `test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 12 filtered out; finished in 0.07s`

   First green (`green-delete.log`, 543 pairs):
   `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out; finished in 24.38s`

   The final matrix adds actual transient-reservation boundaries and positive
   assertions for all full-budget outcomes: 659 pairs. It includes both
   device stores through the existing observation helper, first/retry bytes,
   durable receipts, all seven meters, effects, stream/snapshot, device
   admission/reopen/settlement, and server query metadata. Source/target
   deletions are checked in each successful world; failures roll back.

2. **Expiry card: did not reproduce.** D1R1 already added the paragraph
   naming E_QUARRY_MAINTAIN_EXPIRE and the live bounded query / scheduled
   ranked-table rewrites. Added a focused card assertion; no expiry-card or
   diagnostic implementation change was justified.

   `cargo test -p snapback4-lang --test guide expire_card_explains -- --nocapture`

   Base (`base-expire.log`):
   `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 15 filtered out; finished in 0.00s`

   It remains green in the final 16-test guide suite below; there is no
   fabricated red line for an already repaired finding.

3. **Hidden filtered/keyed overflow: reproduced, documented as authorized.**
   Seed an admitted hidden row with score 1 and another selected row with
   I53_MAX − 1, grouped by author/day. Changing the hidden score to 2 commits
   if excluded and fails E_OVERFLOW if selected. Both aggregate and source
   deny the writer read access. The initial equality hypothesis fails.
   Per the brief's smaller option, §20.9.3, the maintains card and README
   now name this §8/§17 constraint-outcome residual. Overflow implementation
   was not changed. The retained test requires the success control, atomic
   rollback, value-free first refusal and the stricter replay refusal.

   `cargo test -p snapback4-sim --test maintains hidden_filtered_keyed_overflow -- --nocapture`

   Red (`red-overflow.log`):
   `test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 12 filtered out; finished in 0.05s`

   Green for the documented contract (`green-overflow-final.log`):
   `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out; finished in 0.05s`

   A first follow-up assertion incorrectly expected replay's message to
   equal the first refusal; that test failed 0/1, then was corrected to
   require the existing sanitized message. No runtime repair was made for
   this test expectation. An accidental root-level cargo invocation of the
   same command refused before tests because `vendor/ibex/Cargo.toml` is
   absent (`green-overflow.log`); it built nothing and was immediately rerun
   in the fenced workspace. No root bootstrap was attempted.

4. **MemoryRows accounting/defaults: reproduced.** Three core tests cover
   actual changed-key counts against SQLite, defaulted raw-image indexing,
   and delete of an interpreted old image without stale-key resurrection.
   `put` now counts removed and added `stored_index_keys`, like MemoryStore;
   `delete` also interprets defaults. Raw row storage remains raw.

   `cargo test -p snapback4-core --test rows -- --nocapture`

   Red (`red-rows.log`):
   `test result: FAILED. 0 passed; 3 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s`

   Green (`green-rows.log`, also `target-rows.log`):
   `test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s`

5. **Adoption fold: test gap confirmed; no rebuild failure reproduced.**
   Extended the independent fold with an explicit expected predicate,
   duration and output-field name; it does not call the production
   contribution evaluator. The adoption test now checks counts and scores
   after all three definitions, using selected and excluded rows whose UTC
   day and two-minute bucket differ. Source bytes stay identical. The
   stronger test already passes at the starting HEAD, so rebuild code was
   left alone.

   `cargo test -p snapback4-sim --test maintains adoption_rebuilds_filters -- --nocapture`

   Base (`base-adoption.log`):
   `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out; finished in 0.01s`

   It remains green in the final 13-test maintains suite below.

### Targeted suites

`cargo test -p snapback4-core --test rows -- --nocapture` (`target-rows.log`):

```text
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`cargo test -p snapback4-lang --test guide --test maintains` (`target-lang.log`):

```text
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`cargo test -p snapback4-sim --test maintains --test maintains_review -- --nocapture` (`target-sim.log`):

```text
test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 29.96s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.46s
```

`cargo test -p snapback4-device --test device maintains -- --nocapture` (`target-device.log`):

```text
test result: ok. 23 passed; 0 failed; 0 ignored; 0 measured; 51 filtered out; finished in 0.30s
```

### Measurements and diagnostic text

Delete final meters, in `[steps, examined, index entries, rows written,
heap bytes, rule probes, output bytes]` order:

| World | Filter false | Filter true |
|---|---|---|
| Base, no expiry | `[12, 0, 2, 1, 18, 0, 6]` | `[12, 2, 7, 3, 18, 0, 6]` |
| Fixed, no expiry | `[26, 8, 26, 5, 18, 0, 6]` | same |
| Fixed, expiring/live | `[50, 8, 23, 5, 18, 0, 6]` | same |
| Fixed, expired/unswept | `[4, 0, 0, 0, 18, 0, 0]` | same (NOT_FOUND restores the mark) |

Binary-searched minimum non-E_BOUND ceilings in that order are
`[26, 8, 26, 5, 35566, 0, 6]` without expiry,
`[50, 8, 23, 5, 33582, 0, 6]` for live expiry and
`[48, 8, 20, 4, 33582, 0, 0]` for expired/unswept. The matrix tests one below,
at and one above those boundaries as well as low/zero ceilings. The expired
attempt still needs reservation room before it can discover NOT_FOUND and
restore the meter: its final meter is not its peak reservation. That is why
checking only final counters would miss the actual heap boundary.

MemoryRows and SQLite now both charge `[2, 0, 0, 2]` index entries for insert,
identical update, unrelated-field update and a group-key move, respectively.
Before, the second operation charged 2 in MemoryRows and 0 in SQLite.
The adoption oracle checks 3 published definitions over 2 source rows with
0 source-image changes. The overflow fixture's endpoint is
9,007,199,254,740,991. Its success/error bit is retained explicitly, not
reported as repaired noninterference.

No diagnostic code or text changed. Before and after, the first overflow
refusal is exactly:

```text
E_OVERFLOW: maintain totals.value overflowed
```

The stored/replayed message is exactly:

```text
the program refused with E_OVERFLOW
```

The source edit rolls back on overflow; the failed reply carries no current
row. There is no new E_/N_ registration and no parser form or caller change.

### Full suite and baseline client checks

Before implementation changes, the exact starting HEAD was rebuilt with:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
cargo build --workspace --quiet
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/react.test.mjs
node --test --test-name-pattern='failed persistence stops' packages/snapback4/test/web-navigation.test.mjs
```

Builds succeeded (base wasm 1,707,900 B raw / 473,904 B gzip).
Both isolated tests failed at the exact base
`fc76b6391a5875d330bd3eacb8076748b8805f88`: Chromium reports SIGABRT;
persistence misses the expected `/disk full/` rejection. Base summaries:

```text
# base-react.log
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ duration_ms 368.505875
# base-persistence.log
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ duration_ms 1270.860208
```

Final root invocation (log `suite.log`):

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
bash snapback4/scripts/test.sh
```

The full suite accumulated **721 Rust passes, 0 failures, 4 ignored**.
Every build/typecheck/app step and the 9 fixture tests passed. Its only
failed step was the client suite: 188/190, precisely the two independently
base-reproduced failures above. No lifecycle timeout occurred in this run.
Final wasm: **1,708,421 B raw / 474,117 B gzip**, +521 / +213 B from base.
Verbatim summary lines:

```text
-- ok: cargo build (3 s)
-- ok: wasm build (13 s)
-- ok: package typecheck (0 s)
-- ok: package build (1 s)
-- ok: chat app check (1 s)
-- ok: cargo test (330 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (0 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
-- ok: fixture wrapper tests (8 s)
ℹ tests 190
ℹ pass 188
ℹ fail 2
-- FAIL: client tests (43 s)
== 1 failure(s) in 348 s
```

Isolated final-code reruns, with Node 24 PATH as above:

```sh
node --test packages/snapback4/test/react.test.mjs
node --test --test-name-pattern='failed persistence stops' packages/snapback4/test/web-navigation.test.mjs
node --test packages/snapback4/test/maintains.test.mjs
```

```text
# react.log — Chromium SIGABRT, same as exact base
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ duration_ms 424.778583
# persistence.log — Missing expected rejection, expected /disk full/, same as exact base
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ duration_ms 327.385166
# target-client.log — wasm and process devices
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ duration_ms 411.063958
```

README and card prose was separated into paragraphs while the full suite
ran, preserving the original prose wrapping. No Quarry fence changed.
The final docs were rechecked with
`cargo test -p snapback4-lang --test guide --test maintains`
(`final-lang.log`); its verbatim summaries are recorded below.

```text
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

### Scope and final repository checks

The two runtime repairs, regression coverage, overflow disclosure and dated
§20.9 built note are complete. Findings 2 and 5 needed no production change
because their asserted faulty behavior did not reproduce; both coverage
improvements remain. A state-independent overflow rejection was deliberately
not implemented, using the brief's explicitly permitted residual option.
Durable/resumable adoption and S26 continuation stay in their owning lanes.
No application form changed, so there were no app, fixture or loopbar callers
to migrate. No other lane's file was touched. MemoryRows::delete is part of
finding 4's reproduced default-key defect, not an unrelated refactor.

Six changed code files have a maximum of 525 lines, zero over 1,500.
The existing corpus, value serialization and meter ceilings are unchanged.
This is one appended journal entry; all previous journal bytes are preserved.

Root checks (Node 24 PATH as above):

```sh
./ref-check --verbose
git diff --check
```

Before this append, reference validation reported:

```text
ref-check: ok — 480 LLP docs, 8890 refs in 22929 files, 0 errors, 0 unchecked
D1R2 code caps: 6 files; max 525 lines; 0 over 1500
```

The final append is also covered by the root reference check; the worktree is
left uncommitted for the lead. The lead still needs to rerun the full suite
outside the sandbox, where Chromium can start, and handle the existing
persistence-test failure in its owning lane. No new product test remains red.

## 2026-09-14 — lane B2: prediction, residency and fanout explanations (§20)

Built S05, S06, S08 and S17 from LLP 3000.007 §20, preserving its §6.2
site classes, §14/§18 decisions and §19.1 presence analysis. Read the
inventory's L12 final/m8/m6 checks, generated API and residency facts;
L10a's m6/m8 checks and fanout explanation; the timestamped L12, L10a and
A6 horizon/maintain notes; R10g's loop 8; and L12 grader trace §4.9. These
fixtures reproduce the accumulated recipients, online-only aggregates and
ranked writes, and a complete wide matching search that the old note said
was cut. The existing prediction card supplies the horizon and effects-only
presence controls.

Every successful text check now prints one sorted summary of mutations that
never predict, including unchanged checks. Failed checks with bound mutation
facts print it too. Successful JSON checks carry `predictionSummary`.
`mutation name(args) predicts:` asserts the existing binder result, refusing
E_NOT_PREDICTABLE at the header when it is never. It neither changes a site
class nor promises that a horizon miss will predict. The prediction recipes
and language card compile with the new modifier.

The maintain note names eligible mutation readers before suggesting an
online-only opt-out. Check observes value-row counts in the current dev
store (explicitly before adoption); test --residency still measures each
persona's actual cold partition. A maintain's sync-property refusal explains
inheritance; its online-only rewrite removes the override instead of asking
for an invalid sync property.

Fanout admission returns located details for the compiler. A small source
map beside the bound program maps loops and page reads back to Quarry;
serialized IR and generated site ids are unchanged. An accumulated list's
rewrite names its original capped page, a too-small page names the cap,
and an unpinned read offers a query. Core refusal text also avoids repeating
the code and message. No admission verdict, meter ceiling or value-model
serialization changed; no existing corpus case changed. N_WIDE_MERGE now
states the possible cost conditionally and points to test --cost.

### Measurements

- Summary cases: 0, 1 and 3 never-predicting mutations, each checked twice.
  The L12-shaped ranked-write/entryCounts case also checks text, JSON and
  check --residency; operation why names the maintain's actual rewrite.
- Three likes over two post ids produce 2 maintained value rows. Alice's
  cold snapshot contains 2 likeCounts rows / 100 bytes, and 5 total rows /
  223 bytes including the source likes.
- Matching search: 1,000 possible lanes × 21 rows = 21,000 potential rows;
  the populated control returns 1 message, examines 2 rows, complete=true.
  The ceiling remains 8,192.
- The accumulated recipient loop is reported at 14:3, formerly the header
  at 9:1. The non-uniform read is at 8:10, formerly the header at 7:1.
  The small-page control uses 10 against a schema cap of 50; the suggested
  50-row loop compiles. The corrected recipient loop executes successfully.

### Exact diagnostics before → after

The following are the regression fixtures' output. The always-on summary
had no before line; after an unchanged three-mutation check it is:

```text
3 mutations never predict: createPost (reads online-only maintain likeCounts), like (reads online-only maintain likeCounts), repost (reads online-only maintain likeCounts) — snapback4 why <op>
```

**N_NOT_PREDICTABLE (the existing change note remains; its maintain rewrite is corrected) — before:**

```text
schema.q:14:1 — N_NOT_PREDICTABLE: like is no longer eligible to predict; queued without a row: point likeCounts by byGroup: online only (site programs.like.0)
  rewrite: sync likeCounts to its read-rule audience, or read a compact synced projection
  guide: residency
```

**After:**

```text
schema.q:14:1 — N_NOT_PREDICTABLE: like is no longer eligible to predict; queued without a row: point likeCounts by byGroup: online only (site programs.like.0)
  rewrite: remove `online only` from maintain likeCounts to inherit its source's sync, or read a compact synced projection
  guide: residency
```

**N_MAINTAIN_SYNCED (with a measured current store) — before:**

```text
schema.q:10:1 — N_MAINTAIN_SYNCED: maintain likeCounts: sync public inherited from likes; one value row per postId reaches every device
  rewrite: add `online only` to the maintain to opt out of inherited sync; measure with `test --residency`
  guide: residency
```

**After:**

```text
schema.q:10:1 — N_MAINTAIN_SYNCED: maintain likeCounts: sync public inherited from likes; one value row per postId reaches every device; createPost, like, repost would stop predicting if likeCounts goes `online only`; current store measurement: 2 value rows (before adoption; cold rows per viewer: `snapback4 test --residency`)
  rewrite: keep inherited sync for local readers, or add `online only` to opt out; measure cold rows with `snapback4 test --residency`
  guide: residency
```

**A sync property on a maintain — before:**

```text
schema.q:12:3 — E_QUARRY_SYNTAX: unknown maintain property sync
  rewrite: read <- rule
  guide: language
```

**After:**

```text
schema.q:12:3 — E_QUARRY_SYNTAX: a maintain inherits its source's sync; `online only` opts out
  rewrite: remove this sync line to inherit, or replace it with `online only`
  guide: residency
```

**The predicts header assertion — before:**

```text
schema.q:1:21 — E_QUARRY_SYNTAX: expected ":", got "predicts"

## 2026-09-14 — §20 lane B1: diagnostics that lead to the working spelling

Implemented inventory S07, S09, S10, S11 and S12 from base
`6896dfce5ecc949e2260ce1407f7449ebdd83d91`. Read the five inventory rows,
every cited check file, the cited run-log entries and M5 diary, and searched
all three evidence directories' `*check*` files for syntax errors. L12 is
`clique-sb4-20260914-astra-0.2.11`, L10a is
`clique-sb4-20260913-relaxed-3models`, and R9 is
`clique-sb4-20260914-astra-0.2.9`; paths below are relative to each lane's
`evidence/`. The regression suite preserves the offending source lines and
positions in small supporting schemas. Historical source was recovered from
the recorded command strings, read as data; those commands were not executed.
The four `ergonomics-*.q` fixtures preserve the complete order helper and the
original message inserts/uses, including `return { id: msg.id }`.

S07 uses a specific refusal and mechanical `{ ...postCard }` repair. Accepting
a trailing bare name as the page shape would change an existing valid program:
`where ({ body: .body }) = candidate selected` applies `selected` to the
object `candidate` inside the predicate. The executable regression seeds one
row and still returns that row. Keeping the grammar avoids that ambiguity;
therefore the conditional exhaustive before/after binding census for a new
accepted grammar was not needed. The repair preserves surrounding text and
moves the shape past parentheses enclosing the predicate, while preserving
parentheses enclosing the whole read. Three evidence forms and five CLI
repair variants pass, including strings, Unicode comments and parentheses.

S09 retains a failed binding with its original cause, deduplicates that cause
across uses and helper expansions, and continues checking independent
statements and sibling values. Additional red/green regressions cover nested
blocks, tuple bindings, independent object/list values, successful rebinding,
and a relocated helper placement error. L12's six errors become two distinct
optional-call errors, then zero after binding the TTL once. L10a's eleven
errors become five distinct time-scaling errors, then zero after the explicit
integer conversion and integer storage types.

S10 widens an enum to bounded text only when every variant fits the character
bound. This is static and total; no runtime conversion, serialized value
change or ceiling change is involved. All three TTL variants execute correctly;
two non-ASCII single-character variants fit `text <=1`, a long variant is
refused, and nullable-to-required calls still require a guard. The language
card both compiles and runs this widening. The original row-helper, argument
`once`, empty-argument and dotted-schedule cases were already repaired on the
base; this lane adds exact-source positive coverage and does not claim those
repairs as new work.

S11 names object spread and expected punctuation, number, string and indentation
spellings, and gives `why E_QUARRY_SYNTAX` actionable content. No new diagnostic
code or new object-spread form was added. The complete syntax evidence census
contains seven sites: one object spread, three missing argument lists, one
argument `once`, one dotted schedule target, and one maintain `sync` property.
The last belongs to B2's residency scope: it is reproduced and its successful
removal is tested, but its diagnostic is deliberately unchanged here.

S12 names the index columns and types, supplied expressions and types, and
whether the problem is a fully pinned range or a wrong key type. The fixtures
compile both the point-read/chunk rewrite and the alternative slug index or
correctly typed reference argument. No runtime index semantics changed.

### Exact evidence diagnostics: before → after

The following blocks are verbatim, including duplicate historical diagnostics.
“No diagnostic” below means the historical error is absent; it does not imply
that the lane changed the already-repaired base behavior.

#### S07: trailing named shape

Before, `m2-check.txt`:

```text
social.q:83:82 — E_QUARRY_TYPE: a shape applies to a row, an object or a page; got null
  rewrite: shape a read: `messages[id] { body }`
  guide: types
```

After:

```text
social.q:83:82 — E_QUARRY_TYPE: shape postCard after where attaches to null inside the predicate; apply it to the page with { ...postCard }
  rewrite: { ...postCard } — check --fix applies it
  guide: shapes
```

Before, `check-m2.txt`:

```text
social.q:85:81 — E_QUARRY_TYPE: a shape applies to a row, an object or a page; got null
  rewrite: shape a read: `messages[id] { body }`
  guide: types
```

After:

```text
social.q:85:81 — E_QUARRY_TYPE: shape postCard after where attaches to null inside the predicate; apply it to the page with { ...postCard }
  rewrite: { ...postCard } — check --fix applies it
  guide: shapes
```

Before, `m2-check.txt`:

```text
social.q:147:78 — E_QUARRY_TYPE: a shape applies to a row, an object or a page; got null
  rewrite: shape a read: `messages[id] { body }`
  guide: types
```

After:

```text
social.q:147:78 — E_QUARRY_TYPE: shape postCard after where attaches to null inside the predicate; apply it to the page with { ...postCard }
  rewrite: { ...postCard } — check --fix applies it
  guide: shapes
```

Applying `check --fix` yields zero diagnostics for each repaired form.

#### S09/S10: L12 message bindings and enum/optional types

Before, `m5-check.txt`:

```text
chat.q:170:207 — E_QUARRY_TYPE: disappearance's setting is text <=10; got enum('off', '24h', '7d')
  rewrite: pass text <=10 for setting
  guide: types

chat.q:171:76 — E_QUARRY_UNKNOWN: unknown name msg
  rewrite: declared names: body, c, conversationId, messageId, new, now, recipients, replyToId, viewer
  guide: language

chat.q:172:16 — E_QUARRY_UNKNOWN: unknown name msg
  rewrite: declared names: body, c, conversationId, messageId, new, now, recipients, replyToId, viewer
  guide: language

chat.q:213:264 — E_QUARRY_TYPE: disappearance's setting is text <=10; got enum('off', '24h', '7d')
  rewrite: pass text <=10 for setting
  guide: types

chat.q:214:76 — E_QUARRY_UNKNOWN: unknown name msg
  rewrite: declared names: body, c, clip, conversationId, messageId, new, now, oncePhoto, photo, recipients, viewer
  guide: language

chat.q:215:16 — E_QUARRY_UNKNOWN: unknown name msg
  rewrite: declared names: body, c, clip, conversationId, messageId, new, now, oncePhoto, photo, recipients, viewer
  guide: language
```

After:

```text
chat.q:170:157 — E_QUARRY_TYPE: + needs present numbers; got time and int ?
  rewrite: bind the optional call once: `ttl = disappearance(c.disappearing)`; use `now + ttl if ttl != null else null`
  guide: types

chat.q:213:214 — E_QUARRY_TYPE: + needs present numbers; got time and int ?
  rewrite: bind the optional call once: `ttl = disappearance(c.disappearing)`; use `now + ttl if ttl != null else null`
  guide: types
```

The enum error is gone because all variants fit 10 characters. The four
`unknown name msg` follow-ons are gone. The two remaining diagnostics identify
the independent optional-call issue the builder actually fixed. Binding
`ttl = disappearance(c.disappearing)` and testing `ttl != null` gives zero
diagnostics; the corrected mutation also commits in the engine.

For a deliberately too-small helper bound, the exact replacement diagnostic
is below. Before, its message was the same, but its rewrite was
`pass text <=1 for setting`. The separate `missing` error remains.

After:

```text
chat.q:6:37 — E_QUARRY_TYPE: bad's setting is text <=1; got enum('off', '24h', '7d')
  rewrite: change bad's parameter to `setting: enum('off', '24h', '7d')`; not every variant fits text <=1
  guide: types

chat.q:9:11 — E_QUARRY_UNKNOWN: unknown name missing
  rewrite: declared names: id, msg, new, now, setting, viewer
  guide: language
```

#### S09/S10: L10a time/count errors and cascades

Before, `check-m8-order.txt`:

```text
order.q:15:19 — E_QUARRY_TYPE: time values add or subtract an int offset; time + time and time * n have no meaning
  rewrite: subtract two times for an int difference in milliseconds
  guide: types

chat.q:196:27 — E_QUARRY_UNKNOWN: unknown name arrival
  rewrite: declared names: c, conversationId, messageId, new, now, recipients, replyToId, text, ttl, viewer
  guide: language

chat.q:202:16 — E_QUARRY_UNKNOWN: unknown name msg
  rewrite: declared names: c, conversationId, messageId, new, now, recipients, replyToId, text, ttl, viewer
  guide: language

chat.q:209:55 — E_QUARRY_TYPE: time values add or subtract an int offset; time + time and time * n have no meaning
  rewrite: subtract two times for an int difference in milliseconds
  guide: types

chat.q:210:70 — E_QUARRY_TYPE: time values add or subtract an int offset; time + time and time * n have no meaning
  rewrite: subtract two times for an int difference in milliseconds
  guide: types

chat.q:211:60 — E_QUARRY_TYPE: time values add or subtract an int offset; time + time and time * n have no meaning
  rewrite: subtract two times for an int difference in milliseconds
  guide: types

chat.q:212:104 — E_QUARRY_UNKNOWN: unknown name da
  rewrite: did you mean `d`?
  guide: language

order.q:15:19 — E_QUARRY_TYPE: time values add or subtract an int offset; time + time and time * n have no meaning
  rewrite: subtract two times for an int difference in milliseconds
  guide: types

media.q:41:27 — E_QUARRY_UNKNOWN: unknown name arrival
  rewrite: declared names: c, caption, conversationId, messageId, new, now, photo, recipients, ttl, video, viewOnce, viewer
  guide: language

media.q:47:16 — E_QUARRY_UNKNOWN: unknown name msg
  rewrite: declared names: c, caption, conversationId, messageId, new, now, photo, recipients, ttl, video, viewOnce, viewer
  guide: language

order.q:22:45 — E_QUARRY_TYPE: time values add or subtract an int offset; time + time and time * n have no meaning
  rewrite: subtract two times for an int difference in milliseconds
  guide: types
```

After:

```text
order.q:22:45 — E_QUARRY_TYPE: * cannot scale a time; use an int number of milliseconds
  rewrite: (m.at / 1) * 1000 — / 1 yields integer milliseconds; store the scaled count as int
  guide: types

order.q:15:19 — E_QUARRY_TYPE: * cannot scale a time; use an int number of milliseconds
  rewrite: (now / 1) * 1000 — / 1 yields integer milliseconds; store the scaled count as int
  guide: types

chat.q:209:55 — E_QUARRY_TYPE: * cannot scale a time; use an int number of milliseconds
  rewrite: (now / 1) * 1000 — / 1 yields integer milliseconds; store the scaled count as int
  guide: types

chat.q:210:70 — E_QUARRY_TYPE: * cannot scale a time; use an int number of milliseconds
  rewrite: (d / 1) * 1000 — / 1 yields integer milliseconds; store the scaled count as int
  guide: types

chat.q:211:60 — E_QUARRY_TYPE: * cannot scale a time; use an int number of milliseconds
  rewrite: (r / 1) * 1000 — / 1 yields integer milliseconds; store the scaled count as int
  guide: types
```

The duplicate `order.q:15:19` and five unknown-name follow-ons disappear.
Changing `arrival`, `deliveredArrival`, `readArrival` and the clock's `last`
to `int`, then writing `(now / 1) * 1000`, `(m.at / 1) * 1000`,
`(d / 1) * 1000` and `(r / 1) * 1000`, compiles with zero diagnostics.
For `time + time`, the old message and rewrite were the same generic pair
above. They are now, verbatim:

```text
+ cannot add two times; an offset is an int number of milliseconds
rewrite: change the duration parameter or column to int, then add it to the time; subtract two times to measure an elapsed duration
```

#### S10: reference versus row (already repaired on the base)

Before, `m3-check.txt`:

```text
chat.q:105:139 — E_QUARRY_TYPE: state's m is a messages reference; got a messages row
  rewrite: pass a messages reference for m
  guide: types
```

After: no diagnostic for the exact original `state(m: messages)` helper
and `shape messageCard = { *, sender: profiles[.senderId], quote: messages[.quoteId] { id, body, sender: profiles[.senderId] }, receipt: state(.) }`.
A reference still requires an explicit read before field access. The existing
positive row and reference tests both examine one row. The reverse refusal,
unchanged by this lane, is:

```text
schema.q:5:24 — E_QUARRY_TYPE: a messages reference has no fields
  rewrite: messages[m] ! else NOT_FOUND — read the row, or use the shape's row parameter: messages[m] { body: .body }
  guide: shapes
```

#### S10/S11: argument once (already repaired on the base)

Before, `m5-check.txt`:

```text
chat.q:160:158 — E_QUARRY_SYNTAX: once is a column modifier, not an argument constraint
  rewrite: remove once from this argument; declare image <=10000000 once on the owning table column
  guide: language
```

After:

```text
chat.q:160:147 — E_QUARRY_SYNTAX: once is a column modifier, not an argument constraint; declare it on the owning table column
  rewrite: oncePhoto: image <=10000000 ? — check --fix applies it
  guide: language
```

The mechanical removal compiles with zero diagnostics; the owning column retains `once`.

#### S11: all other syntax evidence sites

Before, `m8-check.txt`:

```text
insights.q:91:90 — E_QUARRY_SYNTAX: expected a name, got "."
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language
```

**After:**

```text
schema.q:1:1 — E_NOT_PREDICTABLE: mutation dispatch asserts predicts, but author marked this mutation : server
  rewrite: remove : server to allow prediction when every site is held
  guide: prediction
```

**E_STRUCTURAL_FANOUT on the accumulated recipients — before:**

```text
schema.q:9:1 — E_STRUCTURAL_FANOUT: E_STRUCTURAL_FANOUT: send/for/$p3/0: $p3 does not preserve one complete page; pin a schema-capped group with a literal bound at least its cap, or use a job chunk
  rewrite: send/for/$p3/0: $p3 does not preserve one complete page; pin a schema-capped group with a literal bound at least its cap, or use a job chunk
  guide: language
```

**After:**

```text
schema.q:14:3 — E_STRUCTURAL_FANOUT: loop over recipients: members by byRoom (page bound 50): this list does not preserve one complete page
  rewrite: iterate the original group: `for row in members[room] first 50 by byRoom:`; put the condition and work inside that loop
  guide: programs
```

**E_STRUCTURAL_FANOUT on a non-uniform read — before:**

```text
schema.q:7:1 — E_STRUCTURAL_FANOUT: E_STRUCTURAL_FANOUT: programs.send.0: the mutation page's read rule is not uniformly decided by its prefix; read it in a query, or pin the deciding columns
  rewrite: read it in a query, or pin the deciding columns
  guide: language
```

**After:**

```text
schema.q:8:10 — E_STRUCTURAL_FANOUT: members by byRoom (page bound 10): the mutation page's read rule is not uniformly decided by its prefix
  rewrite: read it in a query, or pin the deciding columns
  guide: programs
```

**N_WIDE_MERGE on the completed search — before:**

```text
schema.q:32:1 — N_WIDE_MERGE: query searchAll: the merge over messages reads up to 1000 lanes, one page of 21 each — 21000 rows per read, past the 8192 examined the meter allows, so the page is cut and `complete: false`
  rewrite: keep the lanes under 50 (`first 50` on the lane source), or write the feed on the way in: a table of entries per reader, synced to .reader, read as one page (`snapback4 guide feeds`)
  guide: feeds
```

**After:**

```text
schema.q:32:1 — N_WIDE_MERGE: query searchAll: the merge over messages reads up to 1000 lanes, one page of 21 each — up to 21000 rows per read; a read past the 8,192 examined ceiling returns `complete: false`
  rewrite: measure with `snapback4 test --cost`; keep the lanes under 50 (`first 50` on the lane source), or write the feed on the way in: a table of entries per reader, synced to .reader, read as one page (`snapback4 guide feeds`)
  guide: feeds
```

**why E_STRUCTURAL_FANOUT — before:**

```text
E_STRUCTURAL_FANOUT: family schema — prediction needs a complete schema-capped group; a never-predicting mutation may pass a bounded uniform plain prefix page over a table without expiry. Every mutation page, even without a loop, must be uniformly decided by its prefix. Matching word scans, merges and expiring tables are refused for every mutation page, predicting or not, looped or bound; unknown loop origins are refused too. Pin the read-rule fields and a capped group, use : server for a bounded uniform pass, or move a sweep to a job chunk.
```

**After:**

```text
E_STRUCTURAL_FANOUT: a mutation cannot safely iterate this population. Prediction needs a whole capped group; all mutation pages need a uniform plain prefix over a table without expiry. An accumulated or filtered list may lose the proof that it contains the whole group. Iterate the original group, read the page in a query, or sweep it in a job chunk.

Example: declare `cap 50 by room` on members, then iterate `for m in members[room] first 50 by byRoom:` and put the recipient condition and `emit` inside that loop.
```

### Verification and scope

Base: `6896dfce5ecc949e2260ce1407f7449ebdd83d91`. The new regressions were
run against that exact implementation (saved edits restored afterward,
without git reset/checkout/stash), then against the lane. Every new test
is red before and green after. These are the exact targeted commands,
run from `snapback4/`, and their verbatim summary lines:

`cargo test -p snapback4-lang --test residency_notes -- --nocapture`

Before:

```text
test result: FAILED. 0 passed; 9 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

After:

```text
insights.q:91:90 — E_QUARRY_SYNTAX: expected an object field name, got spread ...counts; objects list fields explicitly
  rewrite: replace ...counts with field: counts.field for each payload field
  guide: language
```

Writing each payload field explicitly gives zero diagnostics.

Before, `m8-check1.txt`:

```text
analytics.q:41:15 — E_QUARRY_SYNTAX: expected "(", got ":"
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language

analytics.q:49:15 — E_QUARRY_SYNTAX: expected "(", got ":"
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language

analytics.q:52:13 — E_QUARRY_SYNTAX: expected "(", got ":"
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language
```

After:

```text
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```

`cargo test -p snapback4 --test check b2_ -- --nocapture`

Before:

```text
test result: FAILED. 0 passed; 5 failed; 0 ignored; 0 measured; 15 filtered out; finished in 1.80s

analytics.q:41:1 — E_QUARRY_SYNTAX: an operation with no arguments still needs parentheses
  rewrite: query insights(): — check --fix applies it
  guide: language

analytics.q:49:1 — E_QUARRY_SYNTAX: an operation with no arguments still needs parentheses
  rewrite: query trending(): — check --fix applies it
  guide: language

analytics.q:52:1 — E_QUARRY_SYNTAX: an operation with no arguments still needs parentheses
  rewrite: job backfill(): — check --fix applies it
  guide: language
```

Each mechanical parentheses repair gives zero diagnostics; these repairs predate this lane.

Before, `m8-check4.txt`:

```text
digest.q:52:47 — E_QUARRY_SYNTAX: unexpected token after declaration from line 52
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language
```

After: no diagnostic for `schedule dailyDigest every 2m at 00:00: digest.daily`; already accepted on the base.

Before, `check-m8-prediction.txt`:

```text
social.q:72:3 — E_QUARRY_SYNTAX: unknown maintain property sync
  rewrite: read <- rule
  guide: language
```

After: exactly the same three lines. B2 owns this residency spelling; removing `sync public last 2000 by byId` compiles successfully.

Additional expected-token regressions keep their before message/site and replace the generic rewrite `fix this Quarry line and rerun snapback4 check` with the following exact text:

After:

```text
schema.q:1:11 — E_QUARRY_SYNTAX: expected ":", got "int"
  rewrite: put : after a declaration or block header; parameters use name: type, and object fields use name: expression
  guide: language

schema.q:1:19 — E_QUARRY_SYNTAX: expected a number, got ")"
  rewrite: write an integer literal here, for example first 50 or text <=100
  guide: language

schema.q:1:17 — E_QUARRY_SYNTAX: expected a string, got "off"
  rewrite: quote the text with ' or "; enum variants are quoted strings, for example enum('off', 'on')
  guide: language

schema.q:2:1 — E_QUARRY_SYNTAX: expected an indented block, got "return"
  rewrite: indent the body beneath its header with spaces, for example query q(): followed by an indented return null
  guide: language

schema.q:2:18 — E_QUARRY_SYNTAX: expected "}", got ":"
  rewrite: separate fields with commas and close the object or shape with }
  guide: language
```

Before, `snapback4 why E_QUARRY_SYNTAX` on the named base:

```text
E_QUARRY_SYNTAX: the parser could not read this line; the rewrite is a canonical spelling. `snapback4 guide` is the language card.
```

After, captured from the built CLI:

```text
E_QUARRY_SYNTAX: the parser expected the token or construct named at file:line:column. Object fields use name: expression (or a bare name for name: name); ...shape belongs in a row/page shape, not an object payload. Operations need name(args): followed by an indented body, including () for no arguments. Close each (, [ and { with its matching delimiter; separate fields and arguments with commas. The rewrite names the expected spelling; `check --fix` applies only repairs marked mechanical. Read `snapback4 guide language` for complete examples.
```

#### S12: fully pinned range and wrong key type

Before, `m8-fixture-check.txt`:

```text
test-fixtures.q:3:14 — E_QUARRY_TYPE: profiles.byPrincipal is over principal; this range supplies 1 key
  rewrite: profiles[] first 50 by byPrincipal
  guide: types
```

After:

```text
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 15 filtered out; finished in 1.56s
```

`cargo test -p snapback4-lang --test guide`

```text
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
```

The broader targeted command
`cargo test -p snapback4-lang --test frontend_regressions --test presence --test lowering`
passed:

```text
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.50s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 76.85s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
```

The initial broader admission command was
`cargo test -p snapback4-sim --test page_admission --test write_authority --test condition_authority`.
It caught one existing expectation of rewrite text inside the message; this
lane intentionally separates them. The assertion now checks the explanation
in the message; the rewrite is separately asserted by the new regressions.
The initial command's summary lines were:

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.63s
test result: FAILED. 13 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 34.64s
```

That target and every other Rust target passed in the full suite on the
final implementation. From the repository root:

```sh
export PATH="$HOME/.volta/tools/image/node/24.18.0/bin:$PATH"
bash snapback4/scripts/test.sh > /tmp/b2-suite.log 2>&1
```

```text
-- ok: cargo test (499 s)
ℹ tests 169
ℹ pass 168
ℹ fail 1
-- FAIL: client tests (63 s)
== 1 failure(s) in 533 s
   client tests
```

The only suite failure is `React hooks and reference-app lifetimes`:
Chromium exits with SIGABRT inside the sandbox, the environment artifact
named in the lane rules. It repeats alone, from `snapback4/` with the same
Node 24 PATH:

`node --test packages/snapback4/test/react.test.mjs`

test-fixtures.q:3:14 — E_QUARRY_TYPE: profiles.byPrincipal takes (principal: principal); supplied (author: principal) pins every key, leaving no column to range over
  rewrite: use profiles[author] by byPrincipal for one row; in a chunk, use `chunk row in profiles first 1 by byId:` then `if row.principal != author: continue`
  guide: indexes
```

Before, `m3-check6.txt`:

```text
chat.q:192:14 — E_QUARRY_TYPE: conversations.byId is over id; this point read supplies 1 key
  rewrite: conversations[id]
  guide: types
```

After:

```text
chat.q:192:14 — E_QUARRY_TYPE: conversations.byId takes (id: a conversations reference); supplied (handle: text <=100) has the wrong key type
  rewrite: conversations[handle] by bySlug — this index accepts the supplied key; for byId, pass a conversations reference instead of text <=100
  guide: indexes
```

Both suggested repairs for each case compile with zero diagnostics.

### Verification and measurements

All successful Cargo verification below ran from `snapback4/`. Node commands
used `export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`. Base rechecks
temporarily restored the modified tracked source files from the exact
`git show 6896dfce5ecc949e2260ce1407f7449ebdd83d91:<path>` bytes, ran the new
regressions, and restored the working copies in a `finally` block. No branch,
index or commit was changed. Four tests were already green on that base;
fourteen diagnostic tests and the new CLI repair test were red.

The red/green commands and their verbatim summary lines follow. Earlier
iterations are included to distinguish the evolving test count from the final
18-case suite.

`cargo test -p snapback4-lang --test ergonomics -- --nocapture` — initial red, first green, expanded green

```text
test result: FAILED. 1 passed; 9 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
```

`cargo test -p snapback4-lang --test ergonomics -- --nocapture --test-threads=1` — named base, final fixtures

```text
test result: FAILED. 4 passed; 14 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

`cargo test -p snapback4 --test fix -- --nocapture --test-threads=1` — named base

```text
test result: FAILED. 20 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.27s
```

`cargo test -p snapback4-lang --test ergonomics s09_recovery -- --test-threads=1` — two introduced recovery defects, red then green

```text
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 16 filtered out; finished in 0.00s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 16 filtered out; finished in 0.01s
```

`cargo test -p snapback4-lang --test guide --test ergonomics --test repairs --test frontend_regressions -- --nocapture` — intermediate

```text
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.49s
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.40s
```

`cargo test -p snapback4-lang --test ergonomics --test guide --test repairs --test frontend_regressions -- --nocapture --test-threads=1` — final

```text
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.34s
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.52s
```

`cargo test -p snapback4 --test fix` — intermediate

```text
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.51s
```

`cargo test -p snapback4 --test fix -- --test-threads=1` — final

```text
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.30s
```

`cargo test -p snapback4-lang --test guide` — exact acceptance command

```text
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

`bash snapback4/scripts/test.sh` — run from the repository root twice, after
exporting the Node 24 path. The first run preceded the final two recovery
fixes; the second includes the final code and tests. Full logs are
`/tmp/b1-suite.log` and `/tmp/b1-suite-final.log`.

```text
-- ok: cargo build (3 s)
-- ok: wasm build (31 s)
-- ok: package typecheck (3 s)
-- ok: package build (2 s)
-- ok: chat app check (2 s)
-- ok: cargo test (326 s)
-- ok: chat app typecheck (2 s)
-- ok: expo app typecheck (2 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
-- ok: fixture wrapper tests (34 s)
ℹ tests 169
ℹ pass 168
ℹ fail 1
-- FAIL: client tests (68 s)
== 1 failure(s) in 367 s
```

```text
-- ok: cargo build (4 s)
-- ok: wasm build (1 s)
-- ok: package typecheck (1 s)
-- ok: package build (0 s)
-- ok: chat app check (0 s)
-- ok: cargo test (230 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
-- ok: fixture wrapper tests (8 s)
ℹ tests 169
ℹ pass 168
ℹ fail 1
-- FAIL: client tests (43 s)
== 1 failure(s) in 236 s
```

The final Rust total, summed from all 52 test-result lines, is **689 passed,
0 failed, 2 ignored**. The suite built the wasm device: **1,643,507 bytes raw,
455,513 bytes gzip**. Package, chat and Expo typechecks passed. The chat check
reported **5 tables, 9 operations, 0 problems, 1 existing cursor note**.

The only failure in either complete run was the user-identified sandbox
Chromium launch artifact in `packages/snapback4/test/react.test.mjs:72`, with
`signal=SIGABRT`. It also failed alone with
`node --test packages/snapback4/test/react.test.mjs`:

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ duration_ms 1285.249042
```

The lead must rerun that browser test outside the sandbox. No other product
failure is called pre-existing. The root caps check reports `1 violation.`:
`crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` is 1,504 lines
by the checker, byte-identical to the named base (SHA-256
`1eae485cacf83f8823f2716b33c49e1d4df32fdd1f1e68b8b0e3491338274ad9`).
All 19 changed/new code files are below 1,500 lines; the largest is
`guide.rs` at 1,210 newline-terminated lines. No root code file changed.

Necessary supporting edits outside the brief's named files: the AST boolean
and three header-parser lines in `parser/programs.rs`; the source map in
`bind/program.rs`, one registration in `bind/program/control.rs`, and empty
initialization in `bind/actions.rs`; core `error.rs` for the non-repeating
refusal envelope; and one expectation in the existing simulator
`page_admission.rs` test. B1's syntax/type diagnostics and `parser/expr.rs`
are untouched. README prose was extended without reflowing it; this journal
entry is appended. No feature item was omitted. Nothing was committed,
pushed, tagged or published.

ℹ duration_ms 334.236541
```

The lead must rerun that test outside the sandbox. There were no en-masse
client timeouts and no lifecycle failures in these runs. No newly discovered
failure is asserted to predate the named base; the Chromium classification
comes from the program's explicit environment ruling, plus the isolated
reproduction here, rather than a whole-suite base claim.

There are **19 changed/new code files**, **0 above 1,500 lines**; the largest
is `snapback4-lang/src/guide.rs` at **1,223 lines**. Markdown was not compressed
or reflowed to meet a cap. The implementation adds **0 codes**, changes
**0 existing corpus cases**, and touches **0 B2-owned files**. README and
language/type cards document the published behavior. No form was removed,
so application/corpus/loopbar callers needed no migration. All implementation
items in B1 are complete; the B2 maintain-sync text and outside-sandbox browser
verification are the explicit handoff items. No out-of-scope file was changed.
Nothing was committed, pushed, tagged or published.

Root `./ref-check --verbose` passed:

```text
ref-check: ok — 474 LLP docs, 8870 refs in 22861 files, 0 errors, 0 unchecked
```

`git diff --check` passed; the journal before this entry is byte-identical
to the base. The full Rust suite reports 684 passed, 0 failed and 2 ignored
across its 52 result summaries.

ref-check: ok — 474 LLP docs, 8869 refs in 22863 files, 0 errors, 0 unchecked
```

`git diff --check` passed. The JOURNAL prefix is byte-identical to the base;
this dated entry is append-only.

## 2026-09-14 — wave-2 review: Grok finding 5 (reused loop binding) does not reproduce (lead)

Grok's wave-2 review (Low, `engine/admission.rs:208`) held that two `for x in …`
loops with the same binding share the admission site `for/x`, so
`E_STRUCTURAL_FANOUT` could locate and rewrite the wrong loop. The binder's
`declare` gives every loop item a unique runtime binding, so the IR bindings,
the admission sites and the binder's source map never collide.
`a_reused_loop_binding_locates_the_failing_loop` (two `for p in` loops, the
failing one first) passes at `0e9fdddba` and stays as a guard.

## 2026-09-14 — W2R1c: ordered exit sends, staged signing, schedule release, enum domain, atomic init

Implemented GPT review findings 4, 6, 7, 8 and 9 at base
`0e9fdddba4fe34684d99215b70ac8dae2d164c42`. Read the review's corresponding
findings and obligations 4–7, the Snapback 4 fence and LLP 3000.007's
rulings. Each finding first failed with the base implementation; only then
was its implementation changed. No commit, push, tag or publication occurred.

- **4, exit ordering:** removed concurrent waves and predecessor bypass.
  An exit event attempts only the oldest committed, unconfirmed write;
  oversized/quota-blocked heads stay durable. Ordinary sends and exit sends
  exclude one another in both directions, through transport completion and
  ordinary durable settlement. Ordinary replay confirms the head before
  advancing. Tests reverse server processing, block the head, overlap an
  ordinary send, resume ordinary sending after an exit request, share quota
  across clients, and reopen the real wasm device against the HTTP server.
  Measured **2** durable writes, **1** exit request, **1** server row before
  reopen and **2** after replay. The two-client UTF-8 body sum is **64,093 B**
  against **65,536 B**; outstanding same-client sends fall from **2** to **1**,
  and exit requests overlapping an ordinary send fall from **2** to **0**.
- **6, signing custody:** copy Cargo's artifact into a private platform
  package first. Sign, verify, notarize when configured, execute the version
  probe, hash and pack that staged binary. Copy the platform metadata and
  THIRD-PARTY-NOTICES into staging too. Strictly verify the installed
  consumer's Developer ID signature and match authority/team as well as
  digest. The fake harness now packs actual bytes and replaces Cargo's
  artifact after signature inspection: the base packs **20 B** of unsigned
  replacement; the fix packs the expected **15 B** and matching SHA-256 of
  `unsigned-signed`. An installed signature failure refuses even when the
  digest matches. No real signing service or publication was invoked.
- **7, schedules:** save the schedule shape digest with its release
  boundary in the same transaction. The regression changes **60,000 ms**
  to **120,000 ms** while held, releases at **119,999 ms**, and now enqueues
  **1** job at **120,000 ms** instead of **0**, with **0** duplicate firings
  at the same boundary. The same-shape restart test remains green.
- **8, enum widening:** reuse the runtime text-control predicate alongside
  the character count in assignability. Declarations and enum membership
  remain unchanged; widening requires every variant to be accepted text.
  Tests cover helper calls, text-column storage, a named index, JSON wire
  input, and retained enum-only control-character storage/lookup. `é`, `猫`
  and tab succeed through the entire text path. U+0001, U+007F and U+0085
  are refused as text, without changing their enum representation.
- **9, init:** write package.json to an exclusively created sibling temp
  file, preserve existing permissions, flush it, then rename it over the
  original. Failed writes remove the temp file. A child-only **512 B**
  RLIMIT_FSIZE forces a partial write: the base leaves a **512 B** truncated
  replacement, while the fix retains the original **50 B** byte-for-byte.
  Positive online/Expo merges and conflict preservation remain green.

The required red/green commands follow. Cargo and package tests below ran
from `snapback4/`; Node used
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`.

Finding 4, base:
`node --test --test-name-pattern='exit ordering|exit never bypasses|exit does not overlap' packages/snapback4/test/web-navigation.test.mjs`

```text
ℹ tests 3
ℹ pass 0
ℹ fail 3
```

Finding 6, base:
`node --test packages/snapback4/test/publish-signing.test.mjs`

```text
ℹ tests 17
ℹ pass 16
ℹ fail 1
```

Findings 4 and 6, final expanded suites:
`node --test packages/snapback4/test/web-navigation.test.mjs packages/snapback4/test/publish-signing.test.mjs`

```text
ℹ tests 29
ℹ pass 29
ℹ fail 0
ℹ duration_ms 5173.343833
```

Finding 7, base:
`cargo test -p snapback4 --test replay changed_schedule_shape_releases_at_first_boundary -- --nocapture`

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.01s
```

Finding 9, base:
`cargo test -p snapback4 --test init --test replay -- --nocapture`
(the initial command stopped after init; the separate command above ran replay).

```text
test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.21s
```

Findings 7 and 9, green:
`cargo test -p snapback4 --test init --test replay --no-fail-fast -- --nocapture`

```text
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.79s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.35s
```

Finding 8, base:
`cargo test -p snapback4-lang --test ergonomics enum_widening_respects_text_character_domain -- --nocapture`

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 18 filtered out; finished in 0.00s
```

Finding 8 and published cards, green:
`cargo test -p snapback4-lang --test ergonomics --test guide -- --nocapture`

```text
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
```

The first exit-test attempt could not import the absent generated wasm
module. `bash scripts/build-wasm.sh` and
`bun run --cwd packages/snapback4 build` supplied it before the actual base
regression above. The wasm build reported **1,649,049 B raw**, **457,519 B
gzip**. During test development, additional assertions exposed fixture
assumptions (ordinary offline attempts still in flight, missing insert
permission, and treating a mutation's Failed outcome as a Rust Err); those
were corrected without further enum/runtime changes. One accidental root
Cargo invocation refused the unknown Snapback 4 package before testing;
all recorded Rust test results above are from its own workspace.

Required real-browser command, from the repository root:
`node snapback4/witness/navigation.mjs`. It exited **1** before evaluation:
Chromium terminated with `signal=SIGABRT`, so it produced **no witness JSON
line**. The witness now expects one oldest write before reopen and waits
for both writes to settle after reopening. The browser remains a lead
handoff outside the sandbox; the Node/wasm/HTTP navigation test passed.

Published-surface updates are in the package README, language/type cards,
and the writes card's exit paragraph. The workspace README records staged
publication custody. No compiler diagnostic string or E_/N_ code was added
or replaced; invalid widening now uses the existing E_QUARRY_TYPE refusal.
No before/after diagnostic wording was requested by this brief. No form
changed, so apps, fixtures and loopbar authoring callers need no migration.
Supporting files beyond the named implementation paths are the existing
adjacent tests, `witness/navigation.mjs`, `snapback4/README.md`, and the
required package README/cards/journal. The unrelated prediction paragraph
in the writes card is untouched. No core-engine implementation file,
ceiling, serialization, or existing corpus case changed. There are **16**
changed code files, **0** above 1,500 lines; the largest is guide.rs at
**1,229** lines. Earlier journal content remains byte-identical to the base.

Blocking suite, from the repository root with Node 24 on PATH:
`bash snapback4/scripts/test.sh`

```text
-- ok: cargo build (3 s)
-- ok: wasm build (3 s)
-- ok: package typecheck (1 s)
-- ok: package build (1 s)
-- ok: chat app check (3 s)
-- FAIL: cargo test (374 s)
-- ok: chat app typecheck (2 s)
-- ok: expo app typecheck (5 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
-- ok: fixture wrapper tests (15 s)
ℹ tests 194
ℹ pass 193
ℹ fail 1
-- FAIL: client tests (59 s)
== 2 failure(s) in 385 s
```

The 53 Rust result summaries total **709 passed, 1 failed, 2 ignored**.
The failing lifecycle target reported:

```text
test result: FAILED. 12 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.52s
```

Its single failure was
`dev_and_serve_report_signals_without_an_application_worker`: startup
stderr interleaved with the serve SIGTERM diagnostic (`snapback4 serve:
http://SNAPBACK4_SIGNAL ...`). The isolated rerun, from `snapback4/`,
`cargo test -p snapback4 --test lifecycle dev_and_serve_report_signals_without_an_application_worker -- --nocapture`, passed:

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out; finished in 4.63s
```

The sole client failure was the program's named Chromium environment
artifact. Isolated command, from `snapback4/`:
`node --test packages/snapback4/test/react.test.mjs`


## 2026-09-14 — W1: a published iOS simulator witness (S30)

Base: `8e02e1530f2db73eeddc205f267906d206792dc6`. Built the app-facing
`snapback4-expo/witness` export and types, the `snapback4 witness ios` verb,
the `witness` card (aliases `simulator`, `offline proof`), the README recipe,
and LLP 3000.007 §20.10. The repository witness now invokes the published
verb for `offline` and `restart`; the chat app uses the published helper,
shows its real Thread during the scenario, and keeps the two write IDs in
SecureStore across the driver's process termination. Its fixture seeds 303
rows and checks 50 history rows, two pending sends, their exact bodies and
ordered `sent` settlements. Those are scenario assertions, not native
measurements from this run.

The helper owns the step protocol in TypeScript. The only new native bridge
is 46 lines in `WitnessContainer.swift` plus three module registrations:
Hermes/Expo does not expose runtime launch environment, and durable append
must reach the app's Documents directory. A simulator-only environment
constant activates a run; ordinary launches return null even if old run
files exist. Synchronous file append flushes each JSONL line. A run-specific
file signals reconnect after the owned backend reports readiness, without
network entitlements or a second HTTP endpoint. Application receipt fields
are unchanged; only `witness: { at, step }` is added. The app's completed
steps drive progress; running receipts cannot prematurely finish a step.

The CLI refuses ambiguous booted sets, missing apps, occupied ports,
non-macOS, malformed receipts, missing/empty artifacts, failed/out-of-order
steps, and timeouts. It finalizes video before stopping logs, stops only
its recorded host children, explicitly targets the selected app/UDID for
termination, and binds the exported receipts and video by SHA-256 in the
run manifest. A failed run retains a nonzero manifest when setup got far
enough to create one. The fake-simctl tests start and stop a real dev backend
and exercise both cold launch and relaunch; they are driver tests, not
simulator evidence. No meter, value serialization or existing corpus case
changed. No commit, push, tag or publication was made.

Necessary supporting edits outside the central witness files: the starter's
`verbs/init.rs` extraction now removes the new reference-app harness; its
existing positive template tests pass. The React test stubs the helper as
inactive on its browser host (two lines). The README example test resolves
the new package subpath to its actual source (one line). `AGENTS.md` names
the new repository invocation. No loopbar caller used the removed form.
The NOT-DOING history records the move: the published witness replaces the
repository-only Metro witness; the deterministic simulator stays primary.

### Verification and red/green

All Cargo/Bun and package test commands below ran from `snapback4/`; the
full suite, reference check and caps ran from the repository root. Every
Node/Bun/npx command used:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
```

The regression was red before implementation: the CLI had no witness verb
or card, and the helper import did not exist. Exact commands and summary
lines follow; full command output remains in the named `/tmp/sb4-w1-*` logs.

Before implementation: `cargo test -p snapback4 --test witness`

```text
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.12s
```

After implementation: `cargo test -p snapback4 --test witness`

```text
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 12.75s
```

Final targeted Rust: `cargo test -p snapback4 --test witness --test init`

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.15s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 11.77s
```

Before implementation: `node --test packages/snapback4/test/witness.test.mjs`

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

Chromium again exited with `signal=SIGABRT` before the test's page launched.
There were no en-masse client timeouts, so no reduced-concurrency rerun
was needed. Neither this record nor the report claims a newly discovered
failure is pre-existing at the base: the lifecycle failure passed in
isolation on the changed tree, and the Chromium classification follows the
user's explicit environment ruling. The lead must rerun Chromium outside
the sandbox. A read-only `cargo test --workspace --no-fail-fast -- --list`
identified the long-running 51-test device and 34-test simulator suites
while the blocking run was in progress; both finished. The complete raw
logs for this session are under `/tmp/w2r1c/`.

Final root reference check: `./ref-check --verbose`

```text
ref-check: ok — 480 LLP docs, 8880 refs in 22919 files, 0 errors, 0 unchecked
```

`git diff --check` is clean. The journal prefix before this entry is
byte-identical to the base. All five requested fixes are implemented;
the missing real-browser JSON is the only unfinished acceptance evidence.
No sub-agent, other machine, install, commit, push, tag or publication was
used. Changes remain uncommitted for the lead.

ℹ duration_ms 33.3465
```

Final helper: `node --test packages/snapback4/test/witness.test.mjs`

```text
ℹ tests 3
ℹ pass 3
ℹ fail 0
ℹ duration_ms 268.320166
```

Helper and compiled README: `node --test packages/snapback4/test/witness.test.mjs packages/snapback4/test/readme-examples.test.mjs`

```text
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ duration_ms 711.196542
```

Final targeted JS, including the generated Expo starter: `node --test packages/snapback4/test/periphery.test.mjs packages/snapback4/test/witness.test.mjs packages/snapback4/test/readme-examples.test.mjs`

```text
ℹ tests 22
ℹ pass 22
ℹ fail 0
ℹ duration_ms 1856.605083
```

Final guide: `cargo test -p snapback4-lang --test guide`

```text
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

Isolated rerun of a port teardown race: `cargo test -p snapback4 --test witness bound_port_is_refused_without_stopping_its_owner`

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 8 filtered out; finished in 0.00s
```

The first full suite found the stale starter extraction, the missing guide
list entries and a test's assumption that an ephemeral port could not be
reassigned immediately. The port test passed alone before its positive
reservation was moved to a fresh port. The prescribed builds also generated
the initially absent wasm/types/API files; the early typechecks' missing
module errors are resolved. None of these failures is called pre-existing.

`bun run --cwd apps/chat-expo typecheck` exited 0:

```text
$ tsc -p tsconfig.json --noEmit
```

`bash snapback4/scripts/test.sh`, first run (`/tmp/sb4-w1-suite.log`):

```text
-- FAIL: cargo test (240 s)
ℹ tests 191
ℹ pass 188
ℹ fail 3
-- FAIL: client tests (42 s)
== 2 failure(s) in 260 s
```

`bash snapback4/scripts/test.sh`, final (`/tmp/sb4-w1-suite-final.log`):

```text
-- ok: cargo build (1 s)
-- ok: wasm build (1 s)
-- ok: package typecheck (1 s)
-- ok: package build (0 s)
-- ok: chat app check (1 s)
-- ok: cargo test (232 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
-- ok: fixture wrapper tests (8 s)
ℹ tests 191
ℹ pass 190
ℹ fail 1
-- FAIL: client tests (41 s)
== 1 failure(s) in 236 s
```

The final Rust summaries total **696 passed, 0 failed, 2 ignored**, across
53 summaries. No lifecycle timeout occurred. The one client failure is
Chromium SIGABRT at browser startup, before application modules load.

Final reduced-concurrency client run: `node --test --test-concurrency=2 'packages/snapback4/test/*.test.mjs'`

```text
ℹ tests 191
ℹ pass 190
ℹ fail 1
ℹ duration_ms 73113.494458
```

Chromium alone: `node --test packages/snapback4/test/react.test.mjs`

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ duration_ms 318.316208
```

Baseline browser-startup reproduction: `node --test /tmp/sb4-w1-base-react.test.mjs`

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ duration_ms 231.920333
```

The baseline browser reproduction uses the React test source from
`8e02e1530f2db73eeddc205f267906d206792dc6`, with only its two relative path
roots relocated into `/tmp`; `witness/lib.mjs` is unchanged from that base.
It aborts at `chromium.launch`, before any application source is loaded.
This verifies the browser-startup failure against the base test, not a full
baseline suite. The lead must run browser and native qualification outside
this sandbox.

`node scripts/caps.mjs` reports `2 violations.` Both inputs were verified
against the same base: the same 65 non-dot working-set links against a cap
of 59, and the byte-identical root
`crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` at 1,504 lines
(SHA-256 `1eae485cacf83f8823f2716b33c49e1d4df32fdd1f1e68b8b0e3491338274ad9`).
The 19 changed/new code files are all below 1,500; the largest is
`crates/snapback4-lang/src/guide.rs`, 1,212 lines. Markdown was not reflowed
to save lines. `git diff --check` passed.

### Native attempt and measurements

The dedicated simulator could not be created. Command:

```sh
xcrun simctl create sb4-w1 'iPhone 17' com.apple.CoreSimulator.SimRuntime.iOS-26-5
```

`/tmp/sb4-w1-sim-create.log` records the exact output, including:

```text
CoreSimulatorService connection became invalid.  Simulator services will no longer be available.
```

The failure ends with `Unable to locate device set` and POSIX code 61
`Connection refused`. No simulator UDID was returned; no simulator was
booted or deleted, and no other session's simulator was touched.

From `snapback4/apps/chat-expo`, the Release command was:

```sh
npx expo run:ios --configuration Release --device sb4-w1
```

It exited 1 after prebuild; `/tmp/sb4-w1-release.log` contains the full
output. CocoaPods reported `Operation not permitted @ rb_sysopen` for
`/Users/ccheever/.cocoapods/repos/trunk/deprecated_podspecs.txt`. Exact final
lines:

```text
pod install --repo-update --ansi exited with non-zero code: 1
CommandError: Can't determine id of Device Hub or Simulator app; the Device Hub or Simulator is most likely not installed on this machine. Run `sudo xcode-select -s /Applications/Xcode.app`
```

The generated, ignored `apps/chat-expo/ios/` directory from this failed
attempt was removed. No package install was run without a frozen lockfile.
As instructed, native verification stopped here; the driver was not weakened
and no substitute was called a native pass. Native end-to-end runs: **0**.
Native MP4/JSONL/run-manifest artifacts: **0/0/0**; paths, byte sizes and
native end-to-end timings are unavailable because installation never
completed. In particular, neither cold-offline nor kill/relaunch/ordered
flush is claimed to have passed on an iOS simulator in this lane.

Measured non-native verification: helper **268.320166 ms** (3/3), targeted
Rust driver **11.77 s** (9/9), targeted JS **1856.605083 ms** (22/22), final
blocking suite **236 s**, reduced-concurrency clients **73113.494458 ms**.
The fake driver completes two positive process scenarios; its synthetic
files are temporary test inputs, not attachable app proof artifacts.

What remains: one Release installation and both native scenarios on a
dedicated simulator, with the three artifacts, their sizes and end-to-end
timings; the sandbox cannot provide them. Swift native compilation and
recordVideo/log-stream behavior remain unqualified by this lane. All
non-simulator implementation and requested documentation are present.

The discovery diagnostic before the change began with:

```text
unknown verb witness
```

It was followed by the global help. For `snapback4 witness ios`, the new
complete refusal is:

```text
E_WITNESS_INPUT: --bundle-id is required; see snapback4 guide witness
see snapback4 guide witness
```

The helper's former import failure was `ERR_MODULE_NOT_FOUND`; it now
returns null on an ordinary launch and preserves receipts under the fake
container's positive test. Twelve new `E_WITNESS_*` codes are in
`guide::CODES`; the guide's compiled-card/code checks pass.

Final root `./ref-check --verbose` passed after the entry was appended:

```text
ref-check: ok — 480 LLP docs, 8880 refs in 22925 files, 0 errors, 0 unchecked
```

The prior journal remains byte-identical to the base; only this dated entry
was appended. The final working tree contains the intended source/docs/tests,
with no native video or generated iOS project committed or left as source.

## 2026-09-14 — W1 native end-to-end, run by the lead outside the lane sandbox

The lane could not reach CoreSimulatorService from its sandbox. On a dedicated
simulator (`sb4-w1`, iOS 26.5) the lead ran the repository witness through the
published verb and helper:

- `npx expo run:ios --configuration Release` failed at base: the Release
  simulator build asks for `arm64 x86_64` and `Snapback4Device.xcframework`
  carries only arm64 device and arm64 simulator slices ("Unable to find
  matching slice"). The podspec now excludes x86_64 for simulator SDKs in the
  pod and the user target; the same command then builds, installs and opens.
- A failed step recorded only `primed:failed`; the helper now records the
  error message in that receipt (`{"error": …}`), which found the next two
  problems at once.
- The device log streamed the whole simulator at debug level (30 MB for a
  10-second segment); it now streams only the app's `CFBundleExecutable`
  (3–5 MB), and the manifest records the executable.
- An ad-hoc build without code signing loses the keychain entitlement
  `expo-secure-store` needs; build normally (the default signs for the
  simulator).

Result on the `expo run:ios` build, clean install: `{"witness":"published-ios","ok":true,"ms":17424}`
— offline segment: primed (303 seeded, 50 rows online), cold history 50 rows
`fresh: false` link offline, two pending sends, reconnect flush seq in compose
order; restart segment: the same plus kill and relaunch offline with both
writes still pending, then ordered flush. Videos 1.07 MB and 3.48 MB. With an
app store left from an earlier backend store the prime fails deterministically;
filed `issues/20260914-snapback4-device-store-from-a-replaced-backend-never-reacquires.md`.

## 2026-09-14 — W2R1u: prove the whole upsert insert before predicting it

Base: `0e9fdddba4fe34684d99215b70ac8dae2d164c42` (`sb4/w2-int`). Read
GPT findings 1, 2, 5 and 10 and obligations 1 and 8, lane F's journal and
`20ea0534d`. The governing constraints are LLP 3000.007 §20.5 (ruling 19),
§8.7/§15/§17 (prediction confers no hidden-row authority), and §18.2 (a
left group is retained history, not whole-group absence evidence).

The common insert arm now materializes defaults, proves readability again
using the addressed index's values from that actual image, and proves
coverage of every non-null secondary unique lookup and every affected cap
prefix. The original addressed-key absence proof remains. A cap without
`by` has the empty prefix and needs full public sync. A private partition
cannot rule out another viewer's collision or count. The intrinsic byId
key is either the already-proven address or the newly minted row identity.
Both engine upsert paths use the same insert proof; ordinary insert and
update semantics, rules, value serialization and meter ceilings are unchanged.

Prediction now reads the persisted held/left map through the same helper
as the reading adapter, in direct prediction, admission and replay. When
replay loses prediction evidence it withdraws the overlay and clears the
entry's `predictable` and `predicted` fields while keeping the queued write.
The writes card, prediction card and README state the same conditions.
There is no new Quarry form, diagnostic code, or note.

Thirteen added device tests exercise 46 device scenarios on the SQLite and
memory stores against the server: 8 changed-audience scenarios (including
the `require r = null else WRONG` program), 24 hidden-constraint scenarios
(secondary unique, grouped cap, whole-table cap and a defaulted unique
column, each absent/noncolliding/colliding), 6 positive covered-constraint
and default scenarios, 2 defaulted insert-rule refusals, 2 ordered pending
delete/upsert lifecycles, and 4 left-group admission/replay scenarios.
One guide test rejects the categorical obsolete writes-card sentence.
The existing first-like prediction remains 1 row on each store; the feeds
card predicts 2 rows, the vote and maintained score. The affected tests
added no meter ceiling or serialized-value changes.

The observation helper now serializes the entire local QueryOutcome and
uses ordinary wire JSON only for its data: continuation, all seven meter
fields, caps, word cuts, sequence, dependency tables and next expiry are
retained. It can record a local admission refusal even if the server later
succeeds. Changed-audience worlds compare the full existing observation
(first/retry bodies, receipt, meters, deltas, effects, snapshots, streams,
and both complete device lifecycles), with an absent/noncolliding control.
Constraint worlds compare complete device observations through reopen;
the server's expected acceptance/refusal and settlement are checked in each
world, rather than incorrectly demanding identical server results when a
constraint legitimately refuses. This helper remains in-process; actual
HTTP status and JavaScript subscription notifications are not exercised.

Reproduction qualification for finding 5: an ordinary server scope
tombstone retains the old self-membership image under delivered-history;
it does not itself produce the review's missing membership row. The
regression therefore pairs the actual server scope with an explicit row
tombstone for the membership the server has confirmed deleted, proving the
missing-row/left-group state on admission and replay. The reading adapter
confirms that the empty group is left. Before the fix, admission returned
`NOT_FOUND` and replay retained stale prediction metadata. This is a
boundary-state regression, not a claim that the normal scope-only stream
delivers the additional row tombstone.

### Red before, green after

Only tests and the observation helper changed for the red run; production
sources were still exactly the base above. Cargo commands below run from
`snapback4/`.

```text
cargo test -p snapback4-device --test device upsert::proof -- --nocapture
test result: FAILED. 3 passed; 10 failed; 0 ignored; 0 measured; 51 filtered out; finished in 0.37s
```

Finding 1 — changed audience and valued result:

```text
test upsert::proof::changed_audience_program_result_queues_on_both_stores ... FAILED
test upsert::proof::changed_audience_image_queues_on_both_stores ... FAILED
test upsert::proof::changed_audience_image_queues_on_both_stores ... ok
test upsert::proof::changed_audience_program_result_queues_on_both_stores ... ok
```

Finding 2 — secondary unique and both cap populations:

```text
test upsert::proof::defaulted_hidden_unique_collision_queues_on_both_stores ... FAILED
test upsert::proof::hidden_whole_table_cap_occupancy_queues_on_both_stores ... FAILED
test upsert::proof::hidden_secondary_unique_collision_queues_on_both_stores ... FAILED
test upsert::proof::hidden_group_cap_occupancy_queues_on_both_stores ... FAILED
test upsert::proof::hidden_whole_table_cap_occupancy_queues_on_both_stores ... ok
test upsert::proof::hidden_secondary_unique_collision_queues_on_both_stores ... ok
test upsert::proof::hidden_group_cap_occupancy_queues_on_both_stores ... ok
test upsert::proof::defaulted_hidden_unique_collision_queues_on_both_stores ... ok
```

Finding 5 — left self-witness admission and replay:

```text
test upsert::proof::left_self_witness_admission_memory ... FAILED
test upsert::proof::left_self_witness_replay_memory ... FAILED
test upsert::proof::left_self_witness_replay_sqlite ... FAILED
test upsert::proof::left_self_witness_admission_sqlite ... FAILED
test upsert::proof::left_self_witness_admission_memory ... ok
test upsert::proof::left_self_witness_replay_memory ... ok
test upsert::proof::left_self_witness_replay_sqlite ... ok
test upsert::proof::left_self_witness_admission_sqlite ... ok
```

Finding 10 — obsolete writes-card guidance:

```text
cargo test -p snapback4-lang --test guide writes_card_explains_the_whole_upsert_insert_proof -- --nocapture
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 15 filtered out; finished in 0.00s
```

The three positive/control tests (covered constraints and defaults,
defaulted insert-rule refusal, and ordered pending delete/upsert) were
already green on the base; they motivated no additional production change.
The final green targeted commands and verbatim summaries:

```text
cargo test -p snapback4-device --test device upsert -- --nocapture
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 46 filtered out; finished in 0.48s
```

```text
cargo test -p snapback4-lang --test guide
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
```

```text
cargo test -p snapback4-device --test device --test write_authority
test result: ok. 64 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 45.29s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.74s
```

```text
cargo test -p snapback4-sim --test residency --test write_authority
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.50s
```

Setup corrections before the valid red run: one accidental Cargo
invocation at repository root exited 101 without running tests; it was
rerun from `snapback4/`. A test initially used `Value::Time`, corrected to
the existing `Value::Int` representation. Neither is counted as regression
evidence. Early fixture assertions were corrected to equalize server seed
sequence and to inspect left groups through a range query; the valid red
run above is the one that reaches each reported production defect.

### Published text

No diagnostic text or code changed. Before, the writes card said verbatim:

```text
`upsert` set-state writes (likes, reactions and votes) predict only updates of
rows the device holds; a missing row queues without a prediction. See
`guide prediction` for a predictable insert/delete set-membership recipe.
```

After:

```text
`upsert` set-state writes (likes, reactions and votes) predict updates of
rows the device holds. A missing row predicts an insert only when its synced
group is held with no horizon, both the key and the materialized insert image
prove readability, and the device holds every row that can collide on a
secondary unique index or count toward an affected cap. Defaults are part of
that image. Otherwise it queues without a predicted row, including in a left
group. See `guide prediction` for the conditions and a set-membership recipe.
```

### Blocking suite and scope

From the repository root, with the required Node 24 runtime:


## 2026-09-14 — Lane W2R1m: a merged cursor never skips an unfinished lane

Base: `0e9fdddba4fe34684d99215b70ac8dae2d164c42`. Reproduced GPT review
finding 3 on the server and both device stores before changing the runner.
The ordinary single-table merge has the same defect at this base: with a
readable row at 10 in lane A and 8,193 hidden rows above 20 followed by a
readable row at 15 in lane B, the first page examines 8,193 rows, returns
10 incomplete, and emits a cursor after 10. Its next page is empty, skipping
15 forever. All six server/SQLite/memory × cross-table/single-table cases
failed on that exact omission. The extra uniform test reproduces the lazy
merge's same mistake with expired rows spending the examined ceiling.

The existing cursor carries one position, without per-lane progress. Both
merge implementations now withhold `next` on a meter or word-limit cut,
and for the whole non-uniform class even within budget. Withholding only
on a physical cut would make cursor presence reveal hidden populations.
This conservative choice keeps `complete: false` and gives up pagination
for non-uniform merges; pin each lane's deciding columns to obtain a
pageable feed. Single plain scans keep their visible-position policy.
No meter ceiling, value serialization or cursor serialization changed.

The 48 paired comparisons cover 16 server, 16 SQLite and 16 memory wire
observations. Each compares the entire query envelope (data, completeness,
continuation including its absence, expiry and table dependencies; server
sequence and viewer; device unknown/retained coverage). Hidden populations
are 8,190, 8,191, 8,192 and 8,193 against 0, for both merge forms, with
an empty second lane or a readable row at 5 below the returned key. Operator
meters and cut sites remain off both viewer wires; their differing physical
cost is the existing non-uniform contract. These are in-process wire-shape
comparisons, not HTTP transport measurements. The online-only fixture
places candidates directly in each device store to exercise per-row read
rules; it makes no claim that sync delivers hidden rows to a device.

Positive controls page three equal-time IDs in descending ID order on all
three hosts, deduplicate an equal `(at, id)` projection copy, and continue
through generation N+1 after an additive field. A changed direction is
refused with existing `E_INPUT`. The descriptor, not generation, binds the
cursor. The feeds card and README state that contract; the feeds/search
cards, README and LLP 3000.007 §20.3 state the conservative continuation rule.
Existing non-uniform search assertions now require no cursor while retaining
their readable results and paired-world checks. The corpus adapter stops
synthesizing a merged continuation from its last visible row; the frozen
case's absent cursor is kept. Zero files under `snapback4/corpus/` changed.

### Targeted commands and red/green evidence

Cargo commands run from `snapback4/`. Initial fixture compile/setup errors
(missing trait imports, SQLite reset before device-side tables existed,
and querying a new device generation before its snapshot) were corrected
before the valid base reproductions below; none is claimed pre-existing.

`cargo test -p snapback4-sim --test clique merge_cursor -- --nocapture`:

```text
test result: FAILED. 3 passed; 3 failed; 0 ignored; 0 measured; 34 filtered out; finished in 7.11s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 34 filtered out; finished in 7.92s
```

`cargo test -p snapback4-device --test device merge_cursor -- --nocapture`:

```text
test result: FAILED. 3 passed; 6 failed; 0 ignored; 0 measured; 51 filtered out; finished in 3.44s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 51 filtered out; finished in 3.59s
```

`cargo test -p snapback4-sim --test search_merge -- --nocapture`:

```text
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
```

`cargo test -p snapback4-device --test device search_merge -- --nocapture`:

```text
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 50 filtered out; finished in 0.20s
```

`cargo test -p snapback4-lang --test guide -- --nocapture`:

```text
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
```

### Full blocking suite and isolated reruns

From the repository root:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
bash snapback4/scripts/test.sh
```

Verbatim stage, Rust and JavaScript summary lines:

```text
-- ok: cargo build (36 s)
wasm 1651371 B raw, 458493 B gzip
-- ok: wasm build (23 s)
-- ok: package typecheck (6 s)
-- ok: package build (2 s)
-- ok: chat app check (4 s)
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.07s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.28s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.44s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.21s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.38s
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.61s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.59s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.22s
test result: ok. 64 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 47.63s
test result: ok. 90 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 25.21s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.63s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.36s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.60s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.29s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 85.33s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.63s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.70s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 33 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 33.33s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.00s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 43 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.68s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.74s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 7 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 3.72s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 19.82s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.29s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
-- ok: cargo test (460 s)
-- ok: chat app typecheck (2 s)
-- ok: expo app typecheck (11 s)

The suite completed every group in 532 s on the loaded shared host. Summing
its 53 Rust result lines gives 721 passed, 1 failed, 2 ignored. The failure
was `dev_and_serve_report_signals_without_an_application_worker`: its
expected SIGHUP signal line was preceded by a partial startup line,
`snapback4 serve: http://127SNAPBACK4_SIGNAL verb=serve generation=1 reason=SIGHUP signal=1`.
The isolated rerun below passed. All merge, search, corpus and guide checks
passed in the full run. The stages, verbatim:

```text
-- ok: cargo build (35 s)
-- ok: wasm build (23 s)
-- ok: package typecheck (6 s)
-- ok: package build (2 s)
-- ok: chat app check (7 s)
-- FAIL: cargo test (459 s)
-- ok: chat app typecheck (2 s)
-- ok: expo app typecheck (10 s)
-- ok: fixture wrapper tests (33 s)
-- FAIL: client tests (68 s)
== 2 failure(s) in 532 s
```

Full Rust summaries, verbatim:

```text
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.09s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.42s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: FAILED. 12 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.84s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.39s
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.52s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.72s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.24s
test result: ok. 60 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 46.94s
test result: ok. 90 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 23.00s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.31s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.60s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.92s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.22s
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 84.08s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.66s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.61s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 39 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 33.38s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.77s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 43 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.48s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.71s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 7 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 3.70s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 20.04s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.53s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

Fixture and client summaries, respectively:

```text
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
-- ok: fixture wrapper tests (34 s)

ℹ duration_ms 33041.606916
ℹ tests 188
ℹ pass 187
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
-- FAIL: client tests (69 s)
== 1 failure(s) in 531 s
```

Rust totals: **720 passed, 0 failed, 2 ignored**. Fixtures: 9/9. Clients: 187/188.
The only suite failure is Chromium SIGABRT during the React test's browser
launch. The isolated rerun from `snapback4/` reproduces it:

```text
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
node --test packages/snapback4/test/react.test.mjs

ℹ duration_ms 68402.645875
```

The client failure was the program's documented Chromium sandbox SIGABRT,
reproduced alone from `snapback4/` with the pinned Node PATH:
`node --test packages/snapback4/test/react.test.mjs`.

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
```

This matches the known sandbox artifact named in the lane brief. I did not
rerun the unmodified base for the browser failure and make no independently
base-verified pre-existing-failure claim. No lifecycle or mass client timeout
was observed, so a reduced-concurrency rerun was not needed. The lead still
needs the outside-sandbox browser run.

The rebuilt wasm measured **1,651,371 bytes raw; 458,493 bytes gzip**. No
before/after size improvement is claimed. The largest changed code file is
778 lines (`device.rs`); Markdown was not compressed. No out-of-scope file,
corpus case, meter ceiling, value form, transport, signing, schedule, enum,
init, app or loopbar file was changed. No commit, push, tag or publication
was made. The supplied scenarios are covered with the explicit left-group
fixture qualification above; actual browser execution remains unverified.

Final root checks:

```text
./ref-check --verbose
ref-check: ok — 480 LLP docs, 8881 refs in 22920 files, 0 errors, 0 unchecked
git diff --check
```

`git diff --check` exited 0 with no output. HEAD remains the base above;
the working tree contains only the 13 intended source, test and documentation
files, including the new upsert proof test module.

ℹ duration_ms 391.320625
```

From `snapback4/`,
`cargo test -p snapback4 --test lifecycle dev_and_serve_report_signals_without_an_application_worker -- --nocapture`:

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out; finished in 3.54s
```

After the last feeds-card wording edit,
`cargo test -p snapback4-lang --test guide -- --nocapture`:

```text
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

Root `./ref-check --verbose`, with the pinned Node PATH:

```text
ref-check: ok — 480 LLP docs, 8880 refs in 22922 files, 0 errors, 0 unchecked
```

No new failure is asserted to predate the base without a base reproduction.
The Chromium classification comes from the brief's explicit environment
ruling and the isolated reproduction here, not a whole-suite base claim.
The lifecycle assertion is reported as an intermittent failure that passed
alone on this change. The lead must rerun the browser witness outside the
sandbox. No client en-masse timeout or lifecycle timeout occurred.

All requested implementation items are done; the permitted no-continuation
option was selected instead of extending the descriptor with per-lane state.
No out-of-scope feature or file was changed. Supporting core corpus-adapter
and read-verdict test expectations changed to match the narrower merge
contract; no golden corpus cases changed. There are 16 changed/new files,
12 code files, 0 above 1,500 lines (largest: device tests, 1,455 lines),
0 new diagnostic codes, 0 diagnostic text changes. The brief requests no
diagnostic before/after text for this lane. No application spelling changed.
`git diff --check` passes, and the journal's prefix is byte-identical to the
base with this one appended dated entry. Nothing was committed, pushed,
tagged or published.

## 2026-09-14 — X1: a device outlives two backend stores

Implemented the replacement-store acquisition boundary for
`20260914-snapback4-device-store-from-a-replaced-backend-never-reacquires`.
Base: `bca8bfe70d320c1d466c6a700493465662b2205e`. The worktree was clean
before the reproduction. No commit, push, tag or publication was made.

The first tests were red on that base. Both Rust stores acquired three
commits from A, queued one prediction, reopened against empty B at the same
generation, and applied B's stream. B answered watermark **3**, although
its head was **0**; apply succeeded with no touched tables and the read
returned **3 old rows + 1 predicted row**, `complete: true`, `unknown: false`.
The Node/wasm client reproduced the same retained watermark and four rows
against B at head **1**, with its durable write still predictable. The bug
was not just a refusal to move backwards: the server's early stream return
had echoed the supplied watermark, allowing the obsolete partition to look
caught up. The old sync loop marks such a completed round fresh; the
reproduction's logged read was the device result, which has no `fresh` field.

The server now creates one random **128-bit / 32-hex-character** identity in
`_meta.store_id`, independent of generation and durable across database
reopen. Sync responses and change notifications add `store_id`; sync accepts
an optional echo and ignores a foreign store's snapshot cursor. The request
and response extension is additive; legacy requests still work, and the
client only echoes an identity once learned. A backwards stream request
returns the server's real head. The decision is recorded in LLP 3000.007
§18.2, with the README and sync card updated.

On identity change, one device transaction discards confirmed and predicted
rows, base images, staged pages, acquisition and held/left history; resets
the watermark; and preserves unsent/unknown-receipt entries in order with
their operation and row IDs, without predictions. Known sent or stream-
acknowledged receipts retire without another execution. The existing send
revision also fences responses captured before replacement. The client
reloads `/schema` even if its generation number repeats, acquires a fresh
snapshot and catch-up, clears remembered server answers, and serializes
write receipt settlement with sync. The native-version probe now requires
the store-identity protocol; existing mock-device fixtures were updated.
No value serialization, meter ceiling or existing corpus case changed.

Positive coverage includes both Rust stores, persisted wasm, empty B,
equal-watermark B/C, a second reset, known/unknown/unsent receipts,
at-most-once retry, an interrupted snapshot followed by offline reopen,
left-group history, an obsolete response arriving after reset, unchanged
store identity across restart, and changed programs at the same generation.
The wasm pending-write scenario reacquires **2 rows in B**, then **2 in C**,
with **1 mutation POST**; the receipt scenario sends the known receipt's ID
**0** times to B and the unknown receipt's ID **1** time, and its next retry
reports `replayed: true`. The Rust equal-watermark scenario holds **4** B
rows before its **2** surviving writes and **6** afterwards; C acquires
**0**. No obsolete rows survive acquisition. During interrupted acquisition,
the core reports unknown `E_PREDICT`; the offline public client reports
`E_OFFLINE` without data. Ordinary online fallback can answer from B.

An existing observation test caught my initial approach of syncing after
every idle heartbeat. The final change notification carries identity so
idle polls on the same database still do no sync work. An existing exit-send
test also caught a changed refusal string; the final code keeps the original
mutation-send message and gives obsolete-store responses their own message.
These were introduced defects, corrected here, not attributed to the base.

### Verification commands and results

Cargo, Bun and client test commands below ran from `snapback4/`; the full
script and reference check ran from the repository root. Every Node/Bun
command used this pinned runtime first:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
```

Preparation/rebuild commands were `cargo build -p snapback4 --quiet`,
`bash scripts/build-wasm.sh`, `bun run --cwd packages/snapback4 build`, and
`bun run --cwd packages/snapback4 typecheck`. The frozen installs were reused.
During test construction, a mistyped `--test acquisition` target reported
`error: no test target named `acquisition` in `snapback4-device` package`;
the correct existing suite is `adoption`. The initial test edits also had
compile errors (mutation-call signature/type annotations); no pass count is
claimed for those attempts. The first full-script attempt was interrupted
while correcting the introduced idle-sync regression, before an aggregate
summary; its completed build/typecheck steps passed. Subsequent full runs
are recorded below.

```sh
cargo test -p snapback4-device --test device replaced_backend -- --nocapture
```

Before the fix, on the named base:

```text
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 73 filtered out; finished in 0.03s
```

First green reproduction:

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 73 filtered out; finished in 0.05s
```

```sh
cargo test -p snapback4-device --test device store_reset -- --nocapture
```

Expanded scenarios:

```text
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 73 filtered out; finished in 0.14s
```

```sh
cargo test -p snapback4-device --test device --test native --test retained_history --test adoption -- --nocapture
```

Affected device suites:

```text
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 77 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 33.31s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.33s
```

```sh
node --test packages/snapback4/test/store-reset.test.mjs
```

Before the fix, on the named base:

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ duration_ms 1215.162708
```

Final reset suite:

```text
ℹ tests 4
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ duration_ms 6819.422375
```

```sh
node --test packages/snapback4/test/store-reset.test.mjs packages/snapback4/test/acquisition.test.mjs packages/snapback4/test/client-lifecycle.test.mjs packages/snapback4/test/session-security.test.mjs
```

Initial broad client run (idle-sync regression; corrected afterwards):

```text
ℹ tests 62
ℹ pass 60
ℹ fail 1
ℹ cancelled 1
ℹ duration_ms 224331.370708
```

```sh
node --test --test-concurrency=2 packages/snapback4/test/store-reset.test.mjs packages/snapback4/test/acquisition.test.mjs packages/snapback4/test/client-lifecycle.test.mjs packages/snapback4/test/session-security.test.mjs
```

Broad client rerun (one server-start timeout):

```text
ℹ tests 63
ℹ pass 62
ℹ fail 1
ℹ cancelled 0
ℹ duration_ms 29271.317541
```

```sh
node --test --test-name-pattern='online watches retain their changes watermark' packages/snapback4/test/client-lifecycle.test.mjs
```

The timed-out client test, alone:

```text
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ duration_ms 132.856875
```

```sh
node --test packages/snapback4/test/http.test.mjs packages/snapback4/test/release-activation.test.mjs
```

The two full-suite host timeouts, rerun:

```text
ℹ tests 12
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ duration_ms 1961.801709
```

```sh
node --test --test-name-pattern='an exit send invalidates' packages/snapback4/test/web-navigation.test.mjs
```

Send-overlap message restored; existing regression:

```text
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ duration_ms 1472.872916
```

```sh
node --test --test-concurrency=2 'packages/snapback4/test/*.test.mjs'
```

All client tests at lower concurrency:

```text
ℹ tests 201
ℹ pass 200
ℹ fail 1
ℹ cancelled 0
ℹ duration_ms 82286.877584
```

```sh
cargo test -p snapback4-lang --test guide -- --nocapture
```

Published card and README checks:

```text
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
```

Full blocking script (repository root):

```sh
bash snapback4/scripts/test.sh
```

First completed run, before restoring the send-overlap wording. Rust totals across the 54 verbatim
per-target summaries: **754 passed, 0 failed, 2 ignored**.
The script's summary lines:

```text
-- ok: cargo build (0 s)
wasm 1657764 B raw, 460067 B gzip
-- ok: wasm build (3 s)
-- ok: package typecheck (1 s)
-- ok: package build (1 s)
-- ok: chat app check (3 s)
-- ok: cargo test (294 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
-- ok: fixture wrapper tests (9 s)
ℹ tests 193
ℹ pass 189
ℹ fail 4
-- FAIL: client tests (48 s)
== 1 failure(s) in 302 s
```

Final run, after the correction. Rust totals across the 54 verbatim
per-target summaries: **754 passed, 0 failed, 2 ignored**.
The script's summary lines:

```text
-- ok: cargo build (3 s)
wasm 1657814 B raw, 460125 B gzip
-- ok: wasm build (1 s)
-- ok: package typecheck (1 s)
-- ok: package build (0 s)
-- ok: chat app check (0 s)
-- ok: cargo test (336 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
-- ok: fixture wrapper tests (8 s)
ℹ tests 201
ℹ pass 200
ℹ fail 1
-- FAIL: client tests (45 s)
== 1 failure(s) in 341 s
```

The final full run's only failure, also the only failure at lower Node
concurrency, is `React hooks and reference-app lifetimes` in
`packages/snapback4/test/react.test.mjs`: Chromium exits with `SIGABRT`
inside the sandbox. This is the environment artifact explicitly identified
in the lane instructions; the lead reruns it outside the sandbox. The two
host-start timeouts in the first completed full run passed in the isolated
HTTP/release rerun (12/0), and the targeted client's server-start timeout
passed alone (1/0). No failure is called pre-existing without a base run;
none is claimed to have been verified as pre-existing here. The final Rust
run had no lifecycle failures.

The wasm build changed from **1,651,366 B raw / 458,474 B gzip** before the
fix to **1,657,814 B raw / 460,125 B gzip** after it: **+6,448 B raw /
+1,651 B gzip** on the pinned local toolchain. The additive 32-hex-character
`store_id` costs **46 JSON bytes** per sync/change reply and per sync request
that echoes it. The largest changed source file is **1,456 lines**; **0**
changed source files exceed 1,500 lines. The journal's base prefix is
byte-identical, with **1** new dated entry. The issue moved to
`issues/closed/20260914-snapback4-device-store-from-a-replaced-backend-never-reacquires.md`.
All files touched are within the lane's implementation, test, published-doc
or required bookkeeping scope; `serve_changes.rs` and `changes.ts` carry the
live identity notification, and the two existing client fixture files carry
the updated device-version probe.

No new diagnostic code or note was added; `guide::CODES` already covers
`E_GENERATION` and `E_PREDICT`. The brief does not ask for a diagnostic-text
comparison, but the reproduction's exact boundary is useful:

Before, apply returned:

```json
{"ok":{"touched":[]}}
```

After, direct device apply on discovering a replacement refuses after
persisting invalidation:

```text
E_GENERATION: the backend store was replaced; reacquire its partition
```

A partition-dependent core read until acquisition completes reports:

```text
E_PREDICT: this generation's partition has not completed acquisition; reconnect to acquire it
```

The public client's existing offline refusal message is `the server is
unreachable` (`E_OFFLINE`), with no data. The existing mutation-send overlap
message remains byte-for-byte `E_GENERATION: a mutation send overlapped the
sync response; retry sync`; an identified response captured before a reset
reports `E_GENERATION: the backend store was replaced during sync; retry sync`.

Final reference check, from the repository root with the pinned Node PATH:

```sh
./ref-check --verbose
```

```text
ref-check: ok — 480 LLP docs, 8888 refs in 22936 files, 0 errors, 0 unchecked
```

`git diff --check` passed. All **16** changed source files are within the
line cap. Required implementation, documentation and issue closure are
complete; the browser witness is the sole remaining outside-sandbox
verification for the lead. The working tree contains only these intended,
uncommitted changes.

## 2026-09-14 — X1R1: store replacement review findings 1–4

Base: `f69338c005af9fe6bc657af6287b22fd0934a3ed`. Read the full GPT review
at `/Users/ccheever/projects/snapback-x1-review/gpt.md`, the X1 entry and
LLP 3000.007 §18.2. All four findings reproduced before production edits:
six deterministic Node tests (finding 1: one; finding 2: four; finding 3:
one) and one native two-owner test (finding 4). No commit, push, tag,
publication, clone, remote work or sub-agent was used.

The reset now persists `device:backend-required`, with the replacement ID
(or `legacy`), alongside discarding the partition. Device reads and page
application refuse while it remains; backend installation clears it in the
same transaction that checks the store/send capture. A failed fetch, failed
save, offline reopen or restart cannot forget the obligation. The installed
backend has a digest too: another native owner's adoption at the same
generation does not bless an old owner's programs. The client probes the
updated internal protocol before it can use an old native/wasm device.

A client revision advances at replacement observation, invalidating
freshness, remembered answers and watch snapshots immediately. Read results
are checked again before returning, caching or notifying. A new rerun uses
the current server until replacement acquisition completes, because a rerun
started after observation can otherwise read the still-queued old partition.
Sync/change replies carry local revision fences as well.

Orphan import compares the persisted source/destination identities. Foreign
known receipts retire; unknown and unsent entries keep their operation and
row IDs with predictions disabled. Unresolved known receipts remain in their
source store with provenance, including across reopen; later identification
retries import. Same-store known acknowledgements are preserved. Legacy
fallback checks the reply against its own request watermark and checks that
the captured persisted watermark/send revision are still current before any
reset. Another owner's newer acquisition makes the old reply stale.

Two extra boundary regressions were found while checking the first repair:
the observation-triggered watch rerun described above, and a native owner
continuing with A's programs after another owner installed B. Both were red
on the intermediate implementation and green after the corresponding fix;
they are not represented as additional base-commit runs.

### Red and green evidence per finding

Every Node/Bun command below used this first:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
```

Cargo, Bun and targeted Node commands ran from `snapback4/`; the blocking
script and reference check ran from the repository root. The frozen installs
were reused. Rebuild commands were `bash scripts/build-wasm.sh`,
`bun run --cwd packages/snapback4 build`, and
`bun run --cwd packages/snapback4 typecheck`.

Test construction initially used an incorrectly tagged literal, then fixed
the harness before counting the base reds. The first native stale-page
fixture used a request capture of 1 (its attempted metadata setter was
client-namespaced); its final expansion explicitly pins 10 and includes a
left group's 50 rows. Both schedules advance to 12 before delayed page 11.
A later native test initially had a Rust declaration typo. One attempted
Cargo invocation from the repository root exited 101 before building; it
was immediately rerun from `snapback4/`. No pass count is attributed to
those setup/compilation mistakes.

```sh
node --test packages/snapback4/test/store-reset-review.test.mjs
```

Base, before production edits:

```text
✖ finding 1: failed same-generation backend adoption survives retry and offline reopen (152.38925ms)
✖ finding 2: delayed server answer cannot escape its incarnation (5.763583ms)
✖ finding 2: delayed horizon answer cannot escape its incarnation (13.554667ms)
✖ finding 2: delayed watch answer cannot escape its incarnation (3.220041ms)
✖ finding 2: changes observation drops freshness while a mutation holds the network queue (6.369459ms)
✖ finding 3: orphan import retires foreign receipts and disables unknown predictions (2.615416ms)
ℹ tests 6
ℹ suites 0
ℹ pass 0
ℹ fail 6
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 225.4835
```

Finding 1 returned A after the failed B schema fetch and offline reopen.
Finding 2 returned or notified A after B acquisition, and marked A fresh
while `/changes` had identified B behind a held mutation. Finding 3 imported
all three orphan entries, including both known-A receipts, into B.

The final run's corresponding test lines (plus the expanded positive cases):

```sh
node --test packages/snapback4/test/store-reset-review.test.mjs packages/snapback4/test/store-reset-idb.test.mjs
```

```text
✔ IndexedDB model: reset termination before-commit preserves one complete transaction (197.28875ms)
✔ IndexedDB model: reset termination after-commit preserves one complete transaction (10.034709ms)
✔ finding 1: failed same-generation backend adoption survives retry and offline reopen (194.889709ms)
✔ finding 2: delayed server answer cannot escape its incarnation (5.278375ms)
✔ finding 2: delayed horizon answer cannot escape its incarnation (18.92675ms)
✔ finding 2: delayed watch answer cannot escape its incarnation (5.565167ms)
✔ finding 2: changes observation drops freshness while a mutation holds the network queue (10.041708ms)
✔ finding 3: orphan import retires foreign receipts and disables unknown predictions (4.043375ms)
✔ finding 2: a delayed device read is retried before returning (3.846459ms)
✔ orphan provenance survives an unidentified destination and resolves on sync (4.463042ms)
✔ same-store orphan adoption preserves receipts, order and row IDs without predictions (2.7825ms)
✔ replacement receipts use ordinary transport without replaying known writes (6.990541ms)
✔ replacement receipts use exit transport without replaying known writes (4.028792ms)
✔ finding 2: a rerun started by replacement observation cannot publish the old partition (7.971917ms)
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 325.157333
```

Finding 4's initial base command and result:

```sh
cargo test -p snapback4-device --test native finding_4 -- --nocapture
```

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.04s
```

Same command, green:

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.06s
```

The two extra boundaries, red then green on the intermediate work:

```sh
node --test --test-name-pattern='rerun started' packages/snapback4/test/store-reset-review.test.mjs
```

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ cancelled 0

```

```sh
cargo test -p snapback4-device --test native finding_1 -- --nocapture
```

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 6 filtered out; finished in 0.02s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 6 filtered out; finished in 0.02s

```

Final combined native findings:

```sh
cargo test -p snapback4-device --test native finding_ -- --nocapture
```

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.07s
```

### Other targeted checks

```sh
cargo test -p snapback4-device --test device store_reset -- --nocapture
```

```text
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 73 filtered out; finished in 0.29s
```

```sh
cargo test -p snapback4-device --test device --test native --test native_reads --test retained_history --test adoption -- --nocapture
```

```text
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 81 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 48.56s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.21s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.38s
```

```sh
node --test packages/snapback4/test/store-reset.test.mjs packages/snapback4/test/store-reset-review.test.mjs packages/snapback4/test/store-reset-idb.test.mjs packages/snapback4/test/web-durability.test.mjs packages/snapback4/test/web-navigation.test.mjs packages/snapback4/test/release-activation.test.mjs
```

```text
ℹ tests 46
ℹ pass 46
ℹ fail 0
ℹ cancelled 0
```

```sh
node --test packages/snapback4/test/client-lifecycle.test.mjs packages/snapback4/test/session-security.test.mjs packages/snapback4/test/store-reset-review.test.mjs packages/snapback4/test/store-reset-idb.test.mjs
```

```text
ℹ tests 66
ℹ pass 66
ℹ fail 0
ℹ cancelled 0
```

```sh
cargo test -p snapback4-lang --test guide -- --nocapture
```

```text
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

```sh
node --test packages/snapback4/test/react.test.mjs
```

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
```

These affected runs preceded the final full build in a few cases; the final
blocking script below includes the completed changes. Intermediate expanded
checks exposed two assertion mistakes: offline horizon reads correctly
returned B's local rows rather than its remembered server scalar, and the
initial constant-read watch barrier expected a row array. The assertions
were corrected; no product failure was hidden by those corrections.

### Coverage and measurements

- Two stores execute the eight `store_reset` scenarios. Replacement during
  A's paged snapshot and during catch-up rejects delayed A pages and leaves
  **0 A rows** after B acquisition. Backend adoption is checked across reopen
  and stale adoption attempts, with successful B acquisition afterwards.
- The final native race captures **10**, advances to **12**, rejects delayed
  **11**, and keeps **50 retained rows**. A current request from **12** whose
  reply is **9** still resets. Watermark controls exercise **2,147,483,647**,
  **4,294,967,296**, and **9,007,199,254,740,991**; read clocks are **100,000**
  then **-100,000**. Same-store program adoption and release activation /
  rollback preserve the store ID.
- First identification of a legacy acquired device deliberately keeps **0**
  of its **50** already-left rows. LLP 3000.007 §18.2, the README and the sync
  card now make that otherwise-unrecoverable migration loss explicit.
- Orphan import retires **2 known foreign receipts** and retains **1 unknown
  entry** with unchanged row IDs and **0 predicted images**. Ordinary and
  exit replacement sends each issue **0 known-write POSTs** and **1 unknown-
  write POST**. Real-server reset/navigation tests also cover deduplication.
- The Node IndexedDB model exercises **2 termination sides** of commit,
  over **5 store kinds** (rows, metadata, outbox, bases and stages). It uses
  `indexedDbPersistence()` and a modeled IDB transaction; a new wasm device
  loses runtime state between checks. It covers aborted reset/adoption saves
  and a committed reset whose caller loses the reply. This is not an actual
  browser/process-termination or physical-power-loss qualification.
- Final wasm build: **1,670,724 B raw**, **464,114 B gzip**. Largest changed
  source file: **1,262 lines**. No meter ceiling, value serialization or
  existing corpus case changed.

### Diagnostic text

Finding 4, before (and incorrectly dropping watermark 12 to 0):

```text
E_GENERATION: the backend store was replaced; reacquire its partition
```

Finding 4, after (keeping watermark 12 and history):

```text
E_GENERATION: another owner advanced acquisition during sync; retry sync
```

The first three base failures returned stale answers or imported receipts,
not a diagnostic. The durable-adoption/read guards now say, verbatim:

```text
E_GENERATION: the backend store requires backend adoption before acquisition
E_GENERATION: the backend adoption capture is obsolete; retry sync
E_PREDICT: this store's backend has not been adopted; reconnect to acquire it
E_PREDICT: this owner's backend is obsolete; reconnect to adopt the current backend
```

These use existing `guide::CODES` entries; no new code or card name was
introduced. The public offline fallback still says `E_OFFLINE`.

### Scope and limits

All requested findings and the Node-modelable missing cases were handled.
Actual Chromium termination remains unqualified: React's browser launch
exits with SIGABRT in this sandbox, including the standalone retry. This
matches the user-supplied environment artifact. I did not independently run
a clean-base browser battery, so I make no separately verified pre-existing-
failure claim for it.

The minimal shared-file extension is `snapback4-core/src/store/activation.rs`:
eight lines expose installation with transaction-scoped metadata guards.
`DeviceStore`, its two implementations and the native-read test wrapper
support that path. Existing lifecycle/session mocks gained the new protocol
field, and the release-activation test gained store-identity assertions.
The README, guide and §18.2 note are the required published/design updates.
No other lane's listed file was identified by this brief, and no app,
contract, meter or corpus file was changed.

### Blocking suite

```sh
bash snapback4/scripts/test.sh
```

The first two completed runs, followed by the final run below, all report
failures rather than stopping at the first one. The first run totaled **759
Rust passes, 0 failures, 2 ignored**, and the second the same Rust counts.
Their script summaries are preserved here:

```text
-- ok: cargo build (8 s)
-- ok: wasm build (1 s)
-- ok: package typecheck (1 s)
-- ok: package build (1 s)
-- ok: chat app check (1 s)
-- ok: cargo test (312 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
-- ok: fixture wrapper tests (10 s)
ℹ tests 212
ℹ pass 211
ℹ fail 1
ℹ cancelled 0
-- FAIL: client tests (46 s)
== 1 failure(s) in 324 s
```

```text
-- ok: cargo build (3 s)
-- ok: wasm build (6 s)
-- ok: package typecheck (1 s)
-- ok: package build (0 s)
-- ok: chat app check (2 s)
-- ok: cargo test (244 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
-- ok: fixture wrapper tests (10 s)
ℹ tests 214
ℹ pass 213
ℹ fail 1
ℹ cancelled 0
-- FAIL: client tests (45 s)
== 1 failure(s) in 256 s
```

Final completed implementation: **760 Rust passes, 0 failures, 2 ignored**; **9/9** fixture tests; **214/215** client tests.

```text
-- ok: cargo build (6 s)
-- ok: wasm build (6 s)
-- ok: package typecheck (0 s)
-- ok: package build (1 s)
-- ok: chat app check (1 s)
-- ok: cargo test (259 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
-- ok: fixture wrapper tests (8 s)
ℹ tests 215
ℹ pass 214
ℹ fail 1
ℹ cancelled 0
-- FAIL: client tests (42 s)
== 1 failure(s) in 273 s
```

The one failed check is Chromium launch in `react.test.mjs` (SIGABRT),
reproduced alone above. No lifecycle host test failed in these runs. No
client timeout wave occurred, so the concurrency-2 retry was not needed.

```sh
./ref-check --verbose
git diff --check
```

```text
ref-check: ok — 480 LLP docs, 8890 refs in 22938 files, 0 errors, 0 unchecked
```

`git diff --check` produced no output (exit 0). The reference check was
repeated after the journal append. HEAD remains
`f69338c005af9fe6bc657af6287b22fd0934a3ed`; only the intended lane changes
are left in the working tree for the lead.

## 2026-09-14 — X1R2: immediate replacement detection and an explicit restore halt

Base: `3266842c10eac426755010a346dbff29b6f47583`. Read the other
family's review (`/Users/ccheever/projects/snapback-x1-review/grok.md`),
X1R1's journal entry, the fence rules and LLP 3000.007 §14/§18 before
implementation. All reproductions below ran with only test edits at that
starting HEAD, before production edits. No commit, push, tag, publication,
sub-agent, clone, remote execution, meter increase, value-model serialization
change or modification of an existing corpus case was made.

### Findings and implementation

1. **Reproduced.** Equal-head replacement held `/changes` until its long
   deadline, and both a wasm and a process `createLocalClient` republished
   A as fresh and complete after B listened. `/changes` now accepts optional
   `store_id` and answers immediately on mismatch; `/probe` adds identity
   and head, checked before reconnect restores local freshness or resumes
   its poll. A disconnected watch synchronously loses freshness. Matching
   store reconnects resume without a sync.
2. **Did not reproduce.** X1R1 already sets each watch to `{ loading: true }`
   and notifies synchronously before `observe_store`. The new barrier test
   reads `getSnapshot()` at that exact call boundary, then positively checks
   B is delivered. No reset-turn implementation change was needed.
3. **Reproduced.** A stopped backup restored at head 1 after the device had
   applied head 3 returned all three old rows with `complete: true`. The
   device now persists a restore refusal, preserving its watermark and
   outbox, and returns `E_STORE_RESTORE` from observation, application, reads
   and new sends. The client stops its sync retry loop; the refusal is
   reported by `sync_state` so an offline or online reopen keeps the halt.
   Backend adoption and a recovered same-ID head cannot silently reacquire.
   A fresh device/outbox can acquire the restored database. Request-capture
   checks still reject stale responses before they can infer restore.
4. **Covered.** Both live wasm and native/process clients fail at base on
   replacement with production waits (25 and 20 seconds). Both mid-paged
   snapshot tests pass at base: an outbound `after` request is held, B starts
   under `--fresh`, then B receives A's actual cursor and echoed identity.
   No pagination implementation change was justified. The real Expo/iOS
   host was not run; the native process harness requested by the brief was.

The published README, sync card, `guide::CODES`, and §18.2 note describe
the new wire fields and the coded restore halt. The only extra shared
file beyond the HTTP/device/client paths is `snapback4-core/src/error.rs`: two
match arms give the new refusal its `store` family and `sync` card. The
HTTP admission suite also updates its exact `/probe` body assertion for
the additive fields; its authentication assertions remain in place. No
other lane's listed file was identified by this brief. The public client
contract and all app callers remain valid; there is no changed source form.

### Red/green commands and exact summaries

Every Node/Bun command used:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
```

Cargo, Bun and targeted Node commands ran from `snapback4/`. The blocking
script and reference checker ran from the repository root. Frozen installs
were reused. Rebuild commands were `cargo build -p snapback4`,
`bash scripts/build-wasm.sh`, `bun run --cwd packages/snapback4 build`,
and `bun run --cwd packages/snapback4 typecheck`.

Harness corrections before the valid base run: the reset-turn test now
uses the fixture's scalar marker (the thread is a shaped result), and the
restore copies the whole stopped `.snapback4` directory, including SQLite
sidecars, instead of copying an uncheckpointed main file alone. Those setup
failures are not counted as reproductions. An intermediate green run's idle
sync assertion started during B's paged acquisition, because current server
fallback had already answered B; it now starts after B's long poll resumes.
That was a measurement-boundary correction, not an additional product fix.

A later boundary regression exposed an actual gap in the first repair:
a change poll witnessed head **5** below acquired head **10**, but the next
sync had already advanced back to **10**. Deferring the refusal to that sync
forgot the restore. This was red on the intermediate implementation, not a
second starting-HEAD claim. Both change polls and probes now persist their
lower-head evidence immediately through the capture-fenced device call;
the new regression is green. Reconnect's restore test reads the restored
head independently so it remains valid whether the probe or explicit sync
observes it first.

Items 1, 3 and 4 — valid base run (2 pass / 4 fail):

```sh
node --test packages/snapback4/test/store-reset-reconnect.test.mjs
```

```text
✖ R2 item 1: changes with a foreign identity returns before its production wait (3062.0795ms)
✖ R2 item 1/4: wasm reconnect at equal head never republishes A as fresh (wait=25) (2190.209916ms)
✖ R2 item 1/4: process reconnect at equal head never republishes A as fresh (wait=20) (2064.450042ms)
✔ R2 item 4: wasm replacement while a snapshot after request is in flight (59.556709ms)
✔ R2 item 4: process replacement while a snapshot after request is in flight (66.480292ms)
✖ R2 item 3: restoring the same store at a lower head halts reads and retries (1057.127333ms)
ℹ tests 6
ℹ suites 0
ℹ pass 2
ℹ fail 4
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8553.71575
```

Items 1, 3 and 4 — first green targeted run:

```sh
node --test packages/snapback4/test/store-reset-reconnect.test.mjs
```

```text
✔ R2 item 1: changes with a foreign identity returns before its production wait (1154.131459ms)
✔ R2 item 1/4: wasm reconnect at equal head never republishes A as fresh (wait=25) (4374.620708ms)
✔ R2 item 1/4: process reconnect at equal head never republishes A as fresh (wait=20) (4257.8095ms)
✔ R2 item 4: wasm replacement while a snapshot after request is in flight (93.141375ms)
✔ R2 item 4: process replacement while a snapshot after request is in flight (76.890125ms)
✔ R2 item 3: restoring the same store at a lower head halts reads and retries (1291.194458ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11287.326625
```

Item 2 — base already green; round 1 covers the finding:

```sh
node --test --test-name-pattern='R2 item 2' packages/snapback4/test/store-reset-review.test.mjs
```

```text
✔ R2 item 2: getSnapshot is cleared and notified in the reset turn (158.134542ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 201.672084
```

Item 2 plus the existing round 1 / IndexedDB regressions, green:

```sh
node --test packages/snapback4/test/store-reset-review.test.mjs packages/snapback4/test/store-reset-idb.test.mjs
```

```text
✔ R2 item 2: getSnapshot is cleared and notified in the reset turn (174.321959ms)
ℹ tests 15
ℹ suites 0
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 279.998791
```

Item 3 — red on SQLite and memory at base:

```sh
cargo test -p snapback4-device --test device same_store_restore -- --nocapture
```

```text
test store_reset::same_store_restore_memory ... FAILED
test store_reset::same_store_restore_sqlite ... FAILED
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 81 filtered out; finished in 0.02s
```

Item 3 — green, including direct apply, observation, stale captures, reopen, adoption and sends, within the existing replacement suite:

```sh
cargo test -p snapback4-device --test device store_reset -- --nocapture
```

```text
test store_reset::same_store_restore_memory ... ok
test store_reset::same_store_restore_sqlite ... ok
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 73 filtered out; finished in 0.27s
```

Published guide/compiler card verification:

```sh
cargo test -p snapback4-lang --test guide
```

```text
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

### Measurements and diagnostic texts

Measured in the final targeted run:

- Foreign-identity `/changes`, `wait=25`: **4 ms** (base: its **3,000 ms**
  abort deadline expired before the **25 s** response).
- Equal-head replacement, wasm **25 s** wait: **2,155 ms**; native/process
  **20 s** wait: **2,160 ms**, including reconnect scheduling and the
  acquisition-to-idle-poll measurement boundary. Each observed **0** old
  fresh+complete snapshots, **0** extra same-store restart syncs and **0**
  idle syncs after replacement acquisition. These are shared-host samples,
  not latency guarantees.
- Paging on both client hosts: **2 of 5** A rows staged before the held
  continuation; B final rows **3**, A final rows **0**.
- Restore: backend head **3 → 1**, device watermark remains **3**; retry
  syncs **0**; a fresh device acquires **1** row. The two-store core scenario
  also accepts equal/advancing heads **3 → 4**, preserves watermark **4**
  through the halt, and refuses on **2** entry points on **2** stores.
- Final wasm: **1,672,588 B raw**, **465,012 B gzip**, versus base
  **1,670,724 B raw**, **464,114 B gzip** (**+1,864 B**, **+898 B**).
- Largest changed code file: `serve.rs`, **1,297 lines**.

Before, the real restore read returned old data and no diagnostic. The
base native observation returned this success envelope:

```json
{"ok":{"backend_required":false,"reset":false,"retired":{},"send_revision":1}}
```

After, the exact read/observation/application refusal message is:

```text
E_STORE_RESTORE: the backend store was restored or shrank below this device's watermark; stop this client and use a fresh device store and outbox
```

Its code is `E_STORE_RESTORE`, family `store`, guide `sync`, non-retryable.
The long-poll gap also produced no diagnostic before; it returned too late.
Item 2 and pagination needed no changed diagnostic.

Recovered-head regression — intermediate red:

```sh
node --test --test-name-pattern='a lower change head' packages/snapback4/test/store-reset-review.test.mjs
```

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 236.134792
```

Recovered-head regression — green:

```sh
node --test --test-name-pattern='a lower change head' packages/snapback4/test/store-reset-review.test.mjs
```

```text
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 247.530292
```

Combined replacement, review and persistence regressions after that repair:

```sh
node --test packages/snapback4/test/store-reset-reconnect.test.mjs packages/snapback4/test/store-reset-review.test.mjs packages/snapback4/test/store-reset-idb.test.mjs
```

```text
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10339.642334
```

The HTTP assertion updated for the additive probe fields, rerun alone:

```sh
node --test packages/snapback4/test/http-bounds.test.mjs
```

```text
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2350.008041
```

The sandbox Chromium failure, rerun alone:

```sh
node --test packages/snapback4/test/react.test.mjs
```

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 375.577584
```

The React retry fails during Chromium launch with `signal=SIGABRT`, matching
the environment artifact supplied in the brief. It does not reach the app
assertions. I did not verify a clean-base browser run, and make no separately
verified pre-existing-failure claim. The lead must rerun outside the sandbox.

### Blocking suite

All three invocations ran the full reporting suite. The first found the
old exact `/probe` assertion (one failed subtest and its parent, fixed above)
plus Chromium; the second leaves Chromium alone. The third includes the
recovered-head regression and its fix.

```sh
bash snapback4/scripts/test.sh
```

First run — **762 Rust passes, 0 failures, 2 ignored**:

```text
-- ok: cargo build (1 s)
-- ok: wasm build (2 s)
-- ok: package typecheck (0 s)
-- ok: package build (1 s)
-- ok: chat app check (1 s)
-- ok: cargo test (248 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (0 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
-- ok: fixture wrapper tests (8 s)
ℹ tests 222
ℹ pass 219
ℹ fail 3
ℹ cancelled 0
-- FAIL: client tests (44 s)
== 1 failure(s) in 253 s
```

Second run — **762 Rust passes, 0 failures, 2 ignored**:

```text
-- ok: cargo build (0 s)
-- ok: wasm build (2 s)
-- ok: package typecheck (0 s)
-- ok: package build (1 s)
-- ok: chat app check (1 s)
-- ok: cargo test (188 s)
-- ok: chat app typecheck (0 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
-- ok: fixture wrapper tests (6 s)
ℹ tests 222
ℹ pass 221
ℹ fail 1
ℹ cancelled 0
-- FAIL: client tests (41 s)
== 1 failure(s) in 192 s
```

Final run — **762 Rust passes, 0 failures, 2 ignored**; **9/9** fixture tests; **222/223** client tests:

## 2026-09-14 — W2R2e: a stalled exit response cannot wedge flushing or close

Implemented re-check finding A and retained finding 4's submission ordering
at base `bca8bfe70d320c1d466c6a700493465662b2205e` (LLP 3000.007 §20.4).
The exit transport now bounds its wait to **1,000 ms**, then lets ordinary
flushing retry the **same durable head, mutation id, arguments and new ids**.
Only ordinary settlement advances the queue. An exit response arriving late
never settles a write itself. The still-outstanding keepalive keeps its
active slot and byte reservation until its body actually finishes, so more
page events cannot start another exit request or pretend its quota is free.
Closing aborts only the wait, not the keepalive delivery; the awakened flush
checks `closed` before reading the device queue. The README and writes card
state the recovery and close behavior. No client contract, code/note,
serialized form, meter ceiling or existing corpus case changed.

The regression uses fake page events with the real wasm device and HTTP
server. Its exit response supplies headers but leaves a ReadableStream body
open through recovery. Both outcomes are covered: the server never applied
the exit write, and it already applied it and answers the ordinary retry
with `replayed: true`. Each queues **2** writes, starts **1** exit request,
then sends **2** ordinary requests in submission order and leaves exactly
**2** server rows, **0** duplicates. The ordinary head retry is itself held
open to check that its successor cannot pass it and another exit cannot
start. Separate tests close the client with a stalled body and verify that
the transport wait releases immediately on the close signal without giving
that signal to fetch.

First ran the three client regressions before changing implementation:
`node --test --test-name-pattern='stalled exit' packages/snapback4/test/web-navigation.test.mjs`
reported `ℹ tests 3`, `ℹ pass 0`, `ℹ fail 3`. The first fixed run recovered
both writes but reported `ℹ tests 3`, `ℹ pass 2`, `ℹ fail 1`: the close
assertion allowed only 500 ms, while the existing offline follower can
already be sleeping for one second. That unrelated sleep is unchanged.
The final close assertion allows 1,500 ms, with a separate 100 ms transport
assertion proving immediate wait release. All four final regressions were
rerun against the exact base's `local.ts` and `local-exit.ts`, extracted
with `git show HEAD:<path>` and transpiled into the ignored package `dist/`
using the installed TypeScript. The current package was then rebuilt.

Commands below used
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`.
Cargo, Bun and package Node commands ran from `snapback4/`; the blocking
suite, witness and ref-check commands ran from the repository root.

Final regression command, base then fix:
`node --test --test-name-pattern='stalled exit' packages/snapback4/test/web-navigation.test.mjs`

```text
ℹ tests 4
ℹ pass 0
ℹ fail 4

## 2026-09-14 — W2R2w: witness receipt validation, process ownership and artifact preservation

Base: `bca8bfe70d320c1d466c6a700493465662b2205e`. Read GPT re-check
findings B, C and D, including the custom-serialization envelope probe,
LLP 3000.007 §20.10, and W1's lane and native end-to-end records. Every
execution regression here uses the fake simctl and the real dev backend;
there were **0 native simulator end-to-end runs** in this sandbox.

The driver now validates every complete row before advancing, including
failures later in the same batch, checks the witness envelope and milestone
order, and validates the full exported file after collection. Previously
observed rows cannot be replaced. After `done`, only app receipts in the
helper's `between-steps` state may follow. The helper serializes and parses
the app object before installing the protocol envelope, rejecting primitive,
array, null and reserved-key serialization results while accepting benign
`toJSON` and getters without evaluating them again.

The driver refuses an already running app before starting its backend,
records each launch's reported PID, checks the current app PID before
signaling that PID, and leaves replacement instances running. It never
terminates by bundle ID or launches with `--terminate-running-process`.
A persistent create-new marker reserves the segment's namespace, and the
manifest names it and all **9 output files**. Every output is covered by
preflight. Backend and launch logs append across restarts; readiness reads
only the new backend's stdout suffix, so an earlier announcement cannot
satisfy the restarted process's readiness check. The card, README, existing
witness code explanations and §20.10 document the changed behavior.

Measured fake-driver controls: **2 simultaneous runs, 1 owner and 1 refusal**;
**2 backend readiness announcements** retained (base: **1**); **3 launch
stderr groups** retained; **3 launched PIDs**, 7001, 7002 and
7003, and **3 matching terminations**, with **0 bundle-only terminations**.
The existing-instance control leaves PID 6999 alone; the replacement
control leaves PID 9999 alone. All **9 pre-existing output paths** retain
their exact bytes. The five invalid-receipt scenarios fail, while cold,
relaunch and harmless post-done app receipts pass.

### Red and green

Cargo and package commands ran from `snapback4/`. Every Node/Bun command
used `export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`.
`cargo test -p snapback4 --test witness` first ran before production edits:

```text
test result: FAILED. 9 passed; 4 failed; 0 ignored; 0 measured; 0 filtered out; finished in 13.69s
```

The strengthened, separately named regressions were then run against the
same base's driver and protocol restored with `git show`, with a test-only
adapter extracting the base's inline check-only artifact preflight for the
reservation race. That adapter is absent from the delivered code:

```text
test result: FAILED. 9 passed; 10 failed; 0 ignored; 0 measured; 0 filtered out; finished in 16.02s
```

The same command on the fixed implementation:

```text
test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 19.07s
```

`node --test packages/snapback4/test/witness.test.mjs`, before then after:

```text
ℹ tests 4
ℹ pass 3
ℹ fail 1

ℹ tests 4
ℹ pass 4
ℹ fail 0
```

The fixed run measured recovery **1,010 ms** (not applied) / **1,005 ms**
(already applied), client close **978 ms** including the follower sleep,
and the isolated immediate-close test **0.572833 ms** total. There were
**0** ordinary sends after close. These are shared-host wall times, not a
latency guarantee beyond the timeout's scheduled release.

`node --test packages/snapback4/test/web-navigation.test.mjs packages/snapback4/test/local-e2e.test.mjs packages/snapback4/test/client-lifecycle.test.mjs`

```text
ℹ tests 65
ℹ pass 65
ℹ fail 0
```

`cargo test -p snapback4-lang --test guide -- --nocapture`

```text
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
```

`bash snapback4/scripts/test.sh` — Rust totals **750 passed, 0 failed,
2 ignored**; all builds and typechecks passed. Verbatim group summaries:

```text
-- ok: cargo build (2 s)
-- ok: wasm build (2 s)
-- ok: package typecheck (0 s)
-- ok: package build (1 s)
-- ok: chat app check (1 s)
-- ok: cargo test (241 s)

-- ok: cargo test (279 s)
-- ok: chat app typecheck (1 s)

The first intermediate green Rust run also used
`cargo test -p snapback4 --test witness`:

```text
test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 16.20s
```

### Diagnostics

The base accepted the failed batch, late failure, reordered milestone,
late step change and malformed envelope as success; it also took over the
existing app. The fixed fixture's refusals include these exact texts:

```text
E_WITNESS_STEP: app step check:failed; see receipts and device log
E_WITNESS_STEP: app changed step after done: primed
E_WITNESS_STEP: app changed step after done: history:running
E_WITNESS_RECEIPT: receipt line 3 has an invalid witness envelope; expected witness: { at: ISO timestamp, step: name }
E_WITNESS_APP: dev.test is already running on dedicated; quit it before starting the witness
E_WITNESS_APP: dev.test on dedicated was replaced by PID 9999; leaving that instance running
E_WITNESS_RECEIPT: serialized receipt must be an object without the reserved witness key
```

No meter, value serialization, existing corpus case, native bridge, app
caller or other lane's client implementation changed. No commit, push, tag,
publication, sub-agent or remote machine was used. The lead's native rerun
remains necessary; fake process choreography does not measure native UI,
process or storage behavior. The useful lesson is that a milestone is not
a validated batch, a bundle identifier is not process ownership, and an
existence check is not an exclusive artifact reservation.


### Full verification

From the repository root, with the same Node 24 PATH:
`bash snapback4/scripts/test.sh`:

```text
-- ok: cargo build (2 s)
-- ok: wasm build (17 s)
-- ok: package typecheck (1 s)
-- ok: package build (0 s)
-- ok: chat app check (2 s)
-- ok: cargo test (352 s)
-- ok: chat app typecheck (0 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
-- ok: fixture wrapper tests (10 s)
ℹ tests 201
ℹ pass 200
ℹ fail 1
-- FAIL: client tests (44 s)
== 1 failure(s) in 285 s
```

The sole failure is Chromium `signal=SIGABRT` before the React page opens.
Isolated rerun: `node --test packages/snapback4/test/react.test.mjs`.
Verified independently against exact base
`bca8bfe70d320c1d466c6a700493465662b2205e`: archived its package, app and
witness sources into `/tmp/w2r2e-base`, linked installed dependencies, and
ran `node --test /tmp/w2r2e-base/snapback4/packages/snapback4/test/react.test.mjs`.
Both commands reproduced that launch failure and the same summary:

ℹ tests 198
ℹ pass 197
ℹ fail 1
-- FAIL: client tests (46 s)
== 1 failure(s) in 374 s
```

Summing the 54 Rust suite summaries gives **760 passed, 0 failed,
2 ignored**. All witness regressions pass in that full run. The client
failure is Chromium `signal=SIGABRT` in `react.test.mjs`, the sandbox
artifact explicitly named in this lane's brief. The isolated rerun from
`snapback4/`, `node --test packages/snapback4/test/react.test.mjs`, reproduces
it:

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

`node snapback4/witness/navigation.mjs` also exited **1** at Chromium launch
with `signal=SIGABRT`, before producing any witness JSON. The real-browser
witness remains for the lead outside the sandbox; the Node/wasm/HTTP tests
passed. No other requested implementation work remains, and no out-of-scope
file was changed. Preparatory `bash scripts/build-wasm.sh`,
`bun run --cwd packages/snapback4 build` and
`cargo build --workspace --quiet` all exited **0**; wasm measured
**1,651,366 B raw / 458,474 B gzip**. No install, commit, push, tag,
publication, sub-agent or remote machine was used. Changed code files are
at most **998** lines. Full logs are `/tmp/w2r2e-{red-final,green-final,targeted,guide,suite,react,react-base,witness,ref}.log`.

`./ref-check --verbose` passed after this entry was appended:

```text
ref-check: ok — 480 LLP docs, 8885 refs in 22933 files, 0 errors, 0 unchecked
```

`git diff --check` passed. The worktree contains only the six intended
source/test/documentation changes above; HEAD remains the base.

ℹ duration_ms 1158.33125
```

No lifecycle host test failed and no reduced-concurrency client rerun was
needed. I do not claim an independently verified pre-existing full-suite
failure at the base; the Chromium classification follows the author's
explicit environment ruling, and the lead reruns it outside the sandbox.
`./ref-check --verbose` from the root passes:

```text
ref-check: ok — 480 LLP docs, 8887 refs in 22927 files, 0 errors, 0 unchecked
```

`git diff --check` passes. Raw outputs are `/tmp/w2r2w-rust-red.log`,
`/tmp/w2r2w-rust-red-complete.log`, `/tmp/w2r2w-rust-final.log`,
`/tmp/w2r2w-js-red.log`, `/tmp/w2r2w-js-final.log`,
`/tmp/w2r2w-suite.log`, `/tmp/w2r2w-react-alone.log` and
`/tmp/w2r2w-ref-check.log`.

## 2026-09-14 — W2R2a: final-exists device misses need an absence proof

Base: `bca8bfe70d320c1d466c6a700493465662b2205e` (`sb4/w2-int`). Read
Grok's re-check finding 4 and section 2, lane F and W2R1u, and the governing
LLP 3000.007 §20.5, §8.7, §15/§17 and §18 rulings. The shared final-exists
check now reuses `upsert_absence_proven` on a device miss. A refusal needs
a key that proves readability and a fully held synced group without a
horizon; an unproved miss records an unknown fact, which the existing local
prediction mapping turns into `E_PREDICT`. Admission then queues the write
without a predicted row. A local hit still satisfies the postcondition.
The writes and prediction cards and package README state these conditions.
No new language form, diagnostic code or note was added.

Both ordinary insert and upsert were red at the base: Alice's private
`targets {name: "x"}` is missing from Bob's device, so both stores refused
`E_CONSTRAINT` while the server committed Bob's source row. The four named
store/write-form regressions now queue instead. Eight new tests include
those four regressions, direct `E_PREDICT` checks, viewer-pinned held-group
success and refusal controls, and unpinned local-hit controls. The known
miss still gives exactly the server's complete `E_CONSTRAINT` refusal;
the successful predicted row, after removing `pending`, equals the server
result and settled local row. Both stores exercise admission, reopen and
settlement. No meter ceiling, serialized value form or corpus case changed.

The existing observation helper records full query envelopes, all seven
meters, all table reads, admission, the outbox, reopen and settlement. Three
worlds have identical viewer holdings and seed sequence: no target, a hidden
nonmatching target, and a hidden matching target. Their complete device
observations match through reopen. The absent and hidden-nonmatching worlds
also match the complete server observation, including first/retry bodies,
receipt, meters, committed delta, effects, stream, snapshot and settlement.
The matching hidden witness legitimately changes the server's postcondition
outcome; that commit and the other worlds' refusals are each checked instead
of demanding identical authoritative outcomes. This is an in-process
observation, not an HTTP or browser-notification measurement.

### Red before, green after

Only the test files were changed for the final red run; production sources
were still exactly the base above. Cargo commands run from `snapback4/`.

```text
cargo test -p snapback4-device --test device upsert::final_exists -- --nocapture
test result: FAILED. 3 passed; 5 failed; 0 ignored; 0 measured; 73 filtered out; finished in 0.26s
cargo test -p snapback4-device --test device upsert::final_exists -- --nocapture
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 73 filtered out; finished in 0.32s
cargo test -p snapback4-device --test device -- --nocapture
test result: ok. 81 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 47.68s
cargo test -p snapback4-lang --test guide -- --nocapture
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
```

The blocking suite, from the repository root, with the pinned Node PATH:

```text
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
bash snapback4/scripts/test.sh
-- ok: cargo build (16 s)
-- ok: wasm build (31 s)
-- ok: package typecheck (1 s)
-- ok: package build (1 s)
-- ok: chat app check (1 s)
-- ok: cargo test (301 s)
-- ok: chat app typecheck (0 s)
-- ok: expo app typecheck (1 s)
-- ok: fixture wrapper tests (11 s)
-- FAIL: client tests (46 s)
== 1 failure(s) in 351 s
```

Rust's 54 summary lines total 758 passed, 0 failed, 2 ignored. Fixture and
client summaries, respectively:

```text
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ skipped 0
ℹ tests 197
ℹ pass 196
ℹ fail 1
ℹ skipped 0
```

The sole failure was `React hooks and reference-app lifetimes` in
`packages/snapback4/test/react.test.mjs`, Chromium `SIGABRT`. Rerun alone
from `snapback4/`, with the same pinned Node PATH:

```text
node --test packages/snapback4/test/react.test.mjs
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ skipped 0
ℹ duration_ms 477.062625
```

The isolated run also reports Chromium `SIGABRT`. This is the sandbox
artifact explicitly identified by the lane brief, not an independently
base-verified pre-existing-failure claim. No lifecycle or mass client timeout
occurred. The lead still needs the browser test outside the sandbox. Logs:
`/tmp/w2r2a-final-exists-red.log`, `/tmp/w2r2a-final-exists-green.log`,
`/tmp/w2r2a-device.log`, `/tmp/w2r2a-guide.log`, `/tmp/w2r2a-suite.log`,
`/tmp/w2r2a-react.log`, `/tmp/w2r2a-ref-check.log`.

Measurements: 4 false local refusals in the primary insert/upsert/store
reproduction become 0; each uncertain write goes from 0 queued entries to
1, with 0 predicted rows. Held successes still predict 1 source row. The
rebuilt wasm is 1,651,659 B raw and 458,591 B gzip; no size improvement is
claimed. The 5 changed/new code files are all below 1,500 lines (largest:
`engine/write.rs`, 628). No out-of-scope file was touched. Nothing was
committed, pushed, tagged or published.

Direct prediction's diagnostic fields for both write forms and stores:

```text
before code: E_CONSTRAINT
before message: inserting into sources requires a matching row in targets by the end of the mutation
after code: E_PREDICT
after message: E_PREDICT: site after insert: this device cannot establish targets by byName at key ["x"]; the probe key does not establish a fully held, readable group without a horizon
```

Admission consumes the latter as a queued unpredicted write. The server's
constraint diagnostic is unchanged. Lesson: whole-table sync metadata does
not prove that a private probe's key is absent; final postconditions need
the same viewer-specific absence proof as the insert arm itself.

Final root checks:

```text
./ref-check --verbose
ref-check: ok — 480 LLP docs, 8886 refs in 22934 files, 0 errors, 0 unchecked
git diff --check
```

`git diff --check` exits 0. The journal's base prefix is byte-identical,
with exactly this one dated entry appended. HEAD remains the named base;
the working tree contains only the 7 intended source, test and documentation
files listed above.

## 2026-09-14 — native end-to-end on the round-2 witness: no `kill` in the simulator runtime (lead)

The round-2 ownership fix (W2R2w) stopped its launched app with
`xcrun simctl spawn <udid> kill -TERM <pid>`. On a real simulator (iOS 26.5,
dedicated `sb4-e2e`, `expo run:ios --configuration Release` build) that fails:
"An error was encountered processing the command (domain=NSPOSIXErrorDomain,
code=2) … No such file or directory" — the runtime has no `kill`. The fake
`simctl` accepted it, so the tests could not see it. The driver now confirms
through `launchctl list` that the running instance is the PID it launched and
then calls `simctl terminate <udid> <bundle>`; a replaced instance is still
left running with `E_WITNESS_APP`. The fixture now fails `spawn kill` as the
runtime does and records the PID each terminate stops (witness tests 19 of 19).

## 2026-09-14 — wave 2 review round 3, settled by the lead (LLP 3000.007 §20.11)

GPT's third check of `e01cc8afa` confirmed A, C (and the `toJSON` envelope)
and D and left three Medium items; Grok's third check returned READY.
- An empty `receipt({})` after `done` wrote `{"witness":{"step":"between-steps"}}`
  and the driver rejected it because it required an application field.
  `between-steps` rows only come from `receipt()`, so any such row is accepted
  after `done` and any other step still fails (`protocol.rs` unit test).
- A device's final-exists coverage proof that exhausts the meter surfaced as a
  local `E_BOUND` refusal while the server commits. The proof's
  `RuntimeError::Bound` now means "not proven": the miss is unknown and the
  write queues. `a_final_exists_proof_that_exhausts_the_meter_queues_instead_of_refusing`
  (`rule_probes: 0`): red `E_BOUND` at `e01cc8afa`, green `E_PREDICT`.
- The window between the launched-PID check and `simctl terminate` is accepted
  and stated in §20.10 (no PID-targeted terminate in the simulator; dedicated
  simulator).


## 2026-09-14 — Expo target audit holds the first 0.2.5 candidate

The final artifact inventory found deployment-target warnings in the earlier
successful C-link logs: bundled SQLite targeted iOS/iOS Simulator 26.5 while
the podspec promises 16.4. Those original bytes remain unpublished. Inspection
of the pinned cc and rustc implementations established that both consume
`IPHONEOS_DEPLOYMENT_TARGET` for both Apple iOS targets. Astra added the explicit
16.4 setting to the existing XCFramework script and is rebuilding the slices
for object-metadata and real C/Swift consumer checks. The runtime source is
unchanged; already qualified and landed 0.2.14 CLI/browser inputs are unaffected.
The earlier successful-link receipt is retained with this qualification limit.


## 2026-09-14 — LLP 3000.008 selected increment delivered

The four-family RFC panel (Astra, Grok, Muse, Claude) and author pass selected
bounded residual work; Astra implemented it. Independent Sol/Grok code reviews
accepted the combined changes and the focused follow-ups. Replayed writes now
expose execution-only receipts, generation acquisition guards local knowledge,
browser persistence/runtime installation recovers from real injected failures,
stopped copies stay attached to their own store, and TCP_NODELAY repairs the
measured response-body delay. The bounded ranking counterexample passes.

The final 0.2.14 publication dry-run passed with zero failures in a 110 s
canonical suite; installed-consumer checks passed. Actual production Chrome
acquisition reached first useful data in 11.28 s and offline reopen in 675 ms
on the named 40×500×10 fixture, with exact identities and zero runtime fetches.
These timings are not a full-application/native/floor claim. The target-corrected
Expo 0.2.5 has 374 valid deployment records per slice and warning-free C/Swift
links at 16.4. Exact qualified client/platform 0.2.14 and Expo 0.2.5 tarballs
are published with matching registry hashes. Native apps need a rebuild.

The [run record](../benchmarks/runs/2026-09-14-snapback4-excellence/README.md)
retains the original failures, the held old Expo artifact, source/host/toolchain
identities and the remaining gaps. The short-lease worker fixture was a
workaround: subsequent §19 source gives dead children revocable sessions and
restores production test defaults. That stronger repair corrects the earlier
review diagnosis and belongs to 0.2.15, with its own evidence. Neither release
history nor test results are rewritten across those snapshots. The six RFC
working-set links are retired; the outcome standards and broader gaps remain.


## 2026-09-14 — membership feeds: repeated work measured inside the query

The fixed d81381a98 0.2.13 diagnostic completed 18,432 HTTP queries and
2,304 selected core wall/thread-CPU traces on Office ARM Linux. Both
independent calculations agree on every recorded scope component and the
shared case sums/means/shares. All full fixture/auth checks, the 73-test
CLI qualification, and owned-process cleanup passed; smoke is excluded.

A 20-row first feed performs 11/101/341 indexed scan collections and
120/180/660 row JSON decodes at 5/30/150 groups. The 150-group path
initializes every lane, then refills after each emitted row; its 170 message
scans repeat 170 live membership lookups. This is a concrete core-owner
target for reducing repeated work while preserving live authority, meters,
typed cursors and exact complete results.

The probes are deliberately detailed and expensive: 5,024 scope guards for
the 150-group first page. Their exact partitions do not establish ordinary
CPU shares or pure SQLite cost. The benchmark record retains instrumented
times, counts, raw objects and the full limits. No new latency gain is claimed.
Main advanced through 0.2.14 to 0.2.15 with page/cursor and socket changes;
any candidate needs qualification and ordinary A/B on its current inputs.
The existing membership-feed ticket is updated. No core implementation changed.


## 2026-09-15 UTC — Clique M7 exposes a maintained-identity adoption refusal

Astra's fresh 0.2.10 M7 session retained a schema-adoption refusal on an engine-generated poll tally ID and recovered by preserving vote rows while replacing the derived tally. A separate public-CLI reproduction on the unmodified published binary uses fresh stores and no server ports: canonical maintained IDs of 144 bytes accept an unrelated index addition; 145 and 159 bytes refuse store opening with E_INPUT. Restoring the prior schema reads identical source rows. Filed [the P2 adoption ticket](../issues/20260915-snapback4-maintained-identity-blocks-additive-schema-adoption.md) with the exact schemas, command receipts and source explanation. Current-main runtime applicability remains unverified; no product fix or author ruling is made here. All three independent grades are complete; M7 and the final LLP 3000.007 §10.3 record continue.


## 2026-09-14 — D1I: integrate 0.2.16 with filtered maintains

Integrated the in-progress merge into lane `sb4/w3-d1`, whose HEAD remains
`bfad501c53d80f274fc6c245e3962bc6b585155a`; incoming MERGE_HEAD is
`1a4a50da811c5c4a7544ae11c94ccda4f9f5fefd`. No commit, push, tag,
publication, sub-agent, clone, remote work or forbidden Git recovery command
was used. Orientation followed LLP 3000 §6–§7 and LLP 3000.007 §14, §18,
§19 and §20, especially the §20.9 built notes and §20.11 dispositions,
alongside both sides' journal records and published cards.

### Integration decisions

- `engine/read.rs` retains D1's evaluated-prefix/active-generation binding
  for direct table and maintain pages. Both merge implementations retain
  W2R1m's withholding on non-uniform reads, meter cuts and word-limit cuts.
  Merged pages keep their shared descriptor and can continue through an
  additive generation. The feeds card, README and §20.3 now explicitly say
  **merge cursor** when describing that cross-generation behavior.
- Direct prediction and queued replay retain D1's generation in Context
  and W2R1u's persisted held/left-group map in Predicting. The whole-image
  upsert insert proof, secondary unique/cap coverage, left-group withdrawal
  and W2R2a's final-exists unknown miss (including a proof meter cut) remain.
- Residency checks apply D1's subset-inheritance server classification
  before the other classes, and keep B2's maintain-specific online-only
  rewrite and mutation-reader consequence in N_MAINTAIN_SYNCED. D1's
  insert/delete/filter/key/value delta disclosure note remains intact.
- The parser keeps both the restricted maintain predicate module and B1's
  expected-token module. Maintain filters, computed keys, index properties,
  B2's explicit-sync refusal and the predicts modifier all remain. The
  language card runs D1's maintain examples and B1's enum-to-text helper;
  maintains and witness cards/codes are both registered. Both device test
  modules and both final guide tests survive. Main's other reviewed changes
  remain in the automatically merged files.
- The journal is ours in full, then main's full append after the common
  base: 620,214 + 116,459 bytes, independently compared byte-for-byte before
  this entry. The RFC retains all of §20.9 before §20.10 and §20.11.

No inherited test expectation was changed to suppress a failure. The added
`direct_and_merged_cursor_generation_contracts_are_distinct` test runs
three page forms across adoption: direct table and filtered calendar
maintain tokens refuse E_INPUT; the merged token returns the remaining row
completely, then ends. Runtime assertions passed before the documentation
fix; the valid regression failed because the feeds card's wording promised
cross-generation continuation for an unqualified cursor. It passed after
the wording correction. Initial fixture drafts needed a whole-table cap to
avoid N_NO_HORIZON and an assertion on the refusal's message rather than its
Display wrapper; those setup errors are not product regressions.

### Targeted commands and verbatim summaries

All Cargo and package Node commands below ran from `snapback4/`. Every
Node/Bun command used `export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`.
The repeated focused cursor command records the valid red before the prose
fix and green after it.

`cargo build` (`/tmp/d1i-build.log`):

```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 11.30s
```

`cargo test -p snapback4-lang --test guide --test maintains --test ergonomics --test residency_notes --no-fail-fast -- --nocapture` (`/tmp/d1i-lang-first.log`):

```text
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

`cargo test -p snapback4-core --test corpus --test rows --no-fail-fast -- --nocapture` (`/tmp/d1i-core.log`):

```text
corpus (Rust server only; no TypeScript/replica conformance claim): 211 passed, 83 skipped, 0 failed
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.17s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```

`cargo test -p snapback4-device --test device -- --nocapture` (`/tmp/d1i-device.log`):

```text
test result: ok. 104 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 35.97s
```

`cargo test -p snapback4-sim --test clique --test maintains --test maintains_review --test search_merge --no-fail-fast -- --nocapture` (`/tmp/d1i-sim.log`):

```text
test result: ok. 39 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 47.80s
test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 35.96s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.83s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
```

`cargo test -p snapback4-lang --test guide direct_and_merged_cursor_generation_contracts_are_distinct -- --nocapture` (`/tmp/d1i-cursor-doc-red.log`):

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 17 filtered out; finished in 0.01s
```

`cargo test -p snapback4-lang --test guide direct_and_merged_cursor_generation_contracts_are_distinct -- --nocapture` (`/tmp/d1i-cursor-doc-green.log`):

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 17 filtered out; finished in 0.01s
```

`cargo test -p snapback4-lang --test guide` (`/tmp/d1i-guide.log`):

```text
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

`cargo test -p snapback4 --test lifecycle dev_and_serve_report_signals_without_an_application_worker -- --nocapture` (`/tmp/d1i-lifecycle-alone.log`):

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out; finished in 3.53s
```

`node --test packages/snapback4/test/react.test.mjs` (`/tmp/d1i-react.log`):

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 320.083625
```

### Full blocking suite

Both runs used the exact root command below, with no source changes between
them. The shell command's output was retained in `/tmp/d1i-suite.log` and
`/tmp/d1i-suite-repeat.log`, respectively.

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
bash snapback4/scripts/test.sh
```

The first run totals 819 Rust passes, 1 failure and 4 ignored tests. The
failure was `dev_and_serve_report_signals_without_an_application_worker`:
startup stderr interrupted its expected standalone signal line. The exact
observed line was:

```text
snapback4 serve: http://127.0.0.1:SNAPBACK4_SIGNAL verb=serve generation=1 reason=SIGTERM signal=15
```

Its isolated command above passed all ten dev/serve signal checks. The
second complete run totals **820 Rust passes, 0 failures and 4 ignored**;
its lifecycle suite passes all 13 tests. Both runs pass every build,
typecheck and all 9 fixture tests. Client results are **203 passed / 1
failed / 0 cancelled** out of 204 in both runs. The only client failure is
Chromium SIGABRT before the React page launches; the isolated rerun above
reproduces it. No client-concurrency rerun was needed: there were no mass
timeouts. No change was made to the lifecycle or React tests.

These are same-source reruns, not an exact-base reproduction. No failure
is claimed pre-existing at HEAD. Chromium is classified by the brief's
explicit environment ruling; its outside-sandbox execution remains the
lead's acceptance work. The signal-log failure is recorded as intermittent
and passed both alone and in the final complete suite.

First full run, verbatim summaries:

```text
-- ok: cargo build (4 s)
wasm 1712867 B raw, 476145 B gzip
-- ok: wasm build (12 s)
-- ok: package typecheck (1 s)
-- ok: package build (0 s)
-- ok: chat app check (1 s)
test result: ok. 33 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.05s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.40s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: FAILED. 12 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.68s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.32s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 15.17s
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.16s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.14s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 104 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 33.37s
test result: ok. 90 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 10.46s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.57s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.31s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.23s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 41.70s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.58s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.07s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 39 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 28.69s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.68s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 43 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.45s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.72s
test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 33.21s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.54s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 7 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 3.79s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.92s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.13s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
-- FAIL: cargo test (292 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 8803.824208
-- ok: fixture wrapper tests (10 s)
ℹ tests 204
ℹ pass 203
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 43402.29875
-- FAIL: client tests (43 s)
== 2 failure(s) in 311 s
```

Final full run, verbatim summaries:

```text
-- ok: cargo build (0 s)
wasm 1712867 B raw, 476145 B gzip
-- ok: wasm build (1 s)
-- ok: package typecheck (1 s)
-- ok: package build (0 s)
-- ok: chat app check (1 s)
test result: ok. 33 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.06s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.31s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.41s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.45s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.34s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 14.94s
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.40s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.08s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 104 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 33.30s
test result: ok. 90 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 10.58s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.38s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.35s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.63s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 41.97s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.59s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.20s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 39 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 28.76s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.74s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 43 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.55s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.73s
test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 32.72s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.79s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 7 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 3.69s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.95s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.91s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
-- ok: cargo test (217 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (0 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
-- ok: fixture wrapper tests (8 s)
ℹ tests 223
ℹ pass 222
ℹ fail 1
ℹ cancelled 0
-- FAIL: client tests (43 s)
== 1 failure(s) in 247 s
```

Only Chromium launch remains red. No lifecycle host timeout or client
timeout wave occurred in these runs, so no concurrency-2 retry was needed.
Every new round 2 test passed in the final suite. No requested implementation
remains undone; the non-reproducing reset-turn and pagination findings have
regressions and no speculative implementation change.

```sh
./ref-check --verbose
git diff --check
```

The reference check immediately before this append reported:

```text
ref-check: ok — 480 LLP docs, 8893 refs in 22939 files, 0 errors, 0 unchecked
```

`git diff --check` produced no output (exit 0). Both checks are repeated
after this append. The starting HEAD is unchanged and all intended changes
are left uncommitted for the lead.

ℹ skipped 0
ℹ duration_ms 6035.391292
-- ok: fixture wrapper tests (6 s)
ℹ tests 204
ℹ pass 203
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 40193.903834
-- FAIL: client tests (40 s)
== 1 failure(s) in 220 s
```

### Scope, measurements and final state

Thirteen files were edited for integration: the eleven conflicted files,
plus `snapback4-lang/src/guide/feeds.md` and the package README for the
minimal cursor-contract clarification. The latter two are the only edits
outside the conflict list. All other incoming main changes remain as merged.
No inherited test expectation was rewritten, no meter ceiling changed and
zero existing corpus cases changed. No additional diagnostic wording or
code was introduced; both sides' reviewed diagnostic texts are preserved.

Measurements: 11 of 11 content conflicts resolved; 0 remaining markers;
9 edited Rust files, maximum 1,457 lines by the cap runner's convention,
0 above 1,500. The wasm device is 1,712,867 bytes raw / 476,145 bytes gzip
in both full runs. Full-suite wall times are 311 s and 220 s. No new scale
benchmark was commissioned or claimed by this integration brief.

The root `./ref-check --verbose`, with Node 24 on PATH, passed before this
append:

```text
ref-check: ok — 480 LLP docs, 8903 refs in 22957 files, 0 errors, 0 unchecked
```

`git diff --check` passed. Final reference validation runs after this entry
and is reported to the lead. All 620,214 ours bytes and 116,459 incoming
append bytes were verified unchanged immediately before appending this
one dated entry.

**Index handoff:** the file contents are resolved, but the sandbox forbids
creating the parent checkout's worktree index lock. `git add` returned:

```text
fatal: Unable to create '/Users/ccheever/projects/snapback/.git/worktrees/snapback-w3-D1/index.lock': Operation not permitted
```

Therefore Git still lists the eleven paths as unmerged even though their
contents contain no markers. The lead must stage the thirteen integration
files and commit the merge. The failed staging attempt changed no index
state; no commit or merge-abort was attempted. Nothing else in the brief
remains unfinished except this sandbox-owned index operation and Chromium
verification outside the sandbox.

## 2026-09-15 — scan preparation A/B rejects this candidate

The fixed-source experiment on d0ea081923 (0.2.15) is complete. An ignored
core candidate reuses two pure schema/IR analyses within one plain lazy
merge, keeping every live verdict, expiry, dependency, meter and page/cursor
operation fresh. Its corrected test fixture passed 318 selected Rust test
executions; the earlier test-compile failure remains preserved. All six
ordinary HTTP runs passed 117,000 timed case calls, 7,020 excluded warmups,
162 untimed complete walks / 33,510 pages and the complete fixture, auth,
leave/regrant and owned-process checks. Both frozen calculators passed
unchanged and their values reconcile.

This version is not recommended for adoption. The 150-group rotating feed
at eight clients moves 19.176 → 24.454 ms p50 and 36.245 → 55.225 ms p95;
throughput falls 375.8 → 282.9 requests/s. It loses elapsed/rate in every
pair, as does the 150-group next page. Smaller concurrent feeds improve,
and point/thread controls vary; the result does not identify a cause or
establish a uniform regression. After-workload RSS medians fall 848 KiB,
but two of three paired RSS observations rise. The benchmark record and
six raw-preserving ledger entries retain every loss and the measurement
limits. The next investigation must address the larger repeated scan and
materialization costs while preserving the live authority contract. Core
implementation remains with its owner; no candidate runtime is landed.

Main reached 0.2.16 before this evidence landing, with changes to core
read/rule/admission/schema and host behavior at integration parent
1a4a50da8. This fixed d0ea batch does not qualify that newer runtime or its
performance; the next experiment must qualify its own source.

## 2026-09-14 — X1R3: committed heads and native owner bindings

Base: `ebb9ab3ded7aaea2c50df48646288e8c09207500`. Read findings 5 and 6
of `/Users/ccheever/projects/snapback-x1-review/recheck-gpt.out.md`, the
X1/X1R1/X1R2 entries, the Snapback 4 fence and LLP 3000.007 §14/§18.2.
Both findings reproduced with test-only changes before implementation.
No commit, push, tag, publication, sub-agent, clone, remote work, ceiling
increase or value-model serialization change was made. No corpus case changed.

### Findings and implementation

1. **Finding 5 reproduced.** A populated maintain adoption committed head
   **4**, but the next idle `/changes` reply said **3**. Both the wasm and
   process clients persisted `E_STORE_RESTORE` on that healthy store.
   `/changes` now reads the committed head, store identity and changed
   tables in one read transaction. The wake counter is never its answer;
   production counter updates are monotonic and source adoption refreshes
   it after a maintain rebuild. A notification still releases held polls,
   including the session-liveness recheck, without asserting that the head
   changed. Reporting the actual head also requires covering the bounded
   commit page: beyond **500** commits the notification invalidates every
   current table, rather than skipping later invalidations.
2. **Finding 5 client boundary reproduced.** Injecting a lower notification
   against an unchanged store persisted the same halt. A lower poll or probe
   now invalidates freshness and requests sync confirmation. Only a matching
   authenticated snapshot/stream reply below the captured acquisition can
   persist the restore refusal. Non-success replies without a denial and
   replies from an obsolete credential revision cannot establish it. The
   old round-2 test requiring notification-only persistence was updated to
   the accepted round-3 policy. The real stopped-backup restore still halts,
   preserves its watermark, refuses offline reopen and stops retries.
3. **Finding 6 reproduced.** Two SQLite owners loaded A's native module;
   owner 1 adopted store B with identical schema, Quarry and generation,
   installed different native bytes, and acquired B. Owner 2 still returned
   A's `weight` field with `complete: true`. Each owner now remembers its
   adopted store ID and checks it, the backend fingerprint and the loaded
   native digest against durable metadata before reads, acquisition or
   prediction (including replay paths). Adoption clears an obsolete local
   module; installation checks the adopted store before writing bytes.
   Owner 2 refuses the existing obsolete-owner `E_PREDICT`, then returns B's
   `Weight` field after adoption and reload. Controls cover unchanged
   adoption, a module-only change, and another incarnation with identical
   module bytes. Existing native offline-reopen tests remain green.

The server race test uses two committed writes and channels to deliver the
first wake after the second. It deliberately leaves the counter at **1**
while the store is at **2**; the old wire reports **1**, the fixed wire **2**.
A separate HTTP test covers concurrent commits and replay of their older
receipt. That receipt retry bypasses notification assignment; it is not the
race witness. The native module variant changes only the fixture's returned
field name in its in-memory wasm bytes; it does not edit the fixture.

### Commands and red/green evidence

Cargo and Bun commands below ran from `snapback4/`. Every Node/Bun invocation
used `export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH` first.
The initial red runs used the base implementation. For the additional server
barrier tests and revised round-2 client test, all six changed implementation
files were temporarily restored verbatim from the same base with `git show`,
then restored from saved bytes in a `finally` block; no index or branch was
changed. The package JavaScript was rebuilt during that baseline check.

`cargo test -p snapback4-device --test native_reads finding_6 -- --nocapture`

Before:

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 7 filtered out; finished in 1.31s
```

After:

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 1.27s
```

`node --test --test-concurrency=1 --test-name-pattern='R3 finding 5' packages/snapback4/test/store-reset-reconnect.test.mjs`

Before (the five new negative witnesses fail; the concurrent/replayed receipt
control passes):

```text
ℹ tests 6
ℹ suites 0
ℹ pass 1
ℹ fail 5
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6326.242958
```

`cargo test -p snapback4 --bin snapback4 review_changes -- --nocapture`

Before (reordered wakes and the actual head beyond the commit page):

```text
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 33 filtered out; finished in 0.04s
```

`node --test --test-name-pattern='R3 finding 5' packages/snapback4/test/store-reset-review.test.mjs`

Before (the updated confirmation policy):

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 200.755416
```

`cargo test -p snapback4-device --test native_reads --test native --test device`

After, including both device stores and the additional native controls:

```text
test result: ok. 114 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 34.60s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.43s
```

`cargo test -p snapback4 --bin snapback4`

After, including both server regressions and wake/session checks:

```text
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.06s
```

`node --test --test-concurrency=1 packages/snapback4/test/store-reset-reconnect.test.mjs packages/snapback4/test/store-reset-review.test.mjs`

After, including the true restore and the prior review regressions:

```text
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 18618.515833
```

### Measurements and diagnostic texts

- Populated maintain: committed/acquired head **4**; idle head **3 → 4**;
  healthy client restore refusals **1 → 0** on each of **2** client hosts.
- Transient lower notification: **0** against acquired head **3**; sync
  confirms **3**, with **0** persisted restore refusals on both hosts.
- Reordered wake witness: **2** commits, counter **1**, reply **1 → 2**.
- Bounded invalidation: **501** commits, page bound **500**; actual head
  **500 → 501**, invalidations include both tables. The final one-commit
  request names only the table that changed.
- True restore: same ID, heads **3 → 1**; preserved device watermark **3**,
  retry syncs **0**, fresh-device rows **1**, offline reopen still refused.
- Native ownership: **2** owners, **2** module digests, **3** store identities;
  **0** stale native executions after the refusal guard. Same-generation
  re-adoption and reload positively return B's computation.
- Changed code files are all below **1,500** lines; the largest is
  `crates/snapback4/src/serve.rs` at **1,305** lines.

Healthy maintain acquisition before emitted this client diagnostic; after it
returns the three acquired rows fresh with no denial:

```text
E_STORE_RESTORE: the backend store was restored or shrank below this device's watermark; stop this client and use a fresh device store and outbox
```

The true restore still emits that exact text. The obsolete native owner
previously emitted no refusal and returned A's result; afterward it emits the
existing diagnostic, unchanged:

```text
E_PREDICT: this owner's backend is obsolete; reconnect to adopt the current backend
```

No new diagnostic or note code was introduced. The README, sync card and
§18.2 note describe the revised confirmation policy and native binding.
A restore that advances beyond the acquired watermark before sync confirms
it is not detected by this sequence check; the stopped-backup procedure still
requires a fresh device and outbox.

### Scope and full-suite qualification

The only additional source file outside the named implementation paths is
`crates/snapback4/src/serve_tests.rs`: three lines include the new regression
module under `crates/snapback4/tests/serve_changes/`, reusing its existing
private HTTP host fixture. The core engine needed no edit. All requested
implementation and regression work is present; no performance benchmark was
requested beyond the concrete sequence/owner measurements above.

The first `bash snapback4/scripts/test.sh` run found two wake-only server tests
and the old notification-only restore expectation. Those were corrected as
described above. Its summaries were:

```text
test result: FAILED. 31 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.59s
-- FAIL: cargo test (305 s)
ℹ tests 236
ℹ pass 234
ℹ fail 2
-- FAIL: client tests (45 s)
== 2 failure(s) in 310 s
```

The other client failure was Chromium's sandbox launch, reproduced alone at
base `ebb9ab3ded7aaea2c50df48646288e8c09207500` with restored implementation
sources and rebuilt JavaScript. It aborts before application execution:

`node --test packages/snapback4/test/react.test.mjs`

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 378.550917
<process did exit: exitCode=null, signal=SIGABRT>
```

Final rerun (repository root, after the same Node 24 PATH export):

`bash snapback4/scripts/test.sh`

```text
-- ok: cargo build (2 s)
-- ok: wasm build (7 s)
-- ok: package typecheck (0 s)
-- ok: package build (1 s)
-- ok: chat app check (2 s)
-- ok: cargo test (270 s)
-- ok: chat app typecheck (0 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7644.159583
-- ok: fixture wrapper tests (7 s)
ℹ tests 236
ℹ suites 0
ℹ pass 235
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 44215.768167
-- FAIL: client tests (44 s)
== 1 failure(s) in 282 s
```

Across the final Rust result lines: **835 passed, 0 failed, 4 ignored**.
The sole final client failure is the same Chromium launch `SIGABRT` verified
at the base above; no lifecycle timeout or other client failure occurred.
The full blocking suite cannot be reported green inside this sandbox. The
lead must run the browser test outside it; no additional implementation work
is left from findings 5 and 6.

Final matching green for the server's two deterministic red witnesses:

`cargo test -p snapback4 --bin snapback4 review_changes -- --nocapture`

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 33 filtered out; finished in 0.03s
```

Additional isolated targeted runs (before the combined 26-test run above):

`node --test --test-concurrency=1 packages/snapback4/test/store-reset-reconnect.test.mjs`

```text
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 16467.874417
```

`node --test --test-concurrency=1 packages/snapback4/test/store-reset-review.test.mjs`

```text
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2267.338083
```

Repository-root `./ref-check --verbose`:

```text
ref-check: ok — 480 LLP docs, 8911 refs in 22964 files, 0 errors, 0 unchecked
```

`git diff --check` exits **0**. Only the intended source, tests, published
text, §18.2 note and this one appended journal entry are changed. No generated
artifact is included. The work is left uncommitted for the lead.

## 2026-09-15 — X1 confirmation: a restore refilled by later writes still halts (lead)

GPT's confirmation of X1R3 (`4e986d5aa`) accepted findings 5 and 6 and found
that X1R3's client relaxation let a witnessed restore escape: a same-identity
poll head 5 below acquisition 10, then writers creating commits 6–10 before
sync, and `/sync` from 10 returns an empty page, so the old partition read
fresh again. With finding 5's repair both `/probe` and `/changes` report the
committed head, so the strict rule is safe again: `witnessRestore` in
`local.ts` sends a synthetic same-identity page (captured acquisition and send
revision) through `observe_store`, which persists `E_STORE_RESTORE` under the
existing capture guards. `R4: a same-identity /changes head below acquisition
persists the restore halt even when writes refill the head` was red
(`restore_refusal` undefined) and is green; the process/wasm reconnect tests
now expect the halt; the real-server maintain-adoption regression stays
healthy (store-reset tests 30 of 30). The synthetic page first failed with
`E_INPUT: missing field snapshot`, found by calling `observe_store` directly.


## 2026-09-15 UTC — the relaxed Quarry three-model cell is recorded

The published 0.2.10 / Expo 0.2.3 packet ran from September 14 11:15:05 to
September 15 02:43:55 UTC: 55,730 elapsed seconds, with all twelve actual phase
ends retained. Eleven exits are zero; the continuous Muse builder's completed
CLI tail was interrupted and remains exit 130. Its later phases used only the
qualified exact-builder exception. The original serial shell was taken over,
without a fabricated final marker or rewritten lifecycle. The [record](../benchmarks/runs/2026-09-14-snapback4-clique-0.2.10/README.md)
contains reports, correction records, source and receipt custody, holistic
scores, independent grades and detailed deviations.

Received holistic scores are Astra 82, Grok 63 and Muse 82 against 84/70/80
on 0.2.6; the separate 0.2.9 Astra calibration was 85. Independent 119-ID
grades are 99/2/18, 71/30/18 and 98/3/18 (pass/fail/not-run). Different
completion coverage, native classifications, source access and grading/scale
methods prevent a magnitude or causal claim. All three grades finished without
continuation. Fresh M7 sessions returned green in 2,870.258 / 1,667.198 /
895.247 seconds, with explicit snapshot, regression and migration limits;
these are builder results and do not rewrite the earlier independent grades.
Astra's count uses a backfilled contribution plus maintained sum, Grok's a
maintain in a fresh in-memory store, and Muse's a capped read-time scan with
no count backfill. The maintained-identity adoption defect remains separately
ticketed with published-pin boundary controls.

The ceremony result remains local and clean: three natural membership rules,
five probes each and zero Snapback-attributed loops on 0.2.10. Full-app reporting
still caused concrete authoring corrections. LLP 3000.007 §10.3 now recommends
SQL application reads on that remaining cost, with the attribution/protocol
interpretation explicit and the author's ruling pending. It makes no full-cell
loop-bar gate-pass claim, changes no Moves line, and commissions no SQL work.
The four §14 decisions already accepted by the author remain settled. Later
CU/§19/§20 releases receive no credit at this frozen pin.

Validation: all displayed comparison values match their received sources; all twelve lifecycle records, frozen instrument/templates/pins and selected copy hashes check. `python3 ./ref-check --verbose` passes (480 LLP documents, 8,889 refs, zero errors). The final archive carries scoped scan/disposition and cumulative-hash records. No product runtime or independent M7 grade was rerun.


## 2026-09-14 — W3b: Following guidance and prediction notes; source removal blocked

Base: `0c6b0c03cfea21d65eab728035ef87776a4144a3`. No commit, push, tag or publication.
This lane completed F2, the F3 diagnostic rewrite, and L1. It did **not**
complete the private source-removal recipe; its new acceptance regression
remains red, so this is not a ready-to-land complete W3b lane.

Orientation: [LLP 3000 §6–§7](../llp/3000-snapback4.explainer.md#6)
and [LLP 3000.007 §14](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#14),
[§18](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#18),
[§20.3](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#20.3)
and [§20.9](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#20.9)
govern the scope. The 0.2.16 calibration's F2/F3/L1 evidence was read in
`/Users/ccheever/projects/snapback-next-20260914/FRICTION-0.2.16.md` and
`/Users/ccheever/clique-sb4-20260915-astra-next/lanes/astra-snapback4/`:
`feed.q`, all three feed checks, `guide-feeds.txt`, `m8-check-second.txt`,
the insights/social source and run-log records 1789439126, 1789442332,
1789442353 and 1789442550. No external evidence file was modified.

Built: the language card's Following query reads one private inbox plus
at most 32 pulled-author broadcast lanes; it compiles without notes and
runs a positive example with both lanes and an excluded private row.
The maintain's `online only` comment now states its cost to mutations that
read it. `N_NOT_PREDICTABLE` groups repeated reads, writes and the upsert's
arms by their online-only table/maintain root, with sorted distinct sites
and rewrites; distinct non-table causes and horizon indexes are retained.
`N_NOW_SERVER` keeps its existing site-by-site contract. No execution class,
authority verdict, meter ceiling, value serialization or corpus case changed.
The fanout rewrite names the unpinned columns; when the schema has the
published follower vocabulary and a capped uniform follower prefix, it
prints that loop and the private key. README, cards and existing code
explanations carry the same guidance; no new diagnostic code was needed.

**What blocked F3.** A uniformly decided prefix can decide **false**.
With `.readerId = viewer`, an author looping through `follows[actorId]`
gets no rows from another reader's pinned inbox. The server regression
commits that loop with **0 rows written**, leaving the **1** private entry.
The intended reader sees **1** entry and the author **0**, both complete.
`delete feedEntries[readerId, eventId]` lowers through a rule-filtered point
read and returns `NOT_FOUND`, even with `.actorId = viewer` as its delete
rule. Blind deletion by a known primary id is a different existing path;
it does not supply an unknown copy's id or prove an absent copy.
The bound recipe's posts/follows/authors are online-only, so its source
writes already have `predicts: never`; removal must not promise more.
After promotion and follow-time backfill, an old pushed event may have
more than 50 copies, so cleanup must also cover the full 1,000-follower cap.

[LLP 3000.007 §8](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#8),
item 7(h), explicitly says “`delete` is out of scope.” The lane asked for
a ruling before extending that authority boundary; no answer was received
during this work. A working private recipe needs an agreed cleanup-addressing
or delete-authority design, including absent copies after unfollow/backfill.
No public escape, untested keyed-delete recipe, or delete-runtime change was
added. The feeds card and README state the limit. The simulator regression
requires `deletePost` and `unrepost` and then checks ordinary/broadcast event
removal on the existing 1,000-person / 50,000-event fixture; it currently
fails before seeding because `deletePost` is absent. No new both-store
source-removal result, prediction result, or removal meter number is claimed.

**Measurements.** The captured check has **24 total notes: 17**
`N_NOT_PREDICTABLE` notes and **7** other advisories (the friction report's
“18” duplicated-note description is not the literal count). The reduced
insights/social regression reproduces **17 → 3** changed-mutation notes,
covering **3** mutations and **7** distinct table/maintain roots across them.
That is a reduction of **14 notes (82.35%)**, not a change to eligibility.
The new language query has **1 + 32 = 33** maximum lanes and `runs: device`.
The complete suite took **448 s** on the shared host. Summing its 59 Rust
summary lines gives **826 passed / 1 failed / 4 ignored**. The client run
has **203 passed / 1 failed**, and fixture wrappers **9 passed / 0 failed**.
Changed Rust files remain below 1,500 lines; `guide.rs` is **1,295** lines,
`admission.rs` **429**, `residency.rs` **299**, and the note tests **262**.

**Commands and verbatim summaries.** Cargo commands ran from `snapback4/`;
Node used `export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`.
One initial cargo invocation was mistakenly issued at the repository root
and exited 101 without a test summary; it was immediately rerun from the
correct workspace. Test-authoring compile/type mistakes were corrected
before the final targeted checks. An optional cap-script attempt used the
nonexistent `snapback4/scripts/caps.mjs` path; direct changed-source line
counts above establish the requested cap.

Before fixes, `cargo test -p snapback4-lang --test residency_notes --test guide -- --nocapture`
stopped at the guide target:

```text
test result: FAILED. 18 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

Before fixes, `cargo test -p snapback4-lang --test residency_notes -- --nocapture`:

```text
test result: FAILED. 10 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

After fixes, `cargo test -p snapback4-lang --test guide --test residency_notes -- --nocapture`:

```text
test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
```

After fixes, `cargo test -p snapback4-lang --test guide`:

```text
test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

The incomplete F3 case, `cargo test -p snapback4-sim --test clique following_removes_source_events_at_the_envelope -- --nocapture`:

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 40 filtered out; finished in 0.01s
```

From the repository root, `bash snapback4/scripts/test.sh`:

```text
-- ok: cargo build (13 s)
-- ok: wasm build (14 s)
-- ok: package typecheck (2 s)
-- ok: package build (1 s)
-- ok: chat app check (2 s)
test result: FAILED. 39 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 33.16s
-- FAIL: cargo test (416 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
-- ok: fixture wrapper tests (10 s)
-- FAIL: client tests (47 s)
== 2 failure(s) in 448 s
```

The Rust failure is the new unresolved F3 regression, not an inherited
failure. Client failure: `react.test.mjs` Chromium exits with `SIGABRT`.
It was rerun alone with `node --test packages/snapback4/test/react.test.mjs`:

## 2026-09-14 — W3c: 0.2.16 diagnostic and CLI calibration repairs

Implemented the lane against base `0c6b0c03cfea21d65eab728035ef87776a4144a3` under
LLP 3000.007 §18.5 and §20.1–§20.2. The retained calibration report is
`/Users/ccheever/projects/snapback-next-20260914/FRICTION-0.2.16.md`; its
builder evidence is under
`/Users/ccheever/clique-sb4-20260915-astra-next/lanes/astra-snapback4`.
Read the cited m5/m6/m8 diagnostics, guide lookups, Node seed failure,
current Quarry modules and the corresponding run-log entries. Tests retain
the offending expressions in reduced schemas; F4 preserves the builder's
exact source line and column. The final builder files already contain the
manual repairs, so the refusals were reconstructed from those expressions
and the retained diagnostic record, not claimed as an untouched old checkout.

Built: unary `not` now reaches the existing trailing-shape refusal and
mechanical fix; the CLI actually writes `{ ...messageCard }`. Cursor index
refusal is `E_CURSOR_INDEX`, linked to `indexes`, with the existing same-file
and cross-file `, id` repair. `N_NO_CURSOR` is suppressed when the pinned
ordinary group cap fits a direct page, while smaller pages, unpinned reads
and merges of separately capped groups keep the note. Five aliases add
`maintain`, `time`, `clock`, `replay` and `seed`; `maintains` was already a
card at this base. Card-content search includes the language card for words
it contains. Effects, jobs, personas and the README now advertise
`dev --hold-effects --hold-schedules` beside replay and seeding.

Every starter writes `snapback/package.json` with `{"type":"module"}`;
an existing CommonJS app keeps its root package type and CommonJS Metro
configuration. A real Node 24.18.0 seed script imports the generated `api`.
An existing nested package file is a preflight conflict; nothing is written.

Presence keeps the original read spelling and source location beside the
lowered IR. Its assertion, summary, change notes and residency facts no
longer print internal body paths. Identical lowered presence keys retain
all matching source locations instead of guessing one occurrence. Ordinary
point reads now retain the same source map that page reads already had;
source locations replace internal sites in published residency facts. No
executed IR or value serialization, meter ceiling or corpus case changed.

Measured: 7 original regression tests red before their fixes; 9 calibration
tests green at the end (including the merge guard and six-word CLI lookup).
For cap 50, `first 49/50/51` produces 1/0/0 cursor notes. Two capped groups
merged into a page of 50 produce 1 note. Six guide CLI lookups exit 0.
The CommonJS-generated-API import changes exit 1 → 0. Both shape and index
repairs compile on the next check, including parenthesized Boolean
predicates and an index in another source file. No throughput or latency
benchmark was requested; command wall times below are shared-host test
observations, not a performance claim.

What I learned: the shape repair was already correct once selected; its AST
search omitted unary expressions. A per-lane cap cannot justify suppressing
a merge's cursor note. CLI tests caught an old error-code expectation in the
package suite after the Rust tests were green. Source provenance belongs
beside the IR, and the existing published holds needed to be discoverable
where builders look for replay and seed instructions.

### Validation commands and verbatim summaries

All Node/Bun commands used
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`.
Cargo commands ran from `snapback4/`, except one explicitly identified
`--manifest-path` invocation below. That invocation selected the correct
workspace but did not obey the lane's working-directory instruction.
Full suites and ref-check ran from the repository root. Output redirections
went to `/tmp/w3c-*.log`; no evidence logs or generated API were committed.
The following ledger retains intermediate reds as well as the final results.

Before fixes; Cargo stopped after the guide target.

```sh
cargo test -p snapback4-lang --test guide --test residency_notes calibration -- --nocapture
```

```text
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 18 filtered out; finished in 0.00s
```

Before fixes; Cargo stopped after the fix target.

```sh
cargo test -p snapback4 --test fix --test init calibration -- --nocapture
```

```text
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 21 filtered out; finished in 0.00s
```

Before fixes. The cap regression is valid; the first presence fixture lacked a principal index and was corrected before its valid red below.

```sh
cargo test -p snapback4-lang --test residency_notes calibration -- --nocapture
```

```text
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 10 filtered out; finished in 0.00s
```

Before the presence fix, run from the root with the explicit manifest; valid internal-path regression.

```sh
cargo test --manifest-path snapback4/Cargo.toml -p snapback4-lang --test residency_notes calibration_presence -- --nocapture
```

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 11 filtered out; finished in 0.01s
```

Before the init fix; Node 24 reproduces the export failure.

```sh
cargo test -p snapback4 --test init calibration -- --nocapture
```

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3 filtered out; finished in 1.21s
```

First complete targeted pass.

```sh
cargo test -p snapback4-lang --test guide --test residency_notes --test presence --no-fail-fast
```

```text
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

First complete CLI pass.

```sh
cargo test -p snapback4 --test fix --test init --no-fail-fast
```

```text
test result: ok. 23 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.16s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
```

Original seven regressions green.

```sh
cargo test -p snapback4-lang --test guide --test residency_notes calibration --no-fail-fast -- --nocapture
cargo test -p snapback4 --test fix --test init calibration --no-fail-fast -- --nocapture
```

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 18 filtered out; finished in 0.00s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 10 filtered out; finished in 0.00s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 21 filtered out; finished in 2.27s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.08s
```

Expanded content-search regression: return missed language.

```sh
cargo test -p snapback4-lang --test guide calibration_guide -- --nocapture
```

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 19 filtered out; finished in 0.01s
```

Regression for the initial cap-note change: two lanes still need a cursor.

```sh
cargo test -p snapback4-lang --test residency_notes calibration_merge -- --nocapture
```

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 12 filtered out; finished in 0.00s
```

Intermediate: arithmetic was not a word on the language card; added the explicit time-arithmetic sentence.

```sh
cargo test -p snapback4-lang --test guide --test residency_notes --test presence --no-fail-fast
```

```text
test result: FAILED. 19 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

Expanded CLI suite.

```sh
cargo test -p snapback4 --test fix --test init --no-fail-fast
```

```text
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.20s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
```

Guide after time-arithmetic explanation.

```sh
cargo test -p snapback4-lang --test guide
```

```text
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
```

Affected suites, in Cargo output order: chat, ergonomics, presence, residency_notes.

```sh
cargo test -p snapback4-lang --test residency_notes --test presence --test chat --test ergonomics --no-fail-fast
```

```text
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```

Final full Rust CLI suites.

```sh
cargo test -p snapback4 --test fix --test init --no-fail-fast
```

```text
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.31s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
```

Final language calibration: 2 guide + 3 residency tests.

```sh
cargo test -p snapback4-lang --test guide --test residency_notes calibration --no-fail-fast -- --nocapture
```

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 18 filtered out; finished in 0.02s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 10 filtered out; finished in 0.00s
```

Final CLI calibration: 3 fix/guide + 1 init tests.

```sh
cargo test -p snapback4 --test fix --test init calibration --no-fail-fast -- --nocapture
```

```text
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 21 filtered out; finished in 9.35s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.11s
```

Final prose formatting verified.

```sh
cargo test -p snapback4-lang --test guide
```

```text
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
```

Rerun alone after the first full suite encountered an occupied port.

```sh
cargo test -p snapback4 --test witness driver::cli_rejects_milestone_appended_after_done -- --nocapture
```

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 19 filtered out; finished in 9.20s
```

After changing two cursor-refusal assertions to the new code.

```sh
node --test packages/snapback4/test/periphery.test.mjs
```

```text
ℹ tests 17
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 3336.900625
```

Isolated Chromium SIGABRT in the sandbox; still red.

```sh
node --test packages/snapback4/test/react.test.mjs
```

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
```

The user identified this Chromium sandbox artifact in the lane brief;
no independent base-commit run was made, and no additional “pre-existing”
failure claim is made. The five lifecycle timeout artifacts did not recur.
There was no mass client timeout requiring the concurrency-2 rerun.
`./ref-check --verbose` passed before this entry (480 LLP docs, 8,905 refs,
0 errors); it is rerun after the entry. `git diff --check` is clean.
No out-of-scope runtime file was touched; the added fixture is beside the
existing language tests and the red acceptance case beside the feed tests.

**Exact diagnostic texts, before and after (reduced builder fixtures).**
The original captured fanout diagnostic is also retained here verbatim:

```text
feed.q:84:14 — E_STRUCTURAL_FANOUT: feedEntries by byEvent (page bound 10000): the mutation page's read rule is not uniformly decided by its prefix
  rewrite: read it in a query, or pin the deciding columns
  guide: programs
```

The before and after for the same reduced regression:

```text
schema.q:16:14 — E_STRUCTURAL_FANOUT: feedEntries by byEvent (page bound 10000): the mutation page's read rule is not uniformly decided by its prefix
  rewrite: read it in a query, or pin the deciding columns
  guide: programs
```

```text
schema.q:16:14 — E_STRUCTURAL_FANOUT: feedEntries by byEvent (page bound 10000): the mutation page's read rule is not uniformly decided by its prefix
  rewrite: pin .readerId in each read's index prefix by iterating the capped group that supplies those values; for example, with actorId and eventId bound: `for f in follows[actorId] first 1000 by byFollowed:`, then address `feedEntries[readerId = f.followerId, eventId = eventId]`; pinning .readerId decides visibility but grants no read authority over another reader's inbox (see `snapback4 guide feeds`)
  guide: programs
```

All 17 before prediction notes:

```text
schema.q:61:1 — N_NOT_PREDICTABLE: createPost is no longer eligible to predict; queued without a row: point likeCounts by byGroup: online only (site programs.createPost.0)
  rewrite: remove `online only` from maintain likeCounts to inherit its source's sync, or read a compact synced projection
  guide: residency

schema.q:61:1 — N_NOT_PREDICTABLE: createPost is no longer eligible to predict; queued without a row: write target rankedPosts by byPost: online only (site schema.q:59:5)
  rewrite: sync rankedPosts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:61:1 — N_NOT_PREDICTABLE: createPost is no longer eligible to predict; queued without a row: upsert inserts do not predict: the target is online only; queue without a row (rankedPosts by byPost) (site schema.q:59:5)
  rewrite: sync rankedPosts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:61:1 — N_NOT_PREDICTABLE: createPost is no longer eligible to predict; queued without a row: write insightFacts by byId: online only (site insert insightFacts)
  rewrite: sync insightFacts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:61:1 — N_NOT_PREDICTABLE: createPost is no longer eligible to predict; queued without a row: write rankedPosts by byId: online only (site upsert rankedPosts)
  rewrite: sync rankedPosts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:65:1 — N_NOT_PREDICTABLE: like is no longer eligible to predict; queued without a row: point insightFacts by bySourceKind: online only (site programs.like.3)
  rewrite: sync insightFacts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:65:1 — N_NOT_PREDICTABLE: like is no longer eligible to predict; queued without a row: point insightFacts by bySourceKind: online only (site programs.like.4)
  rewrite: sync insightFacts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:65:1 — N_NOT_PREDICTABLE: like is no longer eligible to predict; queued without a row: point likeCounts by byGroup: online only (site programs.like.6)
  rewrite: remove `online only` from maintain likeCounts to inherit its source's sync, or read a compact synced projection
  guide: residency

schema.q:65:1 — N_NOT_PREDICTABLE: like is no longer eligible to predict; queued without a row: write target rankedPosts by byPost: online only (site schema.q:59:5)
  rewrite: sync rankedPosts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:65:1 — N_NOT_PREDICTABLE: like is no longer eligible to predict; queued without a row: upsert inserts do not predict: the target is online only; queue without a row (rankedPosts by byPost) (site schema.q:59:5)
  rewrite: sync rankedPosts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:65:1 — N_NOT_PREDICTABLE: like is no longer eligible to predict; queued without a row: write insightFacts by byId: online only (site insert insightFacts)
  rewrite: sync insightFacts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:65:1 — N_NOT_PREDICTABLE: like is no longer eligible to predict; queued without a row: write insightFacts by byId: online only (site delete insightFacts)
  rewrite: sync insightFacts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:65:1 — N_NOT_PREDICTABLE: like is no longer eligible to predict; queued without a row: write rankedPosts by byId: online only (site upsert rankedPosts)
  rewrite: sync rankedPosts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:76:1 — N_NOT_PREDICTABLE: repost is no longer eligible to predict; queued without a row: point insightFacts by bySourceKind: online only (site programs.repost.0)
  rewrite: sync insightFacts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:76:1 — N_NOT_PREDICTABLE: repost is no longer eligible to predict; queued without a row: point insightFacts by bySourceKind: online only (site programs.repost.1)
  rewrite: sync insightFacts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:76:1 — N_NOT_PREDICTABLE: repost is no longer eligible to predict; queued without a row: write insightFacts by byId: online only (site insert insightFacts)
  rewrite: sync insightFacts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:76:1 — N_NOT_PREDICTABLE: repost is no longer eligible to predict; queued without a row: write insightFacts by byId: online only (site delete insightFacts)
  rewrite: sync insightFacts to its read-rule audience, or read a compact synced projection
  guide: residency
```

All three after prediction notes:

```text
schema.q:61:1 — N_NOT_PREDICTABLE: createPost is no longer eligible to predict; queued without a row: online-only maintain likeCounts (sites: programs.createPost.0); online-only table insightFacts (sites: insert insightFacts); online-only table rankedPosts (sites: schema.q:59:5, upsert rankedPosts)
  rewrite: remove `online only` from maintain likeCounts to inherit its source's sync, or read a compact synced projection; sync insightFacts to its read-rule audience, or read a compact synced projection; sync rankedPosts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:65:1 — N_NOT_PREDICTABLE: like is no longer eligible to predict; queued without a row: online-only maintain likeCounts (sites: programs.like.6); online-only table insightFacts (sites: delete insightFacts, insert insightFacts, programs.like.3, programs.like.4); online-only table rankedPosts (sites: schema.q:59:5, upsert rankedPosts)
  rewrite: remove `online only` from maintain likeCounts to inherit its source's sync, or read a compact synced projection; sync insightFacts to its read-rule audience, or read a compact synced projection; sync rankedPosts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:76:1 — N_NOT_PREDICTABLE: repost is no longer eligible to predict; queued without a row: online-only table insightFacts (sites: delete insightFacts, insert insightFacts, programs.repost.0, programs.repost.1)
  rewrite: sync insightFacts to its read-rule audience, or read a compact synced projection
  guide: residency
```

## 2026-09-14 — W3b2: Following source removal with bounded system cleanup

Base: `c416b8568053fec9fd43882f821e70e82c4293d5` (`sb4/w3b`). No commit,
push, tag or publication. This completes the F3 recipe gap left by W3b's
entry above, under the lead's tombstone-plus-purge ruling. Orientation:
[LLP 3000 §6–§7](../llp/3000-snapback4.explainer.md#6),
[LLP 3000.007 §8](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#8),
[§14](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#14),
[§18](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#18) and
[§20.3](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#20.3),
the fenced instructions and bounded-jobs exclusions, and F3 in
`/Users/ccheever/projects/snapback-next-20260914/FRICTION-0.2.16.md`.

Built in the feeds card and its README copy: `deletePost` and `unrepost`
delete the author's own public source and broadcast rows and insert a
compact public `removedEvents` tombstone. Private inboxes retain their
original reader-only read/delete rules. The immutable `eventId` on each
inbox entry joins its tombstone on the device; raw sources, authors and
follows keep their existing online-only residency. Both removals retain
`predicts: never`, matching `createPost` and `repost`; actual admission on
both stores queues them without predicted rows. Fresh re-reposts get new
source identities and survive a purge of the previous event, both before
and after cleanup. A repost remains an independent attributed snapshot;
removing an original does not remove another actor's repost event.

The one-minute schedule runs `purgeRemoved` as the system, one tombstone
per chunk. `feed.byEvent` and `cap 1001 by eventId` bound the work by the
1,000-follower cap plus the author's own copy, including old pushed events
backfilled after promotion. The chunk deletes the copies and their marker
atomically. There are at most 32,000 pending markers, capped at 1,000 per
actor. Source deletion stops later follows from backfilling a removed
event. The removal mutations enqueue no jobs. No engine code, meter
ceiling, value serialization, existing corpus case or diagnostic changed.
This is the lead-authorized cleanup addition to §20.3's earlier job-free
recipe, not an extension to delete authority under §8.7(h).

**What the page experiment taught.** A conditional collector that drops
entries loses the merge's cursor: a 20-row result was incomplete with no
continuation. The final Quarry collector instead keeps exactly one slot
per source entry, returning null for removed events. Callers render only
`page.data.filter(row => row !== null)` and continue through `next` even
when no slots render. `complete: true` means that bounded source page was
fully checked, not that 20 live entries were found. This is the rare-removal
tradeoff, on the card. Server and both-store tests prove an all-null first
page retains the exact source cursor and reaches every remaining entry
without duplicates. A lowered-meter test proves a cut is incomplete. A
device observes removal once it applies the removal commit; offline devices
keep their last synced state until they reconnect.

**Coverage and measurements.** The 1,000-person / 50,000-event fixture
removes original events from the five-follower and 900-follower authors;
a focused envelope tests original, old pushed and repost removal for every
reader and the author, then fresh re-reposting and scheduled purge. Every
one of the 6 and 901 principals is queried before and after removal and
cleanup on the server and on both device stores. Both hidden/absent worlds
match on fresh/retry replies, durable receipts, all seven meter fields,
committed deltas, effects, snapshots, streams, and both stores through
admission/reopen/settlement. The author leaves unreadable copies unchanged;
a direct private-key deletion still answers `NOT_FOUND` in both worlds.

Actual scheduled cleanup of three removed events:

| Followers | Principals checked per host | Private copies purged | Tombstones purged | Chunks | Rows written |
|---:|---:|---:|---:|---:|---:|
| 5 | 6 | 18 | 3 | 3 | 21 |
| 900 | 901 | 901 | 3 | 3 | 904 |

In the full 50,000-event fixture, removing one five-follower original writes
2 rows (1 examined / 9 index entries), then 1 purge chunk writes 7 rows;
removing one 900-follower broadcast original writes 3 rows (2 examined /
14 index entries), then 1 purge chunk writes 1 tombstone deletion. All
inbox rows for those event IDs are zero after cleanup.

`JobRun` exposes chunk and write counts, not a `Metered` value. The
measurement test executes the same compiled job IR through the local
interpreter's metered harness over a real SQLite transaction, as the system
with all rows held and no horizons, under unchanged ordinary ceilings
(stricter than the job's). It asserts no cap and the exact deleted-row
count. These are sweep-body meters including the harness's null-result
encoding, not scheduler bookkeeping or a new job telemetry surface:

| Followers | Copies in measured chunk | Examined | Index entries | Rule probes | Steps | Heap bytes | Output bytes | Rows written |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 6 | 8 | 39 | 0 | 46 | 6,454 | 6 | 7 |
| 900 | 901 | 903 | 5,409 | 0 | 5,416 | 892,796 | 6 | 902 |
| 1000 | 1001 | 1003 | 6009 | 0 | 6016 | 988196 | 6 | 1002 |

The 5-follower row is the maximum of its three chunks; the terminal chunk
examines 7 rather than 8. A broadcast-only marker has zero private copies:
1–2 examined / 3 index entries / 0 rule probes / 10 steps / 482–494 heap
bytes / 6 output bytes / 1 row written. The all-null 20-slot page measures
42 examined / 0 index entries / 0 rule probes / 233 steps / 39,400 heap
bytes / 151 output bytes / 0 rows written. A normal private page also
examines 42: the previous 22 plus 20 tombstone lookups, independent of the
number of follows. The existing cost assertion and comparison fixture
follow the revised recipe. The matched page tests at the full envelope
retain the ordinary under-100 examined assertion.

**Verification.** All Cargo commands below ran from `snapback4/`; the full
suite and ref-check ran from the repository root. Every Node/Bun invocation
used `export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`.
One preliminary guide invocation was accidentally issued from the repository
root and exited 101 before any tests; it was corrected immediately and
changed no root files.

Before recipe changes: `cargo test -p snapback4-sim --test clique following_removes_source_events_at_the_envelope -- --nocapture`:

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 40 filtered out; finished in 0.01s
```

Before recipe changes: `cargo test -p snapback4-sim --test clique following_removal -- --nocapture`:

```text
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 41 filtered out; finished in 0.01s
```

Before recipe changes: `cargo test -p snapback4-device --test device following_removal -- --nocapture`:

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 104 filtered out; finished in 0.02s
```

After the page fix (before additional privacy/measurement cases): `cargo test -p snapback4-sim --test clique following_removal -- --nocapture`:

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 41 filtered out; finished in 0.74s
```

Final targeted server run: `cargo test -p snapback4-sim --test clique following_remov -- --nocapture`:

```text
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 41 filtered out; finished in 36.21s
```

Final targeted device run: `cargo test -p snapback4-device --test device following_removal -- --nocapture`:

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 104 filtered out; finished in 14.24s
```

Sweep-body measurement: `cargo test -p snapback4-sim --test clique following_removal_measures -- --nocapture`:

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 45 filtered out; finished in 0.84s
```

`cargo test -p snapback4-lang --test guide`:

```text
test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

`bash snapback4/scripts/test.sh`:

```text
-- ok: cargo build (4 s)
-- ok: wasm build (14 s)
-- ok: package typecheck (0 s)
-- ok: package build (1 s)
-- ok: chat app check (3 s)
-- ok: cargo test (351 s)
-- ok: chat app typecheck (0 s)
-- ok: expo app typecheck (1 s)

ℹ duration_ms 455.681875
```

### Exact diagnostic text

F4 before, verbatim from `evidence/m5-check.txt` (the `--fix` output was
identical):

```text
chat.q:258:106 — E_QUARRY_TYPE: a shape applies to a row, an object or a page; got bool
  rewrite: shape a read: `messages[id] { body }`
  guide: types
```

F4 after, from the padded regression fixture at the same location:

```text
chat.q:258:106 — E_QUARRY_TYPE: shape messageCard after where attaches to bool inside the predicate; apply it to the page with { ...messageCard }
  rewrite: { ...messageCard } — check --fix applies it
  guide: shapes
```

The CLI applies that rewrite and then reports no problems.

F11 before, verbatim from `evidence/m6-check.txt`:

```text
chat.q:148:1 — E_NOT_PREDICTABLE: mutation chat.send asserts predicts, but connected[recipient] decides a fallible or variable-cost arm at programs.chat.send.body.19.then.0.loop.0
  rewrite: decide only the emit with presence; read it on the server in a service mutation for anything else
  guide: prediction
```

The reduced source reproduced the same refusal with
`programs.chat.send.body.0`. After:

```text
chat.q:8:1 — E_NOT_PREDICTABLE: mutation chat.send asserts predicts, but connected[recipient] decides a fallible or variable-cost arm (read at chat.q:9:17)
  rewrite: decide only the emit with presence; read it on the server in a service mutation for anything else
  guide: prediction
```

Hoisting `profiles[viewer].displayName` before the presence arm compiles
and leaves `predicts: eligible`. The assertion, summary and transition-note
regression all reject internal paths.

F8 before, verbatim from `evidence/m8-check.txt`:

```text
insights.q:60:22 — E_QUARRY_UNKNOWN: index rankedPosts.byScore cannot carry a cursor: it neither ends in id nor is unique
  rewrite: by byScore: score, at, postId, id — check --fix applies it
  guide: language
```

F8 after in the reduced index fixture:

```text
insights.q:8:22 — E_CURSOR_INDEX: index rankedPosts.byScore cannot carry a cursor: it neither ends in id nor is unique
  rewrite: by byScore: score, at, postId, id — check --fix applies it
  guide: indexes
```

L2 before, verbatim from `evidence/m8-check-final.txt`:

```text
note: chat.q:106:1 — N_NO_CURSOR: query chat.settings returns a page of 50 members rows with no cursor: when more rows exist the card reads `complete: false` and there is no `next` to continue on
  rewrite: declare `c: cursor ?` and page with `after c` — chat.settings(.., c: cursor ?): return members[..] after c last 50 by <index>
  guide: reads
```

After: no `N_NO_CURSOR` for that cap-50, page-50 read. A page of 49 still
prints the unchanged note text with its own bound and source name.

F12 before:

```text
no card named maintain; nearest: evolution, personas, reads
no card named time; nearest: reads, assets, native
```

After, the first stdout lines are:

```text
# Maintains: filtered contributions, calendar groups, pages and rank
# Quarry — the language card
```

`clock` returns the language card too; `replay` and `seed` return `# Personas`
with the hold flags. `maintains` continues to return its existing card.

F14 before, reproduced on Node 24.18.0 as well as recorded on Node 25.9.0:

```text
SyntaxError: The requested module '../snapback/generated/api.ts' does not provide an export named 'api'
```

After, the importing script exits 0 and prints:

```text
api import: ok
```

### Full-suite disposition

Ran twice from the repository root:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
bash snapback4/scripts/test.sh
```

First run: summed Rust pass/fail/ignored = (826, 1, 4). Verbatim stage and JavaScript summaries:

```text
== cargo build
-- ok: cargo build (2 s)
== wasm build
-- ok: wasm build (14 s)
== package typecheck
-- ok: package typecheck (1 s)
== package build
-- ok: package build (0 s)
== chat app check
-- ok: chat app check (1 s)
== cargo test
-- FAIL: cargo test (369 s)
== chat app typecheck
-- ok: chat app typecheck (1 s)
== expo app typecheck
-- ok: expo app typecheck (1 s)
== fixture wrapper tests
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8440.321208
-- ok: fixture wrapper tests (8 s)

ℹ duration_ms 7927.500625
-- ok: fixture wrapper tests (8 s)
== client tests
ℹ tests 204
ℹ pass 202
ℹ fail 2
ℹ cancelled 0
ℹ duration_ms 41975.074292
-- FAIL: client tests (42 s)
== 2 failure(s) in 387 s
```

Final run: summed Rust pass/fail/ignored = (829, 0, 4). Verbatim stage and JavaScript summaries:

```text
== cargo build
-- ok: cargo build (1 s)
== wasm build
-- ok: wasm build (2 s)
== package typecheck
-- ok: package typecheck (0 s)
== package build
-- ok: package build (1 s)
== chat app check
-- ok: chat app check (2 s)
== cargo test
-- ok: cargo test (353 s)
== chat app typecheck
-- ok: chat app typecheck (1 s)
== expo app typecheck
-- ok: expo app typecheck (1 s)
== fixture wrapper tests
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ duration_ms 8726.37675
-- ok: fixture wrapper tests (9 s)
== client tests
ℹ tests 204
ℹ pass 203
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 42946.728208
-- FAIL: client tests (43 s)
== 1 failure(s) in 373 s
```

Summing the Rust target summaries in that log: 834 passed / 0 failed / 4 ignored.

The only full-suite red is Chromium exiting with SIGABRT in
`packages/snapback4/test/react.test.mjs`, before browser assertions run.
The requested isolated rerun, `node --test packages/snapback4/test/react.test.mjs`,
reproduced that sandbox launch failure:

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 407.740417
```

This matches the environment artifact named in the lane instructions;
the lead reruns it outside the sandbox. No clean-base full-suite rerun was
performed, so this entry makes no independently verified pre-existing
source-failure claim. The base hash is recorded above. The first F3 red
was the inherited missing recipe and is now green; no failure of this
lane's affected tests remains.

`./ref-check --verbose` before appending this entry:

```text
ref-check: ok — 480 LLP docs, 8906 refs in 23677 files, 0 errors, 0 unchecked
```

Out-of-scope files: none. The simulator's existing cost assertion and
candidate-source replacement were minimally updated for the extra 20
removal lookups and the source's new author-owned delete rule. All changed
code files stay below 1,500 lines; `git diff --check` is clean. The package
README and feeds card Quarry agree and compile without diagnostics or
notes. No diagnostic-text change was requested or made; no new `E_` or
`N_` code needed an entry in `guide::CODES`.

ℹ duration_ms 42846.715583
-- FAIL: client tests (43 s)
== 1 failure(s) in 359 s
```

The first run's Rust failure was
`driver::cli_rejects_milestone_appended_after_done`: the chosen port 65118
was already occupied (`E_WITNESS_PORT`). It passed alone (1/0) and in the
final full suite. The first client run had the obsolete cursor-code assertion
in `periphery.test.mjs` and the Chromium abort. Both same-file and cross-file
assertions now require `E_CURSOR_INDEX`; the periphery suite passes 17/0.
The final full suite's only red is `react.test.mjs`, whose browser exits
SIGABRT at launch in this sandbox; its isolated rerun is 0/1. This matches
the lane brief's environment artifact. It is not a claimed product regression
or a base-verified pre-existing failure; no baseline browser rerun was done.
The lead still needs the browser check outside this sandbox.

No brief item was dropped. No commits, pushes, tags, publication, sub-agents,
remote machines, dependency installation or corpus edits were performed.
Supporting files beyond the named initial read list were
`bind/program.rs` (cursor code and presence metadata), `bind/program/expr.rs`
(source capture), `diag.rs` and `guide/codes.rs` (code routing/registry),
`guide/personas.rs` (seed/replay discovery), the existing Rust test suites,
and `packages/snapback4/test/periphery.test.mjs` (two error-code assertions).
These implement the stated lane scope; no other-lane runtime file was touched.
The largest changed code file is 1,287 lines; Markdown is uncapped.

Final root checks:

```sh
./ref-check --verbose
git diff --check
```

```text
ref-check: ok — 480 LLP docs, 8906 refs in 23674 files, 0 errors, 0 unchecked
```

`git diff --check` exits 0 with no output. Working tree: 20 intended files,
uncommitted. The final reference summary is after appending this entry;
this closing paragraph adds no reference or file.

## 2026-09-14 — W3d: advance development time without waiting through expiry or a digest

Built S27 against base `0c6b0c03cfea21d65eab728035ef87776a4144a3`, after
reading calibration F5: its expiry probe waited 185,023 ms, its choreography
adapter requested 185,000 ms, and its old-post test used a special backdated
system seed. `dev --clock-offset +25h` now starts ahead of wall time;
`clock advance 185s --port N` and the loopback-only
`POST /dev/clock/advance` move the running clock forward. `run --now` pins
one query, mutation or job to Unix milliseconds or wall time plus a duration,
so an ordinary mutation can create an old post. The process clock continues
monotonically between advances; its offset is process-local and resets on
restart. `serve` refuses clock flags and the endpoint with E_CLOCK_DEV_ONLY;
invalid, zero, backward and overflowing advances return E_CLOCK_INPUT.

Expiry, schedule admission and job chunks use the same maintenance path for
ordinary ticks and explicit advances. An advance drains bounded expiry batches
and queued chunks before replying, preserving the existing job meters,
missed-period coalescing, parked jobs and replay schedule holds. A maintenance
error leaves time advanced and pending work for the next ordinary tick; the
response makes that partial outcome explicit. Authentication, assets,
actions, effect leases, worker sessions, snapshots and streams use the same
server clock. One small core addition, `Engine::seed_at`, gives the dev seed
endpoint that clock too. No serialized value form, meter ceiling, client
clock or ordinary application wire field changed. The jobs/expire cards,
`guide clock`, code explanations and README carry the controls.

The regression first failed on the actual base host with E_OP, "no route
/dev/clock/advance; operations are POST /q/<op> and POST /m/<op>", after a
live expiring row and scheduled counter were created. Its final run advanced
185,000 ms in 47 ms of wall time, swept one row, ran one `every 2m` job, and
applied both the deletion and scheduled update through normal HTTP sync to
the memory and SQLite device stores while their local clocks stayed fixed.
A second test physically deleted 2,005 rows across the existing 2,000-row
sweep batches before the endpoint returned. The offset check covered
90,000,000 ms (+25h); other cases covered absolute/relative run times,
queries/mutations/jobs, release refusals, malformed and overflowing input,
replay holds and restart admission. Earlier fixture construction required
correcting Quarry syntax and using the native device opener that creates
its side tables; those were test setup errors, not product regressions.

Validation: the red regression reported 0 passed / 1 failed; final clock
suite 7 passed / 0 failed, replay suite 4 / 0, guide suite 18 / 0.
`bash snapback4/scripts/test.sh` completed in 398 s on the shared host: Rust
827 passed / 0 failed / 4 ignored across 60 targets, fixtures 9 / 0, and all
builds/typechecks passed. The client check was 202 / 2: one native admission
timing assertion and Chromium's sandbox SIGABRT. The timing test alone
passed 1 / 0; the requested concurrency-two client rerun passed 203 / 1,
leaving only the documented Chromium launch artifact for the lead's
outside-sandbox run. No failure is classified as pre-existing from an
unverified base comparison. Reference validation and the whitespace check
passed. No commit, push, tag or publication was made.

## 2026-09-14 — W3e: the online session card and the development banner

The 0.2.16 calibration's d-01 called `session()` on the online client and
crashed. At base `d474d2cde4df59de478006cd9c697c03001a01b3`, the README's
16-member card had 4 missing online implementations: `session`, `onSession`,
`refreshSession` and `logoutAll`. They now belong to `Client` and both tiers
implement them; `sync` is the one explicitly device-only member. The test
extracts that list from the README and checks real client objects, reporting
16 members, 1 device-only, 0 missing. Persona sessions are null; a bare-token
client learns its session on refresh. Rotation adopts the replacement bearer
before notification, coalesces concurrent calls, schedules near expiry, and
retries obsolete authentication refusals with the same mutation ID. Sign-out
and current-session refusal clear the session; offline logout-all retains it.

Seven new client regressions went from 0 passed / 7 failed to 7 passed /
0 failed (52.43575 ms before, 50.734167 ms after). The broader targeted run
first passed 61 of 62: a successful query could overwrite a watch's signed-out
state after the change feed refused the session. Fencing installation of that
answer made it 62/62 (18,845.226 ms). The generated-TypeScript regression also
caught a new dependency when it copied `contract.ts` alone: the session types
now live in the self-contained contract and `auth.ts` re-exports them. Its
isolated rerun passed 1/1 in 0.32 s. This is why a compile-time card and a
runtime README check both matter; either alone missed the original gap.

For d-05, the release paragraph and dev's stderr banner now say development
only, name loopback personas and unauthenticated `/seed`, and point to
`deploy` + `serve`. The real host regression went from 0/1 to 1/1
(1.16 s before, 1.45 s after): dev accepts an unauthenticated seed and persona
read (HTTP 200); serve refuses seed (403) and persona (401), then accepts a
guest bearer (200) and sees zero rows from the refused seed. The personas
card carries the same guidance. No server admission rule, meter ceiling,
serialized value, corpus case, or diagnostic code changed. The guide suite
passed 18/18 in 0.05 s; the largest changed source file is 1,306 lines.

The first full `bash snapback4/scripts/test.sh` run reported 2 failing steps
in 368 s (the now-fixed standalone-contract regression and client tests,
including the now-fixed watch race). The final run reported 1 failing step
in 297 s: client tests, 242 passed / 1 failed, solely Chromium SIGABRT in
`react.test.mjs`. Its isolated rerun also reported 0 passed / 1 failed in
444.826708 ms, matching the sandbox artifact named in the lane brief; the lead
must rerun that browser test outside the sandbox. All final Rust tests,
fixture tests, package/app typechecks and builds passed. No inherited-product
failure is claimed. No commit, push, tag or publication was made.

## 2026-09-14 — W3a: a web outbox head survives immediate navigation

Read the 0.2.16 F1 evidence and the identical 0.2.12 choreography failure:
`removed member received a new live group message`. The ordinary request
could be in flight at `pagehide`, suppressing the keepalive request, and
reopening waited for the whole initial sync before replay. The Node model
reproduced both, plus admission finishing after the page was suspended.
The reproduction base is `826108972b7b6969a97d40d7503effa64faa95c3`.
During verification HEAD advanced to `c2b78619907655503a9da7b56170b0ee48d8a33a`
with benchmark records only; no `snapback4/` code changed in that advance.

Built the LLP 3000.007 §20.4 handoff with §18.2's store fence. The ordinary
sender records its mutation id while sending and persisting settlement;
exit may overlap only that same oldest committed head. Its outcome remains
unknown until a durable receipt or sync acknowledgement arrives. A completed
outbox commit rechecks a suspended page, and `pageshow`/visible stops that
recheck. Reopening a web device probes the persisted server store identity
and head before replaying unknown writes ahead of initial acquisition;
missing/different identity, backend replacement and a regressed head keep
the existing sync/restore path. Mutation ids and row ids are preserved.
The 65,536-byte shared keepalive body budget and 1,000 ms exit wait remain.

The first implementation also tried early replay on native shared stores.
The existing native snapshot/sender test exposed a deadlock: the new owner
waited for a send whose fixture released it only after acquisition started.
Its isolated result was 0 passed, 0 failed, 1 cancelled (12,004 ms). Early
replay is now web-only; that same isolated test passed in 119.812 ms, and
all lifecycle tests passed in the final affected run. This was an introduced
regression, repaired here, not an attributed baseline failure.

The README and writes card describe the new handoff and recommend awaiting
`client.mutate(...)` before programmatic navigation for durable admission.
The optional public `flush()` was considered and not added: `mutate` already
provides that admission boundary, and a new public network-wait contract is
unnecessary for this repair. No diagnostic or note was added or changed.

Validation used Node 24.18.0, with
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH` before JS commands.
Commands below run from `snapback4/` unless the repository root is named.

- `node --test --test-name-pattern='unawaited|finishing|same store' packages/snapback4/test/navigation-model.test.mjs`:
  before `ℹ tests 6`, `ℹ pass 0`, `ℹ fail 6`, `ℹ cancelled 0`;
  after `ℹ tests 6`, `ℹ pass 6`, `ℹ fail 0`, `ℹ cancelled 0`.
- `node --test --test-concurrency=2 packages/snapback4/test/navigation-model.test.mjs packages/snapback4/test/web-navigation.test.mjs packages/snapback4/test/local-e2e.test.mjs packages/snapback4/test/client-lifecycle.test.mjs`:
  `ℹ tests 74`, `ℹ pass 74`, `ℹ fail 0`, `ℹ cancelled 0`,
  `ℹ duration_ms 31985.715958`.
- Repository root, `bash snapback4/scripts/test.sh`:
  `-- ok: cargo test (339 s)`; fixture tests `ℹ tests 9`, `ℹ pass 9`,
  `ℹ fail 0`; client tests `ℹ tests 245`, `ℹ pass 244`, `ℹ fail 1`,
  `ℹ cancelled 0`; `-- FAIL: client tests (44 s)`;
  `== 1 failure(s) in 356 s`. The only failure is the supplied sandbox
  artifact: `react.test.mjs`, Chromium `exitCode=null, signal=SIGABRT`.
  Builds, wasm, package/app typechecks, guide compilation and Rust tests pass.
- Repository root, `./ref-check --verbose`: 480 LLP documents, zero errors
  and zero unchecked references. `git diff --check` passes. The largest
  changed code file is `local.ts`, 1,174 lines.

Final affected-run measurements: for 1 and 2 writes, with ordinary delivery
aborted before application or after application but before its reply, exit
requests changed from 0 to 1; the oldest write reached the server before
reopen in all four cases. Reopen took 23/23/18/25 ms respectively, ending
with 1/2/1/2 rows and 0 duplicates. Late admission produced 1 exit request
and 1 row only after commit. With first sync held, the reopened client sent
1 write and the server applied it before that sync was released. Three
identity controls (different, missing, restored) sent 0 premature writes.

`witness/navigation-immediate.mjs` adds ten real-document cases: awaited
pending/sent, unawaited calls, two writes, 0/5 ms navigation, a held ordinary
request, a 3 s first sync, and a destination with no client for 10 s. The
builder-shaped admin removal increments an independent counter to expose
double application. Its Quarry compiled and the real-server source probe
reported `navigation witness source: 3 operations; 2 same-ID requests; 1 application; 0 duplicates; passed`.
`node --check witness/navigation-immediate.mjs` passes. Chromium was not
launched for this witness inside the sandbox. The lead's exact command,
from `snapback4/` with the Node PATH above, is
`node witness/navigation-immediate.mjs`; run the same witness against the
base implementation and this implementation to record its JSON lines before
and after. Browser timings and the actual ten-second destination remain
unmeasured here. No commit, push, tag or publication was performed by this lane.

## 2026-09-14 — W3a2: send an unawaited write before admission can commit

The lead's Chromium run at W3a's HEAD passed eight of ten cases. The two
zero-delay unawaited cases applied zero writes: the page left before its
IndexedDB admission committed. W3a's Node model had awaited the ordinary
send or tested a page that survived until admission finished. Added the
missing same-turn unload and held-save cases for both one and two writes,
against base `092baded2869a0af168f6b301c0e1a2d15fa654e`: four failures,
each observing zero synchronous exit requests. An initial draft of the
test's text-concatenation audit exceeded its declared text bound; the actual
reproduction uses an integer order audit and a non-idempotent application
counter, with a cleanly compiled fixture.

The client now captures the mutation id, operation, a JSON snapshot of the
arguments and minted ids synchronously, before its first admission await.
Web suspension reports even an empty committed queue. A durable unconfirmed
predecessor retains W3a's oldest-head path, including its same-ID ordinary
retry; only with no durable predecessor and no ordinary send in flight can
pending admissions take the new path. Completed or failed admissions remove
their memory records before asynchronous media reconciliation. An ordinary
flush rechecks the exit wait after its queued read, which can cross a
suspension event.

The small additive server change is `POST /m` with `{ writes: [...] }`:
one authenticated request, a 65,536-byte body limit, one to 32 writes,
executed in order under the existing writer lock. Every write retains its
own transaction, rules, meter and mutation-id receipt. The reply contains
per-write receipts and stops at the first refusal; the ordinary outbox
replays the rest. Replay is checked before current operation/argument
validation, preserving outcomes across changed programs. The client sends
the longest prefix that fits the shared body budget (at most 32), or the
single head, without skipping a blocked predecessor. No meter ceiling,
serialized value form, public client card word or existing corpus case changed.

The README and writes card state the limit explicitly: this pre-admission
send is best-effort. If the browser drops it before admission commits, the
write can still be lost. Await `client.mutate(...)` before navigating and
handle a failed outcome; `pending` is the durable admission boundary. The
loss model confirms two submitted writes produce zero applications after
reopen when both keepalive and admission are lost, and two when admission
commits. Argument-mutation, durable-predecessor, failed-admission cleanup,
UTF-8 quota and count-boundary controls also pass.

Validation used Node 24.18.0, with
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH` before JS.
Commands run from `snapback4/` unless the repository root is named; logs
are in `/tmp/w3a2-*.log` on this machine.

- `node --test --test-name-pattern='immediate .* before admission' packages/snapback4/test/navigation-model.test.mjs`:
  before `ℹ tests 4`, `ℹ pass 0`, `ℹ fail 4`, `ℹ cancelled 0`;
  after `ℹ tests 4`, `ℹ pass 4`, `ℹ fail 0`, `ℹ cancelled 0`.
- `cargo test -p snapback4 --test replay ordered_mutation_batch -- --nocapture`:
  before `test result: FAILED. 0 passed; 3 failed; 0 ignored; 0 measured; 4 filtered out; finished in 1.64s`;
  after `test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 1.26s`.
- `cargo test -p snapback4 --test replay -- --nocapture`:
  `test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.45s`.
- `bun run --cwd packages/snapback4 build`: exit 0.
- `node --test --test-concurrency=2 packages/snapback4/test/navigation-model.test.mjs packages/snapback4/test/web-navigation.test.mjs packages/snapback4/test/local-e2e.test.mjs packages/snapback4/test/client-lifecycle.test.mjs`:
  first `ℹ tests 79`, `ℹ pass 79`, `ℹ fail 0`, `ℹ cancelled 0`;
  final `ℹ tests 83`, `ℹ pass 83`, `ℹ fail 0`, `ℹ cancelled 0`,
  `ℹ duration_ms 29131.438709`.
- Repository root, `bash snapback4/scripts/test.sh`:
  `-- ok: cargo test (279 s)`; fixtures `ℹ tests 9`, `ℹ pass 9`,
  `ℹ fail 0`; client `ℹ tests 254`, `ℹ pass 253`, `ℹ fail 1`,
  `ℹ cancelled 0`; `-- FAIL: client tests (45 s)`;
  `== 1 failure(s) in 283 s`. The only failure is the supplied Chromium
  sandbox artifact in `react.test.mjs`: `exitCode=null, signal=SIGABRT`.
  There were no lifecycle or client-concurrency timeouts. No failure is
  attributed to a separately verified pre-existing baseline.
- Repository root, `./ref-check --verbose`: 480 LLP documents, zero errors
  and zero unchecked references. `git diff --check` passes. The largest
  changed code file is `serve.rs`, 1,371 lines.

Final affected-run measurements, same-turn then held-save: one write applied
before admission in 19/15 ms, two in 17/19 ms. Each case sent one exit
request with zero durable entries at that boundary. One-write bodies were
308 bytes; two-write bodies 670 bytes. Application counts before admission
and after replay were 1/1 and 2/2, with zero duplicate counter increments
and unchanged minted row ids. The multibyte quota case sent two ordered
writes in one 64,142-byte request, below 65,536; the count-boundary server
test accepted all 32 writes. Existing stalled-response recovery took
1,009/1,007 ms with zero duplicates, retaining the 1,000 ms wait policy.

No new diagnostic code or note was added; the batch route uses the existing
E_INPUT/E_OP refusals and guide cards. The brief did not request a diagnostic
text comparison. All touched files are within the authorized client,
additive server, tests, published docs and journal scope. No commit, push,
tag or publication was made. `witness/navigation-immediate.mjs` remains
unchanged for the lead to run with `node witness/navigation-immediate.mjs`
outside the sandbox; its actual Chromium after-result is not measured here.

## 2026-09-15 — real Chromium witnesses after W3a2 (lead)

Run outside the lane sandbox on the W3a2 branch (`4eacb45b6`) and again on
the wave-3 integration (`34c4bb9d0`), chromium-1243:
`node witness/navigation-immediate.mjs` — 10 of 10 on both (at W3a
`092baded2` it was 8 of 10: `unawaited-0ms` and `two-unawaited-0ms` lost their
writes). Per case on `4eacb45b6`: awaited-pending-0ms applied 1 (147 ms);
awaited-sent-5ms 1 (125 ms); unawaited-0ms 1 (4 ms); unawaited-5ms 1 (125 ms);
two-unawaited-0ms 2 (4 ms); two-unawaited-5ms 2 (113 ms); ordinary-inflight-0ms
1 (108 ms); awaited-inflight-pending-0ms 1 (6 ms); reopen-before-slow-sync 1
(108 ms); no-client-for-10s 1 (applied before the client reopened, 5 ms).
`node witness/navigation.mjs`: `{"durableWrites":2,"rowsBeforeReopen":1,"rowsAfterReopen":2}`.
Raw output: `~/projects/snapback-next-20260914/w3a2-witness.log`.

## 2026-09-14 — W3R1c: dev-clock batches, bounded cursor notes, preserved module scopes

Reproduced GPT wave-3 findings 3, 4 and 5 before their fixes on base
`6acb5a5bf89eeabed1e89b40ad52e25bf2bdffa5`. Ordered `/m` writes now pass
`shared.now()` into each mutation context, as `/m/<op>` already did.
The schema-cap exemption from N_NO_CURSOR now also requires the cap to fit
the default examined ceiling: a plain scan charges one examined unit per
candidate. No meter ceiling or serialized value changed.

`init` writes the ESM boundary at `snapback/generated/package.json`, never
at `snapback/package.json`. It preserves an existing package's absent type
as well as an explicit type; a newly created root package in an existing
directory keeps the nearest ancestor package's type. The generated API's
package boundary is rebuilt by `check` and `dev` with the API, so deleting
ignored artifacts does not break the next Node import. The Expo starter's
worker is `worker.mts`; dev discovers it and doctor names that extension.
The reference worker remains unchanged. These supporting changes prevent
the narrower package scope from breaking the starter's own Node worker.

Commands below use Node 24.18.0:
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`.
Cargo and client commands run from `snapback4/`; suite and ref-check commands
run from the repository root. Logs are `/tmp/w3r1c-*.log` on this machine.

Red before / green after:

- `cargo test -p snapback4 --test clock ordered_batch_uses_dev_clock -- --nocapture`:
  red `test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 7 filtered out; finished in 1.02s`;
  green `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 1.01s`.
- `cargo test -p snapback4-lang --test residency_notes capped_page_cursor_note -- --nocapture`:
  red `test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 18 filtered out; finished in 2.29s`;
  green `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 18 filtered out; finished in 2.30s`.
  An initial test-authoring compile error used `Value::Text` instead of
  `Value::String`; that attempt was not counted as the red reproduction.
- `cargo test -p snapback4 --test init init_preserves_existing_commonjs -- --nocapture`:
  red `test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 4 filtered out; finished in 1.00s`;
  final green `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 1.94s`.
  The test covers default, online and Expo, checks the generated Expo worker
  with Node, and imports the API again after deleting and rebuilding the
  generated directory. That last control reproduced a further red before
  the generator fix:
  `test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 5 filtered out; finished in 2.02s`.
- `cargo test -p snapback4 --test init init_preserves_inherited_module_type -- --nocapture`:
  red `test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.94s`;
  green `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 1.52s`.
  Both inherited CommonJS and inherited ESM keep the same `typeof require`.

Affected Rust suites:

- `cargo test -p snapback4 --test clock --test init --test replay -- --nocapture`:
  clock `test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.56s`;
  init `test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.52s`;
  replay `test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.33s`.
- `cargo test -p snapback4-lang --test residency_notes --test guide -- --nocapture`:
  guide `test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s`;
  residency notes `test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.32s`.
- `node --test --test-concurrency=2 packages/snapback4/test/periphery.test.mjs packages/snapback4/test/worker.test.mjs`:
  `ℹ tests 26`, `ℹ pass 26`, `ℹ fail 0`, `ℹ cancelled 0`,
  `ℹ duration_ms 16886.214167`.
  This includes both `.mjs` and `.mts` workers in a CommonJS application.
  Before building the wasm artifacts, an attempted package build reported
  TS2307 for the missing wasm JS wrapper, and an attempted worker test
  reported a missing dist module. These were setup attempts, not product
  regression evidence. After TypeScript emitted the package, the old
  binary's `.mts` discovery test timed out (`ℹ tests 1`, `ℹ pass 0`,
  `ℹ fail 0`, `ℹ cancelled 1`); the new binary passes it in the affected suite.

Measurements: offset **90,000,000 ms**, TTL **180,000 ms**, ordinary rows **1**,
batch rows **2**, live rows after both transports **3**, after same-ID replay
**3**, duplicates **0**. The final affected run stamped the ordinary row at
**1789540981176**, batch rows at **1789540981178** and **1789540981179**, inside
the server query bracket **1789540981175–1789540981185**. They use the same
clock; separate transactions need not have identical millisecond stamps.
At cap/take **9,000**, the runtime returns **8,192** rows, records **8,193**
examined including the refused charge, and reports incomplete. A cursor
continues for **808** more rows, **9,000** total. Cap controls **8,191** and
**8,192** omit the note; **8,193** and **9,000** retain it. Existing take
**49/50/51** controls still pass.

No diagnostic text changed and no code was added to guide::CODES. The
9,000-row program previously had no N_NO_CURSOR; it now receives:

```text
schema.q:6:1 — N_NO_CURSOR: query list returns a page of 9000 rows rows with no cursor: when more rows exist the card reads `complete: false` and there is no `next` to continue on
  rewrite: declare `c: cursor ?` and page with `after c` — list(.., c: cursor ?): return rows[..] after c last 9000 by <index>
  guide: reads
```

The original seed failure was
`ReferenceError: require is not defined in ES module scope, you can use import instead`;
after init it prints `existing CommonJS seed: ok`, and the generated API
prints `generated api ESM import: ok`.

Blocking suite and final retries:

- Repository root, `bash snapback4/scripts/test.sh`, first run:
  `-- ok: cargo test (304 s)` (873 Rust tests passed, 0 failed, 4 ignored,
  summing its 60 test-summary lines); fixtures `ℹ tests 9`, `ℹ pass 9`,
  `ℹ fail 0`; clients `ℹ tests 262`, `ℹ pass 261`, `ℹ fail 1`,
  `ℹ cancelled 0`; `-- FAIL: client tests (44 s)`;
  `== 1 failure(s) in 321 s`. The client failure was Chromium SIGABRT.
- The same command, final run including inherited-type preservation and
  rebuilding the generated package marker:
  `-- ok: cargo test (267 s)` (874 passed, 0 failed, 4 ignored over 60
  test-summary lines); fixtures `ℹ tests 9`, `ℹ pass 9`, `ℹ fail 0`,
  `ℹ cancelled 0`; clients `ℹ tests 262`, `ℹ pass 260`, `ℹ fail 2`,
  `ℹ cancelled 0`; `-- FAIL: client tests (43 s)`;
  `== 1 failure(s) in 271 s`.
  All other blocking stages passed. Besides Chromium, a navigation fixture
  reported `Address already in use (os error 48)` at startup and then
  `ECONNREFUSED`. No lifecycle test failed.
- `node --test --test-name-pattern='stalled exit body recovers in order' packages/snapback4/test/web-navigation.test.mjs`:
  `ℹ tests 2`, `ℹ pass 2`, `ℹ fail 0`, `ℹ cancelled 0`,
  `ℹ duration_ms 2457.51525`.
- `node --test --test-concurrency=2 'packages/snapback4/test/*.test.mjs'`:
  `ℹ tests 262`, `ℹ pass 261`, `ℹ fail 1`, `ℹ cancelled 0`,
  `ℹ duration_ms 96194.755667`. Chromium is the sole failure; the navigation
  test and the worker/periphery tests pass.
- `node --test packages/snapback4/test/react.test.mjs`:
  `ℹ tests 1`, `ℹ pass 0`, `ℹ fail 1`, `ℹ cancelled 0`,
  `ℹ duration_ms 374.951917`; Chromium again reports
  `exitCode=null, signal=SIGABRT`.

The Chromium failure matches the environment artifact supplied in the brief;
its outside-sandbox acceptance remains the lead's. No product failure is
claimed pre-existing, and no failing whole-suite baseline was independently
verified. The base hash above binds the red reproductions, not such a claim.
The port collision is reported as observed and passes on isolated retry.

Supporting production files beyond the three named implementation files:
`src/dev_worker.rs` discovers the starter's explicit ESM extension,
`src/verbs.rs` adds it to doctor's hint, and `src/project.rs` regenerates the
package boundary. Guide cards, the package README and the existing
worker/periphery tests track that surface. No other lane's code was changed.
No requested implementation item was omitted; no commit, push, tag or
publication was made. The largest changed code file is the guide at
1,364 lines. `git diff --check` passes. Final reference validation:

```text
ref-check: ok — 480 LLP docs, 8927 refs in 23700 files, 0 errors, 0 unchecked
```

Final standalone worker control, `node --test --test-name-pattern='dev also starts a worker.mts' packages/snapback4/test/worker.test.mjs`: `ℹ tests 1`, `ℹ pass 1`, `ℹ fail 0`, `ℹ cancelled 0`, `ℹ duration_ms 4138.123`.

## 2026-09-14 — W3R1f: a cut Following tombstone lookup withholds the result

Base: `6acb5a5bf89eeabed1e89b40ad52e25bf2bdffa5`. Reproduced GPT review
finding 1 from `/Users/ccheever/projects/snapback-w3-review/gpt.md` before
changing the engine. No commit, push, tag or publication. Orientation used
`llp-orient`, the Snapback 4 fence and NOT-DOING, `rules/RULES.md`, LLP 3000
§6–§7, LLP 3000.007 §5.6, §14, §18 and §20.3, W3b2's entry above, and the
published reads/feeds cards and README.

**Built.** Quarry `exists` does not turn a cut lookup into false, and a
point expression does not use null from a cut as established absence.
The existing query unwind now returns `data: null`, `complete: false`,
without a continuation past the unknown work. The meter helper raises its
existing bound value without charging again or changing the cut site.
Only the expression consumer changes; the native lookup API and the raw
point-read visibility normalization remain unchanged. A materialized live
aggregate still carries its observed partial count; `exists` must complete
before it can decide a branch. Both existing partial-count controls pass.
No ceiling, serialized value form, corpus case, parser form, diagnostic or
note changed. The two production files are `engine/runner.rs` and `meter.rs`.

The removal recipe remains the same Quarry program. Its prose and README
now render `(page.data ?? []).filter(row => row !== null)` and distinguish
an all-null completed page, which retains its source cursor, from an
unavailable cut result, which has no cursor. The reads card states the same
rule for point expressions, page shapes, helpers and `where`.

**Measured reproduction, on all three hosts.** Forty pushed events are
added; the newest twenty are removed. Each device reads an actual reader
snapshot through the shared local interpreter over its real store, using
the metered entry point because the public dispatcher fixes the ceilings.

| Host | Examined ceiling | Examined before → after | Removed events/bodies returned before → after | Complete before → after | Has next before → after |
|---|---:|---:|---:|---|---|
| Server | 25 | 42 → 26 | 17 → 0 | false → false | true → false |
| Memory device | 25 | 42 → 26 | 17 → 0 | false → false | true → false |
| SQLite device | 25 | 42 → 26 | 17 → 0 | false → false | true → false |

With the default ceiling, every host still examines **42**, returns **20**
null slots, is complete and retains its continuation. Existing ordinary
removal, fresh repost, cleanup, all-null pagination and the 1,000-person /
50,000-event envelope pass. The additional expression fixture exercises
direct points, `not exists`, point shapes, conditional shapes, `where`,
helper shapes and required lookups. Across the three hosts it checks **66**
cut outcomes and **57** completed controls; **39** hidden/absent outcome
pairs match all response fields and all seven meter fields. This is query
behavior, not a purge-timing claim.

**What the broader suite taught.** Three existing Trending assertions
expected ten ranked rows after the scan exhausted the budget needed for
the score lookups. Those scores are unknown under the same rule; the
ranking is now withheld. The two assertions in
`snapback4-lang/tests/repairs.rs` and the one in
`snapback4-sim/tests/clique.rs` now require null, incomplete, no next, while
retaining their positive ranking and adversarial winner controls. The
feeds card and README explain that the scan and scores share the ceiling.
These are the only test changes beyond the new removal/expression cases.

**Targeted evidence.** Commands below run from `snapback4/`. New regression
fixtures were corrected for index spelling, a missing cap index and query
argument shape before their valid base comparisons; those setup failures
were not counted as reproductions. For the expression comparison the two
production-file changes were reversed with a saved patch, the core diff
was empty against the base above, and the patch was reapplied afterward.

`cargo test -p snapback4-sim --test clique following_removal_cut -- --nocapture`

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 46 filtered out; finished in 0.08s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 46 filtered out; finished in 0.08s
```

`cargo test -p snapback4-device --test device following_removal_cut -- --nocapture`

```text
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 116 filtered out; finished in 0.09s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 116 filtered out; finished in 0.10s
```

`cargo test -p snapback4-sim --test filters point_read_cuts -- --nocapture`

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.01s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.02s
```

`cargo test -p snapback4-device --test device point_read_cuts -- --nocapture`

```text
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 118 filtered out; finished in 0.01s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 118 filtered out; finished in 0.01s
```

Final affected runs:

```text
cargo test -p snapback4-sim --test clique following_remov -- --nocapture
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 41 filtered out; finished in 34.96s
cargo test -p snapback4-device --test device following_removal -- --nocapture
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 116 filtered out; finished in 19.43s
cargo test -p snapback4-sim --test filters -- --nocapture
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
cargo test -p snapback4-sim --test review_corrections a_capped_maintained -- --nocapture
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 30 filtered out; finished in 0.02s
cargo test -p snapback4-lang --test repairs trending_card -- --nocapture
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.64s
cargo test -p snapback4-sim --test clique clique_trending -- --nocapture
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 46 filtered out; finished in 0.53s
cargo test -p snapback4-lang --test guide
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
```

The first `bash snapback4/scripts/test.sh` (from the repository root, with
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`) reported:

```text
test result: FAILED. 7 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.58s
test result: FAILED. 45 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 42.06s
ℹ tests 261
ℹ pass 260
ℹ fail 1
== 2 failure(s) in 347 s
   cargo test
   client tests
```

The Rust failures were the three now-updated Trending expectations. The
client failure was Chromium SIGABRT at `react.test.mjs:74`, the environment
artifact named in the brief. An isolated rerun from `snapback4/`, with the
same Node PATH, `node --test packages/snapback4/test/react.test.mjs`, again
failed during Chromium launch:

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ duration_ms 388.142375
```

No other failure is claimed pre-existing. The final whole-suite and
post-entry reference results follow below.

Final `bash snapback4/scripts/test.sh`, with the same Node PATH, ran every
step and reported **one failing step, client tests**. All Rust targets
passed, including the updated Trending expectations. The client counts
include the Chromium launch failure and one navigation test whose server
could not bind its port (`Address already in use`, then `ECONNREFUSED`).
The exact final script and client summaries are:

```text
ℹ tests 261
ℹ pass 259
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
== 1 failure(s) in 297 s
   client tests
```

The port-collision test passed alone. From `snapback4/`, with the same
Node PATH:

```text
node --test --test-name-pattern='already applied replay' packages/snapback4/test/web-navigation.test.mjs
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ duration_ms 1343.569625
```

It observed **2** writes, **2** rows, **0** duplicates and **1,006 ms**
recovery. The final full run therefore remains red; the isolated navigation
rerun is not substituted into its counts. The lead must run Chromium
outside this sandbox. No lifecycle timeout occurred in either full run,
and no failure is attributed to an unverified base. Full logs remain at
`/tmp/w3r1f-suite.log`, `/tmp/w3r1f-suite-final.log`,
`/tmp/w3r1f-react.log` and `/tmp/w3r1f-navigation-retry.log`.

At the repository root, with the same Node PATH:

```text
./ref-check --verbose
ref-check: ok — 480 LLP docs, 8926 refs in 23701 files, 0 errors, 0 unchecked
```

`git diff --check` passes. The changed Rust files number **12**, the
largest is **1,368 lines**, and **0** exceed 1,500. One dated journal entry
was appended; prior entries are unchanged. All requested implementation,
regression, guide and reference work is complete; no diagnostic-text
comparison was requested, and no diagnostic text changed.

Summing the final script's **60** Rust target summary lines gives **876
passed, 0 failed, 4 ignored**. Fixture wrapper tests report **9 passed,
0 failed**. These aggregates retain ignored cases separately from passes.


## 2026-09-14 — W3R1a: an aborted admission keeps its exit ordering obligation

Reproduced GPT review finding 2 at base
`6acb5a5bf89eeabed1e89b40ad52e25bf2bdffa5`. With A's admission held,
pagehide dispatched its keepalive; admission then aborted, B committed, and
the original keepalive arrived after ordinary flushing sent B. The one- and
two-predecessor audits were **21 and 312**. Delivered keepalives applied
A/A1/A2 without a later `onWrite` settlement; dropped keepalives left only
B. All six initial reproductions failed before the implementation changed.

The exit transport now records exactly the prefix it is about to dispatch,
before calling fetch. That record is independent of the pending-admission
map. The ordinary sender reconciles its original mutation ids, arguments and
minted row ids before sending a successor; repeated exits select that same
unresolved head. A successful admission keeps the ordinary durable outbox.
If admission fails, the web host keeps the fallback for the document's
lifetime, including close/reopen of the same store in that document. A new
document cannot recover an admission and keepalive that were both lost;
the existing loss control now explicitly destroys its modeled document.
The client also rechecks the exposed head after asynchronous queue reads,
so a previously captured durable queue cannot bypass a newly exposed write.

A `failed` response alone is not always a terminal receipt: input validation
can refuse before recording the id. An exposed failure therefore needs a
replay-confirmed refusal before successors proceed. A recorded refusal
releases the successor, even if the original delayed keepalive arrives
later. Unknown replies and retryable unrecorded failures retain the head.
Known receipts retired on store replacement also remove their exposure
record, preserving LLP 3000.007 §18.2's existing identity fence.

An exposed admission failure now returns retryable `E_EXIT_ADMISSION` and
later settles through `onWrite` with the same id while the client is open.
The writes card and README explain that this does not promise non-application
and that the caller must not resubmit with a fresh id. If retaining the
ordering record itself fails, sticky `E_EXIT_ORDER` stops the page's
mutation sending, including when admission also aborts. Both codes are in
`guide::CODES`. Their messages are:

- `E_EXIT_ADMISSION`: `admission failed after this write was exposed at exit; its server outcome is unknown and this page will retry the same id before later writes`
- `E_EXIT_ORDER`: `exit write ordering could not be preserved; this page has stopped sending writes`

The old admission exception used `E_STORE` and the interpolated message
`write ${id} admission outcome is unknown: ${String(error)}`, without a
retryable flag or later settlement obligation. Unexposed admission failures
retain that existing behavior. No client card type, server route, meter
ceiling, serialized value, corpus case or application caller changed.

The final thirteen regressions cover six delivery/admission interleavings,
four unresolved-receipt controls (retryable/unrecorded, with/without a
same-page reopen), two record-preservation failures (admission commits or
aborts), and a recorded terminal refusal that releases B. An isolated
generated package with the three client implementation files taken from the
exact base above fails all thirteen; the final implementation passes all
thirteen. That comparison uses `/tmp` only, no alternate checkout or commit.
Two additional defects found during implementation were made red before
repair: an unrecorded failure releasing successors (two controls plus the
terminal-receipt positive control, 0/3), and an admission abort masking the
stop-sending refusal as E_STORE (0/1). Both are green in the final run.

Final six-case measurements, in delivered/dropped/delayed order, one then
two predecessors: recovery **17/28/18/25/1013/1021 ms**; application orders
**12/123/12/123/12/123**; applications **2/3/2/3/2/3**; ordinary sends and
sent settlements **2/3/2/3/2/3**; **0 duplicate applications** after the
original delayed keepalive completes. The failed callers receive **1/2**
later sent settlements. Record-preservation refusals send **0** exit and
**0** ordinary requests. The existing bounds remain **65,536 bytes** shared
keepalive bodies, **32 writes** per batch and a **1,000 ms** exit wait.

Validation uses Node 24.18.0 via
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH` before every JS
command. Commands below run from `snapback4/` unless the repository root is
named. Evidence is in `/tmp/w3r1a-*.log`.

- `node --test --test-name-pattern='failed admission retains' packages/snapback4/test/navigation-model.test.mjs`:
  initial base `ℹ tests 6`, `ℹ pass 0`, `ℹ fail 6`, `ℹ cancelled 0`;
  after `ℹ tests 6`, `ℹ pass 6`, `ℹ fail 0`, `ℹ cancelled 0`.
- `node --test --test-name-pattern='failed admission retains|unresolved exposure|inability to retain|recorded terminal' packages/snapback4/test/navigation-model.test.mjs`:
  isolated base package `ℹ tests 13`, `ℹ pass 0`, `ℹ fail 13`, `ℹ cancelled 0`,
  `ℹ duration_ms 14291.259083`; final `ℹ tests 13`, `ℹ pass 13`,
  `ℹ fail 0`, `ℹ cancelled 0`, `ℹ duration_ms 14968.04925`.
- `node --test --test-concurrency=2 packages/snapback4/test/navigation-model.test.mjs packages/snapback4/test/web-navigation.test.mjs packages/snapback4/test/local-e2e.test.mjs packages/snapback4/test/client-lifecycle.test.mjs`:
  final `ℹ tests 96`, `ℹ pass 96`, `ℹ fail 0`, `ℹ cancelled 0`,
  `ℹ duration_ms 42259.003125`. Earlier growing-scope runs were 89/89,
  92/92 and 95/95; no affected failure remains.
- `cargo test -p snapback4-lang --test guide -- --nocapture`:
  `test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s`.
- `cargo test -p snapback4 --test replay -- --nocapture`:
  `test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.46s`.

- Additional targeted commands during implementation:
  `node --test --test-name-pattern='unresolved exposure|inability to retain' packages/snapback4/test/navigation-model.test.mjs`
  reported `ℹ tests 3`, `ℹ pass 0`, `ℹ fail 3` on the isolated base and
  `ℹ tests 3`, `ℹ pass 3`, `ℹ fail 0` on the implementation;
  `node --test --test-name-pattern='unrecorded' packages/snapback4/test/navigation-model.test.mjs`
  reported `ℹ tests 2`, `ℹ pass 0`, `ℹ fail 2` before the receipt correction;
  `node --test --test-name-pattern='unrecorded|recorded terminal' packages/snapback4/test/navigation-model.test.mjs`
  reported `ℹ tests 3`, `ℹ pass 0`, `ℹ fail 3` before that correction;
  `node --test --test-name-pattern='inability to retain.*true' packages/snapback4/test/navigation-model.test.mjs`
  reported `ℹ tests 1`, `ℹ pass 0`, `ℹ fail 1` before preserving the stop-sending
  refusal through an admission abort. All these cases pass in the final 13-case
  run above. The terminal-refusal fixture's first draft also tried to consume
  the keepalive response body twice; the recorded red comparison clones that
  response and fails on the missing replay confirmation instead.
- Repository root, `bash snapback4/scripts/test.sh`: first run
  `-- ok: cargo test (321 s)`, fixture `ℹ tests 9`, `ℹ pass 9`, `ℹ fail 0`,
  client `ℹ tests 273`, `ℹ pass 272`, `ℹ fail 1`, `ℹ cancelled 0`,
  `-- FAIL: client tests (49 s)`, `== 1 failure(s) in 325 s`.
  Repeated after the final refusal correction: `-- ok: cargo test (230 s)`,
  fixture `ℹ tests 9`, `ℹ pass 9`, `ℹ fail 0`, client `ℹ tests 274`,
  `ℹ pass 273`, `ℹ fail 1`, `ℹ cancelled 0`,
  `-- FAIL: client tests (42 s)`, `== 1 failure(s) in 235 s`.
  Both runs total **870 passed, 0 failed, 4 ignored Rust tests**; builds,
  wasm, package/app typechecks and all fixture tests passed.
- `node --test packages/snapback4/test/react.test.mjs`: isolated confirmation
  `ℹ tests 1`, `ℹ pass 0`, `ℹ fail 1`, `ℹ cancelled 0`,
  `ℹ duration_ms 382.062375`. Both full-suite failures and this isolated
  failure are Chromium `exitCode=null, signal=SIGABRT`, the sandbox artifact
  specified by the brief. No lifecycle or client-concurrency timeout occurred.
- Repository root, `./ref-check --verbose`: **480 LLP docs, 8,926 refs,
  0 errors, 0 unchecked**. `git diff --check` passes. The largest changed
  code file is `local.ts`, **1,220 lines**; Markdown was not compressed.

No remaining product-test failure is attributed to an unverified base.
The lead must rerun the Chromium witnesses outside the sandbox:
`node witness/navigation-immediate.mjs` and `node witness/navigation.mjs`.
This lane did not run those browser witnesses. The first package build
found the generated wasm bindings absent; `cargo build --workspace --quiet`
and `bash scripts/build-wasm.sh` supplied them before the actual base
regression run. No dependency install, commit, push, tag, publication,
sub-agent, other worktree or remote machine was used. All eight modified
files are within the client, tests, published guide/README and journal scope.

## 2026-09-14 — W3R2: source-owned removal markers and source-located prediction notes

Base: `f675e01d7b53d15144aef528e650c38b8a7ba6b1` (wave-3 integration HEAD, on lane branch `sb4/w3r2`). No commit, push, tag or publication. Read the Grok review at
`/Users/ccheever/projects/snapback-w3-review/grok.md`, W3b2 and W3R1f above,
the Snapback 4 fence and exclusions, `rules/RULES.md`, LLP 3000 §6–§7,
and LLP 3000.007 §5.6, §14, §18, §20.3 and §20.4 with `llp-orient`.

**Built.** The feeds card and README require a tombstone's actor to be the
viewer, its ID to equal its event ID, and the existing source event to be
owned by that viewer. The source check uses the total unique `posts.byId`
key plus its actor equality. The tombstone's `eventId` is an opaque `id`:
Quarry refuses equality between nominal references to two different tables,
so the rule proves the cross-table identity and existence explicitly. No
value serialization or engine authority changes. `removeEvent` remains the
only published tombstone insert, called by `deletePost` and `unrepost`,
before deleting the source in the same transaction. Private inbox rules,
source residency, purge bounds and null-slot pagination keep their contract.

The language Following example points to the full feeds recipe for removal
and null slots. Grouped `N_NOT_PREDICTABLE` lists retain distinct roots and
rewrites and show source `file:line:col`, including inserts and deletes in
expanded helpers. Read IR paths were already translated on this base; the
remaining synthetic write labels and helper-delete header fallback reproduced.
The binder records write source occurrences in its existing side map and
records the helper delete's point source. Lowered IR and execution decisions
are unchanged. No new diagnostic or note code was added.

LLP 3000.007 §20.4 now states the shipped writes-card contract: durable
oldest-head retry, the ordered pre-admission best-effort prefix, the shared
65,536-byte / 32-write caps, the one-second retry wait, and the writes that
can still be lost before admission. The Chromium after-results were already
journaled by the lead; this lane did not rerun them. The forbidden client
files `local.ts`, `local-exit.ts` and `web.ts` were not changed.

**Regression worlds and numbers.** On the exact base above, a forged marker
was accepted and changed the victim's Following on all three hosts: server,
memory device and SQLite device. With the rule fixed, the marker is refused
`E_RULE`, the victim's page is identical, no private row changes, and a
purge has zero rows to delete. There are five server attack variants in two
worlds each: the copied implicit-ID insert, an explicit matching foreign ID,
a forged actor, the real actor with the wrong marker ID, and a missing source.
Their complete observation compares first/retry bodies, receipt, all seven
meters, committed delta, effects, attacker snapshot/stream and admission,
reopen and settlement on both stores. Each pair differs only in a private
copy's event identity, which the victim can read and the attacker cannot.

Two separately named device tests each run both worlds. They hold a victim
device through the attack, its stream and a no-op purge, and hold an attacker
device through admission, reopen and failed settlement. Prediction changes
from true on the base to false: the source ownership probe is online-only,
so admission queues without a tombstone. Every world includes the positive
control: the real owner can still remove the event, hide the target copy,
and have the system purge it without deleting the other world's different
event. Existing ordinary/repost/promotion/envelope and cut tests pass.

The changed-note fixture remains **3 notes / 7 distinct root causes**;
synthetic insert/delete/upsert site labels fall from **7 to 0**, and the two
helper-delete header fallbacks become the helper's actual line. The existing
full-envelope regression still tests **1,000 people / 50,000 events**; the
1,001-copy purge body measures **1,003 examined / 6,009 index entries /
0 rule probes / 6,016 steps / 988,196 heap bytes / 6 output bytes /
1,002 rows written**. No meter ceiling was raised.

**What the implementation taught.** A typed reference checks shape, not
source existence or ownership. The table rule must enforce ownership even
when the paved helper already checks it. The first attempted equality used
`eventId: posts` and was correctly refused as cross-table nominal equality;
the final opaque-ID form compiles cleanly. The first device test reused one
store for two independent engines and correctly hit the backwards-watermark
guard after the first world passed; each world now has its own store. These
were implementation/test-setup failures, not baseline defects.

### Commands and exact summaries

Cargo commands run from `snapback4/`; the script and ref-check run from the
repository root. Every Node/Bun command uses:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
```

`cargo test -p snapback4-sim --test clique following_removal_foreign_tombstone -- --nocapture` — red before, green after:

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 47 filtered out; finished in 0.06s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 47 filtered out; finished in 0.67s
```

`cargo test -p snapback4-device --test device following_removal_foreign_tombstone -- --nocapture` — red before, green after:

```text
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 120 filtered out; finished in 0.08s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 120 filtered out; finished in 0.11s
```

`cargo test -p snapback4-lang --test residency_notes never_predict_change_notes -- --nocapture` — red before, green after:

```text
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 18 filtered out; finished in 0.01s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 18 filtered out; finished in 0.01s
```

`cargo test -p snapback4-sim --test clique following_remov -- --nocapture`:

```text
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 41 filtered out; finished in 32.75s
```

`cargo test -p snapback4-device --test device following_removal -- --nocapture`:

```text
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 116 filtered out; finished in 17.47s
```

`cargo test -p snapback4-lang --test residency_notes --test presence`:

```text
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.47s
```

`cargo test -p snapback4-lang --test guide`:

```text
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

### Exact grouped diagnostics before and after

**Before:**

```text
schema.q:61:1 — N_NOT_PREDICTABLE: createPost is no longer eligible to predict; queued without a row: online-only maintain likeCounts (sites: schema.q:59:61 (likeCounts[p.id] by byGroup)); online-only table insightFacts (sites: insert insightFacts); online-only table rankedPosts (sites: schema.q:59:5, upsert rankedPosts)
  rewrite: remove `online only` from maintain likeCounts to inherit its source's sync, or read a compact synced projection; sync insightFacts to its read-rule audience, or read a compact synced projection; sync rankedPosts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:65:1 — N_NOT_PREDICTABLE: like is no longer eligible to predict; queued without a row: online-only maintain likeCounts (sites: schema.q:59:61 (likeCounts[p.id] by byGroup)); online-only table insightFacts (sites: delete insightFacts, insert insightFacts, schema.q:39:13 (insightFacts[sourceId, kind]), schema.q:65:1 (insightFacts by bySourceKind)); online-only table rankedPosts (sites: schema.q:59:5, upsert rankedPosts)
  rewrite: remove `online only` from maintain likeCounts to inherit its source's sync, or read a compact synced projection; sync insightFacts to its read-rule audience, or read a compact synced projection; sync rankedPosts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:76:1 — N_NOT_PREDICTABLE: repost is no longer eligible to predict; queued without a row: online-only table insightFacts (sites: delete insightFacts, insert insightFacts, schema.q:39:13 (insightFacts[sourceId, kind]), schema.q:76:1 (insightFacts by bySourceKind))
  rewrite: sync insightFacts to its read-rule audience, or read a compact synced projection
  guide: residency
```

**After:**

```text
schema.q:61:1 — N_NOT_PREDICTABLE: createPost is no longer eligible to predict; queued without a row: online-only maintain likeCounts (sites: schema.q:59:61); online-only table insightFacts (sites: schema.q:36:3); online-only table rankedPosts (sites: schema.q:59:5)
  rewrite: remove `online only` from maintain likeCounts to inherit its source's sync, or read a compact synced projection; sync insightFacts to its read-rule audience, or read a compact synced projection; sync rankedPosts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:65:1 — N_NOT_PREDICTABLE: like is no longer eligible to predict; queued without a row: online-only maintain likeCounts (sites: schema.q:59:61); online-only table insightFacts (sites: schema.q:36:3, schema.q:39:13, schema.q:40:5); online-only table rankedPosts (sites: schema.q:59:5)
  rewrite: remove `online only` from maintain likeCounts to inherit its source's sync, or read a compact synced projection; sync insightFacts to its read-rule audience, or read a compact synced projection; sync rankedPosts to its read-rule audience, or read a compact synced projection
  guide: residency

schema.q:76:1 — N_NOT_PREDICTABLE: repost is no longer eligible to predict; queued without a row: online-only table insightFacts (sites: schema.q:36:3, schema.q:39:13, schema.q:40:5)
  rewrite: sync insightFacts to its read-rule audience, or read a compact synced projection
  guide: residency
```

### Blocking suite and scope

`bash snapback4/scripts/test.sh`, with the Node 24 PATH above, ran every
step. Its 60 Rust target summaries total **883 passed, 0 failed, 4 ignored**.
The fixture wrapper has **9 passed, 0 failed**. Client tests have **261
passed, 1 failed**: Chromium aborts with SIGABRT while launching for
`packages/snapback4/test/react.test.mjs`. This is the sandbox artifact named
in the brief; the full suite remains red. No lifecycle timeout or other
client failure occurred, so a lower-concurrency rerun was unnecessary.
The exact step and count summaries are:

```text
-- ok: cargo build (10 s)
-- ok: wasm build (13 s)
-- ok: package typecheck (1 s)
-- ok: package build (1 s)
-- ok: chat app check (1 s)
-- ok: cargo test (268 s)
-- ok: chat app typecheck (0 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
-- ok: fixture wrapper tests (7 s)
ℹ tests 262
ℹ pass 261
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
-- FAIL: client tests (44 s)
== 1 failure(s) in 294 s
   client tests
```

The isolated rerun from `snapback4/`, with the same PATH, was
`node --test packages/snapback4/test/react.test.mjs`. It again aborted during
Chromium launch with SIGABRT, before a browser assertion:

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 285.288292
```

The lead must run the Chromium check outside this sandbox. No failure is
classified as pre-existing from an unverified base; the launch abort is
reported as the explicitly named environment artifact. The authority and
note regressions above were red against the exact base hash before their
fixes. Logs are `/tmp/w3r2-suite.log`, `/tmp/w3r2-react.log` and the
`/tmp/w3r2-{server,device,notes}-{red,green}.log` files; affected-suite logs
are `/tmp/w3r2-{server,device,lang}-affected.log` and `/tmp/w3r2-guide.log`.

The only additional production file beyond the brief's named targets is
`crates/snapback4-lang/src/bind/program.rs` (7 added lines, 1 removed):
it records source locations needed by `bind/residency.rs`. All tests are
beside existing suites. There are **7 changed code files**, maximum
**1,371 lines**, **0** over the cap. All requested implementation is done;
item 2's real Chromium after-results were already the lead's completed work.
No other lane's files, meter ceilings or existing corpus cases changed.
No earlier journal entry was edited.

Final repository-root `./ref-check --verbose`, with the same Node PATH:

```text
ref-check: ok — 480 LLP docs, 8929 refs in 23702 files, 0 errors, 0 unchecked
```

`git diff --check` passes. HEAD remains the base hash above, and a byte-prefix
comparison confirms every prior journal entry is unchanged.


## 2026-09-14 — W3R3e: cut authorization is unknown; a later heap cut still unwinds

Base: `96d5be3bc95523e3b3abd388265fab7cbd85bd62`. Read findings A and D in
`/Users/ccheever/projects/snapback-w3-review/recheck-gpt.out.md`, W3R1f's
entry and `git show bb28c8716`. Used `llp-orient` for the Snapback 4 fence,
LLP 3000 §6–§7 and LLP 3000.007 §14–§15, §17–§18; the published reads card
and README supplied the current surface. No commit, push, tag or publication.

**Built.** A metered rule probe unwinds as unknown before `not` or a
short-circuit operator can use a false sentinel. For a capped point read,
the rule's schema-derived worst-case probe count must fit before looking
for the target. If it cannot, both hidden and absent worlds record the same
cut and unwind to null/incomplete/no continuation; a hidden denial cannot
restore that cut away. With room, the existing probe charges and hidden/miss
normalization remain. System authority and trusted synced reads need no
probe allowance. Writes and predictions still use `Cut::Abort`; this new
point check applies only to `Cut::Cap`.

The runner also unwinds a query's heap bound when the first recorded cut
used another meter. The first cut remains recorded. The unknown-lookup
unwind, heap-first behavior, mutation rollback, step-limit refusal and live
aggregate partial-count contract remain. Production changes are confined to
`engine/read.rs` and one condition in `engine/runner.rs`; no meter ceiling,
serialized form, existing corpus case, parser form, code or note changed.
The reads card, README and LLP 3000.007 §17 state the final rule.

**Red before green.** Each defect failed with the production files still at
the base above on the server and both stores. The initial authorization
fixture accidentally redeclared the built-in `byId` index; that setup error
was removed before the valid red runs recorded below. Positive probe cuts
returned null with no cut marker (and `complete: true` on the server).
Negated probe cuts exposed one protected body on every host. The later heap
cut returned `E_BOUND` on every host, with the verbatim message:

```text
heap bytes reached the ceiling 100
```

After the fix it returns null, incomplete and no continuation, without a
refusal. No diagnostic text itself was edited.

**Measured.** The authorization fixture runs six forms (point, not-exists,
point shape, exists shape, filter and required point), both probe signs,
one- and two-probe rules, and hidden/absent/visible worlds. Across three
hosts: **216 cut outcomes**, **216 ample-budget controls**, **144 paired
hidden/absent observations** comparing responses, all seven meter fields,
completeness, cursors, dependencies, expiry, sequence and errors. The required
point's hidden/absent ample-budget controls retain `RECORD_MISSING`; its cut
never invents that refusal. Completed page controls retain their source
cursor. The device authorization tests deliberately install adversarial
online-only rows in each real `DeviceStore` to exercise its shared read-rule
path; coverage correctly remains incomplete. They are not a sync-delivery
claim, and the existing trusted-partition point tests still pass.

At probe ceiling **0**, the direct protected point on each host now records
**0 examined**, **1 rule probe**, **3 steps**, **12 heap bytes**, **6 output
bytes**, with the other meters **0**; hidden and absent match. Protected
bodies exposed by the negated direct point go from **1 to 0** on each host.

Finding D uses **2 rows × 4,000 body bytes**, examined ceiling **1**, heap
ceiling **100**. Afterward each host records **2 examined** and preserves
`Examined` at `messages.page` as its first cut. Heap is **4,298 bytes** on
the server and SQLite device, **4,300 bytes** on the memory device; all
return null/incomplete/no next with **0 refusals**. The existing heap-first
and rollback suite passes, as do both partial-aggregate controls.

**Targeted commands and verbatim summary lines.** From `snapback4/`; where
two lines appear, the first is the valid base reproduction and the second
the repaired run. Full logs are `/tmp/w3r3e-*.log`.

```text
cargo test -p snapback4-sim --test filters rule_probe_cuts -- --nocapture
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.01s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.05s
```

```text
cargo test -p snapback4-device --test device rule_probe_cuts -- --nocapture
test result: FAILED. 0 passed; 4 failed; 0 ignored; 0 measured; 124 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 124 filtered out; finished in 0.05s
```

```text
cargo test -p snapback4-core --test meter heap_cut_after_examined_cut -- --nocapture
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.01s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.01s
```

```text
cargo test -p snapback4-device --test device heap_cut_after_examined_cut -- --nocapture
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 126 filtered out; finished in 0.00s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 126 filtered out; finished in 0.01s
```

```text
cargo test -p snapback4-sim --test filters -- --nocapture
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
```

```text
cargo test -p snapback4-core --test meter -- --nocapture
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
```

```text
cargo test -p snapback4-device --test device point_read_cut -- --nocapture
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 120 filtered out; finished in 0.06s
```

```text
cargo test -p snapback4-sim --test review_corrections a_capped_maintained -- --nocapture
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 30 filtered out; finished in 0.02s
```

**Scope and limitations.** No out-of-scope file was touched. No requested
implementation or regression was omitted. No failure is called pre-existing
without a base comparison. No timing or constant-time security claim is made.
All changed code files fit the cap; the largest is the reads-card container,
`guide.rs`, at **1,377 lines**. The final blocking-suite and reference results
follow below.

The first full `bash snapback4/scripts/test.sh` ran with
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH` from the repository
root. It found one introduced regression: the initial probe guard checked
any existing cut, so a successful authorization probe after an index-entry
cut changed an established word scan's empty partial page to null. The
existing R3 word-bound control refused that change. The guard now unwinds
only when the probe's own charge fails; other scan cuts keep their prior
page behavior. No existing test expectation was changed. The initial
full-suite summaries were:

```text
test result: FAILED. 43 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.12s
ℹ tests 275
ℹ pass 274
ℹ fail 1
ℹ cancelled 0
== 2 failure(s) in 337 s
   cargo test
   client tests
```

Across that run's 60 Rust targets: **891 passed, 1 failed, 4 ignored**;
fixture wrappers: **9 passed, 0 failed**. The client failure was Chromium
SIGABRT at `react.test.mjs:74`, the sandbox artifact identified in the lane
brief. It repeated alone, from `snapback4/` with the same Node PATH:

```text
node --test packages/snapback4/test/react.test.mjs
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ duration_ms 368.459917
```

The narrowed probe guard's targeted confirmations, from `snapback4/`:

```text
cargo test -p snapback4-core --lib r3_admitted_word_bound_both_cuts_and_real_meter_ceiling -- --nocapture
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 43 filtered out; finished in 0.09s
```

```text
cargo test -p snapback4-sim --test filters rule_probe_cuts -- --nocapture
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.06s
```

```text
cargo test -p snapback4-device --test device rule_probe_cuts -- --nocapture
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 124 filtered out; finished in 0.04s
```

The final full run used the same root command and Node PATH:

```text
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
bash snapback4/scripts/test.sh
ℹ tests 275
ℹ pass 274
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 43644.587042
== 1 failure(s) in 291 s
   client tests
```

All **60 Rust targets** completed: **892 passed, 0 failed, 4 ignored**.
Fixture wrappers reported:

```text

## 2026-09-14 — W3R3c: confirmed exposed writes settle; permanent refusals release the queue

Reproduced re-check findings B and C against base
`96d5be3bc95523e3b3abd388265fab7cbd85bd62` before changing implementation.
Both acquisition-persistence interleavings (abort before commit and lost
response after commit) applied A but lost its `sent` notification after
its caller received `failed/E_EXIT_ADMISSION`. Both permanent-refusal client
cases left B waiting: a removed operation and an argument narrowed from
200 characters to 1. The real HTTP tests separately reproduced missing
receipts for a removed operation, typed argument bounds, and wire decoding.
The last two are different paths: the engine's input validator also returned
an unrecorded failure after HTTP decoding succeeded.

The client retains the exposure record through local receipt persistence
and notification. A confirmed exposed outcome resolves and emits `onWrite`
before the following acquisition, with no await between notification and
removing the exposure. If receipt persistence or close interrupts that path,
the retained exposure remains replayable even when its durable outbox entry
already has a sent sequence. Ordinary, unexposed successful writes keep their
existing sync-before-notification timing. No new durable format or public
card word was introduced; the fallback's lifetime is still this document.

The server now finalizes write-specific operation and argument refusals in
the existing principal/mutation-id receipt store, for individual and ordered
batch requests. The helper rechecks the id in the same transaction that
records the failure, so a concurrent applied receipt wins. Engine input
validation uses it too. The first failure keeps its existing diagnostic
message; replay uses the existing value-free receipt message. A receipt
survives restart and a restored operation definition: a delayed request or
corrected arguments under that id cannot execute later. A valid successor
and the same id under another principal can still execute. Authentication
and retryable transport/store refusals remain unrecorded and retryable.
The writes card and README state terminal failure replay and notification
independence from sync persistence.

Measured acceptance: each B case has **1** failed caller, **1** injected apply
persistence failure, **1** later sent settlement, **1** server application,
and **0** duplicates. Each C case has **1** terminal failure settlement and
**1** sent successor, ordinary request ids **A, A, B** (**3** sends), audit
order **2**, and **0** duplicates after the delayed original request returns
`failed` with `replayed: true`. The HTTP tests cover both routes across
**3** permanent refusal classes and **1** restart per class after refusal,
plus same-principal finality and another-principal success. The affected
client run includes the existing transient retry/hold controls.

Commands below run from `snapback4/` unless the repository root is named.
Every JS command used
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`.
Evidence is in `/tmp/w3r3c-*.log`.

- `node --test --test-name-pattern='confirmed exposed replay|permanent .* operation refusal' packages/snapback4/test/navigation-model.test.mjs`:
  base red `ℹ tests 4`, `ℹ pass 0`, `ℹ fail 4`, `ℹ cancelled 0`,
  `ℹ duration_ms 16077.7565`; final green `ℹ tests 4`, `ℹ pass 4`,
  `ℹ fail 0`, `ℹ cancelled 0`, `ℹ duration_ms 4605.194`.
  The first green run before narrowing the timing change to exposed writes
  was also 4/4 (`ℹ duration_ms 4555.228625`).
- `cargo test -p snapback4 --test replay permanent_ -- --nocapture`:
  before `test result: FAILED. 0 passed; 3 failed; 0 ignored; 0 measured; 9 filtered out; finished in 1.05s`;
  after `test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 9 filtered out; finished in 1.17s`.
- `node --test --test-concurrency=2 packages/snapback4/test/navigation-model.test.mjs packages/snapback4/test/web-navigation.test.mjs packages/snapback4/test/local-e2e.test.mjs packages/snapback4/test/client-lifecycle.test.mjs`:
  `ℹ tests 100`, `ℹ pass 100`, `ℹ fail 0`, `ℹ cancelled 0`,
  `ℹ duration_ms 47583.950667`.
- `cargo test -p snapback4 --test replay -- --nocapture`:
  `test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.44s`.
- `cargo test -p snapback4-lang --test guide -- --nocapture`:
  `test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s`.
- Setup: `cargo build --workspace --quiet`, `bash scripts/build-wasm.sh`,
  and `bun run --cwd packages/snapback4 build` all exited 0; generated wasm
  was absent at first. Wasm measured **1,744,041 B raw**, **485,593 B gzip**.
  The package build also passed after each client implementation change.

Repository root, `bash snapback4/scripts/test.sh` exited 1. Rust totals from
its per-suite summaries are **887 passed, 0 failed, 4 ignored**. The only
failure was Chromium `exitCode=null, signal=SIGABRT` in
`packages/snapback4/test/react.test.mjs`, the sandbox artifact identified by
the brief. No lifecycle timeout or client-concurrency timeout occurred. The
step and count summaries, verbatim:

```text
-- ok: cargo build (1 s)
-- ok: wasm build (12 s)
-- ok: package typecheck (1 s)
-- ok: package build (0 s)
-- ok: chat app check (0 s)
-- ok: cargo test (318 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 7767.90875
```

The final suite is red only for the same Chromium sandbox launch abort.
The lead must rerun that browser test outside the sandbox. No lifecycle or
client timeout was observed, and no failure is attributed to the base
without verification. Logs: `/tmp/w3r3e-suite.log`,
`/tmp/w3r3e-suite-final.log`, `/tmp/w3r3e-react.log`.

At the repository root, with the same Node PATH:

```text
./ref-check --verbose
ref-check: ok — 480 LLP docs, 8931 refs in 23704 files, 0 errors, 0 unchecked
```

`git diff --check` passes. The journal retains its complete original byte
prefix and exactly one new dated entry. No commits, pushes, tags,
publications, sub-agents or remote-machine work were performed.

-- ok: fixture wrapper tests (9 s)
ℹ tests 279
ℹ pass 278
ℹ fail 1
ℹ cancelled 0
-- FAIL: client tests (45 s)
== 1 failure(s) in 332 s
```

Isolated rerun, `node --test packages/snapback4/test/react.test.mjs`, again
aborted at Chromium launch with SIGABRT before any browser assertion:

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 399.439333
```

Repository-root `./ref-check --verbose`:

```text
ref-check: ok — 480 LLP docs, 8932 refs in 23699 files, 0 errors, 0 unchecked
```

`git diff --check` passes. The largest changed code file is `serve.rs`,
**1,321 lines**, and **0** changed code files exceed 1,500 lines. All prior
journal content remains byte-identical. The one-line support change beyond
the brief's explicitly named implementation files is
`crates/snapback4-core/src/engine/mod.rs`: it routes typed-input refusal to
the atomic helper in `engine/receipt.rs`, required by the limit-change
reproduction. These are the at-most-once receipt path within this lane's
scope; no other lane's implementation was changed.

No new diagnostic code or note was added, so `guide::CODES` is unchanged.
The brief requested no diagnostic wording comparison; initial messages are
unchanged. The three HTTP reproductions' messages are `unknown operation
limited`, `E_INPUT: body is longer than 1 characters`, and `argument digit:
expected an integer, got a string`; their recorded replays now use the
existing `the program refused with E_OP` or `the program refused with E_INPUT`.
The new behavior is a terminal receipt, not new diagnostic wording.

All requested implementation and tests are complete. The lead owns the real
Chromium witnesses outside the sandbox; this lane did not run them. No
failure is classified as pre-existing from an unverified base. No dependency
install, ceiling change, serialized value change, existing corpus edit,
commit, push, tag, publication, sub-agent, repository clone or remote machine
was used. The working tree contains only the nine intended changed files.

Final reference-check repeat after the full suite and journal append:
`ref-check: ok — 480 LLP docs, 8932 refs in 23703 files, 0 errors, 0 unchecked`.
HEAD remains the base hash above; no commit was made.

## 2026-09-15 — Wave 3 descope at the review round limit (lead)

The GPT confirmation of round 3 (`69fc90316`) returned NOT READY with three
new defects (N1 High: a non-uniform scan's result shape distinguished hidden
and absent worlds; N2: a schema-adoption race recorded a permanent refusal;
N3: a throwing settlement listener duplicated notifications). Every round had
closed its findings and opened new ones inside the same two mechanisms. At
the three-round limit the lead changed approach instead of a fourth round.

Reverted on `sb4/w3-land`, newest first: W3R3e `1bc1fb442`, W3R3c
`08e47f4d2`, W3R1a `6c1c43810`, W3R1f `bb28c8716`, W3a2 `4eacb45b6`. Journal
entries stay. Kept: W3a, W3b, W3b2, W3c, W3d, W3e, W3R1c (the `N_NO_CURSOR`
ceiling and the narrowed `init` ESM boundary; its batch clock fix left with
the batch route), W3R2 (owner-only tombstones, source-located grouped notes,
the language card) and the integration fixes. Conflicts were resolved to
keep W3R2's authority fixture beside the removed cut fixture, and the
development-clock route beside the removed `POST /m` batch route.

Residuals, stated on the writes and feeds cards, the README and LLP 3000.007
§20.4 and §20.12: an unawaited `mutate` followed by same-turn navigation can
lose the write (Chromium `navigation-immediate` 8 of 10 expected); a page the
meter cuts before its tombstone lookups finish is `complete: false` and can
show an event removed since the last purge. The pre-existing raw-reader
rule-probe cut behaviour is unchanged.

## 2026-09-15 — borrowed row-text A/B does not justify adoption

The fixed 009de62842 / 0.2.16 experiment removes one temporary JSON String
copy from the SQLite indexed-scan path. Its three new differential tests
and 546 selected Rust test executions pass. All six ordinary HTTP runs pass
117,000 timed calls, 7,020 excluded warmups, 162 untimed full walks / 33,510
pages, full physical/auth/leave/regrant checks and owned-group cleanup.
Both calculators were frozen before smoke timing, passed their first formal
execution unchanged and reconcile every value, loss, tie and memory snapshot.

This is a second measured candidate that is not recommended for adoption.
Across 39 cases, median p50 is 19 better / 19 worse / 1 tie, and p95 is
16 better / 23 worse. The 150-group next feed page at eight clients rises
21.460 → 28.791 ms p50 and 46.609 → 93.346 ms p95; throughput falls
333.4 → 206.2 requests/s. Its p95/p99/elapsed/rate worsen in all three
pairs. Large first/rotating pages have some median gains, but mixed paired
results and tails. RSS after-workload medians rise 520 KiB, with mixed
paired differences. The existing benchmark record and six exact original
ledger objects retain all 357 paired losses and the shared-VM, warm-input
and untimed-resource limits. No core runtime change is landed.

Main reached 0.2.18 / 826108972 during the measurement. The target scan_keys
function is unchanged, but the newer read/cursor/schema/host behavior has
not been timed by this fixed 0.2.16 A/B. The existing core-owner ticket stays
open: address repeated indexed collections and row materialization with
coarse or sampled attribution, preserving live authority, meters and exact
results. This batch adds no current competitor or publication claim.


## 2026-09-15 — membership request stacks on unchanged 0.2.18

The performance lane sampled four 150-group first/rotating feed workloads
at one/eight concurrent clients on Durand. Source `053a5b288…` retains the
production settings and packaged SQLite flag, with function symbols kept.
All 158,243 active and 6,120 preparation/warmup responses passed exact
oracles; original logical/auth verification passed before and after. Four
sample windows fit inside their loads, and all eleven owned groups stopped.

Independent recomputation confirms query-engine ancestry for almost all
request observations. Rotating pages show substantial cursor parsing/encoding
ancestry (308/1,266 C1 and 2,974/11,387 C8 observations). These are overlapping
stack observations, not CPU time or a new latency result. The benchmark
README and storage record retain the complete scope and hashes; independent
review `9951d0ce…` finds no material evidence/parser issue.

Proposal for the core owner: retain the first validated cursor during one
lazy merge and reuse its decoded values only for identical token/descriptor
inputs. Keep initial validation before discovery, every expression and meter
charge, canonical encoding, scope checks and current rule/row reads. The
ignored experiment changes only read.rs plus two simulator regressions;
compilation, qualification and ordinary HTTP comparison are still pending
at this entry. No tracked core change is adopted by this performance lane.


## 2026-09-15 — cursor reuse improves continuation, with tail tradeoffs

The ignored fixed-0.2.18 candidate now has completed evidence: 368 candidate
and eight baseline Rust passes, four exact full outcome/refusal equality
cases, and three ordinary HTTP baseline/candidate pairs on Durand. Every
117,000 timed response passed; 7,020 warmups and 162 complete walks / 33,510
pages are excluded from timing. Full physical/auth/leave/same-session-regrant
checks pass, and all 42 owned groups stopped with expected exits.

Retaining the already validated cursor inside one eligible merge improves
median p50/p95/rate in all twelve continuation cases. All 36 paired p50s
improve. The 150-group rotating feed at eight clients falls 3.716→2.984 ms
p50 and 4.376→3.247 ms p95, with rate 2,092.8→2,649.1 requests/s. Initial
validation, canonical encoding, expressions, meter charges, scope/generation
and live rules remain unchanged; the earlier re-encoding-removal experiment
is still rejected.

Tail/control losses remain material: 150-group first-page p50/rate medians
worsen at C1/C8; next-page C8 trial 503 p99 rises 5.104→12.691 ms. Five-group
thread-first C8 loses p99/max/elapsed/rate in all three pairs. The complete
benchmark record preserves all 190 paired and 50 median losses across six
metrics, plus twelve RSS points. Shared-host/cache effects are not isolated.

Independent review c1a88176 finds no material custody/oracle issue. Both
calculations agree on all reported values, medians, contrasts and resources.
The original smoke analyzer's duplicate-log redaction mismatch and earlier
unexecuted control revisions remain in the ignored evidence. No workload
rerun or raw-data replacement was needed. Six original formal result objects
are appended to storage.jsonl.

This remains a core-owner proposal under LLP 3000 decision 4, not a tracked
runtime adoption or publication. Before recommending it, replicate on a
second platform and evaluate the first-page/tail tradeoff. The Office Linux
preflight is idle but below the older builder's disk precondition; no Linux
source transfer, build or measurement has begun. The competitor and broader
common-workload goals remain open.

## 2026-09-15 — 0.2.19 / expo 0.2.10 published (lead)

Published from main `6856f48fc` (wave 3, LLP 3000.007 §20.12) by
`scripts/publish.mjs`: suite 0 failures in 301 s; production darwin binary
8,441,824 B, sha256 `d9bfdc74…`, Developer ID signed (not notarized);
installed-consumer proof passed; `snapback4@0.2.19` and
`snapback4-darwin-arm64@0.2.19` at 07:34 UTC; xcframework rebuilt and
`snapback4-expo@0.2.10` at 07:37 UTC. Next: the fourth Astra-medium
calibration on these pins.


## 2026-09-15 — W4a: synchronous admission custody across immediate web navigation

Built against `118de1c72dd53801426ba2660e12151eca0c1ee8` (0.2.19).
The Node model now destroys the document before the admission save completes,
with both same-turn teardown and an explicitly held save, one and two writes.
Its real wasm device and real server run a non-idempotent application counter
and decimal order audit. The four regressions failed on that unchanged base:
zero applications after reopen. They pass with the synchronous journal.

`web.ts` receives `call({ op: "admit", ... })` synchronously inside `mutate`,
before its first await, so this lane needs no change to `local.ts`,
`local-exit.ts`, the server, or the public client card. `web-journal.ts`
captures the operation, mutation id, arguments, minted row ids, viewer, time
and submission order in localStorage. I chose localStorage because its
synchronous `setItem` completes in that call stack and its same-origin
contents survive navigation. The claimed device-store name (including the
existing tab suffix) and backend store identity scope each journal key.
The captured JSON is also the ordinary admission's body, so a caller changing
its arguments after `mutate` returns cannot change that write.

On open, journal records enter the existing outbox through ordinary device
admission, in order before new writes. A surviving page whose save fails also
recovers older records before its next admission. Live admissions stay with
their original calls, preserving their typed refusal outcomes. The ordinary
outbox is the only sender: no new server route, unadmitted keepalive, terminal
server receipt, or exposure tracking exists. There is no new ordering
obligation between sends: the journal creates no send, and the existing
outbox serializes every recovered write with its original mutation id.

An IDB transfer marker (`j`, private to the web host and never loaded into
wasm) commits atomically with admission. It records only local transfer and
origin, not a server result or terminal outcome. If localStorage removal
fails, the marker dedupes the id even after its outbox receipt has retired;
it is collected once cleanup succeeds. Locally refused prediction and
validation remove the record and return the ordinary failure. Self-review
found that saving a marker for an already-known refusal could mask it as
`E_STORE` during an IDB outage; a red regression drove synchronous refusal
cleanup before that bookkeeping, preserving `WRONG_DIGIT`.

Closed tabs use the existing Web Lock and orphan adoption rule. Live-tab
journals are not adopted. The brief's literal "never sent to a replaced
backend" is stricter than §18.2's existing rule for already-admitted unknown
outbox writes: recovered, previously unadmitted writes retain their source
identity until retirement, and an authenticated replacement removes them
without a send. Ordinary already-admitted writes retain §18.2's behavior.
The tests cover an immediate mismatch, replacement discovered from the
server, and an offline recovery followed by replacement. A same-store
restore still uses the existing halt.

Bounds are **65,536 bytes per serialized record**, **262,144 bytes of UTF-8
keys and values per device journal**, and **32 records**. Over-budget writes,
unavailable/throwing/full localStorage, an unidentified backend, and browser
storage clearing retain best-effort unawaited navigation; ordinary admission
still runs without a synchronous throw. A journal-only write needs another
client to open. The README, writes card and LLP 3000.007 §20.4 state these
limits and keep `await client.mutate(...)` as the strongest durable boundary.
This is a navigation model, not physical-power-loss or real-Chromium evidence.

Measurements from the final affected run:

- One-write same-turn/held-save recovery: **1/1 applications**, order **1/1**,
  **17/18 ms**, **609/609 journal-value bytes**.
- Two-write same-turn/held-save recovery: **2/2 applications**, order **12/12**,
  **35/22 ms**, **1,218/1,218 journal-value bytes**.
- **0 duplicate applications** in all four; original minted row ids preserved.
- Surviving-journal controls, queued and retired receipt: **1 admission,
  1 send, 1 application, 0 duplicates** each.
- UTF-8 record control: **56,612-byte record** journaled, **56,758 bytes**
  including its key; the oversized record falls back and **2/2 writes apply**.
- Total-byte control: **4 of 5 records** journaled, **227,032 bytes** including
  keys; **5/5 writes apply**. Count control: **32 of 33 records** journaled,
  **24,279 bytes**; **33/33 writes apply**.
- Closed-tab recovery plus successor: **3 applications**, order **123**.
  A still-locked tab: **0 applications** from adoption, then **1** from its owner.
- Replacement controls: **0 sends, 0 applications** across all **3** cases.

Commands used Node 24.18.0 via
`export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH`.
Commands run from `snapback4/` unless the repository root is specified.
Logs are `/tmp/w4a-*.log`.

- Setup: `cargo build --workspace --quiet && bash scripts/build-wasm.sh && bun run --cwd packages/snapback4 build`, exit 0.
  The generated bindings were initially absent: the first package build
  reported TS2307 and the first Node invocation could not import wasm.
  The initial audit fixture also used the invalid `sync all`; changing that
  test-only draft to `sync public` preceded the genuine red comparison.
  No implementation had changed at the genuine red run.
- `bun run --cwd packages/snapback4 build`, repeated after TypeScript changes:
  exit 0 after setup.
- `node --test --test-name-pattern='pre-admission journal:' packages/snapback4/test/navigation-model.test.mjs`:
  base red `ℹ tests 4`, `ℹ pass 0`, `ℹ fail 4`, `ℹ cancelled 0`;
  immediate green `ℹ tests 4`, `ℹ pass 4`, `ℹ fail 0`, `ℹ cancelled 0`;
  expanded runs `ℹ tests 15`, `ℹ pass 15`, `ℹ fail 0`, then
  `ℹ tests 21`, `ℹ pass 21`, `ℹ fail 0` (both `ℹ cancelled 0`).
- `node --test --test-name-pattern='known refusal survives' packages/snapback4/test/navigation-model.test.mjs`:
  before the self-review fix `ℹ tests 1`, `ℹ pass 0`, `ℹ fail 1`;
  after `ℹ tests 1`, `ℹ pass 1`, `ℹ fail 0` (both `ℹ cancelled 0`).
- `node --test --test-concurrency=2 packages/snapback4/test/navigation-model.test.mjs packages/snapback4/test/web-navigation.test.mjs packages/snapback4/test/store-reset-review.test.mjs packages/snapback4/test/local-e2e.test.mjs packages/snapback4/test/client-lifecycle.test.mjs`:
  `ℹ tests 110`, `ℹ pass 110`, `ℹ fail 0`, `ℹ cancelled 0`,
  `ℹ duration_ms 31576.73`.
- `cargo test -p snapback4-lang --test guide -- --nocapture`:
  `test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s`.
- Repository root, `bash snapback4/scripts/test.sh`: exit 1;
  Rust totals **872 passed, 1 failed, 4 ignored**. Verbatim summaries:

```text
-- ok: cargo build (2 s)
-- ok: wasm build (1 s)
-- ok: package typecheck (1 s)
-- ok: package build (1 s)
-- ok: chat app check (1 s)
-- FAIL: cargo test (328 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (0 s)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
-- ok: fixture wrapper tests (9 s)
ℹ tests 275
ℹ pass 274
ℹ fail 1
ℹ cancelled 0
-- FAIL: client tests (47 s)
== 2 failure(s) in 334 s
```

The Rust failure was `driver::cli_rejects_failure_in_the_milestone_batch`:
`E_WITNESS_PORT: 127.0.0.1:63660 is unavailable: Address already in use (os error 48); choose a free --port; no existing process was stopped`.
Its full target reported
`test result: FAILED. 19 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 15.12s`.
Isolated rerun,
`cargo test -p snapback4 --test witness driver::cli_rejects_failure_in_the_milestone_batch -- --nocapture`, passed:
`test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 19 filtered out; finished in 3.45s`.
No other process was stopped to free the port.

The client failure is the supplied sandbox Chromium launch artifact in
`react.test.mjs`: `exitCode=null, signal=SIGABRT`. The isolated
`node --test packages/snapback4/test/react.test.mjs` repeats it:
`ℹ tests 1`, `ℹ pass 0`, `ℹ fail 1`, `ℹ cancelled 0`.
There were no lifecycle or default-concurrency client timeouts. I do not
attribute any failing product test to an independently verified pre-existing
base; the collision cleared on rerun, and Chromium needs the lead's environment.

Repository-root `./ref-check --verbose` before this append:
`ref-check: ok — 480 LLP docs, 8927 refs in 23698 files, 0 errors, 0 unchecked`.
`git diff --check` passes. All earlier journal content is unchanged; this is
one appended entry. The largest changed code file is `web.ts`, **447 lines**.
No diagnostic text comparison was requested, and no diagnostic code or note
was added or changed. No out-of-scope file was touched. No commit, push, tag,
publication, dependency install, sub-agent, clone or remote machine was used.
The lead owns `node witness/navigation-immediate.mjs` outside the sandbox:
**10/10 is the target; the Chromium after-result is not measured by this lane**.
