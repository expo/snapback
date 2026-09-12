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
