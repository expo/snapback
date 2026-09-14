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

```text
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

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
ℹ pass 9
ℹ fail 0
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
