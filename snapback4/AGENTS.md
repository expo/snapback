# Snapback 4 — agent command sheet

Read this, then [LLP 3000](../llp/3000-snapback4.explainer.md) (the root and
the bakeoff protocol), [LLP 2000.000](../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md)
(the design brief), [`NOT-DOING.md`](./NOT-DOING.md), and the tail of
[`JOURNAL.md`](./JOURNAL.md). `rules/RULES.md` at the repository root is
adopted here as written; LLPs for Snapback 4 are numbered **3000 and up**
(`llp-create --under 3000` for a child; extend LLP 3000 or LLP 2000.000
before minting a new number).

```
cargo build                          # the binary; no JS engine, no bootstrap, nothing outside crates.io
scripts/test.sh                      # everything blocking (60 s budget); reports every failure, never fail-fast
./target/debug/snapback4 --help      # init · check [--cost] · dev · run · test · why · guide · data · doctor
cd apps/chat && ../../target/debug/snapback4 check     # compiles snapback/*.q, writes snapback/generated/api.ts
cd apps/chat && ../../target/debug/snapback4 dev       # serves 127.0.0.1:4400; re-adopts the schema on save
cd apps/chat && bun run dev                            # the app on the real client (?as=bob picks a persona)
bun run --cwd packages/snapback4 typecheck   # the contract, the client and the hooks typecheck
cargo test -p snapback4-core --test corpus -- --nocapture   # the conformance corpus, with skip reasons
cargo test -p snapback4-sim          # the chat world under faults: the seven invariants
node witness/idb.mjs                 # the Chromium witness: the local-first client on IndexedDB (needs Chrome)
node scripts/measure-client.mjs      # each client tier's bytes on the pinned toolchain → metrics/client.jsonl
```

Crates: `snapback4-core` (value model, schema with `sync`, IR, key encoding,
SQLite store, rules with hoisting, the meter, the interpreter, the partition
log, at-most-once, the day-two classifier, wire forms), `snapback4-lang`
(Quarry lexer, parser, binder, diagnostics, the TypeScript emitter),
`snapback4` (verbs and the HTTP wire), `snapback4-sim` (the deterministic
world hosting the engine and a replica device).

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
- Rule probes and `exists` need an index over exactly the probed columns
  (`by byConversationPrincipalRole: conversationId, principal, role` for
  `exists memberships[.conversationId, viewer, 'admin']`); the diagnostic
  names the indexes that exist.
- `publish.mjs` ships the client package only until the binary does something; the platform binary packages arrive with week 2's owner. Bump `version` in `packages/snapback4/package.json` and `Cargo.toml` together.
