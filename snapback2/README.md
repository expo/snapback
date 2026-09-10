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
| `crates/snapback2` | the binary: the owner (`dev`), the wire, and the verbs `init`, `check`, `run`, `test`, `why`, `trace`, `data`, `logs`, `persona`, `reset`, `guide`, `doctor` (LLP 1002) |
| `packages/compiler` | Quarry → bound typed IR directly; inferred API types; TypeScript checking for effects, seeds and journeys only (LLP 1018.000) |
| `packages/evaluator` | the RBAC- and Bytes-complete IR evaluator twin; the public client uses held receipts and programs for offline reads and mutation prediction (LLP 1012 §§6–7) |
| `packages/snapback2` | npm shim, headless client, React web/Expo arms, durable offline store/outbox, typed item presentation, test runner, packaged guide and templates |
| `corpus/` | shared Rust/TypeScript conformance cases; current counts come from the corpus, not this map |
| `scripts/` | `test.sh`, `measure.mjs`, `publish.mjs`, `hermes` |
| `metrics/loop.jsonl` | every measured run |

For current syntax and API facts, use `snapback2 guide <topic>` (start with
`quarry`, `live-query`, `offline`, or `effects`). For design rationale, follow
the root LLP's implementation map. Implemented client arms do not by themselves
claim that a published package has met the offline/capability benchmark bars.
