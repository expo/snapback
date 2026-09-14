# Snapback 4 — agent command sheet

Read this, then [LLP 3000](../llp/3000-snapback4.explainer.md) (the root and
the bakeoff protocol), [LLP 2000.000](../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md)
(the design brief), [`NOT-DOING.md`](./NOT-DOING.md), and the tail of
[`JOURNAL.md`](./JOURNAL.md). `rules/RULES.md` at the repository root is
adopted here as written; LLPs for Snapback 4 are numbered **3000 and up**
(`llp-create --under 3000` for a child; extend LLP 3000 or LLP 2000.000
before minting a new number).

```
cargo build                          # the binary; no JS engine, no bootstrap; crates.io plus one vendored patch (vendor/tiny_http)
scripts/test.sh                      # everything blocking (60 s budget); reports every failure, never fail-fast
./target/debug/snapback4 --help      # init [--online|--expo] · check [--cost|--residency|--fix|--json] · dev · deploy · rollback · serve · run (an op, or a job as the system) · test · why · guide · data · sql · token (a service's seat) · doctor · device · types · --version
./target/debug/snapback4 guide       # the language card; `guide <keyword>` for a card — every card's Quarry is compiled by the suite (crates/snapback4-lang/tests/guide.rs)
cd apps/chat && ../../target/debug/snapback4 check     # compiles snapback/*.q, writes snapback/generated/api.ts
cd apps/chat && ../../target/debug/snapback4 dev       # serves 127.0.0.1:4400; re-adopts the schema on save
cd apps/chat && bun run dev                            # the app on the real client (?as=bob picks a persona)
bun run --cwd packages/snapback4 typecheck   # the contract, the client and the hooks typecheck
cargo test -p snapback4-core --test corpus -- --nocapture   # the conformance corpus, with skip reasons
cargo test -p snapback4-sim          # the chat world under faults: the seven invariants
cargo test -p snapback4-sim --test native   # native jobs: builds native-fixtures/rescore for wasm32-unknown-unknown (cold ~20 s, then cached under target/native-fixture) and runs it
bash scripts/build-wasm.sh           # the device as wasm into packages/snapback4/src/wasm/ (the web tier and the Chromium witness need it)
node witness/idb.mjs                 # the Chromium witness: the client on the wasm device over IndexedDB (needs Chrome)
WITNESS_DEV_CLIENT=1 node witness/expo.mjs   # the simulator witness: the client on the Rust module in a development build (apps/chat-expo: bun run ios:dev first; booted iOS simulator)
node witness/scale.mjs [G] [N] [M]   # cold sync at scale: G groups × N messages × M members into the wasm device; wall time + JS heap → metrics/witness.jsonl
node scripts/measure-storage.mjs     # what the store weighs on the scale seed (rows, indexes, partition log) → metrics/storage.jsonl
                                     # SNAPBACK4_BIN=target/release/snapback4 measures the release build (throughput numbers)
node scripts/measure-client.mjs      # each client tier's bytes on the pinned toolchain → metrics/client.jsonl
bash scripts/measure-wasm.sh         # the device core as wasm (crates/snapback4-device), bound and measured → metrics/wasm.jsonl
bash scripts/build-xcframework.sh    # the device as an iOS xcframework for packages/snapback4-expo (staticlib alone, stripped; 13.2 MB with native reads)
node loopbar/run.mjs --n 3           # the loop bar: fresh agents on the published pin build reduced Clique M1–M3 → metrics/loopbar.jsonl
node scripts/publish.mjs             # runs the suite (refuses on red), builds the production binary, publishes snapback4 + snapback4-darwin-arm64
```

Crates: `snapback4-core` (value model, schema with `sync`, IR, key encoding,
SQLite store, rules with hoisting, the meter, the interpreter, the partition
log, at-most-once, the day-two classifier, wire forms), `snapback4-lang`
(Quarry lexer, parser, binder, diagnostics, the TypeScript emitter),
`snapback4` (verbs and the HTTP wire), `snapback4-sim` (the deterministic
world hosting the engine and a replica device), `snapback4-device` (the
interpreter over a `DeviceStore`: the core's SQLite under the native
module for Expo and Exact2 hosts, memory under wasm on the web; one
dispatcher, one suite on both)). The guide (`snapback4-lang/src/guide.rs`) is
the language card and the keyword cards; packages: `snapback4` (the client
over the device and the CLI shim), `snapback4-darwin-arm64` (the binary), `snapback4-expo`
(the Swift module over the device's C ABI).

What exists, by week (LLP 3000 §5):

| Week | Lands |
|---|---|
| 1 | the contract (`packages/snapback4/src/contract.ts`), the mocked chat app against it, the hub fixture wrapper, the five floor measurements in the journal, the simulator skeleton (`crates/snapback4-sim`), the Snapback 2 corpus copied in, 0.0.1 published |
| 2 | server: SQLite transaction and interpreter, rules and uniformity, the meter, the partition log (`sync`), generations, personas, the wire, `check`/`dev`/`run`/`test`/`why`/`guide`, the seven simulator invariants |
| 3 | web client: replica store, outbox with client-minted ids, local interpreter, reactive local queries, the online-only tier, the chat app on the real client |
| 4 | Expo client, day-two scenarios, deploy, the loop bar, the Clique hub run, the comparison record |

Gotchas you cannot derive from the code:

- Own Cargo and Bun workspaces; the repository root excludes them. Run cargo/bun from `snapback4/`. Node 24.x (`engines`): run the suite with the pinned runtime on PATH, not the ambient Homebrew node.
- One owner on the core (LLP 3000 decision 4): the engine, the store and the client contract are written by the lead session; Codex lanes take the fixture generator, the reference apps, the device witnesses and the periphery. Do not reshape `contract.ts` from a lane; propose the change in the journal.
- No ceiling is raised in slice one (LLP 2000.000 §12). A thing that does not fit changes the design or waits.
- The journal is append-only and dated; never rewrite an entry. LLP 3000 §7 carries decisions that must outlive it.
- Nothing here depends on `snapback2/` at runtime. Copy source deliberately, split under 1,500 lines on the way in, and say so in the journal.
- Named lane: `~/projects/snapback-sb4` on `sb4/*` branches. Never `git stash`; commit checkpoints.
- The conformance corpus (`corpus/`) is Snapback 2's serialized IR and value
  model; the core keeps those serializations so it binds. A case the slice
  cannot run is skipped with a named reason, never counted as a pass.
- `snapback/generated/api.ts` is built by `check` and `dev`, never committed;
  the app's typecheck needs a `check` first (the suite does one).
- Positional rule probes and `exists` need an index over exactly the probed columns
  (`by byConversationPrincipalRole: conversationId, principal, role` for
  `exists memberships[.conversationId, viewer, 'admin']`); the diagnostic
  names the indexes that exist. Named equalities covering a total unique key
  check any extra columns on that one row without an additional index.
- The packaged CLI uses `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` during both publication tests and its production build (LLP 3000 §7). A plain production Cargo build retains the dependency's ordinary SQLite policy; use the same build input when comparing with the package. The variable is unnecessary at runtime.
- `scripts/publish.mjs` runs the suite and refuses on red, builds the production binary, packs `snapback4-darwin-arm64` and verifies the installed digest, then publishes both packages. Bump `version` in `packages/snapback4/package.json` (and its `optionalDependencies`), `packages/snapback4-darwin-arm64/package.json` and `Cargo.toml` together; a test refuses a mismatch.
- The guide is tested text. Every ```quarry block in `crates/snapback4-lang/src/guide.rs` and in `packages/snapback4/README.md` is compiled by `crates/snapback4-lang/tests/guide.rs` with no diagnostic and no note (the language card is also run against the engine); every refusal code the sources emit must be in `guide::CODES`; every `guide("..")` a diagnostic carries must name a card. Add a form to the language card when you add it to the parser, fence README Quarry as ```quarry, and never fence Quarry as plain text to dodge the test.
- Native jobs (LLP 3000.005) need `rustup target add wasm32-unknown-unknown`; the suite's fixture build fails loudly without it. The guest SDK `crates/snapback4-native` is a path dependency until it is published; an app's `snapback/native/Cargo.toml` names it by path.
