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
