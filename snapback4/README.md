# Snapback 4

One of two parallel candidates for the successor to Snapback 2, and the
sibling of Snapback 3, not its successor. It builds LLP 2000.000 as written:
the Snapback 2 core kept, two substrates flipped — resources metered at
runtime instead of priced statically; a client that replicates the viewer's
declared partition instead of caching receipted results — proved first on the
hub fixture, with a deterministic simulator as the primary harness.

Start at [`AGENTS.md`](./AGENTS.md). The root is
[LLP 3000](../llp/3000-snapback4.explainer.md); the design brief is
[LLP 2000.000](../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md); the
scope is [`NOT-DOING.md`](./NOT-DOING.md); the chronology is
[`JOURNAL.md`](./JOURNAL.md).

| | |
|---|---|
| `crates/snapback4-core` | the engine: value model, schema with `sync`, IR, one key encoding, the SQLite store, rules with hoisting, the runtime meter, the interpreter, the partition log, at-most-once writes, the day-two classifier |
| `crates/snapback4-lang` | Quarry in Rust: lexer, parser, binder, diagnostics with rewrites, the TypeScript emitter |
| `crates/snapback4` | the binary: `init`, `check`, `dev`, `run`, `test`, `why`, `guide`, `data`, `doctor`; the HTTP wire |
| `crates/snapback4-sim` | the deterministic world: the engine and replica devices under faults, LLP 3000 §6's invariants |
| `packages/snapback4` | the client: the contract (the card), the online-tier client, the React hooks, a labelled mock; the replica from week 3 |
| `apps/chat` | the chat reference app on the real client; `snapback/schema.q` is the backend |
| `corpus/`, `fixtures/`, `floors/` | Snapback 2's conformance corpus; the Clique hub fixture wrapper; the five physical floors |
| `scripts/test.sh` | everything blocking, under 60 s |
