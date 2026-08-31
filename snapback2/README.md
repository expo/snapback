# Snapback 2

The from-scratch successor to Snapback: one language for queries and mutations
(bounded data programs, LLP 0329.014.004), one loop for the agent building on it
(LLP 0329.016), one binary. Seeded from spike S1 (`spikes/bounded-programs/`).

Start at [`AGENTS.md`](./AGENTS.md); the design root is
[`llp/1000-snapback2.explainer.md`](../llp/1000-snapback2.explainer.md); the
posture is [`rules/RULES.md`](../rules/RULES.md) and
[`rules/NOT-DOING.md`](../rules/NOT-DOING.md).

| | |
|---|---|
| `crates/snapback2-core` | IR, certificate, engine (SQLite), trace, client replay |
| `crates/snapback2-effects` | effects on Ibex 2 over vanilla Hermes: grant-bound `fetch`, isolated jobs, the outbox lifecycle runner (LLP 1003) |
| `crates/snapback2` | the binary: the owner (`dev`), the wire, and the verbs `init`, `check`, `run`, `test`, `why`, `trace`, `data`, `logs`, `persona`, `fork`/`reset`, `guide`, `doctor` (LLP 1002) |
| `packages/compiler` | TypeScript subset → IR (spike S2) |
| `packages/evaluator` | the IR evaluator twin for clients (spike S3, 7.8 KB gzip) |
| `packages/snapback2` | the npm package: shim, authoring runtime (`snapback2`), `snapback2/client`, `snapback2/react`, `snapback2/test`, guide pages, templates |
| `corpus/` | 77 shared conformance cases |
| `scripts/` | `test.sh`, `measure.mjs`, `publish.mjs`, `hermes` |
| `metrics/loop.jsonl` | every measured run |
