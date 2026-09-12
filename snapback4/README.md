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
| `crates/snapback4` | the binary: `--version` and `doctor` today; owner, wire and verbs from week 2 |
| `packages/snapback4` | the client: the contract, the labelled MOCK client, the React hooks; the replica from week 3 |
| `apps/chat` | the chat reference app against the card, on the MOCK client; its `snapback/schema.q` is the desired dialect |
| `scripts/test.sh` | everything blocking, under 60 s |
